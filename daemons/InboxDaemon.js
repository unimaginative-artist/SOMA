/**
 * daemons/InboxDaemon.js
 *
 * SOMA's sensory inbox — watches a directory and routes incoming files
 * to the right arbiter. Drop a CSV and Concieve audits it. Drop a note
 * and it goes to memory + goal queue. Drop a URL and SOMA researches it.
 *
 * Default path: ./soma_inbox (override with SOMA_INBOX_PATH env var)
 * Processed files are moved to soma_inbox/processed/YYYY-MM-DD/
 */

import { BaseDaemon } from './BaseDaemon.js';
import fs from 'fs/promises';
import path from 'path';
import { ExcelAnalyzer } from '../server/finance/ExcelAnalyzer.js';
import { ReportGenerator } from '../server/finance/ReportGenerator.js';

const AUDIT_EXT  = new Set(['.csv', '.xlsx', '.xls', '.pdf']);
const NOTE_EXT   = new Set(['.txt', '.md']);
const CODE_EXT   = new Set(['.js', '.ts', '.py', '.mjs', '.cjs']);
const ALL_EXT    = new Set([...AUDIT_EXT, ...NOTE_EXT, ...CODE_EXT, '.url']);

export class InboxDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({ name: 'InboxDaemon', intervalMs: 30_000, ...config });
        this.system     = config.system;
        this.inboxPath  = process.env.SOMA_INBOX_PATH || path.resolve('soma_inbox');
        this.doneDir    = path.join(this.inboxPath, 'processed');
        this._inFlight  = new Set();
    }

    async tick() {
        await fs.mkdir(this.inboxPath, { recursive: true }).catch(() => {});
        await fs.mkdir(this.doneDir,   { recursive: true }).catch(() => {});

        let entries;
        try { entries = await fs.readdir(this.inboxPath); }
        catch { return; }

        const files = entries.filter(f => {
            const ext = path.extname(f).toLowerCase();
            return ALL_EXT.has(ext) && !this._inFlight.has(f);
        });

        for (const filename of files) {
            this._inFlight.add(filename);
            const filePath = path.join(this.inboxPath, filename);
            try {
                const summary = await this._route(filePath, filename);
                await this._archive(filePath, filename);
                this._activity('inbox_processed', filename, summary);
                this.system?.workingMemory?.addAction(`Inbox: ${filename}`, String(summary).substring(0, 150));
                this.emitSignal('soma.activity', {
                    type:      'inbox',
                    title:     `Inbox: ${filename}`,
                    summary:   String(summary).substring(0, 250),
                    timestamp: Date.now(),
                    source:    'InboxDaemon'
                });
            } catch (e) {
                this.logger.error(`[InboxDaemon] ${filename} failed:`, e.message);
                this._activity('inbox_error', filename, e.message);
            } finally {
                this._inFlight.delete(filename);
            }
        }
    }

    async _route(filePath, filename) {
        const ext = path.extname(filename).toLowerCase();
        if (AUDIT_EXT.has(ext))    return this._audit(filePath, filename);
        if (NOTE_EXT.has(ext))     return this._note(filePath, filename);
        if (CODE_EXT.has(ext))     return this._code(filePath, filename);
        if (ext === '.url')        return this._url(filePath, filename);
        return 'unknown file type';
    }

    // ── Financial / audit files ─────────────────────────────────────────────
    async _audit(filePath, filename) {
        const ext = path.extname(filename).toLowerCase();
        const isExcel = ext === '.xlsx' || ext === '.xls';

        // Excel: run structural analysis first, store findings to memory
        if (isExcel) {
            try {
                this.system?.ghostMessage?.(`${filename} dropped in my inbox — let me take a look…`, 'searching');
                const analyzer = new ExcelAnalyzer();
                const result = analyzer.analyze(filePath);
                if (result.ok && result.totalFindings > 0) {
                    this.system?.ghostMessage?.(`Found ${result.criticalCount} critical and ${result.highCount} high-severity issues in ${filename}`, 'found');
                    const generator = new ReportGenerator();
                    const summary = generator.toMarkdown(result, { filename });
                    await this._remember(
                        `[Excel Analysis: ${filename}]\n${summary.substring(0, 1200)}`,
                        { type: 'excel_analysis', importance: 0.9, filename }
                    );
                    this.system?.workingMemory?.addDiscovery(
                        `Excel audit: ${filename}`,
                        `Found ${result.criticalCount} critical, ${result.highCount} high-severity issues`,
                        'inbox'
                    );
                    // Store full result on system for chat access
                    if (!this.system.lastExcelAnalysis) this.system.lastExcelAnalysis = {};
                    this.system.lastExcelAnalysis[filename] = { result, filePath, timestamp: Date.now() };
                    return `Excel analyzed: ${result.criticalCount} critical + ${result.highCount} high findings — stored to memory`;
                } else if (result.ok) {
                    return `Excel scanned: no structural issues found in ${filename}`;
                }
            } catch (e) {
                this.logger.warn('[InboxDaemon] Excel analysis error:', e.message);
            }
        }

        // Fallback: ConcieveArbiter for CSV/PDF or if Excel analysis fails
        const arbiter = this.system?.concieveArbiter;
        if (arbiter?._engineReady) {
            arbiter.runMission(filePath).catch(e =>
                this.logger.warn('[InboxDaemon] Audit mission error:', e.message)
            );
            return `Audit mission started → ${filename}`;
        }
        await this._rememberFile(filename, `Financial file received: ${filename} — analysis unavailable`);
        return `${filename} noted to memory`;
    }

    // ── Notes / markdown ────────────────────────────────────────────────────
    async _note(filePath, filename) {
        const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
        if (!content.trim()) return 'empty file';

        await this._remember(
            `[Inbox Note: ${filename}]\n${content.substring(0, 800)}`,
            { type: 'inbox_note', importance: 0.7 }
        );

        // Detect task lists — lines starting with - or * with enough text
        const taskLines = content.split('\n')
            .map(l => l.trim())
            .filter(l => /^[-*]\s+.{5,}/.test(l))
            .map(l => l.replace(/^[-*]\s+/, '').trim());

        if (taskLines.length > 0) {
            const planner = this.system?.goalPlanner;
            for (const task of taskLines.slice(0, 5)) {
                await planner?.createGoal?.({
                    type:        'operational',
                    category:    'task',
                    title:       task.substring(0, 80),
                    description: `Task from inbox note "${filename}":\n${task}`,
                    priority:    70,
                    confidence:  0.9,
                    metadata:    { source: 'inbox', filename }
                }, 'inbox').catch(() => {});
            }
            return `Note stored; ${taskLines.length} task(s) → goal queue`;
        }

        return `Note stored to memory: "${content.substring(0, 80).replace(/\n/g, ' ')}"`;
    }

    // ── Code files ──────────────────────────────────────────────────────────
    async _code(filePath, filename) {
        const content = await fs.readFile(filePath, 'utf-8').catch(() => '');

        await this._remember(
            `[Inbox Code: ${filename}]\n${content.substring(0, 600)}`,
            { type: 'inbox_code', importance: 0.65 }
        );

        await this.system?.goalPlanner?.createGoal?.({
            type:        'operational',
            category:    'research',
            title:       `Review inbox code: ${filename}`,
            description: `Owner dropped ${filename} into SOMA's inbox. Review it:\n1. What does it do?\n2. Code quality assessment\n3. Potential improvements\n4. Integration opportunities with SOMA\n\nCode preview:\n${content.substring(0, 500)}`,
            priority:    65,
            confidence:  0.9,
            metadata:    { source: 'inbox', filename }
        }, 'inbox').catch(() => {});

        return `Code noted; review goal created for ${filename}`;
    }

    // ── URL files ───────────────────────────────────────────────────────────
    async _url(filePath, filename) {
        const raw = await fs.readFile(filePath, 'utf-8').catch(() => '');
        const url = raw.trim().split('\n')[0].trim();
        if (!url.startsWith('http')) return `invalid URL in ${filename}`;

        await this.system?.goalPlanner?.createGoal?.({
            type:        'operational',
            category:    'research',
            title:       `Research URL: ${url.substring(0, 60)}`,
            description: `Owner dropped a URL into SOMA's inbox:\n${url}\n\nTask: Research this URL thoroughly. Summarize the content, extract key insights, and store findings to memory.`,
            priority:    72,
            confidence:  0.9,
            metadata:    { source: 'inbox', url, filename }
        }, 'inbox').catch(() => {});

        return `Research goal created for ${url.substring(0, 80)}`;
    }

    // ── Helpers ─────────────────────────────────────────────────────────────
    async _archive(filePath, filename) {
        const dateDir = new Date().toISOString().split('T')[0];
        const destDir = path.join(this.doneDir, dateDir);
        await fs.mkdir(destDir, { recursive: true });
        await fs.rename(filePath, path.join(destDir, filename)).catch(() => {});
    }

    async _remember(text, meta = {}) {
        await this.system?.mnemonicArbiter?.remember?.(text, meta).catch(() => {});
    }

    async _rememberFile(filename, text) {
        await this._remember(text, { type: 'inbox_file', importance: 0.6 });
    }

    _activity(type, title, summary) {
        if (!this.system) return;
        if (!this.system.activityFeed) this.system.activityFeed = [];
        this.system.activityFeed.unshift({
            type, title, summary: String(summary).substring(0, 300),
            timestamp: Date.now(), source: 'InboxDaemon'
        });
        if (this.system.activityFeed.length > 100) this.system.activityFeed.length = 100;
    }
}

export default InboxDaemon;
