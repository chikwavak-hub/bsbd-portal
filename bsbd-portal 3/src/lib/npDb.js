// src/lib/npDb.js — NP import database layer.
// Talks straight to Supabase PostgREST with proper on_conflict upserts
// (your sbPost helper merges on primary key; the importer needs to merge
// on unique indexes like upsert_key, so this file has its own caller).
//
// CONFIG: tries Vite env vars first. If your project hardcodes the URL and
// anon key inside src/lib/supabase.js instead, copy those two values into
// the fallback strings below.

const SB_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  'PASTE_YOUR_SUPABASE_URL_HERE';   // e.g. https://abcdefg.supabase.co
const SB_KEY =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  'PASTE_YOUR_ANON_KEY_HERE';

const HEADERS = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  'Content-Type': 'application/json',
};

async function req(path, opts = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** GET rows. q is a PostgREST query string, e.g. 'select=upsert_key&upsert_key=in.(...)' */
export function npGet(table, q) {
  return req(`${table}?${q}`);
}

/** Batch upsert merging on the given conflict column(s), chunked. */
export async function npUpsert(table, rows, onConflict, chunkSize = 200) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await req(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + chunkSize)),
    });
  }
}

/** Plain insert (audit log). */
export function npInsert(table, row) {
  return req(table, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
}

// ─────────────────────────────────────────────────────────────
// Commit: writes parsed NP log records. Re-runnable, never duplicates.
// ─────────────────────────────────────────────────────────────
export async function commitNpImport(records, report, opts = {}) {
  const summary = { inserted: 0, updated: 0, appointments: 0, calls: 0, errors: [] };

  // which patients already exist (for insert-vs-update reporting)
  const existing = new Set();
  const keys = records.map((r) => r.upsert_key);
  for (let i = 0; i < keys.length; i += 100) {
    const part = keys.slice(i, i + 100).map((k) => `"${k}"`).join(',');
    const rows = await npGet('tc_patients', `select=upsert_key&upsert_key=in.(${encodeURIComponent(part)})`);
    rows.forEach((r) => existing.add(r.upsert_key));
  }

  // 1. patients
  const patientRows = records.map((r) => ({
    upsert_key: r.upsert_key,
    office: r.office,
    patient_name: r.patient_name,
    dos: r.dos,
    provider: r.provider,
    provider_type: r.provider_type,
    tc: r.tc,
    who_sched: r.who_sched,
    phone: r.phone,
    exam: r.exam,
    notes: r.notes,
    remarks: r.remarks,
    email_sent: r.email_sent,
    has_appt: r.has_appt,
    total_tx_cost: r.total_tx_cost,
    sched_tx: r.sched_tx,
    ins_expected: r.ins_expected,
    completed_tx: r.completed_tx,
    money_unverified_notes: r.money_unverified_notes,
    accepted: r.accepted,
    showed_any: r.showed_any,
    completed_any: r.completed_any,
    report_month: r.report_month,
    source_tab: r.source_tab,
    imported_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));
  await npUpsert('tc_patients', patientRows, 'upsert_key');
  summary.inserted = records.filter((r) => !existing.has(r.upsert_key)).length;
  summary.updated = records.length - summary.inserted;

  // 2. appointments (skip undated placeholders)
  const apptRows = [];
  records.forEach((r) =>
    r.appointments.forEach((a, i) => {
      if (!a.date) return;
      apptRows.push({ patient_key: r.upsert_key, seq: i + 1, appt_type: a.type, appt_date: a.date, status: a.status });
    })
  );
  await npUpsert('np_appointments', apptRows, 'patient_key,appt_date,appt_type');
  summary.appointments = apptRows.length;

  // 3. calls
  const callRows = [];
  records.forEach((r) =>
    r.calls.forEach((c) =>
      callRows.push({ patient_key: r.upsert_key, seq: c.seq, call_date: c.date, note: c.note, called_by: c.by })
    )
  );
  await npUpsert('np_calls', callRows, 'patient_key,seq');
  summary.calls = callRows.length;

  // 4. audit trail
  try {
    await npInsert('np_import_runs', {
      office: report.office,
      file_name: opts.fileName || null,
      rows_parsed: report.totals.patientRows,
      unique_patients: report.totals.unique,
      inserted: summary.inserted,
      updated: summary.updated,
      skipped: report.totals.skipped,
      report,
      run_by: opts.runBy || null,
    });
  } catch (e) {
    summary.errors.push(`audit log: ${e.message}`); // non-fatal
  }

  return summary;
}
