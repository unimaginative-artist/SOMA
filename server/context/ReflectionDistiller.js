import fs from 'fs/promises';
import path from 'path';
import { recordArtifact } from './ArtifactRegistry.js';

const DISTILLER_FILE = path.join(process.cwd(), 'SOMA', 'reflection-distiller.jsonl');

function clean(value, max = 360) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function classify(entry = {}) {
    const text = `${entry.title || ''} ${entry.text || ''} ${entry.summary || ''} ${entry.source || ''}`.toLowerCase();
    if (/\bmed|cancer|disease|paper|research|hypothesis|lab|tp53|kras|pcsk9\b/.test(text)) return 'medical_research';
    if (/\bmarket|trade|ticker|spy|qqq|p&l|backtest|thesis\b/.test(text)) return 'market_evidence';
    if (/\bstory|chapter|saga|muse|creative\b/.test(text)) return 'creative';
    if (/\bcode|fix|build|ship|architecture|command bridge|pulse|axis\b/.test(text)) return 'engineering';
    if (/\bdiscord|bluesky|social|reply|post\b/.test(text)) return 'social';
    return 'general';
}

function trainingValue(entry = {}, lane = 'general') {
    const text = `${entry.text || ''} ${entry.summary || ''}`;
    let score = 0.35;
    if (entry.evidencePath || entry.artifactPath) score += 0.2;
    if (/\bfailed|negative|non-significant|veto|uncertain|risk|limitation\b/i.test(text)) score += 0.15;
    if (/\bdecision|changed|fixed|lesson|should|next\b/i.test(text)) score += 0.1;
    if (lane === 'medical_research' || lane === 'engineering') score += 0.1;
    return Math.min(0.95, Number(score.toFixed(2)));
}

export async function distillReflection(entry = {}) {
    const lane = classify(entry);
    const now = new Date().toISOString();
    const text = clean(entry.text || entry.summary || entry.content || '', 900);
    const packet = {
        id: entry.id || `distill-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        source: entry.source || 'unknown',
        lane,
        title: clean(entry.title || `${lane} reflection`, 120),
        artifactPath: entry.artifactPath || entry.evidencePath || null,
        coreSignal: clean(entry.coreSignal || text || entry.title || 'SOMA recorded an action.', 260),
        lesson: clean(entry.lesson || inferLesson(text, lane), 260),
        confidence: typeof entry.confidence === 'number' ? entry.confidence : 0.65,
        trainingValue: trainingValue(entry, lane),
        publicPostValue: /\bpublic|post|chapter|image|shipped|artifact|folio\b/i.test(text) ? 0.65 : 0.35,
        unresolved: clean(entry.unresolved || inferUnresolved(text, lane), 260),
        tags: Array.from(new Set([lane, ...(entry.tags || [])])).slice(0, 12)
    };

    await fs.mkdir(path.dirname(DISTILLER_FILE), { recursive: true });
    await fs.appendFile(DISTILLER_FILE, `${JSON.stringify(packet)}\n`, 'utf8');

    if (packet.artifactPath || packet.trainingValue >= 0.65) {
        await recordArtifact({
            id: `distilled-${packet.id}`,
            type: `distilled_${lane}`,
            title: packet.title,
            source: 'reflection-distiller',
            status: 'distilled',
            confidence: packet.confidence,
            evidencePath: packet.artifactPath,
            summary: `${packet.coreSignal} Lesson: ${packet.lesson}`,
            tags: packet.tags,
            claimVerbs: ['distilled', 'learned']
        }).catch(() => {});
    }

    return packet;
}

function inferLesson(text, lane) {
    if (/\bnegative|failed|non-significant|veto\b/i.test(text)) return 'Negative results should be preserved because they prevent repeated weak claims.';
    if (lane === 'social') return 'Public interaction should reinforce identity coherence, restraint, and artifact-grounded claims.';
    if (lane === 'engineering') return 'Engineering changes should be linked to files, tests, and regressions before public claims.';
    if (lane === 'medical_research') return 'Medical research outputs must separate dry-lab hypotheses from validated clinical evidence.';
    return 'Keep the signal, evidence, uncertainty, and next step connected.';
}

function inferUnresolved(text, lane) {
    if (/\bnext\b/i.test(text)) return 'Follow the stated next step and update the artifact ledger.';
    if (lane === 'market_evidence') return 'Check whether the evidence survives backtesting and fresh data.';
    if (lane === 'medical_research') return 'Check source quality, falsification criteria, and whether the folio overclaims.';
    return 'Decide whether this should become memory, training data, a public note, or a goal.';
}

export async function readDistilledReflections(limit = 25) {
    try {
        const raw = await fs.readFile(DISTILLER_FILE, 'utf8');
        return raw.trim().split(/\n+/).filter(Boolean).map(line => JSON.parse(line)).reverse().slice(0, limit);
    } catch {
        return [];
    }
}

export function reflectionDistillerPath() {
    return DISTILLER_FILE;
}

export default {
    distillReflection,
    readDistilledReflections,
    reflectionDistillerPath
};
