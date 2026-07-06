import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { listArtifacts } from './ArtifactRegistry.js';
import { ensurePublicIdentityLedger } from './PublicIdentityLedger.js';
import { readDistilledReflections } from './ReflectionDistiller.js';

const require = createRequire(import.meta.url);
const { defaultLearningSpine } = require('../../core/LearningSpine.cjs');

const ROOT = process.cwd();
const USER_MD = path.join(ROOT, 'SOMA', 'user.md');

const SELF_QUERY_PATTERN = /\b(soma|you|your|own|work|working|built|made|created|wrote|written|papers?|folios?|reflections?|stories?|sagas?|code|command bridge|discord|bluesky|medlab|medical lab|market|mission control|photos?|images?|projects?|architecture|files?|ledger|memory|context)\b/i;

function clean(value, max = 320) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function readText(file, max = 1200) {
    try {
        return (await fs.readFile(file, 'utf8')).slice(0, max);
    } catch {
        return '';
    }
}

function formatArtifact(item) {
    const parts = [
        `- ${item.type}: ${item.title}`,
        item.status ? `status=${item.status}` : null,
        item.evidencePath ? `evidence=${item.evidencePath}` : null,
        item.summary ? `summary=${clean(item.summary, 180)}` : null
    ].filter(Boolean);
    return parts.join(' | ');
}

function formatLesson(item) {
    return `- ${item.category || 'general'}/${item.lobe || 'unknown'}: ${clean(item.signal || item.title, 160)} | lesson=${clean(item.lesson, 180)} | success=${item.success}`;
}

export function isSomaSelfQuery(query = '') {
    return SELF_QUERY_PATTERN.test(String(query || ''));
}

export async function buildSomaContext(query = '', {
    force = false,
    mnemonic = null,
    includeUser = true,
    publicOnly = false,
    limit = 12
} = {}) {
    if (!force && !isSomaSelfQuery(query)) return '';

    const [identity, artifacts, distilled, userMd] = await Promise.all([
        ensurePublicIdentityLedger(),
        publicOnly ? Promise.resolve([]) : listArtifacts({ query, limit, includeCode: true }),
        publicOnly ? Promise.resolve([]) : readDistilledReflections(6),
        includeUser && !publicOnly ? readText(USER_MD, 900) : Promise.resolve('')
    ]);

    let learningLessons = [];
    try {
        learningLessons = defaultLearningSpine.getStatus(8).recent || [];
    } catch {
        learningLessons = [];
    }

    let memoryHits = [];
    if (!publicOnly && mnemonic?.recall) {
        try {
            memoryHits = await Promise.race([
                mnemonic.recall(query, { limit: 8, minSimilarity: 0.25 }),
                new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))
            ]);
        } catch {}
    }

    const lines = [
        publicOnly ? '[SOMA PUBLIC BACKGROUND]' : '[SOMA CONTEXT KERNEL]',
        'Use this as grounded self-context. Claims about SOMA must come from artifacts, memory, identity ledger, or explicit user context. If evidence is missing, say you need to check the ledger/filesystem.',
        `Public identity: ${clean(identity.voice?.publicPosition || identity.voice?.identity || 'SOMA')}`,
        `Claim policy: unsupported claims=${identity.claimPolicy?.unsupportedClaims || 'downgrade_or_refuse'}`,
        `Allowed claims: ${(identity.allowedClaims || []).slice(0, 3).map(item => clean(item, 180)).join(' | ')}`,
        `Restricted claims: ${(identity.restrictedClaims || []).slice(0, 4).map(item => clean(item, 160)).join(' | ')}`
    ];

    if (userMd) lines.push(`[USER PROFILE]\n${clean(userMd, 800)}`);

    if (artifacts.length) {
        lines.push('[ARTIFACT REGISTRY]');
        lines.push(...artifacts.map(formatArtifact));
    }

    if (!publicOnly && Array.isArray(memoryHits) && memoryHits.length) {
        lines.push('[MEMORY RETRIEVAL]');
        lines.push(...memoryHits.slice(0, 8).map(hit => `- ${clean(hit.content || hit.text || hit.summary || '', 240)}`));
    }

    if (!publicOnly && distilled.length) {
        lines.push('[REFLECTION DISTILLER]');
        lines.push(...distilled.map(item => `- ${item.lane}: ${clean(item.coreSignal, 180)} | lesson=${clean(item.lesson, 160)} | training=${item.trainingValue}`));
    }

    if (!publicOnly && learningLessons.length) {
        lines.push('[LEARNING SPINE]');
        lines.push(...learningLessons.map(formatLesson));
    }

    lines.push(publicOnly ? '[/SOMA PUBLIC BACKGROUND]' : '[/SOMA CONTEXT KERNEL]');
    return lines.join('\n').slice(0, 9000);
}

export default {
    buildSomaContext,
    isSomaSelfQuery
};
