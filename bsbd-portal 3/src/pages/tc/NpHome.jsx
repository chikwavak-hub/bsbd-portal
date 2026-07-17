// src/pages/tc/NpHome.jsx — Manager/owner morning screen for New Patient Flow.
// Answers "how are we doing" in 3 seconds: funnel cards (Today/Week/Month),
// today's NP appointments with one-tap show/no-show, the at-risk pile,
// production + conversion races, and a data-integrity strip.
// Computes everything from tcPatients client-side; writes via saveTcPatient.

import React, { useState, useMemo } from 'react'
import { N, USD, todayStr, getAppointments } from '../../lib/helpers'

const OFFICES = ['Brainerd','Calhoun','Dalton','McCallie']
const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a'
const AMBER='#d97706', RED='#dc2626', PURPLE='#7c3aed'

const tcOf = p => p.who_tx_plan || p.assigned_tc_name || 'Unassigned'
const drOf = p => p.doctor || 'Unknown'
const pct  = (a,b) => b>0 ? Math.round(a/b*100) : 0

function windowRange(win, today) {
  const t = new Date(today+'T12:00:00')
  if (win==='today') return [today, today]
  if (win==='week') {
    const d = new Date(t); d.setDate(d.getDate()-6)
    return [d.toISOString().slice(0,10), today]
  }
  // month = calendar month to date
  return [today.slice(0,8)+'01', today]
}
function prevRange(win, today) {
  const t = new Date(today+'T12:00:00')
  if (win==='today') { const d=new Date(t); d.setDate(d.getDate()-1); const s=d.toISOString().slice(0,10); return [s,s] }
  if (win==='week')  { const e=new Date(t); e.setDate(e.getDate()-7); const s=new Date(t); s.setDate(s.getDate()-13)
    return [s.toISOString().slice(0,10), e.toISOString().slice(0,10)] }
  const first = new Date(t.getFullYear(), t.getMonth()-1, 1)
  const last  = new Date(t.getFullYear(), t.getMonth(), 0)
  const isoD = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  return [isoD(first), isoD(last)]
}
const inRange = (d, [a,b]) => d && d>=a && d<=b

// patient-level derivations
const isAccepted  = p => N(p.sched_tx_amount)>0 || !!p.appt_1 || (getAppointments(p)||[]).some(a=>a.type!=='Hygiene')
const isComplete  = p => N(p.tx_completed) >= N(p.total_tx_cost)*0.9 && N(p.tx_completed)>0
const hasShowed   = p => (getAppointments(p)||[]).some(a=>a.status==='showed'||a.status==='completed')
const futureAppt  = (p, today) => (getAppointments(p)||[]).some(a=>a.date && a.date>=today && ['booked','planned','showed'].includes(a.status))
const missedLast  = (p, today) => {
  const appts=(getAppointments(p)||[]).filter(a=>a.date).sort((a,b)=>a.date.localeCompare(b.date))
  if(!appts.length) return false
  const last=appts[appts.length-1]
  return last.status==='missed' && last.date<today
}
const brokenChain = (p, today) => {
  const appts=(getAppointments(p)||[]).filter(a=>a.date).sort((a,b)=>a.date.localeCompare(b.date))
  if(!appts.length) return false
  const last=appts[appts.length-1]
  return ['showed','completed'].includes(last.status) && last.date<today && !isComplete(p)
}
const dollarsAtRisk = p => Math.max(N(p.total_tx_cost)-N(p.tx_completed),0)

const Dot = ({c}) => <span style={{width:10,height:10,borderRadius:'50%',background:c,flexShrink:0,display:'inline-block'}}/>
const rag = v => v>=70?GREEN:v>=50?AMBER:RED

export default function NpHome({ user, tcPatients, saveTcPatient, loadTcPatients, notify }) {
  const today = todayStr()
  const [win, setWin]       = useState('month')      // today | week | month
  const [office, setOffice] = useState('all')
  const [showRisk, setShowRisk] = useState(false)
  const [drill, setDrill]       = useState(null)   // {title, sub, rows}
  const [busyId, setBusyId] = useState(null)

  const all = tcPatients || []
  const pts = useMemo(() => office==='all' ? all : all.filter(p=>p.office===office), [all, office])

  const range  = useMemo(()=>windowRange(win, today), [win, today])
  const prangeR = useMemo(()=>prevRange(win, today), [win, today])

  // cohort = patients seen in the window (by DOS)
  const cohort  = useMemo(()=>pts.filter(p=>inRange(p.dos, range)), [pts, range])
  const prev    = useMemo(()=>pts.filter(p=>inRange(p.dos, prangeR)), [pts, prangeR])

  const funnel = useMemo(()=>{
    const seen = cohort.length
    const acc  = cohort.filter(isAccepted)
    const shw  = acc.filter(hasShowed)
    const compD= cohort.reduce((s,p)=>s+N(p.tx_completed),0)
    const compN= cohort.filter(p=>N(p.tx_completed)>0).length
    const pSeen= prev.length
    const pAcc = prev.filter(isAccepted)
    const pShw = pAcc.filter(hasShowed)
    return {
      seen, prevSeen:pSeen,
      accepted:acc.length, acceptRate:pct(acc.length,seen),
      showed:shw.length, convRate:pct(shw.length,acc.length),
      prevConvRate:pct(pShw.length,pAcc.length),
      completedD:compD, completedN:compN,
    }
  }, [cohort, prev])

  // appointments dated in the window, across ALL patients in scope
  const windowAppts = useMemo(()=>{
    const out=[]
    pts.forEach(p=>{
      (getAppointments(p)||[]).forEach((a,idx)=>{
        if(a.date && inRange(a.date, range)) out.push({p, a, idx})
      })
    })
    return out.sort((x,y)=>x.a.date.localeCompare(y.a.date)|| (x.a.time||'').localeCompare(y.a.time||''))
  }, [pts, range])

  // at-risk pile (whole scope, not just window — leaks don't respect the toggle)
  const atRisk = useMemo(()=>{
    const out=[]
    pts.forEach(p=>{
      if(isComplete(p)) return
      let reason=null
      if(missedLast(p,today))                              reason='no-show, never rebooked'
      else if(brokenChain(p,today))                        reason='broken chain — next appt never booked'
      else if(isAccepted(p) && !futureAppt(p,today) && !hasShowed(p)) reason='accepted, nothing booked'
      if(reason) out.push({p, reason, dollars:dollarsAtRisk(p)})
    })
    return out.sort((a,b)=>b.dollars-a.dollars)
  }, [pts, today])
  const riskDollars = atRisk.reduce((s,x)=>s+x.dollars,0)

  // integrity: past appointments with no outcome marked
  const stale = useMemo(()=>{
    let n=0
    pts.forEach(p=>{(getAppointments(p)||[]).forEach(a=>{
      if(a.date && a.date<today && ['booked','planned'].includes(a.status)) n++
    })})
    return n
  }, [pts, today])

  // races (window cohort, by TC)
  const races = useMemo(()=>{
    const m={}
    cohort.forEach(p=>{
      const tc=tcOf(p)
      if(!m[tc]) m[tc]={tc, patients:0, accepted:0, showed:0, produced:0}
      m[tc].patients++
      if(isAccepted(p)){ m[tc].accepted++; if(hasShowed(p)) m[tc].showed++ }
      m[tc].produced += N(p.tx_completed)
    })
    const rows=Object.values(m).filter(x=>x.tc!=='Unassigned')
    const production=[...rows].sort((a,b)=>b.produced-a.produced)
    const conversion=[...rows].filter(x=>x.accepted>=3).map(x=>({...x, rate:pct(x.showed,x.accepted)})).sort((a,b)=>b.rate-a.rate)
    return { production, conversion }
  }, [cohort])

  // doctor RAG (window cohort)
  const doctors = useMemo(()=>{
    const m={}
    cohort.forEach(p=>{
      const d=drOf(p); if(d==='Unknown') return
      if(!m[d]) m[d]={name:d, accepted:0, showed:0, patients:0}
      m[d].patients++
      if(isAccepted(p)){ m[d].accepted++; if(hasShowed(p)) m[d].showed++ }
    })
    return Object.values(m).map(x=>({...x, rate:pct(x.showed,x.accepted)})).sort((a,b)=>b.patients-a.patients)
  }, [cohort])

  // one-tap show / no-show
  const mark = async ({p, idx}, status) => {
    setBusyId(p.id+'_'+idx)
    try {
      const appts=(getAppointments(p)||[]).map((a,i)=>i===idx?{...a,status}:a)
      const patch={...p, appointments:appts.map((a,i)=>({...a,seq:i})), updated_at:new Date().toISOString()}
      if(status==='showed') patch.has_appt='Yes'
      await saveTcPatient(patch)
      notify(status==='showed'?'Marked showed':'Marked no-show')
      loadTcPatients && loadTcPatients()
    } catch(e){ notify('Save failed: '+e.message,'error') }
    setBusyId(null)
  }

  // build drill-down rows (source data behind a tile)
  const toRow = p => ({
    id:p.id, name:p.patient_name, office:p.office, tc:tcOf(p), doctor:drOf(p), dos:p.dos,
    total:N(p.total_tx_cost), sched:N(p.sched_tx_amount), completed:N(p.tx_completed),
    accepted:isAccepted(p), showed:hasShowed(p),
  })
  const openDrill = (title, sub, list) => setDrill({ title, sub, rows:list.map(toRow) })

  const winLabel = {today:'Today', week:'Last 7 days', month:'This month'}[win]
  const convDelta = funnel.convRate - funnel.prevConvRate

  const card={background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:16}
  const label={fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:4}

  return (
    <div style={{minHeight:'100vh',background:'#f8fafc'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',padding:'16px 24px 14px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontSize:10,color:'rgba(255,255,255,.5)',fontWeight:700,letterSpacing:2,marginBottom:2}}>BSBD</div>
            <div style={{fontSize:17,fontWeight:800,color:'white'}}>New Patient Flow</div>
            <div style={{fontSize:11,color:'rgba(255,255,255,.6)'}}>{office==='all'?'All offices':office} · updated {new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</div>
          </div>
          <div style={{display:'flex',gap:4,background:'rgba(255,255,255,.12)',borderRadius:9,padding:3}}>
            {[['today','Today'],['week','Week'],['month','Month']].map(([k,l])=>(
              <button key={k} onClick={()=>setWin(k)}
                style={{padding:'6px 16px',borderRadius:7,border:'none',cursor:'pointer',fontSize:12,fontWeight:700,
                  background:win===k?'white':'transparent',color:win===k?NAVY:'rgba(255,255,255,.8)'}}>{l}</button>
            ))}
          </div>
        </div>
        {/* Office tabs */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:12}}>
          <button onClick={()=>setOffice('all')}
            style={{padding:'5px 13px',borderRadius:99,fontWeight:700,fontSize:11,border:'none',cursor:'pointer',
              background:office==='all'?'white':'rgba(255,255,255,.12)',color:office==='all'?NAVY:'rgba(255,255,255,.8)'}}>All</button>
          {OFFICES.map(o=>(
            <button key={o} onClick={()=>setOffice(o)}
              style={{padding:'5px 13px',borderRadius:99,fontWeight:700,fontSize:11,border:'none',cursor:'pointer',
                background:office===o?'white':'rgba(255,255,255,.12)',color:office===o?NAVY:'rgba(255,255,255,.8)'}}>{o}</button>
          ))}
        </div>
      </div>

      <div style={{padding:'16px 24px 60px',maxWidth:1100,margin:'0 auto'}}>

        {/* Integrity strip — only shows when the data is lying */}
        {stale>0 && (
          <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,padding:'10px 14px',
            marginBottom:14,display:'flex',gap:8,alignItems:'flex-start'}}>
            <span>⚠️</span>
            <span style={{fontSize:12,color:'#92400e',fontWeight:600}}>
              Data integrity: {stale} past appointment{stale!==1?'s':''} with no show/no-show recorded. Numbers below may understate — work these first.
            </span>
          </div>
        )}

        {/* Funnel cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10,marginBottom:16}}>
          <div style={{...card,cursor:'pointer'}} onClick={()=>openDrill('Seen — '+winLabel, cohort.length+' new patients by DOS in window', cohort)}>
            <div style={label}>SEEN · {winLabel.toUpperCase()}</div>
            <div style={{fontSize:26,fontWeight:800,color:NAVY,lineHeight:1}}>{funnel.seen}</div>
            <div style={{fontSize:11,color:funnel.seen>=funnel.prevSeen?GREEN:'#94a3b8',marginTop:4}}>vs {funnel.prevSeen} last {win==='today'?'day':win}</div>
          </div>
          <div style={{...card,cursor:'pointer'}} onClick={()=>openDrill('Accepted TX — '+winLabel, 'Sched $ > 0 or a treatment appointment booked', cohort.filter(isAccepted))}>
            <div style={label}>ACCEPTED TX</div>
            <div style={{fontSize:26,fontWeight:800,color:BLUE,lineHeight:1}}>{funnel.accepted}</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:4}}>{funnel.acceptRate}% acceptance</div>
          </div>
          <div style={{...card,background:'#eff6ff',border:'2px solid #93c5fd',cursor:'pointer'}} onClick={()=>openDrill('Conversion — '+winLabel, 'Accepted patients · showed vs not yet showed', cohort.filter(isAccepted))}>
            <div style={label}>CONVERSION — SHOWED</div>
            <div style={{fontSize:26,fontWeight:800,color:BLUE,lineHeight:1}}>
              {funnel.convRate}%
              {funnel.prevConvRate>0 && <span style={{fontSize:13,marginLeft:6,color:convDelta>=0?GREEN:RED}}>{convDelta>=0?'▲':'▼'} {Math.abs(convDelta)}</span>}
            </div>
            <div style={{fontSize:11,color:'#64748b',marginTop:4}}>{funnel.showed} of {funnel.accepted} accepted</div>
          </div>
          <div style={{...card,cursor:'pointer'}} onClick={()=>openDrill('Completed — '+winLabel, 'Patients with production logged', cohort.filter(p=>N(p.tx_completed)>0))}>
            <div style={label}>COMPLETED</div>
            <div style={{fontSize:26,fontWeight:800,color:GREEN,lineHeight:1}}>${Math.round(funnel.completedD/1000)}k</div>
            <div style={{fontSize:11,color:GREEN,marginTop:4}}>{funnel.completedN} patients</div>
          </div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14,marginBottom:16}}>
          {/* NP appointments in window */}
          <div style={card}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
              <div style={{fontSize:13,fontWeight:800,color:NAVY}}>📅 NP appointments</div>
              <div style={{fontSize:11,color:'#94a3b8'}}>{windowAppts.length} in {winLabel.toLowerCase()}</div>
            </div>
            {windowAppts.length===0 && <div style={{fontSize:12,color:'#94a3b8',padding:'10px 0'}}>No appointments dated in this window</div>}
            <div style={{maxHeight:320,overflowY:'auto'}}>
              {windowAppts.slice(0,40).map(({p,a,idx},i)=>{
                const past = a.date<=today
                const unmarked = past && ['booked','planned'].includes(a.status)
                const sc = {showed:GREEN, completed:BLUE, missed:RED, booked:TEAL, planned:'#94a3b8'}[a.status]||'#94a3b8'
                return (
                  <div key={p.id+'_'+idx} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',
                    borderBottom:'1px solid #f8fafc',flexWrap:'wrap'}}>
                    <div style={{flex:1,minWidth:140}}>
                      <div style={{fontSize:12,fontWeight:700,color:'#1e293b'}}>{p.patient_name}</div>
                      <div style={{fontSize:10,color:'#94a3b8'}}>{a.date}{a.time?' · '+a.time:''} · {a.type} · TC {tcOf(p)}{office==='all'&&p.office?' · '+p.office:''}</div>
                    </div>
                    {unmarked ? (
                      <div style={{display:'flex',gap:4}}>
                        <button disabled={busyId===p.id+'_'+idx} onClick={()=>mark({p,idx},'showed')}
                          style={{padding:'4px 11px',borderRadius:6,background:GREEN,color:'white',border:'none',fontSize:10,fontWeight:700,cursor:'pointer'}}>Showed</button>
                        <button disabled={busyId===p.id+'_'+idx} onClick={()=>mark({p,idx},'missed')}
                          style={{padding:'4px 11px',borderRadius:6,background:'#fee2e2',color:RED,border:'none',fontSize:10,fontWeight:700,cursor:'pointer'}}>No-show</button>
                      </div>
                    ) : (
                      <span style={{fontSize:10,fontWeight:700,color:sc,background:sc+'18',padding:'3px 10px',borderRadius:99}}>
                        {a.status==='missed'?'no-show':a.status}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* At risk */}
          <div style={{...card, background:'#fef2f2', border:'1px solid #fecaca'}}>
            <div style={{fontSize:13,fontWeight:800,color:'#991b1b',marginBottom:6}}>🚨 At risk of being lost</div>
            <div style={{fontSize:34,fontWeight:800,color:RED,lineHeight:1}}>{atRisk.length}</div>
            <div style={{fontSize:12,color:'#991b1b',marginTop:6,marginBottom:12}}>
              patients with a leak in the chain. <b>{USD(riskDollars)}</b> unbooked.
            </div>
            <button onClick={()=>setShowRisk(s=>!s)}
              style={{width:'100%',padding:'9px 0',borderRadius:8,background:'white',border:'1px solid #fca5a5',
                color:'#b91c1c',fontWeight:700,fontSize:12,cursor:'pointer'}}>
              {showRisk?'Hide the list':'Work the list'}
            </button>
            {showRisk && (
              <div style={{marginTop:10,maxHeight:300,overflowY:'auto'}}>
                {atRisk.map(({p,reason,dollars})=>(
                  <div key={p.id} style={{background:'white',borderRadius:8,padding:'8px 10px',marginBottom:6,border:'1px solid #fee2e2'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                      <span style={{fontSize:12,fontWeight:700,color:'#1e293b'}}>{p.patient_name}</span>
                      <span style={{fontSize:12,fontWeight:800,color:RED}}>{USD(dollars)}</span>
                    </div>
                    <div style={{fontSize:10,color:'#94a3b8'}}>{reason} · TC {tcOf(p)}{office==='all'&&p.office?' · '+p.office:''}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Races */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(320px,1fr))',gap:14,marginBottom:16}}>
          <div style={card}>
            <div style={{fontSize:13,fontWeight:800,color:NAVY}}>🏆 Production race</div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:10}}>Completed $ · {winLabel.toLowerCase()}</div>
            {races.production.length===0 && <div style={{fontSize:12,color:'#94a3b8'}}>No TC data in this window</div>}
            {races.production.slice(0,6).map((t,i)=>(
              <div key={t.tc} onClick={()=>openDrill('TC '+t.tc+' — '+winLabel, t.patients+' patients handled in window', cohort.filter(p=>tcOf(p)===t.tc))}
                style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid #f8fafc',cursor:'pointer'}}>
                <span style={{fontSize:12,fontWeight:800,color:i===0?'#ca8a04':'#94a3b8',minWidth:18}}>{i+1}</span>
                <span style={{flex:1,fontSize:12,fontWeight:700,color:'#1e293b'}}>{i===0&&t.produced>0?'👑 ':''}{t.tc}</span>
                <span style={{fontSize:13,fontWeight:800,color:GREEN}}>{USD(t.produced)}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{fontSize:13,fontWeight:800,color:NAVY}}>🎯 Conversion race</div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:10}}>Show rate · {winLabel.toLowerCase()} · min 3 accepted</div>
            {races.conversion.length===0 && <div style={{fontSize:12,color:'#94a3b8'}}>Not enough accepted plans in this window yet</div>}
            {races.conversion.slice(0,6).map((t,i)=>(
              <div key={t.tc} onClick={()=>openDrill('TC '+t.tc+' — '+winLabel, t.showed+' of '+t.accepted+' accepted showed', cohort.filter(p=>tcOf(p)===t.tc))}
                style={{display:'flex',alignItems:'center',gap:10,padding:'7px 0',borderBottom:'1px solid #f8fafc',cursor:'pointer'}}>
                <span style={{fontSize:12,fontWeight:800,color:i===0?'#ca8a04':'#94a3b8',minWidth:18}}>{i+1}</span>
                <span style={{flex:1,fontSize:12,fontWeight:700,color:'#1e293b'}}>{i===0?'👑 ':''}{t.tc}</span>
                <span style={{fontSize:11,color:'#94a3b8'}}>{t.showed}/{t.accepted}</span>
                <span style={{fontSize:13,fontWeight:800,color:rag(t.rate)}}>{t.rate}%</span>
              </div>
            ))}
            <div style={{fontSize:10,color:'#94a3b8',marginTop:8,fontStyle:'italic'}}>Two winners each month: most $ and best rate.</div>
          </div>
        </div>

        {/* Doctors RAG */}
        <div style={card}>
          <div style={{fontSize:13,fontWeight:800,color:NAVY,marginBottom:10}}>🩺 Doctors · show rate on accepted plans · {winLabel.toLowerCase()}</div>
          {doctors.length===0 && <div style={{fontSize:12,color:'#94a3b8'}}>No doctor data in this window</div>}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:8}}>
            {doctors.map(d=>(
              <div key={d.name} onClick={()=>openDrill(d.name+' — '+winLabel, d.patients+' patients · show rate on accepted plans', cohort.filter(p=>drOf(p)===d.name))}
                style={{display:'flex',alignItems:'center',gap:10,background:'#f8fafc',
                borderRadius:9,padding:'9px 12px',border:'1px solid #f1f5f9',cursor:'pointer'}}>
                <Dot c={d.accepted>=3?rag(d.rate):'#94a3b8'}/>
                <span style={{flex:1,fontSize:12,fontWeight:700,color:'#1e293b'}}>{d.name}</span>
                <span style={{fontSize:11,color:'#94a3b8'}}>{d.patients} pts</span>
                <span style={{fontSize:13,fontWeight:800,color:d.accepted>=3?rag(d.rate):'#94a3b8'}}>{d.accepted>0?d.rate+'%':'—'}</span>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* DRILL-DOWN: source data behind a tile */}
      {drill && (
        <div onClick={()=>setDrill(null)}
          style={{position:'fixed',inset:0,background:'rgba(15,23,42,.55)',zIndex:1000,
            display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'white',borderRadius:16,maxWidth:880,width:'100%',overflow:'hidden',
              boxShadow:'0 20px 60px rgba(0,0,0,.25)'}}>
            <div style={{background:'linear-gradient(135deg,#1e3a5f,#163c5a)',padding:'16px 22px',
              display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
              <div>
                <div style={{fontSize:17,fontWeight:800,color:'white'}}>{drill.title}</div>
                <div style={{fontSize:11,color:'rgba(255,255,255,.6)',marginTop:2}}>{drill.sub} · {drill.rows.length} patient{drill.rows.length!==1?'s':''}</div>
              </div>
              <button onClick={()=>setDrill(null)}
                style={{background:'rgba(255,255,255,.15)',border:'none',color:'white',width:30,height:30,
                  borderRadius:8,fontSize:18,cursor:'pointer',lineHeight:1}}>×</button>
            </div>
            <div style={{maxHeight:'65vh',overflowY:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead style={{position:'sticky',top:0,zIndex:1}}>
                  <tr>{['Patient','Office','TC','Doctor','DOS','Total','Sched','Completed','Status'].map(h=>(
                    <th key={h} style={{padding:'9px 10px',textAlign:['Total','Sched','Completed'].includes(h)?'right':'left',
                      fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,background:'#f8fafc',
                      borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>))}</tr>
                </thead>
                <tbody>
                  {drill.rows.map((r,i)=>(
                    <tr key={r.id||i} style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                      <td style={{padding:'8px 10px',fontWeight:700,whiteSpace:'nowrap'}}>{r.name}</td>
                      <td style={{padding:'8px 10px',color:'#64748b'}}>{r.office}</td>
                      <td style={{padding:'8px 10px',color:'#64748b'}}>{r.tc}</td>
                      <td style={{padding:'8px 10px',color:'#64748b',whiteSpace:'nowrap'}}>{r.doctor}</td>
                      <td style={{padding:'8px 10px',color:'#94a3b8',whiteSpace:'nowrap'}}>{r.dos}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:BLUE}}>{r.total?USD(r.total):'—'}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',color:TEAL}}>{r.sched?USD(r.sched):'—'}</td>
                      <td style={{padding:'8px 10px',textAlign:'right',color:GREEN,fontWeight:700}}>{r.completed?USD(r.completed):'—'}</td>
                      <td style={{padding:'8px 10px'}}>
                        {r.completed>0
                          ? <span style={{fontSize:10,fontWeight:700,color:GREEN,background:'#dcfce7',padding:'2px 9px',borderRadius:99}}>produced</span>
                          : r.showed
                            ? <span style={{fontSize:10,fontWeight:700,color:BLUE,background:'#dbeafe',padding:'2px 9px',borderRadius:99}}>showed</span>
                            : r.accepted
                              ? <span style={{fontSize:10,fontWeight:700,color:AMBER,background:'#fef9c3',padding:'2px 9px',borderRadius:99}}>not shown yet</span>
                              : <span style={{fontSize:10,fontWeight:700,color:'#64748b',background:'#f1f5f9',padding:'2px 9px',borderRadius:99}}>seen only</span>}
                      </td>
                    </tr>
                  ))}
                  {drill.rows.length===0 && (
                    <tr><td colSpan={9} style={{padding:'24px 10px',textAlign:'center',color:'#94a3b8'}}>No patients behind this number in the current window</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{padding:'9px 22px',borderTop:'1px solid #f1f5f9',background:'#fafafa',
              fontSize:11,color:'#94a3b8',textAlign:'center'}}>
              This is the exact patient set behind the number · click outside to close
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
