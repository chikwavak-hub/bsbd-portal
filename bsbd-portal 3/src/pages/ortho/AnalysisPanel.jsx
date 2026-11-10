// Smart analysis for the Orthodontic Diagnostic Record.
//
//   cephFeedback(id, value, data)  → how one ceph value compares with its norm (age / sex adjusted where it matters)
//   checklist(data)                → critical + recommended items the plan depends on, and which are still missing
//   analyze(data)                  → problem list + suggested phased treatment plan (only once critical items are in)
//   planToForm(plan)               → the fields "Use this plan" writes onto the Summary & Treatment Plan page
//
// Everything here is rule-based and explainable: every finding and suggestion carries the reasons it fired.
// It is decision support for the treating dentist, not a diagnosis. Nothing is written to the chart until the
// dentist chooses to use the plan.

import { FORMS } from './orthoSchema';

// ---------------------------------------------------------------- helpers
export const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const has = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0);
const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const r1 = (n) => Math.round(n * 10) / 10;
const sgn = (n) => (n > 0 ? '+' : '') + r1(n);

// Page numbers (1-based) by title, so links survive page reordering.
const ORTHO_PAGES = FORMS.ortho.pages.map((p) => p.title);
export const pageOf = (title) => ORTHO_PAGES.indexOf(title);

// ---------------------------------------------------------------- patient context
export function patientCtx(data) {
  const age = num(data.age);
  const sex = data.sex === 'F' ? 'F' : data.sex === 'M' ? 'M' : null;
  const dentition = data.cl_dentition || '';
  const growing = age != null ? age < 15 : dentition === 'Mixed' || dentition === 'Deciduous' ? true : null;
  const child = age != null ? age < 12 : dentition === 'Mixed' || dentition === 'Deciduous';
  return { age, sex, dentition, growing, child };
}

// Modified Harvold reference (same table printed on the Harvold page).
const HARV_AGES = [6, 9, 13, 14, 16, 18];
const HARV = {
  M: { mx: [82, 87, 92, 96, 100, 100], md: [99, 107, 114, 121, 127, 130], diff: [17, 20, 22, 25, 27, 30], lfh: [59, 62, 64, 68, 71, 72] },
  F: { mx: [80, 85, 90, 92, 93, 93], md: [97, 105, 113, 117, 119, 120], diff: [17, 20, 23, 25, 26, 27], lfh: [57, 60, 62, 64, 65, 67] },
};
export function harvoldExpected(key, age, sex) {
  if (age == null || !sex) return null;
  const t = HARV[sex][key];
  if (age <= HARV_AGES[0]) return t[0];
  if (age >= HARV_AGES[HARV_AGES.length - 1]) return t[t.length - 1];
  for (let i = 0; i < HARV_AGES.length - 1; i++) {
    const a = HARV_AGES[i], b = HARV_AGES[i + 1];
    if (age >= a && age <= b) return r1(t[i] + ((t[i + 1] - t[i]) * (age - a)) / (b - a));
  }
  return null;
}

// ---------------------------------------------------------------- ceph norms
// lo / hi = normal range. hiText / loText = what being above / below means. interp = short words for the form's Interpretation column.
function norm(id, p, data) {
  const { age, sex, child } = p;
  switch (id) {
    case 'sna': return { lo: 80, hi: 84, unit: '°', hiText: 'Maxilla protrusive', loText: 'Maxilla retrusive', interp: ['MX Retrognathic', 'Normal', 'MX Prognathic'] };
    case 'snb': return { lo: 78, hi: 82, unit: '°', hiText: 'Mandible protrusive', loText: 'Mandible retrusive', interp: ['MD Retrognathic', 'Normal', 'MD Prognathic'] };
    case 'anb': return { lo: 0, hi: 4, unit: '°', hiText: 'Skeletal Class II', loText: 'Skeletal Class III', okText: 'Skeletal Class I', interp: ['Class III', 'Class I', 'Class II'] };
    case 'nsgom': return { lo: 29, hi: 35, unit: '°', hiText: 'High angle — vertical grower', loText: 'Low angle — horizontal grower', interp: ['Closed', 'Average', 'Open'] };
    case 'pgnb': return { lo: 2, hi: 5, unit: 'mm', hiText: 'Prominent chin', loText: 'Weak chin', interp: ['Chin weak', 'Normal', 'Chin prominent'] };
    case 'nap': return { lo: -3, hi: 7, unit: '°', hiText: 'Convex profile', loText: 'Concave profile', interp: ['Concave', 'Straight', 'Convex'] };
    case 'nans': return { lo: null, hi: null, unit: 'mm', ratioOnly: true };
    case 'ansm': {
      const up = num(data.ceph_nans_i);
      const target = child ? 50 : 55;
      if (up != null) return { ratio: true, lo: target - 2, hi: target + 2, unit: '%', hiText: 'Long lower face', loText: 'Short lower face', interp: ['Short', 'Normal', 'Long'], base: up };
      const e = harvoldExpected('lfh', age, sex);
      if (e != null) return { lo: e - 3, hi: e + 3, unit: 'mm', hiText: 'Long lower face for age', loText: 'Short lower face for age', interp: ['Short', 'Normal', 'Long'], note: `expected ≈${e} mm` };
      return null;
    }
    case 'wits': { const m = sex === 'F' ? 0 : -1; return { lo: m - 2, hi: m + 2, unit: 'mm', hiText: 'Class II jaw relationship', loText: 'Class III jaw relationship', okText: 'Class I jaw relationship', interp: ['Class III', 'Class I', 'Class II'] }; }
    case 'npa': return child ? { lo: -2, hi: 2, unit: 'mm', hiText: 'Maxilla forward', loText: 'Maxilla back (retrusive)', interp: ['MX retrusive', 'Normal', 'MX protrusive'] }
      : { lo: -1, hi: 3, unit: 'mm', hiText: 'Maxilla forward', loText: 'Maxilla back (retrusive)', interp: ['MX retrusive', 'Normal', 'MX protrusive'] };
    case 'nppg': {
      const r = child ? [-8, -4] : sex === 'F' ? [-4, 0] : [-2, 2];
      return { lo: r[0], hi: r[1], unit: 'mm', hiText: 'Chin forward', loText: 'Chin back (mandible retrusive)', interp: ['MD retrusive', 'Normal', 'MD protrusive'] };
    }
    case 'mxlen': { const e = harvoldExpected('mx', age, sex); return e == null ? null : { lo: e - 3, hi: e + 3, unit: 'mm', hiText: 'Maxilla long for age', loText: 'Maxilla short for age', interp: ['MX short', 'Normal', 'MX long'], note: `expected ≈${e} mm` }; }
    case 'mdlen': { const e = harvoldExpected('md', age, sex); return e == null ? null : { lo: e - 4, hi: e + 4, unit: 'mm', hiText: 'Mandible long for age', loText: 'Mandible short for age', interp: ['MD short', 'Normal', 'MD long'], note: `expected ≈${e} mm` }; }
    case 'diff': { const e = harvoldExpected('diff', age, sex); return e == null ? null : { lo: e - 3, hi: e + 3, unit: 'mm', hiText: 'Class III tendency (mandible long vs maxilla)', loText: 'Class II tendency (mandible short vs maxilla)', interp: ['Class II', 'Class I', 'Class III'], note: `expected ≈${e} mm` }; }
    case 'ugon': return { lo: 52, hi: 55, unit: '°', hiText: 'Above range', loText: 'Below range', interp: ['Below range', 'Normal', 'Above range'] };
    case 'lgon': return { lo: 70, hi: 75, unit: '°', hiText: 'Vertical growth pattern', loText: 'Horizontal growth pattern', interp: ['Horizontal', 'Normal', 'Vertical'] };
    case 'u1ns': return { lo: 97, hi: 107, unit: '°', hiText: 'Upper incisors flared', loText: 'Upper incisors upright / retroclined', interp: ['Vertical', 'Normal', 'Flared'] };
    case 'u1l1': return { lo: 124, hi: 136, unit: '°', hiText: 'Incisors upright — deep bite tendency', loText: 'Incisors proclined — protrusive', interp: ['Proclined', 'Normal', 'Upright'] };
    case 'l1gom': return { lo: 90, hi: 100, unit: '°', hiText: 'Lower incisors flared', loText: 'Lower incisors upright / retroclined', interp: ['Vertical', 'Normal', 'Flared'] };
    case 'u1np': return { lo: 3, hi: 7, unit: 'mm', hiText: 'Upper incisors forward', loText: 'Upper incisors back', interp: ['Retrusive', 'Normal', 'Protrusive'] };
    case 'l1ap': return { lo: 0, hi: 3, unit: 'mm', hiText: 'Lower incisors forward', loText: 'Lower incisors back', interp: ['Retrusive', 'Normal', 'Protrusive'] };
    case 'u1ans': return { lo: 28, hi: 32, unit: 'mm', hiText: 'Excess upper anterior dental height', loText: 'Short upper anterior dental height', interp: ['Short', 'Normal', 'Excess'] };
    case 'l1m': return { lo: 38, hi: 42, unit: 'mm', hiText: 'Excess lower anterior dental height', loText: 'Short lower anterior dental height', interp: ['Short', 'Normal', 'Excess'] };
    default: return null;
  }
}

// Feedback for one value. Returns null when there is nothing to say (blank value or no norm for this patient yet).
export function cephFeedback(id, value, data) {
  const v = num(value);
  if (v == null) return null;
  const p = patientCtx(data);
  const n = norm(id, p, data);
  if (!n) {
    if (['mxlen', 'mdlen', 'diff'].includes(id)) return { level: 'info', text: 'Enter age and sex on page 1 to compare with Harvold norms for age.' };
    return null;
  }
  if (n.ratioOnly) return { level: 'info', text: 'Used with ANS-M for the lower face ratio.' };
  let x = v, shown = `${r1(v)}${n.unit === '°' ? '°' : ' ' + n.unit}`;
  if (n.ratio) { x = (100 * v) / (v + n.base); shown = `lower face ${r1(x)}%`; }
  const width = Math.max(1, (n.hi - n.lo) / 2);
  let dir = 0, dev = 0;
  if (x > n.hi) { dir = 1; dev = x - n.hi; } else if (x < n.lo) { dir = -1; dev = n.lo - x; }
  const sev = dir === 0 ? 0 : dev > width * 1.5 ? 2 : 1;
  const words = dir === 0 ? n.okText || 'Within normal range' : dir > 0 ? n.hiText : n.loText;
  const range = n.ratio ? `${n.lo}–${n.hi}%` : `${n.lo} to ${n.hi}${n.unit === '°' ? '°' : ' mm'}`;
  return {
    level: sev === 0 ? 'ok' : sev === 1 ? 'mild' : 'marked',
    dir, sev,
    text: `${dir === 0 ? '✓' : dir > 0 ? '▲' : '▼'} ${words}${dir === 0 ? '' : ` (${sgn(dir * dev)} beyond range)`}`,
    detail: `${shown} · normal ${range}${n.note ? ` · ${n.note}` : ''}`,
    interp: n.interp ? n.interp[dir + 1] : '',
  };
}

// Auto interpretation for the form's Interpretation column: from the latest column with a value.
export function autoInterp(id, data) {
  for (const col of ['f', 'p2', 'p1', 'i']) {
    const fb = cephFeedback(id, data[`ceph_${id}_${col}`], data);
    if (fb && fb.interp) return fb.interp;
  }
  return '';
}

// ---------------------------------------------------------------- clinical readers
const ROMAN = { I: 1, II: 2, III: 3 };
function molarClass(s) {
  if (!s) return null;
  const t = String(s).toUpperCase().replace(/CLASS|CL/g, ' ');
  const m = t.match(/\b(III|II|I|1|2|3)\b/);
  if (!m) return /END/.test(t) ? 1.5 : null;
  return ROMAN[m[1]] || Number(m[1]);
}
function readClinical(d) {
  const molars = [molarClass(d.occ_molar_r), molarClass(d.occ_molar_l)].filter((x) => x != null);
  const dpMolar = d.dp_molar ? molarClass(d.dp_molar) : null;
  const molar = molars.length ? Math.max(...molars) : dpMolar;
  const molarMin = molars.length ? Math.min(...molars) : dpMolar;
  const oj = num(d.occ_oj_mm) ?? num(d.dp_oj);
  const ob = num(d.occ_ob_mm) ?? num(d.dp_ob);
  const crossbite = !!(d.q_crossbite && Object.values(d.q_crossbite).some(has));
  const constrictedMx = arr(d.ma_constricted).includes('MX') || arr(d.archform_mx).includes('Narrow') || d.sp_mxarch === 'Constricted';
  const constrictedMd = arr(d.ma_constricted).includes('MD') || arr(d.archform_md).includes('Narrow');
  const tonsils = arr(d.tonsils).includes('Enlarged') || arr(d.tonsils).includes('Inflamed') || ['3', '4'].includes(String(d.tonsil_r)) || ['3', '4'].includes(String(d.tonsil_l));
  const adenoids = d.adenoids === 'Enlarged';
  const mouthBreath = d.hb_breathing === 'Mouth Breather' || arr(d.dh_mouth_breath).some((x) => x === 'Day' || x === 'Night') || arr(d.habits).includes('Mouth breathing');
  const snore = d.tq_snore === 'Y', apnea = d.tq_apnea === 'Y';
  const notNone = (k) => arr(d[k]).some((x) => x && x !== 'None' && !/^No /.test(x));
  const jointSigns = notNone('jp_pain') || notNone('jp_click') || notNone('jp_crep') || notNone('jp_pop');
  const jointPain = notNone('jp_pain') || d.tq_joint_pain === 'Y';
  const maxOpen = num(d.rom_max_open_total) ?? num(d.rom_max_open);
  const locked = d.tq_locked === 'Y';
  const thumb = arr(d.habits).includes('Thumb sucking') || d.hb_thumb === 'Thumb Sucker' || d.hb_finger === 'Yes';
  const tongue = arr(d.habits).includes('Tongue habit') || arr(d.mp_thrust).length > 0 || d.hb_swallow === 'Abnormal';
  return {
    molar, molarMin, oj, ob, crossbite, constrictedMx, constrictedMd, tonsils, adenoids, mouthBreath, snore, apnea,
    jointSigns, jointPain, maxOpen, locked, thumb, tongue,
    deepBite: (ob != null && ob > 4) || d.occ_ob === 'Deep',
    openBite: (ob != null && ob < 0) || d.occ_ob === 'Open',
    crowdMx: d.ma_crowd_mx || '', crowdMd: d.ma_crowd_md || '',
    spacing: d.ma_crowd_mx === 'Spaces' || d.ma_crowd_md === 'Spaces',
    lipsIncompetent: d.mp_lips === 'Incompetent', lipsFull: d.mp_mx_shape === 'Full' || d.mp_md_shape === 'Full',
  };
}

// ---------------------------------------------------------------- checklist
const C = (id, label, page, ok, critical = true) => ({ id, label, page, critical, ok });
export function checklist(d) {
  const ceph = (id) => has(d[`ceph_${id}_i`]);
  const P = (t) => pageOf(t) + 1;
  const items = [
    C('age', 'Age', P('Patient Information'), has(d.age)),
    C('sex', 'Sex', P('Patient Information'), has(d.sex)),
    C('dentition', 'Dentition stage', P('Model Analysis & Classification'), has(d.cl_dentition)),
    C('molar', 'Molar relationship (R / L)', P('Clinical Findings'), has(d.occ_molar_r) || has(d.occ_molar_l) || has(d.dp_molar)),
    C('oj', 'Overjet (mm)', P('Clinical Findings'), has(d.occ_oj_mm) || has(d.dp_oj)),
    C('ob', 'Overbite (mm)', P('Clinical Findings'), has(d.occ_ob_mm) || has(d.dp_ob)),
    C('crowd', 'Crowding — MX and MD', P('Model Analysis & Classification'), has(d.ma_crowd_mx) && has(d.ma_crowd_md)),
    C('archform', 'Maxillary arch form', P('Clinical Findings'), has(d.archform_mx) || has(d.ma_constricted)),
    C('breathing', 'Breathing pattern', P('Clinical Findings (cont.)'), has(d.hb_breathing)),
    C('habits', 'Habits (yes / no)', P('Records & Health Overview'), has(d.habits_any)),
    C('maxopen', 'Maximum opening (initial)', P('TMJ Examination'), has(d.rom_max_open)),
    C('joint', 'Joint palpation — clicking (initial)', P('TMJ Examination'), arr(d.jp_click).length > 0),
    ...[['sna', 'SNA'], ['snb', 'SNB'], ['anb', 'ANB'], ['wits', 'Wits'], ['nsgom', 'NS to GoM'], ['npa', 'N ⊥ A'], ['nppg', 'N ⊥ Pg'],
      ['mxlen', 'MX length (Co–A)'], ['mdlen', 'MD length (Co–Gn)'], ['ansm', 'ANS-M'], ['lgon', 'Lower gonial'], ['u1ns', 'Upper incisor to NS'], ['l1gom', 'Lower incisor to GoM']]
      .map(([id, l]) => C('ceph_' + id, `Ceph — ${l}`, P('Cephalometric Analysis'), ceph(id))),
    // recommended
    C('nans', 'Ceph — N-ANS', P('Cephalometric Analysis'), ceph('nans'), false),
    C('u1l1', 'Ceph — interincisal angle', P('Cephalometric Analysis'), ceph('u1l1'), false),
    C('l1ap', 'Ceph — lower incisor to A-Pog', P('Cephalometric Analysis'), ceph('l1ap'), false),
    C('profile', 'Facial profile', P('Clinical Findings (cont.)'), has(d.fa_profile), false),
    C('lips', 'Lip competence', P('Clinical Findings (cont.)'), has(d.mp_lips), false),
    C('tonsils', 'Tonsils / adenoids', P('Clinical Findings'), has(d.tonsils) || has(d.adenoids), false),
    C('snore', 'Snoring question', P('TMJ Health Questionnaire'), has(d.tq_snore), false),
    C('airwayceph', 'Ceph airway (adenoid / tonsil area)', P('Harvold & Airway'), has(d.aw_adenoids) || has(d.aw_tonsils), false),
    C('photos', 'Records — photos and models / scan', P('Records & Health Overview'), !!(d.rec_photos && (d.rec_models || d.rec_cbct)), false),
  ];
  const crit = items.filter((i) => i.critical);
  return { items, done: crit.filter((i) => i.ok).length, total: crit.length, ready: crit.every((i) => i.ok), missing: crit.filter((i) => !i.ok) };
}

// ---------------------------------------------------------------- analysis + plan
export function analyze(d) {
  const cl = checklist(d);
  const p = patientCtx(d);
  const c = readClinical(d);
  const f = (id) => cephFeedback(id, d[`ceph_${id}_i`], d);
  const v = (id) => num(d[`ceph_${id}_i`]);
  const fb = Object.fromEntries(['sna', 'snb', 'anb', 'wits', 'nsgom', 'npa', 'nppg', 'mxlen', 'mdlen', 'diff', 'ansm', 'lgon', 'u1ns', 'l1gom', 'u1l1', 'l1ap', 'nap', 'pgnb']
    .map((id) => [id, f(id)]));
  const dir = (id) => (fb[id] ? fb[id].dir || 0 : 0);
  const why = (id, label) => (fb[id] && fb[id].detail ? `${label} ${fb[id].detail.split(' · ')[0]} (${fb[id].text.replace(/^[✓▲▼] /, '')})` : null);

  const problems = [];
  const add = (area, text, reasons) => problems.push({ area, text, because: reasons.filter(Boolean) });

  // --- skeletal AP
  const c2Votes = [dir('anb') > 0, dir('wits') > 0, dir('diff') < 0].filter(Boolean).length;
  const c3Votes = [dir('anb') < 0, dir('wits') < 0, dir('diff') > 0].filter(Boolean).length;
  let ap = 'I';
  if (c2Votes >= 2 || (c2Votes === 1 && c.molar >= 2)) ap = 'II';
  else if (c3Votes >= 2 || (c3Votes === 1 && c.molarMin === 3)) ap = 'III';
  const mxBack = dir('sna') < 0 || dir('npa') < 0 || dir('mxlen') < 0;
  const mxFwd = dir('sna') > 0 || dir('npa') > 0;
  const mdBack = dir('snb') < 0 || dir('nppg') < 0 || dir('mdlen') < 0;
  const mdFwd = dir('snb') > 0 || dir('nppg') > 0 || dir('mdlen') > 0;
  const apReasons = [why('anb', 'ANB'), why('wits', 'Wits'), why('diff', 'MX–MD differential'), c.molar ? `Molar Class ${['', 'I', 'II', 'III'][Math.round(c.molar)] || c.molar}` : null];
  const severeII = (v('anb') != null && v('anb') >= 7) || (v('wits') != null && v('wits') >= 5);
  const severeIII = (v('anb') != null && v('anb') <= -3) || (v('wits') != null && v('wits') <= -6);
  if (ap === 'II') {
    const src = mdBack && !mxFwd ? 'mandibular retrusion' : mxFwd && !mdBack ? 'maxillary protrusion' : mdBack && mxFwd ? 'both maxillary protrusion and mandibular retrusion' : 'unclear source';
    add('Skeletal — front to back', `Skeletal Class II${severeII ? ' (severe)' : ''}, mainly ${src}`, [...apReasons, why('snb', 'SNB'), why('nppg', 'N⊥Pg'), why('mdlen', 'MD length'), why('sna', 'SNA'), why('npa', 'N⊥A')]);
  } else if (ap === 'III') {
    const src = mxBack && !mdFwd ? 'maxillary retrusion' : mdFwd && !mxBack ? 'mandibular prognathism' : mxBack && mdFwd ? 'both maxillary retrusion and mandibular prognathism' : 'unclear source';
    add('Skeletal — front to back', `Skeletal Class III${severeIII ? ' (severe)' : ''}, mainly ${src}`, [...apReasons, why('sna', 'SNA'), why('npa', 'N⊥A'), why('mxlen', 'MX length'), why('snb', 'SNB'), why('nppg', 'N⊥Pg')]);
  } else {
    add('Skeletal — front to back', 'Skeletal Class I jaw relationship', apReasons);
  }

  // --- vertical
  const vHigh = [dir('nsgom') > 0, dir('lgon') > 0, dir('ansm') > 0].filter(Boolean).length;
  const vLow = [dir('nsgom') < 0, dir('lgon') < 0, dir('ansm') < 0].filter(Boolean).length;
  const vert = vHigh >= 2 || (vHigh === 1 && c.openBite) ? 'high' : vLow >= 2 || (vLow === 1 && c.deepBite) ? 'low' : 'average';
  const vReasons = [why('nsgom', 'NS–GoM'), why('lgon', 'Lower gonial'), why('ansm', 'ANS-M'), c.openBite ? 'Open bite' : null, c.deepBite ? 'Deep bite' : null];
  if (vert === 'high') add('Skeletal — vertical', `High angle, vertical growth pattern${c.openBite ? ' with open bite' : ''}`, vReasons);
  else if (vert === 'low') add('Skeletal — vertical', `Low angle, horizontal growth pattern${c.deepBite ? ' with deep bite' : ''}`, vReasons);
  else add('Skeletal — vertical', 'Average vertical pattern', vReasons);

  // --- transverse
  if (c.constrictedMx || c.crossbite) add('Transverse', `Constricted maxillary arch${c.crossbite ? ' with crossbite' : ''}${c.constrictedMd ? '; mandibular arch also narrow' : ''}`,
    [c.constrictedMx ? 'Maxillary arch marked narrow / constricted' : null, c.crossbite ? 'Crossbite charted' : null]);

  // --- dental
  const u1Flared = dir('u1ns') > 0, u1Up = dir('u1ns') < 0, l1Flared = dir('l1gom') > 0 || dir('l1ap') > 0;
  const div2 = ap === 'II' && u1Up && c.deepBite;
  if (div2) add('Dental', 'Class II division 2 pattern — upright upper incisors with deep bite', [why('u1ns', 'Upper incisor to NS'), 'Deep bite']);
  if (u1Flared || l1Flared) add('Dental', `${u1Flared && l1Flared ? 'Both arches' : u1Flared ? 'Upper incisors' : 'Lower incisors'} flared${ap === 'II' && l1Flared ? ' — lower incisors already compensating for Class II' : ''}${ap === 'III' && u1Flared ? ' — upper incisors compensating for Class III' : ''}`,
    [why('u1ns', 'Upper incisor to NS'), why('l1gom', 'Lower incisor to GoM'), why('l1ap', 'Lower incisor to A-Pog')]);
  if (c.crowdMx === 'Severe' || c.crowdMd === 'Severe') add('Dental', `Severe crowding${c.crowdMx === 'Severe' && c.crowdMd === 'Severe' ? ' in both arches' : c.crowdMx === 'Severe' ? ' — maxillary' : ' — mandibular'}`, ['Model analysis']);
  else if (c.crowdMx === 'Slight' || c.crowdMd === 'Slight') add('Dental', 'Mild crowding', ['Model analysis']);
  if (c.spacing) add('Dental', 'Spacing', ['Model analysis']);
  if (c.oj != null && c.oj > 4) add('Dental', `Increased overjet ${c.oj} mm`, ['Clinical findings']);
  if (c.oj != null && c.oj < 0) add('Dental', `Anterior crossbite / negative overjet ${c.oj} mm`, ['Clinical findings']);
  if (c.deepBite && !div2) add('Dental', `Deep bite${c.ob != null ? ` ${c.ob} mm` : ''}`, ['Clinical findings']);
  if (c.openBite) add('Dental', `Open bite${c.ob != null ? ` ${c.ob} mm` : ''}`, ['Clinical findings']);

  // --- functional
  const airway = c.mouthBreath || c.tonsils || c.adenoids || c.snore || c.apnea || d.aw_ent_need === 'Yes';
  if (airway) add('Airway', 'Airway concern', [c.mouthBreath ? 'Mouth breathing' : null, c.tonsils ? 'Tonsils enlarged' : null, c.adenoids ? 'Adenoids enlarged' : null,
    c.snore ? 'Snores' : null, c.apnea ? 'Sleep apnea diagnosed' : null, d.aw_ent_need === 'Yes' ? 'ENT referral marked needed' : null]);
  const tmjLimited = c.maxOpen != null && c.maxOpen < 40;
  const tmj = c.jointSigns || tmjLimited || c.locked;
  if (tmj) add('TMJ', `TMJ signs${c.jointPain ? ' with joint pain' : ''}${tmjLimited ? `, limited opening ${c.maxOpen} mm` : ''}`,
    [c.jointSigns ? 'Joint sounds / pain on palpation' : null, tmjLimited ? `Maximum opening ${c.maxOpen} mm (under 40)` : null, c.locked ? 'History of locking' : null]);
  if (c.thumb || c.tongue) add('Habits', [c.thumb ? 'Thumb / finger habit' : null, c.tongue ? 'Tongue thrust / abnormal swallow' : null].filter(Boolean).join(' and '), ['History / clinical findings']);

  const ready = cl.ready;
  if (!ready) return { ready, checklist: cl, problems, plan: null, patient: p, summary: summaryFields({ ap, vert, mxBack, mxFwd, mdBack, mdFwd, c }) };

  // ---------------- plan
  const growing = p.growing !== false;
  const phases = [];
  const ph = (name, why) => { const x = { name, why, steps: [] }; phases.push(x); return x; };
  const step = (phase, text, reasons, appliance) => phase.steps.push({ text, because: reasons.filter(Boolean), appliance: appliance || null });
  const referrals = [], cautions = [], retention = [];

  // Phase 0 — before orthopedics
  if (tmj && (c.jointPain || tmjLimited || c.locked)) {
    const p0 = ph('Stabilize the TMJ first', 'Joint pain or limited opening should settle before orthopedic advancement.');
    step(p0, 'Complete a TMJ consult; stabilization splint therapy until pain-free and opening is stable', ['TMJ signs with pain or limited opening'], 'Splint');
    p0.months = '3–6';
    cautions.push('Re-measure range of motion and confirm the joints are comfortable before starting orthodontics.');
  }
  if (airway) {
    referrals.push({ to: 'ENT', why: [c.tonsils ? 'enlarged tonsils' : null, c.adenoids ? 'enlarged adenoids' : null, c.mouthBreath ? 'mouth breathing' : null].filter(Boolean).join(', ') || 'airway concern' });
    if (c.snore || c.apnea) referrals.push({ to: 'Sleep medicine / sleep study', why: c.apnea ? 'diagnosed sleep apnea' : 'snoring reported' });
  }

  // Phase I — orthopedic (growing) or camouflage prep (adult)
  if (growing) {
    const p1 = ph('Phase I — orthopedic', 'Use growth to correct the skeletal problems.');
    if (c.constrictedMx || c.crossbite || (ap === 'III' && mxBack)) {
      step(p1, 'Maxillary expansion', [c.constrictedMx ? 'Constricted maxillary arch' : null, c.crossbite ? 'Crossbite' : null, ap === 'III' && mxBack ? 'Expansion also helps maxillary protraction' : null, airway ? 'Airway concern — expansion favored' : null],
        c.thumb || (c.tongue && c.openBite) ? 'MX Hyrax with Crib' : 'MX Banded Hyrax (or Schwarz MX, removable)');
    }
    if (c.constrictedMd) step(p1, 'Mandibular arch development', ['Mandibular arch narrow'], 'Schwarz MD (or MD TransVerse TransForce)');
    if ((c.thumb || c.tongue) && !(c.constrictedMx || c.crossbite)) step(p1, 'Habit control', [c.thumb ? 'Thumb / finger habit' : null, c.tongue ? 'Tongue thrust' : null], 'MX Hyrax with Crib');
    if (c.tongue) step(p1, 'Myofunctional therapy for tongue posture and swallow', ['Tongue thrust / abnormal swallow']);
    if (ap === 'II') {
      if (div2) step(p1, 'Procline the upper incisors to unlock the mandible before advancing it', ['Class II div 2 pattern'], 'MX Anterior Sagittal');
      if (mdBack) {
        if (vert === 'high') {
          step(p1, 'Mandibular advancement with vertical control', ['Mandibular retrusion', 'High angle — avoid extruding molars'], 'Twin Block (posterior bite blocks kept) or MARA');
          cautions.push('High angle Class II: control the vertical; avoid appliances that extrude molars.');
        } else {
          step(p1, 'Mandibular advancement', ['Mandibular retrusion', vert === 'low' ? 'Low angle — bite opening helps' : null], vert === 'low' || c.deepBite ? 'Twin Block II with incisal ramp' : 'Twin Block (or MARA if compliance is a concern)');
        }
      }
      if (mxFwd && !mdBack) step(p1, 'Hold or distalize the maxillary molars', ['Maxilla protrusive'], 'Posterior Molar Distalizer or MX Posterior Sagittal');
      if (l1Flared) cautions.push('Lower incisors already flared: watch for further proclination during advancement.');
    }
    if (ap === 'III') {
      if (mxBack) step(p1, 'Maxillary protraction', ['Maxillary retrusion', 'Best results before about age 10'], 'Reverse Headgear (facemask) with expansion, or Tandem (Advance MX)');
      if (mdFwd) {
        referrals.push({ to: 'Orthodontist / oral surgeon consult', why: 'mandibular prognathism — growth may worsen it' });
        cautions.push('Mandibular prognathism: monitor growth; final correction may need surgery.');
      }
    }
    if (vert === 'low' && c.deepBite && ap !== 'II') step(p1, 'Open the bite', ['Low angle with deep bite'], 'MX Rick-A-Nator with incisal ramp');
    if (vert === 'high' && c.openBite && !(c.thumb || c.tongue)) step(p1, 'Vertical control of the open bite', ['High angle with open bite'], 'Rick-A-Nator (MX) / posterior bite blocks');
    if (!p1.steps.length) phases.pop();
    else p1.months = ap !== 'I' ? '12–18' : '9–12';
  } else {
    if (c.constrictedMx || c.crossbite) {
      const p1 = ph('Phase I — expansion', 'Adult: dental expansion only; skeletal width needs bone-anchored expansion.');
      step(p1, 'Dental arch expansion', [c.constrictedMx ? 'Constricted maxillary arch' : null, c.crossbite ? 'Crossbite' : null], 'MX TransVerse TransForce');
      if (c.crossbite) referrals.push({ to: 'Orthodontist / oral surgeon consult', why: 'adult skeletal crossbite may need miniscrew-assisted or surgical expansion' });
      p1.months = '6–9';
    }
    if ((ap === 'II' && severeII) || (ap === 'III' && severeIII)) {
      referrals.push({ to: 'Oral surgeon consult', why: `severe skeletal Class ${ap} in a non-growing patient` });
      cautions.push(`Severe skeletal Class ${ap} in an adult: discuss surgical correction versus camouflage.`);
    }
  }

  // Phase II — fixed / straight wire
  const p2 = ph(phases.some((x) => x.name.startsWith('Phase I')) ? 'Phase II — fixed appliances' : 'Comprehensive fixed treatment', 'Align, level and detail the bite.');
  step(p2, 'Level and align', ['Standard sequence'], '.014 Cu NiTi → .018 Cu NiTi');
  if (c.deepBite || vert === 'low') step(p2, 'Level the curve of Spee', ['Deep bite'], '.016 × .016 Utility Arch');
  step(p2, 'Working / finishing wires', ['Standard sequence'], '.019 × .025 CNA → .019 × .025 Multi Braided for detailing');
  if (ap === 'II') step(p2, 'Finish the Class II correction', [growing ? 'Residual Class II after Phase I' : 'Class II camouflage'], 'Class II elastics');
  if (ap === 'III') step(p2, 'Finish the Class III correction', [growing ? 'Residual Class III after Phase I' : 'Class III camouflage'], 'Class III elastics');
  if (c.openBite) step(p2, 'Close the open bite', ['Open bite'], 'Vertical elastics');
  if (c.crossbite && !growing) step(p2, 'Correct remaining crossbite', ['Crossbite'], 'Cross elastics');
  const extract = !growing && (c.crowdMx === 'Severe' || c.crowdMd === 'Severe') && (u1Flared || l1Flared || c.lipsFull || c.lipsIncompetent);
  if (extract) {
    step(p2, 'Consider premolar extractions', ['Severe crowding', 'Incisors already flared / full or incompetent lips', 'No growth to gain space'], null);
    cautions.push('Extraction decision: confirm with profile, lips and periodontal support.');
  } else if (c.crowdMx === 'Severe' || c.crowdMd === 'Severe') {
    step(p2, 'Gain space by arch development (non-extraction)', ['Severe crowding', growing ? 'Growing — arch development preferred' : null], growing ? 'Sagittal / expansion in Phase I' : null);
  }
  p2.months = growing ? '12–18' : '18–24';

  // Retention
  retention.push({ text: c.spacing || c.crowdMd === 'Severe' || l1Flared ? 'Fixed bonded lingual retainer, MX and MD' : 'Fixed bonded lingual retainer MD; clear / QCM retainer MX', because: [c.spacing ? 'Spacing closed' : null, c.crowdMd === 'Severe' ? 'Severe lower crowding' : null, l1Flared ? 'Flared lower incisors' : null].filter(Boolean) });
  if (c.constrictedMx || c.crossbite) retention.push({ text: 'Night-time removable retainer to hold the expansion', because: ['Arch expanded'] });
  if (c.tongue) retention.push({ text: 'Continue myofunctional exercises during retention', because: ['Tongue thrust — relapse risk'] });

  if (vert === 'high' && !cautions.some((x) => /High angle/.test(x))) cautions.push('High angle: favor vertical control; avoid mechanics that extrude the molars.');
  if (tmj && !(c.jointPain || tmjLimited || c.locked)) cautions.push('Joint sounds without pain: record them at every visit and re-check at the final exam.');

  // Totals
  const months = phases.reduce((a, x) => { const m = String(x.months || '').split('–').map(Number); return m.length === 2 ? [a[0] + m[0], a[1] + m[1]] : a; }, [0, 0]);

  return {
    ready, checklist: cl, problems, patient: p,
    plan: { phases, referrals, cautions, retention, months: months[1] ? `${months[0]}–${months[1]}` : '', retentionMonths: '12+', extraction: extract },
    summary: summaryFields({ ap, vert, mxBack, mxFwd, mdBack, mdFwd, c }),
  };
}

function summaryFields({ ap, vert, mxBack, mxFwd, mdBack, mdFwd, c }) {
  return {
    sp_maxilla: mxBack ? 'Class II — Retrognathic' : mxFwd ? 'Class III — Prognathic' : 'Class I — Normal',
    sp_mandible: mdBack ? 'Class II — Retrognathic' : mdFwd ? 'Class III — Prognathic' : 'Class I — Normal',
    sp_mxarch: c.constrictedMx || c.crossbite ? 'Constricted' : 'Normal',
    sp_vertical: vert === 'high' ? 'Open' : vert === 'low' ? 'Closed' : 'Average',
    dp_molar: c.molar === 3 ? 'CL III' : c.molar >= 2 ? 'CL II' : c.molar ? 'CL I' : '',
    ap,
  };
}

// What "Use this plan" writes onto the Summary & Treatment Plan page.
export function planToForm(a) {
  if (!a || !a.plan) return {};
  const byArea = (re) => a.problems.filter((p) => re.test(p.area)).map((p) => p.text);
  const phaseLines = a.plan.phases.map((x) => `${x.name}${x.months ? ` (${x.months} mo)` : ''}: ${x.steps.map((s) => (s.appliance ? `${s.text} — ${s.appliance}` : s.text)).join('; ')}`);
  phaseLines.push(`Retention (${a.plan.retentionMonths} mo): ${a.plan.retention.map((r) => r.text).join('; ')}`);
  const out = {
    tp_functional: [...byArea(/Airway|TMJ|Habits/), ...a.plan.referrals.map((r) => `Refer: ${r.to} (${r.why})`)].join('\n'),
    tp_skeletal: byArea(/Skeletal|Transverse/).join('\n'),
    tp_dental: byArea(/Dental/).join('\n'),
    tp_extraction: a.plan.extraction ? 'Extractions' : 'Non-extraction',
    tp_retention_months: a.plan.retentionMonths,
    tp_active_months: a.plan.months,
    sp_maxilla: a.summary.sp_maxilla, sp_mandible: a.summary.sp_mandible, sp_mxarch: a.summary.sp_mxarch, sp_vertical: a.summary.sp_vertical,
  };
  if (a.summary.dp_molar) out.dp_molar = a.summary.dp_molar;
  for (let i = 1; i <= 5; i++) out[`tp_phase${i}`] = phaseLines[i - 1] || '';
  if (phaseLines.length > 5) out.tp_phase5 = phaseLines.slice(4).join(' | ');
  return out;
}
