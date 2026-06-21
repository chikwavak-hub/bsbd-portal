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

function PillarsTab({ reports, providers, users }) {
  const [days,     setDays]     = useState(30)
  const [expanded, setExpanded] = useState(null)

  const today  = todayStr()
  const cutoff = useMemo(() => { const d=new Date(today); d.setDate(d.getDate()-days); return d.toISOString().slice(0,10) }, [days, today])
  const mgrs   = useMemo(() => { const m={}; OFFICES.forEach(o => { const u=(users||[]).find(u=>u.office===o&&u.role==='manager'); m[o]=u?u.name:'—' }); return m }, [users])

  const pillDefs = [
    { key:'showRate',    label:'Show Rate',          bm:BM.showRate,    inv:false, fn:or=>{const on=or.reduce((s,r)=>s+N(r.sched?.ptsOnSched),0);const sw=or.reduce((s,r)=>s+N(r.sched?.ptsShowUp),0);return on>0?sw/on*100:null} },
    { key:'recallConv',  label:'Recall Conversion',  bm:BM.recallConv,  inv:false, fn:or=>{const m=or.reduce((s,r)=>s+N(r.sched?.recalls),0);const s2=or.reduce((s,r)=>s+N(r.sched?.recallsSched),0);return m>0?s2/m*100:null} },
    { key:'callConv',    label:'NP Call Conv',        bm:BM.callConv,    inv:false, fn:or=>{const c=or.reduce((s,r)=>s+N(r.sched?.npCalls),0);const s2=or.reduce((s,r)=>s+N(r.sched?.npCallsSched),0);return c>0?s2/c*100:null} },
    { key:'npShowRate',  label:'NP Show Rate',        bm:BM.npShowRate,  inv:false, fn:or=>{const on=or.reduce((s,r)=>s+N(r.sched?.npOnSched),0);const sw=or.reduce((s,r)=>s+N(r.sched?.npShowed),0);return on>0?sw/on*100:null} },
    { key:'txAccRate',   label:'TX Acceptance',       bm:BM.txAccRate,   inv:false, fn:or=>{const p=or.reduce((s,r)=>s+Object.values(r.fd||{}).reduce((a,f)=>a+N(f?.npTxPres),0),0);const a=or.reduce((s,r)=>s+Object.values(r.fd||{}).reduce((a,f)=>a+N(f?.npTxAcc),0),0);return p>0?a/p*100:null} },
    { key:'collRate',    label:'Collection Rate',     bm:BM.collRate,    inv:false, fn:or=>{const p=or.reduce((s,r)=>s+repProd(r),0);const c=or.reduce((s,r)=>s+repColl(r),0);return p>0?c/p*100:null} },
    { key:'prodVsGoal',  label:'Prod vs Goal',        bm:90,             inv:false, fn:(or,pvs)=>{const g=or.reduce((s,r)=>s+repGoal(r,pvs),0);const p=or.reduce((s,r)=>s+repProd(r),0);return g>0?p/g*100:null} },
    { key:'noShowRate',  label:'No-Show Rate',        bm:BM.noShowMax,   inv:true,  fn:or=>{const on=or.reduce((s,r)=>s+N(r.sched?.ptsOnSched),0);const ns=or.reduce((s,r)=>s+N(r.sched?.noShows),0);return on>0?ns/on*100:null} },
  ]

  const officeData = useMemo(() => OFFICES.map(o => {
    const or = reports.filter(r => r.office===o && r.date>=cutoff && r.date<=today)
    const pills = pillDefs.map(p => ({ ...p, val: p.fn(or, providers) }))
    const sts   = pills.map(p => status(p.val, p.bm, p.inv))
    const red   = sts.filter(s=>s==='red').length
    const amb   = sts.filter(s=>s==='amber').length
    const overall = red>1?'red':red===1||amb>1?'amber':amb===1?'amber':'green'
    return { o, pills, overall, red, amb, mgr: mgrs[o], or }
  }), [reports, providers, cutoff, today, mgrs, days])

  return (
    <div>
      {/* Rolling avg selector */}
      <div style={{display:'flex', gap:6, marginBottom:16, alignItems:'center'}}>
        <span style={{fontSize:11, fontWeight:700, color:'#64748b'}}>Rolling average:</span>
        {[[14,'14 days'],[30,'30 days'],[60,'60 days'],[90,'90 days']].map(([d,l]) => (
          <button key={d} onClick={()=>setDays(d)}
            style={{padding:'6px 12px', borderRadius:7, border:'1px solid '+(days===d?'#1d4ed8':'#e2e8f0'),
              background:days===d?'#1d4ed8':'white', color:days===d?'white':'#64748b',
              fontWeight:600, fontSize:11, cursor:'pointer'}}>
            {l}
          </button>
        ))}
        <span style={{fontSize:11, color:'#94a3b8', marginLeft:4}}>Benchmarks are placeholders — update as targets are confirmed</span>
      </div>

      {officeData.map(({ o, pills, overall, red, amb, mgr, or }) => {
        const os = SS[overall]
        const isExp = expanded === o
        return (
          <div key={o} style={{border:`2px solid ${os.border}`, borderRadius:14, overflow:'hidden', marginBottom:14}}>
            <div style={{background:os.bg, padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer'}}
              onClick={() => setExpanded(isExp ? null : o)}>
              <div>
                <div style={{fontSize:15, fontWeight:800, color:'#1e293b'}}>{o}</div>
                <div style={{fontSize:12, color:'#64748b', marginTop:2}}>Manager: <b>{mgr}</b></div>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:10}}>
                {red>0 && <span style={{fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99, background:'#fee2e2', color:'#dc2626'}}>{red} need action</span>}
                {amb>0 && <span style={{fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99, background:'#fef3c7', color:'#d97706'}}>{amb} to watch</span>}
                {isExp ? <IcoChevU size={14} style={{color:'#94a3b8'}}/> : <IcoChevD size={14} style={{color:'#94a3b8'}}/>}
              </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:1, background:'#e2e8f0'}}>
              {pills.map(p => {
                const st = status(p.val, p.bm, p.inv)
                const ss = SS[st]
                const diff = p.val !== null ? (p.inv ? p.bm - p.val : p.val - p.bm) : null
                return (
                  <div key={p.key} style={{background:'white', padding:'12px 14px', cursor:'pointer'}}
                    onClick={() => setExpanded(isExp && expanded===o ? null : o)}>
                    <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:1, marginBottom:4}}>{p.label.toUpperCase()}</div>
                    <div style={{display:'flex', alignItems:'flex-end', gap:6}}>
                      <div style={{fontSize:20, fontWeight:800, color:p.val!==null?ss.color:'#cbd5e1'}}>
                        {p.val!==null ? p.val.toFixed(1)+'%' : '—'}
                      </div>
                      {diff!==null && <div style={{fontSize:10, fontWeight:700, color:diff>=0?'#16a34a':'#dc2626', marginBottom:3}}>{diff>=0?'▲':'▼'}{Math.abs(diff).toFixed(1)}%</div>}
                    </div>
                    <div style={{height:3, background:'#f1f5f9', borderRadius:2, overflow:'hidden', marginTop:6}}>
                      {p.val!==null && <div style={{height:'100%', borderRadius:2, background:ss.color, width:Math.min(p.inv?Math.max(0,100-p.val):p.val,100)+'%'}}/>}
                    </div>
                    <div style={{fontSize:9, color:'#94a3b8', marginTop:3}}>Target: {p.bm}%</div>
                  </div>
                )
              })}
            </div>

            {/* Expanded trend chart for this office */}
            {isExp && (
              <div style={{padding:'16px 20px', borderTop:'1px solid #e2e8f0', background:'white'}}>
                <div style={{fontSize:11, fontWeight:700, color:'#64748b', marginBottom:12}}>PILLAR TRENDS — {o} — Last {days} days</div>
                <LineChart height={200} series={[
                  { label:'Show Rate', color:C.teal,   fmt:'%', points: or.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({ label:r.date.slice(5), value:N(r.sched?.ptsOnSched)>0?N(r.sched?.ptsShowUp)/N(r.sched?.ptsOnSched)*100:null })) },
                  { label:'Coll Rate', color:C.blue,   fmt:'%', points: or.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({ label:r.date.slice(5), value:repProd(r)>0?repColl(r)/repProd(r)*100:null })) },
                  { label:'Prod/Goal', color:C.green,  fmt:'%', points: or.sort((a,b)=>a.date.localeCompare(b.date)).map(r=>({ label:r.date.slice(5), value:repGoal(r,providers)>0?repProd(r)/repGoal(r,providers)*100:null })) },
                ]}/>
              </div>
            )}
          </div>
        )
      })}
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
    { id:'pillars',     label:'🎯 Manager Pillars' },
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
      {tab==='pillars'     && <PillarsTab     reports={reports} providers={providers} users={users}/>}
    </div>
  )
}
