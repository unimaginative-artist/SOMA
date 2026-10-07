import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import studioUsers from './StudioUsersStore.js';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const SESSIONS_FILE = path.join(SOMA_DIR, 'studio-sessions.json');
const USERS_FILE = path.join(SOMA_DIR, 'studio-users.json');
const SECURITY_FILE = path.join(SOMA_DIR, 'studio-security.json');
const SECRET_FILE = path.join(SOMA_DIR, 'studio-auth-secret.txt');
const LOCAL_OWNER_TRUST_FILE = path.join(SOMA_DIR, 'studio-local-owner.trust');

function readText(file, fallback = '') {
    try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

function readJson(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

export function studioAuthSecret() {
    const configured = String(process.env.STUDIO_AUTH_SECRET || '').trim();
    if (configured.length >= 32) return configured;
    const existing = readText(SECRET_FILE).trim();
    if (existing.length >= 32) return existing;
    fs.mkdirSync(SOMA_DIR, { recursive: true });
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(SECRET_FILE, generated);
    return generated;
}

export function signStudioPayload(payload) {
    return crypto.createHmac('sha256', studioAuthSecret()).update(String(payload || '')).digest('base64url');
}

export function hashStudioAudit(value = '') {
    const clean = String(value || '').trim();
    return clean ? crypto.createHmac('sha256', studioAuthSecret()).update(clean).digest('hex') : '';
}

export function studioBearerToken(req) {
    const auth = String(req?.headers?.authorization || '');
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
    return String(req?.headers?.['x-studio-session'] || req?.query?.session || '').trim();
}

export function verifyStudioSessionToken(token = '', { touch = true } = {}) {
    try {
        const [payload, signature] = String(token || '').split('.');
        if (!payload || !signature) return null;
        const expected = signStudioPayload(payload);
        if (expected.length !== signature.length) return null;
        if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (data.kind !== 'studio-session' || !data.userId || Number(data.exp || 0) < Date.now()) return null;
        const db = readJson(SESSIONS_FILE, { sessions: [] });
        const session = (db.sessions || []).find(item =>
            item.sessionId === data.sessionId &&
            item.userId === data.userId &&
            !item.revokedAt &&
            Number(item.expiresAt || 0) >= Date.now()
        );
        if (!session) return null;
        if (touch && Date.now() - Number(session.lastSeenAt || 0) > 30_000) {
            session.lastSeenAt = Date.now();
            writeJson(SESSIONS_FILE, db);
        }
        return {
            ...data,
            deviceId: session.deviceId || data.deviceId || '',
            sessionId: session.sessionId,
            riskFlags: Array.isArray(session.riskFlags) ? session.riskFlags : [],
        };
    } catch {
        return null;
    }
}

export function isTrustedStudioLocalRequest(req, { allowLan = true } = {}) {
    if (process.env.STUDIO_STRICT_AUTH === '1' || process.env.STUDIO_TRUST_LOCAL_DEV === '0') return false;
    const enabled = process.env.STUDIO_TRUST_LOCAL_DEV === '1' || readText(LOCAL_OWNER_TRUST_FILE).trim() === 'trusted-local-owner';
    if (!enabled) return false;
    const remote = [req?.ip, req?.socket?.remoteAddress, req?.connection?.remoteAddress, req?.headers?.host, req?.headers?.['x-forwarded-for']]
        .filter(Boolean)
        .join(' ');
    const isLoopback = /(^|[\s:\[])(127\.0\.0\.1|::1|localhost)([\s:\]]|$)/i.test(remote);
    if (isLoopback) return true;
    if (allowLan) {
        return /(^|[\s:\[])(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|169\.254\.)/i.test(remote);
    }
    return false;
}

export function studioSessionActor(req, { enforceDevice = true } = {}) {
    const session = verifyStudioSessionToken(studioBearerToken(req));
    if (!session) return null;
    const presentedDevice = String(req?.headers?.['x-studio-device-id'] || '').trim();
    if (enforceDevice && session.deviceId && presentedDevice !== session.deviceId) return null;
    const registry = readJson(USERS_FILE, { users: {} });
    const registered = Object.values(registry.users || {}).find(user => user.userId === session.userId) || {};
    const stored = studioUsers.get(session.userId) || {};
    const security = readJson(SECURITY_FILE, { bannedUsers: [] });
    const banned = (security.bannedUsers || []).some(item => item.userId === session.userId && !item.revokedAt);
    if (banned) return null;
    return {
        userId: session.userId,
        id: session.userId,
        handle: registered.handle || session.handle || stored.handle || '',
        userName: registered.displayName || session.displayName || stored.name || session.userId,
        displayName: registered.displayName || session.displayName || stored.name || session.userId,
        name: registered.displayName || session.displayName || stored.name || session.userId,
        userColor: stored.color || 'violet',
        color: stored.color || 'violet',
        avatar: stored.avatar || '',
        trustTier: registered.trustTier || stored.trustTier || 'UNKNOWN',
        ageBand: registered.ageBand || stored.ageBand || 'unknown',
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        riskFlags: session.riskFlags,
        authenticated: true,
    };
}

export function requireStudioSession({ allowTrustedLocal = true } = {}) {
    return (req, res, next) => {
        const actor = studioSessionActor(req);
        if (actor) {
            req.studioActor = actor;
            req.axisUser = actor;
            return next();
        }
        if (allowTrustedLocal && isTrustedStudioLocalRequest(req)) {
            const id = String(req.headers?.['x-axis-user-id'] || 'local-owner').trim();
            req.axisUser = {
                userId: id,
                id,
                userName: String(req.headers?.['x-axis-user-name'] || (id === 'local-owner' ? 'Local Owner' : id)),
                displayName: String(req.headers?.['x-axis-user-name'] || (id === 'local-owner' ? 'Local Owner' : id)),
                userColor: String(req.headers?.['x-axis-user-color'] || 'violet'),
                color: String(req.headers?.['x-axis-user-color'] || 'violet'),
                trustedLocal: true,
            };
            return next();
        }
        return res.status(401).json({
            ok: false,
            error: 'A signed, device-bound Studio session is required.',
            code: 'STUDIO_SESSION_REQUIRED',
        });
    };
}
