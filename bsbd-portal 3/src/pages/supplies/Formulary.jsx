// src/pages/supplies/Formulary.jsx
import React, { useMemo, useState } from 'react'
import { money } from '../../lib/suppliesApi'

const ALL_OFFICES = ['Dalton', 'Calhoun', 'Brainerd', 'McCallie']

const S = {
  input: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, background: '#fff' },
  chip:  on => ({ padding: '6px 10px', borderRadius: 999, border: '1px solid ' + (on ? '#0f766e' : '#e2e8f0'), background: on ? '#0f766e' : '#fff', color: on ? '#fff' : '#334155', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }),
  btn:   (kind = 'primary') => ({
    padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid transparent',
    ...(kind === 'primary' ? { background: '#0f766e', color: '#fff' }
      : kind === 'ghost'   ? { background: '#fff', color: '#334155', borderColor: '#cbd5e1' }
      : kind === 'danger'  ? { background: '#fff', color: '#b91c1c', borderColor: '#fecaca' }
      : { background: '#e2e8f0', color: '#334155' }),
  }),
  th:    { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, color: '#64748b', padding: '8px 10px', borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, background: '#f8fafc' },
  td:    { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 14, verticalAlign: 'middle' },
}

function ItemEditor({ item, vendors, onSave, onCancel }) {
  const [f, setF] = useState({
    description: item?.description || '', vendor_id: item?.vendor_id || '', vendor_item_no: item?.vendor_item_no || '',
    mfr_item_no: item?.mfr_item_no || '', category: item?.category || '', unit_price: item?.unit_price ?? '',
    pack_size: item?.pack_size || '', offices: item?.offices || ALL_OFFICES, notes: item?.notes || '', active: item?.active !== false,
  })
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const toggleOffice = o => set('offices', f.offices.includes(o) ? f.offices.filter(x => x !== o) : [...f.offices, o])
  return (
    <tr>
      <td colSpan={6} style={{ ...S.td, background: '#f0fdfa' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <input style={S.input} placeholder="Description" value={f.description} onChange={e => set('description', e.target.value)} />
          <select style={S.input} value={f.vendor_id} onChange={e => set('vendor_id', e.target.value)}>
            <option value="">Vendor…</option>
            {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <input style={S.input} placeholder="Vendor SKU" value={f.vendor_item_no} onChange={e => set('vendor_item_no', e.target.value)} />
          <input style={S.input} placeholder="Mfr #" value={f.mfr_item_no} onChange={e => set('mfr_item_no', e.target.value)} />
          <input style={S.input} placeholder="Unit price" type="number" step="0.01" value={f.unit_price} onChange={e => set('unit_price', e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8, marginBottom: 8 }}>
          <input style={S.input} placeholder="Category" value={f.category} onChange={e => set('category', e.target.value)} list="supply-categories" />
          <input style={S.input} placeholder="Pack size" value={f.pack_size} onChange={e => set('pack_size', e.target.value)} />
          <input style={S.input} placeholder="Notes (Dr. C only, lab use…)" value={f.notes} onChange={e => set('notes', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Offices:</span>
          {ALL_OFFICES.map(o => (
            <label key={o} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={f.offices.includes(o)} onChange={() => toggleOffice(o)} /> {o}
            </label>
          ))}
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
            <input type="checkbox" checked={f.active} onChange={e => set('active', e.target.checked)} /> Active
          </label>
          <span style={{ flex: 1 }} />
          <button style={S.btn('ghost')} onClick={onCancel}>Cancel</button>
          <button style={S.btn()} disabled={!f.description || !f.category} onClick={() => onSave({ ...item, ...f })}>Save item</button>
        </div>
      </td>
    </tr>
  )
}

function Row({ item, vendor, inCart, onAdd, canEdit, onEdit, reqOptions }) {
  const [qty, setQty] = useState(1)
  const [reqFor, setReqFor] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    setBusy(true)
    try { await onAdd(item, qty, reqFor); setQty(1); setReqFor('') } finally { setBusy(false) }
  }
  return (
    <tr style={inCart ? { background: '#f0fdf4' } : undefined}>
      <td style={S.td}>
        <div style={{ fontWeight: 600, color: '#0f172a' }}>{item.description}</div>
        {(item.pack_size || item.notes) && <div style={{ fontSize: 12, color: '#64748b' }}>{[item.pack_size, item.notes].filter(Boolean).join(' · ')}</div>}
      </td>
      <td style={S.td}><span style={{ fontSize: 13 }}>{vendor?.short_code || vendor?.name || '—'}</span></td>
      <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 13, color: '#475569' }}>{item.vendor_item_no || item.mfr_item_no || '—'}</td>
      <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{item.unit_price != null ? money(item.unit_price) : <span style={{ color: '#94a3b8' }}>—</span>}</td>
      <td style={{ ...S.td, whiteSpace: 'nowrap' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={S.btn('ghost')} onClick={() => setQty(q => Math.max(1, q - 1))}>−</button>
          <input style={{ ...S.input, width: 48, textAlign: 'center', padding: '6px 4px' }} value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value, 10) || 1))} />
          <button style={S.btn('ghost')} onClick={() => setQty(q => q + 1)}>+</button>
          <input style={{ ...S.input, width: 110, padding: '6px 8px', fontSize: 12 }} placeholder="for (optional)" value={reqFor} onChange={e => setReqFor(e.target.value)} list={reqOptions?.length ? 'supply-req-for' : undefined} />
        </div>
      </td>
      <td style={{ ...S.td, whiteSpace: 'nowrap', textAlign: 'right' }}>
        <button style={S.btn()} disabled={busy} onClick={add}>{busy ? '…' : inCart ? `Add (${inCart} in order)` : 'Add'}</button>
        {canEdit && <button style={{ ...S.btn('ghost'), marginLeft: 6 }} title="Edit item" onClick={() => onEdit(item)}>✎</button>}
      </td>
    </tr>
  )
}

export default function Formulary({ items, vendors, office, setOffice, canSwitchOffice, cartQtyByItem, onAdd, isManager, onSaveItem, notify, officeSettings }) {
  const reqOptions = officeSettings?.requested_for_options || []
  const officeVendorIds = officeSettings?.vendor_ids || []
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editing, setEditing] = useState(null)   // item being edited, or 'new'

  const vendorsById = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v])), [vendors])

  const officeItems = useMemo(() => items.filter(it =>
    it.active !== false
    && (!office || !it.offices?.length || it.offices.includes(office))
    && (!officeVendorIds.length || !it.vendor_id || officeVendorIds.includes(it.vendor_id))
  ), [items, office, officeVendorIds])
  const categories = useMemo(() => {
    const seen = []
    officeItems.forEach(it => { if (it.category && !seen.includes(it.category)) seen.push(it.category) })
    return seen
  }, [officeItems])

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return officeItems.filter(it => {
      if (cat && it.category !== cat) return false
      if (!needle) return true
      const v = vendorsById[it.vendor_id]
      return [it.description, it.vendor_item_no, it.mfr_item_no, it.category, it.notes, v?.name, v?.short_code]
        .some(s => (s || '').toLowerCase().includes(needle))
    })
  }, [officeItems, q, cat, vendorsById])

  const grouped = useMemo(() => {
    const m = new Map()
    visible.forEach(it => { const k = it.category || 'Uncategorized'; if (!m.has(k)) m.set(k, []); m.get(k).push(it) })
    return [...m.entries()]
  }, [visible])

  const save = async f => {
    try { await onSaveItem(f); setEditing(null); notify('Formulary item saved') }
    catch (e) { notify('Save failed: ' + e.message, 'error') }
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <datalist id="supply-categories">{categories.map(c => <option key={c} value={c} />)}</datalist>
      <datalist id="supply-req-for">{reqOptions.map(o => <option key={o} value={o} />)}</datalist>

      {/* Category rail */}
      <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto' }}>
        <button style={S.chip(!cat)} onClick={() => setCat('')}>All categories <span style={{ opacity: .7 }}>({officeItems.length})</span></button>
        {categories.map(c => (
          <button key={c} style={S.chip(cat === c)} onClick={() => setCat(cat === c ? '' : c)}>{c}</button>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
          <input style={{ ...S.input, flex: 1, minWidth: 220 }} placeholder="Search description, SKU, vendor, category…" value={q} onChange={e => setQ(e.target.value)} autoFocus />
          {canSwitchOffice
            ? <select style={S.input} value={office} onChange={e => setOffice(e.target.value)}>{ALL_OFFICES.map(o => <option key={o}>{o}</option>)}</select>
            : <span style={{ fontSize: 13, fontWeight: 700, color: '#0f766e', padding: '8px 12px', background: '#f0fdfa', borderRadius: 8 }}>{office}</span>}
          {isManager && (
            <button style={S.btn(editMode ? 'primary' : 'ghost')} onClick={() => { setEditMode(v => !v); setEditing(null) }}>
              {editMode ? 'Done editing' : 'Edit formulary'}
            </button>
          )}
          {editMode && <button style={S.btn('ghost')} onClick={() => setEditing('new')}>+ Add item</button>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={S.th}>Item</th>
                <th style={S.th}>Vendor</th>
                <th style={S.th}>SKU</th>
                <th style={{ ...S.th, textAlign: 'right' }}>Unit</th>
                <th style={S.th}>Qty · requested for</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {editing === 'new' && <ItemEditor item={{ offices: ALL_OFFICES, category: cat }} vendors={vendors} onSave={save} onCancel={() => setEditing(null)} />}
              {grouped.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, color: '#64748b', textAlign: 'center', padding: 32 }}>No items match.</td></tr>
              )}
              {grouped.map(([category, list]) => (
                <React.Fragment key={category}>
                  <tr><td colSpan={6} style={{ ...S.td, background: '#f8fafc', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: .5, color: '#475569' }}>{category} <span style={{ fontWeight: 500 }}>({list.length})</span></td></tr>
                  {list.map(it => editing && editing !== 'new' && editing.id === it.id
                    ? <ItemEditor key={it.id} item={it} vendors={vendors} onSave={save} onCancel={() => setEditing(null)} />
                    : <Row key={it.id} item={it} vendor={vendorsById[it.vendor_id]} inCart={cartQtyByItem[it.id]} onAdd={onAdd} canEdit={editMode} onEdit={setEditing} reqOptions={reqOptions} />
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
