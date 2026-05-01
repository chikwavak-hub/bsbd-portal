import React, { useState } from 'react'
import { IcoChevR, IcoAlert, IcoUsers, IcoCheck } from '../../components/icons'
import { USD, PCT, N, todayStr, tcDiffDays, getTcAlerts } from '../../lib/helpers'
import { TC_PIPELINE, TC_STATUS_MAP, TC_STATUSES } from '../../lib/constants'

// ── Funnel stage config ───────────────────────────────────────────────────
const FUNNEL_STAGES = [
  { key: 'consult',           label: 'Consult Done',       short: 'Consult',    color: '#d97706', bg: '#fef3c7', step: 0 },
  { key: 'tx_presented',      label: 'TX Presented',       short: 'TX Pres.',   color: '#2563eb', bg: '#eff6ff', step: 1 },
  { key: 'payment_confirmed', label: 'Payment Confirmed',  short: 'Payment',    color: '#7c3aed', bg: '#f5f3ff', step: 2 },
  { key: 'scheduled',         label: 'Scheduled',          short: 'Sched.',     color: '#0891b2', bg: '#e0f2fe', step: 3 },
  { key: 'in_treatment',      label: 'In Treatment',       short: 'In Tx',      color: '#0d9488', bg: '#f0fdfa', step: 4 },
  { key: 'completed',         label: 'Completed',          short: 'Done',       color: '#16a34a', bg: '#dcfce7', step: 5 },
]
const DROP_STATUSES = ['declined', 'lost']

// ── Helpers ───────────────────────────────────────────────────────────────
function avgDays(patients, fromDateKey, toDateKey) {
  const vals = patients
    .filter(p => p[fromDateKey] && p[toDateKey])
    .map(p => Math.abs(tcDiffDays(p[fromDateKey], p[toDateKey])))
    .filter(d => d >= 0 && d < 365)
  if (!vals.length) return null
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
}

function convRate(from, to) {
  return from > 0 ? Math.round((to / from) * 100) : 0
}

// ── Funnel bar ────────────────────────────────────────────────────────────
function FunnelBar({ stage, count, value, maxCount, dropCount, convPct, avgDaysHere, isLast }) {
  const [hovered, setHovered] = useState(false)
  const barW  = maxCount > 0 ? Math.max((count / maxCount) * 100, 4) : 4
  const isDrop= DROP_STATUSES.includes(stage.key)

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}>

        {/* Stage label */}
        <div style={{ width: 110, flexShrink: 0, textAlign: 'right' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{stage.label}</span>
        </div>

        {/* Bar */}
        <div style={{ flex: 1, position: 'relative', height: 36 }}>
          <div style={{ height: '100%', background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: barW + '%', background: stage.color,
              borderRadius: 6, transition: 'width .4s ease',
              opacity: hovered ? 1 : 0.85,
            }}/>
          </div>
          {/* Count overlay */}
          <div style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 800, color: barW > 20 ? 'white' : stage.color }}>{count}</span>
            {value > 0 && <span style={{ fontSize: 11, fontWeight: 600, color: barW > 30 ? 'rgba(255,255,255,.8)' : '#64748b' }}>{USD(value)}</span>}
          </div>
        </div>

        {/* Conv rate from previous */}
        <div style={{ width: 52, flexShrink: 0, textAlign: 'center' }}>
          {convPct !== null && !isLast && (
            <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 6px', borderRadius: 99,
              background: convPct >= 70 ? '#dcfce7' : convPct >= 40 ? '#fef3c7' : '#fee2e2',
              color: convPct >= 70 ? '#16a34a' : convPct >= 40 ? '#d97706' : '#dc2626' }}>
              {convPct}%
            </span>
          )}
        </div>
      </div>

      {/* Drop-off indicator */}
      {dropCount > 0 && !isLast && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 120, marginTop: 2, marginBottom: 2 }}>
          <div style={{ width: 1, height: 12, background: '#fca5a5', marginLeft: 16 }} />
          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>
            {dropCount} dropped out here
          </span>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════════════
function TcDashboardPage({ tcPatients, users }) {
  const [period,    setPeriod]    = useState('all')
  const [filterTC,  setFilterTC]  = useState('all')
  const [filterOff, setFilterOff] = useState('all')
  const [selStage,  setSelStage]  = useState(null)

  const today   = todayStr()
  const mStart  = today.slice(0, 7)
  const tcUsers = users.filter(u => ['treatment_coordinator', 'manager', 'admin'].includes(u.role))
  const offices = [...new Set(tcPatients.map(p => p.office).filter(Boolean))].sort()

  // Filter patients
  const pts = tcPatients.filter(p => {
    if (filterTC  !== 'all' && p.assigned_tc_id !== filterTC)  return false
    if (filterOff !== 'all' && p.office         !== filterOff) return false
    if (period === 'month' && p.consult_date && p.consult_date.slice(0, 7) !== mStart) return false
    if (period === 'q'     && p.consult_date) {
      const mo = parseInt(p.consult_date.slice(5, 7))
      const curQ = Math.ceil(parseInt(mStart.slice(5, 7)) / 3)
      if (Math.ceil(mo / 3) !== curQ) return false
    }
    return true
  })

  // Funnel counts
  const stageOrder = FUNNEL_STAGES.map(s => s.key)
  const stageIndex = Object.fromEntries(FUNNEL_STAGES.map((s, i) => [s.key, i]))

  // Count patients at or past each stage (cumulative funnel)
  const stageCounts = FUNNEL_STAGES.map(stage => ({
    ...stage,
    count:    pts.filter(p => stageIndex[p.status] >= stage.step && !DROP_STATUSES.includes(p.status)).length,
    atStage:  pts.filter(p => p.status === stage.key).length,
    value:    pts.filter(p => stageIndex[p.status] >= stage.step && !DROP_STATUSES.includes(p.status)).reduce((s, p) => s + N(p.treatment_value), 0),
    patients: pts.filter(p => p.status === stage.key),
  }))

  const maxCount    = stageCounts[0]?.count || 1
  const totalDropped= pts.filter(p => DROP_STATUSES.includes(p.status)).length
  const lostValue   = pts.filter(p => DROP_STATUSES.includes(p.status)).reduce((s, p) => s + N(p.treatment_value), 0)

  // Conversion rates between consecutive stages
  const convRates = stageCounts.map((s, i) =>
    i === 0 ? null : convRate(stageCounts[i - 1].count, s.count)
  )

  // Drop-off at each transition
  const dropAtStage = stageCounts.map((s, i) =>
    i === 0 ? 0 : Math.max(stageCounts[i - 1].count - s.count, 0)
  )

  // Overall funnel metrics
  const totalConsults   = stageCounts[0]?.count || 0
  const totalPresented  = stageCounts[1]?.count || 0
  const totalAccepted   = stageCounts[2]?.count || 0
  const totalScheduled  = stageCounts[3]?.count || 0
  const totalCompleted  = stageCounts[5]?.count || 0
  const valuePresented  = stageCounts[1]?.value  || 0
  const valueCompleted  = pts.filter(p => p.status === 'completed').reduce((s, p) => s + N(p.production_value || p.treatment_value), 0)

  // Avg days between key transitions
  const avgConsultToAppt = avgDays(pts, 'consult_date', 'appointment_date')

  // By-TC breakdown
  const tcBreakdown = tcUsers.map(tc => {
    const mine     = pts.filter(p => p.assigned_tc_id === tc.id)
    const consults = mine.filter(p => stageIndex[p.status] >= 0 && !DROP_STATUSES.includes(p.status)).length
    const accepted = mine.filter(p => stageIndex[p.status] >= 2 && !DROP_STATUSES.includes(p.status)).length
    const completed= mine.filter(p => p.status === 'completed').length
    const dropped  = mine.filter(p => DROP_STATUSES.includes(p.status)).length
    return {
      tc, consults, accepted, completed, dropped,
      valuePresented: mine.filter(p => stageIndex[p.status] >= 1).reduce((s,p)=>s+N(p.treatment_value),0),
      valueAccepted:  mine.filter(p => stageIndex[p.status] >= 2).reduce((s,p)=>s+N(p.treatment_value),0),
      acceptRate:     convRate(consults, accepted),
      alerts:         getTcAlerts(mine, { id: tc.id }, false).length,
    }
  }).filter(s => s.consults > 0 || s.dropped > 0)
    .sort((a, b) => b.valueAccepted - a.valueAccepted)

  // Selected stage patient list
  const stagePatients = selStage
    ? pts.filter(p => p.status === selStage)
    : []

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 60px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', margin: 0 }}>TC Conversion Funnel</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
            {pts.length} patients · {totalDropped} dropped · {convRate(totalConsults, totalCompleted)}% end-to-end conversion
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {/* Period */}
          <div style={{ display: 'flex', gap: 2, background: 'white', padding: 3, borderRadius: 8, border: '1px solid #e2e8f0' }}>
            {[['all','All Time'],['month','This Month'],['q','This Quarter']].map(([id,l])=>(
              <button key={id} onClick={()=>setPeriod(id)} style={{ padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: period===id?'#0d9488':'transparent', color: period===id?'white':'#64748b' }}>{l}</button>
            ))}
          </div>
          {/* TC filter */}
          <select className="ic" style={{ width: 'auto', fontSize: 12 }} value={filterTC} onChange={e=>setFilterTC(e.target.value)}>
            <option value="all">All TCs</option>
            {tcUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {/* Office filter */}
          {offices.length > 1 && (
            <select className="ic" style={{ width: 'auto', fontSize: 12 }} value={filterOff} onChange={e=>setFilterOff(e.target.value)}>
              <option value="all">All Offices</option>
              {offices.map(o => <option key={o}>{o}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 24 }}>
        {[
          ['Consults',     totalConsults,                        `${pts.length} total patients`, '#d97706'],
          ['TX Accepted',  `${convRate(totalConsults,totalAccepted)}%`, `${totalAccepted} of ${totalConsults}`, totalAccepted/Math.max(totalConsults,1)>=.6?'#16a34a':'#dc2626'],
          ['Completed',    totalCompleted,                       USD(valueCompleted)+' produced', '#16a34a'],
          ['Dropped',      totalDropped,                         USD(lostValue)+' lost',  totalDropped>0?'#dc2626':'#16a34a'],
          ['Avg Close',    avgConsultToAppt!=null?avgConsultToAppt+'d':'—', 'consult → appointment', '#0d9488'],
        ].map(([l,v,s,c])=>(
          <div key={l} style={{ background: 'white', borderRadius: 12, padding: '16px 18px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', letterSpacing: 1, marginBottom: 4 }}>{l.toUpperCase()}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c }}>{v}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>{s}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16, marginBottom: 16 }}>

        {/* FUNNEL */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '20px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 2 }}>CONVERSION FUNNEL</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Conv % = rate from previous stage · Click stage to see patients</div>
          </div>

          {stageCounts.map((stage, i) => (
            <div key={stage.key} onClick={() => setSelStage(selStage === stage.key ? null : stage.key)}
              style={{ cursor: 'pointer', borderRadius: 8, padding: '4px 6px', background: selStage === stage.key ? stage.bg : 'transparent', transition: 'background .15s' }}>
              <FunnelBar
                stage={stage}
                count={stage.count}
                value={stage.value}
                maxCount={maxCount}
                dropCount={dropAtStage[i]}
                convPct={convRates[i]}
                isLast={i === stageCounts.length - 1}
              />
            </div>
          ))}

          {/* Dropped patients */}
          <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626' }}>Declined / Lost to Follow-up</div>
              <div style={{ fontSize: 11, color: '#ef4444', marginTop: 1 }}>{totalDropped} patients · {USD(lostValue)} in lost treatment value</div>
            </div>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#dc2626' }}>{totalDropped}</span>
          </div>
        </div>

        {/* Stage detail panel */}
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '20px', overflowY: 'auto', maxHeight: 500 }}>
          {!selStage ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>👆</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>Click a stage</div>
              <div style={{ fontSize: 12 }}>See which patients are at that stage</div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 2, marginBottom: 12 }}>
                {TC_STATUS_MAP[selStage]?.label?.toUpperCase()} — {stagePatients.length} PATIENTS
              </div>
              {stagePatients.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 12 }}>No patients at this stage</div>
              ) : (
                stagePatients.map((p, i) => {
                  const daysHere = p.updated_at ? Math.abs(tcDiffDays(p.updated_at.split('T')[0], today)) : null
                  return (
                    <div key={i} style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid #f1f5f9', marginBottom: 8, background: daysHere > 14 ? '#fffbeb' : 'white' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{p.patient_name}</div>
                        {p.treatment_value > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: '#0d9488' }}>{USD(p.treatment_value)}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                        {p.treatment_type || '—'}
                        {p.assigned_tc_name ? ` · ${p.assigned_tc_name}` : ''}
                      </div>
                      {daysHere !== null && (
                        <div style={{ fontSize: 10, marginTop: 3, color: daysHere > 14 ? '#d97706' : '#94a3b8', fontWeight: daysHere > 14 ? 700 : 400 }}>
                          {daysHere > 14 ? `⚠ ${daysHere} days at this stage` : `${daysHere}d at this stage`}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* Conversion rate breakdown */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 2, marginBottom: 16 }}>STAGE-BY-STAGE CONVERSION</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflowX: 'auto', paddingBottom: 8 }}>
          {stageCounts.map((stage, i) => (
            <React.Fragment key={stage.key}>
              <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 100 }}>
                <div style={{ padding: '12px 16px', borderRadius: 10, background: stage.bg, border: `1px solid ${stage.color}20`, marginBottom: 6 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: stage.color }}>{stage.atStage}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: stage.color, marginTop: 2 }}>{stage.short.toUpperCase()}</div>
                </div>
                {stage.atStage > 0 && (
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>
                    {USD(stage.patients.reduce((s,p)=>s+N(p.treatment_value),0))}
                  </div>
                )}
              </div>
              {i < stageCounts.length - 1 && (
                <div style={{ flexShrink: 0, textAlign: 'center', minWidth: 50 }}>
                  <div style={{ fontSize: 11, fontWeight: 700,
                    color: convRates[i+1] >= 70 ? '#16a34a' : convRates[i+1] >= 40 ? '#d97706' : '#dc2626' }}>
                    {convRates[i+1]}%
                  </div>
                  <IcoChevR size={14} style={{ color: '#cbd5e1', margin: '0 auto' }} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* By TC */}
      {tcBreakdown.length > 0 && (
        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', padding: '16px 20px', borderBottom: '1px solid #f1f5f9', letterSpacing: 2 }}>
            BY TREATMENT COORDINATOR
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc' }}>
                {['TC','Consults','Accepted','Accept Rate','Value Presented','Value Accepted','Completed','Dropped','Alerts'].map(h=>(
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#64748b', letterSpacing: 1, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h.toUpperCase()}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tcBreakdown.map(s => (
                <tr key={s.tc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '13px 14px' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b' }}>{s.tc.name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.tc.office}</div>
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 13, textAlign: 'center', color: '#475569' }}>{s.consults}</td>
                  <td style={{ padding: '13px 14px', fontSize: 13, textAlign: 'center', color: '#475569' }}>{s.accepted}</td>
                  <td style={{ padding: '13px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ flex: 1, height: 6, background: '#f1f5f9', borderRadius: 3, overflow: 'hidden', minWidth: 50 }}>
                        <div style={{ height: '100%', width: s.acceptRate+'%', background: s.acceptRate>=70?'#16a34a':s.acceptRate>=40?'#d97706':'#dc2626', borderRadius: 3 }}/>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: s.acceptRate>=70?'#16a34a':s.acceptRate>=40?'#d97706':'#dc2626', width: 32 }}>{s.acceptRate}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '13px 14px', fontSize: 12, color: '#475569' }}>{USD(s.valuePresented)}</td>
                  <td style={{ padding: '13px 14px', fontSize: 12, fontWeight: 700, color: '#0d9488' }}>{USD(s.valueAccepted)}</td>
                  <td style={{ padding: '13px 14px', fontSize: 13, fontWeight: 700, color: '#16a34a', textAlign: 'center' }}>{s.completed}</td>
                  <td style={{ padding: '13px 14px', fontSize: 13, textAlign: 'center' }}>
                    {s.dropped > 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#fee2e2', color: '#dc2626' }}>{s.dropped}</span>
                      : <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
                  </td>
                  <td style={{ padding: '13px 14px' }}>
                    {s.alerts > 0
                      ? <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#fef3c7', color: '#d97706' }}>{s.alerts}</span>
                      : <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default TcDashboardPage
