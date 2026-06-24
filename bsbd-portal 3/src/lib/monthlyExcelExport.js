// ════════════════════════════════════════════════════════════════════════════
// BSBD Monthly Excel Export
// Matches BSBD_PRODUCTION_PERFOMANCE_AND_KPIs template exactly
// One sheet per office + MTD summary tab
// ════════════════════════════════════════════════════════════════════════════
import { N } from './helpers'

const OFFICES   = ['Brainerd','Calhoun','Dalton','McCallie']
const MONTHS_EN = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE',
                   'JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtMonth(m) {
  const [y, mo] = m.split('-')
  return MONTHS_EN[parseInt(mo)-1] + ' ' + y
}

function getWeeksInMonth(month) {
  const [y, mo] = month.split('-').map(Number)
  const totalDays = new Date(y, mo, 0).getDate()
  const weeks = []
  let start = 1, wn = 1
  while (start <= totalDays) {
    const end = Math.min(start + 6, totalDays)
    const dates = {}
    for (let d = start; d <= end; d++) {
      const ds  = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
      const dow = new Date(ds + 'T12:00:00').getDay() // 0=Sun
      if (dow >= 1 && dow <= 6) dates[dow] = ds        // 1=Mon..6=Sat
    }
    weeks.push({ wn, start, end, dates })
    start += 7; wn++
  }
  return weeks
}

function getRep(reports, office, date) {
  return reports.find(r => r.office === office && r.date === date) || null
}

function fdTot(rep, field) {
  if (!rep) return 0
  if (rep.fd_totals) return N(rep.fd_totals[field])
  return Object.values(rep.fd||{}).reduce((s,f) => s + N(f[field]), 0)
}

// ── SheetJS cell builders ──────────────────────────────────────────────────
const cv  = v   => typeof v === 'number' ? {t:'n',v} : {t:'s',v:String(v||'')}
const cf  = f   => ({t:'n', f})           // formula (no = prefix in SheetJS)
const cp  = f   => ({t:'n', f, z:'0.0%'}) // percentage formula
const cm  = f   => ({t:'n', f, z:'$#,##0'}) // currency formula

// ── Build one office sheet ─────────────────────────────────────────────────
function buildOfficeSheet(XLSX, office, reports, providers, users, weeks, monthLabel) {
  providers = providers || []
  users = users || []

  // Providers to show: anyone assigned to this office PLUS anyone who actually
  // appears in this office's reports (covers floating/associate doctors whose
  // assigned office differs from where they worked).
  const offReports = reports.filter(r => r.office === office)
  const appearingIds = new Set()
  offReports.forEach(r => (r.providers||[]).forEach(p => { if (p.doctorId) appearingIds.add(p.doctorId) }))
  const offProvs = providers.filter(p => p.office === office || appearingIds.has(p.id))
  const offStaff  = users.filter(u => u.office === office &&
    ['front_desk','treatment_coordinator'].includes(u.role))

  // Collect hygienist names from all reports for this office
  const hygNames = [...new Set(
    reports.filter(r => r.office === office)
           .flatMap(r => (r.hygiene||[]).map(h => h.name?.trim()).filter(Boolean))
  )]

  const ws   = {}
  let   row  = 0  // 0-indexed
  const enc  = (r,c) => XLSX.utils.encode_cell({r,c})
  function set(r, c, cell) {
    ws[enc(r,c)] = cell
  }
  function setv(r, c, v) { set(r, c, cv(v)) }
  function setf(r, c, f) { set(r, c, cf(f)) }
  function setp(r, c, f) { set(r, c, cp(f)) }

  // File header
  row++
  setv(row++, 0, `WEEKLY PRODUCTION & KPIs SHEET`)

  for (const { wn, start, dates } of weeks) {
    // ── Week header ──────────────────────────────────────────────────────
    setv(row++, 0, `WEEK ${wn} (${start})${monthLabel}`)
    setv(row,   0, 'OFFICE KPIs')
    row++
    // Day headers
    ;['','MON','TUE','WED','THUR','FRI','SAT','WKLY TOTAL']
     .forEach((h,c) => setv(row, c, h))
    row++

    // Lookup daily reports: dow 1-6 → report
    const d = {}
    for (const [dow, date] of Object.entries(dates)) d[dow] = getRep(reports, office, date)

    function dayVal(dow, fn) { const r = d[dow]; return r ? (fn(r)||0) : 0 }

    // ── OFFICE KPIs block ─────────────────────────────────────────────────
    const goalR = row
    setv(row, 0, 'OFFICE GOALS (KPIs)')
    for (let c = 1; c <= 6; c++) {
      const r = d[c]
      let g = 0
      if (r) {
        g = (r.providers||[]).reduce((s,p) => {
              if (!p.doctorId) return s
              const pv = offProvs.find(x => x.id === p.doctorId)
              return s + (pv ? N(pv.goal) : 0)
            }, 0)
          + (r.hygiene||[]).filter(h => h.name?.trim()).length * 1200
      }
      set(row, c, {t:'n', v:g, z:'$#,##0'})
    }
    setf(row, 7, `SUM(B${row+1}:G${row+1})`); row++

    const schedR = row
    setv(row, 0, 'Schedule Production Value')
    for (let c = 1; c <= 6; c++) {
      set(row, c, {t:'n', z:'$#,##0', v:
        dayVal(c, r =>
          (r.providers||[]).reduce((s,p) => s+N(p.openSchedule), 0) +
          (r.hygiene||[]).reduce((s,h) => s+N(h.openSchedule), 0)
        )
      })
    }
    setf(row, 7, `SUM(H${row+1}:... `); // placeholder, fixed below
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

    const varSchedR = row
    setv(row, 0, 'Variance(Scheduled Production-Goal)')
    for (let c = 1; c <= 6; c++)
      ws[enc(row,c)] = {t:'n', f:`${enc(schedR,c)}-${enc(goalR,c)}`, z:'$#,##0'}
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

    const actR = row
    setv(row, 0, 'Actual Production')
    for (let c = 1; c <= 6; c++) {
      set(row, c, {t:'n', z:'$#,##0', v:
        dayVal(c, r =>
          (r.providers||[]).reduce((s,p) => s+N(p.netProd), 0) +
          (r.hygiene||[]).reduce((s,h) => s+N(h.netProd), 0)
        )
      })
    }
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

    setv(row, 0, 'Variance(Actual Prd Vs Scheduled Prd)')
    for (let c = 1; c <= 6; c++)
      ws[enc(row,c)] = {t:'n', f:`${enc(actR,c)}-${enc(schedR,c)}`, z:'$#,##0'}
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

    setv(row, 0, 'Goal Variance(Actual Prd-Office Goal)')
    for (let c = 1; c <= 6; c++)
      ws[enc(row,c)] = {t:'n', f:`${enc(actR,c)}-${enc(goalR,c)}`, z:'$#,##0'}
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

    const ptsSchedR = row
    setv(row, 0, 'Number of patients on Schedule')
    for (let c = 1; c <= 6; c++)
      set(row, c, {t:'n', v: dayVal(c, r => N(r.sched?.ptsOnSched))})
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

    const ptsSeenR = row
    setv(row, 0, 'Number of patients seen by Provider')
    for (let c = 1; c <= 6; c++)
      set(row, c, {t:'n', v: dayVal(c, r => N(r.sched?.ptsShowUp))})
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, '# of NP Scheduled for Provider')
    for (let c = 1; c <= 6; c++)
      set(row, c, {t:'n', v: dayVal(c, r => N(r.sched?.npOnSched))})
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Number of New Patients Seen')
    for (let c = 1; c <= 6; c++)
      set(row, c, {t:'n', v: dayVal(c, r => N(r.sched?.npShowed))})
    ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Average production per patient')
    for (let c = 1; c <= 6; c++)
      ws[enc(row,c)] = {t:'n', f:`IF(${enc(ptsSeenR,c)}>0,${enc(actR,c)}/${enc(ptsSeenR,c)},0)`, z:'$#,##0'}
    ws[enc(row,7)] = {t:'n', f:`IF(${enc(ptsSeenR,7)}>0,${enc(actR,7)}/${enc(ptsSeenR,7)},0)`, z:'$#,##0'}; row++

    setv(row++, 0, 'PERCENTAGES(%)')

    setv(row, 0, 'Schedule/Office Goal')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n', f:`IF(${enc(goalR,c)}>0,${enc(actR,c)}/${enc(goalR,c)},0)`, z:'0.0%'}; row++

    setv(row, 0, 'Actual Production /Scheduled Prd')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n', f:`IF(${enc(schedR,c)}>0,${enc(actR,c)}/${enc(schedR,c)},0)`, z:'0.0%'}; row++

    setv(row, 0, 'Actual Production/Office Goal(KPI>85%)')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n', f:`IF(${enc(goalR,c)}>0,${enc(actR,c)}/${enc(goalR,c)},0)`, z:'0.0%'}; row++

    row++
    setv(row++, 0, 'DOCTORS')

    // ── Per-provider blocks ───────────────────────────────────────────────
    for (const pv of offProvs) {
      const pvGoalR = row
      setv(row, 0, `${pv.name} - Daily goal-KPI $${N(pv.goal).toLocaleString()}`)
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: rp ? N(pv.goal) : 0, z:'$#,##0'})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

      const pvSchedR = row
      setv(row, 0, 'Schedule Production Value-Opening Schedule')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: N(rp?.openSchedule), z:'$#,##0'})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

      setv(row, 0, 'Variance(Scheduled Production - Goal)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`${enc(pvSchedR,c)}-${enc(pvGoalR,c)}`, z:'$#,##0'}; row++

      const pvActR = row
      setv(row, 0, 'Actual Production')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: N(rp?.netProd), z:'$#,##0'})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

      setv(row, 0, 'Variance(Actual Prd Vs Scheduled Prd)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`${enc(pvActR,c)}-${enc(pvSchedR,c)}`, z:'$#,##0'}; row++

      setv(row, 0, 'Goal Variance(Actual Prd-Office Goal)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`${enc(pvActR,c)}-${enc(pvGoalR,c)}`, z:'$#,##0'}; row++

      const pvPtsSchedR = row
      setv(row, 0, 'Number of patients on Schedule')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: N(rp?.ptsSeen)})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

      const pvPtsSeenR = row
      setv(row, 0, 'Number of patients seen by Provider')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: N(rp?.ptsSeen)})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

      setv(row, 0, '# of NP Scheduled for Provider')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: N(rp?.npSched)})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

      setv(row, 0, 'Number of New Patients Seen')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rp = r?.providers?.find(p => p.doctorId === pv.id)
        set(row, c, {t:'n', v: N(rp?.npSeen)})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

      setv(row, 0, 'Average production per patient')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(pvPtsSeenR,c)}>0,${enc(pvActR,c)}/${enc(pvPtsSeenR,c)},0)`, z:'$#,##0'}; row++

      setv(row++, 0, 'PERCENTAGES(%)')
      setv(row, 0, 'Schedule/Office Goal')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(pvGoalR,c)}>0,${enc(pvActR,c)}/${enc(pvGoalR,c)},0)`, z:'0.0%'}; row++
      setv(row, 0, 'Actual Production /Scheduled Prd')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(pvSchedR,c)}>0,${enc(pvActR,c)}/${enc(pvSchedR,c)},0)`, z:'0.0%'}; row++
      setv(row, 0, 'Actual Production/Office Goal(KPI>85%)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(pvGoalR,c)}>0,${enc(pvActR,c)}/${enc(pvGoalR,c)},0)`, z:'0.0%'}; row++

      row++ // blank between providers
    }

    // ── Hygiene blocks ────────────────────────────────────────────────────
    row++
    setv(row++, 0, 'THE HYGIENE DEPARTMENT')

    for (const hygName of hygNames) {
      const hGoalR = row
      setv(row, 0, `${hygName} - Daily Goal $1,200`)
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rh = r?.hygiene?.find(h => h.name?.trim() === hygName)
        set(row, c, {t:'n', v: rh ? 1200 : 0, z:'$#,##0'})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

      const hSchedR = row
      setv(row, 0, 'Schedule Production Value-Opening Schedule')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rh = r?.hygiene?.find(h => h.name?.trim() === hygName)
        set(row, c, {t:'n', v: N(rh?.openSchedule), z:'$#,##0'})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

      setv(row, 0, 'Variance(Scheduled Production - Goal)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`${enc(hSchedR,c)}-${enc(hGoalR,c)}`, z:'$#,##0'}; row++

      const hActR = row
      setv(row, 0, 'Actual Production')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rh = r?.hygiene?.find(h => h.name?.trim() === hygName)
        set(row, c, {t:'n', v: N(rh?.netProd), z:'$#,##0'})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`, z:'$#,##0'}; row++

      setv(row, 0, 'Variance(Actual Prd Vs Scheduled Prd)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`${enc(hActR,c)}-${enc(hSchedR,c)}`, z:'$#,##0'}; row++

      setv(row, 0, 'Goal Variance(Actual Prd-Goal)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`${enc(hActR,c)}-${enc(hGoalR,c)}`, z:'$#,##0'}; row++

      const hPtsR = row
      setv(row, 0, 'Number of patients on Schedule')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rh = r?.hygiene?.find(h => h.name?.trim() === hygName)
        set(row, c, {t:'n', v: N(rh?.ptsSeen)})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

      const hPtsSeenR = row
      setv(row, 0, 'Number of patients seen by Provider')
      for (let c = 1; c <= 6; c++) {
        const r = d[c]; const rh = r?.hygiene?.find(h => h.name?.trim() === hygName)
        set(row, c, {t:'n', v: N(rh?.ptsSeen)})
      }
      ws[enc(row,7)] = {t:'n', f:`SUM(B${row+1}:G${row+1})`}; row++

      setv(row, 0, '# of NP Scheduled for Provider'); for(let c=1;c<=6;c++) set(row,c,{t:'n',v:0})
      ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++
      setv(row, 0, 'Number of New Patients Seen'); for(let c=1;c<=6;c++) set(row,c,{t:'n',v:0})
      ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

      setv(row, 0, 'Average production per patient')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(hPtsSeenR,c)}>0,${enc(hActR,c)}/${enc(hPtsSeenR,c)},0)`, z:'$#,##0'}; row++

      setv(row++, 0, 'PERCENTAGES(%)')
      setv(row, 0, 'Schedule/Office Goal')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(hGoalR,c)}>0,${enc(hSchedR,c)}/${enc(hGoalR,c)},0)`, z:'0.0%'}; row++
      setv(row, 0, 'Actual Production /Scheduled Prd')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(hSchedR,c)}>0,${enc(hActR,c)}/${enc(hSchedR,c)},0)`, z:'0.0%'}; row++
      setv(row, 0, 'Actual Production/Office Goal(KPI>85%)')
      for (let c = 1; c <= 7; c++)
        ws[enc(row,c)] = {t:'n', f:`IF(${enc(hGoalR,c)}>0,${enc(hActR,c)}/${enc(hGoalR,c)},0)`, z:'0.0%'}; row++
      row++
    }

    // ── Front Office KPIs ─────────────────────────────────────────────────
    row++
    setv(row++, 0, 'FRONT OFFICE KPIs- OFFICE')
    ;['','MON','TUE','WED','THUR','FRI','SAT','WKLY TOTAL'].forEach((h,c) => setv(row,c,h)); row++

    const foSchedR = row
    setv(row, 0, 'Number of patients on Schedule')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.ptsOnSched))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const foSeenR = row
    setv(row, 0, 'Actual Patient Seen')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.ptsShowUp))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Number of Cancelled appointments')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.cancelled))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, '#of Same Day treatment Pts')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.sameDayExt)+N(r.sched?.sameDayNP))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Show Rate-kpi 90%')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`IF(${enc(foSchedR,c)}>0,${enc(foSeenR,c)}/${enc(foSchedR,c)},0)`,z:'0.0%'}; row++

    row++
    const npCallsR = row
    setv(row, 0, 'Number of New Patients Phn Calls Made')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'calls'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const npCallsSchedR = row
    setv(row, 0, 'Number New Patients 1st calls Scheduled')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'callsSched'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Phone Call Conversion Rate %- kpi >50%')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`IF(${enc(npCallsR,c)}>0,${enc(npCallsSchedR,c)}/${enc(npCallsR,c)},0)`,z:'0.0%'}; row++

    row++
    const npSchedGoalR = row
    setv(row, 0, 'Number of NP on Scheduled-KPI(4 per doctor per day)')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.npOnSched))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const npAchievedR = row
    setv(row, 0, 'Achieved')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.npShowed))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Variance')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`${enc(npAchievedR,c)}-${enc(npSchedGoalR,c)}`}; row++

    row++
    setv(row++, 0, 'NP who managed to fulfil their Treatment Plan')

    const npFulfilR = row
    setv(row, 0, 'Achieved')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'npTxAcc'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Variance')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`${enc(npFulfilR,c)}-${enc(npAchievedR,c)}`}; row++

    row++
    const recallMinR = row
    setv(row, 0, 'Minimum Scheduled Recalls per day')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'recalls'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Recalls done')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'recalls'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const recallAchR = row
    setv(row, 0, 'Achieved')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'recallsSched'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Variance')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`${enc(recallAchR,c)}-${enc(recallMinR,c)}`}; row++

    row++
    const predGenR = row
    setv(row, 0, '# of PreDs Generated From Previous Visits')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.predGenerated))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const predSendR = row
    setv(row, 0, '# Number PreDs Send')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>N(r.sched?.predSubmitted))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'PreD submission RATE-KPI-100%')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`IF(${enc(predGenR,c)}>0,${enc(predSendR,c)}/${enc(predGenR,c)},0)`,z:'0.0%'}; row++

    row++
    setv(row, 0, 'Treatment Plans Presented- NP')
    ;['','Mon','Tue','Wed','Thur','Fri','Sat','Wkly Total'].forEach((h,c)=>setv(row,c,h)); row++

    const txNpPresR = row
    setv(row, 0, '# Of Treatment Plans Presented')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'npTxPres'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const txNpAccR = row
    setv(row, 0, '#Of Treatment Plans Accepted')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'npTxAcc'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Case Acceptance Rate')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`IF(${enc(txNpPresR,c)}>0,${enc(txNpAccR,c)}/${enc(txNpPresR,c)},0)`,z:'0.0%'}; row++

    row++
    setv(row, 0, 'Treatment Plans Presented-Existing Pts')
    ;['','Mon','Tue','Wed','Thur','Fri','Sat','Wkly Total'].forEach((h,c)=>setv(row,c,h)); row++

    const txExPresR = row
    setv(row, 0, '# Of Treatment Plans Presented')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'exTxPres'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    const txExAccR = row
    setv(row, 0, '#Of Treatment Plans Accepted')
    for (let c = 1; c <= 6; c++) set(row,c,{t:'n',v:dayVal(c,r=>fdTot(r,'exTxAcc'))})
    ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++

    setv(row, 0, 'Case Acceptance Rate')
    for (let c = 1; c <= 7; c++)
      ws[enc(row,c)] = {t:'n',f:`IF(${enc(txExPresR,c)}>0,${enc(txExAccR,c)}/${enc(txExPresR,c)},0)`,z:'0.0%'}; row++

    // ── Individual KPIs per staff member ──────────────────────────────────
    if (offStaff.length) {
      row++
      setv(row++, 0, 'INDIVIDUAL KPIs')

      const buildStaffBlock = (title, valueFn) => {
        setv(row, 0, title)
        ;['','MON','TUE','WED','THUR','FRI','SAT','WKLY TOTAL'].forEach((h,c)=>setv(row,c,h)); row++
        const startR = row
        for (const u of offStaff) {
          const name = u.name || u.staffName || u.username
          setv(row, 0, name)
          for (let c = 1; c <= 6; c++) {
            const r = d[c]
            set(row, c, {t:'n', v: r ? N(valueFn(r, name)) : 0})
          }
          ws[enc(row,7)] = {t:'n',f:`SUM(B${row+1}:G${row+1})`}; row++
        }
        ws[enc(row,7)] = {t:'n',f:`SUM(H${startR+1}:H${row})`}; row++
        row++
      }

      buildStaffBlock('NP appt fulfilled -Rewards',
        (r,name) => N(r.fd?.[name]?.npTxAcc))
      buildStaffBlock('Daily Recalls Scheduled- Rewards',
        (r,name) => N(r.fd?.[name]?.recallsSched))
      buildStaffBlock('Pts scheduled from PreDs Approved',
        () => 0)
      buildStaffBlock('Treatment Plans scheduled-NP',
        (r,name) => N(r.fd?.[name]?.npTxPres))
      buildStaffBlock('Treatment Plans scheduled-Existing Pts',
        (r,name) => N(r.fd?.[name]?.exTxPres))
    }

    row += 4 // gap between weeks
  }

  // Sheet metadata
  ws['!ref']  = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:row,c:7}})
  ws['!cols'] = [{wch:42},{wch:13},{wch:13},{wch:13},{wch:13},{wch:13},{wch:13},{wch:15}]
  return ws
}

// ── Build MTD Summary sheet ────────────────────────────────────────────────
function buildMTDSheet(XLSX, reports, providers, users, weeks, month, monthLabel) {
  providers = providers || []
  users = users || []
  const ws  = {}
  let row   = 0
  const enc = (r,c) => XLSX.utils.encode_cell({r,c})

  setv(row++, 0, `${monthLabel} PERFORMANCE + KPIs`)

  // Header row: office names spanning Week1..Week5..MTD groups
  // Col layout: A=metric, then for each office: Wk1,Wk2,Wk3,Wk4,Wk5,MTD (6 cols) + blank
  const offStartCols = [1, 8, 15, 22] // start col for Brainerd,Calhoun,Dalton,McCallie

  function setv(r,c,v) { ws[enc(r,c)] = typeof v==='number' ? {t:'n',v} : {t:'s',v:String(v||'')} }

  setv(0, 0, `${monthLabel} PERFORMANCE + KPIs`)
  row = 1
  setv(row, 0, 'WEEKS')
  OFFICES.forEach((o,oi) => { setv(row, offStartCols[oi], `${o.toUpperCase()} OFFICE MTD- ${monthLabel}`) })
  row++

  setv(row, 0, '')
  OFFICES.forEach((o,oi) => {
    weeks.forEach((w,wi) => setv(row, offStartCols[oi]+wi, `WEEK ${w.wn}`))
    setv(row, offStartCols[oi]+5, 'MTD')
  })
  row++

  const metrics = [
    { label:'PRODUCTION', sub:null },
    { label:'OFFICE GOAL', fn: (reps,o) => reps.reduce((s,r) => {
        const pvs = providers.filter(p => p.office === o)
        return s + (r.providers||[]).reduce((ss,p) => {
          if(!p.doctorId) return ss
          const pv = pvs.find(x=>x.id===p.doctorId); return ss+(pv?N(pv.goal):0)
        },0) + (r.hygiene||[]).filter(h=>h.name?.trim()).length*1200
      }, 0)
    },
    { label:'SCHEDULE', fn: (reps) => reps.reduce((s,r) =>
        s + (r.providers||[]).reduce((ss,p)=>ss+N(p.openSchedule),0)
          + (r.hygiene||[]).reduce((ss,h)=>ss+N(h.openSchedule),0), 0) },
    { label:'ACTUAL PRODUCTION', fn: (reps) => reps.reduce((s,r) =>
        s + (r.providers||[]).reduce((ss,p)=>ss+N(p.netProd),0)
          + (r.hygiene||[]).reduce((ss,h)=>ss+N(h.netProd),0), 0) },
    { label:'COLLECTIONS', fn: (reps) => reps.reduce((s,r) => s+N(r.coll?.ins)+N(r.coll?.nonIns), 0) },
    { label:'PATIENTS ON SCHEDULE', fn: (reps) => reps.reduce((s,r) => s+N(r.sched?.ptsOnSched), 0) },
    { label:'PATIENTS SEEN', fn: (reps) => reps.reduce((s,r) => s+N(r.sched?.ptsShowUp), 0) },
    { label:'NP SCHEDULED', fn: (reps) => reps.reduce((s,r) => s+N(r.sched?.npOnSched), 0) },
    { label:'NP SEEN', fn: (reps) => reps.reduce((s,r) => s+N(r.sched?.npShowed), 0) },
    { label:'NP CALLS', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'calls'), 0) },
    { label:'NP CALLS SCHEDULED', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'callsSched'), 0) },
    { label:'RECALLS DONE', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'recalls'), 0) },
    { label:'RECALLS SCHEDULED', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'recallsSched'), 0) },
    { label:'PRE-Ds GENERATED', fn: (reps) => reps.reduce((s,r) => s+N(r.sched?.predGenerated), 0) },
    { label:'PRE-Ds SUBMITTED', fn: (reps) => reps.reduce((s,r) => s+N(r.sched?.predSubmitted), 0) },
    { label:'TX PLANS PRESENTED NP', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'npTxPres'), 0) },
    { label:'TX PLANS ACCEPTED NP', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'npTxAcc'), 0) },
    { label:'TX PLANS PRESENTED EXT', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'exTxPres'), 0) },
    { label:'TX PLANS ACCEPTED EXT', fn: (reps) => reps.reduce((s,r) => s+fdTot(r,'exTxAcc'), 0) },
  ]

  for (const m of metrics) {
    if (!m.fn) { row++; continue }
    setv(row, 0, m.label)
    OFFICES.forEach((o, oi) => {
      const offReps = reports.filter(r => r.office === o)
      let mtdVal = 0
      weeks.forEach((w,wi) => {
        // Get reports for this week's dates
        const weekDates = Object.values(w.dates)
        const weekReps  = offReps.filter(r => weekDates.includes(r.date))
        const wv = m.fn(weekReps, o)
        ws[enc(row, offStartCols[oi]+wi)] = {t:'n', v:wv, z:'$#,##0'}
        mtdVal += wv
      })
      ws[enc(row, offStartCols[oi]+5)] = {t:'n', v:mtdVal, z:'$#,##0'}
    })
    row++
  }

  ws['!ref']  = XLSX.utils.encode_range({s:{r:0,c:0}, e:{r:row+5, c:28}})
  ws['!cols'] = [{wch:30}, ...Array(28).fill({wch:12})]
  return ws
}

// ── Main export ────────────────────────────────────────────────────────────
export async function exportMonthlyExcel(reports, providers, users, month) {
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
  const [y, mo] = month.split('-').map(Number)
  const monthLabel = MONTHS_EN[mo-1] + ' ' + y
  const weeks = getWeeksInMonth(month)

  const wb = XLSX.utils.book_new()

  // Office sheets
  for (const office of OFFICES) {
    const offReps = reports.filter(r => r.office === office)
    const ws = buildOfficeSheet(XLSX, office, offReps, providers, users, weeks, monthLabel)
    XLSX.utils.book_append_sheet(wb, ws, office.toUpperCase())
  }

  // MTD summary
  const mtdWs = buildMTDSheet(XLSX, reports, providers, users, weeks, month, monthLabel)
  XLSX.utils.book_append_sheet(wb, mtdWs, 'BSBD TOTAL MTD ' + MONTHS_EN[mo-1].slice(0,3) + ' ' + y)

  XLSX.writeFile(wb, `BSBD_KPIs_${monthLabel.replace(' ','_')}.xlsx`)
}
