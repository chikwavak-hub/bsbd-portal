// ════════════════════════════════════════════════════════════════════════════
// BSBD Analytics Export — Excel + PDF, section-selectable
// Recomputes the same metrics shown on the Analytics page so exports match.
// ════════════════════════════════════════════════════════════════════════════
import { N, USD, repGoal, repProd, repColl } from './helpers'

const OFFICES = ['Brainerd','Calhoun','Dalton','McCallie']
const BM = { showRate:90, recallConv:85, callConv:50, npShowRate:80, txAccRate:60, collRate:95 }
const pct = (a,b) => b>0 ? Math.round(a/b*100) : 0
const money = n => '$'+Math.round(N(n)).toLocaleString()

// ── Build the data for each section, scoped to the date window ──────────────
function inWin(r, cutoff, today) { return r.date >= cutoff && r.date <= today }

export function buildAnalyticsData(reports, providers, { days = 30, today }) {
  const cutoff = (() => { const d = new Date(today); d.setDate(d.getDate()-days); return d.toISOString().slice(0,10) })()
  const reps = reports.filter(r => inWin(r, cutoff, today))

  // ── PERFORMANCE: per-office totals ──
  const performance = OFFICES.map(o => {
    const or = reps.filter(r => r.office === o)
    const prod = or.reduce((s,r)=>s+repProd(r),0)
    const goal = or.reduce((s,r)=>s+repGoal(r,providers),0)
    const coll = or.reduce((s,r)=>s+repColl(r),0)
    const ptsOn = or.reduce((s,r)=>s+N(r.sched?.ptsOnSched),0)
    const ptsShow = or.reduce((s,r)=>s+N(r.sched?.ptsShowUp),0)
    const npOn = or.reduce((s,r)=>s+N(r.sched?.npOnSched),0)
    const npShow = or.reduce((s,r)=>s+N(r.sched?.npShowed),0)
    return {
      office:o, days:or.length, production:Math.round(prod), goal:Math.round(goal),
      pctOfGoal:pct(prod,goal), collections:Math.round(coll), collRate:pct(coll,prod),
      showRate:pct(ptsShow,ptsOn), npShowRate:pct(npShow,npOn),
      avgDaily:or.length>0?Math.round(prod/or.length):0,
    }
  }).filter(o => o.days > 0)

  // ── PROVIDER PRODUCTION: per-provider, with utilization ──
  const provMap = {}
  reps.forEach(r => (r.providers||[]).forEach(rp => {
    if (!rp.doctorId) return
    const pv = providers.find(p=>p.id===rp.doctorId)
    if (!pv) return
    const key = pv.id+'|'+r.office
    if (!provMap[key]) provMap[key] = { name:pv.name||'Unknown', office:r.office, dailyGoal:N(pv.goal), prod:0, days:0, goalDays:0, openSched:0, ptsSeen:0, npSeen:0 }
    const s = provMap[key], prd = N(rp.netProd)
    if (prd>0) { s.prod+=prd; s.days++; if(prd>=s.dailyGoal&&s.dailyGoal>0)s.goalDays++ }
    s.openSched += N(rp.openSchedule); s.ptsSeen += N(rp.ptsSeen); s.npSeen += N(rp.npSeen)
  }))
  const providerProduction = Object.values(provMap).map(s => ({
    provider:s.name, office:s.office, production:Math.round(s.prod),
    goal:Math.round(s.dailyGoal*s.days), pctOfGoal:s.dailyGoal*s.days>0?pct(s.prod,s.dailyGoal*s.days):0,
    openingSchedule:Math.round(s.openSched), scheduleUtil:s.openSched>0?pct(s.prod,s.openSched):null,
    daysWorked:s.days, avgPerDay:s.days>0?Math.round(s.prod/s.days):0,
    consistency:s.days>0?pct(s.goalDays,s.days):0, ptsSeen:s.ptsSeen, npSeen:s.npSeen,
  })).sort((a,b)=>b.production-a.production)

  // ── SCHEDULE LEAKAGE: funnel stages ──
  const stageDefs = [
    { key:'phoneConv',  label:'Phone Conversion',   bm:BM.callConv,   acc:'Front Desk',
      num:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.callsSched),0), den:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.calls),0) },
    { key:'recallConv', label:'Recall Conversion',  bm:BM.recallConv, acc:'Front Desk',
      num:r=>N(r.sched?.recallsSched)||Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.recallsSched),0), den:r=>N(r.sched?.recalls)||Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.recalls),0) },
    { key:'confirmRate',label:'Confirmation Rate',  bm:90, acc:'Front Desk',
      num:r=>N(r.sched?.ptsConfirmed), den:r=>N(r.sched?.ptsOnSched) },
    { key:'showRate',   label:'Show Rate',          bm:BM.showRate, acc:'Office',
      num:r=>N(r.sched?.ptsShowUp), den:r=>N(r.sched?.ptsOnSched) },
    { key:'npShowRate', label:'NP Show Rate',       bm:BM.npShowRate, acc:'Office',
      num:r=>N(r.sched?.npShowed), den:r=>N(r.sched?.npOnSched) },
    { key:'prebookRate',label:'Prebooking',         bm:80, acc:'Clinical + FD',
      num:r=>N(r.sched?.ptsPrebooked), den:r=>N(r.sched?.compExamsSeen) },
    { key:'npTxAcc',    label:'NP TX Acceptance',   bm:BM.txAccRate, acc:'Treatment Coord',
      num:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.npTxAcc),0), den:r=>Object.values(r.fd||{}).reduce((s,fd)=>s+N(fd.npTxPres),0) },
  ]
  const leakage = stageDefs.map(st => {
    const num = reps.reduce((s,r)=>s+st.num(r),0)
    const den = reps.reduce((s,r)=>s+st.den(r),0)
    const rate = den>0 ? Math.round(num/den*100) : null
    const lost = (rate!=null && rate<st.bm) ? Math.round((st.bm-rate)/100*den) : 0
    return { stage:st.label, accountable:st.acc, rate, target:st.bm, numerator:num, denominator:den, flagged:rate!=null&&rate<st.bm, estLost:lost }
  })

  // ── Daily trend (for charts in PDF) ──
  const byDate = {}
  reps.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = { prod:0, goal:0, coll:0 }
    byDate[r.date].prod += repProd(r); byDate[r.date].goal += repGoal(r,providers); byDate[r.date].coll += repColl(r)
  })
  const trend = Object.keys(byDate).sort().map(d => ({ date:d, production:Math.round(byDate[d].prod), goal:Math.round(byDate[d].goal), collections:Math.round(byDate[d].coll) }))

  return { cutoff, today, days, reportCount:reps.length, performance, providerProduction, leakage, trend }
}

// ════════════════════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ════════════════════════════════════════════════════════════════════════════
export async function exportAnalyticsExcel(data, sections) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
  const wb = XLSX.utils.book_new()
  const scope = `Last ${data.days} days (${data.cutoff} → ${data.today}) · ${data.reportCount} reports`

  // Summary sheet always included
  const summaryRows = [
    ['BSBD ANALYTICS EXPORT'], [scope], [`Generated ${new Date().toLocaleString()}`], [],
    ['Sections included:', sections.join(', ')], [],
  ]
  const wsS = XLSX.utils.aoa_to_sheet(summaryRows)
  wsS['!cols'] = [{wch:24},{wch:40}]
  XLSX.utils.book_append_sheet(wb, wsS, 'Summary')

  if (sections.includes('performance') && data.performance.length) {
    const header = ['Office','Days','Production','Goal','% of Goal','Collections','Coll Rate','Show Rate','NP Show Rate','Avg/Day']
    const rows = data.performance.map(o => [o.office,o.days,o.production,o.goal,o.pctOfGoal+'%',o.collections,o.collRate+'%',o.showRate+'%',o.npShowRate+'%',o.avgDaily])
    const ws = XLSX.utils.aoa_to_sheet([['OFFICE PERFORMANCE — '+scope],[],header,...rows])
    ws['!cols'] = [{wch:12},...Array(9).fill({wch:12})]
    XLSX.utils.book_append_sheet(wb, ws, 'Performance')
  }

  if (sections.includes('providers') && data.providerProduction.length) {
    const header = ['Provider','Office','Production','Opening Schedule','Schedule Util %','Goal','% of Goal','Days','Avg/Day','Consistency','Pts Seen','NP Seen']
    const rows = data.providerProduction.map(p => [p.provider,p.office,p.production,p.openingSchedule,p.scheduleUtil!=null?p.scheduleUtil+'%':'—',p.goal,p.pctOfGoal+'%',p.daysWorked,p.avgPerDay,p.consistency+'%',p.ptsSeen,p.npSeen])
    const ws = XLSX.utils.aoa_to_sheet([['PROVIDER PRODUCTION — '+scope],[],header,...rows])
    ws['!cols'] = [{wch:20},{wch:11},...Array(10).fill({wch:13})]
    XLSX.utils.book_append_sheet(wb, ws, 'Provider Production')
  }

  if (sections.includes('leakage') && data.leakage.length) {
    const header = ['Funnel Stage','Accountable','Rate','Target','Numerator','Denominator','Flagged','Est. Patients Lost']
    const rows = data.leakage.map(s => [s.stage,s.accountable,s.rate!=null?s.rate+'%':'—',s.target+'%',s.numerator,s.denominator,s.flagged?'⚠ YES':'OK',s.estLost||''])
    const ws = XLSX.utils.aoa_to_sheet([['SCHEDULE LEAKAGE — '+scope],[],header,...rows])
    ws['!cols'] = [{wch:20},{wch:16},...Array(6).fill({wch:13})]
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule Leakage')
  }

  if (sections.includes('trend') && data.trend.length) {
    const header = ['Date','Production','Goal','Collections']
    const rows = data.trend.map(t => [t.date,t.production,t.goal,t.collections])
    const ws = XLSX.utils.aoa_to_sheet([['DAILY TREND — '+scope],[],header,...rows])
    ws['!cols'] = [{wch:12},{wch:13},{wch:13},{wch:13}]
    XLSX.utils.book_append_sheet(wb, ws, 'Daily Trend')
  }

  XLSX.writeFile(wb, `BSBD_Analytics_${data.today}.xlsx`)
}

// ════════════════════════════════════════════════════════════════════════════
// PDF EXPORT (printable window)
// ════════════════════════════════════════════════════════════════════════════
export function exportAnalyticsPdf(data, sections) {
  const scope = `Last ${data.days} days &middot; ${data.cutoff} → ${data.today} &middot; ${data.reportCount} reports`

  const tbl = (title, header, rows, color='#1e3a5f') => `
    <h2 style="color:${color}">${title}</h2>
    <table><thead><tr>${header.map((h,i)=>`<th style="text-align:${i===0?'left':'right'}">${h}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map((c,i)=>`<td style="text-align:${i===0?'left':'right'}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`

  let body = ''

  if (sections.includes('performance') && data.performance.length) {
    body += tbl('Office Performance',
      ['Office','Days','Production','Goal','% Goal','Collections','Coll %','Show %','NP Show %'],
      data.performance.map(o => [o.office,o.days,money(o.production),money(o.goal),
        `<b style="color:${o.pctOfGoal>=85?'#16a34a':'#dc2626'}">${o.pctOfGoal}%</b>`,
        money(o.collections),`${o.collRate}%`,`${o.showRate}%`,`${o.npShowRate}%`]))
  }

  if (sections.includes('providers') && data.providerProduction.length) {
    body += tbl('Provider Production vs Goal & Schedule Utilization',
      ['Provider','Office','Production','Open Sched','Util %','Goal','% Goal','Days','Consistency'],
      data.providerProduction.map(p => [p.provider,p.office,money(p.production),money(p.openingSchedule),
        p.scheduleUtil!=null?`<b style="color:${p.scheduleUtil>=85?'#16a34a':'#d97706'}">${p.scheduleUtil}%</b>`:'—',
        money(p.goal),`<b style="color:${p.pctOfGoal>=85?'#16a34a':'#dc2626'}">${p.pctOfGoal}%</b>`,
        p.daysWorked,`${p.consistency}%`]), '#7c3aed')
  }

  if (sections.includes('leakage') && data.leakage.length) {
    body += tbl('Schedule Leakage Funnel',
      ['Stage','Accountable','Rate','Target','Volume','Est. Lost'],
      data.leakage.map(s => [
        `${s.flagged?'🔴 ':''}${s.stage}`, s.accountable,
        s.rate!=null?`<b style="color:${s.flagged?'#dc2626':'#16a34a'}">${s.rate}%</b>`:'—',
        `${s.target}%`, `${s.numerator}/${s.denominator}`, s.estLost?`~${s.estLost}`:'—']), '#dc2626')
  }

  if (sections.includes('trend') && data.trend.length) {
    // simple inline SVG line chart for production vs goal
    const w=720,h=200,pad=40
    const max = Math.max(...data.trend.map(t=>Math.max(t.production,t.goal)),1)*1.1
    const xp = i => pad + (i/Math.max(data.trend.length-1,1))*(w-pad*2)
    const yp = v => h-pad-(v/max)*(h-pad*2)
    const lineFor = key => data.trend.map((t,i)=>`${i===0?'M':'L'} ${xp(i)} ${yp(t[key])}`).join(' ')
    body += `<h2 style="color:#1d4ed8">Daily Trend — Production vs Goal</h2>
      <svg viewBox="0 0 ${w} ${h}" style="width:100%;height:200px">
        <path d="${lineFor('goal')}" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="5,4"/>
        <path d="${lineFor('production')}" fill="none" stroke="#1d4ed8" stroke-width="2.5"/>
        ${data.trend.map((t,i)=>`<circle cx="${xp(i)}" cy="${yp(t.production)}" r="2.5" fill="#1d4ed8"/>`).join('')}
      </svg>
      <div style="font-size:11px;color:#94a3b8;margin-top:4px">Blue = production · Grey dashed = goal</div>`
  }

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>BSBD Analytics</title>
  <style>
    @page { margin:0.6in; }
    body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; color:#1e293b; padding:20px; }
    h1 { font-size:22px; color:#1e3a5f; margin:0 0 2px; }
    .sub { font-size:12px; color:#94a3b8; margin-bottom:18px; }
    h2 { font-size:14px; letter-spacing:.3px; margin:24px 0 10px; padding-bottom:5px; border-bottom:2px solid #e2e8f0; }
    table { width:100%; border-collapse:collapse; font-size:11px; margin-bottom:6px; }
    th { background:#f1f5f9; padding:7px 9px; font-size:9px; font-weight:800; color:#64748b; letter-spacing:.3px; }
    td { padding:6px 9px; border-bottom:1px solid #f1f5f9; }
    tr:nth-child(even) td { background:#fafafa; }
    .foot { margin-top:30px; font-size:10px; color:#cbd5e1; text-align:center; }
    @media print { button { display:none; } }
  </style></head><body>
    <button onclick="window.print()" style="position:fixed;top:12px;right:12px;padding:8px 18px;background:#1e3a5f;color:white;border:none;border-radius:8px;font-weight:700;cursor:pointer">Print / Save PDF</button>
    <h1>Analytics Report</h1>
    <div class="sub">${scope} &middot; Generated ${new Date().toLocaleDateString()}</div>
    ${body || '<p style="color:#94a3b8">No sections selected.</p>'}
    <div class="foot">Beautiful Smiles by Design &middot; Analytics &middot; Confidential</div>
    <script>setTimeout(()=>window.print(),400)</script>
  </body></html>`

  const wdw = window.open('', '_blank')
  if (!wdw) { alert('Please allow popups to generate the PDF report.'); return }
  wdw.document.write(html); wdw.document.close()
}
