import React, { useState, useMemo, useCallback } from 'react'
import { IcoChevD, IcoChevU, IcoDL } from '../../components/icons'
import { N, USD, todayStr, monthStart, repGoal, repProd, repColl } from '../../lib/helpers'
import OfficeDetail from './OfficeDetail'
import { OFFICES } from '../../lib/constants'

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  blue:'#1d4ed8', teal:'#0d9488', green:'#16a34a', red:'#dc2626',
  amber:'#d97706', purple:'#7c3aed', gray:'#94a3b8', pink:'#db2777',
  cols: ['#1d4ed8','#0d9488','#d97706','#7c3aed'],
}

// ── Helpers ────────────────────────────────────────────────────────────────
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0 }
function fmtVal(v, fmt) {
  if (v === null || v === undefined) return '—'
  if (fmt === '$') return '$' + N(v).toLocaleString('en-US', {minimumFractionDigits:0, maximumFractionDigits:0})
  if (fmt === '%') return N(v).toFixed(1) + '%'
  return N(v).toLocaleString()
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function rollupWeekly(reports, metricFn) {
  if (!reports.length) return []
  const sorted = [...reports].sort((a, b) => a.date.localeCompare(b.date))
  const weeks = []
  let wStart = sorted[0].date
  let bucket = []
  for (const r of sorted) {
    if (r.date >= addDays(wStart, 7)) {
      weeks.push({ label: wStart.slice(5), reports: bucket })
      wStart = r.date
      bucket = []
    }
    bucket.push(r)
  }
  if (bucket.length) weeks.push({ label: wStart.slice(5), reports: bucket })
  return weeks.map(w => ({ label: w.label, value: metricFn(w.reports) }))
}

// ── All available metrics ──────────────────────────────────────────────────
const METRICS = [
  { key: 'production',   label: 'Net Production',        fmt: '$',  fn: reps => reps.reduce((s,r) => s+repProd(r), 0) },
  { key: 'goal',         label: 'Goal',                  fmt: '$',  fn: (reps, pvs) => reps.reduce((s,r) => s+repGoal(r, pvs), 0) },
  { key: 'collections',  label: 'Collections',           fmt: '$',  fn: reps => reps.reduce((s,r) => s+repColl(r), 0) },
  { key: 'collRate',     label: 'Collection Rate',        fmt: '%',  fn: reps => { const p=reps.reduce((s,r)=>s+repProd(r),0); const c=reps.reduce((s,r)=>s+repColl(r),0); return p>0?c/p*100:0 } },
  { key: 'prodVsGoal',   label: 'Production vs Goal %',  fmt: '%',  fn: (reps,pvs) => { const g=reps.reduce((s,r)=>s+repGoal(r,pvs),0); const p=reps.reduce((s,r)=>s+repProd(r),0); return g>0?p/g*100:0 } },
  { key: 'showRate',     label: 'Show Rate',              fmt: '%',  fn: reps => { const on=reps.reduce((s,r)=>s+N(r.sched?.ptsOnSched),0); const sw=reps.reduce((s,r)=>s+N(r.sched?.ptsShowUp),0); return on>0?sw/on*100:0 } },
  { key: 'noShows',      label: 'No-Shows',               fmt: '#',  fn: reps => reps.reduce((s,r)=>s+N(r.sched?.noShows),0) },
  { key: 'npSched',      label: 'NP Scheduled',           fmt: '#',  fn: reps => reps.reduce((s,r)=>s+N(r.sched?.npOnSched),0) },
  { key: 'npShowed',     label: 'NP Showed',              fmt: '#',  fn: reps => reps.reduce((s,r)=>s+N(r.sched?.npShowed),0) },
  { key: 'npShowRate',   label: 'NP Show Rate',           fmt: '%',  fn: reps => { const on=reps.reduce((s,r)=>s+N(r.sched?.npOnSched),0); const sw=reps.reduce((s,r)=>s+N(r.sched?.npShowed),0); return on>0?sw/on*100:0 } },
  { key: 'npCallConv',   label: 'NP Call Conversion',     fmt: '%',  fn: reps => { const c=reps.reduce((s,r)=>s+N(r.sched?.npCalls),0); const s2=reps.reduce((s,r)=>s+N(r.sched?.npCallsSched),0); return c>0?s2/c*100:0 } },
  { key: 'recallConv',   label: 'Recall Conversion',      fmt: '%',  fn: reps => { const m=reps.reduce((s,r)=>s+N(r.sched?.recalls),0); const s2=reps.reduce((s,r)=>s+N(r.sched?.recallsSched),0); return m>0?s2/m*100:0 } },
  { key: 'txAcc',        label: 'TX Acceptance Rate',     fmt: '%',  fn: reps => { const p=reps.reduce((s,r)=>s+Object.values(r.fd||{}).reduce((a,f)=>a+N(f?.npTxPres),0),0); const a=reps.reduce((s,r)=>s+Object.values(r.fd||{}).reduce((a,f)=>a+N(f?.npTxAcc),0),0); return p>0?a/p*100:0 } },
]

const METRIC_MAP = Object.fromEntries(METRICS.map(m => [m.key, m]))

// ── Simple SVG chart ───────────────────────────────────────────────────────
function LineChart({ series, height = 200, showLegend = true }) {
  if (!series.length || !series[0].points.length) return (
    <div style={{height, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:13}}>No data</div>
  )

  const allVals = series.flatMap(s => s.points.map(p => p.value)).filter(v => v !== null)
  if (!allVals.length) return null
  const minV = Math.min(...allVals) * 0.95
  const maxV = Math.max(...allVals) * 1.05 || 1
  const labels = series[0].points.map(p => p.label)
  const W = 800, H = height
  const PAD = { top: 16, right: 16, bottom: 32, left: 56 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom

  const xPos = i => PAD.left + (i / Math.max(labels.length - 1, 1)) * cW
  const yPos = v => PAD.top + cH - ((v - minV) / (maxV - minV)) * cH

  const yTicks = 4
  const yStep  = (maxV - minV) / yTicks

  return (
    <div>
      {showLegend && series.length > 1 && (
        <div style={{display:'flex', gap:16, marginBottom:8, flexWrap:'wrap'}}>
          {series.map(s => (
            <div key={s.label} style={{display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#475569'}}>
              <div style={{width:16, height:3, borderRadius:2, background:s.color}}/>
              {s.label}
            </div>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} style={{width:'100%', height}} preserveAspectRatio="none">
        {/* Grid lines */}
        {Array.from({length: yTicks + 1}).map((_, i) => {
          const v = minV + yStep * i
          const y = yPos(v)
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} stroke="#f1f5f9" strokeWidth="1"/>
              <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize="9" fill="#94a3b8">
                {series[0]?.fmt === '$' ? '$' + Math.round(v).toLocaleString() : Math.round(v) + (series[0]?.fmt === '%' ? '%' : '')}
              </text>
            </g>
          )
        })}
        {/* X labels */}
        {labels.map((l, i) => {
          if (labels.length > 12 && i % Math.ceil(labels.length / 12) !== 0) return null
          return <text key={i} x={xPos(i)} y={H - 4} textAnchor="middle" fontSize="9" fill="#94a3b8">{l}</text>
        })}
        {/* Series lines + dots */}
        {series.map((s, si) => {
          const valid = s.points.filter(p => p.value !== null)
          if (!valid.length) return null
          const path = valid.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xPos(s.points.indexOf(p))} ${yPos(p.value)}`).join(' ')
          return (
            <g key={si}>
              <path d={path} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round"/>
              {s.points.map((p, i) => p.value !== null && (
                <circle key={i} cx={xPos(i)} cy={yPos(p.value)} r="3" fill={s.color}/>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function BarChart({ groups, height = 200, fmt = '$' }) {
  if (!groups.length) return null
  const allVals = groups.flatMap(g => g.values).filter(v => v !== null && v > 0)
  if (!allVals.length) return null
  const maxV = Math.max(...allVals) * 1.05

  return (
    <div style={{display:'flex', alignItems:'flex-end', gap:4, height, paddingBottom:20, position:'relative'}}>
      <div style={{position:'absolute', left:0, right:0, top:0, bottom:20}}>
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <div key={t} style={{position:'absolute', left:0, right:0, top: (1-t)*100+'%', borderTop:'1px solid #f1f5f9', display:'flex', alignItems:'flex-start'}}>
            <span style={{fontSize:9, color:'#94a3b8', transform:'translateY(-8px)', marginLeft:2}}>
              {fmtVal(maxV * t, fmt)}
            </span>
          </div>
        ))}
      </div>
      {groups.map((g, gi) => (
        <div key={gi} style={{flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2, height:'100%', justifyContent:'flex-end', position:'relative', zIndex:1}}>
          <div style={{width:'100%', display:'flex', gap:1, alignItems:'flex-end', justifyContent:'center', height: height - 20}}>
            {g.values.map((v, vi) => (
              <div key={vi} title={fmtVal(v, fmt)}
                style={{flex:1, maxWidth:40, borderRadius:'3px 3px 0 0', background:g.colors[vi], height: v > 0 ? Math.max((v/maxV)*100, 2)+'%' : '2px', opacity:0.85, cursor:'default', transition:'opacity .15s'}}
                onMouseEnter={e => e.currentTarget.style.opacity='1'}
                onMouseLeave={e => e.currentTarget.style.opacity='0.85'}
              />
            ))}
          </div>
          <div style={{fontSize:9, color:'#64748b', textAlign:'center', whiteSpace:'nowrap', overflow:'hidden', maxWidth:'100%', textOverflow:'ellipsis'}}>{g.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── Sparkline ──────────────────────────────────────────────────────────────
function Spark({ data, color, height = 32, width = 80 }) {
  if (!data.length) return null
  const vals = data.filter(v => v !== null)
  if (!vals.length) return null
  const mn = Math.min(...vals), mx = Math.max(...vals) || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = v !== null ? height - ((v - mn) / (mx - mn || 1)) * height : null
    return { x, y }
  }).filter(p => p.y !== null)
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  return (
    <svg width={width} height={height} style={{overflow:'visible'}}>
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"/>
    </svg>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 1 — PERFORMANCE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════
function PerformanceTab({ reports, providers, user, isManager, onOfficeClick }) {
  const [metric,      setMetric]      = useState('production')
  const [granularity, setGranularity] = useState('daily') // daily | weekly
  const [range,       setRange]       = useState('30')
  const [customStart, setCustomStart] = useState(monthStart())
  const [customEnd,   setCustomEnd]   = useState(todayStr())
  const isAdmin2 = user?.role === 'admin'
  const [selOffices,  setSelOffices]  = useState((!isManager || isAdmin2) ? [...OFFICES] : [user.office])

  const today = todayStr()
  const cutoff = useMemo(() => {
    if (range === 'custom') return customStart
    const d = new Date(today); d.setDate(d.getDate() - parseInt(range))
    return d.toISOString().slice(0, 10)
  }, [range, customStart, today])

  const endDate = range === 'custom' ? customEnd : today

  const inRange = useCallback(r => r.date >= cutoff && r.date <= endDate, [cutoff, endDate])

  const m = METRIC_MAP[metric]

  // Office cards — always show all offices (or manager's office)
  const isAdmin = user?.role === 'admin'
  const cardOffices = (!isManager || isAdmin) ? OFFICES : [user.office]
  const weekAgo = addDays(today, -7)
  const twoWkAgo = addDays(today, -14)

  const officeCards = useMemo(() => cardOffices.map((o, i) => {
    const or    = reports.filter(r => r.office === o)
    const thisW = or.filter(r => r.date >= weekAgo && r.date <= today)
    const lastW = or.filter(r => r.date >= twoWkAgo && r.date < weekAgo)
    const prodFn = reps => reps.reduce((s,r) => s+repProd(r), 0)
    const goalFn = reps => reps.reduce((s,r) => s+repGoal(r,providers), 0)
    const thisWProd = prodFn(thisW), lastWProd = prodFn(lastW)
    const thisWGoal = goalFn(thisW), lastWGoal = goalFn(lastW)
    const collThis  = thisW.reduce((s,r) => s+repColl(r), 0)
    const change    = lastWProd > 0 ? ((thisWProd - lastWProd) / lastWProd) * 100 : 0
    const onTrack   = thisWGoal > 0 && thisWProd >= thisWGoal * 0.9
    // Spark: last 14 days daily production
    const spark = Array.from({length:14}).map((_, k) => {
      const d = addDays(today, k - 13)
      const dayReps = or.filter(r => r.date === d)
      return dayReps.length ? prodFn(dayReps) : null
    })
    return { o, thisWProd, lastWProd, thisWGoal, collThis, change, onTrack, spark, color: C.cols[i] }
  }), [reports, providers, cardOffices, weekAgo, twoWkAgo, today])

  // Chart data
  const chartSeries = useMemo(() => selOffices.map((o, oi) => {
    const or = reports.filter(r => r.office === o && inRange(r))
    if (granularity === 'weekly') {
      const weeks = rollupWeekly(or, reps => m.fn(reps, providers))
      return { label: o, color: C.cols[OFFICES.indexOf(o)], fmt: m.fmt, points: weeks.map(w => ({ label: w.label, value: w.value })) }
    } else {
      const days = []
      const sorted = [...or].sort((a,b) => a.date.localeCompare(b.date))
      for (const r of sorted) {
        days.push({ label: r.date.slice(5), value: m.fn([r], providers) })
      }
      return { label: o, color: C.cols[OFFICES.indexOf(o)], fmt: m.fmt, points: days }
    }
  }), [reports, providers, selOffices, metric, granularity, inRange])

  const toggleOffice = o => setSelOffices(prev => prev.includes(o) ? prev.filter(x => x !== o) : [...prev, o])

  return (
    <div>
      {/* Office cards */}
      <div style={{display:'grid', gridTemplateColumns:`repeat(${cardOffices.length},1fr)`, gap:12, marginBottom:24}}>
        {officeCards.map(({ o, thisWProd, lastWProd, thisWGoal, collThis, change, onTrack, spark, color }) => (
          <div key={o} onClick={()=>onOfficeClick&&onOfficeClick(o)}
            title={`Click to open ${o} analytics`}
            style={{background:'white', borderRadius:12, cursor:'pointer', border:`2px solid ${onTrack?'#bbf7d0':'#fde68a'}`, padding:'14px 16px'}}>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8}}>
              <div>
                <div style={{fontSize:12, fontWeight:800, color:'#1e293b'}}>{o}</div>
                <div style={{fontSize:10, color:'#94a3b8', marginTop:2}}>This week vs last week</div>
              </div>
              <Spark data={spark} color={color} height={28} width={64}/>
            </div>
            <div style={{fontSize:20, fontWeight:800, color: onTrack ? '#16a34a' : '#d97706'}}>{USD(thisWProd)}</div>
            <div style={{display:'flex', alignItems:'center', gap:8, marginTop:4, flexWrap:'wrap'}}>
              <span style={{fontSize:11, color:'#64748b'}}>Goal: {USD(thisWGoal)}</span>
              <span style={{fontSize:11, fontWeight:700, color: change >= 0 ? '#16a34a' : '#dc2626'}}>
                {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(1)}% vs last wk
              </span>
            </div>
            <div style={{fontSize:11, color:'#0d9488', marginTop:2}}>Collected: {USD(collThis)} ({pct(collThis, thisWProd)}%)</div>
            <div style={{fontSize:10,color:'#94a3b8',marginTop:6,fontWeight:600}}>Click to explore →</div>
          </div>
        ))}
      </div>

      {/* Chart controls */}
      <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'16px 20px'}}>
        <div style={{display:'flex', gap:10, flexWrap:'wrap', marginBottom:16, alignItems:'flex-end'}}>
          {/* Metric picker */}
          <div style={{flex:'1 1 180px'}}>
            <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>METRIC</div>
            <select value={metric} onChange={e => setMetric(e.target.value)}
              style={{width:'100%', padding:'7px 10px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13, fontWeight:600}}>
              {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
          </div>

          {/* Granularity */}
          <div>
            <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>VIEW AS</div>
            <div style={{display:'flex', borderRadius:8, overflow:'hidden', border:'1px solid #e2e8f0'}}>
              {[['daily','Daily'],['weekly','Weekly']].map(([v,l]) => (
                <button key={v} onClick={() => setGranularity(v)}
                  style={{padding:'7px 14px', border:'none', cursor:'pointer', fontSize:12, fontWeight:600,
                    background: granularity===v ? '#1d4ed8' : 'white', color: granularity===v ? 'white' : '#64748b'}}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Time range */}
          <div>
            <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>TIME RANGE</div>
            <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
              {[['7','7D'],['14','14D'],['30','30D'],['60','60D'],['90','90D'],['custom','Custom']].map(([v,l]) => (
                <button key={v} onClick={() => setRange(v)}
                  style={{padding:'6px 10px', borderRadius:7, border:'1px solid '+(range===v?'#1d4ed8':'#e2e8f0'),
                    background: range===v ? '#1d4ed8' : 'white', color: range===v ? 'white' : '#64748b',
                    fontWeight:600, fontSize:11, cursor:'pointer'}}>
                  {l}
                </button>
              ))}
            </div>
            {range === 'custom' && (
              <div style={{display:'flex', gap:6, alignItems:'center', marginTop:6}}>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  style={{padding:'5px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
                <span style={{fontSize:11, color:'#94a3b8'}}>to</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  style={{padding:'5px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
              </div>
            )}
          </div>

          {/* Office selector */}
          {(!isManager || user?.role === 'admin') && (
            <div>
              <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>OFFICES</div>
              <div style={{display:'flex', gap:4}}>
                {OFFICES.map((o, i) => (
                  <button key={o} onClick={() => toggleOffice(o)}
                    style={{padding:'6px 10px', borderRadius:7, border:`1px solid ${selOffices.includes(o) ? C.cols[i] : '#e2e8f0'}`,
                      background: selOffices.includes(o) ? C.cols[i] : 'white',
                      color: selOffices.includes(o) ? 'white' : '#64748b',
                      fontWeight:600, fontSize:11, cursor:'pointer'}}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Chart */}
        <div style={{marginBottom:8}}>
          <div style={{fontSize:11, fontWeight:700, color:'#1e293b', marginBottom:4}}>
            {m.label} — {granularity === 'daily' ? 'Daily' : 'Weekly rolling 7-day'} · {selOffices.join(', ')}
          </div>
          {chartSeries.every(s => !s.points.length) ? (
            <div style={{textAlign:'center', padding:40, color:'#94a3b8'}}>No data for this period</div>
          ) : (
            <LineChart series={chartSeries} height={260}/>
          )}
        </div>

        {/* Summary numbers */}
        <div style={{display:'flex', gap:10, flexWrap:'wrap', paddingTop:12, borderTop:'1px solid #f1f5f9'}}>
          {selOffices.map((o, oi) => {
            const or = reports.filter(r => r.office === o && inRange(r))
            const val = m.fn(or, providers)
            return (
              <div key={o} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 12px', borderRadius:8, background:'#f8fafc', border:`1px solid ${C.cols[OFFICES.indexOf(o)]}30`}}>
                <div style={{width:10, height:10, borderRadius:'50%', background:C.cols[OFFICES.indexOf(o)]}}/>
                <span style={{fontSize:12, fontWeight:700, color:'#1e293b'}}>{o}:</span>
                <span style={{fontSize:12, fontWeight:800, color:C.cols[OFFICES.indexOf(o)]}}>{fmtVal(val, m.fmt)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 2 — PERIOD COMPARISON
// ═══════════════════════════════════════════════════════════════════════════
function ComparisonTab({ reports, providers, user, isManager }) {
  const today   = todayStr()
  const [preset, setPreset]     = useState('week')
  const [aStart, setAStart]     = useState(addDays(today, -7))
  const [aEnd,   setAEnd]       = useState(today)
  const [bStart, setBStart]     = useState(addDays(today, -14))
  const [bEnd,   setBEnd]       = useState(addDays(today, -7))
  const [office, setOffice]     = useState(isManager ? user.office : 'all')

  const applyPreset = p => {
    setPreset(p)
    if (p === 'week')  { setAStart(addDays(today,-7));  setAEnd(today); setBStart(addDays(today,-14)); setBEnd(addDays(today,-8)) }
    if (p === 'month') { setAStart(monthStart()); setAEnd(today); const pm = new Date(today); pm.setMonth(pm.getMonth()-1); const pms = pm.toISOString().slice(0,7)+'-01'; const pme = addDays(monthStart(),-1); setBStart(pms); setBEnd(pme) }
  }

  const filterReps = (s, e) => reports.filter(r => r.date >= s && r.date <= e && (office==='all' || r.office===office))
  const repsA = useMemo(() => filterReps(aStart, aEnd),   [reports, aStart, aEnd, office])
  const repsB = useMemo(() => filterReps(bStart, bEnd),   [reports, bStart, bEnd, office])

  const compMetrics = [
    { key:'production',  label:'Net Production',       fmt:'$' },
    { key:'collections', label:'Collections',          fmt:'$' },
    { key:'collRate',    label:'Collection Rate',      fmt:'%' },
    { key:'prodVsGoal',  label:'Production vs Goal',   fmt:'%' },
    { key:'showRate',    label:'Show Rate',            fmt:'%' },
    { key:'noShows',     label:'No-Shows',             fmt:'#' },
    { key:'npSched',     label:'NP Scheduled',         fmt:'#' },
    { key:'npShowed',    label:'NP Showed',            fmt:'#' },
    { key:'npShowRate',  label:'NP Show Rate',         fmt:'%' },
    { key:'recallConv',  label:'Recall Conversion',    fmt:'%' },
    { key:'txAcc',       label:'TX Acceptance Rate',   fmt:'%' },
  ]

  const rows = compMetrics.map(cm => {
    const m  = METRIC_MAP[cm.key]
    const vA = m.fn(repsA, providers)
    const vB = m.fn(repsB, providers)
    const diff  = vA - vB
    const diffPct = vB !== 0 ? (diff / Math.abs(vB)) * 100 : null
    const better = cm.key === 'noShows' ? diff < 0 : diff >= 0
    return { ...cm, vA, vB, diff, diffPct, better }
  })

  return (
    <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'20px'}}>
      {/* Controls */}
      <div style={{display:'flex', gap:10, flexWrap:'wrap', marginBottom:20, alignItems:'flex-end'}}>
        <div>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>QUICK SELECT</div>
          <div style={{display:'flex', gap:4}}>
            {[['week','This Wk vs Last Wk'],['month','This Mo vs Last Mo'],['custom','Custom']].map(([v,l]) => (
              <button key={v} onClick={() => applyPreset(v)}
                style={{padding:'7px 12px', borderRadius:8, border:'1px solid '+(preset===v?'#1d4ed8':'#e2e8f0'),
                  background: preset===v ? '#1d4ed8' : 'white', color: preset===v ? 'white' : '#64748b',
                  fontWeight:600, fontSize:12, cursor:'pointer'}}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {(!isManager || user?.role === 'admin') && (
          <div>
            <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>OFFICE</div>
            <select value={office} onChange={e => setOffice(e.target.value)}
              style={{padding:'7px 10px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:13}}>
              <option value="all">All Offices</option>
              {OFFICES.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Date range pickers */}
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:20}}>
        {[['Period A', aStart, setAStart, aEnd, setAEnd, '#1d4ed8'],
          ['Period B', bStart, setBStart, bEnd, setBEnd, '#0d9488']].map(([label, s, setS, e, setE, color]) => (
          <div key={label} style={{padding:'12px 14px', borderRadius:10, border:`2px solid ${color}30`, background:`${color}08`}}>
            <div style={{fontSize:11, fontWeight:800, color, marginBottom:8}}>{label}</div>
            <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap'}}>
              <input type="date" value={s} onChange={ev => {setS(ev.target.value); setPreset('custom')}}
                style={{padding:'5px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
              <span style={{fontSize:11, color:'#94a3b8'}}>to</span>
              <input type="date" value={e} onChange={ev => {setE(ev.target.value); setPreset('custom')}}
                style={{padding:'5px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
              <span style={{fontSize:11, color:'#94a3b8'}}>{filterReps(s,e).length} reports</span>
            </div>
          </div>
        ))}
      </div>

      {/* Comparison table */}
      <table style={{width:'100%', borderCollapse:'collapse'}}>
        <thead>
          <tr style={{background:'#f8fafc'}}>
            <th style={{padding:'10px 14px', textAlign:'left', fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:.5}}>METRIC</th>
            <th style={{padding:'10px 14px', textAlign:'right', fontSize:11, fontWeight:800, color:'#1d4ed8', letterSpacing:.5}}>PERIOD A</th>
            <th style={{padding:'10px 14px', textAlign:'right', fontSize:11, fontWeight:800, color:'#0d9488', letterSpacing:.5}}>PERIOD B</th>
            <th style={{padding:'10px 14px', textAlign:'right', fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:.5}}>CHANGE</th>
            <th style={{padding:'10px 14px', textAlign:'right', fontSize:11, fontWeight:800, color:'#64748b', letterSpacing:.5}}>%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key} style={{borderTop:'1px solid #f1f5f9', background: i%2===0 ? 'white' : '#fafafa'}}>
              <td style={{padding:'10px 14px', fontSize:13, fontWeight:600, color:'#1e293b'}}>{row.label}</td>
              <td style={{padding:'10px 14px', textAlign:'right', fontSize:13, fontWeight:700, color:'#1d4ed8'}}>{fmtVal(row.vA, row.fmt)}</td>
              <td style={{padding:'10px 14px', textAlign:'right', fontSize:13, fontWeight:700, color:'#0d9488'}}>{fmtVal(row.vB, row.fmt)}</td>
              <td style={{padding:'10px 14px', textAlign:'right', fontSize:13, fontWeight:700, color: row.better ? '#16a34a' : '#dc2626'}}>
                {row.better ? '▲' : '▼'} {fmtVal(Math.abs(row.diff), row.fmt)}
              </td>
              <td style={{padding:'10px 14px', textAlign:'right'}}>
                {row.diffPct !== null && (
                  <span style={{fontSize:12, fontWeight:700, padding:'2px 8px', borderRadius:99,
                    background: row.better ? '#dcfce7' : '#fee2e2',
                    color: row.better ? '#16a34a' : '#dc2626'}}>
                    {row.better ? '+' : ''}{row.diffPct.toFixed(1)}%
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// TAB 3 — MANAGER PILLARS
// ═══════════════════════════════════════════════════════════════════════════
const BM = { showRate:90, recallConv:85, callConv:50, npShowRate:80, txPresRate:80, txAccRate:60, collRate:95, noShowMax:10 }

function status(val, bm, inv=false) {
  if (val===null) return 'na'
  if (!inv) return val>=bm?'green':val>=bm*0.85?'amber':'red'
  return val<=bm?'green':val<=bm*1.15?'amber':'red'
}
const SS = { green:{bg:'#dcfce7',color:'#16a34a',border:'#bbf7d0'}, amber:{bg:'#fef3c7',color:'#d97706',border:'#fde68a'}, red:{bg:'#fee2e2',color:'#dc2626',border:'#fecaca'}, na:{bg:'#f1f5f9',color:'#94a3b8',border:'#e2e8f0'} }

// ── Interactive chart for pillars (hover crosshair + tooltip) ──────────────
function PillarChart({ series, height = 200, fmt = '%' }) {
  const [hover, setHover] = useState(null)
  const svgRef = useRef()
  const allPts = series.flatMap(s => s.points.map(p => p.value)).filter(v => v != null)
  if (!allPts.length) return (
    <div style={{height, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:12}}>
      No data for this period
    </div>
  )
  const labels = series[0].points.map(p => p.label)
  const W = 800, H = height
  const PAD = { top:20, right:20, bottom:28, left:50 }
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom
  const maxV = fmt === '%' ? 100 : (Math.max(...allPts) * 1.12 || 1)
  const minV = 0
  const xPos = i => PAD.left + (i / Math.max(labels.length - 1, 1)) * cW
  const yPos = v => PAD.top + cH - ((v - minV) / (maxV - minV)) * cH
  const yTicks = 4

  const onMove = useCallback(e => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const mx = (e.clientX - rect.left) * (W / rect.width)
    const idx = Math.max(0, Math.min(labels.length - 1, Math.round(((mx - PAD.left) / cW) * (labels.length - 1))))
    setHover(idx)
  }, [labels.length, cW])

  return (
    <div style={{position:'relative', userSelect:'none'}}>
      {series.length > 1 && (
        <div style={{display:'flex', gap:14, marginBottom:8, flexWrap:'wrap'}}>
          {series.map(s => (
            <div key={s.label} style={{display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#64748b'}}>
              <div style={{width:16, height:3, borderRadius:2, background:s.color}}/>{s.label}
            </div>
          ))}
        </div>
      )}
      {hover !== null && (
        <div style={{position:'absolute', top:series.length>1?28:0,
          left:`clamp(8px, calc(${((xPos(hover)/W)*100).toFixed(1)}% - 70px), calc(100% - 150px))`,
          background:'white', border:'1px solid #e2e8f0', borderRadius:9,
          boxShadow:'0 4px 16px rgba(0,0,0,.1)', padding:'8px 12px', zIndex:10, minWidth:142, pointerEvents:'none'}}>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:5}}>{labels[hover]}</div>
          {series.map(s => s.points[hover]?.value != null && (
            <div key={s.label} style={{display:'flex', justifyContent:'space-between', gap:12, fontSize:12, marginBottom:2}}>
              <div style={{display:'flex', alignItems:'center', gap:5}}>
                <div style={{width:8, height:8, borderRadius:'50%', background:s.color, flexShrink:0}}/>
                <span style={{color:'#64748b'}}>{s.label}</span>
              </div>
              <span style={{fontWeight:800, color:'#1e293b'}}>
                {fmt==='%' ? Math.round(s.points[hover].value)+'%' : fmt==='$' ? '$'+Math.round(s.points[hover].value).toLocaleString() : Math.round(s.points[hover].value)}
              </span>
            </div>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{width:'100%', height, cursor:'crosshair'}}
        preserveAspectRatio="none" onMouseMove={onMove} onMouseLeave={()=>setHover(null)}>
        {Array.from({length: yTicks + 1}).map((_, i) => {
          const v = (maxV / yTicks) * i, y = yPos(v)
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W-PAD.right} y2={y} stroke="#f1f5f9" strokeWidth="1"/>
              <text x={PAD.left-6} y={y+4} textAnchor="end" fontSize="9" fill="#94a3b8">
                {fmt==='%' ? Math.round(v)+'%' : fmt==='$' ? '$'+Math.round(v/1000)+'k' : Math.round(v)}
              </text>
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
          const line = pts.map((p,j)=>`${j===0?'M':'L'} ${xPos(p.i)} ${yPos(p.value)}`).join(' ')
          const area = line + ` L ${xPos(pts[pts.length-1].i)} ${yPos(0)} L ${xPos(pts[0].i)} ${yPos(0)} Z`
          return (
            <g key={si}>
              <path d={area} fill={s.color} fillOpacity="0.06"/>
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
        {/* Benchmark line */}
        {series[0]?.benchmark != null && (
          <g>
            <line x1={PAD.left} y1={yPos(series[0].benchmark)} x2={W-PAD.right} y2={yPos(series[0].benchmark)}
              stroke="#cbd5e1" strokeWidth="1.5" strokeDasharray="6,4"/>
            <text x={W-PAD.right} y={yPos(series[0].benchmark)-4} textAnchor="end" fontSize="9" fill="#94a3b8" fontWeight="700">
              Target {series[0].benchmark}%
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}

// ── Leakage funnel stages — the patient acquisition pipeline ───────────────
// Each stage: who's accountable, what the numerator/denominator are, the benchmark,
// and a plain-language diagnosis + action when it leaks.
const FUNNEL_STAGES = [
  {
    key:'phoneConv', label:'Phone Conversion', icon:'📞', bm:BM.callConv, accountable:'Front Desk',
    short:'NP calls → booked',
    num:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.callsSched),0),
    den:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.calls),0),
    perStaff:fd=>({num:N(fd.callsSched), den:N(fd.calls)}),
    diagnose:v=>`Only ${Math.round(v)}% of new-patient phone calls are converting to booked appointments. Calls are coming in but not turning into schedule.`,
    action:'Review phone scripts and call handling. Are calls being answered promptly? Is the team asking for the appointment? Listen to call recordings if available.',
  },
  {
    key:'recallConv', label:'Recall Conversion', icon:'🔁', bm:BM.recallConv, accountable:'Front Desk',
    short:'recalls → booked',
    num:r=>N(r.sched?.recallsSched) || Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.recallsSched),0),
    den:r=>N(r.sched?.recalls)      || Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.recalls),0),
    perStaff:fd=>({num:N(fd.recallsSched), den:N(fd.recalls)}),
    diagnose:v=>`Recall list is only converting at ${Math.round(v)}%. Patients due for hygiene/treatment aren't being rebooked.`,
    action:'Work the recall list daily. Reactivate overdue patients. Consider text/email recall in addition to calls.',
  },
  {
    key:'confirmRate', label:'Confirmation Rate', icon:'✅', bm:90, accountable:'Front Desk',
    short:'scheduled → confirmed',
    num:r=>N(r.sched?.ptsConfirmed), den:r=>N(r.sched?.ptsOnSched),
    perStaff:null,
    diagnose:v=>`Only ${Math.round(v)}% of scheduled patients are being confirmed ahead of their appointment. Unconfirmed patients no-show at much higher rates.`,
    action:'Confirm every patient 24-48h ahead. Use the confirmation call/text workflow consistently. Unconfirmed = high no-show risk.',
  },
  {
    key:'showRate', label:'Show Rate', icon:'🚪', bm:BM.showRate, accountable:'Office',
    short:'confirmed → showed',
    num:r=>N(r.sched?.ptsShowUp), den:r=>N(r.sched?.ptsOnSched),
    perStaff:null,
    diagnose:v=>`${Math.round(v)}% of scheduled patients actually show up — the rest are no-shows or last-minute cancels. Every empty chair is lost production.`,
    action:'Tighten confirmations. Implement a no-show policy. Fill gaps from a short-call list. Track repeat offenders.',
  },
  {
    key:'npShowRate', label:'NP Show Rate', icon:'🆕', bm:BM.npShowRate, accountable:'Office',
    short:'NP scheduled → showed',
    num:r=>N(r.sched?.npShowed), den:r=>N(r.sched?.npOnSched),
    perStaff:null,
    diagnose:v=>`New patients are showing at only ${Math.round(v)}%. NPs are the hardest to win and the most expensive to acquire — losing them before they arrive is costly.`,
    action:'Call NPs personally before their first visit. Send directions and a warm welcome. Reduce the gap between booking and appointment.',
  },
  {
    key:'prebookRate', label:'Prebooking', icon:'📅', bm:80, accountable:'Clinical + FD',
    short:'comp exams → rebooked',
    num:r=>N(r.sched?.ptsPrebooked), den:r=>N(r.sched?.compExamsSeen),
    perStaff:null,
    diagnose:v=>`Only ${Math.round(v)}% of patients seen for comprehensive exams are leaving with their next appointment booked. They walk out the door without a reason to return.`,
    action:'Book the next visit before the patient leaves the chair. Hygiene reappointment should be automatic at checkout.',
  },
  {
    key:'npTxAcc', label:'NP TX Acceptance', icon:'💬', bm:BM.txAccRate, accountable:'Treatment Coord',
    short:'TX presented → accepted',
    num:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.npTxAcc),0),
    den:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.npTxPres),0),
    perStaff:fd=>({num:N(fd.npTxAcc), den:N(fd.npTxPres)}),
    diagnose:v=>`New-patient treatment acceptance is at ${Math.round(v)}%. Treatment is being presented but not closed — patients leave without committing.`,
    action:'Review case presentation. Offer financing options up front. Make sure the value and urgency of treatment is clearly communicated.',
  },
]

function PillarsTab({ reports, providers, users, onEdit }) {
  const [days,      setDays]      = useState(30)
  const [selOffice, setSelOffice] = useState('all')   // all | office name
  const [selStage,  setSelStage]  = useState(null)    // drill into a stage
  const [view,      setView]      = useState('funnel') // funnel | trend

  const today  = todayStr()
  const cutoff = useMemo(() => { const d=new Date(today); d.setDate(d.getDate()-days); return d.toISOString().slice(0,10) }, [days, today])
  const prevCutoff = useMemo(() => { const d=new Date(today); d.setDate(d.getDate()-days*2); return d.toISOString().slice(0,10) }, [days, today])

  const officeList = ['all', ...OFFICES]

  // Compute each stage for the selected scope (current window + prior window for trend)
  const stageData = useMemo(() => {
    const inScope  = r => (selOffice==='all' || r.office===selOffice)
    const curReps  = reports.filter(r => inScope(r) && r.date>=cutoff && r.date<=today)
    const prevReps = reports.filter(r => inScope(r) && r.date>=prevCutoff && r.date<cutoff)

    return FUNNEL_STAGES.map(stage => {
      const cNum = curReps.reduce((s,r)=>s+stage.num(r),0)
      const cDen = curReps.reduce((s,r)=>s+stage.den(r),0)
      const pNum = prevReps.reduce((s,r)=>s+stage.num(r),0)
      const pDen = prevReps.reduce((s,r)=>s+stage.den(r),0)
      const cur  = cDen>0 ? cNum/cDen*100 : null
      const prev = pDen>0 ? pNum/pDen*100 : null
      const trend = (cur!=null && prev!=null) ? cur - prev : null
      // Flags: below benchmark OR declining trend
      const belowBm   = cur!=null && cur < stage.bm
      const declining = trend!=null && trend < -3   // >3pt drop vs prior window
      const flagged   = belowBm || declining
      // Estimated lost count = (benchmark - actual)% × denominator
      const lostCount = (cur!=null && cur<stage.bm) ? Math.round((stage.bm - cur)/100 * cDen) : 0
      return { ...stage, cNum, cDen, cur, prev, trend, belowBm, declining, flagged, lostCount, curReps }
    })
  }, [reports, selOffice, cutoff, prevCutoff, today])

  // Ranked issues — flagged stages, biggest leak first (by lost count)
  const issues = useMemo(() =>
    stageData.filter(s => s.flagged && s.cDen > 0)
      .sort((a,b) => b.lostCount - a.lostCount)
  , [stageData])

  // Per-staff breakdown for a stage that supports it
  const staffBreakdown = useMemo(() => {
    if (!selStage) return []
    const stage = FUNNEL_STAGES.find(s=>s.key===selStage)
    if (!stage?.perStaff) return []
    const inScope = r => (selOffice==='all' || r.office===selOffice)
    const curReps = reports.filter(r => inScope(r) && r.date>=cutoff && r.date<=today)
    const map = {}
    curReps.forEach(r => Object.entries(r.fd||{}).forEach(([name, fd]) => {
      const { num, den } = stage.perStaff(fd)
      if (!map[name]) map[name] = { name, num:0, den:0 }
      map[name].num += num; map[name].den += den
    }))
    return Object.values(map).filter(s=>s.den>0)
      .map(s => ({ ...s, pct: s.num/s.den*100 }))
      .sort((a,b) => a.pct - b.pct)  // worst first
  }, [selStage, selOffice, reports, cutoff, today])

  const stColor = (v, bm, inv) => {
    if (v == null) return '#94a3b8'
    return SS[status(v, bm, inv)].color
  }

  // Funnel max denominator for bar scaling
  const funnelMax = Math.max(...stageData.map(s=>s.cDen), 1)

  return (
    <div>
      {/* ── Controls ── */}
      <div style={{display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end', marginBottom:16,
        background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'14px 18px'}}>
        <div>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>OFFICE</div>
          <div style={{display:'flex', gap:4, flexWrap:'wrap'}}>
            {officeList.map(o => (
              <button key={o} onClick={()=>{setSelOffice(o); setSelStage(null)}}
                style={{padding:'6px 12px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                  border:'1px solid '+(selOffice===o?'#1e3a5f':'#e2e8f0'),
                  background:selOffice===o?'#1e3a5f':'white', color:selOffice===o?'white':'#64748b'}}>
                {o==='all'?'All Offices':o}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>WINDOW</div>
          <div style={{display:'flex', gap:4}}>
            {[[14,'14D'],[30,'30D'],[60,'60D'],[90,'90D']].map(([d,l]) => (
              <button key={d} onClick={()=>setDays(d)}
                style={{padding:'6px 12px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                  border:'1px solid '+(days===d?'#1d4ed8':'#e2e8f0'),
                  background:days===d?'#1d4ed8':'white', color:days===d?'white':'#64748b'}}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div style={{marginLeft:'auto'}}>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>VIEW</div>
          <div style={{display:'flex', borderRadius:7, overflow:'hidden', border:'1px solid #e2e8f0'}}>
            {[['funnel','🔻 Funnel'],['trend','📈 Trends']].map(([v,l]) => (
              <button key={v} onClick={()=>setView(v)}
                style={{padding:'6px 12px', border:'none', cursor:'pointer', fontSize:11, fontWeight:700,
                  background:view===v?'#1e3a5f':'white', color:view===v?'white':'#64748b'}}>
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Headline diagnosis banner ── */}
      <div style={{borderRadius:12, padding:'16px 20px', marginBottom:16,
        background: issues.length===0 ? 'linear-gradient(135deg,#dcfce7,#f0fdf4)' : 'linear-gradient(135deg,#fef2f2,#fff7ed)',
        border:`1px solid ${issues.length===0?'#bbf7d0':'#fecaca'}`}}>
        {issues.length===0 ? (
          <div style={{display:'flex', alignItems:'center', gap:10}}>
            <div style={{fontSize:24}}>✅</div>
            <div>
              <div style={{fontSize:15, fontWeight:800, color:'#15803d'}}>No major leaks detected</div>
              <div style={{fontSize:12, color:'#16a34a'}}>{selOffice==='all'?'All offices':selOffice} are hitting targets across the funnel for the last {days} days.</div>
            </div>
          </div>
        ) : (
          <div style={{display:'flex', alignItems:'flex-start', gap:10}}>
            <div style={{fontSize:24}}>🔻</div>
            <div>
              <div style={{fontSize:15, fontWeight:800, color:'#b91c1c'}}>
                {issues.length} leak{issues.length>1?'s':''} found in the schedule funnel
              </div>
              <div style={{fontSize:12, color:'#dc2626', marginTop:2}}>
                Biggest issue: <b>{issues[0].label}</b> — {issues[0].accountable} accountable.
                {issues[0].lostCount>0 && ` Roughly ${issues[0].lostCount} patients lost at this stage vs target.`}
              </div>
            </div>
          </div>
        )}
      </div>

      {view==='funnel' ? (
        <>
          {/* ── FUNNEL ── */}
          <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'18px 20px', marginBottom:16}}>
            <div style={{fontSize:11, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:4}}>
              ACQUISITION FUNNEL — {selOffice==='all'?'All Offices':selOffice} · last {days} days
            </div>
            <div style={{fontSize:11, color:'#94a3b8', marginBottom:16}}>Click any stage to see who's accountable and the daily detail</div>
            {stageData.map((s, i) => {
              const widthPct = s.cDen>0 ? Math.max(8, (s.cDen/funnelMax)*100) : 8
              const isSel = selStage===s.key
              const barColor = s.flagged ? '#dc2626' : s.cur!=null && s.cur>=s.bm ? '#16a34a' : '#cbd5e1'
              return (
                <div key={s.key} onClick={()=>setSelStage(isSel?null:s.key)}
                  style={{cursor:'pointer', marginBottom:10, padding:'10px 12px', borderRadius:9,
                    background:isSel?'#f8fafc':'transparent', border:`1px solid ${isSel?'#e2e8f0':'transparent'}`}}>
                  <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
                    <span style={{fontSize:16}}>{s.icon}</span>
                    <span style={{fontSize:13, fontWeight:800, color:'#1e293b'}}>{s.label}</span>
                    <span style={{fontSize:11, color:'#94a3b8'}}>{s.short}</span>
                    {s.flagged && (
                      <span style={{fontSize:9, fontWeight:800, color:'#dc2626', background:'#fee2e2', padding:'2px 8px', borderRadius:99}}>
                        {s.belowBm && s.declining ? '⚠ BELOW TARGET + DECLINING' : s.belowBm ? '⚠ BELOW TARGET' : '⚠ DECLINING'}
                      </span>
                    )}
                    <div style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:10}}>
                      {s.trend!=null && (
                        <span style={{fontSize:11, fontWeight:700, color:s.trend>=0?'#16a34a':'#dc2626'}}>
                          {s.trend>=0?'▲':'▼'} {Math.abs(Math.round(s.trend))}pt
                        </span>
                      )}
                      <span style={{fontSize:18, fontWeight:800, color:barColor}}>
                        {s.cur!=null?Math.round(s.cur)+'%':'—'}
                      </span>
                      <span style={{fontSize:11, color:'#94a3b8', minWidth:54, textAlign:'right'}}>target {s.bm}%</span>
                    </div>
                  </div>
                  {/* Funnel bar */}
                  <div style={{display:'flex', alignItems:'center', gap:10}}>
                    <div style={{flex:1, height:22, background:'#f1f5f9', borderRadius:6, overflow:'hidden', position:'relative'}}>
                      <div style={{height:'100%', width:widthPct+'%', background:barColor, opacity:.85,
                        borderRadius:6, transition:'width .3s', display:'flex', alignItems:'center', paddingLeft:8}}>
                        <span style={{fontSize:11, fontWeight:700, color:'white'}}>{s.cNum} / {s.cDen}</span>
                      </div>
                      {/* Benchmark marker */}
                      {s.cDen>0 && (
                        <div style={{position:'absolute', top:0, bottom:0, left:`${(s.bm/100)*widthPct}%`,
                          width:2, background:'#1e293b', opacity:.3}}/>
                      )}
                    </div>
                    {s.lostCount>0 && (
                      <span style={{fontSize:11, fontWeight:700, color:'#dc2626', whiteSpace:'nowrap'}}>
                        ~{s.lostCount} lost
                      </span>
                    )}
                  </div>

                  {/* Expanded: accountability + per-staff + daily */}
                  {isSel && (
                    <div style={{marginTop:12, paddingTop:12, borderTop:'1px solid #e2e8f0'}}>
                      <div style={{display:'flex', gap:8, flexWrap:'wrap', marginBottom:10}}>
                        <span style={{fontSize:10, fontWeight:800, color:'#64748b', background:'#f1f5f9', padding:'3px 10px', borderRadius:99}}>
                          ACCOUNTABLE: {s.accountable}
                        </span>
                      </div>
                      {s.cur!=null && s.cur<s.bm && (
                        <div style={{background:'#fff7ed', borderRadius:9, padding:'12px 14px', marginBottom:10, border:'1px solid #fed7aa'}}>
                          <div style={{fontSize:12, color:'#9a3412', marginBottom:6}}>{s.diagnose(s.cur)}</div>
                          <div style={{fontSize:11, fontWeight:700, color:'#c2410c'}}>→ {s.action}</div>
                        </div>
                      )}
                      {/* Per-staff breakdown */}
                      {s.perStaff && staffBreakdown.length>0 && (
                        <div style={{marginBottom:10}}>
                          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:6}}>BY STAFF MEMBER — worst first</div>
                          {staffBreakdown.map(st => (
                            <div key={st.name} style={{display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom:'1px solid #f8fafc'}}>
                              <span style={{fontSize:12, fontWeight:700, color:'#1e293b', minWidth:120}}>{st.name}</span>
                              <div style={{flex:1, height:6, background:'#f1f5f9', borderRadius:3, overflow:'hidden'}}>
                                <div style={{height:'100%', width:Math.min(100,st.pct)+'%', background:stColor(st.pct, s.bm, false), borderRadius:3}}/>
                              </div>
                              <span style={{fontSize:12, fontWeight:800, color:stColor(st.pct, s.bm, false), minWidth:42, textAlign:'right'}}>{Math.round(st.pct)}%</span>
                              <span style={{fontSize:10, color:'#94a3b8', minWidth:54}}>{st.num}/{st.den}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Daily detail with edit */}
                      <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:6}}>RECENT DAILY DETAIL</div>
                      <div style={{overflowX:'auto'}}>
                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:11}}>
                          <thead>
                            <tr style={{background:'#f8fafc'}}>
                              <th style={{padding:'5px 8px', textAlign:'left', fontSize:9, fontWeight:800, color:'#94a3b8'}}>DATE</th>
                              {selOffice==='all' && <th style={{padding:'5px 8px', textAlign:'left', fontSize:9, fontWeight:800, color:'#94a3b8'}}>OFFICE</th>}
                              <th style={{padding:'5px 8px', textAlign:'right', fontSize:9, fontWeight:800, color:'#94a3b8'}}>RATE</th>
                              <th style={{padding:'5px 8px', textAlign:'right', fontSize:9, fontWeight:800, color:'#94a3b8'}}>NUM/DEN</th>
                              <th style={{padding:'5px 8px', fontSize:9, fontWeight:800, color:'#94a3b8'}}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {s.curReps.filter(r=>s.den(r)>0).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,8).map(r => {
                              const num=s.num(r), den=s.den(r), pct=den>0?num/den*100:null
                              return (
                                <tr key={r.id} style={{borderTop:'1px solid #f8fafc', background:'white'}}>
                                  <td style={{padding:'5px 8px', color:'#64748b'}}>{r.date}</td>
                                  {selOffice==='all' && <td style={{padding:'5px 8px', color:'#64748b'}}>{r.office}</td>}
                                  <td style={{padding:'5px 8px', textAlign:'right', fontWeight:700, color:stColor(pct, s.bm, false)}}>{pct!=null?Math.round(pct)+'%':'—'}</td>
                                  <td style={{padding:'5px 8px', textAlign:'right', color:'#94a3b8'}}>{num}/{den}</td>
                                  <td style={{padding:'5px 8px', textAlign:'right'}}>
                                    {onEdit && <button onClick={(e)=>{e.stopPropagation();onEdit(r)}}
                                      style={{padding:'2px 9px', borderRadius:5, background:'#1d4ed8', color:'white', border:'none', fontSize:10, fontWeight:700, cursor:'pointer'}}>Edit</button>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── RANKED ACTION LIST ── */}
          {issues.length>0 && (
            <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'18px 20px'}}>
              <div style={{fontSize:13, fontWeight:800, color:'#1e293b', marginBottom:4}}>🎯 Action Plan — fix these in order</div>
              <div style={{fontSize:11, color:'#94a3b8', marginBottom:14}}>Ranked by estimated patient impact. Tackle the top of the list first.</div>
              {issues.map((s, i) => (
                <div key={s.key} style={{display:'flex', gap:12, padding:'14px 0', borderTop:i>0?'1px solid #f1f5f9':'none'}}>
                  <div style={{flexShrink:0, width:28, height:28, borderRadius:8, background:'#fee2e2',
                    display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:800, color:'#dc2626'}}>
                    {i+1}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:4}}>
                      <span style={{fontSize:14}}>{s.icon}</span>
                      <span style={{fontSize:13, fontWeight:800, color:'#1e293b'}}>{s.label}</span>
                      <span style={{fontSize:18, fontWeight:800, color:'#dc2626'}}>{Math.round(s.cur)}%</span>
                      <span style={{fontSize:11, color:'#94a3b8'}}>vs {s.bm}% target</span>
                      {s.declining && <span style={{fontSize:10, fontWeight:700, color:'#dc2626'}}>▼ {Math.abs(Math.round(s.trend))}pt vs prior period</span>}
                      <span style={{marginLeft:'auto', fontSize:10, fontWeight:800, color:'#64748b', background:'#f1f5f9', padding:'3px 10px', borderRadius:99}}>
                        {s.accountable}
                      </span>
                    </div>
                    <div style={{fontSize:12, color:'#475569', marginBottom:6}}>{s.diagnose(s.cur)}</div>
                    <div style={{fontSize:12, fontWeight:700, color:'#1d4ed8', background:'#eff6ff', borderRadius:7, padding:'8px 12px'}}>
                      → {s.action}
                    </div>
                    <button onClick={()=>{setSelStage(s.key); setView('funnel'); window.scrollTo({top:0,behavior:'smooth'})}}
                      style={{marginTop:8, padding:'4px 12px', borderRadius:6, background:'white', border:'1px solid #e2e8f0',
                        color:'#64748b', fontSize:11, fontWeight:700, cursor:'pointer'}}>
                      See detail & who's responsible →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ── TRENDS VIEW ── */
        <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'16px 18px'}}>
          <div style={{fontSize:11, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:4}}>
            FUNNEL STAGE TRENDS — {selOffice==='all'?'All Offices':selOffice}
          </div>
          <div style={{fontSize:11, color:'#94a3b8', marginBottom:14}}>Each stage over time. Watch for downward slopes — that's where leakage is starting.</div>
          {FUNNEL_STAGES.map(stage => {
            const inScope = r => (selOffice==='all' || r.office===selOffice)
            const reps = reports.filter(r => inScope(r) && r.date>=cutoff && r.date<=today)
              .sort((a,b)=>a.date.localeCompare(b.date))
            // Group by date
            const byDate = {}
            reps.forEach(r => {
              if (!byDate[r.date]) byDate[r.date] = { num:0, den:0 }
              byDate[r.date].num += stage.num(r); byDate[r.date].den += stage.den(r)
            })
            const points = Object.entries(byDate).map(([d,v]) => ({
              label:d.slice(5), value:v.den>0?v.num/v.den*100:null,
            }))
            const sd = stageData.find(s=>s.key===stage.key)
            return (
              <div key={stage.key} style={{marginBottom:18, paddingBottom:18, borderBottom:'1px solid #f1f5f9'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8}}>
                  <span style={{fontSize:14}}>{stage.icon}</span>
                  <span style={{fontSize:12, fontWeight:800, color:'#1e293b'}}>{stage.label}</span>
                  {sd?.flagged && <span style={{fontSize:9, fontWeight:800, color:'#dc2626', background:'#fee2e2', padding:'2px 8px', borderRadius:99}}>⚠ FLAGGED</span>}
                  <span style={{marginLeft:'auto', fontSize:14, fontWeight:800, color:stColor(sd?.cur, stage.bm, false)}}>
                    {sd?.cur!=null?Math.round(sd.cur)+'%':'—'}
                  </span>
                </div>
                <PillarChart fmt="%" height={130}
                  series={[{ label:stage.label, color:sd?.flagged?'#dc2626':'#1d4ed8', benchmark:stage.bm, points }]}/>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}



// ═══════════════════════════════════════════════════════════════════════════
// TAB 4 — PROVIDER PRODUCTION
// ═══════════════════════════════════════════════════════════════════════════

// All available columns for provider table
const PROV_COLS = [
  { key:'name',        label:'Provider',          always:true,  fmt:'str' },
  { key:'office',      label:'Office',            always:false, fmt:'str' },
  { key:'prod',        label:'Production',        always:true,  fmt:'$'   },
  { key:'goal',        label:'Goal',              always:false, fmt:'$'   },
  { key:'variance',    label:'Variance',          always:false, fmt:'$'   },
  { key:'pct',         label:'% of Goal',         always:false, fmt:'%'   },
  { key:'days',        label:'Days Worked',       always:false, fmt:'#'   },
  { key:'avgDay',      label:'Avg / Day',         always:false, fmt:'$'   },
  { key:'consistency', label:'Consistency',       always:false, fmt:'%',  tip:'% of days goal was met' },
  { key:'highDay',     label:'Best Day',          always:false, fmt:'$'   },
  { key:'ptsSeen',     label:'Pts Seen',          always:false, fmt:'#'   },
  { key:'ptsPerDay',   label:'Pts / Day',         always:false, fmt:'#'   },
  { key:'npSched',     label:'NP Scheduled',      always:false, fmt:'#'   },
  { key:'npSeen',      label:'NP Seen',           always:false, fmt:'#'   },
  { key:'npShowRate',  label:'NP Show Rate',      always:false, fmt:'%'   },
]

const HYG_COLS = [
  { key:'name',        label:'Hygienist',         always:true,  fmt:'str' },
  { key:'office',      label:'Office',            always:false, fmt:'str' },
  { key:'prod',        label:'Production',        always:true,  fmt:'$'   },
  { key:'goal',        label:'Goal ($1,200/day)', always:false, fmt:'$'   },
  { key:'variance',    label:'Variance',          always:false, fmt:'$'   },
  { key:'pct',         label:'% of Goal',         always:false, fmt:'%'   },
  { key:'days',        label:'Days Worked',       always:false, fmt:'#'   },
  { key:'avgDay',      label:'Avg / Day',         always:false, fmt:'$'   },
  { key:'consistency', label:'Consistency',       always:false, fmt:'%',  tip:'% of days $1,200 goal was met' },
  { key:'highDay',     label:'Best Day',          always:false, fmt:'$'   },
  { key:'ptsSeen',     label:'Pts Seen',          always:false, fmt:'#'   },
  { key:'ptsPerDay',   label:'Pts / Day',         always:false, fmt:'#'   },
]

const DEFAULT_PROV_COLS = ['name','office','prod','goal','variance','pct','days','avgDay','consistency']
const DEFAULT_HYG_COLS  = ['name','office','prod','goal','pct','days','avgDay','consistency']

function fmtCell(val, fmt) {
  if (val === null || val === undefined || val === '') return '—'
  if (fmt === '$') return '$' + Math.round(N(val)).toLocaleString()
  if (fmt === '%') return N(val).toFixed(1) + '%'
  if (fmt === '#') return Math.round(N(val)).toLocaleString()
  return val
}

function SortTh2({ col, sort, setSort, children, style }) {
  const active = sort.key === col
  return (
    <th onClick={() => setSort(s => ({ key: col, dir: s.key === col && s.dir === 'desc' ? 'asc' : 'desc' }))}
      style={{ padding:'10px 12px', textAlign:'left', fontSize:10, fontWeight:800, color: active?'#1d4ed8':'#64748b',
        letterSpacing:.5, cursor:'pointer', userSelect:'none', whiteSpace:'nowrap', background:'#f8fafc',
        borderBottom:'2px solid '+(active?'#1d4ed8':'#e2e8f0'), ...style }}>
      {children} {active ? (sort.dir==='asc'?'↑':'↓') : <span style={{opacity:.3}}>↕</span>}
    </th>
  )
}

// ── Build per-provider stats from reports ──────────────────────────────────
function buildProviderStats(reports, providers, isHyg = false) {
  const statMap = {}

  for (const r of reports) {
    const office = r.office

    if (!isHyg) {
      // Provider stats — from r.providers[]
      for (const rp of (r.providers || [])) {
        if (!rp.doctorId) continue
        const pv = providers.find(p => p.id === rp.doctorId)
        if (!pv) continue
        const key = pv.id + '|' + office
        if (!statMap[key]) statMap[key] = {
          id: pv.id, name: pv.name||'Unknown', office, dailyGoal: N(pv.goal),
          prod:0, days:0, goalDays:0, highDay:0, ptsSeen:0, npSched:0, npSeen:0,
          dailyGoalTotal: 0,
        }
        const s   = statMap[key]
        const prd = N(rp.netProd)
        if (prd > 0) {
          s.prod        += prd
          s.days        += 1
          s.dailyGoalTotal += s.dailyGoal
          if (prd >= s.dailyGoal && s.dailyGoal > 0) s.goalDays++
          if (prd > s.highDay) s.highDay = prd
        }
        s.ptsSeen += N(rp.ptsSeen)
        s.npSched += N(rp.npSched)
        s.npSeen  += N(rp.npSeen)
      }
    } else {
      // Hygiene stats — from r.hygiene[]
      for (const rh of (r.hygiene || [])) {
        if (!rh.name || !rh.name.trim()) continue
        const key = rh.name.trim() + '|' + office
        if (!statMap[key]) statMap[key] = {
          id: key, name: rh.name.trim(), office, dailyGoal: 1200,
          prod:0, days:0, goalDays:0, highDay:0, ptsSeen:0, dailyGoalTotal:0,
        }
        const s   = statMap[key]
        const prd = N(rh.netProd)
        if (prd > 0) {
          s.prod        += prd
          s.days        += 1
          s.dailyGoalTotal += 1200
          if (prd >= 1200) s.goalDays++
          if (prd > s.highDay) s.highDay = prd
        }
        s.ptsSeen += N(rh.ptsSeen)
      }
    }
  }

  return Object.values(statMap).map(s => ({
    ...s,
    goal:        s.dailyGoalTotal,
    variance:    s.prod - s.dailyGoalTotal,
    pct:         s.dailyGoalTotal > 0 ? s.prod / s.dailyGoalTotal * 100 : null,
    avgDay:      s.days > 0 ? s.prod / s.days : 0,
    consistency: s.days > 0 ? s.goalDays / s.days * 100 : null,
    ptsPerDay:   s.days > 0 ? s.ptsSeen  / s.days : 0,
    npShowRate:  s.npSched > 0 ? s.npSeen / s.npSched * 100 : null,
  }))
}

// ── Column chooser ─────────────────────────────────────────────────────────
function ColChooser({ allCols, visible, setVisible, label }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{position:'relative'}}>
      <button onClick={() => setOpen(o => !o)}
        style={{padding:'7px 12px', borderRadius:8, border:'1px solid #e2e8f0', background:'white',
          fontSize:12, fontWeight:600, color:'#475569', cursor:'pointer', display:'flex', alignItems:'center', gap:5}}>
        ⚙ Columns <span style={{fontSize:10, color:'#94a3b8'}}>({visible.length} shown)</span>
      </button>
      {open && (
        <div style={{position:'absolute', top:'calc(100% + 6px)', right:0, background:'white', border:'1px solid #e2e8f0',
          borderRadius:10, padding:'12px 14px', zIndex:100, minWidth:220, boxShadow:'0 4px 20px rgba(0,0,0,.1)'}}>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:8}}>{label} COLUMNS</div>
          {allCols.filter(c => !c.always).map(c => (
            <label key={c.key} style={{display:'flex', alignItems:'center', gap:8, padding:'4px 0', cursor:'pointer', fontSize:12}}>
              <input type="checkbox"
                checked={visible.includes(c.key)}
                onChange={e => setVisible(prev =>
                  e.target.checked ? [...prev, c.key] : prev.filter(k => k !== c.key)
                )}/>
              <span style={{color:'#1e293b', fontWeight:500}}>{c.label}</span>
              {c.tip && <span style={{fontSize:10, color:'#94a3b8'}}>{c.tip}</span>}
            </label>
          ))}
          <button onClick={() => setOpen(false)}
            style={{marginTop:10, width:'100%', padding:'6px', borderRadius:6, background:'#1d4ed8',
              color:'white', border:'none', fontSize:12, fontWeight:700, cursor:'pointer'}}>
            Done
          </button>
        </div>
      )}
    </div>
  )
}

// ── Provider profile panel ─────────────────────────────────────────────────
function ProviderProfile({ stat, reports, providers, isHyg, onClose, onEdit }) {
  const [range, setRange] = useState('30')
  const today = todayStr()

  const cutoff = useMemo(() => {
    const d = new Date(today); d.setDate(d.getDate() - parseInt(range))
    return d.toISOString().slice(0, 10)
  }, [range, today])

  // Daily production for this provider at this office
  const dailyPoints = useMemo(() => {
    const reps = reports.filter(r =>
      r.office === stat.office && r.date >= cutoff && r.date <= today
    ).sort((a, b) => a.date.localeCompare(b.date))

    return reps.map(r => {
      let val = 0
      if (!isHyg) {
        const rp = (r.providers || []).find(p => p.doctorId === stat.id)
        val = N(rp?.netProd || 0)
      } else {
        const rh = (r.hygiene || []).find(h => h.name?.trim() === stat.name)
        val = N(rh?.netProd || 0)
      }
      return { label: r.date.slice(5), value: val > 0 ? val : null }
    }).filter(p => p.value !== null)
  }, [reports, stat, cutoff, today, isHyg])

  // Monthly breakdown
  const monthly = useMemo(() => {
    const months = {}
    const reps = reports.filter(r => r.office === stat.office)
    for (const r of reps) {
      const mo = r.date.slice(0, 7)
      if (!months[mo]) months[mo] = { prod: 0, days: 0, goalDays: 0 }
      if (!isHyg) {
        const rp = (r.providers || []).find(p => p.doctorId === stat.id)
        const prd = N(rp?.netProd || 0)
        if (prd > 0) { months[mo].prod += prd; months[mo].days++; if (prd >= stat.dailyGoal) months[mo].goalDays++ }
      } else {
        const rh = (r.hygiene || []).find(h => h.name?.trim() === stat.name)
        const prd = N(rh?.netProd || 0)
        if (prd > 0) { months[mo].prod += prd; months[mo].days++; if (prd >= 1200) months[mo].goalDays++ }
      }
    }
    return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)
  }, [reports, stat, isHyg])

  const color = '#1d4ed8'

  return (
    <div style={{position:'fixed', top:0, right:0, bottom:0, width:'min(520px,100vw)',
      background:'white', boxShadow:'-4px 0 30px rgba(0,0,0,.15)', zIndex:200,
      display:'flex', flexDirection:'column', overflow:'hidden'}}>

      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', padding:'20px 24px', flexShrink:0}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
          <div>
            <div style={{fontSize:10, color:'rgba(255,255,255,.6)', fontWeight:700, letterSpacing:1, marginBottom:4}}>
              {isHyg ? 'HYGIENIST' : 'PROVIDER'} PROFILE
            </div>
            <div style={{fontSize:20, fontWeight:800, color:'white'}}>{stat.name}</div>
            <div style={{fontSize:12, color:'rgba(255,255,255,.7)', marginTop:2}}>{stat.office}</div>
          </div>
          <button onClick={onClose}
            style={{background:'rgba(255,255,255,.15)', border:'none', borderRadius:8,
              color:'white', padding:'6px 12px', cursor:'pointer', fontSize:13, fontWeight:700}}>
            ✕ Close
          </button>
        </div>

        {/* Key stats strip — computed live from current range */}
        {(() => {
          const repsInRange = reports.filter(r =>
            r.office === stat.office && r.date >= cutoff && r.date <= today
          )
          let totalProd = 0, daysWorked = 0, goalDays = 0
          const dailyGoal = isHyg ? 1200 : stat.dailyGoal
          for (const r of repsInRange) {
            let prod = 0
            if (!isHyg) {
              const rp = (r.providers||[]).find(p => p.doctorId === stat.id)
              prod = N(rp?.netProd||0)
            } else {
              const rh = (r.hygiene||[]).find(h => h.name?.trim()===stat.name)
              prod = N(rh?.netProd||0)
            }
            if (prod > 0) { totalProd += prod; daysWorked++; if (dailyGoal && prod >= dailyGoal) goalDays++ }
          }
          const totalGoal = dailyGoal * daysWorked
          const pct = totalGoal > 0 ? Math.round(totalProd/totalGoal*100) : 0
          const avgDay = daysWorked > 0 ? Math.round(totalProd/daysWorked) : 0
          const consistency = daysWorked > 0 ? Math.round(goalDays/daysWorked*100) : 0
          return (
            <div style={{display:'flex', gap:16, marginTop:16, flexWrap:'wrap'}}>
              {[
                ['Production', fmtCell(totalProd, '$')],
                ['Goal', fmtCell(totalGoal, '$')],
                ['% of Goal', fmtCell(pct, '%')],
                ['Avg/Day', fmtCell(avgDay, '$')],
                ['Days Worked', daysWorked],
                ['Consistency', fmtCell(consistency, '%')],
              ].map(([l, v]) => (
                <div key={l}>
                  <div style={{fontSize:9, color:'rgba(255,255,255,.5)', fontWeight:700, letterSpacing:.5}}>{l}</div>
                  <div style={{fontSize:15, fontWeight:800, color:'white'}}>{v}</div>
                </div>
              ))}
            </div>
          )
        })()}
      </div>

      <div style={{flex:1, overflow:'auto', padding:'20px 24px'}}>

        {/* Range selector */}
        <div style={{display:'flex', gap:4, marginBottom:16}}>
          {[['7','7D'],['14','14D'],['30','30D'],['60','60D'],['90','90D']].map(([v,l]) => (
            <button key={v} onClick={() => setRange(v)}
              style={{padding:'5px 10px', borderRadius:6, border:'1px solid '+(range===v?'#1d4ed8':'#e2e8f0'),
                background:range===v?'#1d4ed8':'white', color:range===v?'white':'#64748b',
                fontWeight:600, fontSize:11, cursor:'pointer'}}>
              {l}
            </button>
          ))}
        </div>

        {/* Production trend */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11, fontWeight:800, color:'#1e293b', marginBottom:8}}>DAILY PRODUCTION</div>
          {dailyPoints.length === 0 ? (
            <div style={{textAlign:'center', padding:30, color:'#94a3b8', fontSize:13}}>No data for this period</div>
          ) : (
            <LineChart height={180} series={[{ label: stat.name, color, fmt:'$', points: dailyPoints }]} showLegend={false}/>
          )}
          {stat.dailyGoal > 0 && (
            <div style={{fontSize:11, color:'#94a3b8', marginTop:4}}>
              Daily goal: {fmtCell(stat.dailyGoal, '$')} · Best day: {fmtCell(stat.highDay, '$')}
            </div>
          )}
        </div>

        {/* Daily breakdown — find and fix individual reports */}
        <div style={{marginBottom:20}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div style={{fontSize:11,fontWeight:800,color:'#1e293b'}}>DAILY BREAKDOWN</div>
            {onEdit && <div style={{fontSize:10,color:'#94a3b8'}}>Click Edit to fix incorrect numbers</div>}
          </div>
          {(() => {
            const reps = reports.filter(r =>
              r.office === stat.office && r.date >= cutoff && r.date <= today
            ).sort((a,b) => b.date.localeCompare(a.date))
            if (!reps.length) return <div style={{textAlign:'center',padding:20,color:'#94a3b8',fontSize:12}}>No reports in this period</div>
            return (
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'#f8fafc'}}>
                    {['Date','Production','Goal','vs Goal',''].map(h=>(
                      <th key={h} style={{padding:'6px 10px',textAlign:'left',fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reps.map((r,i) => {
                    let prod = 0, goal = 0
                    if (!isHyg) {
                      const rp = (r.providers||[]).find(p => p.doctorId === stat.id)
                      prod = N(rp?.netProd||0)
                      const pv = providers.find(p => p.id === stat.id)
                      goal = pv ? N(pv.goal) : 0
                    } else {
                      const rh = (r.hygiene||[]).find(h => h.name?.trim()===stat.name)
                      prod = N(rh?.netProd||0)
                      goal = 1200
                    }
                    const vsGoal = goal > 0 ? Math.round(prod/goal*100) : null
                    const isSuspect = prod > goal * 3 && prod > 5000
                    return (
                      <tr key={r.id||r.date} style={{borderTop:'1px solid #f8fafc',
                        background:isSuspect?'#fff7ed':i%2===0?'white':'#fafafa'}}>
                        <td style={{padding:'7px 10px',color:'#64748b'}}>
                          {r.date}
                          {isSuspect && <span style={{marginLeft:6,fontSize:10,fontWeight:700,color:'#d97706',background:'#fef9c3',padding:'1px 6px',borderRadius:4}}>⚠ Check</span>}
                        </td>
                        <td style={{padding:'7px 10px',fontWeight:700,color:isSuspect?'#dc2626':'#1d4ed8'}}>
                          {prod>0?'$'+prod.toLocaleString():'—'}
                        </td>
                        <td style={{padding:'7px 10px',color:'#94a3b8'}}>{goal>0?'$'+goal.toLocaleString():'—'}</td>
                        <td style={{padding:'7px 10px'}}>
                          {vsGoal!==null && (
                            <span style={{fontWeight:700,color:vsGoal>=85?'#16a34a':vsGoal>=50?'#d97706':'#dc2626'}}>
                              {vsGoal}%
                            </span>
                          )}
                        </td>
                        <td style={{padding:'7px 6px',textAlign:'right'}}>
                          {onEdit && (
                            <button onClick={()=>{onEdit(r);onClose()}}
                              style={{padding:'3px 10px',borderRadius:6,background:'#1d4ed8',color:'white',
                                border:'none',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })()}
        </div>

        {/* Monthly breakdown table */}
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11, fontWeight:800, color:'#1e293b', marginBottom:8}}>MONTHLY BREAKDOWN</div>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <thead>
              <tr style={{background:'#f8fafc'}}>
                {['Month','Production','Days','Avg/Day','Consistency'].map(h => (
                  <th key={h} style={{padding:'8px 10px', textAlign:'left', fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:.5}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthly.map(([mo, d], i) => (
                <tr key={mo} style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                  <td style={{padding:'8px 10px', fontSize:13, fontWeight:600, color:'#1e293b'}}>
                    {new Date(mo+'-15').toLocaleString('en-US',{month:'short',year:'numeric'})}
                  </td>
                  <td style={{padding:'8px 10px', fontSize:13, fontWeight:700, color:'#1d4ed8'}}>{fmtCell(d.prod,'$')}</td>
                  <td style={{padding:'8px 10px', fontSize:13, color:'#475569'}}>{d.days}</td>
                  <td style={{padding:'8px 10px', fontSize:13, color:'#475569'}}>{d.days>0?fmtCell(d.prod/d.days,'$'):'—'}</td>
                  <td style={{padding:'8px 10px', fontSize:13}}>
                    <span style={{fontWeight:700, color:d.days>0&&d.goalDays/d.days>=0.8?'#16a34a':'#d97706'}}>
                      {d.days > 0 ? Math.round(d.goalDays/d.days*100)+'%' : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Additional stats */}
        {!isHyg && (stat.npSched > 0 || stat.ptsSeen > 0) && (
          <div>
            <div style={{fontSize:11, fontWeight:800, color:'#1e293b', marginBottom:8}}>PATIENT STATS</div>
            <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
              {[
                ['Total Pts Seen',  stat.ptsSeen,     '#'],
                ['Pts / Day',       stat.ptsPerDay,   '#'],
                ['NP Scheduled',    stat.npSched,     '#'],
                ['NP Seen',         stat.npSeen,      '#'],
                ['NP Show Rate',    stat.npShowRate,  '%'],
              ].filter(([,v]) => v > 0).map(([l, v, fmt]) => (
                <div key={l} style={{background:'#f8fafc', borderRadius:8, padding:'10px 12px'}}>
                  <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:3}}>{l}</div>
                  <div style={{fontSize:18, fontWeight:800, color:'#1e293b'}}>{fmtCell(v, fmt)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sortable production table ──────────────────────────────────────────────
function ProdTable({ stats, allCols, defaultCols, isHyg, reports, providers, onEdit }) {
  const [visibleCols, setVisibleCols] = useState(defaultCols)
  const [sort,        setSort]        = useState({ key: 'prod', dir: 'desc' })
  const [profile,     setProfile]     = useState(null)

  const cols = allCols.filter(c => c.always || visibleCols.includes(c.key))

  const sorted = useMemo(() => {
    return [...stats].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      if (typeof av === 'string') return sort.dir==='asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? N(av) - N(bv) : N(bv) - N(av)
    })
  }, [stats, sort])

  if (!stats.length) return (
    <div style={{textAlign:'center', padding:30, color:'#94a3b8', fontSize:13}}>
      No data for this period
    </div>
  )

  return (
    <div style={{position:'relative'}}>
      <div style={{display:'flex', justifyContent:'flex-end', marginBottom:8}}>
        <ColChooser allCols={allCols} visible={visibleCols} setVisible={setVisibleCols}
          label={isHyg ? 'HYGIENIST' : 'PROVIDER'}/>
      </div>
      <div style={{overflowX:'auto', borderRadius:10, border:'1px solid #e2e8f0'}}>
        <table style={{width:'100%', borderCollapse:'collapse', minWidth:400}}>
          <thead>
            <tr>
              {cols.map(c => (
                <SortTh2 key={c.key} col={c.key} sort={sort} setSort={setSort}>
                  {c.label}
                </SortTh2>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((s, i) => (
              <tr key={s.id+s.office} style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                {cols.map(c => (
                  <td key={c.key} style={{padding:'10px 12px', fontSize:13,
                    fontWeight: c.key==='name'?700:c.key==='prod'?700:400,
                    color: c.key==='name'?'#1d4ed8':c.key==='variance'?N(s[c.key])>=0?'#16a34a':'#dc2626':'#1e293b',
                    cursor: c.key==='name'?'pointer':'default',
                    textDecoration: c.key==='name'?'underline':'none',
                    whiteSpace:'nowrap',
                  }}
                    onClick={c.key==='name' ? ()=>setProfile(s) : undefined}>
                    {c.fmt==='str' ? s[c.key] : fmtCell(s[c.key], c.fmt)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {/* Totals row */}
          <tfoot>
            <tr style={{background:'#1e293b', borderTop:'2px solid #334155'}}>
              {cols.map(c => {
                let val = '—'
                if (c.key==='name') val = `${sorted.length} total`
                else if (c.fmt==='$') val = fmtCell(sorted.reduce((s,r)=>s+N(r[c.key]),0), '$')
                else if (c.key==='days') val = sorted.reduce((s,r)=>s+N(r[c.key]),0)
                else if (c.fmt==='%' && c.key!=='consistency') val = ''
                return (
                  <td key={c.key} style={{padding:'10px 12px', fontSize:12, fontWeight:800,
                    color:c.key==='variance'?sorted.reduce((s,r)=>s+N(r.variance),0)>=0?'#86efac':'#fca5a5':'white'}}>
                    {val}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Profile panel */}
      {profile && (
        <>
          <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.3)',zIndex:199}}
            onClick={()=>setProfile(null)}/>
          <ProviderProfile stat={profile} reports={reports} providers={providers}
            isHyg={isHyg} onClose={()=>setProfile(null)} onEdit={onEdit}/>
        </>
      )}
    </div>
  )
}

// ── Main ProviderTab ───────────────────────────────────────────────────────
function ProviderTab({ reports, providers, user, isManager, onEdit }) {
  const today   = todayStr()
  const isAdmin = user?.role === 'admin'

  const [range,       setRange]       = useState('30')
  const [customStart, setCustomStart] = useState(monthStart())
  const [customEnd,   setCustomEnd]   = useState(today)
  const [viewOffice,  setViewOffice]  = useState('all')  // Always start with all offices so numbers are visible

  const cutoff = useMemo(() => {
    if (range === 'custom') return customStart
    const d = new Date(today); d.setDate(d.getDate() - parseInt(range))
    return d.toISOString().slice(0, 10)
  }, [range, customStart, today])

  const endDate = range === 'custom' ? customEnd : today

  const filteredReps = useMemo(() =>
    reports.filter(r =>
      r.date >= cutoff && r.date <= endDate &&
      (viewOffice === 'all' || r.office === viewOffice)
    ), [reports, cutoff, endDate, viewOffice])

  const provStats = useMemo(() => buildProviderStats(filteredReps, providers, false), [filteredReps, providers])
  const hygStats  = useMemo(() => buildProviderStats(filteredReps, providers, true),  [filteredReps, providers])

  return (
    <div>
      {/* Controls */}
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'14px 18px',marginBottom:16}}>
        <div style={{display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>

          <div>
              <div style={{fontSize:10,fontWeight:800,color:'#94a3b8',letterSpacing:1,marginBottom:4}}>OFFICE</div>
              <select value={viewOffice} onChange={e=>setViewOffice(e.target.value)}
                style={{padding:'7px 10px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,fontWeight:600}}>
                <option value="all">All Offices</option>
                {OFFICES.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>

          <div>
            <div style={{fontSize:10,fontWeight:800,color:'#94a3b8',letterSpacing:1,marginBottom:4}}>TIME RANGE</div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {[['7','7D'],['14','14D'],['30','30D'],['60','60D'],['90','90D'],['custom','Custom']].map(([v,l])=>(
                <button key={v} onClick={()=>setRange(v)}
                  style={{padding:'6px 10px',borderRadius:7,border:'1px solid '+(range===v?'#1d4ed8':'#e2e8f0'),
                    background:range===v?'#1d4ed8':'white',color:range===v?'white':'#64748b',
                    fontWeight:600,fontSize:11,cursor:'pointer'}}>
                  {l}
                </button>
              ))}
            </div>
            {range==='custom'&&(
              <div style={{display:'flex',gap:6,alignItems:'center',marginTop:6}}>
                <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
                  style={{padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
                <span style={{fontSize:11,color:'#94a3b8'}}>to</span>
                <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
                  style={{padding:'5px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Provider table */}
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'16px 18px',marginBottom:20}}>
        <div style={{fontSize:13,fontWeight:800,color:'#1e293b',marginBottom:12}}>
          👨‍⚕️ Provider Production
          <span style={{fontSize:11,color:'#94a3b8',fontWeight:400,marginLeft:8}}>
            Click a name to open their profile · Click column headers to sort
          </span>
        </div>
        <ProdTable stats={provStats} allCols={PROV_COLS} defaultCols={DEFAULT_PROV_COLS}
          isHyg={false} reports={reports} providers={providers} onEdit={onEdit}/>
      </div>

      {/* Hygiene table */}
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'16px 18px'}}>
        <div style={{fontSize:13,fontWeight:800,color:'#1e293b',marginBottom:12}}>
          🦷 Hygiene Production
          <span style={{fontSize:11,color:'#94a3b8',fontWeight:400,marginLeft:8}}>
            Click a name to open their profile · Click column headers to sort
          </span>
        </div>
        <ProdTable stats={hygStats} allCols={HYG_COLS} defaultCols={DEFAULT_HYG_COLS}
          isHyg={true} reports={reports} providers={providers} onEdit={onEdit}/>
      </div>
    </div>
  )
}


// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
export default function AnalyticsPage({ reports, providers, notify, users, user, isManager, onEdit }) {
  const [tab,       setTab]       = useState('performance')
  const [selOffice, setSelOffice] = useState(null)
  const OFFICES_LIST = ['Brainerd','Calhoun','Dalton','McCallie']
  const TABS = [
    { id:'performance', label:'📈 Performance' },
    { id:'comparison',  label:'⚖ Compare Periods' },
    { id:'pillars',     label:'🔻 Schedule Leakage' },
    { id:'providers',   label:'👨‍⚕️ Provider Production' },
  ]

  if (selOffice) {
    return <OfficeDetail office={selOffice} reports={reports} providers={providers} onBack={()=>setSelOffice(null)} onEdit={onEdit}/>
  }

  return (
    <div style={{maxWidth:1200, margin:'0 auto', padding:'24px 20px 60px'}}>
      <div style={{marginBottom:20}}>
        <h1 style={{fontSize:22, fontWeight:800, color:'#1e293b', margin:0}}>Analytics</h1>
        <p style={{color:'#94a3b8', fontSize:13, marginTop:3}}>Production · Collections · Pillar tracking · Performance trends</p>
      </div>
      <div style={{display:'flex', gap:4, background:'white', padding:4, borderRadius:12, border:'1px solid #e2e8f0', marginBottom:20}}>
        {TABS.map(t => (
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:'9px 20px', borderRadius:9, border:'none', cursor:'pointer', fontSize:13, fontWeight:600, flex:1,
              background: tab===t.id ? '#1d4ed8' : 'transparent', color: tab===t.id ? 'white' : '#64748b'}}>
            {t.label}
          </button>
        ))}
      </div>
      {tab==='performance' && <PerformanceTab reports={reports} providers={providers} user={user} isManager={isManager} onOfficeClick={setSelOffice}/>}
      {tab==='comparison'  && <ComparisonTab  reports={reports} providers={providers} user={user} isManager={isManager}/>}
      {tab==='providers'   && <ProviderTab    reports={reports} providers={providers} user={user} isManager={isManager} onEdit={onEdit}/>}
      {tab==='pillars'     && <PillarsTab     reports={reports} providers={providers} users={users} onEdit={onEdit}/>}
    </div>
  )
}
