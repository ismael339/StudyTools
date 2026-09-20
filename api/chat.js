export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, system } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing messages' });
  }

  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) {
    console.error('COHERE_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured in environment variables' });
  }

  console.log('Using Cohere API key:', apiKey.substring(0, 10) + '...');

  try {
    const response = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Client-Name': 'StudyTools'
      },
      body: JSON.stringify({
        message: messages[messages.length - 1].content,
        chat_history: messages.slice(0, -1).map(m => ({
          role: m.role === 'assistant' ? 'CHATBOT' : 'USER',
          message: m.content
        })),
        preamble: system || 'You are a helpful AI study assistant.',
        model: 'command-r',
        max_tokens: 1500,
        temperature: 0.7
      })
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Cohere API error:', errorText);
      return res.status(response.status).json({
        error: `Cohere API error: ${errorText}`
      });
    }

    const data  = await response.json();
    console.log('Cohere response:', data);

    const reply = data.text || '';

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Cohere' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Cohere error:', error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}
