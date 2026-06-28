/* Control phrases — persistence model (Ken, June 28 2026)
 *
 * The user-editable spoken text behind the persistent override controls and the
 * conversation opener/closer cards, so a user can make each one sound like
 * something THEY would say:
 *   - holdOn   : spoken when "Hold on" is tapped (a floor-holding beat)
 *   - pardon   : spoken when "Pardon?" is tapped (asks the partner to repeat)
 *   - openers  : the cards shown by "Start conversation" (templates; {name} is
 *                replaced with the active Partner's name, dropped when none)
 *   - closers  : the cards shown by "Wind down"
 * ("Say again" has no editable phrase — it re-speaks the user's own last words.)
 *
 * Stored like the other user-owned data (express-panel.js, worldview.js):
 *   - <data folder>/control-phrases.json   portable source of truth (FSA)
 *   - localStorage 'aac_control_phrases'    same-machine write-through cache
 * Reconciliation is the v0.2.25 rule: a file in the connected folder wins; the
 * cache is promoted to a new file only when none exists on disk yet.
 *
 * Engine note: openers carry a {name} placeholder, but the name-substitution
 * lives in engine.js (applyName) where the opener palette is built — this model
 * just stores the raw templates. The engine keeps an inline default set mirroring
 * DEFAULTS so it works even before app.js injects these.
 */

import { readFile, writeFile, hasDataFolder } from './storage.js';

const FILE = 'control-phrases.json';
const CACHE_KEY = 'aac_control_phrases';

export const DEFAULTS = {
    holdOn: 'Let me think about that.',
    pardon: "Sorry, I didn't catch that. Could you say it again?",
    // {name} → the active Partner's name; dropped (with tidy punctuation) when
    // no Partner is active. Kept in sync with engine.js's inline fallback.
    openers: [
        'Hi {name}, got a minute?',
        'Can I ask you something, {name}?',
        'Guess what, {name}.',
    ],
    closers: [
        'I should get going.',
        'This was really nice, thanks.',
        'Great seeing you.',
        'Bye!',
    ],
};

let phrases = null; // in-memory working copy

// Coerce any stored/edited value into the full shape, filling gaps from defaults.
// Blank list entries are KEPT (the editor needs a transient empty row to type
// into) — they're filtered out at engine-injection time, not here. A list that is
// entirely missing falls back to defaults.
function normalize(value) {
    const v = value && typeof value === 'object' ? value : {};
    const str = (x, d) => (typeof x === 'string' && x.trim() ? x : d);
    const list = (x, d) => {
        if (!Array.isArray(x)) return d.slice();
        const arr = x.map((s) => (typeof s === 'string' ? s : ''));
        return arr.length ? arr : d.slice();
    };
    return {
        holdOn: str(v.holdOn, DEFAULTS.holdOn),
        pardon: str(v.pardon, DEFAULTS.pardon),
        openers: list(v.openers, DEFAULTS.openers),
        closers: list(v.closers, DEFAULTS.closers),
    };
}

function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function writeCache(p) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* quota — disk is truth */ }
}
function writeDisk(p) {
    writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), ...p }, null, 2))
        .catch(() => { /* best-effort */ });
}

/** Load: data folder (source of truth) → cache → defaults. */
export async function load() {
    let loaded = null;
    const raw = await readFile(FILE);
    if (raw) { try { loaded = JSON.parse(raw); } catch { loaded = null; } }
    if (!loaded) loaded = readCache();
    phrases = normalize(loaded);
    writeCache(phrases);
    return phrases;
}

/** Synchronous read for the editor / engine injection (returns a copy). */
export function getPhrases() {
    if (!phrases) phrases = normalize(readCache());
    return { ...phrases, openers: phrases.openers.slice(), closers: phrases.closers.slice() };
}

/** Persist an edited set (cache immediately, disk in the background). */
export function setPhrases(next) {
    phrases = normalize(next);
    writeCache(phrases);
    writeDisk(phrases);
    return getPhrases();
}

/** Restore the default phrases. */
export function resetPhrases() {
    phrases = normalize(DEFAULTS);
    writeCache(phrases);
    writeDisk(phrases);
    return getPhrases();
}

/**
 * Reconcile once a data folder becomes available (v0.2.25 rule): adopt an
 * existing control-phrases.json, otherwise promote the cache to a new file.
 * Returns 'adopted' | 'wrote' | 'noop'.
 */
export async function syncToFolder() {
    if (!hasDataFolder()) return 'noop';
    const raw = await readFile(FILE);
    let disk = null;
    if (raw) { try { disk = JSON.parse(raw); } catch { disk = null; } }
    if (disk) {
        phrases = normalize(disk);
        writeCache(phrases);
        return 'adopted';
    }
    phrases = getPhrases();
    await writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), ...phrases }, null, 2));
    return 'wrote';
}
