import React, { useState } from 'react'
import { N, USD, repGoal, repProd, repColl } from '../../lib/helpers'

// ── Helpers ────────────────────────────────────────────────────────────────
const pctOf  = (a, b) => (N(b) > 0 ? Math.round(N(a) * 100 / N(b)) : 0)
const kpiCol = (v, good, warn) => v >= good ? '#16a34a' : v >= warn ? '#d97706' : '#dc2626'

// ── Stat row ───────────────────────────────────────────────────────────────
const Row = ({ l, v, bold, color, indent }) => (
  <div style={{ display:'flex', justifyContent:'space-between', padding:'6px 0',
    borderBottom:'1px solid #f8fafc', fontSize:12,
    paddingLeft: indent ? 16 : 0 }}>
    <span style={{ color:'#64748b' }}>{l}</span>
    <span style={{ fontWeight: bold ? 700 : 500, color: color || '#1e293b' }}>{v}</span>
  </div>
)

// ── Mini stat tile ─────────────────────────────────────────────────────────
const Mini = ({ label, value, color }) => (
  <div style={{ background:'#f8fafc', borderRadius:8, padding:'8px 10px', border:'1px solid #f1f5f9' }}>
    <div style={{ fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:3 }}>{label}</div>
    <div style={{ fontSize:15, fontWeight:800, color: color || '#1e293b' }}>{value}</div>
  </div>
)

// ── Tab button ─────────────────────────────────────────────────────────────
const Tab = ({ label, active, onClick, badge }) => (
  <button onClick={onClick}
    style={{ flex:1, padding:'10px 6px', border:'none', background:'none', cursor:'pointer',
      fontSize:11, fontWeight:700, color: active ? '#1d4ed8' : '#94a3b8',
      borderBottom: `2px solid ${active ? '#1d4ed8' : 'transparent'}`,
      transition:'all .12s', position:'relative' }}>
    {label}
    {badge > 0 && (
      <span style={{ marginLeft:4, background:'#dc2626', color:'white', borderRadius:99,
        fontSize:9, fontWeight:800, padding:'1px 5px' }}>{badge}</span>
    )}
  </button>
)

// ── Main ReportCard ────────────────────────────────────────────────────────
function ReportCard({ r, providers, selDate, setSelDate, onEdit }) {
  const [tab, setTab] = useState('production')
  const goal    = repGoal(r, providers)
  const prod    = repProd(r)
  const coll    = repColl(r)
  const open    = selDate === r.id

  // Pre-computed rates
  const achievement = pctOf(prod, goal)
  const collRate    = pctOf(coll, prod)
  const showRate    = pctOf(r.sched?.ptsShowUp, r.sched?.ptsOnSched)
  const schedGoal   = pctOf(r.sched?.schedAmt, goal)
  const prodSched   = pctOf(prod, r.sched?.schedAmt)
  const confRate    = pctOf(r.sched?.ptsConfirmed, r.sched?.ptsOnSched)
  const npShow      = pctOf(r.sched?.npShowed, r.sched?.npOnSched)
  const npConv      = pctOf(r.sched?.npCallsSched, r.sched?.npCalls)
  const prebook     = pctOf(r.sched?.ptsPrebooked, r.sched?.compExamsSeen)
  const predRate    = pctOf(r.sched?.predSubmitted, r.sched?.predGenerated)
  const hygOn       = N(r.sched?.hygPtsOnSched)
  const hygSeen     = N(r.sched?.hygPtsSeen)
  const hygNS       = hygOn > 0 ? (100 - Math.round(hygSeen * 100 / hygOn)) : null
  const hasFd       = r.fd && Object.keys(r.fd).length > 0
  const noShows     = N(r.sched?.noShows)

  return (
    <div style={{ marginBottom:10, borderRadius:14, overflow:'hidden', border:'1px solid #e2e8f0',
      boxShadow: open ? '0 4px 20px rgba(0,0,0,.08)' : '0 1px 3px rgba(0,0,0,.04)' }}>

      {/* ── Collapsed header (always visible) ── */}
      <div onClick={() => { setSelDate(open ? null : r.id); if (!open) setTab('production') }}
        style={{ background:'linear-gradient(135deg,#1e3a5f,#163c5a)', padding:'14px 18px', cursor:'pointer' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ fontSize:13, fontWeight:800, color:'white' }}>{r.office}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.5)' }}>{r.date}</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,.4)' }}>{r.submittedBy}</div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {onEdit && (
              <button onClick={e=>{ e.stopPropagation(); onEdit(r) }}
                style={{ padding:'5px 12px', borderRadius:7, background:'rgba(255,255,255,.15)',
                  border:'1px solid rgba(255,255,255,.25)', color:'white', fontWeight:700,
                  fontSize:11, cursor:'pointer' }}>
                ✏ Edit
              </button>
            )}
            <span style={{ color:'rgba(255,255,255,.5)', fontSize:11 }}>{open ? '▲' : '▼'}</span>
          </div>
        </div>
        {/* KPI strip */}
        <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
          {[
            ['GOAL',        USD(goal),       'white'],
            ['PRODUCTION',  USD(prod),       'white'],
            ['VARIANCE',    (prod>=goal?'+':'')+USD(prod-goal), prod>=goal?'#4ade80':'#f87171'],
            ['ACHIEVEMENT', achievement+'%', kpiCol(achievement,85,70)==='#16a34a'?'#4ade80':kpiCol(achievement,85,70)==='#d97706'?'#fbbf24':'#f87171'],
            ['COLLECTIONS', USD(coll),       'white'],
            ['COLL RATE',   collRate+'%',    collRate>=95?'#4ade80':'#fbbf24'],
            ['SHOW RATE',   showRate+'%',    showRate>=90?'#4ade80':'#fbbf24'],
            ...(noShows>0?[['NO-SHOWS', noShows, '#f87171']]:[]),
          ].map(([l,v,c]) => (
            <div key={l} style={{ textAlign:'center' }}>
              <div style={{ fontSize:9, opacity:.6, color:'white', marginBottom:2 }}>{l}</div>
              <div style={{ fontSize:14, fontWeight:800, color:c }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Expanded: tabbed panel ── */}
      {open && (
        <div>
          {/* Tab bar */}
          <div style={{ display:'flex', background:'white', borderBottom:'1px solid #f1f5f9' }}>
            <Tab label="🩺 Production"  active={tab==='production'}  onClick={()=>setTab('production')}/>
            <Tab label="📅 Schedule"    active={tab==='schedule'}    onClick={()=>setTab('schedule')}
              badge={noShows > 2 ? noShows : 0}/>
            <Tab label="👥 Front Desk"  active={tab==='frontdesk'}   onClick={()=>setTab('frontdesk')}/>
            <Tab label="💰 Collections" active={tab==='collections'} onClick={()=>setTab('collections')}/>
          </div>

          <div style={{ padding:'16px 18px', background:'#f8fafc' }}>

            {/* ── Edit banner ── */}
            {onEdit && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center',
                marginBottom:14, padding:'9px 13px', background:'white', borderRadius:9,
                border:'1px solid #e2e8f0' }}>
                <div style={{ fontSize:11, color:'#94a3b8' }}>
                  {r.office} · {r.date} · Submitted by {r.submittedBy||'—'}
                </div>
                <button onClick={()=>onEdit(r)}
                  style={{ padding:'6px 14px', borderRadius:7, background:'#1d4ed8', color:'white',
                    border:'none', fontWeight:700, fontSize:11, cursor:'pointer' }}>
                  ✏ Edit This Report
                </button>
              </div>
            )}

            {/* ── PRODUCTION TAB ── */}
            {tab==='production' && (
              <div>
                {/* Provider cards */}
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10, marginBottom:14 }}>
                  {(r.providers||[]).filter(p=>p.doctorId).map((p,i) => {
                    const pv  = providers.find(x=>x.id===p.doctorId)
                    const pct = pv?.goal>0 ? Math.round(N(p.netProd)*100/pv.goal) : 0
                    return (
                      <div key={i} style={{ background:'white', borderRadius:10, padding:'12px 14px',
                        border:'1px solid #e2e8f0', borderLeft:`4px solid ${kpiCol(pct,85,70)}` }}>
                        <div style={{ fontSize:12, fontWeight:800, color:'#1e3a5f', marginBottom:8 }}>
                          {p.doctorName||pv?.name}
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
                          <Mini label="GOAL"     value={USD(pv?.goal||0)}/>
                          <Mini label="SCHED"    value={USD(p.openSchedule)}/>
                          <Mini label="ACTUAL"   value={USD(p.netProd)} color={kpiCol(pct,85,70)}/>
                          <Mini label="% GOAL"   value={pct+'%'} color={kpiCol(pct,85,70)}/>
                          <Mini label="PTS SEEN" value={p.ptsSeen||0}/>
                          <Mini label="NP SEEN"  value={p.npSeen||0}/>
                        </div>
                      </div>
                    )
                  })}
                  {(r.hygiene||[]).filter(h=>h.name?.trim()).map((h,i) => {
                    const hygPct = 1200>0 ? Math.round(N(h.netProd)*100/1200) : 0
                    return (
                      <div key={'h'+i} style={{ background:'white', borderRadius:10, padding:'12px 14px',
                        border:'1px solid #e2e8f0', borderLeft:`4px solid ${kpiCol(hygPct,85,70)}` }}>
                        <div style={{ fontSize:12, fontWeight:800, color:'#0d9488', marginBottom:8 }}>
                          {h.name} <span style={{ fontWeight:400, color:'#94a3b8' }}>(Hygiene)</span>
                        </div>
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:6 }}>
                          <Mini label="GOAL"   value="$1,200"/>
                          <Mini label="SCHED"  value={USD(h.openSchedule)}/>
                          <Mini label="ACTUAL" value={USD(h.netProd)} color={kpiCol(hygPct,85,70)}/>
                          <Mini label="% GOAL" value={hygPct+'%'} color={kpiCol(hygPct,85,70)}/>
                          <Mini label="PTS"    value={h.ptsSeen||0}/>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {/* Office totals */}
                <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>OFFICE TOTALS</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))', gap:8 }}>
                    <Mini label="TOTAL GOAL"    value={USD(goal)}/>
                    <Mini label="NET PRODUCTION" value={USD(prod)} color={kpiCol(achievement,85,70)}/>
                    <Mini label="VARIANCE"       value={(prod>=goal?'+':'')+USD(prod-goal)} color={prod>=goal?'#16a34a':'#dc2626'}/>
                    <Mini label="ACHIEVEMENT"    value={achievement+'%'} color={kpiCol(achievement,85,70)}/>
                  </div>
                </div>
                {r.notes && (
                  <div style={{ background:'#fffbeb', borderRadius:9, padding:'10px 13px',
                    border:'1px solid #fef3c7', marginTop:10 }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#92400e', marginBottom:3 }}>NOTES</div>
                    <p style={{ margin:0, fontSize:12, color:'#78350f' }}>{r.notes}</p>
                  </div>
                )}
              </div>
            )}

            {/* ── SCHEDULE TAB ── */}
            {tab==='schedule' && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10 }}>
                {/* Patient flow */}
                <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>PATIENT FLOW</div>
                  <Row l="Pts on Schedule"  v={r.sched?.ptsOnSched||'—'}/>
                  <Row l="Confirmed"        v={r.sched?.ptsConfirmed||'—'}/>
                  <Row l="Confirm Rate"     v={confRate+'%'} bold color={kpiCol(confRate,90,75)}/>
                  <Row l="Pts Showed Up"    v={r.sched?.ptsShowUp||'—'}/>
                  <Row l="Show Rate"        v={showRate+'%'} bold color={kpiCol(showRate,90,80)}/>
                  <Row l="Cancelled"        v={r.sched?.cancelled||'—'} color={N(r.sched?.cancelled)>0?'#d97706':undefined}/>
                  <Row l="No Shows"         v={r.sched?.noShows||'—'} color={noShows>0?'#dc2626':undefined}/>
                  <Row l="Rescheduled"      v={r.sched?.rescheduled||'—'}/>
                </div>
                {/* Schedule capacity */}
                <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>SCHEDULE CAPACITY</div>
                  <Row l="Scheduled Amt"   v={USD(r.sched?.schedAmt)}/>
                  <Row l="Daily Goal"      v={USD(goal)}/>
                  <Row l="Sched / Goal"    v={schedGoal+'%'} bold color={kpiCol(schedGoal,110,95)}/>
                  <Row l="Prod / Sched"    v={prodSched+'%'} bold color={kpiCol(prodSched,95,80)}/>
                </div>
                {/* New patients */}
                <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>NEW PATIENTS</div>
                  <Row l="NP on Schedule"  v={r.sched?.npOnSched||'—'}/>
                  <Row l="NP Showed"       v={r.sched?.npShowed||'—'}/>
                  <Row l="NP Show Rate"    v={npShow+'%'} bold color={kpiCol(npShow,85,70)}/>
                  <Row l="NP Phone Calls"  v={r.sched?.npCalls||'—'}/>
                  <Row l="NP Sched Calls"  v={r.sched?.npCallsSched||'—'}/>
                  <Row l="NP Conversion"   v={npConv+'%'} bold color={kpiCol(npConv,50,30)}/>
                </div>
                {/* Prebooking */}
                <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>PREBOOKING</div>
                  <Row l="Comp Exams Seen"  v={r.sched?.compExamsSeen||'—'}/>
                  <Row l="Pts Booked Next"  v={r.sched?.ptsPrebooked||'—'}/>
                  <Row l="Prebook Rate"     v={prebook+'%'} bold color={kpiCol(prebook,85,70)}/>
                  <Row l="Same Day NP"      v={r.sched?.sameDayNP||'—'}/>
                  <Row l="Same Day Ext"     v={r.sched?.sameDayExt||'—'}/>
                </div>
                {/* Hygiene */}
                {(hygOn > 0 || hygSeen > 0) && (
                  <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>HYGIENE SCHEDULE</div>
                    <Row l="Hyg on Schedule"  v={hygOn||'—'}/>
                    <Row l="Hyg Seen"         v={hygSeen||'—'}/>
                    <Row l="Hyg No-Show"      v={hygNS!==null?hygNS+'%':'—'} bold color={hygNS>10?'#dc2626':undefined}/>
                    <Row l="Pre-Ds Generated" v={r.sched?.predGenerated||'—'}/>
                    <Row l="Pre-Ds Submitted" v={r.sched?.predSubmitted||'—'}/>
                    <Row l="Submission Rate"  v={predRate+'%'} bold color={kpiCol(predRate,90,70)}/>
                  </div>
                )}
              </div>
            )}

            {/* ── FRONT DESK TAB ── */}
            {tab==='frontdesk' && (
              <div>
                {!hasFd ? (
                  <div style={{ textAlign:'center', padding:'30px 0', color:'#94a3b8', fontSize:12 }}>
                    No front desk data for this report
                  </div>
                ) : (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10 }}>
                    {Object.entries(r.fd).map(([name, fd]) => {
                      const npConvFd  = pctOf(fd.callsSched, fd.calls)
                      const recConvFd = pctOf(fd.recallsSched, fd.recalls)
                      const npTxPct   = pctOf(fd.npTxAcc, fd.npTxPres)
                      const exTxPct   = pctOf(fd.exTxAcc, fd.exTxPres)
                      return (
                        <div key={name} style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                          <div style={{ fontSize:12, fontWeight:800, color:'#1e3a5f', marginBottom:8 }}>{name}</div>
                          <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:4 }}>NEW PATIENT CALLS</div>
                          <Row l="NP Calls Made"   v={fd.calls||'—'}/>
                          <Row l="NP Calls Sched"  v={fd.callsSched||'—'}/>
                          <Row l="NP Conversion"   v={npConvFd+'%'} bold color={kpiCol(npConvFd,50,30)}/>
                          <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, margin:'8px 0 4px' }}>RECALLS</div>
                          <Row l="Recalls Made"    v={fd.recalls||'—'}/>
                          <Row l="From Recalls"    v={fd.recallsSched||'—'}/>
                          <Row l="Recall Conv"     v={recConvFd+'%'} bold color={kpiCol(recConvFd,50,30)}/>
                          <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, margin:'8px 0 4px' }}>TX PLANS</div>
                          <Row l="NP TX Presented" v={fd.npTxPres||'—'}/>
                          <Row l="NP TX Accepted"  v={fd.npTxAcc||'—'}/>
                          <Row l="NP TX Rate"      v={npTxPct+'%'} bold color={kpiCol(npTxPct,70,50)}/>
                          <Row l="Ext TX Presented" v={fd.exTxPres||'—'}/>
                          <Row l="Ext TX Accepted"  v={fd.exTxAcc||'—'}/>
                          <Row l="Ext TX Rate"      v={exTxPct+'%'} bold color={kpiCol(exTxPct,70,50)}/>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── COLLECTIONS TAB ── */}
            {tab==='collections' && (
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))', gap:10 }}>
                <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>COLLECTIONS</div>
                  <Row l="Non-Insurance" v={USD(r.coll?.nonIns)}/>
                  <Row l="Insurance"     v={USD(r.coll?.ins)}/>
                  <Row l="Total"         v={USD(coll)} bold/>
                  <Row l="Coll Rate"     v={collRate+'%'} bold color={kpiCol(collRate,95,85)}/>
                  <Row l="vs Goal"       v={Math.round(N(coll)*100/Math.max(goal,1))+'%'} color={kpiCol(Math.round(N(coll)*100/Math.max(goal,1)),95,85)}/>
                </div>
                {r.claims && Object.values(r.claims).some(v=>N(v)>0) && (
                  <div style={{ background:'white', borderRadius:10, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                    <div style={{ fontSize:10, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:8 }}>INSURANCE CLAIMS</div>
                    <Row l="Procedures Sent"  v={r.claims?.sent||'—'}/>
                    <Row l="Submitted"        v={r.claims?.submitted||'—'}/>
                    <Row l="Rejected"         v={r.claims?.rejected||'—'} color={N(r.claims?.rejected)>0?'#dc2626':undefined}/>
                    <Row l="Resolved"         v={r.claims?.resolved||'—'} color={N(r.claims?.resolved)>0?'#16a34a':undefined}/>
                    <Row l="Escalations"      v={r.claims?.escalations||'—'} color={N(r.claims?.escalations)>0?'#d97706':undefined}/>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  )
}

export { ReportCard }
