// src/lib/toothAnatomy.js
// Tooth-aware defaults for the Note Builder (universal numbering: permanent 1-32, primary A-T).
// Canal counts are the usual configuration for each tooth; the dentist adds or removes
// canals per case. Codes are the CDT code the tooth and choices point to; the dentist
// confirms the code on the claim.

const N = t => { const n = parseInt(String(t ?? '').replace(/[^\d]/g, ''), 10); return n >= 1 && n <= 32 ? n : null }
const LETTER = t => { const m = String(t ?? '').trim().toUpperCase().match(/^#?([A-T])$/); return m ? m[1] : null }

// Primary teeth: A-J upper (A = upper right second molar), K-T lower (K = lower left second molar)
function primaryInfo(L) {
  const i = L.charCodeAt(0) - 65                       // A = 0 ... T = 19
  const arch = i <= 9 ? 'max' : 'mand'
  const k = arch === 'max' ? i : i - 10                // 0..9 across the arch
  const pos = k <= 4 ? 5 - k : k - 4                   // 1 = central ... 5 = second molar
  const kind = pos <= 2 ? 'incisor' : pos === 3 ? 'canine' : 'molar'
  const ord = { 1: 'central', 2: 'lateral', 4: 'first', 5: 'second' }[pos] || ''
  const archName = arch === 'max' ? 'maxillary' : 'mandibular'
  const name = `primary ${kind === 'canine' ? `${archName} canine` : `${archName} ${ord} ${kind}`}`
  return { n: L, arch, pos, kind, name, primary: true, anterior: kind !== 'molar', thirdMolar: false }
}

export const isPrimary = t => !!LETTER(t)
export const toothLabel = t => { const ti = toothInfo(t); return ti ? `#${ti.n}` : '' }

export function toothInfo(t) {
  const L = LETTER(t); if (L) return primaryInfo(L)
  const n = String(t ?? '').trim().match(/^#?\d{1,2}$/) ? N(t) : null; if (!n) return null
  const arch = n <= 16 ? 'max' : 'mand'
  // position counted from the midline: 1 = central incisor ... 8 = third molar
  const pos = arch === 'max' ? (n <= 8 ? 9 - n : n - 8) : (n <= 24 ? 25 - n : n - 24)
  const kind = pos <= 2 ? 'incisor' : pos === 3 ? 'canine' : pos <= 5 ? 'premolar' : 'molar'
  const ord = { 1: 'central', 2: 'lateral', 4: 'first', 5: 'second', 6: 'first', 7: 'second', 8: 'third' }[pos] || ''
  const archName = arch === 'max' ? 'maxillary' : 'mandibular'
  const name = kind === 'canine' ? `${archName} canine` : `${archName} ${ord} ${kind}`
  const side = (arch === 'max' ? n <= 8 : n >= 25) ? 'right' : 'left'
  return { n, arch, pos, kind, name, side, anterior: kind === 'incisor' || kind === 'canine', thirdMolar: pos === 8 }
}

// Usual canals, and the extra canals worth offering as one tap
export function canalsFor(t) {
  const ti = toothInfo(t); if (!ti || ti.primary) return { usual: [], extra: [] }
  if (ti.arch === 'max') {
    if (ti.anterior) return { usual: ['Canal'], extra: [] }
    if (ti.pos === 4) return { usual: ['B', 'P'], extra: ['MB'] }               // 1st premolar: usually 2
    if (ti.pos === 5) return { usual: ['Canal'], extra: ['B', 'P'] }            // 2nd premolar: usually 1
    if (ti.pos === 6) return { usual: ['MB', 'MB2', 'DB', 'P'], extra: [] }     // 1st molar: MB2 found in most
    return { usual: ['MB', 'DB', 'P'], extra: ['MB2'] }                          // 2nd/3rd molar
  }
  if (ti.kind === 'incisor') return { usual: ['Canal'], extra: ['B', 'L'] }     // 2 canals in about a third
  if (ti.kind === 'canine') return { usual: ['Canal'], extra: ['B', 'L'] }
  if (ti.kind === 'premolar') return { usual: ['Canal'], extra: ['B', 'L'] }
  if (ti.pos === 6) return { usual: ['MB', 'ML', 'D'], extra: ['DB', 'DL', 'MM'] } // 1st molar: distal may split
  return { usual: ['MB', 'ML', 'D'], extra: ['DB', 'DL', 'C-shaped'] }
}

// When a split is added (B + L), the single "Canal" goes away
export function addCanal(list, c, t) {
  let next = [...list]
  if (['B', 'L', 'P'].includes(c)) next = next.filter(x => x !== 'Canal')
  if (['DB', 'DL'].includes(c)) next = next.filter(x => x !== 'D')
  if (c === 'C-shaped') next = ['C-shaped']
  if (!next.includes(c)) next.push(c)
  const pairs = { B: 'L', L: 'B', P: 'B', DB: 'DL', DL: 'DB' }
  if (pairs[c] && !next.includes(pairs[c]) && toothInfo(t)?.kind !== 'molar') next.push(pairs[c])
  if (['DB', 'DL'].includes(c) && !next.includes(pairs[c])) next.push(pairs[c])
  const order = ['Canal', 'C-shaped', 'MB', 'MB2', 'MM', 'ML', 'B', 'DB', 'D', 'DL', 'P', 'L']
  return next.sort((a, b) => order.indexOf(a) - order.indexOf(b))
}

// Reference point for working length
export function refPoint(canal, t) {
  const ti = toothInfo(t); if (!ti) return ''
  if (ti.anterior) return 'incisal edge'
  if (ti.kind === 'premolar') return canal === 'L' || canal === 'P' ? `${canal === 'P' ? 'palatal' : 'lingual'} cusp` : 'buccal cusp'
  const map = ti.arch === 'max'
    ? { MB: 'MB cusp', MB2: 'MB cusp', DB: 'DB cusp', P: 'MP cusp', 'C-shaped': 'MB cusp' }
    : { MB: 'MB cusp', MM: 'MB cusp', ML: 'ML cusp', D: 'DB cusp', DB: 'DB cusp', DL: 'DL cusp', 'C-shaped': 'MB cusp' }
  return map[canal] || 'MB cusp'
}

export function rctCode(t) {
  const ti = toothInfo(t); if (!ti) return null
  if (ti.primary) return { code: ti.anterior ? 'D3230' : 'D3240', name: 'primary pulpal therapy (not D33xx)' }
  return ti.anterior ? { code: 'D3310', name: 'anterior root canal' } : ti.kind === 'premolar' ? { code: 'D3320', name: 'premolar root canal' } : { code: 'D3330', name: 'molar root canal' }
}

export function surfacesFor(t) {
  const ti = toothInfo(t); if (!ti) return []
  return ti.anterior ? ['M', 'D', 'F', 'L', 'I'] : ['M', 'O', 'D', 'B', 'L']
}

// Composite code from tooth and surfaces (an anterior incisal angle counts as D2335)
export function compositeCode(t, surfaces) {
  const ti = toothInfo(t); const k = (surfaces || []).length
  if (!ti || !k) return null
  if (ti.anterior) {
    if (k >= 4 || surfaces.includes('I')) return { code: 'D2335', name: 'anterior composite, 4+ surfaces or incisal angle' }
    return { code: ['D2330', 'D2331', 'D2332'][k - 1], name: `anterior composite, ${k} surface${k > 1 ? 's' : ''}` }
  }
  return { code: ['D2391', 'D2392', 'D2393', 'D2394'][Math.min(k, 4) - 1], name: `posterior composite, ${k >= 4 ? '4+' : k} surface${k > 1 ? 's' : ''}` }
}

// Order surfaces the way they're charted (MODBL / MIDFL)
export function surfaceString(list, t) {
  const order = toothInfo(t)?.anterior ? ['M', 'I', 'D', 'F', 'L'] : ['M', 'O', 'D', 'B', 'L']
  return [...list].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join('')
}

// Extraction notes tied to the tooth
export function extractionNotes(t) {
  const ti = toothInfo(t); if (!ti) return []
  const out = []
  if (ti.primary) out.push('Primary tooth: note the successor and root resorption on the film. Teeth near exfoliation are often not covered.')
  if (ti.thirdMolar) out.push('Third molar: on TennCare adults, unerupted third molars are not covered except soft-tissue impactions and residual roots.')
  if (ti.arch === 'mand' && (ti.kind === 'molar' || ti.kind === 'premolar')) out.push('Note the root relation to the IAN canal on the pre-op film.')
  if (ti.arch === 'max' && (ti.kind === 'molar' || ti.pos === 5)) out.push('Note the root relation to the maxillary sinus on the pre-op film.')
  return out
}

// Usual canal for a post
export function postCanal(t) {
  const ti = toothInfo(t); if (!ti) return null
  if (ti.kind === 'molar') return ti.arch === 'max' ? 'P' : 'D'
  if (ti.kind === 'premolar' && ti.arch === 'max' && ti.pos === 4) return 'P'
  return 'Canal'
}

// ---- crowns
export const CROWN_MATERIALS = ['zirconia', 'e.max', 'PFM']
export const PFM_METALS = { 'high noble': 'D2750', 'base metal': 'D2751', noble: 'D2752' }
export function crownCode(material, metal) {
  if (!material) return null
  if (material === 'PFM') return metal && PFM_METALS[metal] ? { code: PFM_METALS[metal], name: `PFM, ${metal}` } : null
  return { code: 'D2740', name: `${material} (porcelain/ceramic)` }
}
// Opposing tooth in the other arch (universal numbering)
export function opposingTooth(t) {
  const ti = toothInfo(t); if (!ti || ti.primary) return null
  return 33 - ti.n
}

// ---- scaling and root planing
export const QUADS = { UR: [1, 2, 3, 4, 5, 6, 7, 8], UL: [9, 10, 11, 12, 13, 14, 15, 16], LL: [17, 18, 19, 20, 21, 22, 23, 24], LR: [25, 26, 27, 28, 29, 30, 31, 32] }
export function srpCode(count) {
  if (!count) return null
  return count >= 4 ? { code: 'D4341', name: `SRP, ${count} teeth in the quadrant` } : { code: 'D4342', name: `SRP, ${count} ${count > 1 ? 'teeth' : 'tooth'} in the quadrant` }
}

// ---- pulpotomy
export function pulpotomyNotes(t) {
  const ti = toothInfo(t); if (!ti) return []
  if (ti.primary) return ['Film must show the root is not near exfoliation, with no furcation or periapical radiolucency.', ti.kind === 'molar' ? 'Usually restored with a stainless steel crown (D2930).' : 'Anterior primary tooth: confirm a restoration plan (strip crown or SSC).']
  return ['Permanent tooth: D3220 is a therapeutic pulpotomy, not the first stage of a root canal. Record the plan for definitive treatment.']
}

// ---- sorting teeth the way they're charted
export function sortTeeth(list) {
  const key = t => { const ti = toothInfo(t); if (!ti) return 999; return ti.primary ? 100 + (String(ti.n).charCodeAt(0) - 65) : ti.n }
  return [...list].sort((a, b) => key(a) - key(b))
}
