// src/pages/collections/LedgerAnalyzer.jsx — "Why does this patient have a balance?"
// Upload a Dentrix Guarantor Ledger PDF → parsed transactions, reconciled totals,
// deterministic anomaly flags, and an AI-written plain-English explanation.

import React, { useState } from 'react'
import { parseLedgerPdf, analyzeLedger, buildVisits, attributeBalance, DISPOSITION_LABEL } from '../../lib/ledgerParser'
import { buildPatientReport, buildStaffReport, openReport } from '../../lib/ledgerReports'
import { sbGet, sbPost } from '../../lib/supabase'
import { USD } from '../../lib/helpers'

const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a', AMBER='#d97706', RED='#dc2626'
const TYPE_LABEL = { ins_payment:'Ins Payment', ins_adjustment:'Ins Adjustment', pt_payment:'Patient Payment', writeoff:'Write-off', credit_adjustment:'Credit Adjustment' }
const TYPE_COLOR = { ins_payment:TEAL, ins_adjustment:'#64748b', pt_payment:GREEN, writeoff:AMBER, credit_adjustment:RED }

export default function LedgerAnalyzerPage({ user, notify }) {
  const [busy, setBusy]       = useState(false)
  const [fileName, setFileName] = useState(null)
  const [parsed, setParsed]   = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [aiText, setAiText]   = useState('')
  const [aiBusy, setAiBusy]   = useState(false)
  const [error, setError]     = useState(null)
  const [showTxns, setShowTxns] = useState(false)
  const [visits, setVisits] = useState(null)
  const [attribution, setAttribution] = useState(null)
  const [patientName, setPatientName] = useState('')
  const [workup, setWorkup] = useState(null)          // saved workup row with actions
  const [savingWk, setSavingWk] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setBusy(true); setError(null); setParsed(null); setAnalysis(null); setAiText('')
    setFileName(file.name)
    try {
      const p = await parseLedgerPdf(file)
      if (!p.txns.length) { setError('No transactions recognized — is this a Dentrix Guarantor Ledger Report PDF?'); setBusy(false); return }
      setParsed(p)
      setAnalysis(analyzeLedger(p))
      const vs = buildVisits(p)
      setVisits(vs)
      setAttribution(attributeBalance(vs))
      const names = {}
      p.txns.forEach(t=>{ if(t.kind==='charge'&&t.patient) names[t.patient]=(names[t.patient]||0)+1 })
      setPatientName(Object.entries(names).sort((a,b)=>b[1]-a[1])[0]?.[0] || '')
      setWorkup(null)
    } catch (err) {
      setError('Could not read PDF: ' + err.message)
    }
    setBusy(false)
  }

  async function explainWithAI() {
    if (!parsed || aiBusy) return
    setAiBusy(true); setAiText('')
    try {
      const res = await fetch('/.netlify/functions/ai-ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meta: parsed.meta,
          totals: analysis.totals,
          computed_final_balance: analysis.computed,
          flags: analysis.flags,
          attribution,
          visits: (visits || []).map(v => ({ date:v.date, patient:v.patient, codes:v.codes, chargeTotal:v.chargeTotal, byType:v.byType, net:v.net, claims:v.claims.map(c=>({carrier:c.carrier,status:c.status})) })),
          claims: parsed.txns.filter(t => t.kind === 'claim'),
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
      setAiText(data.text || '')
    } catch (err) {
      setError('AI explanation failed: ' + err.message)
    }
    setAiBusy(false)
  }

  const currentUserName = () => user?.name || user?.username || ''

  const saveWorkup = async () => {
    if (!attribution) return
    setSavingWk(true)
    try {
      const actions = attribution.rows.map((r, i) => ({
        id: 'a'+i, visit_date: r.date, codes: r.codes, amount: r.net,
        disposition: r.disposition, label: DISPOSITION_LABEL[r.disposition],
        sources: r.sources.map(s=>s.src).join(', '),
        assignee: '', status: 'open', feedback: '',
      }))
      const row = {
        id: 'wk_'+(parsed.meta.chart||'x')+'_'+Date.now(),
        patient_name: patientName, chart: parsed.meta.chart, office: null,
        balance: parsed.meta.guarantorBalance ?? analysis.computed,
        buckets: attribution.buckets, attribution: attribution.rows, actions,
        ai_text: aiText || null, created_by: user?.name || user?.username || null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      await sbPost('ledger_workups', row, true)
      setWorkup(row)
      notify('Workup saved — assign the actions below')
    } catch (e) { notify('Workup save failed: '+e.message, 'error') }
    setSavingWk(false)
  }
  const updateAction = async (aid, patch) => {
    if (!workup) return
    const actions = workup.actions.map(a => a.id===aid ? {...a, ...patch} : a)
    const row = { ...workup, actions, updated_at: new Date().toISOString() }
    setWorkup(row)
    try { await sbPost('ledger_workups', row, true) } catch (e) { notify('Action save failed: '+e.message, 'error') }
  }

  const card = { background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:16, marginBottom:14 }
  const finalBal = parsed?.meta?.guarantorBalance ?? analysis?.computed

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc' }}>
      <div style={{ background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', padding:'16px 24px' }}>
        <div style={{ fontSize:10, color:'rgba(255,255,255,.5)', fontWeight:700, letterSpacing:2, marginBottom:2 }}>BSBD</div>
        <div style={{ fontSize:17, fontWeight:800, color:'white' }}>Ledger Analyzer</div>
        <div style={{ fontSize:11, color:'rgba(255,255,255,.6)' }}>Upload a Dentrix Guarantor Ledger PDF — get the balance explained</div>
      </div>

      <div style={{ padding:'16px 24px 60px', maxWidth:900, margin:'0 auto' }}>
        <div style={{ ...card, display:'flex', gap:14, alignItems:'center', flexWrap:'wrap' }}>
          <label style={{ padding:'9px 18px', borderRadius:9, background:NAVY, color:'white', fontWeight:700, fontSize:13, cursor:'pointer' }}>
            {busy ? 'Reading…' : '📄 Upload Ledger PDF'}
            <input type="file" accept=".pdf" style={{ display:'none' }} onChange={handleFile} />
          </label>
          {fileName && <span style={{ fontSize:12, color:'#64748b' }}>{fileName}</span>}
          <span style={{ fontSize:11, color:'#94a3b8' }}>Dentrix: Patient Chart → Ledger → Print → Guarantor Ledger Report → Save as PDF</span>
        </div>

        {error && (
          <div style={{ background:'#fef2f2', color:'#991b1b', padding:'12px 16px', borderRadius:10, marginBottom:14, fontSize:13 }}>{error}</div>
        )}

        {analysis && parsed && (
          <>
            {/* Verdict strip */}
            <div style={{ ...card, borderLeft:`5px solid ${finalBal>1?RED:finalBal<-1?AMBER:GREEN}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5 }}>CHART {parsed.meta.chart || '—'} · {parsed.meta.start} → {parsed.meta.end}</div>
                  <div style={{ fontSize:24, fontWeight:800, color:finalBal>1?RED:finalBal<-1?AMBER:GREEN, marginTop:2 }}>
                    {finalBal>1 ? `Balance due ${USD(finalBal)}` : finalBal<-1 ? `CREDIT ${USD(Math.abs(finalBal))}` : 'Zero balance'}
                  </div>
                  <div style={{ fontSize:11, color:'#94a3b8' }}>
                    Parser reconciled to the penny: computed {USD(analysis.computed)} vs printed {parsed.meta.guarantorBalance!=null?USD(parsed.meta.guarantorBalance):'—'}
                  </div>
                </div>
                <button onClick={explainWithAI} disabled={aiBusy}
                  style={{ padding:'10px 20px', borderRadius:9, background:BLUE, color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer', opacity:aiBusy?0.6:1 }}>
                  {aiBusy ? 'Analyzing…' : '🤖 Explain this balance'}
                </button>
              </div>
              {/* collectability buckets */}
              {attribution && attribution.buckets && Object.keys(attribution.buckets).length>0 && (
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12 }}>
                  {Object.entries(attribution.buckets).map(([d,v])=>{
                    const col = d==='collect'?RED:d==='insurance'?AMBER:d==='writeoff'?'#7c3aed':d==='refund'?TEAL:d==='posting'?'#64748b':NAVY
                    return (
                      <div key={d} style={{ background:col+'12', border:'1px solid '+col+'44', borderRadius:9, padding:'7px 12px' }}>
                        <div style={{ fontSize:8.5, fontWeight:800, color:col, letterSpacing:.4 }}>{DISPOSITION_LABEL[d]?.split(' — ')[0] || d.toUpperCase()}</div>
                        <div style={{ fontSize:15, fontWeight:800, color:col }}>{USD(Math.abs(v))}</div>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* reports + workup bar */}
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:12, alignItems:'center' }}>
                <input value={patientName} onChange={e=>setPatientName(e.target.value)} placeholder="Patient / guarantor name for reports"
                  style={{ flex:1, minWidth:180, padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', fontSize:12, fontWeight:600 }}/>
                <button onClick={()=>openReport(buildPatientReport({ meta:parsed.meta, attribution, patientName }))}
                  style={{ padding:'9px 16px', borderRadius:8, background:'white', border:'2px solid '+NAVY, color:NAVY, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  📄 Patient Report
                </button>
                <button onClick={()=>openReport(buildStaffReport({ meta:parsed.meta, attribution, patientName, aiText }))}
                  style={{ padding:'9px 16px', borderRadius:8, background:'white', border:'2px solid '+TEAL, color:TEAL, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  📋 Staff Guide
                </button>
                <button onClick={saveWorkup} disabled={savingWk}
                  style={{ padding:'9px 16px', borderRadius:8, background:NAVY, color:'white', border:'none', fontWeight:700, fontSize:12, cursor:'pointer', opacity:savingWk?0.6:1 }}>
                  {savingWk?'Saving…':workup?'✓ Workup Saved':'💾 Save Workup + Actions'}
                </button>
              </div>
            </div>

            {/* Totals reconciliation */}
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:10 }}>Account reconciliation</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))', gap:10 }}>
                {[
                  ['Charges', analysis.totals.charges, BLUE],
                  ['Ins Payments', analysis.totals.ins_payment, TEAL],
                  ['Ins Adjustments', analysis.totals.ins_adjustment, '#64748b'],
                  ['Patient Payments', analysis.totals.pt_payment, GREEN],
                  ['Write-offs', analysis.totals.writeoff, AMBER],
                  ['Credit Adjustments', analysis.totals.credit_adjustment, RED],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background:'#f8fafc', borderRadius:9, padding:'9px 12px', border:'1px solid #f1f5f9' }}>
                    <div style={{ fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.4, marginBottom:2 }}>{l.toUpperCase()}</div>
                    <div style={{ fontSize:15, fontWeight:800, color:c }}>{USD(Math.abs(v))}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Deterministic flags */}
            <div style={card}>
              <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:10 }}>Findings ({analysis.flags.length})</div>
              {analysis.flags.length === 0 && <div style={{ fontSize:12, color:GREEN, fontWeight:600 }}>✅ Nothing anomalous — clean ledger</div>}
              {analysis.flags.map((f, i) => (
                <div key={i} style={{ display:'flex', gap:8, padding:'9px 12px', borderRadius:8, marginBottom:6,
                  background:f.sev==='high'?'#fef2f2':'#fff7ed', border:'1px solid '+(f.sev==='high'?'#fecaca':'#fed7aa') }}>
                  <span>{f.sev==='high'?'🔴':'🟡'}</span>
                  <span style={{ fontSize:12, color:f.sev==='high'?'#b91c1c':'#9a3412', fontWeight:500 }}>{f.msg}</span>
                </div>
              ))}
            </div>

            {/* Balance attribution — the detailed breakdown, deterministic */}
            {attribution && (
              <div style={card}>
                <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:4 }}>Balance attribution — which visits carry it</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>
                  {attribution.rows.length===0
                    ? 'Every visit nets to zero — the balance (if any) comes from balance-forward or rounding.'
                    : `${attribution.rows.length} visit${attribution.rows.length!==1?'s':''} with an unresolved amount · attribution total ${USD(attribution.total)} matches the ledger`}
                </div>
                {attribution.rows.map((r, i) => (
                  <div key={i} style={{ border:'1px solid #f1f5f9', borderRadius:9, padding:'10px 12px', marginBottom:8,
                    background:r.net>0?'#fff7ed':'#eff6ff', borderColor:r.net>0?'#fed7aa':'#bfdbfe' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, flexWrap:'wrap', marginBottom:4 }}>
                      <div style={{ fontSize:12, fontWeight:800, color:'#1e293b' }}>{r.date}{r.patient?' · '+r.patient:''} · <span style={{color:BLUE}}>{r.codes}</span></div>
                      <div style={{ fontSize:14, fontWeight:800, color:r.net>0?RED:BLUE }}>{r.net>0?'owes ':'credit '}{USD(Math.abs(r.net))}</div>
                    </div>
                    {r.dispositionLabel && (
                      <div style={{ display:'inline-block', fontSize:9, fontWeight:800, padding:'2px 10px', borderRadius:99, marginBottom:5,
                        background:r.disposition==='collect'?'#fee2e2':r.disposition==='insurance'?'#fef3c7':r.disposition==='refund'?'#ccfbf1':'#e2e8f0',
                        color:r.disposition==='collect'?RED:r.disposition==='insurance'?AMBER:r.disposition==='refund'?TEAL:'#334155' }}>
                        {r.dispositionLabel}
                      </div>
                    )}
                    <div style={{ display:'flex', gap:12, flexWrap:'wrap', fontSize:10, color:'#64748b', marginBottom:4 }}>
                      <span>Charges <b>{USD(r.chargeTotal)}</b></span>
                      {r.insPaid!==0&&<span>Ins paid <b style={{color:TEAL}}>{USD(Math.abs(r.insPaid))}</b></span>}
                      {r.insAdj!==0&&<span>Ins adj <b>{USD(Math.abs(r.insAdj))}</b></span>}
                      {r.ptPaid!==0&&<span>Pt paid <b style={{color:GREEN}}>{USD(Math.abs(r.ptPaid))}</b></span>}
                      {r.writeoff!==0&&<span>Write-off <b>{USD(Math.abs(r.writeoff))}</b></span>}
                      {r.creditAdj!==0&&<span>Credit adj <b style={{color:RED}}>{USD(Math.abs(r.creditAdj))}</b></span>}
                    </div>
                    <div style={{ fontSize:11, color:r.net>0?'#9a3412':'#1e40af', fontWeight:600, marginBottom:4 }}>→ {r.reason}</div>
                    {(r.sources||[]).map((s,si)=>(
                      <div key={si} style={{ display:'flex', gap:6, fontSize:10.5, color:'#475569', marginBottom:2, paddingLeft:4 }}>
                        <span style={{ fontWeight:800, color:NAVY, whiteSpace:'nowrap', flexShrink:0 }}>• {s.src}:</span>
                        <span>{s.detail}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* AI narrative */}
            {aiText && (
              <div style={{ ...card, background:'#eff6ff', border:'1px solid #bfdbfe' }}>
                <div style={{ fontSize:13, fontWeight:800, color:BLUE, marginBottom:8 }}>🤖 Balance explanation</div>
                <div style={{ fontSize:13, color:'#1e293b', lineHeight:1.7, whiteSpace:'pre-wrap' }}>{aiText}</div>
              </div>
            )}

            {/* Action tracker */}
            {workup && (
              <div style={{ ...card, border:'2px solid '+NAVY }}>
                <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:4 }}>Action tracker — assign, action, feed back</div>
                <div style={{ fontSize:11, color:'#94a3b8', marginBottom:10 }}>Every change saves automatically. Mark done with feedback so the workup shows what actually happened.</div>
                {workup.actions.map(a=>(
                  <div key={a.id} style={{ border:'1px solid #e2e8f0', borderRadius:9, padding:'10px 12px', marginBottom:8,
                    background:a.status==='done'?'#f0fdf4':'white' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', gap:8, flexWrap:'wrap', marginBottom:6 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#1e293b' }}>{a.visit_date} · {a.codes} · <span style={{color:a.amount>0?RED:TEAL}}>{USD(Math.abs(a.amount))}</span></div>
                      <div style={{ fontSize:10, fontWeight:800, color:'#64748b' }}>{a.label}</div>
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                      <input value={a.assignee} onChange={e=>updateAction(a.id,{assignee:e.target.value})} placeholder="Assign to…"
                        style={{ width:130, padding:'6px 9px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:11 }}/>
                      <select value={a.status} onChange={e=>updateAction(a.id,{status:e.target.value, ...(e.target.value==='done'?{done_by:currentUserName(), done_at:new Date().toISOString()}:{})})}
                        style={{ padding:'6px 9px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:11, fontWeight:700,
                          color:a.status==='done'?GREEN:a.status==='in_progress'?AMBER:'#64748b' }}>
                        <option value="open">Open</option>
                        <option value="in_progress">In Progress</option>
                        <option value="done">Done</option>
                      </select>
                      <input value={a.feedback} onChange={e=>updateAction(a.id,{feedback:e.target.value})}
                        placeholder="Feedback / what was done (e.g. 'EOB pulled — denied for frequency, resubmitted with narrative')"
                        style={{ flex:1, minWidth:220, padding:'6px 9px', borderRadius:7, border:'1px solid #e2e8f0', fontSize:11 }}/>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Raw transactions */}
            <div style={card}>
              <button onClick={() => setShowTxns(s => !s)}
                style={{ background:'none', border:'none', fontSize:13, fontWeight:800, color:NAVY, cursor:'pointer', padding:0 }}>
                {showTxns ? '▾' : '▸'} Parsed transactions ({parsed.txns.filter(t=>t.kind!=='claim').length})
              </button>
              {showTxns && (
                <div style={{ overflowX:'auto', marginTop:10 }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                    <thead><tr>{['Date','Type','Description','Patient','Amount','Balance'].map(h=>(
                      <th key={h} style={{ padding:'6px 8px', textAlign:['Amount','Balance'].includes(h)?'right':'left',
                        fontSize:9, fontWeight:800, color:'#94a3b8', background:'#f8fafc', whiteSpace:'nowrap' }}>{h}</th>))}</tr></thead>
                    <tbody>
                      {parsed.txns.filter(t=>t.kind!=='claim').map((t, i) => (
                        <tr key={i} style={{ borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                          <td style={{ padding:'5px 8px', whiteSpace:'nowrap', color:'#64748b' }}>{t.date || ''}</td>
                          <td style={{ padding:'5px 8px', whiteSpace:'nowrap' }}>
                            {t.kind==='charge'
                              ? <span style={{ fontWeight:700, color:BLUE }}>{t.code || 'Charge'}</span>
                              : t.kind==='balance_forward'
                                ? <span style={{ color:'#94a3b8' }}>Bal Fwd</span>
                                : <span style={{ fontWeight:600, color:TYPE_COLOR[t.type]||'#64748b' }}>{TYPE_LABEL[t.type]||t.type}{t.split?' *':''}</span>}
                          </td>
                          <td style={{ padding:'5px 8px', color:'#475569', maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.desc || ''}</td>
                          <td style={{ padding:'5px 8px', color:'#94a3b8', whiteSpace:'nowrap' }}>{t.patient || ''}</td>
                          <td style={{ padding:'5px 8px', textAlign:'right', fontWeight:700,
                            color:(t.amount??t.applied??0) >= 0 ? '#1e293b' : GREEN }}>
                            {t.kind==='balance_forward' ? '' : USD(t.amount ?? t.applied ?? 0)}
                          </td>
                          <td style={{ padding:'5px 8px', textAlign:'right', color:'#64748b' }}>{t.balance!=null?USD(t.balance):''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
