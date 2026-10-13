// netlify/edge-functions/xray-check.js — X-ray claim helper for the Note Builder.
//
// Purpose: get claims PAID. Claude reads the attached X-rays and
//   1. SUGGESTS note statements (decay, loss of tooth structure, periapical
//      status, restorability, completed treatment) for the dentist to confirm
//      and add — nothing is written into the note automatically,
//   2. suggests values for the note's still-blank X-ray fields,
//   3. drafts a short claim narrative tied to the images,
//   4. flags problems. Only a true dealbreaker (no usable image where one is
//      required, root/apex cut off on a required film, wrong image type,
//      unreadable image) holds the claim. Everything else is a note-level
//      fix with suggested wording, and the claim goes out.
//
// Exposure: images arrive contrast-balanced from the browser (originals are
// untouched) with the uploader's measured exposure (over/under/low contrast).
// Exposure is noted but never stops the findings; only a cut-off area or a
// genuinely unreadable image does.
//
// Honesty rule (built into the prompt): describe only what is visible; hedge
// when unsure ("appears", "consistent with"); never invent symptoms, tests,
// dates or measurements. Everything written is marked for the dentist to
// confirm before signing.
//
// Request  POST /api/xray-check
//   { procedure, tooth, noteText,
//     fields: [{ id, label, hint }]   // the note's still-missing blanks (optional)
//     images: [{ role: 'preop'|'postop'|'other', mediaType, data(base64) }] }
// Response (always HTTP 200 once input is valid; see streaming note below)
//   { ok: true, procedure, model, rules, result } | { ok: false, error }
//
// Env: ANTHROPIC_API_KEY (required). Model: XRAY_MODEL, else NOTE_MODEL (the
// Note Builder's), else the default below.
//
// Netlify cuts off an edge function that sends nothing for ~40 s, so after
// the input checks the response starts at once and sends a space every 5 s
// while Claude works, then the JSON. Leading spaces are valid JSON.

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_IMAGES = 6
const MAX_B64 = 6_500_000 // ~4.9 MB decoded; the API limit is 5 MB per image
const MAX_FIELDS = 40

// hold: true  = if this FAILS, the claim waits (dealbreaker the note can't fix)
// hold: false = note it, suggest wording, send the claim
export const RULES = {
  rct: {
    label: 'Root canal',
    needs: ['preop', 'postop'],
    checks: [
      { id: 'preop_present',   hold: true,  label: 'A pre-op image showing the treated tooth is attached' },
      { id: 'postop_present',  hold: true,  label: 'A post-op image is attached' },
      { id: 'postop_apex',     hold: true,  label: 'Post-op shows the full root(s) to the apex (not cut off)' },
      { id: 'postop_fill',     hold: false, label: 'Post-op shows the canals filled close to the apex' },
      { id: 'preop_apex',      hold: false, label: 'Pre-op shows the full root(s) and apex' },
      { id: 'preop_findings',  hold: false, label: 'Pre-op shows findings that support a root canal' },
      { id: 'tooth_specific',  hold: false, label: 'Tooth-specific periapical rather than only an FMX, pano or bitewing' },
      { id: 'canal_count',     hold: false, label: 'Filled canals visible match the note' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  crown: {
    label: 'Crown',
    needs: ['preop', 'postop'],
    checks: [
      { id: 'preop_present',   hold: true,  label: 'A pre-op image showing the crowned tooth is attached' },
      { id: 'postop_present',  hold: true,  label: 'A post-op image is attached' },
      { id: 'postop_crown',    hold: false, label: 'Post-op shows the crown seated with margins visible' },
      { id: 'preop_justify',   hold: false, label: 'Pre-op shows a reason for a crown (large restoration, fracture, decay, prior root canal)' },
      { id: 'preop_tooth',     hold: false, label: 'Pre-op shows the whole tooth including roots' },
      { id: 'rct_mentioned',   hold: false, label: 'Any root canal visible on the tooth is mentioned in the note' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  ext_surgical: {
    label: 'Surgical extraction',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   hold: true,  label: 'A pre-op periapical or pano showing the tooth is attached' },
      { id: 'preop_roots',     hold: true,  label: 'Pre-op shows the roots of the tooth (not cut off)' },
      { id: 'surgical_justify',hold: false, label: 'Image supports a surgical approach (impaction, curved/divergent roots, tooth broken to bone, near sinus or nerve)' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  ext_simple: {
    label: 'Simple extraction',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   hold: true,  label: 'A pre-op image showing the tooth is attached' },
      { id: 'preop_justify',   hold: false, label: 'Image shows why the tooth is being removed (decay, bone loss, fracture, abscess)' },
      { id: 'preop_roots',     hold: false, label: 'Pre-op shows the roots of the tooth' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  filling: {
    label: 'Filling',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   hold: false, label: 'A pre-op bitewing or periapical is attached' },
      { id: 'decay_visible',   hold: false, label: 'Image shows decay or a failing restoration' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  srp: {
    label: 'Scaling and root planing',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   hold: true,  label: 'FMX or bitewings covering the treated quadrant(s) are attached' },
      { id: 'bone_loss',       hold: false, label: 'Radiographic bone loss and/or calculus is visible' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  pulpotomy: {
    label: 'Pulpotomy',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   hold: true,  label: 'A pre-op image showing the treated tooth is attached' },
      { id: 'preop_findings',  hold: false, label: 'Pre-op shows decay reaching or approaching the pulp' },
      { id: 'furcation',       hold: false, label: 'No furcation or periapical radiolucency that would call for extraction or pulpectomy instead' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
  other: {
    label: 'Other procedure',
    needs: [],
    checks: [
      { id: 'supports_note',   hold: false, label: 'Images are consistent with the procedure in the note' },
      { id: 'readable',        hold: true,  label: 'Images are readable enough for a dentist to interpret (not blank, black or washed out completely)' },
      { id: 'exposure',        hold: false, label: 'Exposure and contrast are ideal (noted only; does not affect the findings)' },
    ],
  },
}

// Statement topics the reviewer looks for, per procedure. Each becomes one
// suggested sentence when the images show it. section: O = objective
// (radiographic findings), A = assessment (restorability / prognosis).
const STATEMENTS = {
  rct: [
    ['decay', 'O', 'Decay or existing restoration: location (M/D/O/B/L) and how far it extends — state plainly whether it extends INTO the pulp, approximates the pulp, or stays in dentin'],
    ['pulp', 'O', 'Pulp involvement: carious radiolucency continuous with the pulp chamber/horn ("extends into the pulp, consistent with carious pulp exposure"), or approximating the pulp with minimal remaining dentin'],
    ['structure', 'O', 'Loss of tooth structure: walls or cusps lost, approximate share of coronal structure remaining'],
    ['periapical', 'O', 'Periapical/PDL status by root: radiolucency, PDL widening, or within normal limits'],
    ['obturation', 'O', 'Post-op: canals obturated (count), length relative to the radiographic apex, density, any voids or extrusion'],
    ['restorable', 'A', 'Restorability: whether remaining coronal/root structure and bone support (crown-root ratio) shown on the post-op PA support restoring the tooth, e.g. "Tooth #__ is restorable: post-op PA shows adequate remaining root structure and bone support for a definitive restoration."'],
  ],
  crown: [
    ['decay', 'O', 'Decay or failing restoration: location, size, recurrent decay, open margins, and how close it comes to the pulp'],
    ['structure', 'O', 'Loss of tooth structure: walls or cusps lost or undermined, fracture lines, approximate share of coronal structure remaining — why a filling would not hold'],
    ['endo', 'O', 'Prior root canal / post present, if visible'],
    ['restorable', 'A', 'Restorability: remaining root structure and bone support adequate for a crown, as shown on the image'],
    ['seat', 'O', 'Post-op: crown seated, margins adapted, no open margins or overhangs visible'],
  ],
  ext_surgical: [
    ['decay', 'O', 'Decay or fracture extent, tooth broken at or below bone level'],
    ['structure', 'O', 'Loss of tooth structure that prevents a simple (forceps) extraction'],
    ['roots', 'O', 'Root number, curvature, divergence, dilaceration, impaction or angulation, proximity to sinus or mandibular canal'],
    ['restorable', 'A', 'Restorability: tooth appears non-restorable, and why (decay/structure loss below bone, bone loss, root fracture) — only if the image supports it'],
  ],
  ext_simple: [
    ['decay', 'O', 'Decay extent and location'],
    ['structure', 'O', 'Loss of tooth structure / remaining structure'],
    ['periapical', 'O', 'Periapical radiolucency, bone loss'],
    ['restorable', 'A', 'Restorability: tooth appears non-restorable, and why — only if the image supports it'],
  ],
  filling: [
    ['decay', 'O', 'Decay location (surfaces) and depth — enamel, into dentin, approximating the pulp, or into the pulp — and recurrent decay under existing restoration'],
    ['structure', 'O', 'Loss of tooth structure: surfaces or walls involved'],
    ['restorable', 'A', 'Restorability: tooth restorable with a direct restoration, as the image shows'],
  ],
  srp: [
    ['boneloss', 'O', 'Bone loss pattern (horizontal/vertical) and approximate extent by area, furcation radiolucency'],
    ['calculus', 'O', 'Subgingival calculus visible'],
  ],
  pulpotomy: [
    ['decay', 'O', 'Decay location and depth — state plainly whether it extends into the pulp or approximates it'],
    ['pulp', 'O', 'Pulp involvement: radiolucency continuous with the pulp horn/chamber, consistent with carious pulp exposure'],
    ['structure', 'O', 'Loss of tooth structure'],
    ['periapical', 'O', 'Furcation and periapical areas: within normal limits, or any radiolucency; successor tooth position if visible'],
    ['restorable', 'A', 'Restorability: tooth restorable (e.g. with a stainless steel crown) as the image shows'],
  ],
  other: [
    ['findings', 'O', 'Findings relevant to the procedure in the note'],
  ],
}

const TOOL = {
  name: 'report_xray_check',
  description: 'Report the X-ray findings, note text, claim narrative and checks.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two plain sentences for billing: can this claim go out, and what helps it get paid.' },
      ai_picks: {
        type: 'object',
        description: 'Your read of the film using the pick keys and option values provided. Single keys take one value; multi keys take an array. Omit a key only if that area is not visible.',
        additionalProperties: true,
      },
      pick_conflicts: {
        type: 'array',
        description: "Where the dentist's current picks seem to disagree with the film.",
        items: { type: 'object', properties: { key: { type: 'string' }, note: { type: 'string' } }, required: ['key', 'note'] },
      },
      suggestions: {
        type: 'array',
        description: 'Suggested note statements, one per topic the images support. Skip a topic the images do not show.',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic id from the list.' },
            section: { type: 'string', enum: ['O', 'A'] },
            text: { type: 'string', description: 'One sentence for the note, clinical wording, tooth number included.' },
            basis: { type: 'string', description: 'Which image shows it, e.g. "post-op PA".' },
          },
          required: ['topic', 'section', 'text'],
        },
      },
      claim_narrative: { type: 'string', description: 'Claim narrative, max 400 characters: diagnosis + key radiographic support + treatment completed. No patient identifiers.' },
      field_fills: {
        type: 'array',
        description: 'Values for the provided missing note fields that the images answer. Skip fields the images cannot answer.',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, value: { type: 'string' }, basis: { type: 'string', description: 'Which image shows it.' } },
          required: ['id', 'value'],
        },
      },
      decay_depth: { type: 'string', enum: ['into_pulp', 'approximating_pulp', 'into_dentin', 'enamel_only', 'none_visible', 'not_assessable'],
        description: 'Deepest extent of decay/radiolucency on the treated tooth, relative to the pulp, on the pre-op.' },
      decay_location: { type: 'string', description: 'Surfaces/area of the deepest decay, e.g. "distal", "MO", "occlusal".' },
      decay_basis: { type: 'string', description: 'Which image shows it, e.g. "pre-op PA".' },
      phi_visible: { type: 'boolean', description: 'True if any patient name, date of birth or ID text is readable on any image.' },
      images: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            image_type: { type: 'string', enum: ['periapical', 'bitewing', 'panoramic', 'fmx_collage', 'cbct_slice', 'intraoral_photo', 'chart_or_document', 'other'] },
            appears_to_be: { type: 'string', enum: ['preop', 'postop', 'unclear'] },
            apex_visible: { type: 'string', enum: ['yes', 'no', 'partial', 'not_applicable'] },
            quality: { type: 'string', enum: ['good', 'fair', 'poor'], description: 'Diagnostic readability for a dentist, NOT exposure. "poor" only if it cannot be interpreted.' },
            exposure: { type: 'string', enum: ['good', 'over', 'under', 'low_contrast', 'uneven'] },
            treatment_visible: { type: 'string' },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['index', 'image_type', 'appears_to_be', 'apex_visible', 'quality'],
        },
      },
      checks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['pass', 'fail', 'unclear'] },
            detail: { type: 'string', description: 'One short sentence on what you saw.' },
            fix: { type: 'string', description: 'If not pass: what to do, or exact wording to add to the note that addresses it from the images at hand.' },
          },
          required: ['id', 'status', 'detail'],
        },
      },
      note_mismatches: { type: 'array', items: { type: 'string' }, description: 'Where the images contradict the note. Empty if none.' },
    },
    required: ['summary', 'ai_picks', 'claim_narrative', 'field_fills', 'phi_visible', 'images', 'checks', 'note_mismatches'],
  },
}

const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? (globalThis.Deno?.env?.get?.(k)) ?? globalThis.process?.env?.[k]
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function buildPrompt({ rules, proc, tooth, noteText, images, fields, pickSchema, picks }) {
  const imgList = images.map((im, i) => `Image ${i + 1}: uploaded as "${im.role}"${im.exposure && im.exposure !== 'good' ? `; original film measured as ${im.exposure.replace('_', ' ')}` : ''}`).join('\n')
  const checks = rules.checks.map(c => `- ${c.id}${c.hold ? ' [DEALBREAKER if it fails]' : ''}: ${c.label}`).join('\n')
  const fieldList = fields.length ? fields.map(f => `- ${f.id}: ${f.label}${f.hint && f.hint !== f.label ? ` (${f.hint})` : ''}`).join('\n') : '(none provided)'
  return `You are a dental claims assistant for a practice billing TennCare (Tennessee Medicaid). TennCare dentist reviewers read the X-rays and the note before paying. Your job is to help this claim GET PAID on the first submission, using the X-rays at hand, while staying strictly truthful.

Procedure: ${rules.label}${tooth ? `, tooth ${tooth}` : ''}
Images (in order):
${imgList}

HOW TO READ THE IMAGES
- Read them the way an experienced dentist reviewer does. Reviewers routinely interpret films that are over- or underexposed, a little dark, low in contrast or slightly blurred. Do the same: look past exposure and describe the findings.
- The images you see were contrast-balanced in the browser to help you read them; the original film's measured exposure is listed with each image. Report exposure in the "exposure" check and the image's "exposure" field only. It never reduces or replaces the findings.
- Skip a finding only when that specific area is cut off or truly not visible, and say which area. A whole image counts as unreadable only if a dentist could not interpret it at all.

WHAT TO PRODUCE
0. ai_picks — MOST IMPORTANT. Read the film like the treating dentist and pre-select the findings with these keys and option values (the dentist confirms every pick, so make your best call where the film reasonably shows it):
${pickSchema.length ? pickSchema.map(g => `   - ${g.key} (${g.type === 'multi' ? 'array of' : 'one of'}): ${g.options.join(' | ')}`).join('\n') : '   (no picks for this procedure)'}
   Decay depth is the key call: trace the radiolucency to the pulp chamber/horns. "into_pulp" when it is continuous with the pulp or no intact dentin band is visible between them; "approaching_pulp" when only a thin dentin band remains.
   Use the post-op film for canals/fill_length/voids/seat, and for restorable when it shows the remaining structure and bone support.
${Object.keys(picks || {}).length ? `   The dentist's current picks: ${JSON.stringify(picks)}. In pick_conflicts, list any of these the film clearly seems to contradict, with a short reason.` : ''}
1. suggestions (optional) — Extra statements only for findings the picks above cannot express. These are SUGGESTIONS: the dentist confirms each one before adding it. Write one sentence per topic below, in standard clinical charting language with the tooth number. Don't just describe the image — state the clinical finding a reviewer needs (e.g. "#19: deep distal caries extending to the pulp with loss of the distal marginal ridge and DL cusp; approximately 50% of coronal structure remaining."). Topics:
${(STATEMENTS[proc] || STATEMENTS.other).map(([id, sec, what]) => `   - ${id} (section ${sec}): ${what}`).join('\n')}
   Decay and loss of tooth structure are the core of medical necessity: always address them when the tooth is visible.
   DECAY DEPTH — the question every root canal / pulpotomy reviewer asks is "does the decay reach the pulp?". On the pre-op, trace the carious radiolucency to the pulp chamber and horns and set decay_depth:
     - into_pulp: the radiolucency is continuous with the pulp chamber or horn, or no intact dentin band is visible between them. Write it plainly: "carious radiolucency extends into the pulp, consistent with carious pulp exposure".
     - approximating_pulp: only a thin band of dentin appears to remain. Write "approximating the pulp with minimal remaining dentin".
     - into_dentin / enamel_only / none_visible / not_assessable as they apply.
   Do not soften a pulp-involved finding into generic "deep caries" — name the pulp. The dentist confirms it against the film. Restorability must rest on what the image shows (remaining structure, bone support, crown-root ratio); if the post-op shows the tooth is restorable, say so and cite the post-op PA.
   If a pre-op is an FMX/pano/bitewing rather than a single periapical, say what it does show (e.g. "FMX periapical of the area shows…").
2. field_fills — For each missing note field below that the images can answer, give the value that goes in the blank (short, fits the sentence). Skip any field the images cannot answer (symptoms, test results, anesthetic, dates, consent, etc.).
Missing fields:
${fieldList}
3. claim_narrative — Max 400 characters for the claim's narrative box: diagnosis, the key radiographic support, treatment completed.
4. checks — Run each check by id:
${checks}
   Status "fail" only when clearly failed; use "unclear" when you cannot tell. For anything not "pass", give a "fix": either the exact wording to add to the note that addresses it from these images, or the one action needed. Prefer a note-wording fix whenever the images allow it.
   DEALBREAKERS are only: a required image is missing, the root/apex is cut off on a required image, the image is the wrong kind entirely (a chart, a photo, a different area), or it is completely unreadable. Over/underexposure, low contrast, slight blur, an FMX instead of a PA, or thin pre-op findings are NOT dealbreakers — note them and still write the findings.
   For "exposure": pass if exposure is good; otherwise "fail" with a short note like "Post-op slightly overexposed; findings still interpretable". Never give exposure a fix that delays the claim.
5. images — classify each image. phi_visible — true if a patient name, birth date or ID is readable.
6. note_mismatches — places the images contradict the note (canal count, tooth area, treatment present/absent). Not things the note simply omits.

TRUTHFULNESS (non-negotiable)
- Describe only what is visible. Use "appears", "consistent with" or "approximately" when uncertain.
- Never invent symptoms, test results, dates, or precise measurements. Approximate distances only if clearly visible (e.g. "within approximately 1 mm of the radiographic apex").
- Do not determine the tooth number from anatomy unless the image is labeled; use the tooth number given.
- The treating dentist reviews and confirms everything you write before it is signed.
${noteText ? `\nCurrent note:\n"""\n${String(noteText).slice(0, 8000)}\n"""` : '\nNo note text was provided.'}

You must report by calling the report_xray_check tool. If you cannot call it, reply with only the same fields as one JSON object and no other text.`
}

// Pull the first JSON object out of a text reply (handles ```json fences).
function jsonFromText(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  // Only accept calls from the portal's own pages (same rule as note-builder.js).
  const origin = request.headers.get('origin')
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return json({ ok: false, error: 'Forbidden' }, 403) }
    catch { return json({ ok: false, error: 'Forbidden' }, 403) }
  }

  const key = env('ANTHROPIC_API_KEY')
  if (!key) return json({ ok: false, error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables' }, 500)

  let body
  try { body = await request.json() } catch { return json({ ok: false, error: 'Invalid JSON body' }, 400) }

  const proc = RULES[body.procedure] ? body.procedure : 'other'
  const rules = RULES[proc]
  const images = (Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [])
    .map(im => ({ ...im, exposure: ['good', 'over', 'under', 'low_contrast', 'uneven'].includes(im?.exposure) ? im.exposure : '' }))
  if (!images.length) return json({ ok: false, error: 'Attach at least one image' }, 400)
  for (const im of images) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(im.mediaType || '')) return json({ ok: false, error: 'Images must be JPEG or PNG' }, 400)
    if (!im.data || im.data.length > MAX_B64) return json({ ok: false, error: 'An image is empty or too large' }, 400)
  }
  const pickSchema = (Array.isArray(body.pickSchema) ? body.pickSchema : []).slice(0, 30)
    .filter(g => g && g.key && Array.isArray(g.options))
    .map(g => ({ key: String(g.key).slice(0, 40), type: g.type === 'multi' ? 'multi' : 'single', options: g.options.map(o => String(o).slice(0, 40)).slice(0, 12) }))
  const picks = body.picks && typeof body.picks === 'object' ? body.picks : {}
  const fields = (Array.isArray(body.fields) ? body.fields : [])
    .filter(f => f && f.id).slice(0, MAX_FIELDS)
    .map(f => ({ id: String(f.id).slice(0, 80), label: String(f.label || '').slice(0, 160), hint: String(f.hint || '').slice(0, 160) }))

  const model = env('XRAY_MODEL') || env('NOTE_MODEL') || DEFAULT_MODEL
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')) } catch {} }, 5000)
      ctrl.enqueue(enc.encode(' '))
      let out
      try { out = await runCheck({ key, model, proc, rules, images, fields, pickSchema, picks, tooth: body.tooth, noteText: body.noteText }) }
      catch (e) { out = { ok: false, error: 'X-ray check crashed: ' + String(e?.message || e).slice(0, 300) } }
      clearInterval(ping)
      ctrl.enqueue(enc.encode(JSON.stringify(out)))
      ctrl.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
}

async function runCheck({ key, model, proc, rules, images, fields, pickSchema = [], picks = {}, tooth, noteText }) {
  const content = []
  images.forEach((im, i) => {
    content.push({ type: 'text', text: `Image ${i + 1} (uploaded as ${im.role || 'other'}${im.exposure && im.exposure !== 'good' ? `; original measured ${im.exposure.replace('_', ' ')}, contrast-balanced for reading` : ''}):` })
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })
  })
  content.push({ type: 'text', text: buildPrompt({ rules, proc, tooth: String(tooth || '').slice(0, 20), noteText, images, fields, pickSchema, picks }) })

  let res, data
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        max_tokens: 4000,
        tools: [TOOL],
        // Forced tool_choice ("tool"/"any") is rejected by some models, so the
        // prompt asks for the tool and the reply text is parsed as a fallback.
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content }],
      }),
    })
    data = await res.json().catch(() => ({}))
  } catch (e) {
    return { ok: false, error: 'Could not reach the AI service: ' + String(e?.message || e) }
  }
  if (!res.ok) return { ok: false, error: `AI service error ${res.status} (model ${model}): ${data?.error?.message || 'no detail'}` }

  const tool = (data.content || []).find(c => c.type === 'tool_use' && c.name === TOOL.name)
  const result = tool ? (tool.input || {}) : jsonFromText((data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'))
  if (!result || !Array.isArray(result.checks)) return { ok: false, error: 'The AI did not return a result. Try again.' }

  // Every rule gets a status, even if the model skipped one.
  const got = new Map(result.checks.map(c => [c.id, c]))
  result.checks = rules.checks.map(c => got.get(c.id) || { id: c.id, status: 'unclear', detail: 'Not assessed.' })
  result.images = Array.isArray(result.images) ? result.images : []
  result.note_mismatches = Array.isArray(result.note_mismatches) ? result.note_mismatches : []
  // Only fill fields we actually asked about.
  const asked = new Set(fields.map(f => f.id))
  result.field_fills = (Array.isArray(result.field_fills) ? result.field_fills : [])
    .filter(f => f && asked.has(f.id) && String(f.value || '').trim())
    .map(f => ({ id: f.id, value: String(f.value).trim().slice(0, 300), basis: String(f.basis || '').slice(0, 160) }))
  const topics = new Map((STATEMENTS[proc] || STATEMENTS.other).map(([id, sec]) => [id, sec]))
  result.suggestions = (Array.isArray(result.suggestions) ? result.suggestions : [])
    .filter(x => x && String(x.text || '').trim())
    .map((x, i) => ({ id: `${x.topic || 'note'}_${i}`, topic: String(x.topic || 'note'), section: x.section === 'A' ? 'A' : (topics.get(x.topic) || 'O'),
      text: String(x.text).trim().slice(0, 400), basis: String(x.basis || '').slice(0, 120) }))
    .slice(0, 8)
  // Guarantee the pulp finding is stated when the AI classified it but didn't write it.
  const depth = String(result.decay_depth || '')
  if (['into_pulp', 'approximating_pulp'].includes(depth) && ['rct', 'pulpotomy', 'crown', 'filling'].includes(proc)
      && !result.suggestions.some(x => /pulp/i.test(x.text))) {
    const t = String(tooth || '').split(/[,\s]+/).filter(Boolean)[0]
    const where = String(result.decay_location || '').trim()
    const lead = `${t ? `#${t}: ` : ''}${where ? `${where} ` : ''}carious radiolucency`
    result.suggestions.unshift({
      id: 'pulp_auto', topic: 'pulp', section: 'O',
      text: depth === 'into_pulp'
        ? `${lead} extends into the pulp, consistent with carious pulp exposure.`
        : `${lead} approximates the pulp with minimal remaining dentin.`,
      basis: String(result.decay_basis || 'pre-op').slice(0, 120),
    })
  }
  result.decay_depth = depth
  // AI picks: keep only known keys/options
  const ap = result.ai_picks && typeof result.ai_picks === 'object' ? result.ai_picks : {}
  result.ai_picks = {}
  pickSchema.forEach(g => {
    const ok = new Set(g.options), v = ap[g.key]
    if (g.type === 'multi') { const arr = (Array.isArray(v) ? v : v != null ? [v] : []).map(String).filter(x => ok.has(x)); if (arr.length) result.ai_picks[g.key] = [...new Set(arr)] }
    else if (v != null && ok.has(String(v))) result.ai_picks[g.key] = String(v)
  })
  // decay_depth from the older field fills the pick if the AI only set that
  if (!result.ai_picks.decay_depth && pickSchema.some(g => g.key === 'decay_depth')) {
    const m = { into_pulp: 'into_pulp', approximating_pulp: 'approaching_pulp', into_dentin: 'dentin', enamel_only: 'enamel' }[depth]
    if (m) result.ai_picks.decay_depth = m
  }
  const keys = new Set(pickSchema.map(g => g.key))
  result.pick_conflicts = (Array.isArray(result.pick_conflicts) ? result.pick_conflicts : [])
    .filter(c => c && keys.has(c.key) && c.note).map(c => ({ key: c.key, note: String(c.note).slice(0, 200) })).slice(0, 10)
  // a ready-to-copy paragraph of the same statements
  result.findings_note = result.suggestions.map(x => /[.!?]$/.test(x.text) ? x.text : x.text + '.').join(' ')
  result.claim_narrative = String(result.claim_narrative || '').trim().slice(0, 400)
  return { ok: true, procedure: proc, model, rules, result }
}

export const config = { path: '/api/xray-check' }
