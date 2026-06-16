const transcriptText = document.getElementById('transcriptText');
const responseOptions = document.getElementById('responseOptions');
const statusBar = document.getElementById('statusBar');
const listenBtn = document.getElementById('listenBtn');

export function showTranscript(text, isFinal) {
    transcriptText.textContent = text || 'Waiting for partner to speak...';
    transcriptText.classList.toggle('placeholder', !text);
    if (!isFinal) {
        transcriptText.style.opacity = '0.6';
    } else {
        transcriptText.style.opacity = '1';
    }
}

// Degenerate renderer for the engine's move palette. Each move is a plain
// button labeled "[SLOT] text" — no cards, color coding, latency dots, or
// compressed-hint styling (that's the future Presentation Layer, deliberately
// not built yet). For round-trip moves (REPAIR-OF-SELF rephrase/expand) the
// text isn't generated until selection, so we show the hint instead.
export function showMoves(palette, onSelect) {
    responseOptions.innerHTML = '';
    if (!palette || palette.length === 0) {
        clearResponseOptions();
        return;
    }
    palette.forEach((move, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        const label = move.text && move.text.trim() ? move.text : `(${move.hint})`;
        const latency = move.latency === 'roundtrip' ? ' ⟳' : '';
        btn.innerHTML = `<span class="move-slot">${move.slot}${latency}</span><span class="move-text">${label}</span>`;
        btn.setAttribute('aria-label', `Move ${index + 1}, ${move.slot}: ${label}`);
        btn.addEventListener('click', () => onSelect(move, index));
        responseOptions.appendChild(btn);
    });
}

export function clearResponseOptions() {
    responseOptions.innerHTML = '<p class="placeholder">Response options will appear here</p>';
}

// --- Diagnostic engine-state panel (temporary, replaced by the real UI later) ---

const engineEls = {
    mode: document.getElementById('engineMode'),
    phase: document.getElementById('enginePhase'),
    action: document.getElementById('engineAction'),
    turnStatus: document.getElementById('engineTurnStatus'),
    repair: document.getElementById('engineRepair'),
    stack: document.getElementById('engineStack'),
    lastUser: document.getElementById('engineLastUser'),
};

export function showEngineState(snap) {
    if (!snap) return;
    engineEls.mode.textContent = snap.mode;
    engineEls.phase.textContent = snap.phase;
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

export function setStatus(message) {
    statusBar.textContent = message;
}

export function setListenButtonState(listening) {
    listenBtn.textContent = listening ? 'Stop Listening' : 'Start Listening';
    listenBtn.classList.toggle('listening', listening);
}

export function onListenClick(handler) {
    listenBtn.addEventListener('click', handler);
}

export function onRepeatClick(handler) {
    document.getElementById('repeatBtn').addEventListener('click', handler);
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

export function onClearComposerClick(handler) {
    document.getElementById('clearComposerBtn').addEventListener('click', handler);
}

export function getComposerText() {
    return document.getElementById('composerInput').value.trim();
}

export function clearComposer() {
    document.getElementById('composerInput').value = '';
}
