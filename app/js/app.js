import * as stt from './stt.js';
import * as tts from './tts.js';
import * as llm from './llm.js';
import * as ui from './ui.js';
import * as storage from './storage.js';

const conversationHistory = [];
let isListening = false;

async function initApp() {
    if (!stt.isSupported()) {
        ui.setStatus('Speech recognition not supported in this browser. Use Chrome or Edge.');
        return;
    }

    stt.init({
        onResult: handleSpeechResult,
        onStatus: handleSttStatus
    });

    ui.onListenClick(toggleListening);
    ui.onSettingsClick(openSettings);

    const savedKey = await tryLoadApiKey();
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

async function tryLoadApiKey() {
    try {
        return await storage.loadApiKey();
    } catch {
        return null;
    }
}

function openSettings() {
    const dialog = document.getElementById('settingsDialog');
    const input = document.getElementById('apiKeyInput');
    dialog.showModal();

    document.getElementById('saveSettingsBtn').onclick = async () => {
        const key = input.value.trim();
        if (key) {
            llm.setApiKey(key);
            try {
                await storage.saveApiKey(key);
                ui.setStatus('API key saved');
            } catch {
                ui.setStatus('API key set for this session (storage not available)');
            }
        }
        dialog.close();
    };

    document.getElementById('closeSettingsBtn').onclick = () => {
        dialog.close();
    };
}

initApp();
