import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

import { GMNIdentity } from '../server/services/GMNIdentity.js';
import { GMNHandshakeEngine, GMN_PROTOCOL } from '../core/GMNHandshakeEngine.js';
import { gmnStableStringify } from '../server/services/GMNIdentity.js';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gmn-security-'));
const makeIdentity = label => new GMNIdentity(path.join(tempRoot, `${label}.identity.json`));

function handshakePair() {
    const aliceIdentity = makeIdentity(`alice-${crypto.randomUUID()}`);
    const bobIdentity = makeIdentity(`bob-${crypto.randomUUID()}`);
    const alice = new GMNHandshakeEngine('alice', aliceIdentity);
    const bob = new GMNHandshakeEngine('bob', bobIdentity);
    const init = alice.createInit({ address: 'alice.test', port: 7001 });
    const response = bob.createResponse(init, { address: 'bob.test' });
    const final = alice.createFinal(response);
    return { aliceIdentity, bobIdentity, alice, bob, init, response, final };
}

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('GMN v2 binds both claimed node identities and encryption keys to signatures', () => {
    const { alice, bob, init, response, final } = handshakePair();
    assert.equal(init.protocol, GMN_PROTOCOL);
    assert.deepEqual(bob.verifyInit(init), { ok: true, nodeId: init.nodeId });
    assert.deepEqual(alice.verifyResponse(init, response), { ok: true, nodeId: response.nodeId });
    assert.deepEqual(bob.verifyFinal(init, response, final), { ok: true, nodeId: init.nodeId });

    assert.equal(bob.verifyInit({ ...init, nodeId: `gmn_${'0'.repeat(40)}` }).reason, 'nodeid_mismatch');
    assert.equal(bob.verifyInit({ ...init, encPub: response.encPub }).reason, 'signature_invalid');
    assert.equal(alice.verifyResponse(init, { ...response, echoChallenge: '0'.repeat(128) }).reason, 'challenge_mismatch');
});

test('expired but otherwise valid handshakes are rejected', () => {
    const identity = makeIdentity(`stale-${crypto.randomUUID()}`);
    const engine = new GMNHandshakeEngine('stale', identity);
    const stale = engine.createInit();
    stale.timestamp = Date.now() - 60_000;
    delete stale.signature;
    stale.signature = identity.sign(Buffer.from(gmnStableStringify(stale), 'utf8'));
    assert.equal(engine.verifyInit(stale).reason, 'handshake_expired');
});

test('directional X25519/HKDF keys interoperate and encrypted records reject tamper/replay', () => {
    const { alice, bob, init, response } = handshakePair();
    const aliceKeys = alice.deriveSessionKeys({
        peerEncPublicKeyHex: response.encPub,
        initiatorChallenge: init.challenge,
        responderChallenge: response.challenge,
        initiatorNodeId: init.nodeId,
        responderNodeId: response.nodeId,
        isInitiator: true
    });
    const bobKeys = bob.deriveSessionKeys({
        peerEncPublicKeyHex: init.encPub,
        initiatorChallenge: init.challenge,
        responderChallenge: response.challenge,
        initiatorNodeId: init.nodeId,
        responderNodeId: response.nodeId,
        isInitiator: false
    });
    assert.deepEqual(aliceKeys.txKey, bobKeys.rxKey);
    assert.deepEqual(aliceKeys.rxKey, bobKeys.txKey);

    const record = alice.encryptRecord({ type: 'probe', value: 42 }, aliceKeys.txKey, 1);
    assert.deepEqual(bob.decryptRecord(record, bobKeys.rxKey, 0), {
        sequence: 1,
        payload: { type: 'probe', value: 42 }
    });
    assert.throws(() => bob.decryptRecord(record, bobKeys.rxKey, 1), /Replayed|out-of-order/);
    const tampered = { ...record, ciphertext: `${record.ciphertext.slice(0, -2)}AA` };
    assert.throws(() => bob.decryptRecord(tampered, bobKeys.rxKey, 0));
});

test('retired public-key hashing API cannot be mistaken for a secret session key', () => {
    const { alice, response } = handshakePair();
    assert.throws(() => alice.deriveSessionKey(response.publicKey), /retired/);
});

async function freePort() {
    const server = net.createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function waitFor(predicate, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('condition timed out');
}

test('two real WebSocket peers complete GMN v2 and exchange only encrypted application records', async () => {
    const originalCwd = process.cwd();
    const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gmn-two-peer-'));
    process.chdir(runtimeRoot);
    const { GMNConnectivityArbiter } = await import(`../arbiters/GMNConnectivityArbiter.js?secure-two-peer=${Date.now()}`);
    const portA = await freePort();
    const portB = await freePort();
    const aliceIdentity = new GMNIdentity(path.join(runtimeRoot, 'alice.json'));
    const bobIdentity = new GMNIdentity(path.join(runtimeRoot, 'bob.json'));
    const alice = new GMNConnectivityArbiter({
        name: 'GMN-Test-A', port: portA, identity: aliceIdentity,
        bindAddress: '127.0.0.1', discoveryEnabled: false, handshakeTimeoutMs: 2000
    });
    const bob = new GMNConnectivityArbiter({
        name: 'GMN-Test-B', port: portB, identity: bobIdentity,
        bindAddress: '127.0.0.1', discoveryEnabled: false, handshakeTimeoutMs: 2000
    });
    try {
        await alice.initialize();
        await bob.initialize();
        await Promise.all([
            new Promise(resolve => alice.server._server?.listening ? resolve() : alice.server.once('listening', resolve)),
            new Promise(resolve => bob.server._server?.listening ? resolve() : bob.server.once('listening', resolve))
        ]);
        assert.equal(await alice.connectToPeer(`127.0.0.1:${portB}`), true);
        await waitFor(() => alice.peers.has(bobIdentity.getNodeId()) && bob.peers.has(aliceIdentity.getNodeId()));
        assert.equal(alice.peers.get(bobIdentity.getNodeId()).encrypted, true);
        assert.equal(bob.peers.get(aliceIdentity.getNodeId()).encrypted, true);

        const aliceSocket = alice.peers.get(bobIdentity.getNodeId()).socket;
        const bobSocket = bob.peers.get(aliceIdentity.getNodeId()).socket;
        const bobSession = bob._sessions.get(bobSocket);
        const before = bobSession.rxSequence;
        let observedWireType = null;
        bobSocket.once('message', raw => { observedWireType = JSON.parse(raw).type; });
        assert.equal(alice._sendSecure(aliceSocket, { type: 'thirdplace.position', data: { x: 7 } }), true);
        await waitFor(() => bobSession.rxSequence === before + 1);
        assert.equal(observedWireType, 'gmn_secure');
    } finally {
        await alice.onShutdown();
        await bob.onShutdown();
        process.chdir(originalCwd);
        fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
});

test('GMN control plane rejects anonymous/wrong-device requests while public node identity stays readable', async () => {
    const originalCwd = process.cwd();
    const authRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gmn-auth-'));
    fs.mkdirSync(path.join(authRoot, 'SOMA'), { recursive: true });
    process.chdir(authRoot);
    process.env.STUDIO_STRICT_AUTH = '1';
    const stamp = Date.now();
    const { default: createGmnRoutes } = await import(`../server/routes/gmnRoutes.js?gmn-auth=${stamp}`);
    const auth = await import(`../server/studio/StudioSessionAuth.js?gmn-auth=${stamp}`);

    const userId = 'usr-gmn-owner';
    const sessionId = crypto.randomUUID();
    const deviceId = 'gmn-device-a';
    const exp = Date.now() + 60_000;
    const payload = Buffer.from(JSON.stringify({ kind: 'studio-session', userId, sessionId, deviceId, exp })).toString('base64url');
    const token = `${payload}.${auth.signStudioPayload(payload)}`;
    fs.writeFileSync(path.join(authRoot, 'SOMA', 'studio-sessions.json'), JSON.stringify({
        sessions: [{ sessionId, userId, deviceId, expiresAt: exp, lastSeenAt: Date.now(), riskFlags: [] }]
    }));

    const app = express();
    app.use(express.json());
    const gmnRouter = createGmnRoutes({});
    app.use('/api/gmn', gmnRouter);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${base}/api/gmn/node`)).status, 200);
        const hosted = await fetch(`${base}/api/gmn/site/owner.gmn`);
        assert.equal(hosted.status, 200);
        assert.equal(hosted.headers.get('x-content-type-options'), 'nosniff');
        assert.match(await hosted.text(), /Content-Security-Policy/i);
        assert.equal((await fetch(`${base}/api/gmn/network`)).status, 401);
        assert.equal((await fetch(`${base}/api/gmn/bootstrap`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
        })).status, 401);
        assert.equal((await fetch(`${base}/api/gmn/bootstrap`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-studio-device-id': 'wrong-device' },
            body: '{}'
        })).status, 401);
        assert.equal((await fetch(`${base}/api/gmn/bootstrap`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-studio-device-id': deviceId },
            body: '{}'
        })).status, 400);
    } finally {
        await new Promise(resolve => server.close(resolve));
        gmnRouter.close?.();
        clearInterval(globalThis.__somaGmnReindexInterval);
        delete globalThis.__somaGmnReindexInterval;
        process.chdir(originalCwd);
        fs.rmSync(authRoot, { recursive: true, force: true });
    }
});
