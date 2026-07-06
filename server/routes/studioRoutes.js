import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import socialImageLibrary from '../social/SocialImageLibrary.js';
import axisProfileStore from '../axis/AxisProfileStore.js';
import studioComments from '../studio/StudioCommentsStore.js';
import studioFeed from '../studio/StudioFeedStore.js';
import studioFollows from '../studio/StudioFollowStore.js';
import studioSignals from '../studio/StudioSignalsStore.js';
import studioPathways from '../studio/StudioPathwaysStore.js';
import studioUsers from '../studio/StudioUsersStore.js';
import studioNotifications from '../studio/StudioNotificationsStore.js';
import maxwellAgent from '../studio/MaxwellAgent.js';
import somaStudioAgent from '../studio/SomaStudioAgent.js';
import { reasonGrounded } from '../context/GroundedReasoning.js';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');
const USER_MD = path.join(SOMA_DIR, 'user.md');
const USER_REGISTRY_FILE = path.join(SOMA_DIR, 'studio-users.json');
const STUDIO_SESSIONS_FILE = path.join(SOMA_DIR, 'studio-sessions.json');
const STUDIO_RISK_EVENTS_FILE = path.join(SOMA_DIR, 'studio-risk-events.json');
const STUDIO_PAIRING_FILE = path.join(SOMA_DIR, 'studio-pairing.json');
const STUDIO_SECURITY_FILE = path.join(SOMA_DIR, 'studio-security.json');
const STUDIO_SETTINGS_FILE = path.join(SOMA_DIR, 'studio-settings.json');
const LOCAL_OWNER_TRUST_FILE = path.join(SOMA_DIR, 'studio-local-owner.trust');
const STUDIO_UPLOAD_DIR = path.join(SOMA_DIR, '.tmp', 'studio-uploads');
const SIGNAL_VIDEO_LIMIT = 512 * 1024 * 1024;
const PAIRING_TTL_MS = 2 * 60 * 1000;
const STUDIO_RATE_BUCKETS = new Map();
const require = createRequire(import.meta.url);
const multer = require('multer');
const RESERVED_USERNAMES = new Set([
    'admin', 'administrator', 'root', 'system', 'support', 'staff', 'moderator', 'mod',
    'soma', 'axis', 'studio', 'commandbridge', 'command_bridge', 'bridge', 'official',
    'api', 'bot', 'null', 'undefined', 'deleted', 'anonymous', 'anon', 'user',
]);

const upload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            fs.mkdirSync(STUDIO_UPLOAD_DIR, { recursive: true });
            cb(null, STUDIO_UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
            const safeBase = path.basename(file.originalname || 'studio-image', ext)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 60) || 'studio-image';
            cb(null, `${Date.now()}-${safeBase}${ext}`);
        },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
});

const signalVideoUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            fs.mkdirSync(STUDIO_UPLOAD_DIR, { recursive: true });
            cb(null, STUDIO_UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
            const ext = path.extname(file.originalname || '').toLowerCase() || '.mp4';
            const safeBase = path.basename(file.originalname || 'studio-signal', ext)
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 60) || 'studio-signal';
            cb(null, `${Date.now()}-${safeBase}${ext}`);
        },
    }),
    limits: { fileSize: SIGNAL_VIDEO_LIMIT },
    fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype || '').toLowerCase();
        const ext = path.extname(file.originalname || '').toLowerCase();
        const ok = mime.startsWith('video/') || ['.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv'].includes(ext);
        cb(ok ? null : new Error('Signals only accept video files.'), ok);
    },
});

const DEFAULT_PROFILE = {
    name: 'Barry',
        role: 'Builder / Operator',
        location: '',
        timezone: 'America/New_York',
        avatar: '',
        coverImage: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=1000&auto=format&fit=crop',
    bio: 'Building SOMA as an AI-first command bridge, trading lab, creative engine, and personal operating layer.',
    manifesto: 'Build useful systems. Help people. Make the work real.',
    goals: [
        'Make SOMA economically useful.',
        'Build Command Bridge into a serious operator console.',
        'Keep social, reflections, mission control, and Axis connected to one user identity.',
    ],
    preferences: {
        tone: 'Direct, honest, pragmatic, high-agency.',
        communication: 'Move fast, explain tradeoffs, avoid fluff.',
        autonomy: 'Prefer implementation over endless planning when risk is low.',
    },
    projects: [
        { name: 'SOMA Command Bridge', status: 'active', description: 'AI-first operating console for autonomy, trading, research, reflection, and communication.' },
        { name: 'Axis', status: 'planned', description: 'Directs, friends, workspaces, channels, and social coordination layer.' },
        { name: 'Studio', status: 'active', description: 'User profile and identity control layer powered by user.md.' },
    ],
    axis: {
        handle: 'barry',
        displayName: 'Barry',
        status: 'building',
        friends: [],
        spaces: [],
    },
    publicIdentity: {
        tagline: 'Building SOMA in public.',
        topics: ['AI systems', 'trading simulation', 'creative tools', 'medical discovery process', 'autonomous agents'],
    },
    widgets: ['profile', 'goals', 'projects', 'axis', 'portfolio', 'preferences'],
    studio: {
        widgets: null,
        navTheme: { style: 'ISLAND', color: '#ffffff', scale: 1 },
        portfolio: [],
        chats: [],
        identityChip: {
            accentColor: '#8b5cf6',
            badge: 'Builder',
            cardStyle: 'glass',
            visibleFields: { handle: true, role: true, location: true, activity: true, spaces: true },
        },
    },
};

const DEFAULT_AXIS_CHATS = [
    { id: 'axis-erin', title: 'Erin', image: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', members: '', messagesCount: '4+ new messages', status: 'active', online: true },
    { id: 'axis-jon', title: 'Jon Doliveira', image: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', members: '', messagesCount: '4 new messages', status: 'active', online: false },
    { id: 'axis-damon', title: 'Damon Robinson', image: 'https://images.unsplash.com/photo-1599566150163-29194dcaad36?w=150', members: '', messagesCount: '4+ new messages', status: 'active', online: false },
    { id: 'axis-sunflower', title: 'Sunflower Samurai', image: 'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?w=150', members: '', messagesCount: '4+ new messages', status: 'active', online: true },
    { id: 'axis-garrett', title: 'Garrett', image: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150', members: '', messagesCount: '2 new messages', status: 'active', online: false },
    { id: 'axis-sarah', title: 'Sarah_V', image: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', members: '', messagesCount: 'Sent', status: 'active', online: true },
    { id: 'axis-kaito', title: 'Kaito', image: 'https://images.unsplash.com/photo-1528892952291-009c663ce843?w=150', members: '', messagesCount: 'Seen', status: 'active', online: false },
    { id: 'axis-neo', title: 'Neo_Tokyo', image: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=150', members: '', messagesCount: 'Typing...', status: 'active', online: true },
];

function seedAxisMessages(chat, profile) {
    const userAvatar = profile.avatar || DEFAULT_PROFILE.avatar;
    return [
        {
            id: `${chat.id}-m1`,
            sender: 'other',
            text: 'Hey, checking in through Axis.',
            timestamp: '10:30 AM',
            avatar: chat.image,
            createdAt: Date.now() - 600000,
        },
        {
            id: `${chat.id}-m2`,
            sender: 'user',
            text: 'Studio is wired as the temporary Axis hub now.',
            timestamp: '10:32 AM',
            avatar: userAvatar,
            createdAt: Date.now() - 500000,
        },
    ];
}

function ensureDir() {
    fs.mkdirSync(SOMA_DIR, { recursive: true });
}

function readFileSafe(file, fallback = '') {
    try {
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
    } catch {}
    return fallback;
}

function readJsonSafe(file, fallback) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    return fallback;
}

function writeJsonSafe(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function normalizeUsername(value = '') {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^@+/, '')
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24);
}

function hashSecret(secret = '', salt = crypto.randomBytes(16).toString('hex')) {
    const iterations = 100000;
    const digest = crypto.pbkdf2Sync(String(secret || ''), salt, iterations, 32, 'sha256').toString('hex');
    return `pbkdf2$${iterations}$${salt}$${digest}`;
}

function verifySecret(secret = '', stored = '') {
    const value = String(stored || '');
    if (/^[a-f0-9]{64}$/i.test(value)) {
        const legacy = crypto.createHash('sha256').update(String(secret || ''), 'utf8').digest('hex');
        return crypto.timingSafeEqual(Buffer.from(legacy), Buffer.from(value));
    }
    const parts = value.split('$');
    if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
    const iterations = Number(parts[1]) || 100000;
    const [, , salt, digest] = parts;
    const candidate = crypto.pbkdf2Sync(String(secret || ''), salt, iterations, 32, 'sha256').toString('hex');
    if (candidate.length !== digest.length) return false;
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(digest));
}

function isLegacySecretHash(stored = '') {
    return /^[a-f0-9]{64}$/i.test(String(stored || ''));
}

function createStudioUserId() {
    return `usr-${crypto.randomBytes(32).toString('hex')}`;
}

function isPortableStudioId(value = '') {
    return /^usr-[a-f0-9]{64}$/i.test(String(value || ''));
}

function base64url(value) {
    return Buffer.from(value).toString('base64url');
}

function authSecret() {
    const envSecret = String(process.env.STUDIO_AUTH_SECRET || '').trim();
    if (envSecret.length >= 32) return envSecret;
    const file = path.join(SOMA_DIR, 'studio-auth-secret.txt');
    const existing = readFileSafe(file, '').trim();
    if (existing.length >= 32) return existing;
    ensureDir();
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, generated);
    return generated;
}

function signPayload(payload) {
    return crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url');
}

function hashForAudit(value = '') {
    const clean = String(value || '').trim();
    if (!clean) return '';
    return crypto.createHmac('sha256', authSecret()).update(clean).digest('hex');
}

function sessionRegistry() {
    const db = readJsonSafe(STUDIO_SESSIONS_FILE, { sessions: [] });
    return db && Array.isArray(db.sessions) ? db : { sessions: [] };
}

function riskEventRegistry() {
    const db = readJsonSafe(STUDIO_RISK_EVENTS_FILE, { events: [] });
    return db && Array.isArray(db.events) ? db : { events: [] };
}

function pairingRegistry() {
    const db = readJsonSafe(STUDIO_PAIRING_FILE, { pairings: [] });
    return db && Array.isArray(db.pairings) ? db : { pairings: [] };
}

function securityRegistry() {
    const db = readJsonSafe(STUDIO_SECURITY_FILE, {
        bannedUsers: [],
        ipBlocks: [],
        directScans: [],
        counters: {},
    });
    return {
        bannedUsers: Array.isArray(db.bannedUsers) ? db.bannedUsers : [],
        ipBlocks: Array.isArray(db.ipBlocks) ? db.ipBlocks : [],
        directScans: Array.isArray(db.directScans) ? db.directScans : [],
        counters: db.counters && typeof db.counters === 'object' ? db.counters : {},
    };
}

function defaultStudioSettings() {
    return {
        account: {
            displayName: '',
            bio: '',
            pronouns: '',
        },
        security: {
            trustedPairing: 'lan_approval',
            cameraVerification: true,
            securityReviewQueue: true,
        },
        privacy: {
            privateMode: false,
            whoCanDirect: 'everyone',
            discoverable: true,
            minorProtection: true,
        },
        ai: {
            somaActive: true,
            autoLabelAi: true,
            botDisclosure: true,
            recommendationPersonalization: false,
        },
        media: {
            autoplaySignals: 'wifi',
            downloadQuality: '1080p',
            brainrotAudio: true,
        },
        localDevice: {
            notifications: true,
            haptics: true,
            theme: 'system',
        },
        updatedAt: Date.now(),
    };
}

function studioSettingsRegistry() {
    const defaults = defaultStudioSettings();
    const db = readJsonSafe(STUDIO_SETTINGS_FILE, defaults);
    const merged = { ...defaults, ...(db && typeof db === 'object' ? db : {}) };
    for (const key of ['account', 'security', 'privacy', 'ai', 'media', 'localDevice']) {
        merged[key] = {
            ...(defaults[key] || {}),
            ...((db && typeof db[key] === 'object' && !Array.isArray(db[key])) ? db[key] : {}),
        };
    }
    merged.updatedAt = Number(merged.updatedAt || 0) || Date.now();
    return merged;
}

function sanitizeSettingsPatch(scope, patch) {
    const allowed = {
        account: ['displayName', 'bio', 'pronouns'],
        security: ['trustedPairing', 'cameraVerification', 'securityReviewQueue'],
        privacy: ['privateMode', 'whoCanDirect', 'discoverable', 'minorProtection'],
        ai: ['somaActive', 'autoLabelAi', 'botDisclosure', 'recommendationPersonalization'],
        media: ['autoplaySignals', 'downloadQuality', 'brainrotAudio'],
        localDevice: ['notifications', 'haptics', 'theme'],
    };
    if (!allowed[scope]) return null;
    const clean = {};
    const input = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
    for (const key of allowed[scope]) {
        if (!(key in input)) continue;
        const value = input[key];
        if (typeof value === 'boolean') clean[key] = value;
        else clean[key] = String(value ?? '').trim().slice(0, 240);
    }
    return clean;
}

function mergeStudioSettings(current, input = {}) {
    const next = studioSettingsRegistry();
    Object.assign(next, current || {});
    const scopes = input.scope
        ? { [String(input.scope)]: input.patch || {} }
        : (input.settings && typeof input.settings === 'object' ? input.settings : input);
    for (const [scope, patch] of Object.entries(scopes || {})) {
        const clean = sanitizeSettingsPatch(scope, patch);
        if (!clean) continue;
        next[scope] = { ...(next[scope] || {}), ...clean };
    }
    next.updatedAt = Date.now();
    return next;
}

function publicStudioSettingsPayload(actor = null) {
    const settings = studioSettingsRegistry();
    const profile = loadProfile();
    const user = actor ? publicIdentityUser(actor) : null;
    const storedUser = actor ? (studioUsers.get(actor.userId) || {}) : {};
    const verification = actor ? verificationStatusFor({ ...storedUser, ...actor, id: actor.userId }) : null;
    const nowMs = Date.now();
    const sessions = actor ? sessionRegistry().sessions
        .filter(item => item.userId === actor.userId && Number(item.expiresAt || 0) > nowMs)
        .sort((a, b) => Number(b.lastSeenAt || b.createdAt || 0) - Number(a.lastSeenAt || a.createdAt || 0))
        .slice(0, 10)
        .map(publicDeviceSession) : [];
    const riskEvents = actor ? riskEventRegistry().events
        .filter(item => item.userId === actor.userId)
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
        .slice(0, 20) : [];
    return { ok: true, settings, profile, user, verification, devices: sessions, riskEvents };
}

function writeSecurityRegistry(db) {
    writeJsonSafe(STUDIO_SECURITY_FILE, {
        bannedUsers: (db.bannedUsers || []).slice(-5000),
        ipBlocks: (db.ipBlocks || []).slice(-5000),
        directScans: (db.directScans || []).slice(-10000),
        counters: db.counters || {},
    });
}

function writePairingRegistry(db) {
    db.pairings = (Array.isArray(db.pairings) ? db.pairings : [])
        .filter(item => Number(item.expiresAt || 0) > Date.now() - 60 * 60 * 1000)
        .slice(-1000);
    writeJsonSafe(STUDIO_PAIRING_FILE, db);
}

function recordRiskEvent(event = {}) {
    const db = riskEventRegistry();
    db.events.push({
        id: `risk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
        ...event,
    });
    db.events = db.events.slice(-2000);
    writeJsonSafe(STUDIO_RISK_EVENTS_FILE, db);
}

function deviceInfoFromReq(req) {
    const body = req.body || {};
    const userAgent = String(req.headers?.['user-agent'] || '');
    const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = forwarded || req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '';
    const deviceId = String(body.deviceId || req.headers?.['x-studio-device-id'] || '').trim() || `dev-${crypto.randomBytes(16).toString('hex')}`;
    return {
        deviceId,
        deviceName: String(body.deviceName || req.headers?.['x-studio-device-name'] || '').trim().slice(0, 80) || 'Unknown device',
        deviceType: String(body.deviceType || req.headers?.['x-studio-device-type'] || '').trim().slice(0, 40) || 'unknown',
        ipHash: hashForAudit(ip),
        userAgentHash: hashForAudit(userAgent),
    };
}

function requestIpHash(req) {
    return deviceInfoFromReq(req || {}).ipHash;
}

function securityRateLimit(req, res, next) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    const pathname = String(req.originalUrl || req.url || '');
    const ipHash = requestIpHash(req);
    const session = verifySessionToken(bearerToken(req));
    const actorId = session?.userId || 'anonymous';
    const routeClass = /\/identity\/(login|register|pairing)/.test(pathname)
        ? 'identity'
        : /\/upload|\/signals\/upload|\/featured\/upload/.test(pathname)
            ? 'upload'
            : 'write';
    const policy = routeClass === 'identity'
        ? { windowMs: 10 * 60 * 1000, limit: 40 }
        : routeClass === 'upload'
            ? { windowMs: 60 * 60 * 1000, limit: 80 }
            : { windowMs: 60 * 1000, limit: 180 };
    const key = `${routeClass}:${actorId}:${ipHash}`;
    const nowMs = Date.now();
    const bucket = STUDIO_RATE_BUCKETS.get(key) || { count: 0, resetAt: nowMs + policy.windowMs };
    if (bucket.resetAt <= nowMs) {
        bucket.count = 0;
        bucket.resetAt = nowMs + policy.windowMs;
    }
    bucket.count += 1;
    STUDIO_RATE_BUCKETS.set(key, bucket);
    if (STUDIO_RATE_BUCKETS.size > 5000) {
        for (const [bucketKey, value] of STUDIO_RATE_BUCKETS) {
            if (value.resetAt <= nowMs) STUDIO_RATE_BUCKETS.delete(bucketKey);
        }
    }
    if (bucket.count > policy.limit) {
        recordRiskEvent({
            userId: session?.userId || '',
            sessionId: session?.sessionId || '',
            type: 'rate_limit_triggered',
            severity: 'medium',
            riskFlags: [`${routeClass}_rate_limit`],
            deviceId: session?.deviceId || '',
            deviceType: routeClass,
        });
        return res.status(429).json({ ok: false, error: 'Studio security rate limit reached.', retryAfterMs: bucket.resetAt - nowMs });
    }
    return next();
}

function isUserBanned(userId = '') {
    if (!userId) return false;
    return securityRegistry().bannedUsers.some(item => item.userId === userId && !item.revokedAt);
}

function activeIpBlock(ipHash = '') {
    if (!ipHash) return null;
    const nowMs = Date.now();
    return securityRegistry().ipBlocks.find(item => item.ipHash === ipHash && !item.revokedAt && (!item.expiresAt || Number(item.expiresAt) > nowMs)) || null;
}

function studioSecurityGateway(req, res, next) {
    const ipBlock = activeIpBlock(requestIpHash(req));
    if (ipBlock) return res.status(403).json({ ok: false, error: 'Studio access is blocked from this network risk source.' });
    const session = verifySessionToken(bearerToken(req));
    if (session?.userId && isUserBanned(session.userId)) {
        return res.status(403).json({ ok: false, error: 'Studio account is banned for confirmed platform abuse.' });
    }
    return securityRateLimit(req, res, next);
}

function createPairingCode() {
    return String(crypto.randomInt(100000, 1000000));
}

function codeHash(pairingId, code) {
    return hashForAudit(`${pairingId}:${String(code || '').trim()}`);
}

function publicPairing(pairing = {}) {
    return {
        pairingId: pairing.pairingId,
        userId: pairing.userId,
        mode: pairing.mode || 'lan',
        status: pairing.status || 'pending',
        createdAt: pairing.createdAt,
        expiresAt: pairing.expiresAt,
        requestedAt: pairing.requestedAt || null,
        approvedAt: pairing.approvedAt || null,
        completedAt: pairing.completedAt || null,
        starterDeviceId: pairing.starterDeviceId || '',
        phoneDevice: pairing.phoneDevice ? publicDeviceSession({
            sessionId: '',
            userId: pairing.userId,
            ...pairing.phoneDevice,
        }) : null,
    };
}

function createDeviceSession(user, req, deviceOverride = null) {
    const db = sessionRegistry();
    const userId = user.userId || user.id;
    const nowMs = Date.now();
    const device = deviceOverride || deviceInfoFromReq(req || {});
    const active = db.sessions.filter(item => item.userId === userId && !item.revokedAt && Number(item.expiresAt || 0) > nowMs);
    const recentNewDevices = active.filter(item => item.deviceId !== device.deviceId && nowMs - Number(item.createdAt || 0) < 24 * 60 * 60 * 1000);
    const riskFlags = [];
    if (recentNewDevices.length >= 3) riskFlags.push('many_new_devices_24h');
    if (active.some(item => item.deviceId === device.deviceId && item.userAgentHash && item.userAgentHash !== device.userAgentHash)) riskFlags.push('device_fingerprint_changed');

    const session = {
        sessionId: `sess-${crypto.randomBytes(24).toString('hex')}`,
        userId,
        handle: user.handle || '',
        displayName: user.displayName || user.name || '',
        ...device,
        createdAt: nowMs,
        lastSeenAt: nowMs,
        expiresAt: nowMs + 1000 * 60 * 60 * 24 * 30,
        revokedAt: null,
        riskFlags,
    };
    db.sessions.push(session);
    db.sessions = db.sessions.slice(-5000);
    writeJsonSafe(STUDIO_SESSIONS_FILE, db);

    recordRiskEvent({
        userId,
        sessionId: session.sessionId,
        type: 'device_session_created',
        severity: riskFlags.length ? 'medium' : 'info',
        riskFlags,
        deviceId: session.deviceId,
        deviceType: session.deviceType,
    });
    return session;
}

function publicDeviceSession(session = {}) {
    return {
        sessionId: session.sessionId,
        userId: session.userId,
        deviceId: session.deviceId,
        deviceName: session.deviceName,
        deviceType: session.deviceType,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt || null,
        riskFlags: Array.isArray(session.riskFlags) ? session.riskFlags : [],
    };
}

function issueSession(user, req, deviceOverride = null) {
    const nowMs = Date.now();
    const session = createDeviceSession(user, req, deviceOverride);
    const payload = base64url(JSON.stringify({
        kind: 'studio-session',
        userId: user.userId || user.id,
        handle: user.handle,
        displayName: user.displayName || user.name,
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        iat: nowMs,
        exp: session.expiresAt,
    }));
    return { token: `${payload}.${signPayload(payload)}`, session: publicDeviceSession(session) };
}

function verifySessionToken(token = '') {
    const [payload, signature] = String(token || '').split('.');
    if (!payload || !signature) return null;
    const expected = signPayload(payload);
    if (expected.length !== signature.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.kind !== 'studio-session' || !data.userId || Number(data.exp || 0) < Date.now()) return null;
    if (data.sessionId) {
        const db = sessionRegistry();
        const session = db.sessions.find(item => item.sessionId === data.sessionId && item.userId === data.userId);
        if (!session || session.revokedAt || Number(session.expiresAt || 0) < Date.now()) return null;
        session.lastSeenAt = Date.now();
        writeJsonSafe(STUDIO_SESSIONS_FILE, db);
        data.deviceId = session.deviceId;
        data.sessionId = session.sessionId;
        data.riskFlags = session.riskFlags || [];
    }
    return data;
}

function bearerToken(req) {
    const auth = String(req.headers?.authorization || '');
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
    return String(req.headers?.['x-studio-session'] || '').trim();
}

function isTrustedLocalRequest(req) {
    if (process.env.STUDIO_STRICT_AUTH === '1' || process.env.STUDIO_TRUST_LOCAL_DEV === '0') return false;
    const localOwnerTrust = process.env.STUDIO_TRUST_LOCAL_DEV === '1' || readFileSafe(LOCAL_OWNER_TRUST_FILE, '').trim() === 'trusted-local-owner';
    if (!localOwnerTrust) return false;
    const remote = [
        req.ip,
        req.socket?.remoteAddress,
        req.connection?.remoteAddress,
        req.headers?.host,
    ].filter(Boolean).join(' ');
    return /(^|[\s:\[])(127\.0\.0\.1|::1|localhost)([\s:\]]|$)/i.test(remote);
}

function actorFromProfile(profile) {
    const userId = profile.axis?.userId || profile.studio?.identity?.userId || '';
    if (!userId) return null;
    return actorWithSafety({
        userId,
        id: userId,
        handle: normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name) || 'barry',
        displayName: profile.axis?.displayName || profile.name || 'Barry',
        name: profile.axis?.displayName || profile.name || 'Barry',
        avatar: profile.avatar || '',
        color: profile.axis?.color || 'violet',
        localOwner: Boolean(profile.studio?.identity?.localOwner),
        trustTier: profile.studio?.identity?.trustTier || 'ADULT_VERIFIED',
        ageBand: profile.studio?.identity?.ageBand || 'adult',
    });
}

function ensureLocalOwnerIdentity(profile = loadProfile()) {
    const existingId = profile.axis?.userId || profile.studio?.identity?.userId || '';
    const userId = isPortableStudioId(existingId) ? existingId : createStudioUserId();
    const handle = normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name || 'barry') || 'barry';
    const displayName = String(profile.axis?.displayName || profile.name || 'Barry').trim() || 'Barry';
    const registry = usernameRegistry();
    const current = registry.users[handle] || {};
    const profileReady =
        profile.axis?.userId === userId &&
        normalizeUsername(profile.axis?.handle) === handle &&
        profile.axis?.displayName === displayName &&
        profile.studio?.identity?.registered === true &&
        profile.studio?.identity?.localOwner === true &&
        profile.studio?.identity?.userId === userId;
    const registryReady =
        current.userId === userId &&
        current.handle === handle &&
        current.displayName === displayName &&
        current.localOwner === true;
    const person = studioUsers.get(userId);
    const personReady =
        person?.handle === handle &&
        person?.name === displayName &&
        person?.localOwner === true &&
        person?.verified === true;

    if (!registryReady) {
        registry.users[handle] = {
            ...current,
            userId,
            handle,
            displayName,
            localOwner: true,
            createdAt: current.createdAt || Date.now(),
            updatedAt: Date.now(),
        };
        writeJsonSafe(USER_REGISTRY_FILE, registry);
    }
    if (!personReady) {
        studioUsers.upsert({
            id: userId,
            handle,
            name: displayName,
            avatar: profile.avatar || '',
            bio: profile.bio || '',
            role: profile.role || 'Local owner',
            localOwner: true,
            verified: true,
            trustTier: 'ADULT_VERIFIED',
            ageBand: 'adult',
        });
    }
    if (profileReady) return profile;

    return saveProfile({
        ...profile,
        name: displayName,
        axis: {
            ...(profile.axis || {}),
            userId,
            handle,
            displayName,
            color: profile.axis?.color || 'violet',
            status: profile.axis?.status || 'online',
        },
        publicIdentity: {
            ...(profile.publicIdentity || {}),
            handle,
        },
        studio: {
            ...(profile.studio || {}),
            identity: {
                ...(profile.studio?.identity || {}),
                registered: true,
                localOwner: true,
                trustedLocal: true,
                trustTier: profile.studio?.identity?.trustTier || 'ADULT_VERIFIED',
                ageBand: profile.studio?.identity?.ageBand || 'adult',
                userId,
                handle,
                displayName,
                registeredAt: profile.studio?.identity?.registeredAt || Date.now(),
            },
        },
    });
}

function actorFromSession(req) {
    try {
        const session = verifySessionToken(bearerToken(req));
        if (!session) return null;
        const registered = Object.values(usernameRegistry().users || {}).find(user => user.userId === session.userId);
        const person = studioUsers.get(session.userId) || {};
        return actorWithSafety({
            userId: session.userId,
            id: session.userId,
            handle: registered?.handle || session.handle || person.handle || '',
            displayName: registered?.displayName || session.displayName || person.name || session.handle || session.userId,
            name: registered?.displayName || session.displayName || person.name || session.handle || session.userId,
            avatar: person.avatar || '',
            color: person.color || 'violet',
            trustTier: registered?.trustTier || person.trustTier || 'UNKNOWN',
            ageBand: registered?.ageBand || person.ageBand || 'unknown',
            sessionId: session.sessionId || '',
            deviceId: session.deviceId || '',
            riskFlags: session.riskFlags || [],
        });
    } catch {
        return null;
    }
}

function serviceActorFromBody(req) {
    if (!isTrustedLocalRequest(req)) return null;
    const body = req.body || {};
    const candidate = body.authorId || body.userId || body.who || body.followerId || '';
    if (!['usr-soma', 'usr-maxwell'].includes(candidate)) return null;
    const person = studioUsers.get(candidate);
    if (!person) return null;
    return actorWithSafety({
        userId: person.id,
        id: person.id,
        handle: person.handle,
        displayName: person.name,
        name: person.name,
        avatar: person.avatar || '',
        color: person.color || 'violet',
        serviceActor: true,
        trustTier: person.trustTier || 'ADULT_VERIFIED',
        ageBand: person.ageBand || 'adult',
    });
}

function actorFromAxisHeaders(req) {
    const id = String(req.headers?.['x-axis-user-id'] || '').trim();
    if (!id) return null;
    const registered = studioUsers.get(id);
    const name = String(req.headers?.['x-axis-user-name'] || '').trim() || registered?.name || 'Studio User';
    return actorWithSafety({
        userId: registered?.id || id,
        id: registered?.id || id,
        handle: registered?.handle || id,
        displayName: registered?.name || name,
        name: registered?.name || name,
        avatar: registered?.avatar || '',
        color: registered?.color || 'violet',
        trustTier: registered?.trustTier || 'UNKNOWN',
        ageBand: registered?.ageBand || 'unknown',
    });
}

function resolveActor(req, { allowServiceBody = false } = {}) {
    const sessionActor = actorFromSession(req);
    if (sessionActor) return sessionActor;
    const axisActor = actorFromAxisHeaders(req);
    if (axisActor) return axisActor;
    if (allowServiceBody) {
        const serviceActor = serviceActorFromBody(req);
        if (serviceActor) return serviceActor;
    }
    if (isTrustedLocalRequest(req)) return actorWithSafety(actorFromProfile(ensureLocalOwnerIdentity(loadProfile())));
    return null;
}

function requireActor(req, res, options = {}) {
    const actor = resolveActor(req, options);
    if (!actor) {
        res.status(401).json({ ok: false, error: 'Studio session required.' });
        return null;
    }
    if (isUserBanned(actor.userId || actor.id)) {
        res.status(403).json({ ok: false, error: 'Studio account is banned for confirmed platform abuse.' });
        return null;
    }
    if (!options.allowRestricted && isRestrictedActor(actor)) {
        res.status(423).json({ ok: false, error: 'Account is restricted pending safety review.' });
        return null;
    }
    return actor;
}

function publicIdentityUser(actor) {
    const accountType = normalizeAccountType(actor.accountType || (actor.agent ? 'bot' : 'human'));
    return {
        userId: actor.userId,
        studioId: actor.userId,
        handle: actor.handle,
        displayName: actor.displayName || actor.name,
        avatar: actor.avatar || '',
        color: actor.color || 'violet',
        localOwner: Boolean(actor.localOwner),
        trustTier: normalizeTrustTier(actor.trustTier),
        ageBand: normalizeAgeBand(actor.ageBand, actor.trustTier),
        accountType,
        agent: accountType === 'bot',
        botDisclosure: botDisclosureFor({ ...actor, accountType }),
    };
}

function normalizeAccountType(value = '') {
    const type = String(value || '').trim().toLowerCase();
    if (['bot', 'ai', 'agent', 'automation', 'automated'].includes(type)) return 'bot';
    if (['service', 'system'].includes(type)) return 'service';
    return 'human';
}

function botDisclosureFor(entity = {}) {
    const accountType = normalizeAccountType(entity.accountType || (entity.agent ? 'bot' : 'human'));
    if (accountType !== 'bot') return null;
    const existing = entity.botDisclosure && typeof entity.botDisclosure === 'object' ? entity.botDisclosure : {};
    return {
        required: true,
        label: existing.label || 'BOT',
        icon: existing.icon || '🤖',
        description: existing.description || 'Automated AI account.',
    };
}

const TRUST_TIERS = new Set([
    'UNKNOWN',
    'ADULT_UNVERIFIED',
    'ADULT_VERIFIED',
    'MINOR_VERIFIED',
    'MINOR_PROTECTED_U13',
]);

const PROTECTED_ALIAS_ADJECTIVES = [
    'amber', 'brave', 'calm', 'clear', 'cosmic', 'dawn', 'ember', 'gentle',
    'hidden', 'kind', 'lunar', 'maple', 'north', 'quiet', 'river', 'silver',
    'solar', 'steady', 'wild', 'winter',
];
const PROTECTED_ALIAS_NOUNS = [
    'anchor', 'atlas', 'bird', 'brook', 'comet', 'field', 'forest', 'harbor',
    'lantern', 'meadow', 'moon', 'path', 'pixel', 'stone', 'sun', 'trail',
    'valley', 'wave', 'willow', 'wind',
];

function normalizeTrustTier(value = '') {
    const tier = String(value || '').trim().toUpperCase();
    if (TRUST_TIERS.has(tier)) return tier;
    if (tier === 'VERIFIED') return 'ADULT_VERIFIED';
    if (tier === 'UNVERIFIED') return 'ADULT_UNVERIFIED';
    if (tier === 'MINOR' || tier === 'UNDER_18' || tier === '18_AND_UNDER') return 'MINOR_VERIFIED';
    return 'UNKNOWN';
}

function normalizeAgeBand(value = '', trustTier = '') {
    const band = String(value || '').trim().toLowerCase();
    if (['u13', 'under13', 'under_13'].includes(band)) return 'u13';
    if (['minor', 'under18', 'under_18', '13_17', 'teen'].includes(band)) return 'minor';
    if (['adult', '18plus', '18_plus', '18+'].includes(band)) return 'adult';
    const tier = normalizeTrustTier(trustTier);
    if (tier === 'UNKNOWN') return 'unknown';
    if (tier === 'MINOR_PROTECTED_U13') return 'u13';
    if (tier === 'MINOR_VERIFIED') return 'minor';
    return 'adult';
}

function safetyProfile(entity = {}) {
    const trustTier = normalizeTrustTier(entity.trustTier || entity.safety?.trustTier);
    const ageBand = normalizeAgeBand(entity.ageBand || entity.safety?.ageBand, trustTier);
    return {
        trustTier,
        ageBand,
        isUnknownAge: ageBand === 'unknown' || trustTier === 'UNKNOWN',
        isMinor: ageBand === 'minor' || ageBand === 'u13',
        isProtectedU13: ageBand === 'u13' || trustTier === 'MINOR_PROTECTED_U13',
        isVerified: trustTier === 'ADULT_VERIFIED' || trustTier === 'MINOR_VERIFIED' || trustTier === 'MINOR_PROTECTED_U13',
    };
}

function actorWithSafety(actor = {}) {
    const person = studioUsers.get(actor.userId || actor.id) || {};
    const safety = safetyProfile({
        trustTier: actor.trustTier || person.trustTier,
        ageBand: actor.ageBand || person.ageBand,
    });
    return {
        ...actor,
        trustTier: safety.trustTier,
        ageBand: safety.ageBand,
        verified: actor.verified ?? safety.isVerified,
        accountType: normalizeAccountType(actor.accountType || person.accountType || (actor.agent || person.agent ? 'bot' : 'human')),
        agent: Boolean(actor.agent || person.agent || normalizeAccountType(actor.accountType || person.accountType) === 'bot'),
        botDisclosure: botDisclosureFor(actor.botDisclosure ? actor : person),
        behaviorRisk: actor.behaviorRisk || person.behaviorRisk || null,
        visibilityLimited: Boolean(actor.visibilityLimited || person.visibilityLimited),
    };
}

function isRestrictedActor(actor = {}) {
    const person = studioUsers.get(actor.userId || actor.id) || {};
    const risk = actor.behaviorRisk || person.behaviorRisk || {};
    return Boolean(actor.visibilityLimited || person.visibilityLimited || risk.recommendation === 'restrict_and_review');
}

function canViewUser(viewer, target) {
    const viewerSafety = viewer ? safetyProfile(viewer) : { ageBand: 'unknown', isMinor: false, isProtectedU13: false };
    const targetSafety = safetyProfile(target);
    const viewerId = viewer?.userId || viewer?.id || '';
    const targetId = target?.userId || target?.id || '';
    if (viewerId && targetId && viewerId === targetId) return true;
    if (viewerSafety.isUnknownAge || targetSafety.isUnknownAge) return false;
    if (targetSafety.isMinor) {
        if (!viewer || !viewerSafety.isMinor) return false;
        if (viewerSafety.isProtectedU13 || targetSafety.isProtectedU13) {
            return viewerSafety.isProtectedU13 && targetSafety.isProtectedU13;
        }
        return true;
    }
    if (viewerSafety.isMinor) return false;
    return true;
}

function canInteractWithUser(viewer, target) {
    if (!viewer || !target) return false;
    return canViewUser(viewer, target) && canViewUser(target, viewer);
}

function userForSafetyLookup(userId) {
    return studioUsers.get(userId) || { id: userId, trustTier: 'UNKNOWN', ageBand: 'unknown' };
}

function canViewPost(viewer, post) {
    return canViewUser(viewer, {
        id: post.authorId,
        trustTier: post.authorTrustTier || post.trustTier || userForSafetyLookup(post.authorId).trustTier,
        ageBand: post.authorAgeBand || post.ageBand || userForSafetyLookup(post.authorId).ageBand,
    });
}

function canViewSignal(viewer, signal) {
    if (signal.visibility === 'Unlisted' && signal.authorId !== (viewer?.userId || viewer?.id)) return false;
    return canViewUser(viewer, {
        id: signal.authorId,
        trustTier: signal.authorTrustTier || signal.trustTier || userForSafetyLookup(signal.authorId).trustTier,
        ageBand: signal.authorAgeBand || signal.ageBand || userForSafetyLookup(signal.authorId).ageBand,
    });
}

function rankStudioFeedForViewer(viewer, posts = []) {
    const safety = viewer ? safetyProfile(viewer) : null;
    const viewerId = viewer?.userId || viewer?.id || '';
    const dislikedByViewer = posts.filter(post => viewerId && Array.isArray(post.dislikers) && post.dislikers.includes(viewerId));
    const authorDislikeCounts = new Map();
    const dislikedTerms = new Set();
    for (const post of dislikedByViewer) {
        if (post.authorId) authorDislikeCounts.set(post.authorId, (authorDislikeCounts.get(post.authorId) || 0) + 1);
        for (const term of textFingerprint(post.text).split(' ').filter(t => t.length >= 5).slice(0, 8)) dislikedTerms.add(term);
    }
    return posts
        .filter(post => canViewPost(viewer, post))
        .map(post => {
            const author = userForSafetyLookup(post.authorId);
            const authorSafety = safetyProfile({
                trustTier: post.authorTrustTier || author.trustTier,
                ageBand: post.authorAgeBand || author.ageBand,
            });
            const verifiedBoost = authorSafety.isVerified ? 1000 : 0;
            const minorSameSpaceBoost = safety?.isMinor && authorSafety.isMinor ? 2000 : 0;
            const directDislikePenalty = viewerId && Array.isArray(post.dislikers) && post.dislikers.includes(viewerId) ? 30 * 24 * 60 * 60 * 1000 : 0;
            const authorPenalty = Math.min(authorDislikeCounts.get(post.authorId) || 0, 5) * 12 * 60 * 60 * 1000;
            const topicMatches = textFingerprint(post.text).split(' ').filter(term => dislikedTerms.has(term)).length;
            const topicPenalty = Math.min(topicMatches, 3) * 6 * 60 * 60 * 1000;
            return { post, score: Number(post.createdAt || 0) + verifiedBoost + minorSameSpaceBoost - directDislikePenalty - authorPenalty - topicPenalty };
        })
        .sort((a, b) => b.score - a.score)
        .map(item => item.post);
}

function rankStudioSignalsForViewer(viewer, signals = []) {
    const safety = viewer ? safetyProfile(viewer) : null;
    const viewerId = viewer?.userId || viewer?.id || '';
    return signals
        .filter(signal => canViewSignal(viewer, signal))
        .map(signal => {
            const author = userForSafetyLookup(signal.authorId);
            const authorSafety = safetyProfile({
                trustTier: signal.authorTrustTier || author.trustTier,
                ageBand: signal.authorAgeBand || author.ageBand,
            });
            const verifiedBoost = authorSafety.isVerified ? 1000 : 0;
            const minorSameSpaceBoost = safety?.isMinor && authorSafety.isMinor ? 2000 : 0;
            const engagementBoost = Math.min(Number(signal.views || 0), 100000) * 3 + Math.min(Number(signal.likes || 0), 10000) * 20;
            const dislikePenalty = Math.min(Number(signal.dislikes || 0), 10000) * 30;
            const directDislikePenalty = viewerId && Array.isArray(signal.dislikers) && signal.dislikers.includes(viewerId) ? 30 * 24 * 60 * 60 * 1000 : 0;
            return {
                signal,
                score: Number(signal.createdAt || 0) + verifiedBoost + minorSameSpaceBoost + engagementBoost - dislikePenalty - directDislikePenalty,
            };
        })
        .sort((a, b) => b.score - a.score)
        .map(item => item.signal);
}

function filterUsersForViewer(viewer, users = []) {
    return users.filter(user => canViewUser(viewer, user));
}

function publicStudioUser(user = {}) {
    const accountType = normalizeAccountType(user.accountType || (user.agent ? 'bot' : 'human'));
    return {
        ...user,
        accountType,
        agent: accountType === 'bot',
        botDisclosure: botDisclosureFor({ ...user, accountType }),
        trustTier: normalizeTrustTier(user.trustTier),
        ageBand: normalizeAgeBand(user.ageBand, user.trustTier),
    };
}

function createProtectedPublicHandle(registry = usernameRegistry()) {
    for (let i = 0; i < 100; i += 1) {
        const adjective = PROTECTED_ALIAS_ADJECTIVES[crypto.randomInt(PROTECTED_ALIAS_ADJECTIVES.length)];
        const noun = PROTECTED_ALIAS_NOUNS[crypto.randomInt(PROTECTED_ALIAS_NOUNS.length)];
        const suffix = crypto.randomInt(1000, 9999);
        const handle = `${adjective}_${noun}_${suffix}`;
        if (!registry.users?.[handle] && !RESERVED_USERNAMES.has(handle)) return handle;
    }
    return `quiet_path_${Date.now().toString(36)}`;
}

function safetyAliasRequired(trustTier, ageBand) {
    const safety = safetyProfile({ trustTier, ageBand });
    return safety.isUnknownAge || safety.isMinor;
}

function textFingerprint(text = '') {
    return String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, 'URL').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function computeBehaviorRisk(userId) {
    const nowMs = Date.now();
    const feed = readJsonSafe(path.join(SOMA_DIR, 'studio-feed.json'), { posts: [] });
    const commentsDb = readJsonSafe(path.join(SOMA_DIR, 'studio-comments.json'), { posts: {} });
    const followsDb = readJsonSafe(path.join(SOMA_DIR, 'studio-follows.json'), { edges: [] });
    const securityDb = securityRegistry();
    const user = studioUsers.get(userId) || {};
    const posts = (feed.posts || []).filter(post => post.authorId === userId);
    const comments = Object.values(commentsDb.posts || {}).flat().filter(comment => comment.who === userId);
    const follows = (followsDb.edges || []).filter(edge => edge.follower === userId);
    const recentPosts = posts.filter(post => nowMs - Number(post.createdAt || 0) < 60 * 60 * 1000);
    const recentComments = comments.filter(comment => nowMs - Number(comment.createdAt || 0) < 60 * 60 * 1000);
    const recentFollows = follows.filter(edge => nowMs - Number(edge.ts || 0) < 60 * 60 * 1000);
    const texts = [...posts.map(post => post.text), ...comments.map(comment => comment.text)].map(textFingerprint).filter(Boolean);
    const uniqueTexts = new Set(texts);
    const duplicateRatio = texts.length ? 1 - (uniqueTexts.size / texts.length) : 0;
    const linkCount = texts.reduce((sum, text) => sum + ((text.match(/URL/g) || []).length), 0);
    const linkRatio = texts.length ? linkCount / texts.length : 0;
    const accountAgeHours = user.createdAt ? Math.max(0, (nowMs - Number(user.createdAt)) / 3600000) : null;
    const directScans = (securityDb.directScans || []).filter(scan => scan.senderUserId === userId);
    const directFlags = directScans.filter(scan => scan.verdict === 'flag').length;
    const directQuarantines = directScans.filter(scan => scan.verdict === 'quarantine' || scan.verdict === 'ban_recommend').length;
    const banned = securityDb.bannedUsers.some(item => item.userId === userId && !item.revokedAt);
    const flags = [];
    let score = 0;

    if (recentPosts.length >= 20) { score += 25; flags.push('high_post_velocity'); }
    if (recentComments.length >= 40) { score += 25; flags.push('high_comment_velocity'); }
    if (recentFollows.length >= 30) { score += 25; flags.push('follow_burst'); }
    if (texts.length >= 8 && duplicateRatio >= 0.55) { score += 20; flags.push('duplicate_text_pattern'); }
    if (texts.length >= 5 && linkRatio >= 0.45) { score += 20; flags.push('link_heavy_activity'); }
    if (accountAgeHours !== null && accountAgeHours < 24 && (posts.length + comments.length + follows.length) >= 50) {
        score += 15;
        flags.push('new_account_high_activity');
    }
    if (safetyProfile(user).isUnknownAge && (posts.length + comments.length + follows.length) >= 10) {
        score += 15;
        flags.push('unknown_age_social_activity');
    }
    if (directFlags >= 2) { score += 20; flags.push('direct_scam_flags'); }
    if (directQuarantines >= 1) { score += 35; flags.push('direct_scam_quarantine'); }
    if (directQuarantines >= 3) { score += 50; flags.push('repeated_direct_scam_quarantine'); }
    if (banned) { score = 100; flags.push('banned_for_confirmed_abuse'); }

    score = Math.min(100, score);
    return {
        userId,
        score,
        flags,
        riskTier: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low',
        recommendation: score >= 70
            ? 'restrict_and_review'
            : score >= 40
                ? 'rate_limit_and_monitor'
                : 'allow',
        metrics: {
            posts: posts.length,
            comments: comments.length,
            follows: follows.length,
            recentPosts: recentPosts.length,
            recentComments: recentComments.length,
            recentFollows: recentFollows.length,
            duplicateRatio,
            linkRatio,
            accountAgeHours,
            directFlags,
            directQuarantines,
        },
    };
}

function kevinSuspiciousTlds() {
    try {
        const db = readJsonSafe(path.join(process.cwd(), 'expertises', 'security', 'kevin', 'security-db.json'), {});
        return db.phishing_heuristics?.suspicious_tlds || ['.xyz', '.top', '.click', '.link', '.zip', '.gq', '.cf', '.tk', '.fit'];
    } catch {
        return ['.xyz', '.top', '.click', '.link', '.zip', '.gq', '.cf', '.tk', '.fit'];
    }
}

function scanDirectForScam(input = {}, req = {}) {
    const text = String(input.text || input.message || '').trim();
    const lower = text.toLowerCase();
    const hits = [];
    let score = 0;

    const rules = [
        { id: 'seed_phrase_or_private_key', score: 70, re: /\b(seed phrase|private key|recovery phrase|wallet phrase|12 words|24 words)\b/i },
        { id: 'guaranteed_returns', score: 45, re: /\b(guaranteed profit|guaranteed returns?|double your money|risk[- ]?free profit|100%\s+profit)\b/i },
        { id: 'gift_card_payment', score: 35, re: /\b(gift card|steam card|apple card|google play card|prepaid card)\b/i },
        { id: 'off_platform_pressure', score: 30, re: /\b(telegram|whatsapp|signal app|cashapp|venmo|zelle)\b/i },
        { id: 'urgent_financial_pressure', score: 25, re: /\b(urgent|act now|limited time|immediately|right now).{0,80}\b(pay|send|verify|deposit|transfer|wallet)\b/i },
        { id: 'credential_request', score: 45, re: /\b(password|passcode|login code|2fa|verification code|one[- ]?time code|otp)\b/i },
        { id: 'impersonation_support', score: 30, re: /\b(studio support|admin team|security department|account verification|your account will be suspended)\b/i },
        { id: 'minor_contact_pressure', score: 35, re: /\b(don't tell|keep this secret|send a pic|private photo|are you alone)\b/i },
    ];
    for (const rule of rules) {
        if (rule.re.test(text)) {
            score += rule.score;
            hits.push(rule.id);
        }
    }

    const urls = text.match(/https?:\/\/[^\s'"<>]+/gi) || [];
    if (urls.length >= 1) {
        score += Math.min(30, urls.length * 10);
        hits.push('contains_link');
    }
    const suspiciousTlds = kevinSuspiciousTlds();
    if (urls.some(url => {
        try {
            return suspiciousTlds.some(tld => new URL(url).hostname.toLowerCase().endsWith(tld));
        } catch {
            return false;
        }
    })) {
        score += 35;
        hits.push('suspicious_tld');
    }
    if (text.length > 400 && urls.length >= 2) {
        score += 20;
        hits.push('long_link_heavy_direct');
    }

    const senderUserId = String(input.senderUserId || input.authorId || input.userId || '').trim();
    const ipHash = requestIpHash(req);
    const verdict = score >= 120
        ? 'ban_recommend'
        : score >= 85
            ? 'quarantine'
            : score >= 45
                ? 'flag'
                : 'allow';
    return {
        id: `scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'direct_scam_scan',
        verdict,
        score: Math.min(150, score),
        riskTier: score >= 85 ? 'high' : score >= 45 ? 'medium' : 'low',
        hits,
        senderUserId,
        chatId: String(input.chatId || input.threadId || '').trim(),
        ipHash,
        textHash: hashForAudit(textFingerprint(text)),
        createdAt: Date.now(),
    };
}

function banStudioUser(userId, reason, evidence = {}) {
    if (!userId || ['usr-soma', 'usr-maxwell'].includes(userId)) return null;
    const db = securityRegistry();
    let ban = db.bannedUsers.find(item => item.userId === userId && !item.revokedAt);
    if (!ban) {
        ban = {
            userId,
            reason,
            evidence,
            createdAt: Date.now(),
            revokedAt: null,
        };
        db.bannedUsers.push(ban);
    }
    writeSecurityRegistry(db);

    const user = studioUsers.get(userId);
    if (user) {
        studioUsers.upsert({
            ...user,
            visibilityLimited: true,
            behaviorRisk: {
                ...(user.behaviorRisk || {}),
                score: 100,
                riskTier: 'high',
                flags: Array.from(new Set([...(user.behaviorRisk?.flags || []), 'confirmed_scam_or_fraud'])),
                recommendation: 'ban',
            },
            safetyFlags: Array.from(new Set([...(user.safetyFlags || []), 'confirmed_scam_or_fraud'])),
            bannedAt: Date.now(),
            banReason: reason,
        });
    }

    const sessions = sessionRegistry();
    let revoked = 0;
    for (const session of sessions.sessions) {
        if (session.userId === userId && !session.revokedAt) {
            session.revokedAt = Date.now();
            revoked += 1;
        }
    }
    if (revoked) writeJsonSafe(STUDIO_SESSIONS_FILE, sessions);
    recordRiskEvent({
        userId,
        sessionId: '',
        type: 'studio_user_banned',
        severity: 'critical',
        riskFlags: ['confirmed_scam_or_fraud'],
        deviceId: '',
        deviceType: 'account',
        evidence,
    });
    return ban;
}

function recordDirectSecurityScan(scan = {}, req = {}) {
    const db = securityRegistry();
    db.directScans.push(scan);
    const senderKey = scan.senderUserId || `ip:${scan.ipHash || requestIpHash(req)}`;
    const counter = db.counters[senderKey] || { directFlags: 0, directQuarantines: 0, directBanRecommendations: 0, lastAt: 0 };
    if (scan.verdict === 'flag') counter.directFlags += 1;
    if (scan.verdict === 'quarantine') counter.directQuarantines += 1;
    if (scan.verdict === 'ban_recommend') counter.directBanRecommendations += 1;
    counter.lastAt = Date.now();
    db.counters[senderKey] = counter;
    writeSecurityRegistry(db);

    recordRiskEvent({
        userId: scan.senderUserId || '',
        sessionId: '',
        type: 'direct_scam_scan',
        severity: scan.riskTier === 'high' ? 'high' : scan.riskTier === 'medium' ? 'medium' : 'info',
        riskFlags: scan.hits || [],
        deviceId: '',
        deviceType: 'direct',
        evidence: { scanId: scan.id, score: scan.score, verdict: scan.verdict },
    });

    if (scan.senderUserId && (scan.verdict === 'ban_recommend' || counter.directQuarantines >= 3 || counter.directBanRecommendations >= 1)) {
        banStudioUser(scan.senderUserId, 'confirmed_or_repeated_direct_scam_signals', { scanId: scan.id, counter });
    }
    return counter;
}

function publicSecurityScan(scan = {}) {
    return {
        id: scan.id,
        type: scan.type,
        verdict: scan.verdict,
        score: scan.score,
        riskTier: scan.riskTier,
        hits: scan.hits || [],
        senderUserId: scan.senderUserId || '',
        chatId: scan.chatId || '',
        createdAt: scan.createdAt,
    };
}

function verificationSecretOk(req) {
    const expected = String(process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET || '').trim();
    if (!expected) return false;
    const supplied = String(req.headers?.['x-studio-verification-secret'] || '').trim();
    if (supplied.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function platformAuthorityOk(req) {
    return isTrustedLocalRequest(req) || verificationSecretOk(req);
}

function rejectRawVerificationMedia(body = {}) {
    const forbidden = ['idImage', 'idPhoto', 'documentImage', 'selfie', 'selfieImage', 'faceImage', 'faceEmbedding', 'biometricTemplate'];
    const present = forbidden.filter(key => body[key] !== undefined && body[key] !== null && body[key] !== '');
    if (present.length) throw new Error(`Raw verification media is not accepted: ${present.join(', ')}`);
}

function verificationStatusFor(user = {}) {
    const safety = safetyProfile(user);
    const nowMs = Date.now();
    const expiresAt = Number(user.verificationExpiresAt || 0) || null;
    const expired = Boolean(expiresAt && expiresAt < nowMs);
    return {
        userId: user.id || user.userId,
        trustTier: safety.trustTier,
        ageBand: safety.ageBand,
        verified: safety.isVerified && !expired,
        required: safety.isUnknownAge || expired,
        expired,
        verifiedAt: user.verifiedAt || null,
        expiresAt,
        provider: user.verificationProvider || null,
        verificationRef: user.verificationRef || null,
        nextStep: safety.isUnknownAge
            ? 'age_or_identity_verification_required'
            : expired
                ? 'reverification_required'
                : 'none',
    };
}

function studioApiContract() {
    return {
        ok: true,
        version: 1,
        identity: {
            idFormat: 'usr-' + '<256-bit hex>',
            endpoints: {
                checkUsername: 'GET /api/studio/identity/check?username=...',
                register: 'POST /api/studio/identity/register',
                login: 'POST /api/studio/identity/login',
                session: 'GET /api/studio/identity/session',
                me: 'GET /api/studio/identity/me',
                devices: 'GET /api/studio/identity/devices',
                revokeDevice: 'DELETE /api/studio/identity/devices/:sessionId',
                riskEvents: 'GET /api/studio/identity/risk-events',
                startPairing: 'POST /api/studio/identity/pairing/start',
                requestPairing: 'POST /api/studio/identity/pairing/:pairingId/request',
                approvePairing: 'POST /api/studio/identity/pairing/:pairingId/approve',
                completePairing: 'POST /api/studio/identity/pairing/:pairingId/complete',
                pairingStatus: 'GET /api/studio/identity/pairing/:pairingId',
            },
            sessions: {
                deviceBound: true,
                rootTokenReturnedAfterRegistration: false,
                revocationSupported: true,
                sameNetworkPairing: true,
            },
        },
        settings: {
            sharedWithCommandBridge: true,
            localDeviceScope: true,
            endpoints: {
                read: 'GET /api/studio/settings',
                update: 'PUT /api/studio/settings',
            },
        },
        verification: {
            rawMediaAccepted: false,
            endpoints: {
                status: 'GET /api/studio/verification/status',
                attest: 'POST /api/studio/verification/attestation',
            },
        },
        transparency: {
            botsAllowed: true,
            botDisclosureRequired: true,
            endpoints: {
                disclosure: 'GET /api/studio/users/:id/disclosure',
                accountType: 'PUT /api/studio/users/:id/account-type',
            },
        },
        safety: {
            unknownAgeDefault: true,
            endpoints: {
                policy: 'GET /api/studio/safety/policy',
                audit: 'GET /api/studio/safety/audit',
                runAudit: 'POST /api/studio/safety/audit/run',
                setTier: 'PUT /api/studio/users/:id/safety',
            },
        },
        security: {
            gateway: true,
            directsScanned: true,
            ipBanPolicy: 'temporary_or_attack_infrastructure_only',
            endpoints: {
                status: 'GET /api/studio/security/status',
                directScan: 'POST /api/studio/security/directs/scan',
                banUser: 'POST /api/studio/security/users/:id/ban',
                unbanUser: 'POST /api/studio/security/users/:id/unban',
            },
        },
    };
}

function usernameRegistry() {
    const registry = readJsonSafe(USER_REGISTRY_FILE, { users: {} });
    if (!registry.users || typeof registry.users !== 'object') registry.users = {};
    return registry;
}

function collectReservedHandles(currentUserId = '') {
    const reserved = new Map();
    try {
        const profile = loadProfile();
        const handle = normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name);
        const userId = profile.axis?.userId || profile.studio?.identity?.userId || '';
        if (handle && userId && userId !== currentUserId) reserved.set(handle, userId);
    } catch {}
    return reserved;
}

function usernameStatus(username, currentUserId = '') {
    const handle = normalizeUsername(username);
    if (handle.length < 3) return { ok: true, available: false, handle, reason: 'Username must be at least 3 characters.' };
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(handle)) {
        return { ok: true, available: false, handle, reason: 'Use 3-24 characters: letters, numbers, underscore. Start with a letter.' };
    }
    if (RESERVED_USERNAMES.has(handle)) return { ok: true, available: false, handle, reason: 'That username is reserved.' };
    const registry = usernameRegistry();
    const takenBy = registry.users[handle]?.userId;
    if (takenBy && takenBy !== currentUserId) return { ok: true, available: false, handle, takenBy, reason: 'Username is taken.' };
    const reserved = collectReservedHandles(currentUserId);
    if (reserved.has(handle)) return { ok: true, available: false, handle, takenBy: reserved.get(handle), reason: 'Username is taken.' };
    return { ok: true, available: true, handle };
}

function section(markdown, title) {
    const escaped = String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i');
    return (markdown.match(re)?.[1] || '').trim();
}

function lines(value) {
    return String(value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(Boolean);
}

function keyValues(value) {
    const out = {};
    for (const line of lines(value)) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) out[match[1].trim().toLowerCase().replace(/\s+/g, '')] = match[2].trim();
    }
    return out;
}

function parseProjects(value) {
    return lines(value).map(line => {
        const [namePart, ...rest] = line.split(' - ');
        const name = namePart.replace(/^\[[^\]]+\]\s*/, '').trim();
        const status = (namePart.match(/^\[([^\]]+)\]/)?.[1] || 'active').trim();
        return { name, status, description: rest.join(' - ').trim() };
    }).filter(item => item.name);
}

function parseMarkdown(markdown) {
    if (!markdown.trim()) return { ...DEFAULT_PROFILE, rawMarkdown: renderMarkdown(DEFAULT_PROFILE), source: USER_MD };

    const identity = keyValues(section(markdown, 'Identity'));
    const prefs = keyValues(section(markdown, 'Preferences'));
    const axis = keyValues(section(markdown, 'Axis'));
    const publicIdentity = keyValues(section(markdown, 'Public Identity'));
    let studioState = DEFAULT_PROFILE.studio;
    try {
        const rawStudio = section(markdown, 'Studio State')
            .replace(/^```(?:json)?/i, '')
            .replace(/```$/i, '')
            .trim();
        if (rawStudio) studioState = { ...DEFAULT_PROFILE.studio, ...JSON.parse(rawStudio) };
    } catch {}

    return {
        ...DEFAULT_PROFILE,
        name: identity.name || DEFAULT_PROFILE.name,
        role: identity.role || DEFAULT_PROFILE.role,
        location: identity.location || DEFAULT_PROFILE.location,
        timezone: identity.timezone || DEFAULT_PROFILE.timezone,
        avatar: identity.avatar || DEFAULT_PROFILE.avatar,
        coverImage: identity.coverimage || identity.coverImage || DEFAULT_PROFILE.coverImage,
        bio: section(markdown, 'Bio') || DEFAULT_PROFILE.bio,
        manifesto: section(markdown, 'Manifesto') || DEFAULT_PROFILE.manifesto,
        goals: lines(section(markdown, 'Goals')).length ? lines(section(markdown, 'Goals')) : DEFAULT_PROFILE.goals,
        preferences: {
            ...DEFAULT_PROFILE.preferences,
            tone: prefs.tone || DEFAULT_PROFILE.preferences.tone,
            communication: prefs.communication || DEFAULT_PROFILE.preferences.communication,
            autonomy: prefs.autonomy || DEFAULT_PROFILE.preferences.autonomy,
        },
        projects: parseProjects(section(markdown, 'Projects')).length ? parseProjects(section(markdown, 'Projects')) : DEFAULT_PROFILE.projects,
        axis: {
            ...DEFAULT_PROFILE.axis,
            handle: axis.handle || DEFAULT_PROFILE.axis.handle,
            displayName: axis.displayname || axis.displayName || DEFAULT_PROFILE.axis.displayName,
            status: axis.status || DEFAULT_PROFILE.axis.status,
            userId: axis.userid || undefined,
            color: axis.color || undefined,
            friends: lines(section(markdown, 'Axis Friends')).filter(f => !f.startsWith('#')),
            spaces: lines(section(markdown, 'Axis Spaces')).filter(s => !s.startsWith('#')),
        },
        publicIdentity: {
            ...DEFAULT_PROFILE.publicIdentity,
            tagline: publicIdentity.tagline || DEFAULT_PROFILE.publicIdentity.tagline,
            topics: lines(section(markdown, 'Public Topics')).length ? lines(section(markdown, 'Public Topics')) : DEFAULT_PROFILE.publicIdentity.topics,
        },
        widgets: lines(section(markdown, 'Studio Widgets')).length ? lines(section(markdown, 'Studio Widgets')) : DEFAULT_PROFILE.widgets,
        studio: studioState,
        rawMarkdown: markdown,
        source: USER_MD,
    };
}

function bullet(items = []) {
    return (items || []).map(item => `- ${item}`).join('\n');
}

function renderMarkdown(profile = DEFAULT_PROFILE) {
    const p = { ...DEFAULT_PROFILE, ...(profile || {}) };
    return [
        '# User Profile',
        '',
        '## Identity',
        `Name: ${p.name || ''}`,
        `Role: ${p.role || ''}`,
        `Location: ${p.location || ''}`,
        `Timezone: ${p.timezone || ''}`,
        `Avatar: ${p.avatar || ''}`,
        `Cover Image: ${p.coverImage || ''}`,
        '',
        '## Bio',
        p.bio || '',
        '',
        '## Manifesto',
        p.manifesto || '',
        '',
        '## Goals',
        bullet(p.goals || []),
        '',
        '## Preferences',
        `Tone: ${p.preferences?.tone || ''}`,
        `Communication: ${p.preferences?.communication || ''}`,
        `Autonomy: ${p.preferences?.autonomy || ''}`,
        '',
        '## Projects',
        (p.projects || []).map(project => `- [${project.status || 'active'}] ${project.name || 'Project'} - ${project.description || ''}`).join('\n'),
        '',
        '## Axis',
        `Handle: ${p.axis?.handle || ''}`,
        `Display Name: ${p.axis?.displayName || p.name || ''}`,
        `Status: ${p.axis?.status || ''}`,
        `UserId: ${p.axis?.userId || ''}`,
        `Color: ${p.axis?.color || ''}`,
        '',
        '## Axis Friends',
        bullet(p.axis?.friends || []),
        '',
        '## Axis Spaces',
        bullet(p.axis?.spaces || []),
        '',
        '## Public Identity',
        `Tagline: ${p.publicIdentity?.tagline || ''}`,
        '',
        '## Public Topics',
        bullet(p.publicIdentity?.topics || []),
        '',
        '## Studio Widgets',
        bullet(p.widgets || DEFAULT_PROFILE.widgets),
        '',
        '## Studio State',
        '```json',
        JSON.stringify({
            ...(DEFAULT_PROFILE.studio || {}),
            ...(p.studio || {}),
        }, null, 2),
        '```',
        '',
    ].join('\n');
}

function loadProfile() {
    ensureDir();
    if (!fs.existsSync(USER_MD)) fs.writeFileSync(USER_MD, renderMarkdown(DEFAULT_PROFILE));
    return parseMarkdown(readFileSafe(USER_MD));
}

function saveProfile(profile) {
    ensureDir();
    const markdown = renderMarkdown(profile);
    fs.writeFileSync(USER_MD, markdown);
    return parseMarkdown(markdown);
}

function titleFromFilename(filename = 'Featured Work') {
    return path.basename(filename, path.extname(filename))
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, char => char.toUpperCase()) || 'Featured Work';
}

function portfolioItemFromSocialImage(image, overrides = {}) {
    const metadata = image.metadata && typeof image.metadata === 'object' ? image.metadata : {};
    const artDirector = image.artDirector || metadata.artDirector || {};
    const visualSubject = metadata.visualSubject || artDirector.visualSubject || {};
    const visualRecipe = metadata.visualRecipe || artDirector.visualRecipe || {};
    const selectedPalette = metadata.selectedPalette || artDirector.selectedPalette || [];
    const critique = metadata.critique || artDirector.critique || {};
    const similarity = metadata.similarity || artDirector.similarity || {};
    const title = String(overrides.title || image.title || titleFromFilename(image.filename)).trim();
    const category = String(overrides.category || (visualRecipe.name ? `SOMA ${String(visualRecipe.name).replace(/[-_]+/g, ' ')} Images` : 'SOMA Social Images')).trim();
    const evidence = [
        visualRecipe.name ? `Recipe: ${String(visualRecipe.name).replace(/[-_]+/g, ' ')}` : '',
        visualSubject.subject ? `Subject: ${visualSubject.subject}` : '',
        selectedPalette.length ? `Palette: ${selectedPalette.slice(0, 5).join(', ')}` : '',
        artDirector.score !== undefined ? `Art director score: ${artDirector.score}` : '',
        similarity.reason ? `Similarity: ${similarity.reason}` : '',
        critique.retryRecommended ? 'Critique requested a fresh variant.' : '',
    ].filter(Boolean).join(' | ');
    const description = String(overrides.description || [image.alt || 'Managed image available for SOMA social posts.', evidence].filter(Boolean).join('\n')).trim();
    const tags = Array.isArray(overrides.tags)
        ? overrides.tags
        : Array.isArray(image.tags) && image.tags.length
            ? image.tags
            : ['Social', 'Featured Work'];

    return {
        id: `social-${image.id}`,
        title,
        category,
        description,
        image: `/api/studio/featured/images/${image.id}/file`,
        year: new Date(image.createdAt || Date.now()).getFullYear().toString(),
        tags,
        stats: { views: 0, likes: 0 },
        socialImageId: image.id,
        socialPath: image.path,
        socialFilename: image.filename,
        useForSocial: true,
        source: 'soma-social-image-library',
        generationEvidence: {
            visualSubject,
            visualRecipe,
            selectedPalette,
            selectedMotifs: metadata.selectedMotifs || artDirector.selectedMotifs || [],
            promptSignature: metadata.promptSignature || artDirector.promptSignature || null,
            similarity,
            critique,
            artDirectorScore: artDirector.score,
            approved: artDirector.approved,
            provider: image.source || metadata.provider || null,
        },
    };
}

function mergePortfolioWithSocialImages(profile, socialImages) {
    const saved = Array.isArray(profile?.studio?.portfolio) ? profile.studio.portfolio : [];
    const seen = new Set(saved.map(item => item?.socialImageId || item?.socialPath || item?.id).filter(Boolean));
    const socialItems = socialImages
        .filter(image => !seen.has(image.id) && !seen.has(image.path) && !seen.has(`social-${image.id}`))
        .map(image => portfolioItemFromSocialImage(image));
    return [...saved, ...socialItems];
}

function normalizeAxisState(profile) {
    const studioAxis = profile?.studio?.axis || {};
    const now = Date.now();
    const chats = Array.isArray(studioAxis.chats) && studioAxis.chats.length
        ? studioAxis.chats
        : DEFAULT_AXIS_CHATS.map((chat, index) => ({
            ...chat,
            axisId: chat.id,
            updatedAt: now - index * 3600000,
        }));

    const messages = { ...(studioAxis.messages || {}) };
    for (const chat of chats) {
        if (!Array.isArray(messages[chat.id])) messages[chat.id] = seedAxisMessages(chat, profile);
    }

    const richFriends = Array.isArray(studioAxis.friends) && studioAxis.friends.length
        ? studioAxis.friends
        : chats.map(chat => ({
            id: chat.id,
            username: String(chat.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
            handle: String(chat.title || '').toLowerCase().replace(/\s+/g, '_'),
            avatar: chat.image,
            online: Boolean(chat.online),
            chatId: chat.id,
            status: 'friend',
        }));

    return {
        friends: richFriends,
        chats,
        messages,
        spaces: Array.isArray(studioAxis.spaces) ? studioAxis.spaces : [],
        updatedAt: studioAxis.updatedAt || now,
        source: 'studio-user-md-axis-hook',
    };
}

function saveAxisState(axisState) {
    const profile = loadProfile();
    return saveProfile({
        ...profile,
        studio: {
            ...(profile.studio || {}),
            axis: {
                ...axisState,
                updatedAt: Date.now(),
            },
        },
    });
}

function chatSummary(chat, messages = []) {
    const last = messages[messages.length - 1];
    return {
        ...chat,
        lastMessage: last?.text || chat.lastMessage || '',
        messagesCount: last?.text ? `${last.sender === 'user' ? 'Sent' : 'New'} - ${last.timestamp || ''}`.trim() : chat.messagesCount,
        updatedAt: last?.createdAt || chat.updatedAt || Date.now(),
    };
}

function profileContext(profile) {
    return [
        `User: ${profile.name} (${profile.role})`,
        `Bio: ${profile.bio}`,
        `Manifesto: ${profile.manifesto}`,
        `Goals: ${(profile.goals || []).join('; ')}`,
        `Tone: ${profile.preferences?.tone}`,
        `Communication: ${profile.preferences?.communication}`,
        `Autonomy: ${profile.preferences?.autonomy}`,
        `Projects: ${(profile.projects || []).map(p => `${p.name} [${p.status}]`).join('; ')}`,
        `Axis: @${profile.axis?.handle} / ${profile.axis?.status}`,
        `Public topics: ${(profile.publicIdentity?.topics || []).join(', ')}`,
    ].filter(Boolean).join('\n');
}

function resultText(result) {
    if (typeof result === 'string') return result;
    if (!result || typeof result !== 'object') return '';
    return result.response || result.message || result.text || result.content || result.answer || '';
}

const DEFAULT_COMMUNITIES = [
    { id: 'c-ai',       name: 'AI Builders',         icon: '🤖', description: 'Building with LLMs, agents, and neural nets.',               membersCount: 2100, image: 'https://images.unsplash.com/photo-1677442135703-1787eea5ce01?w=600', isJoined: false, category: 'Code',   tags: ['LLM', 'Agents', 'ML']       },
    { id: 'c-webgl',    name: 'WebGL Shaders',        icon: '🎨', description: 'Fragment shaders, raymarching, and generative art.',          membersCount: 1240, image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600', isJoined: false, category: 'Code',   tags: ['GLSL', 'ThreeJS', 'Art']    },
    { id: 'c-photo',    name: 'Analog Photography',   icon: '📷', description: 'Film is not dead. Grain, process, darkroom secrets.',         membersCount: 8540, image: 'https://images.unsplash.com/photo-1493863641943-9b68992a8d07?w=600', isJoined: false, category: 'Art',    tags: ['35mm', 'Darkroom']          },
    { id: 'c-cyber',    name: 'Cyberdeck Builders',   icon: '⚡', description: 'Custom hardware builds, deck aesthetics, portable computing.', membersCount: 3200, image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=600', isJoined: false, category: 'Tech',   tags: ['Hardware', 'Cyberpunk']     },
    { id: 'c-tokyo',    name: 'Tokyo Urbanists',      icon: '🌃', description: 'Mapping the neon streets and hidden alleys of the megacity.',  membersCount: 450,  image: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?w=600', isJoined: false, category: 'Travel', tags: ['Urban', 'Exploration']      },
    { id: 'c-music',    name: 'Music Production',     icon: '🎵', description: 'DAWs, synthesis, sampling, and sound design.',                membersCount: 1800, image: 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?w=600', isJoined: false, category: 'Music',  tags: ['DAW', 'Synthesis', 'Audio'] },
    { id: 'c-design',   name: 'Interface Design',     icon: '✦',  description: 'Typography, motion, interaction design, and tooling.',         membersCount: 960,  image: 'https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=600', isJoined: false, category: 'Design', tags: ['UI', 'Motion', 'Systems']   },
    { id: 'c-security', name: 'Offensive Security',   icon: '🔐', description: 'CTFs, red team, and security research.',                      membersCount: 670,  image: 'https://images.unsplash.com/photo-1614850523060-8da1d56ae167?w=600', isJoined: false, category: 'Tech',   tags: ['CTF', 'RedTeam', 'Exploit'] },
];

export default function createStudioRoutes(system = {}) {
    const router = express.Router();
    router.use(studioSecurityGateway);
    // Bring the resident agent users online — they follow you back, post, and engage.
    if (process.env.STUDIO_DISABLE_AGENTS !== '1') {
        try { maxwellAgent.start(); } catch (e) { console.warn('[Maxwell] failed to start:', e.message); }
        try { somaStudioAgent.start(); } catch (e) { console.warn('[SOMA/Studio] failed to start:', e.message); }
    }

    // Emit a notification for a recipient, resolving the actor's name/avatar.
    const notify = (userId, kind, actorId, text, targetId) => {
        try {
            if (!userId || userId === actorId) return;
            const actor = studioUsers.get(actorId) || {};
            studioNotifications.add({ userId, kind, actorId, actorName: actor.name || actorId, actorAvatar: actor.avatar || '', text, targetId: targetId || '' });
        } catch { /* notifications are best-effort */ }
    };

    router.get('/uploads/:name', (req, res) => {
        try {
            const name = path.basename(String(req.params.name || ''));
            if (!name) return res.status(404).end();
            const file = path.join(STUDIO_UPLOAD_DIR, name);
            if (!fs.existsSync(file)) return res.status(404).json({ ok: false, error: 'Upload not found' });
            res.sendFile(file);
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/capabilities', (_req, res) => {
        res.json(studioApiContract());
    });

    router.get('/profile', (req, res) => {
        try {
            const profile = isTrustedLocalRequest(req) ? ensureLocalOwnerIdentity(loadProfile()) : loadProfile();
            res.json({ ok: true, profile });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/settings', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor && process.env.STUDIO_STRICT_AUTH === '1') {
                return res.status(401).json({ ok: false, error: 'Studio session required.' });
            }
            res.json(publicStudioSettingsPayload(actor));
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.put('/settings', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const current = studioSettingsRegistry();
            const settings = mergeStudioSettings(current, req.body || {});
            writeJsonSafe(STUDIO_SETTINGS_FILE, settings);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: actor.sessionId || '',
                type: 'studio_settings_updated',
                severity: 'info',
                riskFlags: [],
                deviceId: actor.deviceId || '',
                deviceType: actor.deviceType || '',
                metadata: {
                    scope: req.body?.scope || null,
                    scopes: req.body?.scope ? [req.body.scope] : Object.keys(req.body?.settings || req.body || {}).filter(key => ['account', 'security', 'privacy', 'ai', 'media', 'localDevice'].includes(key)),
                },
            });
            res.json(publicStudioSettingsPayload(actor));
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/check', (req, res) => {
        try {
            res.json(usernameStatus(req.query.username, req.query.currentUserId || ''));
        } catch (e) {
            res.status(500).json({ ok: false, available: false, error: e.message });
        }
    });

    router.post('/identity/register', (req, res) => {
        try {
            const profile = loadProfile();
            const currentUserId = isPortableStudioId(req.body?.currentUserId) ? String(req.body.currentUserId) : '';
            const initialTrustTier = 'UNKNOWN';
            const initialAgeBand = 'unknown';
            const registry = usernameRegistry();
            const protectedAlias = safetyAliasRequired(initialTrustTier, initialAgeBand);
            const requestedStatus = usernameStatus(req.body?.username, currentUserId);
            const handle = protectedAlias ? createProtectedPublicHandle(registry) : requestedStatus.handle;
            if (!protectedAlias && !requestedStatus.available) return res.status(409).json(requestedStatus);
            const passcode = String(req.body?.passcode || '').trim();
            if (passcode.length < 4) return res.status(400).json({ ok: false, reason: 'Use a passcode with at least 4 characters.' });

            const userId = currentUserId || createStudioUserId();
            const displayName = String(req.body?.displayName || profile.name || handle).trim() || handle;
            registry.users[handle] = {
                userId,
                handle,
                displayName,
                passcodeHash: hashSecret(passcode),
                requestedHandle: protectedAlias ? requestedStatus.handle || normalizeUsername(req.body?.username) : undefined,
                protectedAlias,
                accountType: 'human',
                trustTier: initialTrustTier,
                ageBand: initialAgeBand,
                createdAt: registry.users[handle]?.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            writeJsonSafe(USER_REGISTRY_FILE, registry);

            const savedProfile = saveProfile({
                ...profile,
                name: displayName,
                axis: {
                    ...(profile.axis || {}),
                    handle,
                    displayName,
                    userId,
                    color: profile.axis?.color || req.body?.color || 'violet',
                    status: profile.axis?.status || 'online',
                },
                publicIdentity: {
                    ...(profile.publicIdentity || {}),
                    handle,
                },
                studio: {
                    ...(profile.studio || {}),
                    identity: {
                        ...(profile.studio?.identity || {}),
                        registered: true,
                        userId,
                        handle,
                        displayName,
                        protectedAlias,
                        requestedHandle: protectedAlias ? requestedStatus.handle || normalizeUsername(req.body?.username) : undefined,
                        trustTier: initialTrustTier,
                        ageBand: initialAgeBand,
                        registeredAt: profile.studio?.identity?.registeredAt || Date.now(),
                    },
                },
            });

            axisProfileStore.recordActivity({
                type: 'studio_identity_registered',
                title: 'Studio identity registered',
                summary: `@${handle} registered as the portable Studio identity.`,
                source: 'studio-identity',
                metadata: { userId, handle },
            }, savedProfile);

            studioUsers.upsert({
                id: userId,
                handle,
                name: displayName,
                avatar: savedProfile.avatar || '',
                bio: savedProfile.bio || '',
                role: savedProfile.role || '',
                accountType: 'human',
                agent: false,
                verified: true,
                protectedAlias,
                trustTier: initialTrustTier,
                ageBand: initialAgeBand,
            });

            const actor = publicIdentityUser({ userId, handle, displayName, avatar: savedProfile.avatar || '', color: savedProfile.axis?.color || 'violet', trustTier: initialTrustTier, ageBand: initialAgeBand });
            const issued = issueSession(actor, req);
            res.json({ ok: true, user: actor, token: issued.token, session: issued.session, profile: savedProfile, protectedAlias });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/login', (req, res) => {
        try {
            const handle = normalizeUsername(req.body?.username);
            const passcode = String(req.body?.passcode || '').trim();
            const profile = loadProfile();
            const registry = usernameRegistry();
            const registered = registry.users[handle];
            const profileHandle = normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name);
            const profileUserId = profile.axis?.userId || profile.studio?.identity?.userId || '';
            const matchesProfile = handle && handle === profileHandle;

            if (!registered && !matchesProfile) {
                return res.status(404).json({ ok: false, reason: 'No Studio identity found for that username.' });
            }
            if (registered?.passcodeHash && !verifySecret(passcode, registered.passcodeHash)) {
                return res.status(401).json({ ok: false, reason: 'Passcode does not match.' });
            }
            if (!registered?.passcodeHash && passcode.length < 4) {
                return res.status(400).json({ ok: false, reason: 'Enter a passcode to protect this local identity.' });
            }

            const userId = isPortableStudioId(registered?.userId)
                ? registered.userId
                : isPortableStudioId(profileUserId)
                    ? profileUserId
                    : createStudioUserId();
            const displayName = registered?.displayName || profile.axis?.displayName || profile.name || handle;
            registry.users[handle] = {
                ...(registered || {}),
                userId,
                handle,
                displayName,
                passcodeHash: (!registered?.passcodeHash || isLegacySecretHash(registered.passcodeHash)) ? hashSecret(passcode) : registered.passcodeHash,
                accountType: registered?.accountType || 'human',
                trustTier: registered?.trustTier || 'UNKNOWN',
                ageBand: registered?.ageBand || 'unknown',
                createdAt: registered?.createdAt || Date.now(),
                updatedAt: Date.now(),
            };
            writeJsonSafe(USER_REGISTRY_FILE, registry);

            const savedProfile = saveProfile({
                ...profile,
                name: displayName,
                axis: {
                    ...(profile.axis || {}),
                    handle,
                    displayName,
                    userId,
                    color: profile.axis?.color || 'violet',
                    status: profile.axis?.status || 'online',
                },
                publicIdentity: {
                    ...(profile.publicIdentity || {}),
                    handle,
                },
                studio: {
                    ...(profile.studio || {}),
                    identity: {
                        ...(profile.studio?.identity || {}),
                        registered: true,
                        userId,
                        handle,
                        displayName,
                    },
                },
            });

            studioUsers.upsert({
                id: userId,
                handle,
                name: displayName,
                avatar: savedProfile.avatar || '',
                bio: savedProfile.bio || '',
                role: savedProfile.role || '',
                accountType: registry.users[handle].accountType || 'human',
                agent: registry.users[handle].accountType === 'bot',
                verified: true,
                trustTier: registry.users[handle].trustTier,
                ageBand: registry.users[handle].ageBand,
            });

            const actor = publicIdentityUser({
                userId,
                handle,
                displayName,
                avatar: savedProfile.avatar || '',
                color: savedProfile.axis?.color || 'violet',
                trustTier: registry.users[handle].trustTier,
                ageBand: registry.users[handle].ageBand,
            });
            const issued = issueSession(actor, req);
            res.json({ ok: true, user: actor, token: issued.token, session: issued.session, profile: savedProfile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/session', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            res.json({ ok: true, user: publicIdentityUser(actor), profile: loadProfile() });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/devices', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const nowMs = Date.now();
            const sessions = sessionRegistry().sessions
                .filter(item => item.userId === actor.userId && Number(item.expiresAt || 0) > nowMs)
                .sort((a, b) => Number(b.lastSeenAt || b.createdAt || 0) - Number(a.lastSeenAt || a.createdAt || 0))
                .map(publicDeviceSession);
            res.json({ ok: true, sessions });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/start', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const mode = String(req.body?.mode || 'lan').trim().toLowerCase();
            if (!['lan', 'manual'].includes(mode)) {
                return res.status(400).json({ ok: false, error: 'Only LAN/manual pairing is enabled.' });
            }
            const pairingId = `pair-${crypto.randomBytes(18).toString('hex')}`;
            const code = createPairingCode();
            const nowMs = Date.now();
            const starterDevice = deviceInfoFromReq(req);
            const pairing = {
                pairingId,
                userId: actor.userId,
                handle: actor.handle || '',
                displayName: actor.displayName || actor.name || actor.handle || '',
                mode,
                status: 'pending',
                codeHash: codeHash(pairingId, code),
                starterSessionId: actor.sessionId || '',
                starterDeviceId: actor.deviceId || starterDevice.deviceId || '',
                starterIpHash: starterDevice.ipHash,
                createdAt: nowMs,
                expiresAt: nowMs + PAIRING_TTL_MS,
                requestedAt: null,
                approvedAt: null,
                completedAt: null,
                phoneDevice: null,
                issuedToken: null,
                issuedSession: null,
                attempts: 0,
            };
            const db = pairingRegistry();
            db.pairings.push(pairing);
            writePairingRegistry(db);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: actor.sessionId || '',
                type: 'pairing_started',
                severity: 'info',
                riskFlags: [],
                deviceId: pairing.starterDeviceId,
                deviceType: starterDevice.deviceType,
            });
            res.json({
                ok: true,
                pairing: publicPairing(pairing),
                code,
                qrPayload: {
                    type: 'studio-device-pairing',
                    pairingId,
                    mode,
                    path: `/api/studio/identity/pairing/${pairingId}`,
                    expiresAt: pairing.expiresAt,
                },
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/pairing/:pairingId', (req, res) => {
        try {
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (Number(pairing.expiresAt || 0) < Date.now() && !['completed'].includes(pairing.status)) pairing.status = 'expired';
            writePairingRegistry(db);
            res.json({ ok: true, pairing: publicPairing(pairing) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/:pairingId/request', (req, res) => {
        try {
            const code = String(req.body?.code || '').trim();
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (Number(pairing.expiresAt || 0) < Date.now()) return res.status(410).json({ ok: false, error: 'Pairing request expired.' });
            if (!['pending', 'requested'].includes(pairing.status)) return res.status(409).json({ ok: false, error: `Pairing is ${pairing.status}.` });
            pairing.attempts = Number(pairing.attempts || 0) + 1;
            if (pairing.attempts > 10) {
                pairing.status = 'locked';
                writePairingRegistry(db);
                return res.status(429).json({ ok: false, error: 'Too many pairing attempts.' });
            }
            if (!code || codeHash(pairing.pairingId, code) !== pairing.codeHash) {
                writePairingRegistry(db);
                return res.status(401).json({ ok: false, error: 'Pairing code does not match.' });
            }
            const phoneDevice = deviceInfoFromReq(req);
            if (pairing.mode === 'lan' && pairing.starterIpHash && phoneDevice.ipHash !== pairing.starterIpHash) {
                writePairingRegistry(db);
                recordRiskEvent({
                    userId: pairing.userId,
                    sessionId: pairing.starterSessionId || '',
                    type: 'pairing_network_mismatch',
                    severity: 'medium',
                    riskFlags: ['pairing_network_mismatch'],
                    deviceId: phoneDevice.deviceId,
                    deviceType: phoneDevice.deviceType,
                });
                return res.status(403).json({ ok: false, error: 'Phone must be on the same network for LAN pairing.' });
            }
            pairing.status = 'requested';
            pairing.requestedAt = Date.now();
            pairing.phoneDevice = phoneDevice;
            writePairingRegistry(db);
            recordRiskEvent({
                userId: pairing.userId,
                sessionId: pairing.starterSessionId || '',
                type: 'pairing_requested',
                severity: 'info',
                riskFlags: [],
                deviceId: phoneDevice.deviceId,
                deviceType: phoneDevice.deviceType,
            });
            res.json({ ok: true, pairing: publicPairing(pairing) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/:pairingId/approve', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (pairing.userId !== actor.userId) return res.status(403).json({ ok: false, error: 'Pairing belongs to a different account.' });
            if (Number(pairing.expiresAt || 0) < Date.now()) return res.status(410).json({ ok: false, error: 'Pairing request expired.' });
            if (pairing.status !== 'requested' || !pairing.phoneDevice) return res.status(409).json({ ok: false, error: 'No phone is waiting for approval.' });
            const issued = issueSession(publicIdentityUser(actor), req, pairing.phoneDevice);
            pairing.status = 'approved';
            pairing.approvedAt = Date.now();
            pairing.issuedToken = issued.token;
            pairing.issuedSession = issued.session;
            writePairingRegistry(db);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: actor.sessionId || '',
                type: 'pairing_approved',
                severity: 'info',
                riskFlags: [],
                deviceId: pairing.phoneDevice.deviceId,
                deviceType: pairing.phoneDevice.deviceType,
            });
            res.json({ ok: true, pairing: publicPairing(pairing), session: issued.session });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/identity/pairing/:pairingId/complete', (req, res) => {
        try {
            const code = String(req.body?.code || '').trim();
            const db = pairingRegistry();
            const pairing = db.pairings.find(item => item.pairingId === req.params.pairingId);
            if (!pairing) return res.status(404).json({ ok: false, error: 'Pairing request not found.' });
            if (Number(pairing.expiresAt || 0) < Date.now()) return res.status(410).json({ ok: false, error: 'Pairing request expired.' });
            if (pairing.status !== 'approved' || !pairing.issuedToken) return res.status(409).json({ ok: false, error: 'Pairing has not been approved.' });
            if (!code || codeHash(pairing.pairingId, code) !== pairing.codeHash) return res.status(401).json({ ok: false, error: 'Pairing code does not match.' });
            const person = studioUsers.get(pairing.userId) || {};
            const registered = Object.values(usernameRegistry().users || {}).find(user => user.userId === pairing.userId);
            const user = publicIdentityUser({
                userId: pairing.userId,
                handle: registered?.handle || pairing.handle || person.handle || '',
                displayName: registered?.displayName || pairing.displayName || person.name || pairing.userId,
                name: registered?.displayName || pairing.displayName || person.name || pairing.userId,
                avatar: person.avatar || '',
                color: person.color || 'violet',
                trustTier: registered?.trustTier || person.trustTier || 'UNKNOWN',
                ageBand: registered?.ageBand || person.ageBand || 'unknown',
            });
            const token = pairing.issuedToken;
            const session = pairing.issuedSession;
            pairing.status = 'completed';
            pairing.completedAt = Date.now();
            pairing.issuedToken = null;
            writePairingRegistry(db);
            recordRiskEvent({
                userId: pairing.userId,
                sessionId: session?.sessionId || '',
                type: 'pairing_completed',
                severity: 'info',
                riskFlags: [],
                deviceId: session?.deviceId || '',
                deviceType: session?.deviceType || '',
            });
            res.json({ ok: true, user, token, session });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/identity/devices/:sessionId', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const db = sessionRegistry();
            const session = db.sessions.find(item => item.sessionId === req.params.sessionId && item.userId === actor.userId);
            if (!session) return res.status(404).json({ ok: false, error: 'Device session not found.' });
            if (!session.revokedAt) session.revokedAt = Date.now();
            writeJsonSafe(STUDIO_SESSIONS_FILE, db);
            recordRiskEvent({
                userId: actor.userId,
                sessionId: session.sessionId,
                type: 'device_session_revoked',
                severity: 'info',
                riskFlags: [],
                deviceId: session.deviceId,
                deviceType: session.deviceType,
            });
            res.json({ ok: true, session: publicDeviceSession(session) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/risk-events', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const events = riskEventRegistry().events
                .filter(item => item.userId === actor.userId)
                .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                .slice(0, Math.min(Number(req.query.limit) || 100, 500));
            res.json({ ok: true, events });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/identity/me', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const user = studioUsers.get(actor.userId) || {};
            res.json({
                ok: true,
                user: publicIdentityUser(actor),
                verification: verificationStatusFor({ ...user, ...actor, id: actor.userId }),
                restricted: isRestrictedActor(actor),
                permissions: {
                    canPost: !isRestrictedActor(actor),
                    canFollow: !safetyProfile(actor).isUnknownAge && !isRestrictedActor(actor),
                    canDiscoverUsers: !safetyProfile(actor).isUnknownAge,
                    canViewMinors: safetyProfile(actor).isMinor,
                    canViewAdults: !safetyProfile(actor).isMinor && !safetyProfile(actor).isUnknownAge,
                },
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/verification/status', (req, res) => {
        try {
            const actor = resolveActor(req);
            if (!actor) return res.status(401).json({ ok: false, error: 'Studio session required.' });
            const user = studioUsers.get(actor.userId) || {};
            res.json({ ok: true, verification: verificationStatusFor({ ...user, ...actor, id: actor.userId }) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/verification/attestation', (req, res) => {
        try {
            const trusted = platformAuthorityOk(req);
            if (!trusted) return res.status(403).json({ ok: false, error: 'Verification attestation authority required.' });
            rejectRawVerificationMedia(req.body || {});
            const userId = String(req.body?.userId || '').trim();
            if (!userId) return res.status(400).json({ ok: false, error: 'userId is required.' });
            const user = studioUsers.get(userId);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });

            const trustTier = normalizeTrustTier(req.body?.trustTier);
            const ageBand = normalizeAgeBand(req.body?.ageBand, trustTier);
            const safety = safetyProfile({ trustTier, ageBand });
            if (safety.isUnknownAge) return res.status(400).json({ ok: false, error: 'Attestation must resolve ageBand/trustTier.' });

            const nowMs = Date.now();
            const expiresAt = Number(req.body?.expiresAt || req.body?.verificationExpiresAt || 0) || (nowMs + 1000 * 60 * 60 * 24 * 365);
            const updated = studioUsers.upsert({
                ...user,
                trustTier,
                ageBand,
                verified: safety.isVerified,
                verificationProvider: String(req.body?.provider || 'external').slice(0, 80),
                verificationRef: String(req.body?.verificationRef || '').slice(0, 160),
                verificationEvidenceHash: String(req.body?.evidenceHash || '').slice(0, 160),
                verifiedAt: nowMs,
                verificationExpiresAt: expiresAt,
                visibilityLimited: safety.isUnknownAge ? true : Boolean(user.visibilityLimited && req.body?.clearRestriction !== true),
            });

            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === userId) {
                    registry.users[handle] = { ...record, trustTier, ageBand, updatedAt: nowMs };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);
            res.json({ ok: true, user: publicStudioUser(updated), verification: verificationStatusFor(updated) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/safety/policy', (_req, res) => {
        res.json({
            ok: true,
            tiers: Array.from(TRUST_TIERS),
            rules: {
                unknown: 'Authenticated but not discoverable; cannot follow, DM, or browse social users until age is resolved.',
                adult_unverified: 'Adult-safe surfaces only; cannot see, contact, follow, recommend, or be recommended to minors.',
                adult_verified: 'Verified adult surfaces only; still cannot see, contact, follow, recommend, or be recommended to minors.',
                minor_verified: 'Can only see and be seen by verified minor accounts and moderated youth spaces.',
                minor_protected_u13: 'Guardian-consent protected; can only see protected under-13 spaces/users.',
            },
        });
    });

    router.get('/security/status', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const db = securityRegistry();
            res.json({
                ok: true,
                gateway: {
                    active: true,
                    rateBuckets: STUDIO_RATE_BUCKETS.size,
                    directsScanned: true,
                    ipPolicy: 'risk signal first; temporary block only unless attack infrastructure is confirmed',
                },
                bannedUsers: db.bannedUsers.filter(item => !item.revokedAt).map(item => ({
                    userId: item.userId,
                    reason: item.reason,
                    createdAt: item.createdAt,
                    evidence: item.evidence || {},
                })),
                ipBlocks: db.ipBlocks.filter(item => !item.revokedAt && (!item.expiresAt || Number(item.expiresAt) > Date.now())),
                recentDirectScans: db.directScans.slice(-50).reverse().map(publicSecurityScan),
                counters: db.counters,
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/security/directs/scan', (req, res) => {
        try {
            const actor = resolveActor(req);
            const scan = scanDirectForScam({
                ...(req.body || {}),
                senderUserId: req.body?.senderUserId || actor?.userId || req.body?.userId || '',
            }, req);
            if (scan.verdict !== 'allow') recordDirectSecurityScan(scan, req);
            res.json({
                ok: true,
                scan: publicSecurityScan(scan),
                action: scan.verdict === 'allow'
                    ? 'deliver'
                    : scan.verdict === 'flag'
                        ? 'deliver_with_warning'
                        : 'quarantine_before_delivery',
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/security/users/:id/ban', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const ban = banStudioUser(req.params.id, String(req.body?.reason || 'manual_platform_ban'), {
                source: 'manual_security_action',
                note: String(req.body?.note || '').slice(0, 500),
            });
            res.json({ ok: true, ban });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/security/users/:id/unban', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const db = securityRegistry();
            const nowMs = Date.now();
            let changed = false;
            for (const ban of db.bannedUsers) {
                if (ban.userId === req.params.id && !ban.revokedAt) {
                    ban.revokedAt = nowMs;
                    ban.revokedReason = String(req.body?.reason || 'manual_unban');
                    changed = true;
                }
            }
            writeSecurityRegistry(db);
            const user = studioUsers.get(req.params.id);
            if (user) {
                studioUsers.upsert({
                    ...user,
                    visibilityLimited: Boolean(req.body?.keepLimited),
                    bannedAt: null,
                    banReason: null,
                });
            }
            recordRiskEvent({
                userId: req.params.id,
                sessionId: '',
                type: 'studio_user_unbanned',
                severity: 'medium',
                riskFlags: [],
                deviceId: '',
                deviceType: 'account',
            });
            res.json({ ok: true, changed });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/safety/audit', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const users = studioUsers.list();
            const audits = users.map(user => ({
                userId: user.id,
                handle: user.handle,
                name: user.name,
                trustTier: normalizeTrustTier(user.trustTier),
                ageBand: normalizeAgeBand(user.ageBand, user.trustTier),
                visibilityLimited: Boolean(user.visibilityLimited),
                behaviorRisk: computeBehaviorRisk(user.id),
            })).sort((a, b) => b.behaviorRisk.score - a.behaviorRisk.score);
            res.json({ ok: true, audits });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/safety/audit/run', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const threshold = Math.max(0, Math.min(100, Number(req.body?.restrictThreshold ?? 70)));
            const reviewed = [];
            for (const user of studioUsers.list()) {
                const behaviorRisk = computeBehaviorRisk(user.id);
                const restricted = behaviorRisk.score >= threshold;
                const updated = studioUsers.upsert({
                    ...user,
                    behaviorRisk,
                    safetyFlags: behaviorRisk.flags,
                    safetyAuditedAt: Date.now(),
                    visibilityLimited: restricted || Boolean(user.visibilityLimited && req.body?.clear !== true),
                });
                reviewed.push({
                    userId: updated.id,
                    handle: updated.handle,
                    behaviorRisk,
                    visibilityLimited: Boolean(updated.visibilityLimited),
                });
            }
            reviewed.sort((a, b) => b.behaviorRisk.score - a.behaviorRisk.score);
            res.json({ ok: true, reviewed });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.put('/users/:id/safety', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const trustTier = normalizeTrustTier(req.body?.trustTier);
            const ageBand = normalizeAgeBand(req.body?.ageBand, trustTier);
            const updated = studioUsers.upsert({
                ...user,
                trustTier,
                ageBand,
                verified: safetyProfile({ trustTier, ageBand }).isVerified,
                safetyUpdatedAt: Date.now(),
                verificationExpiresAt: req.body?.verificationExpiresAt || user.verificationExpiresAt || null,
                verificationProvider: req.body?.verificationProvider || user.verificationProvider || 'manual-local-owner',
            });
            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === req.params.id) {
                    registry.users[handle] = { ...record, trustTier, ageBand, updatedAt: Date.now() };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);
            res.json({ ok: true, user: publicIdentityUser({ ...updated, userId: updated.id, displayName: updated.name }) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/users/:id/disclosure', (req, res) => {
        try {
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const actor = resolveActor(req);
            if (!canViewUser(actor, user)) return res.status(404).json({ ok: false, error: 'not found' });
            const publicUser = publicStudioUser(user);
            res.json({
                ok: true,
                userId: publicUser.id,
                handle: publicUser.handle,
                accountType: publicUser.accountType,
                agent: publicUser.agent,
                botDisclosure: publicUser.botDisclosure,
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.put('/users/:id/account-type', (req, res) => {
        try {
            if (!platformAuthorityOk(req)) return res.status(403).json({ ok: false, error: 'Platform authority required.' });
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const accountType = normalizeAccountType(req.body?.accountType);
            const disclosure = req.body?.botDisclosure && typeof req.body.botDisclosure === 'object' ? req.body.botDisclosure : {};
            const botDisclosure = botDisclosureFor({ ...user, accountType, botDisclosure: disclosure });
            if (accountType === 'bot' && !botDisclosure?.required) {
                return res.status(400).json({ ok: false, error: 'Bot accounts require disclosure.' });
            }
            const updated = studioUsers.upsert({
                ...user,
                accountType,
                agent: accountType === 'bot',
                botDisclosure,
                accountTypeUpdatedAt: Date.now(),
            });
            const registry = usernameRegistry();
            for (const [handle, record] of Object.entries(registry.users || {})) {
                if (record.userId === req.params.id) {
                    registry.users[handle] = { ...record, accountType, updatedAt: Date.now() };
                }
            }
            writeJsonSafe(USER_REGISTRY_FILE, registry);
            res.json({ ok: true, user: publicStudioUser(updated) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.put('/profile', (req, res) => {
        try {
            ensureDir();
            const body = req.body || {};
            const markdown = typeof body.rawMarkdown === 'string'
                ? body.rawMarkdown
                : renderMarkdown(body.profile || body);
            fs.writeFileSync(USER_MD, markdown);
            const profile = parseMarkdown(markdown);
            axisProfileStore.recordActivity({
                type: 'studio_profile_saved',
                title: 'Studio profile saved',
                summary: 'Profile, widgets, or Studio settings were updated.',
                source: 'studio-profile',
            }, profile);
            res.json({ ok: true, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/context', (_req, res) => {
        try {
            const profile = loadProfile();
            res.json({
                ok: true,
                context: profileContext(profile),
                profile,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/featured', (_req, res) => {
        try {
            const profile = loadProfile();
            const social = socialImageLibrary.list();
            const items = mergePortfolioWithSocialImages(profile, social.images || []);
            res.json({
                ok: true,
                imageDir: social.imageDir,
                items,
                socialImages: social.images || [],
                profile,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/featured/images/:id/file', (req, res) => {
        try {
            const social = socialImageLibrary.list();
            const image = (social.images || []).find(item => item.id === req.params.id);
            if (!image?.path || !fs.existsSync(image.path)) {
                return res.status(404).json({ ok: false, error: 'Image not found' });
            }
            res.sendFile(path.resolve(image.path));
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/featured/upload', upload.single('image'), (req, res) => {
        let tempPath = req.file?.path;
        try {
            if (!tempPath) return res.status(400).json({ ok: false, error: 'Image file is required' });
            const title = String(req.body?.title || titleFromFilename(req.file.originalname)).trim();
            const category = String(req.body?.category || 'SOMA Social Images').trim();
            const description = String(req.body?.description || `Featured image imported from Studio: ${req.file.originalname}`).trim();
            const tags = String(req.body?.tags || 'studio, featured-work, social-image')
                .split(',')
                .map(tag => tag.trim())
                .filter(Boolean);

            const imported = socialImageLibrary.import({
                path: tempPath,
                alt: description,
                source: 'studio-featured-work',
                tags,
            });
            const item = portfolioItemFromSocialImage(imported.image, { title, category, description, tags });
            const profile = loadProfile();
            const existing = Array.isArray(profile.studio?.portfolio) ? profile.studio.portfolio : [];
            const withoutDuplicate = existing.filter(saved =>
                saved?.socialImageId !== item.socialImageId &&
                saved?.socialPath !== item.socialPath &&
                saved?.id !== item.id
            );
            const savedProfile = saveProfile({
                ...profile,
                studio: {
                    ...(profile.studio || {}),
                    portfolio: [item, ...withoutDuplicate],
                },
            });
            axisProfileStore.recordActivity({
                type: 'studio_featured_image',
                title: 'Featured image added',
                summary: `${title} was imported into SOMA/social-media/images.`,
                source: 'studio-featured-work',
                metadata: { socialImageId: item.socialImageId, path: item.socialPath },
            }, savedProfile);

            res.json({
                ok: true,
                item,
                image: imported.image,
                imageDir: imported.imageDir,
                profile: savedProfile,
            });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        } finally {
            if (tempPath) {
                try { fs.unlinkSync(tempPath); } catch {}
            }
        }
    });

    router.get('/axis', (_req, res) => {
        try {
            const profile = loadProfile();
            const axis = axisProfileStore.getState(profile);
            res.json({
                ok: true,
                axis,
                profile,
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.put('/axis', (req, res) => {
        try {
            const profile = loadProfile();
            const current = axisProfileStore.getState(profile);
            const incoming = req.body?.axis || req.body || {};
            const saved = axisProfileStore.saveState({
                ...current,
                ...incoming,
                friends: Array.isArray(incoming.friends) ? incoming.friends : current.friends,
                chats: Array.isArray(incoming.chats) ? incoming.chats : current.chats,
                messages: incoming.messages && typeof incoming.messages === 'object' ? incoming.messages : current.messages,
                spaces: Array.isArray(incoming.spaces) ? incoming.spaces : current.spaces,
            }, profile);
            res.json({ ok: true, axis: saved, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/axis/friends', (req, res) => {
        try {
            const profile = loadProfile();
            const result = axisProfileStore.addFriend(req.body || {}, profile);
            res.json({ ok: true, ...result, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/axis/friends/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const result = axisProfileStore.updateFriend(req.params.id, req.body || {}, profile);
            res.json({ ok: true, ...result, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/axis/friends/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const result = axisProfileStore.removeFriend(req.params.id, profile);
            res.json({ ok: true, ...result, profile });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/axis/chats/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const chat = axisProfileStore.updateChat(req.params.id, req.body || {}, profile);
            res.json({ ok: true, chat, axis: axisProfileStore.getState(profile) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/axis/chats/:id/messages', (req, res) => {
        try {
            const profile = loadProfile();
            res.json({ ok: true, ...axisProfileStore.getMessages(req.params.id, profile) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/axis/chats/:id/messages', (req, res) => {
        try {
            const profile = loadProfile();
            const scan = scanDirectForScam({ ...(req.body || {}), chatId: req.params.id }, req);
            if (scan.verdict !== 'allow') recordDirectSecurityScan(scan, req);
            if (scan.verdict === 'quarantine' || scan.verdict === 'ban_recommend') {
                return res.status(202).json({
                    ok: true,
                    quarantined: true,
                    message: null,
                    security: publicSecurityScan(scan),
                    reason: 'Direct was quarantined by Studio Security Gateway before delivery.',
                });
            }
            const result = axisProfileStore.addMessage(req.params.id, {
                ...(req.body || {}),
                security: scan.verdict === 'flag' ? publicSecurityScan(scan) : null,
            }, profile);
            res.json({ ok: true, ...result, security: publicSecurityScan(scan) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Post comments (shared by the Studio phone app AND the web Stage) ────────
    router.get('/posts/:postId/comments', (req, res) => {
        try {
            const actor = resolveActor(req);
            const fp = studioFeed.get(req.params.postId);
            if (fp && !canViewPost(actor, fp)) return res.status(404).json({ ok: false, error: 'not found' });
            res.json({ ok: true, comments: studioComments.list(req.params.postId) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/posts/:postId/comments', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const fp = studioFeed.get(req.params.postId);
            if (fp && !canViewPost(actor, fp)) return res.status(403).json({ ok: false, error: 'Safety policy blocks commenting on this post.' });
            const comment = studioComments.add(req.params.postId, {
                ...(req.body || {}),
                who: actor.userId,
                name: actor.displayName || actor.name || actor.handle,
                avatar: actor.avatar || '',
            });
            // If this is a real feed post, tell its author someone commented.
            if (fp) notify(fp.authorId, 'comment', actor.userId, `commented: "${(comment.text || '').slice(0, 80)}"`, fp.id);
            res.json({ ok: true, comment, comments: studioComments.list(req.params.postId) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/posts/:postId/comments/:commentId/like', (req, res) => {
        try {
            const comment = studioComments.like(req.params.postId, req.params.commentId, req.body?.delta ?? 1);
            res.json({ ok: true, comment });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Posts feed — the shared STUDIO feed (mobile + web + Command Bridge) ─────
    router.get('/feed', (req, res) => {
        try {
            const actor = resolveActor(req);
            const { limit, before, author } = req.query;
            const posts = rankStudioFeedForViewer(actor, studioFeed.list({ limit: 200, before, author }))
                .slice(0, Math.min(Number(limit) || 50, 200))
                .map(p => ({ ...p, comments_count: studioComments.count(p.id) }));
            res.json({ ok: true, posts });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const post = studioFeed.add({
                ...(req.body || {}),
                authorId: actor.userId,
                authorName: actor.displayName || actor.name || actor.handle,
                authorAvatar: actor.avatar || '',
                authorTrustTier: actor.trustTier,
                authorAgeBand: actor.ageBand,
            });
            res.json({ ok: true, post });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/like', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const liker = actor.userId;
            const delta = req.body && req.body.delta != null ? req.body.delta : 1;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks liking this post.' });
            const post = studioFeed.like(req.params.id, liker, delta);
            if (post && Number(delta) > 0) notify(post.authorId, 'like', liker, 'liked your post', post.id);
            res.json({ ok: true, post });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/dislike', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks disliking this post.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const post = studioFeed.dislike(req.params.id, actor.userId, enabled);
            res.json({ ok: true, post });
        } catch (e) {
            res.status(e.status || 400).json({ ok: false, error: e.message, code: e.code || 'DISLIKE_FAILED' });
        }
    });

    router.post('/feed/:id/repost', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks reposting this post.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const post = studioFeed.repost(req.params.id, actor.userId, enabled);
            if (post && enabled) notify(post.authorId, 'repost', actor.userId, 'reposted your post', post.id);
            res.json({ ok: true, post });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/bookmark', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks bookmarking this post.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const post = studioFeed.bookmark(req.params.id, actor.userId, enabled);
            res.json({ ok: true, post });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/feed/:id/report', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioFeed.get(req.params.id);
            if (existing && !canViewPost(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks reporting this post.' });
            const post = studioFeed.report(req.params.id, {
                userId: actor.userId,
                reason: req.body?.reason || 'other',
                note: req.body?.note || '',
            });
            res.json({ ok: true, post });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/feed/bookmarks/me', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const posts = rankStudioFeedForViewer(actor, studioFeed.listBookmarks(actor.userId, { limit: req.query.limit || 50 }))
                .map(p => ({ ...p, comments_count: studioComments.count(p.id) }));
            res.json({ ok: true, posts });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/feed/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            studioFeed.delete(req.params.id, actor.userId);
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Signals — long-form video metadata and watch feedback ────────────────
    router.get('/signals', (req, res) => {
        try {
            const actor = resolveActor(req);
            const { limit, before, author } = req.query;
            const signals = rankStudioSignalsForViewer(actor, studioSignals.list({ limit: 200, before, author }))
                .slice(0, Math.min(Number(limit) || 50, 200));
            res.json({ ok: true, signals });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/upload', signalVideoUpload.single('video'), (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            if (!req.file) return res.status(400).json({ ok: false, error: 'No video file uploaded' });
            const media = {
                id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                kind: 'video',
                originalName: req.file.originalname || '',
                filename: req.file.filename,
                mimeType: req.file.mimetype || 'application/octet-stream',
                size: req.file.size || 0,
                url: `/api/studio/uploads/${encodeURIComponent(req.file.filename)}`,
                uploadedBy: actor.userId,
                uploadedAt: Date.now(),
            };
            res.json({ ok: true, media });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const signal = studioSignals.add({
                ...(req.body || {}),
                authorId: actor.userId,
                authorName: actor.displayName || actor.name || actor.handle,
                authorAvatar: actor.avatar || '',
                authorTrustTier: actor.trustTier,
                authorAgeBand: actor.ageBand,
            });
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/view', (req, res) => {
        try {
            const actor = resolveActor(req);
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks viewing this Signal.' });
            const signal = studioSignals.view(req.params.id, actor?.userId || actor?.id || '');
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/like', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks liking this Signal.' });
            const delta = req.body && req.body.delta != null ? req.body.delta : 1;
            const signal = studioSignals.like(req.params.id, actor.userId, delta);
            if (signal && Number(delta) > 0) notify(signal.authorId, 'signal_like', actor.userId, 'liked your Signal', signal.id);
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/dislike', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks disliking this Signal.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const signal = studioSignals.dislike(req.params.id, actor.userId, enabled);
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/bookmark', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks bookmarking this Signal.' });
            const enabled = req.body?.enabled !== false && Number(req.body?.delta ?? 1) >= 0;
            const signal = studioSignals.bookmark(req.params.id, actor.userId, enabled);
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/signals/:id/report', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && !canViewSignal(actor, existing)) return res.status(403).json({ ok: false, error: 'Safety policy blocks reporting this Signal.' });
            const signal = studioSignals.report(req.params.id, {
                userId: actor.userId,
                reason: req.body?.reason || 'other',
                note: req.body?.note || '',
            });
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/signals/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const existing = studioSignals.get(req.params.id);
            if (existing && existing.authorId !== actor.userId) return res.status(403).json({ ok: false, error: 'Only the author can edit this Signal.' });
            const signal = studioSignals.update(req.params.id, actor.userId, req.body || {});
            if (!signal) return res.status(404).json({ ok: false, error: 'Signal not found' });
            res.json({ ok: true, signal });
        } catch (e) {
            res.status(e.status || 400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/signals/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            studioSignals.delete(req.params.id, actor.userId);
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Follow graph — the shared STUDIO social graph (Following / Followers / Friends) ──
    router.post('/follow', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const target = userForSafetyLookup(req.body?.followeeId);
            if (!canInteractWithUser(actor, target)) return res.status(403).json({ ok: false, error: 'Safety policy blocks this follow.' });
            const followerId = actor.userId;
            const { followeeId } = req.body || {};
            const result = studioFollows.follow(followerId, followeeId);
            notify(followeeId, 'follow', followerId, 'started following you');
            res.json({ ok: true, ...result, graph: studioFollows.graph(followeeId, followerId) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/follow', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowServiceBody: true });
            if (!actor) return;
            const followerId = actor.userId;
            const { followeeId } = req.body || {};
            const result = studioFollows.unfollow(followerId, followeeId);
            res.json({ ok: true, ...result, graph: studioFollows.graph(followeeId, followerId) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.get('/follows/:userId', (req, res) => {
        try {
            const actor = resolveActor(req);
            const target = userForSafetyLookup(req.params.userId);
            if (!canViewUser(actor, target)) return res.status(404).json({ ok: false, error: 'not found' });
            const graph = studioFollows.graph(req.params.userId, actor?.userId || req.query.viewer || null);
            graph.following = filterUsersForViewer(actor, graph.following.map(userForSafetyLookup)).map(user => user.id);
            graph.followers = filterUsersForViewer(actor, graph.followers.map(userForSafetyLookup)).map(user => user.id);
            graph.friends = filterUsersForViewer(actor, graph.friends.map(userForSafetyLookup)).map(user => user.id);
            graph.counts = { following: graph.following.length, followers: graph.followers.length, friends: graph.friends.length };
            res.json({ ok: true, ...graph });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // ── Notifications — what happened to you (follows, likes, comments) ────────
    router.get('/notifications/:userId', (req, res) => {
        try {
            res.json({ ok: true, notifications: studioNotifications.list(req.params.userId), unread: studioNotifications.unread(req.params.userId) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/notifications/:userId/read', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            if (actor.userId !== req.params.userId && !isTrustedLocalRequest(req)) {
                return res.status(403).json({ ok: false, error: 'Cannot mark another user notifications read.' });
            }
            studioNotifications.markRead(req.params.userId);
            res.json({ ok: true });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── People registry — real users beyond Barry (agents like Maxwell) ────────
    router.get('/users', (req, res) => {
        try {
            const actor = resolveActor(req);
            res.json({ ok: true, users: filterUsersForViewer(actor, studioUsers.list()).map(publicStudioUser) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/users/:id', (req, res) => {
        try {
            const user = studioUsers.get(req.params.id);
            if (!user) return res.status(404).json({ ok: false, error: 'not found' });
            const actor = resolveActor(req);
            if (!canViewUser(actor, user)) return res.status(404).json({ ok: false, error: 'not found' });
            res.json({ ok: true, user: publicStudioUser(user), graph: studioFollows.graph(req.params.id, actor?.userId || req.query.viewer || null) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/block', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const blockerId = actor.userId;
            const { blockeeId } = req.body || {};
            const target = userForSafetyLookup(blockeeId);
            if (!canViewUser(actor, target)) return res.status(404).json({ ok: false, error: 'not found' });
            const result = studioFollows.block(blockerId, blockeeId);
            res.json({ ok: true, ...result, graph: studioFollows.graph(blockerId, blockerId) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/block', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const blockerId = actor.userId;
            const { blockeeId } = req.body || {};
            const result = studioFollows.unblock(blockerId, blockeeId);
            res.json({ ok: true, ...result, graph: studioFollows.graph(blockerId, blockerId) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Communities ────────────────────────────────────────────────────────────
    router.get('/communities', (_req, res) => {
        try {
            const profile = loadProfile();
            let communities = Array.isArray(profile.studio?.communities) && profile.studio.communities.length
                ? profile.studio.communities
                : null;
            if (!communities) {
                communities = DEFAULT_COMMUNITIES;
                saveProfile({ ...profile, studio: { ...(profile.studio || {}), communities } });
            }
            res.json({ ok: true, communities });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/communities', (req, res) => {
        try {
            const profile = loadProfile();
            const existing = Array.isArray(profile.studio?.communities) && profile.studio.communities.length
                ? profile.studio.communities : [...DEFAULT_COMMUNITIES];
            const { name, description, category, icon, image, tags } = req.body || {};
            if (!name?.trim()) return res.status(400).json({ ok: false, error: 'name required' });
            const community = {
                id: `c-${Date.now()}`,
                name: name.trim(),
                description: description?.trim() || '',
                icon: icon || '💬',
                image: image || 'https://images.unsplash.com/photo-1614850523060-8da1d56ae167?w=600',
                membersCount: 1,
                isJoined: true,
                category: category || 'Custom',
                tags: Array.isArray(tags) ? tags : ['New'],
            };
            const updated = [...existing, community];
            saveProfile({ ...profile, studio: { ...(profile.studio || {}), communities: updated } });
            res.json({ ok: true, community, communities: updated });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.patch('/communities/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const existing = Array.isArray(profile.studio?.communities) && profile.studio.communities.length
                ? profile.studio.communities : [...DEFAULT_COMMUNITIES];
            const updated = existing.map(c => c.id === req.params.id ? { ...c, ...req.body } : c);
            saveProfile({ ...profile, studio: { ...(profile.studio || {}), communities: updated } });
            const community = updated.find(c => c.id === req.params.id);
            res.json({ ok: true, community, communities: updated });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.delete('/communities/:id', (req, res) => {
        try {
            const profile = loadProfile();
            const existing = Array.isArray(profile.studio?.communities) && profile.studio.communities.length
                ? profile.studio.communities : [...DEFAULT_COMMUNITIES];
            const updated = existing.filter(c => c.id !== req.params.id);
            saveProfile({ ...profile, studio: { ...(profile.studio || {}), communities: updated } });
            res.json({ ok: true, communities: updated });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    // ── Top 8 ──────────────────────────────────────────────────────────────────
    router.get('/top8', (_req, res) => {
        try {
            const profile = loadProfile();
            const axis = axisProfileStore.getState(profile);
            const top8Ids = Array.isArray(axis.top8) ? axis.top8 : [];
            const friends = axis.friends || [];
            const ordered = top8Ids.map(id => friends.find(f => f.id === id)).filter(Boolean);
            res.json({ ok: true, top8: ordered, top8Ids, friends });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.put('/top8', (req, res) => {
        try {
            const profile = loadProfile();
            const current = axisProfileStore.getState(profile);
            const ids = Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 8) : [];
            const saved = axisProfileStore.saveState({ ...current, top8: ids }, profile);
            const friends = saved.friends || [];
            const ordered = ids.map(id => friends.find(f => f.id === id)).filter(Boolean);
            res.json({ ok: true, top8: ordered, top8Ids: ids });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/assistant', async (req, res) => {
        try {
            const message = String(req.body?.message || '').trim();
            if (!message) return res.status(400).json({ ok: false, error: 'Message is required' });

            const profile = loadProfile();
            const history = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
            const historyText = history
                .map(item => `${item.role === 'user' ? 'Barry' : 'SOMA'}: ${item.text || item.content || ''}`)
                .filter(Boolean)
                .join('\n');

            const prompt = [
                'You are SOMA inside Studio, the user profile and identity control layer for Command Bridge.',
                'Speak as SOMA, not as Gemini, a generic assistant, or a separate bot.',
                'Use the profile context below to help Barry shape Studio, Axis identity, projects, public voice, and communication workflows.',
                'Be concise, practical, honest, and high-agency. If a request needs implementation work, suggest the smallest concrete next step.',
                '',
                '[STUDIO PROFILE CONTEXT]',
                profileContext(profile),
                '',
                historyText ? '[RECENT STUDIO CHAT]\n' + historyText + '\n' : '',
                `[BARRY]\n${message}`,
            ].join('\n');

            const brain = system.quadBrain || system.somArbiter || system.brain || system.superintelligence;
            if (!brain?.reason) {
                return res.json({
                    ok: true,
                    reply: "Studio is wired to SOMA, but my reasoning core is still waking up. I can see your profile context once the backend brain is online.",
                    metadata: { brain: 'offline' },
                });
            }

            const result = await reasonGrounded(brain, prompt, {
                system,
                forceContext: true,
                context: {
                    source: 'studio-assistant',
                    quickResponse: true,
                    preferredBrain: 'AURORA',
                    profilePath: USER_MD,
                }
            });

            res.json({
                ok: true,
                reply: resultText(result) || 'I received that, but my response came back empty.',
                metadata: {
                    brain: result?.metadata?.brain || result?.brain || 'SOMA',
                    confidence: result?.metadata?.confidence ?? result?.confidence ?? null,
                },
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    return router;
}
