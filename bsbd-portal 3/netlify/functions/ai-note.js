// netlify/functions/ai-note.js — dental scribe. Takes a free-speech dictation
// and composes a COMPLETE, chart-ready clinical note for the selected
// procedure, plus best-effort form-field values and a list of missing
// payment-critical elements. ES module. Nothing is stored.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) }
  try {
    const { transcript, template } = JSON.parse(event.body || '{}')
    if (!transcript || !template) return { statusCode: 400, body: JSON.stringify({ error: 'transcript and template required' }) }

    const schema = (template.fields || []).map(f => {
      const base = { id: f.id, label: f.label, type: f.type }
      if (f.options) base.options = f.options
      if (f.pay) base.payment_requirement = f.pay
      return base
    })

    const prompt = `You are an expert dental scribe for a general dental practice. A dental assistant or dentist has dictated the details of a completed procedure. Compose a COMPLETE, chart-ready clinical note.

PROCEDURE TYPE: ${template.label} (${template.codes})
KNOWN PAYER REQUIREMENTS for this procedure (fields marked payment_requirement are what insurance reviewers look for):
${JSON.stringify(schema, null, 1)}

DICTATION:
"""${String(transcript).slice(0, 8000)}"""

Return ONLY JSON (no markdown fences):
{
  "note": "<the complete clinical note, plain text with line breaks>",
  "values": { "<fieldId>": <value>, ... },
  "missing": [ { "label": "<element>", "why": "<payer reason>" } ]
}

HOW TO WRITE THE NOTE:
1. INTERPRET, don't transcribe. Understand collective and shorthand statements: "all four canals were 21" means four canals each with working length 21 mm — write "Four canals located and instrumented, all to WL 21 mm (ref: cusp tips unless stated)". "Cold lingered like 40 seconds" → "Cold test: lingering response ~40 s". Clean all dictation artifacts.
2. Structure: a header line (procedure + tooth/site), diagnosis line(s), anesthesia/isolation, chronological procedure narrative, materials, radiographic verification if applicable, patient tolerance, post-op instructions, next steps. Professional, concise clinical voice — like an experienced dentist's chart note, not a form.
3. NEVER invent clinical facts: no diagnoses, measurements, materials, tooth numbers, or findings that weren't dictated. Standard non-clinical closures ("Patient tolerated the procedure well; post-operative instructions given") may be included unless contradicted.
4. If the dictation covers payer-required elements in ANY wording, weave them into the note prominently (crown age, failure evidence, pocket depths, bone loss, pulpal+periapical dx, canal lengths, flap/bone/sectioning...).
5. Where a payment-critical element was NOT dictated, do NOT fabricate it — leave it out of the note and list it in "missing" with the payer reason. Do not write placeholders inside the note.
6. "values": best-effort mapping of dictated facts onto the field schema (select → verbatim option string; multi → array of verbatim options; canals → "canalRows": [{"name","wl","ref","maf"}] — if canals were stated collectively, enumerate rows using stated or conventional names (molar: MB, ML/MB2, DB, D/P as appropriate) with the shared length).
7. Never include patient names or identifiers anywhere in the output, even if spoken.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) {
      console.error('Claude API error', res.status, JSON.stringify(data).slice(0, 300))
      return { statusCode: 502, body: JSON.stringify({ error: data.error?.message || ('API error ' + res.status) }) }
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const clean = text.replace(/```json|```/g, '').trim()
    let out
    try { out = JSON.parse(clean) }
    catch {
      // salvage: if the model returned prose, use it as the note directly
      if (clean.length > 80) out = { note: clean, values: {}, missing: [] }
      else return { statusCode: 200, body: JSON.stringify({ error: 'Scribe did not return a usable note' }) }
    }
    return { statusCode: 200, body: JSON.stringify(out) }
  } catch (e) {
    console.error('ai-note crash:', e.message)
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
