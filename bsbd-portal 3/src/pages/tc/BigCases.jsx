import React, { useState, useMemo } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'

// ── Big case reasons (manual flag types) ─────────────────────────────────
export const BIG_CASE_REASONS = [
  'Implant','All-on-X','Root Canal','Crown','Bridge',
  'Full Mouth Rehab','Denture','Extraction (surgical)','Bone Graft',
  'Sinus Lift','Veneers','Ortho','Other'
]

export function isBigCase(p) {
  return p.is_big_case || N(p.total_tx_cost) >= 3000
}

// ── The 7-step Big Case Follow-Up Protocol ────────────────────────────────
export const BIG_CASE_PROTOCOL = [
  { step:'email_d1',   day:1,  label:'Day 1',  title:'TX Plan Email',   action:'Send treatment plan email',        type:'email' },
  { step:'call_d3',    day:3,  label:'Day 3',  title:'1st Call',        action:'First follow-up call',             type:'call'  },
  { step:'call_d7',    day:7,  label:'Day 7',  title:'Call + Text',     action:'Second call plus a text message',  type:'call'  },
  { step:'fin_d14',    day:14, label:'Day 14', title:'Finance Call',    action:'Discuss financing options',        type:'finance' },
  { step:'review_d21', day:21, label:'Day 21', title:'Doctor Review',   action:'Flag for doctor / manager review', type:'review' },
  { step:'final_d30',  day:30, label:'Day 30', title:'Final Outreach',  action:'Final formal outreach attempt',    type:'call'  },
  { step:'warm_d60',   day:60, label:'Day 60+',title:'Keep Warm',       action:'Monthly keep-warm contact',        type:'warm'  },
]

const CONTACT_METHODS  = ['Call','Text','Email','Voicemail','In Person']
const CONTACT_OUTCOMES = ['No answer','Left voicemail','Spoke to patient','Scheduled','Declined','Call back later','Sent info']

function daysSince(dos) {
  if (!dos) return null
  return Math.floor((new Date(todayStr()) - new Date(dos)) / 86400000)
}

// Returns protocol state with completion + which step is current.
// Works even with NO dos — if no dos, every step is actionable in order.
export function getProtocolState(p) {
  const log  = p.protocol_log || []
  const days = daysSince(p.dos)
  const done = new Set(log.map(e => e.step))

  const booked   = p.has_appt==='Yes' || !!p.appt_1
  const complete = N(p.tx_completed) >= N(p.total_tx_cost)*0.9 && N(p.tx_completed) > 0

  let currentStep = null
  const steps = BIG_CASE_PROTOCOL.map(s => {
    const isDone = done.has(s.step)
    let state = 'upcoming'
    if (isDone) state = 'done'
    else if (!currentStep && !booked && !complete) {
      // If no DOS, the next undone step is always actionable ("due").
      // If DOS exists, it's due/overdue once we reach its day, else pending.
      if (days === null)        { state = 'due';     currentStep = s }
      else if (days >= s.day)   { state = (days===s.day)?'due':'overdue'; currentStep = s }
      else                      { state = 'pending'; currentStep = s }  // first future step is still the "current" one to act on
    }
    const logEntry = log.find(e => e.step === s.step)
    return { ...s, state, daysOverdue: days!==null ? days - s.day : 0, logEntry }
  })

  return { steps, currentStep, days, booked, complete, log }
}

// Simplified cadence summary used by dashboard/alerts/row badge
export function getBigCaseCadence(p) {
  if (p.has_appt==='Yes' || p.appt_1) return { status:'scheduled', label:'Scheduled', color:'#16a34a', priority:0 }
  if (N(p.tx_completed) >= N(p.total_tx_cost)*0.9 && N(p.tx_completed) > 0)
    return { status:'complete', label:'Complete', color:'#16a34a', priority:0 }

  const st = getProtocolState(p)
  const s  = st.currentStep
  if (!s) return { status:'done', label:'Protocol complete', color:'#94a3b8', priority:3 }

  if (s.step === 'review_d21' && (s.state==='due'||s.state==='overdue'))
    return { status:'escalate', label:'Doctor Review due', color:'#dc2626', priority:1 }
  if (s.step === 'warm_d60' && (s.state==='due'||s.state==='overdue'))
    return { status:'keepwarm', label:'Keep-warm contact', color:'#7c3aed', priority:3 }
  if (s.state === 'due')
    return { status:'due', label:s.title+' due', color:'#0d9488', priority:1 }
  if (s.state === 'overdue')
    return { status:'overdue', label:s.title+' overdue '+s.daysOverdue+'d', color:'#d97706', priority:2 }
  // pending (future)
  return { status:'pending', label:'Next: '+s.title+(st.days!==null?' (day '+s.day+')':''), color:'#64748b', priority:2 }
}

// ── Log Touchpoint modal (method + outcome + note) ────────────────────────
function LogModal({ p, step, user, onClose, onSave, notify }) {
  const [method,  setMethod]  = useState(step.type==='email'?'Email':step.type==='finance'?'Call':'Call')
  const [outcome, setOutcome] = useState('No answer')
  const [note,    setNote]    = useState('')
  const [saving,  setSaving]  = useState(false)

  const save = async () => {
    setSaving(true)
    const entry = {
      step: step.step, label: step.label+' — '+step.title,
      date: todayStr(), method, outcome, note, by: user.name||'',
      logged_at: new Date().toISOString(),
    }
    const newLog = [...(p.protocol_log||[]).filter(e=>e.step!==step.step), entry]
    const patch = { ...p, protocol_log: newLog, updated_at: new Date().toISOString() }
    // Mirror into call/email fields for cross-consistency with the tracker
    if (step.step==='call_d3'  && !p.call_1_date) { patch.call_1_date = todayStr(); patch.call_1_notes = outcome+(note?' — '+note:'') }
    if (step.step==='call_d7'  && !p.call_2_date) { patch.call_2_date = todayStr(); patch.call_2_notes = outcome+(note?' — '+note:'') }
    if (step.step==='fin_d14'  && !p.call_3_date) { patch.call_3_date = todayStr(); patch.call_3_notes = outcome+(note?' — '+note:'') }
    if (step.step==='email_d1') patch.email_sent = 'Yes'
    if (outcome==='Scheduled')  patch.has_appt = 'Yes'
    await onSave(patch)
    notify(step.title+' logged')
    setSaving(false); onClose()
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:500,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:14,padding:22,width:'100%',maxWidth:460}}>
        <div style={{fontSize:14,fontWeight:800,color:'#1e293b',marginBottom:2}}>{step.label} — {step.title}</div>
        <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>{p.patient_name} · {step.action}</div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          <div>
            <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:4}}>METHOD</div>
            <select value={method} onChange={e=>setMethod(e.target.value)}
              style={{width:'100%',padding:'7px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13}}>
              {CONTACT_METHODS.map(m=><option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:4}}>OUTCOME</div>
            <select value={outcome} onChange={e=>setOutcome(e.target.value)}
              style={{width:'100%',padding:'7px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13}}>
              {CONTACT_OUTCOMES.map(o=><option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        <div style={{marginBottom:6}}>
          <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:4}}>NOTES</div>
          <textarea value={note} onChange={e=>setNote(e.target.value)} autoFocus
            placeholder="What happened? Next steps?"
            style={{width:'100%',boxSizing:'border-box',minHeight:70,padding:'9px 11px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,resize:'vertical'}}/>
        </div>
        <div style={{fontSize:11,color:'#94a3b8',marginBottom:14}}>
          Outcome "Scheduled" auto-marks the patient as booked.
        </div>

        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{padding:'8px 16px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving}
            style={{padding:'8px 16px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>
            {saving?'Saving...':'Log Touchpoint'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Protocol timeline (interactive) ───────────────────────────────────────
function ProtocolTimeline({ p, onLogStep, onEmail }) {
  const st = getProtocolState(p)
  const stateColor = { done:'#16a34a', due:'#0d9488', overdue:'#d97706', pending:'#94a3b8', upcoming:'#cbd5e1' }

  return (
    <div style={{padding:'4px 0'}}>
      {st.steps.map((s, i) => {
        const c = stateColor[s.state] || '#cbd5e1'
        const isActive = (s.state==='due' || s.state==='overdue' || s.state==='pending') && st.currentStep?.step===s.step
        return (
          <div key={s.step} style={{display:'flex',gap:10,position:'relative'}}>
            {i < st.steps.length-1 && (
              <div style={{position:'absolute',left:8,top:18,width:2,height:'calc(100% - 4px)',
                background:s.state==='done'?'#16a34a':'#e2e8f0'}}/>
            )}
            <div style={{width:18,height:18,borderRadius:'50%',flexShrink:0,zIndex:1,
              background:(s.state==='upcoming'||s.state==='pending')?'white':c,
              border:'2px solid '+((s.state==='upcoming')?'#cbd5e1':c),
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              {s.state==='done' && <span style={{color:'white',fontSize:10,fontWeight:900}}>✓</span>}
              {isActive && s.state!=='done' && <span style={{color:c,fontSize:13,fontWeight:900,lineHeight:1}}>•</span>}
            </div>
            <div style={{flex:1,paddingBottom:14,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <span style={{fontSize:12,fontWeight:700,
                  color:(s.state==='upcoming')?'#94a3b8':s.state==='done'?'#16a34a':'#1e293b'}}>
                  {s.label} · {s.title}
                </span>
                {s.state==='done' && s.logEntry && (
                  <span style={{fontSize:10,color:'#94a3b8',whiteSpace:'nowrap'}}>{s.logEntry.date}</span>
                )}
                {isActive && (
                  s.type==='email'
                    ? <button onClick={()=>onEmail(p)}
                        style={{padding:'3px 10px',borderRadius:6,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:10,cursor:'pointer',whiteSpace:'nowrap'}}>
                        Send Email
                      </button>
                    : <button onClick={()=>onLogStep(p, s)}
                        style={{padding:'3px 10px',borderRadius:6,background:c,color:'white',border:'none',fontWeight:700,fontSize:10,cursor:'pointer',whiteSpace:'nowrap'}}>
                        Log {s.type==='call'?'Call':s.type==='finance'?'Finance Call':s.type==='review'?'Review':'Contact'}
                      </button>
                )}
              </div>
              <div style={{fontSize:10,color:'#94a3b8',marginTop:1}}>
                {s.state==='overdue' ? <span style={{color:'#d97706',fontWeight:600}}>Overdue {s.daysOverdue}d · </span> : ''}
                {s.state==='due' ? <span style={{color:'#0d9488',fontWeight:600}}>Due now · </span> : ''}
                {s.action}
              </div>
              {s.logEntry && (
                <div style={{fontSize:10,color:'#475569',marginTop:3,background:'#f8fafc',borderRadius:6,padding:'4px 8px'}}>
                  <b>{s.logEntry.method}</b> · {s.logEntry.outcome}
                  {s.logEntry.note?' — '+s.logEntry.note:''}
                  {s.logEntry.by?<span style={{color:'#94a3b8'}}> ({s.logEntry.by})</span>:''}
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Big Case Card ─────────────────────────────────────────────────────────
function BigCaseCard({ p, onLogStep, onEmail, onEdit, onFlag }) {
  const [expanded, setExpanded] = useState(false)
  const cad = getBigCaseCadence(p)
  const txPct = p.total_tx_cost > 0 ? Math.min(Math.round(N(p.tx_completed)*100/N(p.total_tx_cost)),100) : 0
  const urgent = cad.priority === 1
  const attempts = (p.protocol_log||[]).length
  const noDos = !p.dos

  return (
    <div style={{background:'white',borderRadius:14,
      border:'2px solid '+(urgent?cad.color+'55':'#e2e8f0'),overflow:'hidden'}}>
      <div style={{padding:'14px 16px',cursor:'pointer'}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:14,fontWeight:800,color:'#1e293b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              {p.patient_name}
            </div>
            <div style={{fontSize:11,color:'#64748b',marginTop:2}}>
              {p.doctor||'—'} · {p.who_tx_plan||'—'} · {p.office||'—'}
            </div>
          </div>
          <div style={{textAlign:'right',flexShrink:0,marginLeft:8}}>
            <div style={{fontSize:18,fontWeight:800,color:'#1d4ed8'}}>{USD(p.total_tx_cost)}</div>
            {p.big_case_reason && (
              <div style={{fontSize:10,fontWeight:700,color:'#7c3aed',background:'#f5f3ff',padding:'1px 7px',borderRadius:99,display:'inline-block',marginTop:2}}>
                {p.big_case_reason}
              </div>
            )}
          </div>
        </div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'inline-flex',alignItems:'center',gap:5,padding:'4px 10px',borderRadius:7,
            background:cad.color+'18',fontSize:11,fontWeight:700,color:cad.color}}>
            <span>{urgent?'⚠':'●'}</span>{cad.label}
          </div>
          <div style={{fontSize:10,color:'#94a3b8'}}>
            {attempts>0?attempts+' logged · ':''}{noDos?'no DOS':p.dos}
          </div>
        </div>
        {noDos && (
          <div style={{marginTop:8,fontSize:10,color:'#d97706',background:'#fffbeb',borderRadius:6,padding:'5px 8px'}}>
            No exam date set — protocol runs in order. Set DOS in Edit for date-based timing.
          </div>
        )}
        {p.total_tx_cost > 0 && (
          <div style={{marginTop:10}}>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
              <span style={{fontSize:10,color:'#64748b'}}>Completed: {USD(p.tx_completed||0)} / {USD(p.total_tx_cost)}</span>
              <span style={{fontSize:10,fontWeight:700,color:txPct>=80?'#16a34a':'#64748b'}}>{txPct}%</span>
            </div>
            <div style={{height:4,background:'#f1f5f9',borderRadius:2,overflow:'hidden'}}>
              <div style={{height:'100%',borderRadius:2,background:txPct>=80?'#16a34a':'#1d4ed8',width:txPct+'%'}}/>
            </div>
          </div>
        )}
        <div style={{textAlign:'center',marginTop:8,fontSize:10,color:'#94a3b8',fontWeight:600}}>
          {expanded?'▲ hide protocol':'▼ view & log follow-up protocol'}
        </div>
      </div>

      {expanded && (
        <div style={{borderTop:'1px solid #f1f5f9',padding:'14px 16px',background:'#fafafa'}}>
          <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:10}}>FOLLOW-UP PROTOCOL</div>
          <ProtocolTimeline p={p} onLogStep={onLogStep} onEmail={onEmail}/>
          <div style={{display:'flex',gap:6,marginTop:8,paddingTop:10,borderTop:'1px solid #f1f5f9'}}>
            <button onClick={()=>onEdit(p)}
              style={{flex:1,padding:'7px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Edit Patient</button>
            <button onClick={()=>onFlag(p)}
              style={{flex:1,padding:'7px',borderRadius:8,background:'#f1f5f9',color:'#64748b',border:'1px solid #e2e8f0',fontWeight:700,fontSize:11,cursor:'pointer'}}>Remove Flag</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Big Cases View ─────────────────────────────────────────────────────────
export default function BigCasesView({ patients, office, onSave, notify, user, onEmail, onEdit }) {
  const [logStep, setLogStep] = useState(null)
  const [reasonFilter, setReasonFilter] = useState('all')

  const bigCases = useMemo(() => {
    let list = patients.filter(isBigCase)
    if (office !== 'all') list = list.filter(p => p.office === office)
    if (reasonFilter !== 'all') list = list.filter(p => p.big_case_reason === reasonFilter)
    return list.sort((a,b) => (getBigCaseCadence(a).priority||3) - (getBigCaseCadence(b).priority||3))
  }, [patients, office, reasonFilter])

  // Every big case lands in exactly one bucket
  const cat = (p) => {
    const c = getBigCaseCadence(p)
    if (['scheduled','complete'].includes(c.status)) return 'settled'
    if (c.status === 'keepwarm') return 'keepwarm'
    if (c.priority === 1) return 'needs'
    return 'track'
  }
  const needsAction = bigCases.filter(p => cat(p)==='needs')
  const onTrack     = bigCases.filter(p => cat(p)==='track')
  const keepWarm    = bigCases.filter(p => cat(p)==='keepwarm')
  const settled     = bigCases.filter(p => cat(p)==='settled')

  const totalValue = bigCases.reduce((s,p)=>s+N(p.total_tx_cost),0)
  const schedValue = bigCases.reduce((s,p)=>s+N(p.sched_tx_amount),0)
  const compValue  = bigCases.reduce((s,p)=>s+N(p.tx_completed),0)
  const reasons    = [...new Set(patients.filter(isBigCase).map(p=>p.big_case_reason).filter(Boolean))]

  const removeBigFlag = async (p) => {
    if (!window.confirm('Remove big case flag for '+p.patient_name+'?')) return
    await onSave({...p, is_big_case:false, big_case_reason:'', updated_at:new Date().toISOString()})
    notify('Flag removed')
  }
  const handleEmail = onEmail || (()=>notify('Open patient in Tracker to email','error'))
  const handleEdit  = onEdit  || (()=>notify('Open patient in Tracker to edit','error'))

  const Section = ({title, color, items}) => {
    if (!items.length) return null
    return (
      <div style={{marginBottom:24}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
          <div style={{width:10,height:10,borderRadius:'50%',background:color}}/>
          <span style={{fontSize:12,fontWeight:800,color:'#1e293b',letterSpacing:.5}}>{title}</span>
          <span style={{fontSize:11,color:'#94a3b8'}}>({items.length})</span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))',gap:12}}>
          {items.map(p => (
            <BigCaseCard key={p.id} p={p}
              onLogStep={(pt,st)=>setLogStep({p:pt,step:st})}
              onEmail={handleEmail} onEdit={handleEdit} onFlag={removeBigFlag}/>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{padding:'18px 24px 60px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:20}}>
        {[
          ['BIG CASES',      bigCases.length,                            '#1e293b'],
          ['NEEDS ACTION',   needsAction.length,                         '#dc2626'],
          ['TOTAL VALUE',    '$'+Math.round(totalValue/1000)+'k',        '#1d4ed8'],
          ['SCHEDULED',      '$'+Math.round(schedValue/1000)+'k',        '#0d9488'],
          ['COMPLETED',      '$'+Math.round(compValue/1000)+'k',         '#16a34a'],
          ['POTENTIAL LEFT', '$'+Math.round((totalValue-compValue)/1000)+'k','#d97706'],
        ].map(([l,v,c])=>(
          <div key={l} style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>{l}</div>
            <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {reasons.length > 0 && (
        <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
          <button onClick={()=>setReasonFilter('all')}
            style={{padding:'5px 12px',borderRadius:99,fontSize:11,fontWeight:700,cursor:'pointer',
              background:reasonFilter==='all'?'#1e293b':'white',color:reasonFilter==='all'?'white':'#64748b',
              border:'1px solid '+(reasonFilter==='all'?'#1e293b':'#e2e8f0')}}>All</button>
          {reasons.map(r=>(
            <button key={r} onClick={()=>setReasonFilter(r===reasonFilter?'all':r)}
              style={{padding:'5px 12px',borderRadius:99,fontSize:11,fontWeight:700,cursor:'pointer',
                background:reasonFilter===r?'#7c3aed':'white',color:reasonFilter===r?'white':'#7c3aed',
                border:'1px solid '+(reasonFilter===r?'#7c3aed':'#c4b5fd')}}>{r}</button>
          ))}
        </div>
      )}

      {bigCases.length===0 ? (
        <div style={{textAlign:'center',padding:'60px 0',color:'#94a3b8'}}>
          <div style={{fontSize:32,marginBottom:12}}>⭐</div>
          <div style={{fontSize:15,fontWeight:600,color:'#64748b',marginBottom:6}}>No big cases yet</div>
          <div style={{fontSize:13}}>Patients with TX plans over $3,000 appear here automatically</div>
        </div>
      ) : (
        <>
          <Section title="NEEDS ACTION" color="#dc2626" items={needsAction}/>
          <Section title="ON TRACK"     color="#d97706" items={onTrack}/>
          <Section title="KEEP-WARM"    color="#7c3aed" items={keepWarm}/>
          <Section title="SCHEDULED / COMPLETE" color="#16a34a" items={settled}/>
        </>
      )}

      {logStep && (
        <LogModal p={logStep.p} step={logStep.step} user={user}
          onClose={()=>setLogStep(null)} onSave={onSave} notify={notify}/>
      )}
    </div>
  )
}
