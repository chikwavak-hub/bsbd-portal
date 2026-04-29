import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoX,IcoCheck,IcoEdit,IcoAlert,IcoClock,IcoPhone,IcoChevR,IcoChevD,IcoChevU,IcoCloud,IcoUsers,IcoBell,IcoStar } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct,tcDiffDays } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

const tcNewId = () => 'tp_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)


function TcPatientsPage({user,tcPatients,isManager,users,saveTcPatient,loadTcPatients,notify,deleteTcPatient}){
  const [showAdd,setShowAdd]=useState(false);
  const [filter,setFilter]=useState('all');
  const [search,setSearch]=useState('');
  const [offFilter,setOffFilter]=useState('all');
  const [detailId,setDetailId]=useState(null);

  if(detailId){
    const p=tcPatients.find(x=>x.id===detailId);
    if(!p){setDetailId(null);return null;}
    return <TcPatientDetail patient={p} user={user} isManager={isManager} users={users} onBack={()=>setDetailId(null)} saveTcPatient={saveTcPatient} deleteTcPatient={deleteTcPatient} notify={notify}/>;
  }

  const mine=isManager?tcPatients:tcPatients.filter(p=>p.assigned_tc_id===user.id);
  const filtered=mine.filter(p=>{
    if(filter!=='all'&&p.status!==filter)return false;
    if(offFilter!=='all'&&p.office!==offFilter)return false;
    if(search&&!p.patient_name.toLowerCase().includes(search.toLowerCase()))return false;
    return true;
  });
  const active=mine.filter(p=>!['completed','declined','lost'].includes(p.status));
  const mStart=todayStr().slice(0,7);
  const doneThisMonth=mine.filter(p=>p.status==='completed'&&p.completed_date?.slice(0,7)===mStart);

  return(
    <div style={{maxWidth:1100,margin:'0 auto',padding:'28px 20px'}}>
      {showAdd&&<TcAddModal user={user} isManager={isManager} users={users} onClose={()=>setShowAdd(false)} saveTcPatient={saveTcPatient} notify={notify}/>}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',margin:0}}>Big Treatment Patients</h1>
          <p style={{color:'#94a3b8',fontSize:13,marginTop:4}}>{active.length} active · {doneThisMonth.length} completed this month</p>
        </div>
        <button onClick={()=>setShowAdd(true)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 22px',borderRadius:10,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}><IcoPlus size={16}/> Add Patient</button>
      </div>

      <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'14px 16px',marginBottom:16,display:'flex',alignItems:'center',flexWrap:'wrap',gap:10}}>
        <input className="ic" style={{maxWidth:200}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name…"/>
        <select className="ic" style={{width:'auto'}} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {TC_STATUSES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {isManager&&<select className="ic" style={{width:'auto'}} value={offFilter} onChange={e=>setOffFilter(e.target.value)}><option value="all">All Offices</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</select>}
        <button onClick={loadTcPatients} style={{padding:'8px 14px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>↻ Refresh</button>
      </div>

      {/* Pipeline strip */}
      <div style={{display:'flex',gap:8,marginBottom:20,overflowX:'auto',paddingBottom:4}}>
        {TC_PIPELINE.map(s=>{const st=TC_STATUS_MAP[s];const cnt=mine.filter(p=>p.status===s).length;return(
          <button key={s} onClick={()=>setFilter(filter===s?'all':s)} style={{display:'flex',flexDirection:'column',alignItems:'center',padding:'10px 16px',borderRadius:10,border:`2px solid ${filter===s?st.color:'#e2e8f0'}`,background:filter===s?st.bg:'white',cursor:'pointer',flexShrink:0,minWidth:90}}>
            <span style={{fontSize:18,fontWeight:800,color:st.color}}>{cnt}</span>
            <span style={{fontSize:9,fontWeight:700,color:st.color,marginTop:2,textAlign:'center'}}>{st.label}</span>
          </button>
        );})}
      </div>

      {filtered.length===0
        ?<div style={{textAlign:'center',padding:60,color:'#94a3b8',background:'white',borderRadius:12,border:'1px solid #e2e8f0'}}>No patients match this filter.</div>
        :<div style={{display:'flex',flexDirection:'column',gap:12}}>
          {filtered.map(p=>{
            const als=getTcAlerts([p],user,isManager);
            const pct=tcChecklistPct(p.checklist||{});
            const today2=todayStr();
            const daysToAppt=p.appointment_date?tcDiffDays(today2,p.appointment_date):null;
            return(
              <div key={p.id} onClick={()=>setDetailId(p.id)} style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'16px 20px',cursor:'pointer'}}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,flexWrap:'wrap'}}>
                      <span style={{fontSize:16,fontWeight:800,color:'#1e293b'}}>{p.patient_name}</span>
                      <TcStatusBadge status={p.status}/>
                      {als.length>0&&<span style={{display:'flex',alignItems:'center',gap:4,fontSize:11,fontWeight:700,color:'#dc2626',background:'#fee2e2',padding:'2px 8px',borderRadius:99}}><IcoAlert size={11}/> {als.length} alert{als.length>1?'s':''}</span>}
                    </div>
                    <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12,color:'#64748b'}}>
                      {p.treatment_type&&<span><b style={{color:'#475569'}}>TX:</b> {p.treatment_type}</span>}
                      {p.treatment_value>0&&<span><b style={{color:'#475569'}}>Value:</b> {USD(p.treatment_value)}</span>}
                      {p.doctor&&<span><b style={{color:'#475569'}}>Dr:</b> {p.doctor}</span>}
                      {isManager&&p.assigned_tc_name&&<span><b style={{color:'#475569'}}>TC:</b> {p.assigned_tc_name}</span>}
                      {p.office&&<span><b style={{color:'#475569'}}>Office:</b> {p.office}</span>}
                      {p.appointment_date&&<span style={{color:daysToAppt!==null&&daysToAppt<0?'#dc2626':daysToAppt<=3?'#d97706':'#64748b'}}><b style={{color:'inherit'}}>Appt:</b> {fmtDate(p.appointment_date)} {daysToAppt!==null&&`(${daysToAppt<0?Math.abs(daysToAppt)+'d ago':'in '+daysToAppt+'d'})`}</span>}
                    </div>
                  </div>
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:4,flexShrink:0}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:`conic-gradient(#0d9488 ${pct*3.6}deg,#e2e8f0 0deg)`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <div style={{width:32,height:32,borderRadius:'50%',background:'white',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,color:'#0d9488'}}>{pct}%</div>
                    </div>
                    <span style={{fontSize:9,color:'#94a3b8',fontWeight:600}}>CHECKLIST</span>
                  </div>
                </div>
                {als.length>0&&<div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>{als.map((a,i)=><span key={i} style={{fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:99,background:a.urgency==='high'?'#fee2e2':'#fef3c7',color:a.urgency==='high'?'#dc2626':'#d97706',display:'flex',alignItems:'center',gap:4}}><IcoClock size={10}/> {a.msg}</span>)}</div>}
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

// ── TC Add Modal ────────────────────────────────────────────────────────────

function TcAddModal({user,isManager,users,onClose,saveTcPatient,notify}){
  const tcUsers=users.filter(u=>['treatment_coordinator','manager','admin'].includes(u.role));
  const [form,setForm]=useState({id:tcNewId(),patient_name:'',patient_phone:'',patient_email:'',patient_dob:'',office:user.office||'',doctor:'',assigned_tc_id:user.id,assigned_tc_name:user.name,treatment_type:'',treatment_value:'',num_visits:1,chair_time_hours:'',status:'consult',consult_date:todayStr(),appointment_date:'',payment_method:'',financing_approved:false,deposit_collected:false,deposit_amount:'',notes:'',checklist:{},followups:[],production_value:0,created_at:new Date().toISOString()});
  const [saving,setSaving]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const save=async()=>{if(!form.patient_name.trim()){notify('Patient name required','error');return;}setSaving(true);try{await saveTcPatient(form);notify('Patient added ✓');onClose();}catch(e){notify('Save failed: '+e.message,'error');}setSaving(false);};
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:620,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 25px 60px rgba(0,0,0,.3)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px',borderBottom:'1px solid #e2e8f0'}}>
          <h2 style={{fontSize:18,fontWeight:800,color:'#1e293b',margin:0}}>Add Big Treatment Patient</h2>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}><IcoX size={20}/></button>
        </div>
        <div style={{padding:'20px 24px',display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
            <div style={{gridColumn:'1/-1'}}><label style={LBL}>Patient Name *</label><input className="ic" value={form.patient_name} onChange={e=>set('patient_name',e.target.value)} placeholder="Full name"/></div>
            <div><label style={LBL}>Phone</label><input className="ic" value={form.patient_phone} onChange={e=>set('patient_phone',e.target.value)} placeholder="(000) 000-0000"/></div>
            <div><label style={LBL}>Date of Birth</label><input type="date" className="ic" value={form.patient_dob} onChange={e=>set('patient_dob',e.target.value)}/></div>
            <div style={{gridColumn:'1/-1'}}><label style={LBL}>Treatment Type</label><input className="ic" value={form.treatment_type} onChange={e=>set('treatment_type',e.target.value)} placeholder="e.g. Full mouth restoration, Implant, Invisalign…"/></div>
            <div><label style={LBL}>Total Value ($)</label><input type="number" min="0" className="ic" value={form.treatment_value} onChange={e=>set('treatment_value',e.target.value)} placeholder="0"/></div>
            <div><label style={LBL}># of Visits</label><input type="number" min="1" className="ic" value={form.num_visits} onChange={e=>set('num_visits',e.target.value)}/></div>
            <div><label style={LBL}>Chair Time (hrs)</label><input type="number" min="0" step="0.5" className="ic" value={form.chair_time_hours} onChange={e=>set('chair_time_hours',e.target.value)} placeholder="0"/></div>
            <div><label style={LBL}>Doctor</label><input className="ic" value={form.doctor} onChange={e=>set('doctor',e.target.value)} placeholder="Doctor name"/></div>
            <div><label style={LBL}>Office</label><select className="ic" value={form.office} onChange={e=>set('office',e.target.value)}><option value="">Select…</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</select></div>
            {isManager&&<div style={{gridColumn:'1/-1'}}><label style={LBL}>Assigned TC</label><select className="ic" value={form.assigned_tc_id} onChange={e=>{const u=tcUsers.find(x=>x.id===e.target.value);set('assigned_tc_id',e.target.value);set('assigned_tc_name',u?.name||'');}}><option value="">Select TC…</option>{tcUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
            <div><label style={LBL}>Consult Date</label><input type="date" className="ic" value={form.consult_date} onChange={e=>set('consult_date',e.target.value)}/></div>
            <div><label style={LBL}>Appointment Date</label><input type="date" className="ic" value={form.appointment_date} onChange={e=>set('appointment_date',e.target.value)}/></div>
            <div><label style={LBL}>Payment Method</label><select className="ic" value={form.payment_method} onChange={e=>set('payment_method',e.target.value)}><option value="">Select…</option>{TC_PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
            <div><label style={LBL}>Deposit Amount ($)</label><input type="number" min="0" className="ic" value={form.deposit_amount} onChange={e=>set('deposit_amount',e.target.value)} placeholder="0"/></div>
            <div style={{display:'flex',alignItems:'center',gap:10}}><input type="checkbox" checked={form.financing_approved} onChange={e=>set('financing_approved',e.target.checked)}/><label style={{fontSize:13,color:'#475569',fontWeight:600}}>Financing Approved</label></div>
            <div style={{display:'flex',alignItems:'center',gap:10}}><input type="checkbox" checked={form.deposit_collected} onChange={e=>set('deposit_collected',e.target.checked)}/><label style={{fontSize:13,color:'#475569',fontWeight:600}}>Deposit Collected</label></div>
            <div style={{gridColumn:'1/-1'}}><label style={LBL}>Notes</label><textarea className="ic" style={{minHeight:70,resize:'vertical'}} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Any additional notes…"/></div>
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',gap:10,padding:'16px 24px',borderTop:'1px solid #e2e8f0'}}>
          <button onClick={onClose} style={{padding:'10px 22px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{padding:'10px 24px',borderRadius:8,background:saving?'#5eead4':'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:saving?'not-allowed':'pointer'}}>{saving?'Saving…':'Add Patient'}</button>
        </div>
      </div>
    </div>
  );
}

// ── TC Patient Detail ───────────────────────────────────────────────────────

function TcPatientDetail({patient:initP,user,isManager,users,onBack,saveTcPatient,deleteTcPatient,notify}){
  const [p,setP]=useState(initP);
  const [tab,setTab]=useState('overview');
  const [saving,setSaving]=useState(false);
  const [newFU,setNewFU]=useState({type:'Day after consultation',notes:'',date:todayStr()});
  const [showFUForm,setShowFUForm]=useState(false);
  const tcUsers=users.filter(u=>['treatment_coordinator','manager','admin'].includes(u.role));

  const save=async(updates={})=>{
    const updated={...p,...updates};
    setP(updated);setSaving(true);
    try{await saveTcPatient(updated);notify('Saved ✓');}
    catch(e){notify('Save failed: '+e.message,'error');}
    setSaving(false);
  };
  const set=(k,v)=>setP(prev=>({...prev,[k]:v}));
  const setCheck=(sid,idx,val)=>setP(prev=>({...prev,checklist:{...(prev.checklist||{}),[String(sid) + "_" + String(idx)]:val}}));
  const logFU=async()=>{const fu=[...(p.followups||[]),{...newFU,by:user.name,logged_at:new Date().toISOString()}];await save({followups:fu});setShowFUForm(false);setNewFU({type:'Day after consultation',notes:'',date:todayStr()});};
  const complete=async()=>{if(!window.confirm('Mark treatment completed and record production?'))return;await save({status:'completed',completed_date:todayStr(),production_value:p.treatment_value});notify('Marked completed ✓');};

  const alerts=getTcAlerts([p],user,isManager);
  const pct=tcChecklistPct(p.checklist||{});

  return(
    <div style={{maxWidth:960,margin:'0 auto',padding:'28px 20px 60px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16}}>
        <button onClick={()=>{save();onBack();}} style={{display:'flex',alignItems:'center',gap:6,background:'none',border:'none',cursor:'pointer',color:'#64748b',fontSize:13,fontWeight:600}}>← Back to Patients</button>
        {deleteTcPatient&&<button onClick={async()=>{if(window.confirm('Delete this patient? This cannot be undone.')){await deleteTcPatient(p.id);onBack();}}} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderRadius:8,background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',fontWeight:700,fontSize:12,cursor:'pointer'}}><IcoTrash size={13}/> Delete Patient</button>}
      </div>

      <div style={{background:'linear-gradient(135deg,#134e4a,#0d9488)',borderRadius:12,padding:'20px 24px',marginBottom:16,color:'white'}}>
        <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',flexWrap:'wrap',gap:12}}>
          <div>
            <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,flexWrap:'wrap'}}>
              <h2 style={{fontSize:22,fontWeight:800,margin:0}}>{p.patient_name}</h2>
              <TcStatusBadge status={p.status}/>
            </div>
            <div style={{opacity:.8,fontSize:13,display:'flex',gap:16,flexWrap:'wrap'}}>
              {p.patient_phone&&<span>📞 {p.patient_phone ? p.patient_phone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3') : ''}</span>}
              {p.patient_email&&<span>✉ {p.patient_email}</span>}
              {p.doctor&&<span>🩺 {p.doctor}</span>}
              {p.office&&<span>🏢 {p.office}</span>}
              {isManager&&p.assigned_tc_name&&<span>👤 {p.assigned_tc_name}</span>}
            </div>
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{width:64,height:64,borderRadius:'50%',background:`conic-gradient(rgba(255,255,255,.9) ${pct*3.6}deg,rgba(255,255,255,.2) 0deg)`,display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto'}}>
              <div style={{width:48,height:48,borderRadius:'50%',background:'rgba(0,0,0,.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:800,color:'white'}}>{pct}%</div>
            </div>
            <div style={{fontSize:10,opacity:.7,marginTop:4,fontWeight:700}}>CHECKLIST</div>
          </div>
        </div>
        <div style={{display:'flex',flexWrap:'wrap',marginTop:16,borderTop:'1px solid rgba(255,255,255,.15)',paddingTop:14}}>
          {[['VALUE',USD(p.treatment_value)],['VISITS',p.num_visits||'—'],['CONSULT',fmtDate(p.consult_date)],['APPOINTMENT',fmtDate(p.appointment_date)],['PAYMENT',p.payment_method||'—']].map(([l,v],i)=>(
            <div key={i} style={{flex:'1 1 120px',padding:'0 14px',borderLeft:i>0?'1px solid rgba(255,255,255,.15)':'none'}}>
              <div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {alerts.length>0&&<div style={{background:'#fee2e2',borderRadius:12,padding:'12px 16px',marginBottom:16,display:'flex',flexDirection:'column',gap:6}}>{alerts.map((a,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,fontWeight:600,color:'#dc2626'}}><IcoAlert size={14}/> {a.msg}</div>)}</div>}

      <div style={{display:'flex',gap:4,marginBottom:20,background:'white',padding:4,borderRadius:10,border:'1px solid #e2e8f0',width:'fit-content',flexWrap:'wrap'}}>
        {[['overview','Overview'],['checklist','Checklist'],['followups','Follow-ups'],['edit','✏️ Edit Details']].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:'8px 18px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:tab===id?'#0d9488':'transparent',color:tab===id?'white':'#64748b'}}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab==='overview'&&(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <div style={{background:'white',borderRadius:12,padding:20,border:'1px solid #e2e8f0'}}>
            <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',marginBottom:12,letterSpacing:2}}>PIPELINE</div>
            <div style={{fontSize:11,color:'#94a3b8',marginBottom:8,lineHeight:1.4}}>Click any stage to move the patient. Stages can be changed in any direction.</div>
            {TC_PIPELINE.map((s,i)=>{const st=TC_STATUS_MAP[s];const cur=p.status===s;const done=TC_PIPELINE.indexOf(p.status)>i;return(
              <button key={s} onClick={()=>save({status:s})} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'8px 12px',borderRadius:8,marginBottom:6,background:cur?st.bg:done?'#f0fdf4':'#f8fafc',border:`2px solid ${cur?st.color:done?'#bbf7d0':'#e2e8f0'}`,cursor:'pointer',textAlign:'left',transition:'all .15s'}}
                onMouseEnter={e=>{if(!cur)e.currentTarget.style.borderColor=st.color;e.currentTarget.style.background=st.bg;}}
                onMouseLeave={e=>{if(!cur){e.currentTarget.style.borderColor=done?'#bbf7d0':'#e2e8f0';e.currentTarget.style.background=done?'#f0fdf4':'#f8fafc';}}}>
                <div style={{width:24,height:24,borderRadius:'50%',background:cur?st.color:done?'#16a34a':'#e2e8f0',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {done&&!cur?<IcoCheck size={12} style={{color:'white'}}/>:<span style={{fontSize:10,fontWeight:800,color:cur?'white':'#94a3b8'}}>{i+1}</span>}
                </div>
                <span style={{fontSize:13,fontWeight:cur?700:500,color:cur?st.color:done?'#16a34a':'#64748b',flex:1}}>{st.label}</span>
                {cur&&<span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:99,background:st.color,color:'white'}}>CURRENT</span>}
                {!cur&&<span style={{fontSize:10,color:'#94a3b8'}}>click to set</span>}
              </button>
            );})}
            <div style={{display:'flex',gap:8,marginTop:8}}>
              {['declined','lost'].map(s=>{const st=TC_STATUS_MAP[s];return(
                <button key={s} onClick={()=>save({status:s})} style={{flex:1,padding:'8px 0',borderRadius:8,border:`2px solid ${p.status===s?st.color:'#e2e8f0'}`,background:p.status===s?st.bg:'white',color:p.status===s?st.color:'#64748b',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                  {st.label}{p.status===s&&' ✓'}
                </button>
              );})}
            </div>
            {p.status==='in_treatment'&&<button onClick={complete} style={{width:'100%',marginTop:10,padding:'11px 0',borderRadius:10,background:'#16a34a',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>✓ Mark Treatment Completed</button>}
          </div>
          <div>
            <div style={{background:'white',borderRadius:12,padding:20,border:'1px solid #e2e8f0',marginBottom:16}}>
              <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',marginBottom:12,letterSpacing:2}}>PAYMENT</div>
              {[['Method',p.payment_method||'Not set'],['Deposit',p.deposit_amount?USD(p.deposit_amount):'None'],['Financing',p.financing_approved?'✓ Yes':'No'],['Deposit Collected',p.deposit_collected?'✓ Yes':'No'],['Total Value',USD(p.treatment_value)]].map(([l,v])=>(
                <div key={l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #f8fafc',fontSize:13}}><span style={{color:'#64748b'}}>{l}</span><span style={{fontWeight:600,color:'#1e293b'}}>{v}</span></div>
              ))}
            </div>
            <div style={{background:'white',borderRadius:12,padding:20,border:'1px solid #e2e8f0'}}>
              <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',marginBottom:12,letterSpacing:2}}>NOTES</div>
              <p style={{fontSize:13,color:'#475569',lineHeight:1.6}}>{p.notes||'No notes.'}</p>
            </div>
          </div>
        </div>
      )}

      {/* CHECKLIST */}
      {tab==='checklist'&&(
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          {TC_CHECKLIST.map(sec=>{const done=sec.items.filter((_,i)=>p.checklist && p.checklist[sec.id + '_' + String(i)]).length;return(
            <div key={sec.id} style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 18px',borderBottom:'1px solid #f1f5f9',background:done===sec.items.length?'#f0fdf4':'white'}}>
                <div style={{width:28,height:28,borderRadius:'50%',background:done===sec.items.length?'#16a34a':'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                  {done===sec.items.length?<IcoCheck size={14} style={{color:'white'}}/>:<span style={{fontSize:11,fontWeight:800,color:'#94a3b8'}}>{done}/{sec.items.length}</span>}
                </div>
                <span style={{fontWeight:700,fontSize:14,color:done===sec.items.length?'#16a34a':'#1e293b'}}>{sec.section}</span>
                <span style={{marginLeft:'auto',fontSize:11,color:'#94a3b8',fontWeight:600}}>{done}/{sec.items.length}</span>
              </div>
              <div style={{padding:'12px 18px',display:'flex',flexDirection:'column',gap:10}}>
                {sec.items.map((item,i)=>(
                  <label key={i} style={{display:'flex',alignItems:'center',gap:12,cursor:'pointer'}}>
                    <input type="checkbox" checked={!!(p.checklist && p.checklist[sec.id + '_' + String(i)])} onChange={e=>setCheck(sec.id,i,e.target.checked)} style={{width:18,height:18,cursor:'pointer',accentColor:'#0d9488'}}/>
                    <span style={{fontSize:13,color:p.checklist && p.checklist[sec.id + '_' + String(i)]?'#16a34a':'#1e293b',textDecoration:p.checklist && p.checklist[sec.id + '_' + String(i)]?'line-through':'none'}}>{item}</span>
                  </label>
                ))}
              </div>
            </div>
          );})}
          <button onClick={()=>save()} disabled={saving} style={{alignSelf:'flex-end',padding:'11px 28px',borderRadius:10,background:saving?'#5eead4':'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:saving?'not-allowed':'pointer'}}>{saving?'Saving…':'Save Checklist'}</button>
        </div>
      )}

      {/* FOLLOW-UPS */}
      {tab==='followups'&&(
        <div>
          <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:20,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',marginBottom:12,letterSpacing:2}}>REQUIRED CONTACTS</div>
            {[['Day after consultation','📞 Day-after-consult call'],['1 week before appointment','📅 1-week-before call'],['Day before appointment','📅 Day-before call']].map(([type,label])=>{
              const done=(p.followups||[]).find(f=>f.type===type);
              return(
                <div key={type} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 0',borderBottom:'1px solid #f8fafc'}}>
                  <div style={{width:24,height:24,borderRadius:'50%',background:done?'#dcfce7':'#fee2e2',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                    {done?<IcoCheck size={12} style={{color:'#16a34a'}}/>:<IcoX size={12} style={{color:'#dc2626'}}/>}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:13,fontWeight:600,color:done?'#16a34a':'#1e293b'}}>{label}</div>
                    {done&&<div style={{fontSize:11,color:'#94a3b8'}}>{fmtDate(done.date)} · {done.by}</div>}
                  </div>
                  {!done&&<button onClick={()=>{setNewFU(f=>({...f,type}));setShowFUForm(true);}} style={{padding:'5px 14px',borderRadius:8,background:'#f1f5f9',border:'none',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>Log Now</button>}
                </div>
              );
            })}
          </div>
          {showFUForm?(
            <div style={{background:'#f0fdfa',borderRadius:12,border:'1px solid #99f6e4',padding:20,marginBottom:16}}>
              <div style={{fontSize:13,fontWeight:700,color:'#0d9488',marginBottom:12}}>Log Follow-up Contact</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                <div><label style={LBL}>Type</label><select className="ic" value={newFU.type} onChange={e=>setNewFU(f=>({...f,type:e.target.value}))}>{TC_FOLLOWUP_TYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                <div><label style={LBL}>Date</label><input type="date" className="ic" value={newFU.date} onChange={e=>setNewFU(f=>({...f,date:e.target.value}))}/></div>
                <div style={{gridColumn:'1/-1'}}><label style={LBL}>Notes</label><textarea className="ic" style={{minHeight:80,resize:'vertical'}} value={newFU.notes} onChange={e=>setNewFU(f=>({...f,notes:e.target.value}))} placeholder="What was discussed…"/></div>
              </div>
              <div style={{display:'flex',gap:8,marginTop:12}}>
                <button onClick={logFU} style={{padding:'9px 20px',borderRadius:8,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>Log Contact</button>
                <button onClick={()=>setShowFUForm(false)} style={{padding:'9px 20px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
              </div>
            </div>
          ):(
            <button onClick={()=>setShowFUForm(true)} style={{display:'flex',alignItems:'center',gap:8,padding:'10px 20px',borderRadius:10,border:'1px dashed #99f6e4',background:'white',color:'#0d9488',fontWeight:700,fontSize:13,cursor:'pointer',marginBottom:16}}><IcoPlus size={14}/> Log New Contact</button>
          )}
          {(p.followups||[]).length>0?(
            <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',overflow:'hidden'}}>
              <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',padding:'14px 18px',borderBottom:'1px solid #f1f5f9',letterSpacing:2}}>CONTACT HISTORY</div>
              {[...(p.followups||[])].reverse().map((fu,i)=>(
                <div key={i} style={{padding:'12px 18px',borderBottom:'1px solid #f8fafc',display:'flex',gap:12}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:'#0d9488',marginTop:5,flexShrink:0}}/>
                  <div>
                    <div style={{fontSize:13,fontWeight:700,color:'#1e293b'}}>{fu.type}</div>
                    <div style={{fontSize:12,color:'#94a3b8'}}>{fmtDate(fu.date)} · {fu.by}</div>
                    {fu.notes&&<div style={{fontSize:12,color:'#475569',marginTop:4}}>{fu.notes}</div>}
                  </div>
                </div>
              ))}
            </div>
          ):<div style={{textAlign:'center',padding:40,color:'#94a3b8',background:'white',borderRadius:12,border:'1px solid #e2e8f0'}}>No follow-ups logged yet.</div>}
        </div>
      )}

      {/* EDIT */}
      {tab==='edit'&&(
        <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:24}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div style={{gridColumn:'1/-1'}}><label style={LBL}>Patient Name</label><input className="ic" value={p.patient_name} onChange={e=>set('patient_name',e.target.value)}/></div>
            <div><label style={LBL}>Phone</label><input className="ic" value={p.patient_phone||''} onChange={e=>set('patient_phone',e.target.value)}/></div>
            <div><label style={LBL}>Date of Birth</label><input type="date" className="ic" value={p.patient_dob||''} onChange={e=>set('patient_dob',e.target.value)}/></div>
            <div style={{gridColumn:'1/-1'}}><label style={LBL}>Treatment Type</label><input className="ic" value={p.treatment_type||''} onChange={e=>set('treatment_type',e.target.value)}/></div>
            <div><label style={LBL}>Treatment Value ($)</label><input type="number" min="0" className="ic" value={p.treatment_value||''} onChange={e=>set('treatment_value',e.target.value)}/></div>
            <div><label style={LBL}>Chair Time (hrs)</label><input type="number" min="0" step="0.5" className="ic" value={p.chair_time_hours||''} onChange={e=>set('chair_time_hours',e.target.value)}/></div>
            <div><label style={LBL}>Doctor</label><input className="ic" value={p.doctor||''} onChange={e=>set('doctor',e.target.value)}/></div>
            <div><label style={LBL}>Office</label><select className="ic" value={p.office||''} onChange={e=>set('office',e.target.value)}>{OFFICES.map(o=><option key={o}>{o}</option>)}</select></div>
            <div><label style={LBL}>Status</label><select className="ic" value={p.status} onChange={e=>set('status',e.target.value)}>{TC_STATUSES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
            <div><label style={LBL}>Consult Date</label><input type="date" className="ic" value={p.consult_date||''} onChange={e=>set('consult_date',e.target.value)}/></div>
            <div><label style={LBL}>Appointment Date</label><input type="date" className="ic" value={p.appointment_date||''} onChange={e=>set('appointment_date',e.target.value)}/></div>
            <div><label style={LBL}>Completed Date</label><input type="date" className="ic" value={p.completed_date||''} onChange={e=>set('completed_date',e.target.value)}/></div>
            <div><label style={LBL}>Payment Method</label><select className="ic" value={p.payment_method||''} onChange={e=>set('payment_method',e.target.value)}><option value="">Select…</option>{TC_PAYMENT_METHODS.map(m=><option key={m}>{m}</option>)}</select></div>
            <div><label style={LBL}>Deposit Amount ($)</label><input type="number" min="0" className="ic" value={p.deposit_amount||''} onChange={e=>set('deposit_amount',e.target.value)}/></div>
            <div style={{display:'flex',alignItems:'center',gap:10}}><input type="checkbox" checked={!!p.financing_approved} onChange={e=>set('financing_approved',e.target.checked)}/><label style={{fontSize:13,color:'#475569',fontWeight:600}}>Financing Approved</label></div>
            <div style={{display:'flex',alignItems:'center',gap:10}}><input type="checkbox" checked={!!p.deposit_collected} onChange={e=>set('deposit_collected',e.target.checked)}/><label style={{fontSize:13,color:'#475569',fontWeight:600}}>Deposit Collected</label></div>
            {isManager&&<div style={{gridColumn:'1/-1'}}><label style={LBL}>Assigned TC</label><select className="ic" value={p.assigned_tc_id||''} onChange={e=>{const u=tcUsers.find(x=>x.id===e.target.value);set('assigned_tc_id',e.target.value);set('assigned_tc_name',u?.name||'');}}><option value="">Select TC…</option>{tcUsers.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
            <div style={{gridColumn:'1/-1'}}><label style={LBL}>Notes</label><textarea className="ic" style={{minHeight:90,resize:'vertical'}} value={p.notes||''} onChange={e=>set('notes',e.target.value)}/></div>
          </div>
          <div style={{display:'flex',justifyContent:'flex-end',marginTop:20,gap:10}}>
            <button onClick={onBack} style={{padding:'10px 22px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
            <button onClick={()=>save()} disabled={saving} style={{padding:'10px 24px',borderRadius:8,background:saving?'#5eead4':'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:saving?'not-allowed':'pointer'}}>{saving?'Saving…':'Save Changes'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TC Alerts Page ──────────────────────────────────────────────────────────


export default TcPatientsPage
