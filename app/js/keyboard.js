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

// Shift state machine (CLAUDE.md keyboard spec, June 2026):
//   'off'   — lowercase
//   'shift' — one-shot: next letter is uppercase, then auto-reverts to 'off'
//   'lock'  — caps lock: stays uppercase until shift is tapped again
// A single tap toggles off↔shift; a double tap (within SHIFT_DOUBLE_TAP_MS)
// engages 'lock'. A non-touch-typing user gets a Caps-Lock-style sticky shift
// without having to hold a key.
let shiftState = 'off';
let lastShiftTap = 0;
const SHIFT_DOUBLE_TAP_MS = 300;

// Which page is showing: 'letters' or 'symbols'. Numbers and special
// characters live on the symbols page (toggled with the 123 / ABC key) so
// the letters page stays uncluttered. Comma, period, space and backspace stay
// on the letters page per Ken's spec; space, backspace and enter are repeated
// on the symbols page because editing is impossible without them.
let page = 'letters';

const LETTER_ROWS = [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    [{ action: 'shift', label: '⇧' }, 'z', 'x', 'c', 'v', 'b', 'n', 'm', { action: 'backspace', label: '⌫' }],
    [{ action: 'page', label: '123' }, ',', { action: 'space', label: 'space', wide: true }, '.', { action: 'enter', label: '↵' }]
];

const SYMBOL_ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['@', '#', '$', '%', '&', '*', '(', ')', '-', '+'],
    ['!', '?', "'", '"', ':', ';', '/', '=', '_', '~'],
    [{ action: 'page', label: 'ABC' }, { action: 'space', label: 'space', wide: true }, { action: 'backspace', label: '⌫' }, { action: 'enter', label: '↵' }]
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
    // TODO (Ken, June 2026 — to discuss/revisit): Enter may need to behave
    // differently per context (newline vs. save vs. speak), and the keyboard
    // likely needs a formal "close/done" key rather than relying on Enter or a
    // focus-out to dismiss it. Current behavior: newline in a textarea, save in
    // a single-line field. See CLAUDE.md "App virtual keyboard" notes.
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

function applyShiftVisual() {
    if (!rootEl) return;
    rootEl.classList.toggle('kbd-shift-on', shiftState === 'shift');
    rootEl.classList.toggle('kbd-caps', shiftState === 'lock');
    const upper = shiftState !== 'off';
    rootEl.querySelectorAll('.kbd-key[data-char]').forEach((k) => {
        const ch = k.dataset.char;
        if (/[a-z]/i.test(ch)) k.textContent = upper ? ch.toUpperCase() : ch.toLowerCase();
    });
}

function onShift() {
    const now = Date.now();
    if (now - lastShiftTap < SHIFT_DOUBLE_TAP_MS) {
        shiftState = 'lock';                                  // double tap → caps lock
    } else {
        shiftState = shiftState === 'off' ? 'shift' : 'off';  // single tap toggles
    }
    lastShiftTap = now;
    applyShiftVisual();
}

// One-shot shift reverts to lowercase after a single character; caps lock stays.
function consumeShift() {
    if (shiftState === 'shift') { shiftState = 'off'; applyShiftVisual(); }
}

// --- key handling -----------------------------------------------------------

function handleKey(keyEl) {
    const action = keyEl.dataset.action;
    if (action === 'shift') { onShift(); return; }
    if (action === 'page') { page = page === 'symbols' ? 'letters' : 'symbols'; renderRows(); return; }
    if (action === 'backspace') { backspace(); return; }
    if (action === 'space') { insert(' '); consumeShift(); return; }
    if (action === 'enter') { enter(); return; }

    const ch = keyEl.dataset.char;
    if (ch == null) return;
    const upper = shiftState !== 'off';
    insert(upper && /[a-z]/i.test(ch) ? ch.toUpperCase() : ch);
    consumeShift();
}

// --- DOM build --------------------------------------------------------------

function build() {
    rootEl = document.createElement('div');
    rootEl.id = 'appKeyboard';
    rootEl.className = 'hidden';
    rootEl.setAttribute('role', 'group');
    rootEl.setAttribute('aria-label', 'On-screen keyboard');

    // Act on pointerdown and preventDefault so the target field keeps focus
    // and the caret never moves (the standard on-screen-keyboard trick).
    rootEl.addEventListener('pointerdown', (e) => {
        const keyEl = e.target.closest('.kbd-key');
        if (!keyEl) return;
        e.preventDefault();
        handleKey(keyEl);
    });

    renderRows();
    document.body.appendChild(rootEl);
}

// (Re)builds the key buttons for the current page. The pointerdown handler is
// delegated on rootEl, so swapping the inner rows on a page toggle is safe.
function renderRows() {
    if (!rootEl) return;
    rootEl.innerHTML = '';
    const rows = page === 'symbols' ? SYMBOL_ROWS : LETTER_ROWS;
    for (const row of rows) {
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
    applyShiftVisual();
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
    // Reset to a clean slate for the next field: lowercase, letters page.
    shiftState = 'off';
    page = 'letters';
    renderRows();
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
