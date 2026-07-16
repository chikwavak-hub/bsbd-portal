// npImportCommit.js — writes parsed NP log records to Supabase.
// Re-runnable: upserts tc_patients on upsert_key, np_appointments on
// (patient_key, appt_date, appt_type), np_calls on (patient_key, seq).
//
// import { commitNpImport } from './npImportCommit';
// const summary = await commitNpImport(supabase, records, report, { fileName, runBy });

const CHUNK = 200;

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

export async function commitNpImport(supabase, records, report, opts = {}) {
  const summary = { inserted: 0, updated: 0, appointments: 0, calls: 0, errors: [] };

  // figure out which keys already exist so we can report insert vs update
  const keys = records.map((r) => r.upsert_key);
  const existing = new Set();
  for (const part of chunk(keys, 300)) {
    const { data, error } = await supabase
      .from('tc_patients')
      .select('upsert_key')
      .in('upsert_key', part);
    if (error) { summary.errors.push(`precheck: ${error.message}`); return summary; }
    for (const row of data) existing.add(row.upsert_key);
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
  }));
  for (const part of chunk(patientRows, CHUNK)) {
    const { error } = await supabase
      .from('tc_patients')
      .upsert(part, { onConflict: 'upsert_key' });
    if (error) { summary.errors.push(`patients: ${error.message}`); return summary; }
  }
  summary.inserted = records.filter((r) => !existing.has(r.upsert_key)).length;
  summary.updated = records.length - summary.inserted;

  // 2. appointments — only rows with a real date can hit the dedupe index
  const apptRows = [];
  for (const r of records) {
    r.appointments.forEach((a, i) => {
      if (!a.date) return; // 'broken' placeholder without a date: skip, patient-level flag covers it
      apptRows.push({
        patient_key: r.upsert_key,
        seq: i + 1,
        appt_type: a.type,
        appt_date: a.date,
        status: a.status,
      });
    });
  }
  for (const part of chunk(apptRows, CHUNK)) {
    const { error } = await supabase
      .from('np_appointments')
      .upsert(part, { onConflict: 'patient_key,appt_date,appt_type' });
    if (error) { summary.errors.push(`appointments: ${error.message}`); return summary; }
  }
  summary.appointments = apptRows.length;

  // 3. calls
  const callRows = [];
  for (const r of records) {
    for (const c of r.calls) {
      callRows.push({
        patient_key: r.upsert_key,
        seq: c.seq,
        call_date: c.date,
        note: c.note,
        called_by: c.by,
      });
    }
  }
  for (const part of chunk(callRows, CHUNK)) {
    const { error } = await supabase
      .from('np_calls')
      .upsert(part, { onConflict: 'patient_key,seq' });
    if (error) { summary.errors.push(`calls: ${error.message}`); return summary; }
  }
  summary.calls = callRows.length;

  // 4. audit row
  await supabase.from('np_import_runs').insert({
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

  return summary;
}
