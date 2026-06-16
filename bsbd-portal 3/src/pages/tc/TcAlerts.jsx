import React, { useState, useMemo } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'
import { isBigCase, getBigCaseCadence } from './BigCases'

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const monthLabel = m => { if(!m) return ''; const [y,mo]=m.split('-'); return MONTHS_EN[parseInt(mo)-1]+' '+y }

// ── Alert generators ───────────────────────────────────────────────────────
function stdCadence(p) {
  if (p.has_appt==='Yes'||p.appt_1) return null
  const dos=p.dos; if(!dos) return null
  const days = Math.floor((new Date(todayStr())-new Date(dos))/86400000)
  const stages=[{day:3,call:'call_1_date'},{day:5,call:'call_2_date'},{day:10,call:'call_3_date'}]
  for(const s of stages){ if(!p[s.call]){ const d=days-s.day; if(d>0)return{status:'overdue',days:d}; if(d===0)return{status:'due',days:0}; return null } }
  if(days>=14) return {status:'escalate',days}
  return null
}
function pastAppts(p){
  const t=todayStr(); const log=p.visit_log||[]
  return ['appt_1','appt_2','appt_3','appt_hyg'].filter(k=>{const d=p[k];if(!d||d>t)return false;return !log.find(e=>e.appt_key===k)})
}

function buildAlerts(patients) {
  const alerts = []
  for (const p of patients) {
    // Cadence overdue / escalate
    const c = stdCadence(p)
    if (c?.status==='escalate')
      alerts.push({id:p.id+'_esc',patient:p,type:'escalate',priority:1,
        title:'No appointment after 14 days',msg:c.days+' days since exam, no appointment booked',color:'#dc2626'})
    else if (c?.status==='overdue')
      alerts.push({id:p.id+'_cad',patient:p,type:'cadence',priority:2,
        title:'Follow-up call overdue',msg:'Call overdue by '+c.days+' days',color:'#d97706'})
    else if (c?.status==='due')
      alerts.push({id:p.id+'_due',patient:p,type:'due',priority:3,
        title:'Call due today',msg:'Scheduled follow-up call is due',color:'#0d9488'})

    // Big case stalling
    if (isBigCase(p)) {
      const bc = getBigCaseCadence(p)
      if (bc && (bc.status==='escalate'||bc.status==='final'))
        alerts.push({id:p.id+'_big',patient:p,type:'bigcase',priority:1,
          title:'Big case stalling — '+USD(p.total_tx_cost),msg:bc.label,color:'#7c3aed'})
    }

    // Visit not updated
    const pa = pastAppts(p)
    if (pa.length>0)
      alerts.push({id:p.id+'_visit',patient:p,type:'visit',priority:2,
        title:pa.length+' visit'+(pa.length>1?'s':'')+' not updated',msg:'Appointment passed, outcome not logged',color:'#854d0e'})

    // Finance stalled
    if (p.finance_stalled && p.has_appt!=='Yes')
      alerts.push({id:p.id+'_fin',patient:p,type:'finance',priority:2,
        title:'Finance stalled',msg:p.finance_barrier||'Patient has a finance barrier',color:'#a21caf'})

    // Manually escalated
    if (p.escalated)
      alerts.push({id:p.id+'_manual',patient:p,type:'manual_escalation',priority:1,
        title:'Escalated to manager',msg:p.escalation_note||'Flagged by TC for review',color:'#dc2626',
        escalatedBy:p.escalated_by})
  }
  return alerts.sort((a,b)=>a.priority-b.priority)
}

// ── Escalation modal ───────────────────────────────────────────────────────
function EscalateModal({ p, user, onClose, onSave, notify }) {
  const [note,setNote]=useState('')
  const [sending,setSending]=useState(false)

  const submit = async () => {
    setSending(true)
    await onSave({...p, escalated:true, escalated_by:user.name||'',
      escalation_note:note, escalated_at:new Date().toISOString(), updated_at:new Date().toISOString()})
    // Compose email from the escalating TC's name
    const subject = encodeURIComponent('Patient Escalation: '+p.patient_name+' ('+(p.office||'')+')')
    const body = encodeURIComponent(
      'Hi,\n\nI need help with a patient on my list:\n\n'+
      'Patient: '+p.patient_name+'\n'+
      'Office: '+(p.office||'')+'\n'+
      'Doctor: '+(p.doctor||'')+'\n'+
      'TX Value: '+USD(p.total_tx_cost||0)+'\n'+
      (p.finance_barrier?'Finance barrier: '+p.finance_barrier+'\n':'')+
      '\nReason for escalation:\n'+note+'\n\n'+
      'Thanks,\n'+(user.name||'')
    )
    window.open('mailto:?subject='+subject+'&body='+body)
    notify('Patient escalated to manager')
    setSending(false); onClose()
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:500,
      display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:14,padding:22,width:'100%',maxWidth:480}}>
        <div style={{fontSize:15,fontWeight:800,color:'#1e293b',marginBottom:4}}>Escalate to Manager</div>
        <div style={{fontSize:12,color:'#64748b',marginBottom:16}}>{p.patient_name} · {USD(p.total_tx_cost||0)}</div>
        <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:5}}>WHAT DO YOU NEED HELP WITH?</div>
        <textarea value={note} onChange={e=>setNote(e.target.value)} autoFocus
          placeholder="e.g. Patient wants treatment but cannot afford it and was declined for CareCredit. Need options."
          style={{width:'100%',boxSizing:'border-box',minHeight:90,padding:'9px 11px',borderRadius:8,
            border:'1px solid #e2e8f0',fontSize:13,resize:'vertical'}}/>
        <div style={{fontSize:11,color:'#94a3b8',marginTop:6}}>
          This sends an email to the manager from your name ({user.name}) and flags the patient.
        </div>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
          <button onClick={onClose}
            style={{padding:'8px 16px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
          <button onClick={submit} disabled={sending||!note.trim()}
            style={{padding:'8px 16px',borderRadius:7,background:note.trim()?'#dc2626':'#fca5a5',color:'white',border:'none',fontWeight:700,cursor:note.trim()?'pointer':'not-allowed'}}>
            {sending?'Sending...':'Escalate'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main alerts view ───────────────────────────────────────────────────────
export default function TcAlerts({ patients, user, isManager, isTC, activeMonth, setActiveMonth, monthTabs, onSave, notify, onJumpToPatient }) {
  const [escalateP, setEscalateP] = useState(null)
  const [typeFilter, setTypeFilter] = useState('all')

  // Month-scoped — alerts reset to the selected month
  const monthPts = useMemo(() =>
    activeMonth==='all' ? patients : patients.filter(p=>(p.month_tab||p.dos?.slice(0,7))===activeMonth)
  , [patients, activeMonth])

  const alerts = useMemo(()=>buildAlerts(monthPts),[monthPts])

  const filtered = typeFilter==='all' ? alerts : alerts.filter(a=>{
    if (typeFilter==='urgent') return a.priority===1
    return a.type===typeFilter
  })

  const dismissEscalation = async (p) => {
    await onSave({...p, escalated:false, escalation_note:'', updated_at:new Date().toISOString()})
    notify('Escalation cleared')
  }

  const counts = {
    urgent: alerts.filter(a=>a.priority===1).length,
    cadence: alerts.filter(a=>a.type==='cadence'||a.type==='due').length,
    visit: alerts.filter(a=>a.type==='visit').length,
    finance: alerts.filter(a=>a.type==='finance').length,
  }

  return (
    <div style={{padding:'18px 24px 60px',maxWidth:1100,margin:'0 auto'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',flexWrap:'wrap',gap:12,marginBottom:16}}>
        <div>
          <div style={{fontSize:18,fontWeight:800,color:'#1e293b'}}>Alerts</div>
          <div style={{fontSize:12,color:'#94a3b8'}}>
            {activeMonth==='all'?'All months':monthLabel(activeMonth)} · {alerts.length} active
            {isManager?' · all TCs':' · your patients'}
          </div>
        </div>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          <button onClick={()=>setActiveMonth('all')}
            style={{padding:'5px 11px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
              background:activeMonth==='all'?'#1e293b':'white',color:activeMonth==='all'?'white':'#64748b',
              border:'1px solid '+(activeMonth==='all'?'#1e293b':'#e2e8f0')}}>All</button>
          {monthTabs.map(m=>(
            <button key={m} onClick={()=>setActiveMonth(m)}
              style={{padding:'5px 11px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',
                background:activeMonth===m?'#1e293b':'white',color:activeMonth===m?'white':'#64748b',
                border:'1px solid '+(activeMonth===m?'#1e293b':'#e2e8f0')}}>{monthLabel(m)}</button>
          ))}
        </div>
      </div>

      {/* Filter pills */}
      <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
        {[
          ['all','All',alerts.length,'#1e293b'],
          ['urgent','Urgent',counts.urgent,'#dc2626'],
          ['cadence','Calls',counts.cadence,'#0d9488'],
          ['visit','Visits to Update',counts.visit,'#854d0e'],
          ['finance','Finance',counts.finance,'#a21caf'],
        ].map(([k,l,c,col])=>(
          <button key={k} onClick={()=>setTypeFilter(k)}
            style={{padding:'5px 12px',borderRadius:99,fontSize:11,fontWeight:700,cursor:'pointer',
              background:typeFilter===k?col:'white',color:typeFilter===k?'white':col,
              border:'1px solid '+(typeFilter===k?col:'#e2e8f0')}}>
            {l}{c>0?` (${c})`:''}
          </button>
        ))}
      </div>

      {filtered.length===0 ? (
        <div style={{textAlign:'center',padding:'50px 0',color:'#94a3b8'}}>
          <div style={{fontSize:32,marginBottom:10}}>✓</div>
          <div style={{fontSize:15,fontWeight:600,color:'#64748b'}}>No alerts for this period</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {filtered.map(a=>(
            <div key={a.id} style={{background:'white',borderRadius:11,border:'1px solid #e2e8f0',
              borderLeft:'4px solid '+a.color,padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>{a.patient.patient_name}</span>
                  {isBigCase(a.patient)&&<span style={{color:'#7c3aed',fontSize:11}}>⭐</span>}
                  <span style={{fontSize:10,fontWeight:700,color:a.color,background:a.color+'18',padding:'2px 8px',borderRadius:99}}>
                    {a.title}
                  </span>
                </div>
                <div style={{fontSize:11,color:'#64748b',marginTop:3}}>
                  {a.msg}
                  {a.escalatedBy && <span style={{color:'#dc2626',fontWeight:600}}> · by {a.escalatedBy}</span>}
                  <span style={{color:'#cbd5e1'}}> · {a.patient.office} · {a.patient.who_tx_plan||a.patient.assigned_tc_name||''}</span>
                </div>
              </div>
              <div style={{display:'flex',gap:6,flexShrink:0}}>
                <button onClick={onJumpToPatient}
                  style={{padding:'6px 12px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                  Open
                </button>
                {a.type==='manual_escalation' && isManager ? (
                  <button onClick={()=>dismissEscalation(a.patient)}
                    style={{padding:'6px 12px',borderRadius:7,background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    Resolve
                  </button>
                ) : !a.patient.escalated && (
                  <button onClick={()=>setEscalateP(a.patient)}
                    style={{padding:'6px 12px',borderRadius:7,background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',fontWeight:700,fontSize:11,cursor:'pointer'}}>
                    Escalate
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {escalateP && (
        <EscalateModal p={escalateP} user={user} onClose={()=>setEscalateP(null)} onSave={onSave} notify={notify}/>
      )}
    </div>
  )
}
