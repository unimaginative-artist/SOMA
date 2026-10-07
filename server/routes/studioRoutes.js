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
import studioLive from '../studio/StudioLiveStore.js';
import studioPathways from '../studio/StudioPathwaysStore.js';
import studioUsers from '../studio/StudioUsersStore.js';
import studioNotifications from '../studio/StudioNotificationsStore.js';
import studioAxisEvents from '../studio/StudioAxisEventBus.js';
import maxwellAgent from '../studio/MaxwellAgent.js';
import somaStudioAgent from '../studio/SomaStudioAgent.js';
import { reasonGrounded } from '../context/GroundedReasoning.js';
import registerStudioLiveRoutes from './studio/liveRoutes.js';
import registerStudioFeedRoutes from './studio/feedRoutes.js';
import registerStudioIdentityRoutes from './studio/identityRoutes.js';
import registerStudioModerationRoutes from './studio/moderationRoutes.js';
import registerStudioAxisRoutes from './studio/axisRoutes.js';
import registerStudioSignalRoutes from './studio/signalRoutes.js';
import {
    hashStudioAudit,
    isTrustedStudioLocalRequest,
    signStudioPayload,
    studioBearerToken,
    studioSessionActor,
    verifyStudioSessionToken,
} from '../studio/StudioSessionAuth.js';

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
const PAIRING_TTL_MS = 5 * 60 * 1000;
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
    name: 'Owner',
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
        handle: 'owner',
        displayName: 'Owner',
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

function signPayload(payload) {
    return signStudioPayload(payload);
}

function hashForAudit(value = '') {
    return hashStudioAudit(value);
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

function networkClass(ip = '') {
    const clean = String(ip || '').trim().replace(/^::ffff:/i, '');
    if (!clean) return 'unknown';
    if (clean === '::1' || clean === 'localhost' || /^127\./.test(clean)) return 'loopback';
    if (/^10\./.test(clean) || /^192\.168\./.test(clean) || /^169\.254\./.test(clean)) return 'private';
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(clean)) return 'private';
    if (/^(fc|fd|fe8|fe9|fea|feb)/i.test(clean)) return 'private';
    return 'public';
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
        network: networkClass(ip),
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
    return verifyStudioSessionToken(token);
}

function bearerToken(req) {
    return studioBearerToken(req);
}

function isTrustedLocalRequest(req) {
    return isTrustedStudioLocalRequest(req);
}

function actorFromProfile(profile) {
    const userId = profile.axis?.userId || profile.studio?.identity?.userId || '';
    if (!userId) return null;
    return actorWithSafety({
        userId,
        id: userId,
        handle: normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name) || 'owner',
        displayName: profile.axis?.displayName || profile.name || 'Owner',
        name: profile.axis?.displayName || profile.name || 'Owner',
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
    const handle = normalizeUsername(profile.axis?.handle || profile.publicIdentity?.handle || profile.name || 'owner') || 'owner';
    const displayName = String(profile.axis?.displayName || profile.name || 'Owner').trim() || 'Owner';
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
        const session = studioSessionActor(req);
        if (!session) return null;
        return actorWithSafety({
            userId: session.userId,
            id: session.userId,
            handle: session.handle,
            displayName: session.displayName,
            name: session.name,
            avatar: session.avatar,
            color: session.color,
            trustTier: session.trustTier,
            ageBand: session.ageBand,
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
    // Axis headers are a legacy convenience for local Command Bridge surfaces,
    // not authentication. Remote clients must present a signed Studio session.
    if (!isTrustedLocalRequest(req)) return null;
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
    'HUMAN_VERIFIED_YOUNG',
    'HUMAN_VERIFIED_CORE',
    'HUMAN_VERIFIED_MATURE',
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
    if (tier === 'VERIFIED') return 'HUMAN_VERIFIED_CORE';
    if (tier === 'UNVERIFIED') return 'ADULT_UNVERIFIED';
    if (tier === 'MINOR' || tier === 'UNDER_18' || tier === '18_AND_UNDER') return 'MINOR_VERIFIED';
    return 'UNKNOWN';
}

function normalizeAgeBand(value = '', trustTier = '') {
    const band = String(value || '').trim().toLowerCase();
    if (['young_adult', 'young', '18_22', '18-22'].includes(band)) return 'young_adult';
    if (['core_adult', 'core', '23_35', '23-35'].includes(band)) return 'core_adult';
    if (['mature_adult', 'mature', '36+', '36_plus'].includes(band)) return 'mature_adult';
    if (['u13', 'under13', 'under_13'].includes(band)) return 'u13';
    if (['minor', 'under18', 'under_18', '13_17', 'teen'].includes(band)) return 'minor';
    if (['adult', '18plus', '18_plus', '18+'].includes(band)) return 'core_adult';
    const tier = normalizeTrustTier(trustTier);
    if (tier === 'UNKNOWN') return 'unknown';
    if (tier === 'MINOR_PROTECTED_U13') return 'u13';
    if (tier === 'MINOR_VERIFIED') return 'minor';
    if (tier === 'HUMAN_VERIFIED_YOUNG') return 'young_adult';
    if (tier === 'HUMAN_VERIFIED_MATURE') return 'mature_adult';
    return 'core_adult';
}

function safetyProfile(entity = {}) {
    const trustTier = normalizeTrustTier(entity.trustTier || entity.safety?.trustTier);
    const ageBand = normalizeAgeBand(entity.ageBand || entity.safety?.ageBand, trustTier);
    const isHumanVerified = ['HUMAN_VERIFIED_YOUNG', 'HUMAN_VERIFIED_CORE', 'HUMAN_VERIFIED_MATURE', 'ADULT_VERIFIED'].includes(trustTier);
    return {
        trustTier,
        ageBand,
        isUnknownAge: ageBand === 'unknown' || trustTier === 'UNKNOWN',
        isMinor: ageBand === 'minor' || ageBand === 'u13',
        isYoungAdult: ageBand === 'young_adult',
        isCoreAdult: ageBand === 'core_adult',
        isMatureAdult: ageBand === 'mature_adult',
        isProtectedU13: ageBand === 'u13' || trustTier === 'MINOR_PROTECTED_U13',
        isVerified: isHumanVerified || trustTier === 'MINOR_VERIFIED' || trustTier === 'MINOR_PROTECTED_U13',
        isHumanVerified
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

function studioContentTarget(targetId) {
    const post = studioFeed.get(targetId);
    if (post) return { type: 'post', item: post, title: String(post.text || 'Studio post').slice(0, 120) };
    const signal = studioSignals.get(targetId);
    if (signal) return { type: 'signal', item: signal, title: String(signal.title || signal.description || 'Signal video').slice(0, 120) };
    return null;
}

function canViewStudioContent(viewer, target) {
    if (!target) return false;
    return target.type === 'signal' ? canViewSignal(viewer, target.item) : canViewPost(viewer, target.item);
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

function publicFeedPost(post = {}, viewer = null) {
    const viewerId = viewer?.userId || viewer?.id || '';
    const {
        feedback: _feedback,
        reports: _reports,
        ...safe
    } = post;
    const viewerLiked = Boolean(viewerId && Array.isArray(post.likers) && post.likers.includes(viewerId));
    const viewerDisliked = Boolean(viewerId && Array.isArray(post.dislikers) && post.dislikers.includes(viewerId));
    const viewerBookmarked = Boolean(viewerId && Array.isArray(post.bookmarkers) && post.bookmarkers.includes(viewerId));
    const viewerReposted = Boolean(viewerId && Array.isArray(post.reposters) && post.reposters.includes(viewerId));
    return {
        ...safe,
        // Legacy Stage checks these arrays for the current viewer. Never expose
        // the full membership lists because they are private interaction data.
        likers: viewerLiked ? [viewerId] : [],
        dislikers: viewerDisliked ? [viewerId] : [],
        bookmarkers: viewerBookmarked ? [viewerId] : [],
        reposters: viewerReposted ? [viewerId] : [],
        viewerLiked,
        viewerDisliked,
        viewerBookmarked,
        viewerReposted,
        canEdit: Boolean(viewerId && post.authorId === viewerId),
        reportCount: Number(post.reportCount || 0),
    };
}

function publicComment(comment = {}, viewer = null) {
    const viewerId = viewer?.userId || viewer?.id || '';
    const viewerLiked = Boolean(viewerId && Array.isArray(comment.likers) && comment.likers.includes(viewerId));
    const { likers: _likers, ...safe } = comment;
    return {
        ...safe,
        viewerLiked,
        canEdit: Boolean(viewerId && comment.who === viewerId),
    };
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

function publicSignal(signal = {}, viewer = null) {
    const viewerId = viewer?.userId || viewer?.id || '';
    const viewerLiked = Boolean(viewerId && Array.isArray(signal.likers) && signal.likers.includes(viewerId));
    const viewerDisliked = Boolean(viewerId && Array.isArray(signal.dislikers) && signal.dislikers.includes(viewerId));
    const viewerBookmarked = Boolean(viewerId && Array.isArray(signal.bookmarkers) && signal.bookmarkers.includes(viewerId));
    const viewerSubscribed = Boolean(viewerId && Array.isArray(signal.subscribersList) && signal.subscribersList.includes(viewerId));
    const viewerAlerts = Boolean(viewerId && Array.isArray(signal.alertSubscribers) && signal.alertSubscribers.includes(viewerId));
    const {
        likers: _likers,
        dislikers: _dislikers,
        bookmarkers: _bookmarkers,
        subscribersList: _subscribersList,
        alertSubscribers: _alertSubscribers,
        reports: _reports,
        viewers: _viewers,
        ...safe
    } = signal;
    return {
        ...safe,
        likes: Number(signal.likes || 0),
        dislikes: Number(signal.dislikes || 0),
        bookmarks: Number(signal.bookmarks || 0),
        subscriptions: Number(signal.subscriptions || (Array.isArray(signal.subscribersList) ? signal.subscribersList.length : 0)),
        alerts: Number(signal.alerts || (Array.isArray(signal.alertSubscribers) ? signal.alertSubscribers.length : 0)),
        viewerLiked,
        viewerDisliked,
        viewerBookmarked,
        viewerSubscribed,
        viewerAlerts,
        canEdit: Boolean(viewerId && signal.authorId === viewerId),
    };
}

function publicLiveRoom(room = {}, viewer = null) {
    const viewerId = viewer?.userId || viewer?.id || '';
    const chat = Array.isArray(room.chat) ? room.chat : [];
    const reactions = Array.isArray(room.reactions) ? room.reactions : [];
    const publicReactions = reactions.map(reaction => ({
        id: reaction.id,
        kind: reaction.kind,
        createdAt: reaction.createdAt,
    }));
    return {
        ...room,
        viewers: Number(room.viewers || 0),
        reactionCount: Number(room.reactionCount || reactions.length || 0),
        chat: chat.slice(-120),
        reactions: publicReactions.slice(-80),
        viewerIsHost: Boolean(viewerId && room.authorId === viewerId),
        canEdit: Boolean(viewerId && room.authorId === viewerId),
    };
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
        version: 2,
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
        social: {
            canonicalAcrossClients: true,
            authenticatedAttribution: true,
            offlineMocksExcludedWhenOnline: true,
            endpoints: {
                feed: 'GET /api/studio/feed',
                createPost: 'POST /api/studio/feed',
                updatePost: 'PATCH /api/studio/feed/:id',
                deletePost: 'DELETE /api/studio/feed/:id',
                likePost: 'POST /api/studio/feed/:id/like',
                dislikePost: 'POST /api/studio/feed/:id/dislike',
                comments: 'GET|POST /api/studio/posts/:postId/comments',
                updateComment: 'PATCH /api/studio/posts/:postId/comments/:commentId',
                deleteComment: 'DELETE /api/studio/posts/:postId/comments/:commentId',
                axisActivity: 'GET /api/studio/axis/activity',
                activityThread: 'GET /api/studio/axis/activity/:id',
                quickReply: 'POST /api/studio/axis/activity/:id/reply',
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
    if (typeof system?.broadcast === 'function') {
        studioAxisEvents.attachBroadcaster((type, payload) => system.broadcast(type, payload));
    }
    studioAxisEvents.bridge('studio-live-store', () => studioLive.subscribe(event => {
        studioAxisEvents.publish(`studio.live.${event.type}`, event, {
            source: 'studio-live',
            actorId: event.signal?.actorId || event.message?.userId || '',
            targetId: event.roomId || event.room?.id || '',
            ephemeral: String(event.type || '').startsWith('webrtc_'),
        });
    }));
    router.use(studioSecurityGateway);
    // Bring the resident agent users online — they follow you back, post, and engage.
    if (process.env.STUDIO_DISABLE_AGENTS !== '1') {
        try { maxwellAgent.start(); } catch (e) { console.warn('[Maxwell] failed to start:', e.message); }
        try { somaStudioAgent.start(); } catch (e) { console.warn('[SOMA/Studio] failed to start:', e.message); }
    }

    // Emit a notification for a recipient, resolving the actor's name/avatar.
    const notify = (userId, kind, actorId, text, targetId, metadata = {}) => {
        try {
            if (!userId || userId === actorId) return;
            const actor = studioUsers.get(actorId) || {};
            const item = studioNotifications.add({ userId, kind, actorId, actorName: actor.name || actorId, actorAvatar: actor.avatar || '', text, targetId: targetId || '', ...metadata });
            if (item) studioAxisEvents.publish(`studio.notification.${kind}`, item, {
                source: 'studio',
                actorId,
                targetId: targetId || '',
                audience: [userId],
            });
        } catch { /* notifications are best-effort */ }
    };
    const notifyFollowers = (actor, kind, text, targetId, metadata = {}) => {
        try {
            for (const userId of studioFollows.getFollowers(actor.userId)) {
                notify(userId, kind, actor.userId, text, targetId, metadata);
            }
        } catch { /* follower fan-out is best-effort */ }
    };
    const emitStudioAction = (kind, actor, targetId, payload = {}, audience = []) => {
        try {
            return studioAxisEvents.publish(`studio.${kind}`, payload, {
                source: 'studio',
                actorId: actor?.userId || actor?.id || '',
                targetId,
                audience,
            });
        } catch { return null; }
    };

    router.get('/uploads/:name', (req, res) => {
        try {
            const name = path.basename(String(req.params.name || ''));
            if (!name) return res.status(404).end();
            const file = path.join(STUDIO_UPLOAD_DIR, name);
            if (!fs.existsSync(file)) return res.status(404).json({ ok: false, error: 'Upload not found' });
            res.sendFile(name, { root: STUDIO_UPLOAD_DIR });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/capabilities', (_req, res) => {
        res.json(studioApiContract());
    });

    // One ordered Studio/Axis event stream for notifications, Directs, comments,
    // live rooms, reactions, and WebRTC signaling.
    router.get('/events/history', (req, res) => {
        const actor = requireActor(req, res, { allowRestricted: true });
        if (!actor) return;
        const targetId = String(req.query.targetId || '');
        const events = studioAxisEvents.history({
            typePrefix: String(req.query.typePrefix || ''),
            targetId,
            userId: actor.userId,
            limit: req.query.limit,
            before: req.query.before,
        }).filter(event => targetId || !event.type?.startsWith('studio.live.webrtc_'));
        res.json({ ok: true, events });
    });

    router.get('/events', (req, res) => {
        const actor = requireActor(req, res, { allowRestricted: true });
        if (!actor) return;
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        const typePrefix = String(req.query.typePrefix || '');
        const targetId = String(req.query.targetId || '');
        const send = event => {
            // SDP and ICE are room-scoped, ephemeral secrets. Never fan them out
            // through the general social stream.
            if (!targetId && event.type?.startsWith('studio.live.webrtc_')) return;
            res.write('event: studio-axis\n');
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        send({ type: 'connected', actorId: actor.userId, createdAt: Date.now() });
        const off = studioAxisEvents.subscribe(send, { typePrefix, targetId, userId: actor.userId });
        const keepAlive = setInterval(() => {
            res.write('event: ping\n');
            res.write(`data: ${JSON.stringify({ createdAt: Date.now() })}\n\n`);
        }, 25000);
        req.on('close', () => {
            clearInterval(keepAlive);
            off();
        });
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

    registerStudioIdentityRoutes(router, {
        PAIRING_TTL_MS,
        STUDIO_SESSIONS_FILE,
        USER_REGISTRY_FILE,
        actorFromSession,
        axisProfileStore,
        codeHash,
        createPairingCode,
        createProtectedPublicHandle,
        createStudioUserId,
        crypto,
        deviceInfoFromReq,
        hashSecret,
        isLegacySecretHash,
        isPortableStudioId,
        isRestrictedActor,
        isTrustedLocalRequest,
        issueSession,
        loadProfile,
        normalizeAgeBand,
        normalizeTrustTier,
        normalizeUsername,
        pairingRegistry,
        platformAuthorityOk,
        publicDeviceSession,
        publicIdentityUser,
        publicPairing,
        publicStudioUser,
        recordRiskEvent,
        rejectRawVerificationMedia,
        resolveActor,
        riskEventRegistry,
        safetyAliasRequired,
        safetyProfile,
        saveProfile,
        sessionRegistry,
        studioUsers,
        usernameRegistry,
        usernameStatus,
        verificationStatusFor,
        verifySecret,
        writeJsonSafe,
        writePairingRegistry,
    });

    registerStudioModerationRoutes(router, {
        STUDIO_RATE_BUCKETS,
        TRUST_TIERS,
        USER_REGISTRY_FILE,
        banStudioUser,
        botDisclosureFor,
        canViewUser,
        computeBehaviorRisk,
        normalizeAccountType,
        normalizeAgeBand,
        normalizeTrustTier,
        platformAuthorityOk,
        publicIdentityUser,
        publicSecurityScan,
        publicStudioUser,
        recordDirectSecurityScan,
        recordRiskEvent,
        resolveActor,
        safetyProfile,
        scanDirectForScam,
        securityRegistry,
        studioUsers,
        usernameRegistry,
        writeJsonSafe,
        writeSecurityRegistry,
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

    router.post('/profile/avatar', upload.single('avatar'), (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ ok: false, error: 'Avatar file is required' });
            const avatarUrl = `/api/studio/uploads/${encodeURIComponent(req.file.filename)}`;
            const profile = loadProfile();
            const savedProfile = saveProfile({
                ...profile,
                avatar: avatarUrl,
            });
            axisProfileStore.recordActivity({
                type: 'studio_avatar_updated',
                title: 'Avatar updated',
                summary: 'Studio profile avatar was refreshed.',
                source: 'studio-profile',
            }, savedProfile);
            res.json({ ok: true, avatarUrl, filename: req.file.filename, profile: savedProfile });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
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

    registerStudioAxisRoutes(router, { axisProfileStore, loadProfile, publicSecurityScan, recordDirectSecurityScan, requireActor, scanDirectForScam });

    registerStudioFeedRoutes(router, { resolveActor, requireActor, studioContentTarget, canViewStudioContent, publicComment, notify, emitStudioAction, rankStudioFeedForViewer, publicFeedPost, canViewPost });

    registerStudioLiveRoutes(router, { resolveActor, requireActor, notifyFollowers, publicLiveRoom });

    registerStudioSignalRoutes(router, { signalVideoUpload, resolveActor, requireActor, rankStudioSignalsForViewer, publicSignal, canViewSignal, notify, notifyFollowers, emitStudioAction });

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
            emitStudioAction('follow.created', actor, followeeId, { followerId, followeeId });
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
            emitStudioAction('follow.deleted', actor, followeeId, { followerId, followeeId });
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
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            if (actor.userId !== req.params.userId && !isTrustedLocalRequest(req)) {
                return res.status(403).json({ ok: false, error: 'Cannot read another user notifications.' });
            }
            res.json({ ok: true, notifications: studioNotifications.list(req.params.userId), unread: studioNotifications.unread(req.params.userId) });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    // Axis conversation activity: comments on owned posts and Signals become
    // actionable inbox entries rather than passive notification text.
    router.get('/axis/activity', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const items = studioNotifications.list(actor.userId, { limit: Math.min(Number(req.query.limit) || 60, 200) })
                .filter(item => ['comment', 'signal_comment', 'comment_reply'].includes(item.kind));
            res.json({ ok: true, items, unread: items.filter(item => !item.read).length });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.get('/axis/activity/:id', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const item = studioNotifications.get(req.params.id);
            if (!item || item.userId !== actor.userId) return res.status(404).json({ ok: false, error: 'Activity not found.' });
            const target = studioContentTarget(item.targetId);
            if (!target || !canViewStudioContent(actor, target)) return res.status(404).json({ ok: false, error: 'Content not found.' });
            const event = studioNotifications.markOne(actor.userId, item.id);
            res.json({
                ok: true,
                item: event,
                content: { id: target.item.id, type: target.type, title: target.title, text: target.item.text || target.item.description || '', media: target.item.media || target.item.video || null },
                comments: studioComments.list(item.targetId).map(comment => publicComment(comment, actor)),
            });
        } catch (e) {
            res.status(500).json({ ok: false, error: e.message });
        }
    });

    router.post('/axis/activity/:id/read', (req, res) => {
        try {
            const actor = requireActor(req, res, { allowRestricted: true });
            if (!actor) return;
            const item = studioNotifications.markOne(actor.userId, req.params.id);
            if (!item) return res.status(404).json({ ok: false, error: 'Activity not found.' });
            res.json({ ok: true, item });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
        }
    });

    router.post('/axis/activity/:id/reply', (req, res) => {
        try {
            const actor = requireActor(req, res);
            if (!actor) return;
            const item = studioNotifications.get(req.params.id);
            if (!item || item.userId !== actor.userId) return res.status(404).json({ ok: false, error: 'Activity not found.' });
            const target = studioContentTarget(item.targetId);
            if (!target || !canViewStudioContent(actor, target)) return res.status(404).json({ ok: false, error: 'Content not found.' });
            const comment = studioComments.add(item.targetId, {
                text: req.body?.text,
                parentId: item.commentId || null,
                who: actor.userId,
                name: actor.displayName || actor.name || actor.handle,
                avatar: actor.avatar || '',
            });
            studioNotifications.markOne(actor.userId, item.id);
            notify(item.actorId, 'comment_reply', actor.userId, `replied: "${comment.text.slice(0, 80)}"`, item.targetId, {
                targetType: target.type,
                targetTitle: target.title,
                commentId: comment.id,
                parentCommentId: item.commentId || '',
                deepLink: `/studio/${target.type}/${encodeURIComponent(item.targetId)}?comments=1&comment=${encodeURIComponent(comment.id)}`,
            });
            res.status(201).json({ ok: true, comment: publicComment(comment, actor), comments: studioComments.list(item.targetId).map(entry => publicComment(entry, actor)) });
        } catch (e) {
            res.status(400).json({ ok: false, error: e.message });
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

    // ── People registry — real users beyond Owner (agents like Maxwell) ────────
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
                .map(item => `${item.role === 'user' ? 'Owner' : 'SOMA'}: ${item.text || item.content || ''}`)
                .filter(Boolean)
                .join('\n');

            const prompt = [
                'You are SOMA inside Studio, the user profile and identity control layer for Command Bridge.',
                'Speak as SOMA, not as Gemini, a generic assistant, or a separate bot.',
                'Use the profile context below to help Owner shape Studio, Axis identity, projects, public voice, and communication workflows.',
                'Be concise, practical, honest, and high-agency. If a request needs implementation work, suggest the smallest concrete next step.',
                '',
                '[STUDIO PROFILE CONTEXT]',
                profileContext(profile),
                '',
                historyText ? '[RECENT STUDIO CHAT]\n' + historyText + '\n' : '',
                `[OWNER]\n${message}`,
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
