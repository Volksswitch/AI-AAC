const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const NUM_OPTIONS = 3;

let apiKey = null;

export function setApiKey(key) {
    apiKey = key;
}

export async function generateResponses(conversationHistory) {
    if (!apiKey) throw new Error('API key not set');

    const systemPrompt = `You are an AAC (Augmentative and Alternative Communication) assistant. A non-speaking user is in a live conversation. Their communication partner just spoke. Generate exactly ${NUM_OPTIONS} natural response options the user might want to say.

Rules:
- Each response should be a complete, natural conversational reply
- Vary the responses: include different tones or directions the conversation could go
- Keep responses concise — these will be spoken aloud
- The first option should be your best guess at what the user most likely wants to say
- Return ONLY a JSON array of strings, no other text

Example format: ["response 1", "response 2", "response 3"]`;

    const messages = conversationHistory.map(entry => ({
        role: entry.role === 'partner' ? 'user' : 'assistant',
        content: entry.text
    }));

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 300,
            system: systemPrompt,
            messages
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content[0].text.trim();
    return JSON.parse(text);
}
