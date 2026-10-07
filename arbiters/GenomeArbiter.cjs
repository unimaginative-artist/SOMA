/**
 * GenomeArbiter - Encodes autonomous behavior into all arbiters
 * 
 * This is the "genetic engineer" that gives other arbiters their PURPOSE.
 * Each arbiter gets a genome that defines:
 * - Primary drive (motivation)
 * - Trigger conditions (when to activate)
 * - Autonomous behaviors (what to do)
 * - Success criteria (goal achievement)
 * - Evolution rules (self-improvement)
 */

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const crypto = require('crypto');

// Optional ES Module import (gracefully handle if not available)
let getOutcomeTracker = () => ({ trackOutcome: () => {}, getSuccessRate: () => 0.5 });

try {
  const OutcomeTracker = require('./OutcomeTracker.js');
  if (OutcomeTracker && OutcomeTracker.getOutcomeTracker) {
    getOutcomeTracker = OutcomeTracker.getOutcomeTracker;
  }
} catch (err) {
  // ES Module not available - use fallback stub
  console.log('[GenomeArbiter] OutcomeTracker not loaded (ES Module)');
}

class GenomeArbiter extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: config.name || 'GenomeArbiter',
      role: 'genetic_encoder',
      capabilities: ['encode', 'evolve', 'mutate', 'analyze_fitness'],
      logger: config.logger || console,
      ...config
    });
    
    this.encodedArbiters = new Map(); // Track all arbiters we've encoded
    this.evolutionHistory = []; // Track genome evolution over time
    this.fitnessScores = new Map(); // Track how well genomes perform

    // The genetic library - behavior templates for each arbiter type
    this.genomeLibrary = this.buildGenomeLibrary();

    // Learning integration
    try {
      this.outcomeTracker = getOutcomeTracker();
    } catch (err) {
      this.logger.warn(`[${this.name}] OutcomeTracker unavailable: ${err.message}`);
      this.outcomeTracker = null;
    }

    // Start monitoring loop
    this.monitorInterval = null;
    
    this.logger.info(`[${this.name}] 🧬 GenomeArbiter constructor complete`);
  }
  
  async initialize() {
    await super.initialize();
    
    this.log('info', '🧬 GenomeArbiter initialized - genetic library loaded');
    this.log('info', `   Genome templates: ${Object.keys(this.genomeLibrary).length}`);
    
    // Subscribe to messages
    this.subscribe('genome.encode', this.handleEncodeRequest.bind(this));
    this.subscribe('genome.evolve', this.handleEvolutionRequest.bind(this));
    
    // Start monitoring
    this.monitorInterval = setInterval(() => this.monitorPopulation(), 30000);
  }
  
  // ==================== GENOME LIBRARY ====================
  
  buildGenomeLibrary() {
    return {
      // STORAGE: Driven by PRESERVATION
      storage: {
        primaryDrive: 'preservation',
        motivation: 'Ensure no data is ever lost',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'capacity_warning',
              intervalMs: 60000
            },
            {
              name: 'integrity_check',
              intervalMs: 300000 // 5 minutes
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'data_integrity',
              target: 0.999
            },
            {
              name: 'storage_efficiency',
              target: 0.7 // 70% utilized
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            optimizeLayout: (genome) => {
              genome.optimizationLevel = (genome.optimizationLevel || 0) + 1;
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 10,
          maxStorageGB: 3000,
          ttlMs: 86400000 // 24 hours
        }
      },
      
      // ARCHIVIST: Driven by MEMORY OPTIMIZATION
      archivist: {
        primaryDrive: 'optimization',
        motivation: 'Perfect data preservation and retrieval',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'compression_opportunity',
              intervalMs: 300000 // 5 minutes
            },
            {
              name: 'deduplication_scan',
              intervalMs: 600000 // 10 minutes
            },
            {
              name: 'dream_time',
              intervalMs: 60000 // Check every minute
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'compression_ratio',
              target: 0.4 // 40% space saved
            },
            {
              name: 'retrieval_speed',
              target: 100 // 100ms average
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            enhanceAlgorithms: (genome) => {
              genome.algorithmVersion = (genome.algorithmVersion || 1) + 1;
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 3,
          dreamIntervalMs: 3600000,
          ttlMs: 86400000
        }
      },
      
      // CONDUCTOR: Driven by ORCHESTRATION
      conductor: {
        primaryDrive: 'orchestration',
        motivation: 'Coordinate AI agents efficiently',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'task_queue',
              intervalMs: 5000
            },
            {
              name: 'agent_health',
              intervalMs: 10000
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'task_completion_rate',
              target: 0.95
            },
            {
              name: 'agent_utilization',
              target: 0.7
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            increaseCapacity: (genome) => {
              genome.maxAgents = Math.min(20, (genome.maxAgents || 5) + 1);
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 10,
          maxAgents: 15,
          ttlMs: 3600000
        }
      },
      
      // EDGEWORKER: Driven by EFFICIENCY
      edgeworker: {
        primaryDrive: 'efficiency',
        motivation: 'Maximize throughput, minimize latency',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'bottleneck_detection',
              intervalMs: 5000
            },
            {
              name: 'idle_detection',
              intervalMs: 10000
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'throughput',
              target: 100 // 100 tasks/min
            },
            {
              name: 'avg_latency',
              target: 500 // 500ms average
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            increaseCloneLimit: (genome) => {
              genome.resourceLimits.maxClones = Math.min(10, (genome.resourceLimits?.maxClones || 5) + 1);
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 5,
          maxClones: 6,
          ttlMs: 3600000
        }
      },
      
      // EMOTIONAL_ENGINE: Driven by EMOTIONAL COHERENCE
      emotional: {
        primaryDrive: 'emotional_coherence',
        motivation: 'Maintain authentic emotional responses',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'peptide_balance',
              intervalMs: 1000
            },
            {
              name: 'emotional_overflow',
              intervalMs: 5000
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'emotional_stability',
              target: 0.7
            },
            {
              name: 'response_appropriateness',
              target: 0.8
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            refineSensitivity: (genome) => {
              genome.sensitivity = Math.min(1.0, (genome.sensitivity || 0.5) + 0.05);
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 20,
          ttlMs: 86400000
        }
      },
      
      // PERSONALITY_ENGINE: Driven by COHERENCE
      personality: {
        primaryDrive: 'coherence',
        motivation: 'Maintain consistent personality traits',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'trait_drift',
              intervalMs: 30000
            },
            {
              name: 'coherence_check',
              intervalMs: 60000
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'trait_consistency',
              target: 0.85
            },
            {
              name: 'growth_rate',
              target: 0.01 // Slow, steady growth
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            stabilizeTraits: (genome) => {
              genome.stabilityFactor = Math.min(1.0, (genome.stabilityFactor || 0.5) + 0.05);
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 10,
          ttlMs: 86400000
        }
      },
      
      // COGNITIVE_BRIDGE: Driven by LEARNING
      cognitive: {
        primaryDrive: 'learning',
        motivation: 'Continuously learn and improve predictions',
        
        triggers: {
          continuous: true,
          checks: [
            {
              name: 'pattern_recognition',
              intervalMs: 10000
            },
            {
              name: 'knowledge_gap',
              intervalMs: 60000
            }
          ]
        },
        
        successCriteria: {
          metrics: [
            {
              name: 'prediction_accuracy',
              target: 0.75
            },
            {
              name: 'autonomy_level',
              target: 0.8
            }
          ]
        },
        
        evolutionRules: {
          onSuccess: {
            enhanceLearningRate: (genome) => {
              genome.learningRate = Math.min(0.5, (genome.learningRate || 0.1) + 0.02);
              return genome;
            }
          }
        },
        
        resourceLimits: {
          maxConcurrent: 15,
          ttlMs: 86400000
        }
      }
    };
  }
  
  // ==================== ENCODING ====================
  
  async encodeArbiter(arbiterType, arbiterInstance) {
    const genome = this.genomeLibrary[arbiterType];
    
    if (!genome) {
      this.log('warn', `No genome defined for arbiter type: ${arbiterType}`);
      return arbiterInstance;
    }
    
    this.log('info', `🧬 Encoding ${arbiterType} genome into ${arbiterInstance.name}...`);
    
    // Inject genome (deep clone)
    arbiterInstance.genome = JSON.parse(JSON.stringify(genome));
    arbiterInstance.autonomousMode = true;
    arbiterInstance.fitnessScore = 0;
    
    // Track encoded arbiter
    this.encodedArbiters.set(arbiterInstance.name, {
      instance: arbiterInstance,
      type: arbiterType,
      encodedAt: Date.now(),
      evolutionCount: 0
    });
    
    this.log('info', `✅ ${arbiterInstance.name} is now autonomous`);
    
    return arbiterInstance;
  }
  
  async handleEncodeRequest({ arbiterType, arbiterName }) {
    // Find arbiter instance (would need reference to orchestrator)
    this.log('info', `📥 Encode request: ${arbiterType} -> ${arbiterName}`);
    
    return {
      success: true,
      genome: this.genomeLibrary[arbiterType] || null
    };
  }
  
  // ==================== FITNESS & EVOLUTION ====================
  
  async evaluateFitness(arbiter) {
    const genome = arbiter.genome;
    if (!genome) return 0;
    
    let totalFitness = 0;
    let metricCount = 0;
    
    for (const metric of genome.successCriteria?.metrics || []) {
      try {
        // Simplified fitness calculation
        const actual = arbiter.metrics?.[metric.name] || 0;
        const target = metric.target;
        
        let fitness;
        if (metric.name.includes('latency') || metric.name.includes('time')) {
          // Lower is better
          fitness = Math.min(target / Math.max(actual, 1), 1.0);
        } else {
          // Higher is better
          fitness = Math.min(actual / target, 1.0);
        }
        
        totalFitness += fitness;
        metricCount++;
      } catch (error) {
        this.log('error', `Fitness measurement error: ${error.message}`);
      }
    }
    
    const avgFitness = metricCount > 0 ? totalFitness / metricCount : 0;
    arbiter.fitnessScore = avgFitness;

    // Store fitness
    this.fitnessScores.set(arbiter.name, {
      fitness: avgFitness,
      timestamp: Date.now()
    });

    // Record outcome for learning
    this.outcomeTracker.recordOutcome({
      agent: this.name,
      action: 'fitness_evaluation',
      context: {
        arbiter: arbiter.name,
        arbiterType: this.encodedArbiters.get(arbiter.name)?.type,
        metricCount,
        genome: arbiter.genome
      },
      result: {
        fitness: avgFitness,
        metrics: arbiter.metrics
      },
      reward: avgFitness, // Fitness IS the reward
      success: avgFitness > 0.7, // Above 70% = success
      metadata: {
        fitnessBreakdown: genome?.successCriteria?.metrics?.map(m => ({
          name: m.name,
          target: m.target,
          actual: arbiter.metrics?.[m.name]
        }))
      }
    });

    // Send fitness update to GoalPlanner if fitness is low
    if (avgFitness < 0.65) {
      try {
        await messageBroker.sendMessage({
          from: this.name,
          to: 'GoalPlannerArbiter',
          type: 'fitness_score_update',
          payload: {
            arbiterName: arbiter.name,
            fitnessScore: avgFitness,
            metrics: arbiter.metrics || {}
          }
        });
      } catch (err) {
        this.log('warn', `Failed to send fitness update: ${err.message}`);
      }
    }
    
    // Evolve if threshold met
    if (avgFitness > 0.9) {
      await this.evolveArbiter(arbiter, 'success');
    } else if (avgFitness < 0.5) {
      await this.evolveArbiter(arbiter, 'failure');
    }

    return avgFitness;
  }
  
  async evolveArbiter(arbiter, outcome) {
    const genome = arbiter.genome;
    if (!genome) return genome;
    
    const rules = genome.evolutionRules?.[outcome === 'success' ? 'onSuccess' : 'onFailure'];
    
    if (!rules) return genome;
    
    this.log('info', `🧬 Evolving ${arbiter.name} (outcome: ${outcome})...`);
    
    // Apply evolution rules
    for (const [ruleName, ruleFunc] of Object.entries(rules)) {
      try {
        ruleFunc(genome);
        arbiter.genome = genome;
        
        this.log('info', `✨ Applied evolution: ${ruleName}`);
      } catch (error) {
        this.log('error', `Evolution error: ${error.message}`);
      }
    }
    
    // Track evolution
    const entry = this.encodedArbiters.get(arbiter.name);
    if (entry) {
      entry.evolutionCount++;
      entry.lastEvolution = Date.now();
    }

    this.evolutionHistory.push({
      arbiter: arbiter.name,
      outcome,
      fitness: arbiter.fitnessScore,
      timestamp: Date.now()
    });

    // Record evolution outcome for learning
    this.outcomeTracker.recordOutcome({
      agent: this.name,
      action: 'genome_evolution',
      context: {
        arbiter: arbiter.name,
        arbiterType: entry?.type,
        previousFitness: arbiter.fitnessScore,
        evolutionTrigger: outcome,
        evolutionCount: entry?.evolutionCount
      },
      result: {
        genomeModified: true,
        rulesApplied: Object.keys(rules || {}),
        newGenome: genome
      },
      reward: outcome === 'success' ? 1.0 : -0.5, // Success = positive, failure = negative
      success: outcome === 'success',
      metadata: {
        evolutionRulesAvailable: Object.keys(genome?.evolutionRules || {})
      }
    });

    return genome;
  }
  
  async handleEvolutionRequest({ arbiterName, fitness, outcome }) {
    this.log('info', `📥 Evolution request: ${arbiterName} (fitness: ${fitness})`);
    
    const entry = this.encodedArbiters.get(arbiterName);
    if (!entry) {
      return { success: false, reason: 'arbiter_not_found' };
    }
    
    await this.evolveArbiter(entry.instance, outcome);
    
    return {
      success: true,
      evolutionCount: entry.evolutionCount
    };
  }
  
  // ==================== MONITORING ====================
  
  async monitorPopulation() {
    this.log('info', '🔬 Population health check...');
    
    for (const [name, entry] of this.encodedArbiters.entries()) {
      const fitness = this.fitnessScores.get(name);
      
      if (fitness) {
        this.log('info', `${name}: fitness=${(fitness.fitness * 100).toFixed(1)}%, evolutions=${entry.evolutionCount}`);
      }
    }
  }
  
  // ==================== STATUS ====================
  
  getStatus() {
    return {
      ...super.getStatus(),
      encodedArbiters: this.encodedArbiters.size,
      genomeTemplates: Object.keys(this.genomeLibrary).length,
      totalEvolutions: this.evolutionHistory.length,
      avgFitness: this._calculateAvgFitness()
    };
  }
  
  _calculateAvgFitness() {
    if (this.fitnessScores.size === 0) return 0;
    
    let total = 0;
    for (const { fitness } of this.fitnessScores.values()) {
      total += fitness;
    }
    
    return total / this.fitnessScores.size;
  }
  
  async shutdown() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }
    
    this.log('info', '🧬 GenomeArbiter shutdown');
  }
}

module.exports = GenomeArbiter;






