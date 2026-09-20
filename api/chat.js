export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages' });
  }

  const apiKey = process.env.HUGGINGFACE_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const response = await fetch('https://api-inference.huggingface.co/models/meta-llama/Meta-Llama-3.1-70B-Instruct', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        inputs: system + '\n\n' + messages.map(m => `${m.role}: ${m.content}`).join('\n'),
        parameters: {
          max_new_tokens: 1500,
          temperature: 0.7
        }
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        error: err.error || 'Hugging Face API error'
      });
    }

    const data  = await response.json();
    const reply = data[0]?.generated_text || '';

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Hugging Face' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Hugging Face error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
