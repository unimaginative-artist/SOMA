// ═══════════════════════════════════════════════════════════
// GPUTrainingArbiter.js - REAL GPU-Accelerated Training System
// Uses PyTorch + CUDA for actual NVIDIA GPU training
// NO MORE SIMULATED GARBAGE - THIS IS REAL!
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * GPUTrainingArbiter
 *
 * Manages GPU-accelerated training workloads for SOMA
 * - Benchmarks CPU vs GPU performance
 * - Runs training loops on NVIDIA hardware
 * - Tracks performance improvements
 * - Optimizes batch sizes for GPU memory
 */
export class GPUTrainingArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'GPUTrainingArbiter';
    this.gpuProfile = null;
    this.loadPipeline = config.loadPipeline || null;

    // Training metrics
    this.metrics = {
      totalTrainingSessions: 0,
      gpuSessions: 0,
      cpuSessions: 0,
      averageGPUSpeed: 0,
      averageCPUSpeed: 0,
      speedupRatio: 0,
      totalSamplesProcessed: 0
    };

    // Training history
    this.trainingHistory = [];

    console.log(`[${this.name}] 🎮 GPU Training Arbiter initialized`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing GPU training system...`);

    // Get GPU profile from LoadPipelineArbiter
    if (this.loadPipeline) {
      try {
        const status = this.loadPipeline.getStatus();
        if (status && status.hardware) {
          this.gpuProfile = status.hardware;
          const gpuInfo = this.gpuProfile.gpu?.available ? this.gpuProfile.gpu.type : 'None';
          console.log(`[${this.name}]    GPU: ${gpuInfo}`);
          console.log(`[${this.name}]    Tier: ${this.gpuProfile.tier || 'unknown'}`);
        } else {
          console.warn(`[${this.name}]    LoadPipeline status unavailable - using CPU fallback`);
          this.gpuProfile = { gpu: { available: false }, tier: 'cpu' };
        }
      } catch (error) {
        console.warn(`[${this.name}]    Failed to get GPU profile: ${error.message}`);
        this.gpuProfile = { gpu: { available: false }, tier: 'cpu' };
      }
    } else {
      console.warn(`[${this.name}]    No LoadPipelineArbiter - using CPU fallback`);
      this.gpuProfile = { gpu: { available: false }, tier: 'cpu' };
    }

    this.emit('initialized');
    console.log(`[${this.name}] ✅ GPU training system ready`);
    return { success: true };
  }

  /**
   * Run a training benchmark comparing CPU vs GPU
   */
  async runBenchmark(params = {}) {
    const {
      batchSize = 32,
      iterations = 100,
      modelType = 'embedding',
      compareDevices = true
    } = params;

    console.log(`\n[${this.name}] 🏁 Starting Training Benchmark`);
    console.log(`[${this.name}]    Batch Size: ${batchSize}`);
    console.log(`[${this.name}]    Iterations: ${iterations}`);
    console.log(`[${this.name}]    Model Type: ${modelType}`);

    const results = {
      cpu: null,
      gpu: null,
      speedup: null
    };

    // Run CPU benchmark
    if (compareDevices) {
      console.log(`\n[${this.name}] 📊 CPU Benchmark...`);
      results.cpu = await this.runTrainingSession({
        device: 'cpu',
        batchSize,
        iterations,
        modelType
      });
      console.log(`[${this.name}]    CPU Time: ${results.cpu.duration}ms`);
      console.log(`[${this.name}]    CPU Throughput: ${results.cpu.throughput.toFixed(2)} samples/sec`);
    }

    // Run GPU benchmark (if available)
    if (this.gpuProfile?.gpu?.available) {
      console.log(`\n[${this.name}] 🎮 GPU Benchmark...`);
      results.gpu = await this.runTrainingSession({
        device: 'gpu',
        batchSize,
        iterations,
        modelType
      });
      console.log(`[${this.name}]    GPU Time: ${results.gpu.duration}ms`);
      console.log(`[${this.name}]    GPU Throughput: ${results.gpu.throughput.toFixed(2)} samples/sec`);

      // Calculate speedup
      if (results.cpu && results.gpu) {
        results.speedup = results.cpu.duration / results.gpu.duration;
        console.log(`\n[${this.name}] 🚀 GPU Speedup: ${results.speedup.toFixed(2)}x faster`);

        // Update metrics
        this.metrics.speedupRatio = results.speedup;
      }
    } else {
      console.warn(`[${this.name}]    No GPU available - skipping GPU benchmark`);
    }

    // Store in history
    this.trainingHistory.push({
      timestamp: Date.now(),
      type: 'benchmark',
      batchSize,
      iterations,
      results
    });

    this.emit('benchmark_complete', results);

    return results;
  }

  /**
   * Run a single REAL training session using PyTorch + CUDA
   */
  async runTrainingSession(params = {}) {
    const {
      device = 'cpu',
      batchSize = 32,
      iterations = 100,
      modelType = 'embedding'
    } = params;

    this.metrics.totalTrainingSessions++;
    if (device === 'gpu' || device === 'cuda') this.metrics.gpuSessions++;
    else this.metrics.cpuSessions++;

    console.log(`[${this.name}] 🔥 Running REAL ${device.toUpperCase()} training...`);

    // Call Python script for REAL training
    const result = await this.callPythonTraining({
      command: 'train',
      device: device === 'gpu' ? 'cuda' : device,
      batchSize,
      iterations
    });

    this.metrics.totalSamplesProcessed += result.total_samples;

    // Update average speeds
    if (device === 'gpu' || device === 'cuda') {
      this.metrics.averageGPUSpeed =
        (this.metrics.averageGPUSpeed * (this.metrics.gpuSessions - 1) + result.throughput) /
        this.metrics.gpuSessions;
    } else {
      this.metrics.averageCPUSpeed =
        (this.metrics.averageCPUSpeed * (this.metrics.cpuSessions - 1) + result.throughput) /
        this.metrics.cpuSessions;
    }

    return {
      device: result.device,
      duration: result.duration_ms,
      throughput: result.throughput,
      totalSamples: result.total_samples,
      batchSize: result.batch_size,
      iterations: result.iterations,
      modelType,
      loss: result.final_loss,
      accuracy: 1 - result.final_loss, // Approximate accuracy from loss
      memoryUsed: `${result.memory_used_mb}MB`,
      modelParams: result.model_params
    };
  }

  /**
   * Call Python training script for REAL GPU/CPU training
   */
  async callPythonTraining(params) {
    const { command, device, batchSize, iterations } = params;

    return new Promise((resolve, reject) => {
      const pythonScript = path.join(__dirname, 'gpu_training_real.py');

      const args = [
        pythonScript,
        '--command', command,
        '--device', device,
        '--batch-size', batchSize.toString(),
        '--iterations', iterations.toString()
      ];

      const python = spawn('python', args);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      python.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log progress from Python script
        if (stderr.includes('[GPU Training]')) {
          console.log(stderr.trim());
        }
      });

      python.on('close', (code) => {
        if (code === 0) {
          try {
            const result = JSON.parse(stdout);
            resolve(result);
          } catch (e) {
            reject(new Error(`Failed to parse Python output: ${e.message}\nOutput: ${stdout}`));
          }
        } else {
          reject(new Error(`Python training failed with code ${code}\nStderr: ${stderr}`));
        }
      });

      python.on('error', (err) => {
        reject(new Error(`Failed to start Python training: ${err.message}`));
      });
    });
  }

  /**
   * Check NVIDIA GPU utilization
   */
  async getGPUUtilization() {
    if (!this.gpuProfile?.gpu?.available) {
      return { available: false };
    }

    return new Promise((resolve) => {
      const nvidia = spawn('nvidia-smi', [
        '--query-gpu=utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu',
        '--format=csv,noheader,nounits'
      ]);

      let output = '';

      nvidia.stdout.on('data', (data) => {
        output += data.toString();
      });

      nvidia.on('close', (code) => {
        if (code === 0 && output) {
          const [gpuUtil, memUtil, memUsed, memTotal, temp] = output.trim().split(',').map(v => parseFloat(v.trim()));

          resolve({
            available: true,
            gpuUtilization: gpuUtil,
            memoryUtilization: memUtil,
            memoryUsed: memUsed,
            memoryTotal: memTotal,
            temperature: temp,
            timestamp: Date.now()
          });
        } else {
          resolve({ available: true, error: 'nvidia-smi failed' });
        }
      });

      nvidia.on('error', () => {
        resolve({ available: true, error: 'nvidia-smi not accessible' });
      });
    });
  }

  /**
   * Run continuous GPU monitoring during training
   */
  async monitorGPUDuringTraining(trainingFn, interval = 1000) {
    const measurements = [];
    let monitoring = true;

    // Start monitoring loop
    const monitorLoop = setInterval(async () => {
      if (!monitoring) return;

      const util = await this.getGPUUtilization();
      if (util.available && !util.error) {
        measurements.push(util);
        console.log(`[${this.name}] GPU: ${util.gpuUtilization}% | Mem: ${util.memoryUsed}MB/${util.memoryTotal}MB | Temp: ${util.temperature}°C`);
      }
    }, interval);

    // Run training
    const result = await trainingFn();

    // Stop monitoring
    monitoring = false;
    clearInterval(monitorLoop);

    // Calculate averages
    const avgGPUUtil = measurements.length > 0
      ? measurements.reduce((sum, m) => sum + m.gpuUtilization, 0) / measurements.length
      : 0;

    const avgMemUtil = measurements.length > 0
      ? measurements.reduce((sum, m) => sum + m.memoryUtilization, 0) / measurements.length
      : 0;

    return {
      ...result,
      gpuMonitoring: {
        measurements,
        averageGPUUtilization: avgGPUUtil,
        averageMemoryUtilization: avgMemUtil,
        peakMemoryUsed: Math.max(...measurements.map(m => m.memoryUsed)),
        averageTemperature: measurements.reduce((sum, m) => sum + m.temperature, 0) / measurements.length
      }
    };
  }

  /**
   * NEW: Train SOMA on her own experiences using Llama
   * THIS IS THE KEY TO TRUE LEARNING
   */
  async trainOnExperiences(params = {}) {
    const {
      modelName = 'meta-llama/Llama-3.2-3B',
      epochs = 3,
      maxExperiences = 10000,
      batchSize = 4,
      outputDir = './soma-llama-finetuned'
    } = params;

    console.log(`\n[${this.name}] 🧠 TRAINING SOMA ON HER OWN EXPERIENCES`);
    console.log(`[${this.name}]    Model: ${modelName}`);
    console.log(`[${this.name}]    Max Experiences: ${maxExperiences}`);
    console.log(`[${this.name}]    Epochs: ${epochs}`);
    console.log(`[${this.name}]    Output: ${outputDir}`);

    const startTime = Date.now();

    try {
      // Call train-soma-llama.py
      const result = await this.callLlamaTraining({
        model: modelName,
        experiences: maxExperiences,
        epochs,
        batchSize,
        output: outputDir
      });

      const duration = Date.now() - startTime;
      console.log(`\n[${this.name}] ✅ LLM Training Complete in ${(duration / 1000 / 60).toFixed(1)} minutes`);
      console.log(`[${this.name}]    Model saved to: ${outputDir}`);
      console.log(`[${this.name}]    Experiences used: ${result.experiences_used}`);

      this.trainingHistory.push({
        timestamp: Date.now(),
        type: 'llm_training',
        modelName,
        epochs,
        experiencesUsed: result.experiences_used,
        duration,
        success: true
      });

      this.emit('llm_training_complete', {
        modelPath: outputDir,
        experiencesUsed: result.experiences_used,
        duration
      });

      return {
        success: true,
        modelPath: outputDir,
        experiencesUsed: result.experiences_used,
        duration,
        trainingMetrics: result.training_metrics
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ LLM Training failed:`, error.message);

      this.trainingHistory.push({
        timestamp: Date.now(),
        type: 'llm_training',
        modelName,
        epochs,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      });

      this.emit('llm_training_error', { error: error.message });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Call Python Llama training script (train-soma-llama.py)
   */
  async callLlamaTraining(params) {
    const { model, experiences, epochs, batchSize, output } = params;

    return new Promise((resolve, reject) => {
      const pythonScript = path.join(path.dirname(__dirname), 'train-soma-llama.py');

      const args = [
        pythonScript,
        '--model', model,
        '--experiences', experiences.toString(),
        '--epochs', epochs.toString(),
        '--batch-size', batchSize.toString(),
        '--output', output
      ];

      console.log(`[${this.name}] Executing: python ${args.join(' ')}`);

      const python = spawn('python', args);

      let stdout = '';
      let stderr = '';

      python.stdout.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        // Stream training progress to console
        if (output.includes('🚀') || output.includes('Loading') || output.includes('Training') || output.includes('✅')) {
          console.log(output.trim());
        }
      });

      python.stderr.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        // Log training progress
        if (output.includes('%') || output.includes('loss') || output.includes('Epoch')) {
          console.log(output.trim());
        }
      });

      python.on('close', (code) => {
        if (code === 0) {
          // Parse output for metrics
          const experiencesMatch = stdout.match(/✅ Loaded (\d+) experiences/);
          const experiencesUsed = experiencesMatch ? parseInt(experiencesMatch[1]) : 0;

          resolve({
            experiences_used: experiencesUsed,
            training_metrics: {
              // Could parse more from stdout if needed
            }
          });
        } else {
          reject(new Error(`Llama training failed with code ${code}\nStderr: ${stderr}`));
        }
      });

      python.on('error', (err) => {
        reject(new Error(`Failed to start Llama training: ${err.message}`));
      });
    });
  }

  /**
   * Autonomous training optimization
   * SOMA uses this to improve her own models
   */
  async autonomousTrainingCycle(params = {}) {
    const {
      targetMetric = 'accuracy',
      targetValue = 0.95,
      maxIterations = 10,
      batchSizeRange = [16, 128]
    } = params;

    console.log(`\n[${this.name}] 🤖 Autonomous Training Cycle`);
    console.log(`[${this.name}]    Target: ${targetMetric} >= ${targetValue}`);
    console.log(`[${this.name}]    Max Iterations: ${maxIterations}`);

    const results = [];
    let bestResult = null;

    for (let i = 0; i < maxIterations; i++) {
      // Adaptive batch size (start small, grow)
      const batchSize = Math.floor(
        batchSizeRange[0] + (batchSizeRange[1] - batchSizeRange[0]) * (i / maxIterations)
      );

      console.log(`\n[${this.name}] Iteration ${i + 1}/${maxIterations} (batch size: ${batchSize})`);

      const result = await this.runTrainingSession({
        device: this.gpuProfile?.gpu?.available ? 'gpu' : 'cpu',
        batchSize,
        iterations: 50,
        modelType: 'autonomous_improvement'
      });

      results.push(result);

      // Track best result
      if (!bestResult || result[targetMetric] > bestResult[targetMetric]) {
        bestResult = result;
        console.log(`[${this.name}] ✨ New best ${targetMetric}: ${result[targetMetric].toFixed(4)}`);
      }

      // Check if target reached
      if (result[targetMetric] >= targetValue) {
        console.log(`[${this.name}] 🎯 Target reached!`);
        break;
      }
    }

    const summary = {
      iterations: results.length,
      bestResult,
      allResults: results,
      targetReached: bestResult[targetMetric] >= targetValue,
      improvement: results.length > 0
        ? ((bestResult[targetMetric] - results[0][targetMetric]) / results[0][targetMetric] * 100).toFixed(2)
        : 0
    };

    console.log(`\n[${this.name}] 📈 Training Summary:`);
    console.log(`[${this.name}]    Best ${targetMetric}: ${bestResult[targetMetric].toFixed(4)}`);
    console.log(`[${this.name}]    Improvement: ${summary.improvement}%`);
    console.log(`[${this.name}]    Target Reached: ${summary.targetReached ? 'YES' : 'NO'}`);

    this.emit('autonomous_training_complete', summary);

    return summary;
  }

  getStatus() {
    return {
      name: this.name,
      gpu: this.gpuProfile?.gpu || { available: false },
      metrics: this.metrics,
      recentTraining: this.trainingHistory.slice(-5)
    };
  }

  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    this.emit('shutdown');
    return { success: true };
  }
}

export default GPUTrainingArbiter;
