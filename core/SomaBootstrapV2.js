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
import { loadCOSSystems } from '../server/loaders/cos.js';
import { BrainBridge } from '../server/BrainBridge.js';
import { registry } from '../server/SystemRegistry.js';

export class SomaBootstrapV2 {
    constructor() {
        this.system = { ready: false };
    }

    async initialize(app, server, wss) {
        console.log('\n[SOMA V2] 🚀 Initiating Modular Bootstrap Sequence...');

        try {
            // PHASE 0: Core Safety & Security
            const core = await loadCoreSystems();
            this.system = { ...this.system, ...core };

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
            this.system = { ...this.system, ...cognitive };
            if (this.system.quadBrain) registry.markReady('QuadBrain');
            if (this.system.mnemonicArbiter) registry.markReady('Memory');
            if (this.system.knowledgeGraph) registry.markReady('KnowledgeGraph');

            // PHASE 2.1: Wrap QuadBrain in BrainBridge
            if (this.system.quadBrain) {
                const bridge = new BrainBridge(this.system.quadBrain);
                this.system.quadBrain = bridge;
                registry.markLoading('BrainWorker');
                
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
            this.system = { ...this.system, ...cos };

            // PHASE 2.5: Limbic System (Body & Soul)
            const limbic = await loadLimbicSystem(this.system);
            this.system = { ...this.system, ...limbic };

            // PHASE 3: Specialized Agents
            const agents = await loadAgents(this.system);
            this.system = { ...this.system, ...agents };

            // PHASE 4: Plugins (Finance, Social, Swarm)
            const plugins = await loadPlugins(this.system);
            this.system = { ...this.system, ...plugins };

            // PHASE 4.5: Trading Safety (RiskManager, Guardrails, PositionGuardian)
            const tradingSafety = await loadTradingSafety(this.system);
            this.system = { ...this.system, ...tradingSafety };

            // PHASE 5: WebSocket & Telemetry (MOVED UP - needed for dashboard)
            const wsSystem = setupWebSocket(server, wss, this.system);
            this.system.ws = wsSystem;

            // Wire dashboard WebSocket clients into the Guardian (now that WS is ready)
            if (tradingSafety.guardian && wsSystem.dashboardClients) {
                tradingSafety.guardian.dashboardClients = wsSystem.dashboardClients;
            }

            // PHASE 6: API Routes
            try {
                await loadRoutes(app, this.system);
            } catch (routeError) {
                console.error('[SOMA V2] ⚠️ Route loading error (non-fatal):', routeError.message);
                console.error('[SOMA V2] Core health/status endpoints still active');
            }

            // Ensure ToolRegistry always has live system reference
            if (this.system.toolRegistry) {
                this.system.toolRegistry.__system = this.system;
            }

            // ═══ MARK SYSTEM READY ═══
            // Dashboard, WebSocket, and all routes are now live.
            // Extended arbiters load in the background below.
            this.system.ready = true;
            console.log('\n[SOMA V2] ✅ CORE ONLINE - Dashboard & API Ready');

            // PHASE 4.1: Essential ASI Arbiters (loads 60s after boot)
            // ~12 core learning/fragment/memory arbiters. Light enough to not block event loop.
            // These power the learning pipeline, fragment brains, and curiosity systems.
            setTimeout(() => this._loadEssentialBackground(this.system), 60000);

            // PHASE 4.2: Extended Specialist Arbiters (loads 90s after boot)
            // Loads heartbeat, identity/personas, skills, tool creator, agentic systems, etc.
            // Default ON. Set SOMA_LOAD_EXTENDED=false to disable.
            if (process.env.SOMA_LOAD_EXTENDED !== 'false') {
                setTimeout(() => this._loadExtendedBackground(this.system), 90000);
            } else {
                console.log('[SOMA V2] Extended arbiters disabled (SOMA_LOAD_EXTENDED=false)');
            }

            // NOTE: Persona loading is handled by loadExtendedSystems (Phase G).
            // No separate Phase 7 needed.

            return this.system;

        } catch (error) {
            console.error('\n[SOMA V2] ❌ CRITICAL BOOTSTRAP FAILURE:', error);
            throw error;
        }
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
