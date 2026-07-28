// src/pages/shared/FeeLookup.jsx — carrier fee schedule lookup.
// Mounted for TCs (treatment planning), Ridgeview, and Collections.
// Search any code or description; see the office fee and every carrier's
// allowed fee side by side. Import/refresh the fee workbook in place.

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { USD } from '../../lib/helpers'
import { loadFeeTable, parseFeeFile, importFeeSchedules, importSingleCarrier, feeHistory, CARRIER_LABELS, FEE_GROUPS } from '../../lib/feeSchedules'

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
  const [group, setGroup] = useState('740480')
  const fileRef = useRef(null)

  const load = () => loadFeeTable().then(setData).catch(() => setData({ table: {}, latest: null, count: 0 }))
  useEffect(() => { load() }, [])

  const carriers = useMemo(() => {
    const set = new Set()
    Object.values(data?.table || {}).forEach(c => {
      for (const [k, groups] of Object.entries(c)) {
        if (k === 'office' || groups[group] != null || groups.all != null) set.add(k)
      }
    })
    const order = ['office','aetna','ameritas','bcbs','careington','cigna','concordia','delta','geha','guardian','humana','liberty','llp','metlife','principal','private','uhc','uhc2000']
    return order.filter(k => set.has(k))
  }, [data, group])

  const cellFee = (fees, c) => {
    const g = fees[c]
    if (!g) return null
    if (c === 'office') return g.all ?? Object.values(g)[0] ?? null
    return g[group] ?? g.all ?? null
  }

  const rows = useMemo(() => {
    const all = Object.entries(data?.table || {}).map(([code, fees]) => ({ code, desc: DESC[code] || '', fees }))
    const s = q.trim().toUpperCase()
    const filtered = !s ? all : all.filter(r => r.code.includes(s) || r.desc.toUpperCase().includes(s))
    return filtered.sort((a, b) => a.code.localeCompare(b.code)).slice(0, 200)
  }, [data, q])

  const [pending, setPending] = useState(null)   // parsed single-carrier file awaiting confirmation
  const [pendCarrier, setPendCarrier] = useState('')
  const [pendGroup, setPendGroup] = useState('740480')

  const handleImport = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    e.target.value = ''
    setImporting(true)
    try {
      const parsed = await parseFeeFile(file)
      if (parsed.mode === 'multi') {
        if (!parsed.entries.length) throw new Error('No fee rows found in that file')
        const diff = await importFeeSchedules(parsed.entries, 400, user?.name || user?.username)
        notify(`Fee schedules updated ✓ ${parsed.codes} codes × ${parsed.carriers.length} columns — ${diff.changed} rates changed, ${diff.added} new, ${diff.unchanged} unchanged`)
        load()
      } else {
        // single-carrier file: identity usually self-declared via "Fee Schedule Name:"
        setPending({ items: parsed.items, count: parsed.count, fileName: file.name, scheduleName: parsed.scheduleName, groupGuess: parsed.groupGuess })
        setPendCarrier(parsed.carrierGuess || '')
        setPendGroup(parsed.groupGuess || group)
        notify(parsed.carrierGuess
          ? `"${parsed.scheduleName || file.name}" recognized: ${parsed.count} codes — confirm below to import`
          : `Single-carrier schedule detected: ${parsed.count} codes — choose the carrier below to finish`)
      }
    } catch (err) { notify('Import failed: ' + err.message, 'error') }
    setImporting(false)
  }

  const confirmSingle = async () => {
    if (!pendCarrier) { notify('Pick which carrier these rates belong to', 'error'); return }
    setImporting(true)
    try {
      const diff = await importSingleCarrier(pending.items, pendCarrier, pendCarrier==='office' ? 'all' : pendGroup, user?.name || user?.username)
      notify(`${CARRIER_LABELS[pendCarrier]} (${pendCarrier==='office'?'all offices':pendGroup}) imported ✓ ${pending.count} codes — ${diff.changed} changed, ${diff.added} new, ${diff.unchanged} unchanged`)
      setPending(null)
      load()
    } catch (err) { notify('Import failed: ' + err.message, 'error') }
    setImporting(false)
  }

  const ageDays = data?.latest ? Math.floor((Date.now() - new Date(data.latest).getTime()) / 86400000) : null
  const [histCode, setHistCode] = useState(null)
  const [hist, setHist] = useState(null)
  const openHistory = async (code) => {
    if (histCode === code) { setHistCode(null); return }
    setHistCode(code); setHist(null)
    setHist(await feeHistory(code))
  }
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
        <div style={{ display:'flex', gap:4, background:'#f1f5f9', borderRadius:9, padding:3 }}>
          {['740480','663569'].map(g=>(
            <button key={g} onClick={()=>setGroup(g)}
              style={{ padding:'8px 14px', borderRadius:7, border:'none', cursor:'pointer', fontSize:12, fontWeight:800,
                background:group===g?'white':'transparent', color:group===g?NAVY:'#94a3b8',
                boxShadow:group===g?'0 1px 3px rgba(0,0,0,.1)':'none' }}>{g}</button>
          ))}
        </div>
        <button type="button" onClick={()=>{ if(!importing && fileRef.current){ fileRef.current.value=''; fileRef.current.click() } }}
          style={{ padding:'10px 18px', borderRadius:9, background:importing?'#5eead4':TEAL, color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer' }}>
          {importing ? 'Importing…' : '⬆ Import / Update Fee Workbook'}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleImport} style={{ display:'none' }}/>
      </div>

      {pending && (
        <div style={{ ...card, border:'2px solid #C9A84C', background:'#fffdf5' }}>
          <div style={{ fontSize:13, fontWeight:800, color:NAVY, marginBottom:6 }}>
            📄 {pending.fileName} — {pending.count} codes ready. Which carrier is this schedule for?
          </div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
            <select value={pendCarrier} onChange={e=>setPendCarrier(e.target.value)}
              style={{ padding:'9px 12px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:13, fontWeight:700, minWidth:180 }}>
              <option value="">Choose carrier…</option>
              {Object.entries(CARRIER_LABELS).map(([k,l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {pendCarrier!=='office' && (
              <select value={pendGroup} onChange={e=>setPendGroup(e.target.value)}
                style={{ padding:'9px 12px', borderRadius:9, border:'1px solid #e2e8f0', fontSize:13, fontWeight:700 }}>
                <option value="740480">Group 740480</option>
                <option value="663569">Group 663569</option>
                <option value="all">All offices</option>
              </select>
            )}
            <button onClick={confirmSingle} disabled={importing}
              style={{ padding:'9px 18px', borderRadius:9, background:GREEN, color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer' }}>
              {importing ? 'Importing…' : '✓ Import as selected carrier'}
            </button>
            <button onClick={()=>setPending(null)}
              style={{ padding:'9px 14px', borderRadius:9, background:'white', color:'#64748b', border:'1px solid #e2e8f0', fontWeight:700, fontSize:12, cursor:'pointer' }}>
              Cancel
            </button>
            <div style={{ fontSize:11, color:'#94a3b8' }}>Sample: {pending.items.slice(0,4).map(i=>i.code+' $'+i.fee).join(' · ')}</div>
          </div>
        </div>
      )}

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
                  <td onClick={()=>openHistory(r.code)} title="Click for rate history"
                    style={{ padding:'7px 10px', fontWeight:800, color:BLUE, whiteSpace:'nowrap', cursor:'pointer', textDecoration: histCode===r.code?'underline':'none' }}>{r.code}</td>
                  <td style={{ padding:'7px 10px', color:'#64748b' }}>{r.desc}</td>
                  {carriers.map(c => {
                    const f = cellFee(r.fees, c)
                    return (
                      <td key={c} style={{ padding:'7px 10px', textAlign:'right', fontWeight:c==='office'?800:600,
                        color: f==null ? '#e2e8f0' : c==='office' ? NAVY : '#334155',
                        background: c==='office' ? '#eff6ff44' : 'transparent' }}>
                        {f!=null ? USD(f) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 200 && <div style={{ padding:'8px 12px', fontSize:11, color:'#94a3b8' }}>Showing first 200 — refine the search to narrow.</div>}
        </div>
      )}

      {histCode && (
        <div style={{ ...card, border:'2px solid #93c5fd' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
            <div style={{ fontSize:13, fontWeight:800, color:NAVY }}>Rate history — {histCode}</div>
            <button onClick={()=>setHistCode(null)} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', fontSize:14 }}>✕</button>
          </div>
          {hist===null && <div style={{ fontSize:12, color:'#94a3b8' }}>Loading…</div>}
          {hist && hist.length===0 && <div style={{ fontSize:12, color:'#94a3b8' }}>No recorded changes for this code yet — history starts accumulating from the first import after the history table was added.</div>}
          {hist && hist.length>0 && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <tr><th style={th}>DATE</th><th style={th}>CARRIER</th><th style={{...th,textAlign:'right'}}>OLD</th><th style={{...th,textAlign:'right'}}>NEW</th><th style={{...th,textAlign:'right'}}>Δ</th><th style={th}>BY</th></tr>
              {hist.map(h=>{
                const delta = h.old_fee==null ? null : Math.round((h.new_fee-h.old_fee)*100)/100
                return (
                  <tr key={h.id} style={{ borderTop:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'6px 10px', color:'#64748b' }}>{String(h.changed_at).slice(0,10)}</td>
                    <td style={{ padding:'6px 10px', fontWeight:700 }}>{CARRIER_LABELS[h.carrier_group]||h.carrier_group}{h.fee_group&&h.fee_group!=='all'?' · '+h.fee_group:''}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right', color:'#94a3b8' }}>{h.old_fee==null?'new':USD(h.old_fee)}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:800 }}>{USD(h.new_fee)}</td>
                    <td style={{ padding:'6px 10px', textAlign:'right', fontWeight:800, color: delta==null?'#94a3b8':delta>0?GREEN:delta<0?'#dc2626':'#94a3b8' }}>
                      {delta==null?'—':(delta>0?'+':'')+USD(delta).replace('$-','-$')}</td>
                    <td style={{ padding:'6px 10px', color:'#94a3b8' }}>{h.changed_by||'—'}</td>
                  </tr>
                )
              })}
            </table>
          )}
        </div>
      )}
    </div>
  )
}
const th = { padding:'9px 10px', fontSize:9, fontWeight:800, color:'#94a3b8', letterSpacing:.5, background:'#f8fafc', whiteSpace:'nowrap', textAlign:'left', position:'sticky', top:0 }
