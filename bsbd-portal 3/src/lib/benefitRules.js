// src/lib/benefitRules.js — deterministic verification engine.
// Every CDT code maps to a category and a set of REQUIRED CHECKS.
// Checks resolve against the patient's benefit_profile: pass / fail / unknown.
// Unknown = not verified yet (no evidence on file). AI never does the math here.

import { N } from './helpers'

// ── CDT categories ──────────────────────────────────────────────────────────
export function codeCategory(code) {
  if (!code || !/^D\d{4}$/.test(code)) return 'other'
  const n = +code.slice(1)
  if (n >= 100 && n <= 999)   return 'preventive'   // diagnostic
  if (n >= 1000 && n <= 1999) return 'preventive'
  if (n >= 2000 && n <= 2999) return n >= 2700 ? 'major' : 'basic'   // crowns major, fillings basic
  if (n >= 3000 && n <= 3999) return 'basic'        // endo (plan-dependent; overridable)
  if (n >= 4000 && n <= 4999) return 'perio'
  if (n >= 5000 && n <= 5899) return 'denture'
  if (n >= 6000 && n <= 6199) return 'implant'
  if (n >= 6200 && n <= 6999) return 'major'        // fixed pros
  if (n >= 7000 && n <= 7999) return 'basic'        // oral surgery (often basic)
  return 'other'
}

export function coverageForCode(code, profile) {
  const cat = codeCategory(code)
  if (!profile) return { pct: null, cat }
  const map = {
    preventive: profile.cov_preventive,
    basic:      profile.cov_basic,
    perio:      profile.cov_perio ?? profile.cov_basic,
    major:      profile.cov_major,
    implant:    profile.cov_implant,
    denture:    profile.cov_denture ?? profile.cov_major,
    other:      null,
  }
  return { pct: map[cat] ?? null, cat }
}

// ── frequency rules (typical; profile dates are the evidence) ───────────────
const FREQ_RULES = {
  D1110: { field:'freq_prophy_last',  months:6,  label:'Prophy 2/yr' },
  D1120: { field:'freq_prophy_last',  months:6,  label:'Prophy 2/yr' },
  D4910: { field:'freq_prophy_last',  months:3,  label:'Perio maint (3-4mo, shares prophy freq on many plans)' },
  D0274: { field:'freq_bwx_last',     months:12, label:'BWX 1/yr' },
  D0272: { field:'freq_bwx_last',     months:12, label:'BWX 1/yr' },
  D0210: { field:'freq_fmx_last',     months:36, label:'FMX every 3-5yr' },
  D0330: { field:'freq_fmx_last',     months:36, label:'Pano shares FMX freq on most plans' },
  D4341: { field:'freq_srp_last',     months:24, label:'SRP per quad 24mo typical' },
  D4342: { field:'freq_srp_last',     months:24, label:'SRP per quad 24mo typical' },
  D5110: { field:'freq_denture_last', months:60, label:'Denture 5-8yr replacement' },
  D5120: { field:'freq_denture_last', months:60, label:'Denture 5-8yr replacement' },
  D5213: { field:'freq_denture_last', months:60, label:'Partial 5-8yr replacement' },
  D5214: { field:'freq_denture_last', months:60, label:'Partial 5-8yr replacement' },
}

const MTC_CODES  = /^D(60\d\d|61\d\d|62\d\d|624\d|625\d|66\d\d|52\d\d|521[34])/  // implants, pontics, partials
const MAJOR_WAIT = ['major', 'implant', 'denture']

function monthsBetween(iso, today) {
  const a = new Date(iso), b = new Date(today)
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
}

// ── the resolver: required checks for one code against one profile ─────────
// returns [{check, label, status:'pass'|'fail'|'unknown', detail, evidence}]
export function verifyCode(code, profile, { today = new Date().toISOString().slice(0, 10), fee = 0 } = {}) {
  const out = []
  const cat = codeCategory(code)
  const push = (check, label, status, detail, evidence) => out.push({ check, label, status, detail, evidence: evidence || null })
  const src = profile?.source_doc_id ? `faxback doc #${profile.source_doc_id}` : profile ? 'profile (no doc on file)' : null

  // 0. profile exists at all
  if (!profile) {
    push('profile', 'Benefit profile', 'unknown', 'No verified benefits on file for this patient — upload the faxback or verify manually')
    return out
  }

  // 1. coverage % known for this category
  const { pct } = coverageForCode(code, profile)
  if (pct == null) push('coverage', `Coverage (${cat})`, 'unknown', `No ${cat} coverage % on the profile — confirm from faxback`, src)
  else if (pct === 0) push('coverage', `Coverage (${cat})`, 'fail', `Plan pays 0% on ${cat} — full patient responsibility`, src)
  else push('coverage', `Coverage (${cat})`, 'pass', `Plan pays ${pct}% on ${cat}`, src)

  // 2. MTC for implants / pontics / partials
  if (MTC_CODES.test(code)) {
    if (profile.mtc == null) push('mtc', 'Missing Tooth Clause', 'unknown', 'MTC status not verified — a denial risk on this code', src)
    else if (profile.mtc) push('mtc', 'Missing Tooth Clause', 'fail',
      `Plan HAS an MTC${profile.missing_teeth ? ` — teeth missing at enrollment: ${profile.missing_teeth}` : ''}. If this tooth was missing before coverage, expect denial. Get pre-D or patient consent.`, src)
    else push('mtc', 'Missing Tooth Clause', 'pass', 'No MTC on this plan', src)
  }

  // 3. waiting periods on major work
  if (MAJOR_WAIT.includes(cat)) {
    if (profile.waiting_periods == null || profile.waiting_periods === '')
      push('waiting', 'Waiting period', 'unknown', 'Waiting periods not verified for major services', src)
    else if (/none|n\/a|no wait/i.test(profile.waiting_periods))
      push('waiting', 'Waiting period', 'pass', 'No waiting periods', src)
    else
      push('waiting', 'Waiting period', 'fail', `Waiting periods on plan: ${profile.waiting_periods} — confirm this patient has cleared them`, src)
  }

  // 4. frequency
  const fr = FREQ_RULES[code]
  if (fr) {
    const last = profile[fr.field]
    if (!last) push('frequency', 'Frequency', 'unknown', `${fr.label} — no last-service date on the profile`, src)
    else {
      const m = monthsBetween(last, today)
      if (m < fr.months) push('frequency', 'Frequency', 'fail',
        `${fr.label}: last done ${last} (${m} mo ago) — inside the ${fr.months}-month window. Denial likely; patient may owe full fee.`, src)
      else push('frequency', 'Frequency', 'pass', `${fr.label}: last done ${last} (${m} mo ago) — clear`, src)
    }
  }

  // 5. remaining annual max
  if (profile.max_remaining != null) {
    const insPortion = pct != null ? N(fee) * pct / 100 : null
    if (insPortion != null && insPortion > profile.max_remaining)
      push('max', 'Annual max', 'fail',
        `Only $${profile.max_remaining} of benefits remain — insurance share of this code (~$${insPortion.toFixed(0)}) exceeds it. Excess shifts to patient.`, src)
    else push('max', 'Annual max', 'pass', `$${profile.max_remaining} remaining on $${profile.annual_max ?? '?'} max`, src)
  } else if (cat !== 'preventive') {
    push('max', 'Annual max', 'unknown', 'Remaining benefits not on profile — a mid-plan max-out shifts costs to the patient silently', src)
  }

  // 6. downgrade on posterior composites
  if (/^D239[1-4]$/.test(code)) {
    if (profile.downgrade_posterior == null) push('downgrade', 'Composite downgrade', 'unknown', 'Downgrade clause not verified — patient portion may be understated', src)
    else if (profile.downgrade_posterior) push('downgrade', 'Composite downgrade', 'fail', 'Plan downgrades posterior composite to amalgam rate — estimate at alternate benefit', src)
    else push('downgrade', 'Composite downgrade', 'pass', 'No downgrade clause', src)
  }

  return out
}

// worst status across a set of checks
export function worstStatus(checks) {
  if (checks.some(c => c.status === 'fail')) return 'fail'
  if (checks.some(c => c.status === 'unknown')) return 'unknown'
  return 'pass'
}

// ── deterministic patient-level calculator ─────────────────────────────────
// lines: [{code, fee, pt_pct, pt_amount}] — pt_pct is patient share %.
// Returns { deductibleApplied, deductibleLineIdx, collectToday, breakdown }
export function computeCollect(lines, profile, priorBalance = 0) {
  const linesTotal = (lines || []).reduce((s, t) => s + N(t.pt_amount), 0)
  let deductibleApplied = 0
  let deductibleLineIdx = null
  if (profile && N(profile.deductible_remaining) > 0) {
    // deductible attaches to the FIRST line whose category is not waived
    const idx = (lines || []).findIndex(t => {
      const cat = codeCategory(t.code)
      if (cat === 'preventive' && profile.deductible_waived_preventive !== false) return false
      return N(t.fee) > 0
    })
    if (idx !== -1) {
      deductibleApplied = Math.min(N(profile.deductible_remaining), N(lines[idx].fee))
      deductibleLineIdx = idx
    }
  }
  const collectToday = Math.round((linesTotal + deductibleApplied + N(priorBalance)) * 100) / 100
  return {
    deductibleApplied,
    deductibleLineIdx,
    linesTotal: Math.round(linesTotal * 100) / 100,
    priorBalance: N(priorBalance),
    collectToday,
    breakdown: `${linesTotal.toFixed(2)} procedures + ${deductibleApplied.toFixed(2)} deductible + ${N(priorBalance).toFixed(2)} prior balance`,
  }
}

export const CHECK_ICON = { pass: '✓', fail: '✗', unknown: '?' }
export const CHECK_COLOR = { pass: '#16a34a', fail: '#dc2626', unknown: '#d97706' }
