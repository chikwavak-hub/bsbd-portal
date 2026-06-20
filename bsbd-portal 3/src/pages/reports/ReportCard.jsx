import React, { useState } from 'react'
import { N, USD, PCT, repGoal, repProd, repColl } from '../../lib/helpers'

const Row = ({l,v,bold,color}) => <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #f8fafc",fontSize:13}}><span style={{color:"#64748b"}}>{l}</span><span style={{fontWeight:bold?700:500,color:color||"#1e293b"}}>{v}</span></div>
const Sec = ({title,children}) => <div style={{background:"white",borderRadius:12,padding:20,border:"1px solid #e2e8f0",marginBottom:16}}><div style={{fontSize:11,fontWeight:800,color:"#1e3a5f",letterSpacing:1,marginBottom:12}}>{title}</div>{children}</div>

function ReportCard({r, providers, selDate, setSelDate, onEdit}) {
  const goal   = repGoal(r, providers)
  const prod   = repProd(r)
  const coll   = repColl(r)
  const open   = selDate === r.id

  // Precompute all percentages to avoid division in JSX attributes
  const collRate   = prod > 0 ? Math.round(N(coll) * 100 / prod) : 0
  const showRate   = N(r.sched?.ptsOnSched) > 0 ? Math.round(N(r.sched?.ptsShowUp) * 100 / N(r.sched?.ptsOnSched)) : 0
  const schedGoal  = goal > 0 ? Math.round(N(r.sched?.schedAmt) * 100 / goal) : 0
  const prodSched  = N(r.sched?.schedAmt) > 0 ? Math.round(prod * 100 / N(r.sched?.schedAmt)) : 0
  const confRate   = N(r.sched?.ptsOnSched) > 0 ? Math.round(N(r.sched?.ptsConfirmed) * 100 / N(r.sched?.ptsOnSched)) : 0
  const npShow     = N(r.sched?.npOnSched) > 0 ? Math.round(N(r.sched?.npShowed) * 100 / N(r.sched?.npOnSched)) : 0
  const npConv     = N(r.sched?.npCalls) > 0 ? Math.round(N(r.sched?.npCallsSched) * 100 / N(r.sched?.npCalls)) : 0
  const prebook    = N(r.sched?.compExamsSeen) > 0 ? Math.round(N(r.sched?.ptsPrebooked) * 100 / N(r.sched?.compExamsSeen)) : 0
  const predRate   = N(r.sched?.predGenerated) > 0 ? Math.round(N(r.sched?.predSubmitted) * 100 / N(r.sched?.predGenerated)) : 0
  const hygOn      = N(r.sched?.hygPtsOnSched)
  const hygSeen    = N(r.sched?.hygPtsSeen)
  const hygNS      = hygOn > 0 ? (100 - Math.round(hygSeen * 100 / hygOn)) : null
  const achievement = goal > 0 ? Math.round(prod * 100 / goal) : 0
  const collGoal   = goal > 0 ? Math.round(N(coll) * 100 / goal) : 0

  const hasFd = r.fd && Object.keys(r.fd).length > 0

  return (
    <div style={{marginBottom:16,borderRadius:14,overflow:"hidden",border:"1px solid #e2e8f0"}}>
      <div onClick={()=>setSelDate(open?null:r.id)}
        style={{background:"linear-gradient(135deg,#1e3a5f,#163c5a)",padding:"16px 20px",cursor:"pointer"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <div style={{fontSize:11,fontWeight:700,color:"rgba(255,255,255,.6)",marginRight:4}}>{r.date}</div>
          <div style={{fontSize:13,fontWeight:800,color:"white",marginRight:8}}>{r.office}</div>
          <div style={{fontSize:11,color:"rgba(255,255,255,.6)"}}>{r.submittedBy}</div>
        </div>
        <div style={{display:"flex",gap:16,marginTop:10,flexWrap:"wrap"}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>GOAL</div><div style={{fontSize:15,fontWeight:800,color:"white"}}>{USD(goal)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>PRODUCTION</div><div style={{fontSize:15,fontWeight:800,color:"white"}}>{USD(prod)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>VARIANCE</div><div style={{fontSize:15,fontWeight:800,color:prod>=goal?"#4ade80":"#f87171"}}>{prod>=goal?"+":""}{USD(prod-goal)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>ACHIEVEMENT</div><div style={{fontSize:15,fontWeight:800,color:achievement>=85?"#4ade80":"#fbbf24"}}>{achievement}%</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>COLLECTIONS</div><div style={{fontSize:15,fontWeight:800,color:"white"}}>{USD(coll)}</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>COLL RATE</div><div style={{fontSize:15,fontWeight:800,color:collRate>=95?"#4ade80":"#fbbf24"}}>{collRate}%</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:9,opacity:.6,color:"white"}}>SHOW RATE</div><div style={{fontSize:15,fontWeight:800,color:showRate>=90?"#4ade80":"#fbbf24"}}>{showRate}%</div></div>
        </div>
        {onEdit && (
          <div style={{display:'flex',justifyContent:'flex-end',paddingTop:8}}>
            <button onClick={e=>{e.stopPropagation();onEdit(r)}}
              style={{padding:'5px 14px',borderRadius:7,background:'rgba(255,255,255,.15)',
                border:'1px solid rgba(255,255,255,.3)',color:'white',fontWeight:700,
                fontSize:12,cursor:'pointer'}}>
              Edit Report
            </button>
          </div>
        )}
      </div>

      {open && (
        <div style={{padding:16,background:"#f8fafc"}}>
          {onEdit && (
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
              marginBottom:14,padding:"10px 14px",background:"white",borderRadius:10,
              border:"1px solid #e2e8f0"}}>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:"#1e293b"}}>{r.office} · {r.date}</div>
                <div style={{fontSize:11,color:"#94a3b8",marginTop:2}}>Submitted by {r.submittedBy||"—"}</div>
              </div>
              <button onClick={e=>{e.stopPropagation();onEdit(r)}}
                style={{padding:"8px 18px",borderRadius:8,background:"#1d4ed8",color:"white",
                  border:"none",fontWeight:700,fontSize:12,cursor:"pointer",
                  display:"flex",alignItems:"center",gap:6}}>
                ✏ Edit This Report
              </button>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>

            <Sec title="PRODUCTION">
              {(r.providers||[]).filter(p=>p.doctorId).map((p,i)=>{
                const pv = providers.find(x=>x.id===p.doctorId)
                return (
                  <div key={i} style={{padding:"8px 0",borderBottom:"1px solid #f1f5f9"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"#1e3a5f",marginBottom:6}}>{p.doctorName||pv?.name}</div>
                    <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:12,color:"#475569"}}>
                      <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>GOAL</div><div style={{fontWeight:600}}>{USD(pv?.goal||0)}</div></div>
                      <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>SCHEDULE</div><div style={{fontWeight:600}}>{USD(p.openSchedule)}</div></div>
                      <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>ACTUAL</div><div style={{fontWeight:600}}>{USD(p.netProd)}</div></div>
                      <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>PTS</div><div style={{fontWeight:600}}>{p.ptsSeen||0}</div></div>
                      <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>NP SCHED</div><div style={{fontWeight:600}}>{p.npSched||0}</div></div>
                      <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>NP SEEN</div><div style={{fontWeight:600}}>{p.npSeen||0}</div></div>
                    </div>
                  </div>
                )
              })}
              {(r.hygiene||[]).filter(h=>h.name&&h.name.trim()).map((h,i)=>(
                <div key={"h"+i} style={{padding:"6px 0",borderBottom:"1px solid #f1f5f9"}}>
                  <div style={{fontWeight:700,fontSize:12,color:"#0d9488",marginBottom:4}}>{h.name} (Hyg)</div>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap",fontSize:12,color:"#475569"}}>
                    <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>GOAL</div><div>$1,200</div></div>
                    <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>SCHED</div><div>{USD(h.openSchedule)}</div></div>
                    <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>ACTUAL</div><div>{USD(h.netProd)}</div></div>
                    <div><div style={{fontSize:9,color:"#94a3b8",fontWeight:700}}>PTS</div><div>{h.ptsSeen||0}</div></div>
                  </div>
                </div>
              ))}
            </Sec>

            <Sec title="SCHEDULE CAPACITY">
              <Row l="Scheduled Amt" v={USD(r.sched?.schedAmt)}/>
              <Row l="Daily Goal"    v={USD(goal)}/>
              <Row l="Sched / Goal"  v={schedGoal+"%"} bold/>
              <Row l="Prod / Sched"  v={prodSched+"%"} bold/>
              <Row l="Pts on Sched"  v={r.sched?.ptsOnSched||0}/>
              <Row l="Confirmed"     v={r.sched?.ptsConfirmed||0}/>
              <Row l="Confirm Rate"  v={confRate+"%"} bold/>
              <Row l="Pts Showed"    v={r.sched?.ptsShowUp||0}/>
              <Row l="Show Rate"     v={showRate+"%"} bold/>
              <Row l="Cancelled"     v={r.sched?.cancelled||0}/>
              <Row l="No Shows"      v={r.sched?.noShows||0}/>
            </Sec>

            <Sec title="NEW PATIENTS">
              <Row l="NP on Schedule"  v={r.sched?.npOnSched||0}/>
              <Row l="NP Showed"       v={r.sched?.npShowed||0}/>
              <Row l="NP Show Rate"    v={npShow+"%"} bold/>
              <Row l="NP Phone Calls"  v={r.sched?.npCalls||0}/>
              <Row l="NP Sched Calls"  v={r.sched?.npCallsSched||0}/>
              <Row l="NP Conversion"   v={npConv+"%"} bold/>
            </Sec>

            <Sec title="PREBOOKING">
              <Row l="Comp Exams Seen" v={r.sched?.compExamsSeen||0}/>
              <Row l="Pts Booked Next" v={r.sched?.ptsPrebooked||0}/>
              <Row l="Prebook Rate"    v={prebook+"%"} bold/>
            </Sec>

            <Sec title="COLLECTIONS">
              <Row l="Non-Insurance" v={USD(r.coll?.nonIns)}/>
              <Row l="Insurance"     v={USD(r.coll?.ins)}/>
              <Row l="Total"         v={USD(coll)} bold/>
              <Row l="Coll Rate"     v={collRate+"%"} bold/>
            </Sec>

            {hasFd && (
              <Sec title="FRONT DESK / TC">
                {Object.entries(r.fd).map(([name,fd])=>{
                  const npConvFd  = N(fd.calls)>0 ? Math.round(N(fd.callsSched)*100/N(fd.calls)) : 0
                  const recConvFd = N(fd.recalls)>0 ? Math.round(N(fd.recallsSched)*100/N(fd.recalls)) : 0
                  const npTxPct   = N(fd.npTxPres)>0 ? Math.round(N(fd.npTxAcc)*100/N(fd.npTxPres)) : 0
                  const exTxPct   = N(fd.exTxPres)>0 ? Math.round(N(fd.exTxAcc)*100/N(fd.exTxPres)) : 0
                  return (
                    <div key={name} style={{padding:"10px 0",borderBottom:"1px solid #f1f5f9"}}>
                      <div style={{fontWeight:700,fontSize:12,color:"#1e3a5f",marginBottom:6}}>{name}</div>
                      <Row l="NP Calls"      v={fd.calls||0}/>
                      <Row l="NP Sched"      v={fd.callsSched||0}/>
                      <Row l="NP Conv"       v={npConvFd+"%"} bold/>
                      <Row l="Recalls"       v={fd.recalls||0}/>
                      <Row l="Rec Sched"     v={fd.recallsSched||0}/>
                      <Row l="Rec Conv"      v={recConvFd+"%"} bold/>
                      <Row l="NP TX Pres"    v={fd.npTxPres||0}/>
                      <Row l="NP TX Acc"     v={fd.npTxAcc||0}/>
                      <Row l="NP TX Acc%"    v={npTxPct+"%"} bold/>
                      <Row l="Ex TX Pres"    v={fd.exTxPres||0}/>
                      <Row l="Ex TX Acc"     v={fd.exTxAcc||0}/>
                      <Row l="Ex TX Acc%"    v={exTxPct+"%"} bold/>
                    </div>
                  )
                })}
              </Sec>
            )}

            {hasFd && (
              <Sec title="PRE-Ds AND RECARE">
                <Row l="Pre-Ds Generated" v={r.sched?.predGenerated||0}/>
                <Row l="Pre-Ds Submitted" v={r.sched?.predSubmitted||0}/>
                <Row l="Submission Rate"  v={predRate+"%"} bold/>
                <Row l="Hyg on Schedule"  v={r.sched?.hygPtsOnSched||0}/>
                <Row l="Hyg Seen"         v={r.sched?.hygPtsSeen||0}/>
                <Row l="Hyg No-Show"      v={hygNS!==null?hygNS+"%":"--"} bold/>
              </Sec>
            )}

          </div>
          {r.notes && (
            <div style={{background:"#fffbeb",borderRadius:12,padding:16,border:"1px solid #fef3c7",marginTop:8}}>
              <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:4}}>NOTES</div>
              <p style={{margin:0,fontSize:13,color:"#78350f"}}>{r.notes}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { ReportCard }
