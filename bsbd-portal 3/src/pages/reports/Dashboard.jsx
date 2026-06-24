import React, { useState } from 'react'
import { ReportCard } from './ReportCard'
import { IcoDL } from '../../components/icons'
import { exportMonthlyExcel } from '../../lib/monthlyExcelExport'
import { N, USD, PCT, todayStr, monthStart, repGoal, repProd, repColl, downloadCSV } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

// ── CSV Export ─────────────────────────────────────────────────────────────
function exportDashboardCSV(reports, providers, filename) {
  const esc = v => { const s = String(v==null?'':v); return s.includes(',')||s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s }
  const pct = (a,b) => b>0 ? Math.round(a/b*100)+'%' : '—'

  // Find every provider that appears across these reports → dynamic columns
  const provIds = []
  for (const rep of reports)
    for (const p of (rep.providers||[]))
      if (p.doctorId && !provIds.includes(p.doctorId)) provIds.push(p.doctorId)
  const provCols = provIds.map(id => {
    const pr = providers.find(x => x.id === id)
    return { id, name: pr ? pr.name : 'Provider '+id.slice(0,4), goal: pr ? N(pr.goal) : 0 }
  }).sort((a,b) => a.name.localeCompare(b.name))

  // Header section for providers: name spans 3 cols (Prod / Goal / %)
  const provH1 = []
  const provH2 = []
  for (const pc of provCols) {
    provH1.push('DR: '+pc.name, '', '')
    provH2.push('PRODUCTION', 'GOAL', '%AGE')
  }

  const h1 = ['OFFICE DETAILS','','','','PRODUCTION','','','','','SCHEDULE','SCHD CAPACITY',
    '','','','','','NP','','','','PREBOOKING','','COLLECTIONS','','','',
    'PATIENTS','','','','CALLS','','','','RECALLS','','TX PLANS NP','','',
    'TX PLANS EXT','','','PRE-Ds','','RECARE', '', ...provH1]
  const h2 = ['DATE','OFFICE','MANAGER','STAFF COUNT',
    'GOAL','PRODUCTION','VARIANCE','%AGE(-kpi 85%)','',
    'SCHD AMT','SCHD/GOAL-Kpi 110%','ACTUAL/SCHD PRD-Kpi 95%','',
    'GOAL','COLLECTIONS','VARIANCE','%AGE-(kpi-95%)','',
    'SCHEDULED PTS','PATIENTS SEEN','CANCELLED','SHOW RATE-kpi(90%)','',
    'NP SCHDL GOAL','NP SCHEDULED','NP SEEN','NP SHOW RATE-(kpi 85%)','',
    'COMP EXAMS SEEN','PTS BOOKED NEXT','PREBOOK RATE','',
    'NON-INS COLL','INS COLL','TOTAL COLL','COLL RATE','',
    '# OF RECEIVED CALLS-EXTERNAL','# OF RECEIVED CALLS-INTERNAL','MISSED CALL RATE-(kpi <10%)','TOTAL CALLS','',
    'RECALLS MADE','FROM RECALL SCHED','RECALL CONV RATE','',
    'NP TX PRESENTED','NP TX ACCEPTED','NP TX ACCEPTANCE RATE','',
    'EXT TX PRESENTED','EXT TX ACCEPTED','EXT TX ACCEPTANCE RATE','',
    'PRE-DS GENERATED','PRE-DS SUBMITTED','SUBMISSION RATE',
    'HYG PTS ON SCHED','HYG PTS SEEN','HYG NO-SHOW RATE',
    'PROVIDER PRODUCTION vs GOAL →', ...provH2]

  const rows = [h1, h2]

  for (const rep of reports) {
    const goal    = repGoal(rep, providers)
    const prod    = repProd(rep)
    const coll    = repColl(rep)
    const fdt     = rep.fd_totals || Object.values(rep.fd||{}).reduce((t,f)=>({
      calls:t.calls+N(f.calls), callsSched:t.callsSched+N(f.callsSched),
      recalls:t.recalls+N(f.recalls), recallsSched:t.recallsSched+N(f.recallsSched),
      npTxPres:t.npTxPres+N(f.npTxPres), npTxAcc:t.npTxAcc+N(f.npTxAcc),
      exTxPres:t.exTxPres+N(f.exTxPres), exTxAcc:t.exTxAcc+N(f.exTxAcc),
    }),{calls:0,callsSched:0,recalls:0,recallsSched:0,npTxPres:0,npTxAcc:0,exTxPres:0,exTxAcc:0})

    const staffCount   = Object.keys(rep.fd||{}).length
    const schedAmt     = N(rep.sched?.schedAmt)
    const ptsOnSched   = N(rep.sched?.ptsOnSched)
    const ptsShowUp    = N(rep.sched?.ptsShowUp)
    const npOnSched    = N(rep.sched?.npOnSched)
    const npShowed     = N(rep.sched?.npShowed)
    const compExams    = N(rep.sched?.compExamsSeen)
    const ptsPrebooked = N(rep.sched?.ptsPrebooked)
    const predGen      = N(rep.sched?.predGenerated)
    const predSub      = N(rep.sched?.predSubmitted)
    const hygOn        = N(rep.sched?.hygPtsOnSched)
    const hygSeen      = N(rep.sched?.hygPtsSeen)
    const hygNS        = hygOn > 0 ? Math.round((hygOn-hygSeen)*100/(hygOn||1)) : 0

    // Per-provider production for this day (blank if the dr didn't work)
    const provCells = []
    for (const pc of provCols) {
      const rp = (rep.providers||[]).find(p => p.doctorId === pc.id)
      if (rp && (N(rp.netProd) > 0 || rp.netProd != null && rp.netProd !== '')) {
        const dp = N(rp.netProd)
        provCells.push(dp, pc.goal || '', pct(dp, pc.goal))
      } else {
        provCells.push('', '', '')
      }
    }

    rows.push([
      rep.date, rep.office, rep.submittedBy||'', staffCount,
      goal, prod, prod-goal, pct(prod,goal), '',
      schedAmt, pct(schedAmt,goal), pct(prod,schedAmt), '',
      goal, coll, coll-goal, pct(coll,goal), '',
      ptsOnSched, ptsShowUp, N(rep.sched?.cancelled), pct(ptsShowUp,ptsOnSched), '',
      (rep.providers||[]).filter(p=>p.doctorId).length*4, npOnSched, npShowed, pct(npShowed,npOnSched), '',
      compExams, ptsPrebooked, pct(ptsPrebooked,compExams), '',
      N(rep.coll?.nonIns), N(rep.coll?.ins), coll, pct(coll,prod), '',
      fdt.calls, fdt.callsSched, '', fdt.calls+fdt.callsSched, '',
      fdt.recalls, fdt.recallsSched, pct(fdt.recallsSched,fdt.recalls), '',
      fdt.npTxPres, fdt.npTxAcc, pct(fdt.npTxAcc,fdt.npTxPres), '',
      fdt.exTxPres, fdt.exTxAcc, pct(fdt.exTxAcc,fdt.exTxPres), '',
      predGen, predSub, pct(predSub,predGen),
      hygOn, hygSeen, hygNS+'%',
      '', ...provCells
    ].map(esc))
  }

  const csv = rows.map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], {type:'text/csv'})
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}


// ── DashboardPage ──────────────────────────────────────────────────────────
export default function DashboardPage({reports, providers, users, user, isManager, notify, onEdit}) {
  const [selDate,    setSelDate]    = useState(null)
  const [rangeType,  setRangeType]  = useState('7d')
  const [customStart,setCustomStart]= useState(monthStart())
  const [customEnd,  setCustomEnd]  = useState(todayStr())
  const [officeFilter,setOfficeFilter]= useState('all')
  const [exporting,  setExporting]  = useState(false)
  const today = todayStr()

  // Range cutoff helper
  const rangeCutoff = () => {
    if (rangeType==='today') return today
    if (rangeType==='7d')    { const d=new Date(today); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) }
    if (rangeType==='mtd')   return monthStart()
    if (rangeType==='30d')   { const d=new Date(today); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10) }
    return customStart
  }

  const dlCSV = (office='all') => {
    const filtered = reports.filter(r => {
      const inRange = rangeType==='today' ? r.date===todayStr()
                    : rangeType==='mtd'   ? r.date>=monthStart()
                    : r.date>=customStart && r.date<=customEnd
      const inOffice = office==='all' || r.office===office
      return inRange && inOffice
    })
    const label = office==='all' ? 'All_Offices' : office.split(' ').join('_')
    exportDashboardCSV(filtered, providers, 'BSBD_Dashboard_'+label+'_'+todayStr()+'.csv')
  }

  const dlExcel = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const month = (rangeType==='today'||rangeType==='mtd')
        ? todayStr().slice(0,7)
        : customStart.slice(0,7)
      const monthReps = reports.filter(r => r.date.startsWith(month))
      if (!monthReps.length) {
        notify('No reports found for ' + month, 'error')
        setExporting(false)
        return
      }
      await exportMonthlyExcel(monthReps, providers, users, month)
      notify('Excel report downloaded')
    } catch(e) {
      notify('Export failed: ' + e.message, 'error')
      console.error('Excel export error:', e)
    }
    setExporting(false)
  }

  const cutoff = rangeCutoff()
  const visibleReports = reports.filter(r => {
    // Date range
    if (rangeType==='today') { if (r.date !== today) return false }
    else if (rangeType==='custom') { if (r.date < customStart || r.date > customEnd) return false }
    else { if (r.date < cutoff || r.date > today) return false }
    // Office filter — managers see their own by default unless they pick 'all'
    if (officeFilter !== 'all' && r.office !== officeFilter) return false
    if (officeFilter === 'all' && isManager && user?.role !== 'admin' && r.office !== user?.office) return false
    return true
  })
  .sort((a,b) => b.date.localeCompare(a.date)||b.submittedAt?.localeCompare(a.submittedAt||'')||0)

  return (
    <div style={{maxWidth:1100,margin:'0 auto',padding:'24px 20px 60px'}}>
      {/* ── Office filter tabs ── */}
      <div style={{display:'flex',gap:4,marginBottom:12,flexWrap:'wrap'}}>
        {[['all','All Offices'],['Brainerd','Brainerd'],['Calhoun','Calhoun'],['Dalton','Dalton'],['McCallie','McCallie']].map(([v,l])=>(
          <button key={v} onClick={()=>setOfficeFilter(v)}
            style={{padding:'6px 14px',borderRadius:8,fontWeight:700,fontSize:12,cursor:'pointer',
              border:'1px solid '+(officeFilter===v?'#1e3a5f':'#e2e8f0'),
              background:officeFilter===v?'#1e3a5f':'white',
              color:officeFilter===v?'white':'#64748b'}}>
            {l}
          </button>
        ))}
      </div>

      {/* ── Date range + export ── */}
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:20}}>
        <div style={{display:'flex',gap:4}}>
          {[['7d','Last 7D'],['today','Today'],['mtd','MTD'],['30d','Last 30D'],['custom','Custom']].map(([v,l])=>(
            <button key={v} onClick={()=>setRangeType(v)}
              style={{padding:'7px 14px',borderRadius:8,border:'1px solid '+(rangeType===v?'#1d4ed8':'#e2e8f0'),
                background:rangeType===v?'#1d4ed8':'white',color:rangeType===v?'white':'#64748b',
                fontWeight:600,fontSize:12,cursor:'pointer'}}>
              {l}
            </button>
          ))}
        </div>
        {rangeType==='custom'&&(
          <div style={{display:'flex',gap:6,alignItems:'center'}}>
            <input type="date" value={customStart} onChange={e=>setCustomStart(e.target.value)}
              style={{padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
            <span style={{fontSize:11,color:'#94a3b8'}}>to</span>
            <input type="date" value={customEnd} onChange={e=>setCustomEnd(e.target.value)}
              style={{padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
          </div>
        )}
        <div style={{marginLeft:'auto',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
          <div style={{display:'flex',borderRadius:9,overflow:'hidden',border:'1px solid #1d4ed8'}}>
            <button onClick={()=>dlCSV(officeFilter)}
              style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
              Download CSV
            </button>
          </div>
          <button onClick={dlExcel} disabled={exporting}
            style={{padding:'8px 16px',borderRadius:9,background:exporting?'#6b7280':'#0d9488',color:'white',
              border:'none',fontWeight:700,fontSize:12,cursor:exporting?'not-allowed':'pointer',whiteSpace:'nowrap'}}>
            {exporting ? 'Generating...' : 'Monthly KPI Report (.xlsx)'}
          </button>
        </div>
      </div>

      {visibleReports.length===0?(
        <div style={{textAlign:'center',padding:60,color:'#94a3b8'}}>No reports found for this period</div>
      ):(
        visibleReports.map(r=>(
          <ReportCard key={r.id} r={r} providers={providers} selDate={selDate} setSelDate={setSelDate} onEdit={onEdit}/>
        ))
      )}
    </div>
  )
}
