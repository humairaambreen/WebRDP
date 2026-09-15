// Saved connections now live entirely in *your own browser* - this file
// used to be a fetch() wrapper around a small Node/Express/SQLite API
// (server/), which meant every saved host/username/password round-tripped
// through - and sat encrypted-but-present on disk next to - a server
// process on this machine. That's gone now: nothing about a saved
// connection is ever sent anywhere outside this tab. It's stored the way
// the browser stores anything else of yours (localStorage), which means
// it's under the same controls you already have for that: it's scoped to
// this browser profile + origin, you can inspect/edit it yourself in
// devtools (Application -> Local Storage), and clearing this site's data
// removes it completely. See README.md ("About saved connections") for
// the honest trade-offs of that vs. the old server-side model.
const STORAGE_KEY = 'webrdp.connections.v1';

function genId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '').slice(0, 24);
    return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
}

function readAll() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        // Corrupt or blocked storage (private browsing in some browsers
        // throws on read/write) - fail soft to "no saved connections"
        // rather than breaking the whole dashboard.
        return [];
    }
}

function writeAll(records) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        return true;
    } catch (e) {
        throw new Error(`Couldn't save to this browser's local storage: ${e.message}`);
    }
}

// The public shape callers get back never includes the password - same
// spirit as the old server's "public" vs "secret" split, even though both
// now live in the same localStorage entry rather than a DB + decrypt step.
function toPublic(rec) {
    const { password, ...pub } = rec;
    return pub;
}

async function list() {
    return readAll()
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(toPublic);
}

async function create({ name, host, port, username, password }) {
    if (!host || !username) throw new Error('host and username are required');
    const now = Date.now();
    const record = {
        id: genId(),
        name: (name && name.trim()) || host,
        host: host.trim(),
        port: port ? parseInt(port, 10) : 3389,
        username: username.trim(),
        password: password || '',
        lastScreenshot: null,
        autoConnect: false,
        createdAt: now,
        updatedAt: now,
    };
    const all = readAll();
    all.push(record);
    writeAll(all);
    return toPublic(record);
}

async function update(id, fields) {
    const all = readAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('not found');
    const existing = all[idx];
    const next = {
        ...existing,
        name: fields.name ?? existing.name,
        host: fields.host ?? existing.host,
        port: fields.port ?? existing.port,
        username: fields.username ?? existing.username,
        password: fields.password !== undefined ? fields.password : existing.password,
        lastScreenshot: fields.lastScreenshot !== undefined ? fields.lastScreenshot : existing.lastScreenshot,
        autoConnect: fields.autoConnect !== undefined ? fields.autoConnect : existing.autoConnect,
        updatedAt: Date.now(),
    };
    all[idx] = next;
    writeAll(all);
    return toPublic(next);
}

async function remove(id) {
    const all = readAll();
    const next = all.filter((r) => r.id !== id);
    if (next.length === all.length) throw new Error('not found');
    writeAll(next);
    return true;
}

// Only one connection can auto-connect at a time - having several race
// to connect the moment the dashboard loads would just be confusing.
// Setting one on clears it from every other saved connection.
async function setAutoConnect(id, enabled) {
    const all = readAll();
    const idx = all.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error('not found');
    all.forEach((r) => { r.autoConnect = r.id === id ? enabled : false; });
    writeAll(all);
    return toPublic(all[idx]);
}

// Used right before opening a session - the one place the password comes
// back out. It never leaves this tab either way; this just mirrors the
// old API shape so the rest of the app didn't need to change.
async function secret(id) {
    const rec = readAll().find((r) => r.id === id);
    if (!rec) throw new Error('not found');
    return { username: rec.username, password: rec.password, host: rec.host, port: rec.port };
}

export const api = { list, create, update, remove, secret, setAutoConnect };
