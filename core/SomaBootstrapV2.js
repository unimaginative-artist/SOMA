/**
 * core/SomaBootstrapV2.js
 *
 * The Modular Orchestrator for SOMA Level 4.5.
 * Unifies "Phases" Restructuring with ULTRA Full Capability.
 */

import { loadCoreSystems } from '../server/loaders/core.js';
import { loadCognitiveSystems } from '../server/loaders/cognitive.js';
import { loadAgents } from '../server/loaders/agents.js';
import { loadTools } from '../server/loaders/tools.js';
import { loadPlugins } from '../server/loaders/plugins.js';
import { loadRoutes } from '../server/loaders/routes.js';
import { setupWebSocket } from '../server/loaders/websocket.js';
import { loadLimbicSystem } from '../server/loaders/limbic.js';
import { loadTradingSafety } from '../server/loaders/trading-safety.js';
import { loadEssentialSystems, loadExtendedSystems } from '../server/loaders/extended.js';
import { loadPersonas } from '../server/loaders/personas.js';
import { loadCOSSystems } from '../server/loaders/cos.js';
import { BrainBridge } from '../server/BrainBridge.js';
import { registry } from '../server/SystemRegistry.js';
import { SomaAgenticExecutor } from './SomaAgenticExecutor.js';
import { wireSelfModificationRuntime } from './SelfModificationRuntime.js';
import { ExpertiseRegistry } from './ExpertiseRegistry.js';
import { ComputerControlArbiter } from '../arbiters/ComputerControlArbiter.js';
import { ASTIndexerService } from '../server/services/ASTIndexerService.js';
import { VectorSearchService } from '../server/services/VectorSearchService.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const AutonomousHeartbeat = require('../server/services/AutonomousHeartbeat.cjs');

export class SomaBootstrapV2 {
    constructor() {
        this.system = { ready: false };
    }

    async initialize(app, server, wss) {
        console.log('\n[SOMA V2] 🚀 Initiating Modular Bootstrap Sequence...');

        try {
            // PHASE 0: Core Safety & Security
            const core = await loadCoreSystems();
            Object.assign(this.system, core);

            await this._wireComputerControlRuntime(this.system);

            // Start Neural Discovery Scan (Non-blocking)
            if (this.system.messageBroker) {
                this.system.messageBroker.scanForUnusedArbiters().catch(e => console.warn('Discovery scan failed:', e.message));
            }

            // PHASE 1: Reflex & Operational Tools (MUST LOAD FIRST for toolRegistry)
            const toolRegistry = await loadTools(this.system);
            this.system.toolRegistry = toolRegistry;

            // PHASE 2: Cognitive Engine (Brain & Memory) - now with toolRegistry
            registry.markLoading('QuadBrain');
            const cognitive = await loadCognitiveSystems(toolRegistry);
            Object.assign(this.system, cognitive);
            if (this.system.executiveCortex && this.system.computerControl && !this.system.executiveCortex.computerControl) {
                this.system.executiveCortex.computerControl = this.system.computerControl;
            }
            if (this.system.quadBrain) registry.markReady('QuadBrain');
            if (this.system.mnemonicArbiter) registry.markReady('Memory');
            if (this.system.knowledgeGraph) registry.markReady('KnowledgeGraph');

            // PHASE 2.1: Wrap QuadBrain in BrainBridge
            if (this.system.quadBrain) {
                const bridge = new BrainBridge(this.system.quadBrain);
                this.system.quadBrain = bridge;
                registry.markLoading('BrainWorker');
                
                // Register/override brain instances in the message broker
                if (this.system.messageBroker) {
                    this.system.messageBroker.registerArbiter('SomaBrain', {
                        instance: bridge,
                        role: 'core',
                        version: bridge.version
                    });
                    this.system.messageBroker.registerArbiter('QuadBrain', {
                        instance: bridge,
                        role: 'core',
                        version: bridge.version
                    });
                    this.system.messageBroker.registerArbiter('SOMArbiter', {
                        instance: bridge,
                        role: 'core',
                        version: bridge.version
                    });
                }

                // Get tools manifest to pass to worker
                const toolsManifest = this.system.toolRegistry?.getToolsManifest() || [];

                // Start worker non-blocking
                bridge.startWorker({ toolsManifest })
                    .then(() => registry.markReady('BrainWorker'))
                    .catch(err => {
                        registry.markFailed('BrainWorker', err);
                        console.warn('[SOMA V2] BrainWorker failed to start, using direct brain:', err.message);
                    });
                console.log('[SOMA V2] BrainBridge active — worker starting in background');
            }

            // PHASE 2.3: Cognitive Operating System (COS) - CNS & Perception
            const cos = await loadCOSSystems(this.system);
            Object.assign(this.system, cos);

            // PHASE 2.5: Limbic System (Body & Soul)
            const limbic = await loadLimbicSystem(this.system);
            Object.assign(this.system, limbic);

            // PHASE 3: Specialized Agents
            const agents = await loadAgents(this.system);
            Object.assign(this.system, agents);

            // PHASE 3.5: Identity & Persona Library
            // Must load before API routes so /api/identity/personas is not an empty shell.
            try {
                const identity = await loadPersonas(this.system);
                Object.assign(this.system, identity);
            } catch (identityError) {
                console.error('[SOMA V2] ⚠️ Identity/persona loading error (non-fatal):', identityError.message);
            }

            // PHASE 4: Plugins (Finance, Social, Swarm)
            const plugins = await loadPlugins(this.system);
            Object.assign(this.system, plugins);

            // PHASE 4.5: Trading Safety (RiskManager, Guardrails, PositionGuardian)
            const tradingSafety = await loadTradingSafety(this.system);
            Object.assign(this.system, tradingSafety);

            // PHASE 5: WebSocket & Telemetry (MOVED UP - needed for dashboard)
            const wsSystem = setupWebSocket(server, wss, this.system);
            this.system.ws = wsSystem;

            await this._wireSelfModificationRuntime(this.system);
            await this._wireAutonomyRuntime(this.system);
            await this._wireExpertiseRuntime(this.system);
            await this._wireASTIndexer(this.system);

            // Wire dashboard WebSocket clients into the Guardian (now that WS is ready)
            if (tradingSafety.guardian && wsSystem.dashboardClients) {
                tradingSafety.guardian.dashboardClients = wsSystem.dashboardClients;
            }

            // PHASE 6: API Routes
            try {
                await loadRoutes(app, this.system);
            } catch (routeError) {
                console.error('[SOMA V2] ⚠️ Route loading error (non-fatal):', routeError.message);
            }

            // PHASE 6.5: ASI Hardening (Atomic Parallel Awakening)
            // Removed await to prevent event-loop deadlocks during boot
            this._loadHardenedASI(this.system);

            // Ensure ToolRegistry always has live system reference
            if (this.system.toolRegistry) {
                this.system.toolRegistry.__system = this.system;
            }

            // ═══ MARK SYSTEM READY ═══
            this.system.ready = true;
            console.log('\n[SOMA V2] ✅ CORE ONLINE - Dashboard & API Ready');

            return this.system;

        } catch (error) {
            console.error('\n[SOMA V2] ❌ CRITICAL BOOTSTRAP FAILURE:', error);
            throw error;
        }
    }

    async _wireComputerControlRuntime(system) {
        if (system.computerControl) return;

        if (!(system.arbiters instanceof Map)) {
            system.arbiters = new Map();
        }

        const computerControl = new ComputerControlArbiter({
            name: 'ComputerControlArbiter',
            messageBroker: system.messageBroker,
            safetyEnabled: true
        });

        if (typeof computerControl.initialize === 'function') {
            await computerControl.initialize();
        }

        system.computerControl = computerControl;
        system.arbiters.set('ComputerControlArbiter', computerControl);
        system.arbiters.set('computerControl', computerControl);

        if (system.messageBroker?.registerArbiter) {
            system.messageBroker.registerArbiter('ComputerControlArbiter', {
                instance: computerControl,
                role: 'implementer',
                lobe: 'motor_cortex',
                classification: 'computer_control',
                capabilities: ComputerControlArbiter.capabilities
            });
        }

        console.log('[SOMA V2] ✅ ComputerControlArbiter wired — Puppeteer, screen capture, mouse and keyboard tools available');
    }

    /**
     * ASI Hardening: Multi-Tier Awakening
     * Backgrounded to prevent blocking port binding and dashboard responsiveness.
     */
    _loadHardenedASI(system) {
        // Kick off the awakening in a separate async context (Fire and Forget)
        (async () => {
            try {
                console.log('[SOMA V2] 🧠 Initiating ASI Hardening sequence (Background)...');

                // Tier 1: Learning, Fragments, Provenance
                await loadEssentialSystems(system);
                console.log('[SOMA V2] ✅ Tier 1 ASI Core Online');

                // Tier 2: Extended Specialists
                if (process.env.SOMA_LOAD_EXTENDED !== 'false') {
                    console.log('[SOMA V2] 🔄 Loading extended arbiters (Tier 2)...');
                    const extended = await loadExtendedSystems(system);
                    for (const [key, value] of Object.entries(extended)) {
                        if (value != null && !system[key]) {
                            system[key] = value;
                        }
                    }
                    console.log('[SOMA V2] ✅ Tier 2 Specialists Online');
                }

                console.log('[SOMA V2] 🔱 ASI Capability Layer: FULLY SYNCHRONIZED');
            } catch (e) {
                console.error('[SOMA V2] ❌ ASI Hardening background failure:', e.message);
            }
        })();
    }

    async _wireAutonomyRuntime(system) {
        if (!system.agenticExecutor) {
            const maxIterations = parseInt(process.env.SOMA_AGENTIC_MAX_ITERATIONS || '15', 10);
            const executor = new SomaAgenticExecutor({
                maxIterations: Number.isFinite(maxIterations) ? maxIterations : 15
            });
            executor.initialize({
                brain: system.quadBrain,
                memory: system.mnemonicArbiter || system.mnemonic,
                goalPlanner: system.goalPlanner,
                system,
                pool: system.microAgentPool || system.agentPool || null
            });
            system.agenticExecutor = executor;
            console.log('[SOMA V2] ✅ SomaAgenticExecutor wired — goals can use real tools');
        }

        // Wire brain into GoalPlannerArbiter so it can decompose complex goals
        if (system.goalPlanner?.setBrain && system.quadBrain) {
            system.goalPlanner.setBrain(system.quadBrain);
        }

        if (!system.autonomousHeartbeat) {
            const intervalMs = parseInt(process.env.SOMA_HEARTBEAT_INTERVAL_MS || `${2 * 60 * 1000}`, 10);
            const heartbeat = new AutonomousHeartbeat(system, {
                intervalMs: Number.isFinite(intervalMs) ? intervalMs : 2 * 60 * 1000,
                enabled: process.env.SOMA_AUTOPILOT !== 'false',
                logger: console
            });
            await heartbeat.initialize();
            system.autonomousHeartbeat = heartbeat;
            system.drive = heartbeat.drive;
            console.log(`[SOMA V2] ✅ AutonomousHeartbeat wired — autopilot ${heartbeat.isRunning ? 'running' : 'ready'}`);
        }
    }

    async _wireSelfModificationRuntime(system) {
        wireSelfModificationRuntime(system);
    }

    async _wireExpertiseRuntime(system) {
        if (system.expertiseRegistry) return;

        const expertiseRegistry = new ExpertiseRegistry({
            system,
            rootPath: process.cwd(),
            logger: console
        });
        await expertiseRegistry.initialize();
        system.expertiseRegistry = expertiseRegistry;
        console.log(`[SOMA V2] ✅ ExpertiseRegistry wired — ${expertiseRegistry.list().length} manifest(s), lazy-load enabled`);
    }

    async _wireASTIndexer(system) {
        if (system.astIndexer) return;

        const astIndexer = new ASTIndexerService();
        astIndexer.initialize();
        system.astIndexer = astIndexer;

        const vectorSearch = new VectorSearchService(process.cwd());
        vectorSearch.initialize().then(() => {
            const indexOnBoot = String(process.env.SOMA_VECTOR_INDEX_ON_BOOT || 'false').toLowerCase() === 'true';
            if (!indexOnBoot) {
                console.log('[SOMA V2] VectorSearchService ready; semantic indexing deferred (set SOMA_VECTOR_INDEX_ON_BOOT=true to run at boot)');
                return;
            }
            setTimeout(() => {
                vectorSearch.startIndexing().catch(e => {
                    console.warn('[SOMA V2] Vector semantic indexing failed:', e.message);
                });
            }, Number(process.env.SOMA_VECTOR_INDEX_DELAY_MS || 60000));
        });
        system.vectorSearch = vectorSearch;

        // Kick off indexing asynchronously (non-blocking)
        astIndexer.startIndexing().catch(e => {
            console.warn('[SOMA V2] AST indexing background run failed:', e.message);
        });

        console.log('[SOMA V2] ✅ ASTIndexerService and VectorSearchService wired - indexing running in background');
    }

    async _loadEssentialBackground(system) {
        try {
            console.log('[SOMA V2] 🧠 Loading essential ASI arbiters (Tier 1)...');
            const essential = await loadEssentialSystems(system);
            // Don't Object.assign — loadEssentialSystems already wires onto system directly
            console.log('[SOMA V2] ✅ ESSENTIAL ASI ARBITERS ONLINE — Learning pipeline active');
        } catch (e) {
            console.error('[SOMA V2] ⚠️ Essential systems error (non-fatal):', e.message);
        }
    }

    async _loadExtendedBackground(system) {
        try {
            console.log('[SOMA V2] 🔄 Loading extended arbiters (Tier 2)...');
            const extended = await loadExtendedSystems(system);
            // Safe merge: only assign non-null values that don't overwrite existing system refs
            // (Tier 1 already wires fragmentRegistry, personalityForge, etc. — don't clobber them)
            for (const [key, value] of Object.entries(extended)) {
                if (value != null && !system[key]) {
                    system[key] = value;
                }
            }
            console.log('[SOMA V2] ✅ ALL EXTENDED ARBITERS LOADED');
        } catch (e) {
            console.error('[SOMA V2] ⚠️ Extended systems error (non-fatal):', e.message);
        }
    }
}

export default SomaBootstrapV2;
