import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { N, USD, PCT, todayStr, monthStart, repGoal, repProd, repColl } from '../../lib/helpers'

const OFFICES = ['Brainerd','Calhoun','Dalton','McCallie']
const NAVY    = '#1e3a5f'
const BLUE    = '#1d4ed8'
const TEAL    = '#0d9488'
const GREEN   = '#16a34a'
const AMBER   = '#d97706'
const RED     = '#dc2626'
const PURPLE  = '#7c3aed'

// ── Helpers ────────────────────────────────────────────────────────────────
const fmtVal = (v, fmt) => {
  if (v === null || v === undefined || isNaN(v)) return '—'
  if (fmt === '$') return '$' + Math.round(v).toLocaleString()
  if (fmt === '%') return Math.round(v) + '%'
  return Math.round(v).toLocaleString()
}
const addDaysStr = (date, n) => {
  const d = new Date(date); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0,10)
}

// ── Interactive Line Chart ──────────────────────────────────────────────────
// Stock-market style: hover crosshair, tooltip with all series values, dot highlight
function InteractiveChart({ series, height = 220, fmt = '$' }) {
  const [hover, setHover] = useState(null) // { idx, x, y }
  const svgRef = useRef()

  const allPts = series.flatMap(s => s.points.map(p => p.value)).filter(v => v != null && v > 0)
  if (!allPts.length || !series.length) return (
    <div style={{height, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:12}}>
      No data for this period
    </div>
  )

  const labels = series[0].points.map(p => p.label)
  const W = 800, H = height
  const PAD = { top:20, right:20, bottom:28, left:58 }
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const minV = 0
  const maxV = Math.max(...allPts) * 1.12 || 1
  const xPos = i => PAD.left + (i / Math.max(labels.length - 1, 1)) * cW
  const yPos = v => PAD.top + cH - ((v - minV) / (maxV - minV)) * cH
  const yTicks = 4
  const yStep  = maxV / yTicks

  const handleMouseMove = useCallback(e => {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = W / rect.width
    const mx = (e.clientX - rect.left) * scaleX
    const dataX = mx - PAD.left
    const idx = Math.max(0, Math.min(labels.length - 1, Math.round((dataX / cW) * (labels.length - 1))))
    setHover({ idx })
  }, [labels.length, cW])

  const hoverSeries = hover !== null
    ? series.map(s => ({ label: s.label, color: s.color, value: s.points[hover.idx]?.value }))
    : null

  return (
    <div style={{position:'relative', userSelect:'none'}}>
      {/* Legend */}
      {series.length > 1 && (
        <div style={{display:'flex', gap:16, marginBottom:8, flexWrap:'wrap'}}>
          {series.map(s => (
            <div key={s.label} style={{display:'flex', alignItems:'center', gap:5, fontSize:11, color:'#64748b'}}>
              <div style={{width:16, height:3, borderRadius:2, background:s.color}}/>
              {s.label}
            </div>
          ))}
        </div>
      )}

      {/* Tooltip */}
      {hover !== null && hoverSeries && (
        <div style={{
          position:'absolute', top:0, left:Math.min(
            Math.max(10, (xPos(hover.idx) / W) * 100 - 8) + '%', 'calc(100% - 160px)'
          ),
          background:'white', border:'1px solid #e2e8f0', borderRadius:9,
          boxShadow:'0 4px 16px rgba(0,0,0,.1)', padding:'8px 12px', zIndex:10,
          minWidth:140, pointerEvents:'none'
        }}>
          <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:5, letterSpacing:.5}}>
            {labels[hover.idx]}
          </div>
          {hoverSeries.map(s => s.value != null && (
            <div key={s.label} style={{display:'flex', justifyContent:'space-between', gap:12, fontSize:12, marginBottom:2}}>
              <div style={{display:'flex', alignItems:'center', gap:5}}>
                <div style={{width:8, height:8, borderRadius:'50%', background:s.color, flexShrink:0}}/>
                <span style={{color:'#64748b'}}>{s.label}</span>
              </div>
              <span style={{fontWeight:800, color:'#1e293b'}}>{fmtVal(s.value, fmt)}</span>
            </div>
          ))}
        </div>
      )}

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{width:'100%', height, cursor:'crosshair'}}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={()=>setHover(null)}>

        {/* Grid */}
        {Array.from({length: yTicks + 1}).map((_, i) => {
          const v = yStep * i
          const y = yPos(v)
          return (
            <g key={i}>
              <line x1={PAD.left} y1={y} x2={W-PAD.right} y2={y} stroke="#f1f5f9" strokeWidth="1"/>
              <text x={PAD.left-6} y={y+4} textAnchor="end" fontSize="9" fill="#94a3b8">
                {fmtVal(v, fmt)}
              </text>
            </g>
          )
        })}

        {/* X labels */}
        {labels.map((l, i) => {
          if (labels.length > 14 && i % Math.ceil(labels.length / 14) !== 0) return null
          return <text key={i} x={xPos(i)} y={H-4} textAnchor="middle" fontSize="9" fill="#94a3b8">{l}</text>
        })}

        {/* Hover crosshair */}
        {hover !== null && (
          <line x1={xPos(hover.idx)} y1={PAD.top} x2={xPos(hover.idx)} y2={H-PAD.bottom}
            stroke="#94a3b8" strokeWidth="1" strokeDasharray="3,3"/>
        )}

        {/* Area fills (subtle) */}
        {series.map((s, si) => {
          const valid = s.points.map((p,i) => ({...p, i})).filter(p => p.value != null)
          if (!valid.length) return null
          const pathD = valid.map((p,j) => `${j===0?'M':'L'} ${xPos(p.i)} ${yPos(p.value)}`).join(' ')
          const areaD = pathD + ` L ${xPos(valid[valid.length-1].i)} ${yPos(0)} L ${xPos(valid[0].i)} ${yPos(0)} Z`
          return (
            <path key={si+'a'} d={areaD} fill={s.color} fillOpacity="0.06"/>
          )
        })}

        {/* Lines */}
        {series.map((s, si) => {
          const valid = s.points.map((p,i) => ({...p, i})).filter(p => p.value != null)
          if (!valid.length) return null
          const pathD = valid.map((p,j) => `${j===0?'M':'L'} ${xPos(p.i)} ${yPos(p.value)}`).join(' ')
          return <path key={si} d={pathD} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round"/>
        })}

        {/* Hover dots */}
        {hover !== null && series.map((s, si) => {
          const v = s.points[hover.idx]?.value
          if (v == null) return null
          return (
            <g key={si+'h'}>
              <circle cx={xPos(hover.idx)} cy={yPos(v)} r="5" fill="white" stroke={s.color} strokeWidth="2"/>
              <circle cx={xPos(hover.idx)} cy={yPos(v)} r="2.5" fill={s.color}/>
            </g>
          )
        })}

        {/* Regular dots (sparse) */}
        {series.map((s, si) =>
          s.points.map((p, i) => {
            if (p.value == null || (labels.length > 10 && hover?.idx !== i)) return null
            return <circle key={si+'-'+i} cx={xPos(i)} cy={yPos(p.value)} r="3" fill={s.color} fillOpacity="0.8"/>
          })
        )}
      </svg>
    </div>
  )
}

// ── Bar Chart with hover ───────────────────────────────────────────────────
function InteractiveBar({ groups, height = 180, fmt = '$', colors = [BLUE, TEAL] }) {
  const [hov, setHov] = useState(null)
  const allVals = groups.flatMap(g => g.values).filter(v => v != null && v > 0)
  if (!allVals.length) return <div style={{height, display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:12}}>No data</div>
  const maxV = Math.max(...allVals) * 1.1
  const barW = Math.max(8, Math.min(40, Math.floor(600 / groups.length / (groups[0]?.labels?.length || 1)) - 4))
  const gap  = Math.max(2, barW / 3)

  return (
    <div style={{display:'flex', alignItems:'flex-end', gap:gap, height, paddingBottom:20, position:'relative', overflowX:'auto'}}>
      {hov !== null && (
        <div style={{position:'absolute', top:0, left:0, background:'white', border:'1px solid #e2e8f0',
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
      {groups.map((g, gi) => (
        <div key={gi} style={{display:'flex', flexDirection:'column', alignItems:'center', flexShrink:0}}
          onMouseEnter={()=>setHov(gi)} onMouseLeave={()=>setHov(null)}>
          <div style={{display:'flex', alignItems:'flex-end', gap:2}}>
            {g.values.map((v, vi) => (
              <div key={vi} style={{
                width: barW,
                height: maxV > 0 ? Math.max(2, (N(v) / maxV) * (height - 20)) : 2,
                background: v != null && v > 0 ? colors[vi % colors.length] : '#f1f5f9',
                borderRadius:'3px 3px 0 0',
                opacity: hov === null || hov === gi ? 1 : 0.4,
                transition:'opacity .15s, height .2s',
              }}/>
            ))}
          </div>
          <div style={{fontSize:9, color:'#94a3b8', marginTop:3, textAlign:'center', maxWidth:barW*g.values.length+4}}>{g.label}</div>
        </div>
      ))}
    </div>
  )
}

// ── KPI tile ───────────────────────────────────────────────────────────────
function KpiTile({ label, value, sub, color = NAVY, accent, trend }) {
  return (
    <div style={{background:'white', borderRadius:12, padding:'14px 16px', border:'1px solid #e2e8f0',
      borderLeft: accent ? `4px solid ${accent}` : '1px solid #e2e8f0'}}>
      <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:4}}>{label}</div>
      <div style={{fontSize:22, fontWeight:800, color, lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:11, color:'#94a3b8', marginTop:4}}>{sub}</div>}
      {trend != null && (
        <div style={{fontSize:11, fontWeight:700, color: trend >= 0 ? GREEN : RED, marginTop:4}}>
          {trend >= 0 ? '↑' : '↓'} {Math.abs(Math.round(trend))}%
        </div>
      )}
    </div>
  )
}

// ── Chart card ─────────────────────────────────────────────────────────────
function ChartCard({ title, sub, children }) {
  return (
    <div style={{background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'16px 18px', marginBottom:16}}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:13, fontWeight:800, color:NAVY}}>{title}</div>
        {sub && <div style={{fontSize:11, color:'#94a3b8', marginTop:2}}>{sub}</div>}
      </div>
      {children}
    </div>
  )
}

// ── Main OfficeDetail page ─────────────────────────────────────────────────
export default function OfficeDetail({ office, reports, providers, onBack }) {
  const [range,       setRange]       = useState('30')
  const [customStart, setCustomStart] = useState(monthStart())
  const [customEnd,   setCustomEnd]   = useState(todayStr())
  const today = todayStr()

  const cutoff = useMemo(() => {
    if (range === 'custom') return customStart
    if (range === 'mtd')    return monthStart()
    const d = new Date(today); d.setDate(d.getDate() - parseInt(range))
    return d.toISOString().slice(0,10)
  }, [range, customStart, today])

  const endDate = range === 'custom' ? customEnd : today

  // Reports for this office in this range
  const reps = useMemo(() =>
    reports.filter(r =>
      r.office === office &&
      r.date >= cutoff &&
      r.date <= endDate
    ).sort((a,b) => a.date.localeCompare(b.date))
  , [reports, office, cutoff, endDate])

  // ── Summary KPIs ──
  const totals = useMemo(() => {
    const prod = reps.reduce((s,r) => s + repProd(r), 0)
    const goal = reps.reduce((s,r) => s + repGoal(r, providers), 0)
    const coll = reps.reduce((s,r) => s + repColl(r), 0)
    const days = reps.length
    const avgProd = days > 0 ? prod / days : 0
    const avgColl = days > 0 ? coll / days : 0
    const pct  = goal > 0 ? prod / goal * 100 : 0
    const collRate = prod > 0 ? coll / prod * 100 : 0
    const noShows = reps.reduce((s,r) => s + N(r.sched?.noShows), 0)
    const cancelled = reps.reduce((s,r) => s + N(r.sched?.cancelled), 0)
    const npSched = reps.reduce((s,r) => s + N(r.sched?.npScheduled), 0)
    const npShowed = reps.reduce((s,r) => s + N(r.sched?.npShowed), 0)
    return { prod, goal, coll, days, avgProd, avgColl, pct, collRate, noShows, cancelled, npSched, npShowed }
  }, [reps, providers])

  // ── Daily series for charts ──
  const daily = useMemo(() =>
    reps.map(r => ({
      label: r.date.slice(5), // MM-DD
      date: r.date,
      prod: repProd(r),
      goal: repGoal(r, providers),
      coll: repColl(r),
      collRate: repProd(r) > 0 ? repColl(r) / repProd(r) * 100 : 0,
      noShows: N(r.sched?.noShows),
      cancelled: N(r.sched?.cancelled),
      npSched: N(r.sched?.npScheduled),
      npShowed: N(r.sched?.npShowed),
    }))
  , [reps, providers])

  // ── Provider breakdown ──
  const provBreakdown = useMemo(() => {
    const map = {}
    for (const r of reps) {
      for (const rp of (r.providers || [])) {
        if (!rp.doctorId) continue
        const pv = providers.find(p => p.id === rp.doctorId)
        if (!pv) continue
        if (!map[rp.doctorId]) map[rp.doctorId] = { name: pv.name, goal: pv.goal||0, prod: 0, days: 0 }
        const prod = N(rp.netProd)
        if (prod > 0) { map[rp.doctorId].prod += prod; map[rp.doctorId].days++ }
      }
    }
    return Object.values(map).sort((a,b) => b.prod - a.prod)
  }, [reps, providers])

  // ── Monthly rollup (last 6 months) ──
  const monthly = useMemo(() => {
    const map = {}
    for (const r of reports.filter(r => r.office === office)) {
      const mo = r.date.slice(0,7)
      if (!map[mo]) map[mo] = { prod:0, goal:0, coll:0, days:0 }
      map[mo].prod += repProd(r)
      map[mo].goal += repGoal(r, providers)
      map[mo].coll += repColl(r)
      if (repProd(r) > 0) map[mo].days++
    }
    return Object.entries(map)
      .sort(([a],[b]) => a.localeCompare(b))
      .slice(-6)
      .map(([mo, d]) => ({
        label: new Date(mo+'-15').toLocaleString('en-US',{month:'short'}),
        prod: d.prod, goal: d.goal, coll: d.coll,
        avgProd: d.days > 0 ? Math.round(d.prod / d.days) : 0,
      }))
  }, [reports, office, providers])

  const RANGES = [['7','7D'],['14','14D'],['30','30D'],['60','60D'],['90','90D'],['mtd','MTD'],['custom','Custom']]

  return (
    <div style={{maxWidth:1100, margin:'0 auto', padding:'24px 20px 60px'}}>

      {/* Back + Header */}
      <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:20, flexWrap:'wrap'}}>
        <button onClick={onBack}
          style={{padding:'7px 14px', borderRadius:8, background:'white', border:'1px solid #e2e8f0',
            color:'#64748b', fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:5}}>
          ← Back
        </button>
        <div>
          <div style={{fontSize:11, color:'#94a3b8', fontWeight:700, letterSpacing:1}}>OFFICE ANALYTICS</div>
          <div style={{fontSize:22, fontWeight:800, color:NAVY}}>{office}</div>
        </div>

        {/* Range selector */}
        <div style={{marginLeft:'auto', display:'flex', gap:4, flexWrap:'wrap', alignItems:'center'}}>
          {RANGES.map(([v,l]) => (
            <button key={v} onClick={()=>setRange(v)}
              style={{padding:'6px 11px', borderRadius:7, fontSize:11, fontWeight:700, cursor:'pointer',
                border:'1px solid '+(range===v?BLUE:'#e2e8f0'),
                background:range===v?BLUE:'white', color:range===v?'white':'#64748b'}}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {range==='custom' && (
        <div style={{display:'flex', gap:6, alignItems:'center', marginBottom:16}}>
          <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
            style={{padding:'6px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
          <span style={{fontSize:11, color:'#94a3b8'}}>to</span>
          <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
            style={{padding:'6px 8px', borderRadius:6, border:'1px solid #e2e8f0', fontSize:12}}/>
        </div>
      )}

      {reps.length === 0 ? (
        <div style={{textAlign:'center', padding:60, color:'#94a3b8'}}>
          <div style={{fontSize:32, marginBottom:10}}>📊</div>
          <div style={{fontSize:14, fontWeight:600, color:'#64748b'}}>No reports found for this period</div>
          <div style={{fontSize:12, marginTop:4}}>Try expanding the date range</div>
        </div>
      ) : (<>

      {/* KPI tiles */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:10, marginBottom:20}}>
        <KpiTile label="NET PRODUCTION"   value={USD(totals.prod)}               accent={BLUE}   color={BLUE}/>
        <KpiTile label="GOAL"             value={USD(totals.goal)}               accent="#e2e8f0"/>
        <KpiTile label="% OF GOAL"        value={Math.round(totals.pct)+'%'}     accent={totals.pct>=85?GREEN:totals.pct>=65?AMBER:RED} color={totals.pct>=85?GREEN:totals.pct>=65?AMBER:RED}/>
        <KpiTile label="COLLECTIONS"      value={USD(totals.coll)}               accent={TEAL}   color={TEAL}/>
        <KpiTile label="COLLECTION RATE"  value={Math.round(totals.collRate)+'%'} accent={totals.collRate>=98?GREEN:totals.collRate>=90?AMBER:RED} color={totals.collRate>=98?GREEN:totals.collRate>=90?AMBER:RED}/>
        <KpiTile label="AVG DAILY PROD"   value={USD(totals.avgProd)}            accent={PURPLE} color={PURPLE}/>
        <KpiTile label="DAYS REPORTED"    value={totals.days}                    accent="#e2e8f0"/>
        <KpiTile label="NO-SHOWS"         value={totals.noShows}                 accent={totals.noShows>2?RED:'#e2e8f0'} color={totals.noShows>2?RED:NAVY}/>
      </div>

      {/* Production vs Goal — interactive line chart */}
      <ChartCard title="Production vs Goal" sub="Hover to see exact values for any day">
        <InteractiveChart
          fmt="$"
          height={220}
          series={[
            { label:'Production', color:BLUE,  points:daily.map(d=>({label:d.label, value:d.prod||null})) },
            { label:'Goal',       color:'#e2e8f0', points:daily.map(d=>({label:d.label, value:d.goal||null})) },
          ]}/>
      </ChartCard>

      {/* Collections chart */}
      <ChartCard title="Collections" sub="Daily collections and collection rate">
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16}}>
          <div>
            <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:8}}>COLLECTIONS $</div>
            <InteractiveChart fmt="$" height={160}
              series={[{ label:'Collections', color:TEAL, points:daily.map(d=>({label:d.label, value:d.coll||null})) }]}/>
          </div>
          <div>
            <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:8}}>COLLECTION RATE %</div>
            <InteractiveChart fmt="%" height={160}
              series={[{ label:'Rate', color:GREEN, points:daily.map(d=>({label:d.label, value:d.collRate||null})) }]}/>
          </div>
        </div>
      </ChartCard>

      {/* Provider breakdown */}
      {provBreakdown.length > 0 && (
        <ChartCard title="Provider Production" sub="Total production by provider for this period">
          <div style={{marginBottom:16}}>
            <InteractiveBar fmt="$" height={160} colors={[BLUE, TEAL, PURPLE, AMBER]}
              groups={provBreakdown.map(p => ({
                label: p.name.split(' ').pop(),
                labels: ['Production','Goal'],
                values: [p.prod, p.goal * p.days],
              }))}/>
          </div>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
            <thead>
              <tr style={{background:'#f8fafc'}}>
                {['Provider','Production','Days','Avg/Day','vs Goal'].map(h => (
                  <th key={h} style={{padding:'7px 10px', textAlign:'left', fontSize:9, fontWeight:800,
                    color:'#94a3b8', letterSpacing:.5}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {provBreakdown.map((p, i) => {
                const avgDay  = p.days > 0 ? p.prod / p.days : 0
                const goalAmt = p.goal * p.days
                const vsGoal  = goalAmt > 0 ? Math.round(p.prod / goalAmt * 100) : null
                return (
                  <tr key={i} style={{borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa'}}>
                    <td style={{padding:'8px 10px', fontWeight:700}}>{p.name}</td>
                    <td style={{padding:'8px 10px', fontWeight:700, color:BLUE}}>{USD(p.prod)}</td>
                    <td style={{padding:'8px 10px', color:'#64748b'}}>{p.days}</td>
                    <td style={{padding:'8px 10px', color:'#475569'}}>{USD(avgDay)}</td>
                    <td style={{padding:'8px 10px'}}>
                      {vsGoal != null && (
                        <span style={{fontWeight:700, color:vsGoal>=85?GREEN:vsGoal>=65?AMBER:RED}}>{vsGoal}%</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ChartCard>
      )}

      {/* Scheduling metrics */}
      <ChartCard title="Scheduling" sub="No-shows and cancellations by day">
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16}}>
          <div>
            <div style={{display:'flex', gap:12, marginBottom:10}}>
              <div style={{flex:1, background:'#fef2f2', borderRadius:9, padding:'10px 12px'}}>
                <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:3}}>NO-SHOWS</div>
                <div style={{fontSize:20, fontWeight:800, color:RED}}>{totals.noShows}</div>
              </div>
              <div style={{flex:1, background:'#fef9c3', borderRadius:9, padding:'10px 12px'}}>
                <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:3}}>CANCELLED</div>
                <div style={{fontSize:20, fontWeight:800, color:AMBER}}>{totals.cancelled}</div>
              </div>
            </div>
            <InteractiveChart fmt="#" height={140}
              series={[
                { label:'No-Shows',   color:RED,   points:daily.map(d=>({label:d.label, value:d.noShows||null})) },
                { label:'Cancelled',  color:AMBER, points:daily.map(d=>({label:d.label, value:d.cancelled||null})) },
              ]}/>
          </div>
          <div>
            <div style={{display:'flex', gap:12, marginBottom:10}}>
              <div style={{flex:1, background:'#eff6ff', borderRadius:9, padding:'10px 12px'}}>
                <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:3}}>NP SCHED</div>
                <div style={{fontSize:20, fontWeight:800, color:BLUE}}>{totals.npSched}</div>
              </div>
              <div style={{flex:1, background:'#f0fdf4', borderRadius:9, padding:'10px 12px'}}>
                <div style={{fontSize:9, fontWeight:800, color:'#94a3b8', marginBottom:3}}>NP SHOWED</div>
                <div style={{fontSize:20, fontWeight:800, color:GREEN}}>{totals.npShowed}</div>
              </div>
            </div>
            <InteractiveChart fmt="#" height={140}
              series={[
                { label:'NP Sched',  color:BLUE,  points:daily.map(d=>({label:d.label, value:d.npSched||null})) },
                { label:'NP Showed', color:GREEN, points:daily.map(d=>({label:d.label, value:d.npShowed||null})) },
              ]}/>
          </div>
        </div>
      </ChartCard>

      {/* Monthly trend — 6-month bar chart */}
      {monthly.length > 1 && (
        <ChartCard title="6-Month Trend" sub="Monthly production and collections">
          <InteractiveBar fmt="$" height={180} colors={[BLUE, TEAL]}
            groups={monthly.map(m => ({
              label: m.label,
              labels: ['Production','Collections'],
              values: [m.prod, m.coll],
            }))}/>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))', gap:8, marginTop:12}}>
            {monthly.map(m => (
              <div key={m.label} style={{background:'#f8fafc', borderRadius:8, padding:'8px 10px', border:'1px solid #f1f5f9'}}>
                <div style={{fontSize:10, fontWeight:800, color:'#94a3b8', marginBottom:4}}>{m.label}</div>
                <div style={{fontSize:13, fontWeight:800, color:BLUE}}>{USD(m.prod)}</div>
                <div style={{fontSize:11, color:'#64748b'}}>Avg/day: {USD(m.avgProd)}</div>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      </>)}
    </div>
  )
}
