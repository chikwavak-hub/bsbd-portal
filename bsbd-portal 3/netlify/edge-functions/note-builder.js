// netlify/edge-functions/note-builder.js
// Note Builder AI call. Runs as a Netlify Edge Function so the response can
// stream: a full template fill takes 20-60 s, past the 10 s limit on regular
// Netlify functions. The Anthropic stream (SSE) is passed straight through to
// the browser, which assembles the text. Nothing is stored or logged here.
//
// Env vars (Netlify > Site configuration > Environment variables):
//   ANTHROPIC_API_KEY  required (already set for the other AI functions)
//   NOTE_MODEL         optional, defaults to claude-sonnet-5-5

const MAX_PROMPT_CHARS = 400000
const MAX_FILES = 8

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Only accept calls from the portal's own pages.
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(req.url).host) return json({ error: 'Forbidden' }, 403)
    } catch { return json({ error: 'Forbidden' }, 403) }
  }

  const apiKey = Netlify.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not configured' }, 500)
  const model = Netlify.env.get('NOTE_MODEL') || 'claude-sonnet-5-5'

  let body
  try { body = await req.json() } catch { return json({ error: 'Bad JSON' }, 400) }
  const prompt = String(body.prompt || '')
  const images = Array.isArray(body.images) ? body.images : []
  const pdfs = Array.isArray(body.pdfs) ? body.pdfs : []
  if (!prompt) return json({ error: 'No prompt' }, 400)
  if (prompt.length > MAX_PROMPT_CHARS) return json({ error: 'Records are too long. Trim them and try again.' }, 413)
  if (images.length + pdfs.length > MAX_FILES) return json({ error: `Send at most ${MAX_FILES} screenshots or PDFs at once.` }, 413)

  const content = [
    ...pdfs.map(d => ({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: String(d) } })),
    ...images.map(i => ({ type: 'image', source: { type: 'base64', media_type: String(i.media_type || 'image/png'), data: String(i.data) } })),
    { type: 'text', text: prompt },
  ]

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 8000, stream: true, messages: [{ role: 'user', content }] }),
  })

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    return json({ error: `Claude API error ${upstream.status}`, detail: text.slice(0, 500) }, 502)
  }

  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
  })
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}

export const config = { path: '/api/note-builder' }
