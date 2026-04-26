import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function DashboardPage({reports,providers,notify,onEdit,onRefresh}){
  const [selected,setSelected]=useState(null);const [activeOffice,setActiveOffice]=useState("all");const [rangeType,setRangeType]=useState("mtd");const [customStart,setCustomStart]=useState(monthStart());const [customEnd,setCustomEnd]=useState(todayStr());const [refreshing,setRefreshing]=useState(false);
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
        <div style={{display:"flex",gap:8}}><button onClick={doRefresh} disabled={refreshing} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:10,background:"white",color:"#475569",border:"1px solid #e2e8f0",fontWeight:700,fontSize:13,cursor:refreshing?"not-allowed":"pointer"}}><IcoRefresh size={14} style={{animation:refreshing?"spin .7s linear infinite":"none"}}/> {refreshing?"Syncing…":"Sync"}</button><button onClick={doCSV} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 16px",borderRadius:10,background:"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoDL size={14}/> CSV</button></div>
      </div>
      <RangeSelector rangeType={rangeType} setRangeType={setRangeType} customStart={customStart} setCustomStart={setCustomStart} customEnd={customEnd} setCustomEnd={setCustomEnd}/>
      <div style={{display:"flex",gap:4,marginBottom:20,borderBottom:"2px solid #e2e8f0"}}>
        {["all",...OFFICES].map(o=>(<button key={o} onClick={()=>setActiveOffice(o)} style={{padding:"8px 18px",border:"none",cursor:"pointer",fontSize:13,fontWeight:700,background:"none",color:activeOffice===o?"#1d4ed8":"#94a3b8",borderBottom:activeOffice===o?"2px solid #1d4ed8":"2px solid transparent",marginBottom:-2,borderRadius:"4px 4px 0 0"}}>{o==="all"?"All Offices":o}<span style={{marginLeft:6,fontSize:11,background:activeOffice===o?"#eff6ff":"#f1f5f9",color:activeOffice===o?"#1d4ed8":"#94a3b8",padding:"1px 6px",borderRadius:99}}>{o==="all"?all.length:reports.filter(r=>r.office===o&&r.date>=start&&r.date<=end).length}</span></button>))}
      </div>
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
        {[["DAILY GOAL",USD(goal),null],["NET PRODUCTION",USD(prod),null],["VARIANCE",(prod-goal>=0?"+":"")+USD(prod-goal),prod-goal>=0?"#4ade80":"#f87171"],["ACHIEVEMENT",PCT(prod,goal),null],["COLLECTIONS",USD(coll),null],["COLL RATE",PCT(coll,goal),null]].map(([l,v,c],i)=>(<div key={i} style={{flex:"1 1 120px",padding:"0 16px",borderLeft:i>0?"1px solid rgba(255,255,255,.15)":"none"}}><div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div><div style={{fontSize:16,fontWeight:800,color:c||"white"}}>{v}</div></div>))}
      </div>
    </div>
    {r.providers?.filter(p=>p.doctorId||p.doctorName).map((p,i)=>{const pr=providers.find(x=>x.id===p.doctorId)||(p.doctorName?{name:p.doctorName,goal:0}:null);const diff=N(p.netProd)-N(pr?.goal||0);return pr?(<Sec key={i} title={`PROVIDER — ${pr.name}`}><div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:12,color:"#475569"}}>{[["Opening Sched",USD(p.openSchedule)],["Net Production",USD(p.netProd)],["Goal",pr.goal>0?USD(pr.goal):"—"],["Variance",pr.goal>0?(diff>=0?"+":"")+USD(diff):"—"],["Pts Seen",p.ptsSeen||0],["NP Sched",p.npSched||0],["NP Seen",p.npSeen||0]].map(([l,v])=>(<span key={l}><b style={{color:"#64748b"}}>{l}:</b> {v}</span>))}</div></Sec>):null;})}
    {r.hygiene?.filter(h=>h.name).map((h,i)=>(<Sec key={i} title={`HYGIENE — ${h.name}`}><div style={{display:"flex",gap:20,flexWrap:"wrap",fontSize:12,color:"#475569"}}>{[["Opening Sched",USD(h.openSchedule)],["Net Production",USD(h.netProd)],["Goal","$1,200.00"],["Variance",(N(h.netProd)-1200>=0?"+":"")+USD(N(h.netProd)-1200)],["Pts Seen",h.ptsSeen||0]].map(([l,v])=>(<span key={l}><b style={{color:"#64748b"}}>{l}:</b> {v}</span>))}</div></Sec>))}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      <Sec title="SCHEDULE & PATIENT FLOW"><Row l="Total Schedule" v={USD(r.sched?.totalAmt)}/><Row l="Daily Goal" v={USD(goal)}/><Row l="Patients on Schedule" v={r.sched?.ptsOnSched||0}/><Row l="Patients Showed Up" v={r.sched?.ptsShowUp||0}/><Row l="Cancelled" v={r.sched?.cancelled||0} bold color={N(r.sched?.cancelled)>0?"#d97706":undefined}/><Row l="No Shows" v={r.sched?.noShows||0} bold color={N(r.sched?.noShows)>0?"#dc2626":undefined}/><Row l="Rescheduled" v={r.sched?.rescheduled||0}/><Row l="Recalls Made" v={r.sched?.recalls||0}/><Row l="From Recalls" v={r.sched?.recallsSched||0}/><Row l="Recall Rate" v={PCT(r.sched?.recallsSched,r.sched?.recalls)} bold/><Row l="NP on Schedule" v={r.sched?.npOnSched||0}/><Row l="NP Showed" v={r.sched?.npShowed||0}/><Row l="NP Phone Calls" v={r.sched?.npCalls||0}/><Row l="NP Sched from Calls" v={r.sched?.npCallsSched||0}/><Row l="NP Conversion" v={PCT(r.sched?.npCallsSched,r.sched?.npCalls)} bold/><Row l="Same Day NP" v={r.sched?.sameDayNP||0}/><Row l="Same Day Existing" v={r.sched?.sameDayExt||0}/></Sec>
      <div><Sec title="COLLECTIONS"><Row l="Non-Insurance" v={USD(r.coll?.nonIns)}/><Row l="Insurance" v={USD(r.coll?.ins)}/><Row l="Total" v={USD(coll)} bold/><Row l="Rate" v={PCT(coll,goal)} bold color={N(coll)>=goal?"#16a34a":"#dc2626"}/></Sec><Sec title="INSURANCE CLAIMS"><Row l="Total Sent" v={r.claims?.sent||0}/><Row l="Submitted" v={r.claims?.submitted||0}/><Row l="Sub Rate" v={PCT(r.claims?.submitted,r.claims?.sent)} bold/><Row l="Rejected" v={r.claims?.rejected||0} color={N(r.claims?.rejected)>0?"#d97706":undefined}/><Row l="Resolved" v={r.claims?.resolved||0}/><Row l="Escalations" v={r.claims?.escalations||0} bold color={N(r.claims?.escalations)>0?"#dc2626":undefined}/></Sec></div>
    </div>
    {r.fd&&Object.keys(r.fd).length>0&&(<Sec title="FRONT DESK KPIS">{Object.entries(r.fd).map(([name,fd])=>(<div key={name} style={{padding:"12px 0",borderBottom:"1px solid #f1f5f9"}}><div style={{fontWeight:700,fontSize:13,color:"#1e3a5f",marginBottom:8}}>{name}</div><div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:12,color:"#475569"}}>{[["NP Calls",fd.calls||0],["NP Sched",fd.callsSched||0],["NP Conv",PCT(fd.callsSched,fd.calls)],["Recalls",fd.recalls||0],["From Recalls",fd.recallsSched||0],["Recall%",PCT(fd.recallsSched,fd.recalls)],["NP Tx Pres",fd.npTxPres||0],["NP Tx Acc",fd.npTxAcc||0],["Ex Tx Pres",fd.exTxPres||0],["Ex Tx Acc",fd.exTxAcc||0]].map(([l,v])=>(<span key={l}><b style={{color:"#64748b"}}>{l}:</b> {v}</span>))}</div></div>))}</Sec>)}
    {r.notes&&<div style={{background:"#fffbeb",borderRadius:12,padding:20,border:"1px solid #fde68a"}}><div style={{fontSize:11,fontWeight:800,color:"#92400e",marginBottom:8,letterSpacing:2}}>NOTES / INCIDENCES</div><p style={{fontSize:13,color:"#78350f",lineHeight:1.7,margin:0}}>{r.notes}</p></div>}
  </div>);
}

// ── Admin Page ─────────────────────────────────────────────────────────────


export default DashboardPage
