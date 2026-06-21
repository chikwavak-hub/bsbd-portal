import React, { useState, useMemo, useRef, useEffect } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'
import { sbDel, sbGet } from '../../lib/supabase'
import { importTcExcel } from '../../lib/tcImport'
import { isBigCase, getBigCaseCadence, BIG_CASE_PROTOCOL, BIG_CASE_REASONS } from './BigCases'
import TcAnalytics from './TcAnalytics'

// ── Constants ──────────────────────────────────────────────────────────────
const OFFICES    = ['Brainerd','Calhoun','Dalton','McCallie']
const EXAM_TYPES = ['Comp/FMX','Limited/PA','Consult','PANO','LOE','Comp/2bws','TX/Fillings']
const HAS_APPT   = ['Yes','No','Partial']
const EMAIL_OPTS = ['Yes','No','Not needed']
const CALL_METHODS   = ['Call','Text','Email','Voicemail','In Person']
const CALL_OUTCOMES  = ['No answer','Left voicemail','Spoke to patient','Scheduled','Declined','Call back later','Sent info']
const BARRIER_TYPES  = ['','CareCredit pending','Sunbit pending','Insurance issue','Re-present needed','Patient deciding','No finances','Other']
const MONTHS_EN      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const FINANCE_KW     = ['carecredit','sunbit','finance','thinking','not financially','not ready','will call','denied']
const DOCTORS        = ['Dr. E','Dr. Chikwava','Dr. Phillips','Laura','Melissa']

// ── Helpers ────────────────────────────────────────────────────────────────
const monthLabel = m => { if(!m)return''; const[y,mo]=m.split('-'); return MONTHS_EN[parseInt(mo)-1]+' '+y }
const fmtDate    = d => { if(!d)return''; const s=new Date(d); return isNaN(s)?d:s.toLocaleDateString('en-US',{month:'short',day:'numeric'}) }
const fmtPhone   = v => { const d=(v||'').replace(/\D/g,'').slice(0,10); if(!d)return''; if(d.length<=3)return d; if(d.length<=6)return'('+d.slice(0,3)+') '+d.slice(3); return'('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6) }
const detectFin  = (n='',r='') => FINANCE_KW.some(k=>(n+' '+r).toLowerCase().includes(k))

// Priority for sorting: 1=needs action, 2=needs call, 3=big case pending, 4=has appt, 5=complete
function getPriority(p) {
  if (N(p.tx_completed) >= N(p.total_tx_cost)*0.9 && N(p.tx_completed)>0) return 5
  if (p.has_appt==='Yes' && !isBigCase(p)) return 4
  if (isBigCase(p)) {
    const c = getBigCaseCadence(p)
    if (c.priority===1) return 1
    if (c.priority===2) return 2
    return 3
  }
  const days = p.dos ? Math.floor((new Date(todayStr())-new Date(p.dos))/86400000) : 0
  if (p.has_appt==='No' || !p.appt_1) {
    const lastCall = p.call_3_date||p.call_2_date||p.call_1_date
    if (!lastCall) return days>=3?1:2
    if (days>=10) return 1
    return 2
  }
  return 4
}

function getStatusBadge(p) {
  const N2 = N
  if (N2(p.tx_completed)>=N2(p.total_tx_cost)*0.9 && N2(p.tx_completed)>0)
    return {label:'Complete', color:'#16a34a', bg:'#dcfce7'}
  if (p.has_appt==='Yes' && !isBigCase(p))
    return {label:'Scheduled', color:'#0d9488', bg:'#f0fdf4'}
  if (isBigCase(p)) {
    const c = getBigCaseCadence(p)
    return {label:'⭐ '+c.label, color:c.color, bg:c.color+'18'}
  }
  const days = p.dos ? Math.floor((new Date(todayStr())-new Date(p.dos))/86400000) : 0
  const lastCall = p.call_3_date||p.call_2_date||p.call_1_date
  const callCount = [p.call_1_date,p.call_2_date,p.call_3_date].filter(Boolean).length
  if (p.has_appt==='No'||!p.appt_1) {
    if (callCount>=3) return {label:'Escalate',    color:'#dc2626', bg:'#fee2e2'}
    if (!lastCall && days>=3) return {label:'Call Due',   color:'#dc2626', bg:'#fee2e2'}
    if (lastCall && days>=10) return {label:'Call Overdue', color:'#d97706', bg:'#fef9c3'}
    if (!lastCall) return {label:'Needs Call',  color:'#d97706', bg:'#fef9c3'}
    return {label:'Following Up', color:'#1d4ed8', bg:'#dbeafe'}
  }
  return {label:'Scheduled', color:'#0d9488', bg:'#f0fdf4'}
}

// ── Blank form ─────────────────────────────────────────────────────────────
const BLANK = (office='', tc='') => ({
  id: 'tp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
  office, doctor:'', who_tx_plan:tc, who_sched:'', assigned_tc_name:tc,
  dos:todayStr(), month_tab:todayStr().slice(0,7),
  patient_name:'', patient_phone:'', patient_email:'',
  exam_type:'', notes:'', remarks:'',
  appt_1:'', appt_2:'', appt_3:'', appt_hyg:'',
  has_appt:'', email_sent:'',
  call_1_date:'', call_1_notes:'', call_1_method:'', call_1_outcome:'',
  call_2_date:'', call_2_notes:'', call_2_method:'', call_2_outcome:'',
  call_3_date:'', call_3_notes:'', call_3_method:'', call_3_outcome:'',
  total_tx_cost:'', sched_tx_amount:'', ins_expected:'', tx_completed:'',
  finance_stalled:false, finance_barrier:'',
  is_big_case:false, big_case_reason:'', big_case_notes:'',
  protocol_log:[], visit_log:[], tx_plan:null, visits:[],
  created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
})

// ── Inline input ───────────────────────────────────────────────────────────
const Inp = ({label,value,onChange,type='text',opts,span,format,placeholder}) => {
  const handle = raw => {
    if (format==='phone') return onChange(fmtPhone(raw))
    if (format==='currency') return onChange(raw.replace(/[^0-9.]/g,''))
    return onChange(raw)
  }
  const s = {width:'100%',boxSizing:'border-box',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}
  return (
    <div style={span?{gridColumn:'1/-1'}:{}}>
      <div style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:3}}>{label}</div>
      {opts
        ? <select value={value||''} onChange={e=>onChange(e.target.value)} style={s}>
            <option value="">—</option>
            {opts.map(o=><option key={o}>{o}</option>)}
          </select>
        : <input type={type} value={value||''} onChange={e=>handle(e.target.value)}
            inputMode={format==='currency'?'decimal':format==='phone'?'tel':undefined}
            placeholder={placeholder||(format==='phone'?'(000) 000-0000':format==='currency'?'0.00':undefined)}
            style={s}/>
      }
    </div>
  )
}

// ── Call log row (inline logging) ──────────────────────────────────────────
function CallRow({n, dateKey, notesKey, methodKey, outcomeKey, form, set, onLog}) {
  const [open, setOpen] = useState(false)
  const [method, setMethod] = useState('Call')
  const [outcome, setOutcome] = useState('No answer')
  const [note, setNote] = useState('')
  const hasDate = !!form[dateKey]

  return (
    <div style={{marginBottom:8}}>
      <div style={{display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:20,height:20,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',
          background:hasDate?'#16a34a':'#f1f5f9',border:'2px solid '+(hasDate?'#16a34a':'#e2e8f0'),flexShrink:0}}>
          {hasDate && <span style={{color:'white',fontSize:10,fontWeight:900}}>✓</span>}
        </div>
        <span style={{fontSize:12,fontWeight:700,color:'#1e293b',minWidth:50}}>{n} Call</span>
        {hasDate
          ? <span style={{fontSize:11,color:'#64748b'}}>
              {fmtDate(form[dateKey])}
              {form[methodKey] && <span style={{marginLeft:6,color:'#94a3b8'}}>· {form[methodKey]}</span>}
              {form[outcomeKey] && <span style={{marginLeft:4,color:'#475569'}}>· {form[outcomeKey]}</span>}
              {form[notesKey] && <span style={{marginLeft:4,color:'#94a3b8',fontStyle:'italic'}}>— {form[notesKey]}</span>}
            </span>
          : <button onClick={()=>setOpen(o=>!o)}
              style={{padding:'3px 10px',borderRadius:6,background:open?'#1d4ed8':'#f1f5f9',
                color:open?'white':'#64748b',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
              {open?'Cancel':'Log Call'}
            </button>
        }
        {hasDate && (
          <button onClick={()=>setOpen(o=>!o)}
            style={{marginLeft:'auto',padding:'2px 8px',borderRadius:5,background:'#f8fafc',
              color:'#94a3b8',border:'1px solid #e2e8f0',fontSize:10,cursor:'pointer'}}>
            Edit
          </button>
        )}
      </div>
      {open && (
        <div style={{marginTop:8,marginLeft:28,padding:12,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>METHOD</div>
              <select value={method} onChange={e=>setMethod(e.target.value)}
                style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
                {CALL_METHODS.map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>OUTCOME</div>
              <select value={outcome} onChange={e=>setOutcome(e.target.value)}
                style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
                {CALL_OUTCOMES.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>
          </div>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Notes (optional)"
            style={{width:'100%',boxSizing:'border-box',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12,marginBottom:8}}/>
          <button onClick={()=>{
            set(dateKey, todayStr()); set(methodKey, method); set(outcomeKey, outcome); set(notesKey, note)
            if (outcome==='Scheduled') set('has_appt','Yes')
            setOpen(false); onLog()
          }} style={{padding:'6px 14px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
            Save
          </button>
        </div>
      )}
    </div>
  )
}

// ── Big case protocol timeline (inline in expanded row) ────────────────────
function BigCaseProtocol({p, onSave, user, notify}) {
  const [logStep, setLogStep] = useState(null)
  const [method,  setMethod]  = useState('Call')
  const [outcome, setOutcome] = useState('No answer')
  const [note,    setNote]    = useState('')

  const log   = p.protocol_log || []
  const done  = new Set(log.map(e=>e.step))
  const days  = p.dos ? Math.floor((new Date(todayStr())-new Date(p.dos))/86400000) : null
  let currentIdx = null

  const steps = BIG_CASE_PROTOCOL.map((s,i) => {
    const isDone = done.has(s.step)
    let state = 'upcoming'
    if (isDone) state = 'done'
    else if (currentIdx===null) {
      if (days===null)       { state='due';     currentIdx=i }
      else if (days>=s.day)  { state=(days===s.day)?'due':'overdue'; currentIdx=i }
      else                   { state='pending'; currentIdx=i }
    }
    return {...s, state, logEntry:log.find(e=>e.step===s.step)}
  })

  const stateColor = {done:'#16a34a',due:'#0d9488',overdue:'#d97706',pending:'#94a3b8',upcoming:'#e2e8f0'}

  const saveStep = async (s) => {
    const entry = {step:s.step,label:s.title,date:todayStr(),method,outcome,note,by:user.name||''}
    const newLog = [...log.filter(e=>e.step!==s.step), entry]
    const patch = {...p, protocol_log:newLog, updated_at:new Date().toISOString()}
    if (s.step==='call_d3' && !p.call_1_date) { patch.call_1_date=todayStr(); patch.call_1_method=method; patch.call_1_outcome=outcome; patch.call_1_notes=note }
    if (s.step==='call_d7' && !p.call_2_date) { patch.call_2_date=todayStr(); patch.call_2_method=method; patch.call_2_outcome=outcome; patch.call_2_notes=note }
    if (s.step==='fin_d14' && !p.call_3_date) { patch.call_3_date=todayStr(); patch.call_3_method=method; patch.call_3_outcome=outcome; patch.call_3_notes=note }
    if (s.step==='email_d1') patch.email_sent='Yes'
    if (outcome==='Scheduled') patch.has_appt='Yes'
    await onSave(patch)
    notify(s.title+' logged')
    setLogStep(null); setNote('')
  }

  return (
    <div>
      <div style={{fontSize:10,fontWeight:800,color:'#7c3aed',letterSpacing:.5,marginBottom:10}}>
        ⭐ BIG CASE PROTOCOL — {days!==null?'Day '+days+' since exam':'No exam date set'}
      </div>
      {steps.map((s,i)=>{
        const c = stateColor[s.state]
        const isActive = i===currentIdx
        return (
          <div key={s.step} style={{display:'flex',gap:10,position:'relative',marginBottom:12}}>
            {i<steps.length-1&&<div style={{position:'absolute',left:8,top:18,width:2,bottom:-12,
              background:s.state==='done'?'#16a34a':'#f1f5f9'}}/>}
            <div style={{width:18,height:18,borderRadius:'50%',flexShrink:0,zIndex:1,
              background:s.state==='done'?'#16a34a':s.state==='upcoming'?'white':'transparent',
              border:'2px solid '+c,display:'flex',alignItems:'center',justifyContent:'center'}}>
              {s.state==='done'&&<span style={{color:'white',fontSize:9,fontWeight:900}}>✓</span>}
              {isActive&&s.state!=='done'&&<span style={{fontSize:8,color:c}}>●</span>}
            </div>
            <div style={{flex:1}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
                <span style={{fontSize:12,fontWeight:700,color:s.state==='done'?'#16a34a':s.state==='upcoming'?'#94a3b8':'#1e293b'}}>
                  {s.label} · {s.title}
                </span>
                <div style={{display:'flex',gap:6,alignItems:'center'}}>
                  {s.logEntry&&<span style={{fontSize:10,color:'#94a3b8'}}>{s.logEntry.date}</span>}
                  {isActive&&(
                    logStep===s.step
                      ? <button onClick={()=>{setLogStep(null);setNote('')}}
                          style={{padding:'2px 8px',borderRadius:5,background:'#f1f5f9',color:'#64748b',border:'none',fontSize:10,cursor:'pointer'}}>Cancel</button>
                      : <button onClick={()=>{setLogStep(s.step);setMethod('Call');setOutcome('No answer');setNote('')}}
                          style={{padding:'3px 10px',borderRadius:6,background:c,color:'white',border:'none',fontWeight:700,fontSize:10,cursor:'pointer'}}>
                          {s.type==='email'?'Log Email':s.type==='finance'?'Log Finance':s.type==='review'?'Log Review':'Log Call'}
                        </button>
                  )}
                </div>
              </div>
              {s.logEntry&&(
                <div style={{fontSize:10,color:'#475569',marginTop:3,background:'#f0fdf4',borderRadius:5,padding:'3px 8px'}}>
                  {s.logEntry.method} · {s.logEntry.outcome}{s.logEntry.note?' — '+s.logEntry.note:''}{s.logEntry.by?' ('+s.logEntry.by+')':''}
                </div>
              )}
              {logStep===s.step&&(
                <div style={{marginTop:8,padding:10,background:'#f8fafc',borderRadius:8,border:'1px solid #e2e8f0'}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:8}}>
                    <div>
                      <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>METHOD</div>
                      <select value={method} onChange={e=>setMethod(e.target.value)}
                        style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
                        {CALL_METHODS.map(m=><option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>OUTCOME</div>
                      <select value={outcome} onChange={e=>setOutcome(e.target.value)}
                        style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
                        {CALL_OUTCOMES.map(o=><option key={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>
                  <input value={note} onChange={e=>setNote(e.target.value)} placeholder="Notes..."
                    style={{width:'100%',boxSizing:'border-box',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12,marginBottom:8}}/>
                  <button onClick={()=>saveStep(s)}
                    style={{padding:'6px 14px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    Save
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Patient row ────────────────────────────────────────────────────────────
function PatientRow({p, onSave, onDelete, isManager, user, notify, emailPresets}) {
  const [open,  setOpen]   = useState(false)
  const [tab,   setTab]    = useState('followup')
  const [edit,  setEdit]   = useState(false)
  const [email, setEmail]  = useState(false)
  const [form,  setForm]   = useState(p)
  const [busy,  setBusy]   = useState(false)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const badge = getStatusBadge(p)
  const big   = isBigCase(p)
  const callCount = [p.call_1_date,p.call_2_date,p.call_3_date].filter(Boolean).length

  const save = async () => {
    setBusy(true)
    await onSave({...form, month_tab:(form.dos||todayStr()).slice(0,7),
      is_big_case:form.is_big_case||N(form.total_tx_cost)>=3000,
      finance_stalled:form.finance_stalled||detectFin(form.notes,form.remarks),
      updated_at:new Date().toISOString()})
    setBusy(false); setEdit(false)
  }

  const quickSave = async (patch) => {
    const updated = {...p, ...patch, updated_at:new Date().toISOString()}
    setForm(updated)
    await onSave(updated)
    notify('Saved')
  }

  return (
    <div style={{background:'white',borderRadius:10,marginBottom:6,
      border:'1px solid '+(badge.color==='#dc2626'?'#fecaca':big?'#e9d5ff':'#e2e8f0'),
      overflow:'hidden'}}>
      {/* Row summary — always visible */}
      <div onClick={()=>{setOpen(o=>!o);if(!open)setTab('followup')}}
        style={{display:'flex',alignItems:'center',gap:10,padding:'10px 14px',cursor:'pointer',
          background:open?'#f8fafc':'white'}}>
        {/* Status dot */}
        <div style={{width:10,height:10,borderRadius:'50%',background:badge.color,flexShrink:0}}/>

        {/* Patient name + doctor */}
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:800,color:'#1e293b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            {p.patient_name}
          </div>
          <div style={{fontSize:11,color:'#94a3b8'}}>
            {p.doctor||'—'} · {p.who_tx_plan||'—'} · {p.exam_type||'—'}
            {p.dos&&<span> · {fmtDate(p.dos)}</span>}
          </div>
        </div>

        {/* Status badge */}
        <div style={{display:'none',fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:99,
          background:badge.bg,color:badge.color,whiteSpace:'nowrap',flexShrink:0,
          '@media(min-width:600px)':{display:'block'}}}>
          <span style={{display:'block'}}>{badge.label}</span>
        </div>

        {/* TX value */}
        {p.total_tx_cost>0 && (
          <div style={{fontSize:12,fontWeight:800,color:'#1d4ed8',flexShrink:0,textAlign:'right'}}>
            {USD(p.total_tx_cost)}
          </div>
        )}

        {/* Call count pills */}
        <div style={{display:'flex',gap:3,flexShrink:0}}>
          {[p.call_1_date,p.call_2_date,p.call_3_date].map((d,i)=>(
            <div key={i} style={{width:16,height:16,borderRadius:'50%',background:d?'#0d9488':'#f1f5f9',
              display:'flex',alignItems:'center',justifyContent:'center',fontSize:8,fontWeight:800,
              color:d?'white':'#cbd5e1'}}>{i+1}</div>
          ))}
        </div>

        <div style={{fontSize:10,color:'#cbd5e1',flexShrink:0}}>{open?'▲':'▼'}</div>
      </div>

      {/* Badge shown below name on mobile */}
      {!open && (
        <div style={{paddingLeft:34,paddingBottom:8,paddingRight:14}}>
          <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99,
            background:badge.bg,color:badge.color}}>{badge.label}</span>
        </div>
      )}

      {/* Expanded detail — tabbed */}
      {open && (
        <div style={{borderTop:'1px solid #f1f5f9',background:'#fafafa'}}>
          {!edit ? (
            <div>
              {/* Tab bar */}
              <div style={{display:'flex',background:'white',borderBottom:'1px solid #f1f5f9'}}>
                {[
                  ['followup','📞 Follow-Up', callCount>0?callCount:0],
                  ['details', '📋 Details',   0],
                  ['txplan',  '📄 TX Plan',   (p.tx_plan||p.visits?.length)?'•':0],
                ].map(([k,l,badge])=>(
                  <button key={k} onClick={e=>{e.stopPropagation();setTab(k)}}
                    style={{flex:1,padding:'10px 6px',border:'none',background:'none',cursor:'pointer',
                      fontSize:11,fontWeight:700,color:tab===k?'#1d4ed8':'#94a3b8',
                      borderBottom:'2px solid '+(tab===k?'#1d4ed8':'transparent'),transition:'all .12s'}}>
                    {l}
                    {badge!==0&&<span style={{marginLeft:4,background:tab===k?'#1d4ed8':'#cbd5e1',color:'white',
                      borderRadius:99,fontSize:9,fontWeight:800,padding:'1px 6px'}}>{badge}</span>}
                  </button>
                ))}
              </div>

              <div style={{padding:'14px 16px'}}>
                {/* Action buttons */}
                <div style={{display:'flex',justifyContent:'flex-end',gap:7,marginBottom:12,flexWrap:'wrap'}}>
                  <button onClick={e=>{e.stopPropagation();setEmail(true)}}
                    style={{padding:'6px 14px',borderRadius:7,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    ✉ Email Patient
                  </button>
                  <button onClick={e=>{e.stopPropagation();setEdit(true)}}
                    style={{padding:'6px 14px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    ✏ Edit
                  </button>
                  {isManager&&<button onClick={e=>{e.stopPropagation();if(window.confirm('Delete?'))onDelete(p.id)}}
                    style={{padding:'6px 14px',borderRadius:7,background:'#fee2e2',color:'#dc2626',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    Delete
                  </button>}
                </div>

                {/* ── FOLLOW-UP TAB ── */}
                {tab==='followup' && (
                  <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0'}}>
                    <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:10}}>
                      {big?'⭐ BIG CASE PROTOCOL':'FOLLOW-UP LOG'}
                      {callCount>0&&!big&&<span style={{marginLeft:6,color:'#0d9488'}}>{callCount} attempt{callCount>1?'s':''}</span>}
                    </div>
                    {big
                      ? <BigCaseProtocol p={p} onSave={quickSave} user={user} notify={notify}/>
                      : <>
                          <CallRow n="1st" dateKey="call_1_date" notesKey="call_1_notes" methodKey="call_1_method" outcomeKey="call_1_outcome" form={form} set={set} onLog={()=>quickSave({call_1_date:form.call_1_date,call_1_method:form.call_1_method,call_1_outcome:form.call_1_outcome,call_1_notes:form.call_1_notes})}/>
                          <CallRow n="2nd" dateKey="call_2_date" notesKey="call_2_notes" methodKey="call_2_method" outcomeKey="call_2_outcome" form={form} set={set} onLog={()=>quickSave({call_2_date:form.call_2_date,call_2_method:form.call_2_method,call_2_outcome:form.call_2_outcome,call_2_notes:form.call_2_notes})}/>
                          <CallRow n="3rd" dateKey="call_3_date" notesKey="call_3_notes" methodKey="call_3_method" outcomeKey="call_3_outcome" form={form} set={set} onLog={()=>quickSave({call_3_date:form.call_3_date,call_3_method:form.call_3_method,call_3_outcome:form.call_3_outcome,call_3_notes:form.call_3_notes})}/>
                        </>
                    }
                  </div>
                )}

                {/* ── DETAILS TAB ── */}
                {tab==='details' && (
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:12}}>
                    {/* Appointments */}
                    <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:8}}>APPOINTMENTS</div>
                      {[['Has Appt',p.has_appt],['1st Appt',fmtDate(p.appt_1)||p.appt_1],
                        ['2nd Appt',fmtDate(p.appt_2)||p.appt_2],['Hyg Appt',p.appt_hyg],
                        ['Email Sent',p.email_sent],['Sched By',p.who_sched]].map(([l,v])=>(
                        v&&<div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0',borderBottom:'1px solid #f8fafc'}}>
                          <span style={{color:'#64748b'}}>{l}</span>
                          <span style={{fontWeight:600,color:'#1e293b'}}>{v}</span>
                        </div>
                      ))}
                      {!(p.has_appt||p.appt_1||p.appt_2||p.appt_hyg||p.email_sent||p.who_sched)&&
                        <div style={{fontSize:12,color:'#94a3b8',padding:'6px 0'}}>No appointment data</div>}
                    </div>

                    {/* Financials */}
                    <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:8}}>FINANCIALS</div>
                      {[['Total TX Cost',p.total_tx_cost,'#1d4ed8'],['Sched TX $$$',p.sched_tx_amount,'#0d9488'],
                        ['Ins Expected',p.ins_expected,'#64748b'],['TX Completed',p.tx_completed,'#16a34a']].map(([l,v,c])=>(
                        <div key={l} style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'3px 0',borderBottom:'1px solid #f8fafc'}}>
                          <span style={{color:'#64748b'}}>{l}</span>
                          <span style={{fontWeight:700,color:c}}>{v?USD(v):'—'}</span>
                        </div>
                      ))}
                      {p.total_tx_cost>0&&(
                        <div style={{marginTop:8,height:4,background:'#f1f5f9',borderRadius:2}}>
                          <div style={{height:'100%',background:'#16a34a',borderRadius:2,
                            width:Math.min(Math.round(N(p.tx_completed)*100/N(p.total_tx_cost)),100)+'%'}}/>
                        </div>
                      )}
                    </div>

                    {/* Notes & Remarks */}
                    <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0',gridColumn:'1/-1'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:8}}>NOTES & REMARKS</div>
                      {p.notes&&<div style={{fontSize:12,color:'#1e293b',marginBottom:4}}><b>Notes:</b> {p.notes}</div>}
                      {p.remarks&&<div style={{fontSize:12,color:'#475569',fontStyle:'italic'}}><b>Remarks:</b> {p.remarks}</div>}
                      {p.finance_barrier&&<div style={{fontSize:11,color:'#7c3aed',fontWeight:600,marginTop:4}}>Finance: {p.finance_barrier}</div>}
                      {!(p.notes||p.remarks||p.finance_barrier)&&<div style={{fontSize:12,color:'#94a3b8'}}>No notes</div>}
                    </div>
                  </div>
                )}

                {/* ── TX PLAN TAB ── */}
                {tab==='txplan' && <TxPlanPanel p={p} onSave={quickSave} notify={notify}/>}
              </div>
            </div>
          ) : (
            /* Edit form */
            <div onClick={e=>e.stopPropagation()} style={{padding:'14px 16px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                <b style={{fontSize:13,color:'#1e293b'}}>Editing: {form.patient_name}</b>
                <div style={{display:'flex',gap:7}}>
                  <button onClick={()=>setEdit(false)}
                    style={{padding:'5px 12px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Cancel</button>
                  <button onClick={save} disabled={busy}
                    style={{padding:'5px 12px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    {busy?'Saving...':'Save'}</button>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:8}}>
                <Inp label="Patient Name"    value={form.patient_name}    onChange={v=>set('patient_name',v)}/>
                <Inp label="Phone"           value={form.patient_phone}   onChange={v=>set('patient_phone',v)} format="phone"/>
                <Inp label="Email"           value={form.patient_email}   onChange={v=>set('patient_email',v)}/>
                <Inp label="Doctor"          value={form.doctor}          onChange={v=>set('doctor',v)} opts={DOCTORS}/>
                <Inp label="Date of Service" value={form.dos}             onChange={v=>set('dos',v)} type="date"/>
                <Inp label="Exam Type"       value={form.exam_type}       onChange={v=>set('exam_type',v)} opts={EXAM_TYPES}/>
                <Inp label="TX Plan By"      value={form.who_tx_plan}     onChange={v=>set('who_tx_plan',v)}/>
                <Inp label="Sched By"        value={form.who_sched}       onChange={v=>set('who_sched',v)}/>
                <Inp label="1st Appt"        value={form.appt_1}          onChange={v=>set('appt_1',v)} type="date"/>
                <Inp label="2nd Appt"        value={form.appt_2}          onChange={v=>set('appt_2',v)} type="date"/>
                <Inp label="Hyg Appt"        value={form.appt_hyg}        onChange={v=>set('appt_hyg',v)}/>
                <Inp label="Has Appt"        value={form.has_appt}        onChange={v=>set('has_appt',v)} opts={HAS_APPT}/>
                <Inp label="Email Sent"      value={form.email_sent}      onChange={v=>set('email_sent',v)} opts={EMAIL_OPTS}/>
                <Inp label="Total TX Cost"   value={form.total_tx_cost}   onChange={v=>set('total_tx_cost',v)} format="currency"/>
                <Inp label="Sched TX $$$"    value={form.sched_tx_amount} onChange={v=>set('sched_tx_amount',v)} format="currency"/>
                <Inp label="Ins Expected"    value={form.ins_expected}    onChange={v=>set('ins_expected',v)} format="currency"/>
                <Inp label="TX Completed"    value={form.tx_completed}    onChange={v=>set('tx_completed',v)} format="currency"/>
                <Inp label="Finance Barrier" value={form.finance_barrier} onChange={v=>set('finance_barrier',v)} opts={BARRIER_TYPES}/>
                <Inp label="Big Case Reason" value={form.big_case_reason} onChange={v=>set('big_case_reason',v)} opts={['',...BIG_CASE_REASONS]}/>
                <Inp label="Notes"           value={form.notes}           onChange={v=>set('notes',v)} span/>
                <Inp label="Remarks"         value={form.remarks}         onChange={v=>set('remarks',v)} span/>
              </div>
              <div style={{display:'flex',gap:12,marginTop:10}}>
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}>
                  <input type="checkbox" checked={!!form.finance_stalled} onChange={e=>set('finance_stalled',e.target.checked)}/>
                  <span style={{color:'#7c3aed',fontWeight:600}}>Finance Stalled</span>
                </label>
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,cursor:'pointer'}}>
                  <input type="checkbox" checked={!!form.is_big_case||N(form.total_tx_cost)>=3000}
                    onChange={e=>set('is_big_case',e.target.checked)}/>
                  <span style={{color:'#1d4ed8',fontWeight:600}}>Big Case ⭐</span>
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {email && (
        <EmailModal p={p} user={user} onClose={()=>setEmail(false)} notify={notify} emailPresets={emailPresets}/>
      )}
    </div>
  )
}

// ── TX Plan Panel (inline in expanded row) ─────────────────────────────────
function TxPlanPanel({p, onSave, notify}) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef()
  const plan   = p.tx_plan
  const visits = p.visits || plan?.visits || []

  const handleUpload = async (file) => {
    setUploading(true)
    try {
      const { extractTxPlanText, parseTxPlanText } = await import('../../lib/txPlanParser')
      const parsed = parseTxPlanText(await extractTxPlanText(file))
      if (!parsed.patient_name && !parsed.visits.length) { notify('Could not read PDF','error'); setUploading(false); return }
      await onSave({tx_plan:parsed, visits:parsed.visits,
        total_tx_cost:parsed.case_total||p.total_tx_cost, ins_expected:parsed.est_ins||p.ins_expected})
      notify('TX plan attached')
    } catch(e) { notify('Upload failed: '+e.message,'error') }
    setUploading(false)
  }

  return (
    <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5}}>TX PLAN</div>
        <label style={{padding:'4px 12px',borderRadius:7,background:'#1d4ed8',color:'white',fontWeight:700,fontSize:11,cursor:'pointer'}}>
          {uploading?'Reading..':plan?'Replace PDF':'Attach PDF'}
          <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}} onChange={e=>{if(e.target.files[0])handleUpload(e.target.files[0])}}/>
        </label>
      </div>
      {!plan&&!uploading&&<div style={{textAlign:'center',padding:'10px 0',color:'#94a3b8',fontSize:12}}>No TX plan attached</div>}
      {uploading&&<div style={{textAlign:'center',padding:'10px 0',color:'#1d4ed8',fontSize:12}}>Reading PDF...</div>}
      {plan&&!uploading&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:8,marginBottom:10}}>
            {[['Total',plan.case_total,'#1d4ed8'],['Ins',plan.est_ins,'#0d9488'],['Patient',plan.est_patient,'#d97706'],['Write-off',plan.est_writeoff,'#64748b']].map(([l,v,c])=>(
              <div key={l} style={{background:'#f8fafc',borderRadius:7,padding:'7px 9px'}}>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,marginBottom:2}}>{l}</div>
                <div style={{fontSize:14,fontWeight:800,color:c}}>{v?'$'+N(v).toLocaleString():'—'}</div>
              </div>
            ))}
          </div>
          {visits.map((v,vi)=>(
            <div key={vi} style={{marginBottom:8,border:'1px solid #f1f5f9',borderRadius:8,overflow:'hidden'}}>
              <div style={{background:'#f8fafc',padding:'5px 10px',display:'flex',justifyContent:'space-between',fontSize:11}}>
                <b>Visit {v.visit_num||vi+1}</b>
                <span>Total: ${N(v.total).toLocaleString()} · Ins: ${N(v.ins_total).toLocaleString()} · Pt: ${N(v.pt_total).toLocaleString()}</span>
              </div>
              {(v.procedures||[]).map((proc,pi)=>(
                <div key={pi} style={{display:'flex',gap:8,padding:'4px 10px',borderTop:'1px solid #f8fafc',fontSize:11,
                  background:pi%2===0?'white':'#fafafa'}}>
                  <span style={{fontWeight:700,color:'#1d4ed8',minWidth:50}}>{proc.code}</span>
                  <span style={{flex:1,color:'#475569'}}>{proc.description}</span>
                  {proc.tooth&&<span style={{color:'#94a3b8'}}>#{proc.tooth}</span>}
                  <span style={{color:'#1e293b',fontWeight:600}}>${N(proc.fee).toLocaleString()}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Email Modal ────────────────────────────────────────────────────────────
function EmailModal({p, user, onClose, notify, emailPresets}) {
  const [loading, setLoading] = useState(false)
  const [subject, setSubject] = useState('Your Treatment Plan Summary -- Beautiful Smiles by Design')
  const [body,    setBody]    = useState('')
  const [err,     setErr]     = useState('')
  const [preset,  setPreset]  = useState('warm')
  const [custom,  setCustom]  = useState('')

  const presets = (emailPresets&&emailPresets.length)
    ? emailPresets
    : [{id:'warm',label:'Warm & Encouraging',instruction:'Use a warm, friendly, encouraging tone.'}]

  const generate = async () => {
    setLoading(true); setErr('')
    try {
      const pt = N(p.total_tx_cost) - N(p.ins_expected)
      const visits = p.visits||p.tx_plan?.visits||[]
      let seq = ''
      if (visits.length) {
        seq = '\n\nTREATMENT SEQUENCE:\n'
        visits.forEach((v,i)=>{
          const procs=(v.procedures||[]).map(pr=>pr.code+' '+pr.description).join(', ')
          seq += 'Visit '+(v.visit_num||i+1)+': '+(procs||'planned procedures')+' ~$'+N(v.pt_total).toLocaleString()+'\n'
        })
        seq += '\nExplain each step and why it leads to the next.'
      }
      const presetObj = presets.find(x=>x.id===preset)||presets[0]
      const prompt = `You are a warm, professional treatment coordinator at Beautiful Smiles by Design.
Write a follow-up email to a patient about their treatment plan.

TONE: ${presetObj.instruction}
${custom.trim()?'\nSPECIAL INSTRUCTION: '+custom.trim():''}

Patient: ${p.patient_name}
Doctor: ${p.doctor||''}
Exam: ${p.exam_type||''} on ${p.dos||''}
Treatment: ${p.notes||''}
Total cost: ${p.total_tx_cost?'$'+N(p.total_tx_cost).toLocaleString():'not specified'}
Insurance covers: ${p.ins_expected?'$'+N(p.ins_expected).toLocaleString():'unknown'}
Patient portion: ${pt>0?'$'+pt.toLocaleString():'unknown'}
${p.finance_barrier?'Finance barrier: '+p.finance_barrier:''}
${seq}

Rules: address by first name only, explain treatment and costs clearly, call to action to schedule, sign off as ${user.name||'Your Care Team'} at Beautiful Smiles by Design. Under 250 words. Plain text only.`

      const res = await fetch(window.location.origin+'/api/ai-email',{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({prompt}),
      })
      if (res.status===404) throw new Error('Function not found')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error||'Request failed')
      setBody(data.text||'')
    } catch(e) { setErr('Failed: '+e.message) }
    setLoading(false)
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:400,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div style={{background:'white',borderRadius:14,padding:22,width:'100%',maxWidth:580}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:'#1e293b'}}>Email Patient</div>
            <div style={{fontSize:11,color:'#64748b'}}>{p.patient_name} · {p.patient_email||'No email on file'}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#94a3b8'}}>✕</button>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
          {presets.map(ps=>(
            <button key={ps.id} onClick={()=>setPreset(ps.id)} title={ps.description||''}
              style={{padding:'5px 11px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',
                border:'2px solid '+(preset===ps.id?'#1d4ed8':'#e2e8f0'),
                background:preset===ps.id?'#eff6ff':'white',color:preset===ps.id?'#1d4ed8':'#64748b'}}>
              {ps.label}
            </button>
          ))}
        </div>
        <input value={custom} onChange={e=>setCustom(e.target.value)} placeholder="Anything specific to mention? (optional)"
          style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,marginBottom:10}}/>
        <input value={subject} onChange={e=>setSubject(e.target.value)}
          style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,marginBottom:10}}/>
        {!body&&!loading&&(
          <div style={{background:'#f8fafc',borderRadius:10,padding:18,textAlign:'center',marginBottom:10}}>
            <button onClick={generate}
              style={{padding:'9px 22px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
              Generate with AI
            </button>
          </div>
        )}
        {loading&&<div style={{textAlign:'center',padding:20,color:'#1d4ed8',fontWeight:600}}>Generating...</div>}
        {err&&<div style={{color:'#dc2626',fontSize:12,marginBottom:10}}>{err}</div>}
        {body&&(
          <div style={{marginBottom:10}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
              <div style={{fontSize:9,fontWeight:800,color:'#64748b'}}>EMAIL BODY</div>
              <button onClick={generate} style={{fontSize:11,color:'#1d4ed8',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>Regenerate</button>
            </div>
            <textarea value={body} onChange={e=>setBody(e.target.value)}
              style={{width:'100%',boxSizing:'border-box',minHeight:180,padding:'9px 11px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:12,lineHeight:1.6,resize:'vertical'}}/>
          </div>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{padding:'8px 16px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
          {body&&<button onClick={()=>{navigator.clipboard.writeText(body);notify('Copied')}}
            style={{padding:'8px 16px',borderRadius:7,background:'#f8fafc',border:'1px solid #e2e8f0',fontWeight:700,cursor:'pointer'}}>Copy</button>}
          {body&&<button onClick={()=>{window.open('mailto:'+(p.patient_email||'')+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body));notify('Email opened')}}
            style={{padding:'8px 16px',borderRadius:7,background:'#0d9488',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>Open in Email</button>}
        </div>
      </div>
    </div>
  )
}

// ── Add Patient Modal ──────────────────────────────────────────────────────
function AddModal({user, office, onClose, onSave, notify}) {
  const [form, setForm] = useState(BLANK(office, user.name||''))
  const [busy, setBusy] = useState(false)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))
  const save = async () => {
    if (!form.patient_name.trim()) { notify('Patient name required','error'); return }
    setBusy(true)
    await onSave({...form, month_tab:(form.dos||todayStr()).slice(0,7),
      is_big_case:N(form.total_tx_cost)>=3000,
      finance_stalled:detectFin(form.notes,form.remarks), updated_at:new Date().toISOString()})
    setBusy(false); onClose()
  }
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'30px 16px',overflowY:'auto'}}>
      <div style={{background:'white',borderRadius:14,padding:22,width:'100%',maxWidth:580,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:800,color:'#1e293b'}}>Add New Patient</div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#94a3b8'}}>✕</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9,marginBottom:12}}>
          <Inp label="Patient Name *" value={form.patient_name}  onChange={v=>set('patient_name',v)}/>
          <Inp label="Phone"          value={form.patient_phone} onChange={v=>set('patient_phone',v)} format="phone"/>
          <Inp label="Doctor"         value={form.doctor}        onChange={v=>set('doctor',v)} opts={DOCTORS}/>
          <Inp label="Date of Service" value={form.dos}          onChange={v=>set('dos',v)} type="date"/>
          <Inp label="Exam Type"      value={form.exam_type}     onChange={v=>set('exam_type',v)} opts={EXAM_TYPES}/>
          <Inp label="TX Plan By"     value={form.who_tx_plan}   onChange={v=>set('who_tx_plan',v)}/>
          <Inp label="Total TX Cost"  value={form.total_tx_cost} onChange={v=>set('total_tx_cost',v)} format="currency"/>
          <Inp label="Has Appt"       value={form.has_appt}      onChange={v=>set('has_appt',v)} opts={HAS_APPT}/>
        </div>
        <div style={{marginBottom:10}}>
          <Inp label="Notes" value={form.notes} onChange={v=>set('notes',v)} span/>
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',paddingTop:12,borderTop:'1px solid #f1f5f9'}}>
          <button onClick={onClose}
            style={{padding:'8px 18px',borderRadius:8,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={busy}
            style={{padding:'8px 18px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>
            {busy?'Saving...':'Add Patient'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Smart Month Selector ───────────────────────────────────────────────────
function MonthSelector({ monthTabs, activeMonth, setActiveMonth, counts }) {
  const [olderOpen, setOlderOpen] = useState(false)
  const olderRef = useRef()

  useEffect(() => {
    const close = e => { if (olderRef.current && !olderRef.current.contains(e.target)) setOlderOpen(false) }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [])

  // Years present in the data
  const years = useMemo(() => [...new Set(monthTabs.map(m=>m.slice(0,4)))].sort().reverse(), [monthTabs])
  const [selYear, setSelYear] = useState(years[0] || String(new Date().getFullYear()))

  // Months in the selected year, newest first
  const yearMonths = useMemo(() => monthTabs.filter(m=>m.startsWith(selYear)), [monthTabs, selYear])
  const recent = yearMonths.slice(0, 4)
  const older  = yearMonths.slice(4)

  // Future months (greyed) for the selected year
  const now = new Date()
  const curYM = now.toISOString().slice(0,7)
  const futureMonths = useMemo(() => {
    const out = []
    for (let i=1; i<=12; i++) {
      const ym = `${selYear}-${String(i).padStart(2,'0')}`
      if (ym > curYM && !monthTabs.includes(ym)) out.push(ym)
    }
    return out
  }, [selYear, monthTabs, curYM])

  const pill = (active) => ({
    padding:'5px 12px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
    background: active?'#1e293b':'white', color: active?'white':'#64748b',
    border:'1px solid '+(active?'#1e293b':'#e2e8f0'), whiteSpace:'nowrap',
  })

  return (
    <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap',marginBottom:12}}>
      {/* Year pills */}
      {years.length > 0 && (
        <div style={{display:'flex',gap:3}}>
          {years.map(y => (
            <button key={y} onClick={()=>{setSelYear(y);setActiveMonth('all')}}
              style={{padding:'4px 12px',borderRadius:99,fontSize:11,fontWeight:700,cursor:'pointer',
                background:selYear===y?'#1d4ed8':'white',color:selYear===y?'white':'#64748b',
                border:'1px solid '+(selYear===y?'#1d4ed8':'#e2e8f0')}}>{y}</button>
          ))}
        </div>
      )}
      <div style={{width:1,height:18,background:'#e2e8f0'}}/>

      {/* All */}
      <button onClick={()=>setActiveMonth('all')} style={pill(activeMonth==='all')}>All</button>

      {/* Recent month quick tabs */}
      {recent.map(m => (
        <button key={m} onClick={()=>setActiveMonth(m)} style={pill(activeMonth===m)}>
          {MONTHS_EN[parseInt(m.slice(5))-1]}
        </button>
      ))}

      {/* Older dropdown */}
      {older.length > 0 && (
        <div ref={olderRef} style={{position:'relative'}}>
          <button onClick={e=>{e.stopPropagation();setOlderOpen(o=>!o)}}
            style={{...pill(older.includes(activeMonth)),display:'flex',alignItems:'center',gap:4}}>
            {older.includes(activeMonth) ? MONTHS_EN[parseInt(activeMonth.slice(5))-1] : 'Older'} ▾
          </button>
          {olderOpen && (
            <div style={{position:'absolute',top:'calc(100% + 5px)',left:0,minWidth:150,background:'white',
              borderRadius:10,border:'1px solid #e2e8f0',boxShadow:'0 8px 24px rgba(0,0,0,.1)',zIndex:200,overflow:'hidden'}}>
              {older.map(m => (
                <div key={m} onClick={()=>{setActiveMonth(m);setOlderOpen(false)}}
                  style={{padding:'9px 14px',fontSize:12,fontWeight:600,cursor:'pointer',
                    display:'flex',justifyContent:'space-between',gap:12,
                    background:activeMonth===m?'#f0f9ff':'white',color:'#1e293b'}}
                  onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
                  onMouseLeave={e=>e.currentTarget.style.background=activeMonth===m?'#f0f9ff':'white'}>
                  <span>{MONTHS_EN[parseInt(m.slice(5))-1]} {m.slice(0,4)}</span>
                  <span style={{fontSize:10,color:'#94a3b8'}}>{counts[m]||0} pts</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Greyed future months */}
      {futureMonths.length > 0 && <div style={{width:1,height:18,background:'#f1f5f9'}}/>}
      {futureMonths.map(m => (
        <span key={m} style={{padding:'5px 10px',borderRadius:7,fontSize:11,fontWeight:700,
          border:'1px solid #f1f5f9',color:'#e2e8f0',cursor:'default'}}>
          {MONTHS_EN[parseInt(m.slice(5))-1]}
        </span>
      ))}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TcPatientsPage({user, tcPatients, isManager, users, saveTcPatient, loadTcPatients, notify}) {
  const [office,      setOffice]      = useState('all')
  const [activeMonth, setActiveMonth] = useState('all')
  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState('all')
  const [drFilter,    setDrFilter]    = useState('all')
  const [tcFilter,    setTcFilter]    = useState('all')
  const [showAdd,     setShowAdd]     = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [importing,   setImporting]   = useState(false)
  const [importRes,   setImportRes]   = useState(null)
  const [emailPresets,setEmailPresets]= useState([])
  const importRef = useRef()

  useEffect(() => {
    sbGet('email_presets','select=*&active=eq.true&order=sort_order').then(setEmailPresets).catch(()=>{})
  }, [])

  // Role scoping: TCs see only their own patients
  const isTC = user.role === 'treatment_coordinator'
  const scopedPts = useMemo(() => {
    if (!isTC) return tcPatients||[]
    const me = (user.name||'').toLowerCase().trim()
    return (tcPatients||[]).filter(p=>
      (p.who_tx_plan||'').toLowerCase().trim()===me ||
      (p.assigned_tc_name||'').toLowerCase().trim()===me
    )
  }, [tcPatients, isTC, user.name])

  // Office filter
  const officePts = useMemo(() =>
    office==='all' ? scopedPts : scopedPts.filter(p=>p.office===office)
  , [scopedPts, office])

  // Month tabs from actual data
  const monthTabs = useMemo(() => {
    const ms = [...new Set(officePts.map(p=>p.month_tab||p.dos?.slice(0,7)).filter(Boolean))]
    return ms.sort().reverse()
  }, [officePts])

  // Patient counts per month (for the selector dropdown)
  const monthCounts = useMemo(() => {
    const c = {}
    officePts.forEach(p => { const m = p.month_tab||p.dos?.slice(0,7); if(m) c[m]=(c[m]||0)+1 })
    return c
  }, [officePts])

  // Month filter
  const monthPts = useMemo(() =>
    activeMonth==='all' ? officePts : officePts.filter(p=>(p.month_tab||p.dos?.slice(0,7))===activeMonth)
  , [officePts, activeMonth])

  // Summary for selected month
  const summary = useMemo(() => ({
    total:     monthPts.length,
    txValue:   monthPts.reduce((s,p)=>s+N(p.total_tx_cost),0),
    scheduled: monthPts.reduce((s,p)=>s+N(p.sched_tx_amount),0),
    produced:  monthPts.reduce((s,p)=>s+N(p.tx_completed),0),
    withAppt:  monthPts.filter(p=>p.has_appt==='Yes'||p.appt_1).length,
    bigCases:  monthPts.filter(isBigCase).length,
    noAppt:    monthPts.filter(p=>p.has_appt==='No'||(!p.has_appt&&!p.appt_1)).length,
  }), [monthPts])

  // Doctors + TCs for filters
  const doctors = useMemo(()=>[...new Set(officePts.map(p=>p.doctor).filter(Boolean))].sort(),[officePts])
  const tcNames  = useMemo(()=>[...new Set(officePts.flatMap(p=>[p.who_tx_plan,p.assigned_tc_name].filter(Boolean)))].sort(),[officePts])
  const offCounts = useMemo(()=>OFFICES.reduce((m,o)=>({...m,[o]:scopedPts.filter(p=>p.office===o).length}),{}),[scopedPts])

  // Final filtered + sorted list
  const visible = useMemo(() => {
    let list = monthPts
    if (search.trim()) list = list.filter(p=>(p.patient_name||'').toLowerCase().includes(search.toLowerCase())||(p.patient_phone||'').includes(search))
    if (drFilter!=='all') list = list.filter(p=>p.doctor===drFilter)
    if (tcFilter!=='all') list = list.filter(p=>(p.who_tx_plan||'').toLowerCase()===tcFilter.toLowerCase())
    if (filter==='no_appt')    list = list.filter(p=>p.has_appt==='No'||(!p.has_appt&&!p.appt_1))
    else if (filter==='needs_call') list = list.filter(p=>{ const b=getStatusBadge(p); return ['Call Due','Call Overdue','Needs Call','Following Up'].includes(b.label) })
    else if (filter==='big_case')   list = list.filter(isBigCase)
    else if (filter==='has_appt')   list = list.filter(p=>p.has_appt==='Yes'||p.appt_1)
    else if (filter==='complete')   list = list.filter(p=>N(p.tx_completed)>=N(p.total_tx_cost)*0.9&&N(p.tx_completed)>0)
    else if (filter==='finance')    list = list.filter(p=>p.finance_stalled||detectFin(p.notes,p.remarks))
    return list.sort((a,b)=>getPriority(a)-getPriority(b)||(b.dos||'').localeCompare(a.dos||''))
  }, [monthPts, search, drFilter, tcFilter, filter])

  const handleImport = async (file) => {
    if (!file) return
    setImporting(true); setImportRes(null)
    try {
      const {results, total} = await importTcExcel(file, office==='all'?user.office||'Dalton':office)
      let saved=0, skipped=0
      for (const {patients} of results) {
        for (const pt of patients) {
          const cleanPh = s=>(s||'').replace(/\D/g,'')
          const exists = (tcPatients||[]).find(e=>
            e.patient_name?.toLowerCase().trim()===pt.patient_name.toLowerCase().trim()&&
            cleanPh(e.patient_phone)===cleanPh(pt.patient_phone)&&cleanPh(pt.patient_phone).length>=7
          ) || (tcPatients||[]).find(e=>
            e.patient_name?.toLowerCase().trim()===pt.patient_name.toLowerCase().trim()&&
            e.dos===pt.dos&&e.office===pt.office)
          if (exists) { skipped++; continue }
          await saveTcPatient(pt); saved++
        }
      }
      await loadTcPatients()
      setImportRes({saved, skipped})
      notify('Imported '+saved+' patients'+(skipped>0?' ('+skipped+' duplicates skipped)':''))
    } catch(e) { notify('Import failed: '+e.message,'error') }
    setImporting(false)
  }

  const onSave  = async row => { await saveTcPatient(row); notify('Saved') }
  const onDelete = async id => { await sbDel('tc_patients','id=eq.'+id); await loadTcPatients(); notify('Deleted') }

  return (
    <div style={{minHeight:'100vh',background:'#f8fafc'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',padding:'16px 24px 0'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10,marginBottom:14}}>
          <div>
            <div style={{fontSize:10,color:'rgba(255,255,255,.5)',fontWeight:700,letterSpacing:2,marginBottom:2}}>BSBD</div>
            <div style={{fontSize:17,fontWeight:800,color:'white'}}>TC Treatment Tracker</div>
          </div>
          <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap'}}>
            {isManager&&<button onClick={()=>setShowReports(r=>!r)}
              style={{padding:'7px 14px',borderRadius:8,background:showReports?'white':'rgba(255,255,255,.12)',
                color:showReports?'#1e3a5f':'white',border:'1px solid rgba(255,255,255,.25)',fontWeight:700,fontSize:11,cursor:'pointer'}}>
              {showReports?'Back to Tracker':'Reports'}
            </button>}
            <label style={{padding:'7px 14px',borderRadius:8,background:'rgba(255,255,255,.12)',color:'white',
              border:'1px solid rgba(255,255,255,.25)',fontWeight:700,fontSize:11,cursor:'pointer'}}>
              {importing?'Importing...':'↑ Import Month List'}
              <input ref={importRef} type="file" accept=".xlsx,.xls" style={{display:'none'}} onChange={e=>{if(e.target.files[0])handleImport(e.target.files[0])}}/>
            </label>
            <button onClick={()=>setShowAdd(true)}
              style={{padding:'7px 14px',borderRadius:8,background:'rgba(255,255,255,.15)',color:'white',
                border:'1px solid rgba(255,255,255,.3)',fontWeight:700,fontSize:11,cursor:'pointer'}}>
              + Add Patient
            </button>
          </div>
        </div>
        {/* Office tabs */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          <button onClick={()=>{setOffice('all');setTcFilter('all');setDrFilter('all')}}
            style={{padding:'7px 14px',borderRadius:'8px 8px 0 0',fontWeight:700,fontSize:12,border:'none',cursor:'pointer',
              background:office==='all'?'white':'rgba(255,255,255,.12)',color:office==='all'?'#1e3a5f':'rgba(255,255,255,.8)'}}>
            All Offices ({scopedPts.length})
          </button>
          {OFFICES.map(o=>(
            <button key={o} onClick={()=>{setOffice(o);setTcFilter('all');setDrFilter('all')}}
              style={{padding:'7px 14px',borderRadius:'8px 8px 0 0',fontWeight:700,fontSize:12,border:'none',cursor:'pointer',
                background:office===o?'white':'rgba(255,255,255,.12)',color:office===o?'#1e3a5f':'rgba(255,255,255,.8)'}}>
              {o} ({offCounts[o]||0})
            </button>
          ))}
        </div>
      </div>

      {showReports ? (
        <div style={{padding:'16px 0 0'}}><TcAnalytics patients={officePts} activeMonth={activeMonth}/></div>
      ) : (
        <>
          {/* Controls bar */}
          <div style={{background:'white',borderBottom:'1px solid #f1f5f9',padding:'12px 24px'}}>
            {/* Smart month selector */}
            <MonthSelector monthTabs={monthTabs} activeMonth={activeMonth} setActiveMonth={setActiveMonth} counts={monthCounts}/>

            {/* Summary bar — 4 clean tiles */}
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginBottom:12}}>
              {[
                ['PATIENTS',  summary.total,                              '#1e293b', summary.total+' total'],
                ['TX VALUE',  '$'+Math.round(summary.txValue/1000)+'k',   '#1d4ed8', 'presented'],
                ['WITH APPT', Math.round(summary.withAppt*100/(summary.total||1))+'%', '#0d9488', summary.withAppt+' of '+summary.total+' booked'],
                ['PRODUCED',  '$'+Math.round(summary.produced/1000)+'k',  '#16a34a', 'of $'+Math.round(summary.txValue/1000)+'k value'],
              ].map(([l,v,c,sub])=>(
                <div key={l} style={{background:'#f8fafc',borderRadius:9,padding:'10px 12px',border:'1px solid #f1f5f9'}}>
                  <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>{l}</div>
                  <div style={{fontSize:18,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
                  <div style={{fontSize:10,color:'#94a3b8',marginTop:3}}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Filters + search */}
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {[
                ['all','All',        null],
                ['no_appt','No Appt',summary.noAppt,'#dc2626'],
                ['needs_call','Needs Call',null,'#d97706'],
                ['big_case','Big Cases ⭐',summary.bigCases,'#7c3aed'],
                ['finance','Finance Stall',null,'#a21caf'],
                ['has_appt','Has Appt',summary.withAppt,'#0d9488'],
                ['complete','Complete',null,'#16a34a'],
              ].map(([k,l,c,col])=>(
                <button key={k} onClick={()=>setFilter(k)}
                  style={{padding:'5px 12px',borderRadius:99,fontSize:11,fontWeight:700,cursor:'pointer',
                    background:filter===k?(col||'#1e293b'):'white',
                    color:filter===k?'white':(col||'#64748b'),
                    border:'1px solid '+(filter===k?(col||'#1e293b'):'#e2e8f0')}}>
                  {l}{c!=null&&c>0?` (${c})`:''}
                </button>
              ))}
              <div style={{marginLeft:'auto',display:'flex',gap:7,flexWrap:'wrap'}}>
                <input placeholder="Search patients..." value={search} onChange={e=>setSearch(e.target.value)}
                  style={{padding:'6px 10px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,minWidth:160}}/>
                <select value={drFilter} onChange={e=>setDrFilter(e.target.value)}
                  style={{padding:'6px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12}}>
                  <option value="all">All Doctors</option>
                  {doctors.map(d=><option key={d}>{d}</option>)}
                </select>
                <select value={tcFilter} onChange={e=>setTcFilter(e.target.value)}
                  style={{padding:'6px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12}}>
                  <option value="all">All TCs</option>
                  {tcNames.map(t=><option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Import result */}
          {importRes&&(
            <div style={{background:'#f0fdf4',borderBottom:'1px solid #bbf7d0',padding:'10px 24px',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:13,color:'#15803d',fontWeight:600}}>
                Imported {importRes.saved} patients{importRes.skipped>0?` · ${importRes.skipped} duplicates skipped`:''}
              </div>
              <button onClick={()=>setImportRes(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:18}}>✕</button>
            </div>
          )}

          {/* Patient list */}
          <div style={{padding:'14px 24px 60px'}}>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:10,fontWeight:600}}>
              {visible.length} patient{visible.length!==1?'s':''} · sorted by priority
            </div>
            {visible.length===0 ? (
              <div style={{textAlign:'center',padding:'50px 0',color:'#94a3b8'}}>
                <div style={{fontSize:32,marginBottom:10}}>✓</div>
                <div style={{fontSize:15,fontWeight:600,color:'#64748b'}}>No patients match this filter</div>
              </div>
            ) : visible.map(p=>(
              <PatientRow key={p.id} p={p} onSave={onSave} onDelete={onDelete}
                isManager={isManager} user={user} notify={notify} emailPresets={emailPresets}/>
            ))}
          </div>
        </>
      )}

      {showAdd&&(
        <AddModal user={user} office={office==='all'?user.office||'':office}
          onClose={()=>setShowAdd(false)}
          onSave={async row=>{await saveTcPatient(row);await loadTcPatients();notify('Patient added')}}
          notify={notify}/>
      )}
    </div>
  )
}
