// Ortho module — Orthodontic Diagnostic Record + TMJ Consultation.
// Enter findings on screen, save under chart # only, print on the branded BSBD form.
// Patient name / DOB / contact / insurance details are entered for printing only and are never saved.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FORMS, phiKeys, CEPH_SKELETAL, CEPH_DENTAL, CEPH_COLS, MUSCLES_EXTRA, MUSCLES_INTRA, PALP_STAGES, muscleKey, EXAM_STAGES, stageKey, cephDateKey } from '../../lib/orthoSchema';
import { listCharts, getChart, saveChart, deleteChart, newId, removeChartFiles } from '../../lib/orthoApi';
import CephUpload from './CephUpload';
import { cephFeedback, autoInterp } from '../../lib/orthoAnalysis';
import AnalysisPanel, { ProgressChip } from './AnalysisPanel';
import { printChart } from '../../lib/orthoPrint';
import { OFFICES } from '../../lib/constants';

const NAVY = '#1B2A6B', GOLD = '#C9A84C', TEAL = '#2A7A8C', LINE = '#d9dce5', AMBER = '#B7791F';
const officeNames = (Array.isArray(OFFICES) ? OFFICES : Object.values(OFFICES || {}))
  .map((o) => (typeof o === 'string' ? o : o.name || o.label || o.key))
  .filter(Boolean);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString() : '');

const S = {
  wrap: { minHeight: '100vh', background: '#f4f6fa', fontFamily: 'Arial, Helvetica, sans-serif', color: '#1d2230' },
  top: { background: NAVY, color: '#fff', padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 10 },
  btn: { background: '#fff', color: NAVY, border: `1px solid ${LINE}`, borderRadius: 6, padding: '8px 14px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 },
  btnGold: { background: GOLD, color: NAVY, border: 0, borderRadius: 6, padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 },
  btnNavy: { background: NAVY, color: '#fff', border: 0, borderRadius: 6, padding: '8px 16px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 },
  card: { background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 18 },
  input: { border: `1px solid #b9bfcc`, borderRadius: 6, padding: '7px 9px', fontSize: 15, fontFamily: 'inherit', background: '#fff', minWidth: 0 },
  label: { fontSize: 11, color: '#5a6072', textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 },
  sec: { margin: '22px 0 10px', paddingBottom: 4, borderBottom: `2px solid ${NAVY}`, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 },
  secT: { fontWeight: 'bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 1, fontSize: 14, borderLeft: `4px solid ${GOLD}`, paddingLeft: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #eceef3', flexWrap: 'wrap' },
  lbl: { fontWeight: 'bold', color: '#2a3045', fontSize: 14, minWidth: 210, flex: '0 0 auto' },
  sub: { fontWeight: 'bold', color: TEAL, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8, margin: '14px 0 6px' },
  th: { textAlign: 'left', fontSize: 12, color: '#5a6072', textTransform: 'uppercase', padding: '8px 10px', borderBottom: `2px solid ${NAVY}` },
  td: { padding: '10px', borderBottom: '1px solid #eceef3', fontSize: 14 },
};

// ---------------- small inputs ----------------
function Chip({ on, children, onClick, small }) {
  return (
    <button type="button" onClick={onClick}
      style={{ border: `1.5px solid ${on ? NAVY : '#b9bfcc'}`, background: on ? NAVY : '#fff', color: on ? '#fff' : '#2a3045',
        borderRadius: 18, padding: small ? '4px 10px' : '6px 13px', fontSize: small ? 13 : 14, cursor: 'pointer', margin: '3px 6px 3px 0',
        fontWeight: on ? 'bold' : 'normal', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  );
}

function Opts({ k, o, multi, ctx, small, stack }) {
  const val = ctx.get(k);
  const isOn = (x) => (Array.isArray(val) ? val.includes(x) : val === x);
  const toggle = (x) => {
    if (multi) { const arr = Array.isArray(val) ? val : []; ctx.set(k, arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]); }
    else ctx.set(k, val === x ? '' : x);
  };
  return (
    <span style={{ display: stack ? 'flex' : 'inline-flex', flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'flex-start' : 'center', flexWrap: 'wrap' }}>
      {o.map((x) => <Chip key={x} small={small} on={isOn(x)} onClick={() => toggle(x)}>{x}</Chip>)}
    </span>
  );
}

function Txt({ k, w, u, ctx, phi, placeholder }) {
  const width = w === 'flex' ? undefined : Math.max(56, (w || 60) * 1.35);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flex: w === 'flex' ? 1 : '0 0 auto', minWidth: w === 'flex' ? 140 : undefined }}>
      <input value={ctx.get(k) ?? ''} onChange={(e) => ctx.set(k, e.target.value)} placeholder={placeholder}
        style={{ ...S.input, width, flex: w === 'flex' ? 1 : undefined, ...(phi ? { borderColor: AMBER, background: '#fffaf0' } : {}) }} />
      {u && <span style={{ fontSize: 13, color: '#555' }}>{u}</span>}
    </span>
  );
}

function Parts({ parts, ctx }) {
  return (parts || []).map((p, i) => {
    if (typeof p === 'string') return <span key={i} style={{ fontSize: 14, color: '#444' }}>{p}</span>;
    if (p.b) return <b key={i} style={{ fontSize: 14 }}>{p.b}</b>;
    if (p.o) return <Opts key={i} k={p.k} o={p.o} multi={p.multi} ctx={ctx} small />;
    return <Txt key={i} {...p} ctx={ctx} phi={ctx.isPhi(p.k)} />;
  });
}

// ---------------- item renderer ----------------
function Item({ it, ctx }) {
  switch (it.t) {
    case 'row':
      return (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          {it.fields.map((f) => (
            <label key={f.k} style={{ display: 'flex', flexDirection: 'column', flex: `${f.f || 1} 1 ${Math.max(120, (f.f || 1) * 90)}px` }}>
              {f.o ? <span><Opts k={f.k} o={f.o} ctx={ctx} /></span>
                : <input value={ctx.get(f.k) ?? ''} onChange={(e) => ctx.set(f.k, e.target.value)}
                  style={{ ...S.input, ...(f.phi ? { borderColor: AMBER, background: '#fffaf0' } : {}) }} />}
              <span style={S.label}>{f.l}{f.phi ? <span style={{ color: AMBER }}> · print only</span> : null}</span>
            </label>
          ))}
        </div>
      );
    case 'opts':
      if (!it.l || it.stack || it.grid) return <div style={{ padding: '4px 0' }}>{it.l && <div style={S.lbl}>{it.l}</div>}<Opts k={it.k} o={it.o} multi={it.multi} ctx={ctx} stack={it.stack} /></div>;
      return <div style={S.row}><span style={S.lbl}>{it.l}</span><Opts k={it.k} o={it.o} multi={it.multi} ctx={ctx} /><Parts parts={it.after} ctx={ctx} /></div>;
    case 'inline':
      return <div style={S.row}>{it.l && <span style={S.lbl}>{it.l}</span>}<Parts parts={it.parts} ctx={ctx} /></div>;
    case 'q':
      return <div style={S.row}><span style={{ flex: '1 1 260px', fontSize: 14 }}>{it.l}</span><Opts k={it.k} o={it.o} multi={it.multi} ctx={ctx} small /><Parts parts={it.after} ctx={ctx} /></div>;
    case 'yn':
      return it.items.map(([k, l]) => (
        <div key={k} style={{ ...S.row, justifyContent: 'space-between', padding: '4px 0', flexWrap: 'nowrap' }}>
          <span style={{ fontSize: 14 }}>{l}</span>
          <span style={{ flex: 'none' }}><Opts k={k} o={['Y', 'N']} ctx={ctx} small /></span>
        </div>
      ));
    case 'cols': {
      const tmpl = it.tmpl && it.tmpl !== '1fr 1fr' ? it.tmpl.replace('auto 1fr', 'repeat(auto-fit,minmax(300px,1fr))') : 'repeat(auto-fit,minmax(320px,1fr))';
      return <div style={{ display: 'grid', gridTemplateColumns: tmpl.startsWith('repeat(4') ? 'repeat(auto-fit,minmax(170px,1fr))' : tmpl, columnGap: 28 }}>
        {it.cols.map((col, i) => <div key={i}>{col.map((x, j) => <Item key={j} it={x} ctx={ctx} />)}</div>)}</div>;
    }
    case 'quads':
      return (
        <div>
          <div style={{ fontSize: 12, color: '#666', margin: '4px 0 6px' }}>Enter teeth or notes in each quadrant (UR · UL · LR · LL)</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: '6px 22px' }}>
            {it.items.map(([k, l]) => <Quad key={k} k={k} l={l} ctx={ctx} />)}
          </div>
        </div>
      );
    case 'datelist':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '0 22px' }}>
          {it.cols.map((col, i) => <div key={i}>{col.map(([k, l]) => (
            <div key={k} style={{ ...S.row, justifyContent: 'space-between', flexWrap: 'nowrap' }}>
              <Chip small on={!!ctx.get(k)} onClick={() => { const on = !ctx.get(k); ctx.set(k, on); if (on && !ctx.get(k + '_date')) ctx.set(k + '_date', fmtDate(today())); }}>{l}</Chip>
              <input value={ctx.get(k + '_date') ?? ''} onChange={(e) => ctx.set(k + '_date', e.target.value)} placeholder="Date" style={{ ...S.input, width: 110 }} />
            </div>))}</div>)}
        </div>
      );
    case 'lines':
      return (
        <div style={{ margin: '8px 0' }}>
          {it.l && <div style={{ fontSize: 14, marginBottom: 4 }}>{it.l}</div>}
          <textarea value={ctx.get(it.k) ?? ''} onChange={(e) => ctx.set(it.k, e.target.value)} rows={Math.max(2, it.n || 2)}
            style={{ ...S.input, width: '100%', resize: 'vertical' }} />
        </div>
      );
    case 'scale':
      return (
        <div style={S.row}>
          <span style={{ ...S.lbl, minWidth: 180 }}>{it.l} <span style={{ fontWeight: 'normal', color: '#666', fontSize: 12 }}>{it.sub}</span></span>
          <Opts k={it.k} o={Array.from({ length: 11 }, (_, i) => String(i))} ctx={ctx} small />
        </div>
      );
    case 'sub': return <div style={S.sub}>{it.text}</div>;
    case 'note': return <div style={{ fontSize: 12, color: '#5a6072', fontStyle: 'italic', margin: '10px 0' }}>{it.text}</div>;
    case 'sig': return <div style={{ fontSize: 12, color: '#888', margin: '12px 0' }}>Signature lines ({it.fields.join(', ')}) print on the form.</div>;
    case 'ceph': return <Ceph ctx={ctx} />;
    case 'cephfiles': return <CephUpload ctx={ctx} recordId={ctx.recordId} userName={ctx.userName} canRemove={ctx.canRemove} notify={ctx.notify} saveSoon={ctx.saveSoon} />;
    case 'harvRef': return <HarvRef />;
    case 'palp': return <Palp ctx={ctx} />;
    case 'rom':
      return <div style={{ fontSize: 12, color: '#888', margin: '8px 0' }}>The R / L opening graphs (Initial, Progress, Final) print blank so the opening path can be drawn by hand.</div>;
    case 'stagetable': return <StageTable it={it} ctx={ctx} />;
    case 'analysis': return <AnalysisPanel ctx={ctx} />;
    case 'teeth': return <Teeth k={it.k} set={it.set} ctx={ctx} />;
    default: return null;
  }
}

function StageTable({ it, ctx }) {
  const cell = (r, st) => {
    const k = stageKey(r.k, st);
    const raw = ctx.get(k);
    const val = Array.isArray(raw) ? raw[0] || '' : raw ?? '';
    if (r.o) return (
      <select value={val} onChange={(e) => ctx.set(k, e.target.value)} style={{ ...S.input, width: '100%', padding: '5px 4px', fontSize: 14 }}>
        <option value="">–</option>{r.o.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    );
    return (
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input inputMode="decimal" value={val} onChange={(e) => ctx.set(k, e.target.value)} style={{ ...S.input, width: '100%', padding: '5px 6px', fontSize: 15, textAlign: 'center' }} />
        {r.u && <span style={{ fontSize: 12, color: '#888' }}>{r.u}</span>}
      </span>
    );
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}><tbody>
        <tr><th style={{ ...S.th, background: NAVY, color: '#fff' }}>Measurement</th>
          {EXAM_STAGES.map(([st, l]) => <th key={st} style={{ ...S.th, background: TEAL, color: '#fff', textAlign: 'center', width: '20%' }}>{l}</th>)}</tr>
        {!it.noDate && <tr><td style={{ ...S.td, fontWeight: 'bold', color: NAVY }}>Exam date</td>
          {EXAM_STAGES.map(([st]) => <td key={st} style={{ ...S.td, padding: 4 }}>
            <input value={ctx.get(`${it.dateKey}_${st}`) ?? ''} onChange={(e) => ctx.set(`${it.dateKey}_${st}`, e.target.value)} placeholder="Date"
              style={{ ...S.input, width: '100%', padding: '5px 6px', fontSize: 14 }} /></td>)}</tr>}
        {it.rows.map((r) => (
          <tr key={r.k}>
            <td style={{ ...S.td, padding: '6px 10px', fontWeight: r.strong ? 'bold' : 'normal', color: r.strong ? NAVY : undefined }}>
              {r.l}{r.hint && <span style={{ fontSize: 12, color: '#888' }}> ({r.hint})</span>}</td>
            {EXAM_STAGES.map(([st]) => <td key={st} style={{ ...S.td, padding: 4 }}>{cell(r, st)}</td>)}
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function Quad({ k, l, ctx }) {
  const q = ctx.get(k) || {};
  const set = (pos, v) => ctx.set(k, { ...q, [pos]: v });
  const box = (pos, ph) => <input value={q[pos] || ''} onChange={(e) => set(pos, e.target.value)} placeholder={ph} style={{ ...S.input, width: 62, padding: '4px 6px', fontSize: 14, textAlign: pos.endsWith('r') ? 'right' : 'left' }} />;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #eceef3' }}>
      <span style={{ fontSize: 14 }}>{l}</span>
      <span style={{ display: 'grid', gridTemplateColumns: 'auto auto', borderCollapse: 'collapse' }}>
        <span style={{ borderRight: '1.5px solid #4a5063', borderBottom: '1.5px solid #4a5063', padding: 2 }}>{box('ur', 'UR')}</span>
        <span style={{ borderBottom: '1.5px solid #4a5063', padding: 2 }}>{box('ul', 'UL')}</span>
        <span style={{ borderRight: '1.5px solid #4a5063', padding: 2 }}>{box('lr', 'LR')}</span>
        <span style={{ padding: 2 }}>{box('ll', 'LL')}</span>
      </span>
    </div>
  );
}

const FB_COLOR = { ok: '#2f7a3b', mild: '#8a6d1f', marked: '#a33', info: '#6a7080' };
const FB_BG = { ok: '#eef7f0', mild: '#fdf5e2', marked: '#fbecec', info: '#f2f3f6' };

function Ceph({ ctx }) {
  const data = ctx.data || {};
  const cell = (k, ck) => {
    const val = ctx.get(`ceph_${k}_${ck}`) ?? '';
    const fb = cephFeedback(k, val, data);
    return (
      <div>
        <input value={val} onChange={(e) => ctx.set(`ceph_${k}_${ck}`, e.target.value)} inputMode="decimal"
          style={{ ...S.input, width: '100%', padding: '5px 6px', fontSize: 14, textAlign: 'center',
            ...(fb && fb.level !== 'info' ? { borderColor: FB_COLOR[fb.level], background: FB_BG[fb.level] } : {}) }} />
        {fb && <div title={fb.detail || ''} style={{ fontSize: 11, lineHeight: 1.25, color: FB_COLOR[fb.level], marginTop: 3 }}>
          {fb.text}{fb.detail ? <div style={{ color: '#777' }}>{fb.detail}</div> : null}</div>}
      </div>
    );
  };
  const block = (title, rows) => (
    <>
      <tr><th style={{ ...S.th, color: '#fff', background: NAVY }}>{title}</th><th style={{ ...S.th, color: '#fff', background: NAVY }}>Norm</th>
        {CEPH_COLS.map(([ck, l]) => <th key={ck} style={{ ...S.th, color: '#fff', background: ck === 'interp' ? NAVY : TEAL, textAlign: 'center' }}>{l}</th>)}</tr>
      {title === 'Skeletal' && (
        <tr>
          <td style={{ ...S.td, fontWeight: 'bold', color: NAVY }}>Tracing date</td><td style={S.td} />
          {CEPH_COLS.map(([ck]) => <td key={ck} style={{ ...S.td, padding: 4 }}>{ck === 'interp' ? null
            : <input value={ctx.get(cephDateKey(ck)) ?? ''} onChange={(e) => ctx.set(cephDateKey(ck), e.target.value)} placeholder="Date"
              style={{ ...S.input, width: '100%', padding: '5px 6px', fontSize: 13 }} />}</td>)}
        </tr>
      )}
      {rows.map(([k, l, u, n, interp]) => (
        <tr key={k}>
          <td style={{ ...S.td, fontWeight: 'bold', whiteSpace: 'nowrap' }}>{l} <span style={{ fontWeight: 'normal', color: '#888', fontSize: 12 }}>{u === 'mm' ? 'mm' : '°'}</span></td>
          <td style={{ ...S.td, textAlign: 'center', color: '#555' }}>{n}</td>
          {CEPH_COLS.map(([ck]) => <td key={ck} style={{ ...S.td, padding: 4 }}>{ck === 'interp'
            ? <input list={`interp_${k}`} value={ctx.get(`ceph_${k}_interp`) ?? ''} onChange={(e) => ctx.set(`ceph_${k}_interp`, e.target.value)}
              placeholder={autoInterp(k, data) ? `Auto: ${autoInterp(k, data)}` : interp} title="Leave blank to use the automatic interpretation"
              style={{ ...S.input, width: '100%', padding: '5px 6px', fontSize: 13 }} />
            : cell(k, ck)}</td>)}
          <datalist id={`interp_${k}`}>{interp.split(' / ').map((x) => <option key={x} value={x} />)}</datalist>
        </tr>
      ))}
    </>
  );
  return <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}><tbody>{block('Skeletal', CEPH_SKELETAL)}{block('Dental', CEPH_DENTAL)}</tbody></table>
    <div style={{ fontSize: 12, color: '#666', marginTop: 6 }}>⊥ = upper incisor · T = lower incisor · Feedback compares each value with its normal range
      {!(data.age && data.sex) ? <b style={{ color: '#8a6d1f' }}> · Enter age and sex on page 1 so Harvold and McNamara norms adjust for age</b> : ` (age ${data.age}, ${data.sex === 'F' ? 'female' : 'male'})`}.
      Interpretation fills in automatically unless you type one.</div></div>;
}

function HarvRef() {
  const rows = [['Males', [[82, 87, 92, 96, 100, 100], [99, 107, 114, 121, 127, 130], [17, 20, 22, 25, 27, 30], [59, 62, 64, 68, 71, 72]]],
    ['Females', [[80, 85, 90, 92, 93, 93], [97, 105, 113, 117, 119, 120], [17, 20, 23, 25, 26, 27], [57, 60, 62, 64, 65, 67]]]];
  const labels = ['Maxillary Length (Co–Pt A)', 'Predicted Mandibular Length (Co–Gn)', 'Maxillo-Mandibular Differential', 'Predicted Lower Facial Height (ANS–Me)'];
  return (
    <details style={{ margin: '10px 0' }}><summary style={{ cursor: 'pointer', color: TEAL, fontWeight: 'bold' }}>Harvold reference norms (print on the form)</summary>
      {rows.map(([sex, vals]) => (
        <table key={sex} style={{ borderCollapse: 'collapse', width: '100%', margin: '8px 0', fontSize: 13 }}><tbody>
          <tr>{[sex, '6', '9', '13', '14', '16', 'Adult'].map((h) => <th key={h} style={{ ...S.th, padding: 5 }}>{h}</th>)}</tr>
          {vals.map((v, i) => <tr key={i}><td style={{ ...S.td, padding: 5 }}>{labels[i]}</td>{v.map((x, j) => <td key={j} style={{ ...S.td, padding: 5, textAlign: 'center' }}>{x}</td>)}</tr>)}
        </tbody></table>))}
    </details>
  );
}

function Palp({ ctx }) {
  const sel = (k) => (
    <select value={ctx.get(k) ?? ''} onChange={(e) => ctx.set(k, e.target.value)} style={{ ...S.input, width: '100%', padding: '5px 4px', fontSize: 15, textAlign: 'center' }}>
      <option value="">–</option>{['0', '1', '2', '3'].map((x) => <option key={x} value={x}>{x}</option>)}
    </select>
  );
  const side = (s, name) => (
    <table style={{ borderCollapse: 'collapse', width: '100%' }}><tbody>
      <tr><th colSpan={4} style={{ background: TEAL, color: '#fff', padding: 8, letterSpacing: 1.5, textTransform: 'uppercase' }}>{name} Side</th></tr>
      <tr><th style={{ ...S.th, background: NAVY, color: '#fff' }}>Muscle</th>{PALP_STAGES.map(([, l]) => <th key={l} style={{ ...S.th, background: NAVY, color: '#fff', textAlign: 'center' }}>{l}</th>)}</tr>
      <tr><td style={{ ...S.td, fontWeight: 'bold', color: NAVY }}>Date</td>{PALP_STAGES.map(([st]) => <td key={st} style={{ ...S.td, padding: 3 }}>
        <input value={ctx.get(`palp_date_${s}_${st}`) ?? ''} onChange={(e) => ctx.set(`palp_date_${s}_${st}`, e.target.value)} style={{ ...S.input, width: '100%', fontSize: 12, padding: '5px 4px' }} /></td>)}</tr>
      {[['Extra-Oral', MUSCLES_EXTRA], ['Intra-Oral', MUSCLES_INTRA]].map(([g, list]) => [
        <tr key={g}><td colSpan={4} style={{ background: '#eef1f7', color: TEAL, fontWeight: 'bold', fontSize: 12, textTransform: 'uppercase', padding: '4px 8px' }}>{g}</td></tr>,
        ...list.map((m) => <tr key={m}><td style={{ ...S.td, padding: '4px 8px' }}>{m}</td>{PALP_STAGES.map(([st]) => <td key={st} style={{ ...S.td, padding: 3 }}>{sel(`palp_${s}_${muscleKey(m)}_${st}`)}</td>)}</tr>),
      ])}
    </tbody></table>
  );
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 22 }}>{side('r', 'Right')}{side('l', 'Left')}</div>;
}

function Teeth({ k, set, ctx }) {
  const marked = ctx.get(k) || [];
  const toggle = (t) => ctx.set(k, marked.includes(t) ? marked.filter((x) => x !== t) : [...marked, t]);
  const upper = set === 'prim' ? 'ABCDEFGHIJ'.split('') : Array.from({ length: 16 }, (_, i) => String(i + 1));
  const lower = set === 'prim' ? 'TSRQPONMLK'.split('') : Array.from({ length: 16 }, (_, i) => String(32 - i));
  const btn = (t, i, n) => (
    <button key={t} type="button" onClick={() => toggle(t)}
      style={{ width: 30, height: 30, border: `1.5px solid ${marked.includes(t) ? NAVY : '#b9bfcc'}`, background: marked.includes(t) ? GOLD : '#fff',
        color: NAVY, fontWeight: 'bold', fontSize: 12, borderRadius: 5, cursor: 'pointer', marginRight: i === n / 2 - 1 ? 10 : 3 }}>{t}</button>
  );
  return (
    <div style={{ overflowX: 'auto', padding: '4px 0' }}>
      <div style={{ whiteSpace: 'nowrap', marginBottom: 4 }}>{upper.map((t, i) => btn(t, i, upper.length))}</div>
      <div style={{ whiteSpace: 'nowrap' }}>{lower.map((t, i) => btn(t, i, lower.length))}</div>
      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Marked teeth print highlighted in gold on the chart. Use Comments for what was found.</div>
    </div>
  );
}

// ---------------- editor ----------------
function Editor({ rec: initial, user, onClose, notify, dentists }) {
  const form = FORMS[initial.form_type];
  const PHI = useMemo(() => phiKeys(form), [form]);
  const [rec, setRec] = useState(initial);
  const [phi, setPhi] = useState({}); // print-only, never saved
  const [page, setPage] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const topRef = useRef(null);
  const userName = user?.name || user?.username || '';

  useEffect(() => {
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const [autoSave, setAutoSave] = useState(0);
  const isMgr = user?.role === 'admin' || user?.role === 'manager';
  const ctx = {
    data: rec.data || {}, recordId: rec.id, userName, notify, canRemove: isMgr || rec.created_by === userName || !rec.created_by,
    saveSoon: () => setAutoSave((n) => n + 1),
    goPage: (i) => go(i),
    isPhi: (k) => PHI.has(k),
    get: (k) => (PHI.has(k) ? phi[k] : rec.data?.[k]),
    set: (k, v) => {
      if (PHI.has(k)) { setPhi((p) => ({ ...p, [k]: v })); return; }
      setRec((r) => ({ ...r, data: { ...(r.data || {}), [k]: v } })); setDirty(true);
    },
  };
  const setMeta = (k, v) => { setRec((r) => ({ ...r, [k]: v })); setDirty(true); };

  const save = async (status) => {
    if (!String(rec.chart_no || '').trim()) { notify?.('Chart # is required', 'error'); return false; }
    setSaving(true);
    try {
      const next = { ...rec, status: status || rec.status };
      await saveChart(next, userName);
      setRec({ ...next, created_by: next.created_by || userName });
      setDirty(false);
      notify?.(status === 'complete' ? 'Chart marked complete' : 'Chart saved', 'success');
      return true;
    } catch (e) {
      notify?.('Save failed: ' + (e.message || e), 'error');
      return false;
    } finally { setSaving(false); }
  };

  // Runs after a ceph report is attached, once the new values are in state.
  useEffect(() => { if (autoSave) save(); /* eslint-disable-next-line */ }, [autoSave]);

  const doPrint = () => printChart(form, { ...rec.data, ...phi, sig_date: '' }, {
    chartNo: rec.chart_no, date: fmtDate(rec.record_date), office: rec.office,
  });

  const close = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return;
    onClose();
  };

  const go = (i) => {
    setPage(i);
    let el = topRef.current;
    while (el && el !== document.body) { const o = getComputedStyle(el).overflowY; if ((o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight) break; el = el.parentElement; }
    (el && el !== document.body ? el : window).scrollTo({ top: 0, behavior: 'smooth' });
  };
  const pg = form.pages[page];

  return (
    <div style={S.wrap} ref={topRef}>
      <div style={S.top}>
        <button style={S.btn} onClick={close}>← Charts</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: GOLD, fontWeight: 'bold' }}>{form.title}</div>
          <div style={{ fontSize: 18, fontWeight: 'bold' }}>Chart #{rec.chart_no || '—'} {dirty && <span style={{ fontSize: 12, color: GOLD, fontWeight: 'normal' }}>· unsaved</span>}</div>
        </div>
        {form.key === 'ortho' && <ProgressChip data={rec.data} onClick={() => go(form.pages.findIndex((p) => p.title === 'Diagnostic Analysis'))} />}
        <button style={S.btn} disabled={saving} onClick={() => save()}>{saving ? 'Saving…' : 'Save'}</button>
        {rec.status !== 'complete' && <button style={S.btn} disabled={saving} onClick={() => save('complete')}>Mark complete</button>}
        <button style={S.btnGold} onClick={doPrint}>Print</button>
      </div>

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: 16 }}>
        <div style={{ ...S.card, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column' }}><input value={rec.chart_no || ''} onChange={(e) => setMeta('chart_no', e.target.value)} style={{ ...S.input, width: 130 }} /><span style={S.label}>Chart #</span></label>
          <label style={{ display: 'flex', flexDirection: 'column' }}>
            <select value={rec.office || ''} onChange={(e) => setMeta('office', e.target.value)} style={{ ...S.input, width: 150 }}>
              <option value="">—</option>{officeNames.map((o) => <option key={o} value={o}>{o}</option>)}</select><span style={S.label}>Office</span></label>
          <label style={{ display: 'flex', flexDirection: 'column' }}><input list="ortho_dentists" value={rec.dentist || ''} onChange={(e) => setMeta('dentist', e.target.value)} style={{ ...S.input, width: 180 }} /><span style={S.label}>Dentist</span></label>
          <label style={{ display: 'flex', flexDirection: 'column' }}><input type="date" value={rec.record_date || ''} onChange={(e) => setMeta('record_date', e.target.value)} style={{ ...S.input, width: 160 }} /><span style={S.label}>Record date</span></label>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: rec.status === 'complete' ? '#2f7a3b' : '#8a6d1f', fontWeight: 'bold' }}>{rec.status === 'complete' ? '● Complete' : '● Draft'}</span>
        </div>

        <div style={{ background: '#fffaf0', border: `1px solid ${AMBER}`, borderRadius: 8, padding: '9px 13px', fontSize: 13, color: '#6b4a10', marginBottom: 12 }}>
          <b>Print-only fields</b> (amber boxes): patient name, DOB, address, phone, email, responsible party and insurance member details
          are used for this printout only. They are <b>not saved</b> and clear when you leave this chart.
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <nav style={{ ...S.card, padding: 8, flex: '0 0 240px', position: 'sticky', top: 84, maxHeight: 'calc(100vh - 100px)', overflowY: 'auto' }}>
            {form.pages.map((p, i) => (
              <button key={i} onClick={() => go(i)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderLeft: `4px solid ${i === page ? GOLD : 'transparent'}`,
                  background: i === page ? '#eef1f7' : 'transparent', color: NAVY, padding: '9px 10px', fontSize: 14, fontWeight: i === page ? 'bold' : 'normal', cursor: 'pointer', borderRadius: 4 }}>
                <span style={{ color: '#8a90a0', marginRight: 6 }}>{i + 1}</span>{p.title}
              </button>
            ))}
          </nav>

          <div style={{ ...S.card, flex: '1 1 600px', minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 'bold', color: NAVY }}>{pg.title}</div>
            {pg.sections.map((s, si) => (
              <div key={si}>
                {s.title && (
                  <div style={S.sec}>
                    <span style={S.secT}>{s.title}</span>
                    {s.subOpts ? <span style={{ fontSize: 13 }}>{s.subOpts.l} <Opts k={s.subOpts.k} o={s.subOpts.o} ctx={ctx} small /></span>
                      : s.sub && <span style={{ fontSize: 12, color: '#666', fontStyle: 'italic' }}>{s.sub}</span>}
                  </div>
                )}
                {s.items.map((it, ii) => <Item key={ii} it={it} ctx={ctx} />)}
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 10 }}>
              <button style={S.btn} disabled={page === 0} onClick={() => go(page - 1)}>← Previous</button>
              <button style={S.btn} disabled={saving} onClick={() => save()}>Save</button>
              {page < form.pages.length - 1
                ? <button style={S.btnNavy} onClick={() => go(page + 1)}>Next: {form.pages[page + 1].title} →</button>
                : <button style={S.btnGold} onClick={doPrint}>Print</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- list / landing ----------------
export default function Ortho({ user, providers = [], goHome, notify }) {
  const dentists = [...new Set((providers || []).map((p) => p && p.name).filter(Boolean))];
  const dentistList = <datalist id="ortho_dentists">{dentists.map((d) => <option key={d} value={d} />)}</datalist>;
  const isManager = user?.role === 'admin' || user?.role === 'manager';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [office, setOffice] = useState(user?.office && !isManager ? user.office : '');
  const [type, setType] = useState('');
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(null); // { form_type, chart_no, office, dentist, record_date }

  const load = async () => {
    setLoading(true);
    try { setRows(await listCharts({ office, formType: type, chartNo: q })); }
    catch (e) { notify?.('Could not load charts: ' + (e.message || e), 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); /* eslint-disable-next-line */ }, [q, office, type]);

  const openRec = async (id) => {
    try { const r = await getChart(id); if (r) setOpen(r); else notify?.('Chart not found', 'error'); }
    catch (e) { notify?.('Could not open chart: ' + (e.message || e), 'error'); }
  };

  const startNew = (form_type) => setCreating({ form_type, chart_no: q.trim(), office: user?.office || '', dentist: '', record_date: today() });

  const create = () => {
    if (!creating.chart_no.trim()) { notify?.('Enter the chart #', 'error'); return; }
    setOpen({ id: newId(), status: 'draft', data: {}, ...creating, chart_no: creating.chart_no.trim() });
    setCreating(null);
  };

  const remove = async (r) => {
    if (!window.confirm(`Delete the ${FORMS[r.form_type].short} for chart #${r.chart_no}? This cannot be undone.`)) return;
    try {
      const full = await getChart(r.id).catch(() => null);
      const paths = ((full && full.data && full.data.ceph_files) || []).map((f) => f.path).filter(Boolean);
      await removeChartFiles(paths).catch(() => {});
      await deleteChart(r.id); notify?.('Deleted', 'success'); load();
    } catch (e) { notify?.('Delete failed: ' + (e.message || e), 'error'); }
  };

  if (open) return <>{dentistList}<Editor rec={open} user={user} notify={notify} dentists={dentists} onClose={() => { setOpen(null); load(); }} /></>;

  return (
    <div style={S.wrap}>
      {dentistList}
      <div style={S.top}>
        {goHome && <button style={S.btn} onClick={goHome}>← Home</button>}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: GOLD, fontWeight: 'bold' }}>Beautiful Smiles by Design</div>
          <div style={{ fontSize: 20, fontWeight: 'bold' }}>Ortho &amp; TMJ Records</div>
        </div>
        <button style={S.btnGold} onClick={() => startNew('ortho')}>+ Ortho Record</button>
        <button style={S.btnGold} onClick={() => startNew('tmj')}>+ TMJ Consult</button>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: 16 }}>
        {creating && (
          <div style={{ ...S.card, marginBottom: 14, borderColor: GOLD, borderWidth: 2 }}>
            <div style={{ fontWeight: 'bold', color: NAVY, fontSize: 17, marginBottom: 10 }}>New {FORMS[creating.form_type].title}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', flexDirection: 'column' }}><input autoFocus value={creating.chart_no} onChange={(e) => setCreating({ ...creating, chart_no: e.target.value })} style={{ ...S.input, width: 140 }} /><span style={S.label}>Chart #</span></label>
              <label style={{ display: 'flex', flexDirection: 'column' }}><select value={creating.office} onChange={(e) => setCreating({ ...creating, office: e.target.value })} style={{ ...S.input, width: 150 }}>
                <option value="">—</option>{officeNames.map((o) => <option key={o} value={o}>{o}</option>)}</select><span style={S.label}>Office</span></label>
              <label style={{ display: 'flex', flexDirection: 'column' }}><input list="ortho_dentists" value={creating.dentist} onChange={(e) => setCreating({ ...creating, dentist: e.target.value })} style={{ ...S.input, width: 180 }} /><span style={S.label}>Dentist</span></label>
              <label style={{ display: 'flex', flexDirection: 'column' }}><input type="date" value={creating.record_date} onChange={(e) => setCreating({ ...creating, record_date: e.target.value })} style={{ ...S.input, width: 160 }} /><span style={S.label}>Record date</span></label>
              <button style={S.btnNavy} onClick={create}>Start</button>
              <button style={S.btn} onClick={() => setCreating(null)}>Cancel</button>
            </div>
          </div>
        )}

        <div style={{ ...S.card, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
          <input placeholder="Search chart #" value={q} onChange={(e) => setQ(e.target.value)} style={{ ...S.input, width: 180 }} />
          <select value={office} onChange={(e) => setOffice(e.target.value)} style={{ ...S.input, width: 160 }} disabled={!!user?.office && !isManager}>
            <option value="">All offices</option>{officeNames.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...S.input, width: 170 }}>
            <option value="">All forms</option><option value="ortho">Ortho Records</option><option value="tmj">TMJ Consults</option></select>
          <span style={{ marginLeft: 'auto', fontSize: 13, color: '#666' }}>{loading ? 'Loading…' : `${rows.length} record${rows.length === 1 ? '' : 's'}`}</span>
        </div>

        <div style={{ ...S.card, padding: 0, overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
            <thead><tr>{['Chart #', 'Form', 'Office', 'Dentist', 'Record date', 'Status', 'Last saved', ''].map((h) => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {!loading && rows.length === 0 && <tr><td colSpan={8} style={{ ...S.td, textAlign: 'center', color: '#888', padding: 30 }}>No records yet. Start one with the gold buttons above.</td></tr>}
              {rows.map((r) => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => openRec(r.id)}>
                  <td style={{ ...S.td, fontWeight: 'bold', color: NAVY }}>{r.chart_no}</td>
                  <td style={S.td}>{FORMS[r.form_type]?.short || r.form_type}</td>
                  <td style={S.td}>{r.office || '—'}</td>
                  <td style={S.td}>{r.dentist || '—'}</td>
                  <td style={S.td}>{fmtDate(r.record_date)}</td>
                  <td style={S.td}><span style={{ fontSize: 12, fontWeight: 'bold', padding: '3px 9px', borderRadius: 10, background: r.status === 'complete' ? '#e5f3e8' : '#fbf1d9', color: r.status === 'complete' ? '#2f7a3b' : '#8a6d1f' }}>{r.status === 'complete' ? 'Complete' : 'Draft'}</span></td>
                  <td style={{ ...S.td, fontSize: 12, color: '#666' }}>{fmtDate(r.updated_at)}{r.updated_by ? ` · ${r.updated_by}` : ''}</td>
                  <td style={S.td} onClick={(e) => e.stopPropagation()}>{isManager && <button style={{ ...S.btn, padding: '4px 10px', fontSize: 12, color: '#a33' }} onClick={() => remove(r)}>Delete</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
