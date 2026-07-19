// src/lib/ledgerReports.js — downloadable balance reports (BSBD branded).
// Opens a print-ready document in a new window; user prints or saves as PDF.
// Two documents: a patient-facing balance explanation, and a staff-facing
// guide for explaining the balance at the desk.

const NAVY = '#1B2A6B', GOLD = '#C9A84C'
const usd = v => '$' + Math.abs(Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })

const PATIENT_REASON = {
  'patient portion not collected': 'Your insurance processed this visit and paid its share. The remaining amount is the portion your plan assigns to you.',
  'uncollected deductible': 'Your insurance plan includes a deductible — an amount the plan requires you to pay before benefits apply. It was not collected at your visit.',
  'benefits exhausted': 'Your insurance plan has a yearly maximum it will pay. That maximum was reached, so charges after that point become your responsibility under your plan.',
  'likely denial': 'Your insurance reviewed the claim for this visit and did not pay it. We are reviewing the reason with them.',
  'claim unresolved': 'We are still working with your insurance on this visit. The amount may change once they respond.',
  'claim never sent': 'We are reviewing the insurance claim for this visit.',
  'pending claim': 'Your insurance is still processing this visit. The amount may change once they respond.',
  'downgrade differential': 'Your insurance plan pays for a less expensive version of this filling material (an "alternate benefit"). The difference is assigned to you under your plan.',
  'missed write-off': 'A portion of this amount is under internal review and may be adjusted.',
  'credit adjustment': 'Your account shows a credit — money in your favor.',
  'overpayment': 'Your account shows a credit — money in your favor.',
  'orphaned payment split': 'Your account shows a payment we are re-verifying.',
  'possible duplicate charge': 'This visit is under internal review.',
  'undetermined': 'This visit is under review with your insurance records.',
}

const STAFF_SCRIPT = {
  collect: {
    what: 'This amount is legitimately owed by the patient. Insurance has done everything it is going to do.',
    say: '"Your insurance processed everything and paid their portion — this remaining amount is your share under your plan. How would you like to take care of it today? We also offer CareCredit and payment plans."',
    avoid: 'Do not say "insurance didn\'t pay" without the reason — patients hear that as our mistake. Name the mechanism: deductible, plan percentage, or yearly maximum.',
  },
  insurance: {
    what: 'Insurance action needed FIRST. Do not press the patient for this amount yet — the claim is unresolved and the number may change.',
    say: '"We\'re still working with your insurance on part of this. We\'ll reach out once it\'s finalized — you don\'t need to pay this portion today."',
    avoid: 'Never collect on an unresolved claim amount — refunding later destroys trust.',
  },
  writeoff: {
    what: 'Likely NOT collectible — appears to be a contractual discount or downgrade difference that should be adjusted off, not billed.',
    say: 'Do not present this amount to the patient. Route to billing for adjustment review.',
    avoid: 'Billing contractual write-offs to patients violates PPO agreements.',
  },
  refund: {
    what: 'The account is in credit — the patient may be owed money.',
    say: '"Good news — your account actually shows a credit. We\'re verifying it and will issue a refund or apply it to your next visit, your choice."',
    avoid: 'Do not sit on credits. Proactively telling patients builds enormous goodwill.',
  },
  posting: {
    what: 'Ledger posting error — no money changes hands with the patient. Fix internally.',
    say: 'Nothing to the patient unless they ask; then: "That was a bookkeeping entry on our side — your actual balance is [corrected amount]."',
    avoid: 'Do not collect against a balance created by a posting error.',
  },
  investigate: {
    what: 'Cause not yet determined — compare against the EOB before any patient conversation.',
    say: '"Let me have our billing team verify this and call you back with the exact breakdown."',
    avoid: 'Never guess at a reason with the patient.',
  },
}

function shell(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page { margin: 0.7in; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1e293b; margin: 0; padding: 32px 40px; font-size: 13px; line-height: 1.55; }
    .hdr { border-bottom: 3px solid ${GOLD}; padding-bottom: 12px; margin-bottom: 20px; }
    .brand { font-size: 20px; font-weight: bold; color: ${NAVY}; letter-spacing: .5px; }
    .sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    h2 { color: ${NAVY}; font-size: 15px; margin: 22px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .big { font-size: 26px; font-weight: bold; color: ${NAVY}; }
    .visit { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-bottom: 10px; page-break-inside: avoid; }
    .vhead { display: flex; justify-content: space-between; font-weight: bold; margin-bottom: 4px; }
    .amt { color: #b91c1c; }
    .credit { color: #166534; }
    .money { font-size: 11.5px; color: #475569; margin: 3px 0; }
    .why { font-size: 12px; margin-top: 5px; }
    .tag { display:inline-block; font-size: 10px; font-weight: bold; padding: 2px 10px; border-radius: 99px; background: ${NAVY}; color: white; margin-bottom: 6px; }
    .box { background: #f8fafc; border-left: 4px solid ${GOLD}; padding: 10px 14px; margin: 8px 0; page-break-inside: avoid; }
    .lbl { font-size: 10px; font-weight: bold; color: #94a3b8; letter-spacing: 1px; }
    .ftr { margin-top: 28px; border-top: 2px solid ${NAVY}; padding-top: 8px; font-size: 10px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    td, th { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; }
    th { color: ${NAVY}; font-size: 10px; letter-spacing: .5px; }
    .no-print { display:none; }
  </style></head><body>${body}
  <script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`
}

const header = (office) => `<div class="hdr">
  <div class="brand">Beautiful Smiles by Design</div>
  <div class="sub">${office || 'Dalton'} Office · 509 S Thornton Ave, Dalton, GA 30720 · (706) 226-9798</div>
</div>`

// ── PATIENT REPORT ──────────────────────────────────────────────────────────
export function buildPatientReport({ meta, attribution, patientName, office }) {
  const bal = meta.guarantorBalance ?? attribution.total
  const isCredit = bal < -0.01
  // patient report only shows patient-appropriate rows; internal-only items grouped
  const rows = attribution.rows.map(r => {
    const primary = r.sources[0] || { src: 'undetermined' }
    return { ...r, patientReason: PATIENT_REASON[primary.src] || PATIENT_REASON.undetermined }
  })
  const body = `${header(office)}
    <h2 style="margin-top:0">Account Balance Explanation</h2>
    <table style="margin-bottom:14px"><tr>
      <td><span class="lbl">PATIENT / GUARANTOR</span><br><b>${patientName || meta.chart || ''}</b></td>
      <td><span class="lbl">CHART #</span><br>${meta.chart || '—'}</td>
      <td><span class="lbl">STATEMENT PERIOD</span><br>${meta.start || ''} – ${meta.end || ''}</td>
      <td style="text-align:right"><span class="lbl">${isCredit ? 'ACCOUNT CREDIT' : 'BALANCE DUE'}</span><br>
        <span class="big ${isCredit ? 'credit' : ''}">${usd(bal)}</span></td>
    </tr></table>
    ${isCredit ? `<div class="box">Good news — your account shows a <b>credit of ${usd(bal)}</b>. Please contact our office so we can issue your refund or apply it to upcoming treatment, whichever you prefer.</div>` : `
    <p>We want you to understand exactly where your balance comes from. Below is each visit that contributes to it, what your insurance did, and why an amount remains.</p>`}
    ${rows.map(r => `
      <div class="visit">
        <div class="vhead"><span>Visit of ${r.date}${r.patient ? ' — ' + r.patient : ''}</span>
          <span class="${r.net > 0 ? 'amt' : 'credit'}">${r.net > 0 ? usd(r.net) : 'Credit ' + usd(r.net)}</span></div>
        <div class="money">Procedures: ${r.codes} · Charges ${usd(r.chargeTotal)}
          ${r.insPaid ? ' · Insurance paid ' + usd(r.insPaid) : ''}
          ${r.insAdj ? ' · Insurance discount ' + usd(r.insAdj) : ''}
          ${r.ptPaid ? ' · You paid ' + usd(r.ptPaid) : ''}</div>
        <div class="why">${r.patientReason}</div>
      </div>`).join('')}
    <div class="box"><b>Questions or payment arrangements:</b> call us at (706) 226-9798. We offer CareCredit, Sunbit, and in-house payment plans — we will always work with you.</div>
    <div class="ftr">Beautiful Smiles by Design · This statement reflects your account as of ${meta.balanceDate || meta.end || ''}. Amounts pending with insurance may change once your plan responds.</div>`
  return shell('Balance Explanation — ' + (patientName || meta.chart || ''), body)
}

// ── STAFF REPORT ────────────────────────────────────────────────────────────
export function buildStaffReport({ meta, attribution, patientName, office, aiText }) {
  const bal = meta.guarantorBalance ?? attribution.total
  const buckets = attribution.buckets || {}
  const body = `${header(office)}
    <h2 style="margin-top:0">Staff Balance Workup — INTERNAL ONLY</h2>
    <table style="margin-bottom:12px"><tr>
      <td><span class="lbl">PATIENT</span><br><b>${patientName || meta.chart || ''}</b> · Chart ${meta.chart || '—'}</td>
      <td style="text-align:right"><span class="lbl">LEDGER BALANCE</span><br><span class="big">${usd(bal)}${bal < 0 ? ' CREDIT' : ''}</span></td>
    </tr></table>
    <h2>Disposition summary — what to do with each dollar</h2>
    <table><tr><th>DISPOSITION</th><th style="text-align:right">AMOUNT</th></tr>
      ${Object.entries(buckets).map(([d, v]) => `<tr><td>${(STAFF_SCRIPT[d] || {}).what ? '<b>' + d.toUpperCase() + '</b> — ' + STAFF_SCRIPT[d].what : d}</td><td style="text-align:right"><b>${usd(v)}</b></td></tr>`).join('')}
    </table>
    <h2>Visit-by-visit: how to explain each amount</h2>
    ${attribution.rows.map(r => {
      const s = STAFF_SCRIPT[r.disposition] || STAFF_SCRIPT.investigate
      return `<div class="visit">
        <span class="tag">${r.disposition.toUpperCase()}</span>
        <div class="vhead"><span>${r.date} · ${r.codes}</span><span class="${r.net > 0 ? 'amt' : 'credit'}">${usd(r.net)}${r.net < 0 ? ' credit' : ''}</span></div>
        <div class="money">Charges ${usd(r.chargeTotal)} · Ins paid ${usd(r.insPaid)} · Ins adj ${usd(r.insAdj)} · Pt paid ${usd(r.ptPaid)}</div>
        <div class="why"><b>What happened:</b> ${r.sources.map(x => `${x.src} — ${x.detail}`).join('; ')}</div>
        <div class="box"><b>Say this:</b> ${s.say}<br><b style="color:#b91c1c">Avoid:</b> ${s.avoid}</div>
      </div>`}).join('')}
    ${aiText ? `<h2>Auditor narrative</h2><div style="white-space:pre-wrap;font-size:12px">${aiText.replace(/</g, '&lt;')}</div>` : ''}
    <div class="ftr">INTERNAL DOCUMENT — do not hand to patient. Generated by the BSBD Ledger Analyzer on ${new Date().toLocaleDateString('en-US')}.</div>`
  return shell('Staff Workup — ' + (patientName || meta.chart || ''), body)
}

// ── LEDGER ANALYSIS WORKSHEET (internal, the formal per-patient workup) ────
export function buildWorksheet({ meta, attribution, patientName, office, analyst }) {
  const v = attribution.verdict || {}
  const bal = meta.guarantorBalance ?? attribution.total
  const vColor = v.code==='COLLECT'?'#166534':v.code==='PARTIAL'?'#92400e':v.code==='REFUND'?'#0d9488':'#b91c1c'
  const chk = '<span style="display:inline-block;width:11px;height:11px;border:1.5px solid #64748b;border-radius:2px;margin-right:5px;vertical-align:-1px"></span>'
  const line = (w='120px') => `<span style="display:inline-block;border-bottom:1px solid #94a3b8;min-width:${w}">&nbsp;</span>`
  const body = `${header(office)}
    <h2 style="margin-top:0">LEDGER ANALYSIS WORKSHEET</h2>
    <table style="margin-bottom:10px"><tr>
      <td><span class="lbl">PATIENT / GUARANTOR</span><br><b>${patientName || ''}</b></td>
      <td><span class="lbl">CHART #</span><br>${meta.chart || '—'}</td>
      <td><span class="lbl">LEDGER PERIOD</span><br>${meta.start || ''} – ${meta.end || ''}</td>
      <td><span class="lbl">ANALYST</span><br>${analyst || line('90px')}</td>
      <td><span class="lbl">DATE</span><br>${new Date().toLocaleDateString('en-US')}</td>
      <td style="text-align:right"><span class="lbl">LEDGER BALANCE</span><br><span class="big">${usd(bal)}${bal<0?' CR':''}</span></td>
    </tr></table>

    <div style="border:3px solid ${vColor};border-radius:10px;padding:14px 18px;margin-bottom:16px;page-break-inside:avoid">
      <div style="font-size:10px;font-weight:bold;color:${vColor};letter-spacing:1.5px">OVERALL DETERMINATION</div>
      <div style="font-size:18px;font-weight:bold;color:${vColor};margin:4px 0">${v.headline || 'Undetermined'}</div>
      <div style="font-size:12px">${v.instruction || ''}</div>
      <table style="margin-top:10px"><tr>
        <td><span class="lbl">COLLECT NOW</span><br><b style="font-size:15px;color:#166534">${usd(v.collectNow||0)}</b></td>
        <td><span class="lbl">HOLD (INS/EOB FIRST)</span><br><b style="font-size:15px;color:#92400e">${usd(v.hold||0)}</b></td>
        <td><span class="lbl">WRITE-OFF REVIEW</span><br><b style="font-size:15px;color:#7c3aed">${usd(v.woReview||0)}</b></td>
        <td><span class="lbl">REFUND DUE</span><br><b style="font-size:15px;color:#0d9488">${usd(v.refundDue||0)}</b></td>
      </tr></table>
    </div>

    <h2>Visit workup — verify each line against the EOB</h2>
    ${attribution.rows.map((r,i)=>`
      <div class="visit">
        <div class="vhead"><span>${i+1}. ${r.date} · ${r.codes}${r.patient?' · '+r.patient:''}</span>
          <span class="${r.net>0?'amt':'credit'}">${usd(r.net)}${r.net<0?' credit':''}</span></div>
        <div class="money">Charges ${usd(r.chargeTotal)} · Ins paid ${usd(r.insPaid)} · Ins adj ${usd(r.insAdj)} · Pt paid ${usd(r.ptPaid)}${r.writeoff?' · W/O '+usd(r.writeoff):''}${r.creditAdj?' · Cr adj '+usd(r.creditAdj):''}</div>
        <div class="why"><b>Disposition:</b> ${r.dispositionLabel||''}</div>
        <div class="why"><b>Probable cause(s):</b> ${r.sources.map(s=>s.src).join(' · ')}</div>
        <div class="why" style="font-size:11px;color:#475569">${r.sources.map(s=>'– '+s.detail).join('<br>')}</div>
        <div style="margin-top:8px;font-size:11px">
          ${chk}EOB pulled &nbsp; ${chk}Cause confirmed &nbsp; ${chk}Action completed &nbsp;
          Actual cause (if different): ${line('200px')}<br>
          <span style="display:inline-block;margin-top:6px">Actioned by: ${line('110px')} &nbsp; Date: ${line('80px')} &nbsp; Result: ${line('240px')}</span>
        </div>
      </div>`).join('')}

    <h2>Final resolution</h2>
    <div class="box" style="page-break-inside:avoid">
      ${chk}Collected ${line('80px')} &nbsp; ${chk}Statement sent &nbsp; ${chk}Written off ${line('80px')} &nbsp; ${chk}Refunded ${line('80px')} &nbsp; ${chk}Claim resubmitted &nbsp; ${chk}Posting corrected<br>
      <span style="display:inline-block;margin-top:10px">Notes: ${line('420px')}</span><br>
      <span style="display:inline-block;margin-top:10px">Analyst signature: ${line('160px')} &nbsp;&nbsp; Reviewed by (OM): ${line('160px')} &nbsp;&nbsp; Date closed: ${line('90px')}</span>
    </div>
    <div class="ftr">INTERNAL DOCUMENT — Ledger Analysis Worksheet · Beautiful Smiles by Design / Ridgeview Support Services · One worksheet required for every patient balance.</div>`
  return shell('Ledger Analysis Worksheet — ' + (patientName || meta.chart || ''), body)
}

export function openReport(html) {
  const w = window.open('', '_blank')
  if (!w) { alert('Pop-up blocked — allow pop-ups for this site to download reports'); return }
  w.document.write(html)
  w.document.close()
}
