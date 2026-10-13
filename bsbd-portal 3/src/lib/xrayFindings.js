// src/lib/xrayFindings.js — radiographic findings picker: what can be picked
// per procedure, and the sentences built from the picks.
//
// The dentist (or assistant, chairside) reads the film and taps the findings;
// this file turns the picks into reviewer-ready note sentences and ties them
// to the clinical tests and diagnosis already in the note. The AI X-ray check
// can pre-select picks as a starting point; the dentist confirms.
//
// Pure functions, no React: used by XrayFindings.jsx, NoteBuilder.jsx, and
// sent (as PICK_GROUPS) to the AI so it pre-selects with the same options.

const SURF = [['M', 'M'], ['O', 'O/I'], ['D', 'D'], ['B', 'B/F'], ['L', 'L/P']]
const ROOTS = [['single', 'Single root'], ['M', 'Mesial'], ['D', 'Distal'], ['MB', 'MB'], ['DB', 'DB'], ['P', 'Palatal'], ['B', 'Buccal'], ['L', 'Lingual']]
const WALLS = [['M', 'Mesial wall / marginal ridge'], ['D', 'Distal wall / marginal ridge'], ['B', 'Buccal cusp(s)'], ['L', 'Lingual cusp(s)'], ['O', 'Occlusal / incisal']]

const G = {
  preop_film: { label: 'Pre-op film', type: 'single', options: [['pa', 'Periapical'], ['fmx', 'FMX periapical'], ['bw', 'Bitewing'], ['pano', 'Pano']] },
  decay_surf: { label: 'Decay — surfaces', type: 'multi', options: SURF },
  decay_type: { label: 'Decay — type', type: 'single', options: [['primary', 'Primary caries'], ['recurrent', 'Recurrent, under existing restoration']] },
  decay_depth: { label: 'Decay — depth', type: 'single', options: [['enamel', 'Enamel'], ['dentin', 'Into dentin'], ['approaching_pulp', 'Approaching pulp'], ['into_pulp', 'Into pulp']] },
  pa_status: { label: 'Periapical', type: 'single', options: [['wnl', 'Within normal limits'], ['pdl', 'PDL widening'], ['lesion', 'Periapical radiolucency']] },
  pa_roots: { label: 'Periapical — root(s)', type: 'multi', options: ROOTS, showIf: p => p.pa_status && p.pa_status !== 'wnl' },
  walls_lost: { label: 'Tooth structure lost', type: 'multi', options: WALLS },
  remaining: { label: 'Coronal structure remaining', type: 'single', options: [['75', 'About 75%'], ['50', 'About 50%'], ['25', 'About 25%'], ['lt25', 'Less than 25%'], ['bone', 'Broken to bone level']] },
  restoration: { label: 'Existing restoration', type: 'single', options: [['none', 'None'], ['large', 'Large restoration'], ['failing', 'Failing / open margins'], ['fractured', 'Fractured']] },
  prior_rct: { label: 'Prior root canal', type: 'single', options: [['no', 'No'], ['yes', 'Yes'], ['post', 'Yes, with post']] },
  canals: { label: 'Post-op — canals obturated', type: 'single', options: [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']] },
  fill_length: { label: 'Post-op — fill length', type: 'single', options: [['within1', 'Within ~1 mm of apex'], ['flush', 'Flush with apex'], ['short', 'Short (>2 mm)'], ['long', 'Sealer/fill past apex']] },
  voids: { label: 'Post-op — density', type: 'single', options: [['dense', 'Dense, no voids'], ['minor', 'Minor voids']] },
  seat: { label: 'Post-op — crown', type: 'single', options: [['closed', 'Seated, margins closed'], ['not_shown', 'Margins not clearly shown']] },
  roots_feat: { label: 'Roots / surgical factors', type: 'multi', options: [['curved', 'Curved'], ['divergent', 'Divergent'], ['dilacerated', 'Dilacerated'], ['fractured', 'Root fracture'], ['impacted', 'Impacted'], ['near_sinus', 'Near sinus'], ['near_canal', 'Near mandibular canal'], ['ankylosed', 'Appears ankylosed']] },
  bone_loss: { label: 'Bone loss', type: 'single', options: [['none', 'None'], ['mild', 'Mild'], ['moderate', 'Moderate'], ['severe', 'Severe']] },
  bone_pattern: { label: 'Bone loss pattern', type: 'multi', options: [['horizontal', 'Horizontal'], ['vertical', 'Vertical / angular']] },
  calculus: { label: 'Subgingival calculus', type: 'single', options: [['yes', 'Visible'], ['no', 'Not visible']] },
  furcation: { label: 'Furcation', type: 'single', options: [['wnl', 'Within normal limits'], ['radiolucency', 'Radiolucency']] },
  restorable: { label: 'Restorable', type: 'single', options: [['yes', 'Yes'], ['guarded', 'Yes, guarded'], ['no', 'No']] },
  restorable_basis: { label: 'Restorability shown on', type: 'single', options: [['postop', 'Post-op PA'], ['preop', 'Pre-op film']], showIf: p => p.restorable && p.restorable !== 'no' },
}

// Which groups each procedure uses, in the order they're shown.
const ORDER = {
  rct: ['preop_film', 'decay_surf', 'decay_type', 'decay_depth', 'pa_status', 'pa_roots', 'walls_lost', 'remaining', 'canals', 'fill_length', 'voids', 'restorable', 'restorable_basis'],
  pulpotomy: ['preop_film', 'decay_surf', 'decay_type', 'decay_depth', 'furcation', 'pa_status', 'pa_roots', 'walls_lost', 'remaining', 'restorable'],
  crown: ['preop_film', 'restoration', 'decay_surf', 'decay_type', 'decay_depth', 'prior_rct', 'walls_lost', 'remaining', 'pa_status', 'pa_roots', 'seat', 'restorable', 'restorable_basis'],
  ext_surgical: ['preop_film', 'decay_surf', 'decay_depth', 'remaining', 'roots_feat', 'pa_status', 'pa_roots', 'bone_loss', 'restorable'],
  ext_simple: ['preop_film', 'decay_surf', 'decay_depth', 'remaining', 'pa_status', 'pa_roots', 'bone_loss', 'restorable'],
  filling: ['preop_film', 'decay_surf', 'decay_type', 'decay_depth', 'walls_lost'],
  srp: ['preop_film', 'bone_loss', 'bone_pattern', 'calculus', 'furcation'],
}

export const FINDINGS_PROCS = Object.keys(ORDER)

// Groups for a procedure: [{ key, label, type, options, showIf? }]
export function pickGroups(proc) {
  return (ORDER[proc] || []).map(key => ({ key, ...G[key] }))
}
// Plain-data version (no functions) for sending to the AI.
export function pickSchema(proc) {
  return pickGroups(proc).map(({ key, label, type, options }) => ({ key, label, type, options: options.map(o => o[0]) }))
}
// Keep only valid values; drop groups hidden by showIf.
export function cleanPicks(proc, picks) {
  const out = {}
  pickGroups(proc).forEach(g => {
    const v = picks?.[g.key]
    const ok = new Set(g.options.map(o => o[0]))
    if (g.type === 'multi') { const arr = (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(x => ok.has(x)); if (arr.length) out[g.key] = [...new Set(arr)] }
    else if (v != null && ok.has(String(v))) out[g.key] = String(v)
  })
  pickGroups(proc).forEach(g => { if (g.showIf && !g.showIf(out)) delete out[g.key] })
  return out
}

// ── wording helpers ────────────────────────────────────────────────────────
const FILM = { pa: 'periapical', fmx: 'FMX periapical', bw: 'bitewing', pano: 'panoramic' }
const SURF_WORD = { M: 'mesial', O: 'occlusal', D: 'distal', B: 'buccal', L: 'lingual' }
const ROOT_WORD = { single: '', M: 'mesial', D: 'distal', MB: 'mesiobuccal', DB: 'distobuccal', P: 'palatal', B: 'buccal', L: 'lingual' }
const list = arr => arr.length <= 1 ? (arr[0] || '') : arr.length === 2 ? `${arr[0]} and ${arr[1]}` : `${arr.slice(0, -1).join(', ')} and ${arr.at(-1)}`
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s
const end = s => /[.!?]$/.test(s) ? s : s + '.'

function surfaces(p) {
  const s = (p.decay_surf || []).map(x => SURF_WORD[x]).filter(Boolean)
  if (!s.length) return ''
  if (s.length >= 2) {   // MOD -> "mesio-occluso-distal" style is clunky; use letters + words
    return `${(p.decay_surf || []).join('')} (${list(s)})`
  }
  return s[0]
}
const DEPTH = {
  enamel: 'confined to enamel',
  dentin: 'extending into dentin',
  approaching_pulp: 'extending through dentin into close proximity to the pulp',
  into_pulp: 'extending into the pulp chamber, indicating carious pulp exposure',
}
function decayClause(p) {
  if (!p.decay_depth && !(p.decay_surf || []).length) return ''
  const where = surfaces(p)
  // "an MO", "an occlusal", "a distal", "a DO": letters M, O, L, F are said with a vowel sound
  const an = !where ? false : /^[A-Z]{2,}/.test(where) ? /^[MOLF]/.test(where) : /^[aeiou]/i.test(where)
  const kind = p.decay_type === 'recurrent' ? `recurrent caries beneath the existing${where ? ` ${where}` : ''} restoration`
    : `${an ? 'an' : 'a'}${where ? ` ${where}` : ''} radiolucency consistent with caries`
  return `${kind}${p.decay_depth ? ` ${DEPTH[p.decay_depth]}` : ''}`
}
function periapicalSentence(p) {
  const c = periapicalClause(p)
  if (!c) return ''
  return p.pa_status === 'wnl' ? 'The periapical area appears within normal limits.' : end(`${cap(c)} is noted`)
}
function periapicalClause(p, short) {
  if (!p.pa_status) return ''
  if (p.pa_status === 'wnl') return short ? 'periapical area within normal limits' : 'the periapical area appears within normal limits'
  const roots = (p.pa_roots || []).map(r => ROOT_WORD[r]).filter(Boolean)
  const at = roots.length ? `at the ${list(roots)} root apex${roots.length > 1 ? 'es' : ''}` : 'at the root apex'
  return p.pa_status === 'pdl' ? `widening of the periodontal ligament space ${at}` : `a periapical radiolucency ${at}`
}
const REMAIN_SENT = { 75: 'Approximately 75% of coronal tooth structure remains.', 50: 'Approximately 50% of coronal tooth structure remains.', 25: 'Approximately 25% of coronal tooth structure remains.', lt25: 'Less than 25% of coronal tooth structure remains.', bone: 'The tooth is broken down to the level of the alveolar bone.' }
const REMAIN = { 75: 'approximately 75% of coronal tooth structure remaining', 50: 'approximately 50% of coronal tooth structure remaining', 25: 'approximately 25% of coronal tooth structure remaining', lt25: 'less than 25% of coronal tooth structure remaining', bone: 'the tooth broken down to the level of the alveolar bone' }
function structureSentence(p, t) {
  const walls = (p.walls_lost || []).map(w => ({ M: 'mesial wall/marginal ridge', D: 'distal wall/marginal ridge', B: 'buccal cusp(s)', L: 'lingual cusp(s)', O: 'occlusal/incisal structure' })[w])
  if (!walls.length && !p.remaining) return ''
  const a = walls.length ? `Loss of the ${list(walls)}` : 'Loss of tooth structure'
  return end(`${a}${p.remaining ? `, with ${REMAIN[p.remaining]}` : ''}${t ? ` on #${t}` : ''}`)
}

// ── main builder ───────────────────────────────────────────────────────────
// tests: [{ name: 'cold', value: 'lingering >10 s' }, …]   dx: 'symptomatic irreversible pulpitis …'
// Returns { objective: [sentences], assessment: [sentences], missing: [labels that would strengthen it] }
export function buildFindings(proc, toothIn, picksIn, { tests = [], dx = '' } = {}) {
  const p = cleanPicks(proc, picksIn)
  const t = String(toothIn || '').split(/[,\s]+/).filter(Boolean)[0] || ''
  const film = FILM[p.preop_film] || 'radiograph'
  const O = [], A = [], missing = []
  const testText = tests.filter(x => x && x.value).map(x => `${x.name}: ${x.value}`).join('; ')
  const correlate = what => {
    const support = dx ? `support the diagnosis of ${dx.replace(/\.$/, '')}` : `support the need for ${what}`
    return end(testText ? `Radiographic findings correlate with clinical testing (${testText}) and ${support}` : `Radiographic findings ${support}`)
  }

  if (proc === 'rct' || proc === 'pulpotomy') {
    const decay = decayClause(p), pa = periapicalSentence(p)
    if (decay) O.push(end(`Pre-op ${film}${t ? ` #${t}` : ''} shows ${decay}`))
    if (pa) O.push(pa)
    if (proc === 'pulpotomy' && p.furcation) O.push(p.furcation === 'wnl' ? 'Furcation area appears within normal limits.' : 'A furcation radiolucency is noted.')
    const st = structureSentence(p, ''); if (st) O.push(st)
    if (proc === 'rct' && p.canals) {
      const len = { within1: ' to within approximately 1 mm of the radiographic apex', flush: ' to the radiographic apex', short: ', short of the radiographic apex by more than 2 mm', long: ', with fill material extending beyond the radiographic apex' }[p.fill_length] || ''
      const dens = p.voids === 'dense' ? '; obturation appears dense without voids' : p.voids === 'minor' ? '; minor voids noted' : ''
      O.push(end(`Post-op periapical shows obturation of ${p.canals} canal${p.canals === '1' ? '' : 's'}${len}${dens}`))
    }
    if (decay || pa) A.push(correlate(proc === 'rct' ? 'root canal treatment' : 'pulpal therapy'))
    if (p.restorable === 'yes' || p.restorable === 'guarded') {
      const basis = p.restorable_basis || (proc === 'pulpotomy' ? 'preop' : 'postop')
      const on = basis === 'preop' ? `the pre-op ${film}` : 'the post-op periapical'
      A.push(end(`Remaining tooth structure and bone support on ${on} are adequate; the tooth is restorable${p.restorable === 'guarded' ? ' with a guarded prognosis' : ''}${proc === 'pulpotomy' ? ' with a full-coverage restoration' : ' with a definitive restoration'}`))
    }
    if (!p.decay_depth) missing.push('Decay depth')
    if (!p.pa_status) missing.push('Periapical status')
    if (proc === 'rct' && !p.canals) missing.push('Post-op canals obturated')
    if (!p.restorable) missing.push('Restorable')
  } else if (proc === 'crown') {
    const bits = []
    if (p.restoration && p.restoration !== 'none') bits.push({ large: 'a large existing restoration', failing: 'a failing existing restoration with open margins', fractured: 'a fractured existing restoration' }[p.restoration])
    const decay = decayClause(p); if (decay) bits.push(decay)
    if (p.prior_rct === 'yes') bits.push('previous root canal treatment')
    if (p.prior_rct === 'post') bits.push('previous root canal treatment with a post')
    if (bits.length) O.push(end(`Pre-op ${film}${t ? ` #${t}` : ''} shows ${list(bits)}`))
    const st = structureSentence(p, ''); if (st) O.push(st)
    const pa = periapicalSentence(p); if (pa) O.push(pa)
    if (p.seat === 'closed') O.push('Post-op radiograph shows the crown fully seated with closed margins.')
    if (bits.length || st) A.push(end(`Remaining tooth structure is insufficient to support a direct restoration; full coverage is indicated${dx ? ` (${dx.replace(/\.$/, '')})` : ''}`))
    if (p.restorable === 'yes' || p.restorable === 'guarded') A.push(end(`Root structure and bone support on ${p.restorable_basis === 'postop' ? 'the post-op periapical' : `the pre-op ${film}`} are adequate; the tooth is restorable with a crown${p.restorable === 'guarded' ? ', guarded prognosis' : ''}`))
    if (!p.walls_lost && !p.remaining) missing.push('Tooth structure lost')
    if (!p.restorable) missing.push('Restorable')
  } else if (proc === 'ext_surgical' || proc === 'ext_simple') {
    const decay = decayClause(p)
    if (decay) O.push(end(`Pre-op ${film}${t ? ` #${t}` : ''} shows ${decay}`))
    if (p.remaining) O.push(REMAIN_SENT[p.remaining])
    const rf = (p.roots_feat || []).map(r => ({ curved: 'curved roots', divergent: 'divergent roots', dilacerated: 'root dilaceration', fractured: 'a root fracture', impacted: 'impaction', near_sinus: 'root proximity to the maxillary sinus', near_canal: 'root proximity to the mandibular canal', ankylosed: 'an ankylosed appearance' })[r])
    if (rf.length) O.push(end(`Radiograph shows ${list(rf)}`))
    const pa = periapicalSentence(p); if (pa) O.push(pa)
    if (p.bone_loss && p.bone_loss !== 'none') O.push(end(`${cap(p.bone_loss)} alveolar bone loss is noted`))
    if (p.restorable === 'no') {
      const why = [p.decay_depth === 'into_pulp' || p.remaining === 'bone' || p.remaining === 'lt25' ? 'extensive loss of tooth structure' : '', p.bone_loss === 'severe' ? 'severe bone loss' : '', (p.roots_feat || []).includes('fractured') ? 'root fracture' : ''].filter(Boolean)
      A.push(end(`The tooth is non-restorable${why.length ? ` due to ${list(why)}` : ''}; extraction is indicated`))
    }
    if (proc === 'ext_surgical' && (rf.length || p.remaining === 'bone')) A.push('Radiographic findings support a surgical approach.')
    if (dx) A.push(end(`Findings support the diagnosis of ${dx.replace(/\.$/, '')}`))
    if (!p.restorable) missing.push('Restorable')
    if (proc === 'ext_surgical' && !rf.length && p.remaining !== 'bone') missing.push('Surgical factors')
  } else if (proc === 'filling') {
    const decay = decayClause(p)
    if (decay) O.push(end(`Pre-op ${film}${t ? ` #${t}` : ''} shows ${decay}`))
    const st = structureSentence(p, ''); if (st) O.push(st)
    if (decay) A.push(correlate('restoration'))
    if (!p.decay_depth) missing.push('Decay depth')
  } else if (proc === 'srp') {
    const bits = []
    if (p.bone_loss && p.bone_loss !== 'none') {
      const pat = list((p.bone_pattern || []).map(x => x === 'vertical' ? 'vertical (angular)' : 'horizontal'))
      bits.push(`${p.bone_loss}${pat ? ` ${pat}` : ''} bone loss`)
    }
    if (p.calculus === 'yes') bits.push('subgingival calculus deposits')
    if (p.furcation === 'radiolucency') bits.push('furcation radiolucency')
    if (bits.length) O.push(end(`Radiographs (${film}) show ${list(bits)}`))
    if (bits.length) A.push(end(dx ? `Radiographic findings support the diagnosis of ${dx.replace(/\.$/, '')} and the need for scaling and root planing` : 'Radiographic findings, with the periodontal charting, support the need for scaling and root planing'))
    if (!p.bone_loss) missing.push('Bone loss')
  }
  return { objective: O, assessment: A, missing }
}

// Pull clinical tests and diagnosis out of the note's filled fields.
// fields: [{ id, label, hint, ctx }]   vals: { id: { value } }
const TEST_NAMES = [
  [/\bcold\b|endo ice|refrigerant/i, 'cold'], [/percuss/i, 'percussion'], [/palpat/i, 'palpation'],
  [/\bept\b|electric pulp/i, 'EPT'], [/\bbite\b|tooth slooth|biting/i, 'bite test'], [/heat|\bhot\b/i, 'heat'],
]
export function testsFromNote(fields = [], vals = {}) {
  const seen = new Set(), tests = []
  fields.forEach(f => {
    const v = String(vals[f.id]?.value || '').trim()
    if (!v || vals[f.id]?.excluded) return
    const hay = `${f.label || ''} ${f.hint || ''} ${f.ctx || ''}`
    const hit = TEST_NAMES.find(([re]) => re.test(hay))
    if (hit && !seen.has(hit[1]) && !/control/i.test(hay)) { seen.add(hit[1]); tests.push({ name: hit[1], value: v }) }
  })
  return tests
}
export function dxFromNote(fields = [], vals = {}) {
  const out = []
  fields.forEach(f => {
    const v = String(vals[f.id]?.value || '').trim()
    if (!v || vals[f.id]?.excluded) return
    const hay = `${f.label || ''} ${f.hint || ''} ${f.ctx || ''}`
    if (/diagnos|\bdx\b|pulpal|apical dx|periapical dx/i.test(hay) && !/radiograph|x-?ray/i.test(hay) && v.length > 3) out.push(v)
  })
  return [...new Set(out)].slice(0, 2).join(' with ')
}
