import * as stt from './stt.js';
import * as tts from './tts.js';
import * as llm from './llm.js';
import * as ui from './ui.js';
import * as storage from './storage.js';
import * as placeholders from './placeholders.js';
import * as engine from './engine.js';
import * as worldview from './worldview.js';
import * as relationships from './relationships.js';
import * as worldviewUI from './worldview-ui.js';
import * as keyboard from './keyboard.js';
import { SIDE_LAYOUTS, BOTTOM_LAYOUTS } from './keyboard-layouts.js';

// Point-release version shown in Settings → About. Bump alongside the
// sw.js CACHE_VERSION on every release so beta testers can report exactly
// which build they're on.
const APP_VERSION = '0.3.16';

const conversationHistory = [];
let isListening = false;
let lastPalette = [];
// Raw, combined speech-to-text for the partner's current (uncommitted) turn.
// Grows across silence periods until the user picks a response.
let currentPartnerText = '';
// Increments on every silence period / reset so that a slower, earlier
// option-generation round-trip can't overwrite a newer one — latest wins.
let generationToken = 0;
// Auto-resume gate (CLAUDE.md Further Design Thoughts #4): listening is never
// started automatically at app startup. The user must manually invoke Start
// Listening at least once per session before auto-resume can fire; a manual
// Stop re-arms the requirement. Set true by a manual start, false by a manual
// stop. The automatic stop when a response is selected does NOT clear it — that
// is exactly the boundary auto-resume is meant to continue past.
let manualListenArmed = false;

function initApp() {
    if (!stt.isSupported()) {
        ui.setStatus('Speech recognition not supported in this browser. Use Chrome or Edge.');
        return;
    }

    const savedThreshold = storage.loadSilenceThreshold();
    stt.setSilenceThreshold(savedThreshold);

    stt.init({
        onResult: handleSpeechResult,
        onSilence: handleSilencePeriod,
        onStatus: handleSttStatus
    });

    // Tell the STT layer what the app is speaking so it can discard its own TTS
    // echo (filler ladder, prompts) instead of mistaking it for the partner and
    // renewing the partner's turn. The mic stays on throughout — only matching
    // echo content is dropped.
    tts.onSpeakingChange((speaking, text) => {
        if (speaking) stt.noteSpokenStart(text);
        else stt.noteSpokenEnd();
    });

    document.getElementById('startBtn').addEventListener('click', handleStart);
    ui.onListenClick(toggleListening);
    ui.onRegenerateClick(handleRegenerate);
    ui.onSpeakClick(handleSpeakComposed);
    ui.onClearComposerClick(() => ui.clearComposer());
    ui.onSettingsClick(openSettings);
    ui.onAboutMeClick(worldviewUI.open);
    // Persistent override controls (Conversation-Engine-Design.docx §5.1) — the
    // user's escape hatch when the engine's mode inference is wrong.
    ui.onInitiateClick(handleInitiate);
    ui.onSayAgainClick(handleSayAgain);
    ui.onHoldOnClick(handleHoldOn);
    ui.onPardonClick(handlePardon);
    ui.onWindDownClick(handleWindDown);
    ui.onEndConversationClick(handleEndConversation);
    ui.showEngineState(engine.getSnapshot());
    worldviewUI.init();
    keyboard.init();
    keyboard.setMode(storage.loadKeyboardMode());
    keyboard.setSideLayout(storage.loadSideLayout());
    keyboard.setBottomLayout(storage.loadBottomLayout());
    keyboard.setSideDockPosition(storage.loadSideDockPosition());
    initSettingsTabs();
    initSettingsDrag();
    // Take the keyboard preview down when Settings is dismissed. The Close
    // button does this explicitly; this 'cancel' listener covers Escape (the
    // dialog 'close' event proved unreliable here). The panel nudge is pure CSS
    // (driven by the keyboard's body classes), so nothing to clean up there.
    const settingsDialog = document.getElementById('settingsDialog');
    settingsDialog.addEventListener('cancel', () => {
        // Mirror the Close button: persist the API key (covers paste paths that
        // didn't fire `input`) and take the keyboard fully down.
        const apiKeyInput = document.getElementById('apiKeyInput');
        if (apiKeyInput) {
            const key = apiKeyInput.value.trim();
            if (key !== (storage.loadApiKey() || '')) { llm.setApiKey(key); storage.saveApiKey(key); }
        }
        keyboard.hideKeyboard();
        resetSettingsPosition();
    });
    // When the keyboard's dock/side changes, re-snap a dragged panel so it
    // clears the keyboard again (the CSS auto-position then takes over).
    document.addEventListener('kbd-dock-change', () => resetSettingsPosition());
    const versionEl = document.getElementById('aboutVersion');
    if (versionEl) versionEl.textContent = APP_VERSION;

    tts.onVoicesReady(() => {
        const savedURI = storage.loadVoiceURI();
        if (savedURI) tts.setVoice(savedURI);
    });

    llm.onUsage((input, output) => storage.addUsageTokens(input, output));

    // Load the worldview registry + profile so generation can inject the
    // profile block even before the user opens "About Me". The data folder
    // isn't restored until Start, so this first load uses the localStorage
    // cache; handleStart() reloads from the folder once it's granted.
    worldview.loadRegistry().catch(() => { /* registry optional at startup */ });
    worldview.load().catch(() => { /* falls back to empty profile */ });
    // Relationship graph (people/edges) — its own model + file. Loaded here from
    // the cache; handleStart() reloads from the folder and runs the one-time
    // migration of the former worldview "People" module once both are loaded.
    relationships.load().catch(() => { /* falls back to empty graph */ });

    const savedKey = storage.loadApiKey();
    if (savedKey) {
        llm.setApiKey(savedKey);
        ui.setStatus('Ready — API key loaded');
    } else {
        ui.setStatus('No API key set — open Settings to add your Claude API key');
    }
}

function handleSpeechResult(liveText) {
    // Live transcript while the partner is speaking — provisional, not yet
    // confirmed. Confirmation happens implicitly when the user picks a response.
    ui.showTranscript(liveText, false);
}

// Fired each time the partner pauses for the configured silence period.
// Recording continues; we just take everything collected so far and refresh
// the response options from it. A later (more complete) period supersedes this.
// Per the no-confirmation-gate decision (June 15 2026) generation fires here on
// silence — there is no confirm-the-transcript step.
async function handleSilencePeriod(text) {
    currentPartnerText = text;
    ui.showTranscript(text, false);
    engine.partnerSpeaking(text);
    // Placeholders no longer start here (Ken, June 18 2026). A filler must cover
    // the user's READING/CHOOSING window, not the AI-latency gap, and must only
    // fire for the partner actions that warrant it (questions, not statements or
    // closings) — neither is known until the classification comes back. So the
    // ladder is started inside generateOptions, gated on the result.
    await generateOptions(text);
}

function handleSttStatus(status, detail) {
    isListening = status === 'listening';
    ui.setListenButtonState(isListening);

    if (status === 'error') {
        ui.setStatus(`Microphone error: ${detail}`);
    } else if (status === 'listening') {
        ui.setStatus('Listening...');
    } else if (status === 'stopped') {
        ui.setStatus('Ready');
    }
}

async function handleStart() {
    // Check for a newer deployed version when the session starts. If one is
    // found the worker activates and the controllerchange handler in index.html
    // reloads the page; when nothing is new this is a cheap no-op.
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration()
            .then((reg) => reg && reg.update())
            .catch(() => { /* update check is best-effort */ });
    }
    try { await storage.restoreDataFolder(); } catch { /* no stored handle yet */ }
    // Reload the worldview profile from the (now-restored) data folder, then
    // reconcile: if answers accumulated only in the localStorage cache (no
    // folder earlier), promote them to the on-disk worldview.json now.
    try { await worldview.load(); } catch { /* keep cached/empty profile */ }
    try { await worldview.syncToFolder(); } catch { /* best-effort */ }
    // Same for the relationship graph.
    try { await relationships.load(); } catch { /* keep cached/empty graph */ }
    try { await relationships.syncToFolder(); } catch { /* best-effort */ }
    // Fresh conversation state for this session.
    engine.reset();
    ui.showEngineState(engine.getSnapshot());
    document.getElementById('startOverlay').classList.add('hidden');
    document.querySelector('main').classList.remove('disabled');
}

function toggleListening() {
    if (isListening) {
        // Manual stop: disarm auto-resume until the user starts again.
        manualListenArmed = false;
        stt.stopListening();
    } else {
        // Manual start: arm auto-resume for the rest of this session.
        manualListenArmed = true;
        startFreshListening();
    }
}

// Begin a new partner-capture session with a cleared transcript and options.
function startFreshListening() {
    currentPartnerText = '';
    generationToken++;
    ui.showTranscript('', false);
    ui.clearResponseOptions();
    stt.startListening();
}

// Partner actions that put a real response obligation on the user — the ones
// where a "I'm-thinking-about-your-question" placeholder reads as natural. For
// statements, greetings, assessments and closings a placeholder feels off (Ken,
// June 18 2026), so we stay quiet.
const FILLER_WORTHY_ACTIONS = new Set(['QUESTION', 'INVITATION', 'REQUEST']);

function shouldPlayFiller(snap) {
    const c = snap.lastClassification;
    if (!c) return false;
    if (c.turn_status !== 'COMPLETE' || c.is_repair_initiator) return false;
    // Never during winding-down / closing.
    if (snap.mode === engine.MODE.PRE_CLOSING_CLOSING) return false;
    if (snap.phase === 'PRE_CLOSING' || snap.phase === 'CLOSING') return false;
    return FILLER_WORTHY_ACTIONS.has(c.partner_action);
}

async function generateOptions(partnerText) {
    const token = ++generationToken;
    ui.setStatus('Generating response options...');
    ui.clearResponseOptions();

    // Generate from prior committed turns plus the partner's current
    // (provisional, uncleaned) speech — the transcript is cleaned only once, at
    // the end, when the user selects a response.
    const history = [...conversationHistory, { role: 'partner', text: partnerText }];

    // Inject the current worldview profile so the assistant speaks AS the user.
    // Rebuilt each turn so questionnaire edits take effect immediately.
    llm.setWorldviewBlock(worldview.buildBlock());
    llm.setRelationshipsBlock(relationships.buildBlock());

    try {
        const result = await llm.generateResponses(history, engine.buildRequestContext());
        if (token !== generationToken) return; // a newer silence period superseded this

        // Engine ingests the classification and updates mode / stack / palette.
        const snap = engine.ingestClassification(result, partnerText);
        ui.showEngineState(snap);
        lastPalette = snap.palette;

        if (snap.lastClassification && snap.lastClassification.turn_status !== 'COMPLETE'
            && !snap.lastClassification.is_repair_initiator) {
            // Mid-utterance pause (INCOMPLETE / CONTINUING) — don't respond. Stop
            // holding the floor and keep listening for the rest of the turn.
            placeholders.stop();
            ui.clearResponseOptions();
            ui.setStatus('Partner still speaking…');
        } else {
            ui.showMoves(snap.palette, handleMoveSelected);
            ui.setStatus(snap.mode === engine.MODE.REPAIR_OF_SELF
                ? 'Partner didn\'t catch that — choose how to repeat'
                : 'Select a response');
            // Now that the options are on screen and we know what the partner
            // did, start the floor-holding placeholders ONLY when they're
            // warranted (a question, not a statement/greeting/closing). The first
            // one lands initialDelay after this point; a quick pick cancels it.
            if (shouldPlayFiller(snap)) placeholders.start();
            else placeholders.stop();
        }

        // Record facts the model lacked — drives the questionnaire's "suggested
        // next." Open gaps only; recordGaps drops answered/declined keys.
        if (result.missingFacts && result.missingFacts.length) {
            worldview.recordGaps(result.missingFacts, partnerText).catch(() => { /* non-fatal */ });
        }
    } catch (err) {
        if (token !== generationToken) return;
        ui.setStatus(`Error: ${err.message}`);
    }
}

// A move from the palette was selected. Repair-of-self operations act on the
// user's own last utterance; everything else is a normal SPP / opener / closer.
async function handleMoveSelected(move, index) {
    if (move.op) return handleRepairOfSelf(move);

    placeholders.stop();
    generationToken++; // invalidate any in-flight generation
    stt.stopListening();

    const raw = currentPartnerText;
    currentPartnerText = '';

    ui.setStatus('Speaking...');
    await tts.speak(move.text);

    engine.selectMove(move);
    ui.showEngineState(engine.getSnapshot());

    await commitExchange(raw, move.text, index);
    resumeOrIdle();
}

// REPAIR-OF-SELF (design §7.2): re-speak verbatim (instant, no LLM), or
// rephrase / expand the user's last utterance via a round-trip.
async function handleRepairOfSelf(move) {
    placeholders.stop();
    generationToken++;
    stt.stopListening();

    let text = engine.getLastUserUtterance();
    if (!text) {
        ui.setStatus('Nothing to repeat yet');
        return;
    }
    if (move.op !== 'respeak') {
        ui.setStatus(move.op === 'expand' ? 'Expanding…' : 'Rephrasing…');
        try {
            text = await llm.repairSelf(engine.getLastUserUtterance(), move.op, conversationHistory);
        } catch (err) {
            ui.setStatus(`Error: ${err.message}`);
            return;
        }
    }

    const raw = currentPartnerText; // the partner's repair-initiator turn ("What?")
    currentPartnerText = '';

    ui.setStatus('Speaking...');
    await tts.speak(text);

    engine.completeRepairOfSelf(text);
    ui.showEngineState(engine.getSnapshot());

    // Log the partner's repair initiation and the user's restated turn.
    if (raw) {
        conversationHistory.push({ role: 'partner', text: raw });
        storage.logPartnerSpeech({ rawTranscript: raw, cleanedTranscript: raw });
    }
    conversationHistory.push({ role: 'user', text });
    storage.logUserResponse({ selectedText: text, selectedIndex: -1, allOptions: [] });
    resumeOrIdle();
}

// Clean the combined partner transcript once, then commit the partner turn
// (cleaned text feeds context for future turns) followed by the user's
// response. Cleaning happens after speaking so it never delays the user's
// words. `raw` may be empty (openers / closers have no captured partner turn).
async function commitExchange(raw, userText, index) {
    if (raw) {
        let cleaned = raw;
        try {
            cleaned = await llm.cleanupTranscript(raw, conversationHistory);
        } catch { /* fall back to raw */ }
        conversationHistory.push({ role: 'partner', text: cleaned });
        ui.showTranscript(cleaned, true);
        storage.logPartnerSpeech({ rawTranscript: raw, cleanedTranscript: cleaned });
    }
    conversationHistory.push({ role: 'user', text: userText });
    storage.logUserResponse({
        selectedText: userText,
        selectedIndex: index,
        allOptions: lastPalette.map(m => m.text).filter(Boolean),
    });
}

// Auto-resume only if the user has manually started listening this session (and
// hasn't since manually stopped) — see manualListenArmed.
function resumeOrIdle() {
    if (manualListenArmed && storage.loadAutoRelisten()) {
        startFreshListening();
    } else {
        ui.setStatus('Ready — tap Listen for the next exchange');
    }
}

// --- Persistent override controls (design §5.1) ---

// Start conversation — INITIATING mode; surface pre-sequences / openers.
function handleInitiate() {
    const snap = engine.initiate();
    ui.showEngineState(snap);
    ui.showMoves(snap.palette, handleMoveSelected);
    ui.setStatus('Pick an opener');
}

// Say again — re-speak the user's last utterance verbatim. Instant, no LLM.
async function handleSayAgain() {
    const text = engine.getLastUserUtterance();
    if (!text) { ui.setStatus('Nothing to repeat yet'); return; }
    placeholders.stop();
    ui.setStatus('Speaking...');
    await tts.speak(text);
    ui.setStatus(isListening ? 'Listening...' : 'Ready');
}

// Hold on — manually fire a floor-holding filler. Instant.
async function handleHoldOn() {
    placeholders.stop();
    ui.setStatus('Speaking...');
    // Softened from "Hold on, let me think." — imperative phrasing reads as curt
    // through the flat built-in voices (Ken, June 18 2026). The leading "Hmm,"
    // (v0.3.14) was dropped (Ken, June 19 2026) — the built-in voices render it
    // unintelligibly, so it read as garble rather than a thinking beat.
    await tts.speak('Let me think about that.');
    ui.setStatus(isListening ? 'Listening...' : 'Ready');
}

// Pardon? — the single "I didn't catch what the partner said" control. The user
// shouldn't have to reason about sequence-stack mechanics, so this one action
// does everything the misheard-partner case needs (Ken, June 19 2026 —
// consolidates the former "Pardon?" + "Please repeat what you said." controls,
// each of which did only half the job): it (1) asks the partner to repeat, (2)
// discards the garbled capture so the re-speak starts clean (the old "Please
// repeat" did this; "Pardon?" did not — it left the mumble in the transcript to
// be appended to), and (3) pushes a repair sequence so the partner's re-speak
// resolves correctly against the original question (the old "Pardon?" did this;
// "Please repeat" did not touch the stack). engine.pardon() dedups, so tapping
// it again before the re-speak doesn't stack a second repair.
async function handlePardon() {
    placeholders.stop();
    generationToken++;            // invalidate any in-flight generation on the garbled capture
    const snap = engine.pardon(); // push REPAIR* (dedups); floor → partner
    currentPartnerText = '';      // discard the misheard capture…
    stt.resetTranscript();        // …and the accumulated STT, so the re-speak is fresh
    ui.showEngineState(snap);
    ui.showTranscript('', false);
    ui.clearResponseOptions();
    ui.setStatus('Speaking...');
    await tts.speak("Sorry, I didn't catch that. Could you say it again?");
    ui.setStatus(isListening ? 'Listening...' : 'Ready');
}

// "Show me different options" — the user finds the offered palette not quite
// right and wants a fresh set for the SAME partner turn. Re-runs generation with
// the rejected options passed as `avoid`, then refreshes ONLY the palette
// (engine.refreshPalette) — the sequence stack / mode / floor are unchanged, so
// we deliberately do NOT re-ingest the classification (that would push a
// duplicate FPP). Whole-palette regenerate (not per-move) — see CLAUDE.md to-do.
async function handleRegenerate() {
    if (!currentPartnerText || !lastPalette.length) return;
    const token = ++generationToken;
    placeholders.stop();
    ui.setStatus('Getting different options...');

    const prior = lastPalette.map((m) => m.text).filter(Boolean);
    llm.setWorldviewBlock(worldview.buildBlock());
    llm.setRelationshipsBlock(relationships.buildBlock());
    const history = [...conversationHistory, { role: 'partner', text: currentPartnerText }];

    try {
        const result = await llm.generateResponses(history, engine.buildRequestContext(), { avoid: prior });
        if (token !== generationToken) return; // superseded
        const snap = engine.refreshPalette(result.moves);
        ui.showEngineState(snap);
        lastPalette = snap.palette;
        ui.showMoves(snap.palette, handleMoveSelected);
        ui.setStatus('Select a response');
    } catch (err) {
        if (token !== generationToken) return;
        ui.setStatus(`Error: ${err.message}`);
    }
}

// Wind down — enter PRE-CLOSING and swap to the closing palette.
function handleWindDown() {
    placeholders.stop();
    const snap = engine.windDown();
    ui.showEngineState(snap);
    ui.showMoves(snap.palette, handleMoveSelected);
    ui.setStatus('Pick a closing');
}

// End conversation — hard terminate (Ken, June 18 2026). Tears everything down
// and returns the engine to STANDBY: stop the filler ladder, cancel any speech,
// stop listening, invalidate in-flight generation, drop the partner's
// uncommitted turn, clear the palette/transcript, and reset the engine (empty
// stack, floor OPEN). No danger-confirm — it's the "hang up" control, and the
// conversation history is already logged exchange-by-exchange. Committed
// exchanges remain in conversationHistory; only the current, unselected turn is
// discarded.
function handleEndConversation() {
    placeholders.stop();
    tts.cancel();
    manualListenArmed = false;
    stt.stopListening();
    generationToken++;            // invalidate any in-flight generation
    currentPartnerText = '';
    engine.reset();
    ui.showEngineState(engine.getSnapshot());
    ui.clearResponseOptions();
    ui.showTranscript('', false);
    ui.setStatus('Conversation ended — tap Start conversation or Listen to begin again');
}

// "In your own words" composer — speak free-composed text in the user's
// selected voice. The manual realization of the free-composition invariant and
// the hand-test pathway for worldview output. MVP: speak only; whether to also
// commit to conversation history is a deferred decision (see CLAUDE.md).
async function handleSpeakComposed() {
    const text = ui.getComposerText();
    if (!text) return;
    placeholders.stop();
    ui.setStatus('Speaking...');
    await tts.speak(text);
    ui.setStatus(isListening ? 'Listening...' : 'Ready');
}

// --- Settings dialog ---

function initSettingsTabs() {
    document.querySelectorAll('#settingsTabs .settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('#settingsTabs .settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#settingsContent .tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.querySelector(`.tab-panel[data-tab="${tab.dataset.tab}"]`).classList.add('active');
            handleSettingsTab(tab.dataset.tab);
        });
    });
}

// On the Speech & Input tab the user changes keyboard layouts but there's no
// text field to type into, so show the keyboard as a live preview (side dock by
// default — that's the one being tuned). Any other tab takes the preview down.
function handleSettingsTab(tabName) {
    if (tabName === 'speech' && storage.loadKeyboardMode() === 'onscreen') {
        keyboard.previewShow('side');
    } else {
        keyboard.previewHide();
    }
}

// Tracks whether the user has dragged the Settings panel (pinning it with
// inline left/top, which override the CSS auto-position). Reset when the
// keyboard's dock/side changes so the panel re-snaps to clear the keyboard.
let settingsDragged = false;

function resetSettingsPosition() {
    const dialog = document.getElementById('settingsDialog');
    if (!dialog || !settingsDragged) return;
    dialog.style.margin = '';
    dialog.style.left = '';
    dialog.style.top = '';
    settingsDragged = false;
}

// Drag-to-move for the Settings dialog (pattern borrowed from the Keyguard
// Designer app). The panel stays modal — the backdrop still blocks the app
// behind it — but can be dragged aside by its title bar so live UI changes are
// visible behind it. A native <dialog> is centered by the UA with auto margins;
// on the first drag we convert that to pixel left/top with margin:0, then track
// the pointer, clamping to the viewport. Position persists until the keyboard
// state changes (resetSettingsPosition) or Settings closes.
function initSettingsDrag() {
    const dialog = document.getElementById('settingsDialog');
    const handle = document.getElementById('settingsHeader');
    if (!dialog || !handle) return;
    let dragging = false, offsetX = 0, offsetY = 0;

    handle.addEventListener('pointerdown', (e) => {
        // On the first drag, pin the dialog to its current rect so left/top win
        // over the UA's centering margins / CSS auto-position.
        const r = dialog.getBoundingClientRect();
        if (!settingsDragged) {
            dialog.style.margin = '0';
            dialog.style.left = `${r.left}px`;
            dialog.style.top = `${r.top}px`;
            settingsDragged = true;
        }
        dragging = true;
        offsetX = e.clientX - r.left;
        offsetY = e.clientY - r.top;
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const maxX = window.innerWidth - dialog.offsetWidth;
        const maxY = window.innerHeight - dialog.offsetHeight;
        dialog.style.left = `${Math.max(0, Math.min(e.clientX - offsetX, maxX))}px`;
        dialog.style.top = `${Math.max(0, Math.min(e.clientY - offsetY, maxY))}px`;
    });

    const stop = (e) => {
        if (!dragging) return;
        dragging = false;
        try { handle.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
}

function populateVoiceSelect() {
    const select = document.getElementById('voiceSelect');
    const voices = tts.getVoices();
    const savedURI = storage.loadVoiceURI();
    select.innerHTML = '';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Browser default';
    select.appendChild(defaultOpt);

    voices.forEach(voice => {
        const opt = document.createElement('option');
        opt.value = voice.voiceURI;
        opt.textContent = `${voice.name} (${voice.lang})`;
        if (voice.voiceURI === savedURI) opt.selected = true;
        select.appendChild(opt);
    });
}

function fillLayoutSelect(select, layouts, selectedId) {
    select.innerHTML = '';
    layouts.forEach(({ id, name }) => {
        const opt = document.createElement('option');
        opt.value = id;
        opt.textContent = `${id} — ${name}`;
        if (id === selectedId) opt.selected = true;
        select.appendChild(opt);
    });
}

function updateFolderDisplay() {
    const nameEl = document.getElementById('dataFolderName');
    const name = storage.getDataFolderName();
    if (name) {
        nameEl.textContent = name;
        nameEl.classList.remove('placeholder');
    } else {
        nameEl.textContent = 'No folder selected';
        nameEl.classList.add('placeholder');
    }
}

let pricingData = null;

async function loadPricing() {
    if (pricingData) return pricingData;
    try {
        const resp = await fetch('data/pricing.json');
        pricingData = await resp.json();
    } catch {
        pricingData = { inputCostPerMillionTokens: 3, outputCostPerMillionTokens: 15 };
    }
    return pricingData;
}

async function updateUsageDisplay() {
    const usage = storage.loadUsage();
    const pricing = await loadPricing();
    const cost = (usage.inputTokens * pricing.inputCostPerMillionTokens / 1_000_000)
               + (usage.outputTokens * pricing.outputCostPerMillionTokens / 1_000_000);
    document.getElementById('usageCost').textContent = `$${cost.toFixed(2)}`;
    const sinceDate = new Date(usage.since).toLocaleDateString();
    document.getElementById('usageSince').textContent = `since ${sinceDate}`;
}

function openSettings() {
    const dialog = document.getElementById('settingsDialog');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const voiceSelect = document.getElementById('voiceSelect');
    const silenceThresholdInput = document.getElementById('silenceThresholdInput');
    const autoRelistenInput = document.getElementById('autoRelistenInput');
    const initialDelayInput = document.getElementById('initialDelayInput');
    const subsequentDelayInput = document.getElementById('subsequentDelayInput');
    const maxPlaceholdersInput = document.getElementById('maxPlaceholdersInput');

    apiKeyInput.value = storage.loadApiKey() || '';
    populateVoiceSelect();
    silenceThresholdInput.value = storage.loadSilenceThreshold();
    autoRelistenInput.checked = storage.loadAutoRelisten();
    const keyboardMode = storage.loadKeyboardMode();
    const keyboardRadio = document.querySelector(`input[name="keyboardMode"][value="${keyboardMode}"]`);
    if (keyboardRadio) keyboardRadio.checked = true;
    const bottomLayoutSelect = document.getElementById('bottomLayoutSelect');
    const sideLayoutSelect = document.getElementById('sideLayoutSelect');
    const sideDockPositionToggle = document.getElementById('sideDockPositionToggle');
    fillLayoutSelect(bottomLayoutSelect, BOTTOM_LAYOUTS, storage.loadBottomLayout());
    fillLayoutSelect(sideLayoutSelect, SIDE_LAYOUTS, storage.loadSideLayout());
    sideDockPositionToggle.checked = storage.loadSideDockPosition() === 'right';
    updateUsageDisplay();
    const placeholderSettings = storage.loadPlaceholderSettings();
    initialDelayInput.value = placeholderSettings.initialDelay;
    subsequentDelayInput.value = placeholderSettings.subsequentDelay;
    maxPlaceholdersInput.value = placeholderSettings.maxPlaceholders;
    updateFolderDisplay();

    // Reset to General tab
    document.querySelectorAll('#settingsTabs .settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#settingsContent .tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.settings-tab[data-tab="general"]').classList.add('active');
    document.querySelector('.tab-panel[data-tab="general"]').classList.add('active');

    dialog.showModal();
    // Park focus on the (non-input) header so the dialog doesn't autofocus the
    // API-key field — which would pop the on-screen keyboard on open and race
    // with tab switches. The keyboard then appears only when a field or a
    // layout setting is tapped.
    document.getElementById('settingsHeader')?.focus();

    document.getElementById('pickFolderBtn').onclick = async () => {
        try {
            await storage.pickDataFolder();
            // A folder just became available — flush any cache-only worldview
            // answers to the on-disk worldview.json.
            try { await worldview.syncToFolder(); } catch { /* best-effort */ }
            updateFolderDisplay();
        } catch (err) {
            if (err.name !== 'AbortError') {
                ui.setStatus(`Folder error: ${err.message}`);
            }
        }
    };

    document.getElementById('resetUsageBtn').onclick = () => {
        storage.resetUsage();
        updateUsageDisplay();
    };

    document.getElementById('testVoiceBtn').onclick = () => {
        tts.setVoice(voiceSelect.value || null);
        tts.speak('This is how I will sound during our conversation.');
    };

    // No Save button (Ken, June 14 2026): every control applies AND persists
    // immediately, so Settings doubles as a live test bench (e.g. trying the
    // side-dock keyboard layouts). Close just dismisses the panel.
    apiKeyInput.oninput = () => {
        const key = apiKeyInput.value.trim();
        llm.setApiKey(key);
        storage.saveApiKey(key);
    };
    voiceSelect.onchange = () => {
        const voiceURI = voiceSelect.value || null;
        tts.setVoice(voiceURI);
        storage.saveVoiceURI(voiceURI);
    };
    silenceThresholdInput.onchange = () => {
        const threshold = Number(silenceThresholdInput.value);
        stt.setSilenceThreshold(threshold);
        storage.saveSilenceThreshold(threshold);
    };
    autoRelistenInput.onchange = () => storage.saveAutoRelisten(autoRelistenInput.checked);
    document.querySelectorAll('input[name="keyboardMode"]').forEach(radio => {
        radio.onchange = () => {
            const mode = document.querySelector('input[name="keyboardMode"]:checked')?.value || 'physical';
            keyboard.setMode(mode);
            storage.saveKeyboardMode(mode);
            // Reflect the change in the live preview on the Speech & Input tab.
            handleSettingsTab(document.querySelector('#settingsTabs .settings-tab.active')?.dataset.tab);
        };
    });
    // Tapping (or focusing, or changing) a keyboard-layout control previews
    // that dock — and shows the keyboard if it's currently hidden (e.g. after
    // Hide). pointerdown covers re-tapping an already-focused control, where no
    // focus event fires. The selects also re-render so the choice shows live.
    const previewBottom = () => keyboard.previewShow('bottom');
    const previewSide = () => keyboard.previewShow('side');
    bottomLayoutSelect.onpointerdown = bottomLayoutSelect.onfocus = previewBottom;
    bottomLayoutSelect.onchange = () => {
        keyboard.setBottomLayout(bottomLayoutSelect.value);
        storage.saveBottomLayout(bottomLayoutSelect.value);
        keyboard.previewShow('bottom');
    };
    sideLayoutSelect.onpointerdown = sideLayoutSelect.onfocus = previewSide;
    sideLayoutSelect.onchange = () => {
        keyboard.setSideLayout(sideLayoutSelect.value);
        storage.saveSideLayout(sideLayoutSelect.value);
        keyboard.previewShow('side');
    };
    sideDockPositionToggle.onpointerdown = sideDockPositionToggle.onfocus = previewSide;
    sideDockPositionToggle.onchange = () => {
        const pos = sideDockPositionToggle.checked ? 'right' : 'left';
        keyboard.setSideDockPosition(pos);
        storage.saveSideDockPosition(pos);
        keyboard.previewShow('side');
    };
    const persistPlaceholders = () => storage.savePlaceholderSettings(
        Number(initialDelayInput.value),
        Number(subsequentDelayInput.value),
        Number(maxPlaceholdersInput.value)
    );
    initialDelayInput.onchange = persistPlaceholders;
    subsequentDelayInput.onchange = persistPlaceholders;
    maxPlaceholdersInput.onchange = persistPlaceholders;

    document.getElementById('closeSettingsBtn').onclick = () => {
        // Belt-and-suspenders: persist the API key from the field on Close.
        // `oninput` already saves on every keystroke/paste, but some paste paths
        // (e.g. autofill, or an OS paste that doesn't dispatch `input`) can leave
        // the field populated yet unsaved — Ken's bug 1. Saving here guarantees
        // whatever is in the field when the user closes Settings is persisted.
        const key = apiKeyInput.value.trim();
        if (key !== (storage.loadApiKey() || '')) {
            llm.setApiKey(key);
            storage.saveApiKey(key);
        }
        // The keyboard is now kept up when focus moves to in-dialog controls, so
        // take it down explicitly on close (covers both real-typing and preview).
        keyboard.hideKeyboard();
        resetSettingsPosition();
        dialog.close();
    };
}

initApp();
