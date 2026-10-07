/**
 * GMNHandshakeEngine.js
 *
 * Authenticated GMN v2 handshake and record layer.
 *
 * Security properties:
 * - Ed25519 signatures bind nodeId, signing key, X25519 key, challenges and time.
 * - nodeId is derived from the signing key; claimed identities cannot be spoofed.
 * - mutual challenge/response with a short validity window prevents stale replay.
 * - X25519 + HKDF-SHA256 derives independent directional traffic keys.
 * - AES-256-GCM records authenticate every post-handshake message.
 * - monotonically increasing sequence numbers reject replayed records.
 *
 * This is deliberately described as modern authenticated transport, not
 * "quantum-safe": Ed25519/X25519 are strong conventional cryptography but are
 * not post-quantum algorithms.
 */

import crypto from 'node:crypto';
import gmnIdentity, {
    deriveNodeIdFromPublicKeyHex,
    gmnStableStringify
} from '../server/services/GMNIdentity.js';

export const GMN_PROTOCOL = 'gmn/2';
const HANDSHAKE_MAX_AGE_MS = 30_000;
const HKDF_INFO = Buffer.from('soma-gmn-transport-v2', 'utf8');

function signable(message) {
    const copy = { ...message };
    delete copy.signature;
    return Buffer.from(gmnStableStringify(copy), 'utf8');
}

function validHex(value, bytes) {
    return typeof value === 'string'
        && value.length === bytes * 2
        && /^[0-9a-f]+$/i.test(value);
}

function validTime(timestamp, now = Date.now()) {
    return Number.isFinite(Number(timestamp))
        && Math.abs(now - Number(timestamp)) <= HANDSHAKE_MAX_AGE_MS;
}

export class GMNHandshakeEngine {
    constructor(nodeId, identity = gmnIdentity) {
        this.nodeId = nodeId;
        this.identity = identity;
    }

    getPublicKey() { return this.identity.getPublicKeyHex(); }
    getNodeId() { return this.identity.getNodeId(); }
    getEncryptionPublicKey() { return this.identity.getEncPublicKeyHex(); }

    generateChallenge() {
        return crypto.randomBytes(64).toString('hex');
    }

    signChallenge(challenge) {
        return this.identity.sign(Buffer.from(challenge, 'hex'));
    }

    verifyPeerSignature(challenge, signature, peerPublicKeyHex) {
        if (!validHex(challenge, 64)) return false;
        return this.identity.verify(peerPublicKeyHex, Buffer.from(challenge, 'hex'), signature);
    }

    _sign(message) {
        return { ...message, signature: this.identity.sign(signable(message)) };
    }

    _verifySigned(message) {
        return this.identity.verify(message.publicKey, signable(message), message.signature);
    }

    _verifyIdentity(message) {
        if (message?.protocol !== GMN_PROTOCOL) return { ok: false, reason: 'protocol_mismatch' };
        if (!validTime(message.timestamp)) return { ok: false, reason: 'handshake_expired' };
        if (!validHex(message.challenge, 64)) return { ok: false, reason: 'invalid_challenge' };
        if (!message.publicKey || !message.encPub || !message.signature) return { ok: false, reason: 'missing_identity_material' };
        const canonicalNodeId = deriveNodeIdFromPublicKeyHex(message.publicKey);
        if (!canonicalNodeId || canonicalNodeId !== message.nodeId) return { ok: false, reason: 'nodeid_mismatch' };
        if (!this._verifySigned(message)) return { ok: false, reason: 'signature_invalid' };
        try {
            const encKey = crypto.createPublicKey({ key: Buffer.from(message.encPub, 'hex'), format: 'der', type: 'spki' });
            if (encKey.asymmetricKeyType !== 'x25519') return { ok: false, reason: 'invalid_encryption_key' };
        } catch {
            return { ok: false, reason: 'invalid_encryption_key' };
        }
        return { ok: true, nodeId: canonicalNodeId };
    }

    createInit({ address = '', port = 0 } = {}) {
        return this._sign({
            type: 'handshake_init',
            protocol: GMN_PROTOCOL,
            nodeId: this.getNodeId(),
            address: String(address || '').slice(0, 256),
            port: Number(port) || 0,
            publicKey: this.getPublicKey(),
            encPub: this.getEncryptionPublicKey(),
            challenge: this.generateChallenge(),
            timestamp: Date.now()
        });
    }

    verifyInit(message) {
        if (message?.type !== 'handshake_init') return { ok: false, reason: 'unexpected_handshake_message' };
        return this._verifyIdentity(message);
    }

    createResponse(initMessage, { address = '' } = {}) {
        return this._sign({
            type: 'handshake_response',
            protocol: GMN_PROTOCOL,
            nodeId: this.getNodeId(),
            address: String(address || '').slice(0, 256),
            publicKey: this.getPublicKey(),
            encPub: this.getEncryptionPublicKey(),
            echoChallenge: initMessage.challenge,
            challenge: this.generateChallenge(),
            timestamp: Date.now()
        });
    }

    verifyResponse(initMessage, response) {
        if (response?.type !== 'handshake_response') return { ok: false, reason: 'unexpected_handshake_message' };
        if (response.echoChallenge !== initMessage?.challenge) return { ok: false, reason: 'challenge_mismatch' };
        return this._verifyIdentity(response);
    }

    createFinal(response) {
        return this._sign({
            type: 'handshake_final',
            protocol: GMN_PROTOCOL,
            nodeId: this.getNodeId(),
            publicKey: this.getPublicKey(),
            encPub: this.getEncryptionPublicKey(),
            echoChallenge: response.challenge,
            // A final has no new challenge, but keeping the field in the signed
            // schema lets the common identity validator enforce its shape.
            challenge: response.echoChallenge,
            timestamp: Date.now()
        });
    }

    verifyFinal(initMessage, response, finalMessage) {
        if (finalMessage?.type !== 'handshake_final') return { ok: false, reason: 'unexpected_handshake_message' };
        if (finalMessage.echoChallenge !== response?.challenge) return { ok: false, reason: 'challenge_mismatch' };
        if (finalMessage.challenge !== initMessage?.challenge) return { ok: false, reason: 'transcript_mismatch' };
        if (finalMessage.nodeId !== initMessage?.nodeId || finalMessage.publicKey !== initMessage?.publicKey || finalMessage.encPub !== initMessage?.encPub) {
            return { ok: false, reason: 'identity_changed_during_handshake' };
        }
        return this._verifyIdentity(finalMessage);
    }

    deriveSessionKeys({
        peerEncPublicKeyHex,
        initiatorChallenge,
        responderChallenge,
        initiatorNodeId,
        responderNodeId,
        isInitiator
    }) {
        const peerPublicKey = crypto.createPublicKey({
            key: Buffer.from(peerEncPublicKeyHex, 'hex'),
            format: 'der',
            type: 'spki'
        });
        if (peerPublicKey.asymmetricKeyType !== 'x25519') throw new Error('Peer encryption key is not X25519');
        const shared = crypto.diffieHellman({
            privateKey: this.identity.getEncKeys().privateKey,
            publicKey: peerPublicKey
        });
        const transcript = gmnStableStringify({
            protocol: GMN_PROTOCOL,
            initiatorChallenge,
            responderChallenge,
            initiatorNodeId,
            responderNodeId
        });
        const salt = crypto.createHash('sha256').update(transcript).digest();
        const material = Buffer.from(crypto.hkdfSync('sha256', shared, salt, HKDF_INFO, 64));
        const initiatorTx = material.subarray(0, 32);
        const responderTx = material.subarray(32, 64);
        return isInitiator
            ? { txKey: initiatorTx, rxKey: responderTx, transcriptHash: salt.toString('hex') }
            : { txKey: responderTx, rxKey: initiatorTx, transcriptHash: salt.toString('hex') };
    }

    encryptRecord(payload, key, sequence) {
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invalid GMN record sequence');
        const iv = crypto.randomBytes(12);
        const aad = Buffer.from(gmnStableStringify({ protocol: GMN_PROTOCOL, sequence }), 'utf8');
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        cipher.setAAD(aad);
        const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
        return {
            type: 'gmn_secure',
            protocol: GMN_PROTOCOL,
            sequence,
            iv: iv.toString('hex'),
            ciphertext: ciphertext.toString('base64'),
            tag: cipher.getAuthTag().toString('hex')
        };
    }

    decryptRecord(record, key, lastSequence = 0) {
        if (record?.type !== 'gmn_secure' || record.protocol !== GMN_PROTOCOL) throw new Error('Unencrypted GMN application record');
        const sequence = Number(record.sequence);
        if (!Number.isSafeInteger(sequence) || sequence <= lastSequence) throw new Error('Replayed or out-of-order GMN record');
        if (!validHex(record.iv, 12) || !validHex(record.tag, 16) || typeof record.ciphertext !== 'string') throw new Error('Malformed GMN record');
        const aad = Buffer.from(gmnStableStringify({ protocol: GMN_PROTOCOL, sequence }), 'utf8');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'hex'));
        decipher.setAAD(aad);
        decipher.setAuthTag(Buffer.from(record.tag, 'hex'));
        const plaintext = Buffer.concat([
            decipher.update(Buffer.from(record.ciphertext, 'base64')),
            decipher.final()
        ]).toString('utf8');
        return { sequence, payload: JSON.parse(plaintext) };
    }

    // Compatibility wrappers retained for callers outside the transport.
    deriveSessionKey(peerPublicKeyHex) {
        throw new Error(`deriveSessionKey(${peerPublicKeyHex?.slice?.(0, 8) || ''}) is retired; use deriveSessionKeys with X25519 transcript binding`);
    }

    encryptPayload(payload, sessionKey) { return this.encryptRecord(payload, sessionKey.subarray(0, 32), 1); }
    decryptPayload(data, sessionKey) { return this.decryptRecord(data, sessionKey.subarray(0, 32), 0).payload; }
}
