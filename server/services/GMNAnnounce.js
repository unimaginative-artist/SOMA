/**
 * GMNAnnounce — build and verify signed `gmn.site.announce` messages.
 *
 * An announce tells the network "site X exists, here is its content hash, and I am
 * its origin." It is signed by the origin node's key and carries that public key, so
 * any receiver can verify (a) the signature is valid and (b) the claimed originNodeId
 * is actually derived from the signing key — you can't announce as a node you aren't.
 */
import gmnIdentity, { deriveNodeIdFromPublicKeyHex, gmnStableStringify } from './GMNIdentity.js';

const DOMAIN_RE = /^[a-z0-9][a-z0-9-]{1,62}\.gmn$/;
const HASH_RE = /^b1:[0-9a-f]{64}$/;

// Exactly the fields that are signed (sig itself excluded), in a canonical form.
function signedView(a) {
    return gmnStableStringify({
        kind: 'site_announce',
        domain: a.domain,
        originNodeId: a.originNodeId,
        publicKey: a.publicKey,
        contentHash: a.contentHash,
        rev: a.rev,
        title: a.title,
        summary: a.summary,
        bytes: a.bytes,
        fileCount: a.fileCount,
        ts: a.ts,
    });
}

/** Build a signed announce from a registry entry (uses this node's identity). */
export function buildSiteAnnounce(entry, identity = gmnIdentity) {
    const announce = {
        kind: 'site_announce',
        domain: String(entry.domain || '').toLowerCase(),
        originNodeId: identity.getNodeId(),
        publicKey: identity.getPublicKeyHex(),
        contentHash: entry.contentHash,
        rev: Number(entry.rev || 1),
        title: entry.title || entry.domain,
        summary: String(entry.summary || '').slice(0, 200),
        bytes: Number(entry.bytes || 0),
        fileCount: Number(entry.fileCount || 0),
        ts: Date.now(),
    };
    announce.sig = identity.sign(signedView(announce));
    return announce;
}

/** Verify an announce's structure, key→nodeId binding, and signature. */
export function verifySiteAnnounce(a, identity = gmnIdentity) {
    if (!a || a.kind !== 'site_announce') return { ok: false, reason: 'bad_kind' };
    if (!DOMAIN_RE.test(String(a.domain || ''))) return { ok: false, reason: 'bad_domain' };
    if (!HASH_RE.test(String(a.contentHash || ''))) return { ok: false, reason: 'bad_contentHash' };
    if (!a.publicKey || !a.sig) return { ok: false, reason: 'missing_key_or_sig' };
    if (deriveNodeIdFromPublicKeyHex(a.publicKey) !== a.originNodeId) return { ok: false, reason: 'nodeid_mismatch' };
    if (!identity.verify(a.publicKey, signedView(a), a.sig)) return { ok: false, reason: 'bad_signature' };
    return { ok: true };
}

// ── Replica announces ──────────────────────────────────────────────────────
// "I (replicaNodeId) hold a verified copy of domain@contentHash." Lets any node
// fetch a site from a replica when the origin is offline.

function signedReplicaView(a) {
    return gmnStableStringify({
        kind: 'replica_announce',
        domain: a.domain,
        replicaNodeId: a.replicaNodeId,
        publicKey: a.publicKey,
        contentHash: a.contentHash,
        ts: a.ts,
    });
}

export function buildReplicaAnnounce(domain, contentHash, identity = gmnIdentity) {
    const a = {
        kind: 'replica_announce',
        domain: String(domain || '').toLowerCase(),
        replicaNodeId: identity.getNodeId(),
        publicKey: identity.getPublicKeyHex(),
        contentHash,
        ts: Date.now(),
    };
    a.sig = identity.sign(signedReplicaView(a));
    return a;
}

export function verifyReplicaAnnounce(a, identity = gmnIdentity) {
    if (!a || a.kind !== 'replica_announce') return { ok: false, reason: 'bad_kind' };
    if (!DOMAIN_RE.test(String(a.domain || ''))) return { ok: false, reason: 'bad_domain' };
    if (!HASH_RE.test(String(a.contentHash || ''))) return { ok: false, reason: 'bad_contentHash' };
    if (!a.publicKey || !a.sig) return { ok: false, reason: 'missing_key_or_sig' };
    if (deriveNodeIdFromPublicKeyHex(a.publicKey) !== a.replicaNodeId) return { ok: false, reason: 'nodeid_mismatch' };
    if (!identity.verify(a.publicKey, signedReplicaView(a), a.sig)) return { ok: false, reason: 'bad_signature' };
    return { ok: true };
}

export default { buildSiteAnnounce, verifySiteAnnounce, buildReplicaAnnounce, verifyReplicaAnnounce };
