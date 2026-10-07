import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SAFE_TOOLS = new Set([
    'read_file', 'list_files', 'search_code', 'computer_read', 'computer_list', 'computer_search',
    'web_fetch', 'github_search', 'memory_recall', 'memory_store', 'write_file', 'save_progress',
    'run_tests', 'verify_syntax', 'modify_code', 'pulse_stage_code', 'goal_list', 'goal_status'
]);

async function atomicJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8');
    await fs.rename(temporary, filePath);
}

/** Compiles repeated verified procedures into inert, governed workflow manifests. */
export class SkillCompiler {
    constructor({ proceduralMemory = null, registryPath = 'data/reality-loop/skill-registry.json', skillDir = 'data/reality-loop/skills', now = () => Date.now() } = {}) {
        this.proceduralMemory = proceduralMemory;
        this.registryPath = path.resolve(registryPath);
        this.skillDir = path.resolve(skillDir);
        this.now = now;
        this.registry = { schemaVersion: 1, skills: {}, updatedAt: null };
        this._compilePromise = null;
    }

    async initialize() {
        try {
            const parsed = JSON.parse(await fs.readFile(this.registryPath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.registry = parsed;
        } catch { /* first boot */ }
        return this;
    }

    async compileEligible() {
        if (this._compilePromise) return this._compilePromise;
        this._compilePromise = this._compileEligible().finally(() => { this._compilePromise = null; });
        return this._compilePromise;
    }

    async _compileEligible() {
        const compiled = [];
        for (const pattern of this.proceduralMemory?.eligiblePatterns?.() || []) {
            if (this.registry.skills[pattern.id]) continue;
            const result = await this.compile(pattern);
            if (result?.compiled) compiled.push(result.skill);
        }
        return compiled;
    }

    async compile(pattern) {
        if (!pattern?.id) return { compiled: false, reason: 'missing_pattern' };
        const sequences = Object.values(pattern.toolSequences || {})
            .filter(sequence => sequence.verifiedSuccesses >= 3)
            .sort((a, b) => b.verifiedSuccesses - a.verifiedSuccesses || a.attempts - b.attempts);
        const best = sequences[0];
        if (!best?.tools?.length) return { compiled: false, reason: 'insufficient_verified_sequence' };
        const unsafe = best.tools.filter(tool => !SAFE_TOOLS.has(tool));
        if (unsafe.length) return { compiled: false, reason: 'unsafe_or_untyped_tools', tools: unsafe };

        const slug = `${pattern.domain}-${pattern.id}`.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
        const skill = {
            schemaVersion: 1,
            id: `procedure-${pattern.id}`,
            name: `Verified ${pattern.domain} procedure`,
            status: 'candidate',
            sourcePatternId: pattern.id,
            taskShape: pattern.taskShape,
            domain: pattern.domain,
            confidence: best.verifiedSuccesses / Math.max(1, best.attempts),
            evidence: {
                verifiedSuccesses: best.verifiedSuccesses,
                observedAttempts: best.attempts,
                compiledAt: new Date(this.now()).toISOString()
            },
            execution: {
                tools: best.tools.map((tool, index) => ({ order: index + 1, tool, argumentsFromCurrentTask: true })),
                arbitraryCodeAllowed: false,
                requireCurrentAuthorization: true,
                requireReadBack: best.tools.some(tool => ['write_file', 'modify_code', 'pulse_stage_code'].includes(tool)),
                completionEvidenceRequired: true
            },
            provenanceHash: crypto.createHash('sha256').update(JSON.stringify({ pattern: pattern.id, tools: best.tools, successes: best.verifiedSuccesses })).digest('hex')
        };
        const manifestPath = path.join(this.skillDir, `${slug}.json`);
        await atomicJson(manifestPath, skill);
        this.registry.skills[pattern.id] = { ...skill, manifestPath: path.relative(process.cwd(), manifestPath).replace(/\\/g, '/') };
        this.registry.updatedAt = this.now();
        await atomicJson(this.registryPath, this.registry);
        return { compiled: true, skill: this.registry.skills[pattern.id] };
    }

    recommend({ task = '', domain = 'general' } = {}) {
        const taskWords = new Set(String(task).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2));
        return Object.values(this.registry.skills || {})
            .filter(skill => skill.status === 'candidate' && (skill.domain === domain || domain === 'general'))
            .map(skill => {
                const words = String(skill.taskShape).split(' ');
                const overlap = words.filter(word => taskWords.has(word)).length / Math.max(1, words.length);
                return { ...skill, relevance: overlap };
            })
            .filter(skill => skill.relevance > 0.1)
            .sort((a, b) => b.relevance - a.relevance || b.confidence - a.confidence)
            .slice(0, 3);
    }

    getStatus() {
        const skills = Object.values(this.registry.skills || {});
        return { candidates: skills.length, active: skills.filter(item => item.status === 'active').length, recent: skills.slice(-10), updatedAt: this.registry.updatedAt };
    }
}

export default SkillCompiler;
