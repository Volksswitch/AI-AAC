const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const NUM_OPTIONS = 3;

let apiKey = null;
let onUsageUpdate = null;

export function setApiKey(key) {
    apiKey = key;
}

export function onUsage(callback) {
    onUsageUpdate = callback;
}

function trackUsage(data) {
    if (!data.usage || !onUsageUpdate) return;
    onUsageUpdate(data.usage.input_tokens, data.usage.output_tokens);
}

export async function cleanupTranscript(rawText, conversationHistory) {
    if (!apiKey) return rawText;

    const contextLines = conversationHistory.slice(-6).map(entry =>
        `${entry.role === 'partner' ? 'Partner' : 'User'}: ${entry.text}`
    ).join('\n');

    const systemPrompt = `You are cleaning up a speech-to-text transcript from a live conversation. The transcript may contain:
- Missing or incorrect punctuation and capitalization
- Words the speech recognizer misheard (e.g., "Kmart" instead of "Hey Mark", "eye pad" instead of "iPad")

Use the conversation context to identify likely mishearings and correct them. Apply proper punctuation and capitalization. Keep corrections conservative — only fix words that are clearly wrong given the context. Do not add, remove, or rephrase beyond correcting recognition errors.

Return ONLY the corrected transcript text, nothing else.${contextLines ? '\n\nConversation so far:\n' + contextLines : ''}`;

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
            max_tokens: 200,
            system: systemPrompt,
            messages: [{ role: 'user', content: rawText }]
        })
    });

    if (!response.ok) return rawText;

    const data = await response.json();
    trackUsage(data);
    return data.content[0].text.trim();
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
    trackUsage(data);
    const text = data.content[0].text.trim();

    try {
        return JSON.parse(text);
    } catch {
        const match = text.match(/\[[\s\S]*\]/);
        if (match) return JSON.parse(match[0]);
        throw new Error('Could not parse response options from API');
    }
}
