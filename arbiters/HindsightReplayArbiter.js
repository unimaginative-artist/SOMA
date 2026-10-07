/**
 * HindsightReplayArbiter.js - Learn from Failures as Successes
 *
 * Implements Hindsight Experience Replay (HER) - a breakthrough technique that makes
 * SOMA learn from EVERY episode, even failures.
 *
 * THE PROBLEM:
 * - Task: "Push cargo to green target"
 * - SOMA pushes cargo to wrong place → Failure, no reward
 * - Traditional RL: "This was useless, forget it"
 *
 * THE HER SOLUTION:
 * - Reinterpret the failure: "What if THAT location was the goal?"
 * - Store as success: "Push cargo to location X" → Success! +reward
 * - Result: SOMA learns "how to push" from the failure
 *
 * MASSIVE IMPACT:
 * - Sparse reward problems become dense reward
 * - Every episode generates N successful experiences (N = hindsight goals)
 * - 2-3x faster learning in sparse reward environments
 *
 * EXAMPLE:
 * Episode 1: SOMA pushes cargo from A → B (target was C)
 *   Traditional: 1 failure experience
 *   HER: 1 failure + 4 hindsight successes:
 *     - "If goal was B, this was perfect!" ✓
 *     - "If goal was near B, close!" ✓
 *     - "If goal was between A-B, success!" ✓
 *     - "If goal was 'just push anywhere', win!" ✓
 *
 * Used by: SimulationControllerArbiter
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

export class HindsightReplayArbiter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = config.name || 'HindsightReplayArbiter';

    this.config = {
      hindsightRatio: config.hindsightRatio || 0.8, // 80% of buffer is hindsight experiences
      maxHindsightGoals: config.maxHindsightGoals || 4, // Generate 4 alternate goals per episode
      minEpisodeLength: config.minEpisodeLength || 3, // Need at least 3 transitions to extract hindsight
      strategyWeights: {
        'final': 0.4,      // Goal = final state achieved
        'future': 0.3,     // Goal = random future state in episode
        'random': 0.2,     // Goal = random state in episode  
        'intermediate': 0.1 // Goal = intermediate waypoints
      },
      ...config
    };

    // Storage
    this.episodeBuffer = []; // Stores complete episodes before hindsight processing
    this.currentEpisode = {
      transitions: [],
      startTime: Date.now(),
      originalGoal: null
    };

    // Connected systems
    this.experienceBuffer = null; // ExperienceReplayBuffer
    this.messageBroker = null;

    // Stats
    this.stats = {
      episodesProcessed: 0,
      hindsightExperiencesGenerated: 0,
      originalExperiences: 0,
      hindsightToOriginalRatio: 0.0,
      strategiesUsed: {
        final: 0,
        future: 0,
        random: 0,
        intermediate: 0
      }
    };

    console.log(`[${this.name}] 🎯 Hindsight Experience Replay initialized`);
    console.log(`[${this.name}]    Hindsight ratio: ${(this.config.hindsightRatio * 100).toFixed(0)}%`);
    console.log(`[${this.name}]    Max alternate goals per episode: ${this.config.maxHindsightGoals}`);
  }

  /**
   * Initialize and connect to systems
   */
  async initialize(deps = {}) {
    console.log(`[${this.name}] 🚀 Initializing Hindsight Replay...`);

    // Connect to experience buffer
    if (deps.experienceBuffer) {
      this.experienceBuffer = deps.experienceBuffer;
      console.log(`[${this.name}]    ✅ Connected to ExperienceReplayBuffer`);
    }

    // Connect to message broker
    if (deps.messageBroker) {
      this.messageBroker = deps.messageBroker;
      
      // Subscribe to episode events
      await this.messageBroker.subscribe('simulation_episode_start', this._onEpisodeStart.bind(this));
      await this.messageBroker.subscribe('simulation_episode_end', this._onEpisodeEnd.bind(this));
      await this.messageBroker.subscribe('simulation_transition', this._onTransition.bind(this));
      
      console.log(`[${this.name}]    ✅ Subscribed to episode events`);
    }

    console.log(`[${this.name}] ✅ Hindsight Replay ready - SOMA will learn from every failure!`);
  }

  /**
   * Episode start handler
   */
  _onEpisodeStart(message) {
    this.currentEpisode = {
      transitions: [],
      startTime: Date.now(),
      originalGoal: message.goal || null,
      episodeId: message.episode || this.stats.episodesProcessed
    };
  }

  /**
   * Record transition during episode
   */
  _onTransition(message) {
    const { state, action, reward, nextState, done } = message;

    this.currentEpisode.transitions.push({
      state,
      action,
      reward,
      nextState,
      done,
      timestamp: Date.now()
    });

    // If episode complete, process hindsight
    if (done) {
      this._processEpisodeWithHindsight();
    }
  }

  /**
   * Episode end handler
   */
  _onEpisodeEnd(message) {
    // Ensure episode is processed even if no terminal transition
    if (this.currentEpisode.transitions.length > 0) {
      this._processEpisodeWithHindsight();
    }
  }

  /**
   * 🌟 CORE HER LOGIC: Generate hindsight experiences from episode
   */
  _processEpisodeWithHindsight() {
    const episode = this.currentEpisode;
    
    // Skip if episode too short
    if (episode.transitions.length < this.config.minEpisodeLength) {
      console.log(`[${this.name}] ⏭️  Episode too short (${episode.transitions.length} transitions), skipping hindsight`);
      this.currentEpisode = { transitions: [], startTime: Date.now(), originalGoal: null };
      return;
    }

    this.stats.episodesProcessed++;

    // 1. Store original experiences
    this._storeOriginalExperiences(episode);

    // 2. Generate hindsight experiences
    const hindsightCount = this._generateHindsightExperiences(episode);

    console.log(`[${this.name}] 🎯 Episode ${episode.episodeId} processed: ${episode.transitions.length} transitions → ${hindsightCount} hindsight experiences`);

    // Update stats
    this.stats.hindsightToOriginalRatio = 
      this.stats.hindsightExperiencesGenerated / Math.max(1, this.stats.originalExperiences);

    // Clear episode
    this.currentEpisode = { transitions: [], startTime: Date.now(), originalGoal: null };

    // Emit completion
    this.emit('episode_processed', {
      episodeId: episode.episodeId,
      transitionCount: episode.transitions.length,
      hindsightCount,
      ratio: this.stats.hindsightToOriginalRatio
    });
  }

  /**
   * Store original experiences (as-is, with original goal)
   */
  _storeOriginalExperiences(episode) {
    if (!this.experienceBuffer) return;

    for (const transition of episode.transitions) {
      this.experienceBuffer.addExperience({
        state: transition.state,
        action: transition.action,
        agent: 'SimulationController',
        outcome: transition.nextState,
        reward: transition.reward,
        nextState: transition.nextState,
        terminal: transition.done,
        metadata: {
          episodeId: episode.episodeId,
          isHindsight: false,
          originalGoal: episode.originalGoal
        }
      });

      this.stats.originalExperiences++;
    }
  }

  /**
   * 🌟 Generate hindsight experiences with alternate goals
   */
  _generateHindsightExperiences(episode) {
    if (!this.experienceBuffer) return 0;

    let hindsightCount = 0;
    const numGoals = Math.min(this.config.maxHindsightGoals, episode.transitions.length);

    // For each hindsight goal strategy
    const strategies = this._selectHindsightStrategies(numGoals);

    for (const strategy of strategies) {
      const alternateGoal = this._generateAlternateGoal(episode, strategy);
      
      if (!alternateGoal) continue;

      // Replay episode with alternate goal
      for (let i = 0; i < episode.transitions.length; i++) {
        const transition = episode.transitions[i];
        
        // Calculate reward for this transition under alternate goal
        const hindsightReward = this._calculateHindsightReward(
          transition.nextState,
          alternateGoal,
          strategy
        );

        // Store hindsight experience
        this.experienceBuffer.addExperience({
          state: this._replaceGoalInState(transition.state, alternateGoal),
          action: transition.action,
          agent: 'SimulationController',
          outcome: transition.nextState,
          reward: hindsightReward,
          nextState: this._replaceGoalInState(transition.nextState, alternateGoal),
          terminal: transition.done,
          metadata: {
            episodeId: episode.episodeId,
            isHindsight: true,
            hindsightStrategy: strategy,
            originalGoal: episode.originalGoal,
            hindsightGoal: alternateGoal
          },
          priority: Math.abs(hindsightReward) + 0.1 // Boost priority for successful hindsight
        });

        hindsightCount++;
      }

      this.stats.hindsightExperiencesGenerated += hindsightCount;
      this.stats.strategiesUsed[strategy]++;
    }

    return hindsightCount;
  }

  /**
   * Select which hindsight strategies to use for this episode
   */
  _selectHindsightStrategies(numGoals) {
    const strategies = [];
    const weights = this.config.strategyWeights;

    // Weighted random selection
    const pool = [
      ...Array(Math.floor(weights.final * 10)).fill('final'),
      ...Array(Math.floor(weights.future * 10)).fill('future'),
      ...Array(Math.floor(weights.random * 10)).fill('random'),
      ...Array(Math.floor(weights.intermediate * 10)).fill('intermediate')
    ];

    for (let i = 0; i < numGoals; i++) {
      const strategy = pool[Math.floor(Math.random() * pool.length)];
      strategies.push(strategy);
    }

    return strategies;
  }

  /**
   * Generate alternate goal based on strategy
   */
  _generateAlternateGoal(episode, strategy) {
    const transitions = episode.transitions;

    switch (strategy) {
      case 'final':
        // Goal = final state achieved in episode
        return this._extractGoalFromState(transitions[transitions.length - 1].nextState);

      case 'future':
        // Goal = random future state (after current timestep)
        const futureIdx = Math.floor(Math.random() * transitions.length);
        return this._extractGoalFromState(transitions[futureIdx].nextState);

      case 'random':
        // Goal = random state in episode
        const randomIdx = Math.floor(Math.random() * transitions.length);
        return this._extractGoalFromState(transitions[randomIdx].state);

      case 'intermediate':
        // Goal = midpoint of episode
        const midIdx = Math.floor(transitions.length / 2);
        return this._extractGoalFromState(transitions[midIdx].nextState);

      default:
        return null;
    }
  }

  /**
   * Extract goal representation from state
   * (For cargo pushing: goal = cargo position)
   */
  _extractGoalFromState(state) {
    if (!state) return null;

    // For simulation: goal is cargo position or target position
    if (state.cargo && state.cargo.position) {
      return {
        type: 'cargo_position',
        x: state.cargo.position.x,
        y: state.cargo.position.y
      };
    }

    if (state.target && state.target.position) {
      return {
        type: 'target_position',
        x: state.target.position.x,
        y: state.target.position.y
      };
    }

    return null;
  }

  /**
   * Replace goal in state representation
   */
  _replaceGoalInState(state, newGoal) {
    if (!state || !newGoal) return state;

    // Create copy and replace target with hindsight goal
    const modifiedState = { ...state };
    
    if (modifiedState.target && modifiedState.target.position) {
      modifiedState.target = {
        ...modifiedState.target,
        position: { x: newGoal.x, y: newGoal.y }
      };
    }

    return modifiedState;
  }

  /**
   * Calculate reward under hindsight goal
   */
  _calculateHindsightReward(state, goal, strategy) {
    if (!state || !goal) return 0;

    // Extract achieved position
    let achievedX, achievedY;
    
    if (state.cargo && state.cargo.position) {
      achievedX = state.cargo.position.x;
      achievedY = state.cargo.position.y;
    } else if (state.agent && state.agent.position) {
      achievedX = state.agent.position.x;
      achievedY = state.agent.position.y;
    } else {
      return 0;
    }

    // Calculate distance to hindsight goal
    const dx = achievedX - goal.x;
    const dy = achievedY - goal.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Reward based on distance
    const proximityReward = Math.max(0, (300 - distance) / 300);

    // Bonus for very close (goal achieved)
    const goalBonus = distance < 50 ? 10.0 : 0;

    // Strategy-specific scaling
    const strategyScale = {
      'final': 1.0,        // Full reward for final state goal
      'future': 0.8,       // Slightly less for future goals
      'random': 0.6,       // Less for random goals
      'intermediate': 0.7  // Medium for intermediate
    }[strategy] || 0.5;

    return (proximityReward + goalBonus) * strategyScale;
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentEpisodeLength: this.currentEpisode.transitions.length,
      avgHindsightPerEpisode: this.stats.hindsightExperiencesGenerated / Math.max(1, this.stats.episodesProcessed)
    };
  }

  /**
   * 💾 Save hindsight configuration
   */
  async save(filepath) {
    const data = {
      config: this.config,
      stats: this.stats,
      timestamp: Date.now()
    };

    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[${this.name}] 💾 Saved hindsight config to ${filepath}`);
  }

  /**
   * 📂 Load hindsight configuration
   */
  async load(filepath) {
    try {
      const content = await fs.readFile(filepath, 'utf8');
      const data = JSON.parse(content);

      this.config = { ...this.config, ...data.config };
      this.stats = { ...this.stats, ...data.stats };

      console.log(`[${this.name}] 📂 Loaded hindsight config from ${filepath}`);
      console.log(`[${this.name}]    Total hindsight experiences: ${this.stats.hindsightExperiencesGenerated}`);
    } catch (error) {
      console.warn(`[${this.name}] ⚠️  Could not load hindsight config:`, error.message);
    }
  }
}

export default HindsightReplayArbiter;
