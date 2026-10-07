// ═══════════════════════════════════════════════════════════
// LocalModelServer.js - Serve Trained SOMA Models Locally
// Uses Ollama or llama.cpp to serve fine-tuned Llama models
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * LocalModelServer
 *
 * Manages serving of locally fine-tuned SOMA models
 * - Loads models via Ollama or llama.cpp
 * - Provides inference API
 * - Handles model switching
 * - Monitors model performance
 */
export class LocalModelServer extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'LocalModelServer';
    this.serverType = config.serverType || 'ollama'; // 'ollama' or 'llamacpp'
    this.currentModel = null;
    this.loadedModels = new Map();

    // Model registry
    this.models = {
      'soma-finetuned-latest': {
        path: './models/soma-finetuned-latest',
        type: 'llama',
        loaded: false
      }
    };

    // Performance metrics
    this.metrics = {
      totalInferences: 0,
      averageLatency: 0,
      modelSwitches: 0,
      errors: 0
    };

    console.log(`[${this.name}] 🤖 Local Model Server initialized (${this.serverType})`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing local model server...`);

    // Check if Ollama is available
    try {
      await this.checkOllamaAvailable();
      console.log(`[${this.name}]    ✅ Ollama detected`);
      this.serverType = 'ollama';
    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  Ollama not available: ${error.message}`);
      console.log(`[${this.name}]    Falling back to direct model loading`);
      this.serverType = 'direct';
    }

    this.emit('initialized');
    console.log(`[${this.name}] ✅ Local model server ready`);
    return { success: true };
  }

  /**
   * Check if Ollama is available
   */
  async checkOllamaAvailable() {
    return new Promise((resolve, reject) => {
      const ollama = spawn('ollama', ['list']);

      let stdout = '';
      ollama.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ollama.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error('Ollama command failed'));
        }
      });

      ollama.on('error', (err) => {
        reject(new Error(`Ollama not found: ${err.message}`));
      });
    });
  }

  /**
   * Load a fine-tuned model
   */
  async loadModel(modelName, modelPath) {
    console.log(`[${this.name}] Loading model: ${modelName}`);
    console.log(`[${this.name}]    Path: ${modelPath}`);

    try {
      // Check if model files exist
      const modelExists = await this.checkModelExists(modelPath);

      if (!modelExists) {
        throw new Error(`Model files not found at: ${modelPath}`);
      }

      if (this.serverType === 'ollama') {
        // Create Ollama model from local files
        await this.createOllamaModel(modelName, modelPath);
      } else {
        // Direct loading (llama.cpp or transformers.js)
        console.log(`[${this.name}]    ⚠️  Direct loading not yet implemented`);
      }

      this.loadedModels.set(modelName, {
        path: modelPath,
        loadTime: Date.now(),
        inferenceCount: 0
      });

      this.currentModel = modelName;

      console.log(`[${this.name}] ✅ Model loaded: ${modelName}`);
      this.emit('model_loaded', { modelName, modelPath });

      return { success: true, modelName };

    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to load model: ${error.message}`);
      this.metrics.errors++;
      this.emit('model_load_error', { modelName, error: error.message });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if model files exist
   */
  async checkModelExists(modelPath) {
    try {
      const stats = await fs.stat(modelPath);
      return stats.isDirectory();
    } catch (error) {
      return false;
    }
  }

  /**
   * Create Ollama model from local fine-tuned model
   */
  async createOllamaModel(modelName, modelPath) {
    console.log(`[${this.name}]    Creating Ollama model from fine-tuned weights...`);

    // Create Modelfile for Ollama
    const modelfile = `
FROM ${modelPath}

PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40

SYSTEM You are SOMA, a self-improving digital intelligence. You have been trained on your own experiences and learnings.
`;

    const modelfilePath = path.join(modelPath, 'Modelfile');
    await fs.writeFile(modelfilePath, modelfile);

    return new Promise((resolve, reject) => {
      const ollama = spawn('ollama', ['create', modelName, '-f', modelfilePath]);

      let stdout = '';
      let stderr = '';

      ollama.stdout.on('data', (data) => {
        stdout += data.toString();
        console.log(`[${this.name}]       ${data.toString().trim()}`);
      });

      ollama.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ollama.on('close', (code) => {
        if (code === 0) {
          resolve(true);
        } else {
          reject(new Error(`Ollama create failed: ${stderr}`));
        }
      });

      ollama.on('error', (err) => {
        reject(new Error(`Failed to create Ollama model: ${err.message}`));
      });
    });
  }

  /**
   * Run inference on current model
   */
  async _executeInference(prompt, options = {}) {
    if (!this.currentModel) {
      throw new Error('No model loaded');
    }

    const {
      temperature = 0.7,
      maxTokens = 2048,
      stream = false
    } = options;

    const startTime = Date.now();
    this.metrics.totalInferences++;

    try {
      let response;

      if (this.serverType === 'ollama') {
        response = await this.ollamaInference(prompt, {
          model: this.currentModel,
          temperature,
          maxTokens,
          stream
        });
      } else {
        throw new Error('Direct inference not yet implemented');
      }

      const latency = Date.now() - startTime;
      this.updateLatencyMetrics(latency);

      return {
        success: true,
        text: response,
        model: this.currentModel,
        latencyMs: latency
      };
    } catch (error) {
      this.metrics.failedInferences++;
      throw error;
    }
  }

  async inference(prompt, options = {}) {
    let attempts = 3;
    let delay = 500;
    let lastErr = null;
    while (attempts > 0) {
      try {
        return await this._executeInference(prompt, options);
      } catch (err) {
        lastErr = err;
        attempts--;
        if (attempts > 0) {
          await new Promise(r => setTimeout(r, delay));
          delay *= 2;
        }
      }
    }
    throw lastErr;
  }

  async _disabledInferenceLegacy(prompt, options = {}) {
    if (!this.currentModel) {
      throw new Error('No model loaded');
    }

    const {
      temperature = 0.7,
      maxTokens = 2048,
      stream = false
    } = options;

    const startTime = Date.now();
    this.metrics.totalInferences++;

    try {
      let response;

      if (this.serverType === 'ollama') {
        response = await this.ollamaInference(prompt, {
          model: this.currentModel,
          temperature,
          maxTokens,
          stream
        });
      } else {
        throw new Error('Direct inference not yet implemented');
      }

      const latency = Date.now() - startTime;
      this.updateLatencyMetrics(latency);

      // Update model inference count
      const modelInfo = this.loadedModels.get(this.currentModel);
      if (modelInfo) {
        modelInfo.inferenceCount++;
      }

      this.emit('inference_complete', {
        model: this.currentModel,
        latency,
        tokensGenerated: response.tokensGenerated
      });

      return {
        success: true,
        response: response.text,
        latency,
        model: this.currentModel
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ Inference failed: ${error.message}`);
      this.metrics.errors++;
      this.emit('inference_error', { error: error.message });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Run inference via Ollama
   */
  async ollamaInference(prompt, options) {
    return new Promise((resolve, reject) => {
      const args = [
        'run',
        options.model,
        prompt
      ];

      const ollama = spawn('ollama', args);

      let stdout = '';
      let stderr = '';

      ollama.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ollama.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ollama.on('close', (code) => {
        if (code === 0) {
          resolve({
            text: stdout.trim(),
            tokensGenerated: stdout.split(' ').length // Rough estimate
          });
        } else {
          reject(new Error(`Ollama inference failed: ${stderr}`));
        }
      });

      ollama.on('error', (err) => {
        reject(new Error(`Failed to run Ollama: ${err.message}`));
      });
    });
  }

  /**
   * Switch to a different model
   */
  async switchModel(modelName) {
    console.log(`[${this.name}] Switching to model: ${modelName}`);

    if (!this.loadedModels.has(modelName)) {
      return {
        success: false,
        error: `Model ${modelName} not loaded`
      };
    }

    this.currentModel = modelName;
    this.metrics.modelSwitches++;

    console.log(`[${this.name}] ✅ Now using model: ${modelName}`);
    this.emit('model_switched', { modelName });

    return { success: true, modelName };
  }

  /**
   * Update latency metrics
   */
  updateLatencyMetrics(latency) {
    const totalInferences = this.metrics.totalInferences;
    const prevAvg = this.metrics.averageLatency;

    this.metrics.averageLatency =
      (prevAvg * (totalInferences - 1) + latency) / totalInferences;
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      name: this.name,
      serverType: this.serverType,
      currentModel: this.currentModel,
      loadedModels: Array.from(this.loadedModels.keys()),
      metrics: this.metrics
    };
  }

  /**
   * Shutdown server
   */
  async shutdown() {
    console.log(`[${this.name}] Shutting down local model server...`);

    this.emit('shutdown');

    return { success: true };
  }
}

export default LocalModelServer;
