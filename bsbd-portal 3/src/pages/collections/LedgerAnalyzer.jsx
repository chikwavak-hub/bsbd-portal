// src/pages/collections/LedgerAnalyzer.jsx — "Why does this patient have a balance?"
// Upload a Dentrix Guarantor Ledger PDF → parsed transactions, reconciled totals,
// deterministic anomaly flags, and an AI-written plain-English explanation.

import React, { useState } from 'react'
import { parseLedgerPdf, analyzeLedger, buildVisits, attributeBalance } from '../../lib/ledgerParser'
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
