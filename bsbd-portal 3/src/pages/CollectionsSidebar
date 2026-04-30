import React from 'react'
import { IcoCheck, IcoUpload, IcoLogOut, IcoChevR } from '../components/icons'

const ROLE_LABELS = {
  admin:'Administrator', manager:'Manager', provider:'Provider',
  hygienist:'Hygienist', front_desk:'Front Desk', treatment_coordinator:'Treatment Coordinator'
}

function NavBtn({ id, label, I, page, setPage }) {
  const active = page === id
  return (
    <button onClick={()=>setPage(id)} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:8,marginBottom:2,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:active?'rgba(255,255,255,.18)':'transparent',color:active?'white':'#c4b5fd'}}>
      <I size={16}/> {label}
    </button>
  )
}

export function CollectionsSidebar({ user, page, setPage, goHome, doLogout, isManager }) {
  return (
    <div style={{width:230,background:'linear-gradient(180deg,#312e81,#1e1b4b)',display:'flex',flexDirection:'column',color:'white',flexShrink:0,boxShadow:'4px 0 20px rgba(0,0,0,.2)'}}>
      <button onClick={goHome} style={{display:'flex',alignItems:'center',gap:8,padding:'14px 16px',background:'none',border:'none',borderBottom:'1px solid rgba(255,255,255,.08)',cursor:'pointer',color:'rgba(255,255,255,.5)',fontSize:12,fontWeight:600}}>
        ← All Modules
      </button>
      <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
        <div style={{fontSize:9,fontWeight:800,letterSpacing:3,color:'#a5b4fc',marginBottom:4}}>BSBD DENTISTRY</div>
        <div style={{fontWeight:800,fontSize:15}}>Collections</div>
      </div>
      <div style={{padding:'10px 20px 12px',borderBottom:'1px solid rgba(255,255,255,.08)'}}>
        <div style={{fontSize:11,color:'#a5b4fc',marginBottom:1}}>Signed in as</div>
        <div style={{fontWeight:700,fontSize:13}}>{user.name}</div>
        <div style={{fontSize:11,color:'#a5b4fc',marginTop:1}}>{ROLE_LABELS[user.role]||user.role}</div>
      </div>
      <nav style={{flex:1,padding:'12px 10px'}}>
        {isManager&&<NavBtn id="om_review"          label="Insurance Review"    I={IcoCheck}  page={page} setPage={setPage}/>}
        <NavBtn           id="collection_tracker"   label="Day-Of Collections"  I={IcoUpload} page={page} setPage={setPage}/>
      </nav>
      <div style={{padding:'10px',borderTop:'1px solid rgba(255,255,255,.08)'}}>
        <button onClick={doLogout} style={{width:'100%',display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:8,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:'transparent',color:'#a5b4fc'}}>
          <IcoLogOut size={16}/> Sign Out
        </button>
      </div>
    </div>
  )
}
