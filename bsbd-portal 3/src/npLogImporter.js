// src/lib/npLogImporter.js — BSBD NP Treatment Log importer (v2)
// Parses the monthly NP log workbook (Jan 26 ... July 26 tabs) into
// tc_patients rows using the app's LEGACY field names so every existing
// screen (Patients, Analytics, exports) reads them natively, plus the
// structured appointment chain and call log for the new NP Flow tables.
//
// Re-runnable: records carry a deterministic id derived from
// normalized name + DOS + office, so re-imports merge, never duplicate.

import * as XLSX from 'xlsx';

// ---------- normalizers ----------

export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// deterministic id from the upsert key (djb2 hash, stable across runs)
export function stableId(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return 'np_' + h.toString(36) + '_' + key.replace(/[^a-z0-9]/g, '').slice(0, 12);
}

const HYGIENE_PROVIDERS = ['laura', 'melissa', 'mell', 'sheryl', 'wendy'];

export function normProvider(s) {
  if (!s) return { name: null, type: null };
  let t = String(s).trim();
  if (/^dr\.?\s*/i.test(t)) {
    t = t.replace(/^dr\.?\s*/i, 'Dr. ').replace(/\s+/g, ' ').trim();
    return { name: t, type: 'doctor' };
  }
  if (HYGIENE_PROVIDERS.includes(t.toLowerCase())) {
    return { name: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(), type: 'hygienist' };
  }
  return { name: t, type: 'other' };
}

export function normPhone(s) {
  if (s == null) return '';
  const digits = String(s).replace(/\.0$/, '').replace(/\D/g, '').slice(-10);
  if (digits.length === 10) return digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  return digits.length ? digits : '';
}

// ---------- date parsing ----------

function parseOneDate(token, contextYear) {
  if (token instanceof Date && !isNaN(token)) return token;
  if (token == null) return null;
  const s = String(token).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, +m[1] - 1, +m[2]);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m && contextYear) return new Date(contextYear, +m[1] - 1, +m[2]);
  return null;
}

// Extracts every date + "(yes)" showed-marker from a free-text appt cell.
export function parseApptCell(cell, contextYear, today = new Date()) {
  const out = [];
  if (cell == null || cell === '') return out;
  if (cell instanceof Date) {
    out.push(entry(cell, false, today));
    return out;
  }
  const s = String(cell);
  if (/^(yes|no|broken|hyg appt)$/i.test(s.trim())) return out;
  const re = /(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\s*(\(\s*yes\s*\))?/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const d = parseOneDate(m[1], contextYear);
    if (d) out.push(entry(d, !!m[2], today));
  }
  return out;

  function entry(date, showedMark, now) {
    let status;
    if (showedMark) status = 'showed';
    else if (date <= now) status = 'stale';
    else status = 'scheduled';
    return { date: iso(date), status };
  }
}

// Call cells: "~ Jun 23, 2026 ~ Called to sch, lv vm. zr"
export function parseCallCell(cell, contextYear) {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) return { date: iso(cell), note: '', by: '' };
  const s = String(cell).trim();
  const m = s.match(/^~\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\s*~\s*(.*)$/s);
  if (m) {
    const d = new Date(m[1]);
    const note = m[2].trim();
    const by = (note.match(/\b([a-z]{2})\.?$/) || [])[1] || '';
    return { date: isNaN(d) ? '' : iso(d), note: note || '', by: by ? by.toUpperCase() : '' };
  }
  const d = parseOneDate(s, contextYear);
  if (d) return { date: iso(d), note: '', by: '' };
  return { date: '', note: s, by: '' };
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseMoney(cell) {
  if (cell == null || cell === '') return { value: null, note: null };
  if (typeof cell === 'number') return { value: cell, note: null };
  const s = String(cell).trim();
  const cleaned = s.replace(/[$,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: parseFloat(cleaned), note: null };
  return { value: null, note: s };
}

// ---------- header detection ----------

const HEADER_ALIASES = {
  dr: ['dr'],
  tc: ['who tx plan'],
  dos: ['dos'],
  name: ['patient name'],
  phone: ['contact #', 'contact#', 'contact'],
  exam: ['exam'],
  notes: ['notes'],
  whoSched: ['who sched'],
  appt1: ['1st appt'],
  appt2: ['2nd appt'],
  appt3: ['3rd appt'],
  hygAppt: ['hyg appt'],
  hasAppt: ['has appt'],
  emailSent: ['email sent'],
  call1: ['1st call'],
  call2: ['2nd call'],
  call3: ['3rd call'],
  remarks: ['remarks'],
  totalTx: ['total tx cost?', 'total tx cost'],
  schedTx: ['sched tx $$$', 'sched tx'],
  insExpected: ['ins expected amount', 'ins expected'],
  completedTx: ['total $ tx completed', 'total tx completed'],
};

function findHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 5); r++) {
    const row = rows[r].map((c) => String(c || '').toLowerCase().trim());
    if (row.includes('patient name')) {
      const map = {};
      for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
        const idx = row.findIndex((h) => aliases.includes(h));
        if (idx !== -1) map[key] = idx;
      }
      return { headerRow: r, map };
    }
  }
  return null;
}

// ---------- tab name -> reporting period ----------

const MONTHS = { jan: 0, feb: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function tabPeriod(name) {
  const m = String(name).trim().toLowerCase().match(/^([a-z]+)\s*'?(\d{2,4})$/);
  if (!m || !(m[1] in MONTHS)) return null;
  let y = +m[2];
  if (y < 100) y += 2000;
  return { year: y, month: MONTHS[m[1]] + 1 };
}

// map importer appointment statuses to the app's status vocabulary
// (planned | booked | showed | completed | missed)
function appStatus(s) {
  if (s === 'showed' || s === 'showed_inferred') return 'showed';
  if (s === 'broken') return 'missed';
  return 'booked'; // scheduled + stale both read as booked; stale surfaces via gap flags
}

const APPT_TYPE_LABEL = { tx1: 'Treatment', tx2: 'Treatment', tx3: 'Treatment', hyg: 'Hygiene', from_has_appt: 'Treatment', unknown: 'Treatment' };

// ---------- main parse ----------

/** scan the workbook (first rows of each sheet) + filename for the office name */
export function detectOfficeInWorkbook(wb, fileName) {
  const OFFICE_RE = /\b(Dalton|Calhoun|Brainerd|McCallie|Mc Callie)\b/i;
  const votes = {};
  const vote = (m) => {
    if (!m) return;
    let o = m[1].replace(/\s+/g, '');
    o = o.charAt(0).toUpperCase() + o.slice(1).toLowerCase();
    if (/^mccallie$/i.test(o)) o = 'McCallie';
    votes[o] = (votes[o] || 0) + 1;
  };
  vote(OFFICE_RE.exec(String(fileName || '')));
  try {
    for (const name of wb.SheetNames) {
      vote(OFFICE_RE.exec(name));
      const ws = wb.Sheets[name];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      for (let i = 0; i < Math.min(rows.length, 8); i++) {
        vote(OFFICE_RE.exec((rows[i] || []).map(c => String(c || '')).join(' ')));
      }
    }
  } catch { /* detection is best-effort */ }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : null;
}

export function parseNpLogWorkbook(wb, opts = {}) {
  const detectedOffice = detectOfficeInWorkbook(wb, opts.fileName);
  const office = opts.office || detectedOffice || 'Dalton';
  const today = opts.today ? new Date(opts.today) : new Date();
  const byKey = new Map();
  const report = {
    office,
    detectedOffice,
    officeMismatch: !!(detectedOffice && opts.office && detectedOffice !== opts.office),
    tabs: [],
    totals: { patientRows: 0, unique: 0, duplicatesMerged: 0, skipped: 0, appointments: 0, calls: 0, staleAppointments: 0, showedInferred: 0, moneyNotesFlagged: 0, hygieneOnly: 0 },
    skippedRows: [],
    warnings: [],
  };

  const tabs = wb.SheetNames
    .map((n) => ({ n, p: tabPeriod(n) }))
    .filter((t) => t.p)
    .sort((a, b) => a.p.year - b.p.year || a.p.month - b.p.month);

  for (const { n: tabName, p } of tabs) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tabName], { header: 1, raw: true, defval: null });
    const hdr = findHeader(rows);
    const tabStat = { tab: tabName, rows: 0, skipped: 0 };
    report.tabs.push(tabStat);
    if (!hdr) {
      report.warnings.push(`Tab "${tabName}": no header row found — skipped entire tab`);
      continue;
    }
    const col = hdr.map;
    const cell = (k) => (col[k] != null ? rowsCurrent[col[k]] : null);
    let rowsCurrent = null;

    for (let r = hdr.headerRow + 1; r < rows.length; r++) {
      rowsCurrent = rows[r];
      const nameStr = String(cell('name') || '').trim();
      if (!nameStr) continue;
      if (nameStr.toLowerCase() === 'patient name') continue;

      const dos = parseOneDate(cell('dos'), p.year);
      if (!dos) {
        tabStat.skipped++;
        report.totals.skipped++;
        report.skippedRows.push({ tab: tabName, row: r + 1, name: nameStr, reason: 'no parseable DOS' });
        continue;
      }

      tabStat.rows++;
      report.totals.patientRows++;

      const provider = normProvider(cell('dr'));
      if (provider.type === 'hygienist') report.totals.hygieneOnly++;

      // structured appointment chain (importer statuses)
      const appts = [];
      const push = (k, type) => {
        for (const a of parseApptCell(cell(k), p.year, today)) appts.push({ ...a, type });
      };
      push('appt1', 'tx1');
      push('appt2', 'tx2');
      push('appt3', 'tx3');
      push('hygAppt', 'hyg');

      const hasApptRaw = cell('hasAppt');
      let hasApptStr = ''; // app vocabulary: 'Yes' | 'No' | ''
      if (hasApptRaw != null && hasApptRaw !== '') {
        const s = String(hasApptRaw).trim().toLowerCase();
        if (s === 'yes') hasApptStr = 'Yes';
        else if (s === 'no') hasApptStr = 'No';
        else if (s === 'broken') { hasApptStr = 'No'; appts.push({ date: null, status: 'broken', type: 'unknown' }); }
        else {
          const extra = parseApptCell(hasApptRaw, p.year, today);
          if (extra.length) { hasApptStr = 'Yes'; for (const a of extra) appts.push({ ...a, type: 'from_has_appt' }); }
        }
      }

      // dedupe on date+type, prefer showed
      const seen = new Map();
      for (const a of appts) {
        const k = `${a.date}|${a.type}`;
        const prev = seen.get(k);
        if (!prev || (a.status === 'showed' && prev.status !== 'showed')) seen.set(k, a);
      }
      const apptChain = [...seen.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (!hasApptStr) hasApptStr = apptChain.some((a) => a.date) ? 'Yes' : 'No';

      // money (parse first so inference can use completed $)
      const money = {};
      const moneyNotes = [];
      for (const [k, field] of [['totalTx', 'total_tx_cost'], ['schedTx', 'sched_tx_amount'], ['insExpected', 'ins_expected'], ['completedTx', 'tx_completed']]) {
        const parsed = parseMoney(cell(k));
        money[field] = parsed.value;
        if (parsed.note) { moneyNotes.push(`${field}: ${parsed.note}`); report.totals.moneyNotesFlagged++; }
      }

      // inference: completed production proves the patient showed
      if (money.tx_completed != null && money.tx_completed > 0) {
        for (const a of apptChain) {
          if (a.status === 'stale' && ['tx1', 'tx2', 'tx3', 'from_has_appt'].includes(a.type)) {
            a.status = 'showed_inferred';
          }
        }
      }
      report.totals.appointments += apptChain.length;
      report.totals.staleAppointments += apptChain.filter((a) => a.status === 'stale').length;
      report.totals.showedInferred += apptChain.filter((a) => a.status === 'showed_inferred').length;

      // calls -> legacy call_N fields + structured list
      const calls = [];
      const callFields = {};
      for (const [i, k] of [[1, 'call1'], [2, 'call2'], [3, 'call3']]) {
        const c = col[k] != null ? parseCallCell(cell(k), p.year) : null;
        if (c) {
          calls.push({ seq: i, ...c });
          callFields[`call_${i}_date`] = c.date || '';
          callFields[`call_${i}_notes`] = c.note || '';
          callFields[`call_${i}_method`] = 'Call';
          callFields[`call_${i}_outcome`] = '';
        } else {
          callFields[`call_${i}_date`] = '';
          callFields[`call_${i}_notes`] = '';
          callFields[`call_${i}_method`] = '';
          callFields[`call_${i}_outcome`] = '';
        }
      }
      report.totals.calls += calls.length;

      // app-format appointment array (for getAppointments / AppointmentsPanel)
      const dated = apptChain.filter((a) => a.date);
      const appAppointments = dated.map((a, i) => ({
        seq: i,
        type: APPT_TYPE_LABEL[a.type] || 'Treatment',
        date: a.date,
        time: '',
        status: appStatus(a.status),
        legacy: true,
      }));

      // legacy appt slots
      const txDates = dated.filter((a) => a.type !== 'hyg').map((a) => a.date);
      const hygDates = dated.filter((a) => a.type === 'hyg').map((a) => a.date);

      const upsertKey = `${normName(nameStr)}|${iso(dos)}|${office.toLowerCase()}`;
      const emailRaw = String(cell('emailSent') || '').trim().toLowerCase();

      const rec = {
        // identity
        id: stableId(upsertKey),
        upsert_key: upsertKey,
        office,
        // legacy app fields — everything the Patients page reads
        patient_name: nameStr,
        patient_phone: normPhone(cell('phone')),
        patient_email: '',
        doctor: provider.name || '',
        who_tx_plan: cell('tc') ? String(cell('tc')).trim().toUpperCase() : '',
        assigned_tc_name: cell('tc') ? String(cell('tc')).trim().toUpperCase() : '',
        who_sched: cell('whoSched') ? String(cell('whoSched')).trim() : '',
        dos: iso(dos),
        month_tab: `${p.year}-${String(p.month).padStart(2, '0')}`,
        exam_type: cell('exam') ? String(cell('exam')).trim() : '',
        notes: cell('notes') ? String(cell('notes')).trim() : '',
        remarks: cell('remarks') ? String(cell('remarks')).trim() : '',
        appt_1: txDates[0] || '',
        appt_2: txDates[1] || '',
        appt_3: txDates[2] || '',
        appt_hyg: hygDates[0] || '',
        has_appt: hasApptStr,
        email_sent: emailRaw === 'yes' ? 'Yes' : emailRaw === 'no' ? 'No' : '',
        ...callFields,
        total_tx_cost: money.total_tx_cost ?? '',
        sched_tx_amount: money.sched_tx_amount ?? '',
        ins_expected: money.ins_expected ?? '',
        tx_completed: money.tx_completed ?? '',
        finance_stalled: false,
        finance_barrier: '',
        is_big_case: (money.total_tx_cost || 0) >= 3000,
        big_case_reason: '',
        big_case_notes: '',
        appointments: appAppointments,
        // new NP-flow fields
        provider_type: provider.type,
        report_month: `${p.year}-${String(p.month).padStart(2, '0')}`,
        source_tab: tabName,
        money_unverified_notes: moneyNotes.length ? moneyNotes : null,
        accepted: (money.sched_tx_amount != null && money.sched_tx_amount > 0) || txDates.length > 0,
        showed_any: apptChain.some((a) => a.status === 'showed' || a.status === 'showed_inferred'),
        completed_any: money.tx_completed != null && money.tx_completed > 0,
        // structured chains for np_appointments / np_calls
        _chain: apptChain,
        _calls: calls,
      };

      if (byKey.has(rec.upsert_key)) report.totals.duplicatesMerged++;
      byKey.set(rec.upsert_key, rec);
    }
  }

  report.totals.unique = byKey.size;
  return { records: [...byKey.values()], report };
}

// ---------- dry-run formatter ----------

export function formatDryRun(report) {
  const L = [];
  L.push(`NP LOG IMPORT — DRY RUN (${report.office})`);
  L.push('');
  for (const t of report.tabs) L.push(`  ${t.tab.padEnd(10)} ${String(t.rows).padStart(4)} rows${t.skipped ? `  (${t.skipped} skipped)` : ''}`);
  const T = report.totals;
  L.push('');
  L.push(`  Patient rows parsed:     ${T.patientRows}`);
  L.push(`  Unique patients (upsert):${T.unique}`);
  L.push(`  Duplicates merged:       ${T.duplicatesMerged}`);
  L.push(`  Rows skipped:            ${T.skipped}`);
  L.push(`  Appointments extracted:  ${T.appointments}`);
  L.push(`  ...showed (inferred):    ${T.showedInferred || 0} (past appt + completed $)`);
  L.push(`  ...needing show/no-show: ${T.staleAppointments} (stale)`);
  L.push(`  Calls extracted:         ${T.calls}`);
  L.push(`  Money cells w/ text:     ${T.moneyNotesFlagged} (flagged unverified)`);
  L.push(`  Hygiene-only rows:       ${T.hygieneOnly}`);
  if (report.skippedRows.length) {
    L.push('');
    L.push('  SKIPPED ROWS:');
    for (const s of report.skippedRows.slice(0, 25)) L.push(`    ${s.tab} row ${s.row}: ${s.name} — ${s.reason}`);
    if (report.skippedRows.length > 25) L.push(`    ...and ${report.skippedRows.length - 25} more`);
  }
  for (const w of report.warnings) L.push(`  WARNING: ${w}`);
  return L.join('\n');
}
