import * as tts from './tts.js';
import * as storage from './storage.js';

/* Filler ladder (Conversation-Engine-Design.docx §6).
 *
 * Floor-holding is an escalating ladder where each rung needs less information
 * than the next, so the dangerous silence is killed long before generation
 * finishes:
 *   Rung 1  ~0.8s  Acknowledgment token ("Hmm.", "Ah.", "Good question.").
 *                  No LLM, no fetch — fires inside ~1s (replaces the old 4s
 *                  initial delay). This rung is what makes holding the floor
 *                  affordable: it buys time the generation then spends.
 *   Rung 2  ~2.5s  Projection filler ("Give me a second.") from placeholders.json.
 *                  Covers the generation window.
 *   Rung 3  every subsequentDelay  Periodic re-fill ("Still thinking…"),
 *                  never the same phrase twice in a row.
 *
 * start()/stop() keep the same signature the app already calls. The whole
 * ladder is torn down the moment a response is selected or the partner repeats.
 */

// Rung 1 — short acknowledgment tokens. Inline (no fetch) so the first rung can
// fire well inside the ~1s budget.
const ACK_TOKENS = [
    'Hmm.', 'Ah.', 'Good question.', 'Right.', 'Okay.', 'Let me think.',
    'Oh.', 'Mm.', 'I see.', 'Well…',
];

const RUNG1_DELAY = 800;    // ms after the silence checkpoint
const RUNG2_DELAY = 1700;   // ms after rung 1 (~2.5s total)

let fillers = [];           // rung 2/3 projection pool (from JSON)
let timer = null;
let active = false;
let lastAck = -1;
let lastFiller = -1;

async function loadFillers() {
    if (fillers.length > 0) return;
    const response = await fetch('data/placeholders.json');
    fillers = await response.json();
}

function pick(list, last) {
    if (list.length <= 1) return 0;
    let index;
    do {
        index = Math.floor(Math.random() * list.length);
    } while (index === last);
    return index;
}

export async function start() {
    stop();
    active = true;
    // Kick off the projection pool load in parallel; rung 1 doesn't wait on it.
    loadFillers().catch(() => { /* rung 1 still works without it */ });
    timer = setTimeout(rung1, RUNG1_DELAY);
}

export function stop() {
    active = false;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    tts.cancel();
}

// Rung 1 — acknowledgment token, ≤1s, no LLM.
async function rung1() {
    if (!active) return;
    lastAck = pick(ACK_TOKENS, lastAck);
    await tts.speak(ACK_TOKENS[lastAck]);
    if (!active) return;
    timer = setTimeout(rung2, RUNG2_DELAY);
}

// Rung 2 — projection filler covering the generation window.
async function rung2() {
    if (!active) return;
    await speakFiller();
    if (!active) return;
    const { subsequentDelay } = storage.loadPlaceholderSettings();
    timer = setTimeout(rung3, subsequentDelay * 1000);
}

// Rung 3 — periodic re-fill for extended composition.
async function rung3() {
    if (!active) return;
    await speakFiller();
    if (!active) return;
    const { subsequentDelay } = storage.loadPlaceholderSettings();
    timer = setTimeout(rung3, subsequentDelay * 1000);
}

async function speakFiller() {
    if (fillers.length === 0) {
        try { await loadFillers(); } catch { return; }
    }
    if (fillers.length === 0) return;
    lastFiller = pick(fillers, lastFiller);
    await tts.speak(fillers[lastFiller]);
}
