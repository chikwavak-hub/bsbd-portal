import React from 'react'
import { IcoTooth, IcoDash, IcoStar, IcoLogOut, IcoChevR, IcoClip, IcoPhone } from '../components/icons'

// Package icon for the Supplies tile (kept local so components/icons.jsx doesn't need a change)
const IcoBox = ({ size = 22, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="m3.3 8.1 8.7 4.9 8.7-4.9" /><path d="M12 13v9" /><path d="m7.5 5.5 9 5" />
  </svg>
)

// Note-with-check icon for the Note Builder tile (local for the same reason)
const IcoNote = ({ size = 22, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M8 13h5" /><path d="m9 17 2 2 4-4" />
  </svg>
)

const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', provider: 'Dentist', assistant: 'Assistant', hygienist: 'Hygienist', front_desk: 'Front Desk', treatment_coordinator: 'Treatment Coordinator' }

// One tile: icon, name, one short line, optional badge. Same size for every module.
function Tile({ m }) {
  const [hover, setHover] = React.useState(false)
  return (
    <button onClick={m.open} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 14, textAlign: 'left', cursor: 'pointer', color: 'white',
        padding: '18px 18px', borderRadius: 16, minHeight: 92,
        background: hover ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.05)',
        border: `1px solid ${hover ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.10)'}`,
        transform: hover ? 'translateY(-1px)' : 'none', transition: 'all .15s' }}>
      <div style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.tint, color: m.color }}>
        <m.Icon size={21} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 3 }}>{m.name}</div>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.5)', lineHeight: 1.4 }}>{m.line}</div>
      </div>
      <IcoChevR size={16} style={{ color: hover ? m.color : 'rgba(255,255,255,.25)', flexShrink: 0 }} />
      {m.badge && (
        <div style={{ position: 'absolute', top: -8, right: 12, background: m.badge.bg, color: m.badge.fg, fontSize: 11, fontWeight: 800, padding: '2px 9px', borderRadius: 99, boxShadow: '0 2px 6px rgba(0,0,0,.25)' }}>
          {m.badge.text}
        </div>
      )}
    </button>
  )
}

export default function ModuleHome({ user, isAdmin, isManager, isTC, openModule, doLogout, tcAlertCount, suppliesPending = 0, notesWaiting = { count: 0, kind: '' } }) {
  const role = user.role
  const modules = [
    (isManager || ['provider', 'hygienist', 'front_desk'].includes(role)) && {
      key: 'reports', name: 'Daily Reports', line: 'Dashboard, office reports, analytics',
      Icon: IcoDash, color: '#93c5fd', tint: 'rgba(29,78,216,.35)',
    },
    isTC && {
      key: 'tc', name: 'TC Tracker', line: 'Treatment plans and follow-ups',
      Icon: IcoStar, color: '#6ee7b7', tint: 'rgba(13,148,136,.35)',
      badge: tcAlertCount > 0 && { text: `${tcAlertCount} alert${tcAlertCount > 1 ? 's' : ''}`, bg: '#ef4444', fg: 'white' },
    },
    (isManager || role === 'front_desk' || role === 'treatment_coordinator') && {
      key: 'recalls', name: 'Recall Tracker', line: 'Recall lists, calls and postcards',
      Icon: IcoPhone, color: '#5eead4', tint: 'rgba(13,148,136,.30)',
    },
    (isManager || role === 'front_desk') && {
      key: 'collections', name: 'Collections', line: 'Verification and daily collections',
      Icon: IcoClip, color: '#a5b4fc', tint: 'rgba(79,70,229,.35)',
    },
    // Note Builder: every role touches notes
    {
      key: 'notebuilder', name: 'Note Builder', line: 'TennCare-ready notes and X-ray findings',
      Icon: IcoNote, color: '#e9cf86', tint: 'rgba(201,168,76,.30)',
      badge: notesWaiting.count > 0 && {
        text: notesWaiting.kind === 'dr' ? `${notesWaiting.count} need${notesWaiting.count > 1 ? '' : 's'} you` : `${notesWaiting.count} back from dentist`,
        bg: notesWaiting.kind === 'dr' ? '#ef4444' : '#f59e0b', fg: notesWaiting.kind === 'dr' ? 'white' : '#1c1917',
      },
    },
    // Supplies: everyone can add to the order; managers approve
    {
      key: 'supplies', name: 'Supplies', line: 'Formulary and monthly orders',
      Icon: IcoBox, color: '#fcd34d', tint: 'rgba(217,119,6,.30)',
      badge: isManager && suppliesPending > 0 && { text: `${suppliesPending} to approve`, bg: '#f59e0b', fg: '#1c1917' },
    },
  ].filter(Boolean).map(m => ({ ...m, open: () => openModule(m.key) }))

  return (
    <div style={{ width: '100vw', minHeight: '100vh', boxSizing: 'border-box', background: 'linear-gradient(145deg,#0f172a 0%,#1e3a5f 55%,#134e4a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
      <div style={{ width: '100%', maxWidth: 820 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
          <div style={{ width: 48, height: 48, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)' }}>
            <IcoTooth style={{ color: 'white' }} size={24} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 3, color: 'rgba(255,255,255,.4)' }}>BEAUTIFUL SMILES BY DESIGN</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'white', marginTop: 2 }}>Welcome, {String(user.name || '').split(' ')[0] || user.name}</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 14 }}>
          {modules.map(m => <Tile key={m.key} m={m} />)}
        </div>

        <div style={{ marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.4)' }}>{user.name} · {ROLE_LABELS[role] || role}{user.office ? ` · ${user.office}` : ''}</div>
          <button onClick={doLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 16px', borderRadius: 9, border: '1px solid rgba(255,255,255,.15)', background: 'transparent', color: 'rgba(255,255,255,.55)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            <IcoLogOut size={14} /> Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
