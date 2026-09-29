// src/pages/supplies/OrdersMonth.jsx
import React, { useMemo, useState } from 'react'
import { money, monthLabel, shiftMonth, orderToText, STATUS_LABEL, OPEN_STATUSES, loadEvents } from '../../lib/suppliesApi'
import { exportOrderSheet, exportOrderPdf, exportMonthSheet, exportMonthPdf } from '../../lib/suppliesExport'

const ALL_OFFICES = ['Dalton', 'Calhoun', 'Brainerd', 'McCallie']

const STATUS_COLOR = {
  draft: ['#e2e8f0', '#334155'], submitted: ['#fef3c7', '#92400e'], approved: ['#dbeafe', '#1e40af'],
  placed: ['#ede9fe', '#5b21b6'], received: ['#dcfce7', '#166534'], cancelled: ['#fee2e2', '#991b1b'],
}

const S = {
  input: { padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, background: '#fff' },
  btn: (kind = 'primary') => ({
    padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid transparent',
    ...(kind === 'primary' ? { background: '#0f766e', color: '#fff' }
      : kind === 'ghost'   ? { background: '#fff', color: '#334155', borderColor: '#cbd5e1' }
      : kind === 'danger'  ? { background: '#fff', color: '#b91c1c', borderColor: '#fecaca' }
      : { background: '#e2e8f0', color: '#334155' }),
  }),
  tab: on => ({ padding: '8px 14px', borderRadius: 8, border: 'none', background: on ? '#0f172a' : 'transparent', color: on ? '#fff' : '#475569', fontWeight: 700, fontSize: 13, cursor: 'pointer' }),
  td: { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 14, verticalAlign: 'middle' },
}

const Badge = ({ status }) => {
  const [bg, fg] = STATUS_COLOR[status] || STATUS_COLOR.draft
  return <span style={{ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: .4 }}>{STATUS_LABEL[status] || status}</span>
}

function EventLog({ orderId }) {
  const [events, setEvents] = useState(null)
  React.useEffect(() => { loadEvents(orderId).then(setEvents).catch(() => setEvents([])) }, [orderId])
  if (!events) return <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading history…</div>
  if (!events.length) return <div style={{ fontSize: 12, color: '#94a3b8' }}>No activity yet.</div>
  return (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#475569', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {events.map(e => (
        <li key={e.id}>
          <span style={{ color: '#94a3b8' }}>{new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
          {' · '}<b>{e.actor || '—'}</b> {e.event.replace('_', ' ')}
          {e.payload?.description ? ` — ${e.payload.description}${e.payload.qty ? ` ×${e.payload.qty}` : ''}` : ''}
          {e.payload?.from != null ? ` ${e.payload.from} → ${e.payload.to}` : ''}
          {e.payload?.notes ? ` — "${e.payload.notes}"` : ''}
          {e.payload?.vendor_order_no ? ` — #${e.payload.vendor_order_no}` : ''}
        </li>
      ))}
    </ul>
  )
}

function OrderCard({ order, lines, itemsById, vendor, user, isManager, onQty, onRemove, onStatus, onReceive, onBudget, notify }) {
  const [open, setOpen] = useState(order.status !== 'received' && order.status !== 'cancelled')
  const [showLog, setShowLog] = useState(false)
  const [sendBack, setSendBack] = useState(false)
  const [note, setNote] = useState('')
  const [vendorNo, setVendorNo] = useState(order.vendor_order_no || '')
  const [receiving, setReceiving] = useState(false)
  const [busy, setBusy] = useState(false)

  const isOpen = OPEN_STATUSES.includes(order.status)
  const total = lines.reduce((s, l) => s + l.qty * (Number(l.unit_price) || 0), 0)
  const cap = order.budget_cap != null ? Number(order.budget_cap) : null
  const capState = cap == null ? null : total > cap ? 'over' : total >= cap * 0.9 ? 'near' : 'ok'
  const shortLines = lines.filter(l => l.received_qty != null && l.received_qty < l.qty)

  const run = async (fn, okMsg) => {
    setBusy(true)
    try { await fn(); if (okMsg) notify(okMsg) }
    catch (e) { notify(e.message, 'error') }
    finally { setBusy(false) }
  }

  const copyOrder = async () => {
    const text = orderToText(order, lines, itemsById, vendor)
    try { await navigator.clipboard.writeText(text); notify('Order copied — paste it into the vendor site or email') }
    catch { window.prompt('Copy this order:', text) }
  }
  const exportAs = kind => {
    try {
      if (kind === 'pdf') exportOrderPdf(order, lines, itemsById, vendor)
      else exportOrderSheet(order, lines, itemsById, vendor, kind)
    } catch (e) { notify('Download failed: ' + e.message, 'error') }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer', background: open ? '#f8fafc' : '#fff' }}>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{vendor?.name || 'Vendor'}</div>
        <Badge status={order.status} />
        <span style={{ fontSize: 13, color: '#64748b' }}>{lines.length} line{lines.length === 1 ? '' : 's'}</span>
        {shortLines.length > 0 && <span style={{ fontSize: 12, color: '#b45309', fontWeight: 700 }}>⚠ {shortLines.length} short</span>}
        <span style={{ flex: 1 }} />
        {cap != null && <span style={{ fontSize: 12, color: capState === 'over' ? '#b91c1c' : capState === 'near' ? '#b45309' : '#64748b', fontWeight: 600 }}>cap {money(cap)}</span>}
        <div style={{ fontWeight: 800, fontSize: 16, color: capState === 'over' ? '#b91c1c' : capState === 'near' ? '#b45309' : '#0f172a' }}>{money(total)}</div>
      </div>

      {open && (
        <div style={{ padding: '0 16px 14px' }}>
          {order.notes && order.status === 'draft' && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: 13, margin: '8px 0' }}><b>Sent back:</b> {order.notes}</div>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase' }}>
              <th style={{ ...S.td, textAlign: 'left' }}>Item</th><th style={{ ...S.td, textAlign: 'left' }}>SKU</th><th style={{ ...S.td, textAlign: 'left' }}>For / by</th>
              <th style={{ ...S.td, textAlign: 'right' }}>Unit</th><th style={{ ...S.td, textAlign: 'center' }}>Qty</th>
              {(receiving || order.status === 'received') && <th style={{ ...S.td, textAlign: 'center' }}>Rec'd</th>}
              <th style={{ ...S.td, textAlign: 'right' }}>Total</th><th style={S.td}></th>
            </tr></thead>
            <tbody>
              {lines.map(l => {
                const it = itemsById[l.item_id] || { description: '(item removed from formulary)' }
                const short = l.received_qty != null && l.received_qty < l.qty
                const canEditLine = isOpen && (isManager || order.status === 'draft')
                return (
                  <tr key={l.id} style={short ? { background: '#fffbeb' } : undefined}>
                    <td style={S.td}>{it.description}</td>
                    <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>{it.vendor_item_no || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#64748b' }}>{l.requested_for ? <b>{l.requested_for}</b> : null}{l.requested_for && l.requested_by ? ' · ' : ''}{l.requested_by}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>{l.unit_price != null ? money(l.unit_price) : '—'}</td>
                    <td style={{ ...S.td, textAlign: 'center' }}>
                      {canEditLine
                        ? <input style={{ ...S.input, width: 56, textAlign: 'center' }} defaultValue={l.qty} key={l.qty}
                            onBlur={e => { const q = parseInt(e.target.value, 10); if (q && q !== l.qty) run(() => onQty(l, q)) }} />
                        : l.qty}
                    </td>
                    {(receiving || order.status === 'received') && (
                      <td style={{ ...S.td, textAlign: 'center' }}>
                        {receiving
                          ? <input style={{ ...S.input, width: 56, textAlign: 'center' }} defaultValue={l.received_qty ?? l.qty} onBlur={e => run(() => onReceive(l, e.target.value))} />
                          : <span style={{ color: short ? '#b45309' : '#166534', fontWeight: 700 }}>{l.received_qty ?? '—'}</span>}
                      </td>
                    )}
                    <td style={{ ...S.td, textAlign: 'right', fontWeight: 600 }}>{money(l.qty * (Number(l.unit_price) || 0))}</td>
                    <td style={{ ...S.td, textAlign: 'right' }}>
                      {canEditLine && <button style={S.btn('danger')} disabled={busy} onClick={() => run(() => onRemove(l))}>Remove</button>}
                    </td>
                  </tr>
                )
              })}
              {lines.length === 0 && <tr><td colSpan={8} style={{ ...S.td, color: '#94a3b8', textAlign: 'center' }}>No lines yet — add items from the Formulary tab.</td></tr>}
            </tbody>
          </table>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
            <button style={S.btn('ghost')} onClick={copyOrder} disabled={!lines.length}>Copy order</button>
            <button style={S.btn('ghost')} onClick={() => exportAs('xlsx')} disabled={!lines.length}>Excel</button>
            <button style={S.btn('ghost')} onClick={() => exportAs('pdf')} disabled={!lines.length}>PDF</button>
            <button style={S.btn('ghost')} onClick={() => setShowLog(v => !v)}>{showLog ? 'Hide history' : 'History'}</button>
            {isManager && isOpen && (
              <label style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>Budget cap
                <input style={{ ...S.input, width: 90 }} type="number" defaultValue={order.budget_cap ?? ''} onBlur={e => run(() => onBudget(order, e.target.value))} />
              </label>
            )}
            <span style={{ flex: 1 }} />

            {order.status === 'draft' && lines.length > 0 && (
              <button style={S.btn()} disabled={busy} onClick={() => run(() => onStatus(order, 'submitted'), 'Order submitted for approval')}>Submit for approval</button>
            )}
            {order.status === 'submitted' && isManager && !sendBack && <>
              <button style={S.btn('ghost')} disabled={busy} onClick={() => setSendBack(true)}>Send back</button>
              <button style={S.btn()} disabled={busy} onClick={() => run(() => onStatus(order, 'approved'), 'Order approved')}>Approve</button>
            </>}
            {order.status === 'submitted' && !isManager && <span style={{ fontSize: 13, color: '#92400e' }}>Waiting for approval · submitted by {order.submitted_by}</span>}
            {order.status === 'approved' && isManager && <>
              <input style={{ ...S.input, width: 150 }} placeholder="Vendor order #" value={vendorNo} onChange={e => setVendorNo(e.target.value)} />
              <button style={S.btn()} disabled={busy} onClick={() => run(() => onStatus(order, 'placed', { vendor_order_no: vendorNo || null }), 'Marked as placed')}>Mark placed</button>
            </>}
            {order.status === 'placed' && !receiving && <button style={S.btn()} onClick={() => setReceiving(true)}>Receive shipment</button>}
            {order.status === 'placed' && receiving && <>
              <button style={S.btn('ghost')} onClick={() => setReceiving(false)}>Cancel</button>
              <button style={S.btn()} disabled={busy} onClick={() => run(() => onStatus(order, 'received'), 'Order received')}>Finish receiving</button>
            </>}
            {isManager && isOpen && <button style={S.btn('danger')} disabled={busy} onClick={() => window.confirm('Cancel this order?') && run(() => onStatus(order, 'cancelled'), 'Order cancelled')}>Cancel order</button>}
          </div>

          {sendBack && (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input style={{ ...S.input, flex: 1 }} placeholder="What needs to change?" value={note} onChange={e => setNote(e.target.value)} autoFocus />
              <button style={S.btn('ghost')} onClick={() => setSendBack(false)}>Cancel</button>
              <button style={S.btn()} disabled={!note.trim() || busy} onClick={() => run(() => onStatus(order, 'draft', { notes: note.trim() }), 'Sent back to the office').then(() => setSendBack(false))}>Send back</button>
            </div>
          )}
          {showLog && <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px dashed #e2e8f0' }}><EventLog orderId={order.id} /></div>}
        </div>
      )}
    </div>
  )
}

export default function OrdersMonth({ month, setMonth, orders, lines, itemsById, vendorsById, user, isManager, office, setOffice, canSwitchOffice, onQty, onRemove, onStatus, onReceive, onBudget, notify }) {
  const offices = canSwitchOffice ? ALL_OFFICES : [user.office].filter(Boolean)
  const view = canSwitchOffice ? office : user.office

  const byOffice = useMemo(() => {
    const m = Object.fromEntries(ALL_OFFICES.map(o => [o, []]))
    orders.forEach(o => { (m[o.office] = m[o.office] || []).push(o) })
    return m
  }, [orders])
  const linesByOrder = useMemo(() => {
    const m = {}
    lines.forEach(l => { (m[l.order_id] = m[l.order_id] || []).push(l) })
    return m
  }, [lines])

  const officeTotal = o => (byOffice[o] || []).filter(x => x.status !== 'cancelled')
    .reduce((s, ord) => s + (linesByOrder[ord.id] || []).reduce((t, l) => t + l.qty * (Number(l.unit_price) || 0), 0), 0)

  const list = byOffice[view] || []
  const hasLines = list.some(o => (linesByOrder[o.id] || []).length)

  const downloadMonth = kind => {
    try {
      if (kind === 'pdf') exportMonthPdf(view, month, orders, linesByOrder, itemsById, vendorsById)
      else exportMonthSheet(view, month, orders, linesByOrder, itemsById, vendorsById, kind)
    } catch (e) { notify('Download failed: ' + e.message, 'error') }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <button style={S.btn('ghost')} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <div style={{ fontWeight: 800, fontSize: 16, minWidth: 90, textAlign: 'center' }}>{monthLabel(month)}</div>
        <button style={S.btn('ghost')} onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
        <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Download {view} month:</span>
        <button style={S.btn('ghost')} disabled={!hasLines} onClick={() => downloadMonth('xlsx')}>Excel</button>
        <button style={S.btn('ghost')} disabled={!hasLines} onClick={() => downloadMonth('pdf')}>PDF</button>
        <span style={{ flex: 1 }} />
        {offices.map(o => (
          <button key={o} style={S.tab(view === o)} onClick={() => canSwitchOffice && setOffice(o)}>
            {o} <span style={{ opacity: .7, fontWeight: 500 }}>{money(officeTotal(o))}</span>
          </button>
        ))}
      </div>

      {list.length === 0 && (
        <div style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 12, padding: 32, textAlign: 'center', color: '#64748b', fontSize: 14 }}>
          No {view} orders for {monthLabel(month)} yet. Add items from the Formulary tab and an order is created for each vendor automatically.
        </div>
      )}
      {list.map(o => (
        <OrderCard key={o.id} order={o} lines={linesByOrder[o.id] || []} itemsById={itemsById} vendor={vendorsById[o.vendor_id]}
          user={user} isManager={isManager} onQty={onQty} onRemove={onRemove} onStatus={onStatus} onReceive={onReceive} onBudget={onBudget} notify={notify} />
      ))}
    </div>
  )
}
