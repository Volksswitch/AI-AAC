const transcriptText = document.getElementById('transcriptText');
const responseOptions = document.getElementById('responseOptions');
const statusBar = document.getElementById('statusBar');
const listenBtn = document.getElementById('listenBtn');
const transcriptPanel = document.getElementById('transcript');
const transcriptStateLabel = document.getElementById('transcriptState');
const modeChip = document.getElementById('modeChip');
const nowPlaying = document.getElementById('nowPlaying');
const nowPlayingText = document.getElementById('nowPlayingText');

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

export function showTranscript(text, isFinal) {
    transcriptText.textContent = text || 'Waiting for partner to speak…';
    transcriptText.classList.toggle('placeholder', !text);
    transcriptText.style.opacity = isFinal ? '1' : '0.6';
}

// --- Region A: mode chip + three-state transcript display (UI-Design.docx
// §3.1, §6). The chip names the engine's inferred mode; the transcript panel's
// state (UNCONFIRMED → GENERATING → OPTIONS READY) is informational — it no
// longer GATES generation (generation fires on the silence period, Ken's
// decision), so the states reassure rather than block. ---

// Friendly, user-facing mode labels (the engine's enum is internal). The
// dominant slot color of each mode drives the chip color (token table §10).
const MODE_CHIP = {
    STANDBY:             { label: 'Standby',             cls: 'chip-standby' },
    LISTENING:           { label: 'Listening',           cls: 'chip-listening' },
    RESPONDING:          { label: 'Choose a response',   cls: 'chip-responding' },
    REPAIR_OF_SELF:      { label: 'They need that again', cls: 'chip-repair' },
    INITIATING:          { label: 'Start the conversation', cls: 'chip-initiating' },
    PRE_CLOSING_CLOSING: { label: 'Wrapping up',         cls: 'chip-closing' },
};

const TRANSCRIPT_STATE = {
    idle:        { cls: 'state-idle',        label: '' },
    unconfirmed: { cls: 'state-unconfirmed', label: 'Heard' },
    generating:  { cls: 'state-generating',  label: 'Thinking…' },
    ready:       { cls: 'state-ready',       label: 'Options ready' },
};

function renderModeChip() {
    if (!modeChip || !lastSnap) return;
    const s = lastSnap;
    // STANDBY relabel when genuinely at rest (mirrors the diagnostic Mode cell):
    // the engine's resting mode is LISTENING, but with the mic off and nothing
    // owed it reads wrong — show Standby instead.
    const atRest = !capturing
        && s.mode === 'LISTENING'
        && (s.floor || 'open') === 'open'
        && (!s.sequenceStack || s.sequenceStack.length === 0)
        && (!s.palette || s.palette.length === 0);
    const key = atRest ? 'STANDBY' : s.mode;
    const meta = MODE_CHIP[key] || MODE_CHIP.LISTENING;
    modeChip.textContent = meta.label;
    modeChip.className = `mode-chip ${meta.cls}`;
}

export function setTranscriptState(state) {
    if (!transcriptPanel) return;
    const meta = TRANSCRIPT_STATE[state] || TRANSCRIPT_STATE.idle;
    transcriptPanel.className = `panel transcript-panel ${meta.cls}`;
    if (transcriptStateLabel) transcriptStateLabel.textContent = meta.label;
}

// The currently-playing automatic utterance (filler) or spoken response, shown
// as text so the system never speaks on the user's behalf invisibly (§7).
export function setNowPlaying(text) {
    if (!nowPlaying || !nowPlayingText) return;
    if (text) {
        nowPlayingText.textContent = text;
        nowPlaying.hidden = false;
    } else {
        nowPlayingText.textContent = '';
        nowPlaying.hidden = true;
    }
}

// --- Region B: the move palette as triple-coded cards (UI-Design.docx §4).
// Each card carries: slot badge (text), slot color (border + badge), the
// glanceable hint (primary reading target), the full utterance (smaller), an
// optional format tag, and a latency dot (filled = instant, hollow = a
// generation round-trip on selection). Position + color + badge = triple coding,
// so meaning never rests on color alone. ---

// slot enum → { badge label, css class, friendly aria name }. Covers the four
// RESPONDING slots plus the repair-of-self ops and the opener/closer palettes
// the engine also emits, so every move the engine can produce renders.
const SLOT_META = {
    PREFERRED:       { badge: 'PREFERRED',    cls: 'slot-preferred' },
    DISPREFERRED:    { badge: 'DISPREFERRED', cls: 'slot-dispreferred' },
    INITIATIVE:      { badge: 'INITIATIVE',   cls: 'slot-initiative' },
    REPAIR:          { badge: 'REPAIR',       cls: 'slot-repair' },
    REPAIR_RESPEAK:  { badge: 'SAY AGAIN',    cls: 'slot-repair' },
    REPAIR_REPHRASE: { badge: 'REPHRASE',     cls: 'slot-repair' },
    REPAIR_EXPAND:   { badge: 'EXPLAIN MORE', cls: 'slot-repair' },
    OPENER:          { badge: 'OPENER',       cls: 'slot-initiative' },
    CLOSING:         { badge: 'CLOSING',      cls: 'slot-persistent' },
};

export function showMoves(palette, onSelect) {
    if (!palette || palette.length === 0) {
        clearResponseOptions();
        return;
    }
    responseOptions.classList.remove('is-empty');
    responseOptions.innerHTML = '';
    // Brief crossfade of contents on each render (geometry never moves) —
    // motion informs ("the cards changed"), never relocates (§5). Honoring
    // prefers-reduced-motion is handled in CSS.
    responseOptions.classList.remove('palette-enter');
    void responseOptions.offsetWidth; // restart the animation
    responseOptions.classList.add('palette-enter');

    palette.forEach((move, index) => {
        const meta = SLOT_META[move.slot] || { badge: move.slot, cls: 'slot-persistent' };
        const roundtrip = move.latency === 'roundtrip';
        const hasText = move.text && move.text.trim();

        const card = document.createElement('button');
        card.type = 'button';
        card.className = `move-card ${meta.cls} ${roundtrip ? 'latency-roundtrip' : 'latency-instant'}`;
        card.setAttribute('aria-label',
            `${meta.badge}: ${move.hint || move.text || ''}${roundtrip ? ' (generates on selection)' : ''}`);

        const formatTag = move.format
            ? `<span class="move-format">${escapeHtml(move.format)}</span>` : '';
        // Show the full utterance under the hint when it exists; round-trip moves
        // (rephrase/expand) have no text yet, so the hint stands alone.
        const fullText = hasText
            ? `<span class="move-text">${escapeHtml(move.text)}</span>` : '';

        card.innerHTML = `
            <span class="move-card-top">
                <span class="move-badge">${escapeHtml(meta.badge)}</span>
                <span class="move-latency" title="${roundtrip ? 'Generates when selected' : 'Speaks instantly'}"></span>
            </span>
            <span class="move-hint">${escapeHtml(move.hint || move.text || '')}</span>
            ${fullText}
            ${formatTag}
        `;
        card.addEventListener('click', () => {
            // Latency transparency: a round-trip card shows it's working in place
            // while the generation/TTS happens (the next render replaces it).
            if (roundtrip) card.classList.add('working');
            onSelect(move, index);
        });
        responseOptions.appendChild(card);
    });
}

export function clearResponseOptions() {
    responseOptions.classList.add('is-empty');
    responseOptions.innerHTML = '<p class="placeholder">Response options will appear here</p>';
}

// --- Fast-phrases panel (base UI quick-speak, Rule 9). Category-colored content
// buttons; the phrase text is the primary cue (color is secondary grouping).
// Activation is single-tap or a confirming double-tap (Rule 10): in double mode
// the first tap "arms" the button (visually distinct) and a second tap within
// doubleTapMs confirms; otherwise it disarms. Speaking is the caller's job
// (onSpeak), so the panel stays presentation-only. ---
const fastPhrasesPanel = document.getElementById('fastPhrases');

export function renderFastPhrases(phrases, categories, opts = {}) {
    if (!fastPhrasesPanel) return;
    const { tapMode = 'single', doubleTapMs = 400, onSpeak } = opts;
    fastPhrasesPanel.innerHTML = '';

    let armedBtn = null;
    let armTimer = null;
    const disarm = () => {
        if (armedBtn) armedBtn.classList.remove('fp-armed');
        armedBtn = null;
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    };

    (phrases || []).forEach((p) => {
        const cat = categories[p.cat] || {};
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fp-btn';
        btn.style.setProperty('--fp-color', cat.color || '#546E7A');
        btn.style.setProperty('--fp-tint', cat.tint || '#eceff1');
        btn.title = p.text;
        btn.setAttribute('aria-label', p.text);
        btn.innerHTML = `<span class="fp-text">${escapeHtml(p.text)}</span>`;
        btn.addEventListener('click', () => {
            if (tapMode === 'double') {
                if (armedBtn === btn) { disarm(); onSpeak && onSpeak(p); }
                else { disarm(); armedBtn = btn; btn.classList.add('fp-armed'); armTimer = setTimeout(disarm, doubleTapMs); }
            } else {
                onSpeak && onSpeak(p);
            }
        });
        fastPhrasesPanel.appendChild(btn);
    });
}

// --- Diagnostic engine-state panel (temporary, replaced by the real UI later) ---

const engineEls = {
    mode: document.getElementById('engineMode'),
    floor: document.getElementById('engineFloor'),
    phase: document.getElementById('enginePhase'),
    action: document.getElementById('engineAction'),
    turnStatus: document.getElementById('engineTurnStatus'),
    repair: document.getElementById('engineRepair'),
    stack: document.getElementById('engineStack'),
    lastUser: document.getElementById('engineLastUser'),
};

// The Mode cell depends on BOTH the engine snapshot and the mic-capture state:
// when the engine is genuinely at rest we show "STANDBY" instead of the engine's
// resting "LISTENING" (which otherwise reads as if the mic were live). This is a
// presentation-only relabel — the engine's internal mode stays LISTENING. Kept
// as a separate helper because either input (snapshot or capture) can change
// independently and must re-render the cell.
let lastSnap = null;
let capturing = false;

function renderModeCell() {
    if (!engineEls.mode || !lastSnap) return;
    const s = lastSnap;
    const atRest = !capturing
        && s.mode === 'LISTENING'
        && (s.floor || 'open') === 'open'
        && (!s.sequenceStack || s.sequenceStack.length === 0)
        && (!s.palette || s.palette.length === 0);
    engineEls.mode.textContent = atRest ? 'STANDBY' : s.mode;
}

export function showEngineState(snap) {
    if (!snap) return;
    lastSnap = snap;
    renderModeCell();
    renderModeChip();
    if (!engineEls.phase) return; // diagnostics panel collapsed/absent
    engineEls.phase.textContent = snap.phase;
    if (engineEls.floor) {
        const floor = snap.floor || 'open';
        engineEls.floor.textContent = floor;
        engineEls.floor.className = `engine-val floor-${floor}`;
    }
    const c = snap.lastClassification;
    engineEls.action.textContent = c ? c.partner_action : '—';
    engineEls.turnStatus.textContent = c ? c.turn_status : '—';
    engineEls.repair.textContent = c ? (c.is_repair_initiator ? 'yes' : 'no') : '—';
    engineEls.stack.textContent = snap.sequenceStack.length
        ? snap.sequenceStack.map(s => `${s.action}${s.openedBy === 'USER' ? '*' : ''}`).join(' › ')
        : '(empty)';
    engineEls.lastUser.textContent = snap.lastUserUtterance || '—';
}

export function onInitiateClick(handler) {
    document.getElementById('initiateBtn').addEventListener('click', handler);
}
export function onSayAgainClick(handler) {
    document.getElementById('sayAgainBtn').addEventListener('click', handler);
}
export function onHoldOnClick(handler) {
    document.getElementById('holdOnBtn').addEventListener('click', handler);
}
export function onPardonClick(handler) {
    document.getElementById('pardonBtn').addEventListener('click', handler);
}
export function onWindDownClick(handler) {
    document.getElementById('windDownBtn').addEventListener('click', handler);
}
export function onEndConversationClick(handler) {
    document.getElementById('endConversationBtn').addEventListener('click', handler);
}

export function setStatus(message) {
    statusBar.textContent = message;
}

export function setListenButtonState(listening) {
    listenBtn.textContent = listening ? 'Stop Listening' : 'Start Listening';
    listenBtn.classList.toggle('listening', listening);
    // Mic capture is an I/O state, separate from the engine's CA mode — surface
    // it on its own row so "Mode: LISTENING" (the engine's resting mode) isn't
    // misread as "the microphone is on".
    const cap = document.getElementById('engineCapture');
    if (cap) {
        cap.textContent = listening ? 'on' : 'off';
        cap.classList.toggle('capture-on', listening);
        cap.classList.toggle('capture-off', !listening);
    }
    // Mic state feeds the STANDBY-vs-LISTENING relabel — re-render the Mode cell
    // so it flips the instant capture toggles, not only on the next snapshot.
    capturing = listening;
    renderModeCell();
    renderModeChip();
}

export function onListenClick(handler) {
    listenBtn.addEventListener('click', handler);
}

export function onRegenerateClick(handler) {
    document.getElementById('regenerateBtn').addEventListener('click', handler);
}

export function onSettingsClick(handler) {
    document.getElementById('settingsBtn').addEventListener('click', handler);
}

export function onAboutMeClick(handler) {
    document.getElementById('aboutMeBtn').addEventListener('click', handler);
}

// --- "In your own words" composer ---

export function onSpeakClick(handler) {
    document.getElementById('speakBtn').addEventListener('click', handler);
}

export function onReframeClick(handler) {
    document.getElementById('reframeBtn').addEventListener('click', handler);
}

export function onClearComposerClick(handler) {
    document.getElementById('clearComposerBtn').addEventListener('click', handler);
}

export function getComposerText() {
    return document.getElementById('composerInput').value.trim();
}

export function clearComposer() {
    document.getElementById('composerInput').value = '';
}
