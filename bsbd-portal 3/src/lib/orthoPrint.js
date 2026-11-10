// Branded print of the Ortho Diagnostic Record / TMJ Consultation, filled with chart data.
// Mirrors the approved paper layout: letter size, logo header, gold rule, patient strip, office footer.
import {
  CEPH_SKELETAL, CEPH_DENTAL, CEPH_COLS, MUSCLES_EXTRA, MUSCLES_INTRA, PALP_STAGES, muscleKey, EXAM_STAGES, stageKey, CEPH_STAGES, cephDateKey,
} from './orthoSchema';
import { autoInterp, analyze } from './orthoAnalysis';

const NAVY = '#1B2A6B', GOLD = '#C9A84C', TEAL = '#2A7A8C';
const OFFICES = 'Dalton, GA &nbsp;706-226-9798 &nbsp;·&nbsp; Calhoun, GA &nbsp;706-625-8888 &nbsp;·&nbsp; '
  + 'Brainerd, Chattanooga &nbsp;423-622-4869 &nbsp;·&nbsp; McCallie, Chattanooga &nbsp;423-521-3550';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------- value helpers ----------------
function makeCtx(data) {
  const v = (k) => (data[k] == null ? '' : data[k]);
  const on = (k, opt) => { const x = data[k]; return Array.isArray(x) ? x.includes(opt) : x === opt; };
  return { v, on, data };
}

const box = (checked) => `<i class="cb${checked ? ' on' : ''}"></i>`;
const opt = (label, checked) => `<span class="opt">${box(checked)}${label}</span>`;
const blank = (val, w, unit) => {
  const style = w === 'flex' ? 'flex:1;min-width:60px' : `min-width:${w || 60}px`;
  return `<span class="blank" style="${style}">${esc(val)}</span>${unit ? `<span class="u">${unit}</span>` : ''}`;
};

function parts(ps, c) {
  return (ps || []).map((p) => {
    if (typeof p === 'string') return `<span class="tx">${p}</span>`;
    if (p.b) return `<span class="tx"><b>${p.b}</b></span>`;
    if (p.o) return `<span class="os">${p.o.map((o) => opt(o, c.on(p.k, o))).join('')}</span>`;
    return blank(c.v(p.k), p.w, p.u);
  }).join('');
}

// ---------------- item renderers ----------------
function item(it, c) {
  switch (it.t) {
    case 'row':
      return `<div class="row">${it.fields.map((f) => {
        const inner = f.o ? `<span class="os">${f.o.map((o) => opt(o, c.on(f.k, o))).join('')}</span>` : esc(c.v(f.k));
        return `<div class="fld" style="flex:${f.f || 1}"><div class="ln">${inner}</div><div class="lb">${f.l}</div></div>`;
      }).join('')}</div>`;
    case 'opts': {
      const os = it.o.map((o) => opt(o, c.on(it.k, o))).join('');
      if (it.stack) return `<div class="stack">${it.o.map((o) => `<div>${opt(o, c.on(it.k, o))}</div>`).join('')}</div>`;
      if (it.grid) return `${it.l ? `<div class="lbl" style="margin:3px 0">${it.l}</div>` : ''}<div class="ogrid" style="grid-template-columns:repeat(${it.grid},1fr)">${it.o.map((o) => opt(o, c.on(it.k, o))).join('')}</div>`;
      return `<div class="orow${it.app ? ' ap' : ''}"><span class="lbl">${it.l || ''}</span><span class="ov">${os}${parts(it.after, c)}</span></div>`;
    }
    case 'inline':
      return `<div class="irow">${it.l ? `<span class="lbl il">${it.l}</span>` : ''}${parts(it.parts, c)}</div>`;
    case 'q':
      return `<div class="qrow"><span class="q">${it.l}</span><span class="os">${it.o.map((o) => opt(o, c.on(it.k, o))).join('')}</span>${it.after ? `<span class="qa">${parts(it.after, c)}</span>` : ''}</div>`;
    case 'yn':
      return it.items.map(([k, l]) => `<div class="ynrow"><span>${l}</span><span class="yn">${box(c.v(k) === 'Y')}Y ${box(c.v(k) === 'N')}N</span></div>`).join('');
    case 'cols':
      return `<div class="cols" style="grid-template-columns:${it.tmpl || '1fr 1fr'}">${it.cols.map((col) => `<div>${col.map((x) => item(x, c)).join('')}</div>`).join('')}</div>`;
    case 'quads':
      return `<div class="quads">${it.items.map(([k, l]) => {
        const q = c.data[k] || {};
        return `<div class="qd"><span>${l}</span>${quadSvg(q)}</div>`;
      }).join('')}</div>`;
    case 'datelist':
      return `<div class="cols" style="grid-template-columns:repeat(${it.cols.length},1fr)">${it.cols.map((col) => `<table class="dl">${col.map(([k, l]) => `<tr><td>${opt(l, !!c.data[k])}</td><td class="d">${esc(c.v(k + '_date'))}</td></tr>`).join('')}</table>`).join('')}</div>`;
    case 'lines': {
      const n = it.n || 2;
      return `${it.l ? `<div class="ll">${it.l}</div>` : ''}<div class="wl" style="height:${n * 20}px">${esc(c.v(it.k)).replace(/\n/g, '<br>')}</div>`;
    }
    case 'scale': {
      const s = Array.from({ length: 11 }, (_, i) => `<span class="sc">${box(String(c.v(it.k)) === String(i))}<span>${i}</span></span>`).join('');
      return `<div class="qrow"><span class="q"><b>${it.l}</b> <span class="muted">${it.sub || ''}</span></span><span>${s}</span></div>`;
    }
    case 'sub': return `<div class="sub">${it.text}</div>`;
    case 'note': return `<p class="note">${it.text}</p>`;
    case 'sig': return `<div class="sig">${it.fields.map((f, i) => `<div class="fld" style="flex:${i === it.fields.length - 1 && f === 'Date' ? 1 : 3}"><div class="ln">${f === 'Date' ? esc(c.v('sig_date')) : ''}</div><div class="lb">${f}</div></div>`).join('')}</div>`;
    case 'ceph': return cephTable(c);
    case 'cephfiles': {
      const f = c.data.ceph_files || [];
      if (!f.length) return '';
      const lab = (st) => (CEPH_STAGES.find(([k]) => k === st) || [, st])[1];
      return `<div class="irow" style="margin-bottom:4px"><span class="lbl" style="margin-right:6px">Ceph reports on file:</span><span>${f.map((x) => `${lab(x.stage)}${x.tracing_date ? ` (${esc(x.tracing_date)})` : ''}`).join(' · ')}</span></div>`;
    }
    case 'harvRef': return harvRef();
    case 'palp': return palpTables(c);
    case 'rom': return romGraphs(c);
    case 'stagetable': return stageTable(it, c);
    case 'analysis': return analysisBlock(c);
    case 'teeth': return toothChart(it.set, c.data[it.k] || []);
    default: return '';
  }
}

function section(s, c) {
  let head = '';
  if (s.title) {
    let right = s.sub ? `<span class="secsub">${s.sub}</span>` : '';
    if (s.subOpts) right = `<span class="secsub">${s.subOpts.l} &nbsp;${s.subOpts.o.map((o) => opt(o, c.on(s.subOpts.k, o))).join('')}</span>`;
    head = `<div class="sec"><span class="st">${s.title}</span>${right}</div>`;
  }
  return head + s.items.map((x) => item(x, c)).join('');
}

// ---------------- special blocks ----------------
function quadSvg(q) {
  const t = (x, y, s, a) => (s ? `<text x="${x}" y="${y}" text-anchor="${a}">${esc(s)}</text>` : '');
  return `<svg class="quad" viewBox="0 0 110 24"><line x1="2" y1="12" x2="108" y2="12"/><line x1="55" y1="1" x2="55" y2="23"/>
    ${t(51, 10, q.ur, 'end')}${t(59, 10, q.ul, 'start')}${t(51, 22, q.lr, 'end')}${t(59, 22, q.ll, 'start')}</svg>`;
}

function cephTable(c) {
  const head = (title) => `<tr><th style="text-align:left">${title}</th><th>Unit</th><th>Norm</th>${CEPH_COLS.map(([k, l]) => `<th class="${k === 'interp' ? '' : 'tl'}">${l}</th>`).join('')}</tr>`;
  const rows = (list) => list.map(([k, l, u, n, interp]) => `<tr><td class="lbl">${l}</td><td class="n muted">${u}</td><td class="n">${n}</td>${CEPH_COLS.map(([ck]) => {
    const val = c.v(`ceph_${k}_${ck}`);
    if (ck === 'interp') { const auto = val ? '' : autoInterp(k, c.data); return `<td class="i">${val ? `<b>${esc(val)}</b>` : auto ? `<b>${esc(auto)}</b>` : interp}</td>`; }
    return `<td class="n val">${esc(val)}</td>`;
  }).join('')}</tr>`).join('');
  const dates = `<tr class="dt"><td class="lbl">Tracing date</td><td></td><td></td>${CEPH_COLS.map(([ck]) => ck === 'interp' ? '<td></td>' : `<td class="n val" style="font-size:7.8pt">${esc(c.v(cephDateKey(ck)))}</td>`).join('')}</tr>`;
  return `<table class="ceph"><colgroup><col style="width:13%"><col style="width:9%"><col style="width:12%"><col style="width:11%"><col style="width:19%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>${head('Skeletal')}${dates}${rows(CEPH_SKELETAL)}${head('Dental')}${rows(CEPH_DENTAL)}</table>`;
}

function harvRef() {
  const t = (sex, rows) => `<table class="harv"><tr><th style="text-align:left;width:34%">${sex}</th>${['6 yrs', '9 yrs', '13 yrs', '14 yrs', '16 yrs', 'Ideal Adult'].map((a) => `<th>${a}</th>`).join('')}</tr>${rows.map(([l, v]) => `<tr><td>${l}</td>${v.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('')}</table>`;
  return t('Males', [['Maxillary Length (Co–Point A)', [82, 87, 92, 96, 100, 100]], ['Predicted Mandibular Length (Co–Gnathion)', [99, 107, 114, 121, 127, 130]],
    ['Maxillo-Mandibular Differential', [17, 20, 22, 25, 27, 30]], ['Predicted Lower Facial Height (ANS–Menton)', [59, 62, 64, 68, 71, 72]]])
    + t('Females', [['Maxillary Length (Co–Point A)', [80, 85, 90, 92, 93, 93]], ['Predicted Mandibular Length (Co–Gnathion)', [97, 105, 113, 117, 119, 120]],
      ['Maxillo-Mandibular Differential', [17, 20, 23, 25, 26, 27]], ['Predicted Lower Facial Height (ANS–Menton)', [57, 60, 62, 64, 65, 67]]]);
}

function palpTables(c) {
  const side = (s, name) => {
    const hdr = `<tr><th class="sidehd" colspan="4">${name} Side</th></tr><tr><th style="text-align:left">Muscle</th>${PALP_STAGES.map(([, l]) => `<th>${l}</th>`).join('')}</tr>`
      + `<tr class="dt"><td>Date</td>${PALP_STAGES.map(([st]) => `<td class="val sm">${esc(c.v(`palp_date_${s}_${st}`))}</td>`).join('')}</tr>`;
    const r = (m) => `<tr><td>${m}</td>${PALP_STAGES.map(([st]) => `<td class="val">${esc(c.v(`palp_${s}_${muscleKey(m)}_${st}`))}</td>`).join('')}</tr>`;
    return `<table class="mp"><colgroup><col style="width:43%"><col style="width:19%"><col style="width:19%"><col style="width:19%"></colgroup>${hdr}`
      + `<tr class="grp"><td colspan="4">Extra-Oral</td></tr>${MUSCLES_EXTRA.map(r).join('')}<tr class="grp"><td colspan="4">Intra-Oral</td></tr>${MUSCLES_INTRA.map(r).join('')}</table>`;
  };
  return `<div class="cols" style="grid-template-columns:1fr 1fr;gap:18px;margin-top:4px">${side('r', 'Right')}${side('l', 'Left')}</div>`;
}

function romGraph() {
  const cx = 70, cy = 18, s = [];
  s.push(`<line x1="${cx - 56}" y1="${cy}" x2="${cx + 56}" y2="${cy}" class="ax"/><line x1="${cx}" y1="${cy - 10}" x2="${cx}" y2="${cy + 134}" class="ax"/>`);
  s.push(`<text x="${cx - 64}" y="${cy + 3.5}" class="lab">R</text><text x="${cx + 60}" y="${cy + 3.5}" class="lab">L</text>`);
  [10, 20].forEach((k) => [-1, 1].forEach((g) => { const x = cx + g * k * 2; s.push(`<line x1="${x}" y1="${cy - 4}" x2="${x}" y2="${cy + 4}" class="ax"/><text x="${x}" y="${cy - 6}" class="t">${k}</text>`); }));
  for (let k = 10; k <= 60; k += 10) { const y = cy + k * 2.1; s.push(`<line x1="${cx - 4}" y1="${y}" x2="${cx + 4}" y2="${y}" class="ax"/><text x="${cx + 7}" y="${y + 2.5}" class="t" text-anchor="start">${k}</text>`); }
  return `<svg viewBox="0 0 140 156" width="150" height="167"><style>.ax{stroke:#3a4058;stroke-width:1}.t{font:6.5px Arial;fill:#555;text-anchor:middle}.lab{font:bold 9px Arial;fill:${NAVY}}</style>${s.join('')}</svg>`;
}
function analysisBlock(c) {
  const a = analyze(c.data);
  const cl = a.checklist;
  let h = `<div class="an-head"><b>Critical items: ${cl.done} of ${cl.total}</b>${cl.ready ? ' · complete' : ` · missing: ${cl.missing.map((m) => esc(m.label)).join(', ')}`}</div>`;
  h += `<div class="sec"><span class="st">Findings</span><span class="secsub">From the ceph values and exam on this record</span></div>`;
  h += a.problems.length ? `<table class="an">${a.problems.map((p) => `<tr><td class="ar">${esc(p.area)}</td><td><b>${esc(p.text)}</b>${p.because.length ? `<div class="w">${p.because.slice(0, 3).map(esc).join(' · ')}</div>` : ''}</td></tr>`).join('')}</table>` : '<p class="note">No findings yet.</p>';
  h += `<div class="sec"><span class="st">Suggested Treatment Plan</span><span class="secsub">Rule-based suggestion for the treating dentist to confirm</span></div>`;
  if (!a.plan) return h + '<p class="note">Appears once every critical item is entered.</p>';
  h += a.plan.phases.map((ph) => `<div class="ph"><div class="phh"><b>${esc(ph.name)}</b>${ph.months ? `<span>≈ ${ph.months} months</span>` : ''}</div>${ph.steps.map((s) => `<div class="st2">${esc(s.text)}${s.appliance ? ` <span class="ap">${esc(s.appliance)}</span>` : ''}</div>`).join('')}</div>`).join('');
  h += `<div class="ph"><div class="phh"><b>Retention</b><span>${a.plan.retentionMonths} months</span></div>${a.plan.retention.map((r) => `<div class="st2">${esc(r.text)}</div>`).join('')}</div>`;
  if (a.plan.referrals.length) h += `<div class="irow"><span class="lbl" style="margin-right:6px">Referrals:</span>${a.plan.referrals.map((r) => `${esc(r.to)} (${esc(r.why)})`).join(' · ')}</div>`;
  if (a.plan.cautions.length) h += `<div class="caut">${a.plan.cautions.map((x) => `⚠ ${esc(x)}`).join('<br>')}</div>`;
  h += `<div class="irow"><span class="lbl">Estimated active treatment: ${esc(a.plan.months)} months</span></div>`;
  return h;
}

function stageTable(it, c) {
  const head = `<tr><th style="text-align:left">Measurement</th>${EXAM_STAGES.map(([, l]) => `<th>${l}</th>`).join('')}</tr>`;
  const date = it.noDate ? '' : `<tr class="dt"><td>Date</td>${EXAM_STAGES.map(([st]) => `<td class="val">${esc(c.v(`${it.dateKey}_${st}`))}</td>`).join('')}</tr>`;
  const cell = (r, st) => {
    const raw = c.data[stageKey(r.k, st)];
    const val = Array.isArray(raw) ? raw.join(', ') : (raw ?? '');
    if (val !== '') return `<td class="val">${esc(val)}${r.u && !r.o ? ` <span class="u2">${r.u}</span>` : ''}</td>`;
    if (r.o) return `<td class="hint">${r.o.join(' · ')}</td>`;
    return `<td class="val"><span class="u2 r">${r.u || ''}</span></td>`;
  };
  const rows = it.rows.map((r) => `<tr${r.strong ? ' class="strong"' : ''}><td>${r.l}${r.hint ? ` <span class="muted">(${r.hint})</span>` : ''}</td>${EXAM_STAGES.map(([st]) => cell(r, st)).join('')}</tr>`).join('');
  return `<table class="stg"><colgroup><col style="width:37%"><col style="width:21%"><col style="width:21%"><col style="width:21%"></colgroup>${head}${date}${rows}</table>`;
}

function romGraphs(c) {
  return `<div class="cols" style="grid-template-columns:1fr 1fr 1fr;margin-top:4px">${[['i', 'Initial'], ['p', 'Progress'], ['f', 'Final']].map(([k, l]) => `<div style="text-align:center">${romGraph()}<div class="lbl" style="color:${NAVY}">${l}</div></div>`).join('')}</div>`;
}

// ---------------- tooth chart ----------------
const PERM_U = Array.from({ length: 16 }, (_, i) => i + 1);
const PERM_L = Array.from({ length: 16 }, (_, i) => 32 - i);
const PRIM_U = 'ABCDEFGHIJ'.split('');
const PRIM_L = 'TSRQPONMLK'.split('');
function permType(n) { const p = ((n - 1) % 16) + 1; const q = p <= 8 ? p : 17 - p; return { 1: 'M', 2: 'M', 3: 'M', 4: 'P', 5: 'P', 6: 'C', 7: 'IL', 8: 'IC' }[q]; }
function primType(t) { const i = PRIM_U.includes(t) ? PRIM_U.indexOf(t) : PRIM_L.indexOf(t); return ['M', 'M', 'C', 'IL', 'IC', 'IC', 'IL', 'C', 'M', 'M'][i]; }

function side(t, x, y, w, upper, lowerJaw, cls) {
  const d = upper ? -1 : 1;
  let cw = { M: w * 0.86, P: w * 0.66, C: w * 0.66, IL: w * 0.56, IC: w * 0.7 }[t];
  if (lowerJaw && (t === 'IL' || t === 'IC')) cw = w * 0.5;
  const cx = x + w / 2, l = cx - cw / 2, r = cx + cw / 2, ch = t === 'C' ? 17 : 15;
  const rl = { M: 20, P: 22, C: 30, IL: 22, IC: 24 }[t], cej = y + d * ch;
  let crown, roots;
  if (t === 'M') {
    crown = `M ${l} ${y + d * 3} Q ${l + cw * 0.25} ${y - d * 2} ${cx} ${y + d * 2} Q ${l + cw * 0.75} ${y - d * 2} ${r} ${y + d * 3} L ${r - 1} ${cej} L ${l + 1} ${cej} Z`;
    roots = `M ${l + 2} ${cej} Q ${l + 2} ${cej + d * rl * 0.7} ${l + cw * 0.25} ${cej + d * rl} Q ${cx - 2} ${cej + d * rl * 0.5} ${cx} ${cej + d * 4} Q ${cx + 2} ${cej + d * rl * 0.5} ${r - cw * 0.25} ${cej + d * rl} Q ${r - 2} ${cej + d * rl * 0.7} ${r - 2} ${cej}`;
  } else {
    if (t === 'C') crown = `M ${l} ${y + d * 6} L ${cx} ${y} L ${r} ${y + d * 6} L ${r - 1.5} ${cej} L ${l + 1.5} ${cej} Z`;
    else if (t === 'P') crown = `M ${l} ${y + d * 5} Q ${cx} ${y - d * 3} ${r} ${y + d * 5} L ${r - 1.5} ${cej} L ${l + 1.5} ${cej} Z`;
    else crown = `M ${l} ${y + d} L ${r} ${y + d} L ${r - 1} ${cej} L ${l + 1} ${cej} Z`;
    roots = `M ${l + 1.5} ${cej} Q ${l + 2} ${cej + d * rl * 0.8} ${cx} ${cej + d * rl} Q ${r - 2} ${cej + d * rl * 0.8} ${r - 1.5} ${cej}`;
  }
  return `<path d="${crown}" class="cr${cls}"/><path d="${roots}" class="rt"/>`;
}
function occ(t, x, y, w, lowerJaw, cls) {
  const cx = x + w / 2, cy = y;
  if (t === 'M') { const s = w * 0.78; return `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" rx="5" class="cr${cls}"/><path d="M ${cx - s / 2 + 3} ${cy} L ${cx + s / 2 - 3} ${cy} M ${cx} ${cy - s / 2 + 3} L ${cx} ${cy + s / 2 - 3}" class="fs"/>`; }
  if (t === 'P') return `<ellipse cx="${cx}" cy="${cy}" rx="${w * 0.33}" ry="${w * 0.38}" class="cr${cls}"/><path d="M ${cx - w * 0.2} ${cy} L ${cx + w * 0.2} ${cy}" class="fs"/>`;
  if (t === 'C') return `<path d="M ${cx} ${cy - w * 0.36} L ${cx + w * 0.3} ${cy} L ${cx} ${cy + w * 0.34} L ${cx - w * 0.3} ${cy} Z" class="cr${cls}"/>`;
  const rx = w * (lowerJaw ? 0.24 : 0.32);
  return `<rect x="${cx - rx}" y="${cy - w * 0.18}" width="${2 * rx}" height="${w * 0.36}" rx="3" class="cr${cls}"/>`;
}

export function toothChart(set, marked = []) {
  const prim = set === 'prim';
  const up = prim ? PRIM_U : PERM_U, lo = prim ? PRIM_L : PERM_L, typ = prim ? primType : permType;
  const w = 26, n = up.length, W = n * w + 2, out = [];
  const mk = (t) => (marked.map(String).includes(String(t)) ? ' mk' : '');
  const boxes = (nums, yy) => nums.map((t, i) => { const x = 1 + i * w; return `<rect x="${x}" y="${yy}" width="${w}" height="13" class="bx${mk(t)}"/><text x="${x + w / 2}" y="${yy + 9.6}" class="tn">${t}</text>`; }).join('');
  let y = 2; out.push(boxes(up, y)); y += 14;
  const yb = y + 52; up.forEach((t, i) => out.push(side(typ(t), 1 + i * w, yb, w, true, false, mk(t))));
  const yo = yb + 15; up.forEach((t, i) => out.push(occ(typ(t), 1 + i * w, yo, w, false, mk(t))));
  const yl = yo + 50; up.forEach((t, i) => out.push(side(typ(t), 1 + i * w, yl + 15, w, true, false, mk(t))));
  const ym = yl + 30;
  lo.forEach((t, i) => out.push(side(typ(t), 1 + i * w, ym, w, false, true, mk(t))));
  const yO = ym + 63; lo.forEach((t, i) => out.push(occ(typ(t), 1 + i * w, yO, w, true, mk(t))));
  const yB = yO + 15; lo.forEach((t, i) => out.push(side(typ(t), 1 + i * w, yB, w, false, true, mk(t))));
  const yN = yB + 53; out.push(boxes(lo, yN));
  const H = yN + 16, mid = 1 + (n / 2) * w;
  out.push(`<line x1="${mid}" y1="16" x2="${mid}" y2="${yN - 2}" class="ml"/><line x1="1" y1="${ym - 7}" x2="${W - 1}" y2="${ym - 7}" class="ml" stroke-dasharray="3 3"/>`);
  const style = `<style>.cr{fill:#fff;stroke:#3a4058;stroke-width:.9}.cr.mk{fill:#F2DFA8;stroke:${NAVY};stroke-width:1.2}.rt{fill:none;stroke:#3a4058;stroke-width:.9}.fs{stroke:#7a8096;stroke-width:.7;fill:none}.bx{fill:#fff;stroke:#7a8096;stroke-width:.7}.bx.mk{fill:${GOLD}}.tn{font:bold 7px Arial;fill:${NAVY};text-anchor:middle}.ml{stroke:${GOLD};stroke-width:1}</style>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${style}${out.join('')}</svg>`;
}

// ---------------- page shell + CSS ----------------
const CSS = `
@page { size: Letter; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin:0; font-family: Arial, 'Liberation Sans', Helvetica, sans-serif; color:#1d2230; font-size:9.6pt; background:#e9ebf0; }
.page { width:8.5in; height:11in; padding:0.42in 0.5in 0.36in; background:#fff; margin:0 auto; display:flex; flex-direction:column; overflow:hidden; page-break-after:always; }
.page:last-child { page-break-after:auto; }
@media screen { .page { margin:16px auto; box-shadow:0 2px 10px rgba(0,0,0,.15); } }
@media print { body { background:#fff; } .page { margin:0; box-shadow:none; } .noprint, .bar { display:none !important; } }
header { display:flex; align-items:center; justify-content:space-between; }
.logo-img { height:54px; display:block; }
.htitle { text-align:right; }
.hdoc { font-size:7.5pt; letter-spacing:2px; text-transform:uppercase; color:${TEAL}; font-weight:bold; }
.hpage { font-size:15pt; font-weight:bold; color:${NAVY}; margin-top:2px; }
.goldrule { height:3px; background:${GOLD}; margin:8px 0 6px; border-radius:2px; }
.pstrip { display:flex; gap:18px; font-size:8.2pt; color:#444; margin-bottom:4px; }
.pstrip span { display:flex; align-items:flex-end; gap:5px; }
.pstrip i { display:inline-block; border-bottom:1px solid #888; min-height:13px; font-style:normal; color:${NAVY}; font-weight:bold; padding:0 3px; }
main { flex:1; display:flex; flex-direction:column; }
footer { display:flex; justify-content:space-between; border-top:1px solid #cfd3de; padding-top:5px; font-size:6.6pt; color:#6a7080; margin-top:6px; }
footer .pg { color:${NAVY}; font-weight:bold; white-space:nowrap; margin-left:10px; }
.sec { display:flex; align-items:baseline; justify-content:space-between; margin:9px 0 5px; border-bottom:1.5px solid ${NAVY}; padding-bottom:2px; }
.sec .st { font-weight:bold; color:${NAVY}; text-transform:uppercase; letter-spacing:1.1px; font-size:9.4pt; border-left:4px solid ${GOLD}; padding-left:6px; }
.secsub { font-size:7.6pt; color:#666; font-style:italic; }
.sub { font-weight:bold; color:${TEAL}; font-size:8.6pt; text-transform:uppercase; letter-spacing:.8px; margin:7px 0 3px; }
.row { display:flex; gap:14px; margin-bottom:5px; }
.roomy .row { margin-bottom:7px; } .roomy .fld .ln { height:24px; }
.fld { display:flex; flex-direction:column; }
.fld .ln { border-bottom:1px solid #6d7385; height:17px; display:flex; align-items:flex-end; padding:0 3px 1px; color:${NAVY}; font-weight:bold; font-size:9.6pt; white-space:nowrap; overflow:hidden; }
.fld .lb { font-size:6.9pt; color:#5a6072; margin-top:1.5px; text-transform:uppercase; letter-spacing:.4px; }
.opt { display:inline-flex; align-items:center; margin-right:10px; white-space:nowrap; }
.cb { display:inline-block; width:9px; height:9px; border:1px solid #4a5063; border-radius:1.5px; margin-right:3.5px; flex:none; position:relative; }
.cb.on { background:${NAVY}; border-color:${NAVY}; }
.cb.on::after { content:''; position:absolute; left:2.4px; top:0.2px; width:2.4px; height:5px; border:solid #fff; border-width:0 1.4px 1.4px 0; transform:rotate(45deg); }
.os { display:inline-flex; flex-wrap:wrap; row-gap:3px; }
.blank { display:inline-block; border-bottom:1px solid #6d7385; min-height:13px; margin:0 4px; padding:0 3px; color:${NAVY}; font-weight:bold; white-space:nowrap; line-height:13px; }
.u { margin-right:8px; }
.tx { margin-right:4px; white-space:nowrap; }
.irow { display:flex; align-items:flex-end; flex-wrap:wrap; row-gap:3px; padding:2.4px 0; }
.lbl { font-weight:bold; color:#2a3045; }
.il { width:30%; flex:none; }
.cols .il { width:auto; margin-right:6px; }
.orow.ap .lbl { width:58%; font-weight:normal; }
.orow.ap { padding:1.8px 0; }
.orow { display:flex; align-items:center; border-bottom:1px solid #e1e4ec; padding:2.6px 0; }
.orow .lbl { width:30%; flex:none; }
.orow .ov { display:flex; flex-wrap:wrap; align-items:flex-end; row-gap:3px; }
.ogrid { display:grid; row-gap:6px; margin:3px 0 6px; }
.stack div { margin-bottom:3px; }
.muted { color:#666; font-size:8pt; }
.cols { display:grid; column-gap:22px; }
.ynrow { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e6e8ef; padding:1.6px 0; font-size:9pt; }
.yn { display:inline-flex; align-items:center; white-space:nowrap; font-size:8.2pt; gap:2px; }
.yn .cb { margin-left:6px; margin-right:2px; }
.qrow { display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e6e8ef; padding:2.2px 0; gap:10px; }
.qrow .q { flex:1; }
.qa { display:flex; align-items:flex-end; min-width:150px; }
.sc { display:inline-flex; flex-direction:column; align-items:center; margin-right:8px; font-size:7.5pt; }
.sc .cb { margin:0; }
.quads { display:grid; grid-template-columns:repeat(3,1fr); column-gap:16px; }
.qd { display:flex; justify-content:space-between; align-items:center; padding:1px 0; }
.quad { width:110px; height:22px; }
.quad line { stroke:#4a5063; stroke-width:1; }
.quad text { font:bold 8px Arial; fill:${NAVY}; }
table { border-collapse:collapse; width:100%; }
.dl td { padding:2px 4px; }
.dl td.d { border-bottom:1px solid #8a90a0; width:80px; color:${NAVY}; font-weight:bold; font-size:8.6pt; }
.ll { margin-top:4px; }
.wl { background:repeating-linear-gradient(to bottom, transparent 0 19px, #b9bdca 19px 20px); line-height:20px; overflow:hidden; color:${NAVY}; font-weight:bold; padding:0 3px; }
.note { font-size:7.6pt; color:#5a6072; font-style:italic; margin:8px 0 0; }
.sig { display:flex; gap:24px; margin-top:auto; padding-top:10px; }
.ceph { table-layout:fixed; }
.ceph th { background:${NAVY}; color:#fff; font-size:7.6pt; letter-spacing:.8px; text-transform:uppercase; padding:4px; }
.ceph th.tl { background:${TEAL}; }
.ceph td { border:1px solid #c9cdd8; padding:3px 5px; font-size:8.5pt; height:24px; }
.ceph td.n { text-align:center; }
.ceph tr.dt td { background:#f4f6fa; }
.ceph td.i { font-size:7.8pt; color:#444; text-align:center; line-height:1.25; }
.val { color:${NAVY}; font-weight:bold; text-align:center; }
.harv { margin-bottom:6px; }
.harv th { background:${NAVY}; color:#fff; font-size:7.6pt; padding:3px; }
.harv td { border:1px solid #c9cdd8; text-align:center; padding:3px; font-size:8.5pt; }
.harv td:first-child { text-align:left; }
.mp { border:1px solid #c9cdd8; table-layout:fixed; }
.mp th { font-size:8.4pt; color:#fff; background:${NAVY}; padding:5px 4px; border:1px solid #c9cdd8; }
.mp th.sidehd { background:${TEAL}; font-size:10pt; letter-spacing:1.5px; text-transform:uppercase; padding:6px; }
.mp td { border:1px solid #c9cdd8; padding:0 6px; height:31px; font-size:10pt; }
.mp td.val { font-size:12pt; }
.mp td.sm { font-size:8pt; }
.mp tr:nth-child(even) td:first-child { background:#f6f7fa; }
.mp tr.dt td { background:#f4f6fa; font-weight:bold; color:${NAVY}; height:24px; }
.mp tr.grp td { background:#eef1f7 !important; font-weight:bold; color:${TEAL}; text-transform:uppercase; font-size:8pt; letter-spacing:.8px; height:18px; }
.stg { table-layout:fixed; border:1px solid #c9cdd8; margin-bottom:2px; }
.stg th { background:${NAVY}; color:#fff; font-size:8pt; padding:4px; border:1px solid #c9cdd8; letter-spacing:.5px; }
.stg th:not(:first-child) { background:${TEAL}; }
.stg td { border:1px solid #c9cdd8; padding:0 6px; height:20px; font-size:8.8pt; }
.stg tr.dt td { background:#f4f6fa; font-weight:bold; color:${NAVY}; }
.stg tr.strong td:first-child { font-weight:bold; color:${NAVY}; }
.stg td.hint { color:#a3a8b6; font-size:7.4pt; text-align:center; letter-spacing:.3px; }
.u2 { color:#8a90a0; font-weight:normal; font-size:7.6pt; }
.u2.r { float:right; }
.an-head { font-size:8.6pt; color:#444; margin:2px 0 2px; }
.an td { border-bottom:1px solid #e1e4ec; padding:2.5px 4px; font-size:8.6pt; vertical-align:top; }
.an td.ar { width:24%; color:${TEAL}; font-weight:bold; font-size:7.6pt; text-transform:uppercase; letter-spacing:.4px; }
.an .w, .w { font-size:7.4pt; color:#6a7080; }
.ph { border:1px solid #d9dce5; border-radius:4px; padding:4px 7px; margin-bottom:5px; }
.phh { display:flex; justify-content:space-between; color:${NAVY}; font-size:9pt; }
.phh span { color:${TEAL}; font-weight:bold; font-size:8pt; }
.st2 { font-size:8.6pt; padding:1.5px 0 1.5px 8px; border-left:2px solid ${GOLD}; margin:2px 0; }
.ap { font-size:7.6pt; font-weight:bold; color:${NAVY}; background:#eef1f7; padding:0 4px; border-radius:2px; }
.caut { background:#fffaf0; border:1px solid #e8d5a8; padding:4px 7px; font-size:8pt; color:#6b4a10; margin:4px 0; border-radius:4px; }
.bar { position:sticky; top:0; background:${NAVY}; color:#fff; padding:10px 16px; display:flex; justify-content:space-between; align-items:center; font-size:11pt; z-index:5; }
.bar button { background:${GOLD}; color:${NAVY}; border:0; padding:8px 18px; border-radius:6px; font-weight:bold; font-size:11pt; cursor:pointer; }
`;

export function buildPrintHtml(form, data, meta = {}) {
  const c = makeCtx(data || {});
  const logo = meta.logoUrl || `${window.location.origin}/bsbd-logo-navy.png`;
  const name = [c.v('pt_first'), c.v('pt_last')].filter(Boolean).join(' ');
  const total = form.pages.length;
  const pages = form.pages.map((p, i) => {
    const strip = p.strip === false ? '' : `<div class="pstrip"><span><b>Patient</b><i style="min-width:250px">${esc(name)}</i></span><span><b>Chart #</b><i style="min-width:90px">${esc(meta.chartNo || '')}</i></span><span><b>Date</b><i style="min-width:90px">${esc(meta.date || '')}</i></span></div>`;
    return `<section class="page"><header><img class="logo-img" src="${logo}" alt="Beautiful Smiles by Design Dentistry"><div class="htitle"><div class="hdoc">${form.title}</div><div class="hpage">${p.title}</div></div></header>
      <div class="goldrule"></div>${strip}<main class="${p.strip === false ? 'roomy' : ''}">${p.sections.map((s) => section(s, c)).join('')}</main>
      <footer><span>${OFFICES}</span><span class="pg">Page ${i + 1} of ${total}</span></footer></section>`;
  }).join('');
  const bar = meta.noBar ? '' : `<div class="bar noprint"><span>${form.title}${meta.chartNo ? ` · Chart #${esc(meta.chartNo)}` : ''}</span><button onclick="window.print()">Print / Save PDF</button></div>`;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${form.short} ${esc(meta.chartNo || '')}</title><style>${CSS}</style></head><body>${bar}${pages}</body></html>`;
}

// The logo is embedded in the printout as a data URL so it is always there when the print dialog opens
// (no second download racing the dialog, which matters on iPad Safari).
let logoDataUrl = null;
async function getLogoDataUrl() {
  if (logoDataUrl) return logoDataUrl;
  try {
    const r = await fetch('/bsbd-logo-navy.png');
    if (!r.ok) return null;
    const blob = await r.blob();
    logoDataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    return logoDataUrl;
  } catch (e) { return null; }
}

// Opens the filled form in a new tab with a Print button (works on desktop and iPad Safari).
// The tab is opened right away (inside the click) so pop-up blockers allow it, then filled.
export async function printChart(form, data, meta = {}) {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups for this site to print the chart.'); return; }
  w.document.write('<p style="font-family:Arial;padding:24px;color:#1B2A6B">Preparing the form…</p>');
  const logo = await getLogoDataUrl();
  const html = buildPrintHtml(form, data, { ...meta, logoUrl: logo || undefined });
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) { /* the Print button in the tab still works */ } }, 400);
}
