let dirHandle = null;

export async function requestStorageAccess() {
    dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    return dirHandle;
}

export function hasStorageAccess() {
    return dirHandle !== null;
}

async function readFile(filename) {
    if (!dirHandle) return null;
    try {
        const fileHandle = await dirHandle.getFileHandle(filename);
        const file = await fileHandle.getFile();
        return await file.text();
    } catch {
        return null;
    }
}

async function writeFile(filename, content) {
    if (!dirHandle) return;
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
}

export async function loadApiKey() {
    const data = await readFile('settings.json');
    if (!data) return null;
    try {
        return JSON.parse(data).apiKey || null;
    } catch {
        return null;
    }
}

export async function saveApiKey(apiKey) {
    const data = await readFile('settings.json');
    let settings = {};
    try { settings = JSON.parse(data) || {}; } catch { /* start fresh */ }
    settings.apiKey = apiKey;
    await writeFile('settings.json', JSON.stringify(settings, null, 2));
}
