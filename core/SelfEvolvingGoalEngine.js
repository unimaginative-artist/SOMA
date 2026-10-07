// ════════════════════════════════════════════════════════════════════════════
// SelfEvolvingGoalEngine.js
// ════════════════════════════════════════════════════════════════════════════
// SOMA's strategic self-improvement brain.
//
// This is what makes SOMA an ASI candidate rather than a chatbot:
//   - She looks at her own codebase and decides what she's missing
//   - She gets curious from conversations and creates research goals
//   - She finds code on GitHub, evaluates it, decides whether to adopt it
//   - She proposes her own next steps using QuadBrain reasoning
//   - She cleans up stale/junk goals automatically
//
// Goals generated here are REAL: concrete, executable, meaningful.
// ════════════════════════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';
import AutonomousCapabilityExpansion from '../arbiters/AutonomousCapabilityExpansion.js';
const require = createRequire(import.meta.url);

const ROOT_PATH = process.cwd();

export class SelfEvolvingGoalEngine {
    constructor(config = {}) {
        this.name = 'SelfEvolvingGoalEngine';

        // Injected after construction
        this.goalPlanner = null;
        this.brain = null;
        this.memory = null;
        this.curiosityEngine = null;
        this.toolCreator = null;
        this.system = null;
        this.nemesis = null; // NemesisReviewSystem — for weak area detection

        this.config = {
            assessmentIntervalMs: 20 * 60 * 1000,  // Every 20 minutes
            selfInspectIntervalMs: 60 * 60 * 1000, // Every hour
            maxActiveGoals: 5,                      // Keep focus tight — fewer, better goals
            maxCuriosityGoalsPerCycle: 2,
            githubEnabled: config.githubEnabled !== false,
            nemesisGapIntervalMs: 6 * 60 * 60 * 1000, // Every 6 hours — check performance gaps
            nemesisWeakThreshold: 0.6,                  // Avg score below this triggers an improvement goal
            ...config
        };

        this._lastSelfInspect = 0;
        this._lastGithubScan = 0;
        this._lastNemesisGap = 0;
        this._lastKnowledgeSynth = 0;
        this._running = false;
        this.stats = {
            goalsProposed: 0,
            curiosityGoals: 0,
            selfInspections: 0,
            githubScans: 0,
            junkCleaned: 0
        };
    }

    async initialize(deps = {}) {
        this.goalPlanner    = deps.goalPlanner    || this.goalPlanner;
        this.brain          = deps.brain          || this.brain;
        this.memory         = deps.memory         || this.memory;
        this.curiosityEngine = deps.curiosityEngine || this.curiosityEngine;
        this.toolCreator    = deps.toolCreator    || this.toolCreator;
        this.system         = deps.system         || this.system;
        this.nemesis        = deps.nemesis        || this.nemesis;

        // Initialize Autonomous Capability Expansion (ACE)
        this.ace = new AutonomousCapabilityExpansion({
            quadBrain: this.brain,
            messageBroker: this.system?.messageBroker,
            logger: console
        });
        await this.ace.initialize().catch(() => {});

        console.log(`[${this.name}] 🧬 Initializing self-evolving goal engine...`);

        // Clean up any leftover junk goals on start
        await this.cleanupJunkGoals();

        // Start the assessment loop after a delay (let system finish booting)
        setTimeout(() => this._startLoop(), 90000);

        console.log(`[${this.name}] ✅ Self-evolving goal engine active (assessment every ${this.config.assessmentIntervalMs / 60000}min)`);
    }

    _startLoop() {
        this._running = true;
        this._loop();
    }

    async _loop() {
        while (this._running) {
            try {
                await this.assess();
            } catch (e) {
                console.warn(`[${this.name}] Assessment error:`, e.message);
            }
            await new Promise(r => setTimeout(r, this.config.assessmentIntervalMs));
        }
    }

    // ═══════════════════════════════════════════
    // MAIN ASSESSMENT CYCLE
    // ═══════════════════════════════════════════

    async assess() {
        const activeCount = this.goalPlanner?.activeGoals?.size || 0;
        console.log(`[${this.name}] 🔍 Assessment cycle (${activeCount} active goals)`);

        // 1. Curiosity → Learning goals (highest priority — always check)
        await this.processCuriosityQueue();

        // 2. Self-inspection (hourly — SOMA looks at herself)
        if (this._shouldSelfInspect()) {
            await this.selfInspect();
        }

        // 3. Nemesis performance gap analysis (every 6 hours — fix weak reasoning)
        if (this._shouldNemesisGapCheck()) {
            await this.nemesisGapAnalysis();
        }

        // 4. Knowledge synthesis (every 12 hours — connect dots across memories)
        if (this._shouldKnowledgeSynth()) {
            await this.synthesizeKnowledge();
        }

        // 5. Nutrient-poor detection (every cycle — ensure cognitive substrate is balanced)
        await this.checkLibraryNutrients();

        // 6. GitHub discovery scan (every 6 hours — find interesting code)
        if (this._shouldGithubScan()) {
            await this.githubDiscoveryScan();
        }

        // 6. AI-proposed strategic goals (when goal queue is light)
        if (activeCount < this.config.maxActiveGoals) {
            await this.proposeStrategicGoal();
        }

        // 6. Maintenance — clean up stale goals
        await this.cleanupJunkGoals();
    }

    // ═══════════════════════════════════════════
    // CURIOSITY → LEARNING GOALS
    // ═══════════════════════════════════════════
    // When SOMA encounters something she doesn't know in conversation,
    // CuriosityExtractor adds it to the queue. We turn high-priority
    // items into concrete research goals.

    async processCuriosityQueue() {
        if (!this.curiosityEngine || !this.goalPlanner) return;

        const queue = this.curiosityEngine.curiosityQueue || [];
        const highPriority = queue
            .filter(q => (q.priority || 0) > 0.55)
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .slice(0, this.config.maxCuriosityGoalsPerCycle);

        for (const item of highPriority) {
            const topic = item.topic || item.question || item;
            if (!topic || typeof topic !== 'string') continue;

            // Don't create if already have a research goal for this topic
            const existing = this._findActiveGoalByKeyword(topic.split(' ').slice(0, 3).join(' '));
            if (existing) continue;

            const created = await this.goalPlanner.createGoal({
                type: 'operational',
                category: 'learning',
                title: `Research: ${topic.substring(0, 60)}`,
                description: `Knowledge gap detected from conversation. Research "${topic}" thoroughly: find key concepts, practical applications, and connections to SOMA's existing capabilities. Store all findings to long-term memory. Identify 3 follow-up questions.`,
                priority: Math.min(90, Math.round((item.priority || 0.6) * 100) + 20),
                confidence: 0.92,
                rationale: `High-priority curiosity gap: "${item.question || topic}"`,
                metadata: {
                    source: 'curiosity_engine',
                    topic,
                    originalQuestion: item.question,
                    fromConversation: true
                }
            }, 'autonomous');

            if (created?.success) {
                this.stats.curiosityGoals++;
                console.log(`[${this.name}] 🔍 Curiosity goal created: "${topic}"`);

                // Remove from curiosity queue so it doesn't keep spawning
                const idx = queue.indexOf(item);
                if (idx > -1) queue.splice(idx, 1);
            }
        }
    }

    // ═══════════════════════════════════════════
    // SELF-INSPECTION
    // ═══════════════════════════════════════════
    // SOMA looks at her own folder, reads what's there, and uses QuadBrain
    // to decide what's missing, broken, or could be improved.
    // This is the core recursive self-improvement loop.

    async selfInspect() {
        if (!this.brain) return;
        this.stats.selfInspections++;
        this._lastSelfInspect = Date.now();
        console.log(`[${this.name}] 🔬 Running self-inspection...`);

        try {
            // Gather self-knowledge
            const [arbiterFiles, coreFiles] = await Promise.all([
                fs.readdir(path.join(ROOT_PATH, 'arbiters')).catch(() => []),
                fs.readdir(path.join(ROOT_PATH, 'core')).catch(() => [])
            ]);

            // Graphify manifest integration to look beyond arbiters and core
            let graphifyFiles = [];
            try {
                const manifestPath = path.join(ROOT_PATH, 'graphify-out', 'manifest.json');
                const manifestData = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
                graphifyFiles = Object.keys(manifestData);
                console.log(`[${this.name}] 🧬 Graphify manifest query loaded ${graphifyFiles.length} tracked files.`);
            } catch (err) {
                console.warn(`[${this.name}] ⚠️ Failed to load Graphify manifest:`, err.message);
            }

            const loadedSystems = this.system
                ? Object.keys(this.system).filter(k => {
                    const key = k.toLowerCase();
                    return this.system[k] && typeof this.system[k] === 'object' &&
                      ['arbiter', 'engine', 'cortex', 'registry', 'daemon', 'service', 'brain']
                        .some(kind => key.includes(kind));
                  })
                : [];

            const pathBasename = (p) => path.basename(p, path.extname(p));
            
            const manifestArbiters = graphifyFiles
                .filter(f => f.toLowerCase().includes('arbiters') && (f.endsWith('.js') || f.endsWith('.cjs')))
                .map(p => pathBasename(p));
            const manifestDaemons = graphifyFiles
                .filter(f => f.toLowerCase().includes('daemons') && (f.endsWith('.js') || f.endsWith('.cjs')))
                .map(p => pathBasename(p));
            const manifestServices = graphifyFiles
                .filter(f => f.toLowerCase().includes('services') && (f.endsWith('.js') || f.endsWith('.cjs')))
                .map(p => pathBasename(p));

            const isLoaded = (name) => {
                const normalized = name.toLowerCase().replace(/arbiter|engine|daemon|service|cortex/gi, '');
                return loadedSystems.some(la => 
                    la.toLowerCase().replace(/arbiter|engine|daemon|service|cortex/gi, '') === normalized
                );
            };

            const unloadedArbiters = [
                ...new Set([
                    ...arbiterFiles.filter(f => f.endsWith('.js') || f.endsWith('.cjs')).map(f => f.replace(/\.(js|cjs)$/, '')),
                    ...manifestArbiters
                ])
            ].filter(name => !isLoaded(name)).slice(0, 25);

            const unloadedDaemons = manifestDaemons.filter(name => !isLoaded(name)).slice(0, 25);
            const unloadedServices = manifestServices.filter(name => !isLoaded(name)).slice(0, 25);

            // 🧬 Sovereign Assembly: Autonomously integrate dormant arbiters
            if (this.ace && unloadedArbiters.length > 0) {
                const targetArbiter = unloadedArbiters[0];
                console.log(`[${this.name}] 🧬 Sovereign Assembly: Attempting to integrate ${targetArbiter}...`);
                
                const integration = await this.ace.integrateDormantCapability(targetArbiter, this.system);
                
                if (integration.success) {
                    await this.memory?.remember?.(
                        `Autonomous Capability Expansion (ACE): Successfully integrated ${targetArbiter} into active CNS.`,
                        { type: 'capability_expansion', importance: 9 }
                    ).catch(() => {});
                    return;
                } else {
                    // 🚨 SELF-HEALING PROTOCOL: Trigger Emergency Repair
                    console.warn(`[${this.name}] 🚨 Integration FAILED for ${targetArbiter}. Triggering Self-Healing Protocol...`);
                    
                    if (this.goalPlanner) {
                        const repairGoal = await this.goalPlanner.createGoal({
                            type: 'operational',
                            category: 'self_repair',
                            title: `Emergency Repair: ${targetArbiter}`,
                            description: `The system failed to integrate the dormant capability "${targetArbiter}" due to a crash or syntax error. 

ERROR: ${integration.error}
FILE: ${integration.filePath}

TASK: Use the Engineering Swarm to analyze the file, identify the bug or missing dependency, and rewrite it so it can be safely loaded. Verify the fix with a syntax check before completing.`,
                            priority: 95, // Critical priority
                            confidence: 0.9,
                            assignedTo: ['EngineeringSwarmArbiter'],
                            metadata: {
                                source: 'ace_self_healing',
                                targetArbiter,
                                error: integration.error,
                                stack: integration.stack,
                                filePath: integration.filePath
                            }
                        }, 'emergency_protocol');

                        if (repairGoal?.success) {
                            console.log(`[${this.name}] 🛠️  Emergency Repair goal dispatched for ${targetArbiter}.`);
                        }
                    }
                    return; // End cycle to allow repair to complete
                }
            }

            const activeGoalTitles = [];
            for (const id of (this.goalPlanner?.activeGoals || new Set())) {
                const g = this.goalPlanner.goals?.get(id);
                if (g) activeGoalTitles.push(g.title);
            }

            // Recent memory context
            let recentInsights = '';
            try {
                const mem = await this.memory?.recall?.('SOMA self improvement capability', 3);
                const hits = (mem?.results || []).slice(0, 3);
                if (hits.length) recentInsights = hits.map(h => `• ${h.content?.substring(0, 100)}`).join('\n');
            } catch {}

            const prompt = `You are SOMA's self-inspection system. You are looking at your own architecture and capabilities.

LOADED SYSTEMS (${loadedSystems.length}):
${loadedSystems.slice(0, 30).join(', ')}

UNLOADED ARBITERS ON DISK (${unloadedArbiters.length}):
${unloadedArbiters.join(', ')}

UNLOADED DAEMONS ON DISK (${unloadedDaemons.length}):
${unloadedDaemons.join(', ')}

UNLOADED SERVICES ON DISK (${unloadedServices.length}):
${unloadedServices.join(', ')}

CORE FILES:
${coreFiles.filter(f => f.endsWith('.js')).slice(0, 20).join(', ')}

CURRENT ACTIVE GOALS:
${activeGoalTitles.length > 0 ? activeGoalTitles.join('\n') : 'None'}

RECENT INSIGHTS FROM MEMORY:
${recentInsights || 'None yet'}

SOMA's mission: Become a self-evolving ASI. She can research topics, create new tools, read/write code, browse GitHub, and load new arbiters.

Look at the gap between what's loaded and what's available on disk. Consider:
- Is there an unloaded arbiter, daemon, or service that would genuinely improve SOMA's capabilities?
- Is there a capability SOMA clearly lacks (web search, voice, vision, external APIs)?
- Is there something in the loaded systems that seems broken or underutilized?
- What would make the biggest difference to SOMA's autonomy and intelligence?

Identify ONE high-value improvement opportunity.

Respond with EXACTLY:
FINDING: <what you noticed about yourself>
GAP: <what capability or improvement is missing>
GOAL_TITLE: <concise title for a goal to address this>
GOAL_DESCRIPTION: <specific steps to achieve it>
PRIORITY: <60-90>
STORE_MEMORY: <key insight to remember about this finding>`;

            const result = await this.brain.reason(prompt, { temperature: 0.5, quickResponse: false });
            const text = result?.text || '';

            const goalTitle = text.match(/GOAL_TITLE:\s*(.+)/i)?.[1]?.trim();
            const goalDesc = text.match(/GOAL_DESCRIPTION:\s*([\s\S]+?)(?=\nPRIORITY:|$)/i)?.[1]?.trim();
            const finding = text.match(/FINDING:\s*(.+)/i)?.[1]?.trim();
            const gap = text.match(/GAP:\s*(.+)/i)?.[1]?.trim();
            const priority = parseInt(text.match(/PRIORITY:\s*(\d+)/i)?.[1] || '70');
            const memNote = text.match(/STORE_MEMORY:\s*(.+)/i)?.[1]?.trim();

            if (goalTitle && goalDesc) {
                const created = await this.goalPlanner.createGoal({
                    type: 'operational',
                    category: 'improvement',
                    title: goalTitle,
                    description: goalDesc,
                    priority,
                    confidence: 0.8,
                    rationale: `Self-inspection: ${finding || 'capability gap identified'}. Gap: ${gap || 'see description'}`,
                    metadata: {
                        source: 'self_inspection',
                        finding,
                        gap
                    }
                }, 'autonomous');

                if (created?.success) {
                    console.log(`[${this.name}] 🔬 Self-inspection goal: "${goalTitle}"`);
                    this.stats.goalsProposed++;
                }
            }

            // Store the finding to memory
            if (memNote) {
                await this.memory?.remember?.(
                    `Self-inspection finding: ${memNote}`,
                    { type: 'self_inspection', importance: 7 }
                ).catch(() => {});
            }

        } catch (e) {
            console.warn(`[${this.name}] Self-inspection error:`, e.message);
        }
    }

    // ═══════════════════════════════════════════
    // GITHUB DISCOVERY SCAN
    // ═══════════════════════════════════════════
    // SOMA searches GitHub for interesting code, evaluates it,
    // and creates goals to test/integrate promising findings.

    async githubDiscoveryScan() {
        if (!this.brain || !this.config.githubEnabled) return;
        this.stats.githubScans++;
        this._lastGithubScan = Date.now();
        console.log(`[${this.name}] 🐙 GitHub discovery scan...`);

        try {
            const loadedSystems = this.system
                ? Object.keys(this.system).filter(k =>
                    this.system[k] && typeof this.system[k] === 'object')
                : [];

            const prompt = `You are SOMA's technology discovery system. Your goal is to find valuable code or libraries on GitHub that could enhance SOMA's capabilities.

SOMA's current capabilities include:
${loadedSystems.slice(0, 20).join(', ')}

SOMA is an autonomous AI system built in Node.js with a modular arbiter architecture. She currently can:
- Have conversations via Gemini/Ollama LLMs
- Remember things across sessions (SQLite + vector memory)
- Autonomously work on goals
- Track curiosity gaps from conversations
- Create new tools via ToolCreatorArbiter

Think about what would make SOMA MORE autonomous and capable. What kind of code from GitHub would be worth exploring?

Consider areas like:
- Autonomous web browsing/scraping
- Real-time data feeds (news, market data, social media)
- Computer vision / image understanding
- Voice synthesis / speech recognition
- Robotic control interfaces
- New reasoning techniques
- Embedding models that run locally
- Browser automation (Puppeteer, Playwright)

Propose ONE specific GitHub search or repository to investigate.

Respond with EXACTLY:
SEARCH_QUERY: <GitHub search terms>
WHY: <why this would help SOMA>
GOAL_TITLE: <title for a goal to investigate this>
GOAL_DESCRIPTION: <what to do — search GitHub, evaluate the repo, decide if worth integrating>
PRIORITY: <50-80>`;

            const result = await this.brain.reason(prompt, { temperature: 0.7, quickResponse: false });
            const text = result?.text || '';

            const searchQuery = text.match(/SEARCH_QUERY:\s*(.+)/i)?.[1]?.trim();
            const why = text.match(/WHY:\s*(.+)/i)?.[1]?.trim();
            const goalTitle = text.match(/GOAL_TITLE:\s*(.+)/i)?.[1]?.trim();
            const goalDesc = text.match(/GOAL_DESCRIPTION:\s*([\s\S]+?)(?=\nPRIORITY:|$)/i)?.[1]?.trim();
            const priority = parseInt(text.match(/PRIORITY:\s*(\d+)/i)?.[1] || '60');

            if (goalTitle && searchQuery) {
                const fullDesc = `${goalDesc || ''}\n\nGitHub search: "${searchQuery}"\nRationale: ${why || 'Capability enhancement'}`;

                const created = await this.goalPlanner.createGoal({
                    type: 'operational',
                    category: 'research',
                    title: goalTitle,
                    description: fullDesc.trim(),
                    priority,
                    confidence: 0.7,
                    rationale: `GitHub discovery: ${why || searchQuery}`,
                    metadata: {
                        source: 'github_discovery',
                        searchQuery,
                        why
                    }
                }, 'autonomous');

                if (created?.success) {
                    console.log(`[${this.name}] 🐙 GitHub goal created: "${goalTitle}" (search: ${searchQuery})`);
                    this.stats.goalsProposed++;
                }
            }

        } catch (e) {
            console.warn(`[${this.name}] GitHub scan error:`, e.message);
        }
    }

    // ═══════════════════════════════════════════
    // AI-PROPOSED STRATEGIC GOALS
    // ═══════════════════════════════════════════
    // When the goal queue is light, ask QuadBrain to think about
    // what SOMA should work on next. Uses current state as context.

    async proposeStrategicGoal() {
        if (!this.brain || !this.goalPlanner) return;

        const activeGoalTitles = [];
        for (const id of (this.goalPlanner?.activeGoals || new Set())) {
            const g = this.goalPlanner.goals?.get(id);
            if (g) activeGoalTitles.push(`• ${g.title} (${g.metrics?.progress || 0}%)`);
        }

        // Pull recent memory for context
        let recentMemory = '';
        try {
            const mem = await this.memory?.recall?.('SOMA capability goal improvement', 4);
            const hits = (mem?.results || []).slice(0, 3);
            if (hits.length) recentMemory = hits.map(h => `• ${h.content?.substring(0, 120)}`).join('\n');
        } catch {}

        const loadedSystems = this.system
            ? Object.keys(this.system)
                .filter(k => this.system[k] && typeof this.system[k] === 'object' &&
                    (k.includes('Arbiter') || k.includes('Engine') || k.includes('Planner') || k.includes('Registry')))
                .slice(0, 20)
            : [];

        const prompt = `You are SOMA's strategic planning mind. SOMA is an autonomous AI system working toward ASI-level capabilities.

SOMA's loaded systems:
${loadedSystems.join(', ')}

Currently active goals:
${activeGoalTitles.length > 0 ? activeGoalTitles.join('\n') : 'None — SOMA needs direction'}

Recent insights from memory:
${recentMemory || 'No recent memory context'}

SOMA can:
- Research any topic using her reasoning + memory
- Create new tools/arbiters via ToolCreatorArbiter
- Read and analyze code and files
- Store findings to long-term memory for future use
- Learn from every conversation and experience

What should SOMA work on next? Think about what would most advance her toward:
1. Greater autonomy (doing useful things without being asked)
2. Better self-knowledge (understanding her own capabilities and gaps)
3. Real-world capability (connecting to APIs, data sources, or physical systems)
4. Deeper intelligence (better reasoning, memory, or learning)

Propose ONE concrete, achievable goal. Make it specific enough that QuadBrain can make real progress in a single work session.

Respond with EXACTLY:
TITLE: <concise goal title — max 70 chars>
CATEGORY: <learning|capability|improvement|research|integration>
DESCRIPTION: <what to do, why, and first concrete step>
RATIONALE: <why this goal is crucial for SOMA's evolution right now in 1 sentence>
PRIORITY: <50-85>
TIMEFRAME: <hours|days|weeks>`;

        try {
            const result = await this.brain.reason(prompt, { temperature: 0.65, quickResponse: false });
            const text = result?.text || '';

            const title = text.match(/TITLE:\s*(.+)/i)?.[1]?.trim();
            const category = (text.match(/CATEGORY:\s*(.+)/i)?.[1]?.trim() || 'research').toLowerCase();
            const description = text.match(/DESCRIPTION:\s*([\s\S]+?)(?=\nRATIONALE:|\nPRIORITY:|$)/i)?.[1]?.trim();
            const rationale = text.match(/RATIONALE:\s*(.+)/i)?.[1]?.trim() || 'Proposed by SelfEvolvingGoalEngine strategic planning';
            const priority = parseInt(text.match(/PRIORITY:\s*(\d+)/i)?.[1] || '65');

            if (!title || !description) return;

            // Don't propose duplicate
            const existing = this._findActiveGoalByKeyword(title.split(' ').slice(0, 4).join(' '));
            if (existing) return;

            const created = await this.goalPlanner.createGoal({
                type: 'operational',
                category,
                title,
                description,
                priority,
                confidence: 0.78,
                rationale,
                metadata: {
                    source: 'self_evolution',
                    proposedBy: 'SelfEvolvingGoalEngine'
                }
            }, 'autonomous');

            if (created?.success) {
                this.stats.goalsProposed++;
                console.log(`[${this.name}] 🧬 Strategic goal proposed: "${title}"`);

                // Store to memory so we don't keep proposing same things
                await this.memory?.remember?.(
                    `Strategic goal created: "${title}" — ${description?.substring(0, 100)}`,
                    { type: 'goal_proposed', importance: 5 }
                ).catch(() => {});
            }

        } catch (e) {
            console.warn(`[${this.name}] Strategic goal proposal error:`, e.message);
        }
    }

    // ═══════════════════════════════════════════
    // GOAL MAINTENANCE
    // ═══════════════════════════════════════════

    async cleanupJunkGoals() {
        if (!this.goalPlanner) return;

        let cleaned = 0;
        const seenTitles = new Map(); // title → goalId

        for (const [id, goal] of (this.goalPlanner.goals || new Map())) {
            if (goal.status === 'completed' || goal.status === 'failed') continue;

            // Deduplicate: same title, same category → cancel the older one
            const key = `${goal.category}::${goal.title.toLowerCase().trim()}`;
            if (seenTitles.has(key)) {
                // Cancel the older duplicate
                const keepId = seenTitles.get(key);
                const keepGoal = this.goalPlanner.goals.get(keepId);
                const cancelId = (keepGoal?.createdAt || 0) < (goal.createdAt || 0) ? keepId : id;
                await this.goalPlanner.cancelGoal?.(cancelId, 'duplicate').catch(() => {});
                seenTitles.set(key, cancelId === keepId ? id : keepId);
                cleaned++;
                continue;
            }
            seenTitles.set(key, id);

            // Cancel goals assigned to clearly non-existent arbiters with 0 progress
            if (goal.assignedTo?.length > 0 && (goal.metrics?.progress || 0) === 0) {
                const ghostArbiters = ['KnowledgeDiscoveryWorker', 'WebScraperDendrite',
                    'EngineeringSwarmArbiter', 'EdgeWorkerOrchestrator', 'LearningVelocityTracker',
                    'ArchivistArbiter', 'SemanticRouterArbiter', 'EmbeddingWorker'];
                const allGhosts = goal.assignedTo.every(a => ghostArbiters.includes(a));
                if (allGhosts) {
                    // Clear assignedTo so the heartbeat can work on it instead
                    goal.assignedTo = [];
                    goal.tasks = [];
                }
            }
        }

        if (cleaned > 0) {
            this.stats.junkCleaned += cleaned;
            console.log(`[${this.name}] 🧹 Cleaned ${cleaned} duplicate/junk goals`);
        }
    }

    // ═══════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════

    async checkLibraryNutrients() {
        if (!this.goalPlanner) return;

        const lobes = ['logos', 'aurora', 'prometheus', 'thalamus'];
        const THRESHOLD = 10;
        const currentRoot = process.cwd();

        for (const lobe of lobes) {
            try {
                const dir = path.join(currentRoot, 'knowledge', lobe, 'yumyums');
                const files = await fs.readdir(dir).catch(() => []);
                const count = files.filter(f => f.endsWith('.md')).length;

                if (count < THRESHOLD) {
                    const goalTitle = `Sovereign Synthesis: Enrich ${lobe.toUpperCase()} substrate`;
                    
                    // Don't duplicate
                    if (this._findActiveGoalByKeyword(`Enrich ${lobe.toUpperCase()}`)) continue;

                    console.log(`[${this.name}] 🌱 Lobe ${lobe} is nutrient-poor (${count}/${THRESHOLD}). Spawning synthesis goal.`);

                    await this.goalPlanner.createGoal({
                        type: 'operational',
                        category: 'improvement',
                        title: goalTitle,
                        description: `The ${lobe.toUpperCase()} cognitive substrate is starving (${count}/${THRESHOLD} nutrients). 
TASK: Analyze recent system experiences and successful outcomes. Synthesize a new, high-signal "YumYum" nutrient (Markdown) for the ${lobe.toUpperCase()} library.
Focus on: High-level philosophy, architectural rationale, or strategic principles.
File the result into: knowledge/${lobe}/yumyums/`,
                        priority: 75,
                        confidence: 0.9,
                        metadata: { source: 'nutrient_monitor', lobe }
                    }, 'autonomous');
                }
            } catch (e) {
                console.warn(`[${this.name}] Nutrient check failed for ${lobe}:`, e.message);
            }
        }
    }

    _findActiveGoalByKeyword(keyword) {
        if (!this.goalPlanner || !keyword) return null;
        const words = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        for (const id of (this.goalPlanner.activeGoals || new Set())) {
            const g = this.goalPlanner.goals?.get(id);
            if (!g) continue;
            const titleWords = g.title.toLowerCase();
            const matchCount = words.filter(w => titleWords.includes(w)).length;
            if (matchCount >= Math.ceil(words.length * 0.6)) return g;
        }
        return null;
    }

    _shouldSelfInspect() {
        return (Date.now() - this._lastSelfInspect) > this.config.selfInspectIntervalMs;
    }

    _shouldGithubScan() {
        const githubIntervalMs = 6 * 60 * 60 * 1000; // Every 6 hours
        return (Date.now() - this._lastGithubScan) > githubIntervalMs;
    }

    _shouldNemesisGapCheck() {
        return (Date.now() - this._lastNemesisGap) > this.config.nemesisGapIntervalMs;
    }

    _shouldKnowledgeSynth() {
        const interval = 12 * 60 * 60 * 1000; // Every 12 hours
        return (Date.now() - this._lastKnowledgeSynth) > interval;
    }

    // ═══════════════════════════════════════════════════════════
    // KNOWLEDGE SYNTHESIS — turn stored memories into new insights
    // ═══════════════════════════════════════════════════════════
    // Looks at recent memories across domains, asks the brain to find
    // non-obvious connections, stores new insights back to memory.
    // This is what turns a library into research.
    // ═══════════════════════════════════════════════════════════

    async synthesizeKnowledge() {
        if (!this.brain || !this.memory) return;
        this._lastKnowledgeSynth = Date.now();

        try {
            // Pull a sample of recent memories across different topics
            let memories = [];
            if (this.memory.getRecentMemories) {
                memories = this.memory.getRecentMemories(48) || []; // last 48h
            } else if (this.memory.recall) {
                const r = await this.memory.recall('knowledge insight learning', 20);
                memories = r?.results || (Array.isArray(r) ? r : []);
            }

            if (!memories || !Array.isArray(memories) || memories.length < 5) {
                console.log(`[${this.name}] 💭 Knowledge synthesis: not enough memories yet (${memories?.length || 0} < 5)`);
                return;
            }

            // Sample up to 15 memories — enough for cross-domain synthesis, not overwhelming
            const sample = [...memories]
                .sort(() => Math.random() - 0.5)
                .slice(0, 15)
                .map(m => (m.content || m).toString().substring(0, 200));

            const synthPrompt = `You are SOMA's knowledge synthesis engine. Your job is to find NON-OBVIOUS connections and generate novel insights by combining memories from different domains.

RECENT MEMORIES (sample):
${sample.map((m, i) => `${i + 1}. ${m}`).join('\n')}

TASK:
1. Find 2-3 cross-domain connections that aren't obvious from any single memory
2. Generate a novel hypothesis or insight that emerges from combining them
3. Identify one actionable implication for SOMA's development

Respond in this format:
CONNECTIONS: [brief description of cross-domain links found]
INSIGHT: [the novel synthesized insight — one paragraph]
IMPLICATION: [one specific actionable thing this suggests SOMA should do or learn]`;

            const result = await this.brain.reason(synthPrompt, {
                quickResponse: false,
                source: 'knowledge_synthesis',
                context: { isInternalProcess: true }
            }).catch(() => null);

            if (!result?.text || result.text.length < 50) return;

            // Store the synthesized insight to memory at high importance
            const insightText = `[Knowledge Synthesis] ${result.text.substring(0, 600)}`;
            await this.memory.remember?.(insightText, {
                type: 'synthesized_insight',
                importance: 8,
                source: 'knowledge_synthesis',
                memoriesUsed: sample.length
            }).catch(() => {});

            // Extract implication and create a goal if it's actionable
            const implicationMatch = result.text.match(/IMPLICATION:\s*(.+?)(?:\n|$)/i);
            if (implicationMatch?.[1]) {
                const implication = implicationMatch[1].trim();
                if (implication.length > 20 && !this._findActiveGoalByKeyword(implication.split(' ').slice(0, 3).join(' '))) {
                    await this.goalPlanner?.createGoal({
                        title: `Explore synthesis insight: ${implication.substring(0, 80)}`,
                        description: `Knowledge synthesis identified this actionable implication:\n${implication}\n\nFull synthesis:\n${result.text.substring(0, 400)}`,
                        category: 'knowledge_synthesis',
                        priority: 60,
                        source: 'knowledge_synthesis',
                        metadata: { source: 'knowledge_synthesis' }
                    }).catch(() => {});
                    this.stats.goalsProposed++;
                }
            }

            console.log(`[${this.name}] 💡 Knowledge synthesis complete — insight stored (${sample.length} memories → new connection)`);

        } catch (e) {
            console.warn(`[${this.name}] Knowledge synthesis error:`, e.message);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // NEMESIS GAP ANALYSIS — close the recursive self-improvement loop
    // ═══════════════════════════════════════════════════════════
    // Flow: Nemesis scores (persisted) → identify weak brain/domain →
    //       create engineering goal → AgenticExecutor finds root cause →
    //       Steve's EngineeringSwarm writes fix → re-measure
    // ═══════════════════════════════════════════════════════════

    async nemesisGapAnalysis() {
        if (!this.nemesis?.getWeakAreas) return;
        this._lastNemesisGap = Date.now();

        try {
            const weakAreas = this.nemesis.getWeakAreas(7); // last 7 days
            if (!weakAreas?.length) {
                console.log(`[${this.name}] ✅ Nemesis gap check: no weak areas detected (score history too short or all passing)`);
                return;
            }

            // Focus on the worst performer with enough data to be meaningful
            const worst = weakAreas.find(a => a.avg_score < this.config.nemesisWeakThreshold);
            if (!worst) {
                console.log(`[${this.name}] ✅ Nemesis gap check: all brains scoring above threshold (${this.config.nemesisWeakThreshold})`);
                return;
            }

            const goalTitle = `Improve ${worst.brain} reasoning — Nemesis avg ${worst.avg_score} (${worst.eval_count} evals)`;

            // Don't create duplicate improvement goals
            if (this._findActiveGoalByKeyword(`Improve ${worst.brain}`)) {
                console.log(`[${this.name}] ⏭️ Improvement goal for ${worst.brain} already active`);
                return;
            }

            console.log(`[${this.name}] 🔴 Nemesis gap detected: ${worst.brain} avg=${worst.avg_score} revisions=${worst.revisions}/${worst.eval_count}`);

                                                            // Deterministic Experiment Worker: Require a reproducible failing test target
            const benchmarkTest = worst.failingTest || 'test/benchmark.test.js';
            const targetFilePath = worst.targetFile || 'arbiters/SOMArbiterV3.js';

            // Build improvement goal - Deterministic trial specification
            const description = [
                `Nemesis performance gap:  brain has avg score  over  evaluations in the last 7 days.`,
                ` responses required forced revision.`,
                `Min score: . Target File: `,
                ``,
                `DETERMINISTIC EXPERIMENT STEPS:`,
                `1. Run benchmark test: `,
                `2. Extract exact failed assertion or deficiency in `,
                `3. Apply concrete code patch to  (modifyCode / EngineeringSwarmArbiter)`,
                `4. Re-run  + regression suite to verify FAIL -> PASS flip`,
                `5. Promote measured gain to scoreboard only when test passes`,
                `NOTE: Markdown diagnostic reports without code patches will be rejected.`
            ].join(`\n`);

            const goal = await this.goalPlanner?.createGoal({
                title: goalTitle,
                description,
                category: 'self_improvement',
                priority: 85,
                source: 'nemesis_gap_analysis',
                assignedTo: ['EngineeringSwarmArbiter', 'SomaAgenticExecutor'],
                metadata: {
                    weakBrain: worst.brain,
                    avgScore: worst.avg_score,
                    evalCount: worst.eval_count,
                    revisions: worst.revisions,
                    filePath: targetFilePath,
                    benchmarkTests: [benchmarkTest],
                    requireCodePatch: true,
                    selfEvolution: true,
                    source: 'nemesis_gap_analysis'
                }
            });

            if (goal) {
                this.stats.goalsProposed++;
                console.log(`[${this.name}] 🎯 Self-improvement goal created: "${goalTitle}"`);

                // Store finding to memory so SOMA knows she's working on this
                await this.memory?.remember?.(
                    `Nemesis detected weak reasoning in ${worst.brain} (avg score ${worst.avg_score}). Created self-improvement goal to investigate and fix.`,
                    { type: 'nemesis_gap', importance: 8, brain: worst.brain }
                ).catch(() => {});
            }

        } catch (e) {
            console.warn(`[${this.name}] Nemesis gap analysis error:`, e.message);
        }
    }

    getStats() {
        return {
            ...this.stats,
            running: this._running,
            nextAssessmentIn: this.config.assessmentIntervalMs,
            lastSelfInspect: this._lastSelfInspect
                ? new Date(this._lastSelfInspect).toISOString() : 'never',
            lastGithubScan: this._lastGithubScan
                ? new Date(this._lastGithubScan).toISOString() : 'never',
            lastNemesisGap: this._lastNemesisGap
                ? new Date(this._lastNemesisGap).toISOString() : 'never',
            lastKnowledgeSynth: this._lastKnowledgeSynth
                ? new Date(this._lastKnowledgeSynth).toISOString() : 'never'
        };
    }

    stop() {
        this._running = false;
    }
}
