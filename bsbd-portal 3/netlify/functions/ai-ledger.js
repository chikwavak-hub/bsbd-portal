// netlify/functions/ai-ledger.js — ledger balance audit narrative.
// Receives the parsed ledger (meta, totals, visits, attribution, flags) and
// returns a detailed, transaction-cited explanation. Reachable directly at
// /.netlify/functions/ai-ledger — no netlify.toml redirect needed.

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) }
  try {
    const payload = JSON.parse(event.body || '{}')
    if (!payload.attribution) return { statusCode: 400, body: JSON.stringify({ error: 'parsed ledger payload required' }) }

    const prompt = `You are a senior dental revenue-cycle auditor writing a balance workup for the billing team.

PARSED LEDGER DATA (deterministic, already reconciled to the penny — trust it, cite it, do not recalculate):
${JSON.stringify(payload).slice(0, 90000)}

Write the workup in this exact structure:

**BOTTOM LINE** — one sentence: the final balance, who owes whom, and the single main cause.

**BALANCE ATTRIBUTION** — for EACH row in "attribution.rows": one short paragraph citing the visit date, procedure codes, charge total, what insurance paid/adjusted, what the patient paid, and exactly why a net amount remains. Use the dollar figures verbatim from the data.

**POSTING IRREGULARITIES** — cover each item in "flags": what it is, why it matters, what likely happened.

**INSURANCE STATUS** — note any claims not marked PAID and what they mean for the balance.

**ACTION LIST** — numbered, concrete, assignable steps (collect $X from patient / issue refund of $X / reverse posting dated Y / resubmit claim for visit Z / write off $X with reason). Each action must include a dollar amount and a date reference from the data.

Rules: never invent transactions, dates, or amounts not present in the data. If something cannot be determined from the data, say what document would resolve it (EOB, claim status, day sheet). Plain text, no markdown tables. Under 500 words.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1800,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (!res.ok) return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
    return { statusCode: 200, body: JSON.stringify({ text }) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
