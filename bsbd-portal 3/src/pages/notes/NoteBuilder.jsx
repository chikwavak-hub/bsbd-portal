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
import { NOTE_STANDARDS, standardFor } from '../../lib/noteStandards'

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
        const f = { id, sec, inner, ctx, hint: (ctx ? ctx + ': ' : '') + (inner || '(blank)'), label: (!inner || inner === '/') ? (ctx || 'Fill in') : ((ctx ? ctx + ' — ' : '') + short), value: null, status: 'missing' }
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
    if (cur && (m = t.match(/^(label|status|tier|value|source|evidence|look_in|why)\s*:\s*(.*)$/i))) {
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


// Used when Claude doesn't say, and for filling by hand.
function guessTier(f) {
  const t = `${f.label} ${f.hint || ''}`.toLowerCase()
  return /tooth|#|surface|dx|diagnos|pulp|apical|film|pa |radiograph|pre-op|post-op|anesth|carp|mg|agent|consent|provider|credential|canal|wl|length|obtur|irrig|material|composite|cement|bone|section|flap|suture|pd |probing|bop|calculus|quadrant|prior auth|shade|margin|occlus|ianb|infiltration|buccal inf|block/.test(t) ? 'required' : 'optional'
}

// ---------- local anesthetic: formulary items, mg per carpule
const ANES_RE = /lido|xylo|lignospan|octocaine|articaine|septocaine|orabloc|ubistesin|mepiv|carbocaine|polocaine|scandonest|bupiv|marcaine|vivacaine|prilo|citanest|anesthe?tic carp/i
const DRUGS = [
  { name: 'lidocaine', re: /lido|xylo|lignospan|octocaine/i, pct: 2 },
  { name: 'articaine', re: /artic|septocaine|orabloc|ubistesin/i, pct: 4 },
  { name: 'mepivacaine', re: /mepiv|carbocaine|polocaine|scandonest/i, pct: 3 },
  { name: 'bupivacaine', re: /bupiv|marcaine|vivacaine/i, pct: 0.5 },
  { name: 'prilocaine', re: /prilo|citanest/i, pct: 4 },
]
const drugOf = text => DRUGS.find(d => d.re.test(String(text || ''))) || null
const pctOf = text => {
  const t = String(text || ''); const m = t.match(/(\d+(?:\.\d+)?)\s*%/); if (m) return +m[1]
  const d = drugOf(t); if (!d) return null
  if (d.name === 'mepivacaine' && /levo|cobefrin|1:20,?000/i.test(t)) return 2   // 2% with levonordefrin
  return d.pct
}
// 1.7 mL carpule: mg = mL x (% x 10 mg/mL)
const mgFor = (text, carps) => { const p = pctOf(text); return p && carps ? Math.round(carps * 1.7 * p * 10 * 10) / 10 : null }
const itemName = r => String(r?.name || r?.item_name || r?.item || r?.description || r?.product || '').trim()
// Formulary names carry packaging words; the note only needs drug, %, epi and brand
const cleanAgent = n => n.replace(/\b(carpules?|cartridges?|carps?|dental|box(es)?|bx|cs|pk)\b|\b\d+\s*\/\s*(bx|box|pk|cs)\b|\(\s*\d+\s*\)/gi, '').replace(/\s{2,}/g, ' ').replace(/[\s,;-]+$/, '').trim()
const CARP_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8]

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
  const stdList = skel.fields.filter(f => f.std && skel.vals?.[f.id]?.value).map(f => `- ${f.id} (${f.stdLabel}): ${skel.vals[f.id].value}`).join('\n')
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
${stdList ? `STANDARD PROTOCOL, ALREADY FILLED (this office's routine; assume it was done):
${stdList}
For these blanks answer status "standard" and repeat the value, unless a record clearly says something different; then give status "found" with the record's value and add a warning naming the difference.
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
For every blank also give a short plain "label" naming what it is (e.g. "Pre-op PA date", "Cold test #30"), and a "tier": required if a TennCare/Renaissance reviewer needs it to approve this procedure (tooth number, diagnosis and the tests or findings behind it, films, anesthetic agent and amount, what was done, key materials, consent, rendering provider), otherwise optional (vitals, extra detail, nice-to-have wording). Be strict: most templates have 8 to 15 required blanks.
For each missing blank, give "look_in" (one of: ${DOC_TYPES.slice(1).join(', ')}, Provider) and a short "why" the reviewer needs it.
Warnings: every problem a TennCare reviewer would catch in the ORIGINAL records (code doesn't match what's written, missing pre-op film, missing prior auth for D7210, shorthand, copy-forward text, missing signature, limits exceeded, etc.). Short sentences.

FORMAT: plain text only, no JSON, no markdown, no commentary. One block per blank, in order, then one line per warning:
@m1
label: Chief complaint
status: found
tier: required
value: pain on biting, lower right
source: Dictation
evidence: hurts when I bite down
@m2
label: Cold test result
status: missing
tier: required
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
  const [openGroups, setOpenGroups] = useState({})
  const [previewKind, setPreviewKind] = useState('review') // 'review' | 'final'
  const [anesItems, setAnesItems] = useState([])     // local anesthetic names from the Supplies formulary
  const [anesRows, setAnesRows] = useState([{ agent: '', carps: '' }])
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
        try {
          const items = await sbGet('supply_items', 'select=*')
          const names = [...new Set((items || []).filter(r => r?.active !== false && ANES_RE.test(itemName(r)) && !/topical|gel|spray|needle/i.test(itemName(r))).map(r => cleanAgent(itemName(r))).filter(Boolean))].sort()
          setAnesItems(names)
        } catch { /* formulary not available; the picker falls back to saved preferences */ }
        const rows = await sbGet('settings', 'key=eq.noteProfiles&select=value')
        if (rows?.[0]?.value && typeof rows[0].value === 'object') setProfiles(rows[0].value)
      } catch { /* profiles stay empty; the page still works */ }
    })()
    return () => { abortRef.current?.abort(); wantRef.current = null; try { recRef.current?.stop() } catch { /* ignore */ } }
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
    if (dictate) toggleDictation(first.id)
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
  // Browser speech recognition ends on its own after a pause or about a minute
  // (Chrome) or a few seconds of silence (Safari). While the user wants to keep
  // dictating, restart it whenever it ends, until they press stop.
  const wantRef = useRef(null)          // doc id the user wants to dictate into, or null
  const restartsRef = useRef([])        // recent restart times, to catch a broken mic
  const [interim, setInterim] = useState('')

  const stopDictation = () => {
    wantRef.current = null
    setListening(null); setInterim('')
    try { recRef.current?.stop() } catch { /* ignore */ }
  }

  const startRecognizer = id => {
    const rec = new SpeechRec()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = e => {
      let add = '', live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) add += e.results[i][0].transcript
        else live += e.results[i][0].transcript
      }
      setInterim(live)
      if (add.trim()) setDocs(ds => ds.map(d => (d.id === id ? { ...d, text: (d.text ? d.text.replace(/\s*$/, ' ') : '') + add.trim() } : d)))
    }
    rec.onerror = ev => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        wantRef.current = null
        say('Microphone access is blocked. Click the lock icon in the address bar, allow the microphone, then try again.', 'error')
      } else if (ev.error === 'audio-capture') {
        wantRef.current = null
        say('No microphone found. Check that one is plugged in and selected.', 'error')
      }
      // 'no-speech', 'aborted' and 'network' are normal pauses; onend restarts
    }
    rec.onend = () => {
      setInterim('')
      if (wantRef.current !== id) { setListening(cur => (cur === id ? null : cur)); return }
      const now = Date.now()
      restartsRef.current = [...restartsRef.current.filter(t => now - t < 10000), now]
      if (restartsRef.current.length > 6) {   // ending over and over: something is wrong, stop cleanly
        wantRef.current = null; setListening(null)
        say('Dictation keeps cutting out. Check the microphone, or reload the page and try again.', 'error')
        return
      }
      setTimeout(() => { if (wantRef.current === id) { try { startRecognizer(id) } catch { /* ignore */ } } }, 250)
    }
    rec.start()
    recRef.current = rec
  }

  const toggleDictation = id => {
    if (!SpeechRec) { say('Dictation needs Chrome or Safari. You can still type or paste.', 'error'); return }
    const was = wantRef.current
    if (was) stopDictation()
    if (was === id) return
    wantRef.current = id; restartsRef.current = []
    try { startRecognizer(id); setListening(id) }
    catch { wantRef.current = null; say('Could not start the microphone.', 'error') }
  }

  // ----- build
  const teamInfo = { provider: providerName, assistant: team.assistant, office: team.office, dos: team.dos ? new Date(team.dos + 'T12:00:00').toLocaleDateString('en-US') : '' }

  const build = async (confirmed = []) => {
    if (wantRef.current) stopDictation()
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
      skel.vals = v
      const out = await callBuilder(
        { prompt: buildPrompt(section, tpl, mode, skel, records, confirmed, teamInfo, mode === 'addendum' ? {} : prefs), images, pdfs },
        chars => setStatus(s => ({ ...s, text: `Writing the note… (${Math.round(chars / 100) / 10}k characters)` })),
        ctl.signal,
      )
      const got = (out && typeof out.fields === 'object' && out.fields) || {}
      const fields = skel.fields.map(f => {
        const a = got[f.id] || {}
        return { ...f, label: a.label || f.label, status: a.status || 'missing', source: a.source || '', evidence: a.evidence || '', look_in: a.look_in || '', why: a.why || '', na: a.status === 'na', tier: /^opt/i.test(a.tier || '') ? 'optional' : /^req/i.test(a.tier || '') ? 'required' : guessTier(f) }
      })
      fields.forEach(f => {
        const a = got[f.id] || {}
        if (a.value == null || !String(a.value).trim()) return            // keep standard / team value
        const val = String(a.value).trim()
        if (v[f.id]?.standard && (a.status === 'standard' || val === v[f.id].value)) return
        // A dentist's usual material counts as standard; anything from the records is a finding
        const std = a.status === 'default' || a.status === 'standard'
        v[f.id] = { value: val, source: std ? 'Standard protocol' : (a.source || ''), user: false, standard: std }
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
      .filter(({ v }) => v && v.value.trim() && v.user)
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
      v[f.id] = { value: val, source: val ? 'Charting team' : '', user: false }
    })
    r.fields.forEach(f => { if (!f.tier) f.tier = guessTier(f) })
    // Standard protocol: in the note unless removed (never in addenda)
    if (mode !== 'addendum') {
      const off = new Set(prefs.offStandards || [])
      r.fields.forEach(f => {
        const st = standardFor(proc + 1, f.inner, f.ctx)
        if (!st || off.has(st.key)) return
        f.std = st.key; f.stdLabel = st.label
        if (st.byTooth || v[f.id]?.value) return
        const val = st.value(prefs, null, proc + 1)
        if (val) v[f.id] = { value: val, source: 'Standard protocol', user: false, standard: true }
      })
    }
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
    if (v?.excluded) return 'excluded'
    if (!v || !v.value.trim()) return f.na ? 'na' : f.tier === 'optional' ? 'skip' : 'missing'
    if (v.user) return 'entered'
    if (v.standard) return 'std'
    return 'found'
  }
  const labelOf = id => result?.fields.find(x => x.id === id)?.label || id
  const missing = useMemo(() => (result ? result.fields.filter(f => stateOf(f) === 'missing') : []), [result, vals])
  const unconfirmed = []
  const standardList = useMemo(() => (result ? result.fields.filter(f => stateOf(f) === 'std') : []), [result, vals])
  const buckets = useMemo(() => {
    const b = { need: [], confirm: [], optional: [], filled: [] }
    if (!result) return b
    result.fields.forEach(f => {
      const st = stateOf(f)
      ;(st === 'missing' ? b.need : st === 'std' ? b.confirm : ['skip', 'na'].includes(st) ? b.optional : b.filled).push(f)
    })
    return b
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps
  const requiredTotal = result ? result.fields.filter(f => f.tier !== 'optional').length : 0
  const requiredDone = requiredTotal - missing.length - unconfirmed.filter(f => f.tier !== 'optional').length
  const itemsLeft = missing.length + unconfirmed.length
  const jumpTo = id => {
    const f = result?.fields.find(x => x.id === id); if (!f) return
    const g = buckets.optional.includes(f) ? 'optional' : buckets.filled.includes(f) ? 'filled' : null
    if (g) setOpenGroups(o => ({ ...o, [g]: true }))
    setTimeout(() => { const el = document.getElementById(`fld-${id}`); el?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.querySelector('input')?.focus() }, 60)
  }
  const removeStandard = id => setVal(id, { value: '', standard: false, user: true, removed: true })
  const restoreStandards = onlyId => setVals(v => {
    const n = { ...v }; const tooth = toothOf(v)
    result.fields.forEach(f => {
      if (!f.std || !n[f.id]?.removed || (typeof onlyId === 'string' && f.id !== onlyId)) return
      const st = NOTE_STANDARDS.find(x => x.key === f.std)
      const val = st && st.value(prefs, tooth, proc + 1)
      if (val) n[f.id] = { value: val, source: 'Standard protocol', user: false, standard: true }
    })
    return n
  })
  // Ids of the anesthesia-line blanks (carpule count, agent, mg): never a tooth number
  function anesFieldIds() {
    const agent = result?.fields.find(f => f.inner === 'agent, % and epi')
    const line = agent && result.lines.find(l => l.text.includes(`{{${agent.id}}}`))
    return line ? [...line.text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]) : []
  }
  // The tooth for this note: first tooth-number blank with a value 1-32
  const toothOf = v => {
    const skip = new Set(anesFieldIds())
    for (const f of result?.fields || []) {
      if (skip.has(f.id) || !/#|tooth/i.test(`${f.ctx || ''} ${f.label || ''}`)) continue
      const m = String(v[f.id]?.value || '').match(/\b([1-9]|[12]\d|3[0-2])\b/)
      if (m) return +m[1]
    }
    return null
  }
  // ----- anesthetic picker: writes the carpule count, agent and mg blanks of the anesthesia line
  const anesFields = useMemo(() => {
    if (!result) return null
    const agent = result.fields.find(f => f.inner === 'agent, % and epi')
    if (!agent) return null
    const line = result.lines.find(l => l.text.includes(`{{${agent.id}}}`))
    const ids = line ? [...line.text.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]) : []
    const byId = id => result.fields.find(f => f.id === id)
    const ai = ids.indexOf(agent.id)
    const count = ids.slice(0, ai).reverse().map(byId).find(f => f && f.inner === '#')
    const mg = ids.slice(ai + 1).map(byId).find(f => f && f.inner === 'mg')
    return { agent, count, mg }
  }, [result])
  const anesChoices = useMemo(() => [...new Set([...anesItems, prefs.blockAgent, prefs.infilAgent].filter(Boolean))], [anesItems, prefs.blockAgent, prefs.infilAgent])

  // When a note comes back, start the picker from whatever the records or standards filled in
  useEffect(() => {
    if (!anesFields) return
    const agent = vals[anesFields.agent.id]?.value || ''
    const carps = anesFields.count ? (String(vals[anesFields.count.id]?.value || '').match(/\d+(?:\.\d+)?/) || [])[0] || '' : ''
    setAnesRows([{ agent, carps }])
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!anesFields) return
    const agent = vals[anesFields.agent.id]
    if (agent?.value && !anesRows.some(r => r.agent) && agent.source !== 'Anesthetic picker') setAnesRows(rs => [{ ...rs[0], agent: agent.value }, ...rs.slice(1)])
  }, [vals]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyAnes = rows => {
    setAnesRows(rows)
    if (!anesFields) return
    const used = rows.filter(r => r.agent && +r.carps > 0)
    const patch = {}
    if (!used.length) return
    const [first, ...rest] = used
    const agentText = [first.agent, ...rest.map(r => `+ ${r.carps} carp ${r.agent}`)].join(' ')
    patch[anesFields.agent.id] = { value: agentText, source: 'Anesthetic picker', user: true }
    if (anesFields.count) patch[anesFields.count.id] = { value: String(first.carps), source: 'Anesthetic picker', user: true }
    if (anesFields.mg) {
      const mgs = used.map(r => ({ r, mg: mgFor(r.agent, +r.carps) }))
      const ok = mgs.every(x => x.mg != null)
      patch[anesFields.mg.id] = ok
        ? { value: used.length === 1 ? `${mgs[0].mg} mg` : mgs.map(x => `${x.mg} mg ${drugOf(x.r.agent)?.name || x.r.agent}`).join(' + '), source: 'Anesthetic picker', user: true }
        : { value: '', source: '', user: false }
    }
    setVals(v => ({ ...v, ...patch }))
  }

  // Fill tooth-dependent standards (IANB vs infiltration, agent) once the tooth is known
  useEffect(() => {
    if (!result || mode === 'addendum') return
    const tooth = toothOf(vals); if (!tooth) return
    const patch = {}
    result.fields.forEach(f => {
      const st = f.std && NOTE_STANDARDS.find(x => x.key === f.std)
      if (!st?.byTooth) return
      const cur = vals[f.id]
      if (cur?.user || (cur?.value && !cur.standard)) return
      const val = st.value(prefs, tooth, proc + 1)
      if (val && cur?.value !== val) patch[f.id] = { value: val, source: 'Standard protocol', user: false, standard: true }
    })
    if (Object.keys(patch).length) setVals(v => ({ ...v, ...patch }))
  }, [result, vals]) // eslint-disable-line react-hooks/exhaustive-deps

  const warnings = useMemo(() => {
    if (!result) return []
    const w = [...(result.warnings || [])]
    // BSBD protocol (Part 3): no 4% solutions for blocks
    const tech = result.fields.find(f => /IANB \/ buccal inf/i.test(f.inner || ''))
    const agent = result.fields.find(f => f.inner === 'agent, % and epi')
    if (tech && agent && /IANB|block|PSA/i.test(vals[tech.id]?.value || '') && /\b4\s*%|articaine|septocaine|orabloc|citanest/i.test(vals[agent.id]?.value || ''))
      w.unshift('A 4% anesthetic is charted for a block. BSBD protocol: no 4% solutions for blocks. Check the agent or the technique.')
    if (mode === 'addendum') {
      const bad = result.fields.filter(f => { const v = vals[f.id]; return v?.user && v.value.trim() && !v.source })
      if (bad.length) w.unshift(`Addendum entries need a source record: ${bad.map(f => f.label).join(', ')}.`)
      const t = result.fields.filter(f => vals[f.id]?.source === 'Entered by provider today')
      if (t.length) w.unshift(`An addendum can't use values entered today from memory: ${t.map(f => f.label).join(', ')}.`)
    }
    return w
  }, [result, vals, mode])

  // ----- the note, two ways
  // 'review': every unfilled required item shows as [MISSING: ...]
  // 'final' : the note as it would be sent; unfilled items are not mentioned
  // In both, a clause (text up to '.' or ';') holding a left-out, optional-empty
  // or not-applicable blank is dropped, so the note never reads "EPT: ."
  const buildNote = kind => {
    if (!result) return []
    const drop = st => ['skip', 'na', 'excluded'].includes(st) || (kind === 'final' && st === 'missing')
    const out = []; let sec = null
    result.lines.forEach(l => {
      if (l.omit) return
      const clauses = [[]]
      l.text.split(/(\{\{\w+\}\})/).filter(p => p !== '').forEach(p => {
        const m = p.match(/^\{\{(\w+)\}\}$/)
        if (m) { clauses[clauses.length - 1].push({ id: m[1] }); return }
        const pieces = p.split(/(?<=[.;])\s+/)
        pieces.forEach((pc, i) => { if (i > 0) clauses.push([]); clauses[clauses.length - 1].push({ t: pc + (i < pieces.length - 1 ? ' ' : '') }) })
      })
      const segs = []
      clauses.forEach(c => {
        const states = c.filter(x => x.id).map(x => { const f = result.fields.find(y => y.id === x.id); return f ? stateOf(f) : 'missing' })
        if (states.some(drop)) return
        c.forEach(x => {
          if (x.t !== undefined) { segs.push({ k: 'text', t: x.t }); return }
          const f = result.fields.find(y => y.id === x.id); const st = f ? stateOf(f) : 'missing'
          if (st === 'missing') segs.push({ k: 'miss', t: `[MISSING: ${labelOf(x.id)}]`, id: x.id })
          else segs.push({ k: st === 'std' ? 'std' : 'val', t: vals[x.id].value.trim(), id: x.id })
        })
      })
      // tidy: no space before punctuation, no dangling ';' or ',' at the end
      for (let i = 0; i < segs.length; i++) if (segs[i].k === 'text') segs[i].t = segs[i].t.replace(/ +([.,;])/g, '$1').replace(/ {2,}/g, ' ')
      while (segs.length && segs[segs.length - 1].k === 'text' && !segs[segs.length - 1].t.trim()) segs.pop()
      if (!segs.length) return
      const last = segs[segs.length - 1]
      if (last.k === 'text') last.t = last.t.replace(/\s*[;,:]\s*$/, '.').replace(/\s+$/, '')
      if (!segs.some(x => x.k !== 'text' || /[A-Za-z0-9]/.test(x.t))) return
      if (l.section && l.section !== sec) { sec = l.section; out.push({ head: sec }) }
      out.push({ segs })
    })
    return out
  }
  const noteText = (kind = 'final') => buildNote(kind).map(r => (r.head ? r.head : r.segs.map(x => x.t).join('').replace(/ {2,}/g, ' ').trim())).join('\n')
  const excludedList = result ? result.fields.filter(f => stateOf(f) === 'excluded') : []

  const copy = async () => {
    const t = noteText('final')
    try { await navigator.clipboard.writeText(t); say('Final note copied. Paste it into Ascend.') }
    catch {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy'); say('Final note copied. Paste it into Ascend.') } catch { say('Copy was blocked. Select the preview and copy it.', 'error') }
      ta.remove()
    }
  }
  const fileBase = () => `${tpl.name.replace(/[^\w]+/g, '_')}_${(team.dos || today()).replace(/[^\d]+/g, '-')}`
  const downloadTxt = () => {
    const blob = new Blob([noteText('final')], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${fileBase()}_final.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // PDF: letter size, BSBD header, missing items highlighted in the review copy
  const downloadPdf = async kind => {
    let jsPDF
    try { ({ jsPDF } = await import('jspdf')) } catch { say('PDF library not available. Use the .txt download.', 'error'); return }
    const doc = new jsPDF({ unit: 'pt', format: 'letter' })
    const M = 54, PW = 612, PH = 792, W = PW - 2 * M, LH = 14
    let y = M
    const rgb = hex => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
    const newPage = () => { doc.addPage(); y = M }
    const need = h => { if (y + h > PH - M) newPage() }
    // header
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...rgb(C.navy))
    doc.text('Beautiful Smiles by Design', M, y); y += 16
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...rgb(C.muted))
    doc.text(`${kind === 'review' ? 'REVIEW COPY: not for the chart or a claim' : 'Clinical note'}  |  ${section.section}`, M, y); y += 12
    doc.text([providerName && `Rendering provider: ${providerName}`, team.assistant && `Assisted by: ${team.assistant}`, team.office, mode === 'new' && teamInfo.dos && `DOS ${teamInfo.dos}`, mode === 'addendum' && 'Addendum'].filter(Boolean).join('  |  '), M, y); y += 8
    doc.setDrawColor(...rgb(C.gold)); doc.setLineWidth(1.5); doc.line(M, y, PW - M, y); y += 18
    // body with wrapped, styled runs
    const drawRuns = segs => {
      let x = M
      segs.forEach(sg => {
        const style = sg.k === 'miss' ? 'bold' : 'normal'
        doc.setFont('helvetica', style); doc.setFontSize(10.5)
        sg.t.split(/(\s+)/).forEach(word => {
          if (!word) return
          const w = doc.getTextWidth(word)
          if (/^\s+$/.test(word)) { if (x > M) x += w; return }
          if (x + w > M + W && x > M) { x = M; y += LH; need(LH) }
          if (sg.k === 'miss') { doc.setFillColor(...rgb(C.missBg)); doc.rect(x - 1, y - 9.5, w + 2, 13, 'F'); doc.setTextColor(...rgb(C.miss)) }
          else doc.setTextColor(...rgb(C.ink))
          doc.text(word, x, y); x += w
        })
      })
      y += LH + 2
    }
    buildNote(kind).forEach(r => {
      if (r.head) { need(LH * 2); y += 4; doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...rgb(C.teal)); doc.text(r.head, M, y); y += LH; return }
      need(LH); drawRuns(r.segs)
    })
    if (kind === 'review') {
      const block = (title, items, color) => {
        if (!items.length) return
        need(LH * 3); y += 10
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...rgb(color)); doc.text(title, M, y); y += LH
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...rgb(C.ink))
        items.forEach(t => { doc.splitTextToSize(`- ${t}`, W).forEach(line => { need(LH); doc.text(line, M, y); y += 13 }) })
      }
      block(`Still missing (${missing.length})`, missing.map(f => `${f.label}${f.look_in ? ` (look in: ${f.look_in})` : ''}`), C.miss)
      block(`Left out on purpose (${excludedList.length})`, excludedList.map(f => f.label), C.muted)
      block('Problems a reviewer would catch in the original', warnings, C.warn)
    }
    const pages = doc.getNumberOfPages()
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...rgb(C.muted))
      doc.text(`${kind === 'review' ? 'Review copy' : 'Final note'}  |  page ${i} of ${pages}`, M, PH - 30)
    }
    doc.save(`${fileBase()}_${kind}.pdf`)
  }

  const groups = {}
  missing.forEach(f => { const k = f.look_in || 'Provider'; (groups[k] = groups[k] || []).push(f.label) })

  // One blank: label, quick-pick chips for choices, a text box, and the source in addenda.
  // Called as a function (not <FieldRow/>) so inputs keep focus while typing.
  const FieldRow = ({ f }) => {  // eslint-disable-line react/display-name
    const v = vals[f.id] || { value: '', source: '' }
    const st = stateOf(f)
    return (
      <div key={f.id} id={`fld-${f.id}`} style={{ borderTop: `1px solid ${C.line}`, padding: '9px 0' }}>
        <div style={{ fontSize: 13, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>{f.label}</span>
          {st === 'entered' && <span style={S.tag(C.okBg, C.ok)}>Done</span>}
          {st === 'missing' && <button style={{ ...S.link, fontSize: 13, color: C.muted }} title="Can't or won't be added: the note won't mention it" onClick={() => setVal(f.id, { excluded: true })}>Leave out</button>}
          {st === 'excluded' && <><span style={S.tag(C.chip, C.muted)}>Left out of the note</span><button style={{ ...S.link, fontSize: 13 }} onClick={() => setVal(f.id, { excluded: false })}>Put back</button></>}
          {st === 'std' && <><span style={S.tag(C.defBg, C.def)}>Standard</span><button style={{ ...S.link, fontSize: 13 }} onClick={() => removeStandard(f.id)}>Remove</button></>}
          {f.std && vals[f.id]?.removed && <button style={{ ...S.link, fontSize: 13 }} onClick={() => restoreStandards(f.id)}>Put standard back</button>}
          {st === 'found' && <span style={S.tag(C.okBg, C.ok)}>{v.source || 'records'}</span>}
          {st === 'na' && <span style={S.tag(C.chip, C.muted)}>Doesn't apply</span>}
        </div>
        {f.options?.length > 0 && st !== 'excluded' && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {f.options.map(o => (
              <button key={o} onClick={() => setVal(f.id, { value: o, user: true })}
                style={{ font: 'inherit', fontSize: 13, borderRadius: 16, padding: '5px 11px', cursor: 'pointer', border: `1px solid ${v.value === o ? C.navy : C.line}`, background: v.value === o ? C.navy : '#fff', color: v.value === o ? '#fff' : C.ink }}>{o}</button>
            ))}
          </div>
        )}
        {st !== 'excluded' && <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <input style={{ ...S.input, flex: 1, minWidth: 180, padding: '7px 9px' }} value={v.value} aria-label={f.label}
            placeholder={f.options?.length ? 'or type' : (st === 'missing' && f.why ? f.why : 'Type it in')} onChange={e => setVal(f.id, { value: e.target.value, user: true })} />
          {mode === 'addendum' && v.user && (
            <select style={{ ...S.input, minWidth: 150 }} value={v.source || ''} onChange={e => setVal(f.id, { source: e.target.value })}>
              <option value="">Recorded in…</option>
              {NOTE_SOURCES.filter(x => x !== 'Entered by provider today').map(x => <option key={x}>{x}</option>)}
            </select>
          )}
        </div>}
        {st === 'found' && f.evidence && <div style={{ ...S.small, fontSize: 12, marginTop: 3 }}>Record says: “{f.evidence}”</div>}
      </div>
    )
  }

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
          {stage === 'build' && <button style={{ ...S.ghost, background: 'transparent', color: '#fff', borderColor: '#fff' }} onClick={() => { if (wantRef.current) stopDictation(); setStage('landing') }}>Change team or procedure</button>}
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
                <p style={{ ...S.small, margin: '4px 0 0' }}>Only names of materials and techniques. They go into the note as standard protocol when the dictation or note doesn't name a different product, and staff remove any that weren't used. They never stand in for findings, amounts or tooth numbers.</p>
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
                <div style={S.h3}>Standard protocol in {team.doctor}'s notes</div>
                <p style={{ ...S.small, margin: '0 0 8px' }}>Ticked items go into every note as written until someone removes them for that visit. Untick anything this dentist doesn't do routinely.</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {NOTE_STANDARDS.map(st => {
                    const on = !(draftPrefs.offStandards || []).includes(st.key)
                    return <button key={st.key} onClick={() => setDraftPrefs(p => { const off = new Set(p.offStandards || []); on ? off.add(st.key) : off.delete(st.key); return { ...p, offStandards: [...off] } })}
                      style={{ ...S.input, cursor: 'pointer', fontSize: 13, background: on ? C.navy : '#fff', color: on ? '#fff' : C.muted, textDecoration: on ? 'none' : 'line-through' }}>{st.label}</button>
                  })}
                </div>
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
                  ? <button style={{ ...(listening === d.id ? S.btn : S.ghost), padding: '6px 12px', fontSize: 13, ...(listening === d.id ? { background: C.miss, border: `1px solid ${C.miss}` } : {}) }} onClick={() => toggleDictation(d.id)}>
                      {listening === d.id ? '● Recording, click to stop' : 'Start dictating'}
                    </button>
                  : <input type="file" accept=".txt,.docx,.pdf,image/*,.md" onChange={e => readFile(d, e.target.files[0])} />}
                {d.name && <span style={S.small}>Loaded: {d.name}</span>}
                {i > 0 && <button style={S.link} onClick={() => { if (listening === d.id) toggleDictation(d.id); setDocs(ds => ds.filter(x => x.id !== d.id)) }}>Remove</button>}
              </div>
              {d.preview && <img src={d.preview} alt="Uploaded screenshot" style={{ maxHeight: 90, borderRadius: 6, border: `1px solid ${C.line}` }} />}
              {d.kind === 'pdf' && <div style={S.small}>PDF attached. It goes to Claude as is, so remove patient identifiers from it first.</div>}
              {listening === d.id && <div style={{ ...S.small, marginTop: 6, color: C.miss }}>● Listening{interim ? `: ${interim}` : '… pauses are fine, it keeps recording until you press stop.'}</div>}
              <textarea style={S.area} value={d.text} onChange={e => updateDoc(d.id, { text: e.target.value })}
                placeholder={d.type === 'Dictation' ? 'Speak the visit: tooth, complaint, tests, diagnosis, anesthetic and carpules, what you did, materials, outcome, next visit. Skip the patient name.' : d.kind !== 'text' ? 'Attachment added. Add any notes here (optional).' : `Paste the ${d.type.toLowerCase()} here`} />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button style={{ ...S.ghost, padding: '6px 12px', fontSize: 13 }} onClick={() => addDoc()}>Add a supporting record</button>
            <button style={{ ...S.ghost, padding: '6px 12px', fontSize: 13 }} onClick={() => { const d = addDoc('Dictation'); toggleDictation(d.id) }}>Add dictation</button>
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
                <div style={{ fontSize: 18, fontWeight: 700, color: itemsLeft ? C.navy : C.ok }}>
                  {itemsLeft ? `${itemsLeft} item${itemsLeft > 1 ? 's' : ''} left before this note holds up` : 'Ready to copy into Ascend'}
                </div>
                <div style={{ ...S.small, marginTop: 2 }}>{requiredDone} of {requiredTotal} things a TennCare reviewer looks for are done. Click anything in the preview to change it.</div>
                <div style={{ height: 8, background: C.chip, borderRadius: 6, overflow: 'hidden', margin: '8px 0 14px' }}>
                  <div style={{ height: '100%', background: C.teal, width: `${requiredTotal ? Math.round(requiredDone / requiredTotal * 100) : 100}%` }} />
                </div>

                {warnings.length > 0 && (
                  <details style={{ background: C.warnBg, color: C.warn, borderRadius: 9, padding: '10px 14px', marginBottom: 14, fontSize: 14 }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{warnings.length} problem{warnings.length > 1 ? 's' : ''} a reviewer would catch in the original</summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}

                {anesFields && (
                  <div style={{ marginBottom: 16, border: `1px solid ${C.line}`, borderRadius: 9, padding: '10px 12px' }}>
                    <div style={{ fontWeight: 700, color: C.navy, fontSize: 15 }}>Local anesthetic</div>
                    <div style={{ ...S.small, margin: '2px 0 8px' }}>{anesItems.length ? 'From the Supplies formulary.' : 'Formulary not loaded; showing saved preferences.'} The mg total is worked out for 1.7 mL carpules.</div>
                    {anesRows.map((r, i) => {
                      const mg = mgFor(r.agent, +r.carps)
                      const choices = r.agent && !anesChoices.includes(r.agent) ? [r.agent, ...anesChoices] : anesChoices
                      const set = patch => applyAnes(anesRows.map((x, j) => (j === i ? { ...x, ...patch } : x)))
                      return (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: i ? 8 : 0 }}>
                          <select aria-label="Carpules" style={{ ...S.input, width: 92 }} value={r.carps} onChange={e => set({ carps: e.target.value })}>
                            <option value="">Carps…</option>
                            {CARP_OPTIONS.map(n => <option key={n} value={n}>{n} carp{n === 1 ? '' : 's'}</option>)}
                          </select>
                          <select aria-label="Anesthetic" style={{ ...S.input, flex: 1, minWidth: 220 }} value={r.agent} onChange={e => set({ agent: e.target.value })}>
                            <option value="">Choose anesthetic…</option>
                            {choices.map(n => <option key={n} value={n}>{n}</option>)}
                          </select>
                          <span style={{ ...S.small, minWidth: 70, fontWeight: 700, color: mg ? C.ok : C.muted }}>{mg ? `${mg} mg` : r.agent && r.carps ? 'add % to item' : ''}</span>
                          {anesRows.length > 1 && <button style={{ ...S.link, fontSize: 13 }} onClick={() => applyAnes(anesRows.filter((_, j) => j !== i))}>Remove</button>}
                        </div>
                      )
                    })}
                    <button style={{ ...S.link, fontSize: 13, marginTop: 8 }} onClick={() => setAnesRows(rs => [...rs, { agent: '', carps: '' }])}>+ Another anesthetic</button>
                  </div>
                )}

                {buckets.need.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, color: C.miss, fontSize: 15 }}>Needs you ({missing.length})</div>
                    <div style={{ ...S.small, margin: '2px 0 6px' }}>
                      Type it or tap a choice.{' '}
                      {Object.keys(groups).filter(k => k !== 'Provider' && DOC_TYPES.includes(k) && k !== 'Dictation').map(k => (
                        <span key={k}><button style={{ ...S.link, fontSize: 13 }} onClick={() => addDoc(k)}>Upload the {k.toLowerCase()}</button> · </span>
                      ))}
                      <button style={{ ...S.link, fontSize: 13 }} onClick={() => { const d = addDoc('Dictation'); toggleDictation(d.id) }}>Dictate the rest</button>
                      {' '}then Re-check.
                    </div>
                    {buckets.need.filter(f => stateOf(f) !== 'std').map(f => FieldRow({ f }))}
                  </div>
                )}

                {(standardList.length > 0 || buckets.confirm.length > 0) && (
                  <div style={{ marginBottom: 16, background: C.defBg, borderRadius: 9, padding: '10px 12px' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <div style={{ fontWeight: 700, color: C.def, fontSize: 15 }}>Standard protocol, in the note unless you remove it ({standardList.length})</div>
                      {result.fields.some(f => vals[f.id]?.removed) && <button style={{ ...S.link, color: C.def, fontSize: 13 }} onClick={() => restoreStandards()}>Put all back</button>}
                    </div>
                    <div style={{ ...S.small, color: C.def, margin: '2px 0 8px' }}>Remove anything that wasn't done this visit. The rest goes into the note as written.</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {standardList.map(f => (
                        <span key={f.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: '#fff', border: `1px solid ${C.line}`, borderRadius: 16, padding: '4px 6px 4px 11px', fontSize: 13 }}>
                          <span><b style={{ fontWeight: 700 }}>{f.stdLabel || f.label}</b>: {vals[f.id].value}</span>
                          <button aria-label={`Remove ${f.stdLabel || f.label}`} title="Remove" onClick={() => removeStandard(f.id)}
                            style={{ border: 0, background: C.chip, color: C.ink, width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', lineHeight: '20px', padding: 0, fontSize: 13 }}>×</button>
                        </span>
                      ))}
                    </div>
                    {buckets.confirm.filter(f => stateOf(f) !== 'std').map(f => FieldRow({ f }))}
                  </div>
                )}

                {buckets.optional.length > 0 && (
                  <details open={!!openGroups.optional} onToggle={e => { const o = e.currentTarget.open; setOpenGroups(g => (g.optional === o ? g : { ...g, optional: o })) }} style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, color: C.navy }}>Optional details ({buckets.optional.length})</summary>
                    <div style={{ ...S.small, margin: '4px 0 6px' }}>Not needed for TennCare. Add any you have and that line comes back into the note.</div>
                    {buckets.optional.filter(f => stateOf(f) !== 'std').map(f => FieldRow({ f }))}
                  </details>
                )}

                {buckets.filled.length > 0 && (
                  <details open={!!openGroups.filled} onToggle={e => { const o = e.currentTarget.open; setOpenGroups(g => (g.filled === o ? g : { ...g, filled: o })) }} style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, color: C.navy }}>Filled from the records ({buckets.filled.length})</summary>
                    {buckets.filled.filter(f => stateOf(f) !== 'std').map(f => FieldRow({ f }))}
                  </details>
                )}

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                  <button style={S.ghost} disabled={busy} onClick={rerun}>Re-check with new records</button>
                  <button style={S.link} onClick={() => setStage('landing')}>Start a new note</button>
                </div>
              </div>

              <div>
                <div style={{ position: 'sticky', top: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 700, color: C.navy }}>Note preview</div>
                    <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                      {[['review', 'Review copy'], ['final', 'Final note']].map(([k, t]) => (
                        <button key={k} onClick={() => setPreviewKind(k)} aria-pressed={previewKind === k}
                          style={{ border: 0, padding: '5px 11px', font: 'inherit', fontSize: 13, cursor: 'pointer', background: previewKind === k ? C.navy : '#fff', color: previewKind === k ? '#fff' : C.ink }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <div style={S.note}>
                    {buildNote(previewKind).map((r, i) => r.head
                      ? <div key={i} style={{ fontFamily: 'Arial, sans-serif', fontWeight: 700, color: C.teal, marginTop: 8 }}>{r.head}</div>
                      : <div key={i}>{r.segs.map((sg, j) => sg.k === 'text'
                          ? <span key={j}>{sg.t}</span>
                          : <span key={j} onClick={() => jumpTo(sg.id)} title={sg.k === 'miss' ? 'Click to fill or leave out' : 'Click to edit'}
                              style={{ cursor: 'pointer', borderRadius: 3, ...(sg.k === 'miss' ? { background: C.missBg, color: C.miss, fontWeight: 700 } : previewKind === 'review' ? { background: sg.k === 'std' ? C.defBg : C.okBg } : {}) }}>{sg.t}</span>)}</div>)}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button style={S.btn} onClick={copy}>Copy final note</button>
                    <button style={S.ghost} onClick={() => downloadPdf('review')}>Review copy (PDF)</button>
                    <button style={S.ghost} onClick={() => downloadPdf('final')}>Final note (PDF)</button>
                    <button style={{ ...S.link, fontSize: 13 }} onClick={downloadTxt}>Final .txt</button>
                  </div>
                  <p style={{ ...S.small, marginTop: 10 }}>
                    {unconfirmed.length
                      ? `Confirm the ${unconfirmed.length} usual material${unconfirmed.length > 1 ? 's' : ''} (amber) before copying.`
                      : missing.length
                        ? `${missing.length} required item${missing.length > 1 ? 's are' : ' is'} still missing. The final note leaves ${missing.length > 1 ? 'them' : 'it'} out; fill ${missing.length > 1 ? 'them' : 'it'}, or mark Leave out if ${missing.length > 1 ? 'they' : 'it'} can't be added.`
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
