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

// ── parse the workbook (the 'formula' tab layout) ──────────────────────────
export async function parseFeeWorkbook(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  // find a sheet whose header row contains OFFICE FEES
  let rows = null
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null })
    for (let i = 0; i < Math.min(r.length, 5); i++) {
      if ((r[i] || []).some(c => String(c || '').toLowerCase().trim() === 'office fees')) { rows = r.slice(i); break }
    }
    if (rows) break
  }
  if (!rows) throw new Error("Couldn't find a fee sheet — expected a header row containing 'OFFICE FEES'")

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

export async function importFeeSchedules(entries, chunk = 400) {
  const now = new Date().toISOString()
  for (let i = 0; i < entries.length; i += chunk) {
    const batch = entries.slice(i, i + chunk).map(e => ({ ...e, updated_at: now }))
    await sbPost('fee_schedules?on_conflict=code,carrier_group', batch, true)
  }
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
