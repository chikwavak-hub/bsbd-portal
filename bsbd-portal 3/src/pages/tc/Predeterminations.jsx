import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus, IcoCheck, IcoAlert, IcoX, IcoChevD, IcoChevU, IcoRefresh, IcoDL, IcoPrint } from '../../components/icons'
import { LBL } from '../../components/ui'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'
import { N, USD, todayStr, fmtDate, downloadCSV } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'

const STATUS_META = {
  pending:           { label: 'Pending',             color: '#d97706', bg: '#fef3c7', icon: '⏳' },
  approved:          { label: 'Approved',             color: '#16a34a', bg: '#dcfce7', icon: '✓' },
  denied:            { label: 'Denied',               color: '#dc2626', bg: '#fee2e2', icon: '✕' },
  resubmitted:       { label: 'Resubmitted',          color: '#7c3aed', bg: '#f5f3ff', icon: '↻' },
  approved_resubmit: { label: 'Approved (Resubmit)',  color: '#0d9488', bg: '#f0fdfa', icon: '✓↻' },
  closed:            { label: 'Closed',               color: '#94a3b8', bg: '#f1f5f9', icon: '—' },
}

const BLANK = {
  id:'', office:'', patient_name:'', patient_name_norm:'',
  carrier:'', tx_plan:'', procedures:[],
  submitted_date:'', submitted_by:'',
  pred_sent:false, pred_received:false, received_date:'',
  status:'pending', approved_amount:0,
  denial_reason:'', resubmit_date:'', resubmit_notes:'', notes:'', tc_patient_id:'',
}

function normalizeName(n) {
  return (n||'').replace(/\([^)]+\)/g,'').replace(/[^A-Za-z\s]/g,'').trim().toUpperCase().split(/\s+/).join(' ')
}

// ── Add / Edit Modal ────────────────────────────────────────────────────────
function PredModal({ initial, onSave, onClose, user, isManager, tcPatients, offices }) {
  const [form, setForm] = useState({ ...BLANK, office: user?.office || offices[0], submitted_by: user?.name || '', ...initial })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.patient_name.trim()) { alert('Patient name required'); return }
    setSaving(true)
    const row = {
      ...form,
      id: form.id || 'pred_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
      patient_name_norm: normalizeName(form.patient_name),
      approved_amount: N(form.approved_amount) || 0,
      updated_at: new Date().toISOString(),
      created_at: form.created_at || new Date().toISOString(),
    }
    await sbPost('predeterminations', row, true)
    onSave(row)
    setSaving(false)
  }

  const sm = STATUS_META[form.status] || STATUS_META.pending

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
      <div style={{ background:'white', borderRadius:16, width:'100%', maxWidth:660, maxHeight:'90vh', overflowY:'auto', boxShadow:'0 25px 60px rgba(0,0,0,.3)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 24px', borderBottom:'1px solid #e2e8f0' }}>
          <h2 style={{ fontSize:17, fontWeight:800, color:'#1e293b', margin:0 }}>{form.id ? 'Update Predetermination' : 'New Predetermination'}</h2>
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}><IcoX size={20}/></button>
        </div>

        <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>
          {/* Patient + office */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={LBL}>Patient Name</label>
              <input className="ic" value={form.patient_name} onChange={e=>set('patient_name',e.target.value)} placeholder="Full patient name"/>
              {/* TC patient match hint */}
              {form.patient_name.length > 2 && (() => {
                const norm = normalizeName(form.patient_name)
                const match = tcPatients.find(p => normalizeName(p.patient_name).includes(norm.split(' ')[0]) && normalizeName(p.patient_name).includes(norm.split(' ').pop()))
                return match ? <div style={{ fontSize:10, color:'#0d9488', marginTop:3, fontWeight:600 }}>✓ Matches TC patient: {match.patient_name}</div> : null
              })()}
            </div>
            {isManager && <div>
              <label style={LBL}>Office</label>
              <select className="ic" value={form.office} onChange={e=>set('office',e.target.value)}>
                {offices.map(o=><option key={o}>{o}</option>)}
              </select>
            </div>}
          </div>

          {/* Carrier + TX Plan */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
            <div>
              <label style={LBL}>Insurance Carrier</label>
              <input className="ic" value={form.carrier} onChange={e=>set('carrier',e.target.value)} placeholder="e.g. Delta Dental"/>
            </div>
            <div>
              <label style={LBL}>Treatment Plan / Description</label>
              <input className="ic" value={form.tx_plan} onChange={e=>set('tx_plan',e.target.value)} placeholder="e.g. Full arch implants, 4 crowns"/>
            </div>
          </div>

          {/* Submission info */}
          <div style={{ background:'#f8fafc', borderRadius:10, padding:'14px 16px', border:'1px solid #e2e8f0' }}>
            <div style={{ fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:1, marginBottom:10 }}>SUBMISSION</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:10 }}>
              <div>
                <label style={LBL}>Date Submitted</label>
                <input type="date" className="ic" value={form.submitted_date} onChange={e=>set('submitted_date',e.target.value)}/>
              </div>
              <div>
                <label style={LBL}>Submitted By</label>
                <input className="ic" value={form.submitted_by} onChange={e=>set('submitted_by',e.target.value)}/>
              </div>
              <div style={{ paddingTop:18 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={form.pred_sent} onChange={e=>set('pred_sent',e.target.checked)} style={{ width:16, height:16 }}/>
                  <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>Pre-D Sent</span>
                </label>
              </div>
            </div>
          </div>

          {/* Response info */}
          <div style={{ background:'#f8fafc', borderRadius:10, padding:'14px 16px', border:'1px solid #e2e8f0' }}>
            <div style={{ fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:1, marginBottom:10 }}>INSURANCE RESPONSE</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:10 }}>
              <div style={{ paddingTop:18 }}>
                <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
                  <input type="checkbox" checked={form.pred_received} onChange={e=>set('pred_received',e.target.checked)} style={{ width:16, height:16 }}/>
                  <span style={{ fontSize:13, fontWeight:600, color:'#1e293b' }}>Response Received</span>
                </label>
              </div>
              <div>
                <label style={LBL}>Date Received</label>
                <input type="date" className="ic" value={form.received_date} onChange={e=>set('received_date',e.target.value)}/>
              </div>
              <div>
                <label style={LBL}>Status</label>
                <select className="ic" value={form.status} onChange={e=>set('status',e.target.value)}>
                  {Object.entries(STATUS_META).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              <div>
                <label style={LBL}>Approved Amount</label>
                <div style={{ position:'relative' }}>
                  <span style={{ position:'absolute', left:8, top:'50%', transform:'translateY(-50%)', color:'#94a3b8', fontSize:13 }}>$</span>
                  <input type="number" className="ic" style={{ paddingLeft:22 }} value={form.approved_amount||''} onChange={e=>set('approved_amount',e.target.value)} placeholder="0.00"/>
                </div>
              </div>
              {form.status==='denied' && <div>
                <label style={LBL}>Denial Reason</label>
                <input className="ic" value={form.denial_reason} onChange={e=>set('denial_reason',e.target.value)} placeholder="Reason for denial"/>
              </div>}
            </div>
          </div>

          {/* Resubmission */}
          {(form.status==='denied'||form.status==='resubmitted') && (
            <div style={{ background:'#f5f3ff', borderRadius:10, padding:'14px 16px', border:'1px solid #ddd6fe' }}>
              <div style={{ fontSize:10, fontWeight:800, color:'#7c3aed', letterSpacing:1, marginBottom:10 }}>RESUBMISSION</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                <div>
                  <label style={LBL}>Resubmit Date</label>
                  <input type="date" className="ic" value={form.resubmit_date} onChange={e=>set('resubmit_date',e.target.value)}/>
                </div>
                <div>
                  <label style={LBL}>Resubmit Notes</label>
                  <input className="ic" value={form.resubmit_notes} onChange={e=>set('resubmit_notes',e.target.value)} placeholder="What changed in resubmission"/>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={LBL}>Notes</label>
            <textarea className="ic" style={{ minHeight:60, resize:'vertical' }} value={form.notes} onChange={e=>set('notes',e.target.value)} placeholder="Additional notes…"/>
          </div>

          {/* Status badge preview */}
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:12, color:'#64748b' }}>Current status:</span>
            <span style={{ fontSize:12, fontWeight:700, padding:'3px 12px', borderRadius:99, background:sm.bg, color:sm.color }}>{sm.icon} {sm.label}</span>
          </div>
        </div>

        <div style={{ padding:'14px 24px', borderTop:'1px solid #e2e8f0', display:'flex', justifyContent:'flex-end', gap:10 }}>
          <button onClick={onClose} style={{ padding:'9px 20px', borderRadius:9, border:'1px solid #e2e8f0', background:'white', color:'#475569', fontWeight:700, fontSize:13, cursor:'pointer' }}>Cancel</button>
          <button onClick={save} disabled={saving} style={{ padding:'9px 24px', borderRadius:9, background:saving?'#86efac':'#1d4ed8', color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer' }}>
            {saving?'Saving…':'Save Predetermination'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────
export default function PredeterminationsPage({ user, isManager, tcPatients=[], users=[] }) {
  const [preds,    setPreds]    = useState([])
  const [loading,  setLoading]  = useState(false)
  const [office,   setOffice]   = useState(user?.office || OFFICES[0])
  const [filterSt, setFilterSt] = useState('all')
  const [search,   setSearch]   = useState('')
  const [showModal,setShowModal]= useState(false)
  const [editItem, setEditItem] = useState(null)
  const [toast,    setToast]    = useState(null)

  const notify = (msg, type='success') => { setToast({msg,type}); setTimeout(()=>setToast(null),4000) }

  const load = async () => {
    setLoading(true)
    try {
      const rows = await sbGet('predeterminations',
        `office=eq.${encodeURIComponent(office)}&order=updated_at.desc`)
      setPreds(rows)
    } catch(e) { notify('Load failed: '+e.message,'error') }
    setLoading(false)
  }

  useEffect(()=>{ load() },[office])

  const handleSave = (row) => {
    setPreds(prev => {
      const exists = prev.find(p=>p.id===row.id)
      return exists ? prev.map(p=>p.id===row.id?row:p) : [row,...prev]
    })
    setShowModal(false); setEditItem(null)
    notify(row.id?'Updated ✓':'Predetermination added ✓')
  }

  const del = async (id) => {
    if (!window.confirm('Delete this predetermination?')) return
    await sbDel('predeterminations','id=eq.'+id)
    setPreds(prev=>prev.filter(p=>p.id!==id))
    notify('Deleted')
  }

  // Stats
  const total    = preds.length
  const pending  = preds.filter(p=>p.status==='pending').length
  const sent     = preds.filter(p=>p.pred_sent).length
  const received = preds.filter(p=>p.pred_received).length
  const approved = preds.filter(p=>['approved','approved_resubmit'].includes(p.status)).length
  const denied   = preds.filter(p=>p.status==='denied').length
  const approvedAmt = preds.filter(p=>['approved','approved_resubmit'].includes(p.status)).reduce((s,p)=>s+N(p.approved_amount),0)

  const filtered = preds.filter(p => {
    if (filterSt !== 'all' && p.status !== filterSt) return false
    if (search && !p.patient_name.toLowerCase().includes(search.toLowerCase()) && !p.carrier.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const csv = () => downloadCSV(
    ['Patient','Carrier','TX Plan','Submitted','Sent','Received','Status','Approved Amt','Denial Reason','Notes'],
    filtered.map(p=>[p.patient_name,p.carrier,p.tx_plan,p.submitted_date,p.pred_sent?'Yes':'No',p.pred_received?'Yes':'No',STATUS_META[p.status]?.label||p.status,p.approved_amount||0,p.denial_reason,p.notes]),
    'Predeterminations_'+office
  )

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:'24px 20px 60px' }}>
      {toast&&<div style={{ position:'fixed', top:20, right:20, zIndex:9999, padding:'12px 20px', borderRadius:12, boxShadow:'0 10px 30px rgba(0,0,0,.15)', color:'white', fontSize:13, fontWeight:600, background:toast.type==='error'?'#ef4444':'#10b981', maxWidth:360 }}>{toast.msg}</div>}

      {showModal && (
        <PredModal initial={editItem||{}} onSave={handleSave} onClose={()=>{setShowModal(false);setEditItem(null)}}
          user={user} isManager={isManager} tcPatients={tcPatients}
          offices={isManager?OFFICES:[user?.office||OFFICES[0]]}/>
      )}

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ fontSize:24, fontWeight:800, color:'#1e293b', margin:0 }}>Predeterminations</h1>
          <p style={{ color:'#94a3b8', fontSize:13, marginTop:3 }}>Track pre-d submissions, responses, approvals and resubmissions</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={load} style={{ display:'flex', alignItems:'center', gap:5, padding:'8px 12px', borderRadius:8, border:'1px solid #e2e8f0', background:'white', color:'#475569', fontWeight:600, fontSize:12, cursor:'pointer' }}><IcoRefresh size={13}/> Refresh</button>
          <button onClick={csv} disabled={!filtered.length} style={{ display:'flex', alignItems:'center', gap:5, padding:'8px 14px', borderRadius:8, background:filtered.length?'#1d4ed8':'#f1f5f9', color:filtered.length?'white':'#94a3b8', border:'none', fontWeight:700, fontSize:12, cursor:'pointer' }}><IcoDL size={13}/> CSV</button>
          <button onClick={()=>{setEditItem(null);setShowModal(true)}} style={{ display:'flex', alignItems:'center', gap:6, padding:'9px 18px', borderRadius:10, background:'#1d4ed8', color:'white', border:'none', fontWeight:700, fontSize:13, cursor:'pointer' }}>
            <IcoPlus size={14}/> New Pre-D
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'14px 16px', marginBottom:16, display:'flex', gap:10, flexWrap:'wrap', alignItems:'flex-end' }}>
        {isManager && <div style={{ flex:'1 1 120px' }}>
          <label style={LBL}>Office</label>
          <select className="ic" value={office} onChange={e=>setOffice(e.target.value)}>
            {OFFICES.map(o=><option key={o}>{o}</option>)}
          </select>
        </div>}
        <div style={{ flex:'1 1 140px' }}>
          <label style={LBL}>Status</label>
          <select className="ic" value={filterSt} onChange={e=>setFilterSt(e.target.value)}>
            <option value="all">All ({total})</option>
            {Object.entries(STATUS_META).map(([k,v])=>(
              <option key={k} value={k}>{v.icon} {v.label} ({preds.filter(p=>p.status===k).length})</option>
            ))}
          </select>
        </div>
        <div style={{ flex:'1 1 180px' }}>
          <label style={LBL}>Search</label>
          <input className="ic" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Patient name or carrier…"/>
        </div>
      </div>

      {/* Summary */}
      {preds.length > 0 && (
        <div style={{ background:'linear-gradient(135deg,#1d4ed8,#7c3aed)', borderRadius:12, padding:'14px 20px', marginBottom:16, color:'white', display:'flex', flexWrap:'wrap', gap:0 }}>
          {[
            ['TOTAL',    total,               null],
            ['SENT',     sent,                null],
            ['RECEIVED', received,            null],
            ['PENDING',  pending,             pending>0?'#fde68a':null],
            ['APPROVED', approved,            '#86efac'],
            ['DENIED',   denied,              denied>0?'#f87171':null],
            ['APPROVED $',USD(approvedAmt),   '#86efac'],
          ].map(([l,v,c],i)=>(
            <div key={i} style={{ flex:'1 1 80px', padding:'0 14px', borderLeft:i>0?'1px solid rgba(255,255,255,.2)':'none' }}>
              <div style={{ fontSize:9, opacity:.6, letterSpacing:1, fontWeight:700, marginBottom:2 }}>{l}</div>
              <div style={{ fontSize:16, fontWeight:800, color:c||'white' }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && preds.length === 0 && (
        <div style={{ textAlign:'center', padding:'60px 20px', background:'white', borderRadius:12, border:'2px dashed #e2e8f0' }}>
          <div style={{ fontSize:40, marginBottom:12 }}>📋</div>
          <div style={{ fontSize:16, fontWeight:700, color:'#1e293b', marginBottom:8 }}>No predeterminations yet</div>
          <button onClick={()=>setShowModal(true)} style={{ padding:'10px 24px', borderRadius:10, background:'#1d4ed8', color:'white', border:'none', fontWeight:700, fontSize:14, cursor:'pointer' }}>+ Add First Pre-D</button>
        </div>
      )}

      {loading && <div style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>Loading…</div>}

      {/* Table */}
      {!loading && filtered.length > 0 && (
        <div style={{ background:'white', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                  {['Patient','Carrier','TX Plan','Submitted','Sent','Received','Status','Approved $','Actions'].map(h=>(
                    <th key={h} style={{ padding:'10px 12px', textAlign:'left', fontSize:10, fontWeight:800, color:'#64748b', letterSpacing:.5, whiteSpace:'nowrap' }}>{h.toUpperCase()}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p=>{
                  const sm = STATUS_META[p.status]||STATUS_META.pending
                  const isOld = p.pred_sent && !p.pred_received && p.submitted_date && (new Date()-new Date(p.submitted_date))>1000*60*60*24*30
                  return(
                    <tr key={p.id} style={{ borderBottom:'1px solid #f1f5f9', background:isOld?'#fffbeb':'white' }}
                      onMouseEnter={e=>e.currentTarget.style.background=isOld?'#fef9ec':'#f8fafc'}
                      onMouseLeave={e=>e.currentTarget.style.background=isOld?'#fffbeb':'white'}>
                      <td style={{ padding:'10px 12px', fontWeight:700, fontSize:13, color:'#1e293b', whiteSpace:'nowrap' }}>
                        {p.patient_name}
                        {isOld&&<div style={{ fontSize:10, color:'#d97706', fontWeight:600 }}>⚠ 30+ days — follow up</div>}
                      </td>
                      <td style={{ padding:'10px 12px', fontSize:12, color:'#475569' }}>{p.carrier||'—'}</td>
                      <td style={{ padding:'10px 12px', fontSize:11, color:'#64748b', maxWidth:160, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.tx_plan||'—'}</td>
                      <td style={{ padding:'10px 12px', fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>{p.submitted_date?fmtDate(p.submitted_date):'—'}</td>
                      <td style={{ padding:'10px 12px', textAlign:'center' }}>
                        <span style={{ fontSize:14 }}>{p.pred_sent?'✓':'—'}</span>
                      </td>
                      <td style={{ padding:'10px 12px', textAlign:'center' }}>
                        <span style={{ fontSize:14, color:p.pred_received?'#16a34a':'#94a3b8' }}>{p.pred_received?'✓ '+fmtDate(p.received_date):'—'}</span>
                      </td>
                      <td style={{ padding:'10px 12px', whiteSpace:'nowrap' }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:99, background:sm.bg, color:sm.color }}>{sm.icon} {sm.label}</span>
                        {p.status==='denied'&&p.denial_reason&&<div style={{ fontSize:10, color:'#dc2626', marginTop:2 }}>{p.denial_reason.slice(0,40)}</div>}
                        {p.status==='resubmitted'&&p.resubmit_date&&<div style={{ fontSize:10, color:'#7c3aed', marginTop:2 }}>Resubmit: {fmtDate(p.resubmit_date)}</div>}
                      </td>
                      <td style={{ padding:'10px 12px', fontSize:13, fontWeight:700, color:N(p.approved_amount)>0?'#16a34a':'#94a3b8' }}>
                        {N(p.approved_amount)>0?USD(p.approved_amount):'—'}
                      </td>
                      <td style={{ padding:'10px 12px', whiteSpace:'nowrap' }}>
                        <div style={{ display:'flex', gap:6 }}>
                          <button onClick={()=>{setEditItem(p);setShowModal(true)}} style={{ padding:'5px 12px', borderRadius:7, background:'#eff6ff', color:'#1d4ed8', border:'none', fontWeight:600, fontSize:11, cursor:'pointer' }}>Edit</button>
                          <button onClick={()=>del(p.id)} style={{ padding:'5px 10px', borderRadius:7, background:'#fef2f2', color:'#dc2626', border:'none', fontWeight:600, fontSize:11, cursor:'pointer' }}>Del</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ padding:'10px 16px', borderTop:'1px solid #f1f5f9', fontSize:11, color:'#94a3b8' }}>
            {filtered.length} predetermination{filtered.length!==1?'s':''} · Amber rows = 30+ days without response
          </div>
        </div>
      )}
    </div>
  )
}
