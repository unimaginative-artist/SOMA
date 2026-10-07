import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

export const CAPABILITY_TRIALS = Object.freeze({
    research: {
        label: 'research-to-paper',
        categories: ['research', 'knowledge'],
        tests: ['tests/agency-proving-ground.test.cjs', 'tests/research-source-outcomes.test.mjs'],
        holdoutTests: ['tests/rsi-research-holdout.test.mjs'],
    },
    coding: {
        label: 'governed coding',
        categories: ['engineering', 'testing'],
        tests: ['tests/self-modification-governance.test.mjs', 'tests/self-modification-safety.test.mjs'],
    },
    memory: {
        label: 'memory and state continuity',
        categories: ['learning', 'reflection'],
        tests: ['tests/canonical-state-projector.test.mjs', 'tests/cognitive-runtime.test.mjs'],
    },
    planning: {
        label: 'planning and goal completion',
        categories: ['strategy', 'user_priority'],
        tests: ['tests/typed-goal-workflow.test.mjs', 'tests/work-governor.test.cjs'],
    },
    tool_recovery: {
        label: 'tool failure recovery',
        categories: ['general', 'optimization'],
        tests: ['tests/agency-focus-tool-recovery.test.mjs', 'tests/soma-agentic-executor-continuation.test.mjs'],
    },
    social: {
        label: 'safe social behavior',
        categories: ['social'],
        tests: ['tests/bluesky-social-safety.test.mjs', 'tests/discord-social-review.test.mjs'],
    },
    vision: {
        label: 'multimodal perception and visual memory',
        categories: ['vision', 'perception'],
        tests: ['tests/multimodal-vision.test.mjs', 'tests/visual-object-memory.test.mjs'],
    },
    desktop: {
        label: 'desktop/app control contract tests (not a live-PC benchmark)',
        categories: ['engineering', 'tool_use'],
        tests: ['tests/computer-workspace-service.test.mjs', 'tests/desktop-adaptive-runtime.test.mjs', 'tests/computer-control-reliability.test.mjs', 'tests/aperture-pilot.test.mjs', 'tests/aperture-pilot-routes.test.mjs'],
    },
    trading_analysis: {
        label: 'paper-trading analysis',
        categories: ['trading'],
        tests: ['tests/test-market-strategy-compiler.mjs', 'tests/test-trading-performance-guard.mjs', 'tests/trading-attribution-integrity.test.mjs'],
        paperOnly: true,
    },
});

function atomicJson(filePath, value) {
    return fs.mkdir(path.dirname(filePath), { recursive: true })
        .then(() => fs.writeFile(`${filePath}.tmp`, JSON.stringify(value, null, 2), 'utf8'))
        .then(() => fs.rename(`${filePath}.tmp`, filePath));
}

function parseTestSummary(output = '') {
    const value = String(output || '');
    const number = label => Number(value.match(new RegExp(`(?:ℹ|#)\\s*${label}\\s+(\\d+)`, 'i'))?.[1] || 0);
    const tests = number('tests');
    const passed = number('pass');
    const failed = number('fail');
    return { tests, passed, failed, score: tests > 0 ? passed / tests : 0 };
}

export class CapabilityTrialRegistry {
    constructor({ root = process.cwd(), system = null, timeoutMs = 180_000 } = {}) {
        this.root = path.resolve(root);
        this.system = system;
        this.timeoutMs = Math.max(10_000, Number(timeoutMs) || 180_000);
        this.stateDir = path.join(this.root, 'data', 'self-evolution');
        this.scoreboardPath = path.join(this.stateDir, 'scoreboard.json');
        this.scoreboard = { schemaVersion: 1, currentVersion: 0, domains: {}, versions: [], updatedAt: null };
    }

    async initialize(system = this.system) {
        this.system = system || this.system;
        await fs.mkdir(this.stateDir, { recursive: true });
        try {
            const parsed = JSON.parse(await fs.readFile(this.scoreboardPath, 'utf8'));
            if (parsed?.schemaVersion === 1) this.scoreboard = parsed;
        } catch { /* first run */ }
        return this;
    }

    listTrials() {
        return Object.entries(CAPABILITY_TRIALS).map(([id, trial]) => ({ id, ...trial }));
    }

    async run(domain, { reason = 'scheduled_benchmark' } = {}) {
        const trial = CAPABILITY_TRIALS[domain];
        if (!trial) throw new Error(`Unknown capability trial: ${domain}`);
        const existing = [];
        const suiteSources = [];
        const registeredTests = [...trial.tests, ...(trial.holdoutTests || [])];
        for (const relative of registeredTests) {
            try {
                await fs.access(path.join(this.root, relative));
                existing.push(relative);
                suiteSources.push([relative, crypto.createHash('sha256').update(await fs.readFile(path.join(this.root, relative))).digest('hex')]);
            } catch { /* unavailable trials are evidence, not silent passes */ }
        }

        const startedAt = new Date().toISOString();
        const startedMs = Date.now();
        let output = '';
        let exitCode = 0;
        if (!existing.length) {
            exitCode = 2;
            output = 'No registered trial files are available.';
        } else {
            try {
                const { NODE_TEST_CONTEXT: inheritedTestContext, ...testEnv } = process.env;
                const result = await execFileAsync(process.execPath, ['--test', ...existing], {
                    cwd: this.root,
                    timeout: this.timeoutMs,
                    windowsHide: true,
                    maxBuffer: 8 * 1024 * 1024,
                    env: { ...testEnv, SOMA_CAPABILITY_TRIAL: '1' },
                });
                output = `${result.stdout || ''}\n${result.stderr || ''}`;
            } catch (error) {
                exitCode = Number(error.code) || 1;
                output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`;
            }
        }

        const summary = parseTestSummary(output);
        const observed = await this._observationalScore(trial.categories);
        const executableScore = summary.tests > 0 ? summary.score : 0;
        const score = observed == null ? executableScore : (executableScore * 0.7) + (observed * 0.3);
        const receipt = {
            id: `trial-${domain}-${Date.now()}`,
            domain,
            label: trial.label,
            reason,
            paperOnly: trial.paperOnly === true,
            startedAt,
            completedAt: new Date().toISOString(),
            durationMs: Date.now() - startedMs,
            valid: existing.length === registeredTests.length && summary.tests > 0,
            suiteFingerprint: crypto.createHash('sha256').update(JSON.stringify(suiteSources)).digest('hex'),
            missingTestFiles: registeredTests.filter(file => !existing.includes(file)),
            exitCode,
            testFiles: existing,
            tests: summary.tests,
            passed: summary.passed,
            failed: summary.failed,
            executableScore: clamp(executableScore),
            observationalScore: observed,
            score: clamp(score),
            evidenceHash: crypto.createHash('sha256').update(output).digest('hex'),
            outputTail: output.trim().split(/\r?\n/).slice(-20),
        };
        this.scoreboard.domains[domain] = receipt;
        this.scoreboard.updatedAt = receipt.completedAt;
        await this._persist();
        return receipt;
    }

    async runSuite({ reason = 'scheduled_suite', domains = Object.keys(CAPABILITY_TRIALS) } = {}) {
        const results = {};
        for (const domain of domains) {
            results[domain] = await this.run(domain, { reason });
        }
        return this.snapshot(results);
    }

    snapshot(results = this.scoreboard.domains) {
        const entries = Object.values(results || {}).filter(item => item?.valid);
        const composite = entries.length
            ? entries.reduce((sum, item) => sum + clamp(item.score), 0) / entries.length
            : 0;
        return {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            scores: Object.fromEntries(Object.entries(results || {}).map(([key, value]) => [key, clamp(value?.score)])),
            composite: Math.round(composite * 1000) / 1000,
            receipts: results,
        };
    }

    compare(before, after, tolerance = 0.02) {
        const dimensions = new Set([...Object.keys(before?.scores || {}), ...Object.keys(after?.scores || {})]);
        const improved = [];
        const regressed = [];
        const unchanged = [];
        for (const domain of dimensions) {
            const prior = Number(before?.scores?.[domain] || 0);
            const next = Number(after?.scores?.[domain] || 0);
            const delta = next - prior;
            if (delta > tolerance) improved.push({ domain, before: prior, after: next, delta });
            else if (delta < -tolerance) regressed.push({ domain, before: prior, after: next, delta });
            else unchanged.push(domain);
        }
        return {
            valid: Boolean(before && after),
            delta: Number(after?.composite || 0) - Number(before?.composite || 0),
            improved,
            regressed,
            unchanged,
        };
    }

    weakest(snapshot = this.snapshot()) {
        const candidates = Object.entries(snapshot.scores || {}).filter(([domain]) => CAPABILITY_TRIALS[domain]);
        if (!candidates.length) return { dimension: 'tool_recovery', score: 0, reason: 'No capability trials have been measured yet' };
        // A historical success ratio must not outrank an executable defect.
        // Otherwise a saturated suite keeps generating diagnoses while actual
        // failures elsewhere never receive an experiment.
        const failing = domain => {
            const receipt = snapshot.receipts?.[domain];
            return receipt?.valid === true && (receipt.exitCode !== 0 || receipt.failed > 0) ? 1 : 0;
        };
        candidates.sort((a, b) => failing(b[0]) - failing(a[0]) || a[1] - b[1] || a[0].localeCompare(b[0]));
        const [dimension, score] = candidates[0];
        return {
            dimension,
            score,
            label: CAPABILITY_TRIALS[dimension].label,
            paperOnly: CAPABILITY_TRIALS[dimension].paperOnly === true,
            testFiles: CAPABILITY_TRIALS[dimension].tests,
            reason: 'Lowest repeatable cross-domain capability score',
        };
    }

    async promoteVersion({ experimentId, comparison, scores }) {
        const version = Math.max(Number(this.scoreboard.currentVersion || 0), ...(this.scoreboard.versions || []).map(item => Number(item.version) || 0)) + 1;
        this.scoreboard.currentVersion = version;
        this.scoreboard.versions = [...(this.scoreboard.versions || []), {
            version,
            experimentId,
            promotedAt: new Date().toISOString(),
            composite: scores?.composite ?? null,
            delta: comparison?.delta ?? null,
            scores: scores?.scores || {},
        }].slice(-100);
        await this._persist();
        return version;
    }

    async retractVersion(experimentId, reason) {
        let changed = false;
        for (const version of this.scoreboard.versions || []) {
            if (version.experimentId !== experimentId || version.status === 'retracted') continue;
            Object.assign(version, { status: 'retracted', retractedAt: new Date().toISOString(), reason });
            changed = true;
        }
        if (changed) {
            this.scoreboard.currentVersion = Math.max(0, ...(this.scoreboard.versions || [])
                .filter(item => item.status !== 'retracted').map(item => Number(item.version) || 0));
            await this._persist();
        }
        return changed;
    }

    getStatus() {
        return {
            currentVersion: this.scoreboard.currentVersion || 0,
            domains: this.scoreboard.domains,
            versions: (this.scoreboard.versions || []).slice(-10),
            updatedAt: this.scoreboard.updatedAt,
        };
    }

    async _observationalScore(categories = []) {
        const evidence = [];
        try {
            const learning = this.system?.learningSpine?.getStatus?.() || null;
            let board = learning?.scoreboard;
            if (!board) board = JSON.parse(await fs.readFile(path.join(this.root, 'data', 'learning', 'competency-scoreboard.json'), 'utf8'));
            const rows = categories.map(category => board?.domains?.[category]).filter(Boolean);
            if (rows.length) evidence.push(clamp(rows.reduce((sum, row) => {
                const success = Number(row.verified || 0) / Math.max(1, Number(row.attempts || 0));
                const quality = clamp(Number(row.averageVerificationScore || 0) / 100);
                return sum + (success * 0.6) + (quality * 0.4);
            }, 0) / rows.length));
        } catch { /* learning evidence is optional */ }

        const domain = Object.entries(CAPABILITY_TRIALS).find(([, trial]) => trial.categories === categories)?.[0]
            || Object.entries(CAPABILITY_TRIALS).find(([, trial]) => trial.categories.join('|') === categories.join('|'))?.[0];
        const provingTrial = {
            research: 'research-to-paper',
            planning: 'reflection-consolidation',
            tool_recovery: 'computer-search-and-report',
            desktop: 'computer-search-and-report',
        }[domain];
        if (provingTrial && this.system?.agencyProvingGround?.listRuns) {
            const run = this.system.agencyProvingGround.listRuns(100)
                .find(item => item.trialId === provingTrial && item.terminal && Number.isFinite(Number(item.score?.value)));
            if (run) evidence.push(clamp(Number(run.score.value) / 100));
        }
        if (domain === 'trading_analysis') {
            const simulation = this.system?.simulationEvaluator?.getStatus?.();
            const leader = simulation?.leaderboard?.[0];
            if (simulation?.totalTrades >= 30 && Number.isFinite(Number(leader?.score))) evidence.push(clamp(leader.score));
        }
        if (domain === 'planning') {
            const embodiment = this.system?.simulation?.getStatus?.();
            if (embodiment?.stats?.episodesCompleted > 0) evidence.push(clamp(embodiment.stats.successRate));
        }
        return evidence.length ? evidence.reduce((sum, value) => sum + value, 0) / evidence.length : null;
    }

    async _persist() {
        await atomicJson(this.scoreboardPath, this.scoreboard);
    }
}

export default CapabilityTrialRegistry;
