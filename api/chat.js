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
    console.error('HUGGINGFACE_API_KEY not configured');
    return res.status(500).json({ error: 'API key not configured in environment variables' });
  }

  console.log('Using Hugging Face API key:', apiKey.substring(0, 10) + '...');

  try {
    // Use basic Hugging Face Inference API endpoint
    const response = await fetch('https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        inputs: system + '\n\n' + messages.map(m => `${m.role}: ${m.content}`).join('\n'),
        parameters: {
          max_new_tokens: 1500,
          temperature: 0.7,
          return_full_text: false
        }
      })
    });

    console.log('Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Hugging Face API error:', errorText);
      return res.status(response.status).json({
        error: `Hugging Face API error: ${errorText}`
      });
    }

    const data  = await response.json();
    console.log('Hugging Face response:', data);

    // Handle different response formats
    let reply = '';
    if (Array.isArray(data) && data[0]) {
      reply = data[0].generated_text || '';
    } else if (data.generated_text) {
      reply = data.generated_text;
    } else if (data[0]?.generated_text) {
      reply = data[0].generated_text;
    }

    console.log('Extracted reply:', reply);

    if (!reply) {
      return res.status(500).json({ error: 'Empty response from Hugging Face' });
    }

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('Hugging Face error:', error);
    return res.status(500).json({ error: `Internal server error: ${error.message}` });
  }
}
