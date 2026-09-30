// src/pages/supplies/Dashboard.jsx
// Supplies landing page for managers. Everything here is computed from the
// trailing-12-month orders/lines passed in — no extra tables to maintain.

import React, { useMemo, useState } from 'react'
import { money, monthLabel, monthStart, shiftMonth, budgetFor, STATUS_LABEL } from '../../lib/suppliesApi'
import { exportYearSheet } from '../../lib/suppliesExport'

const ALL_OFFICES = ['Dalton', 'Calhoun', 'Brainerd', 'McCallie']
const OFFICE_COLOR = { Dalton: '#0f766e', Calhoun: '#1d4ed8', Brainerd: '#7c3aed', McCallie: '#b45309' }

const S = {
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 },
  h: { fontSize: 13, fontWeight: 800, color: '#0f172a', margin: '0 0 10px', textTransform: 'uppercase', letterSpacing: .5 },
  sub: { fontSize: 12, color: '#64748b' },
  td: { padding: '6px 8px', borderBottom: '1px solid #f1f5f9', fontSize: 13, verticalAlign: 'middle' },
  th: { padding: '6px 8px', borderBottom: '1px solid #e2e8f0', fontSize: 11, color: '#64748b', textTransform: 'uppercase', textAlign: 'left' },
  btn: { padding: '6px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid #cbd5e1', background: '#fff', color: '#334155' },
  pill: (bg, fg) => ({ background: bg, color: fg, fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }),
}

const lineTotal = l => l.qty * (Number(l.unit_price) || 0)
const pct = (a, b) => (b ? Math.round((a / b) * 100) : null)
const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)

function Bar({ value, max, color = '#0f766e', label }) {
  const w = max ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <div style={{ width: 90, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ flex: 1, height: 10, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}><div style={{ width: `${w}%`, height: '100%', background: color }} /></div>
      <div style={{ width: 80, textAlign: 'right', fontWeight: 700 }}>{money(value)}</div>
    </div>
  )
}

function Table({ cols, rows, empty = 'Nothing to show.' }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{cols.map((c, i) => <th key={i} style={{ ...S.th, textAlign: c.right ? 'right' : 'left' }}>{c.h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={cols.length} style={{ ...S.td, color: '#94a3b8', textAlign: 'center' }}>{empty}</td></tr>}
        {rows.map((r, i) => <tr key={i}>{cols.map((c, j) => <td key={j} style={{ ...S.td, textAlign: c.right ? 'right' : 'left' }}>{c.v(r)}</td>)}</tr>)}
      </tbody>
    </table>
  )
}

export default function Dashboard({ orders, lines, items, itemsById, vendorsById, settings, budgets, events, onOpenOrders, notify }) {
  const [officeFilter, setOfficeFilter] = useState('All')
  const thisMonth = monthStart()
  const year = new Date().getFullYear()

  const A = useMemo(() => {
    const live = orders.filter(o => o.status !== 'cancelled')
    const liveIds = new Set(live.map(o => o.id))
    const orderById = Object.fromEntries(live.map(o => [o.id, o]))
    const liveLines = lines.filter(l => liveIds.has(l.order_id))
    const inScope = o => officeFilter === 'All' || o.office === officeFilter
    const scopedLines = liveLines.filter(l => inScope(orderById[l.order_id]))

    // spend by office for a month
    const spend = (office, month) => liveLines
      .filter(l => { const o = orderById[l.order_id]; return o.office === office && o.order_month === month })
      .reduce((s, l) => s + lineTotal(l), 0)

    // this month vs budget
    const thisMonthByOffice = ALL_OFFICES.map(office => ({ office, spend: spend(office, thisMonth), budget: budgetFor(office, thisMonth, budgets, settings) }))

    // 6-month trend (group or filtered office)
    const trendMonths = [5, 4, 3, 2, 1, 0].map(i => shiftMonth(thisMonth, -i))
    const trend = trendMonths.map(m => ({ month: m, total: ALL_OFFICES.filter(o => officeFilter === 'All' || o === officeFilter).reduce((s, o) => s + spend(o, m), 0) }))

    // YTD by office and vendor
    const ytdLines = scopedLines.filter(l => orderById[l.order_id].order_month.startsWith(String(year)))
    const ytdByOffice = ALL_OFFICES.map(office => ({ office, total: ytdLines.filter(l => orderById[l.order_id].office === office).reduce((s, l) => s + lineTotal(l), 0) }))
    const byVendor = {}
    ytdLines.forEach(l => { const v = orderById[l.order_id].vendor_id; byVendor[v] = (byVendor[v] || 0) + lineTotal(l) })
    const ytdByVendor = Object.entries(byVendor).map(([id, total]) => ({ vendor: vendorsById[id]?.name || 'Vendor', total })).sort((a, b) => b.total - a.total)

    // month-over-month
    const lastMonth = shiftMonth(thisMonth, -1), twoAgo = shiftMonth(thisMonth, -2)
    const mom = ALL_OFFICES.map(office => ({ office, last: spend(office, lastMonth), prev: spend(office, twoAgo) }))

    // category spend (trailing 12 months, scoped)
    const byCat = {}
    scopedLines.forEach(l => { const c = itemsById[l.item_id]?.category || 'Uncategorized'; byCat[c] = (byCat[c] || 0) + lineTotal(l) })
    const categories = Object.entries(byCat).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total)

    // top items
    const byItem = {}
    scopedLines.forEach(l => { const e = byItem[l.item_id] || (byItem[l.item_id] = { item: itemsById[l.item_id], qty: 0, total: 0 }); e.qty += l.qty; e.total += lineTotal(l) })
    const topByDollars = Object.values(byItem).filter(x => x.item).sort((a, b) => b.total - a.total).slice(0, 15)
    const topByQty = Object.values(byItem).filter(x => x.item).sort((a, b) => b.qty - a.qty).slice(0, 15)

    // price drift: last two distinct prices per item, chronological
    const drift = []
    const priceHist = {}
    liveLines.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(l => {
      if (l.unit_price == null) return
      const h = priceHist[l.item_id] || (priceHist[l.item_id] = [])
      const p = Number(l.unit_price)
      if (!h.length || h[h.length - 1].p !== p) h.push({ p, when: orderById[l.order_id].order_month })
    })
    Object.entries(priceHist).forEach(([id, h]) => {
      if (h.length >= 2) { const a = h[h.length - 2], b = h[h.length - 1]; if (itemsById[id]) drift.push({ item: itemsById[id], from: a.p, to: b.p, when: b.when, change: (b.p - a.p) / a.p }) }
    })
    drift.sort((a, b) => Math.abs(b.change) - Math.abs(a.change))

    // same SKU, different price across offices (last price each office paid)
    const lastByOfficeItem = {}
    liveLines.slice().sort((a, b) => a.created_at.localeCompare(b.created_at)).forEach(l => {
      if (l.unit_price == null) return
      lastByOfficeItem[l.item_id] = lastByOfficeItem[l.item_id] || {}
      lastByOfficeItem[l.item_id][orderById[l.order_id].office] = Number(l.unit_price)
    })
    const gaps = Object.entries(lastByOfficeItem).map(([id, m]) => {
      const vals = Object.entries(m); if (vals.length < 2 || !itemsById[id]) return null
      const lo = vals.reduce((a, b) => (b[1] < a[1] ? b : a)), hi = vals.reduce((a, b) => (b[1] > a[1] ? b : a))
      return hi[1] > lo[1] ? { item: itemsById[id], lo, hi, gap: hi[1] - lo[1] } : null
    }).filter(Boolean).sort((a, b) => b.gap - a.gap).slice(0, 10)

    // open work
    const awaiting = live.filter(o => o.status === 'submitted' && inScope(o)).map(o => ({ ...o, days: daysSince(o.submitted_at || o.updated_at), total: liveLines.filter(l => l.order_id === o.id).reduce((s, l) => s + lineTotal(l), 0) })).sort((a, b) => b.days - a.days)
    const notReceived = live.filter(o => o.status === 'placed' && inScope(o)).map(o => ({ ...o, days: daysSince(o.placed_at || o.updated_at) })).sort((a, b) => b.days - a.days)

    // short shipments last 90 days by vendor
    const cutoff = new Date(Date.now() - 90 * 86400000).toISOString()
    const shorts = {}
    liveLines.forEach(l => {
      const o = orderById[l.order_id]
      if (!inScope(o) || o.status !== 'received' || (o.received_at || o.updated_at) < cutoff) return
      if (l.received_qty != null && l.received_qty < l.qty) { const v = o.vendor_id; shorts[v] = shorts[v] || { vendor: vendorsById[v]?.name || 'Vendor', lines: 0, units: 0 }; shorts[v].lines++; shorts[v].units += l.qty - l.received_qty }
    })
    const shortByVendor = Object.values(shorts).sort((a, b) => b.lines - a.lines)

    // par nudges: item ordered in ≥3 of the last 6 months by this office, not on this month's open order
    const parNudges = []
    const officesForPar = officeFilter === 'All' ? ALL_OFFICES : [officeFilter]
    const last6 = new Set([1, 2, 3, 4, 5, 6].map(i => shiftMonth(thisMonth, -i)))
    officesForPar.forEach(office => {
      const monthsByItem = {}
      liveLines.forEach(l => { const o = orderById[l.order_id]; if (o.office === office && last6.has(o.order_month)) (monthsByItem[l.item_id] = monthsByItem[l.item_id] || new Set()).add(o.order_month) })
      const onThisMonth = new Set(liveLines.filter(l => { const o = orderById[l.order_id]; return o.office === office && o.order_month === thisMonth }).map(l => l.item_id))
      Object.entries(monthsByItem).forEach(([id, ms]) => { if (ms.size >= 3 && !onThisMonth.has(id) && itemsById[id]) parNudges.push({ office, item: itemsById[id], months: ms.size }) })
    })
    parNudges.sort((a, b) => b.months - a.months)

    // formulary health
    const orderedIds = new Set(liveLines.map(l => l.item_id))
    const officesByItem = {}
    liveLines.forEach(l => (officesByItem[l.item_id] = officesByItem[l.item_id] || new Set()).add(orderById[l.order_id].office))
    const activeItems = items.filter(i => i.active !== false)
    const health = {
      noPrice: activeItems.filter(i => i.unit_price == null),
      neverOrdered: activeItems.filter(i => !orderedIds.has(i.id)),
      singleOffice: activeItems.filter(i => officesByItem[i.id]?.size === 1 && (i.offices?.length || 4) > 1),
    }

    return { thisMonthByOffice, trend, ytdByOffice, ytdByVendor, mom, categories, topByDollars, topByQty, drift: drift.slice(0, 12), gaps, awaiting, notReceived, shortByVendor, parNudges: parNudges.slice(0, 25), health, liveCount: live.length }
  }, [orders, lines, items, itemsById, vendorsById, settings, budgets, officeFilter, thisMonth, year])

  const trendMax = Math.max(1, ...A.trend.map(t => t.total))
  const catMax = Math.max(1, ...A.categories.map(c => c.total))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {['All', ...ALL_OFFICES].map(o => (
          <button key={o} onClick={() => setOfficeFilter(o)} style={{ ...S.btn, background: officeFilter === o ? '#0f172a' : '#fff', color: officeFilter === o ? '#fff' : '#334155', borderColor: officeFilter === o ? '#0f172a' : '#cbd5e1' }}>{o}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span style={S.sub}>{A.liveCount} orders in the trailing 12 months</span>
        {officeFilter !== 'All' && (
          <button style={S.btn} onClick={() => { try { const lb = {}; lines.forEach(l => (lb[l.order_id] = lb[l.order_id] || []).push(l)); exportYearSheet(officeFilter, year, orders, lb, itemsById, vendorsById) } catch (e) { notify('Export failed: ' + e.message, 'error') } }}>
            ⬇ {year} workbook
          </button>
        )}
      </div>

      {/* This month vs budget */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 12 }}>
        {A.thisMonthByOffice.filter(x => officeFilter === 'All' || x.office === officeFilter).map(({ office, spend, budget }) => {
          const p = budget ? pct(spend, budget) : null
          const color = p == null ? '#0f172a' : p > 100 ? '#b91c1c' : p >= 90 ? '#b45309' : '#0f172a'
          return (
            <div key={office} style={{ ...S.card, borderTop: `4px solid ${OFFICE_COLOR[office]}`, cursor: 'pointer' }} onClick={() => onOpenOrders(office)}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{office} · {monthLabel(thisMonth)}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color, margin: '4px 0' }}>{money(spend)}</div>
              {budget != null
                ? <><div style={{ height: 8, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, p)}%`, height: '100%', background: color }} /></div>
                    <div style={{ ...S.sub, marginTop: 4 }}>{p}% of {money(budget)} budget{p > 100 ? ` · ${money(spend - budget)} over` : ''}</div></>
                : <div style={S.sub}>No budget set — add one in Settings</div>}
            </div>
          )
        })}
      </div>

      {/* Open work */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={S.card}>
          <h3 style={S.h}>Awaiting approval <span style={S.pill('#fef3c7', '#92400e')}>{A.awaiting.length}</span></h3>
          <Table empty="Nothing waiting." cols={[
            { h: 'Office', v: r => r.office }, { h: 'Vendor', v: r => vendorsById[r.vendor_id]?.short_code || '' }, { h: 'By', v: r => r.submitted_by || '' },
            { h: 'Total', right: true, v: r => money(r.total) }, { h: 'Days', right: true, v: r => <span style={{ color: r.days >= 3 ? '#b91c1c' : '#334155', fontWeight: 700 }}>{r.days}</span> },
            { h: '', right: true, v: r => <button style={S.btn} onClick={() => onOpenOrders(r.office, r.order_month)}>Open</button> },
          ]} rows={A.awaiting} />
        </div>
        <div style={S.card}>
          <h3 style={S.h}>Placed, not received <span style={S.pill('#ede9fe', '#5b21b6')}>{A.notReceived.length}</span></h3>
          <Table empty="Nothing outstanding." cols={[
            { h: 'Office', v: r => r.office }, { h: 'Vendor', v: r => vendorsById[r.vendor_id]?.short_code || '' }, { h: 'Order #', v: r => r.vendor_order_no || '—' },
            { h: 'Days', right: true, v: r => <span style={{ color: r.days >= 10 ? '#b91c1c' : '#334155', fontWeight: 700 }}>{r.days}</span> },
            { h: '', right: true, v: r => <button style={S.btn} onClick={() => onOpenOrders(r.office, r.order_month)}>Open</button> },
          ]} rows={A.notReceived} />
        </div>
      </div>

      {/* Trend + YTD */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={S.card}>
          <h3 style={S.h}>Last 6 months {officeFilter === 'All' ? '· all offices' : `· ${officeFilter}`}</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{A.trend.map(t => <Bar key={t.month} label={monthLabel(t.month)} value={t.total} max={trendMax} color={t.month === thisMonth ? '#0f766e' : '#94a3b8'} />)}</div>
        </div>
        <div style={S.card}>
          <h3 style={S.h}>{year} year to date · by office</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{A.ytdByOffice.map(r => <Bar key={r.office} label={r.office} value={r.total} max={Math.max(1, ...A.ytdByOffice.map(x => x.total))} color={OFFICE_COLOR[r.office]} />)}</div>
          <div style={{ marginTop: 10, borderTop: '1px dashed #e2e8f0', paddingTop: 8 }}>
            <div style={{ ...S.sub, fontWeight: 700, marginBottom: 4 }}>Last month vs the month before</div>
            {A.mom.filter(m => officeFilter === 'All' || m.office === officeFilter).map(m => {
              const d = m.prev ? Math.round(((m.last - m.prev) / m.prev) * 100) : null
              return <div key={m.office} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}><span>{m.office}</span><span>{money(m.last)} <span style={{ color: d == null ? '#94a3b8' : d > 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{d == null ? '—' : `${d > 0 ? '+' : ''}${d}%`}</span></span></div>
            })}
          </div>
        </div>
        <div style={S.card}>
          <h3 style={S.h}>{year} year to date · by vendor</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{A.ytdByVendor.slice(0, 8).map(r => <Bar key={r.vendor} label={r.vendor} value={r.total} max={Math.max(1, ...A.ytdByVendor.map(x => x.total))} color="#1d4ed8" />)}</div>
        </div>
      </div>

      {/* Category + top items */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <div style={S.card}>
          <h3 style={S.h}>Spend by category · 12 mo</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{A.categories.slice(0, 12).map(c => <Bar key={c.category} label={c.category} value={c.total} max={catMax} color="#7c3aed" />)}</div>
        </div>
        <div style={S.card}>
          <h3 style={S.h}>Top items by dollars · 12 mo</h3>
          <Table cols={[{ h: 'Item', v: r => r.item.description }, { h: 'Qty', right: true, v: r => r.qty }, { h: 'Spend', right: true, v: r => money(r.total) }]} rows={A.topByDollars} />
        </div>
        <div style={S.card}>
          <h3 style={S.h}>Top items by quantity · 12 mo</h3>
          <Table cols={[{ h: 'Item', v: r => r.item.description }, { h: 'Qty', right: true, v: r => r.qty }, { h: 'Spend', right: true, v: r => money(r.total) }]} rows={A.topByQty} />
        </div>
      </div>

      {/* Price watch */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={S.card}>
          <h3 style={S.h}>Price drift — last price vs the one before</h3>
          <Table empty="No price changes seen yet." cols={[
            { h: 'Item', v: r => r.item.description }, { h: 'Was', right: true, v: r => money(r.from) }, { h: 'Now', right: true, v: r => money(r.to) },
            { h: 'Change', right: true, v: r => <span style={{ color: r.change > 0 ? '#b91c1c' : '#166534', fontWeight: 700 }}>{r.change > 0 ? '+' : ''}{Math.round(r.change * 100)}%</span> }, { h: 'Since', v: r => monthLabel(r.when) },
          ]} rows={A.drift} />
        </div>
        <div style={S.card}>
          <h3 style={S.h}>Same item, different price by office</h3>
          <Table empty="No cross-office gaps." cols={[
            { h: 'Item', v: r => r.item.description }, { h: 'Lowest', v: r => `${r.lo[0]} ${money(r.lo[1])}` }, { h: 'Highest', v: r => `${r.hi[0]} ${money(r.hi[1])}` }, { h: 'Gap', right: true, v: r => <b>{money(r.gap)}</b> },
          ]} rows={A.gaps} />
        </div>
      </div>

      {/* Par nudges + shorts */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
        <div style={S.card}>
          <h3 style={S.h}>Usually ordered by now, not on this month's order</h3>
          <div style={{ ...S.sub, marginBottom: 8 }}>Items an office ordered in 3+ of the last 6 months that aren't on its {monthLabel(thisMonth)} draft.</div>
          <Table empty="Nothing missing — or not enough history yet (needs a few months of orders)." cols={[
            { h: 'Office', v: r => r.office }, { h: 'Item', v: r => r.item.description }, { h: 'Vendor', v: r => vendorsById[r.item.vendor_id]?.short_code || '' }, { h: 'Months', right: true, v: r => `${r.months}/6` },
          ]} rows={A.parNudges} />
        </div>
        <div style={S.card}>
          <h3 style={S.h}>Short shipments · 90 days</h3>
          <Table empty="No shorts recorded." cols={[{ h: 'Vendor', v: r => r.vendor }, { h: 'Lines', right: true, v: r => r.lines }, { h: 'Units', right: true, v: r => r.units }]} rows={A.shortByVendor} />
        </div>
      </div>

      {/* Formulary health + audit */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={S.card}>
          <h3 style={S.h}>Formulary health</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
            {[['No price', A.health.noPrice], ['Never ordered · 12 mo', A.health.neverOrdered], ['Only one office orders', A.health.singleOffice]].map(([label, list]) => (
              <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: 10 }}><div style={{ fontSize: 22, fontWeight: 800 }}>{list.length}</div><div style={S.sub}>{label}</div></div>
            ))}
          </div>
          <details><summary style={{ fontSize: 12, cursor: 'pointer', color: '#475569' }}>Show items with no price</summary>
            <ul style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18, columns: 2 }}>{A.health.noPrice.slice(0, 60).map(i => <li key={i.id}>{i.description}</li>)}</ul></details>
          <details><summary style={{ fontSize: 12, cursor: 'pointer', color: '#475569' }}>Show items only one office orders</summary>
            <ul style={{ fontSize: 12, margin: '6px 0 0', paddingLeft: 18, columns: 2 }}>{A.health.singleOffice.slice(0, 60).map(i => <li key={i.id}>{i.description}</li>)}</ul></details>
        </div>
        <div style={S.card}>
          <h3 style={S.h}>Recent activity</h3>
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: '#475569', display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
            {events.length === 0 && <li style={{ listStyle: 'none', color: '#94a3b8' }}>No activity yet.</li>}
            {events.map(e => (
              <li key={e.id}><span style={{ color: '#94a3b8' }}>{new Date(e.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span> · <b>{e.actor || '—'}</b> {e.event.replace('_', ' ')}{e.payload?.description ? ` — ${e.payload.description}${e.payload.qty ? ` ×${e.payload.qty}` : ''}` : ''}{e.payload?.notes ? ` — "${e.payload.notes}"` : ''}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
