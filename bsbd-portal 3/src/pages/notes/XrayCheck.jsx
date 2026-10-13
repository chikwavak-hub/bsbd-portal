// src/pages/notes/XrayCheck.jsx — X-ray claim check (Note Builder).
//
// Billing attaches the claim's pre-op / post-op images, blacks out any
// patient name or ID burned into them, and runs a check against what
// TennCare reviewers want to see. Failed or unclear items come back ranked
// by denial risk and can be sent to the dentist with the note.
//
// Images are resized (max 1568 px) and redacted IN THE BROWSER before upload.
// Nothing is saved: images live only in this screen's memory.
//
// Props
//   procedure  initial procedure key (rct, crown, ext_surgical, ext_simple, filling, srp, other)
//   tooth      initial tooth number(s)
//   noteText   the note to cross-check (optional)
//   onResult   (result, issues, resp) => void   issues = [{ label, risk, status, detail }]
//   notify     (msg, type) => void
//   embedded   true = no outer page padding / header

import React, { useState, useRef, useCallback, useEffect } from 'react'

export const XRAY_PROCEDURES = [
  { key: 'rct',          label: 'Root canal',          needs: ['preop', 'postop'] },
  { key: 'crown',        label: 'Crown',               needs: ['preop', 'postop'] },
  { key: 'ext_surgical', label: 'Surgical extraction', needs: ['preop'] },
  { key: 'ext_simple',   label: 'Simple extraction',   needs: ['preop'] },
  { key: 'filling',      label: 'Filling',             needs: ['preop'] },
  { key: 'srp',          label: 'Scaling & root planing', needs: ['preop'] },
  { key: 'other',        label: 'Other',               needs: [] },
]
const ROLES = [['preop', 'Pre-op'], ['postop', 'Post-op'], ['other', 'Other']]
const MAX_EDGE = 1568
const MAX_IMAGES = 6

const NAVY = '#1B2A6B', GOLD = '#C9A84C'
const RISK_COLOR = { high: '#dc2626', medium: '#d97706', low: '#64748b' }
const STATUS_ICON = { pass: '✅', fail: '❌', unclear: '❔' }
const TYPE_LABEL = {
  periapical: 'Periapical', bitewing: 'Bitewing', panoramic: 'Pano', fmx_collage: 'FMX collage',
  cbct_slice: 'CBCT', intraoral_photo: 'Photo', chart_or_document: 'Chart / document', other: 'Other',
}

// ── image helpers ─────────────────────────────────────────────────────────
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not read that image'))
    img.src = src
  })
}
function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('Could not read the file'))
    r.readAsDataURL(file)
  })
}
// Resize to MAX_EDGE on the long side, flatten to JPEG.
async function prepareFile(file) {
  const img = await loadImage(await readAsDataURL(file))
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale))
  const c = document.createElement('canvas'); c.width = w; c.height = h
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  return { src: c.toDataURL('image/jpeg', 0.9), w, h }
}
// Apply black-out boxes and return base64 JPEG (no data: prefix).
async function exportRedacted(item) {
  const img = await loadImage(item.src)
  const c = document.createElement('canvas'); c.width = item.w; c.height = item.h
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, item.w, item.h)
  ctx.fillStyle = '#000'
  item.boxes.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h))
  return c.toDataURL('image/jpeg', 0.85).split(',')[1]
}

// ── one image card with drag-to-black-out ─────────────────────────────────
function ImageCard({ item, index, onChange, onRemove }) {
  const wrap = useRef(null)
  const [draft, setDraft] = useState(null)   // box being drawn, in image px

  const toImg = e => {
    const r = wrap.current.getBoundingClientRect()
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width)
    const y = Math.min(Math.max(e.clientY - r.top, 0), r.height)
    return { x: x * item.w / r.width, y: y * item.h / r.height }
  }
  const down = e => { e.preventDefault(); wrap.current.setPointerCapture?.(e.pointerId); const p = toImg(e); setDraft({ x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 }) }
  const move = e => {
    if (!draft) return
    const p = toImg(e)
    setDraft(d => ({ ...d, x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) }))
  }
  const up = () => {
    if (draft && draft.w > 4 && draft.h > 4) onChange({ ...item, boxes: [...item.boxes, { x: draft.x, y: draft.y, w: draft.w, h: draft.h }] })
    setDraft(null)
  }
  const pct = b => ({ left: `${b.x / item.w * 100}%`, top: `${b.y / item.h * 100}%`, width: `${b.w / item.w * 100}%`, height: `${b.h / item.h * 100}%` })

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, background: 'white', width: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <b style={{ fontSize: 12, color: NAVY }}>Image {index + 1}</b>
        <select value={item.role} onChange={e => onChange({ ...item, role: e.target.value })}
          style={{ flex: 1, padding: '4px 6px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12, fontWeight: 600 }}>
          {ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button onClick={onRemove} title="Remove image"
          style={{ border: 0, background: '#fee2e2', color: '#b91c1c', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontWeight: 800 }}>✕</button>
      </div>
      <div ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDraft(null)}
        style={{ position: 'relative', cursor: 'crosshair', userSelect: 'none', touchAction: 'none', background: '#000', borderRadius: 6, overflow: 'hidden' }}>
        <img src={item.src} alt="" draggable={false} style={{ display: 'block', width: '100%', pointerEvents: 'none' }} />
        {item.boxes.map((b, i) => <div key={i} style={{ position: 'absolute', background: '#000', outline: '1px dashed #f59e0b', ...pct(b) }} />)}
        {draft && <div style={{ position: 'absolute', background: 'rgba(0,0,0,.75)', outline: '1px dashed #f59e0b', ...pct(draft) }} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontSize: 11, color: '#64748b' }}>
        <span style={{ flex: 1 }}>Drag over any name or ID to black it out</span>
        {item.boxes.length > 0 && <>
          <button onClick={() => onChange({ ...item, boxes: item.boxes.slice(0, -1) })} style={smallBtn}>Undo</button>
          <button onClick={() => onChange({ ...item, boxes: [] })} style={smallBtn}>Clear</button>
        </>}
      </div>
    </div>
  )
}
const smallBtn = { border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#334155' }

// ── main component ────────────────────────────────────────────────────────
export default function XrayCheck({ procedure: procProp, tooth: toothProp, noteText: noteProp, onResult, notify: notifyProp, embedded }) {
  const notify = typeof notifyProp === 'function' ? notifyProp : (m => alert(m))
  const [procedure, setProcedure] = useState(XRAY_PROCEDURES.some(p => p.key === procProp) ? procProp : 'rct')
  const [tooth, setTooth] = useState(toothProp || '')
  const [noteText, setNoteText] = useState(noteProp || '')
  const [items, setItems] = useState([])
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [resp, setResp] = useState(null)
  const fileRef = useRef(null)
  // Inside the Note Builder the note, procedure and tooth come from the note itself.
  useEffect(() => { if (procProp && XRAY_PROCEDURES.some(p => p.key === procProp)) setProcedure(procProp) }, [procProp])
  useEffect(() => { if (toothProp !== undefined) setTooth(toothProp || '') }, [toothProp])
  const noteForCheck = noteProp !== undefined ? noteProp : noteText

  const proc = XRAY_PROCEDURES.find(p => p.key === procedure)
  const missingRoles = proc.needs.filter(r => !items.some(i => i.role === r))

  const addFiles = useCallback(async files => {
    const list = [...files].filter(f => /^image\//.test(f.type))
    if (!list.length) { notify('Use JPEG or PNG images. Export the X-ray from Dentrix/Ascend as an image first.', 'error'); return }
    setAdding(true)
    const next = []
    for (const f of list) {
      try { next.push({ id: Math.random().toString(36).slice(2), name: f.name, role: 'other', boxes: [], ...(await prepareFile(f)) }) }
      catch (e) { notify(`${f.name}: ${e.message}`, 'error') }
    }
    setItems(prev => {
      const all = [...prev, ...next].slice(0, MAX_IMAGES)
      // Fill the roles the procedure needs, in order, for images still marked "other".
      const need = proc.needs.filter(r => !prev.some(i => i.role === r))
      return all.map(i => (next.includes(i) && i.role === 'other' && need.length) ? { ...i, role: need.shift() } : i)
    })
    if (prev_overflow(items.length + next.length)) notify(`Only ${MAX_IMAGES} images per check`, 'error')
    setResp(null); setConfirmed(false); setAdding(false)
  }, [items.length, proc, notify])

  const run = async () => {
    if (!items.length) return notify('Attach at least one image', 'error')
    if (!confirmed) return notify('Confirm that names and IDs are blacked out first', 'error')
    setLoading(true); setResp(null)
    try {
      const images = []
      for (const it of items) images.push({ role: it.role, mediaType: 'image/jpeg', data: await exportRedacted(it) })
      const r = await fetch('/api/xray-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedure, tooth, noteText: noteForCheck, images }),
      })
      const data = await r.json().catch(() => ({ ok: false, error: `Server error ${r.status}` }))
      if (!data.ok) throw new Error(data.error || 'Check failed')
      setResp(data)
      const issues = issueList(data)
      onResult?.(data.result, issues, data)
      notify(issues.some(i => i.risk === 'high' && i.status === 'fail') ? 'X-ray check found problems' : 'X-ray check done')
    } catch (e) {
      notify('X-ray check failed: ' + String(e.message).slice(0, 160), 'error')
    }
    setLoading(false)
  }

  const copyIssues = () => {
    const issues = issueList(resp)
    const text = [
      `X-ray check: ${proc.label}${tooth ? `, tooth ${tooth}` : ''}`,
      ...issues.map(i => `- [${i.risk.toUpperCase()}] ${i.label}: ${i.detail}`),
      ...(resp.result.note_mismatches || []).map(m => `- [NOTE] ${m}`),
    ].join('\n')
    navigator.clipboard?.writeText(text).then(() => notify('Copied. Paste it to the dentist.'), () => notify('Could not copy', 'error'))
  }

  const card = { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16, marginBottom: 12 }
  const lbl = { fontSize: 9, fontWeight: 800, color: '#94a3b8', letterSpacing: .5, marginBottom: 3 }
  const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, fontWeight: 600 }

  return (
    <div style={embedded ? {} : { maxWidth: 1000, margin: '0 auto', padding: '20px 16px 80px' }}>
      {!embedded && (
        <div style={{ background: `linear-gradient(135deg,${NAVY},#1d4ed8)`, borderRadius: 14, padding: '18px 24px', marginBottom: 16, color: 'white' }}>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>X-ray Claim Check</h1>
          <div style={{ fontSize: 12, opacity: .8, marginTop: 4 }}>Checks that the images on a claim are the right ones before it goes out. The dentist still reads and signs.</div>
        </div>
      )}

      {/* procedure */}
      <div style={card}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200, flex: 1 }}>
            <div style={lbl}>PROCEDURE</div>
            <select style={inp} value={procedure} onChange={e => { setProcedure(e.target.value); setResp(null) }}>
              {XRAY_PROCEDURES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <div style={{ width: 110 }}>
            <div style={lbl}>TOOTH #</div>
            <input style={inp} value={tooth} onChange={e => setTooth(e.target.value)} />
          </div>
          <div style={{ flex: 2, minWidth: 220, fontSize: 12, color: '#475569', alignSelf: 'flex-end', paddingBottom: 6 }}>
            Needs: {proc.needs.length ? proc.needs.map(r => r === 'preop' ? 'pre-op' : 'post-op').join(' + ') : 'images that support the note'}
            {procedure === 'ext_surgical' && <div style={{ color: '#b91c1c', fontWeight: 700, marginTop: 2 }}>Also needs an approved TennCare prior authorization.</div>}
          </div>
        </div>
        {noteProp === undefined && (
          <div style={{ marginTop: 12 }}>
            <div style={lbl}>CLINICAL NOTE (OPTIONAL, NO PATIENT NAME)</div>
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} rows={4} style={{ ...inp, fontWeight: 400, resize: 'vertical' }} />
          </div>
        )}
      </div>

      {/* images */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <b style={{ fontSize: 13, color: NAVY, flex: 1 }}>Images ({items.length}/{MAX_IMAGES})</b>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={adding || items.length >= MAX_IMAGES}
            style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: NAVY, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: items.length >= MAX_IMAGES ? .5 : 1 }}>
            {adding ? 'Loading…' : '+ Add X-rays'}
          </button>
        </div>
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', minHeight: 80, border: items.length ? 0 : '2px dashed #cbd5e1', borderRadius: 10,
            alignItems: items.length ? 'flex-start' : 'center', justifyContent: items.length ? 'flex-start' : 'center', color: '#94a3b8', fontSize: 13 }}>
          {items.length === 0 && 'Drop JPEG or PNG X-rays here'}
          {items.map((it, i) => (
            <ImageCard key={it.id} item={it} index={i}
              onChange={n => { setItems(prev => prev.map(x => x.id === it.id ? n : x)); setResp(null) }}
              onRemove={() => { setItems(prev => prev.filter(x => x.id !== it.id)); setResp(null) }} />
          ))}
        </div>
        {items.length > 0 && missingRoles.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, color: '#b45309' }}>
            No {missingRoles.map(r => r === 'preop' ? 'pre-op' : 'post-op').join(' or ')} image marked yet. The check will fail that item.
          </div>
        )}
      </div>

      {/* run */}
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', flex: 1, minWidth: 260, cursor: 'pointer' }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          Patient names, dates of birth and IDs on these images are blacked out
        </label>
        <button onClick={run} disabled={loading || !items.length}
          style={{ padding: '11px 22px', borderRadius: 9, border: 0, background: loading || !items.length ? '#94a3b8' : GOLD, color: '#1c1917', fontWeight: 800, fontSize: 14, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Checking…' : '🔍 Run X-ray check'}
        </button>
      </div>

      {resp && <Results resp={resp} items={items} onCopy={copyIssues} card={card} />}
    </div>
  )
}

function prev_overflow(n) { return n > MAX_IMAGES }

// Failed or unclear checks, highest risk first.
export function issueList(resp) {
  if (!resp?.result) return []
  const rules = new Map((resp.rules?.checks || []).map(c => [c.id, c]))
  const order = { high: 0, medium: 1, low: 2 }
  return resp.result.checks
    .filter(c => c.status !== 'pass')
    .map(c => ({ id: c.id, label: rules.get(c.id)?.label || c.id, risk: rules.get(c.id)?.risk || 'medium', status: c.status, detail: c.detail || '' }))
    .sort((a, b) => (order[a.risk] - order[b.risk]) || (a.status === 'fail' ? -1 : 1))
}

export function verdict(resp) {
  const issues = issueList(resp)
  if (issues.some(i => i.risk === 'high' && i.status === 'fail')) return { level: 'fail', text: 'Do not send — fix the high-risk items', bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' }
  if (issues.length || resp.result.note_mismatches?.length || resp.result.phi_visible) return { level: 'review', text: 'Review before sending', bg: '#fffbeb', fg: '#b45309', bd: '#fde68a' }
  return { level: 'pass', text: 'Images support the claim', bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' }
}

function Results({ resp, items, onCopy, card }) {
  const { result, rules } = resp
  const v = verdict(resp)
  const ruleMap = new Map(rules.checks.map(c => [c.id, c]))
  const issues = issueList(resp)
  return (
    <div style={{ ...card, border: `2px solid ${v.bd}` }}>
      <div style={{ background: v.bg, color: v.fg, borderRadius: 8, padding: '10px 14px', fontWeight: 800, fontSize: 15, marginBottom: 10 }}>{v.text}</div>
      {result.phi_visible && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Readable patient information was found on an image. Black it out and re-run before attaching anywhere.
        </div>
      )}
      <div style={{ fontSize: 13, color: '#334155', marginBottom: 12 }}>{result.summary}</div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <tbody>
          {result.checks.map(c => {
            const r = ruleMap.get(c.id) || { label: c.id, risk: 'medium' }
            return (
              <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '7px 6px', width: 24 }}>{STATUS_ICON[c.status] || '❔'}</td>
                <td style={{ padding: '7px 6px' }}>
                  <div style={{ fontWeight: 700, color: '#1e293b' }}>{r.label}</div>
                  <div style={{ color: '#64748b' }}>{c.detail}</div>
                </td>
                <td style={{ padding: '7px 6px', width: 70, textAlign: 'right' }}>
                  {c.status !== 'pass' && <span style={{ fontSize: 10, fontWeight: 800, color: RISK_COLOR[r.risk] }}>{r.risk.toUpperCase()}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {result.note_mismatches?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#b45309', marginBottom: 4 }}>IMAGES DON'T MATCH THE NOTE</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#334155' }}>{result.note_mismatches.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      {result.images?.length > 0 && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {result.images.map(im => {
            const it = items[im.index - 1] || items[im.index]
            return (
              <div key={im.index} style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, minWidth: 200, flex: 1 }}>
                <b style={{ color: NAVY }}>Image {im.index}</b>{it ? ` · uploaded as ${it.role === 'preop' ? 'pre-op' : it.role === 'postop' ? 'post-op' : 'other'}` : ''}
                <div>{TYPE_LABEL[im.image_type] || im.image_type} · looks {im.appears_to_be === 'unclear' ? 'unclear' : im.appears_to_be === 'preop' ? 'pre-op' : 'post-op'} · quality {im.quality} · apex {im.apex_visible.replace('_', ' ')}</div>
                <div style={{ color: '#64748b' }}>{im.treatment_visible}</div>
                {im.issues?.length > 0 && <div style={{ color: '#b45309' }}>{im.issues.join('; ')}</div>}
              </div>
            )
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        {issues.length > 0 && (
          <button onClick={onCopy} style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: NAVY, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            📋 Copy issues for the dentist
          </button>
        )}
        <div style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>AI claim check, not a diagnosis. The treating dentist reads the images and signs the note.</div>
      </div>
    </div>
  )
}
