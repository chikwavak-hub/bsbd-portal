// src/lib/suppliesApi.js
// Supplies ordering — data layer. Uses the portal's existing REST wrapper
// (sbGet / sbPost / sbDel) so it needs no new client code. IDs are generated
// here, the same way tc_patients rows are.

import { sbGet, sbPost, sbDel } from './supabase'

export const OPEN_STATUSES = ['draft', 'submitted']
export const STATUS_LABEL = {
  draft: 'Draft', submitted: 'Submitted', approved: 'Approved',
  placed: 'Placed', received: 'Received', cancelled: 'Cancelled',
}

const uuid = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
      })

const nowIso = () => new Date().toISOString()

// ── Month helpers ────────────────────────────────────────────────────────
export const monthStart = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

export const shiftMonth = (ym, delta) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return monthStart(d)
}

export const monthLabel = ym => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: 'numeric' })
}

export const money = n => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Reads ────────────────────────────────────────────────────────────────
export const loadVendors = () =>
  sbGet('supply_vendors', 'select=*&order=name')

export const loadItems = (includeInactive = false) =>
  sbGet('supply_items', `select=*${includeInactive ? '' : '&active=eq.true'}&order=category,description&limit=5000`)

export async function loadMonth(month) {
  const orders = await sbGet('supply_orders', `order_month=eq.${month}&select=*&order=office,created_at`)
  if (!orders.length) return { orders: [], lines: [] }
  const ids = orders.map(o => o.id).join(',')
  const lines = await sbGet('supply_order_lines', `order_id=in.(${ids})&select=*&order=created_at`)
  return { orders, lines }
}

export const loadEvents = orderId =>
  sbGet('supply_order_events', `order_id=eq.${orderId}&select=*&order=created_at.desc&limit=100`)

// ── Writes ───────────────────────────────────────────────────────────────
const logEvent = (orderId, actor, event, payload = {}) =>
  sbPost('supply_order_events', { order_id: orderId, actor, event, payload })

/**
 * The Add button. Finds or creates the open order for (office, item's vendor,
 * month) and adds qty to the line for that item. Returns { order, line, created }.
 */
export async function addToOrder({ office, item, qty, requestedFor, user, month }) {
  qty = Math.max(1, parseInt(qty, 10) || 1)
  const actor = user?.name || user?.username || 'unknown'

  let [order] = await sbGet('supply_orders',
    `office=eq.${office}&vendor_id=eq.${item.vendor_id}&order_month=eq.${month}&select=*`)

  let created = false
  if (!order) {
    order = {
      id: uuid(), office, vendor_id: item.vendor_id, order_month: month,
      status: 'draft', created_by: actor, created_at: nowIso(), updated_at: nowIso(),
    }
    await sbPost('supply_orders', order)
    created = true
  } else if (!OPEN_STATUSES.includes(order.status)) {
    const err = new Error(`${office} · ${monthLabel(month)} order is already ${order.status}`)
    err.code = 'ORDER_CLOSED'; err.order = order
    throw err
  }

  let [line] = await sbGet('supply_order_lines', `order_id=eq.${order.id}&item_id=eq.${item.id}&select=*`)
  if (line) {
    line = { ...line, qty: line.qty + qty, requested_for: requestedFor || line.requested_for, updated_at: nowIso() }
    await sbPost('supply_order_lines', line, true)
  } else {
    line = {
      id: uuid(), order_id: order.id, item_id: item.id, qty,
      unit_price: item.unit_price ?? null, requested_by: actor,
      requested_for: requestedFor || null, created_at: nowIso(), updated_at: nowIso(),
    }
    await sbPost('supply_order_lines', line)
  }
  await logEvent(order.id, actor, 'line_added', { item_id: item.id, description: item.description, qty })
  return { order, line, created }
}

export async function updateLineQty(line, qty, user) {
  qty = Math.max(1, parseInt(qty, 10) || 1)
  const next = { ...line, qty, updated_at: nowIso() }
  await sbPost('supply_order_lines', next, true)
  await logEvent(line.order_id, user?.name, 'qty_changed', { item_id: line.item_id, from: line.qty, to: qty })
  return next
}

export async function removeLine(line, user) {
  await sbDel('supply_order_lines', `id=eq.${line.id}`)
  await logEvent(line.order_id, user?.name, 'line_removed', { item_id: line.item_id, qty: line.qty })
}

export async function receiveLine(line, receivedQty) {
  const next = { ...line, received_qty: Math.max(0, parseInt(receivedQty, 10) || 0), updated_at: nowIso() }
  await sbPost('supply_order_lines', next, true)
  return next
}

/**
 * Status transitions. `extra` carries vendor_order_no on place, notes on send-back.
 */
export async function setOrderStatus(order, status, user, extra = {}) {
  const actor = user?.name || 'unknown'
  const t = nowIso()
  const patch = { ...order, status, updated_at: t, ...extra }
  if (status === 'submitted') { patch.submitted_by = actor; patch.submitted_at = t }
  if (status === 'approved')  { patch.approved_by = actor;  patch.approved_at = t }
  if (status === 'placed')    { patch.placed_at = t }
  if (status === 'received')  { patch.received_at = t }
  if (status === 'draft' && order.status === 'submitted') { patch.submitted_by = null; patch.submitted_at = null }
  await sbPost('supply_orders', patch, true)
  const event = status === 'draft' && order.status === 'submitted' ? 'sent_back' : status
  await logEvent(order.id, actor, event, extra)
  return patch
}

export async function saveBudgetCap(order, cap) {
  const patch = { ...order, budget_cap: cap === '' || cap == null ? null : Number(cap), updated_at: nowIso() }
  await sbPost('supply_orders', patch, true)
  return patch
}

// ── Formulary maintenance (managers) ────────────────────────────────────
export async function saveItem(item) {
  const row = {
    ...item,
    id: item.id || uuid(),
    unit_price: item.unit_price === '' || item.unit_price == null ? null : Number(item.unit_price),
    offices: Array.isArray(item.offices) && item.offices.length ? item.offices : ['Dalton', 'Calhoun', 'Brainerd', 'McCallie'],
    active: item.active !== false,
    updated_at: nowIso(),
    created_at: item.created_at || nowIso(),
  }
  await sbPost('supply_items', row, true)
  return row
}

export const deactivateItem = item => saveItem({ ...item, active: false })

// ── Export text for the vendor ───────────────────────────────────────────
export function orderToText(order, lines, itemsById, vendor) {
  const rows = lines
    .map(l => ({ l, it: itemsById[l.item_id] }))
    .filter(x => x.it)
    .sort((a, b) => (a.it.category || '').localeCompare(b.it.category || '') || a.it.description.localeCompare(b.it.description))
  const head = `Beautiful Smiles by Design — ${order.office} office\n${vendor?.name || ''} order · ${monthLabel(order.order_month)}\n\n`
  const body = rows.map(({ l, it }) => `${it.vendor_item_no || '—'}\t${l.qty}\t${it.description}`).join('\n')
  const total = rows.reduce((s, { l }) => s + l.qty * (Number(l.unit_price) || 0), 0)
  return `${head}${body}\n\nLines: ${rows.length}   Est. total: ${money(total)}`
}
