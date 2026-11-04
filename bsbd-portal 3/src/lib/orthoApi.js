// Data access for the Ortho module. Uses the portal's existing Supabase helpers.
// sbGet(table, query) → rows · sbPost(table, row, true) → upsert on id · sbDel(table, query)
import { sbGet, sbPost, sbDel } from './supabase';
import { FORMS, stripPhi } from './orthoSchema';

const TABLE = 'ortho_charts';

export function newId() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  return 'oc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function listCharts({ office, chartNo, formType } = {}) {
  const q = ['select=id,form_type,chart_no,office,dentist,record_date,status,updated_by,updated_at', 'order=updated_at.desc', 'limit=300'];
  if (office) q.push(`office=eq.${encodeURIComponent(office)}`);
  if (formType) q.push(`form_type=eq.${formType}`);
  if (chartNo) q.push(`chart_no=ilike.*${encodeURIComponent(chartNo.trim())}*`);
  const rows = await sbGet(TABLE, q.join('&'));
  return Array.isArray(rows) ? rows : [];
}

export async function getChart(id) {
  const rows = await sbGet(TABLE, `id=eq.${encodeURIComponent(id)}&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Saves chart # + clinical data only. PHI is stripped here as well as blocked by the database.
export async function saveChart(rec, userName) {
  const form = FORMS[rec.form_type];
  const row = {
    id: rec.id,
    form_type: rec.form_type,
    chart_no: String(rec.chart_no || '').trim(),
    office: rec.office || null,
    dentist: rec.dentist || null,
    record_date: rec.record_date || null,
    status: rec.status || 'draft',
    data: stripPhi(form, rec.data || {}),
    updated_by: userName || null,
    updated_at: new Date().toISOString(),
  };
  if (!rec.created_by) row.created_by = userName || null;
  return sbPost(TABLE, row, true);
}

export async function deleteChart(id) {
  return sbDel(TABLE, `id=eq.${encodeURIComponent(id)}`);
}
