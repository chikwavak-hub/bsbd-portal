import React, { useEffect, useRef } from 'react'
import { IcoChevD, IcoChevU, IcoChevSort, IcoCalendar } from './icons'
import { TC_STATUS_MAP } from '../lib/constants'

export const LBL  = { fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' }
export const CARD = { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 16, overflow: 'hidden' }

export function Sect({ title, emoji, open, toggle, badge, children }) {
  return (
    <div style={CARD}>
      <button onClick={toggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', borderBottom: open ? '1px solid #e2e8f0' : 'none' }}>
        <span style={{ fontSize: 18 }}>{emoji}</span>
        <span style={{ fontWeight: 700, fontSize: 15, color: '#1e293b', flex: 1, textAlign: 'left' }}>{title}</span>
        {badge && <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', background: '#f1f5f9', padding: '3px 10px', borderRadius: 99 }}>{badge}</span>}
        {open ? <IcoChevU size={17} style={{ color: '#94a3b8' }} /> : <IcoChevD size={17} style={{ color: '#94a3b8' }} />}
      </button>
      {open && <div style={{ padding: '18px 20px' }}>{children}</div>}
    </div>
  )
}

export function NF({ label, val, set, pre }) {
  return (
    <div>
      <label style={LBL}>{label}</label>
      <div style={{ position: 'relative' }}>
        {pre && <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', fontSize: 13, pointerEvents: 'none' }}>$</span>}
        <input type="number" min="0" className="ic" style={pre ? { paddingLeft: 22 } : {}} value={val} onChange={e => set(e.target.value)} placeholder="0" />
      </div>
    </div>
  )
}

export function RF({ label, val, col }) {
  return (
    <div>
      <label style={LBL}>{label}</label>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', fontSize: 14, fontWeight: 700, color: col || '#1e293b', background: '#f8fafc' }}>{val}</div>
    </div>
  )
}

export function PBar({ pct, inverse = false }) {
  const p = Math.min(pct, 100)
  const color = inverse
    ? (p < 10 ? '#10b981' : p < 25 ? '#f59e0b' : '#ef4444')
    : (p >= 100 ? '#10b981' : p >= 75 ? '#f59e0b' : '#ef4444')
  return (
    <div style={{ marginTop: 6, height: 6, borderRadius: 3, background: '#e2e8f0', overflow: 'hidden' }}>
      <div style={{ height: '100%', borderRadius: 3, width: p + '%', background: color, transition: 'width .4s' }} />
    </div>
  )
}

export function RangeSelector({ rangeType, setRangeType, customStart, setCustomStart, customEnd, setCustomEnd }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
      <IcoCalendar size={15} style={{ color: '#64748b' }} />
      {[['today', 'Today'], ['week', 'This Week'], ['mtd', 'Month to Date'], ['last30', 'Last 30 Days'], ['custom', 'Custom']].map(([t, l]) => (
        <button key={t} onClick={() => setRangeType(t)} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, background: rangeType === t ? '#1d4ed8' : '#f1f5f9', color: rangeType === t ? 'white' : '#475569' }}>{l}</button>
      ))}
      {rangeType === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="date" className="ic" style={{ width: 140, fontSize: 12 }} value={customStart} onChange={e => setCustomStart(e.target.value)} />
          <span style={{ color: '#94a3b8', fontSize: 12 }}>to</span>
          <input type="date" className="ic" style={{ width: 140, fontSize: 12 }} value={customEnd} onChange={e => setCustomEnd(e.target.value)} />
        </div>
      )}
    </div>
  )
}

export function SortTh({ label, field, sort, setSort }) {
  const active = sort.field === field
  return (
    <th className="sortable"
      onClick={() => setSort(s => ({ field, dir: s.field === field && s.dir === 'asc' ? 'desc' : 'asc' }))}
      style={{ padding: '10px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: active ? '#1d4ed8' : '#64748b', letterSpacing: 1, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap', background: '#f8fafc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {label.toUpperCase()}
        <IcoChevSort size={11} style={{ opacity: active ? .9 : .35, color: active ? '#1d4ed8' : '#64748b' }} />
      </div>
    </th>
  )
}

export function ChartCanvas({ config, height = 280 }) {
  const ref  = useRef(null)
  const inst = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    if (inst.current) { inst.current.destroy(); inst.current = null }
    import('chart.js').then(mod => {
      const Chart = mod.Chart
      const registerables = mod.registerables
      Chart.register(...registerables)
      if (ref.current) inst.current = new Chart(ref.current.getContext('2d'), config)
    })
    return () => { if (inst.current) { inst.current.destroy(); inst.current = null } }
  }, [JSON.stringify(config)])
  return <canvas ref={ref} style={{ maxHeight: height, width: '100%' }} />
}

export function TcStatusBadge({ status }) {
  const s = TC_STATUS_MAP[status] || { label: status, color: '#64748b', bg: '#f1f5f9' }
  return <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: s.bg, color: s.color, whiteSpace: 'nowrap' }}>{s.label}</span>
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,.15)', color: 'white', fontSize: 13, fontWeight: 600, background: toast.type === 'error' ? '#ef4444' : '#10b981', maxWidth: 360 }}>
      {toast.msg}
    </div>
  )
}
