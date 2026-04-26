import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoX,IcoCheck,IcoEdit,IcoAlert,IcoClock,IcoPhone,IcoChevR,IcoChevD,IcoChevU,IcoCloud,IcoUsers,IcoBell,IcoStar } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function TcDashboardPage({tcPatients,users}){
  const [period,setPeriod]=useState('month');
  const mStart=todayStr().slice(0,7);
  const tcUsers=users.filter(u=>['treatment_coordinator','manager','admin'].includes(u.role));
  const filterComp=p=>p.status==='completed'&&p.completed_date&&(period==='all'||p.completed_date.slice(0,7)===mStart);
  const presented=tcPatients.filter(p=>p.status!=='consult');
  const accepted=tcPatients.filter(p=>!['consult','tx_presented','declined','lost'].includes(p.status));
  const completed=tcPatients.filter(filterComp);
  const tcStats=tcUsers.map(tc=>{
    const mine=tcPatients.filter(p=>p.assigned_tc_id===tc.id);
    const myPres=mine.filter(p=>p.status!=='consult');
    const myAcc=mine.filter(p=>!['consult','tx_presented','declined','lost'].includes(p.status));
    const myComp=mine.filter(filterComp);
    return{tc,total:mine.length,presented:myPres.length,accepted:myAcc.length,completed:myComp.length,valuePres:myPres.reduce((s,p)=>s+N(p.treatment_value),0),valueAcc:myAcc.reduce((s,p)=>s+N(p.treatment_value),0),production:myComp.reduce((s,p)=>s+N(p.production_value||p.treatment_value),0),alerts:getTcAlerts(mine,{id:tc.id},false).length};
  }).filter(s=>s.total>0).sort((a,b)=>b.production-a.production);
  const pn=(a,b)=>N(b)>0?(N(a)/N(b)*100):0;
  return(
    <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:24,flexWrap:'wrap',gap:12}}>
        <div><h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',margin:0}}>TC Performance Dashboard</h1><p style={{color:'#94a3b8',fontSize:13,marginTop:4}}>Production & case acceptance by treatment coordinator</p></div>
        <div style={{display:'flex',gap:4,background:'white',padding:4,borderRadius:10,border:'1px solid #e2e8f0'}}>
          {[['month','This Month'],['all','All Time']].map(([id,l])=><button key={id} onClick={()=>setPeriod(id)} style={{padding:'7px 16px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:period===id?'#0d9488':'transparent',color:period===id?'white':'#64748b'}}>{l}</button>)}
        </div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
        {[['Total Active',tcPatients.filter(p=>!['declined','lost'].includes(p.status)).length,`${tcPatients.length} total`,'#1e293b'],['TX Value Presented',USD(presented.reduce((s,p)=>s+N(p.treatment_value),0)),`${presented.length} patients`,'#1e293b'],['TX Value Accepted',USD(accepted.reduce((s,p)=>s+N(p.treatment_value),0)),`${PCT(accepted.length,presented.length)} acceptance rate`,'#0d9488'],['Production ('+period+')',USD(completed.reduce((s,p)=>s+N(p.production_value||p.treatment_value),0)),`${completed.length} cases completed`,'#16a34a']].map(([l,v,s,c])=>(
          <div key={l} style={{background:'white',borderRadius:12,padding:'18px 20px',border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#94a3b8',letterSpacing:1,marginBottom:4}}>{l.toUpperCase()}</div>
            <div style={{fontSize:22,fontWeight:800,color:c}}>{v}</div>
            <div style={{fontSize:11,color:'#64748b',marginTop:3}}>{s}</div>
          </div>
        ))}
      </div>
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:20,marginBottom:24}}>
        <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',marginBottom:14,letterSpacing:2}}>PIPELINE OVERVIEW</div>
        <div style={{display:'flex',gap:8,overflowX:'auto'}}>
          {TC_PIPELINE.map(s=>{const st=TC_STATUS_MAP[s];const cnt=tcPatients.filter(p=>p.status===s).length;const val=tcPatients.filter(p=>p.status===s).reduce((sum,p)=>sum+N(p.treatment_value),0);return(
            <div key={s} style={{flex:'1 1 100px',padding:'12px 14px',borderRadius:10,background:st.bg,textAlign:'center',flexShrink:0}}>
              <div style={{fontSize:22,fontWeight:800,color:st.color}}>{cnt}</div>
              <div style={{fontSize:9,fontWeight:700,color:st.color,marginTop:2}}>{st.label}</div>
              <div style={{fontSize:11,color:st.color,opacity:.7,marginTop:4}}>{USD(val)}</div>
            </div>
          );})}
        </div>
      </div>
      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
        <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',padding:'16px 20px',borderBottom:'1px solid #f1f5f9',letterSpacing:2}}>BY TREATMENT COORDINATOR</div>
        {tcStats.length===0?<div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>No TC data yet.</div>:(
          <table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr style={{background:'#f8fafc'}}>{['TC','Patients','Presented','Accepted','Accept Rate','Value Presented','Value Accepted','Production','Alerts'].map(h=><th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:1,borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h.toUpperCase()}</th>)}</tr></thead>
            <tbody>{tcStats.map(s=>{const ar=pn(s.accepted,s.presented);return(
              <tr key={s.tc.id} style={{borderBottom:'1px solid #f1f5f9'}}>
                <td style={{padding:'13px 14px'}}><div style={{fontSize:13,fontWeight:700,color:'#1e293b'}}>{s.tc.name}</div><div style={{fontSize:11,color:'#94a3b8'}}>{s.tc.office}</div></td>
                <td style={{padding:'13px 14px',fontSize:13,textAlign:'center',color:'#475569'}}>{s.total}</td>
                <td style={{padding:'13px 14px',fontSize:13,textAlign:'center',color:'#475569'}}>{s.presented}</td>
                <td style={{padding:'13px 14px',fontSize:13,textAlign:'center',color:'#475569'}}>{s.accepted}</td>
                <td style={{padding:'13px 14px'}}><span style={{fontSize:12,fontWeight:700,padding:'2px 10px',borderRadius:99,background:ar>=70?'#dcfce7':ar>=50?'#fef3c7':'#fee2e2',color:ar>=70?'#16a34a':ar>=50?'#d97706':'#dc2626'}}>{PCT(s.accepted,s.presented)}</span></td>
                <td style={{padding:'13px 14px',fontSize:12,color:'#475569'}}>{USD(s.valuePres)}</td>
                <td style={{padding:'13px 14px',fontSize:12,color:'#0d9488',fontWeight:600}}>{USD(s.valueAcc)}</td>
                <td style={{padding:'13px 14px',fontSize:13,fontWeight:700,color:'#16a34a'}}>{USD(s.production)}</td>
                <td style={{padding:'13px 14px'}}>{s.alerts>0?<span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:99,background:'#fee2e2',color:'#dc2626'}}>{s.alerts}</span>:<span style={{fontSize:11,color:'#94a3b8'}}>—</span>}</td>
              </tr>
            );})}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// DENTRIX ASCEND IMPORT MODULE
// ════════════════════════════════════════════════════════════════════════════

// ── Number parser handles 1,234.56 / -1.53k / -1.47k formats ─────────────


export default TcDashboardPage
