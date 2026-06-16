import React, { useMemo } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'
import { isBigCase, getBigCaseCadence } from './BigCases'

const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const monthLabel = m => { if(!m) return ''; const [y,mo]=m.split('-'); return MONTHS_EN[parseInt(mo)-1]+' '+y }

// ── Standard cadence (mirror of Patients.jsx) ─────────────────────────────
function stdCadence(p) {
  if (p.has_appt==='Yes'||p.appt_1) return null
  const dos = p.dos; if (!dos) return null
  const days = Math.floor((new Date(todayStr())-new Date(dos))/86400000)
  const stages = [{day:3,call:'call_1_date'},{day:5,call:'call_2_date'},{day:10,call:'call_3_date'}]
  for (const s of stages) {
    if (!p[s.call]) {
      const d = days - s.day
      if (d > 0) return {status:'overdue', days:d}
      if (d === 0) return {status:'due', days:0}
      return null
    }
  }
  if (days >= 14) return {status:'escalate', days}
  return null
}

function pastApptsNeedingUpdate(p) {
  const today = todayStr()
  const log = p.visit_log || []
  return ['appt_1','appt_2','appt_3','appt_hyg'].filter(k => {
    const d = p[k]; if (!d || d > today) return false
    return !log.find(e => e.appt_key === k)
  })
}

// ── Stat tile ──────────────────────────────────────────────────────────────
function Tile({ label, value, sub, color='#1e293b', accent }) {
  return (
    <div style={{background:'white',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0',
      borderLeft:accent?'4px solid '+accent:'1px solid #e2e8f0'}}>
      <div style={{fontSize:10,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:4}}>{label}</div>
      <div style={{fontSize:24,fontWeight:800,color}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{sub}</div>}
    </div>
  )
}

// ── Task list block ────────────────────────────────────────────────────────
function TaskBlock({ title, color, count, children }) {
  return (
    <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden',marginBottom:14}}>
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'12px 16px',borderBottom:'1px solid #f1f5f9'}}>
        <div style={{width:8,height:8,borderRadius:'50%',background:color}}/>
        <span style={{fontSize:12,fontWeight:800,color:'#1e293b',letterSpacing:.3}}>{title}</span>
        <span style={{marginLeft:'auto',fontSize:12,fontWeight:800,color,background:color+'18',
          padding:'2px 10px',borderRadius:99}}>{count}</span>
      </div>
      <div>{children}</div>
    </div>
  )
}

function PatientLine({ p, right, onClick }) {
  return (
    <div onClick={onClick}
      style={{display:'flex',alignItems:'center',gap:10,padding:'9px 16px',cursor:'pointer',
        borderBottom:'1px solid #f8fafc'}}
      onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'}
      onMouseLeave={e=>e.currentTarget.style.background='white'}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:700,color:'#1e293b',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
          {p.patient_name}{isBigCase(p)&&<span style={{marginLeft:5,color:'#7c3aed'}}>⭐</span>}
        </div>
        <div style={{fontSize:11,color:'#94a3b8'}}>
          {p.doctor||'—'} · {p.office||'—'}{p.total_tx_cost?' · '+USD(p.total_tx_cost):''}
        </div>
      </div>
      {right}
    </div>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────────────
export default function TcDashboard({ patients, allScoped, user, isTC, office, activeMonth, setActiveMonth, monthTabs, onJumpToPatient }) {

  // Month-scoped slice
  const monthPts = useMemo(() =>
    activeMonth==='all' ? patients : patients.filter(p=>(p.month_tab||p.dos?.slice(0,7))===activeMonth)
  , [patients, activeMonth])

  // Scoreboard: Presented -> Scheduled -> Produced
  const score = useMemo(() => {
    const presented = monthPts.reduce((s,p)=>s+N(p.total_tx_cost),0)
    const scheduled = monthPts.reduce((s,p)=>s+N(p.sched_tx_amount),0)
    const produced  = monthPts.reduce((s,p)=>s+N(p.tx_completed),0)
    const ptCount   = monthPts.length
    const apptCount = monthPts.filter(p=>p.has_appt==='Yes'||p.appt_1).length
    const acceptRate = presented>0 ? Math.round(scheduled/presented*100) : 0
    const showRate   = ptCount>0 ? Math.round(apptCount/ptCount*100) : 0
    return { presented, scheduled, produced, ptCount, apptCount, acceptRate, showRate }
  }, [monthPts])

  // Task buckets
  const callsDue   = monthPts.filter(p => { const c=stdCadence(p); return c && c.status==='due' })
  const overdue    = monthPts.filter(p => { const c=stdCadence(p); return c && (c.status==='overdue'||c.status==='escalate') })
  const visitsToUpdate = monthPts.filter(p => pastApptsNeedingUpdate(p).length>0)
  const bigCasesAction = monthPts.filter(p => {
    if (!isBigCase(p)) return false
    const c = getBigCaseCadence(p)
    return c && c.priority <= 2 && c.status!=='scheduled' && c.status!=='complete'
  })

  const greeting = (() => {
    const h = new Date().getHours()
    return h<12?'Good morning':h<17?'Good afternoon':'Good evening'
  })()
  const firstName = (user.name||'').split(' ')[0] || 'there'

  return (
    <div style={{padding:'18px 24px 60px',maxWidth:1200,margin:'0 auto'}}>

      {/* Greeting + month selector */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-end',flexWrap:'wrap',gap:12,marginBottom:18}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,color:'#1e293b'}}>{greeting}, {firstName}</div>
          <div style={{fontSize:13,color:'#94a3b8'}}>
            {isTC?'Your patients':'All patients'} · {activeMonth==='all'?'All time':monthLabel(activeMonth)}
            {office!=='all'?' · '+office:''}
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

      {/* Scoreboard: Presented -> Scheduled -> Produced */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',borderRadius:14,padding:'18px 20px',marginBottom:18}}>
        <div style={{fontSize:10,fontWeight:800,color:'rgba(255,255,255,.6)',letterSpacing:1,marginBottom:14}}>
          {isTC?'YOUR':'TEAM'} CASE PIPELINE
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:14}}>
          {[
            ['PRESENTED', USD(score.presented), score.ptCount+' patients'],
            ['SCHEDULED', USD(score.scheduled), score.acceptRate+'% acceptance'],
            ['PRODUCED',  USD(score.produced),  'work completed'],
          ].map(([l,v,s],i)=>(
            <div key={l} style={{position:'relative'}}>
              <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,.6)',marginBottom:3}}>{l}</div>
              <div style={{fontSize:26,fontWeight:800,color:'white'}}>{v}</div>
              <div style={{fontSize:11,color:'rgba(255,255,255,.7)',marginTop:1}}>{s}</div>
              {i<2 && <div style={{position:'absolute',right:-7,top:'50%',color:'rgba(255,255,255,.4)',fontSize:18}}>→</div>}
            </div>
          ))}
        </div>
        <div style={{display:'flex',gap:20,marginTop:14,paddingTop:12,borderTop:'1px solid rgba(255,255,255,.15)'}}>
          <div style={{fontSize:12,color:'rgba(255,255,255,.8)'}}>
            Show rate: <b style={{color:'white'}}>{score.showRate}%</b>
          </div>
          <div style={{fontSize:12,color:'rgba(255,255,255,.8)'}}>
            Appts booked: <b style={{color:'white'}}>{score.apptCount}/{score.ptCount}</b>
          </div>
        </div>
      </div>

      {/* Today's task summary tiles */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:20}}>
        <Tile label="CALLS DUE TODAY"   value={callsDue.length}        accent="#0d9488" color="#0d9488"/>
        <Tile label="OVERDUE FOLLOW-UP" value={overdue.length}         accent="#d97706" color="#d97706"/>
        <Tile label="VISITS TO UPDATE"  value={visitsToUpdate.length}  accent="#854d0e" color="#854d0e"/>
        <Tile label="BIG CASES TO WORK" value={bigCasesAction.length}  accent="#7c3aed" color="#7c3aed"/>
      </div>

      {/* Action lists */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14}}>
        <div>
          {callsDue.length>0 && (
            <TaskBlock title="CALLS DUE TODAY" color="#0d9488" count={callsDue.length}>
              {callsDue.slice(0,8).map(p=>(
                <PatientLine key={p.id} p={p} onClick={onJumpToPatient}
                  right={<span style={{fontSize:10,fontWeight:700,color:'#0d9488',background:'#f0fdf4',padding:'3px 9px',borderRadius:99}}>Call now</span>}/>
              ))}
            </TaskBlock>
          )}
          {overdue.length>0 && (
            <TaskBlock title="OVERDUE FOLLOW-UP" color="#d97706" count={overdue.length}>
              {overdue.slice(0,8).map(p=>{
                const c = stdCadence(p)
                return <PatientLine key={p.id} p={p} onClick={onJumpToPatient}
                  right={<span style={{fontSize:10,fontWeight:700,color:'#d97706',background:'#fef9c3',padding:'3px 9px',borderRadius:99}}>{c?.days}d overdue</span>}/>
              })}
            </TaskBlock>
          )}
        </div>
        <div>
          {bigCasesAction.length>0 && (
            <TaskBlock title="BIG CASES NEEDING ACTION" color="#7c3aed" count={bigCasesAction.length}>
              {bigCasesAction.slice(0,8).map(p=>{
                const c = getBigCaseCadence(p)
                return <PatientLine key={p.id} p={p} onClick={onJumpToPatient}
                  right={<span style={{fontSize:10,fontWeight:700,color:'#7c3aed',background:'#f5f3ff',padding:'3px 9px',borderRadius:99}}>{c?.label}</span>}/>
              })}
            </TaskBlock>
          )}
          {visitsToUpdate.length>0 && (
            <TaskBlock title="VISITS TO UPDATE" color="#854d0e" count={visitsToUpdate.length}>
              {visitsToUpdate.slice(0,8).map(p=>(
                <PatientLine key={p.id} p={p} onClick={onJumpToPatient}
                  right={<span style={{fontSize:10,fontWeight:700,color:'#854d0e',background:'#fef9c3',padding:'3px 9px',borderRadius:99}}>Log outcome</span>}/>
              ))}
            </TaskBlock>
          )}
        </div>
      </div>

      {callsDue.length===0 && overdue.length===0 && visitsToUpdate.length===0 && bigCasesAction.length===0 && (
        <div style={{textAlign:'center',padding:'50px 0',color:'#94a3b8'}}>
          <div style={{fontSize:32,marginBottom:10}}>✓</div>
          <div style={{fontSize:15,fontWeight:600,color:'#64748b'}}>All caught up for {activeMonth==='all'?'now':monthLabel(activeMonth)}</div>
          <div style={{fontSize:13,marginTop:4}}>No calls due, no overdue follow-ups, nothing to update</div>
        </div>
      )}
    </div>
  )
}
