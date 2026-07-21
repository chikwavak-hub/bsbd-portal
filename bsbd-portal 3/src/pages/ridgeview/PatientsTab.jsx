// src/pages/ridgeview/PatientsTab.jsx — the practice's patient registry, browsable.
// Every patient ever saved on a collection sheet or ledger analysis lands here.
// Click a patient to see their linked benefit profile, visit history from the
// collection sheets, and any saved ledger workups.

import React, { useState, useEffect, useMemo } from 'react'
import { sbGet } from '../../lib/supabase'
import { N, USD } from '../../lib/helpers'

const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a', AMBER='#d97706', RED='#dc2626'
const OFFICES = ['All','Brainerd','Calhoun','Dalton','McCallie']

export default function PatientsTab({ user, notify, onOpenBenefits }) {
  const [rows, setRows] = useState([])
  const [profiles, setProfiles] = useState({})
  const [q, setQ] = useState('')
  const [office, setOffice] = useState('All')
  const [sel, setSel] = useState(null)          // selected registry patient
  const [history, setHistory] = useState(null)  // their collection_patients rows
  const [workups, setWorkups] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      sbGet('patients', 'select=*&order=last_seen.desc.nullslast&limit=3000').catch(() => []),
      sbGet('benefit_profiles', 'select=id,patient_name_norm,carrier,verified_at,source_doc_id,ledger_verdict,ledger_collect_now,deductible_remaining,max_remaining&limit=2000').catch(() => []),
    ]).then(([pts, profs]) => {
      setRows(pts)
      const m = {}
      profs.forEach(p => { if (!m[p.patient_name_norm]) m[p.patient_name_norm] = p })
      setProfiles(m)
      setLoading(false)
    })
  }, [])

  const openPatient = async (p) => {
    setSel(p); setHistory(null); setWorkups(null)
    try {
      const h = await sbGet('collection_patients', `patient_name_norm=eq.${encodeURIComponent(p.patient_name_norm)}&select=date,office,appt_time,treatments,total_expected,amount_collected,status&order=date.desc&limit=50`)
      setHistory(h)
    } catch { setHistory([]) }
    try {
      const w = p.chart_number
        ? await sbGet('ledger_workups', `chart=eq.${encodeURIComponent(p.chart_number)}&select=id,balance,buckets,created_at,actions&order=created_at.desc&limit=10`)
        : await sbGet('ledger_workups', `patient_name=ilike.*${encodeURIComponent(p.patient_name)}*&select=id,balance,buckets,created_at,actions&order=created_at.desc&limit=10`)
      setWorkups(w)
    } catch { setWorkups([]) }
  }

  const filtered = useMemo(() => rows.filter(r =>
    (office === 'All' || r.office === office) &&
    (!q || r.patient_name?.toLowerCase().includes(q.toLowerCase()) ||
      String(r.chart_number || '').toLowerCase().includes(q.toLowerCase()) ||
      String(r.patient_id || '').toLowerCase().includes(q.toLowerCase()) ||
      String(r.phone || '').includes(q))
  ), [rows, q, office])

  const card = { background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:16, marginBottom:12 }

  return (
    <div style={{ maxWidth: 1000, margin:'0 auto', padding:'20px 16px 80px' }}>
      <div style={{ background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', borderRadius:14, padding:'18px 24px', marginBottom:18, color:'white' }}>
        <div style={{ fontSize:10, opacity:.5, fontWeight:700, letterSpacing:2, marginBottom:4 }}>RIDGEVIEW BILLING PORTAL</div>
        <h1 style={{ fontSize:20, fontWeight:800, margin:0 }}>Patients</h1>
        <div style={{ fontSize:12, opacity:.75, marginTop:4 }}>{rows.length} patients in the registry — built automatically from saved collection sheets and ledger analyses</div>
      </div>

      {!sel ? (
        <>
          <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            <input placeholder="Search name, chart #, P-ID, or phone…" value={q} onChange={e=>setQ(e.target.value)}
              style={{ flex:1, minWidth:220, padding:'9px 12px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:13 }}/>
            <select value={office} onChange={e=>setOffice(e.target.value)}
              style={{ padding:'9px 12px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:13, fontWeight:600 }}>
              {OFFICES.map(o=><option key={o}>{o}</option>)}
            </select>
          </div>

          {loading && <div style={{ ...card, textAlign:'center', color:'#94a3b8' }}>Loading registry…</div>}
          {!loading && filtered.length===0 && (
            <div style={{ ...card, textAlign:'center', color:'#94a3b8' }}>
              No patients yet{q?' matching that search':''}. The registry grows automatically every time a collection sheet is saved or a ledger analysis is saved to a profile.
            </div>
          )}
          {filtered.map(p => {
            const prof = profiles[p.patient_name_norm]
            return (
              <div key={p.patient_id} onClick={()=>openPatient(p)}
                style={{ ...card, cursor:'pointer', display:'flex', alignItems:'center', gap:12, flexWrap:'wrap', padding:'12px 16px', marginBottom:8 }}>
                <div style={{ flex:1, minWidth:180 }}>
                  <div style={{ fontSize:14, fontWeight:800, color:'#1e293b' }}>{p.patient_name}</div>
                  <div style={{ fontSize:11, color:'#64748b' }}>
                    {p.chart_number ? 'Chart '+p.chart_number : p.patient_id} · {p.office || '—'}{p.phone ? ' · '+p.phone : ''}
                  </div>
                </div>
                <div style={{ fontSize:11, color:'#64748b' }}>{p.ins_carrier || 'carrier unknown'}</div>
                <div style={{ fontSize:11, color:'#94a3b8' }}>{p.visit_count || 0} visit{(p.visit_count||0)!==1?'s':''}{p.last_seen ? ' · last '+p.last_seen : ''}</div>
                {prof
                  ? <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, background:'#dcfce7', color:GREEN }}>BENEFITS{prof.source_doc_id?' +DOC':''}</span>
                  : <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, background:'#fef3c7', color:AMBER }}>NO PROFILE</span>}
                {prof?.ledger_verdict && (
                  <span style={{ fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, background:'#e0e7ff', color:'#3730a3' }}>
                    LEDGER: {prof.ledger_verdict}{N(prof.ledger_collect_now)>0?' '+USD(prof.ledger_collect_now):''}
                  </span>
                )}
              </div>
            )
          })}
        </>
      ) : (
        <>
          <button onClick={()=>setSel(null)}
            style={{ padding:'7px 14px', borderRadius:8, background:'white', border:'1px solid #e2e8f0', color:'#64748b', fontWeight:700, fontSize:12, cursor:'pointer', marginBottom:14 }}>← All patients</button>

          <div style={card}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:10 }}>
              <div>
                <div style={{ fontSize:18, fontWeight:800, color:'#1e293b' }}>{sel.patient_name}</div>
                <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                  {sel.chart_number ? 'Chart '+sel.chart_number+' · ' : ''}{sel.patient_id} · {sel.office || '—'}
                  {sel.phone ? ' · '+sel.phone : ''} · {sel.ins_carrier || 'carrier unknown'}
                </div>
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                  First seen {sel.first_seen || '—'} · last {sel.last_seen || '—'} · {sel.visit_count || 0} visits
                </div>
              </div>
              {onOpenBenefits && (
                <button onClick={()=>onOpenBenefits(sel)}
                  style={{ padding:'9px 16px', borderRadius:9, background:TEAL, color:'white', border:'none', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  {profiles[sel.patient_name_norm] ? '🛡️ Open Benefit Profile' : '🛡️ Create Benefit Profile'}
                </button>
              )}
            </div>
            {profiles[sel.patient_name_norm] && (
              <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginTop:12, fontSize:12, color:'#475569' }}>
                <span>Ded remaining: <b style={{color:N(profiles[sel.patient_name_norm].deductible_remaining)>0?RED:GREEN}}>{profiles[sel.patient_name_norm].deductible_remaining!=null?USD(profiles[sel.patient_name_norm].deductible_remaining):'?'}</b></span>
                <span>Max remaining: <b>{profiles[sel.patient_name_norm].max_remaining!=null?USD(profiles[sel.patient_name_norm].max_remaining):'?'}</b></span>
                <span>Verified: <b>{profiles[sel.patient_name_norm].verified_at?String(profiles[sel.patient_name_norm].verified_at).slice(0,10):'never'}</b></span>
              </div>
            )}
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:10 }}>Visit history — collection sheets</div>
            {history===null && <div style={{ fontSize:12, color:'#94a3b8' }}>Loading…</div>}
            {history && history.length===0 && <div style={{ fontSize:12, color:'#94a3b8' }}>No saved collection-sheet rows for this patient yet.</div>}
            {history && history.map((h,i)=>(
              <div key={i} style={{ display:'flex', gap:12, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #f8fafc', flexWrap:'wrap' }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#1e293b', minWidth:90 }}>{h.date}</span>
                <span style={{ fontSize:11, color:'#64748b' }}>{h.office}{h.appt_time?' · '+h.appt_time:''}</span>
                <span style={{ fontSize:11, color:BLUE, flex:1 }}>{(h.treatments||[]).map(t=>t.code).filter(Boolean).join(' ')||'—'}</span>
                <span style={{ fontSize:12, fontWeight:700, color:'#1e293b' }}>expected {USD(N(h.total_expected))}</span>
                <span style={{ fontSize:12, fontWeight:700, color:N(h.amount_collected)>=N(h.total_expected)?GREEN:AMBER }}>collected {USD(N(h.amount_collected))}</span>
              </div>
            ))}
          </div>

          <div style={card}>
            <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:10 }}>Ledger workups</div>
            {workups===null && <div style={{ fontSize:12, color:'#94a3b8' }}>Loading…</div>}
            {workups && workups.length===0 && <div style={{ fontSize:12, color:'#94a3b8' }}>No saved ledger analyses for this patient.</div>}
            {workups && workups.map(w=>(
              <div key={w.id} style={{ display:'flex', gap:12, alignItems:'center', padding:'8px 0', borderBottom:'1px solid #f8fafc', flexWrap:'wrap' }}>
                <span style={{ fontSize:12, fontWeight:700, minWidth:90 }}>{String(w.created_at).slice(0,10)}</span>
                <span style={{ fontSize:12, fontWeight:800, color:N(w.balance)>0?RED:TEAL }}>{USD(N(w.balance))}{N(w.balance)<0?' CR':''}</span>
                <span style={{ fontSize:11, color:'#64748b', flex:1 }}>
                  {(w.actions||[]).filter(a=>a.status==='done').length}/{(w.actions||[]).length} actions done
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
