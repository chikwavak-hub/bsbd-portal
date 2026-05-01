import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoX,IcoCheck,IcoEdit,IcoAlert,IcoClock,IcoPhone,IcoChevR,IcoChevD,IcoChevU,IcoCloud,IcoUsers,IcoBell,IcoStar,IcoDL,IcoPrint,IcoUpload,IcoCalendar } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct,tcDiffDays } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

const tcNewId = () => 'tp_' + Date.now() + '_' + Math.random().toString(36).slice(2,6)


function TcPatientsPage({user,tcPatients,isManager,users,saveTcPatient,loadTcPatients,notify,deleteTcPatient}){
  const [showAdd,setShowAdd]=useState(false);
  const [filter,setFilter]=useState('all');
  const [dateGroup,setDateGroup]=useState('all'); // all | this_month | last_month | older
  const [sortBy,setSortBy]=useState('updated'); // updated | name | consult | value
  const [search,setSearch]=useState('');
  const [offFilter,setOffFilter]=useState('all');
  const [detailId,setDetailId]=useState(null);

  if(detailId){
    const p=tcPatients.find(x=>x.id===detailId);
    if(!p){setDetailId(null);return null;}
    return <TcPatientDetail patient={p} user={user} isManager={isManager} users={users} onBack={()=>setDetailId(null)} saveTcPatient={saveTcPatient} deleteTcPatient={deleteTcPatient} notify={notify}/>;
  }

  const mine=isManager?tcPatients:tcPatients.filter(p=>p.assigned_tc_id===user.id);
  const today2   = todayStr();
  const mStart2  = today2.slice(0,7);
  const lastMonth= (()=>{const d=new Date(today2+'T12:00:00');d.setMonth(d.getMonth()-1);return d.toISOString().slice(0,7);})();

  const filtered=mine.filter(p=>{
    if(filter!=='all'&&p.status!==filter)return false;
    if(offFilter!=='all'&&p.office!==offFilter)return false;
    if(search&&!p.patient_name.toLowerCase().includes(search.toLowerCase()))return false;
    if(dateGroup!=='all'){
      const ref = p.consult_date||p.created_at||'';
      const mo  = ref.slice(0,7);
      if(dateGroup==='this_month' && mo!==mStart2)  return false;
      if(dateGroup==='last_month' && mo!==lastMonth) return false;
      if(dateGroup==='older' && (mo===mStart2||mo===lastMonth)) return false;
    }
    return true;
  }).sort((a,b)=>{
    if(sortBy==='name')    return a.patient_name.localeCompare(b.patient_name);
    if(sortBy==='consult') return (b.consult_date||'').localeCompare(a.consult_date||'');
    if(sortBy==='value')   return (b.treatment_value||0)-(a.treatment_value||0);
    return (b.updated_at||'').localeCompare(a.updated_at||''); // default: most recent
  });

  // Group filtered by consult month for display
  const groupedByMonth = filtered.reduce((acc,p)=>{
    const mo = p.consult_date ? p.consult_date.slice(0,7) : 'Unknown';
    if(!acc[mo]) acc[mo]=[];
    acc[mo].push(p);
    return acc;
  },{});
  const monthKeys = Object.keys(groupedByMonth).sort((a,b)=>b.localeCompare(a));
  const fmtMonth  = ym => { if(ym==='Unknown') return 'Unknown Date'; const [y,m]=ym.split('-'); const mn=['January','February','March','April','May','June','July','August','September','October','November','December'][parseInt(m)-1]; return mn+' '+y; };
  const active=mine.filter(p=>!['completed','declined','lost'].includes(p.status));
  const mStart=todayStr().slice(0,7);
  const doneThisMonth=mine.filter(p=>p.status==='completed'&&p.completed_date?.slice(0,7)===mStart);

  const downloadPatientCSV = () => {
    const headers = ['Patient Name','Office','Status','Treatment','Value','Consult Date','Appt Date','TC','Payment','Notes']
    const rows = filtered.map(p=>[
      p.patient_name, p.office||'', TC_STATUS_MAP[p.status]?.label||p.status,
      p.treatment_type||'', p.treatment_value||0,
      p.consult_date||'', p.appointment_date||'',
      p.assigned_tc_name||'', p.payment_method||'', p.notes||''
    ])
    const csv = [headers,...rows].map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
    a.download = 'TC_Patients_'+todayStr()+'.csv'
    a.click()
    notify('CSV downloaded ✓')
  }

  const printPatients = () => {
    const rows = filtered.map(p=>`
      <tr>
        <td>${p.patient_name}</td>
        <td>${p.office||''}</td>
        <td>${TC_STATUS_MAP[p.status]?.label||p.status}</td>
        <td>${p.treatment_type||'—'}</td>
        <td>$${(p.treatment_value||0).toLocaleString()}</td>
        <td>${p.consult_date||'—'}</td>
        <td>${p.assigned_tc_name||'—'}</td>
        <td>${p.payment_method||'—'}</td>
      </tr>`).join('')
    const w = window.open('','_blank','width=1000,height=700')
    w.document.write(`<!DOCTYPE html><html><head><title>TC Patients</title>
      <style>body{font-family:system-ui;padding:24px;font-size:12px}
      h1{font-size:18px;margin-bottom:4px}h2{font-size:12px;color:#64748b;margin-bottom:16px;font-weight:400}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #e2e8f0;padding:6px 10px;text-align:left}
      th{background:#f8fafc;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#64748b}
      tr:nth-child(even){background:#f8fafc}@media print{button{display:none}}</style></head>
      <body><h1>TC Patients — ${filter==='all'?'All Statuses':TC_STATUS_MAP[filter]?.label||filter}</h1>
      <h2>Beautiful Smiles by Design · ${new Date().toLocaleDateString()} · ${filtered.length} patients</h2>
      <button onclick="window.print()" style="margin-bottom:16px;padding:8px 16px;background:#1d4ed8;color:white;border:none;border-radius:6px;cursor:pointer;font-size:12px">🖨 Print / Save PDF</button>
      <table><thead><tr><th>Patient</th><th>Office</th><th>Status</th><th>Treatment</th><th>Value</th><th>Consult</th><th>TC</th><th>Payment</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p style="margin-top:16px;font-size:10px;color:#94a3b8">Total patients: ${filtered.length} · Total value: $${filtered.reduce((s,p)=>s+(p.treatment_value||0),0).toLocaleString()}</p>
      </body></html>`)
    w.document.close()
    setTimeout(()=>w.focus(),300)
  }


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
        <input className="ic" style={{maxWidth:180}} value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name…"/>
        <select className="ic" style={{width:'auto'}} value={filter} onChange={e=>setFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {TC_STATUSES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="ic" style={{width:'auto'}} value={dateGroup} onChange={e=>setDateGroup(e.target.value)}>
          <option value="all">All Dates</option>
          <option value="this_month">This Month</option>
          <option value="last_month">Last Month</option>
          <option value="older">Older</option>
        </select>
        <select className="ic" style={{width:'auto'}} value={sortBy} onChange={e=>setSortBy(e.target.value)}>
          <option value="updated">Sort: Recent</option>
          <option value="consult">Sort: Consult Date</option>
          <option value="name">Sort: Name</option>
          <option value="value">Sort: Value</option>
        </select>
        {isManager&&<select className="ic" style={{width:'auto'}} value={offFilter} onChange={e=>setOffFilter(e.target.value)}><option value="all">All Offices</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</select>}
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button onClick={loadTcPatients} style={{padding:'8px 12px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:600,fontSize:12,cursor:'pointer'}}>↻</button>
          <button onClick={downloadPatientCSV} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 14px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}><IcoDL size={13}/> CSV</button>
          <button onClick={printPatients} style={{display:'flex',alignItems:'center',gap:5,padding:'8px 14px',borderRadius:8,background:'#475569',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}><IcoPrint size={13}/> Print</button>
        </div>
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
        :<div>
          {monthKeys.map(mo=>(
            <div key={mo} style={{marginBottom:24}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
                <span style={{fontSize:12,fontWeight:800,color:'#1d4ed8',letterSpacing:1}}>{fmtMonth(mo).toUpperCase()}</span>
                <span style={{fontSize:11,color:'#94a3b8'}}>{groupedByMonth[mo].length} patient{groupedByMonth[mo].length!==1?'s':''}</span>
                <span style={{fontSize:11,color:'#64748b'}}>· {USD(groupedByMonth[mo].reduce((s,p)=>s+(p.treatment_value||0),0))} total value</span>
                <div style={{flex:1,height:1,background:'#e2e8f0'}}/>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {groupedByMonth[mo].map(p=>{
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
                  <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:6,flexShrink:0}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:`conic-gradient(#0d9488 ${pct*3.6}deg,#e2e8f0 0deg)`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                      <div style={{width:32,height:32,borderRadius:'50%',background:'white',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,fontWeight:800,color:'#0d9488'}}>{pct}%</div>
                    </div>
                    <span style={{fontSize:9,color:'#94a3b8',fontWeight:600}}>CHECKLIST</span>
                    {deleteTcPatient&&<button onClick={async e=>{e.stopPropagation();if(window.confirm('Delete '+p.patient_name+'?')){await deleteTcPatient(p.id);}}} style={{padding:'4px 10px',borderRadius:6,background:'#fef2f2',color:'#dc2626',border:'1px solid #fecaca',fontWeight:700,fontSize:11,cursor:'pointer',display:'flex',alignItems:'center',gap:4}}><IcoTrash size={11}/> Delete</button>}
                  </div>
                </div>
                {als.length>0&&<div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6}}>{als.map((a,i)=><span key={i} style={{fontSize:11,fontWeight:600,padding:'3px 10px',borderRadius:99,background:a.urgency==='high'?'#fee2e2':'#fef3c7',color:a.urgency==='high'?'#dc2626':'#d97706',display:'flex',alignItems:'center',gap:4}}><IcoClock size={10}/> {a.msg}</span>)}</div>}
              </div>
            );
          })}
              </div>
            </div>
          ))}
        </div>
      }
    </div>
  );
}

// ── TC Add Modal ────────────────────────────────────────────────────────────

function TcAddModal({user,isManager,users,onClose,saveTcPatient,notify}){
  const tcUsers=users.filter(u=>['treatment_coordinator','manager','admin'].includes(u.role));
  const [form,setForm]=useState({id:tcNewId(),patient_name:'',patient_phone:'',patient_email:'',patient_dob:'',office:user.office||'',doctor:'',assigned_tc_id:user.id,assigned_tc_name:user.name,treatment_type:'',treatment_value:'',num_visits:1,chair_time_hours:'',status:'consult',consult_date:todayStr(),appointment_date:'',payment_method:'',financing_approved:false,deposit_collected:false,deposit_amount:'',notes:'',checklist:{},followups:[],production_value:0,tx_plan:null,visits:[],created_at:new Date().toISOString()});
  const [saving,setSaving]=useState(false);
  const [importing,setImporting]=useState(false);
  const [planImported,setPlanImported]=useState(false);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const handlePlanUpload=async(file)=>{
    if(!file) return;
    setImporting(true);
    try{
      const { extractTxPlanText, parseTxPlanText } = await import('../../lib/txPlanParser');
      const text   = await extractTxPlanText(file);
      const parsed = parseTxPlanText(text);
      if(!parsed.patient_name&&parsed.visits.length===0){notify('Could not parse PDF — check format','error');setImporting(false);return;}
      // Build treatment type from procedure codes
      const allCodes = parsed.visits.flatMap(v=>v.procedures.filter(p=>p.is_cdt).map(p=>p.code));
      const uniqueCodes = [...new Set(allCodes)].slice(0,6).join(', ');
      setForm(f=>({
        ...f,
        patient_name:    parsed.patient_name||f.patient_name,
        doctor:          parsed.provider ? parsed.provider.split(',')[0].trim() : f.doctor,
        office:          parsed.office||f.office||user.office||'',
        treatment_type:  uniqueCodes||f.treatment_type,
        treatment_value: parsed.est_patient||parsed.case_total||f.treatment_value,
        num_visits:      parsed.num_visits||f.num_visits,
        tx_plan:         parsed,
        visits:          parsed.visits,
        notes:           parsed.notes ? (f.notes ? f.notes + ' ' : '') + parsed.notes : f.notes,
      }));
      setPlanImported(true);
      notify('Treatment plan imported — '+parsed.num_visits+' visits · '+parsed.visits.reduce((s,v)=>s+v.procedures.length,0)+' procedures');
    }catch(e){notify('Import failed: '+e.message,'error');}
    setImporting(false);
  };

  const save=async()=>{if(!form.patient_name.trim()){notify('Patient name required','error');return;}setSaving(true);try{await saveTcPatient(form);notify('Patient added ✓');onClose();}catch(e){notify('Save failed: '+e.message,'error');}setSaving(false);};
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:620,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 25px 60px rgba(0,0,0,.3)'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px',borderBottom:'1px solid #e2e8f0'}}>
          <h2 style={{fontSize:18,fontWeight:800,color:'#1e293b',margin:0}}>Add Big Treatment Patient</h2>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}><IcoX size={20}/></button>
        </div>
        <div style={{padding:'20px 24px',display:'flex',flexDirection:'column',gap:14}}>

          {/* TX Plan upload — primary action */}
          <div style={{background:planImported?'#f0fdf4':'#f0fdfa',borderRadius:12,border:`2px dashed ${planImported?'#86efac':'#99f6e4'}`,padding:'20px',textAlign:'center'}}>
            {planImported ? (
              <div>
                <div style={{fontSize:16,marginBottom:4}}>✓</div>
                <div style={{fontSize:14,fontWeight:700,color:'#15803d',marginBottom:2}}>Treatment plan imported</div>
                <div style={{fontSize:12,color:'#94a3b8',marginBottom:10}}>Fields below have been pre-filled — review and adjust as needed</div>
                <label style={{display:'inline-flex',alignItems:'center',gap:6,padding:'6px 14px',borderRadius:8,background:'white',border:'1px solid #bbf7d0',color:'#16a34a',fontWeight:600,fontSize:12,cursor:'pointer'}}>
                  <IcoUpload size={12}/> Re-import plan
                  <input type="file" accept=".pdf" onChange={e=>handlePlanUpload(e.target.files[0])} style={{display:'none'}}/>
                </label>
              </div>
            ):(
              <div>
                <div style={{fontSize:28,marginBottom:8}}>📄</div>
                <div style={{fontSize:14,fontWeight:700,color:'#0d9488',marginBottom:4}}>Upload treatment plan PDF to auto-fill</div>
                <div style={{fontSize:12,color:'#94a3b8',marginBottom:14}}>Imports patient name, treatment, visit breakdown, and fees from Dentrix</div>
                <label style={{display:'inline-flex',alignItems:'center',gap:8,padding:'10px 24px',borderRadius:10,background:importing?'#5eead4':'#0d9488',color:'white',fontWeight:700,fontSize:13,cursor:importing?'not-allowed':'pointer'}}>
                  <IcoUpload size={14}/> {importing?'Importing…':'Upload TX Plan PDF'}
                  <input type="file" accept=".pdf" onChange={e=>handlePlanUpload(e.target.files[0])} style={{display:'none'}} disabled={importing}/>
                </label>
                <div style={{fontSize:11,color:'#94a3b8',marginTop:10}}>Or fill in manually below ↓</div>
              </div>
            )}
          </div>

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
  const [visits,setVisits]=useState(p.visits||[]);
  const [txPlan,setTxPlan]=useState(p.tx_plan||null);
  const [importingPlan,setImportingPlan]=useState(false);
  const [loadingVisits,setLoadingVisits]=useState(false);
  const [confirmingVisit,setConfirmingVisit]=useState(null); // date string
  const [visitNote,setVisitNote]=useState('');
  const [visitCompleted,setVisitCompleted]=useState('');
  const [saving,setSaving]=useState(false);
  const [newFU,setNewFU]=useState({type:'Day after consultation',notes:'',date:todayStr()});
  const [showFUForm,setShowFUForm]=useState(false);
  const tcUsers=users.filter(u=>['treatment_coordinator','manager','admin'].includes(u.role));

  // Load visit history from collection_patients matches
  useEffect(()=>{
    if(tab!=='visits') return;
    setLoadingVisits(true);
    const norm = (p.patient_name||'').replace(/\([^)]+\)/g,'').replace(/[^A-Za-z\s]/g,'').trim().toUpperCase().split(/\s+/).join(' ');
    const last  = norm.split(' ').pop();
    sbGet('collection_patients','select=date,office,operatory,total_expected,treatments,status,amount_collected,ins_carrier,patient_name_norm&order=date.desc&limit=200')
      .then(rows=>{
        const matched = rows.filter(r=>{
          const rn = r.patient_name_norm||'';
          return rn===norm || (last&&last.length>2&&rn.split(' ').pop()===last&&rn.split(' ')[0]===norm.split(' ')[0]);
        });
        // Merge with saved visit data on patient record
        const saved = p.visits||[];
        const merged = matched.map(r=>{
          const sv = saved.find(v=>v.date===r.date&&v.office===r.office)||{};
          return {...r,...sv};
        });
        setVisits(merged);
      })
      .catch(()=>{})
      .finally(()=>setLoadingVisits(false));
  },[tab]);

  const confirmVisit=async(visitDate,visitOffice)=>{
    const norm = (p.patient_name||'').replace(/\([^)]+\)/g,'').replace(/[^A-Za-z\s]/g,'').trim().toUpperCase().split(/\s+/).join(' ');
    const last  = norm.split(' ').pop();
    const rows  = await sbGet('collection_patients','select=*&order=date.desc&limit=200');
    const cp    = rows.find(r=>{
      const rn=r.patient_name_norm||'';
      return r.date===visitDate&&(rn===norm||(last&&last.length>2&&rn.split(' ').pop()===last&&rn.split(' ')[0]===norm.split(' ')[0]));
    });
    const newVisit = {
      date:visitDate, office:visitOffice,
      confirmed:true, confirmed_by:user.name, confirmed_at:new Date().toISOString(),
      completed_tx:visitCompleted, tc_notes:visitNote,
      amount_collected:cp?.amount_collected||0,
      total_expected:cp?.total_expected||0,
      treatments:cp?.treatments||[],
    };
    const existingVisits = (p.visits||[]).filter(v=>!(v.date===visitDate&&v.office===visitOffice));
    const updatedVisits  = [...existingVisits,newVisit].sort((a,b)=>b.date.localeCompare(a.date));
    await save({visits:updatedVisits});
    setVisits(prev=>prev.map(v=>v.date===visitDate&&v.office===visitOffice?{...v,...newVisit}:v));
    setConfirmingVisit(null); setVisitNote(''); setVisitCompleted('');
    notify('Visit confirmed ✓');
  };

  const importTxPlan=async(file)=>{
    if(!file) return;
    setImportingPlan(true);
    try{
      const { extractTxPlanText, parseTxPlanText } = await import('../../lib/txPlanParser');
      const text   = await extractTxPlanText(file);
      const parsed = parseTxPlanText(text);
      if(!parsed.patient_name&&parsed.visits.length===0){notify('Could not parse treatment plan — check PDF format','error');setImportingPlan(false);return;}
      // Merge with any existing confirmed visit data
      const existingVisits = p.visits||[];
      const mergedVisits   = parsed.visits.map(v=>{
        const ex = existingVisits.find(ev=>ev.visit_num===v.visit_num)||{};
        return {...v,...{confirmed:ex.confirmed||false,confirmed_by:ex.confirmed_by||'',confirmed_at:ex.confirmed_at||'',tc_notes:ex.tc_notes||'',completed_tx:ex.completed_tx||''}};
      });
      const updates={
        tx_plan:      parsed,
        treatment_type: parsed.visits.map(v=>v.procedures.filter(pr=>pr.is_cdt).map(pr=>pr.code).join('+')).join(' | ').slice(0,100) || p.treatment_type,
        treatment_value:parsed.est_patient||parsed.case_total||p.treatment_value,
        num_visits:    parsed.num_visits||p.num_visits,
        visits:        mergedVisits,
      };
      await save(updates);
      setTxPlan(parsed);
      setVisits(mergedVisits);
      notify('Treatment plan imported — '+parsed.num_visits+' visits, '+parsed.visits.reduce((s,v)=>s+v.procedures.length,0)+' procedures');
    }catch(e){notify('Import failed: '+e.message,'error');}
    setImportingPlan(false);
  };

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
        {[['overview','Overview'],['visits','📅 Visits'],['checklist','Checklist'],['followups','Follow-ups'],['edit','✏️ Edit Details']].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:'8px 18px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:tab===id?'#0d9488':'transparent',color:tab===id?'white':'#64748b'}}>{l}</button>
        ))}
      </div>

      {/* OVERVIEW */}
      {/* TX PLAN IMPORT BUTTON — always visible */}
      <div style={{background:txPlan?'#f0fdf4':'#fffbeb',borderRadius:10,border:`1px solid ${txPlan?'#bbf7d0':'#fde68a'}`,padding:'10px 16px',marginBottom:12,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div>
          {txPlan
            ? <div style={{fontSize:13,fontWeight:700,color:'#15803d'}}>✓ Treatment plan imported — {txPlan.num_visits} visits · {USD(txPlan.est_patient||txPlan.case_total||0)} patient portion</div>
            : <div style={{fontSize:13,fontWeight:600,color:'#92400e'}}>No treatment plan uploaded yet — import PDF from Dentrix to enable visit tracking</div>}
          {txPlan?.accepted_date&&<div style={{fontSize:11,color:'#94a3b8',marginTop:2}}>Accepted {txPlan.accepted_date} · Case {txPlan.case_number}</div>}
        </div>
        <label style={{display:'flex',alignItems:'center',gap:6,padding:'7px 16px',borderRadius:8,background:importingPlan?'#6ee7b7':'#0d9488',color:'white',fontWeight:700,fontSize:12,cursor:importingPlan?'not-allowed':'pointer',flexShrink:0}}>
          <IcoUpload size={13}/> {importingPlan?'Importing…':txPlan?'Re-import Plan':'Import TX Plan PDF'}
          <input type="file" accept=".pdf" onChange={e=>importTxPlan(e.target.files[0])} style={{display:'none'}} disabled={importingPlan}/>
        </label>
      </div>

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


      {/* VISITS */}
      {tab==='visits'&&(
        <div>
          {/* Treatment plan progress */}
          <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:20,marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:14}}>TREATMENT PLAN PROGRESS</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:14}}>
              {[
                ['Plan Value',USD(p.treatment_value||0),'#1e293b'],
                ['Collected',USD((p.visits||[]).reduce((s,v)=>s+N(v.amount_collected||0),0)),'#16a34a'],
                ['Visits Planned',p.num_visits||'—','#1e293b'],
                ['Visits Done',(p.visits||[]).filter(v=>v.confirmed).length,'#0d9488'],
              ].map(([l,v,c])=>(
                <div key={l} style={{background:'#f8fafc',borderRadius:10,padding:'12px 14px',border:'1px solid #e2e8f0'}}>
                  <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,letterSpacing:.5,marginBottom:4}}>{l.toUpperCase()}</div>
                  <div style={{fontSize:18,fontWeight:800,color:c}}>{v}</div>
                </div>
              ))}
            </div>
            {/* Progress bar */}
            {p.treatment_value>0&&(()=>{
              const totalColl=(p.visits||[]).reduce((s,v)=>s+N(v.amount_collected||0),0);
              const pct=Math.min(Math.round(totalColl/p.treatment_value*100),100);
              return(
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#64748b',marginBottom:4}}>
                    <span>Collection progress</span><span style={{fontWeight:700,color:pct>=100?'#16a34a':'#0d9488'}}>{pct}%</span>
                  </div>
                  <div style={{height:8,borderRadius:4,background:'#e2e8f0',overflow:'hidden'}}>
                    <div style={{height:'100%',borderRadius:4,background:pct>=100?'#16a34a':'#0d9488',width:pct+'%',transition:'width .4s'}}/>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Source indicator */}
          {txPlan&&<div style={{background:'#f0fdf4',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#15803d',fontWeight:600}}>
            ✓ Showing {txPlan.num_visits} planned visits from imported treatment plan · {(visits||[]).filter(v=>v.confirmed).length} confirmed
          </div>}
          {!txPlan&&visits.length>0&&<div style={{background:'#fffbeb',borderRadius:8,padding:'8px 12px',marginBottom:12,fontSize:12,color:'#92400e',fontWeight:600}}>
            Showing visits from collection sheet matches · Import treatment plan PDF for full visit breakdown
          </div>}

          {/* Visit list */}
          {loadingVisits&&<div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>Loading visits…</div>}
          {!loadingVisits&&visits.length===0&&!txPlan&&(
            <div style={{textAlign:'center',padding:60,background:'white',borderRadius:12,border:'1px solid #e2e8f0',color:'#94a3b8'}}>
              <div style={{fontSize:32,marginBottom:8}}>📅</div>
              <div style={{fontSize:14,fontWeight:700,color:'#1e293b',marginBottom:4}}>No visits found yet</div>
              <div style={{fontSize:12}}>Import the treatment plan PDF above, or visits will appear when patient shows on a collection sheet</div>
            </div>
          )}
          {!loadingVisits&&visits.map((v,i)=>{
            const isConfirming=confirmingVisit===v.date+'_'+(v.office||'');
            return(
              <div key={i} style={{background:'white',borderRadius:12,border:`2px solid ${v.confirmed?'#bbf7d0':'#e2e8f0'}`,padding:18,marginBottom:12,overflow:'hidden'}}>
                {/* Visit header */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:v.confirmed?'#dcfce7':v.visit_num?'#eff6ff':'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',fontSize:v.visit_num?12:16,fontWeight:800,color:v.visit_num?'#1d4ed8':'#94a3b8'}}>
                      {v.confirmed?'✓':v.visit_num?'V'+v.visit_num:'📅'}
                    </div>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>
                        {v.visit_num?'Visit '+v.visit_num+(v.date?' — '+fmtDate(v.date):''):fmtDate(v.date)}
                      </div>
                      <div style={{fontSize:11,color:'#94a3b8'}}>
                        {v.office||''}{v.operatory?' · '+v.operatory:''}
                        {!v.date&&!v.confirmed&&<span style={{color:'#3b82f6',fontWeight:600}}> · Planned</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:10}}>
                    {v.total_expected>0&&<span style={{fontSize:13,fontWeight:700,color:v.confirmed?'#16a34a':'#dc2626'}}>{v.confirmed?'Collected ':'Collect '}{USD(v.total_expected)}</span>}
                    {v.confirmed&&<span style={{fontSize:10,fontWeight:700,padding:'3px 10px',borderRadius:99,background:'#dcfce7',color:'#16a34a'}}>✓ CONFIRMED</span>}
                    {!v.confirmed&&(isManager||user.role==='treatment_coordinator')&&(
                      <button onClick={()=>{setConfirmingVisit(v.date+'_'+(v.office||''));setVisitNote('');setVisitCompleted('');}}
                        style={{padding:'6px 14px',borderRadius:8,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                        Confirm Visit
                      </button>
                    )}
                  </div>
                </div>

                {/* Procedures — from tx plan or collection sheet */}
                {((v.procedures||v.treatments)||[]).length>0&&(
                  <div style={{marginBottom:isConfirming?12:0}}>
                    <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:6}}>PROCEDURES THIS VISIT</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                      {(v.procedures||v.treatments||[]).map((t,j)=>{
                        const ptAmt = t.pt_portion||t.pt_owes||0;
                        return(
                          <span key={j} style={{fontSize:11,padding:'3px 10px',borderRadius:99,background:t.is_custom?'#f5f3ff':'#f8fafc',border:`1px solid ${t.is_custom?'#ddd6fe':'#e2e8f0'}`,color:'#475569',fontWeight:600}}>
                            <b style={{color:t.is_cdt===false&&!t.is_custom?'#d97706':t.is_custom?'#7c3aed':'#1e293b'}}>{t.code}</b>
                            {(t.description||t.desc)?(' — '+(t.description||t.desc).slice(0,28)):''}
                            {t.tooth?' · Th:'+t.tooth:''}
                            {ptAmt>0?<span style={{color:'#dc2626'}}> · ${ptAmt.toFixed(2)}</span>:''}
                          </span>
                        );
                      })}
                    </div>
                    {v.pt_total>0&&<div style={{fontSize:11,color:'#dc2626',fontWeight:700,marginTop:6}}>Patient portion this visit: {USD(v.pt_total)}</div>}
                  </div>
                )}

                {/* Confirmed visit notes */}
                {v.confirmed&&(v.tc_notes||v.completed_tx)&&(
                  <div style={{marginTop:10,padding:'10px 12px',background:'#f0fdfa',borderRadius:8,border:'1px solid #99f6e4'}}>
                    {v.completed_tx&&<div style={{fontSize:12,color:'#0d9488',fontWeight:600,marginBottom:3}}>Completed: {v.completed_tx}</div>}
                    {v.tc_notes&&<div style={{fontSize:12,color:'#475569'}}>{v.tc_notes}</div>}
                    <div style={{fontSize:10,color:'#94a3b8',marginTop:4}}>Confirmed by {v.confirmed_by} · {fmtDate(v.confirmed_at?.split('T')[0]||'')}</div>
                  </div>
                )}

                {/* Confirm form */}
                {isConfirming&&(
                  <div style={{marginTop:14,padding:16,background:'#f0fdfa',borderRadius:10,border:'1px solid #99f6e4'}}>
                    <div style={{fontSize:13,fontWeight:700,color:'#0d9488',marginBottom:12}}>Confirm Visit — {fmtDate(v.date)}</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                      <div style={{gridColumn:'1/-1'}}>
                        <label style={LBL}>What was completed this visit?</label>
                        <input className="ic" value={visitCompleted} onChange={e=>setVisitCompleted(e.target.value)} placeholder="e.g. Crown prep, impressions taken — 1 of 3 visits"/>
                      </div>
                      <div style={{gridColumn:'1/-1'}}>
                        <label style={LBL}>TC Notes</label>
                        <textarea className="ic" style={{minHeight:70,resize:'vertical'}} value={visitNote} onChange={e=>setVisitNote(e.target.value)} placeholder="Patient attitude, payment collected, next appointment scheduled, concerns…"/>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                      <button onClick={()=>{setConfirmingVisit(null);setVisitNote('');setVisitCompleted('');}} style={{padding:'8px 18px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
                      <button onClick={()=>confirmVisit(v.date,v.office||'')} style={{padding:'8px 20px',borderRadius:8,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>✓ Confirm Visit</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
