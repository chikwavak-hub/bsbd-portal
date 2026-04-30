// ════════════════════════════════════════════════════════════════════════════
// INSURANCE FLAG ENGINE
// Generates verification flags for procedures based on carrier rules
// ════════════════════════════════════════════════════════════════════════════

// ── Carrier detection ─────────────────────────────────────────────────────
export function detectCarrierGroup(carrierName) {
  if (!carrierName) return 'unknown'
  const c = carrierName.toUpperCase()
  if (c.includes('DELTA'))                                    return 'delta'
  if (c.includes('BCBS')||c.includes('BLUE CROSS')||c.includes('BLUECROSS')||c.includes('ANTHEM')||c.includes('HIGHMARK')) return 'bcbs'
  if (c.includes('CIGNA'))                                    return 'cigna'
  if (c.includes('UNITED CONCORDIA'))                         return 'concordia'
  if (c.includes('UNITED')||c.includes('UHC'))                return 'united'
  if (c.includes('METLIFE'))                                  return 'metlife'
  if (c.includes('GUARDIAN'))                                 return 'guardian'
  if (c.includes('AETNA'))                                    return 'aetna'
  if (c.includes('HUMANA'))                                   return 'humana'
  if (c.includes('ENVOLVE')||c.includes('AMBETTER')||c.includes('DENTAQUEST')||c.includes('MOLINA')||c.includes('MEDICAID')) return 'medicaid'
  if (c.includes('PRINCIPAL')||c.includes('STANDARD')||c.includes('SUN LIFE')) return 'other'
  return 'unknown'
}

// ── Carrier rules ─────────────────────────────────────────────────────────
const RULES = {
  delta:     { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
  bcbs:      { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
  cigna:     { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:false, postComp:true,  perio4Yr:true,  missingTooth:true  },
  concordia: { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'rarely',    preAuth:true,  postComp:true,  perio4Yr:false, missingTooth:true  },
  united:    { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:false, perio4Yr:true,  missingTooth:true  },
  metlife:   { crownYrs:5,  bwYrs:1, panorYrs:5, fmxYrs:5,  srp2ndYrs:3, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
  guardian:  { crownYrs:5,  bwYrs:2, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
  aetna:     { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
  humana:    { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'rarely',    preAuth:true,  postComp:true,  perio4Yr:false, missingTooth:true  },
  medicaid:  { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'never',     preAuth:true,  postComp:false, perio4Yr:false, missingTooth:false },
  other:     { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
  unknown:   { crownYrs:5,  bwYrs:1, panorYrs:3, fmxYrs:3,  srp2ndYrs:2, implants:'sometimes', preAuth:true,  postComp:true,  perio4Yr:true,  missingTooth:true  },
}

function getRules(carrier) {
  return RULES[detectCarrierGroup(carrier)] || RULES.unknown
}

// ── Flag definitions ──────────────────────────────────────────────────────
// Each flag: { type, question, requiresAuth, requiresDate, severity }
// severity: 'critical' | 'warning' | 'info'

const FLAG_DEFS = {

  // DIAGNOSTIC
  crown_frequency: (r, tooth) => ({
    type: 'frequency', severity: 'critical',
    question: `Crown frequency check — Tooth ${tooth}: Confirm last crown on this tooth was more than ${r.crownYrs} years ago. Date of last crown?`,
    requiresDate: true, requiresAuth: false,
  }),
  crown_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'critical',
    question: 'Crown pre-authorization required — obtain auth number before seating.',
    requiresAuth: true, requiresDate: false,
  } : null,
  crown_buildup_bundle: () => ({
    type: 'benefit', severity: 'warning',
    question: 'Core buildup (D2950) — verify this is a separate benefit from the crown and not bundled by the carrier.',
    requiresAuth: false, requiresDate: false,
  }),
  crown_post_bundle: () => ({
    type: 'benefit', severity: 'warning',
    question: 'Post & core (D2954) — verify this is a separate benefit from the crown and not bundled by the carrier.',
    requiresAuth: false, requiresDate: false,
  }),

  // BITEWINGS
  bw_frequency: (r, tooth) => ({
    type: 'frequency', severity: 'warning',
    question: `Bitewing frequency check: Carrier allows bitewings every ${r.bwYrs} year${r.bwYrs > 1 ? 's' : ''}. Confirm last bitewings were more than ${r.bwYrs} year${r.bwYrs > 1 ? 's' : ''} ago. Date of last?`,
    requiresDate: true, requiresAuth: false,
  }),
  panor_frequency: (r) => ({
    type: 'frequency', severity: 'warning',
    question: `Panoramic frequency check: Carrier allows panoramic every ${r.panorYrs} years. Date of last panoramic?`,
    requiresDate: true, requiresAuth: false,
  }),
  fmx_frequency: (r) => ({
    type: 'frequency', severity: 'warning',
    question: `Full series (FMX) frequency check: Carrier allows FMX every ${r.fmxYrs} years. Date of last full series?`,
    requiresDate: true, requiresAuth: false,
  }),
  cbct_preauth: () => ({
    type: 'preauth', severity: 'critical',
    question: 'Cone Beam CT (D0364) — pre-authorization almost always required. Confirm pre-auth obtained and medical necessity documented.',
    requiresAuth: true, requiresDate: false,
  }),
  d0120_d0180_same: () => ({
    type: 'conflict', severity: 'critical',
    question: 'D0120 (Periodic Eval) and D0180 (Perio Eval) cannot be billed on the same visit. Verify only one was performed and billed.',
    requiresAuth: false, requiresDate: false,
  }),

  // PREVENTIVE
  fluoride_age: () => ({
    type: 'eligibility', severity: 'warning',
    question: 'Fluoride varnish (D1206) — most carriers limit to age 18-19. Confirm patient age meets benefit eligibility.',
    requiresAuth: false, requiresDate: false,
  }),
  sealant_age: () => ({
    type: 'eligibility', severity: 'warning',
    question: 'Sealant (D1351) — most carriers limit to age 14-16 and first/second molars only. Confirm patient age and tooth eligibility. Has this tooth been sealed before?',
    requiresAuth: false, requiresDate: false,
  }),
  prophy_frequency: () => ({
    type: 'frequency', severity: 'info',
    question: 'Prophy frequency: Confirm this is within 2x per benefit year. Date of last cleaning?',
    requiresDate: true, requiresAuth: false,
  }),
  prophy_perio_conflict: () => ({
    type: 'conflict', severity: 'critical',
    question: 'D1110 (Prophy) cannot be billed on the same visit as D4910 (Perio Maintenance). Verify only one was performed.',
    requiresAuth: false, requiresDate: false,
  }),
  ohi_benefit: () => ({
    type: 'benefit', severity: 'info',
    question: 'Oral hygiene instructions (D1330) — some carriers do not cover. Verify patient has this benefit or will pay out of pocket.',
    requiresAuth: false, requiresDate: false,
  }),

  // RESTORATIVE
  posterior_composite_downcode: (r) => r.postComp ? {
    type: 'downcode', severity: 'warning',
    question: 'Posterior composite — carrier may downcode to amalgam reimbursement rate. Patient responsible for difference. Was patient informed and signed financial agreement?',
    requiresAuth: false, requiresDate: false,
  } : null,
  composite_frequency: (tooth) => ({
    type: 'frequency', severity: 'warning',
    question: `Composite frequency check — Tooth ${tooth}: Confirm no restoration billed on the same tooth and surface within the past 2 years.`,
    requiresDate: true, requiresAuth: false,
  }),
  hydroxyapatite_coverage: () => ({
    type: 'benefit', severity: 'critical',
    question: 'Hydroxyapatite (D2991) — most carriers do not cover this. Confirm patient was informed this is out-of-pocket and signed financial agreement.',
    requiresAuth: false, requiresDate: false,
  }),

  // ENDODONTICS
  rct_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'warning',
    question: 'Root canal — some carriers require pre-authorization. Confirm pre-auth status for this carrier.',
    requiresAuth: true, requiresDate: false,
  } : null,
  rct_frequency: (tooth) => ({
    type: 'frequency', severity: 'critical',
    question: `Root canal frequency — Tooth ${tooth}: Is this a retreatment? If so, confirm prior RCT date and that retreatment is a covered benefit.`,
    requiresDate: true, requiresAuth: false,
  }),
  rct_crown_timing: () => ({
    type: 'timing', severity: 'warning',
    question: 'Root canal and crown on same day — some carriers require separate dates of service. Confirm carrier policy. Were RCT and crown on same visit?',
    requiresAuth: false, requiresDate: false,
  }),
  canal_obstruction_necessity: () => ({
    type: 'benefit', severity: 'warning',
    question: 'D3331 (Canal Obstruction Treatment) — medical necessity must be documented with separate radiographic evidence. Confirmed?',
    requiresAuth: false, requiresDate: false,
  }),

  // PERIODONTICS
  srp_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'critical',
    question: 'Scaling & Root Planing — pre-authorization required by most carriers. Confirm pre-auth number obtained before appointment.',
    requiresAuth: true, requiresDate: false,
  } : null,
  srp_charting: () => ({
    type: 'documentation', severity: 'critical',
    question: 'Scaling & Root Planing — full perio charting (6-point probing) must be on file. Confirmed charting documented?',
    requiresAuth: false, requiresDate: false,
  }),
  srp_frequency: (r, tooth) => ({
    type: 'frequency', severity: 'critical',
    question: `SRP frequency — Quadrant ${tooth}: Most carriers limit SRP to once per quadrant every ${r.srp2ndYrs} years. Date of last SRP on this quadrant?`,
    requiresDate: true, requiresAuth: false,
  }),
  perio_maint_frequency: (r) => ({
    type: 'frequency', severity: 'warning',
    question: `Perio Maintenance (D4910) frequency: Carrier allows up to ${r.perio4Yr ? '4' : '3'} per year. How many D4910 billed this benefit year?`,
    requiresDate: false, requiresAuth: false,
  }),
  perio_maint_prophy_conflict: () => ({
    type: 'conflict', severity: 'critical',
    question: 'D4910 (Perio Maintenance) cannot be billed with D1110 (Prophy) on same visit. Verify only one was performed.',
    requiresAuth: false, requiresDate: false,
  }),
  scaling_inflammation_benefit: () => ({
    type: 'benefit', severity: 'warning',
    question: 'D4346 (Scaling - Gingival Inflammation) — not covered by all carriers. Verify patient has this benefit or confirm patient responsibility.',
    requiresAuth: false, requiresDate: false,
  }),
  gingival_irrigation_coverage: () => ({
    type: 'benefit', severity: 'warning',
    question: 'Gingival Irrigation (D4921) — most carriers do not cover. Confirm patient was informed and signed financial agreement.',
    requiresAuth: false, requiresDate: false,
  }),
  fmd_conflict: () => ({
    type: 'conflict', severity: 'critical',
    question: 'Full Mouth Debridement (D4355) cannot be billed with prophy or SRP on same visit. Verify only D4355 was billed.',
    requiresAuth: false, requiresDate: false,
  }),

  // PROSTHODONTICS
  denture_missing_tooth: () => ({
    type: 'missing_tooth', severity: 'critical',
    question: 'Denture — Missing Tooth Clause: Were any teeth to be replaced by this denture extracted BEFORE the patient had coverage with this carrier? If yes, those teeth may not be covered.',
    requiresAuth: false, requiresDate: true,
  }),
  denture_frequency: (r) => ({
    type: 'frequency', severity: 'critical',
    question: `Denture frequency: Most carriers allow one denture per arch every ${r.crownYrs} years. Date of last denture?`,
    requiresDate: true, requiresAuth: false,
  }),
  denture_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'critical',
    question: 'Denture — pre-authorization required. Confirm pre-auth number obtained.',
    requiresAuth: true, requiresDate: false,
  } : null,
  partial_missing_tooth: () => ({
    type: 'missing_tooth', severity: 'critical',
    question: 'Partial Denture — Missing Tooth Clause: Were any teeth being replaced extracted before coverage began? Confirm effective date of coverage.',
    requiresAuth: false, requiresDate: true,
  }),

  // IMPLANTS
  implant_coverage: (r) => ({
    type: 'benefit', severity: 'critical',
    question: `Implant coverage: This carrier ${r.implants === 'never' ? 'does NOT cover implants' : r.implants === 'rarely' ? 'rarely covers implants — verify benefit explicitly' : 'may cover implants — verify benefit exists in plan'}. Confirmed?`,
    requiresAuth: false, requiresDate: false,
  }),
  implant_missing_tooth: () => ({
    type: 'missing_tooth', severity: 'critical',
    question: 'Implant — Missing Tooth Clause: Was the tooth being replaced with this implant extracted BEFORE coverage began with this carrier? If yes, implant may be excluded.',
    requiresAuth: false, requiresDate: true,
  }),
  implant_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'critical',
    question: 'Implant — pre-authorization almost always required. Confirm pre-auth number obtained before surgery.',
    requiresAuth: true, requiresDate: false,
  } : null,
  implant_waiting: () => ({
    type: 'eligibility', severity: 'warning',
    question: 'Implant waiting period — some carriers have 12-24 month waiting period for major services. Confirm patient has met waiting period.',
    requiresDate: true, requiresAuth: false,
  }),
  implant_annual_max: () => ({
    type: 'benefit', severity: 'warning',
    question: 'Annual maximum — will this implant procedure exhaust the patient\'s remaining annual benefit? Verify remaining maximum before proceeding.',
    requiresAuth: false, requiresDate: false,
  }),

  // ORAL SURGERY
  extraction_missing_tooth_trigger: () => ({
    type: 'missing_tooth', severity: 'warning',
    question: 'Extraction — if this tooth will be replaced with a bridge or implant, a Missing Tooth Clause may apply for future prosthetic claims. Document extraction date for future reference.',
    requiresAuth: false, requiresDate: false,
  }),
  surgical_ext_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'warning',
    question: 'Surgical extraction (D7210) — some carriers require pre-auth. Confirm pre-auth status.',
    requiresAuth: true, requiresDate: false,
  } : null,
  impaction_preauth: (r) => r.preAuth ? {
    type: 'preauth', severity: 'critical',
    question: 'Impacted tooth removal — pre-authorization required. Confirm pre-auth number and medical necessity documented.',
    requiresAuth: true, requiresDate: false,
  } : null,

  // ORTHODONTICS
  ortho_lifetime_max: () => ({
    type: 'benefit', severity: 'critical',
    question: 'Orthodontics — lifetime maximum applies. Verify remaining lifetime ortho benefit amount with carrier. How much has been used?',
    requiresAuth: false, requiresDate: false,
  }),
  ortho_age_limit: () => ({
    type: 'eligibility', severity: 'critical',
    question: 'Orthodontics — age limit applies. Confirm patient meets carrier age requirement for ortho benefit (adult vs child rate).',
    requiresAuth: false, requiresDate: false,
  }),
  ortho_waiting: () => ({
    type: 'eligibility', severity: 'warning',
    question: 'Orthodontics — confirm waiting period has been met. Some carriers have 12-24 month wait for ortho coverage.',
    requiresDate: true, requiresAuth: false,
  }),

  // ADJUNCTIVE
  nitrous_coverage: () => ({
    type: 'benefit', severity: 'warning',
    question: 'Nitrous Oxide (D9230) — not covered by many carriers. Confirm patient has this benefit or confirm patient responsibility.',
    requiresAuth: false, requiresDate: false,
  }),
  sedation_preauth: () => ({
    type: 'preauth', severity: 'critical',
    question: 'Sedation (D9241/D9248) — pre-authorization required. Confirm pre-auth number and diagnosis code documented.',
    requiresAuth: true, requiresDate: false,
  }),
  office_visit_benefit: () => ({
    type: 'benefit', severity: 'info',
    question: 'Office visit (D9430) — some carriers only cover when treatment is performed same day. Confirm benefit if visit only.',
    requiresAuth: false, requiresDate: false,
  }),
  guard_frequency: (r) => ({
    type: 'frequency', severity: 'warning',
    question: `Occlusal guard frequency: Most carriers allow once per ${r.crownYrs} years. Date of last guard?`,
    requiresDate: true, requiresAuth: false,
  }),
  bleaching_coverage: () => ({
    type: 'benefit', severity: 'info',
    question: 'Bleaching (D9972/D9973) — most carriers do not cover whitening. Confirm patient was informed this is cosmetic and out-of-pocket.',
    requiresAuth: false, requiresDate: false,
  }),
  desensitizer_bundle: () => ({
    type: 'benefit', severity: 'info',
    question: 'Desensitizing medicament (D9910) — some carriers bundle with restorations. Verify separate benefit exists.',
    requiresAuth: false, requiresDate: false,
  }),
  consultation_benefit: () => ({
    type: 'benefit', severity: 'info',
    question: 'Consultation (D9310) — not covered by all carriers. Verify patient has consultation benefit.',
    requiresAuth: false, requiresDate: false,
  }),
}

// ── Main flag generator ────────────────────────────────────────────────────
// Given a patient's treatments and carrier, returns an array of flags
export function generateFlags(treatments, carrier) {
  if (!treatments || treatments.length === 0) return []
  const r     = getRules(carrier)
  const flags = []
  const codes = treatments.map(t => t.code)
  const hasCode = (...cc) => cc.some(c => codes.includes(c))

  const addFlag = (flagFn, tooth, code, args) => {
    const def = flagFn(...(args || []))
    if (!def) return
    flags.push({
      id:             `${code}_${tooth || 'gen'}_${def.type}`,
      procedure_code: code,
      tooth:          tooth || '',
      flag_type:      def.type,
      flag_question:  def.question,
      requires_auth:  def.requiresAuth || false,
      requires_date:  def.requiresDate || false,
      severity:       def.severity || 'warning',
    })
  }

  for (const t of treatments) {
    const code  = t.code
    const tooth = t.tooth || ''

    // DIAGNOSTIC
    if (code === 'D0364')                           addFlag(FLAG_DEFS.cbct_preauth, tooth, code, [])
    if (['D0272','D0274'].includes(code))           addFlag(FLAG_DEFS.bw_frequency, tooth, code, [r, tooth])
    if (code === 'D0330')                           addFlag(FLAG_DEFS.panor_frequency, tooth, code, [r])
    if (code === 'D0210')                           addFlag(FLAG_DEFS.fmx_frequency, tooth, code, [r])

    // PREVENTIVE
    if (['D1110','D1120'].includes(code)) {
                                                    addFlag(FLAG_DEFS.prophy_frequency, tooth, code, [])
      if (hasCode('D4910'))                         addFlag(FLAG_DEFS.prophy_perio_conflict, tooth, code, [])
    }
    if (code === 'D1206')                           addFlag(FLAG_DEFS.fluoride_age, tooth, code, [])
    if (code === 'D1351')                           addFlag(FLAG_DEFS.sealant_age, tooth, code, [])
    if (code === 'D1330')                           addFlag(FLAG_DEFS.ohi_benefit, tooth, code, [])

    // RESTORATIVE
    if (['D2330','D2331','D2332','D2335','D2391','D2392','D2393','D2394'].includes(code))
                                                    addFlag(FLAG_DEFS.composite_frequency, tooth, code, [tooth])
    if (['D2391','D2392','D2393','D2394'].includes(code))
                                                    addFlag(FLAG_DEFS.posterior_composite_downcode, tooth, code, [r])
    if (['D2740','D2750','D2751','D2752','D2780','D2790'].includes(code)) {
                                                    addFlag(FLAG_DEFS.crown_frequency, tooth, code, [r, tooth])
                                                    addFlag(FLAG_DEFS.crown_preauth, tooth, code, [r])
      if (hasCode('D2950'))                         addFlag(FLAG_DEFS.crown_buildup_bundle, tooth, code, [])
      if (hasCode('D2954'))                         addFlag(FLAG_DEFS.crown_post_bundle, tooth, code, [])
    }
    if (code === 'D2991')                           addFlag(FLAG_DEFS.hydroxyapatite_coverage, tooth, code, [])

    // ENDODONTICS
    if (['D3310','D3320','D3330'].includes(code)) {
                                                    addFlag(FLAG_DEFS.rct_preauth, tooth, code, [r])
                                                    addFlag(FLAG_DEFS.rct_frequency, tooth, code, [tooth])
      if (hasCode('D2740','D2750','D2751','D2752')) addFlag(FLAG_DEFS.rct_crown_timing, tooth, code, [])
    }
    if (code === 'D3331')                           addFlag(FLAG_DEFS.canal_obstruction_necessity, tooth, code, [])

    // PERIODONTICS
    if (['D4341','D4342'].includes(code)) {
                                                    addFlag(FLAG_DEFS.srp_preauth, tooth, code, [r])
                                                    addFlag(FLAG_DEFS.srp_charting, tooth, code, [])
                                                    addFlag(FLAG_DEFS.srp_frequency, tooth, code, [r, tooth])
    }
    if (code === 'D4910') {
                                                    addFlag(FLAG_DEFS.perio_maint_frequency, tooth, code, [r])
      if (hasCode('D1110','D1120'))                 addFlag(FLAG_DEFS.perio_maint_prophy_conflict, tooth, code, [])
    }
    if (code === 'D4346')                           addFlag(FLAG_DEFS.scaling_inflammation_benefit, tooth, code, [])
    if (code === 'D4921')                           addFlag(FLAG_DEFS.gingival_irrigation_coverage, tooth, code, [])
    if (code === 'D4355')                           addFlag(FLAG_DEFS.fmd_conflict, tooth, code, [])

    // PROSTHODONTICS
    if (['D5110','D5120','D5130','D5140'].includes(code)) {
                                                    addFlag(FLAG_DEFS.denture_missing_tooth, tooth, code, [])
                                                    addFlag(FLAG_DEFS.denture_frequency, tooth, code, [r])
                                                    addFlag(FLAG_DEFS.denture_preauth, tooth, code, [r])
    }
    if (['D5211','D5212','D5213','D5214'].includes(code)) {
                                                    addFlag(FLAG_DEFS.partial_missing_tooth, tooth, code, [])
                                                    addFlag(FLAG_DEFS.denture_preauth, tooth, code, [r])
    }

    // IMPLANTS
    if (['D6010','D6012','D6013'].includes(code)) {
                                                    addFlag(FLAG_DEFS.implant_coverage, tooth, code, [r])
                                                    addFlag(FLAG_DEFS.implant_missing_tooth, tooth, code, [])
                                                    addFlag(FLAG_DEFS.implant_preauth, tooth, code, [r])
                                                    addFlag(FLAG_DEFS.implant_waiting, tooth, code, [])
                                                    addFlag(FLAG_DEFS.implant_annual_max, tooth, code, [])
    }

    // ORAL SURGERY
    if (code === 'D7140')                           addFlag(FLAG_DEFS.extraction_missing_tooth_trigger, tooth, code, [])
    if (code === 'D7210')                           addFlag(FLAG_DEFS.surgical_ext_preauth, tooth, code, [r])
    if (['D7220','D7230','D7240'].includes(code))   addFlag(FLAG_DEFS.impaction_preauth, tooth, code, [r])

    // ORTHODONTICS
    if (['D8060','D8070'].includes(code)) {
                                                    addFlag(FLAG_DEFS.ortho_lifetime_max, tooth, code, [])
                                                    addFlag(FLAG_DEFS.ortho_age_limit, tooth, code, [])
                                                    addFlag(FLAG_DEFS.ortho_waiting, tooth, code, [])
    }

    // ADJUNCTIVE
    if (code === 'D9230')                           addFlag(FLAG_DEFS.nitrous_coverage, tooth, code, [])
    if (['D9241','D9248'].includes(code))           addFlag(FLAG_DEFS.sedation_preauth, tooth, code, [])
    if (code === 'D9310')                           addFlag(FLAG_DEFS.consultation_benefit, tooth, code, [])
    if (code === 'D9430')                           addFlag(FLAG_DEFS.office_visit_benefit, tooth, code, [])
    if (['D9944','D9945','D9946'].includes(code))   addFlag(FLAG_DEFS.guard_frequency, tooth, code, [r])
    if (['D9972','D9973','D9974','D9975'].includes(code)) addFlag(FLAG_DEFS.bleaching_coverage, tooth, code, [])
    if (code === 'D9910')                           addFlag(FLAG_DEFS.desensitizer_bundle, tooth, code, [])
  }

  // CROSS-PROCEDURE FLAGS
  if (hasCode('D0120') && hasCode('D0180'))         addFlag(FLAG_DEFS.d0120_d0180_same, '', 'CONFLICT_EVAL', [])

  // Deduplicate by flag id
  const seen = new Set()
  return flags.filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true })
}

// Severity order for sorting
export const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 }
export const SEVERITY_COLOR = { critical: '#dc2626', warning: '#d97706', info: '#0891b2' }
export const SEVERITY_BG    = { critical: '#fef2f2', warning: '#fffbeb', info: '#e0f2fe' }
export const SEVERITY_BORDER= { critical: '#fecaca', warning: '#fde68a', info: '#bae6fd' }
export const FLAG_TYPE_LABEL = {
  preauth: 'Pre-Auth Required', frequency: 'Frequency Check',
  missing_tooth: 'Missing Tooth Clause', benefit: 'Benefit Verification',
  eligibility: 'Eligibility Check', conflict: 'Billing Conflict',
  downcode: 'Downcode Risk', documentation: 'Documentation Required',
  timing: 'Timing Issue',
}
