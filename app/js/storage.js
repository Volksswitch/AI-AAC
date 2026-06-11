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

export async function logPartnerSpeech({ rawTranscript, cleanedTranscript }) {
    if (!currentLogData) await startConversationLog();
    if (!currentLogData) return;

    currentLogData.exchanges.push({
        timestamp: new Date().toISOString(),
        role: 'partner',
        rawTranscript,
        cleanedTranscript
    });
    await flushLog();
}

export async function logUserResponse({ selectedText, selectedIndex, allOptions }) {
    if (!currentLogData) return;

    currentLogData.exchanges.push({
        timestamp: new Date().toISOString(),
        role: 'user',
        selectedText,
        selectedIndex,
        allOptions
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
        subsequentDelay: settings.subsequentDelay ?? 10
    };
}

export function savePlaceholderSettings(initialDelay, subsequentDelay) {
    const settings = loadSettings();
    settings.initialDelay = initialDelay;
    settings.subsequentDelay = subsequentDelay;
    saveSettings(settings);
}
