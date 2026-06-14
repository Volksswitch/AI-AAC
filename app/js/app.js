import * as stt from './stt.js';
import * as tts from './tts.js';
import * as llm from './llm.js';
import * as ui from './ui.js';
import * as storage from './storage.js';
import * as placeholders from './placeholders.js';
import * as worldview from './worldview.js';
import * as worldviewUI from './worldview-ui.js';
import * as keyboard from './keyboard.js';
import { SIDE_LAYOUTS, BOTTOM_LAYOUTS } from './keyboard-layouts.js';

// Point-release version shown in Settings → About. Bump alongside the
// sw.js CACHE_VERSION on every release so beta testers can report exactly
// which build they're on.
const APP_VERSION = '0.2.16';

const conversationHistory = [];
let isListening = false;
let lastResponseOptions = [];
// Raw, combined speech-to-text for the partner's current (uncommitted) turn.
// Grows across silence periods until the user picks a response.
let currentPartnerText = '';
// Increments on every silence period / reset so that a slower, earlier
// option-generation round-trip can't overwrite a newer one — latest wins.
let generationToken = 0;

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

    document.getElementById('startBtn').addEventListener('click', handleStart);
    ui.onListenClick(toggleListening);
    ui.onRepeatClick(handleRepeatRequest);
    ui.onSpeakClick(handleSpeakComposed);
    ui.onClearComposerClick(() => ui.clearComposer());
    ui.onSettingsClick(openSettings);
    ui.onAboutMeClick(worldviewUI.open);
    worldviewUI.init();
    keyboard.init();
    keyboard.setMode(storage.loadKeyboardMode());
    keyboard.setSideLayout(storage.loadSideLayout());
    keyboard.setBottomLayout(storage.loadBottomLayout());
    keyboard.setSideDockPosition(storage.loadSideDockPosition());
    initSettingsTabs();
    initSettingsDrag();
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
async function handleSilencePeriod(text) {
    currentPartnerText = text;
    ui.showTranscript(text, false);
    placeholders.start();
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
    document.getElementById('startOverlay').classList.add('hidden');
    document.querySelector('main').classList.remove('disabled');
}

function toggleListening() {
    if (isListening) {
        stt.stopListening();
    } else {
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

    try {
        const { options, missingFacts } = await llm.generateResponses(history);
        if (token !== generationToken) return; // a newer silence period superseded this
        lastResponseOptions = options;
        ui.showResponseOptions(options, handleResponseSelected);
        ui.setStatus('Select a response');
        // Record facts the model lacked — drives the questionnaire's "suggested
        // next." Open gaps only; recordGaps drops answered/declined keys.
        if (missingFacts && missingFacts.length) {
            worldview.recordGaps(missingFacts, partnerText).catch(() => { /* non-fatal */ });
        }
    } catch (err) {
        if (token !== generationToken) return;
        ui.setStatus(`Error: ${err.message}`);
    }
}

async function handleResponseSelected(text, index) {
    placeholders.stop();
    generationToken++; // invalidate any in-flight generation
    stt.stopListening();

    const raw = currentPartnerText;
    currentPartnerText = '';

    ui.setStatus('Speaking...');
    await tts.speak(text);

    // The exchange is settled — now clean the combined transcript once and
    // commit the partner turn (cleaned text feeds context for future turns),
    // followed by the user's response. Cleaning happens after speaking so it
    // never delays the user's selected words.
    if (raw) {
        let cleaned = raw;
        try {
            cleaned = await llm.cleanupTranscript(raw, conversationHistory);
        } catch { /* fall back to raw */ }
        conversationHistory.push({ role: 'partner', text: cleaned });
        ui.showTranscript(cleaned, true);
        storage.logPartnerSpeech({ rawTranscript: raw, cleanedTranscript: cleaned });
    }
    conversationHistory.push({ role: 'user', text });
    storage.logUserResponse({ selectedText: text, selectedIndex: index, allOptions: lastResponseOptions });

    if (storage.loadAutoRelisten()) {
        startFreshListening();
    } else {
        ui.setStatus('Ready — tap Listen for the next exchange');
    }
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

// Persistent "Please repeat what you said." control. Discards everything
// collected for the current exchange and keeps listening for the restatement —
// nothing is committed or stored.
async function handleRepeatRequest() {
    placeholders.stop();
    generationToken++; // invalidate any in-flight generation
    currentPartnerText = '';
    stt.resetTranscript();
    ui.showTranscript('', false);
    ui.clearResponseOptions();
    ui.setStatus('Speaking...');
    await tts.speak('Please repeat what you said.');
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
        });
    });
}

// Drag-to-move for the Settings dialog (pattern borrowed from the Keyguard
// Designer app). The panel stays modal — the backdrop still blocks the app
// behind it — but can be dragged aside by its title bar so live UI changes are
// visible behind it. A native <dialog> is centered by the UA with auto margins;
// on the first drag we convert that to pixel left/top with margin:0, then track
// the pointer, clamping to the viewport. Position persists for the session.
function initSettingsDrag() {
    const dialog = document.getElementById('settingsDialog');
    const handle = document.getElementById('settingsHeader');
    if (!dialog || !handle) return;
    let dragging = false, offsetX = 0, offsetY = 0, positioned = false;

    handle.addEventListener('pointerdown', (e) => {
        // On the first drag, pin the dialog to its current rect so left/top win
        // over the UA's centering margins.
        const r = dialog.getBoundingClientRect();
        if (!positioned) {
            dialog.style.margin = '0';
            dialog.style.left = `${r.left}px`;
            dialog.style.top = `${r.top}px`;
            positioned = true;
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

// Nudge the (centred) Settings panel clear of the side-docked app keyboard:
// keyboard on the right → push the panel left, and vice-versa. Only relevant in
// on-screen keyboard mode (otherwise no app keyboard appears). Reads the live
// control states so flipping the mode/position updates it immediately. A
// dragged panel keeps its own position (inline left wins over the CSS inset).
function updateSettingsNudge() {
    const dialog = document.getElementById('settingsDialog');
    dialog.classList.remove('nudge-left', 'nudge-right');
    const mode = document.querySelector('input[name="keyboardMode"]:checked')?.value || storage.loadKeyboardMode();
    if (mode !== 'onscreen') return;
    const keyboardOnRight = document.getElementById('sideDockPositionToggle')?.checked;
    dialog.classList.add(keyboardOnRight ? 'nudge-left' : 'nudge-right');
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
    updateFolderDisplay();

    // Reset to General tab
    document.querySelectorAll('#settingsTabs .settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#settingsContent .tab-panel').forEach(p => p.classList.remove('active'));
    document.querySelector('.settings-tab[data-tab="general"]').classList.add('active');
    document.querySelector('.tab-panel[data-tab="general"]').classList.add('active');

    dialog.showModal();
    updateSettingsNudge();

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
            updateSettingsNudge();
        };
    });
    bottomLayoutSelect.onchange = () => {
        keyboard.setBottomLayout(bottomLayoutSelect.value);
        storage.saveBottomLayout(bottomLayoutSelect.value);
    };
    sideLayoutSelect.onchange = () => {
        keyboard.setSideLayout(sideLayoutSelect.value);
        storage.saveSideLayout(sideLayoutSelect.value);
    };
    sideDockPositionToggle.onchange = () => {
        const pos = sideDockPositionToggle.checked ? 'right' : 'left';
        keyboard.setSideDockPosition(pos);
        storage.saveSideDockPosition(pos);
        updateSettingsNudge();
    };
    const persistPlaceholders = () => storage.savePlaceholderSettings(
        Number(initialDelayInput.value),
        Number(subsequentDelayInput.value)
    );
    initialDelayInput.onchange = persistPlaceholders;
    subsequentDelayInput.onchange = persistPlaceholders;

    document.getElementById('closeSettingsBtn').onclick = () => {
        dialog.classList.remove('nudge-left', 'nudge-right');
        dialog.close();
    };
}

initApp();
