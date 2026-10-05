// src/lib/notesApi.js
// Saved notes for the Note Builder's billing <-> dentist workflow.
//
//   draft     saved, still being worked on
//   needs_dr  billing sent it to the dentist with a list of missing items
//   dr_done   the dentist finished and sent it back to billing
//   complete  billing signed off; the note is ready for Ascend / the claim
//
// Identifiers: only the chart number is stored. No patient name, DOB, phone or
// address. The note itself is still clinical information tied to a chart number,
// so the table needs the same protection as any PHI (see the migration file).

import { sbGet, sbPost, sbDel } from './supabase'

export const NOTE_STATUS = {
  draft: { label: 'Draft', fg: '#5E6577', bg: '#EEF1F8' },
  needs_dr: { label: 'Waiting for dentist', fg: '#B42318', bg: '#FDECEA' },
  dr_done: { label: 'Back to billing', fg: '#8A5A00', bg: '#FFF3D6' },
  complete: { label: 'Complete', fg: '#1E7A46', bg: '#E8F4EC' },
}

// "Dr. Shahil Patel, DDS" and "Shahil Patel" are the same person: compare last names
const lastName = n => String(n || '').toLowerCase().replace(/\b(dr|dds|dmd|md)\b\.?/g, '').replace(/[^a-z\s-]/g, ' ').trim().split(/\s+/).filter(Boolean).pop() || ''
export const sameDentist = (a, b) => !!lastName(a) && lastName(a) === lastName(b)

// Chart numbers only: letters, digits and dashes (no spaces, so names can't sneak in)
export const cleanChart = v => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20)

export async function listNotes() {
  return sbGet('clinical_notes', 'select=id,chart_no,office,dos,section,tooth_label,doctor,assigned_to,status,requests,updated_at,updated_by&order=updated_at.desc&limit=300')
}

export async function getNote(id) {
  const rows = await sbGet('clinical_notes', `id=eq.${encodeURIComponent(id)}&select=*`)
  return rows?.[0] || null
}

export async function saveNote(row) {
  const now = new Date().toISOString()
  const full = { ...row, updated_at: now, created_at: row.created_at || now }
  await sbPost('clinical_notes', full, true)   // upsert on id
  return full
}

export async function deleteNote(id) {
  return sbDel('clinical_notes', `id=eq.${encodeURIComponent(id)}`)
}

// For the module tile badge
export async function countWaiting(user) {
  try {
    const rows = await sbGet('clinical_notes', 'status=in.(needs_dr,dr_done)&select=status,assigned_to')
    if (user?.role === 'provider') return { count: rows.filter(r => r.status === 'needs_dr' && sameDentist(r.assigned_to, user.name || user.staffName)).length, kind: 'dr' }
    return { count: rows.filter(r => r.status === 'dr_done').length, kind: 'billing' }
  } catch { return { count: 0, kind: '' } }
}
