/**
 * GMNSeal — real end-to-end message sealing for GMN.
 *
 * seal(plaintext, recipientEncPub) produces an authenticated, encrypted envelope that
 * ONLY the recipient can open, and that proves who sent it. Relays can carry it but
 * can't read it. Scheme (ECIES-style, all Node built-ins — no external deps):
 *
 *   1. Ephemeral X25519 keypair per message → ECDH with the recipient's static X25519
 *      key → HKDF-SHA256 → a fresh AES-256-GCM key (forward-secret per message).
 *   2. Encrypt the plaintext with AES-256-GCM (confidentiality + integrity).
 *   3. Sign the whole envelope with the sender's Ed25519 key, and bind the claimed
 *      sender nodeId to that signing key — so you can't forge who a message is from.
 */
import crypto from 'node:crypto';
import gmnIdentity, { gmnStableStringify, deriveNodeIdFromPublicKeyHex } from './GMNIdentity.js';

const HKDF_INFO = Buffer.from('gmn-seal-v1');

function pubFromHex(hex) {
    return crypto.createPublicKey({ key: Buffer.from(hex, 'hex'), format: 'der', type: 'spki' });
}

// Exactly the fields covered by the signature (sig excluded).
function signedView(e) {
    return gmnStableStringify({
        v: e.v, alg: e.alg, epk: e.epk, iv: e.iv, ct: e.ct, tag: e.tag,
        from: e.from, signPub: e.signPub, encPub: e.encPub, ts: e.ts,
    });
}

/** Seal + sign plaintext to a recipient's X25519 public key (hex). */
export function seal(plaintext, recipientEncPubHex, identity = gmnIdentity) {
    const recipientPub = pubFromHex(recipientEncPubHex);
    const eph = crypto.generateKeyPairSync('x25519');
    const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPub });
    const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(recipientEncPubHex, 'hex'), HKDF_INFO, 32));

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const pt = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(String(plaintext), 'utf8');
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);

    const env = {
        v: 1, alg: 'x25519-aesgcm',
        epk: eph.publicKey.export({ format: 'der', type: 'spki' }).toString('hex'),
        iv: iv.toString('hex'), ct: ct.toString('hex'), tag: cipher.getAuthTag().toString('hex'),
        from: identity.getNodeId(), signPub: identity.getPublicKeyHex(), encPub: identity.getEncPublicKeyHex(),
        ts: Date.now(),
    };
    env.sig = identity.sign(signedView(env));
    return env;
}

/** Open an envelope addressed to us: verify the sender, then decrypt. */
export function open(env, identity = gmnIdentity) {
    if (!env || env.alg !== 'x25519-aesgcm') return { ok: false, reason: 'bad_alg' };
    for (const f of ['epk', 'iv', 'ct', 'tag', 'from', 'signPub', 'encPub', 'sig']) {
        if (!env[f]) return { ok: false, reason: 'malformed' };
    }
    // The claimed sender must actually own the signing key.
    if (deriveNodeIdFromPublicKeyHex(env.signPub) !== env.from) return { ok: false, reason: 'sender_mismatch' };
    if (!identity.verify(env.signPub, signedView(env), env.sig)) return { ok: false, reason: 'bad_signature' };

    try {
        const shared = crypto.diffieHellman({ privateKey: identity.getEncKeys().privateKey, publicKey: pubFromHex(env.epk) });
        const key = Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.from(identity.getEncPublicKeyHex(), 'hex'), HKDF_INFO, 32));
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'hex'));
        decipher.setAuthTag(Buffer.from(env.tag, 'hex'));
        const pt = Buffer.concat([decipher.update(Buffer.from(env.ct, 'hex')), decipher.final()]);
        return { ok: true, plaintext: pt, from: env.from, senderEncPub: env.encPub, ts: env.ts };
    } catch {
        return { ok: false, reason: 'decrypt_failed' };
    }
}

export default { seal, open };
