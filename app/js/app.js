import * as stt from './stt.js';
import * as tts from './tts.js';
import * as llm from './llm.js';
import * as ui from './ui.js';
import * as storage from './storage.js';

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
    conversationHistory.push({ role: 'user', text });
    ui.setStatus('Speaking...');
    await tts.speak(text);
    ui.setStatus('Ready — tap Listen for the next exchange');
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
    const input = document.getElementById('apiKeyInput');
    input.value = storage.loadApiKey() || '';
    updateFolderDisplay();
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

    document.getElementById('saveSettingsBtn').onclick = () => {
        const key = input.value.trim();
        if (key) {
            llm.setApiKey(key);
            storage.saveApiKey(key);
            ui.setStatus('API key saved');
        }
        dialog.close();
    };

    document.getElementById('closeSettingsBtn').onclick = () => {
        dialog.close();
    };
}

initApp();
