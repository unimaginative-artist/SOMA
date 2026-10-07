import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { resolveWithinRoot } from './PathSafety.js';

const ALLOWED_KINDS = new Set(['prompt', 'model', 'dataset', 'memory', 'pattern']);
const safe = value => String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);

export class VersionedArtifactRegistry {
    constructor({ root = process.cwd(), governance = null } = {}) {
        this.root = root;
        this.governance = governance;
        this.base = path.join(root, 'data', 'self-modification', 'artifacts');
    }

    async initialize() {
        await fs.mkdir(this.base, { recursive: true });
        return this;
    }

    async promote({ kind, id, sourcePath, metadata = {} }) {
        if (!ALLOWED_KINDS.has(kind)) throw new Error(`Unsupported versioned artifact kind: ${kind}`);
        const artifactId = safe(id);
        if (!artifactId) throw new Error('Artifact id is required');
        const source = resolveWithinRoot(this.root, sourcePath, 'Artifact source');
        const content = await fs.readFile(source);
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        const directory = path.join(this.base, kind, artifactId);
        const versionPath = path.join(directory, hash);
        await fs.mkdir(versionPath, { recursive: true });
        const payloadPath = path.join(versionPath, path.basename(source));
        await fs.writeFile(payloadPath, content);
        const manifest = { kind, id: artifactId, hash, sourcePath, payloadPath, promotedAt: new Date().toISOString(), metadata };
        await fs.writeFile(path.join(versionPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        await fs.writeFile(path.join(directory, 'current.json'), JSON.stringify(manifest, null, 2), 'utf8');
        await this.governance?.appendLedger?.('artifact_promoted', { kind, id: artifactId, hash, sourcePath });
        return manifest;
    }

    async promoteReference({ kind, id, reference, metadata = {} }) {
        if (!ALLOWED_KINDS.has(kind)) throw new Error(`Unsupported versioned artifact kind: ${kind}`);
        const artifactId = safe(id);
        if (!artifactId || !reference) throw new Error('Artifact id and reference are required');
        const descriptor = JSON.stringify({ kind, id: artifactId, reference: String(reference), metadata });
        const hash = crypto.createHash('sha256').update(descriptor).digest('hex');
        const directory = path.join(this.base, kind, artifactId);
        const versionPath = path.join(directory, hash);
        await fs.mkdir(versionPath, { recursive: true });
        const manifest = { kind, id: artifactId, hash, reference: String(reference), promotedAt: new Date().toISOString(), metadata };
        await fs.writeFile(path.join(versionPath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
        await fs.writeFile(path.join(directory, 'current.json'), JSON.stringify(manifest, null, 2), 'utf8');
        await this.governance?.appendLedger?.('artifact_reference_promoted', { kind, id: artifactId, hash, reference: String(reference) });
        return manifest;
    }

    async rollback({ kind, id, hash }) {
        if (!ALLOWED_KINDS.has(kind)) throw new Error(`Unsupported versioned artifact kind: ${kind}`);
        const manifestPath = path.join(this.base, kind, safe(id), safe(hash), 'manifest.json');
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
        await fs.writeFile(path.join(this.base, kind, safe(id), 'current.json'), JSON.stringify({ ...manifest, restoredAt: new Date().toISOString() }, null, 2), 'utf8');
        await this.governance?.appendLedger?.('artifact_rolled_back', { kind, id: safe(id), hash: manifest.hash });
        return manifest;
    }
}

export default VersionedArtifactRegistry;
