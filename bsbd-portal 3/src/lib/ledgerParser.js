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
