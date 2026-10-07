/**
 * start-nighttime-learning-service.mjs
 *
 * Starts SOMA's nighttime learning orchestrator as a background service
 * Runs scheduled learning sessions from 10 PM to 4:30 AM
 *
 * Usage: node scripts/start-nighttime-learning-service.mjs
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';
import NighttimeLearningOrchestrator from '../core/NighttimeLearningOrchestrator.js';
import MnemonicArbiter from '../arbiters/MnemonicArbiter.js';
import UniversalLearningPipeline from '../arbiters/UniversalLearningPipeline.js';
import { createRequire } from 'module';

// Import CommonJS arbiters (default exports)
const require = createRequire(import.meta.url);
const EdgeWorkerOrchestrator = require('../arbiters/EdgeWorkerOrchestrator.cjs');
const UniversalImpulser = require('../arbiters/UniversalImpulser.cjs');
const DeploymentArbiter = require('../arbiters/DeploymentArbiter.cjs');
const StorageArbiter = require('../arbiters/StorageArbiter.cjs');
const ArchivistArbiter = require('../arbiters/ArchivistArbiter.cjs');

// Import ES6 arbiters
import GPUTrainingArbiter from '../arbiters/GPUTrainingArbiter.js';

// Load environment variables
config({ path: path.join(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auto-detect role based on hostname (for shared iCloud Drive setup)
const hostname = os.hostname();
const role = hostname.toLowerCase().includes('imac') ? 'coordinator' : 'worker';

console.log('═'.repeat(80));
console.log('  🌙 SOMA NIGHTTIME LEARNING SERVICE');
console.log(`  Machine: ${hostname} (${role})`);
console.log('  Starting automated learning orchestrator...');
console.log('═'.repeat(80));
console.log();

// Create logs directory
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true});
}

// Set up logging
const logFile = path.join(logsDir, 'nighttime-learning.log');
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  try {
    console.log(logMessage);
  } catch (e) {
    // Ignore console errors (broken pipe, etc)
  }
  try {
    if (logStream && !logStream.destroyed) {
      logStream.write(logMessage + '\n');
    }
  } catch (e) {
    // Ignore stream errors
  }
}

log('═'.repeat(80));
log('Starting SOMA Nighttime Learning Service');
log(`Machine: ${hostname} | Role: ${role.toUpperCase()}`);
if (role === 'worker') {
  const coordinatorAddr = process.env.SOMA_COORDINATOR || 'auto-discover';
  log(`Coordinator: ${coordinatorAddr}`);
}
log('═'.repeat(80));

// Initialize MnemonicArbiter (Memory System)
log('Initializing MnemonicArbiter (Memory System)...');
const somaRoot = path.join(__dirname, '..');
const mnemonicArbiter = new MnemonicArbiter({
  name: 'MnemonicArbiter-Nighttime',
  dbPath: path.join(somaRoot, '.soma', 'soma-memory.db'),
  vectorDbPath: path.join(somaRoot, '.soma', 'soma-vectors.json'),
  enablePersistence: true
});

// Initialize TriBrain (AI Reasoning)
log('Initializing SOMA Brain (SOMArbiterV3)...');
let tribrain = null;
try {
  const { SOMArbiterV3 } = await import('../arbiters/SOMArbiterV3.js');
  tribrain = new SOMArbiterV3({
    name: 'TriBrain-NighttimeLearning',
    prometheusModel: process.env.OLLAMA_MODEL || 'gemma3:4b',
    ollamaEndpoint: (process.env.OLLAMA_ENDPOINT || 'http://localhost:11434') + '/api/generate',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY
  });
  await tribrain.initialize();
  log('✅ SOMArbiterV3 ready (QuadBrain + ASI)');
} catch (err) {
  log(`⚠️  Brain initialization failed: ${err.message}`);
  log('  Learning will continue without AI reasoning');
}

// Initialize Universal Learning Pipeline (THE BRAIN STEM!)
log('Initializing Universal Learning Pipeline...');
const learningPipeline = new UniversalLearningPipeline({
  name: 'LearningPipeline-Nighttime',
  maxExperiences: 100000,
  storageDir: path.join(somaRoot, '.soma', 'outcomes'),
  experienceThreshold: 100, // Trigger learning after 100 experiences
  timeThreshold: 3600000 // Or every hour
});

// Initialize EdgeWorkerOrchestrator (Web Crawling & Data Gathering)
log('Initializing EdgeWorkerOrchestrator (Data Gathering Dendrites)...');
let edgeWorker = null;
try {
  edgeWorker = new EdgeWorkerOrchestrator({
    name: 'EdgeWorker-Nighttime',
    maxWorkers: 4,
    braveApiKey: process.env.BRAVE_API_KEY,
    brain: tribrain  // Wire up TriBrain for content analysis
  });
  await edgeWorker.initialize();
  log('✅ EdgeWorkerOrchestrator ready - web crawlers active (TriBrain-powered)');
} catch (err) {
  log(`⚠️  EdgeWorkerOrchestrator initialization failed: ${err.message}`);
  log('  Data gathering will be limited');
}

// Initialize UniversalImpulser (Data Processing)
log('Initializing UniversalImpulser (Data Processing Engine)...');
let impulser = null;
try {
  impulser = new UniversalImpulser({
    name: 'Impulser-Nighttime',
    brain: tribrain  // Wire up TriBrain for intelligent categorization, summarization, quality assessment
  });
  await impulser.initialize();
  log('✅ UniversalImpulser ready - data processing active (TriBrain-powered)');
} catch (err) {
  log(`⚠️  UniversalImpulser initialization failed: ${err.message}`);
}

// Initialize StorageArbiter (Storage Backend)
log('Initializing StorageArbiter (Storage Backend)...');
let storage = null;
try {
  storage = new StorageArbiter({
    name: 'Storage-Nighttime',
    backend: 'local',
    storageDir: path.join(somaRoot, '.soma', 'storage')
  });
  await storage.initialize();
  log('✅ StorageArbiter ready - persistent storage active');
} catch (err) {
  log(`⚠️  StorageArbiter initialization failed: ${err.message}`);
}

// Initialize DeploymentArbiter (Autonomous Code Deployment)
log('Initializing DeploymentArbiter (Autonomous Code Deployment)...');
let deployment = null;
try {
  deployment = new DeploymentArbiter({
    name: 'Deployment-Nighttime',
    testBeforeDeploy: true,
    rollbackOnFailure: true,
    brain: tribrain  // Wire up TriBrain for code analysis and safety decision-making
  });
  await deployment.initialize();
  log('✅ DeploymentArbiter ready - autonomous deployment enabled (TriBrain-powered)');
} catch (err) {
  log(`⚠️  DeploymentArbiter initialization failed: ${err.message}`);
  log('  Self-modification will be limited');
}

// Initialize ArchivistArbiter (Memory Compression)
log('Initializing ArchivistArbiter (Memory Compression)...');
let archivist = null;
try {
  archivist = new ArchivistArbiter({
    name: 'Archivist-Nighttime',
    archiveDir: path.join(somaRoot, '.soma', 'archives'),
    brain: tribrain  // Wire up TriBrain for intelligent memory compression and summarization
  });
  await archivist.initialize();
  log('✅ ArchivistArbiter ready - memory optimization active (TriBrain-powered)');
} catch (err) {
  log(`⚠️  ArchivistArbiter initialization failed: ${err.message}`);
}

// Initialize GPUTrainingArbiter (GPU Acceleration)
log('Initializing GPUTrainingArbiter (GPU Training)...');
let gpuTraining = null;
try {
  gpuTraining = new GPUTrainingArbiter({
    name: 'GPUTraining-Nighttime',
    device: 'auto' // Will auto-detect GPU
  });
  await gpuTraining.initialize();
  log('✅ GPUTrainingArbiter ready - GPU acceleration enabled');
} catch (err) {
  log(`⚠️  GPUTrainingArbiter initialization failed: ${err.message}`);
  log('  Training will use CPU only');
}

// Initialize the orchestrator with correct config path
const orchestrator = new NighttimeLearningOrchestrator({
  name: 'NighttimeLearningService',
  configPath: path.join(__dirname, '../config/nighttime-learning.json'),
  autoStart: true
});

// Initialize
(async () => {
  try {
    // Wait for MnemonicArbiter to initialize
    await new Promise((resolve) => {
      if (mnemonicArbiter.initialized) {
        resolve();
      } else {
        mnemonicArbiter.once('initialized', resolve);
      }
    });
    log('✅ MnemonicArbiter ready');

    // Initialize Learning Pipeline with all arbiters
    log('Connecting Learning Pipeline to all systems...');
    await learningPipeline.initialize({
      mnemonic: mnemonicArbiter,
      tribrain: tribrain,
      planner: null // Will be set by orchestrator
    });
    log('✅ Universal Learning Pipeline ready - ALL interactions will be learned from!');

    log('Initializing Nighttime Learning Orchestrator...');
    await orchestrator.initialize({
      mnemonic: mnemonicArbiter,
      tribrain: tribrain,
      learningPipeline: learningPipeline,
      edgeWorker: edgeWorker,
      impulser: impulser,
      storage: storage,
      deployment: deployment,
      archivist: archivist,
      gpuTraining: gpuTraining
    });

    log('✅ Nighttime Learning Service STARTED');
    log('');
    log('Schedule:');
    log('  🌙 22:00 (10 PM)  - Knowledge Consolidation');
    log('  🌙 23:00 (11 PM)  - Deep Learning Session');
    log('  🌙 00:00 (Midnight) - Autonomous Data Gathering & Web Crawling');
    log('  🌙 01:00 (1 AM)   - Memory Optimization');
    log('  🌙 02:00 (2 AM)   - Pattern Analysis');
    log('  🌙 03:00 (3 AM)   - Self-Improvement Proposals');
    log('  🌙 04:00 (4 AM)   - Final Consolidation');
    log('');
    log('Service is now running. Learning sessions will trigger automatically.');
    log('Press Ctrl+C to stop the service.');
    log('');

    // Check current time and show next session
    const now = new Date();
    const currentHour = now.getHours();

    if (currentHour >= 22 || currentHour < 5) {
      log(`🟢 Currently in learning window (${currentHour}:${now.getMinutes().toString().padStart(2, '0')})`);
    } else {
      const hoursUntilLearning = currentHour < 22 ? 22 - currentHour : 24 - currentHour + 22;
      log(`⏳ Next learning session in ${hoursUntilLearning} hours (22:00)`);
    }

    // Keep service running
    setInterval(() => {
      const status = orchestrator.getStatus();
      if (status.active) {
        log(`🧠 Learning active - Sessions: ${status.sessionsCompleted}, Items learned: ${status.itemsLearned || 0}`);
      }
    }, 300000); // Log status every 5 minutes

  } catch (err) {
    log(`❌ ERROR: ${err.message}`);
    log(err.stack);
    process.exit(1);
  }
})();

// Handle shutdown gracefully
process.on('SIGINT', async () => {
  log('');
  log('Shutting down Nighttime Learning Service...');

  try {
    await orchestrator.shutdown();

    // Shutdown all arbiters
    if (mnemonicArbiter && mnemonicArbiter.shutdown) {
      await mnemonicArbiter.shutdown();
      log('✅ MnemonicArbiter stopped');
    }

    if (edgeWorker && edgeWorker.shutdown) {
      await edgeWorker.shutdown();
      log('✅ EdgeWorkerOrchestrator stopped');
    }

    if (impulser && impulser.shutdown) {
      await impulser.shutdown();
      log('✅ UniversalImpulser stopped');
    }

    if (storage && storage.shutdown) {
      await storage.shutdown();
      log('✅ StorageArbiter stopped');
    }

    if (deployment && deployment.shutdown) {
      await deployment.shutdown();
      log('✅ DeploymentArbiter stopped');
    }

    if (archivist && archivist.shutdown) {
      await archivist.shutdown();
      log('✅ ArchivistArbiter stopped');
    }

    if (gpuTraining && gpuTraining.shutdown) {
      await gpuTraining.shutdown();
      log('✅ GPUTrainingArbiter stopped');
    }

    log('✅ Service stopped gracefully');
    logStream.end();
    process.exit(0);
  } catch (err) {
    log(`Error during shutdown: ${err.message}`);
    logStream.end();
    process.exit(1);
  }
});

process.on('SIGTERM', async () => {
  await orchestrator.shutdown();

  // Shutdown all arbiters
  if (mnemonicArbiter && mnemonicArbiter.shutdown) {
    await mnemonicArbiter.shutdown();
  }
  if (edgeWorker && edgeWorker.shutdown) await edgeWorker.shutdown();
  if (impulser && impulser.shutdown) await impulser.shutdown();
  if (storage && storage.shutdown) await storage.shutdown();
  if (deployment && deployment.shutdown) await deployment.shutdown();
  if (archivist && archivist.shutdown) await archivist.shutdown();
  if (gpuTraining && gpuTraining.shutdown) await gpuTraining.shutdown();

  logStream.end();
  process.exit(0);
});

// Log uncaught errors - use safe logging to prevent cascading failures
process.on('uncaughtException', (err) => {
  try {
    const errorMsg = `[${new Date().toISOString()}] UNCAUGHT EXCEPTION: ${err.message}\n${err.stack}\n`;
    process.stderr.write(errorMsg);
    if (logStream && !logStream.destroyed) {
      logStream.write(errorMsg);
    }
  } catch (e) {
    // If we can't log, at least don't crash from logging
  }
});

process.on('unhandledRejection', (reason, promise) => {
  try {
    const errorMsg = `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`;
    process.stderr.write(errorMsg);
    if (logStream && !logStream.destroyed) {
      logStream.write(errorMsg);
    }
  } catch (e) {
    // If we can't log, at least don't crash from logging
  }
});
