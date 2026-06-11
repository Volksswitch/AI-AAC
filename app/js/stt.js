let recognition = null;
let onTranscript = null;
let onStatusChange = null;
let accumulatedText = '';
let currentInterim = '';
let silenceTimer = null;
let silenceThreshold = 2000;
let stoppedByTimer = false;

export function isSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function setSilenceThreshold(seconds) {
    silenceThreshold = seconds * 1000;
}

export function init({ onResult, onStatus }) {
    onTranscript = onResult;
    onStatusChange = onStatus;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let latestInterim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                accumulatedText += transcript;
                latestInterim = '';
            } else {
                latestInterim = transcript;
            }
        }
        currentInterim = latestInterim;
        resetSilenceTimer();

        if (onTranscript) {
            onTranscript({
                final: null,
                interim: (accumulatedText + currentInterim).trim(),
                display: true
            });
        }
    };

    recognition.onend = () => {
        clearSilenceTimer();
        const fullText = (accumulatedText + currentInterim).trim();
        if (fullText && onTranscript) {
            onTranscript({ final: fullText, interim: '', display: false });
        }
        if (onStatusChange) onStatusChange('stopped');
    };

    recognition.onerror = (event) => {
        clearSilenceTimer();
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (onStatusChange) onStatusChange('error', event.error);
    };
}

function resetSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
        stoppedByTimer = true;
        if (recognition) recognition.stop();
    }, silenceThreshold);
}

function clearSilenceTimer() {
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
}

export function startListening() {
    if (!recognition) return;
    accumulatedText = '';
    currentInterim = '';
    stoppedByTimer = false;
    recognition.start();
    if (onStatusChange) onStatusChange('listening');
}

export function stopListening() {
    if (!recognition) return;
    clearSilenceTimer();
    recognition.stop();
}
