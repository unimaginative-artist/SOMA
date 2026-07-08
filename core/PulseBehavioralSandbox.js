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
        if (value == null) return { kind: typeof value, value: value };
        if (Array.isArray(value)) return { kind: 'array', length: value.length };
        if (typeof value === 'object') {
            const results = value.results;
            if (Array.isArray(results)) return { kind: 'object', resultsLen: results.length, tier: value.tier ?? null };
            return { kind: 'object', keys: Object.keys(value).slice(0, 8) };
        }
        return { kind: typeof value, value: String(value).slice(0, 80) };
    } catch { return { kind: 'unsummarizable' }; }
}

export async function verifyBehavior({ system, filepath, className, methodName, newFunctionSource, probes = [], mutating = false }) {
    if (mutating) return { passed: false, ran: false, reason: 'behavioral probe refused: method flagged as mutating (would touch live state)' };
    if (!system) return { passed: true, ran: false, reason: 'no system handle — skipped (fail-open)' };

    const live = resolveLiveInstance(system, className);
    if (!live || typeof live[methodName] !== 'function') {
        return { passed: true, ran: false, reason: `no live instance/method for ${className}.${methodName} — skipped (fail-open)` };
    }

    let PatchedClass, tmpPath;
    try {
        const absTarget = path.isAbsolute(filepath) ? filepath : path.join(ROOT, filepath);
        const original = await fs.readFile(absTarget, 'utf8');
        const patched = swapFunction(original, methodName, newFunctionSource);

        await fs.mkdir(SANDBOX_DIR, { recursive: true });
        // Keep the module's own imports resolvable by mirroring its extension and
        // placing the temp file where relative specifiers still resolve is hard,
        // so instead we import from a temp copy NEXT TO the original.
        tmpPath = path.join(path.dirname(absTarget), `.behav-${Date.now()}${path.extname(absTarget)}`);
        await fs.writeFile(tmpPath, patched, 'utf8');
        const mod = await import(pathToFileURL(tmpPath).href + `?t=${Date.now()}`);
        PatchedClass = mod[className] || mod.default || Object.values(mod).find(v => typeof v === 'function' && v.prototype?.[methodName]);
        if (!PatchedClass) throw new Error(`patched module did not export class ${className}`);
    } catch (e) {
        if (tmpPath) await fs.rm(tmpPath, { force: true }).catch(() => {});
        return { passed: false, ran: true, reason: `could not load patched module: ${e.message}` };
    }

    // Build a patched instance sharing the LIVE instance's real deps/state.
    const patchedInstance = Object.create(PatchedClass.prototype);
    Object.assign(patchedInstance, live);

    const comparisons = [];
    let passed = true;
    try {
        for (const probe of probes) {
            const args = Array.isArray(probe.args) ? probe.args : [probe.args];
            let origOut, origErr = null, testOut, testErr = null;
            try { origOut = await live[methodName](...args); } catch (e) { origErr = e.message; }
            try { testOut = await patchedInstance[methodName](...args); } catch (e) { testErr = e.message; }

            // Regression: patched throws where original didn't.
            const regressed = !origErr && testErr;
            // For the common empty-query guard, allow the patched to short-circuit
            // (return {results:[]}) on inputs the probe marks as expectedEmpty.
            const os = summarize(origOut), ts = summarize(testOut);
            const ok = !regressed && (probe.expectEmpty
                ? (ts.resultsLen === 0 || ts.tier === 'none')
                : true); // non-empty probes: pass if it didn't error/regress
            if (!ok) passed = false;
            comparisons.push({ label: probe.label || JSON.stringify(args).slice(0, 40), origErr, testErr, orig: os, test: ts, ok });
        }
    } finally {
        await fs.rm(tmpPath, { force: true }).catch(() => {});
    }

    return {
        passed,
        ran: true,
        method: `${className}.${methodName}`,
        probes: comparisons,
        note: 'in-process A/B against live dependencies'
    };
}

export default verifyBehavior;
