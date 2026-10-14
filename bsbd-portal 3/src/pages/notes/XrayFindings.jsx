// src/pages/notes/XrayFindings.jsx — tap-to-pick radiographic findings.
//
// The dentist (or the assistant, chairside) reads the film and taps what it
// shows: decay surfaces and depth, periapical status, structure lost,
// post-op fill, restorability. The note sentences are written from the picks
// and tied to the tests and diagnosis already in the note.
//
// Picks the AI pre-selected show dashed gold until someone taps to confirm
// them. Adding to the note needs a dentist login and no unconfirmed AI picks.
//
// Props
//   proc       rct | pulpotomy | crown | ext_surgical | ext_simple | filling | srp
//   tooth      '19'
//   picks      { values: { key: value | [values] }, src: { key: 'ai' | 'staff' } }
//   onPicks    (next) => void
//   aiPicks    the AI's read, same shape as values (optional)
//   conflicts  [{ key, note }] where the film seems to disagree with a pick (optional)
//   tests, dx  from the note (see testsFromNote / dxFromNote)
//   canAdd     true for dentist logins
//   added      true if these findings are already in the note
//   onAdd(built) / onRemove()

import React from 'react'
import { pickGroups, buildFindings } from '../../lib/xrayFindings'

const NAVY = '#1B2A6B', GOLD = '#C9A84C', INK = '#1F2433', MUTED = '#5E6577', LINE = '#DDE1EA'

export default function XrayFindings({ proc, tooth, picks, onPicks, aiPicks, conflicts = [], tests = [], dx = '', canAdd, added, onAdd, onRemove }) {
  const groups = pickGroups(proc, tooth)
  if (!groups.length) return null
  const values = picks?.values || {}
  const src = picks?.src || {}
  const set = (key, val, from = 'staff') => {
    const v = { ...values }, s = { ...src }
    if (val == null || (Array.isArray(val) && !val.length)) { delete v[key]; delete s[key] } else { v[key] = val; s[key] = from }
    onPicks({ values: v, src: s })
  }
  const tap = (g, opt) => {
    const cur = values[g.key]
    if (g.type === 'multi') {
      const arr = Array.isArray(cur) ? cur : []
      // tapping an AI-suggested group first confirms it as-is
      if (src[g.key] === 'ai') return set(g.key, arr.includes(opt) ? arr : [...arr, opt])
      set(g.key, arr.includes(opt) ? arr.filter(x => x !== opt) : [...arr, opt])
    } else {
      if (src[g.key] === 'ai' && cur === opt) return set(g.key, opt)          // confirm
      set(g.key, cur === opt ? null : opt)
    }
  }
  const aiOpen = Object.keys(src).filter(k => src[k] === 'ai' && values[k] != null)
  const confirmAll = () => { const s = { ...src }; aiOpen.forEach(k => { s[k] = 'staff' }); onPicks({ values, src: s }) }
  const fillFromAi = () => {
    if (!aiPicks) return
    const v = { ...values }, s = { ...src }
    Object.entries(aiPicks).forEach(([k, val]) => { if (v[k] == null && val != null && !(Array.isArray(val) && !val.length)) { v[k] = val; s[k] = 'ai' } })
    onPicks({ values: v, src: s })
  }
  const aiUnused = aiPicks && Object.keys(aiPicks).some(k => values[k] == null)
  const built = buildFindings(proc, tooth, values, { tests, dx })
  const sentences = [...built.objective, ...built.assessment]
  const conflictFor = k => conflicts.find(c => c.key === k)

  const chip = (g, [val, label]) => {
    const cur = values[g.key]
    const on = g.type === 'multi' ? (Array.isArray(cur) && cur.includes(val)) : cur === val
    const ai = on && src[g.key] === 'ai'
    return (
      <button key={val} onClick={() => tap(g, val)} title={ai ? 'AI suggestion — tap to confirm' : ''}
        style={{ padding: '3px 9px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', lineHeight: 1.5,
          border: ai ? `1.5px dashed ${GOLD}` : `1px solid ${on ? NAVY : LINE}`,
          background: on ? (ai ? '#FFF8E6' : NAVY) : '#fff', color: on ? (ai ? INK : '#fff') : '#3A4152' }}>
        {label}
      </button>
    )
  }
  const visible = groups.filter(g => !g.showIf || g.showIf(values))
  const sections = [
    ['Pre-op', visible.filter(g => !POST.has(g.key) && !ASSESS.has(g.key))],
    ['Post-op', visible.filter(g => POST.has(g.key))],
    ['Assessment', visible.filter(g => ASSESS.has(g.key))],
  ].filter(([, gs]) => gs.length)

  return (
    <div>
      {aiOpen.length > 0 || aiUnused ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: '#FFF8E6', borderRadius: 8, padding: '6px 10px', marginBottom: 8, fontSize: 12.5 }}>
          <span style={{ flex: 1 }}>{aiOpen.length > 0 ? `${aiOpen.length} AI pick${aiOpen.length > 1 ? 's' : ''} (dashed) — tap to confirm or change.` : 'The AI read has picks for the blanks.'}</span>
          {aiUnused && <button onClick={fillFromAi} style={btnGhost}>Fill blanks</button>}
          {aiOpen.length > 0 && <button onClick={confirmAll} style={btnGhost}>Confirm all</button>}
        </div>
      ) : null}

      {sections.map(([title, gs]) => (
        <div key={title} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: .6, color: MUTED, textTransform: 'uppercase', margin: '6px 0 2px' }}>{title}</div>
          {gs.map(g => {
            const c = conflictFor(g.key)
            return (
              <div key={g.key} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '3px 0', flexWrap: 'wrap' }}>
                <div style={{ width: 150, flexShrink: 0, fontSize: 12.5, color: MUTED }}>{SHORT[g.key] || g.label}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1, minWidth: 220 }}>
                  {g.options.map(o => chip(g, o))}
                  {c && <div style={{ width: '100%', fontSize: 12, color: '#B42318' }}>Check the film: {c.note}</div>}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      {sentences.length > 0 && (
        <div style={{ marginTop: 8, borderLeft: `3px solid ${added ? '#1E7A46' : NAVY}`, background: '#F6F7FB', borderRadius: '0 8px 8px 0', padding: '8px 12px', fontSize: 13, color: INK }}>
          {sentences.join(' ')}
          {(built.missing.length > 0 || !tests.length) && (
            <div style={{ fontSize: 12, color: MUTED, marginTop: 4 }}>
              {[built.missing.length ? `Add ${built.missing.join(', ').toLowerCase()} to make it stronger` : '', !tests.length ? 'fill the cold/percussion results and they will be tied in' : ''].filter(Boolean).join('; ')}.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        {canAdd
          ? <button disabled={!sentences.length || aiOpen.length > 0} onClick={() => onAdd(built)}
              style={{ padding: '7px 14px', borderRadius: 8, border: 0, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                background: !sentences.length || aiOpen.length ? '#B9C0CF' : NAVY, color: '#fff' }}>
              {added ? 'Update in note' : 'Add to note'}
            </button>
          : sentences.length > 0 && <span style={{ fontSize: 12.5, color: MUTED }}>The dentist adds these to the note.</span>}
        {added && <span style={{ fontSize: 12.5, color: '#1E7A46', fontWeight: 700 }}>✓ In the note</span>}
        {added && canAdd && <button onClick={onRemove} style={{ ...btnGhost, border: 0, padding: 0, textDecoration: 'underline', color: MUTED }}>Remove</button>}
      </div>
    </div>
  )
}

const POST = new Set(['canals', 'fill_length', 'voids', 'seat'])
const ASSESS = new Set(['restorable', 'restorable_basis'])
const SHORT = {
  preop_film: 'Film', decay_surf: 'Decay surfaces', decay_type: 'Decay type', decay_depth: 'Decay depth',
  pa_status: 'Periapical', pa_roots: 'At root', walls_lost: 'Structure lost', remaining: 'Remaining',
  restoration: 'Existing restoration', prior_rct: 'Prior RCT', canals: 'Canals filled', fill_length: 'Fill length',
  voids: 'Density', seat: 'Crown', roots_feat: 'Root factors', bone_loss: 'Bone loss', bone_pattern: 'Pattern',
  calculus: 'Calculus', furcation: 'Furcation', restorable: 'Restorable', restorable_basis: 'Shown on',
}
const btnGhost = { padding: '4px 10px', borderRadius: 7, border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: INK }
