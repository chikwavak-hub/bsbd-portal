import React, { useState, useEffect, useRef } from 'react'
import { IcoUpload, IcoRefresh, IcoChevD, IcoChevU, IcoPrint, IcoDL } from '../../components/icons'
import { LBL } from '../../components/ui'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'
import { todayStr, USD, N } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

// ── CDT Code Reference ────────────────────────────────────────────────────
const CDT = {
  D0120:'Periodic Oral Evaluation',D0140:'Limited Oral Evaluation',
  D0150:'Comprehensive Oral Evaluation',D0180:'Comprehensive Periodontal Evaluation',
  D0210:'Complete Series Radiographs',D0220:'Periapical Image',D0230:'Additional Periapical',
  D0270:'Bitewing - Single',D0272:'Bitewings - Two',D0274:'Bitewings - Four',
  D0330:'Panoramic Image',D0364:'Cone Beam CT - Limited Field',
  D0991:'Chlorhexidine Gluconate Oral Rinse',
  D1110:'Prophylaxis - Adult',D1120:'Prophylaxis - Child',
  D1206:'Fluoride Varnish Application',D1330:'Oral Hygiene Instructions',
  D1351:'Sealant - Per Tooth',
  D2140:'Amalgam - 1 Surface',D2150:'Amalgam - 2 Surfaces',D2160:'Amalgam - 3 Surfaces',
  D2330:'Composite - 1 Surface Anterior',D2331:'Composite - 2 Surfaces Anterior',
  D2332:'Composite - 3 Surfaces Anterior',D2335:'Composite - 4+ Surfaces Anterior',
  D2391:'Composite - 1 Surface Posterior',D2392:'Composite - 2 Surfaces Posterior',
  D2393:'Composite - 3 Surfaces Posterior',D2394:'Composite - 4+ Surfaces Posterior',
  D2740:'Crown - Porcelain/Ceramic',D2750:'Crown - PFM High Noble',
  D2751:'Crown - PFM Base Metal',D2752:'Crown - PFM Noble',
  D2950:'Core Buildup',D2954:'Prefabricated Post & Core',
  D2991:'Hydroxyapatite Regeneration Medicament',
  D3310:'Root Canal - Anterior',D3320:'Root Canal - Premolar',
  D3330:'Root Canal - Molar',D3331:'Root Canal Obstruction Treatment',
  D4341:'Scaling & Root Planing - 4+ Teeth',D4342:'Scaling & Root Planing - 1-3 Teeth',
  D4346:'Scaling - Generalized Gingival Inflammation',
  D4355:'Full Mouth Debridement',D4910:'Periodontal Maintenance',
  D4921:'Gingival Irrigation - Per Quadrant',
  D5110:'Complete Denture - Upper',D5120:'Complete Denture - Lower',
  D7140:'Extraction - Simple',D7210:'Extraction - Surgical',
  D7220:'Extraction - Soft Tissue Impaction',D7230:'Extraction - Partial Bony Impaction',
  D7240:'Extraction - Complete Bony Impaction',
  D9110:'Palliative Pain Treatment',D9230:'Nitrous Oxide',
  D9310:'Consultation',D9430:'Office Visit - Observation',
  D9440:'Office Visit - After Hours',D9630:'Drugs/Medicaments',
  D9941:'Athletic Mouthguard',D9944:'Occlusal Guard - Hard',D9945:'Occlusal Guard - Soft',
  D9972:'External Bleaching',D9973:'Internal Bleaching',
}

function parseTxCell(raw) {
  if (!raw) return null
  const s = String(raw).trim()
  const parts = s.includes('\t') ? s.split('\t') : s.split(/  +/)
  const code = parts[0].trim()
  const desc = parts[parts.length - 1].trim()
  let tooth = '', surface = ''
  for (let i = 1; i < parts.length - 1; i++) {
    const p = parts[i].trim()
    if (p.startsWith('TH:')) tooth = p.slice(3).trim()
    else if (p && p !== desc) surface = p
  }
  const cdtDesc = CDT[code] || ''
  return { code, desc: cdtDesc || desc, tooth, surface, cdtValid: Boolean(cdtDesc), isCustom: !code.startsWith('D') }
}

function parseBalance(raw) {
  if (!raw && raw !== 0) return 0
  const s = String(raw).replace(/[^0-9.\-]/g, '')
  return parseFloat(s) || 0
}

function parseCollectNote(raw) {
  if (!raw) return null
  const m = String(raw).match(/\$?([\d,]+\.?\d*)/)
  return m ? parseFloat(m[1].replace(/,/g,'')) : null
}

export function parseCollectionSheetFull(rows) {
  if (!rows || rows.length < 2) return []

  // Detect layout: older sheets used a 'PG' marker in col B; newer Dalton-style
  // sheets identify patient rows by a name in col C (2) + 'BALANCE' marker in col E (4).
  const hasPG = rows.slice(0, 12).some(r => String(r[1] || '').trim() === 'PG')

  if (hasPG) return parseLegacyPG(rows)
  return parseBalanceLayout(rows)
}

// ── Current Dalton / Ridgeview layout ──────────────────────────────────────
// Row 0: headers. Patient header row: col0=operatory('op 1'), col1=verified-by,
//   col2=patient name, col3=balance, col4='BALANCE', col11=total-to-collect, col16=claim note
// Procedure rows (below each patient): col4=code/tooth/desc, col5=coverage, col6=fee,
//   col7=ins allowed, col8=%, col9=upcoming, col10=deductible, col11=amount to collect,
//   col12=total collections (last proc row only), col14=ins status, col15=carrier, col16=claim note
function parseBalanceLayout(rows) {
  const patients = []
  let curOp = ''
  let current = null

  const isBalanceMarker = v => String(v || '').trim().toUpperCase().startsWith('BALANCE')

  for (const row of rows) {
    const opCell = String(row[0] || '').trim()
    if (opCell && /op\s*\d|^op\b|operatory/i.test(opCell)) curOp = opCell

    const name      = row[2]
    const balCell   = row[3]
    const isPtHeader = name && String(name).trim() !== '' && isBalanceMarker(row[4])

    if (isPtHeader) {
      if (current) patients.push(current)
      const dispName = String(name).trim()
      const claimNote = row[16] ? String(row[16]).trim() : ''
      current = {
        id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        patient_name: dispName,
        patient_name_norm: dispName.replace(/\([^)]+\)/g, '').replace(/[^A-Za-z\s]/g, '').trim().toUpperCase().split(/\s+/).join(' '),
        operatory: curOp,
        balance_bf: parseBalance(balCell),
        ins_status: '', ins_carrier: '',
        total_expected: 0, collect_override: null,
        treatments: [], claim_notes: claimNote ? [claimNote] : [],
        status: 'pending', amount_collected: 0, note: '', collected_by: '', collected_at: null,
      }
      // 'esent'/'ESENT' annotation = e-statement sent, claim pending
      if (/esent/i.test(String(balCell || ''))) current.ins_status = 'pending-claim'
    } else if (current) {
      // Procedure row — has a treatment code/desc in col4 (not 'BALANCE')
      const txCell = row[4]
      if (txCell && !isBalanceMarker(txCell)) {
        const tx = parseTxCell(txCell)
        if (tx) {
          current.treatments.push({
            ...tx,
            coverage: String(row[5] || '').trim(),
            fee:      N(row[6]),
            insAllowed: N(row[7]),
            pct:      N(row[8]),
            upcoming: N(row[9]),
            deductible: row[10] != null ? String(row[10]).trim() : '',
            amount:   N(row[11]),
          })
        }
      }
      // Total collections lands on the patient's last procedure row (col12)
      if (row[12] != null && N(row[12]) > 0) current.total_expected = N(row[12])
      // Insurance status / carrier appear on procedure rows (col14 / col15)
      if (row[14] && !current.ins_status_set) {
        const st = String(row[14]).trim()
        if (st) { current.ins_status = st; current.ins_status_set = true }
      }
      if (row[15] && !current.ins_carrier) current.ins_carrier = String(row[15]).trim()
      // Additional claim notes (col16) on proc rows
      if (row[16]) {
        const note = String(row[16]).trim()
        if (note && !current.claim_notes.includes(note)) current.claim_notes.push(note)
      }
      // '$X REMAINING' annotation sometimes in col2 of a procedure row
      if (row[2] && /remaining/i.test(String(row[2]))) {
        const rem = parseCollectNote(row[2])
        if (rem != null) current.remaining_balance = rem
      }
    }
  }
  if (current) patients.push(current)

  // Finalize: if no total captured from col12, sum the procedure amounts
  for (const p of patients) {
    if (!p.total_expected && p.treatments.length) {
      p.total_expected = p.treatments.reduce((s, t) => s + N(t.amount), 0)
    }
    // If still nothing but there's a brought-forward balance, use that
    if (!p.total_expected && p.balance_bf > 0) p.total_expected = p.balance_bf
    delete p.ins_status_set
  }
  return patients.filter(p => p.patient_name)
}

// ── Legacy 'PG'-marker layout (older sheets) ───────────────────────────────
function parseLegacyPG(rows) {
  const patients = []
  let curOp = ''
  let current = null

  for (const row of rows) {
    const opCell = String(row[0] || '').trim()
    if (opCell && (opCell.toUpperCase().includes('OPO') || opCell.toUpperCase().includes(' OP'))) curOp = opCell

    const pg    = String(row[1] || '').trim()
    const name  = row[2]
    const bal   = row[3]
    const tx    = row[4]
    const fee   = row[5]
    const ins   = row[6]
    const pct   = row[7]
    const amt8  = row[8]
    const ded   = row[9]
    const tot   = row[11]
    const insSt = String(row[13] || '').trim()
    const carr  = String(row[14] || '').trim()
    const claim = String(row[16] || '').trim()

    const isPtRow = pg === 'PG' && name && String(name).trim() !== ''

    if (isPtRow) {
      if (current) patients.push(current)
      const dispName = String(name).trim()
      current = {
        id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        patient_name: dispName,
        patient_name_norm: dispName.replace(/\([^)]+\)/g, '').replace(/[^A-Za-z\s]/g, '').trim().toUpperCase().split(/\s+/).join(' '),
        operatory: curOp,
        balance_bf: parseBalance(bal),
        ins_status: insSt, ins_carrier: carr,
        total_expected: N(tot), collect_override: null,
        treatments: [], claim_notes: claim ? [claim] : [],
        status: 'pending', amount_collected: 0, note: '', collected_by: '', collected_at: null,
      }
    } else if (current && tx) {
      const parsed = parseTxCell(tx)
      if (parsed) current.treatments.push({ ...parsed, coverage: String(ins || '').trim(), fee: N(fee), pct: N(pct), amount: N(amt8), deductible: ded != null ? String(ded).trim() : '' })
      if (tot != null && N(tot) > 0) current.total_expected = N(tot)
    }
  }
  if (current) patients.push(current)
  for (const p of patients) {
    if (p.collect_override !== null && p.collect_override !== undefined) p.total_expected = p.collect_override
    if (!p.total_expected && p.treatments.length) p.total_expected = p.treatments.reduce((s, t) => s + N(t.amount), 0)
    if (!p.total_expected && p.balance_bf > 0) p.total_expected = p.balance_bf
  }
  return patients.filter(p => p.patient_name)
}

const STATUS = {
  pending:   { label:'Pending',   color:'#d97706', bg:'#fef3c7', icon:'⏳' },
  collected: { label:'Collected', color:'#16a34a', bg:'#dcfce7', icon:'✓'  },
  partial:   { label:'Partial',   color:'#0891b2', bg:'#e0f2fe', icon:'½'  },
  waived:    { label:'Waived',    color:'#7c3aed', bg:'#f5f3ff', icon:'○'  },
  issue:     { label:'Issue',     color:'#dc2626', bg:'#fee2e2', icon:'!'  },
}
const StatusBadge = ({ status }) => {
  const m = STATUS[status] || STATUS.pending
  return <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:99,background:m.bg,color:m.color,whiteSpace:'nowrap'}}>{m.icon} {m.label}</span>
}
const InsBadge = ({ status }) => {
  const s = String(status||'').toUpperCase()
  const active=s.includes('ACTIVE'), inactive=s.includes('INACTIVE'), priv=s.includes('PRIVATE')
  return <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99,
    background:active?'#dcfce7':inactive?'#fee2e2':priv?'#f5f3ff':'#f1f5f9',
    color:active?'#15803d':inactive?'#dc2626':priv?'#7c3aed':'#64748b',whiteSpace:'nowrap'}}>
    {active?'Active Ins':inactive?'Inactive':priv?'Self Pay':'—'}</span>
}

export default function CollectionTrackerPage({ user, isManager }) {
  const [date,       setDate]       = useState(todayStr())
  const [office,     setOffice]     = useState(user.office || OFFICES[0])
  const [patients,   setPatients]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [editingId,  setEditingId]  = useState(null)
  const [editAmt,    setEditAmt]    = useState('')
  const [editNote,   setEditNote]   = useState('')
  const [editStatus, setEditStatus] = useState('collected')
  const [toast,      setToast]      = useState(null)
  const [filterOp,   setFilterOp]   = useState('all')
  const [filterSt,   setFilterSt]   = useState('all')
  const [filterDue,  setFilterDue]  = useState('all')
  const [search,     setSearch]     = useState('')
  const pollRef = useRef(null)
  const fileRef = useRef(null)

  const notify = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000) }

  const load = async (silent=false) => {
    if (!silent) setLoading(true)
    try {
      const rows = await sbGet('collection_patients', `office=eq.${encodeURIComponent(office)}&date=eq.${date}&order=operatory,patient_name`)
      setPatients(rows)
    } catch(e) { if(!silent) notify('Load failed: '+e.message,'error') }
    if (!silent) setLoading(false)
  }

  useEffect(() => {
    load()
    pollRef.current = setInterval(()=>load(true), 15000)
    return () => clearInterval(pollRef.current)
  }, [date, office])

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      let parsed = [], label = file.name
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const { extractCollectionSheetText, parseCollectionSheetPdf, detectOfficeFromFilename, detectOfficeFromText } = await import('../../lib/collectionSheetPdfParser')
        const text = await extractCollectionSheetText(file)
        const det  = detectOfficeFromFilename(file.name) || detectOfficeFromText(text)
        if (det && det !== office) {
          const ok = window.confirm('Office mismatch: PDF appears to be for "' + det + '" but uploading to "' + office + '".\n\nContinue anyway?')
          if (!ok) { setUploading(false); if (fileRef.current) fileRef.current.value = ''; return }
        }
        if (!det) notify('Could not detect office from PDF — verify correct file', 'error')
        const res = parseCollectionSheetPdf(text, file.name)
        parsed    = res.patients
        if (res.date && res.date !== date) notify('PDF date (' + res.date + ') differs from selected date (' + date + ')', 'error')
      } else {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
        const wb   = XLSX.read(await file.arrayBuffer(), {type:'array'})
        const clean = n => String(n).trim()
        const toRows = sh => XLSX.utils.sheet_to_json(wb.Sheets[sh], {header:1, defval:null})

        // 1) Prefer the tab named for the selected date (MMDDYYYY), if present
        const [yy, mm, dd] = date.split('-')
        const target = `${mm}${dd}${yy}`
        let sheet =
          wb.SheetNames.find(n => clean(n) === target) ||
          wb.SheetNames.find(n => clean(n).replace(/\D/g,'') === target)

        // 2) Otherwise, find the sheet that actually contains patient data.
        //    A data sheet has rows with a name in col C + 'BALANCE' in col E,
        //    or the legacy 'PG' marker in col B. Pick the one with the most.
        if (!sheet) {
          let best = null, bestCount = -1
          for (const n of wb.SheetNames) {
            const rows = toRows(n)
            let count = 0
            for (const r of rows) {
              const hasName = r[2] && String(r[2]).trim() !== ''
              const isBal   = String(r[4] || '').trim().toUpperCase().startsWith('BALANCE')
              const isPG    = String(r[1] || '').trim() === 'PG'
              if ((hasName && isBal) || (isPG && hasName)) count++
            }
            if (count > bestCount) { bestCount = count; best = n }
          }
          if (best && bestCount > 0) sheet = best
        }

        if (!sheet) { notify('No collection data found in this file','error'); setUploading(false); if (fileRef.current) fileRef.current.value=''; return }
        label  = clean(sheet)
        parsed = parseCollectionSheetFull(toRows(sheet))
      }
      if (!parsed.length) { notify('No patients found in "'+label+'"','error'); setUploading(false); return }
      const ex = await sbGet('collection_patients',`office=eq.${encodeURIComponent(office)}&date=eq.${date}&select=id`)
      for (const r of ex) await sbDel('collection_patients','id=eq.'+r.id)
      // Build explicit, schema-safe records (correct types, no stray fields)
      const now = new Date().toISOString()
      const clean = parsed.map(p => ({
        id:                String(p.id),
        office, date,
        operatory:         String(p.operatory || ''),
        patient_name:      String(p.patient_name || ''),
        patient_name_norm: String(p.patient_name_norm || ''),
        balance_bf:        Number(p.balance_bf) || 0,
        total_expected:    Number(p.total_expected) || 0,
        treatments:        Array.isArray(p.treatments) ? p.treatments : [],
        ins_status:        String(p.ins_status || ''),
        ins_carrier:       String(p.ins_carrier || ''),
        claim_notes:       Array.isArray(p.claim_notes) ? p.claim_notes : [],
        collect_override:  (p.collect_override == null ? null : Number(p.collect_override)),
        status:            'pending',
        amount_collected:  0,
        note:              '',
        collected_by:      '',
        collected_at:      null,
        created_at:        now,
        updated_at:        now,
      }))
      try {
        for (const rec of clean) await sbPost('collection_patients', rec, true)
      } catch (insErr) {
        // Surface the real Postgres/PostgREST message
        notify('DB rejected record: ' + (insErr.message || insErr), 'error')
        console.error('Collection insert failed. First record was:', clean[0], insErr)
        setUploading(false); if (fileRef.current) fileRef.current.value=''; return
      }
      await loadPatients()
      notify('Loaded '+clean.length+' patients')
    } catch(e) { notify('Upload failed: '+e.message,'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const saveCollection = async (p) => {
    const amt = N(editAmt)
    const st  = editStatus==='collected'&&amt>0&&amt<p.total_expected ? 'partial' : editStatus
    const upd = {status:st,amount_collected:amt,note:editNote,collected_by:user.name,collected_at:new Date().toISOString(),updated_at:new Date().toISOString()}
    try {
      await sbPost('collection_patients',{...p,...upd},true)
      setPatients(prev=>prev.map(x=>x.id===p.id?{...x,...upd}:x))
      notify('Saved ✓')
      setEditingId(null)
    } catch(e) { notify('Save failed: '+e.message,'error') }
  }

  const printSheet = () => {
    const rows = filtered.map(p=>`<tr>
      <td><b>${p.patient_name}</b>${p.balance_bf?'<br><small style="color:#dc2626">Bal B/F: $'+p.balance_bf.toFixed(2)+'</small>':''}</td>
      <td>${p.operatory||'—'}</td>
      <td><small>${p.ins_status?.includes('ACTIVE')?'Active':p.ins_status?.includes('INACTIVE')?'⚠ Inactive':p.ins_status?.includes('PRIVATE')?'Self Pay':'—'}<br>${p.ins_carrier||''}</small></td>
      <td>${(p.treatments||[]).map(t=>'<div style="font-size:11px"><b>'+t.code+'</b> '+t.desc+(t.tooth?' Th:'+t.tooth:'')+'</div>').join('')}</td>
      <td style="text-align:center">${(p.treatments||[]).map(t=>'<div style="font-size:11px">'+t.pt_pct+'%</div>').join('')}</td>
      <td style="text-align:right;font-weight:700;color:${p.total_expected>0?'#dc2626':'#94a3b8'}">${p.total_expected>0?'$'+p.total_expected.toFixed(2):'$0.00'}</td>
      <td style="text-align:center"><span style="display:inline-block;width:80px;height:20px;border:1px solid #ccc;border-radius:3px"></span></td>
      <td>${p.note||''}</td>
    </tr>`).join('')
    const w = window.open('','_blank','width=1100,height=800')
    w.document.write('<!DOCTYPE html><html><head><title>Collection Sheet - '+office+' - '+date+'</title><style>body{font-family:Arial,sans-serif;padding:20px;font-size:12px}h1{font-size:16px;margin:0 0 2px}h2{font-size:11px;color:#555;margin:0 0 12px;font-weight:400}table{width:100%;border-collapse:collapse}th{background:#1d4ed8;color:white;padding:7px 8px;text-align:left;font-size:10px;letter-spacing:.5px}td{padding:7px 8px;border-bottom:1px solid #e5e5e5;vertical-align:top}@media print{button{display:none}}</style></head><body><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px"><div><h1>Collection Sheet — '+office+'</h1><h2>'+date+' &nbsp;|&nbsp; '+filtered.length+' patients</h2></div><button onclick="window.print()" style="padding:8px 16px;background:#1d4ed8;color:white;border:none;border-radius:6px;cursor:pointer">Print / Save PDF</button></div><table><thead><tr><th>PATIENT</th><th>OP</th><th>INSURANCE</th><th>PROCEDURES</th><th>PT%</th><th>COLLECT</th><th>COLLECTED</th><th>NOTES</th></tr></thead><tbody>'+rows+'</tbody></table><div style="margin-top:12px;display:flex;gap:24px;font-size:12px"><div>Expected: <b>$'+filtered.filter(p=>p.total_expected>0).reduce((s,p)=>s+p.total_expected,0).toFixed(2)+'</b></div><div>Collected: <b>$'+filtered.reduce((s,p)=>s+N(p.amount_collected),0).toFixed(2)+'</b></div></div></body></html>')
    w.document.close()
  }

  const downloadCSV = () => {
    const h = ['Patient','Operatory','Ins Status','Carrier','Balance B/F','Procedures','Pt %','Total Expected','Collected','Status','Note']
    const r = filtered.map(p=>[p.patient_name,p.operatory||'',p.ins_status||'',p.ins_carrier||'',p.balance_bf||0,
      (p.treatments||[]).map(t=>t.code+' '+t.desc).join(' | '),
      (p.treatments||[]).map(t=>t.pt_pct+'%').join(' | '),
      p.total_expected||0,N(p.amount_collected),p.status,p.note||''])
    const csv = [h,...r].map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = 'Collections_'+office+'_'+date+'.csv'
    a.click()
  }

  const operatories = ['all',...Array.from(new Set(patients.map(p=>p.operatory||'').filter(Boolean))).sort()]
  const filtered = patients.filter(p=>{
    if (filterOp!=='all'&&p.operatory!==filterOp) return false
    if (filterSt!=='all'&&p.status!==filterSt) return false
    if (filterDue==='due'&&p.total_expected<=0) return false
    if (filterDue==='zero'&&p.total_expected>0) return false
    if (search&&!p.patient_name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })
  const totalExp  = filtered.filter(p=>p.total_expected>0).reduce((s,p)=>s+p.total_expected,0)
  const totalColl = filtered.reduce((s,p)=>s+N(p.amount_collected),0)
  const totalGap  = Math.round((totalExp-totalColl)*100)/100
  const byOp = {}
  for (const p of filtered) { const op=p.operatory||'Unassigned'; if(!byOp[op])byOp[op]=[]; byOp[op].push(p) }
  const opKeys = Object.keys(byOp).sort()

  const PatientCard = ({ p }) => {
    const isExp  = expandedId===p.id
    const isEdit = editingId===p.id
    const hasDue = p.total_expected>0
    const gap    = p.total_expected - N(p.amount_collected)
    const border = hasDue&&p.status==='pending'?'#fde68a':p.status==='collected'?'#bbf7d0':p.status==='issue'?'#fecaca':p.status==='partial'?'#bae6fd':'#e2e8f0'

    return (
      <div style={{background:'white',borderRadius:10,border:'2px solid '+border,marginBottom:8,overflow:'hidden'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',cursor:'pointer'}} onClick={()=>setExpandedId(isExp?null:p.id)}>
          {/* Collect amount */}
          <div style={{flexShrink:0,textAlign:'center',minWidth:80}}>
            {hasDue ? (
              <div style={{background:p.status==='collected'?'#dcfce7':p.status==='partial'?'#e0f2fe':'#fef2f2',borderRadius:8,padding:'6px 8px'}}>
                <div style={{fontSize:16,fontWeight:800,color:p.status==='collected'?'#16a34a':p.status==='partial'?'#0891b2':'#dc2626'}}>${p.total_expected.toFixed(2)}</div>
                <div style={{fontSize:9,fontWeight:700,color:'#94a3b8',letterSpacing:.5}}>COLLECT</div>
              </div>
            ) : (
              <div style={{background:'#f8fafc',borderRadius:8,padding:'6px 8px'}}>
                <div style={{fontSize:13,fontWeight:700,color:'#94a3b8'}}>$0.00</div>
                <div style={{fontSize:9,color:'#cbd5e1',letterSpacing:.5}}>INS COVERS</div>
              </div>
            )}
          </div>
          {/* Info */}
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:3}}>
              <span style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>{p.patient_name}</span>
              <StatusBadge status={p.status}/>
              <InsBadge status={p.ins_status}/>
            </div>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:11,color:'#64748b'}}>
              {p.ins_carrier&&<span>{p.ins_carrier}</span>}
              {p.balance_bf!==0&&<span style={{color:p.balance_bf>0?'#dc2626':'#16a34a',fontWeight:600}}>Bal B/F: {p.balance_bf>0?'+':''}{USD(p.balance_bf)}</span>}
              {(p.treatments||[]).length>0&&<span>{p.treatments.length} procedure{p.treatments.length!==1?'s':''}</span>}
              {p.status==='partial'&&<span style={{color:'#0891b2',fontWeight:600}}>Paid {USD(N(p.amount_collected))} · Owes {USD(gap)}</span>}
              {p.collected_by&&<span>by {p.collected_by}</span>}
            </div>
            {p.note&&<div style={{fontSize:11,color:'#7c3aed',marginTop:2,fontStyle:'italic'}}>Note: {p.note}</div>}
            {p.claim_notes&&p.claim_notes[0]&&<div style={{fontSize:11,color:'#dc2626',marginTop:2}}>Claim: {p.claim_notes[0].slice(0,80)}</div>}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
            {hasDue&&!isEdit&&(
              <button onClick={e=>{e.stopPropagation();setEditingId(p.id);setEditAmt(p.amount_collected>0?String(p.amount_collected):p.total_expected.toFixed(2));setEditNote(p.note||'');setEditStatus(p.status==='pending'?'collected':p.status);}}
                style={{padding:'6px 14px',borderRadius:8,background:p.status==='pending'?'#7c3aed':'#f1f5f9',color:p.status==='pending'?'white':'#475569',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                {p.status==='pending'?'Collect':'Update'}
              </button>
            )}
            {isExp?<span style={{color:'#94a3b8',fontSize:12}}>▲</span>:<span style={{color:'#94a3b8',fontSize:12}}>▼</span>}
          </div>
        </div>

        {/* Procedure table */}
        {isExp&&!isEdit&&(p.treatments||[]).length>0&&(
          <div style={{borderTop:'1px solid #f1f5f9',padding:'0 14px 12px'}}>
            <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:1,margin:'10px 0 8px'}}>PROCEDURE BREAKDOWN</div>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead><tr style={{background:'#f8fafc'}}>
                  {['Code','Description','Tooth','Fee','Ins Allowed','Pt %','Pt Owes'].map(h=>(
                    <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:10,fontWeight:700,color:'#64748b',borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {(p.treatments||[]).map((t,i)=>(
                    <tr key={i} style={{borderBottom:'1px solid #f8fafc',background:t.pt_owes>0?'#fffbeb':'white'}}>
                      <td style={{padding:'7px 8px',fontWeight:700,fontSize:11,color:t.cdtValid?'#1e293b':t.isCustom?'#7c3aed':'#d97706'}}>{t.code}{!t.cdtValid&&!t.isCustom&&<span style={{fontSize:9,marginLeft:3}}>⚠</span>}</td>
                      <td style={{padding:'7px 8px',color:'#1e293b'}}>{t.desc}</td>
                      <td style={{padding:'7px 8px',color:'#64748b',whiteSpace:'nowrap'}}>{t.tooth}{t.surface?' ('+t.surface+')':''}</td>
                      <td style={{padding:'7px 8px',color:'#475569'}}>{t.fee>0?USD(t.fee):'—'}</td>
                      <td style={{padding:'7px 8px',color:'#475569'}}>{t.ins_fee>0?USD(t.ins_fee):'—'}</td>
                      <td style={{padding:'7px 8px'}}>
                        <span style={{fontWeight:700,padding:'2px 8px',borderRadius:99,fontSize:11,
                          background:t.pt_pct===0?'#dcfce7':t.pt_pct===100?'#fee2e2':'#fef3c7',
                          color:t.pt_pct===0?'#16a34a':t.pt_pct===100?'#dc2626':'#d97706'}}>
                          {t.pt_pct}%
                        </span>
                      </td>
                      <td style={{padding:'7px 8px',fontWeight:t.pt_owes>0?700:400,color:t.pt_owes>0?'#dc2626':'#94a3b8'}}>{t.pt_owes>0?USD(t.pt_owes):'—'}</td>
                    </tr>
                  ))}
                </tbody>
                {p.total_expected>0&&(
                  <tfoot><tr style={{background:'#f0fdf4'}}>
                    <td colSpan={5} style={{padding:'8px',fontSize:11,fontWeight:700,color:'#15803d'}}>
                      {p.collect_override!==null?'Ridgeview Collect Instruction:':'Total to Collect:'}
                    </td>
                    <td colSpan={2} style={{padding:'8px',fontWeight:800,fontSize:15,color:'#dc2626'}}>${p.total_expected.toFixed(2)}</td>
                  </tr></tfoot>
                )}
              </table>
            </div>
            {(p.claim_notes||[]).map((n,i)=>(
              <div key={i} style={{marginTop:8,padding:'7px 10px',background:'#fef2f2',borderRadius:7,fontSize:11,color:'#dc2626'}}>Claim note: {n}</div>
            ))}
          </div>
        )}

        {/* Edit form */}
        {isEdit&&(
          <div style={{borderTop:'1px solid #e2e8f0',padding:'14px',background:'#f8fafc'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
              <div>
                <label style={LBL}>Amount Collected ($)</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#94a3b8',fontSize:13,pointerEvents:'none'}}>$</span>
                  <input type="number" min="0" step="0.01" className="ic" style={{paddingLeft:22}} value={editAmt} onChange={e=>setEditAmt(e.target.value)} placeholder={p.total_expected.toFixed(2)} autoFocus/>
                </div>
                {N(editAmt)>0&&N(editAmt)<p.total_expected&&<div style={{fontSize:11,color:'#d97706',fontWeight:600,marginTop:3}}>Short by ${(p.total_expected-N(editAmt)).toFixed(2)}</div>}
                <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Expected: ${p.total_expected.toFixed(2)}</div>
              </div>
              <div>
                <label style={LBL}>Status</label>
                <select className="ic" value={editStatus} onChange={e=>setEditStatus(e.target.value)}>
                  <option value="collected">Collected in Full</option>
                  <option value="partial">Partial Payment</option>
                  <option value="waived">Waived</option>
                  <option value="issue">Issue - Follow Up</option>
                </select>
              </div>
              <div style={{gridColumn:'1/-1'}}>
                <label style={LBL}>Notes</label>
                <input className="ic" value={editNote} onChange={e=>setEditNote(e.target.value)} placeholder="e.g. Will pay balance next visit, card declined…"/>
              </div>
            </div>
            <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
              <button onClick={()=>setEditingId(null)} style={{padding:'8px 18px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
              <button onClick={()=>saveCollection(p)} style={{padding:'8px 20px',borderRadius:8,background:'#7c3aed',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>Save</button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{maxWidth:1050,margin:'0 auto',padding:'24px 20px 60px'}}>
      {toast&&<div style={{position:'fixed',top:20,right:20,zIndex:9999,padding:'12px 20px',borderRadius:12,boxShadow:'0 10px 30px rgba(0,0,0,.15)',color:'white',fontSize:13,fontWeight:600,background:toast.type==='error'?'#ef4444':'#10b981',maxWidth:360}}>{toast.msg}</div>}

      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',margin:0}}>Collection Tracker</h1>
          <p style={{color:'#94a3b8',fontSize:13,marginTop:3}}>Live daily collections — all staff see updates in real time — auto-refreshes every 15s</p>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button onClick={()=>load()} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>
            <IcoRefresh size={13}/> Refresh
          </button>
          <button onClick={downloadCSV} disabled={!patients.length} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 14px',borderRadius:8,background:patients.length?'#1d4ed8':'#f1f5f9',color:patients.length?'white':'#94a3b8',border:'none',fontWeight:700,fontSize:12,cursor:patients.length?'pointer':'not-allowed'}}>
            <IcoDL size={13}/> CSV
          </button>
          <button onClick={printSheet} disabled={!patients.length} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 14px',borderRadius:8,background:patients.length?'#475569':'#f1f5f9',color:patients.length?'white':'#94a3b8',border:'none',fontWeight:700,fontSize:12,cursor:patients.length?'pointer':'not-allowed'}}>
            <IcoPrint size={13}/> Print
          </button>
          <label style={{display:'flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:10,background:uploading?'#c4b5fd':'#7c3aed',color:'white',fontWeight:700,fontSize:13,cursor:uploading?'not-allowed':'pointer'}}>
            <IcoUpload size={14}/> {uploading?'Loading...':'Upload Collection Sheet'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" onChange={handleUpload} style={{display:'none'}} disabled={uploading}/>
          </label>
        </div>
      </div>

      {/* Filters */}
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'14px 16px',marginBottom:16,display:'flex',gap:10,flexWrap:'wrap',alignItems:'flex-end'}}>
        <div style={{flex:'1 1 130px'}}>
          <label style={LBL}>Date</label>
          <input type="date" className="ic" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
        {isManager&&<div style={{flex:'1 1 120px'}}>
          <label style={LBL}>Office</label>
          <select className="ic" value={office} onChange={e=>setOffice(e.target.value)}>
            {OFFICES.map(o=><option key={o}>{o}</option>)}
          </select>
        </div>}
        <div style={{flex:'1 1 120px'}}>
          <label style={LBL}>Operatory</label>
          <select className="ic" value={filterOp} onChange={e=>setFilterOp(e.target.value)}>
            <option value="all">All Operatories</option>
            {operatories.filter(o=>o!=='all').map(o=><option key={o}>{o}</option>)}
          </select>
        </div>
        <div style={{flex:'1 1 110px'}}>
          <label style={LBL}>Status</label>
          <select className="ic" value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
            <option value="all">All Statuses</option>
            {Object.entries(STATUS).map(([k,m])=><option key={k} value={k}>{m.label}</option>)}
          </select>
        </div>
        <div style={{flex:'1 1 110px'}}>
          <label style={LBL}>Balance</label>
          <select className="ic" value={filterDue} onChange={e=>setFilterDue(e.target.value)}>
            <option value="all">All Patients</option>
            <option value="due">Has Balance Due</option>
            <option value="zero">$0 Owed</option>
          </select>
        </div>
        <div style={{flex:'1 1 150px'}}>
          <label style={LBL}>Search</label>
          <input className="ic" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Patient name..."/>
        </div>
      </div>

      {/* Summary bar */}
      {patients.length>0&&(
        <div style={{background:'linear-gradient(135deg,#7c3aed,#9333ea)',borderRadius:12,padding:'14px 20px',marginBottom:16,color:'white',display:'flex',flexWrap:'wrap',gap:0}}>
          {[['EXPECTED','$'+totalExp.toFixed(2),null],['COLLECTED','$'+totalColl.toFixed(2),null],['REMAINING','$'+Math.abs(totalGap).toFixed(2),totalGap>0?'#f87171':'#86efac'],
            ['PENDING',filtered.filter(p=>p.status==='pending'&&p.total_expected>0).length,null],
            ['DONE',patients.filter(p=>p.status==='collected').length,null],
            ['ISSUES',patients.filter(p=>p.status==='issue'||p.status==='partial').length,patients.filter(p=>p.status==='issue'||p.status==='partial').length>0?'#f87171':null],
          ].map(([l,v,c],i)=>(
            <div key={i} style={{flex:'1 1 80px',padding:'0 12px',borderLeft:i>0?'1px solid rgba(255,255,255,.2)':'none'}}>
              <div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:2}}>{l}</div>
              <div style={{fontSize:17,fontWeight:800,color:c||'white'}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {!loading&&patients.length===0&&(
        <div style={{textAlign:'center',padding:'60px 20px',background:'white',borderRadius:12,border:'2px dashed #e2e8f0'}}>
          <div style={{fontSize:40,marginBottom:12}}>📋</div>
          <div style={{fontSize:16,fontWeight:700,color:'#1e293b',marginBottom:6}}>No patients loaded for {date}</div>
          <p style={{fontSize:13,color:'#94a3b8',marginBottom:20}}>Upload the Ridgeview collection sheet to load today's patients.</p>
          <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'11px 24px',borderRadius:10,background:'#7c3aed',color:'white',fontWeight:700,fontSize:14,cursor:'pointer'}}>
            <IcoUpload size={16}/> Upload Collection Sheet
            <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleUpload} style={{display:'none'}}/>
          </label>
        </div>
      )}

      {loading&&<div style={{textAlign:'center',padding:60,color:'#94a3b8'}}><div className="spinner" style={{margin:'0 auto 12px',borderTopColor:'#7c3aed'}}/>Loading...</div>}

      {!loading&&filtered.length>0&&opKeys.map(op=>{
        const opPts = byOp[op]
        if (!opPts?.length) return null
        const opExp  = opPts.filter(p=>p.total_expected>0).reduce((s,p)=>s+p.total_expected,0)
        const opColl = opPts.reduce((s,p)=>s+N(p.amount_collected),0)
        const opDue  = opPts.filter(p=>p.status==='pending'&&p.total_expected>0).length
        return (
          <div key={op} style={{marginBottom:24}}>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
              <span style={{fontSize:12,fontWeight:800,color:'#7c3aed',letterSpacing:1}}>{op.toUpperCase()}</span>
              <span style={{fontSize:11,color:'#94a3b8'}}>{opPts.length} patients</span>
              {opExp>0&&<span style={{fontSize:11,color:'#64748b'}}>Expected {USD(opExp)} · Collected {USD(opColl)}{opDue>0?<span style={{color:'#dc2626',fontWeight:700}}> · '+opDue+' pending</span>:''}</span>}
              <div style={{flex:1,height:1,background:'#e2e8f0'}}/>
            </div>
            {opPts.map(p=><PatientCard key={p.id} p={p}/>)}
          </div>
        )
      })}
    </div>
  )
}
