// src/lib/eligibilityAscend.js — deterministic parser for the Dentrix Ascend
// "Eligibility Report" PDF (Ascend Eligibility / Eligibility Pro printout).
// This format is structured and consistent, so it parses without AI —
// including the per-code Coverage table (%, deductible-applies, waiting) and
// the Frequency/History/Limitations section (rules + the patient's actual
// last-service dates). Physical faxbacks still go through the AI extractor.

import { extractLedgerLines } from './ledgerParser'

const money = s => { const m = String(s).match(/\$([\d,]+\.?\d*)/); return m ? parseFloat(m[1].replace(/,/g, '')) : null }
const iso = mdY => { const m = String(mdY || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : null }

export async function looksLikeAscendEligibility(file) {
  return /\.pdf$/i.test(file.name) // cheap gate; real detection happens in parse
}

export async function parseAscendEligibility(file) {
  const lines = await extractLedgerLines(file)
  const text = lines.join('\n')
  if (!/Ascend Eligibility|Eligibility Report/.test(text) || !/Deductibles and Maximums/.test(text)) {
    throw new Error('not_ascend_eligibility')
  }

  const F = {} // field -> {value, confidence, quote}
  const set = (k, value, quote) => { if (value !== null && value !== undefined && value !== '') F[k] = { value, confidence: 100, quote: String(quote || '').slice(0, 120) } }
  const window = (startRe, endRe) => {
    const i = lines.findIndex(l => startRe.test(l))
    if (i === -1) return []
    let j = lines.length
    if (endRe) { const k = lines.slice(i + 1).findIndex(l => endRe.test(l)); if (k !== -1) j = i + 1 + k }
    return lines.slice(i, j)
  }

  // patient name: first standalone "First Last" line before "Response Type"
  const rtIdx = lines.findIndex(l => /^Response Type/.test(l))
  for (let i = 0; i < (rtIdx === -1 ? 10 : rtIdx); i++) {
    if (/^[A-Z][a-zA-Z'\-]+ [A-Z][a-zA-Z'\-]+( [A-Z][a-zA-Z'\-]+)?$/.test(lines[i]) && !/Eligibility|Report|Search/.test(lines[i])) {
      set('patient_name', lines[i], lines[i]); break
    }
  }
  // carrier: the Insurance value on the Response Type row block
  const insLine = lines[rtIdx + 1] || ''
  const insM = insLine.match(/(?:Portal|EDI|Essentials)\s+(.+)$/) || text.match(/Insurance\s*\n.*?\n?\s*([A-Z][\w .&\/]+ of [\w ]+|Delta Dental[\w .]*|Cigna[\w .]*|Aetna[\w .]*|MetLife[\w .]*|Humana[\w .]*|Guardian[\w .]*|United[\w .]*)/)
  if (insM) set('carrier', insM[1].trim().replace(/^(Payer Web Portal|EDI|Clearinghouse)\s+/i, ''), insLine || insM[0])

  const subM = text.match(/Subscriber ID[\s\S]{0,60}?(\d{8,})\s+(\d{2}\/\d{2}\/\d{4})/)
  if (subM) set('member_id', subM[1], subM[0].replace(/\n/g, ' '))
  const grpM = text.match(/Group #[\s\S]{0,80}?\b(\d{3,10})\b/)
  if (grpM) set('group_number', grpM[1], grpM[0].replace(/\n/g, ' ').slice(0, 100))

  const planPeriod = text.match(/Plan Start\s*Plan End\s*\n?\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/) || text.match(/(\d{2}\/\d{2}\/\d{4})\s+Calendar year/)
  if (planPeriod) set('plan_year_start', planPeriod[1] ? planPeriod[1].slice(0, 5) : '01/01', planPeriod[0])

  // MTC: "Missing Tooth ... Clause" then a bare Yes/No
  const mtcM = text.match(/Missing Tooth[\s\S]{0,60}?Clause[\s\S]{0,20}?\b(Yes|No)\b/)
  if (mtcM) set('mtc', mtcM[1] === 'Yes', mtcM[0].replace(/\n/g, ' '))
  const dgM = text.match(/Downgrades\?[\s\S]{0,240}?\n\s*(Yes|No)\b/) || text.match(/Downgrades\?[\s\S]{0,240}?\b(Yes|No)\b(?=\s+Seat|\s*$)/m)
  if (dgM) set('downgrade_posterior', dgM[1] === 'Yes', dgM[0].replace(/\n/g, ' ').slice(0, 100))

  // deductibles (Individual, first $ = primary/PPO column)
  const dedWin = window(/Deductibles\s+Category/, /Maximums\s+Category/).join('\n')
  const dedAmt = indWin0(dedWin).match(/Annual Amount[^\n]*?\$([\d,.]+)/)
  function indWin0(w){ const i=w.indexOf('Individual'); const j=w.indexOf('Family'); return i===-1?w:w.slice(i, j===-1?undefined:j) }
  const indWin = indWin0(dedWin)
  const dedRem = indWin.match(/Annual\s+(?:Dental\s+)?\$([\d,.]+)[^\n]*\n[^\n]*Remaining/) || indWin.match(/Annual[^\n$]*\$([\d,.]+)[^\n]*Remaining/)
  if (dedAmt) set('deductible_total', parseFloat(dedAmt[1].replace(/,/g, '')), dedAmt[0].replace(/\n/g, ' ').slice(-100))
  if (dedRem) set('deductible_remaining', parseFloat(dedRem[1].replace(/,/g, '')), dedRem[0].replace(/\n/g, ' ').slice(-100))
  if (/Deductible Met/.test(text) && F.deductible_remaining == null && F.deductible_total != null && F.deductible_total.value === 0) set('deductible_remaining', 0, 'Deductible Met')

  // maximums
  const maxWin = window(/^Maximums\s+Category|Maximums\s+Category/, /Orthodontics|Coverage$/).join('\n')
  const maxAmt = maxWin.match(/Annual Amount[^\n]*?\$([\d,.]+)/)
  const maxRem = maxWin.match(/Annual[^\n]*?\$([\d,.]+)[^\n]*\n\s*Remaining/)
  if (maxAmt) set('annual_max', parseFloat(maxAmt[1].replace(/,/g, '')), maxAmt[0])
  if (maxRem) set('max_remaining', parseFloat(maxRem[1].replace(/,/g, '')), maxRem[0].replace(/\n/g, ' '))

  // ── per-code coverage table: "D7111 <desc> 90% 90% 80% Yes None" ──
  const codeCoverage = {}
  for (const l of lines) {
    const m = l.match(/^(D\d{4})\s+.*?(\d{1,3})%\s+(\d{1,3})%(?:\s+(\d{1,3})%)?\s+(Yes|No)\b\s*(.*)$/)
    if (m) {
      codeCoverage[m[1]] = {
        pct: parseInt(m[2], 10),                 // primary (PPO) column
        ded_applies: m[5] === 'Yes',
        waiting: (m[6] || 'None').trim() || 'None',
      }
    }
  }

  // ── frequency/history/limitations: blocks "D0120 - desc 2 / 1 year -- None" ──
  const codeFrequency = {}
  const freqStart = lines.findIndex(l => /Frequency, History, Limitations/.test(l))
  if (freqStart !== -1) {
    let cur = null
    for (let i = freqStart; i < lines.length; i++) {
      const l = lines[i]
      const cm = l.match(/^(D\d{4})\s*-\s*(.*)$/)
      if (cm) { cur = { code: cm[1], blob: cm[2] }; codeFrequency[cm[1]] = codeFrequency[cm[1]] || {} }
      else if (cur && !/^===|^Service|^Frequency$|^Shared$|^Restriction|^Benefit$|blob:|Eligibility Report|^\d+\/\d+$/.test(l) && !/^(Diagnostic|Preventive|Restorative|Endodontics|Periodontics|Prosthodontics|Oral Surgery|Orthodontics|Adjunctive)/.test(l)) {
        cur.blob += ' ' + l
      }
      if (cur) {
        const b = cur.blob
        let fq = b.match(/(\d+)\s*\/\s*(\d+)\s*(year|years|month|months|lifetime)/i)
        if (!fq) {
          const nums = b.match(/(\d+)\s*\/\s*(\d+)/)
          const unitM = b.match(/\b(years?|months?|lifetime)\b/i)
          if (nums && unitM) fq = [null, nums[1], nums[2], unitM[1]]
        }
        if (fq) {
          const n = +fq[1], span = +fq[2], unit = fq[3].toLowerCase()
          const totalMonths = unit.startsWith('year') ? span * 12 : unit.startsWith('month') ? span : 9999
          codeFrequency[cur.code].rule = `${fq[1]} / ${fq[2]} ${fq[3]}`
          codeFrequency[cur.code].intervalMonths = unit === 'lifetime' ? 9999 : Math.round(totalMonths / n)
        }
        const hist = b.match(/(\d{2}\/\d{2}\/\d{4})/)
        if (hist) codeFrequency[cur.code].history = iso(hist[1])
        const lim = b.match(/Max Age:\s*(\d+)/)
        if (lim) codeFrequency[cur.code].limit = 'Max Age: ' + lim[1]
      }
    }
    for (const k of Object.keys(codeFrequency)) if (!Object.keys(codeFrequency[k]).length) delete codeFrequency[k]
  }

  return {
    fields: F,
    codeCoverage,
    codeFrequency,
    source: 'ascend_eligibility',
    counts: { codes: Object.keys(codeCoverage).length, freqRules: Object.keys(codeFrequency).length },
  }
}
