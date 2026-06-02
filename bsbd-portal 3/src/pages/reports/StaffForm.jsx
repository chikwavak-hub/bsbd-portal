import React, { useState, useEffect } from 'react'
import { IcoCheck, IcoSave } from '../../components/icons'
import { sbGet, sbPost } from '../../lib/supabase'
import { N, todayStr } from '../../lib/helpers'

// ── Field names match EXACTLY what Form.jsx uses ───────────────────────────
// fd[name].calls        = NP Calls made
// fd[name].callsSched   = NP Calls scheduled
// fd[name].recalls      = Recall calls made
// fd[name].recallsSched = From recalls scheduled
// fd[name].npTxPres     = NP TX presented
// fd[name].npTxAcc      = NP TX accepted
// fd[name].exTxPres     = Existing TX presented
// fd[name].exTxAcc      = Existing TX accepted
// sched.compExamsSeen   = Comp exams seen (prebooking)
// sched.ptsPrebooked    = Patients booked next appt
// sched.ptsConfirmed    = Patients confirmed
// sched.predGenerated   = Pre-Ds generated (stored in sched)
// sched.predSubmitted   = Pre-Ds submitted (stored in sched)

const BLANK = {
  // NP calls — maps to fd[name].calls / fd[name].callsSched
  calls:         '',
  callsSched:    '',
  // Recalls — maps to fd[name].recalls / fd[name].recallsSched
  recalls:       '',
  recallsSched:  '',
  // TX plans — maps to fd[name].npTxPres/npTxAcc/exTxPres/exTxAcc
  npTxPres:      '',
  npTxAcc:       '',
  exTxPres:      '',
  exTxAcc:       '',
  // Prebooking — maps to sched.compExamsSeen / sched.ptsPrebooked
  compExamsSeen: '',
  ptsPrebooked:  '',
  // Confirmations — maps to sched.ptsConfirmed
  ptsConfirmed:  '',
  // Pre-Ds — maps to sched.predGenerated / sched.predSubmitted
  predGenerated: '',
  predSubmitted: '',
  // Notes — for manager visibility only
  notes:         '',
}

function Field({ label, value, onChange, hint, kpi }) {
  return (
    <div>
      <div style={{ fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:.5, marginBottom:4 }}>
        {label.toUpperCase()}
        {hint && <span style={{ fontSize:9, color:'#94a3b8', fontWeight:400, marginLeft:6 }}>{hint}</span>}
        {kpi  && <span style={{ fontSize:9, color:'#0d9488', fontWeight:700, marginLeft:6 }}>KPI {kpi}</span>}
      </div>
      <input
        type="text" inputMode="numeric"
        value={value || ''}
        onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))}
        placeholder="—"
        style={{
          width:'100%', boxSizing:'border-box',
          padding:'9px 10px', borderRadius:8,
          border:'1px solid #e2e8f0', fontSize:14,
          fontWeight:600, outline:'none',
        }}
        onFocus={e => e.target.style.borderColor='#1d4ed8'}
        onBlur={e => e.target.style.borderColor='#e2e8f0'}
      />
    </div>
  )
}

function LiveKpi({ label, a, b, target, invert }) {
  if (!N(b)) return null
  const val = Math.round(N(a) / N(b) * 100)
  const good = invert ? val <= target : val >= target
  return (
    <div style={{ fontSize:11, fontWeight:700, color: good?'#16a34a':'#d97706', marginTop:4 }}>
      {val}% {label} {good ? '✓' : `— target ${invert?'<':'>'}${target}%`}
    </div>
  )
}

function Section({ title, emoji, children }) {
  return (
    <div style={{ background:'#f8fafc', borderRadius:12, padding:'16px', marginBottom:14, border:'1px solid #e2e8f0' }}>
      <div style={{ fontSize:12, fontWeight:800, color:'#1e293b', marginBottom:12 }}>{emoji} {title}</div>
      {children}
    </div>
  )
}

export default function StaffFormPage({ user, notify }) {
  const [date,      setDate]      = useState(todayStr())
  const [data,      setData]      = useState({ ...BLANK })
  const [saving,    setSaving]    = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [lastSaved, setLastSaved] = useState(null)
  const [loading,   setLoading]   = useState(true)

  const set = (k, v) => setData(d => ({ ...d, [k]: v }))

  useEffect(() => {
    if (!user?.office || !date) return
    setLoading(true)
    sbGet('staff_submissions',
      'date=eq.' + date + '&office=eq.' + encodeURIComponent(user.office) +
      '&username=eq.' + encodeURIComponent(user.username)
    ).then(rows => {
      if (rows.length) {
        setData({ ...BLANK, ...rows[0].data })
        setLastSaved(rows[0].updated_at)
        setSubmitted(true)
      } else {
        setData({ ...BLANK })
        setSubmitted(false)
        setLastSaved(null)
      }
    }).catch(() => {}).finally(() => setLoading(false))
  }, [date, user?.office, user?.username])

  const save = async () => {
    if (!user?.office) { notify('No office assigned to your account', 'error'); return }
    setSaving(true)
    try {
      const row = {
        id:           [date, user.office, user.username].join('_').replace(/\s+/g, '_'),
        date,
        office:       user.office,
        username:     user.username,
        staff_name:   user.name || user.username,
        staff_role:   user.role,
        data,
        submitted_at: lastSaved || new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      }
      await sbPost('staff_submissions', row, true)
      setSubmitted(true)
      setLastSaved(new Date().toISOString())
      notify('Submitted ✓ — your numbers are ready for the manager')
    } catch(e) {
      notify('Save failed: ' + e.message, 'error')
      console.error(e)
    }
    setSaving(false)
  }

  const DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][
    new Date(date + 'T12:00:00').getDay()
  ]

  if (loading) return <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>Loading…</div>

  return (
    <div style={{ maxWidth:600, margin:'0 auto', padding:'20px 16px 80px' }}>

      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', borderRadius:14,
        padding:'18px 20px', marginBottom:20, color:'white' }}>
        <div style={{ fontSize:10, opacity:.5, fontWeight:700, letterSpacing:2, marginBottom:4 }}>DAILY NUMBERS</div>
        <div style={{ fontSize:18, fontWeight:800, marginBottom:10 }}>{user?.name} — {user?.office}</div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div>
            <div style={{ fontSize:9, opacity:.5, letterSpacing:1, marginBottom:3 }}>DATE</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ padding:'6px 10px', borderRadius:8, border:'none',
                background:'rgba(255,255,255,.15)', color:'white', fontWeight:700, fontSize:13 }}/>
          </div>
          <div style={{ marginLeft:'auto', textAlign:'right' }}>
            <div style={{ fontSize:11, opacity:.7 }}>{DAY}</div>
            {lastSaved && (
              <div style={{ fontSize:10, opacity:.5, marginTop:2 }}>
                Last saved {new Date(lastSaved).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}
              </div>
            )}
          </div>
        </div>
      </div>

      {submitted && (
        <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10,
          padding:'10px 16px', marginBottom:16, fontSize:13, color:'#15803d',
          fontWeight:600, display:'flex', alignItems:'center', gap:8 }}>
          <IcoCheck size={14}/> Submitted for {date} — update below and resubmit if needed
        </div>
      )}

      {/* NP Calls */}
      <Section title="New Patient Calls" emoji="📞">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
          <Field label="NP Calls Made"      value={data.calls}      onChange={v=>set('calls',v)}      kpi=">0"/>
          <Field label="NP Calls Scheduled" value={data.callsSched} onChange={v=>set('callsSched',v)} kpi=">50%"/>
        </div>
        <LiveKpi label="call conversion" a={data.callsSched} b={data.calls} target={50}/>
      </Section>

      {/* Recalls */}
      <Section title="Recall Calls" emoji="🔁">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
          <Field label="Recall Calls Made"    value={data.recalls}      onChange={v=>set('recalls',v)}/>
          <Field label="Recalls Scheduled"    value={data.recallsSched} onChange={v=>set('recallsSched',v)} kpi=">85%"/>
        </div>
        <LiveKpi label="recall conversion" a={data.recallsSched} b={data.recalls} target={85}/>
      </Section>

      {/* TX Plans */}
      <Section title="Treatment Plans" emoji="📋">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
          <Field label="NP TX Presented"      value={data.npTxPres} onChange={v=>set('npTxPres',v)}/>
          <Field label="NP TX Accepted"       value={data.npTxAcc}  onChange={v=>set('npTxAcc',v)}  kpi=">85%"/>
          <Field label="Existing TX Presented" value={data.exTxPres} onChange={v=>set('exTxPres',v)}/>
          <Field label="Existing TX Accepted"  value={data.exTxAcc}  onChange={v=>set('exTxAcc',v)}  kpi=">90%"/>
        </div>
        <LiveKpi label="NP TX acceptance" a={data.npTxAcc} b={data.npTxPres} target={85}/>
        <LiveKpi label="Existing TX acceptance" a={data.exTxAcc} b={data.exTxPres} target={90}/>
      </Section>

      {/* Prebooking */}
      <Section title="Prebooking" emoji="📅">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
          <Field label="Comp Exams Seen"      value={data.compExamsSeen} onChange={v=>set('compExamsSeen',v)}/>
          <Field label="Patients Booked Next" value={data.ptsPrebooked}  onChange={v=>set('ptsPrebooked',v)}  kpi=">95%"/>
        </div>
        <LiveKpi label="prebook rate" a={data.ptsPrebooked} b={data.compExamsSeen} target={95}/>
      </Section>

      {/* Confirmations */}
      <Section title="Confirmations" emoji="✅">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <Field label="Patients Confirmed" value={data.ptsConfirmed} onChange={v=>set('ptsConfirmed',v)} kpi=">97%"/>
          <div style={{ padding:'10px 0', fontSize:11, color:'#94a3b8' }}>
            Manager enters total scheduled — you enter how many confirmed
          </div>
        </div>
      </Section>

      {/* Pre-Ds */}
      <Section title="Predeterminations" emoji="📑">
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:8 }}>
          <Field label="Pre-Ds Generated" value={data.predGenerated} onChange={v=>set('predGenerated',v)}/>
          <Field label="Pre-Ds Submitted" value={data.predSubmitted} onChange={v=>set('predSubmitted',v)} kpi="100%"/>
        </div>
        <LiveKpi label="submission rate" a={data.predSubmitted} b={data.predGenerated} target={100}/>
      </Section>

      {/* Notes */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:.5, marginBottom:6 }}>
          NOTES (OPTIONAL)
        </div>
        <textarea value={data.notes||''} onChange={e=>set('notes',e.target.value)}
          placeholder="Any notes for the manager…"
          style={{ width:'100%', boxSizing:'border-box', minHeight:70, padding:'10px 12px',
            borderRadius:10, border:'1px solid #e2e8f0', fontSize:13, resize:'vertical' }}/>
      </div>

      <button onClick={save} disabled={saving}
        style={{ width:'100%', padding:'14px', borderRadius:12,
          background: saving?'#93c5fd':'#1d4ed8', color:'white',
          border:'none', fontWeight:800, fontSize:15,
          cursor: saving?'not-allowed':'pointer' }}>
        {saving ? 'Submitting…' : submitted ? '↻ Update Submission' : '✓ Submit Numbers'}
      </button>
    </div>
  )
}
