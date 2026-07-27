// src/lib/orthoDocs.js — Ortho/Invisalign/payment-plan documents (BSBD branded).
// Print-ready pages: patient payment presentation, payment agreement with
// full schedule, and a professional letter version. Opens print dialog →
// save as PDF, same pattern as the ledger reports.

const NAVY = '#1B2A6B', GOLD = '#C9A84C'
const usd = v => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
const fmtD = iso => { const d = new Date(iso + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }

const OFFICE_INFO = {
  Dalton:   { addr: '509 S Thornton Ave, Dalton, GA 30720', phone: '(706) 226-9798' },
  Calhoun:  { addr: '805 Windsor Dr, Calhoun, GA 30701',    phone: '(706) 625-8888' },
  Brainerd: { addr: 'Chattanooga, TN',                       phone: '(706) 226-9798' },
  McCallie: { addr: 'Chattanooga, TN',                       phone: '(706) 226-9798' },
}

function shell(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>
    @page { margin: 0.75in; }
    body { font-family: Georgia, 'Times New Roman', serif; color: #1e293b; margin: 0; padding: 30px 38px; font-size: 13px; line-height: 1.55; }
    .hdr { border-bottom: 3px solid ${GOLD}; padding-bottom: 12px; margin-bottom: 18px; }
    .brand { font-size: 20px; font-weight: bold; color: ${NAVY}; letter-spacing: .5px; }
    .sub { font-size: 11px; color: #64748b; margin-top: 2px; }
    h2 { color: ${NAVY}; font-size: 15px; margin: 20px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    .big { font-size: 24px; font-weight: bold; color: ${NAVY}; }
    table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
    td, th { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; text-align: left; }
    th { color: ${NAVY}; font-size: 10px; letter-spacing: .6px; }
    .r { text-align: right; }
    .opt { border: 2px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; text-align: center; }
    .opt.hl { border-color: ${GOLD}; background: #fffdf5; }
    .optgrid { display: flex; gap: 12px; margin: 12px 0; }
    .optgrid > div { flex: 1; }
    .box { background: #f8fafc; border-left: 4px solid ${GOLD}; padding: 10px 14px; margin: 10px 0; page-break-inside: avoid; font-size: 12px; }
    .sig { display: flex; gap: 40px; margin-top: 34px; }
    .sig > div { flex: 1; border-top: 1px solid #1e293b; padding-top: 5px; font-size: 11px; color: #475569; }
    .ftr { margin-top: 26px; border-top: 2px solid ${NAVY}; padding-top: 8px; font-size: 10px; color: #64748b; }
    .terms { font-size: 11px; color: #334155; }
    .terms li { margin-bottom: 6px; }
    .kv td { border: none; padding: 3px 10px 3px 0; }
  </style></head><body>${body}
  <script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`
}

const header = (office) => {
  const o = OFFICE_INFO[office] || OFFICE_INFO.Dalton
  return `<div class="hdr">
    <div class="brand">Beautiful Smiles by Design</div>
    <div class="sub">${office || 'Dalton'} Office · ${o.addr} · ${o.phone}</div>
  </div>`
}

// build the dated payment schedule: n monthly payments from startDate,
// final payment absorbs the rounding remainder (mirrors the office workbook)
export function buildSchedule(balance, months, startDate, dueDay, fixedAmount) {
  const out = []
  const bal = Math.round(Number(balance) * 100) / 100
  if (!bal || !months) return out
  // fixedAmount mode (in-house plans): every payment = the fixed charge,
  // final payment absorbs the remainder — mirrors the office workbook
  // (e.g. $354 at $50/mo -> 50,50,50,50,50,50,54)
  const per = fixedAmount ? Math.round(Number(fixedAmount) * 100) / 100
                          : Math.floor((bal / months) * 100) / 100
  const start = new Date(startDate + 'T12:00:00')
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, dueDay || start.getDate())
    const amount = i === months - 1 ? Math.round((bal - per * (months - 1)) * 100) / 100 : per
    out.push({ date: d.toISOString().slice(0, 10), amount })
  }
  return out
}

const FIN_RESP = `Insurance coverage amounts shown are estimates provided as a courtesy based on information from your insurance carrier and are not a guarantee of payment. Final insurance payment is determined solely by your carrier when claims are processed. You are financially responsible for the full patient portion of treatment regardless of insurance outcome. If insurance pays more than estimated, the difference will be credited or refunded; if it pays less, the difference becomes your responsibility.`

// ── 1. PAYMENT PRESENTATION (patient-facing options page) ──────────────────
export function buildOrthoPresentation(d) {
  const opts = d.options || []
  const body = `${header(d.office)}
    <h2 style="margin-top:0">${d.planType === 'invisalign' ? 'Invisalign' : d.planType === 'inhouse' ? 'Payment Plan' : 'Orthodontic'} Treatment — Financial Presentation</h2>
    <table class="kv" style="margin-bottom:8px"><tr>
      <td style="width:50%"><b>Patient:</b> ${d.patientName || '________________'}</td>
      <td><b>Date:</b> ${fmtD(d.today)}</td>
    </tr></table>

    <table style="margin-bottom:4px">
      ${d.lines.map(l => `<tr><td>${l.label}</td><td class="r"${l.strong ? ' style="font-weight:bold"' : ''}>${l.neg ? '− ' : ''}${usd(l.amount)}</td></tr>`).join('')}
      <tr style="border-top:2px solid ${NAVY}"><td><b>Balance to finance</b></td><td class="r"><span class="big">${usd(d.balance)}</span></td></tr>
    </table>

    <h2>Your payment options</h2>
    <div class="optgrid">
      ${opts.map((o, i) => `
        <div class="opt${o.highlight ? ' hl' : ''}">
          <div style="font-size:11px;font-weight:bold;color:#64748b;letter-spacing:1px">${o.label.toUpperCase()}</div>
          <div style="font-size:22px;font-weight:bold;color:${NAVY};margin:6px 0">${usd(o.monthly)}<span style="font-size:11px;color:#64748b">/mo</span></div>
          <div style="font-size:11px;color:#475569">${o.months} monthly payments</div>
          ${o.note ? `<div style="font-size:10px;color:#94a3b8;margin-top:4px">${o.note}</div>` : ''}
        </div>`).join('')}
    </div>
    <div style="font-size:11px;color:#64748b">All plans are interest-free. Down payment of <b>${usd(d.downPayment)}</b> is due at the start of treatment. We also accept CareCredit and Sunbit if you prefer outside financing.</div>

    <div class="box"><b>Insurance & Financial Responsibility:</b> ${FIN_RESP}</div>

    <div class="sig">
      <div>Patient / Guardian Signature &nbsp;·&nbsp; Date</div>
      <div>Staff Signature &nbsp;·&nbsp; Date</div>
    </div>
    <div class="ftr">Beautiful Smiles by Design · This presentation is valid for 30 days from the date above.</div>`
  return shell('Financial Presentation — ' + (d.patientName || ''), body)
}

// ── 2. PAYMENT AGREEMENT (formal, signable, with full schedule) ────────────
export function buildOrthoAgreement(d) {
  const sched = d.schedule || []
  const o = OFFICE_INFO[d.office] || OFFICE_INFO.Dalton
  const body = `${header(d.office)}
    <h2 style="margin-top:0">PAYMENT AGREEMENT</h2>
    <p style="font-size:12px">This Payment Agreement ("Agreement") is entered into on <b>${fmtD(d.today)}</b> between <b>Beautiful Smiles by Design</b>, ${o.addr} ("Practice"), and <b>${d.patientName || '________________________'}</b> ("Patient / Responsible Party")${d.guarantorName ? `, with <b>${d.guarantorName}</b> as guarantor` : ''}.</p>

    <h2>1. Treatment & Charges</h2>
    <table>
      ${d.lines.map(l => `<tr><td>${l.label}</td><td class="r">${l.neg ? '− ' : ''}${usd(l.amount)}</td></tr>`).join('')}
      <tr><td><b>Down payment (due at start of treatment)</b></td><td class="r"><b>${usd(d.downPayment)}</b></td></tr>
      <tr style="border-top:2px solid ${NAVY}"><td><b>Total financed under this Agreement</b></td><td class="r"><b>${usd(d.balance)}</b></td></tr>
    </table>

    <h2>2. Payment Schedule</h2>
    <p style="font-size:11.5px">The Patient agrees to pay the financed balance in <b>${sched.length}</b> monthly installments on the dates below. <b>No interest or finance charges apply.</b> The total of all scheduled payments equals the financed balance exactly.</p>
    <table>
      <tr><th>#</th><th>DUE DATE</th><th class="r">AMOUNT</th><th>PAID (INITIALS/DATE)</th></tr>
      ${sched.map((s, i) => `<tr><td>${i + 1}</td><td>${fmtD(s.date)}</td><td class="r"><b>${usd(s.amount)}</b></td><td style="color:#cbd5e1">____________</td></tr>`).join('')}
      <tr style="border-top:2px solid ${NAVY}"><td></td><td><b>Total</b></td><td class="r"><b>${usd(sched.reduce((a, s) => a + s.amount, 0))}</b></td><td></td></tr>
    </table>

    <h2>3. Terms & Conditions</h2>
    <ol class="terms">
      <li><b>Due dates.</b> Payments are due on the dates listed above. A payment is late if not received within ten (10) days of its due date.</li>
      <li><b>Late payments.</b> A late fee of $${d.lateFee || 25} may be applied to any payment more than ten (10) days past due.</li>
      <li><b>Default.</b> If two or more payments become past due, the entire remaining balance may become immediately due and payable, and active treatment may be paused (subject to applicable professional standards) until the account is brought current.</li>
      <li><b>Insurance.</b> ${FIN_RESP}</li>
      <li><b>Early payment.</b> The balance may be paid in full at any time without penalty.</li>
      <li><b>Returned payments.</b> A fee of $35 applies to any returned or declined payment.</li>
      <li><b>Treatment changes.</b> If the treatment plan changes materially, the Practice and Patient will execute a revised agreement or written amendment.</li>
      <li><b>Entire agreement.</b> This Agreement is the complete agreement regarding payment for the treatment described and supersedes prior discussions of payment terms.</li>
    </ol>

    <div class="sig">
      <div>Patient / Guardian Signature &nbsp;·&nbsp; Date</div>
      <div>Practice Representative &nbsp;·&nbsp; Date</div>
    </div>
    ${d.guarantorName ? `<div class="sig"><div>Guarantor Signature &nbsp;·&nbsp; Date</div><div></div></div>` : ''}
    <div class="ftr">Beautiful Smiles by Design · Payment Agreement · Page generated ${fmtD(d.today)}</div>`
  return shell('Payment Agreement — ' + (d.patientName || ''), body)
}

// ── 3. PROFESSIONAL LETTER with the payment timeline ───────────────────────
export function buildScheduleLetter(d) {
  const sched = d.schedule || []
  const o = OFFICE_INFO[d.office] || OFFICE_INFO.Dalton
  const body = `${header(d.office)}
    <p style="margin-top:6px">${fmtD(d.today)}</p>
    <p>${d.patientName || '________________'}<br>${d.patientAddress || ''}</p>
    <p><b>Re: Your ${d.planType === 'invisalign' ? 'Invisalign' : d.planType === 'inhouse' ? 'payment plan' : 'orthodontic treatment'} payment schedule</b></p>
    <p>Dear ${d.patientName ? d.patientName.split(' ')[0] : 'Patient'},</p>
    <p>Thank you for choosing Beautiful Smiles by Design${d.planType !== 'inhouse' ? ' for your orthodontic care' : ''}. This letter confirms the payment arrangement we discussed${d.balance ? `, covering a balance of <b>${usd(d.balance)}</b>` : ''}${d.downPayment ? ` following your down payment of <b>${usd(d.downPayment)}</b>` : ''}. Your payments are interest-free and scheduled as follows:</p>
    <table style="max-width:420px">
      <tr><th>#</th><th>DUE DATE</th><th class="r">AMOUNT</th></tr>
      ${sched.map((s, i) => `<tr><td>${i + 1}</td><td>${fmtD(s.date)}</td><td class="r"><b>${usd(s.amount)}</b></td></tr>`).join('')}
      <tr style="border-top:2px solid ${NAVY}"><td></td><td><b>Total</b></td><td class="r"><b>${usd(sched.reduce((a, s) => a + s.amount, 0))}</b></td></tr>
    </table>
    <p>Payments can be made in person, by phone at ${o.phone}, or through your patient portal. If a scheduled date ever becomes difficult, please call us <i>before</i> the due date — we will always work with you.</p>
    <p>We're honored to be part of your smile journey.</p>
    <p style="margin-top:26px">Warm regards,</p>
    <p style="margin-top:30px">_________________________<br>Beautiful Smiles by Design<br>${d.office || 'Dalton'} Office · ${o.phone}</p>
    <div class="ftr">Beautiful Smiles by Design · ${o.addr}</div>`
  return shell('Payment Schedule Letter — ' + (d.patientName || ''), body)
}

export function openDoc(html) {
  const w = window.open('', '_blank')
  if (!w) { alert('Pop-up blocked — allow pop-ups for this site to open documents'); return }
  w.document.write(html)
  w.document.close()
}
