/**
 * nexusBackend.js
 * API + WebSocket client for the SOMA Nexus facade.
 * Connects to the same SOMA backend as the main dashboard.
 */

const BASE = '';

// ── HTTP helpers ─────────────────────────────────────────────────────────────

export async function api(method, path, body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
    return res.json();
}

export const get  = (path)        => api('GET',    path);
export const post = (path, body)  => api('POST',   path, body);
export const put  = (path, body)  => api('PUT',    path, body);
export const del  = (path)        => api('DELETE', path);

// ── Axis helpers (chat) ───────────────────────────────────────────────────────

export function axisHeaders(identity) {
    return {
        'x-axis-user-id':    identity.id,
        'x-axis-user-name':  identity.name,
        'x-axis-user-color': identity.color,
    };
}

export async function axisGet(path, identity) {
    const res = await fetch(BASE + path, { headers: axisHeaders(identity) });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
}

export async function axisPost(path, body, identity) {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...axisHeaders(identity) },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
    return res.json();
}

// ── WebSocket (SOMA broadcast) ────────────────────────────────────────────────

export function createNexusSocket(onMessage, onStatusChange) {
    let ws = null;
    let backoff = 1000;
    let dead = false;

    function connect() {
        if (dead) return;
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        ws = new WebSocket(`${proto}://${location.host}/ws`);

        ws.onopen = () => {
            backoff = 1000;
            onStatusChange('online');
        };

        ws.onmessage = (evt) => {
            try { onMessage(JSON.parse(evt.data)); } catch {}
        };

        ws.onclose = () => {
            onStatusChange('offline');
            if (!dead) setTimeout(connect, Math.min(backoff *= 1.5, 30000));
        };

        ws.onerror = () => ws.close();
    }

    connect();
    return {
        send: (data) => ws?.readyState === 1 && ws.send(JSON.stringify(data)),
        destroy: () => { dead = true; ws?.close(); },
    };
}

// ── SOMA status ───────────────────────────────────────────────────────────────

export async function fetchSomaStatus() {
    try { return await get('/api/soma/status'); } catch { return null; }
}

export async function fetchGoals() {
    try { return await get('/api/soma/goals'); } catch { return { goals: [] }; }
}

export async function fetchReflections() {
    try { return await get('/api/reflections/list'); } catch { return { notes: [] }; }
}

export async function fetchNote(name) {
    return get(`/api/reflections/note/${encodeURIComponent(name)}`);
}

export async function saveNote(name, content) {
    return put('/api/reflections/note', { name, content });
}

export async function deleteNote(name) {
    return del(`/api/reflections/note/${encodeURIComponent(name)}`);
}

export async function quickNote(text, title = '') {
    return post('/api/reflections/quick-note', { text, title });
}
