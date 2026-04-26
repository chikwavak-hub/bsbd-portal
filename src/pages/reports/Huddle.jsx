import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function MorningHuddlePage({reports, providers, tcPatients, users, notify}) {
  const today     = todayStr();
  const todayDt   = new Date(today + 'T12:00:00');
  const yr        = todayDt.getFullYear();
  const mo        = todayDt.getMonth() + 1;
  const mStart    = `${yr}-${String(mo).padStart(2,'0')}-01`;
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MON_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const wdInMonth = workingDaysInMonth(yr, mo);
  const wdSoFar   = workingDaysSoFar(today);
  const wdLeft    = wdInMonth - wdSoFar;

  // ── Office selection ─────────────────────────────────────────────────────
  const [selOffice, setSelOffice] = useState(null); // null = overview

  // Which providers working today per office
  const [working, setWorking] = useState(() => {
    const init = {};
    providers.forEach(p => { init[p.id] = true; });
    return init;
  });
  const toggleWorking = id => setWorking(w => ({...w, [id]: !w[id]}));

  const [schedules, setSchedules] = useState({});
  const [open, setOpen] = useState({actions:true, perf:true, providers:true, tc:true, mtd:true});
  const tog = k => setOpen(s => ({...s, [k]: !s[k]}));

  // Latest report per office
  const latestByOffice = {};
  OFFICES.forEach(o => {
    const sorted = reports.filter(r => r.office === o).sort((a,b) => b.date.localeCompare(a.date));
    latestByOffice[o] = sorted[0] || null;
  });

  const mtdAll = reports.filter(r => r.date >= mStart && r.date <= today);

  // ── Per-office computed stats ────────────────────────────────────────────
  const officeStats = OFFICES.map(o => {
    const offProviders = providers.filter(p => p.office === o);
    const dailyGoal    = offProviders.reduce((s,p) => s + N(p.goal), 0);
    const activeGoal   = offProviders.filter(p=>working[p.id]).reduce((s,p)=>s+N(p.goal),0);
    const offMtd       = mtdAll.filter(r => r.office === o);
    const mtdProd      = offMtd.reduce((s,r) => s + repProd(r), 0);
    const mtdColl      = offMtd.reduce((s,r) => s + repColl(r), 0);
    const mtdGoal      = dailyGoal * wdSoFar;
    const projected    = wdSoFar > 0 ? (mtdProd / wdSoFar) * wdInMonth : 0;
    const latest       = latestByOffice[o];
    const latestProd   = latest ? repProd(latest) : 0;
    const latestGoal   = latest ? repGoal(latest, providers) : 0;
    const latestColl   = latest ? repColl(latest) : 0;
    const achPct       = pctNum(latestProd, latestGoal);
    // Alerts for this office
    const offTcPatients = tcPatients.filter(p => p.office === o);
    const offAlerts     = getTcAlerts(offTcPatients, {role:'admin'}, true);
    const offTcToday    = offTcPatients.filter(p => p.appointment_date === today && !['completed','declined','lost'].includes(p.status));
    const actions = [];
    const tcUrgent = offAlerts.filter(a=>a.urgency==='high');
    const tcMed    = offAlerts.filter(a=>a.urgency==='medium');
    if (tcUrgent.length > 0) actions.push({level:'red',  icon:'📞', text:`${tcUrgent.length} TC patient call${tcUrgent.length>1?'s':''} overdue`});
    if (latest) {
      const ns = N(latest.sched?.noShows), re = N(latest.sched?.rescheduled);
      if (ns > re) actions.push({level:'red', icon:'❌', text:`${ns-re} no-show${ns-re>1?'s':''} from ${latest.date===today?'today':'yesterday'} still need rescheduling`});
      if (latest.date !== today && latestGoal > 0 && latestProd < latestGoal * 0.9)
        actions.push({level:'amber', icon:'📉', text:`Hit ${PCT(latestProd,latestGoal)} of goal ${latest.date} — confirm today's schedule is full`});
    }
    if (offTcToday.length > 0) actions.push({level:'amber', icon:'🦷', text:`${offTcToday.length} big-treatment patient${offTcToday.length>1?'s':''} arriving today — confirm payment set up`});
    if (tcMed.length > 0)      actions.push({level:'amber', icon:'⏰', text:`${tcMed.length} TC patient${tcMed.length>1?'s':''} need a follow-up call this week`});
    const esc = reports.filter(r=>r.office===o).slice(0,10).filter(r=>N(r.claims?.escalations)>0);
    if (esc.length>0) { const tot=esc.reduce((s,r)=>s+N(r.claims?.escalations),0); actions.push({level:'amber',icon:'📋',text:`${tot} open claims escalation${tot>1?'s':''}`}); }
    return { o, offProviders, dailyGoal, activeGoal, offMtd: offMtd.length, mtdProd, mtdColl, mtdGoal, projected,
             latest, latestProd, latestGoal, latestColl, achPct, offTcToday, offAlerts, actions };
  });

  const BannerItem = ({level, icon, text}) => {
    const c = {red:{bg:'#fee2e2',border:'#fecaca',text:'#dc2626'}, amber:{bg:'#fef3c7',border:'#fde68a',text:'#d97706'}}[level]||{bg:'#fef3c7',border:'#fde68a',text:'#d97706'};
    return <div style={{display:'flex',alignItems:'flex-start',gap:10,padding:'10px 14px',borderRadius:10,background:c.bg,border:`1px solid ${c.border}`,marginBottom:8}}><span style={{fontSize:16,flexShrink:0}}>{icon}</span><span style={{fontSize:13,fontWeight:600,color:c.text,lineHeight:1.4}}>{text}</span></div>;
  };
  const Sec = ({id,title,emoji,children,count}) => (
    <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',marginBottom:16,overflow:'hidden'}}>
      <button onClick={()=>tog(id)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'14px 20px',background:'none',border:'none',cursor:'pointer',borderBottom:open[id]?'1px solid #e2e8f0':'none'}}>
        <span style={{fontSize:18}}>{emoji}</span>
        <span style={{fontWeight:700,fontSize:15,color:'#1e293b',flex:1,textAlign:'left'}}>{title}</span>
        {count!=null&&<span style={{fontSize:11,fontWeight:700,padding:'2px 10px',borderRadius:99,background:'#f1f5f9',color:'#64748b'}}>{count}</span>}
        {open[id]?<IcoChevU size={16} style={{color:'#94a3b8'}}/>:<IcoChevD size={16} style={{color:'#94a3b8'}}/>}
      </button>
      {open[id]&&<div style={{padding:'16px 20px'}}>{children}</div>}
    </div>
  );

  // ════════════════════════════════════════════════════════════════════════
  // OVERVIEW — all offices at a glance
  // ════════════════════════════════════════════════════════════════════════
  if (!selOffice) {
    const totalUrgent = officeStats.reduce((s,o)=>s+o.actions.filter(a=>a.level==='red').length,0);
    return (
      <div style={{maxWidth:1100,margin:'0 auto',padding:'24px 20px 60px'}}>
        {/* Header */}
        <div style={{background:'linear-gradient(135deg,#0f172a,#1e3a5f 50%,#1a6b8a)',borderRadius:16,padding:'24px 32px',marginBottom:20,color:'white',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:16}}>
          <div>
            <div style={{fontSize:12,opacity:.5,fontWeight:700,letterSpacing:2,marginBottom:4}}>{DAY_NAMES[todayDt.getDay()].toUpperCase()}</div>
            <h1 style={{fontSize:26,fontWeight:800,margin:'0 0 4px'}}>Good Morning ☀️</h1>
            <div style={{fontSize:14,opacity:.65}}>{MON_NAMES[mo-1]} {todayDt.getDate()}, {yr} — Day {wdSoFar} of {wdInMonth}</div>
          </div>
          <div style={{display:'flex',gap:24,flexWrap:'wrap'}}>
            <div style={{textAlign:'center'}}><div style={{fontSize:28,fontWeight:800}}>{wdLeft}</div><div style={{fontSize:10,opacity:.5,letterSpacing:1,fontWeight:700}}>DAYS LEFT</div></div>
            <div style={{textAlign:'center'}}><div style={{fontSize:28,fontWeight:800,color:totalUrgent>0?'#f87171':'#4ade80'}}>{totalUrgent}</div><div style={{fontSize:10,opacity:.5,letterSpacing:1,fontWeight:700}}>URGENT ACTIONS</div></div>
          </div>
          <button onClick={()=>window.print()} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 18px',borderRadius:10,border:'1px solid rgba(255,255,255,.25)',background:'transparent',color:'rgba(255,255,255,.7)',fontWeight:700,fontSize:13,cursor:'pointer'}}><IcoPrint size={14}/> Print</button>
        </div>

        {/* Instructions */}
        <div style={{background:'#eff6ff',borderRadius:12,border:'1px solid #bfdbfe',padding:'12px 18px',marginBottom:20,fontSize:13,color:'#1e40af',display:'flex',gap:10,alignItems:'center'}}>
          <span style={{fontSize:20}}>👆</span>
          <span>Select an office below to open its full morning huddle sheet with actions, providers, TC patients, and MTD trajectory.</span>
        </div>

        {/* Office cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:16}}>
          {officeStats.map(({o, latest, latestProd, latestGoal, latestColl, achPct, actions, mtdProd, mtdGoal, projected, dailyGoal, offMtd}) => {
            const v = latestProd - latestGoal;
            const color  = achPct>=100?'#16a34a':achPct>=80?'#d97706':'#dc2626';
            const bg     = achPct>=100?'#f0fdf4':achPct>=80?'#fffbeb':'#fef2f2';
            const border = achPct>=100?'#bbf7d0':achPct>=80?'#fde68a':'#fecaca';
            const urgentCount = actions.filter(a=>a.level==='red').length;
            const projGoal = dailyGoal * wdInMonth;
            const onTrack = projected >= projGoal * 0.95;
            return (
              <button key={o} onClick={()=>setSelOffice(o)}
                style={{textAlign:'left',borderRadius:14,border:`2px solid ${border}`,padding:0,background:bg,cursor:'pointer',overflow:'hidden',transition:'transform .15s,box-shadow .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,.1)';}}
                onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none';}}>
                {/* Card header */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 18px',borderBottom:`1px solid ${border}`}}>
                  <span style={{fontWeight:800,fontSize:16,color:'#1e293b'}}>{o}</span>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    {urgentCount>0&&<span style={{fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:99,background:'#fee2e2',color:'#dc2626'}}>⚠ {urgentCount} urgent</span>}
                    {!latest&&<span style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>No report yet</span>}
                    {latest&&<span style={{fontSize:11,fontWeight:800,padding:'3px 10px',borderRadius:99,background:'white',color}}>{PCT(latestProd,latestGoal)}</span>}
                  </div>
                </div>
                {/* Card body */}
                <div style={{padding:'14px 18px'}}>
                  {!latest
                    ? <div style={{textAlign:'center',padding:'20px 0',color:'#94a3b8',fontSize:13}}>📭 No report submitted yet</div>
                    : <>
                        {/* Progress bar */}
                        <div style={{height:7,borderRadius:4,background:'rgba(0,0,0,.08)',overflow:'hidden',marginBottom:12}}>
                          <div style={{height:'100%',borderRadius:4,width:Math.min(achPct,100)+'%',background:color,transition:'width .5s'}}/>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:12}}>
                          {[['Last Report',latest.date!==today?latest.date:'Today','#64748b'],['Net Production',USD(latestProd),color],['Variance',(v>=0?'+':'')+USD(v),v>=0?'#16a34a':'#dc2626'],['Collections',USD(latestColl),'#0d9488'],['No-Shows',latest.sched?.noShows||0,N(latest.sched?.noShows)>2?'#dc2626':'#475569'],['MTD Pace',onTrack?'✓ On Track':'⚠ Behind',onTrack?'#16a34a':'#dc2626']].map(([l,v2,c])=>(
                            <div key={l} style={{background:'rgba(255,255,255,.7)',borderRadius:8,padding:'8px 10px'}}>
                              <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,letterSpacing:.5,marginBottom:2}}>{l.toUpperCase()}</div>
                              <div style={{fontSize:12,fontWeight:800,color:c}}>{v2}</div>
                            </div>
                          ))}
                        </div>
                      </>
                  }
                  {/* Action previews */}
                  {actions.slice(0,2).map((a,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 0',borderTop:i===0?'1px solid rgba(0,0,0,.06)':'none',fontSize:12,color:a.level==='red'?'#dc2626':'#d97706',fontWeight:600}}>
                      <span>{a.icon}</span><span>{a.text}</span>
                    </div>
                  ))}
                  {actions.length===0&&<div style={{fontSize:12,color:'#16a34a',fontWeight:600,borderTop:'1px solid rgba(0,0,0,.06)',paddingTop:8}}>✓ No actions needed</div>}
                  <div style={{marginTop:10,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:4,fontSize:12,color:'#1d4ed8',fontWeight:700}}>Open huddle <IcoChevR size={13}/></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // SINGLE OFFICE HUDDLE SHEET
  // ════════════════════════════════════════════════════════════════════════
  const os = officeStats.find(s => s.o === selOffice);
  const {latest, latestProd, latestGoal, latestColl, achPct, actions, offTcToday,
         mtdProd, mtdGoal, projected, dailyGoal, offProviders} = os;
  const projGoal = dailyGoal * wdInMonth;
  const onTrack  = projected >= projGoal * 0.95;
  const offWorking = offProviders.filter(p => working[p.id]);
  const offGoalToday = offWorking.reduce((s,p)=>s+N(p.goal),0);
  const schedVal = N(schedules[selOffice]);
  const schedDiff = schedVal - offGoalToday;

  return (
    <div style={{maxWidth:900,margin:'0 auto',padding:'24px 20px 60px'}}>
      {/* Back */}
      <button onClick={()=>setSelOffice(null)} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:13,fontWeight:600,marginBottom:16}}>← All Offices</button>

      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#0f172a,#1e3a5f 50%,#1a6b8a)',borderRadius:16,padding:'22px 28px',marginBottom:20,color:'white',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:16}}>
        <div>
          <div style={{fontSize:12,opacity:.5,fontWeight:700,letterSpacing:2,marginBottom:4}}>{DAY_NAMES[todayDt.getDay()].toUpperCase()} · MORNING HUDDLE</div>
          <h1 style={{fontSize:24,fontWeight:800,margin:'0 0 3px'}}>{selOffice} Office ☀️</h1>
          <div style={{fontSize:13,opacity:.65}}>{MON_NAMES[mo-1]} {todayDt.getDate()}, {yr} — Day {wdSoFar} of {wdInMonth} · {wdLeft} working days left</div>
        </div>
        <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
          <div style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800}}>{USD(offGoalToday)}</div><div style={{fontSize:10,opacity:.5,letterSpacing:1,fontWeight:700}}>TODAY'S GOAL</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800,color:actions.filter(a=>a.level==='red').length>0?'#f87171':'#4ade80'}}>{actions.filter(a=>a.level==='red').length}</div><div style={{fontSize:10,opacity:.5,letterSpacing:1,fontWeight:700}}>URGENT ACTIONS</div></div>
          <div style={{textAlign:'center'}}><div style={{fontSize:24,fontWeight:800,color:onTrack?'#4ade80':'#f87171'}}>{onTrack?'✓':'⚠'}</div><div style={{fontSize:10,opacity:.5,letterSpacing:1,fontWeight:700}}>MTD PACE</div></div>
        </div>
        <button onClick={()=>window.print()} style={{display:'flex',alignItems:'center',gap:7,padding:'9px 18px',borderRadius:10,border:'1px solid rgba(255,255,255,.25)',background:'transparent',color:'rgba(255,255,255,.7)',fontWeight:700,fontSize:13,cursor:'pointer'}}><IcoPrint size={14}/> Print</button>
      </div>

      {/* Actions */}
      <Sec id="actions" title="Actions Needed Today" emoji="🚨" count={actions.length}>
        {actions.length===0
          ?<div style={{textAlign:'center',padding:24,color:'#94a3b8',fontSize:13}}>🎉 Nothing urgent — have a great day!</div>
          :<>
            {actions.filter(a=>a.level==='red').map((a,i) =><BannerItem key={i} {...a}/>)}
            {actions.filter(a=>a.level==='amber').map((a,i)=><BannerItem key={i} {...a}/>)}
          </>
        }
      </Sec>

      {/* Yesterday's performance */}
      {latest&&(
        <Sec id="perf" title={`${latest.date===today?"Today's":"Yesterday's"} Performance — ${latest.date}`} emoji="📊">
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:12}}>
            {[['Net Production',USD(latestProd),achPct>=100?'#16a34a':achPct>=80?'#d97706':'#dc2626'],['Goal',USD(latestGoal),'#64748b'],['Variance',(latestProd-latestGoal>=0?'+':'')+USD(latestProd-latestGoal),latestProd>=latestGoal?'#16a34a':'#dc2626'],['Collections',USD(latestColl),'#0d9488'],['No-Shows',latest.sched?.noShows||0,N(latest.sched?.noShows)>2?'#dc2626':'#475569'],['Cancelled',latest.sched?.cancelled||0,N(latest.sched?.cancelled)>3?'#d97706':'#475569'],['Recall Rate',PCT(latest.sched?.recallsSched,latest.sched?.recalls),'#475569'],['NP Conv',PCT(latest.sched?.npCallsSched,latest.sched?.npCalls),'#475569'],['Achievement',PCT(latestProd,latestGoal),achPct>=100?'#16a34a':'#dc2626']].map(([l,v,c])=>(
              <div key={l} style={{background:'#f8fafc',borderRadius:10,padding:'10px 14px',border:'1px solid #e2e8f0'}}>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,letterSpacing:.5,marginBottom:4}}>{l.toUpperCase()}</div>
                <div style={{fontSize:16,fontWeight:800,color:c}}>{v}</div>
              </div>
            ))}
          </div>
          {latest.notes&&<div style={{padding:'10px 14px',background:'#fffbeb',borderRadius:10,border:'1px solid #fde68a',fontSize:12,color:'#78350f'}}><b>📌 Notes from last report:</b> {latest.notes}</div>}
        </Sec>
      )}

      {/* Today's providers */}
      <Sec id="providers" title="Today's Providers" emoji="🩺">
        <p style={{fontSize:12,color:'#94a3b8',marginBottom:12}}>Toggle off any provider who is out today.</p>
        <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
          {offProviders.map(p=>(
            <div key={p.id} onClick={()=>toggleWorking(p.id)} style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderRadius:10,border:`2px solid ${working[p.id]?'#1d4ed8':'#e2e8f0'}`,background:working[p.id]?'#eff6ff':'#f8fafc',cursor:'pointer'}}>
              <div style={{width:20,height:20,borderRadius:'50%',background:working[p.id]?'#1d4ed8':'#e2e8f0',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                {working[p.id]&&<IcoCheck size={11} style={{color:'white'}}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,fontWeight:700,color:working[p.id]?'#1d4ed8':'#94a3b8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.name}</div>
                <div style={{fontSize:10,color:'#94a3b8'}}>{USD(p.goal)}/day</div>
              </div>
            </div>
          ))}
        </div>
        {/* Opening schedule */}
        <div style={{borderTop:'1px solid #e2e8f0',paddingTop:14}}>
          <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:8}}>OPENING SCHEDULE (optional — enter from Dentrix)</div>
          <div style={{display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
            <div style={{position:'relative',width:180}}>
              <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',color:'#94a3b8',fontSize:13,pointerEvents:'none'}}>$</span>
              <input type="number" min="0" className="ic" style={{paddingLeft:22}} value={schedules[selOffice]||''} onChange={e=>setSchedules(s=>({...s,[selOffice]:e.target.value}))} placeholder={offGoalToday>0?offGoalToday.toString():'0'}/>
            </div>
            {schedVal>0&&offGoalToday>0&&(
              <span style={{fontSize:13,fontWeight:700,color:schedDiff>=0?'#16a34a':'#dc2626'}}>
                {schedDiff>=0?'▲':'▼'} {USD(Math.abs(schedDiff))} {schedDiff>=0?'above':'below'} today's goal of {USD(offGoalToday)}
              </span>
            )}
          </div>
        </div>
      </Sec>

      {/* TC patients today */}
      {offTcToday.length>0&&(
        <Sec id="tc" title="Big Treatment Patients — Arriving Today" emoji="🦷" count={offTcToday.length}>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {offTcToday.map(p=>{
              const als=getTcAlerts([p],{role:'admin'},true);
              return(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:14,padding:'12px 16px',borderRadius:10,background:'#f0fdfa',border:'1px solid #99f6e4'}}>
                  <div style={{width:40,height:40,borderRadius:'50%',background:'#0d9488',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    <span style={{color:'white',fontSize:16,fontWeight:800}}>{p.patient_name[0]}</span>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14,color:'#134e4a'}}>{p.patient_name}</div>
                    <div style={{fontSize:12,color:'#0d9488',marginTop:2}}>{p.treatment_type||'Treatment'} · {USD(p.treatment_value)} · {p.payment_method||'Payment not confirmed'}</div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:4,alignItems:'flex-end'}}>
                    <TcStatusBadge status={p.status}/>
                    {als.length>0&&<span style={{fontSize:10,fontWeight:700,color:'#dc2626',background:'#fee2e2',padding:'2px 8px',borderRadius:99}}>{als.length} alert{als.length>1?'s':''}</span>}
                    <div style={{fontSize:11,color:'#94a3b8'}}>TC: {p.assigned_tc_name||'Unassigned'}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Sec>
      )}

      {/* MTD trajectory */}
      <Sec id="mtd" title="Month-to-Date Trajectory" emoji="📈">
        <div style={{marginBottom:12,display:'flex',gap:16,flexWrap:'wrap'}}>
          <span style={{fontSize:12,color:'#64748b',fontWeight:600}}>Completed: <b style={{color:'#1e293b'}}>{wdSoFar} days</b></span>
          <span style={{fontSize:12,color:'#64748b',fontWeight:600}}>Remaining: <b style={{color:'#1e293b'}}>{wdLeft} days</b></span>
          <span style={{fontSize:12,color:'#64748b',fontWeight:600}}>Reports submitted: <b style={{color:'#1e293b'}}>{os.offMtd}</b></span>
        </div>
        <div style={{height:12,borderRadius:6,background:'#e2e8f0',overflow:'hidden',marginBottom:16}}>
          <div style={{height:'100%',borderRadius:6,width:Math.min(pctNum(mtdProd,mtdGoal),100)+'%',background:onTrack?'#16a34a':'#dc2626',transition:'width .5s'}}/>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:10}}>
          {[['MTD Production',USD(mtdProd),onTrack?'#16a34a':'#dc2626'],['MTD Goal',USD(mtdGoal),'#64748b'],['Projected Month-End',USD(projected),onTrack?'#16a34a':'#dc2626'],['Monthly Goal',USD(projGoal),'#64748b']].map(([l,v,c])=>(
            <div key={l} style={{background:'#f8fafc',borderRadius:10,padding:'12px 14px',border:'1px solid #e2e8f0'}}>
              <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,letterSpacing:.5,marginBottom:4}}>{l.toUpperCase()}</div>
              <div style={{fontSize:16,fontWeight:800,color:c}}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{marginTop:12,display:'flex',alignItems:'center',gap:10}}>
          <span style={{fontSize:13,fontWeight:700,padding:'5px 14px',borderRadius:99,background:onTrack?'#dcfce7':'#fee2e2',color:onTrack?'#16a34a':'#dc2626'}}>
            {onTrack?`✓ On Track — projected to finish ${USD(projected - projGoal)} above goal`:`⚠ Behind Pace — projected to miss goal by ${USD(projGoal - projected)}`}
          </span>
        </div>
      </Sec>

    </div>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(<App/>);


export default MorningHuddlePage
