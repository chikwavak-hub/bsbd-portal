// src/lib/npDb.js — NP import database layer (v2).
// Upserts tc_patients on the id primary key with deterministic ids, and
// ADOPTS existing patients (same name + DOS + office, e.g. rows created
// earlier via "Import Month List" or hand entry) instead of duplicating them.
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

export function npGet(table, q) {
  return req(`${table}?${q}`);
}

export async function npUpsert(table, rows, onConflict, chunkSize = 200) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await req(`${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + chunkSize)),
    });
  }
}

export function npInsert(table, row) {
  return req(table, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
}

const normKeyName = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

// ─────────────────────────────────────────────────────────────
// Commit: writes parsed NP log records. Re-runnable, never duplicates,
// and merges into pre-existing rows for the same patient.
// ─────────────────────────────────────────────────────────────
export async function commitNpImport(records, report, opts = {}) {
  const summary = { inserted: 0, updated: 0, adopted: 0, appointments: 0, calls: 0, errors: [] };

  // Fetch existing patients for this office to adopt matches (paged).
  const existing = new Map(); // matchKey -> { id, upsert_key }
  const existingIds = new Set();
  let offset = 0;
  const PAGE = 1000;
  for (;;) {
    const rows = await npGet(
      'tc_patients',
      `select=id,patient_name,dos,office,upsert_key&office=eq.${encodeURIComponent(report.office)}&limit=${PAGE}&offset=${offset}`
    );
    for (const r of rows) {
      existingIds.add(r.id);
      const k = `${normKeyName(r.patient_name)}|${(r.dos || '').slice(0, 10)}`;
      if (!existing.has(k)) existing.set(k, r);
    }
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // 1. patients — adopt existing ids where a match exists
  const patientRows = records.map((r) => {
    const { _chain, _calls, ...row } = r;
    const matchKey = `${normKeyName(r.patient_name)}|${r.dos}`;
    const match = existing.get(matchKey);
    if (match) {
      row.id = match.id; // merge into the existing record instead of creating a twin
      summary.adopted++;
    }
    row.imported_at = new Date().toISOString();
    row.updated_at = new Date().toISOString();
    // empty-string money fields -> null so numeric columns accept them
    for (const f of ['total_tx_cost', 'sched_tx_amount', 'ins_expected', 'tx_completed']) {
      if (row[f] === '') row[f] = null;
    }
    return row;
  });

  // resolve rare collisions: two records adopting the same id (shouldn't
  // happen with name+dos keys, but guard anyway)
  const seenIds = new Set();
  for (const row of patientRows) {
    if (seenIds.has(row.id)) row.id = row.id + '_x';
    seenIds.add(row.id);
  }

  try {
    await npUpsert('tc_patients', patientRows, 'id');
  } catch (e) {
    summary.errors.push(`patients: ${e.message}`);
    return summary;
  }
  summary.inserted = patientRows.filter((r) => !existingIds.has(r.id)).length;
  summary.updated = patientRows.length - summary.inserted;

  // 2. structured appointments (keyed by upsert_key for the np views)
  const apptRows = [];
  records.forEach((r) =>
    (r._chain || []).forEach((a, i) => {
      if (!a.date) return;
      apptRows.push({ patient_key: r.upsert_key, seq: i + 1, appt_type: a.type, appt_date: a.date, status: a.status });
    })
  );
  try {
    await npUpsert('np_appointments', apptRows, 'patient_key,appt_date,appt_type');
    summary.appointments = apptRows.length;
  } catch (e) {
    summary.errors.push(`appointments: ${e.message}`);
  }

  // 3. structured calls
  const callRows = [];
  records.forEach((r) =>
    (r._calls || []).forEach((c) =>
      callRows.push({ patient_key: r.upsert_key, seq: c.seq, call_date: c.date || null, note: c.note || null, called_by: c.by || null })
    )
  );
  try {
    await npUpsert('np_calls', callRows, 'patient_key,seq');
    summary.calls = callRows.length;
  } catch (e) {
    summary.errors.push(`calls: ${e.message}`);
  }

  // 4. audit trail (non-fatal)
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
    summary.errors.push(`audit log (non-fatal): ${e.message}`);
  }

  return summary;
}
