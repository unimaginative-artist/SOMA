/**
 * loaders/cognitive.js - PRODUCTION READY V4 (The Trinity & Cortexes)
 * 
 * Orchestrates SOMA's full cognitive architecture.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import path from 'path';
import MnemonicArbiter from '../../arbiters/MnemonicArbiter.js';
import { AdaptiveLearningRouter } from '../../arbiters/AdaptiveLearningRouter.js';
import { SOMArbiterV3 } from '../../arbiters/SOMArbiterV3.js'; 
import CausalityArbiter from '../../arbiters/CausalityArbiter.js';
import WorldModelArbiter from '../../arbiters/WorldModelArbiter.js';
import { MuseEngine } from '../../arbiters/MuseEngine.js';
import { PerformanceAnalytics } from '../../arbiters/PerformanceAnalytics.js';
import SimulationArbiter from '../../arbiters/SimulationArbiter.js';
import { GraphifyArbiter } from '../../arbiters/GraphifyArbiter.js';
import MedicalDiscoveryCortex from '../../arbiters/MedicalDiscoveryCortex.js';
import { BiotechArbiter } from '../../arbiters/BiotechArbiter.js';
import { SomaBrowserArbiter } from '../../arbiters/SomaBrowserArbiter.js';
import ReflectionsArbiter from '../../arbiters/ReflectionsArbiter.js';
import FinanceAgentArbiter from '../../arbiters/FinanceAgentArbiter.js';
import messageBroker from '../../core/MessageBroker.js';
import GameTheoryArbiter from '../../arbiters/GameTheoryArbiter.js';
import MacroEventArbiter from '../../arbiters/MacroEventArbiter.js';
import CyberSecArbiter from '../../arbiters/CyberSecArbiter.js';
import DistillationArbiter from '../../arbiters/DistillationArbiter.js';
import SubstrateOptimizerArbiter from '../../arbiters/SubstrateOptimizerArbiter.js';
import AdversarialSelfCorrectionArbiter from '../../arbiters/AdversarialSelfCorrectionArbiter.js';
import { startMemorySpineAutoSync } from '../utils/MemorySpine.js';

// CJS Imports
const GoalPlannerModule = require('../../arbiters/GoalPlannerArbiter.cjs');
const BeliefSystemModule = require('../../arbiters/BeliefSystemArbiter.cjs');
const LearningVelocityTrackerModule = require('../../arbiters/LearningVelocityTracker.cjs');
const TimekeeperArbiter = require('../../arbiters/TimekeeperArbiter.cjs');
const SteveArbiter = require('../../arbiters/SteveArbiter.cjs');
const { SwarmDelegationArbiter } = require('../../arbiters/SwarmDelegationArbiter.cjs');
const ExecutiveCortexArbiter = require('../../arbiters/ExecutiveCortexArbiter.js').ExecutiveCortexArbiter || require('../../arbiters/ExecutiveCortexArbiter.js').default || require('../../arbiters/ExecutiveCortexArbiter.js');
const SensoryCortexArbiter = require('../../arbiters/SensoryCortexArbiter.js').SensoryCortexArbiter || require('../../arbiters/SensoryCortexArbiter.js').default || require('../../arbiters/SensoryCortexArbiter.js');
const ImmuneCortexArbiter = require('../../arbiters/ImmuneCortexArbiter.js').ImmuneCortexArbiter || require('../../arbiters/ImmuneCortexArbiter.js').default || require('../../arbiters/ImmuneCortexArbiter.js');
const StrategyCortexArbiter = require('../../arbiters/StrategyCortexArbiter.js').StrategyCortexArbiter || require('../../arbiters/StrategyCortexArbiter.js').default || require('../../arbiters/StrategyCortexArbiter.js');
const KnowledgeGraphFusion = require('../../arbiters/KnowledgeGraphFusion.js').KnowledgeGraphFusion || require('../../arbiters/KnowledgeGraphFusion.js').default || require('../../arbiters/KnowledgeGraphFusion.js');

export async function loadCognitiveSystems(toolRegistry = null) {
    console.log('\n[Loader] 🧠 Initializing Neural Cortexes & Trinity Pillars...');

    const system = {};

    if (toolRegistry) {
        console.log('      🛠️  ToolRegistry connected to cognitive systems');
    }

    // Helper for safe initialization
    const initIfPossible = async (obj, name) => {
        if (obj && typeof obj.initialize === 'function') {
            const res = obj.initialize();
            if (res instanceof Promise) await res;
            console.log(`      ✅ ${name} ready`);
        } else if (obj && typeof obj.onActivate === 'function') {
            const res = obj.onActivate();
            if (res instanceof Promise) await res;
            console.log(`      ✅ ${name} ready (onActivate)`);
        } else {
            console.log(`      ✅ ${name} ready`);
        }
    };

    // 1. Memory & Router
    let mnemonicArbiter;
    try {
        mnemonicArbiter = new MnemonicArbiter({
            name: 'MnemonicArbiter',
            messageBroker,
            dbPath: path.join(process.cwd(), 'SOMA', 'soma-memory.db'),
            vectorDbPath: path.join(process.cwd(), 'soma-vectors.json'),
            skipEmbedder: true, // Fast startup - semantic search loads lazily
            redisUrl: null      // Don't require Redis - SQLite cold tier is sufficient
        });
        await mnemonicArbiter.initialize();
        console.log('      ✅ MnemonicArbiter ready (3-tier memory online)');
    } catch (memErr) {
        console.error('[Bootstrap] ⚠️ Memory system failed to init, using stub:', memErr.message);
        mnemonicArbiter = {
            initialize: async () => {},
            onInitialize: async () => {},
            remember: async () => ({ success: false, error: 'Memory offline' }),
            recall: async () => ({ results: [] }),
            getRecentColdMemories: (_limit = 20) => [],
            getMemoryStats: () => ({ hot: { size: 0 }, warm: { size: 0 }, cold: { size: 0 } })
        };
    }
    const adaptiveRouter = new AdaptiveLearningRouter({ name: 'AdaptiveRouter', messageBroker });
    await initIfPossible(adaptiveRouter, 'AdaptiveRouter');

    // 2. Knowledge & Causal
    const causality = new CausalityArbiter({ 
        name: 'CausalityArbiter', 
        messageBroker,
        lobe: 'KNOWLEDGE',
        classification: 'COGNITION',
        tags: ['prediction', 'logic', 'inference']
    });
    const worldModel = new WorldModelArbiter({ 
        name: 'WorldModelArbiter', 
        messageBroker,
        lobe: 'KNOWLEDGE',
        classification: 'SIMULATION',
        tags: ['prediction', 'physics', 'future']
    });

    // 2b. Graphify - Production Grade Knowledge Graph
    const graphify = new GraphifyArbiter({
        name: 'GraphifyArbiter',
        messageBroker,
        projectRoot: process.cwd()
    });

    const knowledgeGraph = new KnowledgeGraphFusion({ 
        name: 'KnowledgeGraph', 
        messageBroker,
        savePath: path.join(process.cwd(), 'SOMA', 'soma-knowledge.json'),
        lobe: 'KNOWLEDGE',
        classification: 'GRAPH',
        tags: ['concepts', 'relations', 'rattling']
    });
    await Promise.all([
        initIfPossible(causality, 'CausalityArbiter'),
        initIfPossible(worldModel, 'WorldModelArbiter'),
        initIfPossible(graphify, 'GraphifyArbiter'),
        initIfPossible(knowledgeGraph, 'KnowledgeGraph')
    ]);

    // 3. Brain
    const quadBrain = new SOMArbiterV3({
        name: 'SomaBrain',
        router: adaptiveRouter,
        mnemonic: mnemonicArbiter,
        messageBroker: messageBroker,
        causalityArbiter: causality,
        worldModel: worldModel,
        knowledgeGraph: graphify, // Replaced legacy KnowledgeGraphFusion with Graphify
        toolRegistry: toolRegistry, // Enable tool execution
        asiEnabled: true,
        lobe: 'COGNITIVE',
        classification: 'CORE',
        tags: ['reasoning', 'decision', 'synthesis']
    });
    await quadBrain.initialize();

    // 4. Cortexes
    system.immuneCortex = new ImmuneCortexArbiter({ 
        messageBroker,
        lobe: 'COGNITIVE',
        classification: 'SECURITY',
        tags: ['shield', 'threat', 'filtering']
    });
    system.executiveCortex = new ExecutiveCortexArbiter({ 
        messageBroker, 
        quadBrain,
        lobe: 'EXECUTIVE',
        classification: 'OPERATIONS',
        tags: ['hands', 'exec', 'steve']
    });
    system.sensoryCortex = new SensoryCortexArbiter({ 
        messageBroker,
        lobe: 'COGNITIVE',
        classification: 'SENSORY',
        tags: ['input', 'vision', 'audio']
    });
    system.strategyCortex = new StrategyCortexArbiter({ 
        messageBroker, 
        quadBrain,
        lobe: 'COGNITIVE',
        classification: 'STRATEGY',
        tags: ['planning', 'long-term', 'goals']
    });
    
    // 4b. Specialized Discovery Cortexes
    system.medicalDiscovery = new MedicalDiscoveryCortex({
        messageBroker,
        quadBrain,
        graphify: graphify,
        lobe: 'KNOWLEDGE',
        classification: 'MEDICAL'
    });

    await Promise.all([
        initIfPossible(system.immuneCortex, 'ImmuneCortex'),
        initIfPossible(system.executiveCortex, 'ExecutiveCortex'),
        initIfPossible(system.sensoryCortex, 'SensoryCortex'),
        initIfPossible(system.strategyCortex, 'StrategyCortex'),
        initIfPossible(system.medicalDiscovery, 'MedicalDiscoveryCortex')
    ]);

    // 5. Dashboard Intelligence
    const GoalPlannerArbiter = GoalPlannerModule.GoalPlannerArbiter || GoalPlannerModule.default || GoalPlannerModule;
    const BeliefSystemArbiter = BeliefSystemModule.BeliefSystemArbiter || BeliefSystemModule.default || BeliefSystemModule;
    const LearningVelocityTracker = LearningVelocityTrackerModule.LearningVelocityTracker || LearningVelocityTrackerModule.default || LearningVelocityTrackerModule;

    system.reflections = new ReflectionsArbiter('ReflectionsArbiter', { 
        messageBroker, 
        graphify: graphify 
    });
    system.finance = new FinanceAgentArbiter({
        messageBroker,
        quadBrain,
        graphify: graphify,
        rootPath: process.cwd()
    });
    system.goalPlanner = new GoalPlannerArbiter({
        name: 'GoalPlanner',
        messageBroker,
        quadBrain,
        maxActiveGoals: Math.max(5, Number(process.env.SOMA_MAX_ACTIVE_GOALS || 20)),
    });
    system.swarmDelegation = new SwarmDelegationArbiter({ name: 'SwarmDelegationArbiter', system });
    system.beliefSystem = new BeliefSystemArbiter({ name: 'BeliefSystem', messageBroker, quadBrain });
    system.distillation = new DistillationArbiter({ messageBroker, quadBrain, beliefSystem: system.beliefSystem });
    system.substrateOptimizer = new SubstrateOptimizerArbiter({ name: 'SubstrateOptimizer' });
    system.adversarialSelfCorrection = new AdversarialSelfCorrectionArbiter({ name: 'AdversarialSelfCorrection', quadBrain });
    system.museEngine = new MuseEngine({ name: 'MuseEngine', messageBroker, quadBrain, reflections: system.reflections });
    system.analytics = new PerformanceAnalytics({ rootPath: process.cwd() });
    system.timekeeper = new TimekeeperArbiter({ name: 'TimekeeperArbiter' });
    system.velocityTracker = new LearningVelocityTracker(messageBroker, { name: 'VelocityTracker' });
    // Gate physics simulation — it feeds UniversalImpulser which wrote 57k files and spiked to 2GB RAM
    if (process.env.SOMA_LOAD_SIMULATION === 'true') {
        system.simulation = new SimulationArbiter({ name: 'Simulation', messageBroker });
    } else {
        console.log('      🎮 Physics Simulation: SKIPPED (set SOMA_LOAD_SIMULATION=true to enable)');
    }

    system.gameTheory = GameTheoryArbiter;
    system.macroEvent = MacroEventArbiter;
    system.cyberSec = CyberSecArbiter;

    // Oculus Browser Arbiter
    system.browserArbiter = new SomaBrowserArbiter(system);

    system.biotech = new BiotechArbiter({ system });

    await initIfPossible(system.timekeeper, 'TimekeeperArbiter');

    await Promise.all([
        initIfPossible(system.goalPlanner, 'GoalPlanner'),
        initIfPossible(system.swarmDelegation, 'SwarmDelegationArbiter'),
        initIfPossible(system.beliefSystem, 'BeliefSystem'),
        initIfPossible(system.distillation, 'DistillationArbiter'),
        initIfPossible(system.museEngine, 'MuseEngine'),
        initIfPossible(system.analytics, 'PerformanceAnalytics'),
        initIfPossible(system.velocityTracker, 'VelocityTracker'),
        initIfPossible(system.gameTheory, 'GameTheoryArbiter'),
        initIfPossible(system.macroEvent, 'MacroEventArbiter'),
        initIfPossible(system.cyberSec, 'CyberSecArbiter'),
        initIfPossible(system.biotech, 'BiotechArbiter'),
        initIfPossible(system.substrateOptimizer, 'SubstrateOptimizerArbiter'),
        initIfPossible(system.adversarialSelfCorrection, 'AdversarialSelfCorrectionArbiter'),
        ...(system.simulation ? [initIfPossible(system.simulation, 'Simulation')] : [])
    ]);

    // Wire goalPlanner into the brain so goal state is available inside every reason() call.
    // cognitive.js creates quadBrain before goalPlanner, so we set it after the fact.
    // reason() reads this.goalPlanner lazily — no restart needed.
    if (system.goalPlanner) {
        quadBrain.goalPlanner = system.goalPlanner;
        console.log('      🔗 GoalPlanner → QuadBrain (goals now feed into every response)');
    }

    // 6. LEGACY ALIASES
    system.mnemonicArbiter = mnemonicArbiter;
    system.messageBroker = messageBroker;
    system.adaptiveRouter = adaptiveRouter;
    system.quadBrain = quadBrain;
    system.causality = causality;
    system.worldModel = worldModel;
    system.knowledgeGraph = knowledgeGraph;
    system.knowledge = knowledgeGraph;

    // 6b. REAL STEVE — SteveArbiter.cjs needs an orchestrator with quadBrain in its population.
    //     The old alias (system.executiveCortex) didn't have processChat/listTools/executeTool.
    try {
        const steveOrchestrator = {
            population: new Map([['quadBrain', quadBrain]]),
            transmitters: null  // hybridSearch wired in extended.js after HybridSearchArbiter loads
        };
        system.steveArbiter = new SteveArbiter(messageBroker, {
            orchestrator: steveOrchestrator,
            learningPipeline: null  // LearningPipeline wired in extended.js
        });
        await system.steveArbiter.initialize();
        console.log('      ✅ SteveArbiter ready (processChat + tools online)');
    } catch (steveErr) {
        console.error('[Cognitive] ⚠️ SteveArbiter failed, falling back to ExecutiveCortex:', steveErr.message);
        system.steveArbiter = system.executiveCortex;
    }

    // 7. EARLY OUTCOME TRACKER — available from boot so chat can record outcomes immediately
    //    Extended loading will later create the full LearningPipeline which supersedes this.
    try {
        const OutcomeTracker = (await import('../../arbiters/OutcomeTracker.js')).default;
        system.outcomeTracker = new OutcomeTracker({
            storageDir: path.join(process.cwd(), 'data', 'outcomes'),
            maxInMemory: 10000,
            enablePersistence: true
        });
        if (typeof system.outcomeTracker.initialize === 'function') {
            await system.outcomeTracker.initialize();
        }
        console.log('[Cognitive] ✅ Early OutcomeTracker ready (chat can record outcomes from boot)');
    } catch (e) {
        console.warn('[Cognitive] ⚠️ Early OutcomeTracker failed:', e.message);
    }

    try {
        system.memorySpineAutoSync = startMemorySpineAutoSync(system, {
            debounceMs: 120000,
            minIntervalMs: 300000,
            rebuildLimit: 'all'
        });
        if (system.memorySpineAutoSync?.success) {
            console.log('[Cognitive] ✅ MemorySpine auto-sync ready (memory → spine → fractal graph)');
        } else {
            console.warn('[Cognitive] ⚠️ MemorySpine auto-sync unavailable:', system.memorySpineAutoSync?.error || 'unknown');
        }
    } catch (e) {
        console.warn('[Cognitive] ⚠️ MemorySpine auto-sync failed:', e.message);
    }

    return system;
}
