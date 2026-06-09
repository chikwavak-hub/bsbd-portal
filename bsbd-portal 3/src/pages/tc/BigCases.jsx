import React, { useState, useMemo } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'

// ── Big case reasons (manual flag types) ─────────────────────────────────
export const BIG_CASE_REASONS = [
  'Implant','All-on-X','Root Canal','Crown','Bridge',
  'Full Mouth Rehab','Denture','Extraction (surgical)','Bone Graft',
  'Sinus Lift','Veneers','Ortho','Other'
]

// ── Determine if patient qualifies as big case ────────────────────────────
export function isBigCase(p) {
  return p.is_big_case || N(p.total_tx_cost) >= 3000
}

// ── Extended cadence for big cases ────────────────────────────────────────
// Day 1: Email  |  Day 3: Call  |  Day 7: Call+Text  |  Day 14: Finance call
// Day 21: Doctor review  |  Day 30: Final outreach  |  60+: Monthly keep-warm
export function getBigCaseCadence(p) {
  if (p.has_appt === 'Yes' || p.appt_1)
    return { status:'scheduled', label:'Scheduled', color:'#16a34a', priority:0 }
  if (N(p.tx_completed) >= N(p.total_tx_cost) * 0.9 && N(p.tx_completed) > 0)
    return { status:'complete',  label:'Complete',  color:'#16a34a', priority:0 }

  const dos = p.dos
  if (!dos) return { status:'unknown', label:'No DOS set', color:'#94a3b8', priority:3 }

  const today     = new Date(todayStr())
  const dosDate   = new Date(dos)
  const daysSince = Math.floor((today - dosDate) / 86400000)

  // Email not yet sent — day 1
  if ((!p.email_sent || p.email_sent === 'No') && daysSince <= 2)
    return { status:'email', label:'Send Email Today', color:'#1d4ed8', priority:1 }
  if ((!p.email_sent || p.email_sent === 'No') && daysSince > 2)
    return { status:'email_overdue', label:'Email Overdue', color:'#d97706', priority:2 }

  // 1st call — day 3
  if (!p.call_1_date) {
    const d = daysSince - 3
    if (d > 0) return { status:'overdue', label:'Day 3 Call overdue '+d+'d', color:'#d97706', priority:2 }
    if (d === 0) return { status:'due',    label:'Day 3 Call TODAY',          color:'#0d9488', priority:1 }
    return              { status:'pending', label:'Day 3 Call in '+(3-daysSince)+'d', color:'#64748b', priority:3 }
  }

  // 2nd call — day 7 (call + text)
  if (!p.call_2_date) {
    const d = daysSince - 7
    if (d > 0) return { status:'overdue', label:'Day 7 Call+Text overdue '+d+'d', color:'#d97706', priority:2 }
    if (d === 0) return { status:'due',    label:'Day 7 Call+Text TODAY',          color:'#0d9488', priority:1 }
    return              { status:'pending', label:'Day 7 in '+(7-daysSince)+'d',    color:'#64748b', priority:3 }
  }

  // 3rd call — day 14 (finance discussion)
  if (!p.call_3_date) {
    const d = daysSince - 14
    if (d > 0) return { status:'overdue', label:'Day 14 Finance overdue '+d+'d', color:'#ea580c', priority:2 }
    if (d === 0) return { status:'due',    label:'Day 14 Finance TODAY',          color:'#0d9488', priority:1 }
    return              { status:'pending', label:'Day 14 Finance in '+(14-daysSince)+'d', color:'#64748b', priority:3 }
  }

  // Day 21 — doctor/manager flag
  if (daysSince >= 21 && daysSince < 30)
    return { status:'escalate', label:'Doctor Review — '+daysSince+'d since exam', color:'#dc2626', priority:1 }

  // Day 30 — final formal outreach
  if (daysSince >= 30 && daysSince < 60)
    return { status:'final', label:'Final Outreach — '+daysSince+'d', color:'#dc2626', priority:2 }

  // 60+ days — monthly keep-warm
  const months = Math.floor(daysSince / 30)
  return { status:'keepwarm', label:'Keep-warm ('+months+' mo)', color:'#7c3aed', priority:3 }
}

// ── Big Case Card ─────────────────────────────────────────────────────────
function BigCaseCard({ p, onEdit, onEmail, onFlag }) {
  const [expanded, setExpanded] = useState(false)
  const cad = getBigCaseCadence(p)
  const txPct = p.total_tx_cost > 0
    ? Math.min(Math.round(N(p.tx_completed) * 100 / N(p.total_tx_cost)), 100)
    : 0

  const urgent = cad.status === 'escalate' || cad.status === 'final' ||
                 cad.status === 'overdue'  || cad.status === 'email_overdue'

  return (
    <div style={{
      background:'white', borderRadius:14,
      border:'2px solid '+(urgent ? cad.color+'44' : '#e2e8f0'),
      overflow:'hidden', transition:'box-shadow .15s',
    }}>
      {/* Card header */}
      <div style={{padding:'14px 16px', cursor:'pointer'}} onClick={()=>setExpanded(e=>!e)}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8}}>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontSize:14, fontWeight:800, color:'#1e293b',
              whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {p.patient_name}
            </div>
            <div style={{fontSize:11, color:'#64748b', marginTop:2}}>
              {p.doctor||'—'} · {p.who_tx_plan||'—'} · {p.office||'—'}
            </div>
          </div>
          <div style={{textAlign:'right', flexShrink:0, marginLeft:8}}>
            <div style={{fontSize:18, fontWeight:800, color:'#1d4ed8'}}>
              {USD(p.total_tx_cost)}
            </div>
            {p.big_case_reason && (
              <div style={{fontSize:10, fontWeight:700, color:'#7c3aed',
                background:'#f5f3ff', padding:'1px 7px', borderRadius:99, display:'inline-block', marginTop:2}}>
                {p.big_case_reason}
              </div>
            )}
          </div>
        </div>

        {/* Cadence status */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div style={{display:'inline-flex', alignItems:'center', gap:5,
            padding:'4px 10px', borderRadius:7,
            background:cad.color+'18', fontSize:11, fontWeight:700, color:cad.color}}>
            <span>{urgent ? '⚠' : '●'}</span>
            {cad.label}
          </div>
          <div style={{fontSize:10, color:'#94a3b8'}}>{p.dos||''}</div>
        </div>

        {/* TX progress bar */}
        {p.total_tx_cost > 0 && (
          <div style={{marginTop:10}}>
            <div style={{display:'flex', justifyContent:'space-between', marginBottom:3}}>
              <span style={{fontSize:10, color:'#64748b'}}>
                Completed: {USD(p.tx_completed||0)} / {USD(p.total_tx_cost)}
              </span>
              <span style={{fontSize:10, fontWeight:700, color:txPct>=80?'#16a34a':'#64748b'}}>
                {txPct}%
              </span>
            </div>
            <div style={{height:4, background:'#f1f5f9', borderRadius:2, overflow:'hidden'}}>
              <div style={{height:'100%', borderRadius:2, background:txPct>=80?'#16a34a':'#1d4ed8',
                width:txPct+'%'}}/>
            </div>
          </div>
        )}
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{borderTop:'1px solid #f1f5f9', padding:'12px 16px', background:'#fafafa'}}>
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:10, fontSize:12}}>
            <div><b style={{color:'#94a3b8',fontSize:10}}>SCHEDULED TX</b><br/>{USD(p.sched_tx_amount||0)}</div>
            <div><b style={{color:'#94a3b8',fontSize:10}}>INS EXPECTED</b><br/>{USD(p.ins_expected||0)}</div>
            <div><b style={{color:'#94a3b8',fontSize:10}}>1ST APPT</b><br/>{p.appt_1||'—'}</div>
            <div><b style={{color:'#94a3b8',fontSize:10}}>HYG APPT</b><br/>{p.appt_hyg||'—'}</div>
            {(p.call_1_date||p.call_2_date||p.call_3_date) && (
              <div style={{gridColumn:'1/-1'}}>
                <b style={{color:'#94a3b8',fontSize:10}}>CALLS</b><br/>
                {[p.call_1_date,p.call_2_date,p.call_3_date].filter(Boolean).map((d,i)=>(
                  <span key={i} style={{marginRight:8, fontSize:11}}>{['1st','2nd','3rd'][i]}: {d}</span>
                ))}
              </div>
            )}
            {(p.finance_barrier||p.remarks) && (
              <div style={{gridColumn:'1/-1', fontSize:11, color:'#7c3aed', fontStyle:'italic'}}>
                {p.finance_barrier && <span>Barrier: {p.finance_barrier} · </span>}
                {p.remarks && <span>{p.remarks}</span>}
              </div>
            )}
            {p.big_case_notes && (
              <div style={{gridColumn:'1/-1', fontSize:11, color:'#475569'}}>
                <b style={{color:'#94a3b8',fontSize:10}}>NOTES</b><br/>{p.big_case_notes}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div style={{display:'flex', gap:6}}>
            <button onClick={()=>onEmail(p)}
              style={{flex:1, padding:'7px', borderRadius:8, background:'#0d9488',
                color:'white', border:'none', fontWeight:700, fontSize:11, cursor:'pointer'}}>
              Email
            </button>
            <button onClick={()=>onEdit(p)}
              style={{flex:1, padding:'7px', borderRadius:8, background:'#1d4ed8',
                color:'white', border:'none', fontWeight:700, fontSize:11, cursor:'pointer'}}>
              Edit
            </button>
            <button onClick={()=>onFlag(p)}
              style={{flex:1, padding:'7px', borderRadius:8, background:'#f1f5f9',
                color:'#64748b', border:'1px solid #e2e8f0', fontWeight:700, fontSize:11, cursor:'pointer'}}>
              Remove Flag
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Big Cases View ─────────────────────────────────────────────────────────
export default function BigCasesView({ patients, office, onSave, notify, user }) {
  const [editPatient, setEditPatient] = useState(null)
  const [emailPatient, setEmailPatient] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [reasonFilter, setReasonFilter] = useState('all')

  // Filter to big cases for selected office
  const bigCases = useMemo(() => {
    let list = patients.filter(isBigCase)
    if (office !== 'all') list = list.filter(p => p.office === office)
    if (reasonFilter !== 'all') list = list.filter(p => p.big_case_reason === reasonFilter)
    return list.sort((a, b) => {
      const ac = getBigCaseCadence(a), bc2 = getBigCaseCadence(b)
      return (ac.priority||3) - (bc2.priority||3)
    })
  }, [patients, office, reasonFilter])

  const needsAction = bigCases.filter(p => {
    const c = getBigCaseCadence(p); return c.status !== 'scheduled' && c.status !== 'complete' && c.priority <= 2
  })
  const onTrack  = bigCases.filter(p => getBigCaseCadence(p).status === 'pending')
  const complete = bigCases.filter(p => ['scheduled','complete'].includes(getBigCaseCadence(p).status))
  const keepWarm = bigCases.filter(p => getBigCaseCadence(p).status === 'keepwarm')

  const totalValue = bigCases.reduce((s,p) => s + N(p.total_tx_cost), 0)
  const schedValue = bigCases.reduce((s,p) => s + N(p.sched_tx_amount), 0)
  const compValue  = bigCases.reduce((s,p) => s + N(p.tx_completed), 0)

  const reasons = [...new Set(patients.filter(isBigCase).map(p=>p.big_case_reason).filter(Boolean))]

  const removeBigFlag = async (p) => {
    if (!window.confirm('Remove big case flag for '+p.patient_name+'?')) return
    await onSave({...p, is_big_case: false, big_case_reason:'', updated_at: new Date().toISOString()})
    notify('Flag removed')
  }

  const Section = ({title, count, color, items}) => {
    if (!items.length) return null
    return (
      <div style={{marginBottom:24}}>
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12}}>
          <div style={{width:10, height:10, borderRadius:'50%', background:color}}/>
          <span style={{fontSize:12, fontWeight:800, color:'#1e293b', letterSpacing:.5}}>
            {title}
          </span>
          <span style={{fontSize:11, color:'#94a3b8'}}>({count})</span>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:12}}>
          {items.map(p => (
            <BigCaseCard key={p.id} p={p}
              onEdit={setEditPatient}
              onEmail={setEmailPatient}
              onFlag={removeBigFlag}/>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={{padding:'0 24px 60px'}}>
      {/* Summary bar */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',
        gap:10, marginBottom:20}}>
        {[
          ['BIG CASES',      bigCases.length,                          '#1e293b'],
          ['NEEDS ACTION',   needsAction.length,                       '#dc2626'],
          ['TOTAL TX VALUE', '$'+Math.round(totalValue/1000)+'k',      '#1d4ed8'],
          ['SCHEDULED',      '$'+Math.round(schedValue/1000)+'k',      '#0d9488'],
          ['COMPLETED',      '$'+Math.round(compValue/1000)+'k',       '#16a34a'],
          ['POTENTIAL LEFT', '$'+Math.round((totalValue-compValue)/1000)+'k', '#d97706'],
        ].map(([l,v,c]) => (
          <div key={l} style={{background:'white',borderRadius:10,padding:'12px 14px',border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>{l}</div>
            <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Reason filter */}
      {reasons.length > 0 && (
        <div style={{display:'flex', gap:6, marginBottom:16, flexWrap:'wrap'}}>
          <button onClick={()=>setReasonFilter('all')}
            style={{padding:'5px 12px', borderRadius:99, fontSize:11, fontWeight:700,
              background:reasonFilter==='all'?'#1e293b':'white',
              color:reasonFilter==='all'?'white':'#64748b',
              border:'1px solid '+(reasonFilter==='all'?'#1e293b':'#e2e8f0'), cursor:'pointer'}}>
            All
          </button>
          {reasons.map(r => (
            <button key={r} onClick={()=>setReasonFilter(r===reasonFilter?'all':r)}
              style={{padding:'5px 12px', borderRadius:99, fontSize:11, fontWeight:700,
                background:reasonFilter===r?'#7c3aed':'white',
                color:reasonFilter===r?'white':'#7c3aed',
                border:'1px solid '+(reasonFilter===r?'#7c3aed':'#c4b5fd'), cursor:'pointer'}}>
              {r}
            </button>
          ))}
        </div>
      )}

      {bigCases.length === 0 ? (
        <div style={{textAlign:'center', padding:'60px 0', color:'#94a3b8'}}>
          <div style={{fontSize:32, marginBottom:12}}>⭐</div>
          <div style={{fontSize:15, fontWeight:600, color:'#64748b', marginBottom:6}}>No big cases yet</div>
          <div style={{fontSize:13}}>Patients with TX plans over $3,000 will appear here automatically</div>
        </div>
      ) : (
        <>
          <Section title="NEEDS ACTION"  color="#dc2626" count={needsAction.length} items={needsAction}/>
          <Section title="ON TRACK"      color="#0d9488" count={onTrack.length}    items={onTrack}/>
          <Section title="KEEP-WARM"     color="#7c3aed" count={keepWarm.length}   items={keepWarm}/>
          <Section title="SCHEDULED / COMPLETE" color="#16a34a" count={complete.length} items={complete}/>
        </>
      )}
    </div>
  )
}
