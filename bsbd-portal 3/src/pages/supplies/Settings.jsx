// src/pages/supplies/Settings.jsx
// Managers only: office setup, monthly budgets, vendor details.

import React, { useState } from 'react'
import { money, monthLabel, monthStart, shiftMonth } from '../../lib/suppliesApi'

const ALL_OFFICES = ['Dalton', 'Calhoun', 'Brainerd', 'McCallie']

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 },
  h: { fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: .5 },
  sub: { fontSize: 12, color: '#64748b' },
  input: { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, background: '#fff', width: '100%', boxSizing: 'border-box' },
  label: { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: .4, marginBottom: 4, display: 'block' },
  btn: (kind = 'primary') => ({ padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid transparent', ...(kind === 'primary' ? { background: '#0f766e', color: '#fff' } : { background: '#fff', color: '#334155', borderColor: '#cbd5e1' }) }),
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 13 },
  th: { padding: '6px 8px', borderBottom: '1px solid #e2e8f0', fontSize: 11, color: '#64748b', textTransform: 'uppercase', textAlign: 'left' },
}

function OfficeCard({ row, vendors, onSave, notify }) {
  const [f, setF] = useState({ ...row, requested_for_text: (row.requested_for_options || []).join(', ') })
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const toggleVendor = id => set('vendor_ids', (f.vendor_ids || []).includes(id) ? f.vendor_ids.filter(x => x !== id) : [...(f.vendor_ids || []), id])
  const save = async () => {
    setBusy(true)
    try {
      const { requested_for_text, ...rest } = f
      await onSave({ ...rest, default_budget: f.default_budget === '' || f.default_budget == null ? null : Number(f.default_budget), requested_for_options: requested_for_text.split(',').map(s => s.trim()).filter(Boolean), vendor_ids: f.vendor_ids || [] })
      notify(`${row.office} settings saved`)
    } catch (e) { notify('Save failed: ' + e.message, 'error') }
    setBusy(false)
  }
  return (
    <div style={{ ...S.card, opacity: f.active ? 1 : .6 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{row.office}</div>
        <span style={{ flex: 1 }} />
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f.active !== false} onChange={e => set('active', e.target.checked)} /> Active</label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div><label style={S.label}>Manager email (gets approval requests)</label><input style={S.input} value={f.manager_email || ''} onChange={e => set('manager_email', e.target.value)} placeholder="manager@…" /></div>
        <div><label style={S.label}>Assisting lead</label><input style={S.input} value={f.lead_name || ''} onChange={e => set('lead_name', e.target.value)} /></div>
        <div><label style={S.label}>Default monthly budget ($)</label><input style={S.input} type="number" step="50" value={f.default_budget ?? ''} onChange={e => set('default_budget', e.target.value)} placeholder="e.g. 3500" /></div>
        <div><label style={S.label}>"Requested for" options (comma-separated)</label><input style={S.input} value={f.requested_for_text} onChange={e => set('requested_for_text', e.target.value)} placeholder="Dr. C, Hygiene, Lab, Front desk" /></div>
      </div>
      <div style={{ marginTop: 10 }}>
        <label style={S.label}>Vendors this office orders from <span style={{ fontWeight: 500, textTransform: 'none' }}>(none ticked = all)</span></label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {vendors.filter(v => v.active !== false).map(v => (
            <label key={v.id} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: '#f8fafc', padding: '4px 8px', borderRadius: 6 }}>
              <input type="checkbox" checked={(f.vendor_ids || []).includes(v.id)} onChange={() => toggleVendor(v.id)} /> {v.name}
            </label>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 10 }}><label style={S.label}>Notes</label><input style={S.input} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button style={S.btn()} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></div>
    </div>
  )
}

function BudgetGrid({ settings, budgets, onSaveBudget, notify }) {
  const months = [-2, -1, 0, 1, 2, 3, 4, 5, 6].map(i => shiftMonth(monthStart(), i))
  const [saving, setSaving] = useState(null)
  const existing = (office, m) => budgets.find(b => b.office === office && b.month === m)
  const dflt = office => settings.find(s => s.office === office)?.default_budget
  const commit = async (office, m, value) => {
    const ex = existing(office, m)
    const v = value.trim()
    if ((ex && String(Number(ex.amount)) === v) || (!ex && v === '')) return
    setSaving(`${office}${m}`)
    try { await onSaveBudget({ office, month: m, amount: v, existing: ex }) } catch (e) { notify('Budget save failed: ' + e.message, 'error') }
    setSaving(null)
  }
  return (
    <div style={S.card}>
      <h3 style={S.h}>Monthly budget overrides</h3>
      <div style={{ ...S.sub, marginBottom: 8 }}>Blank cells use the office's default budget (shown faded). Type a number to override a single month; clear it to go back to the default.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', minWidth: 700 }}>
          <thead><tr><th style={S.th}>Office</th>{months.map(m => <th key={m} style={{ ...S.th, textAlign: 'right', background: m === monthStart() ? '#f0fdfa' : undefined }}>{monthLabel(m)}</th>)}</tr></thead>
          <tbody>
            {ALL_OFFICES.map(office => (
              <tr key={office}>
                <td style={{ ...S.td, fontWeight: 700 }}>{office}<div style={S.sub}>default {dflt(office) != null ? money(dflt(office)) : '—'}</div></td>
                {months.map(m => {
                  const ex = existing(office, m)
                  return (
                    <td key={m} style={{ ...S.td, textAlign: 'right', background: m === monthStart() ? '#f0fdfa' : undefined }}>
                      <input key={ex?.amount ?? 'd'} type="number" step="50" defaultValue={ex ? Number(ex.amount) : ''} placeholder={dflt(office) != null ? String(Number(dflt(office))) : '—'}
                        onBlur={e => commit(office, m, e.target.value)}
                        style={{ ...S.input, width: 90, textAlign: 'right', color: ex ? '#0f172a' : '#94a3b8', fontWeight: ex ? 700 : 400, opacity: saving === `${office}${m}` ? .5 : 1 }} />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function VendorCard({ v, onSave, notify }) {
  const [f, setF] = useState({ ...v })
  const [open, setOpen] = useState(!v.id)
  const set = (k, val) => setF(p => ({ ...p, [k]: val }))
  const save = async () => { try { await onSave(f); notify(`${f.name} saved`); setOpen(false) } catch (e) { notify('Save failed: ' + e.message, 'error') } }
  return (
    <div style={{ ...S.card, padding: 12, opacity: f.active === false ? .6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setOpen(o => !o)}>
        <div style={{ fontWeight: 800 }}>{v.name}</div><span style={S.sub}>{v.short_code}</span>
        <span style={{ flex: 1 }} />
        <span style={S.sub}>{v.rep_name || 'no rep on file'}{v.order_method ? ` · ${v.order_method}` : ''}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <div><label style={S.label}>Name</label><input style={S.input} value={f.name || ''} onChange={e => set('name', e.target.value)} /></div>
          <div><label style={S.label}>Short code</label><input style={S.input} value={f.short_code || ''} onChange={e => set('short_code', e.target.value)} /></div>
          <div><label style={S.label}>Order method</label><select style={S.input} value={f.order_method || 'email'} onChange={e => set('order_method', e.target.value)}><option value="email">Email rep</option><option value="portal">Vendor website</option><option value="phone">Phone</option></select></div>
          <div><label style={S.label}>Rep name</label><input style={S.input} value={f.rep_name || ''} onChange={e => set('rep_name', e.target.value)} /></div>
          <div><label style={S.label}>Rep email</label><input style={S.input} value={f.rep_email || ''} onChange={e => set('rep_email', e.target.value)} /></div>
          <div><label style={S.label}>Rep phone</label><input style={S.input} value={f.rep_phone || ''} onChange={e => set('rep_phone', e.target.value)} /></div>
          <div><label style={S.label}>Account #</label><input style={S.input} value={f.account_no || ''} onChange={e => set('account_no', e.target.value)} /></div>
          <div><label style={S.label}>Order website</label><input style={S.input} value={f.order_url || ''} onChange={e => set('order_url', e.target.value)} placeholder="https://…" /></div>
          <div><label style={S.label}>Notes</label><input style={S.input} value={f.notes || ''} onChange={e => set('notes', e.target.value)} /></div>
          <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={f.active !== false} onChange={e => set('active', e.target.checked)} /> Active</label>
            <span style={{ flex: 1 }} />
            <button style={S.btn('ghost')} onClick={() => setOpen(false)}>Cancel</button>
            <button style={S.btn()} onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Settings({ settings, budgets, vendors, onSaveOffice, onSaveBudget, onSaveVendor, notify }) {
  const [newVendor, setNewVendor] = useState(false)
  const rows = ALL_OFFICES.map(o => settings.find(s => s.office === o) || { office: o, active: true, requested_for_options: [], vendor_ids: [] })
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {rows.map(r => <OfficeCard key={r.office} row={r} vendors={vendors} onSave={onSaveOffice} notify={notify} />)}
      </div>
      <BudgetGrid settings={settings} budgets={budgets} onSaveBudget={onSaveBudget} notify={notify} />
      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ ...S.h, margin: 0 }}>Vendors</h3><span style={{ flex: 1 }} />
          <button style={S.btn('ghost')} onClick={() => setNewVendor(true)}>+ Add vendor</button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {newVendor && <VendorCard key="new" v={{ name: '', short_code: '', order_method: 'email', active: true }} onSave={async v => { await onSaveVendor(v); setNewVendor(false) }} notify={notify} />}
          {vendors.map(v => <VendorCard key={v.id} v={v} onSave={onSaveVendor} notify={notify} />)}
        </div>
      </div>
    </div>
  )
}
