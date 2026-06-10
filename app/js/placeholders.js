import * as tts from './tts.js';
import * as storage from './storage.js';

const FILLERS = [
    "Just a second...",
    "Let me think about that...",
    "Hmm, one moment...",
    "Give me a moment...",
    "Hold on...",
    "Let me consider that...",
    "One sec...",
];

let timer = null;
let fillerIndex = 0;
let active = false;

export function start() {
    stop();
    active = true;
    fillerIndex = 0;
    const { initialDelay } = storage.loadPlaceholderSettings();
    timer = setTimeout(speakAndScheduleNext, initialDelay * 1000);
}

export function stop() {
    active = false;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    tts.cancel();
}

async function speakAndScheduleNext() {
    if (!active) return;
    const filler = FILLERS[fillerIndex % FILLERS.length];
    fillerIndex++;
    await tts.speak(filler);

    if (!active) return;
    const { subsequentDelay } = storage.loadPlaceholderSettings();
    timer = setTimeout(speakAndScheduleNext, subsequentDelay * 1000);
}
