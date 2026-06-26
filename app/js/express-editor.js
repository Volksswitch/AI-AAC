/* Express Panel editor (Settings → Express Panel) — June 26 2026
 *
 * Edits the single ORDERED, TYPED item list backing the Express Panel (Ken's
 * chosen model: one list, each item tagged phrase / partner / feeling; the item's
 * position = its slot in the panel grid, so reordering re-maps the layout). A
 * starting layout is provided (express-items.DEFAULT_ITEMS) and "Reset to default"
 * restores it. The list persists via the express-panel.js model (data folder +
 * cache), so customizations follow the user across devices.
 *
 * Partner items may be picked from People I Know (the relationship graph) or typed
 * free-form (Ken: partners "may be" known people but need not be). A picked person
 * carries their personId + name + nickname so the conversation can use their
 * preferred term of address.
 *
 * Editing rules: structural changes (add / delete / reorder / pick a person)
 * re-render the editor; plain text edits commit WITHOUT re-rendering so the field
 * keeps focus while typing. Every change persists and calls onChange so the live
 * panel updates immediately.
 */

import * as expressPanel from './express-panel.js';
import * as relationships from './relationships.js';
import { CATEGORIES, FEELING_PRESETS, makeId } from './express-items.js';
import { confirmDanger } from './confirm-dialog.js';

let container = null;
let onChangeCb = null;
let current = [];

export function init(el, opts = {}) {
    container = el;
    onChangeCb = opts.onChange || null;
}

function commit(rerender) {
    expressPanel.setItems(current);
    if (onChangeCb) onChangeCb();
    if (rerender) render();
}

function mkBtn(label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    return b;
}

function buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'pe-toolbar';

    const addItem = (label, factory) => {
        const b = mkBtn(label, 'pe-add');
        b.addEventListener('click', () => {
            current.push({ id: makeId(), ...factory() });
            commit(true);
        });
        bar.appendChild(b);
    };
    addItem('+ Phrase', () => ({ type: 'phrase', text: '', cat: 'back' }));
    addItem('+ Partner', () => ({ type: 'partner', name: '', nickname: '' }));
    addItem('+ Feeling', () => ({ type: 'feeling', text: '' }));

    const reset = mkBtn('Reset to default', 'pe-reset');
    reset.addEventListener('click', async () => {
        const ok = await confirmDanger({
            title: 'Reset quick phrases?',
            body: 'This replaces your edited list with the default starting layout. Your customizations will be lost.',
            confirmLabel: 'Reset to default',
            cancelLabel: 'Keep mine',
        });
        if (!ok) return;
        expressPanel.resetItems();
        if (onChangeCb) onChangeCb();
        render();
    });
    bar.appendChild(reset);
    return bar;
}

function textInput(value, placeholder, oninput) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    inp.placeholder = placeholder || '';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => oninput(inp.value));
    return inp;
}

function buildRow(item, i) {
    const row = document.createElement('div');
    row.className = `pe-row pe-${item.type}`;

    // Type badge.
    const badge = document.createElement('span');
    badge.className = `pe-badge pe-badge-${item.type}`;
    badge.textContent = item.type;
    row.appendChild(badge);

    // Type-specific fields.
    const fields = document.createElement('div');
    fields.className = 'pe-fields';

    if (item.type === 'phrase') {
        fields.appendChild(textInput(item.text, 'Phrase to speak', (v) => { item.text = v; commit(false); }));
        const sel = document.createElement('select');
        Object.entries(CATEGORIES).forEach(([key, c]) => {
            const o = document.createElement('option');
            o.value = key; o.textContent = c.label;
            if (key === item.cat) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => { item.cat = sel.value; commit(false); });
        fields.appendChild(sel);
    } else if (item.type === 'partner') {
        // Pick from People I Know, or type a name (Custom).
        const sel = document.createElement('select');
        const customOpt = document.createElement('option');
        customOpt.value = ''; customOpt.textContent = '— Type a name —';
        sel.appendChild(customOpt);
        relationships.listPeople().forEach((p) => {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.name + (p.relationship ? ` (${p.relationship})` : '');
            if (p.id === item.personId) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
            if (sel.value) {
                const p = relationships.getPerson(sel.value);
                item.personId = p.id;
                item.name = p.name;
                item.nickname = p.nickname || '';
            } else {
                delete item.personId;
            }
            commit(true); // refresh the name/nickname fields below
        });
        fields.appendChild(sel);
        fields.appendChild(textInput(item.name, 'Name', (v) => { item.name = v; if (!item.personId) commit(false); else commit(false); }));
        fields.appendChild(textInput(item.nickname, 'What I call them (optional)', (v) => { item.nickname = v; commit(false); }));
    } else { // feeling
        const inp = textInput(item.text, 'Feeling (e.g. Happy)', (v) => { item.text = v; commit(false); });
        inp.setAttribute('list', 'pe-feeling-presets');
        fields.appendChild(inp);
    }
    row.appendChild(fields);

    // Reorder + delete.
    const tools = document.createElement('div');
    tools.className = 'pe-tools';
    const up = mkBtn('↑'); up.disabled = i === 0;
    up.addEventListener('click', () => { [current[i - 1], current[i]] = [current[i], current[i - 1]]; commit(true); });
    const down = mkBtn('↓'); down.disabled = i === current.length - 1;
    down.addEventListener('click', () => { [current[i + 1], current[i]] = [current[i], current[i + 1]]; commit(true); });
    const del = mkBtn('✕', 'pe-del');
    del.addEventListener('click', () => { current.splice(i, 1); commit(true); });
    tools.append(up, down, del);
    row.appendChild(tools);

    return row;
}

export function render() {
    if (!container) return;
    current = expressPanel.getItems();
    container.innerHTML = '';
    container.appendChild(buildToolbar());

    // datalist of suggested feelings (shared by all feeling rows).
    const dl = document.createElement('datalist');
    dl.id = 'pe-feeling-presets';
    FEELING_PRESETS.forEach((f) => { const o = document.createElement('option'); o.value = f; dl.appendChild(o); });
    container.appendChild(dl);

    const list = document.createElement('div');
    list.className = 'pe-list';
    if (!current.length) {
        const p = document.createElement('p');
        p.className = 'setting-hint';
        p.textContent = 'No items yet — add a phrase, partner, or feeling above.';
        list.appendChild(p);
    } else {
        current.forEach((item, i) => list.appendChild(buildRow(item, i)));
    }
    container.appendChild(list);
}
