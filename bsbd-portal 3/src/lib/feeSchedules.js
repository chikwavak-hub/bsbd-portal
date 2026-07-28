// src/lib/feeSchedules.js — carrier fee schedule engine (v2: fee groups).
// The practice has two contracted schedule groups (Ascend IDs 740480 and
// 663569) with different negotiated rates for the same carriers, plus one
// practice-wide UCR (office) schedule. Rates are stored per
// (code, carrier, fee_group) and resolved by the patient's office.

import * as XLSX from 'xlsx'
import { sbGet, sbPost } from './supabase'

// ── carriers ───────────────────────────────────────────────────────────────
const CARRIER_KEYS = {
  'office fees': 'office', 'office': 'office', 'ucr': 'office',
  'aetna': 'aetna', 'ameritas': 'ameritas', 'amerita': 'ameritas',
  'bcbs': 'bcbs', 'bcbs ga': 'bcbs', 'bcbs_ga': 'bcbs',
  'cigna': 'cigna', 'delta dental': 'delta', 'delta': 'delta',
  'humana': 'humana', 'guardian': 'guardian', 'guardia': 'guardian',
  'metlife': 'metlife', 'principal': 'principal', 'private': 'private',
  'uhc': 'uhc', 'united': 'uhc', 'uhc2000': 'uhc2000',
  'geha': 'geha', 'careington': 'careington', 'caringt': 'careington',
  'liberty': 'liberty', 'llp': 'llp',
  'unitcon': 'concordia', 'united concordia': 'concordia',
}
export const CARRIER_LABELS = {
  office: 'Office (UCR)', aetna: 'Aetna', ameritas: 'Ameritas', bcbs: 'BCBS GA',
  cigna: 'Cigna', delta: 'Delta Dental', humana: 'Humana', guardian: 'Guardian',
  metlife: 'MetLife', principal: 'Principal', private: 'Private', uhc: 'UHC',
  uhc2000: 'UHC 2000', geha: 'GEHA', careington: 'Careington',
  liberty: 'Liberty', llp: 'LLP', concordia: 'United Concordia',
}

// ── fee groups ─────────────────────────────────────────────────────────────
// 'all' = practice-wide (office UCR). Office → group mapping below is the
// working assumption (GA offices on 740480, TN offices on 663569) — adjust
// OFFICE_GROUP if the contracts map differently.
export const FEE_GROUPS = { all: 'All offices', '740480': '740480', '663569': '663569' }
export const OFFICE_GROUP = { Dalton: '740480', Calhoun: '740480', Brainerd: '663569', McCallie: '663569' }

export function carrierKeyFor(name) {
  if (!name) return null
  const c = String(name).toUpperCase()
  if (c.includes('DELTA')) return 'delta'
  if (c.includes('BCBS') || c.includes('BLUE CROSS') || c.includes('ANTHEM')) return 'bcbs'
  if (c.includes('CIGNA')) return 'cigna'
  if (c.includes('CONCORDIA')) return 'concordia'
  if (c.includes('UHC 2000') || c.includes('UHC2000')) return 'uhc2000'
  if (c.includes('UNITED') || c.includes('UHC')) return 'uhc'
  if (c.includes('METLIFE')) return 'metlife'
  if (c.includes('GUARDIAN')) return 'guardian'
  if (c.includes('AETNA')) return 'aetna'
  if (c.includes('HUMANA')) return 'humana'
  if (c.includes('AMERITAS')) return 'ameritas'
  if (c.includes('PRINCIPAL')) return 'principal'
  if (c.includes('GEHA')) return 'geha'
  if (c.includes('CAREINGTON')) return 'careington'
  if (c.includes('LIBERTY')) return 'liberty'
  if (c.includes('LLP')) return 'llp'
  if (c.includes('PRIVATE') || c.includes('CASH') || c.includes('SELF')) return 'private'
  return null
}

// ── parsing ────────────────────────────────────────────────────────────────
const isCode = v => /^D\d{4}[A-Z]?$/i.test(String(v ?? '').trim().replace(/\.0$/, ''))
const toNum = v => { const n = Number(String(v ?? '').replace(/[$,\s]/g, '')); return isFinite(n) ? n : null }
const normCode = raw => {
  let c = String(raw ?? '').trim().toUpperCase()
  if (!c) return null
  c = c.replace(/\.0$/, '')
  const bare = c.match(/^(\d{3,4})(\.\d+)?$/)
  if (bare) return 'D' + bare[1].padStart(4, '0')
  const dcode = c.match(/^(D\d{4})(\.\d+)?([A-Z]?)$/)
  if (dcode) return dcode[1] + (dcode[3] || '')
  if (/^[A-Z0-9&\-]{2,14}$/.test(c.replace(/\s/g, ''))) return c
  return null
}

// guess {group, carrier} from the "Fee Schedule Name:" line or the filename
function guessIdentity(rows, fileName) {
  let name = ''
  for (let i = 0; i < Math.min(rows?.length || 0, 8); i++) {
    const line = (rows[i] || []).map(c => String(c || '')).join(' ')
    const m = line.match(/Fee Schedule Name:\s*(.+)/i)
    if (m) { name = m[1].trim(); break }
  }
  const hay = (name + ' ' + (fileName || '')).toUpperCase()
  const group = (hay.match(/\b(740480|663569)\b/) || [])[1] || null
  let carrier = null
  if (/UCR|OFFICE/.test(hay)) carrier = 'office'
  else {
    for (const [token, key] of Object.entries(CARRIER_KEYS)) {
      if (token.length >= 3 && hay.includes(token.toUpperCase())) { carrier = key; break }
    }
  }
  return { scheduleName: name || null, groupGuess: carrier === 'office' ? 'all' : group, carrierGuess: carrier }
}

export async function parseFeeFile(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  // A: multi-carrier workbook (header containing OFFICE FEES + carrier columns)
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null })
    for (let i = 0; i < Math.min(r.length, 5); i++) {
      if ((r[i] || []).some(c => String(c || '').toLowerCase().trim() === 'office fees')) {
        return { mode: 'multi', ...parseMultiCarrier(r.slice(i)) }
      }
    }
  }
  // B: single-carrier schedule
  for (const name of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null })
    const single = parseSingleCarrier(r)
    if (single) return { mode: 'single', ...single, ...guessIdentity(r, file.name), sheet: name }
  }
  throw new Error("Couldn't recognize this file — expected the multi-carrier fee workbook (header containing 'OFFICE FEES') or a single-carrier schedule with a code column and a fee column")
}

function parseSingleCarrier(rows) {
  if (!rows || !rows.length) return null
  let codeCol = -1, feeCol = -1, start = 0
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const hdr = (rows[i] || []).map(c => String(c || '').toLowerCase().trim())
    const ci = hdr.findIndex(h => /^(proc(edure)?\s*)?(cdt\s*)?code$|^cdt$|^procedure$|^ada code$/.test(h) || h.includes('procedure code') || h.includes('cdt code'))
    const fi = hdr.findIndex(h => /fee|allowed|amount|price|rate|ucr|charge/.test(h) && !/effective|date/.test(h))
    if (ci !== -1 && fi !== -1) { codeCol = ci; feeCol = fi; start = i + 1; break }
  }
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
  const best = new Map()
  for (let i = start; i < rows.length; i++) {
    const r = rows[i] || []
    if (start === 0 && !isCode(r[codeCol])) continue
    const code = normCode(r[codeCol])
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
  const cols = []
  header.forEach((h, idx) => {
    const key = CARRIER_KEYS[String(h || '').toLowerCase().trim()]
    if (key) cols.push({ idx, key })
  })
  if (!cols.length) throw new Error('No recognizable carrier columns in the header')
  const entries = []
  let codes = 0
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    let code = String(r[0] ?? '').trim().toUpperCase()
    if (!code) continue
    if (/^\d+(\.\d+)?$/.test(code)) continue
    code = code.replace(/\.0$/, '')
    let any = false
    for (const { idx, key } of cols) {
      const v = Number(r[idx])
      if (isFinite(v) && v > 0) {
        // workbook has no group dimension: office column is practice-wide,
        // carrier columns land in the default group (740480)
        entries.push({ code, carrier_group: key, fee_group: key === 'office' ? 'all' : '740480', allowed_fee: Math.round(v * 100) / 100 })
        any = true
      }
    }
    if (any) codes++
  }
  return { entries, codes, carriers: [...new Set(cols.map(c => c.key))] }
}

// ── import ─────────────────────────────────────────────────────────────────
export async function importFeeSchedules(entries, chunk = 400, changedBy) {
  const dd = new Map()
  for (const e of entries) {
    const k = e.code + '|' + e.carrier_group + '|' + (e.fee_group || 'all')
    if (!dd.has(k) || e.allowed_fee > dd.get(k).allowed_fee) dd.set(k, { ...e, fee_group: e.fee_group || 'all' })
  }
  entries = [...dd.values()]
  const now = new Date().toISOString()
  let existing = {}
  try {
    const cur = await sbGet('fee_schedules', 'select=code,carrier_group,fee_group,allowed_fee&limit=40000')
    for (const r of cur) existing[r.code + '|' + r.carrier_group + '|' + (r.fee_group || 'all')] = Number(r.allowed_fee)
  } catch {}
  const history = []
  let changed = 0, added = 0
  for (const e of entries) {
    const key = e.code + '|' + e.carrier_group + '|' + e.fee_group
    const old = existing[key]
    if (old === undefined) { added++; history.push({ code: e.code, carrier_group: e.carrier_group, fee_group: e.fee_group, old_fee: null, new_fee: e.allowed_fee, changed_at: now, changed_by: changedBy || null }) }
    else if (Math.abs(old - e.allowed_fee) >= 0.01) { changed++; history.push({ code: e.code, carrier_group: e.carrier_group, fee_group: e.fee_group, old_fee: old, new_fee: e.allowed_fee, changed_at: now, changed_by: changedBy || null }) }
  }
  for (let i = 0; i < entries.length; i += chunk) {
    const batch = entries.slice(i, i + chunk).map(e => ({ ...e, updated_at: now }))
    await sbPost('fee_schedules?on_conflict=code,carrier_group,fee_group', batch, true)
  }
  try {
    for (let i = 0; i < history.length; i += chunk) await sbPost('fee_schedule_history', history.slice(i, i + chunk), false)
  } catch {}
  return { changed, added, unchanged: entries.length - changed - added }
}

export async function importSingleCarrier(items, carrierKey, feeGroup, changedBy) {
  const entries = items.map(it => ({ code: it.code, carrier_group: carrierKey, fee_group: feeGroup || 'all', allowed_fee: it.fee }))
  return importFeeSchedules(entries, 400, changedBy)
}

/** rate history for one code (all carriers/groups), newest first */
export async function feeHistory(code, limit = 50) {
  try {
    return await sbGet('fee_schedule_history', `code=eq.${encodeURIComponent(String(code).toUpperCase())}&select=*&order=changed_at.desc&limit=${limit}`)
  } catch { return [] }
}

// back-compat
export async function parseFeeWorkbook(file) {
  const r = await parseFeeFile(file)
  if (r.mode !== 'multi') throw new Error('Not the multi-carrier workbook')
  return r
}

// ── lookup ─────────────────────────────────────────────────────────────────
// table[code][carrier][group] = fee
export async function loadFeeTable() {
  const rows = await sbGet('fee_schedules', 'select=code,carrier_group,fee_group,allowed_fee,updated_at&limit=40000')
  const table = {}
  let latest = null
  for (const r of rows) {
    const g = r.fee_group || 'all'
    if (!table[r.code]) table[r.code] = {}
    if (!table[r.code][r.carrier_group]) table[r.code][r.carrier_group] = {}
    table[r.code][r.carrier_group][g] = Number(r.allowed_fee)
    if (!latest || r.updated_at > latest) latest = r.updated_at
  }
  return { table, latest, count: rows.length }
}

/** allowed fee for a code + patient carrier + office; falls back sensibly */
export function feeFor(table, code, carrierName, office) {
  const c = table?.[String(code || '').toUpperCase()]
  if (!c) return { fee: null, source: null }
  const key = carrierKeyFor(carrierName)
  const group = OFFICE_GROUP[office] || '740480'
  if (key && c[key]) {
    if (c[key][group] != null) return { fee: c[key][group], source: `${CARRIER_LABELS[key]} (${group})` }
    if (c[key].all != null) return { fee: c[key].all, source: CARRIER_LABELS[key] }
    const anyG = Object.keys(c[key])[0]
    if (anyG) return { fee: c[key][anyG], source: `${CARRIER_LABELS[key]} (${anyG} — other group)` }
  }
  if (c.office) {
    const of = c.office.all ?? c.office[group] ?? Object.values(c.office)[0]
    if (of != null) return { fee: of, source: 'Office UCR (no carrier rate on file)' }
  }
  return { fee: null, source: null }
}
