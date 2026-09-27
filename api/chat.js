export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messages, system } = req.body || {};
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Missing or invalid messages array' });
  }

  // Server-side security & payload validation
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  if (!lastUserMessage || !lastUserMessage.content || typeof lastUserMessage.content !== 'string') {
    return res.status(400).json({ error: 'A valid user message is required' });
  }

  // Guard against massive payloads / token drain attacks (max 12,000 characters per request)
  if (lastUserMessage.content.length > 12000) {
    return res.status(413).json({ error: 'Message payload too large. Please shorten your text.' });
  }

  // Cap message history length to avoid token waste
  const trimmedMessages = messages.slice(-10);

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    console.error('GROQ_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured in environment variables' });
  }

  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b',
        messages: [
          { role: 'system', content: system || 'You are StudyTools AI Tutor, an expert, friendly academic tutor. Explain concepts clearly step by step, guide students to understand the underlying principles, and provide structured, pedagogical answers.' },
          ...trimmedMessages
        ],
        max_tokens: 1500,
        temperature: 0.6
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Groq API error:', errorText);
      return res.status(response.status).json({
        error: 'The AI service is momentarily busy. Please try again in a few moments.'
      });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from AI engine' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Groq error:', error);
    return res.status(500).json({ error: 'Unable to process your request. Please try again.' });
  }
}

