// ════════════════════════════════════════════════════════════════════════════
// TREATMENT PLAN PDF PARSER
// Parses Dentrix Ascend treatment plan PDFs
// ════════════════════════════════════════════════════════════════════════════

// ── Extract text from PDF using PDF.js ────────────────────────────────────
export async function extractTxPlanText(file) {
  const pdfjsLib = await import('pdfjs-dist')
  /* @vite-ignore */
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    import.meta.url
  ).toString()
  const arrayBuffer = await file.arrayBuffer()
  const pdf         = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  let fullText      = ''
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p)
    const content = await page.getTextContent()
    // Preserve line breaks by grouping items by Y position
    const items   = content.items
    let lastY     = null
    let lineText  = ''
    for (const item of items) {
      const y = Math.round(item.transform[5])
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        fullText += lineText.trimEnd() + '\n'
        lineText = ''
      }
      lineText += item.str
      lastY = y
    }
    if (lineText.trim()) fullText += lineText.trimEnd() + '\n'
    fullText += '\n'
  }
  return fullText
}

// ── Parse a single procedure line ─────────────────────────────────────────


function parseProcedureLine(line) {
  // Formats seen:
  // "D0470 Diagnostic/Study Models Kudzai Chikwava, DDS 350.00 0.00 350.00"
  // "D2740 Full Porcelain/Ceramic Crown / Th: 11 Kudzai Chikwava, DDS 1,215.00 0.00 740.00"
  // "CRN SEAT Crown Seat / Th: 6 Kudzai Chikwava, DDS 0.00 0.00 0.00"
  // "DIAGNOST DIAGNOSTIC Kudzai Chikwava, DDS 1,580.00 0.00 1,580.00"

  const line2 = line.trim()
  if (!line2) return null

  // Extract 3 trailing numbers (amount, pri ins, patient portion)
  // Numbers can be like "1,215.00" or "0.00"
  const numPattern = /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g
  const allNums    = [...line2.matchAll(numPattern)].map(m => parseFloat(m[1].replace(/,/g, '')))

  // Need at least 3 numbers at the end
  if (allNums.length < 3) return null
  const ptPortion  = allNums[allNums.length - 1]
  const priIns     = allNums[allNums.length - 2]
  const amount     = allNums[allNums.length - 3]

  // Extract code — first token
  const firstToken = line2.split(/\s+/)[0]
  const code       = firstToken || ''

  // Extract tooth number from "/ Th: XX"
  const toothMatch = line2.match(/\/\s*Th:\s*([\d,\s]+)/i)
  const tooth      = toothMatch ? toothMatch[1].trim().replace(/\s*,\s*/g, ', ') : ''

  // Extract description — between code and provider name
  // Provider pattern: "FirstName LastName, DDS/DMD/RDH"
  const providerMatch = line2.match(/([A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?,\s*(?:DDS|DMD|RDH|DDS1|MD))/i)
  let description = ''
  if (providerMatch) {
    const provStart = line2.indexOf(providerMatch[0])
    const afterCode = line2.slice(code.length).trim()
    description = afterCode.slice(0, provStart - code.length - 1).trim()
    // Clean up tooth reference from description
    description = description.replace(/\/\s*Th:[\d,\s]+/gi, '').trim()
    // Remove trailing slash
    description = description.replace(/\s*\/\s*$/, '').trim()
  }
  const provider = providerMatch ? providerMatch[0] : ''

  // Determine if CDT code
  const isCDT    = /^D\d{4}$/.test(code)
  const isCustom = !isCDT && code.length > 0 && code !== 'Code' && code !== 'Visit'

  // Skip header rows and total rows
  if (code === 'Code' || line2.startsWith('Visit Totals') || line2.startsWith('Case') || line2.startsWith('Treatment Plan')) return null
  if (!code || (!isCDT && !isCustom)) return null

  return {
    code,
    description,
    tooth,
    provider,
    amount,
    pri_ins:    priIns,
    pt_portion: ptPortion,
    is_cdt:     isCDT,
    is_custom:  isCustom,
  }
}

// ── Main parser ────────────────────────────────────────────────────────────
export function parseTxPlanText(text) {
  const lines  = text.split('\n')
  const result = {
    patient_name:       '',
    office:             '',
    provider:           '',
    case_number:        '',
    accepted_date:      '',
    created_date:       '',
    case_total:         0,
    est_ins:            0,
    est_patient:        0,
    est_writeoff:       0,
    est_deductible:     0,
    ins_carrier:        '',
    ins_annual_max:     0,
    ins_deductible:     0,
    visits:             [],  // [{visit_num, procedures:[...], total, ins_total, pt_total}]
    notes:              '',
    num_visits:         0,
  }

  // ── Parse visits & procedures ──────────────────────────────────────────
  // Real Dentrix layout per procedure:
  //   "D0470 Diagnostic/Study Models"          (code + description, optional "/ Th: XX")
  //   "Kudzai" / "Chikwava," / "DDS"           (provider, split across lines — skip)
  //   "350.00 0.00 350.00"                      (Amount  Pri-Ins  Patient)
  const num = s => parseFloat(String(s).replace(/,/g,'')) || 0

  const codeLineRe  = /^(D\d{4}|[A-Z]{2,}(?:\s[A-Z]{2,})?)\s+(.+)$/
  const moneyLineRe = /^([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/

  let currentVisit = null
  let pending      = null   // procedure awaiting its money line
  let inNotes      = false
  let noteLines    = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // Header metadata (name, dates, totals, insurance)
    const ptMatch = line.match(/Treatment Plan for (.+)/)
    if (ptMatch && !result.patient_name) result.patient_name = ptMatch[1].trim()

    const acceptMatch = line.match(/Accepted on (\d{1,2}\/\d{1,2}\/\d{4})/)
    if (acceptMatch) result.accepted_date = acceptMatch[1]
    const createMatch = line.match(/Created on (\d{1,2}\/\d{1,2}\/\d{4})/)
    if (createMatch) result.created_date = createMatch[1]

    const totalMatch = line.match(/Treatment plan case total\s*$/)
    // case total sits on its own — handled by the standalone number lines below
    const insPay = line.match(/Estimated insurance payment\s+([\d,]+\.\d{2})/)
    if (insPay) result.est_ins = num(insPay[1])
    const guarPortion = line.match(/Estimated guarantor portion\s+([\d,]+\.\d{2})/)
    if (guarPortion) result.est_patient = num(guarPortion[1])
    const writeoff = line.match(/Estimated write-off adjustments\s+([\d,]+\.\d{2})/)
    if (writeoff) result.est_writeoff = num(writeoff[1])

    // Insurance carrier line
    const carrierM = line.match(/(Sun Life Financial|Delta Dental|MetLife|Cigna|Aetna|Guardian|United|Humana|BCBS|Blue Cross)[^\(]*/i)
    if (carrierM && !result.ins_carrier) result.ins_carrier = carrierM[0].trim()

    // ── Visit header ──────────────────────────────────────────────────
    const vm = line.match(/^Visit\s+(\d+)$/)
    if (vm) {
      if (currentVisit) result.visits.push(currentVisit)
      currentVisit = {
        visit_num: parseInt(vm[1]), procedures: [],
        total:0, ins_total:0, pt_total:0,
        confirmed:false, confirmed_by:'', confirmed_at:'', tc_notes:'', completed_tx:'',
      }
      pending = null; inNotes = false
      continue
    }

    // ── Visit totals ──────────────────────────────────────────────────
    const vt = line.match(/^Visit Totals\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})$/)
    if (vt && currentVisit) {
      currentVisit.total     = num(vt[1])
      currentVisit.ins_total = num(vt[2])
      currentVisit.pt_total  = num(vt[3])
      continue
    }

    // ── Notes section ─────────────────────────────────────────────────
    if (line === 'Note' || inNotes) {
      inNotes = true
      if (line.startsWith('**Financial') || line.startsWith('**Consent')) { inNotes = false; continue }
      if (line !== 'Note' && !line.startsWith('*') && !line.startsWith('Presented') && !line.startsWith('Beautiful Smiles'))
        noteLines.push(line)
      continue
    }

    if (!currentVisit) continue

    // Skip column headers & provider-name fragments
    if (/^(Code Description|Provider Amount)/.test(line)) continue
    if (/^(Kudzai|Chikwava|DDS|DMD|RDH|MD)$|^Chikwava,$/.test(line)) continue
    if (/^[A-Z][a-z]+,?$/.test(line) && !codeLineRe.test(line)) continue  // lone name word

    // ── Money line → completes the pending procedure ──────────────────
    const mm = line.match(moneyLineRe)
    if (mm && pending) {
      pending.fee     = num(mm[1])
      pending.ins_amt = num(mm[2])
      pending.pt_amt  = num(mm[3])
      currentVisit.procedures.push(pending)
      if (!result.provider) result.provider = 'Kudzai Chikwava, DDS'
      pending = null
      continue
    }

    // ── Code line → start a new pending procedure ─────────────────────
    const cm = line.match(codeLineRe)
    if (cm) {
      let code = cm[1].trim()
      let rest = cm[2].trim()
      let tooth = ''
      const toothM = rest.match(/\/\s*Th:\s*([\d,\s]+)$/i)
      if (toothM) { tooth = toothM[1].trim().replace(/\s*,\s*/g,', '); rest = rest.replace(/\/\s*Th:.*$/i,'').trim() }
      pending = { code, description: rest, tooth, fee:0, ins_amt:0, pt_amt:0 }
      continue
    }
  }

  // Flush last visit
  if (currentVisit) result.visits.push(currentVisit)

  // Derive case total from visits (most reliable for this layout)
  const visitSum = result.visits.reduce((s,v) => s + v.total, 0)
  if (!result.case_total || result.case_total < visitSum) result.case_total = visitSum
  const visitInsSum = result.visits.reduce((s,v) => s + v.ins_total, 0)
  const visitPtSum  = result.visits.reduce((s,v) => s + v.pt_total, 0)
  if (!result.est_ins)     result.est_ins     = visitInsSum
  if (!result.est_patient) result.est_patient = visitPtSum

  // Notes
  result.notes     = noteLines.filter(Boolean).join(' ').trim()
  result.num_visits= result.visits.length

  // Derive totals from procedures if header totals not found
  if (!result.case_total) {
    result.case_total  = result.visits.reduce((s,v) => s + v.total, 0)
    result.est_ins     = result.visits.reduce((s,v) => s + v.ins_total, 0)
    result.est_patient = result.visits.reduce((s,v) => s + v.pt_total, 0)
  }

  return result
}

// ── Match tx plan visit procedures to collection sheet ────────────────────
export function matchVisitToCollectionSheet(txVisit, collectionPatientTreatments) {
  if (!txVisit || !collectionPatientTreatments) return { matched: false, matchedCodes: [] }
  const collCodes = new Set((collectionPatientTreatments || []).map(t => t.code))
  const txCodes   = (txVisit.procedures || []).map(p => p.code)
  const matched   = txCodes.filter(c => collCodes.has(c))
  const score     = matched.length / Math.max(txCodes.filter(c => c.startsWith('D')).length, 1)
  return {
    matched:      score >= 0.5,
    matchedCodes: matched,
    score:        Math.round(score * 100),
  }
}
