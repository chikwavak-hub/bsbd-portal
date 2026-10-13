// netlify/edge-functions/xray-check.js — X-ray claim helper for the Note Builder.
//
// Purpose: get claims PAID. Claude reads the attached X-rays and
//   1. writes radiographic findings for the note, describing what the images
//      actually show that supports medical necessity and completed treatment,
//   2. fills the note's still-blank X-ray fields where the images answer them,
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

// What good findings wording covers, per procedure (guides the writing).
const FINDINGS_GUIDE = {
  rct: 'Pre-op: caries or restoration depth relative to the pulp, periapical radiolucency or PDL widening and at which root, any root resorption or prior treatment, root/canal anatomy seen. Post-op: number of canals obturated, obturation length relative to the radiographic apex, density/voids, any sealer extrusion, temporary or permanent restoration present.',
  crown: 'Pre-op: size of existing restoration or decay, fracture lines, recurrent decay, prior root canal and post, remaining tooth structure, bone support. Post-op: crown seated, marginal fit/adaptation, no open margins or overhangs visible.',
  ext_surgical: 'Root number, length and curvature, divergence, dilaceration, impaction or angulation, tooth fractured at or below bone level, proximity to sinus floor or mandibular canal, ankylosis appearance, periapical pathology, bone level.',
  ext_simple: 'Extent of decay, remaining structure, periapical radiolucency, bone loss and mobility indicators, root fracture.',
  filling: 'Location and depth of radiolucency (enamel/dentin, proximity to pulp), recurrent decay under existing restoration, overhang or open contact.',
  srp: 'Horizontal/vertical bone loss pattern and approximate extent by area, subgingival calculus deposits, furcation radiolucency.',
  other: 'Findings relevant to the procedure in the note.',
}

const TOOL = {
  name: 'report_xray_check',
  description: 'Report the X-ray findings, note text, claim narrative and checks.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two plain sentences for billing: can this claim go out, and what helps it get paid.' },
      findings_note: { type: 'string', description: 'Radiographic findings for the note\'s Objective section: 1-4 sentences, clinical wording, only what is visible, supporting necessity and completion.' },
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
    required: ['summary', 'findings_note', 'claim_narrative', 'field_fills', 'phi_visible', 'images', 'checks', 'note_mismatches'],
  },
}

const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? (globalThis.Deno?.env?.get?.(k)) ?? globalThis.process?.env?.[k]
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function buildPrompt({ rules, proc, tooth, noteText, images, fields }) {
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
1. findings_note — Radiographic findings for the note's Objective section. Write in standard clinical charting language, 1-4 sentences, starting "Radiographic findings:". Describe what the images show that supports why the treatment was needed and that it was completed. Cover, where visible: ${FINDINGS_GUIDE[proc]}
   If a pre-op is an FMX/pano/bitewing rather than a single periapical, say what it does show (e.g. "FMX periapical of the area shows…") so the reviewer can use it.
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
      try { out = await runCheck({ key, model, proc, rules, images, fields, tooth: body.tooth, noteText: body.noteText }) }
      catch (e) { out = { ok: false, error: 'X-ray check crashed: ' + String(e?.message || e).slice(0, 300) } }
      clearInterval(ping)
      ctrl.enqueue(enc.encode(JSON.stringify(out)))
      ctrl.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
}

async function runCheck({ key, model, proc, rules, images, fields, tooth, noteText }) {
  const content = []
  images.forEach((im, i) => {
    content.push({ type: 'text', text: `Image ${i + 1} (uploaded as ${im.role || 'other'}${im.exposure && im.exposure !== 'good' ? `; original measured ${im.exposure.replace('_', ' ')}, contrast-balanced for reading` : ''}):` })
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })
  })
  content.push({ type: 'text', text: buildPrompt({ rules, proc, tooth: String(tooth || '').slice(0, 20), noteText, images, fields }) })

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
  result.findings_note = String(result.findings_note || '').trim().slice(0, 1200)
  result.claim_narrative = String(result.claim_narrative || '').trim().slice(0, 400)
  return { ok: true, procedure: proc, model, rules, result }
}

export const config = { path: '/api/xray-check' }
