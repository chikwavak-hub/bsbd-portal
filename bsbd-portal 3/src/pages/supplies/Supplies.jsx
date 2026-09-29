// src/pages/supplies/Supplies.jsx
// Supplies module: Formulary (click-and-add) + This month's orders.
// Single-page module like RecallTracker — no sidebar, `goHome` returns to ModuleHome.

import React, { useEffect, useMemo, useState } from 'react'
import Formulary from './Formulary'
import OrdersMonth from './OrdersMonth'
import {
  loadVendors, loadItems, loadMonth, addToOrder, updateLineQty, removeLine, receiveLine,
  setOrderStatus, saveBudgetCap, saveItem, monthStart, monthLabel, money,
} from '../../lib/suppliesApi'

const S = {
  tab: on => ({ padding: '8px 16px', borderRadius: 8, border: 'none', background: on ? '#0f766e' : '#fff', color: on ? '#fff' : '#334155', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: on ? 'none' : 'inset 0 0 0 1px #e2e8f0', position: 'relative' }),
  btn:  { padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', color: '#334155' },
}

export default function SuppliesPage({ user, isManager, goHome, notify }) {
  const canSwitchOffice = isManager || !user.office
  const [office, setOffice]   = useState(user.office || 'Dalton')
  const [tab, setTab]         = useState('formulary')       // 'formulary' | 'orders'
  const [month, setMonth]     = useState(monthStart())
  const [vendors, setVendors] = useState([])
  const [items, setItems]     = useState([])
  const [orders, setOrders]   = useState([])
  const [lines, setLines]     = useState([])
  const [ready, setReady]     = useState(false)
  const [loadingMonth, setLoadingMonth] = useState(false)

  // ── Loads ────────────────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [v, it] = await Promise.all([loadVendors(), loadItems(isManager)])
        setVendors(v); setItems(it)
      } catch (e) { notify('Could not load the formulary: ' + e.message, 'error') }
      setReady(true)
    })()
  }, [])

  const refreshMonth = async (m = month) => {
    setLoadingMonth(true)
    try { const { orders, lines } = await loadMonth(m); setOrders(orders); setLines(lines) }
    catch (e) { notify('Could not load orders: ' + e.message, 'error') }
    setLoadingMonth(false)
  }
  useEffect(() => { refreshMonth(month) }, [month])

  // ── Derived ──────────────────────────────────────────────────────────
  const itemsById   = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const vendorsById = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v])), [vendors])
  const currentMonth = monthStart()

  // qty per item already on this office's open orders for the *current* month (drives the "3 in order" hint)
  const cartQtyByItem = useMemo(() => {
    const openIds = new Set(orders.filter(o => o.office === office && o.order_month === currentMonth && ['draft', 'submitted'].includes(o.status)).map(o => o.id))
    const m = {}
    lines.forEach(l => { if (openIds.has(l.order_id)) m[l.item_id] = (m[l.item_id] || 0) + l.qty })
    return m
  }, [orders, lines, office, currentMonth])

  const openLineCount = useMemo(() => {
    const openIds = new Set(orders.filter(o => o.office === office && ['draft', 'submitted'].includes(o.status)).map(o => o.id))
    return lines.filter(l => openIds.has(l.order_id)).length
  }, [orders, lines, office])

  // ── Handlers ─────────────────────────────────────────────────────────
  const handleAdd = async (item, qty, requestedFor) => {
    if (month !== currentMonth) setMonth(currentMonth)  // Add always targets the current month
    try {
      const { order, created } = await addToOrder({ office, item, qty, requestedFor, user, month: currentMonth })
      await refreshMonth(currentMonth)
      const v = vendorsById[item.vendor_id]
      notify(`${item.description} ×${qty} added to ${office} · ${v?.short_code || v?.name || 'vendor'} · ${monthLabel(currentMonth)}${created ? ' (new order started)' : ''}`)
    } catch (e) {
      if (e.code === 'ORDER_CLOSED') notify(`${e.message}. Ask a manager to reopen it, or it will go on next month's order.`, 'error')
      else notify('Add failed: ' + e.message, 'error')
    }
  }

  const handleQty     = async (line, qty)  => { await updateLineQty(line, qty, user); await refreshMonth() }
  const handleRemove  = async line         => { await removeLine(line, user); await refreshMonth() }
  const handleReceive = async (line, q)    => { await receiveLine(line, q); await refreshMonth() }
  const handleStatus  = async (order, status, extra) => { await setOrderStatus(order, status, user, extra); await refreshMonth() }
  const handleBudget  = async (order, cap) => { await saveBudgetCap(order, cap); await refreshMonth() }
  const handleSaveItem = async f => {
    const row = await saveItem({ ...f, vendor_id: f.vendor_id || null })
    setItems(prev => prev.some(i => i.id === row.id) ? prev.map(i => i.id === row.id ? row : i) : [...prev, row])
  }

  // ── Render ───────────────────────────────────────────────────────────
  if (!ready) {
    return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>
  }

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button style={S.btn} onClick={goHome}>← Home</button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a' }}>Supplies</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{items.filter(i => i.active !== false).length} items on the formulary · signed in as {user.name}{user.office ? ` · ${user.office}` : ''}</div>
        </div>
        <span style={{ flex: 1 }} />
        <button style={S.tab(tab === 'formulary')} onClick={() => setTab('formulary')}>Formulary</button>
        <button style={S.tab(tab === 'orders')} onClick={() => setTab('orders')}>
          This month's orders
          {openLineCount > 0 && <span style={{ marginLeft: 8, background: tab === 'orders' ? '#fff' : '#0f766e', color: tab === 'orders' ? '#0f766e' : '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>{openLineCount}</span>}
        </button>
        <button style={S.btn} onClick={() => refreshMonth()} disabled={loadingMonth}>{loadingMonth ? '…' : 'Refresh'}</button>
      </div>

      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === 'formulary' && (
          <Formulary items={items} vendors={vendors} office={office} setOffice={setOffice} canSwitchOffice={canSwitchOffice}
            cartQtyByItem={cartQtyByItem} onAdd={handleAdd} isManager={isManager} onSaveItem={handleSaveItem} notify={notify} />
        )}
        {tab === 'orders' && (
          <div style={{ height: '100%', overflowY: 'auto' }}>
            <OrdersMonth month={month} setMonth={setMonth} orders={orders} lines={lines} itemsById={itemsById} vendorsById={vendorsById}
              user={user} isManager={isManager} office={office} setOffice={setOffice} canSwitchOffice={canSwitchOffice}
              onQty={handleQty} onRemove={handleRemove} onStatus={handleStatus} onReceive={handleReceive} onBudget={handleBudget} notify={notify} />
          </div>
        )}
      </div>
    </div>
  )
}
