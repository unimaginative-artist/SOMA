/**
 * server/loaders/extended.js
 *
 * PHASE 4.1: Extended Specialist Arbiters
 * Activates ~40 high-impact arbiters that were sitting on disk unused.
 * Organized into 8 boot phases by dependency order.
 * Each wrapped in try/catch — one failure never crashes the boot.
 */

import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ──────────────────────────────────────────
// PHASE A: Infrastructure (no dependencies)
// ──────────────────────────────────────────
import OutcomeTracker from '../../arbiters/OutcomeTracker.js';
import ExperienceReplayBuffer from '../../arbiters/ExperienceReplayBuffer.js';
import { PortfolioOptimizer } from '../../arbiters/PortfolioOptimizer.js';
import { QueryComplexityClassifier } from '../../arbiters/QueryComplexityClassifier.js';
import { EconomicCalendar } from '../../arbiters/EconomicCalendar.js';
import { MarketRegimeDetector } from '../../arbiters/MarketRegimeDetector.js';
import { FragmentRegistry } from '../../arbiters/FragmentRegistry.js';
import MnemonicIndexerArbiter from '../../arbiters/MnemonicIndexerArbiter.js';
import CapabilityRegistry from '../../core/CapabilityRegistry.js';
const HybridSearchArbiter = require('../../arbiters/HybridSearchArbiter.cjs');
const TimekeeperArbiter = require('../../arbiters/TimekeeperArbiter.cjs');
const GoalPlannerArbiter = require('../../arbiters/GoalPlannerArbiter.cjs');
const DriveArbiter = require('../../arbiters/DriveArbiter.cjs');
const SelfModificationArbiter = require('../../arbiters/SelfModificationArbiter.cjs');

// Phase 1-3: User identity + Soul
const soul        = require('../../arbiters/SoulArbiter.cjs');
const fingerprint = require('../../arbiters/UserFingerprintArbiter.cjs');

// ──────────────────────────────────────────
// PHASE B: Core Specialists (use system.quadBrain, etc.)
// ──────────────────────────────────────────
import { ReasoningChamber } from '../../arbiters/ReasoningChamber.js';
import { DevilsAdvocateArbiter } from '../../arbiters/DevilsAdvocateArbiter.js';
import { ForecasterArbiter } from '../../arbiters/ForecasterArbiter.js';
import { ToolCreatorArbiter } from '../../arbiters/ToolCreatorArbiter.js';
import { SentimentAggregator } from '../../arbiters/SentimentAggregator.js';
import { GistArbiter } from '../../arbiters/GistArbiter.js';
import { CodeObservationArbiter } from '../../arbiters/CodeObservationArbiter.js';

// ──────────────────────────────────────────
// PHASE C: Cognitive Enhancement
// ──────────────────────────────────────────
import { HippocampusArbiter } from '../../arbiters/HippocampusArbiter.js';
import { MetaCortexArbiter } from '../../arbiters/MetaCortexArbiter.js';
import { AbstractionArbiter } from '../../arbiters/AbstractionArbiter.js';
import { KnowledgeAugmentedGenerator } from '../../arbiters/KnowledgeAugmentedGenerator.js';

// ──────────────────────────────────────────
// PHASE D: Trading Complex Systems
// ──────────────────────────────────────────
import { MultiTimeframeAnalyzer } from '../../arbiters/MultiTimeframeAnalyzer.js';
import { AdversarialDebate } from '../../arbiters/AdversarialDebate.js';
import { TradeLearningEngine } from '../../arbiters/TradeLearningEngine.js';
import { BacktestEngine } from '../../arbiters/BacktestEngine.js';
import { SmartOrderRouter } from '../../arbiters/SmartOrderRouter.js';
import { AdaptivePositionSizer } from '../../arbiters/AdaptivePositionSizer.js';
import StrategyOptimizer from '../../arbiters/StrategyOptimizer.js';
import { RedditSignalDetector } from '../../arbiters/RedditSignalDetector.js';

// ──────────────────────────────────────────
// PHASE E: Learning & Self-Improvement
// ──────────────────────────────────────────
import { UniversalLearningPipeline } from '../../arbiters/UniversalLearningPipeline.js';
import { CuriosityEngine } from '../../arbiters/CuriosityEngine.js';
import AdaptiveLearningPlanner from '../../arbiters/AdaptiveLearningPlanner.js';
import { HindsightReplayArbiter } from '../../arbiters/HindsightReplayArbiter.js';
import { SelfImprovementCoordinator } from '../../arbiters/SelfImprovementCoordinator.js';
import { CriticAlignmentService } from '../../arbiters/CriticAlignmentService.js';
import { PerformanceOracle } from '../../arbiters/PerformanceOracle.js';

// ──────────────────────────────────────────
// PHASE F: Knowledge & Research
// ──────────────────────────────────────────
import { FragmentCommunicationHub } from '../../arbiters/FragmentCommunicationHub.js';
const { BraveSearchAdapter } = require('../../cognitive/BraveSearchAdapter.cjs');
import { IdeaCaptureArbiter } from '../../arbiters/IdeaCaptureArbiter.js';
import { ConversationCuriosityExtractor } from '../../arbiters/ConversationCuriosityExtractor.js';
import CuriosityWebAccessConnector from '../../arbiters/CuriosityWebAccessConnector.js';

// ──────────────────────────────────────────
// PHASE G: Identity & Context
// ──────────────────────────────────────────
import { PersonalityForgeArbiter } from '../../arbiters/PersonalityForgeArbiter.js';
const TheoryOfMindArbiter = require('../../arbiters/TheoryOfMindArbiter.cjs');
import { UserProfileArbiter } from '../../arbiters/UserProfileArbiter.js';
import { ContextManagerArbiter } from '../../arbiters/ContextManagerArbiter.js';
import { MoltbookArbiter } from '../../arbiters/MoltbookArbiter.js';
import { SocialAutonomyArbiter } from '../../arbiters/SocialAutonomyArbiter.js';
import { loadPersonas } from './personas.js';

// ──────────────────────────────────────────
// NEMESIS: Adversarial quality review
// ──────────────────────────────────────────
import { NemesisReviewSystem } from '../../cognitive/prometheus/NemesisReviewSystem.js';

// ──────────────────────────────────────────
// PHASE H2: Autonomous Orchestration
// ──────────────────────────────────────────
import { NighttimeLearningOrchestrator } from '../../core/NighttimeLearningOrchestrator.js';
import { SelfEvolvingGoalEngine } from '../../core/SelfEvolvingGoalEngine.js';
import { SomaAgenticExecutor } from '../../core/SomaAgenticExecutor.js';
import { OllamaAutoTrainer } from '../../core/OllamaAutoTrainer.js';
import { ReportingArbiter } from '../../arbiters/ReportingArbiter.js';

// ──────────────────────────────────────────
// AGENTIC CONTROL: Eyes, Hands, Browser, Shell
// ──────────────────────────────────────────
import { ComputerControlArbiter } from '../../arbiters/ComputerControlArbiter.js';
import { VisionProcessingArbiter } from '../../arbiters/VisionProcessingArbiter.js';
import { VirtualShell } from '../../arbiters/VirtualShell.js';

// ──────────────────────────────────────────
// ENGINEERING SWARM: Self-modification + Optimization
// ──────────────────────────────────────────
import { EngineeringSwarmArbiter } from '../../arbiters/EngineeringSwarmArbiter.js';
import { SwarmOptimizer } from '../../arbiters/SwarmOptimizer.js';
import { DiscoverySwarm } from '../../arbiters/DiscoverySwarm.js';
import { ProactiveCouncilArbiter } from '../../arbiters/ProactiveCouncilArbiter.js';

// ──────────────────────────────────────────
// PHASE H3: ASI Intelligence Loop + Arbiter Inventory
// ──────────────────────────────────────────
import { ArbiterLoader } from '../../core/ArbiterLoader.js';

// ──────────────────────────────────────────
// (original H3 label kept below for clarity)
// PHASE H3: ASI Intelligence Loop
// Measure → Identify bottleneck → Transfer cross-domain wins → Generate goal → Verify
// ──────────────────────────────────────────
import { CapabilityBenchmark } from '../../core/CapabilityBenchmark.js';
import { LongHorizonPlanner } from '../../core/LongHorizonPlanner.js';
import { TransferSynthesizer } from '../../core/TransferSynthesizer.js';
import { ConstitutionalCore } from '../../core/ConstitutionalCore.js';
import { ASIKernel } from '../../core/ASIKernel.js';

// ──────────────────────────────────────────
// SECURITY COMMAND: Kevin + IdolSenturian
// ──────────────────────────────────────────
import { KevinArbiter } from '../../arbiters/KevinArbiter.js';
import { IdolSenturianArbiter } from '../../arbiters/IdolSenturianArbiter.js';

// ──────────────────────────────────────────
// PARALLEL WORKFORCE: MicroAgentPool
// ──────────────────────────────────────────
const { MicroAgentPool } = require('../../microagents/MicroAgentPool.cjs');
const LocalModelManager = (() => { try { return require('../../arbiters/LocalModelManager.cjs'); } catch(e) { console.warn('[extended] LocalModelManager load failed:', e.message); return null; } })();
const EdgeWorkerOrchestrator = (() => { try { return require('../../arbiters/EdgeWorkerOrchestrator.cjs'); } catch(e) { console.warn('[extended] EdgeWorkerOrchestrator load failed:', e.message); return null; } })();

// ──────────────────────────────────────────
// NETWORK IDENTITY: ThalamusArbiter
// ──────────────────────────────────────────
import { ThalamusArbiter } from '../../arbiters/ThalamusArbiter.js';
// AutonomousHeartbeat is a CJS module (.js in ESM package). We load it by
// pointing createRequire at its own directory so Node resolves it as CJS.
// .cjs extension forces CJS loading even in an "type":"module" package
const AutonomousHeartbeat = (() => { try { return require('../services/AutonomousHeartbeat.cjs'); } catch(e) { console.warn('[extended] AutonomousHeartbeat load failed:', e.message); return null; } })();

// ──────────────────────────────────────────
// PHASE I: Self-Awareness & Autonomy
// ──────────────────────────────────────────
import { RecursiveSelfModel } from '../../arbiters/RecursiveSelfModel.js';
import { SelfCodeInspector } from '../../arbiters/SelfCodeInspector.js';
import { SelfDrivenCuriosityConnector } from '../../arbiters/SelfDrivenCuriosityConnector.js';
import { AutonomousCapabilityExpansion } from '../../arbiters/AutonomousCapabilityExpansion.js';
import { DeploymentArbiter } from '../../arbiters/DeploymentArbiter.js';
import { MetaLearningEngine } from '../../arbiters/MetaLearningEngine.js';
import { SkillWatcherArbiter } from '../../arbiters/SkillWatcherArbiter.js';
import { TrainingDataExporter } from '../../arbiters/TrainingDataExporter.js';
import { ConversationHistoryArbiter } from '../../arbiters/ConversationHistoryArbiter.js';
import { EnrichmentArbiter } from '../../arbiters/EnrichmentArbiter.js';
import { ReflexArbiter } from '../../arbiters/ReflexArbiter.js';
import { ReflexScoutArbiter } from '../../arbiters/ReflexScoutArbiter.js';

const rootPath = process.cwd();

const SAFE_LOAD_TIMEOUT_MS = 10000; // 10 seconds max — short timeouts cause zombie background inits that eat memory

// Yield the event loop between arbiter loads so HTTP requests can be served.
// setImmediate fires AFTER pending I/O callbacks — a proper event loop tick.
// setTimeout only waits a time interval and doesn't yield to pending I/O.
async function yieldEventLoop() {
    await new Promise(resolve => setImmediate(resolve));
}

// Memory ceiling — skip non-essential arbiters if heap exceeds this.
// Machine has 15.74 GB RAM, Node heap set to 4096MB — 2500MB ceiling is safe.
const HEAP_CEILING_MB = process.env.SOMA_HEAP_CEILING_MB
    ? parseInt(process.env.SOMA_HEAP_CEILING_MB, 10)
    : 2500;

async function safeLoad(name, factory, options = {}) {
    // Memory guard FIRST — skip immediately without waiting if over ceiling
    const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
    if (heapMB > HEAP_CEILING_MB) {
        console.warn(`    ⚠️ ${name} skipped: heap at ${heapMB.toFixed(0)}MB (ceiling: ${HEAP_CEILING_MB}MB)`);
        return null;
    }

    // Only yield if we're actually going to load
    await yieldEventLoop();

    const memBefore = process.memoryUsage().heapUsed;
    try {
        const timeoutMs = options.timeoutMs || SAFE_LOAD_TIMEOUT_MS;
        const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`initialization timed out after ${timeoutMs / 1000}s`)), timeoutMs)
        );

        const load = async () => {
            const instance = await factory();
            // Skip init if already active (some arbiters self-initialize in constructor)
            const alreadyActive = instance?.status === 'active' || instance?.initialized === true || instance?.ready === true;
            if (!alreadyActive) {
                if (instance && typeof instance.initialize === 'function') {
                    await instance.initialize();
                } else if (instance && typeof instance.onInitialize === 'function') {
                    await instance.onInitialize();
                } else if (instance && typeof instance.onActivate === 'function') {
                    await instance.onActivate();
                }
            }
            return instance;
        };

        const instance = await Promise.race([load(), timeout]);
        const memDelta = ((process.memoryUsage().heapUsed - memBefore) / 1024 / 1024).toFixed(1);
        const totalMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
        console.log(`    ✅ ${name} (+${memDelta}MB, heap: ${totalMB}MB)`);
        return instance;
    } catch (e) {
        const rootCause = e.context?.cause?.message || e.cause?.message;
        const msg = rootCause ? `${e.message} (cause: ${rootCause})` : e.message;
        console.warn(`    ⚠️ ${name} skipped: ${msg}`);
        return null;
    }
}

// ═══════════════════════════════════════════
// TIER 1: Essential ASI arbiters (learning, fragments, memory)
// Loads 60s after boot. ~12 arbiters. Light enough to not kill event loop.
// ═══════════════════════════════════════════
export async function loadEssentialSystems(system) {
    console.log('\n[Essential] ═══ Loading ASI Core (Learning + Fragments) ═══');
    const ext = {};

    // OutcomeTracker (reuse from early boot)
    if (system.outcomeTracker) {
        ext.outcomeTracker = system.outcomeTracker;
        console.log('    ✅ OutcomeTracker (reusing from early boot)');
    } else {
        ext.outcomeTracker = await safeLoad('OutcomeTracker', () =>
            new OutcomeTracker({ storageDir: path.join(rootPath, 'data', 'outcomes'), maxInMemory: 10000, enablePersistence: true })
        );
    }

    ext.experienceReplay = await safeLoad('ExperienceReplayBuffer', () =>
        new ExperienceReplayBuffer({ maxSize: 10000, name: 'ExperienceReplay' })
    );

    ext.queryClassifier = await safeLoad('QueryComplexityClassifier', () =>
        new QueryComplexityClassifier()
    );

    ext.fragmentRegistry = await safeLoad('FragmentRegistry', () =>
        new FragmentRegistry({ messageBroker: system.messageBroker })
    );

    ext.learningPipeline = await safeLoad('UniversalLearningPipeline', () =>
        new UniversalLearningPipeline({
            name: 'UniversalLearningPipeline',
            messageBroker: system.messageBroker,
            // Inject shared instances — prevents duplicate timers and zombie OutcomeTrackers
            outcomeTracker: ext.outcomeTracker,
            experienceBuffer: ext.experienceReplay
        })
    );

    ext.curiosityEngine = await safeLoad('CuriosityEngine', () =>
        new CuriosityEngine({
            knowledgeGraph: system.knowledgeGraph,
            messageBroker: system.messageBroker,
            simulationArbiter: system.simulation,
            worldModel: system.worldModel,
            fragmentRegistry: ext.fragmentRegistry || system.fragmentRegistry
        })
    );

    ext.curiosityExtractor = await safeLoad('ConversationCuriosityExtractor', () =>
        new ConversationCuriosityExtractor({
            curiosityEngine: ext.curiosityEngine,
            quadBrain: system.quadBrain
        })
    );

    ext.personalityForge = await safeLoad('PersonalityForgeArbiter', () =>
        new PersonalityForgeArbiter({
            quadBrain: system.quadBrain,
            messageBroker: system.messageBroker
        })
    );

    ext.theoryOfMind = await safeLoad('TheoryOfMindArbiter', () =>
        new TheoryOfMindArbiter('TheoryOfMindArbiter', {
            userProfilePath: path.join(rootPath, 'data', 'user-profiles')
        })
    );

    ext.moltbook = await safeLoad('MoltbookArbiter', () =>
        new MoltbookArbiter({
            messageBroker: system.messageBroker,
            securityCouncil: system.securityCouncil || system.immuneCortex
        })
    );

    ext.conversationHistory = await safeLoad('ConversationHistoryArbiter', () => {
        const arb = new ConversationHistoryArbiter({
            dbPath: path.join(rootPath, 'SOMA', 'conversations.db')
        });
        arb._initArbiters = { mnemonic: system.mnemonicArbiter, personalityForge: ext.personalityForge };
        return arb;
    });
    if (ext.conversationHistory && ext.conversationHistory._initArbiters) {
        try {
            await ext.conversationHistory.initialize(ext.conversationHistory._initArbiters);
            delete ext.conversationHistory._initArbiters;
            console.log('    ✅ ConversationHistoryArbiter (DB initialized)');
        } catch (e) {
            console.warn('    ⚠️ ConversationHistory DB init:', e.message);
        }
    }

    ext.trainingDataExporter = await safeLoad('TrainingDataExporter', () =>
        new TrainingDataExporter({
            outputDir: process.env.SOMA_TRAINING_DATA_DIR || path.join(rootPath, 'SOMA', 'training-data')
        })
    );

    // ── Wire essential connections ──
    console.log('\n[Essential] Wiring ASI core connections...');

    if (ext.learningPipeline) {
        if (ext.outcomeTracker) ext.learningPipeline.outcomeTracker = ext.outcomeTracker;
        if (ext.experienceReplay) ext.learningPipeline.experienceReplay = ext.experienceReplay;
        if (system.mnemonicArbiter) ext.learningPipeline.mnemonicArbiter = system.mnemonicArbiter;
        system.learningPipeline = ext.learningPipeline;
        console.log('    🔗 Learning Pipeline → OutcomeTracker + ExperienceReplay + Memory');
    }

    if (ext.curiosityExtractor) {
        system.curiosityExtractor = ext.curiosityExtractor;
        console.log('    🔗 CuriosityExtractor → system');
    }

    if (ext.fragmentRegistry) {
        if (system.quadBrain) system.quadBrain.fragmentRegistry = ext.fragmentRegistry;
        if (ext.learningPipeline) ext.fragmentRegistry.learningPipeline = ext.learningPipeline;
        system.fragmentRegistry = ext.fragmentRegistry;
        console.log('    🔗 FragmentRegistry → QuadBrain + LearningPipeline');
    }

    if (ext.moltbook) { system.moltbook = ext.moltbook; }
    if (ext.personalityForge) { system.personalityForge = ext.personalityForge; }
    if (ext.conversationHistory) { system.conversationHistory = ext.conversationHistory; }
    if (ext.theoryOfMind) { system.theoryOfMind = ext.theoryOfMind; console.log('    🔗 TheoryOfMindArbiter → system.theoryOfMind'); }

    if (ext.trainingDataExporter) {
        ext.trainingDataExporter.conversationHistory = ext.conversationHistory;
        ext.trainingDataExporter.personalityForge = ext.personalityForge;
        ext.trainingDataExporter.mnemonic = system.mnemonicArbiter;
        ext.trainingDataExporter.learningPipeline = ext.learningPipeline;
        console.log('    🔗 TrainingDataExporter ← ConversationHistory, Memory, LearningPipeline');
    }

    // AdaptiveLearningPlanner — feeds into curiosity-driven learning
    ext.learningPlanner = await safeLoad('AdaptiveLearningPlanner', () =>
        new AdaptiveLearningPlanner({
            curiosityEngine: ext.curiosityEngine,
            outcomeTracker: ext.outcomeTracker,
            knowledgeGraph: system.knowledgeGraph,
            messageBroker: system.messageBroker
        })
    );

    // HindsightReplayArbiter — learns from every failure
    ext.hindsightReplay = await safeLoad('HindsightReplayArbiter', () =>
        new HindsightReplayArbiter({
            experienceReplay: ext.experienceReplay,
            outcomeTracker: ext.outcomeTracker
        })
    );

    const loaded = Object.values(ext).filter(v => v !== null).length;
    const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
    console.log(`\n[Essential] ═══ ${loaded} ASI-core arbiters activated (heap: ${heapMB}MB) ═══\n`);
    return ext;
}

// ═══════════════════════════════════════════
// TIER 2: Full extended arbiters (trading, research, self-awareness, etc.)
// Loads 10 min after boot. Non-essential for chat/learning.
// ═══════════════════════════════════════════
export async function loadExtendedSystems(system) {
    console.log('\n[Extended] ═══ Activating Remaining Specialist Arbiters ═══');
    const ext = {};

    // ── ComputerControlArbiter + VisionProcessingArbiter (MOVED TO TOP TO AVOID PERSONA DEADLOCK) ──
    if (process.env.SOMA_LOAD_VISION === 'true') {
        ext.computerControl = await safeLoad('ComputerControlArbiter', async () => {
            const { ComputerControlArbiter } = await import(`../../arbiters/ComputerControlArbiter.js?cb=${Date.now()}`);
            return new ComputerControlArbiter({ name: 'ComputerControl', dryRun: false });
        });
        if (ext.computerControl) {
            system.computerControl = ext.computerControl;
            if (system.arbiters) system.arbiters.set('computerControl', ext.computerControl);
        }

        try {
            ext.visionArbiter = new VisionProcessingArbiter({ name: 'VisionArbiter' });
            system.visionArbiter = ext.visionArbiter;
            if (system.arbiters) system.arbiters.set('visionArbiter', ext.visionArbiter);
            
            ext.visionArbiter.initialize().then(() => {
                console.log('    👁️  VisionProcessingArbiter CLIP model ready');
                if (ext.computerControl) ext.computerControl.visionArbiter = ext.visionArbiter;
            }).catch(e => console.warn('    ⚠️ VisionArbiter CLIP load failed:', e.message));
            console.log('    👁️  VisionProcessingArbiter loading CLIP in background...');
        } catch (e) {
            console.warn(`    ⚠️ VisionProcessingArbiter skipped: ${e.message}`);
            ext.visionArbiter = null;
        }
    } else {
        console.log('    ⏭️ ComputerControlArbiter + VisionProcessingArbiter deferred (set SOMA_LOAD_VISION=true to enable)');
        ext.computerControl = null;
        ext.visionArbiter = null;
    }

    // ═══════════════════════════════════════════
    // PHASE A: Infrastructure (reuse essential tier where available)
    // ═══════════════════════════════════════════
    console.log('\n[Phase A] Infrastructure & Data...');

    // Reuse arbiters already loaded by loadEssentialSystems()
    ext.outcomeTracker = system.outcomeTracker || await safeLoad('OutcomeTracker', () =>
        new OutcomeTracker({ storageDir: path.join(rootPath, 'data', 'outcomes'), maxInMemory: 10000, enablePersistence: true })
    );
    if (ext.outcomeTracker) console.log('    ✅ OutcomeTracker (reused)');

    ext.experienceReplay = system.learningPipeline?.experienceReplay || await safeLoad('ExperienceReplayBuffer', () =>
        new ExperienceReplayBuffer({ maxSize: 10000, name: 'ExperienceReplay' })
    );

    ext.portfolioOptimizer = await safeLoad('PortfolioOptimizer', () =>
        new PortfolioOptimizer({ rootPath })
    );

    ext.queryClassifier = system.queryClassifier || await safeLoad('QueryComplexityClassifier', () =>
        new QueryComplexityClassifier()
    );

    ext.economicCalendar = await safeLoad('EconomicCalendar', () =>
        new EconomicCalendar({ rootPath })
    );

    ext.regimeDetector = await safeLoad('MarketRegimeDetector', () =>
        new MarketRegimeDetector()
    );

    ext.fragmentRegistry = system.fragmentRegistry || await safeLoad('FragmentRegistry', () =>
        new FragmentRegistry({ messageBroker: system.messageBroker })
    );
    if (system.fragmentRegistry) console.log('    ✅ FragmentRegistry (reused from essential)');

    ext.mnemonicIndexer = await safeLoad('MnemonicIndexerArbiter', () =>
        new MnemonicIndexerArbiter({
            mnemonicArbiter: system.mnemonicArbiter,
            storageArbiter: system.storageArbiter || system.storage || null,
            watchPath: process.env.SOMA_INDEX_PATH || process.cwd()
        })
    );

    // HybridSearchArbiter loads LocalEmbedder (all-MiniLM-L6-v2 transformer, ~290MB).
    // Even when it times out at 3s, the model load continues in background and kills the event loop.
    // Only load if explicitly enabled or if memory headroom is generous.
    const heapBeforeHybrid = process.memoryUsage().heapUsed / 1024 / 1024;
    if (process.env.SOMA_HYBRID_SEARCH === 'true' && heapBeforeHybrid < 400) {
        const useHybridWorker = process.env.SOMA_HYBRID_WORKER === 'true';
        ext.hybridSearch = await safeLoad('HybridSearchArbiter', () =>
            new HybridSearchArbiter({ name: 'HybridSearchArbiter', useWorker: useHybridWorker })
        );
    } else {
        console.log(`    ⏭️ HybridSearchArbiter deferred (heap: ${heapBeforeHybrid.toFixed(0)}MB, loads 290MB ML model)`);
        ext.hybridSearch = null;
    }

    ext.timekeeper = await safeLoad('TimekeeperArbiter', () =>
        new TimekeeperArbiter({ name: 'TimekeeperArbiter' })
    );

    // ═══════════════════════════════════════════
    // PHASE B/C: Heavyweight COGNITIVE arbiters (Reasoning, Hippocampus, etc.)
    // These eat 150-250MB combined and block the event loop during init.
    // Only load if explicitly opted in via SOMA_LOAD_HEAVY=true.
    // Chat works fine without them — QuadBrain + Gemini handles everything.
    // ═══════════════════════════════════════════
    const loadHeavyCognitive = process.env.SOMA_LOAD_HEAVY === 'true';
    // Trading pipeline can load independently — much lighter than cognitive heavyweights
    const loadTrading = process.env.SOMA_LOAD_TRADING === 'true' || loadHeavyCognitive;
    if (!loadHeavyCognitive) {
        console.log('\n[Phase B/C] ⏭️ Skipped heavyweight cognitive arbiters (set SOMA_LOAD_HEAVY=true to enable)');
        console.log('    Skipped: ReasoningChamber, DevilsAdvocate, Forecaster, Hippocampus,');
        console.log('    MetaCortex, Abstraction, KnowledgeGenerator');
    }
    if (!loadTrading) {
        console.log('[Phase D] ⏭️ Skipped trading pipeline (set SOMA_LOAD_TRADING=true to enable)');
    }
    if (loadHeavyCognitive) {
    console.log('\n[Phase B] Core Specialists (HEAVYWEIGHT)...');

    ext.reasoning = await safeLoad('ReasoningChamber', () =>
        new ReasoningChamber({
            name: 'ReasoningChamber',
            causalityArbiter: system.causality,
            knowledgeGraph: system.knowledgeGraph,
            mnemonic: system.mnemonicArbiter,
            worldModel: system.worldModel
        })
    );

    ext.devilsAdvocate = await safeLoad('DevilsAdvocateArbiter', () =>
        new DevilsAdvocateArbiter({ name: 'DevilsAdvocate', quadBrain: system.quadBrain, messageBroker: system.messageBroker })
    );

    ext.forecaster = await safeLoad('ForecasterArbiter', () =>
        new ForecasterArbiter({ name: 'Forecaster', quadBrain: system.quadBrain, enrichmentArbiter: system.enrichmentArbiter, worldModel: system.worldModel, messageBroker: system.messageBroker })
    );

    ext.sentimentAggregator = await safeLoad('SentimentAggregator', () =>
        new SentimentAggregator({ quadBrain: system.quadBrain })
    );

    ext.gistArbiter = await safeLoad('GistArbiter', () =>
        new GistArbiter({ name: 'GistArbiter', quadBrain: system.quadBrain })
    );

    ext.codeObserver = await safeLoad('CodeObservationArbiter', () =>
        new CodeObservationArbiter({ rootPath })
    , { timeoutMs: 60000 });

    // ═══════════════════════════════════════════
    // PHASE C: Cognitive Enhancement
    // ═══════════════════════════════════════════
    console.log('\n[Phase C] Cognitive Enhancement...');

    ext.hippocampus = await safeLoad('HippocampusArbiter', () =>
        new HippocampusArbiter({
            mnemonic: system.mnemonicArbiter,
            knowledgeGraph: system.knowledgeGraph,
            messageBroker: system.messageBroker
        })
    , { timeoutMs: 120000 });

    ext.metaCortex = await safeLoad('MetaCortexArbiter', () =>
        new MetaCortexArbiter({
            quadBrain: system.quadBrain,
            messageBroker: system.messageBroker
        })
    );

    ext.abstractionArbiter = await safeLoad('AbstractionArbiter', () =>
        new AbstractionArbiter({
            knowledgeGraph: system.knowledgeGraph,
            worldModel: system.worldModel
        })
    , { timeoutMs: 60000 });

    ext.knowledgeGenerator = await safeLoad('KnowledgeAugmentedGenerator', () =>
        new KnowledgeAugmentedGenerator({
            quadBrain: system.quadBrain,
            knowledgeGraph: system.knowledgeGraph,
            mnemonicArbiter: system.mnemonicArbiter
        })
    );
    } // end if (loadHeavyCognitive) — Phase B/C

    // ═══════════════════════════════════════════
    // PHASE D: Trading Complex Systems
    // Lighter than B/C. Loads with SOMA_LOAD_TRADING=true OR SOMA_LOAD_HEAVY=true.
    // ═══════════════════════════════════════════
    if (loadTrading) {
    console.log('\n[Phase D] Trading Pipeline...');

    ext.mtfAnalyzer = await safeLoad('MultiTimeframeAnalyzer', () =>
        new MultiTimeframeAnalyzer({ regimeDetector: ext.regimeDetector })
    );

    ext.adversarialDebate = await safeLoad('AdversarialDebate', () =>
        new AdversarialDebate({ quadBrain: system.quadBrain, rootPath })
    , { timeoutMs: 60000 });

    ext.tradeLearning = await safeLoad('TradeLearningEngine', () =>
        new TradeLearningEngine({ outcomeTracker: ext.outcomeTracker, rootPath })
    , { timeoutMs: 60000 });

    ext.backtestEngine = await safeLoad('BacktestEngine', () =>
        new BacktestEngine({ quadBrain: system.quadBrain, mtfAnalyzer: ext.mtfAnalyzer, regimeDetector: ext.regimeDetector, rootPath })
    );

    ext.smartOrderRouter = await safeLoad('SmartOrderRouter', () =>
        new SmartOrderRouter({ rootPath })
    , { timeoutMs: 30000 });

    ext.positionSizer = await safeLoad('AdaptivePositionSizer', () =>
        new AdaptivePositionSizer({ rootPath })
    );

    ext.strategyOptimizer = await safeLoad('StrategyOptimizer', () =>
        new StrategyOptimizer({ quadBrain: system.quadBrain, rootPath })
    );

    ext.redditSignals = await safeLoad('RedditSignalDetector', () =>
        new RedditSignalDetector({ quadBrain: system.quadBrain })
    );
    } // end if (loadTrading) — Phase D

    // ═══════════════════════════════════════════
    // PHASE E: Learning & Self-Improvement
    // ═══════════════════════════════════════════
    console.log('\n[Phase E] Learning & Self-Improvement...');

    // Reuse from Tier 1 if available
    if (system.learningPipeline) {
        ext.learningPipeline = system.learningPipeline;
        console.log('    ✅ UniversalLearningPipeline (reused from essential)');
    } else {
        ext.learningPipeline = await safeLoad('UniversalLearningPipeline', () =>
            new UniversalLearningPipeline({
                name: 'UniversalLearningPipeline',
                messageBroker: system.messageBroker,
                outcomeTracker: ext.outcomeTracker,
                experienceBuffer: ext.experienceReplay
            })
        );
    }

    // CuriosityEngine — not directly on system, check via curiosityExtractor
    if (system.curiosityExtractor?.curiosityEngine) {
        ext.curiosityEngine = system.curiosityExtractor.curiosityEngine;
        console.log('    ✅ CuriosityEngine (reused from essential)');
    } else {
        ext.curiosityEngine = await safeLoad('CuriosityEngine', () =>
            new CuriosityEngine({
                knowledgeGraph: system.knowledgeGraph,
                messageBroker: system.messageBroker,
                simulationArbiter: system.simulation,
                worldModel: system.worldModel,
                fragmentRegistry: ext.fragmentRegistry || system.fragmentRegistry
            })
        );
    }

    ext.learningPlanner = await safeLoad('AdaptiveLearningPlanner', () =>
        new AdaptiveLearningPlanner({
            curiosityEngine: ext.curiosityEngine,
            outcomeTracker: ext.outcomeTracker,
            knowledgeGraph: system.knowledgeGraph,
            messageBroker: system.messageBroker
        })
    );

    ext.hindsightReplay = await safeLoad('HindsightReplayArbiter', () =>
        new HindsightReplayArbiter({
            experienceReplay: ext.experienceReplay,
            outcomeTracker: ext.outcomeTracker
        })
    );

    // SelfImprovementCoordinator: the workforce that executes self-improvement goals.
    // Each of its 5 sub-arbiters loads with try/catch — graceful degradation if any fail.
    // NoveltyTracker + SkillAcquisition are lightweight. SelfModification does code analysis.
    // Wire nemesis so SelfModification can evaluate proposed changes before committing.
    ext.selfImprovement = await safeLoad('SelfImprovementCoordinator', () =>
        new SelfImprovementCoordinator({
            quadBrain:    system.quadBrain,
            outcomeTracker: ext.outcomeTracker,
            messageBroker: system.messageBroker,
            nemesis:      system.nemesis       // quality-gate for proposed changes
            // memory omitted — BaseArbiterV4 uses its own TransmitterManager;
            // MnemonicArbiter lacks the stats() method BaseArbiter expects
        })
    , { timeoutMs: 60000 });
    if (ext.selfImprovement) {
        system.selfImprovement = ext.selfImprovement;
        // Wire into SelfEvolvingGoalEngine so improvement goals have an executor
        if (ext.selfEvolvingGoalEngine) ext.selfEvolvingGoalEngine.selfImprovement = ext.selfImprovement;
        console.log('    🔧 SelfImprovementCoordinator ← QuadBrain, Nemesis, Memory (5 sub-arbiters)');
    }

    ext.criticAlignment = await safeLoad('CriticAlignmentService', () =>
        new CriticAlignmentService({
            quadBrain: system.quadBrain
        })
    );

    ext.performanceOracle = await safeLoad('PerformanceOracle', () =>
        new PerformanceOracle({
            quadBrain: system.quadBrain,
            outcomeTracker: ext.outcomeTracker
        })
    );

    // Use existing goalPlanner from cognitive.js if present, otherwise create new
    if (system.goalPlanner && system.goalPlanner.goals) {
        ext.goalPlanner = system.goalPlanner;
        console.log('    ✅ GoalPlannerArbiter (reusing from cognitive.js)');
    } else {
        ext.goalPlanner = await safeLoad('GoalPlannerArbiter', () =>
            new GoalPlannerArbiter({
                name: 'GoalPlannerArbiter',
                maxActiveGoals: 20,
                planningIntervalHours: 6
            })
        );
    }

    // ── DriveArbiter: intrinsic motivation — tension/satisfaction loop ────
    ext.drive = await safeLoad('DriveArbiter', async () => {
        const drive = new DriveArbiter({ name: 'DriveArbiter' });
        await drive.initialize();
        return drive;
    });
    if (ext.drive) system.drive = ext.drive;  // expose to systemState + routes

    // ── SelfModificationArbiter: 4x verification pipeline + MAX forwarding ──
    ext.selfModification = await safeLoad('SelfModificationArbiter', async () => {
        const arbiter = new SelfModificationArbiter({
            name: 'SelfModificationArbiter',
            sandboxMode: false,    // real mode — MAX handles the safety
            requireApproval: true
        });
        await arbiter.initialize();
        if (system.quadBrain) arbiter.setQuadBrain(system.quadBrain);
        return arbiter;
    });

    // ── Soul + UserFingerprint: boot early so they're ready for first chat ──
    await safeLoad('SoulArbiter', async () => {
        soul.initialize();
        system.soul = soul;
        return soul;
    });

    await safeLoad('UserFingerprintArbiter', async () => {
        fingerprint.initialize();
        system.fingerprint = fingerprint;
        return fingerprint;
    });

    // ── ToolCreator + SkillWatcher: Always load (lightweight, critical for self-expansion) ──
    ext.toolCreator = await safeLoad('ToolCreatorArbiter', () =>
        new ToolCreatorArbiter({ name: 'ToolCreator', quadBrain: system.quadBrain, toolRegistry: system.toolRegistry, messageBroker: system.messageBroker })
    );

    ext.skillWatcher = await safeLoad('SkillWatcherArbiter', () =>
        new SkillWatcherArbiter({
            toolRegistry: system.toolRegistry,
            system
        })
    , { timeoutMs: 60000 });

    // ── SomaAgenticExecutor: Moved early (PHASE B) to avoid heap ceiling ──
    // Originally at PHASE G (~line 1105) where heap was already >400MB.
    // GoalPlanner and quadBrain are already available here.
    ext.agenticExecutor = await safeLoad('SomaAgenticExecutor', () => {
        const executor = new SomaAgenticExecutor({ maxIterations: 15, sessionTimeout: 300_000 });
        executor.initialize({
            brain: system.quadBrain,
            memory: system.mnemonicArbiter,
            goalPlanner: ext.goalPlanner || system.goalPlanner,
            system
        });
        system.agenticExecutor = executor;
        return executor;
    });

    // ═══════════════════════════════════════════
    // PHASE F: Knowledge & Research
    // ═══════════════════════════════════════════
    console.log('\n[Phase F] Knowledge & Research...');

    ext.fragmentComms = await safeLoad('FragmentCommunicationHub', () =>
        new FragmentCommunicationHub({
            fragmentRegistry: ext.fragmentRegistry,
            messageBroker: system.messageBroker
        })
    );

    ext.ideaCapture = await safeLoad('IdeaCaptureArbiter', () =>
        new IdeaCaptureArbiter({
            knowledgeGraph: system.knowledgeGraph,
            messageBroker: system.messageBroker
        })
    );

    // BraveSearchAdapter — always load (lightweight HTTP wrapper, 0MB model overhead)
    // Gives SOMA live web access without SOMA_LOAD_HEAVY
    try {
        ext.braveSearch = new BraveSearchAdapter({ maxResults: 5 });
        console.log('    ✅ BraveSearchAdapter (live web search ready)');
    } catch (e) {
        console.log(`    ⏭️ BraveSearchAdapter: ${e.message}`);
        ext.braveSearch = null;
    }

    // Reuse from Tier 1 if available
    if (system.curiosityExtractor) {
        ext.curiosityExtractor = system.curiosityExtractor;
        console.log('    ✅ ConversationCuriosityExtractor (reused from essential)');
    } else {
        ext.curiosityExtractor = await safeLoad('ConversationCuriosityExtractor', () =>
            new ConversationCuriosityExtractor({
                curiosityEngine: ext.curiosityEngine,
                quadBrain: system.quadBrain
            })
        );
    }

    if (process.env.SOMA_LOAD_HEAVY === 'true') {
        ext.webResearcher = await safeLoad('CuriosityWebAccessConnector', () =>
            new CuriosityWebAccessConnector({
                curiosityEngine: ext.curiosityEngine,
                edgeWorker: system.edgeWorker,
                messageBroker: system.messageBroker
            })
        , { timeoutMs: 30000 });
    } else {
        console.log('    ⏭️ CuriosityWebAccessConnector deferred (times out, SOMA_LOAD_HEAVY)');
        ext.webResearcher = null;
    }

    // ═══════════════════════════════════════════
    // PHASE G: Identity & Context
    // ═══════════════════════════════════════════
    console.log('\n[Phase G] Identity & Context...');

    // Reuse from Tier 1 if available
    if (system.personalityForge) {
        ext.personalityForge = system.personalityForge;
        console.log('    ✅ PersonalityForgeArbiter (reused from essential)');
    } else {
        ext.personalityForge = await safeLoad('PersonalityForgeArbiter', () =>
            new PersonalityForgeArbiter({
                quadBrain: system.quadBrain,
                messageBroker: system.messageBroker
            })
        );
    }

    // Reuse from Tier 1 if available
    if (system.moltbook) {
        ext.moltbook = system.moltbook;
        console.log('    ✅ MoltbookArbiter (reused from essential)');
    } else {
        ext.moltbook = await safeLoad('MoltbookArbiter', () =>
            new MoltbookArbiter({
                messageBroker: system.messageBroker,
                securityCouncil: system.securityCouncil || system.immuneCortex
            })
        );
    }

    // ── IdentityArbiter: Load all 464 personas from agents_repo/plugins ──
    ext.identityArbiter = await safeLoad('IdentityArbiter (Personas)', async () => {
        const result = await loadPersonas({
            mnemonicArbiter: system.mnemonicArbiter,
            microAgentPool: system.microAgentPool,
            messageBroker: system.messageBroker
        });
        return result?.identityArbiter || null;
    }, { timeoutMs: 180000 });

    // UserProfile (+322MB zombie), ContextManager (+141MB), SocialAutonomy — heavyweight.
    // Gate behind SOMA_LOAD_HEAVY. Chat and Mission Control work fine without them.
    if (process.env.SOMA_LOAD_HEAVY === 'true') {
        ext.userProfile = await safeLoad('UserProfileArbiter', () =>
            new UserProfileArbiter({
                mnemonicArbiter: system.mnemonicArbiter,
                rootPath
            })
        );

        ext.contextManager = await safeLoad('ContextManagerArbiter', () =>
            new ContextManagerArbiter({
                mnemonicArbiter: system.mnemonicArbiter,
                messageBroker: system.messageBroker
            })
        );

        ext.socialAutonomy = await safeLoad('SocialAutonomyArbiter', () =>
            new SocialAutonomyArbiter({
                moltbook: ext.moltbook,
                quadBrain: system.quadBrain
            })
        );
    } else {
        console.log('    ⏭️ UserProfile, ContextManager, SocialAutonomy deferred (SOMA_LOAD_HEAVY)');
        ext.userProfile = null;
        ext.contextManager = null;
        ext.socialAutonomy = null;
    }

    // ═══════════════════════════════════════════
    // PHASE I: Self-Awareness & Autonomy
    // All of Phase I is heavyweight and non-essential for chat/learning.
    // ConversationHistory and TrainingDataExporter are already loaded in Tier 1.
    // Gate everything behind SOMA_LOAD_HEAVY.
    // ═══════════════════════════════════════════
    if (process.env.SOMA_LOAD_HEAVY === 'true') {
    console.log(`\n[Phase I] Self-Awareness & Autonomy... (heap: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0)}MB)`);

    ext.reflexArbiter = await safeLoad('ReflexArbiter (Von Stratum)', () =>
        new ReflexArbiter()
    );

    ext.deploymentArbiter = await safeLoad('DeploymentArbiter', () =>
        new DeploymentArbiter({
            auditPath: path.join(rootPath, 'SOMA', 'deployment-audit')
        })
    );

    ext.enrichmentArbiter = await safeLoad('EnrichmentArbiter', () =>
        new EnrichmentArbiter({ quadBrain: system.quadBrain })
    );

    ext.autonomousExpansion = await safeLoad('AutonomousCapabilityExpansion', () =>
        new AutonomousCapabilityExpansion({
            quadBrain: system.quadBrain,
            messageBroker: system.messageBroker
        })
    );

    ext.recursiveSelfModel = await safeLoad('RecursiveSelfModel', async () => {
        const rsm = new RecursiveSelfModel({
            messageBroker: system.messageBroker,
            learningPipeline: ext.learningPipeline
        });
        rsm.system = system;
        await rsm.initialize(system);
        rsm.status = 'active'; // prevent safeLoad double-init
        return rsm;
    });

    ext.selfCodeInspector = await safeLoad('SelfCodeInspector', () =>
        new SelfCodeInspector({
            somaRoot: rootPath,
            curiosityEngine: ext.curiosityEngine
        })
    );

    ext.metaLearning = await safeLoad('MetaLearningEngine', () =>
        new MetaLearningEngine({
            learningPipeline: ext.learningPipeline,
            fragmentRegistry: ext.fragmentRegistry,
            messageBroker: system.messageBroker
        })
    );

    ext.selfDrivenCuriosity = await safeLoad('SelfDrivenCuriosityConnector', () =>
        new SelfDrivenCuriosityConnector({
            codeObserver:           ext.codeObserver,
            conversationExtractor:  ext.curiosityExtractor,
            curiosityEngine:        ext.curiosityEngine,
            quadBrain: system.quadBrain,
            selfModel: ext.recursiveSelfModel,
            knowledgeGraph: system.knowledgeGraph,
            messageBroker: system.messageBroker
        })
    , { timeoutMs: 30000 });

    ext.reflexScout = await safeLoad('ReflexScoutArbiter', () =>
        new ReflexScoutArbiter({
            conversationHistory: ext.conversationHistory || system.conversationHistory,
            reflexArbiter: ext.reflexArbiter,
            mnemonic: system.mnemonicArbiter
        })
    );
    } else {
        console.log('\n[Phase I] ⏭️ Skipped self-awareness arbiters (set SOMA_LOAD_HEAVY=true to enable)');
        console.log('    Skipped: ReflexArbiter, DeploymentArbiter, EnrichmentArbiter, RecursiveSelfModel,');
        console.log('    SelfCodeInspector, MetaLearning, SelfDrivenCuriosity, ReflexScout,');
        console.log('    AutonomousCapabilityExpansion');
    }

    // ═══════════════════════════════════════════
    // PHASE H: Wire Cross-System Connections
    // ═══════════════════════════════════════════
    console.log('\n[Phase H] Wiring cross-system connections...');

    // Learning loop: OutcomeTracker → Pipeline → Memory
    if (ext.learningPipeline) {
        if (ext.outcomeTracker) ext.learningPipeline.outcomeTracker = ext.outcomeTracker;
        if (ext.experienceReplay) ext.learningPipeline.experienceReplay = ext.experienceReplay;
        if (system.mnemonicArbiter) ext.learningPipeline.mnemonicArbiter = system.mnemonicArbiter;
        // Expose on system so chat handler can call logInteraction()
        system.learningPipeline = ext.learningPipeline;
        console.log('    🔗 Learning loop: OutcomeTracker → Pipeline → Memory → system.learningPipeline');
    }

    // Curiosity → Learning Planner → Web Research
    if (ext.curiosityEngine && ext.learningPlanner) {
        console.log('    🔗 Curiosity → Learning Planner → Web Research');
    }

    // Curiosity Extractor — expose on system for chat post-processing
    if (ext.curiosityExtractor) {
        system.curiosityExtractor = ext.curiosityExtractor;
        console.log('    🔗 CuriosityExtractor → system.curiosityExtractor');
    }

    // Hippocampus → Mnemonic consolidation
    if (ext.hippocampus && system.mnemonicArbiter) {
        console.log('    🔗 Hippocampus ↔ Mnemonic memory consolidation');
    }

    // Fragment system
    if (ext.fragmentRegistry && ext.fragmentComms) {
        // Wire fragmentComms into QuadBrain so callBrain can trigger multi-fragment synthesis
        if (system.quadBrain) system.quadBrain.fragmentComms = ext.fragmentComms;
        // Wire learningPipeline into fragmentComms for consultation logging
        if (ext.learningPipeline) ext.fragmentComms.learningPipeline = ext.learningPipeline;
        console.log('    🔗 Fragment Registry ↔ Communication Hub ↔ QuadBrain (multi-fragment synthesis ON)');
    }

    // Wire fragment registry into core systems (ensures real fragments are used)
    if (ext.fragmentRegistry) {
        if (system.quadBrain) system.quadBrain.fragmentRegistry = ext.fragmentRegistry;
        if (system.mnemonicArbiter) system.mnemonicArbiter.fragmentRegistry = ext.fragmentRegistry;
        if (ext.performanceOracle) ext.performanceOracle.fragmentRegistry = ext.fragmentRegistry;
        // Give fragments access to learning pipeline so recordFragmentOutcome() can feed back
        if (ext.learningPipeline) ext.fragmentRegistry.learningPipeline = ext.learningPipeline;
        system.fragmentRegistry = ext.fragmentRegistry;
        system.fragmentComms = ext.fragmentComms || null;
        console.log('    🔗 Fragment Registry → QuadBrain/Mnemonic/PerformanceOracle/LearningPipeline');
    }

    // Moltbook + PersonalityForge availability for tools
    if (ext.moltbook) {
        system.moltbook = ext.moltbook;
        console.log('    🔗 MoltbookArbiter → system.moltbook');
    }
    if (ext.personalityForge) {
        system.personalityForge = ext.personalityForge;
        console.log('    🔗 PersonalityForgeArbiter → system.personalityForge');
    }

    // Wire autonomous systems into QuadBrain so it can query them in chat
    if (system.quadBrain) {
        if (ext.goalPlanner) system.quadBrain.goalPlanner = ext.goalPlanner;
        if (ext.codeObserver) system.quadBrain.codeObserver = ext.codeObserver;
        if (ext.curiosityEngine) {
            system.quadBrain.curiosityEngine = ext.curiosityEngine;
            // Give CuriosityEngine brain access so it can enrich search queries
            ext.curiosityEngine.brain = system.quadBrain;
        }
        // Wire complexity classifier so QuadBrain can route SIMPLE → local, COMPLEX → Gemini
        if (ext.queryClassifier) system.quadBrain.queryClassifier = ext.queryClassifier;
        console.log(`    🔗 QuadBrain ← GoalPlanner, CodeObserver, CuriosityEngine${ext.queryClassifier ? ', QueryComplexityClassifier' : ''}`);
    }

    // BraveSearch → QuadBrain (live web search for user queries — 500/month, use sparingly)
    if (ext.braveSearch) {
        system.braveSearch = ext.braveSearch;
        if (system.quadBrain) system.quadBrain.braveSearch = ext.braveSearch;
        if (system.quadBrain?._direct) system.quadBrain._direct.braveSearch = ext.braveSearch;
        console.log('    🔗 BraveSearchAdapter → QuadBrain (500 searches/month — Brave reserved for user queries)');
    }

    // CuriosityWebAccessConnector → CuriosityEngine (Brave + Puppeteer dendrite pipeline)
    if (ext.webResearcher && ext.curiosityEngine) {
        ext.curiosityEngine.webResearcher = ext.webResearcher;
        console.log('    🔗 CuriosityWebAccessConnector → CuriosityEngine (Tier 1 research pipeline)');
    }

    // Hybrid search availability for tools + learning systems
    if (ext.hybridSearch) {
        system.hybridSearch = ext.hybridSearch;
        system.searchArbiter = ext.hybridSearch;
        system.hybridSearchArbiter = ext.hybridSearch;
        console.log('    🔗 HybridSearchArbiter → system.hybridSearch/searchArbiter');
    }

    // Optional: one-time deep scan on boot for persistent search index
    if (ext.mnemonicIndexer && process.env.SOMA_INDEX_ON_START === 'true') {
        const scanPath = process.env.SOMA_INDEX_PATH || process.cwd();
        ext.mnemonicIndexer.scanDirectory(scanPath).catch(() => {});
        console.log(`    🔗 MnemonicIndexerArbiter → scanDirectory(${scanPath})`);
    }

    // Self-improvement loop
    if (ext.selfImprovement && ext.outcomeTracker && ext.hindsightReplay) {
        console.log('    🔗 Self-Improvement ↔ Outcome Tracking ↔ Hindsight Replay');
    }

    // ToolCreator + SkillWatcher — expose on system for routes, Arbiterium, and heartbeat
    if (ext.toolCreator) {
        system.toolCreator = ext.toolCreator;
        // Cross-connect: ToolCreator outputs skills to SkillWatcher's watched dir
        if (ext.skillWatcher) ext.toolCreator.skillWatcher = ext.skillWatcher;
        console.log('    🔗 ToolCreatorArbiter → system.toolCreator');
    }
    if (ext.skillWatcher) {
        system.skillWatcher = ext.skillWatcher;
        console.log('    🔗 SkillWatcherArbiter → system.skillWatcher');
    }
    if (ext.identityArbiter) {
        system.identityArbiter = ext.identityArbiter;
        console.log(`    🔗 IdentityArbiter → system.identityArbiter (${ext.identityArbiter.personas?.size || 0} personas)`);
    }

    // ── ThoughtNetwork: lazy-init if not already set by old bootstrap ──
    // Required for Knowledge tab fractal graph + autonomous concept synthesis.
    // Pre-seed from seeds/*.json so the graph is never empty on first launch.
    if (!system.thoughtNetwork) {
        try {
            const { ThoughtNetwork } = require('../../cognitive/ThoughtNetwork.cjs');
            const tn = new ThoughtNetwork({
                name: 'ThoughtNetwork',
                brain: system.quadBrain || system.somArbiter,
                mnemonic: system.mnemonicArbiter
            });
            system.thoughtNetwork = tn;

            // Load seed packs
            const fs = await import('fs');
            const seedsDir = path.join(rootPath, 'seeds');
            try {
                const seedFiles = fs.readdirSync(seedsDir).filter(f => f.endsWith('.json'));
                let totalSeeded = 0;
                for (const file of seedFiles) {
                    try {
                        const pack = JSON.parse(fs.readFileSync(path.join(seedsDir, file), 'utf8'));
                        if (pack.nodes && Array.isArray(pack.nodes)) {
                            for (const node of pack.nodes) {
                                tn.nodes.set(node.id, { ...node, accessCount: node.accessCount || 0, strength: node.strength || 0.8 });
                                totalSeeded++;
                            }
                        }
                    } catch { /* skip malformed seed */ }
                }
                console.log(`    🌱 ThoughtNetwork seeded with ${totalSeeded} nodes from ${seedFiles.length} packs`);
            } catch { /* seeds dir missing — no problem */ }

            // Start autonomous synthesis after 5 minutes (let system stabilize first)
            setTimeout(() => { try { tn.startAutonomousSynthesis(600000); } catch { } }, 300000);
            console.log('    🔗 ThoughtNetwork → system.thoughtNetwork (Knowledge graph online)');
        } catch (e) {
            console.warn('    ⚠️ ThoughtNetwork init failed (non-fatal):', e.message);
        }
    }

    // ── Late-wire trading arbiters into SOMA_TRADING ──
    // These load after boot, so we inject them into the global that
    // ScalpingEngine, PositionGuardian, and finance routes already check.
    if (global.SOMA_TRADING) {
        if (ext.regimeDetector && !global.SOMA_TRADING.regimeDetector) {
            global.SOMA_TRADING.regimeDetector = ext.regimeDetector;
            console.log('    🔗 MarketRegimeDetector → SOMA_TRADING (ScalpingEngine now regime-aware)');
        }
        if (ext.positionSizer && !global.SOMA_TRADING.positionSizer) {
            global.SOMA_TRADING.positionSizer = ext.positionSizer;
            console.log('    🔗 AdaptivePositionSizer → SOMA_TRADING (dynamic position sizing active)');
        }
        if (ext.tradeLearning && !global.SOMA_TRADING.tradeLearning) {
            global.SOMA_TRADING.tradeLearning = ext.tradeLearning;
            console.log('    🔗 TradeLearningEngine → SOMA_TRADING (QuadBrain trade analysis active)');
        }
        if (ext.mtfAnalyzer && !global.SOMA_TRADING.mtfAnalyzer) {
            global.SOMA_TRADING.mtfAnalyzer = ext.mtfAnalyzer;
            console.log('    🔗 MultiTimeframeAnalyzer → SOMA_TRADING');
        }
        if (ext.smartOrderRouter && !global.SOMA_TRADING.smartOrderRouter) {
            global.SOMA_TRADING.smartOrderRouter = ext.smartOrderRouter;
            console.log('    🔗 SmartOrderRouter → SOMA_TRADING');
        }
    }

    // Self-awareness loop: SelfModel ↔ CodeInspector ↔ CuriosityConnector
    if (ext.recursiveSelfModel && ext.selfCodeInspector) {
        ext.selfCodeInspector.selfModel = ext.recursiveSelfModel;
        console.log('    🔗 Self-Awareness loop: SelfModel ↔ CodeInspector ↔ CuriosityConnector');
    }

    // MetaLearning ↔ OutcomeTracker + ExperienceReplay
    if (ext.metaLearning) {
        if (ext.outcomeTracker) ext.metaLearning.outcomeTracker = ext.outcomeTracker;
        if (ext.experienceReplay) ext.metaLearning.experienceReplay = ext.experienceReplay;
        console.log('    🔗 MetaLearning ↔ OutcomeTracker + ExperienceReplay');
    }

    // TrainingDataExporter — wire all data sources
    if (ext.trainingDataExporter) {
        ext.trainingDataExporter.conversationHistory = ext.conversationHistory;
        ext.trainingDataExporter.personalityForge = ext.personalityForge;
        ext.trainingDataExporter.userProfile = ext.userProfile;
        ext.trainingDataExporter.mnemonic = system.mnemonicArbiter;
        ext.trainingDataExporter.learningPipeline = ext.learningPipeline;
        ext.trainingDataExporter.metaLearning = ext.metaLearning;
        ext.trainingDataExporter.causality = system.causality;
        console.log('    🔗 TrainingDataExporter ← ConversationHistory, Personality, Memory, MetaLearning');
    }

    // AutonomousExpansion — give it system reference
    if (ext.autonomousExpansion) {
        ext.autonomousExpansion.system = system;
        console.log('    🔗 AutonomousCapabilityExpansion ← System reference');
    }

    // ── AUTONOMOUS BACKGROUND SYSTEMS ──
    // Timekeeper → GoalPlanner (sends planning_pulse every 6h)
    if (ext.timekeeper) {
        system.timekeeper = ext.timekeeper;
        console.log('    🔗 TimekeeperArbiter → system.timekeeper (temporal rhythms active)');
    }

    // GoalPlanner ← CodeObserver, CuriosityEngine, SelfImprovement
    if (ext.goalPlanner) {
        if (ext.codeObserver) ext.goalPlanner.codeObserver = ext.codeObserver;
        if (ext.curiosityEngine) ext.goalPlanner.curiosityEngine = ext.curiosityEngine;
        if (ext.selfImprovement) ext.goalPlanner.selfImprovement = ext.selfImprovement;
        if (ext.outcomeTracker) ext.goalPlanner.outcomeTracker = ext.outcomeTracker;
        if (system.quadBrain && !ext.goalPlanner.quadBrain) ext.goalPlanner.quadBrain = system.quadBrain;
        system.goalPlanner = ext.goalPlanner; // Ensure system ref is up to date
        console.log('    🔗 GoalPlannerArbiter ← CodeObserver, Curiosity, SelfImprovement');
    }

    // ── Nemesis: shared singleton on system (used by routes AND self-improvement) ──
    if (!system.nemesis) {
        try {
            system.nemesis = new NemesisReviewSystem();
            console.log('    🔴 NemesisReviewSystem ← system.nemesis');
        } catch (ne) {
            console.warn(`    ⚠️ NemesisReviewSystem skipped: ${ne.message}`);
        }
    }

    // ── SelfEvolvingGoalEngine: Strategic self-improvement ──
    ext.selfEvolvingGoalEngine = await safeLoad('SelfEvolvingGoalEngine', async () => {
        const engine = new SelfEvolvingGoalEngine({ githubEnabled: true, maxActiveGoals: 5 });
        await engine.initialize({
            goalPlanner: ext.goalPlanner || system.goalPlanner,
            brain: system.quadBrain,
            memory: system.mnemonicArbiter,
            curiosityEngine: ext.curiosityEngine,
            toolCreator: ext.toolCreator,
            nemesis: system.nemesis,
            system
        });
        system.selfEvolvingGoalEngine = engine;
        if (ext.goalPlanner) ext.goalPlanner._selfEvolvingActive = true;
        return engine;
    });


    // ── MicroAgentPool: Parallel workforce ──
    ext.microAgentPool = await safeLoad('MicroAgentPool', () => {
        const pool = new MicroAgentPool({ parentId: 'SOMA', maxPoolSize: 20 });
        const agentTypes = [
            ['analyze',    '../../microagents/AnalyzeAgent.cjs'],
            ['automation', '../../microagents/AutomationAgent.cjs'],
            ['file',       '../../microagents/FileAgent.cjs'],
            ['transform',  '../../microagents/TransformAgent.cjs'],
            ['validate',   '../../microagents/ValidateAgent.cjs'],
            ['cache',      '../../microagents/CacheAgent.cjs'],
            ['fetch',      '../../microagents/FetchAgent.cjs'],
            ['mcp',        '../../microagents/MCPAgent.cjs'],
            ['workflow',   '../../microagents/WorkflowAgent.cjs'],
            ['batou',      '../../microagents/BatouAgent.cjs'],
            ['kuze',       '../../microagents/KuzeAgent.cjs'],
            ['jetstream',  '../../microagents/JetstreamAgent.cjs'],
            ['black',      '../../microagents/BlackAgent.cjs'],
        ];
        let registered = 0;
        for (const [type, modPath] of agentTypes) {
            try {
                const mod = require(modPath);
                const AgentClass = mod[Object.keys(mod)[0]];
                if (AgentClass) { pool.registerAgentType(type, AgentClass); registered++; }
            } catch { /* agent type unavailable */ }
        }
        const workflowType = pool.agentTypes?.get('workflow');
        if (workflowType) {
            const origWorkflow = workflowType;
            pool.agentTypes.set('workflow', function(cfg) {
                return new origWorkflow({ ...cfg, pool });
            });
        }
        system.microAgentPool = pool;
        if (ext.agenticExecutor) ext.agenticExecutor.pool = pool;
        // Spawn BlackAgent and register it in MessageBroker so direct routing works
        pool.spawnAgent?.('black', { name: 'BlackAgent' })
            ?.then(agent => {
                if (agent && system.messageBroker?.registerArbiter) {
                    system.messageBroker.registerArbiter('BlackAgent', {
                        instance: agent, type: 'micro-agent', capabilities: ['monitor', 'metrics']
                    });
                    system.blackAgent = agent;
                }
            })
            ?.catch(() => {});
        return pool;
    });

    // ── LocalModelManager: local fine-tuning lifecycle ──
    ext.localModelManager = await safeLoad('LocalModelManager', async () => {
        if (!LocalModelManager) throw new Error('module unavailable');
        const Cls = LocalModelManager.LocalModelManager || LocalModelManager.default || LocalModelManager;
        const mgr = new Cls({ baseModel: 'gemma3:4b', autoFineTune: true });
        await mgr.initialize();
        system.localModelManager = mgr;
        console.log('    🦙 LocalModelManager ← Ollama, auto fine-tune enabled');
        return mgr;
    });

    // ── EdgeWorkerOrchestrator: distributed learning task deployment ──
    ext.edgeWorkerOrchestrator = await safeLoad('EdgeWorkerOrchestrator', async () => {
        if (!EdgeWorkerOrchestrator) throw new Error('module unavailable');
        const Cls = EdgeWorkerOrchestrator.EdgeWorkerOrchestrator || EdgeWorkerOrchestrator.default || EdgeWorkerOrchestrator;
        const orch = new Cls({ name: 'EdgeWorkerOrchestrator' });
        if (orch.initialize) await orch.initialize({ messageBroker: system.messageBroker });
        system.edgeWorkerOrchestrator = orch;
        console.log('    ⚡ EdgeWorkerOrchestrator ← MessageBroker');
        return orch;
    });

    // NighttimeLearningOrchestrator — autonomous learning during idle periods
    try {
        ext.nighttimeLearning = new NighttimeLearningOrchestrator({
            name: 'NighttimeLearningOrchestrator'
        });
        await ext.nighttimeLearning.initialize({
            timekeeper:          ext.timekeeper,
            mnemonic:            system.mnemonicArbiter,
            quadBrain:           system.quadBrain,
            archivist:           system.archivistArbiter || system.archivist,
            reasoningChamber:    ext.reasoning,
            deployment:          ext.deploymentArbiter,
            storage:             system.storageArbiter || system.storage,
            knowledgeGraph:      system.knowledgeGraph,
            trainingDataExporter: ext.trainingDataExporter,
            learningPipeline:    ext.learningPipeline,    // ← was never wired, logs interactions
            curiosityEngine:     ext.curiosityEngine      // ← curiosity-driven topic selection
        });
        system.nighttimeLearning = ext.nighttimeLearning;
        console.log('    🔗 NighttimeLearningOrchestrator ← Timekeeper, Memory, QuadBrain, Reasoning');
    } catch (e) {
        console.warn(`    ⚠️ NighttimeLearningOrchestrator skipped: ${e.message}`);
        ext.nighttimeLearning = null;
    }

    // ── AutonomousHeartbeat: The Pulse of Self-Driven Activity (Local T1 Model) ──
    // Auto-starts by default so SOMA is proactive out of the box.
    // Set SOMA_HEARTBEAT_DISABLED=true to opt out.
    try {
        const heartbeatEnabled = process.env.SOMA_HEARTBEAT_DISABLED !== 'true';
        const heartbeat = new AutonomousHeartbeat(system, {
            enabled: heartbeatEnabled,
            intervalMs: 2 * 60 * 1000 // 2 minutes
        });
        await heartbeat.initialize();
        system.autonomousHeartbeat = heartbeat;
        ext.autonomousHeartbeat = heartbeat;
        // Attach the agentic executor so heartbeat uses real tools on goal tasks
        if (ext.agenticExecutor) {
            system.agenticExecutor = ext.agenticExecutor; // ensure system ref is set
        }
        console.log(`    🔗 AutonomousHeartbeat ← GoalPlanner, Curiosity, QuadBrain${ext.agenticExecutor ? ', AgenticExecutor' : ''} (${heartbeatEnabled ? 'AUTO-STARTED' : 'disabled via env'})`);
    } catch (e) {
        console.warn(`    ⚠️ AutonomousHeartbeat skipped: ${e.message}`);
    }

    // ── ReportingArbiter: Automated daily/weekly reports ──
    try {
        ext.reportingArbiter = new ReportingArbiter({ name: 'ReportingArbiter' });
        await ext.reportingArbiter.initialize({
            goalPlanner: ext.goalPlanner || system.goalPlanner,
            timekeeper: ext.timekeeper || system.timekeeper,
            curiosityEngine: ext.curiosityEngine || system.curiosityEngine,
            nighttimeLearning: ext.nighttimeLearning || system.nighttimeLearning,
            codeObserver: ext.codeObserver || system.codeObserver,
            approvalSystem: system.approvalSystem
        });
        system.reportingArbiter = ext.reportingArbiter;
        console.log('    🔗 ReportingArbiter ← GoalPlanner, Timekeeper, Curiosity, Learning, CodeObserver, Approvals');
    } catch (e) {
        console.warn(`    ⚠️ ReportingArbiter skipped: ${e.message}`);
        ext.reportingArbiter = null;
    }

    // ── OllamaAutoTrainer: Close the loop — retrains local model from accumulated conversations ──
    // Fires after 20 new conversations OR 24h since last training. Needs no heavy deps.
    try {
        ext.ollamaAutoTrainer = new OllamaAutoTrainer({
            conversationThreshold: 20,   // retrain every 20 new conversations
            checkInterval: 3600000,      // check every hour
            minTimeBetweenTraining: 86400000 // max once per 24h
        });
        await ext.ollamaAutoTrainer.initialize({
            conversationHistory: ext.conversationHistory || system.conversationHistory,
            personalityForge: ext.personalityForge || system.personalityForge,
            trainingDataExporter: ext.trainingDataExporter,
            quadBrain: system.quadBrain   // for synthetic Gemini data generation
        });
        system.ollamaAutoTrainer = ext.ollamaAutoTrainer;
        console.log('    🔗 OllamaAutoTrainer ← ConversationHistory, PersonalityForge, TrainingDataExporter, QuadBrain (AUTO-STARTED)');
    } catch (e) {
        console.warn(`    ⚠️ OllamaAutoTrainer skipped: ${e.message}`);
        ext.ollamaAutoTrainer = null;
    }

    // ── KEVIN: Inject cognitive arbiters so Kevin has brain access ──
    if (system.kevinArbiter) {
        const kevin = system.kevinArbiter;
        if (!kevin.quadBrain && system.quadBrain) kevin.quadBrain = system.quadBrain;
        if (!kevin.reasoning && ext.reasoning) kevin.reasoning = ext.reasoning;
        if (!kevin.toolCreator && ext.toolCreator) kevin.toolCreator = ext.toolCreator;
        if (!kevin.ideaCapture && ext.ideaCapture) kevin.ideaCapture = ext.ideaCapture;
        if (!kevin.learningPipeline && ext.learningPipeline) kevin.learningPipeline = ext.learningPipeline;
        if (!kevin.mnemonic && system.mnemonicArbiter) kevin.mnemonic = system.mnemonicArbiter;
        if (!kevin.codeObserver && ext.codeObserver) kevin.codeObserver = ext.codeObserver;
        if (!kevin.causality && system.causality) kevin.causality = system.causality;
        console.log('    🔗 KEVIN ← QuadBrain, Reasoning, ToolCreator, IdeaCapture, Memory');
    }

    // ── ComputerControlArbiter + VisionProcessingArbiter ──
    // SOMA_LOAD_VISION=true: load both (CLIP WASM compilation blocks ~30-90s — opt-in only)
    if (process.env.SOMA_LOAD_VISION === 'true') {
        ext.computerControl = await safeLoad('ComputerControlArbiter', async () => {
            const { ComputerControlArbiter } = await import(`../../arbiters/ComputerControlArbiter.js?cb=${Date.now()}`);
            return new ComputerControlArbiter({ name: 'ComputerControl', dryRun: false });
        });
        if (ext.computerControl) {
            system.computerControl = ext.computerControl;
            if (system.arbiters) system.arbiters.set('computerControl', ext.computerControl);
        }

        // VisionProcessingArbiter: CLIP model loads ONNX/WASM synchronously — run in background
        try {
            ext.visionArbiter = new VisionProcessingArbiter({ name: 'VisionArbiter' });
            system.visionArbiter = ext.visionArbiter;
            if (system.arbiters) system.arbiters.set('visionArbiter', ext.visionArbiter);
            
            ext.visionArbiter.initialize().then(() => {
                console.log('    👁️  VisionProcessingArbiter CLIP model ready');
                if (ext.computerControl) ext.computerControl.visionArbiter = ext.visionArbiter;
            }).catch(e => console.warn('    ⚠️ VisionArbiter CLIP load failed:', e.message));
            console.log('    👁️  VisionProcessingArbiter loading CLIP in background...');
        } catch (e) {
            console.warn(`    ⚠️ VisionProcessingArbiter skipped: ${e.message}`);
            ext.visionArbiter = null;
        }
    } else {
        console.log('    ⏭️ ComputerControlArbiter + VisionProcessingArbiter deferred (set SOMA_LOAD_VISION=true to enable)');
        console.log('       Note: CLIP WASM compilation blocks the event loop for 30-90s without this gate.');
        ext.computerControl = null;
        ext.visionArbiter = null;
    }

    // ── VirtualShell: Persistent shell session ──
    try {
        ext.virtualShell = new VirtualShell(process.cwd());
        system.virtualShell = ext.virtualShell;
        console.log('    ✅ VirtualShell');
    } catch (e) {
        console.warn(`    ⚠️ VirtualShell skipped: ${e.message}`);
        ext.virtualShell = null;
    }

    // ── EngineeringSwarmArbiter: SOMA's hands for code self-modification ──
    ext.engineeringSwarm = await safeLoad('EngineeringSwarmArbiter', () =>
        new EngineeringSwarmArbiter({ name: 'EngineeringSwarm', quadBrain: system.quadBrain, rootPath, mnemonicArbiter: system.mnemonicArbiter })
    );
    if (ext.engineeringSwarm) system.engineeringSwarm = ext.engineeringSwarm;

    // ── SwarmOptimizer: Self-improvement loop for the swarm ──
    ext.swarmOptimizer = await safeLoad('SwarmOptimizer', () =>
        new SwarmOptimizer({ name: 'SwarmOptimizer', swarm: ext.engineeringSwarm, quadBrain: system.quadBrain })
    );
    if (ext.swarmOptimizer) {
        system.swarmOptimizer = ext.swarmOptimizer;
        // Inject optimizer into swarm
        if (ext.engineeringSwarm) ext.engineeringSwarm.setOptimizer(ext.swarmOptimizer);
    }

    // ── DiscoverySwarm: Autonomous capability expansion ──
    ext.discoverySwarm = await safeLoad('DiscoverySwarm', () =>
        new DiscoverySwarm({ name: 'DiscoverySwarm', engineering: ext.engineeringSwarm, quadBrain: system.quadBrain })
    );
    if (ext.discoverySwarm) system.discoverySwarm = ext.discoverySwarm;

    // ── Register Operational Daemons ──
    if (system.daemonManager) {
        if (ext.swarmOptimizer) {
            const optDaemon = new OptimizationDaemon({ name: 'SwarmOptimizationDaemon', optimizer: ext.swarmOptimizer });
            system.daemonManager.register(optDaemon);
            system.daemonManager.start('SwarmOptimizationDaemon').catch(() => {});
        }
        if (ext.discoverySwarm) {
            const discDaemon = new DiscoveryDaemon({ name: 'SwarmDiscoveryDaemon', discovery: ext.discoverySwarm });
            system.daemonManager.register(discDaemon);
            system.daemonManager.start('SwarmDiscoveryDaemon').catch(() => {});
        }
    }

    // ── STEVE (ExecutiveCortex): Inject specialist arbiters ──
    const steve = system.steveArbiter || system.executiveCortex;
    if (steve) {
        if (!steve.toolCreator && ext.toolCreator) steve.toolCreator = ext.toolCreator;
        if (!steve.codeObserver && ext.codeObserver) steve.codeObserver = ext.codeObserver;
        if (!steve.learningPipeline && ext.learningPipeline) steve.learningPipeline = ext.learningPipeline;
        if (!steve.ideaCapture && ext.ideaCapture) steve.ideaCapture = ext.ideaCapture;
        if (!steve.knowledge && system.knowledgeGraph) steve.knowledge = system.knowledgeGraph;
        if (!steve.selfImprovement && ext.selfImprovement) steve.selfImprovement = ext.selfImprovement;
        // 🔑 THE KEY WIRE: Steve gets the Engineering Swarm as his hands
        // ExecutiveCortex.execute('code-modification', ...) will now route through real agentic execution
        if (!steve.swarm && ext.engineeringSwarm) steve.swarm = ext.engineeringSwarm;

        // Wire Steve's orchestrator with the full swarm + hybrid search transmitter.
        // cognitive.js already seeds population with quadBrain; here we add any late-loaded arbiters
        // and wire the hybridSearch transmitter (which loads in extended.js Tier 2).
        if (steve.orchestrator) {
            const pop = steve.orchestrator.population || new Map();
            if (system.quadBrain && !pop.has('quadBrain')) pop.set('quadBrain', system.quadBrain);
            if (system.somArbiter && !pop.has('somArbiter')) pop.set('somArbiter', system.somArbiter);
            steve.orchestrator.population = pop;
            // Wire hybridSearch for RAG — set whenever available (even if already partially wired)
            steve.orchestrator.transmitters = system.hybridSearchArbiter || system.hybridSearch || steve.orchestrator.transmitters || null;
        }
        // Also give Steve direct brain access as a fallback
        if (!steve.quadBrain && system.quadBrain) steve.quadBrain = system.quadBrain;

        console.log(`    🔗 STEVE ← QuadBrain, ToolCreator, CodeObserver, LearningPipeline, Knowledge${ext.engineeringSwarm ? ', EngineeringSwarm (orchestrator)' : ''}`);
    }

    // ── IdolSenturianArbiter: AMBER PROTOCOL ──
    ext.idolSenturian = await safeLoad('IdolSenturianArbiter', () =>
        new IdolSenturianArbiter({ name: 'IdolSenturian', messageBroker: system.messageBroker })
    );
    if (ext.idolSenturian) system.idolSenturian = ext.idolSenturian;

    // ── Kevin: Security Chief ──
    ext.kevinArbiter = await safeLoad('KevinArbiter', () =>
        new KevinArbiter({ name: 'KevinArbiter', messageBroker: system.messageBroker }), { timeoutMs: 30000 }
    );
    if (ext.kevinArbiter) {
        system.kevinArbiter = ext.kevinArbiter;
        if (system.immuneCortex) ext.kevinArbiter.immuneCortex = system.immuneCortex;
        if (system.securityCouncil) ext.kevinArbiter.securityCouncil = system.securityCouncil;
        if (ext.idolSenturian) ext.kevinArbiter.idolSenturian = ext.idolSenturian;
        if (system.quadBrain) ext.kevinArbiter.quadBrain = system.quadBrain;
        if (ext.reasoning) ext.kevinArbiter.reasoning = ext.reasoning;
        if (ext.toolCreator) ext.kevinArbiter.toolCreator = ext.toolCreator;
        if (ext.ideaCapture) ext.kevinArbiter.ideaCapture = ext.ideaCapture;
        if (ext.learningPipeline) ext.kevinArbiter.learningPipeline = ext.learningPipeline;
        if (system.mnemonicArbiter) ext.kevinArbiter.mnemonic = system.mnemonicArbiter;
        if (ext.codeObserver) ext.kevinArbiter.codeObserver = ext.codeObserver;
        if (system.causality) ext.kevinArbiter.causality = system.causality;
        if (ext.idolSenturian) ext.idolSenturian.securityChief = ext.kevinArbiter;
        console.log('    🔗 KEVIN ← ImmuneCortex, SecurityCouncil, IdolSenturian, QuadBrain (SECURITY CHIEF)');
    }

    // ── ThalamusArbiter: Network Identity & Gatekeeper ──
    ext.thalamusArbiter = await safeLoad('ThalamusArbiter', () =>
        new ThalamusArbiter({ name: 'LocalThalamus', beliefSystem: system.beliefSystem || system.worldModel || null })
    );
    if (ext.thalamusArbiter) system.thalamusArbiter = ext.thalamusArbiter;

    // ── MAX Agent Bridge: Dispatch engineering goals to MAX autonomously ──
    try {
        const broker = require('../../core/MessageBroker.cjs');
        const maxBridgeMod = await import('../../core/MaxAgentBridge.js');
        const maxBridge = maxBridgeMod.default;
        system.maxBridge = maxBridge;

        const ENGINEERING_KEYWORDS = ['implement', 'build', 'create', 'add', 'develop', 'wire',
            'migrate', 'refactor', 'fix', 'upgrade', 'integrate', 'enable', 'deploy'];
        const SKIP_CATEGORIES = ['learning'];
        const dispatchedToMax = new Set();

        broker.subscribe('MaxAgentBridge.dispatch', 'goal_created');
        broker.on('goal_created', async (envelope) => {
            const goal = envelope?.payload?.goal || envelope?.goal;
            if (!goal || !goal.id) return;
            if (dispatchedToMax.has(goal.id)) return;
            if (goal.status === 'proposed') return; // Needs human approval first
            if (SKIP_CATEGORIES.includes(goal.category)) return;

            const titleLower = (goal.title || '').toLowerCase();
            const isEngineeringGoal = goal.category === 'engineering' ||
                ENGINEERING_KEYWORDS.some(kw => titleLower.includes(kw));
            if (!isEngineeringGoal) return;

            dispatchedToMax.add(goal.id);
            try {
                await maxBridge.injectGoal(goal.title, {
                    description: goal.description || goal.title,
                    priority: Math.min(1, (goal.priority || 50) / 100),
                });
                console.log(`    🤝 [MAX] Goal dispatched: "${goal.title}"`);
            } catch (e) {
                console.warn(`    ⚠️ MAX offline — goal queued locally: ${e.message}`);
                dispatchedToMax.delete(goal.id);
            }
        });
        console.log('    🤝 MAX Agent Bridge: goal_created → MAX GoalEngine (engineering goals auto-dispatch)');
    } catch (e) {
        console.warn(`    ⚠️ MAX Agent Bridge wiring skipped: ${e.message}`);
    }

    // ── ProactiveCouncilArbiter: Executive function — "What should SOMA do next?" ──
    ext.proactiveCouncil = await safeLoad('ProactiveCouncilArbiter', () =>
        new ProactiveCouncilArbiter({
            name:               'ProactiveCouncil',
            quadBrain:          system.quadBrain,
            goalPlanner:        ext.goalPlanner || system.goalPlanner,
            engineeringSwarm:   ext.engineeringSwarm,
            kevinArbiter:       ext.kevinArbiter,
            mnemonicArbiter:    system.mnemonicArbiter,
            autonomousHeartbeat: ext.autonomousHeartbeat,
            steveArbiter:       system.steveArbiter || system.executiveCortex,
            system,             // for ArbiterLoader fallback delegation
        })
    );
    if (ext.proactiveCouncil) {
        system.proactiveCouncil = ext.proactiveCouncil;
        await ext.proactiveCouncil.initialize();
        console.log('    🏛️  ProactiveCouncilArbiter ← QuadBrain, GoalPlanner, EngineeringSwarm, Kevin, AutonomousHeartbeat');
    }

    // ── ArbiterLoader: on-demand loading of the ~94 unbooted arbiters ──────
    // Scans arbiters/ dir, builds capability manifest, enables lazy loading.
    // ProactiveCouncilArbiter uses this as fallback when a delegate isn't live.
    try {
        ext.arbiterLoader = new ArbiterLoader({
            system,
            messageBroker: system.messageBroker,
        });
        await ext.arbiterLoader.initialize();
        system.arbiterLoader = ext.arbiterLoader;
        console.log('    📚 ArbiterLoader ONLINE — arbiter inventory mapped, lazy loading enabled');
    } catch (e) {
        console.warn(`    ⚠️ ArbiterLoader skipped: ${e.message}`);
    }

    // ── ASI Intelligence Loop: the recursive self-improvement cycle ────────
    // ConstitutionalCore → CapabilityBenchmark → LongHorizonPlanner → TransferSynthesizer → ASIKernel
    // All routes at /api/asi/* were already written — they just needed system objects.
    try {
        // 1. Safety gate — must load first, hardcoded principles cannot be overwritten
        ext.constitutional = new ConstitutionalCore();
        await ext.constitutional.initialize();
        system.constitutional = ext.constitutional;

        // 2. Measurement — 6 capability dimensions, no LLM calls for probes
        ext.benchmark = new CapabilityBenchmark({ system });
        await ext.benchmark.initialize();
        system.benchmark = ext.benchmark;

        // 3. Vision — week/month level milestone tracking
        ext.longHorizon = new LongHorizonPlanner({ system, brain: system.quadBrain });
        await ext.longHorizon.initialize();
        system.longHorizon = ext.longHorizon;

        // 4. Cross-domain transfer — learnings from trading flow into coding, etc.
        ext.transfer = new TransferSynthesizer({ system, brain: system.quadBrain });
        await ext.transfer.initialize();
        system.transfer = ext.transfer;

        // 5. ASI Kernel — orchestrates the full MEASURE→IDENTIFY→TRANSFER→GOAL→VERIFY loop
        ext.asiKernel = new ASIKernel({ system });
        await ext.asiKernel.initialize();
        system.asiKernel = ext.asiKernel;

        // First cycle after 10 min (let everything settle), then every 2 hours
        setTimeout(() => {
            ext.asiKernel.runCycle().catch(err => console.warn('[ASIKernel] First cycle error:', err.message));
            setInterval(() => {
                ext.asiKernel.runCycle().catch(err => console.warn('[ASIKernel] Cycle error:', err.message));
            }, 2 * 60 * 60 * 1000); // 2 hours
        }, 10 * 60 * 1000); // 10 min after boot

        console.log('    🧠 ASI Intelligence Loop ONLINE ← Constitutional, Benchmark, LongHorizon, Transfer → first cycle in 10min');
    } catch (e) {
        console.warn(`    ⚠️ ASI Intelligence Loop skipped: ${e.message}`);
    }

    // Count what loaded
    const loaded = Object.values(ext).filter(v => v !== null).length;
    const total = Object.keys(ext).length;
    const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
    console.log(`\n[Extended] ═══ ${loaded}/${total} specialist arbiters activated (heap: ${heapMB}MB) ═══\n`);

    return ext;
}

// ═══════════════════════════════════════════
// AUTOPILOT CONTROLLER
// ═══════════════════════════════════════════

export function toggleAutopilot(enabled, system) {
    const results = { goals: false, rhythms: false, social: false, heartbeat: false };

    // AutonomousHeartbeat (The Pulse)
    if (system.autonomousHeartbeat) {
        if (enabled) { system.autonomousHeartbeat.start(); }
        else { system.autonomousHeartbeat.stop(); }
        results.heartbeat = system.autonomousHeartbeat.isRunning;
    }

    // GoalPlannerArbiter
    if (system.goalPlanner) {
        if (enabled) { system.goalPlanner.resumeAutonomous?.(); }
        else { system.goalPlanner.pauseAutonomous?.(); }
        results.goals = system.goalPlanner.isAutonomousActive?.() ?? enabled;
    }

    // TimekeeperArbiter
    if (system.timekeeper) {
        if (enabled) { system.timekeeper.resumeAutonomousRhythms?.(); }
        else { system.timekeeper.pauseAutonomousRhythms?.(); }
        results.rhythms = system.timekeeper.isAutonomousActive?.() ?? enabled;
    }

    // SocialAutonomyArbiter
    if (system.socialAutonomy) {
        if (enabled) { system.socialAutonomy.activate?.(); }
        else { system.socialAutonomy.deactivate?.(); }
        results.social = system.socialAutonomy.isActive ?? enabled;
    }

    console.log(`[Autopilot] ${enabled ? '▶️  ENABLED' : '⏸️  PAUSED'} — Heartbeat: ${results.heartbeat}, Goals: ${results.goals}, Rhythms: ${results.rhythms}, Social: ${results.social}`);
    return { enabled, components: results };
}

export function getAutopilotStatus(system) {
    return {
        enabled: system.autonomousHeartbeat?.isRunning ?? false,
        components: {
            heartbeat: system.autonomousHeartbeat?.isRunning ?? false,
            heartbeatStats: system.autonomousHeartbeat?.stats ?? null,
            goals: system.goalPlanner?.isAutonomousActive?.() ?? false,
            rhythms: system.timekeeper?.isAutonomousActive?.() ?? false,
            social: system.socialAutonomy?.isActive ?? false
        }
    };
}
