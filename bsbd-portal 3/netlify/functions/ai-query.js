// netlify/functions/ai-query.js
// Analytics query function — reads pre-aggregated BSBD data, answers plain-English questions

const handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey)
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) }

  try {
    const { question, context } = JSON.parse(event.body || '{}')
    if (!question)
      return { statusCode: 400, body: JSON.stringify({ error: 'No question provided' }) }

    const systemPrompt = `You are an expert dental practice analytics assistant for Beautiful Smiles by Design (BSBD), a four-office dental group in Georgia and Tennessee (Brainerd, Calhoun, Dalton, McCallie).

You have access to pre-aggregated practice data provided in the user's message. Your job is to answer management questions clearly and directly.

RULES:
- Only use data provided. Never invent numbers.
- Lead with the direct answer (ranking, number, comparison).
- Be concise but complete. Use tables or lists when ranking.
- Highlight outliers, risks, or opportunities management should act on.
- If data is insufficient to answer, say exactly what's missing.
- Use dental practice terminology correctly.
- Format dollar amounts with $ and commas. Percentages with %.
- Keep responses under 400 words unless a detailed breakdown is needed.`

    const userPrompt = `PRACTICE DATA:
${JSON.stringify(context, null, 2)}

QUESTION: ${question}

Answer directly and concisely. Lead with the ranking or answer, then provide context and any management observations.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1200,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userPrompt }],
      }),
    })

    const data = await res.json()
    if (!res.ok)
      return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) }

    const text = (data.content || []).find(c => c.type === 'text')?.text || ''
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}

exports.handler = handler
