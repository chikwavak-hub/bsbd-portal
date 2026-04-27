import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function StaffFormPage({user,providers,notify}){
  const initData=()=>{if(user.role==="provider")return{doctorId:providers.find(p=>p.name===user.staffName)?.id||"",openSchedule:"",netProd:"",ptsSeen:"",npSched:"",npSeen:""};if(user.role==="hygienist")return{name:user.staffName||"",openSchedule:"",netProd:"",ptsSeen:""};return{calls:"",callsSched:"",recalls:"",recallsSched:"",npTxPres:"",npTxAcc:"",exTxPres:"",exTxAcc:""};};
  const [data,setData]=useState(initData);const [date,setDate]=useState(todayStr());const [saving,setSaving]=useState(false);const [lastSaved,setLastSaved]=useState(null);
  const setF=(k,v)=>setData(d=>({...d,[k]:v}));
  const save=async()=>{
    setSaving(true);
    try{
      await sbPost('drafts',{date,office:user.office,username:user.username,staff_name:user.staffName||user.name,staff_role:user.role,data,saved_at:new Date().toISOString()},true);
      setLastSaved(new Date().toLocaleTimeString());notify("Section saved ✓");
    }catch{notify("Save failed — check connection","error");}
    setSaving(false);
  };
  const pr=user.role==="provider"?providers.find(p=>p.id===data.doctorId):null;
  return(
    <div style={{maxWidth:800,margin:"0 auto",padding:"28px 20px"}}>
      <div style={{marginBottom:20}}><h1 style={{fontSize:22,fontWeight:800,color:"#1e293b",margin:0}}>My Daily Section</h1><p style={{color:"#94a3b8",fontSize:13,marginTop:4}}>{user.name} · {user.office} · <span style={{textTransform:"capitalize"}}>{user.role.replace("_"," ")}</span></p></div>
      <div style={{...CARD,padding:20,marginBottom:16,display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
        <div style={{flex:"1 1 160px"}}><label style={LBL}>Report Date</label><input type="date" className="ic" value={date} onChange={e=>setDate(e.target.value)}/></div>
        {lastSaved&&<div style={{fontSize:12,color:"#10b981",fontWeight:600,display:"flex",alignItems:"center",gap:6}}><IcoCheck size={14}/> Saved {lastSaved}</div>}
        <button onClick={save} disabled={saving} style={{display:"flex",alignItems:"center",gap:8,padding:"10px 24px",borderRadius:10,background:saving?"#93c5fd":"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:saving?"not-allowed":"pointer"}}><IcoCloud size={15}/> {saving?"Saving…":"Save My Section"}</button>
      </div>
      {user.role==="provider"&&<div style={{...CARD,padding:20}}><h3 style={{fontWeight:800,fontSize:15,color:"#1e293b",marginBottom:16}}>🩺 Provider Production</h3><div style={{marginBottom:12}}><label style={LBL}>Doctor</label><input className="ic" value={user.staffName||"Not configured"} disabled/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><NF label="Opening Schedule ($)" val={data.openSchedule} set={v=>setF("openSchedule",v)} pre/><NF label="Net Production ($)" val={data.netProd} set={v=>setF("netProd",v)} pre/><NF label="# Patients Seen" val={data.ptsSeen} set={v=>setF("ptsSeen",v)}/><NF label="# NP Scheduled" val={data.npSched} set={v=>setF("npSched",v)}/><NF label="# NP Seen" val={data.npSeen} set={v=>setF("npSeen",v)}/></div>{pr&&N(data.netProd)>0&&<div style={{marginTop:12,display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,fontWeight:800,padding:"3px 10px",borderRadius:99,background:N(data.netProd)>=pr.goal?"#dcfce7":"#fee2e2",color:N(data.netProd)>=pr.goal?"#16a34a":"#dc2626"}}>{N(data.netProd)>=pr.goal?"▲ ABOVE GOAL":"▼ BELOW GOAL"}</span></div>}</div>}
      {user.role==="hygienist"&&<div style={{...CARD,padding:20}}><h3 style={{fontWeight:800,fontSize:15,color:"#1e293b",marginBottom:16}}>🦷 Hygiene Production</h3><div style={{marginBottom:12}}><label style={LBL}>Name</label><input className="ic" value={data.name} onChange={e=>setF("name",e.target.value)} placeholder="Your name"/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><NF label="Opening Schedule ($)" val={data.openSchedule} set={v=>setF("openSchedule",v)} pre/><NF label="Net Production ($)" val={data.netProd} set={v=>setF("netProd",v)} pre/><NF label="# Patients Seen" val={data.ptsSeen} set={v=>setF("ptsSeen",v)}/></div>{N(data.netProd)>0&&<div style={{marginTop:12,fontSize:12,fontWeight:700,color:N(data.netProd)>=1200?"#16a34a":"#dc2626"}}>{N(data.netProd)>=1200?"✓ $1,200 goal met":`▼ ${USD(1200-N(data.netProd))} below goal`}</div>}</div>}
      {user.role==="front_desk"&&<div style={{...CARD,padding:20}}><h3 style={{fontWeight:800,fontSize:15,color:"#1e293b",marginBottom:16}}>👥 My KPIs — {user.staffName||user.name}</h3><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><NF label="NP Calls" val={data.calls} set={v=>setF("calls",v)}/><NF label="NP Calls Sched" val={data.callsSched} set={v=>setF("callsSched",v)}/><NF label="Recalls Made" val={data.recalls} set={v=>setF("recalls",v)}/><NF label="From Recalls" val={data.recallsSched} set={v=>setF("recallsSched",v)}/><NF label="NP Tx Presented" val={data.npTxPres} set={v=>setF("npTxPres",v)}/><NF label="NP Tx Accepted" val={data.npTxAcc} set={v=>setF("npTxAcc",v)}/><NF label="Existing Tx Pres" val={data.exTxPres} set={v=>setF("exTxPres",v)}/><NF label="Existing Tx Acc" val={data.exTxAcc} set={v=>setF("exTxAcc",v)}/></div></div>}
      <div style={{background:"#eff6ff",borderRadius:12,padding:16,marginTop:8,fontSize:13,color:"#1e40af",display:"flex",gap:10,alignItems:"flex-start"}}><IcoAlert size={16} style={{flexShrink:0,marginTop:1}}/><span>Tap <b>Save My Section</b> to send your data to the manager. They'll load all sections when compiling the daily report.</span></div>
    </div>
  );
}

// ── Manager Form Page ──────────────────────────────────────────────────────


export default StaffFormPage
