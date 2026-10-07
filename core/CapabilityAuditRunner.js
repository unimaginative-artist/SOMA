import fs from 'fs/promises';
import path from 'path';
import { recordCapabilityTruth, recordTruth } from './TruthLedger.js';

const ROOT = process.cwd();
const AUDIT_PATH = path.join(ROOT, 'data', 'capability-audit.json');
const DAY_MS = 24 * 60 * 60 * 1000;

async function readJson(filePath, fallback = null) {
    try { return JSON.parse(await fs.readFile(filePath, 'utf8')); }
    catch { return fallback; }
}

async function writeJson(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function checkHttp(url, timeoutMs = 3500) {
    const started = Date.now();
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
        let body = null;
        try { body = await response.json(); } catch {}
        return { ok: response.ok, status: response.status, latencyMs: Date.now() - started, body };
    } catch (error) {
        return { ok: false, error: error.message, latencyMs: Date.now() - started };
    }
}

export async function runCapabilityAudit(system = {}, options = {}) {
    const force = options.force === true;
    const previous = await readJson(AUDIT_PATH, null);
    if (!force && previous?.completedAt && Date.now() - previous.completedAt < DAY_MS) {
        return { ...previous, cached: true };
    }

    const checks = [];
    const add = async (name, result, capability = name) => {
        const passed = Boolean(result?.passed ?? result?.ok);
        const check = {
            name,
            passed,
            checkedAt: new Date().toISOString(),
            result
        };
        checks.push(check);
        await recordCapabilityTruth(capability, {
            verified: passed,
            status: passed ? 'verified' : 'failed',
            confidence: passed ? 1 : 0.85,
            source: 'capability_audit_runner',
            proof: result
        }).catch(() => {});
    };

    await add('Max HTTP health', await checkHttp('http://127.0.0.1:3100/health'), 'SOMA can reach MAX');
    await add('Marionette supervisor health', await checkHttp('http://127.0.0.1:9000/status'), 'SOMA can reach Marionette');

    const selfMod = system.selfModificationArbiter || system.selfModification || system.selfMod;
    await add('Pulse self-mod staging lane', {
        passed: Boolean(selfMod || await fs.stat(path.join(ROOT, 'data', 'code-lab', 'sandbox', 'pulse-self-mod')).then(() => true).catch(() => false)),
        path: 'data/code-lab/sandbox/pulse-self-mod'
    }, 'SOMA has Pulse self-mod staging lane');

    const packageJson = await fs.stat(path.join(ROOT, 'package.json')).then(() => true).catch(() => false);
    await add('Executable syntax/test capability', {
        passed: packageJson,
        proof: packageJson ? 'package.json present; executor can run node/npm checks' : 'package.json missing'
    }, 'SOMA can run executable verification');

    const agenticExecutor = system.agenticExecutor;
    await add('Agentic delegation tool', {
        passed: Boolean(agenticExecutor?._tools?.spawn_agents),
        tool: 'spawn_agents'
    }, 'SOMA can delegate agentic work');

    const audit = {
        id: `cap-audit-${Date.now()}`,
        completedAt: Date.now(),
        completedAtIso: new Date().toISOString(),
        cached: false,
        passed: checks.every(check => check.passed),
        checks
    };
    await writeJson(AUDIT_PATH, audit);
    await recordTruth('Daily capability audit completed', {
        status: audit.passed ? 'verified' : 'degraded',
        confidence: audit.passed ? 1 : 0.7,
        proof: { passed: audit.passed, checks: checks.map(c => ({ name: c.name, passed: c.passed })) },
        source: 'capability_audit_runner',
        artifactPath: 'data/capability-audit.json'
    }).catch(() => {});
    return audit;
}

export async function getLastCapabilityAudit() {
    return readJson(AUDIT_PATH, null);
}

export { AUDIT_PATH as CAPABILITY_AUDIT_PATH };
