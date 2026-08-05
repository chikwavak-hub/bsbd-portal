// netlify/functions/ai-schedule.js — reads a Dentrix Appointment Book grid
// PDF (the visual calendar printout) and returns the day's appointment list.
// Used as automatic fallback when the deterministic schedule parser finds
// nothing — i.e., when the office sent the calendar print instead of the
// Schedule Data Report.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) }
  try {
    const { fileBase64, mimeType, fileName } = JSON.parse(event.body || '{}')
    if (!fileBase64) return { statusCode: 400, body: JSON.stringify({ error: 'fileBase64 required' }) }

    const isPdf = (mimeType || '').includes('pdf')
    const contentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/png', data: fileBase64 } }

    const prompt = `This is a dental practice Appointment Book calendar printout ("${fileName || 'schedule'}"). Columns are operatories (OP1, OP2, ...) with a provider name in each column header. Colored blocks are patient appointments.

Extract EVERY patient appointment across ALL pages into EXACTLY this JSON (no markdown, no backticks):
{
  "date": "YYYY-MM-DD or null",
  "office": "office name from the page title or null",
  "appointments": [
    {
      "patient_name": "Full Name (strip any trailing (age) number and any truncation artifacts; best full-name reading)",
      "appt_time": "H:MM AM/PM",
      "operatory": "OP1",
      "provider": "provider from the column header, e.g. Dr Chikwava, Laura, Melissa",
      "ins_status": "ACTIVE | PRIVATE | INACTIVE | null (from the block text)",
      "is_new_patient": true only if the block shows New! or similar,
      "is_unconfirmed": true if the column header or block indicates unconfirmed,
      "notes": "remaining block text: planned procedures, case notes, e.g. 'CompEx, FMX' or 'Case 2 V1: ExtErpTh+' — verbatim-ish, brief"
    }
  ]
}

RULES:
1. Include every real patient block on every page, including partially overlapped/lighter blocks if a patient name is readable.
2. EXCLUDE non-patient blocks: "NO PTS AT THIS TIME", "ADD NP ONLY", "NO 4TH COLUMN", "DR ... NOT HERE", "NO LAST HOUR", "SRP / GINGIVAL SCALE" placeholders with no patient name, "Practice Event", lunch/blocked time.
3. If a name is visibly truncated (e.g. "Joshua G"), output what is readable — do not invent the rest.
4. A patient whose block is crossed out or marked with an X/cancel icon: still include, with "is_unconfirmed": true and note "possibly cancelled".
5. Times come from the block's stated time, not the row gridline.
6. JSON only.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
      }),
    })
    const data = await res.json()
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const clean = text.replace(/```json|```/g, '').trim()
    let extracted
    try { extracted = JSON.parse(clean) }
    catch { return { statusCode: 200, body: JSON.stringify({ error: 'Schedule extraction did not return valid JSON', raw: clean.slice(0, 400) }) } }
    return { statusCode: 200, body: JSON.stringify(extracted) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
