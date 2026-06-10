const transcriptText = document.getElementById('transcriptText');
const responseOptions = document.getElementById('responseOptions');
const statusBar = document.getElementById('statusBar');
const listenBtn = document.getElementById('listenBtn');

export function showTranscript(text, isFinal) {
    transcriptText.textContent = text || 'Waiting for partner to speak...';
    transcriptText.classList.toggle('placeholder', !text);
    if (!isFinal) {
        transcriptText.style.opacity = '0.6';
    } else {
        transcriptText.style.opacity = '1';
    }
}

export function showResponseOptions(options, onSelect) {
    responseOptions.innerHTML = '';
    options.forEach((text, index) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = text;
        btn.setAttribute('aria-label', `Response option ${index + 1}: ${text}`);
        btn.addEventListener('click', () => onSelect(text, index));
        responseOptions.appendChild(btn);
    });
}

export function clearResponseOptions() {
    responseOptions.innerHTML = '<p class="placeholder">Response options will appear here</p>';
}

export function setStatus(message) {
    statusBar.textContent = message;
}

export function setListenButtonState(listening) {
    listenBtn.textContent = listening ? 'Stop Listening' : 'Start Listening';
    listenBtn.classList.toggle('listening', listening);
}

export function onListenClick(handler) {
    listenBtn.addEventListener('click', handler);
}

export function onSettingsClick(handler) {
    document.getElementById('settingsBtn').addEventListener('click', handler);
}
