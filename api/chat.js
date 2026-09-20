export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages' });
  }

  const apiKey = process.env.TOGETHER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
        messages: [
          { role: 'system', content: system || 'You are a helpful AI study assistant.' },
          ...messages
        ],
        max_tokens: 1500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        error: err.error?.message || 'Together AI error'
      });
    }

    const data  = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Together AI' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Together AI error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
