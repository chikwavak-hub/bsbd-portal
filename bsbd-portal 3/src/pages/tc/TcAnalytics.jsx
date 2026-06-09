import React, { useMemo } from 'react'
import { N, USD, PCT, monthStart } from '../../lib/helpers'

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTHS_EN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthLabel(m) {
  if (!m) return ''
  const [y,mo] = m.split('-')
  return MONTHS_EN[parseInt(mo)-1]+' '+y
}
function pct(a,b) { return b>0 ? Math.round(a/b*100) : 0 }

// ── Pipeline funnel per month ──────────────────────────────────────────────
function buildFunnel(patients) {
  const total       = patients.length
  const txPresented = patients.filter(p => N(p.total_tx_cost) > 0 || p.tx_plan).length
  const txAccepted  = patients.filter(p => p.has_appt==='Yes' || p.appt_1 || N(p.sched_tx_amount)>0).length
  const appt1Done   = patients.filter(p => p.appt_1).length
  const appt2Done   = patients.filter(p => p.appt_2).length
  const hygDone     = patients.filter(p => p.appt_hyg).length
  const completed   = patients.filter(p => N(p.tx_completed) > 0 && N(p.tx_completed) >= N(p.total_tx_cost)*0.9).length

  return { total, txPresented, txAccepted, appt1Done, appt2Done, hygDone, completed }
}

function buildValues(patients) {
  return {
    txValue:    patients.reduce((s,p) => s+N(p.total_tx_cost), 0),
    scheduled:  patients.reduce((s,p) => s+N(p.sched_tx_amount), 0),
    insExpected:patients.reduce((s,p) => s+N(p.ins_expected), 0),
    completed:  patients.reduce((s,p) => s+N(p.tx_completed), 0),
  }
}

// ── Stat card ──────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color='#1e293b', bg='white' }) {
  return (
    <div style={{background:bg,borderRadius:10,padding:'12px 14px',border:'1px solid #e2e8f0'}}>
      <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>{label}</div>
      <div style={{fontSize:20,fontWeight:800,color}}>{value}</div>
      {sub && <div style={{fontSize:10,color:'#94a3b8',marginTop:2}}>{sub}</div>}
    </div>
  )
}

// ── Funnel bar ─────────────────────────────────────────────────────────────
function FunnelBar({ label, count, total, color, pct: p }) {
  const w = total > 0 ? Math.round(count/total*100) : 0
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
        <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{label}</span>
        <span style={{fontSize:12,fontWeight:800,color}}>{count} <span style={{color:'#94a3b8',fontWeight:400}}>({w}%)</span></span>
      </div>
      <div style={{height:6,background:'#f1f5f9',borderRadius:3,overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:3,background:color,width:w+'%',transition:'width .3s'}}/>
      </div>
    </div>
  )
}

// ── Treatment sequence ─────────────────────────────────────────────────────
function TreatmentSequence({ patients }) {
  const sequence = useMemo(() => {
    const visitMap = {}  // visit_num -> { procedures: {code: count} }
    for (const p of patients) {
      const visits = p.visits || p.tx_plan?.visits || []
      for (const v of visits) {
        const vn = v.visit_num || v.visitNum || '?'
        if (!visitMap[vn]) visitMap[vn] = { procs:{}, total:0, ptCount:0 }
        visitMap[vn].ptCount++
        for (const proc of (v.procedures || [])) {
          const key = proc.code+' – '+proc.description
          visitMap[vn].procs[key] = (visitMap[vn].procs[key]||0)+1
          visitMap[vn].total++
        }
      }
    }
    return Object.entries(visitMap)
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([vn, data]) => ({
        visit: vn,
        ptCount: data.ptCount,
        topProcs: Object.entries(data.procs)
          .sort((a,b) => b[1]-a[1])
          .slice(0,5)
      }))
  }, [patients])

  if (sequence.length === 0) return (
    <div style={{textAlign:'center',padding:'20px 0',color:'#94a3b8',fontSize:12}}>
      Attach TX plan PDFs to patient profiles to see treatment sequence data
    </div>
  )

  return (
    <div>
      {sequence.map(v => (
        <div key={v.visit} style={{marginBottom:12,background:'#f8fafc',borderRadius:10,padding:'10px 12px'}}>
          <div style={{fontSize:11,fontWeight:800,color:'#1e3a5f',marginBottom:6}}>
            Visit {v.visit} · {v.ptCount} patient{v.ptCount!==1?'s':''}
          </div>
          {v.topProcs.map(([proc, count]) => (
            <div key={proc} style={{display:'flex',justifyContent:'space-between',
              padding:'3px 0',borderBottom:'1px solid #e2e8f0',fontSize:11}}>
              <span style={{color:'#475569'}}>{proc}</span>
              <span style={{fontWeight:700,color:'#1d4ed8'}}>{count}x</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── TC Performance table ───────────────────────────────────────────────────
function TcPerformance({ patients }) {
  const tcStats = useMemo(() => {
    const map = {}
    for (const p of patients) {
      const tc = p.who_tx_plan || p.assigned_tc_name || 'Unknown'
      if (!map[tc]) map[tc] = { tc, total:0, appt:0, txValue:0, scheduled:0, completed:0, noAppt:0, finance:0 }
      map[tc].total++
      if (p.has_appt==='Yes'||p.appt_1) map[tc].appt++
      else map[tc].noAppt++
      if (p.finance_stalled) map[tc].finance++
      map[tc].txValue    += N(p.total_tx_cost)
      map[tc].scheduled  += N(p.sched_tx_amount)
      map[tc].completed  += N(p.tx_completed)
    }
    return Object.values(map).sort((a,b) => b.total-a.total)
  }, [patients])

  if (tcStats.length === 0) return null

  return (
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{background:'#1e293b'}}>
            {['TC','Patients','Appt%','No Appt','Finance Stall','TX Value','Scheduled','Completed','Conv Rate'].map(h=>(
              <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:800,
                color:'rgba(255,255,255,.7)',letterSpacing:.5,whiteSpace:'nowrap'}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tcStats.map((s,i) => {
            const apptPct  = pct(s.appt, s.total)
            const convRate = s.txValue>0 ? pct(s.scheduled, s.txValue) : 0
            return (
              <tr key={s.tc} style={{borderBottom:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                <td style={{padding:'9px 10px',fontWeight:700,color:'#1e293b'}}>{s.tc}</td>
                <td style={{padding:'9px 10px',textAlign:'center'}}>{s.total}</td>
                <td style={{padding:'9px 10px',textAlign:'center'}}>
                  <span style={{fontWeight:700,color:apptPct>=70?'#16a34a':apptPct>=50?'#d97706':'#dc2626'}}>
                    {apptPct}%
                  </span>
                </td>
                <td style={{padding:'9px 10px',textAlign:'center',color:s.noAppt>0?'#dc2626':'#94a3b8',fontWeight:s.noAppt>0?700:400}}>{s.noAppt||'—'}</td>
                <td style={{padding:'9px 10px',textAlign:'center',color:s.finance>0?'#7c3aed':'#94a3b8',fontWeight:s.finance>0?700:400}}>{s.finance||'—'}</td>
                <td style={{padding:'9px 10px',textAlign:'right',color:'#1d4ed8',fontWeight:600}}>{s.txValue?'$'+Math.round(s.txValue).toLocaleString():'—'}</td>
                <td style={{padding:'9px 10px',textAlign:'right',color:'#0d9488',fontWeight:600}}>{s.scheduled?'$'+Math.round(s.scheduled).toLocaleString():'—'}</td>
                <td style={{padding:'9px 10px',textAlign:'right',color:'#16a34a',fontWeight:600}}>{s.completed?'$'+Math.round(s.completed).toLocaleString():'—'}</td>
                <td style={{padding:'9px 10px',textAlign:'center'}}>
                  <span style={{fontWeight:700,color:convRate>=70?'#16a34a':convRate>=50?'#d97706':'#dc2626'}}>
                    {convRate>0?convRate+'%':'—'}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
        {tcStats.length > 1 && (
          <tfoot>
            <tr style={{background:'#1e293b',borderTop:'2px solid #334155'}}>
              <td style={{padding:'8px 10px',fontWeight:800,color:'white',fontSize:11}}>TOTALS</td>
              <td style={{padding:'8px 10px',textAlign:'center',fontWeight:800,color:'white'}}>{tcStats.reduce((s,r)=>s+r.total,0)}</td>
              <td style={{padding:'8px 10px',textAlign:'center',fontWeight:800,color:'white'}}>
                {pct(tcStats.reduce((s,r)=>s+r.appt,0), tcStats.reduce((s,r)=>s+r.total,0))}%
              </td>
              <td style={{padding:'8px 10px',textAlign:'center',color:'#fca5a5',fontWeight:700}}>{tcStats.reduce((s,r)=>s+r.noAppt,0)||'—'}</td>
              <td style={{padding:'8px 10px',textAlign:'center',color:'#c4b5fd',fontWeight:700}}>{tcStats.reduce((s,r)=>s+r.finance,0)||'—'}</td>
              <td style={{padding:'8px 10px',textAlign:'right',color:'#93c5fd',fontWeight:800}}>${Math.round(tcStats.reduce((s,r)=>s+r.txValue,0)).toLocaleString()}</td>
              <td style={{padding:'8px 10px',textAlign:'right',color:'#6ee7b7',fontWeight:800}}>${Math.round(tcStats.reduce((s,r)=>s+r.scheduled,0)).toLocaleString()}</td>
              <td style={{padding:'8px 10px',textAlign:'right',color:'#86efac',fontWeight:800}}>${Math.round(tcStats.reduce((s,r)=>s+r.completed,0)).toLocaleString()}</td>
              <td/>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ── Main analytics component ───────────────────────────────────────────────
export default function TcAnalytics({ patients, activeMonth }) {

  const filtered = useMemo(() =>
    activeMonth==='all' ? patients : patients.filter(p=>(p.month_tab||p.dos?.slice(0,7))===activeMonth)
  , [patients, activeMonth])

  const months = useMemo(() => {
    const ms = [...new Set(patients.map(p=>p.month_tab||p.dos?.slice(0,7)).filter(Boolean))]
    return ms.sort().reverse()
  }, [patients])

  const funnel = buildFunnel(filtered)
  const values = buildValues(filtered)
  const potential = values.txValue - values.completed
  const schedPct  = values.txValue>0 ? pct(values.scheduled, values.txValue) : 0
  const compPct   = values.txValue>0 ? pct(values.completed, values.txValue) : 0

  return (
    <div style={{padding:'0 24px 60px'}}>

      {/* Value summary */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:20}}>
        <Stat label="TOTAL TX VALUE"      value={'$'+Math.round(values.txValue).toLocaleString()}    color="#1d4ed8"/>
        <Stat label="SCHEDULED ($)"       value={'$'+Math.round(values.scheduled).toLocaleString()}  color="#0d9488" sub={schedPct+'% of TX value'}/>
        <Stat label="INSURANCE EXPECTED"  value={'$'+Math.round(values.insExpected).toLocaleString()}color="#64748b"/>
        <Stat label="COMPLETED ($)"       value={'$'+Math.round(values.completed).toLocaleString()}  color="#16a34a" sub={compPct+'% of TX value'}/>
        <Stat label="POTENTIAL REMAINING" value={'$'+Math.round(potential).toLocaleString()}          color="#d97706" sub="TX value not yet completed"/>
        <Stat label="TOTAL PATIENTS"      value={funnel.total}                                        color="#1e293b"/>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>

        {/* Patient pipeline funnel */}
        <div style={{background:'white',borderRadius:12,padding:16,border:'1px solid #e2e8f0'}}>
          <div style={{fontSize:11,fontWeight:800,color:'#1e293b',marginBottom:14}}>
            PATIENT PIPELINE — {activeMonth==='all'?'ALL TIME':monthLabel(activeMonth)}
          </div>
          <FunnelBar label="Examined / On Log"   count={funnel.total}       total={funnel.total} color="#1d4ed8"/>
          <FunnelBar label="TX Plan Presented"   count={funnel.txPresented} total={funnel.total} color="#7c3aed"/>
          <FunnelBar label="Appt Scheduled"      count={funnel.txAccepted}  total={funnel.total} color="#0d9488"/>
          <FunnelBar label="1st Appt Done"       count={funnel.appt1Done}   total={funnel.total} color="#16a34a"/>
          <FunnelBar label="2nd Appt Done"       count={funnel.appt2Done}   total={funnel.total} color="#65a30d"/>
          <FunnelBar label="Hygiene Appt Done"   count={funnel.hygDone}     total={funnel.total} color="#0891b2"/>
          <FunnelBar label="TX Completed (≥90%)" count={funnel.completed}   total={funnel.total} color="#15803d"/>
        </div>

        {/* Month-by-month comparison */}
        <div style={{background:'white',borderRadius:12,padding:16,border:'1px solid #e2e8f0'}}>
          <div style={{fontSize:11,fontWeight:800,color:'#1e293b',marginBottom:14}}>MONTH-BY-MONTH</div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
            <thead>
              <tr style={{background:'#f8fafc'}}>
                {['Month','Pts','Appt%','TX Value','Sched','Done'].map(h=>(
                  <th key={h} style={{padding:'6px 8px',textAlign:'left',fontSize:9,fontWeight:800,color:'#64748b',letterSpacing:.5}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {months.map(m => {
                const mPts = patients.filter(p=>(p.month_tab||p.dos?.slice(0,7))===m)
                const mF   = buildFunnel(mPts)
                const mV   = buildValues(mPts)
                return (
                  <tr key={m} style={{borderTop:'1px solid #f1f5f9',background:m===activeMonth?'#eff6ff':'white'}}>
                    <td style={{padding:'6px 8px',fontWeight:600,color:'#1e293b'}}>{monthLabel(m)}</td>
                    <td style={{padding:'6px 8px',textAlign:'center'}}>{mF.total}</td>
                    <td style={{padding:'6px 8px',textAlign:'center'}}>
                      <span style={{fontWeight:700,color:pct(mF.txAccepted,mF.total)>=60?'#16a34a':'#d97706'}}>
                        {pct(mF.txAccepted,mF.total)}%
                      </span>
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'right',color:'#1d4ed8',fontWeight:600}}>
                      {mV.txValue?'$'+Math.round(mV.txValue/1000)+'k':'—'}
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'right',color:'#0d9488',fontWeight:600}}>
                      {mV.scheduled?'$'+Math.round(mV.scheduled/1000)+'k':'—'}
                    </td>
                    <td style={{padding:'6px 8px',textAlign:'right',color:'#16a34a',fontWeight:600}}>
                      {mV.completed?'$'+Math.round(mV.completed/1000)+'k':'—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* TC Performance */}
      <div style={{background:'white',borderRadius:12,padding:16,border:'1px solid #e2e8f0',marginBottom:16}}>
        <div style={{fontSize:11,fontWeight:800,color:'#1e293b',marginBottom:12}}>TC PERFORMANCE</div>
        <TcPerformance patients={filtered}/>
      </div>

      {/* Treatment sequence */}
      <div style={{background:'white',borderRadius:12,padding:16,border:'1px solid #e2e8f0'}}>
        <div style={{fontSize:11,fontWeight:800,color:'#1e293b',marginBottom:4}}>TREATMENT SEQUENCE</div>
        <div style={{fontSize:11,color:'#94a3b8',marginBottom:12}}>
          Most common procedures per visit across all attached TX plans
        </div>
        <TreatmentSequence patients={filtered}/>
      </div>
    </div>
  )
}
