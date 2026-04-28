import React, { useState, useEffect, useRef } from 'react'
import { IcoX, IcoCheck, IcoAlert, IcoUpload, IcoRefresh, IcoChevD, IcoChevU } from '../../components/icons'
import { LBL } from '../../components/ui'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'
import { todayStr, USD, N } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

// ── Parser ────────────────────────────────────────────────────────────────
function normalizePatientName(raw) {
  if (!raw) return ''
  let name = String(raw).replace(/\n/g,' ').replace(/\t/g,' ').trim()
  name = name.replace(/\([^)]+\)/g,'').trim()
  name = name.replace(/[^A-Za-z\s\-']/g,'')
  return name.split(/\s+/).join(' ').toUpperCase()
}

function parseCollectionSheetFull(data) {
  if (!data || data.length < 2) return []
  const hasPG = data.slice(0,10).some(row => String(row[1]||'').trim() === 'PG')
  const nameCol  = hasPG ? 2  : 1
  const balCol   = hasPG ? 3  : 2
  const treatCol = hasPG ? 4  : 3
  const covCol   = hasPG ? 5  : 4
  const feeCol   = hasPG ? 6  : 5
  const insFeeCol= hasPG ? 7  : 6
  const pctCol   = hasPG ? 8  : 7
  const amtCol   = hasPG ? 10 : 10
  const tcCol    = hasPG ? 11 : 11

  const patients = []
  let currentOp  = ''
  let current    = null

  for (const row of data) {
    if (!hasPG && row[0] && /DR|OP\d/i.test(String(row[0]||''))) {
      currentOp = String(row[0]).trim()
    }
    const nameVal  = row[nameCol] != null ? String(row[nameCol]) : null
    const treatVal = row[treatCol] != null ? String(row[treatCol]) : ''
    const tcVal    = row[tcCol]
    const isBalRow = /Balance B\/[fF]/.test(treatVal) && nameVal != null

    if (isBalRow) {
      if (current) patients.push(current)
      const norm = normalizePatientName(nameVal)
      if (norm && norm !== 'NAME' && norm.length > 2) {
        const bal = typeof row[balCol]==='number' ? row[balCol] : 0
        current = {
          id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
          patient_name: nameVal.trim(),
          patient_name_norm: norm,
          operatory: currentOp,
          balance_bf: bal,
          total_expected: typeof tcVal==='number' ? tcVal : 0,
          treatments: [],
        }
      }
    } else if (current && treatVal && !/^\s*$/.test(treatVal) && !/Balance B\/[fF]/.test(treatVal)) {
      const fee  = typeof row[feeCol]==='number'    ? row[feeCol]    : 0
      const amt  = typeof row[amtCol]==='number'    ? row[amtCol]    : 0
      const pct  = typeof row[pctCol]==='number'    ? row[pctCol]    : 0
      const insF = typeof row[insFeeCol]==='number' ? row[insFeeCol] : 0
      if (treatVal.trim() && fee > 0) {
        current.treatments.push({
          desc: treatVal.trim(),
          coverage: row[covCol] ? String(row[covCol]).trim() : '',
          fee, ins_fee: insF, pct, amount: amt,
        })
      }
      if (typeof tcVal==='number') current.total_expected = tcVal
    }
  }
  if (current) patients.push(current)
  return patients
}

// ── Status config ─────────────────────────────────────────────────────────
const STATUS_META = {
  pending:   { label: 'Pending',   color: '#d97706', bg: '#fef3c7', icon: '⏳' },
  collected: { label: 'Collected', color: '#16a34a', bg: '#dcfce7', icon: '✓'  },
  partial:   { label: 'Partial',   color: '#0891b2', bg: '#e0f2fe', icon: '½'  },
  waived:    { label: 'Waived',    color: '#7c3aed', bg: '#f5f3ff', icon: '○'  },
  issue:     { label: 'Issue',     color: '#dc2626', bg: '#fee2e2', icon: '!'  },
}

const StatusBadge = ({ status }) => {
  const m = STATUS_META[status] || STATUS_META.pending
  return <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99, background:m.bg, color:m.color, whiteSpace:'nowrap' }}>{m.icon} {m.label}</span>
}

const CovBadge = ({ cov }) => {
  const covered    = /covered/i.test(cov) && !/not covered|inactive/i.test(cov)
  const inactive   = /inactive/i.test(cov)
  const notCovered = /not covered/i.test(cov)
  const bg    = covered?'#dcfce7':notCovered?'#fee2e2':inactive?'#f3f4f6':'#fef3c7'
  const color = covered?'#16a34a':notCovered?'#dc2626':inactive?'#6b7280':'#d97706'
  const label = covered?'Covered':notCovered?'Not Covered':inactive?'Inactive':cov||'—'
  return <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:99, background:bg, color }}>{label}</span>
}

// ═════════════════════════════════════════════════════════════════════════════
// PAGE
// ═════════════════════════════════════════════════════════════════════════════
export default function CollectionTrackerPage({ user, isManager }) {
  const [date,       setDate]       = useState(todayStr())
  const [office,     setOffice]     = useState(user.office || OFFICES[0])
  const [patients,   setPatients]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [tab,        setTab]        = useState('operatory')
  const [selOp,      setSelOp]      = useState('all')
  const [selStatus,  setSelStatus]  = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [editingId,  setEditingId]  = useState(null)
  const [editAmt,    setEditAmt]    = useState('')
  const [editNote,   setEditNote]   = useState('')
  const [editStatus, setEditStatus] = useState('collected')
  const [toast,      setToast]      = useState(null)
  const pollRef     = useRef(null)
  const fileInputRef = useRef(null)

  const notify = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000) }

  const loadPatients = async (silent=false) => {
    if (!silent) setLoading(true)
    try {
      const rows = await sbGet('collection_patients',
        `office=eq.${encodeURIComponent(office)}&date=eq.${date}&order=operatory,patient_name`)
      setPatients(rows)
    } catch(e) { if(!silent) notify('Load failed: '+e.message,'error') }
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    loadPatients()
    pollRef.current = setInterval(() => loadPatients(true), 15000)
    return () => clearInterval(pollRef.current)
  }, [date, office])

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, {type:'array'})

      const d       = new Date(date+'T12:00:00')
      const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]
      const month   = d.toLocaleString('en-US',{month:'long'})
      const day     = d.getDate()
      const sheetName = wb.SheetNames.find(n => n.includes(dayName)&&n.includes(month)&&n.includes(String(day))) || wb.SheetNames[0]

      const ws   = wb.Sheets[sheetName]
      const data = XLSX.utils.sheet_to_json(ws, {header:1, defval:null})
      const parsed = parseCollectionSheetFull(data)

      if (parsed.length === 0) { notify('No patients found in "'+sheetName+'"','error'); setUploading(false); return }

      // Delete existing
      const existing = await sbGet('collection_patients', `office=eq.${encodeURIComponent(office)}&date=eq.${date}&select=id`)
      for (const row of existing) await sbDel('collection_patients', 'id=eq.'+row.id)

      // Insert new
      for (const p of parsed) {
        await sbPost('collection_patients', {
          id: p.id, office, date,
          operatory:         p.operatory,
          patient_name:      p.patient_name,
          patient_name_norm: p.patient_name_norm,
          balance_bf:        p.balance_bf,
          total_expected:    p.total_expected,
          treatments:        p.treatments,
          status:            'pending',
          amount_collected:  0,
          note:              '',
          collected_by:      '',
          collected_at:      null,
          created_at:        new Date().toISOString(),
          updated_at:        new Date().toISOString(),
        }, true)
      }

      await loadPatients()
      notify('Loaded '+parsed.length+' patients from "'+sheetName+'"')
    } catch(e) { notify('Upload failed: '+e.message,'error') }
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const saveCollection = async (patient) => {
    const amt = N(editAmt)
    let st = editStatus
    if (st==='collected' && amt>0 && amt<patient.total_expected) st='partial'
    const updated = { status:st, amount_collected:amt, note:editNote, collected_by:user.name, collected_at:new Date().toISOString(), updated_at:new Date().toISOString() }
    try {
      await sbPost('collection_patients', {...patient,...updated}, true)
      setPatients(prev => prev.map(p => p.id===patient.id ? {...p,...updated} : p))
      notify('Saved ✓')
      setEditingId(null)
    } catch(e) { notify('Save failed: '+e.message,'error') }
  }

  const operatories  = ['all', ...Array.from(new Set(patients.map(p=>p.operatory).filter(Boolean))).sort()]
  const totalExpected= patients.filter(p=>p.total_expected>0).reduce((s,p)=>s+p.total_expected,0)
  const totalColl    = patients.reduce((s,p)=>s+N(p.amount_collected),0)
  const totalGap     = Math.round((totalExpected-totalColl)*100)/100
  const byStatus     = Object.fromEntries(Object.keys(STATUS_META).map(k=>[k, patients.filter(p=>p.status===k).length]))

  const filtered = patients.filter(p => {
    if (selOp!=='all' && p.operatory!==selOp) return false
    if (selStatus!=='all' && p.status!==selStatus) return false
    return true
  })

  const PatientCard = ({ p }) => {
    const isExpanded = expandedId===p.id
    const isEditing  = editingId===p.id
    const borderColor= p.status==='pending'&&p.total_expected>0?'#fde68a':p.status==='collected'?'#bbf7d0':p.status==='issue'?'#fecaca':'#e2e8f0'

    const startEdit = () => {
      setEditingId(p.id)
      setEditAmt(p.amount_collected>0 ? String(p.amount_collected) : p.total_expected>0 ? String(p.total_expected) : '')
      setEditNote(p.note||'')
      setEditStatus(p.status==='pending'?'collected':p.status)
    }

    return (
      <div style={{background:'white',borderRadius:12,border:`1px solid ${borderColor}`,marginBottom:10,overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',padding:'12px 16px',gap:10,cursor:'pointer'}} onClick={()=>setExpandedId(isExpanded?null:p.id)}>
          <div style={{flex:1}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:4}}>
              <span style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>{p.patient_name}</span>
              <StatusBadge status={p.status}/>
              {p.operatory&&<span style={{fontSize:10,fontWeight:700,color:'#7c3aed',background:'#f5f3ff',padding:'2px 8px',borderRadius:99}}>{p.operatory}</span>}
            </div>
            <div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:12,color:'#64748b'}}>
              {p.total_expected>0 && <span>Expected: <b style={{color:'#1e293b'}}>{USD(p.total_expected)}</b></span>}
              {p.amount_collected>0 && <span>Collected: <b style={{color:'#16a34a'}}>{USD(p.amount_collected)}</b></span>}
              {p.total_expected===0 && <span style={{color:'#94a3b8'}}>$0 owed — insurance covers</span>}
              {p.balance_bf!==0 && <span>Bal B/F: <b style={{color:p.balance_bf>0?'#dc2626':'#16a34a'}}>{USD(p.balance_bf)}</b></span>}
              {p.collected_by && <span>· {p.collected_by}</span>}
            </div>
            {p.note && <div style={{fontSize:11,color:'#7c3aed',marginTop:4,fontStyle:'italic'}}>📝 {p.note}</div>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
            {p.total_expected>0 && !isEditing && (
              <button onClick={e=>{e.stopPropagation();startEdit()}} style={{padding:'6px 14px',borderRadius:8,background:p.status==='pending'?'#7c3aed':'#f1f5f9',color:p.status==='pending'?'white':'#475569',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                {p.status==='pending'?'Collect':'Update'}
              </button>
            )}
            {isExpanded?<IcoChevU size={16} style={{color:'#94a3b8'}}/>:<IcoChevD size={16} style={{color:'#94a3b8'}}/>}
          </div>
        </div>

        {/* Treatment breakdown */}
        {isExpanded && !isEditing && p.treatments && p.treatments.length>0 && (
          <div style={{padding:'0 16px 14px',borderTop:'1px solid #f1f5f9'}}>
            <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:1,margin:'10px 0 8px'}}>TREATMENT BREAKDOWN</div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'#f8fafc'}}>
                  {['Procedure','Coverage','Fee','Ins Fee','Pt %','Pt Owes'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {p.treatments.map((t,i)=>(
                    <tr key={i} style={{borderBottom:'1px solid #f8fafc'}}>
                      <td style={{padding:'6px 8px',color:'#1e293b',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={t.desc}>{t.desc}</td>
                      <td style={{padding:'6px 8px'}}><CovBadge cov={t.coverage}/></td>
                      <td style={{padding:'6px 8px',color:'#475569'}}>{USD(t.fee)}</td>
                      <td style={{padding:'6px 8px',color:'#475569'}}>{USD(t.ins_fee)}</td>
                      <td style={{padding:'6px 8px',color:'#475569'}}>{Math.round((t.pct||0)*100)}%</td>
                      <td style={{padding:'6px 8px',fontWeight:t.amount>0?700:400,color:t.amount>0?'#dc2626':'#94a3b8'}}>{t.amount>0?USD(t.amount):'—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Collection entry */}
        {isEditing && (
          <div style={{padding:'14px 16px',borderTop:'1px solid #e2e8f0',background:'#f8fafc'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div>
                <label style={LBL}>Amount Collected ($)</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#94a3b8',fontSize:13,pointerEvents:'none'}}>$</span>
                  <input type="number" min="0" step="0.01" className="ic" style={{paddingLeft:22}} value={editAmt} onChange={e=>setEditAmt(e.target.value)} placeholder={p.total_expected.toFixed(2)} autoFocus/>
                </div>
                {N(editAmt)>0 && N(editAmt)<p.total_expected && (
                  <div style={{fontSize:11,color:'#d97706',fontWeight:600,marginTop:3}}>⚠ ${(p.total_expected-N(editAmt)).toFixed(2)} short</div>
                )}
              </div>
              <div>
                <label style={LBL}>Status</label>
                <select className="ic" value={editStatus} onChange={e=>setEditStatus(e.target.value)}>
                  <option value="collected">Collected</option>
                  <option value="partial">Partial</option>
                  <option value="waived">Waived</option>
                  <option value="issue">Issue</option>
                </select>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={LBL}>Note (if not fully collected)</label>
                <input className="ic" value={editNote} onChange={e=>setEditNote(e.target.value)} placeholder="e.g. Will pay at next visit, card declined…"/>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setEditingId(null)} style={{padding:'8px 18px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button onClick={()=>saveCollection(p)} style={{padding:'8px 20px',borderRadius:8,background:'#7c3aed',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>Save</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{maxWidth:1000,margin:'0 auto',padding:'24px 20px 60px'}}>
      {toast && <div style={{position:'fixed',top:20,right:20,zIndex:9999,padding:'12px 20px',borderRadius:12,boxShadow:'0 10px 30px rgba(0,0,0,.15)',color:'white',fontSize:13,fontWeight:600,background:toast.type==='error'?'#ef4444':'#10b981',maxWidth:360}}>{toast.msg}</div>}

      {/* Header */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',margin:0}}>Collection Tracker</h1>
          <p style={{color:'#94a3b8',fontSize:13,marginTop:4}}>Live daily collections — all staff see updates in real time · auto-refreshes every 15s</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button onClick={()=>loadPatients()} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>
            <IcoRefresh size={14}/> Refresh
          </button>
          <label style={{display:'flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:10,background:uploading?'#c4b5fd':'#7c3aed',color:'white',fontWeight:700,fontSize:13,cursor:uploading?'not-allowed':'pointer'}}>
            <IcoUpload size={14}/> {uploading?'Loading…':'Upload Collection Sheet'}
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{display:'none'}} disabled={uploading}/>
          </label>
        </div>
      </div>

      {/* Date + office */}
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'14px 18px',marginBottom:16,display:'flex',gap:14,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div style={{flex:'1 1 140px'}}>
          <label style={LBL}>Date</label>
          <input type="date" className="ic" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
        {isManager && (
          <div style={{flex:'1 1 140px'}}>
            <label style={LBL}>Office</label>
            <select className="ic" value={office} onChange={e=>setOffice(e.target.value)}>
              {OFFICES.map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        )}
        <div style={{fontSize:12,color:'#94a3b8',paddingBottom:2}}>
          {patients.length>0 ? `${patients.length} patients · refreshes automatically` : 'No patients loaded'}
        </div>
      </div>

      {/* Summary */}
      {patients.length>0 && (
        <div style={{background:'linear-gradient(135deg,#7c3aed,#9333ea)',borderRadius:12,padding:'16px 24px',marginBottom:16,color:'white',display:'flex',flexWrap:'wrap',gap:0}}>
          {[
            ['EXPECTED',   USD(totalExpected),    null],
            ['COLLECTED',  USD(totalColl),         null],
            ['GAP',        USD(Math.abs(totalGap)), totalGap>0?'#f87171':'#86efac'],
            ['PENDING',    patients.filter(p=>p.status==='pending'&&p.total_expected>0).length, null],
            ['COLLECTED',  byStatus.collected||0,  null],
            ['ISSUES',     (byStatus.issue||0)+(byStatus.partial||0), (byStatus.issue||0)+(byStatus.partial||0)>0?'#f87171':null],
          ].map(([l,v,c],i)=>(
            <div key={i} style={{flex:'1 1 100px',padding:'0 14px',borderLeft:i>0?'1px solid rgba(255,255,255,.2)':'none'}}>
              <div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div>
              <div style={{fontSize:18,fontWeight:800,color:c||'white'}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && patients.length===0 && (
        <div style={{textAlign:'center',padding:'60px 20px',background:'white',borderRadius:12,border:'2px dashed #e2e8f0'}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:6}}>No patients loaded for {date}</div>
          <p style={{fontSize:13,color:'#94a3b8',marginBottom:20}}>Upload the Ridgeview collection sheet to load today's patients. All staff will see them instantly.</p>
          <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'11px 24px',borderRadius:10,background:'#7c3aed',color:'white',fontWeight:700,fontSize:14,cursor:'pointer'}}>
            <IcoUpload size={16}/> Upload Collection Sheet
            <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} style={{display:'none'}}/>
          </label>
        </div>
      )}

      {loading && <div style={{textAlign:'center',padding:60,color:'#94a3b8'}}><div className="spinner" style={{margin:'0 auto 12px',borderTopColor:'#7c3aed'}}/>Loading patients…</div>}

      {/* Tabs + filters */}
      {patients.length>0 && (
        <>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:10}}>
            <div style={{display:'flex',gap:4,background:'white',padding:4,borderRadius:10,border:'1px solid #e2e8f0'}}>
              {[['operatory','By Operatory'],['status','By Status']].map(([t,l])=>(
                <button key={t} onClick={()=>setTab(t)} style={{padding:'7px 16px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:tab===t?'#7c3aed':'transparent',color:tab===t?'white':'#64748b'}}>{l}</button>
              ))}
            </div>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {tab==='operatory' && operatories.length>2 && (
                <select className="ic" style={{width:'auto',fontSize:12}} value={selOp} onChange={e=>setSelOp(e.target.value)}>
                  <option value="all">All Operatories</option>
                  {operatories.filter(o=>o!=='all').map(o=><option key={o}>{o}</option>)}
                </select>
              )}
              <select className="ic" style={{width:'auto',fontSize:12}} value={selStatus} onChange={e=>setSelStatus(e.target.value)}>
                <option value="all">All Statuses</option>
                {Object.entries(STATUS_META).map(([k,m])=>(
                  <option key={k} value={k}>{m.icon} {m.label} ({byStatus[k]||0})</option>
                ))}
              </select>
            </div>
          </div>

          {tab==='operatory' ? (
            (() => {
              const ops = selOp==='all'
                ? Array.from(new Set(filtered.map(p=>p.operatory||'Unassigned'))).sort()
                : [selOp]
              return ops.map(op => {
                const opPts = filtered.filter(p=>(p.operatory||'Unassigned')===op)
                if (opPts.length===0) return null
                const opExp  = opPts.filter(p=>p.total_expected>0).reduce((s,p)=>s+p.total_expected,0)
                const opColl = opPts.reduce((s,p)=>s+N(p.amount_collected),0)
                return (
                  <div key={op} style={{marginBottom:24}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                      <span style={{fontSize:12,fontWeight:800,color:'#7c3aed',letterSpacing:1}}>{op.toUpperCase()}</span>
                      <span style={{fontSize:11,color:'#94a3b8'}}>{opPts.length} patients</span>
                      {opExp>0 && <span style={{fontSize:11,color:'#64748b'}}>Expected {USD(opExp)} · Collected {USD(opColl)}</span>}
                      <div style={{flex:1,height:1,background:'#e2e8f0'}}/>
                    </div>
                    {opPts.map(p=><PatientCard key={p.id} p={p}/>)}
                  </div>
                )
              })
            })()
          ) : (
            Object.entries(STATUS_META).map(([status,meta]) => {
              const sPts = filtered.filter(p=>p.status===status)
              if (sPts.length===0) return null
              return (
                <div key={status} style={{marginBottom:24}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                    <span style={{fontSize:12,fontWeight:800,letterSpacing:1,color:meta.color}}>{meta.icon} {meta.label.toUpperCase()}</span>
                    <span style={{fontSize:11,color:'#94a3b8'}}>{sPts.length} patient{sPts.length!==1?'s':''}</span>
                    <div style={{flex:1,height:1,background:'#e2e8f0'}}/>
                  </div>
                  {sPts.map(p=><PatientCard key={p.id} p={p}/>)}
                </div>
              )
            })
          )}
        </>
      )}
    </div>
  )
}
