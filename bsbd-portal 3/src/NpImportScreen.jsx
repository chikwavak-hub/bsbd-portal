// NpImportScreen.jsx — NP log import: drop the xlsx, review the dry run, commit.
// Wire into App.jsx routing; pass the shared supabase client as a prop.

import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { parseNpLogWorkbook } from './lib/npLogImporter';
import { commitNpImport } from './npImportCommit';

const OFFICES = ['Dalton', 'Brainerd', 'Calhoun', 'McCallie'];

export default function NpImportScreen({ supabase, currentUser }) {
  const [office, setOffice] = useState('Dalton');   // expected office — a safety check, not the assignment
  const [fileName, setFileName] = useState(null);
  const [parsed, setParsed] = useState(null);   // { records, report }
  const [confirmedOffice, setConfirmedOffice] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef();

  async function handleFile(file) {
    setError(null); setResult(null); setParsed(null); setConfirmedOffice(false);
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const out = parseNpLogWorkbook(wb, { fileName: file.name });
      if (!out.records.length) {
        setError('No patient rows found. Check that the tabs are named like "June 26" and the header row contains "Patient Name".');
        return;
      }
      setParsed(out);
    } catch (e) {
      setError(`Could not read file: ${e.message}`);
    }
  }

  async function handleCommit() {
    if (!parsed) return;
    setCommitting(true); setError(null);
    try {
      const summary = await commitNpImport(supabase, parsed.records, parsed.report, {
        fileName, runBy: currentUser?.email || null,
      });
      if (summary.errors.length) setError(summary.errors.join(' | '));
      else setResult(summary);
    } catch (e) {
      setError(e.message);
    } finally {
      setCommitting(false);
    }
  }

  const T = parsed?.report?.totals;
  const detectedOffice = parsed?.report?.detectedOffice || null;
  const importOffice = parsed?.report?.office || office;
  const officeMismatch = !!(parsed && detectedOffice && detectedOffice !== office);
  const officeUndetected = !!(parsed && !detectedOffice);
  const needsOfficeConfirm = officeMismatch || officeUndetected;
  const commitBlocked = needsOfficeConfirm && !confirmedOffice;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 24 }}>
      <h2 style={{ marginBottom: 4 }}>Import NP treatment log</h2>
      <p style={{ color: '#666', marginTop: 0 }}>
        Upload the monthly NP log workbook. Nothing is written until you review the dry run and confirm.
        Safe to re-run — existing patients are updated, never duplicated.
      </p>

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '16px 0' }}>
        <label>Expected office:{' '}
          <select value={office} onChange={(e) => { setOffice(e.target.value); setParsed(null); setResult(null); setConfirmedOffice(false); }}>
            {OFFICES.map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <input
          ref={inputRef} type="file" accept=".xlsx,.xls"
          onChange={(e) => handleFile(e.target.files[0])}
        />
      </div>
      <p style={{ color: '#888', fontSize: 13, marginTop: -8 }}>
        The office is read from the file itself. The dropdown is only a cross-check — if the two disagree, you'll be asked to confirm before anything is written.
      </p>

      {error && (
        <div style={{ background: '#FDECEA', color: '#8B1A1A', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {needsOfficeConfirm && !result && (
        <div style={{ background: '#FFF6E5', color: '#7A4E00', border: '1px solid #F0D9A8', padding: '12px 16px', borderRadius: 8, marginBottom: 16 }}>
          {officeMismatch ? (
            <>
              <strong>Office mismatch.</strong> This file looks like <strong>{detectedOffice}</strong>, but you selected <strong>{office}</strong>.
              All {T?.unique} patients will be filed under <strong>{importOffice}</strong>.
            </>
          ) : (
            <>
              <strong>Office not detected.</strong> Nothing in the filename or the sheet names an office, so these records
              would default to <strong>{importOffice}</strong>. Rename the file to include the office and re-upload if that's wrong.
            </>
          )}
          <label style={{ display: 'block', marginTop: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={confirmedOffice} onChange={(e) => setConfirmedOffice(e.target.checked)} />
            {' '}Yes, import these patients as <strong>{importOffice}</strong>.
          </label>
        </div>
      )}

      {parsed && !result && (
        <div style={{ border: '1px solid #ddd', borderRadius: 10, padding: 18, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Dry run — {fileName}</h3>
          <p style={{ marginTop: 0, fontSize: 14, color: '#444' }}>
            Office read from file: <strong>{detectedOffice || 'not detected'}</strong> — importing as <strong>{importOffice}</strong>
          </p>
          <table style={{ fontSize: 14, borderCollapse: 'collapse' }}>
            <tbody>
              {parsed.report.tabs.map((t) => (
                <tr key={t.tab}>
                  <td style={{ padding: '2px 16px 2px 0', color: '#666' }}>{t.tab}</td>
                  <td>{t.rows} rows{t.skipped ? ` (${t.skipped} skipped)` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul style={{ fontSize: 14, lineHeight: 1.8 }}>
            <li><strong>{T.unique}</strong> unique patients ({T.duplicatesMerged} duplicates merged)</li>
            <li><strong>{T.appointments}</strong> appointments — {T.showedInferred || 0} showed (inferred from completed $), <strong>{T.staleAppointments}</strong> need show/no-show marked</li>
            <li><strong>{T.calls}</strong> call log entries</li>
            <li>{T.moneyNotesFlagged} money cells contained text — imported as notes, dollars left blank</li>
            <li>{T.hygieneOnly} hygiene-only rows (kept, excluded from doctor scorecard)</li>
          </ul>
          {parsed.report.skippedRows.length > 0 && (
            <details>
              <summary style={{ cursor: 'pointer' }}>{parsed.report.skippedRows.length} skipped rows</summary>
              <ul style={{ fontSize: 13 }}>
                {parsed.report.skippedRows.map((s, i) => (
                  <li key={i}>{s.tab} row {s.row}: {s.name} — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
          <button
            onClick={handleCommit} disabled={committing || commitBlocked}
            style={{ marginTop: 14, background: '#1B2A6B', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 15, cursor: (committing || commitBlocked) ? 'not-allowed' : 'pointer', opacity: (committing || commitBlocked) ? 0.6 : 1 }}
          >
            {committing ? 'Importing…' : `Import ${T.unique} patients to ${importOffice}`}
          </button>
          {commitBlocked && (
            <div style={{ fontSize: 13, color: '#7A4E00', marginTop: 8 }}>
              Confirm the office above to enable the import.
            </div>
          )}
        </div>
      )}

      {result && (
        <div style={{ background: '#EAF6EC', color: '#1E5B2A', padding: '14px 18px', borderRadius: 10 }}>
          <strong>Import complete.</strong> {result.inserted} new patients, {result.updated} updated,
          {' '}{result.appointments} appointments, {result.calls} calls written.
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Re-run anytime with a newer copy of the sheet — updates apply, nothing duplicates.
          </div>
        </div>
      )}
    </div>
  );
}
