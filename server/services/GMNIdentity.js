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

export class GMNIdentity {
    constructor(file = IDENTITY_FILE) {
        this.file = file;
        this._state = null;
    }

    _load() {
        if (this._state) return this._state;

        // Try to load an existing persisted identity.
        try {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            if (raw?.privateKey && raw?.publicKey && raw?.nodeId) {
                const publicKeyDer = Buffer.from(raw.publicKey, 'hex');
                const privateKeyDer = Buffer.from(raw.privateKey, 'hex');
                this._state = this._materialize(raw.nodeId, publicKeyDer, privateKeyDer, raw.createdAt);
                return this._state;
            }
        } catch { /* not yet created — generate below */ }

        // First run: generate a fresh identity and persist it.
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
            publicKeyEncoding: { format: 'der', type: 'spki' },
            privateKeyEncoding: { format: 'der', type: 'pkcs8' },
        });
        const nodeId = deriveNodeId(publicKey);
        const createdAt = new Date().toISOString();
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify({
                alg: 'ed25519', nodeId,
                publicKey: publicKey.toString('hex'),
                privateKey: privateKey.toString('hex'),
                createdAt,
            }, null, 2), { mode: 0o600 });
            fs.renameSync(tmp, this.file);
        } catch (e) {
            // If we can't persist, we still run with an in-memory identity for this boot.
            console.warn(`[GMNIdentity] Could not persist identity: ${e.message}`);
        }
        this._state = this._materialize(nodeId, publicKey, privateKey, createdAt);
        return this._state;
    }

    _materialize(nodeId, publicKeyDer, privateKeyDer, createdAt) {
        const publicKey = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
        const privateKey = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
        return { nodeId, publicKeyDer, privateKeyDer, publicKey, privateKey, createdAt };
    }

    getNodeId() { return this._load().nodeId; }
    getPublicKeyHex() { return this._load().publicKeyDer.toString('hex'); }
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
        return { nodeId: s.nodeId, publicKey: s.publicKeyDer.toString('hex'), alg: 'ed25519', createdAt: s.createdAt };
    }
}

// Singleton — there is exactly one identity per running node.
export default new GMNIdentity();
