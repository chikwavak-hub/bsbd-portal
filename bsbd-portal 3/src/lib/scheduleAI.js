// src/lib/scheduleAI.js — AI fallback reader for Appointment Book grid PDFs.
// Called when the deterministic schedule parser finds zero patients.

const norm = s => String(s || '').toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim()

export async function parseScheduleWithAI(file) {
  const fileBase64 = await new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result).split(',')[1])
    r.onerror = () => rej(new Error('Could not read file'))
    r.readAsDataURL(file)
  })
  const res = await fetch('/.netlify/functions/ai-schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileBase64, mimeType: file.type, fileName: file.name }),
  })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || 'AI schedule read failed')

  const appointments = (data.appointments || []).map(a => ({
    patient_name: (a.patient_name || '').replace(/\s*\(\d+\)\s*$/, '').trim(),
    patient_name_norm: norm((a.patient_name || '').replace(/\s*\(\d+\)\s*$/, '')),
    appt_time: a.appt_time || '',
    operatory: a.operatory || '',
    provider: a.provider || '',
    ins_status: a.ins_status === 'ACTIVE' ? 'ACTIVE INS' : a.ins_status === 'PRIVATE' ? 'PRIVATE PAY' : a.ins_status === 'INACTIVE' ? 'INACTIVE INS' : '',
    ins_carrier: '',
    is_new_patient: !!a.is_new_patient,
    is_unconfirmed: !!a.is_unconfirmed,
    treatments: [],
    total_expected: 0,
    amount_collected: 0,
    status: 'pending',
    flags_total: 0,
    flags_done: 0,
    claim_notes: a.notes ? [a.notes] : [],
  })).filter(a => a.patient_name)

  // office name normalization: 'Beautiful Smiles By Design- Dalton' -> 'Dalton'
  let office = data.office || null
  if (office) {
    const m = office.match(/(Brainerd|Calhoun|Dalton|McCallie)/i)
    office = m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase().replace('mccallie', 'cCallie') : office
    if (/^mccallie$/i.test(office)) office = 'McCallie'
  }
  return { appointments, date: data.date || null, office, source: 'ai_grid_reader' }
}
