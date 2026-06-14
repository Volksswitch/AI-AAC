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

import { LAYOUTS, SYMBOLS } from './keyboard-layouts.js';

// Fields the app keyboard handles. Includes the Settings API-key field so the
// Windows keyboard is suppressed there too and the app's own (side-docked)
// keyboard is used instead (Ken, June 14 2026 — resolves the OS-vs-app keyboard
// question for Settings in favor of the app keyboard).
const IN_SCOPE = '#composerInput, .wv-text, #apiKeyInput';

let mode = 'physical';          // 'physical' | 'onscreen'
let rootEl = null;              // the keyboard panel
let activeField = null;         // the input/textarea currently being typed into

// Selected layouts per dock + which side the side dock sits on (user Settings).
let sideLayoutId = 'S1';
let bottomLayoutId = 'B1';
let sideDockPosition = 'right'; // 'left' | 'right'
let currentDock = 'bottom';     // set per focused field by dockFor()

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

// Layout is ALPHABETICAL (QWERTY dropped). The specific arrangement is a user
// Setting — twenty layouts live in keyboard-layouts.js (S1–S10 side, B1–B10
// bottom), one chosen per dock. The active letters page = the selected layout
// for the current dock; the 123 key flips to a dock-appropriate symbols page.

// Returns the rows to render right now (active layout's letters, or symbols).
function currentRows() {
    if (page === 'symbols') return SYMBOLS[currentDock] || SYMBOLS.bottom;
    const id = currentDock === 'side' ? sideLayoutId : bottomLayoutId;
    return (LAYOUTS[id] || LAYOUTS[currentDock === 'side' ? 'S1' : 'B1']).rows;
}

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

// --- clipboard (cut / copy / paste toolbar) --------------------------------
// A fixed Cut/Copy/Paste strip above the keys, the same for every layout. The
// app keyboard suppresses the OS keyboard, so these give back the clipboard
// affordances the OS keyboard would have provided (notably paste for the API
// key). Buttons act on pointerdown + preventDefault so the field keeps focus
// and its selection. localhost and https are secure contexts, so the async
// Clipboard API is available.

function selectedText() {
    const f = activeField;
    if (!f) return '';
    return f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0);
}

function deleteSelection() {
    const f = activeField;
    if (!f) return;
    const s = f.selectionStart ?? 0;
    const e = f.selectionEnd ?? 0;
    if (s === e) return;
    f.value = f.value.slice(0, s) + f.value.slice(e);
    f.setSelectionRange(s, s);
    f.dispatchEvent(new Event('input', { bubbles: true }));
}

async function handleTool(tool) {
    if (!activeField) return;
    if (tool === 'copy' || tool === 'cut') {
        const text = selectedText();
        if (!text) return;
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
        if (tool === 'cut') deleteSelection();
    } else if (tool === 'paste') {
        try {
            const text = await navigator.clipboard.readText();
            if (text) insert(text);   // insert() replaces any selection at the caret
        } catch { /* clipboard read blocked/denied */ }
    }
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
        const tool = e.target.closest('.kbd-tool');
        if (tool) { e.preventDefault(); handleTool(tool.dataset.tool); return; }
        const keyEl = e.target.closest('.kbd-key');
        if (!keyEl) return;
        e.preventDefault();
        handleKey(keyEl);
    });

    // Persistent Cut/Copy/Paste toolbar above the keys (layout-independent).
    const toolbar = document.createElement('div');
    toolbar.className = 'kbd-toolbar';
    for (const [tool, label] of [['cut', 'Cut'], ['copy', 'Copy'], ['paste', 'Paste']]) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kbd-tool';
        btn.dataset.tool = tool;
        btn.textContent = label;
        toolbar.appendChild(btn);
    }
    rootEl.appendChild(toolbar);

    renderRows();
    document.body.appendChild(rootEl);
}

// (Re)builds the key buttons for the current page. The pointerdown handler is
// delegated on rootEl, so swapping the inner rows on a page/layout change is
// safe. Each cell's `span` becomes its flex weight, so a row of any width fills
// the keyboard and wide keys (space, etc.) keep their proportions.
function renderRows() {
    if (!rootEl) return;
    // Clear only the key rows — the Cut/Copy/Paste toolbar persists.
    rootEl.querySelectorAll('.kbd-row').forEach((el) => el.remove());
    for (const row of currentRows()) {
        const rowEl = document.createElement('div');
        rowEl.className = 'kbd-row';
        for (const cell of row) {
            const span = cell.span || 1;
            if (cell.kind === 'blank' || cell.kind === 'pred') {
                // Inert filler / future prediction slot — no key, just holds space.
                const filler = document.createElement('div');
                filler.className = 'kbd-key kbd-' + cell.kind;
                filler.style.flex = `${span} 1 0`;
                rowEl.appendChild(filler);
                continue;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kbd-key';
            btn.style.flex = `${span} 1 0`;
            if (cell.kind === 'char') {
                btn.dataset.char = cell.char;
                btn.textContent = cell.char;
                if (/[a-z]/i.test(cell.char)) btn.classList.add('kbd-letter');
                else btn.classList.add('kbd-char');
            } else {
                btn.dataset.action = cell.action;
                btn.textContent = cell.label;
                btn.classList.add('kbd-' + cell.action);
            }
            rowEl.appendChild(btn);
        }
        rootEl.appendChild(rowEl);
    }
    applyShiftVisual();
}

// --- show / hide ------------------------------------------------------------

// Context-based docking (Ken, June 14 2026 — NOT tied to layout or, for now,
// to orientation): About Me / Settings fields dock the keyboard to the SIDE
// (those screens compete for horizontal space and want full height); the
// conversation composer docks it to the BOTTOM. Dynamic orientation-aware
// docking is a later refinement.
function dockFor(field) {
    // Settings fields and About Me both compete for horizontal space → side.
    if (field.closest('#settingsDialog')) return 'side';
    return field.matches('.wv-text') ? 'side' : 'bottom';
}

function setDock(dock) {
    currentDock = dock;
    const side = dock === 'side';
    const left = side && sideDockPosition === 'left';
    const right = side && sideDockPosition === 'right';
    for (const el of [rootEl, document.body]) {
        el.classList.toggle('kbd-dock-side', side);
        el.classList.toggle('kbd-dock-bottom', !side);
        el.classList.toggle('kbd-side-left', left);
        el.classList.toggle('kbd-side-right', right);
    }
}

function visible() {
    return rootEl && !rootEl.classList.contains('hidden');
}

function show(field) {
    activeField = field;
    setDock(dockFor(field));
    // A modal <dialog> (Settings) lives in the top layer and renders above —
    // and makes inert — anything in normal flow. So when the focused field is
    // inside an open modal dialog, host the keyboard inside that dialog so it's
    // in the same top layer and stays interactive. The keyboard is
    // position:fixed (viewport-relative) and the dialog sets no containing
    // block (no transform), so it still docks to the screen edge and isn't
    // clipped by the dialog's overflow.
    const host = field.closest('dialog[open]') || document.body;
    if (rootEl.parentNode !== host) host.appendChild(rootEl);
    renderRows();
    rootEl.classList.remove('hidden');
    document.body.classList.add('kbd-open');
    // Keep the focused field clear of the keyboard. The content area reserves
    // viewport-relative padding (CSS) so the field can scroll above a
    // bottom dock; centring it lands it in the visible band above the keys.
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
    document.body.classList.remove('kbd-open', 'kbd-dock-side', 'kbd-dock-bottom', 'kbd-side-left', 'kbd-side-right');
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

// --- layout / dock-position settings (live-applied from Settings) -----------

export function setSideLayout(id) {
    if (!LAYOUTS[id]) return;
    sideLayoutId = id;
    if (visible() && currentDock === 'side' && page === 'letters') renderRows();
}

export function setBottomLayout(id) {
    if (!LAYOUTS[id]) return;
    bottomLayoutId = id;
    if (visible() && currentDock === 'bottom' && page === 'letters') renderRows();
}

export function setSideDockPosition(pos) {
    sideDockPosition = pos === 'left' ? 'left' : 'right';
    if (visible() && currentDock === 'side') setDock('side');
}
