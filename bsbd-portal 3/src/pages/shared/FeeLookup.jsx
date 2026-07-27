// src/pages/shared/FeeLookup.jsx — carrier fee schedule lookup.
// Mounted for TCs (treatment planning), Ridgeview, and Collections.
// Search any code or description; see the office fee and every carrier's
// allowed fee side by side. Import/refresh the fee workbook in place.

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { USD } from '../../lib/helpers'
import { loadFeeTable, parseFeeWorkbook, importFeeSchedules, CARRIER_LABELS } from '../../lib/feeSchedules'

const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a', AMBER='#d97706'

// light description map for search (reuses common CDT names)
const DESC = {
  D0120:'Periodic Eval',D0140:'Limited Eval',D0150:'Comprehensive Eval',D0210:'FMX',D0220:'Periapical',
  D0272:'Bitewings 2',D0274:'Bitewings 4',D0330:'Panoramic',D1110:'Prophy Adult',D1120:'Prophy Child',
  D1206:'Fluoride Varnish',D1351:'Sealant',D2140:'Amalgam 1S',D2150:'Amalgam 2S',D2160:'Amalgam 3S',
  D2330:'Resin 1S Ant',D2391:'Resin 1S Post',D2392:'Resin 2S Post',D2393:'Resin 3S Post',D2394:'Resin 4S Post',
  D2740:'Crown Porcelain',D2750:'Crown PFM',D2950:'Core Buildup',D3310:'RCT Anterior',D3320:'RCT Premolar',
  D3330:'RCT Molar',D4341:'SRP 4+',D4342:'SRP 1-3',D4910:'Perio Maint',D5110:'Denture Max',D5120:'Denture Mand',
  D5213:'Partial Max',D5214:'Partial Mand',D6010:'Implant',D6057:'Custom Abutment',D6058:'Implant Crown',
  D7140:'Extraction',D7210:'Surgical Ext',D9944:'Occlusal Guard',
}

export default function FeeLookup({ user, notify }) {
  const [data, setData] = useState(null)     // {table, latest, count}
  const [q, setQ] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  const load = () => loadFeeTable().then(setData).catch(() => setData({ table: {}, latest: null, count: 0 }))
  useEffect(() => { load() }, [])

  const carriers = useMemo(() => {
    const set = new Set()
    Object.values(data?.table || {}).forEach(c => Object.keys(c).forEach(k => set.add(k)))
    const order = ['office','aetna','ameritas','bcbs','cigna','delta','humana','guardian','metlife','principal','private','uhc']
    return order.filter(k => set.has(k))
  }, [data])

  const rows = useMemo(() => {
    const all = Object.entries(data?.table || {}).map(([code, fees]) => ({ code, desc: DESC[code] || '', fees }))
    const s = q.trim().toUpperCase()
    const filtered = !s ? all : all.filter(r => r.code.includes(s) || r.desc.toUpperCase().includes(s))
    return filtered.sort((a, b) => a.code.localeCompare(b.code)).slice(0, 200)
  }, [data, q])

  const handleImport = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const { entries, codes, carriers: cs } = await parseFeeWorkbook(file)
      if (!entries.length) throw new Error('No fee rows found in that file')
      await importFeeSchedules(entries)
      notify(`Fee schedules imported: ${codes} codes × ${cs.length} columns (${entries.length} rates) ✓`)
      load()
    } catch (err) { notify('Import failed: ' + err.message, 'error') }
    setImporting(false)
  }

  const ageDays = data?.latest ? Math.floor((Date.now() - new Date(data.latest).getTime()) / 86400000) : null
  const card = { background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:16, marginBottom:14 }

  return (
    <div style={{ maxWidth: 1100, margin:'0 auto', padding:'20px 16px 80px' }}>
      <div style={{ background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)', borderRadius:14, padding:'18px 24px', marginBottom:18, color:'white' }}>
        <div style={{ fontSize:10, opacity:.5, fontWeight:700, letterSpacing:2, marginBottom:4 }}>BSBD</div>
        <h1 style={{ fontSize:20, fontWeight:800, margin:0 }}>Insurance Fee Lookup</h1>
        <div style={{ fontSize:12, opacity:.75, marginTop:4 }}>
          {data ? `${Object.keys(data.table).length} codes on file` : 'Loading…'}
          {ageDays != null && <span> · last updated {ageDays} day{ageDays!==1?'s':''} ago{ageDays>365?' — ⚠ consider refreshing carrier rates':''}</span>}
        </div>
      </div>

      <div style={{ ...card, display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
        <input placeholder="Search code or description (e.g. D2740, crown, prophy)…" value={q} onChange={e=>setQ(e.target.value)}
          style={{ flex:1, minWidth:240, padding:'10px 14px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:14, fontWeight:600 }}/>
        <button type="button" onClick={()=>{ if(!importing && fileRef.current){ fileRef.current.value=''; fileRef.current.click() } }}
          style={{ padding:'10px 18px', borderRadius:9, background:importing?'#5eead4':TEAL, color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer' }}>
          {importing ? 'Importing…' : '⬆ Import / Update Fee Workbook'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display:'none' }}/>
      </div>

      {data && Object.keys(data.table).length === 0 && (
        <div style={{ ...card, textAlign:'center', color:'#94a3b8' }}>
          No fee schedules loaded yet. Import the fee workbook (the daily collection sheet file with the carrier fee table works as-is).
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ ...card, padding:0, overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr>
                <th style={th}>CODE</th>
                <th style={{...th, textAlign:'left'}}>DESCRIPTION</th>
                {carriers.map(c => <th key={c} style={{...th, textAlign:'right', background:c==='office'?'#eff6ff':'#f8fafc'}}>{CARRIER_LABELS[c].toUpperCase()}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.code} style={{ borderTop:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                  <td style={{ padding:'7px 10px', fontWeight:800, color:BLUE, whiteSpace:'nowrap' }}>{r.code}</td>
                  <td style={{ padding:'7px 10px', color:'#64748b' }}>{r.desc}</td>
                  {carriers.map(c => (
                    <td key={c} style={{ padding:'7px 10px', textAlign:'right', fontWeight:c==='office'?800:600,
                      color: r.fees[c]==null ? '#e2e8f0' : c==='office' ? NAVY : '#334155',
                      background: c==='office' ? '#eff6ff44' : 'transparent' }}>
                      {r.fees[c]!=null ? USD(r.fees[c]) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 200 && <div style={{ padding:'8px 12px', fontSize:11, color:'#94a3b8' }}>Showing first 200 — refine the search to narrow.</div>}
        </div>
      )}
    </div>
  )
}
const th = { padding:'9px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, background:'#f8fafc', whiteSpace:'nowrap', textAlign:'left', position:'sticky', top:0 }
