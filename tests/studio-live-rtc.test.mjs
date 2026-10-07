import test from 'node:test';
import assert from 'node:assert/strict';
import { StudioLiveRTC } from '../frontend/public/stage/studio-live-rtc.js';

class FakePeer {
    constructor() {
        this.senders = [];
        this.remoteDescription = null;
        this.localDescription = null;
        this.connectionState = 'new';
        this.closed = false;
    }
    addTrack(track) {
        const sender = { track, replacements: [], replaceTrack: async next => { sender.replacements.push(next); sender.track = next; } };
        this.senders.push(sender);
        return sender;
    }
    addTransceiver() {}
    getSenders() { return this.senders; }
    async createOffer() { return { type: 'offer', sdp: 'viewer-offer' }; }
    async createAnswer() { return { type: 'answer', sdp: 'host-answer' }; }
    async setLocalDescription(value) { this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    async addIceCandidate() {}
    close() { this.closed = true; this.connectionState = 'closed'; }
}

function track(kind, id) {
    return { kind, id, enabled: true, stop() {} };
}

function stream(...tracks) {
    return {
        getTracks: () => tracks,
        getVideoTracks: () => tracks.filter(item => item.kind === 'video'),
        getAudioTracks: () => tracks.filter(item => item.kind === 'audio'),
    };
}

test('Studio Live completes a two-client WebRTC negotiation and replaces host media', async () => {
    const signals = [];
    const peers = [];
    const request = async (url, body) => {
        const kind = url.split('/').at(-1);
        signals.push({ roomId: 'room-1', type: `webrtc_${kind}`, signal: { kind, ...body } });
        return { ok: true };
    };
    const peerFactory = () => {
        const peer = new FakePeer();
        peers.push(peer);
        return peer;
    };
    const states = [];
    const hostStream = stream(track('video', 'camera-1'), track('audio', 'mic-1'));
    const host = new StudioLiveRTC({ request, peerFactory, onState: value => states.push(`host:${value.state}`) });
    const viewer = new StudioLiveRTC({ request, peerFactory, onState: value => states.push(`viewer:${value.state}`) });

    await host.startHost('room-1', hostStream);
    await viewer.joinViewer('room-1');
    const offer = signals.find(item => item.signal.kind === 'offer');
    assert.ok(offer, 'viewer emits an offer');

    await host.handle(offer);
    const answer = signals.find(item => item.signal.kind === 'answer');
    assert.ok(answer, 'host answers the viewer');

    await viewer.handle(answer);
    assert.equal(peers.length, 2);
    const hostPeer = peers.find(peer => peer.remoteDescription?.type === 'offer');
    const viewerPeer = peers.find(peer => peer.remoteDescription?.type === 'answer');
    assert.ok(hostPeer);
    assert.ok(viewerPeer);
    assert.equal(hostPeer.getSenders().length, 2, 'host publishes camera and microphone');
    assert.ok(states.includes('viewer:connected'));

    const replacement = stream(track('video', 'camera-2'), track('audio', 'mic-2'));
    await host.replaceStream(replacement);
    assert.equal(hostPeer.getSenders()[0].track.id, 'camera-2');
    assert.equal(hostPeer.getSenders()[1].track.id, 'mic-2');

    await Promise.all([viewer.close(), host.close()]);
    assert.equal(peers.every(peer => peer.closed), true);
    assert.ok(signals.some(item => item.signal.kind === 'leave'));
});
