import React, { useState, useMemo, useRef, useEffect } from 'react'
import { N, USD, todayStr, repGoal, repProd, repColl } from '../../lib/helpers'

// ── Month name helpers ─────────────────────────────────────────────────────
const MONTH_NAMES = ['january','february','march','april','may','june',
  'july','august','september','october','november','december']
const MONTH_SHORT = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']

// ── Detect which months the question is asking about ─────────────────────
function detectMonths(q) {
  const lower = q.toLowerCase()
  const found = []
  const curYear = new Date().getFullYear()
  MONTH_NAMES.forEach((m, i) => {
    if (lower.includes(m) || lower.includes(MONTH_SHORT[i])) {
      // Try to detect year too
      const yearMatch = lower.match(new RegExp(`${MONTH_SHORT[i]}[a-z]*\\s*(\\d{4})`))
      const year = yearMatch ? yearMatch[1] : String(curYear)
      found.push(`${year}-${String(i+1).padStart(2,'0')}`)
    }
  })
  // "this month" / "last month"
  if (lower.includes('this month')) {
    found.push(todayStr().slice(0,7))
  }
  if (lower.includes('last month') || lower.includes('prior month')) {
    const d = new Date(); d.setMonth(d.getMonth()-1)
    found.push(d.toISOString().slice(0,7))
  }
  if (lower.includes('this year')) {
    for (let i=1; i<=12; i++) found.push(`${curYear}-${String(i).padStart(2,'0')}`)
  }
  if (lower.includes('last year')) {
    for (let i=1; i<=12; i++) found.push(`${curYear-1}-${String(i).padStart(2,'0')}`)
  }
  // "q1" / "q2" etc
  const qMatch = lower.match(/q([1-4])/)
  if (qMatch) {
    const qn = parseInt(qMatch[1])
    const start = (qn-1)*3+1
    for (let i=start; i<start+3; i++) found.push(`${curYear}-${String(i).padStart(2,'0')}`)
  }
  return [...new Set(found)]
}

// ── Detect offices mentioned ───────────────────────────────────────────────
function detectOffices(q) {
  const lower = q.toLowerCase()
  const all = ['brainerd','calhoun','dalton','mccallie']
  const found = all.filter(o => lower.includes(o))
  return found.length ? found : null  // null = all offices
}

// ── Build smart context from raw data ─────────────────────────────────────
export function buildContext(question, reports, providers, tcPatients) {
  const months  = detectMonths(question)
  const offices = detectOffices(question)
  const lower   = question.toLowerCase()

  // Filter reports
  let reps = reports
  if (months.length)  reps = reps.filter(r => months.some(m => r.date.startsWith(m)))
  if (offices)        reps = reps.filter(r => offices.includes(r.office.toLowerCase()))

  // Always include the month/date range in context
  const dateRange = months.length
    ? months.join(', ')
    : `All available data (${reports.length} reports, ${[...new Set(reports.map(r=>r.date.slice(0,7)))].sort().join(', ')})`

  const ctx = {
    date_range: dateRange,
    offices_included: offices ? offices.map(o=>o.charAt(0).toUpperCase()+o.slice(1)) : ['Brainerd','Calhoun','Dalton','McCallie'],
    report_count: reps.length,
  }

  // If the filter produced nothing, fall back to all reports so we never send an empty context
  if (reps.length === 0 && reports.length > 0) {
    reps = months.length ? reports.filter(r => offices ? offices.includes(r.office.toLowerCase()) : true) : reports
    ctx.note = months.length
      ? `No reports found for ${months.join(', ')}. Showing all available data instead — tell the user the requested month had no data.`
      : 'Showing all available data.'
    ctx.report_count = reps.length
    ctx.available_months = [...new Set(reports.map(r=>r.date.slice(0,7)))].sort()
  }

  // ── ALWAYS include a top-line summary so every question has something to work with ──
  {
    const totalProd = reps.reduce((s,r)=>s+repProd(r),0)
    const totalGoal = reps.reduce((s,r)=>s+repGoal(r,providers),0)
    const totalColl = reps.reduce((s,r)=>s+repColl(r),0)
    ctx.overall_summary = {
      total_production:  Math.round(totalProd),
      total_goal:        Math.round(totalGoal),
      pct_of_goal:       totalGoal>0 ? Math.round(totalProd/totalGoal*100) : 0,
      total_collections: Math.round(totalColl),
      collection_rate:   totalProd>0 ? Math.round(totalColl/totalProd*100) : 0,
      report_days:       reps.length,
      avg_daily_production: reps.length>0 ? Math.round(totalProd/reps.length) : 0,
      months_covered:    [...new Set(reps.map(r=>r.date.slice(0,7)))].sort(),
      offices_with_data: [...new Set(reps.map(r=>r.office))].sort(),
    }
  }

  // ── Provider production (always included — most-asked dimension) ────────
  if (true) {
    const provMap = {}
    reps.forEach(r => {
      ;(r.providers||[]).forEach(rp => {
        if (!rp.doctorId) return
        const pv = providers.find(p=>p.id===rp.doctorId)
        if (!pv) return
        const key = pv.name
        if (!provMap[key]) provMap[key] = {
          name:pv.name, office:r.office, goal_per_day:N(pv.goal),
          total_production:0, total_goal:0, days:0,
          pts_seen:0, np_seen:0, sched_amt:0
        }
        const prod = N(rp.netProd)
        if (prod>0 || N(rp.ptsSeen)>0) {
          provMap[key].total_production += prod
          provMap[key].total_goal       += N(pv.goal)
          provMap[key].days             += 1
          provMap[key].pts_seen         += N(rp.ptsSeen)
          provMap[key].np_seen          += N(rp.npSeen)
          provMap[key].sched_amt        += N(rp.openSchedule)
        }
      })
    })
    ctx.provider_production = Object.values(provMap).map(p => ({
      ...p,
      avg_per_day:    p.days>0 ? Math.round(p.total_production/p.days) : 0,
      pct_of_goal:    p.total_goal>0 ? Math.round(p.total_production/p.total_goal*100) : 0,
      prod_per_patient: p.pts_seen>0 ? Math.round(p.total_production/p.pts_seen) : 0,
    })).sort((a,b)=>b.total_production-a.total_production)
  }

  // ── Office-level summary (always included — second most-asked) ──────────
  if (true) {
    const offMap = {}
    reps.forEach(r => {
      const o = r.office
      if (!offMap[o]) offMap[o] = {
        office:o, days:0, production:0, goal:0, collections:0,
        no_shows:0, cancelled:0, np_showed:0, np_on_sched:0,
        pts_on_sched:0, pts_showed:0, pts_confirmed:0
      }
      offMap[o].days++
      offMap[o].production      += repProd(r)
      offMap[o].goal            += repGoal(r, providers)
      offMap[o].collections     += repColl(r)
      offMap[o].no_shows        += N(r.sched?.noShows)
      offMap[o].cancelled       += N(r.sched?.cancelled)
      offMap[o].np_showed       += N(r.sched?.npShowed)
      offMap[o].np_on_sched     += N(r.sched?.npOnSched)
      offMap[o].pts_on_sched    += N(r.sched?.ptsOnSched)
      offMap[o].pts_showed      += N(r.sched?.ptsShowUp)
      offMap[o].pts_confirmed   += N(r.sched?.ptsConfirmed)
    })
    ctx.office_summary = Object.values(offMap).map(o => ({
      ...o,
      pct_of_goal:   o.goal>0 ? Math.round(o.production/o.goal*100) : 0,
      collection_rate: o.production>0 ? Math.round(o.collections/o.production*100) : 0,
      show_rate:     o.pts_on_sched>0 ? Math.round(o.pts_showed/o.pts_on_sched*100) : 0,
      np_show_rate:  o.np_on_sched>0  ? Math.round(o.np_showed/o.np_on_sched*100)  : 0,
      avg_daily_prod: o.days>0 ? Math.round(o.production/o.days) : 0,
    })).sort((a,b)=>b.production-a.production)
  }

  // ── Collections ────────────────────────────────────────────────────────
  if (lower.match(/collect|coll|insurance|non.ins|cash|revenue|money|paid|payment|ar |outstanding/)) {
    const months_list = [...new Set(reps.map(r=>r.date.slice(0,7)))].sort()
    ctx.collections_by_month = months_list.map(m => {
      const mr = reps.filter(r=>r.date.startsWith(m))
      const prod = mr.reduce((s,r)=>s+repProd(r),0)
      const coll = mr.reduce((s,r)=>s+repColl(r),0)
      return {
        month:m, production:Math.round(prod), collections:Math.round(coll),
        collection_rate: prod>0 ? Math.round(coll/prod*100) : 0,
        non_insurance:   Math.round(mr.reduce((s,r)=>s+N(r.coll?.nonIns),0)),
        insurance:       Math.round(mr.reduce((s,r)=>s+N(r.coll?.ins),0)),
      }
    })
  }

  // ── Scheduling / show rate / no shows ─────────────────────────────────
  if (lower.match(/show|no.show|cancel|confirm|sched|schedule|np|new patient|fill|empty|gap|leak|book|appoint|capacity/)) {
    const months_list = [...new Set(reps.map(r=>r.date.slice(0,7)))].sort()
    ctx.scheduling_by_month = months_list.map(m => {
      const mr = reps.filter(r=>r.date.startsWith(m))
      const s = (f,k) => mr.reduce((a,r)=>a+N(r.sched?.[k]),0)
      const ptsOn = s(mr,'ptsOnSched'), ptsShow = s(mr,'ptsShowUp')
      const npOn  = s(mr,'npOnSched'),  npShow   = s(mr,'npShowed')
      return {
        month:m,
        pts_on_sched:   ptsOn,    pts_showed: ptsShow,
        show_rate:      ptsOn>0 ? Math.round(ptsShow/ptsOn*100) : null,
        no_shows:       s(mr,'noShows'),
        cancelled:      s(mr,'cancelled'),
        np_on_sched:    npOn,     np_showed: npShow,
        np_show_rate:   npOn>0  ? Math.round(npShow/npOn*100)   : null,
        np_calls:       s(mr,'npCalls'), np_calls_sched: s(mr,'npCallsSched'),
        prebooked:      s(mr,'ptsPrebooked'), comp_exams: s(mr,'compExamsSeen'),
      }
    })
  }

  // ── Front desk / staff ────────────────────────────────────────────────
  if (lower.match(/staff|front desk|fd |phone|answer|call|recall|tx accept|treatment accept|case accept|present|close/)) {
    const staffMap = {}
    reps.forEach(r => Object.entries(r.fd||{}).forEach(([name, fd]) => {
      if (!staffMap[name]) staffMap[name] = {
        name, np_calls:0, np_calls_sched:0, recalls:0, recalls_sched:0,
        np_tx_pres:0, np_tx_acc:0, ex_tx_pres:0, ex_tx_acc:0, days:0
      }
      staffMap[name].np_calls       += N(fd.calls)
      staffMap[name].np_calls_sched += N(fd.callsSched)
      staffMap[name].recalls        += N(fd.recalls)
      staffMap[name].recalls_sched  += N(fd.recallsSched)
      staffMap[name].np_tx_pres     += N(fd.npTxPres)
      staffMap[name].np_tx_acc      += N(fd.npTxAcc)
      staffMap[name].ex_tx_pres     += N(fd.exTxPres)
      staffMap[name].ex_tx_acc      += N(fd.exTxAcc)
      if (N(fd.calls)>0 || N(fd.recalls)>0) staffMap[name].days++
    }))
    ctx.front_desk_staff = Object.values(staffMap).filter(s=>s.np_calls+s.recalls>0).map(s => ({
      ...s,
      np_conversion:  s.np_calls>0    ? Math.round(s.np_calls_sched/s.np_calls*100)    : null,
      recall_conv:    s.recalls>0      ? Math.round(s.recalls_sched/s.recalls*100)       : null,
      np_tx_rate:     s.np_tx_pres>0  ? Math.round(s.np_tx_acc/s.np_tx_pres*100)       : null,
      ex_tx_rate:     s.ex_tx_pres>0  ? Math.round(s.ex_tx_acc/s.ex_tx_pres*100)       : null,
    })).sort((a,b)=>(b.np_calls+b.recalls)-(a.np_calls+a.recalls))
  }

  // ── TC / treatment coordinator patients ───────────────────────────────
  if (lower.match(/\btc\b|treatment coord|finance|stall|big case|unscheduled|no appt|conversion|follow.?up|treatment plan|case value/)) {
    let pts = tcPatients || []
    if (months.length) pts = pts.filter(p => months.some(m=>(p.month_tab||p.dos?.slice(0,7)||'').startsWith(m)))
    if (offices) pts = pts.filter(p => offices.includes(p.office?.toLowerCase()))
    const tcMap = {}
    pts.forEach(p => {
      const tc = p.who_tx_plan || p.assigned_tc_name || 'Unassigned'
      if (!tcMap[tc]) tcMap[tc] = {
        name:tc, patients:0, tx_value:0, finance_stalled:0,
        no_appt:0, has_appt:0, big_cases:0, tx_completed:0,
        total_calls:0
      }
      tcMap[tc].patients++
      tcMap[tc].tx_value      += N(p.total_tx_cost)
      tcMap[tc].tx_completed  += N(p.tx_completed)
      tcMap[tc].finance_stalled += p.finance_stalled ? 1 : 0
      tcMap[tc].big_cases     += N(p.total_tx_cost)>=3000 ? 1 : 0
      tcMap[tc].no_appt       += (!p.has_appt||p.has_appt==='No') ? 1 : 0
      tcMap[tc].has_appt      += p.has_appt==='Yes' ? 1 : 0
      tcMap[tc].total_calls   += [p.call_1_date,p.call_2_date,p.call_3_date].filter(Boolean).length
    })
    ctx.tc_performance = Object.values(tcMap).filter(t=>t.patients>0).map(t => ({
      ...t,
      conversion_rate:  t.patients>0 ? Math.round(t.has_appt/t.patients*100) : null,
      avg_tx_value:     t.patients>0 ? Math.round(t.tx_value/t.patients)     : null,
      produced_rate:    t.tx_value>0  ? Math.round(t.tx_completed/t.tx_value*100) : null,
    })).sort((a,b)=>b.patients-a.patients)
  }

  // ── Hygiene ────────────────────────────────────────────────────────────
  if (lower.match(/hygien|hyg|rdh|cleaning|perio|recare/)) {
    const hygMap = {}
    reps.forEach(r => (r.hygiene||[]).forEach(h => {
      if (!h.name?.trim()) return
      const k = h.name.trim()
      if (!hygMap[k]) hygMap[k] = { name:k, production:0, days:0, pts_seen:0 }
      const prod = N(h.netProd)
      if (prod>0 || N(h.ptsSeen)>0) {
        hygMap[k].production += prod
        hygMap[k].days       += 1
        hygMap[k].pts_seen   += N(h.ptsSeen)
      }
    }))
    ctx.hygiene_production = Object.values(hygMap).map(h => ({
      ...h,
      avg_per_day:    h.days>0 ? Math.round(h.production/h.days) : 0,
      pct_of_goal:    h.days>0 ? Math.round(h.production/(h.days*1200)*100) : 0,
      goal_per_day:   1200,
    })).sort((a,b)=>b.production-a.production)
  }

  return ctx
}

// ── Suggested questions ────────────────────────────────────────────────────
const SUGGESTIONS = [
  'Rank all doctors by production per patient seen in March',
  'Which office has the worst show rate this quarter?',
  'Compare NP call conversion by front desk staff this month',
  'Who are the top 3 TCs by conversion rate?',
  'Which doctor has the biggest gap between scheduled and actual production?',
  'Rank offices by collection rate for the last 30 days',
  'Show me hygiene production vs $1,200 goal by provider',
  'Which office had the most no-shows last month?',
  'Compare production this month vs last month by office',
  'Which TC has the most finance-stalled cases?',
]

// ── Main component ─────────────────────────────────────────────────────────
// State (history, loading) lives in App.jsx so queries survive navigation.
export default function AskAnalytics({ reports, providers, tcPatients, history, loading, onAsk, onClear }) {
  const [question, setQuestion] = useState('')
  const bottomRef = useRef()
  const inputRef  = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' })
  }, [history, loading])

  const ask = (q) => {
    const text = (q || question).trim()
    if (!text || loading) return
    setQuestion('')
    onAsk(text)
  }

  const handleKey = e => { if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); ask() } }

  return (
    <div style={{maxWidth:900, margin:'0 auto'}}>

      {/* Header */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:16, fontWeight:800, color:'#1e293b', marginBottom:4}}>
          🤖 Ask Analytics
        </div>
        <div style={{fontSize:12, color:'#94a3b8'}}>
          Ask plain-English questions about your practice data. Pulls only from this portal.
          {loading && <span style={{color:'#1d4ed8', fontWeight:700}}> · Running a query — you can navigate away, it'll finish in the background.</span>}
        </div>
      </div>

      {/* Chat history */}
      {history.length > 0 && (
        <div style={{marginBottom:20}}>
          {history.map(e => (
            <div key={e.id} style={{marginBottom:16}}>
              {/* Question bubble */}
              <div style={{display:'flex', justifyContent:'flex-end', marginBottom:8}}>
                <div style={{maxWidth:'80%', background:'#1e3a5f', color:'white',
                  borderRadius:'12px 12px 4px 12px', padding:'10px 14px', fontSize:13, fontWeight:600}}>
                  {e.question}
                </div>
              </div>
              {/* Answer bubble */}
              <div style={{display:'flex', justifyContent:'flex-start'}}>
                <div style={{maxWidth:'92%', background:'white', border:'1px solid #e2e8f0',
                  borderRadius:'4px 12px 12px 12px', padding:'14px 16px', fontSize:13,
                  color: e.error ? '#dc2626' : '#1e293b', lineHeight:1.6,
                  boxShadow:'0 1px 4px rgba(0,0,0,.05)'}}>
                  {e.answer == null && !e.error ? (
                    <div style={{display:'flex', gap:6, alignItems:'center', color:'#94a3b8'}}>
                      <div style={{width:6,height:6,borderRadius:'50%',background:'#94a3b8',
                        animation:'pulse 1s infinite'}}/>
                      Analyzing your data...
                    </div>
                  ) : e.error ? (
                    <span>⚠ {e.error}</span>
                  ) : (
                    <div style={{whiteSpace:'pre-wrap'}}>{e.answer}</div>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef}/>
        </div>
      )}

      {/* Empty state with suggestions */}
      {history.length === 0 && (
        <div style={{marginBottom:20}}>
          <div style={{fontSize:11, fontWeight:800, color:'#94a3b8', letterSpacing:.5, marginBottom:10}}>
            SUGGESTED QUESTIONS
          </div>
          <div style={{display:'flex', flexWrap:'wrap', gap:7}}>
            {SUGGESTIONS.map((s,i) => (
              <button key={i} onClick={()=>ask(s)}
                style={{padding:'7px 13px', borderRadius:99, fontSize:11, fontWeight:600,
                  background:'white', border:'1px solid #e2e8f0', color:'#475569',
                  cursor:'pointer', textAlign:'left'}}>
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input box */}
      <div style={{background:'white', borderRadius:14, border:'1px solid #e2e8f0',
        boxShadow:'0 2px 12px rgba(0,0,0,.06)', overflow:'hidden'}}>
        <textarea
          ref={inputRef}
          value={question}
          onChange={e=>setQuestion(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Ask anything about your practice data... e.g. 'Rank all doctors by production per patient in March'"
          rows={3}
          style={{width:'100%', padding:'14px 16px', border:'none', outline:'none',
            fontSize:13, color:'#1e293b', resize:'none', boxSizing:'border-box',
            fontFamily:'inherit', lineHeight:1.5}}/>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center',
          padding:'10px 14px', borderTop:'1px solid #f1f5f9', background:'#fafafa'}}>
          <div style={{fontSize:11, color:'#94a3b8'}}>
            {reports.length} reports · {providers.length} providers · {(tcPatients||[]).length} TC patients loaded
            {history.length > 0 && (
              <button onClick={onClear}
                style={{marginLeft:12, color:'#94a3b8', background:'none', border:'none',
                  fontSize:11, cursor:'pointer', textDecoration:'underline'}}>
                Clear history
              </button>
            )}
          </div>
          <button onClick={()=>ask()}
            disabled={loading || !question.trim()}
            style={{padding:'8px 20px', borderRadius:9, background: loading||!question.trim() ? '#cbd5e1' : '#1e3a5f',
              color:'white', border:'none', fontWeight:800, fontSize:13,
              cursor: loading||!question.trim() ? 'not-allowed' : 'pointer',
              transition:'background .15s'}}>
            {loading ? 'Analyzing...' : 'Analyze ↵'}
          </button>
        </div>
      </div>

      {/* Quick follow-up pills after first answer */}
      {history.length > 0 && !loading && (
        <div style={{marginTop:12, display:'flex', flexWrap:'wrap', gap:6}}>
          {[
            'Break that down by office',
            'Who is the outlier and why might that be?',
            'What should management focus on first?',
            'Show me the trend over the last 3 months',
            'Compare to the prior period',
          ].map((s,i) => (
            <button key={i} onClick={()=>ask(s)}
              style={{padding:'5px 12px', borderRadius:99, fontSize:11, fontWeight:600,
                background:'white', border:'1px solid #e2e8f0', color:'#64748b', cursor:'pointer'}}>
              {s}
            </button>
          ))}
        </div>
      )}

      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  )
}
