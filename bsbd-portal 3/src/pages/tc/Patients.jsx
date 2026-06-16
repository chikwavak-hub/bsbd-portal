import React, { useState, useEffect, useMemo, useRef } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'
import { sbDel } from '../../lib/supabase'
import { importTcExcel } from '../../lib/tcImport'
import TcAnalytics from './TcAnalytics'
import BigCasesView, { isBigCase, getBigCaseCadence, BIG_CASE_REASONS } from './BigCases'
import TcDashboard from './TcDashboard'
import TcAlerts from './TcAlerts'

// ── Constants ──────────────────────────────────────────────────────────────
const OFFICES       = ['Brainerd','Calhoun','Dalton','McCallie']
const EXAM_TYPES    = ['Comp/FMX','Limited/PA','Consult','PANO','LOE','Comp/2bws','TX/Fillings']
const HAS_APPT      = ['Yes','No','Partial']
const EMAIL_OPTS    = ['Yes','No','Not needed']
const BARRIER_TYPES = ['','CareCredit pending','Sunbit pending','Insurance issue',
                       'Re-present needed','Patient deciding','No finances','Other']
const DOCTORS       = ['Dr. E','Dr. Chikwava','Dr. Phillips','Laura','Melissa']
const FINANCE_KW    = ['carecredit','sunbit','finance','thinking about','not financially',
                       'not ready','will call','speak with','denied','rejected']
const MONTHS_EN     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Helpers ────────────────────────────────────────────────────────────────
const BLANK = (office='', tc='') => ({
  id:'tp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
  office, doctor:'', who_tx_plan:tc, who_sched:'', assigned_tc_name:tc,
  dos:todayStr(), month_tab:todayStr().slice(0,7),
  patient_name:'', patient_phone:'', patient_email:'',
  exam_type:'', notes:'', remarks:'',
  appt_1:'', appt_2:'', appt_3:'', appt_hyg:'',
  has_appt:'', email_sent:'',
  call_1_date:'', call_1_notes:'',
  call_2_date:'', call_2_notes:'',
  call_3_date:'', call_3_notes:'',
  total_tx_cost:'', sched_tx_amount:'', ins_expected:'', tx_completed:'',
  finance_stalled:false, finance_barrier:'',
  is_big_case:false, big_case_reason:'', big_case_notes:'',
  status:'consult', tx_plan:null, visits:[], visit_log:[],
  created_at:new Date().toISOString(), updated_at:new Date().toISOString(),
})

const monthLabel = m => {
  if (!m) return ''
  const [y,mo] = m.split('-')
  return MONTHS_EN[parseInt(mo)-1]+' '+y
}

function detectFinanceStall(notes='', remarks='') {
  const t = (notes+' '+remarks).toLowerCase()
  return FINANCE_KW.some(k => t.includes(k))
}

// ── Standard cadence (D3/D5/D10) ──────────────────────────────────────────
function getStdCadence(p) {
  if (p.has_appt==='Yes'||p.appt_1) return {status:'scheduled',label:'Scheduled',color:'#16a34a'}
  const dos = p.dos; if (!dos) return null
  const days = Math.floor((new Date(todayStr())-new Date(dos))/86400000)
  const stages = [{day:3,call:'call_1_date',label:'Day 3 Call'},
                  {day:5,call:'call_2_date',label:'Day 5 Call'},
                  {day:10,call:'call_3_date',label:'Day 10 Call'}]
  for (const s of stages) {
    if (!p[s.call]) {
      const d = days - s.day
      if (d > 0) return {status:'overdue',label:s.label+' overdue '+d+'d',color:'#d97706'}
      if (d === 0) return {status:'due',label:s.label+' DUE TODAY',color:'#0d9488'}
      return {status:'pending',label:s.label+' in '+(s.day-days)+'d',color:'#64748b'}
    }
  }
  if (days >= 14) return {status:'escalate',label:'Escalate — '+days+'d',color:'#dc2626'}
  return {status:'done',label:'3 calls made',color:'#94a3b8'}
}

// ── Predictive flags ───────────────────────────────────────────────────────
function getFlags(p) {
  const flags = []
  const today = new Date(todayStr())
  const days = d => d ? Math.floor((today-new Date(d))/86400000) : 999
  if (p.has_appt==='No'||(!p.has_appt&&!p.appt_1)) flags.push({type:'no_appt',label:'No Appt',color:'#dc2626'})
  if (p.has_appt!=='Yes') {
    const last = p.call_3_date||p.call_2_date||p.call_1_date
    if (!last) flags.push({type:'needs_call',label:'Call Needed',color:'#d97706'})
    else if (days(last)>=5) flags.push({type:'overdue_call',label:'Call Overdue '+days(last)+'d',color:'#d97706'})
  }
  if (p.finance_stalled||detectFinanceStall(p.notes,p.remarks))
    flags.push({type:'finance',label:'Finance Stall',color:'#7c3aed'})
  if (N(p.tx_completed)>0&&!p.appt_hyg)
    flags.push({type:'recall',label:'Recall Needed',color:'#0d9488'})
  return flags
}

// ── Row input helper ────────────────────────────────────────────────────────
// ── Format helpers ─────────────────────────────────────────────────────────
function fmtPhone(v) {
  const d = (v||'').replace(/\D/g,'').slice(0,10)
  if (d.length===0) return ''
  if (d.length<=3) return d
  if (d.length<=6) return '('+d.slice(0,3)+') '+d.slice(3)
  return '('+d.slice(0,3)+') '+d.slice(3,6)+'-'+d.slice(6)
}
function fmtCurrency(v) {
  const d = (v||'').toString().replace(/[^0-9.]/g,'')
  return d
}

const INPUT_STYLES = {
  base: {width:'100%',boxSizing:'border-box',padding:'7px 8px',borderRadius:6,
    border:'1px solid #e2e8f0',fontSize:12,outline:'none'},
  focus: {borderColor:'#1d4ed8'},
}

const Inp = ({label, value, onChange, type='text', opts, span, format}) => {
  const handleChange = (raw) => {
    if (format==='phone')    return onChange(fmtPhone(raw))
    if (format==='currency') return onChange(fmtCurrency(raw))
    return onChange(raw)
  }
  const inputType = type==='date' ? 'date' : format==='currency' ? 'text' : type
  const inputMode = format==='currency' ? 'decimal' : format==='phone' ? 'tel' : undefined
  const placeholder = format==='phone' ? '(000) 000-0000'
                    : format==='currency' ? '0.00'
                    : format==='date' ? 'YYYY-MM-DD' : undefined

  return (
    <div style={span?{gridColumn:'1/-1'}:{}}>
      <div style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:3}}>{label}</div>
      {opts ? (
        <select value={value||''} onChange={e=>onChange(e.target.value)}
          style={INPUT_STYLES.base}
          onFocus={e=>e.target.style.borderColor='#1d4ed8'}
          onBlur={e=>e.target.style.borderColor='#e2e8f0'}>
          <option value="">—</option>
          {opts.map(o=><option key={o}>{o}</option>)}
        </select>
      ) : (
        <input type={inputType} inputMode={inputMode} value={value||''} placeholder={placeholder}
          onChange={e=>handleChange(e.target.value)}
          style={INPUT_STYLES.base}
          onFocus={e=>e.target.style.borderColor='#1d4ed8'}
          onBlur={e=>e.target.style.borderColor='#e2e8f0'}/>
      )}
    </div>
  )
}

// ── Past appointment helpers ───────────────────────────────────────────────
const APPT_KEYS = [
  {key:'appt_1',   label:'1st Appointment'},
  {key:'appt_2',   label:'2nd Appointment'},
  {key:'appt_3',   label:'3rd Appointment'},
  {key:'appt_hyg', label:'Hygiene Appointment'},
]

function getPastApptsNeedingUpdate(p) {
  const today = todayStr()
  const log   = p.visit_log || []
  return APPT_KEYS.filter(({key}) => {
    const date = p[key]
    if (!date || date > today) return false          // no date or future
    return !log.find(e => e.appt_key === key)        // no log entry yet
  })
}

// ── Update Visit Modal ────────────────────────────────────────────────────
function UpdateVisitModal({p, apptKey, apptLabel, onSave, onClose, notify}) {
  const [status,    setStatus]    = useState('showed')
  const [amtDone,   setAmtDone]   = useState('')
  const [notes,     setNotes]     = useState('')
  const [checklist, setChecklist] = useState({})
  const [saving,    setSaving]    = useState(false)

  const visits  = p.visits || p.tx_plan?.visits || []
  // Map visit key to visit index (appt_1 = visit 1, appt_2 = visit 2, etc.)
  const vIdx    = APPT_KEYS.findIndex(a => a.key === apptKey)
  const visit   = visits[vIdx] || null
  const procs   = visit?.procedures || []

  // Auto-calculate amount from checked procedures
  const calcAmt = Object.entries(checklist)
    .filter(([,v]) => v)
    .reduce((s, [code]) => {
      const p2 = procs.find(pr => pr.code === code)
      return s + N(p2?.pt_amt || p2?.fee || 0)
    }, 0)

  const handleSave = async () => {
    setSaving(true)
    const entry = {
      appt_key:   apptKey,
      date:       p[apptKey],
      status,
      amount_completed: amtDone ? N(amtDone) : calcAmt,
      procedures_completed: Object.entries(checklist).filter(([,v])=>v).map(([k])=>k),
      notes,
      logged_at:  new Date().toISOString(),
    }

    const newLog     = [...(p.visit_log||[]).filter(e=>e.appt_key!==apptKey), entry]
    const newTxDone  = newLog.reduce((s,e) => s + N(e.amount_completed), 0)
    const newHasAppt = newLog.some(e=>e.status==='showed') ? 'Yes' : p.has_appt

    await onSave({
      ...p,
      visit_log:    newLog,
      tx_completed: newTxDone || p.tx_completed,
      has_appt:     newHasAppt,
      updated_at:   new Date().toISOString(),
    })
    notify('Visit updated')
    setSaving(false)
    onClose()
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:500,
      display:'flex',alignItems:'center',justifyContent:'center',padding:'16px'}}>
      <div style={{background:'white',borderRadius:14,padding:24,width:'100%',maxWidth:500,
        boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
        {/* Header */}
        <div style={{marginBottom:18}}>
          <div style={{fontSize:10,fontWeight:800,color:'#94a3b8',letterSpacing:1,marginBottom:4}}>
            UPDATE VISIT OUTCOME
          </div>
          <div style={{fontSize:16,fontWeight:800,color:'#1e293b'}}>{p.patient_name}</div>
          <div style={{fontSize:12,color:'#64748b',marginTop:2}}>
            {apptLabel} — {p[apptKey]}
          </div>
        </div>

        {/* Did patient show? */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:8}}>
            APPOINTMENT OUTCOME
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            {[
              ['showed',      'Patient Showed',   '#16a34a', '#dcfce7'],
              ['no_show',     'No Show',          '#dc2626', '#fee2e2'],
              ['cancelled',   'Cancelled',        '#d97706', '#fef9c3'],
              ['rescheduled', 'Rescheduled',      '#1d4ed8', '#dbeafe'],
            ].map(([val,lbl,col,bg]) => (
              <button key={val} onClick={()=>setStatus(val)}
                style={{padding:'10px 12px',borderRadius:9,fontWeight:700,fontSize:12,cursor:'pointer',
                  border:'2px solid '+(status===val?col:'#e2e8f0'),
                  background:status===val?bg:'white',
                  color:status===val?col:'#64748b'}}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {/* Procedures checklist from TX plan */}
        {status==='showed' && procs.length > 0 && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:8}}>
              PROCEDURES COMPLETED (from TX plan)
            </div>
            <div style={{border:'1px solid #e2e8f0',borderRadius:8,overflow:'hidden'}}>
              {procs.map((proc,i) => (
                <label key={proc.code} onClick={()=>setChecklist(c=>({...c,[proc.code]:!c[proc.code]}))}
                  style={{display:'flex',alignItems:'center',gap:10,padding:'8px 12px',cursor:'pointer',
                    borderTop:i>0?'1px solid #f1f5f9':'none',
                    background:checklist[proc.code]?'#f0fdf4':'white'}}>
                  <input type="checkbox" checked={!!checklist[proc.code]}
                    onChange={()=>{}} style={{pointerEvents:'none'}}/>
                  <span style={{flex:1,fontSize:12,color:'#1e293b'}}>
                    <b style={{color:'#1d4ed8'}}>{proc.code}</b> — {proc.description}
                    {proc.tooth&&<span style={{color:'#94a3b8',marginLeft:4}}>#{proc.tooth}</span>}
                  </span>
                  <span style={{fontSize:12,fontWeight:600,color:'#d97706'}}>
                    ${N(proc.pt_amt||proc.fee||0).toLocaleString()}
                  </span>
                </label>
              ))}
            </div>
            {calcAmt > 0 && (
              <div style={{fontSize:12,color:'#16a34a',fontWeight:700,marginTop:6,textAlign:'right'}}>
                Patient portion from checked: ${calcAmt.toLocaleString()}
              </div>
            )}
          </div>
        )}

        {/* Manual amount if no tx plan or override */}
        {status==='showed' && (
          <div style={{marginBottom:14}}>
            <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:5}}>
              {procs.length>0?'OVERRIDE AMOUNT (optional)':'AMOUNT COMPLETED ($)'}
            </div>
            <input type="text" inputMode="decimal" value={amtDone}
              onChange={e=>setAmtDone(e.target.value.replace(/[^0-9.]/g,''))}
              placeholder={procs.length>0?'Leave blank to use procedure total':'0.00'}
              style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',borderRadius:7,
                border:'1px solid #e2e8f0',fontSize:13}}/>
          </div>
        )}

        {/* Notes */}
        <div style={{marginBottom:18}}>
          <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:5}}>NOTES</div>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="What was discussed, next steps..."
            style={{width:'100%',boxSizing:'border-box',minHeight:70,padding:'8px 10px',
              borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,resize:'vertical'}}/>
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{padding:'9px 18px',borderRadius:8,background:'#f1f5f9',color:'#64748b',
              border:'none',fontWeight:700,cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{padding:'9px 18px',borderRadius:8,background:'#1d4ed8',color:'white',
              border:'none',fontWeight:700,cursor:'pointer'}}>
            {saving?'Saving...':'Save Visit'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ── TX Plan Upload + Display ───────────────────────────────────────────────
function TxPlanPanel({ p, onSave, notify }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = React.useRef()

  const handleUpload = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const { extractTxPlanText, parseTxPlanText } = await import('../../lib/txPlanParser')
      const text   = await extractTxPlanText(file)
      const parsed = parseTxPlanText(text)
      if (!parsed.patient_name && parsed.visits.length === 0) {
        notify('Could not read PDF -- check it is a Dentrix TX plan', 'error')
        setUploading(false); return
      }
      await onSave({...p,
        tx_plan:       parsed,
        visits:        parsed.visits,
        total_tx_cost: parsed.case_total  || p.total_tx_cost,
        ins_expected:  parsed.est_ins     || p.ins_expected,
        notes:         p.notes || (parsed.notes || ''),
        updated_at:    new Date().toISOString(),
      })
      notify('TX plan attached')
    } catch(e) { notify('Upload failed: '+e.message, 'error'); console.error(e) }
    setUploading(false)
  }

  const plan  = p.tx_plan
  const visits = p.visits || plan?.visits || []

  return (
    <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0',marginTop:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:800,color:'#1e293b',letterSpacing:.5}}>TX PLAN</div>
        <label style={{padding:'5px 12px',borderRadius:7,background:'#1d4ed8',color:'white',
          fontWeight:700,fontSize:11,cursor:'pointer'}}>
          {uploading ? 'Reading...' : plan ? 'Replace PDF' : 'Attach PDF'}
          <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}}
            onChange={e=>{ if(e.target.files[0]) handleUpload(e.target.files[0]) }}/>
        </label>
      </div>

      {!plan && !uploading && (
        <div style={{textAlign:'center',padding:'12px 0',color:'#94a3b8',fontSize:12}}>
          No TX plan attached -- upload the accepted Dentrix PDF
        </div>
      )}
      {uploading && (
        <div style={{textAlign:'center',padding:'12px 0',color:'#1d4ed8',fontSize:12,fontWeight:600}}>Reading PDF...</div>
      )}

      {plan && !uploading && (
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(110px,1fr))',gap:8,marginBottom:10}}>
            {[['Case Total',plan.case_total,'#1d4ed8'],['Est Ins',plan.est_ins,'#0d9488'],
              ['Est Patient',plan.est_patient,'#d97706'],['Write-Off',plan.est_writeoff,'#64748b']].map(([l,v,c])=>(
              <div key={l} style={{background:'#f8fafc',borderRadius:7,padding:'8px 10px'}}>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,marginBottom:2}}>{l}</div>
                <div style={{fontSize:14,fontWeight:800,color:c}}>{v?'$'+N(v).toLocaleString():'--'}</div>
              </div>
            ))}
          </div>
          {plan.ins_carrier && (
            <div style={{background:'#f0f9ff',borderRadius:7,padding:'7px 10px',marginBottom:8,fontSize:11}}>
              <b style={{color:'#0369a1'}}>{plan.ins_carrier}</b>
              {plan.ins_annual_max>0&&<span style={{color:'#64748b',marginLeft:8}}>Max: ${N(plan.ins_annual_max).toLocaleString()}</span>}
              {plan.ins_deductible>0&&<span style={{color:'#64748b',marginLeft:8}}>Ded: ${N(plan.ins_deductible).toLocaleString()}</span>}
            </div>
          )}
          {visits.length > 0 && (
            <div>
              <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:6}}>VISITS</div>
              {visits.map((v,vi)=>(
                <div key={vi} style={{marginBottom:8,border:'1px solid #f1f5f9',borderRadius:8,overflow:'hidden'}}>
                  <div style={{background:'#f8fafc',padding:'6px 10px',display:'flex',justifyContent:'space-between',fontSize:11}}>
                    <b style={{color:'#1e293b'}}>Visit {v.visit_num||vi+1}</b>
                    <div style={{display:'flex',gap:12}}>
                      <span>Total: <b>${N(v.total).toLocaleString()}</b></span>
                      <span style={{color:'#0d9488'}}>Ins: ${N(v.ins_total).toLocaleString()}</span>
                      <span style={{color:'#d97706'}}>Pt: ${N(v.pt_total).toLocaleString()}</span>
                    </div>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                    <thead><tr style={{background:'#f1f5f9'}}>
                      {['Code','Description','Tooth','Fee','Ins','Patient'].map(h=>(
                        <th key={h} style={{padding:'4px 8px',textAlign:'left',color:'#64748b',fontWeight:700}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {(v.procedures||[]).map((proc,pi)=>(
                        <tr key={pi} style={{borderTop:'1px solid #f8fafc',background:pi%2===0?'white':'#fafafa'}}>
                          <td style={{padding:'4px 8px',fontWeight:700,color:'#1d4ed8'}}>{proc.code}</td>
                          <td style={{padding:'4px 8px',color:'#475569'}}>{proc.description}</td>
                          <td style={{padding:'4px 8px',textAlign:'center',color:'#64748b'}}>{proc.tooth||'--'}</td>
                          <td style={{padding:'4px 8px',textAlign:'right'}}>{proc.fee?'$'+N(proc.fee).toLocaleString():'--'}</td>
                          <td style={{padding:'4px 8px',textAlign:'right',color:'#0d9488'}}>{proc.ins_amt?'$'+N(proc.ins_amt).toLocaleString():'--'}</td>
                          <td style={{padding:'4px 8px',textAlign:'right',color:'#d97706'}}>{proc.pt_amt?'$'+N(proc.pt_amt).toLocaleString():'--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


// ── Patient row (expanded edit/view) ──────────────────────────────────────
function PatientRow({p, onSave, onDelete, isManager, user, notify, emailPresets}) {
  const [open,  setOpen]  = useState(false)
  const [edit,  setEdit]  = useState(false)
  const [form,  setForm]  = useState(p)
  const [busy,  setBusy]  = useState(false)
  const [email,       setEmail]       = useState(false)
  const [updateAppt,  setUpdateAppt]  = useState(null) // appt key needing update
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const pastAppts = getPastApptsNeedingUpdate(p)

  const flags = getFlags(p)
  const cad   = isBigCase(p) ? getBigCaseCadence(p) : getStdCadence(p)

  const save = async () => {
    setBusy(true)
    await onSave({...form,
      month_tab:(form.dos||todayStr()).slice(0,7),
      is_big_case: form.is_big_case || N(form.total_tx_cost)>=3000,
      finance_stalled: form.finance_stalled||detectFinanceStall(form.notes,form.remarks),
      updated_at:new Date().toISOString()})
    setBusy(false); setEdit(false)
  }

  return (
    <>
      <tr style={{borderBottom:'1px solid #f1f5f9',background:open?'#f0f9ff':'white',cursor:'pointer'}}
        onClick={()=>setOpen(o=>!o)}>
        <td style={{padding:'8px 10px',fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>{p.dos||''}</td>
        <td style={{padding:'8px 10px',fontSize:12,fontWeight:700,color:'#1e293b',whiteSpace:'nowrap'}}>
          {p.patient_name}
          {isBigCase(p)&&<span style={{marginLeft:5,fontSize:9,color:'#7c3aed',fontWeight:800}}>⭐</span>}
          {pastAppts.length>0&&(
            <span style={{marginLeft:6,fontSize:9,fontWeight:800,padding:'1px 6px',borderRadius:4,
              background:'#fef9c3',color:'#854d0e',cursor:'pointer'}}
              onClick={e=>{e.stopPropagation();setOpen(true);setUpdateAppt(pastAppts[0].key)}}>
              {pastAppts.length} visit{pastAppts.length>1?'s':''} to update
            </span>
          )}
        </td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.patient_phone||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.doctor||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.who_tx_plan||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.exam_type||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#64748b',maxWidth:180,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.notes||'—'}</td>
        <td style={{padding:'8px 10px'}}>
          {p.has_appt==='Yes'
            ? <span style={{fontSize:10,fontWeight:700,color:'#16a34a',background:'#dcfce7',padding:'2px 7px',borderRadius:99}}>Yes</span>
            : p.has_appt==='No'
            ? <span style={{fontSize:10,fontWeight:700,color:'#dc2626',background:'#fee2e2',padding:'2px 7px',borderRadius:99}}>No</span>
            : <span style={{fontSize:10,color:'#94a3b8'}}>—</span>}
        </td>
        <td style={{padding:'8px 10px',fontSize:11,textAlign:'right',color:'#1d4ed8',fontWeight:600}}>
          {p.total_tx_cost?USD(p.total_tx_cost):''}
        </td>
        <td style={{padding:'8px 6px'}}>
          {cad&&<div style={{fontSize:9,fontWeight:700,padding:'2px 7px',borderRadius:4,
            background:cad.color+'18',color:cad.color,whiteSpace:'nowrap'}}>{cad.label}</div>}
        </td>
        <td style={{padding:'8px 6px'}}>
          <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
            {flags.map((f,i)=>(
              <span key={i} style={{fontSize:9,fontWeight:700,padding:'2px 5px',borderRadius:4,
                background:f.color+'18',color:f.color,whiteSpace:'nowrap'}}>{f.label}</span>
            ))}
          </div>
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={11} style={{background:'#f8fafc',padding:0,borderBottom:'2px solid #e2e8f0'}}>
            <div style={{padding:14}}>
              {!edit ? (
                <div>
                  {/* Past appointment prompts */}
                  {pastAppts.length>0&&(
                    <div style={{marginBottom:12,background:'#fffbeb',borderRadius:10,
                      padding:'12px 14px',border:'1px solid #fde68a'}}>
                      <div style={{fontSize:11,fontWeight:800,color:'#92400e',marginBottom:8}}>
                        {pastAppts.length} appointment{pastAppts.length>1?'s':''} need updating
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        {pastAppts.map(({key,label})=>(
                          <button key={key} onClick={e=>{e.stopPropagation();setUpdateAppt(key)}}
                            style={{padding:'7px 14px',borderRadius:8,background:'#1d4ed8',color:'white',
                              border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                            Update {label} ({p[key]})
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Visit log summary */}
                  {(p.visit_log||[]).length>0&&(
                    <div style={{marginBottom:12,background:'#f0fdf4',borderRadius:10,
                      padding:'10px 14px',border:'1px solid #bbf7d0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#15803d',marginBottom:6}}>VISIT LOG</div>
                      {(p.visit_log||[]).map((e,i)=>{
                        const apptDef = APPT_KEYS.find(a=>a.key===e.appt_key)
                        return (
                          <div key={i} style={{display:'flex',gap:10,alignItems:'center',
                            padding:'4px 0',borderTop:i>0?'1px solid #dcfce7':'none',fontSize:12}}>
                            <span style={{fontWeight:700,color:'#15803d',fontSize:10}}>
                              {apptDef?.label||e.appt_key}
                            </span>
                            <span style={{color:'#64748b'}}>{e.date}</span>
                            <span style={{fontWeight:700,
                              color:e.status==='showed'?'#16a34a':e.status==='no_show'?'#dc2626':'#d97706'}}>
                              {e.status==='showed'?'Showed':e.status==='no_show'?'No Show':
                               e.status==='cancelled'?'Cancelled':'Rescheduled'}
                            </span>
                            {e.amount_completed>0&&(
                              <span style={{fontWeight:700,color:'#16a34a'}}>
                                ${N(e.amount_completed).toLocaleString()} completed
                              </span>
                            )}
                            {e.notes&&<span style={{color:'#94a3b8',fontStyle:'italic',fontSize:11}}>{e.notes}</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:10}}>
                    <b style={{fontSize:13,color:'#1e293b'}}>{p.patient_name}</b>
                    <div style={{display:'flex',gap:7}}>
                      <button onClick={e=>{e.stopPropagation();setEmail(true)}}
                        style={{padding:'5px 12px',borderRadius:7,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Email</button>
                      <button onClick={e=>{e.stopPropagation();setEdit(true)}}
                        style={{padding:'5px 12px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Edit</button>
                      {isManager&&<button onClick={e=>{e.stopPropagation();if(window.confirm('Delete?'))onDelete(p.id)}}
                        style={{padding:'5px 12px',borderRadius:7,background:'#fee2e2',color:'#dc2626',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Delete</button>}
                    </div>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:10}}>
                    <div style={{background:'white',borderRadius:8,padding:10,border:'1px solid #e2e8f0',fontSize:12}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:6}}>APPOINTMENTS</div>
                      {[['1st',p.appt_1],['2nd',p.appt_2],['Hyg',p.appt_hyg]].map(([l,v])=>(
                        <div key={l}><b>{l}:</b> {v||'—'}</div>
                      ))}
                    </div>
                    <div style={{background:'white',borderRadius:8,padding:10,border:'1px solid #e2e8f0',fontSize:12}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:6}}>FINANCIALS</div>
                      <div><b>Total TX:</b> {USD(p.total_tx_cost||0)}</div>
                      <div><b>Scheduled:</b> {USD(p.sched_tx_amount||0)}</div>
                      <div><b>Ins Expected:</b> {USD(p.ins_expected||0)}</div>
                      <div style={{color:'#16a34a',fontWeight:700}}><b>Completed:</b> {USD(p.tx_completed||0)}</div>
                      {p.total_tx_cost>0&&(
                        <div style={{marginTop:6,height:3,background:'#f1f5f9',borderRadius:2}}>
                          <div style={{height:'100%',background:'#16a34a',borderRadius:2,
                            width:Math.min(Math.round(N(p.tx_completed)*100/N(p.total_tx_cost)),100)+'%'}}/>
                        </div>
                      )}
                    </div>
                    <div style={{background:'white',borderRadius:8,padding:10,border:'1px solid #e2e8f0',fontSize:12}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:6}}>CALLS</div>
                      {[['1st',p.call_1_date,p.call_1_notes],['2nd',p.call_2_date,p.call_2_notes],
                        ['3rd',p.call_3_date,p.call_3_notes]].map(([n,d,note])=>(
                        <div key={n} style={{marginBottom:3}}>
                          <b>{n}:</b> {d||'—'}
                          {note&&<div style={{fontSize:10,color:'#64748b',marginLeft:8,fontStyle:'italic'}}>{note}</div>}
                        </div>
                      ))}
                    </div>
                    {(p.notes||p.remarks||p.finance_barrier)&&(
                      <div style={{background:'white',borderRadius:8,padding:10,border:'1px solid #e2e8f0',fontSize:12}}>
                        <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:6}}>NOTES</div>
                        {p.notes&&<div>{p.notes}</div>}
                        {p.remarks&&<div style={{color:'#64748b',fontStyle:'italic'}}>{p.remarks}</div>}
                        {p.finance_barrier&&<div style={{color:'#7c3aed',fontWeight:600}}>Barrier: {p.finance_barrier}</div>}
                      </div>
                    )}
                  </div>
                  <TxPlanPanel p={p} onSave={onSave} notify={notify}/>
                </div>
              ) : (
                <div onClick={e=>e.stopPropagation()}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:12}}>
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
                    <Inp label="Patient Name"   value={form.patient_name}    onChange={v=>set('patient_name',v)}/>
                    <Inp label="Phone"          value={form.patient_phone}   onChange={v=>set('patient_phone',v)} format="phone"/>
                    <Inp label="Email"          value={form.patient_email}   onChange={v=>set('patient_email',v)}/>
                    <Inp label="Doctor"         value={form.doctor}          onChange={v=>set('doctor',v)}       opts={DOCTORS}/>
                    <Inp label="Date of Service" value={form.dos}            onChange={v=>set('dos',v)} type="date"/>
                    <Inp label="Exam Type"      value={form.exam_type}       onChange={v=>set('exam_type',v)}    opts={EXAM_TYPES}/>
                    <Inp label="TX Plan By"     value={form.who_tx_plan}     onChange={v=>set('who_tx_plan',v)}/>
                    <Inp label="Sched By"       value={form.who_sched}       onChange={v=>set('who_sched',v)}/>
                    <Inp label="1st Appt"       value={form.appt_1}          onChange={v=>set('appt_1',v)} type="date"/>
                    <Inp label="2nd Appt"       value={form.appt_2}          onChange={v=>set('appt_2',v)} type="date"/>
                    <Inp label="3rd Appt"       value={form.appt_3}          onChange={v=>set('appt_3',v)} type="date"/>
                    <Inp label="Hyg Appt"       value={form.appt_hyg}        onChange={v=>set('appt_hyg',v)}/>
                    <Inp label="Has Appt"       value={form.has_appt}        onChange={v=>set('has_appt',v)}     opts={HAS_APPT}/>
                    <Inp label="Email Sent"     value={form.email_sent}      onChange={v=>set('email_sent',v)}   opts={EMAIL_OPTS}/>
                    <Inp label="1st Call"       value={form.call_1_date}     onChange={v=>set('call_1_date',v)} type="date"/>
                    <Inp label="1st Notes"      value={form.call_1_notes}    onChange={v=>set('call_1_notes',v)}/>
                    <Inp label="2nd Call"       value={form.call_2_date}     onChange={v=>set('call_2_date',v)} type="date"/>
                    <Inp label="2nd Notes"      value={form.call_2_notes}    onChange={v=>set('call_2_notes',v)}/>
                    <Inp label="3rd Call"       value={form.call_3_date}     onChange={v=>set('call_3_date',v)} type="date"/>
                    <Inp label="3rd Notes"      value={form.call_3_notes}    onChange={v=>set('call_3_notes',v)}/>
                    <Inp label="Total TX Cost"  value={form.total_tx_cost}   onChange={v=>set('total_tx_cost',v)} format="currency"/>
                    <Inp label="Sched TX"       value={form.sched_tx_amount} onChange={v=>set('sched_tx_amount',v)} format="currency"/>
                    <Inp label="Ins Expected"   value={form.ins_expected}    onChange={v=>set('ins_expected',v)} format="currency"/>
                    <Inp label="TX Completed"   value={form.tx_completed}    onChange={v=>set('tx_completed',v)} format="currency"/>
                    <Inp label="Finance Barrier" value={form.finance_barrier} onChange={v=>set('finance_barrier',v)} opts={BARRIER_TYPES}/>
                    <Inp label="Big Case Reason" value={form.big_case_reason} onChange={v=>set('big_case_reason',v)} opts={['', ...BIG_CASE_REASONS]}/>
                    <Inp label="Notes" value={form.notes}   onChange={v=>set('notes',v)}   span/>
                    <Inp label="Remarks" value={form.remarks} onChange={v=>set('remarks',v)} span/>
                    {(form.is_big_case||N(form.total_tx_cost)>=3000)&&(
                      <Inp label="Big Case Notes" value={form.big_case_notes} onChange={v=>set('big_case_notes',v)} span/>
                    )}
                  </div>
                  <div style={{marginTop:10,display:'flex',alignItems:'center',gap:8}}>
                    <input type="checkbox" checked={!!form.finance_stalled} onChange={e=>set('finance_stalled',e.target.checked)}/>
                    <label style={{fontSize:12,color:'#7c3aed',fontWeight:600}}>Finance Stalled</label>
                    <input type="checkbox" style={{marginLeft:12}} checked={!!form.is_big_case||N(form.total_tx_cost)>=3000}
                      onChange={e=>set('is_big_case',e.target.checked)}/>
                    <label style={{fontSize:12,color:'#1d4ed8',fontWeight:600}}>Big Case ⭐</label>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {updateAppt && (
        <UpdateVisitModal
          p={p}
          apptKey={updateAppt}
          apptLabel={APPT_KEYS.find(a=>a.key===updateAppt)?.label||updateAppt}
          onSave={async row => { await onSave(row) }}
          onClose={()=>setUpdateAppt(null)}
          notify={notify}/>
      )}
      {email && (
        <EmailModal p={p} user={user} onClose={()=>setEmail(false)} notify={notify} emailPresets={emailPresets}/>
      )}
    </>
  )
}

// ── AI Email Modal ─────────────────────────────────────────────────────────
function EmailModal({p, user, onClose, notify, emailPresets}) {
  const [loading,  setLoading]  = useState(false)
  const [subject,  setSubject]  = useState('Your Treatment Plan Summary -- Beautiful Smiles by Design')
  const [body,     setBody]     = useState('')
  const [err,      setErr]      = useState('')
  const [preset,   setPreset]   = useState('warm')
  const [custom,   setCustom]   = useState('')

  const presets = (emailPresets && emailPresets.length)
    ? emailPresets
    : [{id:'warm',label:'Warm & Encouraging',instruction:'Use a warm, friendly, encouraging tone.'}]

  // Build treatment sequence text from attached TX plan
  const buildSequence = () => {
    const visits = p.visits || p.tx_plan?.visits || []
    if (!visits.length) return ''
    let seq = '\n\nTREATMENT SEQUENCE (from attached treatment plan):\n'
    visits.forEach((v, i) => {
      const procs = (v.procedures||[]).map(pr =>
        pr.code + ' ' + pr.description + (pr.tooth ? ' (tooth '+pr.tooth+')' : '')
      ).join('; ')
      seq += 'Visit ' + (v.visit_num||i+1) + ': ' + (procs||'procedures') +
             ' -- patient portion approx $' + N(v.pt_total||0).toLocaleString() + '\n'
    })
    seq += '\nExplain this sequence to the patient: what each visit accomplishes, why that step is needed before the next, and how completing each phase moves them toward a healthy result.'
    return seq
  }

  const generate = async () => {
    setLoading(true); setErr('')
    try {
      const ptPortion = N(p.total_tx_cost) - N(p.ins_expected)
      const finNote   = p.finance_stalled
        ? 'The patient has a finance concern (' + (p.finance_barrier||'finances') + '). Mention CareCredit and Sunbit warmly.'
        : ''
      const presetObj  = presets.find(x => x.id === preset) || presets[0]
      const presetInst = presetObj?.instruction || ''
      const sequence   = buildSequence()
      const customNote = custom.trim() ? '\n\nADDITIONAL INSTRUCTION FROM THE COORDINATOR: ' + custom.trim() : ''

      const prompt = `You are a warm, professional treatment coordinator at Beautiful Smiles by Design dental practice.
Write a follow-up email to a patient about their treatment plan. Be clear, friendly, and encouraging -- not clinical or pushy.

TONE/ANGLE FOR THIS EMAIL: ${presetInst}

Patient: ${p.patient_name}
Doctor: ${p.doctor||'Dr. Chikwava'}
Exam date: ${p.dos||''}
Exam type: ${p.exam_type||''}
Treatment notes: ${p.notes||''}
Remarks: ${p.remarks||''}
Total treatment cost: ${p.total_tx_cost?'$'+N(p.total_tx_cost).toLocaleString():'not specified'}
Insurance expected to cover: ${p.ins_expected?'$'+N(p.ins_expected).toLocaleString():'unknown'}
Patient estimated portion: ${ptPortion>0?'$'+ptPortion.toLocaleString():'unknown'}
${finNote}${sequence}${customNote}

Instructions:
- Address patient by first name only
- Follow the TONE/ANGLE specified above
- If a treatment sequence is provided, walk the patient through it step by step in plain language
- Show a simple cost breakdown
- End with a clear call to action to schedule the next step
- Sign off as ${user.name||'Your Care Team'}, Beautiful Smiles by Design
- Keep under 250 words. Plain text only, no markdown.`

      const fnUrl = window.location.origin + '/api/ai-email'
      const res   = await fetch(fnUrl, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ prompt }),
      })
      if (res.status === 404) throw new Error('Function not found (404)')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Request failed')
      if (!data.text) throw new Error('No response from AI')
      setBody(data.text)
    } catch(e) { setErr('Failed: '+e.message) }
    setLoading(false)
  }

  const hasPlan = (p.visits||p.tx_plan?.visits||[]).length > 0

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:400,
      display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div style={{background:'white',borderRadius:14,padding:22,width:'100%',maxWidth:600}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
          <div>
            <div style={{fontSize:14,fontWeight:800,color:'#1e293b'}}>TX Plan Email</div>
            <div style={{fontSize:11,color:'#64748b'}}>{p.patient_name} · {p.patient_email||'No email on file'}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#94a3b8'}}>X</button>
        </div>

        {/* Preset selector */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:6}}>EMAIL ANGLE</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {presets.map(ps=>(
              <button key={ps.id} onClick={()=>setPreset(ps.id)}
                title={ps.description||''}
                style={{padding:'6px 12px',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',
                  border:'2px solid '+(preset===ps.id?'#1d4ed8':'#e2e8f0'),
                  background:preset===ps.id?'#eff6ff':'white',
                  color:preset===ps.id?'#1d4ed8':'#64748b'}}>
                {ps.label}
              </button>
            ))}
          </div>
        </div>

        {/* TX plan sequence indicator */}
        {hasPlan && (
          <div style={{marginBottom:12,padding:'8px 12px',background:'#f0fdf4',borderRadius:8,
            border:'1px solid #bbf7d0',fontSize:11,color:'#15803d',fontWeight:600}}>
            TX plan attached -- email will explain the {(p.visits||p.tx_plan?.visits||[]).length}-visit treatment sequence
          </div>
        )}

        {/* Custom instruction */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:4}}>
            ANYTHING SPECIFIC TO MENTION? (optional)
          </div>
          <input value={custom} onChange={e=>setCustom(e.target.value)}
            placeholder="e.g. mention we can split into two visits, reference her upcoming trip..."
            style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12}}/>
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>SUBJECT</div>
          <input value={subject} onChange={e=>setSubject(e.target.value)}
            style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12}}/>
        </div>

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
              style={{width:'100%',boxSizing:'border-box',minHeight:200,padding:'9px 11px',
                borderRadius:8,border:'1px solid #e2e8f0',fontSize:12,lineHeight:1.6,resize:'vertical'}}/>
          </div>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{padding:'8px 16px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
          {body&&<button onClick={()=>{navigator.clipboard.writeText(body);notify('Copied')}}
            style={{padding:'8px 16px',borderRadius:7,background:'#f8fafc',border:'1px solid #e2e8f0',fontWeight:700,cursor:'pointer'}}>Copy</button>}
          {body&&<button onClick={()=>{
            window.open('mailto:'+(p.patient_email||'')+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body))
            notify('Email client opened')
          }} style={{padding:'8px 16px',borderRadius:7,background:'#0d9488',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>Open in Email</button>}
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
      is_big_case: form.is_big_case||N(form.total_tx_cost)>=3000,
      finance_stalled: detectFinanceStall(form.notes,form.remarks),
      updated_at:new Date().toISOString()})
    setBusy(false); onClose()
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300,
      display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'30px 16px',overflowY:'auto'}}>
      <div style={{background:'white',borderRadius:14,padding:22,width:'100%',maxWidth:640,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div style={{fontSize:15,fontWeight:800,color:'#1e293b'}}>Add New Patient</div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#94a3b8'}}>X</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9,marginBottom:12}}>
          <Inp label="Patient Name *" value={form.patient_name}  onChange={v=>set('patient_name',v)}/>
          <Inp label="Phone"          value={form.patient_phone} onChange={v=>set('patient_phone',v)} format="phone"/>
          <Inp label="Doctor"         value={form.doctor}        onChange={v=>set('doctor',v)}       opts={DOCTORS}/>
          <Inp label="Date of Service" value={form.dos}          onChange={v=>set('dos',v)} type="date"/>
          <Inp label="Exam Type"      value={form.exam_type}     onChange={v=>set('exam_type',v)}    opts={EXAM_TYPES}/>
          <Inp label="TX Plan By"     value={form.who_tx_plan}   onChange={v=>set('who_tx_plan',v)}/>
          <Inp label="Total TX Cost"  value={form.total_tx_cost} onChange={v=>set('total_tx_cost',v)} format="currency"/>
          <Inp label="Has Appt"       value={form.has_appt}      onChange={v=>set('has_appt',v)}     opts={HAS_APPT}/>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>NOTES</div>
          <textarea value={form.notes||''} onChange={e=>set('notes',e.target.value)} placeholder="Treatment notes..."
            style={{width:'100%',boxSizing:'border-box',minHeight:50,padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,resize:'vertical'}}/>
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

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TcPatientsPage({user, tcPatients, isManager, users, saveTcPatient, loadTcPatients, notify}) {
  const [emailPresets, setEmailPresets] = useState([])
  const [pageEmailPatient, setPageEmailPatient] = useState(null)
  useEffect(() => {
    import('../../lib/supabase').then(({sbGet}) =>
      sbGet('email_presets','select=*&active=eq.true&order=sort_order').then(setEmailPresets).catch(()=>{})
    )
  }, [])
  const [office,      setOffice]      = useState('all')
  const [activeTab,   setActiveTab]   = useState(user.role==='treatment_coordinator'?'dashboard':'tracker')
  const [activeMonth, setActiveMonth] = useState('all')
  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState('all')
  const [drFilter,    setDrFilter]    = useState('all')
  const [tcFilter,    setTcFilter]    = useState('all')
  const [showAdd,     setShowAdd]     = useState(false)
  const [importing,   setImporting]   = useState(false)
  const [importRes,   setImportRes]   = useState(null)
  const importRef = useRef()

  // Role scoping: TCs see only their own patients; managers/admin see all
  const isTC = user.role === 'treatment_coordinator'
  const scopedPatients = useMemo(() => {
    if (!isTC) return tcPatients || []
    const me = (user.name||'').toLowerCase().trim()
    return (tcPatients||[]).filter(p =>
      (p.who_tx_plan||'').toLowerCase().trim() === me ||
      (p.assigned_tc_name||'').toLowerCase().trim() === me
    )
  }, [tcPatients, isTC, user.name])

  // Office-filtered list (TCs are auto-scoped to themselves already)
  const officePatients = useMemo(() =>
    office==='all' ? scopedPatients : scopedPatients.filter(p=>p.office===office)
  , [scopedPatients, office])

  // Month tabs
  const monthTabs = useMemo(() => {
    const ms = [...new Set(officePatients.map(p=>p.month_tab||p.dos?.slice(0,7)).filter(Boolean))]
    return ms.sort().reverse()
  }, [officePatients])

  // TCs for selected office (from users table)
  const officeTCs = useMemo(() => {
    const fromUsers = users
      .filter(u => (office==='all'||u.office===office) && ['treatment_coordinator','front_desk','manager'].includes(u.role))
      .map(u => u.name||u.username)
    const fromData = officePatients.flatMap(p=>[p.who_tx_plan,p.assigned_tc_name].filter(Boolean))
    return [...new Set([...fromUsers, ...fromData])].sort()
  }, [users, office, officePatients])

  // Doctors for selected office
  const officeDoctors = useMemo(() =>
    [...new Set(officePatients.map(p=>p.doctor).filter(Boolean))].sort()
  , [officePatients])

  // Filtered patients for tracker tab
  const visible = useMemo(() => {
    let list = officePatients
    if (activeMonth!=='all') list = list.filter(p=>(p.month_tab||p.dos?.slice(0,7))===activeMonth)
    if (drFilter!=='all') list = list.filter(p=>p.doctor===drFilter)
    if (tcFilter!=='all') list = list.filter(p=>
      (p.who_tx_plan||'').toLowerCase()===tcFilter.toLowerCase()||
      (p.assigned_tc_name||'').toLowerCase()===tcFilter.toLowerCase()
    )
    if (search.trim()) list = list.filter(p=>
      (p.patient_name||'').toLowerCase().includes(search.toLowerCase())||
      (p.patient_phone||'').includes(search)||
      (p.notes||'').toLowerCase().includes(search.toLowerCase())
    )
    if (filter==='no_appt')        list = list.filter(p=>getFlags(p).some(f=>f.type==='no_appt'))
    else if (filter==='needs_call') list = list.filter(p=>getFlags(p).some(f=>f.type==='needs_call'||f.type==='overdue_call'))
    else if (filter==='finance')    list = list.filter(p=>getFlags(p).some(f=>f.type==='finance'))
    else if (filter==='recall')     list = list.filter(p=>getFlags(p).some(f=>f.type==='recall'))
    else if (filter==='big_cases')  list = list.filter(isBigCase)
    return list.sort((a,b)=>(b.dos||'').localeCompare(a.dos||''))
  }, [officePatients, activeMonth, drFilter, tcFilter, search, filter])

  // Summary counts
  const counts = useMemo(() => {
    const all = officePatients
    return {
      total:      all.length,
      no_appt:    all.filter(p=>getFlags(p).some(f=>f.type==='no_appt')).length,
      needs_call: all.filter(p=>getFlags(p).some(f=>f.type==='needs_call'||f.type==='overdue_call')).length,
      finance:    all.filter(p=>getFlags(p).some(f=>f.type==='finance')).length,
      recall:     all.filter(p=>getFlags(p).some(f=>f.type==='recall')).length,
      big_cases:  all.filter(isBigCase).length,
    }
  }, [officePatients])

  const handleImport = async (file) => {
    if (!file) return
    setImporting(true); setImportRes(null)
    try {
      const {results, total} = await importTcExcel(file, office==='all'?user.office||'Dalton':office)
      let saved=0, skipped=0
      for (const {patients} of results) {
        for (const p of patients) {
          // Match on name + phone (cleaned) to catch same patient across months
          const cleanPhone = s => (s||'').replace(/\D/g,'')
          const exists = (tcPatients||[]).find(e=>
            e.patient_name?.toLowerCase().trim()===p.patient_name.toLowerCase().trim() &&
            cleanPhone(e.patient_phone)===cleanPhone(p.patient_phone) &&
            cleanPhone(p.patient_phone).length >= 7
          ) || (tcPatients||[]).find(e=>
            e.patient_name?.toLowerCase().trim()===p.patient_name.toLowerCase().trim() &&
            e.dos===p.dos && e.office===p.office
          )
          if (exists) { skipped++; continue }
          await saveTcPatient(p); saved++
        }
      }
      await loadTcPatients()
      setImportRes({saved, skipped, months:results.map(r=>r.month)})
      notify('Imported '+saved+' patients'+(skipped>0?' ('+skipped+' skipped)':''))
    } catch(e) { notify('Import failed: '+e.message,'error') }
    setImporting(false)
  }

  const onSave  = async (row) => { await saveTcPatient(row); notify('Saved') }
  const onDelete = async (id) => { await sbDel('tc_patients','id=eq.'+id); await loadTcPatients(); notify('Deleted') }

  // Office patient counts (role-scoped)
  const offCounts = useMemo(() =>
    OFFICES.reduce((m,o) => ({...m,[o]:scopedPatients.filter(p=>p.office===o).length}),{})
  , [scopedPatients])

  return (
    <div style={{minHeight:'100vh', background:'#f8fafc'}}>

      {/* Top header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', padding:'18px 24px 0'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16, flexWrap:'wrap', gap:10}}>
          <div>
            <div style={{fontSize:10, color:'rgba(255,255,255,.5)', fontWeight:700, letterSpacing:2, marginBottom:3}}>BSBD</div>
            <div style={{fontSize:18, fontWeight:800, color:'white'}}>TC Treatment Tracker</div>
          </div>
          <div style={{display:'flex', gap:7, alignItems:'center', flexWrap:'wrap'}}>
            <label style={{padding:'7px 14px', borderRadius:8, background:'rgba(255,255,255,.12)',
              color:'white', border:'1px solid rgba(255,255,255,.2)', fontWeight:700, fontSize:11, cursor:'pointer'}}>
              {importing?'Importing...':'Import Month List'}
              <input ref={importRef} type="file" accept=".xlsx,.xls" style={{display:'none'}}
                onChange={e=>{if(e.target.files[0])handleImport(e.target.files[0])}}/>
            </label>
            <button onClick={()=>setShowAdd(true)}
              style={{padding:'7px 14px', borderRadius:8, background:'rgba(255,255,255,.15)',
                color:'white', border:'1px solid rgba(255,255,255,.3)', fontWeight:700, fontSize:11, cursor:'pointer'}}>
              + Add Patient
            </button>
          </div>
        </div>

        {/* Office selector */}
        <div style={{display:'flex', gap:6, flexWrap:'wrap', marginBottom:14}}>
          <button onClick={()=>{setOffice('all');setTcFilter('all');setDrFilter('all')}}
            style={{padding:'7px 16px', borderRadius:'8px 8px 0 0', fontWeight:700, fontSize:12,
              border:'none', cursor:'pointer',
              background:office==='all'?'white':'rgba(255,255,255,.12)',
              color:office==='all'?'#1e3a5f':'rgba(255,255,255,.8)'}}>
            All Offices <span style={{fontSize:10, opacity:.7}}>({scopedPatients.length})</span>
          </button>
          {OFFICES.map(o=>(
            <button key={o} onClick={()=>{setOffice(o);setTcFilter('all');setDrFilter('all')}}
              style={{padding:'7px 16px', borderRadius:'8px 8px 0 0', fontWeight:700, fontSize:12,
                border:'none', cursor:'pointer',
                background:office===o?'white':'rgba(255,255,255,.12)',
                color:office===o?'#1e3a5f':'rgba(255,255,255,.8)'}}>
              {o} <span style={{fontSize:10, opacity:.7}}>({offCounts[o]||0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tabs + summary pills */}
      <div style={{background:'white', borderBottom:'1px solid #e2e8f0', padding:'12px 24px'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10}}>

          {/* Tab buttons */}
          <div style={{display:'flex', gap:4}}>
            {[['dashboard','Dashboard'],['tracker','Tracker'],['bigcases','Big Cases ⭐'],['alerts','Alerts'],['reports','Reports']].map(([k,l])=>(
              <button key={k} onClick={()=>setActiveTab(k)}
                style={{padding:'7px 16px', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer',
                  background:activeTab===k?'#1e3a5f':'transparent',
                  color:activeTab===k?'white':'#64748b',
                  border:'1px solid '+(activeTab===k?'#1e3a5f':'#e2e8f0')}}>
                {l}{k==='bigcases'&&counts.big_cases>0?` (${counts.big_cases})`:''}
              </button>
            ))}
          </div>

          {/* Predictive filter pills */}
          <div style={{display:'flex', gap:5, flexWrap:'wrap'}}>
            {[
              ['all',       'All',           counts.total,      '#1e293b', '#f8fafc'],
              ['no_appt',   'No Appt',       counts.no_appt,    '#dc2626', '#fee2e2'],
              ['needs_call','Needs Call',    counts.needs_call, '#d97706', '#fef9c3'],
              ['finance',   'Finance Stall', counts.finance,    '#7c3aed', '#f5f3ff'],
              ['recall',    'Recall',        counts.recall,     '#0d9488', '#f0fdf4'],
            ].map(([k,l,c,col,bg])=>(
              <button key={k} onClick={()=>setFilter(k)}
                style={{padding:'5px 11px', borderRadius:99, fontWeight:700, fontSize:11, cursor:'pointer',
                  background:filter===k?col:bg, color:filter===k?'white':col,
                  border:'2px solid '+(filter===k?col:'transparent')}}>
                {l}{c>0?` (${c})`:''}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Import result banner */}
      {importRes && (
        <div style={{background:'#f0fdf4', borderBottom:'1px solid #bbf7d0', padding:'10px 24px',
          display:'flex', justifyContent:'space-between', alignItems:'center'}}>
          <div style={{fontSize:13, color:'#15803d', fontWeight:600}}>
            Import complete: {importRes.saved} patients added
            {importRes.skipped>0&&<span style={{color:'#64748b', fontWeight:400}}> · {importRes.skipped} duplicates skipped</span>}
          </div>
          <button onClick={()=>setImportRes(null)} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:16}}>X</button>
        </div>
      )}

      {/* ── Tracker tab ─────────────────────────────────────────────────── */}
      {activeTab==='tracker' && (
        <div>
          {/* Controls */}
          <div style={{padding:'12px 24px', background:'white', borderBottom:'1px solid #f1f5f9',
            display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            {/* Month tabs */}
            <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
              <button onClick={()=>setActiveMonth('all')}
                style={{padding:'5px 11px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                  background:activeMonth==='all'?'#1e293b':'white',
                  color:activeMonth==='all'?'white':'#64748b',
                  border:'1px solid '+(activeMonth==='all'?'#1e293b':'#e2e8f0')}}>All</button>
              {monthTabs.map(m=>(
                <button key={m} onClick={()=>setActiveMonth(m)}
                  style={{padding:'5px 11px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                    background:activeMonth===m?'#1e293b':'white',
                    color:activeMonth===m?'white':'#64748b',
                    border:'1px solid '+(activeMonth===m?'#1e293b':'#e2e8f0')}}>
                  {monthLabel(m)}
                </button>
              ))}
            </div>
            <input placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)}
              style={{padding:'6px 10px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12, minWidth:160}}/>
            <select value={drFilter} onChange={e=>setDrFilter(e.target.value)}
              style={{padding:'6px 9px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12}}>
              <option value="all">All Doctors</option>
              {officeDoctors.map(d=><option key={d}>{d}</option>)}
            </select>
            <select value={tcFilter} onChange={e=>setTcFilter(e.target.value)}
              style={{padding:'6px 9px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12}}>
              <option value="all">All TCs</option>
              {officeTCs.map(t=><option key={t}>{t}</option>)}
            </select>
            <span style={{fontSize:11, color:'#94a3b8', marginLeft:'auto'}}>{visible.length} patients</span>
          </div>

          {/* Table */}
          <div style={{padding:'0 24px 20px', overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', minWidth:1100}}>
              <thead>
                <tr style={{background:'#1e293b'}}>
                  {['DOS','Patient','Phone','Doctor','TC','Exam','Notes','Appt?','TX Value','Cadence','Flags'].map(h=>(
                    <th key={h} style={{padding:'9px 10px', textAlign:'left', fontSize:10, fontWeight:800,
                      color:'rgba(255,255,255,.7)', letterSpacing:.5, whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.length===0?(
                  <tr><td colSpan={11} style={{textAlign:'center',padding:40,color:'#94a3b8'}}>No patients found</td></tr>
                ):visible.map(p=>(
                  <PatientRow key={p.id} p={p} onSave={onSave} onDelete={onDelete}
                    isManager={isManager} user={user} notify={notify} emailPresets={emailPresets}/>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Big Cases tab ────────────────────────────────────────────────── */}
      {activeTab==='bigcases' && (
        <BigCasesView patients={scopedPatients} office={office}
          onSave={onSave} notify={notify} user={user}
          onEmail={setPageEmailPatient}/>
      )}

      {/* ── Dashboard tab ───────────────────────────────────────────────── */}
      {activeTab==='dashboard' && (
        <TcDashboard
          patients={officePatients}
          allScoped={scopedPatients}
          user={user} isTC={isTC} office={office}
          activeMonth={activeMonth} setActiveMonth={setActiveMonth}
          monthTabs={monthTabs}
          onJumpToPatient={()=>setActiveTab('tracker')}/>
      )}

      {/* ── Alerts tab ──────────────────────────────────────────────────── */}
      {activeTab==='alerts' && (
        <TcAlerts
          patients={officePatients}
          user={user} isManager={isManager} isTC={isTC}
          activeMonth={activeMonth} setActiveMonth={setActiveMonth}
          monthTabs={monthTabs}
          onSave={onSave} notify={notify}
          onJumpToPatient={()=>setActiveTab('tracker')}/>
      )}

      {/* ── Reports tab ─────────────────────────────────────────────────── */}
      {activeTab==='reports' && (
        <div style={{padding:'16px 0 0'}}>
          <TcAnalytics patients={officePatients} activeMonth={activeMonth}/>
        </div>
      )}

      {pageEmailPatient && (
        <EmailModal p={pageEmailPatient} user={user} emailPresets={emailPresets}
          onClose={()=>setPageEmailPatient(null)} notify={notify}/>
      )}

      {showAdd && (
        <AddModal user={user} office={office==='all'?user.office||'':office}
          onClose={()=>setShowAdd(false)}
          onSave={async row=>{await saveTcPatient(row);await loadTcPatients();notify('Patient added')}}
          notify={notify}/>
      )}
    </div>
  )
}
