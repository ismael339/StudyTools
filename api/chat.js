export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured in environment variables' });
  }

  console.log('Using Groq API key:', apiKey.substring(0, 10) + '...');

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [
          { role: 'system', content: system || 'You are a helpful AI study assistant.' },
          ...messages
        ],
        max_tokens: 1500,
        temperature: 0.7
      })
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API error:', errorText);
      return res.status(response.status).json({
        error: `Groq API error: ${errorText}`
      });
    }

    const data  = await response.json();
    console.log('Groq response:', data);

    const reply = data.choices?.[0]?.message?.content || '';

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Groq' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Groq error:', error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}
