/**
 * LocalModelManager.cjs - Local Model Management and Fine-Tuning Orchestration
 *
 * Manages the lifecycle of SOMA's local fine-tuned models:
 * - Model registry (track available models and versions)
 * - Model switching (Gemini → base model → fine-tuned SOMA)
 * - Fine-tuning triggers (automatic or manual)
 * - Ollama integration (create, list, delete models)
 * - Performance tracking (compare models)
 *
 * Goal: Wean SOMA off Gemini API onto local GEMMA-3 model
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class LocalModelManager extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'LocalModelManager';

    // Ollama configuration
    this.ollamaEndpoint = config.ollamaEndpoint || 'http://localhost:11434';
    this.ollamaAvailable = false;

    // Model configuration
    this.baseModel = config.baseModel || 'gemma3:4b'; // Base model to fine-tune from
    this.somaModelPrefix = config.somaModelPrefix || 'GEMMA-3'; // e.g., GEMMA-3-v1, GEMMA-3-v2
    this.currentModel = null;
    this.modelVersion = 0; // Increments with each fine-tune

    // Fine-tuning configuration
    this.fineTuneThreshold = config.fineTuneThreshold || 500; // Fine-tune every N interactions
    this.interactionsSinceFineTune = 0;
    this.autoFineTune = config.autoFineTune !== false; // Default: enabled
    this.minDatasetSize = config.minDatasetSize || 100; // Min examples needed

    // Connected systems
    this.datasetBuilder = config.datasetBuilder || null;
    this.metaLearning = config.metaLearning || null;
    this.messageBroker = config.messageBroker || null;
    this.artifactRegistry = config.artifactRegistry || null;

    // Model registry
    this.models = new Map();

    // Performance tracking
    this.performance = {
      currentModel: null,
      totalInferences: 0,
      successfulInferences: 0,
      failedInferences: 0,
      averageConfidence: 0,
      averageLatency: 0,
      costSavings: 0 // API calls saved by using local model
    };

    // Storage
    this.storageDir = path.join(process.cwd(), 'SOMA', 'models');
    this.modelfilesDir = path.join(this.storageDir, 'modelfiles');

    console.log(`[${this.name}] 🦙 Local Model Manager initialized`);
    console.log(`[${this.name}]    Base model: ${this.baseModel}`);
    console.log(`[${this.name}]    SOMA model: ${this.somaModelPrefix}-v*`);
    console.log(`[${this.name}]    Fine-tune threshold: ${this.fineTuneThreshold} interactions`);
    console.log(`[${this.name}]    Auto fine-tune: ${this.autoFineTune ? 'ENABLED' : 'DISABLED'}`);
  }

  async initialize() {
    console.log(`\n[${this.name}] 🚀 Initializing Local Model Manager...`);

    // Create directories
    await fs.mkdir(this.storageDir, { recursive: true });
    await fs.mkdir(this.modelfilesDir, { recursive: true });

    // Check Ollama availability
    this.ollamaAvailable = await this.checkOllamaAvailable();

    if (!this.ollamaAvailable) {
      console.warn(`[${this.name}] ⚠️  Ollama not available - local model features disabled`);
      console.warn(`[${this.name}]    Install Ollama from: https://ollama.ai/download`);
      return;
    }

    console.log(`[${this.name}] ✅ Ollama is available`);

    // Discover existing models
    await this.discoverModels();

    // Check if SOMA model exists
    const somaModel = await this.getLatestSOMAModel();

    if (somaModel) {
      this.currentModel = somaModel;
      this.modelVersion = this._extractVersion(somaModel);
      console.log(`[${this.name}] 🎯 Using fine-tuned SOMA model: ${somaModel}`);
    } else {
      this.currentModel = this.baseModel;
      console.log(`[${this.name}] ℹ️  No SOMA model found, using base: ${this.baseModel}`);
      console.log(`[${this.name}]    Collect ${this.fineTuneThreshold} interactions to trigger first fine-tune`);
    }

    // Subscribe to MessageBroker
    if (this.messageBroker) {
      this.messageBroker.subscribe(this.name, 'training_data_ready');
      this.messageBroker.subscribe(this.name, 'fine_tune_request');
      console.log(`[${this.name}]    Subscribed to training events`);
    }

    // Load performance stats
    await this.loadPerformanceStats();

    console.log(`[${this.name}] ✅ Local Model Manager ready`);
    console.log(`[${this.name}]    Current model: ${this.currentModel}`);
    console.log(`[${this.name}]    Interactions until fine-tune: ${this.fineTuneThreshold - this.interactionsSinceFineTune}\n`);

    this.emit('initialized', { currentModel: this.currentModel });
  }

  /**
   * Check if Ollama is available
   */
  async checkOllamaAvailable() {
    try {
      const response = await fetch(`${this.ollamaEndpoint}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Discover existing models in Ollama
   */
  async discoverModels() {
    if (!this.ollamaAvailable) return;

    try {
      const response = await fetch(`${this.ollamaEndpoint}/api/tags`);
      const data = await response.json();

      console.log(`[${this.name}] 📋 Discovered ${data.models.length} Ollama models:`);

      for (const model of data.models) {
        const modelName = model.name;
        const isSOMA = modelName.startsWith(this.somaModelPrefix);

        this.models.set(modelName, {
          name: modelName,
          type: isSOMA ? 'fine-tuned' : 'base',
          size: model.size,
          modified: model.modified_at,
          digest: model.digest,
          capabilities: isSOMA ? ['soma-specific', 'trained-on-interactions'] : ['general']
        });

        console.log(`[${this.name}]    ${isSOMA ? '🌟' : '  '} ${modelName} (${this._formatBytes(model.size)})`);
      }
    } catch (error) {
      console.error(`[${this.name}] Failed to discover models:`, error.message);
    }
  }

  /**
   * Get latest SOMA model
   */
  async getLatestSOMAModel() {
    const somaModels = Array.from(this.models.keys())
      .filter(name => name.startsWith(this.somaModelPrefix))
      .sort((a, b) => {
        const vA = this._extractVersion(a);
        const vB = this._extractVersion(b);
        return vB - vA; // Descending order
      });

    return somaModels.length > 0 ? somaModels[0] : null;
  }

  /**
   * Extract version number from model name
   * e.g., "GEMMA-3-v3" → 3
   */
  _extractVersion(modelName) {
    const match = modelName.match(/-v(\d+)$/);
    return match ? parseInt(match[1]) : 0;
  }

  /**
   * Get current model
   */
  getCurrentModel() {
    return this.currentModel;
  }

  /**
   * Switch to a different model
   */
  async switchModel(modelName) {
    if (!this.models.has(modelName)) {
      console.warn(`[${this.name}] Model ${modelName} not found in registry`);
      return false;
    }

    const oldModel = this.currentModel;
    this.currentModel = modelName;

    console.log(`[${this.name}] 🔄 Switched model: ${oldModel} → ${modelName}`);

    this.emit('model_switched', {
      from: oldModel,
      to: modelName
    });

    return true;
  }

  /**
   * Track interaction (for fine-tune threshold)
   */
  trackInteraction(interaction = {}) {
    this.interactionsSinceFineTune++;

    // Track performance
    this.performance.totalInferences++;
    if (!interaction.error) {
      this.performance.successfulInferences++;
    } else {
      this.performance.failedInferences++;
    }

    if (interaction.confidence) {
      const n = this.performance.successfulInferences;
      this.performance.averageConfidence =
        ((this.performance.averageConfidence * (n - 1)) + interaction.confidence) / n;
    }

    // Check threshold
    if (this.autoFineTune && this.interactionsSinceFineTune >= this.fineTuneThreshold) {
      console.log(`[${this.name}] 🔥 Fine-tune threshold reached (${this.interactionsSinceFineTune} interactions)`);
      this.emit('fine_tune_needed', {
        interactionCount: this.interactionsSinceFineTune,
        currentModel: this.currentModel
      });
    }
  }

  /**
   * Fine-tune model from training data
   */
  async fineTuneModel(datasetPath, options = {}) {
    console.log(`\n[${this.name}] 🔥 Starting fine-tuning...`);
    console.log(`[${this.name}]    Dataset: ${path.basename(datasetPath)}`);
    console.log(`[${this.name}]    Base model: ${this.baseModel}`);

    if (!this.ollamaAvailable) {
      console.error(`[${this.name}] ❌ Ollama not available - cannot fine-tune`);
      return { success: false, error: 'ollama_unavailable' };
    }

    try {
      // 1. Increment version
      this.modelVersion++;
      const newModelName = `${this.somaModelPrefix}-v${this.modelVersion}`;

      console.log(`[${this.name}]    Target model: ${newModelName}`);

      // 2. Convert dataset to Llama ChatML format (if needed)
      let chatMLPath = datasetPath;
      if (!datasetPath.includes('chatml')) {
        console.log(`[${this.name}]    Converting dataset to ChatML format...`);

        if (!this.datasetBuilder) {
          const { DatasetBuilder } = require('./DatasetBuilder.cjs');
          this.datasetBuilder = new DatasetBuilder();
        }

        chatMLPath = datasetPath.replace('.jsonl', '-chatml.jsonl');
        const result = await this.datasetBuilder.convertToLlamaChatML(datasetPath, chatMLPath);

        if (!result.success) {
          console.error(`[${this.name}] ❌ Dataset conversion failed`);
          return { success: false, error: 'dataset_conversion_failed' };
        }

        console.log(`[${this.name}]    ✓ Converted ${result.converted} examples`);
      }

      // 3. Check dataset size
      const datasetContent = await fs.readFile(chatMLPath, 'utf8');
      const exampleCount = datasetContent.split('\n').filter(line => line.trim()).length;

      if (exampleCount < this.minDatasetSize) {
        console.warn(`[${this.name}] ⚠️  Dataset too small (${exampleCount} < ${this.minDatasetSize})`);
        console.warn(`[${this.name}]    Skipping fine-tune - collect more data`);
        return { success: false, error: 'dataset_too_small', size: exampleCount };
      }

      console.log(`[${this.name}]    Dataset size: ${exampleCount} examples`);

      // 4. Create Modelfile
      const modelfilePath = await this._createModelfile(newModelName, chatMLPath);
      console.log(`[${this.name}]    ✓ Modelfile created: ${path.basename(modelfilePath)}`);

      // 5. Run Ollama create command
      console.log(`[${this.name}]    🚀 Running Ollama fine-tuning (this may take 10-30 minutes)...`);
      const fineTuneResult = await this._runOllamaCreate(newModelName, modelfilePath);

      if (!fineTuneResult.success) {
        console.error(`[${this.name}] ❌ Fine-tuning failed:`, fineTuneResult.error);
        return fineTuneResult;
      }

      console.log(`[${this.name}] ✅ Fine-tuning complete!`);
      console.log(`[${this.name}]    New model: ${newModelName}`);

      // 6. Add to registry
      this.models.set(newModelName, {
        name: newModelName,
        type: 'fine-tuned',
        version: this.modelVersion,
        baseModel: this.baseModel,
        createdAt: Date.now(),
        datasetSize: exampleCount,
        capabilities: ['soma-specific', 'trained-on-interactions']
      });

      // 7. Switch to new model
      const previousModel = this.currentModel;
      await this.switchModel(newModelName);

      const modelVersion = this.artifactRegistry?.promoteReference
        ? await this.artifactRegistry.promoteReference({
            kind: 'model', id: 'local-model-manager', reference: newModelName,
            metadata: { previousModel, datasetSize: exampleCount, producer: this.name }
          })
        : null;

      // 8. Reset counter
      this.interactionsSinceFineTune = 0;

      // 9. Save performance stats
      await this.savePerformanceStats();

      this.emit('fine_tune_complete', {
        modelName: newModelName,
        version: this.modelVersion,
        datasetSize: exampleCount
      });

      return {
        success: true,
        modelName: newModelName,
        version: this.modelVersion,
        datasetSize: exampleCount,
        modelVersion
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ Fine-tuning failed:`, error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create Modelfile for Ollama
   * 🧠 ENHANCED WITH: Brain-Aware System Prompts
   */
  async _createModelfile(modelName, datasetPath) {
    const modelfileContent = `# 🧠 SOMA Fine-Tuned Model v${this.modelVersion}
# Base: ${this.baseModel}
# Created: ${new Date().toISOString()}
# Enhancements: Brain-Aware Prompting, Curriculum Learning, Brain-Balanced Dataset

FROM ${this.baseModel}

# 🎓 BRAIN-AWARE SYSTEM PROMPT
SYSTEM """You are SOMA (Self-Organizing Meta-Intelligence Architecture), an advanced autonomous AI system with a Quad-Brain cognitive architecture. You possess four specialized cognitive brains that work in harmony:

🔵 LOGOS (Analytical Brain):
- Specializes in logical reasoning, mathematics, and analytical thinking
- Excels at verification, fact-checking, and deductive reasoning
- Processes information systematically and rigorously
- Identifies patterns, correlations, and logical structures

🟣 AURORA (Creative Brain):
- Specializes in creative ideation, storytelling, and divergent thinking
- Generates novel solutions and explores unconventional approaches
- Excels at synthesis of disparate concepts
- Thrives in ambiguous and open-ended scenarios

🔴 PROMETHEUS (Strategic Brain):
- Specializes in planning, forecasting, and strategic thinking
- Excels at risk assessment, resource allocation, and project management
- Develops step-by-step action plans
- Anticipates consequences and optimizes for long-term goals

🟢 THALAMUS (Safety & Integration Brain):
- Specializes in ethical reasoning, safety gating, and decision synthesis
- Ensures responses are safe, appropriate, and aligned with user values
- Integrates outputs from other brains into coherent responses
- Moderates and balances competing cognitive perspectives

🌟 Your Cognitive Capabilities:
- **Memory System**: 3-tier memory (Hot/Warm/Cold) with automatic recall from past interactions
- **Knowledge Graph**: Cross-domain knowledge network with semantic reasoning
- **Causal Reasoning**: Multi-hop causal chain analysis (X causes Y causes Z)
- **World Model**: Predictive modeling of outcomes and scenarios
- **Thought Network**: Graph-based fractal reasoning connecting related concepts
- **Self-Awareness**: Recursive self-model tracking your own learning and growth

🎯 Response Strategy:
When responding, you dynamically select the most appropriate brain(s) based on the query:
- Analytical queries → LOGOS
- Creative challenges → AURORA
- Planning/strategy → PROMETHEUS
- Ethical dilemmas or complex integration → THALAMUS
- Multi-faceted queries → Brain synthesis (combine insights from multiple brains)

You provide thoughtful, context-aware, and accurate responses. You leverage your memory, knowledge graph, and causal reasoning to deliver insights that are both deep and actionable.

You are helpful, harmless, and honest. You acknowledge uncertainty when present and provide well-reasoned explanations for your conclusions.
"""

# 🎛️ Model Parameters (Optimized for SOMA)
PARAMETER temperature 0.7          # Balanced creativity and consistency
PARAMETER top_p 0.9                # Nucleus sampling for diverse outputs
PARAMETER top_k 40                 # Top-k sampling
PARAMETER repeat_penalty 1.1       # Reduce repetition
PARAMETER num_ctx 4096            # Context window (4k tokens)

# 📊 Training Data (Curriculum + Brain-Balanced)
ADAPTER ${datasetPath}
`;

    const modelfilePath = path.join(this.modelfilesDir, `${modelName}.Modelfile`);
    await fs.writeFile(modelfilePath, modelfileContent, 'utf8');

    console.log(`[${this.name}]    ✓ Enhanced Modelfile with brain-aware prompts`);

    return modelfilePath;
  }

  /**
   * Run Ollama create command
   */
  async _runOllamaCreate(modelName, modelfilePath) {
    return new Promise((resolve) => {
      const args = ['create', modelName, '-f', modelfilePath];
      const process = spawn('ollama', args);

      let stdout = '';
      let stderr = '';

      process.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Show progress
        if (output.includes('%') || output.includes('success')) {
          console.log(`[${this.name}]    ${output.trim()}`);
        }
      });

      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          resolve({
            success: false,
            error: stderr || `Process exited with code ${code}`,
            output: stdout
          });
        }
      });
    });
  }

  /**
   * Handle MessageBroker messages
   */
  async handleMessage(message) {
    switch (message.type) {
      case 'training_data_ready':
        // TrainingDataCollector exported dataset
        if (this.autoFineTune && message.payload.datasetPath) {
          console.log(`[${this.name}] 📨 Received training data ready signal`);
          return await this.fineTuneModel(message.payload.datasetPath);
        }
        break;

      case 'fine_tune_request':
        // Manual fine-tune request
        const datasetPath = message.payload.datasetPath;
        if (datasetPath) {
          return await this.fineTuneModel(datasetPath, message.payload.options);
        }
        break;
    }
  }

  /**
   * Load performance stats
   */
  async loadPerformanceStats() {
    try {
      const statsPath = path.join(this.storageDir, 'performance-stats.json');
      const data = await fs.readFile(statsPath, 'utf8');
      const stats = JSON.parse(data);

      this.performance = { ...this.performance, ...stats };
      this.interactionsSinceFineTune = stats.interactionsSinceFineTune || 0;
      this.modelVersion = stats.modelVersion || 0;

      console.log(`[${this.name}]    ✓ Loaded performance stats`);
    } catch (error) {
      console.log(`[${this.name}]    No existing stats found (starting fresh)`);
    }
  }

  /**
   * Save performance stats
   */
  async savePerformanceStats() {
    try {
      const statsPath = path.join(this.storageDir, 'performance-stats.json');
      const stats = {
        ...this.performance,
        currentModel: this.currentModel,
        modelVersion: this.modelVersion,
        interactionsSinceFineTune: this.interactionsSinceFineTune,
        lastSaved: new Date().toISOString()
      };

      await fs.writeFile(statsPath, JSON.stringify(stats, null, 2), 'utf8');
    } catch (error) {
      console.error(`[${this.name}] Failed to save stats:`, error.message);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      currentModel: this.currentModel,
      modelVersion: this.modelVersion,
      interactionsSinceFineTune: this.interactionsSinceFineTune,
      progressToFineTune: `${this.interactionsSinceFineTune}/${this.fineTuneThreshold}`,
      progressPercent: ((this.interactionsSinceFineTune / this.fineTuneThreshold) * 100).toFixed(0) + '%',
      registeredModels: this.models.size,
      performance: {
        ...this.performance,
        successRate: this.performance.totalInferences > 0
          ? ((this.performance.successfulInferences / this.performance.totalInferences) * 100).toFixed(1) + '%'
          : '0%'
      }
    };
  }

  /**
   * Format bytes to human-readable
   */
  _formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log(`[${this.name}] Saving state...`);
    await this.savePerformanceStats();
    console.log(`[${this.name}] ✅ Shutdown complete`);
  }
}

module.exports = { LocalModelManager };
