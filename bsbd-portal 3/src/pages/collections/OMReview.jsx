import React, { useState, useEffect } from 'react'
import { IcoUpload, IcoChevD, IcoChevU, IcoCheck, IcoAlert, IcoRefresh, IcoPrint } from '../../components/icons'
import { LBL } from '../../components/ui'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'
import { todayStr, N, USD } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'
import { generateFlags, SEVERITY_ORDER, SEVERITY_COLOR, SEVERITY_BG, SEVERITY_BORDER, FLAG_TYPE_LABEL, detectCarrierGroup } from '../../lib/insuranceFlags'
import { parseCollectionSheetFull } from './CollectionTracker'

const CARRIER_GROUP_LABEL = {
  delta:'Delta Dental', bcbs:'BCBS / Anthem / Highmark', cigna:'Cigna',
  concordia:'United Concordia', united:'United / UHC', metlife:'MetLife',
  guardian:'Guardian', aetna:'Aetna', humana:'Humana',
  medicaid:'Medicaid / State Plans', other:'Other Carrier', unknown:'Unknown Carrier',
}

export default function OMReviewPage({ user, isManager }) {
  const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate()+1); return d.toISOString().split('T')[0] })()
  const [date,     setDate]     = useState(tomorrow)
  const [office,   setOffice]   = useState(user.office || OFFICES[0])
  const [patients, setPatients] = useState([])
  const [flags,    setFlags]    = useState({}) // patientNorm+tooth+code -> flag record
  const [loading,  setLoading]  = useState(false)
  const [uploading,setUploading]= useState(false)
  const [expanded, setExpanded] = useState(null)
  const [toast,    setToast]    = useState(null)
  const [search,   setSearch]   = useState('')
  const [filterFlags, setFilterFlags] = useState('all') // all | outstanding | verified | no_flags
  const fileRef = React.useRef(null)

  const notify = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4500) }

  // ── Load patients + flags ──────────────────────────────────────────────
  const load = async (silent=false) => {
    if (!silent) setLoading(true)
    try {
      const [ptRows, flagRows] = await Promise.all([
        sbGet('collection_patients', `office=eq.${encodeURIComponent(office)}&date=eq.${date}&order=operatory,patient_name`),
        sbGet('patient_flags', `office=eq.${encodeURIComponent(office)}&select=*`)
      ])
      setPatients(ptRows)
      const fm = {}
      for (const f of flagRows) fm[f.id] = f
      setFlags(fm)
    } catch(e) { if(!silent) notify('Load failed: '+e.message,'error') }
    if (!silent) setLoading(false)
  }

  useEffect(() => { load() }, [date, office])

  // ── Upload ─────────────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      let parsed = [], label = file.name
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const { extractCollectionSheetText, parseCollectionSheetPdf, detectOfficeFromFilename, detectOfficeFromText } = await import('../../lib/collectionSheetPdfParser')
        const text = await extractCollectionSheetText(file)
        const det  = detectOfficeFromFilename(file.name) || detectOfficeFromText(text)
        if (det && det !== office) {
          const ok = window.confirm('Office mismatch: PDF appears to be for "' + det + '" but uploading to "' + office + '".\n\nContinue anyway?')
          if (!ok) { setUploading(false); if (fileRef.current) fileRef.current.value = ''; return }
        }
        if (!det) notify('Could not detect office from PDF — verify correct file', 'error')
        const res = parseCollectionSheetPdf(text, file.name)
        parsed    = res.patients
        if (res.date && res.date !== date) notify('PDF date (' + res.date + ') differs from selected date (' + date + ')', 'error')
      } else {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
        const wb   = XLSX.read(await file.arrayBuffer(), {type:'array'})
        const d    = new Date(date+'T12:00:00')
        const day  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]
        const mon  = d.toLocaleString('en-US',{month:'long'})
        const sheet= wb.SheetNames.find(n=>n.includes(day)&&n.includes(mon)&&n.includes(String(d.getDate())))||wb.SheetNames[0]
        label      = sheet
        parsed     = parseCollectionSheetFull(XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:null}))
      }
      if (!parsed.length) { notify('No patients found in "'+label+'"','error'); setUploading(false); return }
      const ex = await sbGet('collection_patients', 'office=eq.'+encodeURIComponent(office)+'&date=eq.'+date+'&select=id')
      for (const r of ex) await sbDel('collection_patients', 'id=eq.'+r.id)
      for (const p of parsed) await sbPost('collection_patients', {...p, office, date, created_at:new Date().toISOString(), updated_at:new Date().toISOString()}, true)
      await load()
      notify('Loaded '+parsed.length+' patients from "'+label+'"')
    } catch(err) { notify('Upload failed: '+err.message,'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Save flag ──────────────────────────────────────────────────────────
  const saveFlag = async (patient, flag, updates) => {
    const flagId = patient.patient_name_norm+'__'+flag.procedure_code+'__'+flag.tooth+'__'+flag.flag_type
    const existing = flags[flagId]
    const row = {
      id:               flagId,
      patient_name_norm:patient.patient_name_norm,
      office,
      tooth:            flag.tooth,
      procedure_code:   flag.procedure_code,
      flag_type:        flag.flag_type,
      flag_question:    flag.flag_question,
      ...updates,
      updated_at: new Date().toISOString(),
      created_at: existing?.created_at || new Date().toISOString(),
      verified_by: updates.verified ? user.name : (existing?.verified_by||''),
      verified_date: updates.verified ? todayStr() : (existing?.verified_date||''),
    }
    await sbPost('patient_flags', row, true)
    setFlags(prev => ({...prev, [flagId]: row}))
    // Update patient flag counts
    const ptFlags = getPatientFlags(patient)
    const doneCnt = ptFlags.filter(f => {
      const fid = patient.patient_name_norm+'__'+f.procedure_code+'__'+f.tooth+'__'+f.flag_type
      return fid === flagId ? updates.verified : flags[fid]?.verified
    }).length
    await sbPost('collection_patients',{...patient, flags_done: doneCnt, updated_at: new Date().toISOString()}, true)
    setPatients(prev=>prev.map(p=>p.id===patient.id?{...p,flags_done:doneCnt}:p))
  }

  // ── Get flags for a patient ────────────────────────────────────────────
  const getPatientFlags = (patient) => {
    const generated = generateFlags(patient.treatments||[], patient.ins_carrier||'')
    return generated.sort((a,b) => (SEVERITY_ORDER[a.severity]||1)-(SEVERITY_ORDER[b.severity]||1))
  }

  const getFlagRecord = (patient, flag) => {
    const flagId = patient.patient_name_norm+'__'+flag.procedure_code+'__'+flag.tooth+'__'+flag.flag_type
    return flags[flagId] || null
  }

  // ── Derived ────────────────────────────────────────────────────────────
  const filtered = patients.filter(p => {
    if (search && !p.patient_name.toLowerCase().includes(search.toLowerCase())) return false
    const pFlags = getPatientFlags(p)
    if (filterFlags === 'outstanding') return pFlags.some(f => !getFlagRecord(p,f)?.verified)
    if (filterFlags === 'verified')    return pFlags.length > 0 && pFlags.every(f => getFlagRecord(p,f)?.verified)
    if (filterFlags === 'no_flags')    return pFlags.length === 0
    return true
  })

  const totalFlags = patients.reduce((s,p) => s + getPatientFlags(p).length, 0)
  const doneFlags  = patients.reduce((s,p) => s + getPatientFlags(p).filter(f => getFlagRecord(p,f)?.verified).length, 0)
  const criticalPending = patients.reduce((s,p) =>
    s + getPatientFlags(p).filter(f => f.severity==='critical' && !getFlagRecord(p,f)?.verified).length, 0)

  // ── Patient review card ────────────────────────────────────────────────
// ── Flag Card — needs own state ────────────────────────────────────────────
function FlagCard({ flag, rec, patient, saveFlag, user }) {
  const verified  = rec?.verified || false
  const [editAuth, setEditAuth] = useState(rec?.auth_number||'')
  const [editNote, setEditNote] = useState(rec?.flag_notes||'')
  const [editDate, setEditDate] = useState(rec?.verified_date||'')
  const [saving,   setSaving]   = useState(false)
  const [open,     setOpen]     = useState(!verified && flag.severity==='critical')
  const p = patient

  return (
                <div key={fi} style={{borderRadius:10,border:`1px solid ${SEVERITY_BORDER[flag.severity]}`,background:verified?'#f8fafc':SEVERITY_BG[flag.severity],marginBottom:10,overflow:'hidden'}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer'}} onClick={()=>setOpen(!open)}>
                    <div style={{width:28,height:28,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
                      background:verified?'#16a34a':SEVERITY_COLOR[flag.severity],color:'white',fontSize:12,fontWeight:800}}>
                      {verified?'✓':flag.severity==='critical'?'!':flag.severity==='warning'?'⚠':'i'}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:2}}>
                        <span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:99,
                          background:verified?'#dcfce7':SEVERITY_BG[flag.severity],
                          color:verified?'#16a34a':SEVERITY_COLOR[flag.severity]}}>
                          {verified?'VERIFIED':flag.severity.toUpperCase()}
                        </span>
                        <span style={{fontSize:10,fontWeight:600,color:'#64748b',background:'#f1f5f9',padding:'2px 8px',borderRadius:99}}>
                          {FLAG_TYPE_LABEL[flag.flag_type]||flag.flag_type}
                        </span>
                        <span style={{fontSize:10,color:'#94a3b8'}}>{flag.procedure_code}{flag.tooth?' · Tooth '+flag.tooth:''}</span>
                      </div>
                      <div style={{fontSize:12,color:verified?'#64748b':'#1e293b',fontWeight:verified?400:500,lineHeight:1.4}}>
                        {flag.flag_question}
                      </div>
                      {verified&&rec?.verified_by&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Verified by {rec.verified_by} on {rec.verified_date}</div>}
                      {verified&&rec?.auth_number&&<div style={{fontSize:11,color:'#7c3aed',marginTop:1,fontWeight:600}}>Auth #: {rec.auth_number}</div>}
                    </div>
                    <span style={{color:'#94a3b8',fontSize:11}}>{open?'▲':'▼'}</span>
                  </div>

                  {open && (
                    <div style={{padding:'12px 14px',borderTop:'1px solid rgba(0,0,0,.06)',background:'rgba(255,255,255,.7)'}}>
                      <div style={{display:'grid',gridTemplateColumns:flag.requires_auth&&flag.requires_date?'1fr 1fr 1fr':flag.requires_auth||flag.requires_date?'1fr 1fr':'1fr',gap:10,marginBottom:12}}>
                        {flag.requires_auth && (
                          <div>
                            <label style={LBL}>Auth Number</label>
                            <input className="ic" value={editAuth} onChange={e=>setEditAuth(e.target.value)} placeholder="Enter authorization number"/>
                          </div>
            )}
                        {flag.requires_date && (
                          <div>
                            <label style={LBL}>Date (last service/effective date)</label>
                            <input type="date" className="ic" value={editDate} onChange={e=>setEditDate(e.target.value)}/>
                          </div>
            )}
                        <div style={{gridColumn:flag.requires_auth&&flag.requires_date?'1/-1':undefined}}>
                          <label style={LBL}>Notes from Ridgeview call</label>
                          <input className="ic" value={editNote} onChange={e=>setEditNote(e.target.value)} placeholder="Add verification notes…"/>
                        </div>
                      </div>
                      <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                        {verified && (
                          <button onClick={async()=>{setSaving(true);await saveFlag(p,flag,{verified:false,auth_number:editAuth,flag_notes:editNote,verified_date:editDate});setSaving(false)}}
                            style={{padding:'7px 16px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>
                            Undo Verification
                          </button>
            )}
                        <button onClick={async()=>{setSaving(true);await saveFlag(p,flag,{verified:true,auth_number:editAuth,flag_notes:editNote,verified_date:editDate});setSaving(false);setOpen(false);}}
                          disabled={saving}
                          style={{padding:'7px 18px',borderRadius:8,background:saving?'#86efac':'#16a34a',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:saving?'not-allowed':'pointer'}}>
                          {saving?'Saving…':'✓ Mark Verified'}
                        </button>
                      </div>
                    </div>
      )}
                </div>
  )
}

    const PatientReviewCard = ({ p }) => {
    const pFlags    = getPatientFlags(p)
    const verifiedN = pFlags.filter(f => getFlagRecord(p,f)?.verified).length
    const pendingN  = pFlags.length - verifiedN
    const critN     = pFlags.filter(f => f.severity==='critical' && !getFlagRecord(p,f)?.verified).length
    const isExp     = expanded === p.id
    const allDone   = pFlags.length > 0 && pendingN === 0
    const noFlags   = pFlags.length === 0
    const carrier   = p.ins_carrier || ''
    const grp       = detectCarrierGroup(carrier)

    return (
      <div style={{background:'white',borderRadius:12,border:`2px solid ${critN>0?'#fecaca':allDone?'#bbf7d0':pFlags.length>0?'#fde68a':'#e2e8f0'}`,marginBottom:10,overflow:'hidden'}}>

        {/* Card header */}
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',cursor:'pointer'}} onClick={()=>setExpanded(isExp?null:p.id)}>

          {/* Status circle */}
          <div style={{width:44,height:44,borderRadius:'50%',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',
            background:noFlags?'#f1f5f9':allDone?'#dcfce7':critN>0?'#fee2e2':'#fef3c7'}}>
            {noFlags  && <span style={{fontSize:18}}>✓</span>}
            {!noFlags && allDone && <IcoCheck size={20} style={{color:'#16a34a'}}/>}
            {!noFlags && !allDone && <span style={{fontSize:14,fontWeight:800,color:critN>0?'#dc2626':'#d97706'}}>{pendingN}</span>}
          </div>

          {/* Patient info */}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:3}}>
              <span style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>{p.patient_name}</span>
              {p.operatory&&<span style={{fontSize:10,fontWeight:700,color:'#7c3aed',background:'#f5f3ff',padding:'2px 8px',borderRadius:99}}>{p.operatory}</span>}
              {carrier&&<span style={{fontSize:10,color:'#64748b',background:'#f1f5f9',padding:'2px 8px',borderRadius:99}}>{CARRIER_GROUP_LABEL[grp]||carrier}</span>}
            </div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:11,color:'#64748b'}}>
              {p.total_expected>0&&<span style={{fontWeight:600,color:'#dc2626'}}>Collect: {USD(p.total_expected)}</span>}
              {noFlags&&<span style={{color:'#16a34a',fontWeight:600}}>No flags needed</span>}
              {!noFlags&&<span>{verifiedN}/{pFlags.length} flags verified</span>}
              {critN>0&&<span style={{color:'#dc2626',fontWeight:700}}>⚠ {critN} critical pending</span>}
              {allDone&&!noFlags&&<span style={{color:'#16a34a',fontWeight:700}}>✓ All verified</span>}
              {(p.treatments||[]).length>0&&<span>{p.treatments.length} procedure{p.treatments.length!==1?'s':''}</span>}
            </div>
          </div>

          {/* Progress bar + chevron */}
          <div style={{flexShrink:0,width:80,textAlign:'right'}}>
            {pFlags.length > 0 && (
              <div style={{height:6,background:'#e2e8f0',borderRadius:3,overflow:'hidden',marginBottom:4}}>
                <div style={{height:'100%',background:allDone?'#16a34a':'#d97706',width:(verifiedN/pFlags.length*100)+'%',borderRadius:3,transition:'width .3s'}}/>
              </div>
            )}
            {isExp?<IcoChevU size={15} style={{color:'#94a3b8'}}/>:<IcoChevD size={15} style={{color:'#94a3b8'}}/>}
          </div>
        </div>

        {/* Expanded flag list */}
        {isExp && (
          <div style={{borderTop:'1px solid #f1f5f9',padding:'14px 16px'}}>

            {/* Procedure summary */}
            {(p.treatments||[]).length > 0 && (
              <div style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px',marginBottom:14}}>
                <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:6}}>PROCEDURES TODAY</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {(p.treatments||[]).map((t,i)=>(
                    <span key={i} style={{fontSize:11,padding:'3px 10px',borderRadius:99,background:'white',border:'1px solid #e2e8f0',color:'#475569',fontWeight:600}}>
                      <b>{t.code}</b>{t.tooth?' · Th:'+t.tooth:''}{t.pt_pct!=null?' · '+t.pt_pct+'% pt':''}
                    </span>
                  ))}
                </div>
                {p.ins_status&&<div style={{fontSize:11,color:'#64748b',marginTop:6}}>{p.ins_status?.includes('ACTIVE')?'Active Insurance':'⚠ '+p.ins_status} · {carrier}</div>}
                {p.claim_notes&&p.claim_notes[0]&&<div style={{fontSize:11,color:'#dc2626',marginTop:4}}>Claim note: {p.claim_notes[0]}</div>}
              </div>
            )}

            {noFlags && (
              <div style={{textAlign:'center',padding:'20px',color:'#94a3b8',fontSize:13}}>
                ✓ No insurance flags for this patient — straightforward visit
              </div>
            )}

            {/* Flags */}
            {pFlags.map((flag, fi) => {
              const rec = getFlagRecord(p, flag)
              return <FlagCard key={fi} flag={flag} rec={rec} patient={p} saveFlag={saveFlag} user={user}/>
            })}
         </div>
        )}
      </div>
    )
  }

  return (
    <div style={{maxWidth:900,margin:'0 auto',padding:'24px 20px 60px'}}>
      {toast&&<div style={{position:'fixed',top:20,right:20,zIndex:9999,padding:'12px 20px',borderRadius:12,boxShadow:'0 10px 30px rgba(0,0,0,.15)',color:'white',fontSize:13,fontWeight:600,background:toast.type==='error'?'#ef4444':'#10b981',maxWidth:380}}>{toast.msg}</div>}

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',margin:0}}>Insurance Review</h1>
          <p style={{color:'#94a3b8',fontSize:13,marginTop:3}}>OM pre-visit verification — review with Ridgeview the day before</p>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>load()} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>
            <IcoRefresh size={13}/> Refresh
          </button>
          <label style={{display:'flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:10,background:uploading?'#6366f1':'#4f46e5',color:'white',fontWeight:700,fontSize:13,cursor:uploading?'not-allowed':'pointer'}}>
            <IcoUpload size={14}/> {uploading?'Loading…':'Upload Collection Sheet'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" onChange={handleUpload} style={{display:'none'}} disabled={uploading}/>
          </label>
        </div>
      </div>

      {/* Filters */}
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'14px 16px',marginBottom:16,display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div style={{flex:'1 1 130px'}}>
          <label style={LBL}>Appointment Date</label>
          <input type="date" className="ic" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
        {isManager&&<div style={{flex:'1 1 120px'}}>
          <label style={LBL}>Office</label>
          <select className="ic" value={office} onChange={e=>setOffice(e.target.value)}>
            {OFFICES.map(o=><option key={o}>{o}</option>)}
          </select>
        </div>}
        <div style={{flex:'1 1 150px'}}>
          <label style={LBL}>Show</label>
          <select className="ic" value={filterFlags} onChange={e=>setFilterFlags(e.target.value)}>
            <option value="all">All Patients</option>
            <option value="outstanding">Has Outstanding Flags</option>
            <option value="verified">All Flags Verified</option>
            <option value="no_flags">No Flags Needed</option>
          </select>
        </div>
        <div style={{flex:'1 1 150px'}}>
          <label style={LBL}>Search</label>
          <input className="ic" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Patient name…"/>
        </div>
      </div>

      {/* Summary */}
      {patients.length>0&&(
        <div style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)',borderRadius:12,padding:'14px 20px',marginBottom:16,color:'white',display:'flex',flexWrap:'wrap',gap:0}}>
          {[
            ['PATIENTS',   patients.length,                null],
            ['TOTAL FLAGS',totalFlags,                     null],
            ['VERIFIED',   doneFlags,                      doneFlags===totalFlags&&totalFlags>0?'#86efac':null],
            ['PENDING',    totalFlags-doneFlags,            totalFlags-doneFlags>0?'#fde68a':null],
            ['CRITICAL',   criticalPending,                criticalPending>0?'#f87171':'#86efac'],
            ['READY',      patients.filter(p=>getPatientFlags(p).every(f=>getFlagRecord(p,f)?.verified)).length, null],
          ].map(([l,v,c],i)=>(
            <div key={i} style={{flex:'1 1 80px',padding:'0 12px',borderLeft:i>0?'1px solid rgba(255,255,255,.2)':'none'}}>
              <div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:2}}>{l}</div>
              <div style={{fontSize:17,fontWeight:800,color:c||'white'}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading&&patients.length===0&&(
        <div style={{textAlign:'center',padding:'60px 20px',background:'white',borderRadius:12,border:'2px dashed #e2e8f0'}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:6}}>No patients loaded for {date}</div>
          <p style={{fontSize:13,color:'#94a3b8',marginBottom:20}}>Upload the Ridgeview collection sheet to generate insurance flags for review.</p>
          <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'11px 24px',borderRadius:10,background:'#4f46e5',color:'white',fontWeight:700,fontSize:14,cursor:'pointer'}}>
            <IcoUpload size={16}/> Upload Collection Sheet
            <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleUpload} style={{display:'none'}}/>
          </label>
        </div>
      )}

      {loading&&<div style={{textAlign:'center',padding:60,color:'#94a3b8'}}><div className="spinner" style={{margin:'0 auto 12px',borderTopColor:'#4f46e5'}}/>Loading…</div>}

      {!loading&&filtered.map(p=><PatientReviewCard key={p.id} p={p}/>)}
    </div>
  )
}
