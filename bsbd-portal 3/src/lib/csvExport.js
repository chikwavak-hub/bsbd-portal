// ── Dashboard CSV Export ─────────────────────────────────────────────────
// Pure JS file — no JSX
import { N } from './helpers'

// ── Dashboard CSV Export ──────────────────────────────────────────────────
// Matches BSBD_Dashboard format exactly
export function exportDashboardCSV(reports, providers, filename) {
  const N  = v => Number(v)||0
  const pct = (a,b) => b>0 ? Math.round(a/b*100)+'%' : '0%'
  const usd = v => v ? '$'+N(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) : '$0.00'
  const esc = v => { const s = String(v==null?'':v); return s.includes(',')||s.includes('"') ? '"'+s.replace(/"/g,'""')+'"' : s }

  // Header rows matching the template exactly
  const h1 = ['OFFICE DETAILS','','','','PRODUCTION','','','','','COLLECTIONS','','','','','PATIENT FLOW','','','','','NEW PATIENTS','','','','','TREATMENT PLANS','','','','','','','PREDETERMINATIONS','','','','CALL HANDLING','','']
  const h2 = [
    'DATE','OFFICE','MANAGER','',
    'GOAL','PRODUCTION','VARIANCE','%AGE(-kpi 85%)','',
    'GOAL','COLLECTIONS','VARIANCE','%AGE-(kpi-95%)','',
    'SCHEDULED PTS','PATIENTS SEEN','CANCELLED','SHOW RATE-kpi(90%)','',
    'NP SCHDL GOAL','NP SCHEDULED','NP SEEN','NP SHOW RATE-(kpi 85%)','',
    '#OF TPS PRESENTED-NP','#OF TPS PRESENTED-Ext P','#OF TPS ACCEPTED-NP','#OF TPS ACCEPTED-Ext Pts','CASE ACTP-NP-(kpi 85%)','CASE ACTP-EXT Pts(kpi 90%)','',
    '#Of PreDs Generated','#Of PreDs Submitted','PreD Submission Rate-(kpi 100%)','',
    '# OF RECEIVED CALLS-EXTERNAL','# OF RECEIVED CALLS-INTERNAL','MISSED CALL RATE-(kpi <10%)',
  ]

  const rows = [h1, h2]

  for (const rep of [...reports].sort((a,b) => b.date.localeCompare(a.date))) {
    // Provider goal
    const offProviders = providers.filter(p => p.office === rep.office)
    const numDrs = offProviders.filter(p => !p.name?.toLowerCase().includes('hyg')).length || 1
    const goal   = offProviders.reduce((s,p) => s+N(p.goal), 0)

    // Production
    const prod = offProviders.reduce((s,p) => {
      const rp = (rep.providers||[]).find(x => x.doctorId===p.id)
      return s + N(rp?.netProd||rp?.openingBalance||0)
    }, 0) + (rep.hygiene||[]).reduce((s,h) => s+N(h.netProd),0)

    // Collections
    const coll = N(rep.coll?.ins) + N(rep.coll?.nonIns)

    // Patient flow
    const scheduled = N(rep.sched?.ptsOnSched)
    const seen      = N(rep.sched?.ptsShowUp)
    const cancelled = N(rep.sched?.cancelled)
    const noShows   = N(rep.sched?.noShows)

    // New patients
    const npGoal    = numDrs * 4
    const npSched   = N(rep.sched?.npOnSched)
    const npSeen    = N(rep.sched?.npShowed)

    // Treatment plans — sum across all FD entries
    const fdVals = Object.values(rep.fd||{})
    const npTxPres  = fdVals.reduce((s,f) => s+N(f?.npTxPres),  0)
    const extTxPres = fdVals.reduce((s,f) => s+N(f?.extTxPres), 0)
    const npTxAcc   = fdVals.reduce((s,f) => s+N(f?.npTxAcc),   0)
    const extTxAcc  = fdVals.reduce((s,f) => s+N(f?.extTxAcc),  0)

    // Predeterminations from today's activity log
    const preds     = (rep.predToday||[])
    const predGen   = preds.length
    const predSub   = preds.filter(p => p.pred_sent).length

    // Calls
    const callsExt  = N(rep.calls?.external)
    const callsInt  = N(rep.calls?.internal)
    const callsMiss = N(rep.calls?.missed)
    const callsTotal= callsExt + callsInt
    const missRate  = callsTotal > 0 ? Math.round(callsMiss/callsTotal*100)+'%' : '0%'

    rows.push([
      rep.date, rep.office, rep.submittedBy||'', '',
      usd(goal), usd(prod), usd(prod-goal), pct(prod,goal), '',
      usd(goal), usd(coll), usd(coll-goal), pct(coll,prod), '',
      scheduled, seen, cancelled, pct(seen,scheduled), '',
      npGoal, npSched, npSeen, pct(npSeen,npSched), '',
      npTxPres, extTxPres, npTxAcc, extTxAcc, pct(npTxAcc,npTxPres), pct(extTxAcc,extTxPres), '',
      predGen, predSub, pct(predSub,predGen), '',
      callsExt, callsInt, missRate,
    ].map(esc))
  }

  const csv  = rows.map(r => r.join(',')).join('\r\n')
  const blob = new Blob([csv], {type:'text/csv'})
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename || 'BSBD_Dashboard_'+new Date().toISOString().slice(0,10)+'.csv'
  a.click()
  URL.revokeObjectURL(url)
}
