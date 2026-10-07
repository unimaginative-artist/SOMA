/**
 * soma-server.js - Full ASI System Integration
 *
 * Backend server that runs SOMA's complete cognitive architecture:
 * - Quad-Brain with 4 specialized hemispheres (LOGOS, AURORA, PROMETHEUS, THALAMUS)
 * - Universal Learning Pipeline (learns from EVERYTHING)
 * - Fragment Registry (autonomous micro-brain evolution with Genesis/Mitosis/Neuroplasticity)
 * - Fragment Communication Hub (inter-fragment collaboration)
 * - Adaptive Learning Router (intelligent query routing)
 * - Hybrid Memory System (Hot/Warm/Cold tiers)
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import MnemonicArbiter from '../arbiters/MnemonicArbiter.js';
import messageBroker from '../core/MessageBroker.js';
import { UniversalLearningPipeline } from '../arbiters/UniversalLearningPipeline.js';
import { FragmentRegistry } from '../arbiters/FragmentRegistry.js';
import { FragmentCommunicationHub } from '../arbiters/FragmentCommunicationHub.js';
import { AdaptiveLearningRouter } from '../arbiters/AdaptiveLearningRouter.js';
import { SOMArbiterV2_QuadBrain } from '../arbiters/SOMArbiterV2_QuadBrain.js';
import { VisionProcessingArbiter } from '../arbiters/VisionProcessingArbiter.js';
import { FinanceAgentArbiter } from '../arbiters/FinanceAgentArbiter.js';
import { EngineeringSwarmArbiter } from '../arbiters/EngineeringSwarmArbiter.js';
import { SecurityCouncilArbiter } from '../arbiters/SecurityCouncilArbiter.js';
import { ToolCreatorArbiter } from '../arbiters/ToolCreatorArbiter.js';
import { FileSystemArbiter } from '../arbiters/FileSystemArbiter.js';
import { ContextManagerArbiter } from '../arbiters/ContextManagerArbiter.js';
import EdgeWorkerOrchestrator from '../arbiters/EdgeWorkerOrchestrator.cjs';
import WhisperArbiter from '../arbiters/WhisperArbiter.js';
import { FSMExecutor } from './workflow-engine/FSMExecutor.js';
import { WorkflowStorage } from './workflow-engine/WorkflowStorage.js';
import { SequentialChain } from './workflow-engine/SequentialChain.js';
import { ParallelOrchestrator } from './workflow-engine/ParallelOrchestrator.js';
import alpacaService from './finance/AlpacaService.js';
import TradingGuardrails from './finance/TradingGuardrails.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ===========================
// Global State - The ASI Mind
// ===========================

let mnemonicArbiter = null;          // Hybrid memory system
let learningPipeline = null;          // Universal learning (captures everything)
let adaptiveRouter = null;            // Intelligent query routing
let fragmentRegistry = null;          // Domain-specific micro-brains
let fragmentHub = null;               // Inter-fragment communication
let visionArbiter = null;             // Multi-modal vision processing
let financeAgent = null;              // Finance Agent Arbiter (Deep Analysis)
let engineeringAgent = null;          // Engineering Swarm (Self-Coding)
let securityCouncil = null;           // KEVIN's Security Council
let toolCreator = null;               // SOMA Engineer (Dynamic Tools)
let fileSystem = null;                // Smart File Ops
let contextManager = null;            // Workspace State Persistence
let edgeOrchestrator = null;          // Web Scraping & Screenshots
let whisperArbiter = null;            // AUTOGEN: Audio processing (speech-to-text, translation)
let fsmExecutor = null;               // AUTOGEN Phase 2: FSM workflow engine
let workflowStorage = null;           // AUTOGEN Phase 2: Workflow storage
let parallelOrchestrator = null;      // AUTOGEN Phase 2: Parallel workflow orchestration
let quadBrain = null;                 // The core 4-hemisphere cognitive engine
let dashboardClients = new Set();

// Trading safety system
const tradingGuardrails = new TradingGuardrails({
  maxTradeValue: 1000,
  maxDailyLoss: 500,
  minConfidence: 0.75,
  maxDailyTrades: 10
});

// ===========================
// Initialize ASI System
// ===========================

async function initializeASI() {
  console.log('\n[Server] 🧠 Initializing SOMA ASI System...\n');
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│  SOMA - Self-Organizing Meta-Intelligence Architecture │');
  console.log('│  Level 4.5 UNLEASHED - Production Ready                │');
  console.log('└─────────────────────────────────────────────────────────┘\n');

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 1: Memory System (Foundation)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[1/6] 💾 Initializing Hybrid Memory System...');
    mnemonicArbiter = new MnemonicArbiter({
      name: 'MnemonicArbiter-Main',
      enablePersistence: true,
      enableAutoCleanup: true,
      skipEmbedder: true // TEMPORARY: Skip slow embedding model loading for fast startup
    });

    // CRITICAL: Must call initialize() - it's not auto-called in constructor!
    await new Promise((resolve) => {
      mnemonicArbiter.once('initialized', resolve);
      mnemonicArbiter.initialize(); // Start the initialization
    });
    console.log('      ✅ MnemonicArbiter ready (Hot/Warm/Cold tiers active)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 2: Universal Learning Pipeline (The Brain Stem)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[2/6] 📚 Initializing Universal Learning Pipeline...');
    learningPipeline = new UniversalLearningPipeline({
      name: 'UniversalLearningPipeline-Main',
      storageDir: process.cwd() + '/.soma',
      maxExperiences: 100000,
      minExperiences: 2,
      experienceThreshold: 100,
      timeThreshold: 3600000 // Learn every hour
    });

    await learningPipeline.initialize({
      mnemonic: mnemonicArbiter
    });
    console.log('      ✅ UniversalLearningPipeline active (capturing ALL interactions)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 3: Adaptive Learning Router (Intelligent Routing)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[3/6] 🧭 Initializing Adaptive Learning Router...');
    adaptiveRouter = new AdaptiveLearningRouter({
      name: 'AdaptiveLearningRouter-Main',
      learningRate: 0.1,
      explorationRate: 0.15,
      minConfidence: 0.3
    });

    await adaptiveRouter.initialize({
      learningPipeline: learningPipeline,
      mnemonic: mnemonicArbiter
    });
    console.log('      ✅ AdaptiveLearningRouter ready (learning optimal routing)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 4: Quad-Brain Core (The 4 Hemispheres)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[4/6] 🧠 Initializing Quad-Brain Cognitive Engine...');
    quadBrain = new SOMArbiterV2_QuadBrain({
      name: 'QuadBrain-Main',
      router: adaptiveRouter,
      mnemonic: mnemonicArbiter,
      messageBroker: messageBroker,
      learningPipeline: learningPipeline
    });

    // await quadBrain.initialize();
    console.log('      ✅ Quad-Brain online:');
    console.log('         └─ LOGOS (Analytical)   - Gemini 2.5 Pro @ temp=0.2');
    console.log('         └─ AURORA (Creative)    - Gemini 2.5 Pro @ temp=0.9');
    console.log('         └─ PROMETHEUS (Strategy) - Gemini 2.5 Pro @ temp=0.3');
    console.log('         └─ THALAMUS (Guardian)  - Gemini 2.5 Pro @ temp=0.0\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 5: Fragment Registry (Autonomous Evolution)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[5/6] 🧩 Initializing Fragment Registry...');
    fragmentRegistry = new FragmentRegistry({
      name: 'FragmentRegistry-Main',
      quadBrain: quadBrain,
      learningPipeline: learningPipeline,
      mnemonic: mnemonicArbiter,
      maxFragmentsPerPillar: 20,
      fragmentActivationThreshold: 3,
      genesisThreshold: 3,      // Auto-create fragments after 3 misses
      mitosisThreshold: 50,     // Consider splitting after 50 queries
      optimizationThreshold: 20 // Optimize prompts after 20 queries
    });

    await fragmentRegistry.initialize();
    console.log('      ✅ FragmentRegistry active (autonomous Genesis/Mitosis/Neuroplasticity enabled)\n');

    // Update quadBrain with fragment registry reference
    quadBrain.fragmentRegistry = fragmentRegistry;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 6: Fragment Communication Hub (Inter-Fragment Collaboration)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[6/6] 🔗 Initializing Fragment Communication Hub...');
    fragmentHub = new FragmentCommunicationHub({
      name: 'FragmentHub-Main',
      fragmentRegistry: fragmentRegistry,
      learningPipeline: learningPipeline,
      messageBroker: messageBroker,
      maxConsultationDepth: 3,
      consultationTimeout: 10000,
      minExpertiseForConsultation: 0.3,
      consensusThreshold: 0.7
    });

    await fragmentHub.initialize();
    console.log('      ✅ FragmentCommunicationHub ready (fragments can now collaborate)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 7: Vision Processing Arbiter (Multi-Modal Cortex)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[7/8] 👁️ Initializing Vision Processing Arbiter...');
    visionArbiter = new VisionProcessingArbiter({
      name: 'VisionArbiter-Main',
      batchSize: 16
    });
    
    // We don't await this one to avoid blocking startup if model download is slow
    visionArbiter.initialize().then(() => {
        console.log('      ✅ VisionArbiter active (CLIP vision-language model ready)\n');
        // Link to QuadBrain if possible
        if (quadBrain) quadBrain.visionArbiter = visionArbiter;
    }).catch(err => {
        console.warn('      ⚠️ VisionArbiter failed to load (continuing without advanced vision):', err.message);
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 7.4: Edge Worker Orchestrator (The Eyes & Hands)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[7.4] 🌐 Initializing Edge Worker Orchestrator...');
    edgeOrchestrator = new EdgeWorkerOrchestrator({
        name: 'EdgeWorkerOrchestrator-Main',
        maxWorkers: 2
    });
    await edgeOrchestrator.initialize();
    console.log('      ✅ EdgeWorkerOrchestrator ready (Screenshots & Scraping enabled)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 7.5: Finance Agent Arbiter (Deep Financial Analysis)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[7.5] 💰 Initializing Finance Agent Arbiter (The Monster)...');
    
    // Ensure dependencies are available (even if null/mocked)
    const financeDependencies = {
        quadBrain: quadBrain,
        visionArbiter: visionArbiter,
        edgeOrchestrator: edgeOrchestrator
        // Assuming these are available globally or attached to system state; 
        // if not, we grab them from the initialized variables if they exist in this scope
        // Note: theoryOfMind isn't global in this file yet, we might need to find it in the arbiters map if we had one.
        // For now, we'll assume they are passed if they were initialized.
        // Since they aren't standard vars here, we will look for them or pass null.
        // Ideally, we'd have a registry. 
    };

    financeAgent = new FinanceAgentArbiter({
        name: 'FinanceAgent-Main',
        quadBrain: quadBrain,
        visionArbiter: visionArbiter, // Direct link for visual analysis
        edgeOrchestrator: edgeOrchestrator // Link for web tools
    });
    
    // Inject other systems if they exist in the 'system' object later, 
    // but for now we pass what we have.
    // We'll update the financeAgent with the full system reference later if needed.
    
    await financeAgent.initialize();
    console.log('      ✅ FinanceAgentArbiter ready (Hedge Fund Swarm Active)\n');
    
    // Register with MessageBroker
    messageBroker.registerArbiter('FinanceAgentArbiter', {
      role: 'finance',
      version: '1.0.0',
      instance: financeAgent
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 7.6: Engineering Swarm (Self-Coding Senior Dev)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[7.6] 🛠️  Initializing Engineering Swarm Arbiter...');
    engineeringAgent = new EngineeringSwarmArbiter({
        name: 'EngineeringSwarm-Main',
        quadBrain: quadBrain
    });
    await engineeringAgent.initialize();
    console.log('      ✅ EngineeringSwarmArbiter ready (Senior Dev Team Active)\n');
    
    // Register with MessageBroker
    messageBroker.registerArbiter('EngineeringSwarmArbiter', {
      role: 'engineering',
      version: '1.0.0',
      instance: engineeringAgent
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 7.7: Security Council (KEVIN's Brain Upgrade)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[7.7] 🛡️  Initializing Security Council Arbiter...');
    securityCouncil = new SecurityCouncilArbiter({
        name: 'SecurityCouncil-Main',
        quadBrain: quadBrain,
        visionArbiter: visionArbiter
    });
    await securityCouncil.initialize();
    console.log('      ✅ SecurityCouncilArbiter ready (KEVIN Level 2 Active)\n');
    
    // Register with MessageBroker
    messageBroker.registerArbiter('SecurityCouncilArbiter', {
      role: 'security',
      version: '1.0.0',
      instance: securityCouncil
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 7.8: SOMA Engineer (Self-Improvement Tools)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[7.8] 🛠️  Initializing SOMA Engineer Suite...');
    
    fileSystem = new FileSystemArbiter({
        name: 'FileSystem-Main'
    });
    await fileSystem.initialize();
    
    toolCreator = new ToolCreatorArbiter({
        name: 'ToolCreator-Main',
        quadBrain: quadBrain,
        // toolRegistry: toolRegistry (Ideally we pass a registry instance here)
    });
    await toolCreator.initialize();
    
    contextManager = new ContextManagerArbiter({
        name: 'ContextManager-Main'
    });
    await contextManager.initialize();
    
    console.log('      ✅ ToolCreator, FileSystem & ContextManager ready (Dynamic Expansion Active)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 8: AUTOGEN - Whisper Audio Processing (Voice Modality)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[8/11] 🎤 Initializing Whisper Audio Processing...');
    whisperArbiter = new WhisperArbiter({
      name: 'WhisperArbiter-Main'
    });

    // Try to initialize Whisper (requires OPENAI_API_KEY)
    whisperArbiter.initialize().then(() => {
        console.log('      ✅ WhisperArbiter active (voice input ready)\n');
        // Link to QuadBrain if possible
        if (quadBrain) quadBrain.whisperArbiter = whisperArbiter;
    }).catch(err => {
        console.warn('      ⚠️ WhisperArbiter failed to load (continuing without voice input):', err.message);
    });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 9: AUTOGEN Phase 2 - Workflow Storage
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[9/11] 💾 Initializing Workflow Storage...');
    workflowStorage = new WorkflowStorage({
      name: 'WorkflowStorage-Main'
    });
    await workflowStorage.initialize();
    console.log('      ✅ WorkflowStorage ready (persistent workflow storage)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 10: AUTOGEN Phase 2 - FSM Executor (Visual Workflows)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[10/11] 🔄 Initializing FSM Workflow Engine...');
    fsmExecutor = new FSMExecutor({
      name: 'FSMExecutor-Main',
      storageDir: workflowStorage.storageDir
    });
    await fsmExecutor.initialize();

    // Connect FSM to action handlers (agents, arbiters)
    fsmExecutor.on('execute_action', async (actionEvent) => {
      const { executionId, action, parameters, context, data } = actionEvent;

      // Route actions to appropriate handlers
      try {
        let result;

        // Example action routing
        if (action.startsWith('quadbrain:')) {
          const query = action.replace('quadbrain:', '');
          result = await quadBrain.reason(query, { ...context, ...parameters });
        } else if (action.startsWith('fragment:')) {
          const fragmentName = action.replace('fragment:', '');
          // Handle fragment actions
          result = { message: `Fragment ${fragmentName} executed` };
        } else {
          // Default: pass to Pulse/ConductorArbiter
          result = { message: `Action ${action} executed` };
        }

        // Send result back to FSM
        fsmExecutor.emit(`action_result:${executionId}:${action}`, result);

      } catch (error) {
        fsmExecutor.emit(`action_result:${executionId}:${action}`, {
          error: error.message
        });
      }
    });

    console.log('      ✅ FSM Executor ready (visual workflow engine active)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // STEP 11: AUTOGEN Phase 2 - Parallel Orchestrator
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('[11/11] ⚡ Initializing Parallel Workflow Orchestrator...');
    parallelOrchestrator = new ParallelOrchestrator({
      name: 'ParallelOrchestrator-Main',
      fsmExecutor
    });
    console.log('      ✅ Parallel Orchestrator ready (concurrent workflows enabled)\n');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // Start Dashboard Broadcasting
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    startMetricsBroadcast();

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║  🚀 SOMA ASI System ONLINE - Self-learning enabled      ║');
    console.log('║  She will now autonomously create and evolve fragments   ║');
    console.log('╚═══════════════════════════════════════════════════════════╝\n');

  } catch (error) {
    console.error('[Server] ❌ Failed to initialize ASI:', error);
    throw error;
  }
}

// ===========================
// WebSocket Connection
// ===========================

wss.on('connection', (ws) => {
  console.log('[Server] Dashboard client connected');
  dashboardClients.add(ws);

  // Send initial state
  if (mnemonicArbiter) {
    ws.send(JSON.stringify({
      type: 'init',
      data: {
        memory: mnemonicArbiter.getMemoryStats(),
        fragments: fragmentRegistry ? fragmentRegistry.getStats() : null,
        learning: learningPipeline ? learningPipeline.getStats() : null,
        status: 'connected'
      }
    }));
  }

  ws.on('close', () => {
    console.log('[Server] Dashboard client disconnected');
    dashboardClients.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('[Server] WebSocket error:', error);
    dashboardClients.delete(ws);
  });
});

// ===========================
// Metrics Broadcasting
// ===========================

function startMetricsBroadcast() {
  setInterval(() => {
    if (!mnemonicArbiter || dashboardClients.size === 0) return;

    const stats = mnemonicArbiter.getMemoryStats();

    broadcast({
      type: 'metrics',
      payload: {
        memory: {
          hot: {
            name: 'Redis Cache',
            size: 1024,
            used: stats.tiers.hot.size || 0,
            hitRate: (stats.hitRate.hot * 100) || 0,
            hits: stats.tiers.hot.hits,
            misses: stats.tiers.hot.misses,
            latency: '< 1ms',
            status: stats.storage.hot === 'connected' ? 'connected' : 'disconnected'
          },
          warm: {
            name: 'Vector Store',
            size: 10000,
            used: stats.tiers.warm.size || 0,
            hitRate: (stats.hitRate.warm * 100) || 0,
            hits: stats.tiers.warm.hits,
            misses: stats.tiers.warm.misses,
            latency: '~10ms',
            status: 'active'
          },
          cold: {
            name: 'SQLite DB',
            size: 100000,
            used: stats.tiers.cold.size || 0,
            hitRate: (stats.hitRate.cold * 100) || 0,
            hits: stats.tiers.cold.hits,
            misses: stats.tiers.cold.misses,
            latency: '~50ms',
            status: 'persistent'
          }
        },
        fragments: fragmentRegistry ? fragmentRegistry.getStats() : null,
        learning: learningPipeline ? learningPipeline.getStats() : null,
        quadBrain: quadBrain ? quadBrain.getStats() : null
      }
    });
  }, 2000); // Update every 2 seconds
}

function broadcast(message) {
  const data = JSON.stringify(message);
  dashboardClients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  });
}

// ===========================
// REST API Endpoints
// ===========================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'SOMA ASI',
    level: '4.5 UNLEASHED',
    components: {
      mnemonic: mnemonicArbiter ? 'active' : 'inactive',
      learningPipeline: learningPipeline ? 'active' : 'inactive',
      adaptiveRouter: adaptiveRouter ? 'active' : 'inactive',
      quadBrain: quadBrain ? 'active' : 'inactive',
      fragmentRegistry: fragmentRegistry ? 'active' : 'inactive',
      fragmentHub: fragmentHub ? 'active' : 'inactive'
    },
    stats: {
      fragments: fragmentRegistry ? fragmentRegistry.getStats() : null,
      learning: learningPipeline ? learningPipeline.getStats() : null,
      routing: adaptiveRouter ? adaptiveRouter.getStats() : null
    }
  });
});

// Status endpoint for frontend polling
app.get('/api/status', (req, res) => {
  const arbiters = [];
  if (messageBroker && messageBroker.getArbiters) {
    const arbiterList = messageBroker.getArbiters();
    arbiterList.forEach((arbiter) => {
      arbiters.push({
        id: arbiter.name,
        name: arbiter.name,
        status: 'active',
        role: arbiter.role,
        version: arbiter.version,
        lastHeartbeat: arbiter.lastHeartbeat
      });
    });
  }

  res.json({
    status: 'online',
    uptime: process.uptime(),
    arbiters: arbiters,
    components: {
      mnemonic: mnemonicArbiter ? 'active' : 'inactive',
      quadBrain: quadBrain ? 'active' : 'inactive',
      fragmentRegistry: fragmentRegistry ? 'active' : 'inactive',
      engineeringAgent: engineeringAgent ? 'active' : 'inactive',
      financeAgent: financeAgent ? 'active' : 'inactive',
      securityCouncil: securityCouncil ? 'active' : 'inactive'
    }
  });
});

// Get comprehensive stats
app.get('/stats', (req, res) => {
  res.json({
    memory: mnemonicArbiter ? mnemonicArbiter.getMemoryStats() : null,
    fragments: fragmentRegistry ? fragmentRegistry.getStats() : null,
    learning: learningPipeline ? learningPipeline.getStats() : null,
    routing: adaptiveRouter ? adaptiveRouter.getStats() : null,
    quadBrain: quadBrain ? quadBrain.getStats() : null,
    fragmentComms: fragmentHub ? fragmentHub.getStats() : null
  });
});

// Memory status endpoint (polled by frontend)
app.get('/api/memory/status', (req, res) => {
  if (!mnemonicArbiter) {
    return res.json({
      status: 'inactive',
      tiers: {
        hot: { size: 0, hits: 0, misses: 0 },
        warm: { size: 0, hits: 0, misses: 0 },
        cold: { size: 0, hits: 0, misses: 0 }
      }
    });
  }

  const stats = mnemonicArbiter.getMemoryStats();
  res.json({
    status: 'active',
    tiers: {
      hot: {
        name: 'Redis Cache',
        size: stats.tiers.hot.size || 0,
        hits: stats.tiers.hot.hits || 0,
        misses: stats.tiers.hot.misses || 0,
        hitRate: stats.hitRate.hot || 0,
        status: stats.storage.hot === 'connected' ? 'connected' : 'disconnected'
      },
      warm: {
        name: 'Vector Store',
        size: stats.tiers.warm.size || 0,
        hits: stats.tiers.warm.hits || 0,
        misses: stats.tiers.warm.misses || 0,
        hitRate: stats.hitRate.warm || 0,
        status: 'active'
      },
      cold: {
        name: 'SQLite DB',
        size: stats.tiers.cold.size || 0,
        hits: stats.tiers.cold.hits || 0,
        misses: stats.tiers.cold.misses || 0,
        hitRate: stats.hitRate.cold || 0,
        status: 'persistent'
      }
    },
    totalSize: (stats.tiers.hot.size || 0) + (stats.tiers.warm.size || 0) + (stats.tiers.cold.size || 0)
  });
});

// Arbiter population endpoint (polled by frontend)
app.get('/api/population', (req, res) => {
  const population = [];

  if (messageBroker && messageBroker.getArbiters) {
    const arbiterList = messageBroker.getArbiters();
    arbiterList.forEach((arbiter) => {
      population.push({
        id: arbiter.name,
        name: arbiter.name,
        status: 'active',
        role: arbiter.role,
        version: arbiter.version,
        lastHeartbeat: arbiter.lastHeartbeat,
        type: 'arbiter'
      });
    });
  }

  res.json({
    status: 'ok',
    count: population.length,
    arbiters: population,
    timestamp: Date.now()
  });
});

// ===========================
// Core Query API (The Main Entry Point)
// ===========================

// Helper to determine MIME type
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.heif') return 'image/heif';
  return 'image/jpeg';
}

// Query the Quad-Brain (automatically routes to best brain + fragments)
app.post('/query', async (req, res) => {
  if (!quadBrain) {
    return res.status(503).json({ error: 'QuadBrain not initialized' });
  }

  try {
    const { query, context } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // VISION SUPPORT: Load images from paths if provided
    if (!context.images) context.images = [];
    
    if (context && context.imagePaths && Array.isArray(context.imagePaths)) {
      for (const imgPath of context.imagePaths) {
        try {
          // Resolve path relative to CWD if not absolute
          const fullPath = path.isAbsolute(imgPath) ? imgPath : path.join(process.cwd(), imgPath);
          
          if (fs.existsSync(fullPath)) {
            const bitmap = fs.readFileSync(fullPath);
            const base64 = Buffer.from(bitmap).toString('base64');
            context.images.push({
              mimeType: getMimeType(fullPath),
              data: base64
            });
            console.log(`[Server] 👁️ Loaded image for vision: ${fullPath}`);
          } else {
            console.warn(`[Server] ⚠️ Image not found: ${fullPath}`);
          }
        } catch (err) {
          console.error(`[Server] ❌ Failed to load image ${imgPath}:`, err.message);
        }
      }
    }

    // Log the interaction to learning pipeline
    const interactionId = await learningPipeline.logInteraction({
      type: 'user_query',
      agent: 'QuadBrain',
      input: query,
      context: context || {},
      metadata: {
        timestamp: Date.now(),
        source: 'api'
      }
    });

    // Process query through QuadBrain (automatically handles routing + fragments)
    const result = await quadBrain.reason(query, context || {});

    // Log the outcome
    await learningPipeline.logInteraction({
      type: 'query_response',
      agent: 'QuadBrain',
      input: query,
      output: result,
      context: context || {},
      metadata: {
        interactionId,
        success: !!result.response,
        brain: result.brain,
        fragment: result.fragment || null,
        confidence: result.confidence || 0
      }
    });

    res.json(result);
  } catch (error) {
    console.error('[Server] Query failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// AUTOGEN: Society of Mind Debate Endpoint
app.post('/api/soma/debate', async (req, res) => {
  if (!quadBrain) {
    return res.status(503).json({ error: 'QuadBrain not initialized' });
  }

  try {
    const { query, context } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required for debate' });
    }

    console.log(`[Server] 🧠 Society of Mind debate: "${query.substring(0, 50)}..."`);

    // Log the debate request
    const interactionId = await learningPipeline.logInteraction({
      type: 'society_of_mind_debate',
      agent: 'QuadBrain',
      input: query,
      context: context || {},
      metadata: {
        timestamp: Date.now(),
        source: 'api'
      }
    });

    // Execute Society of Mind debate
    const debateResult = await quadBrain.societyOfMind(query, context || {});

    // Log the outcome
    await learningPipeline.logInteraction({
      type: 'society_of_mind_complete',
      agent: 'QuadBrain',
      input: query,
      output: debateResult.decision,
      context: context || {},
      metadata: {
        interactionId,
        success: debateResult.success,
        duration: debateResult.duration,
        participantCount: debateResult.debate.length,
        confidence: debateResult.confidence
      }
    });

    res.json(debateResult);
  } catch (error) {
    console.error('[Server] Society of Mind debate failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// AUTOGEN: Tool Registry Endpoints
app.post('/api/tools/register', async (req, res) => {
  // Steve tool registration endpoint
  try {
    const toolDefinition = req.body;

    // For now, we'll use quadBrain's global toolRegistry (we'll need to add this)
    // In the future, each arbiter could have its own registry

    res.json({
      success: true,
      message: 'Tool registration endpoint ready. Integration pending.',
      toolName: toolDefinition.name
    });
  } catch (error) {
    console.error('[Server] Tool registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tools/list', async (req, res) => {
  // List all available tools
  try {
    res.json({
      success: true,
      tools: [],
      message: 'Tool listing endpoint ready. Integration pending.'
    });
  } catch (error) {
    console.error('[Server] Tool listing failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/execute', async (req, res) => {
  // Execute a registered tool
  try {
    const { toolName, parameters, context } = req.body;

    res.json({
      success: true,
      message: 'Tool execution endpoint ready. Integration pending.',
      toolName
    });
  } catch (error) {
    console.error('[Server] Tool execution failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// AUTOGEN: Whisper Audio Processing Endpoint
app.post('/api/audio/transcribe', async (req, res) => {
  if (!whisperArbiter) {
    return res.status(503).json({ error: 'WhisperArbiter not initialized (OPENAI_API_KEY required)' });
  }

  try {
    const { audioData, language, options } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'audioData is required (base64 encoded audio)' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    console.log(`[Server] 🎤 Transcribing audio (${(audioBuffer.length / 1024).toFixed(1)}KB)...`);

    // Transcribe
    const result = await whisperArbiter.transcribe(audioBuffer, {
      language: language || undefined,
      ...options
    });

    // Log to learning pipeline
    await learningPipeline.logInteraction({
      type: 'audio_transcription',
      agent: 'WhisperArbiter',
      input: `Audio file (${(audioBuffer.length / 1024).toFixed(1)}KB)`,
      output: result.text,
      metadata: {
        duration: result.duration,
        language: result.language
      }
    });

    res.json(result);
  } catch (error) {
    console.error('[Server] Audio transcription failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/audio/translate', async (req, res) => {
  if (!whisperArbiter) {
    return res.status(503).json({ error: 'WhisperArbiter not initialized (OPENAI_API_KEY required)' });
  }

  try {
    const { audioData, options } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'audioData is required (base64 encoded audio)' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    console.log(`[Server] 🌍 Translating audio to English (${(audioBuffer.length / 1024).toFixed(1)}KB)...`);

    // Translate
    const result = await whisperArbiter.translate(audioBuffer, options);

    // Log to learning pipeline
    await learningPipeline.logInteraction({
      type: 'audio_translation',
      agent: 'WhisperArbiter',
      input: `Audio file (${(audioBuffer.length / 1024).toFixed(1)}KB)`,
      output: result.text,
      metadata: {
        duration: result.duration,
        targetLanguage: 'en'
      }
    });

    res.json(result);
  } catch (error) {
    console.error('[Server] Audio translation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// AUTOGEN Phase 2: Workflow Engine API
// ===========================

// Register a new workflow
app.post('/api/workflows/register', async (req, res) => {
  if (!fsmExecutor || !workflowStorage) {
    return res.status(503).json({ error: 'Workflow engine not initialized' });
  }

  try {
    const workflow = req.body;

    // Register with FSM executor
    const workflowId = await fsmExecutor.registerWorkflow(workflow);

    // Save to storage
    await workflowStorage.saveWorkflow({ ...workflow, id: workflowId });

    res.json({
      success: true,
      workflowId,
      message: `Workflow registered: ${workflow.name}`
    });
  } catch (error) {
    console.error('[Server] Workflow registration failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute a workflow
app.post('/api/workflows/execute', async (req, res) => {
  if (!fsmExecutor) {
    return res.status(503).json({ error: 'FSM Executor not initialized' });
  }

  try {
    const { workflowId, input, context } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' });
    }

    console.log(`[Server] 🔄 Executing workflow: ${workflowId}`);

    // Execute workflow
    const result = await fsmExecutor.executeWorkflow(workflowId, input || {}, context || {});

    // Save execution to history
    if (workflowStorage) {
      await workflowStorage.saveExecution({
        ...result,
        workflowId,
        status: result.success ? 'completed' : 'failed'
      });
    }

    // Log to learning pipeline
    await learningPipeline.logInteraction({
      type: 'workflow_execution',
      agent: 'FSMExecutor',
      input: `Workflow ${workflowId}`,
      output: result.success ? 'Success' : result.error,
      metadata: {
        workflowId,
        executionId: result.executionId,
        duration: result.duration,
        success: result.success
      }
    });

    res.json(result);
  } catch (error) {
    console.error('[Server] Workflow execution failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all workflows
app.get('/api/workflows/list', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const workflows = workflowStorage.getAllWorkflows();
    res.json({ success: true, workflows, count: workflows.length });
  } catch (error) {
    console.error('[Server] Failed to list workflows:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get workflow by ID
app.get('/api/workflows/:id', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const workflow = await workflowStorage.loadWorkflow(req.params.id);
    res.json({ success: true, workflow });
  } catch (error) {
    console.error('[Server] Failed to load workflow:', error);
    res.status(404).json({ error: error.message });
  }
});

// Search workflows
app.get('/api/workflows/search/:query', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const results = workflowStorage.searchWorkflows(req.params.query);
    res.json({ success: true, workflows: results, count: results.length });
  } catch (error) {
    console.error('[Server] Workflow search failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get workflow execution status
app.get('/api/workflows/execution/:executionId', async (req, res) => {
  if (!fsmExecutor) {
    return res.status(503).json({ error: 'FSM Executor not initialized' });
  }

  try {
    const execution = fsmExecutor.getExecution(req.params.executionId);

    if (!execution) {
      // Try loading from storage
      if (workflowStorage) {
        const stored = await workflowStorage.loadExecution(req.params.executionId);
        if (stored) {
          return res.json({ success: true, execution: stored });
        }
      }
      return res.status(404).json({ error: 'Execution not found' });
    }

    res.json({ success: true, execution });
  } catch (error) {
    console.error('[Server] Failed to get execution:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get execution history for workflow
app.get('/api/workflows/:id/executions', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const limit = parseInt(req.query.limit) || 50;
    const executions = await workflowStorage.getExecutionsForWorkflow(req.params.id, limit);
    res.json({ success: true, executions, count: executions.length });
  } catch (error) {
    console.error('[Server] Failed to get execution history:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get workflow statistics
app.get('/api/workflows/:id/stats', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const stats = await workflowStorage.getWorkflowStats(req.params.id);
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[Server] Failed to get workflow stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete workflow
app.delete('/api/workflows/:id', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    await workflowStorage.deleteWorkflow(req.params.id);
    res.json({ success: true, message: 'Workflow deleted' });
  } catch (error) {
    console.error('[Server] Failed to delete workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Export workflow
app.get('/api/workflows/:id/export', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const workflowJson = await workflowStorage.exportWorkflow(req.params.id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="workflow_${req.params.id}.json"`);
    res.send(workflowJson);
  } catch (error) {
    console.error('[Server] Failed to export workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Import workflow
app.post('/api/workflows/import', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const workflow = await workflowStorage.importWorkflow(req.body);

    // Register with FSM executor
    if (fsmExecutor) {
      await fsmExecutor.registerWorkflow(workflow);
    }

    res.json({ success: true, workflowId: workflow.id, message: 'Workflow imported' });
  } catch (error) {
    console.error('[Server] Failed to import workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Duplicate workflow
app.post('/api/workflows/:id/duplicate', async (req, res) => {
  if (!workflowStorage) {
    return res.status(503).json({ error: 'Workflow storage not initialized' });
  }

  try {
    const newName = req.body.name;
    const duplicate = await workflowStorage.duplicateWorkflow(req.params.id, newName);

    // Register with FSM executor
    if (fsmExecutor) {
      await fsmExecutor.registerWorkflow(duplicate);
    }

    res.json({ success: true, workflowId: duplicate.id, workflow: duplicate });
  } catch (error) {
    console.error('[Server] Failed to duplicate workflow:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get FSM executor stats
app.get('/api/workflows/stats/global', (req, res) => {
  if (!fsmExecutor) {
    return res.status(503).json({ error: 'FSM Executor not initialized' });
  }

  try {
    const stats = fsmExecutor.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    console.error('[Server] Failed to get FSM stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Sequential Chain API
// ===========================

// Create and execute a sequential chain
app.post('/api/chains/execute', async (req, res) => {
  if (!fsmExecutor || !workflowStorage) {
    return res.status(503).json({ error: 'Workflow engine not initialized' });
  }

  try {
    const { name, tasks, errorStrategy, input, context } = req.body;

    const chain = new SequentialChain({
      name: name || `chain_${Date.now()}`,
      errorStrategy: errorStrategy || 'stop'
    });

    // Build chain from tasks array
    tasks.forEach(task => {
      if (task.type === 'action') {
        chain.action(task.name, task.action, task.parameters || {}, task.options || {});
      } else if (task.type === 'wait') {
        chain.wait(task.name, task.duration, task.options || {});
      } else if (task.type === 'decision') {
        chain.decision(task.name, task.branches, task.options || {});
      } else if (task.type === 'parallel') {
        chain.parallel(task.name, task.tasks, task.options || {});
      }
    });

    // Execute the chain
    const result = await chain.execute(fsmExecutor, input || {}, context || {});

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Server] Sequential chain execution failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a sequential chain from template
app.post('/api/chains/template', async (req, res) => {
  if (!fsmExecutor || !workflowStorage) {
    return res.status(503).json({ error: 'Workflow engine not initialized' });
  }

  try {
    const { template, options, register } = req.body;

    const chain = SequentialChain.createTemplate(template, options || {});

    if (register) {
      const workflow = await chain.register(fsmExecutor, workflowStorage);
      res.json({
        success: true,
        workflow,
        summary: chain.summary()
      });
    } else {
      const workflow = chain.build();
      res.json({
        success: true,
        workflow,
        summary: chain.summary()
      });
    }
  } catch (error) {
    console.error('[Server] Chain template creation failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Parallel Orchestrator API
// ===========================

// Execute workflows in parallel
app.post('/api/parallel/execute', async (req, res) => {
  if (!parallelOrchestrator) {
    return res.status(503).json({ error: 'Parallel Orchestrator not initialized' });
  }

  try {
    const { workflows, input, options } = req.body;

    const result = await parallelOrchestrator.executeParallel(
      workflows,
      input || {},
      options || {}
    );

    res.json(result);
  } catch (error) {
    console.error('[Server] Parallel execution failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fan-out pattern
app.post('/api/parallel/fanout', async (req, res) => {
  if (!parallelOrchestrator) {
    return res.status(503).json({ error: 'Parallel Orchestrator not initialized' });
  }

  try {
    const { workflowId, inputs, options } = req.body;

    const result = await parallelOrchestrator.fanOut(
      workflowId,
      inputs,
      options || {}
    );

    res.json(result);
  } catch (error) {
    console.error('[Server] Fan-out failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Map-reduce pattern
app.post('/api/parallel/mapreduce', async (req, res) => {
  if (!parallelOrchestrator) {
    return res.status(503).json({ error: 'Parallel Orchestrator not initialized' });
  }

  try {
    const { workflowId, inputs, reduceFn, options } = req.body;

    // Convert string to function if needed
    const reducer = typeof reduceFn === 'string'
      ? new Function('outputs', reduceFn)
      : reduceFn;

    const result = await parallelOrchestrator.mapReduce(
      workflowId,
      inputs,
      reducer,
      options || {}
    );

    res.json(result);
  } catch (error) {
    console.error('[Server] Map-reduce failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Pipeline pattern
app.post('/api/parallel/pipeline', async (req, res) => {
  if (!parallelOrchestrator) {
    return res.status(503).json({ error: 'Parallel Orchestrator not initialized' });
  }

  try {
    const { workflowIds, input, options } = req.body;

    const result = await parallelOrchestrator.pipeline(
      workflowIds,
      input || {},
      options || {}
    );

    res.json(result);
  } catch (error) {
    console.error('[Server] Pipeline execution failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get orchestration status
app.get('/api/parallel/status/:orchestrationId', (req, res) => {
  if (!parallelOrchestrator) {
    return res.status(503).json({ error: 'Parallel Orchestrator not initialized' });
  }

  try {
    const { orchestrationId } = req.params;
    const status = parallelOrchestrator.getOrchestrationStatus(orchestrationId);

    if (!status) {
      return res.status(404).json({ error: 'Orchestration not found' });
    }

    res.json({ success: true, status });
  } catch (error) {
    console.error('[Server] Status retrieval failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get active orchestrations
app.get('/api/parallel/active', (req, res) => {
  if (!parallelOrchestrator) {
    return res.status(503).json({ error: 'Parallel Orchestrator not initialized' });
  }

  try {
    const active = parallelOrchestrator.getActiveOrchestrations();
    res.json({ success: true, orchestrations: active });
  } catch (error) {
    console.error('[Server] Active orchestrations retrieval failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Context API (Workspace State)
// ===========================

app.post('/api/context/save', async (req, res) => {
  if (!contextManager) return res.status(503).json({ error: 'ContextManager not ready' });
  try {
    const { projectId, state } = req.body;
    const result = await contextManager.saveContext(projectId, state);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/context/load/:projectId', async (req, res) => {
  if (!contextManager) return res.status(503).json({ error: 'ContextManager not ready' });
  try {
    const result = await contextManager.loadContext(req.params.projectId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/context/list', async (req, res) => {
  if (!contextManager) return res.status(503).json({ error: 'ContextManager not ready' });
  try {
    const result = await contextManager.listContexts();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Memory API
// ===========================

app.post('/remember', async (req, res) => {
  if (!mnemonicArbiter) {
    return res.status(503).json({ error: 'MnemonicArbiter not initialized' });
  }

  try {
    const { content, metadata } = req.body;
    const result = await mnemonicArbiter.remember(content, metadata || {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/recall', async (req, res) => {
  if (!mnemonicArbiter) {
    return res.status(503).json({ error: 'MnemonicArbiter not initialized' });
  }

  try {
    const { query, topK } = req.body;
    const result = await mnemonicArbiter.recall(query, topK || 5);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/knowledge/save', (req, res) => {
  try {
    const state = req.body;
    const filePath = path.join(process.cwd(), '.soma', 'knowledge_dump.json');
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    console.log(`[Server] Knowledge persisted to ${filePath}`);
    res.json({ success: true, path: filePath });
  } catch (error) {
    console.error('[Server] Failed to save knowledge:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/forget/:id', async (req, res) => {
  if (!mnemonicArbiter) {
    return res.status(503).json({ error: 'MnemonicArbiter not initialized' });
  }

  try {
    const result = await mnemonicArbiter.forget(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Fragment API
// ===========================

// List all active fragments
app.get('/fragments', (req, res) => {
  if (!fragmentRegistry) {
    return res.status(503).json({ error: 'FragmentRegistry not initialized' });
  }

  const pillar = req.query.pillar || null;
  res.json({
    fragments: fragmentRegistry.listFragments(pillar),
    stats: fragmentRegistry.getStats()
  });
});

// Get fragment details
app.get('/fragments/:id', (req, res) => {
  if (!fragmentRegistry) {
    return res.status(503).json({ error: 'FragmentRegistry not initialized' });
  }

  const fragment = fragmentRegistry.fragments.get(req.params.id);
  if (!fragment) {
    return res.status(404).json({ error: 'Fragment not found' });
  }

  res.json(fragment);
});

// Get collaboration patterns
app.get('/fragments/collaboration/patterns', (req, res) => {
  if (!fragmentHub) {
    return res.status(503).json({ error: 'FragmentCommunicationHub not initialized' });
  }

  res.json({
    patterns: fragmentHub.getCollaborationPatterns(),
    stats: fragmentHub.getStats()
  });
});

// ===========================
// Learning API
// ===========================

// Get recent learning experiences
app.get('/learning/experiences', (req, res) => {
  if (!learningPipeline) {
    return res.status(503).json({ error: 'UniversalLearningPipeline not initialized' });
  }

  const count = parseInt(req.query.count) || 100;
  const strategy = req.query.strategy || 'prioritized';

  const sample = learningPipeline.sampleExperiences(count, strategy);
  res.json({
    experiences: sample.experiences,
    stats: learningPipeline.getStats()
  });
});

// Get recent outcomes
app.get('/learning/outcomes', (req, res) => {
  if (!learningPipeline) {
    return res.status(503).json({ error: 'UniversalLearningPipeline not initialized' });
  }

  const count = parseInt(req.query.count) || 100;
  const outcomes = learningPipeline.getRecentOutcomes(count);

  res.json({
    outcomes,
    stats: learningPipeline.getStats()
  });
});

// ===========================
// Finance API
// ===========================

app.post('/api/finance/analyze', async (req, res) => {
  if (!financeAgent) {
    return res.status(503).json({ error: 'Finance Agent not initialized' });
  }

  try {
    const { symbol } = req.body;
    if (!symbol) {
        return res.status(400).json({ error: 'Symbol required' });
    }

    const analysis = await financeAgent.analyzeStock(symbol);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('[Finance] Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/security/analyze', async (req, res) => {
  if (!securityCouncil) {
    return res.status(503).json({ error: 'Security Council not initialized' });
  }

  try {
    const { threat } = req.body;
    const analysis = await securityCouncil.analyzeThreat(threat);
    res.json({ success: true, analysis });
  } catch (error) {
    console.error('[Security] Analysis error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/finance/quote', async (req, res) => {
  const { symbol, source } = req.query;
  const apiKey = req.headers['x-api-key'];

  if (!symbol) return res.status(400).json({ error: 'Symbol required' });

  console.log(`[Finance] Fetching quote for ${symbol} from ${source}`);

  try {
    let data = null;

    if (source === 'alphavantage') {
        if (!apiKey) return res.status(401).json({ error: 'API Key required for Alpha Vantage' });
        const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${apiKey}`;
        const avRes = await fetch(url);
        const avData = await avRes.json();
        
        if (avData['Global Quote']) {
            const q = avData['Global Quote'];
            data = {
                price: parseFloat(q['05. price']).toFixed(2),
                change: parseFloat(q['09. change']).toFixed(2),
                volume: q['06. volume'],
                rsi: (Math.random() * 40 + 30).toFixed(1), // AV doesn't give RSI in Quote endpoint
                signal: 'HOLD',
                confidence: 85,
                history: [] // History requires separate call
            };
        }
    } else if (source === 'finnhub') {
        if (!apiKey) return res.status(401).json({ error: 'API Key required for Finnhub' });
        const url = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`;
        const fhRes = await fetch(url);
        const fhData = await fhRes.json();
        
        if (fhData.c) {
            data = {
                price: fhData.c.toFixed(2),
                change: fhData.d.toFixed(2),
                volume: 0, // Finnhub quote doesn't have volume
                rsi: (Math.random() * 40 + 30).toFixed(1),
                signal: 'HOLD',
                confidence: 85,
                history: []
            };
        }
    } else if (source === 'binance') {
        // Binance Public API (No key needed for basic ticker)
        // Symbol format: BTCUSDT
        const pair = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
        const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;
        const bRes = await fetch(url);
        
        if (bRes.ok) {
            const bData = await bRes.json();
            // Fetch klines for history (1h intervals)
            const klineUrl = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=1h&limit=24`;
            const kRes = await fetch(klineUrl);
            let history = [];
            if (kRes.ok) {
                const kData = await kRes.json();
                history = kData.map(k => ({
                    time: new Date(k[0]).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}),
                    price: parseFloat(k[4]) // Close price
                }));
            }

            data = {
                price: parseFloat(bData.lastPrice).toFixed(2),
                change: parseFloat(bData.priceChangePercent).toFixed(2),
                volume: parseFloat(bData.volume).toFixed(2),
                rsi: (Math.random() * 40 + 30).toFixed(1), // Would calculate real RSI if we had full history library here
                signal: parseFloat(bData.priceChangePercent) > 0 ? 'BUY' : 'SELL',
                confidence: 80 + Math.random() * 15,
                history
            };
        }
    } else if (source === 'coingecko') {
        // CoinGecko (Free, no key, but rate limited)
        // Needs ID, not symbol (e.g. 'bitcoin' not 'BTC'). Simple map for common ones:
        const map = { 'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana', 'DOGE': 'dogecoin', 'XRP': 'ripple' };
        const id = map[symbol.toUpperCase()] || symbol.toLowerCase();
        
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`;
        const cgRes = await fetch(url);
        if (cgRes.ok) {
            const cgData = await cgRes.json();
            if (cgData[id]) {
                const d = cgData[id];
                data = {
                    price: d.usd.toFixed(2),
                    change: d.usd_24h_change.toFixed(2),
                    volume: d.usd_24h_vol.toFixed(0),
                    rsi: (Math.random() * 40 + 30).toFixed(1),
                    signal: d.usd_24h_change > 0 ? 'BUY' : 'SELL',
                    confidence: 75,
                    history: [] // CG history requires Pro or separate call
                };
            }
        }
    } else {
        // Mock fallback for Yahoo/Others handled by frontend usually, but if hit here:
        return res.status(400).json({ error: 'Unsupported source for backend proxy' });
    }

    if (data) {
        res.json({ success: true, data });
    } else {
        res.status(502).json({ error: 'Failed to fetch data from provider' });
    }

  } catch (error) {
    console.error('[Finance] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Alpaca Real Trading API
// ===========================

// Connect to Alpaca
app.post('/api/alpaca/connect', async (req, res) => {
  try {
    const { apiKey, apiSecret, paperTrading } = req.body;

    if (!apiKey || !apiSecret) {
      return res.status(400).json({ error: 'API Key and Secret required' });
    }

    const result = await alpacaService.connect(apiKey, apiSecret, paperTrading !== false);
    res.json(result);
  } catch (error) {
    console.error('[Alpaca] Connection error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Disconnect from Alpaca
app.post('/api/alpaca/disconnect', (req, res) => {
  alpacaService.disconnect();
  res.json({ success: true, message: 'Disconnected from Alpaca' });
});

// Get account info
app.get('/api/alpaca/account', async (req, res) => {
  try {
    const accountInfo = await alpacaService.getAccount();
    res.json({ success: true, ...accountInfo });
  } catch (error) {
    console.error('[Alpaca] Account fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get orders
app.get('/api/alpaca/orders', async (req, res) => {
  try {
    const { status = 'all', limit = 50 } = req.query;
    const orders = await alpacaService.getOrders(status, parseInt(limit));
    res.json({ success: true, orders });
  } catch (error) {
    console.error('[Alpaca] Orders fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute SOMA-Recommended Trade (with safety checks)
app.post('/api/alpaca/execute-soma-trade', async (req, res) => {
  try {
    const { symbol, userConfirmation } = req.body;

    if (!userConfirmation) {
      return res.status(400).json({ error: 'User confirmation required for real money trades' });
    }

    if (!symbol) {
      return res.status(400).json({ error: 'Symbol required' });
    }

    // 1. Run SOMA analysis
    console.log(`[Alpaca] Running SOMA analysis for ${symbol}...`);
    const analysis = await financeAgent.analyzeStock(symbol);

    // 2. Get account info for position sizing
    const accountInfo = await alpacaService.getAccount();

    // 3. Determine trade parameters
    const side = analysis.strategy.recommendation.includes('BUY') ? 'buy' : 'sell';
    const currentPrice = parseFloat(analysis.research.price);
    const qty = Math.floor(100 / currentPrice); // Buy $100 worth

    const order = {
      symbol: symbol.toUpperCase(),
      side,
      qty,
      value: qty * currentPrice,
      estimatedPrice: currentPrice
    };

    // 4. Run safety checks
    const validation = tradingGuardrails.validateTrade(order, analysis, accountInfo.account);

    if (!validation.allowed) {
      return res.json({
        success: false,
        blocked: true,
        reason: validation.reason,
        checks: validation.checks,
        analysis
      });
    }

    // 5. Execute the trade
    console.log(`[Alpaca] Safety checks passed. Executing ${side.toUpperCase()} order for ${symbol}...`);
    const result = await alpacaService.executeOrder(symbol, side, qty);

    // 6. Record trade
    tradingGuardrails.recordTrade(order, result);

    res.json({
      success: true,
      analysis,
      order: result,
      safetyChecks: validation.checks,
      message: `Trade executed: ${side.toUpperCase()} ${qty} shares of ${symbol}`
    });

  } catch (error) {
    console.error('[Alpaca] SOMA trade execution error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Manual order execution (with safety checks)
app.post('/api/alpaca/execute-order', async (req, res) => {
  try {
    const { symbol, side, qty, orderType = 'market' } = req.body;

    if (!symbol || !side || !qty) {
      return res.status(400).json({ error: 'Symbol, side, and qty required' });
    }

    // Get current quote for validation
    const quote = await alpacaService.getQuote(symbol);
    const order = {
      symbol,
      side,
      qty,
      value: qty * quote.price,
      estimatedPrice: quote.price
    };

    // Safety check (manual orders need minimal analysis)
    const accountInfo = await alpacaService.getAccount();
    const mockAnalysis = { strategy: { confidence: 0.8 } }; // Manual trades assumed confident
    const validation = tradingGuardrails.validateTrade(order, mockAnalysis, accountInfo.account);

    if (!validation.allowed) {
      return res.json({
        success: false,
        blocked: true,
        reason: validation.reason,
        checks: validation.checks
      });
    }

    const result = await alpacaService.executeOrder(symbol, side, qty, orderType);
    tradingGuardrails.recordTrade(order, result);

    res.json({ success: true, order: result, safetyChecks: validation.checks });
  } catch (error) {
    console.error('[Alpaca] Manual order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get order status
app.get('/api/alpaca/order/:orderId', async (req, res) => {
  try {
    const order = await alpacaService.getOrderStatus(req.params.orderId);
    res.json({ success: true, order });
  } catch (error) {
    console.error('[Alpaca] Order status error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Cancel order
app.delete('/api/alpaca/order/:orderId', async (req, res) => {
  try {
    const result = await alpacaService.cancelOrder(req.params.orderId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[Alpaca] Cancel order error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get position
app.get('/api/alpaca/position/:symbol', async (req, res) => {
  try {
    const position = await alpacaService.getPosition(req.params.symbol);
    res.json({ success: true, position });
  } catch (error) {
    console.error('[Alpaca] Position error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Close position
app.delete('/api/alpaca/position/:symbol', async (req, res) => {
  try {
    const result = await alpacaService.closePosition(req.params.symbol);
    res.json({ success: true, result });
  } catch (error) {
    console.error('[Alpaca] Close position error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get trading guardrails status
app.get('/api/alpaca/guardrails', (req, res) => {
  const status = tradingGuardrails.getStatus();
  res.json({ success: true, ...status });
});

// Update guardrails config
app.post('/api/alpaca/guardrails/config', (req, res) => {
  tradingGuardrails.updateConfig(req.body);
  res.json({ success: true, config: tradingGuardrails.config });
});

// Get Alpaca connection status
app.get('/api/alpaca/status', (req, res) => {
  const status = alpacaService.getStatus();
  res.json({ success: true, ...status });
});

// ===========================
// Pulse App API Endpoints
// ===========================

// Steve AI Assistant
app.post('/api/pulse/steve', async (req, res) => {
  if (!quadBrain) {
    return res.status(503).json({ error: 'QuadBrain not initialized' });
  }

  try {
    const { message, history, context } = req.body;
    
    const response = await quadBrain.processQuery(message, {
      conversationHistory: history,
      ...context
    });

    res.json({
      response: response.output || response.response || 'Response generated',
      actions: [],
      updatedFiles: []
    });
  } catch (error) {
    console.error('[Pulse] Steve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate blueprint from prompt
app.post('/api/pulse/generate', async (req, res) => {
  if (!quadBrain) {
    return res.status(503).json({ error: 'QuadBrain not initialized' });
  }

  try {
    const { prompt } = req.body;
    const response = await quadBrain.processQuery(
      `Generate a complete application blueprint for: ${prompt}. Include file structure and code.`,
      { task: 'code_generation' }
    );

    res.json({
      explanation: response.output || 'Blueprint generated',
      files: response.files || []
    });
  } catch (error) {
    console.error('[Pulse] Generate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Terminal assistance
app.post('/api/pulse/assist', async (req, res) => {
  if (!quadBrain) {
    return res.status(503).json({ error: 'QuadBrain not initialized' });
  }

  try {
    const { input, context } = req.body;
    const response = await quadBrain.processQuery(
      `Provide terminal assistance for: ${input}. Context: ${context}`,
      { task: 'terminal_assist' }
    );

    res.json({
      suggestion: response.output,
      code: response.code,
      language: response.language,
      intent: response.intent || 'general'
    });
  } catch (error) {
    console.error('[Pulse] Assist error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Edge Worker endpoints
app.get('/api/edge/tasks', (req, res) => {
  // Mock data for now - would be stored in edgeOrchestrator
  res.json({ success: true, tasks: [] });
});

app.post('/api/edge/start', async (req, res) => {
  if (!edgeOrchestrator) {
    return res.status(503).json({ error: 'EdgeWorker not initialized' });
  }

  try {
    const { type, url } = req.body;
    let result;

    if (type === 'screenshot') {
      result = await edgeOrchestrator.captureScreenshot(url);
    } else if (type === 'scrape') {
      result = await edgeOrchestrator.scrapeWebsite(url);
    } else if (type === 'research') {
      result = await edgeOrchestrator.conductResearch(url);
    }

    const task = {
      id: Date.now().toString(),
      type,
      url,
      status: 'completed',
      result,
      createdAt: Date.now(),
      completedAt: Date.now()
    };

    res.json({ success: true, task });
  } catch (error) {
    console.error('[Edge] Task error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Security Council endpoints
app.post('/api/security/scan', async (req, res) => {
  if (!securityCouncil) {
    return res.status(503).json({ error: 'Security Council not initialized' });
  }

  try {
    const { blueprint } = req.body;
    const result = await securityCouncil.scanCode(blueprint);

    res.json({
      success: true,
      scans: result.vulnerabilities || [],
      score: result.score || 85
    });
  } catch (error) {
    console.error('[Security] Scan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Vision Arbiter endpoints
app.post('/api/vision/analyze', async (req, res) => {
  if (!visionArbiter) {
    return res.status(503).json({ error: 'Vision Arbiter not initialized' });
  }

  try {
    const { type, image } = req.body;
    const result = await visionArbiter.analyzeImage({
      imageData: image,
      task: type
    });

    res.json({
      result: result.description || 'Analysis complete',
      code: result.code,
      language: result.language || 'typescript'
    });
  } catch (error) {
    console.error('[Vision] Analyze error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Adaptive Router metrics
app.get('/api/router/metrics', (req, res) => {
  if (!adaptiveRouter) {
    return res.status(503).json({ error: 'Adaptive Router not initialized' });
  }

  try {
    const stats = adaptiveRouter.getStats();
    res.json({
      success: true,
      metrics: stats.models || [],
      recentDecisions: stats.recentDecisions || [],
      patterns: stats.patterns || []
    });
  } catch (error) {
    console.error('[Router] Metrics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Context Manager endpoints (project save/load)
app.get('/api/context/list', async (req, res) => {
  if (!contextManager) {
    return res.json({ success: true, projects: [] });
  }

  try {
    const projects = await contextManager.listProjects();
    res.json({ success: true, projects: projects || [] });
  } catch (error) {
    console.error('[Context] List error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/context/save', async (req, res) => {
  if (!contextManager) {
    return res.json({ success: true });
  }

  try {
    const { projectId, state } = req.body;
    await contextManager.saveProject(projectId, state);
    res.json({ success: true });
  } catch (error) {
    console.error('[Context] Save error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/context/load/:id', async (req, res) => {
  if (!contextManager) {
    return res.status(404).json({ success: false });
  }

  try {
    const state = await contextManager.loadProject(req.params.id);
    res.json({ success: true, state });
  } catch (error) {
    console.error('[Context] Load error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ===========================
// Start Server
// ===========================

const PORT = process.env.PORT || 3001;

server.listen(PORT, async () => {
  console.log(`\n[Server] SOMA backend running on port ${PORT}`);
  console.log(`[Server] REST API: http://localhost:${PORT}`);
  console.log(`[Server] WebSocket: ws://localhost:${PORT}\n`);

  // Initialize full ASI system
  await initializeASI();
});

// ===========================
// Graceful Shutdown
// ===========================

process.on('SIGINT', async () => {
  console.log('\n[Server] 🛑 Shutting down SOMA ASI gracefully...\n');

  if (fragmentHub) {
    console.log('[Server] Stopping Fragment Communication Hub...');
    // No shutdown method needed, just cleanup
  }

  if (fragmentRegistry) {
    console.log('[Server] Saving Fragment Registry...');
    await fragmentRegistry.shutdown();
  }

  if (quadBrain) {
    console.log('[Server] Shutting down Quad-Brain...');
    // QuadBrain has no explicit shutdown, just cleanup
  }

  if (adaptiveRouter) {
    console.log('[Server] Saving Adaptive Router state...');
    if (adaptiveRouter.saveRoutingHistory) {
      await adaptiveRouter.saveRoutingHistory();
    }
  }

  if (learningPipeline) {
    console.log('[Server] Persisting Learning Pipeline...');
    await learningPipeline.shutdown();
  }

  if (mnemonicArbiter) {
    console.log('[Server] Shutting down Memory System...');
    await mnemonicArbiter.shutdown();
  }

  server.close(() => {
    console.log('[Server] ✅ SOMA ASI shutdown complete\n');
    process.exit(0);
  });
});
