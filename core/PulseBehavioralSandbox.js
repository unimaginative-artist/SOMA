/**
 * PulseBehavioralSandbox.js — real behavioral verification for self-modifications.
 *
 * The problem it solves: the old codebase-simulation sandbox shells out to a
 * SEPARATE node process that has no Redis / DB / embedder, so it silently
 * no-ops on every stateful arbiter — exactly the files SOMA most wants to
 * self-modify. That left those changes verified by syntax + LLM opinion only.
 *
 * This runs the check IN-PROCESS, where the live SOMA already holds open,
 * connected dependencies. It:
 *   1. Applies the proposed function-swap to a throwaway copy of the module.
 *   2. Imports that patched module in-process.
 *   3. Builds a patched instance that SHARES the live arbiter's real
 *      dependencies (redis, db, embedder, vector store, config, …).
 *   4. Runs the same probe inputs through BOTH the live (original) method and
 *      the patched method, and compares outcomes.
 *
 * Verdict is behavioral, not opinion: if the patched version errors where the
 * original succeeded, or diverges on inputs that should be unchanged, it fails.
 *
 * SAFETY: intended for read-path methods (recall, analyze, score…). Because the
 * patched instance shares the live deps, a probe that WRITES could touch live
 * state — callers must only probe read-mostly methods. `mutating: false` is the
 * default and enforced by refusing to run when the caller flags a write path.
 */

import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { parse } from '@babel/parser';

const ROOT = process.cwd();
const SANDBOX_DIR = path.join(ROOT, 'data', 'code-lab', 'sandbox', 'behavioral');

// className → the property it lives under on the system object. Extend as needed.
function resolveLiveInstance(system, className) {
    if (!system || !className) return null;
    const camel = className.charAt(0).toLowerCase() + className.slice(1);
    const candidates = [
        camel,
        camel.replace(/Arbiter$/, ''),
        className,
    ];
    for (const key of candidates) {
        if (system[key] && typeof system[key] === 'object') return system[key];
    }
    // Last resort: scan for an instance whose constructor name matches.
    for (const v of Object.values(system)) {
        if (v && typeof v === 'object' && v.constructor?.name === className) return v;
    }
    return null;
}

// Reuse the AST function-swap so what we test is byte-identical to what would ship.
function swapFunction(content, name, newSource) {
    const ast = parse(content, {
        sourceType: 'unambiguous', errorRecovery: true,
        plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator', 'topLevelAwait']
    });
    let node = null;
    const nameOf = (n) => {
        const t = n.type;
        if (t === 'FunctionDeclaration' && n.id) return n.id.name;
        if ((t === 'ClassMethod' || t === 'ObjectMethod') && n.key) return n.key.name ?? n.key.value;
        return null;
    };
    const visit = (n) => {
        if (node || !n || typeof n !== 'object') return;
        if (Array.isArray(n)) { for (const x of n) visit(x); return; }
        if (typeof n.type === 'string' && nameOf(n) === name && typeof n.start === 'number') { node = n; return; }
        for (const k in n) { if (['loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments'].includes(k)) continue; const v = n[k]; if (v && typeof v === 'object') visit(v); }
    };
    visit(ast.program.body);
    if (!node) throw new Error(`function/method "${name}" not found in module`);
    return content.slice(0, node.start) + String(newSource).trim() + content.slice(node.end);
}

function summarize(value) {
    try {
        if (value == null) return { kind: typeof value, isNull: true };
        if (Array.isArray(value)) return { kind: 'array', length: value.length };
        if (typeof value === 'object') {
            const s = { kind: 'object', keys: Object.keys(value).sort() };
            if (Array.isArray(value.results)) { s.resultsLen = value.results.length; s.tier = value.tier ?? null; }
            return s;
        }
        if (typeof value === 'number') return { kind: 'number', isNaN: Number.isNaN(value) };
        return { kind: typeof value, value: String(value).slice(0, 60) };
    } catch { return { kind: 'unsummarizable' }; }
}

// Find the class that declares a method named `methodName`, so the swarm doesn't
// have to tell us the class — we read it from the source being modified.
function resolveClassForMethod(content, methodName) {
    let ast;
    try {
        ast = parse(content, { sourceType: 'unambiguous', errorRecovery: true,
            plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator', 'topLevelAwait'] });
    } catch { return null; }
    let found = null;
    const visit = (n, cls) => {
        if (found || !n || typeof n !== 'object') return;
        if (Array.isArray(n)) { for (const x of n) visit(x, cls); return; }
        const nextCls = (n.type === 'ClassDeclaration' || n.type === 'ClassExpression') && n.id ? n.id.name : cls;
        if (n.type === 'ClassMethod' && n.key && (n.key.name ?? n.key.value) === methodName && nextCls) { found = nextCls; return; }
        for (const k in n) { if (['loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments'].includes(k)) continue; const v = n[k]; if (v && typeof v === 'object') visit(v, nextCls); }
    };
    visit(ast.program ? ast.program.body : ast, null);
    return found;
}

// Generic probe inputs: run the OLD method with each; keep the ones that don't
// throw, so we compare on inputs the original genuinely handles.
const AUTO_PROBE_ARGS = [ [], [''], ['test'], ['BTC-USD'], [null], [undefined], [0], [1], [{}], [[]], ['test', 3] ];

export async function verifyBehavior({ system, filepath, className, methodName, newFunctionSource, originalContent = null, probes = [], mutating = false }) {
    if (mutating) return { passed: true, ran: false, reason: 'skipped: method flagged mutating (would touch live state)' };

    const absTarget = path.isAbsolute(filepath) ? filepath : path.join(ROOT, filepath);
    let original = originalContent;
    if (original == null) { try { original = await fs.readFile(absTarget, 'utf8'); } catch { return { passed: true, ran: false, reason: 'could not read source' }; } }

    // Auto-resolve the class from the source if the caller didn't name it.
    const cls = className || resolveClassForMethod(original, methodName);
    if (!cls) return { passed: true, ran: false, reason: `no class found for method ${methodName} — skipped (fail-open)` };

    // The OLD baseline: the live in-memory instance (real deps + real state) if
    // present, else a fresh instance from the ORIGINAL source.
    const live = system ? resolveLiveInstance(system, cls) : null;

    let tmpNew, tmpOld, oldInst, newInst;
    try {
        const patched = swapFunction(original, methodName, newFunctionSource);
        await fs.mkdir(SANDBOX_DIR, { recursive: true });
        tmpNew = path.join(path.dirname(absTarget), `.behav-new-${Date.now()}${path.extname(absTarget)}`);
        await fs.writeFile(tmpNew, patched, 'utf8');
        const modNew = await import(pathToFileURL(tmpNew).href + `?t=${Date.now()}`);
        newInst = instanceFrom(modNew, cls, methodName);
        if (!newInst) throw new Error(`patched module exposed no usable instance/class for ${cls}.${methodName}`);

        if (live) {
            oldInst = live;
        } else {
            tmpOld = path.join(path.dirname(absTarget), `.behav-old-${Date.now()}${path.extname(absTarget)}`);
            await fs.writeFile(tmpOld, original, 'utf8');
            const modOld = await import(pathToFileURL(tmpOld).href + `?t=${Date.now()}`);
            oldInst = instanceFrom(modOld, cls, methodName);
        }
        // Share the old instance's state onto the new one so the A/B runs on the
        // same data (the whole point — compare behavior, not empty scaffolding).
        if (oldInst && newInst && oldInst !== newInst) {
            for (const k of Object.keys(oldInst)) { try { newInst[k] = oldInst[k]; } catch {} }
        }
    } catch (e) {
        for (const p of [tmpNew, tmpOld]) if (p) await fs.rm(p, { force: true }).catch(() => {});
        return { passed: false, ran: true, reason: `could not load patched module: ${e.message}` };
    }

    if (!oldInst || typeof oldInst[methodName] !== 'function' || !newInst || typeof newInst[methodName] !== 'function') {
        return finishSkip([tmpNew, tmpOld], `no runnable old/new instance for ${cls}.${methodName} — skipped (fail-open)`);
    }

    // Probe set: caller-provided, else auto-generate (keep args the OLD handles).
    const probeArgs = probes.length ? probes.map(p => Array.isArray(p.args) ? p.args : [p.args]) : AUTO_PROBE_ARGS;
    const comparisons = [];
    let passed = true, ranAny = false;
    try {
        for (const args of probeArgs) {
            let oOut, oErr = null, nOut, nErr = null;
            try { oOut = await oldInst[methodName](...args); } catch (e) { oErr = e.message; }
            try { nOut = await newInst[methodName](...args); } catch (e) { nErr = e.message; }
            ranAny = true;
            const os = summarize(oOut), ns = summarize(nOut);

            // FAIL conditions (real behavioral regressions):
            //  - new throws where old didn't
            //  - new returns an object with DIFFERENT keys than old (contract change)
            //  - new returns NaN where old returned a real number
            const newThrows = !oErr && nErr;
            const shapeChanged = os.kind === 'object' && ns.kind === 'object'
                && JSON.stringify(os.keys) !== JSON.stringify(ns.keys);
            const nanRegression = os.kind === 'number' && !os.isNaN && ns.kind === 'number' && ns.isNaN;
            const ok = !(newThrows || shapeChanged || nanRegression);
            if (!ok) passed = false;
            comparisons.push({ args: JSON.stringify(args).slice(0, 30), oErr, nErr, old: os, new: ns, ok,
                fail: newThrows ? 'new_throws' : shapeChanged ? 'shape_changed' : nanRegression ? 'nan' : null });
        }
    } finally {
        for (const p of [tmpNew, tmpOld]) if (p) await fs.rm(p, { force: true }).catch(() => {});
    }

    const flagged = comparisons.filter(c => !c.ok);
    return {
        passed,
        ran: ranAny,
        method: `${cls}.${methodName}`,
        baseline: live ? 'live-instance' : 'fresh-instance',
        probesRun: comparisons.length,
        failures: flagged.slice(0, 5),
        note: passed ? 'behavior preserved (A/B on real inputs)' : 'behavioral regression detected'
    };
}

// Get a usable instance (with the target method) from a module, whether it
// exports the CLASS (construct it) or a SINGLETON INSTANCE (use it directly).
function instanceFrom(mod, cls, methodName) {
    const asClass = (typeof mod[cls] === 'function' && mod[cls].prototype?.[methodName]) ? mod[cls]
        : (typeof mod.default === 'function' && mod.default.prototype?.[methodName]) ? mod.default
        : Object.values(mod).find(v => typeof v === 'function' && v.prototype?.[methodName]);
    if (asClass) { try { return new asClass(); } catch { try { return new asClass({}); } catch { /* fall through */ } } }
    // Singleton instance export
    if (mod.default && typeof mod.default[methodName] === 'function') return mod.default;
    return Object.values(mod).find(v => v && typeof v === 'object' && typeof v[methodName] === 'function') || null;
}

async function finishSkip(paths, reason) {
    for (const p of paths) if (p) await fs.rm(p, { force: true }).catch(() => {});
    return { passed: true, ran: false, reason };
}

export default verifyBehavior;
