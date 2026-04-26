import React, { useState } from 'react'
import { IcoLogIn, IcoTooth } from '../components/icons'
import { LBL } from '../components/ui'

export default function LoginPage({ doLogin }) {
  const [un, setUn] = useState('')
  const [pw, setPw] = useState('')
  const go = () => doLogin(un, pw)
  return (
    <div style={{ width: '100vw', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg,#1e3a5f,#1a6b8a 60%,#0d9488)', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 20, boxShadow: '0 25px 60px rgba(0,0,0,.25)', padding: 44, width: '100%', maxWidth: 420 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 64, height: 64, borderRadius: 16, background: '#eff6ff', marginBottom: 16 }}>
            <IcoTooth style={{ color: '#1d4ed8' }} size={30} />
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e293b', margin: 0 }}>Beautiful Smiles by Design</h1>
          <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 6 }}>Daily Office Manager Portal</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div><label style={LBL}>Username</label><input className="ic" value={un} onChange={e => setUn(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Enter username" autoFocus /></div>
          <div><label style={LBL}>Password</label><input type="password" className="ic" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="Enter password" /></div>
          <button onClick={go} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '13px 0', borderRadius: 10, background: '#1d4ed8', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            <IcoLogIn size={17} /> Sign In
          </button>
        </div>
      </div>
    </div>
  )
}
