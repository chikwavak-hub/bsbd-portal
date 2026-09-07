// ════════════════════════════════════════════════════════════════════════════
// TC Monthly Patient List Importer  (v3 — dual format, header-mapped)
//
// Handles two different workbooks:
//   FORMAT A "nplog"    — NP Treatment Log   (Dalton style)
//   FORMAT B "npreport" — New Patient Report (McCallie style)
//
// Columns are located by header NAME, per tab, never by fixed position. Tab
// layouts vary within a single workbook (extra columns, headers on row 2, tab
// names with or without a year), so every tab is mapped independently.
// ════════════════════════════════════════════════════════════════════════════

const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// ── FORMAT A: NP Treatment Log ────────────────────────────────────────────
const COLS_NPLOG = {
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

// ── FORMAT B: New Patient Report ──────────────────────────────────────────
// Repeated headers ("SCH AMOUT" x3, "SHOW" x3) are resolved by position:
// each appointment column claims the next SCH AMOUT / SHOW that follows it.
const COLS_NPREPORT = {
  dos:            ['dos'],
  doctor:         ['dr', 'doctor'],
  patient_name:   ['patient name'],
  patient_phone:  ['phone number', 'phone'],
  exam_type:      ['exam'],
  presented_by:   ['presented by'],
  total_plan:     ['total treatment plan'],
  ins_adjust:     ['insurance adjustment'],
  total_after:    ['total treatment after adjusment', 'total treatment after adjustment'],
  disposition:    ['accepted or declined'],
  remaining:      ['remaining treatment $', 'remaining treatment'],
  follow_up:      ['follow up'],
  notes:          ['notes'],
  email_sent:     ['email sent'],
}
const APPT_HEADS = [
  { field: 'appt_1', aliases: ['1st appt'] },
  { field: 'appt_2', aliases: ['2nds appt', '2nd appt'] },
  { field: 'appt_3', aliases: ['3rd appt'] },
]

function mapSimple(cells, spec) {
  const map = {}
  for (const [field, aliases] of Object.entries(spec)) {
    const idx = cells.findIndex(h => aliases.includes(h))
    if (idx !== -1) map[field] = idx
  }
  return map
}

function mapApptBlocks(cells) {
  const blocks = []
  for (const { field, aliases } of APPT_HEADS) {
    const at = cells.findIndex(h => aliases.includes(h))
    if (at === -1) continue
    let amt = null, show = null
    for (let j = at + 1; j < cells.length && j <= at + 4; j++) {
      const h = cells[j]
      if (APPT_HEADS.some(a => a.aliases.includes(h))) break
      if (amt === null && (h === 'sch amout' || h === 'sch amount')) { amt = j; continue }
      if (show === null && h === 'show') { show = j }
    }
    blocks.push({ field, dateCol: at, amtCol: amt, showCol: show })
  }
  return blocks
}

function detectFormat(cells) {
  if (cells.includes('accepted or declined') || cells.includes('presented by')) return 'npreport'
  return 'nplog'
}

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 6); r++) {
    const cells = (rows[r] || []).map(norm)
    if (!cells.includes('patient name')) continue
    return { headerRow: r, cells, format: detectFormat(cells) }
  }
  return null
}

// ── Office detection ──────────────────────────────────────────────────────
const OFFICE_RE = /\b(Dalton|Calhoun|Brainerd|McCallie|Mc Callie)\b/i
function canonOffice(raw) {
  const o = String(raw).replace(/\s+/g, '')
  if (/^mccallie$/i.test(o)) return 'McCallie'
  return o.charAt(0).toUpperCase() + o.slice(1).toLowerCase()
}
export function detectOffice(wb, fileName, rowsFor) {
  const votes = {}
  const vote = m => { if (m) { const o = canonOffice(m[1]); votes[o] = (votes[o] || 0) + 1 } }
  const clean = s => String(s ?? '').replace(/[_\-.]+/g, ' ')
  vote(OFFICE_RE.exec(clean(fileName)))
  try {
    for (const name of wb.SheetNames) {
      vote(OFFICE_RE.exec(clean(name)))
      const rows = rowsFor(name)
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        vote(OFFICE_RE.exec(clean((rows[i] || []).join(' '))))
      }
    }
  } catch { /* best effort */ }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1])
  return ranked.length ? ranked[0][0] : null
}

// ── Value parsers ─────────────────────────────────────────────────────────
function isoOf(d) {
  if (!(d instanceof Date) || isNaN(d)) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
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
    if (y == null) return { date: '', showed: false }
    if (y < 100) y += 2000
    return { date: isoOf(new Date(y, +m[1] - 1, +m[2])), showed: /\(\s*yes\s*\)/i.test(s) }
  }
  return { date: '', showed: false }
}
export function parseCall(v) {
  if (!v && v !== 0) return { date: '', notes: '' }
  if (v instanceof Date && !isNaN(v)) return { date: isoOf(v), notes: '' }
  const s = String(v).trim()
  const m = s.match(/^~\s*([^~]+?)\s*~\s*([\s\S]*)$/)
  if (m) { const d = new Date(m[1].trim()); return { date: isNaN(d) ? '' : isoOf(d), notes: m[2].trim() } }
  const d = parseDate(v)
  return d ? { date: d, notes: '' } : { date: '', notes: s }
}
// Money: a number, or null. Never harvest digits out of prose.
export function parseMoney(v) {
  if (v == null || v === '') return { value: null, note: null }
  if (typeof v === 'number') return { value: isFinite(v) ? v : null, note: null }
  const s = String(v).trim()
  if (!s) return { value: null, note: null }
  if (/^#(VALUE|REF|DIV\/0|N\/A|NAME)/i.test(s)) return { value: null, note: s }
  const cleaned = s.replace(/[$,\s]/g, '')
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: parseFloat(cleaned), note: null }
  return { value: null, note: s }
}
export function parsePhone(v) {
  const raw = String(v ?? '').replace(/\.0$/, '').replace(/\D/g, '').slice(-10)
  return raw.length === 10 ? `(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}` : raw
}
// "Lucas,Mary " → "Mary Lucas"; strips stray newlines and trailing asterisks.
export function cleanName(v) {
  let s = String(v ?? '').replace(/\s+/g, ' ').replace(/\*+$/, '').trim()
  const m = s.match(/^([^,]+),\s*(.+)$/)
  if (m) s = `${m[2].trim()} ${m[1].trim()}`
  return s.trim()
}
// ACCCEPTED / DEDCLINED / DECLINE all normalise; anything else is kept as a label.
export function parseDisposition(v) {
  const s = norm(v)
  if (!s) return { accepted: null, label: '' }
  if (s.includes('ccept')) return { accepted: true, label: 'Accepted' }
  if (s.includes('clin')) return { accepted: false, label: 'Declined' }
  return { accepted: null, label: String(v).trim() }
}

export function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
}
export function stableId(key) {
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  return 'tp_' + h.toString(36) + '_' + key.replace(/[^a-z0-9]/g, '').slice(0, 10)
}

// ── Tab name → YYYY-MM. Year optional; falls back to the workbook year ─────
const MONTH_MAP = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
export function sheetNameToMonth(name, fallbackYear) {
  const s = String(name).toLowerCase().trim()
  const m = s.match(/([a-z]+)\s*'?\s*(\d{2,4})?/)
  if (!m) return null
  const mo = MONTH_MAP[m[1].slice(0, 3)]
  if (!mo) return null
  let yr
  if (m[2]) yr = m[2].length === 2 ? '20' + m[2] : m[2]
  else if (fallbackYear) yr = String(fallbackYear)
  else return null
  return yr + '-' + String(mo).padStart(2, '0')
}
function guessWorkbookYear(fileName, wb, rowsFor) {
  let m = String(fileName ?? '').match(/(20\d{2})/)
  if (m) return +m[1]
  for (const n of wb.SheetNames) {
    const rows = rowsFor(n)
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      m = (rows[i] || []).join(' ').match(/(20\d{2})/)
      if (m) return +m[1]
    }
  }
  return null
}

// ── Main import ───────────────────────────────────────────────────────────
export async function importTcExcel(file, office, XLSXinjected) {
  const XLSX = XLSXinjected || await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

  const buf = await file.arrayBuffer()
  const wb  = XLSX.read(buf, { type: 'array', cellDates: true })

  const sheetRows = {}
  for (const n of wb.SheetNames) {
    sheetRows[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })
  }
  const rowsFor = n => sheetRows[n] || []

  const detectedOffice = detectOffice(wb, file.name, rowsFor)
  const useOffice = detectedOffice || office || 'Dalton'
  const wbYear = guessWorkbookYear(file.name, wb, rowsFor)

  const results = [], errors = [], moneyFlags = [], skipped = []
  const formats = new Set()

  for (const sheetName of wb.SheetNames) {
    if (norm(sheetName) === 'master') continue
    const monthTab = sheetNameToMonth(sheetName, wbYear)
    if (!monthTab) continue
    const contextYear = +monthTab.slice(0, 4)

    const rows = rowsFor(sheetName)
    const hdr = findHeader(rows)
    if (!hdr) { errors.push(`Tab "${sheetName.trim()}": no header row found — tab skipped`); continue }
    formats.add(hdr.format)

    const patients = []
    const flagMoney = (i, name, field, note) =>
      moneyFlags.push({ tab: sheetName.trim(), row: i + 1, name, field, text: note })

    for (let i = hdr.headerRow + 1; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every(c => c === '' || c == null)) continue
      if (/^week\b/i.test(String(row[0] ?? '').trim())) continue   // "WEEK 1" separators

      if (hdr.format === 'nplog') {
        const col = mapSimple(hdr.cells, COLS_NPLOG)
        const at = f => (col[f] != null ? row[col[f]] : '')
        const nameRaw = cleanName(at('patient_name'))
        if (!nameRaw || norm(nameRaw) === 'patient name') continue
        try {
          const dos = parseDate(at('dos'))
          if (!dos) { skipped.push({ tab: sheetName.trim(), row: i + 1, name: nameRaw, reason: 'no readable DOS' }); continue }
          const a1 = parseApptCell(at('appt_1'), contextYear)
          const a2 = parseApptCell(at('appt_2'), contextYear)
          const a3 = parseApptCell(at('appt_3'), contextYear)
          const ah = parseApptCell(at('appt_hyg'), contextYear)
          const c1 = parseCall(at('call_1')), c2 = parseCall(at('call_2')), c3 = parseCall(at('call_3'))
          const money = {}
          for (const f of ['total_tx_cost', 'sched_tx_amount', 'ins_expected', 'tx_completed']) {
            const { value, note } = parseMoney(at(f))
            money[f] = value
            if (note) flagMoney(i, nameRaw, f, note)
          }
          const hasApptRaw = String(at('has_appt') ?? '').trim()
          const anyAppt = !!(a1.date || a2.date || a3.date || ah.date)
          patients.push(base({
            nameRaw, dos, monthTab, office: useOffice,
            doctor: String(at('doctor') ?? '').trim(),
            who_tx_plan: String(at('who_tx_plan') ?? '').trim(),
            who_sched: String(at('who_sched') ?? '').trim(),
            patient_phone: parsePhone(at('patient_phone')),
            exam_type: String(at('exam_type') ?? '').trim(),
            notes: String(at('notes') ?? '').trim(),
            remarks: String(at('remarks') ?? '').trim(),
            appt_1: a1.date, appt_2: a2.date, appt_3: a3.date, appt_hyg: ah.date,
            has_appt: /^(yes|no|partial)$/i.test(hasApptRaw)
              ? hasApptRaw.charAt(0).toUpperCase() + hasApptRaw.slice(1).toLowerCase()
              : (anyAppt ? 'Yes' : 'No'),
            email_sent: String(at('email_sent') ?? '').trim(),
            call_1_date: c1.date, call_1_notes: c1.notes,
            call_2_date: c2.date, call_2_notes: c2.notes,
            call_3_date: c3.date, call_3_notes: c3.notes,
            total_tx_cost: money.total_tx_cost ?? 0,
            sched_tx_amount: money.sched_tx_amount ?? 0,
            ins_expected: money.ins_expected ?? 0,
            tx_completed: money.tx_completed ?? 0,
            accepted: null,
          }))
        } catch (e) { errors.push(`Row ${i + 1} in ${sheetName.trim()}: ${e.message}`) }

      } else {
        const col = mapSimple(hdr.cells, COLS_NPREPORT)
        const blocks = mapApptBlocks(hdr.cells)
        const at = f => (col[f] != null ? row[col[f]] : '')
        const nameRaw = cleanName(at('patient_name'))
        if (!nameRaw || norm(nameRaw) === 'patient name') continue
        try {
          const dos = parseDate(at('dos'))
          if (!dos) { skipped.push({ tab: sheetName.trim(), row: i + 1, name: nameRaw, reason: 'no readable DOS' }); continue }

          const appts = {}
          let schedTotal = 0, showedTotal = 0
          for (const b of blocks) {
            appts[b.field] = parseApptCell(row[b.dateCol], contextYear).date
            if (b.amtCol == null) continue
            const { value, note } = parseMoney(row[b.amtCol])
            if (note) flagMoney(i, nameRaw, `${b.field} sch amount`, note)
            if (value == null) continue
            schedTotal += value
            const showRaw = b.showCol != null ? norm(row[b.showCol]) : ''
            if (showRaw.startsWith('y')) showedTotal += value
          }

          const plan = parseMoney(at('total_plan'))
          if (plan.note) flagMoney(i, nameRaw, 'total_tx_cost', plan.note)
          const insAdj = parseMoney(at('ins_adjust'))
          if (insAdj.note) flagMoney(i, nameRaw, 'ins_expected', insAdj.note)

          const disp = parseDisposition(at('disposition'))
          const followUp = parseCall(at('follow_up'))
          const remarkBits = []
          if (disp.accepted === null && disp.label) remarkBits.push(disp.label)
          if (followUp.notes) remarkBits.push(followUp.notes)

          const anyAppt = Object.values(appts).some(Boolean)
          patients.push(base({
            nameRaw, dos, monthTab, office: useOffice,
            doctor: String(at('doctor') ?? '').trim(),
            who_tx_plan: String(at('presented_by') ?? '').trim(),
            who_sched: String(at('presented_by') ?? '').trim(),
            patient_phone: parsePhone(at('patient_phone')),
            exam_type: String(at('exam_type') ?? '').trim(),
            notes: String(at('notes') ?? '').trim(),
            remarks: remarkBits.join(' | '),
            appt_1: appts.appt_1 || '', appt_2: appts.appt_2 || '', appt_3: appts.appt_3 || '',
            appt_hyg: '',
            has_appt: anyAppt ? 'Yes' : 'No',
            email_sent: String(at('email_sent') ?? '').trim(),
            call_1_date: followUp.date, call_1_notes: followUp.notes,
            call_2_date: '', call_2_notes: '',
            call_3_date: '', call_3_notes: '',
            total_tx_cost: plan.value ?? 0,
            sched_tx_amount: schedTotal,
            ins_expected: insAdj.value ?? 0,
            tx_completed: showedTotal,   // INFERRED: scheduled amounts marked SHOW = YES
            accepted: disp.accepted,
          }))
        } catch (e) { errors.push(`Row ${i + 1} in ${sheetName.trim()}: ${e.message}`) }
      }
    }

    if (patients.length) results.push({ month: monthTab, sheetName: sheetName.trim(), patients })
  }

  return {
    results, errors, skipped, moneyFlags,
    detectedOffice, office: useOffice,
    formats: [...formats],
    total: results.reduce((s, r) => s + r.patients.length, 0),
  }
}

// Shared record shape — matches the tc_patients columns the app already reads.
function base(f) {
  return {
    id: stableId(`${normName(f.nameRaw)}|${f.dos}|${f.office.toLowerCase()}`),
    office: f.office,
    doctor: f.doctor,
    who_tx_plan: f.who_tx_plan,
    dos: f.dos,
    month_tab: f.monthTab,
    patient_name: f.nameRaw,
    patient_phone: f.patient_phone,
    patient_email: '',
    exam_type: f.exam_type,
    notes: f.notes,
    who_sched: f.who_sched,
    appt_1: f.appt_1, appt_2: f.appt_2, appt_3: f.appt_3, appt_hyg: f.appt_hyg,
    has_appt: f.has_appt,
    email_sent: f.email_sent,
    call_1_date: f.call_1_date, call_1_notes: f.call_1_notes,
    call_2_date: f.call_2_date, call_2_notes: f.call_2_notes,
    call_3_date: f.call_3_date, call_3_notes: f.call_3_notes,
    remarks: f.remarks,
    total_tx_cost: f.total_tx_cost,
    sched_tx_amount: f.sched_tx_amount,
    ins_expected: f.ins_expected,
    tx_completed: f.tx_completed,
    accepted: f.accepted,
    finance_stalled: false,
    finance_barrier: '',
    status: 'consult',
    tx_plan: null,
    visits: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}
