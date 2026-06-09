// ════════════════════════════════════════════════════════════════════════════
// TC Monthly Patient List Importer
// Reads the Dalton NP Treatment Log Excel format (all tabs)
// ════════════════════════════════════════════════════════════════════════════

// ── Parse a date value from Excel cell ────────────────────────────────────
function parseDate(v) {
  if (!v) return ''
  const s = String(v)
  // Already ISO-ish: "2026-05-01 00:00:00"
  if (s.match(/^\d{4}-\d{2}-\d{2}/)) return s.slice(0,10)
  // Excel serial number
  if (!isNaN(Number(s)) && Number(s) > 40000) {
    const d = new Date((Number(s) - 25569) * 86400000)
    return d.toISOString().slice(0,10)
  }
  // Try natural parse
  try { const d = new Date(v); if (!isNaN(d)) return d.toISOString().slice(0,10) } catch {}
  return String(v).trim()
}

// ── Parse call cell: "~ Jun 8, 2026 ~ Called to sch..." ──────────────────
function parseCall(v) {
  if (!v) return { date:'', notes:'' }
  const s = String(v).trim()
  const m = s.match(/~\s*([^~]+?)\s*~\s*(.*)/)
  if (m) {
    try {
      const d = new Date(m[1].trim())
      return {
        date:  isNaN(d) ? m[1].trim() : d.toISOString().slice(0,10),
        notes: m[2].trim()
      }
    } catch {}
  }
  // Plain date or plain text
  return { date: parseDate(v) || '', notes: isNaN(Date.parse(v)) ? s : '' }
}

// ── Parse one spreadsheet row into a patient record ───────────────────────
function parseRow(row, officeDefault, monthTab) {
  const [doctor, who_tx_plan, dos_raw, patient_name, phone,
         exam_type, notes, who_sched,
         appt_1_raw, appt_2_raw, appt_hyg_raw,
         has_appt, email_sent,
         call1_raw, call2_raw, call3_raw,
         remarks,
         total_tx_cost, sched_tx_amount, ins_expected, tx_completed
        ] = row

  if (!patient_name || String(patient_name).trim() === '' || String(patient_name).trim() === 'Patient Name') return null

  const call1 = parseCall(call1_raw)
  const call2 = parseCall(call2_raw)
  const call3 = parseCall(call3_raw)
  const dos   = parseDate(dos_raw)

  const N = v => { const n = parseFloat(String(v||'').replace(/[^0-9.]/g,'')); return isNaN(n)?0:n }

  return {
    id:              'tp_import_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
    office:          officeDefault,
    doctor:          (doctor||'').trim(),
    who_tx_plan:     (who_tx_plan||'').trim(),
    dos:             dos,
    month_tab:       monthTab || (dos ? dos.slice(0,7) : ''),
    patient_name:    String(patient_name).trim(),
    patient_phone:   (phone||'').toString().replace(/\.0$/,'').trim(),
    patient_email:   '',
    exam_type:       (exam_type||'').trim(),
    notes:           (notes||'').trim(),
    who_sched:       (who_sched||'').trim(),
    appt_1:          parseDate(appt_1_raw),
    appt_2:          parseDate(appt_2_raw),
    appt_hyg:        parseDate(appt_hyg_raw),
    has_appt:        (has_appt||'').trim(),
    email_sent:      (email_sent||'').trim(),
    call_1_date:     call1.date,  call_1_notes: call1.notes,
    call_2_date:     call2.date,  call_2_notes: call2.notes,
    call_3_date:     call3.date,  call_3_notes: call3.notes,
    remarks:         (remarks||'').trim(),
    total_tx_cost:   N(total_tx_cost),
    sched_tx_amount: N(sched_tx_amount),
    ins_expected:    N(ins_expected),
    tx_completed:    N(tx_completed),
    finance_stalled: false,
    finance_barrier: '',
    status:          'consult',
    tx_plan:         null,
    visits:          [],
    created_at:      new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  }
}

// ── Month tab label → YYYY-MM ─────────────────────────────────────────────
const MONTH_MAP = {
  'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,
  'jul':7,'aug':8,'sep':9,'oct':10,'nov':11,'dec':12
}
function sheetNameToMonth(name) {
  const m = name.toLowerCase().match(/([a-z]+)\s*(\d{2,4})/)
  if (!m) return null
  const mo = MONTH_MAP[m[1].slice(0,3)]
  if (!mo) return null
  const yr = m[2].length === 2 ? '20'+m[2] : m[2]
  return yr+'-'+String(mo).padStart(2,'0')
}

// ── Main import function ───────────────────────────────────────────────────
export async function importTcExcel(file, office) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')

  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { type:'array', cellDates:false })

  const results = []   // { month, patients:[], sheetName }
  const errors  = []

  for (const sheetName of wb.SheetNames) {
    // Skip Master tab — it aggregates everything, individual months are the source
    if (sheetName.toLowerCase() === 'master') continue

    const monthTab = sheetNameToMonth(sheetName)
    if (!monthTab) continue

    const ws   = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' })

    const patients = []
    for (let i = 1; i < rows.length; i++) {  // skip header row
      const row = rows[i]
      if (!row || row.every(c => !c)) continue  // skip blank rows
      try {
        const p = parseRow(row, office, monthTab)
        if (p) patients.push(p)
      } catch(e) {
        errors.push(`Row ${i+1} in ${sheetName}: ${e.message}`)
      }
    }

    if (patients.length > 0) {
      results.push({ month: monthTab, sheetName, patients })
    }
  }

  return { results, errors, total: results.reduce((s,r)=>s+r.patients.length, 0) }
}
