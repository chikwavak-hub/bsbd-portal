// src/lib/patientRegistry.js — the practice's own operational patient index.
// Assigned internal IDs (deterministic, not phone-based) so repeat patients
// are recognized automatically and printed documents can reference P-IDs
// instead of names where exposure should be limited.

import { sbGet, sbPost } from './supabase'

export const normName = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()

// deterministic 'P-XXXXX' from normalized name + office (stable across runs)
export function patientIdFor(name, office) {
  const key = normName(name) + '|' + String(office || '').toLowerCase()
  let h = 5381
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0
  return 'P-' + h.toString(36).toUpperCase().padStart(7, '0')
}

/** load the registry for an office; keyed by name_norm AND chart number */
export async function loadRegistry(office) {
  try {
    const rows = await sbGet('patients', `office=eq.${encodeURIComponent(office)}&select=*&limit=5000`)
    const m = {}
    for (const r of rows) {
      m[r.patient_name_norm] = r
      if (r.chart_number) m['chart:' + String(r.chart_number).toUpperCase()] = r
    }
    return m
  } catch { return {} }
}

/** match a patient against the registry: chart number first, then name */
export function findInRegistry(registry, { name, chart }) {
  if (chart && registry['chart:' + String(chart).toUpperCase()]) return registry['chart:' + String(chart).toUpperCase()]
  return registry[normName(name)] || null
}

/** upsert one patient into the registry from a collection-sheet row */
export async function registerPatient(p, office, date) {
  const name = (p.patient_name || '').trim()
  if (!name) return null
  const pid = patientIdFor(name, office)
  const row = {
    patient_id: pid,
    patient_name: name,
    patient_name_norm: normName(name),
    office,
    chart_number: p.chart_number || null,
    phone: p.patient_phone || p.phone || null,
    ins_carrier: p.ins_carrier || null,
    last_seen: date || null,
    updated_at: new Date().toISOString(),
  }
  try {
    // preserve first_seen / visit_count if the patient exists
    const ex = await sbGet('patients', `patient_id=eq.${pid}&select=first_seen,visit_count,phone,ins_carrier,chart_number&limit=1`)
    if (ex && ex[0]) {
      row.first_seen = ex[0].first_seen || date || null
      row.visit_count = (ex[0].visit_count || 0) + 1
      if (!row.phone) row.phone = ex[0].phone
      if (!row.ins_carrier) row.ins_carrier = ex[0].ins_carrier
      if (!row.chart_number) row.chart_number = ex[0].chart_number   // never lose a known chart
    } else {
      row.first_seen = date || null
      row.visit_count = 1
    }
    await sbPost('patients', row, true)
    return pid
  } catch { return pid }
}
