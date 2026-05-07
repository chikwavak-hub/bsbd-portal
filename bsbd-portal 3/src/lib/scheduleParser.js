// ════════════════════════════════════════════════════════════════════════════
// DENTRIX SCHEDULE PDF PARSER — v2
// Handles browser-printed Dentrix Ascend schedule PDFs
// Uses coordinate-based column detection + row merging
// ════════════════════════════════════════════════════════════════════════════

const OFFICE_MAP = {
  'BRAINERD':'Brainerd','DALTON':'Dalton','CALHOUN':'Calhoun',
  'MCCALLIE':'McCallie','MC CALLIE':'McCallie'
}

function detectOffice(text) {
  const up = text.toUpperCase()
  for (const [k,v] of Object.entries(OFFICE_MAP)) if (up.includes(k)) return v
  return null
}

function detectDate(text) {
  // "Thursday, May 7, 2026" or "5/7/26"
  const m1 = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\w+)\s+(\d+),?\s+(\d{4})/i)
  if (m1) {
    const MONTHS = {january:1,february:2,march:3,april:4,may:5,june:6,
                   july:7,august:8,september:9,october:10,november:11,december:12}
    const mo = MONTHS[m1[1].toLowerCase()] || 1
    return `${m1[3]}-${String(mo).padStart(2,'0')}-${String(m1[2]).padStart(2,'0')}`
  }
  // "5/7/26" from browser header
  const m2 = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/)
  if (m2) {
    const yr = m2[3].length === 2 ? '20'+m2[3] : m2[3]
    return `${yr}-${String(m2[1]).padStart(2,'0')}-${String(m2[2]).padStart(2,'0')}`
  }
  return null
}

// ── Extract text items with positions ────────────────────────────────────
async function extractItems(file) {
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
    const items   = content.items
      .filter(i => i.str && i.str.trim())
      .map(i => ({
        text: i.str.trim(),
        x:    Math.round(i.transform[4]),
        y:    Math.round(vp.height - i.transform[5]), // flip Y: top=0
        w:    Math.round(i.width),
        h:    Math.round(i.height),
      }))
    pages.push({ items, width: vp.width, height: vp.height, pageNum: p })
  }
  return pages
}

// ── Merge items in same Y band into rows ─────────────────────────────────
function buildRows(items, yTol = 8) {
  const rows = []
  for (const item of [...items].sort((a,b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(r => Math.abs(r.y - item.y) <= yTol)
    if (row) { row.items.push(item); row.y = Math.round((row.y + item.y) / 2) }
    else rows.push({ y: item.y, items: [item] })
  }
  // Sort items within each row left→right
  rows.forEach(r => r.items.sort((a,b) => a.x - b.x))
  return rows.sort((a,b) => a.y - b.y)
}

// ── Detect column headers (operatories) ─────────────────────────────────
function detectColumns(rows, pageWidth) {
  const HEADER_KEYWORDS = ['PATEL','PINOS','CHIKWAVA','HYG','OP ','UNCONFIRMED',
    'OVERFLOW','DR ','DR.','HYGIENIST','LANORA','PROVIDER']
  // Headers are near top of page — first 15% of height
  const maxY = rows.length ? rows[rows.length-1].y * 0.15 : 200
  const headerRows = rows.filter(r => r.y < maxY + 100)

  // Collect candidate header items
  const candidates = []
  for (const row of headerRows) {
    for (const item of row.items) {
      const up = item.text.toUpperCase()
      if (HEADER_KEYWORDS.some(k => up.includes(k))) {
        candidates.push(item)
      }
    }
  }
  if (!candidates.length) return []

  // Group by X proximity into columns
  const cols = []
  for (const c of candidates.sort((a,b) => a.x - b.x)) {
    const existing = cols.find(col => Math.abs(col.x - c.x) < 55)
    if (existing) {
      existing.names.push(c.text)
      existing.x = Math.round((existing.x + c.x) / 2)
    } else {
      cols.push({ x: c.x, names: [c.text], minX: c.x, maxX: c.x + c.w })
    }
  }

  return cols.map(c => ({
    name:  c.names.join(' ').replace(/\s+/g,' ').trim(),
    x:     c.x,
    minX:  c.minX,
    maxX:  c.maxX,
  })).sort((a,b) => a.x - b.x)
}

function closestColumn(itemX, cols) {
  if (!cols.length) return null
  return cols.reduce((best, col) =>
    Math.abs(col.x - itemX) < Math.abs(best.x - itemX) ? col : best
  )
}

// ── Patient name pattern: "Firstname Lastname (ID)" ─────────────────────
const NAME_PAT = /^([A-Z][a-zA-Z][\w\s\-'.,()]+?)\s*\(\d+\)\s*$/

function extractName(text) {
  const m = text.match(NAME_PAT)
  if (!m) return null
  // Clean nickname: "Mason (Mason) Crawford" → "Mason Crawford"
  return m[1].replace(/\([^)]+\)/g,'').replace(/\s+/g,' ').trim()
}

// ── Insurance hints ──────────────────────────────────────────────────────
const CARRIER_MAP = {
  'RENAISSANCE':'Renaissance','REN':'Renaissance','DELTA DENTAL':'Delta Dental',
  'DELTA':'Delta Dental','CIGNA':'Cigna','UHC':'UHC','UNITED':'UHC',
  'METLIFE':'MetLife','GUARDIAN':'Guardian','AETNA':'Aetna','HUMANA':'Humana',
  'ENVOLVE':'Envolve','AMBETTER':'Ambetter','CAREINGTON':'Careington',
  'MEDICAID':'Medicaid','CONCORDIA':'United Concordia','LLP':'LLP',
}

function detectIns(texts) {
  const joined = texts.join(' ').toUpperCase()
  if (joined.includes('PRIVATE')) return { status:'PRIVATE PAY', carrier:'Private Pay' }
  if (joined.includes('NO INS'))  return { status:'NO INSURANCE', carrier:'' }
  // "ACTIVE REN", "ACTIVE CIGNA", "ACTIVE DELTA DENTAL" etc.
  const m = joined.match(/ACTIVE\s+([A-Z][A-Z\s]{1,20}?)(?=\s+(?:APPROV|NEW|COLLECT|$|\d))/)
  if (m) {
    const raw = m[1].trim().replace(/\s+/g,' ')
    const carrier = CARRIER_MAP[raw] || raw.split(' ').map(w=>w[0]+w.slice(1).toLowerCase()).join(' ')
    return { status:'ACTIVE INS', carrier }
  }
  if (joined.includes('ACTIVE')) return { status:'ACTIVE INS', carrier:'' }
  return { status:'', carrier:'' }
}

// ── Procedure code hints ─────────────────────────────────────────────────
const PROC_ABBREVS = {
  'COMPEX':'D0150','FMX':'D0210','BWX':'D0274','PROPHY':'D1110',
  'PROPHYCH':'D1120','TOPFL':'D1206','FILLING':'D2391','RESIN':'D2392',
  'CROWN':'D2740','CRN SEAT':'CRN SEAT','BUILDUP':'D2950','BLDUP':'D2950',
  'RCT':'D3330','RC-MOLAR':'D3330','RC-PREMOLAR':'D3320','EXTRACTION':'D7210',
  'EXT':'D7210','EXTS':'D7210','SRP':'D4341','PERIO MAINT':'D4910',
  'IMPLANT':'D6010','LIM EXAM':'D0140','PANO':'D0330','PERIOEVAUL':'D0180',
  'PERMAAINT':'D4910','PERMAINT':'D4910',
}

function extractProcs(texts) {
  const hints = []
  for (const t of texts) {
    const up = t.toUpperCase()
    // D-codes
    for (const m of up.matchAll(/\bD\d{4}\b/g)) hints.push(m[0])
    // Abbreviations
    for (const [abbr, code] of Object.entries(PROC_ABBREVS)) {
      if (up.includes(abbr) && !hints.includes(code)) hints.push(code)
    }
  }
  return [...new Set(hints)].slice(0,6)
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PARSE
// ════════════════════════════════════════════════════════════════════════════
export function parseSchedulePages(pages) {
  const appointments = []
  let date   = null
  let office = null

  for (const page of pages) {
    const { items } = page
    const allText = items.map(i=>i.text).join(' ')

    if (!date)   date   = detectDate(allText) || detectDate(items.find(i=>i.y<80)?.text||'')
    if (!office) office = detectOffice(allText)

    // Skip overflow/practice event pages (page 3)
    if (allText.includes('PROVIDER OVERFLOW') && !allText.includes('PATEL') && !allText.includes('PINOS')) continue

    const rows   = buildRows(items)
    const cols   = detectColumns(rows, page.width)

    // Time pattern
    const TIME_PAT = /^(\d{1,2}:\d{2}\s*[AP]M)$/i

    // Scan rows for patient names
    // Build a lookup: for each row index, find nearby context rows
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri]

      // Try concatenating items in this row to find name
      // Also try each item individually (names sometimes span items)
      const rowTexts  = row.items.map(i=>i.text)
      const rowFull   = rowTexts.join(' ')

      // Try full row text and each individual item
      const candidates = [rowFull, ...rowTexts]

      for (const candidate of candidates) {
        const name = extractName(candidate)
        if (!name) continue

        // Find which item had the name to get X position
        const nameItem = row.items.find(i => i.text.includes(name.split(' ')[0])) || row.items[0]
        const col      = cols.length ? closestColumn(nameItem.x, cols) : null

        // Look ±8 rows for context (time, insurance, procedures)
        const ctxTexts = []
        let apptTime   = ''
        for (let j = Math.max(0, ri-5); j <= Math.min(rows.length-1, ri+8); j++) {
          if (j === ri) continue
          for (const ci of rows[j].items) {
            // Only grab context items near same X as name
            if (Math.abs(ci.x - nameItem.x) > 200) continue
            ctxTexts.push(ci.text)
            if (!apptTime) {
              const tm = ci.text.match(/^(\d{1,2}:\d{2}\s*[AP]M)$/i)
              if (tm) apptTime = tm[1]
            }
          }
        }

        const ins     = detectIns([rowFull, ...ctxTexts])
        const procs   = extractProcs([rowFull, ...ctxTexts])
        const isNew   = [...ctxTexts, rowFull].some(t => /\bNEW\b/i.test(t))
        const isUnconf= (col?.name||'').toUpperCase().includes('UNCONFIRM')
        const isHyg   = (col?.name||'').toUpperCase().includes('HYG')
        const colName = col?.name || 'OP 1'

        appointments.push({
          id:               'cp_rdg_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),
          patient_name:     name,
          patient_name_norm:name.replace(/\([^)]+\)/g,'').replace(/[^A-Za-z\s]/g,'').trim().toUpperCase(),
          operatory:        colName,
          provider:         colName,
          appt_time:        apptTime,
          ins_status:       ins.status,
          ins_carrier:      ins.carrier,
          procedure_hints:  procs,
          is_new_patient:   isNew,
          is_unconfirmed:   isUnconf,
          is_hygiene:       isHyg,
          treatments:       procs.map(code=>({code,desc:'',tooth:'',fee:0,pt_pct:'',pt_amount:0})),
          total_expected:   0,
          amount_collected: 0,
          status:           'pending',
          flags_total:      0,
          flags_done:       0,
          claim_notes:      [],
        })
        break // only take first match per row
      }
    }
  }

  // Deduplicate by name + operatory
  const seen = new Set()
  const unique = appointments.filter(a => {
    const key = a.patient_name_norm + '|' + a.operatory
    if (seen.has(key)) return false
    seen.add(key); return true
  })

  return { appointments: unique, date, office }
}

export async function parseSchedulePdf(file) {
  const pages = await extractItems(file)
  return parseSchedulePages(pages)
}
