/**
 * core/rsi/RsiFailureMemory.js
 *
 * Persistent Failure Memory for the SOMA-RSI Engine.
 * Inspired by Weco AI's AIDE² (arXiv:2609.26457):
 * Autonomously logs every rejected scaffolding mutation and the empirical reason for failure,
 * injecting negative constraints into subsequent proposal drafts to prevent cyclical regression.
 */

import fs from 'node:fs';
import path from 'node:path';

export class RsiFailureMemory {
    constructor(opts = {}) {
        this.rootPath = opts.rootPath || process.cwd();
        this.logFile = opts.logFile || path.join(this.rootPath, 'data', 'rsi_failure_memory.jsonl');
        this.maxRetentionDays = opts.maxRetentionDays || 30;
        this._initStorage();
    }

    _initStorage() {
        try {
            const dir = path.dirname(this.logFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            if (!fs.existsSync(this.logFile)) fs.writeFileSync(this.logFile, '');
        } catch {}
    }

    /**
     * Record a failed mutation attempt.
     */
    recordFailure({ arm = 'general', targetFile = '', proposal = '', reason = '', metrics = null } = {}) {
        this._initStorage();
        const entry = {
            id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            timestamp: new Date().toISOString(),
            arm,
            targetFile,
            proposal: String(proposal || '').slice(0, 500),
            reason: String(reason || 'Empirical benchmark regression'),
            metrics,
        };

        try {
            fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n');
        } catch {}

        return entry;
    }

    /**
     * Retrieve recent failure memories, optionally filtered by arm or file.
     */
    getFailures({ arm = null, targetFile = null, limit = 10 } = {}) {
        if (!fs.existsSync(this.logFile)) return [];
        try {
            const lines = fs.readFileSync(this.logFile, 'utf8')
                .split('\n')
                .filter(l => l.trim().length > 0);

            const now = Date.now();
            const maxAgeMs = this.maxRetentionDays * 86400000;

            const entries = [];
            for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
                try {
                    const parsed = JSON.parse(lines[i]);
                    const age = now - new Date(parsed.timestamp).getTime();
                    if (age > maxAgeMs) continue;
                    if (arm && parsed.arm !== arm) continue;
                    if (targetFile && parsed.targetFile !== targetFile) continue;
                    entries.push(parsed);
                } catch {}
            }
            return entries;
        } catch {
            return [];
        }
    }

    /**
     * Format negative constraints for injection into SOMA's self-improvement prompt.
     */
    formatPromptConstraints(arm = null, limit = 4) {
        const failures = this.getFailures({ arm, limit });
        if (!failures.length) return '';

        const lines = [
            '### [RSI FAILURE MEMORY — CONSTRAINTS FROM PRIOR RUNS]',
            'Do NOT repeat the following failed approaches (empirically proven to regress fitness):'
        ];

        for (const f of failures) {
            lines.push(`- In arm "${f.arm}" for ${f.targetFile || 'scaffolding'}: "${f.reason}". Prior attempt: ${f.proposal.slice(0, 120)}`);
        }

        return lines.join('\n');
    }

    /**
     * Purge all failures (for testing or reset).
     */
    clear() {
        try {
            if (fs.existsSync(this.logFile)) fs.writeFileSync(this.logFile, '');
        } catch {}
    }
}
