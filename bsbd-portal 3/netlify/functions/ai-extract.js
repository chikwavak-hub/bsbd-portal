// netlify/functions/ai-extract.js — eligibility faxback extraction.
// Receives a base64 PDF/image, returns structured benefit fields where EVERY
// field carries { value, confidence, quote } — the verbatim text from the
// document that justifies it. Nothing is guessed silently: if it isn't in
// the document, the field comes back null with confidence 0.

const FIELDS_SPEC = `{
  "carrier": {"value": string|null, "confidence": 0-100, "quote": string|null},
  "member_id": {...same shape...},
  "group_number": {...},
  "plan_year_start": {...},              // "01/01" if calendar year
  "deductible_total": {... value is a number ...},
  "deductible_remaining": {...},
  "deductible_waived_preventive": {... value is true/false ...},
  "annual_max": {...},
  "max_remaining": {...},
  "cov_preventive": {... value is number % insurance pays ...},
  "cov_basic": {...},
  "cov_major": {...},
  "cov_implant": {... null if implants not covered/not stated; 0 if explicitly excluded ...},
  "cov_perio": {...},
  "cov_denture": {...},
  "mtc": {... true if missing tooth clause present, false if explicitly none, null if not stated ...},
  "missing_teeth": {...},
  "waiting_periods": {... value is a short text summary, or "none" ...},
  "downgrade_posterior": {...},
  "freq_prophy": {... value is text of the stated frequency e.g. "2 per 12 months" ...},
  "freq_bwx": {...},
  "freq_fmx": {...},
  "freq_srp": {...},
  "freq_denture": {... e.g. "1 per 5 years" ...}
}`

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) }
  try {
    const { fileBase64, mimeType, fileName } = JSON.parse(event.body || '{}')
    if (!fileBase64) return { statusCode: 400, body: JSON.stringify({ error: 'fileBase64 required' }) }

    const isPdf = (mimeType || '').includes('pdf')
    const contentBlock = isPdf
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fileBase64 } }
      : { type: 'image', source: { type: 'base64', media_type: mimeType || 'image/png', data: fileBase64 } }

    const prompt = `You are extracting dental insurance eligibility data from a carrier faxback/breakdown document ("${fileName || 'upload'}").

Extract into EXACTLY this JSON shape (no markdown, no backticks, JSON only):
${FIELDS_SPEC}

STRICT RULES — this extraction backs real financial decisions:
1. "quote" must be VERBATIM text copied from the document that supports the value. If you cannot point to text, value=null, confidence=0, quote=null.
2. NEVER infer or assume standard values. If the document doesn't state it, it is null.
3. confidence: 90-100 only when the quote states it unambiguously; 50-89 when stated but formatting is ambiguous; below 50 when uncertain.
4. Percentages are the INSURANCE share (plan pays X%).
5. Dollar values as plain numbers (1500 not "$1,500").
6. If the document is not an eligibility/benefits document at all, return {"not_eligibility_doc": true}.`

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
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: prompt }] }],
      }),
    })
    const data = await res.json()
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) }

    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    const clean = text.replace(/```json|```/g, '').trim()
    let extracted
    try { extracted = JSON.parse(clean) }
    catch { return { statusCode: 200, body: JSON.stringify({ error: 'Extraction did not return valid JSON', raw: clean.slice(0, 500) }) } }

    return { statusCode: 200, body: JSON.stringify({ extracted }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
