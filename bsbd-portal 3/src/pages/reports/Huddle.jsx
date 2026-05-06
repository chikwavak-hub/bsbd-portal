import React, { useState, useEffect, useRef } from 'react'
import { IcoUpload, IcoRefresh, IcoCheck, IcoAlert, IcoChevD, IcoChevU, IcoPrint, IcoCalendar } from '../../components/icons'
import { LBL } from '../../components/ui'
import { N, USD, PCT, pctNum, todayStr, repProd, repColl, repGoal, workingDaysInMonth, workingDaysSoFar, getTcAlerts, matchCollectionPatients } from '../../lib/helpers'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'
import { OFFICES } from '../../lib/constants'
import { parseCollectionSheetFull } from '../collections/CollectionTracker'

function Sec({ title, emoji, children, defaultOpen = true, badge, badgeColor }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 14, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 18px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: open ? '1px solid #e2e8f0' : 'none' }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: '#1e293b', flex: 1, textAlign: 'left' }}>{title}</span>
        {badge != null && <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 99, background: badgeColor || '#f1f5f9', color: badgeColor ? 'white' : '#64748b' }}>{badge}</span>}
        {open ? <IcoChevU size={15} style={{ color: '#94a3b8' }} /> : <IcoChevD size={15} style={{ color: '#94a3b8' }} />}
      </button>
      {open && <div style={{ padding: '16px 18px' }}>{children}</div>}
    </div>
  )
}

function Alert({ level, icon, text }) {
  const c = level === 'red' ? { bg: '#fef2f2', border: '#fecaca', color: '#dc2626' } : { bg: '#fffbeb', border: '#fde68a', color: '#d97706' }
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderRadius: 9, background: c.bg, border: '1px solid ' + c.border, marginBottom: 8 }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: c.color, lineHeight: 1.4 }}>{text}</span>
    </div>
  )
}

function Stat({ label, value, sub, color }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || '#1e293b' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function OfficeHuddle({ office, reports, providers, tcPatients, onBack, notify, user }) {
  const today     = todayStr()
  const todayDt   = new Date(today + 'T12:00:00')
  const yr        = todayDt.getFullYear()
  const mo        = todayDt.getMonth() + 1
  const mStart    = yr + '-' + String(mo).padStart(2,'0') + '-01'
  const wdInMonth = workingDaysInMonth(yr, mo)
  const wdSoFar   = workingDaysSoFar(today)
  const wdLeft    = wdInMonth - wdSoFar

  const [collPatients, setCollPatients] = useState([])
  const [recallData,   setRecallData]   = useState(null)
  const [uploading,    setUploading]    = useState(false)
  const fileRef = useRef(null)

  useEffect(() => {
    sbGet('collection_patients', 'office=eq.' + encodeURIComponent(office) + '&date=eq.' + today + '&order=operatory,patient_name')
      .then(setCollPatients).catch(() => {})
    const month = today.slice(0,7)
    sbGet('recall_patients', 'office=eq.' + encodeURIComponent(office) + '&month=eq.' + month + '&select=status,call1_date,call2_date,call3_date,updated_at')
      .then(rows => {
        const total      = rows.length
        const scheduled  = rows.filter(r => r.status === 'scheduled').length
        const inactive   = rows.filter(r => r.status === 'inactive').length
        const pending    = rows.filter(r => r.status === 'pending').length
        const convRate   = total > 0 ? Math.round((scheduled / (total - inactive)) * 100) : 0
        setRecallData({ total, scheduled, pending, convRate })
      }).catch(() => {})
  }, [office, today])

  const handleUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      let parsed = [], label = file.name
      if (file.name.toLowerCase().endsWith('.pdf')) {
        const { extractCollectionSheetText, parseCollectionSheetPdf, detectOfficeFromFilename, detectOfficeFromText } = await import('../../lib/collectionSheetPdfParser')
        const text = await extractCollectionSheetText(file)
        const det  = detectOfficeFromFilename(file.name) || detectOfficeFromText(text)
        if (det && det !== office) {
          const ok = window.confirm('Office mismatch: PDF appears to be for "' + det + '" but uploading to "' + office + '".\n\nContinue anyway?')
          if (!ok) { setUploading(false); if (fileRef.current) fileRef.current.value = ''; return }
        }
        if (!det) notify('Could not detect office from PDF — verify correct file', 'error')
        const res = parseCollectionSheetPdf(text, file.name)
        parsed    = res.patients
        if (res.date && res.date !== date) notify('PDF date (' + res.date + ') differs from selected date (' + date + ')', 'error')
      } else {
        const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs')
        const wb   = XLSX.read(await file.arrayBuffer(), {type:'array'})
        const d    = new Date(date+'T12:00:00')
        const day  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()]
        const mon  = d.toLocaleString('en-US',{month:'long'})
        const sheet= wb.SheetNames.find(n=>n.includes(day)&&n.includes(mon)&&n.includes(String(d.getDate())))||wb.SheetNames[0]
        label      = sheet
        parsed     = parseCollectionSheetFull(XLSX.utils.sheet_to_json(wb.Sheets[sheet],{header:1,defval:null}))
      }
      if (!parsed.length) { notify('No patients found in "'+label+'"','error'); setUploading(false); return }
      const ex = await sbGet('collection_patients', 'office=eq.'+encodeURIComponent(office)+'&date=eq.'+date+'&select=id')
      for (const r of ex) await sbDel('collection_patients', 'id=eq.'+r.id)
      for (const p of parsed) await sbPost('collection_patients', {...p, office, date, created_at:new Date().toISOString(), updated_at:new Date().toISOString()}, true)
      const rows = await sbGet('collection_patients', 'office=eq.'+encodeURIComponent(office)+'&date=eq.'+today+'&order=operatory,patient_name'); setCollPatients(rows)
      notify('Loaded '+parsed.length+' patients from "'+label+'"')
    } catch(err) { notify('Upload failed: '+err.message,'error') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const offProviders  = providers.filter(p => p.office === office)
  const dailyGoal     = offProviders.reduce((s, p) => s + N(p.goal), 0)
  const offReports    = reports.filter(r => r.office === office)
  const offMtd        = offReports.filter(r => r.date >= mStart && r.date <= today)
  const mtdProd       = offMtd.reduce((s, r) => s + repProd(r), 0)
  const mtdColl       = offMtd.reduce((s, r) => s + repColl(r), 0)
  const mtdGoal       = dailyGoal * wdSoFar
  const projected     = wdSoFar > 0 ? (mtdProd / wdSoFar) * wdInMonth : 0
  const reqDaily      = wdLeft > 0 ? Math.max(0, (mtdGoal + (dailyGoal * wdLeft) - mtdProd) / wdLeft) : 0
  const onTrack       = mtdProd >= mtdGoal * 0.95
  const latest        = offReports.sort((a,b) => b.date.localeCompare(a.date))[0] || null
  const latestProd    = latest ? repProd(latest) : 0
  const latestGoal    = latest ? repGoal(latest, providers) : dailyGoal
  const latestColl    = latest ? repColl(latest) : 0

  const collWithDue   = collPatients.filter(p => p.total_expected > 0)
  const totalExpected = collWithDue.reduce((s, p) => s + p.total_expected, 0)
  const totalCollected= collPatients.reduce((s, p) => s + N(p.amount_collected), 0)
  const insCovers     = collPatients.filter(p => p.total_expected === 0).length
  const hasFlags      = collPatients.filter(p => (p.flags_total || 0) > (p.flags_done || 0)).length
  const hasIssues     = collPatients.filter(p => p.status === 'issue' || (p.ins_status || '').includes('INACTIVE')).length

  const tcMatches     = matchCollectionPatients(tcPatients, collPatients, { role: 'admin' }, true)
  const tcNoPayment   = tcMatches.filter(m => !m.collPatient?.amount_collected && m.totalExpected > 0)

  const actions = []
  if (latest) {
    const ns = N(latest.sched?.noShows), re = N(latest.sched?.rescheduled)
    if (ns > re) actions.push({ level: 'red', icon: 'X', text: (ns-re) + ' no-show' + (ns-re>1?'s':'') + ' from yesterday still need rescheduling' })
    if (latestProd < latestGoal * 0.9 && latest.date !== today)
      actions.push({ level: 'amber', icon: 'down', text: 'Yesterday hit ' + PCT(latestProd, latestGoal) + ' of goal — confirm today\'s schedule is solid' })
    const rej = N(latest.claims?.rejected) - N(latest.claims?.resolved)
    if (rej > 0) actions.push({ level: 'amber', icon: 'claims', text: rej + ' unresolved claim rejection' + (rej>1?'s':'') + ' from yesterday' })
  }
  if (hasFlags > 0) actions.push({ level: 'amber', icon: 'flags', text: hasFlags + ' patient' + (hasFlags>1?'s':'') + ' with outstanding insurance flags — verify before they arrive' })
  if (hasIssues > 0) actions.push({ level: 'red', icon: 'warn', text: hasIssues + ' patient' + (hasIssues>1?'s':'') + ' with inactive insurance or noted issues' })
  if (tcNoPayment.length > 0) actions.push({ level: 'amber', icon: 'tc', text: tcNoPayment.length + ' big-treatment patient' + (tcNoPayment.length>1?'s':'') + ' arriving — confirm payment collection' })
  if (!onTrack && wdLeft > 0) actions.push({ level: 'amber', icon: 'mtd', text: 'MTD behind pace — need ' + USD(reqDaily) + '/day avg to hit monthly goal' })
  if (recallData?.pending > 0) actions.push({ level: 'amber', icon: 'recall', text: recallData.pending + ' recall patient' + (recallData.pending>1?'s':'') + ' not yet called this month' })

  const ICON = { X:'❌', down:'📉', claims:'📋', flags:'🏥', warn:'⚠️', tc:'🦷', mtd:'📊', recall:'📞' }
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const MON_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '20px 20px 60px' }}>
      <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', borderRadius: 14, padding: '20px 28px', marginBottom: 20, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, opacity: .5, fontWeight: 700, letterSpacing: 2, marginBottom: 2 }}>{DAY_NAMES[todayDt.getDay()].toUpperCase() + ' · MORNING HUDDLE'}</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 2px' }}>{office}</h1>
          <div style={{ fontSize: 13, opacity: .65 }}>{MON_NAMES[mo-1] + ' ' + todayDt.getDate() + ', ' + yr + ' · Working day ' + wdSoFar + ' of ' + wdInMonth}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onBack} style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(255,255,255,.12)', color: 'white', border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>← All Offices</button>
          <button onClick={() => window.print()} style={{ padding: '7px 14px', borderRadius: 8, background: 'rgba(255,255,255,.12)', color: 'white', border: 'none', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Print</button>
        </div>
      </div>

      {actions.length > 0 ? (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#dc2626', letterSpacing: 1, marginBottom: 8 }}>ACTION ITEMS FOR TODAY</div>
          {actions.map((a, i) => <Alert key={i} level={a.level} icon={ICON[a.icon] || a.icon} text={a.text} />)}
        </div>
      ) : (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 16px', marginBottom: 14, fontSize: 13, fontWeight: 700, color: '#15803d' }}>
          No urgent action items — have a great day!
        </div>
      )}

      <Sec title="Today's Schedule" emoji="📋" defaultOpen={true} badge={collPatients.length > 0 ? collPatients.length + ' patients' : 'Not loaded'} badgeColor={collPatients.length > 0 ? '#0d9488' : undefined}>
        {collPatients.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Upload today\'s collection sheet to see schedule details</div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 10, background: uploading ? '#5eead4' : '#0d9488', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <IcoUpload size={14} /> {uploading ? 'Loading...' : 'Upload Collection Sheet'}
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" onChange={handleUpload} style={{ display: 'none' }} disabled={uploading} />
            </label>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Also loads patients in the Collection Tracker</div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 14 }}>
              <Stat label="Patients Today"   value={collPatients.length}  sub="on collection sheet" />
              <Stat label="Balance Due"      value={collWithDue.length}   sub={USD(totalExpected) + ' total'} color={collWithDue.length > 0 ? '#dc2626' : '#16a34a'} />
              <Stat label="Ins Covers All"   value={insCovers}            sub="zero patient portion" color="#0d9488" />
              <Stat label="Ins Flags Open"   value={hasFlags}             sub="need verification" color={hasFlags > 0 ? '#d97706' : '#16a34a'} />
            </div>
            {(() => {
              const ops = Array.from(new Set(collPatients.map(p => p.operatory).filter(Boolean))).sort()
              if (!ops.length) return null
              return (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: 1, marginBottom: 8 }}>BY OPERATORY</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {ops.map(op => {
                      const opPts = collPatients.filter(p => p.operatory === op)
                      const opDue = opPts.filter(p => p.total_expected > 0).reduce((s,p) => s + p.total_expected, 0)
                      return (
                        <div key={op} style={{ padding: '8px 14px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e2e8f0', fontSize: 12 }}>
                          <span style={{ fontWeight: 700, color: '#7c3aed' }}>{op}</span>
                          <span style={{ color: '#64748b', marginLeft: 8 }}>{opPts.length} pts</span>
                          {opDue > 0 && <span style={{ color: '#dc2626', fontWeight: 600, marginLeft: 6 }}>{USD(opDue)}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })()}
            <div style={{ marginTop: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 8, background: 'white', border: '1px solid #e2e8f0', color: '#0d9488', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                <IcoUpload size={12} /> Re-upload sheet
                <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleUpload} style={{ display: 'none' }} />
              </label>
            </div>
          </div>
        )}
      </Sec>

      <Sec title="Anticipated Collections" emoji="💰" defaultOpen={true} badge={collPatients.length > 0 ? USD(totalExpected) : '—'}>
        {collPatients.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>Upload collection sheet to see anticipated collections</div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
              <Stat label="Total Expected"    value={USD(totalExpected)}                                    sub={collWithDue.length + ' patients'} color="#dc2626" />
              <Stat label="Collected So Far"  value={USD(totalCollected)}                                   sub="entered in tracker" color="#16a34a" />
              <Stat label="Still Pending"     value={USD(Math.max(0, totalExpected - totalCollected))}      sub="not yet collected" color={totalExpected > totalCollected ? '#d97706' : '#16a34a'} />
            </div>
            {hasIssues > 0 && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#dc2626', fontWeight: 600, marginBottom: 8 }}>{hasIssues} patient{hasIssues>1?'s':''} flagged — inactive insurance or collection issues. Review in Collection Tracker.</div>}
            {hasFlags > 0 && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#d97706', fontWeight: 600 }}>{hasFlags} patient{hasFlags>1?'s':''} with outstanding insurance flags — verify with Ridgeview before appointment</div>}
          </div>
        )}
      </Sec>

      <Sec title="Big Treatment Patients Today" emoji="🦷" defaultOpen={true} badge={tcMatches.length}>
        {tcMatches.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>{collPatients.length === 0 ? 'Upload collection sheet to match TC patients' : 'No TC patients matched on today\'s collection sheet'}</div>
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 12 }}>
              <Stat label="TC Patients In"      value={tcMatches.length}                                             sub="on today\'s schedule" color="#0d9488" />
              <Stat label="Payment Confirmed"   value={tcMatches.filter(m => m.collPatient?.status==='collected').length} sub="collected" color="#16a34a" />
              <Stat label="Pending Collection"  value={tcNoPayment.length}                                           sub="confirm before seating" color={tcNoPayment.length > 0 ? '#d97706' : '#16a34a'} />
            </div>
            {tcNoPayment.length > 0 && <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#92400e', fontWeight: 600 }}>{tcNoPayment.length} big-treatment patient{tcNoPayment.length>1?'s':''} need payment confirmed before being seated — {USD(tcNoPayment.reduce((s,m)=>s+m.totalExpected,0))} expected</div>}
          </div>
        )}
      </Sec>

      <Sec title="Recall Status" emoji="📞" defaultOpen={true} badge={recallData ? recallData.convRate + '% conv' : '—'}>
        {!recallData ? (
          <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>No recall data for this month</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
            <Stat label="Total on List"    value={recallData.total}      sub="this month" />
            <Stat label="Not Yet Called"   value={recallData.pending}    sub="need outreach" color={recallData.pending > 0 ? '#d97706' : '#16a34a'} />
            <Stat label="Scheduled"        value={recallData.scheduled}  sub="from recalls" color="#16a34a" />
            <Stat label="Conversion Rate"  value={recallData.convRate + '%'} sub="monthly" color={recallData.convRate >= 85 ? '#16a34a' : recallData.convRate >= 60 ? '#d97706' : '#dc2626'} />
          </div>
        )}
      </Sec>

      <Sec title="Yesterday's Performance" emoji="📊" defaultOpen={!!latest}>
        {!latest ? (
          <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '12px 0' }}>No reports submitted yet</div>
        ) : (
          <div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>Last report: {latest.date}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
              <Stat label="Net Production"  value={USD(latestProd)}      sub={'Goal: ' + USD(latestGoal)} color={latestProd >= latestGoal ? '#16a34a' : '#dc2626'} />
              <Stat label="Variance"        value={(latestProd-latestGoal>=0?'+':'')+USD(latestProd-latestGoal)} sub="vs goal" color={latestProd >= latestGoal ? '#16a34a' : '#dc2626'} />
              <Stat label="Collections"     value={USD(latestColl)}      sub={PCT(latestColl, latestProd) + ' of prod'} color="#0d9488" />
              <Stat label="No-Shows"        value={latest.sched?.noShows || 0} sub="patients" color={N(latest.sched?.noShows) > 2 ? '#dc2626' : '#475569'} />
            </div>
            {N(latest.claims?.rejected) > 0 && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#dc2626', fontWeight: 600 }}>{N(latest.claims.rejected)} claim rejection{N(latest.claims.rejected)>1?'s':''} — {N(latest.claims.resolved)} resolved, {Math.max(0,N(latest.claims.rejected)-N(latest.claims.resolved))} still open</div>}
          </div>
        )}
      </Sec>

      <Sec title="Month-to-Date Trajectory" emoji="📈" defaultOpen={true}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 12 }}>
          <Stat label="MTD Production"   value={USD(mtdProd)}       sub={'Goal: ' + USD(mtdGoal)} color={mtdProd >= mtdGoal ? '#16a34a' : '#dc2626'} />
          <Stat label="MTD Collections"  value={USD(mtdColl)}       sub={PCT(mtdColl, mtdProd) + ' rate'} color="#0d9488" />
          <Stat label="Projected Month"  value={USD(projected)}     sub={onTrack ? 'On track' : 'Behind pace'} color={onTrack ? '#16a34a' : '#dc2626'} />
          <Stat label="Days Remaining"   value={wdLeft}             sub={'Need ' + USD(reqDaily) + '/day'} color="#475569" />
        </div>
        <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 4, background: onTrack ? '#16a34a' : '#dc2626', width: Math.min(mtdGoal>0?Math.round(mtdProd/mtdGoal*100):0,100) + '%', transition: 'width .4s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
          <span>$0</span>
          <span style={{ fontWeight: 700, color: onTrack ? '#16a34a' : '#dc2626' }}>{mtdGoal>0?Math.round(mtdProd/mtdGoal*100):0}% of MTD goal</span>
          <span>{USD(mtdGoal)}</span>
        </div>
      </Sec>
    </div>
  )
}

function MorningHuddlePage({ reports, providers, tcPatients, users, notify, user }) {
  const today    = todayStr()
  const todayDt  = new Date(today + 'T12:00:00')
  const yr       = todayDt.getFullYear()
  const mo       = todayDt.getMonth() + 1
  const mStart   = yr + '-' + String(mo).padStart(2,'0') + '-01'
  const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
  const MON_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
  const wdInMonth = workingDaysInMonth(yr, mo)
  const wdSoFar   = workingDaysSoFar(today)
  const [selOffice, setSelOffice] = useState(null)

  if (selOffice) return <OfficeHuddle office={selOffice} reports={reports} providers={providers} tcPatients={tcPatients} onBack={() => setSelOffice(null)} notify={notify} user={user} />

  const officeStats = OFFICES.map(o => {
    const offProviders = providers.filter(p => p.office === o)
    const dailyGoal    = offProviders.reduce((s, p) => s + N(p.goal), 0)
    const offMtd       = reports.filter(r => r.office === o && r.date >= mStart && r.date <= today)
    const mtdProd      = offMtd.reduce((s, r) => s + repProd(r), 0)
    const mtdGoal      = dailyGoal * wdSoFar
    const latest       = reports.filter(r => r.office === o).sort((a,b) => b.date.localeCompare(a.date))[0]
    const latestProd   = latest ? repProd(latest) : 0
    const latestGoal   = latest ? repGoal(latest, providers) : dailyGoal
    const onTrack      = mtdProd >= mtdGoal * 0.95
    return { o, dailyGoal, mtdProd, mtdGoal, latestProd, latestGoal, onTrack, latest }
  })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px 60px' }}>
      <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e3a5f 50%,#1a6b8a)', borderRadius: 16, padding: '24px 32px', marginBottom: 24, color: 'white' }}>
        <div style={{ fontSize: 11, opacity: .5, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>{DAY_NAMES[todayDt.getDay()].toUpperCase()}</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: '0 0 4px' }}>Good Morning</h1>
        <div style={{ fontSize: 14, opacity: .65 }}>{MON_NAMES[mo-1] + ' ' + todayDt.getDate() + ', ' + yr + ' — Working day ' + wdSoFar + ' of ' + wdInMonth}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 14 }}>
        {officeStats.map(({ o, mtdProd, mtdGoal, latestProd, latestGoal, onTrack, latest }) => {
          const pct = latestGoal > 0 ? Math.round((latestProd / latestGoal) * 100) : 0
          const hasAlert = latest && (latestProd < latestGoal * 0.9 || N(latest.sched?.noShows) > N(latest.sched?.rescheduled))
          return (
            <button key={o} onClick={() => setSelOffice(o)}
              style={{ textAlign: 'left', background: 'white', borderRadius: 14, border: '2px solid ' + (hasAlert ? '#fde68a' : onTrack ? '#bbf7d0' : '#e2e8f0'), padding: '20px', cursor: 'pointer', transition: 'all .15s' }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,.08)' }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#1e293b' }}>{o}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: onTrack ? '#dcfce7' : '#fef3c7', color: onTrack ? '#16a34a' : '#d97706' }}>{onTrack ? 'On Track' : 'Behind'}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>YESTERDAY</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: pct >= 90 ? '#16a34a' : '#dc2626' }}>{USD(latestProd)}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{pct}% of goal</div>
                </div>
                <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: .5, marginBottom: 2 }}>MTD</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#0d9488' }}>{USD(mtdProd)}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{mtdGoal > 0 ? Math.round(mtdProd/mtdGoal*100) : 0}% of pace</div>
                </div>
              </div>
              <div style={{ height: 4, background: '#e2e8f0', borderRadius: 2, overflow: 'hidden', marginBottom: 14 }}>
                <div style={{ height: '100%', background: onTrack ? '#16a34a' : '#dc2626', width: Math.min(mtdGoal>0?Math.round(mtdProd/mtdGoal*100):0,100) + '%', borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1d4ed8' }}>Open huddle</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default MorningHuddlePage
