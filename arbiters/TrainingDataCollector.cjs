const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const fs = require('fs').promises;
const path = require('path');

/**
 * TrainingDataCollector
 * 
 * Captures comprehensive interaction data for self-training.
 * Feeds into MetaLearningArbiter and ExperienceReplayBuffer. 
 * 
 * Part of the SOMA Self-Training Loop.
 */
class TrainingDataCollector extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: 'TrainingDataCollector',
      role: 'training-collector',
      capabilities: ['collect-training-data', 'export-datasets'],
      ...config
    });
    
    this.metaLearning = config.metaLearning;
    this.resourceBudget = config.resourceBudget;
    this.noveltyTracker = config.noveltyTracker;
    this.experienceBuffer = config.experienceBuffer;

    this.buffer = [];
    this.autoExportThreshold = config.autoExportThreshold || 100; // Export every 100 interactions
    this.exportPath = config.exportPath || path.join(process.cwd(), '.soma', 'training_buffer.jsonl');
  }

  async initialize() {
    await super.initialize(); // Registers with Broker
    
    this.logger.info('[TrainingDataCollector] Initializing...');
    
    // Ensure export directory exists
    try {
      await fs.mkdir(path.dirname(this.exportPath), { recursive: true });
    } catch (e) {
      // Ignore if exists
    }
    
    // Subscribe to events that should trigger data collection
    this.subscribe('system/interaction_complete', this.handleInteraction.bind(this));
    this.subscribe('soma.goal.completed', this.handleGoalCompleted.bind(this));
  }

  async handleGoalCompleted(message) {
    const goal = message.payload?.goal;
    if (!goal) return;

    const interaction = {
      input: `Goal: ${goal.title}\nDescription: ${goal.description}`,
      output: goal.metadata?.completionResult?.summary || goal.metadata?.completionResult?.result || goal.metadata?.learningLesson?.outcome || 'Goal completed successfully.',
      context: { category: goal.category, title: goal.title, tasks: goal.tasks },
      brain: 'AgenticExecutor',
      type: 'goal_completion'
    };

    await this.captureInteraction(interaction);
  }

  async handleMessage(message) {
    if (message.type === 'capture_interaction') {
      return await this.captureInteraction(message.payload);
    }
    return super.handleMessage(message);
  }

  async handleInteraction(message) {
    if (message.payload) {
      await this.captureInteraction(message.payload);
    }
  }

  async captureInteraction(interaction) {
    // 0. NEMESIS AUDIT (Adversarial Validation) - NEW
    // Prevents learning from subtle errors or hallucinations
    const passesAudit = await this._auditWithNemesis(interaction);
    if (!passesAudit) {
        this.logger.warn(`[TrainingDataCollector] ⚠️ Interaction REJECTED by Nemesis Audit. Potential hallucination detected.`);
        return { success: false, reason: 'nemesis_audit_failed' };
    }

    // 1. Add rich metadata
    const enriched = {
      ...interaction,
      timestamp: Date.now(),
      noveltyScore: this.noveltyTracker ? await this.noveltyTracker.evaluateNovelty({
          solution: interaction.output || interaction.response || interaction.result || 'no_output',
          context: interaction.context || {}
      }) : 0.5,
      resourceCost: this.resourceBudget ? (this.resourceBudget.getResourceStatus?.()?.budgets?.apiCalls?.used || 0) : 0,
      brain: interaction.brain || 'unknown',
      confidence: interaction.confidence || 0.5,
      tokenCount: interaction.tokenCount || 0,
      latencyMs: interaction.latencyMs || 0
    };

    // 2. Add to local buffer
    this.buffer.push(enriched);

    // 3. Add to ExperienceReplayBuffer (for immediate replay)
    if (this.experienceBuffer) {
      await this.experienceBuffer.addExperience({
        state: { context: enriched.context || interaction.context },
        action: enriched.input || interaction.input || interaction.query,
        agent: enriched.brain || interaction.brain,
        outcome: enriched.output || interaction.output || interaction.response,
        reward: this._calculateReward(enriched),
        metadata: enriched
      });
    }

    // 4. Send to MetaLearningArbiter/Engine (for curriculum/few-shot processing)
    if (this.metaLearning) {
      if (typeof this.metaLearning.processExperience === 'function') {
        await this.metaLearning.processExperience(enriched);
      } else if (typeof this.metaLearning.updateFromExperience === 'function') {
        await this.metaLearning.updateFromExperience(enriched);
      }
    }

    this.emit('interaction_captured', enriched);

    // 5. Auto-export if threshold reached
    if (this.buffer.length >= this.autoExportThreshold) {
      await this.exportAndClear();
    }
    
    return { success: true, id: enriched.timestamp };
  }

  /**
   * Adversarial Audit: Ask THALAMUS to break the logic
   */
  async _auditWithNemesis(interaction) {
    if (!this.messageBroker) return true; // Fail open if no broker

    const query = interaction.input || interaction.query || '';
    const response = interaction.output || interaction.response || '';

    // Don't audit trivial interactions
    if (query.length < 10 || response.length < 10) return true;

    const auditPrompt = `You are NEMESIS, the Adversarial Logic Auditor.
    
    TASK:
    Analyze this interaction for subtle logic errors, hallucinations, or technical inaccuracies.
    Your goal is to REJECT this data if it isn't 100% accurate.
    
    USER QUERY: "${query}"
    SYSTEM RESPONSE: "${response}"
    
    If the response is correct and high-quality, output: PASS
    If you find any error, output: FAIL [reason]
    
    DECISION:`;

    try {
        const result = await this.messageBroker.request('QuadBrain', {
            type: 'reason',
            payload: {
                query: auditPrompt,
                context: { 
                    brain: 'THALAMUS', // Force the Judge
                    temperature: 0.1, 
                    quickResponse: true 
                }
            }
        });

        const decision = (result?.payload?.text || result?.text || '').trim();
        return decision.toUpperCase().startsWith('PASS');
    } catch (e) {
        this.logger.error(`[NemesisAudit] Failed to query brain: ${e.message}`);
        return true; // Fail open
    }
  }

  _calculateReward(interaction) {
    // Reward = novelty * confidence * (1 - error_rate)
    const novelty = interaction.noveltyScore || 0.5;
    const confidence = interaction.confidence || 0.5;
    const errorRate = interaction.error ? 1.0 : 0.0;
    
    // Simple heuristic reward function
    return novelty * confidence * (1 - errorRate);
  }

  getStats() {
    return this.getMetrics();
  }

  async exportAndClear() {
    if (this.buffer.length === 0) return;

    this.logger.info(`[TrainingDataCollector] Exporting ${this.buffer.length} interactions...`);

    try {
      // Append to JSONL file
      const jsonl = this.buffer.map(item => JSON.stringify(item)).join('\n') + '\n';
      await fs.appendFile(this.exportPath, jsonl, 'utf8');
      
      this.logger.info(`[TrainingDataCollector] ✅ Exported to ${this.exportPath}`);
      
      // Clear buffer
      this.buffer = [];
    } catch (error) {
      this.logger.error(`[TrainingDataCollector] ❌ Export failed: ${error.message}`);
    }
  }
}

// Named export for older .cjs loaders
module.exports = TrainingDataCollector;
// Also provide named export for ESM interop if needed
module.exports.TrainingDataCollector = TrainingDataCollector;