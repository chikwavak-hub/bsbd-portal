// src/pages/shared/SmartNotes.jsx — clinical note generator ("notes that get paid").
// Template-driven, insurance-defensible documentation for high-value procedures.
// Stateless: nothing is stored, no patient identifiers required — staff generate,
// copy, and paste into the chart. Amber flags mark payment-critical elements.

import React, { useState, useMemo } from 'react'

const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a', AMBER='#d97706', RED='#dc2626'

// ── field helpers ──────────────────────────────────────────────────────────
// type: text | num | select | multi | canals | teeth
// pay: why this field matters for payment (drives the amber warning)
const F = (id, label, type, opts = {}) => ({ id, label, type, ...opts })

const TOOTH_PLACEHOLDER = 'e.g. 3, 14, 19'
const anesthesia = F('anes', 'Anesthesia', 'text', { def: '2% lidocaine 1:100k epi, 1 carpule, profound anesthesia achieved', span: 2 })

// ── templates ──────────────────────────────────────────────────────────────
const TEMPLATES = [
{
  id: 'crown_replace', cat: 'Restorative', label: 'Crown — REPLACEMENT', codes: 'D2740/D2750/D2752',
  fields: [
    F('tooth','Tooth #','text',{req:true}),
    F('age','Age of existing crown (years)','num',{req:true, pay:'Payers require crown age — most plans only replace after 5–7+ years'}),
    F('reason','Reason for replacement','multi',{req:true, pay:'A documented failure mode is required for replacement coverage',
      options:['Recurrent decay at margin (radiographically evident)','Open margin with leakage','Fractured porcelain — non-repairable','Fractured/perforated occlusal surface','Loss of retention — repeated decementation','Failed endodontic access repair not restorable']}),
    F('radio','Radiographic/clinical evidence','text',{req:true, pay:'State the objective evidence — "PA shows recurrent decay mesial margin #3"', span:2}),
    F('symptoms','Symptoms (if any)','text',{def:'Patient reports food impaction and sensitivity at the site'}),
    F('material','New crown material','select',{options:['Full zirconia','Lithium disilicate (e.max)','PFM','Full cast gold'],def:'Full zirconia'}),
    F('prep','Prep/procedure details','text',{def:'Existing crown sectioned and removed. All recurrent caries excavated. Buildup evaluated; adequate ferrule present. Crown prep refined, retraction cord placed, digital impression taken. Temporary fabricated and cemented with temp cement. Occlusion verified.', span:2}),
    anesthesia,
  ],
  build: v => `CROWN REPLACEMENT — Tooth #${v.tooth} (${v.material||'crown'})
Existing crown age: ${v.age||'___'} years.
Reason for replacement: ${(v.reason||[]).join('; ')||'___'}.
Evidence: ${v.radio||'___'}. ${v.symptoms||''}
${v.anes||''}
${v.prep||''}
Existing crown is non-serviceable and cannot be repaired; replacement is clinically necessary to restore function and prevent further breakdown. Patient tolerated procedure well. POI given. Next: crown seat.`,
},
{
  id: 'crown_initial', cat: 'Restorative', label: 'Crown — initial', codes: 'D2740/D2750',
  fields: [
    F('tooth','Tooth #','text',{req:true}),
    F('dx','Diagnosis','multi',{req:true, pay:'Crowns need documented structural necessity — a filling would not suffice',
      options:['Fractured cusp (cracked tooth)','Extensive caries undermining cusps','Failed large existing restoration >50% of tooth','Post-endodontic tooth requiring cuspal coverage','Craze lines with symptomatic cracked-tooth signs']}),
    F('surfaces','Existing restoration / decay extent','text',{def:'Existing MOD amalgam with recurrent decay; remaining walls thin and undermined', span:2, pay:'Describe why remaining structure cannot support a direct restoration'}),
    F('material','Material','select',{options:['Full zirconia','Lithium disilicate (e.max)','PFM','Full cast gold'],def:'Full zirconia'}),
    F('prep','Procedure details','text',{def:'Caries/failed restoration removed completely. Buildup placed as needed (documented separately if D2950). Crown prep with adequate reduction, retraction cord, digital impression. Temporary crown fabricated, occlusion adjusted.', span:2}),
    anesthesia,
  ],
  build: v => `CROWN — Tooth #${v.tooth} (${v.material||'crown'})
Diagnosis: ${(v.dx||[]).join('; ')||'___'}.
${v.surfaces||''}
${v.anes||''}
${v.prep||''}
Tooth is not restorable with a direct restoration due to insufficient remaining structure; full-coverage restoration is necessary. Patient tolerated well. POI given. Next: crown seat.`,
},
{
  id: 'buildup', cat: 'Restorative', label: 'Core buildup', codes: 'D2950',
  fields: [
    F('tooth','Tooth #','text',{req:true}),
    F('why','Structural necessity','multi',{req:true, pay:'D2950 is denied as inclusive unless necessity beyond crown retention is documented',
      options:['>50% of coronal tooth structure missing after caries removal','Insufficient axial wall height for crown retention','Replacement of missing cusp(s) required for prep form','Post-endodontic access + lost marginal ridge']}),
    F('material','Material','select',{options:['Dual-cure composite core','Amalgam core','Glass ionomer core'],def:'Dual-cure composite core'}),
    F('detail','Details','text',{def:'All caries removed and cavity disinfected. Core material placed and light cured in increments, prepared to ideal form to retain the crown.', span:2}),
  ],
  build: v => `CORE BUILDUP — Tooth #${v.tooth} (${v.material||''})
Necessity: ${(v.why||[]).join('; ')||'___'}.
${v.detail||''}
Buildup is required for crown retention and resistance form; not merely a filler. Separate from crown preparation.`,
},
{
  id: 'rct', cat: 'Endodontics', label: 'Root canal therapy', codes: 'D3310/D3320/D3330',
  fields: [
    F('tooth','Tooth #','text',{req:true}),
    F('pulpdx','Pulpal diagnosis','select',{req:true, pay:'Both a pulpal AND periapical diagnosis are required for endo claims',
      options:['Symptomatic irreversible pulpitis','Asymptomatic irreversible pulpitis','Pulp necrosis','Previously initiated therapy','Previously treated (retreatment)']}),
    F('peridx','Periapical diagnosis','select',{req:true, pay:'Both a pulpal AND periapical diagnosis are required for endo claims',
      options:['Symptomatic apical periodontitis','Asymptomatic apical periodontitis','Acute apical abscess','Chronic apical abscess','Normal apical tissues']}),
    F('tests','Diagnostic tests','multi',{req:true, pay:'Objective testing supports the diagnosis — cold/EPT/percussion results',
      options:['Cold: lingering pain >30s','Cold: no response','EPT: no response','Percussion: positive','Palpation: positive','PA radiolucency present on radiograph','Spontaneous pain history']}),
    F('canals','Canals (name · WL · reference · MAF)','canals',{req:true, pay:'Working lengths per canal are expected in endo documentation'}),
    F('extra','Additional canals / anatomy','text',{def:'',placeholder:'e.g. MB2 located and negotiated; calcified canal — see note'}),
    F('irrig','Irrigation / medicament','text',{def:'Copious irrigation with 5.25% NaOCl and EDTA; canals dried with paper points', span:2}),
    F('obt','Obturation','select',{options:['Obturated with gutta percha + bioceramic sealer (warm vertical)','Obturated with gutta percha + sealer (lateral condensation)','Calcium hydroxide placed — obturation next visit'],def:'Obturated with gutta percha + bioceramic sealer (warm vertical)'}),
    F('resto','Coronal seal / next step','select',{options:['Cotton + Cavit temporary; buildup and crown recommended','Composite core placed same visit; crown recommended','Referred for crown with restorative provider'],def:'Composite core placed same visit; crown recommended'}),
    anesthesia,
    F('rubber','Isolation','select',{options:['Rubber dam isolation','Isolite isolation'],def:'Rubber dam isolation', pay:'Standard of care — reviewers look for isolation documentation'}),
  ],
  build: v => `ROOT CANAL THERAPY — Tooth #${v.tooth}
Pulpal Dx: ${v.pulpdx||'___'}. Periapical Dx: ${v.peridx||'___'}.
Testing: ${(v.tests||[]).join('; ')||'___'}.
${v.anes||''} ${v.rubber||''}.
Access achieved; canals located${v.extra?' — '+v.extra:''}.
${(v.canalRows||[]).filter(c=>c.name).map(c=>`  ${c.name}: WL ${c.wl||'__'} mm (ref: ${c.ref||'cusp tip'}), MAF ${c.maf||'__'}`).join('\n')||'  Canals: ___'}
${v.irrig||''}
${v.obt||''}. ${v.resto||''}.
Post-op radiograph confirms obturation to length with adequate density. Patient tolerated procedure well; POI and analgesic guidance given.`,
},
{
  id: 'srp', cat: 'Periodontics', label: 'Scaling & root planing', codes: 'D4341/D4342',
  fields: [
    F('quads','Quadrant(s) treated','multi',{req:true, options:['UR','UL','LL','LR']}),
    F('nteeth','Teeth with 4+ mm pockets in quad','num',{req:true, pay:'D4341 requires 4+ affected teeth per quadrant (1–3 = D4342)'}),
    F('pd','Pocket depths','text',{req:true, def:'Generalized 4–6 mm pockets with localized 7 mm', pay:'Specific probing depths are the core evidence — attach the perio chart'}),
    F('cal','Attachment loss / recession','text',{def:'CAL 3–5 mm with generalized recession 1–2 mm', pay:'Attachment loss distinguishes perio disease from gingivitis'}),
    F('bone','Radiographic bone loss','select',{req:true, pay:'Radiographic bone loss is required by most payers for SRP',
      options:['Generalized horizontal bone loss 20–40%','Generalized horizontal bone loss >40%','Localized vertical defects with horizontal loss','Mild crestal bone loss 10–20%']}),
    F('bop','Clinical signs','multi',{def:['Bleeding on probing generalized','Subgingival calculus present'],options:['Bleeding on probing generalized','Bleeding on probing localized','Subgingival calculus present','Suppuration noted','Mobility class I–II present','Furcation involvement noted']}),
    F('dx','Perio diagnosis','select',{options:['Stage II Grade A periodontitis','Stage II Grade B periodontitis','Stage III Grade B periodontitis','Stage III Grade C periodontitis'],def:'Stage II Grade B periodontitis', req:true}),
    F('method','Instrumentation','text',{def:'Ultrasonic and hand instrumentation to remove subgingival calculus and biofilm; root surfaces planed smooth', span:2}),
    anesthesia,
    F('ohi','OHI / next steps','text',{def:'OHI reviewed. 4–6 week re-evaluation planned, then 3–4 month perio maintenance (D4910).', span:2}),
  ],
  build: v => `SCALING & ROOT PLANING — Quadrant(s): ${(v.quads||[]).join(', ')||'___'} (${v.nteeth||'___'} teeth with 4+ mm pockets per quad)
Diagnosis: ${v.dx||'___'}.
Probing: ${v.pd||'___'}. ${v.cal||''}
Radiographic: ${v.bone||'___'}.
Clinical: ${(v.bop||[]).join('; ')||''}.
${v.anes||''}
${v.method||''}
${v.ohi||''}
Definitive periodontal therapy — not prophylaxis. Perio charting on file supports medical necessity.`,
},
{
  id: 'perio_maint', cat: 'Periodontics', label: 'Perio maintenance', codes: 'D4910',
  fields: [
    F('hist','SRP history','text',{req:true, def:'History of SRP completed [date range]; patient on periodontal maintenance', pay:'D4910 requires prior definitive perio therapy — reference it'}),
    F('pd','Current probing findings','text',{req:true, def:'Localized 4–5 mm pockets, stable vs prior charting; isolated BOP'}),
    F('done','Performed','text',{def:'Supra- and subgingival scaling with ultrasonic and hand instruments in all quadrants, site-specific root planing at residual pockets, selective polishing, OHI reinforced', span:2}),
    F('next','Interval','select',{options:['3-month interval','4-month interval'],def:'3-month interval'}),
  ],
  build: v => `PERIODONTAL MAINTENANCE (D4910)
${v.hist||'___'}.
Findings: ${v.pd||'___'}.
${v.done||''}
Continued ${v.next||'3-month interval'} maintenance recommended due to periodontal history. Not a prophylaxis; performed in the context of prior periodontal therapy.`,
},
{
  id: 'ext_surg', cat: 'Oral surgery', label: 'Extraction — surgical', codes: 'D7210',
  fields: [
    F('tooth','Tooth #','text',{req:true}),
    F('dx','Diagnosis','multi',{req:true,options:['Non-restorable caries to/below osseous crest','Fractured at gumline — non-restorable','Failed endodontic treatment — non-restorable','Advanced periodontal disease with mobility III','Vertical root fracture']}),
    F('why','Surgical justification','multi',{req:true, pay:'D7210 vs D7140 hinges on documented flap/bone removal/sectioning',
      options:['Mucoperiosteal flap elevated','Bone removal required','Tooth sectioned for removal','Root tips retrieved separately']}),
    F('detail','Procedure details','text',{def:'Site debrided and irrigated with saline. Curettage of socket. Hemostasis achieved; gelfoam placed. Sutures placed as needed.', span:2}),
    anesthesia,
    F('poi','Post-op','text',{def:'Written and verbal post-op instructions given. Analgesic guidance provided. Patient left in stable condition.', span:2}),
  ],
  build: v => `SURGICAL EXTRACTION — Tooth #${v.tooth}
Diagnosis: ${(v.dx||[]).join('; ')||'___'}.
${v.anes||''}
Surgical approach: ${(v.why||[]).join('; ')||'___'}.
${v.detail||''}
${v.poi||''}`,
},
{
  id: 'guard', cat: 'Adjunctive', label: 'Occlusal guard', codes: 'D9944/D9945',
  fields: [
    F('dx','Findings','multi',{req:true, pay:'Payers require objective evidence of bruxism/attrition',
      options:['Generalized occlusal wear facets','Attrition with loss of vertical enamel','Patient reports nocturnal grinding/clenching','Masseter hypertrophy / morning jaw soreness','Fractured restorations attributed to parafunction']}),
    F('type','Guard type','select',{options:['Hard acrylic full-arch (D9944)','Soft full-arch (D9945)'],def:'Hard acrylic full-arch (D9944)'}),
    F('arch','Arch','select',{options:['Maxillary','Mandibular'],def:'Maxillary'}),
    F('detail','Procedure','text',{def:'Digital impressions taken for fabrication of occlusal guard. At delivery: fit verified, occlusion adjusted to even contacts, retention confirmed. Care instructions given.', span:2}),
  ],
  build: v => `OCCLUSAL GUARD — ${v.arch||''} ${v.type||''}
Findings: ${(v.dx||[]).join('; ')||'___'}.
${v.detail||''}
Guard indicated to protect dentition from parafunctional wear and reduce risk of further fracture.`,
},
{
  id: 'composite', cat: 'Restorative', label: 'Composite restoration', codes: 'D2391–D2394 / D2330s',
  fields: [
    F('tooth','Tooth # + surfaces','text',{req:true, placeholder:'e.g. #30 MO'}),
    F('dx','Diagnosis','select',{req:true,options:['Active carious lesion into dentin (radiographically evident)','Fractured existing restoration with recurrent decay','Fractured incisal/cusp — restorable direct','Non-carious cervical lesion, symptomatic'],def:'Active carious lesion into dentin (radiographically evident)'}),
    F('iso','Isolation','select',{options:['Rubber dam','Isolite','Cotton roll isolation'],def:'Isolite'}),
    F('detail','Procedure','text',{def:'Caries excavated to sound dentin, verified with caries indicator. Selective etch, bonding agent applied and cured. Composite placed incrementally and cured. Occlusion adjusted, contacts verified, polished.', span:2}),
    anesthesia,
  ],
  build: v => `COMPOSITE — ${v.tooth||'___'}
Diagnosis: ${v.dx||'___'}.
${v.anes||''} Isolation: ${v.iso||''}.
${v.detail||''}
Patient tolerated well.`,
},
]

const CATS = [...new Set(TEMPLATES.map(t => t.cat))]

// ── UI ─────────────────────────────────────────────────────────────────────
const inp = {width:'100%',boxSizing:'border-box',padding:'8px 10px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13}

export default function SmartNotes({ user, notify }) {
  const [tplId, setTplId] = useState(TEMPLATES[0].id)
  const tpl = TEMPLATES.find(t => t.id === tplId)
  const [vals, setVals] = useState({})
  const v = vals[tplId] || {}
  const set = (k, val) => setVals(prev => ({ ...prev, [tplId]: { ...(prev[tplId]||{}), [k]: val } }))

  // seed defaults once per template
  useMemo(() => {
    setVals(prev => {
      if (prev[tplId]) return prev
      const d = {}
      for (const f of tpl.fields) if (f.def !== undefined) d[f.id] = f.def
      if (tpl.fields.some(f => f.type==='canals')) d.canalRows = [{name:'',wl:'',ref:'',maf:''}]
      return { ...prev, [tplId]: d }
    })
  }, [tplId])

  const note = tpl.build(v).replace(/\n{3,}/g, '\n\n').trim()
  const missing = tpl.fields.filter(f => f.pay && (
    f.type==='multi' ? !(v[f.id]||[]).length :
    f.type==='canals' ? !(v.canalRows||[]).some(c=>c.name&&c.wl) :
    !String(v[f.id]??'').trim()
  ))

  const copy = async () => {
    try { await navigator.clipboard.writeText(note); notify('Note copied — paste into the chart ✓') }
    catch { notify('Copy failed — select the note text and copy manually','error') }
  }

  const card={background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:16,marginBottom:14}

  return (
    <div style={{maxWidth:1000,margin:'0 auto',padding:'20px 16px 80px'}}>
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',borderRadius:14,padding:'18px 24px',marginBottom:18,color:'white'}}>
        <div style={{fontSize:10,opacity:.5,fontWeight:700,letterSpacing:2,marginBottom:4}}>BSBD CLINICAL</div>
        <h1 style={{fontSize:20,fontWeight:800,margin:0}}>Smart Notes</h1>
        <div style={{fontSize:12,opacity:.75,marginTop:4}}>Insurance-defensible clinical notes. Nothing is stored — generate, copy, paste into Ascend. No patient identifiers needed.</div>
      </div>

      {/* template picker */}
      {CATS.map(cat => (
        <div key={cat} style={{marginBottom:8}}>
          <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:1,marginBottom:4}}>{cat.toUpperCase()}</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {TEMPLATES.filter(t=>t.cat===cat).map(t=>(
              <button key={t.id} onClick={()=>setTplId(t.id)}
                style={{padding:'8px 14px',borderRadius:9,border:'2px solid '+(tplId===t.id?NAVY:'#e2e8f0'),cursor:'pointer',
                  fontSize:12,fontWeight:700,background:tplId===t.id?NAVY:'white',color:tplId===t.id?'white':'#64748b'}}>
                {t.label} <span style={{fontSize:9,opacity:.7}}>{t.codes}</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* form */}
      <div style={{...card,marginTop:14}}>
        <div style={{fontSize:13,fontWeight:800,color:NAVY,marginBottom:12}}>{tpl.label} <span style={{color:'#94a3b8',fontWeight:600}}>({tpl.codes})</span></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
          {tpl.fields.map(f=>(
            <div key={f.id} style={{gridColumn:f.span===2?'1/-1':'auto'}}>
              <div style={{fontSize:10,fontWeight:800,color:'#64748b',marginBottom:4}}>
                {f.label.toUpperCase()}{f.req&&<span style={{color:RED}}> *</span>}
                {f.pay&&<span title={f.pay} style={{marginLeft:6,fontSize:9,fontWeight:800,padding:'1px 6px',borderRadius:99,background:'#fef3c7',color:AMBER,cursor:'help'}}>$ PAYS</span>}
              </div>
              {f.type==='text'&&<input style={inp} value={v[f.id]??''} placeholder={f.placeholder||''} onChange={e=>set(f.id,e.target.value)}/>}
              {f.type==='num'&&<input type="number" style={inp} value={v[f.id]??''} onChange={e=>set(f.id,e.target.value)}/>}
              {f.type==='select'&&(
                <select style={inp} value={v[f.id]??''} onChange={e=>set(f.id,e.target.value)}>
                  <option value="">—</option>
                  {f.options.map(o=><option key={o}>{o}</option>)}
                </select>
              )}
              {f.type==='multi'&&(
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {f.options.map(o=>{
                    const on=(v[f.id]||[]).includes(o)
                    return (
                      <label key={o} style={{display:'flex',gap:6,alignItems:'flex-start',fontSize:12,color:'#334155',cursor:'pointer'}}>
                        <input type="checkbox" checked={on} onChange={()=>{
                          const cur=v[f.id]||[]
                          set(f.id,on?cur.filter(x=>x!==o):[...cur,o])
                        }}/>
                        {o}
                      </label>
                    )
                  })}
                </div>
              )}
              {f.type==='canals'&&(
                <div>
                  {(v.canalRows||[]).map((c,i)=>(
                    <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 70px 1fr 70px 24px',gap:6,marginBottom:5}}>
                      <input style={inp} placeholder="Canal (MB, DB, P…)" value={c.name} onChange={e=>{const r=[...v.canalRows];r[i]={...c,name:e.target.value};set('canalRows',r)}}/>
                      <input style={inp} placeholder="WL mm" value={c.wl} onChange={e=>{const r=[...v.canalRows];r[i]={...c,wl:e.target.value};set('canalRows',r)}}/>
                      <input style={inp} placeholder="Reference (cusp tip)" value={c.ref} onChange={e=>{const r=[...v.canalRows];r[i]={...c,ref:e.target.value};set('canalRows',r)}}/>
                      <input style={inp} placeholder="MAF" value={c.maf} onChange={e=>{const r=[...v.canalRows];r[i]={...c,maf:e.target.value};set('canalRows',r)}}/>
                      <button onClick={()=>set('canalRows',v.canalRows.filter((_,j)=>j!==i))}
                        style={{background:'none',border:'none',color:RED,cursor:'pointer',fontSize:16}}>×</button>
                    </div>
                  ))}
                  <button onClick={()=>set('canalRows',[...(v.canalRows||[]),{name:'',wl:'',ref:'',maf:''}])}
                    style={{padding:'5px 10px',borderRadius:6,background:'#eff6ff',color:BLUE,border:'1px solid #bfdbfe',fontWeight:600,fontSize:11,cursor:'pointer'}}>+ Add canal</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* payment warnings */}
      {missing.length>0&&(
        <div style={{background:'#fffbeb',border:'2px solid #fbbf24',borderRadius:10,padding:'10px 14px',marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:800,color:'#92400e',marginBottom:4}}>⚠ Payment-critical elements missing — claims with these gaps get denied:</div>
          {missing.map(f=><div key={f.id} style={{fontSize:11,color:'#78350f',marginBottom:2}}>• <b>{f.label}:</b> {f.pay}</div>)}
        </div>
      )}

      {/* generated note */}
      <div style={{...card,border:'2px solid '+NAVY}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
          <div style={{fontSize:13,fontWeight:800,color:NAVY}}>Generated note</div>
          <button onClick={copy}
            style={{padding:'9px 20px',borderRadius:9,background:missing.length?AMBER:GREEN,color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
            📋 {missing.length?'Copy anyway':'Copy note'}
          </button>
        </div>
        <pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',fontSize:12.5,lineHeight:1.6,color:'#1e293b',background:'#f8fafc',borderRadius:8,padding:'12px 14px',margin:0}}>{note}</pre>
      </div>
    </div>
  )
}
