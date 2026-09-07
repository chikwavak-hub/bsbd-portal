// ════════════════════════════════════════════════════════════════════════════
// TC Monthly Patient List Importer  (v2 — header-mapped)
// Reads the NP Treatment Log Excel format for any office, any tab layout.
//
// Why this was rewritten: the previous version read columns by fixed position.
// The real logs vary — some tabs have a "3rd Appt" column, some don't, one
// puts its header on the second row. Any variation shifted the money columns
// so that REMARKS text was parsed as Total Tx Cost. Columns are now located
// by header name, per tab.
// ════════════════════════════════════════════════════════════════════════════

// ── Column aliases (lowercased, trimmed) ──────────────────────────────────
const COLS = {
  doctor:          ['dr', 'doctor'],
  who_tx_plan:     ['who tx plan'],
  dos:             ['dos'],
  patient_name:    ['patient name'],
  patient_phone:   ['contact #', 'contact#', 'contact'],
  exam_type:       ['exam'],
  notes:           ['notes'],
  who_sched:       ['who sched'],
  appt_1:          ['1st appt'],
  appt_2:          ['2nd appt', '2nd appt/fu'],
  appt_3:          ['3rd appt', '3rd app. product', '3rd app product'],
  appt_hyg:        ['hyg appt'],
  has_appt:        ['has appt'],
  email_sent:      ['email sent'],
  call_1:          ['1st call'],
  call_2:          ['2nd call'],
  call_3:          ['3rd call'],
  remarks:         ['remarks'],
  total_tx_cost:   ['total tx cost?', 'total tx cost'],
  sched_tx_amount: ['sched tx $$$', 'sched tx'],
  ins_expected:    ['ins expected amount', 'ins expected'],
  tx_completed:    ['total $ tx completed', 'total tx completed'],
}

// ── Locate the header row and map field → column index ────────────────────
function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const cells = (rows[r] || []).map(c => String(c ?? '').toLowerCase().trim())
    if (!cells.includes('patient name')) continue
    const map = {}
    for (const [field, aliases] of Object.entries(COLS)) {
      const idx = cells.findIndex(h => aliases.includes(h))
      if (idx !== -1) map[field] = idx
    }
    return { headerRow: r, map }
  }
  return null
}

// ── Office detection: filename first, then sheet/tab content ──────────────
const OFFICE_RE = /\b(Dalton|Calhoun|Brainerd|McCallie|Mc Callie)\b/i
function canonOffice(raw) {
  const o = String(raw).replace(/\s+/g, '')
  if (/^mccallie$/i.test(o)) return 'McCallie'
  return o.charAt(0).toUpperCase() + o.slice(1).toLowerCase()
}
export function detectOffice(wb, fileName) {
  const votes = {}
  const vote = m => { if (m) { const o = canonOffice(m[1]); votes[o] = (votes[o] || 0) + 1 } }
  const clean = s => String(s ?? '').replace(/[_\-.]+/g, ' ')
  vote(OFFICE_RE.exec(clean(fileName)))
  try {
    for (const name of wb.SheetNames) {
      vote(OFFICE_RE.exec(clean(name)))
      const rows = wb._rowsFor(name)
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        vote(OFFICE_RE.exec(clean((rows[i] || []).join(' '))))
      }
    }
  } catch { /* best effort */ }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  return ranked.length ? ranked[0][0] : null
}

// ── Value parsers ─────────────────────────────────────────────────────────
export function parseDate(v) {
  if (!v && v !== 0) return ''
  if (v instanceof Date && !isNaN(v)) return isoOf(v)
  const s = String(v).trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  if (!isNaN(Number(s)) && Number(s) > 40000) return isoOf(new Date((Number(s) - 25569) * 86400000))
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return isoOf(new Date(y, +m[1] - 1, +m[2])) }
  return ''
}
function isoOf(d) {
  if (!(d instanceof Date) || isNaN(d)) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Appointment cells can hold junk: "6/2 & 6/3. (yes) 9/10/26", "3/12/26(yes)".
// Take the first real date; report whether a "(yes)" showed-marker was present.
export function parseApptCell(v, contextYear) {
  if (!v && v !== 0) return { date: '', showed: false }
  if (v instanceof Date && !isNaN(v)) return { date: isoOf(v), showed: false }
  const s = String(v).trim()
  if (/^(yes|no|broken|n\/a)$/i.test(s)) return { date: '', showed: /^yes$/i.test(s) }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return { date: `${iso[1]}-${iso[2]}-${iso[3]}`, showed: /\(\s*yes\s*\)/i.test(s) }
  const m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/)
  if (m) {
    let y = m[3] ? +m[3] : contextYear
    if (y != null && y < 100) y += 2000
    if (y == null) return { date: '', showed: false }
    return { date: isoOf(new Date(y, +m[1] - 1, +m[2])), showed: /\(\s*yes\s*\)/i.test(s) }
  }
  return { date: '', showed: false }
}

// Call cells: "~ Jun 8, 2026 ~ Called to sch, lv vm. zr"
export function parseCall(v) {
  if (!v && v !== 0) return { date: '', notes: '' }
  if (v instanceof Date && !isNaN(v)) return { date: isoOf(v), notes: '' }
  const s = String(v).trim()
  const m = s.match(/^~\s*([^~]+?)\s*~\s*([\s\S]*)$/)
  if (m) {
    const d = new Date(m[1].trim())
    return { date: isNaN(d) ? '' : isoOf(d), notes: m[2].trim() }
  }
  const d = parseDate(v)
  return d ? { date: d, notes: '' } : { date: '', notes: s }
}

// Money: a number, or null. Never strip letters out of prose and keep digits.
export function parseMoney(v) {
  if (v == null || v === '') return { value: null, note: null }
  if (typeof v === 'number') return { value: isFinite(v) ? v : null, note: null }
  const s = String(v).trim()
  if (!s) return { value: null, note: null }
  const cleaned = s.replace(/[$,\s]/g, '')
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: parseFloat(cleaned), note: null }
  return { value: null, note: s }   // text stays text — flagged, not counted
}

// ── Deterministic id so re-imports merge instead of duplicating ───────────
export function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
}
export function stableId(key) {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  return 'tp_' + h.toString(36) + '_' + key.replace(/[^a-z0-9]/g, '').slice(0, 10)
}

// ── Month tab label → YYYY-MM ─────────────────────────────────────────────
const MONTH_MAP = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
function sheetNameToMonth(name) {
  const m = String(name).toLowerCase().match(/([a-z]+)\s*'?\s*(\d{2,4})/)
  if (!m) return null
  const mo = MONTH_MAP[m[1].slice(0, 3)]
  if (!mo) return null
  const yr = m[2].length === 2 ? '20' + m[2] : m[2]
  return yr + '-' + String(mo).padStart(2, '0')
}

// ── Main import ───────────────────────────────────────────────────────────
// office = the office selected on screen; used only as a fallback when the
// file itself names no office. Detection wins. Returns detectedOffice so the
// caller can confirm before writing.
export async function importTcExcel(file, office, XLSXinjected) {
  const XLSX = XLSXinjected || await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

  const buf = await file.arrayBuffer()
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true })

  const sheetRows = {}
  for (const n of wb.SheetNames) {
    sheetRows[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })
  }
  wb._rowsFor = n => sheetRows[n] || []

  const detectedOffice = detectOffice(wb, file.name)
  const useOffice = detectedOffice || office || 'Dalton'

  const results = []
  const errors  = []
  const moneyFlags = []
  const skipped = []

  for (const sheetName of wb.SheetNames) {
    if (sheetName.toLowerCase() === 'master') continue
    const monthTab = sheetNameToMonth(sheetName)
    if (!monthTab) continue
    const contextYear = +monthTab.slice(0, 4)

    const rows = sheetRows[sheetName]
    const hdr  = findHeader(rows)
    if (!hdr) { errors.push(`Tab "${sheetName}": no header row found — tab skipped`); continue }
    const col = hdr.map
    if (col.patient_name == null) { errors.push(`Tab "${sheetName}": no Patient Name column — tab skipped`); continue }

    const patients = []
    for (let i = hdr.headerRow + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c === '' || c == null)) continue
      const at = f => (col[f] != null ? row[col[f]] : '')

      const nameRaw = String(at('patient_name') ?? '').trim()
      if (!nameRaw || nameRaw.toLowerCase() === 'patient name') continue

      try {
        const dos = parseDate(at('dos'))
        if (!dos) { skipped.push({ tab: sheetName, row: i + 1, name: nameRaw, reason: 'no readable DOS' }); continue }

        const a1 = parseApptCell(at('appt_1'),   contextYear)
        const a2 = parseApptCell(at('appt_2'),   contextYear)
        const a3 = parseApptCell(at('appt_3'),   contextYear)
        const ah = parseApptCell(at('appt_hyg'), contextYear)

        const c1 = parseCall(at('call_1'))
        const c2 = parseCall(at('call_2'))
        const c3 = parseCall(at('call_3'))

        const money = {}
        for (const f of ['total_tx_cost', 'sched_tx_amount', 'ins_expected', 'tx_completed']) {
          const { value, note } = parseMoney(at(f))
          money[f] = value
          if (note) moneyFlags.push({ tab: sheetName, row: i + 1, name: nameRaw, field: f, text: note })
        }

        const phone = (() => {
          const raw = String(at('patient_phone') ?? '').replace(/\.0$/, '').replace(/\D/g, '').slice(-10)
          return raw.length === 10 ? `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}` : raw
        })()

        const hasApptRaw = String(at('has_appt') ?? '').trim()
        const anyAppt = !!(a1.date || a2.date || a3.date || ah.date)

        patients.push({
          id:              stableId(`${normName(nameRaw)}|${dos}|${useOffice.toLowerCase()}`),
          office:          useOffice,
          doctor:          String(at('doctor') ?? '').trim(),
          who_tx_plan:     String(at('who_tx_plan') ?? '').trim(),
          dos,
          month_tab:       monthTab,
          patient_name:    nameRaw,
          patient_phone:   phone,
          patient_email:   '',
          exam_type:       String(at('exam_type') ?? '').trim(),
          notes:           String(at('notes') ?? '').trim(),
          who_sched:       String(at('who_sched') ?? '').trim(),
          appt_1:          a1.date,
          appt_2:          a2.date,
          appt_3:          a3.date,
          appt_hyg:        ah.date,
          has_appt:        /^(yes|no|partial)$/i.test(hasApptRaw)
                             ? hasApptRaw.charAt(0).toUpperCase() + hasApptRaw.slice(1).toLowerCase()
                             : (anyAppt ? 'Yes' : 'No'),
          email_sent:      String(at('email_sent') ?? '').trim(),
          call_1_date: c1.date, call_1_notes: c1.notes,
          call_2_date: c2.date, call_2_notes: c2.notes,
          call_3_date: c3.date, call_3_notes: c3.notes,
          remarks:         String(at('remarks') ?? '').trim(),
          total_tx_cost:   money.total_tx_cost   ?? 0,
          sched_tx_amount: money.sched_tx_amount ?? 0,
          ins_expected:    money.ins_expected    ?? 0,
          tx_completed:    money.tx_completed    ?? 0,
          finance_stalled: false,
          finance_barrier: '',
          status:          'consult',
          tx_plan:         null,
          visits:          [],
          created_at:      new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        })
      } catch (e) {
        errors.push(`Row ${i + 1} in ${sheetName}: ${e.message}`)
      }
    }

    if (patients.length) results.push({ month: monthTab, sheetName, patients })
  }

  return {
    results,
    errors,
    skipped,
    moneyFlags,
    detectedOffice,
    office: useOffice,
    total: results.reduce((s, r) => s + r.patients.length, 0),
  }
}
