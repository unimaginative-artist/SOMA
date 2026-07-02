/**
 * GMNIdentity — the stable, persistent identity of THIS Gray Matter Network node.
 *
 * Every node needs ONE identity that survives restarts. Without it, replicas are
 * orphaned, trust resets, and announces can't be verified. This module owns the
 * node's Ed25519 keypair (generated once, persisted to config/gmn-identity.json)
 * and derives a stable nodeId = "gmn_" + sha256(publicKey)[:40].
 *
 * NOTE (Batch 2): `core/GMNHandshakeEngine.js` currently generates an EPHEMERAL
 * keypair per boot. The first task of Batch 2 is to make the mesh handshake adopt
 * this persistent identity so the node's mesh identity == its registry identity.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const IDENTITY_FILE = path.resolve(process.cwd(), 'config', 'gmn-identity.json');

function deriveNodeId(publicKeyDer) {
    const fingerprint = crypto.createHash('sha256').update(publicKeyDer).digest('hex');
    return 'gmn_' + fingerprint.slice(0, 40); // 160-bit fingerprint
}

/** Derive the canonical nodeId from a peer's DER public key (hex). Used to bind an
 *  announce's claimed originNodeId to the key that signed it — anti-spoofing. */
export function deriveNodeIdFromPublicKeyHex(publicKeyHex) {
    try { return deriveNodeId(Buffer.from(String(publicKeyHex), 'hex')); }
    catch { return null; }
}

/** Deterministic JSON (sorted keys) — shared canonical form for signed payloads. */
export function gmnStableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(gmnStableStringify).join(',') + ']';
    const keys = Object.keys(value).sort();
    return '{' + keys.map(k => JSON.stringify(k) + ':' + gmnStableStringify(value[k])).join(',') + '}';
}

export class GMNIdentity {
    constructor(file = IDENTITY_FILE) {
        this.file = file;
        this._state = null;
    }

    _load() {
        if (this._state) return this._state;

        let data = null;
        try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* first run */ }
        let changed = false;

        // Ed25519 signing identity (the nodeId is derived from this — never regenerate
        // it if it exists, or the node's identity would change).
        if (!data?.privateKey || !data?.publicKey || !data?.nodeId) {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
                publicKeyEncoding: { format: 'der', type: 'spki' },
                privateKeyEncoding: { format: 'der', type: 'pkcs8' },
            });
            data = {
                alg: 'ed25519', nodeId: deriveNodeId(publicKey),
                publicKey: publicKey.toString('hex'), privateKey: privateKey.toString('hex'),
                createdAt: new Date().toISOString(),
            };
            changed = true;
        }

        // X25519 encryption identity (Batch 7) — added in place for existing nodes so
        // messages can be sealed to them. Keeps the nodeId; just gains an encryption key.
        if (!data.encPublicKey || !data.encPrivateKey) {
            const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519', {
                publicKeyEncoding: { format: 'der', type: 'spki' },
                privateKeyEncoding: { format: 'der', type: 'pkcs8' },
            });
            data.encAlg = 'x25519';
            data.encPublicKey = publicKey.toString('hex');
            data.encPrivateKey = privateKey.toString('hex');
            changed = true;
        }

        if (changed) {
            try {
                fs.mkdirSync(path.dirname(this.file), { recursive: true });
                const tmp = `${this.file}.${process.pid}.tmp`;
                fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
                fs.renameSync(tmp, this.file);
            } catch (e) {
                console.warn(`[GMNIdentity] Could not persist identity: ${e.message}`);
            }
        }

        this._state = this._materialize(data);
        return this._state;
    }

    _materialize(data) {
        const publicKeyDer = Buffer.from(data.publicKey, 'hex');
        const privateKeyDer = Buffer.from(data.privateKey, 'hex');
        const encPublicKeyDer = Buffer.from(data.encPublicKey, 'hex');
        const encPrivateKeyDer = Buffer.from(data.encPrivateKey, 'hex');
        return {
            nodeId: data.nodeId,
            createdAt: data.createdAt,
            publicKeyDer, privateKeyDer,
            publicKey: crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' }),
            privateKey: crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' }),
            encPublicKeyDer, encPrivateKeyDer,
            encPublicKey: crypto.createPublicKey({ key: encPublicKeyDer, format: 'der', type: 'spki' }),
            encPrivateKey: crypto.createPrivateKey({ key: encPrivateKeyDer, format: 'der', type: 'pkcs8' }),
        };
    }

    getNodeId() { return this._load().nodeId; }
    getPublicKeyHex() { return this._load().publicKeyDer.toString('hex'); }
    getEncPublicKeyHex() { return this._load().encPublicKeyDer.toString('hex'); }
    /** X25519 KeyObjects for ECDH (sealing/opening messages). */
    getEncKeys() { const s = this._load(); return { publicKey: s.encPublicKey, privateKey: s.encPrivateKey }; }
    getCreatedAt() { return this._load().createdAt; }

    /** DER buffers, for compatibility with code that wants raw key material. */
    getKeyMaterial() {
        const s = this._load();
        return { nodeId: s.nodeId, publicKeyDer: s.publicKeyDer, privateKeyDer: s.privateKeyDer };
    }

    /** Sign arbitrary bytes with the node's Ed25519 key. Returns a hex signature. */
    sign(data) {
        const s = this._load();
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
        return crypto.sign(null, buf, s.privateKey).toString('hex');
    }

    /** Verify a signature against a peer's public key (DER hex). */
    verify(publicKeyHex, data, signatureHex) {
        try {
            const pub = crypto.createPublicKey({ key: Buffer.from(publicKeyHex, 'hex'), format: 'der', type: 'spki' });
            const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
            return crypto.verify(null, buf, pub, Buffer.from(signatureHex, 'hex'));
        } catch {
            return false;
        }
    }

    /** Public, shareable descriptor of this node. */
    describe() {
        const s = this._load();
        return {
            nodeId: s.nodeId,
            publicKey: s.publicKeyDer.toString('hex'),
            encPublicKey: s.encPublicKeyDer.toString('hex'),
            alg: 'ed25519', encAlg: 'x25519',
            createdAt: s.createdAt,
        };
    }
}

// Singleton — there is exactly one identity per running node.
export default new GMNIdentity();
