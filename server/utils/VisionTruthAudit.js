import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.cwd();
const AUDIT_FILE = path.join(ROOT, 'SOMA', 'vision-truth-audit.jsonl');

function rel(filePath = '') {
    if (!filePath) return null;
    try {
        return path.relative(ROOT, filePath).replace(/\\/g, '/');
    } catch {
        return String(filePath);
    }
}

function clean(value = '', max = 1000) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeObjects(objects = []) {
    return (Array.isArray(objects) ? objects : [])
        .map(obj => typeof obj === 'string'
            ? { label: obj, score: null }
            : {
                label: clean(obj?.label || obj?.name || obj?.class || 'unknown', 80).toLowerCase(),
                score: Number.isFinite(obj?.score) ? obj.score : (Number.isFinite(obj?.confidence) ? obj.confidence : null)
            })
        .filter(obj => obj.label && obj.label !== 'unknown')
        .slice(0, 24);
}

function evidenceHash(record = {}) {
    const hash = crypto.createHash('sha256');
    hash.update(JSON.stringify({
        framePath: record.framePath || record.filePath || null,
        summary: record.summary || null,
        objects: record.objects || [],
        engine: record.engine || null,
        model: record.model || null,
        timestamp: record.timestamp || null
    }));
    return hash.digest('hex').slice(0, 16);
}

export async function appendVisionTruthAudit(entry = {}) {
    const timestamp = Number(entry.timestamp || Date.now());
    const record = {
        id: entry.id || `vision-audit-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp,
        isoTime: new Date(timestamp).toISOString(),
        type: entry.type || 'vision_analysis',
        claim: clean(entry.claim || entry.summary || 'Visual evidence recorded.', 500),
        summary: clean(entry.summary || '', 1200),
        channel: entry.channel || null,
        source: entry.source || null,
        engine: entry.engine || null,
        model: entry.model || null,
        confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
        semanticAnalysis: Boolean(entry.semanticAnalysis),
        uncertain: Boolean(entry.uncertain),
        framePath: rel(entry.framePath || entry.imagePath || null),
        filePath: rel(entry.filePath || null),
        sceneId: entry.sceneId || null,
        objects: normalizeObjects(entry.objects || []),
        ocrPresent: Boolean(entry.ocrText),
        ocrPreview: entry.ocrText ? clean(entry.ocrText, 300) : null,
        privacy: entry.privacy || null
    };
    record.evidenceHash = evidenceHash(record);

    await fs.mkdir(path.dirname(AUDIT_FILE), { recursive: true });
    await fs.appendFile(AUDIT_FILE, `${JSON.stringify(record)}\n`, 'utf8');
    return record;
}

export async function readVisionTruthAudit(limit = 50) {
    try {
        const raw = await fs.readFile(AUDIT_FILE, 'utf8');
        return raw.trim().split(/\n+/).filter(Boolean).map(line => JSON.parse(line)).reverse().slice(0, limit);
    } catch {
        return [];
    }
}

export function visionTruthAuditPath() {
    return AUDIT_FILE;
}

export default {
    appendVisionTruthAudit,
    readVisionTruthAudit,
    visionTruthAuditPath
};
