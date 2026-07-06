/**
 * TrainingDataExporter.js - Export SOMA's Knowledge for Fine-Tuning
 *
 * Collects and formats all of SOMA's data into training datasets:
 * - Conversation history
 * - Personality traits
 * - Episodic memories
 * - Meta-learning experiences
 * - User profiles and preferences
 *
 * Output: Gemma-compatible chat format
 * 
 * 🔴 NEMESIS INTEGRATION:
 * - All training examples reviewed for quality
 * - Low-quality examples filtered out
 * - Bad examples logged to graveyard (learn what NOT to do)
 */

import { EventEmitter } from 'events';
 import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  normalizeTrainingProvenance,
  trainingExampleFingerprint,
  validateTrainingExample
} from '../core/TrainingDataPolicy.js';
const require = createRequire(import.meta.url);

// Import NEMESIS (hybrid review system)
let NemesisReviewSystem;
try {
  const { NemesisReviewSystem: NRS } = await import('../cognitive/prometheus/NemesisReviewSystem.js');
  NemesisReviewSystem = NRS;
} catch (err) {
  console.warn('[TrainingDataExporter] ⚠️  NEMESIS not available - quality filtering disabled');
}

export class TrainingDataExporter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'TrainingDataExporter';
    this.lobe = 'PROMETHEUS'; // Neural index: strategy/planning lobe
    this.tier = 'operational';

    // Connected systems
    this.conversationHistory = null;
    this.personalityForge = null;
    this.userProfile = null;
    this.mnemonic = null;
    this.learningPipeline = null;
    this.metaLearning = null;
    this.causality = null;
    
    // Export configuration
    this.outputDir = config.outputDir || path.join(process.cwd(), 'SOMA', 'training-data');
    this.format = config.format || 'gemma'; // gemma, alpaca, sharegpt
    this.graveyardDir = path.join(this.outputDir, 'graveyard'); // Bad examples
    
    // 🔴 NEMESIS Quality Gate
    this.nemesisReview = null;
    if (NemesisReviewSystem) {
      this.nemesisReview = new NemesisReviewSystem({
        minFriction: 0.25,  // Training data needs some grounding
        maxChargeWithoutFriction: 0.75,  // Not too fantastical
        minValueDensity: 0.15,  // Must have some useful content
        promotionScore: 0.7  // Lower bar than code (allow learning from mistakes)
      });
      console.log(`[${this.name}] 🔴 NEMESIS quality filtering ACTIVE`);
    }
    
    // Quality stats
    this.qualityStats = {
      totalReviewed: 0,
      passed: 0,
      failed: 0,
      uncertain: 0,
      sentToGraveyard: 0
    };
    
    console.log(`[${this.name}] 📤 Training Data Exporter initialized`);
  }

  async initialize(arbiters = {}) {
    console.log(`[${this.name}] 🌱 Initializing data export system...`);

    // Connect to arbiters
    this.conversationHistory = arbiters.conversationHistory || null;
    this.personalityForge = arbiters.personalityForge || null;
    this.userProfile = arbiters.userProfile || null;
    this.mnemonic = arbiters.mnemonic || null;
    this.learningPipeline = arbiters.learningPipeline || null;
    this.metaLearning = arbiters.metaLearning || null;
    this.causality = arbiters.causalityArbiter || arbiters.causality || null;

    // Ensure output directories exist
    await fs.mkdir(this.outputDir, { recursive: true });
    await fs.mkdir(this.graveyardDir, { recursive: true });

    console.log(`[${this.name}] ✅ Data export system ready`);
    console.log(`[${this.name}]    Output: ${this.outputDir}`);
    console.log(`[${this.name}]    Graveyard: ${this.graveyardDir}`);
    
    if (this.nemesisReview) {
      console.log(`[${this.name}]    NEMESIS quality filtering: ENABLED`);
    }

    this.emit('initialized');
  }

  /**
   * Export all SOMA data for training
   */
  async exportAll(options = {}) {
    console.log(`\n[${this.name}] 🚀 Exporting ALL training data...`);

    const timestamp = Date.now();
    const exports = {};

    try {
      // 1. Export conversations
      if (this.conversationHistory) {
        console.log(`[${this.name}] 💬 Exporting conversations...`);
        exports.conversations = await this.exportConversations();
        console.log(`[${this.name}]    ✅ ${exports.conversations.count} conversations`);
      }

      // 2. Export personality
      if (this.personalityForge) {
        console.log(`[${this.name}] 🎭 Exporting personality...`);
        exports.personality = await this.exportPersonality();
        console.log(`[${this.name}]    ✅ Personality exported`);
      }

      // 3. Export memories
      if (this.mnemonic) {
        console.log(`[${this.name}] 🧠 Exporting memories...`);
        exports.memories = await this.exportMemories();
        console.log(`[${this.name}]    ✅ ${exports.memories.count} memories`);
      }

      // 4. Export experiences
      if (this.learningPipeline) {
        console.log(`[${this.name}] 📚 Exporting experiences...`);
        exports.experiences = await this.exportExperiences();
        console.log(`[${this.name}]    ✅ ${exports.experiences.count} experiences`);
      }

      // 4.5. Export causal chains (The Wisdom Layer)
      if (this.causality) {
        console.log(`[${this.name}] 🔗 Exporting causal wisdom...`);
        exports.causalChains = await this.exportCausalChains();
        console.log(`[${this.name}]    ✅ ${exports.causalChains.count} causal insights`);
      }

      // 5. Export Nemesis revision pairs (premium: bad→good with critique)
      const revisionPairs = await this.exportRevisionPairs();
      if (revisionPairs.count > 0) {
        console.log(`[${this.name}] 🔴 ${revisionPairs.count} Nemesis revision pairs (premium training data)`);
        exports.revisionPairs = revisionPairs;
      }

      // 6. Merge into final training dataset
      console.log(`[${this.name}] 🔗 Merging into training format...`);
      const dataset = await this.mergeIntoTrainingFormat(exports);

      if (dataset.length === 0) throw new Error('No verified training examples passed the export policy');

      // 6. Save final dataset
      const outputPath = path.join(this.outputDir, `soma-training-${timestamp}.jsonl`);
      await this.saveDataset(dataset, outputPath);

      const dpoPath = await this.saveDpoDataset(revisionPairs.dpoPairs || [], timestamp);

      console.log(`\n[${this.name}] ✅ Export complete!`);
      console.log(`[${this.name}]    Total examples: ${dataset.length}`);
      console.log(`[${this.name}]    File: ${outputPath}`);

      this.emit('export_complete', { dataset, outputPath });

      return {
        success: true,
        datasetPath: outputPath,
        exampleCount: dataset.length,
        exports,
        dpoPath
      };
    } catch (error) {
      console.error(`[${this.name}] ❌ Export failed:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Export conversations in training format
   */
  async exportConversations() {
    const sessions = this.conversationHistory.getAllSessions(1000);
    const examples = [];

    for (const session of sessions) {
      const messages = this.conversationHistory.getSessionMessages(session.id);
      
      if (messages.length < 2) continue; // Need at least one exchange

      // Group into conversation turns and review with NEMESIS
      for (let i = 0; i < messages.length - 1; i++) {
        if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
          const example = {
            instruction: messages[i].content,
            response: messages[i + 1].content,
            metadata: {
              session_id: session.id,
              timestamp: messages[i].timestamp,
              source: 'conversation',
              actualProvider: messages[i + 1].metadata?.actualProvider || messages[i + 1].metadata?.provider,
              actualModel: messages[i + 1].metadata?.actualModel || messages[i + 1].metadata?.model,
              ...messages[i + 1].metadata
            }
          };
          
          // 🔴 NEMESIS Quality Filter
          if (this.nemesisReview) {
            const passed = await this._reviewExample(example, 'conversation');
            if (passed) {
              example.metadata.qualityTier = 'reviewed';
              example.metadata.nemesisPassed = true;
              examples.push(example);
            }
          } else {
            examples.push(example);
          }
        }
      }
    }

    console.log(`[${this.name}]    Quality filter: ${examples.length}/${this.qualityStats.totalReviewed} passed`);
    return { count: examples.length, examples };
  }

  /**
   * Export personality as system prompts
   */
  async exportPersonality() {
    const stats = this.personalityForge.getStats();
    const systemPrompt = this.personalityForge.generatePersonalityPrompt();

    return {
      systemPrompt,
      dimensions: stats.personalityDimensions,
      traits: stats.traits
    };
  }

  /**
   * Export episodic memories
   */
  async exportMemories() {
    // This would integrate with MnemonicArbiter
    // For now, return placeholder
    return { count: 0, examples: [] };
  }

  /**
   * Export learning experiences
   */
  async exportExperiences() {
    if (!this.learningPipeline?.experienceBuffer) {
      return { count: 0, examples: [] };
    }

    const experiences = this._readExperienceBuffer(this.learningPipeline.experienceBuffer);
    const examples = [];

    for (const exp of experiences) {
      if (exp.action && exp.outcome && exp.reward > 0.5) {
        const example = {
          instruction: exp.state?.query || exp.action,
          response: exp.outcome?.result || exp.outcome,
          metadata: {
            reward: exp.reward,
            timestamp: exp.timestamp,
            source: 'experience',
            qualityTier: exp.metadata?.qualityTier || (exp.metadata?.verified ? 'verified' : 'unverified'),
            evidenceId: exp.metadata?.evidenceId || exp.metadata?.artifactId || null,
            actualProvider: exp.metadata?.actualProvider || exp.metadata?.provider,
            actualModel: exp.metadata?.actualModel || exp.metadata?.model,
            lobe: exp.metadata?.lobe || exp.metadata?.brain
          }
        };
        
        // 🔴 NEMESIS Quality Filter
        if (this.nemesisReview) {
          const passed = await this._reviewExample(example, 'experience');
          if (passed) {
              example.metadata.nemesisPassed = true;
              examples.push(example);
          }
        } else {
          examples.push(example);
        }
      }
    }

    console.log(`[${this.name}]    Quality filter: ${examples.length}/${this.qualityStats.totalReviewed} passed`);
    return { count: examples.length, examples };
  }

  _readExperienceBuffer(buffer) {
    if (!buffer) return [];
    if (typeof buffer.getAllExperiences === 'function') return buffer.getAllExperiences() || [];
    if (typeof buffer.getAll === 'function') return buffer.getAll() || [];
    if (typeof buffer.toArray === 'function') return buffer.toArray() || [];
    if (Array.isArray(buffer.experiences)) return [...buffer.experiences];
    return [];
  }

  /**
   * Export causal chains as high-order reasoning examples
   */
  async exportCausalChains() {
    if (!this.causality) return { count: 0, examples: [] };

    const graph = this.causality.exportGraph ? this.causality.exportGraph() : { nodes: [], edges: [] };
    const examples = [];
    const dpoPairs = [];

    // Convert causal links into "If X then Y" reasoning examples
    for (const edge of graph.edges || []) {
      if (edge.strength > 0.6) { // Only high-confidence causality
        const example = {
          instruction: `Explain the causal relationship starting from: ${edge.from}`,
          response: `Based on temporal observations, ${edge.from} likely leads to ${edge.to}. The established confidence in this causal link is ${(edge.strength * 100).toFixed(1)}%.`,
          metadata: {
            type: 'causal_reasoning',
            strength: edge.strength,
            is_wisdom: true
          }
        };
        
        // Causal reasoning is high-value, we bypass NEMESIS for these structural truths
        // or we could review them too. Let's review them for linguistic quality.
        if (this.nemesisReview) {
          const passed = await this._reviewExample(example, 'causality');
          if (passed) examples.push(example);
        } else {
          examples.push(example);
        }
      }
    }

    return { count: examples.length, examples };
  }

  /**
   * Export Nemesis revision pairs — the highest-quality training data SOMA generates.
   * Each pair is: (question, bad response that failed Nemesis, critique, corrected response).
   * Format: Two complementary examples —
   *   1. A "what not to do" example with critique (negative reinforcement)
   *   2. The corrected response as a positive example
   *
   * This is DPO-adjacent training: model learns BOTH what's wrong AND what's right.
   */
  async exportRevisionPairs() {
    // Pull pairs from NemesisReviewSystem's SQLite DB via system reference
    let pairs = [];
    try {
      // Try to get nemesis from the module-level singleton or system
      const { NemesisReviewSystem } = await import('../cognitive/prometheus/NemesisReviewSystem.js');
      // Use a lightweight reader instance just to access the DB
      const reader = new NemesisReviewSystem();
      pairs = reader.getRevisionPairs(200);
    } catch {
      return { count: 0, examples: [] };
    }

    if (!pairs.length) return { count: 0, examples: [] };

    const examples = [];
    for (const pair of pairs) {
      if (!pair.query || !pair.good_response) continue;

      // Positive example: the corrected response (what to do)
      examples.push({
        instruction: pair.query,
        response: pair.good_response,
        metadata: {
          type: 'nemesis_corrected',
          source: 'nemesis_revision',
          qualityTier: 'nemesis_corrected',
          is_revision: true,
          score_before: pair.score_before,
          critique: pair.critique
        }
      });
      if (pair.bad_response) {
        dpoPairs.push({
          prompt: pair.query,
          chosen: pair.good_response,
          rejected: pair.bad_response,
          metadata: {
            source: 'nemesis_revision',
            qualityTier: 'nemesis_corrected',
            scoreBefore: pair.score_before,
            critique: pair.critique || null
          }
        });
      }

      // Negative signal: include critique as a chain-of-thought commentary
      // Format: critique explains WHY the bad response failed → model learns the reasoning
      if (pair.critique && pair.bad_response) {
        examples.push({
          instruction: `[Self-critique] Why was this response inadequate?\nQuestion: ${pair.query}\nResponse: ${pair.bad_response.substring(0, 400)}`,
          response: `Quality issue identified: ${pair.critique}. A better response would: ${pair.good_response.substring(0, 400)}`,
          metadata: {
            type: 'nemesis_critique',
            is_self_correction: true
          }
        });
      }
    }

    return { count: examples.length, examples, dpoPairs, pairsProcessed: pairs.length };
  }

  /**
   * Merge all data into training format
   */
  async mergeIntoTrainingFormat(exports) {
    const dataset = [];
    const personality = exports.personality;

    // Add conversation examples
    if (exports.conversations) {
      for (const ex of exports.conversations.examples) {
        dataset.push(this.formatExample(
          ex.instruction,
          ex.response,
          personality?.systemPrompt,
          ex.metadata
        ));
      }
    }

    // Add experience examples
    if (exports.experiences) {
      for (const ex of exports.experiences.examples) {
        dataset.push(this.formatExample(
          ex.instruction,
          ex.response,
          personality?.systemPrompt,
          ex.metadata
        ));
      }
    }

    // Add causal wisdom
    if (exports.causalChains) {
      for (const ex of exports.causalChains.examples) {
        dataset.push(this.formatExample(
          ex.instruction,
          ex.response,
          personality?.systemPrompt,
          ex.metadata
        ));
      }
    }

    // Add Nemesis revision pairs (highest priority — prepend so they appear first in JSONL)
    // These are the most signal-dense examples: SOMA already knows these responses needed fixing.
    if (exports.revisionPairs) {
      const revisionExamples = [];
      for (const ex of exports.revisionPairs.examples) {
        revisionExamples.push(this.formatExample(
          ex.instruction,
          ex.response,
          personality?.systemPrompt,
          ex.metadata
        ));
      }
      // Prepend — Ollama loads the first N examples, so revision pairs train first
      dataset.unshift(...revisionExamples);
    }

    // Deduplicate and shuffle
    const policyAccepted = [];
    for (const item of dataset) {
      const user = item.messages?.find(message => message.role === 'user')?.content || item.instruction || item.input;
      const assistant = item.messages?.find(message => message.role === 'assistant')?.content || item.response || item.output;
      const policy = validateTrainingExample({ instruction: user, response: assistant, metadata: item.metadata });
      if (!policy.accepted) {
        this.qualityStats.failed++;
        continue;
      }
      item.metadata = policy.metadata;
      policyAccepted.push(item);
    }
    const uniqueDataset = this.deduplicateDataset(policyAccepted);
    return this.shuffleDataset(uniqueDataset);
  }

  /**
   * Format example based on target format (Gemma, Alpaca, etc.)
   */
  formatExample(instruction, response, systemPrompt, metadata = {}) {
    const provenance = normalizeTrainingProvenance(metadata, { instruction, response });
    if (this.format === 'gemma') {
      // Gemma chat format
      return {
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: instruction },
          { role: 'assistant', content: response }
        ],
        metadata: provenance
      };
    } else if (this.format === 'alpaca') {
      // Alpaca format
      return {
        instruction: systemPrompt || '',
        input: instruction,
        output: response,
        metadata: provenance
      };
    } else if (this.format === 'sharegpt') {
      // ShareGPT format
      return {
        conversations: [
          { from: 'human', value: instruction },
          { from: 'gpt', value: response }
        ],
        system: systemPrompt || '',
        metadata: provenance
      };
    }

    return { instruction, response, system: systemPrompt, metadata: provenance };
  }

  /**
   * Deduplicate dataset
   */
  deduplicateDataset(dataset) {
    const seen = new Set();
    const unique = [];

    for (const item of dataset) {
      const instruction = item.messages?.find(message => message.role === 'user')?.content || item.instruction || item.input;
      const response = item.messages?.find(message => message.role === 'assistant')?.content || item.response || item.output;
      const key = trainingExampleFingerprint(instruction, response);

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(item);
      }
    }

    return unique;
  }

  /**
   * Shuffle dataset
   */
  shuffleDataset(dataset) {
    const shuffled = [...dataset];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Save dataset to file (JSONL format)
   */
  async saveDataset(dataset, outputPath) {
    const jsonl = dataset.map(item => JSON.stringify(item)).join('\n');
    await fs.writeFile(outputPath, jsonl, 'utf8');
    const manifest = {
      schemaVersion: 1,
      datasetPath: outputPath,
      count: dataset.length,
      createdAt: new Date().toISOString(),
      sources: {},
      providers: {},
      lobes: {}
    };
    for (const item of dataset) {
      const metadata = item.metadata || {};
      for (const [bucket, key] of [[manifest.sources, metadata.source], [manifest.providers, metadata.provider], [manifest.lobes, metadata.lobe]]) {
        const value = key || 'unknown';
        bucket[value] = (bucket[value] || 0) + 1;
      }
    }
    await fs.writeFile(`${outputPath}.manifest.json`, JSON.stringify(manifest, null, 2), 'utf8');
  }

  async saveDpoDataset(pairs, timestamp = Date.now()) {
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    const dpoDir = path.join(this.outputDir, 'dpo');
    await fs.mkdir(dpoDir, { recursive: true });
    const outputPath = path.join(dpoDir, `revision-pairs-${timestamp}.jsonl`);
    await fs.writeFile(outputPath, pairs.map(pair => JSON.stringify(pair)).join('\n'), 'utf8');
    return outputPath;
  }

  /**
   * 🔴 NEMESIS: Review a training example for quality
   */
  async _reviewExample(example, source) {
    this.qualityStats.totalReviewed++;
    
    const review = await this.nemesisReview.evaluateResponse(
      'TRAINING',  // Pseudo-brain name
      example.instruction,
      { text: example.response, confidence: example.metadata?.reward || 0.5 },
      null  // No Gemini callback (numeric only for training data)
    );
    
    if (!review.needsRevision) {
      // Passed quality check
      this.qualityStats.passed++;
      return true;
    } else {
      // Failed - send to graveyard
      this.qualityStats.failed++;
      await this._sendToGraveyard(example, review, source);
      return false;
    }
  }
  
  /**
   * 🔴 NEMESIS: Log bad examples to graveyard
   */
  async _sendToGraveyard(example, review, source) {
    this.qualityStats.sentToGraveyard++;
    
    const graveyardEntry = {
      example,
      source,
      review: {
        score: review.score,
        fate: review.fate,
        reason: review.reason,
        stage: review.stage
      },
      timestamp: Date.now()
    };
    
    try {
      const graveyardPath = path.join(this.graveyardDir, `bad-examples-${Date.now()}.json`);
      await fs.writeFile(graveyardPath, JSON.stringify(graveyardEntry, null, 2), 'utf8');
    } catch (err) {
      console.error(`[${this.name}]    ⚠️  Failed to save to graveyard: ${err.message}`);
    }
  }
  
  /**
   * Get export statistics
   */
  getStats() {
    return {
      outputDir: this.outputDir,
      format: this.format,
      connected: {
        conversations: !!this.conversationHistory,
        personality: !!this.personalityForge,
        memories: !!this.mnemonic,
        experiences: !!this.learningPipeline
      },
      quality: this.qualityStats,
      nemesisEnabled: !!this.nemesisReview
    };
  }
}

export default TrainingDataExporter;
