import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

function parseDentrixNum(str) {
  if (!str) return 0;
  const s = String(str).replace(/\s/g,'').replace(/,/g,'');
  if (/k$/i.test(s)) return parseFloat(s) * 1000;
  return parseFloat(s) || 0;
}

// ── Extract a labelled row value from a text block ─────────────────────────
// Returns { current, mtd, prev } for rows like "Estimated Net Production 1,911.05 168,526.81 201,941.28"

function extractRow(text, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re  = new RegExp(esc+'\\s+(-?[\\d,]+(?:\\.\\d+)?k?)\\s+(-?[\\d,]+(?:\\.\\d+)?k?)\\s+(-?[\\d,]+(?:\\.\\d+)?k?)', 'i');
  const m   = text.match(re);
  if (!m) return null;
  return { current: parseDentrixNum(m[1]), mtd: parseDentrixNum(m[2]), prev: parseDentrixNum(m[3]) };
}

// Same but for rows with only 2 numbers (Average rows)

function extractRow2(text, label) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re  = new RegExp(esc+'\\s+(-?[\\d,]+(?:\\.\\d+)?k?)\\s+(-?[\\d,]+(?:\\.\\d+)?k?)', 'i');
  const m   = text.match(re);
  if (!m) return null;
  return { current: parseDentrixNum(m[1]), mtd: parseDentrixNum(m[2]) };
}

// ── Detect office name from text ───────────────────────────────────────────

function detectOffice(text) {
  const officeMap = { brainerd:'Brainerd', calhoun:'Calhoun', dalton:'Dalton', mccallie:'McCallie', mcallie:'McCallie' };
  const t = text.toLowerCase();
  for (const [key, val] of Object.entries(officeMap)) { if (t.includes(key)) return val; }
  return '';
}

// ── Detect date from text ──────────────────────────────────────────────────

function detectDate(text) {
  const m = text.match(/Date Range:\s*(\d{2}\/\d{2}\/\d{4})/);
  if (!m) return '';
  const [mo,dy,yr] = m[1].split('/');
  return `${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
}

// ── Match a Dentrix provider name to a portal provider ────────────────────
// Dentrix format: "Pinos, DMD, Adrian - PINO" or "Patel, Kush - Kush"

function matchProvider(dentrixName, portalProviders) {
  const lastName = dentrixName.split(',')[0].trim().toUpperCase();
  return portalProviders.find(p => p.name.toUpperCase().includes(lastName)) || null;
}

// ── Is this a hygienist provider? ─────────────────────────────────────────

function isHygienist(dentrixName) {
  const n = dentrixName.toUpperCase();
  return /HYG|RDH|HYGIENIST/.test(n);
}

// ── Parse full day sheet text ──────────────────────────────────────────────

function parseDaySheetText(rawText, portalProviders) {
  const text = rawText.replace(/\r/g, '\n');

  const result = {
    office       : detectOffice(text),
    date         : detectDate(text),
    netProduction: 0,
    enteredPayments: 0,
    newPatients  : 0,
    patientsSeen : 0,
    providers    : [],
    hygienists   : [],
    mtd          : {},
  };

  // ── Location totals (stop before first Provider Totals) ─────────────────
  const provIdx = text.indexOf('Provider Totals');
  const locText = provIdx > 0 ? text.slice(0, provIdx) : text;

  const netProd = extractRow(locText, 'Estimated Net Production');
  const payments= extractRow(locText, 'Entered Payments');
  const newPts  = extractRow(locText, 'New Patients');
  const ptsSeen = extractRow(locText, 'Patients Seen');

  if (netProd)  { result.netProduction   = netProd.current;  result.mtd.netProduction   = netProd.mtd; }
  if (payments) { result.enteredPayments = Math.abs(payments.current); result.mtd.collections = Math.abs(payments.mtd); }
  if (newPts)   { result.newPatients     = newPts.current;   result.mtd.newPatients     = newPts.mtd; }
  if (ptsSeen)  { result.patientsSeen    = ptsSeen.current;  result.mtd.patientsSeen    = ptsSeen.mtd; }

  // ── Provider sections ────────────────────────────────────────────────────
  // Split on "Provider Totals" markers
  const sections = text.split(/(?=\n[^\n]+Provider Totals)/);
  for (const sec of sections) {
    // Find the provider name line: "LastName, ... - CODE - Provider Totals"
    const hdrMatch = sec.match(/^([A-Z][^\n]+?)\s*-\s*[\w]+\s*(?:\(inactivated\))?\s*-\s*Provider Totals/im);
    if (!hdrMatch) continue;

    const fullName  = hdrMatch[1].trim();
    const isInactive= sec.includes('(inactivated)');

    // Parse this provider's numbers
    const pProcChg = extractRow(sec, 'Procedure Charges');
    const pNetProd = extractRow(sec, 'Estimated Net Production');
    const pNewPts  = extractRow(sec, 'New Patients');
    const pPtsSeen = extractRow(sec, 'Patients Seen');

    // Skip providers with zero activity today
    const todayChg = pProcChg ? pProcChg.current : 0;
    if (todayChg === 0 && !isInactive) continue; // may have payments only — still skip for form
    if (todayChg === 0) continue;

    const netP   = pNetProd ? pNetProd.current  : 0;
    const seenP  = pPtsSeen ? pPtsSeen.current  : 0;
    const newP   = pNewPts  ? pNewPts.current   : 0;

    if (isHygienist(fullName)) {
      // Hygienist row
      const lastName = fullName.split(',')[0].trim();
      result.hygienists.push({
        name        : lastName,
        netProd     : netP,
        ptsSeen     : seenP,
        openSchedule: '',
        _id         : Math.random().toString(36),
      });
    } else {
      // Doctor row — try to match to portal provider
      const matched = matchProvider(fullName, portalProviders);
      result.providers.push({
        doctorId    : matched ? matched.id : '',
        doctorName  : matched ? matched.name : fullName.split(',')[0].trim(),
        netProd     : netP,
        ptsSeen     : seenP,
        npSeen      : newP,
        npSched     : '',
        openSchedule: '',
        _id         : Math.random().toString(36),
      });
    }
  }

  // Fallback: if no providers parsed but we have total production, create one row
  if (result.providers.length === 0 && result.netProduction > 0) {
    result.providers.push({
      doctorId:'', doctorName:'', netProd: result.netProduction,
      ptsSeen: result.patientsSeen, npSeen: result.newPatients, npSched:'', openSchedule:'',
      _id: Math.random().toString(36)
    });
  }

  return result;
}

// ── Parse deposit slip CSV ─────────────────────────────────────────────────

function parseDepositSlipCSV(csvText) {
  const lines = csvText.split('\n').map(l=>l.trim());

  // Find section totals by looking for "Total:,..." lines
  let cash=0, check=0, insCheck=0, cc=0, insCC=0, insElec=0, financing=0, elecTransfer=0;

  const findTotal = (sectionName) => {
    for (let i=0; i<lines.length; i++) {
      if (lines[i].toLowerCase().includes(sectionName.toLowerCase()) && lines[i].includes('Total:')) {
        const parts = lines[i].split(',');
        const val = parseFloat(parts[parts.length-1]) || 0;
        return val;
      }
    }
    return 0;
  };

  cash         = findTotal('Cash Payments');
  check        = findTotal('Check Payments');
  insCheck     = findTotal('Insurance Check Payments');
  cc           = findTotal('Credit Card Payments');
  insCC        = findTotal('Insurance Credit Card Payments');
  insElec      = findTotal('Insurance Electronic Payments');
  financing    = findTotal('Patient Financing Payments');
  elecTransfer = findTotal('Electronic Transfer Payments');

  // Try to get grand total from last "Totals" line
  let grandTotal = 0;
  for (let i=lines.length-1; i>=0; i--) {
    const p = lines[i].split(',');
    if (p.some(x=>x.trim().toLowerCase()==='totals')) {
      grandTotal = parseFloat(p[p.length-1]) || 0;
      break;
    }
  }

  // Extract office & date
  let office = '', date = '';
  for (const l of lines) {
    if (l.toLowerCase().includes('locations:')) {
      const officeStr = l.split(',')[1] || '';
      ['Brainerd','Calhoun','Dalton','McCallie'].forEach(o => { if (officeStr.toLowerCase().includes(o.toLowerCase())) office=o; });
    }
    const dm = l.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (dm && !date) {
      const [mo,dy,yr] = dm[1].split('/');
      date = `${yr}-${mo.padStart(2,'0')}-${dy.padStart(2,'0')}`;
    }
  }

  const nonIns = cash + check + cc + financing + elecTransfer;
  const ins    = insCheck + insCC + insElec;
  const total  = grandTotal || (nonIns + ins);

  return { office, date, nonIns, ins, total,
    breakdown: { cash, check, insCheck, cc, insCC, insElec, financing, elecTransfer }
  };
}

// ── Extract text from PDF using PDF.js ────────────────────────────────────
async function extractPdfText(file) {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

  const arrayBuffer = await file.arrayBuffer();
  const pdf         = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  let fullText      = '';

  for (let p=1; p<=pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText= content.items.map(i=>i.str).join(' ');
    fullText      += pageText + '\n';
  }
  return fullText;
}

// ── Dentrix Import Modal ───────────────────────────────────────────────────

function DentrixImportModal({providers, formOffice, formDate, onApply, onClose, notify}) {
  const [daySheetFile, setDaySheetFile]   = useState(null);
  const [depositFile,  setDepositFile]    = useState(null);
  const [daySheetFiles, setDaySheetFiles] = useState([]); // multi-office
  const [fileOffices,  setFileOffices]    = useState({}); // filename -> detected office
  const [parsing,      setParsing]        = useState(false);
  const [preview,      setPreview]        = useState(null); // parsed result
  const [error,        setError]          = useState('');

  const handleDaySheets = async (e) => {
    const files = Array.from(e.target.files);
    setDaySheetFiles(files);
    setPreview(null);
    // Quick-detect office from each file name (fast fallback)
    // and attempt a quick text scan for the location line
    const detected = {};
    for (const file of files) {
      // Try filename first
      const fn = file.name.toLowerCase();
      let office = '';
      if      (fn.includes('brainerd'))  office = 'Brainerd';
      else if (fn.includes('calhoun'))   office = 'Calhoun';
      else if (fn.includes('dalton'))    office = 'Dalton';
      else if (fn.includes('mccallie') || fn.includes('mcallie')) office = 'McCallie';
      // If filename gave nothing, try reading first 800 bytes of text
      if (!office) {
        try {
          const slice = file.slice(0, 800);
          const txt   = await slice.text();
          office = detectOffice(txt);
        } catch {}
      }
      detected[file.name] = office || 'Unknown';
    }
    setFileOffices(detected);
  };
  const handleDeposit = (e) => {
    setDepositFile(e.target.files[0]);
    setPreview(null);
  };

  const parse = async () => {
    if (daySheetFiles.length === 0 && !depositFile) {
      setError('Upload at least one file to import.');
      return;
    }
    setParsing(true);
    setError('');
    try {
      let combinedResult = {
        offices: [],
        providers: [],
        hygienists: [],
        patientsSeen: 0,
        newPatients: 0,
        netProduction: 0,
        collections: null,
        date: '',
      };

      // Parse each day sheet PDF
      for (const file of daySheetFiles) {
        let text = '';
        if (file.name.toLowerCase().endsWith('.pdf')) {
          text = await extractPdfText(file);
        } else {
          // Try as text/html
          text = await file.text();
        }
        const parsed = parseDaySheetText(text, providers);
        combinedResult.offices.push({
          office       : parsed.office,
          date         : parsed.date,
          netProduction: parsed.netProduction,
          patientsSeen : parsed.patientsSeen,
          newPatients  : parsed.newPatients,
          enteredPayments: parsed.enteredPayments,
          providers    : parsed.providers,
          hygienists   : parsed.hygienists,
          mtd          : parsed.mtd,
        });
        // Accumulate
        combinedResult.providers  = [...combinedResult.providers,  ...parsed.providers];
        combinedResult.hygienists = [...combinedResult.hygienists, ...parsed.hygienists];
        combinedResult.patientsSeen  += parsed.patientsSeen;
        combinedResult.newPatients   += parsed.newPatients;
        combinedResult.netProduction += parsed.netProduction;
        if (parsed.date) combinedResult.date = parsed.date;
      }

      // Parse deposit slip CSV
      if (depositFile) {
        const csvText = await depositFile.text();
        const dep = parseDepositSlipCSV(csvText);
        combinedResult.collections = dep;
        if (!combinedResult.date && dep.date) combinedResult.date = dep.date;
      }

      setPreview(combinedResult);
    } catch (err) {
      setError('Parse error: ' + err.message);
    }
    setParsing(false);
  };

  const apply = () => {
    if (!preview) return;
    // If single office, use that office's data directly
    const singleOffice = preview.offices.length === 1 ? preview.offices[0] : null;
    onApply({
      office      : singleOffice?.office || '',
      date        : preview.date,
      providers   : preview.providers,
      hygienists  : preview.hygienists,
      patientsSeen: preview.patientsSeen,
      newPatients : preview.newPatients,
      collections : preview.collections,
    });
  };

  const DropZone = ({label, accept, multiple, onChange, files}) => (
    <label style={{display:'block',border:'2px dashed #e2e8f0',borderRadius:12,padding:'24px',textAlign:'center',cursor:'pointer',background:'#f8fafc',transition:'border-color .2s'}}
      onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#0d9488';}}
      onDragLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';}}
      onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#e2e8f0';const dt=e.dataTransfer.files;if(dt.length>0)onChange({target:{files:dt}});}}>
      <input type="file" accept={accept} multiple={multiple} onChange={onChange} style={{display:'none'}}/>
      <IcoUpload size={28} style={{color:'#0d9488',margin:'0 auto 10px'}}/>
      <div style={{fontSize:13,fontWeight:700,color:'#1e293b',marginBottom:4}}>{label}</div>
      {files && files.length > 0
        ? <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:4}}>
            {files.map(f=>{
              const det = fileOffices?.[f.name];
              const mismatch = formOffice && det && det!=='Unknown' && det!==formOffice;
              return (
                <div key={f.name} style={{display:'flex',alignItems:'center',gap:6,justifyContent:'center',flexWrap:'wrap'}}>
                  <span style={{fontSize:11,color:'#0d9488',fontWeight:600}}>{f.name}</span>
                  {det&&det!=='Unknown'&&<span style={{fontSize:10,fontWeight:800,padding:'2px 8px',borderRadius:99,background:mismatch?'#fee2e2':'#dcfce7',color:mismatch?'#dc2626':'#16a34a'}}>{det} {mismatch?'⚠ MISMATCH':''}</span>}
                  {det==='Unknown'&&<span style={{fontSize:10,color:'#94a3b8',fontWeight:600,padding:'2px 8px',borderRadius:99,background:'#f1f5f9'}}>Office not detected</span>}
                </div>
              );
            })}
          </div>
        : <div style={{fontSize:11,color:'#94a3b8'}}>Click to browse or drag & drop</div>}
    </label>
  );

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:680,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 25px 60px rgba(0,0,0,.3)'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px',borderBottom:'1px solid #e2e8f0'}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:800,color:'#1e293b',margin:0}}>Import from Dentrix Ascend</h2>
            <p style={{fontSize:12,color:'#94a3b8',marginTop:3}}>Upload Day Sheet PDFs and/or Deposit Slip CSV — data auto-fills the form</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}><IcoX size={20}/></button>
        </div>

        <div style={{padding:'20px 24px'}}>
          {/* Upload areas */}
          {!preview && (
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:8}}>DAY SHEET REPORTS (PDF) — one or more offices</div>
                <DropZone label="Drop Day Sheet PDF(s) here" accept=".pdf" multiple={true} onChange={handleDaySheets} files={daySheetFiles}/>
                <p style={{fontSize:11,color:'#94a3b8',marginTop:6}}>In Dentrix Ascend: Reports → Day Sheet Report → Export as PDF. You can upload all 4 offices at once.</p>
              </div>
              <div>
                <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:8}}>DEPOSIT SLIP (CSV) — optional, fills collections</div>
                <DropZone label="Drop Deposit Slip CSV here" accept=".csv" multiple={false} onChange={handleDeposit} files={depositFile?[depositFile]:[]}/>
                <p style={{fontSize:11,color:'#94a3b8',marginTop:6}}>In Dentrix Ascend: Reports → Deposit Slip Report → Export as CSV. Splits insurance vs non-insurance automatically.</p>
              </div>
              {error && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:10,fontSize:12,color:'#dc2626'}}>{error}</div>}
              <button onClick={parse} disabled={parsing||(daySheetFiles.length===0&&!depositFile)} style={{padding:'11px 0',borderRadius:10,background:parsing?'#5eead4':'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:(parsing||(daySheetFiles.length===0&&!depositFile))?'not-allowed':'pointer'}}>
                {parsing ? '⏳ Parsing files…' : '🔍 Parse & Preview'}
              </button>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div>
              <div style={{background:'#f0fdfa',borderRadius:10,padding:'12px 16px',marginBottom:16,display:'flex',alignItems:'center',gap:10}}>
                <IcoCheck size={18} style={{color:'#0d9488'}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#134e4a'}}>Parse complete — review before applying</div>
                  <div style={{fontSize:11,color:'#0d9488',marginTop:2}}>Fields will be added to the form. Any fields not found here remain blank for manual entry.</div>
                </div>
              </div>

              {/* Per-office summaries */}
              {preview.offices.map((o,i) => (
                <div key={i} style={{background:'white',borderRadius:10,border:'1px solid #e2e8f0',padding:16,marginBottom:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
                    <span style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>{o.office||'Unknown Office'}</span>
                    <span style={{fontSize:11,color:'#94a3b8'}}>{o.date}</span>
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:10}}>
                    {[['Net Production',USD(o.netProduction)],['Patients Seen',o.patientsSeen],['New Patients',o.newPatients]].map(([l,v])=>(
                      <div key={l} style={{background:'#f8fafc',borderRadius:8,padding:'8px 12px'}}>
                        <div style={{fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:2}}>{l.toUpperCase()}</div>
                        <div style={{fontSize:15,fontWeight:800,color:'#1e293b'}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Providers */}
                  {o.providers.length > 0 && (
                    <div style={{marginBottom:8}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:6,letterSpacing:1}}>PROVIDERS (today only)</div>
                      {o.providers.map((p,j)=>(
                        <div key={j} style={{display:'flex',gap:12,padding:'6px 0',borderBottom:'1px solid #f8fafc',fontSize:12,color:'#475569'}}>
                          <span style={{fontWeight:700,color:'#1e293b',flex:1}}>{p.doctorName||'Unmatched'}{p.doctorId?'':' ⚠️'}</span>
                          <span>Prod: <b style={{color:'#0d9488'}}>{USD(p.netProd)}</b></span>
                          <span>Seen: <b>{p.ptsSeen}</b></span>
                          <span>NP: <b>{p.npSeen}</b></span>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Hygienists */}
                  {o.hygienists.length > 0 && (
                    <div>
                      <div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:6,letterSpacing:1}}>HYGIENISTS</div>
                      {o.hygienists.map((h,j)=>(
                        <div key={j} style={{display:'flex',gap:12,padding:'6px 0',borderBottom:'1px solid #f8fafc',fontSize:12,color:'#475569'}}>
                          <span style={{fontWeight:700,color:'#1e293b',flex:1}}>{h.name}</span>
                          <span>Prod: <b style={{color:'#0d9488'}}>{USD(h.netProd)}</b></span>
                          <span>Seen: <b>{h.ptsSeen}</b></span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {/* Deposit slip summary */}
              {preview.collections && (
                <div style={{background:'white',borderRadius:10,border:'1px solid #e2e8f0',padding:16,marginBottom:16}}>
                  <div style={{fontSize:13,fontWeight:800,color:'#1e293b',marginBottom:10}}>Collections (Deposit Slip)</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                    {[['Non-Insurance',USD(preview.collections.nonIns),'#1d4ed8'],['Insurance',USD(preview.collections.ins),'#7c3aed'],['Total',USD(preview.collections.total),'#16a34a']].map(([l,v,c])=>(
                      <div key={l} style={{background:'#f8fafc',borderRadius:8,padding:'8px 12px'}}>
                        <div style={{fontSize:10,color:'#94a3b8',fontWeight:700,marginBottom:2}}>{l.toUpperCase()}</div>
                        <div style={{fontSize:15,fontWeight:800,color:c}}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{marginTop:10,fontSize:11,color:'#94a3b8',display:'flex',flexWrap:'wrap',gap:8}}>
                    {Object.entries(preview.collections.breakdown).filter(([,v])=>v>0).map(([k,v])=>(
                      <span key={k} style={{background:'#f1f5f9',padding:'2px 8px',borderRadius:99}}>{k.replace(/([A-Z])/g,' $1').trim()}: ${v.toFixed(2)}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {preview.providers.filter(p=>!p.doctorId).length > 0 && (
                <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,padding:'10px 14px',marginBottom:12,fontSize:12,color:'#92400e'}}>
                  ⚠️ {preview.providers.filter(p=>!p.doctorId).length} provider(s) couldn't be auto-matched to your provider list — you'll need to select them manually in the form.
                </div>
              )}

              {/* Office mismatch warnings */}
              {preview.offices.filter(o=>o.office&&formOffice&&o.office!==formOffice).map((o,i)=>(
                <div key={i} style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:10,padding:'10px 14px',marginBottom:10,fontSize:12,color:'#dc2626',fontWeight:600,display:'flex',alignItems:'center',gap:8}}>
                  <IcoAlert size={14}/>
                  This day sheet is for <b>{o.office}</b> but your form is set to <b>{formOffice}</b>. Either change the form's office to {o.office}, or upload the correct day sheet.
                </div>
              ))}
              {/* Date mismatch warning */}
              {preview.date&&formDate&&preview.date!==formDate&&(
                <div style={{background:'#fffbeb',border:'1px solid #fde68a',borderRadius:10,padding:'10px 14px',marginBottom:10,fontSize:12,color:'#d97706',fontWeight:600,display:'flex',alignItems:'center',gap:8}}>
                  <IcoAlert size={14}/>
                  Day sheet date is <b>{preview.date}</b> but form date is <b>{formDate}</b>. Make sure these match before submitting.
                </div>
              )}
              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setPreview(null)} style={{padding:'10px 22px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>← Back</button>
                {preview.offices.some(o=>o.office&&formOffice&&o.office!==formOffice)
                  ? <button disabled style={{padding:'10px 28px',borderRadius:8,background:'#fca5a5',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:'not-allowed'}}>⚠ Fix Office Mismatch First</button>
                  : <button onClick={apply} style={{padding:'10px 28px',borderRadius:8,background:'#0d9488',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:'pointer'}}>✓ Apply to Form</button>
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ════════════════════════════════════════════════════════════════════════════
// MORNING HUDDLE PAGE
// ════════════════════════════════════════════════════════════════════════════

// ── Working-day helpers ────────────────────────────────────────────────────

function ManagerFormPage({user,providers,users,officeStaff,reports,upsertReport,repEmail,notify,editReport,onEditDone}){
  const isEditing=!!editReport;
  const initForm=()=>{if(isEditing){const prov=(editReport.providers||[newProv()]).map(p=>({...p,_id:p._id||Math.random().toString(36)}));const hyg=(editReport.hygiene||[newHyg()]).map(h=>({...h,_id:h._id||Math.random().toString(36)}));return{...editReport,providers:prov,hygiene:hyg};}return blankForm(user);};
  const [form,setForm]              =useState(initForm);
  const [done,setDone]              =useState(false);
  const [submitting,setSubmitting]  =useState(false);
  const [savingDraft,setSavingDraft]=useState(false);
  const [draftSavedAt,setDraftSavedAt]=useState(null);
  const [loadingDrafts,setLoadingDrafts]=useState(false);
  const [drafts,setDrafts]          =useState([]);
  const [resumeBanner,setResumeBanner]=useState(null);
  const [showImport,setShowImport]=useState(false);
  const [sec,setSec]                =useState({prov:true,hyg:true,sched:false,coll:false,claims:false,fd:false,notes:false});
  const tog=k=>setSec(s=>({...s,[k]:!s[k]}));
  const setF  =(path,val)=>setForm(f=>setPath(f,path,val));
  const setPF =(i,field,val)=>setForm(f=>{const a=[...f.providers];a[i]={...a[i],[field]:val};return{...f,providers:a};});
  const setHF =(i,field,val)=>setForm(f=>{const a=[...f.hygiene];a[i]={...a[i],[field]:val};return{...f,hygiene:a};});
  const setFDF=(name,field,val)=>setForm(f=>({...f,fd:{...f.fd,[name]:{...(f.fd[name]||newFD()),[field]:val}}}));

  useEffect(()=>{setForm(f=>{const fd={};officeStaff.forEach(s=>{fd[s]=f.fd[s]||newFD();});return{...f,fd};});},[officeStaff.join(",")]);

  // Check for saved manager draft on mount (new reports only)
  useEffect(()=>{
    if(isEditing) return;
    (async()=>{
      try{
        const rows=await sbGet('drafts',`date=eq.${form.date}&office=eq.${encodeURIComponent(form.office||user.office)}&staff_role=eq.manager_draft`);
        if(rows.length>0) setResumeBanner({savedAt:rows[0].saved_at,formData:rows[0].data});
      }catch{}
    })();
  },[]);

  const resumeDraft=()=>{if(!resumeBanner)return;const d=resumeBanner.formData;const prov=(d.providers||[newProv()]).map(p=>({...p,_id:p._id||Math.random().toString(36)}));const hyg=(d.hygiene||[newHyg()]).map(h=>({...h,_id:h._id||Math.random().toString(36)}));setForm({...d,providers:prov,hygiene:hyg});setDraftSavedAt(fmtTime(resumeBanner.savedAt));setResumeBanner(null);notify("Draft resumed ✓");};

  const saveDraft=async()=>{
    if(!form.office){notify("Select an office first","error");return;}
    setSavingDraft(true);
    try{
      await sbPost('drafts',{date:form.date,office:form.office,username:user.username,staff_name:user.name,staff_role:'manager_draft',data:form,saved_at:new Date().toISOString()},true);
      const now=new Date().toISOString();setDraftSavedAt(fmtTime(now));
      notify("Draft saved — resume any time from any device ✓");
    }catch{notify("Draft save failed — check connection","error");}
    setSavingDraft(false);
  };

  const loadDrafts=async()=>{
    if(!form.office){notify("Select an office first","error");return;}
    setLoadingDrafts(true);
    try{
      const rows=await sbGet('drafts',`date=eq.${form.date}&office=eq.${encodeURIComponent(form.office)}&staff_role=neq.manager_draft`);
      if(rows.length===0){notify("No staff drafts found for today","error");setLoadingDrafts(false);return;}
      setDrafts(rows.map(r=>({username:r.username,staffName:r.staff_name,staffRole:r.staff_role,savedAt:r.saved_at,sectionData:r.data})));
      let f={...form};
      for(const dr of rows){const sd=dr.data;
        if(dr.staff_role==="provider"&&sd.doctorId){const idx=f.providers.findIndex(p=>p.doctorId===sd.doctorId);if(idx>=0)f.providers=f.providers.map((p,i)=>i===idx?{...p,...sd}:p);else{const ei=f.providers.findIndex(p=>!p.doctorId);if(ei>=0)f.providers=f.providers.map((p,i)=>i===ei?{...newProv(),...sd}:p);else if(f.providers.length<4)f.providers=[...f.providers,{...newProv(),...sd}];}}
        else if(dr.staff_role==="hygienist"&&sd.name){const idx=f.hygiene.findIndex(h=>h.name===sd.name);if(idx>=0)f.hygiene=f.hygiene.map((h,i)=>i===idx?{...h,...sd}:h);else{const ei=f.hygiene.findIndex(h=>!h.name);if(ei>=0)f.hygiene=f.hygiene.map((h,i)=>i===ei?{...newHyg(),...sd}:h);else if(f.hygiene.length<2)f.hygiene=[...f.hygiene,{...newHyg(),...sd}];}}
        else if(dr.staff_role==="front_desk"){f={...f,fd:{...f.fd,[dr.staff_name]:{...(f.fd[dr.staff_name]||newFD()),...sd}}};}
      }
      setForm(f);notify(`✓ Loaded ${rows.length} staff draft(s)`);
    }catch{notify("Could not load drafts","error");}
    setLoadingDrafts(false);
  };

  const provGoal=form.providers.reduce((s,p)=>{const pr=providers.find(x=>x.id===p.doctorId);return s+(pr?N(pr.goal):0);},0);
  const dailyGoal=provGoal+form.hygiene.length*1200;
  const totalProd=form.providers.reduce((s,p)=>s+N(p.netProd),0)+form.hygiene.reduce((s,h)=>s+N(h.netProd),0);
  const totalColl=N(form.coll.nonIns)+N(form.coll.ins);
  const variance=totalProd-dailyGoal;

  const handleSubmit=async()=>{
    if(!form.date||!form.office){notify("Date and Office are required","error");return;}
    setSubmitting(true);
    const providerGoals=form.providers.map(p=>{const pr=providers.find(x=>x.id===p.doctorId);return pr?.goal||0;});
    const enriched={...form,id:isEditing?form.id:`r_${Date.now()}`,submittedAt:isEditing?form.submittedAt:new Date().toISOString(),providerGoals,providers:form.providers.map(p=>{const pr=providers.find(x=>x.id===p.doctorId);return{...p,doctorName:pr?.name||p.doctorName||""};}),};
    try{
      await upsertReport(enriched);
      notify(isEditing?"Report updated ✓":"Report submitted ✓");
      // Delete manager draft after successful submit
      if(!isEditing) sbDel('drafts',`date=eq.${form.date}&office=eq.${encodeURIComponent(form.office)}&staff_role=eq.manager_draft`).catch(()=>{});
    }catch(err){notify(`Save failed: ${err.message}`,"error");setSubmitting(false);return;}
    setSubmitting(false);setDone(true);
    const subj=encodeURIComponent(`BSBD Daily Report${isEditing?" (UPDATED)":""} — ${form.office} — ${form.date}`);
    const body=encodeURIComponent(`BSBD Daily Report\nOffice: ${form.office} | Date: ${form.date} | Manager: ${form.submittedBy}\n\nGoal: ${USD(dailyGoal)} | Production: ${USD(totalProd)} | Variance: ${variance>=0?"+":""}${USD(variance)}\nCollections: ${USD(totalColl)} | Rate: ${PCT(totalColl,dailyGoal)}\nNo Shows: ${form.sched.noShows||0} | Cancelled: ${form.sched.cancelled||0}`);
    window.open(`mailto:${repEmail}?subject=${subj}&body=${body}`);
    if(isEditing) onEditDone();
  };

  const expectedStaff=users.filter(u=>u.office===form.office&&["provider","hygienist","front_desk"].includes(u.role));
  const draftedUsernames=new Set(drafts.map(d=>d.username));

  if(done) return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:"100vh",gap:16,padding:32}}>
      <div style={{width:80,height:80,borderRadius:"50%",background:isEditing?"#fef3c7":"#dcfce7",display:"flex",alignItems:"center",justifyContent:"center",fontSize:40}}>{isEditing?"✏️":"✓"}</div>
      <h2 style={{fontSize:24,fontWeight:800,color:"#1e293b",margin:0}}>{isEditing?"Report Updated!":"Report Submitted!"}</h2>
      <p style={{color:"#64748b",fontSize:14}}>{form.office} · {form.date}</p>
      <button onClick={()=>{setForm(blankForm(user));setDone(false);setDrafts([]);setDraftSavedAt(null);}} style={{marginTop:8,display:"flex",alignItems:"center",gap:8,padding:"10px 28px",borderRadius:10,background:"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:14,cursor:"pointer"}}><IcoPlus size={16}/> New Report</button>
    </div>
  );

  const applyImport=(data)=>{
    // Apply parsed Dentrix data — office already validated in modal
    if(data.providers&&data.providers.length>0){
      const newProvs=data.providers.map(p=>({...newProv(),...p}));
      setForm(f=>({...f,providers:newProvs.length>0?newProvs:f.providers}));
    }
    if(data.hygienists&&data.hygienists.length>0){
      const newHygs=data.hygienists.map(h=>({...newHyg(),...h}));
      setForm(f=>({...f,hygiene:newHygs.length>0?newHygs:f.hygiene}));
    }
    if(data.collections){
      setForm(f=>({...f,coll:{nonIns:data.collections.nonIns.toFixed(2),ins:data.collections.ins.toFixed(2)}}));
    }
    // Auto-set office if form doesn't have one yet
    if(data.office&&!form.office) setForm(f=>({...f,office:data.office}));
    // Auto-set date if form doesn't have one yet
    if(data.date&&!form.date)     setForm(f=>({...f,date:data.date}));
    if(data.patientsSeen)         setForm(f=>({...f,sched:{...f.sched,ptsShowUp:String(data.patientsSeen)}}));
    if(data.newPatients)          setForm(f=>({...f,sched:{...f.sched,npShowed:String(data.newPatients)}}));
    notify('Dentrix data imported ✓ — review and complete remaining fields');
    setShowImport(false);
  };

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:"28px 20px 80px"}}>
      {showImport&&<DentrixImportModal providers={providers} formOffice={form.office} formDate={form.date} onApply={applyImport} onClose={()=>setShowImport(false)} notify={notify}/>}
      <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          {isEditing&&<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}><span style={{fontSize:11,fontWeight:800,padding:"3px 12px",borderRadius:99,background:"#fef3c7",color:"#d97706"}}>✏️ EDITING REPORT</span><span style={{fontSize:12,color:"#94a3b8"}}>{fmtDate(form.date)} · {form.office}</span></div>}
          <h1 style={{fontSize:24,fontWeight:800,color:"#1e293b",margin:0}}>{isEditing?"Edit Report":"Daily Office Report"}</h1>
        </div>
        {!isEditing&&<button onClick={()=>setShowImport(true)} style={{display:"flex",alignItems:"center",gap:7,padding:"9px 18px",borderRadius:10,background:"#0d9488",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoUpload size={14}/> Import from Dentrix</button>}
        {isEditing&&<button onClick={onEditDone} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 18px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoX size={14}/> Cancel</button>}
      </div>

      {resumeBanner&&!isEditing&&(
        <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:16,marginBottom:16,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <IcoSave size={18} style={{color:"#d97706"}}/><div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,color:"#92400e"}}>Saved draft found</div><div style={{fontSize:12,color:"#b45309"}}>Last saved {fmtTime(resumeBanner.savedAt)}</div></div>
          <button onClick={resumeDraft} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 18px",borderRadius:8,background:"#d97706",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoUndo size={14}/> Resume</button>
          <button onClick={()=>setResumeBanner(null)} style={{padding:"8px 12px",borderRadius:8,background:"none",color:"#94a3b8",border:"1px solid #e2e8f0",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoX size={14}/></button>
        </div>
      )}

      <div style={{...CARD,padding:20}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16}}>
          <div><label style={LBL}>Manager</label><input className="ic" value={form.submittedBy} onChange={e=>setF("submittedBy",e.target.value)}/></div>
          <div><label style={LBL}>Office *</label>{user.role==="admin"?<select className="ic" value={form.office} onChange={e=>setF("office",e.target.value)} disabled={isEditing}><option value="">Select…</option>{OFFICES.map(o=><option key={o}>{o}</option>)}</select>:<input className="ic" value={form.office} disabled/>}</div>
          <div><label style={LBL}>Report Date *</label><input type="date" className="ic" value={form.date} onChange={e=>setF("date",e.target.value)} disabled={isEditing}/></div>
        </div>
      </div>

      {!isEditing&&(
        <div style={{background:"white",borderRadius:12,border:"1px solid #e2e8f0",padding:16,marginBottom:16}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:(expectedStaff.length>0||drafts.length>0)?12:0,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
              <span style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>📥 Staff Drafts</span>
              {draftSavedAt&&<span style={{fontSize:11,color:"#10b981",fontWeight:600,display:"flex",alignItems:"center",gap:4}}><IcoCheck size={12}/> Saved {draftSavedAt}</span>}
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={saveDraft} disabled={savingDraft} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,background:"#fef3c7",color:"#d97706",border:"1px solid #fde68a",fontWeight:700,fontSize:12,cursor:savingDraft?"not-allowed":"pointer"}}><IcoSave size={13}/> {savingDraft?"Saving…":"Save Draft"}</button>
              <button onClick={loadDrafts} disabled={loadingDrafts} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,background:"#0d9488",color:"white",border:"none",fontWeight:700,fontSize:12,cursor:loadingDrafts?"not-allowed":"pointer"}}><IcoCloud size={13}/> {loadingDrafts?"Loading…":"Load Staff Drafts"}</button>
            </div>
          </div>
          {(expectedStaff.length>0||drafts.length>0)&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
              {expectedStaff.map(u=>{const has=draftedUsernames.has(u.username);const dr=drafts.find(d=>d.username===u.username);return(<div key={u.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 12px",borderRadius:99,fontSize:12,fontWeight:600,background:has?"#dcfce7":"#fee2e2",color:has?"#15803d":"#dc2626",border:`1px solid ${has?"#bbf7d0":"#fecaca"}`}}>{has?<IcoCheck size={12}/>:<IcoX size={12}/>} {u.staffName||u.name}{dr&&<span style={{fontSize:10,opacity:.7}}> · {fmtTime(dr.savedAt)}</span>}</div>);})}
              {expectedStaff.length===0&&drafts.length===0&&<span style={{fontSize:12,color:"#94a3b8"}}>Click "Load Staff Drafts" to pull individual staff data</span>}
            </div>
          )}
        </div>
      )}

      <div style={{background:isEditing?"linear-gradient(135deg,#78350f,#b45309)":"linear-gradient(135deg,#1e3a5f,#1a6b8a)",borderRadius:12,padding:"18px 24px",marginBottom:16,color:"white",display:"flex",flexWrap:"wrap"}}>
        {[["DAILY GOAL",USD(dailyGoal),null],["NET PRODUCTION",USD(totalProd),null],["VARIANCE",(variance>=0?"+":"")+USD(variance),variance>=0?"#4ade80":"#f87171"],["ACHIEVEMENT",PCT(totalProd,dailyGoal),null],["COLLECTIONS",USD(totalColl),null],["COLL RATE",PCT(totalColl,dailyGoal),null]].map(([label,val,color],i)=>(
          <div key={i} style={{flex:"1 1 120px",padding:"0 16px",borderLeft:i>0?"1px solid rgba(255,255,255,.15)":"none"}}><div style={{fontSize:9,opacity:.7,letterSpacing:1,fontWeight:700,marginBottom:4}}>{label}</div><div style={{fontSize:18,fontWeight:800,color:color||"white"}}>{val}</div></div>
        ))}
      </div>

      <Sect title="Provider Production" emoji="🩺" open={sec.prov} toggle={()=>tog("prov")}>
        {form.providers.map((prov,i)=>{const pr=providers.find(x=>x.id===prov.doctorId);const diff=N(prov.netProd)-N(pr?.goal||0);return(
          <div key={prov._id} style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12,border:"1px solid #e2e8f0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:11,fontWeight:800,color:"#475569",letterSpacing:1}}>PROVIDER {i+1}</span>{form.providers.length>1&&<button onClick={()=>setForm(f=>({...f,providers:f.providers.filter((_,j)=>j!==i)}))} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444"}}><IcoTrash size={14}/></button>}</div>
            <div style={{display:"flex",gap:6,alignItems:"flex-end",overflowX:"auto"}}>
              <div style={{flex:"0 0 190px"}}><label style={{...LBL,fontSize:10}}>Doctor</label><select style={{width:"100%",border:"1px solid #cbd5e1",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",background:"white"}} value={prov.doctorId} onChange={e=>setPF(i,"doctorId",e.target.value)}><option value="">Select Doctor…</option>{providers.map(p=><option key={p.id} value={p.id}>{p.name} · {USD(p.goal)}</option>)}</select></div>
              {[["Opening Sched ($)","openSchedule"],["Net Production ($)","netProd"]].map(([lbl,field])=>(<div key={field} style={{flex:"0 0 110px"}}><label style={{...LBL,fontSize:10}}>{lbl}</label><input type="number" min="0" style={{width:"100%",border:"1px solid #cbd5e1",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",boxSizing:"border-box"}} value={prov[field]} onChange={e=>setPF(i,field,e.target.value)} placeholder="0"/></div>))}
              {[["Pts Seen","ptsSeen"],["NP Sched","npSched"],["NP Seen","npSeen"]].map(([lbl,field])=>(<div key={field} style={{flex:"0 0 72px"}}><label style={{...LBL,fontSize:10}}>{lbl}</label><input type="number" min="0" style={{width:"100%",border:"1px solid #cbd5e1",borderRadius:6,padding:"5px 6px",fontSize:11,outline:"none",boxSizing:"border-box"}} value={prov[field]} onChange={e=>setPF(i,field,e.target.value)} placeholder="0"/></div>))}
            </div>
            {pr&&<div style={{marginTop:10,display:"flex",alignItems:"center",gap:8}}><span style={{fontSize:11,fontWeight:800,padding:"3px 10px",borderRadius:99,background:diff>=0?"#dcfce7":"#fee2e2",color:diff>=0?"#16a34a":"#dc2626"}}>{diff>=0?"▲ ABOVE GOAL":"▼ BELOW GOAL"}</span><span style={{fontSize:12,fontWeight:600,color:diff>=0?"#16a34a":"#dc2626"}}>{diff>=0?"+":""}{USD(diff)} vs {USD(pr.goal)} goal</span></div>}
          </div>
        );})}
        {form.providers.length<4&&<button onClick={()=>setForm(f=>({...f,providers:[...f.providers,newProv()]}))} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"1px dashed #cbd5e1",background:"white",color:"#64748b",cursor:"pointer",fontSize:13,fontWeight:600}}><IcoPlus size={14}/> Add Provider</button>}
      </Sect>

      <Sect title="Hygiene Production" emoji="🦷" open={sec.hyg} toggle={()=>tog("hyg")} badge="Goal: $1,200 / hygienist">
        {form.hygiene.map((hyg,i)=>(
          <div key={hyg._id} style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12,border:"1px solid #e2e8f0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:11,fontWeight:800,color:"#475569",letterSpacing:1}}>HYGIENIST {i+1}</span>{form.hygiene.length>1&&<button onClick={()=>setForm(f=>({...f,hygiene:f.hygiene.filter((_,j)=>j!==i)}))} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444"}}><IcoTrash size={14}/></button>}</div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:10}}>
              <div><label style={LBL}>Name</label><input className="ic" value={hyg.name} onChange={e=>setHF(i,"name",e.target.value)} placeholder="Name"/></div>
              <div><label style={LBL}>Opening ($)</label><input type="number" min="0" className="ic" value={hyg.openSchedule} onChange={e=>setHF(i,"openSchedule",e.target.value)} placeholder="0"/></div>
              <div><label style={LBL}>Net Prod ($)</label><input type="number" min="0" className="ic" value={hyg.netProd} onChange={e=>setHF(i,"netProd",e.target.value)} placeholder="0"/></div>
              <div><label style={LBL}># Pts Seen</label><input type="number" min="0" className="ic" value={hyg.ptsSeen} onChange={e=>setHF(i,"ptsSeen",e.target.value)} placeholder="0"/></div>
            </div>
            <div style={{marginTop:8,fontSize:12,fontWeight:700,color:N(hyg.netProd)>=1200?"#16a34a":"#dc2626"}}>{N(hyg.netProd)>=1200?"✓ Goal met":`▼ ${USD(1200-N(hyg.netProd))} below goal`}</div>
          </div>
        ))}
        {form.hygiene.length<2&&<button onClick={()=>setForm(f=>({...f,hygiene:[...f.hygiene,newHyg()]}))} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"1px dashed #cbd5e1",background:"white",color:"#64748b",cursor:"pointer",fontSize:13,fontWeight:600}}><IcoPlus size={14}/> Add Hygienist</button>}
      </Sect>

      <Sect title="Schedule & Patient Flow" emoji="📅" open={sec.sched} toggle={()=>tog("sched")}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
          <NF label="Total Schedule ($)" val={form.sched.totalAmt} set={v=>setF("sched.totalAmt",v)} pre/><RF label="Daily Goal (auto)" val={USD(dailyGoal)}/><RF label="Variance" val={(N(form.sched.totalAmt)-dailyGoal>=0?"+":"")+USD(N(form.sched.totalAmt)-dailyGoal)} col={N(form.sched.totalAmt)>=dailyGoal?"#16a34a":"#dc2626"}/>
          <NF label="# Patients on Schedule" val={form.sched.ptsOnSched} set={v=>setF("sched.ptsOnSched",v)}/><NF label="# Patients Showed Up" val={form.sched.ptsShowUp} set={v=>setF("sched.ptsShowUp",v)}/><NF label="# Cancelled" val={form.sched.cancelled} set={v=>setF("sched.cancelled",v)}/>
          <NF label="# No Shows" val={form.sched.noShows} set={v=>setF("sched.noShows",v)}/><NF label="# Rescheduled" val={form.sched.rescheduled} set={v=>setF("sched.rescheduled",v)}/><NF label="# Recalls" val={form.sched.recalls} set={v=>setF("sched.recalls",v)}/>
          <NF label="# From Recalls" val={form.sched.recallsSched} set={v=>setF("sched.recallsSched",v)}/><NF label="# NP on Schedule" val={form.sched.npOnSched} set={v=>setF("sched.npOnSched",v)}/><NF label="# NP Showed" val={form.sched.npShowed} set={v=>setF("sched.npShowed",v)}/>
          <NF label="# NP Phone Calls" val={form.sched.npCalls} set={v=>setF("sched.npCalls",v)}/><NF label="# NP Sched from Calls" val={form.sched.npCallsSched} set={v=>setF("sched.npCallsSched",v)}/><NF label="Same Day NP" val={form.sched.sameDayNP} set={v=>setF("sched.sameDayNP",v)}/>
          <NF label="Same Day Existing" val={form.sched.sameDayExt} set={v=>setF("sched.sameDayExt",v)}/>
        </div>
      </Sect>

      <Sect title="Collections" emoji="💰" open={sec.coll} toggle={()=>tog("coll")} badge={`Goal: ${USD(dailyGoal)}`}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14}}>
          <NF label="Non-Insurance ($)" val={form.coll.nonIns} set={v=>setF("coll.nonIns",v)} pre/><NF label="Insurance ($)" val={form.coll.ins} set={v=>setF("coll.ins",v)} pre/><RF label="Total" val={USD(totalColl)}/><RF label="Rate" val={PCT(totalColl,dailyGoal)} col={N(totalColl)>=dailyGoal?"#16a34a":"#dc2626"}/>
        </div>
      </Sect>

      <Sect title="Insurance Claims" emoji="📋" open={sec.claims} toggle={()=>tog("claims")}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
          <NF label="Procedures Sent" val={form.claims.sent} set={v=>setF("claims.sent",v)}/><NF label="# Submitted" val={form.claims.submitted} set={v=>setF("claims.submitted",v)}/><RF label="Sub Rate" val={PCT(form.claims.submitted,form.claims.sent)}/>
          <NF label="# Rejected" val={form.claims.rejected} set={v=>setF("claims.rejected",v)}/><NF label="# Resolved" val={form.claims.resolved} set={v=>setF("claims.resolved",v)}/><NF label="# Escalations" val={form.claims.escalations} set={v=>setF("claims.escalations",v)}/>
        </div>
      </Sect>

      {officeStaff.length>0&&(
        <Sect title="Front Desk KPIs" emoji="👥" open={sec.fd} toggle={()=>tog("fd")} badge="Per Staff Member">
          {officeStaff.map(name=>{const fd=form.fd[name]||newFD();const s=(field,val)=>setFDF(name,field,val);return(
            <div key={name} style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12,border:"1px solid #e2e8f0"}}>
              <div style={{fontSize:12,fontWeight:800,color:"#1e3a5f",marginBottom:12,paddingBottom:8,borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>{name}{drafts.some(d=>d.staffName===name)&&<span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:99,background:"#dcfce7",color:"#15803d"}}>Draft loaded ✓</span>}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
                <NF label="NP Calls" val={fd.calls} set={v=>s("calls",v)}/><NF label="NP Calls Sched" val={fd.callsSched} set={v=>s("callsSched",v)}/><NF label="Recalls Made" val={fd.recalls} set={v=>s("recalls",v)}/><NF label="From Recalls" val={fd.recallsSched} set={v=>s("recallsSched",v)}/>
                <NF label="NP Tx Presented" val={fd.npTxPres} set={v=>s("npTxPres",v)}/><NF label="NP Tx Accepted" val={fd.npTxAcc} set={v=>s("npTxAcc",v)}/><NF label="Existing Tx Pres" val={fd.exTxPres} set={v=>s("exTxPres",v)}/><NF label="Existing Tx Acc" val={fd.exTxAcc} set={v=>s("exTxAcc",v)}/>
              </div>
            </div>
          );})}
        </Sect>
      )}

      <Sect title="IT Issues & Patient Incidences" emoji="⚠️" open={sec.notes} toggle={()=>tog("notes")}>
        <textarea style={{width:"100%",border:"1px solid #e2e8f0",borderRadius:10,padding:12,fontSize:13,minHeight:120,resize:"vertical",outline:"none",fontFamily:"system-ui",boxSizing:"border-box"}} value={form.notes} onChange={e=>setF("notes",e.target.value)} placeholder="Note any incidences, IT issues, or other important information…"/>
      </Sect>

      <div style={{display:"flex",gap:12,justifyContent:"flex-end",marginTop:8,flexWrap:"wrap"}}>
        {isEditing?<button onClick={onEditDone} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 24px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontWeight:700,fontSize:14,cursor:"pointer"}}><IcoX size={16}/> Cancel</button>:<button onClick={()=>{setForm(blankForm(user));setDrafts([]);setDraftSavedAt(null);setResumeBanner(null);}} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 24px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontWeight:700,fontSize:14,cursor:"pointer"}}><IcoX size={16}/> Reset</button>}
        <button onClick={handleSubmit} disabled={submitting} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 32px",borderRadius:10,background:submitting?"#93c5fd":isEditing?"#d97706":"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:14,cursor:submitting?"not-allowed":"pointer",boxShadow:"0 4px 14px rgba(29,78,216,.25)"}}>
          {isEditing?<IcoEdit size={16}/>:<IcoMail size={16}/>} {submitting?"Saving…":isEditing?"Update Report":"Submit Report"}
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────


export default ManagerFormPage
