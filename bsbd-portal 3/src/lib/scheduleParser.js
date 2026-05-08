// ════════════════════════════════════════════════════════════════════════════
// DENTRIX POWER REPORTING — SCHEDULE DATA REPORT PARSER
// Supports PDF, CSV, and Excel (.xlsx) exports
//
// Expected columns (any order, fuzzy matched):
//   Patient | Date | Appt Time | Provider | Scheduled? | Operatory
//   Proc. Code | Pat. Prim. Carrier | Appt Status
// ════════════════════════════════════════════════════════════════════════════

const OFFICE_MAP = {
  'BRAINERD':'Brainerd','DALTON':'Dalton',
  'CALHOUN':'Calhoun','MCCALLIE':'McCallie','MC CALLIE':'McCallie'
}

// ── Shared helpers ─────────────────────────────────────────────────────────
function detectOffice(text) {
  const up = (text||'').toUpperCase()
  for (const [k,v] of Object.entries(OFFICE_MAP)) if (up.includes(k)) return v
  return null
}

function parseDate(str) {
  if (!str) return null
  // MM/DD/YYYY
  const m1 = String(str).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m1) return `${m1[3]}-${m1[1].padStart(2,'0')}-${m1[2].padStart(2,'0')}`
  // YYYY-MM-DD already
  const m2 = String(str).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m2) return str
  // Excel serial date number
  if (typeof str === 'number' && str > 40000) {
    const d = new Date(Math.round((str - 25569) * 86400 * 1000))
    return d.toISOString().slice(0,10)
  }
  return null
}

function formatName(dentrixName) {
  // "Aguilar, Cynthia" → "Cynthia Aguilar"
  // "Chikwava, DDS, Kudzai" → "Kudzai Chikwava"
  if (!dentrixName) return ''
  const parts = dentrixName.split(',').map(p => p.trim()).filter(Boolean)
  if (parts.length >= 2) return `${parts[parts.length-1]} ${parts[0]}`
  return dentrixName.trim()
}

function cleanCode(code) {
  if (!code) return null
  const s = String(code).trim()
  if (s.includes('Not Available') || s.includes('spaces etc') || s === '') return null
  return s
}

function cleanCarrier(carrier) {
  if (!carrier) return ''
  const s = String(carrier).trim()
  if (s === 'Not Available' || s === '') return ''
  return s
}

function normalizeName(name) {
  return name.replace(/[^A-Za-z\s]/g,'').trim().toUpperCase()
}

// ── GROUP rows → patients ──────────────────────────────────────────────────
// Each appointment can have multiple procedure rows — group by name+date+time+op
function groupIntoPatients(rows, office, reportDate) {
  const patMap = new Map()

  for (const row of rows) {
    const name     = formatName(row.patient || '')
    if (!name || name === 'Patient' || name.toLowerCase().includes('total')) continue

    const date     = parseDate(row.date) || reportDate
    const time     = (row.appt_time || '').trim()
    const op       = (row.operatory || '').trim()
    const provider = formatName(row.provider || '')
    const code     = cleanCode(row.proc_code)
    const carrier  = cleanCarrier(row.carrier)
    const status   = (row.appt_status || '').trim()
    const sched    = (row.scheduled || '').trim()

    const key = `${normalizeName(name)}|${date}|${time}|${op}`

    if (!patMap.has(key)) {
      patMap.set(key, {
        id:               'cp_rdg_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
        patient_name:     name,
        patient_name_norm:normalizeName(name),
        operatory:        op,
        provider:         provider,
        appt_time:        time,
        ins_carrier:      carrier,
        ins_status:       carrier ? 'ACTIVE INS' : '',
        appt_status:      status,
        treatments:       [],
        total_expected:   0,
        amount_collected: 0,
        status:           status === 'Broken' ? 'broken' : status === 'No Show' ? 'broken' : 'pending',
        flags_total:      0,
        flags_done:       0,
        claim_notes:      [],
        is_new_patient:   false,
        is_unconfirmed:   sched === 'Unscheduled',
        is_hygiene:       op.toLowerCase().includes('hyg') || provider.toLowerCase().includes('hygienist'),
        date:             date || '',
        office:           office || '',
      })
    }

    const pt = patMap.get(key)
    if (code) {
      pt.treatments.push({ code, desc:'', tooth:'', fee:0, pt_pct:'', pt_amount:0 })
    }
    // Fill carrier if first row was blank
    if (!pt.ins_carrier && carrier) {
      pt.ins_carrier = carrier
      pt.ins_status  = 'ACTIVE INS'
    }
  }

  return Array.from(patMap.values())
}

// ══════════════════════════════════════════════════════════════════════════
// PDF PARSER
// ══════════════════════════════════════════════════════════════════════════
const PDF_COL = { NAME:71, DATE:148, TIME:190, PROVIDER:233, SCHED:304, OP:348, CODE:432, CARRIER:510, STATUS:621 }
const PDF_TOL = 22

function pdfColOf(x) {
  for (const [k,cx] of Object.entries(PDF_COL)) if (Math.abs(x-cx) <= PDF_TOL) return k
  return null
}

async function extractPdfItems(file) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const buf = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise
  const pages = []
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    const vp      = page.getViewport({ scale: 1 })
    pages.push(content.items
      .filter(i => i.str && i.str.trim())
      .map(i => ({ text: i.str.trim(), x: Math.round(i.transform[4]), y: Math.round(vp.height - i.transform[5]) }))
    )
  }
  return pages
}

async function parsePdf(file) {
  const pages  = await extractPdfItems(file)
  const rows   = []
  let office   = null
  let date     = null
  let lastPatientRow = null  // track last patient row for continuations

  for (const items of pages) {
    const title = items.find(i => i.y < 30 && i.text.includes('Schedule Data Report'))
    if (!office && title) office = detectOffice(title.text)

    // Group by Y row
    const yRows = []
    for (const item of [...items].sort((a,b)=>a.y-b.y||a.x-b.x)) {
      if (item.y < 85 || item.y > 570) continue
      const r = yRows.find(r => Math.abs(r.y-item.y) <= 3)
      if (r) r.cells.push(item)
      else yRows.push({ y: item.y, cells: [item] })
    }

    for (const yRow of yRows) {
      const cells = {}
      for (const cell of yRow.cells) {
        const col = pdfColOf(cell.x)
        if (col) cells[col] = cell.text
      }

      // Skip column header row
      if (cells.NAME === 'Patient') continue
      // Reset on Total rows
      if (cells.SCHED && cells.SCHED.includes('Total')) { lastPatientRow = null; continue }
      if (cells.NAME === 'Grand Total') { lastPatientRow = null; continue }

      // New patient row — has NAME + DATE
      if (cells.NAME && cells.DATE && parseDate(cells.DATE)) {
        const parsedDate = parseDate(cells.DATE)
        if (!date && parsedDate) date = parsedDate
        const newRow = {
          patient:    cells.NAME,
          date:       cells.DATE,
          appt_time:  cells.TIME,
          provider:   cells.PROVIDER,
          scheduled:  cells.SCHED,
          operatory:  cells.OP,
          proc_code:  cells.CODE,
          carrier:    cells.CARRIER,
          appt_status:cells.STATUS,
        }
        rows.push(newRow)
        lastPatientRow = newRow
        continue
      }

      // Continuation row — same patient, additional procedure
      // Has CODE but no NAME/DATE — inherit patient info from lastPatientRow
      if (!cells.NAME && cells.CODE && lastPatientRow) {
        rows.push({
          patient:    lastPatientRow.patient,
          date:       lastPatientRow.date,
          appt_time:  lastPatientRow.appt_time,
          provider:   lastPatientRow.provider,
          scheduled:  lastPatientRow.scheduled,
          operatory:  cells.OP || lastPatientRow.operatory,
          proc_code:  cells.CODE,
          carrier:    cells.CARRIER || lastPatientRow.carrier,
          appt_status:cells.STATUS || lastPatientRow.appt_status,
        })
      }
    }
    // Reset between pages — last patient on previous page might continue on next
    // but these reports use "Scheduled Total" as clear separators so this is safe
  }

  return { appointments: groupIntoPatients(rows, office, date), date, office }
}

// ══════════════════════════════════════════════════════════════════════════
// CSV PARSER
// ══════════════════════════════════════════════════════════════════════════
function parseCSVLine(line) {
  const result = []
  let field = '', inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { field += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(field.trim()); field = ''
    } else field += ch
  }
  result.push(field.trim())
  return result
}

function mapHeaders(headers) {
  // Fuzzy map header names to our internal keys
  const MAP = {
    patient: ['patient','patient name'],
    date: ['date'],
    appt_time: ['appt time','appointment time','time'],
    provider: ['provider'],
    scheduled: ['scheduled?','scheduled'],
    operatory: ['operatory','op'],
    proc_code: ['proc. code','proc code','procedure code','code'],
    carrier: ['pat. prim. carrier','carrier','insurance','primary carrier'],
    appt_status: ['appt status','status','appointment status'],
  }
  const result = {}
  headers.forEach((h, i) => {
    const hl = h.toLowerCase().trim()
    for (const [key, aliases] of Object.entries(MAP)) {
      if (aliases.some(a => hl.includes(a))) { result[key] = i; break }
    }
  })
  return result
}

async function parseCsv(file) {
  const text    = await file.text()
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return { appointments: [], date: null, office: null }

  // Detect office from first line or filename
  let office = detectOffice(file.name) || detectOffice(lines[0])

  // Find header row
  let headerIdx = 0
  for (let i = 0; i < Math.min(5, lines.length); i++) {
    if (lines[i].toLowerCase().includes('patient') && lines[i].toLowerCase().includes('date')) {
      headerIdx = i; break
    }
  }
  const headers = parseCSVLine(lines[headerIdx])
  const colMap  = mapHeaders(headers)

  const rows = []
  let date   = null
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i])
    if (cells.length < 3) continue
    const row = {}
    for (const [key, idx] of Object.entries(colMap)) row[key] = cells[idx] || ''
    if (!row.patient || row.patient.toLowerCase().includes('total')) continue
    const d = parseDate(row.date)
    if (!date && d) date = d
    rows.push(row)
  }

  return { appointments: groupIntoPatients(rows, office, date), date, office }
}

// ══════════════════════════════════════════════════════════════════════════
// EXCEL PARSER
// ══════════════════════════════════════════════════════════════════════════
async function parseExcel(file) {
  const XLSX    = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
  const wb      = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const office  = detectOffice(file.name) || detectOffice(wb.SheetNames[0])

  // Use first sheet that looks like schedule data
  const sheetName = wb.SheetNames.find(n =>
    !n.toLowerCase().includes('about') && !n.toLowerCase().includes('meta')
  ) || wb.SheetNames[0]

  const raw  = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' })
  if (!raw.length) return { appointments: [], date: null, office }

  // Find header row
  let headerRow = 0
  for (let i = 0; i < Math.min(6, raw.length); i++) {
    const row = raw[i].map(c => String(c||'').toLowerCase())
    if (row.some(c=>c.includes('patient')) && row.some(c=>c.includes('date'))) {
      headerRow = i; break
    }
  }

  const headers = raw[headerRow].map(c => String(c||''))
  const colMap  = mapHeaders(headers)
  const rows    = []
  let date      = null

  for (let i = headerRow + 1; i < raw.length; i++) {
    const cells = raw[i]
    const row   = {}
    for (const [key, idx] of Object.entries(colMap)) {
      row[key] = idx !== undefined ? String(cells[idx] || '').trim() : ''
    }
    // Handle Excel date objects
    if (colMap.date !== undefined && cells[colMap.date] instanceof Date) {
      const d = cells[colMap.date]
      row.date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    }
    if (!row.patient || String(row.patient).toLowerCase().includes('total')) continue
    const d = parseDate(row.date)
    if (!date && d) date = d
    rows.push(row)
  }

  return { appointments: groupIntoPatients(rows, office, date), date, office }
}

// ══════════════════════════════════════════════════════════════════════════
// UNIFIED ENTRY POINT
// ══════════════════════════════════════════════════════════════════════════
export async function parseScheduleFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.csv'))                       return parseCsv(file)
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) return parseExcel(file)
  return parsePdf(file)  // default to PDF
}

// Keep backward compat
export async function parseSchedulePdf(file) { return parseScheduleFile(file) }
