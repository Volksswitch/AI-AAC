/* AAC Conversation Assistant — app virtual keyboard (June 2026)
 *
 * The on-screen keyboard the user types with when they choose
 * Settings → "Keyboard for typing" → "On-screen keyboard (app's own)".
 *
 * Why this exists (CLAUDE.md "In My Own Words" / keyboard-selection spec):
 * on a Surface, Windows shows no keyboard with the type cover in laptop
 * position but auto-pops its own when the cover is folded back/detached.
 * The browser exposes no reliable signal for that posture, so a user-set
 * Settings parameter decides. When the mode is 'onscreen' we (a) set
 * inputmode="none" on the in-scope fields so the Windows keyboard never
 * pops, and (b) show this keyboard, which inserts into the focused field.
 *
 * Scope: the "In your own words" composer (#composerInput) and the
 * "About Me" questionnaire inputs (.wv-text). Settings' own fields stay on
 * the OS/physical keyboard (Setup-tier, rare, often supporter-entered).
 *
 * Access-method note: this is just the direct-select renderer of text
 * entry. It keeps focus on the target field (keys act on pointerdown +
 * preventDefault) so the caret never moves and no field blurs mid-type.
 */

const IN_SCOPE = '#composerInput, .wv-text';

let mode = 'physical';          // 'physical' | 'onscreen'
let rootEl = null;              // the keyboard panel
let activeField = null;         // the input/textarea currently being typed into
let caps = false;

// Layout — a digit row keeps numbers (age, etc.) one tap away without a
// symbol-layer toggle; the bottom row covers the punctuation real names,
// places and free text actually need.
const ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    [{ action: 'shift', label: '⇧' }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', { action: 'backspace', label: '⌫' }],
    [',', { action: 'space', label: 'space', wide: true }, '.', "'", '-', { action: 'enter', label: '↵' }]
];

// --- field helpers ----------------------------------------------------------

function isScoped(node) {
    return node instanceof Element && node.matches(IN_SCOPE);
}

function applyInputMode(node) {
    // inputmode="none" is the reliable Edge/Chrome switch that stops the
    // Windows touch keyboard from appearing on focus.
    node.inputMode = mode === 'onscreen' ? 'none' : '';
}

function applyInputModeAll() {
    document.querySelectorAll(IN_SCOPE).forEach(applyInputMode);
}

// --- typing into the active field ------------------------------------------

function insert(text) {
    const f = activeField;
    if (!f) return;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? f.value.length;
    f.value = f.value.slice(0, start) + text + f.value.slice(end);
    const pos = start + text.length;
    f.setSelectionRange(pos, pos);
    f.dispatchEvent(new Event('input', { bubbles: true }));
}

function backspace() {
    const f = activeField;
    if (!f) return;
    let start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? f.value.length;
    if (start === end) {
        if (start === 0) return;
        start -= 1;
    }
    f.value = f.value.slice(0, start) + f.value.slice(end);
    f.setSelectionRange(start, start);
    f.dispatchEvent(new Event('input', { bubbles: true }));
}

function enter() {
    const f = activeField;
    if (!f) return;
    if (f.tagName === 'TEXTAREA') {
        insert('\n');
    } else {
        // Single-line fields (composer is a textarea; worldview inputs are
        // text) save on Enter — fire the keydown their handlers listen for.
        f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
}

function setCaps(on) {
    caps = on;
    if (!rootEl) return;
    rootEl.classList.toggle('kbd-caps', caps);
    rootEl.querySelectorAll('.kbd-key[data-char]').forEach((k) => {
        const ch = k.dataset.char;
        if (/[a-z]/i.test(ch)) k.textContent = caps ? ch.toUpperCase() : ch.toLowerCase();
    });
}

// --- key handling -----------------------------------------------------------

function handleKey(keyEl) {
    const action = keyEl.dataset.action;
    if (action === 'shift') { setCaps(!caps); return; }
    if (action === 'backspace') { backspace(); return; }
    if (action === 'space') { insert(' '); return; }
    if (action === 'enter') { enter(); return; }

    const ch = keyEl.dataset.char;
    if (ch == null) return;
    insert(caps && /[a-z]/i.test(ch) ? ch.toUpperCase() : ch);
}

// --- DOM build --------------------------------------------------------------

function build() {
    rootEl = document.createElement('div');
    rootEl.id = 'appKeyboard';
    rootEl.className = 'hidden';
    rootEl.setAttribute('role', 'group');
    rootEl.setAttribute('aria-label', 'On-screen keyboard');

    for (const row of ROWS) {
        const rowEl = document.createElement('div');
        rowEl.className = 'kbd-row';
        for (const key of row) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kbd-key';
            if (typeof key === 'string') {
                btn.dataset.char = key;
                btn.textContent = key;
                if (/[a-z]/i.test(key)) btn.classList.add('kbd-letter');
            } else {
                btn.dataset.action = key.action;
                btn.textContent = key.label;
                btn.classList.add('kbd-' + key.action);
                if (key.wide) btn.classList.add('kbd-wide');
            }
            rowEl.appendChild(btn);
        }
        rootEl.appendChild(rowEl);
    }

    // Act on pointerdown and preventDefault so the target field keeps focus
    // and the caret never moves (the standard on-screen-keyboard trick).
    rootEl.addEventListener('pointerdown', (e) => {
        const keyEl = e.target.closest('.kbd-key');
        if (!keyEl) return;
        e.preventDefault();
        handleKey(keyEl);
    });

    document.body.appendChild(rootEl);
}

// --- show / hide ------------------------------------------------------------

function show(field) {
    activeField = field;
    rootEl.classList.remove('hidden');
    document.body.classList.add('kbd-open');
    // Keep the field visible above the keyboard.
    requestAnimationFrame(() => {
        try { field.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
    });
}

function hide() {
    activeField = null;
    setCaps(false);
    if (rootEl) rootEl.classList.add('hidden');
    document.body.classList.remove('kbd-open');
}

// --- public API -------------------------------------------------------------

export function init() {
    build();

    document.addEventListener('focusin', (e) => {
        if (mode !== 'onscreen') return;
        if (isScoped(e.target)) {
            applyInputMode(e.target);   // just-in-time guard for fresh fields
            show(e.target);
        }
    });

    document.addEventListener('focusout', (e) => {
        // Hide unless focus is moving to another in-scope field (handled by the
        // next focusin) — keys preventDefault, so typing never fires this.
        const next = e.relatedTarget;
        if (next && (isScoped(next) || (rootEl && rootEl.contains(next)))) return;
        hide();
    });

    // Worldview cards are (re)built dynamically; tag any new in-scope field so
    // the Windows keyboard is suppressed before its first focus.
    const dynamicRoot = document.getElementById('worldviewContent');
    if (dynamicRoot) {
        new MutationObserver((records) => {
            if (mode !== 'onscreen') return;
            for (const rec of records) {
                for (const node of rec.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.matches?.(IN_SCOPE)) applyInputMode(node);
                    node.querySelectorAll?.(IN_SCOPE).forEach(applyInputMode);
                }
            }
        }).observe(dynamicRoot, { childList: true, subtree: true });
    }
}

export function setMode(next) {
    mode = next === 'onscreen' ? 'onscreen' : 'physical';
    applyInputModeAll();
    if (mode === 'physical') hide();
}

export function getMode() {
    return mode;
}
