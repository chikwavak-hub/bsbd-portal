import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { exportMonthlyExcel } from '../../lib/monthlyExcelExport'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function exportDashboardCSV(reports, providers, filename) {
  const N  = v => Number(v)||0
  const pct = (a,b) => b>0 ? Math.round(a/b*100)+'%' : '0%'
  const usd = v => v ? '$'+N(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '$0.00'
  const esc = v => { const s = String(v==null?'':v); return s.includes(',')||s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s }

  // Header rows matching the template exactly
  const h1 = ['OFFICE DETAILS','','','','PRODUCTION','','','','','SCHEDULE','SCHD CAPACITY','SCH UTILIZATION','','COLLECTIONS','','','','','PATIENT FLOW','','','','','NEW PATIENTS','','','','','TREATMENT PLANS','','','','','','','PREDETERMINATIONS','','','','CALL HANDLING','','','','PREBOOKING','','','','CONFIRMATIONS','','','','RECARE/HYGIENE','','']
  const h2 = [
    'DATE','OFFICE','MANAGER','',
    'GOAL','PRODUCTION','VARIANCE','%AGE(-kpi 85%)','',
    'SCHD AMT','SCHD/GOAL-Kpi 110%','ACTUAL/SCHD PRD-Kpi 95%','',
    'GOAL','COLLECTIONS','VARIANCE','%AGE-(kpi-95%)','',
    'SCHEDULED PTS','PATIENTS SEEN','CANCELLED','SHOW RATE-kpi(90%)','',
    'NP SCHDL GOAL','NP SCHEDULED','NP SEEN','NP SHOW RATE-(kpi 85%)','',
    '#OF TPS PRESENTED-NP','#OF TPS PRESENTED-Ext P','#OF TPS ACCEPTED-NP','#OF TPS ACCEPTED-Ext Pts','CASE ACTP-NP-(kpi 85%)','CASE ACTP-EXT Pts(kpi 90%)','',
    '#Of PreDs Generated','#Of PreDs Submitted','PreD Submission Rate-(kpi 100%)','',
    '# OF RECEIVED CALLS-EXTERNAL','# OF RECEIVED CALLS-INTERNAL','MISSED CALL RATE-(kpi <10%)','',
    '# NP + Ext P COMP EXAM SEEN','# OF PTS BOOK-Next App','Prebook Rate-KPI > 95%','',
    '#Of Pts on Schd','# Of Pts Confirmed','Confirmation Rate-KPI-97%','',
    '# Of Hyg Pts on Schd','#Of Hyg Pts seen for the week','Hyg Pts No Show Rate-KPI <8%',
  ]

  const rows = [h1, h2]

  for (const rep of [...reports].sort((a,b) => b.date.localeCompare(a.date))) {
    // Provider goal — use same logic as repGoal (doctorId selected = counts toward goal)
    const offProviders = providers.filter(p => p.office === rep.office)
    const numDrs = offProviders.filter(p => !p.name?.toLowerCase().includes('hyg')).length || 1
    const goal = repGoal(rep, providers)

    // Production
    const prod = offProviders.reduce((s,p) => {
      const rp = (rep.providers||[]).find(x => x.doctorId===p.id)
      return s + N(rp?.netProd||rp?.openingBalance||0)
    }, 0) + (rep.hygiene||[]).reduce((s,h) => s+N(h.netProd),0)

    // Collections
    const coll = N(rep.coll?.ins) + N(rep.coll?.nonIns)

    // Patient flow
    const scheduled = N(rep.sched?.ptsOnSched)
    const seen      = N(rep.sched?.ptsShowUp)
    const cancelled = N(rep.sched?.cancelled)
    const noShows   = N(rep.sched?.noShows)

    // New patients
    const npGoal    = numDrs * 4
    const npSched   = N(rep.sched?.npOnSched)
    const npSeen    = N(rep.sched?.npShowed)

    // Treatment plans — sum across all FD entries
    // Use fd_totals if available (consolidated at submit), fall back to summing fd
    const fdt = rep.fd_totals || Object.values(rep.fd||{}).reduce((t,f)=>({
      npTxPres:t.npTxPres+N(f?.npTxPres), extTxPres:t.extTxPres+N(f?.exTxPres||f?.extTxPres),
      npTxAcc:t.npTxAcc+N(f?.npTxAcc),   extTxAcc:t.extTxAcc+N(f?.exTxAcc||f?.extTxAcc),
      calls:t.calls+N(f?.calls), callsSched:t.callsSched+N(f?.callsSched),
    }),{npTxPres:0,extTxPres:0,npTxAcc:0,extTxAcc:0,calls:0,callsSched:0})
    const npTxPres  = fdt.npTxPres
    const extTxPres = fdt.extTxPres
    const npTxAcc   = fdt.npTxAcc
    const extTxAcc  = fdt.extTxAcc

    // Predeterminations from today's activity log
    const preds     = (rep.predToday||[])
    const predGen   = preds.length
    const predSub   = preds.filter(p => p.pred_sent).length

    // Calls
    const callsExt  = fdt.calls     || N(rep.calls?.external)
    const callsInt  = fdt.callsSched|| N(rep.calls?.internal)
    const callsMiss = N(rep.calls?.missed)
    const callsTotal= callsExt + callsInt
    const missRate  = callsTotal > 0 ? Math.round(callsMiss/callsTotal*100)+'%' : '0%'

    rows.push([
      rep.date, rep.office, rep.submittedBy||'', '',
      usd(goal), usd(prod), usd(prod-goal), pct(prod,goal), '',
      usd(N(rep.sched?.schedAmt)), N(rep.sched?.schedAmt)>0?pct(N(rep.sched?.schedAmt),goal)+'%':'0%', N(rep.sched?.schedAmt)>0?pct(prod,N(rep.sched?.schedAmt))+'%':'0%', '',
      usd(goal), usd(coll), usd(coll-goal), pct(coll,prod), '',
      scheduled, seen, cancelled, pct(seen,scheduled), '',
      npGoal, npSched, npSeen, pct(npSeen,npSched), '',
      npTxPres, extTxPres, npTxAcc, extTxAcc, pct(npTxAcc,npTxPres), pct(extTxAcc,extTxPres), '',
      predGen, predSub, pct(predSub,predGen), '',
      callsExt, callsInt, missRate, '',
      N(rep.sched?.compExamsSeen), N(rep.sched?.ptsPrebooked), pct(N(rep.sched?.ptsPrebooked),N(rep.sched?.compExamsSeen))+'%', '',
      N(rep.sched?.ptsOnSched), N(rep.sched?.ptsConfirmed), pct(N(rep.sched?.ptsConfirmed),N(rep.sched?.ptsOnSched))+'%', '',
      N(rep.sched?.hygPtsOnSched), N(rep.sched?.hygPtsSeen), (N(rep.sched?.hygPtsOnSched)>0?Math.round((N(rep.sched?.hygPtsOnSched)-N(rep.sched?.hygPtsSeen))*100/(N(rep.sched?.hygPtsOnSched)||1)):0)+'%',
    ].map(esc))
  }

  const csv  = rows.map(r => r.join(',')).join('\r\n')
  const blob = new Blob([csv], {type:'text/csv'})
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename || 'BSBD_Dashboard_'+new Date().toISOString().slice(0,10)+'.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Helper components ──────────────────────────────────────────────────────
const Row = ({l,v,bold,color}) => <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f8fafc",fontSize:13}}><span style={{color:"#64748b"}}>{l}</span><span style={{fontWeight:bold?700:500,color:color||"#1e293b"}}>{v}</span></div>
const Sec = ({title,children}) => <div style={{background:"white",borderRadius:12,padding:20,border:"1px solid #e2e8f0",marginBottom:16}}><div style={{fontSize:11,fontWeight:800,color:"#1e3a5f",letterSpacing:1,marginBottom:12}}>{title}</div>{children}</div>

function ReportCard({r, providers, selDate, setSelDate}) {
  const goal = repGoal(r, providers)
  const prod = repProd(r)
  const coll = repColl(r)
  const open = selDate === r.id

  return (
    <div style={{marginBottom:16,borderRadius:14,overflow:"hidden",border:"1px solid #e2e8f0"}}>
      {/* Summary bar */}
      <div onClick={()=>setSelDate(open?null:r.id)}
        style={{background:"linear-gradient(135deg,#1e3a5f,#163c5a)",padding:"16px 20px",cursor:"pointer",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.6)",marginRight:4}}>{r.date}</div>
        <div style={{fontSize:13,fontWeight:800,color:"white",marginRight:8}}>{r.office}</div>
        <div style={{fontSize:11,color:"rgba(255,255,255,.6)"}}>{r.submittedBy}</div>
        <div style={{marginLeft:"auto",display:"flex",gap:20,flexWrap:"wrap"}}>
          {[["DAILY GOAL",USD(goal),null],["NET PRODUCTION",USD(prod),null],["VARIANCE",(prod-goal>=0?"+":"")+USD(prod-goal),prod-goal>=0?"#4ade80":"#f87171"],["ACHIEVEMENT",PCT(prod,goal),prod>=goal?"#4ade80":"#fbbf24"],["COLLECTIONS",USD(coll),null],["COLL RATE",PCT(coll,prod),prod>0&&N(coll)>=N(prod)*0.95?"#4ade80":"#fbbf24"],["SHOW RATE",PCT(r.sched?.ptsShowUp,r.sched?.ptsOnSched),N(r.sched?.ptsOnSched)>0&&N(r.sched?.ptsShowUp)>=N(r.sched?.ptsOnSched)*0.9?"#4ade80":"#fbbf24"]].map(([l,v,c],i)=>(<div key={i} style={{flex:"1 1 120px",padding:"0 16px",borderLeft:i>0?"1px solid rgba(255,255,255,.15)":"none"}}><div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div><div style={{fontSize:16,fontWeight:800,color:c||"white"}}>{v}</div></div>))}
        </div>
      </div>

      {/* Detail section */}
      {open && (
        <div style={{padding:16,background:"#f8fafc"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
            <Sec title="PRODUCTION">
              {(r.providers||[]).filter(p=>p.doctorId).map((p,i)=>{
                const pv=providers.find(x=>x.id===p.doctorId)
                return(<div key={i} style={{padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
                  <div style={{fontWeight:700,fontSize:13,color:"#1e3a5f",marginBottom:6}}>{p.doctorName||pv?.name}</div>
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12,color:"#475569"}}>
                    {[["Goal",USD(pv?.goal||0)],["Schedule",USD(p.openSchedule)],["Actual",USD(p.netProd)],["Pts",p.ptsSeen||0],["NP Sched",p.npSched||0],["NP Seen",p.npSeen||0]].map(([l,v])=><div key={l}><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>{l}</div><div style={{fontWeight:600}}>{v}</div></div>)}
                  </div>
                </div>)
              })}
              {(r.hygiene||[]).filter(h=>h.name?.trim()).length>0&&(<div style={{marginTop:8}}>
                <div style={{fontSize:10,fontWeight:800,color:"#94a3b8",letterSpacing:1,marginBottom:6}}>HYGIENE</div>
                {(r.hygiene||[]).filter(h=>h.name?.trim()).map((h,i)=>(
                  <div key={i} style={{padding:"6px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{fontWeight:700,fontSize:12,color:"#1e3a5f",marginBottom:4}}>{h.name}</div>
                    <div style={{display:"flex",gap:12,fontSize:12,color:"#475569"}}>
                      {[["Goal","$1,200"],["Schedule",USD(h.openSchedule)],["Actual",USD(h.netProd)],["Pts",h.ptsSeen||0]].map(([l,v])=><div key={l}><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>{l}</div><div style={{fontWeight:600}}>{v}</div></div>)}
                    </div>
                  </div>
                ))}
              </div>)}
            </Sec>

            <Sec title="SCHEDULE &amp; PATIENT FLOW">
              <Row l="Scheduled Amount ($)"  v={USD(r.sched?.schedAmt)}/>
              <Row l="Daily Goal"            v={USD(goal)}/>
              <Row l="Schd / Goal"           v={PCT(r.sched?.schedAmt, goal)} bold/>
              <Row l="Production / Schd"     v={PCT(prod, r.sched?.schedAmt)} bold/>
              <Row l="Patients on Schedule"  v={r.sched?.ptsOnSched||0}/>
              <Row l="Patients Confirmed"    v={r.sched?.ptsConfirmed||0}/>
              <Row l="Confirmation Rate"     v={PCT(r.sched?.ptsConfirmed, r.sched?.ptsOnSched)} bold/>
              <Row l="Patients Showed Up"    v={r.sched?.ptsShowUp||0}/>
              <Row l="Show Rate"             v={PCT(r.sched?.ptsShowUp, r.sched?.ptsOnSched)} bold/>
              <Row l="Cancelled"             v={r.sched?.cancelled||0} bold color={N(r.sched?.cancelled)>0?"#d97706":undefined}/>
              <Row l="No Shows"              v={r.sched?.noShows||0}   bold color={N(r.sched?.noShows)>0?"#dc2626":undefined}/>
              <Row l="Rescheduled"           v={r.sched?.rescheduled||0}/>
            </Sec>

            <Sec title="NEW PATIENTS">
              <Row l="NP on Schedule"        v={r.sched?.npOnSched||0}/>
              <Row l="NP Showed"             v={r.sched?.npShowed||0}/>
              <Row l="NP Show Rate"          v={PCT(r.sched?.npShowed, r.sched?.npOnSched)} bold/>
              <Row l="NP Phone Calls"        v={r.sched?.npCalls||0}/>
              <Row l="NP Sched from Calls"   v={r.sched?.npCallsSched||0}/>
              <Row l="NP Conversion"         v={PCT(r.sched?.npCallsSched, r.sched?.npCalls)} bold/>
              <Row l="Same Day NP"           v={r.sched?.sameDayNP||0}/>
            </Sec>

            <Sec title="PREBOOKING">
              <Row l="Comp Exams Seen"       v={r.sched?.compExamsSeen||0}/>
              <Row l="Pts Booked Next Appt"  v={r.sched?.ptsPrebooked||0}/>
              <Row l="Prebook Rate"          v={PCT(r.sched?.ptsPrebooked, r.sched?.compExamsSeen)} bold/>
            </Sec>

            <Sec title="COLLECTIONS">
              <Row l="Non-Insurance ($)"     v={USD(r.coll?.nonIns)}/>
              <Row l="Insurance ($)"         v={USD(r.coll?.ins)}/>
              <Row l="Total Collections"     v={USD(coll)} bold/>
              <Row l="Collection Rate"       v={PCT(coll,prod)} bold/>
            </Sec>

            {r.fd&&Object.keys(r.fd).length>0&&(
              <>
              <Sec title="FRONT DESK / TC NUMBERS">
                {Object.entries(r.fd).map(([name,fd])=>(
                  <div key={name} style={{padding:"12px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#1e3a5f",marginBottom:8}}>{name}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4}}>
                      <Row l="NP Calls Made"       v={fd.calls||0}/>
                      <Row l="NP Calls Scheduled"  v={fd.callsSched||0}/>
                      <Row l="NP Conversion"       v={PCT(fd.callsSched,fd.calls)} bold/>
                      <Row l="Recall Calls Made"   v={fd.recalls||0}/>
                      <Row l="Recalls Scheduled"   v={fd.recallsSched||0}/>
                      <Row l="Recall Conversion"   v={PCT(fd.recallsSched,fd.recalls)} bold/>
                      <Row l="NP TX Presented"     v={fd.npTxPres||0}/>
                      <Row l="NP TX Accepted"      v={fd.npTxAcc||0}/>
                      <Row l="NP TX Acceptance"    v={PCT(fd.npTxAcc,fd.npTxPres)} bold/>
                      <Row l="Ext TX Presented"    v={fd.exTxPres||0}/>
                      <Row l="Ext TX Accepted"     v={fd.exTxAcc||0}/>
                      <Row l="Ext TX Acceptance"   v={PCT(fd.exTxAcc,fd.exTxPres)} bold/>
                    </div>
                  </div>
                ))}
              </Sec>
              <Sec title="PREDETERMINATIONS">
                <Row l="Pre-Ds Generated"   v={r.sched?.predGenerated||0}/>
                <Row l="Pre-Ds Submitted"   v={r.sched?.predSubmitted||0}/>
                <Row l="Submission Rate"    v={PCT(r.sched?.predSubmitted,r.sched?.predGenerated)} bold/>
              </Sec>
              <Sec title="RECARE / HYGIENE">
                <Row l="Hyg Pts on Schedule" v={r.sched?.hygPtsOnSched||0}/>
                <Row l="Hyg Pts Seen"        v={r.sched?.hygPtsSeen||0}/>
                {(()=>{const on=N(r.sched?.hygPtsOnSched);const seen=N(r.sched?.hygPtsSeen);const ns=on>0?Math.round((on-seen)*100/on):null;return(
                  <Row l="Hyg No-Show Rate" v={ns!==null?ns+'%':'—'} bold color={ns!==null&&ns<=8?"#16a34a":"#dc2626"}/>
                )})()}
              </Sec>
              </>
            )}
          </div>
          {r.notes&&<div style={{background:"#fffbeb",borderRadius:12,padding:20,border:"1px solid #fef3c7",marginBottom:16}}><div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:6}}>MANAGER NOTES</div><p style={{margin:0,fontSize:14,color:"#78350f",whiteSpace:"pre-wrap"}}>{r.notes}</p></div>}
        </div>
      )}
    </div>
  )
}

export default function DashboardPage({reports, providers, users, user, isManager, notify}) {
  const [selDate,    setSelDate]    = useState(null)
  const [rangeType,  setRangeType]  = useState('today')
  const [customStart,setCustomStart]= useState(monthStart())
  const [customEnd,  setCustomEnd]  = useState(todayStr())
  const today = todayStr()

  const dlCSV = (office='all') => {
    const filtered = reports.filter(r => {
      const inRange = rangeType==='today' ? r.date===todayStr()
                    : rangeType==='mtd'   ? r.date>=monthStart()
                    : r.date>=customStart && r.date<=customEnd
      const inOffice = office==='all' || r.office===office
      return inRange && inOffice
    })
    const label = office==='all' ? 'All_Offices' : office.split(' ').join('_')
    exportDashboardCSV(filtered, providers, 'BSBD_Dashboard_'+label+'_'+todayStr()+'.csv')
  }

  const visibleReports = reports.filter(r => {
    if (rangeType==='today') return r.date===today
    if (rangeType==='mtd')   return r.date>=monthStart()
    return r.date>=customStart && r.date<=customEnd
  }).filter(r => !isManager || user?.role==='admin' || r.office===user?.office)
  .sort((a,b) => b.date.localeCompare(a.date)||b.submittedAt?.localeCompare(a.submittedAt||'')||0)

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'24px 20px 60px'}}>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:20}}>
        <div style={{display:'flex',gap:4}}>
          {[['today','Today'],['mtd','MTD'],['custom','Custom']].map(([v,l])=>(
            <button key={v} onClick={()=>setRangeType(v)}
              style={{padding:'7px 14px',borderRadius:8,border:'1px solid '+(rangeType===v?'#1d4ed8':'#e2e8f0'),
                background:rangeType===v?'#1d4ed8':'white',color:rangeType===v?'white':'#64748b',
                fontWeight:600,fontSize:12,cursor:'pointer'}}>
              {l}
            </button>
          ))}
        </div>
        {rangeType==='custom'&&(
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
              style={{padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>to</span>
            <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
              style={{padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
          </div>
        )}
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',borderRadius:9,overflow:'hidden',border:'1px solid #1d4ed8'}}>
            <button onClick={()=>dlCSV('all')} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
              <IcoDL size={13}/> Download CSV
            </button>
            {['Brainerd','Calhoun','Dalton','McCallie'].map(o=>(
              <button key={o} onClick={()=>dlCSV(o)} style={{padding:'8px 10px',background:'#1d4ed8',color:'white',border:'none',borderLeft:'1px solid rgba(255,255,255,.2)',fontWeight:600,fontSize:11,cursor:'pointer'}}>
                {o}
              </button>
            ))}
          </div>
          <button onClick={()=>{
            const month = (rangeType==='today'||rangeType==='mtd')
              ? todayStr().slice(0,7)
              : customStart.slice(0,7)
            const monthReps = reports.filter(r=>r.date.startsWith(month))
            exportMonthlyExcel(monthReps, providers, users, month)
          }} style={{padding:'8px 16px',borderRadius:9,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
            📊 Monthly KPI Report (.xlsx)
          </button>
        </div>
      </div>

      {visibleReports.length===0?(
        <div style={{textAlign:'center',padding:60,color:'#94a3b8'}}>
          No reports found for this period
        </div>
      ):(
        visibleReports.map(r=>(
          <ReportCard key={r.id} r={r} providers={providers} selDate={selDate} setSelDate={setSelDate}/>
        ))
      )}
    </div>
  )
}
