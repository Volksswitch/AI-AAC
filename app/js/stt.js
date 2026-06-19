let recognition = null;
let onTranscript = null;
let onSilencePeriod = null;
let onStatusChange = null;
let accumulatedText = '';
let currentInterim = '';
let silenceTimer = null;
let silenceThreshold = 2000;
let listeningIntent = false;
// Echo filtering. While the app speaks (filler ladder, prompts), the mic would
// otherwise capture our own TTS, treat it as partner speech, append it to
// accumulatedText and renew the silence timer — restarting the filler ladder
// and abandoning the in-flight response generation. We do NOT mute the mic
// (that would also drop a partner who talks over us). Instead we keep a list of
// phrases the app is currently speaking and discard any captured segment that
// matches one — only genuinely new partner content renews the turn. Each phrase
// stays active for a tail window past the end of speech to cover recognition
// lag and the trailing audio.
const activePhrases = [];      // [{ text: <normalized>, expires: <ms epoch|Infinity> }]
const ECHO_TAIL_MS = 1500;     // how long a phrase stays matchable after speech ends

// Trigger-level guard against the TTS feedback loop (Ken, June 18 2026). The
// content filter (isEcho) drops captured segments that MATCH what we're saying,
// but the recognizer often mis-hears our own playback (drops/adds a word) so the
// echo slips past, renews the silence timer and re-fires generation — the
// runaway loop (stack grows, options flicker). Content matching can't be made
// robust against mis-transcription, so we also gate at the trigger: while the
// app itself is speaking (and for the echo tail after), captured audio does NOT
// reset the silence timer and the checkpoint does NOT fire. The mic stays on and
// non-echo content still accumulates into the transcript; it just can't drive a
// generation checkpoint while WE are the ones making noise. A genuine partner
// turn fires normally once the app falls quiet.
let appSpeaking = false;       // true between noteSpokenStart and noteSpokenEnd
let speechSettleUntil = 0;     // ms epoch the tail window after speech ends

function speechActive() {
    return appSpeaking || Date.now() < speechSettleUntil;
}

export function isSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function setSilenceThreshold(seconds) {
    silenceThreshold = seconds * 1000;
}

// Normalize for echo comparison: lowercase, strip punctuation, collapse runs of
// whitespace. So "Give me a second." and a recognizer's "give me a second"
// match.
function normalizeForEcho(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Wired to tts speaking-state in app.js. noteSpokenStart(text) registers a
// phrase the app is now speaking; noteSpokenEnd() lets the active phrases
// expire after a tail window (they stay matchable until then).
export function noteSpokenStart(text) {
    appSpeaking = true;
    const norm = normalizeForEcho(text || '');
    if (!norm) return;
    // While speaking, the phrase never expires; noteSpokenEnd sets the deadline.
    activePhrases.push({ text: norm, expires: Infinity });
}

export function noteSpokenEnd() {
    appSpeaking = false;
    speechSettleUntil = Date.now() + ECHO_TAIL_MS;
    const deadline = speechSettleUntil;
    for (const p of activePhrases) {
        if (p.expires === Infinity) p.expires = deadline;
    }
}

// A captured segment is echo if, after normalizing, it matches an active spoken
// phrase. Empty-after-normalize segments (pure punctuation/noise) are treated
// as echo too. Expired phrases are pruned here.
//
// Matching, in increasing risk:
//   - exact:  the segment IS the phrase.
//   - prefix: the segment is a leading slice of the phrase — the recognizer's
//             interim results build up as a growing prefix ("give", "give me",
//             "give me a", …) of what we're saying.
//   - embed:  the phrase appears inside the segment — covers the recognizer
//             padding/merging our filler with noise. Restricted to MULTI-WORD
//             phrases so a short, common acknowledgment token ("Okay.", "Right.")
//             can't swallow real partner speech that merely contains that word
//             (e.g. "okay so what do you think").
function isEcho(transcript) {
    const now = Date.now();
    for (let i = activePhrases.length - 1; i >= 0; i--) {
        if (activePhrases[i].expires < now) activePhrases.splice(i, 1);
    }
    if (activePhrases.length === 0) return false;
    const t = normalizeForEcho(transcript);
    if (!t) return true;
    return activePhrases.some(({ text: p }) => {
        if (p === t) return true;
        if (p.startsWith(t)) return true;
        if (p.includes(' ') && t.includes(p)) return true;
        return false;
    });
}

export function init({ onResult, onSilence, onStatus }) {
    onTranscript = onResult;
    onSilencePeriod = onSilence;
    onStatusChange = onStatus;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let latestInterim = '';
        let heardPartner = false;   // any non-echo content this event?
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            // Drop our own TTS echo (a placeholder/response/prompt) — it must
            // not accumulate or renew the partner's turn. Only unique partner
            // content gets through.
            if (isEcho(transcript)) continue;
            if (event.results[i].isFinal) {
                accumulatedText += transcript;
                latestInterim = '';
                heardPartner = true;
            } else {
                latestInterim = transcript;
                heardPartner = true;
            }
        }
        currentInterim = latestInterim;
        // Only renew the partner's turn (reset the silence checkpoint) when
        // genuine partner content was heard AND the app isn't currently speaking.
        // Pure echo leaves the checkpoint alone (content filter), and any audio
        // captured while we speak — including mis-transcribed echo the filter
        // missed — must not renew the turn either (trigger-level loop guard).
        if (heardPartner && !speechActive()) resetSilenceTimer();

        if (onTranscript) onTranscript((accumulatedText + currentInterim).trim());
    };

    recognition.onend = () => {
        // A silence period no longer ends recording. While the user still
        // intends to listen, the browser may stop continuous recognition on
        // its own (e.g. after a pause) — restart it so the partner's floor
        // stays open across silences. accumulatedText persists across restarts.
        if (listeningIntent) {
            currentInterim = '';
            try { recognition.start(); } catch { /* already starting */ }
            return;
        }
        clearSilenceTimer();
        if (onStatusChange) onStatusChange('stopped');
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        if (onStatusChange) onStatusChange('error', event.error);
    };
}

function resetSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(fireSilenceCheckpoint, silenceThreshold);
}

function fireSilenceCheckpoint() {
    // The partner has gone quiet for the silence period. Hand the speech
    // collected so far to the app for response generation, but keep recording —
    // if the partner resumes, the next silence period will fire again with the
    // combined speech. Never fire while the app is speaking (or within the echo
    // tail): our own playback could otherwise drive a checkpoint. Re-check soon.
    if (speechActive()) {
        silenceTimer = setTimeout(fireSilenceCheckpoint, 200);
        return;
    }
    const text = (accumulatedText + currentInterim).trim();
    if (text && onSilencePeriod) onSilencePeriod(text);
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
    listeningIntent = true;
    try { recognition.start(); } catch { /* already started */ }
    if (onStatusChange) onStatusChange('listening');
}

export function stopListening() {
    if (!recognition) return;
    listeningIntent = false;
    clearSilenceTimer();
    recognition.stop();
}

// Discard the speech collected so far without stopping recording. Used when the
// user asks the partner to repeat — the current exchange's text is thrown away
// and the system keeps listening for the partner's restated utterance.
export function resetTranscript() {
    accumulatedText = '';
    currentInterim = '';
    clearSilenceTimer();
}
