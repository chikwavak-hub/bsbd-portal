import { TC_CHECKLIST } from './constants'
export const todayStr    = () => new Date().toISOString().split('T')[0]
export const monthStart  = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0] }
export const weekStart   = () => { const d = new Date(); const m = new Date(d); m.setDate(d.getDate() - d.getDay() + 1); return m.toISOString().split('T')[0] }
export const last30Start = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().split('T')[0] }
export const rangeStart  = (rt, cs) => rt === 'today' ? todayStr() : rt === 'week' ? weekStart() : rt === 'mtd' ? monthStart() : rt === 'last30' ? last30Start() : cs

export const N   = v => Number(v) || 0
export const USD = v => '$' + N(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const PCT = (a, b) => N(b) > 0 ? ((N(a) / N(b)) * 100).toFixed(1) + '%' : '—'
export const pctNum = (a, b) => N(b) > 0 ? (N(a) / N(b)) * 100 : 0

export const fmtDate  = s => s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' }) : ''
export const fmtTime  = s => s ? new Date(s).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
export const tcDiffDays = (a, b) => Math.round((new Date(b) - new Date(a)) / (1000 * 60 * 60 * 24))

export const repGoal = (r, providers) => {
  // Count providers who have a doctor selected (regardless of production entered yet)
  const pg = r.providers.reduce((s, p) => {
    if (!p.doctorId) return s
    const pr = providers.find(x => x.id === p.doctorId)
    return s + (pr ? N(pr.goal) : 0)
  }, 0)
  // Count hygienists who have a name entered
  const hg = (r.hygiene || []).filter(h => h.name && h.name.trim()).length * 1200
  return pg + hg
}
export const repProd = r => r.providers.reduce((s, p) => s + N(p.netProd), 0) + r.hygiene.reduce((s, h) => s + N(h.netProd), 0)
export const repColl = r => N(r.coll?.nonIns) + N(r.coll?.ins)

export const newProv = () => ({ _id: Math.random().toString(36), doctorId: '', openSchedule: '', netProd: '', ptsSeen: '', npSched: '', npSeen: '' })
export const newHyg  = () => ({ _id: Math.random().toString(36), name: '', openSchedule: '', netProd: '', ptsSeen: '' })
export const newFD   = () => ({ calls: '', callsSched: '', recalls: '', recallsSched: '', npTxPres: '', npTxAcc: '', exTxPres: '', exTxAcc: '' })

export const blankForm = u => ({
  id: '', submittedAt: null, submittedBy: u?.name || '', date: todayStr(), office: u?.office || '',
  providers: [newProv()], hygiene: [newHyg()],
  sched: {
    // Schedule & patient flow
    totalAmt: '', schedAmt: '',
    ptsOnSched: '', ptsConfirmed: '', ptsShowUp: '', cancelled: '', noShows: '', rescheduled: '',
    // Recalls
    recalls: '', recallsSched: '',
    // New patients
    npOnSched: '', npShowed: '', npCalls: '', npCallsSched: '',
    // Same day
    sameDayNP: '', sameDayExt: '',
    // Prebooking & comp exams
    compExamsSeen: '', ptsPrebooked: '',
    // Hygiene
    hygPtsOnSched: '', hygPtsSeen: '',
    // Predeterminations
    predGenerated: '', predSubmitted: '',
  },
  coll: { nonIns: '', ins: '', cash: '', check: '', creditCard: '', financing: '', eft: '', insCheck: '', insCreditCard: '', insElectronic: '' }, claims: { sent: '', submitted: '', rejected: '', resolved: '', escalations: '' }, fd: {}, notes: '',
})

export function setPath(obj, path, val) {
  const keys = path.split('.')
  const r = { ...obj }
  let c = r
  for (let i = 0; i < keys.length - 1; i++) { c[keys[i]] = { ...c[keys[i]] }; c = c[keys[i]] }
  c[keys[keys.length - 1]] = val
  return r
}

export const lsGet = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb } catch { return fb } }
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
export const lsDel = k => { try { localStorage.removeItem(k) } catch {} }
export const draftKey = (office, date) => `bsbd_mgr_draft_${office}_${date}`

export const userFromRow = r => ({ id: r.id, name: r.name, username: r.username, password: r.password, role: r.role, office: r.office, staffName: r.staff_name || '' })
export const userToRow   = u => ({ id: u.id, name: u.name, username: u.username, password: u.password, role: u.role, office: u.office, staff_name: u.staffName || '' })

export const downloadCSV = (rows, filename) => {
  const esc = v => '"' + String(v).split('"').join('""') + '"'
  const csv = rows.map(r => r.map(esc).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
}

export const printSection = (title, id) => {
  const el = document.getElementById(id)
  if (!el) return
  const w = window.open('', '_blank', 'width=900,height=700')
  w.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:system-ui;font-size:13px;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #e2e8f0;padding:6px 10px}th{background:#f8fafc;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b}h1{font-size:20px;margin-bottom:4px}h2{font-size:14px;color:#64748b;margin-bottom:20px}</style></head><body><h1>${title}</h1><h2>Beautiful Smiles by Design · ${new Date().toLocaleDateString()}</h2>${el.innerHTML}</body></html>`)
  w.document.close()
  w.onload = () => { w.focus(); w.print() }
}

export function workingDaysInMonth(year, month) {
  const days = new Date(year, month, 0).getDate()
  let count = 0
  for (let d = 1; d <= days; d++) { const dow = new Date(year, month - 1, d).getDay(); if (dow > 0 && dow < 6) count++ }
  return count
}
export function workingDaysSoFar(dateStr) {
  const dt = new Date(dateStr + 'T12:00:00')
  let count = 0
  for (let d = 1; d <= dt.getDate(); d++) { const dow = new Date(dt.getFullYear(), dt.getMonth(), d).getDay(); if (dow > 0 && dow < 6) count++ }
  return count
}

export function getTcAlerts(patients, user, isManager) {
  const today = todayStr()
  const mine = isManager ? patients : patients.filter(p => p.assigned_tc_id === user?.id)
  const alerts = []
  for (const p of mine) {
    if (['completed', 'declined', 'lost'].includes(p.status)) continue
    const fu = p.followups || []
    const hasFU = t => fu.some(f => f.type === t)
    if (p.consult_date) {
      const da = new Date(p.consult_date + 'T12:00:00'); da.setDate(da.getDate() + 1)
      if (today >= da.toISOString().split('T')[0] && !hasFU('Day after consultation'))
        alerts.push({ patient: p, msg: 'Day-after-consult call overdue', urgency: 'high', type: 'call' })
    }
    if (p.appointment_date) {
      const d = tcDiffDays(today, p.appointment_date)
      if (d === 7 && !hasFU('1 week before appointment')) alerts.push({ patient: p, msg: '1-week-before call due today', urgency: 'high', type: 'call' })
      if (d === 1 && !hasFU('Day before appointment'))    alerts.push({ patient: p, msg: 'Day-before call due today', urgency: 'high', type: 'call' })
      if (d < 0 && p.status === 'scheduled')              alerts.push({ patient: p, msg: `Appointment ${Math.abs(d)}d ago — update status`, urgency: 'high', type: 'overdue' })
    }
    if (p.status === 'tx_presented' && p.updated_at) {
      const stale = tcDiffDays(p.updated_at.split('T')[0], today)
      if (stale >= 7) alerts.push({ patient: p, msg: `TX presented ${stale} days ago — no follow-up logged`, urgency: 'medium', type: 'followup' })
    }
    if (p.status === 'payment_confirmed' && !p.appointment_date)
      alerts.push({ patient: p, msg: 'Payment confirmed — needs appointment date', urgency: 'medium', type: 'schedule' })
  }
  return alerts
}

export function tcChecklistPct(checklist) {
  const total = TC_CHECKLIST.reduce(function(s, sec) { return s + sec.items.length }, 0)
  const done  = TC_CHECKLIST.reduce(function(s, sec) {
    return s + sec.items.filter(function(item, i) {
      return checklist && checklist[sec.id + '_' + String(i)]
    }).length
  }, 0)
  return Math.round((done / total) * 100)
}

// ── Collection sheet → TC patient matching ────────────────────────────────
export function matchCollectionPatients(tcPatients, collectionPatients, user, isManager) {
  const today = todayStr()
  const mine  = isManager ? tcPatients : tcPatients.filter(p => p.assigned_tc_id === user?.id)
  // Only active TC patients (not completed/lost/declined)
  const active = mine.filter(p => !['completed','declined','lost'].includes(p.status))
  const matches = []

  for (const tcp of active) {
    // Normalize TC patient name
    const tcNorm = tcp.patient_name
      ? tcp.patient_name.replace(/\([^)]+\)/g,'').replace(/[^A-Za-z\s]/g,'').trim().toUpperCase().split(/\s+/).join(' ')
      : ''
    if (!tcNorm) continue

    const tcLast = tcNorm.split(' ').pop()

    for (const cp of collectionPatients) {
      const cpNorm = cp.patient_name_norm || ''
      const cpLast = cpNorm.split(' ').pop()

      // Exact match
      const exactMatch = tcNorm === cpNorm
      // Last name match (partial)
      const lastMatch  = tcLast && cpLast && tcLast === cpLast && tcLast.length > 2
      // First + last match (handles middle names)
      const tcParts   = tcNorm.split(' ')
      const cpParts   = cpNorm.split(' ')
      const firstLastMatch = tcParts[0] === cpParts[0] && tcLast === cpLast

      const matchType = exactMatch ? 'exact' : firstLastMatch ? 'first_last' : lastMatch ? 'last_only' : null
      if (!matchType) continue

      matches.push({
        tcPatient:    tcp,
        collPatient:  cp,
        matchType,
        date:         cp.date || today,
        office:       cp.office || '',
        operatory:    cp.operatory || '',
        totalExpected:cp.total_expected || 0,
        insStatus:    cp.ins_status || '',
        carrier:      cp.ins_carrier || '',
        treatments:   cp.treatments || [],
        flagsTotal:   cp.flags_total || 0,
        flagsDone:    cp.flags_done || 0,
      })
      break // one match per TC patient is enough
    }
  }
  return matches
}


// ════════════════════════════════════════════════════════════════════════════
// PATIENT JOURNEY — links TC plan + collection records + appointments
// Collection record is the source of truth for $ owed / collected.
// ════════════════════════════════════════════════════════════════════════════
export function normName(name) {
  return name
    ? name.replace(/\([^)]+\)/g, '').replace(/[^A-Za-z\s]/g, '').trim().toUpperCase().split(/\s+/).join(' ')
    : ''
}

// Find collection record(s) for one TC patient. Returns { record, confidence }
export function linkCollectionToPatient(tcPatient, collectionRecords) {
  const tcNorm = normName(tcPatient.patient_name)
  if (!tcNorm) return { record: null, confidence: 'none', candidates: [] }

  const tcOffice = (tcPatient.office || '').toLowerCase()
  const tcLast  = tcNorm.split(' ').pop()
  const tcFirst = tcNorm.split(' ')[0]

  const sameOffice = collectionRecords.filter(c =>
    !c.office || !tcOffice || c.office.toLowerCase() === tcOffice
  )
  const pool = sameOffice.length ? sameOffice : collectionRecords

  // 1) Exact normalized-name match
  let hit = pool.find(c => (c.patient_name_norm || normName(c.patient_name)) === tcNorm)
  if (hit) return { record: hit, confidence: 'exact', candidates: [hit] }

  // 2) First + last match (handles middle names)
  const fuzzy = pool.filter(c => {
    const n = c.patient_name_norm || normName(c.patient_name)
    const parts = n.split(' ')
    return parts[0] === tcFirst && parts[parts.length - 1] === tcLast
  })
  if (fuzzy.length === 1) return { record: fuzzy[0], confidence: 'likely', candidates: fuzzy }
  if (fuzzy.length > 1)   return { record: fuzzy[0], confidence: 'ambiguous', candidates: fuzzy }

  // 3) Last-name-only (low confidence)
  const lastOnly = pool.filter(c => {
    const n = c.patient_name_norm || normName(c.patient_name)
    return tcLast.length > 2 && n.split(' ').pop() === tcLast
  })
  if (lastOnly.length === 1) return { record: lastOnly[0], confidence: 'weak', candidates: lastOnly }

  return { record: null, confidence: 'none', candidates: lastOnly }
}

// Build the full reconciliation for one TC patient.
// Collection record wins for owed/collected; TC plan provides the "planned" target.
export function buildPatientJourney(tcPatient, collectionRecords) {
  const link = linkCollectionToPatient(tcPatient, collectionRecords || [])
  const c = link.record

  const planned   = N(tcPatient.total_tx_cost)          // TC's treatment plan total
  const scheduled = N(tcPatient.sched_tx_amount)        // TC: scheduled portion
  const tcDone    = N(tcPatient.tx_completed)           // TC: marked completed

  // Collection record is truth for money owed / collected
  const owed      = c ? N(c.total_expected) : null      // what the office expects to collect
  const collected = c ? N(c.collect_override != null ? c.collect_override : c.amount_collected) : null
  const balanceBf = c ? N(c.balance_bf) : 0

  // Completed value: prefer collection treatments if present, else TC tx_completed
  const completedVal = c && c.treatments && c.treatments.length
    ? c.treatments.reduce((s, t) => s + N(t.fee || t.amount || 0), 0)
    : tcDone

  // Outstanding: what's owed minus what's collected (collection is truth)
  const outstanding = (owed != null && collected != null) ? owed - collected : null

  // Discrepancy flag: TC plan total vs collection owed disagree by >$100
  const planVsOwed = (owed != null && planned > 0) ? owed - planned : null
  const discrepancy = planVsOwed != null && Math.abs(planVsOwed) > 100

  // Journey stage
  const hasAppt   = tcPatient.has_appt === 'Yes' || !!tcPatient.appt_1
  let stage = 'presented'
  if (collected != null && owed != null && collected >= owed - 1 && owed > 0) stage = 'collected'
  else if (completedVal > 0 || tcDone > 0)                                    stage = 'treated'
  else if (hasAppt)                                                           stage = 'scheduled'
  else if (planned > 0 || tcPatient.tx_plan)                                  stage = 'presented'
  else                                                                        stage = 'new'

  return {
    link,
    planned, scheduled, tcDone, completedVal,
    owed, collected, balanceBf, outstanding,
    planVsOwed, discrepancy,
    stage,
    hasCollectionData: !!c,
    appt1: tcPatient.appt_1 || null,
    appt2: tcPatient.appt_2 || null,
    apptHyg: tcPatient.appt_hyg || null,
  }
}


// ════════════════════════════════════════════════════════════════════════════
// NP PATIENT FLOW — appointment sequence + structured call log + prepayments
// Additive model: new structured arrays layer over the legacy flat fields.
// Legacy appt_1/appt_2/appt_hyg and call_1/2/3 keep working; these read them in.
// Spec: BSBD NP Patient Flow Master Build Spec v1.0
// ════════════════════════════════════════════════════════════════════════════

// ── Appointment status flow: planned → booked → showed → completed | missed ──
export const APPT_STATUSES = ['planned', 'booked', 'showed', 'completed', 'missed']
export const APPT_TYPES    = ['Treatment', 'SRP / Perio', 'Restorative', 'Hygiene', 'Consult', 'Follow-up', 'Other']

// ── Call-log outcomes (structured) ──────────────────────────────────────────
export const CALL_OUTCOMES = ['Reached', 'Left voicemail', 'No answer', 'Scheduled', 'Finance pending', 'Not interested']

// ── Prepayment methods ──────────────────────────────────────────────────────
export const PREPAY_METHODS = ['Cash', 'Check', 'Credit Card', 'CareCredit', 'Sunbit', 'Cherry', 'Other']

// ── Lifecycle ───────────────────────────────────────────────────────────────
export const NP_LIFECYCLE = ['active', 'completed', 'closed']
export const CLOSED_REASONS = ['not interested', 'finance', 'moved', 'unreachable', 'other']

// Build the appointment list for a patient, reading structured `appointments`
// if present, otherwise bridging the legacy appt_1/appt_2/appt_hyg fields.
export function getAppointments(p) {
  if (Array.isArray(p.appointments) && p.appointments.length) {
    return p.appointments.map((a, i) => ({ seq: i, type: 'Treatment', status: 'booked', time: '', ...a }))
  }
  // Bridge legacy flat fields into the sequence shape
  const out = []
  const showed = p.has_appt === 'Yes'
  if (p.appt_1)   out.push({ seq:0, type:'Treatment', date:p.appt_1,   time:'', status: showed ? 'showed' : 'booked', legacy:true })
  if (p.appt_2)   out.push({ seq:1, type:'Treatment', date:p.appt_2,   time:'', status:'booked', legacy:true })
  if (p.appt_hyg) out.push({ seq:2, type:'Hygiene',   date:p.appt_hyg, time:'', status:'booked', legacy:true })
  return out
}

// The accepted-treatment appointment is appt #1 — its showed status IS conversion.
export function getConversionAppt(p) {
  const appts = getAppointments(p)
  return appts.length ? appts[0] : null
}

// Structured call log, bridging legacy call_1/2/3 fields.
export function getCallLog(p) {
  if (Array.isArray(p.call_log) && p.call_log.length) {
    return [...p.call_log].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  }
  const out = []
  for (let i = 1; i <= 3; i++) {
    const d = p[`call_${i}_date`]
    if (d) out.push({
      date: d, by: p[`call_${i}_by`] || '', legacy:true,
      outcome: p[`call_${i}_outcome`] || '', note: p[`call_${i}_notes`] || '',
    })
  }
  return out.sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

export function lastContactAt(p) {
  const log = getCallLog(p)
  return log.length ? log[0].date : null
}

// Prepayment ledger.
export function getPrepayments(p) {
  return Array.isArray(p.prepayments) ? p.prepayments : []
}
export function prepaidTotal(p) {
  return getPrepayments(p).reduce((s, x) => s + N(x.amount), 0)
}

// Patient portion of the plan (three-way split).
export function patientPortion(p) {
  if (p.patient_portion != null && p.patient_portion !== '') return N(p.patient_portion)
  return Math.max(0, N(p.total_tx_cost) - N(p.ins_expected))
}

// ── The reminder engine: F1–F9 flags. Returns the single most-urgent action. ──
export const NP_RULES = {
  uncontactedDays:   2,   // F1
  unbookedCadence:   5,   // F2
  financeCadence:    7,   // F3
  confirmWindow:     2,   // F4 (days before appt)
  untouchedDays:     21,  // F8
  escalationDays:    3,   // days past overdue → manager
}

const FINANCE_TERMS = /carecredit|sunbit|cherry|pre-?auth|financing|waiting on|payment plan|down payment/i

// Returns { flag, level, msg, ageDays } for the most urgent issue, or null.
export function npFlag(p, rules = NP_RULES, todayISO) {
  const today = todayISO || todayStr()
  const daysBetween = (a, b) => Math.floor((new Date(b+'T12:00:00') - new Date(a+'T12:00:00')) / 86400000)
  if (['completed', 'closed'].includes(p.lifecycle) || p.status === 'completed' || p.status === 'closed') return null

  const appts     = getAppointments(p)
  const booked    = appts.filter(a => ['booked','planned'].includes(a.status))
  const hasBooked = booked.length > 0
  const accepted  = p.accepted === true || p.has_appt === 'Yes' || N(p.sched_tx_amount) > 0
  const planExists= N(p.total_tx_cost) > 0 || p.tx_plan
  const callLog   = getCallLog(p)
  const lastC     = lastContactAt(p)
  const prepaid   = prepaidTotal(p) > 0
  const financeHit= FINANCE_TERMS.test((p.notes||'') + ' ' + (p.remarks||'') + ' ' + (p.finance_barrier||'')) || p.finance_stalled

  // F7 — prepaid + unbooked (highest priority)
  if (prepaid && !hasBooked)
    return { flag:'F7', level:'overdue', msg:'Prepaid but NO appointment booked — money in hand, treatment owed', ageDays:0, priority:100 }

  // F5 — stale appointment (data integrity): a date passed with no showed/no-show
  const stale = appts.find(a => a.date && a.date < today && !['showed','completed','missed'].includes(a.status))
  if (stale)
    return { flag:'F5', level:'overdue', msg:`Appointment ${stale.date} passed — mark showed / no-show`, ageDays:daysBetween(stale.date, today), priority:90 }

  // F6 — broken chain: an appt completed, treatment remains, no next booked
  const anyCompleted = appts.some(a => a.status === 'completed')
  const txRemains    = N(p.total_tx_cost) > N(p.tx_completed) + 1
  if (anyCompleted && txRemains && !hasBooked)
    return { flag:'F6', level:'overdue', msg:'Treatment remains on plan, no next appointment booked', ageDays:0, priority:85 }

  // F4 — confirm appointment within window
  const upcoming = booked.filter(a => a.date && a.date >= today).sort((a,b)=>a.date.localeCompare(b.date))[0]
  if (upcoming && !upcoming.confirmed && daysBetween(today, upcoming.date) <= rules.confirmWindow)
    return { flag:'F4', level:'overdue', msg:`Confirm appointment on ${upcoming.date}`, ageDays:0, priority:70 }

  // F2 — accepted plan, nothing booked, past recontact cadence
  if (accepted && !hasBooked) {
    const age = lastC ? daysBetween(lastC, today) : (p.dos ? daysBetween(p.dos, today) : 999)
    if (age >= rules.unbookedCadence)
      return { flag:'F2', level:'overdue', msg:'Accepted treatment, no appointment booked — recontact', ageDays:age, priority:65 }
  }

  // F3 — finance stall, plan exists, unbooked, weekly cadence
  if (financeHit && planExists && !hasBooked) {
    const age = lastC ? daysBetween(lastC, today) : (p.dos ? daysBetween(p.dos, today) : 999)
    if (age >= rules.financeCadence)
      return { flag:'F3', level:'overdue', msg:'Finance stall — follow up on financing', ageDays:age, priority:60 }
  }

  // F1 — new NP uncontacted
  if (!accepted && !callLog.length && p.dos) {
    const age = daysBetween(p.dos, today)
    if (age >= rules.uncontactedDays)
      return { flag:'F1', level:'overdue', msg:'New patient not yet contacted', ageDays:age, priority:55 }
  }

  // F8 — untouched record
  const lastTouch = lastC || p.updated_at?.slice(0,10) || p.dos
  if (lastTouch) {
    const age = daysBetween(lastTouch, today)
    if (age >= rules.untouchedDays)
      return { flag:'F8', level:'due', msg:`No activity in ${age} days`, ageDays:age, priority:30 }
  }

  return null
}

// Is this flag escalated to the manager? (overdue past escalation threshold)
export function isEscalated(flag, rules = NP_RULES) {
  return flag && flag.level === 'overdue' && flag.ageDays >= rules.escalationDays
}
