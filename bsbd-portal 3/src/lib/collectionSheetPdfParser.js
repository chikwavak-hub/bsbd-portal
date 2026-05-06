// ════════════════════════════════════════════════════════════════════════════
// COLLECTION SHEET PDF PARSER
// Parses Ridgeview collection sheet PDFs
// ════════════════════════════════════════════════════════════════════════════

const OFFICE_KEYWORDS = {
  'CALHOUN':  'Calhoun',
  'DALTON':   'Dalton',
  'BRAINERD': 'Brainerd',
  'MCCALLIE': 'McCallie',
  'MC CALLIE':'McCallie',
}

// ── Detect office from filename ────────────────────────────────────────────
export function detectOfficeFromFilename(filename) {
  const upper = filename.toUpperCase().replace(/[_\s-]/g, ' ')
  for (const [key, val] of Object.entries(OFFICE_KEYWORDS)) {
    if (upper.includes(key)) return val
  }
  return null
}

// ── Detect office from PDF text ────────────────────────────────────────────
export function detectOfficeFromText(text) {
  const upper = text.toUpperCase().slice(0, 500) // check first 500 chars
  for (const [key, val] of Object.entries(OFFICE_KEYWORDS)) {
    if (upper.includes(key)) return val
  }
  return null
}

// ── Parse dollar amount ────────────────────────────────────────────────────
function parseDollar(str) {
  if (!str) return 0
  const m = String(str).match(/[-]?[\d,]+\.?\d*/)
  return m ? parseFloat(m[0].replace(/,/g, '')) : 0
}

// ── Normalize patient name ─────────────────────────────────────────────────
function normalizeName(name) {
  // Remove nicknames in parens: "Barry (Barry) Crocker" → "Barry Crocker"
  return name
    .replace(/\([^)]+\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

// ── Parse procedure line ───────────────────────────────────────────────────
// e.g. "D2740TH: 18Full Porcelain/Ceramic Crown $760.00 $760.00 100% $760.00 $760.00"
// e.g. "CRN SEATCrown Seat $0.00 $0.00 0% $0.00 N/A $0.00"
function parseProcLine(text) {
  // Extract code — starts with D+digits or known custom codes
  const codeMatch = text.match(/^([A-Z][A-Z0-9]{1,8})\s*(?:TH:\s*([\w,]+)\s*)?/)
  if (!codeMatch) return null
  const code  = codeMatch[1]
  const tooth = codeMatch[2] ? codeMatch[2].trim() : ''

  // Extract numbers — last few dollar amounts
  const nums = [...text.matchAll(/[-]?[\d,]+\.?\d{2}/g)].map(m => parseFloat(m[0].replace(/,/g, '')))

  // Extract patient % (e.g. "20%")
  const pctMatch = text.match(/(\d+)%/)
  const ptPct    = pctMatch ? parseInt(pctMatch[1]) : 0

  // Description — between code/tooth and first dollar sign
  const dollarIdx = text.indexOf('$')
  const descRaw   = dollarIdx > 0 ? text.slice(codeMatch[0].length, dollarIdx) : ''
  const desc      = descRaw.replace(/\s+/g, ' ').trim()

  // Fee = first number, pt amount = based on pct
  const fee       = nums[0] || 0
  const ptAmount  = nums.length >= 3 ? nums[nums.length - 1] : 0

  return { code, tooth, desc, fee, pt_pct: ptPct, pt_amount: ptAmount }
}

// ── Main parser ────────────────────────────────────────────────────────────
export function parseCollectionSheetPdf(text, filename = '') {
  const lines   = text.split('\n').map(l => l.trim()).filter(Boolean)
  const patients = []

  // Detect date from first line
  let dateStr = ''
  const dateMatch = text.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+(\w+)[,\s]+(\d+)[,\s]+(\d{4})/)
  if (dateMatch) {
    const months = { January:1, February:2, March:3, April:4, May:5, June:6, July:7, August:8, September:9, October:10, November:11, December:12 }
    const mo = months[dateMatch[1]] || 1
    const dy = parseInt(dateMatch[2])
    const yr = parseInt(dateMatch[3])
    dateStr = `${yr}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`
  }

  let currentOp    = 'OP 1'
  let currentPt    = null

  const savePatient = () => {
    if (!currentPt || !currentPt.patient_name) return
    // Derive total_expected from COLLECT amount or last known amount
    const totalExp = currentPt._collectAmt || currentPt._esent || 0
    const norm     = normalizeName(currentPt.patient_name)
    patients.push({
      id:                'cp_pdf_' + norm.replace(/\s+/g,'_') + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      patient_name:      currentPt.patient_name,
      patient_name_norm: norm,
      operatory:         currentOp,
      date:              dateStr,
      ins_carrier:       currentPt.ins_carrier || '',
      ins_status:        currentPt.ins_status  || '',
      total_expected:    totalExp > 0 ? totalExp : 0,
      balance_bf:        currentPt.balance_bf  || 0,
      treatments:        currentPt.treatments  || [],
      status:            currentPt._broken ? 'broken' : totalExp > 0 ? 'pending' : 'zero',
      amount_collected:  0,
      flags_total:       0,
      flags_done:        0,
      claim_notes:       [],
    })
    currentPt = null
  }

  const fullText = lines.join(' ')

  // Split on patient boundaries — "PG [Name]"
  // Each patient block starts with "PG "
  const pgBlocks = fullText.split(/(?=\bPG\s+(?:[A-Z][a-z]|[A-Z]{2,}))/)

  for (const block of pgBlocks) {
    if (!block.trim()) continue

    // Check for operatory change before patient
    const opMatch = block.match(/\bOP\s+(\d+)\b/i)
    if (opMatch) currentOp = 'OP ' + opMatch[1]

    // Extract patient name — "PG [Name]" up to first dollar or keyword
    const pgMatch = block.match(/^PG\s+([A-Za-z][\w\s\-().,']+?)(?=\s*[\$\-]?\d|\s+ESENT|\s+Balance|\s+BROKEN|\s+NO\s+PROC|$)/)
    if (!pgMatch) continue

    savePatient()
    const rawName = pgMatch[1].trim()
    currentPt = {
      patient_name: rawName,
      ins_carrier:  '',
      ins_status:   '',
      treatments:   [],
      balance_bf:   0,
      _collectAmt:  0,
      _esent:       0,
      _broken:      false,
    }

    // ESENT amount
    const esentMatch = block.match(/ESENT\s+\$?([\d,]+\.?\d*)/)
    if (esentMatch) currentPt._esent = parseDollar(esentMatch[1])

    // Balance B/f
    const bfMatch = block.match(/Balance\s+B\/f\s+(?:ESENT\s+)?\$?([-\d,]+\.?\d*)/)
    if (bfMatch) currentPt.balance_bf = parseDollar(bfMatch[1])

    // BROKEN flag
    if (/\bBROKEN\b/.test(block)) currentPt._broken = true

    // COLLECT amount — the authoritative amount to collect
    const collectMatch = block.match(/\bCOLLECT\s+\$?([\d,]+\.?\d*)/)
    if (collectMatch) currentPt._collectAmt = parseDollar(collectMatch[1])

    // Insurance carrier and status
    const insActive = block.match(/ACTIVE\s+INS\s+([A-Z][A-Z0-9 &]+?)(?=\s*COLLECT|\s*$|\s+PG\b|\s+OP\b|\s+D[0-9]|\s+[A-Z]{3,}\s+[A-Z]{4,})/i)
    if (insActive) {
      currentPt.ins_status  = 'ACTIVE INS'
      currentPt.ins_carrier = insActive[1].trim().replace(/\s+/g,' ')
    } else if (/PRIVATE\s+PAY/i.test(block)) {
      currentPt.ins_status  = 'PRIVATE PAY'
      currentPt.ins_carrier = ''
    } else if (/NO\s+INS/i.test(block)) {
      currentPt.ins_status  = 'NO INSURANCE'
      currentPt.ins_carrier = ''
    }

    // Procedures — find all D-codes and custom codes
    const procPattern = /\b([A-Z][A-Z0-9]{1,8})\s*(?:TH:\s*([\w,]+))?\s*([\w\s\/\-–.,()]+?)\s*\$([\d,.]+)\s*\$([\d,.]+)\s*(\d+)%/g
    let m
    while ((m = procPattern.exec(block)) !== null) {
      const code = m[1]
      // Skip non-procedure tokens
      if (['ACTIVE','COLLECT','PRIVATE','ESENT','BROKEN','BALANCE','DEDUCT','TOTAL','UNLIMITED'].includes(code)) continue
      currentPt.treatments.push({
        code,
        tooth:      m[2] ? m[2].trim() : '',
        desc:       m[3].trim().replace(/\s+/g,' ').slice(0,60),
        fee:        parseDollar(m[4]),
        pt_pct:     parseInt(m[6]) || 0,
        pt_amount:  0,
      })
    }
  }

  savePatient()

  return { patients, date: dateStr }
}

// ── Extract text from PDF ──────────────────────────────────────────────────
export async function extractCollectionSheetText(file) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  const buf  = await file.arrayBuffer()
  const pdf  = await pdfjsLib.getDocument({ data: buf }).promise
  let text   = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    // Group items by Y position to preserve row structure
    const byY = {}
    for (const item of content.items) {
      const y = Math.round(item.transform[5])
      if (!byY[y]) byY[y] = []
      byY[y].push(item.str)
    }
    Object.keys(byY).sort((a,b)=>b-a).forEach(y => {
      text += byY[y].join(' ') + '\n'
    })
  }
  return text
}
