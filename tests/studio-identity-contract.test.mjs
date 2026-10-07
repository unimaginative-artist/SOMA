import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

const originalCwd = process.cwd();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-identity-'));
fs.mkdirSync(path.join(tempRoot, 'SOMA'), { recursive: true });
process.chdir(tempRoot);
process.env.STUDIO_STRICT_AUTH = '1';
process.env.STUDIO_DISABLE_AGENTS = '1';
process.env.STUDIO_VERIFICATION_WEBHOOK_SECRET = 'contract-verification-secret';

const routeUrl = new URL('../server/routes/studioRoutes.js', import.meta.url);
routeUrl.searchParams.set('contract', String(Date.now()));
const { default: createStudioRoutes } = await import(routeUrl.href);

const app = express();
app.use(express.json());
app.use('/api/studio', createStudioRoutes({}));
const server = http.createServer(app);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/api/studio`;

async function request(route, { method = 'GET', body, token, deviceId = 'dev-contract-owner', headers = {} } = {}) {
    const response = await fetch(base + route, {
        method,
        headers: {
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            'x-studio-device-id': deviceId,
            'x-studio-device-name': 'Contract test',
            'x-studio-device-type': 'test',
            ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
}

test.after(async () => {
    await new Promise(resolve => server.close(resolve));
    const { default: eventBus } = await import('../server/studio/StudioAxisEventBus.js');
    eventBus.close();
    const { default: mediaPipeline } = await import('../server/studio/StudioMediaPipeline.js');
    mediaPipeline.close();
    process.chdir(originalCwd);
    fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('Studio identity contract enforces sessions through pairing and revocation', async () => {
    const anonymous = await request('/settings');
    assert.equal(anonymous.response.status, 401);

    const spoof = await request('/settings', {
        method: 'PUT',
        body: { scope: 'privacy', patch: { privateMode: true } },
        headers: { 'x-axis-user-id': 'usr-spoofed', 'x-axis-user-name': 'Spoofed' },
    });
    assert.equal(spoof.response.status, 401, 'remote Axis headers must never authenticate');

    const registered = await request('/identity/register', {
        method: 'POST',
        body: { username: 'contract-owner', displayName: 'Contract Owner', passcode: 'test-passcode' },
    });
    assert.equal(registered.response.status, 200);
    assert.match(registered.data.user.userId, /^usr-[a-f0-9]{64}$/);
    assert.ok(registered.data.token);

    const ownerToken = registered.data.token;
    const settings = await request('/settings', {
        method: 'PUT',
        token: ownerToken,
        body: { scope: 'privacy', patch: { privateMode: true } },
    });
    assert.equal(settings.response.status, 200);
    assert.equal(settings.data.settings.privacy.privateMode, true);

    const started = await request('/identity/pairing/start', {
        method: 'POST', token: ownerToken, body: { mode: 'lan' },
    });
    assert.equal(started.response.status, 200);
    const { pairingId } = started.data.pairing;
    const code = started.data.code;

    const pairingRequest = await request(`/identity/pairing/${pairingId}/request`, {
        method: 'POST', deviceId: 'dev-contract-phone', body: { code },
    });
    assert.equal(pairingRequest.response.status, 200);
    assert.equal(pairingRequest.data.pairing.status, 'requested');

    const approved = await request(`/identity/pairing/${pairingId}/approve`, {
        method: 'POST', token: ownerToken, body: {},
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.data.pairing.status, 'approved');

    const wrongDevice = await request(`/identity/pairing/${pairingId}/complete`, {
        method: 'POST', deviceId: 'dev-not-the-approved-phone', body: { code },
    });
    assert.equal(wrongDevice.response.status, 403);

    const completed = await request(`/identity/pairing/${pairingId}/complete`, {
        method: 'POST', deviceId: 'dev-contract-phone', body: { code },
    });
    assert.equal(completed.response.status, 200);
    assert.ok(completed.data.token);
    assert.equal(completed.data.user.userId, registered.data.user.userId);

    const pairedMe = await request('/identity/me', { token: completed.data.token, deviceId: 'dev-contract-phone' });
    assert.equal(pairedMe.response.status, 200);
    assert.equal(pairedMe.data.user.userId, registered.data.user.userId);

    const revoked = await request(`/identity/devices/${completed.data.session.sessionId}`, {
        method: 'DELETE', token: ownerToken, body: {},
    });
    assert.equal(revoked.response.status, 200);

    const afterRevoke = await request('/identity/me', { token: completed.data.token, deviceId: 'dev-contract-phone' });
    assert.equal(afterRevoke.response.status, 401);
});

test('Studio social contract shares authenticated post and comment state', async () => {
    const owner = await request('/identity/register', {
        method: 'POST',
        deviceId: 'dev-social-owner',
        body: { username: 'social-owner', displayName: 'Social Owner', passcode: 'social-passcode' },
    });
    assert.equal(owner.response.status, 200);
    const ownerToken = owner.data.token;
    await request('/verification/attestation', {
        method: 'POST',
        headers: { 'x-studio-verification-secret': 'contract-verification-secret' },
        body: { userId: owner.data.user.userId, trustTier: 'ADULT_VERIFIED', ageBand: 'adult', provider: 'contract', verificationRef: 'owner' },
    });

    const created = await request('/feed', {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner',
        body: { text: 'Canonical first post', authorId: 'usr-spoof-attempt', authorName: 'Spoofed' },
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.data.post.authorId, owner.data.user.userId);
    assert.equal(created.data.post.authorName, 'Social Owner');
    assert.equal(created.data.post.canEdit, true);
    const postId = created.data.post.id;

    const liked = await request(`/feed/${postId}/like`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { delta: 1 },
    });
    assert.equal(liked.response.status, 200);
    assert.equal(liked.data.post.viewerLiked, true);
    assert.deepEqual(liked.data.post.likers, [owner.data.user.userId]);
    assert.equal('reports' in liked.data.post, false);
    assert.equal('feedback' in liked.data.post, false);

    const anonymousCommentLike = await request(`/posts/${postId}/comments/missing/like`, {
        method: 'POST', body: { enabled: true },
    });
    assert.equal(anonymousCommentLike.response.status, 401);

    const commented = await request(`/posts/${postId}/comments`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { text: 'Shared comment' },
    });
    assert.equal(commented.response.status, 200);
    assert.equal(commented.data.comment.who, owner.data.user.userId);
    assert.equal(commented.data.comment.canEdit, true);

    const commentLiked = await request(`/posts/${postId}/comments/${commented.data.comment.id}/like`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { enabled: true },
    });
    assert.equal(commentLiked.response.status, 200);
    assert.equal(commentLiked.data.comment.likes, 1);
    assert.equal(commentLiked.data.comment.viewerLiked, true);
    assert.equal('likers' in commentLiked.data.comment, false);

    const updated = await request(`/feed/${postId}`, {
        method: 'PATCH', token: ownerToken, deviceId: 'dev-social-owner', body: { text: 'Canonical post edited' },
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.data.post.text, 'Canonical post edited');
    assert.equal(updated.data.post.revision, 2);

    const other = await request('/identity/register', {
        method: 'POST', deviceId: 'dev-social-other',
        body: { username: 'social-other', displayName: 'Social Other', passcode: 'other-passcode' },
    });
    await request('/verification/attestation', {
        method: 'POST',
        headers: { 'x-studio-verification-secret': 'contract-verification-secret' },
        body: { userId: other.data.user.userId, trustTier: 'ADULT_VERIFIED', ageBand: 'adult', provider: 'contract', verificationRef: 'other' },
    });
    const forbiddenEdit = await request(`/feed/${postId}`, {
        method: 'PATCH', token: other.data.token, deviceId: 'dev-social-other', body: { text: 'Hijacked' },
    });
    assert.equal(forbiddenEdit.response.status, 403);

    const externalComment = await request(`/posts/${postId}/comments`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { text: 'Comment from another user' },
    });
    assert.equal(externalComment.response.status, 200);

    const activity = await request('/axis/activity', { token: ownerToken, deviceId: 'dev-social-owner' });
    assert.equal(activity.response.status, 200);
    assert.equal(activity.data.unread, 1);
    const event = activity.data.items.find(item => item.targetId === postId);
    assert.equal(event.targetType, 'post');
    assert.equal(event.commentId, externalComment.data.comment.id);
    assert.match(event.deepLink, /\/studio\/post\//);

    const activityDetail = await request(`/axis/activity/${event.id}`, { token: ownerToken, deviceId: 'dev-social-owner' });
    assert.equal(activityDetail.response.status, 200);
    assert.equal(activityDetail.data.content.id, postId);
    assert.equal(activityDetail.data.item.read, true);

    const quickReply = await request(`/axis/activity/${event.id}/reply`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { text: 'Owner quick reply' },
    });
    assert.equal(quickReply.response.status, 201);
    assert.equal(quickReply.data.comment.parentId, externalComment.data.comment.id);

    const signal = await request('/signals', {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { title: 'Contract Signal', description: 'Video conversation target', video: '/test.mp4' },
    });
    assert.equal(signal.response.status, 200);
    const savedSignal = await request(`/signals/${signal.data.signal.id}/bookmark`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { enabled: true },
    });
    assert.equal(savedSignal.response.status, 200);
    assert.equal(savedSignal.data.signal.viewerBookmarked, true);
    assert.equal('bookmarkers' in savedSignal.data.signal, false);

    const automaticallySavedSignal = await request('/saved', { token: other.data.token, deviceId: 'dev-social-other' });
    assert.equal(automaticallySavedSignal.response.status, 200);
    assert.equal(
        automaticallySavedSignal.data.items.some(item => item.itemType === 'signal' && item.itemId === signal.data.signal.id),
        true,
        'bookmarking a Signal must populate the cross-surface saved library',
    );

    const savedLibraryItem = await request('/saved', {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other',
        body: {
            itemType: 'signal',
            itemId: signal.data.signal.id,
            title: 'Contract Signal',
            description: 'Video conversation target',
            authorId: owner.data.user.userId,
            payload: { backendId: signal.data.signal.id, title: 'Contract Signal' },
        },
    });
    assert.equal(savedLibraryItem.response.status, 200);
    assert.equal(savedLibraryItem.data.saved, true);
    assert.equal(savedLibraryItem.data.item.itemType, 'signal');

    const savedLibrary = await request('/saved', { token: other.data.token, deviceId: 'dev-social-other' });
    assert.equal(savedLibrary.response.status, 200);
    assert.equal(savedLibrary.data.items.some(item => item.itemId === signal.data.signal.id), true);

    const unsavedLibraryItem = await request('/saved', {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other',
        body: { itemType: 'signal', itemId: signal.data.signal.id, enabled: false },
    });
    assert.equal(unsavedLibraryItem.response.status, 200);
    assert.equal(unsavedLibraryItem.data.saved, false);

    const subscribedSignal = await request(`/signals/${signal.data.signal.id}/subscribe`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { enabled: true, alerts: true },
    });
    assert.equal(subscribedSignal.response.status, 200);
    assert.equal(subscribedSignal.data.signal.viewerSubscribed, true);
    assert.equal(subscribedSignal.data.signal.viewerAlerts, true);
    assert.equal('subscribersList' in subscribedSignal.data.signal, false);

    const unsubscribedSignal = await request(`/signals/${signal.data.signal.id}/subscribe`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { enabled: false },
    });
    assert.equal(unsubscribedSignal.response.status, 200);
    assert.equal(unsubscribedSignal.data.signal.viewerSubscribed, false);
    assert.equal(unsubscribedSignal.data.signal.viewerAlerts, false);

    const liveStarted = await request('/live', {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner',
        body: {
            title: 'Contract Live Room',
            category: 'Coding',
            mode: 'Coding',
            tag: 'Test Live',
            options: { hd: true, subchat: false },
            mediaState: { cameraEnabled: true, micEnabled: true, cameraReady: true, micReady: false, previewSupported: true, videoDeviceSelected: true, audioDeviceSelected: false },
            preflight: { camera: 'ready', mic: 'unavailable', soma: 'ready', room: 'ready' },
        },
    });
    assert.equal(liveStarted.response.status, 201);
    assert.equal(liveStarted.data.room.authorId, owner.data.user.userId);
    assert.equal(liveStarted.data.room.viewerIsHost, true);
    assert.equal(liveStarted.data.room.mediaState.cameraReady, true);
    assert.equal(liveStarted.data.room.mediaState.micReady, false);
    assert.equal(liveStarted.data.room.preflight.camera, 'ready');
    assert.equal('viewersList' in liveStarted.data.room, false);
    const liveId = liveStarted.data.room.id;
    const liveEventsAbort = new AbortController();
    const liveEvents = await fetch(`${base}/live/events?roomId=${encodeURIComponent(liveId)}`, {
        headers: { authorization: `Bearer ${ownerToken}`, 'x-studio-device-id': 'dev-social-owner' },
        signal: liveEventsAbort.signal,
    });
    assert.equal(liveEvents.status, 200);
    const eventReader = liveEvents.body.getReader();

    const liveViewed = await request(`/live/${liveId}/view`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: {},
    });
    assert.equal(liveViewed.response.status, 200);
    assert.equal(liveViewed.data.room.viewers, 1);

    const liveChat = await request(`/live/${liveId}/chat`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { text: 'Real persisted live chat' },
    });
    assert.equal(liveChat.response.status, 200);
    assert.equal(liveChat.data.room.chat.at(-1).text, 'Real persisted live chat');
    const liveMessageId = liveChat.data.room.chat.at(-1).id;

    const liveReacted = await request(`/live/${liveId}/react`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { kind: 'bolt' },
    });
    assert.equal(liveReacted.response.status, 200);
    assert.equal(liveReacted.data.room.reactionCount, 1);
    const decoder = new TextDecoder();
    let eventText = '';
    for (let i = 0; i < 8 && !eventText.includes('reaction_created'); i += 1) {
        const { value } = await eventReader.read();
        eventText += decoder.decode(value || new Uint8Array(), { stream: true });
    }
    liveEventsAbort.abort();
    assert.match(eventText, /reaction_created/);

    const offer = await request(`/live/${liveId}/webrtc/offer`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other',
        body: { peerId: 'viewer-contract', targetRole: 'host', description: { type: 'offer', sdp: 'contract-offer' } },
    });
    assert.equal(offer.response.status, 200);
    const liveHistory = await request(`/events/history?typePrefix=studio.live.&targetId=${encodeURIComponent(liveId)}&limit=50`, {
        token: ownerToken, deviceId: 'dev-social-owner',
    });
    assert.equal(liveHistory.response.status, 200);
    assert.equal(liveHistory.data.events.some(item => item.type === 'studio.live.webrtc_offer' && item.payload.signal.peerId === 'viewer-contract'), true);
    assert.equal(liveHistory.data.events.some(item => item.type === 'studio.live.reaction_created'), true);

    const liveList = await request('/live', { token: other.data.token, deviceId: 'dev-social-other' });
    assert.equal(liveList.response.status, 200);
    assert.equal(liveList.data.rooms.some(room => room.id === liveId && room.chat.some(msg => msg.text === 'Real persisted live chat')), true);

    const pinnedLiveChat = await request(`/live/${liveId}/chat/${liveMessageId}/pin`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { enabled: true },
    });
    assert.equal(pinnedLiveChat.response.status, 200);
    assert.equal(pinnedLiveChat.data.room.pinnedChat[0].id, liveMessageId);

    const slowMode = await request(`/live/${liveId}/moderation/settings`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { slowModeSeconds: 10 },
    });
    assert.equal(slowMode.response.status, 200);
    assert.equal(slowMode.data.room.moderation.slowModeSeconds, 10);

    const forbiddenModeration = await request(`/live/${liveId}/moderation/user`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other',
        body: { targetUserId: owner.data.user.userId, action: 'timeout' },
    });
    assert.equal(forbiddenModeration.response.status, 403);

    const timeoutViewer = await request(`/live/${liveId}/moderation/user`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner',
        body: { targetUserId: other.data.user.userId, action: 'timeout', durationMs: 60000, reason: 'contract test' },
    });
    assert.equal(timeoutViewer.response.status, 200);
    assert.equal(timeoutViewer.data.room.moderation.mutedCount, 1);

    const mutedChat = await request(`/live/${liveId}/chat`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { text: 'Should be blocked by timeout' },
    });
    assert.equal(mutedChat.response.status, 400);

    const deletedLiveChat = await request(`/live/${liveId}/chat/${liveMessageId}/delete`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: {},
    });
    assert.equal(deletedLiveChat.response.status, 200);
    assert.equal(deletedLiveChat.data.room.chat.some(msg => msg.id === liveMessageId), false);

    const moderationLog = await request(`/live/${liveId}/moderation`, { token: ownerToken, deviceId: 'dev-social-owner' });
    assert.equal(moderationLog.response.status, 200);
    assert.equal(moderationLog.data.actions.some(action => action.action === 'delete_chat' && action.messageId === liveMessageId), true);

    const forbiddenModerationLog = await request(`/live/${liveId}/moderation`, { token: other.data.token, deviceId: 'dev-social-other' });
    assert.equal(forbiddenModerationLog.response.status, 403);

    const liveLeft = await request(`/live/${liveId}/leave`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: {},
    });
    assert.equal(liveLeft.response.status, 200);
    assert.equal(liveLeft.data.room.viewers, 0);

    const liveEnded = await request(`/live/${liveId}/end`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: {},
    });
    assert.equal(liveEnded.response.status, 200);
    assert.equal(liveEnded.data.room.status, 'ended');

    const signalComment = await request(`/posts/${signal.data.signal.id}/comments`, {
        method: 'POST', token: other.data.token, deviceId: 'dev-social-other', body: { text: 'Signal comment' },
    });
    assert.equal(signalComment.response.status, 200);
    const signalActivity = await request('/axis/activity', { token: ownerToken, deviceId: 'dev-social-owner' });
    assert.equal(signalActivity.data.items.some(item => item.targetId === signal.data.signal.id && item.targetType === 'signal'), true);

    const feed = await request('/feed?limit=20', { token: ownerToken, deviceId: 'dev-social-owner' });
    const visible = feed.data.posts.find(post => post.id === postId);
    assert.equal(visible.text, 'Canonical post edited');
    assert.equal(visible.comments_count, 3);

    const bookmarkedPost = await request(`/feed/${postId}/bookmark`, {
        method: 'POST', token: ownerToken, deviceId: 'dev-social-owner', body: { enabled: true },
    });
    assert.equal(bookmarkedPost.response.status, 200);
    const savedFeedLibrary = await request('/saved', { token: ownerToken, deviceId: 'dev-social-owner' });
    assert.equal(savedFeedLibrary.data.items.some(item => item.itemId === postId && item.itemType === 'flux'), true);

    const removed = await request(`/feed/${postId}`, {
        method: 'DELETE', token: ownerToken, deviceId: 'dev-social-owner', body: {},
    });
    assert.equal(removed.response.status, 200);
    const orphanedComments = await request(`/posts/${postId}/comments`, { token: ownerToken, deviceId: 'dev-social-owner' });
    assert.equal(orphanedComments.response.status, 404);
});
