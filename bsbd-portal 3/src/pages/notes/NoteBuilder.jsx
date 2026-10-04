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
import { addonsFor, addonByKey } from '../../lib/noteAddons'
import ToothChart from './ToothChart'
import { toothInfo, canalsFor, addCanal, refPoint, rctCode, surfacesFor, compositeCode, surfaceString, extractionNotes, postCanal, CROWN_MATERIALS, PFM_METALS, crownCode, opposingTooth, QUADS, srpCode, pulpotomyNotes, sortTeeth } from '../../lib/toothAnatomy'

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

// "Clinical Notes That Hold Up" sections (0-based index into NOTE_TEMPLATES) that get tooth-aware help
const SEC = { srp: 2, fill: 5, rct: 7, buildup: 8, crownPrep: 9, crownSeat: 10, cerec: 11, ext: 12, surgExt: 13, sdf: 20, pulp: 21 }
const MULTI_SECTIONS = new Set([SEC.srp, SEC.sdf])          // pick several teeth instead of one
// Same procedure on several teeth in one note: these lines repeat once per tooth
const REPEAT_LINES = {
  [SEC.fill]: [/^#\[ \] \[surfaces\]/, /^Dx: #\[ \]/, /^Scotchbond/],
  [SEC.buildup]: [/^#\[ \]: coronal/, /^Core buildup with/],
  [SEC.crownPrep]: [/^#\[ \]: \[surfaces involved\]/, /^Opposing:/, /^Dx: #\[ \]/, /Prepped for/],
  [SEC.crownSeat]: [/^Try-in:/, /^Crown type:/],
  [SEC.ext]: [/^#\[ \]: \[non-restorable/, /^Dx: #\[ \]/, /^#\[ \] extracted with/],
  [SEC.surgExt]: [/^#\[ \]: \[findings\]/, /^Dx: #\[ \]/, /^Prior auth:/, /full-thickness flap/, /^Tooth\/roots delivered/],
  [SEC.pulp]: [/^#\[ \]: \[caries depth/, /^Dx: #\[ \]/, /^Isolation:/, /^Medicament:/],
}
const MULTI_TOOTH = new Set(Object.keys(REPEAT_LINES).map(Number))
// One code per tooth for these; fillings work out each tooth's code from its surfaces
const PER_TOOTH_CODE = { [SEC.buildup]: 'D2950', [SEC.ext]: 'D7140', [SEC.surgExt]: 'D7210', [SEC.pulp]: 'D3220' }
const TOOTH_SECTIONS = new Set(Object.values(SEC))

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

// Split "a / b [x / y] / c" on the top-level slashes only
function splitTop(str) {
  const out = []; let dep = 0, cur = ''
  for (const ch of str) {
    if (ch === '[' || ch === '{') dep++
    if (ch === ']' || ch === '}') dep--
    if (ch === '/' && dep === 0) { out.push(cur.trim()); cur = '' } else cur += ch
  }
  out.push(cur.trim())
  return out.filter(Boolean)
}

// Turns template lines into {lines, fields} for filling by hand (no AI).
function localParse(lines, prefix = 'm') {
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
        const id = prefix + (++k)
        const last = res.split(/\{\{\w+\}\}/).pop().replace(/[^A-Za-z0-9#/ ]/g, ' ').trim()
        const ctx = last.split(/\s+/).filter(Boolean).slice(-3).join(' ')
        const short = inner.length > 55 ? inner.slice(0, 52) + '…' : inner
        const f = { id, sec, inner, ctx, brace: c === '{', hint: (ctx ? ctx + ': ' : '') + (inner || '(blank)'), label: (!inner || inner === '/') ? (ctx || 'Fill in') : ((ctx ? ctx + ' — ' : '') + short), value: null, status: 'missing' }
        if (c === '{' && inner.includes('/')) { const opts = splitTop(inner); if (opts.length > 1) f.options = opts }
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
    if (cur && (m = t.match(/^(label|status|tier|risk|value|source|evidence|look_in|why)\s*:\s*(.*)$/i))) {
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
const RISK = {
  denial: { label: 'Denial risk', rank: 0, fg: '#B42318', bg: '#FDECEA' },
  high: { label: 'High', rank: 1, fg: '#8A5A00', bg: '#FFF3D6' },
  low: { label: 'Low', rank: 2, fg: '#5E6577', bg: '#EEF1F8' },
}
function guessRisk(f) {
  const t = `${f.label} ${f.hint || ''}`.toLowerCase()
  if (/tooth|#|surface|dx|diagnos|pulpal|apical|cold|percussion|palpation|probing|pd |cal\b|bone loss|pre-op|pre op|prior auth|provider|credential|bone removed|section|coronal|walls|cusps|non.?restorable|quadrant|stage|grade/.test(t)) return 'denial'
  if (/anesth|carp|mg|agent|consent|post-op|post op|obtur|irrig|naocl|material|cement|composite|isolation|ianb|infiltration|wl|length/.test(t)) return 'high'
  return 'low'
}
const riskOf = f => RISK[f.risk] ? f.risk : guessRisk(f)

function guessTier(f) {
  const t = `${f.label} ${f.hint || ''}`.toLowerCase()
  return /tooth|#|surface|dx|diagnos|date|taken|finish|product|medicament|hemostasis|restoration|crown type|findings|cc\b|complaint|pain|allerg|meds|nv\b|procedure|cold|percussion|palpation|pulp|apical|film|pa |radiograph|pre-op|post-op|anesth|carp|mg|agent|consent|provider|credential|canal|wl|length|obtur|irrig|material|composite|cement|bone|section|flap|suture|pd |probing|bop|calculus|quadrant|prior auth|shade|margin|occlus|ianb|infiltration|buccal inf|block/.test(t) ? 'required' : 'optional'
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

function buildPrompt(section, tpl, mode, skel, records, confirmed, team, prefs, toothCtx) {
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

${toothCtx ? `TOOTH (picked by staff): ${toothCtx}. Blanks for this tooth are already filled; use this tooth throughout.\n` : ''}
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
For each missing blank, give "look_in" (one of: ${DOC_TYPES.slice(1).join(', ')}, Provider), a short "why" the reviewer needs it, and a "risk":
- denial: without it Renaissance would likely deny or recoup this code (tooth/surfaces, the diagnosis and the tests or findings behind it, pre-op film, prior authorization, what was done that defines the code, rendering provider)
- high: commonly requested or weakens the claim (anesthetic agent and amount, consent, post-op film, key materials)
- low: good documentation practice, unlikely to affect payment.

FORMAT: plain text only, no JSON, no markdown, no commentary. One block per blank, in order:
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
risk: denial
look_in: Exam note
why: Shows the diagnosis was tested
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
  const [tooth, setTooth] = useState('')
  const [canals, setCanals] = useState([])
  const [surfaces, setSurfaces] = useState([])      // surfaces of the first tooth
  const [moreTeeth, setMoreTeeth] = useState([])    // more teeth with the same procedure
  const [moreSurf, setMoreSurf] = useState({})      // their surfaces, by tooth
  const [primaryChart, setPrimaryChart] = useState(false)
  const [quad, setQuad] = useState('')
  const [srpTeeth, setSrpTeeth] = useState([])
  const [crownMat, setCrownMat] = useState('')
  const [pfmMetal, setPfmMetal] = useState('')
  const [sdfTeeth, setSdfTeeth] = useState([])
  const [sdfProduct, setSdfProduct] = useState('D1354')
  const [addons, setAddons] = useState({})   // key -> 'in' (part of this note) | 'separate' (its own note)
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
  const [entry, setEntry] = useState('records')       // 'records': built from notes/dictation · 'template': filled in by hand
  const [formView, setFormView] = useState('focus')   // 'focus': what's needed first · 'all': every blank in note order
  const [pendingTemplate, setPendingTemplate] = useState(false)
  const [customText, setCustomText] = useState('')
  const [customSec, setCustomSec] = useState('P')
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

  const start = (procIdx, how) => {   // how: 'dictate' | 'upload' | 'template'
    const dictate = how === 'dictate'
    if (!team.doctor) { say('Pick the dentist first.', 'error'); return }
    if (procIdx != null) { setProc(procIdx); setTplIdx(0) }
    setResult(null); setVals({}); setStatus({ text: '', err: false }); setTooth(''); setCanals([]); setSurfaces([]); setMoreTeeth([]); setMoreSurf({}); setPrimaryChart(false); setQuad(''); setSrpTeeth([]); setCrownMat(''); setPfmMetal(''); setSdfTeeth([]); setAddons({})
    const first = newDoc(dictate ? 'Dictation' : DOC_TYPES[0])
    setDocs([first]); setStage('build')
    setEntry(how === 'template' ? 'template' : 'records'); setFormView(how === 'template' ? 'all' : 'focus')
    if (how === 'template') setPendingTemplate(true)
    if (dictate) toggleDictation(first.id)
    window.scrollTo?.(0, 0)
  }

  useEffect(() => { if (pendingTemplate && stage === 'build') { setPendingTemplate(false); blank() } }, [pendingTemplate, stage, proc]) // eslint-disable-line react-hooks/exhaustive-deps

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
        { prompt: buildPrompt(section, tpl, mode, skel, records, confirmed, teamInfo, mode === 'addendum' ? {} : prefs, toothContext()), images, pdfs },
        chars => setStatus(s => ({ ...s, text: `Writing the note… (${Math.round(chars / 100) / 10}k characters)` })),
        ctl.signal,
      )
      const got = (out && typeof out.fields === 'object' && out.fields) || {}
      const fields = skel.fields.map(f => {
        const a = got[f.id] || {}
        return { ...f, label: a.label || f.label, status: a.status || 'missing', source: a.source || '', evidence: a.evidence || '', look_in: a.look_in || '', why: a.why || '', risk: /^den/i.test(a.risk || '') ? 'denial' : /^hi/i.test(a.risk || '') ? 'high' : /^lo/i.test(a.risk || '') ? 'low' : guessRisk(f), na: a.status === 'na', tier: /^opt/i.test(a.tier || '') ? 'optional' : /^req/i.test(a.tier || '') ? 'required' : guessTier(f) }
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
      setResult({ lines: withCustom(lines, (result?.lines || []).filter(l => l.custom)), fields, warnings: Array.isArray(out?.warnings) ? out.warnings : [] }); setVals(v)
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

  // ----- tooth-aware tailoring
  // Everything the procedure picker knows about the case. o = overrides so a change can
  // rebuild the note before React state settles.
  const caseOf = (o = {}) => ({
    tooth: o.tooth ?? tooth, canals: o.canals ?? canals, surfaces: o.surfaces ?? surfaces,
    moreTeeth: o.moreTeeth ?? moreTeeth, moreSurf: o.moreSurf ?? moreSurf,
    quad: o.quad ?? quad, srpTeeth: o.srpTeeth ?? srpTeeth, crownMat: o.crownMat ?? crownMat, pfmMetal: o.pfmMetal ?? pfmMetal,
    sdfTeeth: o.sdfTeeth ?? sdfTeeth, sdfProduct: o.sdfProduct ?? sdfProduct, addons: o.addons ?? addons,
  })
  const toothList = list => sortTeeth(list).map(t => `#${t}`).join(', ')

  // The template rewritten for this case: RCT gets one working-length entry per canal,
  // SRP one probing entry per tooth, SDF one lesion line per tooth.
  const tailoredLines = (o = {}) => {
    const k = caseOf(o)
    const base = tailoredBase(o)
    const all = [k.tooth, ...k.moreTeeth].filter(t => toothInfo(t))
    if (!MULTI_TOOTH.has(proc) || all.length < 2) return base
    const rules = REPEAT_LINES[proc]
    const out = []
    base.forEach(l => {
      if (rules.some(re => re.test(l))) {
        all.forEach(t => {
          let x = l.includes('#[ ]') ? l.replace('#[ ]', `#${t}`) : `#${t}: ${l}`
          x = x.replace('[surfaces]', `[#${t} surfaces]`).replace('[M/O/D/B/L/I/F]', `[#${t} final surfaces]`)
          out.push(x)
        })
      } else if (/^Pt presents for .*#\[ \]/.test(l)) out.push(l.replace('#[ ]', toothList(all)))
      else out.push(l)
    })
    return out
  }
  const tailoredBase = (o = {}) => {
    const k = caseOf(o)
    const ti = toothInfo(k.tooth)
    if (proc === SEC.rct && ti && !ti.primary && k.canals.length) {
      const cs = k.canals
      const named = cs.filter(c => c !== 'Canal')
      const listText = cs.length === 1 && cs[0] === 'Canal' ? 'single canal (1 canal)' : `${named.join(', ')} (${cs.length} canal${cs.length > 1 ? 's' : ''})`
      return tpl.lines.map(l => {
        if (/^Rubber dam isolation\./.test(l)) return l.replace(/Canals located: \[[^\]]*\] \(\[#\] canals\)\./, `Canals located: ${listText}.`)
        if (/^WL \(apex locator/.test(l)) return `WL (apex locator {+ radiograph}): ${cs.map(c => `${c === 'Canal' ? '' : c + ' '}[${c} WL mm] mm to [${c} ref: ${refPoint(c, k.tooth)}]`).join('; ')}.`
        return l
      })
    }
    if (proc === SEC.srp && k.quad && k.srpTeeth.length) {
      const teeth = sortTeeth(k.srpTeeth)
      return tpl.lines.map(l => {
        if (/^Pt presents for SRP/.test(l)) return l.replace('[UR/UL/LL/LR]', k.quad)
        if (/^Perio charting dated/.test(l)) return l.replace(/Qualifying teeth this quad: .*$/, `Qualifying teeth this quad: ${toothList(teeth)} (${teeth.length}).`)
        if (/^Per tooth:/.test(l)) return l.replace(/^Per tooth: PD \[max mm\], CAL \[mm\], radiographic bone loss/, `Per tooth: ${teeth.map(t => `#${t} PD [#${t} PD mm] mm, CAL [#${t} CAL mm] mm`).join('; ')}. Radiographic bone loss`)
        if (/^Scaled and root planed #\[ \]/.test(l)) return l.replace('#[ ]', toothList(teeth))
        return l
      })
    }
    if (proc === SEC.sdf && k.sdfTeeth.length) {
      const teeth = sortTeeth(k.sdfTeeth)
      return tpl.lines.map(l => {
        if (/^#\[ \] \[surface\]: active lesion/.test(l)) return `${teeth.map(t => `#${t} [#${t} surface]: active lesion, {cavitated / non-cavitated}.`).join(' ')} [Film type, date]: [ ].`
        if (/^History checked in Ascend: #\[ \]/.test(l)) return l.replace('#[ ]', toothList(teeth))
        if (/^Dx: active caries #\[ \]/.test(l)) return l.replace('#[ ]', toothList(teeth))
        if (/applied to #\[ \], #\[ \], #\[ \], #\[ \]/.test(l)) return l.replace(/applied to #\[ \], #\[ \], #\[ \], #\[ \] \(\[#\] teeth; max 4\)/, `applied to ${toothList(teeth)} (${teeth.length} teeth; max 4)`)
        return l
      })
    }
    return tpl.lines
  }

  // The template split into lines and blanks, with the charting team and the case filled in.
  const skeleton = (o = {}) => {
    const k = caseOf(o)
    const ti = toothInfo(k.tooth)
    const r = localParse(tailoredLines(o))
    // Add-ons: their lines go at the end of the matching section (P lines before "Pt tolerated...")
    Object.entries(k.addons).forEach(([key, how]) => {
      const a = addonByKey(key); if (!a || !how) return
      const p = localParse(a.lines, `a_${key}_`)
      p.fields.forEach(f => { f.addon = key })
      p.lines.forEach(l => {
        const line = { ...l, addon: key }
        let at = -1
        r.lines.forEach((x, i) => { if (x.section === l.section && !(l.section === 'P' && /^Pt tolerated/.test(x.text))) at = i })
        if (l.section === 'P') { const tol = r.lines.findIndex(x => /^Pt tolerated/.test(x.text)); if (tol >= 0) at = Math.min(at < 0 ? tol - 1 : at, tol - 1) }
        if (at < 0) r.lines.push(line); else r.lines.splice(at + 1, 0, line)
      })
      r.fields.push(...p.fields)
    })
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
    const picked = (id, value, extra = {}) => { v[id] = { value, source: 'Picked', user: false, ...extra } }
    const crown = crownCode(k.crownMat, k.pfmMetal)
    r.fields.forEach(f => {
      let m
      const inner = f.inner || ''
      // the treated tooth goes in every "#[ ]" (not the control tooth)
      if (ti && !inner && /#$/.test(f.ctx || '') && !/control/i.test(f.ctx || '') && !v[f.id]?.value) {
        const all = [k.tooth, ...k.moreTeeth].filter(t => toothInfo(t))
        picked(f.id, all.length > 1 && MULTI_TOOTH.has(proc) ? sortTeeth(all).map((t, i) => (i ? `#${t}` : String(t))).join(', ') : String(ti.n))
      }
      // several teeth: each tooth's own surfaces
      else if ((m = inner.match(/^#(\w+) (final )?surfaces$/))) {
        const t = m[1]; const list = t === String(k.tooth) ? k.surfaces : (k.moreSurf[t] || [])
        f.label = `#${t} ${m[2] ? 'final surfaces' : 'surfaces'}`; f.tier = 'required'; f.risk = 'denial'
        if (list.length) picked(f.id, surfaceString(list, t))
      }
      // RCT: access sealed with a core when a buildup or post add-on is on
      else if (/^Access sealed with \[temporary material\] \/ core buildup/.test(inner) && (k.addons.buildup || k.addons.post || k.addons.castPost)) {
        const which = k.addons.post ? 'prefabricated post and core' : k.addons.castPost ? 'cast post and core' : 'core buildup'
        const where = (k.addons.post || k.addons.buildup || k.addons.castPost) === 'separate' ? 'see separate note' : 'see below'
        picked(f.id, `Access sealed with ${which} (${where})`)
      }
      // RCT
      else if (inner === '+ radiograph') { f.label = 'WL confirmed with radiograph'; f.tier = 'optional'; f.risk = 'low' }
      else if ((m = inner.match(/^(.+) WL mm$/))) { f.label = `${m[1]} working length (mm)`; f.tier = 'required'; f.risk = 'high' }
      else if ((m = inner.match(/^(.+) ref: (.+)$/))) { f.label = `${m[1]} reference point`; f.tier = 'optional'; v[f.id] = { value: m[2], source: 'Tooth anatomy', user: false, standard: true }; f.std = 'ref'; f.stdLabel = `${m[1]} reference` }
      // SRP
      else if ((m = inner.match(/^#(\w+) PD mm$/))) { f.label = `#${m[1]} deepest PD (mm)`; f.tier = 'required'; f.risk = 'denial'; f.pdTooth = m[1] }
      else if ((m = inner.match(/^#(\w+) CAL mm$/))) { f.label = `#${m[1]} CAL (mm)`; f.tier = 'required'; f.risk = 'high' }
      // SDF
      else if ((m = inner.match(/^#(\w+) surface$/))) { f.label = `#${m[1]} surface`; f.tier = 'required'; f.risk = 'denial' }
      else if (proc === SEC.sdf && inner === 'D1354 / D2991' && k.sdfProduct) picked(f.id, k.sdfProduct)
      // fillings
      else if (proc === SEC.fill && k.surfaces.length && (inner === 'surfaces' || /^M\/O\/D\/B\/L\/I\/F$/.test(inner))) picked(f.id, surfaceString(k.surfaces, k.tooth))
      // buildup: usual post canal
      else if (proc === SEC.buildup && inner === 'canal' && ti && postCanal(k.tooth)) v[f.id] = { value: postCanal(k.tooth) === 'Canal' ? 'the canal' : `${postCanal(k.tooth)} canal`, source: 'Tooth anatomy', user: false, standard: true }
      // crowns: material, code, opposing tooth
      else if (k.crownMat && /zirconia \/ e\.max \/ PFM/.test(inner)) picked(f.id, k.crownMat === 'PFM' && k.pfmMetal ? `PFM (${k.pfmMetal})` : k.crownMat)
      else if (inner === '27xx' && crown) picked(f.id, crown.code.replace(/^D/, ''))
      else if (inner === 'tooth/denture' && ti && opposingTooth(k.tooth)) { v[f.id] = { value: `#${opposingTooth(k.tooth)}`, source: 'Tooth anatomy', user: false, standard: true }; f.std = 'opposing'; f.stdLabel = 'Opposing tooth' }
    })
    r.fields.forEach(f => {
      // an add-on's blanks are the documentation its code needs: required unless an {optional insert}
      if (f.addon && !f.tier) {
        f.tier = f.brace && !(f.options && f.options.length > 1) ? 'optional' : 'required'
        f.risk = /estimate %|walls|cusps|canal|mm\b|^mm|size|exposure|hemostasis|reason|anxiety|high spots|sensitiv|caries-free|%/i.test(`${f.inner} ${f.ctx}`) ? 'denial' : 'high'
      }
      if (!f.tier) f.tier = f.brace && !(f.options && f.options.length > 1) ? 'optional' : f.options && f.options.length > 1 ? 'required' : guessTier(f)
      if (!f.risk) f.risk = guessRisk(f)
    })
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

  const toothTi = toothInfo(tooth)
  const allTeeth = [tooth, ...moreTeeth].filter(t => toothInfo(t))
  const surfOf = t => (String(t) === String(tooth) ? surfaces : (moreSurf[t] || []))
  // one chip per tooth when the same procedure is on several teeth
  const toothCodes = !MULTI_TOOTH.has(proc) || allTeeth.length < 2 ? null : sortTeeth(allTeeth).map(t => {
    const c = proc === SEC.fill ? compositeCode(t, surfOf(t))
      : [SEC.crownPrep, SEC.crownSeat].includes(proc) ? crownCode(crownMat, pfmMetal)
      : PER_TOOTH_CODE[proc] ? { code: PER_TOOTH_CODE[proc] } : null
    return { t, code: c?.code || null }
  })
  const procCode = proc === SEC.rct && toothTi ? rctCode(tooth)
    : proc === SEC.fill && toothTi ? compositeCode(tooth, surfaces)
    : [SEC.crownPrep, SEC.crownSeat, SEC.cerec].includes(proc) ? (proc === SEC.cerec ? crownCode(crownMat || 'e.max') : crownCode(crownMat, pfmMetal))
    : proc === SEC.srp ? srpCode(srpTeeth.length)
    : proc === SEC.sdf && sdfTeeth.length ? { code: sdfProduct || 'D1354', name: `billed per tooth × ${sdfTeeth.length}` }
    : proc === SEC.pulp && toothTi ? { code: 'D3220', name: 'therapeutic pulpotomy' }
    : null
  const toothContext = () => {
    const bits = []
    if (allTeeth.length > 1 && MULTI_TOOTH.has(proc)) bits.push(`same procedure on ${allTeeth.length} teeth: ${sortTeeth(allTeeth).map(t => `#${t} (${toothInfo(t).name}${proc === SEC.fill && surfOf(t).length ? `, ${surfaceString(surfOf(t), t)}` : ''})`).join('; ')}`)
    else if (toothTi && !MULTI_SECTIONS.has(proc)) bits.push(`#${toothTi.n} (${toothTi.name})`)
    if (proc === SEC.rct && canals.length) bits.push(`canals: ${canals.join(', ')}`)
    if (proc === SEC.fill && surfaces.length) bits.push(`surfaces: ${surfaceString(surfaces, tooth)}`)
    if (proc === SEC.srp && quad) bits.push(`quadrant ${quad}, qualifying teeth ${toothList(srpTeeth) || 'not picked'}`)
    if (proc === SEC.sdf && sdfTeeth.length) bits.push(`teeth ${toothList(sdfTeeth)}, ${sdfProduct}`)
    if ([SEC.crownPrep, SEC.crownSeat, SEC.cerec].includes(proc) && crownMat) bits.push(`crown material ${crownMat}${crownMat === 'PFM' && pfmMetal ? ` (${pfmMetal})` : ''}`)
    const on = Object.keys(addons).filter(x => addons[x]).map(x => addonByKey(x)).filter(Boolean)
    if (on.length) bits.push(`also done this visit: ${on.map(a => `${a.label} (${a.code})`).join(', ')}`)
    if (procCode) bits.push(`code ${procCode.code}`)
    return bits.join('; ')
  }

  // Your own sentences, added at the end of a section
  const withCustom = (lines, customs) => {
    let out = [...lines]
    customs.forEach(c => {
      let at = -1
      out.forEach((l, i) => { if (l.section === c.section) at = i })
      if (at < 0) out = [...out, c]
      else out = [...out.slice(0, at + 1), c, ...out.slice(at + 1)]
    })
    return out
  }
  const addCustom = () => {
    const t = customText.trim(); if (!t || !result) return
    const line = { section: customSec, text: /[.!?]$/.test(t) ? t : `${t}.`, custom: true, cid: Date.now() }
    setResult(r => ({ ...r, lines: withCustom(r.lines.filter(l => !l.custom), [...r.lines.filter(l => l.custom), line]) }))
    setCustomText('')
  }
  const removeCustom = cid => setResult(r => ({ ...r, lines: r.lines.filter(l => l.cid !== cid) }))
  const sectionsInNote = result ? [...new Set(result.lines.map(l => l.section).filter(Boolean))] : []

  // Rebuild the note for a new choice, keeping everything already filled
  const retailor = o => {
    if (!result) return
    const { skel, v } = skeleton(o)
    const key = (f, i, arr) => `${f.inner}|${f.ctx}|${arr.slice(0, i).filter(x => x.inner === f.inner && x.ctx === f.ctx).length}`
    const old = {}; result.fields.forEach((f, i, arr) => { old[key(f, i, arr)] = f })
    const fields = skel.fields.map((f, i, arr) => {
      const prev = old[key(f, i, arr)]
      if (!prev) return f
      const keep = vals[prev.id]
      const fromPicker = s => ['Picked', 'Tooth picked', 'Tooth anatomy'].includes(s)
      if (keep && (keep.user || keep.excluded || (keep.value && !v[f.id]?.value) || (keep.value && !fromPicker(keep.source)))) v[f.id] = { ...keep }
      const own = f.std === 'ref' || f.std === 'opposing' || /working length|deepest PD|CAL \(mm\)|surface$/.test(f.label)
      return { ...f, label: own ? f.label : prev.label, tier: own ? f.tier : (prev.tier || f.tier), risk: own ? f.risk : (prev.risk || f.risk), look_in: prev.look_in, why: prev.why, evidence: prev.evidence, na: prev.na }
    })
    setResult({ ...result, lines: withCustom(skel.lines, result.lines.filter(l => l.custom)), fields }); setVals(v)
  }
  // Tooth chart: one tooth, or several when the procedure allows it
  const toggleChartTooth = id => {
    if (proc === SEC.sdf) { toggleSdfTooth(id); return }
    if (!MULTI_TOOTH.has(proc)) { pickTooth(String(tooth) === String(id) ? '' : id); return }
    const all = [tooth, ...moreTeeth].filter(Boolean).map(String)
    const next = all.includes(String(id)) ? all.filter(x => x !== String(id)) : [...all, String(id)]
    const first = next[0] || ''
    const rest = next.slice(1)
    let firstSurf = surfaces, ms = { ...moreSurf }
    if (first !== String(tooth)) { firstSurf = ms[first] || []; delete ms[first]; if (tooth && next.includes(String(tooth))) ms[tooth] = surfaces }
    Object.keys(ms).forEach(x => { if (!rest.includes(x)) delete ms[x] })
    setTooth(first); setMoreTeeth(rest); setSurfaces(firstSurf); setMoreSurf(ms)
    if (first !== String(tooth)) setCanals(canalsFor(first).usual)
    if (result) retailor({ tooth: first, moreTeeth: rest, surfaces: firstSurf, moreSurf: ms })
  }
  const toggleSurfaceOf = (t, x) => {
    if (String(t) === String(tooth)) { toggleSurface(x); return }
    const cur = moreSurf[t] || []
    const ms = { ...moreSurf, [t]: cur.includes(x) ? cur.filter(y => y !== x) : [...cur, x] }
    setMoreSurf(ms); if (result) retailor({ moreSurf: ms })
  }
  const pickTooth = t => {
    setTooth(t)
    const c = canalsFor(t).usual
    setCanals(c); setSurfaces([])
    setMoreTeeth([]); setMoreSurf({})
    if (result) retailor({ tooth: t, canals: c, surfaces: [], moreTeeth: [], moreSurf: {} })
  }
  const changeCanals = c => { setCanals(c); if (result) retailor({ canals: c }) }
  const toggleSurface = x => {
    const next = surfaces.includes(x) ? surfaces.filter(y => y !== x) : [...surfaces, x]
    setSurfaces(next); if (result) retailor({ surfaces: next })
  }
  const pickQuad = q => { setQuad(q); setSrpTeeth([]); if (result) retailor({ quad: q, srpTeeth: [] }) }
  const toggleSrpTooth = t => {
    const next = srpTeeth.includes(t) ? srpTeeth.filter(x => x !== t) : [...srpTeeth, t]
    setSrpTeeth(next); if (result) retailor({ srpTeeth: next })
  }
  const toggleSdfTooth = t => {
    const id = String(t).toUpperCase()
    if (!toothInfo(id)) return
    if (sdfTeeth.includes(id)) { const next = sdfTeeth.filter(x => x !== id); setSdfTeeth(next); if (result) retailor({ sdfTeeth: next }); return }
    if (sdfTeeth.length >= 4) { say('Renaissance allows 4 teeth per visit for SDF and D2991. Treat the rest at another visit.', 'error'); return }
    const next = [...sdfTeeth, id]; setSdfTeeth(next); if (result) retailor({ sdfTeeth: next })
  }
  const pickSdfProduct = p => { setSdfProduct(p); if (result) retailor({ sdfProduct: p }) }
  const setAddon = (key, how) => {
    const a = addonByKey(key)
    const next = { ...addons }
    if (how) { (a?.excludes || []).forEach(x => { delete next[x] }); next[key] = how } else delete next[key]
    setAddons(next); if (result) retailor({ addons: next })
  }
  const pickCrown = (mat, metal) => { setCrownMat(mat); setPfmMetal(metal ?? pfmMetal); if (result) retailor({ crownMat: mat, pfmMetal: metal ?? pfmMetal }) }

  const blank = () => {
    const { skel, v } = skeleton()
    setResult(skel); setVals(v); setEntry('template'); setFormView('all')
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
      const m = String(v[f.id]?.value || '').trim().match(/^#?\s*([1-9]|[12]\d|3[0-2]|[A-Ta-t])\b/)
      if (m) return /\d/.test(m[1]) ? +m[1] : m[1].toUpperCase()
    }
    const first = toothInfo(tooth)?.n ?? sortTeeth(proc === SEC.srp ? srpTeeth : proc === SEC.sdf ? sdfTeeth : [])[0]
    return first ?? null
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
    const w = []   // only the office's own checks; Claude's commentary is not shown
    if (proc === SEC.srp) {
      const shallow = result.fields.filter(f => f.pdTooth && vals[f.id]?.value && parseFloat(vals[f.id].value) < 4).map(f => `#${f.pdTooth}`)
      if (shallow.length) w.unshift(`${shallow.join(', ')} ${shallow.length > 1 ? 'have' : 'has'} a deepest pocket under 4 mm, so ${shallow.length > 1 ? "they don't" : "it doesn't"} qualify for SRP. Remove ${shallow.length > 1 ? 'them' : 'it'} from the qualifying teeth.`)
    }
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
  // Separate add-ons print as their own notes; everything else is the main note
  const separateParts = () => Object.entries(addons).filter(([, how]) => how === 'separate').map(([key]) => addonByKey(key)).filter(Boolean)
  const buildNote = (kind, part = 'main') => {
    if (!result) return []
    const drop = st => ['skip', 'na', 'excluded'].includes(st) || (kind === 'final' && st === 'missing')
    const out = []; let sec = null
    const sepKeys = new Set(separateParts().map(a => a.key))
    let lines = part === 'main' ? result.lines.filter(l => !(l.addon && sepKeys.has(l.addon))) : result.lines.filter(l => l.addon === part)
    if (part !== 'main') {
      const t = toothInfo(tooth)
      lines = [
        ...(t ? [{ section: '', text: `Tooth #${t.n}, same visit as ${section.section.replace(/^6\.\d+\s*/, '').split(':')[0].toLowerCase()}.` }] : []),
        ...lines,
        { section: '', text: `Rendering provider: ${providerName || '[name]'}.${team.assistant ? ` Assisted by: ${team.assistant}.` : ''}` },
      ]
    }
    lines.forEach(l => {
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
        // An empty {optional insert} just disappears; an empty [blank] takes its clause with it
        const fieldOf = id => result.fields.find(y => y.id === id)
        const isInsert = f => f?.brace && !(f.options && f.options.length > 1)
        const dropsClause = x => { const f = fieldOf(x.id); const st = f ? stateOf(f) : 'missing'; return drop(st) && !(isInsert(f) && st !== 'missing') }
        if (c.some(x => x.id && dropsClause(x))) return
        c.forEach(x => {
          if (x.t !== undefined) { segs.push({ k: 'text', t: x.t }); return }
          const f = fieldOf(x.id); const st = f ? stateOf(f) : 'missing'
          if (drop(st)) return
          const prev = segs[segs.length - 1]
          const t = st === 'missing' ? `[MISSING: ${labelOf(x.id)}]` : vals[x.id].value.trim()
          if (f?.brace && prev && prev.k === 'text' && /[A-Za-z0-9]$/.test(prev.t) && /^[A-Za-z0-9[]/.test(t)) prev.t += ' '   // {inserts} sit flush in the template
          segs.push(st === 'missing' ? { k: 'miss', t, id: x.id } : { k: st === 'std' ? 'std' : 'val', t, id: x.id })
        })
      })
      // tidy: no space before punctuation, no dangling ';' or ',' at the end
      for (let i = segs.length - 1; i > 0; i--) if (segs[i].k === 'text' && segs[i - 1].k === 'text') { segs[i - 1].t += segs[i].t; segs.splice(i, 1) }
      for (let i = 0; i < segs.length; i++) if (segs[i].k === 'text') segs[i].t = segs[i].t.replace(/\(\s*\)/g, '').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/ +([.,;:])/g, '$1').replace(/ {2,}/g, ' ')
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
  const partText = (kind, part) => buildNote(kind, part).map(r => (r.head ? r.head : r.segs.map(x => x.t).join('').replace(/ {2,}/g, ' ').trim())).join('\n')
  const noteText = (kind = 'final') => [partText(kind, 'main'), ...separateParts().map(a => `\n${a.label} (${a.code}): separate note\n${partText(kind, a.key)}`)].join('\n')
  const excludedList = result ? result.fields.filter(f => stateOf(f) === 'excluded') : []

  const copy = async (part = 'main') => {
    const t = partText('final', part)
    try { await navigator.clipboard.writeText(t); say(part === 'main' ? 'Final note copied. Paste it into Ascend.' : `${addonByKey(part)?.label} note copied.`) }
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

  // Review copy as Word (.docx) so it can be edited outside the portal.
  // Missing items are shaded red in the note with their risk; a ranked list follows.
  const downloadReviewDocx = async () => {
    let D
    try { D = await import('docx') } catch { say('Word export is not available. Use the PDF or .txt.', 'error'); return }
    const { Document, Packer, Paragraph, TextRun, ShadingType, BorderStyle, AlignmentType, Footer, PageNumber } = D
    const FONT = 'Arial'
    const run = (text, o = {}) => new TextRun({ text, font: FONT, size: 21, ...o })
    const hx = c => c.replace('#', '')
    const kids = []
    kids.push(new Paragraph({ children: [run('Beautiful Smiles by Design', { bold: true, size: 28, color: hx(C.navy) })], spacing: { after: 60 } }))
    kids.push(new Paragraph({ children: [run(`REVIEW COPY: not for the chart or a claim  |  ${section.section}${toothTi ? `  |  #${toothTi.n}` : ''}${procCode ? `  |  ${procCode.code}` : ''}`, { size: 18, color: hx(C.muted) })], spacing: { after: 40 } }))
    kids.push(new Paragraph({
      children: [run([providerName && `Rendering provider: ${providerName}`, team.assistant && `Assisted by: ${team.assistant}`, team.office, mode === 'new' && teamInfo.dos && `DOS ${teamInfo.dos}`, mode === 'addendum' && 'Addendum'].filter(Boolean).join('  |  '), { size: 18, color: hx(C.muted) })],
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: hx(C.gold), space: 6 } }, spacing: { after: 240 },
    }))
    buildNote('review').forEach(r => {
      if (r.head) { kids.push(new Paragraph({ children: [run(r.head, { bold: true, color: hx(C.teal) })], spacing: { before: 160, after: 60 } })); return }
      kids.push(new Paragraph({
        spacing: { after: 80 },
        children: r.segs.map(sg => {
          if (sg.k !== 'miss') return run(sg.t)
          const f = result.fields.find(x => x.id === sg.id); const rk = RISK[riskOf(f || {})]
          return run(`[MISSING: ${labelOf(sg.id)} (${rk.label})]`, { bold: true, color: hx(rk.fg), shading: { type: ShadingType.CLEAR, color: 'auto', fill: hx(rk.bg) } })
        }),
      }))
    })
    separateParts().forEach(a => {
      kids.push(new Paragraph({ children: [run(`${a.label} (${a.code}): separate note`, { bold: true, size: 24, color: hx(C.navy) })], spacing: { before: 360, after: 80 }, border: { top: { style: BorderStyle.SINGLE, size: 6, color: hx(C.line), space: 8 } } }))
      buildNote('review', a.key).forEach(r => {
        if (r.head) { kids.push(new Paragraph({ children: [run(r.head, { bold: true, color: hx(C.teal) })], spacing: { before: 120, after: 60 } })); return }
        kids.push(new Paragraph({ spacing: { after: 80 }, children: r.segs.map(sg => {
          if (sg.k !== 'miss') return run(sg.t)
          const f = result.fields.find(x => x.id === sg.id); const rk = RISK[riskOf(f || {})]
          return run(`[MISSING: ${labelOf(sg.id)} (${rk.label})]`, { bold: true, color: hx(rk.fg), shading: { type: ShadingType.CLEAR, color: 'auto', fill: hx(rk.bg) } })
        }) }))
      })
    })
    const ranked = [...missing].sort((a, b) => RISK[riskOf(a)].rank - RISK[riskOf(b)].rank)
    if (ranked.length) {
      kids.push(new Paragraph({ children: [run(`Missing items, most important first (${ranked.length})`, { bold: true, color: hx(C.navy) })], spacing: { before: 280, after: 80 } }))
      ranked.forEach(f => {
        const rk = RISK[riskOf(f)]
        kids.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [run(f.label), run(` (${rk.label})`, { bold: true, color: hx(rk.fg) })] }))
      })
    }
    if (excludedList.length) {
      kids.push(new Paragraph({ children: [run(`Left out on purpose (${excludedList.length})`, { bold: true, color: hx(C.muted) })], spacing: { before: 200, after: 80 } }))
      excludedList.forEach(f => kids.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 40 }, children: [run(f.label), run(` (${RISK[riskOf(f)].label})`, { color: hx(C.muted) })] })))
    }
    const doc = new Document({
      styles: { default: { document: { run: { font: FONT, size: 21 } } } },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [run('Review copy  |  page ', { size: 16, color: hx(C.muted) }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: hx(C.muted) })] })] }) },
        children: kids,
      }],
    })
    const blob = await Packer.toBlob(doc)
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `${fileBase()}_review.docx`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  // PDF: letter size, BSBD header (final note)
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
    doc.text(`${kind === 'review' ? 'REVIEW COPY: not for the chart or a claim' : 'Clinical note'}  |  ${section.section}${toothTi ? `  |  #${toothTi.n}` : ''}${procCode ? `  |  ${procCode.code}` : ''}`, M, y); y += 12
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
    const drawPart = part => buildNote(kind, part).forEach(r => {
      if (r.head) { need(LH * 2); y += 4; doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...rgb(C.teal)); doc.text(r.head, M, y); y += LH; return }
      need(LH); drawRuns(r.segs)
    })
    drawPart('main')
    separateParts().forEach(a => {
      newPage()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...rgb(C.navy)); doc.text(`${a.label} (${a.code}): separate note`, M, y); y += 8
      doc.setDrawColor(...rgb(C.gold)); doc.setLineWidth(1); doc.line(M, y, PW - M, y); y += 16
      drawPart(a.key)
    })
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
          {(st === 'missing' || st === 'excluded') && (() => { const r = RISK[riskOf(f)]; return <span style={S.tag(r.bg, r.fg)}>{r.label}</span> })()}
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
            <p style={S.sub}>Pick the procedure. Dictate starts the microphone right away; Fill in the template opens a blank note to complete by hand.</p>
            {favorites.length > 0 && (
              <>
                <div style={{ ...S.small, fontWeight: 700, marginBottom: 8 }}>{team.doctor}'s procedures</div>
                <div style={S.grid}>
                  {favorites.map(i => (
                    <div key={i} style={{ ...S.quick, cursor: 'default' }}>
                      <div>{NOTE_TEMPLATES[i].section}</div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                        <button style={S.link} onClick={() => start(i, 'dictate')}>Dictate</button>
                        <button style={S.link} onClick={() => start(i, 'upload')}>Upload or paste</button>
                        <button style={S.link} onClick={() => start(i, 'template')}>Fill in the template</button>
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
              <button style={S.btn} onClick={() => start(proc, 'dictate')}>Dictate</button>
              <button style={S.ghost} onClick={() => start(proc, 'upload')}>Upload or paste</button>
              <button style={S.ghost} onClick={() => start(proc, 'template')}>Fill in the template</button>
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
              <select style={{ ...S.input, minWidth: 320 }} value={proc} onChange={e => { setProc(+e.target.value); setTplIdx(0); setResult(null); setSurfaces([]); setCanals(canalsFor(tooth).usual); setSrpTeeth([]); setSdfTeeth([]); setAddons({}); if (!MULTI_TOOTH.has(+e.target.value)) { setMoreTeeth([]); setMoreSurf({}) } }}>
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
          {TOOTH_SECTIONS.has(proc) && (
            <div style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: 9, padding: '12px 14px' }}>
              {proc !== SEC.srp && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ ...S.small, fontWeight: 700 }}>
                      {proc === SEC.sdf ? 'Tap the teeth treated today (up to 4)' : MULTI_TOOTH.has(proc) ? 'Tap the tooth. Same procedure on more teeth? Tap them too.' : 'Tap the tooth'}
                    </span>
                    <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden' }}>
                      {[[false, 'Permanent'], [true, 'Primary']].map(([v, t]) => (
                        <button key={t} onClick={() => setPrimaryChart(v)} aria-pressed={primaryChart === v}
                          style={{ border: 0, padding: '4px 10px', font: 'inherit', fontSize: 12, cursor: 'pointer', background: primaryChart === v ? C.navy : '#fff', color: primaryChart === v ? '#fff' : C.ink }}>{t}</button>
                      ))}
                    </div>
                  </div>
                  <ToothChart
                    selected={(proc === SEC.sdf ? sdfTeeth : allTeeth).map(String)}
                    onToggle={toggleChartTooth}
                    multi={proc === SEC.sdf || MULTI_TOOTH.has(proc)}
                    primary={primaryChart}
                    disabled={proc === SEC.sdf && sdfTeeth.length >= 4 ? (primaryChart ? 'ABCDEFGHIJKLMNOPQRST'.split('') : Array.from({ length: 32 }, (_, i) => String(i + 1))).filter(x => !sdfTeeth.includes(x)) : []} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                {!MULTI_SECTIONS.has(proc) && <>
                  <label style={{ ...S.label, flexDirection: 'row', alignItems: 'center', gap: 8, fontWeight: 400 }}>or type #
                    <input style={{ ...S.input, width: 70 }} value={tooth} placeholder={proc === SEC.pulp ? '1-32, A-T' : '1-32'}
                      onChange={e => { const t = e.target.value.replace(/[^\dA-Ta-t]/g, '').toUpperCase().slice(0, 2); if (toothInfo(t) || t === '') pickTooth(t); else setTooth(t) }} />
                  </label>
                  {allTeeth.length > 1 && MULTI_TOOTH.has(proc)
                    ? <span style={{ fontSize: 14 }}><b style={{ color: C.navy }}>{allTeeth.length} teeth:</b> {sortTeeth(allTeeth).map(t => `#${t}`).join(', ')}</span>
                    : toothTi && <span style={{ fontSize: 14 }}><b style={{ color: C.navy }}>#{toothTi.n}</b> {toothTi.name}</span>}
                  {!toothTi && tooth && <span style={{ ...S.small, color: C.miss }}>Use 1 to 32{proc === SEC.pulp ? ', or A to T for primary teeth' : ''}.</span>}
                </>}
                {proc === SEC.srp && <span style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>Quadrant and qualifying teeth</span>}
                {proc === SEC.sdf && <span style={{ fontWeight: 700, color: C.navy, fontSize: 14 }}>Teeth treated today (max 4)</span>}
                {toothCodes
                  ? toothCodes.map(c => <span key={c.t} style={S.tag(c.code ? C.okBg : C.chip, c.code ? C.ok : C.muted)}>#{c.t} {c.code || 'code: pick surfaces'}</span>)
                  : procCode && <span style={S.tag(C.okBg, C.ok)}>{procCode.code} · {procCode.name}</span>}
              </div>

              {proc === SEC.srp && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {Object.keys(QUADS).map(q => (
                      <button key={q} onClick={() => pickQuad(q)} aria-pressed={quad === q}
                        style={{ font: 'inherit', fontWeight: 700, fontSize: 14, padding: '6px 14px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${quad === q ? C.navy : C.line}`, background: quad === q ? C.navy : '#fff', color: quad === q ? '#fff' : C.ink }}>{q}</button>
                    ))}
                  </div>
                  {quad && <>
                    <div style={{ ...S.small, margin: '10px 0 6px' }}>Tap each tooth with 4 mm+ pockets and bone loss. 4 or more is D4341; 1 to 3 is D4342.</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {QUADS[quad].map(t => (
                        <button key={t} onClick={() => toggleSrpTooth(t)} aria-pressed={srpTeeth.includes(t)}
                          style={{ font: 'inherit', fontWeight: 700, fontSize: 13, width: 42, height: 34, borderRadius: 8, cursor: 'pointer', border: `1px solid ${srpTeeth.includes(t) ? C.navy : C.line}`, background: srpTeeth.includes(t) ? C.navy : '#fff', color: srpTeeth.includes(t) ? '#fff' : C.ink }}>#{t}</button>
                      ))}
                    </div>
                  </>}
                </div>
              )}

              {proc === SEC.sdf && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {sortTeeth(sdfTeeth).map(t => (
                      <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.navy, color: '#fff', borderRadius: 16, padding: '4px 6px 4px 12px', fontSize: 13, fontWeight: 700 }}>
                        #{t}<button aria-label={`Remove #${t}`} onClick={() => toggleSdfTooth(t)} style={{ border: 0, background: 'rgba(255,255,255,.2)', color: '#fff', width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', padding: 0 }}>×</button>
                      </span>
                    ))}
                    {sdfTeeth.length < 4 && <input style={{ ...S.input, width: 120, padding: '5px 8px', fontSize: 13 }} placeholder="or type, Enter"
                      onKeyDown={e => { if (e.key === 'Enter') { const t = e.currentTarget.value.trim().toUpperCase().replace(/^#/, ''); if (toothInfo(t)) { toggleSdfTooth(t); e.currentTarget.value = '' } else say('Use 1 to 32, or A to T for primary teeth.', 'error') } }} />}
                  </div>
                  <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', marginTop: 10 }}>
                    {[['D1354', 'SDF (D1354)'], ['D2991', 'Hydroxyapatite (D2991)']].map(([k, t]) => (
                      <button key={k} onClick={() => pickSdfProduct(k)} aria-pressed={sdfProduct === k}
                        style={{ border: 0, padding: '6px 12px', font: 'inherit', fontSize: 13, cursor: 'pointer', background: sdfProduct === k ? C.navy : '#fff', color: sdfProduct === k ? '#fff' : C.ink }}>{t}</button>
                    ))}
                  </div>
                </div>
              )}

              {[SEC.crownPrep, SEC.crownSeat, SEC.cerec].includes(proc) && (
                <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(proc === SEC.cerec ? ['e.max', 'zirconia'] : CROWN_MATERIALS).map(m => (
                      <button key={m} onClick={() => pickCrown(m)} aria-pressed={crownMat === m}
                        style={{ font: 'inherit', fontSize: 13, fontWeight: 700, padding: '6px 12px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${crownMat === m ? C.navy : C.line}`, background: crownMat === m ? C.navy : '#fff', color: crownMat === m ? '#fff' : C.ink }}>{m}</button>
                    ))}
                  </div>
                  {crownMat === 'PFM' && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={S.small}>Metal:</span>
                      {Object.keys(PFM_METALS).map(m => (
                        <button key={m} onClick={() => pickCrown('PFM', m)} aria-pressed={pfmMetal === m}
                          style={{ font: 'inherit', fontSize: 13, padding: '5px 10px', borderRadius: 16, cursor: 'pointer', border: `1px solid ${pfmMetal === m ? C.navy : C.line}`, background: pfmMetal === m ? C.navy : '#fff', color: pfmMetal === m ? '#fff' : C.ink }}>{m}</button>
                      ))}
                    </div>
                  )}
                  {toothTi && opposingTooth(tooth) && proc === SEC.crownPrep && <span style={S.small}>Opposing #{opposingTooth(tooth)} goes in the note.</span>}
                </div>
              )}

              {proc === SEC.pulp && toothTi && (
                <ul style={{ ...S.small, margin: '10px 0 0', paddingLeft: 18 }}>{pulpotomyNotes(tooth).map((t, i) => <li key={i}>{t}</li>)}</ul>
              )}
              {proc === SEC.rct && toothTi?.primary && (
                <div style={{ ...S.small, marginTop: 8, color: C.miss }}>Primary tooth: pulpal therapy is D3230 or D3240, not a D33xx root canal. Use the pulpotomy template if that's what was done.</div>
              )}

              {proc === SEC.rct && toothTi && !toothTi.primary && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ ...S.small, fontWeight: 700, marginBottom: 6 }}>Canals ({canals.length}) <span style={{ fontWeight: 400 }}>· usual for this tooth; add or remove for this case</span></div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {canals.map(c => (
                      <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: C.navy, color: '#fff', borderRadius: 16, padding: '4px 6px 4px 12px', fontSize: 13, fontWeight: 700 }}>
                        {c === 'Canal' ? 'Single canal' : c}
                        {canals.length > 1 && <button aria-label={`Remove ${c}`} onClick={() => changeCanals(canals.filter(x => x !== c))} style={{ border: 0, background: 'rgba(255,255,255,.2)', color: '#fff', width: 20, height: 20, borderRadius: '50%', cursor: 'pointer', padding: 0 }}>×</button>}
                      </span>
                    ))}
                    {canalsFor(tooth).extra.filter(c => !canals.includes(c)).map(c => (
                      <button key={c} onClick={() => changeCanals(addCanal(canals, c, tooth))} style={{ font: 'inherit', fontSize: 13, borderRadius: 16, padding: '4px 11px', cursor: 'pointer', border: `1px dashed ${C.navy}`, background: '#fff', color: C.navy }}>+ {c}</button>
                    ))}
                    <input style={{ ...S.input, width: 110, padding: '4px 8px', fontSize: 13 }} placeholder="+ other canal"
                      onKeyDown={e => { if (e.key === 'Enter' && e.currentTarget.value.trim()) { changeCanals(addCanal(canals, e.currentTarget.value.trim().toUpperCase(), tooth)); e.currentTarget.value = '' } }} />
                  </div>
                </div>
              )}

              {proc === SEC.fill && allTeeth.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  {sortTeeth(allTeeth).map(t => {
                    const list = surfOf(t)
                    const code = compositeCode(t, list)
                    return (
                      <div key={t} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                        <span style={{ fontWeight: 700, color: C.navy, minWidth: 44 }}>#{t}</span>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {surfacesFor(t).map(x => (
                            <button key={x} onClick={() => toggleSurfaceOf(t, x)} aria-pressed={list.includes(x)} aria-label={`#${t} surface ${x}`}
                              style={{ font: 'inherit', fontWeight: 700, fontSize: 14, width: 40, height: 34, borderRadius: 8, cursor: 'pointer', border: `1px solid ${list.includes(x) ? C.navy : C.line}`, background: list.includes(x) ? C.navy : '#fff', color: list.includes(x) ? '#fff' : C.ink }}>{x}</button>
                          ))}
                        </div>
                        <span style={S.small}>{list.length ? `${surfaceString(list, t)}${code ? ` · ${code.code}` : ''}` : 'pick surfaces'}</span>
                      </div>
                    )
                  })}
                </div>
              )}

              {(proc === SEC.ext || proc === SEC.surgExt) && toothTi && extractionNotes(tooth).length > 0 && (
                <ul style={{ ...S.small, margin: '10px 0 0', paddingLeft: 18 }}>{extractionNotes(tooth).map((t, i) => <li key={i}>{t}</li>)}</ul>
              )}
              {proc === SEC.buildup && toothTi && postCanal(tooth) && (
                <div style={{ ...S.small, marginTop: 8 }}>If a post is placed, the note defaults to the {postCanal(tooth) === 'Canal' ? 'canal' : `${postCanal(tooth)} canal`}.</div>
              )}
            </div>
          )}
              {addonsFor(proc).length > 0 && (
                <div style={{ marginTop: 14, border: `1px solid ${C.line}`, borderRadius: 9, padding: '12px 14px' }}>
                  <div style={{ ...S.small, fontWeight: 700, marginBottom: 6 }}>Also done this visit <span style={{ fontWeight: 400 }}>· adds its lines to the note, or makes its own note</span></div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {addonsFor(proc).map(a => {
                      const how = addons[a.key]
                      return (
                        <div key={a.key} title={a.note} style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${how ? C.navy : C.line}`, borderRadius: 16, overflow: 'hidden', fontSize: 13 }}>
                          <button onClick={() => setAddon(a.key, how ? null : 'in')} aria-pressed={!!how}
                            style={{ border: 0, padding: '5px 11px', font: 'inherit', fontSize: 13, fontWeight: how ? 700 : 400, cursor: 'pointer', background: how ? C.navy : '#fff', color: how ? '#fff' : C.ink }}>
                            {how ? '✓ ' : '+ '}{a.label} <span style={{ opacity: 0.75 }}>{a.code}</span>
                          </button>
                          {how && (
                            <button onClick={() => setAddon(a.key, how === 'in' ? 'separate' : 'in')} title="Switch between part of this note and its own note"
                              style={{ border: 0, borderLeft: '1px solid rgba(255,255,255,.3)', padding: '5px 10px', font: 'inherit', fontSize: 12, cursor: 'pointer', background: C.teal, color: '#fff' }}>
                              {how === 'in' ? 'In this note' : 'Separate note'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {Object.keys(addons).filter(k => addons[k]).map(k => addonByKey(k)).filter(Boolean).map(a => (
                    <div key={a.key} style={{ ...S.small, marginTop: 6 }}><b>{a.label}:</b> {a.note}</div>
                  ))}
                </div>
              )}
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
        {entry === 'template' && result && (
          <div style={{ ...S.card, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 18px' }}>
            <span style={{ fontSize: 14 }}><b style={{ color: C.navy }}>Filling in the template by hand.</b> Dictation or an Ascend note can fill the rest for you.</span>
            <button style={{ ...S.link, fontSize: 14 }} onClick={() => setEntry('records')}>Add dictation or records</button>
          </div>
        )}
        {!(entry === 'template' && result) && <div style={S.card}>
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
        </div>}

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
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{warnings.length} protocol issue{warnings.length > 1 ? 's' : ''}</summary>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                  </details>
                )}

                <div style={{ display: 'inline-flex', border: `1px solid ${C.line}`, borderRadius: 8, overflow: 'hidden', marginBottom: 14 }}>
                  {[['focus', "What's needed first"], ['all', 'Whole note in order']].map(([k, t]) => (
                    <button key={k} onClick={() => setFormView(k)} aria-pressed={formView === k}
                      style={{ border: 0, padding: '6px 12px', font: 'inherit', fontSize: 13, cursor: 'pointer', background: formView === k ? C.navy : '#fff', color: formView === k ? '#fff' : C.ink }}>{t}</button>
                  ))}
                </div>

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

                {formView === 'all' && (() => {
                  // every blank, section by section, in the order it reads in the note
                  const anes = new Set(anesFields ? [anesFields.agent.id, anesFields.count?.id, anesFields.mg?.id].filter(Boolean) : [])
                  const order = []
                  result.lines.forEach(l => [...l.text.matchAll(/\{\{(\w+)\}\}/g)].forEach(m => { const f = result.fields.find(x => x.id === m[1]); if (f && !anes.has(f.id) && !order.some(o => o.f === f)) order.push({ f, sec: l.section }) }))
                  let last = null
                  return (
                    <div style={{ marginBottom: 16 }}>
                      {order.map(({ f, sec }) => {
                        const head = sec && sec !== last ? (last = sec) : null
                        return (
                          <div key={f.id}>
                            {head && <div style={{ fontWeight: 700, color: C.teal, fontSize: 15, margin: '14px 0 2px' }}>{{ S: 'Subjective', O: 'Objective', A: 'Assessment', P: 'Plan' }[head] || head}</div>}
                            {FieldRow({ f })}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {formView === 'focus' && buckets.need.length > 0 && (
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
                    {buckets.need.filter(f => stateOf(f) !== 'std').sort((a, b) => RISK[riskOf(a)].rank - RISK[riskOf(b)].rank).map(f => FieldRow({ f }))}
                  </div>
                )}

                {formView === 'focus' && (standardList.length > 0 || buckets.confirm.length > 0) && (
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

                {formView === 'focus' && buckets.optional.length > 0 && (
                  <details open={!!openGroups.optional} onToggle={e => { const o = e.currentTarget.open; setOpenGroups(g => (g.optional === o ? g : { ...g, optional: o })) }} style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, color: C.navy }}>Optional details ({buckets.optional.length})</summary>
                    <div style={{ ...S.small, margin: '4px 0 6px' }}>Not needed for TennCare. Add any you have and that line comes back into the note.</div>
                    {buckets.optional.filter(f => stateOf(f) !== 'std').map(f => FieldRow({ f }))}
                  </details>
                )}

                {formView === 'focus' && buckets.filled.length > 0 && (
                  <details open={!!openGroups.filled} onToggle={e => { const o = e.currentTarget.open; setOpenGroups(g => (g.filled === o ? g : { ...g, filled: o })) }} style={{ borderTop: `1px solid ${C.line}`, padding: '10px 0' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 700, color: C.navy }}>Filled from the records ({buckets.filled.length})</summary>
                    {buckets.filled.filter(f => stateOf(f) !== 'std').map(f => FieldRow({ f }))}
                  </details>
                )}

                <div style={{ borderTop: `1px solid ${C.line}`, padding: '12px 0 0', marginTop: 4 }}>
                  <div style={{ fontWeight: 700, color: C.navy, fontSize: 15 }}>Add your own sentence</div>
                  <div style={{ ...S.small, margin: '2px 0 6px' }}>For anything the template doesn't cover. It goes at the end of the section you pick.</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <select style={{ ...S.input, width: 130 }} value={customSec} onChange={e => setCustomSec(e.target.value)} aria-label="Section">
                      {(sectionsInNote.length ? sectionsInNote : ['S', 'O', 'A', 'P']).map(x => <option key={x} value={x}>{{ S: 'Subjective', O: 'Objective', A: 'Assessment', P: 'Plan' }[x] || x}</option>)}
                    </select>
                    <input style={{ ...S.input, flex: 1, minWidth: 200 }} value={customText} placeholder="e.g. Pt asked about whitening; info given." aria-label="Your sentence"
                      onChange={e => setCustomText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCustom() }} />
                    <button style={{ ...S.ghost, padding: '7px 14px' }} onClick={addCustom}>Add</button>
                  </div>
                  {result.lines.filter(l => l.custom).map(l => (
                    <div key={l.cid} style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, fontSize: 14 }}>
                      <span style={S.tag(C.chip, C.navy)}>{l.section}</span><span style={{ flex: 1 }}>{l.text}</span>
                      <button style={{ ...S.link, fontSize: 13 }} onClick={() => removeCustom(l.cid)}>Remove</button>
                    </div>
                  ))}
                </div>

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
                  {[{ key: 'main', title: null }, ...separateParts().map(a => ({ key: a.key, title: `${a.label} (${a.code}): separate note` }))].map(part => (
                  <div key={part.key} style={{ marginBottom: 10 }}>
                  {part.title && <div style={{ fontWeight: 700, color: C.navy, margin: '12px 0 6px', display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>{part.title}<button style={{ ...S.link, fontSize: 13 }} onClick={() => copy(part.key)}>Copy this note</button></div>}
                  <div style={S.note}>
                    {buildNote(previewKind, part.key).map((r, i) => r.head
                      ? <div key={i} style={{ fontFamily: 'Arial, sans-serif', fontWeight: 700, color: C.teal, marginTop: 8 }}>{r.head}</div>
                      : <div key={i}>{r.segs.map((sg, j) => sg.k === 'text'
                          ? <span key={j}>{sg.t}</span>
                          : sg.k === 'miss'
                            ? (() => { const f = result.fields.find(x => x.id === sg.id); const rk = RISK[riskOf(f || {})]; return <span key={j} onClick={() => jumpTo(sg.id)} title="Click to fill or leave out" style={{ cursor: 'pointer', borderRadius: 3, background: rk.bg, color: rk.fg, fontWeight: 700 }}>[MISSING: {labelOf(sg.id)} ({rk.label})]</span> })()
                            : <span key={j} onClick={() => jumpTo(sg.id)} title="Click to edit" style={{ cursor: 'pointer', borderRadius: 3, ...(previewKind === 'review' ? { background: sg.k === 'std' ? C.defBg : C.okBg } : {}) }}>{sg.t}</span>)}</div>)}
                  </div>
                  </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                    <button style={S.btn} onClick={() => copy('main')}>Copy final note</button>
                    <button style={S.ghost} onClick={downloadReviewDocx}>Review copy (Word)</button>
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
