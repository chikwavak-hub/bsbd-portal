// ════════════════════════════════════════════════════════════════════════════
// DENTRIX SCHEDULE PDF PARSER
// Extracts patient appointments from Dentrix Ascend printed schedule PDFs
// Uses X/Y coordinate grouping to assign patients to correct operatories
// ════════════════════════════════════════════════════════════════════════════

// ── Extract raw items with positions from PDF ──────────────────────────────
export async function extractScheduleItems(file) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

  const buf  = await file.arrayBuffer()
  const pdf  = await pdfjsLib.getDocument({ data: buf }).promise
  const pages = []

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    const vp      = page.getViewport({ scale: 1 })
    const items   = content.items.map(item => ({
      text: item.str.trim(),
      x:    Math.round(item.transform[4]),
      y:    Math.round(vp.height - item.transform[5]), // flip Y so top=0
      w:    Math.round(item.width),
    })).filter(i => i.text)
    pages.push({ pageNum: p, items, width: vp.width, height: vp.height })
  }
  return pages
}

// ── Detect date from page ──────────────────────────────────────────────────
function detectDate(items) {
  const dateRe = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\w+)\s+(\d+),?\s+(\d{4})/
  for (const item of items) {
    const m = item.text.match(dateRe)
    if (m) {
      const MONTHS = { January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12 }
      const mo = MONTHS[m[1]] || 1
      return `${m[3]}-${String(mo).padStart(2,'0')}-${String(m[2]).padStart(2,'0')}`
    }
    // Also try M/D/YY format at top
    const m2 = item.text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
    if (m2) {
      const yr = m2[3].length === 2 ? '20'+m2[3] : m2[3]
      return `${yr}-${String(m2[1]).padStart(2,'0')}-${String(m2[2]).padStart(2,'0')}`
    }
  }
  return null
}

// ── Detect office ──────────────────────────────────────────────────────────
function detectOffice(items) {
  const OFFICES = { BRAINERD:'Brainerd', DALTON:'Dalton', CALHOUN:'Calhoun', MCCALLIE:'McCallie', 'MC CALLIE':'McCallie' }
  for (const item of items) {
    const up = item.text.toUpperCase()
    for (const [key, val] of Object.entries(OFFICES)) {
      if (up.includes(key)) return val
    }
  }
  return null
}

// ── Detect column headers (operatories/providers) ─────────────────────────
// Column headers appear near the top of the page in a row
function detectColumns(items, pageWidth) {
  // Find items that look like provider/operatory names
  // They appear in a horizontal band near the top (y < 200 roughly)
  const headerItems = items.filter(i => {
    if (i.y > 250) return false
    const up = i.text.toUpperCase()
    return (
      up.includes('DR') || up.includes('HYG') ||
      up.includes('OP') || up.includes('PATEL') ||
      up.includes('PINOS') || up.includes('CHIKWAVA') ||
      up.includes('LANORA') || up.includes('UNCONFIRMED') ||
      up.includes('OVERFLOW') || up.includes('PROVIDER')
    )
  })

  if (!headerItems.length) return []

  // Group by X position (columns within 30px are the same column)
  const cols = []
  for (const item of headerItems) {
    const existing = cols.find(c => Math.abs(c.centerX - item.x) < 60)
    if (existing) {
      existing.parts.push(item.text)
      existing.centerX = Math.round((existing.centerX + item.x) / 2)
      existing.x = Math.min(existing.x, item.x)
      existing.maxX = Math.max(existing.maxX || 0, item.x + item.w)
    } else {
      cols.push({ centerX: item.x, x: item.x, maxX: item.x + item.w, parts: [item.text] })
    }
  }

  return cols
    .filter(c => c.parts.length > 0)
    .sort((a, b) => a.x - b.x)
    .map(c => ({
      name:    c.parts.join(' ').replace(/\s+/g,' ').trim(),
      centerX: c.centerX,
      x:       c.x,
      maxX:    c.maxX,
    }))
}

// ── Assign an item to a column ─────────────────────────────────────────────
function assignColumn(itemX, columns) {
  if (!columns.length) return columns[0] || null
  // Find closest column center
  let best = columns[0], bestDist = Math.abs(itemX - columns[0].centerX)
  for (const col of columns) {
    const dist = Math.abs(itemX - col.centerX)
    if (dist < bestDist) { best = col; bestDist = dist }
  }
  return best
}

// ── Extract appointment name from text ─────────────────────────────────────
// Pattern: "Firstname Lastname (number)" where number is pt/appt ID
function extractPatientName(text) {
  // Match "Name (ID)" pattern
  const m = text.match(/^([A-Z][a-zA-Z\s\-'.,()']+?)\s*\(\d+\)\s*$/)
  if (m) {
    // Clean up nickname in parens e.g. "Mason (Mason) Crawford" → "Mason Crawford"
    return m[1].replace(/\([^)]+\)/g,'').replace(/\s+/g,' ').trim()
  }
  // Match just name without ID
  const m2 = text.match(/^([A-Z][a-zA-Z\s\-'.,]+(?:[A-Z][a-zA-Z]+))$/)
  if (m2 && m2[1].length > 3) return m2[1].trim()
  return null
}

// ── Known insurance carrier keywords ──────────────────────────────────────
const INS_CARRIERS = [
  'DELTA DENTAL','CIGNA','RENAISSANCE','UHC','UNITED','METLIFE','GUARDIAN',
  'AETNA','HUMANA','BCBS','BLUE CROSS','ANTHEM','ENVOLVE','AMBETTER',
  'CONCORDIA','CAREINGTON','MEDICAID','SUN LIFE','LLP','PRIVATE',
]

function detectInsurance(texts) {
  const joined = texts.join(' ').toUpperCase()
  if (joined.includes('PRIVATE PAY') || joined.includes('PRIVATE')) return { status:'PRIVATE PAY', carrier:'Private Pay' }
  if (joined.includes('NO INS') || joined.includes('NO INSURANCE')) return { status:'NO INSURANCE', carrier:'' }

  const activeMatch = joined.match(/ACTIVE\s+(?:REN\s+)?([A-Z][A-Z\s&]+?)(?:\s+APPROV|\s+NEW|\s*$)/)
  if (activeMatch) {
    const rawCarrier = activeMatch[1].trim()
    // Map abbreviations
    const CARRIER_MAP = { 'REN':'Renaissance', 'DELTA':'Delta Dental', 'DELTA DENTAL':'Delta Dental', 'CIGNA':'Cigna', 'UHC':'UHC', 'METLIFE':'MetLife', 'GUARDIAN':'Guardian', 'AETNA':'Aetna', 'HUMANA':'Humana', 'ENVOLVE':'Envolve', 'CAREINGTON':'Careington', 'LLP':'LLP', 'RENAISSANCE':'Renaissance', 'CONCORDIA':'United Concordia' }
    const carrier = CARRIER_MAP[rawCarrier] || rawCarrier.replace(/\b\w/g,c=>c.toUpperCase())
    return { status:'ACTIVE INS', carrier }
  }
  return { status:'', carrier:'' }
}

// ── Extract procedure hints ────────────────────────────────────────────────
const CDT_ABBREV = {
  'COMPEX':'D0150', 'D0150':'D0150', 'PERIO EVAL':'D0180', 'D0180':'D0180',
  'FMX':'D0210', 'D0210':'D0210', 'BWX':'D0274', 'D0274':'D0274',
  'PROPHY':'D1110', 'D1110':'D1110', 'CHILD PROPHY':'D1120',
  'TOPFL':'D1206', 'D1206':'D1206',
  'FILLING':'D2391', 'RESIN':'D2392', 'RESP':'D2393',
  'CROWN':'D2740', 'CRN':'D2740', 'CROWN SEAT':'CRN SEAT',
  'BUILDUP':'D2950', 'BLDUP':'D2950',
  'RCT':'D3330', 'RC-MOLAR':'D3330', 'RC-PREMOLAR':'D3320', 'RC-ANTERIOR':'D3310',
  'EXT':'D7210', 'EXTRACTION':'D7210', 'EXTS':'D7210',
  'SRP':'D4341', 'D4341':'D4341', 'D4342':'D4342', 'D4910':'D4910',
  'IMPLANT':'D6010', 'IMPLANT SUPPORTED':'D6058',
  'IMPRESSIONS':'D0470', 'STUDY MODEL':'D0470',
  'LIM EXAM':'D0140', 'LIMITED EXAM':'D0140', 'D0140':'D0140',
}

function extractProcedureHints(texts) {
  const hints = []
  for (const text of texts) {
    // Look for D-codes
    const dCodes = text.match(/\bD\d{4}\b/g) || []
    hints.push(...dCodes)
    // Look for abbreviations
    const up = text.toUpperCase()
    for (const [abbr, code] of Object.entries(CDT_ABBREV)) {
      if (up.includes(abbr) && !hints.includes(code)) hints.push(code)
    }
  }
  return [...new Set(hints)].slice(0, 8)
}

// ── Main parse function ────────────────────────────────────────────────────
export function parseSchedulePages(pages) {
  const allAppointments = []
  let date    = null
  let office  = null

  for (const page of pages) {
    const { items } = page

    // Detect date/office from first page
    if (!date)   date   = detectDate(items)
    if (!office) office = detectOffice(items)

    // Skip page 3 (overflow/practice event only)
    const pageText = items.map(i=>i.text).join(' ')
    if (pageText.includes('PROVIDER OVERFLOW') && !pageText.includes('PATEL') && !pageText.includes('PINOS')) continue

    // Detect columns
    const columns = detectColumns(items, page.width)
    if (!columns.length) continue

    // Find appointment blocks
    // An appointment block starts with a patient name line
    // Group all items by Y proximity into rows, then scan for name patterns

    // Sort items by Y then X
    const sorted = [...items].sort((a,b) => a.y !== b.y ? a.y - b.y : a.x - b.x)

    // Group into horizontal bands (10px tolerance)
    const bands = []
    for (const item of sorted) {
      const existing = bands.find(b => Math.abs(b.y - item.y) < 12)
      if (existing) existing.items.push(item)
      else bands.push({ y: item.y, items: [item] })
    }

    // Scan bands for patient names
    for (let bi = 0; bi < bands.length; bi++) {
      const band = bands[bi]
      for (const item of band.items) {
        const name = extractPatientName(item.text)
        if (!name) continue

        // Found a patient — collect surrounding context (next 8 bands)
        const col = assignColumn(item.x, columns)
        const contextTexts = []
        let apptTime = ''

        // Look backwards 3 bands for time
        for (let j = Math.max(0, bi-3); j < bi; j++) {
          for (const ci of bands[j].items) {
            const tm = ci.text.match(/^(\d{1,2}:\d{2}\s*[AP]M)$/i)
            if (tm && Math.abs(ci.x - item.x) < 120) apptTime = tm[1]
            contextTexts.push(ci.text)
          }
        }

        // Look forward 6 bands for procedures/insurance
        for (let j = bi+1; j <= Math.min(bands.length-1, bi+6); j++) {
          const nextBand = bands[j]
          // Stop if we hit another patient name
          const hasNextPatient = nextBand.items.some(ni => extractPatientName(ni.text))
          if (hasNextPatient) break
          for (const ni of nextBand.items) {
            if (Math.abs(ni.x - item.x) < 150) contextTexts.push(ni.text)
          }
        }

        const ins  = detectInsurance(contextTexts)
        const procs= extractProcedureHints(contextTexts)
        const isNew= contextTexts.some(t => t.toUpperCase().includes('NEW'))
        const isApproved = contextTexts.some(t => t.toUpperCase().includes('APPROVED'))

        // Normalize column name to operatory
        const colName  = col?.name || 'Unknown'
        const isHyg    = colName.toUpperCase().includes('HYG')
        const isUnconf = colName.toUpperCase().includes('UNCONFIRM')

        allAppointments.push({
          patient_name:      name,
          patient_name_norm: name.replace(/\([^)]+\)/g,'').replace(/[^A-Za-z\s]/g,'').trim().toUpperCase().split(/\s+/).join(' '),
          operatory:         colName,
          provider:          colName,
          appt_time:         apptTime,
          ins_status:        ins.status,
          ins_carrier:       ins.carrier,
          procedure_hints:   procs,
          is_new_patient:    isNew,
          is_approved:       isApproved,
          is_unconfirmed:    isUnconf,
          is_hygiene:        isHyg,
          // These will be filled by Ridgeview
          treatments:        procs.map(code => ({ code, desc:'', tooth:'', fee:0, pt_pct:0, pt_amount:0 })),
          total_expected:    0,
          amount_collected:  0,
          status:            'pending',
          flags_total:       0,
          flags_done:        0,
          claim_notes:       [],
        })
      }
    }
  }

  // Deduplicate by name + time
  const seen = new Set()
  const unique = allAppointments.filter(a => {
    const key = a.patient_name_norm + '_' + a.appt_time + '_' + a.operatory
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { appointments: unique, date, office }
}

export async function parseSchedulePdf(file) {
  const pages = await extractScheduleItems(file)
  return parseSchedulePages(pages)
}
