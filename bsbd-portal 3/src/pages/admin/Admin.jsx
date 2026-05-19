import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoX,IcoCheck,IcoUsers,IcoGear } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function AdminPage({providers,saveProv,staff,saveStaff,users,addUser,removeUser,updateUser,email,saveEmail,officeEmails,saveOfficeEmails,notify}){
  const [tab,setTab]=useState("providers");
  return(<div style={{maxWidth:960,margin:"0 auto",padding:"28px 20px"}}>
    <h1 style={{fontSize:24,fontWeight:800,color:"#1e293b",marginBottom:4}}>Admin Settings</h1>
    <p style={{color:"#94a3b8",fontSize:13,marginBottom:24}}>All changes save to the database instantly and are visible on every device.</p>
    <div style={{display:"flex",gap:4,marginBottom:24,background:"white",padding:4,borderRadius:10,border:"1px solid #e2e8f0",width:"fit-content",flexWrap:"wrap"}}>
      {[['providers','Providers'],['staff','Front Desk'],['users','User Accounts'],['emails','Office Emails'],['settings','Settings']].map(([id,l])=>(<button key={id} onClick={()=>setTab(id)} style={{padding:"8px 18px",borderRadius:8,border:"none",cursor:"pointer",fontSize:13,fontWeight:600,background:tab===id?(id==="data"?"#ef4444":"#1d4ed8"):"transparent",color:tab===id?"white":"#64748b"}}>{l}</button>))}
    </div>
    {tab==="providers"&&<ProvTab providers={providers} saveProv={saveProv} notify={notify}/>}
    {tab==="staff"    &&<StaffTab staff={staff} saveStaff={saveStaff} notify={notify}/>}
    {tab==='users'&&<UsersTab users={users} addUser={addUser} removeUser={removeUser} updateUser={updateUser} notify={notify}/>}
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

function UsersTab({users,addUser,removeUser,updateUser,notify}){
  const ROLES=['manager','admin','provider','hygienist','front_desk','treatment_coordinator','ridgeview'];
  const RL={admin:'Admin',manager:'Manager',provider:'Provider',hygienist:'Hygienist',front_desk:'Front Desk',treatment_coordinator:'TC',ridgeview:'Ridgeview'};
  const [form,setForm]=useState({name:'',username:'',password:'',role:'manager',office:'McCallie',staffName:''});
  const [editId,setEditId]=useState(null);
  const [editForm,setEditForm]=useState(null);
  const [saving,setSaving]=useState(false);

  const addNew=async()=>{
    if(!form.name||!form.username||!form.password){notify('All fields required','error');return;}
    if(users.find(u=>u.username===form.username)){notify('Username already taken','error');return;}
    setSaving(true);
    const newUser={id:'u_'+Date.now(),name:form.name,username:form.username,
      password:form.password,role:form.role,office:form.office,staff_name:form.staffName,
      created_at:new Date().toISOString()};
    await addUser(newUser);
    setForm({name:'',username:'',password:'',role:'manager',office:'McCallie',staffName:''});
    setSaving(false);
    notify('Account created ✓');
  };

  const startEdit=(u)=>{
    setEditId(u.id);
    setEditForm({name:u.name,username:u.username,password:'',role:u.role,office:u.office||'',staff_name:u.staff_name||''});
  };

  const saveEdit=async()=>{
    if(!editForm.name||!editForm.username){notify('Name and username required','error');return;}
    setSaving(true);
    try {
      const u = users.find(x=>x.id===editId);
      const updated={
        id:         u.id,
        name:       editForm.name,
        username:   editForm.username,
        password:   editForm.password || u.password,
        role:       editForm.role,
        office:     editForm.office || '',
        staffName:  editForm.staff_name || u.staffName || '',
        staff_name: editForm.staff_name || u.staffName || '',
        updated_at: new Date().toISOString(),
      };
      await updateUser(updated);
      setEditId(null);
      setEditForm(null);
      notify('Account updated ✓');
    } catch(e) {
      notify('Save failed: '+e.message,'error');
      console.error('saveEdit error:', e);
    }
    setSaving(false);
  };

  const del=async(id)=>{
    if(id==='u0'){notify('Cannot delete the admin account','error');return;}
    if(!window.confirm('Delete this account? They will be logged out immediately.'))return;
    await removeUser(id);
    notify('Account deleted');
  };

  return(
    <div>
      <h3 style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:4}}>Add New Account</h3>
      <p style={{fontSize:12,color:'#94a3b8',marginBottom:16}}>Accounts save to the database instantly — new users can log in from any device immediately.</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:8}}>
        <div><label style={LBL}>Full Name</label><input className="ic" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Sarah Mitchell"/></div>
        <div><label style={LBL}>Username</label><input className="ic" value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value.toLowerCase().replace(/\s+/g,'')}))} placeholder="e.g. sarah"/></div>
        <div><label style={LBL}>Password</label><input className="ic" type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} placeholder="Set initial password"/></div>
        <div><label style={LBL}>Role</label>
          <select className="ic" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
            {ROLES.map(r=><option key={r} value={r}>{RL[r]||r}</option>)}
          </select>
        </div>
        <div><label style={LBL}>Office</label>
          <select className="ic" value={form.office} onChange={e=>setForm(f=>({...f,office:e.target.value}))}>
            {['McCallie','Dalton','Brainerd','Calhoun'].map(o=><option key={o}>{o}</option>)}
          </select>
        </div>
        <div><label style={LBL}>Staff Name (links to form sections)</label><input className="ic" value={form.staffName} onChange={e=>setForm(f=>({...f,staffName:e.target.value.toUpperCase()}))} placeholder="e.g. KAELI — leave blank for managers"/></div>
      </div>
      <button onClick={addNew} disabled={saving} style={{padding:'9px 24px',borderRadius:10,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer',marginBottom:28}}>
        + Add Account
      </button>

      <h3 style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:4}}>All Accounts ({users.length})</h3>
      <p style={{fontSize:11,color:'#94a3b8',marginBottom:14}}>Click Edit to change any account details or reset a password. Leave the new password blank to keep the existing one.</p>

      {users.map(u=>(
        <div key={u.id} style={{border:'1px solid #e2e8f0',borderRadius:12,marginBottom:10,overflow:'hidden'}}>
          {/* Account header */}
          <div style={{display:'flex',alignItems:'center',padding:'12px 16px',gap:12,flexWrap:'wrap',background:editId===u.id?'#fffbeb':'white'}}>
            <div style={{width:36,height:36,borderRadius:'50%',background:'#eff6ff',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,color:'#1d4ed8',fontSize:14,flexShrink:0}}>
              {(u.name||'?')[0].toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:700,color:'#1e293b'}}>{u.name}</div>
              <div style={{fontSize:11,color:'#94a3b8'}}>@{u.username} · {u.office||'All offices'}</div>
            </div>
            <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:99,
              background:u.role==='admin'?'#fef3c7':u.role==='manager'?'#eff6ff':u.role==='treatment_coordinator'?'#f0fdfa':'#f0fdf4',
              color:u.role==='admin'?'#d97706':u.role==='manager'?'#1d4ed8':u.role==='treatment_coordinator'?'#0d9488':'#16a34a'}}>
              {(RL[u.role]||u.role).toUpperCase()}
            </span>
            <div style={{display:'flex',gap:6}}>
              <button onClick={()=>editId===u.id?setEditId(null):startEdit(u)}
                style={{padding:'6px 14px',borderRadius:8,background:editId===u.id?'#f1f5f9':'#eff6ff',color:editId===u.id?'#64748b':'#1d4ed8',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                {editId===u.id?'Cancel':'Edit'}
              </button>
              <button onClick={()=>del(u.id)} style={{padding:'6px 14px',borderRadius:8,background:'#fef2f2',color:'#dc2626',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>Delete</button>
            </div>
          </div>

          {/* Edit form */}
          {editId===u.id&&editForm&&(
            <div style={{padding:'16px',borderTop:'1px solid #fde68a',background:'#fffbeb'}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}}>
                <div><label style={LBL}>Full Name</label><input className="ic" value={editForm.name} onChange={e=>setEditForm(f=>({...f,name:e.target.value}))}/></div>
                <div><label style={LBL}>Username</label><input className="ic" value={editForm.username} onChange={e=>setEditForm(f=>({...f,username:e.target.value.toLowerCase().replace(/\s+/g,'')}))}/>
                </div>
                <div>
                  <label style={LBL}>New Password <span style={{color:'#94a3b8',fontSize:10}}>(leave blank to keep current)</span></label>
                  <input className="ic" type="password" value={editForm.password||''} onChange={e=>setEditForm(f=>({...f,password:e.target.value}))} placeholder="Enter new password…"/>
                </div>
                <div><label style={LBL}>Role</label>
                  <select className="ic" value={editForm.role} onChange={e=>setEditForm(f=>({...f,role:e.target.value}))}>
                    {ROLES.map(r=><option key={r} value={r}>{RL[r]||r}</option>)}
                  </select>
                </div>
                <div><label style={LBL}>Office</label>
                  <select className="ic" value={editForm.office} onChange={e=>setEditForm(f=>({...f,office:e.target.value}))}>
                    {['McCallie','Dalton','Brainerd','Calhoun',''].map(o=><option key={o} value={o}>{o||'All offices'}</option>)}
                  </select>
                </div>
                <div><label style={LBL}>Staff Name</label><input className="ic" value={editForm.staff_name||''} onChange={e=>setEditForm(f=>({...f,staff_name:e.target.value.toUpperCase()}))} placeholder="e.g. KAELI"/></div>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button onClick={()=>{setEditId(null);setEditForm(null);}} style={{padding:'8px 18px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>Cancel</button>
                <button onClick={saveEdit} disabled={saving} style={{padding:'8px 22px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
                  {saving?'Saving…':'Save Changes'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


function SettingsTab({ email, saveEmail, notify }) {
  const [form, setForm] = useState(email || '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try { await saveEmail(form); notify('Email saved ✓') }
    catch(e) { notify('Save failed: ' + e.message, 'error') }
    setSaving(false)
  }

  return (
    <div>
      <h3 style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:4}}>Report Email</h3>
      <p style={{fontSize:12,color:'#94a3b8',marginBottom:16}}>Daily reports are emailed to this address when submitted.</p>
      <div style={{display:'flex',gap:10,alignItems:'flex-end',maxWidth:400}}>
        <div style={{flex:1}}>
          <label style={LBL}>Email Address</label>
          <input className="ic" type="email" value={form} onChange={e=>setForm(e.target.value)} placeholder="e.g. dr.chikwava@bsbd.com"/>
        </div>
        <button onClick={save} disabled={saving} style={{padding:'9px 20px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer',flexShrink:0}}>
          {saving?'Saving…':'Save'}
        </button>
      </div>

      <div style={{marginTop:32,paddingTop:24,borderTop:'1px solid #e2e8f0'}}>
        <h3 style={{fontSize:15,fontWeight:700,color:'#1e293b',marginBottom:4}}>Data Manager</h3>
        <p style={{fontSize:12,color:'#94a3b8',marginBottom:12}}>Advanced data management — view, edit and delete records directly.</p>
        <a href="https://timely-toffee-0b132d.netlify.app" target="_blank" rel="noopener noreferrer"
          style={{display:'inline-flex',alignItems:'center',gap:8,padding:'9px 20px',borderRadius:8,background:'#f1f5f9',color:'#1d4ed8',border:'1px solid #e2e8f0',fontWeight:700,fontSize:13,textDecoration:'none'}}>
          Open Data Manager ↗
        </a>
      </div>
    </div>
  )
}


export default AdminPage
