import { setIconButton } from './icons.js';

const responseOptions = document.getElementById('responseOptions');
const statusBar = document.getElementById('statusBar');
const listenBtn = document.getElementById('listenBtn');
const transcriptBox = document.getElementById('transcript');     // fixed-height scroller
const transcriptLog = document.getElementById('transcriptLog');  // committed turns
const liveTurn = document.getElementById('liveTurn');            // in-progress partner turn
const modeChip = document.getElementById('modeChip');
const nowPlaying = document.getElementById('nowPlaying');
const nowPlayingText = document.getElementById('nowPlayingText');

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// --- Conversation transcript (scrolling, FIXED height — the layout never grows,
// for the static keyguard). Committed turns are rendered from history (partner
// vs user styled differently); the in-progress partner turn is a separate live
// entry; the now-playing filler is a transient entry. All scroll INSIDE the box. ---

function scrollLogToBottom() {
    if (transcriptBox) transcriptBox.scrollTop = transcriptBox.scrollHeight;
}

// Render the committed conversation (array of {role:'partner'|'user', text}).
export function renderConversation(history) {
    if (!transcriptLog) return;
    transcriptLog.innerHTML = '';
    (history || []).forEach((t) => {
        const div = document.createElement('div');
        div.className = `turn turn-${t.role === 'partner' ? 'partner' : 'user'}`;
        div.textContent = t.text;
        transcriptLog.appendChild(div);
    });
    scrollLogToBottom();
}

// The in-progress partner turn (live STT, provisional) — shown below the
// committed turns. Empty text hides it.
export function setLiveTranscript(text) {
    if (!liveTurn) return;
    if (text) { liveTurn.textContent = text; liveTurn.hidden = false; }
    else { liveTurn.textContent = ''; liveTurn.hidden = true; }
    scrollLogToBottom();
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

// Three-state cue (UNCONFIRMED → GENERATING → READY) applied subtly to the live
// partner turn (a colored left accent) — informational, doesn't gate anything.
export function setTranscriptState(state) {
    if (!liveTurn) return;
    liveTurn.classList.remove('state-unconfirmed', 'state-generating', 'state-ready');
    if (state && state !== 'idle') liveTurn.classList.add(`state-${state}`);
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

// The response footprint is a fixed RESERVED grid of 4 CELLS (Rule 1) — 2×2 with
// a side dock, 1×4 with a bottom dock. Each cell is one category; it holds 1 or 2
// stacked option buttons (the "responses per category" setting). Empty cells are
// real estate held open even at rest (the "In my own words" box overlays here).
const RESERVED_SLOTS = 4;
const SLOT_ORDER = ['slot-preferred', 'slot-dispreferred', 'slot-initiative', 'slot-repair'];
const CATEGORY_SLOTS = ['PREFERRED', 'DISPREFERRED', 'INITIATIVE', 'REPAIR'];

// A card shows ONLY the RESPONSE TEXT, large and easy to read (Ken): the slot
// color + fixed position carry the category, so the category pill is gone, and
// every card is spoken instantly, so the latency dot is gone too. `half` shrinks
// the text for a 2-up (stacked) category cell.
function buildMoveCard(move, index, onSelect, half) {
    const meta = SLOT_META[move.slot] || { badge: move.slot, cls: 'slot-persistent' };
    const roundtrip = move.latency === 'roundtrip';
    // Round-trip moves (rephrase/expand) have no text yet → show their hint label.
    const text = (move.text && move.text.trim()) ? move.text : (move.hint || '');

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `move-card ${meta.cls}${half ? ' move-card-half' : ''}`;
    // Category isn't shown visually, so name it in the accessible label only.
    card.setAttribute('aria-label', `${meta.badge}: ${text}`);
    card.innerHTML = `<span class="move-response">${escapeHtml(text)}</span>`;
    card.addEventListener('click', () => {
        if (roundtrip) card.classList.add('working');
        onSelect(move, index);
    });
    return card;
}

function buildEmptyCell(slotCls) {
    const cell = document.createElement('div');
    cell.className = `move-cell ${slotCls}`;
    const empty = document.createElement('div');
    empty.className = `move-card move-card-empty ${slotCls}`;
    empty.setAttribute('aria-hidden', 'true');
    cell.appendChild(empty);
    return cell;
}

export function showMoves(palette, onSelect) {
    responseOptions.classList.remove('is-empty');
    responseOptions.innerHTML = '';
    // Brief crossfade of contents on each render (geometry never moves, §5).
    responseOptions.classList.remove('palette-enter');
    void responseOptions.offsetWidth; // restart the animation
    responseOptions.classList.add('palette-enter');

    if (!palette || palette.length === 0) { clearResponseOptions(); return; }

    // RESPONDING palettes group into the 4 fixed category cells (each may hold
    // 1–2 stacked options); other palettes (openers / closers / repair-of-self)
    // place one move per cell.
    const isResponding = palette.some((m) => CATEGORY_SLOTS.includes(m.slot));
    let cells;
    if (isResponding) {
        cells = CATEGORY_SLOTS.map((slot, i) => ({
            moves: palette.filter((m) => m.slot === slot),
            slotCls: SLOT_ORDER[i],
        }));
    } else {
        cells = palette.map((m) => ({ moves: [m], slotCls: (SLOT_META[m.slot] || {}).cls || 'slot-persistent' }));
    }

    const count = Math.max(RESERVED_SLOTS, cells.length);
    for (let i = 0; i < count; i++) {
        const cell = cells[i];
        if (!cell || !cell.moves.length) {
            responseOptions.appendChild(buildEmptyCell(cell ? cell.slotCls : (SLOT_ORDER[i] || 'slot-persistent')));
            continue;
        }
        const el = document.createElement('div');
        el.className = `move-cell ${cell.slotCls}${cell.moves.length > 1 ? ' move-cell-split' : ''}`;
        const half = cell.moves.length > 1;
        cell.moves.forEach((move) => el.appendChild(buildMoveCard(move, palette.indexOf(move), onSelect, half)));
        responseOptions.appendChild(el);
    }
}

export function clearResponseOptions() {
    // Keep the reserved footprint: 4 empty slot-colored cells (not a placeholder
    // line), so the region's size is held even with no options / no conversation.
    responseOptions.classList.remove('is-empty', 'palette-enter');
    responseOptions.innerHTML = '';
    for (let i = 0; i < RESERVED_SLOTS; i++) responseOptions.appendChild(buildEmptyCell(SLOT_ORDER[i]));
}

// --- Fast-phrases panel (base UI quick-speak, Rules 9/10). The grid mirrors the
// SELECTED KEYBOARD LAYOUT cell-for-cell (so one static keyguard overlays both):
// each key cell becomes a category-colored phrase button (phrases drawn in order
// from the pool); the keyboard's SPACE cell becomes the "In my own words" button
// (distinct color, same span); blank/pred cells and any leftover cells stay
// blank. The persistent-override row above (#fpControls) corresponds to the
// keyboard's toolbar row and is static HTML. Activation: single-tap, or a
// confirming double-tap (first tap arms, second within doubleTapMs confirms).
// Speaking / opening the modal is the caller's job, so this stays presentational.
const fpGrid = document.getElementById('fpGrid');

// Render the editable, ordered typed-item list (phrase / partner / feeling) into
// the grid cells of the paired keyboard layout, in order. The space cell becomes
// "In my own words". Phrase buttons speak (single/double tap); partner and
// feeling buttons are TOGGLES with distinct colors and an active (selected)
// state. `items` are the typed items; opts carries the lookups + callbacks.
export function renderExpressPanel(layoutRows, items, opts = {}) {
    if (!fpGrid) return;
    const {
        categories = {}, influencerColors = {},
        activePartnerId = null, activeFeelingId = null,
        tapMode = 'single', doubleTapMs = 400,
        onSpeak, onTogglePartner, onToggleFeeling, onInMyOwnWords,
    } = opts;
    fpGrid.innerHTML = '';

    let armedBtn = null;
    let armTimer = null;
    const disarm = () => {
        if (armedBtn) armedBtn.classList.remove('fp-armed');
        armedBtn = null;
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    };
    const blank = (span) => {
        const f = document.createElement('div');
        f.className = 'fp-cell-blank';
        f.style.flex = `${span} 1 0`;
        return f;
    };
    const setColor = (b, color, tint) => {
        b.style.setProperty('--fp-color', color || '#546E7A');
        b.style.setProperty('--fp-tint', tint || '#eceff1');
    };

    const buildItemBtn = (item, span) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'fp-btn';
        b.style.flex = `${span} 1 0`;

        if (item.type === 'partner') {
            const label = item.nickname || item.name || 'Partner';
            const ic = influencerColors.partner || {};
            setColor(b, ic.color, ic.tint);
            b.classList.add('fp-partner');
            if (item.id && item.id === activePartnerId) b.classList.add('fp-on');
            b.title = `Talking with ${label}`;
            b.setAttribute('aria-label', `Talking with ${label}${item.id === activePartnerId ? ' (on)' : ''}`);
            b.setAttribute('aria-pressed', String(item.id === activePartnerId));
            b.innerHTML = `<span class="fp-text">${escapeHtml(label)}</span>`;
            b.addEventListener('click', () => onTogglePartner && onTogglePartner(item));
            return b;
        }
        if (item.type === 'feeling') {
            const ic = influencerColors.feeling || {};
            setColor(b, ic.color, ic.tint);
            b.classList.add('fp-feeling');
            if (item.id && item.id === activeFeelingId) b.classList.add('fp-on');
            b.title = `Feeling ${item.text}`;
            b.setAttribute('aria-label', `Feeling ${item.text}${item.id === activeFeelingId ? ' (on)' : ''}`);
            b.setAttribute('aria-pressed', String(item.id === activeFeelingId));
            b.innerHTML = `<span class="fp-text">${escapeHtml(item.text)}</span>`;
            b.addEventListener('click', () => onToggleFeeling && onToggleFeeling(item));
            return b;
        }
        // phrase
        const cat = categories[item.cat] || {};
        setColor(b, cat.color, cat.tint);
        b.title = item.text;
        b.setAttribute('aria-label', item.text);
        b.innerHTML = `<span class="fp-text">${escapeHtml(item.text)}</span>`;
        b.addEventListener('click', () => {
            if (tapMode === 'double') {
                if (armedBtn === b) { disarm(); onSpeak && onSpeak(item); }
                else { disarm(); armedBtn = b; b.classList.add('fp-armed'); armTimer = setTimeout(disarm, doubleTapMs); }
            } else { onSpeak && onSpeak(item); }
        });
        return b;
    };

    let pi = 0; // index into the ordered item list
    (layoutRows || []).forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'fp-row';
        (row || []).forEach((cell) => {
            const span = cell.span || 1;
            if (cell.kind === 'space') {
                // The space counterpart: "In my own words" (distinct color, single tap).
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'fp-btn fp-imow';
                b.style.flex = `${span} 1 0`;
                b.title = 'In my own words';
                b.setAttribute('aria-label', 'In my own words');
                b.innerHTML = '<span class="fp-text">In my own words</span>';
                b.addEventListener('click', () => onInMyOwnWords && onInMyOwnWords());
                rowEl.appendChild(b);
                return;
            }
            if (cell.kind === 'blank' || cell.kind === 'pred') {
                rowEl.appendChild(blank(span));
                return;
            }
            // char or non-space action cell → next item, or blank if exhausted.
            const item = items[pi++];
            if (!item) { rowEl.appendChild(blank(span)); return; }
            rowEl.appendChild(buildItemBtn(item, span));
        });
        fpGrid.appendChild(rowEl);
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
    // Icon-only (Rule 4); the .listening (selected/red) state signals capture is
    // on (Rule 6 — a sticky action shown as a selected button).
    setIconButton(listenBtn, 'mic', listening ? 'Stop listening' : 'Start listening');
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

// Convert the control buttons to icon-only (Rule 4), keeping each one's
// accessible name (aria-label + title). Content buttons — move/response cards
// and fast-phrase buttons — are intentionally NOT touched (they show text).
// Called once at startup.
export function applyControlIcons() {
    setIconButton(document.getElementById('sayAgainBtn'), 'replay', 'Say again');
    setIconButton(document.getElementById('holdOnBtn'), 'pause', 'Hold on');
    setIconButton(document.getElementById('pardonBtn'), 'pardon', "Pardon? — ask them to repeat");
    setIconButton(document.getElementById('windDownBtn'), 'windDown', 'Wind down');
    setIconButton(document.getElementById('initiateBtn'), 'startChat', 'Start conversation');
    setIconButton(document.getElementById('endConversationBtn'), 'endChat', 'End conversation');
    setIconButton(document.getElementById('regenerateBtn'), 'shuffle', 'New 4 — different options');
    setIconButton(document.getElementById('speakBtn'), 'speak', 'Speak');
    setIconButton(document.getElementById('reframeBtn'), 'reframe', 'Reframe — new options from this');
    setIconButton(document.getElementById('cancelComposerBtn'), 'clear', 'Cancel');
    setListenButtonState(false); // initialize the Listen button's mic icon
}

// --- "In my own words" modal overlay (Rule 8). Shows the input box over the
// reserved response footprint without blurring the base UI; focusing the textarea
// brings up the keyboard in the dock region. ---
export function showComposerOverlay() {
    const ov = document.getElementById('composerOverlay');
    if (ov) ov.hidden = false;
    const ta = document.getElementById('composerInput');
    if (ta) ta.focus(); // triggers the on-screen keyboard (if onscreen mode)
}

export function hideComposerOverlay() {
    const ta = document.getElementById('composerInput');
    if (ta) ta.blur(); // dismisses the on-screen keyboard
    const ov = document.getElementById('composerOverlay');
    if (ov) ov.hidden = true;
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

export function onCancelComposerClick(handler) {
    document.getElementById('cancelComposerBtn').addEventListener('click', handler);
}

export function getComposerText() {
    return document.getElementById('composerInput').value.trim();
}

export function clearComposer() {
    document.getElementById('composerInput').value = '';
}
