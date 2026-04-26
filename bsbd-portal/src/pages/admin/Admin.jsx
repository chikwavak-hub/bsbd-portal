import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoX,IcoCheck,IcoUsers,IcoGear } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function AdminPage({providers,saveProv,staff,saveStaff,users,addUser,removeUser,email,saveEmail,officeEmails,saveOfficeEmails,notify}){
  const [tab,setTab]=useState("providers");
  return(<div style={{maxWidth:960,margin:"0 auto",padding:"28px 20px"}}>
    <h1 style={{fontSize:24,fontWeight:800,color:"#1e293b",marginBottom:4}}>Admin Settings</h1>
    <p style={{color:"#94a3b8",fontSize:13,marginBottom:24}}>All changes save to the database instantly and are visible on every device.</p>
    <div style={{display:"flex",gap:4,marginBottom:24,background:"white",padding:4,borderRadius:10,border:"1px solid #e2e8f0",width:"fit-content",flexWrap:"wrap"}}>
      {[["providers","Providers"],["staff","Front Desk"],["users","User Accounts"],["emails","Office Emails"],["settings","Settings"]].map(([id,l])=>(<button key={id} onClick={()=>setTab(id)} style={{padding:"8px 18px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:tab===id?(id==="data"?"#ef4444":"#1d4ed8"):"transparent",color:tab===id?"white":"#64748b"}}>{l}</button>))}
    </div>
    {tab==="providers"&&<ProvTab providers={providers} saveProv={saveProv} notify={notify}/>}
    {tab==="staff"    &&<StaffTab staff={staff} saveStaff={saveStaff} notify={notify}/>}
    {tab==="users"    &&<UsersTab users={users} addUser={addUser} removeUser={removeUser} notify={notify}/>}
    {tab==="emails"   &&<EmailsTab officeEmails={officeEmails} saveOfficeEmails={saveOfficeEmails} notify={notify}/>}
    {tab==="settings" &&<SettingsTab email={email} saveEmail={saveEmail} notify={notify}/>}
  </div>);
}


function ProvTab({providers,saveProv,notify}){
  const [name,setName]=useState("");const [goal,setGoal]=useState("5000");const [office,setOffice]=useState("");
  const add=()=>{if(!name.trim()){notify("Enter provider name","error");return;}saveProv([...providers,{id:`p_${Date.now()}`,name:name.toUpperCase(),goal:N(goal)||5000,office}]);setName("");setGoal("5000");setOffice("");notify("Provider added!");};
  return(<div style={{background:"white",borderRadius:12,padding:24,border:"1px solid #e2e8f0"}}><h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:16}}>Manage Providers</h3><div style={{display:"flex",gap:10,marginBottom:24,flexWrap:"wrap"}}><input className="ic" value={name} onChange={e=>setName(e.target.value)} placeholder="Provider name" style={{flex:"2 1 160px"}}/><input type="number" min="0" className="ic" value={goal} onChange={e=>setGoal(e.target.value)} placeholder="Daily goal ($)" style={{flex:"1 1 100px"}}/><select className="ic" value={office} onChange={e=>setOffice(e.target.value)} style={{flex:"1 1 120px"}}><option value="">Office (optional)</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</select><button onClick={add} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 18px",borderRadius:8,background:"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoPlus size={14}/> Add</button></div>{providers.map(p=>(<div key={p.id} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 0",borderBottom:"1px solid #f1f5f9",flexWrap:"wrap"}}><span style={{flex:"1 1 120px",fontWeight:600,fontSize:13,color:"#1e293b"}}>{p.name}</span><span style={{fontSize:11,color:"#94a3b8"}}>{p.office}</span><div style={{display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:12,color:"#94a3b8"}}>Goal ($):</span><input type="number" min="0" value={p.goal} onChange={e=>saveProv(providers.map(x=>x.id===p.id?{...x,goal:N(e.target.value)}:x))} style={{width:90,border:"1px solid #e2e8f0",borderRadius:8,padding:"6px 10px",fontSize:13,outline:"none"}}/></div><button onClick={()=>{saveProv(providers.filter(x=>x.id!==p.id));notify("Provider removed");}} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444"}}><IcoTrash size={15}/></button></div>))}</div>);
}


function StaffTab({staff,saveStaff,notify}){
  const [nn,setNn]=useState({});
  const add=o=>{const n=(nn[o]||"").trim();if(!n)return;saveStaff({...staff,[o]:[...(staff[o]||[]),n]});setNn(x=>({...x,[o]:""}));notify("Staff added!");};
  const remove=(o,n)=>saveStaff({...staff,[o]:staff[o].filter(s=>s!==n)});
  return(<div style={{display:"flex",flexDirection:"column",gap:16}}>{OFFICES.map(o=>(<div key={o} style={{background:"white",borderRadius:12,padding:20,border:"1px solid #e2e8f0"}}><h3 style={{fontSize:14,fontWeight:700,color:"#1e293b",marginBottom:12}}>{o} Office</h3><div style={{display:"flex",gap:8,marginBottom:12}}><input className="ic" value={nn[o]||""} onChange={e=>setNn(n=>({...n,[o]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&add(o)} placeholder="Staff member name"/><button onClick={()=>add(o)} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,background:"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoPlus size={14}/> Add</button></div><div style={{display:"flex",flexWrap:"wrap",gap:8}}>{(staff[o]||[]).map(s=>(<div key={s} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:99,background:"#eff6ff",fontSize:13,fontWeight:600,color:"#1d4ed8"}}>{s}<button onClick={()=>remove(o,s)} style={{background:"none",border:"none",cursor:"pointer",color:"#93c5fd",display:"flex",padding:0}}><IcoX size={13}/></button></div>))}{(staff[o]||[]).length===0&&<span style={{fontSize:13,color:"#94a3b8"}}>No staff added yet</span>}</div></div>))}</div>);
}

// UsersTab — direct Supabase operations, no localStorage involved

function UsersTab({users,addUser,removeUser,notify}){
  const ROLES=["manager","admin","provider","hygienist","front_desk"];
  const RL={admin:"Admin",manager:"Manager",provider:"Provider",hygienist:"Hygienist",front_desk:"Front Desk"};
  const [form,setForm]=useState({name:"",username:"",password:"",role:"manager",office:"McCallie",staffName:""});
  const [saving,setSaving]=useState(false);const [removing,setRemoving]=useState(null);
  const add=async()=>{
    if(!form.name||!form.username||!form.password){notify("All fields required","error");return;}
    if(users.find(u=>u.username===form.username)){notify("Username already exists","error");return;}
    setSaving(true);
    try{
      const newUser={...form,id:`u_${Date.now()}`};
      await addUser(newUser);
      setForm({name:"",username:"",password:"",role:"manager",office:"McCallie",staffName:""});
      notify("✓ Account created — they can log in now from any device");
    }catch(err){notify(`Failed: ${err.message}`,"error");}
    setSaving(false);
  };
  const remove=async(id,name)=>{
    if(id==="u0"){notify("Cannot delete the admin account","error");return;}
    if(!window.confirm(`Remove account for ${name}?`))return;
    setRemoving(id);
    try{await removeUser(id);notify("Account removed");}
    catch(err){notify(`Failed: ${err.message}`,"error");}
    setRemoving(null);
  };
  return(<div style={{background:"white",borderRadius:12,padding:24,border:"1px solid #e2e8f0"}}>
    <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:4}}>Create New Account</h3>
    <p style={{fontSize:12,color:"#94a3b8",marginBottom:16}}>Accounts are saved to the database. New users can log in from any device immediately.</p>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
      <div><label style={LBL}>Full Name</label><input className="ic" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="Jane Smith"/></div>
      <div><label style={LBL}>Username</label><input className="ic" value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="jsmith"/></div>
      <div><label style={LBL}>Password</label><input className="ic" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="••••••••"/></div>
      <div><label style={LBL}>Role</label><select className="ic" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>{ROLES.map(r=><option key={r} value={r}>{RL[r]}</option>)}</select></div>
      <div><label style={LBL}>Office</label><select className="ic" value={form.office} onChange={e=>setForm(f=>({...f,office:e.target.value}))}>{OFFICES.map(o=><option key={o}>{o}</option>)}</select></div>
      <div><label style={LBL}>Staff Name (providers/FD)</label><input className="ic" value={form.staffName} onChange={e=>setForm(f=>({...f,staffName:e.target.value}))} placeholder="e.g. DR PATEL or KAELI"/></div>
    </div>
    <p style={{fontSize:11,color:"#94a3b8",marginBottom:16}}>Staff Name links this account to their section in the form. Leave blank for managers/admins.</p>
    <button onClick={add} disabled={saving} style={{display:"flex",alignItems:"center",gap:6,padding:"10px 22px",borderRadius:8,background:saving?"#93c5fd":"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:saving?"not-allowed":"pointer",marginBottom:28}}><IcoPlus size={14}/> {saving?"Creating…":"Create Account"}</button>
    <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:12}}>All Accounts ({users.length})</h3>
    {users.length===0&&<p style={{fontSize:13,color:"#94a3b8"}}>No accounts yet. Create one above.</p>}
    {users.map(u=>(<div key={u.id} style={{display:"flex",alignItems:"center",padding:"12px 0",borderBottom:"1px solid #f1f5f9",gap:12,flexWrap:"wrap"}}>
      <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:"#1e293b"}}>{u.name}</div><div style={{fontSize:11,color:"#94a3b8"}}>{u.username} · {u.office}{u.staffName?` · ${u.staffName}`:""}</div></div>
      <span style={{fontSize:11,fontWeight:700,padding:"2px 10px",borderRadius:99,background:u.role==="admin"?"#fef3c7":u.role==="manager"?"#eff6ff":"#f0fdf4",color:u.role==="admin"?"#d97706":u.role==="manager"?"#1d4ed8":"#16a34a"}}>{(RL[u.role]||u.role).toUpperCase()}</span>
      {u.id!=="u0"&&<button onClick={()=>remove(u.id,u.name)} disabled={removing===u.id} style={{background:"none",border:"none",cursor:removing===u.id?"not-allowed":"pointer",color:"#ef4444",opacity:removing===u.id?.5:1}}><IcoTrash size={15}/></button>}
    </div>))}
  </div>);
}


function EmailsTab({officeEmails,saveOfficeEmails,notify}){
  const [emails,setEmails]=useState(officeEmails||{});
  return(<div style={{background:"white",borderRadius:12,padding:24,border:"1px solid #e2e8f0"}}><h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:8}}>Office Alert Emails</h3><p style={{fontSize:13,color:"#64748b",marginBottom:20}}>For missed-report alerts. Admin always gets notified; these addresses get office-specific alerts.</p><div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:20}}>{OFFICES.map(o=>(<div key={o} style={{display:"flex",alignItems:"center",gap:12}}><label style={{...LBL,margin:0,minWidth:100}}>{o}</label><input type="email" className="ic" value={emails[o]||""} onChange={e=>setEmails(em=>({...em,[o]:e.target.value}))} placeholder={`${o.toLowerCase()}@beautifulsmiles.com`}/></div>))}</div><button onClick={()=>{saveOfficeEmails(emails);notify("Office emails saved!");}} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 20px",borderRadius:8,background:"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}>Save Emails</button></div>);
}



function SettingsTab({email,saveEmail,notify}){
  const [e,setE]=useState(email);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:"white",borderRadius:12,padding:24,border:"1px solid #e2e8f0"}}>
        <h3 style={{fontSize:15,fontWeight:700,color:"#1e293b",marginBottom:16}}>System Settings</h3>
        <div style={{maxWidth:440}}>
          <label style={LBL}>Admin Notification Email</label>
          <input type="email" className="ic" value={e} onChange={ev=>setE(ev.target.value)} placeholder="owner@beautifulsmiles.com"/>
          <p style={{fontSize:12,color:"#94a3b8",marginTop:6}}>Receives all submitted reports.</p>
          <button onClick={()=>{saveEmail(e);notify("Saved!");}} style={{marginTop:12,display:"flex",alignItems:"center",gap:6,padding:"9px 20px",borderRadius:8,background:"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}>Save</button>
        </div>
      </div>
      <div style={{background:"#fff5f5",borderRadius:12,padding:24,border:"1px solid #fecaca"}}>
        <h3 style={{fontSize:15,fontWeight:700,color:"#dc2626",marginBottom:6}}>Data Management</h3>
        <p style={{fontSize:13,color:"#64748b",marginBottom:16,lineHeight:1.5}}>Delete submitted reports by day, week, month, or custom range. Opens in a secure separate page connected to the same database.</p>
        <a href="https://timely-toffee-0b132d.netlify.app" target="_blank" rel="noopener noreferrer" style={{display:"inline-flex",alignItems:"center",gap:8,padding:"10px 22px",borderRadius:10,background:"#dc2626",color:"white",fontWeight:700,fontSize:13,textDecoration:"none"}}>
          Open Data Manager
        </a>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// TC TRACKER MODULE
// ════════════════════════════════════════════════════════════════════════════

const TC_STATUSES=[
  {key:'consult',          label:'Consult Done',       color:'#d97706',bg:'#fef3c7'},
  {key:'tx_presented',     label:'TX Presented',        color:'#2563eb',bg:'#eff6ff'},
  {key:'payment_confirmed',label:'Payment Confirmed',  color:'#7c3aed',bg:'#f5f3ff'},
  {key:'scheduled',        label:'Scheduled',           color:'#0891b2',bg:'#e0f2fe'},
  {key:'in_treatment',     label:'In Treatment',        color:'#0d9488',bg:'#f0fdfa'},
  {key:'completed',        label:'Completed ✓',         color:'#16a34a',bg:'#dcfce7'},
  {key:'declined',         label:'Declined',            color:'#dc2626',bg:'#fee2e2'},
  {key:'lost',             label:'Lost to Follow-up',  color:'#6b7280',bg:'#f3f4f6'},
];
const TC_STATUS_MAP=Object.fromEntries(TC_STATUSES.map(s=>[s.key,s]));
const TC_PIPELINE=['consult','tx_presented','payment_confirmed','scheduled','in_treatment','completed'];
const TC_PAYMENT_METHODS=['Credit/Debit','Cash','CareCredit','In-House Payment Plan'];
const TC_FOLLOWUP_TYPES=['Day after consultation','1 week before appointment','Day before appointment','Check-in call','Reschedule call','General follow-up'];
const TC_CHECKLIST=[
  {id:'s1',section:'1. Build Relationship',items:["Seated in private room","Offered water/coffee","Spoke slowly and clearly","Patient understands diagnosis","Patient repeated back understanding"]},
  {id:'s2',section:'2. Present Treatment Plan',items:["Went line-by-line through plan","Explained what & why","Discussed # of visits and length","Patient understands sequence of care"]},
  {id:'s3',section:'3. Discuss Payment Options',items:["Asked how they'd like to pay","Payment method confirmed","Financing application run before leaving","10% deposit collected (if 2+ hr appt)"]},
  {id:'s4',section:'4. Written Financial Breakdown',items:["Total cost given","Cost per visit given","Due dates given","Deposit amount noted","Signed copy kept in chart"]},
  {id:'s5',section:'5. Book the Appointment',items:["Appropriate time reserved","Payment/documents confirmed","Detailed notes added to chart"]},
  {id:'s6',section:'6. Follow-up Communication',items:["Called day after consultation","Called week before appointment","Called day before appointment","Procedure/amount/arrival/driver/sedation confirmed"]},
  {id:'s7',section:'7. Day-of Preparation',items:["Insurance verified","Payment setup confirmed","Lab items/records ready","Room assigned","Team aware of plan","Notes completed"]},
  {id:'s8',section:'8. Day-of Patient Greeting',items:["Greeted warmly","Brought to room immediately","Reviewed today's procedure","Reviewed cost for today","Confirmed next visit"]},
  {id:'s9',section:'9. No Patient Leaves Confused',items:["Next appointment scheduled","Patient knows amount due next visit","Patient knows next procedure","Patient has written summary"]},
  {id:'s10',section:'10. Accountability',items:["Patient tracked throughout","All calls/texts documented","Chart notes completed","No one slipped through the cracks"]},
];

const tcNewId=()=>`tp_${Date.now()}_${Math.random().toString(36).slice(2,6)}`;
const tcDiffDays=(a,b)=>Math.round((new Date(b)-new Date(a))/(1000*60*60*24));
const tcFmtDate=s=>s?new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
const tcFmtPhone=s=>s?s.replace(/(\d{3})(\d{3})(\d{4})/,'($1) $2-$3'):s;



export default AdminPage
