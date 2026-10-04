// src/lib/noteAddons.js
// Add-ons for the Note Builder: extra procedures done at the same visit. Each one adds
// its own lines to the note (under S, O, A or P), or prints as its own separate note.
// Lines use the same template syntax as noteTemplates.js: S/O/A/P alone on a line are
// section markers, [ ] is a blank, { a / b } is a choice or an optional insert.
//
//   key       stable id
//   label     chip text
//   code      CDT code it supports (the claim decides; this is a reminder)
//   sections  0-based NOTE_TEMPLATES indexes it is offered on
//   lines     template lines
//   note      one-line billing / documentation reminder shown on the chip
//   excludes  add-ons that can't be on the same note

// NOTE_TEMPLATES indexes, for readability
const PROPHY = 1, SRP = 2, PERIO_MAINT = 4, FILL = 5, PALLIATIVE = 6, RCT = 7, BUILDUP = 8,
  CROWN_PREP = 9, CROWN_SEAT = 10, CEREC = 11, EXT = 12, SURG_EXT = 13, NITROUS = 18, PULP = 21
const ALL = [...Array(22).keys()].filter(i => i !== NITROUS)

export const NOTE_ADDONS = [
  {
    key: 'buildup', label: 'Core buildup', code: 'D2950', sections: [RCT, CROWN_PREP, CEREC],
    note: 'Needs the remaining structure (% and walls) and why a core is needed.',
    lines: [
      'O',
      'Buildup #[ ]: coronal structure remaining [estimate %]; walls remaining: [ ]; cusps lost: [ ]. {Photo taken before buildup.}',
      'A',
      'Insufficient tooth structure to retain a crown without a core.',
      'P',
      'Core buildup #[ ] with [CompCore / material] {bonded with [adhesive]}.',
    ],
  },
  {
    key: 'pins', label: 'Pins', code: 'D2951', sections: [FILL, RCT, BUILDUP, CROWN_PREP],
    note: 'Per tooth, in addition to the restoration or buildup.',
    lines: ['P', 'Pin retention #[ ]: [#] [pin type] pins placed.'],
  },
  {
    key: 'post', label: 'Prefab post and core', code: 'D2954', sections: [RCT, BUILDUP, CROWN_PREP], excludes: ['castPost', 'buildup'],
    note: 'Includes the core; don\'t add a separate D2950. Needs post space depth and apical seal left.',
    lines: [
      'O',
      'Post #[ ]: coronal structure remaining [estimate %]; RCT completed [date].',
      'P',
      'Post space prepared in [canal] to [mm] mm, leaving [mm] mm of apical gutta-percha. Prefabricated post [type/size] cemented with [cement]; core [material].',
    ],
  },
  {
    key: 'castPost', label: 'Cast post and core', code: 'D2952', sections: [RCT, BUILDUP, CROWN_PREP], excludes: ['post', 'buildup'],
    note: 'Indirect: record the impression visit and the cementation visit.',
    lines: ['P', 'Post space prepared in [canal] to [mm] mm, leaving [mm] mm of apical gutta-percha. {Impression for cast post and core sent to [lab] / Cast post and core cemented with [cement]}.'],
  },
  {
    key: 'ipc', label: 'Indirect pulp cap', code: 'D3120', sections: [FILL, CROWN_PREP, PULP], excludes: ['dpc'],
    note: 'Many plans bundle this into the filling. Check Renaissance before billing it separately.',
    lines: [
      'A',
      'Deep caries #[ ] approaching the pulp, no exposure; pulp {normal / reversible pulpitis}.',
      'P',
      'Indirect pulp cap #[ ]: affected dentin left over the pulp and covered with [TheraCal LC / Dycal / glass ionomer].',
    ],
  },
  {
    key: 'dpc', label: 'Direct pulp cap', code: 'D3110', sections: [FILL, CROWN_PREP], excludes: ['ipc'],
    note: 'Needs exposure size, hemostasis time, the material, and a vitality recheck.',
    lines: [
      'O',
      'Pulp exposure #[ ] during caries removal: [size] mm, {mechanical / carious}; hemostasis in [ ] min with [NaOCl / saline].',
      'P',
      'Direct pulp cap #[ ] with [MTA / Biodentine / TheraCal LC], sealed with [glass ionomer]. Vitality recheck in [ ] weeks.',
    ],
  },
  {
    key: 'desens', label: 'Desensitizer', code: 'D9910', sections: [PROPHY, SRP, PERIO_MAINT, FILL, CROWN_PREP, CROWN_SEAT, CEREC],
    note: 'Per visit. Record what was sensitive and to what.',
    lines: ['S', 'Sensitivity #[ ] to {cold / air / touch / sweets}.', 'P', 'Desensitizer [Gluma / fluoride varnish / product] applied to #[ ].'],
  },
  {
    key: 'sealant', label: 'Sealant', code: 'D1351', sections: [PROPHY, FILL, PERIO_MAINT],
    note: 'Per tooth; caries-free occlusal surface.',
    lines: ['P', 'Sealant #[ ]: pits and fissures caries-free; etched, rinsed, dried; [sealant material] placed and cured; retention checked with explorer.'],
  },
  {
    key: 'fluoride', label: 'Fluoride varnish', code: 'D1206', sections: [SRP, PERIO_MAINT, FILL, PULP],
    note: 'Record caries risk if the plan limits adult fluoride.',
    lines: ['P', 'Fluoride varnish ([5% NaF varnish / product]) applied to all teeth; no eating or drinking for 30 min.'],
  },
  {
    key: 'occAdj', label: 'Occlusal adjustment', code: 'D9951', sections: [FILL, PALLIATIVE, RCT, CROWN_SEAT, CEREC],
    note: 'Limited adjustment. Record what was high and how it was checked.',
    lines: ['P', 'Occlusal adjustment #[ ]: [high spots / interferences] reduced; checked with articulating paper in centric and excursions.'],
  },
  {
    key: 'protective', label: 'Protective restoration', code: 'D2940', sections: [PALLIATIVE, PULP, FILL],
    note: 'Sedative or interim filling, not a final restoration.',
    lines: ['P', 'Protective restoration #[ ] with [IRM / glass ionomer]; final restoration planned: [ ].'],
  },
  {
    key: 'graft', label: 'Socket preservation graft', code: 'D7953', sections: [EXT, SURG_EXT],
    note: 'Often not covered on TennCare adults. Record the material and why.',
    lines: ['P', 'Socket preservation #[ ]: [graft material] placed in the socket, covered with [collagen plug / membrane]; secured with [suture].'],
  },
  {
    key: 'nitrous', label: 'Nitrous oxide', code: 'D9230', sections: ALL,
    note: 'Record the reason, the % titrated, times, and 100% O2 after.',
    lines: ['P', 'Nitrous oxide/oxygen for [anxiety / gag reflex / reason]: titrated to [%] N2O; [start time]-[end time]; 100% O2 for [ ] min after; pt alert and oriented at dismissal.'],
  },
]

export const addonsFor = sectionIdx => NOTE_ADDONS.filter(a => a.sections.includes(sectionIdx))
export const addonByKey = key => NOTE_ADDONS.find(a => a.key === key)
