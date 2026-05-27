import React, { useState, useEffect } from 'react'
import { IcoCheck, IcoSave, IcoRefresh } from '../../components/icons'
import { sbGet, sbPost } from '../../lib/supabase'
import { N, todayStr } from '../../lib/helpers'

const BLANK = {
  // Calls
  callsExternal:  '', callsInternal: '', callsMissed: '',
  // NP
  npCalls: '', npCallsSched: '',
  // Recalls
  recalls: '', recallsSched: '',
  // Prebooking
  compExamsSeen: '', ptsPrebooked: '',
  // Confirmations
  ptsConfirmed: '',
  // Pre-Ds
  predGenerated: '', predSubmitted: '',
  // Notes
  notes: '',
}

function Field({ label, value, onChange, hint, pre }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: .5, marginBottom: 4 }}>
        {label.toUpperCase()}
        {hint && <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 400, marginLeft: 6 }}>{hint}</span>}
      </div>
      <div style={{ position: 'relative' }}>
        {pre && <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13, pointerEvents: 'none' }}>$</span>}
        <input
          type="number" min="0"
          value={value || ''}
          onChange={e => onChange(e.target.value)}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: pre ? '8px 8px 8px 20px' : '8px 10px',
            borderRadius: 8, border: '1px solid #e2e8f0',
            fontSize: 14, fontWeight: 600, outline: 'none',
          }}
          onFocus={e => e.target.style.borderColor = '#1d4ed8'}
          onBlur={e => e.target.style.borderColor = '#e2e8f0'}
        />
      </div>
    </div>
  )
}

function Section({ title, emoji, children }) {
  return (
    <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px', marginBottom: 14, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginBottom: 12 }}>{emoji} {title}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12 }}>
        {children}
      </div>
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

  // Load existing submission for today
  useEffect(() => {
    if (!user?.office || !date) return
    setLoading(true)
    sbGet('staff_submissions',
      'date=eq.' + date + '&office=eq.' + encodeURIComponent(user.office) + '&username=eq.' + encodeURIComponent(user.username)
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
      notify('Submitted ✓ — manager will see your numbers')
    } catch(e) {
      notify('Save failed: ' + e.message, 'error')
      console.error(e)
    }
    setSaving(false)
  }

  const DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(date + 'T12:00:00').getDay()]

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Loading…</div>

  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: '20px 16px 80px' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#1d4ed8)', borderRadius: 14, padding: '18px 20px', marginBottom: 20, color: 'white' }}>
        <div style={{ fontSize: 10, opacity: .5, fontWeight: 700, letterSpacing: 2, marginBottom: 4 }}>DAILY NUMBERS</div>
        <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 10 }}>{user?.name} — {user?.office}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div style={{ fontSize: 9, opacity: .5, letterSpacing: 1, marginBottom: 3 }}>DATE</div>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 8, border: 'none', background: 'rgba(255,255,255,.15)', color: 'white', fontWeight: 700, fontSize: 13 }}/>
          </div>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 11, opacity: .7 }}>{DAY}</div>
            {lastSaved && <div style={{ fontSize: 10, opacity: .5, marginTop: 2 }}>
              Last saved {new Date(lastSaved).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </div>}
          </div>
        </div>
      </div>

      {/* Already submitted banner */}
      {submitted && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#15803d', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <IcoCheck size={14}/> Numbers submitted for {date} — update below and resubmit if needed
        </div>
      )}

      {/* Calls */}
      <Section title="Calls Received" emoji="📞">
        <Field label="External Calls"  value={data.callsExternal} onChange={v => set('callsExternal', v)}/>
        <Field label="Internal Calls"  value={data.callsInternal} onChange={v => set('callsInternal', v)}/>
        <Field label="Missed Calls"    value={data.callsMissed}   onChange={v => set('callsMissed', v)}/>
      </Section>

      {/* NP */}
      <Section title="New Patient Calls" emoji="👤">
        <Field label="NP Calls Made"   value={data.npCalls}       onChange={v => set('npCalls', v)}/>
        <Field label="NP Calls Sched"  value={data.npCallsSched}  onChange={v => set('npCallsSched', v)}/>
      </Section>

      {/* Recalls */}
      <Section title="Recalls" emoji="🔁">
        <Field label="Recall Calls"    value={data.recalls}       onChange={v => set('recalls', v)}/>
        <Field label="Recalls Sched"   value={data.recallsSched}  onChange={v => set('recallsSched', v)}/>
      </Section>

      {/* Prebooking */}
      <Section title="Prebooking" emoji="📅">
        <Field label="Comp Exams Seen" value={data.compExamsSeen} onChange={v => set('compExamsSeen', v)}/>
        <Field label="Pts Booked Next" value={data.ptsPrebooked}  onChange={v => set('ptsPrebooked', v)}/>
        {N(data.compExamsSeen) > 0 && (
          <div style={{ padding: '8px 0' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: .5, marginBottom: 4 }}>PREBOOK RATE</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: N(data.ptsPrebooked) / N(data.compExamsSeen) >= 0.95 ? '#16a34a' : '#dc2626' }}>
              {Math.round(N(data.ptsPrebooked) / N(data.compExamsSeen) * 100)}%
            </div>
          </div>
        )}
      </Section>

      {/* Confirmations */}
      <Section title="Confirmations" emoji="✅">
        <Field label="Pts Confirmed"   value={data.ptsConfirmed}  onChange={v => set('ptsConfirmed', v)}/>
      </Section>

      {/* Pre-Ds */}
      <Section title="Predeterminations" emoji="📋">
        <Field label="Pre-Ds Generated"  value={data.predGenerated} onChange={v => set('predGenerated', v)}/>
        <Field label="Pre-Ds Submitted"  value={data.predSubmitted} onChange={v => set('predSubmitted', v)}/>
      </Section>

      {/* Notes */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', letterSpacing: .5, marginBottom: 6 }}>NOTES (OPTIONAL)</div>
        <textarea value={data.notes || ''} onChange={e => set('notes', e.target.value)}
          placeholder="Any additional notes for the manager…"
          style={{ width: '100%', boxSizing: 'border-box', minHeight: 70, padding: '10px 12px', borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical' }}/>
      </div>

      {/* Submit button */}
      <button onClick={save} disabled={saving}
        style={{ width: '100%', padding: '14px', borderRadius: 12, background: saving ? '#86efac' : '#1d4ed8', color: 'white', border: 'none', fontWeight: 800, fontSize: 15, cursor: saving ? 'not-allowed' : 'pointer' }}>
        <IcoSave size={16} style={{ marginRight: 8 }}/> {saving ? 'Submitting…' : submitted ? 'Update Submission' : 'Submit Numbers'}
      </button>
    </div>
  )
}
