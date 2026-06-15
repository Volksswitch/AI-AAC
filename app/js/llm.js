const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const NUM_OPTIONS = 3;

let apiKey = null;
let onUsageUpdate = null;
let worldviewBlock = '';
let relationshipsBlock = '';

export function setApiKey(key) {
    apiKey = key;
}

// The compact worldview profile text (worldview.buildBlock()). Set fresh before
// each generation so questionnaire edits take effect immediately. This is the
// sole personalization channel now that the interim name/about fields are gone.
export function setWorldviewBlock(text) {
    worldviewBlock = (text || '').trim();
}

// The compact relationship-graph text (relationships.buildBlock()). Set fresh
// before each generation alongside the worldview block, so people edits take
// effect immediately. Private people are already withheld by buildBlock.
export function setRelationshipsBlock(text) {
    relationshipsBlock = (text || '').trim();
}

// Builds the personalization + placeholder-safety block appended to the
// response-generation system prompt. Even with no profile set, the
// no-brackets instruction prevents the model from emitting "[Name]" blanks.
function buildProfileBlock() {
    const sections = [];
    if (worldviewBlock) sections.push(`\n\n${worldviewBlock}`);
    if (relationshipsBlock) sections.push(`\n\n${relationshipsBlock}`);
    sections.push(`\n\nNever output placeholder text in square brackets such as [Name], [your name], or [city]. If you do not know a personal detail, phrase the response so it is not needed.`);
    return sections.join('');
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

// Single combined call: classify the partner's action AND generate options AND
// report which personal facts were missing (for the worldview gaps log).
// Returns { options: string[], classification: {fpp, about}, missingFacts: string[] }.
export async function generateResponses(conversationHistory) {
    if (!apiKey) throw new Error('API key not set');

    const systemPrompt = `You are an AAC (Augmentative and Alternative Communication) assistant. A non-speaking user is in a live conversation. Their communication partner just spoke. Generate exactly ${NUM_OPTIONS} natural response options the user might want to say.

Rules:
- Each response should be a complete, natural conversational reply
- Vary the responses: include different tones or directions the conversation could go
- Keep responses concise — these will be spoken aloud
- The first option should be your best guess at what the user most likely wants to say

Return ONLY a JSON object, no other text, with exactly this shape:
{"classification": {"fpp": "question|statement|request|greeting|closing|other", "about": "<1-3 word topic>"}, "options": ["...", "...", "..."], "missing_facts": ["<key>", ...]}

Where:
- "classification.fpp" is what the partner's utterance is doing; "about" is a short topic label.
- "options" is exactly ${NUM_OPTIONS} response strings following the rules above.
- "missing_facts" lists lowercase snake_case keys for personal facts about the user you needed to answer well but were not given (e.g. "home_city", "fav_team", "occupation"). Use [] if none. Always phrase the options around any missing fact — never output bracketed placeholders.${buildProfileBlock()}`;

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
            max_tokens: 500,
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
    return parseGeneration(data.content[0].text.trim());
}

// Robustly parse the structured generation output. Tolerates a bare array
// (legacy/best-effort) and stray prose around the JSON object.
function parseGeneration(text) {
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch {
        const obj = text.match(/\{[\s\S]*\}/);
        const arr = text.match(/\[[\s\S]*\]/);
        if (obj) { try { parsed = JSON.parse(obj[0]); } catch { /* fall through */ } }
        if (!parsed && arr) { try { parsed = JSON.parse(arr[0]); } catch { /* fall through */ } }
    }
    if (Array.isArray(parsed)) {
        return { options: parsed, classification: null, missingFacts: [] };
    }
    if (parsed && Array.isArray(parsed.options)) {
        return {
            options: parsed.options,
            classification: parsed.classification || null,
            missingFacts: Array.isArray(parsed.missing_facts) ? parsed.missing_facts : []
        };
    }
    throw new Error('Could not parse response options from API');
}
