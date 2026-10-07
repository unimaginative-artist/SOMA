/**
 * core/SwarmPatchTransaction.js
 *
 * Multi-file patch transaction system for SOMA.
 * Allows safe multi-file edits with atomic-like rollback protection.
 *
 * Supports three patch modes per file:
 *   1. full_rewrite  — { path, content }   — overwrites the whole file (AEGIS-guarded for large files)
 *   2. surgical      — { path, edits: [{ old, new }] } — targeted string replacements
 *   3. replaceFunction — { path, replaceFunction: { name, source } } — AST-located
 *      whole-function/method swap. Robust to LLM formatting drift: instead of a
 *      fragile multi-line find-and-replace (which dies if the model drops a line),
 *      it finds the named function via the parser and swaps its entire span.
 *
 * AEGIS Guard: if a full_rewrite would silently delete routes or function signatures
 * that existed before the patch, the write is blocked and an error is thrown.
 */

import fs from 'fs/promises';
import path from 'path';
import { resolveWithinRoot } from './PathSafety.js';
import { parse } from '@babel/parser';

// ── AEGIS: files with more lines than this get signature-checked before any full_rewrite ──
const AEGIS_LINE_THRESHOLD = 100;

/**
 * Extract structural signatures from file content.
 * Detects HTTP routes, named functions, classes, and exports.
 * Returns a Set of strings like "route:GET:/api/soma/chat" or "fn:loadTools".
 */
function extractSignatures(content) {
    const sigs = new Set();

    // HTTP route registrations: router.get('/path', ...) or app.post('/path', ...)
    for (const m of content.matchAll(/\.\s*(get|post|put|patch|delete|use)\s*\(\s*['"`]([^'"`]+)['"`]/gi)) {
        sigs.add(`route:${m[1].toUpperCase()}:${m[2]}`);
    }

    // Named function declarations: function foo() or async function foo()
    for (const m of content.matchAll(/(?:async\s+)?function\s+(\w+)\s*\(/g)) {
        sigs.add(`fn:${m[1]}`);
    }

    // Class declarations
    for (const m of content.matchAll(/\bclass\s+(\w+)/g)) {
        sigs.add(`class:${m[1]}`);
    }

    // Top-level exports: export function X, export default function X, export const X
    for (const m of content.matchAll(/^export\s+(?:default\s+)?(?:async\s+function|function|class|const)\s+(\w+)/gm)) {
        sigs.add(`export:${m[1]}`);
    }

    return sigs;
}

/**
 * Apply a surgical edit (series of old→new string replacements) to content.
 * Returns { result, applied, failed } where failed lists any edits whose old string wasn't found.
 */
// Whitespace-tolerant locator: LLM-generated old-strings routinely differ from
// the file only in indentation / trailing spaces / blank-line runs, which broke
// exact-substring matching and failed otherwise-valid patches. Find a span in
// `content` whose whitespace-normalized form equals the normalized `needle`,
// and return the exact original span so we replace real bytes (not normalized
// ones). Content differences beyond whitespace still fail — this only forgives
// formatting, never meaning.
function normalizeWs(s) {
    return s.replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{2,}/g, '\n').trim();
}

function findWhitespaceTolerantSpan(content, needle) {
    const normNeedle = normalizeWs(needle);
    if (!normNeedle) return null;
    // Anchor on the first non-trivial line of the needle to limit the search.
    const anchor = needle.split('\n').map(l => l.trim()).find(l => l.length > 3);
    if (!anchor) return null;
    let from = 0;
    while (true) {
        const idx = content.indexOf(anchor, from);
        if (idx === -1) return null;
        // Expand a candidate window forward and test increasing end points.
        for (let end = idx + anchor.length; end <= content.length; end++) {
            if (normalizeWs(content.slice(idx, end)) === normNeedle) {
                return { start: idx, end };
            }
            if (end - idx > needle.length * 3 + 400) break; // window too big — give up on this anchor
        }
        from = idx + anchor.length;
    }
}

// Find a named function / class method / assigned arrow in the AST and return its
// exact source span. Handles the common declaration forms so the swarm can swap a
// whole function without brittle string matching.
function locateFunctionSpan(content, name) {
    let ast;
    try {
        ast = parse(content, {
            sourceType: 'unambiguous',
            errorRecovery: true,
            plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator', 'topLevelAwait']
        });
    } catch (e) {
        return { ok: false, reason: `parse failed: ${e.message}` };
    }
    let found = null;
    const nameOf = (node) => {
        const t = node.type;
        if (t === 'FunctionDeclaration' && node.id) return node.id.name;
        if ((t === 'ClassMethod' || t === 'ObjectMethod') && node.key) return node.key.name ?? node.key.value;
        if (t === 'ClassProperty' && node.key && node.value && /FunctionExpression|ArrowFunctionExpression/.test(node.value.type)) return node.key.name;
        if (t === 'VariableDeclarator' && node.id && node.init && /FunctionExpression|ArrowFunctionExpression/.test(node.init.type)) return node.id.name;
        return null;
    };
    const visit = (node) => {
        if (found || !node || typeof node !== 'object') return;
        if (Array.isArray(node)) { for (const n of node) visit(n); return; }
        if (typeof node.type === 'string' && nameOf(node) === name
            && typeof node.start === 'number' && typeof node.end === 'number') {
            found = node; return;
        }
        for (const k in node) {
            if (k === 'loc' || k === 'start' || k === 'end' || k === 'range'
                || k === 'leadingComments' || k === 'trailingComments' || k === 'innerComments') continue;
            const v = node[k];
            if (v && typeof v === 'object') visit(v);
        }
    };
    visit(ast.program ? ast.program.body : ast);
    if (!found) return { ok: false, reason: `function/method "${name}" not found` };
    return { ok: true, start: found.start, end: found.end };
}

// Common built-in member names — accessing these is never "hallucinated".
const BUILTIN_MEMBERS = new Set(['length','map','filter','reduce','reduceRight','forEach','find','findIndex','findLast','some','every','includes','indexOf','lastIndexOf','slice','splice','push','pop','shift','unshift','join','split','concat','sort','reverse','flat','flatMap','keys','values','entries','fill','at','toString','valueOf','toFixed','toPrecision','toExponential','toUpperCase','toLowerCase','trim','trimStart','trimEnd','replace','replaceAll','match','matchAll','search','startsWith','endsWith','padStart','padEnd','charAt','charCodeAt','codePointAt','substring','substr','repeat','normalize','localeCompare','then','catch','finally','all','allSettled','race','any','resolve','reject','log','warn','error','info','debug','table','parse','stringify','now','getTime','getFullYear','getMonth','getDate','getHours','toISOString','hasOwnProperty','constructor','prototype','call','apply','bind','name','message','stack','code','max','min','abs','round','floor','ceil','sqrt','cbrt','pow','random','sign','trunc','log2','log10','hypot','add','set','get','has','delete','clear','size','from','of','isArray','isInteger','isSafeInteger','isFinite','isNaN','assign','freeze','create','defineProperty','getOwnPropertyNames','entries','test','exec','source','flags','lastIndex','default','status','ok','json','text','headers','body','signal','aborted','type','target','currentTarget','key','value','done','next','return','throw','padEnd']);

// Property names accessed via `obj.PROP` (non-computed) in a source snippet.
function collectAccessedMembers(source) {
    const names = new Set();
    let ast;
    try {
        ast = parse(source, { sourceType: 'unambiguous', errorRecovery: true, plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods', 'objectRestSpread', 'optionalChaining', 'nullishCoalescingOperator'] });
    } catch { return names; }
    const visit = (n) => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) { for (const x of n) visit(x); return; }
        if ((n.type === 'MemberExpression' || n.type === 'OptionalMemberExpression') && !n.computed && n.property && n.property.type === 'Identifier') {
            names.add(n.property.name);
        }
        for (const k in n) { if (['loc', 'start', 'end', 'range', 'leadingComments', 'trailingComments'].includes(k)) continue; const v = n[k]; if (v && typeof v === 'object') visit(v); }
    };
    visit(ast.program ? ast.program.body : ast);
    return names;
}

// A function-swap should never read a member that appears NOWHERE in the file —
// that member has to be defined somewhere to exist, so its absence means the LLM
// invented it (e.g. hallucinating t.slipPct when trades only have slippageBps).
// This is the #1 self-mod failure mode and it can't be caught by syntax alone.
function findHallucinatedMembers(newFunctionSource, originalFileContent) {
    const accessed = collectAccessedMembers(newFunctionSource);
    if (!accessed.size) return [];
    const fileTokens = new Set(String(originalFileContent).match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);
    const invented = [];
    for (const m of accessed) {
        if (BUILTIN_MEMBERS.has(m)) continue;
        if (!fileTokens.has(m)) invented.push(m);
    }
    return invented;
}

function replaceFunctionInSource(content, name, newSource) {
    const span = locateFunctionSpan(content, name);
    if (!span.ok) return { ok: false, reason: span.reason };
    const result = content.slice(0, span.start) + String(newSource).trim() + content.slice(span.end);
    // Safety: the replacement must itself parse (no broken syntax swapped in).
    try {
        parse(result, { sourceType: 'unambiguous', errorRecovery: false,
            plugins: ['classProperties', 'classPrivateProperties', 'classPrivateMethods', 'objectRestSpread'] });
    } catch (e) {
        return { ok: false, reason: `replacement would break file syntax: ${e.message}` };
    }
    return { ok: true, result };
}

function applySurgicalEdits(originalContent, edits) {
    let result = originalContent;
    const applied = [];
    const failed = [];

    for (const edit of edits) {
        if (typeof edit.old !== 'string' || typeof edit.new !== 'string') {
            failed.push({ edit, reason: 'edit.old and edit.new must be strings' });
            continue;
        }
        if (result.includes(edit.old)) {
            result = result.replace(edit.old, edit.new);
            applied.push(edit);
            continue;
        }
        // Fallback: forgive whitespace/indentation drift in the LLM's old-string.
        const span = findWhitespaceTolerantSpan(result, edit.old);
        if (span) {
            result = result.slice(0, span.start) + edit.new + result.slice(span.end);
            applied.push({ ...edit, matchedVia: 'whitespace_tolerant' });
            continue;
        }
        failed.push({ edit, reason: 'old string not found in file — content may have changed' });
    }

    return { result, applied, failed };
}

export class SwarmPatchTransaction {
    constructor(rootPath) {
        this.rootPath = rootPath || process.cwd();
        this.backups = [];
        this.applied = false;
    }

    /**
     * Apply a patch containing multiple file changes.
     *
     * Each file entry supports:
     *   { path, content }          — full rewrite (AEGIS-guarded for large files)
     *   { path, edits: [{old,new}] } — surgical replacements (safe, no AEGIS check needed)
     *
     * @param {Object} patch { files: [...] }
     */
    async applyPatch(patch) {
        if (!patch || !Array.isArray(patch.files)) {
            throw new Error("Invalid patch format: expected { files: [...] }");
        }

        this.backups = [];
        const filesToPatch = [];

        try {
            // ── 1. Prepare, Backup, and AEGIS Check ──────────────────────────
            for (const file of patch.files) {
                const fullPath = resolveWithinRoot(this.rootPath, file.path, 'Patch path');

                let original = null;
                try {
                    original = await fs.readFile(fullPath, 'utf8');
                } catch {
                    // New file — no backup needed
                }

                this.backups.push({
                    path: fullPath,
                    content: original,
                    isNew: original === null
                });

                // ── Determine patch mode ──────────────────────────────────────
                if (file.replaceFunction && typeof file.replaceFunction.name === 'string'
                    && typeof file.replaceFunction.source === 'string') {
                    // FUNCTION-SWAP MODE: AST-located whole-function replacement.
                    if (original === null) {
                        throw new Error(`replaceFunction on non-existent file: ${file.path}`);
                    }
                    const { ok, result, reason } = replaceFunctionInSource(original, file.replaceFunction.name, file.replaceFunction.source);
                    if (!ok) {
                        throw new Error(`[AEGIS] replaceFunction failed for ${file.path}: ${reason}`);
                    }
                    // Behavioral guard: reject hallucinated field/method references so the
                    // swarm retries with the real identifiers instead of shipping garbage.
                    const invented = findHallucinatedMembers(file.replaceFunction.source, original);
                    if (invented.length) {
                        throw new Error(`[AEGIS] Function-swap "${file.replaceFunction.name}" references members that exist NOWHERE in ${file.path} — likely hallucinated: ${invented.join(', ')}. Rewrite using only identifiers that appear in the current source.`);
                    }
                    // No signature-preservation check needed: replaceFunction only rewrites
                    // the located function's byte span, so all code outside it is identical
                    // by construction, and replaceFunctionInSource already re-parses the
                    // result to guarantee valid syntax. (A whole-file signature diff here
                    // also false-positives on in-function calls like redis.get('...').)
                    console.log(`[SwarmTransaction] 🔧 Function-swap: replaced "${file.replaceFunction.name}" in ${file.path}`);
                    filesToPatch.push({ path: fullPath, content: result });

                } else if (Array.isArray(file.edits)) {
                    // SURGICAL MODE: apply edits to original content
                    if (original === null) {
                        throw new Error(`Surgical edit on non-existent file: ${file.path}`);
                    }
                    const { result, applied, failed } = applySurgicalEdits(original, file.edits);
                    if (failed.length > 0) {
                        const reasons = failed.map(f => `  • "${String(f.edit.old).substring(0, 60)}..." — ${f.reason}`).join('\n');
                        throw new Error(`[AEGIS] Surgical edit failed — ${failed.length} edit(s) could not be applied:\n${reasons}`);
                    }
                    console.log(`[SwarmTransaction] 🔬 Surgical: applied ${applied.length} edit(s) to ${file.path}`);
                    filesToPatch.push({ path: fullPath, content: result });

                } else if (typeof file.content === 'string') {
                    // FULL REWRITE MODE: run AEGIS guard on large existing files
                    if (original !== null) {
                        const lineCount = original.split('\n').length;
                        if (lineCount >= AEGIS_LINE_THRESHOLD) {
                            const before = extractSignatures(original);
                            const after = extractSignatures(file.content);
                            const missing = [...before].filter(sig => !after.has(sig));
                            if (missing.length > 0) {
                                throw new Error(
                                    `[AEGIS] Full-rewrite of ${file.path} (${lineCount} lines) would silently delete ${missing.length} signature(s):\n` +
                                    missing.map(s => `  • ${s}`).join('\n') +
                                    `\n\nUse surgical edits ({ edits: [{ old, new }] }) instead of a full rewrite, ` +
                                    `or explicitly confirm each deleted signature is intentional.`
                                );
                            }
                        }
                    }
                    filesToPatch.push({ path: fullPath, content: file.content });

                } else {
                    throw new Error(`File entry for ${file.path} must have 'content' (string), 'edits' (array), or 'replaceFunction' ({name, source})`);
                }
            }

            // ── 2. Execute Writes ─────────────────────────────────────────────
            for (const file of filesToPatch) {
                await fs.mkdir(path.dirname(file.path), { recursive: true });
                await fs.writeFile(file.path, file.content, 'utf8');
            }

            this.applied = true;
            return { success: true, count: filesToPatch.length };

        } catch (err) {
            // Automatic rollback on any failure
            await this.rollback();
            throw err;
        }
    }

    /**
     * Roll back all changes made in this transaction.
     */
    async rollback() {
        console.log(`[SwarmTransaction] 🔄 Rolling back ${this.backups.length} changes...`);
        for (const backup of this.backups) {
            try {
                if (backup.isNew) {
                    await fs.unlink(backup.path);
                } else {
                    await fs.writeFile(backup.path, backup.content, 'utf8');
                }
            } catch (e) {
                console.error(`[SwarmTransaction] Failed to rollback ${backup.path}: ${e.message}`);
            }
        }
        this.applied = false;
    }

    /**
     * Commit the transaction (clear backup state).
     */
    commit() {
        this.backups = [];
        this.applied = false;
    }
}
