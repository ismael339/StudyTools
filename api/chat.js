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
    // Use OpenAI-compatible format that Hugging Face supports
    const response = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'mistralai/Mistral-7B-Instruct-v0.2',
        messages: [
          { role: 'system', content: system || 'You are a helpful AI study assistant.' },
          ...messages
        ],
        max_tokens: 1500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Hugging Face API error:', errorText);
      return res.status(response.status).json({
        error: `Hugging Face API error: ${errorText}`
      });
    }

    const data  = await response.json();
    console.log('Hugging Face response:', data);

    const reply = data.choices?.[0]?.message?.content || '';

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Hugging Face' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Hugging Face error:', error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}
