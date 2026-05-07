import React, { useState, useEffect, useRef, useMemo } from 'react'
import { IcoUpload, IcoPlus, IcoX, IcoCheck, IcoChevD, IcoChevU, IcoSave } from '../../components/icons'
import { sbGet, sbPost } from '../../lib/supabase'
import { N, USD, todayStr, fmtDate } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

const CDT = {
  D0120:'Periodic Evaluation',D0140:'Limited Evaluation',D0150:'Comprehensive Evaluation',
  D0180:'Periodontal Evaluation',D0210:'FMX - Full Series',D0220:'Periapical Image',
  D0272:'Bitewings - Two',D0274:'Bitewings - Four',D0330:'Panoramic Image',
  D0364:'CBCT < 1 Jaw',D0470:'Diagnostic Models',
  D1110:'Prophylaxis - Adult',D1120:'Prophylaxis - Child',D1206:'Fluoride Varnish',
  D1351:'Sealant',D1330:'Oral Hygiene Instructions',
  D2330:'Resin - 1 Surface Anterior',D2331:'Resin - 2 Surfaces Anterior',
  D2391:'Resin - 1 Surface Posterior',D2392:'Resin - 2 Surfaces Posterior',
  D2393:'Resin - 3 Surfaces Posterior',D2394:'Resin - 4+ Surfaces Posterior',
  D2740:'Crown - Full Porcelain',D2750:'Crown - PFM',D2752:'Crown - PF Titanium',
  D2950:'Core Buildup',D2954:'Post & Core',D2991:'Hydroxyapatite',
  D3310:'RCT - Anterior',D3320:'RCT - Premolar',D3330:'RCT - Molar',
  D3346:'Retreatment - Anterior',D3347:'Retreatment - Premolar',D3348:'Retreatment - Molar',
  D4341:'SRP - 4+ Teeth per Quad',D4342:'SRP - 1-3 Teeth per Quad',
  D4346:'Scaling - Gingival Inflammation',D4355:'Full Mouth Debridement',D4910:'Perio Maintenance',
  D5110:'Complete Denture - Max',D5120:'Complete Denture - Mand',
  D6010:'Endosteal Implant',D6057:'Custom Abutment',D6058:'Crown on Implant - Ceramic',
  D6104:'Bone Graft - Implant Site',
  D7140:'Extraction - Erupted',D7210:'Surgical Extraction',
  D7220:'Soft Tissue Impaction',D7230:'Partial Bony Impaction',D7240:'Complete Bony Impaction',
  D9230:'Nitrous Oxide',D9430:'Office Visit',D9910:'Desensitizing Medicament',
  D9944:'Occlusal Guard - Hard',D9945:'Occlusal Guard - Soft',
  'CRN SEAT':'Crown Seat (no charge)','DIAGNOST':'Diagnostic (custom)',
}

const COV = {
  D0120:100,D0140:100,D0150:100,D0180:100,D0210:100,D0274:100,D0330:100,
  D1110:100,D1120:100,D1206:80,D1351:100,
  D2330:80,D2391:80,D2392:80,D2393:80,D2394:80,
  D2740:50,D2750:50,D2950:50,D2954:50,
  D3310:80,D3320:80,D3330:80,D4341:80,D4342:80,D4910:80,
  D6010:50,D7140:80,D7210:80,
}

function detectCarrierGroup(name) {
  if (!name) return 'unknown'
  const c = name.toUpperCase()
  if (c.includes('DELTA'))                                     return 'delta'
  if (c.includes('BCBS')||c.includes('BLUE CROSS')||c.includes('ANTHEM')) return 'bcbs'
  if (c.includes('CIGNA'))                                     return 'cigna'
  if (c.includes('UNITED CONCORDIA'))                          return 'concordia'
  if (c.includes('UNITED')||c.includes('UHC'))                 return 'united'
  if (c.includes('METLIFE'))                                   return 'metlife'
  if (c.includes('GUARDIAN'))                                  return 'guardian'
  if (c.includes('AETNA'))                                     return 'aetna'
  if (c.includes('HUMANA'))                                    return 'humana'
  if (c.includes('ENVOLVE')||c.includes('AMBETTER')||c.includes('MEDICAID')||c.includes('DENTAQUEST')) return 'medicaid'
  return 'unknown'
}

function getCovSuggestion(code, carrier) {
  if (!code) return null
  const grp = detectCarrierGroup(carrier||'')
  if (grp === 'medicaid') return code.startsWith('D0')||code.startsWith('D1') ? 100 : code.startsWith('D6') ? 0 : 80
  if (grp === 'unknown' || !carrier) return COV[code] ?? null
  return COV[code] ?? null
}

function CodeInput({ value, onChange, carrier }) {
  const [q, setQ] = useState(value||'')
  const [open, setOpen] = useState(false)

  const matches = useMemo(() => {
    if (!q || q.length < 2) return []
    const up = q.toUpperCase()
    return Object.entries(CDT).filter(([c,d]) => c.includes(up)||d.toUpperCase().includes(up)).slice(0,8)
  }, [q])

  const incomplete = q && /^D\d{1,3}$/.test(q)
  const unknown    = q && q.startsWith('D') && q.length===5 && !CDT[q]

  return (
    <div style={{position:'relative'}}>
      <input value={q}
        onChange={e=>{const v=e.target.value.toUpperCase();setQ(v);setOpen(true);onChange(v,CDT[v]||'',getCovSuggestion(v,carrier))}}
        onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),150)}
        placeholder="D code"
        style={{width:90,padding:'5px 8px',borderRadius:6,fontSize:12,fontWeight:600,border:`1px solid ${incomplete?'#fbbf24':unknown?'#f87171':'#e2e8f0'}`,background:incomplete?'#fffbeb':unknown?'#fef2f2':'white',outline:'none',boxSizing:'border-box'}}/>
      {incomplete&&<div style={{position:'absolute',top:'100%',left:0,fontSize:9,color:'#d97706',fontWeight:700,whiteSpace:'nowrap',zIndex:10}}>⚠ Incomplete</div>}
      {unknown&&<div style={{position:'absolute',top:'100%',left:0,fontSize:9,color:'#dc2626',fontWeight:700,whiteSpace:'nowrap',zIndex:10}}>⚠ Code not found</div>}
      {open&&matches.length>0&&(
        <div style={{position:'absolute',top:'100%',left:0,zIndex:100,background:'white',border:'1px solid #e2e8f0',borderRadius:8,boxShadow:'0 8px 24px rgba(0,0,0,.1)',minWidth:280,maxHeight:220,overflowY:'auto'}}>
          {matches.map(([code,desc])=>(
            <div key={code} onMouseDown={()=>{setQ(code);onChange(code,desc,getCovSuggestion(code,carrier));setOpen(false)}}
              style={{padding:'7px 10px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',gap:8,alignItems:'center'}}
              onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
              onMouseLeave={e=>e.currentTarget.style.background='white'}>
              <b style={{color:'#1d4ed8',fontSize:12,flexShrink:0}}>{code}</b>
              <span style={{fontSize:11,color:'#475569',flex:1}}>{desc}</span>
              {getCovSuggestion(code,carrier)!==null&&<span style={{fontSize:10,fontWeight:700,color:'#0d9488',flexShrink:0}}>{getCovSuggestion(code,carrier)}% ins</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function PatientCard({p,idx,onUpdate,onDelete,ops}){
  const [exp,setExp]=useState(!p._saved)
  const totalPt=(p.treatments||[]).reduce((s,t)=>s+N(t.pt_amount),0)

  const addTx=()=>onUpdate({...p,treatments:[...(p.treatments||[]),{code:'',desc:'',tooth:'',fee:0,pt_pct:'',pt_amount:0}]})
  const setTx=(i,k,v)=>{
    const txs=(p.treatments||[]).map((t,j)=>{
      if(j!==i)return t
      const u={...t,[k]:v}
      if(k==='fee'||k==='pt_pct'){
        const fee=k==='fee'?N(v):N(t.fee)
        const pct=k==='pt_pct'?N(v):N(t.pt_pct)
        u.pt_amount=Math.round(fee*(1-pct/100)*100)/100
      }
      return u
    })
    onUpdate({...p,treatments:txs,total_expected:txs.reduce((s,t)=>s+N(t.pt_amount),0)})
  }

  return(
    <div style={{background:'white',borderRadius:10,border:`1px solid ${p._saved?'#bbf7d0':'#e2e8f0'}`,marginBottom:6,overflow:'hidden'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer'}} onClick={()=>setExp(e=>!e)}>
        <div style={{width:26,height:26,borderRadius:'50%',background:p._saved?'#dcfce7':'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800,color:p._saved?'#16a34a':'#64748b',flexShrink:0}}>{idx+1}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
            <span style={{fontSize:13,fontWeight:700,color:'#1e293b'}}>{p.patient_name||'New Patient'}</span>
            {p.appt_time&&<span style={{fontSize:10,color:'#94a3b8'}}>{p.appt_time}</span>}
            {p.is_new_patient&&<span style={{fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:99,background:'#dbeafe',color:'#1d4ed8'}}>NEW</span>}
            {p.is_unconfirmed&&<span style={{fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:99,background:'#fef3c7',color:'#d97706'}}>UNCONF</span>}
          </div>
          <div style={{display:'flex',gap:10,marginTop:2,fontSize:10,color:'#64748b',flexWrap:'wrap'}}>
            {p.operatory&&<span>{p.operatory}</span>}
            {p.ins_carrier&&<span>{p.ins_carrier}</span>}
            {totalPt>0&&<span style={{fontWeight:700,color:'#dc2626'}}>Collect: {USD(totalPt)}</span>}
            {(p.treatments||[]).length>0&&<span>{p.treatments.length} proc</span>}
          </div>
        </div>
        <div style={{display:'flex',gap:6,flexShrink:0}}>
          <button onClick={e=>{e.stopPropagation();onDelete()}} style={{background:'#fef2f2',border:'none',color:'#dc2626',borderRadius:6,padding:'3px 8px',cursor:'pointer',fontSize:12}}>✕</button>
          {exp?<IcoChevU size={13} style={{color:'#94a3b8'}}/>:<IcoChevD size={13} style={{color:'#94a3b8'}}/>}
        </div>
      </div>

      {exp&&(
        <div style={{padding:'12px 14px',borderTop:'1px solid #f1f5f9'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:8,marginBottom:12}}>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>PATIENT NAME</div>
              <input value={p.patient_name||''} onChange={e=>onUpdate({...p,patient_name:e.target.value})}
                style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12,boxSizing:'border-box'}}/>
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>OPERATORY</div>
              <select value={p.operatory||''} onChange={e=>onUpdate({...p,operatory:e.target.value})}
                style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
                <option value="">Select…</option>
                {ops.map(o=><option key={o}>{o}</option>)}
                <option value="__new__">+ New operatory</option>
              </select>
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>INSURANCE CARRIER</div>
              <input value={p.ins_carrier||''} onChange={e=>onUpdate({...p,ins_carrier:e.target.value})}
                style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12,boxSizing:'border-box'}} placeholder="e.g. Delta Dental"/>
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>STATUS</div>
              <select value={p.ins_status||''} onChange={e=>onUpdate({...p,ins_status:e.target.value})}
                style={{width:'100%',padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
                <option value="">—</option>
                <option value="ACTIVE INS">Active Insurance</option>
                <option value="INACTIVE INS">Inactive</option>
                <option value="PRIVATE PAY">Private Pay</option>
                <option value="NO INSURANCE">No Insurance</option>
              </select>
            </div>
          </div>

          {/* Procedure table */}
          <div style={{marginBottom:8}}>
            <div style={{display:'grid',gridTemplateColumns:'100px 1fr 65px 75px 60px 75px 24px',gap:5,marginBottom:4}}>
              {['Code','Description','Tooth','Fee','Ins %','Pt Owes',''].map(h=><div key={h} style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.3}}>{h}</div>)}
            </div>
            {(p.treatments||[]).map((t,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'100px 1fr 65px 75px 60px 75px 24px',gap:5,marginBottom:5,alignItems:'start'}}>
                <CodeInput value={t.code} carrier={p.ins_carrier}
                  onChange={(code,desc,cov)=>{setTx(i,'code',code);if(desc&&!t.desc)setTx(i,'desc',desc);if(cov!==null&&t.pt_pct==='')setTx(i,'pt_pct',100-cov)}}/>
                <input value={t.desc||CDT[t.code]||''} onChange={e=>setTx(i,'desc',e.target.value)} placeholder="Description"
                  style={{padding:'5px 7px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:11,width:'100%',boxSizing:'border-box'}}/>
                <input value={t.tooth||''} onChange={e=>setTx(i,'tooth',e.target.value)} placeholder="#"
                  style={{padding:'5px 7px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:11,width:'100%',boxSizing:'border-box',textAlign:'center'}}/>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:5,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'#94a3b8',pointerEvents:'none'}}>$</span>
                  <input type="number" value={t.fee||''} onChange={e=>setTx(i,'fee',e.target.value)} placeholder="0.00"
                    style={{padding:'5px 5px 5px 14px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:11,width:'100%',boxSizing:'border-box'}}/>
                </div>
                <input type="number" min="0" max="100" value={t.pt_pct!==undefined&&t.pt_pct!==''?t.pt_pct:''} onChange={e=>setTx(i,'pt_pct',e.target.value)} placeholder="0"
                  style={{padding:'5px 7px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:11,width:'100%',boxSizing:'border-box',textAlign:'center',background:t.pt_pct===0||t.pt_pct==='0'?'#f0fdf4':'white'}}/>
                <div style={{padding:'5px 7px',borderRadius:6,background:'#f8fafc',border:'1px solid #e2e8f0',fontSize:11,fontWeight:700,color:N(t.pt_amount)>0?'#dc2626':'#94a3b8',textAlign:'right'}}>
                  ${N(t.pt_amount).toFixed(2)}
                </div>
                <button onClick={()=>{const txs=(p.treatments||[]).filter((_,j)=>j!==i);onUpdate({...p,treatments:txs,total_expected:txs.reduce((s,tx)=>s+N(tx.pt_amount),0)})}}
                  style={{background:'none',border:'none',cursor:'pointer',color:'#dc2626',fontSize:16,padding:0,lineHeight:1}}>×</button>
              </div>
            ))}
            <button onClick={addTx} style={{display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:6,background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',fontWeight:600,fontSize:11,cursor:'pointer',marginTop:4}}>
              <IcoPlus size={11}/> Add Procedure
            </button>
          </div>

          <div style={{display:'flex',alignItems:'center',gap:10,paddingTop:8,borderTop:'1px solid #f1f5f9'}}>
            <input value={p.claim_notes?.[0]||''} onChange={e=>onUpdate({...p,claim_notes:[e.target.value]})}
              placeholder="Claim notes / special instructions…" style={{flex:1,padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:11}}/>
            <div style={{fontSize:13,fontWeight:800,color:totalPt>0?'#dc2626':'#94a3b8',whiteSpace:'nowrap'}}>
              Collect: {USD(totalPt)}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RidgeviewPortal({user,notify}){
  const [date,setDate]=useState(todayStr())
  const [office,setOffice]=useState(OFFICES[0])
  const [patients,setPatients]=useState([])
  const [uploading,setUploading]=useState(false)
  const [saving,setSaving]=useState(false)
  const [lastSaved,setLastSaved]=useState(null)
  const [parsedInfo,setParsedInfo]=useState(null)
  const fileRef=useRef(null)

  useEffect(()=>{
    sbGet('collection_patients',`office=eq.${encodeURIComponent(office)}&date=eq.${date}&order=operatory,patient_name`)
      .then(rows=>{if(rows.length)setPatients(rows.map(r=>({...r,_saved:true})))})
      .catch(()=>{})
  },[date,office])

  const ops=useMemo(()=>[...new Set(patients.map(p=>p.operatory).filter(Boolean))].sort(),[patients])

  const handleUpload=async(e)=>{
    const file=e.target.files[0]; if(!file)return
    setUploading(true)
    try{
      const {parseSchedulePdf}=await import('../../lib/scheduleParser')
      const result=await parseSchedulePdf(file)
      const {appointments,date:pd,office:po}=result
      if(po&&po!==office){const ok=window.confirm(`Schedule is for "${po}" but you selected "${office}". Switch to ${po}?`);if(ok)setOffice(po)}
      if(pd&&pd!==date){const ok=window.confirm(`Schedule date is ${pd} but you selected ${date}. Switch to ${pd}?`);if(ok)setDate(pd)}
      setPatients(prev=>{
        const ex=new Set(prev.map(p=>p.patient_name_norm))
        const newPts=appointments.filter(a=>!ex.has(a.patient_name_norm)).map(a=>({...a,id:'cp_rdg_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),_saved:false}))
        return[...prev,...newPts]
      })
      setParsedInfo({date:pd,office:po,count:appointments.length})
      notify(`Loaded ${appointments.length} patients from schedule`)
    }catch(err){notify('Upload failed: '+err.message,'error')}
    setUploading(false); if(fileRef.current)fileRef.current.value=''
  }

  const saveAll=async()=>{
    setSaving(true)
    try{
      for(const p of patients){
        const row={...p,office,date,total_expected:(p.treatments||[]).reduce((s,t)=>s+N(t.pt_amount),0),updated_at:new Date().toISOString(),created_at:p.created_at||new Date().toISOString()}
        delete row._saved
        await sbPost('collection_patients',row,true)
      }
      setPatients(prev=>prev.map(p=>({...p,_saved:true})))
      setLastSaved(new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}))
      notify('All patients saved ✓')
    }catch(err){notify('Save failed: '+err.message,'error')}
    setSaving(false)
  }

  const addBlank=()=>setPatients(prev=>[...prev,{id:'cp_rdg_'+Date.now(),patient_name:'',patient_name_norm:'',operatory:ops[0]||'',ins_carrier:'',ins_status:'',treatments:[],total_expected:0,amount_collected:0,status:'pending',flags_total:0,flags_done:0,claim_notes:[],appt_time:'',is_new_patient:false,_saved:false}])
  const upd=(id,u)=>setPatients(prev=>prev.map(p=>p.id===id?{...u,_saved:false}:p))
  const del=(id)=>{if(window.confirm('Remove this patient?'))setPatients(prev=>prev.filter(p=>p.id!==id))}

  const totalCollect=patients.reduce((s,p)=>s+(p.treatments||[]).reduce((t,tx)=>t+N(tx.pt_amount),0),0)
  const unsaved=patients.filter(p=>!p._saved).length
  const DAY=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(date+'T12:00:00').getDay()]

  return(
    <div style={{maxWidth:1000,margin:'0 auto',padding:'20px 16px 100px'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',borderRadius:14,padding:'20px 24px',marginBottom:20,color:'white'}}>
        <div style={{fontSize:10,opacity:.5,fontWeight:700,letterSpacing:2,marginBottom:4}}>RIDGEVIEW BILLING PORTAL</div>
        <h1 style={{fontSize:20,fontWeight:800,margin:'0 0 14px'}}>Collection Sheet Entry</h1>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
          <div>
            <div style={{fontSize:9,opacity:.6,letterSpacing:1,marginBottom:3}}>OFFICE</div>
            <select value={office} onChange={e=>{setOffice(e.target.value);setPatients([])}}
              style={{padding:'7px 12px',borderRadius:8,border:'none',background:'rgba(255,255,255,.15)',color:'white',fontWeight:700,fontSize:13,cursor:'pointer'}}>
              {OFFICES.map(o=><option key={o} style={{color:'#1e293b'}}>{o}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:9,opacity:.6,letterSpacing:1,marginBottom:3}}>DATE</div>
            <input type="date" value={date} onChange={e=>{setDate(e.target.value);setPatients([])}}
              style={{padding:'7px 12px',borderRadius:8,border:'none',background:'rgba(255,255,255,.15)',color:'white',fontWeight:700,fontSize:13}}/>
          </div>
          <div style={{marginLeft:'auto',textAlign:'right'}}>
            <div style={{fontSize:11,opacity:.8,fontWeight:600}}>{DAY} · {patients.length} patients</div>
            <div style={{fontSize:13,fontWeight:800,color:'#86efac'}}>{USD(totalCollect)} to collect</div>
            {lastSaved&&<div style={{fontSize:10,opacity:.5,marginTop:2}}>Saved {lastSaved}</div>}
          </div>
        </div>
      </div>

      {/* Action bar */}
      <div style={{display:'flex',gap:10,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
        <label style={{display:'flex',alignItems:'center',gap:7,padding:'9px 18px',borderRadius:10,background:uploading?'#5eead4':'#0d9488',color:'white',fontWeight:700,fontSize:13,cursor:'pointer',flexShrink:0}}>
          <IcoUpload size={14}/> {uploading?'Parsing…':'Upload Schedule PDF'}
          <input ref={fileRef} type="file" accept=".pdf" onChange={handleUpload} style={{display:'none'}} disabled={uploading}/>
        </label>
        <button onClick={addBlank} style={{display:'flex',alignItems:'center',gap:6,padding:'9px 16px',borderRadius:10,background:'white',color:'#1d4ed8',border:'1px solid #bfdbfe',fontWeight:700,fontSize:13,cursor:'pointer'}}>
          <IcoPlus size={13}/> Add Patient
        </button>
        {unsaved>0&&<div style={{padding:'7px 14px',borderRadius:8,background:'#fffbeb',border:'1px solid #fde68a',fontSize:12,color:'#d97706',fontWeight:600}}>
          {unsaved} unsaved change{unsaved!==1?'s':''}
        </div>}
        <button onClick={saveAll} disabled={saving||!patients.length}
          style={{marginLeft:'auto',display:'flex',alignItems:'center',gap:7,padding:'10px 24px',borderRadius:10,background:saving?'#86efac':'#16a34a',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:saving||!patients.length?'not-allowed':'pointer',flexShrink:0}}>
          <IcoSave size={14}/> {saving?'Saving…':'Save All'}
        </button>
      </div>

      {parsedInfo&&<div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:12,color:'#15803d',fontWeight:600}}>
        ✓ {parsedInfo.count} patients loaded from schedule{parsedInfo.office?' · '+parsedInfo.office:''}{parsedInfo.date?' · '+fmtDate(parsedInfo.date):''}
      </div>}

      {patients.length===0?(
        <div style={{textAlign:'center',padding:'60px 20px',background:'white',borderRadius:12,border:'2px dashed #e2e8f0'}}>
          <div style={{fontSize:40,marginBottom:12}}>📅</div>
          <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:6}}>No patients yet for {date}</div>
          <p style={{fontSize:13,color:'#94a3b8',marginBottom:20}}>Upload the Dentrix schedule PDF or add patients manually.</p>
          <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'11px 24px',borderRadius:10,background:'#0d9488',color:'white',fontWeight:700,fontSize:14,cursor:'pointer'}}>
            <IcoUpload size={16}/> Upload Schedule PDF
            <input type="file" accept=".pdf" onChange={handleUpload} style={{display:'none'}}/>
          </label>
        </div>
      ):(
        <>
          {/* Column hint */}
          <div style={{display:'grid',gridTemplateColumns:'100px 1fr 65px 75px 60px 75px 24px',gap:5,padding:'4px 54px 4px 54px',marginBottom:4}}>
            {['Code','Description','Tooth','Fee','Ins %','Pt Owes',''].map(h=><div key={h} style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.3}}>{h}</div>)}
          </div>
          {patients.map((p,i)=>(
            <PatientCard key={p.id} p={p} idx={i} ops={ops} onUpdate={u=>upd(p.id,u)} onDelete={()=>del(p.id)}/>
          ))}
        </>
      )}

      {/* Sticky footer */}
      {patients.length>0&&(
        <div style={{position:'fixed',bottom:0,left:0,right:0,background:'white',borderTop:'1px solid #e2e8f0',padding:'12px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',zIndex:50,boxShadow:'0 -4px 20px rgba(0,0,0,.08)'}}>
          <div style={{fontSize:13,color:'#64748b'}}><b>{patients.length}</b> patients · <b style={{color:'#dc2626'}}>{USD(totalCollect)}</b> to collect · {patients.filter(p=>p._saved).length} saved</div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            {unsaved>0&&<span style={{fontSize:12,color:'#d97706',fontWeight:600}}>⚠ {unsaved} unsaved</span>}
            <button onClick={saveAll} disabled={saving}
              style={{padding:'10px 28px',borderRadius:10,background:saving?'#86efac':'#16a34a',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:'pointer'}}>
              {saving?'Saving…':'Save All to Portal'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
