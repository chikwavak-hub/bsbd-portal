// src/lib/noteStandards.js
// Standard protocol for the Note Builder: wording that goes into every note of
// a procedure as written, unless the dentist removes it or the records say
// otherwise. These are BSBD's routine steps and choices, never findings, test
// results, diagnoses, tooth numbers, amounts or times. A dentist can switch
// any of them off for their own notes in Note Builder preferences.
//
// Each entry:
//   key       stable id (saved in a dentist's "off" list)
//   label     what staff see on the chip
//   sections  1-based "Clinical Notes That Hold Up" section numbers (6.x), or null for every procedure
//   match     (inner, ctx) => true when a template blank is this item
//             inner = text inside the [ ] or { } blank, ctx = the words just before it
//   value     (prefs, tooth) => text to put in the blank, or null to leave it alone
//   byTooth   true when the value depends on the tooth (filled once the tooth is known)

const has = (s, re) => re.test(String(s || ''))
const arch = tooth => (tooth >= 1 && tooth <= 16 ? 'max' : tooth >= 17 && tooth <= 32 ? 'mand' : null)
const pct = (s, fallback) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*%/); return m ? `${m[1]}%` : fallback }

export const NOTE_STANDARDS = [
  // ---- every procedure
  { key: 'medhx', label: 'Med hx reviewed, no changes', sections: null,
    match: i => has(i, /^no changes \/ changes/i), value: () => 'no changes' },
  { key: 'topical', label: 'Topical anesthetic', sections: null,
    match: (i, c) => has(c, /topical/i) && has(i, /benzocaine/i), value: p => p.topical || 'benzocaine 20%' },
  { key: 'topicalSite', label: 'Topical at injection site', sections: null,
    match: (i, c) => i === 'site' && has(c, /^at$/i), value: () => 'injection site' },
  { key: 'technique', label: 'IANB lower, infiltration upper', sections: null, byTooth: true,
    match: i => has(i, /IANB \/ buccal inf/i),
    value: (p, tooth, sec) => {
      const a = arch(tooth); if (!a) return null
      if (a === 'mand') return 'IANB'
      return [13, 14, 15].includes(sec) ? 'buccal and palatal infiltration' : 'buccal infiltration'
    } },
  { key: 'agent', label: 'Usual anesthetic for the arch', sections: null, byTooth: true,
    match: i => has(i, /^agent, % and epi$/i),
    value: (p, tooth) => { const a = arch(tooth); if (!a) return null; return (a === 'mand' ? p.blockAgent : p.infilAgent) || null } },
  { key: 'aspirated', label: 'Aspirated negative', sections: null,
    match: i => has(i, /^Aspirated negative\.?$/i), value: () => 'Aspirated negative.' },
  { key: 'consentExt', label: 'Extraction offered as an alternative', sections: null,
    match: (i, c) => has(i, /^\/\s*extraction$/i), value: () => 'or extraction' },
  { key: 'poi', label: 'POI verbal and written', sections: null,
    match: i => has(i, /^POI given verbally and in writing\.?$/i), value: p => p.poi || 'POI given verbally and in writing.' },
  { key: 'rx', label: 'No prescription', sections: null,
    match: i => has(i, /^none \/ \[drug/i), value: () => 'none' },

  // ---- 6.2 prophy
  { key: 'scaling', label: 'Ultrasonic and hand scaling', sections: [2],
    match: i => has(i, /^ultrasonic \/ hand instruments$/i), value: () => 'ultrasonic and hand instruments' },

  // ---- 6.6 restorations
  { key: 'isolation', label: 'Isolation', sections: [6],
    match: i => has(i, /^rubber dam \/ Isolite/i), value: p => p.isolation || 'rubber dam' },
  { key: 'noExposure', label: 'Caries removed, no pulp exposure', sections: [6],
    match: i => has(i, /^no pulp exposure \/ near exposure/i), value: () => 'no pulp exposure' },
  { key: 'etch', label: 'Etch technique', sections: [6],
    match: i => has(i, /^selective etch \/ self-etch$/i), value: p => (has(p.etchBond, /self/i) ? 'self-etch' : 'selective etch') },
  { key: 'composite', label: 'Usual composite', sections: [6],
    match: i => has(i, /Tetric EvoCeram \/ SonicFill/i), value: p => p.composite || null },
  { key: 'contacts', label: 'Contacts tight, floss passes', sections: [6],
    match: i => has(i, /^tight, floss passes$/i), value: () => 'tight, floss passes' },

  // ---- 6.8 root canal
  { key: 'restorable', label: 'Restorable, sound margins possible', sections: [8],
    match: i => has(i, /^sound margins possible \/ ferrule/i), value: () => 'sound margins possible' },
  { key: 'bone', label: 'Bone support over 50%', sections: [8, 10],
    match: i => has(i, /^>50%$/), value: () => '>50%' },
  { key: 'prognosis', label: 'Prognosis favorable', sections: [8],
    match: i => has(i, /^favorable\/questionable$/i), value: () => 'favorable' },
  { key: 'control', label: 'Control tooth normal', sections: [8],
    match: (i, c) => i === 'normal', value: () => 'normal' },
  { key: 'naocl', label: 'NaOCl irrigation', sections: [8],
    match: (i, c) => i === '%' && has(c, /NaOCl/i), value: p => pct(p.naocl, '3%') },
  { key: 'flush', label: 'Sterile water flush', sections: [8],
    match: i => has(i, /^sterile water\/alcohol flush$/i), value: () => 'sterile water flush' },
  { key: 'gp', label: 'Usual gutta-percha', sections: [8],
    match: i => has(i, /^gutta-percha brand/i), value: p => p.gp || null },
  { key: 'sealer', label: 'Usual sealer', sections: [8],
    match: (i, c) => i === 'sealer', value: p => p.sealer || null },
  { key: 'obturation', label: 'Usual obturation technique', sections: [8],
    match: i => has(i, /^single cone \/ warm vertical/i), value: p => (p.obturation && !p.obturation.includes('/') ? p.obturation : null) },

  // ---- 6.10 / 6.11 crowns
  { key: 'perioStable', label: 'Perio stable', sections: [10],
    match: (i, c) => i === 'stable' && has(c, /perio/i), value: () => 'stable' },
  { key: 'impression', label: 'Usual impression or scan', sections: [10],
    match: i => has(i, /^digital scan \/ PVS/i), value: p => p.impression || null },
  { key: 'tempMat', label: 'Usual temporary', sections: [10],
    match: (i, c) => i === 'material' && has(c, /temporary/i), value: p => p.temp || null },
  { key: 'tempCement', label: 'Temp cemented with TempBond', sections: [10],
    match: i => has(i, /^TempBond$/i), value: () => 'TempBond' },
  { key: 'margins', label: 'Margins closed, verified', sections: [11],
    match: i => has(i, /^closed, verified with explorer$/i), value: () => 'closed, verified with explorer' },
  { key: 'seatContacts', label: 'Contacts, floss with resistance', sections: [11],
    match: i => has(i, /^floss passes with resistance$/i), value: () => 'floss passes with resistance' },
  { key: 'cement', label: 'Usual cement', sections: [11],
    match: i => has(i, /^RelyX Unicem 2 \/ GC Fuji Plus$/i), value: p => p.cement || null },

  // ---- 6.13 / 6.14 extractions
  { key: 'elevators', label: 'Elevators and forceps', sections: [13],
    match: i => has(i, /^elevators and forceps$/i), value: () => 'elevators and forceps' },
  { key: 'hemostasis', label: 'Hemostasis with gauze pressure', sections: [13],
    match: i => has(i, /^gauze pressure \/ Gelfoam/i), value: () => 'gauze pressure' },
  { key: 'delivered', label: 'Tooth and roots delivered complete', sections: [14],
    match: i => has(i, /^complete \/ note any fragment/i), value: () => 'complete' },
  { key: 'ebl', label: 'EBL minimal', sections: [14],
    match: i => has(i, /^minimal$/i), value: () => 'minimal' },
  { key: 'suture', label: 'Usual suture', sections: [14],
    match: i => has(i, /^suture type\/size, #$/i), value: p => p.suture || null },
]

// The standard (if any) for one template blank in one section.
export function standardFor(sectionNo, inner, ctx) {
  return NOTE_STANDARDS.find(s => (!s.sections || s.sections.includes(sectionNo)) && s.match(String(inner || '').trim(), String(ctx || '').trim())) || null
}
