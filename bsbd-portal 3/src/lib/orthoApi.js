// Data access for the Ortho module. Uses the portal's existing Supabase helpers.
// sbGet(table, query) → rows · sbPost(table, row, true) → upsert on id · sbDel(table, query)
import { sbGet, sbPost, sbDel, sbUpload, sbDownload, sbRemove } from './supabase';
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

// ── Ceph reports (Supabase Storage, private bucket 'ortho-files') ───────────
const BUCKET = 'ortho-files';

// Path uses the record id only — no names. e.g. ceph/<record id>/20261109-181530_i.pdf
export async function uploadCephReport(recordId, stage, blob) {
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const path = `ceph/${recordId}/${ts}_${stage}.pdf`;
  await sbUpload(BUCKET, path, blob, 'application/pdf');
  return path;
}

export async function openCephReport(path, title = 'Ceph report') {
  const w = window.open('', '_blank'); // opened inside the click so pop-up blockers allow it
  if (!w) throw new Error('Allow pop-ups for this site to open the report');
  w.document.write('<p style="font-family:Arial;padding:24px;color:#1B2A6B">Opening the report…</p>');
  try {
    const blob = await sbDownload(BUCKET, path);
    const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
    const name = path.split('/').pop();
    // PDF shown full-window, with a download link for browsers that only preview the first page (iPad Safari).
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
      <body style="margin:0;font-family:Arial,sans-serif;background:#e9ebf0">
      <div style="background:#1B2A6B;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center">
        <span>${title}</span><a id="dl" href="${url}" download="${name}" style="background:#C9A84C;color:#1B2A6B;padding:7px 14px;border-radius:6px;font-weight:bold;text-decoration:none">Download</a></div>
      <object data="${url}" type="application/pdf" style="width:100%;height:calc(100vh - 52px);border:0">
        <p style="padding:24px">This browser can't show the PDF here. Tap <b>Download</b> to open it.</p></object></body></html>`);
    w.document.close();
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  } catch (e) {
    w.close();
    throw e;
  }
}

export async function removeCephReport(path) {
  return sbRemove(BUCKET, [path]);
}

// Removing a chart also removes its saved reports.
export async function removeChartFiles(paths) {
  if (paths && paths.length) await sbRemove(BUCKET, paths);
}
