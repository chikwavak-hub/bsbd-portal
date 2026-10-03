// src/pages/notes/NoteBuilder.jsx
// Note Builder: rebuilds an Ascend note into the BSBD template for its procedure
// ("Clinical Notes That Hold Up" v1.3). Staff upload the note plus supporting
// records (exam note, radiograph reading, perio chart, anesthetic log...).
// Claude fills each blank only from those records; anything missing is listed
// with where to find it, and staff upload that record or type the value.
// Old (signed) notes are handled as addenda per Part 7 of the guide.
//
// Nothing here is saved to Supabase. Text is scrubbed of patient identifiers
// in the browser before it is sent. Screenshots and PDFs cannot be scrubbed.
//
// Props: goHome(), notify(message, type?)
// Needs: npm install mammoth   (reads .docx uploads)
// Calls: /api/note-builder     (netlify/edge-functions/note-builder.js)

import { useEffect, useMemo, useRef, useState } from 'react'
import { NOTE_TEMPLATES, NOTE_DOC_TYPES, NOTE_SOURCES } from '../../lib/noteTemplates'

const C = {
  navy: '#1B2A6B', gold: '#C9A84C', teal: '#2A7A8C', ink: '#1F2433', muted: '#5E6577',
  line: '#DDE1EA', bg: '#F6F7FB', chip: '#EEF1F8', miss: '#B42318', missBg: '#FDECEA',
  ok: '#1E7A46', okBg: '#E8F4EC', warn: '#7A5A12', warnBg: '#FBF5E6',
}
const S = {
  page: { background: C.bg, minHeight: '100vh', fontFamily: 'Arial, Helvetica, sans-serif', color: C.ink },
  head: { background: C.navy, color: '#fff', padding: '18px 24px' },
  wrap: { maxWidth: 1200, margin: '0 auto', padding: 20 },
  card: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: 18, marginBottom: 18 },
  h2: { margin: '0 0 4px', fontSize: 18, color: C.navy, display: 'flex', gap: 10, alignItems: 'center' },
  num: { display: 'inline-flex', width: 26, height: 26, borderRadius: '50%', background: C.gold, color: C.navy, fontSize: 14, fontWeight: 700, alignItems: 'center', justifyContent: 'center' },
  sub: { color: C.muted, margin: '0 0 14px', fontSize: 14 },
  label: { display: 'flex', flexDirection: 'column', gap: 5, fontSize: 13, color: C.muted, fontWeight: 700 },
  input: { font: 'inherit', fontSize: 14, color: C.ink, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 7, padding: '8px 10px' },
  area: { width: '100%', minHeight: 130, resize: 'vertical', fontFamily: '"Courier New", monospace', fontSize: 13, border: `1px solid ${C.line}`, borderRadius: 7, padding: 10, boxSizing: 'border-box', marginTop: 8 },
  btn: { font: 'inherit', fontWeight: 700, fontSize: 14, borderRadius: 8, padding: '10px 16px', cursor: 'pointer', border: `1px solid ${C.navy}`, background: C.navy, color: '#fff' },
  ghost: { font: 'inherit', fontWeight: 700, fontSize: 14, borderRadius: 8, padding: '10px 16px', cursor: 'pointer', border: `1px solid ${C.navy}`, background: '#fff', color: C.navy },
  link: { background: 'none', border: 0, color: C.teal, font: 'inherit', fontSize: 14, cursor: 'pointer', padding: 0, textDecoration: 'underline' },
  small: { fontSize: 13, color: C.muted },
  tag: (bg, fg) => ({ fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '2px 8px', background: bg, color: fg }),
  note: { fontFamily: '"Courier New", monospace', fontSize: 13, lineHeight: 1.55, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 9, padding: 14, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' },
}

// ---------- helpers
const today = () => new Date().toLocaleDateString('en-US')

function scrub(text) {
  let n = 0
  const LBL = /^\s*(patient(\s*name)?|pt\.?\s*name|name|dob|d\.o\.b\.?|date of birth|birth\s*date|birthdate|ssn|social security( number)?|address|addr\.?|street|city\/state|phone|cell|home phone|mobile|email|e-mail|member\s*id|subscriber\s*id|medicaid\s*(id|#|no\.?)|insured|guarantor|responsible party|chart\s*(#|no\.?|number)|acct\.?\s*(#|no\.?)?|account\s*(#|no\.?|number)?)\s*[:#\-]/i
  let t = String(text || '').split(/\r?\n/).map(l => { if (LBL.test(l)) { n++; return '[identifier removed]' } return l }).join('\n')
  const reps = [
    [/\b(DOB|D\.O\.B\.|Date of Birth|Birthdate)\s*[:\-]?\s*\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}/gi, '[DOB removed]'],
    [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN removed]'],
    [/\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b/g, '[phone removed]'],
    [/[\w.+\-]+@[\w\-]+\.[\w.\-]+/g, '[email removed]'],
  ]
  reps.forEach(([re, rp]) => { t = t.replace(re, () => { n++; return rp }) })
  return { text: t, removed: n }
}

// Turns template lines into {lines, fields} for filling by hand (no AI).
function localParse(lines) {
  const out = [], fields = []
  let sec = '', k = 0
  lines.forEach(L => {
    if (/^[SOAP]$/.test(L.trim())) { sec = L.trim(); return }
    let res = '', i = 0
    while (i < L.length) {
      const c = L[i]
      if (c === '[' || c === '{') {
        let dep = 0, j = i
        for (; j < L.length; j++) {
          if (L[j] === '[' || L[j] === '{') dep++
          if (L[j] === ']' || L[j] === '}') { dep--; if (dep === 0) break }
        }
        const inner = L.slice(i + 1, j).trim()
        const id = 'm' + (++k)
        const last = res.split(/\{\{\w+\}\}/).pop().replace(/[^A-Za-z0-9#/ ]/g, ' ').trim()
        const ctx = last.split(/\s+/).filter(Boolean).slice(-3).join(' ')
        const short = inner.length > 55 ? inner.slice(0, 52) + '…' : inner
        const f = { id, sec, label: (!inner || inner === '/') ? (ctx || 'Fill in') : ((ctx ? ctx + ' — ' : '') + short), value: null, status: 'missing' }
        if (c === '{' && inner.includes('/') && !inner.includes('[')) f.options = inner.split('/').map(s => s.trim()).filter(Boolean)
        fields.push(f); res += `{{${id}}}`; i = j + 1
      } else { res += c; i++ }
    }
    out.push({ section: sec, text: res })
  })
  return { lines: out, fields, warnings: [] }
}

function buildPrompt(section, tpl, mode, records, confirmed) {
  const addendum = mode === 'addendum'
  return `You are helping a Tennessee dental office (TennCare, reviewed by Renaissance) rewrite a clinical note into the office's required template.

PROCEDURE: ${section.section}
TEMPLATE: ${tpl.name}
NOTE TYPE: ${addendum ? `ADDENDUM to an already-signed note. The original note is never edited. The addendum is dated today (${today()}) and may only contain facts that were recorded at the time of service in some record (film, anesthetic log, exam note, lab slip, consent form). Anything not recorded anywhere must stay missing, and say so in a warning.` : 'New note for the visit described in the records.'}

TEMPLATE LINES (single letters S, O, A, P are section headers; square brackets [ ] are blanks; curly braces {a / b} are choices, keep one):
${tpl.lines.map(l => '  ' + l).join('\n')}

WHAT THE NOTE AND CLAIM MUST CONTAIN: ${section.what}
DENIAL TRAPS: ${section.traps.join(' | ')}
OFFICE RULES: tooth number and surfaces on every treatment line; diagnosis before treatment with the tests or findings behind it; name each film (type, date, what it shows); anesthesia with agent, concentration and vasoconstrictor, number of 1.7 mL carpules, total mg (lidocaine 2% = 34 mg/carp, articaine 4% = 68 mg/carp, mepivacaine 3% = 51 mg/carp, bupivacaine 0.5% = 8.5 mg/carp) and technique; real material names with concentrations (sodium hypochlorite NaOCl %, chlorhexidine 2%; "NaCl2" and "Chlorx" are wrong); consent with risks, benefits, alternatives incl. no treatment; outcome; next visit; rendering provider's full credentialed name (staff initials are not a provider signature). D7210 from Oct 1, 2026 needs prior authorization unless an emergency. RCT claims are on pre-payment review. SDF D1354: max 4 teeth/visit, 2 per tooth lifetime, 2nd at least 2 months after 1st, no filling same visit or for 6 months. D2991: max 4/day, not on a tooth filled in past 12 months, no filling for 6 months.

RECORDS (identifiers already removed; screenshots and PDFs are attached in the order listed):
${records.map((d, i) => `--- RECORD ${i + 1}: ${d.type}${d.attached ? ` (${d.attached} attached)` : ''} ---\n${d.text || '(see attachment)'}`).join('\n\n')}
${confirmed.length ? '\nVALUES CONFIRMED BY STAFF (use these exactly, they override the records):\n' + confirmed.map(c => `- ${c.label}: ${c.value}${c.source ? ` (source: ${c.source})` : ''}`).join('\n') : ''}

TASK: Rebuild the template line by line. Keep each template line's wording; replace every blank or choice with a field token {{f1}}, {{f2}}, ... Fill a field ONLY with information stated in the records or confirmed values. Never invent, assume or "typical" a clinical finding, test result, amount, material or date. If something isn't in the records, the field is missing. If two records conflict, leave it missing and add a warning. Convert shorthand to correct wording only when the meaning is certain (e.g. "Chlorx" -> chlorhexidine, but leave concentration missing unless stated); compute anesthetic mg from carpule counts. Never write patient names or identifiers; if any appear in an attachment, leave them out. ${addendum ? `Start the lines with: "Addendum to note of {{orig_date}}. Entered ${today()}." and "Reason: documentation completed from records made at the time of service." Use field id orig_date for the original date of service.` : ''}
A whole line may be marked "omit": true only when the template line itself is optional and the records show it does not apply. For choice fields include "options" (the template's choices).
For each missing field, say where staff would most likely find it ("look_in", one of: ${NOTE_DOC_TYPES.slice(1).join(', ')}, Provider) and why the reviewer needs it (short).
Warnings: list every problem a TennCare reviewer would catch in the ORIGINAL records (wrong code for what's written, missing pre-op film, missing prior auth for D7210, shorthand, copy-forward text, missing signature, limits exceeded, etc.). Plain, short sentences.

Reply with ONLY this JSON, no markdown:
{"lines":[{"section":"S","text":"CC: \\"{{f1}}\\". Med hx ...","omit":false}],
 "fields":[{"id":"f1","label":"Chief complaint","value":"string or null","status":"found|missing","source":"which record, e.g. Ascend note","evidence":"short quote from the record, max 12 words","options":["only for choices"],"look_in":"Exam note","why":"short"}],
 "warnings":["..."]}`
}

async function callBuilder(payload, onProgress, signal) {
  const res = await fetch('/api/note-builder', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal,
  })
  if (!res.ok) {
    let msg = `Request failed (${res.status})`
    try { const j = await res.json(); msg = j.error || msg } catch { /* keep */ }
    throw new Error(msg)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = '', text = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const events = buf.split('\n\n'); buf = events.pop()
    for (const ev of events) {
      const line = ev.split('\n').find(l => l.startsWith('data:'))
      if (!line) continue
      let data; try { data = JSON.parse(line.slice(5).trim()) } catch { continue }
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') { text += data.delta.text; onProgress?.(text.length) }
      if (data.type === 'error') throw new Error(data.error?.message || 'Claude returned an error')
    }
  }
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('The answer came back in the wrong shape. Try again.')
  const out = JSON.parse(text.slice(a, b + 1))
  if (!Array.isArray(out.lines) || !Array.isArray(out.fields)) throw new Error('The answer came back in the wrong shape. Try again.')
  return out
}

const fileToBase64 = f => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1])
  r.onerror = () => reject(new Error('Could not read file'))
  r.readAsDataURL(f)
})

// ---------- component
let uid = 0
const newDoc = type => ({ id: ++uid, type, text: '', name: '', file: null, kind: 'text', preview: '' })

export default function NoteBuilder({ goHome, notify }) {
  const [proc, setProc] = useState(7) // Root canal therapy first: the procedure that started this
  const [tplIdx, setTplIdx] = useState(0)
  const [mode, setMode] = useState('new')
  const [docs, setDocs] = useState([newDoc(NOTE_DOC_TYPES[0])])
  const [result, setResult] = useState(null)
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ text: '', err: false })
  const step3 = useRef(null)
  const abortRef = useRef(null)
  const docRefs = useRef({})

  const section = NOTE_TEMPLATES[proc]
  const tpl = section.templates[tplIdx] || section.templates[0]
  const say = (m, type) => (notify ? notify(m, type) : null)

  useEffect(() => () => abortRef.current?.abort(), [])

  // ----- documents
  const updateDoc = (id, patch) => setDocs(ds => ds.map(d => (d.id === id ? { ...d, ...patch } : d)))
  const addDoc = type => {
    const d = newDoc(type || NOTE_DOC_TYPES[1])
    setDocs(ds => [...ds, d])
    setTimeout(() => docRefs.current[d.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
  }
  const readFile = async (doc, f) => {
    if (!f) return
    const n = f.name.toLowerCase()
    try {
      if (f.type.startsWith('image/')) {
        updateDoc(doc.id, { name: f.name, file: f, kind: 'image', preview: URL.createObjectURL(f) })
      } else if (n.endsWith('.pdf')) {
        updateDoc(doc.id, { name: f.name, file: f, kind: 'pdf', preview: '' })
      } else if (n.endsWith('.docx')) {
        const mammoth = await import('mammoth')
        const r = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })
        updateDoc(doc.id, { name: f.name, text: r.value, file: null, kind: 'text', preview: '' })
      } else {
        updateDoc(doc.id, { name: f.name, text: await f.text(), file: null, kind: 'text', preview: '' })
      }
    } catch (e) {
      say(`Could not read ${f.name}. Paste the text instead.`, 'error')
    }
  }

  // ----- build
  const build = async (confirmed = []) => {
    const usable = docs.filter(d => d.text.trim() || d.file)
    if (!usable.length) { setStatus({ text: 'Paste or upload the Ascend note first.', err: true }); return }
    let removed = 0
    const images = [], pdfs = []
    try {
      for (const d of usable) {
        if (d.kind === 'image') images.push({ media_type: d.file.type || 'image/png', data: await fileToBase64(d.file) })
        if (d.kind === 'pdf') pdfs.push(await fileToBase64(d.file))
      }
    } catch { setStatus({ text: 'Could not read one of the attachments.', err: true }); return }
    const records = usable.map(d => {
      const r = scrub(d.text); removed += r.removed
      return { type: d.type, text: r.text, attached: d.kind === 'image' ? 'screenshot' : d.kind === 'pdf' ? 'PDF' : '' }
    })
    setBusy(true)
    setStatus({ text: `${removed ? `${removed} identifier${removed > 1 ? 's' : ''} removed. ` : ''}Reading the records and filling the template. This usually takes 20 to 60 seconds…`, err: false })
    const ctl = new AbortController(); abortRef.current = ctl
    try {
      const out = await callBuilder(
        { prompt: buildPrompt(section, tpl, mode, records, confirmed), images, pdfs },
        chars => setStatus(s => ({ ...s, text: `Writing the note… (${Math.round(chars / 100) / 10}k characters)` })),
        ctl.signal,
      )
      const v = {}
      out.fields.forEach(f => { v[f.id] = { value: f.value ? String(f.value) : '', source: f.value ? (f.source || '') : '', user: false } })
      setResult(out); setVals(v)
      setStatus({ text: `${removed ? `${removed} identifier${removed > 1 ? 's were' : ' was'} removed before sending. ` : ''}Done. Review below.`, err: false })
      setTimeout(() => step3.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (e) {
      if (e.name === 'AbortError') setStatus({ text: 'Stopped.', err: false })
      else setStatus({ text: `${e.message || 'Something went wrong'}. Try again, or fill the template by hand.`, err: true })
    } finally { setBusy(false); abortRef.current = null }
  }

  const rerun = () => {
    const confirmed = (result?.fields || [])
      .map(f => ({ f, v: vals[f.id] }))
      .filter(({ v }) => v?.user && v.value.trim())
      .map(({ f, v }) => ({ label: f.label, value: v.value.trim(), source: v.source }))
    build(confirmed)
  }

  const blank = () => {
    const r = localParse(tpl.lines)
    if (mode === 'addendum') {
      r.lines.unshift({ section: '', text: 'Reason: documentation completed from records made at the time of service.' })
      r.lines.unshift({ section: '', text: `Addendum to note of {{orig_date}}. Entered ${today()}.` })
      r.fields.unshift({ id: 'orig_date', label: 'Original date of service', status: 'missing', value: null })
    }
    const v = {}; r.fields.forEach(f => { v[f.id] = { value: '', source: '', user: false } })
    setResult(r); setVals(v)
    setTimeout(() => step3.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  const reset = () => { setResult(null); setVals({}); setDocs([newDoc(NOTE_DOC_TYPES[0])]); setStatus({ text: '', err: false }) }

  // ----- derived
  const setVal = (id, patch) => setVals(v => ({ ...v, [id]: { ...v[id], ...patch } }))
  const stateOf = f => { const v = vals[f.id]; if (!v || !v.value.trim()) return 'missing'; return v.user ? 'entered' : 'found' }
  const labelOf = id => result?.fields.find(x => x.id === id)?.label || id
  const missing = useMemo(() => (result ? result.fields.filter(f => stateOf(f) === 'missing') : []), [result, vals])
  const filledCount = result ? result.fields.length - missing.length : 0

  const warnings = useMemo(() => {
    if (!result) return []
    const w = [...(result.warnings || [])]
    if (mode === 'addendum') {
      const bad = result.fields.filter(f => { const v = vals[f.id]; return v?.user && v.value.trim() && !v.source })
      if (bad.length) w.unshift(`Addendum entries need a source record: ${bad.map(f => f.label).join(', ')}.`)
      const today_ = result.fields.filter(f => vals[f.id]?.source === 'Entered by provider today')
      if (today_.length) w.unshift(`An addendum can't use values entered today from memory: ${today_.map(f => f.label).join(', ')}.`)
    }
    return w
  }, [result, vals, mode])

  const noteText = () => {
    if (!result) return ''
    const out = []; let sec = null
    result.lines.filter(l => !l.omit).forEach(l => {
      if (l.section && l.section !== sec) { sec = l.section; out.push(sec) }
      out.push(l.text.replace(/\{\{(\w+)\}\}/g, (m, id) => { const v = vals[id]; return v?.value.trim() ? v.value.trim() : `[MISSING: ${labelOf(id)}]` }))
    })
    return out.join('\n')
  }

  const copy = async () => {
    const t = noteText()
    try { await navigator.clipboard.writeText(t); say('Note copied. Paste it into Ascend.') }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); say('Note copied. Paste it into Ascend.') } catch { say('Copy was blocked. Select the preview and copy it.', 'error') }
      ta.remove()
    }
  }
  const download = () => {
    const blob = new Blob([noteText()], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${tpl.name.replace(/[^\w]+/g, '_')}_note.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // ----- render pieces
  const groups = {}
  missing.forEach(f => { const k = f.look_in || 'Provider'; (groups[k] = groups[k] || []).push(f.label) })
  const ordered = result ? [...missing, ...result.fields.filter(f => stateOf(f) !== 'missing')] : []

  return (
    <div style={S.page}>
      <div style={S.head}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>Clinical notes · Tennessee offices</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>Note Builder</div>
            <div style={{ color: '#D6DDF0', fontSize: 14, maxWidth: 720 }}>Turn an Ascend note into one that holds up to TennCare review. Upload the note and the records behind it, then fill whatever they don't show.</div>
          </div>
          {goHome && <button style={{ ...S.ghost, background: 'transparent', color: '#fff', borderColor: '#fff' }} onClick={goHome}>Back to modules</button>}
        </div>
      </div>

      <div style={S.wrap}>
        {/* STEP 1 */}
        <div style={S.card}>
          <h2 style={S.h2}><span style={S.num}>1</span>Procedure and note type</h2>
          <p style={S.sub}>Templates from Clinical Notes That Hold Up, v1.3.</p>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={S.label}>Procedure
              <select style={{ ...S.input, minWidth: 320 }} value={proc} onChange={e => { setProc(+e.target.value); setTplIdx(0); setResult(null) }}>
                {NOTE_TEMPLATES.map((s, i) => <option key={i} value={i}>{s.section}</option>)}
              </select>
            </label>
            {section.templates.length > 1 && (
              <label style={S.label}>Template
                <select style={S.input} value={tplIdx} onChange={e => { setTplIdx(+e.target.value); setResult(null) }}>
                  {section.templates.map((t, i) => <option key={i} value={i}>{t.name}</option>)}
                </select>
              </label>
            )}
            <div style={S.label}>This note is
              <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                {[['new', "A note for today's visit"], ['addendum', 'An addendum to a signed note']].map(([k, t]) => (
                  <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k}
                    style={{ border: 0, padding: '9px 14px', font: 'inherit', fontSize: 14, cursor: 'pointer', background: mode === k ? C.navy : '#fff', color: mode === k ? '#fff' : C.ink }}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14, background: C.chip, borderRadius: 8, padding: '12px 14px', fontSize: 14 }}>
            <b style={{ color: C.navy }}>What this note and claim must contain</b>
            <div>{section.what}</div>
            {section.traps.length > 0 && <>
              <b style={{ color: C.navy, display: 'block', marginTop: 8 }}>Denial traps</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{section.traps.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>}
          </div>
          {mode === 'addendum' && (
            <p style={{ ...S.small, marginTop: 10 }}><b>Addendum rules (Part 7):</b> never edit the signed note. The addendum is dated today and can only add what was recorded at the time somewhere else: the film, the anesthetic log, the exam note, the lab slip. Anything nobody recorded stays out.</p>
          )}
        </div>

        {/* STEP 2 */}
        <div style={S.card}>
          <h2 style={S.h2}><span style={S.num}>2</span>Upload the note and supporting records</h2>
          <p style={S.sub}>Paste text from Ascend, or upload a .txt, .docx, .pdf or screenshot. Add the exam note, radiograph reading, perio chart or anesthetic log if the main note is thin.</p>
          {docs.map((d, i) => (
            <div key={d.id} ref={el => { docRefs.current[d.id] = el }} style={{ border: `1px solid ${C.line}`, borderRadius: 9, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <select style={{ ...S.input, minWidth: 220 }} value={d.type} onChange={e => updateDoc(d.id, { type: e.target.value })}>
                  {NOTE_DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                <input type="file" accept=".txt,.docx,.pdf,image/*,.md" onChange={e => readFile(d, e.target.files[0])} />
                {d.name && <span style={S.small}>Loaded: {d.name}</span>}
                {i > 0 && <button style={S.link} onClick={() => setDocs(ds => ds.filter(x => x.id !== d.id))}>Remove</button>}
              </div>
              {d.preview && <img src={d.preview} alt="Uploaded screenshot" style={{ maxHeight: 90, borderRadius: 6, border: `1px solid ${C.line}` }} />}
              {d.kind === 'pdf' && <div style={S.small}>PDF attached. It goes to Claude as is, so remove patient identifiers from it first.</div>}
              <textarea style={S.area} value={d.text} onChange={e => updateDoc(d.id, { text: e.target.value })}
                placeholder={d.kind !== 'text' ? 'Attachment added. Add any notes here (optional).' : `Paste the ${d.type.toLowerCase()} here`} />
            </div>
          ))}
          <button style={{ ...S.ghost, padding: '6px 12px', fontSize: 13 }} onClick={() => addDoc()}>Add a supporting record</button>
          <p style={{ ...S.small, marginTop: 10 }}>Patient name, date of birth, address, phone, email, member ID and SSN lines are removed on this page before any text goes to Claude. Screenshots and PDFs can't be scrubbed, so crop or black out identifiers first. Nothing on this page is saved.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => build()}>{busy ? 'Working…' : 'Build the note'}</button>
            {busy && <button style={S.ghost} onClick={() => abortRef.current?.abort()}>Stop</button>}
            {!busy && <button style={S.ghost} onClick={blank}>Fill the template by hand</button>}
            {busy && <span className="spinner" />}
          </div>
          {status.text && <div style={{ marginTop: 12, fontSize: 14, color: status.err ? C.miss : C.ink }}>{status.text}</div>}
        </div>

        {/* STEP 3 */}
        {result && (
          <div style={S.card} ref={step3}>
            <h2 style={S.h2}><span style={S.num}>3</span>Fill the gaps and copy into Ascend</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18, marginTop: 10 }}>
              <div>
                <b>{filledCount} of {result.fields.length} blanks filled</b>
                <div style={{ height: 8, background: C.chip, borderRadius: 6, overflow: 'hidden', margin: '6px 0 14px' }}>
                  <div style={{ height: '100%', background: C.teal, width: `${result.fields.length ? Math.round(filledCount / result.fields.length * 100) : 0}%` }} />
                </div>

                {missing.length > 0 && (
                  <div style={{ background: C.missBg, borderRadius: 9, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, color: C.miss, marginBottom: 4 }}>Still needed: {missing.length}</div>
                    <div style={{ fontSize: 14 }}>Upload the record that has it, or type it in below.</div>
                    {Object.entries(groups).map(([k, labels]) => (
                      <div key={k} style={{ marginTop: 8, fontSize: 14 }}>
                        <b style={{ display: 'block' }}>{k === 'Provider' ? 'From the provider' : `From the ${k.toLowerCase()}`}</b>
                        {labels.join('; ')}{' '}
                        {k !== 'Provider' && NOTE_DOC_TYPES.includes(k) && <button style={S.link} onClick={() => addDoc(k)}>Upload the {k.toLowerCase()}</button>}
                      </div>
                    ))}
                  </div>
                )}

                {warnings.length > 0 && (
                  <div style={{ background: C.warnBg, color: C.warn, borderRadius: 9, padding: '12px 14px', marginBottom: 14, fontSize: 14 }}>
                    <b>Problems a reviewer would catch</b>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </div>
                )}

                {ordered.map(f => {
                  const v = vals[f.id] || { value: '', source: '' }
                  const st = stateOf(f)
                  return (
                    <div key={f.id} style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{f.sec ? `${f.sec} · ` : ''}{f.label}</span>
                        {st === 'missing' && <span style={S.tag(C.missBg, C.miss)}>Missing</span>}
                        {st === 'found' && <span style={S.tag(C.okBg, C.ok)}>From {v.source || 'records'}</span>}
                        {st === 'entered' && <span style={S.tag(C.chip, C.navy)}>Entered</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                        {f.options?.length > 0 && (
                          <select style={{ ...S.input, minWidth: 170 }} value={f.options.includes(v.value) ? v.value : ''} onChange={e => setVal(f.id, { value: e.target.value, user: true })}>
                            <option value="">Choose…</option>
                            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        )}
                        <input style={{ ...S.input, flex: 1, minWidth: 180 }} value={v.value} aria-label={f.label}
                          placeholder={f.options?.length ? 'or type' : 'Type it in'} onChange={e => setVal(f.id, { value: e.target.value, user: true })} />
                        {(mode === 'addendum' || v.user) && (
                          <select style={{ ...S.input, minWidth: 150 }} value={v.source || ''} onChange={e => setVal(f.id, { source: e.target.value })}>
                            <option value="">{mode === 'addendum' ? 'Recorded in…' : 'Source (optional)'}</option>
                            {NOTE_SOURCES.filter(x => mode !== 'addendum' || x !== 'Entered by provider today').map(x => <option key={x}>{x}</option>)}
                          </select>
                        )}
                      </div>
                      {st === 'found' && f.evidence && <div style={{ ...S.small, fontSize: 12, marginTop: 4 }}>Record says: “{f.evidence}”</div>}
                      {st === 'missing' && f.why && <div style={{ ...S.small, fontSize: 12, marginTop: 4 }}>{f.why}</div>}
                    </div>
                  )
                })}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button style={S.ghost} disabled={busy} onClick={rerun}>Re-check with new records</button>
                  <button style={S.link} onClick={reset}>Start a new note</button>
                </div>
              </div>

              <div>
                <div style={{ position: 'sticky', top: 10 }}>
                  <div style={{ fontWeight: 700, color: C.navy, marginBottom: 6 }}>Note preview</div>
                  <div style={S.note}>
                    {(() => {
                      let sec = null
                      return result.lines.filter(l => !l.omit).map((l, i) => {
                        const head = l.section && l.section !== sec ? (sec = l.section) : null
                        const parts = l.text.split(/(\{\{\w+\}\})/)
                        return (
                          <div key={i}>
                            {head && <div style={{ fontFamily: 'Arial, sans-serif', fontWeight: 700, color: C.teal, marginTop: 8 }}>{head}</div>}
                            {parts.map((p, j) => {
                              const m = p.match(/^\{\{(\w+)\}\}$/)
                              if (!m) return <span key={j}>{p}</span>
                              const v = vals[m[1]]
                              return v?.value.trim()
                                ? <span key={j} style={{ background: C.okBg, borderRadius: 3 }}>{v.value.trim()}</span>
                                : <span key={j} style={{ background: C.missBg, color: C.miss, fontWeight: 700, borderRadius: 3 }}>[MISSING: {labelOf(m[1])}]</span>
                            })}
                          </div>
                        )
                      })
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button style={S.btn} onClick={copy}>Copy note</button>
                    <button style={S.ghost} onClick={download}>Download .txt</button>
                  </div>
                  <p style={{ ...S.small, marginTop: 10 }}>
                    {missing.length
                      ? `${missing.length} blank${missing.length > 1 ? 's' : ''} still marked MISSING. Fill them or remove those lines before signing.`
                      : 'Every blank is filled. Read it once more, then paste into Ascend and sign as the rendering provider.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
