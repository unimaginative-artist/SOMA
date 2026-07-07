/**
 * core/SwarmPatchTransaction.js
 *
 * Multi-file patch transaction system for SOMA.
 * Allows safe multi-file edits with atomic-like rollback protection.
 *
 * Supports two patch modes per file:
 *   1. full_rewrite  — { path, content }   — overwrites the whole file (AEGIS-guarded for large files)
 *   2. surgical      — { path, edits: [{ old, new }] } — targeted string replacements (always safe)
 *
 * AEGIS Guard: if a full_rewrite would silently delete routes or function signatures
 * that existed before the patch, the write is blocked and an error is thrown.
 * Surgical edits bypass AEGIS (they are inherently non-destructive to unrelated code).
 */

import fs from 'fs/promises';
import path from 'path';
import { resolveWithinRoot } from './PathSafety.js';

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
                if (Array.isArray(file.edits)) {
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
                    throw new Error(`File entry for ${file.path} must have either 'content' (string) or 'edits' (array)`);
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
