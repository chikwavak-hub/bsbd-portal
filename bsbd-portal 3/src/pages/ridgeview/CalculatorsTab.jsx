// src/pages/ridgeview/CalculatorsTab.jsx — Ortho / Invisalign / In-House
// payment calculators. Mirrors the Treatment Coordinator workbook math:
// records + treatment (+ aligner fee) − insurance estimate − down payment
// = balance, offered over 4/6/12/custom months; in-house plans use a fixed
// monthly charge with the final payment absorbing the remainder.
// Outputs: patient presentation, signable payment agreement, schedule letter.

import React, { useState, useMemo } from 'react'
import { N, USD, todayStr } from '../../lib/helpers'
import { OFFICES } from '../../lib/constants'
import { buildSchedule, buildOrthoPresentation, buildOrthoAgreement, buildScheduleLetter, openDoc } from '../../lib/orthoDocs'

const NAVY='#1e3a5f', BLUE='#1d4ed8', TEAL='#0d9488', GREEN='#16a34a', AMBER='#d97706', RED='#dc2626'

const Field = ({label, children, w}) => (
  <div style={{minWidth:w||150, flex:1}}>
    <div style={{fontSize:9,fontWeight:800,color:'#94a3b8',letterSpacing:.5,marginBottom:3}}>{label}</div>
    {children}
  </div>
)
const inp = {width:'100%',boxSizing:'border-box',padding:'8px 10px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,fontWeight:600}

export default function CalculatorsTab({ user, notify }) {
  const [mode, setMode] = useState('braces')            // braces | invisalign | inhouse
  const [office, setOffice] = useState(OFFICES[0])
  const [patientName, setPatientName] = useState('')
  const [guarantorName, setGuarantorName] = useState('')
  const [patientAddress, setPatientAddress] = useState('')
  // ortho inputs
  const [records, setRecords] = useState(350)
  const [txTotal, setTxTotal] = useState(5000)
  const [alignerFee, setAlignerFee] = useState(1800)
  const [insEst, setInsEst] = useState(0)
  const [down, setDown] = useState(1000)
  // in-house inputs
  const [ihBalance, setIhBalance] = useState(0)
  const [ihCharge, setIhCharge] = useState(50)
  // shared plan inputs
  const [months, setMonths] = useState(12)
  const [startDate, setStartDate] = useState(todayStr())
  const [dueDay, setDueDay] = useState(1)
  const [lateFee, setLateFee] = useState(25)

  const isOrtho = mode !== 'inhouse'

  const calc = useMemo(() => {
    if (isOrtho) {
      const total = N(records) + N(txTotal) + (mode==='invisalign' ? N(alignerFee) : 0)
      const ptPortion = Math.max(total - N(insEst), 0)
      const balance = Math.max(ptPortion - N(down), 0)
      const lines = [
        { label:'Records / diagnostics', amount:N(records) },
        { label: mode==='invisalign' ? 'Orthodontic treatment' : 'Orthodontic treatment total', amount:N(txTotal) },
        ...(mode==='invisalign' ? [{ label:'Invisalign aligner fee', amount:N(alignerFee) }] : []),
        { label:'Total treatment cost', amount:total, strong:true },
        { label:'Estimated insurance payment', amount:N(insEst), neg:true },
        { label:'Patient portion', amount:ptPortion, strong:true },
        { label:'Down payment', amount:N(down), neg:true },
      ]
      return { total, ptPortion, balance, lines }
    }
    const balance = N(ihBalance)
    const nPay = N(ihCharge) > 0 ? Math.ceil(balance / N(ihCharge)) : 0
    return { total:balance, ptPortion:balance, balance,
      lines:[{ label:'Outstanding balance', amount:balance, strong:true }], ihMonths:nPay }
  }, [mode, records, txTotal, alignerFee, insEst, down, ihBalance, ihCharge, isOrtho])

  const activeMonths = isOrtho ? N(months) : (calc.ihMonths || 0)
  const schedule = useMemo(() => buildSchedule(calc.balance, activeMonths, startDate, N(dueDay), isOrtho ? null : N(ihCharge)),
    [calc.balance, activeMonths, startDate, dueDay, isOrtho, ihCharge])

  const optionFor = m => ({ label:`${m} months`, months:m, monthly: calc.balance>0 ? Math.floor(calc.balance/m*100)/100 : 0 })
  const options = useMemo(() => {
    const std=[4,6,12].map(optionFor)
    if(![4,6,12].includes(N(months)) && N(months)>0) std.push({...optionFor(N(months)), note:'custom term', highlight:true})
    else std.forEach(o=>{ if(o.months===N(months)) o.highlight=true })
    return std
  }, [calc.balance, months])

  const docData = () => ({
    office, patientName, guarantorName, patientAddress,
    planType: mode, today: todayStr(),
    lines: calc.lines, balance: calc.balance, downPayment: isOrtho ? N(down) : 0,
    options, schedule, lateFee: N(lateFee),
  })
  const need = () => { if(!patientName.trim()){ notify('Enter the patient name first','error'); return false } if(calc.balance<=0){ notify('Balance is $0 — check the numbers','error'); return false } return true }

  const card={background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:18,marginBottom:14}

  return (
    <div style={{maxWidth:1000,margin:'0 auto',padding:'20px 16px 80px'}}>
      <div style={{background:'linear-gradient(135deg,#1e3a5f,#1d4ed8)',borderRadius:14,padding:'18px 24px',marginBottom:18,color:'white'}}>
        <div style={{fontSize:10,opacity:.5,fontWeight:700,letterSpacing:2,marginBottom:4}}>RIDGEVIEW BILLING PORTAL</div>
        <h1 style={{fontSize:20,fontWeight:800,margin:0}}>Payment Calculators</h1>
        <div style={{fontSize:12,opacity:.75,marginTop:4}}>Ortho, Invisalign and in-house plans — presentation, agreement, and schedule letter in one pass.</div>
      </div>

      {/* mode selector */}
      <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
        {[['braces','🦷 Braces / Ortho'],['invisalign','😁 Invisalign'],['inhouse','🗓️ In-House Plan']].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)}
            style={{padding:'10px 20px',borderRadius:10,border:'2px solid '+(mode===k?NAVY:'#e2e8f0'),cursor:'pointer',
              fontSize:13,fontWeight:800,background:mode===k?NAVY:'white',color:mode===k?'white':'#64748b'}}>{l}</button>
        ))}
      </div>

      {/* patient */}
      <div style={card}>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          <Field label="PATIENT NAME *" w={220}><input style={inp} value={patientName} onChange={e=>setPatientName(e.target.value)}/></Field>
          <Field label="GUARANTOR (IF MINOR)" w={180}><input style={inp} value={guarantorName} onChange={e=>setGuarantorName(e.target.value)}/></Field>
          <Field label="OFFICE" w={130}>
            <select style={inp} value={office} onChange={e=>setOffice(e.target.value)}>{OFFICES.map(o=><option key={o}>{o}</option>)}</select>
          </Field>
          <Field label="ADDRESS (FOR LETTER)" w={220}><input style={inp} value={patientAddress} onChange={e=>setPatientAddress(e.target.value)}/></Field>
        </div>
      </div>

      {/* numbers */}
      <div style={card}>
        <div style={{fontSize:13,fontWeight:800,color:NAVY,marginBottom:12}}>{isOrtho?'Treatment numbers':'Balance & payment'}</div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
          {isOrtho ? (<>
            <Field label="RECORDS / DIAGNOSTICS $"><input type="number" style={inp} value={records} onChange={e=>setRecords(e.target.value)}/></Field>
            <Field label="TREATMENT TOTAL $"><input type="number" style={inp} value={txTotal} onChange={e=>setTxTotal(e.target.value)}/></Field>
            {mode==='invisalign'&&<Field label="INVISALIGN FEE $"><input type="number" style={inp} value={alignerFee} onChange={e=>setAlignerFee(e.target.value)}/></Field>}
            <Field label="INSURANCE ESTIMATE $ (LIFETIME ORTHO)"><input type="number" style={inp} value={insEst} onChange={e=>setInsEst(e.target.value)}/></Field>
            <Field label="DOWN PAYMENT $"><input type="number" style={inp} value={down} onChange={e=>setDown(e.target.value)}/></Field>
          </>) : (<>
            <Field label="OUTSTANDING BALANCE $"><input type="number" style={inp} value={ihBalance} onChange={e=>setIhBalance(e.target.value)}/></Field>
            <Field label="MONTHLY CHARGE $"><input type="number" style={inp} value={ihCharge} onChange={e=>setIhCharge(e.target.value)}/></Field>
          </>)}
        </div>
        {/* live summary */}
        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:14}}>
          {isOrtho&&<div style={{background:'#f8fafc',borderRadius:9,padding:'8px 14px',border:'1px solid #f1f5f9'}}>
            <div style={{fontSize:9,fontWeight:800,color:'#94a3b8'}}>TOTAL COST</div>
            <div style={{fontSize:16,fontWeight:800,color:NAVY}}>{USD(calc.total)}</div></div>}
          {isOrtho&&<div style={{background:'#f8fafc',borderRadius:9,padding:'8px 14px',border:'1px solid #f1f5f9'}}>
            <div style={{fontSize:9,fontWeight:800,color:'#94a3b8'}}>PATIENT PORTION</div>
            <div style={{fontSize:16,fontWeight:800,color:BLUE}}>{USD(calc.ptPortion)}</div></div>}
          <div style={{background:'#eff6ff',borderRadius:9,padding:'8px 14px',border:'2px solid #93c5fd'}}>
            <div style={{fontSize:9,fontWeight:800,color:'#64748b'}}>BALANCE TO FINANCE</div>
            <div style={{fontSize:16,fontWeight:800,color:NAVY}}>{USD(calc.balance)}</div></div>
          {!isOrtho&&calc.ihMonths>0&&<div style={{background:'#f0fdf4',borderRadius:9,padding:'8px 14px',border:'1px solid #bbf7d0'}}>
            <div style={{fontSize:9,fontWeight:800,color:'#64748b'}}>PAYMENTS NEEDED</div>
            <div style={{fontSize:16,fontWeight:800,color:GREEN}}>{calc.ihMonths} × {USD(N(ihCharge))}</div></div>}
        </div>
      </div>

      {/* term + schedule */}
      <div style={card}>
        <div style={{fontSize:13,fontWeight:800,color:NAVY,marginBottom:12}}>Payment plan</div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'flex-end'}}>
          {isOrtho&&(
            <Field label="TERM (MONTHS)" w={200}>
              <div style={{display:'flex',gap:6}}>
                {[4,6,12].map(m=>(
                  <button key={m} onClick={()=>setMonths(m)}
                    style={{flex:1,padding:'8px 0',borderRadius:8,border:'2px solid '+(N(months)===m?NAVY:'#e2e8f0'),
                      background:N(months)===m?NAVY:'white',color:N(months)===m?'white':'#64748b',fontWeight:800,fontSize:13,cursor:'pointer'}}>{m}</button>
                ))}
                <input type="number" min="1" max="60" value={months} onChange={e=>setMonths(e.target.value)}
                  style={{width:64,padding:'8px',borderRadius:8,border:'1px solid #e2e8f0',fontSize:13,fontWeight:700,textAlign:'center'}}/>
              </div>
            </Field>
          )}
          <Field label="FIRST PAYMENT DATE" w={160}><input type="date" style={inp} value={startDate} onChange={e=>setStartDate(e.target.value)}/></Field>
          <Field label="DUE DAY OF MONTH" w={110}><input type="number" min="1" max="28" style={inp} value={dueDay} onChange={e=>setDueDay(e.target.value)}/></Field>
          <Field label="LATE FEE $" w={90}><input type="number" style={inp} value={lateFee} onChange={e=>setLateFee(e.target.value)}/></Field>
        </div>

        {isOrtho&&calc.balance>0&&(
          <div style={{display:'flex',gap:10,marginTop:14,flexWrap:'wrap'}}>
            {options.map(o=>(
              <div key={o.label} onClick={()=>setMonths(o.months)}
                style={{flex:1,minWidth:130,textAlign:'center',padding:'12px 10px',borderRadius:10,cursor:'pointer',
                  border:'2px solid '+(o.highlight?'#C9A84C':'#e2e8f0'),background:o.highlight?'#fffdf5':'white'}}>
                <div style={{fontSize:10,fontWeight:800,color:'#94a3b8'}}>{o.label.toUpperCase()}</div>
                <div style={{fontSize:19,fontWeight:800,color:NAVY}}>{USD(o.monthly)}<span style={{fontSize:10,color:'#94a3b8'}}>/mo</span></div>
              </div>
            ))}
          </div>
        )}

        {schedule.length>0&&(
          <div style={{marginTop:14}}>
            <div style={{fontSize:11,fontWeight:800,color:'#94a3b8',marginBottom:6}}>PAYMENT DATES ({schedule.length})</div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:6}}>
              {schedule.map((s,i)=>(
                <div key={i} style={{display:'flex',justifyContent:'space-between',background:'#f8fafc',borderRadius:7,
                  padding:'6px 10px',border:'1px solid #f1f5f9',fontSize:11}}>
                  <span style={{color:'#64748b'}}>{i+1}. {s.date}</span>
                  <b style={{color:i===schedule.length-1&&s.amount!==schedule[0].amount?AMBER:'#1e293b'}}>{USD(s.amount)}</b>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* documents */}
      <div style={{...card,border:'2px solid '+NAVY}}>
        <div style={{fontSize:13,fontWeight:800,color:NAVY,marginBottom:4}}>Generate documents</div>
        <div style={{fontSize:11,color:'#94a3b8',marginBottom:12}}>Each opens print-ready — save as PDF or print for signature.</div>
        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
          <button onClick={()=>{ if(need()) openDoc(buildOrthoPresentation(docData())) }}
            style={{padding:'11px 20px',borderRadius:9,background:BLUE,color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
            📊 Payment Presentation
          </button>
          <button onClick={()=>{ if(need()) openDoc(buildOrthoAgreement(docData())) }}
            style={{padding:'11px 20px',borderRadius:9,background:NAVY,color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
            📝 Payment Agreement
          </button>
          <button onClick={()=>{ if(need()) openDoc(buildScheduleLetter(docData())) }}
            style={{padding:'11px 20px',borderRadius:9,background:TEAL,color:'white',border:'none',fontWeight:700,fontSize:13,cursor:'pointer'}}>
            ✉️ Schedule Letter
          </button>
        </div>
      </div>
    </div>
  )
}
