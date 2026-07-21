// src/lib/scheduleAscend.js — Dentrix Ascend "Schedule Data Report" parser.
// Power Reporting export (.xlsx/.csv) with columns:
//   Patient | Date | Appt Time | Provider | Scheduled? | Operatory | Proc. Code | Pat. Prim. Carrier | Patient Count
// Grouped rows: the patient row carries name/time/provider/op + first code;
// continuation rows carry additional codes; a new "Appt Time" on a blank-name
// row is a SECOND appointment for the same patient; "Scheduled Total" and
// "Grand Total" rows are subtotals to skip.
//
// Output pre-populates the collection sheet's procedure lines with the
// planned CDT codes and the carrier — verification checks fire immediately.

import * as XLSX from 'xlsx'

const norm = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()
const cleanTime = s => String(s || '').replace(/[^0-9:APM\s]/gi, '').trim()          // strips the '?' wrap artifacts
const flipName = s => {
  const m = String(s || '').trim().match(/^([^,]+),\s*(.+)$/)
  if (!m) return String(s || '').trim()
  const cap = w => w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w
  const first = m[2].trim().split(/\s+/).map(cap).join(' ')
  const last = m[1].trim().split(/\s+/).map(cap).join(' ')
  return `${first} ${last}`
}

export async function parseAscendSchedule(file) {
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames.find(n => /report$/i.test(n)) || wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

  // locate the header row
  let hi = -1, col = {}
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i].map(c => String(c).toLowerCase().trim())
    if (r.includes('patient') && r.some(c => c.includes('proc'))) {
      hi = i
      r.forEach((h, idx) => {
        if (h === 'patient') col.name = idx
        else if (h === 'date') col.date = idx
        else if (h.includes('appt time') || h === 'time') col.time = idx
        else if (h === 'provider') col.provider = idx
        else if (h.includes('scheduled')) col.sched = idx
        else if (h === 'operatory') col.op = idx
        else if (h.includes('proc')) col.code = idx
        else if (h.includes('carrier')) col.carrier = idx
        else if (h.includes('chart')) col.chart = idx
      })
      break
    }
  }
  if (hi === -1 || col.name == null || col.code == null)
    throw new Error('Not an Ascend Schedule Data Report (header row not found)')

  // office from the metadata "Location includes ..." filter line
  let office = null
  for (let i = 0; i < hi; i++) {
    const line = rows[i].map(c => String(c)).join(' ')
    const m = line.match(/Location includes.*?(Brainerd|Calhoun|Dalton|McCallie)/i)
    if (m) { office = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase(); if (/^mccallie$/i.test(office)) office = 'McCallie'; break }
  }

  const appts = []
  let curName = null, curAppt = null
  const isoDate = s => {
    const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/)
    return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null
  }
  let reportDate = null

  const newAppt = (name, r) => {
    const op = String(r[col.op] || '').trim()
    const a = {
      chart_number: col.chart != null ? String(r[col.chart] || '').trim() || null : null,
      patient_name: flipName(name),
      patient_name_norm: norm(flipName(name)),
      appt_time: cleanTime(r[col.time]),
      operatory: op,
      provider: String(r[col.provider] || '').trim(),
      ins_carrier: String(r[col.carrier] || '').trim(),
      ins_status: String(r[col.carrier] || '').trim() ? 'ACTIVE INS' : '',
      is_new_patient: false,
      is_unconfirmed: /unconf/i.test(op),
      treatments: [],
      total_expected: 0, amount_collected: 0, status: 'pending',
      flags_total: 0, flags_done: 0, claim_notes: [],
    }
    appts.push(a)
    return a
  }
  const addCode = (a, r) => {
    const code = String(r[col.code] || '').trim().toUpperCase()
    if (!code) return
    a.treatments.push({ code, desc: '', tooth: '', fee: 0, pt_pct: '', pt_amount: 0 })
    const carrier = String(r[col.carrier] || '').trim()
    if (carrier && !a.ins_carrier) { a.ins_carrier = carrier; a.ins_status = 'ACTIVE INS' }
  }

  for (let i = hi + 1; i < rows.length; i++) {
    const r = rows[i]
    const nameCell = String(r[col.name] || '').trim()
    const schedCell = String(r[col.sched] || '').trim()
    if (/grand total/i.test(nameCell)) break
    if (/total/i.test(schedCell)) continue                      // "Scheduled Total" subtotal
    if (!reportDate) reportDate = isoDate(r[col.date])

    if (nameCell) {                                             // new patient block
      curName = nameCell
      curAppt = newAppt(curName, r)
      addCode(curAppt, r)
    } else if (cleanTime(r[col.time]) && curName) {             // second appointment, same patient
      curAppt = newAppt(curName, r)
      addCode(curAppt, r)
    } else if (curAppt) {                                       // continuation code row
      addCode(curAppt, r)
    }
  }

  return { appointments: appts, date: reportDate, office, source: 'ascend_sdr' }
}

/** cheap detection so the portal knows to try this parser */
export async function looksLikeAscendSDR(file) {
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return false
  try {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf.slice(0, 200000), { type: 'array', sheetRows: 40 })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const txt = JSON.stringify(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })).toLowerCase()
    return txt.includes('schedule data report') || (txt.includes('"patient"') && txt.includes('proc. code'))
  } catch { return false }
}
