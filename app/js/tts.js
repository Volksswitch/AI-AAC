const synth = window.speechSynthesis;

export function speak(text) {
    return new Promise((resolve) => {
        if (synth.speaking) synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
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
