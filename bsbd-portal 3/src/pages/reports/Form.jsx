import React, { useState, useEffect, useRef } from 'react'
import { IcoPlus,IcoTrash,IcoEye,IcoEdit,IcoX,IcoCheck,IcoCloud,IcoSave,IcoDL,IcoMail,IcoAlert,IcoChevD,IcoChevU,IcoCalendar,IcoRefresh,IcoUndo,IcoUpload,IcoPrint,IcoBar,IcoPhone,IcoClock,IcoChevR,IcoBell,IcoStar,IcoUsers,IcoSun } from '../../components/icons'
import { LBL,CARD,Sect,NF,RF,PBar,RangeSelector,SortTh,ChartCanvas,TcStatusBadge } from '../../components/ui'
import { N,USD,PCT,pctNum,fmtDate,fmtTime,todayStr,monthStart,rangeStart,last30Start,repGoal,repProd,repColl,downloadCSV,printSection,newProv,newHyg,newFD,blankForm,setPath,lsGet,lsSet,lsDel,draftKey,getTcAlerts,workingDaysInMonth,workingDaysSoFar,tcChecklistPct } from '../../lib/helpers'
import { sbGet,sbPost,sbDel } from '../../lib/supabase'
import { OFFICES,RANGE_LABEL,RANGE_TITLE,TC_STATUSES,TC_STATUS_MAP,TC_PIPELINE,TC_CHECKLIST,TC_PAYMENT_METHODS,TC_FOLLOWUP_TYPES } from '../../lib/constants'

// ── Smart field hint ──────────────────────────────────────────────────────
function FieldHint({ msg, type='info' }) {
  if (!msg) return null
  const cfg = {
    info:    { bg:'#eff6ff', color:'#1d4ed8', icon:'ℹ' },
    warn:    { bg:'#fffbeb', color:'#d97706', icon:'⚠' },
    error:   { bg:'#fef2f2', color:'#dc2626', icon:'✕' },
    success: { bg:'#f0fdf4', color:'#16a34a', icon:'✓' },
  }
  const c = cfg[type] || cfg.info
  return (
    <div style={{fontSize:10,fontWeight:600,color:c.color,background:c.bg,borderRadius:4,padding:'3px 8px',marginTop:3}}>
      {c.icon} {msg}
    </div>
  )
}

// ── Full validation engine ────────────────────────────────────────────────
function validateReport(form) {
  const issues = []
  const s = form.sched || {}
  const c = form.coll  || {}
  const cl= form.claims|| {}

  const N = v => parseFloat(String(v||'').replace(/,/g,''))||0

  const totalPtsSeen   = (form.providers||[]).reduce((sum,p)=>sum+N(p.ptsSeen),0)
                       + (form.hygiene||[]).reduce((sum,h)=>sum+N(h.ptsSeen),0)
  const totalNetProd   = (form.providers||[]).reduce((sum,p)=>sum+N(p.netProd),0)
                       + (form.hygiene||[]).reduce((sum,h)=>sum+N(h.netProd),0)
  const totalSched     = N(s.totalAmt)
  // In-office (patient) + insurance buckets, derived from the 8 payment lines.
  // Falls back to legacy nonIns/ins for older records that predate the split.
  const inOfficeColl   = N(c.cash) + N(c.check) + N(c.creditCard) + N(c.financing) + N(c.eft)
  const insuranceColl  = N(c.insCheck) + N(c.insCreditCard) + N(c.insElectronic)
  const has8Fields     = ['cash','check','creditCard','financing','eft','insCheck','insCreditCard','insElectronic'].some(k => c[k] != null && c[k] !== '')
  const collNonIns     = has8Fields ? inOfficeColl  : N(c.nonIns)
  const collIns        = has8Fields ? insuranceColl : N(c.ins)
  const totalColl      = collNonIns + collIns
  const ptsOnSched     = N(s.ptsOnSched)
  const ptsShowUp      = N(s.ptsShowUp)
  const cancelled      = N(s.cancelled)
  const noShows        = N(s.noShows)
  const rescheduled    = N(s.rescheduled)
  const npOnSched      = N(s.npOnSched)
  const npShowed       = N(s.npShowed)
  const npCalls        = N(s.npCalls)
  const npCallsSched   = N(s.npCallsSched)
  const recalls        = N(s.recalls)
  const recallsSched   = N(s.recallsSched)
  const sent           = N(cl.sent)
  const submitted      = N(cl.submitted)
  const rejected       = N(cl.rejected)
  const resolved       = N(cl.resolved)

  // PATIENTS SEEN vs SHOWED UP
  if (ptsShowUp > 0 && totalPtsSeen > 0 && Math.abs(totalPtsSeen - ptsShowUp) > 1)
    issues.push({ section:'Schedule', severity: totalPtsSeen > ptsShowUp+2 ? 'error' : 'warn',
      msg: `Patients seen (${totalPtsSeen}) doesn't match patients showed up (${ptsShowUp})` })

  // SCHEDULE MATH: showed + cancelled + no shows ≈ on schedule
  if (ptsOnSched > 0 && ptsShowUp > 0) {
    const accounted = ptsShowUp + cancelled + noShows
    if (Math.abs(accounted - ptsOnSched) > 2)
      issues.push({ section:'Schedule', severity:'warn',
        msg: `${ptsShowUp} showed + ${cancelled} cancelled + ${noShows} no-shows = ${accounted}, but schedule shows ${ptsOnSched} patients` })
  }

  // NP CAN'T EXCEED SCHEDULED
  if (npShowed > npOnSched && npOnSched > 0)
    issues.push({ section:'Schedule', severity:'error',
      msg: `New patients showed (${npShowed}) exceeds new patients on schedule (${npOnSched})` })

  // NP CALLS SCHED CAN'T EXCEED CALLS
  if (npCallsSched > npCalls && npCalls > 0)
    issues.push({ section:'Schedule', severity:'error',
      msg: `NP scheduled from calls (${npCallsSched}) can't exceed total NP calls made (${npCalls})` })

  // RECALLS SCHED CAN'T EXCEED RECALLS
  if (recallsSched > recalls && recalls > 0)
    issues.push({ section:'Schedule', severity:'error',
      msg: `Recalls scheduled (${recallsSched}) can't exceed recalls attempted (${recalls})` })

  // HIGH NO-SHOW RATE
  if (ptsOnSched > 0 && noShows > 0) {
    const rate = Math.round((noShows / ptsOnSched) * 100)
    if (rate > 10) issues.push({ section:'Schedule', severity:'warn',
      msg: `No-show rate is ${rate}% (${noShows}/${ptsOnSched}) — above 10% threshold. Were confirmation calls made?` })
  }

  // NP SHOWED BUT NO TX PRESENTED
  if (npShowed > 0) {
    const npTxPres = Object.values(form.fd || {}).reduce((s,fd) => s + N(fd?.npTxPres||0), 0)
    if (npTxPres === 0)
      issues.push({ section:'Front Desk', severity:'warn',
        msg: `${npShowed} new patients seen but no TX presented recorded — was a treatment plan discussed?` })
  }

  // PRODUCTION vs SCHEDULE
  if (totalSched > 0 && totalNetProd > 0) {
    const prodPct = Math.round((totalNetProd / totalSched) * 100)
    if (prodPct < 70) issues.push({ section:'Production', severity:'error',
      msg: `Production is only ${prodPct}% of schedule — add a note explaining the shortfall` })
    else if (prodPct < 90) issues.push({ section:'Production', severity:'warn',
      msg: `Production is ${prodPct}% of schedule — below the 90% goal` })
  }

  // PROVIDER OVER-PRODUCTION (can indicate entry error)
  ;(form.providers||[]).forEach(p => {
    const op = N(p.openSchedule), np = N(p.netProd)
    if (op > 0 && np > op * 1.3)
      issues.push({ section:'Production', severity:'warn',
        msg: `${p.doctorName}: Net production (${op>0?'$'+np.toLocaleString():'—'}) is 30%+ above opening schedule — verify or note same-day adds` })
  })

  // COLLECTIONS RATE
  if (totalNetProd > 0 && totalColl > 0) {
    const collRate = Math.round((totalColl / totalNetProd) * 100)
    if (collRate < 80) issues.push({ section:'Collections', severity:'warn',
      msg: `Collections are ${collRate}% of production — below 80%. Were all patient portions collected?` })
    if (totalColl > totalNetProd * 1.5) issues.push({ section:'Collections', severity:'warn',
      msg: `Collections (${USD(totalColl)}) are significantly above production — verify entry` })
  }

  // CLAIMS
  if (submitted > sent && sent > 0)
    issues.push({ section:'Claims', severity:'error',
      msg: `Claims submitted (${submitted}) can't exceed claims sent (${sent})` })
  if (resolved > rejected && rejected > 0)
    issues.push({ section:'Claims', severity:'error',
      msg: `Claims resolved (${resolved}) can't exceed claims rejected (${rejected})` })
  if (rejected > 0 && resolved === 0)
    issues.push({ section:'Claims', severity:'warn',
      msg: `${rejected} claim${rejected>1?'s':''} rejected — were these addressed today or escalated?` })

  // FRONT DESK TX ACCEPTANCE
  Object.entries(form.fd || {}).forEach(([name, fd]) => {
    const pres = N(fd?.npTxPres||0), acc = N(fd?.npTxAcc||0)
    const ePres = N(fd?.exTxPres||0), eAcc = N(fd?.exTxAcc||0)
    if (acc > pres && pres > 0)
      issues.push({ section:'Front Desk', severity:'error',
        msg: `${name}: NP TX accepted (${acc}) can't exceed TX presented (${pres})` })
    if (eAcc > ePres && ePres > 0)
      issues.push({ section:'Front Desk', severity:'error',
        msg: `${name}: Existing TX accepted (${eAcc}) can't exceed TX presented (${ePres})` })
    if (N(fd?.npCallsSched||0) > N(fd?.calls||0) && N(fd?.calls||0) > 0)
      issues.push({ section:'Front Desk', severity:'error',
        msg: `${name}: NP scheduled (${N(fd?.npCallsSched||0)}) can't exceed calls made (${N(fd?.calls||0)})` })
  })

  // INCOMPLETE SECTIONS
  if (ptsOnSched > 0 && totalPtsSeen === 0)
    issues.push({ section:'Production', severity:'warn',
      msg: 'Patients on schedule but no production entered — is this section complete?' })

  return issues
}


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
// ── Parse deposit slip plain text (from PDF extraction) ───────────────────
function parseDepositSlipText(text) {
  let ins = 0, nonIns = 0;
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);


  
  // Look for insurance and non-insurance totals
  // Common patterns: "Insurance Total: $1,234.56" or "Non-Insurance 456.78"
  for (const line of lines) {
    const lower = line.toLowerCase();
    const amounts = [...line.matchAll(/\$?([\d,]+\.\d{2})/g)].map(m => parseFloat(m[1].replace(/,/g,'')));
    if (!amounts.length) continue;
    const amt = amounts[amounts.length - 1]; // take last amount on line
    if (lower.includes('non-ins') || lower.includes('non ins') || lower.includes('nonins') || lower.includes('patient') || lower.includes('cash') || lower.includes('check')) {
      nonIns += amt;
    } else if (lower.includes('ins') || lower.includes('claim') || lower.includes('eob') || lower.includes('electronic')) {
      ins += amt;
    }
  }
  
  // Fallback: if we couldn't split, look for a grand total
  if (ins === 0 && nonIns === 0) {
    const allAmounts = [...text.matchAll(/\$?([\d,]+\.\d{2})/g)].map(m => parseFloat(m[1].replace(/,/g,'')));
    if (allAmounts.length) nonIns = Math.max(...allAmounts); // use largest amount
  }
  
  return { ins, nonIns, total: ins + nonIns };
}

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

      // Parse deposit slip — CSV, PDF, or Excel
      if (depositFile) {
        let dep = { ins: 0, nonIns: 0, total: 0 };
        const fname = depositFile.name.toLowerCase();
        if (fname.endsWith('.pdf')) {
          // Extract text from PDF and try to parse dollar amounts
          try {
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            const buf  = await depositFile.arrayBuffer();
            const pdf  = await pdfjsLib.getDocument({ data: buf }).promise;
            let text   = '';
            for (let p = 1; p <= pdf.numPages; p++) {
              const page    = await pdf.getPage(p);
              const content = await page.getTextContent();
              text += content.items.map(i => i.str).join(' ') + ' ';

            }
            dep = parseDepositSlipText(text);
          } catch(e) { notify('PDF parse error: ' + e.message, 'error'); }
        } else if (fname.endsWith('.xlsx') || fname.endsWith('.xls')) {
          try {
            const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
            const wb   = XLSX.read(await depositFile.arrayBuffer(), { type: 'array' });
            const ws   = wb.Sheets[wb.SheetNames[0]];
            const text = XLSX.utils.sheet_to_csv(ws);
            dep = parseDepositSlipCSV(text);
          } catch(e) { notify('Excel parse error: ' + e.message, 'error'); }
        } else {
          const csvText = await depositFile.text();
          dep = parseDepositSlipCSV(csvText);
        }
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
                <DropZone label="Drop Deposit Slip (CSV, PDF, or Excel)" accept=".csv,.pdf,.xlsx,.xls" multiple={false} onChange={handleDeposit} files={depositFile?[depositFile]:[]}/>
                <p style={{fontSize:11,color:'#94a3b8',marginTop:6}}>Accepts CSV, PDF, or Excel. In Dentrix Ascend: Reports → Deposit Slip Report → Export CSV for best results.</p>
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
                    {[['In-Office',USD(preview.collections.nonIns),'#1d4ed8'],['Insurance',USD(preview.collections.ins),'#7c3aed'],['Total',USD(preview.collections.total),'#16a34a']].map(([l,v,c])=>(
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

function ManagerFormPage({user,providers,users,officeStaff,reports,upsertReport,notify,editReport,onEditDone}){
  const isEditing=!!editReport;
  const initForm=()=>{if(isEditing){const prov=(editReport.providers||[newProv()]).map(p=>({...p,_id:p._id||Math.random().toString(36)}));const hyg=(editReport.hygiene||[newHyg()]).map(h=>({...h,_id:h._id||Math.random().toString(36)}));return{...editReport,providers:prov,hygiene:hyg};}return blankForm(user);};
  const [form,setForm]              =useState(initForm);
  const [done,setDone]              =useState(false);
  const [submitting,setSubmitting]  =useState(false);
  const [savingDraft,setSavingDraft]=useState(false);
  const [draftSavedAt,setDraftSavedAt]=useState(null);
  const [tmrwColl,setTmrwColl]=useState(null);
  const [schedAmtFromColl,setSchedAmtFromColl]=useState(null);
  const [loadingDrafts,setLoadingDrafts]=useState(false);
  const [staffSubs,   setStaffSubs]   = useState([])
  const [drafts,setDrafts]          =useState([]);
  const [resumeBanner,setResumeBanner]=useState(null);
  const [showImport,setShowImport]=useState(false);
  const [showCollImport,setShowCollImport]=useState(false);
  const [collRecon,setCollRecon]=useState(null); // reconciliation results
  const [sec,setSec]                =useState({prov:true,hyg:true,sched:true,coll:false,claims:false,fd:false,notes:false,nextDay:false,predToday:false});
  const tog=k=>setSec(s=>({...s,[k]:!s[k]}));
  const setF  =(path,val)=>setForm(f=>setPath(f,path,val));
  const setPF =(i,field,val)=>setForm(f=>{
    const a=[...f.providers]; a[i]={...a[i],[field]:val};
    const newSched = {...f.sched};
    if(field==='openSchedule'){
      const autoTotal=a.reduce((s,p)=>s+N(p.openSchedule),0)+f.hygiene.reduce((s,h)=>s+N(h.openSchedule),0);
      const prevAuto=f.providers.reduce((s,p)=>s+N(p.openSchedule),0)+f.hygiene.reduce((s,h)=>s+N(h.openSchedule),0);
      const shouldAuto=f.sched.totalAmt===''||f.sched.totalAmt===undefined||Math.abs(N(f.sched.totalAmt)-prevAuto)<=1;
      if(shouldAuto) newSched.totalAmt=String(autoTotal);
    }
    if(field==='ptsSeen'){
      const autoSeen=a.reduce((s,p)=>s+N(p.ptsSeen),0)+f.hygiene.reduce((s,h)=>s+N(h.ptsSeen),0);
      const prevSeen=f.providers.reduce((s,p)=>s+N(p.ptsSeen),0)+f.hygiene.reduce((s,h)=>s+N(h.ptsSeen),0);
      const shouldAuto=f.sched.ptsShowUp===''||f.sched.ptsShowUp===undefined||N(f.sched.ptsShowUp)===prevSeen;
      if(shouldAuto) newSched.ptsShowUp=String(autoSeen);
    }
    if(field==='npSeen'){
      const autoNP=a.reduce((s,p)=>s+N(p.npSeen),0);
      const prevNP=f.providers.reduce((s,p)=>s+N(p.npSeen),0);
      const shouldAuto=f.sched.npShowed===''||f.sched.npShowed===undefined||N(f.sched.npShowed)===prevNP;
      if(shouldAuto) newSched.npShowed=String(autoNP);
    }
    if(field==='npSched'){
      const autoNPSched=a.reduce((s,p)=>s+N(p.npSched),0);
      const prevNPSched=f.providers.reduce((s,p)=>s+N(p.npSched),0);
      const shouldAuto=f.sched.npOnSched===''||f.sched.npOnSched===undefined||N(f.sched.npOnSched)===prevNPSched;
      if(shouldAuto) newSched.npOnSched=String(autoNPSched);
    }
    return{...f,providers:a,sched:newSched};
  });
  const setHF =(i,field,val)=>setForm(f=>{
    const a=[...f.hygiene]; a[i]={...a[i],[field]:val};
    const newSched = {...f.sched};
    if(field==='openSchedule'){
      const autoTotal=f.providers.reduce((s,p)=>s+N(p.openSchedule),0)+a.reduce((s,h)=>s+N(h.openSchedule),0);
      const prevAuto=f.providers.reduce((s,p)=>s+N(p.openSchedule),0)+f.hygiene.reduce((s,h)=>s+N(h.openSchedule),0);
      const shouldAuto=f.sched.totalAmt===''||f.sched.totalAmt===undefined||Math.abs(N(f.sched.totalAmt)-prevAuto)<=1;
      if(shouldAuto) newSched.totalAmt=String(autoTotal);
    }
    if(field==='ptsSeen'){
      const autoSeen=f.providers.reduce((s,p)=>s+N(p.ptsSeen),0)+a.reduce((s,h)=>s+N(h.ptsSeen),0);
      const prevSeen=f.providers.reduce((s,p)=>s+N(p.ptsSeen),0)+f.hygiene.reduce((s,h)=>s+N(h.ptsSeen),0);
      const shouldAuto=f.sched.ptsShowUp===''||f.sched.ptsShowUp===undefined||N(f.sched.ptsShowUp)===prevSeen;
      if(shouldAuto) newSched.ptsShowUp=String(autoSeen);
    }
    return{...f,hygiene:a,sched:newSched};
  });
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

  // ── Auto-load recall data for today ─────────────────────────────────────
  useEffect(()=>{
    if(isEditing||!form.date||!form.office) return;
    const today = form.date;
    const month = today.slice(0,7);
    sbGet('recall_patients',
      'office=eq.'+encodeURIComponent(form.office)+'&month=eq.'+month+'&select=call1_date,call1_outcome,call2_date,call2_outcome,call3_date,call3_outcome,status,updated_at'
    ).then(rows=>{
      const callsToday = rows.filter(r=>
        r.call1_date===today||r.call2_date===today||r.call3_date===today
      ).length;
      const scheduledToday = rows.filter(r=>
        r.status==='scheduled'&&r.updated_at&&r.updated_at.slice(0,10)===today
      ).length;
      if(callsToday>0){
        setForm(f=>{
          const cur  = String(f.sched.recalls||'');
          const curS = String(f.sched.recallsSched||'');
          const autoRecalls = cur===''||cur==='0'||cur===undefined;
          const autoSched   = curS===''||curS==='0'||curS===undefined;
          if(!autoRecalls&&!autoSched) return f;
          return{...f,sched:{
            ...f.sched,
            recalls:      autoRecalls ? String(callsToday) : cur,
            recallsSched: autoSched   ? String(scheduledToday) : curS,
          }};
        });
      }
    }).catch(()=>{});
  },[form.date, form.office, isEditing]);

  // ── Poll staff_submissions table every 30 seconds ──────────────────────
  useEffect(()=>{
    if(isEditing||!form.date||!form.office) return;
    const load = async () => {
      try {
        const rows = await sbGet('staff_submissions',
          'date=eq.'+form.date+'&office=eq.'+encodeURIComponent(form.office)+'&order=updated_at.desc'
        );
        setStaffSubs(rows.map(r=>({...r.data, _username:r.username, _name:r.staff_name, _role:r.staff_role, _at:r.updated_at})));
      } catch {}
    };
    load();
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  },[form.date, form.office, isEditing]);

  // ── Auto-poll for new staff submissions every 30 seconds ───────────────
  useEffect(()=>{
    if(isEditing||!form.office||!form.date) return;
    // Check if any expected staff have submitted
    const checkNew = async () => {
      try {
        const rows = await sbGet('drafts',
          'date=eq.'+form.date+'&office=eq.'+encodeURIComponent(form.office)+'&order=saved_at.desc'
        );
        const staffRows = rows.filter(r => r.staff_role !== 'manager_draft');
        const newDrafts = staffRows.map(r=>({
          username:r.username, staffName:r.staff_name,
          staffRole:r.staff_role, savedAt:r.saved_at, sectionData:r.data
        }));
        // Only update if count changed
        setDrafts(prev => {
          if(prev.length !== newDrafts.length) return newDrafts;
          return prev;
        });
      } catch {}
    };
    checkNew();
    const interval = setInterval(checkNew, 30000);
    return () => clearInterval(interval);
  },[form.date, form.office, isEditing]);

  // ── Auto-load collections from collection_patients ──────────────────────
  useEffect(()=>{
    if(isEditing||!form.date||!form.office) return;
    sbGet('collection_patients',
      'office=eq.'+encodeURIComponent(form.office)+'&date=eq.'+form.date+'&select=amount_collected,ins_status,total_expected,status'
    ).then(rows=>{
      if(!rows.length) return;
      const collected = rows.filter(r=>N(r.amount_collected)>0);
      const insTotal  = collected.filter(r=>(r.ins_status||'').toUpperCase().includes('ACTIVE')).reduce((s,r)=>s+N(r.amount_collected),0);
      const nonInsTotal = collected.reduce((s,r)=>s+N(r.amount_collected),0) - insTotal;
      setForm(f=>{
        const curNon = String(f.coll?.nonIns||'');
        const curIns = String(f.coll?.ins||'');
        const autoNon = curNon===''||curNon==='0';
        const autoIns = curIns===''||curIns==='0';
        if(!autoNon&&!autoIns) return f;
        return{...f,coll:{
          ...f.coll,
          nonIns: autoNon&&nonInsTotal>0 ? nonInsTotal.toFixed(2) : f.coll?.nonIns,
          ins:    autoIns&&insTotal>0    ? insTotal.toFixed(2)    : f.coll?.ins,
        }};
      });
    }).catch(()=>{});
  },[form.date, form.office, isEditing]);



  // ── Auto-load tomorrow's collection total for next day section ─────────
  // Auto-load today's collection sheet total for Scheduled Amount
  useEffect(()=>{
    if(!form.date||!form.office) return;
    sbGet('collection_patients','office=eq.'+encodeURIComponent(form.office)+'&date=eq.'+form.date+'&select=total_expected')
      .then(rows=>{
        const tot=rows.reduce((s,r)=>s+N(r.total_expected||0),0);
        setSchedAmtFromColl(tot>0?tot:null);
      }).catch(()=>{});
  },[form.date,form.office]);

  useEffect(()=>{
    if(!form.date||!form.office) return;
    const tmrw=new Date(form.date+'T12:00:00'); tmrw.setDate(tmrw.getDate()+1);
    const tmrwStr=tmrw.toISOString().slice(0,10);
    sbGet('collection_patients','office=eq.'+encodeURIComponent(form.office)+'&date=eq.'+tmrwStr+'&select=total_expected,status')
      .then(rows=>{
        const tot=rows.reduce((s,r)=>s+N(r.total_expected||0),0);
        setTmrwColl(tot>0?tot:null);
      }).catch(()=>{});
  },[form.date,form.office]);


  const resumeDraft=()=>{if(!resumeBanner)return;const d=resumeBanner.formData;const prov=(d.providers||[newProv()]).map(p=>({...p,_id:p._id||Math.random().toString(36)}));const hyg=(d.hygiene||[newHyg()]).map(h=>({...h,_id:h._id||Math.random().toString(36)}));setForm({...d,providers:prov,hygiene:hyg});setDraftSavedAt(fmtTime(resumeBanner.savedAt));setResumeBanner(null);notify("Draft resumed ✓");};

  const saveDraft=async(silent=false)=>{
    if(!form.office){if(!silent)notify("Select an office first","error");return;}
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
      // Query ALL non-manager drafts for this date+office
      const rows=await sbGet('drafts',
        'date=eq.'+form.date+'&office=eq.'+encodeURIComponent(form.office)+'&order=saved_at.desc'
      );
      // Filter out manager drafts
      const staffRows = rows.filter(r => r.staff_role !== 'manager_draft');
      if(staffRows.length===0){
        notify("No staff drafts found for "+form.date+" at "+form.office,"error");
        setLoadingDrafts(false);
        return;
      }
      // Show drafts in the UI panel
      setDrafts(staffRows.map(r=>({
        username:    r.username,
        staffName:   r.staff_name,
        staffRole:   r.staff_role,
        savedAt:     r.saved_at,
        sectionData: r.data,
      })));
      // Merge into form
      let f={...form,
        providers: form.providers.map(p=>({...p})),
        hygiene:   form.hygiene.map(h=>({...h})),
        fd:        {...form.fd},
      };
      let merged = 0;
      for(const dr of staffRows){
        const sd = dr.data || {};
        const role = dr.staff_role;
        if(role==="provider"){
          // Match by doctorId first, then by name
          let idx = sd.doctorId ? f.providers.findIndex(p=>p.doctorId===sd.doctorId) : -1;
          if(idx<0 && sd.name) idx = f.providers.findIndex(p=>p.name===sd.name);
          if(idx>=0){ f.providers=f.providers.map((p,i)=>i===idx?{...p,...sd}:p); merged++; }
          else{
            const emptyIdx=f.providers.findIndex(p=>!p.doctorId&&!p.name);
            if(emptyIdx>=0){ f.providers=f.providers.map((p,i)=>i===emptyIdx?{...newProv(),...sd}:p); merged++; }
            else if(f.providers.length<6){ f.providers=[...f.providers,{...newProv(),...sd}]; merged++; }
          }
        } else if(role==="hygienist"){
          let idx = sd.name ? f.hygiene.findIndex(h=>h.name===sd.name) : -1;
          if(idx>=0){ f.hygiene=f.hygiene.map((h,i)=>i===idx?{...h,...sd}:h); merged++; }
          else{
            const emptyIdx=f.hygiene.findIndex(h=>!h.name);
            if(emptyIdx>=0){ f.hygiene=f.hygiene.map((h,i)=>i===emptyIdx?{...newHyg(),...sd}:h); merged++; }
            else if(f.hygiene.length<4){ f.hygiene=[...f.hygiene,{...newHyg(),...sd}]; merged++; }
          }
        } else if(role==="front_desk"||role==="treatment_coordinator"){
          const key = dr.staff_name || dr.username;
          f={...f, fd:{...f.fd, [key]:{...(f.fd[key]||newFD()),...sd}}};
          merged++;
        } else {
          // Unknown role — try to merge whatever data is there
          if(sd.netProd||sd.openingBalance){ // looks like provider data
            const emptyIdx=f.providers.findIndex(p=>!p.doctorId);
            if(emptyIdx>=0){ f.providers=f.providers.map((p,i)=>i===emptyIdx?{...newProv(),...sd}:p); merged++; }
          }
        }
      }
      setForm(f);
      notify(merged+" of "+staffRows.length+" staff section"+(staffRows.length!==1?"s":"")+" loaded ✓");
    }catch(e){
      notify("Load failed: "+e.message,"error");
      console.error("loadDrafts error:",e);
    }
    setLoadingDrafts(false);
  }

  
  const provGoal=form.providers.reduce((s,p)=>{
    // Only count toward goal if provider is actually selected
    if(!p.doctorId) return s;
    const pr=providers.find(x=>x.id===p.doctorId);
    return s+(pr?N(pr.goal):0);
  },0);
  // Only count hygienists who have a name entered
  const hygGoal=form.hygiene.filter(h=>h.name&&h.name.trim()).length*1200;
  const dailyGoal=provGoal+hygGoal;
  const totalProd=form.providers.reduce((s,p)=>s+N(p.netProd),0)+form.hygiene.reduce((s,h)=>s+N(h.netProd),0);
  const totalColl=N(form.coll.nonIns)+N(form.coll.ins);
  const variance=totalProd-dailyGoal;

  const handleSubmit=async()=>{
    if(!form.date||!form.office){notify("Date and Office are required","error");return;}
    setSubmitting(true);
    try{
      // ── Step 1: Fetch all staff submissions for this date+office ──────
      let staffSubs=[]
      try{
        const rows=await sbGet('staff_submissions',
          'date=eq.'+form.date+'&office=eq.'+encodeURIComponent(form.office)+'&order=updated_at.asc'
        )
        staffSubs=rows.map(r=>({...r.data,_name:r.staff_name,_username:r.username,_role:r.staff_role,_at:r.updated_at}))
      }catch(e){console.warn('Could not fetch staff submissions:',e)}

      // ── Step 2: Build fd (per-person) and fd_totals (summed) ───────────
      const fd={...form.fd}
      for(const sub of staffSubs){
        const key=sub._name||sub._username
        fd[key]={calls:sub.calls||'',callsSched:sub.callsSched||'',recalls:sub.recalls||'',recallsSched:sub.recallsSched||'',npTxPres:sub.npTxPres||'',npTxAcc:sub.npTxAcc||'',exTxPres:sub.exTxPres||'',exTxAcc:sub.exTxAcc||'',_fromStaff:true,_submittedAt:sub._at}
      }
      const fd_totals=Object.values(fd).reduce((t,f)=>({
        calls:t.calls+N(f.calls),callsSched:t.callsSched+N(f.callsSched),
        recalls:t.recalls+N(f.recalls),recallsSched:t.recallsSched+N(f.recallsSched),
        npTxPres:t.npTxPres+N(f.npTxPres),npTxAcc:t.npTxAcc+N(f.npTxAcc),
        exTxPres:t.exTxPres+N(f.exTxPres),exTxAcc:t.exTxAcc+N(f.exTxAcc),
      }),{calls:0,callsSched:0,recalls:0,recallsSched:0,npTxPres:0,npTxAcc:0,exTxPres:0,exTxAcc:0})

      // Sum sched fields from staff submissions
      const sfStaff=staffSubs.reduce((t,s)=>({
        compExamsSeen:t.compExamsSeen+N(s.compExamsSeen),ptsPrebooked:t.ptsPrebooked+N(s.ptsPrebooked),
        ptsConfirmed:t.ptsConfirmed+N(s.ptsConfirmed),predGenerated:t.predGenerated+N(s.predGenerated),
        predSubmitted:t.predSubmitted+N(s.predSubmitted),
      }),{compExamsSeen:0,ptsPrebooked:0,ptsConfirmed:0,predGenerated:0,predSubmitted:0})

      // Manager values take priority, fall back to staff totals
      const finalSched={
        ...form.sched,
        compExamsSeen:form.sched.compExamsSeen||String(sfStaff.compExamsSeen)||'',
        ptsPrebooked: form.sched.ptsPrebooked ||String(sfStaff.ptsPrebooked) ||'',
        ptsConfirmed: form.sched.ptsConfirmed ||String(sfStaff.ptsConfirmed) ||'',
        predGenerated:form.sched.predGenerated||String(sfStaff.predGenerated)||'',
        predSubmitted:form.sched.predSubmitted||String(sfStaff.predSubmitted)||'',
      }

      // ── Step 3: Build and save enriched report ─────────────────────────
      const providerGoals=form.providers.map(p=>{const pr=providers.find(x=>x.id===p.doctorId);return pr?.goal||0})
      // Roll the 8 payment lines into nonIns/ins buckets so all downstream
      // reports (repColl etc.) keep working off coll.nonIns + coll.ins.
      // Only recompute when the new fields are actually in use; otherwise keep
      // legacy nonIns/ins so old records aren't zeroed out on edit.
      const cc=form.coll||{}
      const use8=['cash','check','creditCard','financing','eft','insCheck','insCreditCard','insElectronic'].some(k=>cc[k]!=null&&cc[k]!=='')
      const enrichedColl= use8 ? {
        ...cc,
        nonIns: String(N(cc.cash)+N(cc.check)+N(cc.creditCard)+N(cc.financing)+N(cc.eft)),
        ins:    String(N(cc.insCheck)+N(cc.insCreditCard)+N(cc.insElectronic)),
      } : cc
      const enriched={
        ...form,
        id:isEditing?form.id:'r_'+Date.now(),
        submittedAt:isEditing?form.submittedAt:new Date().toISOString(),
        providerGoals,
        providers:form.providers.map(p=>{const pr=providers.find(x=>x.id===p.doctorId);return{...p,doctorName:pr?.name||p.doctorName||""}}),
        fd, fd_totals, sched:finalSched, coll:enrichedColl,
        staff_submissions_count:staffSubs.length,
      }
      await upsertReport(enriched)
      notify(isEditing?"Report updated ✓":`Report submitted ✓ — consolidated ${staffSubs.length} staff submission${staffSubs.length!==1?'s':''}`)
      if(!isEditing) sbDel('drafts','date=eq.'+form.date+'&office=eq.'+encodeURIComponent(form.office)+'&staff_role=eq.manager_draft').catch(()=>{})
    }catch(err){notify('Save failed: '+err.message,'error');console.error('Submit error:',err);setSubmitting(false);return;}
    setSubmitting(false);setDone(true);
    if(isEditing) onEditDone();
  }
  const expectedStaff=users.filter(u=>{
    const sameOffice = (u.office||'').trim().toLowerCase() === (form.office||'').trim().toLowerCase()
    const isStaff = ["provider","hygienist","front_desk","treatment_coordinator"].includes(u.role)
    return sameOffice && isStaff
  });
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
      const b = data.collections.breakdown || {}
      setForm(f=>({...f,coll:{
        ...f.coll,
        cash:          b.cash!=null          ? b.cash.toFixed(2)         : f.coll?.cash||'',
        check:         b.check!=null         ? b.check.toFixed(2)        : f.coll?.check||'',
        creditCard:    b.cc!=null            ? b.cc.toFixed(2)           : f.coll?.creditCard||'',
        financing:     b.financing!=null     ? b.financing.toFixed(2)    : f.coll?.financing||'',
        eft:           b.elecTransfer!=null  ? b.elecTransfer.toFixed(2) : f.coll?.eft||'',
        insCheck:      b.insCheck!=null      ? b.insCheck.toFixed(2)     : f.coll?.insCheck||'',
        insCreditCard: b.insCC!=null         ? b.insCC.toFixed(2)        : f.coll?.insCreditCard||'',
        insElectronic: b.insElec!=null       ? b.insElec.toFixed(2)      : f.coll?.insElectronic||'',
        // keep buckets in sync for any immediate reads
        nonIns: data.collections.nonIns.toFixed(2),
        ins:    data.collections.ins.toFixed(2),
      }}));
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

  const applyCollectionImport=(recon)=>{
    setCollRecon(recon);
    // Sum up expected from collection sheet - only patients with expected > 0
    const totalExpected = recon.filter(r=>r.status!=='skip').reduce((s,r)=>s+r.total_expected,0);
    const totalCollected = recon.filter(r=>r.status!=='skip').reduce((s,r)=>s+r.paid,0);
    const gap = Math.round((totalExpected - totalCollected)*100)/100;
    // Auto-fill collections if we have better data
    if(totalCollected>0){
      setForm(f=>({...f, coll:{...f.coll, nonIns: totalCollected.toFixed(2)}}));
    }
    const notCollected = recon.filter(r=>r.status==='not_collected'||r.status==='short');
    if(notCollected.length>0){
      const names = notCollected.slice(0,3).map(r=>r.name_raw).join(', ');
      const extra = notCollected.length>3?' and '+(notCollected.length-3)+' more':'';
      notify('Collection gap of $'+Math.abs(gap).toFixed(2)+' — '+notCollected.length+' patient(s) not fully collected: '+names+extra,'error');
    } else {
      notify('Collection sheet reconciled ✓ — all patients collected');
    }
    setShowCollImport(false);
  };

  return(
    <div style={{maxWidth:960,margin:"0 auto",padding:"28px 20px 80px"}}>
      {showImport&&<DentrixImportModal providers={providers} formOffice={form.office} formDate={form.date} onApply={applyImport} onClose={()=>setShowImport(false)} notify={notify}/>}
      {showCollImport&&<CollectionImportModal formDate={form.date} formOffice={form.office} onApply={applyCollectionImport} onClose={()=>setShowCollImport(false)} notify={notify}/>}
      <div style={{marginBottom:16,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{flex:1}}>
          {isEditing&&<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}><span style={{fontSize:11,fontWeight:800,padding:"3px 12px",borderRadius:99,background:"#fef3c7",color:"#d97706"}}>✏️ EDITING REPORT</span><span style={{fontSize:12,color:"#94a3b8"}}>{fmtDate(form.date)} · {form.office}</span></div>}
          <h1 style={{fontSize:24,fontWeight:800,color:"#1e293b",margin:0}}>{isEditing?"Edit Report":"Daily Office Report"}</h1>
        </div>
        {!isEditing&&<div style={{display:"flex",gap:8}}>
          <button onClick={()=>setShowImport(true)} style={{display:"flex",alignItems:"center",gap:7,padding:"9px 18px",borderRadius:10,background:"#0d9488",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoUpload size={14}/> Import from Dentrix</button>
          <button onClick={()=>setShowCollImport(true)} style={{display:"flex",alignItems:"center",gap:7,padding:"9px 18px",borderRadius:10,background:"#7c3aed",color:"white",border:"none",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoUpload size={14}/> Collection Sheet</button>
        </div>}
        {isEditing&&<button onClick={onEditDone} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 18px",borderRadius:10,border:"1px solid #e2e8f0",background:"white",color:"#475569",fontWeight:700,fontSize:13,cursor:"pointer"}}><IcoX size={14}/> Cancel</button>}
      </div>

      {/* Collection Reconciliation Warning */}
      {collRecon&&(()=>{
        const gaps = collRecon.filter(r=>r.status==='not_collected'||r.status==='short'||r.status==='uncertain');
        const totalExp = collRecon.filter(r=>r.status!=='skip').reduce((s,r)=>s+r.total_expected,0);
        const totalPaid = collRecon.filter(r=>r.status!=='skip').reduce((s,r)=>s+r.paid,0);
        const totalGap = Math.round((totalExp-totalPaid)*100)/100;
        if(gaps.length===0) return(
          <div style={{background:"#dcfce7",border:"1px solid #bbf7d0",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
            <IcoCheck size={16} style={{color:"#16a34a"}}/>
            <span style={{fontSize:13,fontWeight:700,color:"#15803d"}}>Collection sheet reconciled ✓ — all patients collected in full</span>
            <button onClick={()=>setCollRecon(null)} style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:"#94a3b8"}}><IcoX size={14}/></button>
          </div>
        );
        return(
          <div style={{background:"#fef2f2",border:"1px solid #fecaca",borderRadius:12,marginBottom:16,overflow:"hidden"}}>
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:"1px solid #fecaca"}}>
              <IcoAlert size={16} style={{color:"#dc2626"}}/>
              <span style={{fontSize:13,fontWeight:800,color:"#dc2626",flex:1}}>
                Collection gap of ${Math.abs(totalGap).toFixed(2)} — {gaps.length} patient{gaps.length>1?"s":""} not fully collected
              </span>
              <button onClick={()=>setCollRecon(null)} style={{background:"none",border:"none",cursor:"pointer",color:"#94a3b8"}}><IcoX size={14}/></button>
            </div>
            <div style={{padding:"12px 16px",maxHeight:220,overflowY:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{background:"#fff5f5"}}>
                  {["Patient","Expected","Collected","Gap","Status"].map(h=>(
                    <th key={h} style={{padding:"6px 10px",textAlign:"left",fontWeight:700,color:"#64748b",fontSize:10,letterSpacing:1,borderBottom:"1px solid #fecaca"}}>{h.toUpperCase()}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {gaps.map((r,i)=>(
                    <tr key={i} style={{borderBottom:"1px solid #fef2f2"}}>
                      <td style={{padding:"6px 10px",fontWeight:600,color:"#1e293b"}}>{r.name_raw}</td>
                      <td style={{padding:"6px 10px",color:"#475569"}}>${r.total_expected.toFixed(2)}</td>
                      <td style={{padding:"6px 10px",color:"#475569"}}>${r.paid.toFixed(2)}</td>
                      <td style={{padding:"6px 10px",fontWeight:700,color:r.gap>0?"#dc2626":"#d97706"}}>${Math.abs(r.gap).toFixed(2)}</td>
                      <td style={{padding:"6px 10px"}}>
                        <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:99,
                          background:r.status==="not_collected"?"#fee2e2":r.status==="short"?"#fef3c7":"#f1f5f9",
                          color:r.status==="not_collected"?"#dc2626":r.status==="short"?"#d97706":"#64748b"}}>
                          {r.status==="not_collected"?"NOT COLLECTED":r.status==="short"?"SHORT":r.match_type==="uncertain"?"UNMATCHED":""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
      {/* Draft status banner — always visible when not submitted */}
      {!isEditing&&(
        <div style={{background:'linear-gradient(135deg,#fffbeb,#fef3c7)',border:'2px solid #fde68a',borderRadius:12,padding:'14px 20px',marginBottom:16,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{width:36,height:36,borderRadius:'50%',background:'#d97706',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
              <IcoSave size={18} style={{color:'white'}}/>
            </div>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:'#92400e'}}>Draft — Not Submitted</div>
              <div style={{fontSize:12,color:'#b45309',marginTop:1}}>
                {draftSavedAt ? 'Last saved at ' + draftSavedAt + ' · This report has not been submitted to the manager yet' : 'This report has not been submitted or saved yet'}
              </div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {draftSavedAt&&<span style={{fontSize:11,color:'#16a34a',fontWeight:600,display:'flex',alignItems:'center',gap:4}}><IcoCheck size={12}/> Auto-saves every 30s</span>}
            <button onClick={()=>saveDraft(false)} disabled={savingDraft} style={{display:'flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:9,background:savingDraft?'#fde68a':'#d97706',color:'white',border:'none',fontWeight:700,fontSize:13,cursor:savingDraft?'not-allowed':'pointer'}}>
              <IcoSave size={14}/> {savingDraft?'Saving…':'Save Draft'}
            </button>
          </div>
        </div>
      )}

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


      {/* ── Staff Submissions Panel ──────────────────────────────────── */}
      {!isEditing&&(
        <div style={{background:'white',borderRadius:12,border:'1px solid #e2e8f0',padding:'16px 18px',marginBottom:16}}>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,flexWrap:'wrap',gap:8}}>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:13,fontWeight:800,color:'#1e293b'}}>📥 Staff Submissions</span>
              {staffSubs.length>0&&<span style={{fontSize:11,fontWeight:700,padding:'2px 10px',borderRadius:99,background:'#dbeafe',color:'#1d4ed8'}}>{staffSubs.length} submitted</span>}
            </div>
            <span style={{fontSize:11,color:'#94a3b8'}}>Read-only — will be consolidated on Submit</span>
          </div>

          {staffSubs.length===0?(
            <div style={{textAlign:'center',padding:'20px 0',color:'#94a3b8',fontSize:13}}>
              No staff submissions yet for {form.date} · {form.office||'select an office'}
            </div>
          ):(
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'#f8fafc'}}>
                    {['Name','NP Calls','NP Sched','Recalls','Rec Sched','NP Tx Pres','NP Tx Acc','Ex Tx Pres','Ex Tx Acc','Comp Exams','Booked','Confirmed','Pre-Ds Gen','Pre-Ds Sub','Submitted'].map(h=>(
                      <th key={h} style={{padding:'7px 10px',textAlign:'left',fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:.5,whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffSubs.map((sub,i)=>(
                    <tr key={sub._username} style={{borderTop:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                      <td style={{padding:'8px 10px',fontWeight:700,color:'#1e293b',whiteSpace:'nowrap'}}>{sub._name}</td>
                      {[sub.calls,sub.callsSched,sub.recalls,sub.recallsSched,sub.npTxPres,sub.npTxAcc,sub.exTxPres,sub.exTxAcc,sub.compExamsSeen,sub.ptsPrebooked,sub.ptsConfirmed,sub.predGenerated,sub.predSubmitted].map((v,vi)=>(
                        <td key={vi} style={{padding:'8px 10px',textAlign:'center',color:N(v)>0?'#1e293b':'#cbd5e1',fontWeight:N(v)>0?600:400}}>{N(v)>0?v:'—'}</td>
                      ))}
                      <td style={{padding:'8px 10px',fontSize:10,color:'#94a3b8',whiteSpace:'nowrap'}}>{sub._at?new Date(sub._at).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}):''}</td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  {staffSubs.length>1&&(
                    <tr style={{borderTop:'2px solid #e2e8f0',background:'#f8fafc',fontWeight:800}}>
                      <td style={{padding:'8px 10px',fontSize:11,color:'#64748b'}}>TOTAL</td>
                      {['calls','callsSched','recalls','recallsSched','npTxPres','npTxAcc','exTxPres','exTxAcc','compExamsSeen','ptsPrebooked','ptsConfirmed','predGenerated','predSubmitted'].map(k=>(
                        <td key={k} style={{padding:'8px 10px',textAlign:'center',color:'#1d4ed8',fontSize:12}}>
                          {staffSubs.reduce((s,sub)=>s+N(sub[k]),0)||'—'}
                        </td>
                      ))}
                      <td/>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {staffSubs.some(s=>s.notes)&&(
            <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid #f1f5f9'}}>
              <div style={{fontSize:10,fontWeight:800,color:'#94a3b8',letterSpacing:1,marginBottom:6}}>STAFF NOTES</div>
              {staffSubs.filter(s=>s.notes).map(s=>(
                <div key={s._username} style={{fontSize:12,color:'#475569',marginBottom:4}}>
                  <b>{s._name}:</b> {s.notes}
                </div>
              ))}
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

      <Sect title="Hygiene Production" emoji="🦷" open={sec.hyg} toggle={()=>tog("hyg")} badge={form.hygiene.some(h=>h.name&&h.name.trim()) ? "Goal: $1,200 / hygienist" : ""}>
        {form.hygiene.map((hyg,i)=>(
          <div key={hyg._id} style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12,border:"1px solid #e2e8f0"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}><span style={{fontSize:11,fontWeight:800,color:"#475569",letterSpacing:1}}>HYGIENIST {i+1}</span>{form.hygiene.length>1&&<button onClick={()=>setForm(f=>({...f,hygiene:f.hygiene.filter((_,j)=>j!==i)}))} style={{background:"none",border:"none",cursor:"pointer",color:"#ef4444"}}><IcoTrash size={14}/></button>}</div>
            <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:10}}>
              <div><label style={LBL}>Name</label><input className="ic" value={hyg.name} onChange={e=>setHF(i,"name",e.target.value)} placeholder="Name"/></div>
              <div><label style={LBL}>Opening ($)</label><input type="text" inputMode="numeric" className="ic" value={hyg.openSchedule} onChange={e=>setHF(i,"openSchedule",e.target.value)} placeholder="0"/></div>
              <div><label style={LBL}>Net Prod ($)</label><input type="text" inputMode="numeric" className="ic" value={hyg.netProd} onChange={e=>setHF(i,"netProd",e.target.value)} placeholder="0"/></div>
              <div><label style={LBL}># Pts Seen</label><input type="text" inputMode="numeric" className="ic" value={hyg.ptsSeen} onChange={e=>setHF(i,"ptsSeen",e.target.value)} placeholder="0"/></div>
            </div>
            {(hyg.netProd!==''&&hyg.netProd!==undefined&&hyg.netProd!==null&&hyg.netProd!==0&&String(hyg.netProd)!=='0')&&(
              <div style={{marginTop:8,fontSize:12,fontWeight:700,color:N(hyg.netProd)>=1200?"#16a34a":"#dc2626"}}>{N(hyg.netProd)>=1200?"✓ Goal met":`▼ ${USD(1200-N(hyg.netProd))} below goal`}</div>
            )}
          </div>
        ))}
        {form.hygiene.length<2&&<button onClick={()=>setForm(f=>({...f,hygiene:[...f.hygiene,newHyg()]}))} style={{display:"flex",alignItems:"center",gap:6,padding:"8px 16px",borderRadius:8,border:"1px dashed #cbd5e1",background:"white",color:"#64748b",cursor:"pointer",fontSize:13,fontWeight:600}}><IcoPlus size={14}/> Add Hygienist</button>}
      </Sect>

      <Sect title="Schedule & Patient Flow" emoji="📅" open={sec.sched} toggle={()=>tog("sched")}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
          {(()=>{
            const autoTotal = form.providers.reduce((s,p)=>s+N(p.openSchedule),0) + form.hygiene.reduce((s,h)=>s+N(h.openSchedule),0);
            const manualVal = N(form.sched.totalAmt);
            const hasManual = form.sched.totalAmt !== '' && form.sched.totalAmt !== undefined;
            const mismatch  = hasManual && autoTotal > 0 && Math.abs(manualVal - autoTotal) > 1;
            return(
              <div>
                <label style={{...LBL,fontSize:10}}>TOTAL SCHEDULE ($)</label>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:8,top:'50%',transform:'translateY(-50%)',color:'#94a3b8',fontSize:13,pointerEvents:'none'}}>$</span>
                  <input type="number" min="0"
                    style={{width:'100%',border:`1px solid ${mismatch?'#dc2626':'#cbd5e1'}`,borderRadius:6,padding:'5px 6px 5px 20px',fontSize:11,outline:'none',boxSizing:'border-box',background:mismatch?'#fef2f2':'white'}}
                    value={form.sched.totalAmt}
                    onChange={e=>setF('sched.totalAmt',e.target.value)}
                    placeholder={autoTotal>0?autoTotal.toFixed(0):'0'}
                  />
                </div>
                {autoTotal>0&&!hasManual&&<div style={{fontSize:10,color:'#0d9488',marginTop:2}}>Auto: {USD(autoTotal)} from schedule entries</div>}
                {mismatch&&<div style={{fontSize:10,color:'#dc2626',fontWeight:600,marginTop:2}}>⚠ Manual override — schedule entries total {USD(autoTotal)}</div>}
                {!mismatch&&hasManual&&autoTotal>0&&<div style={{fontSize:10,color:'#16a34a',marginTop:2}}>✓ Matches schedule entries</div>}
              </div>
            );
          })()}<RF label="Daily Goal (auto)" val={USD(dailyGoal)}/><RF label="Variance" val={(form.sched.totalAmt&&N(form.sched.totalAmt)>0)?((N(form.sched.totalAmt)-dailyGoal>=0?"+":"")+USD(N(form.sched.totalAmt)-dailyGoal)):"—"} col={!form.sched.totalAmt||N(form.sched.totalAmt)===0?"#94a3b8":N(form.sched.totalAmt)>=dailyGoal?"#16a34a":"#dc2626"}/>
          {(()=>{
            const sched    = N(form.sched.totalAmt);
            const prod     = form.providers.reduce((s,p)=>s+N(p.netProd),0)+form.hygiene.reduce((s,h)=>s+N(h.netProd),0);
            const goalMet  = prod >= dailyGoal;
            const showRate = sched > 0 ? Math.round((prod/sched)*100) : null;
            if(!prod || prod === 0) return null;
            return(
              <div style={{gridColumn:'1/-1',display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:4}}>

                {/* Metric 1 — Production vs Goal (PRIMARY) */}
                <div style={{background:goalMet?'#f0fdf4':'#fef2f2',borderRadius:10,padding:'12px 16px',border:`2px solid ${goalMet?'#bbf7d0':'#fecaca'}`}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:8}}>PRODUCTION VS GOAL</div>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:goalMet?'#16a34a':'#dc2626',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:800,fontSize:12,flexShrink:0}}>
                      {Math.round((prod/dailyGoal)*100)}%
                    </div>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:goalMet?'#15803d':'#dc2626'}}>
                        {goalMet?'✓ Goal met':'⚠ Below goal'}
                      </div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:1}}>
                        {USD(prod)} of {USD(dailyGoal)} goal
                      </div>
                    </div>
                  </div>
                  <div style={{height:8,background:'#e2e8f0',borderRadius:4,overflow:'hidden',position:'relative'}}>
                    <div style={{height:'100%',borderRadius:4,background:goalMet?'#16a34a':'#dc2626',width:Math.min(Math.round((prod/dailyGoal)*100),100)+'%',transition:'width .4s'}}/>
                  </div>
                  <div style={{fontSize:11,color:goalMet?'#16a34a':'#dc2626',fontWeight:600,marginTop:4}}>
                    {goalMet
                      ? `+${USD(prod-dailyGoal)} above goal`
                      : `${USD(dailyGoal-prod)} short — note reason before submitting`}
                  </div>
                </div>

                {/* Metric 2 — Schedule Show Rate (SECONDARY) */}
                <div style={{background:'#f8fafc',borderRadius:10,padding:'12px 16px',border:'1px solid #e2e8f0'}}>
                  <div style={{fontSize:10,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:8}}>SCHEDULE CAPTURE RATE</div>
                  {showRate !== null ? (
                    <>
                      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
                        <div style={{width:44,height:44,borderRadius:'50%',background:showRate>=90?'#0d9488':showRate>=75?'#d97706':'#dc2626',display:'flex',alignItems:'center',justifyContent:'center',color:'white',fontWeight:800,fontSize:12,flexShrink:0}}>
                          {showRate}%
                        </div>
                        <div>
                          <div style={{fontSize:13,fontWeight:700,color:showRate>=90?'#0d9488':showRate>=75?'#d97706':'#dc2626'}}>
                            {showRate>=90?'✓ Strong capture':showRate>=75?'Moderate capture':'Low capture'}
                          </div>
                          <div style={{fontSize:11,color:'#64748b',marginTop:1}}>
                            {USD(prod)} of {USD(sched)} scheduled
                          </div>
                        </div>
                      </div>
                      <div style={{height:8,background:'#e2e8f0',borderRadius:4,overflow:'hidden'}}>
                        <div style={{height:'100%',borderRadius:4,background:showRate>=90?'#0d9488':showRate>=75?'#d97706':'#dc2626',width:Math.min(showRate,100)+'%',transition:'width .4s'}}/>
                      </div>
                      <div style={{fontSize:11,color:'#64748b',marginTop:4}}>
                        {showRate>=90?'Patients showed and production captured':'Tracks how much of the scheduled amount was produced'}
                      </div>
                    </>
                  ):(
                    <div style={{fontSize:12,color:'#94a3b8',paddingTop:8}}>Enter total schedule above to see capture rate</div>
                  )}
                </div>

              </div>
            );
          })()}
          <div>
              <NF label="# Patients on Schedule" val={form.sched.ptsOnSched} set={v=>setF("sched.ptsOnSched",v)}/>
              {(()=>{
                const on=N(form.sched.ptsOnSched), showed=N(form.sched.ptsShowUp), cancelled=N(form.sched.cancelled), noShows=N(form.sched.noShows);
                const accounted=showed+cancelled+noShows;
                if(on>0&&accounted>0&&Math.abs(accounted-on)>1) return <FieldHint type="warn" msg={`${showed} showed + ${cancelled} cancelled + ${noShows} no-shows = ${accounted} (expected ${on})`}/>;
                if(on>0&&showed>0&&accounted===on) return <FieldHint type="success" msg="Schedule accounts for all patients ✓"/>;
                return null;
              })()}
            </div><div>
              <NF label="# Patients Showed Up" val={form.sched.ptsShowUp} set={v=>setF("sched.ptsShowUp",v)}/>
              {(()=>{
                const showed=N(form.sched.ptsShowUp);
                const totalSeen=(form.providers||[]).reduce((s,p)=>s+N(p.ptsSeen),0)+(form.hygiene||[]).reduce((s,h)=>s+N(h.ptsSeen),0);
                if(showed>0&&totalSeen>0&&Math.abs(totalSeen-showed)>1) return <FieldHint type={totalSeen>showed+2?'error':'warn'} msg={`Provider/hygiene total = ${totalSeen} patients seen (schedule shows ${showed})`}/>;
                if(showed>0&&totalSeen>0&&totalSeen===showed) return <FieldHint type="success" msg="Matches provider/hygiene totals ✓"/>;
                return null;
              })()}
            </div><NF label="# Cancelled" val={form.sched.cancelled} set={v=>setF("sched.cancelled",v)}/>
          <div>
              <NF label="# No Shows" val={form.sched.noShows} set={v=>setF("sched.noShows",v)}/>
              {(()=>{
                const on=N(form.sched.ptsOnSched), ns=N(form.sched.noShows);
                if(on>0&&ns>0){
                  const rate=Math.round(ns/on*100);
                  if(rate>10) return <FieldHint type="warn" msg={`${rate}% no-show rate — above 10% target. Were confirmations sent?`}/>;
                  if(rate<=5) return <FieldHint type="success" msg={`${rate}% no-show rate — within target`}/>;
                }
                return null;
              })()}
            </div><NF label="# Rescheduled" val={form.sched.rescheduled} set={v=>setF("sched.rescheduled",v)}/><div>
              <NF label="# Recalls" val={form.sched.recalls} set={v=>setF("sched.recalls",v)}/>
              <div style={{fontSize:10,color:'#0d9488',marginTop:2,fontWeight:600}}>Auto-filled from today's recall log</div>
              {(()=>{
                const r=N(form.sched.recalls), rs=N(form.sched.recallsSched);
                if(rs>r&&r>0) return <FieldHint type="error" msg={`Recall appts (${rs}) can't exceed recalls attempted (${r})`}/>;
                if(r>0&&rs>0){
                  const rate=Math.round(rs/r*100);
                  if(rate<85) return <FieldHint type="warn" msg={`${rate}% recall conversion — below 85% benchmark`}/>;
                  return <FieldHint type="success" msg={`${rate}% recall conversion`}/>;
                }
                return null;
              })()}
            </div>
          <NF label="# From Recalls" val={form.sched.recallsSched} set={v=>setF("sched.recallsSched",v)}/><div>
              <NF label="# NP on Schedule" val={form.sched.npOnSched} set={v=>setF("sched.npOnSched",v)}/>
              {(()=>{
                const on=N(form.sched.npOnSched), showed=N(form.sched.npShowed);
                if(showed>on&&on>0) return <FieldHint type="error" msg={`NP showed (${showed}) can't exceed NP on schedule (${on})`}/>;
                if(on>0&&showed>0){
                  const rate=Math.round(showed/on*100);
                  if(rate<80) return <FieldHint type="warn" msg={`${rate}% NP show rate — below 80% target`}/>;
                  return <FieldHint type="success" msg={`${rate}% NP show rate`}/>;
                }
                return null;
              })()}
            </div><div>
              <NF label="# NP Showed" val={form.sched.npShowed} set={v=>setF("sched.npShowed",v)}/>
              {(()=>{
                const showed=N(form.sched.npShowed), on=N(form.sched.npOnSched);
                if(showed>on&&on>0) return <FieldHint type="error" msg={`Can't show more NPs than scheduled (${on})`}/>;
                return null;
              })()}
            </div>
          <div>
              <NF label="# NP Phone Calls" val={form.sched.npCalls} set={v=>setF("sched.npCalls",v)}/>
              {(()=>{
                const calls=N(form.sched.npCalls), sched=N(form.sched.npCallsSched);
                if(sched>calls&&calls>0) return <FieldHint type="error" msg={`Scheduled (${sched}) can't exceed calls made (${calls})`}/>;
                if(calls>0&&sched>0) return <FieldHint type="success" msg={`${Math.round(sched/calls*100)}% call-to-schedule rate`}/>;
                return null;
              })()}
            </div><NF label="# NP Sched from Calls" val={form.sched.npCallsSched} set={v=>setF("sched.npCallsSched",v)}/><NF label="Same Day NP" val={form.sched.sameDayNP} set={v=>setF("sched.sameDayNP",v)}/>
          <NF label="Same Day Existing" val={form.sched.sameDayExt} set={v=>setF("sched.sameDayExt",v)}/>
        </div>

        {/* ── Scheduled Amount ── */}
        <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #f1f5f9"}}>
          <div style={{fontSize:10,fontWeight:800,color:"#64748b",letterSpacing:1,marginBottom:10}}>SCHEDULE CAPACITY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:14}}>
            {(()=>{
              const collTotal=N(form.sched?.schedAmt)||0;
              return(
                <div>
                  <label style={{...LBL,fontSize:10}}>SCHEDULED AMOUNT ($)</label>
                  <div style={{position:"relative"}}>
                    <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",fontSize:13,pointerEvents:"none"}}>$</span>
                    <input type="number" min="0"
                      style={{width:"100%",border:"1px solid #cbd5e1",borderRadius:6,padding:"5px 6px 5px 20px",fontSize:11,outline:"none",boxSizing:"border-box"}}
                      value={form.sched?.schedAmt||""}
                      onChange={e=>setF("sched.schedAmt",e.target.value)}
                      placeholder={schedAmtFromColl?("Auto: $"+schedAmtFromColl.toLocaleString()):"Total $ on schedule"}
                    />
                  </div>
                  {schedAmtFromColl&&!form.sched?.schedAmt&&(
                    <div style={{fontSize:10,color:"#0d9488",marginTop:3,fontWeight:600,cursor:"pointer"}} onClick={()=>setF("sched.schedAmt",String(schedAmtFromColl))}>
                      Click to use ${schedAmtFromColl.toLocaleString()} from collection sheet
                    </div>
                  )}
                </div>
              );
            })()}
            <NF label="# Patients Confirmed" val={form.sched?.ptsConfirmed} set={v=>setF("sched.ptsConfirmed",v)}
              hint={form.sched?.ptsOnSched?`of ${form.sched.ptsOnSched} scheduled`:undefined}/>
            <div/>
          </div>
        </div>

        {/* ── Prebooking ── */}
        <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #f1f5f9"}}>
          <div style={{fontSize:10,fontWeight:800,color:"#64748b",letterSpacing:1,marginBottom:10}}>PREBOOKING</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            <NF label="NP + Ext P Comp Exams Seen" val={form.sched?.compExamsSeen} set={v=>setF("sched.compExamsSeen",v)}/>
            <NF label="Patients Booked Next Appt"  val={form.sched?.ptsPrebooked}  set={v=>setF("sched.ptsPrebooked",v)}/>
            {form.sched?.compExamsSeen>0&&(
              <div style={{padding:"10px 0"}}>
                <div style={{fontSize:9,fontWeight:800,color:"#94a3b8",letterSpacing:.5,marginBottom:4}}>PREBOOK RATE</div>
                <div style={{fontSize:18,fontWeight:800,color:N(form.sched?.ptsPrebooked)/N(form.sched?.compExamsSeen)>=0.95?"#16a34a":"#dc2626"}}>
                  {Math.round(N(form.sched?.ptsPrebooked)/N(form.sched?.compExamsSeen)*100)}%
                  <span style={{fontSize:10,color:"#94a3b8",fontWeight:400,marginLeft:4}}>KPI &gt;95%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Recare / Hygiene ── */}
        <div style={{marginTop:14,paddingTop:14,borderTop:"1px solid #f1f5f9"}}>
          <div style={{fontSize:10,fontWeight:800,color:"#64748b",letterSpacing:1,marginBottom:10}}>RECARE / HYGIENE</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
            <NF label="Hygiene Pts on Schedule"    val={form.sched?.hygPtsOnSched} set={v=>setF("sched.hygPtsOnSched",v)}/>
            <NF label="Hygiene Pts Seen"           val={form.sched?.hygPtsSeen}    set={v=>setF("sched.hygPtsSeen",v)}/>
            {form.sched?.hygPtsOnSched>0&&(
              <div style={{padding:"10px 0"}}>
                <div style={{fontSize:9,fontWeight:800,color:"#94a3b8",letterSpacing:.5,marginBottom:4}}>HYG NO-SHOW RATE</div>
                <div style={{fontSize:18,fontWeight:800,color:(1-N(form.sched?.hygPtsSeen)/N(form.sched?.hygPtsOnSched))*100<=8?"#16a34a":"#dc2626"}}>
                  {Math.round((1-N(form.sched?.hygPtsSeen)/N(form.sched?.hygPtsOnSched))*100)}%
                  <span style={{fontSize:10,color:"#94a3b8",fontWeight:400,marginLeft:4}}>KPI &lt;8%</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </Sect>

      <Sect title="Collections" emoji="💰" open={sec.coll} toggle={()=>tog("coll")} badge={`Goal: ${USD(dailyGoal)}`}>
        {(() => {
          const c = form.coll || {}
          // In-office (patient) payments
          const cash      = N(c.cash)
          const check     = N(c.check)
          const cc        = N(c.creditCard)
          const financing = N(c.financing)
          const eft       = N(c.eft)
          // Insurance payments
          const insCheck  = N(c.insCheck)
          const insCC     = N(c.insCreditCard)
          const insElec   = N(c.insElectronic)
          const inOffice  = cash + check + cc + financing + eft
          const insurance = insCheck + insCC + insElec
          const total     = inOffice + insurance
          return (
            <div>
              {/* In-office payments */}
              <div style={{fontSize:11,fontWeight:800,color:'#1d4ed8',letterSpacing:.5,marginBottom:8}}>IN-OFFICE (PATIENT) PAYMENTS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:14,marginBottom:16}}>
                <NF label="Cash ($)"            val={c.cash}       set={v=>setF("coll.cash",v)} pre/>
                <NF label="Check ($)"           val={c.check}      set={v=>setF("coll.check",v)} pre/>
                <NF label="Credit Card ($)"     val={c.creditCard} set={v=>setF("coll.creditCard",v)} pre/>
                <NF label="Patient Financing ($)" val={c.financing} set={v=>setF("coll.financing",v)} pre/>
                <NF label="Electronic Transfer ($)" val={c.eft}    set={v=>setF("coll.eft",v)} pre/>
              </div>
              {/* Insurance payments */}
              <div style={{fontSize:11,fontWeight:800,color:'#7c3aed',letterSpacing:.5,marginBottom:8}}>INSURANCE PAYMENTS</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:14,marginBottom:16}}>
                <NF label="Insurance Check ($)"       val={c.insCheck}      set={v=>setF("coll.insCheck",v)} pre/>
                <NF label="Insurance Credit Card ($)" val={c.insCreditCard} set={v=>setF("coll.insCreditCard",v)} pre/>
                <NF label="Insurance Electronic ($)"  val={c.insElectronic} set={v=>setF("coll.insElectronic",v)} pre/>
                <div/><div/>
              </div>
              {/* Auto-rolled buckets */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:14,paddingTop:14,borderTop:'1px solid #f1f5f9'}}>
                <RF label="In-Office Total"  val={USD(inOffice)}  col="#1d4ed8"/>
                <RF label="Insurance Total"  val={USD(insurance)} col="#7c3aed"/>
                <RF label="Total Collected"  val={USD(total)}     col="#16a34a"/>
                <RF label="Rate (vs Goal)"   val={PCT(total,dailyGoal)} col={total>=dailyGoal?"#16a34a":"#dc2626"}/>
              </div>
            </div>
          )
        })()}
      </Sect>

      <Sect title="Insurance Claims" emoji="📋" open={sec.claims} toggle={()=>tog("claims")}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>
          <div>
              <NF label="Procedures Sent" val={form.claims.sent} set={v=>{
                setF("claims.sent",v);
                // Auto-fill submitted if empty or previously matched sent
                setForm(f=>{
                  const cur=f.claims.submitted;
                  const shouldAuto=cur===''||cur===undefined||cur===f.claims.sent;
                  return shouldAuto?{...f,claims:{...f.claims,sent:v,submitted:v}}:{...f,claims:{...f.claims,sent:v}};
                });
              }}/>
            </div><div>
              <NF label="# Submitted" val={form.claims.submitted} set={v=>setF("claims.submitted",v)}/>
              {N(form.claims.submitted)>N(form.claims.sent)&&N(form.claims.sent)>0&&<FieldHint type="error" msg={`Submitted (${N(form.claims.submitted)}) can't exceed sent (${N(form.claims.sent)})`}/>}
            </div><RF label="Sub Rate" val={PCT(form.claims.submitted,form.claims.sent)}/>
          <div>
              <NF label="# Rejected" val={form.claims.rejected} set={v=>setF("claims.rejected",v)}/>
              {N(form.claims.rejected)>0&&N(form.claims.resolved)===0&&<FieldHint type="warn" msg="Claims rejected but none resolved — were these addressed today?"/>}
              {(()=>{const sent=N(form.claims.sent),rej=N(form.claims.rejected);if(sent>0&&rej>0){const rate=Math.round(rej/sent*100);if(rate>5)return<FieldHint type="warn" msg={`${rate}% rejection rate — above 5% threshold`}/>;}return null;})()}
            </div><div>
              <NF label="# Resolved" val={form.claims.resolved} set={v=>setF("claims.resolved",v)}/>
              {N(form.claims.resolved)>N(form.claims.rejected)&&N(form.claims.rejected)>0&&<FieldHint type="error" msg={`Resolved (${N(form.claims.resolved)}) can't exceed rejected (${N(form.claims.rejected)})`}/>}
            </div><NF label="# Escalations" val={form.claims.escalations} set={v=>setF("claims.escalations",v)}/>
        </div>
      </Sect>

      {officeStaff.length>0&&(
        <Sect title="Front Desk KPIs" emoji="👥" open={sec.fd} toggle={()=>tog("fd")} badge="Per Staff Member">
          {officeStaff.map(name=>{const fd=form.fd[name]||newFD();const s=(field,val)=>setFDF(name,field,val);return(
            <div key={name} style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:12,border:"1px solid #e2e8f0"}}>
              <div style={{fontSize:12,fontWeight:800,color:"#1e3a5f",marginBottom:12,paddingBottom:8,borderBottom:"1px solid #e2e8f0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>{name}{drafts.some(d=>d.staffName===name)&&<span style={{fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:99,background:"#dcfce7",color:"#15803d"}}>Draft loaded ✓</span>}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10}}>
                <NF label="NP Calls" val={fd.calls} set={v=>s("calls",v)}/><div>
                  <NF label="NP Calls Sched" val={fd.callsSched} set={v=>s("callsSched",v)}/>
                  {N(fd.calls)>0&&<div style={{fontSize:10,fontWeight:700,marginTop:3,color:Math.round(N(fd.callsSched)/N(fd.calls)*100)>=50?'#16a34a':'#d97706'}}>{Math.round(N(fd.callsSched)/N(fd.calls)*100)}% call conversion {Math.round(N(fd.callsSched)/N(fd.calls)*100)>=50?'✓':'— below 50%'}</div>}
                </div><NF label="Recalls Made" val={fd.recalls} set={v=>s("recalls",v)}/><div>
                  <NF label="From Recalls" val={fd.recallsSched} set={v=>s("recallsSched",v)}/>
                  {N(fd.recalls)>0&&<div style={{fontSize:10,fontWeight:700,marginTop:3,color:Math.round(N(fd.recallsSched)/N(fd.recalls)*100)>=85?'#16a34a':'#d97706'}}>{Math.round(N(fd.recallsSched)/N(fd.recalls)*100)}% recall conversion {Math.round(N(fd.recallsSched)/N(fd.recalls)*100)>=85?'✓':'— below 85%'}</div>}
                </div>
                <NF label="NP Tx Presented" val={fd.npTxPres} set={v=>s("npTxPres",v)}/>
                <div>
                  <NF label="NP Tx Accepted" val={fd.npTxAcc} set={v=>s("npTxAcc",v)}/>
                  {N(fd.npTxPres)>0&&<div style={{fontSize:10,fontWeight:700,marginTop:3,color:Math.round(N(fd.npTxAcc)/N(fd.npTxPres)*100)>=60?'#16a34a':'#d97706'}}>{Math.round(N(fd.npTxAcc)/N(fd.npTxPres)*100)}% acceptance {Math.round(N(fd.npTxAcc)/N(fd.npTxPres)*100)>=60?'✓':'— below 60% target'}</div>}
                </div>
                <NF label="Existing Tx Pres" val={fd.exTxPres} set={v=>s("exTxPres",v)}/>
                <div>
                  <NF label="Existing Tx Acc" val={fd.exTxAcc} set={v=>s("exTxAcc",v)}/>
                  {N(fd.exTxPres)>0&&<div style={{fontSize:10,fontWeight:700,marginTop:3,color:Math.round(N(fd.exTxAcc)/N(fd.exTxPres)*100)>=60?'#16a34a':'#d97706'}}>{Math.round(N(fd.exTxAcc)/N(fd.exTxPres)*100)}% acceptance {Math.round(N(fd.exTxAcc)/N(fd.exTxPres)*100)>=60?'✓':'— below 60% target'}</div>}
                </div>
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
        {/* ── NEXT DAY SCHEDULE ──────────────────────────────────────── */}
        <Sect title="Next Day Schedule" emoji="📅" open={sec.nextDay} toggle={()=>tog('nextDay')}>
          <div style={{background:'#eff6ff',borderRadius:10,padding:'10px 14px',marginBottom:14,fontSize:12,color:'#1d4ed8',fontWeight:600}}>
            ℹ Fill this out before 5pm — it pre-populates tomorrow's morning huddle
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:14}}>
            <NF label="Patients on Schedule" val={form.nextDay?.ptsOnSched} set={v=>setF('nextDay.ptsOnSched',v)}/>
            <NF label="New Patients Expected" val={form.nextDay?.npExpected} set={v=>setF('nextDay.npExpected',v)}/>
            <NF label="Gross Production Est." val={form.nextDay?.grossProd} set={v=>setF('nextDay.grossProd',v)} pre/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:14,marginBottom:14}}>
            <NF label="Net Production Est." val={form.nextDay?.netProd} set={v=>setF('nextDay.netProd',v)} pre/>
            <div>
              <label style={{...LBL,fontSize:10}}>POTENTIAL COLLECTIONS</label>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",color:"#94a3b8",fontSize:13,pointerEvents:"none"}}>$</span>
                <input type="number" min="0"
                  style={{width:"100%",border:"1px solid #cbd5e1",borderRadius:6,padding:"5px 6px 5px 20px",fontSize:11,outline:"none",boxSizing:"border-box"}}
                  value={form.nextDay?.potentialCollections||''}
                  onChange={e=>setF('nextDay.potentialCollections',e.target.value)}
                  placeholder={tmrwColl?'Auto: $'+tmrwColl.toLocaleString():'Enter manually'}
                />
              </div>
              {tmrwColl&&!form.nextDay?.potentialCollections&&(
                <div style={{fontSize:10,color:"#0d9488",marginTop:3,fontWeight:600,cursor:"pointer"}} onClick={()=>setF('nextDay.potentialCollections',String(tmrwColl))}>
                  Click to use ${tmrwColl.toLocaleString()} from tomorrow sheet
                </div>
              )}
            </div>
            <div>
              <label style={{...LBL,fontSize:10}}>NOTES</label>
              <input className="ic" value={form.nextDay?.notes||''} onChange={e=>setF('nextDay.notes',e.target.value)} placeholder="Any schedule notes for tomorrow…"/>
            </div>
          </div>
          {/* NP carry-over check */}
          {(()=>{
            // Check previous report's nextDay.npExpected vs today's actual npShowed
            const prevNpExp = form._prevNextDayNpExpected;
            const todayNp   = N(form.sched?.npShowed);
            if(!prevNpExp||!todayNp) return null;
            const diff = todayNp - N(prevNpExp);
            if(Math.abs(diff) <= 1) return(
              <div style={{background:'#f0fdf4',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#16a34a',fontWeight:600}}>
                ✓ NP carry-over matched — {todayNp} NPs showed vs {prevNpExp} expected
              </div>
            );
            return(
              <div style={{background:'#fef2f2',borderRadius:8,padding:'10px 14px',fontSize:12,color:'#dc2626',fontWeight:600}}>
                ⚠ NP carry-over mismatch — {todayNp} NPs showed vs {prevNpExp} expected yesterday ({diff>0?'+':''}{diff})
                <div style={{fontSize:11,color:'#b91c1c',marginTop:3}}>Add a note explaining the difference before submitting</div>
              </div>
            );
          })()}
        </Sect>

        {/* ── PREDETERMINATIONS ─────────────────────────────────────────── */}
        <Sect title="Predeterminations Today" emoji="📋" open={sec.predToday} toggle={()=>tog('predToday')}>
          <div style={{fontSize:12,color:'#94a3b8',marginBottom:14}}>Record pre-d activity for today — submissions, responses received, and decisions</div>
          {(form.predToday||[]).map((item,i)=>(
            <div key={i} style={{background:'#f8fafc',borderRadius:10,padding:'12px 14px',marginBottom:10,border:'1px solid #e2e8f0',position:'relative'}}>
              <button onClick={()=>setF('predToday',(form.predToday||[]).filter((_,j)=>j!==i))} style={{position:'absolute',top:8,right:8,background:'none',border:'none',cursor:'pointer',color:'#94a3b8',fontSize:16}}>×</button>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:8}}>
                <div><label style={LBL}>Patient Name</label><input className="ic" value={item.patient||''} onChange={e=>setF('predToday',(form.predToday||[]).map((it,j)=>j===i?{...it,patient:e.target.value}:it))}/></div>
                <div><label style={LBL}>TX Plan</label><input className="ic" value={item.tx_plan||''} onChange={e=>setF('predToday',(form.predToday||[]).map((it,j)=>j===i?{...it,tx_plan:e.target.value}:it))} placeholder="Treatment plan…"/></div>
                <div><label style={LBL}>Carrier</label><input className="ic" value={item.carrier||''} onChange={e=>setF('predToday',(form.predToday||[]).map((it,j)=>j===i?{...it,carrier:e.target.value}:it))} placeholder="Insurance carrier…"/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                {[['pred_sent','Pre-D Sent'],['pred_received','Response Received'],['approved','Approved'],['denied','Denied'],['resubmitted','Resubmitted']].map(([k,l])=>(
                  <label key={k} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,fontWeight:600,color:item[k]?'#1d4ed8':'#64748b'}}>
                    <input type="checkbox" checked={!!item[k]} onChange={e=>setF('predToday',(form.predToday||[]).map((it,j)=>j===i?{...it,[k]:e.target.checked}:it))} style={{width:14,height:14}}/>{l}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <button onClick={()=>setF('predToday',[...(form.predToday||[]),{patient:'',tx_plan:'',carrier:'',pred_sent:false,pred_received:false,approved:false,denied:false,resubmitted:false}])}
            style={{display:'flex',alignItems:'center',gap:6,padding:'8px 16px',borderRadius:8,background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe',fontWeight:700,fontSize:12,cursor:'pointer'}}>
            + Add Predetermination Activity
          </button>
        </Sect>

        {/* Pre-submit validation panel */}
        {(()=>{
          const issues = validateReport(form);
          const errors  = issues.filter(i=>i.severity==='error');
          const warnings= issues.filter(i=>i.severity==='warn');
          if(issues.length===0) return(
            <div style={{background:'#f0fdf4',border:'1px solid #bbf7d0',borderRadius:12,padding:'14px 18px',marginBottom:16,display:'flex',alignItems:'center',gap:10}}>
              <span style={{fontSize:20}}>✓</span>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:'#15803d'}}>Report looks good — ready to submit</div>
                <div style={{fontSize:12,color:'#16a34a',marginTop:1}}>All fields validated, no issues found</div>
              </div>
            </div>
          );
          return(
            <div style={{background:errors.length?'#fef2f2':'#fffbeb',border:`1px solid ${errors.length?'#fecaca':'#fde68a'}`,borderRadius:12,padding:'16px 18px',marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
                <span style={{fontSize:18}}>{errors.length?'⚠':'ℹ'}</span>
                <div style={{fontSize:14,fontWeight:700,color:errors.length?'#dc2626':'#d97706'}}>
                  {errors.length?`${errors.length} issue${errors.length>1?'s':''} need attention before submitting`:`${warnings.length} warning${warnings.length>1?'s':''} to review`}
                </div>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {errors.map((iss,i)=>(
                  <div key={i} style={{display:'flex',gap:8,padding:'8px 12px',background:'#fee2e2',borderRadius:8,alignItems:'flex-start'}}>
                    <span style={{fontSize:12,fontWeight:800,color:'#dc2626',flexShrink:0,marginTop:1}}>✕ {iss.section}</span>
                    <span style={{fontSize:12,color:'#7f1d1d'}}>{iss.msg}</span>
                  </div>
                ))}
                {warnings.map((iss,i)=>(
                  <div key={i} style={{display:'flex',gap:8,padding:'8px 12px',background:'#fef3c7',borderRadius:8,alignItems:'flex-start'}}>
                    <span style={{fontSize:12,fontWeight:800,color:'#d97706',flexShrink:0,marginTop:1}}>⚠ {iss.section}</span>
                    <span style={{fontSize:12,color:'#78350f'}}>{iss.msg}</span>
                  </div>
                ))}
              </div>
              {errors.length===0&&<div style={{fontSize:11,color:'#92400e',marginTop:10,fontStyle:'italic'}}>Warnings don't block submission — review and proceed if correct</div>}
            </div>
          );
        })()}

                <button onClick={handleSubmit} disabled={submitting} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 32px",borderRadius:10,background:submitting?"#93c5fd":isEditing?"#d97706":"#1d4ed8",color:"white",border:"none",fontWeight:700,fontSize:14,cursor:submitting?"not-allowed":"pointer",boxShadow:"0 4px 14px rgba(29,78,216,.25)"}}>
          {isEditing?<IcoEdit size={16}/>:<IcoMail size={16}/>} {submitting?"Saving…":isEditing?"Update Report":"Submit Report"}
        </button>
      </div>
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────────────



// ── Collection Sheet Reconciliation Modal ─────────────────────────────────
function normalizePatientName(raw) {
  if (!raw) return '';
  let name = String(raw).replace(/\n/g,' ').replace(/\t/g,' ').trim();
  name = name.replace(/\([^)]+\)/g,'').trim(); // remove (nickname)
  name = name.replace(/[^A-Za-z\s\-\']/g,'');  // letters only
  return name.split(/\s+/).join(' ').toUpperCase();
}
function patientLastName(norm) {
  const parts = norm.split(' ');
  return parts[parts.length-1] || '';
}
function fuzzyMatchPatient(name, paymentMap) {
  if (paymentMap[name]) return [name, 'exact'];
  const ln = patientLastName(name);
  const candidates = Object.keys(paymentMap).filter(n => patientLastName(n) === ln);
  if (candidates.length === 1) return [candidates[0], 'partial'];
  if (candidates.length > 1)  return [candidates[0], 'uncertain'];
  return [null, 'unmatched'];
}

function parseCollectionSheetXLSX(data) {
  // data is array of arrays (rows) from SheetJS
  if (!data || data.length < 2) return [];
  
  // Detect format: newer sheets have 'PG' in col 1
  const hasPG = data.slice(0, 10).some(row => String(row[1] || '').trim() === 'PG');
  const nameCol  = hasPG ? 2 : 1;
  const treatCol = hasPG ? 4 : 3;
  const tcCol    = hasPG ? 11 : 11;

  const patients = [];
  let current = null;

  for (const row of data) {
    const nameVal  = row[nameCol] != null ? String(row[nameCol]) : null;
    const treatVal = row[treatCol] != null ? String(row[treatCol]) : '';
    const tcVal    = row[tcCol];

    const isBalanceRow = /Balance B\/[fF]/.test(treatVal) && nameVal != null;

    if (isBalanceRow) {
      if (current) patients.push(current);
      const norm = normalizePatientName(nameVal);
      if (norm && norm !== 'NAME' && norm.length > 2) {
        const tc = typeof tcVal === 'number' ? tcVal : 0;
        current = { name_raw: nameVal.trim(), name: norm, last: patientLastName(norm), total_expected: tc };
      }
    } else if (current && typeof tcVal === 'number') {
      current.total_expected = tcVal;
    }
  }
  if (current) patients.push(current);
  return patients;
}

function parseDepositCSVForReconciliation(csvText) {
  const payments = {};
  const lines = csvText.split('\n');
  let inPatient = false;
  
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^(Cash|Check|Credit Card|Patient Financing|Electronic Transfer) Payments/.test(line)) {
      inPatient = true; continue;
    }
    if (/^Insurance|^,,/.test(line)) { inPatient = false; continue; }
    if (!inPatient) continue;
    
    const parts = line.split(',').map(p => p.trim().replace(/\u200b/g,'').replace(/\xef\xbb\xbf/g,''));
    if (parts.length >= 3) {
      const datePart = parts[0].replace(/[^0-9\/]/g,'');
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(datePart)) {
        const name = normalizePatientName(parts[1]);
        const amt  = parseFloat(parts[parts.length-1]) || 0;
        if (name && amt > 0) payments[name] = (payments[name]||0) + amt;
      }
    }
  }
  return payments;
}

function reconcileCollections(sheetData, depositCSV) {
  const patients = parseCollectionSheetXLSX(sheetData);
  const payments = parseDepositCSVForReconciliation(depositCSV);
  
  return patients.map(p => {
    if (p.total_expected <= 0) return { ...p, paid:0, gap:0, status:'skip', match_type:'zero_expected' };
    const [matchName, matchType] = fuzzyMatchPatient(p.name, payments);
    const paid = matchName ? (payments[matchName]||0) : 0;
    const gap  = Math.round((p.total_expected - paid)*100)/100;
    const status = matchType === 'unmatched' ? 'not_collected'
                 : Math.abs(gap) < 0.01     ? 'collected'
                 : gap > 0                  ? 'short' : 'overpaid';
    return { ...p, paid, match_name: matchName, match_type: matchType, gap, status };
  });
}

function CollectionImportModal({ formDate, formOffice, onApply, onClose, notify }) {
  const [collFile,    setCollFile]    = useState(null);
  const [depositFile, setDepositFile] = useState(null);
  const [sheetNames,  setSheetNames]  = useState([]);
  const [selSheet,    setSelSheet]    = useState('');
  const [parsing,     setParsing]     = useState(false);
  const [preview,     setPreview]     = useState(null);
  const [error,       setError]       = useState('');
  const workbookRef = React.useRef(null);

  const handleCollFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setCollFile(file);
    setSheetNames([]);
    setSelSheet('');
    setPreview(null);
    setError('');
    
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs');
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      workbookRef.current = { XLSX, wb };
      const names = wb.SheetNames;
      setSheetNames(names);
      
      // Auto-select sheet matching formDate
      if (formDate) {
        const d = new Date(formDate + 'T12:00:00');
        const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][d.getDay()];
        const month   = ['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()];
        const day     = d.getDate();
        const year    = d.getFullYear();
        const match   = names.find(n => n.includes(dayName) && n.includes(month) && n.includes(String(day)));
        if (match) setSelSheet(match);
        else setSelSheet(names[0] || '');
      } else {
        setSelSheet(names[0] || '');
      }
    } catch(err) {
      setError('Could not read Excel file: ' + err.message);
    }
  };

  const handleDepositFile = (e) => {
    setDepositFile(e.target.files[0]);
    setPreview(null);
  };

  const parse = async () => {
    if (!collFile || !selSheet) { setError('Upload the collection sheet and select a date tab.'); return; }
    if (!depositFile)           { setError('Upload the deposit slip CSV.'); return; }
    setParsing(true);
    setError('');
    try {
      const { XLSX, wb } = workbookRef.current;
      const ws   = wb.Sheets[selSheet];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      
      const depositText = await depositFile.text();
      const results     = reconcileCollections(data, depositText);
      setPreview(results);
    } catch(err) {
      setError('Parse error: ' + err.message);
    }
    setParsing(false);
  };

  const statusColor = s => ({ collected:'#16a34a', short:'#d97706', not_collected:'#dc2626', uncertain:'#9333ea', overpaid:'#0d9488', skip:'#94a3b8' })[s] || '#94a3b8';
  const statusBg    = s => ({ collected:'#dcfce7', short:'#fef3c7', not_collected:'#fee2e2', uncertain:'#f5f3ff', overpaid:'#f0fdfa', skip:'#f1f5f9' })[s] || '#f1f5f9';
  const statusLabel = s => ({ collected:'✓ COLLECTED', short:'SHORT', not_collected:'NOT COLLECTED', uncertain:'UNMATCHED', overpaid:'OVERPAID', skip:'$0 OWED' })[s] || s;

  const actionNeeded = preview ? preview.filter(r => r.status === 'not_collected' || r.status === 'short' || r.status === 'uncertain') : [];
  const totalExp     = preview ? preview.filter(r=>r.status!=='skip').reduce((s,r)=>s+r.total_expected,0) : 0;
  const totalPaid    = preview ? preview.filter(r=>r.status!=='skip').reduce((s,r)=>s+r.paid,0) : 0;
  const totalGap     = Math.round((totalExp - totalPaid)*100)/100;

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div style={{background:'white',borderRadius:16,width:'100%',maxWidth:700,maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 60px rgba(0,0,0,.3)'}}>

        {/* Header */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'20px 24px',borderBottom:'1px solid #e2e8f0'}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:800,color:'#1e293b',margin:0}}>Collection Sheet Reconciliation</h2>
            <p style={{fontSize:12,color:'#94a3b8',marginTop:3}}>Upload the Ridgeview collection sheet + today's deposit slip to check collections</p>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',cursor:'pointer',color:'#94a3b8'}}><IcoX size={20}/></button>
        </div>

        <div style={{padding:'20px 24px'}}>
          {!preview ? (
            <div style={{display:'flex',flexDirection:'column',gap:16}}>

              {/* Collection sheet upload */}
              <div>
                <div style={{fontSize:11,fontWeight:800,color:'#7c3aed',letterSpacing:1,marginBottom:8}}>1. RIDGEVIEW COLLECTION SHEET (EXCEL)</div>
                <label style={{display:'block',border:'2px dashed #e2e8f0',borderRadius:12,padding:'20px',textAlign:'center',cursor:'pointer',background:'#f8fafc'}}
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#7c3aed';}}
                  onDragLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';}}
                  onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#e2e8f0';const f=e.dataTransfer.files[0];if(f)handleCollFile({target:{files:[f]}});}}>
                  <input type="file" accept=".xlsx,.xls,.pdf" onChange={handleCollFile} style={{display:'none'}}/>
                  <IcoUpload size={24} style={{color:'#7c3aed',margin:'0 auto 8px'}}/>
                  <div style={{fontSize:13,fontWeight:700,color:'#1e293b',marginBottom:3}}>Drop collection sheet here</div>
                  {collFile
                    ? <div style={{fontSize:12,color:'#7c3aed',fontWeight:600}}>{collFile.name}</div>
                    : <div style={{fontSize:11,color:'#94a3b8'}}>Accepts .xlsx files from Ridgeview Dental Support Services</div>}
                </label>
              </div>

              {/* Sheet selector */}
              {sheetNames.length > 0 && (
                <div>
                  <div style={{fontSize:11,fontWeight:800,color:'#64748b',letterSpacing:1,marginBottom:6}}>2. SELECT DATE TAB</div>
                  <select className="ic" value={selSheet} onChange={e=>setSelSheet(e.target.value)} style={{fontSize:13}}>
                    {sheetNames.map(n=><option key={n} value={n}>{n}</option>)}
                  </select>
                  {formDate && selSheet && !selSheet.toLowerCase().includes(new Date(formDate+'T12:00:00').toLocaleString('en-US',{month:'long'}).toLowerCase()) &&
                    <div style={{fontSize:11,color:'#d97706',fontWeight:600,marginTop:4}}>⚠ Selected tab may not match report date {formDate}</div>
                  }
                </div>
              )}

              {/* Deposit slip upload */}
              <div>
                <div style={{fontSize:11,fontWeight:800,color:'#7c3aed',letterSpacing:1,marginBottom:8}}>{sheetNames.length>0?'3':'2'}. DEPOSIT SLIP (CSV)</div>
                <label style={{display:'block',border:'2px dashed #e2e8f0',borderRadius:12,padding:'20px',textAlign:'center',cursor:'pointer',background:'#f8fafc'}}
                  onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor='#7c3aed';}}
                  onDragLeave={e=>{e.currentTarget.style.borderColor='#e2e8f0';}}
                  onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor='#e2e8f0';const f=e.dataTransfer.files[0];if(f)handleDepositFile({target:{files:[f]}});}}>
                  <input type="file" accept=".csv,.pdf,.xlsx,.xls" onChange={handleDepositFile} style={{display:'none'}}/>
                  <IcoUpload size={24} style={{color:'#7c3aed',margin:'0 auto 8px'}}/>
                  <div style={{fontSize:13,fontWeight:700,color:'#1e293b',marginBottom:3}}>Drop deposit slip CSV here</div>
                  {depositFile
                    ? <div style={{fontSize:12,color:'#7c3aed',fontWeight:600}}>{depositFile.name}</div>
                    : <div style={{fontSize:11,color:'#94a3b8'}}>Export from Dentrix Ascend → Reports → Deposit Slip → CSV</div>}
                </label>
              </div>

              {error && <div style={{background:'#fef2f2',border:'1px solid #fecaca',borderRadius:8,padding:10,fontSize:12,color:'#dc2626'}}>{error}</div>}

              <button onClick={parse} disabled={parsing||!collFile||!selSheet||!depositFile}
                style={{padding:'11px 0',borderRadius:10,background:(parsing||!collFile||!selSheet||!depositFile)?'#c4b5fd':'#7c3aed',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:(parsing||!collFile||!selSheet||!depositFile)?'not-allowed':'pointer'}}>
                {parsing ? '⏳ Reconciling…' : '🔍 Reconcile Collections'}
              </button>
            </div>
          ) : (
            <div>
              {/* Summary header */}
              <div style={{background:'linear-gradient(135deg,#7c3aed,#9333ea)',borderRadius:12,padding:'16px 20px',marginBottom:16,color:'white',display:'flex',flexWrap:'wrap',gap:0}}>
                {[
                  ['EXPECTED',    '$'+totalExp.toFixed(2),  null],
                  ['COLLECTED',   '$'+totalPaid.toFixed(2), null],
                  ['GAP',         (totalGap>=0?'$':'−$')+Math.abs(totalGap).toFixed(2), totalGap>0?'#f87171':totalGap<0?'#86efac':null],
                  ['ACTION NEEDED', actionNeeded.length+' patient'+(actionNeeded.length!==1?'s':''), actionNeeded.length>0?'#f87171':'#86efac'],
                ].map(([l,v,c],i)=>(
                  <div key={i} style={{flex:'1 1 100px',padding:'0 14px',borderLeft:i>0?'1px solid rgba(255,255,255,.2)':'none'}}>
                    <div style={{fontSize:9,opacity:.6,letterSpacing:1,fontWeight:700,marginBottom:3}}>{l}</div>
                    <div style={{fontSize:16,fontWeight:800,color:c||'white'}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Full patient list */}
              <div style={{background:'white',borderRadius:10,border:'1px solid #e2e8f0',overflow:'hidden',marginBottom:16}}>
                <div style={{fontSize:11,fontWeight:800,color:'#64748b',padding:'10px 14px',borderBottom:'1px solid #e2e8f0',letterSpacing:1,background:'#f8fafc'}}>PATIENT RECONCILIATION — {preview.filter(r=>r.status!=='skip').length} PATIENTS</div>
                <div style={{maxHeight:300,overflowY:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse'}}>
                    <thead><tr style={{background:'#f8fafc'}}>
                      {['Patient','Expected','Collected','Gap','Status','Match'].map(h=>(
                        <th key={h} style={{padding:'8px 10px',textAlign:'left',fontSize:10,fontWeight:700,color:'#64748b',letterSpacing:.5,borderBottom:'1px solid #e2e8f0',whiteSpace:'nowrap'}}>{h.toUpperCase()}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {preview.filter(r=>r.status!=='skip').sort((a,b)=>{
                        const order = {not_collected:0,short:1,uncertain:2,overpaid:3,collected:4};
                        return (order[a.status]||5)-(order[b.status]||5);
                      }).map((r,i)=>(
                        <tr key={i} style={{borderBottom:'1px solid #f8fafc',background:r.status==='not_collected'?'#fff5f5':r.status==='short'?'#fffbeb':'white'}}>
                          <td style={{padding:'8px 10px',fontSize:12,fontWeight:600,color:'#1e293b',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name_raw}</td>
                          <td style={{padding:'8px 10px',fontSize:12,color:'#475569'}}>${r.total_expected.toFixed(2)}</td>
                          <td style={{padding:'8px 10px',fontSize:12,color:'#475569'}}>${r.paid.toFixed(2)}</td>
                          <td style={{padding:'8px 10px',fontSize:12,fontWeight:r.gap!==0?700:400,color:r.gap>0?'#dc2626':r.gap<0?'#0d9488':'#94a3b8'}}>
                            {r.gap===0?'—':(r.gap>0?'−$':'+'+'$')+Math.abs(r.gap).toFixed(2)}
                          </td>
                          <td style={{padding:'8px 10px'}}>
                            <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:99,background:statusBg(r.status),color:statusColor(r.status)}}>
                              {statusLabel(r.status)}
                            </span>
                          </td>
                          <td style={{padding:'8px 10px',fontSize:10,color:'#94a3b8'}}>{r.match_type}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
                <button onClick={()=>setPreview(null)} style={{padding:'10px 22px',borderRadius:8,border:'1px solid #e2e8f0',background:'white',color:'#475569',fontWeight:700,fontSize:13,cursor:'pointer'}}>← Back</button>
                <button onClick={()=>onApply(preview)} style={{padding:'10px 28px',borderRadius:8,background:'#7c3aed',color:'white',border:'none',fontWeight:700,fontSize:14,cursor:'pointer'}}>
                  ✓ Apply to Report
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ManagerFormPage
