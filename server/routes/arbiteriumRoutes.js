import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { buildBusinessArbiteriumSteps } from '../business-planning/BusinessArbiteriumWorkflow.js';

const router = express.Router();
const SESSIONS_FILE = path.join(process.cwd(), 'data', 'arbiterium_sessions.json');
let previousCpuSample = null;

function sampleCpuPercent() {
    const cpus = os.cpus();
    const current = cpus.reduce((sum, cpu) => {
        const total = Object.values(cpu.times).reduce((acc, value) => acc + value, 0);
        return { total: sum.total + total, idle: sum.idle + cpu.times.idle };
    }, { total: 0, idle: 0 });
    if (!previousCpuSample) {
        previousCpuSample = current;
        return null;
    }
    const totalDelta = current.total - previousCpuSample.total;
    const idleDelta = current.idle - previousCpuSample.idle;
    previousCpuSample = current;
    if (totalDelta <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)));
}

function runtimeArbiters(system) {
    let entries = [];
    if (typeof system?.messageBroker?.getArbiters === 'function') {
        entries = system.messageBroker.getArbiters() || [];
    } else if (system?.arbiters instanceof Map) {
        entries = Array.from(system.arbiters.values());
    } else if (system?.arbiterRegistry instanceof Map) {
        entries = Array.from(system.arbiterRegistry.values());
    }

    return entries.map((entry, index) => {
        const instance = entry?.instance || entry;
        let observed = null;
        try {
            const candidate = typeof instance?.getStatus === 'function' ? instance.getStatus() : null;
            if (candidate && typeof candidate.then !== 'function') observed = candidate;
        } catch {}
        const status = typeof observed === 'string'
            ? observed
            : observed?.status
                || entry?.status
                || instance?.status
                || (instance?.initialized === false ? 'offline' : 'ready');
        const metrics = instance?.metrics || observed?.metrics || {};
        const active = Number(metrics.activeTasks ?? metrics.activeRequests ?? observed?.activeTasks);
        const capacity = Number(metrics.capacity ?? metrics.maxConcurrent ?? observed?.capacity);
        const load = Number.isFinite(active) && Number.isFinite(capacity) && capacity > 0
            ? Math.max(0, Math.min(1, active / capacity))
            : null;
        return {
            id: entry?.id || entry?.name || instance?.id || instance?.name || `arbiter-${index + 1}`,
            name: entry?.name || instance?.name || instance?.constructor?.name || 'Unnamed Arbiter',
            role: entry?.role || instance?.role || 'unknown',
            status,
            load,
            lastHeartbeat: entry?.lastHeartbeat || observed?.lastHeartbeat || null
        };
    });
}

// Helper to load sessions from disk
async function loadSessionsData() {
    try {
        const raw = await fs.readFile(SESSIONS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

// Helper to save sessions to disk
async function saveSessionsData(sessions) {
    try {
        await fs.mkdir(path.dirname(SESSIONS_FILE), { recursive: true });
        await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    } catch (err) {
        console.error('[ArbiteriumRoutes] Failed to save sessions:', err.message);
    }
}

/**
 * POST /api/arbiterium/orchestrate
 * Converts a natural language goal into a structured multi-step DAG workflow plan.
 */
router.post('/orchestrate', async (req, res) => {
    try {
        const { goal, deepThinking = false } = req.body || {};
        if (!goal?.trim()) {
            return res.status(400).json({ success: false, error: 'goal string required' });
        }

        const system = req.app.get('somaSystem') || global.somaSystem;
        const brain = system?.brain || global.somaBrain;
        const goalPlanner = system?.goalPlanner;

        let summary = `Orchestrated workflow plan for: "${goal.slice(0, 100)}"`;
        let steps = [];

        // Attempt QuadBrain AI orchestration if available
        if (brain?.callBrain) {
            const prompt = [
                `Break down the following user goal into 3 to 5 logical sequential workflow steps.`,
                `User Goal: "${goal}"`,
                `Available Arbiter Roles: analyst, archivist, coding, finance, guardian, limbic, risk, strategy, general.`,
                `Return ONLY valid JSON matching this schema:`,
                `{`,
                `  "summary": "High level strategy overview",`,
                `  "steps": [`,
                `    { "id": "step-1", "description": "Step detail", "assignedArbiterRole": "coding", "dependencies": [] },`,
                `    { "id": "step-2", "description": "Step detail", "assignedArbiterRole": "risk", "dependencies": ["step-1"] }`,
                `  ]`,
                `}`
            ].join('\n');

            try {
                const aiResponse = await Promise.race([
                    brain.callBrain('LOGOS', prompt, { source: 'arbiterium_orchestrator' }, deepThinking ? 'deliberate' : 'fast'),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000))
                ]);

                const text = typeof aiResponse === 'string' ? aiResponse : (aiResponse?.response || aiResponse?.text || '');
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.steps && Array.isArray(parsed.steps)) {
                        summary = parsed.summary || summary;
                        steps = parsed.steps.map((s, idx) => ({
                            id: s.id || `step-${idx + 1}`,
                            description: s.description || `Execute step ${idx + 1}`,
                            assignedArbiterRole: s.assignedArbiterRole || 'general',
                            dependencies: Array.isArray(s.dependencies) ? s.dependencies : (idx > 0 ? [`step-${idx}`] : []),
                            status: 'pending',
                            logs: [`Assigned to ${s.assignedArbiterRole || 'general'} arbiter`]
                        }));
                    }
                }
            } catch (err) {
                console.warn('[ArbiteriumRoutes] AI orchestration fell back to deterministic heuristic:', err.message);
            }
        }

        // Fallback heuristic if AI orchestration did not produce steps
        if (!steps.length) {
            const lower = goal.toLowerCase();
            const isBusinessPlan = /\b(business plan|startup|market sizing|pricing|financial projections|go-to-market|gtm|shower|glass|consumer)\b/i.test(lower);
            const isTrading = /\b(trade|trading|market|pnl|eth|btc|coin)\b/i.test(lower);
            const isCode = /\b(code|build|app|fix|bug|refactor|test)\b/i.test(lower);
            const isResearch = /\b(research|paper|study|find|search|medical)\b/i.test(lower);

            if (isBusinessPlan) {
                summary = `6-Gate Business Validation & Execution Plan for: "${goal.slice(0, 70)}"`;
                steps = buildBusinessArbiteriumSteps().map(step => ({ ...step, logs:[`Assigned to ${step.assignedArbiterRole} arbiter`] }));
            } else if (isTrading) {
                steps = [
                    { id: 'step-1', description: 'Analyze current market trend & macro sentiment', assignedArbiterRole: 'finance', dependencies: [], status: 'pending', logs: ['Assigned to finance arbiter'] },
                    { id: 'step-2', description: 'Evaluate strategy performance & risk boundaries', assignedArbiterRole: 'risk', dependencies: ['step-1'], status: 'pending', logs: ['Assigned to risk arbiter'] },
                    { id: 'step-3', description: 'Execute paper trading signal verification', assignedArbiterRole: 'strategy', dependencies: ['step-2'], status: 'pending', logs: ['Assigned to strategy arbiter'] }
                ];
            } else if (isCode) {
                steps = [
                    { id: 'step-1', description: 'Inspect target repository files and architecture', assignedArbiterRole: 'coding', dependencies: [], status: 'pending', logs: ['Assigned to coding arbiter'] },
                    { id: 'step-2', description: 'Apply code modifications and refactoring', assignedArbiterRole: 'coding', dependencies: ['step-1'], status: 'pending', logs: ['Assigned to coding arbiter'] },
                    { id: 'step-3', description: 'Run automated test suite and verify build integrity', assignedArbiterRole: 'guardian', dependencies: ['step-2'], status: 'pending', logs: ['Assigned to guardian arbiter'] }
                ];
            } else {
                steps = [
                    { id: 'step-1', description: `Deconstruct goal: "${goal.slice(0, 60)}"`, assignedArbiterRole: 'analyst', dependencies: [], status: 'pending', logs: ['Assigned to analyst arbiter'] },
                    { id: 'step-2', description: 'Execute primary tasks and retrieve evidence', assignedArbiterRole: 'general', dependencies: ['step-1'], status: 'pending', logs: ['Assigned to general arbiter'] },
                    { id: 'step-3', description: 'Synthesize results and store execution receipt', assignedArbiterRole: 'archivist', dependencies: ['step-2'], status: 'pending', logs: ['Assigned to archivist arbiter'] }
                ];
            }
        }

        const plan = {
            goal,
            summary,
            createdAt: Date.now(),
            steps
        };

        const arbiters = runtimeArbiters(system);

        return res.json({ success: true, plan, arbiters });
    } catch (error) {
        console.error('[ArbiteriumRoutes] Orchestration failed:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/arbiterium/execute-step
 * Executes a single step in the workflow using system tools or agentic executor.
 */
router.post('/execute-step', async (req, res) => {
    try {
        const { stepId, description, arbiterRole, context = {}, tools = [] } = req.body || {};
        if (!stepId || !description) {
            return res.status(400).json({ success: false, error: 'stepId and description required' });
        }

        const system = req.app.get('somaSystem') || global.somaSystem;
        const toolRegistry = system?.toolRegistry;

        let output = '';
        const toolsUsed = [];

        // If tool registry is available and tools specified, execute
        if (toolRegistry?.execute && Array.isArray(tools) && tools.length) {
            for (const toolName of tools) {
                try {
                    const result = await toolRegistry.execute(toolName, context);
                    toolsUsed.push({ tool: toolName, result });
                } catch (e) {
                    toolsUsed.push({ tool: toolName, error: e.message });
                }
            }
            const failures = toolsUsed.filter(item => item.error);
            output = `Executed ${toolsUsed.length - failures.length}/${toolsUsed.length} requested tool(s).`;
            return res.status(failures.length ? 502 : 200).json({
                success: failures.length === 0,
                output,
                status: failures.length ? 'failed' : 'completed',
                metadata: { toolsUsed, timestamp: Date.now(), evidenceBacked: true }
            });
        }

        if (system?.goalPlanner?.createGoal && system?.agenticExecutor) {
            const queued = await system.goalPlanner.createGoal({
                title: String(description).slice(0, 160),
                description: String(description),
                category: arbiterRole === 'coding' ? 'engineering' : 'general',
                type: 'arbiterium_step',
                priority: 90,
                metadata: {
                    source: 'arbiterium',
                    userDirected: true,
                    arbiteriumStepId: stepId,
                    arbiterRole: arbiterRole || 'general',
                    context
                }
            }, 'user');
            const goalId = queued?.goalId || queued?.existingGoalId || queued?.goal?.id || null;
            return res.status(202).json({
                success: queued?.success === true || Boolean(queued?.existingGoalId),
                output: goalId ? `Queued for evidence-backed execution as goal ${goalId}.` : 'Goal admission rejected the step.',
                status: goalId ? 'queued' : 'rejected',
                metadata: { goalId, stepId, timestamp: Date.now(), evidenceBacked: false }
            });
        }

        return res.status(503).json({
            success: false,
            error: 'No executable tools were requested and the agentic goal runtime is unavailable.',
            status: 'unavailable'
        });
    } catch (error) {
        console.error('[ArbiteriumRoutes] Step execution failed:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/arbiterium/sessions
 * List all saved session summaries.
 */
router.get('/sessions', async (req, res) => {
    try {
        const sessions = await loadSessionsData();
        const summaries = sessions.map(s => ({
            id: s.id,
            title: s.title || 'Untitled Session',
            lastActive: s.lastActive || Date.now(),
            messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
            hasPlan: Boolean(s.plan),
            stepCount: Array.isArray(s.plan?.steps) ? s.plan.steps.length : 0
        }));
        return res.json({ success: true, sessions: summaries });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/arbiterium/sessions/:id
 * Load full data for a specific session.
 */
router.get('/sessions/:id', async (req, res) => {
    try {
        const sessions = await loadSessionsData();
        const session = sessions.find(s => s.id === req.params.id);
        if (!session) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }
        return res.json({ success: true, session });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/arbiterium/sessions/save
 * Save or update an operational session.
 */
router.post('/sessions/save', async (req, res) => {
    try {
        const { session } = req.body || {};
        if (!session?.id) {
            return res.status(400).json({ success: false, error: 'session object with id required' });
        }

        let sessions = await loadSessionsData();
        const index = sessions.findIndex(s => s.id === session.id);
        if (index >= 0) {
            sessions[index] = { ...sessions[index], ...session, lastActive: Date.now() };
        } else {
            sessions.unshift({ ...session, lastActive: Date.now() });
        }
        sessions = sessions.slice(0, 50); // Keep top 50 sessions
        await saveSessionsData(sessions);

        return res.json({ success: true, id: session.id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/arbiterium/sessions/:id
 * Delete a saved session.
 */
router.delete('/sessions/:id', async (req, res) => {
    try {
        let sessions = await loadSessionsData();
        sessions = sessions.filter(s => s.id !== req.params.id);
        await saveSessionsData(sessions);
        return res.json({ success: true, id: req.params.id });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * GET /api/arbiterium/tools
 * List available tools in SOMA's ToolRegistry.
 */
router.get('/tools', (req, res) => {
    const system = req.app.get('somaSystem') || global.somaSystem;
    const toolRegistry = system?.toolRegistry;
    const tools = toolRegistry?.tools instanceof Map
        ? Array.from(toolRegistry.tools.keys())
        : [];

    return res.json({ success: true, tools });
});

/**
 * GET /api/system/state & GET /api/activity/recent helpers
 */
router.get('/system-state-snapshot', (req, res) => {
    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    const ramPct = Math.round((1 - freeMem / totalMem) * 100);
    const cpuLoad = sampleCpuPercent();
    const arbiters = runtimeArbiters(req.app.get('somaSystem') || global.somaSystem);
    const system = req.app.get('somaSystem') || global.somaSystem;
    const fragmentCount = Number(system?.fragmentRegistry?.stats?.activeFragments
        ?? system?.fragmentRegistry?.fragments?.size
        ?? 0);

    return res.json({
        success: true,
        snapshot: {
            status: system?.isReady === false ? 'INITIALIZING' : 'ONLINE',
            cpu: cpuLoad,
            ram: ramPct,
            gpu: null,
            network: null,
            memory: {
                heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
                rss: Math.round(mem.rss / 1024 / 1024)
            },
            agents: arbiters,
            counts: { arbiters: arbiters.length, fragments: fragmentCount }
        }
    });
});

export default function createArbiteriumRoutes(system) {
    return router;
}
