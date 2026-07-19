// src/pages/ridgeview/BenefitsTab.jsx — Benefit Verification Center.
// Search/edit patient benefit profiles; upload a carrier faxback and let the
// extractor pre-fill fields — every field shows its confidence and the
// VERBATIM quote from the document, and nothing saves without confirmation.

import React, { useState, useEffect } from 'react'
import { sbGet, sbPost } from '../../lib/supabase'
import { N, USD, todayStr } from '../../lib/helpers'

const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a', AMBER='#d97706', RED='#dc2626'
const norm = s => String(s||'').toLowerCase().replace(/[^a-z\s]/g,'').replace(/\s+/g,' ').trim()

const FIELD_DEFS = [
  ['carrier','Carrier','text'], ['member_id','Member ID','text'], ['group_number','Group #','text'],
  ['plan_year_start','Plan Year Start','text'],
  ['deductible_total','Deductible Total','number'], ['deductible_remaining','Deductible Remaining','number'],
  ['deductible_waived_preventive','Ded. Waived on Preventive','bool'],
  ['annual_max','Annual Max','number'], ['max_remaining','Max Remaining','number'],
  ['cov_preventive','Preventive %','number'], ['cov_basic','Basic %','number'], ['cov_major','Major %','number'],
  ['cov_implant','Implant %','number'], ['cov_perio','Perio %','number'], ['cov_denture','Denture %','number'],
  ['mtc','Missing Tooth Clause','bool'], ['missing_teeth','Missing Teeth (at enrollment)','text'],
  ['waiting_periods','Waiting Periods','text'], ['downgrade_posterior','Posterior Downgrade','bool'],
  ['freq_prophy_last','Last Prophy','date'], ['freq_bwx_last','Last BWX','date'],
  ['freq_fmx_last','Last FMX/Pano','date'], ['freq_srp_last','Last SRP','date'],
  ['freq_denture_last','Last Denture Delivered','date'],
]

// map extractor field names -> profile columns (freq text fields land in notes)
const EXTRACT_MAP = {
  carrier:'carrier', member_id:'member_id', group_number:'group_number', plan_year_start:'plan_year_start',
  deductible_total:'deductible_total', deductible_remaining:'deductible_remaining',
  deductible_waived_preventive:'deductible_waived_preventive',
  annual_max:'annual_max', max_remaining:'max_remaining',
  cov_preventive:'cov_preventive', cov_basic:'cov_basic', cov_major:'cov_major',
  cov_implant:'cov_implant', cov_perio:'cov_perio', cov_denture:'cov_denture',
  mtc:'mtc', missing_teeth:'missing_teeth', waiting_periods:'waiting_periods',
  downgrade_posterior:'downgrade_posterior',
}

export default function BenefitsTab({ user, notify }) {
  const [profiles, setProfiles] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(null)         // profile being edited
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extraction, setExtraction] = useState(null)   // {fields:{k:{value,confidence,quote}}, fileName, fileBase64, mimeType}
  const [confirmed, setConfirmed] = useState({})

  const load = () => sbGet('benefit_profiles','select=*&order=updated_at.desc&limit=500').then(setProfiles).catch(()=>{})
  useEffect(() => { load() }, [])

  const openProfile = (p) => { setSel(p); setForm(p ? {...p} : { patient_name:'', patient_name_norm:'' }); setExtraction(null); setConfirmed({}) }
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const saveProfile = async () => {
    if (!form.patient_name?.trim()) { notify('Patient name required','error'); return }
    setSaving(true)
    try {
      const row = { ...form, patient_name_norm: norm(form.patient_name),
        verified_by: user?.name || user?.username || null, verified_at: new Date().toISOString(),
        updated_at: new Date().toISOString() }
      await sbPost('benefit_profiles', row, true)
      notify('Benefit profile saved ✓')
      setSel(null); setForm({}); load()
    } catch (e) { notify('Save failed: '+e.message, 'error') }
    setSaving(false)
  }

  // ── faxback upload → extraction ──
  const handleFax = async (e) => {
    const file = e.target.files[0]; e.target.value=''
    if (!file) return
    setExtracting(true); setExtraction(null); setConfirmed({})
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(',')[1])
        r.onerror = () => rej(new Error('Read failed'))
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/ai-extract', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ fileBase64: b64, mimeType: file.type, fileName: file.name }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Extraction failed')
      if (data.extracted?.not_eligibility_doc) { notify('That does not look like an eligibility/benefits document','error'); setExtracting(false); return }
      setExtraction({ fields: data.extracted, fileName: file.name, fileBase64: b64, mimeType: file.type })
      // pre-confirm everything at 90+ confidence
      const pre = {}
      for (const [k, v] of Object.entries(data.extracted)) if (v && v.confidence >= 90 && v.value !== null) pre[k] = true
      setConfirmed(pre)
      notify('Faxback read — review each field against its quote, then apply')
    } catch (err) { notify('Extraction failed: '+err.message, 'error') }
    setExtracting(false)
  }

  const applyExtraction = async () => {
    if (!extraction) return
    const applied = {}
    for (const [k, col] of Object.entries(EXTRACT_MAP)) {
      const f = extraction.fields[k]
      if (f && confirmed[k] && f.value !== null && f.value !== undefined) { set(col, f.value); applied[k] = f }
    }
    // persist the evidence document
    try {
      await sbPost('verification_docs', {
        patient_name_norm: norm(form.patient_name), carrier: form.carrier || extraction.fields.carrier?.value || null,
        doc_type: 'faxback', file_name: extraction.fileName, file_base64: extraction.fileBase64,
        mime_type: extraction.mimeType, extracted: extraction.fields, confirmed: applied,
        uploaded_by: user?.name || user?.username || null,
      })
      notify('Applied '+Object.keys(applied).length+' confirmed fields · faxback stored as evidence')
    } catch (e) { notify('Fields applied, but evidence save failed: '+e.message, 'error') }
    setExtraction(null)
  }

  const filtered = profiles.filter(p => !q || p.patient_name?.toLowerCase().includes(q.toLowerCase()) || p.carrier?.toLowerCase().includes(q.toLowerCase()))
  const card = { background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:16, marginBottom:14 }
  const confColor = c => c>=90?GREEN:c>=50?AMBER:RED

  return (
    <div style={{ maxWidth: 1000, margin:'0 auto', padding:'20px 16px 80px' }}>
      <div style={{ background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', borderRadius:14, padding:'18px 24px', marginBottom:18, color:'white' }}>
        <div style={{ fontSize:10, opacity:.5, fontWeight:700, letterSpacing:2, marginBottom:4 }}>RIDGEVIEW BILLING PORTAL</div>
        <h1 style={{ fontSize:20, fontWeight:800, margin:0 }}>Benefit Verification Center</h1>
        <div style={{ fontSize:12, opacity:.75, marginTop:4 }}>Every collection decision needs a profile behind it — and every profile needs a faxback behind it.</div>
      </div>

      {!sel ? (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            <input placeholder="Search patient or carrier…" value={q} onChange={e=>setQ(e.target.value)}
              style={{ flex:1, minWidth:200, padding:'9px 12px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:13 }}/>
            <button onClick={()=>openProfile(null)}
              style={{ padding:'9px 18px', borderRadius:9, background:NAVY, color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer' }}>
              + New Profile
            </button>
          </div>
          {filtered.length===0 && <div style={{ ...card, textAlign:'center', color:'#94a3b8' }}>No benefit profiles yet — create one or upload a faxback inside a profile.</div>}
          {filtered.map(p => (
            <div key={p.id} onClick={()=>openProfile(p)}
              style={{ ...card, cursor:'pointer', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', marginBottom:8, padding:'12px 16px' }}>
              <div style={{ flex:1, minWidth:160 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#1e293b' }}>{p.patient_name}</div>
                <div style={{ fontSize:11, color:'#64748b' }}>{p.carrier || 'carrier unknown'}{p.member_id ? ' · '+p.member_id : ''}</div>
              </div>
              <div style={{ fontSize:11, color:'#64748b' }}>Ded rem: <b style={{color:p.deductible_remaining>0?RED:GREEN}}>{p.deductible_remaining!=null?USD(p.deductible_remaining):'?'}</b></div>
              <div style={{ fontSize:11, color:'#64748b' }}>Max rem: <b>{p.max_remaining!=null?USD(p.max_remaining):'?'}</b></div>
              <div style={{ fontSize:11, color:'#64748b' }}>MTC: <b style={{color:p.mtc?RED:p.mtc===false?GREEN:AMBER}}>{p.mtc==null?'?':p.mtc?'YES':'NO'}</b></div>
              {p.source_doc_id
                ? <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, background:'#dcfce7', color:GREEN }}>FAX ON FILE</span>
                : <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, background:'#fef3c7', color:AMBER }}>NO EVIDENCE</span>}
            </div>
          ))}
        </>
      ) : (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
            <button onClick={()=>{setSel(null);setExtraction(null)}}
              style={{ padding:'7px 14px', borderRadius:8, background:'white', border:'1px solid #e2e8f0', color:'#64748b', fontWeight:700, fontSize:12, cursor:'pointer' }}>← Back</button>
            <label style={{ padding:'9px 18px', borderRadius:9, background:TEAL, color:'white', fontWeight:700, fontSize:13, cursor:'pointer' }}>
              {extracting ? 'Reading faxback…' : '📠 Upload Faxback (PDF/image)'}
              <input type="file" accept=".pdf,image/*" style={{ display:'none' }} onChange={handleFax} disabled={extracting}/>
            </label>
            <button onClick={saveProfile} disabled={saving}
              style={{ marginLeft:'auto', padding:'10px 24px', borderRadius:9, background:GREEN, color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer', opacity:saving?0.6:1 }}>
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>

          {/* Extraction review — evidence-first */}
          {extraction && (
            <div style={{ ...card, background:'#eff6ff', border:'1px solid #bfdbfe' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, flexWrap:'wrap', gap:8 }}>
                <div style={{ fontSize:13, fontWeight:800, color:BLUE }}>📠 {extraction.fileName} — review against quotes</div>
                <button onClick={applyExtraction}
                  style={{ padding:'8px 18px', borderRadius:8, background:BLUE, color:'white', border:'none', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  Apply {Object.values(confirmed).filter(Boolean).length} confirmed fields
                </button>
              </div>
              <div style={{ fontSize:11, color:'#1e40af', marginBottom:10 }}>Green = high confidence (pre-checked). Each value shows the verbatim text from the document that supports it. Uncheck anything you don't trust — unchecked fields are NOT applied.</div>
              {Object.entries(extraction.fields).filter(([k,v])=>EXTRACT_MAP[k]&&v).map(([k,v])=>(
                <label key={k} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'7px 10px', borderRadius:8, marginBottom:4,
                  background: v.value===null ? '#f8fafc' : 'white', border:'1px solid #e2e8f0', cursor: v.value===null?'default':'pointer', opacity: v.value===null?0.55:1 }}>
                  <input type="checkbox" disabled={v.value===null} checked={!!confirmed[k]}
                    onChange={e=>setConfirmed(c=>({...c,[k]:e.target.checked}))} style={{ marginTop:2 }}/>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', gap:8, alignItems:'baseline', flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, fontWeight:700, color:'#1e293b' }}>{(FIELD_DEFS.find(f=>EXTRACT_MAP[k]===f[0])||[k,k])[1]}</span>
                      <span style={{ fontSize:12, fontWeight:800, color:BLUE }}>{v.value===null?'not found in document':String(v.value)}</span>
                      {v.value!==null && <span style={{ fontSize:9, fontWeight:800, padding:'1px 7px', borderRadius:99, background:confColor(v.confidence)+'18', color:confColor(v.confidence) }}>{v.confidence}%</span>}
                    </div>
                    {v.quote && <div style={{ fontSize:10, color:'#64748b', fontStyle:'italic', marginTop:2 }}>"{v.quote}"</div>}
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Profile form */}
          <div style={card}>
            <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:12 }}>{sel?.id ? 'Edit' : 'New'} benefit profile</div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:10 }}>
              <div style={{ gridColumn:'1/-1' }}>
                <div style={{ fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:3 }}>PATIENT NAME *</div>
                <input value={form.patient_name||''} onChange={e=>set('patient_name',e.target.value)}
                  style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:13, fontWeight:600 }}/>
              </div>
              {FIELD_DEFS.map(([k,label,type])=>(
                <div key={k}>
                  <div style={{ fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:3 }}>{label.toUpperCase()}</div>
                  {type==='bool' ? (
                    <select value={form[k]==null?'':String(form[k])} onChange={e=>set(k, e.target.value===''?null:e.target.value==='true')}
                      style={{ width:'100%', padding:'7px 10px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12 }}>
                      <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
                    </select>
                  ) : (
                    <input type={type==='number'?'number':type==='date'?'date':'text'} value={form[k]??''}
                      onChange={e=>set(k, e.target.value===''?null:(type==='number'?N(e.target.value):e.target.value))}
                      style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12 }}/>
                  )}
                </div>
              ))}
              <div style={{ gridColumn:'1/-1' }}>
                <div style={{ fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:3 }}>NOTES</div>
                <input value={form.notes||''} onChange={e=>set('notes',e.target.value)}
                  style={{ width:'100%', boxSizing:'border-box', padding:'7px 10px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:12 }}/>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
