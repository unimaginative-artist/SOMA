/**
 * core/TransactionalCodeModifier.js
 * 
 * Transactional code modification with atomic commit and automatic rollback.
 * Enforces: snapshot -> apply edit -> syntax check -> test run -> commit / rollback.
 */

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveWithinRoot } from './PathSafety.js';

const execFileAsync = promisify(execFile);

export class TransactionalCodeModifier {
    constructor({ root = process.cwd(), logger = console } = {}) {
        this.root = path.resolve(root);
        this.logger = logger;
    }

    async modify({
        filepath,
        editFn, // async (currentContent) => newContent
        newContent = null, // or direct new content string
        testFile = null,
        runSyntaxCheck = true
    } = {}) {
        if (!filepath) throw new Error('filepath is required');
        const resolvedPath = resolveWithinRoot(this.root, filepath, 'Transactional modification');
        const relativePath = path.relative(this.root, resolvedPath).replace(/\\/g, '/');

        if (!existsSync(resolvedPath)) {
            throw new Error(`Target file does not exist: ${relativePath}`);
        }

        const checks = [];
        const originalContent = await fs.readFile(resolvedPath, 'utf8');
        const backupPath = `${resolvedPath}.transact_${Date.now()}.bak`;

        // 1. Create durable backup
        await fs.writeFile(backupPath, originalContent, 'utf8');
        checks.push({ check: 'snapshot_created', passed: true });

        let modifiedContent = '';
        try {
            if (typeof editFn === 'function') {
                modifiedContent = await editFn(originalContent);
            } else if (typeof newContent === 'string') {
                modifiedContent = newContent;
            } else {
                throw new Error('Either editFn or newContent must be provided');
            }

            if (modifiedContent === originalContent) {
                // Clean up backup and return no-op
                await fs.unlink(backupPath).catch(() => {});
                return {
                    success: true,
                    modified: false,
                    path: relativePath,
                    checks,
                    summary: 'Content was identical; no modification needed.'
                };
            }

            // 2. Syntax check before writing to primary location
            if (runSyntaxCheck && /\.(js|cjs|mjs)$/i.test(resolvedPath)) {
                let syntaxValid = false;
                let syntaxError = null;

                // Try fast in-memory vm.Script first
                try {
                    new vm.Script(modifiedContent, { filename: path.basename(resolvedPath) });
                    syntaxValid = true;
                } catch (vmErr) {
                    syntaxError = vmErr.message;
                }

                // If vm.Script failed (e.g. top-level import/export in ESM), verify via node -c
                if (!syntaxValid) {
                    const tempCheckPath = `${resolvedPath}.syntax_check.tmp.js`;
                    try {
                        await fs.writeFile(tempCheckPath, modifiedContent, 'utf8');
                        await execFileAsync(process.execPath, ['-c', tempCheckPath], { timeout: 8000 });
                        syntaxValid = true;
                    } catch (checkErr) {
                        const errOutput = (checkErr.stderr || checkErr.message || '').toString().trim();
                        syntaxError = errOutput || syntaxError;
                    } finally {
                        await fs.unlink(tempCheckPath).catch(() => {});
                    }
                }

                if (syntaxValid) {
                    checks.push({ check: 'syntax_valid', passed: true });
                } else {
                    checks.push({ check: 'syntax_valid', passed: false, error: syntaxError });
                    throw new Error(`Syntax validation failed: ${syntaxError}`);
                }
            }

            // 3. Stage changes
            await fs.writeFile(resolvedPath, modifiedContent, 'utf8');
            checks.push({ check: 'file_written', passed: true });

            // 4. Run targeted tests if provided
            if (testFile) {
                const resolvedTest = resolveWithinRoot(this.root, testFile, 'Targeted test file');
                try {
                    const { stdout, stderr } = await execFileAsync('node', ['--test', resolvedTest], {
                        cwd: this.root,
                        timeout: 30000
                    });
                    checks.push({ check: `test:${testFile}`, passed: true, output: stdout.slice(-500) });
                } catch (testErr) {
                    checks.push({ check: `test:${testFile}`, passed: false, error: testErr.message });
                    throw new Error(`Targeted test suite ${testFile} failed: ${testErr.message}`);
                }
            }

            // All checks passed -> Commit and cleanup backup
            await fs.unlink(backupPath).catch(() => {});
            return {
                success: true,
                modified: true,
                path: relativePath,
                checks,
                summary: `Successfully modified ${relativePath} with passing validation.`
            };
        } catch (error) {
            // Automatic Rollback
            try {
                await fs.writeFile(resolvedPath, originalContent, 'utf8');
                await fs.unlink(backupPath).catch(() => {});
                checks.push({ check: 'rollback_restored', passed: true });
            } catch (rollbackErr) {
                this.logger.error?.(`[TransactionalModifier] Critical: Rollback failed for ${relativePath}: ${rollbackErr.message}`);
            }

            return {
                success: false,
                modified: false,
                path: relativePath,
                checks,
                rolledBack: true,
                error: error.message,
                nextStep: 'Inspect syntax error or failing unit test before modifying code.'
            };
        }
    }

    async modifyFile({ filePath, targetContent, replacementContent, instruction, testFile } = {}) {
        return this.modify({
            filepath: filePath,
            testFile,
            editFn: (current) => {
                if (targetContent && !current.includes(targetContent)) {
                    throw new Error(`Target content to replace not found in ${filePath}`);
                }
                if (targetContent) {
                    return current.replace(targetContent, replacementContent);
                }
                return replacementContent !== undefined ? replacementContent : current;
            }
        });
    }
}

export const transactionalModifier = new TransactionalCodeModifier();
export const globalTransactionalModifier = transactionalModifier;
export default TransactionalCodeModifier;
