// netlify/functions/ai-note.js — maps a dictated clinical transcript onto a
// Smart Notes template's fields. Uses node https (no fetch dependency) so it
// runs on any Node version. Returns {values: {fieldId: value}} with option
// values matched EXACTLY to the template's options. Nothing is stored.

const https = require('https')

function callClaude(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      timeout: 9000,
    }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(data) }) }
        catch (e) { reject(new Error('Bad API response')) }
      })
    })
    req.on('timeout', () => { req.destroy(new Error('Claude API timeout')) })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) }
  try {
    const { transcript, template } = JSON.parse(event.body || '{}')
    if (!transcript || !template) return { statusCode: 400, body: JSON.stringify({ error: 'transcript and template required' }) }

    const schema = (template.fields || []).map(f => {
      const base = { id: f.id, label: f.label, type: f.type }
      if (f.options) base.options = f.options
      return base
    })

    const prompt = `You are filling a dental clinical note template from a dictated transcript by a dental assistant or dentist.

TEMPLATE: ${template.label} (${template.codes})
FIELDS (schema): ${JSON.stringify(schema)}

TRANSCRIPT:
"""${String(transcript).slice(0, 6000)}"""

Return ONLY JSON (no markdown, no backticks):
{ "values": { "<fieldId>": <value>, ... } }

RULES:
1. Only include fields the transcript actually provides information for. Never invent clinical facts.
2. type "text" / "num" -> string/number value. Clean dictation artifacts ("number thirty" -> "30", "twenty one and a half millimeters" -> "21.5").
3. type "select" -> EXACTLY ONE string copied verbatim from that field's options (closest match; omit if none fits).
4. type "multi" -> array of strings copied VERBATIM from the options. Match meaning, not wording ("bleeding when we probed everywhere" -> "Bleeding on probing generalized").
5. type "canals" -> key "canalRows": array of {"name":"MB","wl":"21","ref":"cusp tip","maf":"35"}. Common canal names: MB, MB2, DB, P, D, M, ML, DL, B; single canal = "Canal". Omit ref if unstated.
6. Tooth numbers: just the number(s), with surfaces if stated ("#30 MO").
7. Free-text clinical details (symptoms, radiographic findings, extra anatomy): summarize faithfully in clinical language in the matching text field.
8. Never include patient names or identifiers in any value, even if spoken.`

    const { status, json } = await callClaude({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })
    if (status !== 200) {
      console.error('Claude API error', status, JSON.stringify(json).slice(0, 300))
      return { statusCode: 502, body: JSON.stringify({ error: json?.error?.message || ('API error ' + status) }) }
    }
    const text = (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const clean = text.replace(/```json|```/g, '').trim()
    let out
    try { out = JSON.parse(clean) }
    catch { return { statusCode: 200, body: JSON.stringify({ error: 'Extraction did not return valid JSON' }) } }
    return { statusCode: 200, body: JSON.stringify(out) }
  } catch (e) {
    console.error('ai-note crash:', e.message)
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
