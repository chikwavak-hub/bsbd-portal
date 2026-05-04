import React, { useState, useEffect, useRef } from 'react'
import { IcoUpload, IcoRefresh, IcoCheck, IcoX, IcoPhone, IcoChevD, IcoChevU, IcoPrint, IcoDL, IcoAlert } from '../../components/icons'
import { LBL } from '../../components/ui'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'
import { todayStr, N, USD } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

// ── Outcome config ────────────────────────────────────────────────────────
const OUTCOMES = {
  '':            { label: '—',            color: '#94a3b8', bg: '#f1f5f9' },
  lvm:           { label: 'Left VM',      color: '#d97706', bg: '#fef3c7' },
  no_answer:     { label: 'No Answer',    color: '#64748b', bg: '#f1f5f9' },
  communicated:  { label: 'Communicated', color: '#0891b2', bg: '#e0f2fe' },
  scheduled:     { label: 'Scheduled ✓',  color: '#16a34a', bg: '#dcfce7' },
  inactive:      { label: 'Inactive',     color: '#dc2626', bg: '#fee2e2' },
}

const STATUS_META = {
  pending:    { label: 'Not Called',   color: '#94a3b8', bg: '#f1f5f9',  icon: '○' },
  called_1:   { label: '1 Call Done',  color: '#d97706', bg: '#fef3c7',  icon: '①' },
  called_2:   { label: '2 Calls Done', color: '#f59e0b', bg: '#fffbeb',  icon: '②' },
  called_3:   { label: '3 Calls Done', color: '#ea580c', bg: '#fff7ed',  icon: '③' },
  scheduled:  { label: 'Scheduled',   color: '#16a34a', bg: '#dcfce7',  icon: '✓' },
  inactive:   { label: 'Inactive',    color: '#dc2626', bg: '#fee2e2',  icon: '✗' },
  declined:   { label: 'Declined',    color: '#7c3aed', bg: '#f5f3ff',  icon: '—' },
}

const OUTCOME_NORM = {
  'sch':'scheduled','scheduled':'scheduled','lvm':'lvm',
  'left voicemail':'lvm','leftvoicemail':'lvm','lvm / sent text':'lvm',
  'com':'communicated','communicated':'communicated',
  'ina':'inactive','inactive':'inactive','inactive pt':'inactive',
  'no answer':'no_answer','no answer/no vm':'no_answer','no vm':'no_answer',
  'no answer/no':'no_answer',
  'not sent':'not_sent','not sent out':'not_sent','sent':'sent','sent out':'sent',
}

function normOutcome(raw) {
  if (!raw) return ''
  const s = String(raw).trim().toLowerCase().replace(/\s+/g,' ')
  return OUTCOME_NORM[s] || (s.includes('sch') ? 'scheduled' : s.includes('lvm') || s.includes('voicemail') ? 'lvm' : s.includes('inactive') ? 'inactive' : s.includes('no answer') || s.includes('no vm') ? 'no_answer' : s.includes('com') ? 'communicated' : s.includes('sent') ? 'sent' : '')
}

function normName(raw) {
  if (!raw) return ''
  let n = String(raw).replace(/\n/g,' ').replace(/\([^)]+\)/g,'').trim()
  n = n.replace(/[^A-Za-z\s\-']/g,'').trim()
  return n.split(/\s+/).map(w => w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' ')
}

function normPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g,'')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return String(raw).trim().slice(0,20)
}

function fmtExcelDate(raw) {
  if (!raw) return ''
  const s = String(raw).trim()
  if (s === 'nan' || s === 'NaT' || s === 'None') return ''
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10)
  return ''
}

function deriveStatus(c1, c2, c3) {
  const all = [c1, c2, c3]
  if (all.includes('scheduled'))  return 'scheduled'
  if (all.includes('inactive'))   return 'inactive'
  if (c3)                         return 'called_3'
  if (c2)                         return 'called_2'
  if (c1)                         return 'called_1'
  return 'pending'
}

// ── Parse recall Excel using SheetJS ──────────────────────────────────────
async function parseRecallExcel(file, office, month) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
  const buf  = await file.arrayBuffer()
  const wb   = XLSX.read(buf, { type: 'array', cellDates: true })

  // Auto-detect sheet for this month
  const [year, mon] = month.split('-')
  const monthNames  = ['january','february','march','april','may','june','july','august','september','october','november','december']
  const monName     = monthNames[parseInt(mon) - 1]
  const sheetName   = wb.SheetNames.find(n => n.toLowerCase().includes(monName) && n.toLowerCase().includes(year.slice(2))) ||
                      wb.SheetNames.find(n => n.toLowerCase().includes(monName)) ||
                      wb.SheetNames[wb.SheetNames.length - 1]

  const ws   = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false })

  // Find header row
  let headerIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const vals = (rows[i] || []).map(v => String(v||'').toLowerCase())
    if (vals.some(v => v.includes('name')) && vals.some(v => v.includes('phone'))) {
      headerIdx = i; break
    }
  }
  if (headerIdx === -1) throw new Error(`No header row found in "${sheetName}"`)

  const patients = []
  const asap     = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] || []
    const nameRaw = row[0]
    if (!nameRaw) continue
    const name = normName(String(nameRaw))
    if (!name || name.length < 3) continue
    if (/recall|copy|name|title/i.test(name)) continue

    const phone = normPhone(row[1])
    const c1d   = fmtExcelDate(row[2])
    const c1o   = normOutcome(row[3])
    const c2d   = fmtExcelDate(row[4])
    const c2o   = normOutcome(row[5])
    const c3d   = fmtExcelDate(row[6])
    const c3o   = normOutcome(row[7])
    const pc    = normOutcome(row[8])
    const notes = row[10] ? String(row[10]).trim().slice(0, 600) : ''

    const status = deriveStatus(c1o, c2o, c3o)
    const id     = `rp_${month.replace('-','')}_${name.toLowerCase().replace(/\s+/g,'_').slice(0,15)}_${i}`

    patients.push({
      id, office, month,
      patient_name:      name,
      patient_name_norm: name.toUpperCase(),
      phone,
      call1_date: c1d, call1_outcome: c1o,
      call2_date: c2d, call2_outcome: c2o,
      call3_date: c3d, call3_outcome: c3o,
      postcard: pc || 'not_sent',
      status, notes,
      added_by: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  return { patients, asap, sheetName }
}

// ── Outcome badge ─────────────────────────────────────────────────────────
const OutcomeBadge = ({ outcome }) => {
  const m = OUTCOMES[outcome] || OUTCOMES['']
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: m.bg, color: m.color, whiteSpace: 'nowrap' }}>{m.label}</span>
}

// ── Outcome selector ──────────────────────────────────────────────────────
const OutcomeSelect = ({ value, onChange }) => (
  <select value={value} onChange={e => onChange(e.target.value)}
    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0', background: 'white', color: '#1e293b', cursor: 'pointer' }}>
    <option value="">—</option>
    {Object.entries(OUTCOMES).filter(([k]) => k).map(([k, m]) => (
      <option key={k} value={k}>{m.label}</option>
    ))}
  </select>
)

// ════════════════════════════════════════════════════════════════════════════
// PATIENT CARD
// ════════════════════════════════════════════════════════════════════════════
function PatientCard({ p: initP, user, onSave }) {
  const [p,        setP]        = useState(initP)
  const [expanded, setExpanded] = useState(false)
  const [editing,  setEditing]  = useState(false)
  const [draft,    setDraft]    = useState(null)
  const [saving,   setSaving]   = useState(false)

  const sm = STATUS_META[p.status] || STATUS_META.pending

  const startEdit = () => {
    setDraft({ ...p })
    setEditing(true)
    setExpanded(true)
  }

  const save = async () => {
    setSaving(true)
    const updated = {
      ...draft,
      status:     deriveStatus(draft.call1_outcome, draft.call2_outcome, draft.call3_outcome),
      updated_at: new Date().toISOString(),
    }
    await onSave(updated)
    setP(updated)
    setEditing(false)
    setSaving(false)
  }

  // Determine next action
  const nextAction = p.status === 'pending'   ? '1st Call needed'
                   : p.status === 'called_1'  ? '2nd Call needed'
                   : p.status === 'called_2'  ? '3rd Call needed'
                   : p.status === 'called_3'  ? 'Send postcard'
                   : null

  const needsPostcard = p.status === 'called_3' && p.postcard !== 'sent'

  return (
    <div style={{ background: 'white', borderRadius: 10, border: `2px solid ${p.status==='scheduled'?'#bbf7d0':p.status==='inactive'?'#fecaca':needsPostcard?'#fde68a':'#e2e8f0'}`, marginBottom: 8, overflow: 'hidden' }}>

      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}
        onClick={() => { if (!editing) setExpanded(!expanded) }}>

        {/* Status circle */}
        <div style={{ width: 34, height: 34, borderRadius: '50%', flexShrink: 0, background: sm.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: sm.color }}>
          {sm.icon}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{p.patient_name}</span>
            <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: sm.bg, color: sm.color }}>{sm.label}</span>
            {needsPostcard && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: '#fef3c7', color: '#d97706' }}>📮 Postcard needed</span>}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#64748b', flexWrap: 'wrap' }}>
            {p.phone && <span>📞 {p.phone}</span>}
            {nextAction && <span style={{ color: '#0d9488', fontWeight: 600 }}>→ {nextAction}</span>}
            {p.call1_outcome && <span>Call 1: <OutcomeBadge outcome={p.call1_outcome}/></span>}
            {p.call2_outcome && <span>Call 2: <OutcomeBadge outcome={p.call2_outcome}/></span>}
            {p.call3_outcome && <span>Call 3: <OutcomeBadge outcome={p.call3_outcome}/></span>}
          </div>
          {p.notes && !expanded && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>{p.notes.slice(0, 80)}{p.notes.length > 80 ? '…' : ''}</div>}
        </div>

        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <button onClick={e => { e.stopPropagation(); startEdit() }}
            style={{ padding: '5px 12px', borderRadius: 7, background: '#0d9488', color: 'white', border: 'none', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
            Update
          </button>
          {expanded ? <IcoChevU size={14} style={{ color: '#94a3b8' }} /> : <IcoChevD size={14} style={{ color: '#94a3b8' }} />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && !editing && (
        <div style={{ borderTop: '1px solid #f1f5f9', padding: '12px 14px' }}>
          {/* Call history */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 12 }}>
            {[[1,'call1_date','call1_outcome'],[2,'call2_date','call2_outcome'],[3,'call3_date','call3_outcome']].map(([n,dk,ok]) => (
              <div key={n} style={{ padding: '8px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, marginBottom: 4 }}>CALL {n}</div>
                {p[dk] && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>📅 {p[dk]}</div>}
                {p[ok] ? <OutcomeBadge outcome={p[ok]} /> : <span style={{ fontSize: 11, color: '#cbd5e1' }}>Not yet</span>}
              </div>
            ))}
          </div>
          {/* Postcard */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, background: p.postcard==='sent'?'#f0fdf4':'#fffbeb', border: `1px solid ${p.postcard==='sent'?'#bbf7d0':'#fde68a'}`, marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>📮</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: p.postcard==='sent'?'#16a34a':'#d97706' }}>
              Postcard: {p.postcard==='sent' ? 'Sent ✓' : 'Not sent'}
            </span>
          </div>
          {/* Notes */}
          {p.notes && (
            <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.6, padding: '8px 12px', background: '#f8fafc', borderRadius: 8 }}>
              {p.notes}
            </div>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && draft && (
        <div style={{ borderTop: '1px solid #e2e8f0', padding: '14px', background: '#f8fafc' }}
          onClick={e => e.stopPropagation()}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
            {[[1,'call1_date','call1_outcome'],[2,'call2_date','call2_outcome'],[3,'call3_date','call3_outcome']].map(([n,dk,ok]) => (
              <div key={n} style={{ padding: '10px 12px', borderRadius: 8, background: 'white', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, marginBottom: 8 }}>CALL {n}</div>
                <label style={LBL}>Date</label>
                <input type="date" className="ic" style={{ marginBottom: 8, fontSize: 12 }} value={draft[dk]||''} onChange={e => setDraft(d => ({...d, [dk]: e.target.value}))}/>
                <label style={LBL}>Outcome</label>
                <OutcomeSelect value={draft[ok]||''} onChange={v => setDraft(d => ({...d, [ok]: v}))}/>
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={LBL}>Postcard</label>
              <select className="ic" value={draft.postcard||'not_sent'} onChange={e => setDraft(d => ({...d, postcard: e.target.value}))}>
                <option value="not_sent">Not sent</option>
                <option value="sent">Sent ✓</option>
                <option value="not_needed">Not needed</option>
              </select>
            </div>
            <div>
              <label style={LBL}>Overall Status</label>
              <select className="ic" value={draft.status||'pending'} onChange={e => setDraft(d => ({...d, status: e.target.value}))}>
                {Object.entries(STATUS_META).map(([k,m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={LBL}>Notes</label>
            <textarea className="ic" style={{ minHeight: 70, resize: 'vertical', fontSize: 12 }}
              value={draft.notes||''} onChange={e => setDraft(d => ({...d, notes: e.target.value}))}
              placeholder="Add notes about this patient's recall status…"/>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setEditing(false); setExpanded(false) }}
              style={{ padding: '8px 18px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button onClick={save} disabled={saving}
              style={{ padding: '8px 20px', borderRadius: 8, background: saving ? '#5eead4' : '#0d9488', color: 'white', border: 'none', fontWeight: 700, fontSize: 12, cursor: saving ? 'not-allowed' : 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ════════════════════════════════════════════════════════════════════════════
export default function RecallTrackerPage({ user, isManager }) {
  const curMonth = todayStr().slice(0, 7)
  const [month,    setMonth]    = useState(curMonth)
  const [office,   setOffice]   = useState(user.office || OFFICES[0])
  const [patients, setPatients] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [uploading,setUploading]= useState(false)
  const [tab,      setTab]      = useState('all') // all | pending | in_progress | scheduled | needs_postcard | inactive
  const [search,   setSearch]   = useState('')
  const [toast,    setToast]    = useState(null)
  const fileRef = useRef(null)

  const notify = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 4000) }

  const load = async () => {
    setLoading(true)
    try {
      const rows = await sbGet('recall_patients', `office=eq.${encodeURIComponent(office)}&month=eq.${month}&order=status,patient_name`)
      setPatients(rows)
    } catch(e) { notify('Load failed: ' + e.message, 'error') }
    setLoading(false)
  }

  useEffect(() => { load() }, [month, office])

  // ── Upload ────────────────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const { patients: parsed, sheetName } = await parseRecallExcel(file, office, month)
      if (!parsed.length) { notify('No patients found in this file', 'error'); setUploading(false); return }

      // Clear existing
      const ex = await sbGet('recall_patients', `office=eq.${encodeURIComponent(office)}&month=eq.${month}&select=id`)
      for (const r of ex) await sbDel('recall_patients', 'id=eq.' + r.id)

      // Insert
      for (const p of parsed) await sbPost('recall_patients', { ...p, added_by: user.name }, true)

      await load()
      notify(`Loaded ${parsed.length} patients from "${sheetName}"`)
    } catch(e) { notify('Upload failed: ' + e.message, 'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  const savePatient = async (updated) => {
    await sbPost('recall_patients', updated, true)
    setPatients(prev => prev.map(p => p.id === updated.id ? updated : p))
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const total      = patients.length
  const scheduled  = patients.filter(p => p.status === 'scheduled').length
  const inactive   = patients.filter(p => p.status === 'inactive').length
  const needsPC    = patients.filter(p => p.status === 'called_3' && p.postcard !== 'sent').length
  const pending    = patients.filter(p => p.status === 'pending').length
  const inProgress = patients.filter(p => ['called_1','called_2'].includes(p.status)).length
  const convRate   = total > 0 ? Math.round((scheduled / (total - inactive)) * 100) : 0

  const TAB_FILTERS = {
    all:           p => true,
    pending:       p => p.status === 'pending',
    in_progress:   p => ['called_1','called_2'].includes(p.status),
    needs_postcard:p => p.status === 'called_3' && p.postcard !== 'sent',
    scheduled:     p => p.status === 'scheduled',
    inactive:      p => p.status === 'inactive',
  }
  const TAB_LABELS = {
    all:           `All (${total})`,
    pending:       `Not Called (${pending})`,
    in_progress:   `In Progress (${inProgress})`,
    needs_postcard:`📮 Postcard (${needsPC})`,
    scheduled:     `Scheduled ✓ (${scheduled})`,
    inactive:      `Inactive (${inactive})`,
  }

  const filtered = patients.filter(p => {
    if (!TAB_FILTERS[tab](p)) return false
    if (search && !p.patient_name.toLowerCase().includes(search.toLowerCase()) &&
        !p.phone.includes(search)) return false
    return true
  })

  // ── Print ─────────────────────────────────────────────────────────────────
  const print = () => {
    const rows = filtered.map(p => `<tr>
      <td><b>${p.patient_name}</b></td>
      <td>${p.phone}</td>
      <td>${p.call1_date||'—'}<br><small>${OUTCOMES[p.call1_outcome]?.label||'—'}</small></td>
      <td>${p.call2_date||'—'}<br><small>${OUTCOMES[p.call2_outcome]?.label||'—'}</small></td>
      <td>${p.call3_date||'—'}<br><small>${OUTCOMES[p.call3_outcome]?.label||'—'}</small></td>
      <td style="text-align:center">${p.postcard==='sent'?'✓ Sent':'Not sent'}</td>
      <td style="color:${STATUS_META[p.status]?.color}">${STATUS_META[p.status]?.label||p.status}</td>
      <td style="font-size:10px">${p.notes?.slice(0,80)||''}</td>
    </tr>`).join('')
    const w = window.open('', '_blank', 'width=1100,height=800')
    w.document.write(`<!DOCTYPE html><html><head><title>Recall List — ${office} — ${month}</title>
    <style>body{font-family:Arial,sans-serif;padding:20px;font-size:11px}h1{font-size:16px}
    table{width:100%;border-collapse:collapse}th{background:#0d9488;color:white;padding:6px 8px;text-align:left;font-size:10px}
    td{padding:6px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top}
    @media print{button{display:none}}</style></head>
    <body><h1>Recall List — ${office} — ${month}</h1>
    <p style="font-size:12px;color:#666">${filtered.length} patients · ${scheduled} scheduled · ${convRate}% conversion</p>
    <button onclick="window.print()" style="margin-bottom:12px;padding:7px 16px;background:#0d9488;color:white;border:none;border-radius:6px;cursor:pointer">Print / Save PDF</button>
    <table><thead><tr><th>Patient</th><th>Phone</th><th>Call 1</th><th>Call 2</th><th>Call 3</th><th>Postcard</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody></table></body></html>`)
    w.document.close()
  }

  const downloadCSV = () => {
    const h = ['Patient','Phone','Call 1 Date','Call 1 Outcome','Call 2 Date','Call 2 Outcome','Call 3 Date','Call 3 Outcome','Postcard','Status','Notes']
    const r = filtered.map(p => [p.patient_name,p.phone,p.call1_date,OUTCOMES[p.call1_outcome]?.label||'',p.call2_date,OUTCOMES[p.call2_outcome]?.label||'',p.call3_date,OUTCOMES[p.call3_outcome]?.label||'',p.postcard,STATUS_META[p.status]?.label||p.status,p.notes])
    const csv = [h,...r].map(row => row.map(v => '"'+String(v||'').replace(/"/g,'""')+'"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = `Recall_${office}_${month}.csv`
    a.click()
  }

  const monthLabel = new Date(month + '-15').toLocaleString('en-US', { month: 'long', year: 'numeric' })

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 20px 60px' }}>
      {toast && <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, padding: '12px 20px', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,.15)', color: 'white', fontSize: 13, fontWeight: 600, background: toast.type === 'error' ? '#ef4444' : '#10b981', maxWidth: 360 }}>{toast.msg}</div>}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', margin: 0 }}>Recall Tracker</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 3 }}>{monthLabel} · {office}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            <IcoRefresh size={13} /> Refresh
          </button>
          <button onClick={downloadCSV} disabled={!patients.length} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 8, background: patients.length ? '#1d4ed8' : '#f1f5f9', color: patients.length ? 'white' : '#94a3b8', border: 'none', fontWeight: 700, fontSize: 12, cursor: patients.length ? 'pointer' : 'not-allowed' }}>
            <IcoDL size={13} /> CSV
          </button>
          <button onClick={print} disabled={!patients.length} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 14px', borderRadius: 8, background: patients.length ? '#475569' : '#f1f5f9', color: patients.length ? 'white' : '#94a3b8', border: 'none', fontWeight: 700, fontSize: 12, cursor: patients.length ? 'pointer' : 'not-allowed' }}>
            <IcoPrint size={13} /> Print
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 10, background: uploading ? '#5eead4' : '#0d9488', color: 'white', fontWeight: 700, fontSize: 13, cursor: uploading ? 'not-allowed' : 'pointer' }}>
            <IcoUpload size={14} /> {uploading ? 'Loading…' : 'Upload Recall Sheet'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
          </label>
        </div>
      </div>

      {/* Month + office selectors */}
      <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 16px', marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 140px' }}>
          <label style={LBL}>Month</label>
          <input type="month" className="ic" value={month} onChange={e => setMonth(e.target.value)} />
        </div>
        {isManager && (
          <div style={{ flex: '1 1 130px' }}>
            <label style={LBL}>Office</label>
            <select className="ic" value={office} onChange={e => setOffice(e.target.value)}>
              {OFFICES.map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        )}
        <div style={{ flex: '1 1 180px' }}>
          <label style={LBL}>Search</label>
          <input className="ic" value={search} onChange={e => setSearch(e.target.value)} placeholder="Patient name or phone…" />
        </div>
      </div>

      {/* Summary bar */}
      {patients.length > 0 && (
        <div style={{ background: 'linear-gradient(135deg,#0d9488,#0891b2)', borderRadius: 12, padding: '14px 20px', marginBottom: 16, color: 'white', display: 'flex', flexWrap: 'wrap', gap: 0 }}>
          {[
            ['TOTAL',    total,      null],
            ['PENDING',  pending,    pending > 0 ? '#fde68a' : null],
            ['IN PROGRESS', inProgress, null],
            ['NEEDS POSTCARD', needsPC, needsPC > 0 ? '#fde68a' : null],
            ['SCHEDULED', scheduled, '#86efac'],
            ['CONV RATE', convRate + '%', convRate >= 50 ? '#86efac' : '#f87171'],
            ['INACTIVE', inactive,   inactive > 0 ? '#fca5a5' : null],
          ].map(([l, v, c], i) => (
            <div key={i} style={{ flex: '1 1 80px', padding: '0 12px', borderLeft: i > 0 ? '1px solid rgba(255,255,255,.2)' : 'none' }}>
              <div style={{ fontSize: 9, opacity: .6, letterSpacing: 1, fontWeight: 700, marginBottom: 2 }}>{l}</div>
              <div style={{ fontSize: 17, fontWeight: 800, color: c || 'white' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && patients.length === 0 && (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 12, border: '2px dashed #e2e8f0' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', marginBottom: 6 }}>No recall list for {monthLabel}</div>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>Upload the recall Excel sheet to get started. The standardized format will be auto-detected.</p>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 24px', borderRadius: 10, background: '#0d9488', color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            <IcoUpload size={16} /> Upload Recall Sheet
            <input type="file" accept=".xlsx,.xls" onChange={handleUpload} style={{ display: 'none' }} />
          </label>
        </div>
      )}

      {loading && <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}><div className="spinner" style={{ margin: '0 auto 12px', borderTopColor: '#0d9488' }} />Loading recall list…</div>}

      {/* Tab bar */}
      {patients.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
            {Object.entries(TAB_LABELS).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, background: tab === k ? '#0d9488' : 'white', color: tab === k ? 'white' : '#64748b', border: tab === k ? 'none' : '1px solid #e2e8f0' }}>
                {l}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', background: 'white', borderRadius: 10, border: '1px solid #e2e8f0' }}>
              No patients in this category
            </div>
          ) : (
            filtered.map(p => <PatientCard key={p.id} p={p} user={user} onSave={savePatient} />)
          )}
        </>
      )}
    </div>
  )
}
