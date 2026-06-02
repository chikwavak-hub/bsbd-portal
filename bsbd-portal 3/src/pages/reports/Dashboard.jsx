import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
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
    const fdVals = Object.values(rep.fd||{})
    const npTxPres  = fdVals.reduce((s,f) => s+N(f?.npTxPres),  0)
    const extTxPres = fdVals.reduce((s,f) => s+N(f?.extTxPres), 0)
    const npTxAcc   = fdVals.reduce((s,f) => s+N(f?.npTxAcc),   0)
    const extTxAcc  = fdVals.reduce((s,f) => s+N(f?.extTxAcc),  0)

    // Predeterminations from today's activity log
    const preds     = (rep.predToday||[])
    const predGen   = preds.length
    const predSub   = preds.filter(p => p.pred_sent).length

    // Calls
    const callsExt  = N(rep.calls?.external)
    const callsInt  = N(rep.calls?.internal)
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
      N(rep.sched?.hygPtsOnSched), N(rep.sched?.hygPtsSeen), (N(rep.sched?.hygPtsOnSched)>0?Math.round((1-N(rep.sched?.hygPtsSeen)/N(rep.sched?.hygPtsOnSched))*100):0)+'%',
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

function DashboardPage({reports,providers,notify,onEdit,onRefresh}){
  const [selected,setSelected]=useState(null);const [activeOffice,setActiveOffice]=useState("all");const [rangeType,setRangeType]=useState("mtd");const [customStart,setCustomStart]=useState(monthStart());const [customEnd,setCustomEnd]=useState(todayStr());const [refreshing,setRefreshing]=useState(false);
  const [todayColl,setTodayColl]=useState(null);
  const dlCSV = (office='all') => {
    const filtered = reports.filter(r => {
      const inRange = rangeType==='today' ? r.date===todayStr()
                    : rangeType==='mtd'   ? r.date>=monthStart()
                    : r.date>=customStart && r.date<=customEnd
      const inOffice = office==='all' || r.office===office
      return inRange && inOffice
    })
    const label = office==='all' ? 'All_Offices' : office.replace(/\s+/g,'_')
    exportDashboardCSV(filtered, providers, 'BSBD_Dashboard_'+label+'_'+todayStr()+'.csv')
  };
  useEffect(()=>{
    const today=todayStr();
    sbGet('collection_patients','date=eq.'+today+'&select=office,total_expected,amount_collected,status,ins_status')
      .then(rows=>{
        if(!rows.length){setTodayColl(null);return;}
        const byOffice={};
        for(const r of rows){
          if(!byOffice[r.office])byOffice[r.office]={expected:0,collected:0,pending:0,patients:0};
          byOffice[r.office].patients++;
          byOffice[r.office].expected+=N(r.total_expected||0);
          byOffice[r.office].collected+=N(r.amount_collected||0);
          if(r.status==='pending'&&N(r.total_expected)>0)byOffice[r.office].pending++;
        }
        setTodayColl({
          totExp: rows.reduce((s,r)=>s+N(r.total_expected||0),0),
          totColl:rows.reduce((s,r)=>s+N(r.amount_collected||0),0),
          totPts: rows.length,
          totPend:rows.filter(r=>r.status==='pending'&&N(r.total_expected)>0).length,
          byOffice,date:today
        });
      }).catch(()=>{});
  },[]);
  const start=rangeStart(rangeType,customStart);const end=rangeType==="custom"?customEnd:todayStr();const rl=RANGE_LABEL[rangeType]||"Period";
  const all=reports.filter(r=>r.date>=start&&r.date<=end&&(activeOffice==="all"||r.office===activeOffice));
  const prodMTD=all.reduce((s,r)=>s+repProd(r),0);const goalMTD=all.reduce((s,r)=>s+repGoal(r,providers),0);const collMTD=all.reduce((s,r)=>s+repColl(r),0);
  const recallsMade=all.reduce((s,r)=>s+N(r.sched?.recalls),0);const recallsSched=all.reduce((s,r)=>s+N(r.sched?.recallsSched),0);
  const npCalls=all.reduce((s,r)=>s+N(r.sched?.npCalls),0);const npSched=all.reduce((s,r)=>s+N(r.sched?.npCallsSched),0);
  const noShows=all.reduce((s,r)=>s+N(r.sched?.noShows),0);const ptsSched=all.reduce((s,r)=>s+N(r.sched?.ptsOnSched),0);
  const claimsSent=all.reduce((s,r)=>s+N(r.claims?.sent),0);const claimsSub=all.reduce((s,r)=>s+N(r.claims?.submitted),0);
  const doRefresh=async()=>{setRefreshing(true);await onRefresh();setRefreshing(false);};
  const doCSV=()=>{const cols=["Date","Office","Manager","Goal","Production","Variance","Collections","No Shows","Cancelled","Recall%","NP Conv%"];const rows=all.map(r=>{const g=repGoal(r,providers);const p=repProd(r);const c=repColl(r);return[r.date,r.office,r.submittedBy,g,p,p-g,c,r.sched?.noShows||0,r.sched?.cancelled||0,PCT(r.sched?.recallsSched,r.sched?.recalls),PCT(r.sched?.npCallsSched,r.sched?.npCalls)];});downloadCSV([cols,...rows],`BSBD_Dashboard_${todayStr()}.csv`);notify("CSV downloaded!");};
  if(selected) return <DetailView report={selected} providers={providers} onBack={()=>setSelected(null)} onEdit={r=>{setSelected(null);onEdit(r);}}/>;
  const CARDS=[{label:`${rl} Production`,val:USD(prodMTD),sub:`Goal: ${USD(goalMTD)}`,pct:pctNum(prodMTD,goalMTD),inv:false},{label:`${rl} Collections`,val:USD(collMTD),sub:`${PCT(collMTD,goalMTD)} of goal`,pct:pctNum(collMTD,goalMTD),inv:false},{label:`${rl} Recall Rate`,val:PCT(recallsSched,recallsMade),sub:`${recallsSched} of ${recallsMade}`,pct:pctNum(recallsSched,recallsMade),inv:false},{label:`${rl} NP Conversion`,val:PCT(npSched,npCalls),sub:`${npSched} of ${npCalls} calls`,pct:pctNum(npSched,npCalls),inv:false},{label:`${rl} No-Show Rate`,val:PCT(noShows,ptsSched),sub:`${noShows} of ${ptsSched} scheduled`,pct:pctNum(noShows,ptsSched),inv:true},{label:`${rl} Claims Sub Rate`,val:PCT(claimsSub,claimsSent),sub:`${claimsSub} of ${claimsSent}`,pct:pctNum(claimsSub,claimsSent),inv:false}];
  return(
    <div style={{maxWidth:1200,margin:"0 auto",padding:"28px 20px"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div><h1 style={{fontSize:24,fontWeight:800,color:"#1e293b",margin:0}}>Reports Dashboard</h1><p style={{color:"#94a3b8",fontSize:13,marginTop:4}}>{RANGE_TITLE[rangeType]} · {all.length} report{all.length!==1?"s":""}</p></div>
        <div style={{display:"flex",gap:8}}><button onClick={doRefresh} disabled={refreshing} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:10,background:"white",color:"#475569",border:"1px solid #e2e8f0",fontWeight:700,fontSize:13,cursor:refreshing?"not-allowed":"pointer"}}><IcoRefresh size={14} style={{animation:refreshing?"spin .7s linear infinite":"none"}}/> {refreshing?"Syncing…":"Sync"}</button>{/* Download CSV — all offices or per office */}
          <div style={{position:'relative',display:'inline-block'}}>
            <div style={{display:'flex',borderRadius:9,overflow:'hidden',border:'1px solid #1d4ed8'}}>
              <button onClick={()=>dlCSV('all')} style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                <IcoDL size={13}/> Download CSV
              </button>
              <div style={{width:1,background:'rgba(255,255,255,.3)'}}/>
              {['Brainerd','Calhoun','Dalton','McCallie'].map(o=>(
                <button key={o} onClick={()=>dlCSV(o)} style={{padding:'8px 10px',background:'#1d4ed8',color:'white',border:'none',fontWeight:600,fontSize:11,cursor:'pointer',borderLeft:'1px solid rgba(255,255,255,.2)'}}>
                  {o}
                </button>
              ))}
            </div>
          </div></div>
      </div>
      <RangeSelector rangeType={rangeType} setRangeType={setRangeType} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd}/>
      <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:"2px solid #e2e8f0"}}>
        {["all",...OFFICES].map(o=>(<button key={o} onClick={()=>setActiveOffice(o)} style={{padding:"8px 18px",border:"none",cursor:"pointer",fontSize:13,fontWeight:700,background:"none",color:activeOffice===o?"#1d4ed8":"#94a3b8",borderBottom:activeOffice===o?"2px solid #1d4ed8":"2px solid transparent",marginBottom:-2,borderRadius:"4px 4px 0 0"}}>{o==="all"?"All Offices":o}<span style={{marginLeft:6,fontSize:11,background:activeOffice===o?"#eff6ff":"#f1f5f9",color:activeOffice===o?"#1d4ed8":"#94a3b8",padding:"1px 6px",borderRadius:99}}>{o==="all"?all.length:reports.filter(r=>r.office===o&&r.date>=start&&r.date<=end).length}</span></button>))}
      </div>
      {todayColl&&(
        <div style={{background:"linear-gradient(135deg,#0d9488,#0891b2)",borderRadius:14,padding:"18px 24px",marginBottom:16,color:"white"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontSize:10,opacity:.6,fontWeight:700,letterSpacing:2,marginBottom:2}}>LIVE TODAY — {todayColl.date}</div>
              <div style={{fontSize:18,fontWeight:800}}>Today's Collections</div>
            </div>
            <div style={{fontSize:11,fontWeight:700,padding:"4px 12px",borderRadius:99,background:"rgba(255,255,255,.15)"}}>{todayColl.totPts} patients · {todayColl.totPend} pending</div>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:0,marginBottom:14}}>
            {[["EXPECTED","$"+(todayColl.totExp||0).toFixed(2),null],["COLLECTED","$"+(todayColl.totColl||0).toFixed(2),"#86efac"],["PENDING","$"+Math.max(0,todayColl.totExp-todayColl.totColl).toFixed(2),todayColl.totExp>todayColl.totColl?"#fde68a":"#86efac"],["CAPTURE",todayColl.totExp>0?Math.round(todayColl.totColl/todayColl.totExp*100)+"%":"—",null]].map(([l,v,c],i)=>(
              <div key={i} style={{flex:"1 1 90px",padding:"0 14px",borderLeft:i>0?"1px solid rgba(255,255,255,.2)":"none"}}>
                <div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div>
                <div style={{fontSize:17,fontWeight:800,color:c||"white"}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{height:6,background:"rgba(255,255,255,.2)",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:3,background:"#86efac",width:todayColl.totExp>0?Math.min(Math.round(todayColl.totColl/todayColl.totExp*100),100)+"%":"0%",transition:"width .4s"}}/>
          </div>
          {Object.keys(todayColl.byOffice).length>1&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:10}}>
              {Object.entries(todayColl.byOffice).map(([off,d])=>(
                <div key={off} style={{padding:"6px 12px",borderRadius:8,background:"rgba(255,255,255,.1)",fontSize:11}}>
                  <b>{off}</b><span style={{opacity:.7,marginLeft:6}}>{d.patients} pts</span>
                  <span style={{color:"#86efac",fontWeight:700,marginLeft:6}}>${(d.collected||0).toFixed(0)}</span>
                  {d.pending>0&&<span style={{color:"#fde68a",marginLeft:4}}>· {d.pending} pending</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:16,marginBottom:24}}>
        {CARDS.map(({label,val,sub,pct,inv})=>(<div key={label} style={{background:"white",borderRadius:12,padding:"18px 20px",border:"1px solid #e2e8f0"}}><div style={{fontSize:10,fontWeight:700,color:"#94a3b8",letterSpacing:1,marginBottom:4}}>{label.toUpperCase()}</div><div style={{fontSize:24,fontWeight:800,color:"#1e293b"}}>{val}</div><div style={{fontSize:11,color:"#64748b",marginTop:2}}>{sub}</div><PBar pct={pct} inverse={inv}/><div style={{fontSize:10,color:"#94a3b8",marginTop:4,textAlign:"right"}}>{pct.toFixed(1)}%{inv?" (lower is better)":" of goal"}</div></div>))}
      </div>
      {all.length===0?<div style={{textAlign:"center",padding:60,color:"#94a3b8",background:"white",borderRadius:12,border:"1px solid #e2e8f0"}}>No reports in this range. Submit a daily report or try a different date range.</div>:(
        <div style={{background:"white",borderRadius:12,border:"1px solid #e2e8f0",overflow:"hidden"}}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#f8fafc"}}>{["Date","Office","Manager","Net Prod","Goal","Variance","Collections","No Shows","Cancelled","Recall%","",""].map((h,i)=>(<th key={i} style={{padding:"11px 12px",textAlign:"left",fontSize:10,fontWeight:700,color:"#64748b",letterSpacing:1,borderBottom:"1px solid #e2e8f0",whiteSpace:"nowrap"}}>{h.toUpperCase()}</th>))}</tr></thead>
            <tbody>{[...all].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>{const goal=repGoal(r,providers);const prod=repProd(r);const coll=repColl(r);const v=prod-goal;return(<tr key={r.id} style={{borderBottom:"1px solid #f1f5f9"}}><td style={{padding:"12px",fontSize:12,fontWeight:600,color:"#1e293b",whiteSpace:"nowrap"}}>{fmtDate(r.date)}</td><td style={{padding:"12px"}}><span style={{fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:99,background:"#eff6ff",color:"#1d4ed8"}}>{r.office}</span></td><td style={{padding:"12px",fontSize:12,color:"#475569"}}>{r.submittedBy}</td><td style={{padding:"12px",fontSize:12,fontWeight:700}}>{USD(prod)}</td><td style={{padding:"12px",fontSize:12,color:"#64748b"}}>{USD(goal)}</td><td style={{padding:"12px",fontSize:12,fontWeight:700,color:v>=0?"#16a34a":"#dc2626"}}>{v>=0?"+":""}{USD(v)}</td><td style={{padding:"12px",fontSize:12,color:"#0d9488"}}>{USD(coll)}</td><td style={{padding:"12px",fontSize:12,fontWeight:N(r.sched?.noShows)>0?700:400,color:N(r.sched?.noShows)>0?"#dc2626":"#475569"}}>{r.sched?.noShows||0}</td><td style={{padding:"12px",fontSize:12,color:"#475569"}}>{r.sched?.cancelled||0}</td><td style={{padding:"12px",fontSize:12,color:"#475569"}}>{PCT(r.sched?.recallsSched,r.sched?.recalls)}</td><td style={{padding:"12px"}}><button onClick={()=>setSelected(r)} style={{background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:4,display:"flex"}} title="View"><IcoEye size={15}/></button></td><td style={{padding:"12px"}}><button onClick={()=>onEdit(r)} style={{background:"none",border:"none",cursor:"pointer",color:"#94a3b8",padding:4,display:"flex"}} title="Edit"><IcoEdit size={15}/></button></td></tr>);})}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Analytics ──────────────────────────────────────────────────────────────

function DetailView({report:r,providers,onBack,onEdit}){
  const goal=repGoal(r,providers);const prod=repProd(r);const coll=repColl(r);
  const Row=({l,v,bold,color})=><div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f8fafc",fontSize:13}}><span style={{color:"#64748b"}}>{l}</span><span style={{fontWeight:bold?700:600,color:color||"#1e293b"}}>{v}</span></div>;
  const Sec=({title,children})=><div style={{background:"white",borderRadius:12,padding:20,border:"1px solid #e2e8f0",marginBottom:16}}><div style={{fontSize:11,fontWeight:800,color:"#94a3b8",marginBottom:12,letterSpacing:2}}>{title}</div>{children}</div>;
  return(<div style={{maxWidth:960,margin:"0 auto",padding:"28px 20px"}}>
    <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
      <button onClick={onBack} style={{display:"flex",alignItems:"center",gap:6,background:"none",border:"none",cursor:"pointer",color:"#64748b",fontSize:13,fontWeight:600}}>← Back</button>
      <div style={{flex:1}}/>
      <button onClick={()=>onEdit(r)} style={{display:"flex",alignItems:"center",gap:8,padding:"9px 20px",borderRadius:10,background:"#f59e0b",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoEdit size={14}/> Edit Report</button>
    </div>
    <div style={{background:"linear-gradient(135deg,#1e3a5f,#1a6b8a)",borderRadius:12,padding:"20px 24px",marginBottom:16,color:"white"}}>
      <h2 style={{fontSize:20,fontWeight:800,margin:0}}>{r.office} Office — {fmtDate(r.date)}</h2>
      <p style={{opacity:.7,fontSize:13,marginTop:4}}>Submitted by {r.submittedBy} · {r.submittedAt?new Date(r.submittedAt).toLocaleString():"—"}</p>
      <div style={{display:"flex",flexWrap:"wrap",marginTop:16}}>
        {[["DAILY GOAL",USD(goal),null],["NET PRODUCTION",USD(prod),null],["VARIANCE",(prod-goal>=0?"+":"")+USD(prod-goal),prod-goal>=0?"#4ade80":"#f87171"],["ACHIEVEMENT",PCT(prod,goal),prod>=goal?"#4ade80":"#fbbf24"],["COLLECTIONS",USD(coll),null],["COLL RATE",PCT(coll,prod),N(coll)/N(prod||1)>=0.95?"#4ade80":"#fbbf24"],["SHOW RATE",PCT(r.sched?.ptsShowUp,r.sched?.ptsOnSched),N(r.sched?.ptsShowUp)/N(r.sched?.ptsOnSched||1)>=0.9?"#4ade80":"#fbbf24"]].map(([l,v,c],i)=>(<div key={i} style={{flex:"1 1 120px",padding:"0 16px",borderLeft:i>0?"1px solid rgba(255,255,255,.15)":"none"}}><div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div><div style={{fontSize:16,fontWeight:800,color:c||"white"}}>{v}</div></div>))}
      </div>
    </div>
    {r.providers?.filter(p=>p.doctorId||p.doctorName).map((p,i)=>{const pr=providers.find(x=>x.id===p.doctorId)||(p.doctorName?{name:p.doctorName,goal:0}:null);const diff=N(p.netProd)-N(pr?.goal||0);return pr?(<Sec key={i} title={`PROVIDER — ${pr.name}`}><div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:12,color:"#475569"}}>{[["Opening Sched",USD(p.openSchedule)],["Net Production",USD(p.netProd)],["Goal",pr.goal>0?USD(pr.goal):"—"],["Variance",pr.goal>0?(diff>=0?"+":"")+USD(diff):"—"],["Pts Seen",p.ptsSeen||0],["NP Sched",p.npSched||0],["NP Seen",p.npSeen||0]].map(([l,v])=>(<span key={l}><b style={{color:"#64748b"}}>{l}:</b> {v}</span>))}</div></Sec>):null;})}
    {r.hygiene?.filter(h=>h.name).map((h,i)=>(<Sec key={i} title={`HYGIENE — ${h.name}`}><div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:12,color:"#475569"}}>{[["Opening Sched",USD(h.openSchedule)],["Net Production",USD(h.netProd)],["Goal","$1,200.00"],["Variance",(N(h.netProd)-1200>=0?"+":"")+USD(N(h.netProd)-1200)],["Pts Seen",h.ptsSeen||0]].map(([l,v])=>(<span key={l}><b style={{color:"#64748b"}}>{l}:</b> {v}</span>))}</div></Sec>))}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
      <Sec title="SCHEDULE & PATIENT FLOW"><Row l="Total Schedule" v={USD(r.sched?.totalAmt)}/><Row l="Daily Goal" v={USD(goal)}/><Row l="Patients on Schedule" v={r.sched?.ptsOnSched||0}/><Row l="Patients Showed Up" v={r.sched?.ptsShowUp||0}/><Row l="Cancelled" v={r.sched?.cancelled||0} bold color={N(r.sched?.cancelled)>0?"#d97706":undefined}/><Row l="No Shows" v={r.sched?.noShows||0} bold color={N(r.sched?.noShows)>0?"#dc2626":undefined}/><Row l="Rescheduled" v={r.sched?.rescheduled||0}/><Row l="Recalls Made" v={r.sched?.recalls||0}/><Row l="From Recalls" v={r.sched?.recallsSched||0}/><Row l="Recall Rate" v={PCT(r.sched?.recallsSched,r.sched?.recalls)} bold/><Row l="NP on Schedule" v={r.sched?.npOnSched||0}/><Row l="NP Showed" v={r.sched?.npShowed||0}/><Row l="NP Phone Calls" v={r.sched?.npCalls||0}/><Row l="NP Sched from Calls" v={r.sched?.npCallsSched||0}/><Row l="NP Conversion" v={PCT(r.sched?.npCallsSched,r.sched?.npCalls)} bold/><Row l="Same Day NP" v={r.sched?.sameDayNP||0}/><Row l="Same Day Existing" v={r.sched?.sameDayExt||0}/></Sec>
      <div><Sec title="COLLECTIONS"><Row l="Non-Insurance" v={USD(r.coll?.nonIns)}/><Row l="Insurance" v={USD(r.coll?.ins)}/><Row l="Total" v={USD(coll)} bold/><Row l="Rate" v={PCT(coll,goal)} bold color={N(coll)>=goal?"#16a34a":"#dc2626"}/></Sec><Sec title="INSURANCE CLAIMS"><Row l="Total Sent" v={r.claims?.sent||0}/><Row l="Submitted" v={r.claims?.submitted||0}/><Row l="Sub Rate" v={PCT(r.claims?.submitted,r.claims?.sent)} bold/><Row l="Rejected" v={r.claims?.rejected||0} color={N(r.claims?.rejected)>0?"#d97706":undefined}/><Row l="Resolved" v={r.claims?.resolved||0}/><Row l="Escalations" v={r.claims?.escalations||0} bold color={N(r.claims?.escalations)>0?"#dc2626":undefined}/></Sec></div>
    </div>
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
            <Row l="Submission Rate"    v={PCT(r.sched?.predSubmitted,r.sched?.predGenerated)} bold
              color={PCT(r.sched?.predSubmitted,r.sched?.predGenerated)>=100?"#16a34a":"#d97706"}/>
          </Sec>
          <Sec title="RECARE / HYGIENE">
            <Row l="Hyg Pts on Schedule" v={r.sched?.hygPtsOnSched||0}/>
            <Row l="Hyg Pts Seen"        v={r.sched?.hygPtsSeen||0}/>
            <Row l="Hyg No-Show Rate"    v={r.sched?.hygPtsOnSched>0?Math.round((1-N(r.sched?.hygPtsSeen)/N(r.sched?.hygPtsOnSched))*100)+'%':'—'}
              bold color={r.sched?.hygPtsOnSched>0&&(1-N(r.sched?.hygPtsSeen)/N(r.sched?.hygPtsOnSched))*100<=8?"#16a34a":"#dc2626"}/>
          </Sec>
          </>
        )}
