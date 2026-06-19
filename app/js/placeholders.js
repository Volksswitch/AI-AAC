import * as tts from './tts.js';
import * as storage from './storage.js';

/* Floor-holding placeholders, timed to the user's choosing window (Ken,
 * June 18 2026 — replaces the §6 latency-driven filler ladder).
 *
 * New model: start() is called when the AI's response options ARRIVE, not at the
 * partner-silence checkpoint, and only when the partner's action warrants it (a
 * question — the gating lives in app.js). So a placeholder fills the silence
 * while the user READS and CHOOSES, not the AI-latency gap. Consequences:
 *   - The first placeholder lands "Initial Placeholder Statement Delay" seconds
 *     AFTER the options appear. If the user picks within that window, stop() is
 *     called first and NO placeholder plays — exactly the "don't fire one if it
 *     isn't needed" behavior.
 *   - Subsequent placeholders re-fill every "Subsequent Placeholder Statement
 *     Delay" seconds while the user keeps choosing, never the same phrase twice
 *     in a row.
 *
 * The phrases must be neutral and reflective, never imperative or directed at
 * the partner ("Let me think", "Give me a second", "Hold on") — with the flat
 * inflection of the built-in voices those read as curt/annoyed (Ken, June 18
 * 2026). They are also question-appropriate (we only fire on questions), so
 * "Good question." is safe. The pool lives in data/placeholders.json and will
 * become user-editable later. start()/stop() keep the signature app.js calls.
 */

// Inline fallback if data/placeholders.json fails to load. Mirrors the neutral,
// non-imperative default set.
const FALLBACK_FILLERS = [
    'Good question.',
    "That's a good question.",
    'Hmm, interesting.',
    "That's interesting.",
    'Oh, interesting.',
    "I'm thinking about that.",
];

let fillers = [];
let timer = null;
let active = false;
let last = -1;

async function loadFillers() {
    if (fillers.length > 0) return;
    try {
        const response = await fetch('data/placeholders.json');
        const data = await response.json();
        if (Array.isArray(data) && data.length) fillers = data;
    } catch { /* fall back below */ }
    if (fillers.length === 0) fillers = FALLBACK_FILLERS.slice();
}

function pick(list, prev) {
    if (list.length <= 1) return 0;
    let index;
    do {
        index = Math.floor(Math.random() * list.length);
    } while (index === prev);
    return index;
}

export async function start() {
    stop();
    active = true;
    // Load the pool in parallel; speak() ensures it's ready before the first use.
    loadFillers().catch(() => { /* fallback handled in loadFillers */ });
    // First placeholder lands initialDelay seconds after the options appeared
    // (= after start() was called). A quick selection cancels it via stop().
    const { initialDelay } = storage.loadPlaceholderSettings(); // seconds
    timer = setTimeout(speak, initialDelay * 1000);
}

export function stop() {
    active = false;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    tts.cancel();
}

async function speak() {
    if (!active) return;
    if (fillers.length === 0) {
        try { await loadFillers(); } catch { /* ignore */ }
    }
    if (!active) return;
    if (fillers.length === 0) { scheduleNext(); return; }
    last = pick(fillers, last);
    await tts.speak(fillers[last]);
    if (!active) return;
    scheduleNext();
}

function scheduleNext() {
    const { subsequentDelay } = storage.loadPlaceholderSettings();
    timer = setTimeout(speak, subsequentDelay * 1000);
}
