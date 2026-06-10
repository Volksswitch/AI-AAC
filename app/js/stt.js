let recognition = null;
let onTranscript = null;
let onStatusChange = null;

export function isSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function init({ onResult, onStatus }) {
    onTranscript = onResult;
    onStatusChange = onStatus;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                final += transcript;
            } else {
                interim += transcript;
            }
        }
        if (onTranscript) {
            onTranscript({ final, interim });
        }
    };

    recognition.onend = () => {
        if (onStatusChange) onStatusChange('stopped');
    };

    recognition.onerror = (event) => {
        if (onStatusChange) onStatusChange('error', event.error);
    };
}

export function startListening() {
    if (!recognition) return;
    recognition.start();
    if (onStatusChange) onStatusChange('listening');
}

export function stopListening() {
    if (!recognition) return;
    recognition.stop();
}
