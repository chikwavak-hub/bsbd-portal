// src/pages/notes/XrayCheck.jsx — X-ray claim check (Note Builder).
//
// Helps claims get PAID. Billing attaches the claim's pre-op / post-op
// images (names blacked out) and gets back SUGGESTED note statements (decay,
// loss of tooth structure, periapical status, restorability, completed
// treatment) and blank-field values for the dentist to confirm and add —
// nothing goes into the note automatically — plus a claim narrative and the
// problems found. Only a dealbreaker (required image missing, root/apex cut
// off, wrong image, unreadable) holds the claim; everything else comes with
// suggested note wording and the claim goes out.
//
// Images are resized (max 1568 px) and redacted IN THE BROWSER before upload.
// The AI gets a contrast-balanced copy (1st-99th percentile stretch) so over-
// or underexposed films still read; the measured exposure is sent alongside
// so it can be noted. The image attached to the claim is never altered.
// Nothing is saved: images live only in this screen's memory.
//
// Props
//   procedure  initial procedure key (rct, crown, ext_surgical, ext_simple, filling, srp, other)
//   tooth      initial tooth number(s)
//   noteText   the note to cross-check (optional)
//   fields     the note's still-missing blanks [{ id, label, hint }] (optional)
//   pickSchema findings-picker groups for this procedure (see lib/xrayFindings pickSchema) — the AI pre-selects them
//   picks      the current picks { key: value } so the AI can flag ones the film contradicts
//   onResult   (result, issues, resp) => void   issues = [{ id, label, hold, status, detail, fix }]
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
  { key: 'pulpotomy',    label: 'Pulpotomy',           needs: ['preop'] },
  { key: 'other',        label: 'Other',               needs: [] },
]
const ROLES = [['preop', 'Pre-op'], ['postop', 'Post-op'], ['other', 'Other']]
const MAX_EDGE = 1568
const MAX_IMAGES = 6
const SUGGEST_TOPIC = { decay: 'Decay', pulp: 'Pulp', structure: 'Tooth structure', periapical: 'Periapical', obturation: 'Obturation', restorable: 'Restorability',
  endo: 'Prior RCT', seat: 'Crown seat', roots: 'Roots', boneloss: 'Bone loss', calculus: 'Calculus', findings: 'Findings' }
const EXPOSURE_LABEL = { over: 'overexposed', under: 'underexposed', low_contrast: 'low contrast', uneven: 'uneven exposure' }

const NAVY = '#1B2A6B', GOLD = '#C9A84C'
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
// Measure exposure and stretch contrast on a canvas (in place).
// Returns 'good' | 'over' | 'under' | 'low_contrast' | 'uneven' | '' (unknown).
export function balanceExposure(ctx, w, h, boxes = []) {
  let img
  try { img = ctx.getImageData(0, 0, w, h) } catch { return '' }
  const d = img.data
  if (!d || !d.length) return ''
  const inBox = (x, y) => boxes.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
  const hist = new Uint32Array(256)   // film only: excludes the black border/background
  let n = 0, sum = 0, white = 0, black = 0, nf = 0
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)))   // sample ~250k pixels
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
    if (boxes.length && inBox(x, y)) continue
    const i = (y * w + x) * 4
    const L = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])
    n++; sum += L
    if (L >= 245) white++
    if (L <= 10) black++; else { hist[L]++; nf++ }
  }
  if (!n) return ''
  const pct = q => { let c = 0, t = nf * q; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= t) return v } return 255 }
  const lo = nf ? pct(0.01) : 0, hi = nf ? pct(0.99) : 255, mean = sum / n
  // Radiographs have a lot of black background, so "under" is judged on the
  // mid-tones, not the raw black share.
  const exposure = (white / n > 0.25 || mean > 175) ? 'over'
    : (mean < 55 && hi < 170) ? 'under'
    : (hi - lo < 110) ? 'low_contrast'
    : 'good'
  if (hi - lo >= 20 && (lo > 8 || hi < 247)) {
    const k = 255 / (hi - lo)
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, (d[i] - lo) * k))
      d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - lo) * k))
      d[i + 2] = Math.max(0, Math.min(255, (d[i + 2] - lo) * k))
    }
    try { ctx.putImageData(img, 0, 0) } catch {}
  }
  return exposure
}

// Apply black-out boxes, balance contrast for reading, return { data (base64, no prefix), exposure }.
async function exportRedacted(item) {
  const img = await loadImage(item.src)
  const c = document.createElement('canvas'); c.width = item.w; c.height = item.h
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0, item.w, item.h)
  const exposure = balanceExposure(ctx, item.w, item.h, item.boxes)
  ctx.fillStyle = '#000'
  item.boxes.forEach(b => ctx.fillRect(b.x, b.y, b.w, b.h))
  return { data: c.toDataURL('image/jpeg', 0.92).split(',')[1], exposure }
}

// ── one image card with drag-to-black-out ─────────────────────────────────
function ImageCard({ item, index, onChange, onRemove, small }) {
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
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: small ? 8 : 10, background: 'white', width: small ? 190 : 260 }}>
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
export default function XrayCheck({ procedure: procProp, tooth: toothProp, noteText: noteProp, fields, pickSchema, picks, onResult, notify: notifyProp, embedded }) {
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
      for (const it of items) { const ex = await exportRedacted(it); images.push({ role: it.role, mediaType: 'image/jpeg', data: ex.data, exposure: ex.exposure }) }
      const r = await fetch('/api/xray-check', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ procedure, tooth, noteText: noteForCheck, images,
          fields: (Array.isArray(fields) ? fields : []).map(f => ({ id: f.id, label: f.label || '', hint: f.hint || '' })),
          pickSchema: Array.isArray(pickSchema) ? pickSchema : [], picks: picks || {} }),
      })
      const data = await r.json().catch(() => ({ ok: false, error: `Server error ${r.status}` }))
      if (!data.ok) throw new Error(data.error || 'Check failed')
      setResp(data)
      const issues = issueList(data)
      onResult?.(data.result, issues, data)
      notify(verdict(data).level === 'hold' ? 'X-ray check: hold this claim, see the red items' : 'X-ray check done')
    } catch (e) {
      notify('X-ray check failed: ' + String(e.message).slice(0, 160), 'error')
    }
    setLoading(false)
  }

  const copyIssues = () => {
    navigator.clipboard?.writeText(issuesText(resp, `${proc.label}${tooth ? `, tooth ${tooth}` : ''}`))
      .then(() => notify('Copied. Paste it to the dentist.'), () => notify('Could not copy', 'error'))
  }

  // Inside the Note Builder (embedded) the parent box already frames this, so cards are flat.
  const card = embedded ? { padding: '4px 0', marginBottom: 8 } : { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: 16, marginBottom: 12 }
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

      {/* procedure (the Note Builder already knows it) */}
      {!embedded && <div style={card}>
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
      </div>}

      {/* images */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <b style={{ fontSize: 13, color: NAVY, flex: 1 }}>{embedded ? `X-rays${items.length ? ` (${items.length})` : ''}` : `Images (${items.length}/${MAX_IMAGES})`}</b>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple style={{ display: 'none' }}
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
          <button onClick={() => fileRef.current?.click()} disabled={adding || items.length >= MAX_IMAGES}
            style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: NAVY, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: items.length >= MAX_IMAGES ? .5 : 1 }}>
            {adding ? 'Loading…' : '+ Add X-rays'}
          </button>
        </div>
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }}
          style={{ display: 'flex', gap: 10, flexWrap: 'wrap', minHeight: embedded ? 56 : 80, border: items.length ? 0 : '2px dashed #cbd5e1', borderRadius: 10,
            alignItems: items.length ? 'flex-start' : 'center', justifyContent: items.length ? 'flex-start' : 'center', color: '#94a3b8', fontSize: 13 }}>
          {items.length === 0 && 'Drop JPEG or PNG X-rays here'}
          {items.map((it, i) => (
            <ImageCard key={it.id} item={it} index={i} small={embedded}
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
      {(!embedded || items.length > 0) && <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', flex: 1, minWidth: 260, cursor: 'pointer' }}>
          <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
          Patient names, dates of birth and IDs on these images are blacked out
        </label>
        <button onClick={run} disabled={loading || !items.length}
          style={{ padding: '11px 22px', borderRadius: 9, border: 0, background: loading || !items.length ? '#94a3b8' : GOLD, color: '#1c1917', fontWeight: 800, fontSize: 14, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Reading…' : embedded ? 'Run AI read' : '🔍 Run X-ray check'}
        </button>
      </div>}

      {resp && (embedded
        ? <CompactResults resp={resp} items={items} />
        : <Results resp={resp} items={items} onCopy={copyIssues} card={card} notify={notify} />)}
    </div>
  )
}

function prev_overflow(n) { return n > MAX_IMAGES }

// Failed or unclear checks: dealbreakers first, then the rest.
export function issueList(resp) {
  if (!resp?.result) return []
  const rules = new Map((resp.rules?.checks || []).map(c => [c.id, c]))
  return resp.result.checks
    .filter(c => c.status !== 'pass')
    .map(c => ({ id: c.id, label: rules.get(c.id)?.label || c.id, hold: !!rules.get(c.id)?.hold && c.status === 'fail',
      status: c.status, detail: c.detail || '', fix: c.fix || '' }))
    .sort((a, b) => (b.hold - a.hold) || (a.status === 'fail' ? -1 : 1))
}

// hold   = a dealbreaker failed: fix before sending
// send   = send it, with the X-ray findings added to the note
// pass   = nothing to fix
export function verdict(resp) {
  const issues = issueList(resp)
  if (issues.some(i => i.hold)) return { level: 'hold', text: 'Hold — fix the red item before sending', bg: '#fef2f2', fg: '#b91c1c', bd: '#fecaca' }
  if (issues.length || resp.result.note_mismatches?.length) return { level: 'send', text: 'OK to send once the dentist adds the suggested statements', bg: '#eff6ff', fg: '#1d4ed8', bd: '#bfdbfe' }
  return { level: 'pass', text: 'Images support the claim — OK to send', bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' }
}

export function issuesText(resp, title) {
  return [
    `X-ray check${title ? `: ${title}` : ''}`,
    ...issueList(resp).map(i => `- ${i.hold ? '[HOLD] ' : ''}${i.label}: ${i.detail}${i.fix ? ` Fix: ${i.fix}` : ''}`),
    ...(resp.result.note_mismatches || []).map(m => `- Images vs note: ${m}`),
  ].join('\n')
}

function CopyBox({ title, text, notify, hint }) {
  if (!text) return null
  return (
    <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <b style={{ fontSize: 11, letterSpacing: .5, color: NAVY, flex: 1 }}>{title}</b>
        <button onClick={() => navigator.clipboard?.writeText(text).then(() => notify('Copied'), () => notify('Could not copy', 'error'))}
          style={{ border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#334155' }}>Copy</button>
      </div>
      <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap' }}>{text}</div>
      {hint && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

// Embedded (Note Builder): one line of verdict; details folded away. The Note
// Builder shows the summary, narrative and suggested values itself.
function CompactResults({ resp, items }) {
  const { result, rules } = resp
  const v = verdict(resp)
  const ruleMap = new Map(rules.checks.map(c => [c.id, c]))
  const notPass = result.checks.filter(c => c.status !== 'pass')
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ background: v.bg, color: v.fg, borderRadius: 99, padding: '3px 10px', fontWeight: 700, fontSize: 12 }}>{v.text}</span>
        {result.phi_visible && <span style={{ color: '#b91c1c', fontSize: 12, fontWeight: 700 }}>Readable patient info on an image — black it out.</span>}
      </div>
      <details style={{ marginTop: 6 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b' }}>All {result.checks.length} checks{notPass.length ? ` · ${notPass.length} to note` : ''}</summary>
        <div style={{ marginTop: 6 }}>
          {result.checks.map(c => {
            const r = ruleMap.get(c.id) || { label: c.id }
            const hold = r.hold && c.status === 'fail'
            return (
              <div key={c.id} style={{ display: 'flex', gap: 6, fontSize: 12.5, padding: '3px 0', color: hold ? '#b91c1c' : '#334155' }}>
                <span>{hold ? '⛔' : c.status === 'pass' ? '✓' : '•'}</span>
                <span><b>{r.label}</b>{c.status !== 'pass' && c.detail ? ` — ${c.detail}` : ''}</span>
              </div>
            )
          })}
          {result.images?.length > 0 && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              {result.images.map(im => `Image ${im.index}: ${TYPE_LABEL[im.image_type] || im.image_type}${EXPOSURE_LABEL[im.exposure] ? `, ${EXPOSURE_LABEL[im.exposure]}` : ''}${im.apex_visible === 'no' || im.apex_visible === 'partial' ? `, apex ${im.apex_visible === 'no' ? 'cut off' : 'partly cut off'}` : ''}`).join(' · ')}
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

function Results({ resp, items, onCopy, card, notify }) {
  const { result, rules } = resp
  const v = verdict(resp)
  const ruleMap = new Map(rules.checks.map(c => [c.id, c]))
  const issues = issueList(resp)
  const order = { fail: 0, unclear: 1, pass: 2 }
  const rows = [...result.checks].sort((a, b) => {
    const ha = ruleMap.get(a.id)?.hold && a.status === 'fail', hb = ruleMap.get(b.id)?.hold && b.status === 'fail'
    return (hb - ha) || (order[a.status] - order[b.status])
  })
  return (
    <div style={{ ...card, border: `2px solid ${v.bd}` }}>
      <div style={{ background: v.bg, color: v.fg, borderRadius: 8, padding: '10px 14px', fontWeight: 800, fontSize: 15, marginBottom: 10 }}>{v.text}</div>
      {result.phi_visible && (
        <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
          Readable patient information was found on an image. Black it out before attaching the image to the claim.
        </div>
      )}
      {result.summary && <div style={{ fontSize: 13, color: '#334155', marginBottom: 12 }}>{result.summary}</div>}

      {result.suggestions?.length > 0 && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <b style={{ fontSize: 11, letterSpacing: .5, color: NAVY, flex: 1 }}>SUGGESTED NOTE STATEMENTS — DENTIST CONFIRMS AND ADDS</b>
            <button onClick={() => navigator.clipboard?.writeText(result.findings_note).then(() => notify('Copied all'), () => notify('Could not copy', 'error'))}
              style={{ border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#334155' }}>Copy all</button>
          </div>
          {result.suggestions.map(x => (
            <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 0', borderTop: '1px solid #eef2f7' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: x.section === 'A' ? '#7c3aed' : '#0d9488', minWidth: 74, paddingTop: 2 }}>{(SUGGEST_TOPIC[x.topic] || x.topic).toUpperCase()}</span>
              <div style={{ flex: 1, fontSize: 13, color: '#1e293b' }}>{x.text}{x.basis && <span style={{ color: '#94a3b8' }}> · {x.basis}</span>}</div>
              <button onClick={() => navigator.clipboard?.writeText(x.text).then(() => notify('Copied'), () => notify('Could not copy', 'error'))}
                style={{ border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: '#334155' }}>Copy</button>
            </div>
          ))}
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Written from the images only. Nothing is added to the note until the dentist confirms it.</div>
        </div>
      )}
      <CopyBox title="CLAIM NARRATIVE" text={result.claim_narrative} notify={notify}
        hint={`${(result.claim_narrative || '').length}/400 characters. Paste into the claim's narrative box.`} />

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <tbody>
          {rows.map(c => {
            const r = ruleMap.get(c.id) || { label: c.id }
            const hold = r.hold && c.status === 'fail'
            return (
              <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: hold ? '#fef2f2' : 'transparent' }}>
                <td style={{ padding: '7px 6px', width: 24, verticalAlign: 'top' }}>{hold ? '⛔' : c.status === 'pass' ? '✅' : '📝'}</td>
                <td style={{ padding: '7px 6px' }}>
                  <div style={{ fontWeight: 700, color: hold ? '#b91c1c' : '#1e293b' }}>{r.label}</div>
                  <div style={{ color: '#64748b' }}>{c.detail}</div>
                  {c.status !== 'pass' && c.fix && <div style={{ color: hold ? '#b91c1c' : '#1d4ed8', marginTop: 2 }}><b>{hold ? 'Fix:' : 'Covered in note:'}</b> {c.fix}</div>}
                </td>
                <td style={{ padding: '7px 6px', width: 80, textAlign: 'right', verticalAlign: 'top' }}>
                  {hold ? <span style={{ fontSize: 10, fontWeight: 800, color: '#b91c1c' }}>HOLD</span>
                    : c.status !== 'pass' ? <span style={{ fontSize: 10, fontWeight: 800, color: '#64748b' }}>NOTE IT</span> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {result.note_mismatches?.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#b45309', marginBottom: 4 }}>IMAGES DON'T MATCH THE NOTE — CORRECT ONE OR THE OTHER</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: '#334155' }}>{result.note_mismatches.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      {result.images?.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: NAVY }}>What each image shows</summary>
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {result.images.map(im => {
              const it = items[im.index - 1] || items[im.index]
              return (
                <div key={im.index} style={{ background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, minWidth: 200, flex: 1 }}>
                  <b style={{ color: NAVY }}>Image {im.index}</b>{it ? ` · uploaded as ${it.role === 'preop' ? 'pre-op' : it.role === 'postop' ? 'post-op' : 'other'}` : ''}
                  <div>{TYPE_LABEL[im.image_type] || im.image_type} · looks {im.appears_to_be === 'unclear' ? 'unclear' : im.appears_to_be === 'preop' ? 'pre-op' : 'post-op'} · readable: {im.quality === 'poor' ? 'no' : 'yes'}{EXPOSURE_LABEL[im.exposure] ? ` (${EXPOSURE_LABEL[im.exposure]})` : ''} · apex {String(im.apex_visible || '').replace('_', ' ')}</div>
                  {im.treatment_visible && <div style={{ color: '#64748b' }}>{im.treatment_visible}</div>}
                  {im.issues?.length > 0 && <div style={{ color: '#b45309' }}>{im.issues.join('; ')}</div>}
                </div>
              )
            })}
          </div>
        </details>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
        {issues.length > 0 && (
          <button onClick={onCopy} style={{ padding: '9px 16px', borderRadius: 8, border: 0, background: NAVY, color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            📋 Copy issues for the dentist
          </button>
        )}
        <div style={{ fontSize: 11, color: '#94a3b8', flex: 1 }}>Written from the images only. The treating dentist confirms the findings and signs the note.</div>
      </div>
    </div>
  )
}
