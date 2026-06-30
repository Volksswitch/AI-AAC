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
import { SIDE_LAYOUTS, BOTTOM_LAYOUTS, LAYOUTS } from './keyboard-layouts.js';
import * as viewport from './viewport.js';
import * as expressItems from './express-items.js';
import * as expressPanel from './express-panel.js';
import * as expressEditor from './express-editor.js';
import * as controlPhrases from './control-phrases.js';
import * as controlEditor from './control-phrases-editor.js';

// Point-release version shown in Settings → About. Bump alongside the
// sw.js CACHE_VERSION on every release so beta testers can report exactly
// which build they're on.
const APP_VERSION = '0.5.53';

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

// Active influencer TOGGLES from the Express Panel (Ken, June 26 2026). One
// active Partner (who the user is talking with) and one active Feeling (current
// mood) at a time. The Partner personalizes openers + tells the AI who the
// partner is; the Feeling steers the tone of suggestions. Persist across an
// exchange; cleared only by tapping the same toggle again or picking another.
let activePartner = null;
let activeFeeling = null;

function initApp() {
    // Log the display metrics (and re-log on every viewport change) so we — and
    // beta testers — can see the real pixel box the app is running in. Started
    // first so the initial numbers are captured even if STT is unsupported.
    viewport.init();

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

    // Surface what the app is saying on the user's behalf (fillers, the spoken
    // response, prompts) as text in Region A — nothing the system speaks is
    // invisible (UI-Design.docx §7). Cleared when speech ends.
    tts.onSpeakingChange((speaking, text) => ui.setNowPlaying(speaking ? text : null));

    document.getElementById('startBtn').addEventListener('click', handleStart);
    ui.onListenClick(toggleListening);
    ui.onRegenerateClick(handleRegenerate);
    ui.onSpeakClick(handleSpeakComposed);
    ui.onReframeClick(handleReframe);
    ui.onCancelComposerClick(handleCancelComposed);
    ui.onSettingsClick(openSettings);
    // About Me is no longer a title-bar button — it's launched from the Settings
    // panel's "About Me" tab (see initSettingsTabs).
    // Persistent override controls (Conversation-Engine-Design.docx §5.1) — the
    // user's escape hatch when the engine's mode inference is wrong.
    ui.onInitiateClick(handleInitiate);
    ui.onSayAgainClick(handleSayAgain);
    ui.onHoldOnClick(handleHoldOn);
    ui.onPardonClick(handlePardon);
    ui.onWindDownClick(handleWindDown);
    ui.onEndConversationClick(handleEndConversation);
    ui.showEngineState(engine.getSnapshot());
    ui.applyControlIcons();
    applyConversationDockClasses();
    applyButtonSizing();   // compute the conversation layout (region sizes + gaps)
    // Region sizes depend on the viewport — recompute on resize/orientation.
    window.addEventListener('resize', applyButtonSizing);
    ui.clearResponseOptions(); // render the reserved empty card footprint at rest
    renderExpressPanel();
    expressEditor.init(document.getElementById('expressEditor'), { onChange: renderExpressPanel });
    controlEditor.init(document.getElementById('controlEditor'), { onChange: applyControlPhrases });
    // About Me is launched from the Settings → About Me tab, so Done returns there.
    worldviewUI.init({ onClose: openSettings });
    applyFontScales();   // user-set Transcript / Composer / Express text sizes
    initSliderSteppers(); // − / + fine-step buttons on the size sliders
    ui.setRegenerateLabel(storage.loadResponsesPerCategory() * 4); // "New 4"/"New 8"
    keyboard.init();
    keyboard.setMode(storage.loadKeyboardMode());
    keyboard.setSideLayout(storage.loadSideLayout());
    keyboard.setBottomLayout(storage.loadBottomLayout());
    keyboard.setSideDockPosition(storage.loadSideDockPosition());
    keyboard.setKeyboardDock(storage.loadKeyboardDock());
    initSettingsTabs();
    // Take the keyboard preview down when Settings is dismissed. The Close
    // button does this explicitly; this 'cancel' listener covers Escape (the
    // dialog 'close' event proved unreliable here). Settings is now a fixed
    // main-area panel (Spatial Stability), so there's no drag position to reset.
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
    });
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
    // Express Panel items — its own model + file. Loaded from cache now; the
    // folder copy (source of truth) is adopted in handleStart once granted.
    expressPanel.load().then(renderExpressPanel).catch(() => { /* falls back to defaults */ });
    // Control phrases (Hold on / Pardon? / openers / closers) — own model + file.
    controlPhrases.load().then(applyControlPhrases).catch(() => { /* engine keeps inline defaults */ });

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
    ui.setLiveTranscript(liveText);
    if (liveText) ui.setTranscriptState('unconfirmed');
}

// Fired each time the partner pauses for the configured silence period.
// Recording continues; we just take everything collected so far and refresh
// the response options from it. A later (more complete) period supersedes this.
// Per the no-confirmation-gate decision (June 15 2026) generation fires here on
// silence — there is no confirm-the-transcript step.
async function handleSilencePeriod(text) {
    currentPartnerText = text;
    ui.setLiveTranscript(text);
    engine.partnerSpeaking(text);
    // Start the initial-delay clock at the pause (Ken, June 28 2026) so a slow AI
    // round-trip doesn't leave dead air. arm() only starts the clock; the filler
    // is still gated on the classification (questions only) inside generateOptions,
    // which calls placeholders.start() (fires immediately if the delay already
    // elapsed) or placeholders.stop() (not filler-worthy).
    placeholders.arm();
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
    // Same for the Express Panel items (adopt the folder copy, else promote cache).
    try { await expressPanel.load(); } catch { /* keep cached/default items */ }
    try { await expressPanel.syncToFolder(); } catch { /* best-effort */ }
    renderExpressPanel(); // reflect any adopted items
    // Same for the control phrases (Hold on / Pardon? / openers / closers).
    try { await controlPhrases.load(); } catch { /* keep cached/default phrases */ }
    try { await controlPhrases.syncToFolder(); } catch { /* best-effort */ }
    applyControlPhrases();
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
    ui.setLiveTranscript('');
    ui.setTranscriptState('idle');
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
    ui.setTranscriptState('generating');
    ui.clearResponseOptions();

    // Generate from prior committed turns plus the partner's current
    // (provisional, uncleaned) speech — the transcript is cleaned only once, at
    // the end, when the user selects a response.
    const history = [...conversationHistory, { role: 'partner', text: partnerText }];

    // Inject the current worldview profile so the assistant speaks AS the user.
    // Rebuilt each turn so questionnaire edits take effect immediately.
    llm.setWorldviewBlock(worldview.buildBlock());
    llm.setRelationshipsBlock(relationships.buildBlock());
    llm.setSituationBlock(buildSituationBlock());

    try {
        const result = await llm.generateResponses(history, engine.buildRequestContext(), { perCategory: storage.loadResponsesPerCategory() });
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
            ui.setTranscriptState('unconfirmed');
            ui.setStatus('Partner still speaking…');
        } else {
            ui.showResponses(snap.palette, handleResponseSelected);
            ui.setTranscriptState('ready');
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

// A response from the palette was selected. Repair-of-self operations act on the
// user's own last utterance; everything else is a normal SPP / opener / closer.
async function handleResponseSelected(response, index) {
    if (response.op) return handleRepairOfSelf(response);

    // Opening the conversation: after the user's opening statement is spoken, the
    // partner is expected to reply, so start recording automatically (Ken) —
    // regardless of the auto-resume setting, and arm the session so later
    // exchanges can auto-resume too. Captured before selectResponse clears the mode.
    const wasOpener = response.slot === 'OPENER';

    placeholders.stop();
    generationToken++; // invalidate any in-flight generation
    stt.stopListening();

    const raw = currentPartnerText;
    currentPartnerText = '';

    ui.setStatus('Speaking...');
    await tts.speak(response.text);

    engine.selectResponse(response);
    ui.showEngineState(engine.getSnapshot());

    await commitExchange(raw, response.text, index);
    if (wasOpener) {
        manualListenArmed = true;   // starting a conversation arms auto-resume
        startFreshListening();      // begin capturing the partner now
    } else {
        resumeOrIdle();
    }
}

// REPAIR-OF-SELF (design §7.2): re-speak verbatim (instant, no LLM), or
// rephrase / expand the user's last utterance via a round-trip.
async function handleRepairOfSelf(response) {
    placeholders.stop();
    generationToken++;
    stt.stopListening();

    let text = engine.getLastUserUtterance();
    if (!text) {
        ui.setStatus('Nothing to repeat yet');
        return;
    }
    if (response.op !== 'respeak') {
        ui.setStatus(response.op === 'expand' ? 'Expanding…' : 'Rephrasing…');
        try {
            text = await llm.repairSelf(engine.getLastUserUtterance(), response.op, conversationHistory);
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
    ui.renderConversation(conversationHistory);
    ui.setLiveTranscript('');
    resumeOrIdle();
}

// Commit the partner turn (it feeds context for future turns) followed by the
// user's response. The user's spoken words are rendered to the transcript
// IMMEDIATELY (Ken, June 29 2026 — they were lagging several seconds behind the
// speech because we awaited the partner-transcript cleanup round-trip first); the
// partner turn is shown with its raw text at once and quietly upgraded to the
// cleaned text when that round-trip returns. `raw` may be empty (openers /
// closers have no captured partner turn).
async function commitExchange(raw, userText, index) {
    // Snapshot the history BEFORE this exchange — that's the context the cleanup
    // pass should see (it shouldn't include the turn it's cleaning).
    const cleanupContext = [...conversationHistory];

    let partnerIdx = -1;
    if (raw) {
        conversationHistory.push({ role: 'partner', text: raw });
        partnerIdx = conversationHistory.length - 1;
    }
    conversationHistory.push({ role: 'user', text: userText });
    // Render the running transcript (user turn visible now) and clear the live turn.
    ui.renderConversation(conversationHistory);
    ui.setLiveTranscript('');

    const userLog = {
        selectedText: userText,
        selectedIndex: index,
        // Only a palette selection (index >= 0) has a meaningful "all options"
        // list; a free-composed utterance (index -1) was not picked from a
        // palette, so don't log the (possibly stale) last palette against it.
        allOptions: index >= 0 ? lastPalette.map(m => m.text).filter(Boolean) : [],
        // Stamp the situation at this turn (who, how the user felt) — null when off.
        partner: partnerStamp(),
        feeling: feelingStamp(),
    };

    if (raw) {
        // Clean the partner transcript in the background, patch its turn in place
        // when it returns (without delaying the user's words), then log the
        // exchange in proper partner-then-user order.
        const stamp = partnerStamp();
        (async () => {
            let cleaned = raw;
            try { cleaned = await llm.cleanupTranscript(raw, cleanupContext); } catch { /* fall back to raw */ }
            if (conversationHistory[partnerIdx]) {
                conversationHistory[partnerIdx].text = cleaned;
                ui.renderConversation(conversationHistory);
            }
            await storage.logPartnerSpeech({ rawTranscript: raw, cleanedTranscript: cleaned, partner: stamp });
            await storage.logUserResponse(userLog);
        })();
    } else {
        storage.logUserResponse(userLog);
    }
}

// Auto-resume only if the user has manually started listening this session (and
// hasn't since manually stopped) — see manualListenArmed.
function resumeOrIdle() {
    if (manualListenArmed && storage.loadAutoRelisten()) {
        startFreshListening();
    } else {
        ui.setTranscriptState('idle');
        ui.setStatus('Ready — tap Listen for the next exchange');
    }
}

// --- Persistent override controls (design §5.1) ---

// Fully clear and TERMINATE the current conversation (Ken): stop audio +
// listening, invalidate in-flight generation, drop the uncommitted partner turn,
// CLEAR the conversation window (transcript history) and ALL cards, and reset the
// engine to STANDBY. Shared by End conversation and Start conversation.
function terminateConversation() {
    placeholders.stop();
    tts.cancel();
    manualListenArmed = false;
    stt.stopListening();
    generationToken++;                 // invalidate any in-flight generation
    currentPartnerText = '';
    lastPalette = [];
    conversationHistory.length = 0;     // clear the conversation window
    engine.reset();
    ui.renderConversation(conversationHistory);
    ui.setLiveTranscript('');
    ui.setTranscriptState('idle');
    ui.clearResponseOptions();          // clear all cards (back to empty reserved)
    ui.showEngineState(engine.getSnapshot());
}

// Start conversation — terminate the current one (clear window + cards), then
// open a fresh conversation in INITIATING mode with the openers.
function handleInitiate() {
    terminateConversation();
    // If a Partner is active, personalize the openers with their name ("Hi Tim,
    // have you got a minute?" instead of "Hey, got a minute?").
    const partnerName = activePartner ? (activePartner.nickname || activePartner.name) : '';
    const snap = engine.initiate({ partnerName });
    ui.showEngineState(snap);
    ui.showResponses(snap.palette, handleResponseSelected);
    ui.setStatus('Pick an opener');
}

// Push the user's edited openers/closers into the engine (Hold on / Pardon? are
// read straight from the model at tap time). Called after load/sync and on every
// edit via the editor's onChange.
function applyControlPhrases() {
    const p = controlPhrases.getPhrases();
    // Drop blank rows (the editor allows a transient empty row) so no empty card
    // reaches the palette; setConversationPhrases ignores a fully-empty list and
    // keeps the defaults.
    const clean = (a) => a.map((s) => s.trim()).filter(Boolean);
    engine.setConversationPhrases({ openers: clean(p.openers), closers: clean(p.closers) });
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
    // User-editable (Settings → Controls). The default is softened from "Hold on,
    // let me think." — imperative phrasing reads as curt through the flat built-in
    // voices (Ken, June 18 2026), and the leading "Hmm," (v0.3.14) was dropped
    // (June 19 2026) as the built-in voices render it unintelligibly.
    await tts.speak(controlPhrases.getPhrases().holdOn);
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
    // Discard only the partner's LAST statement (Ken, June 28 2026) — if they
    // said several sentences this turn and only the last was garbled, the earlier
    // good ones are kept and the re-speak appends to them.
    const remaining = stt.dropLastStatement();
    currentPartnerText = remaining;
    ui.showEngineState(snap);
    ui.setLiveTranscript(remaining);
    ui.setTranscriptState('idle');
    ui.clearResponseOptions();
    ui.setStatus('Speaking...');
    await tts.speak(controlPhrases.getPhrases().pardon); // user-editable (Settings → Controls)
    ui.setStatus(isListening ? 'Listening...' : 'Ready');
}

// "Show me different options" — the user finds the offered palette not quite
// right and wants a fresh set for the SAME partner turn. Re-runs generation with
// the rejected options passed as `avoid`, then refreshes ONLY the palette
// (engine.refreshPalette) — the sequence stack / mode / floor are unchanged, so
// we deliberately do NOT re-ingest the classification (that would push a
// duplicate FPP). Whole-palette regenerate (not per-response) — see CLAUDE.md to-do.
async function handleRegenerate() {
    if (!currentPartnerText || !lastPalette.length) return;
    const token = ++generationToken;
    placeholders.stop();
    ui.setStatus('Getting different options...');

    const prior = lastPalette.map((m) => m.text).filter(Boolean);
    llm.setWorldviewBlock(worldview.buildBlock());
    llm.setRelationshipsBlock(relationships.buildBlock());
    llm.setSituationBlock(buildSituationBlock());
    const history = [...conversationHistory, { role: 'partner', text: currentPartnerText }];

    try {
        const result = await llm.generateResponses(history, engine.buildRequestContext(), { avoid: prior, perCategory: storage.loadResponsesPerCategory() });
        if (token !== generationToken) return; // superseded
        const snap = engine.refreshPalette(result.responses);
        ui.showEngineState(snap);
        lastPalette = snap.palette;
        ui.showResponses(snap.palette, handleResponseSelected);
        ui.setStatus('Select a response');
    } catch (err) {
        if (token !== generationToken) return;
        ui.setStatus(`Error: ${err.message}`);
    }
}

// "Reframe" — the second verb on the "In your own words" composer (Ken, June 21
// 2026). Instead of speaking the box text verbatim (Speak), hand it to the AI as
// steering/context and regenerate the suggested responses around it for the SAME
// partner turn. A *guided* regenerate: same engine.refreshPalette seam as
// handleRegenerate (stack / mode / floor untouched — we do NOT re-ingest the
// classification, which would push a duplicate FPP). One-shot: the steer applies
// to this regeneration only and the box is CLEARED on success, so an empty box
// reliably means "nothing pending" (a lingering value would read as a persistent
// steer — that sticky/conversation-goal version is deferred to the Goals
// subsystem). Guarded to an active partner turn with a palette, like regenerate.
async function handleReframe() {
    keyboard.acceptPendingGhost(); // fold a showing word-prediction ghost into the text first
    const steer = ui.getComposerText();
    // Clicking any of the three buttons dismisses the modal (Ken). Capture the
    // steer first, then close.
    ui.clearComposer();
    closeComposer();
    if (!steer) return;
    if (!currentPartnerText || !lastPalette.length) {
        ui.setStatus('Reframe needs an active response — wait for options first');
        return;
    }
    const token = ++generationToken;
    placeholders.stop();
    ui.setStatus('Reworking options with your input...');

    llm.setWorldviewBlock(worldview.buildBlock());
    llm.setRelationshipsBlock(relationships.buildBlock());
    llm.setSituationBlock(buildSituationBlock());
    const history = [...conversationHistory, { role: 'partner', text: currentPartnerText }];

    try {
        const result = await llm.generateResponses(history, engine.buildRequestContext(), { steer, perCategory: storage.loadResponsesPerCategory() });
        if (token !== generationToken) return; // superseded
        const snap = engine.refreshPalette(result.responses);
        ui.showEngineState(snap);
        lastPalette = snap.palette;
        ui.showResponses(snap.palette, handleResponseSelected);
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
    ui.showResponses(snap.palette, handleResponseSelected);
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
    terminateConversation();
    // Ending a conversation clears the situation influencers — the next person /
    // mood shouldn't inherit this conversation's Partner & Feeling selections.
    // (Done here, NOT in the shared terminateConversation, because Start
    // conversation reuses that and still needs the active Partner to personalize
    // its openers.)
    clearInfluencers();
    ui.setStatus('Conversation ended — tap Start conversation or Listen to begin again');
}

// Clear the active Partner / Feeling toggles and refresh the panel so their
// selected rings drop.
function clearInfluencers() {
    activePartner = null;
    activeFeeling = null;
    renderExpressPanel();
}

// The user is TAKING THE FLOOR with their own words — shared by the composer's
// Speak and by an Express Panel phrase. It behaves like selecting a response: terminates
// the partner's open turn (engine.selectResponse pops the partner FPP), stops
// recording, commits the exchange to history, and resumes listening iff
// auto-resume is armed. `historyText` is what's logged/displayed; `spokenText`
// is what TTS says (an Express Panel phrase may carry a distinct pronunciation form).
async function speakAsUserTurn(historyText, spokenText = historyText) {
    placeholders.stop();
    generationToken++;            // invalidate any in-flight generation on the partner turn
    stt.stopListening();

    const raw = currentPartnerText;
    currentPartnerText = '';

    ui.setStatus('Speaking...');
    await tts.speak(spokenText);

    engine.selectResponse({ text: historyText });
    ui.showEngineState(engine.getSnapshot());
    ui.clearResponseOptions();    // any AI palette shown is now stale

    await commitExchange(raw, historyText, -1);
    resumeOrIdle();
}

// --- "In my own words" modal (Rule 8) ---

// Open the modal: show the input box overlay over the reserved response
// footprint (base UI not blurred) and bring up the keyboard in the dock region.
function openComposer() {
    ui.clearComposer();
    ui.showComposerOverlay();
    ui.setStatus('Type your own words');
}

// Close the modal (Speak / Reframe / Cancel all do this): dismiss the input box
// AND the keyboard. The keyboard is dismissed explicitly — blurring the textarea
// alone won't reliably hide it, because Speak/Reframe/Cancel are "keep-open"
// controls (so their tap doesn't trip the focusout-hide before the handler runs).
function closeComposer() {
    ui.hideComposerOverlay();
    keyboard.hideKeyboard();
}

// Speak: say the composed text, take the floor + commit, then dismiss the modal.
async function handleSpeakComposed() {
    keyboard.acceptPendingGhost(); // fold a showing word-prediction ghost into the text first
    const text = ui.getComposerText();
    if (!text) { closeComposer(); return; }
    ui.clearComposer();
    closeComposer();
    await speakAsUserTurn(text);
}

// Cancel: discard the box and dismiss the modal (no speech).
function handleCancelComposed() {
    ui.clearComposer();
    closeComposer();
}

// --- Express Panel (base UI quick-speak + influencers, Rule 9) ---

// The Express Panel mirrors the SELECTED keyboard layout (so one keyguard
// overlays both): grab the layout rows for whichever dock is chosen and hand
// them to the renderer along with the item list. Re-called when the items, tap
// settings, dock, or layout changes.
function expressLayoutRows() {
    const dock = storage.loadKeyboardDock();
    const id = dock === 'side' ? storage.loadSideLayout() : storage.loadBottomLayout();
    return (LAYOUTS[id] && LAYOUTS[id].rows) || [];
}

function renderExpressPanel() {
    applyButtonSizing();   // the active layout may have changed → refresh --kbd-rows/--kbd-cols
    // The user-editable, ordered typed-item list (phrase / partner / feeling).
    ui.renderExpressPanel(expressLayoutRows(), expressPanel.getItems(), {
        categories: expressItems.CATEGORIES,
        influencerColors: expressItems.INFLUENCER_COLORS,
        activePartnerId: activePartner ? activePartner.id : null,
        activeFeelingId: activeFeeling ? activeFeeling.id : null,
        tapMode: storage.loadExpressTapMode(),
        doubleTapMs: storage.loadDoubleTapMs(),
        onSpeak: handleSpeakExpressItem,
        onTogglePartner: handleTogglePartner,
        onToggleFeeling: handleToggleFeeling,
        onInMyOwnWords: openComposer,
    });
}

// Build the per-turn SITUATION text for generation from the active influencers:
// who the user is talking with (Partner) and how they feel (Feeling). Empty when
// neither is active. The relationships block + nickname rule handle a Partner who
// is also a known person; this just adds "you're talking with them right now".
function buildSituationBlock() {
    const lines = [];
    if (activePartner) {
        const label = (activePartner.nickname || activePartner.name || '').trim();
        if (label) lines.push(`You are currently talking with ${label}. When you address or refer to them, use "${label}".`);
    }
    if (activeFeeling && activeFeeling.text) {
        lines.push(`The user is currently feeling ${activeFeeling.text.toLowerCase()}. Let this color the tone of the suggested responses, while keeping them authentic to the user.`);
    }
    return lines.join(' ');
}

// Situation STAMP for the conversation log (distinct from the generation block
// above): a compact snapshot of the active influencers at the moment of a turn,
// written onto every logged turn for Phase-3 review. `partner` keeps the stable
// personId (when the Partner is a known person) so the log can join back to the
// relationship graph, plus the display label; `feeling` keeps id + text. Each is
// null when its toggle is off.
function partnerStamp() {
    if (!activePartner) return null;
    return {
        id: activePartner.personId || null,
        label: (activePartner.nickname || activePartner.name || '').trim(),
    };
}
function feelingStamp() {
    if (!activeFeeling || !activeFeeling.text) return null;
    return { id: activeFeeling.id || null, text: activeFeeling.text };
}

// Partner toggle: one active at a time. Tapping the active one turns it off;
// tapping another switches. Re-renders the panel to reflect the selection. The
// effect is applied at conversation open (personalized openers) and each turn
// (situation block) — no immediate generation needed here.
function handleTogglePartner(item) {
    activePartner = (activePartner && activePartner.id === item.id) ? null : item;
    renderExpressPanel();
    ui.setStatus(activePartner ? `Talking with ${activePartner.nickname || activePartner.name}` : 'Partner cleared');
}

// Feeling toggle: one active at a time, same on/off/switch behavior.
function handleToggleFeeling(item) {
    activeFeeling = (activeFeeling && activeFeeling.id === item.id) ? null : item;
    renderExpressPanel();
    ui.setStatus(activeFeeling ? `Feeling ${activeFeeling.text.toLowerCase()}` : 'Feeling cleared');
}

// Body classes that place the dock area (Express Panel / keyboard) on the
// chosen edge with the keyboard's real-estate, and select the 2×2 (side) vs 1×4
// (bottom) response-card arrangement. Kept in sync with the keyboard dock choice.
function applyConversationDockClasses() {
    const dock = storage.loadKeyboardDock();
    const side = dock === 'side';
    const right = storage.loadSideDockPosition() === 'right';
    document.body.classList.toggle('conv-bottom', !side);
    document.body.classList.toggle('conv-side', side);
    document.body.classList.toggle('conv-side-right', side && right);
    document.body.classList.toggle('conv-side-left', side && !right);
}

// --- Conversation layout solver (Ken, June 30 2026) -------------------------
// Three unitless sliders drive the conversation layout: BUTTON SIZE (default
// middle — slide right to GROW buttons in their unconstrained direction, left
// to SHRINK them and fill with gap), GAP SIZE, and MINIMUM GAP (a hard floor on
// the gap; precedence over button size). The % budget (v0.5.46/0.5.48) is the
// slider's MIDDLE; growth/shrink perturb it. This is past CSS clamp(), so JS
// computes the region sizes + effective gap into CSS vars on init/resize/change.
// FIRST CUT scope (Ken): the SIDE dock (the bottom dock still uses the fixed %
// default; its solver is the next step). Under-specified bits (freed-space
// split, exact shrink curve, calibration of the slider's right end to the true
// max-growth point) are reasonable choices here, to react to.
const GAP_MAX_REM = 1.4, MINGAP_MAX_REM = 1.4;   // slider 0–100 → 0..max rem
const DOCKSEP_MAX_REM = 4.0;      // keyboard-separation slider 0–100 → 0..4rem
const MIN_BTN_REM = 2.0;          // smallest still-recognizable button (icon + border)
const MIN_TRANSCRIPT_REM = 3.0;   // transcript floor (~2 lines)
const SHRINK_GAP_REM = 1.4;       // how much gap a full left-shrink adds

const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
const lerp = (pos, lo, hi) => lo + (Math.max(0, Math.min(100, pos)) / 100) * (hi - lo);

// Count rows + widest total span of the active dock layout (kept for any
// consumers that still key off the grid shape).
function activeLayoutGrid() {
    const rows = expressLayoutRows();
    const r = rows.length || 1;
    let c = 1;
    for (const row of rows) {
        const span = row.reduce((sum, cell) => sum + (cell.span || 1), 0);
        if (span > c) c = span;
    }
    return { rows: r, cols: c };
}

// Compute the conversation layout from the three sliders and write CSS vars.
function applyButtonSizing() {
    const root = document.documentElement.style;
    const rem = remPx();
    const VW = window.innerWidth, VH = window.innerHeight;

    // Slider values → px. Effective gap = max(gap-size, min-gap) (min-gap is a
    // one-way floor; lowering it leaves gap-size put — Ken #3).
    const minGap = (lerp(storage.loadMinGapPos(), 0, MINGAP_MAX_REM)) * rem;
    const gapSize = (lerp(storage.loadButtonGapPos(), 0, GAP_MAX_REM)) * rem;
    let gap = Math.max(gapSize, minGap);

    // Button size: middle (50) = the % default; >50 grows, <50 shrinks.
    const growth = (storage.loadButtonSizePos() - 50) / 50;

    // Region defaults (the slider's middle): dock 30%, transcript 30%.
    let dockW = 0.30 * VW;
    let transcriptV = 0.30 * VH;

    const minTranscript = MIN_TRANSCRIPT_REM * rem;
    if (storage.loadKeyboardDock() === 'side') {
        const minBtn = MIN_BTN_REM * rem;
        // Main-area minimum width: the command bar's 8 buttons bind first.
        const minMainW = 8 * minBtn + 9 * gap;
        if (growth > 0) {
            // GROW: the dock widens (main shrinks W → command/response buttons
            // narrow) and the transcript shrinks V (command/response grow V).
            const maxDockW = Math.max(0.30 * VW, VW - minMainW);
            dockW = 0.30 * VW + growth * (maxDockW - 0.30 * VW);
            transcriptV = 0.30 * VH - growth * (0.30 * VH - minTranscript);
        } else if (growth < 0) {
            // SHRINK: regions stay default; buttons shrink, gap fills.
            gap = Math.max(gap, minGap) + (-growth) * SHRINK_GAP_REM * rem;
        }
        root.setProperty('--conv-dock-w', `${Math.round(dockW)}px`);
        root.setProperty('--conv-transcript-v', `${Math.round(transcriptV)}px`);
    } else {
        // BOTTOM dock: the dock's expandable axis is VERTICAL. GROW makes the
        // dock taller (its buttons taller); command (10vh) + response (30vh)
        // stay fixed, the transcript yields vertically to its floor.
        let dockH = 0.30 * VH;
        if (growth > 0) {
            const maxDockH = Math.max(0.30 * VH, 0.60 * VH - minTranscript); // transcript→floor
            dockH = 0.30 * VH + growth * (maxDockH - 0.30 * VH);
        } else if (growth < 0) {
            gap = Math.max(gap, minGap) + (-growth) * SHRINK_GAP_REM * rem;
        }
        root.setProperty('--conv-dock-h', `${Math.round(dockH)}px`);
    }

    root.setProperty('--grid-gap', `${gap.toFixed(2)}px`);
    root.setProperty('--gap-min', `${minGap.toFixed(2)}px`);
    // Keyboard separation: gap between the dock and the rest of the UI (does not
    // touch the dock footprint, so the keyguard holes don't move).
    const dockSep = lerp(storage.loadDockSepPos(), 0, DOCKSEP_MAX_REM) * rem;
    root.setProperty('--dock-sep', `${dockSep.toFixed(2)}px`);
    const { rows, cols } = activeLayoutGrid();
    root.setProperty('--kbd-rows', String(rows));
    root.setProperty('--kbd-cols', String(cols));
}

// Apply the user-set text-size scales (Transcript / Composer / Express Panel) as
// CSS multipliers on each surface's base font-size. 1 = the design default.
function applyFontScales() {
    const root = document.documentElement.style;
    root.setProperty('--transcript-font-scale', String(storage.loadTranscriptFontScale()));
    root.setProperty('--composer-font-scale', String(storage.loadComposerFontScale()));
    root.setProperty('--express-font-scale', String(storage.loadExpressFontScale()));
}

// The − / + buttons flanking each size slider nudge it by a small fixed step
// (Ken: the slider "grows uncontrollably quickly" when dragged right — the
// steppers give precise control). They dispatch the slider's own 'input' event so
// the existing persist/apply/clamp handlers run unchanged.
function initSliderSteppers() {
    const content = document.getElementById('settingsContent');
    if (!content) return;
    content.addEventListener('click', (e) => {
        const step = e.target.closest('.slider-step');
        if (!step) return;
        const slider = document.getElementById(step.dataset.target);
        if (!slider) return;
        const next = Math.max(0, Math.min(100, Number(slider.value) + Number(step.dataset.step)));
        slider.value = String(next);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

// An Express Panel phrase was activated (single tap, or confirmed double tap). It
// is the user speaking, so it behaves like a selected response: spoken AND
// committed to history (Ken — "anything spoken is part of the conversation").
// Routed through the shared speak-as-a-turn path.
async function handleSpeakExpressItem(phrase) {
    await speakAsUserTurn(phrase.text, phrase.speak || phrase.text);
}

// --- Settings dialog ---

function initSettingsTabs() {
    document.querySelectorAll('#settingsTabs .settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // "About Me" has no panel of its own — it launches the full-screen
            // questionnaire overlay directly (closing Settings first).
            if (tab.dataset.tab === 'aboutme') {
                keyboard.hideKeyboard();
                document.getElementById('settingsDialog').close();
                worldviewUI.open();
                return;
            }
            document.querySelectorAll('#settingsTabs .settings-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('#settingsContent .tab-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.querySelector(`.tab-panel[data-tab="${tab.dataset.tab}"]`).classList.add('active');
            handleSettingsTab(tab.dataset.tab);
        });
    });
}

// On the Speech & Input tab the user changes keyboard layout/position but there's
// no text field to type into, so show the keyboard as a live preview of the
// CHOSEN dock. Any other tab takes the preview down.
function handleSettingsTab(tabName) {
    if (tabName === 'express') { expressEditor.render(); keyboard.previewHide(); return; }
    if (tabName === 'controls') { controlEditor.render(); keyboard.previewHide(); return; }
    if (tabName === 'speech' && storage.loadKeyboardMode() === 'onscreen') {
        keyboard.previewShow(storage.loadKeyboardDock());
    } else {
        keyboard.previewHide();
    }
}

// Show only the controls relevant to the chosen dock: side → which-side + side
// layout; bottom → bottom layout. Keeps Settings from implying both docks exist
// at once now that it's a single choice.
function updateKeyboardPositionGroups() {
    const dock = storage.loadKeyboardDock();
    const side = dock === 'side';
    const set = (id, show) => {
        const el = document.getElementById(id);
        if (el) el.style.display = show ? '' : 'none';
    };
    set('sidePositionGroup', side);
    set('sideLayoutGroup', side);
    set('bottomLayoutGroup', !side);
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
        // Show only the human-readable name — the S1/B1 ids are internal and mean
        // nothing to the user; the id stays as the option's value.
        opt.textContent = name;
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
    const responsesPerCategoryInput = document.getElementById('responsesPerCategoryInput');

    apiKeyInput.value = storage.loadApiKey() || '';
    populateVoiceSelect();
    silenceThresholdInput.value = storage.loadSilenceThreshold();
    autoRelistenInput.checked = storage.loadAutoRelisten();
    responsesPerCategoryInput.value = storage.loadResponsesPerCategory();
    const keyboardMode = storage.loadKeyboardMode();
    const keyboardRadio = document.querySelector(`input[name="keyboardMode"][value="${keyboardMode}"]`);
    if (keyboardRadio) keyboardRadio.checked = true;
    const bottomLayoutSelect = document.getElementById('bottomLayoutSelect');
    const sideLayoutSelect = document.getElementById('sideLayoutSelect');
    const sideDockPositionToggle = document.getElementById('sideDockPositionToggle');
    fillLayoutSelect(bottomLayoutSelect, BOTTOM_LAYOUTS, storage.loadBottomLayout());
    fillLayoutSelect(sideLayoutSelect, SIDE_LAYOUTS, storage.loadSideLayout());
    sideDockPositionToggle.checked = storage.loadSideDockPosition() === 'right';
    // Keyboard dock (side/bottom) — one choice for every typing context.
    const dockRadio = document.querySelector(`input[name="keyboardDock"][value="${storage.loadKeyboardDock()}"]`);
    if (dockRadio) dockRadio.checked = true;
    updateKeyboardPositionGroups();
    updateUsageDisplay();
    const placeholderSettings = storage.loadPlaceholderSettings();
    initialDelayInput.value = placeholderSettings.initialDelay;
    subsequentDelayInput.value = placeholderSettings.subsequentDelay;
    maxPlaceholdersInput.value = placeholderSettings.maxPlaceholders;
    // Express Panel tap controls (no set selector — one list, always shown).
    const doubleTapMsSelect = document.getElementById('doubleTapMsSelect');
    const tapMode = storage.loadExpressTapMode();
    const tapRadio = document.querySelector(`input[name="expressTapMode"][value="${tapMode}"]`);
    if (tapRadio) tapRadio.checked = true;
    doubleTapMsSelect.value = storage.loadDoubleTapMs();
    // Button sizing sliders (unitless 0–100).
    const buttonSizeSlider = document.getElementById('buttonSizeSlider');
    const buttonGapSlider = document.getElementById('buttonGapSlider');
    const minGapSlider = document.getElementById('minGapSlider');
    const dockSepSlider = document.getElementById('dockSepSlider');
    buttonSizeSlider.value = storage.loadButtonSizePos();
    buttonGapSlider.value = storage.loadButtonGapPos();
    minGapSlider.value = storage.loadMinGapPos();
    dockSepSlider.value = storage.loadDockSepPos();
    // Text-size selects (string-valued multipliers).
    const transcriptFontSelect = document.getElementById('transcriptFontSelect');
    const composerFontSelect = document.getElementById('composerFontSelect');
    const expressFontSelect = document.getElementById('expressFontSelect');
    transcriptFontSelect.value = String(storage.loadTranscriptFontScale());
    composerFontSelect.value = String(storage.loadComposerFontScale());
    expressFontSelect.value = String(storage.loadExpressFontScale());
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
            // A folder just became available — reconcile the user-owned data:
            // adopt an existing on-disk copy, else promote the cache.
            try { await worldview.syncToFolder(); } catch { /* best-effort */ }
            try { await relationships.syncToFolder(); } catch { /* best-effort */ }
            try { await expressPanel.syncToFolder(); } catch { /* best-effort */ }
            renderExpressPanel();
            try { await controlPhrases.syncToFolder(); } catch { /* best-effort */ }
            applyControlPhrases();
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
    // Paste button beside the API-key field — replaces the keyboard's removed
    // clipboard toolbar as the way to paste a long `sk-ant-…` key.
    document.getElementById('pasteApiKeyBtn').onclick = async () => {
        try {
            const text = (await navigator.clipboard.readText())?.trim();
            if (text) {
                apiKeyInput.value = text;
                apiKeyInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } catch { /* clipboard read blocked/denied — user can type instead */ }
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
    responsesPerCategoryInput.onchange = () => {
        const n = Number(responsesPerCategoryInput.value);
        storage.saveResponsesPerCategory(n);
        ui.setRegenerateLabel((n === 2 ? 2 : 1) * 4); // "New 4" ↔ "New 8"
    };
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
        renderExpressPanel(); // the panel mirrors the layout
        keyboard.previewShow('bottom');
    };
    sideLayoutSelect.onpointerdown = sideLayoutSelect.onfocus = previewSide;
    sideLayoutSelect.onchange = () => {
        keyboard.setSideLayout(sideLayoutSelect.value);
        storage.saveSideLayout(sideLayoutSelect.value);
        renderExpressPanel();
        keyboard.previewShow('side');
    };
    sideDockPositionToggle.onpointerdown = sideDockPositionToggle.onfocus = previewSide;
    sideDockPositionToggle.onchange = () => {
        const pos = sideDockPositionToggle.checked ? 'right' : 'left';
        keyboard.setSideDockPosition(pos);
        storage.saveSideDockPosition(pos);
        applyConversationDockClasses();
        keyboard.previewShow('side');
    };
    // Keyboard dock (side/bottom): the single choice. Persist, apply, show/hide
    // the dock-specific groups, and preview the chosen dock.
    document.querySelectorAll('input[name="keyboardDock"]').forEach((radio) => {
        radio.onchange = () => {
            const dock = document.querySelector('input[name="keyboardDock"]:checked')?.value || 'bottom';
            storage.saveKeyboardDock(dock);
            keyboard.setKeyboardDock(dock);
            updateKeyboardPositionGroups();
            applyConversationDockClasses(); // move the dock area + re-pick 2×2/1×4
            renderExpressPanel();        // mirror the now-current dock's layout
            if (storage.loadKeyboardMode() === 'onscreen') keyboard.previewShow(dock);
        };
    });
    const persistPlaceholders = () => storage.savePlaceholderSettings(
        Number(initialDelayInput.value),
        Number(subsequentDelayInput.value),
        Number(maxPlaceholdersInput.value)
    );
    initialDelayInput.onchange = persistPlaceholders;
    subsequentDelayInput.onchange = persistPlaceholders;
    maxPlaceholdersInput.onchange = persistPlaceholders;

    // Express Panel: persist + live-re-render the panel on any change.
    document.querySelectorAll('input[name="expressTapMode"]').forEach((radio) => {
        radio.onchange = () => {
            const mode = document.querySelector('input[name="expressTapMode"]:checked')?.value || 'single';
            storage.saveExpressTapMode(mode);
            renderExpressPanel();
        };
    });
    doubleTapMsSelect.onchange = () => {
        storage.saveDoubleTapMs(Number(doubleTapMsSelect.value));
        renderExpressPanel();
    };

    // Button sizing — apply live as the slider drags (oninput) so the change is
    // visible immediately (incl. the keyboard preview on this tab), persisting as
    // it goes. applyButtonSizing() re-derives --btn-min-dim / --grid-gap and the
    // dock grows/shrinks accordingly.
    buttonSizeSlider.oninput = () => {
        storage.saveButtonSizePos(Number(buttonSizeSlider.value));
        applyButtonSizing();
    };
    buttonGapSlider.oninput = () => {
        // Gap can't go below the minimum gap (clamp the slider up to it).
        let v = Number(buttonGapSlider.value);
        const mg = Number(minGapSlider.value);
        if (v < mg) { v = mg; buttonGapSlider.value = String(mg); }
        storage.saveButtonGapPos(v);
        applyButtonSizing();
    };
    minGapSlider.oninput = () => {
        const mg = Number(minGapSlider.value);
        storage.saveMinGapPos(mg);
        // Raising min-gap above the current gap pushes the gap up to match
        // (one-way; lowering min-gap leaves the gap where it is — Ken #3).
        if (Number(buttonGapSlider.value) < mg) {
            buttonGapSlider.value = String(mg);
            storage.saveButtonGapPos(mg);
        }
        applyButtonSizing();
    };
    // Keyboard separation — independent of the inter-button gap; shifts the rest
    // of the UI away from the dock without resizing buttons or the dock footprint.
    dockSepSlider.oninput = () => {
        storage.saveDockSepPos(Number(dockSepSlider.value));
        applyButtonSizing();
    };

    // Reset button size / spacing / minimum gap to their defaults (Ken).
    document.getElementById('resetSizingBtn').onclick = () => {
        storage.resetButtonSizing();
        buttonSizeSlider.value = String(storage.loadButtonSizePos());
        buttonGapSlider.value = String(storage.loadButtonGapPos());
        minGapSlider.value = String(storage.loadMinGapPos());
        // dockSepSlider is intentionally left untouched — keyboard separation is
        // not part of the button/gap sizing the reset restores (Ken).
        applyButtonSizing();
    };

    // Text-size selects — persist + apply live.
    transcriptFontSelect.onchange = () => { storage.saveTranscriptFontScale(transcriptFontSelect.value); applyFontScales(); };
    composerFontSelect.onchange = () => { storage.saveComposerFontScale(composerFontSelect.value); applyFontScales(); };
    expressFontSelect.onchange = () => { storage.saveExpressFontScale(expressFontSelect.value); applyFontScales(); };

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
        dialog.close();
    };
}

initApp();
