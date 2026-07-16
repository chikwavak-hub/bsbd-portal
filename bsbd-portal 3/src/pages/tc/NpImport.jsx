// src/pages/tc/NpImport.jsx — NP treatment log import (manager only).
// Drop the monthly xlsx → review dry run → commit. Re-runnable safely.

import React, { useState } from 'react'
import * as XLSX from 'xlsx'
import { parseNpLogWorkbook } from '../../lib/npLogImporter'
import { commitNpImport } from '../../lib/npDb'
import { OFFICES } from '../../lib/constants'

export default function NpImportPage({ user, notify, onImportDone }) {
  const [office, setOffice]         = useState(user?.office && OFFICES.includes(user.office) ? user.office : 'Dalton')
  const [fileName, setFileName]     = useState(null)
  const [parsed, setParsed]         = useState(null)
  const [committing, setCommitting] = useState(false)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState(null)

  async function handleFile(e) {
    const file = e.target.files[0]
    e.target.value = '' // allow re-selecting the same file
    setError(null); setResult(null); setParsed(null)
    if (!file) return
    setFileName(file.name)
    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf, { type: 'array', cellDates: true })
      const out = parseNpLogWorkbook(wb, { office })
      if (!out.records.length) {
        setError('No patient rows found. Tabs must be named like "June 26" and the header row must contain "Patient Name".')
        return
      }
      setParsed(out)
    } catch (err) {
      setError('Could not read file: ' + err.message)
    }
  }

  async function handleCommit() {
    if (!parsed || committing) return
    setCommitting(true); setError(null)
    try {
      const summary = await commitNpImport(parsed.records, parsed.report, {
        fileName,
        runBy: user?.username || user?.name || null,
      })
      if (summary.errors.length) {
        setError(summary.errors.join(' | '))
      } else {
        setResult(summary)
        notify && notify(`✅ Imported ${summary.inserted} new, updated ${summary.updated}`)
        onImportDone && onImportDone()
      }
    } catch (err) {
      setError(err.message)
      notify && notify('Import failed: ' + err.message, 'error')
    }
    setCommitting(false)
  }

  const T = parsed?.report?.totals

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 }

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: 24 }}>
      <h2 style={{ margin: '0 0 4px' }}>Import NP Treatment Log</h2>
      <p style={{ color: '#64748b', marginTop: 0, fontSize: 14 }}>
        Upload the monthly NP log workbook. Nothing is written until you review the dry run and confirm.
        Safe to re-run with a newer copy — existing patients update, nothing duplicates.
      </p>

      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ fontSize: 14, fontWeight: 600 }}>
          Office{' '}
          <select value={office} onChange={e => { setOffice(e.target.value); setParsed(null); setResult(null) }}
                  style={{ marginLeft: 6, padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1' }}>
            {OFFICES.map(o => <option key={o}>{o}</option>)}
          </select>
        </label>
        <input type="file" accept=".xlsx,.xls" onChange={handleFile} style={{ fontSize: 14 }} />
      </div>

      {error && (
        <div style={{ background: '#fef2f2', color: '#991b1b', padding: '12px 16px', borderRadius: 10, marginBottom: 16, fontSize: 14 }}>
          {error}
        </div>
      )}

      {parsed && !result && (
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Dry run — {fileName}</h3>
          <table style={{ fontSize: 14, borderCollapse: 'collapse', marginBottom: 12 }}>
            <tbody>
              {parsed.report.tabs.map(t => (
                <tr key={t.tab}>
                  <td style={{ padding: '2px 18px 2px 0', color: '#64748b' }}>{t.tab}</td>
                  <td>{t.rows} rows{t.skipped ? ` — ${t.skipped} skipped` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul style={{ fontSize: 14, lineHeight: 1.9, margin: 0, paddingLeft: 20 }}>
            <li><b>{T.unique}</b> unique patients ({T.duplicatesMerged} duplicates merged)</li>
            <li><b>{T.appointments}</b> appointments — {T.showedInferred || 0} showed (inferred from completed $), <b>{T.staleAppointments}</b> still need show/no-show marked</li>
            <li><b>{T.calls}</b> call log entries</li>
            <li>{T.moneyNotesFlagged} money cells contained text — kept as notes, dollars left blank</li>
            <li>{T.hygieneOnly} hygiene-only rows (kept; excluded from doctor stats)</li>
          </ul>
          {parsed.report.skippedRows.length > 0 && (
            <details style={{ marginTop: 10, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: '#64748b' }}>{parsed.report.skippedRows.length} skipped row(s)</summary>
              <ul style={{ paddingLeft: 20 }}>
                {parsed.report.skippedRows.map((s, i) => (
                  <li key={i}>{s.tab} row {s.row}: {s.name} — {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
          <button onClick={handleCommit} disabled={committing}
                  style={{ marginTop: 16, background: '#1B2A6B', color: '#fff', border: 'none', borderRadius: 10,
                           padding: '11px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: committing ? 0.6 : 1 }}>
            {committing ? 'Importing…' : `Import ${T.unique} patients to ${office}`}
          </button>
        </div>
      )}

      {result && (
        <div style={{ background: '#f0fdf4', color: '#166534', padding: '16px 20px', borderRadius: 12, fontSize: 14 }}>
          <b>Import complete.</b> {result.inserted} new patients, {result.updated} updated,{' '}
          {result.appointments} appointments and {result.calls} calls written.
          <div style={{ marginTop: 6 }}>Run it again anytime with a newer copy of the sheet.</div>
        </div>
      )}
    </div>
  )
}
