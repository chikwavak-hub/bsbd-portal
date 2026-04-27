import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoX,IcoCheck,IcoEdit,IcoAlert,IcoClock,IcoPhone,IcoChevR,IcoChevD,IcoChevU,IcoCloud,IcoUsers,IcoBell,IcoStar } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function TcAlertsPage({tcPatients,user,isManager,notify,saveTcPatient}){
  const alerts=getTcAlerts(tcPatients,user,isManager);
  const high=alerts.filter(a=>a.urgency==='high');
  const medium=alerts.filter(a=>a.urgency==='medium');
  const [detailId,setDetailId]=useState(null);
  if(detailId){const p=tcPatients.find(x=>x.id===detailId);if(!p){setDetailId(null);return null;}return <TcPatientDetail patient={p} user={user} isManager={isManager} users={[]} onBack={()=>setDetailId(null)} saveTcPatient={saveTcPatient} notify={notify}/>;}
  const Card=({a})=>(
    <div onClick={()=>setDetailId(a.patient.id)} style={{background:'white',borderRadius:12,border:`1px solid ${a.urgency==='high'?'#fecaca':'#fde68a'}`,padding:'14px 18px',cursor:'pointer',display:'flex',alignItems:'center',gap:12}}>
      <div style={{width:40,height:40,borderRadius:'50%',background:a.urgency==='high'?'#fee2e2':'#fef3c7',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
        {a.type==='call'?<IcoPhone size={18} style={{color:a.urgency==='high'?'#dc2626':'#d97706'}}/>:<IcoClock size={18} style={{color:a.urgency==='high'?'#dc2626':'#d97706'}}/>}
      </div>
      <div style={{flex:1}}>
        <div style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>{a.patient.patient_name}</div>
        <div style={{fontSize:12,color:a.urgency==='high'?'#dc2626':'#d97706',fontWeight:600,marginTop:2}}>{a.msg}</div>
        <div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>{a.patient.treatment_type||'—'} · {USD(a.patient.treatment_value)}{isManager&&a.patient.assigned_tc_name?` · TC: ${a.patient.assigned_tc_name}`:''}</div>
      </div>
      <IcoChevR size={16} style={{color:'#94a3b8'}}/>
    </div>
  );
  return(
    <div style={{maxWidth:800,margin:'0 auto',padding:'28px 20px'}}>
      <h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',marginBottom:4}}>TC Alerts & Reminders</h1>
      <p style={{color:'#94a3b8',fontSize:13,marginBottom:24}}>{alerts.length} active alert{alerts.length!==1?'s':''}</p>
      {alerts.length===0&&<div style={{textAlign:'center',padding:80,color:'#94a3b8',background:'white',borderRadius:12,border:'1px solid #e2e8f0'}}>🎉 No alerts right now. All patients are on track!</div>}
      {high.length>0&&<><div style={{fontSize:11,fontWeight:800,color:'#dc2626',letterSpacing:2,marginBottom:10}}>HIGH PRIORITY — ACTION NEEDED TODAY</div><div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:24}}>{high.map((a,i)=><Card key={i} a={a}/>)}</div></>}
      {medium.length>0&&<><div style={{fontSize:11,fontWeight:800,color:'#d97706',letterSpacing:2,marginBottom:10}}>FOLLOW-UP NEEDED</div><div style={{display:'flex',flexDirection:'column',gap:10}}>{medium.map((a,i)=><Card key={i} a={a}/>)}</div></>}
    </div>
  );
}

// ── TC Dashboard Page ───────────────────────────────────────────────────────


export default TcAlertsPage
