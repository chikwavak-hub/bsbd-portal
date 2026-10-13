// netlify/edge-functions/xray-check.js — X-ray claim check for the Note Builder.
//
// Takes the claim's attached images (already resized and name-redacted in the
// browser) plus the procedure, tooth and note text, and asks Claude to check
// them against what TennCare reviewers want to see. This is a CLAIM QUALITY
// check, not a diagnosis: the dentist remains the reader and signs.
//
// Request  POST /api/xray-check
//   { procedure: 'rct'|'crown'|'ext_surgical'|'ext_simple'|'filling'|'srp'|'other',
//     tooth: '19', noteText: '...',
//     images: [{ role: 'preop'|'postop'|'other', mediaType: 'image/jpeg', data: '<base64>' }] }
// Response { ok: true, rules: {...}, result: {...} }  |  { ok: false, error }
//
// Env: ANTHROPIC_API_KEY (required), XRAY_MODEL (optional, default below).

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_IMAGES = 6
const MAX_B64 = 6_500_000 // ~4.9 MB decoded; the API limit is 5 MB per image

// Checks per procedure. risk: high = likely denial if it fails.
export const RULES = {
  rct: {
    label: 'Root canal',
    needs: ['preop', 'postop'],
    checks: [
      { id: 'preop_present',   risk: 'high',   label: 'Pre-op periapical of the treated tooth is attached' },
      { id: 'not_survey_only', risk: 'high',   label: 'Tooth-specific periapical, not only an FMX collage, pano or bitewing' },
      { id: 'preop_apex',      risk: 'high',   label: 'Pre-op shows the full root(s) and apex with surrounding bone' },
      { id: 'preop_findings',  risk: 'medium', label: 'Pre-op shows findings consistent with the note (deep caries or restoration near the pulp, periapical radiolucency, etc.)' },
      { id: 'postop_present',  risk: 'high',   label: 'Post-op periapical is attached' },
      { id: 'postop_fill',     risk: 'high',   label: 'Post-op shows root canal fill in the canals, reaching close to the apex' },
      { id: 'canal_count',     risk: 'medium', label: 'Number of filled canals visible matches the note' },
      { id: 'same_tooth',      risk: 'medium', label: 'Pre-op and post-op appear to show the same tooth and region' },
      { id: 'quality',         risk: 'medium', label: 'Images are diagnostic quality (not cut off, blurred, too dark or overexposed)' },
    ],
  },
  crown: {
    label: 'Crown',
    needs: ['preop', 'postop'],
    checks: [
      { id: 'preop_present',   risk: 'high',   label: 'Pre-op image of the crowned tooth is attached' },
      { id: 'preop_tooth',     risk: 'high',   label: 'Pre-op shows the whole crown and roots of the tooth' },
      { id: 'preop_justify',   risk: 'medium', label: 'Pre-op shows a reason for a crown (large restoration, fracture, extensive decay, or prior root canal)' },
      { id: 'postop_present',  risk: 'high',   label: 'Post-op image is attached' },
      { id: 'postop_crown',    risk: 'high',   label: 'Post-op shows the crown seated with visible margins' },
      { id: 'rct_mentioned',   risk: 'low',    label: 'If a root canal is visible on the tooth, the note mentions it' },
      { id: 'quality',         risk: 'medium', label: 'Images are diagnostic quality' },
    ],
  },
  ext_surgical: {
    label: 'Surgical extraction',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   risk: 'high',   label: 'Pre-op periapical or pano showing the tooth is attached' },
      { id: 'preop_roots',     risk: 'high',   label: 'Pre-op shows the full roots and surrounding bone' },
      { id: 'surgical_justify',risk: 'medium', label: 'Image supports a surgical approach (impaction, curved or divergent roots, tooth broken to bone, near sinus or nerve)' },
      { id: 'quality',         risk: 'medium', label: 'Images are diagnostic quality' },
    ],
  },
  ext_simple: {
    label: 'Simple extraction',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   risk: 'high',   label: 'Pre-op image showing the tooth is attached' },
      { id: 'preop_roots',     risk: 'medium', label: 'Pre-op shows the roots of the tooth' },
      { id: 'quality',         risk: 'medium', label: 'Images are diagnostic quality' },
    ],
  },
  filling: {
    label: 'Filling',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   risk: 'medium', label: 'Pre-op bitewing or periapical is attached' },
      { id: 'decay_visible',   risk: 'medium', label: 'Image shows decay or a failing restoration consistent with the note' },
      { id: 'quality',         risk: 'low',    label: 'Images are diagnostic quality' },
    ],
  },
  srp: {
    label: 'Scaling and root planing',
    needs: ['preop'],
    checks: [
      { id: 'preop_present',   risk: 'high',   label: 'FMX or bitewings covering the treated quadrants are attached' },
      { id: 'bone_loss',       risk: 'high',   label: 'Radiographic bone loss and/or calculus is visible' },
      { id: 'quality',         risk: 'medium', label: 'Images are diagnostic quality' },
    ],
  },
  other: {
    label: 'Other procedure',
    needs: [],
    checks: [
      { id: 'supports_note',   risk: 'medium', label: 'Images are consistent with the procedure in the note' },
      { id: 'quality',         risk: 'medium', label: 'Images are diagnostic quality' },
    ],
  },
}

const TOOL = {
  name: 'report_xray_check',
  description: 'Report the X-ray claim check results.',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Two or three plain sentences for the billing team.' },
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
            quality: { type: 'string', enum: ['good', 'fair', 'poor'] },
            treatment_visible: { type: 'string', description: 'What treatment is visible, e.g. "root canal fill, 3 canals", "PFM crown", "none".' },
            issues: { type: 'array', items: { type: 'string' } },
          },
          required: ['index', 'image_type', 'appears_to_be', 'apex_visible', 'quality', 'treatment_visible', 'issues'],
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
          },
          required: ['id', 'status', 'detail'],
        },
      },
      note_mismatches: { type: 'array', items: { type: 'string' }, description: 'Places where the images contradict the note. Empty if none or no note given.' },
    },
    required: ['summary', 'phi_visible', 'images', 'checks', 'note_mismatches'],
  },
}

const env = k => (globalThis.Deno?.env?.get?.(k)) ?? globalThis.process?.env?.[k]
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function buildPrompt(proc, rules, tooth, noteText, images) {
  const imgList = images.map((im, i) => `Image ${i + 1}: uploaded as "${im.role}"`).join('\n')
  const checks = rules.checks.map(c => `- ${c.id}: ${c.label}`).join('\n')
  return `You are helping a dental billing team check that X-rays attached to an insurance claim support the claim BEFORE it is sent to TennCare (Tennessee Medicaid), whose dentist reviewers deny claims with missing, wrong or poor images.

This is a claim-quality check, not a diagnosis. The treating dentist remains responsible for reading the images. Be conservative: when you cannot tell, use "unclear" rather than guessing. Do not try to determine the tooth number from anatomy unless the image is labeled; judge only whether pre-op and post-op appear to show the same tooth and region.

Procedure: ${rules.label}${tooth ? `, tooth ${tooth}` : ''}
Images (in order):
${imgList}

Run each check and report it by id:
${checks}

Also:
- For each image, classify the type, whether it looks pre-op or post-op, apex visibility, quality, and visible treatment.
- Set phi_visible true if any patient name, date of birth or chart ID is readable on an image.
- If a note is given, list any place the images contradict it (canal count, tooth area, treatment present or absent). Do not list things the note simply omits.
- If an image the procedure needs is not attached, mark that check "fail".
${noteText ? `\nClinical note:\n"""\n${String(noteText).slice(0, 8000)}\n"""` : '\nNo note was provided.'}

Report with the report_xray_check tool.`
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)
  const key = env('ANTHROPIC_API_KEY')
  if (!key) return json({ ok: false, error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables' }, 500)

  let body
  try { body = await request.json() } catch { return json({ ok: false, error: 'Invalid JSON body' }, 400) }

  const proc = RULES[body.procedure] ? body.procedure : 'other'
  const rules = RULES[proc]
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : []
  if (!images.length) return json({ ok: false, error: 'Attach at least one image' }, 400)
  for (const im of images) {
    if (!/^image\/(jpeg|png|webp|gif)$/.test(im.mediaType || '')) return json({ ok: false, error: 'Images must be JPEG or PNG' }, 400)
    if (!im.data || im.data.length > MAX_B64) return json({ ok: false, error: 'An image is empty or too large' }, 400)
  }

  const content = []
  images.forEach((im, i) => {
    content.push({ type: 'text', text: `Image ${i + 1} (uploaded as ${im.role || 'other'}):` })
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })
  })
  content.push({ type: 'text', text: buildPrompt(proc, rules, String(body.tooth || '').slice(0, 20), body.noteText, images) })

  let res, data
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env('XRAY_MODEL') || DEFAULT_MODEL,
        max_tokens: 3000,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: TOOL.name },
        messages: [{ role: 'user', content }],
      }),
    })
    data = await res.json()
  } catch (e) {
    return json({ ok: false, error: 'Could not reach the AI service: ' + String(e?.message || e) }, 502)
  }
  if (!res.ok) return json({ ok: false, error: data?.error?.message || `AI service error ${res.status}` }, 502)

  const tool = (data.content || []).find(c => c.type === 'tool_use' && c.name === TOOL.name)
  if (!tool) return json({ ok: false, error: 'The AI did not return a result. Try again.' }, 502)

  // Make sure every rule has a status, even if the model skipped one.
  const result = tool.input || {}
  const got = new Map((result.checks || []).map(c => [c.id, c]))
  result.checks = rules.checks.map(c => got.get(c.id) || { id: c.id, status: 'unclear', detail: 'Not assessed.' })
  result.images = Array.isArray(result.images) ? result.images : []
  result.note_mismatches = Array.isArray(result.note_mismatches) ? result.note_mismatches : []

  return json({ ok: true, procedure: proc, rules, result })
}

export const config = { path: '/api/xray-check' }
