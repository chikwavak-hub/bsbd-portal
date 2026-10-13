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
  const groups = pickGroups(proc)
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
        style={{ padding: '5px 10px', borderRadius: 99, fontSize: 13, fontWeight: 600, cursor: 'pointer',
          border: ai ? `2px dashed ${GOLD}` : `1px solid ${on ? NAVY : LINE}`,
          background: on ? (ai ? '#FFF8E6' : NAVY) : '#fff', color: on ? (ai ? INK : '#fff') : INK }}>
        {label}{ai ? ' · AI' : ''}
      </button>
    )
  }

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 9, padding: '12px 14px', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 700, color: NAVY, flex: 1 }}>Radiographic findings{tooth ? ` · #${String(tooth).split(/[,\s]+/)[0]}` : ''}</div>
        {aiUnused && <button onClick={fillFromAi} style={btnGhost}>Fill blanks from AI read</button>}
        {aiOpen.length > 0 && <button onClick={confirmAll} style={btnGhost}>Confirm {aiOpen.length} AI pick{aiOpen.length > 1 ? 's' : ''}</button>}
      </div>
      <div style={{ fontSize: 12, color: MUTED, margin: '2px 0 8px' }}>
        Tap what the film shows. Dashed gold = AI suggestion; tap it to confirm or pick another.
      </div>

      {groups.filter(g => !g.showIf || g.showIf(values)).map(g => {
        const c = conflictFor(g.key)
        return (
          <div key={g.key} style={{ padding: '6px 0', borderTop: `1px solid ${LINE}` }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: MUTED, marginBottom: 4 }}>{g.label}{g.type === 'multi' ? ' (any)' : ''}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{g.options.map(o => chip(g, o))}</div>
            {c && <div style={{ fontSize: 12, color: '#B42318', marginTop: 4 }}>Check the film: {c.note}</div>}
          </div>
        )
      })}

      <div style={{ marginTop: 10, background: '#F6F7FB', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: NAVY, marginBottom: 4 }}>What goes in the note</div>
        {sentences.length
          ? <>
              {built.objective.length > 0 && <div style={{ fontSize: 13, marginBottom: 4 }}><b>Objective:</b> {built.objective.join(' ')}</div>}
              {built.assessment.length > 0 && <div style={{ fontSize: 13 }}><b>Assessment:</b> {built.assessment.join(' ')}</div>}
            </>
          : <div style={{ fontSize: 13, color: MUTED }}>Pick the findings above and the sentences appear here.</div>}
        {built.missing.length > 0 && sentences.length > 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>Would make it stronger: {built.missing.join(', ')}.</div>}
        {!tests.length && sentences.length > 0 && <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>No test results in the note yet — fill cold/percussion and the findings will tie to them.</div>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        {canAdd
          ? <button disabled={!sentences.length || aiOpen.length > 0} onClick={() => onAdd(built)}
              style={{ padding: '8px 16px', borderRadius: 8, border: 0, fontWeight: 700, fontSize: 14, cursor: 'pointer',
                background: !sentences.length || aiOpen.length ? '#B9C0CF' : NAVY, color: '#fff' }}>
              {added ? 'Update findings in note' : 'Add findings to note'}
            </button>
          : <span style={{ fontSize: 13, color: MUTED }}>The dentist adds these to the note.</span>}
        {canAdd && aiOpen.length > 0 && <span style={{ fontSize: 12, color: '#8A5A00' }}>Confirm or change the AI picks first.</span>}
        {added && canAdd && <button onClick={onRemove} style={{ ...btnGhost, border: 0, textDecoration: 'underline' }}>Remove from note</button>}
        {added && <span style={{ fontSize: 12, color: '#1E7A46', fontWeight: 700 }}>In the note</span>}
      </div>
    </div>
  )
}

const btnGhost = { padding: '4px 10px', borderRadius: 7, border: `1px solid ${LINE}`, background: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', color: INK }
