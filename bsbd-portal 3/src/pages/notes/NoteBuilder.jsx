// src/pages/notes/NoteBuilder.jsx
// Note Builder: the portal's clinical notes module (replaces Smart Notes).
//
// 1. Landing: pick the office, dentist, assistant and date of service. Each
//    dentist has saved preferences (credentialed name, usual anesthetic,
//    materials, favorite procedures) stored in the settings table under
//    "noteProfiles". Preferences hold NO patient data.
// 2. Records: dictate, paste or upload the Ascend note plus supporting records.
// 3. Claude fills the template for the procedure ("Clinical Notes That Hold Up"
//    v1.3) only from those records. Fields filled from the dentist's defaults
//    are marked "Default" and must be confirmed. Missing items are listed with
//    where to find them. Old signed notes are handled as addenda (Part 7).
//
// Nothing about the patient is saved. Text is scrubbed of identifiers in the
// browser before it is sent. Screenshots and PDFs cannot be scrubbed.
//
// Props: goHome(), notify(msg, type?), user, providers, staff
// Needs: mammoth in package.json (reads .docx uploads)
// Calls: /api/note-builder (netlify/edge-functions/note-builder.js)

import { useEffect, useMemo, useRef, useState } from 'react'
import { NOTE_TEMPLATES, NOTE_DOC_TYPES, NOTE_SOURCES } from '../../lib/noteTemplates'
import { OFFICES } from '../../lib/constants'
import { sbGet, saveSetting } from '../../lib/supabase'

const C = {
  navy: '#1B2A6B', gold: '#C9A84C', teal: '#2A7A8C', ink: '#1F2433', muted: '#5E6577',
  line: '#DDE1EA', bg: '#F6F7FB', chip: '#EEF1F8', miss: '#B42318', missBg: '#FDECEA',
  ok: '#1E7A46', okBg: '#E8F4EC', warn: '#7A5A12', warnBg: '#FBF5E6', def: '#8A5A00', defBg: '#FFF3D6',
}
const S = {
  page: { background: C.bg, minHeight: '100vh', fontFamily: 'Arial, Helvetica, sans-serif', color: C.ink },
  head: { background: C.navy, color: '#fff', padding: '18px 24px' },
  wrap: { maxWidth: 1200, margin: '0 auto', padding: 20 },
  card: { background: '#fff', border: `1px solid ${C.line}`, borderRadius: 10, padding: 18, marginBottom: 18 },
  h2: { margin: '0 0 4px', fontSize: 18, color: C.navy, display: 'flex', gap: 10, alignItems: 'center' },
  h3: { margin: '16px 0 8px', fontSize: 15, color: C.navy },
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
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
  quick: { textAlign: 'left', font: 'inherit', fontSize: 14, fontWeight: 700, color: C.navy, background: C.chip, border: `1px solid ${C.line}`, borderRadius: 9, padding: '12px 14px', cursor: 'pointer' },
}

const DOC_TYPES = [NOTE_DOC_TYPES[0], 'Dictation', ...NOTE_DOC_TYPES.slice(1)]

// Preferences a dentist can save. Material and technique names only: the
// builder may use them to word a field, never to claim something was done.
const PREF_FIELDS = [
  ['General', [
    ['credName', 'Name as credentialed with TennCare / Renaissance', 'e.g. Jane Smith, DDS'],
    ['topical', 'Topical anesthetic', 'benzocaine 20%'],
    ['blockAgent', 'Usual block anesthetic', 'lidocaine 2% 1:100,000'],
    ['infilAgent', 'Usual infiltration anesthetic', 'articaine 4% 1:100,000 (Septocaine)'],
    ['needle', 'Needle for blocks', '27g'],
    ['isolation', 'Usual isolation', 'rubber dam'],
    ['poi', 'Post-op instructions', 'POI given verbally and in writing'],
  ]],
  ['Endodontics', [
    ['files', 'File system', 'ProTaper Gold'],
    ['naocl', 'Sodium hypochlorite concentration', 'NaOCl 3%'],
    ['irrigation', 'Irrigation sequence', 'NaOCl, 17% EDTA, sterile water flush, 2% chlorhexidine'],
    ['gp', 'Gutta-percha', ''],
    ['sealer', 'Sealer', ''],
    ['obturation', 'Obturation technique', 'single cone / warm vertical / lateral condensation'],
  ]],
  ['Restorative and crowns', [
    ['etchBond', 'Etch and bond', ''],
    ['composite', 'Composite', ''],
    ['liner', 'Liner / base', ''],
    ['impression', 'Impression or scan', ''],
    ['temp', 'Temporary crown material', ''],
    ['cement', 'Final cement', ''],
  ]],
  ['Surgery and hygiene', [
    ['suture', 'Suture', '4-0 chromic gut'],
    ['graft', 'Graft material', ''],
    ['varnish', 'Fluoride varnish', '5% NaF varnish'],
  ]],
]
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
        const f = { id, sec, hint: (ctx ? ctx + ': ' : '') + (inner || '(blank)'), label: (!inner || inner === '/') ? (ctx || 'Fill in') : ((ctx ? ctx + ' — ' : '') + short), value: null, status: 'missing' }
        if (c === '{' && inner.includes('/') && !inner.includes('[')) f.options = inner.split('/').map(s => s.trim()).filter(Boolean)
        fields.push(f); res += `{{${id}}}`; i = j + 1
      } else { res += c; i++ }
    }
    out.push({ section: sec, text: res })
  })
  return { lines: out, fields, warnings: [] }
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
  let buf = '', text = '', stopReason = ''
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
      if (data.type === 'message_delta' && data.delta?.stop_reason) stopReason = data.delta.stop_reason
    }
  }
  const parsed = parseAnswer(text)
  if (!parsed) {
    const err = new Error(stopReason === 'max_tokens'
      ? 'The answer was cut off before it finished. Try fewer records at once'
      : !text.trim() ? 'Nothing came back from Claude' : 'The answer came back in a shape the page could not read')
    err.raw = text
    throw err
  }
  return parsed
}

// Answer format (plain text, so quotes in clinical wording can't break it):
//   @m1
//   label: Chief complaint
//   status: found
//   value: pain on biting, lower right
//   ...
//   @warning: No pre-op PA described.
// Falls back to JSON if Claude answers in JSON anyway.
function parseAnswer(text) {
  const fields = {}, warnings = []
  let cur = null
  String(text || '').replace(/\r/g, '').split('\n').forEach(line => {
    const t = line.trim()
    let m
    if ((m = t.match(/^@warning\s*:\s*(.+)$/i))) { warnings.push(m[1].trim()); cur = null; return }
    if ((m = t.match(/^@([A-Za-z]\w*)\s*$/))) { cur = fields[m[1]] = {}; return }
    if (cur && (m = t.match(/^(label|status|value|source|evidence|look_in|why)\s*:\s*(.*)$/i))) {
      let v = m[2].trim()
      if (/^(null|none|n\/a|-)?$/i.test(v) && m[1].toLowerCase() === 'value') v = null
      cur[m[1].toLowerCase()] = v
      return
    }
    if (cur && cur.value && t && !t.startsWith('@')) cur.value += ' ' + t   // wrapped value line
  })
  Object.values(fields).forEach(f => { if (f.status) f.status = f.status.toLowerCase().replace(/[^a-z]/g, '') })
  if (Object.keys(fields).length) return { fields, warnings }
  try { const j = parseLooseJSON(text); if (j && j.fields) return j } catch { /* fall through */ }
  return null
}

// Models occasionally leave a quote unescaped inside a string ("CC: "pain""),
// which breaks JSON.parse. Try strict first, then re-escape any quote that
// can't be closing a string (not followed by , } ] or :), then give up.
function parseLooseJSON(text) {
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  if (a < 0 || b < a) throw new Error('The answer came back in the wrong shape')
  const raw = text.slice(a, b + 1)
  try { return JSON.parse(raw) } catch { /* repair below */ }
  let out = '', inStr = false
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]
    if (inStr && c === '\\') { out += c + (raw[i + 1] ?? ''); i++; continue }
    if (c === '"') {
      if (!inStr) { inStr = true; out += c; continue }
      let j = i + 1; while (j < raw.length && /\s/.test(raw[j])) j++
      if (j >= raw.length || ',}]:'.includes(raw[j])) { inStr = false; out += c } else out += '\\"'
      continue
    }
    if (inStr && (c === '\n' || c === '\r')) { out += c === '\n' ? '\\n' : ''; continue }
    out += c
  }
  try { return JSON.parse(out) } catch { throw new Error('The answer came back in the wrong shape') }
}

const fileToBase64 = f => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1])
  r.onerror = () => reject(new Error('Could not read file'))
  r.readAsDataURL(f)
})


// ---------- people (provider/staff settings come in several shapes; read them defensively)
const nameOf = p => (typeof p === 'string' ? p : (p?.name || p?.fullName || p?.full_name || p?.staffName || p?.label || ''))
const officeOf = p => (typeof p === 'string' ? '' : (p?.office || p?.location || ''))
const isDoctor = p => {
  if (typeof p === 'string') return true
  const r = String(p?.role || p?.type || p?.title || '').toLowerCase()
  return !r || /dr|dent|dds|dmd|doctor|provider|associate|owner/.test(r) && !/hyg/.test(r)
}
function officeList() {
  const raw = Array.isArray(OFFICES) ? OFFICES : (OFFICES && typeof OFFICES === 'object' ? Object.keys(OFFICES) : [])
  const names = raw.map(o => (typeof o === 'string' ? o : (o?.name || o?.label || o?.id || ''))).filter(Boolean)
  return names.length ? names : ['Dalton', 'Calhoun', 'Brainerd', 'McCallie']
}
function doctorList(providers, office) {
  let arr = []
  if (Array.isArray(providers)) arr = providers
  else if (providers && typeof providers === 'object') arr = Object.entries(providers).flatMap(([k, v]) => (Array.isArray(v) ? v.map(x => (typeof x === 'string' ? { name: x, office: k } : { office: k, ...x })) : []))
  const docs = arr.filter(isDoctor)
  const here = docs.filter(p => !officeOf(p) || officeOf(p) === office)
  return [...new Set((here.length ? here : docs).map(nameOf).filter(Boolean))]
}
function assistantList(staff, office) {
  const raw = staff && typeof staff === 'object' && !Array.isArray(staff) ? (staff[office] || []) : (Array.isArray(staff) ? staff : [])
  return [...new Set(raw.map(nameOf).filter(Boolean))]
}
const profKey = n => String(n || '').trim().toLowerCase()

function buildPrompt(section, tpl, mode, skel, records, confirmed, team, prefs) {
  const addendum = mode === 'addendum'
  const prefLines = Object.entries(prefs || {})
    .filter(([k, v]) => !['favorites', 'credName', 'updatedAt', 'updatedBy'].includes(k) && typeof v === 'string' && v.trim())
    .map(([k, v]) => `- ${k}: ${v.trim()}`)
  const lineList = skel.lines.map((l, i) => `L${i + 1}${l.section ? ` [${l.section}]` : ''}: ${l.text}`).join('\n')
  const fieldList = skel.fields.map(f => {
    const line = skel.lines.findIndex(l => l.text.includes(`{{${f.id}}}`)) + 1
    return `- ${f.id} (line L${line}): blank for "${f.hint || f.label}"${f.options ? `; choose one of: ${f.options.join(' | ')}` : ''}`
  }).join('\n')
  return `You are helping a Tennessee dental office (TennCare, reviewed by Renaissance) write a clinical note in the office's required template.

PROCEDURE: ${section.section}
TEMPLATE: ${tpl.name}
NOTE TYPE: ${addendum ? `ADDENDUM to an already-signed note. The original note is never edited. The addendum is dated today (${today()}) and may only contain facts that were recorded at the time of service in some record (film, anesthetic log, exam note, lab slip, consent form). Anything not recorded anywhere stays missing; say so in a warning.` : 'New note for the visit described in the records and dictation.'}

CHARTING TEAM (confirmed by staff; status "found", source "Charting team"):
- Rendering provider (full credentialed name): ${team.provider || 'not given'}
- Assisted by: ${team.assistant || 'not given'}
- Office: ${team.office || 'not given'}
- Date of service: ${addendum ? 'see records' : (team.dos || 'not given')}

${prefLines.length ? `THIS DENTIST'S USUAL MATERIALS AND TECHNIQUES:
${prefLines.join('\n')}
Use one of these ONLY for a blank that asks for a material, product, concentration of a product, instrument system or technique name, and only when the records and dictation do not name something different. Never use them for findings, test results, diagnoses, tooth numbers, surfaces, amounts, carpule counts, times, or to state that a step was performed. Every blank filled this way gets status "default" and source "Provider defaults".
` : ''}
THE NOTE, ALREADY SPLIT INTO LINES. Each {{id}} is a blank you fill:
${lineList}

BLANKS TO FILL:
${fieldList}

WHAT THE NOTE AND CLAIM MUST CONTAIN: ${section.what}
DENIAL TRAPS: ${section.traps.join(' | ')}
OFFICE RULES: tooth number and surfaces on every treatment line; diagnosis before treatment with the tests or findings behind it; name each film (type, date, what it shows); anesthesia with agent, concentration and vasoconstrictor, number of 1.7 mL carpules, total mg (lidocaine 2% = 34 mg/carp, articaine 4% = 68 mg/carp, mepivacaine 3% = 51 mg/carp, bupivacaine 0.5% = 8.5 mg/carp) and technique; real material names with concentrations (sodium hypochlorite NaOCl %, chlorhexidine 2%; "NaCl2" and "Chlorx" are wrong); consent with risks, benefits, alternatives incl. no treatment; outcome; next visit; rendering provider's full credentialed name (staff initials are not a provider signature). D7210 from Oct 1, 2026 needs prior authorization unless an emergency. RCT claims are on pre-payment review. SDF D1354: max 4 teeth/visit, 2 per tooth lifetime, 2nd at least 2 months after 1st, no filling same visit or for 6 months. D2991: max 4/day, not on a tooth filled in past 12 months, no filling for 6 months.

RECORDS (identifiers already removed; screenshots and PDFs are attached in the order listed; a Dictation record is speech-to-text from the clinician, so fix misheard words only when the meaning is certain):
${records.map((d, i) => `--- RECORD ${i + 1}: ${d.type}${d.attached ? ` (${d.attached} attached)` : ''} ---\n${d.text || '(see attachment)'}`).join('\n\n')}
${confirmed.length ? '\nVALUES CONFIRMED BY STAFF (use these exactly; they override the records):\n' + confirmed.map(c => `- ${c.id} (${c.label}): ${c.value}${c.source ? ` (source: ${c.source})` : ''}`).join('\n') : ''}

TASK: For every blank, give the text that goes in its place so the line reads naturally. Fill a blank ONLY from the records, dictation, charting team, confirmed values or (as allowed above) the dentist's usual materials. Never invent, assume or use a "typical" finding, test result, amount or date. If it isn't there, status "missing" and value null. If records conflict, leave it missing and add a warning. Convert shorthand to correct wording only when the meaning is certain; compute anesthetic mg from carpule counts. Use status "na" only when the blank is an optional part of the template and the records show it does not apply (value null). Never write patient names or identifiers.
For every blank also give a short plain "label" naming what it is (e.g. "Pre-op PA date", "Cold test #30").
For each missing blank, give "look_in" (one of: ${DOC_TYPES.slice(1).join(', ')}, Provider) and a short "why" the reviewer needs it.
Warnings: every problem a TennCare reviewer would catch in the ORIGINAL records (code doesn't match what's written, missing pre-op film, missing prior auth for D7210, shorthand, copy-forward text, missing signature, limits exceeded, etc.). Short sentences.

FORMAT: plain text only, no JSON, no markdown, no commentary. One block per blank, in order, then one line per warning:
@m1
label: Chief complaint
status: found
value: pain on biting, lower right
source: Dictation
evidence: hurts when I bite down
@m2
label: Cold test result
status: missing
value: null
look_in: Exam note
why: Shows the diagnosis was tested
@warning: No pre-op radiograph is described.
Keep each value on one line. status is one of found, default, missing, na.`
}

// ---------- dictation (browser speech recognition)
const SpeechRec = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null

// ---------- component
let uid = 0
const newDoc = type => ({ id: ++uid, type, text: '', name: '', file: null, kind: 'text', preview: '' })
const LS_KEY = 'bsbd_notebuilder_team'
const loadTeam = () => { try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} } }

export default function NoteBuilder({ goHome, notify, user, providers, staff }) {
  const offices = useMemo(officeList, [])
  const saved = useMemo(loadTeam, [])
  const [stage, setStage] = useState('landing')
  const [team, setTeam] = useState(() => ({
    office: saved.office || user?.office || offices[0],
    doctor: saved.doctor || '',
    assistant: saved.assistant || '',
    dos: new Date().toISOString().slice(0, 10),
  }))
  const [profiles, setProfiles] = useState({})
  const [editingPrefs, setEditingPrefs] = useState(false)
  const [draftPrefs, setDraftPrefs] = useState({})

  const [proc, setProc] = useState(7)
  const [tplIdx, setTplIdx] = useState(0)
  const [mode, setMode] = useState('new')
  const [docs, setDocs] = useState([newDoc(DOC_TYPES[0])])
  const [result, setResult] = useState(null)
  const [vals, setVals] = useState({})
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState({ text: '', err: false })
  const [listening, setListening] = useState(null) // doc id being dictated into
  const step3 = useRef(null)
  const abortRef = useRef(null)
  const recRef = useRef(null)
  const docRefs = useRef({})

  const section = NOTE_TEMPLATES[proc]
  const tpl = section.templates[tplIdx] || section.templates[0]
  const say = (m, type) => (notify ? notify(m, type) : null)

  const doctors = useMemo(() => doctorList(providers, team.office), [providers, team.office])
  const assistants = useMemo(() => assistantList(staff, team.office), [staff, team.office])
  const prefs = profiles[profKey(team.doctor)] || {}
  const providerName = (prefs.credName || '').trim() || team.doctor
  const favorites = (prefs.favorites || []).filter(i => NOTE_TEMPLATES[i])

  useEffect(() => {
    ;(async () => {
      try {
        const rows = await sbGet('settings', 'key=eq.noteProfiles&select=value')
        if (rows?.[0]?.value && typeof rows[0].value === 'object') setProfiles(rows[0].value)
      } catch { /* profiles stay empty; the page still works */ }
    })()
    return () => { abortRef.current?.abort(); try { recRef.current?.stop() } catch { /* ignore */ } }
  }, [])

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify({ office: team.office, doctor: team.doctor, assistant: team.assistant })) } catch { /* ignore */ } }, [team.office, team.doctor, team.assistant])

  // ----- preferences
  const openPrefs = () => { setDraftPrefs({ ...prefs, credName: prefs.credName || team.doctor }); setEditingPrefs(true) }
  const savePrefs = async () => {
    const next = { ...profiles, [profKey(team.doctor)]: { ...draftPrefs, updatedAt: new Date().toISOString(), updatedBy: user?.name || '' } }
    try { await saveSetting('noteProfiles', next); setProfiles(next); setEditingPrefs(false); say(`Preferences saved for ${team.doctor}`) }
    catch { say('Could not save preferences. Try again.', 'error') }
  }
  const toggleFav = i => setDraftPrefs(p => { const f = new Set(p.favorites || []); f.has(i) ? f.delete(i) : f.add(i); return { ...p, favorites: [...f].sort((a, b) => a - b) } })

  const start = (procIdx, dictate) => {
    if (!team.doctor) { say('Pick the dentist first.', 'error'); return }
    if (procIdx != null) { setProc(procIdx); setTplIdx(0) }
    setResult(null); setVals({}); setStatus({ text: '', err: false })
    const first = newDoc(dictate ? 'Dictation' : DOC_TYPES[0])
    setDocs([first]); setStage('build')
    if (dictate) setTimeout(() => toggleDictation(first.id), 200)
    window.scrollTo?.(0, 0)
  }

  // ----- documents
  const updateDoc = (id, patch) => setDocs(ds => ds.map(d => (d.id === id ? { ...d, ...patch } : d)))
  const addDoc = type => {
    const d = newDoc(type || DOC_TYPES[2])
    setDocs(ds => [...ds, d])
    setTimeout(() => docRefs.current[d.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50)
    return d
  }
  const readFile = async (doc, f) => {
    if (!f) return
    const n = f.name.toLowerCase()
    try {
      if (f.type.startsWith('image/')) updateDoc(doc.id, { name: f.name, file: f, kind: 'image', preview: URL.createObjectURL(f) })
      else if (n.endsWith('.pdf')) updateDoc(doc.id, { name: f.name, file: f, kind: 'pdf', preview: '' })
      else if (n.endsWith('.docx')) {
        const mammoth = await import('mammoth')
        const r = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })
        updateDoc(doc.id, { name: f.name, text: r.value, file: null, kind: 'text', preview: '' })
      } else updateDoc(doc.id, { name: f.name, text: await f.text(), file: null, kind: 'text', preview: '' })
    } catch { say(`Could not read ${f.name}. Paste the text instead.`, 'error') }
  }

  // ----- dictation
  const toggleDictation = id => {
    if (!SpeechRec) { say('Dictation needs Chrome or Safari. You can still type or paste.', 'error'); return }
    if (listening) {
      try { recRef.current?.stop() } catch { /* ignore */ }
      const was = listening; setListening(null)
      if (was === id) return
    }
    const rec = new SpeechRec()
    rec.continuous = true; rec.interimResults = false; rec.lang = 'en-US'
    rec.onresult = e => {
      let add = ''
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) add += e.results[i][0].transcript
      if (add.trim()) setDocs(ds => ds.map(d => (d.id === id ? { ...d, text: (d.text ? d.text.replace(/\s*$/, ' ') : '') + add.trim() } : d)))
    }
    rec.onerror = ev => { if (ev.error === 'not-allowed') say('Microphone access was blocked. Allow it in the browser and try again.', 'error') }
    rec.onend = () => setListening(cur => (cur === id ? null : cur))
    try { rec.start(); recRef.current = rec; setListening(id) } catch { say('Could not start the microphone.', 'error') }
  }

  // ----- build
  const teamInfo = { provider: providerName, assistant: team.assistant, office: team.office, dos: team.dos ? new Date(team.dos + 'T12:00:00').toLocaleDateString('en-US') : '' }

  const build = async (confirmed = []) => {
    if (listening) { try { recRef.current?.stop() } catch { /* ignore */ } setListening(null) }
    const usable = docs.filter(d => d.text.trim() || d.file)
    if (!usable.length) { setStatus({ text: 'Dictate, paste or upload the note first.', err: true }); return }
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
    setStatus({ text: `${removed ? `${removed} identifier${removed > 1 ? 's' : ''} removed. ` : ''}Filling the template. This usually takes 20 to 60 seconds…`, err: false })
    const ctl = new AbortController(); abortRef.current = ctl
    try {
      const { skel, v } = skeleton()
      const out = await callBuilder(
        { prompt: buildPrompt(section, tpl, mode, skel, records, confirmed, teamInfo, mode === 'addendum' ? {} : prefs), images, pdfs },
        chars => setStatus(s => ({ ...s, text: `Writing the note… (${Math.round(chars / 100) / 10}k characters)` })),
        ctl.signal,
      )
      const got = (out && typeof out.fields === 'object' && out.fields) || {}
      const fields = skel.fields.map(f => {
        const a = got[f.id] || {}
        return { ...f, label: a.label || f.label, status: a.status || 'missing', source: a.source || '', evidence: a.evidence || '', look_in: a.look_in || '', why: a.why || '', na: a.status === 'na' }
      })
      fields.forEach(f => {
        const a = got[f.id] || {}
        if (a.value != null && String(a.value).trim()) {
          const isDef = a.status === 'default'
          v[f.id] = { value: String(a.value).trim(), source: a.source || '', user: false, isDefault: isDef, confirmed: !isDef }
        }
      })
      const lines = skel.lines.map(l => {
        const ids = [...l.text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1])
        const omit = ids.length > 0 && ids.every(id => { const f = fields.find(x => x.id === id); return f?.na && !v[id]?.value })
        return { ...l, omit }
      })
      setResult({ lines, fields, warnings: Array.isArray(out?.warnings) ? out.warnings : [] }); setVals(v)
      setStatus({ text: `${removed ? `${removed} identifier${removed > 1 ? 's were' : ' was'} removed before sending. ` : ''}Done. Review below.`, err: false })
      setTimeout(() => step3.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch (e) {
      if (e.name === 'AbortError') setStatus({ text: 'Stopped.', err: false })
      else setStatus({ text: `${e.message || 'Something went wrong'}. Try again, or fill the template by hand.`, err: true, raw: e.raw || '' })
    } finally { setBusy(false); abortRef.current = null }
  }

  const rerun = () => {
    const confirmed = (result?.fields || [])
      .map(f => ({ f, v: vals[f.id] }))
      .filter(({ v }) => v && v.value.trim() && (v.user || (v.isDefault && v.confirmed)))
      .map(({ f, v }) => ({ id: f.id, label: f.label, value: v.value.trim(), source: v.source }))
    build(confirmed)
  }

  // The template split into lines and blanks, with the charting team filled in.
  const skeleton = () => {
    const r = localParse(tpl.lines)
    if (mode === 'addendum') {
      r.lines.unshift({ section: '', text: 'Reason: documentation completed from records made at the time of service.' })
      r.lines.unshift({ section: '', text: `Addendum to note of {{orig_date}}. Entered ${today()}.` })
      r.fields.unshift({ id: 'orig_date', label: 'Original date of service', hint: 'original date of service', status: 'missing', value: null })
    }
    const v = {}
    const deg = (providerName.match(/\b(DDS|DMD)\b/i) || [])[1]
    r.fields.forEach(f => {
      let val = ''
      if (/DDS\s*\/\s*DMD/i.test(f.label)) val = deg ? deg.toUpperCase() : ''
      else if (/credentialed|rendering provider/i.test(f.label)) val = deg ? providerName.replace(/,?\s*\b(DDS|DMD)\b\.?/i, '').trim() : (providerName || '')
      else if (/Assisted by/i.test(f.label)) val = team.assistant || ''
      v[f.id] = { value: val, source: val ? 'Charting team' : '', user: false, isDefault: false, confirmed: true }
    })
    return { skel: r, v }
  }

  const blank = () => {
    const { skel, v } = skeleton()
    setResult(skel); setVals(v)
    setTimeout(() => step3.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // ----- derived
  const setVal = (id, patch) => setVals(v => ({ ...v, [id]: { ...v[id], ...patch } }))
  const stateOf = f => {
    const v = vals[f.id]
    if (!v || !v.value.trim()) return f.na ? 'na' : 'missing'
    if (v.user) return 'entered'
    if (v.isDefault && !v.confirmed) return 'default'
    return 'found'
  }
  const labelOf = id => result?.fields.find(x => x.id === id)?.label || id
  const missing = useMemo(() => (result ? result.fields.filter(f => stateOf(f) === 'missing') : []), [result, vals])
  const unconfirmed = useMemo(() => (result ? result.fields.filter(f => stateOf(f) === 'default') : []), [result, vals])
  const filledCount = result ? result.fields.length - missing.length - unconfirmed.length : 0
  const confirmAllDefaults = () => setVals(v => { const n = { ...v }; unconfirmed.forEach(f => { n[f.id] = { ...n[f.id], confirmed: true } }); return n })

  const warnings = useMemo(() => {
    if (!result) return []
    const w = [...(result.warnings || [])]
    if (mode === 'addendum') {
      const bad = result.fields.filter(f => { const v = vals[f.id]; return v?.user && v.value.trim() && !v.source })
      if (bad.length) w.unshift(`Addendum entries need a source record: ${bad.map(f => f.label).join(', ')}.`)
      const t = result.fields.filter(f => vals[f.id]?.source === 'Entered by provider today')
      if (t.length) w.unshift(`An addendum can't use values entered today from memory: ${t.map(f => f.label).join(', ')}.`)
    }
    return w
  }, [result, vals, mode])

  const valueOut = id => { const v = vals[id]; if (v?.value.trim()) return v.value.trim(); return result?.fields.find(x => x.id === id)?.na ? '' : `[MISSING: ${labelOf(id)}]` }
  const noteText = () => {
    if (!result) return ''
    const out = []; let sec = null
    result.lines.filter(l => !l.omit).forEach(l => {
      if (l.section && l.section !== sec) { sec = l.section; out.push(sec) }
      out.push(l.text.replace(/\{\{(\w+)\}\}/g, (m, id) => valueOut(id)).replace(/ +([.,;])/g, '$1').replace(/ {2,}/g, ' ').trim())
    })
    return out.join('\n')
  }
  const copy = async () => {
    if (unconfirmed.length) { say(`Confirm the ${unconfirmed.length} default${unconfirmed.length > 1 ? 's' : ''} first.`, 'error'); return }
    const t = noteText()
    try { await navigator.clipboard.writeText(t); say('Note copied. Paste it into Ascend.') }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); say('Note copied. Paste it into Ascend.') } catch { say('Copy was blocked. Select the preview and copy it.', 'error') }
      ta.remove()
    }
  }
  const download = () => {
    if (unconfirmed.length) { say(`Confirm the ${unconfirmed.length} default${unconfirmed.length > 1 ? 's' : ''} first.`, 'error'); return }
    const blob = new Blob([noteText()], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${tpl.name.replace(/[^\w]+/g, '_')}_note.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  const groups = {}
  missing.forEach(f => { const k = f.look_in || 'Provider'; (groups[k] = groups[k] || []).push(f.label) })
  const ordered = result ? [...missing, ...unconfirmed, ...result.fields.filter(f => !['missing', 'default', 'na'].includes(stateOf(f))), ...result.fields.filter(f => stateOf(f) === 'na')] : []

  // ---------- header
  const header = (
    <div style={S.head}>
      <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>Clinical notes</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>Note Builder</div>
          <div style={{ color: '#D6DDF0', fontSize: 14, maxWidth: 720 }}>
            {stage === 'landing'
              ? 'Dictate or upload a note and get it back in the TennCare template, with every gap called out.'
              : `${providerName || 'No dentist picked'}${team.assistant ? ` · assisted by ${team.assistant}` : ''} · ${team.office}${mode === 'new' && teamInfo.dos ? ` · ${teamInfo.dos}` : ''}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {stage === 'build' && <button style={{ ...S.ghost, background: 'transparent', color: '#fff', borderColor: '#fff' }} onClick={() => setStage('landing')}>Change team or procedure</button>}
          {goHome && <button style={{ ...S.ghost, background: 'transparent', color: '#fff', borderColor: '#fff' }} onClick={goHome}>Back to modules</button>}
        </div>
      </div>
    </div>
  )

  // ---------- landing
  if (stage === 'landing') {
    return (
      <div style={S.page}>
        {header}
        <div style={S.wrap}>
          <div style={S.card}>
            <h2 style={S.h2}>Who's charting</h2>
            <p style={S.sub}>The dentist's name goes on the note as the rendering provider, exactly as saved in their preferences.</p>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={S.label}>Office
                <select style={{ ...S.input, minWidth: 160 }} value={team.office} onChange={e => setTeam(t => ({ ...t, office: e.target.value }))}>
                  {offices.map(o => <option key={o}>{o}</option>)}
                </select>
              </label>
              <label style={S.label}>Dentist
                <input style={{ ...S.input, minWidth: 220 }} list="nb-doctors" value={team.doctor} placeholder="Pick or type" onChange={e => setTeam(t => ({ ...t, doctor: e.target.value }))} />
                <datalist id="nb-doctors">{doctors.map(d => <option key={d} value={d} />)}</datalist>
              </label>
              <label style={S.label}>Assistant
                <input style={{ ...S.input, minWidth: 200 }} list="nb-assistants" value={team.assistant} placeholder="Pick or type" onChange={e => setTeam(t => ({ ...t, assistant: e.target.value }))} />
                <datalist id="nb-assistants">{assistants.map(d => <option key={d} value={d} />)}</datalist>
              </label>
              <label style={S.label}>Date of service
                <input type="date" style={S.input} value={team.dos} onChange={e => setTeam(t => ({ ...t, dos: e.target.value }))} />
              </label>
            </div>

            {team.doctor && !editingPrefs && (
              <div style={{ marginTop: 16, background: C.chip, borderRadius: 9, padding: '12px 14px', fontSize: 14 }}>
                {prefs.updatedAt ? (
                  <>
                    <b style={{ color: C.navy }}>{providerName}</b>
                    <div style={{ marginTop: 4, color: C.muted }}>
                      {[prefs.blockAgent, prefs.infilAgent, prefs.files, prefs.composite, prefs.cement].filter(Boolean).join(' · ') || 'Name saved, no materials yet.'}
                    </div>
                  </>
                ) : <span>No preferences saved for {team.doctor} yet. Saving them fills the provider name and usual materials on every note.</span>}
                <div style={{ marginTop: 8 }}><button style={S.link} onClick={openPrefs}>{prefs.updatedAt ? 'Edit preferences' : 'Set up preferences'}</button></div>
              </div>
            )}

            {editingPrefs && (
              <div style={{ marginTop: 16, border: `1px solid ${C.line}`, borderRadius: 9, padding: 16 }}>
                <b style={{ color: C.navy, fontSize: 16 }}>Preferences for {team.doctor}</b>
                <p style={{ ...S.small, margin: '4px 0 0' }}>Only names of materials and techniques. The builder uses these to word a field when the dictation or note doesn't name the product, marks each one "Default," and staff confirm it before the note can be copied. They never stand in for findings, amounts or steps.</p>
                {PREF_FIELDS.map(([group, fields]) => (
                  <div key={group}>
                    <div style={S.h3}>{group}</div>
                    <div style={S.grid}>
                      {fields.map(([k, label, ph]) => (
                        <label key={k} style={S.label}>{label}
                          <input style={S.input} value={draftPrefs[k] || ''} placeholder={ph} onChange={e => setDraftPrefs(p => ({ ...p, [k]: e.target.value }))} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <div style={S.h3}>Procedures shown first</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {NOTE_TEMPLATES.map((s, i) => {
                    const on = (draftPrefs.favorites || []).includes(i)
                    return <button key={i} onClick={() => toggleFav(i)} style={{ ...S.input, cursor: 'pointer', fontSize: 13, background: on ? C.navy : '#fff', color: on ? '#fff' : C.ink }}>{s.section.split(':')[0]}</button>
                  })}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  <button style={S.btn} onClick={savePrefs}>Save preferences</button>
                  <button style={S.ghost} onClick={() => setEditingPrefs(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div style={S.card}>
            <h2 style={S.h2}>Start a note</h2>
            <p style={S.sub}>Pick the procedure. Dictate starts the microphone right away.</p>
            {favorites.length > 0 && (
              <>
                <div style={{ ...S.small, fontWeight: 700, marginBottom: 8 }}>{team.doctor}'s procedures</div>
                <div style={S.grid}>
                  {favorites.map(i => (
                    <div key={i} style={{ ...S.quick, cursor: 'default' }}>
                      <div>{NOTE_TEMPLATES[i].section}</div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                        <button style={S.link} onClick={() => start(i, true)}>Dictate</button>
                        <button style={S.link} onClick={() => start(i, false)}>Upload or paste</button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: favorites.length ? 18 : 0 }}>
              <label style={S.label}>{favorites.length ? 'Any procedure' : 'Procedure'}
                <select style={{ ...S.input, minWidth: 320 }} value={proc} onChange={e => { setProc(+e.target.value); setTplIdx(0) }}>
                  {NOTE_TEMPLATES.map((s, i) => <option key={i} value={i}>{s.section}</option>)}
                </select>
              </label>
              <button style={S.btn} onClick={() => start(proc, true)}>Dictate</button>
              <button style={S.ghost} onClick={() => start(proc, false)}>Upload or paste</button>
            </div>
            {!SpeechRec && <p style={{ ...S.small, marginTop: 10 }}>Dictation isn't available in this browser. Use Chrome or Safari.</p>}
          </div>
        </div>
      </div>
    )
  }

  // ---------- build
  return (
    <div style={S.page}>
      {header}
      <div style={S.wrap}>
        {/* STEP 1 */}
        <div style={S.card}>
          <h2 style={S.h2}><span style={S.num}>1</span>Procedure and note type</h2>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 10 }}>
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
                {[['new', "A note for this visit"], ['addendum', 'An addendum to a signed note']].map(([k, t]) => (
                  <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k}
                    style={{ border: 0, padding: '9px 14px', font: 'inherit', fontSize: 14, cursor: 'pointer', background: mode === k ? C.navy : '#fff', color: mode === k ? '#fff' : C.ink }}>{t}</button>
                ))}
              </div>
            </div>
          </div>
          <details style={{ marginTop: 14, background: C.chip, borderRadius: 8, padding: '10px 14px', fontSize: 14 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 700, color: C.navy }}>What this note and claim must contain</summary>
            <div style={{ marginTop: 6 }}>{section.what}</div>
            {section.traps.length > 0 && <>
              <b style={{ color: C.navy, display: 'block', marginTop: 8 }}>Denial traps</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{section.traps.map((t, i) => <li key={i}>{t}</li>)}</ul>
            </>}
          </details>
          {mode === 'addendum' && (
            <p style={{ ...S.small, marginTop: 10 }}><b>Addendum rules (Part 7):</b> never edit the signed note. The addendum is dated today and can only add what was recorded at the time somewhere else: the film, the anesthetic log, the exam note, the lab slip. Saved preferences are not used for addenda.</p>
          )}
        </div>

        {/* STEP 2 */}
        <div style={S.card}>
          <h2 style={S.h2}><span style={S.num}>2</span>Dictate or upload the records</h2>
          <p style={S.sub}>Dictate the visit, paste text from Ascend, or upload a .txt, .docx, .pdf or screenshot. Add the exam note, radiograph reading or perio chart if the main note is thin.</p>
          {docs.map((d, i) => (
            <div key={d.id} ref={el => { docRefs.current[d.id] = el }} style={{ border: `1px solid ${listening === d.id ? C.miss : C.line}`, borderRadius: 9, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
                <select style={{ ...S.input, minWidth: 220 }} value={d.type} onChange={e => updateDoc(d.id, { type: e.target.value })}>
                  {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
                {d.type === 'Dictation'
                  ? <button style={{ ...(listening === d.id ? S.btn : S.ghost), padding: '6px 12px', fontSize: 13, ...(listening === d.id ? { background: C.miss, borderColor: C.miss } : {}) }} onClick={() => toggleDictation(d.id)}>
                      {listening === d.id ? '● Recording, click to stop' : 'Start dictating'}
                    </button>
                  : <input type="file" accept=".txt,.docx,.pdf,image/*,.md" onChange={e => readFile(d, e.target.files[0])} />}
                {d.name && <span style={S.small}>Loaded: {d.name}</span>}
                {i > 0 && <button style={S.link} onClick={() => { if (listening === d.id) toggleDictation(d.id); setDocs(ds => ds.filter(x => x.id !== d.id)) }}>Remove</button>}
              </div>
              {d.preview && <img src={d.preview} alt="Uploaded screenshot" style={{ maxHeight: 90, borderRadius: 6, border: `1px solid ${C.line}` }} />}
              {d.kind === 'pdf' && <div style={S.small}>PDF attached. It goes to Claude as is, so remove patient identifiers from it first.</div>}
              <textarea style={S.area} value={d.text} onChange={e => updateDoc(d.id, { text: e.target.value })}
                placeholder={d.type === 'Dictation' ? 'Speak the visit: tooth, complaint, tests, diagnosis, anesthetic and carpules, what you did, materials, outcome, next visit. Skip the patient name.' : d.kind !== 'text' ? 'Attachment added. Add any notes here (optional).' : `Paste the ${d.type.toLowerCase()} here`} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={{ ...S.ghost, padding: '6px 12px', fontSize: 13 }} onClick={() => addDoc()}>Add a supporting record</button>
            <button style={{ ...S.ghost, padding: '6px 12px', fontSize: 13 }} onClick={() => { const d = addDoc('Dictation'); setTimeout(() => toggleDictation(d.id), 100) }}>Add dictation</button>
          </div>
          <p style={{ ...S.small, marginTop: 10 }}>Don't say or type the patient's name. Name, date of birth, address, phone, email, member ID and SSN lines are removed before any text goes to Claude. Screenshots and PDFs can't be scrubbed, so crop identifiers out first. Nothing on this page is saved.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
            <button style={{ ...S.btn, opacity: busy ? 0.6 : 1 }} disabled={busy} onClick={() => build()}>{busy ? 'Working…' : 'Build the note'}</button>
            {busy && <button style={S.ghost} onClick={() => abortRef.current?.abort()}>Stop</button>}
            {!busy && <button style={S.ghost} onClick={blank}>Fill the template by hand</button>}
            {busy && <span className="spinner" />}
          </div>
          {status.text && <div style={{ marginTop: 12, fontSize: 14, color: status.err ? C.miss : C.ink }}>{status.text}</div>}
          {status.raw && (
            <details style={{ marginTop: 8, fontSize: 13 }}>
              <summary style={{ cursor: 'pointer', color: C.muted }}>Show what came back (send this to support if it keeps happening)</summary>
              <pre style={{ ...S.note, maxHeight: 240, overflow: 'auto', marginTop: 6 }}>{status.raw.slice(0, 4000)}</pre>
            </details>
          )}
        </div>

        {/* STEP 3 */}
        {result && (
          <div style={S.card} ref={step3}>
            <h2 style={S.h2}><span style={S.num}>3</span>Fill the gaps and copy into Ascend</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 18, marginTop: 10 }}>
              <div>
                <b>{filledCount} of {result.fields.length} blanks done</b>
                <div style={{ height: 8, background: C.chip, borderRadius: 6, overflow: 'hidden', margin: '6px 0 14px' }}>
                  <div style={{ height: '100%', background: C.teal, width: `${result.fields.length ? Math.round(filledCount / result.fields.length * 100) : 0}%` }} />
                </div>

                {missing.length > 0 && (
                  <div style={{ background: C.missBg, borderRadius: 9, padding: '12px 14px', marginBottom: 14 }}>
                    <div style={{ fontWeight: 700, color: C.miss, marginBottom: 4 }}>Still needed: {missing.length}</div>
                    <div style={{ fontSize: 14 }}>Dictate it, upload the record that has it, or type it in below.</div>
                    {Object.entries(groups).map(([k, labels]) => (
                      <div key={k} style={{ marginTop: 8, fontSize: 14 }}>
                        <b style={{ display: 'block' }}>{k === 'Provider' ? 'From the dentist' : `From the ${k.toLowerCase()}`}</b>
                        {labels.join('; ')}{' '}
                        {k === 'Provider' || k === 'Dictation'
                          ? <button style={S.link} onClick={() => { const d = addDoc('Dictation'); setTimeout(() => toggleDictation(d.id), 100) }}>Dictate it</button>
                          : DOC_TYPES.includes(k) && <button style={S.link} onClick={() => addDoc(k)}>Upload the {k.toLowerCase()}</button>}
                      </div>
                    ))}
                  </div>
                )}

                {unconfirmed.length > 0 && (
                  <div style={{ background: C.defBg, color: C.def, borderRadius: 9, padding: '12px 14px', marginBottom: 14, fontSize: 14 }}>
                    <b>{unconfirmed.length} filled from {team.doctor}'s defaults</b>
                    <div>Check each one matches what was used today. Change any that don't.</div>
                    <button style={{ ...S.link, color: C.def, marginTop: 6 }} onClick={confirmAllDefaults}>All correct, confirm them</button>
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
                        {st === 'default' && <span style={S.tag(C.defBg, C.def)}>Default, confirm</span>}
                        {st === 'found' && <span style={S.tag(C.okBg, C.ok)}>From {v.source || 'records'}</span>}
                        {st === 'entered' && <span style={S.tag(C.chip, C.navy)}>Entered</span>}
                        {st === 'na' && <span style={S.tag(C.chip, C.muted)}>Doesn't apply</span>}
                        {st === 'default' && <button style={{ ...S.link, fontSize: 13 }} onClick={() => setVal(f.id, { confirmed: true })}>Confirm</button>}
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
                      {(st === 'found' || st === 'default') && f.evidence && <div style={{ ...S.small, fontSize: 12, marginTop: 4 }}>Record says: “{f.evidence}”</div>}
                      {st === 'missing' && f.why && <div style={{ ...S.small, fontSize: 12, marginTop: 4 }}>{f.why}</div>}
                    </div>
                  )
                })}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button style={S.ghost} disabled={busy} onClick={rerun}>Re-check with new records</button>
                  <button style={S.link} onClick={() => setStage('landing')}>Start a new note</button>
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
                              const f = result.fields.find(x => x.id === m[1])
                              const st = f ? stateOf(f) : 'missing'
                              const v = vals[m[1]]
                              if (st === 'na') return null
                              if (st === 'missing') return <span key={j} style={{ background: C.missBg, color: C.miss, fontWeight: 700, borderRadius: 3 }}>[MISSING: {labelOf(m[1])}]</span>
                              return <span key={j} style={{ background: st === 'default' ? C.defBg : C.okBg, borderRadius: 3 }}>{v.value.trim()}</span>
                            })}
                          </div>
                        )
                      })
                    })()}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button style={{ ...S.btn, opacity: unconfirmed.length ? 0.6 : 1 }} onClick={copy}>Copy note</button>
                    <button style={S.ghost} onClick={download}>Download .txt</button>
                  </div>
                  <p style={{ ...S.small, marginTop: 10 }}>
                    {unconfirmed.length
                      ? `Confirm the ${unconfirmed.length} default${unconfirmed.length > 1 ? 's' : ''} (amber) before copying.`
                      : missing.length
                        ? `${missing.length} blank${missing.length > 1 ? 's' : ''} still marked MISSING. Fill them or remove those lines before signing.`
                        : `Every blank is filled. Read it once more, paste it into Ascend, and ${providerName || 'the dentist'} signs it.`}
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
