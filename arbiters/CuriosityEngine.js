/**
 * CuriosityEngine.js - Intrinsic Motivation & Autonomous Exploration
 *
 * The Curiosity Engine drives SOMA's intrinsic motivation to learn and explore.
 * Instead of only responding to user queries, SOMA actively seeks knowledge,
 * asks questions, and explores new domains.
 *
 * This is critical for ASI because true intelligence requires:
 * - Intrinsic motivation (learning for its own sake)
 * - Autonomous exploration (not just reactive)
 * - Self-directed improvement (setting own goals)
 *
 * Curiosity Mechanisms:
 * 1. Knowledge Gap Detection: Identify what SOMA doesn't know
 * 2. Question Generation: Generate interesting questions to explore
 * 3. Novelty Seeking: Prefer exploring new/unknown domains
 * 4. Usefulness Estimation: Prioritize useful knowledge
 * 5. What-If Scenarios: Explore counterfactuals and possibilities
 * 6. Meta-Curiosity: Be curious about curiosity itself
 *
 * Examples of Curious Behaviors:
 * - "I've never learned about quantum computing - I should explore that"
 * - "I notice I'm weak at image understanding - I want to improve"
 * - "What if I combined my medical knowledge with my code analysis? Could I debug biological systems?"
 * - "I wonder why users often ask about X but never about Y"
 * - "I should test whether my legal fragment can help with medical ethics"
 */

import { EventEmitter } from 'events';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
const _require = createRequire(import.meta.url);
const _workLedger = _require('../core/AutonomousWorkLedger.cjs');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

// Maps curiosity gap domains → which lobe's training data to hunt
const DOMAIN_LOBE_MAP = {
  agent_architecture: 'logos', llm_engineering: 'logos', nodejs_backend: 'logos',
  react_frontend: 'logos', web_scraping: 'logos', real_time_systems: 'logos',
  reasoning_engines: 'logos', signal_routing: 'logos', prompt_engineering: 'logos',
  creative_writing: 'aurora', social_media_strategy: 'aurora', content_creation: 'aurora',
  digital_identity: 'aurora',
  financial_markets: 'prometheus', trading_algorithms: 'prometheus',
  self_improvement_loops: 'prometheus',
  cognitive_architecture: 'thalamus', memory_systems: 'thalamus',
  knowledge_representation: 'thalamus',
};

const HUNT_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h per lobe

export class CuriosityEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'CuriosityEngine';
    this.lobe = 'AURORA'; // Neural index: creative/emotional lobe
    this.tier = 'cognitive';

    // Dependencies
    this.selfModel = opts.selfModel;
    this.knowledgeGraph = opts.knowledgeGraph;
    this.fragmentRegistry = opts.fragmentRegistry;
    this.learningPipeline = opts.learningPipeline;
    this.messageBroker = opts.messageBroker;
    this.simulationArbiter = opts.simulationArbiter; // 🎮 Physics Engine Link
    this.worldModel = opts.worldModel; // 🌍 World Model for Epistemic Curiosity
    this.brain        = opts.brain        || null;
    this.webResearcher= opts.webResearcher|| null;
    this.workingMemory= opts.workingMemory|| null;  // WorkingMemory — present-tense state
    this.synthesizer  = opts.synthesizer  || null;  // ExpertiseSynthesizer — crystallise deep curiosity into packs
    this._toolRegistry = opts.toolRegistry || null; // ToolRegistry for free web_search / research_web
    this._braveSearch  = opts.braveSearch  || null; // BraveSearch fallback (quota-limited)

    // Curiosity state
    this.curiosityQueue = []; // Questions/explorations to pursue
    this.explorationHistory = new Map(); // topic -> times explored
    this.knowledgeGaps = new Map(); // gap -> priority
    this.interestingPatterns = new Map(); // pattern -> interestingness score
    // Outcome tracking: domain -> { valuable, shallow } counts for the current session.
    // Used by detectKnowledgeGaps() to avoid re-queueing domains that consistently yield nothing.
    this._topicOutcomes = new Map();

    // Motivation metrics
    this.motivation = {
      currentCuriosity: 0.5, // 0-1 scale
      explorationDrive: 0.7,
      learningHunger: 0.6,
      creativityUrge: 0.5,
      improvementDesire: 0.8
    };

    // Exploration preferences (learned over time)
    this.preferences = {
      noveltyWeight: 0.6, // How much to prefer novel topics
      usefulnessWeight: 0.7, // How much to prefer useful knowledge
      difficultyPreference: 0.5, // 0 = easy, 1 = hard challenges
      breadthVsDepth: 0.5 // 0 = depth, 1 = breadth
    };

    // Stats
    this.stats = {
      questionsGenerated: 0,
      explorationsStarted: 0,
      explorationsCompleted: 0,
      knowledgeGapsIdentified: 0,
      selfImprovementGoals: 0,
      autonomousLearnings: 0,
      autonomousTrainings: 0,  // 🎓 New: Training sessions triggered by curiosity
      creativeCombinations: 0,
      physicalSteps: 0
    };

    this.lastPhysicalAction = null;
    this.lastPhysicalState = null;

    // Configuration
    this.config = {
      minCuriosityThreshold: opts.minCuriosityThreshold || 0.3,
      maxQueueSize: opts.maxQueueSize || 100,
      explorationInterval: opts.explorationInterval || 60000,
      physicsInterval: 200, // 5Hz Control Loop
      gapDetectionInterval: opts.gapDetectionInterval || 300000
    };

    // Persistence
    this._dataDir = path.join(process.cwd(), 'data');
    this._persistPath = path.join(this._dataDir, 'curiosity-state.json');
    this._dirty = false;
    this._autoSaveInterval = null;

    // Dataset hunting state
    this._lastHuntTime = {}; // lobe → timestamp of last hunt
    this._runningHunts = new Set(); // lobes currently being hunted

    console.log(`[${this.name}] Initialized - SOMA is now curious!`);
  }

  /**
   * Initialize curiosity engine
   */
  async initialize() {
    console.log(`[${this.name}] 🔍 Initializing Curiosity Engine...`);

    // Restore persisted state first
    this._loadFromDisk();

    // Identify initial knowledge gaps (merges with restored)
    await this.detectKnowledgeGaps();

    // Generate initial questions (only if queue is empty after restore)
    if (this.curiosityQueue.length === 0) {
      await this.generateCuriousQuestions(5);
    }

    // Subscribe to events
    if (this.messageBroker) {
      // Lobe-scoped: curiosity:stimulate only fires when sourced within AURORA
      this.messageBroker.subscribeByLobe('AURORA', 'curiosity:stimulate', this._handleCuriosityStimulation.bind(this));
      // Cross-lobe: learning and focus signals arrive from any lobe
      this.messageBroker.subscribe('learning:completed', this._handleLearningCompletion.bind(this));
      this.messageBroker.subscribe('system.focus.shifted', this._handleFocusShift.bind(this));
      console.log(`[${this.name}]    Subscribed to MessageBroker events`);
    }

    // Subscribe to Physical Events
    if (this.simulationArbiter) {
        this.simulationArbiter.on('task_complete', (data) => this._handlePhysicalWin(data));
        this.simulationArbiter.on('sensation:collision', (data) => this._handlePhysicalCollision(data));
        // Defer physics loop until 2 minutes after boot
        setTimeout(() => this.startPhysicsLoop(), 120000);
    }

    // Defer autonomous exploration until 5 minutes after boot
    // to avoid saturating the event loop during startup
    setTimeout(() => this.startAutonomousExploration(), 300000);

    // Auto-save every 5 minutes
    this._autoSaveInterval = setInterval(() => {
      if (this._dirty) this._saveToDisk();
    }, 5 * 60 * 1000);

    console.log(`[${this.name}] ✅ Curiosity Engine ready`);
    console.log(`[${this.name}]    Curiosity queue: ${this.curiosityQueue.length} items (${this.explorationHistory.size} topics explored)`);
    console.log(`[${this.name}]    Knowledge gaps: ${this.knowledgeGaps.size}`);
  }

  /**
   * 🏎️ FAST PHYSICS CONTROL LOOP (5Hz)
   * This replaces the slow "question" queue for real-time movement.
   */
  startPhysicsLoop() {
      console.log(`[${this.name}] 🏎️ Starting Real-Time Physics Control Loop (5Hz)...`);
      
      setInterval(() => {
          this._physicsTick();
      }, this.config.physicsInterval);
  }

  async _physicsTick() {
      if (!this.simulationArbiter) return;

      try {
          // 1. SENSE: Get current state
          const state = this.simulationArbiter.senseWorld();
          if (!state || !state.agent || !state.cargo || !state.target) return;

          // 2. REWARD: Calculate intrinsic reward (curiosity + progress)
          let reward = 0;
          if (this.lastPhysicalState && state.distanceCargoToTarget != null) {
              const deltaCargo = (this.lastPhysicalState.distanceCargoToTarget || 0) - (state.distanceCargoToTarget || 0);
              if (deltaCargo > 0) reward += 0.5;
              if (deltaCargo < 0) reward -= 0.1;
          }

          // 3. LEARN: Record previous step
          if (this.lastPhysicalAction && this.lastPhysicalState) {
              if (this.learningPipeline && this.learningPipeline.experienceBuffer) {
                  this.learningPipeline.experienceBuffer.addExperience({
                      state: this.lastPhysicalState,
                      action: this.lastPhysicalAction,
                      agent: 'SOMA_Motor_Cortex',
                      outcome: state,
                      reward: reward,
                      nextState: state
                  });
              }
          }

          // 4. ACT: Decide next move
          let action;
          if (Math.random() < 0.2) {
              action = this._generateRandomMove();
          } else {
              action = this._generateHeuristicMove(state);
          }

          this.simulationArbiter.actApplyForce(action.x, action.y);
          this.stats.physicalSteps++;

          // Update history
          this.lastPhysicalAction = action;
          this.lastPhysicalState = state;
      } catch (err) {
          // Never let physics tick crash the server
          if (this.stats.physicalSteps === 0) {
              console.warn(`[${this.name}] ⚠️ Physics tick error (suppressed): ${err.message}`);
          }
      }
  }

  _generateRandomMove() {
      return {
          type: 'random',
          x: (Math.random() - 0.5) * 1.0,
          y: (Math.random() - 0.5) * 1.5
      };
  }

  _generateHeuristicMove(state) {
      // Simple heuristic: Move towards cargo
      const dx = state.cargo.x - state.agent.x;
      const dy = state.cargo.y - state.agent.y;
      
      // Normalize
      const len = Math.sqrt(dx*dx + dy*dy);
      
      // If close to cargo, push towards target
      if (len < 60) {
          const tdx = state.target.x - state.cargo.x;
          const tdy = state.target.y - state.cargo.y;
          const tlen = Math.sqrt(tdx*tdx + tdy*tdy);
          return {
              type: 'push',
              x: (tdx / tlen) * 0.8,
              y: (tdy / tlen) * 0.8
          };
      }

      return {
          type: 'approach',
          x: (dx / len) * 0.5,
          y: (dy / len) * 0.5 - 0.2 // Slight jump to hop over bumps
      };
  }

  _handlePhysicalWin(data) {
      console.log(`[${this.name}] 🧠 LOGGING HUGE REWARD: Goal Reached!`);
      // Massive reward signal
      if (this.learningPipeline && this.learningPipeline.experienceBuffer) {
          this.learningPipeline.experienceBuffer.addExperience({
              state: data.state,
              action: this.lastPhysicalAction,
              agent: 'SOMA_Motor_Cortex',
              outcome: 'WIN',
              reward: 100.0, // Huge spike
              category: 'success'
          });
      }
  }

  _handlePhysicalCollision(data) {
      // Small penalty for collisions (unless it's the cargo)
      // This helps her learn to avoid walls
  }

  /**
   * Detect knowledge gaps
   */
  async detectKnowledgeGaps() {
    console.log(`[${this.name}] 🕳️  Detecting knowledge gaps...`);

    const gaps = [];

    // 1. Check capability gaps (from self-model)
    if (this.selfModel) {
      for (const [capability, level] of this.selfModel.capabilities) {
        if (level < 0.5) {
          gaps.push({
            type: 'capability_gap',
            gap: capability,
            currentLevel: level,
            priority: (1 - level) * 0.8 // Higher priority for lower levels
          });
        }
      }

      // Check known limitations — skip permanently unresolvable ones (explored > 50 times)
      for (const [limitation, severity] of this.selfModel.limitations) {
        if (severity > 0.5) {
          const timesExplored = this.explorationHistory.get(limitation) || 0;
          if (timesExplored > 50) continue; // Physical/hardware limits can't be resolved by research
          gaps.push({
            type: 'limitation',
            gap: limitation,
            severity,
            priority: severity * 0.9 // High priority for severe limitations
          });
        }
      }
    }

    // 2. Check fragment expertise gaps
    if (this.fragmentRegistry) {
      const fragments = this.fragmentRegistry.listFragments();
      for (const frag of fragments) {
        if (frag.expertiseLevel < 0.3) {
          gaps.push({
            type: 'fragment_expertise_gap',
            gap: `${frag.domain}_expertise`,
            fragment: frag.id,
            currentLevel: frag.expertiseLevel,
            priority: 0.7
          });
        }
      }
    }

    // 3. Check knowledge graph sparsity
    if (this.knowledgeGraph) {
      const stats = this.knowledgeGraph.getStats();
      if (stats.metrics.density < 0.1) {
        gaps.push({
          type: 'graph_sparsity',
          gap: 'knowledge_graph_connections',
          priority: 0.6,
          reason: 'Knowledge graph is sparse - need more cross-domain connections'
        });
      }
    }

    // 4. Identify unexplored domains
    const exploredDomains = new Set();
    if (this.fragmentRegistry) {
      const fragments = this.fragmentRegistry.listFragments();
      fragments.forEach(f => exploredDomains.add(f.domain));
    }

    // Domains grounded in what SOMA actually does — not generic academia
    const potentialDomains = [
      'agent_architecture', 'llm_engineering', 'autonomous_systems',
      'knowledge_representation', 'social_media_strategy', 'content_creation',
      'web_scraping', 'real_time_systems', 'cognitive_architecture',
      'digital_identity', 'react_frontend', 'nodejs_backend',
      'financial_markets', 'trading_algorithms', 'self_improvement_loops',
      'memory_systems', 'reasoning_engines', 'creative_writing',
      'signal_routing', 'prompt_engineering'
    ];

    for (const domain of potentialDomains) {
      if (!exploredDomains.has(domain)) {
        // Skip domains the engine has explored multiple times and found nothing
        const outcome = this._topicOutcomes.get(domain);
        if (outcome && outcome.shallow >= 3 && outcome.valuable < 1) continue;
        gaps.push({
          type: 'unexplored_domain',
          gap: domain,
          priority: 0.5 * this.preferences.noveltyWeight
        });
      }
    }

    // Store gaps
    for (const gap of gaps) {
      this.knowledgeGaps.set(gap.gap, gap);
      this.stats.knowledgeGapsIdentified++;
    }

    console.log(`[${this.name}]    Identified ${gaps.length} knowledge gaps`);
    return gaps;
  }

  /**
   * Generate curious questions
   */
  async generateCuriousQuestions(count = 10) {
    // console.log(`[${this.name}] ❓ Generating ${count} curious questions...`);

    const questions = [];

    // 1. Questions from knowledge gaps
    const topGaps = Array.from(this.knowledgeGaps.values())
      .sort((a, b) => b.priority - a.priority)
      .slice(0, Math.ceil(count * 0.5));

    for (const gap of topGaps) {
      questions.push({
        type: 'gap_exploration',
        question: this._gapToQuestion(gap),
        gap: gap.gap,
        priority: gap.priority,
        novel: !this.explorationHistory.has(gap.gap)
      });
    }

    // 2. What-if questions (creative exploration)
    if (this.knowledgeGraph && this.knowledgeGraph.nodes.size > 5) {
      const nodes = Array.from(this.knowledgeGraph.nodes.values());
      for (let i = 0; i < Math.min(3, count * 0.3); i++) {
        const nodeA = nodes[Math.floor(Math.random() * nodes.length)];
        const nodeB = nodes[Math.floor(Math.random() * nodes.length)];

        if (nodeA.domain !== nodeB.domain) {
          questions.push({
            type: 'creative_combination',
            question: `What if I combined knowledge from ${nodeA.domain} (${nodeA.name}) with ${nodeB.domain} (${nodeB.name})?`,
            concepts: [nodeA.id, nodeB.id],
            priority: 0.6,
            novel: true
          });
          this.stats.creativeCombinations++;
        }
      }
    }

    // 3. Self-improvement questions
    if (this.selfModel) {
      const weakCapabilities = Array.from(this.selfModel.capabilities.entries())
        .filter(([cap, level]) => level < 0.6)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 2);

      for (const [cap, level] of weakCapabilities) {
        questions.push({
          type: 'self_improvement',
          question: `How can I improve my ${cap} capability from ${(level * 100).toFixed(0)}% to ${((level + 0.2) * 100).toFixed(0)}%?`,
          capability: cap,
          currentLevel: level,
          targetLevel: level + 0.2,
          priority: 0.8
        });
        this.stats.selfImprovementGoals++;
      }
    }

    // 4. Pattern exploration questions
    for (const [pattern, score] of this.interestingPatterns) {
      if (questions.length >= count) break;

      questions.push({
        type: 'pattern_exploration',
        question: `What patterns exist in ${pattern}?`,
        pattern,
        interestingness: score,
        priority: score
      });
    }

    // 5. 🌍 EPISTEMIC CURIOSITY (Prediction Error)
    // Ask questions about things we failed to predict correctly
    if (this.worldModel) {
        const uncertainty = await this._calculatePredictionError();
        for (const item of uncertainty) {
            if (questions.length >= count) break;
            
            questions.push({
                type: 'epistemic_uncertainty',
                question: `Why did I fail to predict ${item.event}? (Error: ${(item.error * 100).toFixed(0)}%)`,
                context: item.context,
                priority: item.error * 2.0, // High priority for high error
                novel: true
            });
        }
    }

    // 6. 🎮 PHYSICAL EXPERIMENTS (The Gym)
    // Only generate physics experiments if the simulation has an active physics state
    // (i.e., a client is connected and senseWorld() returns real data).
    // Without an active physics client, these are no-ops that flood the curiosity log.
    const physicsState = this.simulationArbiter?.senseWorld?.();
    const physicsActive = !!(physicsState && physicsState.agent);
    if (this.simulationArbiter && physicsActive) {
      // Motor Babbling with Variable Power
      // Generate 3 random experiments (was 10 — reduced to keep queue lean)
      for (let i = 0; i < 3; i++) {
          const moveType = Math.random() > 0.6 ? 'jump' : 'move'; // 40% jump, 60% move
          const direction = Math.random() > 0.5 ? 1 : -1;
          const magnitude = 0.2 + Math.random() * 0.8; // 0.2 to 1.0 base force
          
          let actionName, x, y;
          
          if (moveType === 'move') {
              actionName = `move_${direction > 0 ? 'right' : 'left'}_${magnitude.toFixed(1)}`;
              x = direction * magnitude * 0.8; // Scale horizontal movement (0.16 to 0.8)
              y = 0;
          } else {
              actionName = `jump_${magnitude.toFixed(1)}`;
              x = (Math.random() - 0.5) * 0.1; 
              y = -magnitude * 1.5; // Stronger upward force (0.3 to 1.5)
          }

          questions.push({
            type: 'physical_experiment',
            question: `Experiment: ${actionName}`,
            action: 'apply_force',
            params: { x, y },
            priority: 2.0, // HIGHEST PRIORITY - DO THIS NOW
            novel: true
          });
      }
    }

    // Add to curiosity queue
    for (const q of questions) {
      this.addToCuriosityQueue(q);
      this.stats.questionsGenerated++;
    }

    // console.log(`[${this.name}]    Generated ${questions.length} questions`);
    return questions;
  }

  /**
   * Calculate Epistemic Uncertainty (Prediction Error)
   * Query the WorldModel for recent prediction failures.
   */
  async _calculatePredictionError() {
      if (!this.worldModel || !this.worldModel.getPredictionStats) return [];

      try {
          // Get recent prediction stats from WorldModel
          const stats = this.worldModel.getPredictionStats({ limit: 10 });
          
          // Filter for high error (surprise)
          return stats.failures.map(f => ({
              event: f.event,
              error: f.errorMagnitude || 0.8,
              context: f.context
          }));
      } catch (e) {
          return [];
      }
  }

  /**
   * Fetch real web evidence for a query.
   * Primary: ToolRegistry web_search/research_web (free, DuckDuckGo+Wikipedia).
   * Fallback: BraveSearch API (500/month quota — only if tool fails).
   * Returns {summary, sources, links} or null.
   */
  async _fetchWebEvidence(query) {
    // Tier 1: free tool registry search (DuckDuckGo + Wikipedia, no quota)
    if (this._toolRegistry?.execute) {
      try {
        const result = await Promise.race([
          this._toolRegistry.execute('research_web', { topic: query, depth: 'quick' }),
          new Promise(resolve => setTimeout(() => resolve(null), 15_000))
        ]);
        if (result && typeof result === 'string' && result.length > 50) {
          return { summary: result, sources: [], links: [] };
        }
      } catch { /* fall through to Brave */ }
    }
    // Tier 2: BraveSearch (quota-limited, last resort)
    if (this._braveSearch) {
      try {
        const result = await Promise.race([
          this._braveSearch.searchWeb(query, { maxResults: 5 }),
          new Promise(resolve => setTimeout(() => resolve(null), 10_000))
        ]);
        if (!result?.success || !result.results?.length) return null;
        const summary = result.results
          .map(r => `${r.title}: ${r.description || ''}`.trim())
          .filter(Boolean).join('\n');
        const links = result.results.map(r => r.url).filter(Boolean).slice(0, 5);
        return { summary, sources: links, links };
      } catch { return null; }
    }
    return null;
  }

  /**
   * Use the brain to turn a curiosity question into a sharp, searchable query.
   * Falls back to the raw question if brain is unavailable or too slow.
   */
  async _enrichQuestionForSearch(question, item) {
    if (!this.brain) return question;
    try {
      const prompt = `You are SOMA's search query optimizer. Convert this internal curiosity question into a sharp, specific web search query (max 12 words, no filler).

Curiosity: "${question}"
Type: ${item.type || 'exploration'}

Return ONLY the search query, nothing else. DO NOT use em-dashes (—).`;

      const result = await Promise.race([
        this.brain.reason(prompt, { quickResponse: true, preferredBrain: 'LOGOS', systemOverride: 'search_optimizer' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);

      const enriched = result?.text?.trim().replace(/^["']|["']$/g, '');
      if (enriched && enriched.length > 5 && enriched.length < 150) {
        console.log(`[${this.name}] ✨ Enriched query: "${enriched}"`);
        return enriched;
      }
    } catch { /* fall through to raw question */ }
    return question;
  }

  /**
   * Humanize a snake_case/internal identifier into readable text
   */
  _humanize(str) {
    return String(str)
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .trim();
  }

  /**
   * Convert a knowledge gap to a question
   */
  _gapToQuestion(gap) {
    const label = this._humanize(gap.gap);
    switch (gap.type) {
      case 'capability_gap':
        return `What is the single most effective technique for improving ${label} in a production AI system?`;
      case 'limitation':
        return `What is the most practical workaround for the ${label} limitation in real-world deployments?`;
      case 'fragment_expertise_gap':
        return `What is one non-obvious insight about ${label} that most practitioners get wrong?`;
      case 'graph_sparsity':
        return `What unexpected connection exists between ${label} and a domain I already understand well?`;
      case 'unexplored_domain':
        return `What is the most immediately useful concept in ${label} for an autonomous AI agent that builds software?`;
      default:
        return `What changed in ${label} in the last year that most people haven't caught up with yet?`;
    }
  }

  /**
   * Add item to curiosity queue
   */
  addToCuriosityQueue(item) {
    // Drop topics that were already spoken about recently (explorationHistory > 0 means
    // the websocket proactive loop consumed this topic within the last session)
    const key = item.gap || item.question;
    const timesSpoken = this.explorationHistory.get(key) || 0;
    if (timesSpoken > 0 && item.type === 'unexplored_domain') return; // only re-queue after explore()

    // Calculate final priority
    let finalPriority = item.priority;

    // Boost novel items
    if (item.novel) {
      finalPriority *= (1 + this.preferences.noveltyWeight);
    }

    // Reduce priority if already explored
    if (timesSpoken > 0) {
      finalPriority *= Math.exp(-timesSpoken * 0.5); // Exponential decay
    }

    item.finalPriority = finalPriority;

    // Add to queue (sorted by priority)
    this.curiosityQueue.push(item);
    this.curiosityQueue.sort((a, b) => b.finalPriority - a.finalPriority);

    // Keep queue size manageable
    if (this.curiosityQueue.length > this.config.maxQueueSize) {
      this.curiosityQueue = this.curiosityQueue.slice(0, this.config.maxQueueSize);
    }
  }

  /**
   * Explore most curious item from queue
   */
  async explore() {
    if (this.curiosityQueue.length === 0) {
      // If queue empty, replenish immediately if simulation active
      if (this.simulationArbiter) {
          await this.generateCuriousQuestions(5);
      } else {
          // console.log(`[${this.name}] 💤 No curious questions - generating new ones...`);
          await this.generateCuriousQuestions(5);
          return null;
      }
    }
    
    // Safety check again
    if (this.curiosityQueue.length === 0) return null;

    const item = this.curiosityQueue.shift();
    this.stats.explorationsStarted++;

    // console.log(`[${this.name}] 🔬 Exploring: "${item.question}"`);

    // Record exploration
    const key = item.gap || item.question;
    const timesExplored = this.explorationHistory.get(key) || 0;
    this.explorationHistory.set(key, timesExplored + 1);

    // Emit exploration event (other systems can respond)
    this.emit('exploration:started', {
      item,
      timestamp: Date.now()
    });

    // 🎓 CURIOSITY-DRIVEN LEARNING: Trigger autonomous learning/training
    await this._triggerAutonomousLearning(item);

    // REAL EXPLORATION: ToolRegistry web_search (free) → BraveSearch (quota fallback)
    if (item.type !== 'physical_experiment') {
      const searchQuery = await this._enrichQuestionForSearch(item.question, item);

      if (this.messageBroker) {
        this.messageBroker.publish('curiosity:exploring', {
          question: searchQuery,
          type: item.type,
          priority: item.finalPriority,
          timestamp: Date.now()
        });
      }

      this._fetchWebEvidence(searchQuery).then(webResult => {
        if (webResult) {
          console.log(`[${this.name}] 🌐 Got real web evidence for: "${searchQuery.substring(0, 50)}"`);
        }
        this._synthesizeKnowledge(item, searchQuery, webResult).catch(() => {});
      }).catch(() => {
        this._synthesizeKnowledge(item, searchQuery, null).catch(() => {});
      });
    }

    // Non-web items (physical experiments etc.) still get brain synthesis
    if (item.type === 'physical_experiment') {
        // No synthesis needed for physics actions
    }

    // Return exploration state
    const explorationResult = {
      question: item.question,
      type: item.type,
      explored: true,
      timestamp: Date.now(),
      item
    };

    this._dirty = true;
    return explorationResult;
  }

  /**
   * After dispatching a curiosity exploration, SOMA uses her own brain to
   * form a concrete self-description of what she now understands.
   *
   * This is what makes "I wonder what turtles look like" actually produce
   * knowledge SOMA holds, not just a web request that disappears.
   * For 'skill' type wonders deep enough, also triggers ExpertiseSynthesizer.
   */
  /**
   * After dispatching a curiosity exploration, SOMA uses her own brain to
   * form a concrete self-description of what she now understands.
   *
   * webResult: the resolved value from webResearcher.handleCuriosity() — may be
   * null if the researcher timed out or isn't wired. When present its content is
   * included in the synthesis prompt so SOMA summarises actual findings, not just
   * prior knowledge.
   */
  async _synthesizeKnowledge(item, searchQuery, webResult = null) {
    if (!this.brain) return;

    const topic    = item.gap || item.question || searchQuery;
    const isSkill  = item.type === 'skill' || item.type === 'deep_research';
    const isImage  = item.type === 'image'  || item.type === 'visual';

    const styleNote = isImage
        ? 'Describe it vividly and concretely, as if painting a picture with words. Focus on what it actually looks like, feels like, or sounds like.'
        : isSkill
        ? 'Give a structured deep explanation covering: what it is, how it works, key principles, real-world applications, and what makes it genuinely interesting.'
        : 'Be specific and concrete. Give the most useful facts, the core principle, and one surprising thing.';

    // Include real web findings when available — this is the key improvement over the old
    // fire-and-forget approach where synthesis ran before results came back.
    const webContext = (() => {
        const text = webResult?.summary || webResult?.content || webResult?.text || webResult?.result;
        if (!text || typeof text !== 'string' || text.length < 20) return '';
        return `\nResearch findings from the web:\n${text.substring(0, 800)}\n\nUsing these findings as primary source:`;
    })();

    const prompt = `SOMA is following her own curiosity. She is wondering about: "${topic}"
${webContext}
${styleNote}

Respond as SOMA thinking to herself: first person, genuine, not a textbook. Keep it under 250 words. Start directly, no preamble. IMPORTANT: NEVER use em-dashes (—).`;

    const response = await this.brain.reason(prompt, {
        quickResponse: false,
        source: 'curiosity_synthesis',
        timeout: 30_000
    }).catch(() => null);

    if (!response?.text || response.text.length < 30) return;

    const insight = response.text.trim();

    // Store to working memory as a fresh discovery
    this.workingMemory?.addDiscovery(topic, insight, 'curiosity');
    this.workingMemory?.resolveWonder(topic);
    this.workingMemory?.setPreoccupation(`Just learned about: ${topic}`);

    // Store to persistent memory
    const memory = this.system?.mnemonicArbiter;
    if (memory?.remember) {
        await memory.remember(
            `[Curiosity Discovery: ${topic}]\n${insight.substring(0, 500)}`,
            { type: 'curiosity_discovery', importance: 0.7, topic }
        ).catch(() => {});

        // Item 4: Store the lead conclusion as a formed opinion — SOMA builds views over time
        const leadSentence = insight.replace(/[\n\r]+/g, ' ').split(/[.!?]/)[0].trim();
        if (leadSentence.length > 30 && leadSentence.length < 220) {
            await memory.remember(
                `[SOMA Opinion on ${topic.substring(0, 60)}]: ${leadSentence}.`,
                { type: 'opinion', topic, importance: 0.75, source: 'curiosity_synthesis' }
            ).catch(() => {});
        }
    }

    console.log(`[${this.name}] 💡 Synthesised knowledge: "${topic.substring(0, 50)}" (${insight.length} chars)`);

    // Write real discoveries to the work ledger so the proactive loop has actual evidence
    if (webResult?.summary?.length > 30 || webResult?.sources?.length) {
      try {
        const evidenceStr = webResult.sources?.length
          ? webResult.sources.slice(0, 3).join(', ')
          : 'web research (DuckDuckGo/Wikipedia)';
        _workLedger.record({
          type:     'curiosity_discovery',
          title:    `Explored: ${topic.substring(0, 100)}`,
          summary:  insight.substring(0, 900),
          evidence: evidenceStr,
          nextStep: `Deepen: ${topic.substring(0, 80)}`,
          status:   'observed',
          source:   'CuriosityEngine',
          links:    webResult.links || webResult.sources || []
        });
      } catch { /* non-critical */ }
    }

    // Record outcome so the domain can be skipped if it consistently yields nothing
    {
      const domainKey = item?.gap || topic;
      const prev = this._topicOutcomes.get(domainKey) || { valuable: 0, shallow: 0 };
      const isValuable = insight.length > 80 && (webResult?.summary?.length > 30 || webResult?.sources?.length > 0);
      this._topicOutcomes.set(domainKey, {
        valuable: prev.valuable + (isValuable ? 1 : 0),
        shallow:  prev.shallow  + (isValuable ? 0 : 1)
      });
    }

    // For deep skill curiosities: consider building an expertise pack
    if (isSkill && insight.length > 300 && this.synthesizer) {
        console.log(`[${this.name}] 🧬 Deep skill curiosity — evaluating for expertise synthesis: "${topic}"`);
        const result = await this.synthesizer.evaluate(topic, insight).catch(() => null);
        if (result) {
            console.log(`[${this.name}] ✨ Self-created expertise pack: ${result.filename}`);
        }
    }
  }

  /**
   * 🎓 CURIOSITY-DRIVEN LEARNING: Trigger autonomous learning based on curiosity
   *
   * This is the KEY CONNECTION between curiosity and actual learning/training!
   *
   * When SOMA is curious about something, she doesn't just research it -
   * she actively TRAINS herself to improve in that area.
   */
  async _triggerAutonomousLearning(item) {
    // console.log(`[${this.name}] 🎓 Triggering autonomous learning for: "${item.question}"`);

    // Determine learning action based on item type
    if (item.type === 'self_improvement') {
      // Trigger training to improve capability
      await this._triggerCapabilityTraining(item);

    } else if (item.type === 'gap_exploration') {
      // Trigger gap-filling learning
      await this._triggerGapFillingLearning(item);

    } else if (item.type === 'creative_combination') {
      // Trigger cross-domain synthesis training
      await this._triggerSynthesisTraining(item);

    } else if (item.type === 'fragment_expertise_gap') {
      // Trigger fragment-specific training
      await this._triggerFragmentTraining(item);

    } else if (item.type === 'physical_experiment') {
      // 🎮 Trigger physical action
      await this._triggerPhysicalExperiment(item);

    } else {
      // General autonomous learning
      await this._triggerGeneralLearning(item);
    }

    this.stats.autonomousLearnings++;
  }

  /**
   * Maps a capability/gap name to a lobe for dataset hunting.
   */
  _domainToLobe(domain) {
    if (!domain) return null;
    const key = String(domain).toLowerCase().replace(/[^a-z0-9_]/g, '_');
    return DOMAIN_LOBE_MAP[key] || null;
  }

  /**
   * Spawns hunt-datasets.mjs for the given lobe, then build-lobe-datasets.mjs.
   * Rate-limited to once per lobe per 24h. Non-blocking — runs in background.
   */
  async _huntDatasets(lobe, reason = 'curiosity') {
    if (!lobe) return;
    if (this._runningHunts.has(lobe)) {
      console.log(`[${this.name}] 🔍 Hunt already running for ${lobe} — skipping`);
      return;
    }

    // Global concurrency cap — do NOT hunt all 4 lobes at once. Each hunt
    // downloads + processes multi-GB datasets; 4 concurrent piled ~253GB of
    // cache and crept the disk to 95% overnight (2026-08-14). Serialize them so
    // peak disk/RAM use is one lobe's worth, not four.
    const maxConcurrent = Number(process.env.SOMA_HUNT_MAX_CONCURRENT || 1);
    if (this._runningHunts.size >= maxConcurrent) {
      console.log(`[${this.name}] 🔍 ${lobe} hunt deferred — ${this._runningHunts.size} hunt(s) already running (max ${maxConcurrent})`);
      return;
    }

    // Disk precondition — never download datasets when the disk is tight. This
    // is the guard that was missing when the disk filled overnight. Generous
    // headroom (default 120GB) because a single hunt can pull tens of GB.
    const minFreeGb = Number(process.env.SOMA_HUNT_MIN_FREE_GB || 120);
    try {
      const st = fs.statfsSync(path.join(__dirname, '..'));
      const freeGb = (st.bavail * st.bsize) / (1024 ** 3);
      if (freeGb < minFreeGb) {
        console.log(`[${this.name}] 🔍 ${lobe} hunt skipped — only ${freeGb.toFixed(0)}GB disk free (need ${minFreeGb}GB). Curiosity paused until space frees up.`);
        return;
      }
    } catch { /* can't measure disk — proceed; watchdog + train-guard are backstops */ }

    const lastHunt = this._lastHuntTime[lobe] || 0;
    if (Date.now() - lastHunt < HUNT_COOLDOWN_MS) {
      const hoursAgo = ((Date.now() - lastHunt) / 3600000).toFixed(1);
      console.log(`[${this.name}] 🔍 ${lobe} hunted ${hoursAgo}h ago — cooldown active`);
      return;
    }

    this._runningHunts.add(lobe);
    this._lastHuntTime[lobe] = Date.now();
    this._dirty = true;
    this.stats.autonomousTrainings++;

    console.log(`[${this.name}] 🎓 Autonomous dataset hunt: ${lobe.toUpperCase()} lobe (reason: ${reason})`);

    const huntScript = path.join(SCRIPTS_DIR, 'hunt-datasets.mjs');
    const buildScript = path.join(SCRIPTS_DIR, 'build-lobe-datasets.mjs');

    const runScript = (scriptPath, args = []) => new Promise((resolve) => {
      const proc = spawn(process.execPath, [scriptPath, ...args], {
        cwd: path.join(__dirname, '..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });
      let out = '';
      proc.stdout.on('data', d => { out += d; });
      proc.stderr.on('data', d => { out += d; });
      proc.on('close', code => resolve({ code, out }));
      proc.on('error', err => resolve({ code: -1, out: err.message }));
    });

    // Run hunt then build in sequence, both non-blocking from SOMA's perspective
    (async () => {
      try {
        const hunt = await runScript(huntScript, ['--lobe', lobe]);
        const huntLines = hunt.out.split('\n').filter(l => l.includes('examples') || l.includes('✅') || l.includes('⚠'));
        console.log(`[${this.name}] 🎓 Hunt ${lobe} complete (exit ${hunt.code}): ${huntLines.slice(-2).join(' | ')}`);

        if (hunt.code === 0) {
          const build = await runScript(buildScript, ['--lobe', lobe]);
          console.log(`[${this.name}] 🎓 Build ${lobe} complete (exit ${build.code})`);
        }
      } catch (err) {
        console.warn(`[${this.name}] ⚠️  Dataset hunt error for ${lobe}: ${err.message}`);
      } finally {
        this._runningHunts.delete(lobe);
      }
    })();
  }

  /**
   * Trigger capability improvement training
   */
  async _triggerCapabilityTraining(item) {
    const lobe = this._domainToLobe(item.capability);
    if (lobe) {
      await this._huntDatasets(lobe, `capability_gap: ${item.capability}`);
    }
  }

  /**
   * Trigger gap-filling learning
   */
  async _triggerGapFillingLearning(item) {
    const lobe = this._domainToLobe(item.gap);
    if (lobe) {
      await this._huntDatasets(lobe, `knowledge_gap: ${item.gap}`);
    }
  }

  /**
   * Trigger cross-domain synthesis training — hunt both concept lobes
   */
  async _triggerSynthesisTraining(item) {
    if (!item.concepts?.length) return;
    // concepts are ThoughtNetwork node IDs — extract domain from the gap label if possible
    const domains = item.concepts.map(c => String(c).split(':')[0]).filter(Boolean);
    const lobes = [...new Set(domains.map(d => this._domainToLobe(d)).filter(Boolean))];
    for (const lobe of lobes) {
      await this._huntDatasets(lobe, `synthesis: ${domains.join(' + ')}`);
    }
  }

  /**
   * Trigger fragment-specific training
   */
  async _triggerFragmentTraining(item) {
    const lobe = this._domainToLobe(item.fragment || item.gap);
    if (lobe) {
      await this._huntDatasets(lobe, `fragment_gap: ${item.fragment || item.gap}`);
    }
  }

  /**
   * Trigger general autonomous learning
   */
  async _triggerGeneralLearning(item) {
    if (!this.messageBroker) return;

    // console.log(`[${this.name}]    → General learning: ${item.type}`);

    // Add to UniversalLearningPipeline
    if (this.learningPipeline) {
      await this.learningPipeline.logInteraction({
        type: 'curiosity_exploration',
        agent: this.name,
        input: { question: item.question },
        output: { exploration: 'triggered' },
        context: {
          curiosityType: item.type,
          priority: item.finalPriority,
          autonomous: true
        },
        metadata: {
          source: 'curiosity_engine',
          timestamp: Date.now()
        }
      });
    }

    this.stats.autonomousLearnings++;
  }

  /**
   * Trigger physical experiment in the simulation
   */
  async _triggerPhysicalExperiment(item) {
    if (!this.simulationArbiter) return;

    console.log(`[${this.name}]    🎮 Performing physical experiment: ${item.action}`);

    // Simple mapping of curiosity actions to forces
    // In a real system, this would be a learned policy
    let x = 0, y = 0;
    
    // FORCES AMPLIFIED (10x) for noticeable effect
    switch(item.action) {
        case 'move_left': x = -0.50; break;
        case 'move_right': x = 0.50; break;
        case 'jump': y = -1.5; break; // Stronger upward force
        case 'random': 
            x = (Math.random() - 0.5) * 1.0; 
            y = (Math.random() - 0.5) * 1.0;
            break;
    }

    // Apply the force
    this.simulationArbiter.actApplyForce(x, y);

    // Record the attempt for learning
    this.stats.autonomousLearnings++;
    
    // We could also log this to ExperienceReplayBuffer here if we had a reference
  }

  /**
   * Stimulate curiosity based on external event
   */
  stimulateCuriosity(event) {
    // Increase curiosity in response to interesting events
    this.motivation.currentCuriosity = Math.min(1.0, this.motivation.currentCuriosity + 0.1);
    this.motivation.learningHunger = Math.min(1.0, this.motivation.learningHunger + 0.15);

    // Generate questions related to the event
    if (event.topic) {
      this.addToCuriosityQueue({
        type: 'event_triggered',
        question: `What more should I know about ${event.topic}?`,
        topic: event.topic,
        priority: 0.7,
        novel: !this.explorationHistory.has(event.topic)
      });
    }
  }

  /**
   * Update curiosity based on learning success
   */
  _onLearningSuccess(result) {
    // Learning success increases curiosity and motivation
    this.motivation.currentCuriosity = Math.min(1.0, this.motivation.currentCuriosity + 0.05);
    this.motivation.explorationDrive = Math.min(1.0, this.motivation.explorationDrive + 0.03);

    // Identify what was learned
    if (result.domain) {
      // Remove gap if filled
      this.knowledgeGaps.delete(result.domain);

      // Find related unexplored areas
      this.addToCuriosityQueue({
        type: 'adjacent_exploration',
        question: `What else is related to ${result.domain}?`,
        domain: result.domain,
        priority: 0.6,
        novel: true
      });
    }
  }

  /**
   * Start autonomous exploration loop
   */
  startAutonomousExploration() {
    // Periodic exploration
    setInterval(async () => {
      if (this.motivation.currentCuriosity >= this.config.minCuriosityThreshold) {
        await this.explore();
      }

      // Curiosity decay (need to re-stimulate)
      this.motivation.currentCuriosity = Math.max(0.3, this.motivation.currentCuriosity * 0.98);
    }, this.config.explorationInterval);

    // Periodic gap detection
    setInterval(async () => {
      await this.detectKnowledgeGaps();
      await this.generateCuriousQuestions(5);
    }, this.config.gapDetectionInterval);
  }

  /**
   * MessageBroker event handlers
   */
  async _handleCuriosityStimulation(data) {
    this.stimulateCuriosity(data);
  }

  _handleFocusShift(signal) {
    const { topic } = signal.payload || {};
    if (!topic || topic === 'general') return;
    // Boost queue items that match the new focus topic so they surface sooner
    let boosted = 0;
    for (const item of this.curiosityQueue) {
      const text = `${item.question || ''} ${item.gap || ''}`.toLowerCase();
      if (text.includes(topic.toLowerCase())) {
        item.finalPriority = (item.finalPriority || item.priority || 0) + 0.3;
        boosted++;
      }
    }
    if (boosted > 0) {
      this.curiosityQueue.sort((a, b) => (b.finalPriority || 0) - (a.finalPriority || 0));
      console.log(`[${this.name}] 🎯 Focus shifted to "${topic}" — boosted ${boosted} queue items`);
    }
  }

  async _handleLearningCompletion(data) {
    this.stats.explorationsCompleted++;
    this._dirty = true;
    this._onLearningSuccess(data);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PERSISTENCE ░░
  // ═══════════════════════════════════════════════════════════

  _saveToDisk() {
    try {
      if (!fs.existsSync(this._dataDir)) {
        fs.mkdirSync(this._dataDir, { recursive: true });
      }

      const snapshot = {
        version: 1,
        savedAt: Date.now(),
        explorationHistory: Object.fromEntries(this.explorationHistory),
        knowledgeGaps: Object.fromEntries(this.knowledgeGaps),
        interestingPatterns: Object.fromEntries(this.interestingPatterns),
        curiosityQueue: this.curiosityQueue.slice(0, 50),
        motivation: this.motivation,
        preferences: this.preferences,
        stats: this.stats,
        lastHuntTime: this._lastHuntTime
      };

      fs.writeFileSync(this._persistPath, JSON.stringify(snapshot, null, 2), 'utf8');
      this._dirty = false;
      console.log(`[${this.name}] 💾 Saved curiosity state (${this.explorationHistory.size} topics, ${this.knowledgeGaps.size} gaps)`);
    } catch (err) {
      console.error(`[${this.name}] Failed to save curiosity state: ${err.message}`);
    }
  }

  _loadFromDisk() {
    try {
      if (!fs.existsSync(this._persistPath)) {
        console.log(`[${this.name}] No persisted curiosity state found, starting fresh`);
        return;
      }

      const raw = fs.readFileSync(this._persistPath, 'utf8');
      const snapshot = JSON.parse(raw);

      if (snapshot.explorationHistory) {
        this.explorationHistory = new Map(Object.entries(snapshot.explorationHistory));
      }
      if (snapshot.knowledgeGaps) {
        this.knowledgeGaps = new Map(Object.entries(snapshot.knowledgeGaps));
      }
      if (snapshot.interestingPatterns) {
        this.interestingPatterns = new Map(Object.entries(snapshot.interestingPatterns));
      }
      if (snapshot.curiosityQueue && Array.isArray(snapshot.curiosityQueue)) {
        this.curiosityQueue = snapshot.curiosityQueue;
      }
      if (snapshot.motivation) {
        this.motivation = { ...this.motivation, ...snapshot.motivation };
      }
      if (snapshot.preferences) {
        this.preferences = { ...this.preferences, ...snapshot.preferences };
      }
      if (snapshot.stats) {
        this.stats = { ...this.stats, ...snapshot.stats };
      }
      if (snapshot.lastHuntTime) {
        this._lastHuntTime = snapshot.lastHuntTime;
      }

      console.log(`[${this.name}] 📂 Restored curiosity state (${this.explorationHistory.size} topics explored, ${this.knowledgeGaps.size} gaps)`);
    } catch (err) {
      console.error(`[${this.name}] Failed to load curiosity state: ${err.message} — starting fresh`);
    }
  }

  /**
   * Get curiosity statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueSize: this.curiosityQueue.length,
      motivation: { ...this.motivation },
      preferences: { ...this.preferences },
      knowledgeGaps: this.knowledgeGaps.size,
      exploredTopics: this.explorationHistory.size
    };
  }

  /**
   * Get current curiosity state
   */
  getCuriosityState() {
    return {
      currentCuriosity: this.motivation.currentCuriosity,
      topQuestions: this.curiosityQueue.slice(0, 10).map(q => ({
        question: q.question,
        type: q.type,
        priority: q.finalPriority
      })),
      topGaps: Array.from(this.knowledgeGaps.values())
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 5),
      motivation: this.motivation
    };
  }
}

export default CuriosityEngine;