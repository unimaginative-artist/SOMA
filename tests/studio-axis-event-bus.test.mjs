import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('Studio/Axis bus orders durable actions, protects audiences, and keeps WebRTC ephemeral', async () => {
    const original = process.cwd();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-axis-bus-'));
    fs.mkdirSync(path.join(root, 'SOMA'), { recursive: true });
    process.chdir(root);
    try {
        const url = new URL('../server/studio/StudioAxisEventBus.js', import.meta.url);
        url.searchParams.set('test', String(Date.now()));
        const { default: bus } = await import(url.href);
        const received = [];
        const broadcast = [];
        bus.subscribe(event => received.push(event), { userId: 'owner' });
        bus.attachBroadcaster((type, event) => broadcast.push([type, event.id]));

        const publicEvent = bus.publish('studio.feed.created', { postId: 'post-1' }, { actorId: 'owner', targetId: 'post-1' });
        bus.publish('studio.notification.direct', { text: 'private' }, { audience: ['owner'], targetId: 'owner' });
        bus.publish('studio.notification.direct', { text: 'other-private' }, { audience: ['other'], targetId: 'other' });
        const rtcEvent = bus.publish('studio.live.webrtc_offer', {
            roomId: 'room-1',
            signal: { kind: 'offer', peerId: 'viewer-1', description: { type: 'offer', sdp: 'contract' } },
        }, { targetId: 'room-1', ephemeral: true });

        assert.equal(received.length, 3);
        assert.equal(broadcast.length, 4);
        assert.equal(bus.history({ userId: 'owner' }).some(event => event.id === publicEvent.id), true);
        assert.equal(publicEvent.schemaId, 'studio.social.event.v1');
        assert.equal(rtcEvent.schemaId, 'studio.live.event.v1');
        assert.equal(bus.history({ userId: 'owner' }).some(event => event.payload.text === 'other-private'), false);
        assert.equal(bus.history({ targetId: 'room-1' }).some(event => event.id === rtcEvent.id), true, 'recent clients can recover an in-memory offer');

        const duplicate = bus.publish('studio.feed.created', { postId: 'different-payload' }, {
            actorId: 'owner', targetId: 'post-1', idempotencyKey: 'feed-create:post-1',
        });
        const duplicateAgain = bus.publish('studio.feed.created', { postId: 'should-not-win' }, {
            actorId: 'owner', targetId: 'post-1', idempotencyKey: 'feed-create:post-1',
        });
        assert.equal(duplicateAgain.id, duplicate.id, 'idempotency returns the original event');

        bus.checkpoint('contract-consumer', publicEvent);
        assert.equal(bus.getCheckpoint('contract-consumer').eventId, publicEvent.id);
        assert.equal(bus.replay('contract-consumer').some(event => event.id === duplicate.id), true);

        const persistedTypes = bus.db.prepare('SELECT type, target_id FROM studio_axis_events').all();
        assert.equal(persistedTypes.some(row => row.type === 'studio.live.webrtc_offer' || row.target_id === 'room-1'), false, 'SDP/ICE signaling is never written to disk');
        bus.close();
    } finally {
        process.chdir(original);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
