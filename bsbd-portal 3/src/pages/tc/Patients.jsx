import React, { useState, useEffect, useMemo } from 'react'
import { IcoPlus, IcoX, IcoCheck, IcoEdit, IcoPhone, IcoMail, IcoChevD, IcoChevU, IcoAlert, IcoClock, IcoSave } from '../../components/icons'
import { LBL, CARD, NF } from '../../components/ui'
import { N, USD, PCT, todayStr, fmtDate } from '../../lib/helpers'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'

// ── Constants ──────────────────────────────────────────────────────────────
const EXAM_TYPES    = ['Comp/FMX','Limited/PA','Consult','PANO','LOE','Comp/2bws','TX/Fillings']
const HAS_APPT_OPTS = ['Yes','No','Partial']
const EMAIL_OPTS    = ['Yes','No','Not needed']
const BARRIER_TYPES = ['','CareCredit pending','Sunbit pending','Insurance issue','Re-present needed','Patient deciding','No finances','Other']
const DOCTORS       = ['Dr. E','Dr. Chikwava','Dr. Phillips','Laura','Melissa']
const FINANCE_KEYWORDS = ['carecredit','sunbit','finance','thinking about it','not financially','not ready','will call','going through with it','speak with wife','speak with husband','denied','rejected']

const BLANK = () => ({
  id:             'tp_'+Date.now()+'_'+Math.random().toString(36).slice(2,7),
  office:         '',
  doctor:         '',
  dos:            todayStr(),
  month_tab:      todayStr().slice(0,7),

  // Patient
  patient_name:   '',
  patient_phone:  '',
  patient_email:  '',

  // TC
  who_tx_plan:    '',
  who_sched:      '',
  assigned_tc_name: '',

  // Exam
  exam_type:      '',
  notes:          '',

  // Appointments
  appt_1:         '',
  appt_2:         '',
  appt_3:         '',
  appt_hyg:       '',
  has_appt:       '',
  email_sent:     '',

  // Calls
  call_1_date:    '',  call_1_notes: '',
  call_2_date:    '',  call_2_notes: '',
  call_3_date:    '',  call_3_notes: '',

  // Financial
  total_tx_cost:  '',
  sched_tx_amount:'',
  ins_expected:   '',
  tx_completed:   '',

  // Finance barrier
  finance_stalled: false,
  finance_barrier: '',

  // Status
  status:         'consult',
  remarks:        '',
  tx_plan:        null,
  visits:         [],
  created_at:     new Date().toISOString(),
  updated_at:     new Date().toISOString(),
})

// ── Auto-detect finance stall from notes/remarks ───────────────────────────
function detectFinanceStall(notes, remarks) {
  const text = ((notes||'') + ' ' + (remarks||'')).toLowerCase()
  return FINANCE_KEYWORDS.some(k => text.includes(k))
}

// ── Month label helpers ────────────────────────────────────────────────────
function monthLabel(m) {
  if (!m) return ''
  const [y, mo] = m.split('-')
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][parseInt(mo)-1] + ' ' + y
}
function getMonthTabs(patients) {
  const months = [...new Set(patients.map(p => p.month_tab || p.dos?.slice(0,7)).filter(Boolean))]
  return months.sort().reverse()
}

// ── Predictive flags ───────────────────────────────────────────────────────
function getFlags(p) {
  const flags = []
  const today = new Date(todayStr())
  const daysSince = d => d ? Math.floor((today - new Date(d)) / 86400000) : 999

  // No appointment
  if (p.has_appt === 'No' || (!p.has_appt && !p.appt_1)) flags.push({type:'no_appt', label:'No Appt', color:'#dc2626'})

  // Call overdue (has no appt + last call was 5+ days ago or never)
  if (p.has_appt !== 'Yes') {
    const lastCall = p.call_3_date || p.call_2_date || p.call_1_date
    if (!lastCall) flags.push({type:'needs_call', label:'Call Needed', color:'#d97706'})
    else if (daysSince(lastCall) >= 5) flags.push({type:'overdue_call', label:'Call Overdue '+daysSince(lastCall)+'d', color:'#d97706'})
  }

  // Finance stalled
  if (p.finance_stalled || detectFinanceStall(p.notes, p.remarks))
    flags.push({type:'finance', label:'Finance Stall', color:'#7c3aed'})

  // Recall needed — hyg appt past due or missing with completed tx
  if (N(p.tx_completed) > 0 && !p.appt_hyg)
    flags.push({type:'recall', label:'Recall Needed', color:'#0d9488'})

  // Tx incomplete — completed < 80% of total
  const pct = p.total_tx_cost > 0 ? N(p.tx_completed) / N(p.total_tx_cost) : null
  if (pct !== null && pct < 0.8 && N(p.tx_completed) > 0)
    flags.push({type:'incomplete', label:'TX Incomplete', color:'#1d4ed8'})

  return flags
}

// ── Row expand/edit panel ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════════════
// PHASE 2 — CADENCE ENGINE + AI EMAIL
// ════════════════════════════════════════════════════════════════════════════

// ── Cadence engine ────────────────────────────────────────────────────────
const CADENCE_DAYS = [
  { day: 3,  label: 'Day 3 Call',     call: 'call_1_date' },
  { day: 5,  label: 'Day 5 Call',     call: 'call_2_date' },
  { day: 10, label: 'Day 10 Call',    call: 'call_3_date' },
  { day: 14, label: 'Escalate',       call: null          },
]

function getCadence(p) {
  if (p.has_appt === 'Yes') return { status: 'complete', label: 'Appt Booked', color: '#16a34a', step: 4 }

  const dos = p.dos || p.consult_date
  if (!dos) return null

  const today   = new Date(todayStr())
  const dosDate = new Date(dos)
  const daysSinceDOS = Math.floor((today - dosDate) / 86400000)

  // Find the next call that hasn't been made yet
  for (let i = 0; i < CADENCE_DAYS.length; i++) {
    const stage   = CADENCE_DAYS[i]
    const hasMade = stage.call ? !!p[stage.call] : false

    if (!hasMade) {
      const daysOverdue = daysSinceDOS - stage.day
      if (stage.day > 14 || (i === 3 && daysSinceDOS >= 14)) {
        return { status: 'escalate', label: 'Escalate — '+daysSinceDOS+'d', color: '#dc2626', step: 3 }
      }
      if (daysOverdue > 0)
        return { status: 'overdue', label: stage.label+' overdue '+daysOverdue+'d', color: '#d97706', step: i, daysOverdue }
      if (daysOverdue === 0)
        return { status: 'due',     label: stage.label+' DUE TODAY', color: '#0d9488', step: i }
      return   { status: 'pending', label: stage.label+' in '+(stage.day - daysSinceDOS)+'d', color: '#64748b', step: i }
    }
  }
  return { status: 'done', label: '3 calls made', color: '#94a3b8', step: 3 }
}

function CadenceBar({ p }) {
  const cad = getCadence(p)
  if (!cad) return null

  const stepColors = ['#e2e8f0','#e2e8f0','#e2e8f0','#e2e8f0']
  for (let i = 0; i < cad.step; i++) stepColors[i] = '#16a34a'
  if (cad.status !== 'complete' && cad.status !== 'done') stepColors[cad.step] = cad.color

  return (
    <div style={{marginTop:8}}>
      <div style={{display:'flex', alignItems:'center', gap:4, marginBottom:4}}>
        {['D3','D5','D10','D14+'].map((d,i) => (
          <React.Fragment key={i}>
            <div style={{width:28, height:20, borderRadius:4, background:stepColors[i],
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:9, fontWeight:700, color:stepColors[i]==='#e2e8f0'?'#94a3b8':'white'}}>
              {d}
            </div>
            {i < 3 && <div style={{flex:1, height:2, background:stepColors[i]==='#16a34a'?'#16a34a':'#e2e8f0', borderRadius:1}}/>}
          </React.Fragment>
        ))}
      </div>
      <div style={{fontSize:10, fontWeight:700, color:cad.color}}>{cad.label}</div>
    </div>
  )
}

// ── AI Email modal ─────────────────────────────────────────────────────────
function EmailModal({ p, user, onClose, notify }) {
  const [loading,  setLoading]  = useState(false)
  const [subject,  setSubject]  = useState('Your Treatment Plan Summary — Beautiful Smiles by Design')
  const [body,     setBody]     = useState('')
  const [error,    setError]    = useState('')

  const generate = async () => {
    setLoading(true)
    setError('')
    try {
      const patientPortion = N(p.total_tx_cost) - N(p.ins_expected)
      const financeNote = p.finance_stalled
        ? `The patient has expressed a financial concern (${p.finance_barrier || 'finances'}). Mention financing options like CareCredit and Sunbit warmly.`
        : ''

      const prompt = `You are a warm, professional treatment coordinator at Beautiful Smiles by Design dental practice.

Write a follow-up email to a patient explaining their recommended treatment plan. Be clear, friendly, and encouraging — not clinical or pushy.

Patient: ${p.patient_name}
Doctor: ${p.doctor || 'Dr. Chikwava'}
Exam date: ${p.dos || ''}
Exam type: ${p.exam_type || ''}
Treatment notes: ${p.notes || ''}
Remarks: ${p.remarks || ''}
Total treatment cost: ${p.total_tx_cost ? '$' + N(p.total_tx_cost).toLocaleString() : 'not specified'}
Insurance expected to cover: ${p.ins_expected ? '$' + N(p.ins_expected).toLocaleString() : 'unknown'}
Patient estimated portion: ${patientPortion > 0 ? '$' + patientPortion.toLocaleString() : 'unknown'}
${financeNote}

Instructions:
- Address patient by first name only
- Briefly recap what was found/recommended at their exam
- Explain why the treatment matters (health outcome, not upselling)
- Show a simple cost breakdown: total cost, insurance covers X, your portion is Y
- If financing note above, mention CareCredit and Sunbit as easy monthly payment options
- End with a clear, friendly call to action to call or text us to schedule
- Sign off as ${user.name || 'Your Care Team'}, Beautiful Smiles by Design, Dalton office
- Keep it under 200 words
- Do NOT use markdown, headers, or bullet points — plain email text only`

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      })
      const data = await res.json()
      const text = data.content?.find(c => c.type === 'text')?.text || ''
      if (!text) throw new Error('No response from AI')
      setBody(text)
    } catch(e) {
      setError('Generation failed: ' + e.message)
      console.error(e)
    }
    setLoading(false)
  }

  const sendEmail = () => {
    const email = p.patient_email || ''
    const sub   = encodeURIComponent(subject)
    const bod   = encodeURIComponent(body)
    window.open('mailto:' + email + '?subject=' + sub + '&body=' + bod)
    notify('Email client opened ✓')
  }

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:400,display:'flex',
      alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div style={{background:'white',borderRadius:14,padding:24,width:'100%',maxWidth:620}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
          <div>
            <div style={{fontSize:15,fontWeight:800,color:'#1e293b'}}>TX Plan Email</div>
            <div style={{fontSize:12,color:'#64748b'}}>{p.patient_name} · {p.patient_email||'No email on file'}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:20,cursor:'pointer',color:'#94a3b8'}}>✕</button>
        </div>

        <div style={{marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:4}}>SUBJECT</div>
          <input value={subject} onChange={e=>setSubject(e.target.value)}
            style={{width:'100%',boxSizing:'border-box',padding:'8px 10px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}}/>
        </div>

        {!body && !loading && (
          <div style={{background:'#f8fafc',borderRadius:10,padding:20,textAlign:'center',marginBottom:12}}>
            <div style={{fontSize:13,color:'#64748b',marginBottom:12}}>
              AI will read the treatment notes and generate a patient-friendly email explaining their treatment, costs, and next steps.
            </div>
            <div style={{fontSize:12,color:'#94a3b8',marginBottom:14}}>
              Notes: {p.notes||'—'} · Cost: {p.total_tx_cost?'$'+N(p.total_tx_cost).toLocaleString():'not set'}
            </div>
            <button onClick={generate}
              style={{padding:'10px 24px',borderRadius:9,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
              Generate Email with AI
            </button>
          </div>
        )}

        {loading && (
          <div style={{background:'#f8fafc',borderRadius:10,padding:30,textAlign:'center',marginBottom:12}}>
            <div style={{fontSize:13,color:'#1d4ed8',fontWeight:600}}>Generating email…</div>
          </div>
        )}

        {error && <div style={{color:'#dc2626',fontSize:12,marginBottom:12}}>{error}</div>}

        {body && (
          <div style={{marginBottom:12}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
              <div style={{fontSize:10,fontWeight:700,color:'#64748b'}}>EMAIL BODY</div>
              <button onClick={generate} style={{fontSize:11,color:'#1d4ed8',background:'none',border:'none',cursor:'pointer',fontWeight:600}}>
                Regenerate
              </button>
            </div>
            <textarea value={body} onChange={e=>setBody(e.target.value)}
              style={{width:'100%',boxSizing:'border-box',minHeight:220,padding:'10px 12px',
                borderRadius:9,border:'1px solid #e2e8f0',fontSize:13,lineHeight:1.6,resize:'vertical'}}/>
          </div>
        )}

        <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
          <button onClick={onClose}
            style={{padding:'9px 18px',borderRadius:8,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>
            Cancel
          </button>
          {body && (
            <button onClick={()=>{navigator.clipboard.writeText(body);notify('Copied to clipboard ✓')}}
              style={{padding:'9px 18px',borderRadius:8,background:'#f8fafc',color:'#1e293b',border:'1px solid #e2e8f0',fontWeight:700,cursor:'pointer'}}>
              Copy
            </button>
          )}
          {body && (
            <button onClick={sendEmail}
              style={{padding:'9px 18px',borderRadius:8,background:'#0d9488',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>
              Open in Email
            </button>
          )}
        </div>
      </div>
    </div>
  )
}


// ── TX Plan Upload + Display Panel ────────────────────────────────────────
function TxPlanPanel({ p, onSave, notify }) {
  const [uploading, setUploading] = useState(false)
  const fileRef = React.useRef()

  const handleUpload = async (file) => {
    if (!file) return
    setUploading(true)
    try {
      const { extractTxPlanText, parseTxPlanText } = await import('../../lib/txPlanParser')
      const text   = await extractTxPlanText(file)
      const parsed = parseTxPlanText(text)
      if (!parsed.patient_name && parsed.visits.length === 0) {
        notify('Could not read this PDF -- check it is a Dentrix TX plan', 'error')
        setUploading(false)
        return
      }
      const updated = {
        ...p,
        tx_plan:        parsed,
        visits:         parsed.visits,
        total_tx_cost:  parsed.case_total  || p.total_tx_cost,
        ins_expected:   parsed.est_ins     || p.ins_expected,
        notes:          p.notes || (parsed.notes || ''),
        updated_at:     new Date().toISOString(),
      }
      await onSave(updated)
      notify('TX plan attached ✓')
    } catch(e) {
      notify('Upload failed: ' + e.message, 'error')
      console.error(e)
    }
    setUploading(false)
  }

  const plan = p.tx_plan
  const visits = p.visits || plan?.visits || []

  return (
    <div style={{background:'white',borderRadius:10,padding:14,border:'1px solid #e2e8f0',marginTop:10}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
        <div style={{fontSize:11,fontWeight:800,color:'#1e293b',letterSpacing:.5}}>TX PLAN</div>
        <label style={{padding:'5px 12px',borderRadius:7,background:'#1d4ed8',color:'white',
          fontWeight:700,fontSize:11,cursor:'pointer',whiteSpace:'nowrap'}}>
          {uploading ? 'Reading…' : plan ? 'Replace PDF' : 'Attach PDF'}
          <input ref={fileRef} type="file" accept=".pdf" style={{display:'none'}}
            onChange={e => { if(e.target.files[0]) handleUpload(e.target.files[0]) }}/>
        </label>
      </div>

      {!plan && !uploading && (
        <div style={{textAlign:'center',padding:'16px 0',color:'#94a3b8',fontSize:12}}>
          No TX plan attached — upload the accepted Dentrix PDF
        </div>
      )}

      {uploading && (
        <div style={{textAlign:'center',padding:'16px 0',color:'#1d4ed8',fontSize:12,fontWeight:600}}>
          Reading PDF…
        </div>
      )}

      {plan && !uploading && (
        <div>
          {/* Summary row */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(120px,1fr))',gap:8,marginBottom:12}}>
            {[
              ['Case Total',   plan.case_total,    '#1d4ed8'],
              ['Est Insurance',plan.est_ins,       '#0d9488'],
              ['Est Patient',  plan.est_patient,   '#d97706'],
              ['Write-Off',    plan.est_writeoff,  '#64748b'],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:'#f8fafc',borderRadius:8,padding:'8px 10px'}}>
                <div style={{fontSize:9,color:'#94a3b8',fontWeight:700,marginBottom:2}}>{l}</div>
                <div style={{fontSize:15,fontWeight:800,color:c}}>{v?'$'+N(v).toLocaleString():'—'}</div>
              </div>
            ))}
          </div>

          {/* Insurance info */}
          {(plan.ins_carrier || plan.ins_annual_max > 0) && (
            <div style={{background:'#f0f9ff',borderRadius:8,padding:'8px 12px',marginBottom:10,fontSize:12}}>
              <span style={{fontWeight:700,color:'#0369a1'}}>{plan.ins_carrier}</span>
              {plan.ins_annual_max > 0 && <span style={{color:'#64748b',marginLeft:8}}>Annual max: ${N(plan.ins_annual_max).toLocaleString()}</span>}
              {plan.ins_deductible > 0 && <span style={{color:'#64748b',marginLeft:8}}>Deductible: ${N(plan.ins_deductible).toLocaleString()}</span>}
            </div>
          )}

          {/* Visits & procedures */}
          {visits.length > 0 && (
            <div>
              <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,marginBottom:6}}>TREATMENT VISITS</div>
              {visits.map((v,vi)=>(
                <div key={vi} style={{marginBottom:8,border:'1px solid #f1f5f9',borderRadius:8,overflow:'hidden'}}>
                  <div style={{background:'#f8fafc',padding:'6px 10px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#1e293b'}}>Visit {v.visit_num || vi+1}</div>
                    <div style={{display:'flex',gap:12,fontSize:11}}>
                      <span style={{color:'#64748b'}}>Total: <b style={{color:'#1e293b'}}>{v.total?'$'+N(v.total).toLocaleString():'—'}</b></span>
                      <span style={{color:'#0d9488'}}>Ins: <b>${N(v.ins_total).toLocaleString()}</b></span>
                      <span style={{color:'#d97706'}}>Pt: <b>${N(v.pt_total).toLocaleString()}</b></span>
                    </div>
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                    <thead>
                      <tr style={{background:'#f1f5f9'}}>
                        <th style={{padding:'4px 8px',textAlign:'left',color:'#64748b',fontWeight:700}}>Code</th>
                        <th style={{padding:'4px 8px',textAlign:'left',color:'#64748b',fontWeight:700}}>Description</th>
                        <th style={{padding:'4px 8px',textAlign:'center',color:'#64748b',fontWeight:700}}>Tooth</th>
                        <th style={{padding:'4px 8px',textAlign:'right',color:'#64748b',fontWeight:700}}>Fee</th>
                        <th style={{padding:'4px 8px',textAlign:'right',color:'#64748b',fontWeight:700}}>Ins</th>
                        <th style={{padding:'4px 8px',textAlign:'right',color:'#64748b',fontWeight:700}}>Patient</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(v.procedures||[]).map((proc,pi)=>(
                        <tr key={pi} style={{borderTop:'1px solid #f8fafc',background:pi%2===0?'white':'#fafafa'}}>
                          <td style={{padding:'5px 8px',fontWeight:700,color:'#1d4ed8'}}>{proc.code}</td>
                          <td style={{padding:'5px 8px',color:'#475569'}}>{proc.description}</td>
                          <td style={{padding:'5px 8px',textAlign:'center',color:'#64748b'}}>{proc.tooth||'—'}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',color:'#1e293b'}}>{proc.fee?'$'+N(proc.fee).toLocaleString():'—'}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',color:'#0d9488'}}>{proc.ins_amt?'$'+N(proc.ins_amt).toLocaleString():'—'}</td>
                          <td style={{padding:'5px 8px',textAlign:'right',color:'#d97706'}}>{proc.pt_amt?'$'+N(proc.pt_amt).toLocaleString():'—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {plan.notes && (
            <div style={{marginTop:8,padding:'8px 10px',background:'#fffbeb',borderRadius:8,border:'1px solid #fef3c7'}}>
              <div style={{fontSize:10,fontWeight:800,color:'#92400e',marginBottom:3}}>TX PLAN NOTES</div>
              <div style={{fontSize:12,color:'#78350f'}}>{plan.notes}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function PatientRow({ p, onSave, onDelete, tcUsers, isManager, user, notify }) {
  const [open, setOpen]   = useState(false)
  const [edit, setEdit]   = useState(false)
  const [form, setForm]   = useState(p)
  const [saving,    setSaving]    = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const set = (k,v) => setForm(f => ({...f, [k]: v}))

  const flags  = getFlags(p)
  const cadence = getCadence(p)

  const save = async () => {
    setSaving(true)
    const row = {
      ...form,
      month_tab: (form.dos || form.consult_date || todayStr()).slice(0,7),
      finance_stalled: form.finance_stalled || detectFinanceStall(form.notes, form.remarks),
      updated_at: new Date().toISOString()
    }
    await onSave(row)
    setSaving(false)
    setEdit(false)
  }

  const inp = (label, field, type='text', opts=null) => (
    <div>
      <div style={{fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,marginBottom:3}}>{label}</div>
      {opts ? (
        <select value={form[field]||''} onChange={e=>set(field,e.target.value)}
          style={{width:'100%',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}>
          <option value="">—</option>
          {opts.map(o=><option key={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[field]||''} onChange={e=>set(field,e.target.value)}
          style={{width:'100%',boxSizing:'border-box',padding:'6px 8px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:12}}/>
      )}
    </div>
  )

  return (
    <>
      {/* Main row */}
      <tr style={{borderBottom:'1px solid #f1f5f9',background:open?'#f0f9ff':'white',cursor:'pointer'}}
        onClick={()=>setOpen(o=>!o)}>
        <td style={{padding:'8px 10px',fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>{p.dos||''}</td>
        <td style={{padding:'8px 10px',fontSize:12,fontWeight:700,color:'#1e293b',whiteSpace:'nowrap'}}>{p.patient_name}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.patient_phone||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.doctor||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.who_tx_plan||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.exam_type||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#64748b',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.notes||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.who_sched||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.appt_1||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.appt_2||'—'}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#475569'}}>{p.appt_hyg||'—'}</td>
        <td style={{padding:'8px 10px'}}>
          {p.has_appt==='Yes'
            ? <span style={{fontSize:10,fontWeight:700,color:'#16a34a',background:'#dcfce7',padding:'2px 7px',borderRadius:99}}>Yes</span>
            : p.has_appt==='No'
            ? <span style={{fontSize:10,fontWeight:700,color:'#dc2626',background:'#fee2e2',padding:'2px 7px',borderRadius:99}}>No</span>
            : <span style={{fontSize:10,color:'#94a3b8'}}>—</span>}
        </td>
        <td style={{padding:'8px 10px'}}>
          {p.email_sent==='Yes'
            ? <span style={{fontSize:10,fontWeight:700,color:'#1d4ed8',background:'#dbeafe',padding:'2px 7px',borderRadius:99}}>Sent</span>
            : <span style={{fontSize:10,color:'#94a3b8'}}>{p.email_sent||'—'}</span>}
        </td>
        <td style={{padding:'8px 4px'}}>
          <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
            {[p.call_1_date,p.call_2_date,p.call_3_date].filter(Boolean).map((d,i)=>(
              <span key={i} style={{fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:4,
                background:'#fef9c3',color:'#854d0e'}}>C{i+1}</span>
            ))}
          </div>
        </td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#1d4ed8',fontWeight:600,textAlign:'right'}}>{p.total_tx_cost?USD(p.total_tx_cost):''}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#0d9488',fontWeight:600,textAlign:'right'}}>{p.sched_tx_amount?USD(p.sched_tx_amount):''}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#64748b',textAlign:'right'}}>{p.ins_expected?USD(p.ins_expected):''}</td>
        <td style={{padding:'8px 10px',fontSize:11,color:'#16a34a',fontWeight:600,textAlign:'right'}}>{p.tx_completed?USD(p.tx_completed):''}</td>
        <td style={{padding:'8px 6px'}}>
          {cadence && (
            <div style={{fontSize:10,fontWeight:700,color:cadence.color,whiteSpace:'nowrap',
              padding:'3px 8px',borderRadius:4,background:cadence.color+'18'}}>
              {cadence.label}
            </div>
          )}
        </td>
        <td style={{padding:'8px 6px'}}>
          <div style={{display:'flex',gap:3,flexWrap:'wrap'}}>
            {flags.map((f,i)=>(
              <span key={i} style={{fontSize:9,fontWeight:700,padding:'2px 6px',borderRadius:4,
                background:f.color+'22',color:f.color,whiteSpace:'nowrap'}}>
                {f.label}
              </span>
            ))}
          </div>
        </td>
      </tr>

      {/* Expanded detail / edit panel */}
      {open && (
        <tr>
          <td colSpan={19} style={{background:'#f8fafc',padding:0,borderBottom:'2px solid #e2e8f0'}}>
            <div style={{padding:16}}>
              {!edit ? (
                // ── View mode ──────────────────────────────────────────────
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                    <div style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>{p.patient_name}</div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={e=>{e.stopPropagation();setEmailOpen(true)}}
                        style={{padding:'6px 14px',borderRadius:7,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                        Email Patient
                      </button>
                      <button onClick={e=>{e.stopPropagation();setEdit(true)}}
                        style={{padding:'6px 14px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                        Edit
                      </button>
                      {isManager && (
                        <button onClick={e=>{e.stopPropagation();if(window.confirm('Delete?')) onDelete(p.id)}}
                          style={{padding:'6px 14px',borderRadius:7,background:'#fee2e2',color:'#dc2626',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:12}}>
                    {/* Patient info */}
                    <div style={{background:'white',borderRadius:10,padding:12,border:'1px solid #e2e8f0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:8}}>PATIENT</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Phone:</b> {p.patient_phone||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Email:</b> {p.patient_email||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Doctor:</b> {p.doctor||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Exam:</b> {p.exam_type||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>TX Plan by:</b> {p.who_tx_plan||'—'}</div>
                    </div>

                    {/* Appointments */}
                    <div style={{background:'white',borderRadius:10,padding:12,border:'1px solid #e2e8f0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:8}}>APPOINTMENTS</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>1st Appt:</b> {p.appt_1||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>2nd Appt:</b> {p.appt_2||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>3rd Appt:</b> {p.appt_3||'—'}</div>
                      <div style={{fontSize:12,color:'#0d9488'}}><b>Hyg Appt:</b> {p.appt_hyg||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Sched by:</b> {p.who_sched||'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Email sent:</b> {p.email_sent||'—'}</div>
                      <CadenceBar p={p}/>
                    </div>

                    {/* Financial */}
                    <div style={{background:'white',borderRadius:10,padding:12,border:'1px solid #e2e8f0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:8}}>FINANCIALS</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Total TX Cost:</b> {p.total_tx_cost?USD(p.total_tx_cost):'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Sched TX:</b> {p.sched_tx_amount?USD(p.sched_tx_amount):'—'}</div>
                      <div style={{fontSize:12,color:'#1e293b'}}><b>Ins Expected:</b> {p.ins_expected?USD(p.ins_expected):'—'}</div>
                      <div style={{fontSize:12,color:'#16a34a',fontWeight:700}}><b>TX Completed:</b> {p.tx_completed?USD(p.tx_completed):'—'}</div>
                      {p.total_tx_cost > 0 && (
                        <div style={{marginTop:6,height:4,background:'#f1f5f9',borderRadius:2}}>
                          <div style={{height:'100%',borderRadius:2,background:'#16a34a',
                            width:Math.min(Math.round(N(p.tx_completed)*100/N(p.total_tx_cost)),100)+'%'}}/>
                        </div>
                      )}
                      {p.finance_barrier && (
                        <div style={{marginTop:6,fontSize:11,color:'#7c3aed',fontWeight:700}}>
                          Finance stall: {p.finance_barrier}
                        </div>
                      )}
                    </div>

                    {/* Calls */}
                    <div style={{background:'white',borderRadius:10,padding:12,border:'1px solid #e2e8f0'}}>
                      <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:8}}>CALL LOG</div>
                      {[['1st',p.call_1_date,p.call_1_notes],['2nd',p.call_2_date,p.call_2_notes],['3rd',p.call_3_date,p.call_3_notes]]
                        .map(([n,d,note])=>(
                        <div key={n} style={{marginBottom:4}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#1e293b'}}>{n} Call: </span>
                          <span style={{fontSize:11,color:'#475569'}}>{d||'—'}</span>
                          {note && <div style={{fontSize:11,color:'#64748b',marginLeft:12,fontStyle:'italic'}}>{note}</div>}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes & Remarks */}
                  {(p.notes||p.remarks) && (
                    <div style={{marginTop:10,background:'white',borderRadius:10,padding:12,border:'1px solid #e2e8f0'}}>
                      {p.notes && <div style={{fontSize:12,color:'#1e293b',marginBottom:4}}><b>Notes:</b> {p.notes}</div>}
                      {p.remarks && <div style={{fontSize:12,color:'#475569',fontStyle:'italic'}}><b>Remarks:</b> {p.remarks}</div>}
                    </div>
                  )}

                  {/* TX Plan */}
                  <TxPlanPanel p={p} onSave={onSave} notify={notify}/>
                </div>
              ) : (
                // ── Edit mode ──────────────────────────────────────────────
                <div onClick={e=>e.stopPropagation()}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
                    <div style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>Editing: {form.patient_name}</div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>setEdit(false)}
                        style={{padding:'6px 14px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                        Cancel
                      </button>
                      <button onClick={save} disabled={saving}
                        style={{padding:'6px 14px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:12,cursor:'pointer'}}>
                        {saving?'Saving…':'Save'}
                      </button>
                    </div>
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10}}>
                    {inp('Patient Name',     'patient_name')}
                    {inp('Phone',           'patient_phone')}
                    {inp('Email',           'patient_email')}
                    {inp('Doctor',          'doctor', 'text', DOCTORS)}
                    {inp('Date of Service', 'dos', 'date')}
                    {inp('Exam Type',       'exam_type', 'text', EXAM_TYPES)}
                    {inp('TX Plan By',      'who_tx_plan')}
                    {inp('Sched By',        'who_sched')}
                  </div>

                  <div style={{marginTop:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,marginBottom:4}}>NOTES</div>
                    <textarea value={form.notes||''} onChange={e=>set('notes',e.target.value)}
                      style={{width:'100%',boxSizing:'border-box',minHeight:50,padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,resize:'vertical'}}/>
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10,marginTop:10}}>
                    {inp('1st Appt',   'appt_1', 'date')}
                    {inp('2nd Appt',   'appt_2', 'date')}
                    {inp('3rd Appt',   'appt_3', 'date')}
                    {inp('Hyg Appt',   'appt_hyg', 'text')}
                    {inp('Has Appt',   'has_appt', 'text', HAS_APPT_OPTS)}
                    {inp('Email Sent', 'email_sent', 'text', EMAIL_OPTS)}
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10,marginTop:10}}>
                    {inp('1st Call Date',   'call_1_date', 'date')}
                    {inp('1st Call Notes',  'call_1_notes')}
                    {inp('2nd Call Date',   'call_2_date', 'date')}
                    {inp('2nd Call Notes',  'call_2_notes')}
                    {inp('3rd Call Date',   'call_3_date', 'date')}
                    {inp('3rd Call Notes',  'call_3_notes')}
                  </div>

                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:10,marginTop:10}}>
                    {inp('Total TX Cost',    'total_tx_cost', 'text')}
                    {inp('Sched TX ($)',     'sched_tx_amount', 'text')}
                    {inp('Ins Expected',     'ins_expected', 'text')}
                    {inp('TX Completed',     'tx_completed', 'text')}
                    {inp('Finance Barrier',  'finance_barrier', 'text', BARRIER_TYPES)}
                  </div>

                  <div style={{marginTop:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,marginBottom:4}}>REMARKS</div>
                    <textarea value={form.remarks||''} onChange={e=>set('remarks',e.target.value)}
                      style={{width:'100%',boxSizing:'border-box',minHeight:60,padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:12,resize:'vertical'}}/>
                  </div>

                  <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8}}>
                    <input type="checkbox" checked={!!form.finance_stalled} onChange={e=>set('finance_stalled',e.target.checked)}/>
                    <label style={{fontSize:12,color:'#7c3aed',fontWeight:600}}>Flag as Finance Stalled</label>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
      {emailOpen && (
        <EmailModal p={p} user={user} onClose={()=>setEmailOpen(false)} notify={notify}/>
      )}
    </>
  )
}

// ── Add New Patient Modal ──────────────────────────────────────────────────
function AddModal({ user, users, onClose, onSave, notify }) {
  const [form, setForm] = useState({...BLANK(), office: user.office||'', assigned_tc_name: user.name||''})
  const [saving, setSaving] = useState(false)
  const set = (k,v) => setForm(f=>({...f,[k]:v}))

  const save = async () => {
    if (!form.patient_name.trim()) { notify('Patient name required','error'); return }
    setSaving(true)
    const row = {
      ...form,
      month_tab: (form.dos||todayStr()).slice(0,7),
      finance_stalled: detectFinanceStall(form.notes, form.remarks),
      updated_at: new Date().toISOString()
    }
    await onSave(row)
    setSaving(false)
    onClose()
  }

  const inp = (label, field, type='text', opts=null) => (
    <div>
      <div style={{fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,marginBottom:3}}>{label}</div>
      {opts ? (
        <select value={form[field]||''} onChange={e=>set(field,e.target.value)}
          style={{width:'100%',padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:13}}>
          <option value="">—</option>
          {opts.map(o=><option key={o}>{o}</option>)}
        </select>
      ) : (
        <input type={type} value={form[field]||''} onChange={e=>set(field,e.target.value)}
          style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:13}}/>
      )}
    </div>
  )

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
      <div style={{background:'white',borderRadius:14,padding:24,width:'100%',maxWidth:680,maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:18}}>
          <div style={{fontSize:15,fontWeight:800,color:'#1e293b'}}>Add New Patient</div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:18,cursor:'pointer',color:'#94a3b8'}}>✕</button>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          {inp('Patient Name *', 'patient_name')}
          {inp('Phone',          'patient_phone')}
          {inp('Email',          'patient_email')}
          {inp('Doctor',         'doctor', 'text', DOCTORS)}
          {inp('Date of Service','dos', 'date')}
          {inp('Exam Type',      'exam_type', 'text', EXAM_TYPES)}
          {inp('TX Plan By',     'who_tx_plan')}
          {inp('Sched By',       'who_sched')}
        </div>

        <div style={{marginBottom:10}}>
          <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:3}}>NOTES</div>
          <textarea value={form.notes||''} onChange={e=>set('notes',e.target.value)}
            placeholder="Treatment notes..."
            style={{width:'100%',boxSizing:'border-box',minHeight:60,padding:'7px 9px',borderRadius:7,border:'1px solid #e2e8f0',fontSize:13,resize:'vertical'}}/>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
          {inp('Total TX Cost', 'total_tx_cost', 'text')}
          {inp('Sched TX ($)',  'sched_tx_amount', 'text')}
          {inp('Ins Expected', 'ins_expected', 'text')}
          {inp('Has Appt',     'has_appt', 'text', HAS_APPT_OPTS)}
        </div>

        <div style={{display:'flex',gap:10,justifyContent:'flex-end',borderTop:'1px solid #f1f5f9',paddingTop:14}}>
          <button onClick={onClose}
            style={{padding:'9px 20px',borderRadius:8,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{padding:'9px 20px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>
            {saving?'Saving…':'Add Patient'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function TcPatientsPage({ user, tcPatients, isManager, users, saveTcPatient, loadTcPatients, notify }) {
  const [activeMonth, setActiveMonth] = useState('all')
  const [search,      setSearch]      = useState('')
  const [filter,      setFilter]      = useState('all') // all | no_appt | needs_call | finance | recall
  const [drFilter,    setDrFilter]    = useState('all')
  const [showAdd,     setShowAdd]     = useState(false)
  const [loading,     setLoading]     = useState(false)

  const tcUsers = users.filter(u => ['treatment_coordinator','manager','admin'].includes(u.role))

  // Month tabs from actual data
  const monthTabs = useMemo(() => getMonthTabs(tcPatients || []), [tcPatients])

  // Filtered patients
  const visible = useMemo(() => {
    let list = tcPatients || []

    // Month filter
    if (activeMonth !== 'all')
      list = list.filter(p => (p.month_tab || p.dos?.slice(0,7)) === activeMonth)

    // Doctor filter
    if (drFilter !== 'all')
      list = list.filter(p => p.doctor === drFilter)

    // Search
    if (search.trim())
      list = list.filter(p =>
        (p.patient_name||'').toLowerCase().includes(search.toLowerCase()) ||
        (p.patient_phone||'').includes(search) ||
        (p.notes||'').toLowerCase().includes(search.toLowerCase())
      )

    // Predictive filters
    if (filter === 'due_today')
      list = list.filter(p => getCadence(p)?.status === 'due')
    else if (filter === 'overdue_cadence')
      list = list.filter(p => getCadence(p)?.status === 'overdue' || getCadence(p)?.status === 'escalate')
    else if (filter !== 'all')
      list = list.filter(p => getFlags(p).some(f => f.type === filter))

    return list.sort((a,b) => (b.dos||'').localeCompare(a.dos||''))
  }, [tcPatients, activeMonth, search, filter, drFilter])

  // Summary counts
  const counts = useMemo(() => {
    const all = tcPatients || []
    return {
      total:      all.length,
      no_appt:    all.filter(p => getFlags(p).some(f=>f.type==='no_appt')).length,
      needs_call: all.filter(p => getFlags(p).some(f=>f.type==='needs_call'||f.type==='overdue_call')).length,
      finance:    all.filter(p => getFlags(p).some(f=>f.type==='finance')).length,
      recall:     all.filter(p => getFlags(p).some(f=>f.type==='recall')).length,
      incomplete: all.filter(p => getFlags(p).some(f=>f.type==='incomplete')).length,
      due_today:  all.filter(p => getCadence(p)?.status === 'due').length,
      overdue:    all.filter(p => getCadence(p)?.status === 'overdue' || getCadence(p)?.status === 'escalate').length,
    }
  }, [tcPatients])

  const onSave = async (row) => {
    await saveTcPatient(row)
    notify('Saved ✓')
  }
  const onDelete = async (id) => {
    await sbDel('tc_patients', 'id=eq.'+id)
    await loadTcPatients()
    notify('Deleted')
  }

  const doctors = [...new Set((tcPatients||[]).map(p=>p.doctor).filter(Boolean))].sort()

  return (
    <div style={{padding:'0 0 60px'}}>
      {/* Header */}
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',padding:'20px 24px 16px',marginBottom:16}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
          <div>
            <div style={{fontSize:10,color:'rgba(255,255,255,.6)',fontWeight:700,letterSpacing:2,marginBottom:4}}>NP TREATMENT LOG</div>
            <div style={{fontSize:18,fontWeight:800,color:'white'}}>Treatment Coordinator Tracker</div>
            <div style={{fontSize:12,color:'rgba(255,255,255,.6)',marginTop:2}}>{user.office} · {visible.length} patients shown</div>
          </div>
          <button onClick={()=>setShowAdd(true)}
            style={{display:'flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:9,
              background:'rgba(255,255,255,.15)',color:'white',border:'1px solid rgba(255,255,255,.3)',
              fontWeight:700,fontSize:13,cursor:'pointer'}}>
            + Add Patient
          </button>
        </div>

        {/* Summary pills */}
        <div style={{display:'flex',gap:8,marginTop:14,flexWrap:'wrap'}}>
          {[
            ['all',     'All',          counts.total,      'rgba(255,255,255,.2)', 'white'],
            ['no_appt', 'No Appt',      counts.no_appt,    '#fee2e2', '#dc2626'],
            ['needs_call','Needs Call', counts.needs_call, '#fef9c3', '#854d0e'],
            ['finance', 'Finance Stall',counts.finance,    '#f5f3ff', '#7c3aed'],
            ['recall',  'Recall Needed',counts.recall,     '#f0fdf4', '#16a34a'],
            ['incomplete',      'TX Incomplete',   counts.incomplete, '#eff6ff', '#1d4ed8'],
            ['due_today',       'Call Due Today',  counts.due_today,  '#f0fdf4', '#0d9488'],
            ['overdue_cadence', 'Cadence Overdue', counts.overdue,    '#fff7ed', '#ea580c'],
          ].map(([k,l,c,bg,col])=>(
            <button key={k} onClick={()=>setFilter(k)}
              style={{padding:'5px 12px',borderRadius:99,fontWeight:700,fontSize:11,cursor:'pointer',
                border:'2px solid '+(filter===k?col:'transparent'),
                background:filter===k?bg:'rgba(255,255,255,.1)',
                color:filter===k?col:'rgba(255,255,255,.8)'}}>
              {l} {c > 0 && <span style={{fontWeight:800}}>({c})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Controls */}
      <div style={{padding:'0 24px',display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:12}}>
        {/* Month tabs */}
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          <button onClick={()=>setActiveMonth('all')}
            style={{padding:'6px 12px',borderRadius:7,border:'1px solid '+(activeMonth==='all'?'#1d4ed8':'#e2e8f0'),
              background:activeMonth==='all'?'#1d4ed8':'white',color:activeMonth==='all'?'white':'#64748b',
              fontWeight:600,fontSize:12,cursor:'pointer'}}>
            All
          </button>
          {monthTabs.map(m=>(
            <button key={m} onClick={()=>setActiveMonth(m)}
              style={{padding:'6px 12px',borderRadius:7,border:'1px solid '+(activeMonth===m?'#1d4ed8':'#e2e8f0'),
                background:activeMonth===m?'#1d4ed8':'white',color:activeMonth===m?'white':'#64748b',
                fontWeight:600,fontSize:12,cursor:'pointer'}}>
              {monthLabel(m)}
            </button>
          ))}
        </div>

        <input placeholder="Search patients..." value={search} onChange={e=>setSearch(e.target.value)}
          style={{padding:'7px 12px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:12,minWidth:180}}/>

        <select value={drFilter} onChange={e=>setDrFilter(e.target.value)}
          style={{padding:'7px 10px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:12}}>
          <option value="all">All Doctors</option>
          {doctors.map(d=><option key={d}>{d}</option>)}
        </select>
      </div>

      {/* Table */}
      <div style={{padding:'0 24px',overflowX:'auto'}}>
        <table style={{width:'100%',borderCollapse:'collapse',minWidth:1400}}>
          <thead>
            <tr style={{background:'#1e293b'}}>
              {['DOS','Patient','Phone','Doctor','TC','Exam','Notes','Sched By',
                '1st Appt','2nd Appt','Hyg Appt','Appt?','Email',
                'Calls','Total TX','Sched TX','Ins Exp','Completed','Cadence','Flags'
              ].map(h=>(
                <th key={h} style={{padding:'9px 10px',textAlign:'left',fontSize:10,fontWeight:800,
                  color:'rgba(255,255,255,.7)',letterSpacing:.5,whiteSpace:'nowrap'}}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={19} style={{textAlign:'center',padding:40,color:'#94a3b8',fontSize:13}}>
                  No patients found
                </td>
              </tr>
            ) : visible.map(p => (
              <PatientRow key={p.id} p={p} onSave={onSave} onDelete={onDelete}
                tcUsers={tcUsers} isManager={isManager} user={user} notify={notify}/>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddModal user={user} users={users} onClose={()=>setShowAdd(false)}
          onSave={async row => { await saveTcPatient(row); await loadTcPatients(); notify('Patient added ✓') }}
          notify={notify}/>
      )}
    </div>
  )
}
