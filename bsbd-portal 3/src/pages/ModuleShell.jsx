// src/pages/ModuleShell.jsx — top bar for single-page modules (Admin, Tools):
// module name on the left, "← Modules" back to the home page on the right.

import React from 'react'

export default function ModuleShell({ title, subtitle, goHome, children, tabs, tab, setTab }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9' }}>
      <div style={{ background: 'linear-gradient(135deg,#0f172a,#1e3a5f)', color: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 3, color: 'rgba(255,255,255,.45)' }}>BEAUTIFUL SMILES BY DESIGN</div>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>{subtitle}</div>}
          </div>
          <button onClick={goHome} style={{ padding: '7px 14px', borderRadius: 9, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            ← Modules
          </button>
        </div>
        {tabs && tabs.length > 1 && (
          <div style={{ maxWidth: 1000, margin: '0 auto', padding: '0 20px', display: 'flex', gap: 4 }}>
            {tabs.map(([key, label]) => (
              <button key={key} onClick={() => setTab(key)}
                style={{ border: 0, borderBottom: `3px solid ${tab === key ? '#C9A84C' : 'transparent'}`, background: 'transparent', color: tab === key ? 'white' : 'rgba(255,255,255,.6)', fontWeight: 700, fontSize: 13, padding: '10px 12px', cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  )
}
