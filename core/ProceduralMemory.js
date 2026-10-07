import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_CASES = 600;
const MAX_PATTERNS = 300;

function normalize(value = '') {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function intentShape(value = '') {
    return normalize(value)
        .replace(/\b[0-9a-f]{8,}\b/g, '<id>')
        .replace(/\b\d+(?:\.\d+)?\b/g, '<n>')
        .split(/\s+/)
        .filter(token => token.length > 2)
        .slice(0, 24)
        .join(' ');
}

function signature(parts) {
    return crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

function tokens(value) {
    return new Set(intentShape(value).split(' ').filter(Boolean));
}

function similarity(a, b) {
    const left = tokens(a), right = tokens(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const token of left) if (right.has(token)) overlap++;
    return overlap / Math.max(left.size, right.size);
}

async function atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporary, filePath);
}

/** Stores grounded action recipes and failure signatures, never model narration. */
export class ProceduralMemory {
    constructor({ statePath = 'data/reality-loop/procedural-memory.json', now = () => Date.now() } = {}) {
        this.statePath = path.resolve(statePath);
        this.now = now;
        this.state = { schemaVersion: 1, cases: [], patterns: {}, updatedAt: null };
        this._writeChain = Promise.resolve();
    }

    async initialize() {
        try {
            const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.state = parsed;
        } catch { /* first boot or invalid legacy state */ }
        this.state.cases = Array.isArray(this.state.cases) ? this.state.cases.slice(-MAX_CASES) : [];
        this.state.patterns = this.state.patterns && typeof this.state.patterns === 'object' ? this.state.patterns : {};
        return this;
    }

    async recordTransaction(transaction = {}) {
        const observed = transaction.observed || {};
        const tools = [...new Set((observed.toolsUsed || []).map(String).filter(Boolean))];
        if (transaction.classification?.lane === 'inference' || (!tools.length && !transaction.error)) return null;
        return this.recordCase({
            source: 'cognitive_transaction',
            sourceId: transaction.id,
            domain: transaction.classification?.domain || 'general',
            task: transaction.input?.message || '',
            tools,
            verified: observed.verified === true,
            success: observed.success === true,
            failure: transaction.error || (!observed.verified ? 'completion_not_verified' : null),
            evidence: observed.evidence || null,
            durationMs: transaction.durationMs || 0,
            at: transaction.finishedAt || this.now()
        });
    }

    async recordCase(input = {}) {
        const domain = normalize(input.domain || 'general') || 'general';
        const taskShape = intentShape(input.task || input.title || 'unknown task');
        const tools = [...new Set((input.tools || []).map(String).filter(Boolean))];
        const failureShape = input.failure ? intentShape(input.failure).slice(0, 160) : null;
        const patternId = signature([domain, taskShape]);
        const caseRecord = {
            id: crypto.randomUUID(),
            patternId,
            source: input.source || 'unknown',
            sourceId: input.sourceId || null,
            domain,
            taskShape,
            tools,
            verified: input.verified === true,
            success: input.success === true,
            failureSignature: failureShape ? signature([domain, failureShape]) : null,
            failure: failureShape,
            evidenceDigest: input.evidence ? signature([JSON.stringify(input.evidence)]) : null,
            durationMs: Math.max(0, Number(input.durationMs || 0)),
            at: Number(input.at || this.now())
        };
        this.state.cases.push(caseRecord);
        this.state.cases = this.state.cases.slice(-MAX_CASES);

        const pattern = this.state.patterns[patternId] ||= {
            id: patternId, domain, taskShape, attempts: 0, verifiedSuccesses: 0,
            failures: 0, toolSequences: {}, failureSignatures: {}, lastAt: null
        };
        pattern.attempts++;
        if (caseRecord.verified) pattern.verifiedSuccesses++;
        if (!caseRecord.verified) pattern.failures++;
        if (tools.length) {
            const key = tools.join('>');
            const sequence = pattern.toolSequences[key] ||= { tools, attempts: 0, verifiedSuccesses: 0, lastAt: null };
            sequence.attempts++;
            if (caseRecord.verified) sequence.verifiedSuccesses++;
            sequence.lastAt = caseRecord.at;
        }
        if (caseRecord.failureSignature) {
            const failure = pattern.failureSignatures[caseRecord.failureSignature] ||= { signature: caseRecord.failureSignature, reason: caseRecord.failure, count: 0, lastAt: null };
            failure.count++;
            failure.lastAt = caseRecord.at;
        }
        pattern.lastAt = caseRecord.at;
        this._trimPatterns();
        await this._persist();
        return caseRecord;
    }

    retrieve({ task = '', domain = 'general', failure = null, limit = 5 } = {}) {
        const normalizedDomain = normalize(domain) || 'general';
        const failureId = failure ? signature([normalizedDomain, intentShape(failure).slice(0, 160)]) : null;
        return Object.values(this.state.patterns)
            .map(pattern => {
                const best = Object.values(pattern.toolSequences || {})
                    .sort((a, b) => (b.verifiedSuccesses / Math.max(1, b.attempts)) - (a.verifiedSuccesses / Math.max(1, a.attempts)) || b.verifiedSuccesses - a.verifiedSuccesses)[0] || null;
                const score = (pattern.domain === normalizedDomain ? 0.35 : 0)
                    + similarity(task, pattern.taskShape) * 0.5
                    + (failureId && pattern.failureSignatures?.[failureId] ? 0.15 : 0);
                return {
                    patternId: pattern.id,
                    domain: pattern.domain,
                    taskShape: pattern.taskShape,
                    score: Math.round(score * 1000) / 1000,
                    attempts: pattern.attempts,
                    verifiedSuccesses: pattern.verifiedSuccesses,
                    successRate: pattern.verifiedSuccesses / Math.max(1, pattern.attempts),
                    recommendedTools: best?.tools || [],
                    knownFailures: Object.values(pattern.failureSignatures || {}).sort((a, b) => b.count - a.count).slice(0, 3)
                };
            })
            .filter(item => item.score > 0.2)
            .sort((a, b) => b.score - a.score || b.verifiedSuccesses - a.verifiedSuccesses)
            .slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));
    }

    eligiblePatterns({ minimumVerified = 3, minimumSuccessRate = 0.75 } = {}) {
        return Object.values(this.state.patterns).filter(pattern => {
            const best = Object.values(pattern.toolSequences || {}).some(sequence =>
                sequence.verifiedSuccesses >= minimumVerified &&
                sequence.verifiedSuccesses / Math.max(1, sequence.attempts) >= minimumSuccessRate
            );
            return pattern.verifiedSuccesses >= minimumVerified && best;
        });
    }

    getStatus() {
        const patterns = Object.values(this.state.patterns);
        return {
            cases: this.state.cases.length,
            patterns: patterns.length,
            verifiedCases: this.state.cases.filter(item => item.verified).length,
            reusablePatterns: this.eligiblePatterns().length,
            updatedAt: this.state.updatedAt
        };
    }

    _trimPatterns() {
        const entries = Object.entries(this.state.patterns);
        if (entries.length <= MAX_PATTERNS) return;
        entries.sort((a, b) => Number(b[1].lastAt || 0) - Number(a[1].lastAt || 0));
        this.state.patterns = Object.fromEntries(entries.slice(0, MAX_PATTERNS));
    }

    async _persist() {
        this.state.updatedAt = this.now();
        this._writeChain = this._writeChain.catch(() => {}).then(() => atomicJson(this.statePath, this.state));
        await this._writeChain;
    }
}

export default ProceduralMemory;
