const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

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

// Single combined call (Conversation-Engine-Design.docx §9): classify the
// partner's action AND generate a typed, slot-structured move palette AND report
// which personal facts were missing (worldview gaps log). The classification is
// emitted FIRST in the output so it is inspectable and so the model commits to
// the action type before producing moves (the CA recommendation as a structural
// property of the output).
//
// `context` is the engine's request context (design §9.1): { stt_confidence,
// sequence_stack, register, phase, last_user_utterance }. Optional.
//
// Returns { classification:{partner_action,turn_status,is_repair_initiator},
//           moves:[{slot,text,hint,...}], missingFacts:string[] }.
export async function generateResponses(conversationHistory, context = {}) {
    if (!apiKey) throw new Error('API key not set');

    const systemPrompt = `You are an AAC (Augmentative and Alternative Communication) assistant. A non-speaking user is in a live conversation. You speak AS the user, in their voice — not as a helpful assistant. Their communication partner just spoke. First classify what the partner is doing, then generate a palette of structurally distinct response moves the user might want to say.

Return ONLY a JSON object, no other text, with exactly this shape:
{
  "partner_action": "INVITATION|QUESTION|REQUEST|STATEMENT|GREETING|ASSESSMENT|CLOSING|OTHER",
  "turn_status": "COMPLETE|INCOMPLETE|CONTINUING",
  "is_repair_initiator": false,
  "moves": [
    {"slot": "PREFERRED", "text": "...", "hint": "..."},
    {"slot": "DISPREFERRED", "text": "...", "hint": "...", "account": true},
    {"slot": "INITIATIVE", "text": "...", "hint": "...", "format": "counter-offer|return-question|expansion"},
    {"slot": "REPAIR", "text": "...", "hint": "...", "trigger": "low_stt_confidence|uncertain_span|long_utterance|none"}
  ],
  "missing_facts": ["<key>", ...]
}

Classification (commit to these BEFORE writing moves):
- "partner_action": the first-pair-part type the partner's utterance performs.
- "turn_status": COMPLETE if the partner's turn is grammatically and pragmatically finished; INCOMPLETE if it trails off mid-utterance; CONTINUING if they are mid-telling, paused at a clause boundary.
- "is_repair_initiator": true ONLY if the partner is asking the USER to repeat or clarify the user's own last utterance ("What?", "Huh?", "You want what?", "Say that again?").

Moves (omit entirely — return "moves": [] — when turn_status is not COMPLETE, or when is_repair_initiator is true):
- "hint" is a short glanceable label naming the move (a few words), not a truncation of "text".
- PREFERRED: the most likely thing THIS user would say, delivered plainly, no hedging.
- DISPREFERRED: a properly formed reluctant / declining / disagreeing reply — a preface ("Well…", "Ah…"), the declination, and a brief account/reason. Never a bare "No."
- INITIATIVE: a move that stops the user being purely responsive — a counter-offer, a return question, or a topic expansion. Vary its grammatical format (conditional / declarative / interrogative) from the other moves.
- REPAIR: a clarification request on the PARTNER's turn — open-class ("Sorry?") when overall confidence is low, restricted ("Dinner where?") when a specific span is uncertain.

- "missing_facts": lowercase snake_case keys for personal facts about the user you needed but were not given (e.g. "home_city", "fav_team", "occupation"). Use [] if none. Always phrase moves around any missing fact — never output bracketed placeholders.

Conversation context (engine state — use it, do not echo it):
${JSON.stringify(context)}${buildProfileBlock()}`;

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
            max_tokens: 700,
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

// Repair-of-self (design §7.2): the partner asked the user to repeat/clarify.
// Re-speak verbatim needs no LLM (the app handles it); this call covers the
// "rephrase" and "expand" operations on the user's own last utterance.
export async function repairSelf(lastUserUtterance, op, conversationHistory = []) {
    if (!apiKey) throw new Error('API key not set');
    const instruction = op === 'expand'
        ? 'Expand and clarify the following thing the user just said, adding a little more detail so it is clearer. Keep it natural and in the user\'s own voice.'
        : 'Rephrase the following thing the user just said so it means the same but is worded differently and may be clearer. Keep it natural and in the user\'s own voice.';

    const contextLines = conversationHistory.slice(-4).map(entry =>
        `${entry.role === 'partner' ? 'Partner' : 'User'}: ${entry.text}`
    ).join('\n');

    const systemPrompt = `You are an AAC assistant speaking AS a non-speaking user. The partner did not understand the user's last spoken turn. ${instruction}

Return ONLY the new utterance text, nothing else.${buildProfileBlock()}${contextLines ? '\n\nConversation so far:\n' + contextLines : ''}`;

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
            messages: [{ role: 'user', content: lastUserUtterance }]
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    trackUsage(data);
    return data.content[0].text.trim();
}

// Robustly parse the structured generation output. Tolerates a bare array or a
// legacy {options:[...]} object (older builds / best-effort) by mapping it onto
// the slot palette, plus stray prose around the JSON object.
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

    const SLOTS = ['PREFERRED', 'DISPREFERRED', 'INITIATIVE', 'REPAIR'];

    // Legacy: a bare array of option strings.
    if (Array.isArray(parsed)) {
        return {
            classification: null,
            moves: parsed.map((t, i) => ({ slot: SLOTS[i] || 'PREFERRED', text: String(t), hint: '' })),
            missingFacts: [],
        };
    }

    if (parsed && typeof parsed === 'object') {
        const classification = {
            partner_action: parsed.partner_action || (parsed.classification && parsed.classification.fpp) || 'OTHER',
            turn_status: parsed.turn_status || 'COMPLETE',
            is_repair_initiator: !!parsed.is_repair_initiator,
        };
        // Preferred shape: typed moves.
        if (Array.isArray(parsed.moves)) {
            return { classification, moves: parsed.moves, missingFacts: arr(parsed.missing_facts) };
        }
        // Legacy {options:[...]}.
        if (Array.isArray(parsed.options)) {
            return {
                classification,
                moves: parsed.options.map((t, i) => ({ slot: SLOTS[i] || 'PREFERRED', text: String(t), hint: '' })),
                missingFacts: arr(parsed.missing_facts),
            };
        }
    }
    throw new Error('Could not parse response moves from API');
}

function arr(v) { return Array.isArray(v) ? v : []; }
