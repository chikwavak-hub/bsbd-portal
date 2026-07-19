// src/lib/ledgerParser.js — Dentrix Guarantor Ledger parser + deterministic analyzer.
// Extraction runs fully in the browser via pdfjs-dist (already a dependency).
// parseLedgerPdf(file) -> { meta, txns, lines }
// analyzeLedger(parsed) -> { computed, totals, flags, mismatchCount }

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.js?url'
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const DATE  = /^(\d{2}\/\d{2}\/\d{4})\s+/
const MONEY = /-?[\d,]+\.\d{2}/g
const num = s => parseFloat(String(s).replace(/,/g, ''))

// ── PDF -> ordered text lines (grouped by y position, sorted by x) ──────────
export async function extractLedgerLines(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjsLib.getDocument({ data }).promise
  const all = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const tc = await page.getTextContent()
    const rows = new Map()
    for (const it of tc.items) {
      const y = Math.round(it.transform[5])
      let key = null
      for (const k of rows.keys()) if (Math.abs(k - y) <= 2) { key = k; break }
      if (key === null) { key = y; rows.set(key, []) }
      rows.get(key).push({ x: it.transform[4], s: it.str })
    }
    const lines = [...rows.entries()].sort((a, b) => b[0] - a[0])
      .map(([, items]) => items.sort((a, b) => a.x - b.x).map(i => i.s).join(' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    all.push(...lines)
  }
  return all
}

// ── lines -> structured transactions ────────────────────────────────────────
export function parseLedgerLines(lines) {
  const meta = { chart: null, start: null, end: null, guarantorBalance: null, balanceDate: null }
  const txns = []
  let lastDate = null

  for (const raw of lines) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const cm = line.match(/Chart\s*#\s*(\S+)/i); if (cm) { meta.chart = cm[1]; continue }
    if (/^GUARANTOR|^Beautiful Smiles|^\d+ South|^Dalton\s*,|^START DATE|^DATE DESCRIPTION|^page \d|^\(\*\)/i.test(line)) continue
    const dr = line.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})$/)
    if (dr) { meta.start = dr[1]; meta.end = dr[2]; continue }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(line)) { lastDate = line; continue }

    const cs = line.match(/insurance payment\s+(.*?)\s+Claim status:\s*(\w+)/i)
    if (cs && !DATE.test(line)) {
      txns.push({ kind: 'claim', date: lastDate, carrier: cs[1].trim(), status: cs[2].toUpperCase() })
      continue
    }

    let bm = line.match(/Balance Forward\s+(-?[\d,]+\.\d{2})/i)
    if (bm) { txns.push({ kind: 'balance_forward', date: (line.match(DATE) || [])[1] || null, balance: num(bm[1]) }); continue }
    bm = line.match(/Balance as of (\d{2}\/\d{2}\/\d{4})\s+(-?[\d,]+\.\d{2})/i)
    if (bm) { meta.guarantorBalance = num(bm[2]); meta.balanceDate = bm[1]; continue }

    const dm = line.match(DATE)
    const date = dm ? dm[1] : null
    if (date) lastDate = date
    const body = dm ? line.slice(dm[0].length) : line
    const monies = body.match(MONEY) || []

    const code = (body.match(/^(D\d{4})\s*-\s*/) || [])[1] || null
    const isPayment = /payment|adjustment|write-?off/i.test(body)

    if (!isPayment && monies.length >= 1 && (code || /^[A-Z]/.test(body))) {
      const amount = num(monies[monies.length - (monies.length >= 2 ? 2 : 1)])
      const balance = monies.length >= 2 ? num(monies[monies.length - 1]) : null
      const desc = body.replace(MONEY, '').trim()
      const tooth = (desc.match(/Th:\s*([\d\-,\s()A-Z]+?)(?:\s{2,}|$)/) || [])[1]?.trim() || null
      const patient = (desc.match(/([A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+)+)\s*$/) || [])[1] || null
      txns.push({ kind: 'charge', date, code, desc, tooth, patient, amount, balance })
      continue
    }
    if (isPayment && monies.length) {
      const split = /\*\s*/.test(body)
      const applied = num(monies[monies.length - (monies.length >= 2 ? 2 : 1)])
      const balance = monies.length >= 2 ? num(monies[monies.length - 1]) : null
      const stated = (body.match(/\$([\d,]+\.\d{2})/) || [])[1]
      let type = 'pt_payment'
      if (/insurance payment/i.test(body)) type = 'ins_payment'
      else if (/insurance adjustment/i.test(body)) type = 'ins_adjustment'
      else if (/credit adjustment/i.test(body)) type = 'credit_adjustment'
      else if (/write-?off/i.test(body)) type = 'writeoff'
      txns.push({
        kind: 'txn', date, type,
        desc: body.replace(MONEY, '').replace(/\$[\d,.]+\*?/, '').trim(),
        stated: stated ? num(stated) : null, applied, balance, split,
      })
      continue
    }
  }
  return { meta, txns }
}

export async function parseLedgerPdf(file) {
  const lines = await extractLedgerLines(file)
  const parsed = parseLedgerLines(lines)
  return { ...parsed, lines }
}

// ── deterministic analysis: reconcile + flag anomalies ─────────────────────

// ── group transactions into visits and attribute the balance ───────────────
// A visit = a dated charge group + every money row applied against it
// (rows between this charge group and the next dated charge group).
export function buildVisits(parsed) {
  const { txns } = parsed
  const visits = []
  let cur = null
  for (const t of txns) {
    if (t.kind === 'balance_forward') continue
    if (t.kind === 'claim') { if (cur) cur.claims.push(t); continue }
    if (t.kind === 'charge') {
      if (t.date && (!cur || !cur.open)) {
        cur = { date: t.date, patient: t.patient || null, charges: [], money: [], claims: [], open: true }
        visits.push(cur)
      } else if (t.date && cur && cur.open && cur.money.length > 0) {
        // new dated charge after money rows = new visit
        cur.open = false
        cur = { date: t.date, patient: t.patient || null, charges: [], money: [], claims: [], open: true }
        visits.push(cur)
      }
      if (!cur) { cur = { date: t.date, patient: t.patient || null, charges: [], money: [], claims: [], open: true }; visits.push(cur) }
      cur.charges.push(t)
      if (!cur.patient && t.patient) cur.patient = t.patient
    } else if (t.kind === 'txn') {
      if (!cur) { cur = { date: t.date, patient: null, charges: [], money: [], claims: [], open: true }; visits.push(cur) }
      cur.money.push(t)
    }
  }
  // compute nets
  for (const v of visits) {
    v.chargeTotal = Math.round(v.charges.reduce((s, c) => s + c.amount, 0) * 100) / 100
    v.paidTotal   = Math.round(v.money.reduce((s, m) => s + m.applied, 0) * 100) / 100
    v.net         = Math.round((v.chargeTotal + v.paidTotal) * 100) / 100
    v.codes       = v.charges.map(c => c.code).filter(Boolean)
    v.byType = {}
    for (const m of v.money) v.byType[m.type] = Math.round(((v.byType[m.type] || 0) + m.applied) * 100) / 100
  }
  return visits
}

// ── carrier adjustment norms, learned from the RESOLVED visits ─────────────
// On PPO plans, a resolved insured visit normally shows a contractual
// adjustment. If a problem visit's adjustment rate is far below this
// patient's own resolved-visit norm, a write-off was likely never posted.
// cumulative insurance payments per calendar year, in visit order — used to
// detect annual-max exhaustion ("insurance stopped paying mid-year")
function insPaidByYear(visits) {
  const cum = {}   // year -> running total in chronological visit order
  const perVisit = new Map()
  const sorted = [...visits].sort((a, b) => toISO(a.date).localeCompare(toISO(b.date)))
  for (const v of sorted) {
    const y = toISO(v.date).slice(0, 4)
    const before = cum[y] || 0
    perVisit.set(v, before)
    cum[y] = before + Math.abs(v.byType.ins_payment || 0)
  }
  return { perVisit, totals: cum }
}
function toISO(mdY) {
  if (!mdY) return '9999'
  const m = String(mdY).match(/(\d{2})\/(\d{2})\/(\d{4})/)
  return m ? `${m[3]}-${m[1]}-${m[2]}` : String(mdY)
}
const COMMON_MAXES = [1000, 1250, 1500, 2000, 2500]

function carrierAdjStats(visits) {
  const rates = []
  for (const v of visits) {
    if (Math.abs(v.net) > 0.01) continue                 // resolved visits only
    if (!v.chargeTotal || !(v.byType.ins_payment)) continue
    const adj = Math.abs(v.byType.ins_adjustment || 0)
    rates.push(adj / v.chargeTotal)
  }
  rates.sort((a, b) => a - b)
  const median = rates.length ? rates[Math.floor(rates.length / 2)] : null
  return { median, samples: rates.length }
}

const COMMON_DEDUCTIBLES = [25, 50, 75, 100, 150]
const DOWNGRADE_CODES = /^D239[1-4]$/

// possible sources of a visit's unresolved amount, each with evidence
export function possibleSources(v, stats, paidBefore = 0) {
  const out = []
  const adj = Math.abs(v.byType.ins_adjustment || 0)
  const insPaid = Math.abs(v.byType.ins_payment || 0)
  const adjRate = v.chargeTotal > 0 ? adj / v.chargeTotal : 0
  const claimsUnpaid = v.claims.filter(c => c.status !== 'PAID')

  if (v.net > 0) {
    // 1. missed contractual write-off: ins paid but adjustment far below this account's own norm
    if (insPaid > 0 && stats.median != null && stats.samples >= 3 && adjRate < stats.median * 0.5)
      out.push({ src: 'missed write-off', detail: `insurance paid but the posted adjustment is ${(adjRate*100).toFixed(0)}% of charges vs this account's normal ~${(stats.median*100).toFixed(0)}% — the contractual write-off was likely never posted (~$${Math.min(v.net, v.chargeTotal*stats.median - adj).toFixed(2)} of this balance may not be collectible)` })
    // 2. classic uncollected deductible
    if (COMMON_DEDUCTIBLES.some(d => Math.abs(v.net - d) < 0.01))
      out.push({ src: 'uncollected deductible', detail: `remaining amount is exactly $${v.net.toFixed(2)} — a standard deductible figure; check whether the deductible was collected at the visit` })
    // 3. downgrade differential
    if (v.codes.some(c => DOWNGRADE_CODES.test(c)) && v.net > 0 && v.net <= 80)
      out.push({ src: 'downgrade differential', detail: `posterior composite on this visit with a small residual ($${v.net.toFixed(2)}) — consistent with an amalgam-downgrade difference that was neither billed to the patient nor written off` })
    // 4. claim never resolved
    // benefits exhausted: insurance had already paid near a common annual max before this visit, then paid $0 here
    if (insPaid === 0 && paidBefore >= 800 && COMMON_MAXES.some(m => paidBefore >= m * 0.85))
      out.push({ src: 'benefits exhausted', detail: `insurance had already paid $${paidBefore.toFixed(2)} this plan year before this visit and paid $0 here — consistent with the annual maximum being used up; the remainder becomes patient responsibility (verify max on the EOB/faxback)` })
    if (insPaid === 0 && v.claims.length > 0 && v.claims.every(c => c.status === 'PAID'))
      out.push({ src: 'likely denial', detail: `claim shows status PAID but $0 was actually paid on this visit — Dentrix marks processed-and-denied claims as PAID; pull the EOB for the denial reason (frequency, MTC, downgrade, non-covered)` })
    if (insPaid === 0 && v.claims.length > 0 && !v.claims.every(c => c.status === 'PAID'))
      out.push({ src: 'claim unresolved', detail: `a claim exists (${v.claims.map(c=>c.carrier+':'+c.status).join(', ')}) but no insurance payment posted — denied, stuck, or never transmitted; pull the claim status/EOB` })
    if (insPaid === 0 && v.claims.length === 0 && v.chargeTotal > 0)
      out.push({ src: 'claim never sent', detail: 'no claim record on this visit at all — verify a claim was created and transmitted' })
    if (claimsUnpaid.length)
      out.push({ src: 'pending claim', detail: `${claimsUnpaid.length} claim(s) not marked PAID — balance may resolve when insurance pays` })
    // 5. patient portion simply not collected
    if (insPaid > 0 && adj > 0 && out.length === 0)
      out.push({ src: 'patient portion not collected', detail: `insurance paid $${insPaid.toFixed(2)} and adjusted $${adj.toFixed(2)} — the remaining $${v.net.toFixed(2)} is the patient share; collect or send to statements` })
    // 6. duplicate charge check
    const seen = new Set()
    for (const c of v.charges) {
      const k = c.code + '|' + (c.tooth || '') + '|' + c.amount
      if (c.code && seen.has(k)) out.push({ src: 'possible duplicate charge', detail: `${c.code}${c.tooth?' Th:'+c.tooth:''} at $${c.amount} appears more than once on this visit — verify not double-posted` })
      seen.add(k)
    }
  } else {
    if (v.byType.credit_adjustment)
      out.push({ src: 'credit adjustment', detail: `a credit adjustment of $${Math.abs(v.byType.credit_adjustment).toFixed(2)} was posted — verify intent: refund due, or reversal of a duplicate/incorrect posting` })
    if (v.chargeTotal === 0 && (v.byType.pt_payment || v.byType.ins_payment))
      out.push({ src: 'orphaned payment split', detail: 'a payment was applied to a visit with $0 in charges — the split landed on the wrong visit; re-apply it' })
    if (out.length === 0)
      out.push({ src: 'overpayment', detail: 'payments exceed charges on this visit — possible double payment by patient and insurance for the same service; refund or transfer' })
  }
  if (out.length === 0) out.push({ src: 'undetermined', detail: 'no pattern matched — open the visit in Dentrix and compare against the EOB' })
  return out
}

// disposition: what should be DONE with this amount
const DISPOSITION_OF_SOURCE = {
  'patient portion not collected':'collect', 'uncollected deductible':'collect', 'benefits exhausted':'collect',
  'missed write-off':'writeoff', 'downgrade differential':'writeoff',
  'likely denial':'insurance', 'claim unresolved':'insurance', 'claim never sent':'insurance', 'pending claim':'insurance',
  'possible duplicate charge':'posting', 'orphaned payment split':'posting',
  'credit adjustment':'refund', 'overpayment':'refund',
  'undetermined':'investigate',
}
const DISPOSITION_LABEL = {
  collect:'COLLECTABLE — bill/collect from patient',
  writeoff:'WRITE-OFF CANDIDATE — likely not collectible, adjust off',
  insurance:'INSURANCE ACTION FIRST — resolve the claim before billing patient',
  refund:'REFUND / TRANSFER DUE — money owed back or misapplied',
  posting:'POSTING FIX — correct the ledger, no money changes hands',
  investigate:'INVESTIGATE — compare against EOB before acting',
}
export function rowDisposition(sources) {
  const order = ['posting','refund','insurance','writeoff','collect','investigate']
  const present = new Set(sources.map(s => DISPOSITION_OF_SOURCE[s.src] || 'investigate'))
  for (const d of order) if (present.has(d)) return d
  return 'investigate'
}
export { DISPOSITION_LABEL }

// attribution: only the visits whose net isn't ~0 explain the final balance
export function attributeBalance(visits) {
  const stats = carrierAdjStats(visits)
  const paidMap = insPaidByYear(visits).perVisit
  const rows = visits.filter(v => Math.abs(v.net) > 0.01)
    .map(v => ({
      date: v.date, patient: v.patient, codes: v.codes.join(', ') || (v.charges[0]?.desc?.slice(0, 40) || 'visit'),
      chargeTotal: v.chargeTotal, insPaid: v.byType.ins_payment || 0, insAdj: v.byType.ins_adjustment || 0,
      ptPaid: v.byType.pt_payment || 0, writeoff: v.byType.writeoff || 0, creditAdj: v.byType.credit_adjustment || 0,
      net: v.net,
      reason: v.net > 0
        ? (v.byType.ins_payment ? 'insurance paid, remainder never collected from patient' : 'no insurance payment posted — claim unpaid, denied, or never sent')
        : (v.byType.credit_adjustment ? 'credit adjustment created an overpayment' : v.chargeTotal === 0 ? 'payment applied to a $0-charge visit (orphaned split)' : 'overpaid vs charges'),
      sources: possibleSources(v, stats, paidMap.get(v) || 0),
    }))
  for (const r of rows) { r.disposition = rowDisposition(r.sources); r.dispositionLabel = DISPOSITION_LABEL[r.disposition] }
  const total = Math.round(rows.reduce((s, r) => s + r.net, 0) * 100) / 100
  const buckets = {}
  for (const r of rows) buckets[r.disposition] = Math.round(((buckets[r.disposition] || 0) + r.net) * 100) / 100
  const verdict = overallVerdict(total, buckets)
  return { rows, total, adjNorm: stats, buckets, verdict }
}

// ── THE ANSWER: do we collect this balance or not ──────────────────────────
export function overallVerdict(total, buckets = {}) {
  const collect  = Math.max(buckets.collect || 0, 0)
  const hold     = Math.max(buckets.insurance || 0, 0)
  const woReview = Math.max(buckets.writeoff || 0, 0)
  const posting  = buckets.posting || 0
  const invest   = Math.max(buckets.investigate || 0, 0)
  const refund   = Math.min((buckets.refund || 0) + Math.min(posting, 0), 0)

  if (total < -0.01) return {
    code: 'REFUND', collectNow: 0, hold, woReview, refundDue: Math.abs(total), investigate: invest,
    headline: `DO NOT COLLECT — account is in CREDIT $${Math.abs(total).toFixed(2)}`,
    instruction: 'The patient may be owed money. Verify the credit source, then issue a refund or apply to future treatment. Nothing is collectible on this account.',
  }
  if (collect > 0 && (hold > 0 || invest > 0)) return {
    code: 'PARTIAL', collectNow: collect, hold: hold + invest, woReview, refundDue: 0, investigate: invest,
    headline: `PARTIAL COLLECT — collect $${collect.toFixed(2)} now, hold $${(hold + invest).toFixed(2)}`,
    instruction: `$${collect.toFixed(2)} is confirmed patient responsibility — collect or statement it now. $${(hold + invest).toFixed(2)} is tied to unresolved claims or open questions — do NOT bill the patient for it until those resolve.${woReview>0?` $${woReview.toFixed(2)} appears to be missed write-offs — route to billing for adjustment, do not collect.`:''}`,
  }
  if (collect > 0) return {
    code: 'COLLECT', collectNow: collect, hold: 0, woReview, refundDue: 0, investigate: 0,
    headline: `YES — COLLECT $${collect.toFixed(2)} from the patient`,
    instruction: `Insurance has fully resolved. $${collect.toFixed(2)} is legitimate patient responsibility — collect at next contact or send to statements.${woReview>0?` Separately, $${woReview.toFixed(2)} looks like missed write-offs — adjust off, do not include in the patient ask.`:''}`,
  }
  if (hold > 0 || invest > 0) return {
    code: 'HOLD', collectNow: 0, hold: hold + invest, woReview, refundDue: 0, investigate: invest,
    headline: `NOT YET — do not collect. $${(hold + invest).toFixed(2)} needs insurance/EOB resolution first`,
    instruction: 'The entire balance is tied to unresolved claims, likely denials, or amounts needing EOB verification. Work the insurance actions first — the collectible number may change or vanish.',
  }
  if (woReview > 0) return {
    code: 'WRITEOFF', collectNow: 0, hold: 0, woReview, refundDue: 0, investigate: 0,
    headline: `DO NOT COLLECT — $${woReview.toFixed(2)} appears to be missed write-offs`,
    instruction: 'This balance looks like contractual adjustments that were never posted. Billing it to the patient would violate PPO agreements. Route to billing for adjustment.',
  }
  return {
    code: 'CLEAN', collectNow: 0, hold: 0, woReview: 0, refundDue: 0, investigate: 0,
    headline: 'NO ACTION — ledger reconciles with nothing collectible outstanding',
    instruction: 'Any residual is posting-level only. Correct the ledger entries; no patient contact needed.',
  }
}


// ── harvest benefit-profile facts from the ledger itself ───────────────────
// The ledger is ground truth for frequency history and YTD benefit usage —
// it cannot go stale the way a faxback can.
const FREQ_HARVEST = [
  [/^D1110$|^D1110$|^D1120$/, 'freq_prophy_last'],
  [/^D0272$|^D0274$/, 'freq_bwx_last'],
  [/^D0210$|^D0330$/, 'freq_fmx_last'],
  [/^D4341$|^D4342$/, 'freq_srp_last'],
  [/^D511\d$|^D512\d$|^D521[34]$/, 'freq_denture_last'],
]
export function profileFromLedger(parsed, visits, attribution) {
  const out = { freq: {}, insPaidByYearTotals: {}, lastActivity: null }
  for (const v of visits) {
    const dISO = toISO(v.date)
    if (!out.lastActivity || dISO > out.lastActivity) out.lastActivity = dISO
    for (const c of v.charges) {
      if (!c.code) {
        if (/del part|deliver.*(denture|partial)/i.test(c.desc||'')) {
          const cur = out.freq.freq_denture_last
          if (!cur || dISO > cur) out.freq.freq_denture_last = dISO
        }
        continue
      }
      for (const [re, field] of FREQ_HARVEST) {
        if (re.test(c.code)) {
          const cur = out.freq[field]
          if (!cur || dISO > cur) out.freq[field] = dISO
        }
      }
    }
  }
  const yearly = insPaidByYear(visits).totals
  out.insPaidByYearTotals = yearly
  const thisYear = String(new Date().getFullYear())
  out.insPaidThisYear = Math.round((yearly[thisYear] || 0) * 100) / 100
  out.ledgerBalance = parsed.meta.guarantorBalance ?? null
  if (attribution?.verdict) {
    out.verdict = attribution.verdict.code
    out.collectNow = attribution.verdict.collectNow || 0
    out.hold = (attribution.verdict.hold || 0)
  }
  return out
}

export function analyzeLedger(parsed) {
  const { meta, txns } = parsed
  let run = 0, mismatches = 0
  for (const t of txns) {
    if (t.kind === 'balance_forward') { run = t.balance; continue }
    if (t.kind === 'charge') run += t.amount
    else if (t.kind === 'txn') run += t.applied
    if ((t.kind === 'charge' || t.kind === 'txn') && t.balance != null) {
      if (Math.abs(run - t.balance) > 0.01) mismatches++
      run = t.balance // printed running balance is authoritative (splits reorder rows)
    }
  }
  const computed = Math.round(run * 100) / 100

  const sum = ty => txns.filter(x => x.kind === 'txn' && x.type === ty).reduce((s, x) => s + x.applied, 0)
  const totals = {
    charges: txns.filter(t => t.kind === 'charge').reduce((s, t) => s + t.amount, 0),
    ins_payment: sum('ins_payment'),
    ins_adjustment: sum('ins_adjustment'),
    pt_payment: sum('pt_payment'),
    writeoff: sum('writeoff'),
    credit_adjustment: sum('credit_adjustment'),
  }

  const flags = []
  for (const t of txns) {
    if (t.kind === 'txn' && t.type === 'credit_adjustment' && Math.abs(t.applied) >= 100)
      flags.push({ sev: 'high', msg: `Large credit adjustment ${t.applied.toFixed(2)} on ${t.date} — verify intent (refund due? duplicate posting?)` })
  }
  // payment applied against a $0-charge visit group (orphaned split)
  for (let i = 0; i < txns.length; i++) {
    const t = txns[i]
    if (t.kind !== 'txn' || t.applied >= 0) continue
    let j = i - 1, groupCharges = 0, seenCharge = false
    while (j >= 0 && txns[j].kind !== 'balance_forward') {
      if (txns[j].kind === 'charge') { groupCharges += txns[j].amount; seenCharge = true }
      if (txns[j].kind === 'charge' && txns[j].date) break
      j--
    }
    if (seenCharge && groupCharges === 0 && Math.abs(t.applied) > 1)
      flags.push({ sev: 'high', msg: `Payment ${t.applied.toFixed(2)} applied to a $0-charge visit (${t.date}) — orphaned split, likely mis-applied` })
  }
  const pending = txns.filter(t => t.kind === 'claim' && t.status !== 'PAID')
  if (pending.length) flags.push({ sev: 'med', msg: `${pending.length} claim(s) not marked PAID — balance may resolve when insurance pays` })
  const finalBal = meta.guarantorBalance ?? computed
  if (finalBal < -1) flags.push({ sev: 'high', msg: `Account ends in CREDIT ${finalBal.toFixed(2)} — refund may be owed, or a posting error created the credit` })
  if (finalBal > 1) flags.push({ sev: 'med', msg: `Open balance ${finalBal.toFixed(2)} — see attribution for source` })
  if (meta.guarantorBalance != null && Math.abs(computed - meta.guarantorBalance) > 0.01)
    flags.push({ sev: 'high', msg: `Parser reconciliation gap: computed ${computed} vs printed ${meta.guarantorBalance} — review raw lines before trusting details` })

  return { computed, totals, flags, mismatchCount: mismatches }
}
