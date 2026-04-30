import React from 'react'
import { IcoChevR, IcoUpload, IcoCheck } from '../../components/icons'

export default function CollectionsHome({ setPage }) {
  return (
    <div style={{maxWidth:700,margin:'0 auto',padding:'40px 20px'}}>
      <div style={{textAlign:'center',marginBottom:36}}>
        <div style={{fontSize:44,marginBottom:12}}>💳</div>
        <h1 style={{fontSize:26,fontWeight:800,color:'#1e293b',margin:'0 0 8px'}}>Collections</h1>
        <p style={{fontSize:14,color:'#94a3b8'}}>Daily patient collection management and insurance verification</p>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <button onClick={()=>setPage('om_review')} style={{textAlign:'left',borderRadius:16,border:'2px solid #c7d2fe',padding:0,background:'#eef2ff',cursor:'pointer',overflow:'hidden',transition:'all .15s'}}
          onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(79,70,229,.15)'}}
          onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none'}}>
          <div style={{padding:'24px 24px 20px'}}>
            <div style={{width:48,height:48,borderRadius:14,background:'#4f46e5',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:16}}>
              <IcoCheck size={22} style={{color:'white'}}/>
            </div>
            <div style={{fontSize:17,fontWeight:800,color:'#1e293b',marginBottom:6}}>Insurance Review</div>
            <div style={{fontSize:13,color:'#6366f1',lineHeight:1.5}}>OM pre-visit verification — upload collection sheet, review flags with Ridgeview the day before</div>
            <div style={{marginTop:16,display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#4f46e5',fontWeight:700}}>Open review <IcoChevR size={13}/></div>
          </div>
        </button>

        <button onClick={()=>setPage('collection_tracker')} style={{textAlign:'left',borderRadius:16,border:'2px solid #ddd6fe',padding:0,background:'#f5f3ff',cursor:'pointer',overflow:'hidden',transition:'all .15s'}}
          onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(124,58,237,.15)'}}
          onMouseLeave={e=>{e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none'}}>
          <div style={{padding:'24px 24px 20px'}}>
            <div style={{width:48,height:48,borderRadius:14,background:'#7c3aed',display:'flex',alignItems:'center',justifyContent:'center',marginBottom:16}}>
              <IcoUpload size={22} style={{color:'white'}}/>
            </div>
            <div style={{fontSize:17,fontWeight:800,color:'#1e293b',marginBottom:6}}>Day-Of Collections</div>
            <div style={{fontSize:13,color:'#7c3aed',lineHeight:1.5}}>Live patient collection tracking — staff mark collections throughout the day in real time</div>
            <div style={{marginTop:16,display:'flex',alignItems:'center',gap:4,fontSize:12,color:'#7c3aed',fontWeight:700}}>Open tracker <IcoChevR size={13}/></div>
          </div>
        </button>
      </div>
    </div>
  )
}
