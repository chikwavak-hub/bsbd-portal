// netlify/functions/ai-email.js
// CommonJS format (no "export" — works without package.json type:module)

const handler = async (event) => {
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, body: 'Method not allowed' }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey)
    return { statusCode: 500, body: JSON.stringify({ error: 'API key not configured' }) }

  try {
    const { prompt } = JSON.parse(event.body || '{}')
    if (!prompt)
      return { statusCode: 400, body: JSON.stringify({ error: 'No prompt' }) }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-5-20250929',
        max_tokens: 1000,
        messages:   [{ role: 'user', content: prompt }],
      }),
    })

    const data = await res.json()
    if (!res.ok)
      return { statusCode: res.status, body: JSON.stringify({ error: data.error?.message || 'API error' }) }

    const text = (data.content || []).find(c => c.type === 'text')?.text || ''
    return {
      statusCode: 200,
      headers:    { 'Content-Type': 'application/json' },
      body:       JSON.stringify({ text }),
    }
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}

exports.handler = handler
