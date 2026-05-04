import React from 'react'
import { IcoTooth, IcoDash, IcoStar, IcoLogOut, IcoChevR, IcoClip, IcoPhone } from '../components/icons'

export default function ModuleHome({ user, isAdmin, isManager, isTC, openModule, doLogout, tcAlertCount }) {
  const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', provider: 'Provider', hygienist: 'Hygienist', front_desk: 'Front Desk', treatment_coordinator: 'Treatment Coordinator' }
  return (
    <div style={{ width: '100vw', minHeight: '100vh', background: 'linear-gradient(145deg,#0f172a 0%,#1e3a5f 50%,#134e4a 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', marginBottom: 52 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 72, height: 72, borderRadius: 20, background: 'rgba(255,255,255,.08)', marginBottom: 18, border: '1px solid rgba(255,255,255,.12)' }}>
          <IcoTooth style={{ color: 'white' }} size={34} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 4, color: 'rgba(255,255,255,.4)', marginBottom: 8 }}>BEAUTIFUL SMILES BY DESIGN</div>
        <h1 style={{ fontSize: 28, fontWeight: 800, color: 'white', margin: 0 }}>Manager Portal</h1>
        <p style={{ color: 'rgba(255,255,255,.45)', fontSize: 14, marginTop: 8 }}>Welcome, {user.name} — choose a module</p>
      </div>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center', maxWidth: 700, width: '100%' }}>
        {(isManager || ['provider','hygienist','front_desk'].includes(user.role)) && (
          <button onClick={() => openModule('reports')} style={{ flex: '1 1 260px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '32px 28px', cursor: 'pointer', textAlign: 'left', color: 'white', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.transform = 'none' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(29,78,216,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, border: '1px solid rgba(99,151,255,.25)' }}><IcoDash size={22} style={{ color: '#93c5fd' }} /></div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Daily Reports</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', lineHeight: 1.5 }}>Dashboard, daily office reports, analytics, collections and production tracking</div>
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#93c5fd', fontWeight: 700 }}>Open module <IcoChevR size={14} /></div>
          </button>
        )}
        {isTC && (
          <button onClick={() => openModule('tc')} style={{ flex: '1 1 260px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '32px 28px', cursor: 'pointer', textAlign: 'left', color: 'white', position: 'relative', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.transform = 'none' }}>
            {tcAlertCount > 0 && <div style={{ position: 'absolute', top: 20, right: 20, background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 99 }}>{tcAlertCount} alert{tcAlertCount > 1 ? 's' : ''}</div>}
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(13,148,136,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, border: '1px solid rgba(52,211,153,.25)' }}><IcoStar size={22} style={{ color: '#6ee7b7' }} /></div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>TC Tracker</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', lineHeight: 1.5 }}>Treatment coordinator patient pipeline, big treatment plans, follow-up alerts and production</div>
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6ee7b7', fontWeight: 700 }}>Open module <IcoChevR size={14} /></div>
          </button>
        )}
        {/* Recalls tile — visible to managers and front desk */}
        {(isManager || user.role === 'front_desk' || user.role === 'treatment_coordinator') && (
          <button onClick={() => openModule('recalls')} style={{ flex: '1 1 260px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '32px 28px', cursor: 'pointer', textAlign: 'left', color: 'white', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.transform = 'none' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(13,148,136,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, border: '1px solid rgba(99,255,240,.25)' }}><IcoPhone size={22} style={{ color: '#5eead4' }} /></div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Recall Tracker</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', lineHeight: 1.5 }}>Upload monthly recall lists and track 3-call workflows and postcard status per patient</div>
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5eead4', fontWeight: 700 }}>Open tracker <IcoChevR size={14} /></div>
          </button>
        )}
        {(isManager || user.role === 'front_desk') && (
          <button onClick={() => openModule('collections')} style={{ flex: '1 1 260px', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 20, padding: '32px 28px', cursor: 'pointer', textAlign: 'left', color: 'white', transition: 'all .2s' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,.11)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,.06)'; e.currentTarget.style.transform = 'none' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(79,70,229,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, border: '1px solid rgba(165,180,252,.25)' }}><IcoClip size={22} style={{ color: '#a5b4fc' }} /></div>
            <div style={{ fontSize: 18, fontWeight: 800, marginBottom: 6 }}>Collections</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.45)', lineHeight: 1.5 }}>Insurance verification, daily collection tracking and patient balance management</div>
            <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#a5b4fc', fontWeight: 700 }}>Open module <IcoChevR size={14} /></div>
          </button>
        )}
      </div>
      <div style={{ marginTop: 52, display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)' }}>{ROLE_LABELS[user.role] || user.role}{user.office ? ` · ${user.office}` : ''}</div>
        <button onClick={doLogout} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 20px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'transparent', color: 'rgba(255,255,255,.5)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
          <IcoLogOut size={14} /> Sign Out
        </button>
      </div>
    </div>
  )
}
