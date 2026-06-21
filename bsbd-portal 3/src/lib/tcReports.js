// ════════════════════════════════════════════════════════════════════════════
// BSBD TC Tracker — Reports Export (Excel + PDF)
// Generates downloadable analytics from treatment coordinator patient data
// ════════════════════════════════════════════════════════════════════════════
import { N } from './helpers'

const isBig = p => N(p.total_tx_cost) >= 3000
const callCount = p => [p.call_1_date, p.call_2_date, p.call_3_date].filter(Boolean).length
const hasAppt = p => p.has_appt === 'Yes' || !!p.appt_1
const isComplete = p => N(p.tx_completed) >= N(p.total_tx_cost) * 0.9 && N(p.tx_completed) > 0

// ── Compute per-TC rollup ──────────────────────────────────────────────────
function tcRollup(patients) {
  const map = {}
  patients.forEach(p => {
    const tc = p.who_tx_plan || p.assigned_tc_name || 'Unassigned'
    if (!map[tc]) map[tc] = {
      name: tc, patients: 0, txValue: 0, scheduled: 0, produced: 0,
      withAppt: 0, noAppt: 0, bigCases: 0, complete: 0,
      financeStall: 0, zeroCalls: 0, totalCalls: 0,
    }
    const m = map[tc]
    m.patients++
    m.txValue   += N(p.total_tx_cost)
    m.scheduled += N(p.sched_tx_amount)
    m.produced  += N(p.tx_completed)
    if (hasAppt(p)) m.withAppt++; else m.noAppt++
    if (isBig(p)) m.bigCases++
    if (isComplete(p)) m.complete++
    if (p.finance_stalled) m.financeStall++
    const cc = callCount(p)
    m.totalCalls += cc
    if (cc === 0 && !hasAppt(p)) m.zeroCalls++
  })
  return Object.values(map).map(m => ({
    ...m,
    conversionRate: m.patients > 0 ? Math.round(m.withAppt / m.patients * 100) : 0,
    avgTxValue:     m.patients > 0 ? Math.round(m.txValue / m.patients) : 0,
    producedRate:   m.txValue > 0  ? Math.round(m.produced / m.txValue * 100) : 0,
  })).sort((a, b) => b.patients - a.patients)
}

// ── Overall summary ─────────────────────────────────────────────────────────
function overallSummary(patients) {
  const withAppt = patients.filter(hasAppt).length
  return {
    total:        patients.length,
    txValue:      patients.reduce((s, p) => s + N(p.total_tx_cost), 0),
    scheduled:    patients.reduce((s, p) => s + N(p.sched_tx_amount), 0),
    produced:     patients.reduce((s, p) => s + N(p.tx_completed), 0),
    withAppt,
    noAppt:       patients.length - withAppt,
    bigCases:     patients.filter(isBig).length,
    complete:     patients.filter(isComplete).length,
    financeStall: patients.filter(p => p.finance_stalled).length,
    conversionRate: patients.length > 0 ? Math.round(withAppt / patients.length * 100) : 0,
  }
}

const USD = n => '$' + Math.round(N(n)).toLocaleString()
const monthLabel = m => {
  if (!m || m === 'all') return 'All Months'
  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const [y, mo] = m.split('-')
  return `${MO[parseInt(mo) - 1]} ${y}`
}

// ════════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ════════════════════════════════════════════════════════════════════════════
export async function exportTcExcel(patients, { office, month }) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
  const wb = XLSX.utils.book_new()
  const scopeLabel = `${office === 'all' ? 'All Offices' : office} · ${monthLabel(month)}`

  // ── Sheet 1: Summary ──
  const sum = overallSummary(patients)
  const summaryRows = [
    ['BSBD TREATMENT COORDINATOR REPORT'],
    [scopeLabel],
    [`Generated ${new Date().toLocaleString()}`],
    [],
    ['OVERALL METRICS', ''],
    ['Total Patients',          sum.total],
    ['Total TX Value',          USD(sum.txValue)],
    ['Scheduled TX $',          USD(sum.scheduled)],
    ['Produced $',              USD(sum.produced)],
    ['Production Rate',         (sum.txValue > 0 ? Math.round(sum.produced / sum.txValue * 100) : 0) + '%'],
    [],
    ['SCHEDULING', ''],
    ['With Appointment',        sum.withAppt],
    ['No Appointment',          sum.noAppt],
    ['Conversion Rate',         sum.conversionRate + '%'],
    ['Complete',                sum.complete],
    [],
    ['RISK FLAGS', ''],
    ['Big Cases ($3k+)',        sum.bigCases],
    ['Finance Stalled',         sum.financeStall],
  ]
  const ws1 = XLSX.utils.aoa_to_sheet(summaryRows)
  ws1['!cols'] = [{ wch: 28 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, ws1, 'Summary')

  // ── Sheet 2: By TC ──
  const rollup = tcRollup(patients)
  const tcHeader = ['Treatment Coordinator', 'Patients', 'TX Value', 'Avg TX', 'Scheduled $',
    'Produced $', 'Prod Rate', 'With Appt', 'No Appt', 'Conversion', 'Big Cases',
    'Complete', 'Finance Stall', 'Total Calls']
  const tcRows = rollup.map(t => [
    t.name, t.patients, Math.round(t.txValue), t.avgTxValue, Math.round(t.scheduled),
    Math.round(t.produced), t.producedRate + '%', t.withAppt, t.noAppt,
    t.conversionRate + '%', t.bigCases, t.complete, t.financeStall, t.totalCalls,
  ])
  const ws2 = XLSX.utils.aoa_to_sheet([
    ['BY TREATMENT COORDINATOR — ' + scopeLabel], [], tcHeader, ...tcRows,
  ])
  ws2['!cols'] = [{ wch: 22 }, ...Array(13).fill({ wch: 12 })]
  XLSX.utils.book_append_sheet(wb, ws2, 'By TC')

  // ── Sheet 3: Full patient list ──
  const patHeader = ['Patient', 'Office', 'Doctor', 'TC', 'DOS', 'Exam', 'Phone',
    'Has Appt', '1st Appt', 'Hyg Appt', 'Email Sent', 'Calls Made',
    'Total TX', 'Sched TX', 'Ins Exp', 'TX Done', 'Status', 'Finance Barrier', 'Notes']
  const patRows = patients.map(p => [
    p.patient_name || '', p.office || '', p.doctor || '', p.who_tx_plan || p.assigned_tc_name || '',
    p.dos || '', p.exam_type || '', p.patient_phone || '',
    hasAppt(p) ? 'Yes' : 'No', p.appt_1 || '', p.appt_hyg || '', p.email_sent || '',
    callCount(p), Math.round(N(p.total_tx_cost)), Math.round(N(p.sched_tx_amount)),
    Math.round(N(p.ins_expected)), Math.round(N(p.tx_completed)),
    isComplete(p) ? 'Complete' : hasAppt(p) ? 'Scheduled' : isBig(p) ? 'Big Case' : 'Follow-up',
    p.finance_barrier || '', (p.notes || '').slice(0, 100),
  ])
  const ws3 = XLSX.utils.aoa_to_sheet([patHeader, ...patRows])
  ws3['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 14 }, { wch: 12 }, { wch: 11 },
    { wch: 10 }, { wch: 13 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 10 },
    { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 10 }, { wch: 11 },
    { wch: 18 }, { wch: 40 }]
  ws3['!autofilter'] = { ref: `A1:S${patRows.length + 1}` }
  XLSX.utils.book_append_sheet(wb, ws3, 'Patient List')

  // ── Sheet 4: No-Appointment Action List ──
  const noAppt = patients.filter(p => !hasAppt(p) && !isComplete(p))
    .sort((a, b) => N(b.total_tx_cost) - N(a.total_tx_cost))
  if (noAppt.length) {
    const naHeader = ['Patient', 'Office', 'TC', 'DOS', 'Phone', 'Total TX', 'Calls Made', 'Last Call', 'Finance Barrier']
    const naRows = noAppt.map(p => [
      p.patient_name || '', p.office || '', p.who_tx_plan || p.assigned_tc_name || '',
      p.dos || '', p.patient_phone || '', Math.round(N(p.total_tx_cost)), callCount(p),
      [p.call_3_date, p.call_2_date, p.call_1_date].find(Boolean) || 'never', p.finance_barrier || '',
    ])
    const ws4 = XLSX.utils.aoa_to_sheet([
      ['ACTION LIST — UNSCHEDULED PATIENTS (highest value first)'], [], naHeader, ...naRows,
    ])
    ws4['!cols'] = [{ wch: 20 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 14 },
      { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 18 }]
    XLSX.utils.book_append_sheet(wb, ws4, 'Action List')
  }

  const fname = `BSBD_TC_Report_${office === 'all' ? 'AllOffices' : office}_${month === 'all' ? 'AllMonths' : month}.xlsx`
  XLSX.writeFile(wb, fname)
}

// ════════════════════════════════════════════════════════════════════════════
// PDF EXPORT (print-to-PDF via styled window)
// ════════════════════════════════════════════════════════════════════════════
export function exportTcPdf(patients, { office, month }) {
  const sum = overallSummary(patients)
  const rollup = tcRollup(patients)
  const noAppt = patients.filter(p => !hasAppt(p) && !isComplete(p))
    .sort((a, b) => N(b.total_tx_cost) - N(a.total_tx_cost))
  const scopeLabel = `${office === 'all' ? 'All Offices' : office} · ${monthLabel(month)}`

  const tile = (label, value, color = '#1e3a5f') =>
    `<div style="flex:1;min-width:120px;background:#f8fafc;border-radius:8px;padding:12px 14px;border:1px solid #e2e8f0;border-left:4px solid ${color}">
      <div style="font-size:9px;font-weight:800;color:#94a3b8;letter-spacing:.5px;margin-bottom:4px">${label}</div>
      <div style="font-size:20px;font-weight:800;color:${color}">${value}</div>
    </div>`

  const tcTableRows = rollup.map(t => `
    <tr>
      <td style="font-weight:700">${t.name}</td>
      <td style="text-align:center">${t.patients}</td>
      <td style="text-align:right">${USD(t.txValue)}</td>
      <td style="text-align:right">${USD(t.avgTxValue)}</td>
      <td style="text-align:center">${t.withAppt}/${t.patients}</td>
      <td style="text-align:center;color:${t.conversionRate >= 70 ? '#16a34a' : t.conversionRate >= 50 ? '#d97706' : '#dc2626'};font-weight:700">${t.conversionRate}%</td>
      <td style="text-align:center">${t.bigCases}</td>
      <td style="text-align:center;color:${t.financeStall > 0 ? '#dc2626' : '#94a3b8'}">${t.financeStall}</td>
    </tr>`).join('')

  const actionRows = noAppt.slice(0, 30).map(p => `
    <tr>
      <td style="font-weight:600">${p.patient_name || ''}</td>
      <td>${p.office || ''}</td>
      <td>${p.who_tx_plan || p.assigned_tc_name || ''}</td>
      <td style="text-align:right;font-weight:700;color:#1d4ed8">${USD(p.total_tx_cost)}</td>
      <td style="text-align:center">${callCount(p)}</td>
      <td>${p.patient_phone || ''}</td>
      <td style="color:#7c3aed">${p.finance_barrier || ''}</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>BSBD TC Report</title>
  <style>
    @page { margin: 0.6in; }
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1e293b; margin: 0; padding: 20px; }
    h1 { font-size: 22px; color: #1e3a5f; margin: 0 0 2px; }
    .sub { font-size: 12px; color: #94a3b8; margin-bottom: 18px; }
    h2 { font-size: 13px; color: #1e3a5f; letter-spacing: .5px; margin: 24px 0 10px; padding-bottom: 5px; border-bottom: 2px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th { background: #f1f5f9; padding: 7px 8px; text-align: left; font-size: 9px; font-weight: 800; color: #64748b; letter-spacing: .3px; }
    td { padding: 6px 8px; border-bottom: 1px solid #f1f5f9; }
    tr:nth-child(even) td { background: #fafafa; }
    .tiles { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
    .foot { margin-top: 30px; font-size: 10px; color: #cbd5e1; text-align: center; }
    @media print { button { display: none; } }
  </style></head><body>
    <button onclick="window.print()" style="position:fixed;top:12px;right:12px;padding:8px 18px;background:#1e3a5f;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer">Print / Save PDF</button>
    <h1>Treatment Coordinator Report</h1>
    <div class="sub">${scopeLabel} &middot; Generated ${new Date().toLocaleDateString()}</div>

    <h2>OVERVIEW</h2>
    <div class="tiles">
      ${tile('PATIENTS', sum.total)}
      ${tile('TX VALUE', USD(sum.txValue), '#1d4ed8')}
      ${tile('CONVERSION', sum.conversionRate + '%', sum.conversionRate >= 70 ? '#16a34a' : '#d97706')}
      ${tile('PRODUCED', USD(sum.produced), '#16a34a')}
    </div>
    <div class="tiles">
      ${tile('WITH APPT', sum.withAppt, '#0d9488')}
      ${tile('NO APPT', sum.noAppt, sum.noAppt > 0 ? '#dc2626' : '#94a3b8')}
      ${tile('BIG CASES', sum.bigCases, '#7c3aed')}
      ${tile('FINANCE STALL', sum.financeStall, sum.financeStall > 0 ? '#dc2626' : '#94a3b8')}
    </div>

    <h2>BY TREATMENT COORDINATOR</h2>
    <table>
      <thead><tr>
        <th>Coordinator</th><th style="text-align:center">Patients</th><th style="text-align:right">TX Value</th>
        <th style="text-align:right">Avg TX</th><th style="text-align:center">Booked</th>
        <th style="text-align:center">Conv.</th><th style="text-align:center">Big</th><th style="text-align:center">Stall</th>
      </tr></thead>
      <tbody>${tcTableRows}</tbody>
    </table>

    ${noAppt.length ? `
    <h2>ACTION LIST — UNSCHEDULED (highest value first)</h2>
    <table>
      <thead><tr>
        <th>Patient</th><th>Office</th><th>TC</th><th style="text-align:right">TX Value</th>
        <th style="text-align:center">Calls</th><th>Phone</th><th>Finance Barrier</th>
      </tr></thead>
      <tbody>${actionRows}</tbody>
    </table>
    ${noAppt.length > 30 ? `<div style="font-size:10px;color:#94a3b8;margin-top:6px">Showing top 30 of ${noAppt.length} unscheduled patients by value.</div>` : ''}
    ` : ''}

    <div class="foot">Beautiful Smiles by Design &middot; TC Tracker &middot; Confidential</div>
    <script>setTimeout(()=>window.print(), 400)</script>
  </body></html>`

  const w = window.open('', '_blank')
  if (!w) { alert('Please allow popups to generate the PDF report.'); return }
  w.document.write(html)
  w.document.close()
}
