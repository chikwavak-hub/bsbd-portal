// Ortho Diagnostic Record + TMJ Consultation — one schema drives both the entry screen and the printout.
//
// PHI RULE: any field with phi:true lives only in the open editor's memory. It is NEVER sent to Supabase.
// Saved records carry chart # + clinical data only.
//
// Item types
//   row      { fields:[{k,l,f,phi}] }                        lined text fields, label under the line
//   opts     { l, k, o:[...], multi, after:[parts] }          label + tap-to-select options
//   inline   { l, parts:[ 'text' | {k,w,u,phi} | {k,o,multi} ] } free mix of text, short blanks, options
//   q        { l, k, o, after:[parts] }                       question row with options on the right
//   yn       { items:[[k,label],...] }                        Y / N list
//   cols     { tmpl, cols:[[items],[items]] }                 side-by-side columns of items
//   quads    { items:[[k,label]] }                            Palmer quadrant cross (UR / UL / LR / LL)
//   datelist { cols:[[[k,label],...], ...] }                  checkbox + date
//   lines    { k, l, n }                                      multi-line notes
//   scale    { k, l, sub }                                    0–10 pain scale
//   ceph | harvRef | palp | rom | teeth{k,set} | sig{fields} | note{text} | sub{text}

const YN = (pairs) => ({ t: 'yn', items: pairs });

// ---------------- shared sections ----------------
const TMJ_PAIN_L = [
  ['tq_headaches', 'Do you get headaches?'], ['tq_migraines', 'Do you get migraine headaches?'],
  ['tq_neck', 'Do you frequently have neck aches or stiff neck muscles?'],
  ['tq_shoulder', 'Have you ever had chronic shoulder or back pain?'],
  ['tq_sleep', 'Do you have trouble sleeping soundly?'], ['tq_jaw_tired_am', 'Are your jaws tired when you wake up?'],
  ['tq_teeth_sore_am', 'Are your teeth sore when you wake up?'], ['tq_wisdom', 'Have your wisdom teeth been extracted?'],
];
const TMJ_PAIN_R = [
  ['tq_temple_ha', 'Do you get headaches in the right or left temple areas?'],
  ['tq_frontback_ha', 'Do you get headaches in the front or back of your head?'],
  ['tq_clench_day', 'Do you clench your teeth during the day?'], ['tq_clench_night', 'Do you clench your teeth at night?'],
  ['tq_grind', 'Do you grind your teeth when asleep?'],
];

export const TMJ_QUESTIONNAIRE = (withChief) => [
  ...(withChief ? [{ title: null, items: [{ t: 'row', fields: [{ k: 'chief_concern', l: 'Chief Concern', f: 3 }, { k: 'onset', l: 'Date of Onset', f: 1 }] }] }] : []),
  {
    title: 'Pain Symptoms', items: [
      { t: 'cols', cols: [[YN(TMJ_PAIN_L)], [YN(TMJ_PAIN_R),
        { t: 'lines', k: 'tq_worst', l: 'When are your pain symptoms the worst?', n: 1 },
        { t: 'lines', k: 'tq_better', l: 'Does anything make you feel better?', n: 1 }]] },
      { t: 'cols', cols: [[{ t: 'lines', k: 'tq_meds', l: 'What medications, if any, are you taking?', n: 1 }],
        [{ t: 'lines', k: 'tq_pain_med_freq', l: 'How often do you take medication for pain relief?', n: 1 }]] },
    ],
  },
  {
    title: 'Trauma or Accidents', items: [
      { t: 'cols', cols: [[YN([['tq_blow', 'Have you ever had a severe blow to the head or jaw?'], ['tq_whiplash', 'Any whiplash neck injuries?']])],
        [YN([['tq_accident', 'Have you ever been in a serious accident, such as a car accident?']]),
          { t: 'inline', parts: ['Details', { k: 'tq_accident_details', w: 'flex' }] }]] },
    ],
  },
  {
    title: 'Jaw Joint Symptoms', items: [
      { t: 'cols', cols: [[YN([['tq_tired_meal', 'Does your jaw feel tired after a big meal?'], ['tq_avoid_foods', 'Are there any foods you avoid eating?'],
        ['tq_dizzy', 'Do you ever get dizzy?'], ['tq_faint', 'Do you ever feel faint?'], ['tq_nausea', 'Do you ever feel nauseated?'],
        ['tq_family_tmj', 'Is there a family history of jaw joint (TMJ) problems or headaches?']])],
        [YN([['tq_clicking', 'Do you feel or hear clicking, popping, or cracking from either jaw joint?'],
          ['tq_locked', 'Has your jaw ever locked so you could not open or close?'], ['tq_open_wide', 'Do you have difficulty opening wide or yawning?'],
          ['tq_joint_pain', 'Have you ever had pain in either jaw joint?'], ['tq_ache_open', 'Does your jaw ache when you open wide?']])]] },
    ],
  },
  {
    title: 'Ear & Eye Symptoms', items: [
      { t: 'cols', cols: [[YN([['tq_ear_pain', 'Do you have pain in either ear?'], ['tq_hearing', 'Do you have any hearing loss?'],
        ['tq_ear_stuffy', 'Do you have itchiness or stuffiness in either ear?'], ['tq_tinnitus', 'Do you hear ringing, buzzing, or hissing in either ear?']])],
        [YN([['tq_glasses', 'Do you wear glasses or contacts?'], ['tq_blur', 'Are there times when your eyesight blurs?'],
          ['tq_eye_pain', 'Do you get pain in, around, or behind either eye?']])]] },
    ],
  },
  {
    title: 'Breathing & Sleep', items: [
      { t: 'cols', cols: [[YN([['tq_allergies', 'Do you have allergies?'], ['tq_sinus', 'Do you have sinus problems?'], ['tq_snore', 'Do you snore at night?']])],
        [YN([['tq_nose_stuffed', "Is your nose stuffed when you don't have a cold?"], ['tq_apnea', 'Have you been diagnosed with sleep apnea?'],
          ['tq_sleep_study', 'Have you had a sleep study at a sleep clinic or hospital?']])]] },
      { t: 'sig', fields: ['Patient Signature', 'Date'] },
    ],
  },
];

// Stage tables: one row per measurement, one column per exam (Initial / Progress / Final).
// Initial keeps the original key so charts saved before this change still read correctly.
export const EXAM_STAGES = [['i', 'Initial'], ['p', 'Progress'], ['f', 'Final']];
export const stageKey = (k, st) => (st === 'i' ? k : `${k}_${st}`);

const LR = ['None', 'Left', 'Right', 'Both'];
export const TMJ_EXAM = (standalone) => [
  {
    title: 'Range of Motion Measurements', sub: 'Record at the start, during treatment, and at the final exam', items: [
      { t: 'stagetable', dateKey: 'rom_date', rows: [
        { l: 'Overbite (OB)', k: 'rom_ob', u: 'mm', hint: standalone ? '' : 'from Clinical Findings' },
        { l: 'Overjet (OJ)', k: 'rom_oj', u: 'mm' },
        { l: 'Mandibular midline shift', k: 'rom_midline', u: 'mm' },
        { l: 'Midline shift direction', k: 'rom_midline_dir', o: ['Right', 'Left', 'None'] },
        { l: 'Maximum opening', k: 'rom_max_open', u: 'mm', strong: true },
        { l: '± OB', k: 'rom_max_open_ob', u: 'mm' },
        { l: 'Corrected opening (max ± OB)', k: 'rom_max_open_total', u: 'mm', strong: true },
        { l: 'Right lateral movement', k: 'rom_r_lat', u: 'mm' },
        { l: 'Left lateral movement', k: 'rom_l_lat', u: 'mm' },
        { l: 'Protrusive movement', k: 'rom_protrusive', u: 'mm' },
        { l: '± OJ', k: 'rom_protrusive_oj', u: 'mm' },
        { l: 'Corrected protrusive (± OJ)', k: 'rom_protrusive_total', u: 'mm', strong: true },
        { l: 'Deviation / deflection on opening', k: 'rom_deviation', o: ['Right', 'Left', 'None'] },
      ] },
      { t: 'rom' },
    ],
  },
  {
    title: 'Joint Palpation', sub: 'None · Left · Right · Both', items: [
      { t: 'stagetable', dateKey: 'rom_date', noDate: true, rows: [
        { l: 'Pain', k: 'jp_pain', o: LR }, { l: 'Clicking', k: 'jp_click', o: LR },
        { l: 'Crepitus', k: 'jp_crep', o: LR }, { l: 'Popping', k: 'jp_pop', o: LR },
      ] },
    ],
  },
];

export const MUSCLES_EXTRA = ['Posterior TMJ', 'Vertex', 'Sinus', 'Occipital', 'Splenius Capitis', 'Superior Trapezius', 'Trapezius',
  'Anterior Digastric', 'Posterior Digastric', 'Sternocleidomastoid', 'Anterior Temporalis', 'Medial Temporalis',
  'Posterior Temporalis', 'Superficial Masseter', 'Deep Masseter'];
export const MUSCLES_INTRA = ['Masseter Body', 'Lateral Pterygoid', 'Medial Pterygoid'];
export const PALP_STAGES = [['i', 'Initial'], ['u', 'Update'], ['f', 'Final']];
export const muscleKey = (m) => m.toLowerCase().replace(/[^a-z]+/g, '_');

const PALPATION = [{
  title: 'Muscle Palpation', sub: 'Score each site · 0 = No pain · 1 = Uncomfortable · 2 = Pain · 3 = Severe pain',
  items: [{ t: 'palp' }, { t: 'lines', k: 'palp_notes', l: 'Palpation notes', n: 2 }],
}];

// ---------------- ortho-only pages ----------------
const RECORDS = [
  {
    title: 'Initial Records Checklist', sub: 'Office use', items: [
      { t: 'datelist', cols: [
        [['rec_clinical', 'Clinical Exam'], ['rec_medhx', 'Medical History'], ['rec_tmj_exam', 'TMJ Exam'], ['rec_tmj_q', 'TMJ Questionnaire']],
        [['rec_cervical', 'Cervical X-Ray'], ['rec_ceph', 'Cephalometric X-Ray'], ['rec_pano', 'Panoramic X-Ray'], ['rec_tmj_xr', 'TM Joint X-Rays'], ['rec_sinus', 'Paranasal Sinus X-Ray']],
        [['rec_models', 'Study Models'], ['rec_jva', 'JVA'], ['rec_photos', 'Photos'], ['rec_cbct', 'CBCT / Other']]] },
    ],
  },
  {
    title: 'Consultation & Consent Tracking', sub: 'Office use', items: [
      { t: 'inline', l: 'Initial Consultation', parts: ['Date', { k: 'cc_init_date', w: 110 }, 'In attendance', { k: 'cc_init_att', w: 'flex' }] },
      { t: 'inline', l: 'Final Consultation', parts: ['Date', { k: 'cc_final_date', w: 110 }, 'In attendance', { k: 'cc_final_att', w: 'flex' }] },
      { t: 'inline', l: 'Informed Consent', parts: ['Date reviewed', { k: 'cc_consent_date', w: 90 }, 'Signed', { k: 'cc_consent_signed', w: 'flex' }] },
      { t: 'inline', l: 'Treatment Agreement', parts: ['Phase I date', { k: 'cc_ph1', w: 90 }, 'Phase II date', { k: 'cc_ph2', w: 'flex' }] },
      { t: 'inline', l: 'Insurance Letter', parts: [{ k: 'cc_ins_letter', o: ['Y', 'N'] }, 'Written', { k: 'cc_ins_written', w: 90 }, 'Reply', { k: 'cc_ins_reply', w: 'flex' }] },
    ],
  },
  {
    title: 'Reason for Evaluation', sub: 'Check all that apply', items: [
      { t: 'opts', k: 'reasons', multi: true, grid: 3, o: ['Crowding', 'Overbite', "Don't like my smile", 'Appearance', 'Better function',
        'Airway assessment', 'Teasing at school', 'My dentist found the problem', "I / We don't see a problem"] },
      { t: 'q', l: 'Any habits?', k: 'habits_any', o: ['Yes', 'No'], after: [{ k: 'habits', o: ['Thumb sucking', 'Tongue habit', 'Mouth breathing'], multi: true }] },
      { t: 'lines', k: 'reason_other', l: 'Any other reason?', n: 2 },
    ],
  },
  {
    title: 'General Health', items: [
      { t: 'q', l: 'General health', k: 'gen_health', o: ['Good', 'Fair', 'Poor'] },
      { t: 'q', l: "Under a physician's care", k: 'under_tx', o: ['Yes', 'No'], after: ['Specify', { k: 'under_tx_spec', w: 'flex' }] },
      { t: 'q', l: 'Drugs or medications', k: 'meds', o: ['Yes', 'No'], after: ['Specify', { k: 'meds_spec', w: 'flex' }] },
    ],
  },
];

const MED_L = ['Arthritis', 'Allergies', 'Artificial Joints', 'Anemia', 'Arteriosclerosis', 'Asthma', 'AIDS / HIV', 'Birth Defects',
  'Blood Disorders', 'Bruises Easily', 'Cancer', 'Cosmetic Surgery', 'Congenital Heart Defects', 'Diabetes', 'Dizziness',
  'Emotional Problems', 'Epilepsy', 'Emphysema', 'Fainting', 'Fever or Sun Blisters', 'Glaucoma', 'Hay Fever', 'Herpes', 'Head or Face Injury'];
const MED_R = ['Heart Attack or Stroke', 'Heart Murmur', 'Heart Surgery / Pacemaker', 'Hearing Disorders', 'Hepatitis', 'High / Low Blood Sugar',
  'History of Substance Abuse', 'Hypertension (High BP)', 'Hypotension (Low BP)', 'Intestinal Disorders', 'Kidney Problems', 'Liver Problems',
  'Mitral Valve Prolapse', 'Nervous Disorder', 'Numbness of Arms / Hands', 'Pneumonia', 'Psychiatric Treatment', 'Ulcers', 'Rheumatic Fever',
  'Swollen, Stiff, Painful Joints', 'Scarlet Fever', 'Shortness of Breath', 'Sinus Problems', 'Thyroid Problems'];
const mk = (s) => 'mh_' + s.toLowerCase().replace(/[^a-z]+/g, '_');

const MEDICAL = [
  {
    title: 'Medical History', sub: 'Has the patient ever had any of the following?', items: [
      { t: 'cols', cols: [[YN(MED_L.map((x) => [mk(x), x]))], [YN(MED_R.map((x) => [mk(x), x]))]] },
      { t: 'inline', parts: [{ b: 'Other conditions not listed:' }, { k: 'mh_other', w: 'flex' }] },
    ],
  },
  {
    title: 'Ear, Nose & Throat', items: [
      { t: 'q', l: 'Have the tonsils or adenoids been removed?', k: 'ent_tonsils', o: ['Yes', 'No'], after: ['At what age?', { k: 'ent_tonsils_age', w: 40 }] },
      { t: 'q', l: 'Does the patient have a tendency for colds?', k: 'ent_colds', o: ['Yes', 'No'] },
      { t: 'q', l: 'Sore throats?', k: 'ent_throat', o: ['Yes', 'No'] },
      { t: 'q', l: 'Ear infections?', k: 'ent_ears', o: ['Yes', 'No'] },
      { t: 'q', l: 'Has the patient ever had tubes in their ears?', k: 'ent_tubes', o: ['Yes', 'No'], after: ['At what age?', { k: 'ent_tubes_age', w: 40 }] },
    ],
  },
  {
    title: 'Dental History', items: [
      { t: 'q', l: 'Has the patient ever sucked their thumb or finger?', k: 'dh_thumb', o: ['Yes', 'No'], after: ['Until what age?', { k: 'dh_thumb_age', w: 40 }] },
      { t: 'q', l: 'Does the patient have any speech problems?', k: 'dh_speech', o: ['Yes', 'No'] },
      { t: 'q', l: 'Does the patient breathe through the mouth?', k: 'dh_mouth_breath', o: ['Day', 'Night', 'No'], multi: true },
      { t: 'q', l: 'Has either parent had previous orthodontic treatment?', k: 'dh_parent_ortho', o: ['Yes', 'No'] },
      { t: 'q', l: 'Have you consulted an orthodontist or another dentist about an orthodontic, TMJ, or sleep-disordered breathing problem?', k: 'dh_prior_consult', o: ['Yes', 'No'] },
      { t: 'note', text: "I certify that the information above is accurate to the best of my knowledge. I will tell the practice about any change in the patient's health or medications." },
      { t: 'sig', fields: ['Patient / Guardian Signature', 'Date'] },
    ],
  },
];

const FINDINGS_1 = [
  {
    title: 'Occlusion', sub: 'Mark R / L where applicable', items: [
      { t: 'cols', cols: [
        [{ t: 'inline', l: 'Molar Relationship', parts: ['R', { k: 'occ_molar_r', w: 45 }, 'L', { k: 'occ_molar_l', w: 45 }] },
          { t: 'inline', parts: [{ b: 'Overjet' }, { k: 'occ_oj_mm', w: 34, u: 'mm' }, { k: 'occ_oj', o: ['Large', 'Moderate', 'Normal', 'Negative'] }] }],
        [{ t: 'inline', l: 'Cuspid Relationship', parts: ['R', { k: 'occ_cuspid_r', w: 45 }, 'L', { k: 'occ_cuspid_l', w: 45 }] },
          { t: 'inline', parts: [{ b: 'Overbite' }, { k: 'occ_ob_mm', w: 34, u: 'mm' }, { k: 'occ_ob', o: ['Palatal', 'Deep', 'Normal', 'Open'] }] }]] },
      { t: 'quads', items: [['q_crossbite', 'Crossbite'], ['q_crowding', 'Crowding'], ['q_damaged', 'Damaged'], ['q_recession', 'Recession'],
        ['q_protrusions', 'Protrusions'], ['q_spacing', 'Spacing'], ['q_marked', 'Marked'], ['q_abfractions', 'Abfractions'],
        ['q_attrition', 'Attrition'], ['q_diastema', 'Diastema'], ['q_malformed', 'Malformed'], ['q_rotations', 'Rotations'],
        ['q_missing', 'Missing'], ['q_devitalized', 'Devitalized'], ['q_impacted', 'Impacted'], ['q_ectopic', 'Ectopic'],
        ['q_supernumerary', 'Supernumerary'], ['q_ankylosed', 'Ankylosed']] },
    ],
  },
  {
    title: 'Teeth & Soft Tissue', items: [
      { t: 'opts', l: 'Size of Teeth — Anterior', k: 'size_ant', o: ['Small', 'Normal', 'Large'] },
      { t: 'opts', l: 'Size of Teeth — Posterior', k: 'size_post', o: ['Small', 'Normal', 'Large'] },
      { t: 'inline', l: 'Incisor Length', parts: ['MX', { k: 'inc_mx', w: 34, u: 'mm' }, 'MD', { k: 'inc_md', w: 34, u: 'mm' }, 'CEJ to CEJ', { k: 'inc_cej', w: 34, u: 'mm' }] },
      { t: 'opts', l: 'Labial Frenum', k: 'frenum', o: ['Normal', 'Heavy'], after: [{ b: 'Frenectomy indicated' }, { k: 'frenectomy', o: ['Yes', 'No'] }] },
      { t: 'opts', l: 'Tonsils', k: 'tonsils', o: ['Enlarged', 'Inflamed', 'Normal', 'Removed'], multi: true, after: ['Grade R', { k: 'tonsil_r', w: 24 }, 'L', { k: 'tonsil_l', w: 24 }] },
      { t: 'opts', l: 'Adenoids', k: 'adenoids', o: ['Normal', 'Enlarged', 'Removed'], after: ['Ceph measurement', { k: 'adenoid_ceph', w: 34, u: 'mm' }] },
      { t: 'opts', l: 'Rate of Existing Restorations', k: 'restorations', o: ['High', 'Moderate', 'Low'] },
      { t: 'opts', l: 'Curve of Spee', k: 'spee', o: ['Excessive', 'Moderate', 'Slight', 'Flat'] },
    ],
  },
  {
    title: 'Midlines, Arch Length & Arch Form', items: [
      ...['dental', 'skeletal'].flatMap((g) => ['mx', 'md'].map((j) => ({
        t: 'inline', l: `${g === 'dental' ? 'Dental' : 'Skeletal'} Midline — ${j === 'mx' ? 'Maxillary' : 'Mandibular'}`,
        parts: [{ k: `mid_${g}_${j}`, o: ['Shifted L', 'Normal', 'Shifted R'] }, { k: `mid_${g}_${j}_mm`, w: 34, u: 'mm' }],
      }))),
      { t: 'opts', l: 'Arch Length — Maxillary', k: 'archlen_mx', o: ['Excessive', 'Adequate', 'Deficient'] },
      { t: 'opts', l: 'Arch Length — Mandibular', k: 'archlen_md', o: ['Excessive', 'Adequate', 'Deficient'] },
      { t: 'opts', l: 'MX Arch Form', k: 'archform_mx', o: ['Narrow', 'Ovoid', 'Wide', 'Symmetrical', 'Asymmetrical'], multi: true },
      { t: 'opts', l: 'MD Arch Form', k: 'archform_md', o: ['Narrow', 'Ovoid', 'Wide', 'Symmetrical', 'Asymmetrical'], multi: true },
    ],
  },
];

const FINDINGS_2 = [
  {
    title: 'Muscle Patterns & Lips', items: [
      { t: 'opts', l: 'Tongue', k: 'mp_tongue', o: ['Small', 'Normal', 'Large'] },
      { t: 'opts', l: 'Tongue Thrust', k: 'mp_thrust', o: ['Anterior', 'Lateral (Posterior)'], multi: true },
      { t: 'opts', l: 'Cheeks', k: 'mp_cheeks', o: ['Loose', 'Normal', 'Tight'] },
      { t: 'opts', l: 'Mentalis', k: 'mp_mentalis', o: ['Normal', 'Tight'] },
      { t: 'opts', l: 'Submental Crease', k: 'mp_submental', o: ['Slight', 'Normal', 'Large'] },
      { t: 'opts', l: 'Lips', k: 'mp_lips', o: ['Normal', 'Incompetent'] },
      { t: 'opts', l: 'Maxillary Lip', k: 'mp_mx_lip', o: ['Loose', 'Normal', 'Tight'] },
      { t: 'opts', l: 'Mandibular Lip', k: 'mp_md_lip', o: ['Loose', 'Normal', 'Tight'] },
      { t: 'opts', l: 'MX Lip Shape', k: 'mp_mx_shape', o: ['Thin', 'Average', 'Full'] },
      { t: 'opts', l: 'MD Lip Shape', k: 'mp_md_shape', o: ['Thin', 'Average', 'Full'] },
      { t: 'opts', l: 'Lip Tonicity', k: 'mp_tonicity', o: ['Hypertonic', 'Normal', 'Hypotonic'] },
      { t: 'opts', l: 'Smile Line', k: 'mp_smile', o: ['Minimal', 'Average', 'Excessive'] },
      { t: 'opts', l: 'Gummy Smile', k: 'mp_gummy', o: ['No', 'Yes'], after: [{ k: 'mp_gummy_mm', w: 34, u: 'mm' }] },
    ],
  },
  {
    title: 'Habits', items: [
      { t: 'opts', l: 'Breathing', k: 'hb_breathing', o: ['Normal', 'Mouth Breather'] },
      { t: 'opts', l: 'Thumb', k: 'hb_thumb', o: ['Normal', 'Thumb Sucker'] },
      { t: 'opts', l: 'Swallowing', k: 'hb_swallow', o: ['Normal', 'Abnormal'] },
      { t: 'cols', cols: [[{ t: 'opts', l: 'Finger Habit', k: 'hb_finger', o: ['Yes', 'No'] }, { t: 'opts', l: 'Nail Biting', k: 'hb_nail', o: ['Yes', 'No'] },
        { t: 'opts', l: 'Speech Habit', k: 'hb_speech', o: ['Yes', 'No'] }],
        [{ t: 'opts', l: 'Lip Biting', k: 'hb_lip', o: ['Yes', 'No'] }, { t: 'opts', l: 'Lisp', k: 'hb_lisp', o: ['Yes', 'No'] }]] },
    ],
  },
  {
    title: 'Facial Analysis & External Appearance', items: [
      { t: 'opts', l: 'Mandibular Plane', k: 'fa_mp', o: ['Steep', 'Normal', 'Flat'] },
      { t: 'opts', l: 'Chin Point', k: 'fa_chin', o: ['Flat', 'Normal', 'Button'] },
      { t: 'opts', l: 'Facial Type', k: 'fa_type', o: ['Dolicho', 'Meso', 'Brachy'] },
      { t: 'opts', l: 'Frontal', k: 'fa_frontal', o: ['Symmetrical', 'Asymmetrical — Right', 'Asymmetrical — Left'] },
      { t: 'opts', l: 'Profile', k: 'fa_profile', o: ['Retrognathic', 'Straight', 'Prognathic', 'Bimax'] },
      { t: 'opts', l: 'Maxilla', k: 'fa_maxilla', o: ['Retrognathic', 'Normal', 'Prognathic'] },
      { t: 'opts', l: 'Mandible', k: 'fa_mandible', o: ['Retrognathic', 'Normal', 'Prognathic'] },
      { t: 'opts', l: 'Soft Tissue Profile', k: 'fa_soft', o: ['Straight', 'Convex', 'Concave'] },
      { t: 'opts', l: 'Lower Face Height', k: 'fa_lfh', o: ['Short', 'Normal', 'Long'], after: [{ k: 'fa_lfh_mm', w: 34, u: 'mm' }] },
      { t: 'opts', l: 'Frontal Head Posture', k: 'fa_fhp', o: ['Left Tilt', 'Level', 'Right Tilt'] },
      { t: 'opts', l: 'Lateral Head Posture', k: 'fa_lhp', o: ['Back', 'Normal', 'Forward'] },
      { t: 'opts', l: 'Shoulders', k: 'fa_shoulders', o: ['High Left', 'Normal', 'High Right'] },
    ],
  },
];

export const CEPH_SKELETAL = [
  ['sna', 'SNA', 'Degrees', '82°', 'MX Prognathic / Normal / Retrognathic'],
  ['snb', 'SNB', 'Degrees', '80°', 'MD Prognathic / Normal / Retrognathic'],
  ['anb', 'ANB', 'Degrees', '2°', 'Class I / II / III'],
  ['nsgom', 'NS to GoM', 'Degrees', '32 ± 3', 'Open / Average / Closed'],
  ['pgnb', 'Pg-NB', 'mm', '2 – 5', 'Position of Pogonion'],
  ['nap', 'NAP', 'Degrees', '2°', 'Convex / Straight / Concave'],
  ['nans', 'N-ANS', 'mm', '50:50 Child', 'Short / Normal / Long'],
  ['ansm', 'ANS-M', 'mm', '45:55 Adult', 'Short / Normal / Long'],
  ['wits', 'Wits', 'mm', '-1 to 0', 'Class I / II / III'],
  ['npa', 'N ⊥ A', 'mm', '2', 'McNamara Analysis'],
  ['nppg', 'N ⊥ Pg', 'mm', '2', 'McNamara Analysis'],
  ['mxlen', 'MX Length', 'mm', '100', 'Modified Harvold Analysis'],
  ['mdlen', 'MD Length', 'mm', '130', 'Modified Harvold Analysis'],
  ['diff', 'Difference', 'mm', '18 – 28', 'Class I / II / III'],
  ['ugon', 'Upper Gonial', 'Degrees', '52 – 55', 'Horizontal / Normal / Vertical'],
  ['lgon', 'Lower Gonial', 'Degrees', '70 – 75', 'Horizontal / Normal / Vertical'],
];
export const CEPH_DENTAL = [
  ['u1ns', '⊥ to NS', 'Degrees', '102°', 'Flared / Vertical'], ['u1l1', 'T to ⊥', 'Degrees', '130°', ''],
  ['l1gom', 'T to GoM', 'Degrees', '95°', 'Flared / Vertical'], ['u1np', '⊥ NP', 'mm', '5', ''], ['l1ap', 'T to AP', 'mm', '0 – 3', ''],
  ['u1ans', '⊥ to ANS', 'mm', '30', ''], ['l1m', 'T to M', 'mm', '40', ''],
];
export const CEPH_COLS = [['i', 'Initial'], ['interp', 'Interpretation'], ['p1', 'Progress 1'], ['p2', 'Progress 2'], ['f', 'Final']];

const CEPH = [{ title: null, items: [{ t: 'inline', parts: [{ b: 'Tracing date' }, { k: 'ceph_date', w: 110 }] }, { t: 'ceph' },
  { t: 'note', text: '⊥ = upper incisor · T = lower incisor' }] }];

const HARVOLD = [
  {
    title: 'Modified Harvold Analysis', sub: 'Use measurements from the Cephalometric Analysis', items: [
      { t: 'cols', tmpl: '1fr 1fr 1fr', cols: [
        [{ t: 'inline', l: 'MX Length', parts: [{ k: 'hv_mx', w: 50, u: 'mm' }] }, { t: 'inline', l: 'MD Length', parts: [{ k: 'hv_md', w: 50, u: 'mm' }] },
          { t: 'inline', l: 'MX–MD Difference', parts: [{ k: 'hv_diff', w: 50, u: 'mm' }] }],
        [{ t: 'inline', l: 'MD Length', parts: [{ k: 'hv_md2', w: 50, u: 'mm' }] }, { t: 'inline', l: 'Predicted MD', parts: [{ k: 'hv_pred_md', w: 50, u: 'mm' }] },
          { t: 'inline', l: 'Difference', parts: [{ k: 'hv_md_diff', w: 50, u: 'mm' }] }],
        [{ t: 'inline', l: 'MX Length', parts: [{ k: 'hv_mx2', w: 45, u: 'mm' }] }, { t: 'inline', l: 'ANS-M', parts: [{ k: 'hv_ansm', w: 45, u: 'mm' }] },
          { t: 'inline', l: 'Predicted ANS-M', parts: [{ k: 'hv_pred_ansm', w: 45, u: 'mm' }] }, { t: 'inline', l: 'Difference', parts: [{ k: 'hv_ansm_diff', w: 45, u: 'mm' }] }]] },
      { t: 'harvRef' },
    ],
  },
  {
    title: 'Ceph Airway Measurements', items: [
      { t: 'inline', parts: [{ b: 'Area of adenoids' }, { k: 'aw_adenoids', w: 50, u: 'mm' }, { b: 'Area of tonsils' }, { k: 'aw_tonsils', w: 50, u: 'mm' }] },
      { t: 'q', l: 'Referral to E.N.T. specialist needed?', k: 'aw_ent_need', o: ['Yes', 'No'] },
      { t: 'q', l: 'Letter sent to E.N.T. specialist?', k: 'aw_ent_sent', o: ['Yes', 'No'], after: ['Date', { k: 'aw_ent_sent_date', w: 100 }] },
      { t: 'q', l: 'Reply received?', k: 'aw_ent_reply', o: ['Yes', 'No'], after: ['Date', { k: 'aw_ent_reply_date', w: 100 }] },
    ],
  },
];

const CLASSIFICATION = [
  {
    title: 'Model Analysis', items: [
      { t: 'opts', l: 'Constricted Arch', k: 'ma_constricted', o: ['MX', 'MD'], multi: true },
      { t: 'opts', l: 'Expanded Arch', k: 'ma_expanded', o: ['MX', 'MD'], multi: true },
      { t: 'opts', l: 'Asymmetric Arch', k: 'ma_asym', o: ['MX', 'MD'], multi: true },
      { t: 'opts', l: 'Crowding MX', k: 'ma_crowd_mx', o: ['Severe', 'Slight', 'None', 'Spaces'] },
      { t: 'opts', l: 'Crowding MD', k: 'ma_crowd_md', o: ['Severe', 'Slight', 'None', 'Spaces'] },
      { t: 'opts', l: 'Curve of Spee', k: 'ma_spee', o: ['Slight', 'Moderate', 'Excessive'] },
      { t: 'opts', l: 'Rotations', k: 'ma_rot', o: ['MX Anterior', 'MX Posterior', 'MD Anterior', 'MD Posterior'], multi: true },
    ],
  },
  {
    title: 'Classification of Malocclusion', items: [
      { t: 'inline', l: 'Soft Tissue S-Line', parts: ['Upper lip', { k: 'cl_sline_u', w: 40, u: 'mm' }, 'Lower lip', { k: 'cl_sline_l', w: 40, u: 'mm' }] },
      { t: 'opts', l: 'Facial — Lips', k: 'cl_lips', o: ['Convex', 'Normal', 'Concave'] },
      { t: 'opts', l: 'Facial — Profile', k: 'cl_profile', o: ['Retrognathic', 'Straight', 'Prognathic'] },
      { t: 'opts', l: 'Dentally (Study Models)', k: 'cl_dental', o: ['Class I', 'Class II Div 1', 'Class II Div 2', 'Class III'] },
      { t: 'opts', l: 'Vertical (Dental)', k: 'cl_vert_dental', o: ['Open', 'Average', 'Closed'] },
      { t: 'opts', l: 'Dentition', k: 'cl_dentition', o: ['Deciduous', 'Mixed', 'Permanent'] },
      { t: 'opts', l: 'Skeletally (Radiographic)', k: 'cl_skeletal', o: ['Class I', 'Class II', 'Class III'] },
      { t: 'opts', l: 'Vertical (Skeletal)', k: 'cl_vert_skel', o: ['Open', 'Average', 'Closed'] },
    ],
  },
];

const PERIO = [
  {
    title: 'Pre-Existing Condition', items: [
      { t: 'inline', parts: [{ b: 'Exam date' }, { k: 'perio_date', w: 100 }] },
      { t: 'cols', tmpl: 'auto 1fr', cols: [
        [{ t: 'sub', text: 'Permanent Dentition — tap teeth to mark' }, { t: 'teeth', k: 'teeth_perm', set: 'perm' }],
        [{ t: 'sub', text: 'Patient Concerns' },
          { t: 'opts', k: 'perio_concerns', multi: true, stack: true, o: ['Bleeding gums', 'Swollen gums', 'Exudate / pus', 'Hot / cold sensitivity',
            'Mobility / drifting / spaces', 'Taste / odor', 'Recession', 'Abscess / gum boil', 'None'] },
          { t: 'inline', parts: [{ b: 'Last cleaning' }, { k: 'perio_last_clean', w: 'flex' }] },
          { t: 'inline', parts: [{ b: 'Frequency' }, { k: 'perio_freq', w: 'flex' }] },
          { t: 'inline', parts: ['Brushing', { k: 'perio_brush', w: 30 }, '× / day'] },
          { t: 'inline', parts: ['Flossing', { k: 'perio_floss', w: 30 }, '× / week'] },
          { t: 'inline', parts: ['Other aids', { k: 'perio_aids', w: 'flex' }] }]] },
      { t: 'cols', tmpl: 'auto 1fr', cols: [
        [{ t: 'sub', text: 'Primary Dentition' }, { t: 'teeth', k: 'teeth_prim', set: 'prim' }],
        [{ t: 'sub', text: 'Complicating Factors' },
          { t: 'opts', k: 'perio_cf', multi: true, stack: true, o: ['Pseudo pockets / hyperplasia', 'Recession — generalized', 'Recession — localized',
            'Minimal attached gingiva', 'Frenum pull', 'Furcation involvement', 'Mobilities', 'Abfractions'] },
          { t: 'lines', k: 'perio_comments', l: 'Comments (teeth involved)', n: 2 }]] },
    ],
  },
  {
    title: 'Periodontal Findings', items: [
      { t: 'opts', l: 'X-Rays — Bone', k: 'pf_bone', o: ['Normal', 'Mild', 'Moderate', 'Severe', 'Other'] },
      { t: 'opts', l: 'Gingiva', k: 'pf_gingiva', o: ['Normal contour', 'Rolled margins', 'Bleeding', 'Blunted papilla', 'Puffy papilla'], multi: true },
      { t: 'opts', l: 'Gingivitis', k: 'pf_gingivitis', o: ['Localized', 'Generalized', 'Acute', 'Chronic'], multi: true },
      { t: 'opts', l: 'Plaque', k: 'pf_plaque', o: ['Light', 'Moderate', 'Heavy'] },
      { t: 'opts', l: 'Calculus', k: 'pf_calculus', o: ['Light', 'Moderate', 'Heavy', 'Supra', 'Sub'], multi: true },
    ],
  },
];

const ap = (l, k, o = []) => ({ t: 'opts', l, k, o: o.length ? o : ['Selected'], multi: true, app: true });
const APPLIANCES = [
  {
    title: 'Orthopedic Appliances', sub: 'Check appliance and arch', items: [
      { t: 'cols', cols: [[
      { t: 'sub', text: 'Lateral Expansion (Transverse)' },
      ap('Schwarz (post pads) — removable', 'ap_schwarz', ['MX', 'MD', 'Labial bow']),
      ap('MX Banded Hyrax — fixed', 'ap_mx_hyrax', ['Selected', 'Reverse headgear']),
      ap('MX TransVerse TransForce', 'ap_mx_ttf'), ap('MD TransVerse TransForce', 'ap_md_ttf'), ap('MD Banded Hyrax', 'ap_md_hyrax'),
      { t: 'sub', text: 'Anterior–Posterior (Sagittal)' },
      ap('MX Anterior Sagittal', 'ap_mx_ant_sag', ['2 screws', '3 screws']), ap('MX Posterior Sagittal', 'ap_mx_post_sag', ['2 screws', '3 screws']),
      ap('MD Posterior Sagittal', 'ap_md_post_sag', ['2 screws', '3 screws']), ap('MX Rick-A-Nator', 'ap_mx_ran', ['Selected', 'Incisal ramp']),
      ap('Twin Block', 'ap_twin'), ap('Twin Block II', 'ap_twin2', ['Selected', 'Incisal ramp']),
      ap('Fixed Anterior Sagittal', 'ap_fixed_ant_sag', ['MX']), ap('Posterior Molar Distalizer', 'ap_distalizer', ['MX']),
      ap('MARA', 'ap_mara', ['Advance MD']), ap('Tandem', 'ap_tandem', ['Advance MX']),
      ], [
      { t: 'sub', text: 'Habit · Vertical · Holding' },
      ap('MX Hyrax with Crib — habit', 'ap_crib', ['MX']), ap('Rick-A-Nator — vertical', 'ap_v_ran', ['MX']),
      ap('Twin Block — vertical', 'ap_v_twin'), ap('Twin Block II — vertical', 'ap_v_twin2', ['MX']),
      ap('Transpalatal Arch', 'ap_tpa', ['MX']), ap('Nance Button', 'ap_nance', ['MX', 'MD']), ap('Transpalatal-Nance', 'ap_tpn', ['MX']),
      ap('TP Rick-A-Nator', 'ap_tpran', ['MX']),
      { t: 'sub', text: 'Retention' },
      ap('QCM', 'rt_qcm', ['MX', 'MD']), ap('Fixed Bonded Lingual Retainer', 'rt_bonded', ['MX', 'MD']), ap('EZ Aligners', 'rt_ez', ['MX', 'MD']),
      ap('Spring Retainer', 'rt_spring', ['MX', 'MD']), ap('Tooth Positioner', 'rt_positioner'),
      ]] },
    ],
  },
  {
    title: 'Straight Wire Mechanics', items: [
      { t: 'opts', l: 'Wires', k: 'sw_wires', multi: true, grid: 3, o: ['.014 Sectionals', '.016 Sectionals', '.016 × .016 Utility Arch', '.014 Cu NiTi',
        '.018 Cu NiTi', '.018 CNA', '.019 × .025 CNA', '.019 × .025 V Force 3', '.019 × .025 Multi Braided'] },
      { t: 'opts', l: 'Elastics — Class I', k: 'el_c1', o: ['Vertical', 'MX', 'MD'], multi: true },
      { t: 'opts', l: 'Elastics — Class II', k: 'el_c2', o: ['Box', 'Buccal'], multi: true },
      { t: 'opts', l: 'Elastics — Class III', k: 'el_c3', o: ['Triangle', 'Lingual'], multi: true },
      { t: 'opts', l: 'Elastics — Other', k: 'el_other', o: ['Cross', 'Intras'], multi: true },
    ],
  },
];

const SUMMARY = [
  {
    title: 'Medical History Summary', items: [
      { t: 'lines', k: 'sum_medhx', n: 2 },
      { t: 'opts', l: 'Profile', k: 'sum_profile', o: ['Straight', 'Convex', 'Retrognathic', 'Concave', 'Prognathic'] },
      { t: 'inline', l: 'Lips', parts: ['MX lip', { k: 'sum_mx_lip', w: 40, u: 'mm' }, 'MD lip', { k: 'sum_md_lip', w: 40, u: 'mm' }] },
    ],
  },
  {
    title: 'Functional Problems', items: [
      { t: 'opts', l: 'Airway', k: 'sum_airway', o: ['Normal', 'Constricted'], after: ['Adenoid', { k: 'sum_adenoid', w: 36, u: 'mm' }, 'Tonsil', { k: 'sum_tonsil', w: 36, u: 'mm' }] },
      { t: 'inline', l: 'TMJ Signs & Symptoms', parts: [{ k: 'sum_tmj', w: 'flex' }] },
    ],
  },
  {
    title: 'Skeletal Problems', items: [
      { t: 'opts', l: 'Maxilla', k: 'sp_maxilla', o: ['Class I — Normal', 'Class II — Retrognathic', 'Class III — Prognathic'], after: ['NSGoM', { k: 'sp_nsgom', w: 45 }] },
      { t: 'opts', l: 'Mandible', k: 'sp_mandible', o: ['Class I — Normal', 'Class II — Retrognathic', 'Class III — Prognathic'], after: ['ANS-M', { k: 'sp_ansm', w: 45 }] },
      { t: 'opts', l: 'MX Arch', k: 'sp_mxarch', o: ['Normal', 'Constricted'], after: ['Lower Gonial', { k: 'sp_lgon', w: 45 }] },
      { t: 'opts', l: 'Vertical', k: 'sp_vertical', o: ['Average', 'Open', 'Closed'] },
    ],
  },
  {
    title: 'Dental Problems', items: [
      { t: 'opts', l: 'Molar Relationship', k: 'dp_molar', o: ['CL I', 'CL II', 'CL III'], after: ['Intermolar width', { k: 'dp_intermolar', w: 50, u: 'mm' }] },
      { t: 'inline', l: 'Overjet / Overbite', parts: ['OJ', { k: 'dp_oj', w: 40, u: 'mm' }, 'OB', { k: 'dp_ob', w: 40, u: 'mm' }] },
    ],
  },
  {
    title: 'Treatment Plan', items: [
      { t: 'cols', tmpl: '1fr 1fr 1fr', cols: [[{ t: 'lines', k: 'tp_functional', l: 'Functional / TMJ', n: 3 }],
        [{ t: 'lines', k: 'tp_skeletal', l: 'Skeletal', n: 3 }], [{ t: 'lines', k: 'tp_dental', l: 'Dental', n: 3 }]] },
      { t: 'inline', parts: [{ b: 'Active treatment phase' }, { k: 'tp_active_months', w: 50 }, 'months',
        { k: 'tp_extraction', o: ['Non-extraction', 'Extractions'] }, 'Teeth', { k: 'tp_ext_teeth', w: 'flex' }] },
      ...[1, 2, 3, 4, 5].map((i) => ({ t: 'inline', l: `Phase ${i}`, parts: [{ k: `tp_phase${i}`, w: 'flex' }] })),
      { t: 'inline', parts: [{ b: 'Retention phase' }, { k: 'tp_retention_months', w: 50 }, 'months'] },
      { t: 'sig', fields: ['Treating Dentist', 'Date'] },
    ],
  },
];


// ---------------- final orthodontic exam (end of treatment) ----------------
const RES = ['Resolved', 'Improved', 'Not resolved', 'N/A'];
const MET = ['Met', 'Partly met', 'Not met', 'N/A'];
const FINAL_EXAM = [
  {
    title: 'End of Treatment', items: [
      { t: 'inline', parts: [{ b: 'Debond / appliance removal date' }, { k: 'fx_debond_date', w: 95 }, { b: 'Months in treatment' }, { k: 'fx_months', w: 40 },
        { b: 'Treating dentist' }, { k: 'fx_dentist', w: 'flex' }] },
      { t: 'opts', l: 'Appliances removed', k: 'fx_removed', multi: true, o: ['MX brackets', 'MD brackets', 'Expander', 'Functional appliance', 'Holding arch', 'Aligners'] },
    ],
  },
  {
    title: 'Final Occlusion', sub: 'Compare with Clinical Findings (page 4)', items: [
      { t: 'inline', l: 'Molar relationship', parts: [{ b: 'R' }, { k: 'fx_molar_r', o: ['Class I', 'Class II', 'Class III'] }, { b: 'L' }, { k: 'fx_molar_l', o: ['Class I', 'Class II', 'Class III'] }] },
      { t: 'inline', l: 'Cuspid relationship', parts: [{ b: 'R' }, { k: 'fx_cuspid_r', o: ['Class I', 'Class II', 'Class III'] }, { b: 'L' }, { k: 'fx_cuspid_l', o: ['Class I', 'Class II', 'Class III'] }] },
      { t: 'inline', l: 'Overjet / Overbite', parts: ['OJ', { k: 'fx_oj', w: 40, u: 'mm' }, 'OB', { k: 'fx_ob', w: 40, u: 'mm' }] },
      { t: 'opts', l: 'Maxillary midline', k: 'fx_mid_mx', o: ['Coincident', 'Shifted L', 'Shifted R'], after: [{ k: 'fx_mid_mx_mm', w: 34, u: 'mm' }] },
      { t: 'opts', l: 'Mandibular midline', k: 'fx_mid_md', o: ['Coincident', 'Shifted L', 'Shifted R'], after: [{ k: 'fx_mid_md_mm', w: 34, u: 'mm' }] },
      { t: 'opts', l: 'Crossbite', k: 'fx_crossbite', o: RES },
      { t: 'opts', l: 'Crowding', k: 'fx_crowding', o: RES },
      { t: 'opts', l: 'Spacing', k: 'fx_spacing', o: RES },
      { t: 'opts', l: 'Rotations', k: 'fx_rotations', o: RES },
      { t: 'opts', l: 'Curve of Spee', k: 'fx_spee', o: ['Leveled', 'Improved', 'Not leveled', 'N/A'] },
    ],
  },
  {
    title: 'Treatment Goals', sub: 'Against the Treatment Plan (page 14)', items: [
      { t: 'cols', cols: [[{ t: 'opts', l: 'Functional / TMJ', k: 'fx_goal_func', o: MET }, { t: 'opts', l: 'Skeletal', k: 'fx_goal_skel', o: MET }],
        [{ t: 'opts', l: 'Dental', k: 'fx_goal_dental', o: MET }, { t: 'opts', l: 'Airway', k: 'fx_goal_airway', o: MET }]] },
    ],
  },
  {
    title: 'Final Records', items: [
      { t: 'datelist', cols: [[['fx_rec_photos', 'Final photos'], ['fx_rec_scan', 'Final scan / models']],
        [['fx_rec_pano', 'Final panoramic'], ['fx_rec_ceph', 'Final ceph (page 9)']],
        [['fx_rec_tmj', 'Final TMJ exam (page 7)'], ['fx_rec_palp', 'Final palpation (page 8)']]] },
    ],
  },
  {
    title: 'Retention', items: [
      { t: 'opts', l: 'Retainers delivered', k: 'fx_ret_type', multi: true, o: ['QCM', 'Bonded lingual', 'Clear / Essix', 'EZ Aligners', 'Spring retainer', 'Positioner'], after: [{ k: 'fx_ret_arch', o: ['MX', 'MD'], multi: true }] },
      { t: 'inline', l: 'Delivered / wear', parts: ['Date', { k: 'fx_ret_date', w: 90 }, { k: 'fx_ret_wear', o: ['Full-time', 'Nights only', 'As directed'] }] },
      { t: 'inline', l: 'Retention checks', parts: ['1 mo', { k: 'fx_chk_1', w: 62 }, '3 mo', { k: 'fx_chk_3', w: 62 }, '6 mo', { k: 'fx_chk_6', w: 62 }, '12 mo', { k: 'fx_chk_12', w: 62 }] },
    ],
  },
  {
    title: 'Outcome', items: [
      { t: 'opts', l: 'Patient satisfaction', k: 'fx_satisfaction', o: ['Very satisfied', 'Satisfied', 'Not satisfied'] },
      { t: 'opts', l: 'Complications', k: 'fx_complications', multi: true, o: ['None', 'White spots', 'Root resorption', 'Recession', 'TMJ symptoms', 'Relapse', 'Other'] },
      { t: 'lines', k: 'fx_notes', l: 'Final exam notes', n: 5 },
      { t: 'sig', fields: ['Treating Dentist', 'Patient / Guardian Signature', 'Date'] },
    ],
  },
];

// ---------------- patient info (PHI) ----------------
const PATIENT_INFO = [
  {
    title: 'Patient Information', items: [
      { t: 'row', fields: [{ k: 'pt_first', l: 'First Name', f: 3, phi: 1 }, { k: 'pt_mi', l: 'M.I.', f: 0.6, phi: 1 }, { k: 'pt_last', l: 'Last Name', f: 3, phi: 1 }, { k: 'pt_pref', l: 'Preferred Name', f: 2, phi: 1 }] },
      { t: 'row', fields: [{ k: 'pt_addr', l: 'Street or Mailing Address', phi: 1 }] },
      { t: 'row', fields: [{ k: 'pt_city', l: 'City', f: 3, phi: 1 }, { k: 'pt_state', l: 'State', phi: 1 }, { k: 'pt_zip', l: 'ZIP Code', f: 1.3, phi: 1 }] },
      { t: 'row', fields: [{ k: 'pt_dob', l: 'Date of Birth', f: 1.4, phi: 1 }, { k: 'age', l: 'Age', f: 0.6 }, { k: 'sex', l: 'Sex', f: 1.1, o: ['M', 'F'] },
        { k: 'pt_home', l: 'Home Phone', f: 1.6, phi: 1 }, { k: 'pt_cell', l: 'Cell Phone', f: 1.6, phi: 1 }] },
      { t: 'row', fields: [{ k: 'pt_email', l: 'Email', f: 2, phi: 1 }, { k: 'contact_pref', l: 'Preferred Contact Method', f: 1.2 }] },
      { t: 'row', fields: [{ k: 'family_dentist', l: 'Family Dentist' }, { k: 'family_physician', l: 'Family Physician' }] },
      { t: 'row', fields: [{ k: 'other_providers', l: 'Other Health Care Providers' }, { k: 'referred_by', l: 'Referred By' }] },
    ],
  },
  {
    title: 'Person(s) Responsible for Account', items: [
      { t: 'row', fields: [{ k: 'rp_name', l: 'Name', f: 3, phi: 1 }, { k: 'rp_rel', l: 'Relationship to Patient', f: 2 }] },
      { t: 'row', fields: [{ k: 'rp_addr', l: 'Address (if different from above)', phi: 1 }] },
      { t: 'row', fields: [{ k: 'rp_city', l: 'City', f: 3, phi: 1 }, { k: 'rp_state', l: 'State', phi: 1 }, { k: 'rp_zip', l: 'ZIP Code', f: 1.3, phi: 1 }] },
      { t: 'row', fields: [{ k: 'rp_employer', l: 'Employer', f: 3, phi: 1 }, { k: 'rp_phone', l: 'Business Phone', f: 2, phi: 1 }] },
    ],
  },
  {
    title: 'Dental Insurance', subOpts: { k: 'ins_ortho_cov', l: 'Orthodontic coverage', o: ['Y', 'N'] }, items: [
      { t: 'sub', text: 'Primary' },
      { t: 'row', fields: [{ k: 'ins1_co', l: 'Insurance Company' }, { k: 'ins1_emp', l: 'Employer', phi: 1 }] },
      { t: 'row', fields: [{ k: 'ins1_holder', l: 'Name of Policyholder', phi: 1 }, { k: 'ins1_addr', l: 'Policyholder Address (if different from above)', phi: 1 }] },
      { t: 'row', fields: [{ k: 'ins1_group', l: 'Group Number', phi: 1 }, { k: 'ins1_id', l: 'ID Number', phi: 1 }, { k: 'ins1_dob', l: 'Policyholder Date of Birth', phi: 1 }] },
      { t: 'sub', text: 'Secondary (if dual insurance)' },
      { t: 'row', fields: [{ k: 'ins2_co', l: 'Insurance Company' }, { k: 'ins2_emp', l: 'Employer', phi: 1 }] },
      { t: 'row', fields: [{ k: 'ins2_holder', l: 'Name of Policyholder', phi: 1 }, { k: 'ins2_addr', l: 'Policyholder Address (if different from above)', phi: 1 }] },
      { t: 'row', fields: [{ k: 'ins2_group', l: 'Group Number', phi: 1 }, { k: 'ins2_id', l: 'ID Number', phi: 1 }, { k: 'ins2_dob', l: 'Policyholder Date of Birth', phi: 1 }] },
    ],
  },
];

// ---------------- TMJ consult-only ----------------
const TMJ_INTAKE = [
  {
    title: 'Patient Information', items: [
      { t: 'row', fields: [{ k: 'pt_first', l: 'First Name', f: 3, phi: 1 }, { k: 'pt_mi', l: 'M.I.', f: 0.6, phi: 1 }, { k: 'pt_last', l: 'Last Name', f: 3, phi: 1 }] },
      { t: 'row', fields: [{ k: 'pt_dob', l: 'Date of Birth', f: 1.3, phi: 1 }, { k: 'age', l: 'Age', f: 0.6 }, { k: 'pt_cell', l: 'Cell Phone', f: 1.6, phi: 1 }, { k: 'pt_email', l: 'Email', f: 2.2, phi: 1 }] },
      { t: 'row', fields: [{ k: 'referred_by', l: 'Referred By' }, { k: 'family_physician', l: 'Primary Care Physician' }] },
      { t: 'row', fields: [{ k: 'prev_tmj_providers', l: 'Previous TMJ / Facial Pain Providers' }] },
    ],
  },
  {
    title: 'Your Concern', items: [
      { t: 'row', fields: [{ k: 'chief_concern', l: 'Chief Concern', f: 3 }, { k: 'onset', l: 'Date of Onset', f: 1 }] },
      { t: 'lines', k: 'symptoms_desc', l: 'Describe your symptoms in your own words', n: 2 },
      { t: 'scale', k: 'pain_now', l: 'Pain right now', sub: '0 = none, 10 = worst imaginable' },
      { t: 'scale', k: 'pain_worst', l: 'Pain at its worst', sub: 'past 30 days' },
      { t: 'q', l: 'Where is the pain?', k: 'pain_loc', multi: true, o: ['Jaw joint R', 'Jaw joint L', 'Temples', 'Ears', 'Face / cheeks', 'Neck', 'Teeth'] },
      { t: 'q', l: 'How often?', k: 'pain_freq', o: ['Constant', 'Daily', 'Weekly', 'Occasionally'] },
      { t: 'q', l: 'Prior treatment tried', k: 'prior_tx', multi: true, o: ['Night guard', 'Physical therapy', 'Injections', 'Medication', 'Chiropractic', 'None'] },
      { t: 'inline', parts: ['Other:', { k: 'prior_tx_other', w: 'flex' }] },
    ],
  },
  {
    title: 'Health Overview', items: [
      { t: 'q', l: "Under a physician's care", k: 'under_tx', o: ['Yes', 'No'], after: ['Specify', { k: 'under_tx_spec', w: 'flex' }] },
      { t: 'q', l: 'Medication allergies', k: 'med_allergy', o: ['Yes', 'No'], after: ['Specify', { k: 'med_allergy_spec', w: 'flex' }] },
      { t: 'q', l: 'Arthritis or joint disease', k: 'arthritis', o: ['Yes', 'No'], after: ['Specify', { k: 'arthritis_spec', w: 'flex' }] },
    ],
  },
];

const TMJ_ASSESS = [
  {
    title: 'Imaging & Records', sub: 'Office use', items: [
      { t: 'datelist', cols: [[['img_pano', 'Panoramic X-Ray'], ['img_ceph', 'Cephalometric X-Ray']], [['img_tmj', 'TM Joint X-Rays'], ['img_jva', 'JVA']], [['img_cbct', 'CBCT'], ['img_photos', 'Photos']]] },
    ],
  },
  {
    title: 'Clinical Impression', items: [
      { t: 'opts', l: 'Primary Pattern', k: 'ci_pattern', multi: true, o: ['Myofascial pain', 'Disc displacement w/ reduction', 'Disc displacement w/o reduction',
        'Arthralgia', 'Degenerative joint disease', 'Headache attributed to TMD', 'Other'] },
      { t: 'opts', l: 'Side', k: 'ci_side', o: ['Right', 'Left', 'Bilateral'] },
      { t: 'opts', l: 'Contributing Factors', k: 'ci_factors', multi: true, o: ['Bruxism / clenching', 'Airway / SDB', 'Occlusion', 'Trauma', 'Posture', 'Stress'] },
      { t: 'opts', l: 'Sleep Screening', k: 'ci_sleep', o: ['Not indicated', 'Recommended', 'Referred'] },
      { t: 'lines', k: 'ci_notes', l: 'Notes', n: 4 },
    ],
  },
  {
    title: 'Treatment Plan', items: [
      { t: 'opts', l: 'Conservative Care', k: 'tx_conservative', multi: true, o: ['Education / self-care', 'Soft diet', 'Heat / ice', 'Jaw exercises'] },
      { t: 'opts', l: 'Appliance', k: 'tx_appliance', multi: true, o: ['Stabilization splint', 'Anterior repositioning', 'Night guard', 'MX', 'MD'] },
      { t: 'opts', l: 'Medication', k: 'tx_meds', multi: true, o: ['NSAID', 'Muscle relaxant', 'Other'] },
      { t: 'opts', l: 'Referral', k: 'tx_referral', multi: true, o: ['Physical therapy', 'ENT', 'Sleep medicine', 'Oral surgery', 'Orthodontics', 'Physician'] },
      { t: 'inline', parts: [{ b: 'Re-evaluate in' }, { k: 'tx_reeval_weeks', w: 50 }, 'weeks', { b: 'Fee quoted $' }, { k: 'tx_fee', w: 70 }] },
      { t: 'lines', k: 'tx_notes', l: 'Additional plan notes', n: 6 },
      { t: 'sig', fields: ['Treating Dentist', 'Patient Signature', 'Date'] },
    ],
  },
];

// ---------------- forms ----------------
export const FORMS = {
  ortho: {
    key: 'ortho', title: 'Orthodontic Diagnostic Record', short: 'Ortho Record',
    pages: [
      { title: 'Patient Information', strip: false, sections: PATIENT_INFO },
      { title: 'Records & Health Overview', sections: RECORDS },
      { title: 'Medical & Dental History', sections: MEDICAL },
      { title: 'Clinical Findings', sections: FINDINGS_1 },
      { title: 'Clinical Findings (cont.)', sections: FINDINGS_2 },
      { title: 'TMJ Health Questionnaire', sections: TMJ_QUESTIONNAIRE(true) },
      { title: 'TMJ Examination', sections: TMJ_EXAM(false) },
      { title: 'Muscle Palpation', sections: PALPATION },
      { title: 'Cephalometric Analysis', sections: CEPH },
      { title: 'Harvold & Airway', sections: HARVOLD },
      { title: 'Model Analysis & Classification', sections: CLASSIFICATION },
      { title: 'Pre-Orthodontic Periodontal Assessment', sections: PERIO },
      { title: 'Orthopedic Appliances', sections: APPLIANCES },
      { title: 'Summary & Treatment Plan', sections: SUMMARY },
      { title: 'Final Orthodontic Exam', sections: FINAL_EXAM },
    ],
  },
  tmj: {
    key: 'tmj', title: 'TMJ Consultation', short: 'TMJ Consult',
    pages: [
      { title: 'Patient Intake', strip: false, sections: TMJ_INTAKE },
      { title: 'TMJ Health Questionnaire', sections: TMJ_QUESTIONNAIRE(false) },
      { title: 'TMJ Examination', sections: TMJ_EXAM(true) },
      { title: 'Muscle Palpation', sections: PALPATION },
      { title: 'Assessment & Plan', sections: TMJ_ASSESS },
    ],
  },
};

// Every key flagged phi anywhere in a form — used to strip before saving.
export function phiKeys(form) {
  const keys = new Set(['pt_first', 'pt_last', 'pt_mi', 'pt_dob']);
  const walk = (items) => items.forEach((it) => {
    if (it.t === 'row') it.fields.forEach((f) => f.phi && keys.add(f.k));
    if (it.t === 'cols') it.cols.forEach(walk);
    (it.parts || []).concat(it.after || []).forEach((p) => p && p.phi && keys.add(p.k));
  });
  form.pages.forEach((p) => p.sections.forEach((s) => walk(s.items)));
  return keys;
}

export function stripPhi(form, data) {
  const ban = phiKeys(form);
  const out = {};
  Object.keys(data || {}).forEach((k) => { if (!ban.has(k)) out[k] = data[k]; });
  return out;
}
