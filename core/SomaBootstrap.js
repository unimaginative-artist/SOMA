import {
    join
} from 'path';
import crypto from 'crypto';
// import { pipeline } from '@xenova/transformers'; // DISABLED to prevent sharp crash
import toolRegistry from './ToolRegistry.js';
import { SafeArbiter } from './SafeArbiter.js';

// ── ASI Systems ──────────────────────────────────────────────────────────────
import { ConstitutionalCore }   from './ConstitutionalCore.js';
import { CapabilityBenchmark }  from './CapabilityBenchmark.js';
import { TransferSynthesizer }  from './TransferSynthesizer.js';
import { LongHorizonPlanner }   from './LongHorizonPlanner.js';
import { ASIKernel }            from './ASIKernel.js';

export class SomaBootstrap {
    constructor(rootPath, config) {
        this.rootPath = rootPath;
        this.config = config;
        this.system = {};
    }

    async initialize() {
        console.log('╔═══════════════════════════════════════════════════════════════════════╗');
        console.log('║  SOMA Bootstrap - Trinity Architecture Initialization                ║');
        console.log('║  Level 4.5 UNLEASHED - Safe Mode                                     ║');
        console.log('║  🔱 Three Pillars: Instinct | Knowledge | Causality                  ║');
        console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

        try {
            // Initialize Trinity Core Architecture (The Three Pillars + Internal Organs)
            console.log('🔱 Initializing Trinity Core Architecture...\n');
            await this._initializeTrinityCoreArchitecture();

            console.log('\n🎉 Trinity Core Complete! Now adding autonomous enhancement systems...\n');

            // Phase 1: Load autonomous enhancement modules
            const modules = await this._phase1_loadModules();

            // Phase 3: Add autonomous learning systems (on top of Trinity)
            await this._phase3_learningSystems(modules);

            // Phase ASI: Close the recursive self-improvement loop
            await this._phase_asi();

            // Phase Perception: Boot daemon layer, attention engine, and engineering swarm
            await this._phase_perception();

            console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
            console.log('║  🎉 SOMA Bootstrap Complete!                                         ║');
            console.log('║  🔱 Trinity Architecture: ACTIVE                                     ║');
            console.log('║  🧠 Autonomous Systems: ACTIVE                                       ║');
            console.log('║  ⚡ ASI Kernel: ACTIVE                                               ║');
            console.log('║  👁️  Perception Layer: ACTIVE                                        ║');
            console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

            // Generate Trinity Status Report
            try {
                const { TrinityStatusGenerator } = await import('./TrinityStatusGenerator.js');
                const generator = new TrinityStatusGenerator(this.system);
                await generator.saveToFile('./TRINITY_STATUS.md');
            } catch (error) {
                console.warn('⚠️ Failed to generate Trinity status report:', error.message);
            }

            return this.system;
        } catch (error) {
            console.error('\n❌ BOOTSTRAP FAILED:', error.message);
            console.error('Stack:', error.stack);
            // ArbiterError stores the inner error in .context.cause — log it so we can see the real problem
            const cause = error.context?.cause || error.cause;
            if (cause) {
                console.error('Root cause:', cause.message);
                console.error('Root cause stack:', cause.stack);
            }
            throw error;
        }
    }

    /**
     * Trinity Core Architecture Initialization
     *
     * This method initializes SOMA's three-pillar cognitive architecture:
     * - Pillar 1: Instinct (SOMA-1T LLM)
     * - Pillar 2: Knowledge (ThoughtNetwork, Fractals)
     * - Pillar 3: Causality (Crona, Merovingian)
     *
     * Plus critical internal organs:
     * - WorldModel (Imagination)
     * - BeliefSystem (The Spine)
     * - EmotionalEngine (The Pulse)
     * - QuadBrain (4-perspective reasoning)
     */
    async _initializeTrinityCoreArchitecture() {
        console.log('📦 Loading SOMA components (Bootstrap Mode - Level 4.5 UNLEASHED - Safe Mode)...');

        // Startup performance tracking
        const startupTimes = {};
        const startTime = Date.now();
        let lastCheckpoint = startTime;

        const logTiming = (component) => {
            const now = Date.now();
            const elapsed = now - lastCheckpoint;
            startupTimes[component] = elapsed;
            if (elapsed > 1000) {
                console.log(`   ⏱️  ${component}: ${(elapsed / 1000).toFixed(2)}s`);
            }
            lastCheckpoint = now;
        };

        // Setup CommonJS require for .cjs modules
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);

        // Dynamic Imports - Core Arbiters
        console.log('   - Importing LoadPipelineArbiter...');
        const { LoadPipelineArbiter } = await import('../arbiters/LoadPipelineArbiter.js');
        console.log('   - Importing AdaptiveLearningRouter...');
        const { AdaptiveLearningRouter } = await import('../arbiters/AdaptiveLearningRouter.js');
        console.log('   - Importing SOMArbiterV3 (Unified SOMA Brain)...');
        const { SOMArbiterV3 } = await import('../arbiters/SOMArbiterV3.js');
        console.log('   - Importing IdeaCaptureArbiter...');
        const { IdeaCaptureArbiter } = await import('../arbiters/IdeaCaptureArbiter.js');
        console.log('   - Importing MuseEngine...');
        const { MuseEngine } = await import('../arbiters/MuseEngine.js');
        console.log('   - Importing UniversalLearningPipeline...');
        const { UniversalLearningPipeline } = await import('../arbiters/UniversalLearningPipeline.js');
        console.log('   - Importing CausalityArbiter...');
        const { CausalityArbiter } = await import('../arbiters/CausalityArbiter.js');
        console.log('   - Importing WorldModelArbiter...');
        const { WorldModelArbiter } = await import('../arbiters/WorldModelArbiter.js');
        console.log('   - Importing AbstractionArbiter...');
        const { AbstractionArbiter } = await import('../arbiters/AbstractionArbiter.js');
        console.log('   - Importing ReasoningChamber...');
        const { ReasoningChamber } = await import('../arbiters/ReasoningChamber.js');
        console.log('   - Importing MnemonicArbiter...');
        const MnemonicArbiterModule = await import('../arbiters/MnemonicArbiter.js');
        console.log('   - Importing MessageBroker...');
        const MessageBrokerModule = await import('./MessageBroker.js');
        console.log('   - Importing NighttimeLearningOrchestrator...');
        const { NighttimeLearningOrchestrator } = await import('./NighttimeLearningOrchestrator.js');
        console.log('   - Importing StorageArbiter...');
        const { StorageArbiter } = await import('../arbiters/StorageArbiter.js');
        console.log('   - Importing DeploymentArbiter...');
        const { DeploymentArbiter } = await import('../arbiters/DeploymentArbiter.js');
        console.log('   - Importing GPUTrainingArbiter...');
        const { GPUTrainingArbiter } = await import('../arbiters/GPUTrainingArbiter.js');
        console.log('   - Importing BabyAGIManager...');
        const { BabyAGIManager } = await import('./BabyAGIManager.mjs');
        // KEVINManager removed - using KevinArbiter in launcher_ULTRA.mjs instead
        console.log('   - Importing LocalModelServer...');
        const { LocalModelServer } = await import('./LocalModelServer.js');
        console.log('   - Importing IntelligentRouter...');
        const { IntelligentRouter } = await import('./IntelligentRouter.js');
        console.log('   - Importing SyntheticDataGenerator...');
        const { SyntheticDataGenerator } = await import('./SyntheticDataGenerator.js');
        console.log('   - Importing AutoTrainingCoordinator...');
        const { AutoTrainingCoordinator } = await import('./AutoTrainingCoordinator.js');
        console.log('   - Importing MetaLearningEngine...');
        const { MetaLearningEngine } = await import('../arbiters/MetaLearningEngine.js');
        console.log('   - Importing FragmentRegistry...');
        const { FragmentRegistry } = await import('../arbiters/FragmentRegistry.js');
        console.log('   - Importing FragmentCommunicationHub...');
        const { FragmentCommunicationHub } = await import('../arbiters/FragmentCommunicationHub.js');
        console.log('   - Importing SelfImprovementCoordinator...');
        const { SelfImprovementCoordinator } = await import('../arbiters/SelfImprovementCoordinator.js');
        console.log('   - Importing AnomalyDetector...');
        const { AnomalyDetector, getAnomalyDetector } = await import('../arbiters/AnomalyDetector.js');
        console.log('   - Importing KnowledgeGraphFusion...');
        const { KnowledgeGraphFusion } = await import('../arbiters/KnowledgeGraphFusion.js');
        console.log('   - Importing RecursiveSelfModel...');
        const { RecursiveSelfModel } = await import('../arbiters/RecursiveSelfModel.js');
        console.log('   - Importing CuriosityEngine...');
        const CuriosityEngineModule = await import('../arbiters/CuriosityEngine.js');
        const CuriosityEngine = CuriosityEngineModule.default || CuriosityEngineModule.CuriosityEngine;
        console.log('   - Importing PerformanceOracle...');
        const { PerformanceOracle } = await import('../arbiters/PerformanceOracle.js');
        console.log('   - Importing TrainingCoordinator...');
        const { TrainingCoordinator } = await import('../arbiters/TrainingCoordinator.js');
        console.log('   - Importing TheoryOfMindArbiter...');
        const TheoryOfMindArbiterModule = await import('../arbiters/TheoryOfMindArbiter.cjs');
        const TheoryOfMindArbiter = TheoryOfMindArbiterModule.default || TheoryOfMindArbiterModule.TheoryOfMindArbiter;
        console.log('   - Importing CodeObservationArbiter...');
        const { CodeObservationArbiter } = await import('../arbiters/CodeObservationArbiter.js');
        console.log('   - Importing SteveArbiter...');
        const SteveArbiter = require('../arbiters/SteveArbiter.cjs');
        console.log('   - Importing FixProposalSystem...');
        const { FixProposalSystem } = await import('./FixProposalSystem.js');
        console.log('   - Importing ConversationHistoryArbiter...');
        const { ConversationHistoryArbiter } = await import('../arbiters/ConversationHistoryArbiter.js');
        console.log('   - Importing UserProfileArbiter...');
        const { UserProfileArbiter } = await import('../arbiters/UserProfileArbiter.js');
        console.log('   - Importing PersonalityForgeArbiter...');
        const { PersonalityForgeArbiter } = await import('../arbiters/PersonalityForgeArbiter.js');
        console.log('   - Importing TrainingDataExporter...');
        const { TrainingDataExporter } = await import('../arbiters/TrainingDataExporter.js');
        console.log('   - Importing OllamaAutoTrainer...');
        const { OllamaAutoTrainer } = await import('./OllamaAutoTrainer.js');
        console.log('   - Importing ContinuousLearningBridge...');
        const { ContinuousLearningBridge } = await import('./ContinuousLearningBridge.js');
        // ImmuneSystemArbiter replaced by SelfHealingCloningGuardianArbiter (GuardianV2)
        console.log('   - Importing QuantumSimulationArbiter...');
        const { QuantumSimulationArbiter } = await import('../arbiters/QuantumSimulationArbiter.js');
        console.log('   - Importing SimulationArbiter...');
        const SimulationArbiterModule = await import('../arbiters/SimulationArbiter.cjs');
        const SimulationArbiter = SimulationArbiterModule.SimulationArbiter || SimulationArbiterModule.default?.SimulationArbiter || SimulationArbiterModule.default;
        console.log('   - Importing SimulationControllerArbiter...');
        const SimulationControllerArbiterModule = await import('../arbiters/SimulationControllerArbiter.cjs');
        const SimulationControllerArbiter = SimulationControllerArbiterModule.SimulationControllerArbiter || SimulationControllerArbiterModule.default?.SimulationControllerArbiter || SimulationControllerArbiterModule.default;
        console.log('   - Importing DemonstrationLearner...');
        const { DemonstrationLearner } = await import('../arbiters/DemonstrationLearner.cjs');
        console.log('   - Importing RedisMockArbiter...');
        const { RedisMockArbiter } = await import('../arbiters/RedisMockArbiter.js');
        console.log('   - Importing GistArbiter...');
        const { GistArbiter } = await import('../arbiters/GistArbiter.js');
        console.log('   - Importing MicroAgentPool...');
        const MicroAgentPoolModule = await import('../microagents/MicroAgentPool.cjs');
        const { MicroAgentPool } = MicroAgentPoolModule.default || MicroAgentPoolModule;
        console.log('   - Importing FractalSyncService...');
        const FractalSyncServiceModule = await import('../cluster/FractalSyncService.cjs');
        const { FractalSyncService } = FractalSyncServiceModule.default || FractalSyncServiceModule;

        console.log('   - Importing Watchdog...');
        const { Watchdog } = await import('./Watchdog.js');
        console.log('   - Importing HippocampusArbiter (Memory Cortex)...');
        const { HippocampusArbiter } = await import('../arbiters/HippocampusArbiter.js');
        console.log('   - Importing ExecutiveCortexArbiter (Action Lobe)...');
        const { ExecutiveCortexArbiter } = await import('../arbiters/ExecutiveCortexArbiter.js');
        console.log('   - Importing SensoryCortexArbiter (Perception Lobe)...');
        const { SensoryCortexArbiter } = await import('../arbiters/SensoryCortexArbiter.js');
        console.log('   - Importing ImmuneCortexArbiter (Survival Lobe)...');
        const { ImmuneCortexArbiter } = await import('../arbiters/ImmuneCortexArbiter.js');
        console.log('   - Importing StrategyCortexArbiter (Planning Lobe)...');
        const { StrategyCortexArbiter } = await import('../arbiters/StrategyCortexArbiter.js');
        
        console.log('   - Importing ConversationCompressor...');
        const { ConversationCompressor } = await import('./ConversationCompressor.js');
        console.log('   - Importing CriticAlignmentService...');
        const { CriticAlignmentService } = await import('../arbiters/CriticAlignmentService.js');
        
        console.log('   - Importing ReflexArbiter...');
        const { ReflexArbiter } = await import('../arbiters/ReflexArbiter.js');
        console.log('   - Importing ReflexScoutArbiter...');
        const { ReflexScoutArbiter } = await import('../arbiters/ReflexScoutArbiter.js');
        console.log('   - Importing SkillWatcherArbiter...');
        const { SkillWatcherArbiter } = await import('../arbiters/SkillWatcherArbiter.js');
        console.log('   - Importing MerovingianCortex...');
        const MerovingianCortexModule = await import('../cognitive/MerovingianCortex.cjs');
        const MerovingianCortex = MerovingianCortexModule.default || MerovingianCortexModule;
        console.log('   - Importing GenomeArbiter...');
        const GenomeArbiterModule = await import('../arbiters/GenomeArbiter.cjs');
        const GenomeArbiter = GenomeArbiterModule.default || GenomeArbiterModule;
        
        console.log('   - Importing SyntheticLayeredCortex...');
        const SyntheticLayeredCortexModule = await import('../cognitive/SyntheticLayeredCortex.cjs');
        const SyntheticLayeredCortex = SyntheticLayeredCortexModule.default || SyntheticLayeredCortexModule;

        console.log('   - Importing SelfHealingCloningGuardianArbiter...');
        const { SelfHealingCloningGuardianArbiter } = await import('../arbiters/GuardianArbiterV2.js');

        // Import KnowledgeBridge (ES module)
        const KnowledgeBridgeModule = await import('./KnowledgeBridge.js');
        const KnowledgeBridge = KnowledgeBridgeModule.default || KnowledgeBridgeModule.KnowledgeBridge;

        // Phase 3: Load ArbiterOrchestrator (CommonJS)
        const ArbiterOrchestratorModule = await import('./ArbiterOrchestrator.cjs');
        const ArbiterOrchestrator = ArbiterOrchestratorModule.default || ArbiterOrchestratorModule.ArbiterOrchestrator;

        // Phase 3: Load Critical Infrastructure (CommonJS)
        console.log('   - Importing LoadManager...');
        const LoadManagerModule = await import('./LoadManager.cjs');
        const LoadManager = (LoadManagerModule.default && LoadManagerModule.default.LoadManager) || LoadManagerModule.LoadManager;

        console.log('   - Importing AGI-Integration...');
        // Use existing createRequire from line 92
        const requireCJS = createRequire(import.meta.url);

        const AGIIntegrationModule = requireCJS('./AGI-Integration.cjs');
        const AGISystemIntegration = AGIIntegrationModule.default || AGIIntegrationModule.AGISystemIntegration || AGIIntegrationModule;

        console.log('   - Importing NoveltyTracker...');
        const NoveltyTrackerModule = requireCJS('../arbiters/NoveltyTracker.cjs');
        const NoveltyTracker = NoveltyTrackerModule.NoveltyTracker || NoveltyTrackerModule.default || NoveltyTrackerModule;

        console.log('   - Importing ConservativeArbiter...');
        const ConservativeArbiterModule = requireCJS('../arbiters/ConservativeArbiter.cjs');
        const ConservativeArbiter = ConservativeArbiterModule.ConservativeArbiter || ConservativeArbiterModule.default || ConservativeArbiterModule;

        console.log('   - Importing ProgressiveArbiter...');
        const ProgressiveArbiterModule = requireCJS('../arbiters/ProgressiveArbiter.cjs');
        const ProgressiveArbiter = ProgressiveArbiterModule.ProgressiveArbiter || ProgressiveArbiterModule.default || ProgressiveArbiterModule;

        // Phase 2B: Training Pipeline Components
        console.log('   - Importing BootstrapTrainingArbiter...');
        const { BootstrapTrainingArbiter } = await import('../arbiters/BootstrapTrainingArbiter.js');

        const requireRT = createRequire(import.meta.url);
        const RegressionTesterModule = requireRT('../arbiters/RegressionTester.cjs');
        const RegressionTester = RegressionTesterModule.default || RegressionTesterModule.RegressionTester || RegressionTesterModule;

        console.log('   - Importing StrategyOptimizer...');
        const StrategyOptimizerModule = await import('../arbiters/StrategyOptimizer.js');
        const StrategyOptimizer = StrategyOptimizerModule.default || StrategyOptimizerModule.StrategyOptimizer;

        console.log('   - Importing MixedPrecisionArbiter...');
        const { MixedPrecisionArbiter } = await import('../arbiters/MixedPrecisionArbiter.js');

        console.log('   - Importing AsyncGradientArbiter...');
        const { AsyncGradientArbiter } = await import('../arbiters/AsyncGradientArbiter.js');

        console.log('   - Importing ExperienceReplayBuffer...');
        const ExperienceReplayBufferModule = await import('../arbiters/ExperienceReplayBuffer.js');
        const ExperienceReplayBuffer = ExperienceReplayBufferModule.default || ExperienceReplayBufferModule.ExperienceReplayBuffer;

        // Phase 2C: Trading System Components
        console.log('   - Importing MarketRegimeDetector...');
        const { MarketRegimeDetector } = await import('../arbiters/MarketRegimeDetector.js');

        console.log('   - Importing MultiTimeframeAnalyzer...');
        const { MultiTimeframeAnalyzer } = await import('../arbiters/MultiTimeframeAnalyzer.js');

        console.log('   - Importing AdaptivePositionSizer...');
        const { AdaptivePositionSizer } = await import('../arbiters/AdaptivePositionSizer.js');

        console.log('   - Importing EconomicCalendar...');
        const { EconomicCalendar } = await import('../arbiters/EconomicCalendar.js');

        console.log('   - Importing SentimentAggregator...');
        const { SentimentAggregator } = await import('../arbiters/SentimentAggregator.js');

        console.log('   - Importing PerformanceAnalytics...');
        const { PerformanceAnalytics } = await import('../arbiters/PerformanceAnalytics.js');

        console.log('   - Importing SmartOrderRouter...');
        const { SmartOrderRouter } = await import('../arbiters/SmartOrderRouter.js');

        console.log('   - Importing BacktestEngine...');
        const { BacktestEngine } = await import('../arbiters/BacktestEngine.js');

        console.log('   - Importing ComputerControlArbiter...');
        const { ComputerControlArbiter } = await import('../arbiters/ComputerControlArbiter.js');

        console.log('   ✅ All components imported');

        // Initialize Embedding Pipeline - DISABLED for fast startup
        console.log('   🧠 Loading embedding model for IdeaCaptureArbiter (Xenova Transformers)...');
        let embedder = null;
        try {
            // const { pipeline } = await import('@xenova/transformers');
            // embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            console.log('   ⏩ Embedding model skipped for speed (FAST BOOT).');
        } catch (e) {
            console.warn('   ⚠️  Embedding pipeline failed to load:', e.message);
        }

        console.log('\n🚀 Initializing SOMA QuadBrain System...');

        // MessageBroker
        this.system.messageBroker = MessageBrokerModule.default || MessageBrokerModule;
        console.log('   ✅ MessageBroker ready');

        // Anomaly Detector (Automatic Issue Detection & Logging)
        this.system.anomalyDetector = getAnomalyDetector({ rootPath: process.cwd() });
        await this.system.anomalyDetector.initialize();
        this.system.anomalyDetector.hookMessageBroker(this.system.messageBroker);
        this.system.anomalyDetector.hookGlobalErrors();
        console.log('   ✅ AnomalyDetector ready (monitoring all errors)');

        // LoadManager - System Protection (P0 - Critical Infrastructure)
        this.system.loadManager = new LoadManager({ logger: console });
        console.log('   ✅ LoadManager ready (system protection active)');

        // LoadPipeline - ENABLED (Non-blocking)
        this.system.loadPipeline = new LoadPipelineArbiter({ name: 'LoadPipelineArbiter', mode: this.config.mode });
        await this.system.loadPipeline.initialize();
        console.log('   ✅ LoadPipeline ready');

        // Redis Mock (Hot Tier)
        this.system.redisMock = new RedisMockArbiter({ name: 'RedisMockArbiter' });
        await this.system.redisMock.initialize();
        console.log('   ✅ Redis Mock (Hot Tier) ready');

        // Mnemonic
        const MnemonicArbiter = MnemonicArbiterModule.default || MnemonicArbiterModule.MnemonicArbiter;
        this.system.mnemonic = new MnemonicArbiter({
            name: 'MnemonicArbiter',
            redisUrl: process.env.REDIS_URL,
            cache: this.system.redisMock,
            embedder: embedder,
            skipEmbedder: true
        });
        
        // 🧠 HIPPOCAMPUS (Unified Memory Cortex)
        // Consolidates Mnemonic and ThoughtNetwork into a single neural lobe
        this.system.hippocampus = new HippocampusArbiter({
            mnemonic: this.system.mnemonic
        });
        await this.system.hippocampus.initialize();
        this.system.messageBroker.registerArbiter('HippocampusArbiter', { instance: this.system.hippocampus });
        console.log('   ✅ Memory Cortex (Hippocampus) ready');

        // PersonalityForge - SOMA's unique personality
        this.system.personalityForge = new PersonalityForgeArbiter({ name: 'PersonalityForgeArbiter' });
        await this.system.personalityForge.initialize({ mnemonic: this.system.mnemonic });
        this.system.messageBroker.registerArbiter('PersonalityForgeArbiter', { instance: this.system.personalityForge });
        console.log('   ✅ PersonalityForgeArbiter ready');

        // ConversationHistory - Persistent conversation memory
        this.system.conversationHistory = new ConversationHistoryArbiter({ name: 'ConversationHistoryArbiter' });
        await this.system.conversationHistory.initialize({
            mnemonic: this.system.mnemonic,
            personalityForge: this.system.personalityForge
        });
        this.system.messageBroker.registerArbiter('ConversationHistoryArbiter', { instance: this.system.conversationHistory });
        console.log('   ✅ ConversationHistoryArbiter ready');

        // UserProfile - Remember users across sessions
        this.system.userProfile = new UserProfileArbiter({ name: 'UserProfileArbiter' });
        await this.system.userProfile.initialize();
        this.system.messageBroker.registerArbiter('UserProfileArbiter', { instance: this.system.userProfile });
        console.log('   ✅ UserProfileArbiter ready');

        // TrainingDataExporter - Export data for fine-tuning
        this.system.trainingDataExporter = new TrainingDataExporter({ name: 'TrainingDataExporter' });
        await this.system.trainingDataExporter.initialize({
            conversationHistory: this.system.conversationHistory,
            personalityForge: this.system.personalityForge,
            userProfile: this.system.userProfile,
            mnemonic: this.system.mnemonic
        });
        this.system.messageBroker.registerArbiter('TrainingDataExporter', { instance: this.system.trainingDataExporter });
        console.log('   ✅ TrainingDataExporter ready');

        // Legacy Arbiters
        console.log('   🧩 Merging Legacy Arbiters...');
        const TimekeeperModule = await import('../arbiters/TimekeeperArbiter.cjs');
        const TimekeeperArbiter = TimekeeperModule.default || TimekeeperModule.TimekeeperArbiter;
        const UnifiedMemoryModule = await import('../arbiters/UnifiedMemoryArbiter.cjs');
        const UnifiedMemoryArbiter = UnifiedMemoryModule.default || UnifiedMemoryModule.UnifiedMemoryArbiter;
        const EmotionalEngineModule = await import('../cognitive/EmotionalEngine.cjs');
        const EmotionalEngine = EmotionalEngineModule.default || EmotionalEngineModule.EmotionalEngine;
        const PersonalityEngineModule = await import('../cognitive/PersonalityEngine.cjs');
        const PersonalityEngine = PersonalityEngineModule.default || PersonalityEngineModule.PersonalityEngine;

        this.system.timekeeper = new TimekeeperArbiter({ name: 'TimekeeperArbiter' });
        await this.system.timekeeper.initialize();
        this.system.unifiedMemory = new UnifiedMemoryArbiter({ name: 'UnifiedMemoryArbiter', enableUnifiedMemory: true });
        await this.system.unifiedMemory.initialize();
        this.system.emotional = new EmotionalEngine({ name: 'EmotionalEngine' });
        await this.system.emotional.initialize();
        this.system.personality = new PersonalityEngine(this.system.emotional);
        await this.system.personality.initialize();
        console.log('   ✅ Legacy Arbiters Merged');

        // ASI Layer
        console.log('   🧩 Integrating ASI Layer...');
        const ASIOrchestratorModule = await import('../arbiters/ASIOrchestrator.cjs');
        const ASIOrchestrator = ASIOrchestratorModule.default || ASIOrchestratorModule.ASIOrchestrator;
        const LearningVelocityTrackerModule = await import('../arbiters/LearningVelocityTracker.cjs');
        const LearningVelocityTracker = LearningVelocityTrackerModule.default || LearningVelocityTrackerModule.LearningVelocityTracker;
        const EdgeWorkerOrchestratorModule = await import('../arbiters/EdgeWorkerOrchestrator.cjs');
        const EdgeWorkerOrchestrator = EdgeWorkerOrchestratorModule.default || EdgeWorkerOrchestratorModule.EdgeWorkerOrchestrator;
        const SkillAcquisitionArbiterModule = await import('../arbiters/SkillAcquisitionArbiter.cjs');
        const SkillAcquisitionArbiter = SkillAcquisitionArbiterModule.default || SkillAcquisitionArbiterModule.SkillAcquisitionArbiter;

        this.system.velocityTracker = new LearningVelocityTracker({ name: 'LearningVelocityTracker' });
        await this.system.velocityTracker.initialize();
        console.log('   ✅ LearningVelocityTracker ready');

        this.system.edgeWorker = new EdgeWorkerOrchestrator({ name: 'EdgeWorkerOrchestrator' });
        await this.system.edgeWorker.initialize();
        console.log('   ✅ EdgeWorkerOrchestrator ready');

        // Knowledge Discovery Worker
        const KnowledgeDiscoveryWorkerModule = await import('../workers/KnowledgeDiscoveryWorker.cjs');
        const KnowledgeDiscoveryWorker = KnowledgeDiscoveryWorkerModule.KnowledgeDiscoveryWorker || KnowledgeDiscoveryWorkerModule.default?.KnowledgeDiscoveryWorker;
        this.system.knowledgeDiscoveryWorker = new KnowledgeDiscoveryWorker({ name: 'KnowledgeDiscoveryWorker' });
        await this.system.knowledgeDiscoveryWorker.initialize();
        this.system.messageBroker.registerArbiter('KnowledgeDiscoveryWorker', this.system.knowledgeDiscoveryWorker);
        console.log('   ✅ KnowledgeDiscoveryWorker ready');

        // Web Scraper Dendrite
        const WebScraperDendriteModule = await import('../cognitive/WebScraperDendrite.cjs');
        const WebScraperDendrite = WebScraperDendriteModule.WebScraperDendrite || WebScraperDendriteModule.default?.WebScraperDendrite;
        this.system.webScraperDendrite = new WebScraperDendrite({ name: 'WebScraperDendrite' });
        await this.system.webScraperDendrite.initialize();
        this.system.messageBroker.registerArbiter('WebScraperDendrite', this.system.webScraperDendrite);
        console.log('   ✅ WebScraperDendrite ready');

        this.system.skillAcquisition = new SkillAcquisitionArbiter({ name: 'SkillAcquisitionArbiter' });
        await this.system.skillAcquisition.initialize();
        console.log('   ✅ SkillAcquisitionArbiter ready (Skills Active)');

        this.system.asiOrchestrator = new ASIOrchestrator({ name: 'ASIOrchestrator' });
        await this.system.asiOrchestrator.initialize();
        console.log('   ✅ ASIOrchestrator ready (Phase 4 Active)');

        // DEVIL'S ADVOCATE (The Contrarian - Section 4.2)
        console.log('   🔥  Initializing Devil\'s Advocate (The Contrarian)...');
        const { DevilsAdvocateArbiter } = await import('../arbiters/DevilsAdvocateArbiter.js');
        this.system.devilsAdvocate = new DevilsAdvocateArbiter({
            quadBrain: this.system.quadBrain
        });
        await this.system.devilsAdvocate.initialize();
        this.system.messageBroker.registerArbiter('DevilsAdvocate', {
            instance: this.system.devilsAdvocate,
            role: 'analyst'
        });

        // CRONA (The Third Pillar: Temporal/Causal Engine)
        console.log('   🧩 Integrating Crona (The Third Pillar)...');
        const { CronaArbiter } = await import('../arbiters/CronaArbiter.js');
        this.system.crona = new CronaArbiter({
            name: 'CronaArbiter',
            causalityArbiter: this.system.causality,
            thoughtNetwork: this.system.thoughtNetwork,
            quadBrain: this.system.quadBrain,
            devilsAdvocate: this.system.devilsAdvocate // Inject Contrarian
        });
        await this.system.crona.initialize();
        this.system.messageBroker.registerArbiter('CronaArbiter', { 
            instance: this.system.crona,
            role: 'governor',
            capabilities: ['causal_reasoning', 'reflection', 'synthesis']
        });
        console.log('   ✅ Crona Temporal Engine ready');

        // MicroAgentPool - Initialize first
        this.system.microAgentPool = new MicroAgentPool({
            parentId: 'SOMA',
            maxPoolSize: 50,
            logger: console
        });
        console.log('   ✅ MicroAgentPool ready (max 50 agents)');

        // MicroAgents - Register with pool
        const BlackAgentModule = await import('../microagents/BlackAgent.cjs');
        const BlackAgent = BlackAgentModule.default || BlackAgentModule.BlackAgent;
        const KuzeAgentModule = await import('../microagents/KuzeAgent.cjs');
        const KuzeAgent = KuzeAgentModule.default || KuzeAgentModule.KuzeAgent;
        const JetstreamAgentModule = await import('../microagents/JetstreamAgent.cjs');
        const JetstreamAgent = JetstreamAgentModule.default || JetstreamAgentModule.JetstreamAgent;
        const BatouAgentModule = await import('../microagents/BatouAgent.cjs');
        const BatouAgent = BatouAgentModule.default || BatouAgentModule.BatouAgent;

        // Register agent types with pool
        this.system.microAgentPool.registerAgentType('black', BlackAgent);
        this.system.microAgentPool.registerAgentType('kuze', KuzeAgent);
        this.system.microAgentPool.registerAgentType('jetstream', JetstreamAgent);
        this.system.microAgentPool.registerAgentType('batou', BatouAgent);

        const microAgents = [
            { Class: BlackAgent, name: 'BlackAgent' },
            { Class: KuzeAgent, name: 'KuzeAgent' },
            { Class: JetstreamAgent, name: 'JetstreamAgent' },
            { Class: BatouAgent, name: 'BatouAgent' }
        ];

        // Helper: timeout wrapper for agent initialization
        const initWithTimeout = (agent, timeoutMs = 5000) => {
            return Promise.race([
                agent.initialize(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Initialization timeout')), timeoutMs)
                )
            ]);
        };

        for (const { Class, name } of microAgents) {
            try {
                const agent = new Class();
                await initWithTimeout(agent, 5000); // 5 second timeout per agent
                this.system.messageBroker.registerArbiter(name, {
                    role: 'micro-agent',
                    capabilities: ['execute-task'],
                    instance: { handleMessage: async (env) => agent.execute(env) }
                });
                // Save Black agent instance so we can subscribe to its alerts later
                if (name === 'BlackAgent') this.system.blackAgent = agent;
                console.log(`   ✅ ${name} registered`);
            } catch (e) {
                console.error(`   ⚠️  Failed to initialize ${name}:`, e.message);
            }
        }
        console.log('   ✅ MicroAgents Active');

        // Adaptive Learning Router
        this.system.router = new AdaptiveLearningRouter({
            name: 'AdaptiveLearningRouter',
            mnemonic: this.system.mnemonic,
            contextWindow: 5
        });
        await this.system.router.initialize();
        console.log('   ✅ AdaptiveLearningRouter ready');

        // Universal Learning Pipeline
        this.system.learningPipeline = new UniversalLearningPipeline({
            name: 'UniversalLearningPipeline',
            maxExperiences: 100000,
            storageDir: join(this.rootPath, '.soma'),
            experienceThreshold: 100,
            timeThreshold: 3600000
        });
        await this.system.learningPipeline.initialize({
            mnemonic: this.system.mnemonic
        });
        // Register the internal buffer as an Arbiter
        if (this.system.learningPipeline.experienceBuffer) {
            this.system.messageBroker.registerArbiter('ExperienceReplayBuffer', {
                instance: this.system.learningPipeline.experienceBuffer
            });
        }
        console.log('   ✅ Universal Learning Pipeline ready');

        // Meta-Learning Engine
        this.system.metaLearning = new MetaLearningEngine({
            name: 'MetaLearningEngine',
            learningPipeline: this.system.learningPipeline,
            messageBroker: this.system.messageBroker,
            optimizationInterval: 100,
            minExperiencesForOptimization: 50,
            fixProposalSystem: this.system.fixProposal // Pass FixProposalSystem
        });
        await this.system.metaLearning.initialize({
            experienceBuffer: this.system.learningPipeline.experienceBuffer,
            outcomeTracker: this.system.learningPipeline.outcomeTracker
        });
        console.log('   ✅ Meta-Learning Engine ready');

        // Fragment Registry
        this.system.fragmentRegistry = new FragmentRegistry({
            name: 'FragmentRegistry',
            learningPipeline: this.system.learningPipeline,
            metaLearning: this.system.metaLearning,
            mnemonic: this.system.mnemonic,
            maxFragmentsPerPillar: 20
        });
        await this.system.fragmentRegistry.initialize();
        console.log('   ✅ FragmentRegistry ready');

        // Fragment Communication Hub
        this.system.fragmentComms = new FragmentCommunicationHub({
            name: 'FragmentCommunicationHub',
            fragmentRegistry: this.system.fragmentRegistry,
            learningPipeline: this.system.learningPipeline,
            messageBroker: this.system.messageBroker,
            maxConsultationDepth: 3,
            consensusThreshold: 0.7
        });
        await this.system.fragmentComms.initialize();
        console.log('   ✅ FragmentCommunicationHub ready');

        // Knowledge Graph Fusion
        this.system.knowledgeGraph = new KnowledgeGraphFusion({
            name: 'KnowledgeGraphFusion',
            fragmentRegistry: this.system.fragmentRegistry,
            learningPipeline: this.system.learningPipeline,
            messageBroker: this.system.messageBroker,
            mnemonic: this.system.mnemonic
        });
        await this.system.knowledgeGraph.initialize();
        console.log('   ✅ Knowledge Graph Fusion ready');

        // 👁️ Visual Proprioception (Mind Map)
        const { VisualProprioception } = await import('./VisualProprioception.js');
        this.system.visualProprioception = new VisualProprioception(this.system.knowledgeGraph);

        // Initial Mind Map Render
        try {
            await this.system.visualProprioception.saveMap();
            console.log('   ✅ Visual Proprioception active (MIND_MAP.html generated)');
        } catch (e) {
            console.warn('   ⚠️ Mind Map generation failed:', e.message);
        }

        // Universal Impulser (Knowledge Indexing)
        const UniversalImpulserModule = await import('../arbiters/UniversalImpulser.cjs');
        const UniversalImpulser = UniversalImpulserModule.default || UniversalImpulserModule.UniversalImpulser;
        this.system.impulser = new UniversalImpulser({ name: 'UniversalImpulser' });
        await this.system.impulser.initialize(); // Self-registers with MessageBroker
        console.log('   ✅ Universal Impulser ready');

        // Idea Capture
        this.system.ideaCapture = new IdeaCaptureArbiter({
            name: 'IdeaCaptureArbiter',
            broker: this.system.messageBroker,
            mnemonic: this.system.mnemonic,
            learningPipeline: this.system.learningPipeline,
            embeddingFn: async (text) => {
                if (!embedder) return []; // Fallback if embedder disabled
                const output = await embedder(text, { pooling: 'mean', normalize: true });
                return Array.from(output.data);
            }
        });
        console.log('   ✅ IdeaCaptureArbiter ready');

        // Self-Improvement Coordinator (ASI-Level Self-Enhancement)
        try {
            this.system.selfImprovement = new SelfImprovementCoordinator({
                name: 'SelfImprovementCoordinator',
                messageBroker: this.system.messageBroker,
                noveltyCheckEnabled: true,
                skillLearningEnabled: true,
                selfModificationEnabled: true,
                beliefSystemEnabled: true,
                capabilityExpansionEnabled: true,
                improvementCycleInterval: 3600000 // Run every hour
            });
            await this.system.selfImprovement.initialize();
            console.log('   ✅ SelfImprovementCoordinator ready (NoveltyTracker + Skills + Self-Mod)');
        } catch (error) {
            console.warn('   ⚠️ SelfImprovementCoordinator failed to initialize:', error.message);
            console.warn('      Continuing without self-improvement features...');
        }

        // Computer Control (SOMA-USE)
        this.system.computerControl = new ComputerControlArbiter({
            name: 'ComputerControlArbiter',
            visionArbiter: this.system.visionArbiter || null
        });
        // await this.system.computerControl.initialize();
        this.system.messageBroker.registerArbiter('ComputerControlArbiter', { instance: this.system.computerControl });
        console.log('   ✅ ComputerControlArbiter ready (Desktop Control Active)');

        // 🦙 LOCAL MODEL MANAGER (Self-Training System) - Initialize BEFORE QuadBrain
        const LocalModelManagerModule = await import('../arbiters/LocalModelManager.cjs');
        const LocalModelManager = LocalModelManagerModule.LocalModelManager || LocalModelManagerModule.default;
        this.system.localModelManager = new LocalModelManager({
            name: 'LocalModelManager',
            baseModel: 'gemma3:4b',
            somaModelPrefix: 'soma-1t',
            fineTuneThreshold: 500,
            autoFineTune: true,
            minDatasetSize: 100,
            messageBroker: this.system.messageBroker,
            metaLearning: this.system.metaLearning
        });
        await this.system.localModelManager.initialize();
        console.log('   ✅ Local Model Manager ready (self-training enabled)');

        // 📊 TRAINING DATA COLLECTOR - Initialize BEFORE QuadBrain
        const TrainingDataCollectorModule = await import('../arbiters/TrainingDataCollector.cjs');
        const TrainingDataCollector = TrainingDataCollectorModule.TrainingDataCollector || TrainingDataCollectorModule.default;
        this.system.trainingCollector = new TrainingDataCollector({
            name: 'TrainingDataCollector',
            autoExportThreshold: 100,
            minQualityScore: 0.3,
            maxBufferSize: 1000,
            metaLearning: this.system.metaLearning,
            experienceBuffer: this.system.learningPipeline?.experienceBuffer,
            messageBroker: this.system.messageBroker
        });
        await this.system.trainingCollector.initialize();
        console.log('   ✅ Training Data Collector ready (auto-export every 100 interactions)');

        // 🕸️ THOUGHT NETWORK - Initialize BEFORE QuadBrain
        const ThoughtNetworkModule = await import('../cognitive/ThoughtNetwork.cjs');
        const ThoughtNetwork = ThoughtNetworkModule.ThoughtNetwork || ThoughtNetworkModule.default;
        this.system.thoughtNetwork = new ThoughtNetwork({
            name: 'ThoughtNetwork',
            mnemonicArbiter: this.system.mnemonic,
            archivistArbiter: this.system.archivist,
            savePath: './SOMA/thought-network.json'
        });
        
        // Connect ThoughtNetwork to Hippocampus for unified growth
        this.system.hippocampus.thoughtNetwork = this.system.thoughtNetwork;
        
        // Load existing network if available
        try {
            await this.system.thoughtNetwork.load();
            console.log(`   ✅ Thought Network ready (${this.system.thoughtNetwork.stats.totalNodes} nodes, ${this.system.thoughtNetwork.stats.totalConnections} connections)`);
        } catch (err) {
            console.log('   ✅ Thought Network ready (new network)');
        }

        // Seed initial knowledge if network is empty
        if (this.system.thoughtNetwork.nodes.size === 0) {
            console.log('   🌱 Seeding initial knowledge...');

            // Core concepts
            const ai = this.system.thoughtNetwork.createNode('Artificial Intelligence', { type: 'concept', tags: ['technology', 'computing'] });
            const learning = this.system.thoughtNetwork.createNode('Machine Learning', { type: 'concept', tags: ['ai', 'learning'] });
            const reasoning = this.system.thoughtNetwork.createNode('Reasoning Systems', { type: 'concept', tags: ['ai', 'logic'] });
            const memory = this.system.thoughtNetwork.createNode('Memory Systems', { type: 'concept', tags: ['cognition', 'storage'] });
            const consciousness = this.system.thoughtNetwork.createNode('Consciousness', { type: 'concept', tags: ['philosophy', 'cognition'] });

            // Connect them
            this.system.thoughtNetwork.connectConcepts(ai, learning, 'enables', 0.9);
            this.system.thoughtNetwork.connectConcepts(ai, reasoning, 'requires', 0.85);
            this.system.thoughtNetwork.connectConcepts(ai, memory, 'uses', 0.8);
            this.system.thoughtNetwork.connectConcepts(learning, memory, 'requires', 0.75);
            this.system.thoughtNetwork.connectConcepts(reasoning, consciousness, 'related_to', 0.6);

            // SOMA-specific knowledge
            const soma = this.system.thoughtNetwork.createNode('SOMA Architecture', { type: 'system', tags: ['soma', 'self'] });
            const arbiters = this.system.thoughtNetwork.createNode('Arbiter System', { type: 'system', tags: ['soma', 'architecture'] });
            const fractals = this.system.thoughtNetwork.createNode('Fractal Knowledge Network', { type: 'pattern', tags: ['knowledge', 'graph'] });

            this.system.thoughtNetwork.connectConcepts(soma, arbiters, 'composed_of', 0.95);
            this.system.thoughtNetwork.connectConcepts(soma, ai, 'implements', 0.9);
            this.system.thoughtNetwork.connectConcepts(fractals, memory, 'implements', 0.85);
            this.system.thoughtNetwork.connectConcepts(arbiters, fractals, 'uses', 0.8);

            console.log(`   ✅ Seeded ${this.system.thoughtNetwork.nodes.size} initial knowledge nodes`);
        }

        // 🌐 FRACTAL SYNC SERVICE - Distributed Intelligence
        try {
            const nodeId = `soma-${crypto.randomBytes(4).toString('hex')}`;
            this.system.fractalSync = new FractalSyncService({
                name: 'FractalSyncService',
                role: process.env.SOMA_ROLE || 'worker',           // 'coordinator' or 'worker'
                nodeId: nodeId,
                thoughtNetwork: this.system.thoughtNetwork,        // Fractal graph
                causalityArbiter: this.system.causality,           // Causal chains
                knowledgeGraph: this.system.knowledgeGraph,        // Knowledge graph
                swarm: this.system.microAgentPool,                 // Swarm for compression
                coordinatorUrl: process.env.SOMA_COORDINATOR,      // Coordinator URL (e.g., 'http://server:7777')
                syncInterval: parseInt(process.env.SOMA_SYNC_INTERVAL) || 3600000, // 1 hour default
                minFractalsForSync: parseInt(process.env.SOMA_MIN_FRACTALS) || 50
            });
            await this.system.fractalSync.initialize();
            const role = this.system.fractalSync.role;
            if (role === 'coordinator') {
                console.log(`   ✅ FractalSyncService ready (COORDINATOR mode - accepting fractal updates)`);
            } else {
                console.log(`   ✅ FractalSyncService ready (WORKER mode - syncing to ${this.system.fractalSync.coordinatorUrl || 'standalone'})`);
            }
        } catch (error) {
            console.warn('   ⚠️  FractalSyncService initialization failed:', error.message);
            console.warn('   ⚠️  System will continue without distributed fractal sharing');
        }

        // Dream Arbiter (Lucid Dreaming & Reflection)
        const DreamArbiterModule = await import('../arbiters/DreamArbiter.cjs');
        const { DreamArbiter } = DreamArbiterModule.default || DreamArbiterModule;

        // Adapter to make MnemonicArbiter look like the Transmitter DreamArbiter expects
        const mnemonicAdapter = {
            search: async (query) => {
                const res = await this.system.mnemonic.recall(query);
                return res.results || [];
            },
            addItem: async (item) => {
                return await this.system.mnemonic.remember(item.text, item.meta);
            },
            getRecentInteractions: async (hours) => {
                return await this.system.mnemonic.getRecentMemories(hours);
            }
        };

        this.system.dreamArbiter = new DreamArbiter({
            name: 'DreamArbiter',
            transmitter: mnemonicAdapter,
            stateDir: join(this.rootPath, '.soma', 'dream_state')
        });
        await this.system.dreamArbiter.initialize();
        this.system.messageBroker.registerArbiter('DreamArbiter', { instance: this.system.dreamArbiter });
        console.log('   ✅ DreamArbiter ready (Lucid Dreaming Active)');

        // 🛠️ TOOL REGISTRY SETUP
        console.log('   🛠️  Initializing Tool Registry...');

        // LOCAL THALAMUS (The Gatekeeper - Section 3.1)
        console.log('   🛡️  Initializing Local Thalamus (Node Gatekeeper)...');
        const { ThalamusArbiter } = await import('../arbiters/ThalamusArbiter.js');
        this.system.localThalamus = new ThalamusArbiter({
            beliefSystem: this.system.beliefSystem
        });
        await this.system.localThalamus.initialize();
        this.system.messageBroker.registerArbiter('LocalThalamus', { 
            instance: this.system.localThalamus,
            role: 'gatekeeper'
        });

        // GMN CONNECTIVITY (Auto-Discovery & Handshake)
        const clusterPort = this.config.clusterPort || 7777;
        if (clusterPort > 0) {
            console.log('   🌐  Initializing GMN Connectivity (Auto-Discovery)...');
            const { GMNConnectivityArbiter } = await import('../arbiters/GMNConnectivityArbiter.js');
            this.system.gmnConnectivity = new GMNConnectivityArbiter({
                port: clusterPort,
                nodeAddress: `${this.system.localThalamus.name.toLowerCase()}.gmn.somaexample.cd`
            });
            await this.system.gmnConnectivity.initialize();
            this.system.messageBroker.registerArbiter('GMN-Connectivity', {
                instance: this.system.gmnConnectivity,
                role: 'conductor'
            });
        } else {
            console.log('   🌐  GMN Connectivity skipped (port 0)');
        }

        // TRUST ENGINE (The Auditor - Section 5.2)
        console.log('   🕵️  Initializing GMN Trust Engine (Reputation Synthesis)...');
        const { TrustEngine } = await import('../arbiters/TrustEngine.js');
        this.system.trustEngine = new TrustEngine({
            quadBrain: this.system.quadBrain,
            causalityArbiter: this.system.causality,
            localThalamus: this.system.localThalamus
        });
        await this.system.trustEngine.initialize();
        this.system.messageBroker.registerArbiter('GMN-TrustEngine', {
            instance: this.system.trustEngine,
            role: 'analyst'
        });

        // META-CORTEX (The Macro-Brain - Section 2.5)
        console.log('   🧠  Initializing GMN Meta-Cortex (Macro-Brain)...');
        const { MetaCortexArbiter } = await import('../arbiters/MetaCortexArbiter.js');
        this.system.metaCortex = new MetaCortexArbiter({
            quadBrain: this.system.quadBrain
        });
        await this.system.metaCortex.initialize();
        this.system.messageBroker.registerArbiter('GMN-MetaCortex', {
            instance: this.system.metaCortex,
            role: 'conductor'
        });

        // Register standard tools
        toolRegistry.registerTool({
            name: 'calculator',
            description: 'Evaluate mathematical expressions',
            parameters: { expression: 'string' },
            execute: async ({ expression }) => {
                try { return eval(expression); } catch (e) { return "Error: " + e.message; }
            }
        });

        toolRegistry.registerTool({
            name: 'get_time',
            description: 'Get current server time',
            parameters: {},
            execute: async () => new Date().toISOString()
        });

        // Market Data Tool
        toolRegistry.registerTool({
            name: 'get_market_data',
            description: 'Get real-time market data for crypto/stocks',
            parameters: { symbol: 'string', source: 'string (binance|coingecko|alphavantage)' },
            execute: async ({ symbol, source }) => {
                try {
                    const s = source || 'binance';
                    if (s === 'binance') {
                        const pair = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
                        const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;
                        const res = await fetch(url);
                        if (!res.ok) return `Error fetching ${pair}`;
                        const data = await res.json();
                        return {
                            price: data.lastPrice,
                            change_24h: data.priceChangePercent,
                            volume: data.volume
                        };
                    } else if (s === 'coingecko') {
                        const id = symbol.toLowerCase();
                        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
                        const res = await fetch(url);
                        if (!res.ok) return `Error fetching ${id}`;
                        const data = await res.json();
                        return data[id] || "Symbol not found";
                    }
                    return "Unsupported source. Use binance or coingecko.";
                } catch (e) { return "Error: " + e.message; }
            }
        });

        // File System Tools
        toolRegistry.registerTool({
            name: 'read_file',
            description: 'Read file content. Use strict absolute paths or relative to CWD.',
            parameters: { path: 'string' },
            execute: async ({ path: filePath }) => {
                try {
                    const { promises: fs } = await import('fs');
                    const path = await import('path');
                    const resolved = path.resolve(process.cwd(), filePath);
                    if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";
                    return await fs.readFile(resolved, 'utf8');
                } catch (e) { return "Error: " + e.message; }
            }
        });

        toolRegistry.registerTool({
            name: 'write_file',
            description: 'Write content to file (overwrites). Use strict absolute paths or relative to CWD.',
            parameters: { path: 'string', content: 'string' },
            execute: async ({ path: filePath, content }) => {
                try {
                    const { promises: fs } = await import('fs');
                    const path = await import('path');
                    const resolved = path.resolve(process.cwd(), filePath);
                    if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";
                    await fs.writeFile(resolved, content, 'utf8');
                    return "Success";
                } catch (e) { return "Error: " + e.message; }
            }
        });

        toolRegistry.registerTool({
            name: 'list_files',
            description: 'List files in directory',
            parameters: { path: 'string' },
            execute: async ({ path: dirPath }) => {
                try {
                    const { promises: fs } = await import('fs');
                    const path = await import('path');
                    const resolved = path.resolve(process.cwd(), dirPath || '.');
                    if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";
                    const files = await fs.readdir(resolved);
                    return files.join('\n');
                } catch (e) { return "Error: " + e.message; }
            }
        });

        console.log('   ✅ ToolRegistry active (Basic tools loaded)');

        // ASI-Enhanced Brain (Wrapped in SafeArbiter for resilience)
        const quadBrainConfig = {
            name: 'SomaBrain',
            router: this.system.router,
            mnemonic: this.system.mnemonic,
            messageBroker: this.system.messageBroker,
            learningPipeline: this.system.learningPipeline,
            fragmentRegistry: this.system.fragmentRegistry,
            knowledgeGraph: this.system.knowledgeGraph,      // 🧠 Knowledge graph integration
            causalityArbiter: this.system.causality,         // 🔗 Causal reasoning
            worldModel: this.system.worldModel,              // 🌍 World modeling
            knowledgeBridge: this.system.knowledgeBridge,    // 🌉 Simulation-to-Cognition Bridge
            selfModel: this.system.selfModel,                // 🪞 Self-awareness
            localModelManager: this.system.localModelManager,// 🦙 Self-training system
            trainingCollector: this.system.trainingCollector,// 📊 Training data capture
            thoughtNetwork: this.system.thoughtNetwork,      // 🕸️ Graph-based reasoning
            reasoning: this.system.reasoning,                // 🧩 Advanced reasoning chamber
            emotionalEngine: this.system.emotional,
            personalityEngine: this.system.personality,
            toolRegistry: toolRegistry                       // 🛠️ Tool Registry
        };
        const safeQuadBrain = new SafeArbiter(SOMArbiterV3, quadBrainConfig);
        await safeQuadBrain.initialize();
        this.system.quadBrain = safeQuadBrain.raw; // Expose raw instance for direct access
        this.system.safeQuadBrain = safeQuadBrain; // Keep wrapper for safe calls

        // Register Brain with MessageBroker (Crucial for Timekeeper/GMN)
        this.system.messageBroker.registerArbiter('SOMArbiter', { 
            instance: this.system.quadBrain,
            role: 'core',
            version: '3.0.0'
        });
        this.system.messageBroker.registerArbiter('QuadBrain', { 
            instance: this.system.quadBrain,
            role: 'core'
        });
        this.system.messageBroker.registerArbiter('SomaBrain', { 
            instance: this.system.quadBrain,
            role: 'core'
        });

        console.log('   ✅ ASI-Enhanced Brain ready (FULL ADVANCED REASONING ARCHITECTURE + SafeArbiter)');

        // =====================================================================
        // 🏛️ CORTICAL CONSOLIDATION (The Great Reorganization)
        // =====================================================================
        console.log('\n🏛️  Organizing Neural Cortexes...');

        // 1. EXECUTIVE CORTEX (Action & Implementation - Governed by LOGOS)
        this.system.executiveCortex = new ExecutiveCortexArbiter({
            computerControl: this.system.computerControl,
            deployment: this.system.deployment,
            reflex: this.system.reflexArbiter,
            swarm: this.system.engineeringSwarm, // Adversarial swarm
            toolCreator: this.system.toolCreator,
            selfMod: this.system.selfModification,
            skillWatcher: this.system.skillWatcher
        });
        await this.system.executiveCortex.initialize();
        console.log('   ✅ Executive Cortex (Action) online');

        // 2. SENSORY CORTEX (Perception & Input - Governed by AURORA)
        this.system.sensoryCortex = new SensoryCortexArbiter({
            vision: this.system.visionProcessing,
            audio: this.system.audioProcessing,
            web: this.system.edgeWorker,
            codeObserver: this.system.codeObserver
        });
        await this.system.sensoryCortex.initialize();
        console.log('   ✅ Sensory Cortex (Perception) online');

        // 3. IMMUNE CORTEX (Safety & Survival - Governed by THALAMUS)
        this.system.immuneCortex = new ImmuneCortexArbiter({
            guardian: this.system.immuneSystem,
            watchdog: this.system.watchdog,
            oracle: this.system.performanceOracle,
            security: this.system.securityCouncil,
            budget: this.system.resourceBudget
        });
        await this.system.immuneCortex.initialize();
        console.log('   ✅ Immune Cortex (Survival) online');

        // 4. STRATEGY CORTEX (Planning & Simulation - Governed by PROMETHEUS)
        this.system.strategyCortex = new StrategyCortexArbiter({
            planner: this.system.goalPlanner,
            finance: this.system.finance,
            forecaster: this.system.forecaster,
            causality: this.system.causality,
            sim: this.system.simulation,
            quantum: this.system.quantumSim
        });
        await this.system.strategyCortex.initialize();
        console.log('   ✅ Strategy Cortex (Planning) online');

        // Register Cortexes with MessageBroker
        this.system.messageBroker.registerArbiter('ExecutiveCortex', { instance: this.system.executiveCortex });
        this.system.messageBroker.registerArbiter('SensoryCortex', { instance: this.system.sensoryCortex });
        this.system.messageBroker.registerArbiter('ImmuneCortex', { instance: this.system.immuneCortex });
        this.system.messageBroker.registerArbiter('StrategyCortex', { instance: this.system.strategyCortex });

        // =====================================================================
        // 🔗 LEGACY ALIASES (Compatibility Layer)
        // Ensures existing server routes and external links do not break
        // =====================================================================
        this.system.mnemonic = this.system.hippocampus.mnemonic;
        this.system.thoughtNetwork = this.system.hippocampus.thoughtNetwork;
        this.system.computerControl = this.system.executiveCortex.computerControl;
        this.system.deployment = this.system.executiveCortex.deployment;
        this.system.reflexArbiter = this.system.executiveCortex.reflex;
        this.system.visionProcessing = this.system.sensoryCortex.vision;
        this.system.audioProcessing = this.system.sensoryCortex.audio;
        this.system.edgeWorker = this.system.sensoryCortex.web;
        this.system.immuneSystem = this.system.immuneCortex.guardian;
        this.system.watchdog = this.system.immuneCortex.watchdog;
        this.system.finance = this.system.strategyCortex.finance;
        this.system.forecaster = this.system.strategyCortex.forecaster;
        this.system.goalPlanner = this.system.strategyCortex.planner;

        // Critic Alignment Service (Self-Correction Loop)
        this.system.criticAlignment = new CriticAlignmentService({
            llm: {
                // Adapter to use QuadBrain's THALAMUS for alignment (Governance/Nemesis)
                generate: async (prompt, opts) => {
                    const res = await this.system.quadBrain.callBrain('THALAMUS', prompt, { ...opts, temperature: 0.1 }, 'full');
                    return res.text;
                }
            },
            intervalMs: 3600000 // Run every hour
        });
        this.system.criticAlignment.start().catch(err => console.warn('   ⚠️ CriticAlignment start failed:', err.message));
        console.log('   ✅ CriticAlignmentService active (Self-Correction Loop)');

        // Reflex Engine (Token-Free Execution)
        this.system.reflexArbiter = new ReflexArbiter();
        await this.system.reflexArbiter.initialize();
        this.system.messageBroker.registerArbiter('ReflexArbiter', { role: 'engineer', instance: this.system.reflexArbiter });
        console.log('   ✅ ReflexArbiter active (Token-Free Execution)');

        // Reflex Scout (Automated Muscle Memory)
        this.system.reflexScout = new ReflexScoutArbiter({
            conversationHistory: this.system.conversationHistory,
            reflexArbiter: this.system.reflexArbiter,
            scanInterval: 60000 // Scan every minute for demo
        });
        await this.system.reflexScout.initialize();
        console.log('   ✅ ReflexScoutArbiter active (Pattern Recognition)');

        // Skill Watcher (Hot-Load Plugins)
        this.system.skillWatcher = new SkillWatcherArbiter({
            toolRegistry: toolRegistry,
            system: this.system // Provide access to the entire neural network
        });
        // Initialized by Executive Cortex
        console.log('   ✅ SkillWatcherArbiter prepared (Plugin System)');

        // Merovingian Cortex (Reflective Layer)
        this.system.merovingian = new MerovingianCortex(this.system.messageBroker, { 
            name: 'MerovingianCortex', 
            reflectionEnabled: true 
        });
        await this.system.merovingian.initialize();
        console.log('   ✅ MerovingianCortex active (Deep Reflection)');

        // Genome Arbiter (Code DNA)
        this.system.genomeArbiter = new GenomeArbiter({ 
            name: 'GenomeArbiter', 
            messageBroker: this.system.messageBroker 
        });
        await this.system.genomeArbiter.initialize();
        console.log('   ✅ GenomeArbiter active');

        // 🔗 POST-INITIALIZATION WIRING: Connect systems bidirectionally
        // Connect ThoughtNetwork to QuadBrain for semantic reasoning
        if (this.system.thoughtNetwork) {
            this.system.thoughtNetwork.setBrain(this.system.quadBrain);
            console.log('   ✅ ThoughtNetwork ↔ QuadBrain bidirectional link established');
        }

        // Connect SelfModification to ImmuneSystem (Guardian)
        if (this.system.selfModification && this.system.immuneSystem && typeof this.system.selfModification.setImmuneSystem === 'function') {
            this.system.selfModification.setImmuneSystem(this.system.immuneSystem);
            console.log('   ✅ SelfModification linked to GuardianV2 (ImmuneSystem)');
        }

        // Listen for training data exports and trigger fine-tuning
        if (this.system.trainingCollector && this.system.localModelManager) {
            this.system.trainingCollector.on('dataset_exported', async (payload) => {
                console.log(`[SOMA] 📦 Training dataset exported: ${payload.filename} (${payload.count} interactions)`);

                if (this.system.localModelManager.autoFineTune) {
                    console.log('[SOMA] 🦙 Auto fine-tune enabled - triggering model update...');
                    try {
                        await this.system.localModelManager.triggerFineTune({
                            datasetPath: payload.path,
                            reason: 'auto_export_threshold'
                        });
                    } catch (err) {
                        console.error('[SOMA] ❌ Fine-tune trigger failed:', err.message);
                    }
                }
            });
            console.log('   ✅ Auto fine-tune pipeline connected (triggers every 100 interactions)');
        }

        // Muse Engine
        this.system.muse = new MuseEngine({
            name: 'MuseEngine',
            broker: this.system.messageBroker,
            ideaCapture: this.system.ideaCapture,
            quadBrain: this.system.quadBrain,
            learningPipeline: this.system.learningPipeline
        });
        console.log('   ✅ MuseEngine ready');

        // AGI Foundation
        this.system.causality = new CausalityArbiter({
            name: 'CausalityArbiter',
            messageBroker: this.system.messageBroker,
            minObservations: 10,
            confidenceThreshold: 0.7,
            interventionWeight: 2.0
        });
        await this.system.causality.initialize({
            experienceBuffer: this.system.learningPipeline.experienceBuffer,
            metaLearning: this.system.metaLearning || null,
            mnemonic: this.system.mnemonic,
            learningPipeline: this.system.learningPipeline
        });
        console.log('   ✅ CausalityArbiter ready');

        this.system.worldModel = new WorldModelArbiter({
            name: 'WorldModelArbiter',
            maxLookAhead: 5,
            minConfidenceToAct: 0.6,
            learningRate: 0.1
        });
        await this.system.worldModel.initialize({
            causalityArbiter: this.system.causality,
            experienceBuffer: this.system.learningPipeline.experienceBuffer,
            metaLearning: this.system.metaLearning || null,
            learningPipeline: this.system.learningPipeline
        });
        this.system.messageBroker.registerArbiter('WorldModelArbiter', { instance: this.system.worldModel });
        console.log('   ✅ WorldModelArbiter ready');

        this.system.abstraction = new AbstractionArbiter({
            name: 'AbstractionArbiter',
            minSimilarity: 0.65,
            transferThreshold: 0.7,
            maxPatterns: 1000
        });
        await this.system.abstraction.initialize({
            causalityArbiter: this.system.causality,
            worldModel: this.system.worldModel,
            metaLearning: this.system.metaLearning || null,
            learningPipeline: this.system.learningPipeline
        });
        this.system.messageBroker.registerArbiter('AbstractionArbiter', { instance: this.system.abstraction });
        console.log('   ✅ AbstractionArbiter ready');

        // Knowledge Bridge (Simulation → Cognition Transfer)
        this.system.knowledgeBridge = new KnowledgeBridge({
            abstractionArbiter: this.system.abstraction,
            worldModel: this.system.worldModel,
            messageBroker: this.system.messageBroker
        });
        await this.system.knowledgeBridge.initialize();
        this.system.messageBroker.registerArbiter('KnowledgeBridge', { instance: this.system.knowledgeBridge });
        console.log('   ✅ KnowledgeBridge ready (Simulation → Cognition Transfer)');

        // Reasoning Chamber
        this.system.reasoning = new ReasoningChamber({ name: 'ReasoningChamber' });
        await this.system.reasoning.initialize();
        this.system.messageBroker.registerArbiter('ReasoningChamber', { instance: this.system.reasoning });
        console.log('   ✅ ReasoningChamber ready');

        // Belief System (The Alignment Core)
        const BeliefSystemArbiterModule = await import('../arbiters/BeliefSystemArbiter.cjs');
        const BeliefSystemArbiter = BeliefSystemArbiterModule.default || BeliefSystemArbiterModule.BeliefSystemArbiter;
        this.system.beliefSystem = new BeliefSystemArbiter({ name: 'BeliefSystemArbiter' });
        await this.system.beliefSystem.initialize();
        this.system.messageBroker.registerArbiter('BeliefSystemArbiter', { instance: this.system.beliefSystem });
        console.log('   ✅ BeliefSystemArbiter ready');

        // Goal Planner (The Executive)
        const GoalPlannerArbiterModule = await import('../arbiters/GoalPlannerArbiter.cjs');
        const GoalPlannerArbiter = GoalPlannerArbiterModule.default || GoalPlannerArbiterModule.GoalPlannerArbiter;
        this.system.goalPlanner = new GoalPlannerArbiter({ name: 'GoalPlannerArbiter' });
        await this.system.goalPlanner.initialize();
        this.system.messageBroker.registerArbiter('GoalPlannerArbiter', { instance: this.system.goalPlanner });
        console.log('   ✅ GoalPlannerArbiter ready');

        // ── Wire Black's alerts → GoalPlanner ───────────────────────────────
        // Black monitors system health and emits alerts. Here we turn those
        // alerts into real goals so SOMA acts on her own warnings instead of
        // just logging them.
        if (this.system.blackAgent) {
            const _blackGoalCooldown = new Map(); // prevent duplicate goals per alert type
            const COOLDOWN_MS = 10 * 60 * 1000;  // 10 minutes between same-type goals

            this.system.blackAgent.on('alert', async (alert) => {
                try {
                    const now = Date.now();
                    const last = _blackGoalCooldown.get(alert.type) || 0;
                    if (now - last < COOLDOWN_MS) return; // still in cooldown
                    _blackGoalCooldown.set(alert.type, now);

                    const goalMap = {
                        memory: {
                            title:       'Free up system memory',
                            description: `Black reported high memory usage (${alert.message}). Run garbage collection, clear caches, and identify any memory-leaking processes. Then verify memory usage drops below 80%.`,
                            priority:    alert.severity === 'critical' ? 90 : 70,
                        },
                        cpu: {
                            title:       'Reduce CPU load',
                            description: `Black reported high CPU usage (${alert.message}). Identify the heaviest processes, throttle or defer non-essential background work, and verify load drops to normal.`,
                            priority:    alert.severity === 'critical' ? 85 : 65,
                        },
                        disk: {
                            title:       'Free up disk space',
                            description: `Black reported high disk usage (${alert.message}). Clean up temporary files, old logs, and stale caches. Identify the largest directories consuming space.`,
                            priority:    alert.severity === 'critical' ? 80 : 60,
                        },
                    };

                    const template = goalMap[alert.type];
                    if (!template) return;

                    await this.system.goalPlanner.createGoal({
                        type:        'operational',
                        category:    'system_health',
                        title:       template.title,
                        description: template.description,
                        priority:    template.priority,
                        confidence:  0.95,
                        rationale:   `Black agent alert [${alert.severity}]: ${alert.message}`,
                        metadata:    { source: 'black_agent', alertType: alert.type, severity: alert.severity }
                    }, 'autonomous');

                    console.log(`[Black → GoalPlanner] 🎯 Created goal: "${template.title}" (${alert.severity})`);
                } catch (err) {
                    console.error('[Black → GoalPlanner] Failed to create goal:', err.message);
                }
            });
            console.log('   ✅ Black alerts → GoalPlanner wired');
        }

        // Recursive Self-Model
        this.system.selfModel = new RecursiveSelfModel({
            messageBroker: this.system.messageBroker,
            learningPipeline: this.system.learningPipeline
        });
        await this.system.selfModel.initialize(this.system);
        this.system.messageBroker.registerArbiter('RecursiveSelfModel', { instance: this.system.selfModel });
        console.log('   ✅ Recursive Self-Model ready');

        // Curiosity Engine
        this.system.curiosity = new CuriosityEngine({
            selfModel: this.system.selfModel,
            knowledgeGraph: this.system.knowledgeGraph,
            learningPipeline: this.system.learningPipeline,
            messageBroker: this.system.messageBroker,
            worldModel: this.system.worldModel // 🌍 Inject WorldModel
        });
        await this.system.curiosity.initialize();
        this.system.messageBroker.registerArbiter('CuriosityEngine', { instance: this.system.curiosity });
        console.log('   ✅ Curiosity Engine ready');
        console.log(`   🔍 Autonomous exploration active (interval: ${this.system.curiosity.config.explorationInterval}ms)`);

        // Performance Oracle
        this.system.performanceOracle = new PerformanceOracle({
            name: 'PerformanceOracle',
            quadBrain: this.system.quadBrain,
            fragmentRegistry: this.system.fragmentRegistry,
            learningPipeline: this.system.learningPipeline,
            selfModel: this.system.selfModel,
            messageBroker: this.system.messageBroker
        });
        await this.system.performanceOracle.initialize();
        this.system.messageBroker.registerArbiter('PerformanceOracle', { instance: this.system.performanceOracle });
        console.log('   ✅ Performance Oracle ready');

        // Training Coordinator
        this.system.trainingCoordinator = new TrainingCoordinator({
            name: 'TrainingCoordinator',
            learningPipeline: this.system.learningPipeline,
            fragmentRegistry: this.system.fragmentRegistry,
            curiosity: this.system.curiosity,
            messageBroker: this.system.messageBroker,
            metaLearning: this.system.metaLearning
        });
        await this.system.trainingCoordinator.initialize();
        this.system.messageBroker.registerArbiter('TrainingCoordinator', { instance: this.system.trainingCoordinator });
        console.log('   ✅ Training Coordinator ready');

        // Theory of Mind - User Mental State Modeling
        this.system.theoryOfMind = new TheoryOfMindArbiter('theory-of-mind', {
            userProfilePath: join(this.rootPath, '.soma', 'user-profiles'),
            intentConfidenceThreshold: 0.7,
            confusionThreshold: 0.6,
            adaptiveResponseEnabled: true
        });
        await this.system.theoryOfMind.onActivate();
        this.system.messageBroker.registerArbiter('TheoryOfMindArbiter', { instance: this.system.theoryOfMind });
        console.log('   ✅ Theory of Mind ready');

        // Code Observation
        this.system.codeObserver = new CodeObservationArbiter({
            basePath: this.rootPath,
            quadBrain: this.system.quadBrain,
            scanInterval: 3600000
        });
        await this.system.codeObserver.initialize();
        this.system.messageBroker.registerArbiter('CodeObservationArbiter', { instance: this.system.codeObserver });
        console.log('   ✅ Code Observer ready');

        // Steve Arbiter (Tool Generation & STEVE Personality)
        this.system.steveArbiter = new SteveArbiter(this.system.messageBroker, {
            kevinManager: this.system.kevinManager,
            learningPipeline: this.system.learningPipeline,
            orchestrator: { population: new Map() } // Minimal orchestrator stub
        });
        await this.system.steveArbiter.initialize();
        this.system.messageBroker.registerArbiter('SteveArbiter', { instance: this.system.steveArbiter, role: 'toolmaker' });
        console.log('   ✅ STEVE Arbiter ready (Tool Generation & Persona)');

        // Fix Proposal System
        this.system.fixProposal = new FixProposalSystem({
            quadBrain: this.system.quadBrain,
            codeObserver: this.system.codeObserver,
            minConfidence: 0.7,
            messageBroker: this.system.messageBroker // Pass the message broker
        });
        await this.system.fixProposal.initialize();
        this.system.messageBroker.registerArbiter('FixProposalSystem', { instance: this.system.fixProposal });
        console.log('   ✅ Fix Proposal System ready');

        // Self-Modification Arbiter
        try {
            const SelfModificationArbiterModule = await import('../arbiters/SelfModificationArbiter.cjs');
            const SelfModificationArbiter = SelfModificationArbiterModule.default || SelfModificationArbiterModule.SelfModificationArbiter;
            this.system.selfModification = new SelfModificationArbiter({
                name: 'SelfModificationArbiter',
                sandboxMode: false, // Safety first -> Production Mode!
                useIntelligentStrategySelection: true
            });
            // Compatibility: legacy stub may not expose setQuadBrain
            if (typeof this.system.selfModification.setQuadBrain === 'function') {
                this.system.selfModification.setQuadBrain(this.system.quadBrain);
            } else {
                console.warn('   ⚠️  SelfModificationArbiter.setQuadBrain() not available (legacy stub). Skipping.');
            }
            await this.system.selfModification.initialize();
            this.system.messageBroker.registerArbiter('SelfModificationArbiter', { instance: this.system.selfModification });
            console.log('   ✅ Self-Modification Arbiter ready (Generative Mode)');
        } catch (error) {
            console.warn('   ⚠️  SelfModificationArbiter not available:', error.message);
            console.warn('   ⚠️  System will continue without self-modification capabilities');
        }

        // Storage
        this.system.storage = new StorageArbiter({ name: 'StorageArbiter', defaultBackend: 'local' });
        await this.system.storage.initialize();
        this.system.messageBroker.registerArbiter('StorageArbiter', { instance: this.system.storage });
        console.log('   ✅ StorageArbiter ready');

        // Archivist (Autonomous Storage Optimization)
        const ArchivistArbiterModule = await import('../arbiters/ArchivistArbiter.cjs');
        const { default: ArchivistArbiter } = ArchivistArbiterModule;
        // OR if it's a direct class export in CJS
        // const ArchivistArbiter = ArchivistArbiterModule.default || ArchivistArbiterModule;

        this.system.archivist = new ArchivistArbiter(this.system.messageBroker, {
            name: 'ArchivistArbiter',
            storagePath: join(process.cwd(), 'hippocampus')
        });
        await this.system.archivist.initialize();
        this.system.messageBroker.registerArbiter('ArchivistArbiter', { instance: this.system.archivist });
        console.log('   ✅ ArchivistArbiter ready (Storage Optimization Active)');

        // Deployment
        this.system.deployment = new DeploymentArbiter({ name: 'DeploymentArbiter', autonomousMode: true });
        await this.system.deployment.initialize();
        this.system.messageBroker.registerArbiter('DeploymentArbiter', { instance: this.system.deployment });
        console.log('   ✅ DeploymentArbiter ready');

        // GPU Training
        this.system.gpuTraining = new GPUTrainingArbiter({ name: 'GPUTrainingArbiter', loadPipeline: this.system.loadPipeline });
        await this.system.gpuTraining.initialize();
        this.system.messageBroker.registerArbiter('GPUTrainingArbiter', { instance: this.system.gpuTraining });
        console.log('   ✅ GPUTrainingArbiter ready');

        // ═══════════════════════════════════════════════════════════
        // Phase 2B: Training Pipeline (P1 - Self-Training Capability)
        // ═══════════════════════════════════════════════════════════
        console.log('\n🎓 Initializing Training Pipeline...');

        // Experience Replay Buffer - Foundation for learning
        this.system.experienceReplay = new ExperienceReplayBuffer({ name: 'ExperienceReplayBuffer' });
        await this.system.experienceReplay.initialize();
        this.system.messageBroker.registerArbiter('ExperienceReplayBuffer', { instance: this.system.experienceReplay });
        console.log('   ✅ ExperienceReplayBuffer ready');

        // Strategy Optimizer - Learns which strategies work best
        this.system.strategyOptimizer = new StrategyOptimizer({
            name: 'StrategyOptimizer',
            experienceReplay: this.system.experienceReplay
        });
        this.system.messageBroker.registerArbiter('StrategyOptimizer', { instance: this.system.strategyOptimizer });
        console.log('   ✅ StrategyOptimizer ready');

        // Mixed Precision Arbiter - FP16 optimization for faster training
        this.system.mixedPrecision = new MixedPrecisionArbiter({
            name: 'MixedPrecisionArbiter',
            loadPipeline: this.system.loadPipeline,
            gpuTraining: this.system.gpuTraining
        });
        this.system.messageBroker.registerArbiter('MixedPrecisionArbiter', { instance: this.system.mixedPrecision });
        console.log('   ✅ MixedPrecisionArbiter ready (FP16 training enabled)');

        // Async Gradient Arbiter - Non-blocking gradient updates
        this.system.asyncGradient = new AsyncGradientArbiter({
            name: 'AsyncGradientArbiter'
        });
        this.system.messageBroker.registerArbiter('AsyncGradientArbiter', { instance: this.system.asyncGradient });
        console.log('   ✅ AsyncGradientArbiter ready');

        // Regression Tester - Prevents performance degradation
        this.system.regressionTester = new RegressionTester({
            name: 'RegressionTester',
            quadBrain: this.system.quadBrain,
            messageBroker: this.system.messageBroker
        });
        this.system.messageBroker.registerArbiter('RegressionTester', { instance: this.system.regressionTester });
        console.log('   ✅ RegressionTester ready (prevents forgetting)');

        // Bootstrap Training Arbiter - Complete self-training pipeline
        this.system.bootstrapTraining = new BootstrapTrainingArbiter({
            name: 'BootstrapTrainingArbiter',
            metaLearning: this.system.metaLearning,
            quadBrain: this.system.quadBrain,
            gpuTraining: this.system.gpuTraining,
            mnemonic: this.system.mnemonic
        });
        this.system.messageBroker.registerArbiter('BootstrapTrainingArbiter', { instance: this.system.bootstrapTraining });
        console.log('   ✅ BootstrapTrainingArbiter ready (self-training enabled)');

        console.log('   🎓 Training Pipeline Complete - SOMA can now self-train!\n');

        // BabyAGI
        this.system.babyAGI = new BabyAGIManager({ apiKeys: this.config.apiKeys });
        this.system.messageBroker.registerArbiter('BabyAGIManager', { instance: this.system.babyAGI });
        console.log('   ✅ BabyAGI Manager ready');

        // KEVIN - Initialized by launcher_ULTRA.mjs using KevinArbiter
        // (KEVINManager removed - legacy code that tried to spawn non-existent KEVIN.exe)
        console.log('   ℹ️ KEVIN Manager initialized externally (KevinArbiter)');

        // Nighttime Learning
        this.system.nighttimeLearning = new NighttimeLearningOrchestrator({ name: 'NighttimeLearningOrchestrator' });
        await this.system.nighttimeLearning.initialize({
            ...this.system,
            knowledgeGraph: this.system.knowledgeGraph, // Inject KG for active dreaming
            archivist: this.system.archivist, // Inject Archivist for compression tasks
            visualProprioception: this.system.visualProprioception // Inject Visualizer
        });
        this.system.messageBroker.registerArbiter('NighttimeLearningOrchestrator', { instance: this.system.nighttimeLearning });
        console.log('   ✅ NighttimeLearningOrchestrator ready');
        // console.log('   ✅ NighttimeLearningOrchestrator ready');
        // console.log(`   ⏰ Scheduled ${this.system.nighttimeLearning.cronJobs.size} autonomous learning sessions`);
        // if (this.system.nighttimeLearning.cronJobs.size > 0) {
        //   for (const [name, jobInfo] of this.system.nighttimeLearning.cronJobs) {
        //     console.log(`      - ${name}: ${jobInfo.cronExpression}`);
        //   }
        // } else {
        //   console.log('   ⚠️  WARNING: No learning sessions were scheduled!');
        // }

        // Autonomous Systems
        console.log('   DEBUG: Initializing LocalModelServer...');
        this.system.localModelServer = new LocalModelServer({
            name: 'LocalModelServer',
            ollamaEndpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
            defaultModel: process.env.OLLAMA_MODEL || 'gemma3:4b'
        });
        await this.system.localModelServer.initialize();
        console.log('   ✅ LocalModelServer ready');

        this.system.intelligentRouter = new IntelligentRouter({
            name: 'IntelligentRouter',
            geminiModel: this.system.quadBrain,
            localModelServer: this.system.localModelServer
        });
        await this.system.intelligentRouter.initialize();
        console.log('   ✅ IntelligentRouter ready');

        this.system.syntheticDataGenerator = new SyntheticDataGenerator({
            name: 'SyntheticDataGenerator',
            quadBrain: this.system.quadBrain,
            reasoningChamber: this.system.reasoning,
            curiosityEngine: this.system.curiosity,
            fragmentRegistry: this.system.fragmentRegistry,
            museEngine: this.system.muse,
            outputPath: join(this.rootPath, '.soma', 'synthetic-data')
        });
        await this.system.syntheticDataGenerator.initialize();
        console.log('   ✅ SyntheticDataGenerator ready');

        // AutoTrainingCoordinator - Now with timeout protection
        try {
            this.system.autoTrainingCoordinator = new AutoTrainingCoordinator({
                name: 'AutoTrainingCoordinator',
                gpuTraining: this.system.gpuTraining,
                learningPipeline: this.system.learningPipeline,
                localModelServer: this.system.localModelServer,
                syntheticDataGenerator: this.system.syntheticDataGenerator
            });
            await this.system.autoTrainingCoordinator.initialize();
            console.log('   ✅ AutoTrainingCoordinator ready');
        } catch (error) {
            console.warn('   ⚠️  AutoTrainingCoordinator initialization failed:', error.message);
            console.warn('   ⚠️  System will continue without auto-training capabilities');
        }

        // Ollama Auto-Trainer (Automatic retraining loop)
        this.system.ollamaAutoTrainer = new OllamaAutoTrainer({
            name: 'OllamaAutoTrainer',
            enabled: true,
            conversationThreshold: 100, // Retrain after 100 new conversations
            checkInterval: 3600000, // Check every hour
            minTimeBetweenTraining: 86400000 // 24 hours cooldown
        });
        await this.system.ollamaAutoTrainer.initialize({
            conversationHistory: this.system.conversationHistory,
            personalityForge: this.system.personalityForge,
            trainingDataExporter: this.system.trainingDataExporter
        });
        console.log('   ✅ OllamaAutoTrainer ready (Auto-retraining active)');

        // Synthetic Layered Cortex (Deep Cognition)
        this.system.syntheticCortex = new SyntheticLayeredCortex(this.system.messageBroker, {
            name: 'SyntheticCortex',
            quadBrain: this.system.quadBrain,
            emotionalEngine: this.system.emotional,
            logger: console
        });
        await this.system.syntheticCortex.initialize();
        console.log('   ✅ SyntheticLayeredCortex active (Deep Cognition)');

        // Immune System (The Auto-Healing Core) - UPGRADED to GuardianV2
        try {
            this.system.immuneSystem = new SelfHealingCloningGuardianArbiter({
                name: 'ImmuneSystemArbiter',
                quadBrain: this.system.quadBrain
            });
            const immuneInitOk = await this.system.immuneSystem.initialize();
            if (immuneInitOk) {
                console.log('   ✅ Immune System Arbiter active (GuardianV2 - Self-Healing + Cloning)');
            } else {
                console.log('   ⚠️ Immune System Arbiter initialization failed - continuing without it');
                this.system.immuneSystem = null;
            }
        } catch (error) {
            console.error('   ❌ Immune System Arbiter failed to load:', error.message);
            this.system.immuneSystem = null;
        }

        // Continuous Learning Bridge (connects existing learning to real-time improvements)
        this.system.continuousLearning = new ContinuousLearningBridge({
            name: 'ContinuousLearningBridge',
            maxPatterns: 1000,
            incrementalTrainInterval: 86400000,
            minExperiencesForTrain: 50
        });
        await this.system.continuousLearning.initialize({
            learningPipeline: this.system.learningPipeline,
            experienceBuffer: this.system.learningPipeline.experienceBuffer,
            metaLearning: this.system.metaLearning,
            nighttimeLearning: this.system.nighttimeLearning,
            conversationHistory: this.system.conversationHistory,
            trainingDataExporter: this.system.trainingDataExporter
        });
        console.log('   ✅ Continuous Learning Bridge active (Real-time + Hourly + Daily learning)');
        console.log(`   🔄 Incremental training every ${this.system.continuousLearning.incrementalTrainInterval / 3600000} hours`);

        // Immune System initialization moved up (Upgraded to GuardianV2)

        // Self-Healing Watchdog (Monitors & Repairs Components)
        console.log('\n🐕 Initializing Self-Healing Watchdog...');
        this.system.watchdog = new Watchdog({
            checkInterval: 30000,  // Check every 30 seconds
            maxRecoveryAttempts: 3
        });

        // Register critical components for monitoring
        this.system.watchdog.watch('QuadBrain', 
            async () => this.system.quadBrain?.isHealthy?.() ?? true,
            async () => this.system.quadBrain?.reset?.());
        this.system.watchdog.watch('Mnemonic',
            async () => this.system.mnemonic?.isHealthy?.() ?? true,
            async () => this.system.mnemonic?.reconnect?.());
        this.system.watchdog.watch('ConversationHistory',
            async () => this.system.conversationHistory?.db != null,
            null);

        // Register helper arbiters for repairs
        if (this.system.quadBrain) {
            this.system.watchdog.registerHelper('QuadBrain', this.system.quadBrain);
        }
        if (this.system.immuneSystem) {
            this.system.watchdog.registerHelper('ImmuneSystem', this.system.immuneSystem);
        }

        // Register swarm systems for distributed repairs
        if (this.system.microAgentPool) {
            this.system.watchdog.registerHelper('MicroAgentPool', this.system.microAgentPool);
            console.log('   🐝 MicroAgentPool registered for swarm repairs');
        }
        if (this.system.fragmentRegistry) {
            this.system.watchdog.registerHelper('FragmentRegistry', this.system.fragmentRegistry);
            console.log('   🧩 FragmentRegistry registered for specialized repairs');
        }

        // Register repair tools that use ImmuneSystem and Swarm
        this.system.watchdog.registerTool('immune_heal', async (component, error) => {
            if (this.system.immuneSystem?.heal) {
                console.log(`[Watchdog] 🏥 Requesting ImmuneSystem to heal ${component}`);
                return await this.system.immuneSystem.heal(component, error);
            }
            return false;
        });

        this.system.watchdog.registerTool('spawn_repair_agent', async (component, error) => {
            if (this.system.microAgentPool?.spawn) {
                console.log(`[Watchdog] 🐝 Spawning repair micro-agent for ${component}`);
                const agent = await this.system.microAgentPool.spawn({
                    task: 'repair',
                    target: component,
                    error: error?.message,
                    priority: 'high'
                });
                return agent?.success || false;
            }
            return false;
        });

        this.system.watchdog.registerTool('find_specialist', async (component, error) => {
            if (this.system.fragmentRegistry?.findExpert) {
                console.log(`[Watchdog] 🔍 Finding specialist fragment for ${component}`);
                const expert = await this.system.fragmentRegistry.findExpert(component);
                if (expert?.repair) {
                    return await expert.repair(error);
                }
            }
            return false;
        });

        // Add swarm-based fixes to known fixes
        this.system.watchdog.knownFixes.set('arbiter_crash', { 
            action: 'immune_heal', 
            description: 'Use ImmuneSystem to heal crashed arbiter' 
        });
        this.system.watchdog.knownFixes.set('memory_leak', { 
            action: 'spawn_repair_agent', 
            description: 'Spawn micro-agent to clean up memory' 
        });
        this.system.watchdog.knownFixes.set('specialized_error', { 
            action: 'find_specialist', 
            description: 'Find specialist fragment for repair' 
        });

        // Start watching
        this.system.watchdog.start();
        console.log('   ✅ Watchdog active (Self-Healing + Swarm Repairs Enabled)');

        // Connect SafeArbiter-wrapped components to Watchdog for full healing chain
        if (this.system.safeQuadBrain) {
            this.system.safeQuadBrain.setWatchdog(this.system.watchdog);
            console.log('   🔗 SafeArbiter(QuadBrain) → Watchdog → ImmuneSystem chain connected');
        }

        // Conversation Compressor (Memory Management)
        console.log('\n🗜️ Initializing Conversation Compressor...');
        this.system.conversationCompressor = new ConversationCompressor({
            fullDetailTokens: 50000,    // < 50k: Full detail
            summarizedTokens: 150000,   // 50k-150k: Summarized
            keyFactsTokens: 200000,     // 150k-200k: Key facts only
            archiveTokens: 250000       // > 250k: Archive to long-term memory
        });
        await this.system.conversationCompressor.initialize({
            quadBrain: this.system.quadBrain,
            mnemonic: this.system.mnemonic,
            conversationHistory: this.system.conversationHistory
        });
        console.log('   ✅ Conversation Compressor active');
        console.log('   📊 Memory tiers: Full (<50k) → Summary (<150k) → Key Facts (<200k) → Archive');

        // Audio Processing (Whisper)
        const AudioProcessingArbiterModule = await import('../arbiters/AudioProcessingArbiter.cjs').catch(() => null);
        const AudioProcessingArbiter = AudioProcessingArbiterModule?.default
            || AudioProcessingArbiterModule?.AudioProcessingArbiter
            || AudioProcessingArbiterModule;
        if (AudioProcessingArbiter) {
            this.system.audioProcessing = new AudioProcessingArbiter({
                name: 'AudioProcessingArbiter'
            });
            await this.system.audioProcessing.initialize();
            this.system.messageBroker.registerArbiter('AudioProcessingArbiter', { instance: this.system.audioProcessing });
            console.log('   ✅ AudioProcessingArbiter ready (Whisper Active)');
        } else {
            console.warn('   ⚠️ AudioProcessingArbiter not found - skipping');
        }

        // Vision Processing (CLIP)
        const { VisionProcessingArbiter } = await import('../arbiters/VisionProcessingArbiter.js');
        this.system.visionProcessing = new VisionProcessingArbiter({
            name: 'VisionProcessingArbiter',
            batchSize: 32,
            loadPipeline: this.system.loadPipeline // Inject load pipeline for GPU check
        });
        await this.system.visionProcessing.initialize();
        this.system.messageBroker.registerArbiter('VisionProcessingArbiter', { instance: this.system.visionProcessing });
        console.log('   ✅ VisionProcessingArbiter ready (CLIP Active)');

        // Quantum Simulation (Strategic Directive Q1 2026)
        this.system.quantumSim = new QuantumSimulationArbiter({ name: 'QuantumSimulationArbiter' });
        await this.system.quantumSim.initialize();
        console.log('   ✅ Quantum Simulation Arbiter active (Ready for Circuit Simulation)');

        // Physics Simulation (Embodied Learning) — disabled until fully implemented
        // Gate behind SOMA_LOAD_SIMULATION=true to prevent runaway CPU/memory in daemon
        if (process.env.SOMA_LOAD_SIMULATION !== 'true') {
            console.log('\n🎮 Physics Simulation: SKIPPED (set SOMA_LOAD_SIMULATION=true to enable)');
        } else
        // eslint-disable-next-line no-constant-condition
        if (true) {
        console.log('\n🎮 Initializing Physics Simulation for Embodied Learning...');
        try {
            this.system.simulation = new SimulationArbiter({ name: 'SimulationArbiter', port: 8081 });
            await this.system.simulation.initialize();
            console.log('   ✅ Physics Simulation running (Matter.js Engine)');
            console.log('   📡 Visualization WebSocket: ws://localhost:8081');

            this.system.simulationController = new SimulationControllerArbiter({
                name: 'SimulationControllerArbiter',
                actionInterval: 100,
                explorationRate: 0.1, // Reduced exploration
                learningRate: 0.1,
                messageBroker: this.system.messageBroker // Inject message broker
            });
            await this.system.simulationController.initialize();
            console.log('   ✅ RL Controller active (Q-Learning Agent)');

            // Demonstration Learner (Imitation Learning from User)
            this.system.demonstrationLearner = new DemonstrationLearner({
                name: 'DemonstrationLearner'
            });
            await this.system.demonstrationLearner.initialize();
            console.log('   ✅ Demonstration Learner active (Imitation Learning)');

            console.log('   🤖 SOMA is now learning to control her body in the simulation!');
            console.log('   🎮 Switch to User Control mode to teach SOMA by demonstration!');
        } catch (error) {
            console.error('   ⚠️  Physics Simulation failed to start:', error.message);
        }
        } // end SOMA_LOAD_SIMULATION guard

        // Gist Arbiter (Wisdom Distiller)
        this.system.gistArbiter = new GistArbiter({ name: 'GistArbiter', threshold: 20 });
        await this.system.gistArbiter.initialize({
            brain: this.system.quadBrain,
            mnemonic: this.system.mnemonic,
            history: this.system.conversationHistory
        });
        console.log('   ✅ Gist Arbiter active (Hierarchical Summarization Enabled)');

        // ═══════════════════════════════════════════════════════════
        // Phase 2C: Trading System (P2 - 80% Trading Intelligence)
        // ═══════════════════════════════════════════════════════════
        console.log('\n📊 Initializing Trading Intelligence Components...');

        // Market Regime Detector - Identify market conditions
        this.system.marketRegime = new MarketRegimeDetector();
        this.system.messageBroker.registerArbiter('MarketRegimeDetector', { instance: this.system.marketRegime });
        console.log('   ✅ MarketRegimeDetector ready');

        // Multi-Timeframe Analyzer - Analyze across timeframes
        this.system.mtfAnalyzer = new MultiTimeframeAnalyzer();
        this.system.messageBroker.registerArbiter('MultiTimeframeAnalyzer', { instance: this.system.mtfAnalyzer });
        console.log('   ✅ MultiTimeframeAnalyzer ready');

        // Adaptive Position Sizer - Dynamic position sizing
        this.system.positionSizer = new AdaptivePositionSizer({
            basePositionSize: 1000,
            maxPositionSize: 5000,
            minPositionSize: 100
        });
        this.system.messageBroker.registerArbiter('AdaptivePositionSizer', { instance: this.system.positionSizer });
        console.log('   ✅ AdaptivePositionSizer ready');

        // Economic Calendar - Track market events
        this.system.economicCalendar = new EconomicCalendar({ rootPath: this.rootPath });
        await this.system.economicCalendar.initialize();
        this.system.messageBroker.registerArbiter('EconomicCalendar', { instance: this.system.economicCalendar });
        console.log('   ✅ EconomicCalendar ready');

        // Sentiment Aggregator - Aggregate market sentiment
        this.system.sentimentAggregator = new SentimentAggregator({ rootPath: this.rootPath });
        await this.system.sentimentAggregator.initialize();
        this.system.messageBroker.registerArbiter('SentimentAggregator', { instance: this.system.sentimentAggregator });
        console.log('   ✅ SentimentAggregator ready');

        // Performance Analytics - Track trading performance
        this.system.performanceAnalytics = new PerformanceAnalytics({ rootPath: this.rootPath });
        await this.system.performanceAnalytics.initialize();
        this.system.messageBroker.registerArbiter('PerformanceAnalytics', { instance: this.system.performanceAnalytics });
        console.log('   ✅ PerformanceAnalytics ready');

        // Smart Order Router - Intelligent order routing
        this.system.orderRouter = new SmartOrderRouter({ rootPath: this.rootPath });
        await this.system.orderRouter.initialize();
        this.system.messageBroker.registerArbiter('SmartOrderRouter', { instance: this.system.orderRouter });
        console.log('   ✅ SmartOrderRouter ready');

        // Backtest Engine - Test strategies on historical data
        this.system.backtestEngine = new BacktestEngine({
            quadBrain: this.system.quadBrain,
            mtfAnalyzer: this.system.mtfAnalyzer,
            positionSizer: this.system.positionSizer,
            regimeDetector: this.system.marketRegime,
            rootPath: this.rootPath
        });
        await this.system.backtestEngine.initialize();
        this.system.messageBroker.registerArbiter('BacktestEngine', { instance: this.system.backtestEngine });
        console.log('   ✅ BacktestEngine ready (strategy testing enabled)');

        console.log('   📊 Trading Intelligence Complete - 100% trading features active!\n');

        // FINANCE MODULE (The Autonomous Hedge Fund)
        console.log('\n📈 Initializing Finance Module...');
        try {
            const { FinanceAgentArbiter } = await import('../arbiters/FinanceAgentArbiter.js');
            this.system.finance = new FinanceAgentArbiter({ name: 'FinanceAgentArbiter', rootPath: this.rootPath });
            await this.system.finance.initialize();
            this.system.messageBroker.registerArbiter('FinanceAgentArbiter', { instance: this.system.finance });
            console.log('   ✅ FinanceAgentArbiter active (Deep Agent Trading)');
        } catch (error) {
            console.warn('   ⚠️ Finance Agent failed to start:', error.message);
        }

        // MISSION CONTROL (System Dashboard)
        try {
            const { MissionControlArbiter } = await import('../arbiters/MissionControlArbiter.js');
            this.system.missionControl = new MissionControlArbiter({ name: 'MissionControlArbiter' });
            await this.system.missionControl.initialize();
            this.system.messageBroker.registerArbiter('MissionControlArbiter', { instance: this.system.missionControl });
            console.log('   ✅ MissionControlArbiter active');
        } catch (error) {
            console.warn('   ⚠️ Mission Control failed to start:', error.message);
        }

        // FORECASTER (Predictive Modeling)
        try {
            const { ForecasterArbiter } = await import('../arbiters/ForecasterArbiter.js');
            this.system.forecaster = new ForecasterArbiter({ name: 'ForecasterArbiter' });
            await this.system.forecaster.initialize();
            this.system.messageBroker.registerArbiter('ForecasterArbiter', { instance: this.system.forecaster });
            console.log('   ✅ ForecasterArbiter active');
        } catch (error) {
            console.warn('   ⚠️ Forecaster failed to start:', error.message);
        }

        // Phase 3 AGI Systems (Audio, Vision, Simulation, Self-Healing)
        console.log('\n🧠 Spawning Phase 3 AGI Arbiter Population...');
        try {
            this.system.orchestrator = new ArbiterOrchestrator();
            await this.system.orchestrator.initialize();

            // Register manually created arbiters with orchestrator so they're recognized by AGI systems
            this.system.orchestrator.registerExistingArbiter('MnemonicArbiter', 'MnemonicArbiter', this.system.mnemonic);
            this.system.orchestrator.registerExistingArbiter('QuadBrain', 'QuadBrain', this.system.quadBrain);
            this.system.orchestrator.registerExistingArbiter('CronaArbiter', 'CronaArbiter', this.system.crona);
            this.system.orchestrator.registerExistingArbiter('TimekeeperArbiter', 'TimekeeperArbiter', this.system.timekeeper);
            this.system.orchestrator.registerExistingArbiter('UnifiedMemoryArbiter', 'UnifiedMemoryArbiter', this.system.unifiedMemory);
            this.system.orchestrator.registerExistingArbiter('EmotionalEngine', 'EmotionalEngine', this.system.emotional);
            this.system.orchestrator.registerExistingArbiter('PersonalityEngine', 'PersonalityEngine', this.system.personality);
            this.system.orchestrator.registerExistingArbiter('LearningVelocityTracker', 'LearningVelocityTracker', this.system.velocityTracker);
            this.system.orchestrator.registerExistingArbiter('EdgeWorkerOrchestrator', 'EdgeWorkerOrchestrator', this.system.edgeWorker);
            this.system.orchestrator.registerExistingArbiter('GoalPlannerArbiter', 'GoalPlannerArbiter', this.system.goalPlanner);
            this.system.orchestrator.registerExistingArbiter('ImmuneSystemArbiter', 'ImmuneSystemArbiter', this.system.immuneSystem);
            this.system.orchestrator.registerExistingArbiter('SimulationArbiter', 'SimulationArbiter', this.system.simulation);
            this.system.orchestrator.registerExistingArbiter('SimulationControllerArbiter', 'SimulationControllerArbiter', this.system.simulationController);
            this.system.orchestrator.registerExistingArbiter('DemonstrationLearner', 'DemonstrationLearner', this.system.demonstrationLearner);
            this.system.orchestrator.registerExistingArbiter('GistArbiter', 'GistArbiter', this.system.gistArbiter);

            // Register Phase 2A: Critical Infrastructure Arbiters
            this.system.noveltyTracker = new NoveltyTracker({ name: 'NoveltyTracker' });
            this.system.orchestrator.registerExistingArbiter('NoveltyTracker', 'NoveltyTracker', this.system.noveltyTracker);

            this.system.conservativeArbiter = new ConservativeArbiter({ name: 'ConservativeArbiter' });
            this.system.orchestrator.registerExistingArbiter('ConservativeArbiter', 'ConservativeArbiter', this.system.conservativeArbiter);

            this.system.progressiveArbiter = new ProgressiveArbiter({ name: 'ProgressiveArbiter' });
            this.system.orchestrator.registerExistingArbiter('ProgressiveArbiter', 'ProgressiveArbiter', this.system.progressiveArbiter);

            console.log('   ✅ Critical infrastructure arbiters registered (NoveltyTracker, ConservativeArbiter, ProgressiveArbiter)');

            await this.system.orchestrator.spawnPopulation({});
            console.log('   ✅ Phase 3 AGI arbiters spawned (22 total including critical infrastructure)');
            console.log('   ✅ Audio Intelligence (Whisper API)');
            console.log('   ✅ Vision Intelligence (Gemini Vision)');
            console.log('   ✅ Embodied Learning (Physics Simulation)');
            console.log('   ✅ Self-Healing (Immune System)');
            console.log('   📡 Simulation WebSocket: ws://localhost:8081');
        } catch (error) {
            console.error('   ❌ Failed to spawn Phase 3 arbiters:', error.message);
            console.error('   Stack:', error.stack);
        }

        // AGI System Integration - Wire everything together (P0 - Critical Infrastructure)
        try {
            console.log('\n🧠 Initializing AGI System Integration...');
            this.system.agiIntegration = new AGISystemIntegration();
            await this.system.agiIntegration.initializeAGI(this.system.orchestrator);
            console.log('   ✅ AGI coordination loop active');
        } catch (error) {
            console.error('   ❌ AGI Integration failed:', error.message);
            console.error('   Stack:', error.stack);
        }

        // PLUGIN LOADER (Phase 3)
        try {
            console.log('\n🔌 Initializing Dynamic Plugin System...');
            const { PluginLoader } = await import('./PluginLoader.js');
            const loader = new PluginLoader(this.system);
            await loader.loadPlugins();
        } catch (err) {
            console.error('   ❌ Plugin Loader failed:', err.message);
        }

        // Startup Performance Summary
        const totalTime = Date.now() - startTime;
        console.log('\n⏱️  Startup Performance Summary:');
        console.log(`   Total Time: ${(totalTime / 1000).toFixed(2)}s`);

        const slowComponents = Object.entries(startupTimes)
            .filter(([, time]) => time > 500)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        if (slowComponents.length > 0) {
            console.log('   Slowest Components:');
            slowComponents.forEach(([name, time]) => {
                console.log(`     - ${name}: ${(time / 1000).toFixed(2)}s`);
            });
        }

        console.log('\n🎉 SOMA Bootstrap Complete! (Level 4.5 UNLEASHED - Safe Mode)\n');
        return this.system;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE METHODS - Breaking down god code into manageable chunks
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Phase 1: Load all modules dynamically
     * Returns: Object with all imported modules
     */
    async _phase1_loadModules() {
        console.log('📦 PHASE 1: Loading Modules...');
        const modules = {};

        // Load SelfImprovementCoordinator
        console.log('   - Importing SelfImprovementCoordinator...');
        const { SelfImprovementCoordinator } = await import('../arbiters/SelfImprovementCoordinator.js');
        modules.SelfImprovementCoordinator = SelfImprovementCoordinator;

        // Load CodeObservationArbiter
        console.log('   - Importing CodeObservationArbiter...');
        const { CodeObservationArbiter } = await import('../arbiters/CodeObservationArbiter.js');
        modules.CodeObservationArbiter = CodeObservationArbiter;

        // Load GoalPlannerArbiter
        console.log('   - Importing GoalPlannerArbiter...');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);
        const GoalPlannerArbiterModule = require('../arbiters/GoalPlannerArbiter.cjs');
        modules.GoalPlannerArbiter = GoalPlannerArbiterModule.default || GoalPlannerArbiterModule.GoalPlannerArbiter || GoalPlannerArbiterModule;

        return modules;
    }

    /**
     * Phase 2: Initialize core foundation systems
     * - MessageBroker
     * - LoadManager
     * - Basic arbiters (Mnemonic, QuadBrain, etc.)
     */
    /**
     * Phase 2: Core Foundation
     * NOTE: Trinity Core Architecture already initializes all foundation components.
     * This phase is kept for future enhancements but currently does nothing.
     */
    async _phase2_coreFoundation(modules) {
        // Trinity already initialized: MessageBroker, Mnemonic, LocalModelManager, QuadBrain, etc.
        // This phase is reserved for additional foundation components if needed
    }

    /**
     * Phase 3: Initialize learning systems
     * - MetaLearning
     * - Training Pipeline
     * - GPU Training
     */
    async _phase3_learningSystems(modules) {
        console.log('\n🎓 PHASE 3: Learning Systems...');

        // Self-Improvement Coordinator (ASI-Level Self-Enhancement)
        if (modules.SelfImprovementCoordinator) {
            try {
                console.log('   - Initializing SelfImprovementCoordinator...');
                this.system.selfImprovement = new modules.SelfImprovementCoordinator({
                    name: 'SelfImprovementCoordinator',
                    messageBroker: this.system.messageBroker,
                    noveltyCheckEnabled: true,
                    skillLearningEnabled: true,
                    selfModificationEnabled: true,
                    beliefSystemEnabled: true,
                    capabilityExpansionEnabled: true,
                    improvementCycleInterval: 3600000 // Run every hour
                });
                await this.system.selfImprovement.initialize();
                console.log('   ✅ SelfImprovementCoordinator ready (NoveltyTracker + Skills + Self-Mod)');
            } catch (error) {
                console.warn('   ⚠️ SelfImprovementCoordinator failed to initialize:', error.message);
                console.warn('      Continuing without self-improvement features...');
            }
        }

        // Code Observation (SOMA's Self-Awareness)
        if (modules.CodeObservationArbiter) {
            try {
                console.log('   - Initializing CodeObservationArbiter...');
                this.system.codeObserver = new modules.CodeObservationArbiter({
                    basePath: this.rootPath,
                    quadBrain: this.system.quadBrain,
                    scanInterval: 3600000 // Scan every hour
                });
                await this.system.codeObserver.initialize();
                this.system.messageBroker.registerArbiter('CodeObservationArbiter', {
                    instance: this.system.codeObserver
                });
                console.log('   ✅ Code Observer ready (monitoring codebase)');
            } catch (error) {
                console.warn('   ⚠️ CodeObservationArbiter failed to initialize:', error.message);
                console.warn('      Continuing without code observation...');
            }
        }

        // Goal Planner (Autonomous Goal Generation & Coordination)
        if (modules.GoalPlannerArbiter) {
            try {
                console.log('   - Initializing GoalPlannerArbiter...');
                const GoalPlannerClass = modules.GoalPlannerArbiter.default || modules.GoalPlannerArbiter;
                this.system.goalPlanner = new GoalPlannerClass({ name: 'GoalPlannerArbiter' });
                await this.system.goalPlanner.initialize();
                this.system.messageBroker.registerArbiter('GoalPlannerArbiter', {
                    instance: this.system.goalPlanner
                });
                console.log('   ✅ Goal Planner ready (autonomous goal generation)');
            } catch (error) {
                console.warn('   ⚠️ GoalPlannerArbiter failed to initialize:', error.message);
                console.warn('      Continuing without goal planning...');
            }
        }
    }

    /**
     * Phase 4: Initialize domain intelligence
     * - Trading System (8 components)
     * - Finance Module
     * - Specialized systems
     */
    async _phase4_domainIntelligence(modules) {
        console.log('\n📊 PHASE 4: Domain Intelligence...');
        // Trading and finance systems will be moved here
    }

    /**
     * Phase 5: Spawn AGI population
     * - ArbiterOrchestrator
     * - Population spawning
     * - Critical infrastructure registration
     */
    async _phase5_agiPopulation(modules) {
        console.log('\n🧠 PHASE 5: AGI Population...');
        // Orchestrator and population will be moved here
    }

    /**
     * Phase 6: Final integration
     * - AGI-Integration coordination loop
     * - Plugin loading
     * - System ready
     */
    async _phase6_integration(modules) {
        console.log('\n🔗 PHASE 6: Integration & Finalization...');
        // AGI-Integration and plugins will be moved here
    }

    // ─── Phase ASI: Recursive Self-Improvement Loop ───────────────────────────
    async _phase_asi() {
        console.log('\n⚡ Initializing ASI Systems...');

        try {
            // 1. Constitutional Core — must be first (safety gate for everything else)
            this.system.constitutional = new ConstitutionalCore();
            await this.system.constitutional.initialize();
            console.log('   ✅ ConstitutionalCore ready');

            // 2. Capability Benchmark — must be second (needed by ASIKernel)
            this.system.benchmark = new CapabilityBenchmark({ system: this.system });
            await this.system.benchmark.initialize();
            // Take an initial baseline snapshot
            this.system.benchmark.snapshot().catch(() => {});
            console.log('   ✅ CapabilityBenchmark ready');

            // 3. Transfer Synthesizer — cross-domain pattern extraction
            this.system.transfer = new TransferSynthesizer({
                system: this.system,
                brain:  this.system.quadBrain,
            });
            await this.system.transfer.initialize();
            console.log('   ✅ TransferSynthesizer ready');

            // 4. Long Horizon Planner — vision-level planning
            this.system.longHorizon = new LongHorizonPlanner({
                system: this.system,
                brain:  this.system.quadBrain,
            });
            await this.system.longHorizon.initialize();
            console.log('   ✅ LongHorizonPlanner ready');

            // 5. ASI Kernel — closes the loop
            this.system.asiKernel = new ASIKernel({ system: this.system });
            await this.system.asiKernel.initialize();
            console.log('   ✅ ASIKernel ready');

            // Wire ASI events → messageBroker for frontend consumption
            if (this.system.messageBroker) {
                this.system.asiKernel.on('improvement', (data) => {
                    this.system.messageBroker.publish?.('asi_improvement', data);
                    this.system.ws?.broadcast?.('asi_improvement', data);
                });
                this.system.asiKernel.on('blocked', (data) => {
                    this.system.messageBroker.publish?.('asi_blocked', data);
                });
            }

            // Wire AutonomousHeartbeat to trigger ASI cycle when tension is high
            if (this.system.autonomousHeartbeat) {
                const _origTick = this.system.autonomousHeartbeat.tick?.bind(this.system.autonomousHeartbeat);
                if (_origTick) {
                    this.system.autonomousHeartbeat.tick = async function (...args) {
                        // Run ASI cycle if drive tension is high and kernel isn't busy
                        const drive = this.drive?.getStatus?.() || {};
                        if (drive.tension > 0.6 && this.system.asiKernel && !this.system.asiKernel._busy) {
                            this.system.asiKernel.runCycle().catch(() => {});
                        }
                        return _origTick(...args);
                    };
                }
            }

            // Daily long-horizon alignment (midnight cron)
            if (this.system.autonomousHeartbeat?.addSchedule) {
                this.system.autonomousHeartbeat.addSchedule({
                    id:       'asi_daily_align',
                    name:     'ASI daily goal alignment',
                    schedule: { kind: 'cron', expr: '0 0 * * *' },
                    message:  'ASI daily: align goals to long-horizon milestones',
                });
            }

            console.log('[SOMA] ⚡ ASI Kernel online — recursive self-improvement ACTIVE');

        } catch (err) {
            // ASI systems are enhancement — never block SOMA boot on their failure
            console.warn(`   ⚠️  ASI systems failed to initialize: ${err.message}`);
            console.warn('   SOMA will continue without ASI recursive improvement.');
        }
    }

// TEMP: perception phase method to inject into SomaBootstrap.js
// This file is read by the injection script and then deleted.

    // ─── Phase Perception: Daemon Layer + Attention Engine + Engineering Swarm ─
    async _phase_perception() {
        console.log('\n\u{1F441}\uFE0F  PHASE PERCEPTION: Booting Daemon Layer...');
        try {
            // 1. DaemonManager
            const { DaemonManager }      = await import('./DaemonManager.js');
            const { RepoWatcherDaemon }  = await import('../daemons/RepoWatcherDaemon.js');
            const { HealthDaemon }       = await import('../daemons/HealthDaemon.js');
            const { OptimizationDaemon } = await import('../daemons/OptimizationDaemon.js');
            const { DiscoveryDaemon }    = await import('../daemons/DiscoveryDaemon.js');

            this.system.daemonManager = new DaemonManager({ logger: console });

            // 2. AttentionArbiter — wired as CNS gate BEFORE daemons start
            //    MessageBroker._deliverSignal already checks this.attentionEngine
            try {
                const { AttentionArbiter } = await import('../arbiters/AttentionArbiter.js');
                this.system.attentionArbiter = new AttentionArbiter({ name: 'AttentionArbiter' });
                await this.system.attentionArbiter.initialize();
                this.system.messageBroker.attentionEngine = this.system.attentionArbiter;
                console.log('   \u2705 AttentionArbiter wired as CNS gate (prevents arbiter storms)');
            } catch (err) {
                console.warn(`   \u26A0\uFE0F  AttentionArbiter skipped: ${err.message}`);
            }

            // 3. EngineeringSwarmArbiter — full research/plan/debate/synthesis cycle
            try {
                const { EngineeringSwarmArbiter } = await import('../arbiters/EngineeringSwarmArbiter.js');
                this.system.engineeringSwarm = new EngineeringSwarmArbiter({
                    name:      'EngineeringSwarmArbiter',
                    quadBrain: this.system.quadBrain,
                    rootPath:  this.rootPath
                });
                await this.system.engineeringSwarm.initialize();
                this.system.messageBroker.registerArbiter('EngineeringSwarmArbiter', {
                    instance:       this.system.engineeringSwarm,
                    role:           'implementer',
                    lobe:           'motor_cortex',
                    classification: 'engineering'
                });
                console.log('   \u2705 EngineeringSwarmArbiter online (research \u2192 plan \u2192 debate \u2192 patch \u2192 verify)');
            } catch (err) {
                console.warn(`   \u26A0\uFE0F  EngineeringSwarmArbiter skipped: ${err.message}`);
            }

            // 4. SwarmOptimizer — records swarm outcomes and proposes improvements
            try {
                const { SwarmOptimizer } = await import('../arbiters/SwarmOptimizer.js');
                this.system.swarmOptimizer = new SwarmOptimizer({
                    name:      'SwarmOptimizer',
                    swarm:     this.system.engineeringSwarm,
                    quadBrain: this.system.quadBrain
                });
                await this.system.swarmOptimizer.initialize();
                if (this.system.engineeringSwarm?.setOptimizer) {
                    this.system.engineeringSwarm.setOptimizer(this.system.swarmOptimizer);
                }
                this.system.messageBroker.registerArbiter('SwarmOptimizer', {
                    instance:       this.system.swarmOptimizer,
                    role:           'analyst',
                    lobe:           'prefrontal',
                    classification: 'optimizer'
                });
                console.log('   \u2705 SwarmOptimizer wired (hourly perf analysis + self-improvement loop)');
            } catch (err) {
                console.warn(`   \u26A0\uFE0F  SwarmOptimizer skipped: ${err.message}`);
            }

            // 5. DiscoverySwarm — autonomous capability invention, daily scan
            try {
                const { DiscoverySwarm } = await import('../arbiters/DiscoverySwarm.js');
                this.system.discoverySwarm = new DiscoverySwarm({
                    name:        'DiscoverySwarm',
                    engineering: this.system.engineeringSwarm,
                    quadBrain:   this.system.quadBrain
                });
                await this.system.discoverySwarm.initialize();
                this.system.messageBroker.registerArbiter('DiscoverySwarm', {
                    instance:       this.system.discoverySwarm,
                    role:           'scout',
                    lobe:           'prefrontal',
                    classification: 'discovery'
                });
                console.log('   \u2705 DiscoverySwarm online (daily capability invention scan)');
            } catch (err) {
                console.warn(`   \u26A0\uFE0F  DiscoverySwarm skipped: ${err.message}`);
            }

            // 6. Register daemons and start (startAll also launches watchdog)
            this.system.daemonManager.register(new RepoWatcherDaemon({ root: this.rootPath }));
            this.system.daemonManager.register(new HealthDaemon({ intervalMs: 30_000 }));
            this.system.daemonManager.register(new OptimizationDaemon({
                optimizer:  this.system.swarmOptimizer,
                intervalMs: 3_600_000     // hourly
            }));
            this.system.daemonManager.register(new DiscoveryDaemon({
                discovery:  this.system.discoverySwarm,
                intervalMs: 86_400_000    // daily
            }));
            await this.system.daemonManager.startAll();

            // 7. Wire signal reactions: perception drives the decision/execution loop
            this.system.messageBroker.subscribe('swarm.optimization.needed', async (signal) => {
                if (!this.system.swarmOptimizer) return;
                console.log('[SOMA] \uD83D\uDCCA Swarm optimization signal — running improvement cycle...');
                try {
                    const result = await this.system.swarmOptimizer.improve();
                    // Persist improvement outcome to mnemonic so SOMA remembers what changed
                    if (result && this.system.mnemonic) {
                        const summary = typeof result === 'string' ? result : JSON.stringify(result).slice(0, 500);
                        await this.system.mnemonic.remember(
                            `Optimization cycle completed: ${summary}`,
                            { source: 'swarm_optimizer', timestamp: Date.now() }
                        ).catch(() => {});
                    }
                } catch (err) {
                    console.warn('[SOMA] SwarmOptimizer.improve() failed:', err.message);
                }
            });

            this.system.messageBroker.subscribe('swarm.discovery.ideas', async (signal) => {
                if (!this.system.discoverySwarm) return;
                const ideas = signal.payload?.ideas || [];
                console.log(`[SOMA] \uD83D\uDCA1 DiscoverySwarm: ${ideas.length} idea(s) — prototyping top 3`);
                for (const idea of ideas.slice(0, 3)) {
                    try {
                        const result = await this.system.discoverySwarm.prototype(idea);
                        // Persist discovery outcome to mnemonic
                        if (this.system.mnemonic) {
                            const summary = typeof result === 'string' ? result : JSON.stringify(result).slice(0, 400);
                            await this.system.mnemonic.remember(
                                `Discovery prototyped: "${idea.name || idea}"\nOutcome: ${summary}`,
                                { source: 'discovery_swarm', timestamp: Date.now() }
                            ).catch(() => {});
                        }
                    } catch (err) {
                        console.warn(`[SOMA] Prototype failed for ${idea.name}: ${err.message}`);
                    }
                }
            });

            this.system.messageBroker.subscribe('health.warning', (signal) => {
                console.warn(`[SOMA] \uD83C\uDFE5 Health warning [${signal.source}]: ${JSON.stringify(signal.payload)}`);
                this.system.anomalyDetector?.record?.({
                    type: 'health_warning', payload: signal.payload, source: signal.source
                });
                // Persist health warnings to mnemonic for pattern recognition
                if (this.system.mnemonic) {
                    this.system.mnemonic.remember(
                        `Health warning from ${signal.source}: ${JSON.stringify(signal.payload)}`,
                        { source: 'health_daemon', priority: 'high', timestamp: Date.now() }
                    ).catch(() => {});
                }
            });

            console.log('[SOMA] \uD83D\uDC41\uFE0F  Perception Layer ACTIVE — 4 daemons, watchdog, attention gate, engineering swarm');

        } catch (err) {
            console.warn(`   \u26A0\uFE0F  Perception Layer failed: ${err.message}`);
            console.warn('   SOMA will continue without daemon perception. Non-fatal.');
        }
    }

    getHealth() {
        // Collect status from available components
        const health = {
            status: 'ok', // Aggregate status
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            components: {}
        };

        if (this.system.mnemonic) {
            health.components.mnemonic = { status: 'active' };
        }
        if (this.system.quadBrain) {
            health.components.quadBrain = { status: 'active', activeBrains: Object.keys(this.system.quadBrain.BRAINS || {}).length };
        }
        return health;
    }
}
