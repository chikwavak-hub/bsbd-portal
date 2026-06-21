import React, { useState, useMemo, useRef, useCallback } from 'react'
import { N, USD } from '../../lib/helpers'

// ── Constants ──────────────────────────────────────────────────────────────
const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a'
const AMBER='#d97706', RED='#dc2626', PURPLE='#7c3aed'

const isBig      = p => N(p.total_tx_cost) >= 3000
const hasAppt    = p => p.has_appt === 'Yes' || !!p.appt_1
const isComplete = p => N(p.tx_completed) >= N(p.total_tx_cost) * 0.9 && N(p.tx_completed) > 0
const callCount  = p => [p.call_1_date, p.call_2_date, p.call_3_date].filter(Boolean).length
const lastCall   = p => [p.call_3_date, p.call_2_date, p.call_1_date].find(Boolean) || null
const tcOf       = p => p.who_tx_plan || p.assigned_tc_name || 'Unassigned'
const drOf       = p => p.doctor || 'Unknown'
const pct        = (a,b) => b>0 ? Math.round(a/b*100) : 0
const daysSince  = d => d ? Math.floor((Date.now() - new Date(d+'T12:00:00')) / 86400000) : null

// ── Interactive line chart (hover crosshair + tooltip) ─────────────────────
function Chart({ series, height=200, fmt='#' }) {
  const [hover, setHover] = useState(null)
  const ref = useRef()
  const all = series.flatMap(s=>s.points.map(p=>p.value)).filter(v=>v!=null)
  if (!all.length) return <div style={{height,display:'flex',alignItems:'center',justifyContent:'center',color:'#94a3b8',fontSize:12}}>No data</div>
  const labels = series[0].points.map(p=>p.label)
  const W=760, H=height, PAD={top:18,right:18,bottom:26,left:52}
  const cW=W-PAD.left-PAD.right, cH=H-PAD.top-PAD.bottom
  const maxV = Math.max(...all)*1.12 || 1
  const xP = i => PAD.left + (i/Math.max(labels.length-1,1))*cW
  const yP = v => PAD.top + cH - (v/maxV)*cH
  const fv = v => fmt==='$' ? '$'+Math.round(v).toLocaleString() : fmt==='%' ? Math.round(v)+'%' : Math.round(v)
  const onMove = useCallback(e=>{
    if(!ref.current) return
    const r=ref.current.getBoundingClientRect()
    const mx=(e.clientX-r.left)*(W/r.width)
    const i=Math.max(0,Math.min(labels.length-1,Math.round(((mx-PAD.left)/cW)*(labels.length-1))))
    setHover(i)
  },[labels.length,cW])
  return (
    <div style={{position:'relative',userSelect:'none'}}>
      {series.length>1 && (
        <div style={{display:'flex',gap:14,marginBottom:8,flexWrap:'wrap'}}>
          {series.map(s=>(<div key={s.label} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'#64748b'}}>
            <div style={{width:14,height:3,borderRadius:2,background:s.color}}/>{s.label}</div>))}
        </div>
      )}
      {hover!=null && (
        <div style={{position:'absolute',top:series.length>1?28:0,
          left:`clamp(8px, calc(${((xP(hover)/W)*100).toFixed(1)}% - 60px), calc(100% - 140px))`,
          background:'white',border:'1px solid #e2e8f0',borderRadius:9,boxShadow:'0 4px 16px rgba(0,0,0,.1)',
          padding:'8px 12px',zIndex:10,minWidth:130,pointerEvents:'none'}}>
          <div style={{fontSize:10,fontWeight:800,color:'#94a3b8',marginBottom:5}}>{labels[hover]}</div>
          {series.map(s=>s.points[hover]?.value!=null && (
            <div key={s.label} style={{display:'flex',justifyContent:'space-between',gap:12,fontSize:12,marginBottom:2}}>
              <div style={{display:'flex',alignItems:'center',gap:5}}><div style={{width:8,height:8,borderRadius:'50%',background:s.color}}/>
                <span style={{color:'#64748b'}}>{s.label}</span></div>
              <span style={{fontWeight:800}}>{fv(s.points[hover].value)}</span>
            </div>
          ))}
        </div>
      )}
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} style={{width:'100%',height,cursor:'crosshair'}}
        preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
        {[0,1,2,3,4].map(i=>{const v=maxV/4*i,y=yP(v);return(
          <g key={i}><line x1={PAD.left} y1={y} x2={W-PAD.right} y2={y} stroke="#f1f5f9"/>
          <text x={PAD.left-6} y={y+4} textAnchor="end" fontSize="9" fill="#94a3b8">{fv(v)}</text></g>)})}
        {labels.map((l,i)=>{if(labels.length>12&&i%Math.ceil(labels.length/12)!==0)return null
          return <text key={i} x={xP(i)} y={H-4} textAnchor="middle" fontSize="9" fill="#94a3b8">{l}</text>})}
        {hover!=null && <line x1={xP(hover)} y1={PAD.top} x2={xP(hover)} y2={H-PAD.bottom} stroke="#94a3b8" strokeDasharray="3,3"/>}
        {series.map((s,si)=>{
          const pts=s.points.map((p,i)=>({...p,i})).filter(p=>p.value!=null)
          if(!pts.length)return null
          const line=pts.map((p,j)=>`${j===0?'M':'L'} ${xP(p.i)} ${yP(p.value)}`).join(' ')
          const area=line+` L ${xP(pts[pts.length-1].i)} ${yP(0)} L ${xP(pts[0].i)} ${yP(0)} Z`
          return(<g key={si}><path d={area} fill={s.color} fillOpacity="0.07"/>
            <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round"/>
            {hover!=null && s.points[hover]?.value!=null && (
              <circle cx={xP(hover)} cy={yP(s.points[hover].value)} r="4.5" fill="white" stroke={s.color} strokeWidth="2"/>)}
            {pts.length<=12 && pts.map(p=><circle key={p.i} cx={xP(p.i)} cy={yP(p.value)} r="2.5" fill={s.color} fillOpacity=".7"/>)}
          </g>)
        })}
      </svg>
    </div>
  )
}

// ── View toggle ────────────────────────────────────────────────────────────
const Toggle = ({view,setView}) => (
  <div style={{display:'flex',borderRadius:7,overflow:'hidden',border:'1px solid #e2e8f0',flexShrink:0}}>
    {[['graph','📈'],['table','📋']].map(([v,l])=>(
      <button key={v} onClick={()=>setView(v)}
        style={{padding:'5px 12px',border:'none',cursor:'pointer',fontSize:11,fontWeight:700,
          background:view===v?NAVY:'white',color:view===v?'white':'#64748b'}}>{l}</button>
    ))}
  </div>
)

const Section = ({title, sub, view, setView, children}) => (
  <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',marginBottom:16,overflow:'hidden'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',padding:'14px 18px 12px',borderBottom:'1px solid #f1f5f9'}}>
      <div><div style={{fontSize:13,fontWeight:800,color:NAVY}}>{title}</div>
        {sub&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{sub}</div>}</div>
      {setView && <Toggle view={view} setView={setView}/>}
    </div>
    <div style={{padding:'14px 18px'}}>{children}</div>
  </div>
)

const Th = ({col,label,sort,setSort,align='left'}) => {
  const active=sort.col===col
  return <th onClick={()=>setSort(s=>({col,dir:s.col===col&&s.dir==='desc'?'asc':'desc'}))}
    style={{padding:'7px 10px',textAlign:align,fontSize:9,fontWeight:800,color:active?BLUE:'#94a3b8',
      letterSpacing:.5,cursor:'pointer',userSelect:'none',whiteSpace:'nowrap',background:'#f8fafc'}}>
    {label} {active?(sort.dir==='desc'?'↓':'↑'):''}</th>
}

const EditBtn = ({onClick}) => (
  <button onClick={onClick} style={{padding:'3px 10px',borderRadius:6,background:BLUE,color:'white',
    border:'none',fontSize:10,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'}}>Open</button>
)

// ── Main ───────────────────────────────────────────────────────────────────
export default function TcAnalytics({ patients, activeMonth, onOpenPatient }) {
  const [vFunnel, setVFunnel] = useState('graph')
  const [vTrend,  setVTrend]  = useState('graph')
  const [tcSort,  setTcSort]  = useState({col:'patients',dir:'desc'})
  const [drSort,  setDrSort]  = useState({col:'patients',dir:'desc'})
  const [attnSort,setAttnSort]= useState({col:'value',dir:'desc'})
  const [drill,   setDrill]   = useState(null)  // {type:'tc'|'dr', name}

  const pts = patients || []

  // ── NEEDS ATTENTION ──
  const attention = useMemo(() => {
    const out = []
    pts.forEach(p => {
      if (isComplete(p)) return
      const cc = callCount(p), appt = hasAppt(p), val = N(p.total_tx_cost)
      const last = lastCall(p), since = daysSince(last)
      let reason = null, urgency = 0
      if (!appt && cc === 0)                       { reason='No appt · never called';       urgency=val>=3000?3:2 }
      else if (!appt && cc>0 && since!=null && since>=7) { reason=`No appt · last call ${since}d ago`; urgency=val>=3000?3:2 }
      else if (!appt && cc>=3)                     { reason='No appt · 3 calls exhausted';  urgency=2 }
      else if (p.finance_stalled)                  { reason='Finance stalled';              urgency=val>=3000?3:1 }
      else if (!appt)                              { reason='No appointment booked';        urgency=1 }
      if (reason) out.push({ p, reason, urgency, value:val, calls:cc, last, since })
    })
    return out.sort((a,b)=> b.urgency-a.urgency || b.value-a.value)
  }, [pts])

  const sortedAttn = useMemo(()=>{
    const s=[...attention]
    s.sort((a,b)=>{
      if(attnSort.col==='name') return attnSort.dir==='asc'?a.p.patient_name?.localeCompare(b.p.patient_name||''):b.p.patient_name?.localeCompare(a.p.patient_name||'')
      const av=a[attnSort.col]??0, bv=b[attnSort.col]??0
      return attnSort.dir==='asc'?av-bv:bv-av
    })
    return s
  },[attention,attnSort])

  // ── FUNNEL ──
  const funnel = useMemo(() => {
    const total      = pts.length
    const presented  = pts.filter(p=>N(p.total_tx_cost)>0||p.tx_plan).length
    const scheduled  = pts.filter(hasAppt).length
    const showed     = pts.filter(p=>p.appt_1).length
    const produced   = pts.filter(isComplete).length
    const valPresented = pts.reduce((s,p)=>s+N(p.total_tx_cost),0)
    const valScheduled = pts.reduce((s,p)=>s+N(p.sched_tx_amount),0)
    const valProduced  = pts.reduce((s,p)=>s+N(p.tx_completed),0)
    return [
      {key:'presented', label:'TX Presented', count:presented, value:valPresented, color:BLUE},
      {key:'scheduled', label:'Scheduled',    count:scheduled, value:valScheduled, color:TEAL},
      {key:'showed',    label:'Showed (1st appt)', count:showed, value:null,       color:PURPLE},
      {key:'produced',  label:'Produced',     count:produced,  value:valProduced,  color:GREEN},
    ]
  }, [pts])

  // ── TC LEADERBOARD ──
  const tcRows = useMemo(() => {
    const m={}
    pts.forEach(p=>{const tc=tcOf(p)
      if(!m[tc])m[tc]={name:tc,patients:0,value:0,scheduled:0,produced:0,withAppt:0,bigCases:0,stalls:0,calls:0}
      const x=m[tc]; x.patients++; x.value+=N(p.total_tx_cost); x.scheduled+=N(p.sched_tx_amount)
      x.produced+=N(p.tx_completed); if(hasAppt(p))x.withAppt++; if(isBig(p))x.bigCases++
      if(p.finance_stalled)x.stalls++; x.calls+=callCount(p)})
    const arr=Object.values(m).map(x=>({...x,
      conversion:pct(x.withAppt,x.patients), avgValue:x.patients>0?Math.round(x.value/x.patients):0,
      prodRate:pct(x.produced,x.value)}))
    arr.sort((a,b)=>{const av=a[tcSort.col]??0,bv=b[tcSort.col]??0
      return tcSort.col==='name'?(tcSort.dir==='asc'?a.name.localeCompare(b.name):b.name.localeCompare(a.name)):(tcSort.dir==='asc'?av-bv:bv-av)})
    return arr
  }, [pts,tcSort])

  // ── DOCTOR REFERRAL PATTERNS ──
  const drRows = useMemo(() => {
    const m={}
    pts.forEach(p=>{const dr=drOf(p), tc=tcOf(p)
      if(!m[dr])m[dr]={name:dr,patients:0,value:0,scheduled:0,withAppt:0,bigCases:0,tcs:{}}
      const x=m[dr]; x.patients++; x.value+=N(p.total_tx_cost); x.scheduled+=N(p.sched_tx_amount)
      if(hasAppt(p))x.withAppt++; if(isBig(p))x.bigCases++
      x.tcs[tc]=(x.tcs[tc]||0)+1})
    const arr=Object.values(m).map(x=>({...x,
      conversion:pct(x.withAppt,x.patients), avgValue:x.patients>0?Math.round(x.value/x.patients):0,
      topTc:Object.entries(x.tcs).sort((a,b)=>b[1]-a[1])[0]?.[0]||'—'}))
    arr.sort((a,b)=>{const av=a[drSort.col]??0,bv=b[drSort.col]??0
      return drSort.col==='name'?(drSort.dir==='asc'?a.name.localeCompare(b.name):b.name.localeCompare(a.name)):(drSort.dir==='asc'?av-bv:bv-av)})
    return arr
  }, [pts,drSort])

  // ── TRENDS (by week within the scope) ──
  const trend = useMemo(() => {
    const byDate={}
    pts.forEach(p=>{const d=p.dos||p.month_tab; if(!d)return
      const wk=d.slice(0,10)
      if(!byDate[wk])byDate[wk]={presented:0,scheduled:0,produced:0,n:0}
      byDate[wk].n++; if(N(p.total_tx_cost)>0)byDate[wk].presented++
      if(hasAppt(p))byDate[wk].scheduled++; if(isComplete(p))byDate[wk].produced++})
    const dates=Object.keys(byDate).sort()
    return dates.map(d=>({label:d.slice(5),date:d,
      conversion:byDate[d].presented>0?Math.round(byDate[d].scheduled/byDate[d].presented*100):null,
      patients:byDate[d].n, scheduled:byDate[d].scheduled, produced:byDate[d].produced}))
  }, [pts])

  // ── Summary tiles ──
  const summary = useMemo(()=>({
    total:pts.length,
    value:pts.reduce((s,p)=>s+N(p.total_tx_cost),0),
    conversion:pct(pts.filter(hasAppt).length,pts.length),
    produced:pts.reduce((s,p)=>s+N(p.tx_completed),0),
    needsAttn:attention.length,
  }),[pts,attention])

  const funnelMax = Math.max(...funnel.map(f=>f.count),1)
  const urgencyColor = u => u>=3?RED:u>=2?AMBER:'#64748b'

  // ── Drill-down: patients for the clicked TC or doctor ──
  const drillData = useMemo(() => {
    if (!drill) return null
    const list = pts.filter(p => drill.type==='tc' ? tcOf(p)===drill.name : drOf(p)===drill.name)
      .map(p => ({
        p, name:p.patient_name, value:N(p.total_tx_cost), sched:N(p.sched_tx_amount),
        produced:N(p.tx_completed), appt:hasAppt(p), big:isBig(p), complete:isComplete(p),
        calls:callCount(p), last:lastCall(p), stall:p.finance_stalled,
        status: isComplete(p)?'Complete':hasAppt(p)?'Scheduled':isBig(p)?'Big Case':callCount(p)>0?'Following Up':'New',
      }))
      .sort((a,b)=> b.value-a.value)
    const totals = {
      count:list.length,
      value:list.reduce((s,x)=>s+x.value,0),
      scheduled:list.reduce((s,x)=>s+x.sched,0),
      produced:list.reduce((s,x)=>s+x.produced,0),
      withAppt:list.filter(x=>x.appt).length,
      noAppt:list.filter(x=>!x.appt&&!x.complete).length,
      big:list.filter(x=>x.big).length,
    }
    return { list, totals }
  }, [drill, pts])

  const statusColor = s => s==='Complete'?GREEN:s==='Scheduled'?TEAL:s==='Big Case'?PURPLE:s==='Following Up'?BLUE:'#94a3b8'

  if (!pts.length) return (
    <div style={{textAlign:'center',padding:60,color:'#94a3b8'}}>
      <div style={{fontSize:32,marginBottom:10}}>📊</div>
      <div style={{fontSize:14,fontWeight:600}}>No patients in this view</div>
    </div>
  )

  return (
    <div style={{maxWidth:1050,margin:'0 auto',padding:'4px 0 40px'}}>

      {/* ── DRILL-DOWN PANEL ── */}
      {drill && drillData && (
        <div onClick={()=>setDrill(null)}
          style={{position:'fixed',inset:0,background:'rgba(15,23,42,.5)',zIndex:1000,
            display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 20px',overflowY:'auto'}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'white',borderRadius:16,maxWidth:820,width:'100%',
              boxShadow:'0 20px 60px rgba(0,0,0,.25)',overflow:'hidden'}}>
            {/* Header */}
            <div style={{background:'linear-gradient(135deg,#1e3a5f,#163c5a)',padding:'18px 22px'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                <div>
                  <div style={{fontSize:10,fontWeight:700,color:'rgba(255,255,255,.5)',letterSpacing:1,marginBottom:2}}>
                    {drill.type==='tc'?'TREATMENT COORDINATOR':'REFERRING DOCTOR'}
                  </div>
                  <div style={{fontSize:19,fontWeight:800,color:'white'}}>{drill.name}</div>
                </div>
                <button onClick={()=>setDrill(null)}
                  style={{background:'rgba(255,255,255,.15)',border:'none',color:'white',width:30,height:30,
                    borderRadius:8,fontSize:18,cursor:'pointer',lineHeight:1}}>×</button>
              </div>
              {/* Mini stats */}
              <div style={{display:'flex',gap:18,marginTop:14,flexWrap:'wrap'}}>
                {[
                  ['Patients', drillData.totals.count],
                  ['TX Value', USD(drillData.totals.value)],
                  ['Scheduled', USD(drillData.totals.scheduled)],
                  ['Produced', USD(drillData.totals.produced)],
                  ['With Appt', `${drillData.totals.withAppt}/${drillData.totals.count}`],
                  ['No Appt', drillData.totals.noAppt],
                  ['Big Cases', drillData.totals.big],
                ].map(([l,v])=>(
                  <div key={l}>
                    <div style={{fontSize:9,color:'rgba(255,255,255,.5)',marginBottom:2}}>{l}</div>
                    <div style={{fontSize:15,fontWeight:800,color:l==='No Appt'&&drillData.totals.noAppt>0?'#f87171':'white'}}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
            {/* Patient list */}
            <div style={{padding:'0',maxHeight:'60vh',overflowY:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead style={{position:'sticky',top:0,zIndex:1}}>
                  <tr>{['Patient','Status','TX Value','Scheduled','Calls','Last Call',''].map(h=>(
                    <th key={h} style={{padding:'9px 12px',textAlign:h==='Patient'||h==='Status'?'left':'right',
                      fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,background:'#f8fafc',
                      borderBottom:'1px solid #e2e8f0'}}>{h}</th>))}</tr>
                </thead>
                <tbody>
                  {drillData.list.map((x,i)=>(
                    <tr key={x.p.id} style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                      <td style={{padding:'8px 12px',fontWeight:700}}>
                        {x.name}{x.big&&<span style={{marginLeft:5,fontSize:10,color:PURPLE}}>⭐</span>}
                        {x.stall&&<span style={{marginLeft:5,fontSize:9,fontWeight:700,color:RED,background:'#fee2e2',padding:'1px 6px',borderRadius:99}}>STALL</span>}
                      </td>
                      <td style={{padding:'8px 12px'}}>
                        <span style={{fontSize:10,fontWeight:700,color:statusColor(x.status),
                          background:statusColor(x.status)+'18',padding:'2px 9px',borderRadius:99}}>{x.status}</span>
                      </td>
                      <td style={{padding:'8px 12px',textAlign:'right',fontWeight:700,color:x.value>=3000?PURPLE:BLUE}}>{USD(x.value)}</td>
                      <td style={{padding:'8px 12px',textAlign:'right',color:TEAL}}>{x.sched>0?USD(x.sched):'—'}</td>
                      <td style={{padding:'8px 12px',textAlign:'right',color:'#64748b'}}>{x.calls}</td>
                      <td style={{padding:'8px 12px',textAlign:'right',color:'#94a3b8',fontSize:11}}>{x.last||'never'}</td>
                      <td style={{padding:'8px 12px',textAlign:'right'}}>
                        {onOpenPatient&&<button onClick={()=>{onOpenPatient(x.p)}}
                          style={{padding:'3px 11px',borderRadius:6,background:BLUE,color:'white',border:'none',
                            fontSize:10,fontWeight:700,cursor:'pointer'}}>Open →</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{padding:'10px 22px',borderTop:'1px solid #f1f5f9',background:'#fafafa',
              fontSize:11,color:'#94a3b8',textAlign:'center'}}>
              Click "Open →" to view a patient in the tracker · click outside to close
            </div>
          </div>
        </div>
      )}

      {/* Summary tiles */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:18}}>
        {[
          ['PATIENTS', summary.total, NAVY, ''],
          ['TX VALUE', '$'+Math.round(summary.value/1000)+'k', BLUE, 'presented'],
          ['CONVERSION', summary.conversion+'%', summary.conversion>=70?GREEN:AMBER, 'booked'],
          ['PRODUCED', '$'+Math.round(summary.produced/1000)+'k', GREEN, ''],
          ['NEEDS ATTENTION', summary.needsAttn, summary.needsAttn>0?RED:'#94a3b8', 'action needed'],
        ].map(([l,v,c,sub])=>(
          <div key={l} style={{background:'white',borderRadius:11,padding:'12px 14px',border:'1px solid #e2e8f0',borderLeft:`4px solid ${c}`}}>
            <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:4}}>{l}</div>
            <div style={{fontSize:20,fontWeight:800,color:c,lineHeight:1}}>{v}</div>
            {sub&&<div style={{fontSize:10,color:'#94a3b8',marginTop:3}}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* ── NEEDS ATTENTION ── */}
      <Section title="🔔 Needs Attention" sub={`${attention.length} patient${attention.length!==1?'s':''} need follow-up · highest value & urgency first`}>
        {attention.length===0 ? (
          <div style={{textAlign:'center',padding:'24px 0',color:GREEN,fontSize:13,fontWeight:600}}>✅ Everyone's on track — no overdue follow-ups</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead><tr>
                <Th col="name" label="Patient" sort={attnSort} setSort={setAttnSort}/>
                <th style={{padding:'7px 10px',textAlign:'left',fontSize:9,fontWeight:800,color:'#94a3b8',background:'#f8fafc'}}>REASON</th>
                <Th col="value" label="TX Value" sort={attnSort} setSort={setAttnSort} align="right"/>
                <Th col="calls" label="Calls" sort={attnSort} setSort={setAttnSort} align="center"/>
                <Th col="since" label="Days Since" sort={attnSort} setSort={setAttnSort} align="center"/>
                <th style={{padding:'7px 10px',fontSize:9,fontWeight:800,color:'#94a3b8',background:'#f8fafc'}}></th>
              </tr></thead>
              <tbody>
                {sortedAttn.map((a,i)=>(
                  <tr key={a.p.id} style={{borderTop:'1px solid #f1f5f9',background:a.urgency>=3?'#fff7ed':i%2===0?'white':'#fafafa'}}>
                    <td style={{padding:'8px 10px',fontWeight:700}}>
                      {a.p.patient_name}
                      {isBig(a.p)&&<span style={{marginLeft:5,fontSize:10,color:PURPLE}}>⭐</span>}
                    </td>
                    <td style={{padding:'8px 10px'}}>
                      <span style={{fontSize:11,fontWeight:600,color:urgencyColor(a.urgency)}}>{a.reason}</span>
                    </td>
                    <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:a.value>=3000?PURPLE:BLUE}}>{USD(a.value)}</td>
                    <td style={{padding:'8px 10px',textAlign:'center',color:'#64748b'}}>{a.calls}</td>
                    <td style={{padding:'8px 10px',textAlign:'center',color:a.since>=7?RED:'#64748b'}}>{a.since!=null?a.since+'d':'—'}</td>
                    <td style={{padding:'8px 10px',textAlign:'right'}}>{onOpenPatient&&<EditBtn onClick={()=>onOpenPatient(a.p)}/>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── FUNNEL ── */}
      <Section title="Acquisition Funnel" sub="Presented → Scheduled → Showed → Produced" view={vFunnel} setView={setVFunnel}>
        {vFunnel==='graph' ? (
          <div>
            {funnel.map((f,i)=>{
              const w=Math.max(8,(f.count/funnelMax)*100)
              const dropPct = i>0 ? pct(f.count,funnel[i-1].count) : 100
              return (
                <div key={f.key} style={{marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                    <span style={{fontSize:12,fontWeight:700,color:'#1e293b'}}>{f.label}</span>
                    <span style={{fontSize:12,color:'#64748b'}}>
                      <b style={{color:f.color}}>{f.count}</b>
                      {f.value!=null&&<span style={{marginLeft:8,color:'#94a3b8'}}>{USD(f.value)}</span>}
                      {i>0&&<span style={{marginLeft:8,fontSize:11,color:dropPct>=70?GREEN:dropPct>=50?AMBER:RED}}>({dropPct}%)</span>}
                    </span>
                  </div>
                  <div style={{height:24,background:'#f1f5f9',borderRadius:6,overflow:'hidden'}}>
                    <div style={{height:'100%',width:w+'%',background:f.color,opacity:.85,borderRadius:6,transition:'width .3s'}}/>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr>{['Stage','Count','Value','Conversion'].map(h=>(
              <th key={h} style={{padding:'7px 10px',textAlign:h==='Stage'?'left':'right',fontSize:9,fontWeight:800,color:'#94a3b8',background:'#f8fafc'}}>{h}</th>))}</tr></thead>
            <tbody>{funnel.map((f,i)=>(
              <tr key={f.key} style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                <td style={{padding:'8px 10px',fontWeight:700}}>{f.label}</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:f.color}}>{f.count}</td>
                <td style={{padding:'8px 10px',textAlign:'right',color:'#64748b'}}>{f.value!=null?USD(f.value):'—'}</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700}}>{i>0?pct(f.count,funnel[i-1].count)+'%':'100%'}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Section>

      {/* ── CONVERSION TREND ── */}
      {trend.length>1 && (
        <Section title="Conversion & Volume Trend" sub="Booking conversion and patient volume over time" view={vTrend} setView={setVTrend}>
          {vTrend==='graph' ? (
            <Chart fmt="#" height={200} series={[
              {label:'Patients',  color:BLUE,  points:trend.map(t=>({label:t.label,value:t.patients}))},
              {label:'Scheduled', color:TEAL,  points:trend.map(t=>({label:t.label,value:t.scheduled}))},
              {label:'Produced',  color:GREEN, points:trend.map(t=>({label:t.label,value:t.produced}))},
            ]}/>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr>{['Date','Patients','Scheduled','Produced','Conversion'].map(h=>(
                  <th key={h} style={{padding:'7px 10px',textAlign:h==='Date'?'left':'right',fontSize:9,fontWeight:800,color:'#94a3b8',background:'#f8fafc'}}>{h}</th>))}</tr></thead>
                <tbody>{trend.slice().reverse().map((t,i)=>(
                  <tr key={t.date} style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                    <td style={{padding:'7px 10px',color:'#64748b'}}>{t.date}</td>
                    <td style={{padding:'7px 10px',textAlign:'right',fontWeight:600}}>{t.patients}</td>
                    <td style={{padding:'7px 10px',textAlign:'right',color:TEAL}}>{t.scheduled}</td>
                    <td style={{padding:'7px 10px',textAlign:'right',color:GREEN}}>{t.produced}</td>
                    <td style={{padding:'7px 10px',textAlign:'right',fontWeight:700,color:t.conversion>=70?GREEN:t.conversion>=50?AMBER:RED}}>{t.conversion!=null?t.conversion+'%':'—'}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* ── TC LEADERBOARD ── */}
      <Section title="TC Leaderboard" sub="Click any coordinator to see their patients · click headers to sort">
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr>
              <Th col="name" label="Coordinator" sort={tcSort} setSort={setTcSort}/>
              <Th col="patients" label="Patients" sort={tcSort} setSort={setTcSort} align="right"/>
              <Th col="value" label="TX Value" sort={tcSort} setSort={setTcSort} align="right"/>
              <Th col="avgValue" label="Avg" sort={tcSort} setSort={setTcSort} align="right"/>
              <Th col="conversion" label="Conversion" sort={tcSort} setSort={setTcSort} align="right"/>
              <Th col="produced" label="Produced" sort={tcSort} setSort={setTcSort} align="right"/>
              <Th col="bigCases" label="Big" sort={tcSort} setSort={setTcSort} align="center"/>
              <Th col="stalls" label="Stalls" sort={tcSort} setSort={setTcSort} align="center"/>
            </tr></thead>
            <tbody>{tcRows.map((t,i)=>(
              <tr key={t.name} onClick={()=>setDrill({type:'tc',name:t.name})}
                style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa',cursor:'pointer'}}
                onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'white':'#fafafa'}>
                <td style={{padding:'8px 10px',fontWeight:700,color:BLUE}}>{i===0&&t.patients>0&&'🏆 '}{t.name} <span style={{fontSize:10,color:'#94a3b8',fontWeight:400}}>→</span></td>
                <td style={{padding:'8px 10px',textAlign:'right'}}>{t.patients}</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:BLUE}}>{USD(t.value)}</td>
                <td style={{padding:'8px 10px',textAlign:'right',color:'#64748b'}}>{USD(t.avgValue)}</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:t.conversion>=70?GREEN:t.conversion>=50?AMBER:RED}}>{t.conversion}%</td>
                <td style={{padding:'8px 10px',textAlign:'right',color:GREEN}}>{USD(t.produced)}</td>
                <td style={{padding:'8px 10px',textAlign:'center',color:PURPLE}}>{t.bigCases||'—'}</td>
                <td style={{padding:'8px 10px',textAlign:'center',color:t.stalls>0?RED:'#94a3b8'}}>{t.stalls||'—'}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Section>

      {/* ── DOCTOR REFERRAL PATTERNS ── */}
      <Section title="Doctor Referral Patterns" sub="Click any doctor to see their patients · which TC handles them">
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead><tr>
              <Th col="name" label="Doctor" sort={drSort} setSort={setDrSort}/>
              <Th col="patients" label="Patients" sort={drSort} setSort={setDrSort} align="right"/>
              <Th col="value" label="TX Value" sort={drSort} setSort={setDrSort} align="right"/>
              <Th col="avgValue" label="Avg Case" sort={drSort} setSort={setDrSort} align="right"/>
              <Th col="conversion" label="Conversion" sort={drSort} setSort={setDrSort} align="right"/>
              <Th col="bigCases" label="Big" sort={drSort} setSort={setDrSort} align="center"/>
              <th style={{padding:'7px 10px',textAlign:'left',fontSize:9,fontWeight:800,color:'#94a3b8',background:'#f8fafc'}}>TOP TC</th>
            </tr></thead>
            <tbody>{drRows.map((d,i)=>(
              <tr key={d.name} onClick={()=>setDrill({type:'dr',name:d.name})}
                style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa',cursor:'pointer'}}
                onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                onMouseLeave={e=>e.currentTarget.style.background=i%2===0?'white':'#fafafa'}>
                <td style={{padding:'8px 10px',fontWeight:700,color:BLUE}}>{d.name} <span style={{fontSize:10,color:'#94a3b8',fontWeight:400}}>→</span></td>
                <td style={{padding:'8px 10px',textAlign:'right'}}>{d.patients}</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:BLUE}}>{USD(d.value)}</td>
                <td style={{padding:'8px 10px',textAlign:'right',color:'#64748b'}}>{USD(d.avgValue)}</td>
                <td style={{padding:'8px 10px',textAlign:'right',fontWeight:700,color:d.conversion>=70?GREEN:d.conversion>=50?AMBER:RED}}>{d.conversion}%</td>
                <td style={{padding:'8px 10px',textAlign:'center',color:PURPLE}}>{d.bigCases||'—'}</td>
                <td style={{padding:'8px 10px',color:'#64748b'}}>{d.topTc}</td>
              </tr>))}</tbody>
          </table>
        </div>
      </Section>

    </div>
  )
}
