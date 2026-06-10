const synth = window.speechSynthesis;
let selectedVoiceURI = null;

export function setVoice(voiceURI) {
    selectedVoiceURI = voiceURI;
}

export function getSelectedVoiceURI() {
    return selectedVoiceURI;
}

function findVoice() {
    if (!selectedVoiceURI) return null;
    return synth.getVoices().find(v => v.voiceURI === selectedVoiceURI) || null;
}

export function speak(text) {
    return new Promise((resolve) => {
        if (synth.speaking) synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = findVoice();
        if (voice) utterance.voice = voice;
        utterance.onend = resolve;
        utterance.onerror = resolve;
        synth.speak(utterance);
    });
}

export function cancel() {
    synth.cancel();
}

export function getVoices() {
    return synth.getVoices();
}

export function onVoicesReady(callback) {
    const voices = synth.getVoices();
    if (voices.length > 0) {
        callback(voices);
    }
    synth.onvoiceschanged = () => callback(synth.getVoices());
}
