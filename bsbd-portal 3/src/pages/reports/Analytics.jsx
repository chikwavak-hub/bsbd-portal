import React, { useState, useMemo } from 'react'
import { IcoChevD, IcoChevU } from '../../components/icons'
import { ChartCanvas } from '../../components/ui'
import { N, USD, PCT, pctNum, todayStr, monthStart, rangeStart, repGoal, repProd, repColl, downloadCSV } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

const C = {
  blue:'#1d4ed8',teal:'#0d9488',green:'#16a34a',red:'#dc2626',amber:'#d97706',purple:'#7c3aed',gray:'#94a3b8',
  bA:a=>`rgba(29,78,216,${a})`,tA:a=>`rgba(13,148,136,${a})`,gA:a=>`rgba(148,163,184,${a})`,
  gnA:a=>`rgba(22,163,74,${a})`,rA:a=>`rgba(220,38,38,${a})`,pA:a=>`rgba(124,58,237,${a})`,aA:a=>`rgba(215,119,6,${a})`,
}

// Placeholder benchmarks — update as targets are confirmed
const BM = {
  showRate:90, recallConv:85, callConv:50, npShowRate:80,
  txPresRate:80, txAccRate:60, collRate:95, noShowMax:10,
}

function rollingAvg(reports, fn, days=30) {
  const cut = new Date(todayStr()); cut.setDate(cut.getDate()-days)
  const inRange = reports.filter(r=>r.date>=cut.toISOString().slice(0,10)&&r.date<=todayStr())
  if(!inRange.length) return null
  const vals = inRange.map(fn).filter(v=>v!==null&&!isNaN(v))
  return vals.length ? vals.reduce((s,v)=>s+v,0)/vals.length : null
}

function status(val, bm, inv=false) {
  if(val===null||val===undefined) return 'na'
  if(!inv) return val>=bm?'green':val>=bm*0.85?'amber':'red'
  return val<=bm?'green':val<=bm*1.15?'amber':'red'
}
const SS = {
  green:{bg:'#dcfce7',color:'#16a34a',border:'#bbf7d0',label:'Good'},
  amber:{bg:'#fef3c7',color:'#d97706',border:'#fde68a',label:'Watch'},
  red:  {bg:'#fee2e2',color:'#dc2626',border:'#fecaca',label:'Action Needed'},
  na:   {bg:'#f1f5f9',color:'#94a3b8',border:'#e2e8f0',label:'No Data'},
}

function Sec({title,children,open:def=true}){
  const [o,setO]=useState(def)
  return(
    <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',marginBottom:16,overflow:'hidden'}}>
      <button onClick={()=>setO(x=>!x)} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 20px',background:'none',border:'none',cursor:'pointer',borderBottom:o?'1px solid #e2e8f0':'none'}}>
        <span style={{fontWeight:700,fontSize:14,color:'#1e293b'}}>{title}</span>
        {o?<IcoChevU size={15} style={{color:'#94a3b8'}}/>:<IcoChevD size={15} style={{color:'#94a3b8'}}/>}
      </button>
      {o&&<div style={{padding:'18px 20px'}}>{children}</div>}
    </div>
  )
}

function PillarScorecard({reports,providers,users}){
  const mgrs = useMemo(()=>{
    const m={}; OFFICES.forEach(o=>{const u=(users||[]).find(u=>u.office===o&&u.role==='manager'); m[o]=u?u.name:'—'}); return m
  },[users])

  const data = useMemo(()=>OFFICES.map(o=>{
    const or=reports.filter(r=>r.office===o)
    const m=fn=>rollingAvg(or,fn)
    const showRate  =m(r=>{const on=N(r.sched?.ptsOnSched);return on>0?N(r.sched?.ptsShowUp)/on*100:null})
    const recallConv=m(r=>{const mk=N(r.sched?.recalls);return mk>0?N(r.sched?.recallsSched)/mk*100:null})
    const callConv  =m(r=>{const c=N(r.sched?.npCalls);return c>0?N(r.sched?.npCallsSched)/c*100:null})
    const npShowRate=m(r=>{const on=N(r.sched?.npOnSched);return on>0?N(r.sched?.npShowed)/on*100:null})
    const txPresRate=m(r=>{const seen=N(r.sched?.npShowed);const pres=Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd?.npTxPres),0);return seen>0?pres/seen*100:null})
    const txAccRate =m(r=>{const pres=Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd?.npTxPres),0);const acc=Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd?.npTxAcc),0);return pres>0?acc/pres*100:null})
    const prodGoal  =m(r=>{const g=repGoal(r,providers);return g>0?repProd(r)/g*100:null})
    const collRate  =m(r=>{const p=repProd(r);return p>0?repColl(r)/p*100:null})
    const noShow    =m(r=>{const on=N(r.sched?.ptsOnSched);return on>0?N(r.sched?.noShows)/on*100:null})
    const pillars=[
      {key:'showRate',   label:'Show Rate',          val:showRate,   bm:BM.showRate,    inv:false},
      {key:'recallConv', label:'Recall Conversion',  val:recallConv, bm:BM.recallConv,  inv:false},
      {key:'callConv',   label:'NP Call Conversion', val:callConv,   bm:BM.callConv,    inv:false},
      {key:'npShowRate', label:'NP Show Rate',       val:npShowRate, bm:BM.npShowRate,  inv:false},
      {key:'txPresRate', label:'TX Presented Rate',  val:txPresRate, bm:BM.txPresRate,  inv:false},
      {key:'txAccRate',  label:'TX Acceptance Rate', val:txAccRate,  bm:BM.txAccRate,   inv:false},
      {key:'prodGoal',   label:'Prod vs Goal',       val:prodGoal,   bm:90,             inv:false},
      {key:'collRate',   label:'Collection Rate',    val:collRate,   bm:BM.collRate,    inv:false},
      {key:'noShow',     label:'No-Show Rate',       val:noShow,     bm:BM.noShowMax,   inv:true},
    ]
    const sts=pillars.map(p=>status(p.val,p.bm,p.inv))
    const red=sts.filter(s=>s==='red').length, amb=sts.filter(s=>s==='amber').length
    const overall=red>1?'red':red===1||amb>1?'amber':amb===1?'amber':'green'
    return{o,pillars,sts,overall,red,amb,mgr:mgrs[o]}
  }),[reports,providers,users,mgrs])

  return(
    <div>
      <div style={{fontSize:12,color:'#94a3b8',marginBottom:12}}>Rolling 30-day average · Benchmarks are placeholders — update targets as confirmed</div>
      <div style={{background:'#f8fafc',borderRadius:10,padding:'10px 14px',marginBottom:20,display:'flex',flexWrap:'wrap',gap:12,fontSize:11}}>
        <span style={{fontWeight:800,color:'#64748b',letterSpacing:1,alignSelf:'center'}}>TARGETS:</span>
        {[['Show',BM.showRate+'%'],['Recall',BM.recallConv+'%'],['NP Calls',BM.callConv+'%'],['NP Show',BM.npShowRate+'%'],['TX Pres',BM.txPresRate+'%'],['TX Acc',BM.txAccRate+'%'],['Prod/Goal','90%'],['Collections',BM.collRate+'%'],['No-Show Max',BM.noShowMax+'%']].map(([l,v])=>(
          <span key={l}><b>{l}:</b> {v}</span>
        ))}
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:16}}>
        {data.map(({o,pillars,overall,red,amb,mgr})=>{
          const os=SS[overall]
          return(
            <div key={o} style={{border:'2px solid '+os.border,borderRadius:14,overflow:'hidden'}}>
              <div style={{background:os.bg,padding:'14px 20px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
                <div>
                  <div style={{fontSize:16,fontWeight:800,color:'#1e293b'}}>{o}</div>
                  <div style={{fontSize:12,color:'#64748b',marginTop:2}}>Manager: <b>{mgr}</b></div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  {red>0&&<span style={{fontSize:11,fontWeight:700,padding:'3px 12px',borderRadius:99,background:'#fee2e2',color:'#dc2626'}}>{red} pillar{red>1?'s':''} need action</span>}
                  {amb>0&&<span style={{fontSize:11,fontWeight:700,padding:'3px 12px',borderRadius:99,background:'#fef3c7',color:'#d97706'}}>{amb} to watch</span>}
                  <span style={{fontSize:13,fontWeight:800,color:os.color}}>{os.label}</span>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:1,background:'#e2e8f0'}}>
                {pillars.map(p=>{
                  const st=status(p.val,p.bm,p.inv), ss=SS[st]
                  const diff=p.val!==null?(p.inv?p.bm-p.val:p.val-p.bm):null
                  return(
                    <div key={p.key} style={{background:'white',padding:'14px 16px'}}>
                      <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:1,marginBottom:6}}>{p.label.toUpperCase()}</div>
                      <div style={{display:'flex',alignItems:'flex-end',gap:8,marginBottom:6}}>
                        <div style={{fontSize:22,fontWeight:800,color:p.val!==null?ss.color:'#cbd5e1'}}>{p.val!==null?p.val.toFixed(1)+'%':'—'}</div>
                        {diff!==null&&<div style={{fontSize:10,fontWeight:700,color:diff>=0?'#16a34a':'#dc2626',marginBottom:4}}>{diff>=0?'▲':'▼'}{Math.abs(diff).toFixed(1)}%</div>}
                      </div>
                      <div style={{height:4,background:'#f1f5f9',borderRadius:2,overflow:'hidden',marginBottom:4}}>
                        {p.val!==null&&<div style={{height:'100%',borderRadius:2,background:ss.color,width:Math.min(p.inv?Math.max(0,100-p.val):p.val,100)+'%',transition:'width .4s'}}/>}
                      </div>
                      <div style={{fontSize:9,color:'#94a3b8'}}>Target: {p.bm}%</div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PillarTrends({reports,providers,activeOffice}){
  const filtered=reports.filter(r=>activeOffice==='all'||r.office===activeOffice).sort((a,b)=>a.date.localeCompare(b.date)).slice(-60)
  const labels=filtered.map(r=>r.date.slice(5))
  if(!filtered.length) return <div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>No data for this period</div>
  const mk=(label,data,color,cfn)=>({label,data,borderColor:color,backgroundColor:cfn(0.08),tension:.3,fill:true,pointRadius:3,spanGaps:true})
  const bl=(val,label)=>({label,data:filtered.map(()=>val),borderColor:'#94a3b8',borderDash:[4,4],borderWidth:1,pointRadius:0,fill:false})
  const opts=(yMax=100)=>({responsive:true,plugins:{legend:{position:'top',labels:{font:{size:11}}}},scales:{y:{min:0,max:yMax,ticks:{callback:v=>v+'%'},grid:{color:'#f1f5f9'}},x:{grid:{display:false},ticks:{maxTicksLimit:12}}}})
  const charts=[
    {title:'① Show Rate & No-Show Rate',cfg:{type:'line',data:{labels,datasets:[mk('Show Rate %',filtered.map(r=>{const on=N(r.sched?.ptsOnSched);return on>0?Math.round(N(r.sched?.ptsShowUp)/on*100):null}),C.teal,C.tA),mk('No-Show %',filtered.map(r=>{const on=N(r.sched?.ptsOnSched);return on>0?Math.round(N(r.sched?.noShows)/on*100):null}),C.red,C.rA),bl(BM.showRate,'Show Target'),bl(BM.noShowMax,'No-Show Max')]},options:opts()}},
    {title:'② Recall Conversion',cfg:{type:'line',data:{labels,datasets:[mk('Recall Conv %',filtered.map(r=>{const m=N(r.sched?.recalls);return m>0?Math.round(N(r.sched?.recallsSched)/m*100):null}),C.blue,C.bA),bl(BM.recallConv,'Target')]},options:opts()}},
    {title:'③ NP Call & Show Rate',cfg:{type:'line',data:{labels,datasets:[mk('NP Call Conv %',filtered.map(r=>{const c=N(r.sched?.npCalls);return c>0?Math.round(N(r.sched?.npCallsSched)/c*100):null}),C.purple,C.pA),mk('NP Show %',filtered.map(r=>{const on=N(r.sched?.npOnSched);return on>0?Math.round(N(r.sched?.npShowed)/on*100):null}),C.amber,C.aA),bl(BM.callConv,'Call Target'),bl(BM.npShowRate,'Show Target')]},options:opts()}},
    {title:'④ Prod vs Goal & Collections',cfg:{type:'line',data:{labels,datasets:[mk('Prod vs Goal %',filtered.map(r=>{const g=repGoal(r,providers);return g>0?Math.round(repProd(r)/g*100):null}),C.green,C.gnA),mk('Collection Rate %',filtered.map(r=>{const p=repProd(r);return p>0?Math.round(repColl(r)/p*100):null}),C.teal,C.tA),bl(90,'Prod Target'),bl(BM.collRate,'Coll Target')]},options:opts(120)}},
  ]
  return(
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
      {charts.map(({title,cfg})=>(
        <div key={title} style={{background:'white',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
          <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:12}}>{title.toUpperCase()}</div>
          <ChartCanvas config={cfg} height={220}/>
        </div>
      ))}
    </div>
  )
}

function NPFunnel({reports,activeOffice}){
  const filtered=reports.filter(r=>activeOffice==='all'||r.office===activeOffice)
  const calls=filtered.reduce((s,r)=>s+N(r.sched?.npCalls),0)
  const sched=filtered.reduce((s,r)=>s+N(r.sched?.npCallsSched),0)
  const showed=filtered.reduce((s,r)=>s+N(r.sched?.npShowed),0)
  const txPres=filtered.reduce((s,r)=>s+Object.values(r.fd||{}).reduce((a,fd)=>a+N(fd?.npTxPres),0),0)
  const txAcc=filtered.reduce((s,r)=>s+Object.values(r.fd||{}).reduce((a,fd)=>a+N(fd?.npTxAcc),0),0)
  if(!calls) return(
    <div style={{textAlign:'center',padding:40,color:'#94a3b8'}}>
      <div style={{fontSize:14,fontWeight:700,color:'#1e293b',marginBottom:6}}>No NP funnel data yet</div>
      <div style={{fontSize:12}}>Funnel data comes from the front desk section of daily reports. Data appears once NP call and TX metrics are logged.</div>
    </div>
  )
  const steps=[
    {label:'NP Calls Made',      val:calls,  pct:100,                              color:C.blue,   bg:'#eff6ff',  bm:null},
    {label:'Scheduled from Calls',val:sched, pct:calls>0?Math.round(sched/calls*100):0,  color:C.teal,   bg:'#f0fdfa',  bm:BM.callConv},
    {label:'Showed Up',           val:showed, pct:sched>0?Math.round(showed/sched*100):0, color:C.purple, bg:'#f5f3ff',  bm:BM.npShowRate},
    {label:'TX Presented',        val:txPres, pct:showed>0?Math.round(txPres/showed*100):0,color:C.amber,  bg:'#fffbeb',  bm:BM.txPresRate},
    {label:'TX Accepted',         val:txAcc,  pct:txPres>0?Math.round(txAcc/txPres*100):0, color:C.green,  bg:'#f0fdf4',  bm:BM.txAccRate},
  ]
  return(
    <div>
      <div style={{fontSize:12,color:'#94a3b8',marginBottom:16}}>{filtered.length} reports · {activeOffice==='all'?'all offices':''+activeOffice}</div>
      <div style={{display:'flex',gap:2,marginBottom:16}}>
        {steps.map((s,i)=>(
          <div key={s.label} style={{flex:1,background:s.bg,border:'1px solid '+s.color+'30',borderRadius:i===0?'10px 0 0 10px':i===steps.length-1?'0 10px 10px 0':0,padding:'16px 10px',textAlign:'center'}}>
            <div style={{fontSize:26,fontWeight:800,color:s.color}}>{s.val.toLocaleString()}</div>
            <div style={{fontSize:20,fontWeight:700,color:s.color,marginBottom:4}}>{s.pct}%</div>
            <div style={{fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,marginBottom:s.bm?4:0}}>{s.label.toUpperCase()}</div>
            {s.bm&&<div style={{fontSize:10,fontWeight:600,color:s.pct>=s.bm?'#16a34a':'#dc2626'}}>Target {s.bm}% {s.pct>=s.bm?'✓':'⚠'}</div>}
            {i>0&&steps[i-1].val>s.val&&<div style={{fontSize:10,color:'#dc2626',fontWeight:600,marginTop:4}}>{'-'+(steps[i-1].val-s.val).toLocaleString()} dropped</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function ProductionView({reports,providers,activeOffice}){
  const filtered=reports.filter(r=>activeOffice==='all'||r.office===activeOffice).sort((a,b)=>a.date.localeCompare(b.date)).slice(-60)
  const labels=filtered.map(r=>r.date.slice(5))
  const prodChart={type:'bar',data:{labels,datasets:[{label:'Net Production',data:filtered.map(r=>repProd(r)),backgroundColor:C.bA(.75),borderColor:C.blue,borderWidth:1,borderRadius:4},{label:'Goal',data:filtered.map(r=>repGoal(r,providers)),backgroundColor:C.gA(.3),borderColor:C.gray,borderWidth:1,borderRadius:4},{label:'Collections',data:filtered.map(r=>repColl(r)),backgroundColor:C.tA(.6),borderColor:C.teal,borderWidth:1,borderRadius:4}]},options:{responsive:true,plugins:{legend:{position:'top',labels:{font:{size:11}}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+USD(ctx.raw)}}},scales:{y:{ticks:{callback:v=>'$'+N(v).toLocaleString()},grid:{color:'#f1f5f9'}},x:{grid:{display:false},ticks:{maxTicksLimit:15}}}}}
  const byOffice=OFFICES.map(o=>{const or=reports.filter(r=>r.office===o);const prod=or.reduce((s,r)=>s+repProd(r),0);const goal=or.reduce((s,r)=>s+repGoal(r,providers),0);const coll=or.reduce((s,r)=>s+repColl(r),0);return{o,prod,goal,coll,pct:goal>0?Math.round(prod/goal*100):0}})
  const offChart={type:'bar',data:{labels:byOffice.map(o=>o.o),datasets:[{label:'Production',data:byOffice.map(o=>o.prod),backgroundColor:[C.bA(.8),C.tA(.8),C.pA(.8),C.aA(.8)],borderRadius:6},{label:'Goal',data:byOffice.map(o=>o.goal),backgroundColor:C.gA(.3),borderColor:C.gray,borderWidth:1,borderRadius:6}]},options:{responsive:true,plugins:{legend:{position:'top',labels:{font:{size:11}}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+USD(ctx.raw)}}},scales:{y:{ticks:{callback:v=>'$'+N(v).toLocaleString()},grid:{color:'#f1f5f9'}},x:{grid:{display:false}}}}}
  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{background:'white',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
        <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:12}}>PRODUCTION VS GOAL VS COLLECTIONS — DAILY</div>
        <ChartCanvas config={prodChart} height={280}/>
      </div>
      <div style={{background:'white',borderRadius:12,padding:'16px 18px',border:'1px solid #e2e8f0'}}>
        <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:12}}>ALL-TIME PRODUCTION BY OFFICE</div>
        <ChartCanvas config={offChart} height={200}/>
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10,marginTop:14}}>
          {byOffice.map(({o,prod,goal,pct})=>(
            <div key={o} style={{background:'#f8fafc',borderRadius:8,padding:'10px 12px'}}>
              <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:4}}>{o.toUpperCase()}</div>
              <div style={{fontSize:16,fontWeight:800,color:pct>=90?'#16a34a':'#dc2626'}}>{USD(prod)}</div>
              <div style={{fontSize:10,color:'#94a3b8'}}>{pct}% of goal</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function AnalyticsPage({reports,providers,notify,users}){
  const [view,setView]=useState('pillars')
  const [ao,setAo]=useState('all')
  const VIEWS=[{id:'pillars',label:'🎯 Manager Pillars'},{id:'trends',label:'📈 Pillar Trends'},{id:'funnel',label:'🔁 NP Funnel'},{id:'production',label:'💰 Production'}]
  return(
    <div style={{maxWidth:1200,margin:'0 auto',padding:'28px 20px 60px'}}>
      <div style={{marginBottom:24}}>
        <h1 style={{fontSize:24,fontWeight:800,color:'#1e293b',margin:0}}>Analytics</h1>
        <p style={{color:'#94a3b8',fontSize:13,marginTop:4}}>Manager performance · pillar tracking · rolling 30-day averages</p>
      </div>
      <div style={{display:'flex',gap:4,marginBottom:20,background:'white',padding:4,borderRadius:12,border:'1px solid #e2e8f0',flexWrap:'wrap'}}>
        {VIEWS.map(v=><button key={v.id} onClick={()=>setView(v.id)} style={{padding:'9px 18px',borderRadius:9,border:'none',cursor:'pointer',fontSize:13,fontWeight:600,background:view===v.id?'#1d4ed8':'transparent',color:view===v.id?'white':'#64748b'}}>{v.label}</button>)}
      </div>
      {view!=='pillars'&&(
        <div style={{display:'flex',gap:4,marginBottom:16,borderBottom:'2px solid #e2e8f0'}}>
          {['all',...OFFICES].map(o=><button key={o} onClick={()=>setAo(o)} style={{padding:'7px 16px',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,background:'none',color:ao===o?'#1d4ed8':'#94a3b8',borderBottom:ao===o?'2px solid #1d4ed8':'2px solid transparent',marginBottom:-2,borderRadius:'4px 4px 0 0'}}>{o==='all'?'All Offices':o}</button>)}
        </div>
      )}
      {view==='pillars'   &&<Sec title="Manager Pillar Scorecard — Rolling 30-Day Average"><PillarScorecard reports={reports} providers={providers} users={users}/></Sec>}
      {view==='trends'    &&<Sec title="Pillar Trend Lines"><PillarTrends reports={reports} providers={providers} activeOffice={ao}/></Sec>}
      {view==='funnel'    &&<Sec title="New Patient Funnel"><NPFunnel reports={reports} activeOffice={ao}/></Sec>}
      {view==='production'&&<Sec title="Production and Collections"><ProductionView reports={reports} providers={providers} activeOffice={ao}/></Sec>}
    </div>
  )
}
