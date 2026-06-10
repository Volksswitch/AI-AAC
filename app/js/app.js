import * as stt from './stt.js';
import * as tts from './tts.js';
import * as llm from './llm.js';
import * as ui from './ui.js';
import * as storage from './storage.js';
import * as placeholders from './placeholders.js';

const conversationHistory = [];
let isListening = false;

function initApp() {
    if (!stt.isSupported()) {
        ui.setStatus('Speech recognition not supported in this browser. Use Chrome or Edge.');
        return;
    }

    stt.init({
        onResult: handleSpeechResult,
        onStatus: handleSttStatus
    });

    document.getElementById('startBtn').addEventListener('click', handleStart);
    ui.onListenClick(toggleListening);
    ui.onSettingsClick(openSettings);
    initSettingsTabs();

    tts.onVoicesReady(() => {
        const savedURI = storage.loadVoiceURI();
        if (savedURI) tts.setVoice(savedURI);
    });

    const savedKey = storage.loadApiKey();
    if (savedKey) {
        llm.setApiKey(savedKey);
        ui.setStatus('Ready — API key loaded');
    } else {
        ui.setStatus('No API key set — open Settings to add your Claude API key');
    }
}

function handleSpeechResult({ final, interim }) {
    const display = final || interim;
    ui.showTranscript(display, !!final);

    if (final) {
        conversationHistory.push({ role: 'partner', text: final });
        placeholders.start();
        generateOptions();
    }
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
    try { await storage.restoreDataFolder(); } catch { /* no stored handle yet */ }
    document.getElementById('startOverlay').classList.add('hidden');
    document.querySelector('main').classList.remove('disabled');
}

function toggleListening() {
    if (isListening) {
        stt.stopListening();
    } else {
        stt.startListening();
    }
}

async function generateOptions() {
    ui.setStatus('Generating response options...');
    ui.clearResponseOptions();

    try {
        const options = await llm.generateResponses(conversationHistory);
        ui.showResponseOptions(options, handleResponseSelected);
        ui.setStatus('Select a response');
    } catch (err) {
        ui.setStatus(`Error: ${err.message}`);
    }
}

async function handleResponseSelected(text, index) {
    placeholders.stop();
    conversationHistory.push({ role: 'user', text });
    ui.setStatus('Speaking...');
    await tts.speak(text);
    ui.setStatus('Ready — tap Listen for the next exchange');
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

function openSettings() {
    const dialog = document.getElementById('settingsDialog');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const voiceSelect = document.getElementById('voiceSelect');
    const initialDelayInput = document.getElementById('initialDelayInput');
    const subsequentDelayInput = document.getElementById('subsequentDelayInput');

    apiKeyInput.value = storage.loadApiKey() || '';
    populateVoiceSelect();
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

    document.getElementById('pickFolderBtn').onclick = async () => {
        try {
            await storage.pickDataFolder();
            updateFolderDisplay();
        } catch (err) {
            if (err.name !== 'AbortError') {
                ui.setStatus(`Folder error: ${err.message}`);
            }
        }
    };

    document.getElementById('testVoiceBtn').onclick = () => {
        tts.setVoice(voiceSelect.value || null);
        tts.speak('This is how I will sound during our conversation.');
    };

    document.getElementById('saveSettingsBtn').onclick = () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            llm.setApiKey(key);
            storage.saveApiKey(key);
        }
        const voiceURI = voiceSelect.value || null;
        tts.setVoice(voiceURI);
        storage.saveVoiceURI(voiceURI);
        storage.savePlaceholderSettings(
            Number(initialDelayInput.value),
            Number(subsequentDelayInput.value)
        );
        ui.setStatus('Settings saved');
        dialog.close();
    };

    document.getElementById('closeSettingsBtn').onclick = () => {
        dialog.close();
    };
}

initApp();
