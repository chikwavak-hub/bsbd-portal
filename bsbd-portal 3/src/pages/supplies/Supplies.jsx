// src/pages/supplies/Supplies.jsx
// Supplies module: Dashboard (managers) · Formulary (click-and-add) · Orders · Settings (managers).
// Single-page module like RecallTracker — no sidebar, `goHome` returns to ModuleHome.

import React, { useEffect, useMemo, useState } from 'react'
import Dashboard from './Dashboard'
import Formulary from './Formulary'
import OrdersMonth from './OrdersMonth'
import Settings from './Settings'
import {
  loadVendors, loadItems, loadMonth, loadRange, loadRecentEvents, loadOfficeSettings, loadBudgets,
  addToOrder, updateLineQty, removeLine, receiveLine, setOrderStatus, saveBudgetCap, saveItem,
  saveOfficeSettings, saveBudget, saveVendor, reorderFromLastMonth, budgetFor,
  monthStart, shiftMonth, monthLabel,
} from '../../lib/suppliesApi'

const S = {
  tab: on => ({ padding: '8px 16px', borderRadius: 8, border: 'none', background: on ? '#0f766e' : '#fff', color: on ? '#fff' : '#334155', fontWeight: 700, fontSize: 13, cursor: 'pointer', boxShadow: on ? 'none' : 'inset 0 0 0 1px #e2e8f0', position: 'relative' }),
  btn:  { padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', color: '#334155' },
}

export default function SuppliesPage({ user, isManager, goHome, notify }) {
  const canSwitchOffice = isManager || !user.office
  const [office, setOffice]     = useState(user.office || 'Dalton')
  const [tab, setTab]           = useState(isManager ? 'dashboard' : 'formulary')   // dashboard | formulary | orders | settings
  const [month, setMonth]       = useState(monthStart())
  const [vendors, setVendors]   = useState([])
  const [items, setItems]       = useState([])
  const [settings, setSettings] = useState([])
  const [budgets, setBudgets]   = useState([])
  const [orders, setOrders]     = useState([])     // selected month
  const [lines, setLines]       = useState([])
  const [hist, setHist]         = useState({ orders: [], lines: [] })   // trailing 12 months for the dashboard
  const [events, setEvents]     = useState([])
  const [ready, setReady]       = useState(false)
  const [loadingMonth, setLoadingMonth] = useState(false)

  // ── Loads ────────────────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      try {
        const [v, it, st, bg] = await Promise.all([loadVendors(), loadItems(isManager), loadOfficeSettings(), loadBudgets()])
        setVendors(v); setItems(it); setSettings(st); setBudgets(bg)
      } catch (e) { notify('Could not load the formulary: ' + e.message, 'error') }
      setReady(true)
      if (isManager) refreshHistory()
    })()
  }, [])

  const refreshMonth = async (m = month) => {
    setLoadingMonth(true)
    try { const r = await loadMonth(m); setOrders(r.orders); setLines(r.lines) }
    catch (e) { notify('Could not load orders: ' + e.message, 'error') }
    setLoadingMonth(false)
  }
  useEffect(() => { refreshMonth(month) }, [month])

  const refreshHistory = async () => {
    try {
      const from = shiftMonth(monthStart(), -11)
      const [h, ev] = await Promise.all([loadRange(from, monthStart()), loadRecentEvents(30)])
      setHist(h); setEvents(ev)
    } catch (e) { notify('Could not load history: ' + e.message, 'error') }
  }

  // ── Derived ──────────────────────────────────────────────────────────
  const itemsById   = useMemo(() => Object.fromEntries(items.map(i => [i.id, i])), [items])
  const vendorsById = useMemo(() => Object.fromEntries(vendors.map(v => [v.id, v])), [vendors])
  const currentMonth = monthStart()
  const officeSettings = settings.find(s => s.office === office)
  const budgetOf = (o, m) => budgetFor(o, m, budgets, settings)

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

  const awaitingCount = useMemo(() => hist.orders.filter(o => o.status === 'submitted').length, [hist])

  // ── Handlers ─────────────────────────────────────────────────────────
  const afterWrite = async (m = month) => { await refreshMonth(m); if (isManager) refreshHistory() }

  const handleAdd = async (item, qty, requestedFor) => {
    if (month !== currentMonth) setMonth(currentMonth)
    try {
      const { created } = await addToOrder({ office, item, qty, requestedFor, user, month: currentMonth })
      await afterWrite(currentMonth)
      const v = vendorsById[item.vendor_id]
      notify(`${item.description} ×${qty} added to ${office} · ${v?.short_code || v?.name || 'vendor'} · ${monthLabel(currentMonth)}${created ? ' (new order started)' : ''}`)
    } catch (e) {
      if (e.code === 'ORDER_CLOSED') notify(`${e.message}. Ask a manager to reopen it, or it will go on next month's order.`, 'error')
      else notify('Add failed: ' + e.message, 'error')
    }
  }
  const handleQty     = async (line, qty)  => { await updateLineQty(line, qty, user); await afterWrite() }
  const handleRemove  = async line         => { await removeLine(line, user); await afterWrite() }
  const handleReceive = async (line, q)    => { await receiveLine(line, q); await afterWrite() }
  const handleStatus  = async (order, status, extra) => { await setOrderStatus(order, status, user, extra); await afterWrite() }
  const handleBudgetCap = async (order, cap) => { await saveBudgetCap(order, cap); await afterWrite() }
  const handleReorder = async (o, m) => { const n = await reorderFromLastMonth({ office: o, month: m, user, itemsById }); await afterWrite(m); return n }

  const handleSaveItem = async f => {
    const row = await saveItem({ ...f, vendor_id: f.vendor_id || null })
    setItems(prev => prev.some(i => i.id === row.id) ? prev.map(i => i.id === row.id ? row : i) : [...prev, row])
  }
  const handleSaveOffice = async row => {
    const saved = await saveOfficeSettings(row)
    setSettings(prev => prev.some(s => s.office === saved.office) ? prev.map(s => s.office === saved.office ? saved : s) : [...prev, saved])
  }
  const handleSaveBudget = async ({ office: o, month: m, amount, existing }) => {
    const row = await saveBudget({ office: o, month: m, amount, user, existing })
    setBudgets(prev => { const rest = prev.filter(b => !(b.office === o && b.month === m)); return row ? [...rest, row] : rest })
  }
  const handleSaveVendor = async v => {
    const row = await saveVendor(v)
    setVendors(prev => prev.some(x => x.id === row.id) ? prev.map(x => x.id === row.id ? row : x) : [...prev, row].sort((a, b) => a.name.localeCompare(b.name)))
  }
  const openOrders = (o, m) => { if (o && canSwitchOffice) setOffice(o); if (m) setMonth(m); setTab('orders') }

  // ── Render ───────────────────────────────────────────────────────────
  if (!ready) {
    return <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center' }}><div className="spinner" /></div>
  }

  const Tab = ({ id, label, badge }) => (
    <button style={S.tab(tab === id)} onClick={() => setTab(id)}>
      {label}
      {badge > 0 && <span style={{ marginLeft: 8, background: tab === id ? '#fff' : '#0f766e', color: tab === id ? '#0f766e' : '#fff', borderRadius: 999, padding: '1px 7px', fontSize: 11 }}>{badge}</span>}
    </button>
  )

  return (
    <div style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', background: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={S.btn} onClick={goHome}>← Home</button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 20, color: '#0f172a' }}>Supplies</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{items.filter(i => i.active !== false).length} items on the formulary · signed in as {user.name}{user.office ? ` · ${user.office}` : ''}</div>
        </div>
        <span style={{ flex: 1 }} />
        {isManager && <Tab id="dashboard" label="Dashboard" badge={awaitingCount} />}
        <Tab id="formulary" label="Formulary" />
        <Tab id="orders" label="Orders" badge={openLineCount} />
        {isManager && <Tab id="settings" label="Settings" />}
        <button style={S.btn} onClick={() => { refreshMonth(); if (isManager) refreshHistory() }} disabled={loadingMonth}>{loadingMonth ? '…' : 'Refresh'}</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: tab === 'formulary' ? 'hidden' : 'auto' }}>
        {tab === 'dashboard' && isManager && (
          <Dashboard orders={hist.orders} lines={hist.lines} items={items} itemsById={itemsById} vendorsById={vendorsById}
            settings={settings} budgets={budgets} events={events} onOpenOrders={openOrders} notify={notify} />
        )}
        {tab === 'formulary' && (
          <Formulary items={items} vendors={vendors} office={office} setOffice={setOffice} canSwitchOffice={canSwitchOffice}
            cartQtyByItem={cartQtyByItem} onAdd={handleAdd} isManager={isManager} onSaveItem={handleSaveItem} notify={notify} officeSettings={officeSettings} />
        )}
        {tab === 'orders' && (
          <OrdersMonth month={month} setMonth={setMonth} orders={orders} lines={lines} itemsById={itemsById} vendorsById={vendorsById}
            user={user} isManager={isManager} office={office} setOffice={setOffice} canSwitchOffice={canSwitchOffice}
            onQty={handleQty} onRemove={handleRemove} onStatus={handleStatus} onReceive={handleReceive} onBudget={handleBudgetCap}
            notify={notify} budgetOf={budgetOf} onReorder={handleReorder} />
        )}
        {tab === 'settings' && isManager && (
          <Settings settings={settings} budgets={budgets} vendors={vendors} onSaveOffice={handleSaveOffice} onSaveBudget={handleSaveBudget} onSaveVendor={handleSaveVendor} notify={notify} />
        )}
      </div>
    </div>
  )
}
