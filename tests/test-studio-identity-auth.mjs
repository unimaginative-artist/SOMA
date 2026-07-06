import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import express from 'express';

const originalCwd = process.cwd();
const previousStrict = process.env.STUDIO_STRICT_AUTH;
const previousAgents = process.env.STUDIO_DISABLE_AGENTS;
const previousSecret = process.env.STUDIO_AUTH_SECRET;
const previousWebhook = process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-auth-'));

process.env.STUDIO_STRICT_AUTH = '1';
process.env.STUDIO_DISABLE_AGENTS = '1';
process.env.STUDIO_AUTH_SECRET = 'test-secret-with-at-least-thirty-two-bytes';
process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET = 'test-verification-webhook-secret-32';
process.chdir(tempRoot);

const routeUrl = new URL('../server/routes/studioRoutes.js', pathToFileURL(path.join(originalCwd, 'tests', 'test-studio-identity-auth.mjs')));
routeUrl.searchParams.set('run', String(Date.now()));
const { default: createStudioRoutes } = await import(routeUrl.href);

const app = express();
app.use(express.json());
app.use('/api/studio', createStudioRoutes({}));

const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const base = `http://127.0.0.1:${server.address().port}/api/studio`;

async function json(pathname, options = {}) {
    const response = await fetch(`${base}${pathname}`, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {}),
        },
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

function readStore(name, fallback) {
    try { return JSON.parse(fs.readFileSync(path.join(tempRoot, 'SOMA', name), 'utf8')); } catch { return fallback; }
}

function writeStore(name, data) {
    fs.mkdirSync(path.join(tempRoot, 'SOMA'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'SOMA', name), JSON.stringify(data, null, 2));
}

function setSafety(userId, trustTier, ageBand) {
    const people = readStore('studio-people.json', { users: [] });
    people.users = (people.users || []).map(user => user.id === userId
        ? { ...user, trustTier, ageBand, verified: trustTier !== 'UNKNOWN' }
        : user);
    writeStore('studio-people.json', people);

    const registry = readStore('studio-users.json', { users: {} });
    for (const [handle, record] of Object.entries(registry.users || {})) {
        if (record.userId === userId) registry.users[handle] = { ...record, trustTier, ageBand };
    }
    writeStore('studio-users.json', registry);
}

try {
    const capabilities = await json('/capabilities');
    assert.equal(capabilities.response.status, 200);
    assert.equal(capabilities.data.transparency.botDisclosureRequired, true);
    assert.equal(capabilities.data.verification.rawMediaAccepted, false);

    const denied = await json('/feed', {
        method: 'POST',
        body: JSON.stringify({ text: 'anonymous write should fail', authorId: 'usr-soma' }),
    });
    assert.equal(denied.response.status, 401);

    const registered = await json('/identity/register', {
        method: 'POST',
        body: JSON.stringify({ username: 'alice_test', displayName: 'Alice Test', passcode: 'correct horse' }),
    });
    assert.equal(registered.response.status, 200);
    assert.equal(registered.data.ok, true);
    assert.match(registered.data.user.userId, /^usr-[a-f0-9]{64}$/);
    assert.equal(registered.data.user.trustTier, 'UNKNOWN');
    assert.equal(registered.data.user.ageBand, 'unknown');
    assert.equal(typeof registered.data.token, 'string');
    assert.equal(typeof registered.data.session.sessionId, 'string');
    assert.equal(registered.data.session.userId, registered.data.user.userId);

    const auth = { Authorization: `Bearer ${registered.data.token}` };
    const post = await json('/feed', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            text: 'session-authored post',
            authorId: 'usr-soma',
            authorName: 'Spoofed SOMA',
        }),
    });
    assert.equal(post.response.status, 200);
    assert.equal(post.data.post.authorId, registered.data.user.userId);
    assert.equal(post.data.post.authorName, 'Alice Test');

    const like = await json(`/feed/${encodeURIComponent(post.data.post.id)}/like`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', delta: 1 }),
    });
    assert.equal(like.response.status, 200);
    assert.deepEqual(like.data.post.likers, [registered.data.user.userId]);

    const dislike = await json(`/feed/${encodeURIComponent(post.data.post.id)}/dislike`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', enabled: true }),
    });
    assert.equal(dislike.response.status, 200);
    assert.deepEqual(dislike.data.post.dislikers, [registered.data.user.userId]);
    assert.deepEqual(dislike.data.post.likers, []);

    const unlikeDislike = await json(`/feed/${encodeURIComponent(post.data.post.id)}/dislike`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ enabled: false }),
    });
    assert.equal(unlikeDislike.response.status, 200);
    assert.deepEqual(unlikeDislike.data.post.dislikers, []);

    const repost = await json(`/feed/${encodeURIComponent(post.data.post.id)}/repost`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', enabled: true }),
    });
    assert.equal(repost.response.status, 200);
    assert.deepEqual(repost.data.post.reposters, [registered.data.user.userId]);

    const bookmark = await json(`/feed/${encodeURIComponent(post.data.post.id)}/bookmark`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', enabled: true }),
    });
    assert.equal(bookmark.response.status, 200);
    assert.deepEqual(bookmark.data.post.bookmarkers, [registered.data.user.userId]);

    const bookmarks = await json('/feed/bookmarks/me', { headers: auth });
    assert.equal(bookmarks.response.status, 200);
    assert.equal(bookmarks.data.posts.some(item => item.id === post.data.post.id), true);

    const report = await json(`/feed/${encodeURIComponent(post.data.post.id)}/report`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', reason: 'ai', note: 'test report' }),
    });
    assert.equal(report.response.status, 200);
    assert.equal(report.data.post.reports[0].userId, registered.data.user.userId);
    assert.equal(report.data.post.reports[0].reason, 'ai');

    const quotaStore = readStore('studio-feed.json', { posts: [] });
    const quotaBase = Date.now() - (2 * 60 * 60 * 1000);
    for (let i = 0; i < 25; i += 1) {
        quotaStore.posts.push({
            id: `quota-${i}`,
            authorId: registered.data.user.userId,
            authorName: 'Alice Test',
            text: `quota dislike target ${i}`,
            type: 'text',
            likes: 0,
            dislikes: 1,
            likers: [],
            dislikers: [registered.data.user.userId],
            feedback: [{
                userId: registered.data.user.userId,
                type: 'dislike',
                enabled: true,
                createdAt: quotaBase + i,
                updatedAt: quotaBase + i,
            }],
            createdAt: quotaBase + i,
        });
    }
    writeStore('studio-feed.json', quotaStore);
    const overLimitPost = await json('/feed', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ text: 'quota dislike target over limit' }),
    });
    assert.equal(overLimitPost.response.status, 200);
    const overLimitDislike = await json(`/feed/${encodeURIComponent(overLimitPost.data.post.id)}/dislike`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ enabled: true }),
    });
    assert.equal(overLimitDislike.response.status, 429);
    assert.equal(overLimitDislike.data.code, 'DISLIKE_DAILY_LIMIT');

    const form = new FormData();
    form.append('video', new Blob([Buffer.from('fake-video-bytes')], { type: 'video/mp4' }), 'tiny.mp4');
    const uploadResponse = await fetch(`${base}/signals/upload`, {
        method: 'POST',
        headers: auth,
        body: form,
    });
    const uploadData = await uploadResponse.json();
    assert.equal(uploadResponse.status, 200);
    assert.equal(uploadData.media.kind, 'video');
    assert.match(uploadData.media.url, /^\/api\/studio\/uploads\//);

    const signal = await json('/signals', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
            title: 'session-authored signal',
            description: 'video metadata should persist',
            category: 'Science',
            visibility: 'Public',
            media: [uploadData.media],
            authorId: 'usr-soma',
            authorName: 'Spoofed SOMA',
        }),
    });
    assert.equal(signal.response.status, 200);
    assert.equal(signal.data.signal.authorId, registered.data.user.userId);
    assert.equal(signal.data.signal.authorName, 'Alice Test');
    assert.equal(signal.data.signal.category, 'Science');
    assert.equal(signal.data.signal.media[0].url, uploadData.media.url);

    const signalLike = await json(`/signals/${encodeURIComponent(signal.data.signal.id)}/like`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', delta: 1 }),
    });
    assert.equal(signalLike.response.status, 200);
    assert.deepEqual(signalLike.data.signal.likers, [registered.data.user.userId]);

    const signalDislike = await json(`/signals/${encodeURIComponent(signal.data.signal.id)}/dislike`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ userId: 'usr-maxwell', enabled: true }),
    });
    assert.equal(signalDislike.response.status, 200);
    assert.deepEqual(signalDislike.data.signal.dislikers, [registered.data.user.userId]);
    assert.deepEqual(signalDislike.data.signal.likers, []);

    const signalList = await json('/signals?limit=20', { headers: auth });
    assert.equal(signalList.response.status, 200);
    assert.equal(signalList.data.signals.some(item => item.id === signal.data.signal.id), true);

    const comment = await json(`/posts/${encodeURIComponent(post.data.post.id)}/comments`, {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ who: 'usr-maxwell', name: 'Maxwell', text: 'cannot spoof comments' }),
    });
    assert.equal(comment.response.status, 200);
    assert.equal(comment.data.comment.who, registered.data.user.userId);
    assert.equal(comment.data.comment.name, 'Alice Test');

    const blockedFollow = await json('/follow', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ followerId: 'usr-maxwell', followeeId: 'usr-soma' }),
    });
    assert.equal(blockedFollow.response.status, 403);

    const unknownDiscovery = await json('/users', { headers: auth });
    assert.equal(unknownDiscovery.response.status, 200);
    assert.deepEqual(unknownDiscovery.data.users.map(user => user.id), [registered.data.user.userId]);

    const session = await json('/identity/session', { headers: auth });
    assert.equal(session.response.status, 200);
    assert.equal(session.data.user.userId, registered.data.user.userId);

    const devices = await json('/identity/devices', { headers: auth });
    assert.equal(devices.response.status, 200);
    assert.equal(devices.data.sessions.some(item => item.sessionId === registered.data.session.sessionId), true);

    const riskEvents = await json('/identity/risk-events', { headers: auth });
    assert.equal(riskEvents.response.status, 200);
    assert.equal(riskEvents.data.events.some(item => item.type === 'device_session_created'), true);

    const settings = await json('/settings', { headers: auth });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.data.settings.ai.somaActive, true);
    assert.equal(settings.data.settings.security.cameraVerification, true);
    assert.equal(settings.data.user.userId, registered.data.user.userId);

    const settingsUpdate = await json('/settings', {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
            scope: 'privacy',
            patch: { privateMode: true, whoCanDirect: 'followers' },
        }),
    });
    assert.equal(settingsUpdate.response.status, 200);
    assert.equal(settingsUpdate.data.settings.privacy.privateMode, true);
    assert.equal(settingsUpdate.data.settings.privacy.whoCanDirect, 'followers');

    const settingsAgain = await json('/settings', { headers: auth });
    assert.equal(settingsAgain.response.status, 200);
    assert.equal(settingsAgain.data.settings.privacy.privateMode, true);
    assert.equal(settingsAgain.data.riskEvents.some(item => item.type === 'studio_settings_updated'), true);

    const pairingStart = await json('/identity/pairing/start', {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({ mode: 'lan', deviceType: 'command_bridge', deviceName: 'Test Bridge' }),
    });
    assert.equal(pairingStart.response.status, 200);
    assert.match(pairingStart.data.pairing.pairingId, /^pair-/);
    assert.match(pairingStart.data.code, /^\d{6}$/);
    assert.equal(pairingStart.data.qrPayload.type, 'studio-device-pairing');

    const phoneHeaders = {
        'x-studio-device-id': 'phone-test-device',
        'x-studio-device-name': 'Barry Phone',
        'x-studio-device-type': 'phone',
    };
    const pairingRequest = await json(`/identity/pairing/${encodeURIComponent(pairingStart.data.pairing.pairingId)}/request`, {
        method: 'POST',
        headers: phoneHeaders,
        body: JSON.stringify({ code: pairingStart.data.code }),
    });
    assert.equal(pairingRequest.response.status, 200);
    assert.equal(pairingRequest.data.pairing.status, 'requested');
    assert.equal(pairingRequest.data.pairing.phoneDevice.deviceId, 'phone-test-device');

    const pairingApprove = await json(`/identity/pairing/${encodeURIComponent(pairingStart.data.pairing.pairingId)}/approve`, {
        method: 'POST',
        headers: auth,
    });
    assert.equal(pairingApprove.response.status, 200);
    assert.equal(pairingApprove.data.pairing.status, 'approved');
    assert.equal(pairingApprove.data.session.deviceType, 'phone');

    const pairingComplete = await json(`/identity/pairing/${encodeURIComponent(pairingStart.data.pairing.pairingId)}/complete`, {
        method: 'POST',
        body: JSON.stringify({ code: pairingStart.data.code }),
    });
    assert.equal(pairingComplete.response.status, 200);
    assert.equal(pairingComplete.data.session.deviceId, 'phone-test-device');
    assert.equal(typeof pairingComplete.data.token, 'string');

    const pairedAuth = { Authorization: `Bearer ${pairingComplete.data.token}` };
    const pairedSession = await json('/identity/session', { headers: pairedAuth });
    assert.equal(pairedSession.response.status, 200);
    assert.equal(pairedSession.data.user.userId, registered.data.user.userId);

    const pairingRiskEvents = await json('/identity/risk-events', { headers: auth });
    assert.equal(pairingRiskEvents.data.events.some(item => item.type === 'pairing_completed'), true);

    const scamScan = await json('/security/directs/scan', {
        method: 'POST',
        body: JSON.stringify({
            text: 'Urgent account verification required. Send your password and recovery phrase now at https://studio-support.xyz',
            chatId: 'axis-security-test',
        }),
    });
    assert.equal(scamScan.response.status, 200);
    assert.ok(['quarantine', 'ban_recommend'].includes(scamScan.data.scan.verdict));

    const quarantinedDirect = await json('/axis/chats/axis-security-test/messages', {
        method: 'POST',
        body: JSON.stringify({
            sender: 'other',
            text: 'Urgent account verification required. Send your password and recovery phrase now at https://studio-support.xyz',
        }),
    });
    assert.equal(quarantinedDirect.response.status, 202);
    assert.equal(quarantinedDirect.data.quarantined, true);
    assert.equal(quarantinedDirect.data.message, null);
    assert.ok(['quarantine', 'ban_recommend'].includes(quarantinedDirect.data.security.verdict));

    const securityStatus = await json('/security/status', {
        headers: { 'x-studio-verification-secret': process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET },
    });
    assert.equal(securityStatus.response.status, 200);
    assert.equal(securityStatus.data.gateway.active, true);
    assert.equal(securityStatus.data.recentDirectScans.some(item => ['quarantine', 'ban_recommend'].includes(item.verdict)), true);

    const meUnknown = await json('/identity/me', { headers: auth });
    assert.equal(meUnknown.response.status, 200);
    assert.equal(meUnknown.data.permissions.canFollow, false);
    assert.equal(meUnknown.data.verification.required, true);

    const rawMediaRejected = await json('/verification/attestation', {
        method: 'POST',
        headers: { 'x-studio-verification-secret': process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET },
        body: JSON.stringify({
            userId: registered.data.user.userId,
            trustTier: 'ADULT_VERIFIED',
            ageBand: 'adult',
            provider: 'test-provider',
            verificationRef: 'ref-raw-media',
            selfieImage: 'base64-data',
        }),
    });
    assert.equal(rawMediaRejected.response.status, 400);

    setSafety(registered.data.user.userId, 'ADULT_VERIFIED', 'adult');
    const adultSession = await json('/identity/session', { headers: auth });
    assert.equal(adultSession.data.user.trustTier, 'ADULT_VERIFIED');

    const verificationAttestation = await json('/verification/attestation', {
        method: 'POST',
        headers: { 'x-studio-verification-secret': process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET },
        body: JSON.stringify({
            userId: registered.data.user.userId,
            trustTier: 'ADULT_VERIFIED',
            ageBand: 'adult',
            provider: 'test-provider',
            verificationRef: 'ref-adult',
            evidenceHash: 'sha256:test',
        }),
    });
    assert.equal(verificationAttestation.response.status, 200);
    assert.equal(verificationAttestation.data.verification.verified, true);

    const adultUsers = await json('/users', { headers: auth });
    const somaUser = adultUsers.data.users.find(user => user.id === 'usr-soma');
    assert.equal(somaUser.accountType, 'bot');
    assert.equal(somaUser.botDisclosure.label, 'BOT');

    const disclosure = await json('/users/usr-soma/disclosure', { headers: auth });
    assert.equal(disclosure.response.status, 200);
    assert.equal(disclosure.data.accountType, 'bot');

    const accountTypeChanged = await json(`/users/${encodeURIComponent(registered.data.user.userId)}/account-type`, {
        method: 'PUT',
        headers: { 'x-studio-verification-secret': process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET },
        body: JSON.stringify({
            accountType: 'bot',
            botDisclosure: { label: 'BOT', description: 'Test automation account.' },
        }),
    });
    assert.equal(accountTypeChanged.response.status, 200);
    assert.equal(accountTypeChanged.data.user.accountType, 'bot');
    assert.equal(accountTypeChanged.data.user.botDisclosure.label, 'BOT');

    const teen = await json('/identity/register', {
        method: 'POST',
        body: JSON.stringify({ username: 'teen_test', displayName: 'Teen Test', passcode: 'correct horse' }),
    });
    assert.equal(teen.response.status, 200);
    setSafety(teen.data.user.userId, 'MINOR_VERIFIED', 'minor');
    const teenAuth = { Authorization: `Bearer ${teen.data.token}` };

    const feed = readStore('studio-feed.json', { posts: [] });
    feed.posts.push({
        id: 'p-minor-safety-test',
        authorId: teen.data.user.userId,
        authorName: 'Teen Test',
        text: 'minor-only post',
        authorTrustTier: 'MINOR_VERIFIED',
        authorAgeBand: 'minor',
        likes: 0,
        createdAt: Date.now() + 1,
    });
    writeStore('studio-feed.json', feed);

    const adultFeed = await json('/feed?limit=20', { headers: auth });
    assert.equal(adultFeed.response.status, 200);
    assert.equal(adultFeed.data.posts.some(item => item.id === 'p-minor-safety-test'), false);

    const revoke = await json(`/identity/devices/${encodeURIComponent(registered.data.session.sessionId)}`, {
        method: 'DELETE',
        headers: auth,
    });
    assert.equal(revoke.response.status, 200);
    assert.ok(revoke.data.session.revokedAt);

    const revokedSession = await json('/identity/session', { headers: auth });
    assert.equal(revokedSession.response.status, 401);

    const teenFeed = await json('/feed?limit=20', { headers: teenAuth });
    assert.equal(teenFeed.response.status, 200);
    assert.equal(teenFeed.data.posts.some(item => item.id === 'p-minor-safety-test'), true);
    assert.equal(teenFeed.data.posts.some(item => item.id === post.data.post.id), false);
} finally {
    await new Promise(resolve => server.close(resolve));
    process.chdir(originalCwd);
    if (previousStrict === undefined) delete process.env.STUDIO_STRICT_AUTH;
    else process.env.STUDIO_STRICT_AUTH = previousStrict;
    if (previousAgents === undefined) delete process.env.STUDIO_DISABLE_AGENTS;
    else process.env.STUDIO_DISABLE_AGENTS = previousAgents;
    if (previousSecret === undefined) delete process.env.STUDIO_AUTH_SECRET;
    else process.env.STUDIO_AUTH_SECRET = previousSecret;
    if (previousWebhook === undefined) delete process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET;
    else process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET = previousWebhook;
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('studio identity auth regression passed');
