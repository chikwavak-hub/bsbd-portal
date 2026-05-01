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

  let currentVisit = null
  let inNotes      = false
  let noteLines    = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    // ── Patient name ───────────────────────────────────────────────────
    const ptMatch = line.match(/Treatment Plan for (.+)/)
    if (ptMatch && !result.patient_name) {
      result.patient_name = ptMatch[1].trim()
    }

    // ── Case number ────────────────────────────────────────────────────
    const caseMatch = line.match(/^Case\s+(\d+)/i)
    if (caseMatch && !result.case_number) {
      result.case_number = caseMatch[1]
    }

    // ── Accepted / Created dates ────────────────────────────────────────
    const acceptMatch = line.match(/Accepted on (\d{1,2}\/\d{1,2}\/\d{4})/)
    if (acceptMatch) result.accepted_date = acceptMatch[1]
    const createMatch = line.match(/Created on (\d{1,2}\/\d{1,2}\/\d{4})/)
    if (createMatch) result.created_date = createMatch[1]

    // ── Financial totals ────────────────────────────────────────────────
    const totalMatch    = line.match(/Treatment plan case total\s+([\d,]+\.?\d*)/)
    if (totalMatch) result.case_total = parseFloat(totalMatch[1].replace(/,/g,''))

    const insMatch      = line.match(/Estimated insurance payment\s+([\d,]+\.?\d*)/)
    if (insMatch) result.est_ins = parseFloat(insMatch[1].replace(/,/g,''))

    const ptMatch2      = line.match(/Estimated guarantor portion\s+([\d,]+\.?\d*)/)
    if (ptMatch2) result.est_patient = parseFloat(ptMatch2[1].replace(/,/g,''))

    const writeoffMatch = line.match(/Estimated write-off adjustments\s+([\d,]+\.?\d*)/)
    if (writeoffMatch) result.est_writeoff = parseFloat(writeoffMatch[1].replace(/,/g,''))

    const dedMatch      = line.match(/Estimated deductible applied\s+([\d,]+\.?\d*)/)
    if (dedMatch) result.est_deductible = parseFloat(dedMatch[1].replace(/,/g,''))

    // ── Insurance carrier ───────────────────────────────────────────────
    // Line after "Benefits Expire Annual Plan Benefits Plan Deductibles" or
    // line containing carrier name (often has plan name + address)
    if (line.includes('Sun Life') || line.includes('Delta Dental') || line.includes('BCBS') ||
        line.includes('MetLife') || line.includes('Guardian') || line.includes('Cigna') ||
        line.includes('United') || line.includes('Aetna') || line.includes('Humana') ||
        line.includes('Envolve') || line.includes('Ambetter') || line.includes('Principal')) {
      if (!result.ins_carrier) result.ins_carrier = line.split('(')[0].trim().slice(-60)
    }

    // ── Annual max (look for pattern: number — number — number in benefits row)
    // Benefits row: "1,000.00 — 50.00 150.00 — — 50.00 150.00"
    if (/^\d{1,3}(?:,\d{3})*\.\d{2}\s+/.test(line) && line.includes('—') && !result.ins_annual_max) {
      const numMatch = line.match(/^([\d,]+\.\d{2})/)
      if (numMatch) result.ins_annual_max = parseFloat(numMatch[1].replace(/,/g,''))
    }

    // ── Office ─────────────────────────────────────────────────────────
    if (line.includes('Beautiful Smiles') && !result.office) {
      const offMatch = line.match(/Beautiful Smiles[^·]+·\s*([^·]+)/)
      if (offMatch) {
        const addr = offMatch[1].trim()
        if (addr.toLowerCase().includes('dalton'))    result.office = 'Dalton'
        else if (addr.toLowerCase().includes('brainerd')) result.office = 'Brainerd'
        else if (addr.toLowerCase().includes('calhoun'))  result.office = 'Calhoun'
        else if (addr.toLowerCase().includes('mccallie')) result.office = 'McCallie'
        else result.office = addr.split(',')[0].trim()
      }
    }

    // ── Visit header ────────────────────────────────────────────────────
    const visitMatch = line.match(/^Visit\s+(\d+)\s*$/)
    if (visitMatch) {
      if (currentVisit) result.visits.push(currentVisit)
      currentVisit = {
        visit_num:   parseInt(visitMatch[1]),
        procedures:  [],
        total:       0,
        ins_total:   0,
        pt_total:    0,
        confirmed:   false,
        confirmed_by:'',
        confirmed_at:'',
        tc_notes:    '',
        completed_tx:'',
      }
      inNotes = false
      continue
    }

    // ── Visit totals ────────────────────────────────────────────────────
    if (line.startsWith('Visit Totals') && currentVisit) {
      const nums = [...line.matchAll(/[\d,]+\.\d{2}/g)].map(m => parseFloat(m[0].replace(/,/g,'')))
      if (nums.length >= 3) {
        currentVisit.total    = nums[0]
        currentVisit.ins_total= nums[1]
        currentVisit.pt_total = nums[2]
      }
      continue
    }

    // ── Notes ───────────────────────────────────────────────────────────
    if (line.startsWith('Note') || inNotes) {
      inNotes = true
      if (!line.startsWith('**') && !line.startsWith('*') && !line.startsWith('Presented')) {
        noteLines.push(line.replace(/^Note\s*/i,'').trim())
      }
      if (line.startsWith('**Financial') || line.startsWith('**Consent')) inNotes = false
      continue
    }

    // ── Procedure line ──────────────────────────────────────────────────
    if (currentVisit) {
      const proc = parseProcedureLine(line)
      if (proc) {
        currentVisit.procedures.push(proc)
        // Set provider from first procedure
        if (!result.provider && proc.provider) result.provider = proc.provider
      }
    }
  }

  // Flush last visit
  if (currentVisit) result.visits.push(currentVisit)

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
