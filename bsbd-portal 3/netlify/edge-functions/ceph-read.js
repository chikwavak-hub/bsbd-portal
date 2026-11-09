// netlify/edge-functions/ceph-read.js — reads a cephalometric analysis report for the Ortho module.
//
// The browser sends page images of the report with the patient's name / DOB already blacked out,
// plus the list of measurements on BSBD's ceph form. Claude returns the PATIENT'S measured value for
// each one it can find, the exact row text it read it from, and a confidence. Nothing is guessed:
// a measurement that is not in the report comes back as not found. Staff review every value before
// it goes into the chart.
//
// Request  POST /api/ceph-read
//   { images: [{ mediaType, data(base64) }], measures: [{ id, label, unit, norm, aliases: [] }] }
// Response (HTTP 200 once input is valid; spaces are streamed while Claude works, then the JSON)
//   { ok: true, model, result: { report_type, software, tracing_date, values: [{ id, value, unit, quote, confidence }], notes } }
//   | { ok: false, error }
//
// Env: ANTHROPIC_API_KEY (required). Model: CEPH_MODEL, else NOTE_MODEL, else the default below.

const DEFAULT_MODEL = 'claude-sonnet-5-5'
const MAX_IMAGES = 6
const MAX_B64 = 6_500_000
const MAX_MEASURES = 60

const env = k => (globalThis.Netlify?.env?.get?.(k)) ?? (globalThis.Deno?.env?.get?.(k)) ?? globalThis.process?.env?.[k]
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const TOOL = {
  name: 'report_ceph_values',
  description: "Report the patient's measured cephalometric values found in the report.",
  input_schema: {
    type: 'object',
    properties: {
      report_type: { type: 'string', description: 'Analysis name(s) shown on the report, e.g. "Steiner, McNamara". Empty if not shown.' },
      software: { type: 'string', description: 'Software or service that produced the report, if printed on it. Empty if not shown.' },
      tracing_date: { type: 'string', description: 'Date the tracing / analysis was done, as MM/DD/YYYY, only if printed on the report. Empty otherwise. Never a date of birth.' },
      values: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'The measurement id from the list provided.' },
            value: { type: ['number', 'null'], description: "The patient's measured value as a plain number. null if not in the report." },
            unit: { type: 'string', description: 'deg or mm, as printed.' },
            quote: { type: 'string', description: 'The row exactly as printed (label and numbers) that the value was read from. Empty if not found.' },
            confidence: { type: 'number', description: '0-100. 90+ only when the label clearly matches and the value column is unambiguous.' },
          },
          required: ['id', 'value', 'confidence'],
        },
      },
      notes: { type: 'string', description: 'One or two plain sentences for staff: anything unclear, e.g. a measurement defined differently from the form.' },
    },
    required: ['values'],
  },
}

function buildPrompt(measures) {
  const list = measures.map(m => `- ${m.id}: ${m.label} (${m.unit}; BSBD norm ${m.norm})${m.aliases.length ? ` — also printed as: ${m.aliases.join(', ')}` : ''}`).join('\n')
  return `You are reading a cephalometric analysis report for a dental office. Patient identifiers have been blacked out.

Find the PATIENT'S MEASURED VALUE for each measurement below and report it with the report_ceph_values tool.

Measurements on the office's form:
${list}

Rules:
1. Report the patient's value only. Reports usually also print a norm / mean, a standard deviation and a difference column. Never return those. If you cannot tell which column is the patient's value, return the value you think is right with confidence below 50 and say why in notes.
2. Match by meaning, using the alternate names given. If the report measures something close but defined differently (for example SN-MP when the form says SN-GoMe), you may use it, but keep confidence at or below 75 and mention it in notes.
3. Do not calculate or convert anything. The one exception: "diff" may be read only if the report prints a maxillomandibular differential.
4. If a measurement is not in the report, return value null, confidence 0, empty quote.
5. Keep the sign of negative values (for example Wits -2.5).
6. tracing_date only if a tracing / analysis / exam date is printed. Never use a date of birth.
7. Return one entry for every id in the list.`
}

function jsonFromText(text) {
  const t = String(text || '').replace(/```(?:json)?/gi, '')
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}

export async function readCeph({ key, model, images, measures, fetchImpl = fetch }) {
  const content = []
  images.forEach((im, i) => {
    content.push({ type: 'text', text: `Report page ${i + 1}:` })
    content.push({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })
  })
  content.push({ type: 'text', text: buildPrompt(measures) })

  let res, data
  try {
    res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 4000, tools: [TOOL], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content }] }),
    })
    data = await res.json().catch(() => ({}))
  } catch (e) {
    return { ok: false, error: 'Could not reach the AI service: ' + String(e?.message || e) }
  }
  if (!res.ok) return { ok: false, error: `AI service error ${res.status} (model ${model}): ${data?.error?.message || 'no detail'}` }

  const tool = (data.content || []).find(c => c.type === 'tool_use' && c.name === TOOL.name)
  const raw = tool ? (tool.input || {}) : jsonFromText((data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'))
  if (!raw || !Array.isArray(raw.values)) return { ok: false, error: 'The AI did not return any values. Try again, or check the pages are readable.' }

  // One row per requested measurement, only known ids, numbers only.
  const got = new Map(raw.values.filter(v => v && v.id).map(v => [String(v.id), v]))
  const values = measures.map(m => {
    const v = got.get(m.id) || {}
    const num = typeof v.value === 'number' ? v.value : (v.value != null && v.value !== '' && !isNaN(Number(v.value)) ? Number(v.value) : null)
    return {
      id: m.id,
      value: num,
      unit: String(v.unit || m.unit || '').slice(0, 10),
      quote: num == null ? '' : String(v.quote || '').slice(0, 200),
      confidence: num == null ? 0 : Math.max(0, Math.min(100, Math.round(Number(v.confidence) || 0))),
    }
  })
  const date = String(raw.tracing_date || '').trim()
  return {
    ok: true,
    model,
    result: {
      report_type: String(raw.report_type || '').slice(0, 120),
      software: String(raw.software || '').slice(0, 80),
      tracing_date: /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(date) ? date : '',
      values,
      notes: String(raw.notes || '').slice(0, 600),
    },
  }
}

export default async function handler(request) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

  // Only accept calls from the portal's own pages (same rule as the other edge functions).
  const origin = request.headers.get('origin')
  if (origin) {
    try { if (new URL(origin).host !== new URL(request.url).host) return json({ ok: false, error: 'Forbidden' }, 403) }
    catch { return json({ ok: false, error: 'Forbidden' }, 403) }
  }

  const key = env('ANTHROPIC_API_KEY')
  if (!key) return json({ ok: false, error: 'ANTHROPIC_API_KEY is not set in Netlify environment variables' }, 500)

  let body
  try { body = await request.json() } catch { return json({ ok: false, error: 'Invalid JSON body' }, 400) }

  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : []
  if (!images.length) return json({ ok: false, error: 'Attach the report first' }, 400)
  for (const im of images) {
    if (!/^image\/(jpeg|png|webp)$/.test(im?.mediaType || '')) return json({ ok: false, error: 'Report pages must be JPEG or PNG images' }, 400)
    if (!im.data || im.data.length > MAX_B64) return json({ ok: false, error: 'A page is empty or too large' }, 400)
  }
  const measures = (Array.isArray(body.measures) ? body.measures : []).slice(0, MAX_MEASURES)
    .filter(m => m && m.id)
    .map(m => ({
      id: String(m.id).slice(0, 20), label: String(m.label || m.id).slice(0, 60), unit: String(m.unit || '').slice(0, 10),
      norm: String(m.norm || '').slice(0, 20), aliases: (Array.isArray(m.aliases) ? m.aliases : []).map(a => String(a).slice(0, 60)).slice(0, 8),
    }))
  if (!measures.length) return json({ ok: false, error: 'No measurements requested' }, 400)

  const model = env('CEPH_MODEL') || env('NOTE_MODEL') || DEFAULT_MODEL
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    async start(ctrl) {
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')) } catch {} }, 5000)
      ctrl.enqueue(enc.encode(' '))
      let out
      try { out = await readCeph({ key, model, images, measures }) }
      catch (e) { out = { ok: false, error: 'Ceph reader crashed: ' + String(e?.message || e).slice(0, 300) } }
      clearInterval(ping)
      ctrl.enqueue(enc.encode(JSON.stringify(out)))
      ctrl.close()
    },
  })
  return new Response(stream, { headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' } })
}

export const config = { path: '/api/ceph-read' }
