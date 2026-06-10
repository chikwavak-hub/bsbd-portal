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

// ── CDT code descriptions (common procedures) ─────────────────────────────
const CDT_DESC = {
  D0120:'Periodic Oral Evaluation', D0140:'Limited Oral Evaluation', D0150:'Comprehensive Oral Evaluation',
  D0210:'Complete Series Radiographs', D0220:'Periapical First Film', D0230:'Periapical Additional Film',
  D0274:'Bitewings Four Films', D0330:'Panoramic Radiograph', D0364:'Cone Beam CT Capture',
  D0365:'Cone Beam CT', D0470:'Diagnostic Casts', D1110:'Prophylaxis Adult',
  D2740:'Crown Porcelain/Ceramic', D2750:'Crown Porcelain Fused High Noble', D2950:'Core Buildup',
  D2954:'Prefabricated Post and Core', D3310:'Endodontic Therapy Anterior', D3320:'Endodontic Therapy Bicuspid',
  D3330:'Endodontic Therapy Molar', D4341:'Scaling and Root Planing 4+', D4342:'Scaling and Root Planing 1-3',
  D4910:'Periodontal Maintenance', D5110:'Complete Denture Maxillary', D5120:'Complete Denture Mandibular',
  D5213:'Partial Denture Maxillary', D5214:'Partial Denture Mandibular',
  D6010:'Surgical Placement Implant Body', D6056:'Prefabricated Abutment', D6057:'Custom Abutment',
  D6058:'Abutment Crown Porcelain/Ceramic', D6104:'Bone Graft at Implant', D6065:'Implant Crown Porcelain',
  D6190:'Implant Index', D7140:'Extraction Erupted Tooth', D7210:'Surgical Extraction',
  D7953:'Bone Replacement Graft', D8090:'Comprehensive Ortho Adult', D9110:'Palliative Treatment',
  D9223:'Deep Sedation Each 15 Min', D9230:'Nitrous Oxide', D9243:'IV Sedation Each 15 Min',
}

function cdtDescription(code) {
  return CDT_DESC[code] || ''
}

// ── Stacked-format parser ─────────────────────────────────────────────────
// Handles Dentrix exports where each visit lists codes and fees on
// separate consecutive lines (vertical layout). Pairs CDT codes with the
// next currency value, pulls tooth numbers, and skips junk lines like
// patient name / DOB that appear between procedures.
function parseStackedFormat(lines) {
  const visits   = []
  let   current  = null
  const usedFees = new Set()
  const isCode   = s => /^[A-Z]{2,4}\d{2,5}$/.test(s) || /^D\d{4}$/.test(s)
  const isMoney  = s => /^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(s) || /^\d+\.\d{2}$/.test(s)
  const isTooth  = s => /^\d{1,2}$/.test(s) && parseInt(s) >= 1 && parseInt(s) <= 32

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i]||'').trim()
    if (!line) continue

    // New visit
    const vm = line.match(/^Visit\s+(\d+)\s*$/i)
    if (vm) {
      if (current) visits.push(current)
      current = { visit_num: parseInt(vm[1]), procedures: [], total: 0, ins_total: 0, pt_total: 0,
                  confirmed:false, confirmed_by:'', confirmed_at:'', tc_notes:'', completed_tx:'' }
      continue
    }

    // Visit total line: "Total: $2,970 Ins: $0 Pt: $..."
    const tm = line.match(/Total:\s*\$?([\d,]+).*?Ins:\s*\$?([\d,]+).*?Pt:\s*\$?([\d,]+)/i)
    if (tm && current) {
      current.total     = parseFloat(tm[1].replace(/,/g,''))
      current.ins_total = parseFloat(tm[2].replace(/,/g,''))
      current.pt_total  = parseFloat(tm[3].replace(/,/g,''))
      continue
    }

    if (!current) continue

    // CDT code line — start a new procedure, look ahead AND behind for its fee
    if (isCode(line)) {
      const proc = { code: line, description: cdtDescription(line), tooth:'', fee:0, ins_amt:0, pt_amt:0 }

      // Look ahead up to 6 lines for fee + tooth
      for (let j = i+1; j < Math.min(i+7, lines.length); j++) {
        const nxt = (lines[j]||'').trim()
        if (!nxt) continue
        if (isCode(nxt)) break
        if (/^Visit\s+\d+/i.test(nxt)) break
        if (isMoney(nxt) && !proc.fee) {
          proc.fee = parseFloat(nxt.replace(/,/g,''))
        } else if (isTooth(nxt) && !proc.tooth) {
          proc.tooth = nxt
        }
      }

      // Fallback: fee may sit on the line immediately BEFORE the code
      // (Dentrix sometimes orders value then code for the first row)
      if (!proc.fee) {
        for (let j = i-1; j >= Math.max(0, i-3); j--) {
          const prv = (lines[j]||'').trim()
          if (!prv) continue
          if (isCode(prv)) break
          if (isMoney(prv) && !usedFees.has(j)) {
            proc.fee = parseFloat(prv.replace(/,/g,''))
            usedFees.add(j)
            break
          }
        }
      }
      current.procedures.push(proc)
    }
  }
  if (current) visits.push(current)

  // Derive visit totals from procedures if not captured
  for (const v of visits) {
    if (!v.total) v.total = v.procedures.reduce((s,p)=>s+p.fee,0)
    if (!v.pt_total) v.pt_total = v.total
  }

  return visits.filter(v => v.procedures.length > 0)
}

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

    // ── Procedure line (single-line format) ─────────────────────────────
    if (currentVisit) {
      const proc = parseProcedureLine(line)
      if (proc) {
        currentVisit.procedures.push(proc)
        if (!result.provider && proc.provider) result.provider = proc.provider
      }
    }
  }

  // ── SECOND PASS: stacked format ────────────────────────────────────────
  // Some Dentrix exports put code / fee / description on separate lines.
  // If visits came out with few/no proper procedures, re-parse in stacked mode.
  const looksStacked = result.visits.some(v => v.procedures.length === 0) ||
    result.visits.every(v => v.procedures.every(p => !p.description))
  if (looksStacked) {
    const stacked = parseStackedFormat(lines)
    if (stacked.length) {
      result.visits = stacked
      result.num_visits = stacked.length
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
