/* Conversation Engine — the CA (Conversation Analysis) core.
 *
 * Implements Conversation-Engine-Design.docx: a sequence stack (what is
 * currently "owed"), five conversational modes, and a typed, prioritized move
 * palette. This module knows CA structure ONLY — never the UI, the access
 * method, or how anything is drawn (design §2, strict one-way knowledge). It
 * ingests the LLM's combined classify+generate result, updates state, and emits
 * a palette descriptor + an inspectable snapshot. The Presentation Layer (for
 * now the degenerate diagnostic renderer) consumes the snapshot.
 *
 * Phasing (design §10, "Phase 1 refinements"): RESPONDING four-slot palette,
 * REPAIR-OF-SELF, INITIATING, PRE-CLOSING/CLOSING, the sequence stack, and the
 * persistent overrides all ship here. CONTINUING is reserved in the classifier
 * schema (design §8) but treated as INCOMPLETE for now — no continuer palette.
 */

// --- Modes (design §5) ---
export const MODE = {
    LISTENING: 'LISTENING',           // partner speaking; no TRP yet
    RESPONDING: 'RESPONDING',         // TRP detected; partner action is an FPP
    REPAIR_OF_SELF: 'REPAIR_OF_SELF', // partner repaired the USER's turn ("What?")
    INITIATING: 'INITIATING',         // user opens, or conversation idle
    PRE_CLOSING_CLOSING: 'PRE_CLOSING_CLOSING',
};

// --- Move slots (design §4). Ordinal position is stable across modes so the
// user gets motor automaticity (preferred always first, repair always last). ---
export const SLOT = {
    PREFERRED: 'PREFERRED',
    DISPREFERRED: 'DISPREFERRED',
    INITIATIVE: 'INITIATIVE',
    REPAIR: 'REPAIR',
    // Repair-of-self operations on the user's own last utterance (design §7.2).
    REPAIR_RESPEAK: 'REPAIR_RESPEAK',
    REPAIR_REPHRASE: 'REPAIR_REPHRASE',
    REPAIR_EXPAND: 'REPAIR_EXPAND',
    // Conversation-level openers / closers (static for Phase 1; configurable later).
    OPENER: 'OPENER',
    CLOSING: 'CLOSING',
};

const SLOT_PRIORITY = {
    PREFERRED: 1, DISPREFERRED: 2, INITIATIVE: 3, REPAIR: 4,
    REPAIR_RESPEAK: 1, REPAIR_REPHRASE: 2, REPAIR_EXPAND: 3,
    OPENER: 1, CLOSING: 1,
};

// Static Phase-1 palettes for the modes that don't need an LLM round-trip.
// Per the Configuration Model these become user-owned lists later; inline for now.
const OPENERS = [
    'Hey, got a minute?',
    'Can I ask you something?',
    'Guess what.',
];
const CLOSERS = [
    'I should get going.',
    'This was really nice, thanks.',
    'Great seeing you.',
    'Bye!',
];

// --- ConversationState (design §3) ---
const state = {
    sequenceStack: [],            // [{action, openedBy, utterance, sttConfidence}], innermost last
    register: 'ORDINARY',         // or INSTITUTIONAL(role)
    phase: 'BODY',                // OPENING | BODY | PRE_CLOSING | CLOSING
    lastUserUtterance: '',        // for repair of our own turn
    lastPartnerUtterance: { text: '', confidence: null },
    mode: MODE.LISTENING,
    lastClassification: null,     // {partner_action, turn_status, is_repair_initiator} — inspectable
    palette: [],                  // current move descriptors
};

export function reset() {
    state.sequenceStack = [];
    state.register = 'ORDINARY';
    state.phase = 'BODY';
    state.lastUserUtterance = '';
    state.lastPartnerUtterance = { text: '', confidence: null };
    state.mode = MODE.LISTENING;
    state.lastClassification = null;
    state.palette = [];
}

// Snapshot for the renderer / diagnostics. Everything the degenerate UI shows.
export function getSnapshot() {
    return {
        mode: state.mode,
        phase: state.phase,
        register: state.register,
        sequenceStack: state.sequenceStack.map(s => ({ ...s })),
        lastClassification: state.lastClassification,
        lastUserUtterance: state.lastUserUtterance,
        lastPartnerUtterance: { ...state.lastPartnerUtterance },
        palette: state.palette.map(m => ({ ...m })),
    };
}

export function getMode() { return state.mode; }
export function getLastUserUtterance() { return state.lastUserUtterance; }

// Context block the engine hands the LLM (design §9.1). The app merges this
// with the worldview/relationship blocks before generating.
export function buildRequestContext() {
    return {
        stt_confidence: state.lastPartnerUtterance.confidence,
        sequence_stack: state.sequenceStack.map(s => ({ action: s.action, utterance: s.utterance })),
        register: state.register,
        phase: state.phase,
        last_user_utterance: state.lastUserUtterance,
    };
}

// Record that the partner is mid-capture (used at each silence checkpoint).
export function partnerSpeaking(text, confidence = null) {
    state.lastPartnerUtterance = { text, confidence };
    if (state.mode === MODE.LISTENING) state.palette = [];
}

// Ingest the combined classify+generate result (design §9.2) and update state.
// `result` = { classification:{partner_action,turn_status,is_repair_initiator}, moves:[...] }.
export function ingestClassification(result, partnerText) {
    const c = result.classification || {};
    state.lastClassification = {
        partner_action: c.partner_action || 'OTHER',
        turn_status: c.turn_status || 'COMPLETE',
        is_repair_initiator: !!c.is_repair_initiator,
    };
    state.lastPartnerUtterance = {
        text: partnerText,
        confidence: state.lastPartnerUtterance.confidence,
    };

    // Partner is asking the USER to repeat/clarify — do NOT generate fresh SPPs.
    // Switch to REPAIR-OF-SELF and offer operations on lastUserUtterance (§7.2).
    if (state.lastClassification.is_repair_initiator) {
        state.mode = MODE.REPAIR_OF_SELF;
        state.palette = repairSelfPalette();
        return getSnapshot();
    }

    // Mid-utterance pause — responding here is the high-stakes false-TRP error
    // (§8). Keep listening; show no palette.
    if (state.lastClassification.turn_status !== 'COMPLETE') {
        state.mode = MODE.LISTENING;
        state.palette = [];
        return getSnapshot();
    }

    // COMPLETE turn. If the user had a repair sequence open on top (Pardon?),
    // the partner's re-speak resolves it — pop it, then re-activate the FPP
    // beneath against the now-clarified utterance (§3, §7.1).
    const top = state.sequenceStack[state.sequenceStack.length - 1];
    if (top && top.action === 'REPAIR' && top.openedBy === 'USER') {
        state.sequenceStack.pop();
    }

    // Push the partner's FPP as a newly-owed sequence.
    state.sequenceStack.push({
        action: state.lastClassification.partner_action,
        openedBy: 'PARTNER',
        utterance: partnerText,
        sttConfidence: state.lastPartnerUtterance.confidence,
    });

    if (state.lastClassification.partner_action === 'CLOSING') {
        state.phase = 'PRE_CLOSING';
        state.mode = MODE.PRE_CLOSING_CLOSING;
        state.palette = closingPalette();
    } else {
        state.mode = MODE.RESPONDING;
        state.palette = paletteFromMoves(result.moves);
    }
    return getSnapshot();
}

// Convert the LLM's typed moves into prioritized palette descriptors. All
// pre-generated moves are instant to select (the text already exists); only
// REPAIR-OF-SELF rephrase/expand carry a round-trip (latency class, §2).
function paletteFromMoves(moves) {
    if (!Array.isArray(moves)) return [];
    return moves
        .filter(m => m && m.slot && typeof m.text === 'string' && m.text.trim())
        .map(m => ({
            slot: m.slot,
            text: m.text.trim(),
            hint: (m.hint || '').trim() || m.text.trim(),
            priority: SLOT_PRIORITY[m.slot] ?? 99,
            latency: 'instant',
            format: m.format || null,
            trigger: m.trigger || null,
        }))
        .sort((a, b) => a.priority - b.priority);
}

function repairSelfPalette() {
    return [
        { slot: SLOT.REPAIR_RESPEAK, op: 'respeak', text: state.lastUserUtterance || '',
          hint: 'Say it again', priority: 1, latency: 'instant' },
        { slot: SLOT.REPAIR_REPHRASE, op: 'rephrase', text: '', hint: 'Say it differently',
          priority: 2, latency: 'roundtrip' },
        { slot: SLOT.REPAIR_EXPAND, op: 'expand', text: '', hint: 'Explain it more',
          priority: 3, latency: 'roundtrip' },
    ];
}

function openerPalette() {
    return OPENERS.map((text, i) => ({
        slot: SLOT.OPENER, text, hint: text, priority: i + 1, latency: 'instant',
    }));
}

function closingPalette() {
    return CLOSERS.map((text, i) => ({
        slot: SLOT.CLOSING, text, hint: text, priority: i + 1, latency: 'instant',
    }));
}

// --- User actions on the palette ---

// A normal RESPONDING (or opener/closer) move was selected. Its SPP closes the
// open partner FPP — pop it. Record lastUserUtterance for later self-repair.
export function selectMove(move) {
    state.lastUserUtterance = move.text;
    // An SPP closes the innermost partner-opened sequence.
    for (let i = state.sequenceStack.length - 1; i >= 0; i--) {
        if (state.sequenceStack[i].openedBy === 'PARTNER') {
            state.sequenceStack.splice(i, 1);
            break;
        }
    }
    if (state.mode !== MODE.PRE_CLOSING_CLOSING) state.mode = MODE.LISTENING;
    state.palette = [];
    return getSnapshot();
}

// A REPAIR-OF-SELF operation completed (re-speak / rephrase / expand). The
// spokenText is what was actually said; it becomes the new lastUserUtterance.
// No partner FPP is involved, so the stack is untouched.
export function completeRepairOfSelf(spokenText) {
    if (spokenText) state.lastUserUtterance = spokenText;
    state.mode = MODE.LISTENING;
    state.palette = [];
    return getSnapshot();
}

// --- Persistent override controls (design §5.1) ---

// Pardon? — user initiates repair on the partner's turn. Push a nested repair
// sequence; on the partner's re-speak (next COMPLETE), it resolves (see ingest).
export function pardon() {
    state.sequenceStack.push({
        action: 'REPAIR', openedBy: 'USER', utterance: '(asked partner to clarify)',
        sttConfidence: null,
    });
    state.mode = MODE.LISTENING;
    state.palette = [];
    return getSnapshot();
}

// Wind down — enter PRE-CLOSING and swap to the closing palette.
export function windDown() {
    state.phase = 'PRE_CLOSING';
    state.mode = MODE.PRE_CLOSING_CLOSING;
    state.palette = closingPalette();
    return getSnapshot();
}

// Initiate — user opens the conversation; surface pre-sequences / openers (§5.2).
export function initiate() {
    state.phase = 'OPENING';
    state.mode = MODE.INITIATING;
    state.palette = openerPalette();
    return getSnapshot();
}
