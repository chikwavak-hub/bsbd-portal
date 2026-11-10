// Diagnostic Analysis page of the Ortho record:
//   1. Checklist of the critical items the plan needs (with links to the page each one is on)
//   2. Findings / problem list, built as values come in
//   3. Suggested treatment plan once every critical item is entered, with "Use this plan"
// Suggestions only: nothing reaches the Treatment Plan page until the dentist taps "Use this plan".
import { useMemo, useState } from 'react';
import { analyze, planToForm, pageOf } from '../../lib/orthoAnalysis';

const NAVY = '#1B2A6B', GOLD = '#C9A84C', TEAL = '#2A7A8C', LINE = '#d9dce5', GREEN = '#2f7a3b', AMBER = '#8a6d1f', RED = '#a33';
const btn = { background: '#fff', color: NAVY, border: `1px solid ${LINE}`, borderRadius: 6, padding: '6px 12px', fontWeight: 'bold', cursor: 'pointer', fontSize: 13 };
const AREA_COLOR = { 'Skeletal — front to back': NAVY, 'Skeletal — vertical': NAVY, Transverse: NAVY, Dental: TEAL, Airway: AMBER, TMJ: RED, Habits: AMBER };

export function useAnalysis(data) {
  return useMemo(() => analyze(data || {}), [data]);
}

export function ProgressChip({ data, onClick }) {
  const a = useAnalysis(data);
  const { done, total, ready } = a.checklist;
  return (
    <button type="button" onClick={onClick} title="Critical items for the treatment plan"
      style={{ background: ready ? '#e5f3e8' : '#fff', color: ready ? GREEN : NAVY, border: 0, borderRadius: 16, padding: '6px 12px', fontWeight: 'bold', fontSize: 13, cursor: 'pointer' }}>
      {ready ? '✓ Plan ready' : `Plan items ${done}/${total}`}
    </button>
  );
}

function Why({ list }) {
  if (!list || !list.length) return null;
  return <div style={{ fontSize: 12, color: '#6a7080', marginTop: 2 }}>Why: {list.join(' · ')}</div>;
}

export default function AnalysisPanel({ ctx }) {
  const data = ctx.data || {};
  const a = useAnalysis(data);
  const cl = a.checklist;
  const [showRec, setShowRec] = useState(false);
  const pct = Math.round((100 * cl.done) / cl.total);
  const form = useMemo(() => planToForm(a), [a]);
  const used = data.plan_used_at;
  const changed = used && a.plan && ['tp_phase1', 'tp_phase2', 'tp_skeletal'].some((k) => (data.plan_used_sig || {})[k] !== form[k]);
  const summaryPage = pageOf('Summary & Treatment Plan');

  const usePlan = () => {
    const hasText = ['tp_functional', 'tp_skeletal', 'tp_dental', 'tp_phase1', 'tp_phase2'].some((k) => String(data[k] || '').trim());
    if (hasText && !window.confirm('The Treatment Plan page already has text. Replace it with this suggested plan?')) return;
    Object.entries(form).forEach(([k, v]) => ctx.set(k, v));
    ctx.set('plan_used_at', new Date().toISOString());
    ctx.set('plan_used_by', ctx.userName || '');
    ctx.set('plan_used_sig', { tp_phase1: form.tp_phase1, tp_phase2: form.tp_phase2, tp_skeletal: form.tp_skeletal });
    ctx.notify?.('Plan copied to the Treatment Plan page. Review and edit it there.', 'success');
    ctx.goPage?.(summaryPage);
  };

  const missingByPage = cl.missing.reduce((m, it) => { (m[it.page] = m[it.page] || []).push(it); return m; }, {});
  const recMissing = cl.items.filter((i) => !i.critical && !i.ok);

  return (
    <div>
      {/* 1. checklist */}
      <div style={{ border: `1.5px solid ${cl.ready ? GREEN : GOLD}`, borderRadius: 10, padding: 14, background: cl.ready ? '#f3faf4' : '#fffdf6', margin: '6px 0 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <b style={{ color: NAVY, fontSize: 16 }}>Critical items: {cl.done} of {cl.total}</b>
          <div style={{ flex: '1 1 200px', height: 10, background: '#e6e8ef', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: cl.ready ? GREEN : GOLD }} />
          </div>
          <span style={{ fontSize: 13, color: cl.ready ? GREEN : AMBER, fontWeight: 'bold' }}>{cl.ready ? 'Ready — suggested plan below' : `${cl.total - cl.done} left before a plan can be suggested`}</span>
        </div>
        {!cl.ready && (
          <div style={{ marginTop: 10 }}>
            {Object.entries(missingByPage).sort((x, y) => x[0] - y[0]).map(([page, items]) => (
              <div key={page} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', borderBottom: '1px solid #eee', flexWrap: 'wrap' }}>
                <button type="button" style={btn} onClick={() => ctx.goPage?.(Number(page) - 1)}>Page {page} →</button>
                <span style={{ fontSize: 14 }}>{items.map((i) => i.label).join(' · ')}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={() => setShowRec((x) => !x)} style={{ ...btn, border: 0, background: 'transparent', padding: 0, color: TEAL }}>
            {showRec ? '▾' : '▸'} Recommended items ({cl.items.filter((i) => !i.critical && i.ok).length} of {cl.items.filter((i) => !i.critical).length})
          </button>
          {showRec && (
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: '4px 16px' }}>
              {cl.items.filter((i) => !i.critical).map((i) => (
                <div key={i.id} style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ color: i.ok ? GREEN : '#aaa', fontWeight: 'bold' }}>{i.ok ? '✓' : '○'}</span>
                  <span>{i.label}</span>
                  {!i.ok && <button type="button" style={{ ...btn, padding: '1px 7px', fontSize: 11 }} onClick={() => ctx.goPage?.(i.page - 1)}>p{i.page}</button>}
                </div>
              ))}
            </div>
          )}
          {cl.ready && recMissing.length > 0 && <div style={{ fontSize: 12, color: AMBER, marginTop: 4 }}>{recMissing.length} recommended item{recMissing.length === 1 ? '' : 's'} still blank — the plan is stronger with them.</div>}
        </div>
      </div>

      {/* 2. findings */}
      <div style={{ fontWeight: 'bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 1, fontSize: 14, borderLeft: `4px solid ${GOLD}`, paddingLeft: 8, marginBottom: 8 }}>Findings</div>
      {a.problems.length === 0 && <div style={{ color: '#888', fontSize: 14, marginBottom: 12 }}>Findings appear here as ceph values and exam items are entered.</div>}
      {a.problems.map((p, i) => (
        <div key={i} style={{ padding: '7px 0', borderBottom: '1px solid #eceef3' }}>
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fff', background: AREA_COLOR[p.area] || TEAL, borderRadius: 4, padding: '2px 7px', marginRight: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{p.area}</span>
          <b style={{ fontSize: 14 }}>{p.text}</b>
          <Why list={p.because} />
        </div>
      ))}

      {/* 3. plan */}
      <div style={{ fontWeight: 'bold', color: NAVY, textTransform: 'uppercase', letterSpacing: 1, fontSize: 14, borderLeft: `4px solid ${GOLD}`, paddingLeft: 8, margin: '20px 0 8px' }}>Suggested treatment plan</div>
      {!a.plan && <div style={{ color: '#888', fontSize: 14 }}>Complete the critical items above and a suggested plan appears here.</div>}
      {a.plan && (
        <div>
          <div style={{ fontSize: 12, color: '#6a7080', fontStyle: 'italic', marginBottom: 8 }}>
            Built from BSBD's rules and the findings above, for the treating dentist to confirm or change. It is not a diagnosis.
            {a.patient.growing === false ? ' Patient treated as non-growing.' : a.patient.growing ? ' Patient treated as growing.' : ''}
          </div>
          {a.plan.phases.map((ph, i) => (
            <div key={i} style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <b style={{ color: NAVY, fontSize: 15 }}>{ph.name}</b>
                {ph.months && <span style={{ fontSize: 13, color: TEAL, fontWeight: 'bold' }}>≈ {ph.months} months</span>}
              </div>
              {ph.why && <div style={{ fontSize: 12, color: '#6a7080', marginBottom: 4 }}>{ph.why}</div>}
              {ph.steps.map((s, j) => (
                <div key={j} style={{ padding: '5px 0 5px 12px', borderLeft: `3px solid ${GOLD}`, margin: '5px 0' }}>
                  <span style={{ fontSize: 14 }}>{s.text}</span>
                  {s.appliance && <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 'bold', color: NAVY, background: '#eef1f7', borderRadius: 4, padding: '2px 7px' }}>{s.appliance}</span>}
                  <Why list={s.because} />
                </div>
              ))}
            </div>
          ))}
          <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: '10px 12px', marginBottom: 10, background: '#fff' }}>
            <b style={{ color: NAVY, fontSize: 15 }}>Retention</b> <span style={{ fontSize: 13, color: TEAL, fontWeight: 'bold' }}>· {a.plan.retentionMonths} months</span>
            {a.plan.retention.map((r, i) => <div key={i} style={{ padding: '4px 0 4px 12px', borderLeft: `3px solid ${GOLD}`, margin: '4px 0', fontSize: 14 }}>{r.text}<Why list={r.because} /></div>)}
          </div>
          {a.plan.referrals.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <b style={{ color: NAVY }}>Referrals</b>
              {a.plan.referrals.map((r, i) => <div key={i} style={{ fontSize: 14, padding: '3px 0' }}>↗ <b>{r.to}</b> — {r.why}</div>)}
            </div>
          )}
          {a.plan.cautions.length > 0 && (
            <div style={{ background: '#fffaf0', border: '1px solid #e8d5a8', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
              {a.plan.cautions.map((c, i) => <div key={i} style={{ fontSize: 13, color: '#6b4a10', padding: '2px 0' }}>⚠ {c}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <b style={{ color: NAVY }}>Estimated active treatment: {a.plan.months} months</b>
            <button type="button" onClick={usePlan} style={{ background: GOLD, color: NAVY, border: 0, borderRadius: 6, padding: '9px 18px', fontWeight: 'bold', fontSize: 14, cursor: 'pointer', marginLeft: 'auto' }}>
              Use this plan on page {summaryPage + 1}
            </button>
          </div>
          {used && <div style={{ fontSize: 12, color: changed ? AMBER : GREEN, marginTop: 6, textAlign: 'right' }}>
            {changed ? '⚠ Findings changed since the plan was copied. Use it again to update page ' + (summaryPage + 1) + '.' : `✓ Copied to page ${summaryPage + 1}${data.plan_used_by ? ` by ${data.plan_used_by}` : ''} on ${new Date(used).toLocaleDateString()}`}
          </div>}
        </div>
      )}
    </div>
  );
}
