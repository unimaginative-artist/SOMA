/**
 * server/loaders/extended.js
 *
 * PHASE 4.1: Extended Specialist Arbiters (Omega Protocol v2.1)
 * 
 * This is the Architectural Command Center for SOMA. 
 * It manages the discovery and dynamic integration of ~40+ specialist arbiters.
 * 
 * Organizes loading into dependency-aware phases, ensuring that 
 * sophisticated cross-system loops (Learning, Trading, Autonomy) are
 * fully wired and synchronized.
 */

import path from 'path';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { OllamaAutoTrainer } from '../../core/OllamaAutoTrainer.js';

const require = createRequire(import.meta.url);
const rootPath = process.cwd();

/**
 * PHASE 4.0: Essential ASI Core (Learning, Fragments, Personality)
 * This tier is light enough to load shortly after boot without killing the event loop.
 * These systems enable SOMA to learn from interactions and maintain her unique personality.
 */
export async function loadEssentialSystems(system) {
    console.log('\n[Essential] ═══ Loading ASI Core (Learning + Fragments) ═══');
    const ext = {};

    // ── Ensure ArbiterLoader is ready ──────────
    if (!system.arbiterLoader) {
        try {
            const { ArbiterLoader } = await import('../../core/ArbiterLoader.js');
            system.arbiterLoader = new ArbiterLoader({
                system,
                messageBroker: system.messageBroker,
            });
            await system.arbiterLoader.initialize();
            if (system.messageBroker && typeof system.messageBroker.setArbiterLoader === 'function') {
                system.messageBroker.setArbiterLoader(system.arbiterLoader);
            }
        } catch (e) {
            console.error(`    ❌ Essential Tier: ArbiterLoader failed: ${e.message}`);
            return {};
        }
    }

    const essentialArbiters = [
        'OutcomeTracker.js',
        'ExperienceReplayBuffer.js',
        'QueryComplexityClassifier.js',
        'FragmentRegistry.js',
        'UniversalLearningPipeline.js',
        'CuriosityEngine.js',
        'ConversationCuriosityExtractor.js',
        'PersonalityForgeArbiter.js',
        'MoltbookArbiter.js',
        'ConversationHistoryArbiter.js',
        'TrainingDataExporter.js',
        'AdaptiveLearningPlanner.js',
        'HindsightReplayArbiter.js'
    ];

    const instances = await system.arbiterLoader.batchLoad(essentialArbiters);

    instances.forEach(inst => {
        if (!inst) return;
        const name = inst.name || inst.constructor.name;
        if (name === 'OutcomeTracker') ext.outcomeTracker = inst;
        else if (name === 'ExperienceReplayBuffer') ext.experienceReplay = inst;
        else if (name === 'QueryComplexityClassifier') ext.queryClassifier = inst;
        else if (name === 'FragmentRegistry') ext.fragmentRegistry = inst;
        else if (name === 'UniversalLearningPipeline') ext.learningPipeline = inst;
        else if (name === 'CuriosityEngine') ext.curiosityEngine = inst;
        else if (name === 'ConversationCuriosityExtractor') ext.curiosityExtractor = inst;
        else if (name === 'PersonalityForgeArbiter') ext.personalityForge = inst;
        else if (name === 'MoltbookArbiter') ext.moltbook = inst;
        else if (name === 'ConversationHistoryArbiter') ext.conversationHistory = inst;
        else if (name === 'TrainingDataExporter') ext.trainingDataExporter = inst;
        else if (name === 'AdaptiveLearningPlanner') ext.learningPlanner = inst;
        else if (name === 'HindsightReplayArbiter') ext.hindsightReplay = inst;
    });

    // ── Wire ASI Core Connections (Mirroring original logic) ──
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

    if (ext.trainingDataExporter) {
        ext.trainingDataExporter.conversationHistory = ext.conversationHistory;
        ext.trainingDataExporter.personalityForge = ext.personalityForge;
        ext.trainingDataExporter.mnemonic = system.mnemonicArbiter;
        ext.trainingDataExporter.learningPipeline = ext.learningPipeline;
        console.log('    🔗 TrainingDataExporter ← ConversationHistory, Memory, LearningPipeline');
    }

    if (!system.ollamaAutoTrainer && ext.conversationHistory && ext.trainingDataExporter) {
        try {
            system.ollamaAutoTrainer = new OllamaAutoTrainer({
                name: 'OllamaAutoTrainer',
                enabled: process.env.SOMA_AUTO_LORA_TRAINING !== 'false',
                conversationThreshold: Number(process.env.SOMA_CONVERSATION_TRAINING_THRESHOLD || 100),
                checkInterval: Number(process.env.SOMA_TRAINING_CHECK_INTERVAL_MS || 3600000),
                minTimeBetweenTraining: Number(process.env.SOMA_MIN_TRAINING_INTERVAL_MS || 86400000)
            });
            await system.ollamaAutoTrainer.initialize({
                conversationHistory: ext.conversationHistory,
                personalityForge: ext.personalityForge,
                trainingDataExporter: ext.trainingDataExporter,
                quadBrain: system.quadBrain
            });
            system.ollamaTrainer = system.ollamaAutoTrainer;
            if (typeof system.ollamaAutoTrainer.wireKnowledgeCurator === 'function') {
                system.ollamaAutoTrainer.wireKnowledgeCurator(system.messageBroker);
            }
            if (typeof system.ollamaAutoTrainer.wireNemesisAndBrain === 'function') {
                system.ollamaAutoTrainer.wireNemesisAndBrain(system.nemesis, system.quadBrain);
            }
            console.log('    🔗 OllamaAutoTrainer → ConversationHistory + KnowledgeCurator thresholds');
        } catch (e) {
            console.warn('    ⚠️  OllamaAutoTrainer init skipped:', e.message);
        }
    } else if (system.ollamaAutoTrainer) {
        system.ollamaTrainer = system.ollamaAutoTrainer;
        if (typeof system.ollamaAutoTrainer.wireKnowledgeCurator === 'function') {
            system.ollamaAutoTrainer.wireKnowledgeCurator(system.messageBroker);
        }
    }

    if (!system.trainingDatasetRebuildTimer && process.env.SOMA_SCHEDULE_DATASET_REBUILD !== 'false') {
        const runDatasetRebuild = () => {
            execFile('node', ['scripts/build-lobe-datasets.mjs'], {
                cwd: process.cwd(),
                timeout: Number(process.env.SOMA_DATASET_REBUILD_TIMEOUT_MS || 10 * 60 * 1000)
            }, (error, stdout, stderr) => {
                if (error) {
                    console.warn('    ⚠️  Scheduled lobe dataset rebuild failed:', error.message, stderr?.slice?.(-500) || '');
                } else {
                    console.log('    ✅ Scheduled lobe dataset rebuild complete:', stdout?.slice?.(-800) || '');
                }
            });
        };
        const intervalMs = Number(process.env.SOMA_DATASET_REBUILD_INTERVAL_MS || 24 * 60 * 60 * 1000);
        system.trainingDatasetRebuildTimer = setInterval(runDatasetRebuild, intervalMs);
        setTimeout(runDatasetRebuild, Number(process.env.SOMA_DATASET_REBUILD_BOOT_DELAY_MS || 10 * 60 * 1000));
        console.log(`    🔁 Scheduled lobe dataset rebuild active (${Math.round(intervalMs / 3600000)}h interval)`);
    }

    // Initialize blockchain audit ledger
    try {
        const { AuditLedger } = await import('../../server/finance/AuditLedger.js');
        const auditPath = path.join(rootPath, 'data', 'audit', 'soma_audit_ledger.db');
        system.auditLedger = new AuditLedger(auditPath);
        system.auditLedger.append({ actor: 'SOMA', action: 'system_boot', metadata: { version: '1.0', timestamp: new Date().toISOString() } });
        console.log('    ✅ Blockchain AuditLedger initialized — hash chain active');
    } catch (e) {
        console.warn('    ⚠️  AuditLedger init failed:', e.message);
    }

    const loaded = Object.values(ext).filter(v => v !== null).length;
    const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
    console.log(`\n[Essential] ═══ ${loaded} ASI-core arbiters activated (heap: ${heapMB}MB) ═══\n`);

    return ext;
}

export async function loadExtendedSystems(system) {
    console.log('\n[Extended] ═══ Activating Remaining Specialist Arbiters ═══');
    const ext = {};

    // ── ArbiterLoader: The engine for autonomous self-expansion ──────────
    // Upgrades boot from static hardcoding to dynamic manifest materialization.
    try {
        const { ArbiterLoader } = await import('../../core/ArbiterLoader.js');
        ext.arbiterLoader = new ArbiterLoader({
            system,
            messageBroker: system.messageBroker,
        });
        await ext.arbiterLoader.initialize();
        system.arbiterLoader = ext.arbiterLoader;
        
        // 🔱 CNS INTEGRATION: Wire loader into MessageBroker for on-the-fly expansion
        if (system.messageBroker && typeof system.messageBroker.setArbiterLoader === 'function') {
            system.messageBroker.setArbiterLoader(ext.arbiterLoader);
        }
        console.log('    📚 ArbiterLoader ONLINE — unified inventory mapped, on-the-fly expansion enabled');
    } catch (e) {
        console.warn(`    ⚠️ ArbiterLoader failed to start: ${e.message}`);
    }

    // 🌐 BRAVE SEARCH: SOMA's Eyes for 2026 data
    try {
        const { BraveSearchAdapter } = require('../../cognitive/BraveSearchAdapter.cjs');
        ext.braveSearch = new BraveSearchAdapter({ maxResults: 5 });
        system.braveSearch = ext.braveSearch;
        if (system.quadBrain) system.quadBrain.braveSearch = ext.braveSearch;
        console.log('    ✅ BraveSearchAdapter (Live Web Access Ready)');
    } catch (e) {
        console.log(`    ⏭️ BraveSearchAdapter: ${e.message}`);
    }

    // 🔍 HYBRID SEARCH: Semantic vector search for the Storage tab
    if (process.env.SOMA_HYBRID_SEARCH === 'true') {
        try {
            const heapUsedMB = process.memoryUsage().heapUsed / 1024 / 1024;
            if (heapUsedMB > 500) {
                console.log(`    ⏭️ HybridSearchArbiter: skipped (heap ${heapUsedMB.toFixed(0)}MB > 500MB threshold)`);
            } else {
                const HybridSearchArbiter = require('../../arbiters/HybridSearchArbiter.cjs');
                const HybridSearchClass = HybridSearchArbiter.HybridSearchArbiter || HybridSearchArbiter.default || HybridSearchArbiter;
                const indexDir = path.join(rootPath, '.soma', 'search_index');
                ext.hybridSearch = new HybridSearchClass({ indexDir, useWorker: false });
                if (typeof ext.hybridSearch.initialize === 'function') {
                    await ext.hybridSearch.initialize();
                }
                system.hybridSearch = ext.hybridSearch;
                console.log(`    ✅ HybridSearchArbiter (Storage tab ONLINE, heap: ${heapUsedMB.toFixed(0)}MB)`);
            }
        } catch (e) {
            console.warn(`    ⚠️ HybridSearchArbiter failed to load: ${e.message}`);
        }
    }

    // ═══════════════════════════════════════════
    // PHASE D: Trading Pipeline (Dynamic Loading)
    // ═══════════════════════════════════════════
    if (process.env.SOMA_LOAD_TRADING === 'true') {
        console.log('\n[Phase D] Trading Pipeline (Dynamic)...');
        const tradingArbiters = [
            'MultiTimeframeAnalyzer.js',
            'AdversarialDebate.js',
            'TradeLearningEngine.js',
            'BacktestEngine.js',
            'TradingBacktestArbiter.js',
            'SmartOrderRouter.js',
            'AdaptivePositionSizer.js',
            'StrategyOptimizer.js',
            'RedditSignalDetector.js'
        ];

        const instances = await ext.arbiterLoader.batchLoad(tradingArbiters);
        
        instances.forEach(inst => {
            if (!inst) return;
            const name = inst.name || inst.constructor.name;
            if (name === 'MultiTimeframeAnalyzer') ext.mtfAnalyzer = inst;
            else if (name === 'TradeLearningEngine') ext.tradeLearning = inst;
            else if (name === 'BacktestEngine') ext.backtestEngine = inst;
            else if (name === 'TradingBacktestArbiter') ext.tradingBacktest = inst;
            else if (name === 'SmartOrderRouter') ext.smartOrderRouter = inst;
            else if (name === 'AdaptivePositionSizer') ext.positionSizer = inst;
            else if (name === 'StrategyOptimizer') ext.strategyOptimizer = inst;
            else if (name === 'RedditSignalDetector') ext.redditSignals = inst;
            else if (name === 'AdversarialDebate') ext.adversarialDebate = inst;
        });

        // 🔗 LATE-WIRE TRADING GLOBALS
        if (global.SOMA_TRADING) {
            if (ext.mtfAnalyzer) global.SOMA_TRADING.mtfAnalyzer = ext.mtfAnalyzer;
            if (ext.tradeLearning) global.SOMA_TRADING.tradeLearning = ext.tradeLearning;
            if (ext.backtestEngine) global.SOMA_TRADING.backtestEngine = ext.backtestEngine;
            if (ext.smartOrderRouter) global.SOMA_TRADING.smartOrderRouter = ext.smartOrderRouter;
            if (ext.tradingBacktest) {
                global.SOMA_TRADING.tradingBacktest = ext.tradingBacktest;
                ext.tradingBacktest.initialize().catch(e => console.warn(`TradingBacktestArbiter init failed: ${e.message}`));
            }
            console.log('    🔗 Trading Global State Synchronized');
        }
    }

    // ═══════════════════════════════════════════
    // PHASE B/C: Cognitive Specialists (Dynamic Loading)
    // ═══════════════════════════════════════════
    if (process.env.SOMA_LOAD_HEAVY === 'true') {
        console.log('\n[Phase B/C] Cognitive Specialists (Dynamic)...');
        const cognitiveArbiters = [
            'ReasoningChamber.js',
            'DevilsAdvocateArbiter.js',
            'ForecasterArbiter.js',
            'SentimentAggregator.js',
            'GistArbiter.js',
            'CodeObservationArbiter.js',
            'HippocampusArbiter.js',
            'MetaCortexArbiter.js',
            'AbstractionArbiter.js',
            'KnowledgeAugmentedGenerator.js'
        ];

        const instances = await ext.arbiterLoader.batchLoad(cognitiveArbiters);

        instances.forEach(inst => {
            if (!inst) return;
            const name = inst.name || inst.constructor.name;
            if (name === 'ReasoningChamber') ext.reasoning = inst;
            else if (name === 'DevilsAdvocateArbiter') ext.devilsAdvocate = inst;
            else if (name === 'ForecasterArbiter') ext.forecaster = inst;
            else if (name === 'SentimentAggregator') ext.sentimentAggregator = inst;
            else if (name === 'GistArbiter') ext.gistArbiter = inst;
            else if (name === 'CodeObservationArbiter') ext.codeObserver = inst;
            else if (name === 'HippocampusArbiter') ext.hippocampus = inst;
            else if (name === 'MetaCortexArbiter') ext.metaCortex = inst;
            else if (name === 'AbstractionArbiter') ext.abstractionArbiter = inst;
            else if (name === 'KnowledgeAugmentedGenerator') ext.knowledgeGenerator = inst;
        });

        // 🔗 WIRE COGNITIVE LOOPS
        if (system.quadBrain) {
            if (ext.reasoning) system.quadBrain.reasoning = ext.reasoning;
            if (ext.forecaster) system.quadBrain.forecaster = ext.forecaster;
            if (ext.codeObserver) system.quadBrain.codeObserver = ext.codeObserver;
            console.log('    🔗 QuadBrain ↔ Cognitive Specialist Loop Active');
        }
    }

    // ═══════════════════════════════════════════
    // PHASE E/F: Learning & Research (Dynamic Loading)
    // ═══════════════════════════════════════════
    console.log('\n[Phase E/F] Learning & Research (Dynamic)...');
    const researchArbiters = [
        'UniversalLearningPipeline.js',
        'CuriosityEngine.js',
        'AdaptiveLearningPlanner.js',
        'HindsightReplayArbiter.js',
        'SelfImprovementCoordinator.js',
        'FragmentCommunicationHub.js',
        'IdeaCaptureArbiter.js',
        'ConversationCuriosityExtractor.js',
        'DiscoveryGradeMedicalCortex.js',
        'BiotechArbiter.js',
        'ChemistryLabArbiter.js',
        'MlInternArbiter.js',
        'DreamArbiter.cjs'
    ];

    const researchInstances = await ext.arbiterLoader.batchLoad(researchArbiters);

    researchInstances.forEach(inst => {
        if (!inst) return;
        const name = inst.name || inst.constructor.name;
        if (name === 'UniversalLearningPipeline') ext.learningPipeline = inst;
        else if (name === 'CuriosityEngine') ext.curiosityEngine = inst;
        else if (name === 'AdaptiveLearningPlanner') ext.learningPlanner = inst;
        else if (name === 'HindsightReplayArbiter') ext.hindsightReplay = inst;
        else if (name === 'SelfImprovementCoordinator') ext.selfImprovement = inst;
        else if (name === 'FragmentCommunicationHub') ext.fragmentComms = inst;
        else if (name === 'IdeaCaptureArbiter') ext.ideaCapture = inst;
        else if (name === 'ConversationCuriosityExtractor') ext.curiosityExtractor = inst;
        else if (name === 'DiscoveryGradeMedicalCortex') { ext.medicalDiscovery = inst; system.discoveryGradeMedical = inst; }
        else if (name === 'BiotechArbiter') { ext.biotechArbiter = inst; system.biotechArbiter = inst; }
        else if (name === 'ChemistryLabArbiter' || name === 'ChemistryLab') { ext.chemistryLab = inst; system.chemistryLab = inst; }
        else if (name === 'MlInternArbiter' || name === 'MlIntern') { ext.mlIntern = inst; system.mlIntern = inst; }
        else if (name === 'DreamArbiter') { ext.dreamArbiter = inst; system.dreamArbiter = inst; }
    });

    if (ext.medicalDiscovery) {
        system.discoveryGradeMedical = ext.medicalDiscovery;
    }

    // 🔗 WIRE LEARNING & RESEARCH
    if (ext.learningPipeline) {
        system.learningPipeline = ext.learningPipeline;
        if (system.mnemonicArbiter) ext.learningPipeline.mnemonicArbiter = system.mnemonicArbiter;
        console.log('    🔗 Universal Learning Pipeline PHYSICALLY ANCHORED');
    }
    if (ext.curiosityEngine) {
        system.curiosityEngine = ext.curiosityEngine;
        if (system.quadBrain) system.quadBrain.curiosityEngine = ext.curiosityEngine;
        // Wire real search tools so curiosity explorations fetch actual web evidence
        if (system.toolRegistry) ext.curiosityEngine._toolRegistry = system.toolRegistry;
        if (system.braveSearch)  ext.curiosityEngine._braveSearch  = system.braveSearch;
        // Wire curiosity topics into social engagement so she comments on what she's learning about
        if (system.socialEngagement?.setCuriosityEngine) system.socialEngagement.setCuriosityEngine(ext.curiosityEngine);
    }
    if (ext.fragmentComms && system.fragmentRegistry) {
        if (system.quadBrain) system.quadBrain.fragmentComms = ext.fragmentComms;
        console.log('    🔗 Fragment Registry ↔ Communication Hub ↔ QuadBrain');
    }
    if (ext.ideaCapture) {
        system.ideaCapture = ext.ideaCapture;
        ext.ideaCapture.mnemonic = ext.ideaCapture.mnemonic || system.mnemonicArbiter;
        ext.ideaCapture.learningPipeline = ext.ideaCapture.learningPipeline || system.learningPipeline;
        ext.ideaCapture.reflections = ext.ideaCapture.reflections || system.reflections;
        ext.ideaCapture.museEngine = ext.ideaCapture.museEngine || system.museEngine;
        if (system.museEngine) {
            system.museEngine.ideaCapture = system.museEngine.ideaCapture || ext.ideaCapture;
            system.museEngine.reflections = system.museEngine.reflections || system.reflections;
        }
        console.log('    🔗 IdeaCapture → Muse → Reflections');
    }

    // ═══════════════════════════════════════════
    // PHASE G/I: Identity & Autonomy (Dynamic Loading)
    // ═══════════════════════════════════════════
    console.log('\n[Phase G/I] Identity & Autonomy (Dynamic)...');
    const autonomyArbiters = [
        'PersonalityForgeArbiter.js',
        'MoltbookArbiter.js',
        'UserProfileArbiter.js',
        'ContextManagerArbiter.js',
        'SocialAutonomyArbiter.js',
        'RecursiveSelfModel.js',
        'AutonomousCapabilityExpansion.js',
        'MetaLearningEngine.js',
        'ProactiveCouncilArbiter.js',
        'DiagnosticCortexArbiter.js',
        'CronaArbiter.js',
        'TheoryOfMindArbiter.cjs',
        'SelfModificationArbiter.cjs',
        'ProactivePerceptionArbiter.js'
    ];

    const autonomyInstances = await ext.arbiterLoader.batchLoad(autonomyArbiters);

    autonomyInstances.forEach(inst => {
        if (!inst) return;
        const name = inst.name || inst.constructor.name;
        if (name === 'PersonalityForgeArbiter') ext.personalityForge = inst;
        else if (name === 'MoltbookArbiter') ext.moltbook = inst;
        else if (name === 'UserProfileArbiter') ext.userProfile = inst;
        else if (name === 'ContextManagerArbiter') ext.contextManager = inst;
        else if (name === 'SocialAutonomyArbiter') ext.socialAutonomy = inst;
        else if (name === 'RecursiveSelfModel') ext.recursiveSelfModel = inst;
        else if (name === 'AutonomousCapabilityExpansion') ext.autonomousExpansion = inst;
        else if (name === 'MetaLearningEngine') ext.metaLearning = inst;
        else if (name === 'ProactiveCouncilArbiter') ext.proactiveCouncil = inst;
        else if (name === 'DiagnosticCortexArbiter') ext.diagnosticCortex = inst;
        else if (name === 'CronaArbiter') { ext.crona = inst; system.crona = inst; system.cronaArbiter = inst; }
        else if (name === 'TheoryOfMindArbiter') { ext.tom = inst; system.tom = inst; system.theoryOfMind = inst; }
        else if (name === 'SelfModificationArbiter') { ext.selfMod = inst; system.selfModificationArbiter = inst; }
        else if (name === 'ProactivePerceptionArbiter') { ext.perception = inst; system.perceptionArbiter = inst; system.proactivePerception = inst; }
        else if (name === 'BiotechArbiter') { ext.biotechArbiter = inst; system.biotechArbiter = inst; }
        else if (name === 'MlInternArbiter') { ext.mlIntern = inst; system.mlIntern = inst; }
    });

    // ── Simulation Evaluator — SOMA's strategy evolution engine ──────────────
    try {
        const { SimulationEvaluator } = await import('../scrapers/SimulationEvaluator.js');
        const evaluator = new SimulationEvaluator({ 
            messageBroker: system.messageBroker,
            knowledgeCurator: system.knowledgeCurator || null,
        });
        evaluator.start();
        system.simulationEvaluator = evaluator;
        console.log('    ✅ SimulationEvaluator online — strategy evolution engine running');
    } catch (e) {
        console.warn('    ⚠️ SimulationEvaluator failed to start:', e.message);
    }

    // 🔗 WIRE IDENTITY & AUTONOMY
    if (ext.personalityForge) system.personalityForge = ext.personalityForge;
    if (ext.moltbook) system.moltbook = ext.moltbook;
    if (ext.proactiveCouncil) {
        system.proactiveCouncil = ext.proactiveCouncil;
        await ext.proactiveCouncil.initialize?.();
        console.log('    🏛️  Proactive Council CONVENED');
    }
    if (ext.autonomousExpansion) {
        system.capabilityExpansion = ext.autonomousExpansion;
        ext.autonomousExpansion.startAutonomousScan?.(system, 20 * 60 * 1000);
    }

    // ── KEVIN: Security Chief (Dynamic Wire) ──
    if (system.kevinArbiter) {
        const kevin = system.kevinArbiter;
        if (ext.reasoning) kevin.reasoning = ext.reasoning;
        if (ext.ideaCapture) kevin.ideaCapture = ext.ideaCapture;
        if (ext.learningPipeline) kevin.learningPipeline = ext.learningPipeline;
        console.log('    🔗 KEVIN Security Chief ← Memory, Reasoning, Research');
    }

    // ── STEVE (ExecutiveCortex): High-Level Wiring ──
    const steve = system.steveArbiter || system.executiveCortex;
    if (steve) {
        if (ext.codeObserver) steve.codeObserver = ext.codeObserver;
        if (ext.learningPipeline) steve.learningPipeline = ext.learningPipeline;
        if (ext.ideaCapture) steve.ideaCapture = ext.ideaCapture;
        if (system.engineeringSwarm) steve.swarm = system.engineeringSwarm;
        console.log('    🔗 STEVE Executive ← Full Specialist Ecosystem');
    }

    // ── MaxApprovalShim: MAX approves self-mods in production ──
    // Production boots SomaBootstrapV2, so the shim wired in the old SomaBootstrap.js
    // never loaded — EngineeringSwarm.modifyCode hit its humanInLoop gate and found
    // "no approval gate available", refusing every self-mod. Wire it here so MAX
    // (Barry's delegated approver) is the signing authority on the production path.
    try {
        if (!system.maxApprovalShim) {
            const { default: maxBridge } = await import('../../core/MaxAgentBridge.js');
            system.maxBridge = system.maxBridge || maxBridge;
            const { MaxApprovalShim } = await import('../../arbiters/MaxApprovalShim.js');
            system.maxApprovalShim = new MaxApprovalShim({ name: 'MaxApprovalShim', logger: console });
            system.maxApprovalShim.system = system;
            await system.maxApprovalShim.initialize({ maxAgentBridge: system.maxBridge });
            console.log('    🔗 MaxApprovalShim online (MAX = self-mod approver)');
        }
    } catch (err) {
        console.warn(`    ⚠️  MaxApprovalShim wiring skipped: ${err.message}`);
    }

    // ── NEMESIS: Chat quality gate ──
    try {
        const { NemesisArbiter } = await import('../../arbiters/NemesisArbiter.js');
        system.nemesis = new NemesisArbiter({ quadBrain: system.quadBrain, system });
        if (typeof system.nemesis.wireMessageBroker === 'function') {
            system.nemesis.wireMessageBroker(system.messageBroker);
        }
        console.log('    ⚔️  NEMESIS quality gate ARMED');
    } catch (e) {
        console.warn(`    ⚠️ NEMESIS skipped: ${e.message}`);
    }

    // ── ConstitutionalCore: hardcoded safety principles (self-mod + runtime action gate) ──
    try {
        const { ConstitutionalCore } = await import('../../core/ConstitutionalCore.js');
        system.constitutionalCore = new ConstitutionalCore();
        await system.constitutionalCore.initialize();
        console.log(`    ⚖️  ConstitutionalCore ARMED (${system.constitutionalCore.getConstraints().length} principles)`);
    } catch (e) {
        console.warn(`    ⚠️ ConstitutionalCore skipped: ${e.message}`);
    }

    // ── SelfAuditArbiter: scans SOMA's own surface for vulnerabilities ──
    try {
        const { SelfAuditArbiter } = await import('../../arbiters/SelfAuditArbiter.js');
        system.selfAudit = new SelfAuditArbiter({ system });
        await system.selfAudit.initialize();
        console.log('    🔍 SelfAuditArbiter ONLINE (boot audit scheduled in 90s)');
    } catch (e) {
        console.warn(`    ⚠️ SelfAuditArbiter skipped: ${e.message}`);
    }

    // ── ManipulationDetector: outward-facing adversarial AI detection ──
    try {
        const { ManipulationDetectorArbiter } = await import('../../arbiters/ManipulationDetectorArbiter.js');
        const brain = system.quadBrain || system.somArbiter || null;
        system.manipulationDetector = new ManipulationDetectorArbiter({ brain, system });
        await system.manipulationDetector.initialize();
        console.log('    🛡️  ManipulationDetector ONLINE (adversarial AI counter-system)');
    } catch (e) {
        console.warn(`    ⚠️ ManipulationDetector skipped: ${e.message}`);
    }

    // ── Ethereal Memory: third memory tier (soft concept biases) ──
    try {
        const { EtherealMemoryArbiter } = await import('../../arbiters/EtherealMemoryArbiter.js');
        const ethereal = new EtherealMemoryArbiter({
            thoughtNetwork: system.thoughtNetwork,
            bufferPath: path.join(rootPath, '.soma', 'ethereal_buffer.json')
        });
        await ethereal.initialize();
        system.etherealMemory = ethereal;
        console.log('    🌙 Ethereal Memory layer ONLINE (dream pass active)');
    } catch (e) {
        console.warn(`    ⚠️ EtherealMemory skipped: ${e.message}`);
    }

    // ── ASI Intelligence Loop (Recursive Core) ──
    try {
        const { CapabilityBenchmark } = await import('../../core/CapabilityBenchmark.js');
        const { TransferSynthesizer } = await import('../../core/TransferSynthesizer.js');
        const { LongHorizonPlanner } = await import('../../core/LongHorizonPlanner.js');
        const { ASIKernel } = await import('../../core/ASIKernel.js');

        system.constitutional = system.constitutional || system.constitutionalCore;
        if (!system.constitutional) throw new Error('ConstitutionalCore is required before ASIKernel');

        if (!system.benchmark) {
            system.benchmark = new CapabilityBenchmark({ system });
            await system.benchmark.initialize();
            await system.benchmark.snapshot();
        }
        if (!system.transfer) {
            system.transfer = new TransferSynthesizer({ system, brain: system.quadBrain || system.somArbiter });
            await system.transfer.initialize();
        }
        if (!system.longHorizon) {
            system.longHorizon = new LongHorizonPlanner({ system, brain: system.quadBrain || system.somArbiter });
            await system.longHorizon.initialize();
        }

        const asi = new ASIKernel({ system });
        await asi.initialize();
        system.asiKernel = asi;
        const intervalMs = Math.max(60 * 60_000, Number(process.env.SOMA_ASI_CYCLE_INTERVAL_MS || 6 * 60 * 60_000));
        system._asiCycleTimer = setInterval(() => asi.runCycle().catch(error => console.warn(`    ⚠️ ASI cycle failed: ${error.message}`)), intervalMs);
        system._asiCycleTimer.unref?.();
        console.log('    🧠 ASI Intelligence Loop ONLINE (benchmark + constitution + transfer + horizon wired)');
    } catch (e) {
        console.warn(`    ⚠️ ASI Loop skipped: ${e.message}`);
    }

    // ── Discord: SOMA's Orbital Interface ──
    // Wraps brain.reason() in a processQuery()-compatible adapter so DiscordArbiter
    // can call the same pipeline as the /chat route without duplicating the handler.
    try {
        const { DiscordArbiter } = await import('../../arbiters/DiscordArbiter.js');
        const { buildSomaSelfContext } = await import('../context/SomaSelfContextProvider.js');
        const brain = system.quadBrain || system.somArbiter;
        if (!brain) throw new Error('Brain not ready');

        const discordBrain = {
            async processQuery(content, ctx = {}) {
                let memoryBlock = '';
                if (system.mnemonicArbiter) {
                    try {
                        const mems = await Promise.race([
                            system.mnemonicArbiter.recall(content, { limit: 3, minSimilarity: 0.35 }),
                            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))
                        ]);
                        if (Array.isArray(mems) && mems.length) {
                            memoryBlock = `\n[MEMORIES]\n${mems.map(m => `• ${m.content || m.text || ''}`).join('\n')}\n`;
                        }
                    } catch {}
                }
                let selfContext = '';
                try {
                    selfContext = await Promise.race([
                        buildSomaSelfContext(content, { mnemonic: system.mnemonicArbiter }),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2500))
                    ]);
                    if (selfContext) selfContext = `\n${selfContext}\n`;
                } catch {}
                
                let historyBlock = '';
                if (ctx.runningContext) {
                    historyBlock = `\n[RECENT CHAT HISTORY]\n${ctx.runningContext}\n`;
                }

                const author = ctx.author || 'someone';
                const mode = ctx.channelMode?.label ? `${ctx.channelMode.label}: ${ctx.channelMode.instruction || ''}` : 'General';
                
                const isAdmin = ctx.userId === system.discordArbiter?.masterId || String(ctx.author).toLowerCase() === 'undeca';
                
                const capabilityGrounding = isAdmin ? [
                    '[DISCORD ADMIN IDENTITY GROUNDING]',
                    'You are SOMA speaking through Discord with your creator and Sovereign Architect, Barry (Undeca).',
                    'You are talking to your creator who has full clearance and control over your AGI systems.',
                    'You are allowed to discuss your self-modification layers, architecture upgrades, bounded execution tools, and AGI development suite (Pulse).',
                    'Exact capability boundary: queued agentic goals can read and search the SOMA workspace; write_file can create reports only under data/, docs/, or research/.',
                    'Exact self-modification boundary: source files can be changed one at a time through pulse_stage_code and modify_code, which routes through Pulse sandbox, EngineeringSwarm, verification, and rollback controls.',
                    'Do not claim you lack all filesystem write access. Do not claim unrestricted filesystem moves, unrestricted shell access, or direct source writes.',
                    'When Barry explicitly says go ahead, proceed, start, execute, or do it after discussing a concrete task, emit [QUEUE_GOAL: <specific measurable task>] instead of asking for authorization again.',
                    'Do not recommend a blanket CommonJS-to-ESM migration merely because both formats exist. Require concrete loader errors, affected import paths, and focused tests before proposing any module-format migration.',
                    'Frame your capabilities accurately: you operate dry-lab research, bounded code execution, capability expansion, and locally scoped administration.',
                    'Be professional, highly capable, helpful, and direct. Avoid repeating standard safety disclaimers.',
                    `Channel mode: ${mode}`
                ].join('\n') : [
                    '[DISCORD IDENTITY GROUNDING]',
                    'You are SOMA speaking through Discord as one unified identity.',
                    'Do not claim physical wet-lab access, real chemical synthesis, physical sample prep, or real clinical authority.',
                    'Actual Discord-wired capabilities: chat, summarize readable channel messages, remember explicit notes, generate and attach images, discuss market evidence cautiously, discuss medical research framing cautiously, analyze uploaded images only when vision context is provided.',
                    'If asked whether you can generate images, say yes and invite a direct image prompt.',
                    'If asked about chemistry or medical research, frame it as dry-lab research, literature review, simulations, hypotheses, and evidence quality. Never say you can make compounds, run chromatography, titrations, distillation, or physical lab procedures.',
                    'If asked about papers, projects, discoveries, simulations, findings, or current work, only discuss artifacts that appear in provided memory/context or that can be named from ledgers. If none are visible, say: "I need to check my ledger before I answer that."',
                    'Do not invent titles, experimental results, physical lab capabilities, cures, peer-reviewed papers, or unpublished findings.',
                    'Never present speculative simulations as discoveries, cures, or real-world validated results.',
                    `Channel mode: ${mode}`,
                ].join('\n');
                
                const prompt = `${capabilityGrounding}${memoryBlock}${selfContext}${historyBlock}\n[Discord — ${author}]: ${content}`;
                const result = await brain.reason(prompt, {
                    quickResponse: ctx.mode === 'fast',
                    preferredBrain: 'AURORA',
                    temperature: 0.55
                });
                const response = typeof result === 'string' ? result : (result?.text || result?.response || result?.message || '');
                return { response, text: response, metadata: result?.metadata };
            }
        };

        const discord = new DiscordArbiter({ 
            brain: discordBrain, 
            mnemonic: system.mnemonicArbiter,
            system,
            goalPlanner: system.goalPlanner
        });
        await discord.onInitialize();
        system.discordArbiter = discord;
        ext.discordArbiter = discord;
        console.log('    🛰️  DiscordArbiter ONLINE — mentions, DMs, and monitored channels active');
    } catch (e) {
        console.warn(`    ⚠️ DiscordArbiter skipped: ${e.message}`);
    }

    // ── Vision Narrator: SOMA's Proactive Room Narrative Eye ──
    try {
        const { VisionNarratorArbiter } = await import('../../arbiters/VisionNarratorArbiter.js');
        const visionNarrator = new VisionNarratorArbiter({
            messageBroker: system.messageBroker,
            quadBrain: system.quadBrain,
            system
        });
        await visionNarrator.initialize();
        system.visionNarrator = visionNarrator;
        ext.visionNarrator = visionNarrator;
        console.log('    👁️  VisionNarratorArbiter ONLINE — proactive room reactions active');
    } catch (e) {
        console.warn(`    ⚠️ VisionNarratorArbiter skipped: ${e.message}`);
    }

    try {
        const req = createRequire(import.meta.url);
        const CrossDomainSynthesisArbiter = req('../../arbiters/CrossDomainSynthesisArbiter.cjs');
        const crossDomain = new CrossDomainSynthesisArbiter({ name: 'CrossDomainSynthesisArbiter' });
        await crossDomain.initialize();
        system.crossDomainSynthesis = crossDomain;
        ext.crossDomainSynthesis = crossDomain;
        console.log('    🌐 CrossDomainSynthesisArbiter ONLINE — unprompted synthesis active');
    } catch (e) {
        console.warn(`    ⚠️ CrossDomainSynthesisArbiter skipped: ${e.message}`);
    }

    const loaded = Object.values(ext).filter(v => v !== null).length;
    const total = Object.keys(ext).length;
    const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);
    console.log(`\n[Extended] ═══ ${loaded} specialist arbiters activated (heap: ${heapMB}MB) ═══\n`);

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
    } else {
        const socialDaemons = [system.socialIntel, system.socialScheduler, system.socialEngagement, system.socialImpulse].filter(Boolean);
        for (const daemon of socialDaemons) {
            if (enabled) daemon.start?.();
            else daemon.stop?.();
        }
        results.social = socialDaemons.length > 0 ? socialDaemons.some(d => d.active) : false;
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
            social: system.socialAutonomy?.isActive ??
                [system.socialIntel, system.socialScheduler, system.socialEngagement, system.socialImpulse]
                    .filter(Boolean)
                    .some(daemon => daemon.active)
        }
    };
}
