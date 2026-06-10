import React, { useState, useEffect } from 'react'
import { sbGet, sbPost, sbDel } from '../../lib/supabase'

// ── Email Presets editor (Admin) ──────────────────────────────────────────
export default function EmailPresetsTab({ notify }) {
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // id being edited
  const [draft,   setDraft]   = useState(null)

  const load = () => {
    setLoading(true)
    sbGet('email_presets','select=*&order=sort_order')
      .then(rows => { setPresets(rows||[]); setLoading(false) })
      .catch(() => setLoading(false))
  }
  useEffect(load, [])

  const startEdit = (p) => { setEditing(p.id); setDraft({...p}) }
  const startNew  = () => {
    const id = 'preset_'+Date.now().toString(36)
    setEditing(id)
    setDraft({ id, label:'', description:'', instruction:'', sort_order:(presets.length+1), active:true })
  }

  const save = async () => {
    if (!draft.label.trim() || !draft.instruction.trim()) {
      notify('Label and instruction are required','error'); return
    }
    await sbPost('email_presets', draft, 'id')
    notify('Preset saved')
    setEditing(null); setDraft(null); load()
  }

  const remove = async (id) => {
    if (!window.confirm('Delete this preset?')) return
    await sbDel('email_presets','id=eq.'+id)
    notify('Preset deleted'); load()
  }

  const toggleActive = async (p) => {
    await sbPost('email_presets', {...p, active:!p.active}, 'id')
    load()
  }

  if (loading) return <div style={{padding:20,color:'#94a3b8'}}>Loading presets...</div>

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:'#1e293b'}}>AI Email Templates</div>
          <div style={{fontSize:12,color:'#94a3b8'}}>These tone/angle presets appear when staff generate a patient email.</div>
        </div>
        <button onClick={startNew}
          style={{padding:'8px 16px',borderRadius:8,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
          + New Preset
        </button>
      </div>

      {presets.map(p => (
        <div key={p.id} style={{background:'white',borderRadius:10,border:'1px solid #e2e8f0',
          padding:14,marginBottom:10,opacity:p.active?1:.55}}>
          {editing===p.id ? (
            <div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>LABEL</div>
                  <input value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})}
                    style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13}}/>
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>SHORT DESCRIPTION</div>
                  <input value={draft.description||''} onChange={e=>setDraft({...draft,description:e.target.value})}
                    style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13}}/>
                </div>
              </div>
              <div style={{marginBottom:10}}>
                <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>INSTRUCTION TO AI (what tone/angle to take)</div>
                <textarea value={draft.instruction} onChange={e=>setDraft({...draft,instruction:e.target.value})}
                  style={{width:'100%',boxSizing:'border-box',minHeight:70,padding:'8px 10px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13,resize:'vertical'}}/>
              </div>
              <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                <button onClick={()=>{setEditing(null);setDraft(null)}}
                  style={{padding:'7px 16px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
                <button onClick={save}
                  style={{padding:'7px 16px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>Save</button>
              </div>
            </div>
          ) : (
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12}}>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>
                  {p.label}
                  {!p.active && <span style={{marginLeft:8,fontSize:10,color:'#94a3b8',fontWeight:600}}>(inactive)</span>}
                </div>
                {p.description && <div style={{fontSize:11,color:'#94a3b8',marginTop:1}}>{p.description}</div>}
                <div style={{fontSize:12,color:'#475569',marginTop:6,lineHeight:1.5}}>{p.instruction}</div>
              </div>
              <div style={{display:'flex',gap:6,flexShrink:0}}>
                <button onClick={()=>toggleActive(p)}
                  style={{padding:'5px 10px',borderRadius:6,background:'#f8fafc',border:'1px solid #e2e8f0',fontWeight:700,fontSize:11,cursor:'pointer',color:p.active?'#64748b':'#16a34a'}}>
                  {p.active?'Disable':'Enable'}
                </button>
                <button onClick={()=>startEdit(p)}
                  style={{padding:'5px 10px',borderRadius:6,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Edit</button>
                <button onClick={()=>remove(p.id)}
                  style={{padding:'5px 10px',borderRadius:6,background:'#fee2e2',color:'#dc2626',border:'none',fontWeight:700,fontSize:11,cursor:'pointer'}}>Delete</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* New preset editor */}
      {editing && !presets.find(p=>p.id===editing) && draft && (
        <div style={{background:'white',borderRadius:10,border:'2px solid #1d4ed8',padding:14,marginBottom:10}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:10}}>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>LABEL</div>
              <input value={draft.label} onChange={e=>setDraft({...draft,label:e.target.value})} autoFocus
                placeholder="e.g. Second Opinion Welcome"
                style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13}}/>
            </div>
            <div>
              <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>SHORT DESCRIPTION</div>
              <input value={draft.description||''} onChange={e=>setDraft({...draft,description:e.target.value})}
                style={{width:'100%',boxSizing:'border-box',padding:'7px 9px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13}}/>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:9,fontWeight:800,color:'#64748b',marginBottom:3}}>INSTRUCTION TO AI</div>
            <textarea value={draft.instruction} onChange={e=>setDraft({...draft,instruction:e.target.value})}
              placeholder="Describe the tone and angle the AI should take..."
              style={{width:'100%',boxSizing:'border-box',minHeight:70,padding:'8px 10px',borderRadius:6,border:'1px solid #e2e8f0',fontSize:13,resize:'vertical'}}/>
          </div>
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <button onClick={()=>{setEditing(null);setDraft(null)}}
              style={{padding:'7px 16px',borderRadius:7,background:'#f1f5f9',color:'#64748b',border:'none',fontWeight:700,cursor:'pointer'}}>Cancel</button>
            <button onClick={save}
              style={{padding:'7px 16px',borderRadius:7,background:'#1d4ed8',color:'white',border:'none',fontWeight:700,cursor:'pointer'}}>Save</button>
          </div>
        </div>
      )}
    </div>
  )
}
