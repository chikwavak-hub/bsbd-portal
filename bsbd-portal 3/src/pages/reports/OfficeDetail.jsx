import React, { useState, useMemo, useCallback, useRef } from 'react'
import { N, USD, todayStr, monthStart, repGoal, repProd, repColl, downloadCSV } from '../../lib/helpers'

// ── Constants ──────────────────────────────────────────────────────────────
const NAVY = '#1e3a5f', BLUE = '#1d4ed8', TEAL = '#0d9488'
const GREEN = '#16a34a', AMBER = '#d97706', RED = '#dc2626', PURPLE = '#7c3aed'

const fmtVal = (v, fmt) => {
  if (v == null || isNaN(v)) return '—'
  if (fmt === '$') return '$' + Math.round(v).toLocaleString()
  if (fmt === '%') return Math.round(v) + '%'
  return Math.round(v).toLocaleString()
}

// ── Interactive Line Chart (hover crosshair + tooltip) ─────────────────────
function InteractiveChart({ series, height = 220, fmt = '$' }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef()
  const allPts = series.flatMap(s => s.points.map(p => p.value)).filter(v => v != null && v > 0)
  if (!allPts.length) return (
    <div style={{height, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:12}}>
      No data for this period
    </div>
  )
  const labels = series[0].points.map(p => p.label)
  const W = 800, H = height
  const PAD = { top:20, right:20, bottom:28, left:60 }
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom
  const maxV = Math.max(...allPts) * 1.12 || 1
  const xPos = i => PAD.left + (i / Math.max(labels.length - 1, 1)) * cW
  const yPos = v => PAD.top + cH - (v / maxV) * cH
  const yTicks = 4

  const handleMove = useCallback(e => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)
    const idx = Math.max(0, Math.min(labels.length - 1, Math.round(((mx - PAD.left) / cW) * (labels.length - 1))))
    setHover(idx)
  }, [labels.length, cW])

  return (
    <div style={{position:'relative', userSelect:'none'}}>
      {series.length > 1 && (
        <div style={{display:'flex', gap:16, marginBottom:8, flexWrap:'wrap'}}>
          {series.map(s => (
            <div key={s.label} style={{display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#64748b'}}>
              <div style={{width:16, height:3, borderRadius:2, background:s.color}}/>{s.label}
            </div>
          ))}
        </div>
      )}
      {hover !== null && (
        <div style={{position:'absolute', top:series.length>1?28:0,
          left:`clamp(8px, calc(${((xPos(hover)/W)*100).toFixed(1)}% - 70px), calc(100% - 148px))`,
          background:'white', border:'1px solid #e2e8f0', borderRadius:9,
          boxShadow:'0 4px 16px rgba(0,0,0,.1)', padding:'8px 12px', zIndex:10, minWidth:140, pointerEvents:'none'}}>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:5}}>{labels[hover]}</div>
          {series.map(s => s.points[hover]?.value != null && (
            <div key={s.label} style={{display:'flex', justifyContent:'space-between', gap:12, fontSize:12, marginBottom:2}}>
              <div style={{display:'flex', alignItems:'center', gap:5}}>
                <div style={{width:8, height:8, borderRadius:'50%', background:s.color, flexShrink:0}}/>
                <span style={{color:'#64748b'}}>{s.label}</span>
              </div>
              <span style={{fontWeight:800, color:'#1e293b'}}>{fmtVal(s.points[hover].value, fmt)}</span>
            </div>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{width:'100%', height, cursor:'crosshair'}}
        preserveAspectRatio="none" onMouseMove={handleMove} onMouseLeave={()=>setHover(null)}>
        {Array.from({length: yTicks + 1}).map((_, i) => {
          const v = (maxV / yTicks) * i, y = yPos(v)
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W-PAD.right} y2={y} stroke="#f1f5f9" strokeWidth="1"/>
              <text x={PAD.left-6} y={y+4} textAnchor="end" fontSize="9" fill="#94a3b8">{fmtVal(v, fmt)}</text>
            </g>
          )
        })}
        {labels.map((l, i) => {
          if (labels.length > 14 && i % Math.ceil(labels.length / 14) !== 0) return null
          return <text key={i} x={xPos(i)} y={H-4} textAnchor="middle" fontSize="9" fill="#94a3b8">{l}</text>
        })}
        {hover !== null && (
          <line x1={xPos(hover)} y1={PAD.top} x2={xPos(hover)} y2={H-PAD.bottom}
            stroke="#94a3b8" strokeWidth="1" strokeDasharray="3,3"/>
        )}
        {series.map((s, si) => {
          const pts = s.points.map((p,i) => ({...p,i})).filter(p=>p.value!=null)
          if (!pts.length) return null
          const area = pts.map((p,j)=>`${j===0?'M':'L'} ${xPos(p.i)} ${yPos(p.value)}`).join(' ')
            + ` L ${xPos(pts[pts.length-1].i)} ${yPos(0)} L ${xPos(pts[0].i)} ${yPos(0)} Z`
          const line = pts.map((p,j)=>`${j===0?'M':'L'} ${xPos(p.i)} ${yPos(p.value)}`).join(' ')
          return (
            <g key={si}>
              <path d={area} fill={s.color} fillOpacity="0.07"/>
              <path d={line} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round"/>
              {hover !== null && s.points[hover]?.value != null && (
                <g>
                  <circle cx={xPos(hover)} cy={yPos(s.points[hover].value)} r="5" fill="white" stroke={s.color} strokeWidth="2"/>
                  <circle cx={xPos(hover)} cy={yPos(s.points[hover].value)} r="2.5" fill={s.color}/>
                </g>
              )}
              {pts.length <= 14 && pts.map(p => (
                <circle key={p.i} cx={xPos(p.i)} cy={yPos(p.value)} r="2.5" fill={s.color} fillOpacity="0.7"/>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Interactive Bar Chart ─────────────────────────────────────────────────
function InteractiveBar({ groups, height = 180, fmt = '$', colors = [BLUE, TEAL] }) {
  const [hov, setHov] = useState(null)
  const allVals = groups.flatMap(g => g.values).filter(v => v != null && v > 0)
  if (!allVals.length) return <div style={{height, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:12}}>No data</div>
  const maxV = Math.max(...allVals) * 1.1
  const barW = Math.max(8, Math.min(36, Math.floor(560 / groups.length / Math.max(1, groups[0]?.values?.length)) - 3))
  return (
    <div style={{position:'relative'}}>
      {hov !== null && (
        <div style={{position:'absolute', top:0, left:8, background:'white', border:'1px solid #e2e8f0',
          borderRadius:8, boxShadow:'0 4px 12px rgba(0,0,0,.08)', padding:'8px 12px', zIndex:10, pointerEvents:'none', minWidth:120}}>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:4}}>{groups[hov]?.label}</div>
          {groups[hov]?.labels?.map((l, i) => (
            <div key={i} style={{display:'flex', justifyContent:'space-between', gap:10, fontSize:12}}>
              <span style={{color:colors[i%colors.length]}}>{l}</span>
              <span style={{fontWeight:800}}>{fmtVal(groups[hov].values[i], fmt)}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{display:'flex', alignItems:'flex-end', gap:4, height, paddingBottom:20, overflowX:'auto'}}>
        {groups.map((g, gi) => (
          <div key={gi} style={{display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0}}
            onMouseEnter={()=>setHov(gi)} onMouseLeave={()=>setHov(null)}>
            <div style={{display:'flex', alignItems:'flex-end', gap:2}}>
              {g.values.map((v, vi) => (
                <div key={vi} style={{width:barW,
                  height: maxV>0 ? Math.max(2,(N(v)/maxV)*(height-20)) : 2,
                  background: v!=null&&v>0 ? colors[vi%colors.length] : '#f1f5f9',
                  borderRadius:'3px 3px 0 0', opacity:hov===null||hov===gi?1:0.4,
                  transition:'opacity .15s'}}/>
              ))}
            </div>
            <div style={{fontSize:9, color:'#94a3b8', marginTop:3, textAlign:'center', whiteSpace:'nowrap'}}>{g.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── View toggle: Graph | Table ─────────────────────────────────────────────
function ViewToggle({ view, setView }) {
  return (
    <div style={{display:'flex', borderRadius:7, overflow:'hidden', border:'1px solid #e2e8f0', flexShrink:0}}>
      {[['graph','📈 Graph'],['table','📋 Table']].map(([v,l]) => (
        <button key={v} onClick={()=>setView(v)}
          style={{padding:'5px 12px', border:'none', cursor:'pointer', fontSize:11, fontWeight:700,
            background: view===v ? NAVY : 'white', color: view===v ? 'white' : '#64748b'}}>
          {l}
        </button>
      ))}
    </div>
  )
}

// ── Sortable table header ─────────────────────────────────────────────────
function Th({ col, label, sort, setSort, align='left' }) {
  const active = sort.col === col
  return (
    <th onClick={()=>setSort(s=>({col, dir:s.col===col&&s.dir==='desc'?'asc':'desc'}))}
      style={{padding:'7px 10px', textAlign:align, fontSize:9, fontWeight:800, color:active?BLUE:'#94a3b8',
        letterSpacing:.5, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap', background:'#f8fafc'}}>
      {label} {active ? (sort.dir==='desc'?'↓':'↑') : ''}
    </th>
  )
}

// ── Section card wrapper ─────────────────────────────────────────────────
function Section({ title, sub, view, setView, filterBar, dl, children }) {
  const doDownload = () => {
    if (!dl) return
    const rows = typeof dl.rows === 'function' ? dl.rows() : dl.rows
    if (!rows || !rows.length) return
    downloadCSV([dl.header, ...rows], `BSBD_${dl.name}_${todayStr()}.csv`)
  }
  return (
    <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', marginBottom:16, overflow:'hidden'}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start',
        padding:'14px 18px 12px', borderBottom:'1px solid #f1f5f9', flexWrap:'wrap', gap:8}}>
        <div>
          <div style={{fontSize:13, fontWeight:800, color:NAVY}}>{title}</div>
          {sub && <div style={{fontSize:11, color:'#94a3b8', marginTop:2}}>{sub}</div>}
        </div>
        <div style={{display:'flex', alignItems:'center', gap:8}}>
          {dl && (
            <button onClick={doDownload} title="Download this table as CSV"
              style={{display:'inline-flex', alignItems:'center', gap:5, padding:'5px 11px', borderRadius:7,
                background:'white', border:'1px solid #e2e8f0', color:'#64748b', fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap'}}>
              ⬇ CSV
            </button>
          )}
          <ViewToggle view={view} setView={setView}/>
        </div>
      </div>
      {filterBar && <div style={{padding:'10px 18px', borderBottom:'1px solid #f1f5f9', background:'#fafafa'}}>{filterBar}</div>}
      <div style={{padding:'14px 18px'}}>{children}</div>
    </div>
  )
}

// ── KPI tile ──────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color=NAVY, accent }) {
  return (
    <div style={{background:'white', borderRadius:11, padding:'12px 14px', border:'1px solid #e2e8f0',
      borderLeft:`4px solid ${accent||'#e2e8f0'}`}}>
      <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:4}}>{label}</div>
      <div style={{fontSize:20, fontWeight:800, color, lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:11, color:'#94a3b8', marginTop:3}}>{sub}</div>}
    </div>
  )
}

// ── Edit button ───────────────────────────────────────────────────────────
function EditBtn({ onClick }) {
  return (
    <button onClick={onClick}
      style={{padding:'3px 10px', borderRadius:6, background:BLUE, color:'white',
        border:'none', fontSize:10, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap'}}>
      Edit
    </button>
  )
}

// ── Main OfficeDetail ─────────────────────────────────────────────────────
export default function OfficeDetail({ office, reports, providers, onBack, onEdit }) {
  // Range controls
  const [range, setRange] = useState('30')
  const [customStart, setCustomStart] = useState(monthStart())
  const [customEnd,   setCustomEnd]   = useState(todayStr())
  const today = todayStr()

  // View states — graph or table per section
  const [vProd,  setVProd]  = useState('graph')
  const [vColl,  setVColl]  = useState('graph')
  const [vProv,  setVProv]  = useState('graph')
  const [vSched, setVSched] = useState('graph')
  const [vMo,    setVMo]    = useState('graph')

  // Table filter states
  const [prodFilter, setProdFilter]   = useState('all')  // all | on_track | below
  const [prodSort,   setProdSort]     = useState({col:'date', dir:'desc'})
  const [provSort,   setProvSort]     = useState({col:'prod', dir:'desc'})
  const [schedSort,  setSchedSort]    = useState({col:'date', dir:'desc'})
  const [moSort,     setMoSort]       = useState({col:'mo', dir:'desc'})
  const [minProd,    setMinProd]      = useState('')
  const [maxProd,    setMaxProd]      = useState('')

  // Cutoff
  const cutoff = useMemo(() => {
    if (range === 'custom') return customStart
    if (range === 'mtd')    return monthStart()
    const d = new Date(today); d.setDate(d.getDate() - parseInt(range))
    return d.toISOString().slice(0,10)
  }, [range, customStart, today])
  const endDate = range === 'custom' ? customEnd : today

  // Reports for this office
  const reps = useMemo(() =>
    reports.filter(r => r.office === office && r.date >= cutoff && r.date <= endDate)
      .sort((a,b) => a.date.localeCompare(b.date))
  , [reports, office, cutoff, endDate])

  // Totals
  const totals = useMemo(() => {
    const prod = reps.reduce((s,r)=>s+repProd(r),0)
    const goal = reps.reduce((s,r)=>s+repGoal(r,providers),0)
    const coll = reps.reduce((s,r)=>s+repColl(r),0)
    return {
      prod, goal, coll, days: reps.length,
      avgProd: reps.length?prod/reps.length:0,
      pct:     goal>0?prod/goal*100:0,
      collRate:prod>0?coll/prod*100:0,
      noShows: reps.reduce((s,r)=>s+N(r.sched?.noShows),0),
      cancelled:reps.reduce((s,r)=>s+N(r.sched?.cancelled),0),
      npSched: reps.reduce((s,r)=>s+N(r.sched?.npScheduled),0),
      npShowed:reps.reduce((s,r)=>s+N(r.sched?.npShowed),0),
    }
  }, [reps, providers])

  // Daily rows (for tables + graphs)
  const daily = useMemo(() => reps.map(r => ({
    id:       r.id,
    r,
    date:     r.date,
    label:    r.date.slice(5),
    prod:     repProd(r),
    goal:     repGoal(r, providers),
    coll:     repColl(r),
    collRate: repProd(r)>0 ? repColl(r)/repProd(r)*100 : 0,
    noShows:  N(r.sched?.noShows),
    cancelled:N(r.sched?.cancelled),
    npSched:  N(r.sched?.npScheduled),
    npShowed: N(r.sched?.npShowed),
    submittedBy: r.submittedBy || '—',
  })), [reps, providers])

  // Filtered daily rows for prod table
  const prodRows = useMemo(() => {
    let rows = [...daily]
    if (prodFilter==='on_track') rows=rows.filter(r=>r.prod>=r.goal)
    if (prodFilter==='below')    rows=rows.filter(r=>r.prod<r.goal&&r.goal>0)
    if (prodFilter==='suspect')  rows=rows.filter(r=>r.prod>r.goal*3&&r.prod>5000)
    if (minProd) rows=rows.filter(r=>r.prod>=N(minProd))
    if (maxProd) rows=rows.filter(r=>r.prod<=N(maxProd))
    return [...rows].sort((a,b)=>{
      const v = prodSort.dir==='desc' ? b[prodSort.col]-a[prodSort.col] : a[prodSort.col]-b[prodSort.col]
      return prodSort.col==='date' ? (prodSort.dir==='desc'?b.date.localeCompare(a.date):a.date.localeCompare(b.date)) : v
    })
  }, [daily, prodFilter, minProd, maxProd, prodSort])

  // Provider breakdown
  const provBreakdown = useMemo(() => {
    const map = {}
    for (const r of reps) {
      for (const rp of (r.providers||[])) {
        if (!rp.doctorId) continue
        const pv = providers.find(p=>p.id===rp.doctorId)
        if (!pv) continue
        if (!map[rp.doctorId]) map[rp.doctorId]={id:rp.doctorId, name:pv.name, goalDay:N(pv.goal), prod:0, days:0}
        const prod=N(rp.netProd); if(prod>0){map[rp.doctorId].prod+=prod;map[rp.doctorId].days++}
      }
    }
    const arr = Object.values(map)
    return [...arr].sort((a,b)=>{
      const aV=a[provSort.col]??0, bV=b[provSort.col]??0
      return provSort.dir==='desc' ? bV-aV : aV-bV
    })
  }, [reps, providers, provSort])

  // Monthly rollup
  const monthly = useMemo(() => {
    const map = {}
    for (const r of reports.filter(r=>r.office===office)) {
      const mo=r.date.slice(0,7)
      if (!map[mo]) map[mo]={mo, prod:0, goal:0, coll:0, days:0, noShows:0}
      map[mo].prod+=repProd(r); map[mo].goal+=repGoal(r,providers); map[mo].coll+=repColl(r)
      map[mo].noShows+=N(r.sched?.noShows); if(repProd(r)>0) map[mo].days++
    }
    const arr = Object.values(map).sort((a,b)=>a.mo.localeCompare(b.mo)).slice(-12)
    return [...arr].sort((a,b)=>{
      if (moSort.col==='mo') return moSort.dir==='desc'?b.mo.localeCompare(a.mo):a.mo.localeCompare(b.mo)
      return moSort.dir==='desc'?b[moSort.col]-a[moSort.col]:a[moSort.col]-b[moSort.col]
    })
  }, [reports, office, providers, moSort])

  const RANGES = [['7','7D'],['14','14D'],['30','30D'],['60','60D'],['90','90D'],['mtd','MTD'],['custom','Custom']]
  const pctColor = p => p>=90?GREEN:p>=70?AMBER:RED

  return (
    <div style={{maxWidth:1100, margin:'0 auto', padding:'20px 20px 60px'}}>

      {/* Header */}
      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:18, flexWrap:'wrap'}}>
        <button onClick={onBack}
          style={{padding:'6px 13px', borderRadius:8, background:'white', border:'1px solid #e2e8f0',
            color:'#64748b', fontWeight:700, fontSize:12, cursor:'pointer'}}>
          ← Analytics
        </button>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontSize:10, color:'#94a3b8', fontWeight:700, letterSpacing:1}}>OFFICE ANALYTICS</div>
          <div style={{fontSize:20, fontWeight:800, color:NAVY}}>{office}</div>
        </div>
        <div style={{display:'flex', gap:3, flexWrap:'wrap'}}>
          {RANGES.map(([v,l]) => (
            <button key={v} onClick={()=>setRange(v)}
              style={{padding:'5px 10px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                border:'1px solid '+(range===v?BLUE:'#e2e8f0'),
                background:range===v?BLUE:'white', color:range===v?'white':'#64748b'}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {range==='custom' && (
        <div style={{display:'flex', gap:6, alignItems:'center', marginBottom:14}}>
          <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
            style={{padding:'6px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
          <span style={{fontSize:11, color:'#94a3b8'}}>to</span>
          <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
            style={{padding:'6px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
        </div>
      )}

      {reps.length===0 ? (
        <div style={{textAlign:'center', padding:60, color:'#94a3b8'}}>
          <div style={{fontSize:32, marginBottom:10}}>📊</div>
          <div style={{fontSize:14, fontWeight:600, color:'#64748b'}}>No reports for this period</div>
        </div>
      ) : (<>

      {/* KPI strip */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))', gap:9, marginBottom:18}}>
        <KpiTile label="NET PRODUCTION" value={USD(totals.prod)}                  accent={BLUE}   color={BLUE}/>
        <KpiTile label="GOAL"           value={USD(totals.goal)}                  accent="#e2e8f0"/>
        <KpiTile label="% OF GOAL"      value={Math.round(totals.pct)+'%'}        accent={pctColor(totals.pct)} color={pctColor(totals.pct)}/>
        <KpiTile label="COLLECTIONS"    value={USD(totals.coll)}                  accent={TEAL}   color={TEAL}/>
        <KpiTile label="COLL RATE"      value={Math.round(totals.collRate)+'%'}   accent={pctColor(totals.collRate)} color={pctColor(totals.collRate)}/>
        <KpiTile label="AVG DAILY"      value={USD(totals.avgProd)}               accent={PURPLE} color={PURPLE}/>
        <KpiTile label="DAYS REPORTED"  value={totals.days}                       accent="#e2e8f0"/>
        <KpiTile label="NO-SHOWS"       value={totals.noShows}                    accent={totals.noShows>2?RED:'#e2e8f0'} color={totals.noShows>2?RED:NAVY}/>
      </div>

      {/* ── PRODUCTION vs GOAL ───────────────────────────────────────────── */}
      <Section title="Production vs Goal" sub={vProd==='graph'?'Hover for exact values':'Click Edit to fix any number'}
        view={vProd} setView={setVProd}
        dl={{ name:`${office}_Production`, header:['Date','Production','Goal','% of Goal','Submitted By'],
          rows:()=>prodRows.map(d=>[d.date, Math.round(d.prod), Math.round(d.goal), d.goal>0?Math.round(d.prod/d.goal*100)+'%':'—', d.submittedBy]) }}
        filterBar={vProd==='table' && (
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
            <span style={{fontSize:10, fontWeight:800, color:'#94a3b8'}}>FILTER:</span>
            {[['all','All'],['on_track','On Track'],['below','Below Goal'],['suspect','⚠ Suspect']].map(([v,l])=>(
              <button key={v} onClick={()=>setProdFilter(v)}
                style={{padding:'4px 10px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer',
                  background:prodFilter===v?NAVY:'white', color:prodFilter===v?'white':'#64748b',
                  border:'1px solid '+(prodFilter===v?NAVY:'#e2e8f0')}}>
                {l}
              </button>
            ))}
            <div style={{display:'flex', gap:4, alignItems:'center', marginLeft:8}}>
              <span style={{fontSize:10, color:'#94a3b8'}}>Min $</span>
              <input value={minProd} onChange={e=>setMinProd(e.target.value)} placeholder="0"
                style={{width:70, padding:'4px 6px', borderRadius:5, border:'1px solid #e2e8f0', fontSize:11}}/>
              <span style={{fontSize:10, color:'#94a3b8'}}>Max $</span>
              <input value={maxProd} onChange={e=>setMaxProd(e.target.value)} placeholder="any"
                style={{width:70, padding:'4px 6px', borderRadius:5, border:'1px solid #e2e8f0', fontSize:11}}/>
            </div>
            <span style={{fontSize:11, color:'#94a3b8', marginLeft:'auto'}}>{prodRows.length} rows</span>
          </div>
        )}>
        {vProd==='graph' ? (
          <InteractiveChart fmt="$" height={220} series={[
            {label:'Production', color:BLUE,  points:daily.map(d=>({label:d.label, value:d.prod||null}))},
            {label:'Goal',       color:'#cbd5e1', points:daily.map(d=>({label:d.label, value:d.goal||null}))},
          ]}/>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead>
                <tr>
                  <Th col="date"     label="Date"       sort={prodSort} setSort={setProdSort}/>
                  <Th col="prod"     label="Production" sort={prodSort} setSort={setProdSort} align="right"/>
                  <Th col="goal"     label="Goal"       sort={prodSort} setSort={setProdSort} align="right"/>
                  <Th col="collRate" label="vs Goal %"  sort={prodSort} setSort={setProdSort} align="right"/>
                  <Th col="coll"     label="Collections"sort={prodSort} setSort={setProdSort} align="right"/>
                  <Th col="collRate" label="Coll Rate"  sort={prodSort} setSort={setProdSort} align="right"/>
                  <th style={{padding:'7px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}>BY</th>
                  <th style={{padding:'7px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}></th>
                </tr>
              </thead>
              <tbody>
                {prodRows.map((d, i) => {
                  const vsGoal = d.goal>0 ? Math.round(d.prod/d.goal*100) : null
                  const suspect = d.prod > d.goal*3 && d.prod > 5000
                  return (
                    <tr key={d.date} style={{borderTop:'1px solid #f1f5f9', background:suspect?'#fff7ed':i%2===0?'white':'#fafafa'}}>
                      <td style={{padding:'7px 10px', color:'#64748b', whiteSpace:'nowrap'}}>
                        {d.date}
                        {suspect && <span style={{marginLeft:5, fontSize:10, fontWeight:700, color:AMBER, background:'#fef9c3', padding:'1px 5px', borderRadius:4}}>⚠</span>}
                      </td>
                      <td style={{padding:'7px 10px', fontWeight:700, color:BLUE, textAlign:'right'}}>{USD(d.prod)}</td>
                      <td style={{padding:'7px 10px', color:'#64748b', textAlign:'right'}}>{d.goal?USD(d.goal):'—'}</td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        {vsGoal!=null && <span style={{fontWeight:700, color:pctColor(vsGoal)}}>{vsGoal}%</span>}
                      </td>
                      <td style={{padding:'7px 10px', fontWeight:600, color:TEAL, textAlign:'right'}}>{USD(d.coll)}</td>
                      <td style={{padding:'7px 10px', textAlign:'right'}}>
                        <span style={{fontWeight:700, color:pctColor(d.collRate)}}>{Math.round(d.collRate)}%</span>
                      </td>
                      <td style={{padding:'7px 10px', color:'#94a3b8', fontSize:11}}>{d.submittedBy}</td>
                      <td style={{padding:'7px 10px'}}>{onEdit && <EditBtn onClick={()=>onEdit(d.r)}/>}</td>
                    </tr>
                  )
                })}
                {/* Totals row */}
                <tr style={{borderTop:'2px solid #e2e8f0', background:'#f8fafc', fontWeight:800}}>
                  <td style={{padding:'8px 10px', color:NAVY}}>TOTAL ({prodRows.length})</td>
                  <td style={{padding:'8px 10px', color:BLUE, textAlign:'right'}}>{USD(prodRows.reduce((s,d)=>s+d.prod,0))}</td>
                  <td style={{padding:'8px 10px', color:'#64748b', textAlign:'right'}}>{USD(prodRows.reduce((s,d)=>s+d.goal,0))}</td>
                  <td style={{padding:'8px 10px', textAlign:'right'}}>
                    {(() => { const p=prodRows.reduce((s,d)=>s+d.prod,0), g=prodRows.reduce((s,d)=>s+d.goal,0)
                      return g>0 ? <span style={{color:pctColor(Math.round(p/g*100))}}>{Math.round(p/g*100)}%</span> : '—' })()}
                  </td>
                  <td style={{padding:'8px 10px', color:TEAL, textAlign:'right'}}>{USD(prodRows.reduce((s,d)=>s+d.coll,0))}</td>
                  <td colSpan={3}/>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── COLLECTIONS ───────────────────────────────────────────────────── */}
      <Section title="Collections" sub={vColl==='graph'?'Daily collections and rate':'Sortable collection detail'}
        view={vColl} setView={setVColl}
        dl={{ name:`${office}_Collections`, header:['Date','Collections','Production','Collection Rate'],
          rows:()=>prodRows.map(d=>[d.date, Math.round(d.coll), Math.round(d.prod), d.prod>0?Math.round(d.coll/d.prod*100)+'%':'—']) }}>
        {vColl==='graph' ? (
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
            <div>
              <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:6}}>COLLECTIONS $</div>
              <InteractiveChart fmt="$" height={160} series={[{label:'Collections', color:TEAL, points:daily.map(d=>({label:d.label, value:d.coll||null}))}]}/>
            </div>
            <div>
              <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:6}}>COLLECTION RATE %</div>
              <InteractiveChart fmt="%" height={160} series={[{label:'Rate', color:GREEN, points:daily.map(d=>({label:d.label, value:d.collRate||null}))}]}/>
            </div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead>
                <tr>
                  <Th col="date"     label="Date"        sort={prodSort} setSort={setProdSort}/>
                  <Th col="coll"     label="Collections" sort={prodSort} setSort={setProdSort} align="right"/>
                  <Th col="prod"     label="Net Prod"    sort={prodSort} setSort={setProdSort} align="right"/>
                  <Th col="collRate" label="Rate %"      sort={prodSort} setSort={setProdSort} align="right"/>
                  <th style={{padding:'7px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}></th>
                </tr>
              </thead>
              <tbody>
                {prodRows.map((d, i) => (
                  <tr key={d.date} style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                    <td style={{padding:'7px 10px', color:'#64748b'}}>{d.date}</td>
                    <td style={{padding:'7px 10px', fontWeight:700, color:TEAL, textAlign:'right'}}>{USD(d.coll)}</td>
                    <td style={{padding:'7px 10px', color:'#475569', textAlign:'right'}}>{USD(d.prod)}</td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>
                      <span style={{fontWeight:700, color:pctColor(d.collRate)}}>{Math.round(d.collRate)}%</span>
                    </td>
                    <td style={{padding:'7px 10px'}}>{onEdit && <EditBtn onClick={()=>onEdit(d.r)}/>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── PROVIDER PRODUCTION ───────────────────────────────────────────── */}
      {provBreakdown.length > 0 && (
        <Section title="Provider Production" sub={vProv==='graph'?'Production vs goal by provider':'Click Edit to correct a provider\'s numbers'}
          view={vProv} setView={setVProv}
          dl={{ name:`${office}_Provider_Production`, header:['Provider','Production','Goal','% of Goal','Days','Avg/Day'],
            rows:()=>provBreakdown.map(p=>{ const goal=p.goalDay*p.days; return [p.name, Math.round(p.prod), Math.round(goal), goal>0?Math.round(p.prod/goal*100)+'%':'—', p.days, p.days>0?Math.round(p.prod/p.days):0] }) }}>
          {vProv==='graph' ? (
            <>
              <InteractiveBar fmt="$" height={160} colors={[BLUE, TEAL, PURPLE, AMBER]}
                groups={provBreakdown.map(p=>({
                  label: p.name.split(' ').slice(-1)[0],
                  labels:['Production','Goal'],
                  values:[p.prod, p.goalDay*p.days],
                }))}/>
              <div style={{height:12}}/>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                <thead>
                  <tr>
                    {['Provider','Production','Days','Avg/Day','vs Goal'].map(h=>(
                      <th key={h} style={{padding:'6px 10px', textAlign:h==='Provider'?'left':'right', fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, background:'#f8fafc'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {provBreakdown.map((p,i) => {
                    const avg=p.days>0?p.prod/p.days:0, goalTot=p.goalDay*p.days
                    const vs=goalTot>0?Math.round(p.prod/goalTot*100):null
                    return (
                      <tr key={p.id} style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                        <td style={{padding:'7px 10px', fontWeight:700}}>{p.name}</td>
                        <td style={{padding:'7px 10px', fontWeight:700, color:BLUE, textAlign:'right'}}>{USD(p.prod)}</td>
                        <td style={{padding:'7px 10px', color:'#64748b', textAlign:'right'}}>{p.days}</td>
                        <td style={{padding:'7px 10px', color:'#475569', textAlign:'right'}}>{USD(avg)}</td>
                        <td style={{padding:'7px 10px', textAlign:'right'}}>{vs!=null&&<span style={{fontWeight:700, color:pctColor(vs)}}>{vs}%</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                <thead>
                  <tr>
                    <Th col="name"    label="Provider"   sort={provSort} setSort={setProvSort}/>
                    <Th col="prod"    label="Production" sort={provSort} setSort={setProvSort} align="right"/>
                    <Th col="days"    label="Days"       sort={provSort} setSort={setProvSort} align="right"/>
                    <th style={{padding:'7px 10px', textAlign:'right', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}>AVG/DAY</th>
                    <th style={{padding:'7px 10px', textAlign:'right', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}>vs GOAL</th>
                    <th style={{padding:'7px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}></th>
                  </tr>
                </thead>
                <tbody>
                  {provBreakdown.map((p,i) => {
                    const avg=p.days>0?p.prod/p.days:0, goalTot=p.goalDay*p.days
                    const vs=goalTot>0?Math.round(p.prod/goalTot*100):null
                    // Find all reports where this provider appears
                    const provReps = reps.filter(r=>(r.providers||[]).some(rp=>rp.doctorId===p.id))
                    return (
                      <React.Fragment key={p.id}>
                        <tr style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                          <td style={{padding:'7px 10px', fontWeight:800}}>{p.name}</td>
                          <td style={{padding:'7px 10px', fontWeight:700, color:BLUE, textAlign:'right'}}>{USD(p.prod)}</td>
                          <td style={{padding:'7px 10px', color:'#64748b', textAlign:'right'}}>{p.days}</td>
                          <td style={{padding:'7px 10px', color:'#475569', textAlign:'right'}}>{USD(avg)}</td>
                          <td style={{padding:'7px 10px', textAlign:'right'}}>{vs!=null&&<span style={{fontWeight:700, color:pctColor(vs)}}>{vs}%</span>}</td>
                          <td style={{padding:'7px 10px'}}/>
                        </tr>
                        {/* Per-day breakdown for this provider */}
                        {provReps.map(r => {
                          const rp=(r.providers||[]).find(x=>x.doctorId===p.id)
                          const dayProd=N(rp?.netProd)
                          const suspect=dayProd>p.goalDay*3&&dayProd>5000
                          return (
                            <tr key={r.id} style={{borderTop:'1px solid #f8fafc', background:'#fafafa'}}>
                              <td style={{padding:'5px 10px 5px 24px', color:'#94a3b8', fontSize:11}}>↳ {r.date}</td>
                              <td style={{padding:'5px 10px', textAlign:'right'}}>
                                <span style={{fontWeight:700, color:suspect?RED:BLUE, fontSize:11}}>
                                  {USD(dayProd)}
                                  {suspect && <span style={{marginLeft:4, fontSize:9, fontWeight:700, color:AMBER, background:'#fef9c3', padding:'1px 5px', borderRadius:3}}>⚠ Check</span>}
                                </span>
                              </td>
                              <td colSpan={3} style={{padding:'5px 10px', color:'#94a3b8', fontSize:11}}>
                                vs goal {USD(p.goalDay)} ({p.goalDay>0?Math.round(dayProd/p.goalDay*100):'—'}%)
                              </td>
                              <td style={{padding:'5px 10px'}}>{onEdit && <EditBtn onClick={()=>onEdit(r)}/>}</td>
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      {/* ── SCHEDULING ────────────────────────────────────────────────────── */}
      <Section title="Scheduling" sub={vSched==='graph'?'No-shows, cancellations, and NP activity':'Day-by-day scheduling detail'}
        view={vSched} setView={setVSched}
        dl={{ name:`${office}_Scheduling`, header:['Date','No-Shows','Cancelled','NP Scheduled','NP Showed'],
          rows:()=>daily.map(d=>[d.date, d.noShows, d.cancelled, d.npSched, d.npShowed]) }}>
        {vSched==='graph' ? (
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
            <div>
              <div style={{display:'flex', gap:10, marginBottom:8}}>
                <div style={{flex:1, background:'#fef2f2', borderRadius:8, padding:'8px 10px'}}>
                  <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:2}}>NO-SHOWS</div>
                  <div style={{fontSize:18, fontWeight:800, color:RED}}>{totals.noShows}</div>
                </div>
                <div style={{flex:1, background:'#fef9c3', borderRadius:8, padding:'8px 10px'}}>
                  <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:2}}>CANCELLED</div>
                  <div style={{fontSize:18, fontWeight:800, color:AMBER}}>{totals.cancelled}</div>
                </div>
              </div>
              <InteractiveChart fmt="#" height={130} series={[
                {label:'No-Shows',  color:RED,   points:daily.map(d=>({label:d.label, value:d.noShows||null}))},
                {label:'Cancelled', color:AMBER, points:daily.map(d=>({label:d.label, value:d.cancelled||null}))},
              ]}/>
            </div>
            <div>
              <div style={{display:'flex', gap:10, marginBottom:8}}>
                <div style={{flex:1, background:'#eff6ff', borderRadius:8, padding:'8px 10px'}}>
                  <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:2}}>NP SCHED</div>
                  <div style={{fontSize:18, fontWeight:800, color:BLUE}}>{totals.npSched}</div>
                </div>
                <div style={{flex:1, background:'#f0fdf4', borderRadius:8, padding:'8px 10px'}}>
                  <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:2}}>NP SHOWED</div>
                  <div style={{fontSize:18, fontWeight:800, color:GREEN}}>{totals.npShowed}</div>
                </div>
              </div>
              <InteractiveChart fmt="#" height={130} series={[
                {label:'NP Sched',  color:BLUE,  points:daily.map(d=>({label:d.label, value:d.npSched||null}))},
                {label:'NP Showed', color:GREEN, points:daily.map(d=>({label:d.label, value:d.npShowed||null}))},
              ]}/>
            </div>
          </div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
              <thead>
                <tr>
                  <Th col="date"      label="Date"       sort={schedSort} setSort={setSchedSort}/>
                  <Th col="noShows"   label="No-Shows"   sort={schedSort} setSort={setSchedSort} align="right"/>
                  <Th col="cancelled" label="Cancelled"  sort={schedSort} setSort={setSchedSort} align="right"/>
                  <Th col="npSched"   label="NP Sched"   sort={schedSort} setSort={setSchedSort} align="right"/>
                  <Th col="npShowed"  label="NP Showed"  sort={schedSort} setSort={setSchedSort} align="right"/>
                  <th style={{padding:'7px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}></th>
                </tr>
              </thead>
              <tbody>
                {[...daily].sort((a,b)=>{
                  return schedSort.dir==='desc' ? (b[schedSort.col]||0)-(a[schedSort.col]||0) : (a[schedSort.col]||0)-(b[schedSort.col]||0)
                }).map((d,i) => (
                  <tr key={d.date} style={{borderTop:'1px solid #f1f5f9', background:d.noShows>2?'#fff7ed':i%2===0?'white':'#fafafa'}}>
                    <td style={{padding:'7px 10px', color:'#64748b'}}>{d.date}</td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>
                      <span style={{fontWeight:700, color:d.noShows>0?RED:'#94a3b8'}}>{d.noShows||'—'}</span>
                    </td>
                    <td style={{padding:'7px 10px', textAlign:'right'}}>
                      <span style={{fontWeight:700, color:d.cancelled>0?AMBER:'#94a3b8'}}>{d.cancelled||'—'}</span>
                    </td>
                    <td style={{padding:'7px 10px', color:BLUE, fontWeight:600, textAlign:'right'}}>{d.npSched||'—'}</td>
                    <td style={{padding:'7px 10px', color:GREEN, fontWeight:600, textAlign:'right'}}>{d.npShowed||'—'}</td>
                    <td style={{padding:'7px 10px'}}>{onEdit && <EditBtn onClick={()=>onEdit(d.r)}/>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* ── MONTHLY TREND ─────────────────────────────────────────────────── */}
      {monthly.length > 1 && (
        <Section title="Monthly Trend" sub={vMo==='graph'?'Last 12 months':'Full monthly breakdown'}
          view={vMo} setView={setVMo}
          dl={{ name:`${office}_Monthly_Trend`, header:['Month','Production','Goal','% of Goal','Collections','Days','No-Shows'],
            rows:()=>monthly.map(m=>[m.mo, Math.round(m.prod), Math.round(m.goal), m.goal>0?Math.round(m.prod/m.goal*100)+'%':'—', Math.round(m.coll), m.days, m.noShows]) }}>
          {vMo==='graph' ? (
            <>
              <InteractiveBar fmt="$" height={180} colors={[BLUE, TEAL]}
                groups={monthly.map(m=>({
                  label: m.mo.slice(5)+'/'+m.mo.slice(2,4),
                  labels:['Production','Collections'],
                  values:[m.prod, m.coll],
                }))}/>
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:8, marginTop:12}}>
                {monthly.slice().reverse().slice(0,6).map(m => (
                  <div key={m.mo} style={{background:'#f8fafc', borderRadius:8, padding:'8px 10px', border:'1px solid #f1f5f9'}}>
                    <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:3}}>
                      {new Date(m.mo+'-15').toLocaleString('en-US',{month:'short',year:'2-digit'})}
                    </div>
                    <div style={{fontSize:13, fontWeight:800, color:BLUE}}>{USD(m.prod)}</div>
                    <div style={{fontSize:11, color:'#64748b'}}>Avg: {USD(m.days>0?m.prod/m.days:0)}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                <thead>
                  <tr>
                    <Th col="mo"       label="Month"       sort={moSort} setSort={setMoSort}/>
                    <Th col="prod"     label="Production"  sort={moSort} setSort={setMoSort} align="right"/>
                    <Th col="goal"     label="Goal"        sort={moSort} setSort={setMoSort} align="right"/>
                    <th style={{padding:'7px 10px', textAlign:'right', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}>vs GOAL</th>
                    <Th col="coll"     label="Collections" sort={moSort} setSort={setMoSort} align="right"/>
                    <th style={{padding:'7px 10px', textAlign:'right', fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc'}}>COLL RATE</th>
                    <Th col="days"     label="Days"        sort={moSort} setSort={setMoSort} align="right"/>
                    <Th col="noShows"  label="No-Shows"    sort={moSort} setSort={setMoSort} align="right"/>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((m,i) => {
                    const vs=m.goal>0?Math.round(m.prod/m.goal*100):null
                    const cr=m.prod>0?Math.round(m.coll/m.prod*100):null
                    const avgDay=m.days>0?Math.round(m.prod/m.days):0
                    return (
                      <tr key={m.mo} style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                        <td style={{padding:'7px 10px', fontWeight:700, color:NAVY}}>
                          {new Date(m.mo+'-15').toLocaleString('en-US',{month:'long',year:'numeric'})}
                        </td>
                        <td style={{padding:'7px 10px', fontWeight:700, color:BLUE, textAlign:'right'}}>{USD(m.prod)}</td>
                        <td style={{padding:'7px 10px', color:'#64748b', textAlign:'right'}}>{USD(m.goal)}</td>
                        <td style={{padding:'7px 10px', textAlign:'right'}}>
                          {vs!=null&&<span style={{fontWeight:700, color:pctColor(vs)}}>{vs}%</span>}
                        </td>
                        <td style={{padding:'7px 10px', fontWeight:600, color:TEAL, textAlign:'right'}}>{USD(m.coll)}</td>
                        <td style={{padding:'7px 10px', textAlign:'right'}}>
                          {cr!=null&&<span style={{fontWeight:700, color:pctColor(cr)}}>{cr}%</span>}
                        </td>
                        <td style={{padding:'7px 10px', color:'#64748b', textAlign:'right'}}>{m.days} <span style={{fontSize:10, color:'#94a3b8'}}>(avg {USD(avgDay)})</span></td>
                        <td style={{padding:'7px 10px', textAlign:'right'}}>
                          <span style={{fontWeight:700, color:m.noShows>5?RED:'#64748b'}}>{m.noShows||'—'}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      </>)}
    </div>
  )
}
