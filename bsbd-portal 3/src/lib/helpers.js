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
  coll: { nonIns: '', ins: '' }, claims: { sent: '', submitted: '', rejected: '', resolved: '', escalations: '' }, fd: {}, notes: '',
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
