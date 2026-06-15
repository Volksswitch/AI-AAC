/* AAC Conversation Assistant — relationship graph model
 *
 * Relationship data is a *graph*, not flat question/answer: people are nodes
 * (each with attributes), and relationships are edges (which also carry data).
 * That is structurally different from the worldview questionnaire (worldview.js),
 * so it lives in its own file and its own model layer (Ken, June 15 2026).
 *
 * Storage mirrors worldview.js:
 *   - <data folder>/relationships.json   per-user graph (FSA), source of truth
 *   - localStorage 'aac_relationships'    same-machine write-through cache
 * Reconciliation is the v0.2.25 rule — the file in the connected folder wins;
 * the cache is promoted only when no file exists on disk yet.
 *
 * Shape:
 *   { version, updated, migratedFromWorldview,
 *     people: [ { id, name, private, attrs: { about, ... } } ],
 *     edges:  [ { from, to, type, attrs: {} } ] }
 * The user is the implicit node "me"; a person's relationship to the user is the
 * `type` of the me->person edge. Person<->person edges are supported by the data
 * model (e.g. "my sister is married to my brother-in-law") even though the
 * current UI only edits me->person edges — keeping the build small without
 * trapping the schema.
 */

import { readFile, writeFile, hasDataFolder } from './storage.js';

const FILE = 'relationships.json';
const CACHE_KEY = 'aac_relationships';
const ME = 'me';

let graph = null;

// --- shape helpers ----------------------------------------------------------

function defaultGraph() {
    return {
        version: 1,
        updated: new Date().toISOString(),
        migratedFromWorldview: false,
        people: [],
        edges: []
    };
}

function normalize(g) {
    const base = defaultGraph();
    return {
        version: g.version ?? base.version,
        updated: g.updated ?? base.updated,
        migratedFromWorldview: g.migratedFromWorldview ?? false,
        people: Array.isArray(g.people) ? g.people : [],
        edges: Array.isArray(g.edges) ? g.edges : []
    };
}

function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

function writeCache(g) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(g)); } catch { /* quota — disk is truth */ }
}

// --- load / save ------------------------------------------------------------

/** Load the graph: data folder (source of truth) → cache → empty. */
export async function load() {
    let loaded = null;
    const raw = await readFile(FILE);
    if (raw) { try { loaded = JSON.parse(raw); } catch { loaded = null; } }
    if (!loaded) loaded = readCache();
    graph = loaded ? normalize(loaded) : defaultGraph();
    writeCache(graph);
    return graph;
}

function ensureLoaded() {
    if (!graph) graph = readCache() ? normalize(readCache()) : defaultGraph();
    return graph;
}

async function save() {
    graph.updated = new Date().toISOString();
    writeCache(graph);
    await writeFile(FILE, JSON.stringify(graph, null, 2));
}

/**
 * Reconcile cache with the data folder once a folder becomes available. Same
 * rule as worldview.syncToFolder (v0.2.25): the file in the connected folder is
 * the source of truth — if a relationships.json is present it wins; otherwise
 * the cache is promoted to a new file. Returns 'wrote' | 'adopted' | 'noop'.
 */
export async function syncToFolder() {
    if (!hasDataFolder()) return 'noop';

    const raw = await readFile(FILE);
    let disk = null;
    if (raw) { try { disk = JSON.parse(raw); } catch { disk = null; } }

    if (disk) {
        graph = normalize(disk);
        writeCache(graph);
        return 'adopted';
    }
    graph = normalize(readCache() || graph || defaultGraph());
    await save();
    return 'wrote';
}

// --- people / edges ---------------------------------------------------------

function meEdge(personId) {
    return ensureLoaded().edges.find((e) => e.from === ME && e.to === personId);
}

/** People joined with their relationship-to-the-user, for the editor + display. */
export function listPeople() {
    return ensureLoaded().people.map((p) => {
        const edge = meEdge(p.id);
        return {
            id: p.id,
            name: p.name,
            relationship: edge ? edge.type : '',
            about: (p.attrs && p.attrs.about) || '',
            private: !!p.private
        };
    });
}

export function getPerson(id) {
    return listPeople().find((p) => p.id === id) || null;
}

export async function addPerson({ name, relationship = '', about = '', isPrivate = false } = {}) {
    const g = ensureLoaded();
    const id = newId();
    g.people.push({ id, name: (name || '').trim(), private: !!isPrivate, attrs: { about: (about || '').trim() } });
    if ((relationship || '').trim()) {
        g.edges.push({ from: ME, to: id, type: relationship.trim(), attrs: {} });
    }
    await save();
    return id;
}

export async function updatePerson(id, { name, relationship, about, isPrivate } = {}) {
    const g = ensureLoaded();
    const p = g.people.find((x) => x.id === id);
    if (!p) return;
    if (name !== undefined) p.name = (name || '').trim();
    if (about !== undefined) { p.attrs = p.attrs || {}; p.attrs.about = (about || '').trim(); }
    if (isPrivate !== undefined) p.private = !!isPrivate;
    if (relationship !== undefined) {
        const edge = meEdge(id);
        const t = (relationship || '').trim();
        if (edge) {
            if (t) edge.type = t;
            else g.edges = g.edges.filter((e) => e !== edge);
        } else if (t) {
            g.edges.push({ from: ME, to: id, type: t, attrs: {} });
        }
    }
    await save();
}

export async function removePerson(id) {
    const g = ensureLoaded();
    g.people = g.people.filter((p) => p.id !== id);
    g.edges = g.edges.filter((e) => e.from !== id && e.to !== id);
    await save();
}

export async function resetAll() {
    const g = ensureLoaded();
    g.people = [];
    g.edges = [];
    await save();
}

export function count() {
    return ensureLoaded().people.length;
}

// --- migration from the old worldview A3 fields -----------------------------

/**
 * One-time import of the pre-graph "People in Your Life" answers (worldview
 * module A3) into the graph. Reads by the original field keys from the passed
 * worldview module (its getField), so it works even though A3 has been removed
 * from the question registry. Idempotent: sets migratedFromWorldview and never
 * re-runs. Returns the number of people imported.
 */
export async function migrateFromWorldview(wv) {
    const g = ensureLoaded();
    if (g.migratedFromWorldview) return 0;

    const tupleFields = [
        { key: 'household', rel: null },
        { key: 'family_key', rel: null }
    ];
    let imported = 0;

    for (const { key } of tupleFields) {
        const val = wv.getField(key);
        if (!Array.isArray(val)) continue;
        for (const entry of val) {
            const name = (entry && (entry.name || entry.value) || '').trim();
            if (!name) continue;
            const rel = (entry && entry.relationship || '').trim();
            const id = newId();
            g.people.push({ id, name, private: false, attrs: { about: '' } });
            if (rel) g.edges.push({ from: ME, to: id, type: rel, attrs: {} });
            imported++;
        }
    }

    const friends = wv.getField('friends_key');
    if (Array.isArray(friends)) {
        for (const name of friends) {
            const n = String(name || '').trim();
            if (!n) continue;
            const id = newId();
            g.people.push({ id, name: n, private: false, attrs: { about: '' } });
            g.edges.push({ from: ME, to: id, type: 'friend', attrs: {} });
            imported++;
        }
    }

    const pets = wv.getField('pets');
    if (Array.isArray(pets)) {
        for (const entry of pets) {
            const name = (entry && (entry.name || entry.value) || '').trim();
            if (!name) continue;
            const kind = (entry && entry.kind || '').trim();
            const id = newId();
            g.people.push({ id, name, private: false, attrs: { about: kind } });
            g.edges.push({ from: ME, to: id, type: 'pet', attrs: {} });
            imported++;
        }
    }

    g.migratedFromWorldview = true;
    await save();
    return imported;
}

// --- LLM profile block ------------------------------------------------------

/**
 * Compact text for the generation system prompt — the relationship slice of
 * "speak AS this person." Private people are never named or described; they are
 * surfaced only as a phrase-around instruction by their relationship, mirroring
 * the worldview privacy rule.
 */
export function buildBlock() {
    ensureLoaded();
    const people = listPeople();
    if (!people.length) return '';

    const facts = [];
    const phraseAround = [];
    for (const p of people) {
        if (p.private) {
            phraseAround.push(p.relationship || 'someone close to me');
            continue;
        }
        const rel = p.relationship ? ` (${p.relationship})` : '';
        const about = p.about ? ` — ${p.about}` : '';
        const name = p.name || (p.relationship || 'someone');
        facts.push(`- ${name}${rel}${about}`);
    }

    if (!facts.length && !phraseAround.length) return '';
    const lines = ['People in my life:'];
    if (facts.length) lines.push(...facts);
    if (phraseAround.length) {
        lines.push(
            'Do not name or describe these private relationships — phrase around them if they come up: '
            + phraseAround.join(', ') + '.'
        );
    }
    return lines.join('\n');
}
