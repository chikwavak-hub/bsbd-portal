// Ceph report upload for the Ortho module (Cephalometric Analysis page).
//
// 1. Pick the report (PDF or photo) and which column it belongs to (Initial / Progress 1 / Progress 2 / Final).
// 2. Black out the patient's name, DOB and any ID on each page (drag a box). Required before anything leaves the browser.
// 3. "Read report": the blacked-out pages go to /api/ceph-read, which returns the patient's measured values.
// 4. Staff review: each value shows the row it was read from and a confidence; uncheck or correct anything.
// 5. "Apply & save": values go into the chosen column, and the blacked-out copy is saved to the chart as a PDF.
//    "Save report only" keeps the file without reading it.
import { useRef, useState } from 'react';
import { CEPH_SKELETAL, CEPH_DENTAL, CEPH_ALIASES, CEPH_STAGES, cephDateKey } from '../../lib/orthoSchema';
import { uploadCephReport, openCephReport, removeCephReport } from '../../lib/orthoApi';

const NAVY = '#1B2A6B', GOLD = '#C9A84C', TEAL = '#2A7A8C', LINE = '#d9dce5', AMBER = '#B7791F', RED = '#a33';
const MAX_PAGES = 6;
const ALL = [...CEPH_SKELETAL, ...CEPH_DENTAL];
const LABEL = Object.fromEntries(ALL.map(([k, l]) => [k, l]));
const NORM = Object.fromEntries(ALL.map(([k, , , n]) => [k, n]));
const stageLabel = (st) => (CEPH_STAGES.find(([k]) => k === st) || [, st])[1];
const fmtNum = (v) => (v == null || v === '' ? '' : String(Math.round(Number(v) * 10) / 10));

const btn = { background: '#fff', color: NAVY, border: `1px solid ${LINE}`, borderRadius: 6, padding: '7px 13px', fontWeight: 'bold', cursor: 'pointer', fontSize: 14 };
const btnNavy = { ...btn, background: NAVY, color: '#fff', border: 0 };
const btnGold = { ...btn, background: GOLD, color: NAVY, border: 0 };
const input = { border: '1px solid #b9bfcc', borderRadius: 6, padding: '6px 8px', fontSize: 14, fontFamily: 'inherit' };

// ---------- file → page images ----------
async function pdfToPages(file) {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(pdf.numPages, MAX_PAGES); p++) {
    const page = await pdf.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(2.2, 1700 / base.width) });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pages.push({ src: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height, boxes: [] });
  }
  return { pages, total: pdf.numPages };
}

function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

async function imageToPage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
    return { src: c.toDataURL('image/jpeg', 0.9), w: c.width, h: c.height, boxes: [] };
  } finally { URL.revokeObjectURL(url); }
}

// Page with the black boxes burned in. This is the only version that is sent or saved.
async function redactedJpeg(pg) {
  const img = await loadImage(pg.src);
  const c = document.createElement('canvas'); c.width = pg.w; c.height = pg.h;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, pg.w, pg.h);
  ctx.fillStyle = '#000'; pg.boxes.forEach((b) => ctx.fillRect(b.x, b.y, b.w, b.h));
  return c.toDataURL('image/jpeg', 0.88);
}

async function redactedPdf(pages) {
  const { jsPDF } = await import('jspdf');
  let doc = null;
  for (const pg of pages) {
    const data = await redactedJpeg(pg);
    const landscape = pg.w > pg.h;
    const wPt = landscape ? 792 : 612, hPt = landscape ? 612 : 792;
    if (!doc) doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'letter' });
    else doc.addPage('letter', landscape ? 'landscape' : 'portrait');
    const s = Math.min(wPt / pg.w, hPt / pg.h);
    const w = pg.w * s, h = pg.h * s;
    doc.addImage(data, 'JPEG', (wPt - w) / 2, (hPt - h) / 2, w, h);
  }
  return doc.output('blob');
}

// ---------- one page with drag-to-black-out ----------
function PageCard({ pg, index, onChange }) {
  const wrap = useRef(null);
  const [draft, setDraft] = useState(null);
  const toImg = (e) => {
    const r = wrap.current.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - r.left, 0), r.width), y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
    return { x: (x * pg.w) / r.width, y: (y * pg.h) / r.height };
  };
  const down = (e) => { e.preventDefault(); wrap.current.setPointerCapture?.(e.pointerId); const p = toImg(e); setDraft({ x0: p.x, y0: p.y, x: p.x, y: p.y, w: 0, h: 0 }); };
  const move = (e) => { if (!draft) return; const p = toImg(e); setDraft((d) => ({ ...d, x: Math.min(d.x0, p.x), y: Math.min(d.y0, p.y), w: Math.abs(p.x - d.x0), h: Math.abs(p.y - d.y0) })); };
  const up = () => { if (draft && draft.w > 6 && draft.h > 6) onChange({ ...pg, boxes: [...pg.boxes, { x: draft.x, y: draft.y, w: draft.w, h: draft.h }] }); setDraft(null); };
  const pct = (b) => ({ left: `${(b.x / pg.w) * 100}%`, top: `${(b.y / pg.h) * 100}%`, width: `${(b.w / pg.w) * 100}%`, height: `${(b.h / pg.h) * 100}%` });
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: 8, background: '#fff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <b style={{ color: NAVY, fontSize: 13 }}>Page {index + 1} · {pg.boxes.length} box{pg.boxes.length === 1 ? '' : 'es'}</b>
        <span>
          <button type="button" style={{ ...btn, padding: '3px 9px', fontSize: 12 }} disabled={!pg.boxes.length} onClick={() => onChange({ ...pg, boxes: pg.boxes.slice(0, -1) })}>Undo box</button>
          <button type="button" style={{ ...btn, padding: '3px 9px', fontSize: 12, marginLeft: 6 }} disabled={!pg.boxes.length} onClick={() => onChange({ ...pg, boxes: [] })}>Clear</button>
        </span>
      </div>
      <div ref={wrap} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDraft(null)}
        style={{ position: 'relative', touchAction: 'none', cursor: 'crosshair', userSelect: 'none', lineHeight: 0 }}>
        <img src={pg.src} alt={`Report page ${index + 1}`} draggable={false} style={{ width: '100%', display: 'block', border: '1px solid #eee' }} />
        {pg.boxes.map((b, i) => <div key={i} style={{ position: 'absolute', background: '#000', ...pct(b) }} />)}
        {draft && <div style={{ position: 'absolute', background: 'rgba(0,0,0,.55)', outline: `2px dashed ${GOLD}`, ...pct(draft) }} />}
      </div>
    </div>
  );
}

// ---------- reports already on file ----------
export function CephFilesList({ files, canRemove, onRemove, notify }) {
  if (!files || !files.length) return null;
  const open = async (f) => { try { await openCephReport(f.path, `Ceph report · ${stageLabel(f.stage)}${f.tracing_date ? ' · ' + f.tracing_date : ''}`); } catch (e) { notify?.('Could not open the report: ' + (e.message || e), 'error'); } };
  return (
    <div style={{ margin: '6px 0 4px' }}>
      <div style={{ fontWeight: 'bold', color: TEAL, fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Ceph reports on file</div>
      {files.map((f) => (
        <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #eceef3', flexWrap: 'wrap', fontSize: 14 }}>
          <span style={{ fontWeight: 'bold', color: NAVY, minWidth: 90 }}>{stageLabel(f.stage)}</span>
          <span>{f.tracing_date || 'no tracing date'}</span>
          <span style={{ color: '#666', fontSize: 12 }}>{f.applied ? `${f.applied} values entered` : 'file only'}{f.by ? ` · ${f.by}` : ''}{f.at ? ` · ${new Date(f.at).toLocaleDateString()}` : ''}</span>
          <span style={{ marginLeft: 'auto' }}>
            <button type="button" style={{ ...btn, padding: '4px 10px', fontSize: 13 }} onClick={() => open(f)}>Open</button>
            {canRemove && <button type="button" style={{ ...btn, padding: '4px 10px', fontSize: 13, color: RED, marginLeft: 6 }} onClick={() => onRemove(f)}>Remove</button>}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- main ----------
export default function CephUpload({ ctx, recordId, userName, canRemove, notify, saveSoon }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState('i');
  const [pages, setPages] = useState([]);
  const [fileName, setFileName] = useState('');
  const [skipped, setSkipped] = useState(0);
  const [loading, setLoading] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState(null); // { values, notes, report_type, software }
  const [rows, setRows] = useState([]); // [{ id, value, quote, confidence, use }]
  const [tDate, setTDate] = useState('');
  const [toHarvold, setToHarvold] = useState(true);
  const fileRef = useRef(null);

  const files = ctx.get('ceph_files') || [];
  const boxes = pages.reduce((n, p) => n + p.boxes.length, 0);

  const reset = () => { setPages([]); setFileName(''); setSkipped(0); setConfirmed(false); setResult(null); setRows([]); setTDate(''); setLoading(''); if (fileRef.current) fileRef.current.value = ''; };

  const pick = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    reset(); setLoading('Opening the report…');
    try {
      if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        const { pages: pg, total } = await pdfToPages(f);
        setPages(pg); setSkipped(Math.max(0, total - pg.length));
      } else if (/^image\//.test(f.type)) {
        setPages([await imageToPage(f)]);
      } else { notify?.('Use a PDF or a photo (JPEG / PNG) of the report', 'error'); }
      setFileName(f.name);
    } catch (err) { notify?.('Could not open that file: ' + (err.message || err), 'error'); }
    setLoading('');
  };

  // Nothing leaves the browser until at least one box is drawn and the blackout is confirmed.
  const blackoutOk = () => {
    if (!boxes) { notify?.('Draw a black box over the patient name and DOB first', 'error'); return false; }
    if (!confirmed) { notify?.('Tick the box to confirm the name, DOB and IDs are blacked out', 'error'); return false; }
    return true;
  };

  const read = async () => {
    if (!blackoutOk()) return;
    setLoading('Reading the report… this can take up to a minute.');
    try {
      const images = [];
      for (const pg of pages) images.push({ mediaType: 'image/jpeg', data: (await redactedJpeg(pg)).split(',')[1] });
      const measures = ALL.map(([id, label, unit, norm]) => ({ id, label, unit: unit === 'mm' ? 'mm' : 'deg', norm, aliases: CEPH_ALIASES[id] || [] }));
      const r = await fetch('/api/ceph-read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images, measures }) });
      const data = await r.json().catch(() => ({ ok: false, error: `Server error ${r.status}` }));
      if (!data.ok) throw new Error(data.error || 'Read failed');
      setResult(data.result);
      setRows(data.result.values.map((v) => ({ ...v, value: fmtNum(v.value), use: v.value != null && v.confidence >= 70 })));
      if (data.result.tracing_date) setTDate(data.result.tracing_date);
      const found = data.result.values.filter((v) => v.value != null).length;
      notify?.(`Found ${found} of ${data.result.values.length} measurements. Check them before applying.`);
    } catch (err) { notify?.('Ceph read failed: ' + String(err.message || err).slice(0, 160), 'error'); }
    setLoading('');
  };

  const saveFile = async (applied) => {
    const blob = await redactedPdf(pages);
    const path = await uploadCephReport(recordId, stage, blob);
    const entry = { path, stage, tracing_date: tDate || '', applied, pages: pages.length, by: userName || '', at: new Date().toISOString(),
      source: result ? [result.software, result.report_type].filter(Boolean).join(' · ') : '' };
    ctx.set('ceph_files', [...files, entry]);
    return entry;
  };

  const apply = async (withValues) => {
    if (!blackoutOk()) return;
    if (!recordId) { notify?.('Save the chart first', 'error'); return; }
    setLoading('Saving the report…');
    try {
      let n = 0;
      if (withValues) {
        rows.filter((r) => r.use && r.value !== '' && !isNaN(Number(r.value))).forEach((r) => { ctx.set(`ceph_${r.id}_${stage}`, String(r.value)); n++; });
        if (toHarvold && stage === 'i') {
          const v = Object.fromEntries(rows.filter((r) => r.use && r.value !== '').map((r) => [r.id, r.value]));
          if (v.mxlen) { ctx.set('hv_mx', v.mxlen); ctx.set('hv_mx2', v.mxlen); }
          if (v.mdlen) { ctx.set('hv_md', v.mdlen); ctx.set('hv_md2', v.mdlen); }
          if (v.mxlen && v.mdlen) ctx.set('hv_diff', fmtNum(Number(v.mdlen) - Number(v.mxlen)));
          if (v.ansm) ctx.set('hv_ansm', v.ansm);
        }
      }
      if (tDate) ctx.set(cephDateKey(stage), tDate);
      await saveFile(n);
      saveSoon?.();
      notify?.(withValues ? `${n} values entered in ${stageLabel(stage)} and the report saved` : 'Report saved to the chart', 'success');
      reset(); setOpen(false);
    } catch (err) { notify?.('Could not save the report: ' + String(err.message || err).slice(0, 160), 'error'); setLoading(''); }
  };

  const remove = async (f) => {
    if (!window.confirm(`Remove the ${stageLabel(f.stage)} ceph report from this chart? The values already entered stay.`)) return;
    try { await removeCephReport(f.path); } catch (e) { notify?.('File delete failed, removing the link anyway: ' + (e.message || e), 'error'); }
    ctx.set('ceph_files', files.filter((x) => x.path !== f.path));
    saveSoon?.();
  };

  const set = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const found = rows.filter((r) => r.value !== '').length;
  const harvoldUse = stage === 'i';

  return (
    <div style={{ border: `1.5px solid ${open ? GOLD : LINE}`, borderRadius: 10, padding: 12, margin: '10px 0 14px', background: open ? '#fffdf6' : '#fafbfd' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ color: NAVY, fontSize: 15 }}>Ceph report</b>
        <span style={{ fontSize: 13, color: '#666' }}>Upload the analysis to fill a column and keep a copy with the chart.</span>
        {!open && <button type="button" style={{ ...btnGold, marginLeft: 'auto' }} onClick={() => setOpen(true)}>Upload ceph report</button>}
        {open && <button type="button" style={{ ...btn, marginLeft: 'auto' }} onClick={() => { reset(); setOpen(false); }}>Cancel</button>}
      </div>

      <CephFilesList files={files} canRemove={canRemove} onRemove={remove} notify={notify} />

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#5a6072' }}>
              <select value={stage} onChange={(e) => setStage(e.target.value)} style={{ ...input, width: 150 }}>
                {CEPH_STAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>COLUMN</label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#5a6072' }}>
              <input value={tDate} onChange={(e) => setTDate(e.target.value)} placeholder="MM/DD/YYYY" style={{ ...input, width: 130 }} />TRACING DATE</label>
            <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#5a6072' }}>
              <input ref={fileRef} type="file" accept="application/pdf,image/jpeg,image/png" onChange={pick} style={{ fontSize: 14 }} />REPORT (PDF OR PHOTO)</label>
          </div>
          {ctx.get(`ceph_sna_${stage}`) && <div style={{ fontSize: 12, color: AMBER, marginTop: 6 }}>The {stageLabel(stage)} column already has values. Applying will replace the ones you keep ticked.</div>}

          {loading && <div style={{ margin: '12px 0', color: TEAL, fontWeight: 'bold' }}><span className="spinner" style={{ marginRight: 8 }} />{loading}</div>}

          {pages.length > 0 && (
            <>
              <div style={{ background: '#fffaf0', border: `1px solid ${AMBER}`, borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#6b4a10', margin: '12px 0 8px' }}>
                <b>Black out the patient's name, date of birth and any ID number</b> on every page: drag a box over each one.
                Only the blacked-out copy is read and saved.{skipped ? ` Only the first ${MAX_PAGES} pages are used (${skipped} skipped).` : ''}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 10 }}>
                {pages.map((pg, i) => <PageCard key={i} pg={pg} index={i} onChange={(np) => { if (np.boxes.length < pg.boxes.length) setConfirmed(false); setPages((ps) => ps.map((p, j) => (j === i ? np : p))); }} />)}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', fontSize: 14 }}>
                <input type="checkbox" checked={confirmed} disabled={!boxes} onChange={(e) => setConfirmed(e.target.checked)} style={{ width: 18, height: 18 }} />
                Name, DOB and IDs are blacked out on every page{boxes === 0 ? <span style={{ color: RED }}> (no boxes drawn yet)</span> : ''}
              </label>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" style={btnNavy} disabled={!!loading || !boxes || !confirmed} onClick={read}>{result ? 'Read again' : 'Read report'}</button>
                <button type="button" style={btn} disabled={!!loading || !boxes || !confirmed} onClick={() => apply(false)}>Save report only</button>
              </div>
            </>
          )}

          {result && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline', marginBottom: 6 }}>
                <b style={{ color: NAVY }}>Found {found} of {rows.length}</b>
                {(result.software || result.report_type) && <span style={{ fontSize: 13, color: '#666' }}>{[result.software, result.report_type].filter(Boolean).join(' · ')}</span>}
                <span style={{ fontSize: 12, color: '#666' }}>Ticked values go into <b>{stageLabel(stage)}</b>. Below 70% confidence starts unticked.</span>
              </div>
              {result.notes && <div style={{ fontSize: 13, color: '#6b4a10', background: '#fffaf0', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>{result.notes}</div>}
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620, fontSize: 14 }}><tbody>
                  <tr>{['Use', 'Measurement', 'Norm', 'Value', 'Read from', 'Confidence'].map((h) => <th key={h} style={{ textAlign: 'left', fontSize: 12, color: '#fff', background: NAVY, padding: '6px 8px' }}>{h}</th>)}</tr>
                  {rows.map((r, i) => (
                    <tr key={r.id} style={{ background: r.value === '' ? '#f6f7fa' : r.confidence < 70 ? '#fffaf0' : '#fff', borderBottom: '1px solid #eceef3' }}>
                      <td style={{ padding: '4px 8px' }}><input type="checkbox" checked={!!r.use} disabled={r.value === ''} onChange={(e) => set(i, { use: e.target.checked })} style={{ width: 18, height: 18 }} /></td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{LABEL[r.id]}</td>
                      <td style={{ padding: '4px 8px', color: '#666' }}>{NORM[r.id]}</td>
                      <td style={{ padding: '4px 8px' }}><input value={r.value} onChange={(e) => set(i, { value: e.target.value, use: e.target.value !== '' })} placeholder="—" inputMode="decimal"
                        style={{ ...input, width: 80, textAlign: 'center', fontWeight: 'bold', color: NAVY }} /></td>
                      <td style={{ padding: '4px 8px', fontSize: 12, color: '#555', maxWidth: 260 }}>{r.quote || (r.value === '' ? 'Not in report' : '')}</td>
                      <td style={{ padding: '4px 8px', fontSize: 13, fontWeight: 'bold', color: r.confidence >= 90 ? '#2f7a3b' : r.confidence >= 70 ? '#8a6d1f' : RED }}>{r.value === '' ? '' : `${r.confidence}%`}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              {harvoldUse && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0 0', fontSize: 14 }}>
                  <input type="checkbox" checked={toHarvold} onChange={(e) => setToHarvold(e.target.checked)} style={{ width: 18, height: 18 }} />
                  Also fill MX length, MD length, their difference and ANS-M on the Harvold page
                </label>
              )}
              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" style={btnGold} disabled={!!loading || !boxes || !confirmed} onClick={() => apply(true)}>Apply {rows.filter((r) => r.use && r.value !== '').length} values &amp; save report</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
