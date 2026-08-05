// netlify/functions/ai-note.js — maps a dictated clinical transcript onto a
// Smart Notes template's fields. Receives the transcript plus the template's
// field schema; returns {values: {fieldId: value}} with option values matched
// EXACTLY to the template's option strings. No PHI is stored; nothing persists.

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
FIELDS (schema): ${JSON.stringify(schema, null, 1)}

TRANSCRIPT:
"""${transcript}"""

Return ONLY JSON (no markdown, no backticks):
{ "values": { "<fieldId>": <value>, ... } }

RULES:
1. Only include fields the transcript actually provides information for. Never invent clinical facts.
2. type "text" / "num" → string/number value. Clean up dictation artifacts ("number thirty" → "30", "twenty one and a half millimeters" → "21.5").
3. type "select" → EXACTLY ONE string copied verbatim from that field's options list (choose the closest match; if nothing matches, omit the field).
4. type "multi" → array of strings, each copied VERBATIM from the options list. Match meaning, not wording ("bleeding when we probed everywhere" → "Bleeding on probing generalized").
5. type "canals" → key "canalRows": array of {"name": "MB", "wl": "21", "ref": "cusp tip", "maf": "35"} objects. Common canal names: MB, MB2, DB, P (palatal), D, M, ML, DL, B, single canal = "Canal". If a reference point isn't stated, omit ref.
6. Tooth numbers: output just the number(s), with surfaces if stated ("#30 MO").
7. If the speaker states something that belongs in a free-text field (symptoms, radiographic findings, extra anatomy), summarize it faithfully in clinical language in that field.
8. Do not include patient names or identifiers in any value, even if spoken.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const clean = text.replace(/```json|```/g, '').trim()
    let out
    try { out = JSON.parse(clean) }
    catch { return { statusCode: 200, body: JSON.stringify({ error: 'Extraction did not return valid JSON' }) } }
    return { statusCode: 200, body: JSON.stringify(out) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
