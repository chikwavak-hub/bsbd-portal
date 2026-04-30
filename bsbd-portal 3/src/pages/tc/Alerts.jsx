import React, { useState } from 'react'
import { IcoPhone, IcoClock, IcoChevR, IcoAlert, IcoCheck, IcoCalendar, IcoTooth } from '../../components/icons'
import { TcStatusBadge } from '../../components/ui'
import { USD, todayStr, getTcAlerts, matchCollectionPatients, fmtDate } from '../../lib/helpers'
import { TC_STATUS_MAP } from '../../lib/constants'

function TcAlertsPage({ tcPatients, collectionPatients, user, isManager, setPage, notify, saveTcPatient }) {
  const [detailId, setDetailId] = useState(null)

  // Existing TC alerts
  const alerts  = getTcAlerts(tcPatients, user, isManager)
  const high    = alerts.filter(a => a.urgency === 'high')
  const medium  = alerts.filter(a => a.urgency === 'medium')

  // Collection sheet matches — TC patients with appointments today
  const collMatches = matchCollectionPatients(
    tcPatients,
    collectionPatients || [],
    user,
    isManager
  )

  // Separate: patients already collected vs pending
  const apptCollected = collMatches.filter(m => m.collPatient?.status === 'collected')
  const apptPending   = collMatches.filter(m => m.collPatient?.status !== 'collected')

  // Alert card for standard TC alerts
  const AlertCard = ({ a }) => (
    <div onClick={() => setDetailId(a.patient.id)}
      style={{ background: 'white', borderRadius: 12, border: `1px solid ${a.urgency === 'high' ? '#fecaca' : '#fde68a'}`, padding: '14px 18px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: a.urgency === 'high' ? '#fee2e2' : '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {a.type === 'call'
          ? <IcoPhone size={18} style={{ color: a.urgency === 'high' ? '#dc2626' : '#d97706' }} />
          : <IcoClock size={18} style={{ color: a.urgency === 'high' ? '#dc2626' : '#d97706' }} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{a.patient.patient_name}</div>
        <div style={{ fontSize: 12, color: a.urgency === 'high' ? '#dc2626' : '#d97706', fontWeight: 600, marginTop: 2 }}>{a.msg}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          {a.patient.treatment_type || '—'} · {USD(a.patient.treatment_value)}
          {isManager && a.patient.assigned_tc_name ? ` · TC: ${a.patient.assigned_tc_name}` : ''}
        </div>
      </div>
      <IcoChevR size={16} style={{ color: '#94a3b8' }} />
    </div>
  )

  // Appointment match card
  const ApptCard = ({ m }) => {
    const cp      = m.collPatient
    const tcp     = m.tcPatient
    const hasDue  = m.totalExpected > 0
    const done    = cp?.status === 'collected'
    const partial = cp?.status === 'partial'
    const flagsOk = !m.flagsTotal || m.flagsDone >= m.flagsTotal

    return (
      <div style={{ background: 'white', borderRadius: 12, border: `2px solid ${done ? '#bbf7d0' : partial ? '#bae6fd' : '#99f6e4'}`, padding: '16px 18px', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>

          {/* Avatar */}
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#0d9488', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'white', fontSize: 16, fontWeight: 800 }}>{tcp.patient_name[0]}</span>
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Name + status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
              <span style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{tcp.patient_name}</span>
              <TcStatusBadge status={tcp.status} />
              {done && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: '#dcfce7', color: '#16a34a' }}>✓ Collected</span>}
              {partial && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: '#e0f2fe', color: '#0891b2' }}>½ Partial</span>}
            </div>

            {/* Today's appointment info */}
            <div style={{ background: '#f0fdfa', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: '#0d9488', letterSpacing: 1, marginBottom: 6 }}>TODAY'S APPOINTMENT — {m.office.toUpperCase()}{m.operatory ? ' · ' + m.operatory : ''}</div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {hasDue && (
                  <div>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>COLLECT TODAY</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: done ? '#16a34a' : '#dc2626' }}>{USD(m.totalExpected)}</div>
                  </div>
                )}
                {!hasDue && (
                  <div>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>PATIENT PORTION</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#94a3b8' }}>$0.00 — Insurance covers</div>
                  </div>
                )}
                {m.carrier && (
                  <div>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>INSURANCE</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>{m.carrier}</div>
                    <div style={{ fontSize: 10, color: m.insStatus?.includes('ACTIVE') ? '#16a34a' : '#dc2626' }}>
                      {m.insStatus?.includes('ACTIVE') ? 'Active' : m.insStatus?.includes('INACTIVE') ? '⚠ Inactive' : m.insStatus || '—'}
                    </div>
                  </div>
                )}
                {cp?.amount_collected > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>COLLECTED SO FAR</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#16a34a' }}>{USD(cp.amount_collected)}</div>
                  </div>
                )}
              </div>
            </div>

            {/* Procedures */}
            {m.treatments && m.treatments.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: 1, marginBottom: 6 }}>TODAY'S PROCEDURES</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {m.treatments.map((t, i) => (
                    <span key={i} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#475569', fontWeight: 600 }}>
                      <b>{t.code}</b>{t.desc ? ' — ' + t.desc.slice(0, 30) : ''}{t.tooth ? ' · Th:' + t.tooth : ''}
                      {t.pt_pct != null && <span style={{ marginLeft: 4, color: t.pt_pct === 0 ? '#16a34a' : '#d97706' }}>{t.pt_pct}% pt</span>}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Insurance flags status */}
            {m.flagsTotal > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: flagsOk ? '#f0fdf4' : '#fef3c7', border: `1px solid ${flagsOk ? '#bbf7d0' : '#fde68a'}` }}>
                {flagsOk
                  ? <><IcoCheck size={14} style={{ color: '#16a34a' }} /><span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a' }}>All {m.flagsTotal} insurance flags verified ✓</span></>
                  : <><IcoAlert size={14} style={{ color: '#d97706' }} /><span style={{ fontSize: 12, fontWeight: 600, color: '#d97706' }}>{m.flagsTotal - m.flagsDone} of {m.flagsTotal} insurance flags still pending — review in Collections</span></>
                }
              </div>
            )}

            {/* TC treatment context */}
            <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              {tcp.treatment_type && <span>TC Plan: {tcp.treatment_type}</span>}
              {tcp.treatment_value && <span>Plan Value: {USD(tcp.treatment_value)}</span>}
              {tcp.payment_method && <span>Payment: {tcp.payment_method}</span>}
              {m.matchType === 'last_only' && <span style={{ color: '#d97706' }}>⚠ Matched on last name only — verify this is the same patient</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px 60px' }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', marginBottom: 4 }}>TC Alerts & Reminders</h1>
      <p style={{ color: '#94a3b8', fontSize: 13, marginBottom: 28 }}>
        {alerts.length} action alert{alerts.length !== 1 ? 's' : ''}
        {collMatches.length > 0 ? ` · ${collMatches.length} patient${collMatches.length !== 1 ? 's' : ''} with appointments today` : ''}
      </p>

      {/* TODAY'S APPOINTMENTS SECTION */}
      {collMatches.length > 0 && (
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#0d9488', letterSpacing: 2, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <IcoCalendar size={14} style={{ color: '#0d9488' }} />
            YOUR PATIENTS IN TODAY — {todayStr()}
          </div>

          {/* Pending collection */}
          {apptPending.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              {apptPending.length > 0 && apptCollected.length > 0 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', letterSpacing: 1, marginBottom: 8 }}>COLLECTION PENDING</div>
              )}
              {apptPending.map((m, i) => <ApptCard key={i} m={m} />)}
            </div>
          )}

          {/* Already collected */}
          {apptCollected.length > 0 && (
            <div>
              {apptPending.length > 0 && (
                <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', letterSpacing: 1, marginBottom: 8 }}>COLLECTED ✓</div>
              )}
              {apptCollected.map((m, i) => <ApptCard key={i} m={m} />)}
            </div>
          )}
        </div>
      )}

      {/* No appointments today */}
      {collMatches.length === 0 && (
        <div style={{ background: '#f0fdfa', borderRadius: 12, border: '1px solid #99f6e4', padding: '16px 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
          <IcoCalendar size={18} style={{ color: '#0d9488' }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#134e4a' }}>No TC patients on today's collection sheet</div>
            <div style={{ fontSize: 12, color: '#0d9488', marginTop: 2 }}>
              {collectionPatients?.length > 0
                ? `${collectionPatients.length} patients loaded in collection sheet — none matched to your TC patients`
                : 'Collection sheet not yet uploaded for today'}
            </div>
          </div>
        </div>
      )}

      {/* Divider */}
      {alerts.length > 0 && collMatches.length > 0 && (
        <div style={{ height: 1, background: '#e2e8f0', marginBottom: 28 }} />
      )}

      {/* Standard TC Alerts */}
      {alerts.length === 0 && collMatches.length === 0 && (
        <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8', background: 'white', borderRadius: 12, border: '1px solid #e2e8f0' }}>
          🎉 No alerts right now — all patients on track!
        </div>
      )}

      {high.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', letterSpacing: 2, marginBottom: 10 }}>HIGH PRIORITY — ACTION NEEDED TODAY</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            {high.map((a, i) => <AlertCard key={i} a={a} />)}
          </div>
        </>
      )}

      {medium.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#d97706', letterSpacing: 2, marginBottom: 10 }}>FOLLOW-UP NEEDED</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {medium.map((a, i) => <AlertCard key={i} a={a} />)}
          </div>
        </>
      )}
    </div>
  )
}

export default TcAlertsPage
