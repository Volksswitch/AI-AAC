const STORAGE_KEY = 'aac_settings';
const IDB_NAME = 'aac-db';
const IDB_STORE = 'handles';
const DIR_HANDLE_KEY = 'dataFolder';

let dirHandle = null;

// --- IndexedDB helpers for persisting the directory handle ---

function idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbGet(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(key, value) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function idbDelete(key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- Directory handle persistence ---

export async function restoreDataFolder() {
    const stored = await idbGet(DIR_HANDLE_KEY);
    if (!stored) return false;

    try {
        let perm = await stored.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
            perm = await stored.requestPermission({ mode: 'readwrite' });
        }
        if (perm === 'granted') {
            dirHandle = stored;
            return true;
        }
    } catch {
        await idbDelete(DIR_HANDLE_KEY);
    }
    return false;
}

export async function pickDataFolder() {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbPut(DIR_HANDLE_KEY, dirHandle);
    return dirHandle;
}

export async function clearDataFolder() {
    dirHandle = null;
    await idbDelete(DIR_HANDLE_KEY);
}

export function hasDataFolder() {
    return dirHandle !== null;
}

export function getDataFolderName() {
    return dirHandle ? dirHandle.name : null;
}

// --- File read/write via the data folder ---

export async function readFile(filename) {
    if (!dirHandle) return null;
    try {
        const fileHandle = await dirHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        return await file.text();
    } catch {
        return null;
    }
}

export async function writeFile(filename, content) {
    if (!dirHandle) return;
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

// --- API key (localStorage — per-machine, instant access) ---

function loadSettings() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
        return {};
    }
}

function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function loadApiKey() {
    return loadSettings().apiKey || null;
}

export function saveApiKey(apiKey) {
    const settings = loadSettings();
    settings.apiKey = apiKey;
    saveSettings(settings);
}

export function loadVoiceURI() {
    return loadSettings().voiceURI || null;
}

export function saveVoiceURI(voiceURI) {
    const settings = loadSettings();
    settings.voiceURI = voiceURI;
    saveSettings(settings);
}

export function loadSilenceThreshold() {
    return loadSettings().silenceThreshold ?? 2;
}

export function saveSilenceThreshold(seconds) {
    const settings = loadSettings();
    settings.silenceThreshold = seconds;
    saveSettings(settings);
}

export function loadAutoRelisten() {
    return loadSettings().autoRelisten ?? false;
}

export function saveAutoRelisten(enabled) {
    const settings = loadSettings();
    settings.autoRelisten = enabled;
    saveSettings(settings);
}

// 'physical' (use the attached keyboard) | 'onscreen' (the app's own keyboard).
// Default 'physical' — the primary Surface setup is the type cover in laptop
// position, where Windows shows no keyboard and the physical one is in use.
export function loadKeyboardMode() {
    return loadSettings().keyboardMode === 'onscreen' ? 'onscreen' : 'physical';
}

export function saveKeyboardMode(mode) {
    const settings = loadSettings();
    settings.keyboardMode = mode === 'onscreen' ? 'onscreen' : 'physical';
    saveSettings(settings);
}

// Which on-screen keyboard layout to use in each dock (ids from
// keyboard-layouts.js — side: S1..S10, bottom: B1..B10) and which side the
// side dock sits on ('left' | 'right'). Defaults: S1 / B1 / right.
export function loadSideLayout() {
    return loadSettings().sideLayout || 'S1';
}

export function saveSideLayout(id) {
    const settings = loadSettings();
    settings.sideLayout = id;
    saveSettings(settings);
}

export function loadBottomLayout() {
    return loadSettings().bottomLayout || 'B1';
}

export function saveBottomLayout(id) {
    const settings = loadSettings();
    settings.bottomLayout = id;
    saveSettings(settings);
}

// Where the single on-screen keyboard docks, for EVERY typing context (Ken,
// June 21 2026 — replaces the old context-based side/bottom rule). 'side' pairs
// with sideDockPosition (left/right); 'bottom' is the full-width strip.
export function loadKeyboardDock() {
    return loadSettings().keyboardDock === 'side' ? 'side' : 'bottom';
}

export function saveKeyboardDock(dock) {
    const settings = loadSettings();
    settings.keyboardDock = dock === 'side' ? 'side' : 'bottom';
    saveSettings(settings);
}

export function loadSideDockPosition() {
    return loadSettings().sideDockPosition === 'left' ? 'left' : 'right';
}

export function saveSideDockPosition(pos) {
    const settings = loadSettings();
    settings.sideDockPosition = pos === 'left' ? 'left' : 'right';
    saveSettings(settings);
}

// How many response options to generate/show per category cell: 1 or 2 (max 2
// for now). 2 → each of the four slots offers two stacked alternatives.
export function loadResponsesPerCategory() {
    return Number(loadSettings().responsesPerCategory) === 2 ? 2 : 1;
}

export function saveResponsesPerCategory(n) {
    const settings = loadSettings();
    settings.responsesPerCategory = Number(n) === 2 ? 2 : 1;
    saveSettings(settings);
}

// --- Express Panel tap behavior ---
// (The item list itself lives in the express-panel.js model — data folder +
// cache — not here.)

// Tap mode for speaking an Express Panel phrase: 'single' (speak on one tap) or
// 'double' (require a confirming second tap to guard against false hits — Rule 10).
export function loadExpressTapMode() {
    return loadSettings().expressTapMode === 'double' ? 'double' : 'single';
}

export function saveExpressTapMode(mode) {
    const settings = loadSettings();
    settings.expressTapMode = mode === 'double' ? 'double' : 'single';
    saveSettings(settings);
}

// The double-tap interval (ms) — how long the first tap stays "armed" waiting
// for the confirming second tap. Tunable to the user's motor control.
export function loadDoubleTapMs() {
    const v = Number(loadSettings().doubleTapMs);
    return Number.isFinite(v) && v > 0 ? v : 400;
}

export function saveDoubleTapMs(ms) {
    const settings = loadSettings();
    settings.doubleTapMs = Number(ms) || 400;
    saveSettings(settings);
}

// Minimum button size + button spacing — unitless slider positions (0–100). The
// app maps each to a CSS dimension (see app.js applyButtonSizing); the user picks
// by visual "feel". Both feed the keyguard (target size + bar width), so they're
// Setup-tier, supporter-assisted. Defaults reproduce the historical look.
const DEFAULT_BTN_SIZE_POS = 50;   // MIDDLE = the % default layout (Ken June 30 2026); R grows, L shrinks
const DEFAULT_BTN_GAP_POS = 0;     // → gap 0 (flush by default)
const DEFAULT_MIN_GAP_POS = 0;     // → min-gap 0 by default

function clampPos(v, dflt) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : dflt;
}

export function loadButtonSizePos() {
    const s = loadSettings();
    return s.buttonSizePos == null ? DEFAULT_BTN_SIZE_POS : clampPos(s.buttonSizePos, DEFAULT_BTN_SIZE_POS);
}
export function saveButtonSizePos(pos) {
    const settings = loadSettings();
    settings.buttonSizePos = clampPos(pos, DEFAULT_BTN_SIZE_POS);
    saveSettings(settings);
}
export function loadButtonGapPos() {
    const s = loadSettings();
    return s.buttonGapPos == null ? DEFAULT_BTN_GAP_POS : clampPos(s.buttonGapPos, DEFAULT_BTN_GAP_POS);
}
export function saveButtonGapPos(pos) {
    const settings = loadSettings();
    settings.buttonGapPos = clampPos(pos, DEFAULT_BTN_GAP_POS);
    saveSettings(settings);
}
export function loadMinGapPos() {
    const s = loadSettings();
    return s.minGapPos == null ? DEFAULT_MIN_GAP_POS : clampPos(s.minGapPos, DEFAULT_MIN_GAP_POS);
}
export function saveMinGapPos(pos) {
    const settings = loadSettings();
    settings.minGapPos = clampPos(pos, DEFAULT_MIN_GAP_POS);
    saveSettings(settings);
}

// --- Conversation logging ---

let conversationDirHandle = null;
let currentLogHandle = null;
let currentLogName = null;
let currentLogData = null;

async function getConversationsDir() {
    if (!dirHandle) return null;
    if (!conversationDirHandle) {
        conversationDirHandle = await dirHandle.getDirectoryHandle('conversations', { create: true });
    }
    return conversationDirHandle;
}

export async function startConversationLog() {
    const dir = await getConversationsDir();
    if (!dir) return null;

    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    currentLogName = `${stamp}.json`;
    currentLogData = {
        started: now.toISOString(),
        exchanges: []
    };

    currentLogHandle = await dir.getFileHandle(currentLogName, { create: true });
    await flushLog();
    return currentLogName;
}

// `partner`/`feeling` are the situation stamp — the active Partner / Feeling
// toggles at the moment of the turn (Ken, June 2026). Each is null when no toggle
// is active. `partner` = { id: personId|null, label }; `feeling` = { id, text }.
// Stamped on every turn so a Phase-3 review can see who the user was talking to
// and how they felt for each exchange, even as those change mid-conversation.
export async function logPartnerSpeech({ rawTranscript, cleanedTranscript, partner = null }) {
    if (!currentLogData) await startConversationLog();
    if (!currentLogData) return;

    currentLogData.exchanges.push({
        timestamp: new Date().toISOString(),
        role: 'partner',
        rawTranscript,
        cleanedTranscript,
        partner            // who spoke (the active Partner), or null
    });
    await flushLog();
}

export async function logUserResponse({ selectedText, selectedIndex, allOptions, partner = null, feeling = null }) {
    if (!currentLogData) return;

    currentLogData.exchanges.push({
        timestamp: new Date().toISOString(),
        role: 'user',
        selectedText,
        selectedIndex,
        allOptions,
        partner,           // who the user was talking with, or null
        feeling            // how the user felt at this turn, or null
    });
    await flushLog();
}

async function flushLog() {
    if (!currentLogHandle || !currentLogData) return;
    try {
        const writable = await currentLogHandle.createWritable();
        await writable.write(JSON.stringify(currentLogData, null, 2));
        await writable.close();
    } catch { /* silent — don't interrupt conversation flow */ }
}

// --- Usage tracking ---

export function loadUsage() {
    const settings = loadSettings();
    return {
        inputTokens: settings.usageInputTokens ?? 0,
        outputTokens: settings.usageOutputTokens ?? 0,
        since: settings.usageSince ?? new Date().toISOString()
    };
}

export function addUsageTokens(inputTokens, outputTokens) {
    const settings = loadSettings();
    if (!settings.usageSince) settings.usageSince = new Date().toISOString();
    settings.usageInputTokens = (settings.usageInputTokens ?? 0) + inputTokens;
    settings.usageOutputTokens = (settings.usageOutputTokens ?? 0) + outputTokens;
    saveSettings(settings);
}

export function resetUsage() {
    const settings = loadSettings();
    settings.usageInputTokens = 0;
    settings.usageOutputTokens = 0;
    settings.usageSince = new Date().toISOString();
    saveSettings(settings);
}

export function loadPlaceholderSettings() {
    const settings = loadSettings();
    return {
        initialDelay: settings.initialDelay ?? 4,
        subsequentDelay: settings.subsequentDelay ?? 10,
        // Cap on placeholders spoken per choosing window. Default 2 so the user
        // hears at most one "I heard you" filler plus one "still thinking" filler
        // — two different roles, never two same-category fillers back to back.
        // 0 = none (the user finds fillers artificial/robotic); -1 = no limit.
        maxPlaceholders: settings.maxPlaceholders ?? 2
    };
}

export function savePlaceholderSettings(initialDelay, subsequentDelay, maxPlaceholders) {
    const settings = loadSettings();
    settings.initialDelay = initialDelay;
    settings.subsequentDelay = subsequentDelay;
    if (maxPlaceholders !== undefined) settings.maxPlaceholders = maxPlaceholders;
    saveSettings(settings);
}
