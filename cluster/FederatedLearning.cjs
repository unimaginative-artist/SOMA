// FederatedLearning.cjs
// Federated learning orchestration and model aggregation

const fetch = require('node-fetch');
const EventEmitter = require('events');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

class FederatedLearning extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.nodeId = config.nodeId;
    this.clusterNode = config.clusterNode;
    this.role = config.role || 'worker'; // 'coordinator' or 'worker'
    
    this.logger = config.logger || console;
    
    // Training state
    this.currentRound = 0;
    this.trainingInProgress = false;
    this.localModel = null;
    this.globalModel = null;
    
    // Aggregation (coordinator only)
    this.roundModels = new Map(); // nodeId -> model updates
    this.minParticipants = config.minParticipants || 1;
    
    // Training history
    this.history = [];
  }
  
  // === WORKER METHODS ===
  
  async trainLocal(trainingData, config = {}) {
    this.logger.info(`[FederatedLearning:${this.nodeId}] Starting REAL PyTorch QLoRA local training...`);
    
    this.trainingInProgress = true;
    
    try {
      // Execute REAL PyTorch / DPO local training via python bridge
      const modelUpdates = await this._performLocalTraining(trainingData, config);
      
      const result = {
        nodeId: this.nodeId,
        round: this.currentRound,
        updates: modelUpdates,
        metrics: {
          // Real metrics straight from the trainer. Fields that genuinely aren't
          // produced come back null — never a fabricated fallback number.
          samplesProcessed: modelUpdates.metadata?.examples ?? (Array.isArray(trainingData) ? trainingData.length : 0),
          loss: modelUpdates.metrics?.loss ?? null,
          evalLoss: modelUpdates.metrics?.evalLoss ?? null,
          perplexity: modelUpdates.metrics?.perplexity ?? null,
          steps: modelUpdates.metrics?.steps ?? null,
          dryRun: modelUpdates.dryRun || false,
          trainingTime: Date.now()
        }
      };
      
      this.localModel = modelUpdates;
      
      this.logger.info(`[FederatedLearning:${this.nodeId}] REAL PyTorch local training complete!`);
      
      this.emit('training_complete', result);
      
      return result;
      
    } catch (err) {
      this.logger.error(`[FederatedLearning:${this.nodeId}] Real Training error: ${err.message}`);
      throw err;
    } finally {
      this.trainingInProgress = false;
    }
  }
  
  async _performLocalTraining(trainingData, config = {}) {
    // REAL local training: spawn the Python QLoRA/DPO pipeline
    // (scripts/finetune_gemma3.py), which trains a LoRA adapter on this node's
    // data and returns a machine-readable result (adapter path + real loss).
    // No fabricated metrics — a "model update" is a reference to a real adapter
    // on disk plus the trainer's genuine loss. config: { lobe, epochs, dpo,
    // model, dryRun, timeoutMs, python }.
    const repoRoot = path.resolve(__dirname, '..');
    const scriptPath = path.join(repoRoot, 'scripts', 'finetune_gemma3.py');
    const lobe = String(config.lobe || 'logos').toLowerCase();
    const epochs = Number.isFinite(config.epochs) ? config.epochs : 1;
    const resultFile = path.join(os.tmpdir(), `soma-train-${this.nodeId}-${Date.now()}.json`);
    const outputDir = path.join(repoRoot, 'SOMA', 'models', `lobe-${lobe}${config.dpo ? '-dpo' : ''}`);

    // Prefer the training venv (has torch/peft/trl), then SOMA_PYTHON, then PATH.
    let python = config.python || process.env.SOMA_PYTHON;
    if (!python) {
      const venv = process.platform === 'win32'
        ? path.join(repoRoot, '.soma_venv', 'Scripts', 'python.exe')
        : path.join(repoRoot, '.soma_venv', 'bin', 'python');
      python = fs.existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3');
    }

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`training script not found: ${scriptPath}`);
    }

    const args = [scriptPath, '--lobe', lobe, '--epochs', String(epochs), '--yes', '--json-result', resultFile];
    if (config.dpo) args.push('--dpo');
    if (config.model) args.push('--model', config.model);
    if (config.dataPath) args.push('--data-path', config.dataPath);
    if (Number.isFinite(config.maxSteps) && config.maxSteps > 0) args.push('--max-steps', String(config.maxSteps));
    if (config.dryRun) args.push('--dry-run');

    // Training can run for many minutes; the dry-run plumbing check is fast.
    const timeoutMs = config.timeoutMs || (config.dryRun ? 60 * 1000 : 90 * 60 * 1000);

    this.logger.info(`[FederatedLearning:${this.nodeId}] Spawning trainer: ${python} ${args.join(' ')}`);

    const result = await new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

      let child;
      const timer = setTimeout(() => {
        try { if (child) child.kill('SIGKILL'); } catch (_) {}
        finish(reject, new Error(`training timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      try {
        child = spawn(python, args, { cwd: repoRoot });
      } catch (e) {
        return finish(reject, new Error(`failed to spawn ${python}: ${e.message}`));
      }

      child.on('error', (err) => finish(reject, new Error(`failed to spawn ${python}: ${err.message}`)));
      child.stdout.on('data', (d) => {
        const s = d.toString();
        stdout += s;
        for (const line of s.split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith('__SOMA_TRAIN_RESULT__')) {
            this.logger.info(`[trainer:${lobe}] ${t.slice(0, 200)}`);
          }
        }
      });
      child.stderr.on('data', (d) => { stderr += d.toString(); });

      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) {
          return finish(reject, new Error(`trainer exited with code ${code}: ${(stderr.trim().slice(-500)) || 'no stderr'}`));
        }
        // Prefer the result file; fall back to the delimited stdout line.
        let raw = null;
        try {
          if (fs.existsSync(resultFile)) {
            raw = fs.readFileSync(resultFile, 'utf8');
          } else {
            const m = stdout.match(/__SOMA_TRAIN_RESULT__(\{.*\})\s*$/m) || stdout.match(/__SOMA_TRAIN_RESULT__(\{.*\})/);
            if (m) raw = m[1];
          }
        } catch (e) {
          return finish(reject, new Error(`could not read trainer result: ${e.message}`));
        } finally {
          try { if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile); } catch (_) {}
        }
        if (!raw) return finish(reject, new Error('trainer produced no result JSON'));
        try {
          finish(resolve, JSON.parse(raw));
        } catch (e) {
          finish(reject, new Error(`could not parse trainer result JSON: ${e.message}`));
        }
      });
    });

    if (!result || result.ok === false) {
      const why = (result && (result.message || result.error)) || JSON.stringify(result || {}).slice(0, 300);
      throw new Error(`trainer reported failure: ${why}`);
    }

    // REAL model update: a reference to the trained adapter on disk + real metrics.
    // No fabricated numbers — every field below comes from the trainer's own output.
    return {
      weightsPath: result.weights_path || result.output_dir || outputDir,
      adapterDir: result.output_dir || outputDir,
      lobe: result.lobe || lobe,
      mode: result.mode || (config.dpo ? 'dpo' : 'sft'),
      dryRun: !!result.dry_run,
      metadata: {
        epochs: result.epochs ?? epochs,
        examples: result.examples ?? (Array.isArray(trainingData) ? trainingData.length : 0),
        model: result.model,
        lobe: result.lobe || lobe,
      },
      metrics: {
        loss: result.train_loss ?? null,
        evalLoss: result.eval_loss ?? null,
        perplexity: result.perplexity ?? null,
        steps: result.steps ?? null,
      },
    };
  }
  
  async submitModelUpdate(coordinatorNode, modelUpdate) {
    this.logger.info(`[FederatedLearning:${this.nodeId}] Submitting model update to coordinator...`);
    
    const url = `http://${coordinatorNode.host}:${coordinatorNode.port}/federated/submit`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: this.nodeId,
          round: this.currentRound,
          modelUpdate,
          timestamp: Date.now()
        }),
        timeout: 15000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      this.logger.info(`[FederatedLearning:${this.nodeId}] Model update submitted successfully`);
      
      return result;
      
    } catch (err) {
      this.logger.error(`[FederatedLearning:${this.nodeId}] Failed to submit model: ${err.message}`);
      throw err;
    }
  }
  
  async fetchGlobalModel(coordinatorNode) {
    this.logger.info(`[FederatedLearning:${this.nodeId}] Fetching global model...`);
    
    const url = `http://${coordinatorNode.host}:${coordinatorNode.port}/federated/model`;
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        timeout: 10000
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      this.globalModel = data.model;
      this.currentRound = data.round;
      
      this.logger.info(`[FederatedLearning:${this.nodeId}] Global model fetched (round ${this.currentRound})`);
      
      return this.globalModel;
      
    } catch (err) {
      this.logger.error(`[FederatedLearning:${this.nodeId}] Failed to fetch global model: ${err.message}`);
      throw err;
    }
  }
  
  // === COORDINATOR METHODS ===
  
  async initiateRound(trainingConfig = {}) {
    if (this.role !== 'coordinator') {
      throw new Error('Only coordinator can initiate training rounds');
    }
    
    this.currentRound++;
    this.roundModels.clear();
    
    this.logger.info(`[FederatedLearning:${this.nodeId}] Initiating round ${this.currentRound}...`);
    
    const nodes = Array.from(this.clusterNode.knownNodes.values())
      .filter(n => n.role === 'worker');
    
    if (nodes.length < this.minParticipants) {
      throw new Error(`Not enough participants: ${nodes.length} < ${this.minParticipants}`);
    }
    
    // Broadcast training request
    const requests = nodes.map(node => 
      this._requestTraining(node, trainingConfig)
    );
    
    const results = await Promise.allSettled(requests);
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    
    this.logger.info(`[FederatedLearning:${this.nodeId}] Round ${this.currentRound}: ${successful}/${nodes.length} nodes responded`);
    
    return {
      round: this.currentRound,
      participatingNodes: successful,
      totalNodes: nodes.length
    };
  }
  
  async _requestTraining(node, config) {
    const url = `http://${node.host}:${node.port}/federated/train`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        round: this.currentRound,
        config,
        timestamp: Date.now()
      }),
      timeout: 10000
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  }
  
  receiveModelUpdate(nodeId, modelUpdate) {
    if (this.role !== 'coordinator') {
      throw new Error('Only coordinator can receive model updates');
    }
    
    this.logger.info(`[FederatedLearning:${this.nodeId}] Received model update from ${nodeId}`);
    
    this.roundModels.set(nodeId, modelUpdate);
    
    // Check if we have enough participants
    if (this.roundModels.size >= this.minParticipants) {
      this.logger.info(`[FederatedLearning:${this.nodeId}] Sufficient updates received, ready to aggregate`);
      this.emit('ready_to_aggregate', {
        round: this.currentRound,
        updates: this.roundModels.size
      });
    }
    
    return {
      success: true,
      round: this.currentRound,
      receivedUpdates: this.roundModels.size,
      requiredUpdates: this.minParticipants
    };
  }
  
  async aggregateModels(strategy = 'federated_averaging') {
    if (this.role !== 'coordinator') {
      throw new Error('Only coordinator can aggregate models');
    }
    
    if (this.roundModels.size < this.minParticipants) {
      throw new Error(`Not enough model updates: ${this.roundModels.size} < ${this.minParticipants}`);
    }
    
    this.logger.info(`[FederatedLearning:${this.nodeId}] Aggregating ${this.roundModels.size} models using ${strategy}...`);
    
    const aggregatedModel = await this._performAggregation(
      Array.from(this.roundModels.values()),
      strategy
    );
    
    this.globalModel = aggregatedModel;
    
    // Record history
    this.history.push({
      round: this.currentRound,
      participants: this.roundModels.size,
      timestamp: Date.now(),
      strategy,
      metrics: this._computeAggregateMetrics()
    });
    
    this.logger.info(`[FederatedLearning:${this.nodeId}] Aggregation complete for round ${this.currentRound}`);
    
    this.emit('aggregation_complete', {
      round: this.currentRound,
      model: this.globalModel
    });
    
    return this.globalModel;
  }
  
  async _performAggregation(modelUpdates, strategy) {
    // Real LoRA adapter updates carry a filesystem path, not numeric weight
    // arrays — they must be averaged tensor-for-tensor in Python (CPU), not here.
    // Scalar/array updates (tests, toy models) still use the JS averaging below.
    if (modelUpdates.some((u) => this._isAdapterUpdate(u))) {
      return await this._aggregateAdapters(modelUpdates, strategy);
    }
    switch (strategy) {
      case 'weighted_averaging':
        return this._weightedAveraging(modelUpdates);
      case 'federated_averaging':
      default:
        return this._federatedAveraging(modelUpdates);
    }
  }

  _isAdapterUpdate(u) {
    const upd = (u && u.updates) ? u.updates : u;
    return !!(upd && (upd.weightsPath || upd.adapterDir)) && !Array.isArray(upd && upd.weights);
  }

  _resolvePython(config = {}) {
    if (config.python) return config.python;
    if (process.env.SOMA_PYTHON) return process.env.SOMA_PYTHON;
    const repoRoot = path.resolve(__dirname, '..');
    const venv = process.platform === 'win32'
      ? path.join(repoRoot, '.soma_venv', 'Scripts', 'python.exe')
      : path.join(repoRoot, '.soma_venv', 'bin', 'python');
    return fs.existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3');
  }

  // Real cross-node FedAvg: average the participating LoRA adapters into one
  // global adapter via scripts/average_adapters.py (CPU/numpy, no GPU). Returns
  // a reference to the global adapter — never fabricated numbers.
  async _aggregateAdapters(modelUpdates, strategy = 'federated_averaging', config = {}) {
    const repoRoot = path.resolve(__dirname, '..');
    const script = path.join(repoRoot, 'scripts', 'average_adapters.py');
    if (!fs.existsSync(script)) {
      throw new Error(`adapter-averaging script not found: ${script}`);
    }

    const adapterDirs = modelUpdates
      .map((u) => { const upd = (u && u.updates) ? u.updates : u; return upd && (upd.adapterDir || upd.weightsPath); })
      .filter(Boolean);
    if (adapterDirs.length === 0) {
      throw new Error('no adapter paths in model updates to aggregate');
    }

    const outputDir = path.join(repoRoot, 'SOMA', 'models', `lobe-global-r${this.currentRound}`);
    const resultFile = path.join(os.tmpdir(), `soma-agg-${this.nodeId}-${Date.now()}.json`);
    const python = this._resolvePython(config);

    const args = [script, '--output', outputDir, '--json-result', resultFile];
    if (strategy === 'weighted_averaging') {
      const samples = modelUpdates.map((u) => (u && u.metrics && u.metrics.samplesProcessed)
        || (u && u.updates && u.updates.metadata && u.updates.metadata.examples) || 1);
      args.push('--weights', samples.join(','));
    }
    if (config.dryRun) args.push('--dry-run');
    args.push('--adapters', ...adapterDirs);

    const timeoutMs = config.timeoutMs || (config.dryRun ? 60 * 1000 : 15 * 60 * 1000);
    this.logger.info(`[FederatedLearning:${this.nodeId}] Averaging ${adapterDirs.length} adapters: ${python} ${args.join(' ')}`);

    const result = await this._runPythonJson({
      python, args, resultFile, timeoutMs,
      logTag: `adapter-avg`, delimiter: '__SOMA_AGG_RESULT__',
    });

    if (!result || result.ok === false) {
      const why = (result && (result.message || result.error)) || JSON.stringify(result || {}).slice(0, 300);
      throw new Error(`adapter averaging failed: ${why}`);
    }

    return {
      round: this.currentRound,
      participants: result.participants ?? adapterDirs.length,
      aggregationMethod: `adapter_fedavg_${strategy}`,
      globalAdapterDir: result.output_dir,
      weightsPath: result.weights_path || result.output_dir,
      tensorsAveraged: result.tensors ?? null,
      dryRun: !!result.dry_run,
    };
  }

  // Spawn a Python script that emits a result JSON (to resultFile and/or a
  // delimited stdout line) and resolve with the parsed object. Rejects on spawn
  // failure, non-zero exit, timeout, or unparseable output — never a fake result.
  _runPythonJson({ python, args, resultFile, timeoutMs, logTag, delimiter }) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;
      const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };
      let child;
      const timer = setTimeout(() => {
        try { if (child) child.kill('SIGKILL'); } catch (_) {}
        finish(reject, new Error(`${logTag} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      try {
        child = spawn(python, args, { cwd: path.resolve(__dirname, '..') });
      } catch (e) {
        return finish(reject, new Error(`failed to spawn ${python}: ${e.message}`));
      }
      child.on('error', (err) => finish(reject, new Error(`failed to spawn ${python}: ${err.message}`)));
      child.stdout.on('data', (d) => {
        const s = d.toString();
        stdout += s;
        for (const line of s.split('\n')) {
          const t = line.trim();
          if (t && !t.startsWith(delimiter)) this.logger.info(`[${logTag}] ${t.slice(0, 200)}`);
        }
      });
      child.stderr.on('data', (d) => { stderr += d.toString(); });
      child.on('close', (code) => {
        if (settled) return;
        if (code !== 0) return finish(reject, new Error(`${logTag} exited with code ${code}: ${(stderr.trim().slice(-500)) || 'no stderr'}`));
        let raw = null;
        try {
          if (resultFile && fs.existsSync(resultFile)) {
            raw = fs.readFileSync(resultFile, 'utf8');
          } else {
            const esc = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = stdout.match(new RegExp(esc + '(\\{.*\\})'));
            if (m) raw = m[1];
          }
        } catch (e) {
          return finish(reject, new Error(`could not read ${logTag} result: ${e.message}`));
        } finally {
          try { if (resultFile && fs.existsSync(resultFile)) fs.unlinkSync(resultFile); } catch (_) {}
        }
        if (!raw) return finish(reject, new Error(`${logTag} produced no result JSON`));
        try { finish(resolve, JSON.parse(raw)); }
        catch (e) { finish(reject, new Error(`could not parse ${logTag} result JSON: ${e.message}`)); }
      });
    });
  }
  
  _federatedAveraging(modelUpdates) {
    // Simple average of all model weights
    // In reality, this would operate on actual tensors/matrices
    
    const n = modelUpdates.length;
    
    return {
      weights: this._averageWeights(modelUpdates.map(m => m.updates.weights)),
      biases: this._averageBiases(modelUpdates.map(m => m.updates.biases)),
      round: this.currentRound,
      participants: n,
      aggregationMethod: 'federated_averaging'
    };
  }
  
  _weightedAveraging(modelUpdates) {
    // Weight by number of samples
    const totalSamples = modelUpdates.reduce((sum, m) => sum + (m.metrics?.samplesProcessed || 1), 0);
    
    // Similar to federated averaging but with sample weighting
    return {
      weights: this._weightedAverageWeights(modelUpdates, totalSamples),
      biases: this._weightedAverageBiases(modelUpdates, totalSamples),
      round: this.currentRound,
      participants: modelUpdates.length,
      aggregationMethod: 'weighted_averaging'
    };
  }
  
  _averageWeights(weightsList) {
    // PRODUCTION: Real federated averaging - element-wise mean of weight vectors
    if (!weightsList || weightsList.length === 0) return [];
    
    // Get dimension from first weights array
    const dim = weightsList[0].length;
    const averaged = Array(dim).fill(0);
    
    // Sum all weights element-wise
    for (const weights of weightsList) {
      if (!Array.isArray(weights) || weights.length !== dim) {
        throw new Error(`Weight dimension mismatch: expected ${dim}, got ${weights.length}`);
      }
      for (let i = 0; i < dim; i++) {
        averaged[i] += weights[i];
      }
    }
    
    // Divide by number of participants
    for (let i = 0; i < dim; i++) {
      averaged[i] /= weightsList.length;
    }
    
    return averaged;
  }
  
  _averageBiases(biasesList) {
    // PRODUCTION: Real federated averaging - element-wise mean of bias vectors
    if (!biasesList || biasesList.length === 0) return [];
    
    // Get dimension from first biases array
    const dim = biasesList[0].length;
    const averaged = Array(dim).fill(0);
    
    // Sum all biases element-wise
    for (const biases of biasesList) {
      if (!Array.isArray(biases) || biases.length !== dim) {
        throw new Error(`Bias dimension mismatch: expected ${dim}, got ${biases.length}`);
      }
      for (let i = 0; i < dim; i++) {
        averaged[i] += biases[i];
      }
    }
    
    // Divide by number of participants
    for (let i = 0; i < dim; i++) {
      averaged[i] /= biasesList.length;
    }
    
    return averaged;
  }
  
  _weightedAverageWeights(modelUpdates, totalSamples) {
    // PRODUCTION: Weighted averaging by sample count - higher sample weight gets more influence
    if (!modelUpdates || modelUpdates.length === 0) return [];
    if (totalSamples <= 0) return this._averageWeights(modelUpdates.map(m => m.updates.weights));
    
    const dim = modelUpdates[0].updates.weights.length;
    const weighted = Array(dim).fill(0);
    
    // Sum weights scaled by sample count
    for (const update of modelUpdates) {
      const weights = update.updates.weights;
      const samplesProcessed = update.metrics?.samplesProcessed || 1;
      const weight = samplesProcessed / totalSamples;
      
      if (!Array.isArray(weights) || weights.length !== dim) {
        throw new Error(`Weight dimension mismatch: expected ${dim}, got ${weights.length}`);
      }
      
      for (let i = 0; i < dim; i++) {
        weighted[i] += weights[i] * weight;
      }
    }
    
    return weighted;
  }
  
  _weightedAverageBiases(modelUpdates, totalSamples) {
    // PRODUCTION: Weighted averaging by sample count - higher sample weight gets more influence
    if (!modelUpdates || modelUpdates.length === 0) return [];
    if (totalSamples <= 0) return this._averageBiases(modelUpdates.map(m => m.updates.biases));
    
    const dim = modelUpdates[0].updates.biases.length;
    const weighted = Array(dim).fill(0);
    
    // Sum biases scaled by sample count
    for (const update of modelUpdates) {
      const biases = update.updates.biases;
      const samplesProcessed = update.metrics?.samplesProcessed || 1;
      const weight = samplesProcessed / totalSamples;
      
      if (!Array.isArray(biases) || biases.length !== dim) {
        throw new Error(`Bias dimension mismatch: expected ${dim}, got ${biases.length}`);
      }
      
      for (let i = 0; i < dim; i++) {
        weighted[i] += biases[i] * weight;
      }
    }
    
    return weighted;
  }
  
  _computeAggregateMetrics() {
    const updates = Array.from(this.roundModels.values());
    
    const avgLoss = updates.reduce((sum, u) => sum + (u.metrics?.loss || 0), 0) / updates.length;
    const avgAccuracy = updates.reduce((sum, u) => sum + (u.metrics?.accuracy || 0), 0) / updates.length;
    
    return {
      averageLoss: avgLoss,
      averageAccuracy: avgAccuracy,
      totalSamples: updates.reduce((sum, u) => sum + (u.metrics?.samplesProcessed || 0), 0)
    };
  }
  
  // === UTILITY METHODS ===

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  getStats() {
    return {
      nodeId: this.nodeId,
      role: this.role,
      currentRound: this.currentRound,
      trainingInProgress: this.trainingInProgress,
      hasGlobalModel: !!this.globalModel,
      hasLocalModel: !!this.localModel,
      receivedUpdates: this.roundModels.size,
      history: this.history
    };
  }
  
  getHistory() {
    return this.history;
  }
}

module.exports = { FederatedLearning };
