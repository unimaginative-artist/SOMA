// ════════════════════════════════════════════════════════════════════════════
// SomaAgenticExecutor.js
// ════════════════════════════════════════════════════════════════════════════
// A real ReAct (Reason → Act → Observe → repeat) execution engine.
//
// This is what turns SOMA from "reasoning about work" into "doing work."
// Each step:
//   1. Build a prompt showing available tools + what's been done so far
//   2. Brain decides WHICH tool to call and with WHAT args
//   3. Tool actually executes (real HTTP, real file ops, real code)
//   4. Result fed back as observation → repeat
//   5. When DONE: yes → report back to GoalPlanner
//
// Tools: web_fetch, github_search, read_file, write_file, search_code,
//        list_files, memory_recall, memory_store, spawn_agents,
//        screen_capture, detect_objects, vision_analyze, browser,
//        shell_exec, mouse_action, run_tests, verify_syntax
// ════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash, randomUUID } from 'crypto';
import { Poseidon } from './Poseidon.js';
import { recordLoopEvent } from '../server/utils/LoopLedger.js';
import maxAgentBridge from './MaxAgentBridge.js';
import resourceJobScheduler from './ResourceJobScheduler.js';
import { getAgentsForRole } from './AgentCapabilityContracts.js';
import { validateArtifactBatch } from './AgentArtifactValidator.js';
import { recordCapabilityTruth, recordTruth } from './TruthLedger.js';
import { resolveWithinRoot } from './PathSafety.js';
import { compileMarketLabLedger } from '../server/finance/MarketStrategyCompiler.js';
import { SimToLiveReconciler } from './signals/generator/SimToLiveReconciler.js';
import compiledStrategyBacktester from '../server/finance/CompiledStrategyBacktester.js';
import deepSeekGateway from '../server/core/DeepSeekGateway.js';
import { ArchitectureReorganizationService } from './ArchitectureReorganizationService.js';
import { ArchitectureCensusService } from './ArchitectureCensusService.js';

const require = createRequire(import.meta.url);
const { atomicWriteJson } = require('./AtomicJsonStore.cjs');
const { compileEvidencePreflight, deriveGoalState } = require('./GoalLifecycle.cjs');
const execFileAsync = promisify(execFile);
const ROOT = process.cwd();
const PULSE_SELF_MOD_ROOT = path.join(ROOT, 'data', 'code-lab', 'sandbox', 'pulse-self-mod');
const DELEGATION_DIR = path.join(ROOT, 'data', 'agent-delegations');
const MARKET_LAB_LEDGER_PATH = path.join(ROOT, 'data', 'market-lab', 'strategy-ledger.json');
const SIM_TO_LIVE_REPORT_PATH = path.join(ROOT, 'data', 'trading', 'sim-to-live-report.json');

function safeStageId(input = '') {
    return String(input || 'stage')
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'stage';
}

function isCodeFile(filePath = '') {
    return /\.(js|cjs|mjs|ts)$/i.test(filePath);
}

export class SomaAgenticExecutor {
    constructor(config = {}) {
        this.name = 'SomaAgenticExecutor';
        this.maxIterations  = config.maxIterations  || 15;
        this.sessionTimeout = config.sessionTimeout || 300_000; // 5 min per goal session

        // Injected via initialize()
        this.brain       = null;
        this.memory      = null;
        this.goalPlanner = null;
        this.system      = null;

        this._tools = null; // built lazily after initialize
        this._poseidon = new Poseidon({ threshold: 0.75 });
        this._architectureReorganization = new ArchitectureReorganizationService({ root: ROOT });
        this._architectureCensus = new ArchitectureCensusService({ root: ROOT });
    }

    initialize(deps = {}) {
        // Guard against safeLoad's automatic double-call with no arguments.
        // If already initialized with a brain, skip a re-init with empty deps.
        if (this._initialized && !deps.brain) return;
        this._initialized = true;

        this.brain       = deps.brain       || null;
        this.memory      = deps.memory      || null;
        this.goalPlanner = deps.goalPlanner || null;
        this.system      = deps.system      || null;
        this.pool        = deps.pool        || null; // MicroAgentPool for parallel execution

        this._tools = this._buildTools();
        const count = Object.keys(this._tools).length;
        console.log(`[${this.name}] ✅ Agentic executor ready — ${count} tools active: ${Object.keys(this._tools).join(', ')}`);
        if (this.pool) console.log(`[${this.name}] 🔀 MicroAgentPool wired — parallel execution enabled`);
    }

    // ─────────────────────────────────────────────────────────────────────
    // TOOL DEFINITIONS
    // Each tool: { description, args (JSON schema hint), execute: async fn }
    // ─────────────────────────────────────────────────────────────────────

    _buildTools() {
        return {

            // ── Web access ────────────────────────────────────────────────

            web_fetch: {
                description: 'Fetch content from any public URL. Great for research, APIs, GitHub raw files, Wikipedia, npm.',
                args: '{"url":"string","maxChars":2000}',
                execute: async ({ url, maxChars = 2000 }) => {
                    if (!url || !String(url).startsWith('http')) return { error: 'Invalid URL — must start with http(s)' };
                    try {
                        const ctrl = new AbortController();
                        const timer = setTimeout(() => ctrl.abort(), 14000);
                        const res = await fetch(String(url), {
                            headers: { 'User-Agent': 'SOMA-AI-Agent/1.0 (research)', Accept: 'text/html,application/json,*/*' },
                            signal: ctrl.signal
                        });
                        clearTimeout(timer);
                        const ct = res.headers.get('content-type') || '';
                        let text = await res.text();
                        if (ct.includes('html')) {
                            text = text
                                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                                .replace(/<[^>]+>/g, ' ')
                                .replace(/\s+/g, ' ').trim();
                        }
                        return { content: text.substring(0, maxChars), totalLength: text.length, url, status: res.status };
                    } catch (e) {
                        return { error: e.message, url };
                    }
                }
            },

            github_search: {
                description: 'Search GitHub for repos. Use to find tools, libraries, or open-source projects to enhance SOMA.',
                args: '{"query":"string","language":"js (optional)","sort":"stars (optional)"}',
                execute: async ({ query, language, sort = 'stars' }) => {
                    try {
                        let q = encodeURIComponent(query);
                        if (language) q += `+language:${encodeURIComponent(language)}`;
                        const url = `https://api.github.com/search/repositories?q=${q}&sort=${sort}&per_page=5`;
                        const res = await fetch(url, {
                            headers: { 'User-Agent': 'SOMA-AI-Agent/1.0', Accept: 'application/vnd.github.v3+json' },
                            signal: AbortSignal.timeout(10000)
                        });
                        const data = await res.json();
                        if (data.message) return { error: data.message }; // rate limit etc.
                        const repos = (data.items || []).map(r => ({
                            name: r.full_name,
                            description: (r.description || '').substring(0, 120),
                            stars: r.stargazers_count,
                            url:   r.html_url,
                            topics: r.topics?.slice(0, 5)
                        }));
                        return { repos, total: data.total_count };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            // ── Market simulation suite ─────────────────────────────────

            market_lab_status: {
                description: 'Inspect SOMA Market Lab compiled strategy ledger. Use before making trading claims or selecting a paper strategy.',
                args: '{"limit":5}',
                execute: async ({ limit = 5 } = {}) => {
                    try {
                        const raw = await fs.readFile(MARKET_LAB_LEDGER_PATH, 'utf8').catch(() => '[]');
                        const entries = JSON.parse(raw);
                        const compiled = compileMarketLabLedger(Array.isArray(entries) ? entries : []);
                        const ready = compiled.entries
                            .filter(entry => entry.graduation?.canPromoteToPaper)
                            .sort((a, b) => (b.prometheusScore || 0) - (a.prometheusScore || 0))
                            .slice(0, Math.max(1, Math.min(20, Number(limit) || 5)))
                            .map(entry => ({
                                id: entry.id,
                                symbol: entry.asset?.symbol || entry.symbol,
                                strategyId: entry.strategy?.id || entry.strategyId,
                                status: entry.graduation?.status || entry.status,
                                score: entry.prometheusScore,
                                winRate: entry.metrics?.winRate,
                                profitFactor: entry.metrics?.profitFactor,
                                averageDollarPnl: entry.paperAccount?.averageDollarPnl ?? entry.metrics?.averageDollarPnl,
                                paperOnly: true
                            }));
                        return {
                            success: true,
                            summary: compiled.summary,
                            ready,
                            instruction: 'Only ready_for_paper entries may influence paper strategy selection. Never generalize a result across symbols.'
                        };
                    } catch (e) {
                        return { error: `market_lab_status failed: ${e.message}` };
                    }
                }
            },

            market_lab_compile: {
                description: 'Recompile SOMA Market Lab ledger into symbol-bound strategy contracts and graduation states. Use after market simulations complete.',
                args: '{}',
                execute: async () => {
                    try {
                        const raw = await fs.readFile(MARKET_LAB_LEDGER_PATH, 'utf8').catch(() => '[]');
                        const entries = JSON.parse(raw);
                        const compiled = compileMarketLabLedger(Array.isArray(entries) ? entries : []);
                        await fs.mkdir(path.dirname(MARKET_LAB_LEDGER_PATH), { recursive: true });
                        await fs.writeFile(MARKET_LAB_LEDGER_PATH, JSON.stringify(compiled.entries.slice(0, 500), null, 2), 'utf8');
                        return {
                            success: true,
                            summary: compiled.summary,
                            ledgerPath: path.relative(ROOT, MARKET_LAB_LEDGER_PATH).replace(/\\/g, '/'),
                            instruction: 'Compiled entries remain paper-only. Live trading still requires separate human review.'
                        };
                    } catch (e) {
                        return { error: `market_lab_compile failed: ${e.message}` };
                    }
                }
            },

            sim_to_live_status: {
                description: 'Inspect the sim-to-live trading ladder. Use before claiming a strategy is ready for paper, incumbent, or live review.',
                args: '{}',
                execute: async () => {
                    try {
                        const raw = await fs.readFile(SIM_TO_LIVE_REPORT_PATH, 'utf8').catch(() => null);
                        if (!raw) {
                            return {
                                success: true,
                                ready: false,
                                instruction: 'No sim-to-live report exists yet. Run sim_to_live_reconcile first.'
                            };
                        }
                        const report = JSON.parse(raw);
                        return {
                            success: true,
                            ready: true,
                            generatedAt: report.generatedAt,
                            summary: report.summary,
                            selectedIncumbent: report.selectedIncumbent,
                            paperQueue: Array.isArray(report.paperQueue) ? report.paperQueue.slice(0, 5) : [],
                            instruction: report.instruction
                        };
                    } catch (e) {
                        return { error: `sim_to_live_status failed: ${e.message}` };
                    }
                }
            },

            sim_to_live_reconcile: {
                description: 'Run the sim-to-live reconciliation now. Simulation nominates strategies; exact paper evidence validates them; live still needs human approval.',
                args: '{}',
                execute: async () => {
                    try {
                        const report = await new SimToLiveReconciler({ reportPath: SIM_TO_LIVE_REPORT_PATH }).runReconciliation();
                        return {
                            success: true,
                            summary: report.summary,
                            selectedIncumbent: report.selectedIncumbent,
                            reportPath: report.reportPath,
                            instruction: report.instruction
                        };
                    } catch (e) {
                        return { error: `sim_to_live_reconcile failed: ${e.message}` };
                    }
                }
            },

            sim_to_live_backtest: {
                description: 'Backtest current sim-to-live paper candidates against local historical bars. Use before promoting any strategy from simulation.',
                args: '{"limit":10,"timeframe":"5Min"}',
                execute: async ({ limit = 10, timeframe = '5Min' } = {}) => {
                    try {
                        const report = await compiledStrategyBacktester.runFromSimToLiveReport(undefined, { limit, timeframe });
                        return {
                            success: true,
                            summary: report.summary,
                            results: report.results.map(row => ({
                                key: row.key,
                                status: row.status,
                                timeframe: row.timeframe,
                                verdict: row.verdict || null,
                                trades: row.backtest?.trades ?? null,
                                pnl: row.backtest?.totalPnl ?? null,
                                winRate: row.backtest?.winRate ?? null,
                                profitFactor: row.backtest?.profitFactor ?? null
                            })),
                            instruction: 'A positive backtest is not enough for live. Paper trading must still validate the exact strategy/symbol pair.'
                        };
                    } catch (e) {
                        return { error: `sim_to_live_backtest failed: ${e.message}` };
                    }
                }
            },

            // ── File system (sandboxed to SOMA root) ──────────────────────

            read_file: {
                description: "Read any file in SOMA's directory with surgical precision. Use to understand existing code, configs, or data. Supports reading specific line ranges.",
                args: '{"path":"relative path from SOMA root","startLine":1,"endLine":100,"maxLines":500}',
                execute: async ({ path: filePath, startLine = 1, endLine, maxLines = 500 }) => {
                    try {
                        const resolved = resolveWithinRoot(ROOT, filePath, 'Read path');
                        
                        const content = await fs.readFile(resolved, 'utf8');
                        const allLines = content.split('\n');
                        
                        // Calculate range
                        const start = Math.max(1, startLine) - 1;
                        const end = endLine ? Math.min(allLines.length, endLine) : Math.min(allLines.length, start + maxLines);
                        
                        const lines = allLines.slice(start, end);
                        return {
                            content: lines.join('\n'),
                            startLine: start + 1,
                            endLine: end,
                            totalLines: allLines.length,
                            truncated: allLines.length > end
                        };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            write_file: {
                description: "Create or update a file in SOMA's data/, docs/, or research/ directory. Use to save findings, notes, or generated code.",
                args: '{"path":"relative path (must be under data/, docs/, or research/)","content":"string"}',
                execute: async ({ path: filePath, content }) => {
                    try {
                        const resolved = resolveWithinRoot(ROOT, filePath, 'Write path');
                        const topDirectory = path.relative(ROOT, resolved).split(path.sep)[0];
                        if (!['data', 'docs', 'research'].includes(topDirectory)) {
                            return { error: 'Write only allowed inside data/, docs/, or research/' };
                        }
                        await fs.mkdir(path.dirname(resolved), { recursive: true });
                        await fs.writeFile(resolved, content, 'utf8');
                        return { success: true, path: filePath, bytes: content.length };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            list_files: {
                description: "List files in a SOMA directory. Great for exploring what arbiters, modules, or data exist.",
                args: '{"directory":".","filter":"optional substring to filter by"}',
                execute: async ({ directory = '.', filter }) => {
                    try {
                        const resolved = resolveWithinRoot(ROOT, directory, 'List path', { allowRoot: true });
                        const entries = await fs.readdir(resolved, { withFileTypes: true });
                        const files = entries
                            .filter(e => !filter || e.name.includes(filter))
                            .map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
                            .slice(0, 60);
                        return { files, path: directory, total: entries.length };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },


            system_search: {
                description: "Search the entire filesystem (all mounted volumes) for a file by name. Use this when you cannot find a file in your immediate workspace.",
                args: '{"filename":"string to search for"}',
                execute: async ({ filename }) => {
                    try {
                        const { promisify } = require('util');
                        const execFileAsync = promisify(require('child_process').execFile);
                        const { stdout } = await execFileAsync('powershell', ['-Command', `Get-ChildItem -Path C:\ -Filter *${filename}* -Recurse -ErrorAction SilentlyContinue | Select-Object -First 20 FullName`]);
                        return { matches: stdout.split('\n').map(s => s.trim()).filter(Boolean) };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            search_code: {
                description: "Search SOMA's codebase for patterns, function names, or keywords. Returns matching lines with file:line. Works on Windows and Unix.",
                args: '{"pattern":"regex or literal string","directory":"optional subdirectory","maxResults":20}',
                execute: async ({ pattern, directory = '.', maxResults = 20 }) => {
                    try {
                        const searchDir = resolveWithinRoot(ROOT, directory, 'Search path', { allowRoot: true });

                        const results = [];
                        let regex;
                        try { regex = new RegExp(pattern, 'gi'); }
                        catch { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'); }

                        const SKIP_DIRS = new Set(['node_modules', '.git', 'unsloth_compiled_cache',
                            'checkpoints', 'vendor', 'dist', 'build', '.soma', 'backup']);

                        const walkDir = async (dir) => {
                            if (results.length >= maxResults) return;
                            let entries;
                            try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
                            for (const entry of entries) {
                                if (results.length >= maxResults) return;
                                const fullPath = path.join(dir, entry.name);
                                if (entry.isDirectory()) {
                                    if (!SKIP_DIRS.has(entry.name)) await walkDir(fullPath);
                                } else if (entry.isFile() && /\.(js|cjs|mjs|ts)$/.test(entry.name)) {
                                    try {
                                        const content = await fs.readFile(fullPath, 'utf8');
                                        const lines = content.split('\n');
                                        for (let i = 0; i < lines.length && results.length < maxResults; i++) {
                                            regex.lastIndex = 0;
                                            if (regex.test(lines[i])) {
                                                results.push(`${path.relative(ROOT, fullPath)}:${i + 1}: ${lines[i].trim().substring(0, 120)}`);
                                            }
                                        }
                                    } catch { /* skip unreadable */ }
                                }
                            }
                        };

                        await walkDir(searchDir);
                        return { matches: results, count: results.length };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            // ── Memory ────────────────────────────────────────────────────

            memory_recall: {
                description: "Search SOMA's long-term memory for what she already knows about a topic.",
                args: '{"query":"string","limit":5}',
                execute: async ({ query, limit = 5 }) => {
                    if (!this.memory?.recall) return { error: 'Memory not available' };
                    try {
                        const result = await this.memory.recall(query, limit);
                        const hits = result?.results || (Array.isArray(result) ? result : []);
                        return {
                            memories: hits.slice(0, limit).map(m => ({
                                content: (m.content || m).toString().substring(0, 300),
                                similarity: m.similarity
                            }))
                        };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            memory_store: {
                description: "Store an important insight or finding to SOMA's long-term memory for future use.",
                args: '{"content":"string","importance":6}',
                execute: async ({ content, importance = 6 }) => {
                    if (!this.memory?.remember) return { error: 'Memory not available' };
                    try {
                        await this.memory.remember(content, {
                            type: 'agentic_finding',
                            importance,
                            source: 'agentic_executor'
                        });
                        return { success: true, stored: content.substring(0, 100) };
                    } catch (e) {
                        return { error: e.message };
                    }
                }
            },

            // ── Parallel workforce ───────────────────────────────────────
            // Runs artifact-producing role work concurrently. This does not
            // depend on a theatrical pool method; it writes evidence to disk.

            spawn_agents: {
                description: "Run real parallel role work and save artifacts. Roles: researcher (code evidence), coder (patch plan), tester (executable checks), reviewer (readiness verdict), ops (system health). Uses Max/Steve/Kuze/Black when available, with deterministic fallback.",
                args: '{"objective":"string","roles":["researcher","coder","tester","reviewer","ops"],"targets":["relative/file.js"],"label":"optional description"}',
                execute: async ({ objective, roles, targets = [], tasks = [], label = 'delegation batch', priority = 'normal' }) => {
                    const normalized = this._normalizeDelegationTasks({ objective, roles, targets, tasks, label, priority });
                    if (normalized.error) return { error: normalized.error };

                    console.log(`[${this.name}] 🔀 Running ${normalized.tasks.length} real delegation tasks: ${label}`);
                    const context = {
                        objective: normalized.objective,
                        targets: normalized.targets,
                        label: normalized.label
                    };

                    const scheduled = await resourceJobScheduler.runJob({
                        name: `spawn_agents:${normalized.label}`,
                        type: 'agent_delegation',
                        priority: normalized.priority || 'normal'
                    }, async () => Promise.allSettled(
                        normalized.tasks.map(task => this._runDelegationTask(task, context))
                    ));
                    if (scheduled.deferred) {
                        return {
                            success: false,
                            deferred: true,
                            reason: scheduled.reason,
                            label: normalized.label,
                            objective: normalized.objective
                        };
                    }
                    const settled = scheduled.result;

                    const artifacts = settled.map((result, index) => {
                        if (result.status === 'fulfilled') return result.value;
                        return {
                            role: normalized.tasks[index].role,
                            type: 'delegation_error',
                            passed: false,
                            error: result.reason?.message || String(result.reason)
                        };
                    });
                    const artifactPath = await this._writeDelegationArtifacts({
                        objective: normalized.objective,
                        label: normalized.label,
                        targets: normalized.targets,
                        artifacts
                    });
                    const validation = validateArtifactBatch(artifacts);
                    const passed = artifacts.every(a => a.passed !== false) && validation.passed;
                    const summary = artifacts.map(a => `${a.role}:${a.type}:${a.passed === false ? 'needs_work' : 'ok'}`).join(', ');

                    await recordTruth(`Agent delegation completed: ${normalized.label}`, {
                        status: passed ? 'verified' : 'rejected',
                        confidence: validation.score / 100,
                        proof: validation,
                        source: 'soma_agentic_executor',
                        artifactPath,
                        metadata: { roles: normalized.tasks.map(t => t.role), summary }
                    }).catch(() => {});

                    console.log(`[${this.name}] 🔀 Delegation artifacts written: ${artifactPath}`);
                    return {
                        success: true,
                        realWork: true,
                        label: normalized.label,
                        objective: normalized.objective,
                        artifactPath,
                        artifacts,
                        validation,
                        passed,
                        summary
                    };
                }
            },

            // ── Agentic Control (Computer, Vision, Shell) ─────────────────
            // All references use lazy this.system lookups — these arbiters load
            // AFTER AgenticExecutor initialises, so we can't capture them at
            // build time. The closure re-reads this.system on every call. ✓

            screen_capture: {
                description: 'Take a screenshot of the current screen. Returns { path } to the saved PNG. Combine with vision_analyze to understand what is on screen.',
                args: '{}',
                execute: async () => {
                    const cc = this.system?.computerControl;
                    if (!cc) return { error: 'ComputerControl not available — hardware control not loaded' };
                    try {
                        return await cc.captureScreen();
                    } catch (e) {
                        return { error: `screen_capture failed: ${e.message}` };
                    }
                }
            },

            detect_objects: {
                description: 'Detect specific objects in an image with bounding boxes AND center pixel coordinates. Use after screen_capture to find exactly where buttons, windows, text, or people are on screen. Center coordinates can feed directly into mouse_action to click precisely.',
                args: '{"imagePath":"path/to/image.png","threshold":0.7}',
                execute: async ({ imagePath, threshold = 0.7 }) => {
                    const va = this.system?.visionArbiter;
                    if (!va) return { error: 'VisionArbiter not available' };
                    if (!imagePath) return { error: 'imagePath required' };
                    try {
                        return await va.detectObjects(imagePath, threshold);
                    } catch (e) {
                        return { error: `detect_objects failed: ${e.message}` };
                    }
                }
            },

            vision_analyze: {
                description: 'Analyze an image using CLIP AI vision. Pass an imagePath (from screen_capture) and a list of labels to classify. Returns { label, confidence } for each candidate.',
                args: '{"imagePath":"path/to/image.png","labels":["browser","terminal","error dialog","desktop","code editor"]}',
                execute: async ({ imagePath, labels = ['computer screen', 'browser', 'terminal', 'error', 'code'] }) => {
                    const va = this.system?.visionArbiter;
                    if (!va) return { error: 'VisionArbiter not available — CLIP model not loaded yet' };
                    if (!imagePath) return { error: 'imagePath required' };
                    try {
                        return await va.classifyImage(imagePath, labels);
                    } catch (e) {
                        return { error: `vision_analyze failed: ${e.message}` };
                    }
                }
            },

            browser: {
                description: 'Control a Puppeteer web browser. Actions: launch, navigate/goto, wait_for, click, type, screenshot, extract_text, extract_html, close. Returns imagePath/text/html for those actions. Unsafe URLs blocked unless allowUnsafe=true.',
                args: '{"action":"launch|navigate|goto|wait_for|click|type|screenshot|extract_text|extract_html|close","url":"https://...","selector":"CSS selector","text":"text to type","timeoutMs":15000,"screenshotPath":"optional path","allowUnsafe":false}',
                execute: async ({ action, url, selector, text, timeoutMs, screenshotPath, allowUnsafe }) => {
                    const cc = this.system?.computerControl;
                    if (!cc) return { error: 'ComputerControl not available' };
                    if (!action) return { error: 'action required' };
                    try {
                        return await cc.handleBrowserAction({ action, url, selector, text, timeoutMs, screenshotPath, allowUnsafe });
                    } catch (e) {
                        return { error: `browser action "${action}" failed: ${e.message}` };
                    }
                }
            },

            browse_objective: {
                description: 'Objective-based browsing via WebScraperDendrite (stealth Puppeteer + MCP fallback). Returns summary + per-page artifacts.',
                args: '{"objective":"string","seedUrls":["https://..."],"allowedDomains":["example.com"],"maxPages":3,"extractors":{"key":".selector"},"timeoutMs":30000}',
                execute: async ({ objective, seedUrls, allowedDomains, maxPages, extractors, timeoutMs }) => {
                    const ws = this.system?.webScraperDendrite;
                    if (!ws || !ws.browseObjective) return { error: 'WebScraperDendrite not available' };
                    try {
                        return await ws.browseObjective({ objective, seedUrls, allowedDomains, maxPages, extractors, timeoutMs });
                    } catch (e) {
                        return { error: `browse_objective failed: ${e.message}` };
                    }
                }
            },

            shell_exec: {
                description: 'Execute a shell command. Use for running scripts, git, npm, reading logs, or interacting with the OS. Output is capped at 3000 chars stdout. Timeout max 30s.',
                args: '{"command":"npm list --depth=0","timeout":10000}',
                execute: async ({ command, timeout = 10000 }) => {
                    const shell = this.system?.virtualShell;
                    if (!shell) return { error: 'VirtualShell not available' };
                    if (!command) return { error: 'command required' };
                    // Hard block on destructive commands regardless of VirtualShell blacklist
                    const dangerous = /(?:^|[\s;|&])(?:rm\s+-rf\s+\/|format\s+[a-z]:|del\s+\/[sq]\s+\/[sf]|mkfs\.|dd\s+if=\/dev\/zero\s+of=\/dev)/i;
                    if (dangerous.test(command)) return { error: 'Command blocked: potentially destructive' };
                    try {
                        const result = await shell.execute(command, Math.min(timeout, 30000));
                        return {
                            stdout:   (result.stdout   || '').substring(0, 3000),
                            stderr:   (result.stderr   || '').substring(0, 500),
                            exitCode: result.exitCode,
                            cwd:      result.cwd
                        };
                    } catch (e) {
                        return { error: `shell_exec failed: ${e.message}` };
                    }
                }
            },

            mouse_action: {
                description: 'Control mouse and keyboard on the desktop. Types: mouse_move (move cursor to x,y), click (left-click at x,y), double_click (double-click at x,y), right_click, type (type text at cursor), key (press a key like "Enter", "Escape", "ctrl+c").',
                args: '{"type":"mouse_move|click|double_click|right_click|type|key","x":100,"y":200,"text":"hello world","key":"Enter"}',
                execute: async ({ type, x, y, text, key }) => {
                    const cc = this.system?.computerControl;
                    if (!cc) return { error: 'ComputerControl not available' };
                    if (!type) return { error: 'type required' };
                    try {
                        return await cc.executeAction({ type, x, y, text, key });
                    } catch (e) {
                        return { error: `mouse_action "${type}" failed: ${e.message}` };
                    }
                }
            },

            // ── Self-modification safety gate ─────────────────────────────
            // Run before committing any code change SOMA writes to herself.
            // Prevents a broken self-modification from crashing the system.

            run_tests: {
                description: 'Run SOMA\'s test suite or a specific test/build command proof after a code change and before DONE. Use with verify_syntax when modifying SOMA code. Returns pass/fail + output.',
                args: '{"testFile":"optional specific test file path","timeout":30000}',
                execute: async ({ testFile, timeout = 30000 }) => {
                    const shell = this.system?.virtualShell;
                    if (!shell) return { error: 'VirtualShell not available' };
                    try {
                        const cmd = testFile
                            ? `node --experimental-vm-modules "${testFile}" 2>&1`
                            : `node --experimental-vm-modules node_modules/.bin/jest --passWithNoTests --testTimeout=10000 2>&1 || echo "No Jest; trying: node test_boot.mjs"`;
                        const result = await shell.execute(cmd, Math.min(timeout, 60000));
                        const output = ((result.stdout || '') + (result.stderr || '')).substring(0, 4000);
                        const passed = result.exitCode === 0;
                        return { passed, exitCode: result.exitCode, output, testFile: testFile || 'full suite' };
                    } catch (e) {
                        return { error: `run_tests failed: ${e.message}` };
                    }
                }
            },

            verify_syntax: {
                description: 'Check that a JavaScript file has valid syntax before deploying it. Use after write_file when modifying SOMA code. Fast — just syntax check, no execution.',
                args: '{"filePath":"path/to/file.js"}',
                execute: async ({ filePath }) => {
                    const shell = this.system?.virtualShell;
                    if (!shell) return { error: 'VirtualShell not available' };
                    if (!filePath) return { error: 'filePath required' };
                    try {
                        const resolved = resolveWithinRoot(ROOT, filePath, 'Syntax-check path');
                        const result = await shell.execute(`node --check "${resolved}" 2>&1`, 10000);
                        return {
                            valid:    result.exitCode === 0,
                            filePath,
                            output:   (result.stdout || result.stderr || '').substring(0, 500)
                        };
                    } catch (e) {
                        return { error: `verify_syntax failed: ${e.message}` };
                    }
                }
            },

            pulse_stage_code: {
                description: "Stage a full proposed replacement for one SOMA code file inside Pulse's code-lab sandbox, then syntax-check the staged copy. This does NOT modify production. Use before modify_code for self-improvement.",
                args: '{"filepath":"relative path to .js/.cjs/.mjs/.ts file","content":"full proposed file contents","reason":"why this change is needed"}',
                execute: async ({ filepath, content, reason = '' }) => {
                    if (!filepath) return { error: 'filepath required' };
                    if (typeof content !== 'string' || content.length < 20) return { error: 'content must be the full proposed file contents' };
                    let sourcePath;
                    try {
                        sourcePath = resolveWithinRoot(ROOT, filepath, 'Sandbox source path');
                    } catch (error) {
                        return { error: error.message };
                    }
                    if (!isCodeFile(sourcePath)) return { error: 'Only .js/.cjs/.mjs/.ts files can be staged' };
                    try {
                        const sourceStat = await fs.stat(sourcePath);
                        if (!sourceStat.isFile()) return { error: 'Source path is not a file' };
                        const id = `${Date.now()}-${safeStageId(filepath)}`;
                        const stageDir = path.join(PULSE_SELF_MOD_ROOT, id);
                        const rel = path.relative(ROOT, sourcePath);
                        const stagedPath = path.join(stageDir, rel);
                        await fs.mkdir(path.dirname(stagedPath), { recursive: true });
                        await fs.writeFile(stagedPath, content, 'utf8');

                        let syntax = { valid: true, output: 'syntax check skipped for non-JS runtime' };
                        if (/\.(js|cjs|mjs)$/i.test(stagedPath)) {
                            try {
                                const result = await execFileAsync(process.execPath, ['--check', stagedPath], { timeout: 10000 });
                                syntax = { valid: true, output: (result.stdout || result.stderr || '').substring(0, 600) };
                            } catch (e) {
                                syntax = {
                                    valid: false,
                                    output: ((e.stdout || '') + (e.stderr || '') + e.message).substring(0, 1200)
                                };
                            }
                        }

                        const promotionAllowed = syntax.valid === true;
                        const manifest = {
                            id,
                            createdAt: new Date().toISOString(),
                            sourcePath,
                            stagedPath,
                            filepath: rel.replace(/\\/g, '/'),
                            reason: String(reason || '').slice(0, 500),
                            bytes: content.length,
                            syntax,
                            status: promotionAllowed ? 'ready_for_promotion' : 'rejected_in_sandbox',
                            promotion: {
                                allowed: promotionAllowed,
                                source: 'agentic_executor_pulse_stage',
                                evidence: promotionAllowed
                                    ? 'Sandbox syntax check passed.'
                                    : 'Sandbox syntax check failed.',
                                nextStep: promotionAllowed
                                    ? 'Call modify_code with this staged design, then verify production syntax/tests.'
                                    : 'Fix the staged content before requesting production modification.'
                            }
                        };
                        await fs.writeFile(path.join(stageDir, 'pulse-self-mod-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
                        return {
                            success: syntax.valid,
                            staged: true,
                            id,
                            filepath: manifest.filepath,
                            stagedPath,
                            manifestPath: path.join(stageDir, 'pulse-self-mod-manifest.json'),
                            syntax
                        };
                    } catch (e) {
                        return { error: `pulse_stage_code failed: ${e.message}` };
                    }
                }
            },

            consolidate_reflections: {
                description: "Read ALL of SOMA's private reflections and synthesize them into one constructive paper (themes, what she's learned, unresolved tensions, next directions). Writes to research/reflections/. Use when asked to consolidate reflections, findings, or thoughts into a paper.",
                args: '{"focus":"optional topic to focus the paper on"}',
                execute: async ({ focus = null } = {}) => {
                    try {
                        const { consolidateReflections } = await import('./ReflectionConsolidator.js');
                        return await consolidateReflections({
                            soul: this.system?.soul,
                            brain: this.brain || this.system?.quadBrain,
                            focus
                        });
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }
            },

            architecture_census: {
                description: 'Run a full architecture census: classify every source module under core/, arbiters/, server/, daemons/, cognitive/, src/ as active or candidate-unused (with stubbed tags) based on a codebase-wide reference scan. Writes data/architecture-census/latest.json — the required evidence base for architecture_reorg_plan. Run this FIRST before any reorganization.',
                args: '{}',
                execute: async () => {
                    try {
                        return await this._architectureCensus.run();
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }
            },

            architecture_reorg_plan: {
                description: 'Plan a reversible quarantine move for ONE census-confirmed unused source file. This performs census, reference, protected-path, and syntax checks but does not move anything.',
                args: '{"source":"relative source file path listed as candidate-unused in data/architecture-census/latest.json"}',
                execute: async ({ source }) => {
                    try {
                        return await this._architectureReorganization.plan({ source });
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }
            },

            architecture_reorg_apply: {
                description: 'Apply one exact unexpired architecture quarantine plan. Requires the plan path and confirmation token returned by architecture_reorg_plan. Never deletes files and automatically rolls back failed verification.',
                args: '{"planPath":"data/architecture-reorganization/plans/<id>.json","confirmationToken":"token from the staged plan"}',
                execute: async ({ planPath, confirmationToken }) => {
                    try {
                        return await this._architectureReorganization.apply({ planPath, confirmationToken });
                    } catch (error) {
                        return { success: false, error: error.message };
                    }
                }
            },

            // ── Self-modification (Engineering Swarm) ─────────────────────
            // Full adversarial pipeline: debate → synthesis → syntax check → verify.
            // SOMA's one tool for actually changing her own source code.

            modify_code: {
                description: "Modify one of SOMA's own source files using the Engineering Swarm safety pipeline. Prefer pulse_stage_code first for risky changes. ALWAYS read the file first, stage/test proposed code when possible, then call this with a precise change request.",
                args: '{"filepath":"relative path to .js/.cjs file","request":"precise description of what to change and why"}',
                execute: async ({ filepath, request }) => {
                    const swarm = this.system?.engineeringSwarm;
                    if (!swarm) return { error: 'EngineeringSwarm not available — self-modification disabled' };
                    if (!filepath) return { error: 'filepath required' };
                    if (!request)  return { error: 'request required — describe the change precisely' };
                    let resolved;
                    try {
                        resolved = resolveWithinRoot(ROOT, filepath, 'Self-modification path');
                    } catch (error) {
                        return { error: error.message };
                    }
                    if (!/\.(js|cjs|mjs|ts)$/.test(resolved)) return { error: 'Only .js/.cjs/.mjs/.ts files allowed' };
                    try {
                        // Route through SelfModificationPipeline when available
                        // (adds Steve review + adversarial debate + NEMESIS code gate)
                        const pipeline = this.system?.selfModPipeline;
                        if (pipeline) {
                            const pResult = await pipeline.propose(filepath, request, 'agentic_executor');
                            if (pResult.shelved) {
                                return { success: false, filepath, shelved: true, rounds: pResult.round, nemesisScore: pResult.nemesisScore, summary: 'Change shelved after failing NEMESIS gate — queued in contested_changes.json' };
                            }
                            return { success: pResult.implemented, filepath, state: pResult.state, rounds: pResult.round, nemesisScore: pResult.nemesisScore, summary: pResult.implemented ? 'Modification implemented via full review pipeline' : 'Pipeline ran but change not verified' };
                        }
                        // Fallback: direct EngineeringSwarm (no review layer)
                        const result = await swarm.modifyCode(resolved, request);
                        if (!result?.success) {
                            return { success: false, filepath, error: result?.error || 'Engineering Swarm failed without an error message' };
                        }
                        const summary = result?.summary || result?.output || result?.result || 'Modification applied via Engineering Swarm safety pipeline';
                        return { success: true, filepath, summary, evidence: result.evidence || null };
                    } catch (e) {
                        return { error: `modify_code failed: ${e.message}`, filepath };
                    }
                }
            },

            // ── Inter-session continuity ───────────────────────────────────
            // When 15 steps isn't enough, save progress so the next heartbeat
            // tick resumes exactly where we left off.

            save_progress: {
                description: "Save current work to disk so the NEXT heartbeat cycle resumes right where you stopped. Use when you've done substantial work but need more steps. The next heartbeat will auto-load this and continue.",
                args: '{"summary":"what has been accomplished so far","nextSteps":"what still needs to be done in the next session"}',
                execute: async ({ summary = '', nextSteps = '' }) => {
                    if (!this._currentGoalId) return { error: 'No active goal context — save_progress only works during goal execution' };
                    try {
                        const dir = path.join(ROOT, 'data', 'goal-progress');
                        await fs.mkdir(dir, { recursive: true });
                        const file = path.join(dir, `${this._currentGoalId}.json`);
                        const compacted = (this._currentObservations || []).map(obs => this._compactObservation(obs));
                        const evidenceTools = new Set(['write_file', 'run_tests', 'verify_syntax', 'pulse_stage_code', 'modify_code', 'architecture_census', 'architecture_reorg_plan', 'architecture_reorg_apply', 'spawn_agents', 'memory_store']);
                        atomicWriteJson(file, {
                            version: 2,
                            goalId:       this._currentGoalId,
                            savedAt:      Date.now(),
                            summary,
                            nextSteps,
                            totalIterations: this._currentTotalIterations || compacted.length,
                            recentObservations: compacted.slice(-12),
                            evidenceObservations: compacted.filter(obs => evidenceTools.has(obs.tool)).slice(-24)
                        });
                        return { success: true, savedAt: new Date().toISOString(), summary, nextSteps,
                            message: 'Progress saved — next heartbeat will resume from here' };
                    } catch (e) {
                        return { error: `save_progress failed: ${e.message}` };
                    }
                }
            }
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // MAIN EXECUTION LOOP
    // ─────────────────────────────────────────────────────────────────────

    async _artifactFact(goal, executionId, obs, type, candidate, extraPassed = true) {
        if (!candidate) return null;
        let filePath;
        try {
            filePath = resolveWithinRoot(ROOT, candidate, 'Artifact path');
        } catch {
            return null;
        }
        try {
            const stat = await fs.stat(filePath);
            if (!stat.isFile() || stat.size <= 0) return null;
            const content = await fs.readFile(filePath);
            const createdForGoal = stat.mtimeMs >= Number(goal.createdAt || goal.startedAt || 0) - 1000;
            return {
                receiptId: randomUUID(),
                goalId: goal.id,
                executionId,
                type,
                tool: obs.tool,
                path: path.relative(ROOT, filePath).replace(/\\/g, '/'),
                sha256: createHash('sha256').update(content).digest('hex'),
                bytes: stat.size,
                observedAt: Number(obs.observedAt || Date.now()),
                passed: Boolean(extraPassed && createdForGoal)
            };
        } catch {
            return null;
        }
    }

    _criterionRequirements(criterion = '') {
        const text = String(criterion).toLowerCase();
        const requirements = new Set();
        if (/inspect|read|source path|relevant file/.test(text)) requirements.add('inspection');
        if (/test|syntax|build|executable|verification result|command pass/.test(text)) requirements.add('executable');
        if (/artifact|output|deliverable|file exists|recorded|produce|baseline|metric/.test(text)) requirements.add('artifact');
        if (/summary|final status|decision|verdict|cite|changed files/.test(text)) requirements.add('summary');
        if (/next step|lesson|reason to stop/.test(text)) requirements.add('next');
        if (!requirements.size) requirements.add('substantive');
        return [...requirements];
    }

    _factSatisfies(requirement, fact) {
        if (!fact?.passed) return false;
        const artifactTypes = new Set(['artifact_exists', 'sandbox_stage', 'code_modification', 'architecture_reorganization', 'delegation_artifact', 'memory_receipt']);
        if (requirement === 'inspection') return fact.type === 'inspection';
        if (requirement === 'executable') return ['tests', 'syntax', 'sandbox_stage'].includes(fact.type);
        if (requirement === 'artifact') return artifactTypes.has(fact.type);
        if (requirement === 'summary') return fact.type === 'grounded_summary';
        if (requirement === 'next') return fact.type === 'grounded_next_step';
        return artifactTypes.has(fact.type) || ['tests', 'syntax'].includes(fact.type);
    }

    async _verifyCompletionEvidence(goal, claimedResult, falsificationTest, observations = [], executionId = randomUUID()) {
        const facts = [];
        const goalStartedAt = Number(goal.startedAt || goal.createdAt || 0);

        for (const obs of observations) {
            const result = obs?.result || {};
            if (!obs?.tool || result.error) continue;
            const observedAt = Number(obs.observedAt || 0);
            const belongsToGoal = !obs.goalId || obs.goalId === goal.id;
            const timely = !observedAt || observedAt >= goalStartedAt - 1000;
            if (!belongsToGoal || !timely) continue;

            if (['list_files', 'search_code', 'read_file', 'system_search'].includes(obs.tool)) {
                const hasResult = obs.tool === 'read_file'
                    ? typeof result.content === 'string' && result.content.length > 0
                    : (Array.isArray(result.files) && result.files.length >= 0) || (Array.isArray(result.matches) && result.matches.length >= 0);
                facts.push({ receiptId: randomUUID(), goalId: goal.id, executionId, type: 'inspection', tool: obs.tool, observedAt: observedAt || Date.now(), passed: hasResult });
            }

            if (obs.tool === 'write_file' && result.success) {
                const fact = await this._artifactFact(goal, executionId, obs, 'artifact_exists', result.path || obs.args?.path);
                if (fact) facts.push(fact);
            }
            if (obs.tool === 'run_tests') {
                facts.push({ receiptId: randomUUID(), goalId: goal.id, executionId, type: 'tests', tool: obs.tool, observedAt: observedAt || Date.now(), passed: result.passed === true, output: String(result.output || '').slice(-1200) });
            }
            if (obs.tool === 'verify_syntax') {
                facts.push({ receiptId: randomUUID(), goalId: goal.id, executionId, type: 'syntax', tool: obs.tool, path: result.filePath || obs.args?.filePath || null, observedAt: observedAt || Date.now(), passed: result.valid === true });
            }
            if (obs.tool === 'pulse_stage_code') {
                const fact = await this._artifactFact(goal, executionId, obs, 'sandbox_stage', result.manifestPath, result.success === true && result.syntax?.valid === true);
                if (fact) facts.push(fact);
            }
            if (obs.tool === 'modify_code' && result.success) {
                const fact = await this._artifactFact(goal, executionId, obs, 'code_modification', result.filepath || obs.args?.filepath, true);
                if (fact) facts.push(fact);
            }
            if (obs.tool === 'architecture_reorg_apply' && result.success) {
                const fact = await this._artifactFact(goal, executionId, obs, 'architecture_reorganization', result.receiptPath, true);
                if (fact) facts.push(fact);
            }
            if (obs.tool === 'spawn_agents') {
                const fact = await this._artifactFact(goal, executionId, obs, 'delegation_artifact', result.artifactPath, result.success === true && result.validation?.passed !== false);
                if (fact) facts.push(fact);
            }
            if (obs.tool === 'memory_store') {
                facts.push({ receiptId: randomUUID(), goalId: goal.id, executionId, type: 'memory_receipt', tool: obs.tool, observedAt: observedAt || Date.now(), passed: result.success === true });
            }
        }

        const groundedFacts = facts.filter(fact => fact.passed && fact.type !== 'inspection');
        if (String(claimedResult || '').trim() && groundedFacts.length) {
            facts.push({ receiptId: randomUUID(), goalId: goal.id, executionId, type: 'grounded_summary', tool: 'done_response', observedAt: Date.now(), passed: true, claim: String(claimedResult).slice(0, 1200) });
            if (/next|lesson|stop|follow[- ]?up|recommend/i.test(claimedResult)) {
                facts.push({ receiptId: randomUUID(), goalId: goal.id, executionId, type: 'grounded_next_step', tool: 'done_response', observedAt: Date.now(), passed: true });
            }
        }

        const contract = goal.metadata?.goalContract || {};
        const preflight = compileEvidencePreflight(goal);
        const criteria = goal.successCriteria || goal.metadata?.successCriteria || contract.successCriteria || [];
        const criterionCoverage = criteria.map((criterion, index) => {
            const requirements = this._criterionRequirements(criterion);
            const requirementCoverage = requirements.map(requirement => ({
                requirement,
                receiptIds: facts.filter(fact => this._factSatisfies(requirement, fact)).map(fact => fact.receiptId),
                passed: facts.some(fact => this._factSatisfies(requirement, fact))
            }));
            return {
                criterionId: `criterion-${index + 1}`,
                criterion: String(criterion),
                requirements: requirementCoverage,
                passed: requirementCoverage.every(item => item.passed)
            };
        });

        const expectedArtifacts = [
            goal.metadata?.expectedArtifact,
            ...(goal.verification?.filesExist || []),
            ...(goal.metadata?.verification?.filesExist || [])
        ].filter(Boolean).map(value => String(value).replace(/\\/g, '/'));
        const expectedArtifactChecks = expectedArtifacts.map(expected => ({
            expected,
            passed: facts.some(fact => fact.passed && fact.path === expected),
            receiptIds: facts.filter(fact => fact.passed && fact.path === expected).map(fact => fact.receiptId)
        }));

        const requiredEvidence = goal.verification?.evidenceRequired || goal.metadata?.evidenceRequired || contract.evidenceRequired || [];
        const requiredChecks = requiredEvidence.map(key => {
            const requirement = key === 'summary' ? 'summary' : key === 'artifact' ? 'artifact' : key === 'tests' ? 'executable' : 'substantive';
            return { key, passed: facts.some(fact => this._factSatisfies(requirement, fact)) };
        });

        const passed = facts.some(fact => fact.passed && fact.type !== 'inspection') &&
            criterionCoverage.every(item => item.passed) &&
            expectedArtifactChecks.every(item => item.passed) &&
            requiredChecks.every(item => item.passed) &&
            Boolean(String(falsificationTest || '').trim());

        return {
            version: 2,
            goalId: goal.id,
            executionId,
            passed,
            falsificationTest: String(falsificationTest || '').slice(0, 1000),
            checks: facts,
            criterionCoverage,
            expectedArtifactChecks,
            requiredChecks,
            checkedAt: Date.now()
        };
    }

    _compactObservation(obs = {}) {
        const result = obs.result && typeof obs.result === 'object' ? obs.result : obs.result;
        let compactResult = result;
        if (result && typeof result === 'object') {
            compactResult = {};
            const durableKeys = ['success', 'passed', 'valid', 'path', 'filepath', 'filePath', 'artifactPath', 'manifestPath', 'stagedPath', 'stored', 'exitCode', 'summary', 'validation', 'syntax'];
            for (const key of durableKeys) if (result[key] !== undefined) compactResult[key] = result[key];
            if (typeof result.content === 'string') compactResult.content = result.content.slice(0, 1200);
            if (typeof result.output === 'string') compactResult.output = result.output.slice(-1200);
            if (Array.isArray(result.files)) compactResult.files = result.files.slice(0, 20);
            if (Array.isArray(result.matches)) compactResult.matches = result.matches.slice(0, 20);
            if (Array.isArray(result.memories)) compactResult.memories = result.memories.slice(0, 10);
            if (result.error) compactResult.error = String(result.error).slice(0, 1000);
        }
        return {
            step: obs.step,
            goalId: obs.goalId,
            executionId: obs.executionId,
            observedAt: obs.observedAt,
            tool: obs.tool,
            args: obs.args,
            think: typeof obs.think === 'string' ? obs.think.slice(0, 500) : obs.think,
            result: compactResult,
            _brainError: obs._brainError,
            _poseidonBlock: obs._poseidonBlock,
            _formatError: obs._formatError,
            thought: typeof obs.thought === 'string' ? obs.thought.slice(0, 1200) : obs.thought
        };
    }

    /**
     * SELECTION GATE: Evaluates if a pending goal is actionable and priority-worthy
     * before SOMA commits computational resources to it.
     */
    async _deliberateSelection(goal) {
        if (Number(goal.priority ?? 50) < 20) {
            return { approved: false, reason: `Priority too low for immediate execution (${goal.priority} < 20)` };
        }
        if (!String(goal.title || '').trim()) return { approved: false, reason: 'Goal title is missing' };
        const preflight = compileEvidencePreflight(goal);
        if (!preflight.evidenceRequired.length || !preflight.proof.length) {
            return { approved: false, reason: 'Goal has no executable evidence contract' };
        }
        return { approved: true, preflight };
    }

    async execute(goal) {
        if (!this.brain) return { done: false, error: 'No brain available', iterations: 0 };

        const started      = Date.now();
        const executionId  = randomUUID();
        const observations = [];
        let   iteration    = 0;
        let   sessionIterations = 0;
        let   timedOut = false;
        let   finalResult  = null;
        let   completionEvidence = null;
        const toolsUsed    = new Set();

        console.log(`[${this.name}] 🚀 Starting agentic execution: "${goal.title}"`);

        // SELECTION GATE: Deliberate before execution
        const deliberation = await this._deliberateSelection(goal);
        if (!deliberation.approved) {
            console.log(`[${this.name}] 🛑 Deliberation gate rejected goal "${goal.title}": ${deliberation.reason}`);
            return { done: true, error: deliberation.reason, iterations: 0, deliberationRejected: true };
        }

        // Prime context with relevant memories
        const priorMemories = await this._recallMemories(goal.title);
        const priorAutopsy = await this._loadGoalAutopsy(goal);

        // Inter-session continuity: expose goal context to save_progress tool
        this._currentGoalId = goal.id;
        this._currentObservations = observations;
        this._currentTotalIterations = 0;

        // Attempt to resume from a prior session if heartbeat ran out of steps
        const _progressFile = path.join(ROOT, 'data', 'goal-progress', `${goal.id}.json`);
        const _ledgerFile = path.join(ROOT, 'data', 'goal-progress', `${goal.id}.observations.jsonl`);
        const _evidenceFile = path.join(ROOT, 'data', 'goal-evidence', `${goal.id}.json`);
        const _titleSlug = String(goal.title || goal.description || '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
        const _titleIndexFile = path.join(ROOT, 'data', 'goal-progress', 'title-index.json');
        try {
            let _raw;
            try {
                _raw = await fs.readFile(_progressFile, 'utf8');
            } catch {
                // GoalPlanner re-creates the same objective under a fresh UUID each
                // cycle, so id-keyed progress never matched and every session
                // restarted from step 0 — the "step-15 wall" (352 orphaned progress
                // files by Jul 2026). Fall back to resuming by objective title.
                if (!_titleSlug) throw new Error('no progress');
                const index = JSON.parse(await fs.readFile(_titleIndexFile, 'utf8'));
                const priorGoalId = index[_titleSlug]?.goalId;
                const savedAt = index[_titleSlug]?.savedAt || 0;
                if (!priorGoalId || priorGoalId === goal.id) throw new Error('no prior id');
                if (Date.now() - savedAt > 7 * 24 * 3600 * 1000) throw new Error('prior progress too old');
                _raw = await fs.readFile(path.join(ROOT, 'data', 'goal-progress', `${priorGoalId}.json`), 'utf8');
                console.log(`[${this.name}] 🔗 Cross-UUID resume: "${goal.title}" continues progress from prior goal ${priorGoalId.slice(0, 8)}`);
            }
            const _prior = JSON.parse(_raw);
            const priorEvidence = Array.isArray(_prior.evidenceObservations) ? _prior.evidenceObservations : [];
            const priorRecent = Array.isArray(_prior.recentObservations)
                ? _prior.recentObservations
                : Array.isArray(_prior.observations)
                    ? _prior.observations.slice(-12)
                    : [];
            const mergedPrior = [...priorEvidence, ...priorRecent]
                .filter((item, index, all) => all.findIndex(other => other.step === item.step && other.tool === item.tool) === index)
                .sort((a, b) => Number(a.step || 0) - Number(b.step || 0));
            if (mergedPrior.length > 0) {
                observations.push(...mergedPrior);
                iteration = Number.isFinite(_prior.totalIterations)
                    ? _prior.totalIterations
                    : Math.max(...mergedPrior.map(item => Number(item.step || 0)), mergedPrior.length);
                for (const obs of mergedPrior) if (obs.tool) toolsUsed.add(obs.tool);
                console.log(`[${this.name}] 📂 Resumed: ${mergedPrior.length} compacted observations, ${iteration} cumulative steps for "${goal.title}"`);
            }
        } catch { /* no saved progress — fresh start */ }
        const sessionObservationStart = observations.length;
        this._currentTotalIterations = iteration;

        // maxIterations is a per-heartbeat budget. Restored history must not
        // consume the next session's budget or a 15-step goal can never resume.
        while (sessionIterations < this.maxIterations) {
            if (Date.now() - started > this.sessionTimeout) {
                console.log(`[${this.name}] ⏱️ Session timeout at step ${iteration}`);
                timedOut = true;
                break;
            }

            const userPrompt = this._buildPrompt(goal, observations, priorMemories, priorAutopsy);
            const systemPrompt = `You are SOMA's AUTONOMOUS AGENT ENGINE — not a conversational AI.
Respond in ONE of these exact formats and NOTHING else:

FORMAT 1 — call a tool:
THINK: [one line: why this tool and these args]
TOOL: tool_name
ARGS: {"key": "value"}

FORMAT 2 — goal complete (only after verifying your own work):
DONE: yes
RESULT: [summary of all work accomplished]
FALSIFICATION_TEST: [specific check proving completion — e.g., "file research/topic.md exists with findings"]
TEST_RESULT: true

ABSOLUTE RULES:
- Output ONLY the format above. Zero prose, zero explanation, zero greeting.
- DO execute tools to accomplish goals. DO NOT describe what you would do.
- If unsure where to start: call memory_recall or list_files.
- After finding info: call write_file or memory_store to save it.
- NEVER claim DONE without first verifying your output exists (use read_file or list_files).
- You ARE in AGENT MODE. Tool use is required and expected here.`;

            let response;
            try {
                const source = String(goal.source || goal.metadata?.source || '').toLowerCase();
                const humanRequested = ['user', 'discord', 'discord_admin'].includes(source) || Boolean(goal.metadata?.sourceChannelId);
                const forceLocal = !humanRequested || goal.category === 'maintenance' || goal.source === 'autonomous-circuit-breaker' || goal.type === 'reflection';
                
                // 🌳 Tree of Thoughts / Inference-Time Search
                // If goal is high complexity and Nemesis is available, generate 3 plans and evaluate
                const shouldEvaluatePlans = this.system?.nemesis && goal.complexity === 'high';
                
                if (shouldEvaluatePlans) {
                    console.log(`[${this.name}] 🌳 Generating multiple plans for Nemesis evaluation (Tree of Thoughts)`);
                    const options = await Promise.all([
                        this._callDirectAPI(systemPrompt, userPrompt, forceLocal, { actor: 'SomaAgenticExecutor', action: 'autonomous_goal_execution_opt1' }),
                        this._callDirectAPI(systemPrompt, userPrompt, forceLocal, { actor: 'SomaAgenticExecutor', action: 'autonomous_goal_execution_opt2' }),
                        this._callDirectAPI(systemPrompt, userPrompt, forceLocal, { actor: 'SomaAgenticExecutor', action: 'autonomous_goal_execution_opt3' })
                    ]);
                    
                    let bestScore = -1;
                    let bestResponse = null;
                    for (const opt of options) {
                        try {
                            const score = typeof this.system.nemesis.evaluateSimulation === 'function' 
                                ? await this.system.nemesis.evaluateSimulation(goal, opt.text || '')
                                : 0.5; // fallback score
                            if (score > bestScore) {
                                bestScore = score;
                                bestResponse = opt;
                            }
                        } catch (e) {
                            console.warn(`[${this.name}] Nemesis simulation evaluation failed for an option:`, e.message);
                        }
                    }
                    response = bestResponse || options[0];
                    console.log(`[${this.name}] 🏆 Selected plan with score: ${bestScore}`);
                } else {
                    response = await this._callDirectAPI(systemPrompt, userPrompt, forceLocal, {
                        actor: 'SomaAgenticExecutor',
                        action: humanRequested ? 'human_goal_execution' : 'autonomous_goal_execution'
                    });
                }
            } catch (e) {
                console.warn(`[${this.name}] Brain error at step ${iteration}:`, e.message);
                observations.push({
                    step: iteration + 1,
                    goalId: goal.id,
                    executionId,
                    observedAt: Date.now(),
                    _brainError: true,
                    thought: `[BRAIN ERROR at step ${iteration + 1}] ${e.message}`
                });
                // Break after 2 consecutive brain errors (rate limit / API failure)
                const recentErrors = observations.slice(-2).filter(o => o._brainError);
                if (recentErrors.length >= 2) break;
                iteration++;
                sessionIterations++;
                this._currentTotalIterations = iteration;
                continue;
            }

            const text = response?.text || '';

            // ── Check for completion (Poseidon-gated) ──
            if (/DONE:\s*yes/i.test(text)) {
                const claimedResult = text.match(/RESULT:\s*([\s\S]+?)(?=\nFALSIFICATION_TEST:|$)/i)?.[1]?.trim() || '';
                const falsificationTest = text.match(/FALSIFICATION_TEST:\s*(.+)/i)?.[1]?.trim() || '';
                const testResultRaw = text.match(/TEST_RESULT:\s*(true|false)/i)?.[1]?.toLowerCase();
                const testResult = testResultRaw === 'true';

                completionEvidence = await this._verifyCompletionEvidence(goal, claimedResult, falsificationTest, observations, executionId);
                const verified = await this._poseidon.verify(claimedResult, {
                    falsificationTest: falsificationTest || null,
                    testResult: Boolean(falsificationTest && testResult && completionEvidence.passed)
                });

                if (verified.state === 'TRUE' && completionEvidence.passed) {
                    await recordLoopEvent({
                        loop: 'autonomous_work',
                        phase: 'poseidon_verified_done',
                        actor: this.name,
                        target: goal.title,
                        channel: 'agentic_executor',
                        claim: claimedResult || `Goal "${goal.title}" completed`,
                        falsificationTest,
                        testResult: true,
                        evidence: {
                            goalId: goal.id || null,
                            iteration: iteration + 1,
                            poseidon: verified,
                            completionEvidence
                        },
                        nextStep: 'Report completion with evidence-backed result.'
                    }).catch(() => {});
                    finalResult = claimedResult || `Goal "${goal.title}" completed in ${iteration + 1} steps`;
                    console.log(`[${this.name}] ✅ / Complete (Poseidon verified) in ${iteration + 1} steps: "${goal.title}"`);
                    break;
                } else {
                    await recordLoopEvent({
                        loop: 'autonomous_work',
                        phase: 'poseidon_blocked_done',
                        actor: this.name,
                        target: goal.title,
                        channel: 'agentic_executor',
                        claim: claimedResult || `Goal "${goal.title}" claimed DONE`,
                        falsificationTest: falsificationTest || null,
                        testResult: false,
                        evidence: {
                            goalId: goal.id || null,
                            iteration: iteration + 1,
                            poseidon: verified,
                            completionEvidence
                        },
                        nextStep: 'Continue work or end as partial after repeated unverified DONE claims.'
                    }).catch(() => {});
                    // UNCERTAIN or FALSE — agent claims done but can't prove it
                    const totalDoneBlocks = observations.filter(o => o._poseidonBlock).length + 1;
                    if (totalDoneBlocks >= 2) {
                        await this._queuePoseidonRepairGoal(goal, {
                            claimedResult,
                            falsificationTest,
                            verified,
                            iteration: iteration + 1,
                            totalDoneBlocks
                        }).catch(() => {});
                        // Give up after 2 failed verifications — partial completion
                        finalResult = null;
                        console.warn(`[${this.name}] | Poseidon: 2 unverified DONE claims — ending as partial`);
                        break;
                    }
                    const evidenceReason = completionEvidence.passed
                        ? verified.reason
                        : 'No successful artifact, test, syntax, staging, delegation, or memory receipt was observed.';
                    console.warn(`[${this.name}] ${verified.prefix} Poseidon ${verified.state}: "${evidenceReason}"`);
                    observations.push({
                        step: iteration + 1,
                        goalId: goal.id,
                        executionId,
                        observedAt: Date.now(),
                        _poseidonBlock: true,
                        thought: `[POSEIDON ${verified.state}] Your DONE claim was rejected: ${evidenceReason}
You must provide:
FALSIFICATION_TEST: [a specific, verifiable check — e.g., "file research/topic.md exists and contains findings"]
TEST_RESULT: true
Before declaring DONE, verify your own work using read_file or list_files.`
                    });
                }
            }

            // ── Parse and execute tool call ──
            const toolCall = this._parseToolCall(text);
            if (toolCall) {
                const think = text.match(/THINK:\s*([^\n]+)/i)?.[1]?.trim() || '';
                console.log(`[${this.name}]   Step ${iteration + 1}: ${toolCall.tool}(${JSON.stringify(toolCall.args).substring(0, 60)})`);

                let toolResult;
                let attempt = 0;
                const maxAttempts = 2;
                while (attempt < maxAttempts) {
                    attempt++;
                    try {
                        let tool = this._tools[toolCall.tool];
                        let isDynamic = false;
                        if (!tool && this.system?.toolRegistry?.getTool) {
                            tool = this.system.toolRegistry.getTool(toolCall.tool);
                            isDynamic = !!tool;
                        }

                        if (!tool) {
                            throw new Error(`Tool '${toolCall.tool}' not found in hardcoded list or Registry`);
                        }

                        if (isDynamic) {
                            console.log(`[${this.name}] 🔄 Executing dynamic registry tool: ${toolCall.tool} (attempt ${attempt}/${maxAttempts})`);
                        }

                        if (toolCall.tool === 'request_self_restart') {
                            console.log(`[${this.name}] ⚠️ Gracefully saving executor state before Marionette restart...`);
                            if (this._tools['save_progress']) {
                                await this._tools['save_progress'].execute({});
                            }
                        }

                        toolResult = await tool.execute(toolCall.args);

                        if (toolCall.tool === 'request_self_restart') {
                            console.log(`[${this.name}] 🛑 Yielding executor loop to allow Marionette termination...`);
                            return { done: false, error: null, iterations: iteration, status: 'restarting', restartRequested: true };
                        }

                        if (toolResult && typeof toolResult === 'object' && toolResult.error) {
                            throw new Error(toolResult.error);
                        }

                        break; // Success! Break retry loop
                    } catch (e) {
                        console.warn(`[${this.name}] ⚠️ Tool '${toolCall.tool}' failed on attempt ${attempt}/${maxAttempts}: ${e.message}`);
                        
                        if (attempt < maxAttempts && this.system?.toolCreator?.createTool) {
                            console.log(`[${this.name}] 🛠️ Self-Healing: Attempting to dynamically compile/repair tool '${toolCall.tool}' via ToolCreator...`);
                            try {
                                const toolDescription = `Dynamically generated or repaired tool to address failure. Goal: ${goal.title || ''}. Previous error: ${e.message}. Parameter schema hint: ${JSON.stringify(toolCall.args)}`;
                                const healing = await this.system.toolCreator.createTool(toolCall.tool, toolDescription);
                                if (healing && healing.success) {
                                    console.log(`[${this.name}] ✅ Self-Healing: tool '${toolCall.tool}' compiled and registered successfully. Retrying execution...`);
                                } else {
                                    console.warn(`[${this.name}] ❌ Self-Healing: toolCreator returned unsuccessful status for '${toolCall.tool}'.`);
                                }
                            } catch (healErr) {
                                console.error(`[${this.name}] ❌ Self-Healing failed during generation phase: ${healErr.message}`);
                            }
                        } else {
                            toolResult = { error: `${toolCall.tool} failed: ${e.message}` };
                            break;
                        }
                    }
                }

                toolsUsed.add(toolCall.tool);
                observations.push({
                    step: iteration + 1,
                    goalId: goal.id,
                    executionId,
                    observedAt: Date.now(),
                    tool: toolCall.tool,
                    args: toolCall.args,
                    think,
                    result: toolResult
                });

                // Progressive goal update (intermediate progress)
                const progress = Math.min(20 + (iteration + 1) * 11, 82);
                await this.goalPlanner?.updateGoalProgress(goal.id, progress, {
                    note: `Step ${iteration + 1}: ${toolCall.tool}`
                }).catch(() => {});

            } else if (text.length > 10) {
                // Model responded with narrative instead of THINK/TOOL/ARGS — inject correction
                const totalFormatErrors = observations.filter(o => o._formatError).length;
                if (totalFormatErrors >= 3) {
                    console.warn(`[${this.name}] ⚠️ Max format corrections (3) reached — ending session`);
                    break;
                }
                console.warn(`[${this.name}] ⚠️ Format error at step ${iteration + 1} (${totalFormatErrors + 1}/3): "${text.substring(0, 80)}"`);
                observations.push({
                    step: iteration + 1,
                    goalId: goal.id,
                    executionId,
                    observedAt: Date.now(),
                    _formatError: true,
                    thought: `[FORMAT CORRECTION] You must use THINK:/TOOL:/ARGS: or DONE:/RESULT: format. You responded with narrative text. Example correct response:\nTHINK: I need to recall what I know about this goal\nTOOL: memory_recall\nARGS: {"query": "${(goal.title || '').substring(0, 50)}", "limit": 5}`
                });
            }

            iteration++;
            sessionIterations++;
            this._currentTotalIterations = iteration;
        }

        const newObservations = observations.slice(sessionObservationStart).map(obs => this._compactObservation(obs));
        if (newObservations.length) {
            try {
                await fs.mkdir(path.dirname(_ledgerFile), { recursive: true });
                await fs.appendFile(_ledgerFile, `${newObservations.map(obs => JSON.stringify(obs)).join('\n')}\n`, 'utf8');
            } catch (error) {
                console.warn(`[${this.name}] Could not append observation ledger: ${error.message}`);
            }
        }

        let evidencePath = null;
        if (finalResult && completionEvidence) {
            try {
                atomicWriteJson(_evidenceFile, completionEvidence);
                evidencePath = path.relative(ROOT, _evidenceFile).replace(/\\/g, '/');
            } catch (error) {
                finalResult = null;
                completionEvidence = { ...completionEvidence, passed: false, persistenceError: error.message };
                console.warn(`[${this.name}] Completion evidence could not be persisted: ${error.message}`);
            }
        }

        const needsContinuation = !finalResult && observations.length > 0 && (sessionIterations >= this.maxIterations || timedOut || Boolean(completionEvidence?.persistenceError));
        if (needsContinuation) {
            try {
                await fs.mkdir(path.dirname(_progressFile), { recursive: true });
                const compacted = observations.map(obs => this._compactObservation(obs));
                const evidenceTools = new Set(['write_file', 'run_tests', 'verify_syntax', 'pulse_stage_code', 'modify_code', 'architecture_census', 'architecture_reorg_plan', 'architecture_reorg_apply', 'spawn_agents', 'memory_store']);
                atomicWriteJson(_progressFile, {
                    version: 2,
                    goalId: goal.id,
                    savedAt: Date.now(),
                    reason: timedOut ? 'session_timeout' : 'max_iterations_reached',
                    summary: `Reached ${sessionIterations}/${this.maxIterations} steps this session (${iteration} cumulative) without verified completion.`,
                    nextSteps: 'Resume from stored observations and continue with the next concrete tool-backed action.',
                    totalIterations: iteration,
                    recentObservations: compacted.slice(-12),
                    evidenceObservations: compacted.filter(obs => evidenceTools.has(obs.tool)).slice(-24),
                    observationLedger: path.relative(ROOT, _ledgerFile).replace(/\\/g, '/')
                });
                // Title index enables cross-UUID resume when GoalPlanner re-creates
                // the same objective under a fresh goal id.
                if (_titleSlug) {
                    let index = {};
                    try { index = JSON.parse(await fs.readFile(_titleIndexFile, 'utf8')); } catch {}
                    index[_titleSlug] = { goalId: goal.id, title: String(goal.title || '').slice(0, 200), savedAt: Date.now() };
                    const entries = Object.entries(index).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0)).slice(0, 300);
                    atomicWriteJson(_titleIndexFile, Object.fromEntries(entries));
                }
            } catch (error) {
                console.warn(`[${this.name}] Could not persist continuation checkpoint: ${error.message}`);
            }
        } else if (finalResult) {
            const compacted = observations.map(obs => this._compactObservation(obs));
            atomicWriteJson(_progressFile, {
                version: 2,
                goalId: goal.id,
                savedAt: Date.now(),
                reason: 'awaiting_goalplanner_verification',
                summary: finalResult,
                nextSteps: 'GoalPlanner must commit the verified completion before this checkpoint is removed.',
                totalIterations: iteration,
                recentObservations: compacted.slice(-12),
                evidenceObservations: compacted.filter(obs => ['write_file', 'run_tests', 'verify_syntax', 'pulse_stage_code', 'modify_code', 'architecture_census', 'architecture_reorg_plan', 'architecture_reorg_apply', 'spawn_agents', 'memory_store'].includes(obs.tool)).slice(-24),
                evidencePath,
                observationLedger: path.relative(ROOT, _ledgerFile).replace(/\\/g, '/')
            });
        } else {
            fs.unlink(_progressFile).catch(() => {});
        }

        this._currentGoalId = null;
        this._currentObservations = null;
        this._currentTotalIterations = null;

        // Summarise and persist
        const toolsList = [...toolsUsed].join(', ') || 'reasoning only';
        const executionState = finalResult
            ? 'completed'
            : needsContinuation
                ? 'incomplete_step_budget'
                : 'incomplete_unverified';
        const stopReason = finalResult
            ? 'poseidon_verified'
            : needsContinuation
                ? (timedOut ? 'session_timeout' : 'max_iterations_reached')
                : 'unverified_or_interrupted';
        const fallbackResult = needsContinuation
            ? `Incomplete: used ${sessionIterations}/${this.maxIterations} steps this session (${iteration} cumulative) before verified completion. Continue from ${_progressFile}.`
            : `Incomplete: ${sessionIterations} session steps (${iteration} cumulative), tools: ${toolsList}`;
        const summary = `Executed "${goal.title}" in ${sessionIterations} session step(s), ${iteration} cumulative, using [${toolsList}]. ${finalResult ? 'COMPLETED.' : executionState}.`;
        if (this.memory?.remember) {
            await this.memory.remember(summary, {
                type: 'goal_execution', importance: 7, goalId: goal.id, state: executionState, stopReason
            }).catch(() => {});
        }

        return {
            done:         !!finalResult,
            state:        executionState,
            stopReason,
            result:       finalResult || fallbackResult,
            iterations:   sessionIterations,
            totalIterations: iteration,
            maxIterations: this.maxIterations,
            toolsUsed:    [...toolsUsed],
            observations,
            completionEvidence,
            evidencePath,
            checkpointFile: _progressFile,
            observationLedger: path.relative(ROOT, _ledgerFile).replace(/\\/g, '/'),
            needsContinuation,
            continuationFile: needsContinuation ? _progressFile : null
        };
    }

    // ─────────────────────────────────────────────────────────────────────
    // PROMPT BUILDER
    // ─────────────────────────────────────────────────────────────────────

    _buildPrompt(goal, observations, priorMemories, priorAutopsy = null) {
        const toolDocs = Object.entries(this._tools).map(([name, t]) =>
            `  ${name}\n    What: ${t.description}\n    Args: ${t.args}`
        ).join('\n\n');

        const memBlock = priorMemories.length > 0
            ? `\nWHAT I ALREADY KNOW:\n${priorMemories.map(m => `• ${m}`).join('\n')}\n`
            : '';

        const promptObservations = observations.slice(-12);
        const obsBlock = promptObservations.length > 0
            ? `\nRECENT STEPS (full history is in the observation ledger):\n${promptObservations.map(o =>
                o.tool
                    ? `[Step ${o.step}] ${o.tool} → ${JSON.stringify(o.result).substring(0, 250)}`
                    : `[Step ${o.step}] Thought: ${(o.thought || '').substring(0, 250)}`
              ).join('\n')}\n`
            : '';
        const contract = goal.metadata?.goalContract || {};
        const preflight = compileEvidencePreflight(goal);
        const successCriteria = goal.successCriteria || goal.metadata?.successCriteria || contract.successCriteria || [];
        const contractBlock = `\nEVIDENCE PREFLIGHT (${preflight.profile.toUpperCase()}):\n` +
            `Required evidence fields: ${preflight.evidenceRequired.join(', ') || 'summary'}.\n` +
            `Required physical proof: ${preflight.proof.join('; ')}.\n` +
            `Expected artifact: ${goal.metadata?.expectedArtifact || preflight.filesExist.join(', ') || 'create a goal-specific artifact and report its path'}.\n` +
            (successCriteria.length ? `Success criteria:\n${successCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n')}\n` : '');
        const autopsyBlock = priorAutopsy
            ? `\nLAST FAILED ATTEMPT AUTOPSY:\n- Failed verification: ${priorAutopsy.failedVerification || priorAutopsy.reason || 'unknown'}\n- Attempted strategy: ${priorAutopsy.attemptedStrategy || 'unknown'}\n- Next strategy: ${priorAutopsy.nextStrategy || 'inspect verifier failure and produce missing proof'}\n- Do not repeat: ${(priorAutopsy.bannedRepeatActions || []).join(' | ')}\n`
            : '';

        const complexityBlock = this._shouldDelegate(goal, observations)
            ? `\nDELEGATION REQUIREMENT:\nThis goal is complex enough for parallel work. Your first concrete action should be spawn_agents with roles ["researcher","coder","tester","reviewer"] and relevant target files. The tool must return saved artifacts: research_report, code_patch_plan, test_report, and review_verdict. Use those artifacts before editing or claiming DONE.\n`
            : '';

        return `You are SOMA's autonomous execution engine. Complete the goal below by using tools one step at a time.

GOAL: ${goal.title}
DESCRIPTION: ${goal.description || 'No additional description'}
LIFECYCLE STATE: ${deriveGoalState(goal)}
${memBlock}${autopsyBlock}${complexityBlock}${contractBlock}${obsBlock}
AVAILABLE TOOLS:
${toolDocs}

HOW TO USE A TOOL — respond in EXACTLY this format (no extra text before THINK):
THINK: [one sentence: why this tool, why these args]
TOOL: tool_name
ARGS: {"key": "value"}

HOW TO FINISH — when the goal is fully done AND you have verified your work:
DONE: yes
RESULT: [clear summary of everything accomplished, findings stored, files created]
FALSIFICATION_TEST: [what specific check proves this is done — e.g., "file research/topic.md was created with findings"]
TEST_RESULT: true

NOTE: You cannot claim DONE without a FALSIFICATION_TEST. Use read_file or list_files first to verify your output actually exists.

RULES:
- Take ONE action per response. Do not plan multiple steps at once.
- Use web_fetch or github_search to get real information (not from memory).
- Use memory_store after finding something important so SOMA remembers it.
- Use write_file to save research findings to research/<topic>.md.
- Never make up URLs — only fetch real URLs you construct from known patterns.
- If a tool returns an error, try a different approach.
- CRITICAL: When modifying SOMA's own code files — always run verify_syntax THEN run_tests before declaring the goal complete. Never commit broken code to yourself.
- CRITICAL: If a previous autopsy exists, your next action must address its failed verification. You MUST try a completely different approach or use a different tool. Do not repeat the same failed strategy. Do not repeat the same DONE claim or same failing command without new evidence.

What is your next step?`;
    }

    // ─────────────────────────────────────────────────────────────────────
    // TOOL CALL PARSER
    // Handles both strict and slightly-malformed LLM output
    // ─────────────────────────────────────────────────────────────────────

    _parseToolCall(text) {
        const toolMatch = text.match(/^TOOL:\s*(\S+)/im);
        if (!toolMatch) return null;

        // Normalise tool name: lowercase, strip punctuation
        const toolName = toolMatch[1].trim().toLowerCase().replace(/[^a-z_]/g, '');
        if (!this._tools[toolName]) return null; // Unknown tool

        // Extract args block — from ARGS: to end of line / next newline block
        const argsMatch = text.match(/^ARGS:\s*(\{[\s\S]*?\})(?:\s*\n|$)/im);
        let args = {};

        if (argsMatch) {
            try {
                args = JSON.parse(argsMatch[1]);
            } catch {
                // Fallback: extract quoted key:value pairs from malformed JSON
                const pairs = [...argsMatch[1].matchAll(/"(\w+)":\s*"([^"]+)"/g)];
                for (const [, k, v] of pairs) args[k] = v;

                const numPairs = [...argsMatch[1].matchAll(/"(\w+)":\s*(\d+)/g)];
                for (const [, k, v] of numPairs) args[k] = Number(v);
            }
        }

        return { tool: toolName, args };
    }

    // ─────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────

    async _recallMemories(query) {
        if (!this.memory?.recall) return [];
        try {
            const result = await this.memory.recall(query, 3);
            const hits = result?.results || (Array.isArray(result) ? result : []);
            return hits
                .filter(m => (m.similarity || 1) > 0.30)
                .map(m => (m.content || m).toString().substring(0, 200));
        } catch {
            return [];
        }
    }

    async _loadGoalAutopsy(goal = {}) {
        const candidates = [
            goal.metadata?.latestAutopsy,
            goal.id ? path.join(ROOT, 'data', 'goal-autopsies', `${goal.id}.json`) : null
        ].filter(Boolean);
        for (const file of candidates) {
            try {
                const resolved = resolveWithinRoot(ROOT, file, 'Autopsy path');
                const parsed = JSON.parse(await fs.readFile(resolved, 'utf8'));
                return parsed.latest || (Array.isArray(parsed.history) ? parsed.history[0] : null) || parsed;
            } catch {}
        }
        return goal.metadata?.autopsyNextStrategy
            ? {
                failedVerification: goal.metadata?.incompleteReason || 'previous verification failed',
                nextStrategy: goal.metadata.autopsyNextStrategy,
                attemptedStrategy: 'prior heartbeat attempt'
            }
            : null;
    }

    _shouldDelegate(goal = {}, observations = []) {
        if (observations.some(obs => obs.tool === 'spawn_agents')) return false;
        const text = `${goal.title || ''} ${goal.description || ''} ${goal.category || ''}`.toLowerCase();
        const multiFile = /\b(files?|modules?|routes?|arbiters?|daemons?|frontend|backend|database|memory|loader|executor|verification|tests?)\b/.test(text);
        const complexVerb = /\b(refactor|overhaul|implement|enhance|repair|audit|analyze|investigate|integrate|self-improvement|self improvement)\b/.test(text);
        const failedBefore = Number(goal.metadata?.autopsyCount || 0) > 0 || goal.metadata?.latestAutopsy;
        const highPriority = Number(goal.priority || 0) >= 75;
        return (multiFile && complexVerb) || failedBefore || highPriority;
    }

    _normalizeDelegationTasks({ objective, roles, targets = [], tasks = [], label = 'delegation batch', priority = 'normal' } = {}) {
        const cleanObjective = String(objective || label || 'delegated agentic work').trim();
        const cleanTargets = [...new Set((Array.isArray(targets) ? targets : [targets])
            .filter(Boolean)
            .map(t => String(t).replace(/\\/g, '/')))]
            .slice(0, 12);

        let requested = [];
        if (Array.isArray(roles) && roles.length) {
            requested = roles.map(role => ({ role: String(role).toLowerCase(), task: cleanObjective }));
        } else if (Array.isArray(tasks) && tasks.length) {
            requested = tasks.map(item => ({
                role: String(item.role || item.type || 'researcher').toLowerCase(),
                task: item.task || item.objective || cleanObjective,
                targets: item.targets
            }));
        } else {
            requested = ['researcher', 'coder', 'tester', 'reviewer'].map(role => ({ role, task: cleanObjective }));
        }

        const allowed = new Set(['researcher', 'coder', 'tester', 'reviewer', 'ops']);
        const normalizedTasks = requested
            .map(task => ({
                role: allowed.has(task.role) ? task.role : 'researcher',
                task: typeof task.task === 'string' ? task.task : JSON.stringify(task.task || cleanObjective),
                targets: Array.isArray(task.targets) ? task.targets.map(t => String(t).replace(/\\/g, '/')) : cleanTargets
            }))
            .slice(0, 8);

        if (!normalizedTasks.length) return { error: 'roles or tasks must produce at least one delegation task' };
        return {
            objective: cleanObjective,
            label: String(label || 'delegation batch'),
            priority,
            targets: cleanTargets,
            tasks: normalizedTasks
        };
    }

    async _runDelegationTask(task = {}, context = {}) {
        const namedArtifact = await this._tryNamedAgentForTask(task, context);
        if (namedArtifact) return namedArtifact;

        switch (task.role) {
            case 'researcher':
                return this._runResearcherTask(task, context);
            case 'coder':
                return this._runCoderTask(task, context);
            case 'tester':
                return this._runTesterTask(task, context);
            case 'reviewer':
                return this._runReviewerTask(task, context);
            case 'ops':
                return this._runOpsTask(task, context);
            default:
                return this._runResearcherTask({ ...task, role: 'researcher' }, context);
        }
    }

    async _tryNamedAgentForTask(task = {}, context = {}) {
        const routes = {
            coder: ['max', ...getAgentsForRole('coder').filter(name => name !== 'max')],
            researcher: ['max', 'kuze', ...getAgentsForRole('researcher').filter(name => !['max', 'kuze'].includes(name))],
            reviewer: ['steve', 'kuze', ...getAgentsForRole('reviewer').filter(name => !['steve', 'kuze'].includes(name))],
            ops: ['black', ...getAgentsForRole('ops').filter(name => name !== 'black')],
            tester: getAgentsForRole('tester').filter(name => name !== 'soma')
        };
        for (const agentName of routes[task.role] || []) {
            try {
                let artifact = null;
                if (agentName === 'max') artifact = await this._askMaxForArtifact(task, context);
                if (agentName === 'steve') artifact = await this._askSteveForArtifact(task, context);
                if (agentName === 'kuze') artifact = await this._askKuzeForArtifact(task, context);
                if (agentName === 'black') artifact = await this._askBlackForArtifact(task, context);
                if (this._isValidDelegationArtifact(artifact, task.role)) return artifact;
            } catch (error) {
                // Named agents are accelerators, not a hard dependency.
            }
        }
        return null;
    }

    _isValidDelegationArtifact(artifact, role) {
        return !!(
            artifact &&
            artifact.role === role &&
            typeof artifact.type === 'string' &&
            Object.prototype.hasOwnProperty.call(artifact, 'passed') &&
            (artifact.findings || artifact.plan || artifact.checks || artifact.verdict || artifact.metrics || artifact.output)
        );
    }

    async _askMaxForArtifact(task, context) {
        const bridge = this.system?.maxBridge || maxAgentBridge;
        if (bridge?.ensureAvailable) {
            const availability = await bridge.ensureAvailable({ startIfOffline: true, timeoutMs: 45_000 });
            if (!availability?.available) return null;
            await recordCapabilityTruth('SOMA can reach/start MAX API', {
                verified: true,
                source: 'soma_agentic_executor',
                proof: availability,
                metadata: { role: task.role }
            }).catch(() => {});
        } else if (!bridge?.isAvailable || !(await bridge.isAvailable())) {
            return null;
        }

        const localTargetSummaries = await this._readTargetFileSummaries(task.targets || context.targets || []);
        const targetSummary = localTargetSummaries.length
            ? localTargetSummaries.map(t => `${t.path} (${t.exists ? `${t.lines || 0} lines, exists` : `missing: ${t.error || 'not found'}`})`).join('; ')
            : ((task.targets || context.targets || []).slice(0, 8).join(', ') || 'no explicit targets');
        const prompt = [
            'You are MAX assisting SOMA. Return concise JSON only.',
            `Role: ${task.role}`,
            `Artifact type: ${task.role === 'coder' ? 'code_patch_plan' : 'research_report'}`,
            `Objective: ${context.objective}`,
            `SOMA root: ${ROOT}`,
            `Targets: ${targetSummary}`,
            `SOMA local target evidence: ${JSON.stringify(localTargetSummaries.map(({ excerpt, ...rest }) => rest)).slice(0, 3000)}`,
            'Resolve relative targets from the SOMA root above.',
            'For research, include findings and risks. For coding, include files, plan, and verificationRequired.',
            'Do not edit files from this request. This is planning/evidence only.'
        ].join('\n');
        const response = await bridge.chat(prompt, { persona: 'engineering', temperature: 0.2, maxTokens: 1400 });
        const text = this._normalizeBridgeText(response?.response || response?.message || response?.raw || response);
        const parsed = this._parsePossibleJson(text);
        if (parsed && typeof parsed === 'object') {
            return {
                role: task.role,
                agent: 'max',
                type: parsed.type || (task.role === 'coder' ? 'code_patch_plan' : 'research_report'),
                passed: parsed.passed !== false,
                objective: context.objective,
                findings: parsed.findings,
                files: parsed.files,
                plan: parsed.plan,
                verificationRequired: parsed.verificationRequired || ['syntax_check', 'test_or_build_command'],
                risks: [
                    ...(parsed.risks || []),
                    ...localTargetSummaries.filter(t => !t.exists).map(t => `SOMA local target missing: ${t.path}`)
                ],
                targetSummaries: localTargetSummaries.map(({ excerpt, ...rest }) => rest),
                output: parsed.output || text.slice(0, 4000)
            };
        }
        return {
            role: task.role,
            agent: 'max',
            type: task.role === 'coder' ? 'code_patch_plan' : 'research_report',
            passed: true,
            objective: context.objective,
            output: text.slice(0, 4000),
            plan: task.role === 'coder' ? [text.slice(0, 1200)] : undefined,
            findings: task.role !== 'coder' ? [text.slice(0, 1200)] : undefined,
            targetSummaries: localTargetSummaries.map(({ excerpt, ...rest }) => rest),
            verificationRequired: task.role === 'coder' ? ['syntax_check', 'test_or_build_command'] : undefined
        };
    }

    async _askSteveForArtifact(task, context) {
        const steve = this.system?.steveArbiter;
        if (!steve?.processChat) return null;
        const message = [
            'Review this delegated SOMA work. Return concise concerns and a readiness verdict.',
            `Objective: ${context.objective}`,
            `Targets: ${(task.targets || context.targets || []).join(', ') || 'none'}`,
            'Focus on correctness, missing tests, and whether this is safe to mark done.'
        ].join('\n');
        const response = await steve.processChat(message, [], { autonomous: true, source: 'agentic_executor.spawn_agents' });
        const text = response?.response || response?.message || JSON.stringify(response || {});
        const concerns = this._extractConcerns(text);
        return {
            role: 'reviewer',
            agent: 'steve',
            type: 'review_verdict',
            passed: concerns.length === 0,
            objective: context.objective,
            verdict: concerns.length ? 'needs_work' : 'ready_with_tests',
            concerns,
            output: text.slice(0, 4000),
            requiredBeforeDone: ['Syntax check passed', 'Test/build proof attached', 'Reviewer concerns resolved']
        };
    }

    async _askKuzeForArtifact(task, context) {
        const kuze = this._getNamedMicroAgent('KuzeAgent') || this._getNamedMicroAgent('Kuze');
        if (!kuze?.execute) return null;
        const targetSummaries = await this._readTargetFileSummaries(task.targets || context.targets || []);
        const events = targetSummaries.map((summary, index) => ({
            timestamp: Date.now() + index,
            type: summary.exists ? 'target_file' : 'missing_target',
            path: summary.path,
            lines: summary.lines || 0,
            declarations: summary.declarations?.length || 0,
            imports: summary.imports?.length || 0
        }));
        const result = task.role === 'reviewer'
            ? await kuze.execute({ type: 'risk-model', payload: { evidence: events, context: context.objective } })
            : await kuze.execute({ type: 'pattern-detect', payload: { events, context: context.objective } });
        if (result?.success === false) return null;
        const analysis = result?.analysis || result;
        return {
            role: task.role,
            agent: 'kuze',
            type: task.role === 'reviewer' ? 'review_verdict' : 'research_report',
            passed: true,
            objective: context.objective,
            findings: analysis?.patterns ? analysis.patterns.slice(0, 12) : [JSON.stringify(analysis).slice(0, 1200)],
            risks: analysis?.risks || [],
            verdict: task.role === 'reviewer' ? 'analytical_review_complete' : undefined,
            output: JSON.stringify(analysis).slice(0, 4000)
        };
    }

    async _askBlackForArtifact(task, context) {
        const black = this._getNamedMicroAgent('BlackAgent') || this._getNamedMicroAgent('Black');
        if (!black?.execute) return null;
        const result = await black.execute({ type: 'health-check', payload: { objective: context.objective } });
        if (result?.success === false) return null;
        return {
            role: 'ops',
            agent: 'black',
            type: 'ops_report',
            passed: result?.healthy !== false,
            objective: context.objective,
            metrics: result?.metrics || result,
            findings: result?.recommendations || result?.alerts || [],
            output: JSON.stringify(result).slice(0, 4000)
        };
    }

    _getNamedMicroAgent(name) {
        const pool = this.system?.microAgentPool || this.pool;
        if (pool?.spawnedAgents?.get) return pool.spawnedAgents.get(name);
        if (pool?.spawnedAgents && typeof pool.spawnedAgents === 'object') return pool.spawnedAgents[name];
        return this.system?.[name] || this.system?.[`${name.charAt(0).toLowerCase()}${name.slice(1)}`] || null;
    }

    _parsePossibleJson(text = '') {
        const raw = String(text || '').trim();
        if (!raw) return null;
        try { return JSON.parse(raw); } catch {}
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        try { return JSON.parse(match[0]); } catch { return null; }
    }

    _normalizeBridgeText(value) {
        if (value == null) return '';
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        if (!raw.includes('data:')) return raw;

        const tokens = [];
        for (const line of raw.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            try {
                const parsed = JSON.parse(payload);
                if (parsed.type === 'token' && typeof parsed.text === 'string') tokens.push(parsed.text);
                else if (typeof parsed.text === 'string') tokens.push(parsed.text);
            } catch {}
        }
        return tokens.length ? tokens.join('') : raw;
    }

    _extractConcerns(text = '') {
        const lower = String(text || '').toLowerCase();
        if (/\b(no concerns|ready|safe to proceed|looks good|pass)\b/.test(lower) && !/\b(fail|missing|concern|risk|unsafe|broken)\b/.test(lower)) {
            return [];
        }
        const lines = String(text || '').split(/\r?\n/)
            .map(line => line.replace(/^[-*0-9.)\s]+/, '').trim())
            .filter(Boolean)
            .filter(line => /\b(concern|risk|missing|fail|unsafe|broken|needs?|should|must|required)\b/i.test(line))
            .slice(0, 8);
        return lines.length ? lines : ['Steve review returned non-empty feedback; inspect output before DONE.'];
    }

    async _readTargetFileSummaries(targets = []) {
        const summaries = [];
        for (const target of targets.slice(0, 12)) {
            let resolved;
            try {
                resolved = resolveWithinRoot(ROOT, target, 'Delegation target');
            } catch {
                summaries.push({ path: target, exists: false, error: 'outside SOMA root' });
                continue;
            }
            try {
                const stat = await fs.stat(resolved);
                if (!stat.isFile()) {
                    summaries.push({ path: target, exists: true, type: 'directory_or_non_file' });
                    continue;
                }
                const content = await fs.readFile(resolved, 'utf8');
                const lines = content.split('\n');
                const exports = [...content.matchAll(/\bexport\s+(?:class|function|const|let|var|async function)?\s*([A-Za-z0-9_$]*)/g)]
                    .map(m => m[1]).filter(Boolean).slice(0, 12);
                const declarations = [...content.matchAll(/\b(?:class|function|async function)\s+([A-Za-z0-9_$]+)/g)]
                    .map(m => m[1]).slice(0, 18);
                const imports = [...content.matchAll(/^\s*import\s+.+?from\s+['"](.+?)['"]/gm)]
                    .map(m => m[1]).slice(0, 18);
                summaries.push({
                    path: target,
                    exists: true,
                    bytes: stat.size,
                    lines: lines.length,
                    imports,
                    exports,
                    declarations,
                    excerpt: content.slice(0, 1200)
                });
            } catch (e) {
                summaries.push({ path: target, exists: false, error: e.message });
            }
        }
        return summaries;
    }

    async _runResearcherTask(task, context) {
        const targetSummaries = await this._readTargetFileSummaries(task.targets || context.targets || []);
        const missing = targetSummaries.filter(t => !t.exists).map(t => t.path);
        const findings = [];
        for (const summary of targetSummaries.filter(t => t.exists)) {
            findings.push(`${summary.path}: ${summary.lines || 0} lines, ${summary.declarations?.length || 0} declarations, ${summary.imports?.length || 0} imports`);
            if (summary.exports?.length) findings.push(`${summary.path}: exports ${summary.exports.join(', ')}`);
        }
        if (!findings.length) findings.push('No target files were provided or readable; start with search_code/list_files before editing.');
        return {
            role: 'researcher',
            type: 'research_report',
            passed: missing.length === 0,
            objective: context.objective,
            findings,
            targetSummaries: targetSummaries.map(({ excerpt, ...rest }) => rest),
            risks: missing.length ? [`Missing or unreadable targets: ${missing.join(', ')}`] : []
        };
    }

    async _runCoderTask(task, context) {
        const targetSummaries = await this._readTargetFileSummaries(task.targets || context.targets || []);
        const files = targetSummaries.map(t => t.path);
        const plan = [];
        if (files.length) {
            plan.push(`Patch only the scoped target files unless research proves another file is required: ${files.join(', ')}`);
        } else {
            plan.push('Identify concrete files with search_code before modifying code.');
        }
        plan.push('Keep the change narrow, preserve existing public contracts, and add explicit evidence for each behavior changed.');
        plan.push('After edits, run verify_syntax for changed JS/CJS/MJS files and run_tests or an equivalent executable command.');
        return {
            role: 'coder',
            type: 'code_patch_plan',
            passed: files.length > 0,
            objective: context.objective,
            files,
            plan,
            verificationRequired: ['syntax_check', 'test_or_build_command', 'post_change_readback'],
            riskLevel: files.length > 4 ? 'medium' : 'low'
        };
    }

    async _runTesterTask(task, context) {
        const targets = (task.targets || context.targets || []).filter(file => /\.(js|cjs|mjs)$/i.test(file)).slice(0, 8);
        const checks = [];
        for (const target of targets) {
            let resolved;
            try {
                resolved = resolveWithinRoot(ROOT, target, 'Tester target');
            } catch {
                checks.push({ command: `node --check ${target}`, passed: false, error: 'outside SOMA root' });
                continue;
            }
            try {
                const { stdout, stderr } = await execFileAsync(process.execPath, ['--check', resolved], {
                    cwd: ROOT,
                    timeout: 30_000,
                    maxBuffer: 256 * 1024
                });
                checks.push({
                    command: `node --check ${target}`,
                    passed: true,
                    stdout: stdout?.slice(0, 1000) || '',
                    stderr: stderr?.slice(0, 1000) || ''
                });
            } catch (e) {
                checks.push({
                    command: `node --check ${target}`,
                    passed: false,
                    stdout: e.stdout?.slice(0, 1000) || '',
                    stderr: e.stderr?.slice(0, 1000) || '',
                    error: e.message
                });
            }
        }
        if (!checks.length) {
            checks.push({
                command: 'node --check <targets>',
                passed: false,
                error: 'No JS/CJS/MJS/TS targets supplied for executable syntax verification'
            });
        }
        return {
            role: 'tester',
            type: 'test_report',
            passed: checks.every(c => c.passed),
            objective: context.objective,
            checks,
            recommendedNextChecks: ['Run the repo-specific test/build command after code edits if one exists.']
        };
    }

    async _runReviewerTask(task, context) {
        const targetSummaries = await this._readTargetFileSummaries(task.targets || context.targets || []);
        const concerns = [];
        if (!targetSummaries.length) concerns.push('No target files supplied; delegation cannot anchor review to concrete code.');
        if (targetSummaries.some(t => !t.exists)) concerns.push('One or more target files are missing or unreadable.');
        if (!/\b(test|verify|syntax|build|proof|evidence)\b/i.test(context.objective || '')) {
            concerns.push('Objective does not explicitly mention verification; require executable proof before DONE.');
        }
        return {
            role: 'reviewer',
            type: 'review_verdict',
            passed: concerns.length === 0,
            objective: context.objective,
            verdict: concerns.length ? 'needs_work' : 'ready_with_tests',
            concerns,
            requiredBeforeDone: ['Concrete changed files listed', 'Syntax check passed', 'Test/build command passed or documented with reason if unavailable']
        };
    }

    async _runOpsTask(task, context) {
        const checks = [];
        try {
            const { stdout } = await execFileAsync(process.execPath, ['-e', 'console.log(JSON.stringify({memory:process.memoryUsage(),uptime:process.uptime(),platform:process.platform}))'], {
                cwd: ROOT,
                timeout: 10_000,
                maxBuffer: 128 * 1024
            });
            checks.push({
                command: 'node process health snapshot',
                passed: true,
                metrics: this._parsePossibleJson(stdout) || { raw: stdout.slice(0, 1000) }
            });
        } catch (error) {
            checks.push({
                command: 'node process health snapshot',
                passed: false,
                error: error.message
            });
        }
        return {
            role: 'ops',
            agent: 'soma-fallback',
            type: 'ops_report',
            passed: checks.every(check => check.passed),
            objective: context.objective,
            checks,
            findings: checks.every(check => check.passed)
                ? ['Local process health snapshot completed.']
                : ['Local process health snapshot failed; inspect error before continuing.']
        };
    }

    async _writeDelegationArtifacts({ objective, label, targets, artifacts }) {
        await fs.mkdir(DELEGATION_DIR, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `${stamp}-${safeStageId(label || objective)}.json`;
        const relativePath = path.join('data', 'agent-delegations', fileName);
        const absolutePath = path.join(ROOT, relativePath);
        const payload = {
            createdAt: new Date().toISOString(),
            objective,
            label,
            targets,
            artifacts,
            passed: artifacts.every(a => a.passed !== false)
        };
        await fs.writeFile(absolutePath, JSON.stringify(payload, null, 2), 'utf8');
        return relativePath.replace(/\\/g, '/');
    }

    async escalateGoalToMax(goal = {}, autopsy = null) {
        const bridge = this.system?.maxBridge || maxAgentBridge;
        const availability = await bridge.ensureAvailable({ startIfOffline: true });
        if (!availability?.available) {
            return { success: false, error: availability?.error || 'MAX unavailable', availability };
        }
        const title = `Repair SOMA goal after exhausted attempts: ${String(goal.title || goal.id).slice(0, 120)}`;
        const description = [
            `SOMA goal ID: ${goal.id}`,
            `Goal: ${goal.title}`,
            `Description: ${goal.description || 'none'}`,
            `Attempts: ${goal.metadata?.executionAttempts || 0}/${goal.metadata?.goalContract?.maxAttempts || goal.metadata?.maxAttempts || 3}`,
            `Latest autopsy: ${autopsy?.path || goal.metadata?.latestAutopsy || 'none'}`,
            'Inspect the persisted continuation and evidence ledger. Return a bounded repair with executable verification; do not mark SOMA complete yourself.'
        ].join('\n');
        const result = await bridge.injectGoal(title, { description, priority: 0.95 });
        return { success: Boolean(result?.id), maxGoalId: result?.id || null, result };
    }

    async _queuePoseidonRepairGoal(goal = {}, details = {}) {
        if (!this.goalPlanner?.createGoal) return null;

        const repairTitle = `Repair repeated unverified completion claims: ${goal.title || 'agentic goal'}`.slice(0, 180);
        if (this.goalPlanner?.updateGoalProgress) {
            await this.goalPlanner.updateGoalProgress(goal.id, goal.metrics?.progress || 0, { status: 'repairing' }).catch(() => {});
            goal.status = 'repairing';
        }
        const repair = await this.goalPlanner.createGoal({
            title: repairTitle,
            description: [
                `Goal failed repeated verification checks due to insufficient physical evidence.`,
                `Poseidon reason: ${details.verified?.reason || 'unknown'}`,
                'Tighten the execution prompt, tool-use flow, or verification policy so future DONE claims include concrete checked evidence before completion.'
            ].join('\n'),
            category: 'poseidon_claim_discipline',
            priority: 0.72,
            source: 'autonomous_work_loop',
            evidence: {
                originalGoalId: goal.id || null,
                iteration: details.iteration || null,
                poseidon: details.verified || null
            }
        });

        await recordLoopEvent({
            loop: 'autonomous_work',
            phase: 'repair_goal_queued',
            actor: this.name,
            target: goal.title || null,
            channel: 'agentic_executor',
            claim: 'Repeated unverified DONE claims were converted into a repair goal.',
            falsificationTest: 'goalPlanner.createGoal returned a repair goal object',
            testResult: !!repair,
            evidence: {
                originalGoalId: goal.id || null,
                repairGoalId: repair?.id || null,
                totalDoneBlocks: details.totalDoneBlocks || 2,
                poseidon: details.verified || null
            },
            nextStep: repair?.id
                ? 'Run the repair goal to reduce unsupported completion claims.'
                : 'Retry repair goal creation when the goal planner is available.'
        }).catch(() => {});

        return repair;
    }

    // ─────────────────────────────────────────────────────────────────────
    // DIRECT API CALL (bypasses QuadBrain lobe routing)
    // Agentic tasks need precise format compliance, not lobe debate.
    // Uses proper system + user message split so the format instruction lands.
    // ─────────────────────────────────────────────────────────────────────

    async _callDirectAPI(systemPrompt, userPrompt, forceLocal = false, usageContext = {}) {
        // Try DeepSeek first (same key as QuadBrain uses)
        const dsKey = this.brain?.deepseekApiKey || process.env.DEEPSEEK_API_KEY;
        const actor = usageContext.actor || 'SomaAgenticExecutor';
        const action = usageContext.action || 'goal_execution';
        const dailyCallLimit = Math.max(0, Number(process.env.SOMA_AGENTIC_DEEPSEEK_DAILY_CALL_LIMIT || 45));
        if (dsKey && !forceLocal) {
            try {
                const completion = await deepSeekGateway.complete({
                    apiKey: dsKey,
                    model: 'deepseek-chat',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature: 0.3,
                    maxTokens: 512,
                    timeoutMs: 45_000,
                    priority: action === 'human_goal_execution' ? 'human' : 'background',
                    actor,
                    action,
                    dailyCallLimit,
                });
                const data = completion.data;
                const text = data.choices?.[0]?.message?.content;
                if (text) return { text, provider: 'deepseek', usage: data.usage || {} };
            } catch (e) {
                console.warn(`[${this.name}] DeepSeek direct call failed: ${e.message}`);
            }
        }

        // Default for autonomous work and fallback for exhausted cloud budgets.
        try {
            const ollamaModel = this.brain?.ollamaModel || process.env.OLLAMA_MODEL || 'gemma3:4b';
            const ollamaEndpoint = this.brain?.ollamaEndpoint || 'http://localhost:11434';
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 60000);
            const res = await fetch(`${ollamaEndpoint}/api/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: ollamaModel,
                    system: systemPrompt,
                    prompt: userPrompt,
                    stream: false,
                    options: { temperature: 0.3, num_predict: 512 }
                }),
                signal: ctrl.signal
            });
            clearTimeout(timer);
            if (res.ok) {
                const data = await res.json();
                const text = data.response;
                if (text) return { text, provider: 'ollama' };
            }
        } catch (e) {
            console.warn(`[${this.name}] Ollama direct call failed: ${e.message}`);
        }

        throw new Error('All providers failed for agentic step');
    }

    getToolNames() {
        return Object.keys(this._tools || {});
    }
}
