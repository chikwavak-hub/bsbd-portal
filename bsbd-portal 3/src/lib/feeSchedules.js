// src/lib/feeSchedules.js — carrier fee schedule engine.
// Imports the office fee workbook ('formula' tab: code | OFFICE FEES | carriers...)
// into the fee_schedules table, and provides lookup helpers used by the
// Fee Lookup page, treatment planning, and the collection sheet.

import * as XLSX from 'xlsx'
import { sbGet, sbPost } from './supabase'

// canonical carrier keys <- header names in the workbook
const CARRIER_KEYS = {
  'office fees': 'office', 'office': 'office',
  'aetna': 'aetna', 'ameritas': 'ameritas', 'bcbs': 'bcbs', 'cigna': 'cigna',
  'delta dental': 'delta', 'delta': 'delta', 'humana': 'humana',
  'guardian': 'guardian', 'metlife': 'metlife', 'principal': 'principal',
  'private': 'private', 'uhc': 'uhc', 'united': 'uhc',
}
export const CARRIER_LABELS = {
  office: 'Office Fee', aetna: 'Aetna', ameritas: 'Ameritas', bcbs: 'BCBS',
  cigna: 'Cigna', delta: 'Delta Dental', humana: 'Humana', guardian: 'Guardian',
  metlife: 'MetLife', principal: 'Principal', private: 'Private', uhc: 'UHC',
}

// map a patient's free-text carrier name to a fee-schedule column
export function carrierKeyFor(name) {
  if (!name) return null
  const c = String(name).toUpperCase()
  if (c.includes('DELTA')) return 'delta'
  if (c.includes('BCBS') || c.includes('BLUE CROSS') || c.includes('ANTHEM')) return 'bcbs'
  if (c.includes('CIGNA')) return 'cigna'
  if (c.includes('UNITED') || c.includes('UHC')) return 'uhc'
  if (c.includes('METLIFE')) return 'metlife'
  if (c.includes('GUARDIAN')) return 'guardian'
  if (c.includes('AETNA')) return 'aetna'
  if (c.includes('HUMANA')) return 'humana'
  if (c.includes('AMERITAS')) return 'ameritas'
  if (c.includes('PRINCIPAL')) return 'principal'
  if (c.includes('PRIVATE') || c.includes('CASH') || c.includes('SELF')) return 'private'
  return null
}

// ── parse fee files ────────────────────────────────────────────────────────
// Two supported shapes, auto-detected:
//  A. multi-carrier workbook ('formula' tab: code | OFFICE FEES | Aetna | ...)
//  B. single-carrier schedule (CSV/Excel with a code column + a fee column,
//     e.g. a carrier's exported fee schedule) — caller must supply the carrier
export async function parseFeeFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  // A: look for the multi-carrier header
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null })
    for (let i = 0; i < Math.min(r.length, 5); i++) {
      if ((r[i] || []).some(c => String(c || '').toLowerCase().trim() === 'office fees')) {
        const multi = parseMultiCarrier(r.slice(i))
        return { mode: 'multi', ...multi }
      }
    }
  }
  // B: single-carrier — find a code column and a fee column
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null })
    const single = parseSingleCarrier(r)
    if (single) return { mode: 'single', ...single, sheet: name }
  }
  throw new Error("Couldn't recognize this file — expected either the multi-carrier fee workbook (a header containing 'OFFICE FEES') or a single-carrier schedule with a code column and a fee column")
}

function parseSingleCarrier(rows) {
  if (!rows || !rows.length) return null
  const isCode = v => /^D\d{4}[A-Z]?$/i.test(String(v ?? '').trim().replace(/\.0$/, ''))
  const toNum = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return isFinite(n) ? n : null }
  // try to find a header row naming the columns
  let codeCol = -1, feeCol = -1, start = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hdr = (rows[i] || []).map(c => String(c || '').toLowerCase().trim())
    const ci = hdr.findIndex(h => /^(proc(edure)?\s*)?(cdt\s*)?code$|^cdt$|^procedure$|^ada code$/.test(h) || h.includes('procedure code') || h.includes('cdt code'))
    const fi = hdr.findIndex(h => /fee|allowed|amount|price|rate|ucr|charge/.test(h) && !/effective|date/.test(h))
    if (ci !== -1 && fi !== -1) { codeCol = ci; feeCol = fi; start = i + 1; break }
  }
  // headerless fallback: a column dominated by D-codes + nearest numeric column
  if (codeCol === -1) {
    const sample = rows.slice(0, 50)
    const width = Math.max(...sample.map(r => (r || []).length))
    let best = -1, bestHits = 0
    for (let c = 0; c < width; c++) {
      const hits = sample.filter(r => isCode((r || [])[c])).length
      if (hits > bestHits) { bestHits = hits; best = c }
    }
    if (bestHits < 3) return null
    codeCol = best
    // fee column: the column with the most plausible money values among code rows
    let bestFee = -1, feeHits = 0
    for (let c = 0; c < width; c++) {
      if (c === codeCol) continue
      const hits = sample.filter(r => isCode((r || [])[codeCol]) && toNum((r || [])[c]) !== null && toNum((r || [])[c]) > 0).length
      if (hits > feeHits) { feeHits = hits; bestFee = c }
    }
    if (bestFee === -1) return null
    feeCol = bestFee
    start = 0
  }
  // normalize: '4249'->'D4249', 'D4341.4341'->'D4341', '0120'->'D0120'; customs kept as-is
  const normCode = raw => {
    let c = String(raw ?? '').trim().toUpperCase()
    if (!c) return null
    c = c.replace(/\.0$/, '')
    const bare = c.match(/^(\d{3,4})(\.\d+)?$/)
    if (bare) return 'D' + bare[1].padStart(4, '0')
    const dcode = c.match(/^(D\d{4})(\.\d+)?([A-Z]?)$/)
    if (dcode) return dcode[1] + (dcode[3] || '')
    if (/^[A-Z0-9&\-]{2,14}$/.test(c.replace(/\s/g, ''))) return c   // custom items (CADCAM, 2PKBLEACH…)
    return null
  }
  const best = new Map()   // dedupe: prefer the higher (non-zero beats zero) fee
  for (let i = start; i < rows.length; i++) {
    const r = rows[i] || []
    const rawCell = r[codeCol]
    // strict D-code gate only in headerless mode; header mode trusts the column
    if (start === 0 && !isCode(rawCell)) continue
    const code = normCode(rawCell)
    if (!code) continue
    const fee = toNum(r[feeCol])
    if (fee === null || fee <= 0) continue
    const f = Math.round(fee * 100) / 100
    if (!best.has(code) || f > best.get(code)) best.set(code, f)
  }
  const items = [...best.entries()].map(([code, fee]) => ({ code, fee }))
  return items.length >= 3 ? { items, count: items.length } : null
}

function parseMultiCarrier(rows) {

  const header = rows[0]
  const cols = []   // [{idx, key}]
  header.forEach((h, idx) => {
    const key = CARRIER_KEYS[String(h || '').toLowerCase().trim()]
    if (key) cols.push({ idx, key })
  })
  if (!cols.length) throw new Error('No recognizable carrier columns in the header')

  const entries = []   // {code, carrier_group, allowed_fee}
  let codes = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    let code = String(r[0] ?? '').trim().toUpperCase()
    if (!code) continue
    // skip pure-number junk rows (e.g. '5900.0') that aren't real codes
    if (/^\d+(\.\d+)?$/.test(code)) continue
    code = code.replace(/\.0$/, '')
    let any = false
    for (const { idx, key } of cols) {
      const v = Number(r[idx])
      if (isFinite(v) && v > 0) {
        entries.push({ code, carrier_group: key, allowed_fee: Math.round(v * 100) / 100 })
        any = true
      }
    }
    if (any) codes++
  }
  return { entries, codes, carriers: cols.map(c => c.key) }
}

// back-compat alias (multi-carrier only)
export async function parseFeeWorkbook(file) {
  const r = await parseFeeFile(file)
  if (r.mode !== 'multi') throw new Error('Not the multi-carrier workbook')
  return r
}

/** import a single-carrier schedule under one carrier key */
export async function importSingleCarrier(items, carrierKey, changedBy) {
  const entries = items.map(it => ({ code: it.code, carrier_group: carrierKey, allowed_fee: it.fee }))
  return importFeeSchedules(entries, 400, changedBy)
}

export async function importFeeSchedules(entries, chunk = 400, changedBy) {
  // dedupe on (code, carrier): duplicates in one upsert batch are a PostgREST error
  const dd = new Map()
  for (const e of entries) {
    const k = e.code + '|' + e.carrier_group
    if (!dd.has(k) || e.allowed_fee > dd.get(k).allowed_fee) dd.set(k, e)
  }
  entries = [...dd.values()]
  const now = new Date().toISOString()
  // diff against what's on file so every change lands in the history trail
  let existing = {}
  try {
    const cur = await sbGet('fee_schedules', 'select=code,carrier_group,allowed_fee&limit=20000')
    for (const r of cur) existing[r.code + '|' + r.carrier_group] = Number(r.allowed_fee)
  } catch {}
  const history = []
  let changed = 0, added = 0
  for (const e of entries) {
    const key = e.code + '|' + e.carrier_group
    const old = existing[key]
    if (old === undefined) { added++; history.push({ code: e.code, carrier_group: e.carrier_group, old_fee: null, new_fee: e.allowed_fee, changed_at: now, changed_by: changedBy || null }) }
    else if (Math.abs(old - e.allowed_fee) >= 0.01) { changed++; history.push({ code: e.code, carrier_group: e.carrier_group, old_fee: old, new_fee: e.allowed_fee, changed_at: now, changed_by: changedBy || null }) }
  }
  for (let i = 0; i < entries.length; i += chunk) {
    const batch = entries.slice(i, i + chunk).map(e => ({ ...e, updated_at: now }))
    await sbPost('fee_schedules?on_conflict=code,carrier_group', batch, true)
  }
  // history is best-effort: a failure here never blocks the rate update itself
  try {
    for (let i = 0; i < history.length; i += chunk) await sbPost('fee_schedule_history', history.slice(i, i + chunk), false)
  } catch {}
  return { changed, added, unchanged: entries.length - changed - added }
}

/** rate history for one code (all carriers), newest first */
export async function feeHistory(code, limit = 50) {
  try {
    return await sbGet('fee_schedule_history', `code=eq.${encodeURIComponent(String(code).toUpperCase())}&select=*&order=changed_at.desc&limit=${limit}`)
  } catch { return [] }
}

// ── lookup ─────────────────────────────────────────────────────────────────
// loads the whole table into {code: {carrierKey: fee}} + freshness
export async function loadFeeTable() {
  const rows = await sbGet('fee_schedules', 'select=code,carrier_group,allowed_fee,updated_at&limit=20000')
  const table = {}
  let latest = null
  for (const r of rows) {
    if (!table[r.code]) table[r.code] = {}
    table[r.code][r.carrier_group] = Number(r.allowed_fee)
    if (!latest || r.updated_at > latest) latest = r.updated_at
  }
  return { table, latest, count: rows.length }
}

// allowed fee for a code given a patient's carrier text; falls back to office
export function feeFor(table, code, carrierName) {
  const c = table?.[String(code || '').toUpperCase()]
  if (!c) return { fee: null, source: null }
  const key = carrierKeyFor(carrierName)
  if (key && c[key] != null) return { fee: c[key], source: CARRIER_LABELS[key] }
  if (c.office != null) return { fee: c.office, source: 'Office Fee (no carrier rate on file)' }
  return { fee: null, source: null }
}
