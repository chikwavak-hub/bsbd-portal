import React from 'react'
import { IcoDash, IcoBar, IcoClip, IcoGear, IcoStar, IcoBell, IcoUsers, IcoLogOut, IcoSun } from '../components/icons'

function SidebarShell({ user, title, accentColor, textColor, bgGradient, children, goHome, doLogout }) {
  const ROLE_LABELS = { admin: 'Administrator', manager: 'Manager', provider: 'Provider', hygienist: 'Hygienist', front_desk: 'Front Desk', treatment_coordinator: 'Treatment Coordinator' }
  return (
    <div style={{ width: 230, background: bgGradient, display: 'flex', flexDirection: 'column', color: 'white', flexShrink: 0, boxShadow: '4px 0 20px rgba(0,0,0,.2)' }}>
      <button onClick={goHome} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', background: 'none', border: 'none', borderBottom: '1px solid rgba(255,255,255,.08)', cursor: 'pointer', color: 'rgba(255,255,255,.5)', fontSize: 12, fontWeight: 600 }}>
        ← All Modules
      </button>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 3, color: accentColor, marginBottom: 4 }}>BSBD DENTISTRY</div>
        <div style={{ fontWeight: 800, fontSize: 15 }}>{title}</div>
      </div>
      <div style={{ padding: '10px 20px 12px', borderBottom: '1px solid rgba(255,255,255,.08)' }}>
        <div style={{ fontSize: 11, color: accentColor, marginBottom: 1 }}>Signed in as</div>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{user.name}</div>
        <div style={{ fontSize: 11, color: accentColor, marginTop: 1 }}>{ROLE_LABELS[user.role] || user.role}</div>
      </div>
      <nav style={{ flex: 1, padding: '12px 10px' }}>{children}</nav>
      <div style={{ padding: '10px', borderTop: '1px solid rgba(255,255,255,.08)' }}>
        <button onClick={doLogout} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: 'transparent', color: textColor }}>
          <IcoLogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  )
}

function NavBtn({ id, label, I, page, setPage, badge, textColor }) {
  const active = page === id
  return (
    <button onClick={() => setPage(id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, marginBottom: 2, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: active ? 'rgba(255,255,255,.18)' : 'transparent', color: active ? 'white' : textColor }}>
      <I size={16} /> {label}
      {badge > 0 && <span style={{ marginLeft: 'auto', background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 99 }}>{badge}</span>}
    </button>
  )
}

export function ReportsSidebar({ user, page, setPage, goHome, doLogout, isAdmin, isManager }) {
  const tc = '#7dd3fc'
  return (
    <SidebarShell user={user} title="Daily Reports" accentColor={tc} textColor={tc} bgGradient="linear-gradient(180deg,#1e3a5f,#163c5a)" goHome={goHome} doLogout={doLogout}>
      {isManager && <NavBtn id="huddle"    label="Morning Huddle" I={IcoSun}  page={page} setPage={setPage} textColor={tc} />}
      {isManager && <NavBtn id="dashboard" label="Dashboard"      I={IcoDash} page={page} setPage={setPage} textColor={tc} />}
      {isManager && <NavBtn id="analytics" label="Analytics"      I={IcoBar}  page={page} setPage={setPage} textColor={tc} />}
      {isManager && <NavBtn id="form"      label="Daily Report"   I={IcoClip} page={page} setPage={setPage} textColor={tc} />}
      {!isManager && <NavBtn id="mySection" label="My Section"    I={IcoClip} page={page} setPage={setPage} textColor={tc} />}
      {isAdmin && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.08)' }}>
          <NavBtn id="admin" label="Admin Settings" I={IcoGear} page={page} setPage={setPage} textColor={tc} />
        </div>
      )}
    </SidebarShell>
  )
}

export function TcSidebar({ user, page, setPage, goHome, doLogout, isManager, tcAlertCount }) {
  const tc = '#99f6e4'
  return (
    <SidebarShell user={user} title="TC Tracker" accentColor={tc} textColor={tc} bgGradient="linear-gradient(180deg,#134e4a,#0d3b37)" goHome={goHome} doLogout={doLogout}>
      <NavBtn id="tc_patients"  label="Patients"     I={IcoStar}  page={page} setPage={setPage} textColor={tc} />
      <NavBtn id="tc_alerts"    label="Alerts"       I={IcoBell}  page={page} setPage={setPage} badge={tcAlertCount} textColor={tc} />
      {isManager && <NavBtn id="tc_dashboard" label="TC Dashboard" I={IcoUsers} page={page} setPage={setPage} textColor={tc} />}
    </SidebarShell>
  )
}
