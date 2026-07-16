// npLogImporter.js — BSBD NP Treatment Log importer
// Parses the monthly NP log workbook (Jan 26 ... July 26 tabs) into
// structured patient records matching the NP Patient Flow data model.
// Re-runnable: produces upsert records keyed on normalized name + DOS.
//
// Usage (browser):  import { parseNpLogWorkbook } from './npLogImporter';
//                   const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
//                   const result = parseNpLogWorkbook(wb);
// result = { records: [...], report: {...} }

import * as XLSX from 'xlsx';

// ---------- normalizers ----------

export function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HYGIENE_PROVIDERS = ['laura', 'melissa', 'mell', 'sheryl', 'wendy'];

export function normProvider(s) {
  if (!s) return { name: null, type: null };
  let t = String(s).trim();
  if (/^dr\b/i.test(t.replace(/\./g, '')) || /^dr\.?\s*/i.test(t)) {
    // normalize "Dr.E" -> "Dr. E", collapse spacing
    t = t.replace(/^dr\.?\s*/i, 'Dr. ').replace(/\s+/g, ' ').trim();
    return { name: t, type: 'doctor' };
  }
  if (HYGIENE_PROVIDERS.includes(t.toLowerCase())) {
    return { name: t.charAt(0).toUpperCase() + t.slice(1).toLowerCase(), type: 'hygienist' };
  }
  return { name: t, type: 'other' };
}

export function normPhone(s) {
  if (s == null) return null;
  const digits = String(s).replace(/\.0$/, '').replace(/\D/g, '');
  if (digits.length === 10) return digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  return digits.length ? digits : null;
}

// ---------- date parsing ----------

// Accepts Date objects, ISO strings, "6/12/26", "6/12", "12/16/2026"
// contextYear: the tab's year, used when a date has no year.
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
// "3/12/26 (yes) & 5/29/26 (yes) & 12/16/26" -> 3 entries.
export function parseApptCell(cell, contextYear, today = new Date()) {
  const out = [];
  if (cell == null || cell === '') return out;
  if (cell instanceof Date) {
    out.push(entry(cell, false, today));
    return out;
  }
  const s = String(cell);
  if (/^(yes|no|broken|hyg appt)$/i.test(s.trim())) return out; // flag-only, no date
  // find date tokens with optional trailing (yes)
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
    else if (date <= now) status = 'stale'; // past date, no show/no-show recorded
    else status = 'scheduled';
    return { date: iso(date), status };
  }
}

// Call cells: "~ Jun 23, 2026 ~ Called to sch, lv vm. zr"
export function parseCallCell(cell, contextYear) {
  if (cell == null || cell === '') return null;
  if (cell instanceof Date) return { date: iso(cell), note: null, by: null };
  const s = String(cell).trim();
  const m = s.match(/^~\s*([A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4})\s*~\s*(.*)$/s);
  if (m) {
    const d = new Date(m[1]);
    const note = m[2].trim();
    const by = (note.match(/\b([a-z]{2})\.?$/) || [])[1] || null;
    return { date: isNaN(d) ? null : iso(d), note: note || null, by: by ? by.toUpperCase() : null };
  }
  const d = parseOneDate(s, contextYear);
  if (d) return { date: iso(d), note: null, by: null };
  return { date: null, note: s, by: null };
}

function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Money cells: numbers pass through; text becomes a note + unverified flag.
export function parseMoney(cell) {
  if (cell == null || cell === '') return { value: null, note: null };
  if (typeof cell === 'number') return { value: cell, note: null };
  const s = String(cell).trim();
  const cleaned = s.replace(/[$,]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return { value: parseFloat(cleaned), note: null };
  return { value: null, note: s }; // remarks typed into a money column
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
  // scan first 5 rows for one containing "patient name"
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

// ---------- main parse ----------

export function parseNpLogWorkbook(wb, opts = {}) {
  const office = opts.office || 'Dalton';
  const today = opts.today ? new Date(opts.today) : new Date();
  const byKey = new Map(); // upsert key -> record (later tabs win)
  const report = {
    office,
    tabs: [],
    totals: { patientRows: 0, unique: 0, duplicatesMerged: 0, skipped: 0, appointments: 0, calls: 0, staleAppointments: 0, moneyNotesFlagged: 0, hygieneOnly: 0 },
    skippedRows: [],
    warnings: [],
  };

  // process tabs oldest -> newest so newest data wins the upsert
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

    for (let r = hdr.headerRow + 1; r < rows.length; r++) {
      const row = rows[r];
      const rawName = col.name != null ? row[col.name] : null;
      const nameStr = String(rawName || '').trim();
      if (!nameStr) continue; // blank row
      if (nameStr.toLowerCase() === 'patient name') continue; // repeated header

      const dos = parseOneDate(col.dos != null ? row[col.dos] : null, p.year);
      if (!dos) {
        tabStat.skipped++;
        report.totals.skipped++;
        report.skippedRows.push({ tab: tabName, row: r + 1, name: nameStr, reason: 'no parseable DOS' });
        continue;
      }

      tabStat.rows++;
      report.totals.patientRows++;

      const provider = normProvider(row[col.dr]);
      if (provider.type === 'hygienist') report.totals.hygieneOnly++;

      // appointments: 1st, 2nd, 3rd (Feb), Hyg, plus dates buried in HAS APPT
      const appts = [];
      const push = (cellKey, type) => {
        if (col[cellKey] == null) return;
        for (const a of parseApptCell(row[col[cellKey]], p.year, today)) appts.push({ ...a, type });
      };
      push('appt1', 'tx1');
      push('appt2', 'tx2');
      push('appt3', 'tx3');
      push('hygAppt', 'hyg');

      const hasApptRaw = col.hasAppt != null ? row[col.hasAppt] : null;
      let hasAppt = null;
      if (hasApptRaw != null && hasApptRaw !== '') {
        const s = String(hasApptRaw).trim().toLowerCase();
        if (s === 'yes') hasAppt = true;
        else if (s === 'no') hasAppt = false;
        else if (s === 'broken') { hasAppt = false; appts.push({ date: null, status: 'broken', type: 'unknown' }); }
        else {
          const extra = parseApptCell(hasApptRaw, p.year, today);
          if (extra.length) { hasAppt = true; for (const a of extra) appts.push({ ...a, type: 'from_has_appt' }); }
        }
      }
      // dedupe appointments on date+type, prefer 'showed' over 'stale'/'scheduled'
      const seen = new Map();
      for (const a of appts) {
        const k = `${a.date}|${a.type}`;
        const prev = seen.get(k);
        if (!prev || (a.status === 'showed' && prev.status !== 'showed')) seen.set(k, a);
      }
      const apptChain = [...seen.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      if (hasAppt === null) hasAppt = apptChain.some((a) => a.date);
      // inference: completed production proves the patient showed. Mark past
      // tx appointments (and has-appt dates) as showed_inferred instead of stale.
      const completedParsed = parseMoney(col.completedTx != null ? row[col.completedTx] : null);
      if (completedParsed.value != null && completedParsed.value > 0) {
        for (const a of apptChain) {
          if (a.status === 'stale' && ['tx1', 'tx2', 'tx3', 'from_has_appt'].includes(a.type)) {
            a.status = 'showed_inferred';
          }
        }
      }
      report.totals.appointments += apptChain.length;
      report.totals.staleAppointments += apptChain.filter((a) => a.status === 'stale').length;
      report.totals.showedInferred = (report.totals.showedInferred || 0) + apptChain.filter((a) => a.status === 'showed_inferred').length;

      // calls
      const calls = [];
      for (const k of ['call1', 'call2', 'call3']) {
        if (col[k] == null) continue;
        const c = parseCallCell(row[col[k]], p.year);
        if (c) calls.push({ seq: calls.length + 1, ...c });
      }
      report.totals.calls += calls.length;

      // money
      const money = {};
      const moneyNotes = [];
      for (const [k, field] of [['totalTx', 'total_tx_cost'], ['schedTx', 'sched_tx'], ['insExpected', 'ins_expected'], ['completedTx', 'completed_tx']]) {
        const parsed = parseMoney(col[k] != null ? row[col[k]] : null);
        money[field] = parsed.value;
        if (parsed.note) { moneyNotes.push(`${field}: ${parsed.note}`); report.totals.moneyNotesFlagged++; }
      }

      const rec = {
        upsert_key: `${normName(nameStr)}|${iso(dos)}`,
        office,
        patient_name: nameStr,
        dos: iso(dos),
        source_tab: tabName,
        report_month: `${p.year}-${String(p.month).padStart(2, '0')}`,
        provider: provider.name,
        provider_type: provider.type,
        tc: row[col.tc] ? String(row[col.tc]).trim().toUpperCase() : null,
        who_sched: col.whoSched != null && row[col.whoSched] ? String(row[col.whoSched]).trim() : null,
        phone: normPhone(col.phone != null ? row[col.phone] : null),
        exam: col.exam != null && row[col.exam] ? String(row[col.exam]).trim() : null,
        notes: col.notes != null && row[col.notes] ? String(row[col.notes]).trim() : null,
        remarks: col.remarks != null && row[col.remarks] ? String(row[col.remarks]).trim() : null,
        email_sent: col.emailSent != null && /yes/i.test(String(row[col.emailSent] || '')),
        has_appt: hasAppt,
        appointments: apptChain,
        calls,
        total_tx_cost: money.total_tx_cost,
        sched_tx: money.sched_tx,
        ins_expected: money.ins_expected,
        completed_tx: money.completed_tx,
        money_unverified_notes: moneyNotes.length ? moneyNotes : null,
        // lifecycle derivations
        accepted: money.sched_tx != null && money.sched_tx > 0 || apptChain.some((a) => ['tx1', 'tx2', 'tx3'].includes(a.type)),
        showed_any: apptChain.some((a) => a.status === 'showed' || a.status === 'showed_inferred'),
        completed_any: money.completed_tx != null && money.completed_tx > 0,
      };

      if (byKey.has(rec.upsert_key)) report.totals.duplicatesMerged++;
      byKey.set(rec.upsert_key, rec); // later tab wins
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
