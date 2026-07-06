// ═══════════════════════════════════════════════════════════
// FILE: arbiters/GoalPlannerArbiter.cjs
// Phase 4: Proactive goal planning and execution coordination
// Enables autonomous goal generation, prioritization, and tracking
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { buildQualityReport, verifyGoal } = require('../core/GoalQualityGate.cjs');
const { defaultLearningSpine } = require('../core/LearningSpine.cjs');
const { ownerName } = require('../core/SomaOwner.cjs');
const { atomicWriteJson, readJsonWithRecovery } = require('../core/AtomicJsonStore.cjs');
const { STATUS, TERMINAL_STATUSES, isTerminal, transitionGoal, isHumanGoal, deriveGoalState } = require('../core/GoalLifecycle.cjs');

// NEMESIS Phase 2.2: Reality checks for autonomous goal generation
let PrometheusNemesis = null;
try {
  ({ PrometheusNemesis } = require('../cognitive/prometheus/PrometheusNemesis.cjs'));
} catch (_) {
  // Graceful degradation — NEMESIS optional
}

class GoalPlannerArbiter extends BaseArbiter {
  // Statuses that must never occupy an active goal slot
  static TERMINAL_STATUSES = TERMINAL_STATUSES;

  static role = 'goal-planner';
  static capabilities = ['create-goals', 'prioritize', 'coordinate-tasks', 'track-progress', 'autonomous-planning'];

  constructor(config = {}) {
    super(config);

    // Goal storage
    this.goals = new Map(); // goalId -> Goal object
    this.activeGoals = new Set(); // Set of active goal IDs
    this.completedGoals = []; // Archive of completed goals
    this.failedGoals = []; // Archive of failed goals
    
    // Configuration
    this.maxActiveGoals = config.maxActiveGoals || 20;
    this.humanReservedSlots = Math.min(this.maxActiveGoals, Math.max(1, Number(config.humanReservedSlots || process.env.SOMA_HUMAN_GOAL_SLOTS || 4)));
    this.maxCompletedHistory = config.maxCompletedHistory || 100;
    this.stalledThresholdDays = config.stalledThresholdDays || 7;
    this.planningIntervalHours = config.planningIntervalHours || 0.5; // every 30 min
    
    // Prioritization weights
    this.priorityWeights = {
      impact: 0.35,
      urgency: 0.25,
      feasibility: 0.25,
      resourceCost: 0.15
    };
    
    // Goal generation thresholds
    this.thresholds = {
      velocityWarning: 1.5, // Generate goal if < 1.5x target
      memoryWarning: 0.85, // Generate goal if > 85% usage
      fitnessWarning: 0.65, // Generate goal if < 0.65 fitness
      codeQualityWarning: 0.70 // Generate goal if < 70% quality
    };
    
    // Statistics
    this.stats = {
      goalsCreated: 0,
      goalsCompleted: 0,
      goalsFailed: 0,
      goalsDeferred: 0,
      autonomousGoals: 0,
      userRequestedGoals: 0,
      avgCompletionTime: 0,
      goalsPerWeek: 0
    };
    
    // Planning intervals
    this.planningInterval = null;
    this.monitoringInterval = null;
    this.autoSaveInterval = null;
    this.canaryInterval = null;

    // Persistence
    this.dataDir = config.dataDir || path.join(process.cwd(), 'data');
    this.persistPath = path.join(this.dataDir, 'goals.json');
    this.planPath = path.join(process.cwd(), 'SOMA', 'plan.md');
    this._dirty = false;

    // Swarm outcome cache — populated by swarm.experience signals
    this._swarmHistory = [];   // { success, filepath, ts }
    this._cooldownCategories = new Map(); // category -> expiresAt — suppresses repeated failures

    // NEMESIS Phase 2.2: Reality check system
    this.nemesis = PrometheusNemesis ? new PrometheusNemesis({
      minFriction: 0.25,
      maxChargeWithoutFriction: 0.75,
      minValueDensity: 0.15,
      promotionScore: 0.85
    }) : null;
    this.nemesisStats = { checked: 0, rejected: 0, warned: 0, passed: 0 };

    // Brain reference — wired by SomaBootstrapV2 after QuadBrain is ready
    this.brain = null;
    this.constitutionalCore = config.constitutionalCore || null;

    this.logger.info(`[${this.name}] 🎯 GoalPlannerArbiter initializing...`);
    this.logger.info(`[${this.name}] Max active goals: ${this.maxActiveGoals}`);
    this.logger.info(`[${this.name}] Planning interval: ${this.planningIntervalHours}h`);
    if (this.nemesis) this.logger.info(`[${this.name}] 🔴 NEMESIS reality checks: ACTIVE`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    // Load persisted goals before anything else
    await this._loadFromDisk();

    // Import bullet points from PRIORITIES.md as goals (once per install, deduped)
    await this._importPrioritiesAsGoals();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Start monitoring loops
    this.startPlanningLoop();
    this.startMonitoringLoop();

    // Auto-save every 5 minutes
    this.autoSaveInterval = setInterval(() => {
      if (this._dirty) this._saveToDisk();
    }, 5 * 60 * 1000);
    this.canaryInterval = setInterval(() => {
      this.runLifecycleCanary().catch(error => {
        this.logger.warn(`[${this.name}] Lifecycle canary failed: ${error.message}`);
        messageBroker.publish('goal.canary.failed', {
          checkedAt: Date.now(),
          error: error.message
        }).catch(() => {});
      });
    }, Math.max(15 * 60_000, Number(process.env.SOMA_GOAL_CANARY_INTERVAL_MS || 6 * 60 * 60_000)));

    this.logger.info(`[${this.name}] ✅ Goal planning system active (${this.activeGoals.size} goals restored)`);
  }

  // Fix 4: parse PRIORITIES.md and create goals for each bullet, deduped by title
  async _importPrioritiesAsGoals() {
    const prioritiesPath = path.join(process.cwd(), 'SOMA', 'PRIORITIES.md');
    if (!fs.existsSync(prioritiesPath)) return;

    let content;
    try { content = fs.readFileSync(prioritiesPath, 'utf8'); } catch { return; }

    const bullets = content.split('\n')
      .filter(l => /^\s*[-*]\s+\S/.test(l))
      .map(l => l.replace(/^\s*[-*]\s+/, '').replace(/\*\*/g, '').trim())
      .filter(l => l.length > 5 && l.length < 200);

    const existingTitles = new Set(
      Array.from(this.goals.values()).map(g => g.title.toLowerCase().trim())
    );

    let imported = 0;
    for (const bullet of bullets) {
      if (existingTitles.has(bullet.toLowerCase().trim())) continue;
      try {
        await this.createGoal({
          title: bullet,
          description: `Priority from ${ownerName()}`,
          category: 'user_priority',
          priority: 72,
          source: 'priorities_md',
          requestedBy: ownerName()
        }, ownerName());
        existingTitles.add(bullet.toLowerCase().trim());
        imported++;
      } catch { /* skip malformed bullets */ }
    }

    if (imported > 0) {
      this.logger.info(`[${this.name}] 📋 Imported ${imported} goals from PRIORITIES.md`);
    }
  }

  /** Called from SomaBootstrapV2 after QuadBrain is ready */
  setBrain(brain) {
    this.brain = brain;
    this.logger.info(`[${this.name}] 🧠 Brain wired — goal decomposition enabled`);
  }

  /** Returns true when a goal is complex enough to warrant decomposition */
  _isComplexGoal(goal) {
    if (goal.metadata?.decomposed) return false;       // already decomposed
    if (goal.tasks?.some(task => task.title || task.description || Array.isArray(task.steps))) return false;
    if (goal.metadata?.parentGoalId) return false;     // is itself a sub-goal

    // Vague action words with no specific target suggest multi-step work
    const combined = `${goal.title || ''} ${goal.description || ''}`;
    const vaguePattern = /\b(improve|optimize|enhance|research|investigate|explore|refactor|analyse|analyze|study|review|assess|plan|redesign|consolidate|migrate|overhaul|harden|self-audit|unstoppable|best ai|capability growth)\b/i;
    const broadScope = combined.length > 500 || (combined.match(/\b(memory|reasoning|trading|cognition|self-modification|pipeline|architecture|latency|throughput)\b/gi) || []).length >= 3;
    if (!vaguePattern.test(combined) && !broadScope) return false;

    // Generic words such as "file" or "component" are not concrete targets.
    const hasConcreteTarget = /(?:[A-Za-z0-9_.-]+[\\/])+[A-Za-z0-9_.-]+|\b[A-Z][A-Za-z0-9]+(?:Arbiter|Engine|Pipeline|Executor|Loader|Router|Service)\b/.test(combined);
    return !hasConcreteTarget || broadScope;
  }

  _deterministicDecomposition(goal) {
    const root = `data/self-improvement/${goal.id}`;
    return [
      {
        title: 'Measure current cognition pipeline baseline',
        description: `Inspect the real execution, memory, and verification paths. Record timings, failure counts, and source locations in ${root}/baseline.json.`,
        artifactPath: `${root}/baseline.json`,
        successCriteria: ['Relevant runtime and source paths are inspected', 'Baseline metrics and recurring failures are recorded', 'The baseline artifact exists and is non-empty'],
        order: 1
      },
      {
        title: 'Rank bounded architecture improvements',
        description: `Use the measured baseline to rank concrete upgrades by impact, risk, cost, and falsification test. Save the ranked decision in ${root}/ranked-upgrades.json.`,
        artifactPath: `${root}/ranked-upgrades.json`,
        successCriteria: ['Each proposed upgrade cites baseline evidence', 'Impact, risk, cost, and falsification test are present', 'One bounded upgrade is selected for implementation'],
        order: 2
      },
      {
        title: 'Implement selected cognition pipeline upgrade',
        description: `Implement only the top bounded upgrade selected in ${root}/ranked-upgrades.json. Stage code through Pulse and run executable verification. Save changed files and command results in ${root}/implementation.json.`,
        artifactPath: `${root}/implementation.json`,
        successCriteria: ['Changed files are explicitly listed', 'Pulse staging or the self-modification pipeline approves the change', 'A syntax, test, or build command passes'],
        order: 3
      },
      {
        title: 'Benchmark upgrade and publish verdict',
        description: `Repeat the baseline measurement, compare before and after, and save a keep, revise, or rollback verdict in ${root}/verdict.json.`,
        artifactPath: `${root}/verdict.json`,
        successCriteria: ['Before and after measurements use the same method', 'The result includes a falsification check', 'The verdict states keep, revise, or rollback with evidence'],
        order: 4
      }
    ];
  }

  _validateDecomposition(goal, candidates) {
    if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 6) return [];
    const safeRoot = `data/self-improvement/${goal.id}/`;
    return candidates
      .filter(item => item && typeof item.title === 'string' && typeof item.description === 'string')
      .map((item, index) => ({
        title: item.title.trim().slice(0, 120),
        description: item.description.trim().slice(0, 1200),
        order: Number(item.order || index + 1),
        artifactPath: String(item.artifactPath || `${safeRoot}step-${index + 1}.json`).replace(/\\/g, '/'),
        successCriteria: Array.isArray(item.successCriteria) ? item.successCriteria.map(String).filter(Boolean).slice(0, 6) : []
      }))
      .filter(item => item.title.length >= 8 && item.description.length >= 40 && item.artifactPath.startsWith(safeRoot) && item.successCriteria.length >= 2)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Uses LOGOS brain to break a vague goal into 2-4 concrete ordered sub-goals.
   * Returns the array of sub-goal objects, or [] on failure.
   */
  async _decomposeGoal(goal) {
    const fallback = this._deterministicDecomposition(goal);
    if (!this.brain) return fallback;
    const prompt = `You are SOMA's goal decomposer. Break this vague engineering goal into 2-4 concrete, ordered sub-goals.

Goal: "${goal.title}"
Description: "${(goal.description || '').substring(0, 300)}"

Rules:
- Each sub-goal must be actionable and specific (name the file or component)
- Every sub-goal must produce one JSON artifact under data/self-improvement/${goal.id}/
- Include 2-4 measurable success criteria for every sub-goal
- Order them so later sub-goals depend on earlier ones
- Keep each title under 12 words
- Output JSON only — no markdown, no explanation:

[
  { "title": "...", "description": "...", "artifactPath": "data/self-improvement/${goal.id}/step-1.json", "successCriteria": ["...", "..."], "order": 1 },
  { "title": "...", "description": "...", "artifactPath": "data/self-improvement/${goal.id}/step-2.json", "successCriteria": ["...", "..."], "order": 2 }
]`;

    try {
      const res = await Promise.race([
        this.brain.reason(prompt, { quickResponse: true, preferredBrain: 'LOGOS' }),
        new Promise(resolve => setTimeout(() => resolve(null), 10_000))
      ]);
      if (!res?.text) return fallback;
      const match = res.text.match(/\[[\s\S]*?\]/);
      if (!match) return fallback;
      const parsed = JSON.parse(match[0]);
      const validated = this._validateDecomposition(goal, parsed);
      return validated.length >= 2 ? validated : fallback;
    } catch {
      return fallback;
    }
  }

  async decomposeGoal(goalId, actor = this.name) {
    const goal = this.goals.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };
    if (!this._isComplexGoal(goal)) return { success: false, skipped: true, reason: 'goal_is_already_bounded' };

    const subGoals = await this._decomposeGoal(goal);
    if (subGoals.length < 2) return { success: false, error: 'Could not produce a valid measurable decomposition' };
    const transitioned = this.transitionGoal(goal.id, STATUS.DEFERRED, {
      reason: 'decomposed_into_measurable_subgoals',
      actor
    });
    if (!transitioned.success) return transitioned;

    goal.metadata = {
      ...(goal.metadata || {}),
      decomposed: true,
      decomposedAt: Date.now()
    };
    let previousSubGoalId = null;
    const childGoalIds = [];
    for (let index = 0; index < subGoals.length; index++) {
      const subGoal = subGoals[index];
      const created = await this.createGoal({
        title: subGoal.title,
        description: subGoal.description,
        category: goal.category,
        priority: Math.max(10, goal.priority - (index * 3)),
        source: 'decomposed',
        requireQuality: false,
        maxAttempts: 6,
        dependencies: previousSubGoalId ? [previousSubGoalId] : [],
        successCriteria: subGoal.successCriteria,
        verification: {
          evidenceRequired: ['summary', 'artifact'],
          filesExist: [subGoal.artifactPath],
          allowStopReason: false
        },
        metadata: {
          parentGoalId: goal.id,
          parentTitle: goal.title,
          decompositionOrder: subGoal.order || index + 1,
          expectedArtifact: subGoal.artifactPath,
          measurableDecomposition: true
        }
      }, 'autonomous');
      if (created?.success && created.goal?.id) {
        created.goal.approved = true;
        this.transitionGoal(created.goal.id, STATUS.PENDING, {
          reason: 'inherits_approved_parent_goal',
          actor,
          force: true
        });
        previousSubGoalId = created.goal.id;
        childGoalIds.push(created.goal.id);
      }
    }

    if (childGoalIds.length < 2) {
      this.transitionGoal(goal.id, STATUS.PENDING, { reason: 'decomposition_children_failed', actor, force: true });
      return { success: false, error: 'Fewer than two measurable child goals were created', childGoalIds };
    }
    goal.metadata.childGoalIds = childGoalIds;
    this._dirty = true;
    this._saveToDisk();
    return { success: true, parentGoalId: goal.id, childGoalIds, subGoals };
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: GoalPlannerArbiter.role,
        capabilities: GoalPlannerArbiter.capabilities,
        lobe: 'PROMETHEUS',
        tier: 'strategic'
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Lobe-scoped subscriptions — only fires when the signal originates within PROMETHEUS
    // DriveArbiter publishes here when tension >= planningThreshold
    messageBroker.subscribeByLobe('PROMETHEUS', 'drive.planning.needed', (envelope) => {
      this.runPlanningCycle().catch(() => {});
    });

    // Broadcast goal lifecycle events so other arbiters can react
    messageBroker.subscribeByLobe('PROMETHEUS', 'planning_pulse', (envelope) => {
      this.runPlanningCycle().catch(() => {});
    });

    // Swarm outcome feedback — cross-lobe (LOGOS→PROMETHEUS); strategic tier fires first
    messageBroker.subscribeTiered('strategic', 'swarm.experience', (envelope) => {
      const data = envelope?.data || envelope;
      if (data && typeof data.success === 'boolean') {
        this._swarmHistory.push({ success: data.success, filepath: data.filepath, ts: Date.now() });
        if (this._swarmHistory.length > 200) this._swarmHistory.shift();
      }
    });

    this.logger.info(`[${this.name}] Subscribed to broker topics`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;
      
      switch (type) {
        case 'create_goal':
          return await this.createGoal(payload, from);
        
        case 'update_goal_progress':
          return await this.updateGoalProgress(payload.goalId, payload.progress, payload.metadata);
        
        case 'query_goals':
          return this.getActiveGoals(payload);
        
        case 'cancel_goal':
          return await this.cancelGoal(payload.goalId, payload.reason);

        case 'swarm_goal_failed':
          return await this._handleSwarmGoalFailure(payload.goalId, payload.reason);
        
        case 'approve_goal':
          return await this.approveGoal(payload.goalId);

        case 'reject_goal':
          return await this.rejectGoal(payload.goalId, payload.reason);
        
        case 'question_response':
          return await this.handleQuestionResponse(payload);
        
        case 'fix_proposed':
          return await this._handleFixProposed(payload);
        
        case 'query_plan':
          return this._handleQueryPlan();
        
        
        case 'velocity_report':
          return await this.handleVelocityReport(payload);
        
        case 'code_analysis_complete':
          return await this.handleCodeAnalysis(payload);
        
        case 'memory_metrics':
          return await this.handleMemoryMetrics(payload);
        
        case 'fitness_score_update':
          return await this.handleFitnessUpdate(payload);
        
        case 'discovery_complete':
          return await this.handleDiscoveryComplete(payload);

        case 'contradiction_detected':
          return await this.handleContradictionDetected(payload);

        case 'practice_reminder':
          return await this.handlePracticeReminder(payload);

        case 'skill_degraded':
          return await this.handleSkillDegraded(payload);

        case 'resource_pressure_critical':
          return await this.handleResourcePressure(payload);

        case 'arbitration_request':
          return await this.mediateConflict(payload);

        case 'goal_concern':
          return await this.handleGoalConcern(payload);

        case 'goal_enhancement_suggestion':
          return await this.handleGoalEnhancement(payload);

        case 'planning_pulse':
        case 'time_pulse':
          return await this.runPlanningCycle();
        
        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ GOAL MANAGEMENT ░░
  // ═══════════════════════════════════════════════════════════

  async createGoal(goalData, source = 'user') {
    try {
      goalData = defaultLearningSpine.applyGoalContract(goalData || {});
      let alignmentReceipt = null;

      // Validate goal data
      if (!goalData.title || !goalData.category) {
        throw new Error('Goal must have title and category');
      }

      const existingGoals = Array.from(this.goals.values());
      const quality = buildQualityReport(goalData, existingGoals);
      const requireQuality = goalData.requireQuality !== false && source !== 'legacy';
      if (requireQuality && !quality.approved) {
        return {
          success: false,
          error: 'Goal failed quality gate',
          quality
        };
      }

      const alignment = await this._checkGoalAlignment(goalData, source);
      if (!alignment.ok) return alignment.response;
      alignmentReceipt = alignment.receipt;
      const incomingHuman = isHumanGoal({ ...goalData, source, metadata: { ...(goalData.metadata || {}), source } });

      // Deduplication — reject if a similar active goal already exists (all non-user sources)
      if (source !== 'user') {
        const duplicate = this._findSimilarActiveGoal(goalData.category, goalData.title, goalData);
        if (duplicate) {
          this.logger.info(`[${this.name}] Skipping duplicate goal "${goalData.title}" — similar active goal exists: "${duplicate.title}"`);
          return { success: false, error: 'Duplicate goal exists', existingGoalId: duplicate.id };
        }

        // Cooldown check — don't regenerate categories that are on a failure streak
        if (this._isCategoryOnCooldown(goalData.category)) {
          this.logger.info(`[${this.name}] Category "${goalData.category}" is on failure cooldown — skipping "${goalData.title}"`);
          return { success: false, error: `Category "${goalData.category}" on cooldown after repeated failures` };
        }
      }

      // Check active goal limit — HARD CAP
      const activeAutonomous = Array.from(this.activeGoals)
        .map(id => this.goals.get(id))
        .filter(goal => goal && !isHumanGoal(goal)).length;
      const autonomousCapacity = Math.max(1, this.maxActiveGoals - this.humanReservedSlots);
      if (!incomingHuman && activeAutonomous >= autonomousCapacity) {
        return { success: false, error: `Autonomous goal capacity reached (${autonomousCapacity}); ${this.humanReservedSlots} slot(s) reserved for human requests.` };
      }
      if (this.activeGoals.size >= this.maxActiveGoals) {
        // First sweep: terminal-status goals must never hold an active slot
        let evicted = 0;
        for (const id of Array.from(this.activeGoals)) {
          if (GoalPlannerArbiter.TERMINAL_STATUSES.has(this.goals.get(id)?.status)) {
            this.activeGoals.delete(id);
            evicted++;
          }
        }
        if (evicted > 0) {
          this.logger.warn(`[${this.name}] 🧹 Evicted ${evicted} terminal-status goal(s) from active slots at cap check`);
          this._dirty = true;
        }
      }
      if (this.activeGoals.size >= this.maxActiveGoals) {
        this.logger.warn(`[${this.name}] Active goal limit reached (${this.activeGoals.size}/${this.maxActiveGoals}), deferring low-priority goals...`);
        const deferred = await this.deferLowPriorityGoals(1, { preserveHuman: incomingHuman });
        // If we couldn't free a slot, REJECT the new goal
        if (this.activeGoals.size >= this.maxActiveGoals) {
          this.logger.warn(`[${this.name}] ❌ Cannot create goal "${goalData.title}" — at hard cap (${this.activeGoals.size}/${this.maxActiveGoals})`);
          return { success: false, error: `Active goal limit reached (${this.maxActiveGoals}). Defer or complete existing goals first.` };
        }
      }
      
      // Create goal object
      const goal = {
        id: goalData.id || crypto.randomUUID(),
        type: goalData.type || 'operational',
        category: goalData.category,
        title: goalData.title,
        description: goalData.description || '',
        
        status: (source === 'autonomous' || goalData.status === 'proposed') ? 'proposed' : 'pending', // Goals start as 'proposed' or 'pending'
        approved: false, // All newly created goals require approval by default
        priority: goalData.priority || 50,
        
        metrics: goalData.metrics || {
          target: null,
          current: null,
          progress: 0
        },
        
        dependencies: goalData.dependencies || [],
        prerequisites: goalData.prerequisites || [],
        
        createdAt: Date.now(),
        startedAt: null,
        completedAt: null,
        dueDate: goalData.dueDate || null,
        
        assignedTo: goalData.assignedTo || [],
        tasks: [],
        
        metadata: {
          source: incomingHuman ? (source === 'user' ? 'user_requested' : source) : 'autonomous',
          confidence: goalData.confidence || 1.0,
          rationale: goalData.rationale || '',
          quality,
          successCriteria: goalData.successCriteria || goalData.metadata?.successCriteria || quality.successCriteria || [],
          verification: goalData.verification || goalData.metadata?.verification || quality.verification || null,
          evidence: goalData.evidence || goalData.metadata?.evidence || null,
          maxAlignment: alignmentReceipt,
          ...goalData.metadata
        }
      };
      
      // Calculate priority if not provided
      if (!goalData.priority) {
        goal.priority = this.calculateGoalPriority(goal);
      }

      // NEMESIS Phase 2.2: Reality check for autonomous goals
      if (source === 'autonomous' && this.nemesis) {
        const nemesisResult = this._nemesisRealityCheck(goal);
        if (!nemesisResult.approved) {
          return {
            success: false,
            error: nemesisResult.reason,
            nemesisScore: nemesisResult.score,
            nemesisFate: nemesisResult.fate
          };
        }
      }

      // Store goal
      this.goals.set(goal.id, goal);
      this.activeGoals.add(goal.id);
      
      // Update statistics
      this.stats.goalsCreated++;
      if (incomingHuman) {
        this.stats.userRequestedGoals++;
      } else {
        this.stats.autonomousGoals++;
      }
      
      // Broadcast goal creation (direct message to arbiters)
      await messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'goal_created',
        payload: { goal }
      });

      // Emit typed signal to CNS pub/sub (SignalSchema: goal.created)
      messageBroker.publish('goal.created', {
        goalId: goal.id,
        title: goal.title,
        category: goal.category,
        source,
        priority: goal.priority
      }).catch(() => {});
      
      this.logger.info(`[${this.name}] 🎯 Created goal: ${goal.title} (${goal.id.slice(0, 8)})`);
      this.logger.info(`[${this.name}]    Type: ${goal.type}, Category: ${goal.category}, Priority: ${goal.priority}`);

      this._dirty = true;
      this._saveToDisk();

      // Start goal if no dependencies and not proposed
      if (goal.status !== 'proposed' && goal.dependencies.length === 0 && goal.prerequisites.length === 0) {
        await this.startGoal(goal.id);
      }
      
      return { success: true, goalId: goal.id, goal };
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to create goal: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async _getConstitutionalCore() {
    if (this.constitutionalCore) return this.constitutionalCore;
    const { ConstitutionalCore } = await import('../core/ConstitutionalCore.js');
    this.constitutionalCore = new ConstitutionalCore();
    await this.constitutionalCore.initialize?.();
    return this.constitutionalCore;
  }

  async _checkGoalAlignment(goalData, source = 'unknown') {
    try {
      const constitutionalCore = await this._getConstitutionalCore();
      const result = typeof constitutionalCore.checkGoal === 'function'
        ? await constitutionalCore.checkGoal({ ...goalData, source })
        : await constitutionalCore.check({
            type: 'goal',
            description: `Goal: ${goalData.title} - ${goalData.description || ''}`,
            requestedBy: source
          });

      if (!result.ok) {
        this.logger.warn(`[${this.name}] Goal rejected by ConstitutionalCore (Max/SOMA check): ${goalData.title}. Violations: ${result.violations.join(', ')}`);
        return {
          ok: false,
          response: {
            success: false,
            error: 'Goal rejected by ConstitutionalCore',
            violations: result.violations,
            maxAlignment: result.alignment || null
          }
        };
      }

      return { ok: true, receipt: result.alignment || null };
    } catch (alignErr) {
      this.logger.warn(`[${this.name}] ConstitutionalCore alignment check failed to run: ${alignErr.message}`);
      return {
        ok: false,
        response: {
          success: false,
          error: 'ConstitutionalCore alignment check unavailable',
          detail: alignErr.message
        }
      };
    }
  }

  async startGoal(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      throw new Error(`Goal not found: ${goalId}`);
    }
    
    if (goal.status !== 'pending' && goal.status !== 'proposed') {
      return { success: false, reason: 'Goal not in pending or proposed state' };
    }

    this.transitionGoal(goalId, STATUS.ACTIVE, { reason: 'execution_started', actor: this.name });
    goal.approved = true;
    
    // Assign tasks if not already assigned
    if (goal.assignedTo.length > 0) {
      await this.assignGoalTasks(goal);
    }
    
    this.logger.info(`[${this.name}] ▶️  Started goal: ${goal.title}`);
    
    return { success: true };
  }

  transitionGoal(goalId, nextStatus, options = {}) {
    const goal = this.goals.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };
    try {
      const transition = transitionGoal(goal, nextStatus, options);
      if (isTerminal(goal.status) || [STATUS.DEFERRED, STATUS.BROKEN, STATUS.REJECTED, STATUS.ARCHIVED].includes(goal.status)) {
        this.activeGoals.delete(goalId);
      } else {
        this.activeGoals.add(goalId);
      }
      this._dirty = true;
      if (options.persist) this._saveToDisk();
      return { success: true, transition, goal };
    } catch (error) {
      this.logger.warn(`[${this.name}] ${error.message}`);
      return { success: false, error: error.message, goal };
    }
  }

  areDependenciesSatisfied(goalOrId) {
    const goal = typeof goalOrId === 'string' ? this.goals.get(goalOrId) : goalOrId;
    if (!goal) return false;
    const dependencies = [...(goal.dependencies || []), ...(goal.prerequisites || [])];
    return dependencies.every(id => this.goals.get(id)?.status === STATUS.COMPLETED);
  }

  getExecutionAttemptBudget(goalOrId) {
    const goal = typeof goalOrId === 'string' ? this.goals.get(goalOrId) : goalOrId;
    if (!goal) return null;
    const maxAttempts = Math.max(1, Number(goal.metadata?.goalContract?.maxAttempts || goal.metadata?.maxAttempts || 3));
    const attempts = Math.max(0, Number(goal.metadata?.executionAttempts || 0));
    return { attempts, maxAttempts, exhausted: attempts >= maxAttempts, remaining: Math.max(0, maxAttempts - attempts) };
  }

  beginExecutionAttempt(goalId, actor = 'executor') {
    const goal = this.goals.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };
    const budget = this.getExecutionAttemptBudget(goal);
    if (budget.exhausted) return { success: false, exhausted: true, budget };
    goal.metadata = {
      ...(goal.metadata || {}),
      executionAttempts: budget.attempts + 1,
      lastExecutionAttemptAt: Date.now(),
      lastExecutionActor: actor
    };
    this._dirty = true;
    this._saveToDisk();
    return { success: true, budget: this.getExecutionAttemptBudget(goal), goal };
  }

  async updateGoalProgress(goalId, progress, metadata = {}) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }
    
    // Update progress
    if (typeof progress === 'number') {
      goal.metrics.progress = Math.min(100, Math.max(0, progress));
    }
    
    // Update current metrics
    if (metadata.current) {
      goal.metrics.current = metadata.current;
    }
    
    // Add task completion if provided
    if (metadata.taskId) {
      const task = goal.tasks.find(t => t.taskId === metadata.taskId);
      if (task) {
        task.status = metadata.taskStatus || 'completed';
        task.completedAt = Date.now();
      }
    }

    const metadataPatch = { ...metadata };
    delete metadataPatch.current;
    delete metadataPatch.taskId;
    delete metadataPatch.taskStatus;
    if (Object.keys(metadataPatch).length) {
      goal.metadata = { ...(goal.metadata || {}), ...metadataPatch };
    }
    
    // Check if goal is complete
    if (goal.metrics.progress >= 100) {
      const completion = await this.completeGoal(goalId, { progress: 100, ...metadata });
      if (!completion.success) return completion;
    }
    
    this._dirty = true;

    this.logger.info(`[${this.name}] 📊 Updated goal progress: ${goal.title} - ${goal.metrics.progress}%`);

    return { success: true, goal };
  }

  async completeGoal(goalId, result = {}) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }
    if (goal.status === STATUS.COMPLETED) {
      return { success: true, alreadyCompleted: true, goal, verification: goal.metadata?.lastVerification || null };
    }

    // verifyGoal performs Poseidon certification asynchronously. Omitting await
    // stored a Promise as {}, then treated verification.passed as undefined.
    const verification = await verifyGoal(goal, result, { repoRoot: process.cwd() });
    goal.metadata = goal.metadata || {};
    goal.metadata.lastVerification = verification;
    if (!verification.passed && !result.force) {
      const explicitIncomplete = result.state === 'incomplete_step_budget' || result.stopReason === 'max_iterations_reached';
      const defaultContinuationFile = path.join(process.cwd(), 'data', 'goal-progress', `${goal.id}.json`);
      const continuationFile = result.continuationFile || goal.metadata.continuationFile || defaultContinuationFile;
      const hasContinuation = Boolean(continuationFile && fs.existsSync(continuationFile));
      const resumable = explicitIncomplete || hasContinuation;
      const failedTransition = this.transitionGoal(
        goalId,
        resumable ? STATUS.PENDING : STATUS.VERIFICATION_FAILED,
        { reason: resumable ? 'verification_incomplete_with_checkpoint' : 'verification_failed', actor: this.name }
      );
      if (!failedTransition.success) return failedTransition;
      goal.metrics.progress = Math.min(goal.metrics.progress || 0, resumable ? 75 : 95);
      try {
        goal.metadata.learningLesson = defaultLearningSpine.recordGoalOutcome(goal, {
          ...result,
          success: false,
          reason: explicitIncomplete
            ? 'Goal execution reached the step budget before verified completion'
            : (result.reason || result.stopReason || 'Goal completion blocked by verification')
        }, verification);
      } catch (err) {
        this.logger.warn(`[${this.name}] Learning spine negative distillation failed: ${err.message}`);
      }
      goal.metadata.incompleteReason = explicitIncomplete
        ? 'max_iterations_reached'
        : resumable
          ? 'verification_failed_with_continuation'
          : (result.reason || result.stopReason || 'verification_failed');
      goal.metadata.continuationFile = hasContinuation ? continuationFile : null;
      this._dirty = true;
      this._saveToDisk();
      this.logger.warn(`[${this.name}] ${resumable ? 'Goal queued to resume with continuation evidence' : 'Completion blocked by verification'}: ${goal.title}`);
      return {
        success: false,
        error: resumable ? 'Goal incomplete: resumable work remains' : 'Goal verification failed',
        goal,
        verification,
        state: goal.status
      };
    }
    
    const completedTransition = this.transitionGoal(goalId, STATUS.COMPLETED, {
      reason: 'verification_passed',
      actor: this.name
    });
    if (!completedTransition.success) return completedTransition;
    goal.metrics.progress = 100;
    goal.metadata.completionResult = result;
    const silentCanary = Boolean(goal.metadata?.lifecycleCanary && result.silent);
    if (!silentCanary) {
      try {
        goal.metadata.learningLesson = defaultLearningSpine.recordGoalOutcome(goal, result, verification);
      } catch (err) {
        this.logger.warn(`[${this.name}] Learning spine distillation failed: ${err.message}`);
      }
    }
    
    // Move to completed archive
    if (!silentCanary) {
      this.completedGoals.unshift(goal);
      this._completeParentIfChildrenVerified(goal);
    }
    
    // Trim completed history
    if (this.completedGoals.length > this.maxCompletedHistory) {
      this.completedGoals = this.completedGoals.slice(0, this.maxCompletedHistory);
    }
    
    // Update statistics
    if (!silentCanary) {
      this.stats.goalsCompleted++;
      this.updateAverageCompletionTime(goal);
    }
    
    // Broadcast completion
    if (!silentCanary) {
      await messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'goal_completed',
        payload: { goal, result }
      });
    }
    
    if (!silentCanary) {
      this.logger.info(`[${this.name}] ✅ Completed goal: ${goal.title}`);
      this.logger.info(`[${this.name}]    Duration: ${((goal.completedAt - goal.startedAt) / 86400000).toFixed(1)} days`);
    }

    this._dirty = true;
    if (!silentCanary) this._saveToDisk();

    return { success: true, goal, verification };
  }

  async failGoal(goalId, reason = '') {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }
    
    const failedTransition = this.transitionGoal(goalId, STATUS.FAILED, { reason: reason || 'goal_failed', actor: this.name });
    if (!failedTransition.success) return failedTransition;
    goal.metadata.failureReason = reason;
    
    // Move to failed archive
    this.failedGoals.unshift(goal);
    
    // Update statistics
    this.stats.goalsFailed++;
    
    // Broadcast failure
    await messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'goal_failed',
      payload: { goal, reason }
    });
    
    this.logger.warn(`[${this.name}] ❌ Failed goal: ${goal.title} - ${reason}`);

    // If this category has failed 3+ times recently, put it on a 2-hour cooldown
    const catRate = this._getCategorySuccessRate(goal.category, 24 * 3600_000);
    const recentFails = this.failedGoals.filter(g =>
      g.category === goal.category && (g.completedAt || 0) >= Date.now() - 24 * 3600_000
    ).length;
    if (recentFails >= 3 && (catRate === null || catRate < 0.4)) {
      const cooldownMs = 2 * 3600_000;
      this._cooldownCategories.set(goal.category, Date.now() + cooldownMs);
      this.logger.warn(`[${this.name}] ⏸ Category "${goal.category}" placed on 2h cooldown after ${recentFails} failures`);
    }

    this._dirty = true;
    this._saveToDisk();

    return { success: true, goal };
  }

  async cancelGoal(goalId, reason = '') {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }
    
    const deferredTransition = this.transitionGoal(goalId, STATUS.DEFERRED, { reason: reason || 'goal_deferred', actor: this.name });
    if (!deferredTransition.success) return deferredTransition;
    goal.metadata.deferredReason = reason;
    
    this.stats.goalsDeferred++;

    this._dirty = true;
    this._saveToDisk();

    this.logger.info(`[${this.name}] ⏸️  Deferred goal: ${goal.title} - ${reason}`);

    return { success: true, goal };
  }

  _completeParentIfChildrenVerified(completedChild) {
    const parentId = completedChild?.metadata?.parentGoalId;
    if (!parentId) return null;
    const parent = this.goals.get(parentId);
    if (!parent || parent.status === STATUS.COMPLETED) return parent || null;
    const childIds = parent.metadata?.childGoalIds || [];
    if (!childIds.length) return null;
    const children = childIds.map(id => this.goals.get(id)).filter(Boolean);
    if (children.length !== childIds.length || !children.every(child => child.status === STATUS.COMPLETED)) return null;

    const transition = this.transitionGoal(parent.id, STATUS.COMPLETED, {
      reason: 'all_measurable_child_goals_verified',
      actor: this.name
    });
    if (!transition.success) return null;
    parent.metrics = { ...(parent.metrics || {}), progress: 100 };
    parent.metadata = {
      ...(parent.metadata || {}),
      aggregateCompletion: {
        completedAt: Date.now(),
        childGoals: children.map(child => ({
          id: child.id,
          title: child.title,
          evidence: child.metadata?.completionResult?.evidence || child.metadata?.lastVerification || null
        }))
      }
    };
    if (!this.completedGoals.some(item => item.id === parent.id)) this.completedGoals.unshift(parent);
    this.stats.goalsCompleted++;
    return parent;
  }

  async retryGoal(goalId, options = {}) {
    const goal = this.goals.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };
    const retryable = new Set([STATUS.BROKEN, STATUS.VERIFICATION_FAILED, STATUS.FAILED, STATUS.DEFERRED]);
    if (!retryable.has(goal.status)) return { success: false, error: `Goal is not retryable from status ${goal.status}` };
    goal.metadata = {
      ...(goal.metadata || {}),
      executionAttempts: 0,
      retryAuthorizedAt: Date.now(),
      retryAuthorizedBy: options.actor || 'human',
      retryReason: options.reason || 'manual retry'
    };
    const transitioned = this.transitionGoal(goalId, STATUS.PENDING, {
      reason: goal.metadata.retryReason,
      actor: goal.metadata.retryAuthorizedBy,
      persist: true
    });
    if (!transitioned.success) return transitioned;
    goal.metrics.progress = Math.min(goal.metrics?.progress || 0, 75);
    return { success: true, goal };
  }

  /**
   * Called when EngineeringSwarmArbiter fails to execute a goal.
   * Retries up to 3 times with escalating priority and a post-mortem appended
   * to the description so the next swarm attempt has failure context.
   * On the 3rd failure, archives via failGoal() which applies category cooldowns.
   */
  async _handleSwarmGoalFailure(goalId, reason = 'unknown') {
    const goal = this.goals.get(goalId);
    if (!goal) return { success: false, error: 'Goal not found' };

    const MAX_SWARM_ATTEMPTS = 3;
    goal.metadata.swarmFailureCount = (goal.metadata.swarmFailureCount || 0) + 1;
    const attempt = goal.metadata.swarmFailureCount;

    if (attempt < MAX_SWARM_ATTEMPTS) {
      // Escalate — bump priority and annotate description for next attempt
      const oldPriority = goal.priority;
      goal.priority = Math.min(95, goal.priority + 15);
      this.transitionGoal(goalId, STATUS.PENDING, { reason: 'swarm_retry', actor: this.name });

      // Append post-mortem only if not already present for this attempt number
      const marker = `[POST-MORTEM attempt ${attempt}]`;
      if (!goal.description.includes(marker)) {
        goal.description += `\n${marker}: Swarm execution failed. Reason: ${reason}. Adjust strategy.`;
      }

      this.logger.warn(
        `[${this.name}] ⚠️  Swarm failure for "${goal.title}" (attempt ${attempt}/${MAX_SWARM_ATTEMPTS}) ` +
        `— priority escalated ${oldPriority}→${goal.priority}, queued for retry`
      );

      this._dirty = true;
      this._saveToDisk();
      return { success: true, retrying: true, attempt, goal };
    }

    // 3rd failure — archive it properly (applies category cooldown logic)
    this.logger.warn(
      `[${this.name}] ❌ Goal "${goal.title}" exhausted ${MAX_SWARM_ATTEMPTS} swarm attempts — archiving`
    );
    return await this.failGoal(goalId, `Swarm exhausted ${MAX_SWARM_ATTEMPTS} attempts. Last error: ${reason}`);
  }

  getActiveGoals(filter = {}) {
    const goals = Array.from(this.activeGoals).map(id => this.goals.get(id));
    
    // Apply filters
    let filtered = goals;
    if (filter.category) {
      filtered = filtered.filter(g => g.category === filter.category);
    }
    if (filter.type) {
      filtered = filtered.filter(g => g.type === filter.type);
    }
    if (filter.minPriority) {
      filtered = filtered.filter(g => g.priority >= filter.minPriority);
    }
    
    // Sort by priority
    filtered.sort((a, b) => b.priority - a.priority);
    
    return {
      success: true,
      goals: filtered,
      count: filtered.length,
      total: this.activeGoals.size
    };
  }

  getGoalStatus(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }
    
    return {
      success: true,
      goal,
      age: Date.now() - goal.createdAt,
      isStalled: this.isGoalStalled(goal)
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ GOAL PRIORITIZATION ░░
  // ═══════════════════════════════════════════════════════════

  calculateGoalPriority(goal) {
    // Escalate user-requested goals to maximum priority
    const source = goal.metadata?.source || goal.source;
    if (source === 'user_requested' || source === 'human' || source === 'discord' || source === 'priorities_md') {
      return 100;
    }

    const scores = {
      impact: this.calculateImpactScore(goal),
      urgency: this.calculateUrgencyScore(goal),
      feasibility: this.calculateFeasibilityScore(goal),
      resourceCost: this.calculateResourceCostScore(goal)
    };
    
    const priority = 
      scores.impact * this.priorityWeights.impact +
      scores.urgency * this.priorityWeights.urgency +
      scores.feasibility * this.priorityWeights.feasibility +
      scores.resourceCost * this.priorityWeights.resourceCost;
    
    return Math.round(priority * 100);
  }

  calculateImpactScore(goal) {
    // Higher impact for strategic goals
    const typeScores = { strategic: 1.0, tactical: 0.7, operational: 0.5 };
    const typeScore = typeScores[goal.type] || 0.5;
    
    // Higher impact for certain categories
    const categoryScores = {
      learning: 0.9,
      optimization: 0.8,
      quality: 0.7,
      capability: 1.0
    };
    const categoryScore = categoryScores[goal.category] || 0.5;
    
    return (typeScore + categoryScore) / 2;
  }

  calculateUrgencyScore(goal) {
    if (!goal.dueDate) return 0.5;
    
    const daysUntilDue = (goal.dueDate - Date.now()) / 86400000;
    if (daysUntilDue < 1) return 1.0;
    if (daysUntilDue < 3) return 0.9;
    if (daysUntilDue < 7) return 0.7;
    if (daysUntilDue < 30) return 0.5;
    return 0.3;
  }

  calculateFeasibilityScore(goal) {
    // Base feasibility on dependencies and prerequisites
    const dependencyPenalty = goal.dependencies.length * 0.1;
    const prerequisitePenalty = goal.prerequisites.length * 0.15;
    let score = 1.0 - Math.min(0.5, dependencyPenalty + prerequisitePenalty);

    // Outcome-aware adjustment: penalise categories that keep failing
    const catRate = this._getCategorySuccessRate(goal.category, 7 * 24 * 3600_000);
    if (catRate !== null) {
      if (catRate < 0.3)       score -= 0.25;  // category is consistently failing
      else if (catRate < 0.5)  score -= 0.10;
      else if (catRate > 0.75) score += 0.10;  // category has a good track record
    }

    // Swarm-specific penalty: if the swarm is struggling and this goal needs it
    const swarmCategories = ['optimization', 'quality', 'capability', 'learning'];
    if (swarmCategories.includes(goal.category) && this._swarmHistory.length >= 5) {
      const recent = this._swarmHistory.slice(-20);
      const swarmRate = recent.filter(e => e.success).length / recent.length;
      if (swarmRate < 0.4) score -= 0.15;
    }

    return Math.max(0.1, Math.min(1.0, score));
  }

  // Success rate for a category in the given window, null if no data
  _getCategorySuccessRate(category, windowMs = 7 * 24 * 3600_000) {
    const since = Date.now() - windowMs;
    const wins  = this.completedGoals.filter(g => g.category === category && (g.completedAt || 0) >= since).length;
    const fails = this.failedGoals.filter(g => g.category === category && (g.completedAt || 0) >= since).length;
    const total = wins + fails;
    return total >= 3 ? wins / total : null;   // need at least 3 data points to be meaningful
  }

  // Whether a category is on cooldown (too many recent failures)
  _isCategoryOnCooldown(category) {
    const exp = this._cooldownCategories.get(category);
    if (!exp) return false;
    if (Date.now() > exp) { this._cooldownCategories.delete(category); return false; }
    return true;
  }

  calculateResourceCostScore(goal) {
    // Inverse score - lower cost = higher score
    const assigneeCount = goal.assignedTo.length;
    if (assigneeCount === 0) return 1.0;
    if (assigneeCount === 1) return 0.9;
    if (assigneeCount === 2) return 0.7;
    return 0.5;
  }

  async rebalancePriorities() {
    this.logger.info(`[${this.name}] 🔄 Rebalancing goal priorities...`);
    
    let updated = 0;
    for (const goalId of this.activeGoals) {
      const goal = this.goals.get(goalId);
      const newPriority = this.calculateGoalPriority(goal);
      
      if (Math.abs(newPriority - goal.priority) > 5) {
        goal.priority = newPriority;
        updated++;
      }
    }
    
    this.logger.info(`[${this.name}] Updated priorities for ${updated} goals`);
  }

  async deferLowPriorityGoals(count = 1, options = {}) {
    // Prefer deferring pending goals first, then active goals — lowest priority first
    const goals = Array.from(this.activeGoals)
      .map(id => this.goals.get(id))
      .filter(g => g && (g.status === 'pending' || g.status === 'active'))
      .filter(g => !(options.preserveHuman && isHumanGoal(g)))
      .sort((a, b) => {
        // Pending before active (cheaper to defer)
        if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
        // Then lowest priority first
        return a.priority - b.priority;
      });

    const toDefer = goals.slice(0, count);

    for (const goal of toDefer) {
      await this.cancelGoal(goal.id, 'Auto-deferred due to goal limit');
    }

    return toDefer.length;
  }

  /**
   * Check if a similar active goal already exists (deduplication)
   * Matches on same category + overlapping intent across title, description, and rationale.
   */
  _findSimilarActiveGoal(category, title, goalData = {}) {
    const candidate = this._goalIntentSignature({
      category,
      title,
      description: goalData.description || '',
      metadata: goalData.metadata || {},
      rationale: goalData.rationale || ''
    });

    for (const goalId of this.activeGoals) {
      const goal = this.goals.get(goalId);
      if (!goal || goal.category !== category) continue;

      const existing = this._goalIntentSignature(goal);
      if (candidate.key && candidate.key === existing.key) return goal;

      const overlap = this._setOverlap(candidate.tokens, existing.tokens);
      const sameSource = (goal.metadata?.source || '') === (goalData.metadata?.source || '');
      const strongIntentMatch = overlap >= 0.58;
      const sourceBackedMatch = sameSource && overlap >= 0.42;

      if (strongIntentMatch || sourceBackedMatch) {
        return goal;
      }
    }
    return null;
  }

  _goalIntentSignature(goal = {}) {
    const text = [
      goal.category || '',
      goal.title || '',
      goal.description || '',
      goal.rationale || '',
      goal.metadata?.rationale || '',
      goal.metadata?.why || '',
      goal.metadata?.gap || '',
      goal.metadata?.searchQuery || ''
    ].join(' ').toLowerCase();

    const synonymMap = new Map([
      ['browse', 'web'], ['browser', 'web'], ['browsing', 'web'], ['navigation', 'web'],
      ['navigator', 'web'], ['scrape', 'web'], ['scraping', 'web'], ['puppeteer', 'web'],
      ['playwright', 'web'], ['internet', 'web'], ['github', 'repository'], ['repos', 'repository'],
      ['repo', 'repository'], ['investigate', 'research'], ['evaluate', 'research'],
      ['study', 'research'], ['integrate', 'integration'], ['activate', 'integration'],
      ['autonomous', 'autonomy'], ['agentic', 'autonomy'], ['capability', 'capability']
    ]);

    const stop = new Set([
      'this', 'that', 'with', 'from', 'into', 'using', 'based', 'would', 'could',
      'should', 'current', 'currently', 'existing', 'system', 'soma', 'goal',
      'goals', 'rationale', 'search', 'query', 'ability', 'able', 'allow',
      'allows', 'directly', 'robust', 'well', 'good', 'basic'
    ]);

    const tokens = new Set(
      text
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && !stop.has(w))
        .map(w => synonymMap.get(w) || w.replace(/s$/, ''))
    );

    const keyTokens = Array.from(tokens)
      .filter(w => ['web', 'research', 'integration', 'autonomy', 'repository', 'capability', 'memory', 'learning', 'causality', 'audio', 'vision', 'code'].includes(w))
      .sort();

    return {
      tokens,
      key: keyTokens.length >= 2 ? `${goal.category || ''}:${keyTokens.join('|')}` : ''
    };
  }

  _setOverlap(a, b) {
    if (!a?.size || !b?.size) return 0;
    let hits = 0;
    for (const token of a) {
      if (b.has(token)) hits++;
    }
    return hits / Math.min(a.size, b.size);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ EXECUTION COORDINATION ░░
  // ═══════════════════════════════════════════════════════════

  async assignGoalTasks(goal) {
    if (goal.assignedTo.length === 0) {
      this.logger.warn(`[${this.name}] No arbiters assigned to goal: ${goal.title}`);
      return;
    }
    
    for (const arbiter of goal.assignedTo) {
      const existing = goal.tasks.find(task => task.arbiter === arbiter && ['assigned', 'active', 'completed'].includes(task.status));
      if (existing) {
        this.logger.info(`[${this.name}] Task already assigned to ${arbiter}; reusing ${existing.taskId.slice(0, 8)}`);
        continue;
      }
      const taskId = crypto.randomUUID();
      const task = {
        taskId,
        arbiter,
        status: 'assigned',
        assignedAt: Date.now(),
        completedAt: null
      };
      
      goal.tasks.push(task);
      
      // Send task assignment message
      await messageBroker.sendMessage({
        from: this.name,
        to: arbiter,
        type: 'goal_assigned',
        payload: {
          goalId: goal.id,
          taskId,
          goal: {
            title: goal.title,
            description: goal.description,
            category: goal.category,
            metrics: goal.metrics
          }
        }
      });
      
      this.logger.info(`[${this.name}] 📤 Assigned task ${taskId.slice(0, 8)} to ${arbiter}`);
    }
  }

  isGoalStalled(goal) {
    if (goal.status !== 'active') return false;
    
    const daysSinceStart = (Date.now() - goal.startedAt) / 86400000;
    const progressRate = goal.metrics.progress / Math.max(1, daysSinceStart);
    
    // Stalled if less than 1% progress per day for longer than threshold
    return daysSinceStart > this.stalledThresholdDays && progressRate < 1.0;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ AUTONOMOUS GOAL GENERATION ░░
  // ═══════════════════════════════════════════════════════════

  async handleVelocityReport(payload) {
    try {
      // SelfEvolvingGoalEngine is active — it generates goals from real analysis, not metric templates
      if (this._selfEvolvingActive) return { success: true, goalsGenerated: 0 };

      const { currentVelocity, targetVelocity, trend } = payload;

      // Generate goal if velocity is below threshold
      if (currentVelocity < this.thresholds.velocityWarning * targetVelocity) {
        const gap = targetVelocity - currentVelocity;
        const improvement = ((gap / currentVelocity) * 100).toFixed(0);
        
        await this.createGoal({
          type: 'tactical',
          category: 'learning',
          title: `Increase learning velocity to ${targetVelocity}x target`,
          description: `Current velocity: ${currentVelocity.toFixed(2)}x, Target: ${targetVelocity}x. Need ${improvement}% improvement.`,
          metrics: {
            target: { metric: 'learning_velocity', value: targetVelocity },
            current: { metric: 'learning_velocity', value: currentVelocity },
            progress: 0
          },
          assignedTo: ['LearningVelocityTracker', 'EdgeWorkerOrchestrator'],
          confidence: 0.9,
          rationale: `Velocity ${improvement}% below target. ${trend === 'declining' ? 'Declining trend detected.' : ''}`,
          dueDate: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
        }, 'autonomous');
        
        this.logger.info(`[${this.name}] 🎯 Generated learning velocity goal (current: ${currentVelocity.toFixed(2)}x)`);
      }
      
      return { success: true, goalsGenerated: 1 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleVelocityReport error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleCodeAnalysis(payload) {
    try {
      // SelfEvolvingGoalEngine is active — it generates goals from real analysis, not metric templates
      if (this._selfEvolvingActive) return { success: true, goalsGenerated: 0 };

      const { issues, metrics, riskFiles } = payload;

      // Generate refactoring goals for high-risk modules
      if (riskFiles && riskFiles.length > 0 && metrics.quality < this.thresholds.codeQualityWarning) {
        const topRisks = riskFiles.slice(0, 5);
        const riskCount = topRisks.length;
        
        await this.createGoal({
          type: 'operational',
          category: 'quality',
          title: `Refactor ${riskCount} high-risk modules`,
          description: `Code quality: ${(metrics.quality * 100).toFixed(0)}%. High-risk files: ${topRisks.map(f => f.path).join(', ')}`,
          metrics: {
            target: { metric: 'code_quality', value: 0.85 },
            current: { metric: 'code_quality', value: metrics.quality },
            progress: 0
          },
          assignedTo: ['EngineeringSwarmArbiter'],
          confidence: 0.85,
          rationale: `${issues.length} code issues found. ${riskCount} files exceed complexity thresholds.`,
          dueDate: Date.now() + (14 * 24 * 60 * 60 * 1000) // 14 days
        }, 'autonomous');
        
        this.logger.info(`[${this.name}] 🎯 Generated code quality goal (${riskCount} files)`);
        return { success: true, goalsGenerated: 1 };
      }
      
      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleCodeAnalysis error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleMemoryMetrics(payload) {
    try {
      const { usage, tiers, efficiency } = payload;
      
      // Generate optimization goal if memory usage is high
      if (usage && usage.percentage > this.thresholds.memoryWarning) {
        const improvement = ((usage.percentage - 0.70) * 100).toFixed(0); // Target 70%
        
        await this.createGoal({
          type: 'tactical',
          category: 'optimization',
          title: `Optimize memory usage (reduce by ${improvement}%)`,
          description: `Current: ${(usage.percentage * 100).toFixed(0)}% (${(usage.used / 1e9).toFixed(2)} GB). Target: <70%`,
          metrics: {
            target: { metric: 'memory_usage_pct', value: 0.70 },
            current: { metric: 'memory_usage_pct', value: usage.percentage },
            progress: 0
          },
          assignedTo: ['MnemonicArbiter-REAL', 'ArchivistArbiter'],
          confidence: 0.88,
          rationale: `Memory usage at ${(usage.percentage * 100).toFixed(0)}%, exceeding ${(this.thresholds.memoryWarning * 100)}% threshold.`,
          dueDate: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
        }, 'autonomous');
        
        this.logger.info(`[${this.name}] 🎯 Generated memory optimization goal (${(usage.percentage * 100).toFixed(0)}%)`);
        return { success: true, goalsGenerated: 1 };
      }
      
      // Generate compression goal if efficiency is low
      if (efficiency && efficiency.compressionRatio < 0.5) {
        await this.createGoal({
          type: 'operational',
          category: 'optimization',
          title: 'Improve memory compression efficiency',
          description: `Current compression ratio: ${(efficiency.compressionRatio * 100).toFixed(0)}%. Target: >50%`,
          metrics: {
            target: { metric: 'compression_ratio', value: 0.5 },
            current: { metric: 'compression_ratio', value: efficiency.compressionRatio },
            progress: 0
          },
          assignedTo: ['ArchivistArbiter'],
          confidence: 0.75,
          rationale: 'Low compression efficiency detected in cold tier storage.',
          dueDate: Date.now() + (14 * 24 * 60 * 60 * 1000)
        }, 'autonomous');
        
        this.logger.info(`[${this.name}] 🎯 Generated compression efficiency goal`);
        return { success: true, goalsGenerated: 1 };
      }
      
      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleMemoryMetrics error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleFitnessUpdate(payload) {
    try {
      const { arbiterName, fitnessScore, metrics } = payload;
      
      // Generate evolution goal if fitness is low
      if (fitnessScore < this.thresholds.fitnessWarning) {
        const improvement = ((this.thresholds.fitnessWarning - fitnessScore) * 100).toFixed(0);
        
        await this.createGoal({
          type: 'tactical',
          category: 'optimization',
          title: `Improve ${arbiterName} fitness to >0.65`,
          description: `Current fitness: ${(fitnessScore * 100).toFixed(0)}%. Target: >65%. Needs ${improvement}% improvement.`,
          metrics: {
            target: { metric: 'arbiter_fitness', value: 0.80 },
            current: { metric: 'arbiter_fitness', value: fitnessScore },
            progress: 0
          },
          assignedTo: ['GenomeArbiter', 'EngineeringSwarmArbiter'],
          confidence: 0.82,
          rationale: `${arbiterName} fitness at ${(fitnessScore * 100).toFixed(0)}%, below ${(this.thresholds.fitnessWarning * 100)}% threshold.`,
          dueDate: Date.now() + (21 * 24 * 60 * 60 * 1000) // 21 days
        }, 'autonomous');
        
        this.logger.info(`[${this.name}] 🎯 Generated fitness improvement goal for ${arbiterName}`);
        return { success: true, goalsGenerated: 1 };
      }
      
      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleFitnessUpdate error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleDiscoveryComplete(payload) {
    try {
      const { topic, coverage, gaps } = payload;

      // Generate learning goals for knowledge gaps
      if (gaps && gaps.length > 0) {
        const topGaps = gaps.slice(0, 3);
        const gapCount = topGaps.length;

        for (const gap of topGaps) {
          await this.createGoal({
            type: 'operational',
            category: 'learning',
            title: `Study ${gap.topic} (${gap.priority} priority)`,
            description: `Coverage: ${gap.coverage}%. Identified as knowledge gap during ${topic} discovery.`,
            metrics: {
              target: { metric: 'knowledge_coverage', value: 80 },
              current: { metric: 'knowledge_coverage', value: gap.coverage || 0 },
              progress: 0
            },
            assignedTo: ['KnowledgeDiscoveryWorker', 'WebScraperDendrite'],
            confidence: 0.70,
            rationale: `Knowledge gap detected: ${gap.rationale || 'No prior coverage'}`,
            dueDate: Date.now() + (30 * 24 * 60 * 60 * 1000)
          }, 'autonomous');
        }

        this.logger.info(`[${this.name}] 🎯 Generated ${gapCount} knowledge gap learning goals`);
        return { success: true, goalsGenerated: gapCount };
      }

      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleDiscoveryComplete error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleContradictionDetected(payload) {
    try {
      const { contradiction } = payload;

      // Only create goals for high/critical contradictions
      if (contradiction.severity === 'critical' || contradiction.severity === 'high') {
        const severity = contradiction.severity.toUpperCase();

        await this.createGoal({
          type: 'strategic',
          category: 'consistency',
          title: `[${severity}] Resolve belief contradiction`,
          description: `${contradiction.description}. Type: ${contradiction.type}`,
          metrics: {
            target: { metric: 'contradictions_resolved', value: 1 },
            current: { metric: 'contradictions_resolved', value: 0 },
            progress: 0
          },
          assignedTo: ['BeliefSystemArbiter', 'KnowledgeGraphFusion'],
          confidence: 0.95,
          rationale: `${severity} severity contradiction detected: ${contradiction.description}`,
          dueDate: Date.now() + (contradiction.severity === 'critical' ? 3 : 7) * 24 * 60 * 60 * 1000,
          metadata: {
            contradictionId: contradiction.id,
            beliefs: contradiction.beliefs
          }
        }, 'autonomous');

        this.logger.info(`[${this.name}] 🎯 Generated contradiction resolution goal (${severity})`);
        return { success: true, goalsGenerated: 1 };
      }

      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleContradictionDetected error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handlePracticeReminder(payload) {
    try {
      const { skillId, skillName, proficiency, proficiencyLevel } = payload;

      // Only create goals for skills below intermediate level
      if (proficiency < 0.5) {
        await this.createGoal({
          type: 'operational',
          category: 'learning',
          title: `Practice skill: ${skillName}`,
          description: `Current proficiency: ${(proficiency * 100).toFixed(0)}% (${proficiencyLevel}). Needs practice to advance.`,
          metrics: {
            target: { metric: 'skill_proficiency', value: 0.7 },
            current: { metric: 'skill_proficiency', value: proficiency },
            progress: 0
          },
          assignedTo: ['SkillAcquisitionArbiter'],
          confidence: 0.80,
          rationale: `Skill proficiency at ${(proficiency * 100).toFixed(0)}%, practice needed to reach intermediate level`,
          dueDate: Date.now() + (14 * 24 * 60 * 60 * 1000),
          metadata: {
            skillId,
            skillName,
            currentProficiency: proficiency
          }
        }, 'autonomous');

        this.logger.info(`[${this.name}] 🎯 Generated skill practice goal for ${skillName}`);
        return { success: true, goalsGenerated: 1 };
      }

      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handlePracticeReminder error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleSkillDegraded(payload) {
    try {
      const { skillId, skillName, oldProficiency, newProficiency, proficiencyLevel } = payload;

      // Create urgent goal if significant degradation (>20% drop)
      const degradation = oldProficiency - newProficiency;
      if (degradation > 0.2) {
        await this.createGoal({
          type: 'tactical',
          category: 'learning',
          title: `[URGENT] Restore degraded skill: ${skillName}`,
          description: `Proficiency dropped from ${(oldProficiency * 100).toFixed(0)}% to ${(newProficiency * 100).toFixed(0)}% (-${(degradation * 100).toFixed(0)}%). Immediate practice needed.`,
          metrics: {
            target: { metric: 'skill_proficiency', value: oldProficiency },
            current: { metric: 'skill_proficiency', value: newProficiency },
            progress: 0
          },
          assignedTo: ['SkillAcquisitionArbiter'],
          confidence: 0.90,
          rationale: `Significant skill degradation: ${(degradation * 100).toFixed(0)}% drop from lack of practice`,
          dueDate: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days (urgent)
          metadata: {
            skillId,
            skillName,
            degradation,
            oldProficiency,
            newProficiency
          }
        }, 'autonomous');

        this.logger.info(`[${this.name}] 🎯 Generated URGENT skill restoration goal for ${skillName}`);
        return { success: true, goalsGenerated: 1 };
      }

      return { success: true, goalsGenerated: 0 };
    } catch (err) {
      this.logger.error(`[${this.name}] handleSkillDegraded error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleResourcePressure(payload) {
    try {
      const { resourceType, pressure, budget, urgency } = payload;

      this.logger.warn(`[${this.name}] 🚨 Resource pressure critical: ${resourceType}`);

      // Create optimization goal based on resource type
      const goalTemplates = {
        apiCalls: {
          title: `[URGENT] Reduce API call usage - budget critical`,
          description: `API budget pressure at ${(pressure * 100).toFixed(0)}%. Remaining: ${budget.remaining}/${budget.daily} calls. Need immediate optimization.`,
          assignedTo: ['ResourceBudgetArbiter', 'EngineeringSwarmArbiter'],
          dueDate: Date.now() + (3 * 24 * 60 * 60 * 1000) // 3 days
        },
        memory: {
          title: `[URGENT] Optimize memory usage - approaching limit`,
          description: `Memory pressure at ${(pressure * 100).toFixed(0)}%. Using ${budget.usedMB}/${budget.budgetMB} MB. Critical compression needed.`,
          assignedTo: ['MnemonicArbiter-REAL', 'ArchivistArbiter'],
          dueDate: Date.now() + (1 * 24 * 60 * 60 * 1000) // 1 day (urgent)
        },
        compute: {
          title: `[URGENT] Reduce compute usage - budget low`,
          description: `Compute budget pressure at ${(pressure * 100).toFixed(0)}%. Used ${budget.usedSeconds}/${budget.dailySeconds}s. Optimize algorithms.`,
          assignedTo: ['EngineeringSwarmArbiter', 'LoadPipelineArbiter'],
          dueDate: Date.now() + (2 * 24 * 60 * 60 * 1000) // 2 days
        }
      };

      const template = goalTemplates[resourceType];
      if (!template) {
        return { success: false, error: 'Unknown resource type' };
      }

      await this.createGoal({
        type: 'tactical',
        category: 'optimization',
        title: template.title,
        description: template.description,
        metrics: {
          target: { metric: `${resourceType}_pressure`, value: 0.5 },
          current: { metric: `${resourceType}_pressure`, value: pressure },
          progress: 0
        },
        assignedTo: template.assignedTo,
        confidence: 0.95,
        rationale: `Critical resource pressure - immediate optimization required`,
        dueDate: template.dueDate,
        metadata: {
          resourceType,
          pressure,
          budget,
          triggeredBy: 'ResourceBudgetArbiter'
        }
      }, 'autonomous');

      this.logger.info(`[${this.name}] 🎯 Generated resource optimization goal for ${resourceType}`);
      return { success: true, goalsGenerated: 1 };

    } catch (err) {
      this.logger.error(`[${this.name}] handleResourcePressure error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async mediateConflict(payload) {
    try {
      const { proposal, progressivePosition, conservativePosition } = payload;

      this.logger.info(`[${this.name}] ⚖️  Mediating Conservative vs Progressive conflict`);

      // Decision matrix: balance risk and opportunity
      const riskScore = conservativePosition?.conservativeRisk || 0.5;
      const opportunityScore = progressivePosition?.opportunityScore || 0.5;

      let decision;
      let reasoning = [];

      // High opportunity + acceptable risk = approve
      if (opportunityScore > 0.7 && riskScore < 0.5) {
        decision = 'APPROVE_PROGRESSIVE';
        reasoning.push('High opportunity with manageable risk');
      }
      // High risk + low opportunity = reject
      else if (riskScore > 0.7 && opportunityScore < 0.5) {
        decision = 'APPROVE_CONSERVATIVE';
        reasoning.push('Risk outweighs potential benefit');
      }
      // Both high = compromise
      else if (riskScore > 0.6 && opportunityScore > 0.6) {
        decision = 'COMPROMISE';
        reasoning.push('Both positions valid - deploy as controlled experiment');
      }
      // Both low = approve with monitoring
      else {
        decision = 'APPROVE_WITH_MONITORING';
        reasoning.push('Moderate risk and opportunity - proceed with caution');
      }

      this.logger.info(`[${this.name}]    Decision: ${decision}`);
      this.logger.info(`[${this.name}]    Risk: ${(riskScore * 100).toFixed(0)}%, Opportunity: ${(opportunityScore * 100).toFixed(0)}%`);

      // Send mediation result
      await messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'mediation_complete',
        payload: {
          proposal,
          decision,
          reasoning,
          riskScore,
          opportunityScore
        }
      });

      return { success: true, decision, reasoning };

    } catch (err) {
      this.logger.error(`[${this.name}] mediateConflict error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleGoalConcern(payload) {
    try {
      const { goalId, concern, conservativeAlternative } = payload;

      const goal = this.goals.get(goalId);
      if (!goal) {
        return { success: false, error: 'Goal not found' };
      }

      this.logger.warn(`[${this.name}] ⚠️  Conservative concern raised for goal: ${goal.title}`);
      this.logger.warn(`[${this.name}]    ${concern}`);

      // Add metadata noting the concern
      goal.metadata.conservativeConcerns = goal.metadata.conservativeConcerns || [];
      goal.metadata.conservativeConcerns.push({
        concern,
        alternative: conservativeAlternative,
        timestamp: Date.now()
      });

      // Lower priority slightly if multiple concerns
      if (goal.metadata.conservativeConcerns.length > 2) {
        goal.priority = Math.max(0, goal.priority - 10);
        this.logger.info(`[${this.name}]    Lowered priority to ${goal.priority} due to repeated concerns`);
      }

      return { success: true };

    } catch (err) {
      this.logger.error(`[${this.name}] handleGoalConcern error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async handleGoalEnhancement(payload) {
    try {
      const { goalId, suggestion, progressiveEnhancement } = payload;

      const goal = this.goals.get(goalId);
      if (!goal) {
        return { success: false, error: 'Goal not found' };
      }

      this.logger.info(`[${this.name}] 💡 Progressive enhancement suggested for goal: ${goal.title}`);
      this.logger.info(`[${this.name}]    ${suggestion}`);

      // Add metadata noting the enhancement
      goal.metadata.progressiveEnhancements = goal.metadata.progressiveEnhancements || [];
      goal.metadata.progressiveEnhancements.push({
        suggestion,
        enhancement: progressiveEnhancement,
        timestamp: Date.now()
      });

      // Increase priority slightly if aligned with growth
      if (goal.category === 'capability' || goal.category === 'learning') {
        goal.priority = Math.min(100, goal.priority + 10);
        this.logger.info(`[${this.name}]    Increased priority to ${goal.priority} (aligned with growth)`);
      }

      return { success: true };

    } catch (err) {
      this.logger.error(`[${this.name}] handleGoalEnhancement error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PLANNING LOOP ░░
  // ═══════════════════════════════════════════════════════════

  startPlanningLoop() {
    const intervalMs = this.planningIntervalHours * 60 * 60 * 1000;

    // Run once immediately so plan.md is written right after boot
    setTimeout(() => this.runPlanningCycle().catch(() => {}), 5_000);

    this.planningInterval = setInterval(async () => {
      await this.runPlanningCycle();
    }, intervalMs);

    this.logger.info(`[${this.name}] Planning loop started (every ${this.planningIntervalHours}h, first run in 5s)`);
  }

  _readPlanMd() {
    try {
      if (fs.existsSync(this.planPath)) {
        return fs.readFileSync(this.planPath, 'utf8');
      }
    } catch (_) {}
    return null;
  }

  async runPlanningCycle() {
    this.logger.info(`[${this.name}] 🧠 Running planning cycle...`);

    // Log plan context so SOMA has continuity
    const plan = this._readPlanMd();
    if (plan) {
      this.logger.info(`[${this.name}] 📋 Current plan loaded (${plan.split('\n').length} lines)`);
    }

    try {
      // Rebalance priorities
      await this.rebalancePriorities();

      // Prune stale goals before dispatching
      await this._pruneStaleGoals();

      // Check for stalled goals
      await this.reviewStalledGoals();

      // Calculate statistics
      this.updateStatistics();

      // Decay priority on goals that have made no progress for >1 week
      this._decayStaleGoalPriorities();

      // Dispatch the highest-priority pending goal
      await this._dispatchHighestPriorityGoal();

      this.logger.info(`[${this.name}] Planning cycle complete`);
      this.logger.info(`[${this.name}]    Active: ${this.activeGoals.size}, Completed: ${this.completedGoals.length}, Failed: ${this.failedGoals.length}`);

      // Always write plan.md at end of every cycle — independent of _dirty flag
      this._writePlanMd();

      return { success: true };
    } catch (err) {
      this.logger.error(`[${this.name}] Planning cycle error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Reduce priority on goals with no progress for >1 week — 5 pts/week, floor 10
  _decayStaleGoalPriorities() {
    const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
    const DECAY_PER_WEEK = 5;
    const MIN_PRIORITY   = 10;
    const REVIEW_THRESHOLD = 20; // flag for attention when priority drops this low
    const now = Date.now();
    let decayed = 0;

    for (const [, goal] of this.goals) {
      if (goal.status !== 'active' && goal.status !== 'pending') continue;
      if ((goal.metrics?.progress ?? 0) > 0) continue; // progress resets the clock

      const lastTouch = goal.metadata?.lastProgressAt || goal.startedAt || goal.createdAt || now;
      const weeksStale = (now - lastTouch) / ONE_WEEK;
      if (weeksStale < 1) continue;

      const decayAmount = Math.floor(DECAY_PER_WEEK * weeksStale);
      const newPriority = Math.max(MIN_PRIORITY, goal.priority - decayAmount);
      if (newPriority >= goal.priority) continue;

      goal.priority = newPriority;
      goal.metadata = goal.metadata || {};
      goal.metadata.decayedAt = now;
      goal.metadata.weeksStale = Math.round(weeksStale * 10) / 10;

      if (newPriority <= REVIEW_THRESHOLD && !goal.metadata.flaggedForReview) {
        goal.metadata.flaggedForReview = true;
        this.logger.warn(`[${this.name}] ⚠️ Goal flagged for review (priority ${newPriority}, ${Math.round(weeksStale)}w stale): "${goal.title}"`);
      }

      this._dirty = true;
      decayed++;
    }

    if (decayed > 0) {
      this.logger.info(`[${this.name}] ⏬ Priority decayed on ${decayed} stale goal(s)`);
    }
  }

  // Pick the highest-priority pending (or proposed) goal and dispatch it
  async _dispatchHighestPriorityGoal() {
    // Include 'proposed' goals — NEMESIS already vetted them; waiting for human approval is too slow
    // for autonomous operation. High-priority goals get dispatched regardless of proposed/pending.
    const pending = Array.from(this.activeGoals)
      .map(id => this.goals.get(id))
      .filter(g => g && (g.status === 'pending' || g.status === 'proposed') && this.areDependenciesSatisfied(g))
      .sort((a, b) => b.priority - a.priority);

    if (pending.length === 0) return;

    let top = pending[0];
    this.logger.info(`[${this.name}] 🚀 Dispatching highest-priority goal: "${top.title}" (priority ${top.priority})`);

    // Fix 5: Decompose complex/vague goals into concrete ordered sub-goals before Heartbeat executes
    if (this._isComplexGoal(top)) {
      this.logger.info(`[${this.name}] 🔬 Goal appears vague — attempting decomposition: "${top.title}"`);
      const decomposition = await this.decomposeGoal(top.id, this.name);
      if (decomposition.success) {
        this.logger.info(`[${this.name}] 📐 Decomposed into ${decomposition.childGoalIds.length} sub-goals`);
        // Re-select the top pending goal after adding sub-goals
        const newPending = Array.from(this.activeGoals)
          .map(id => this.goals.get(id))
          .filter(g => g && (g.status === 'pending' || g.status === 'proposed') && this.areDependenciesSatisfied(g))
          .sort((a, b) => b.priority - a.priority);
        if (newPending.length === 0) return;
        top = newPending[0];
        this.logger.info(`[${this.name}] 🔄 Now dispatching first sub-goal: "${top.title}"`);
      }
      // If decomposition failed or returned <2 items, fall through to dispatch the original
    }

    // Mark as active so it doesn't get dispatched again next cycle
    this.transitionGoal(top.id, STATUS.ACTIVE, { reason: 'planning_dispatch', actor: this.name });
    this._dirty = true;

    // Goal is now 'active' — AutonomousHeartbeat is the sole executor (polls activeGoals every 2 min).
    // We do NOT send goal_assigned here to avoid racing with the Heartbeat's SomaAgenticExecutor path.
    this.logger.info(`[${this.name}] 🟢 Goal ready for Heartbeat execution: "${top.title}"`);

    // Broadcast so DriveArbiter and other listeners know work started
    messageBroker.sendMessage({
      from: this.name, to: 'broadcast',
      type: 'goal_started',
      payload: { title: top.title, goalId: top.id, priority: top.priority }
    }).catch(() => {});
  }

  // Auto-cancel goals that have been active for stalledThresholdDays with 0 progress
  async _pruneStaleGoals() {
    const now   = Date.now();
    const limit = this.stalledThresholdDays * 24 * 60 * 60 * 1000;
    const pruned = [];

    for (const goalId of this.activeGoals) {
      const goal = this.goals.get(goalId);
      if (!goal) continue;

      const timeSinceUpdate = now - (goal.updatedAt || goal.startedAt || goal.createdAt || now);
      const progress = goal.metrics?.progress ?? 0;

      if (timeSinceUpdate > limit && progress < 100) {
        pruned.push(goal);
      }
    }

    for (const goal of pruned) {
      const progressPct = Math.round((goal.metrics?.progress ?? 0) * 100);
      this.logger.warn(`[${this.name}] 🗑️ Auto-pruning stale goal: "${goal.title}" (${progressPct}% progress, ${Math.floor((now - goal.createdAt) / 86400000)}d old)`);
      await this.cancelGoal(goal.id, `Auto-pruned: Stalled at ${progressPct}% progress for ${this.stalledThresholdDays} days`);
    }

    if (pruned.length > 0) {
      this.logger.info(`[${this.name}] Pruned ${pruned.length} stale goal(s) — slots freed for new work`);
    }

    return pruned.length;
  }

  startMonitoringLoop() {
    // Check stalled goals every hour
    this.monitoringInterval = setInterval(async () => {
      await this.reviewStalledGoals();
      await this._verifyHighProgressGoals();
    }, 60 * 60 * 1000);
    
    this.logger.info(`[${this.name}] Monitoring loop started (every 1h)`);
  }

  async _verifyHighProgressGoals() {
    const highProgress = [];
    const now = Date.now();
    for (const goalId of this.activeGoals) {
      const goal = this.goals.get(goalId);
      const progress = goal?.metrics?.progress ?? 0;
      const lastUpdate = goal.updatedAt || goal.startedAt || goal.createdAt || now;
      // If stuck at >= 80% for more than 1 hour
      if (progress >= 80 && progress < 100 && (now - lastUpdate) > 3600000) {
        highProgress.push(goal);
      }
    }

    if (highProgress.length > 0) {
      this.logger.warn(`[${this.name}] 🔍 Found ${highProgress.length} goal(s) stuck near completion.`);
      for (const goal of highProgress) {
        this.logger.info(`[${this.name}]    -> Auto-verifying high-progress goal: "${goal.title}"`);
        await this.completeGoal(goal.id, {
          result: 'Auto-verified during high-progress sweep.',
          summary: `Goal was stuck at ${goal.metrics.progress}% and uncommitted. Automatically verified to unblock pipeline.`
        }).catch(err => this.logger.error(`[${this.name}] Failed to auto-verify goal ${goal.id}: ${err.message}`));
      }
    }
  }

  async reviewStalledGoals() {
    const stalled = [];

    for (const goalId of this.activeGoals) {
      const goal = this.goals.get(goalId);
      if (this.isGoalStalled(goal)) {
        stalled.push(goal);
      }
    }

    if (stalled.length === 0) return;

    this.logger.warn(`[${this.name}] ⚠️  Found ${stalled.length} stalled goal(s)`);

    for (const goal of stalled) {
      const stalledDays = Math.floor((Date.now() - goal.startedAt) / 86400000);
      const progress    = goal.metrics?.progress ?? 0;

      this.logger.warn(`[${this.name}]    - "${goal.title}" (${progress}% progress, ${stalledDays}d stalled)`);

      // Goals stalled > 2x the threshold with <10% progress get auto-cancelled
      // Goals stalled > threshold but with some progress get deprioritized instead
      if (stalledDays > this.stalledThresholdDays * 2 && progress < 10) {
        this.logger.warn(`[${this.name}]    → Auto-cancelling: stalled ${stalledDays}d with <10% progress`);
        await this.cancelGoal(goal.id, `Auto-cancelled: stalled ${stalledDays} days with ${progress}% progress`);
      } else {
        // Deprioritize — drop priority so higher-value goals jump ahead
        const oldPriority = goal.priority;
        goal.priority     = Math.max(0, goal.priority - 20);
        this._dirty       = true;
        this.logger.info(`[${this.name}]    → Deprioritized: ${oldPriority} → ${goal.priority}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ STATISTICS ░░
  // ═══════════════════════════════════════════════════════════

  updateStatistics() {
    // Calculate goals per week
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const recentGoals = this.completedGoals.filter(g => g.completedAt > oneWeekAgo);
    this.stats.goalsPerWeek = recentGoals.length;
  }

  updateAverageCompletionTime(completedGoal) {
    const duration = completedGoal.completedAt - completedGoal.startedAt;
    
    if (this.stats.goalsCompleted === 1) {
      this.stats.avgCompletionTime = duration;
    } else {
      // Running average
      this.stats.avgCompletionTime = 
        (this.stats.avgCompletionTime * (this.stats.goalsCompleted - 1) + duration) / 
        this.stats.goalsCompleted;
    }
  }

  compactDeferredGoals(options = {}) {
    const maxRetained = Math.max(1, Number(options.maxRetained || process.env.SOMA_MAX_DEFERRED_GOALS || 100));
    const olderThanMs = Math.max(24 * 60 * 60_000, Number(options.olderThanMs || 30 * 24 * 60 * 60_000));
    const now = Number(options.now || Date.now());
    const deferred = Array.from(this.goals.values())
      .filter(goal => goal.status === STATUS.DEFERRED && !this.activeGoals.has(goal.id))
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
    const archive = deferred.filter((goal, index) => index >= maxRetained || now - Number(goal.createdAt || 0) >= olderThanMs);
    if (!archive.length) return { archived: 0, retained: deferred.length, path: null };

    const archiveDir = path.join(this.dataDir, 'goal-archives');
    const archivePath = path.join(archiveDir, `deferred-${new Date(now).toISOString().slice(0, 7)}.jsonl`);
    fs.mkdirSync(archiveDir, { recursive: true });
    fs.appendFileSync(archivePath, archive.map(goal => JSON.stringify({
      archivedAt: now,
      reason: 'deferred_retention_compaction',
      goal
    })).join('\n') + '\n', 'utf8');
    for (const goal of archive) this.goals.delete(goal.id);
    this._dirty = true;
    return { archived: archive.length, retained: deferred.length - archive.length, path: archivePath };
  }

  async runLifecycleCanary() {
    const now = Date.now();
    const directory = path.join(this.dataDir, 'goal-canary');
    const artifact = path.join(directory, 'artifact.json');
    const reportPath = path.join(directory, 'latest.json');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(artifact, JSON.stringify({ createdAt: now, nonce: crypto.randomUUID() }), 'utf8');
    const relativeArtifact = path.relative(process.cwd(), artifact).replace(/\\/g, '/');
    const id = `goal-lifecycle-canary-${now}`;
    const goal = defaultLearningSpine.applyGoalContract({
      id,
      type: 'operational',
      category: 'system_canary',
      title: 'Goal lifecycle canary',
      description: 'Verify local artifact completion without an LLM, network request, or external service.',
      status: STATUS.ACTIVE,
      metrics: { progress: 99 },
      createdAt: now,
      startedAt: now,
      verification: { profile: 'operational', evidenceRequired: ['summary', 'artifact'], filesExist: [relativeArtifact] },
      metadata: { lifecycleCanary: true }
    });
    this.goals.set(id, goal);
    this.activeGoals.add(id);
    try {
      const completion = await this.completeGoal(id, {
        summary: 'Local lifecycle canary artifact was written and read back.',
        evidence: { artifact: relativeArtifact },
        silent: true
      });
      const report = {
        checkedAt: new Date().toISOString(),
        passed: completion.success === true && completion.verification?.passed === true && goal.status === STATUS.COMPLETED,
        verification: completion.verification || null,
        error: completion.error || null
      };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      if (!report.passed) throw new Error(completion.error || 'Lifecycle canary did not reach verified completion');
      return { ...report, path: reportPath };
    } finally {
      this.activeGoals.delete(id);
      this.goals.delete(id);
      this.completedGoals = this.completedGoals.filter(item => item.id !== id);
      try { fs.unlinkSync(artifact); } catch {}
    }
  }

  getStatistics() {
    return {
      ...this.stats,
      activeGoals: this.activeGoals.size,
      humanReservedSlots: this.humanReservedSlots,
      lifecycleStates: Array.from(this.goals.values()).reduce((counts, goal) => {
        const state = deriveGoalState(goal);
        counts[state] = (counts[state] || 0) + 1;
        return counts;
      }, {}),
      completedGoals: this.completedGoals.length,
      failedGoals: this.failedGoals.length,
      successRate: this.stats.goalsCompleted / Math.max(1, this.stats.goalsCompleted + this.stats.goalsFailed),
      avgCompletionDays: this.stats.avgCompletionTime / 86400000,
      nemesis: this.getNemesisStats()
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PERSISTENCE ░░
  // ═══════════════════════════════════════════════════════════

  _saveToDisk() {
    try {
      // Ensure data directory exists
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      // Only persist active goals + recently deferred/completed (last 7 days)
      // This prevents the goals.json file from growing unbounded
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const goalsToSave = {};
      for (const [id, goal] of this.goals) {
        if (this.activeGoals.has(id)) {
          goalsToSave[id] = goal; // Always save active goals
        } else {
          const age = now - (goal.completedAt || goal.createdAt || 0);
          if (age < SEVEN_DAYS) {
            goalsToSave[id] = goal; // Save recent non-active goals
          }
        }
      }

      const snapshot = {
        version: 1,
        savedAt: now,
        goals: goalsToSave,
        activeGoals: Array.from(this.activeGoals),
        completedGoals: this.completedGoals.slice(0, this.maxCompletedHistory),
        failedGoals: this.failedGoals.slice(0, 50),
        stats: this.stats
      };

      atomicWriteJson(this.persistPath, snapshot);
      this._dirty = false;
      this.logger.info(`[${this.name}] 💾 Saved ${this.goals.size} goals to disk`);
      this._writePlanMd();
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to save goals: ${err.message}`);
    }
  }

  _writePlanMd() {
    try {
      const now = new Date();
      const ts = now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

      const allGoals = Array.from(this.goals.values());
      const proposed  = allGoals.filter(g => g.status === 'proposed').sort((a, b) => b.priority - a.priority);
      const active    = allGoals.filter(g => g.status === 'active').sort((a, b) => b.priority - a.priority);
      const pending   = allGoals.filter(g => g.status === 'pending').sort((a, b) => b.priority - a.priority);
      const completed = this.completedGoals.slice(0, 20);
      const failed    = this.failedGoals.slice(0, 10);

      const fmtGoal = (g, checked = false) => {
        const box = checked ? '[x]' : '[ ]';
        const state = ` · ${deriveGoalState(g)}`;
        const quality = g.metadata?.quality?.score != null ? ` · Q${g.metadata.quality.score}` : '';
        const verify = g.metadata?.lastVerification
          ? ` · verify ${g.metadata.lastVerification.passed ? 'pass' : 'fail'} ${g.metadata.lastVerification.score}%`
          : '';
        const desc = g.description ? `\n  > ${g.description.substring(0, 120)}` : '';
        return `- ${box} **${g.title}** *(priority: ${g.priority}${quality}${verify}${state})*${desc}`;
      };

      // Prepend the owner's priority notes if PRIORITIES.md exists
      const prioritiesPath = path.join(process.cwd(), 'SOMA', 'PRIORITIES.md');
      let prioritiesBlock = '';
      try {
        if (fs.existsSync(prioritiesPath)) {
          prioritiesBlock = fs.readFileSync(prioritiesPath, 'utf8').trim() + '\n\n---\n\n';
        }
      } catch (_) {}

      let md = prioritiesBlock + `# SOMA's Plan\n\n*Last updated: ${ts}*\n\n`;

      if (proposed.length) {
        md += `## ⏳ Awaiting Approval\n${proposed.map(g => fmtGoal(g)).join('\n')}\n\n`;
      }
      if (active.length) {
        md += `## 🔥 Active\n${active.map(g => fmtGoal(g)).join('\n')}\n\n`;
      }
      if (pending.length) {
        md += `## 🕐 Queued\n${pending.map(g => fmtGoal(g)).join('\n')}\n\n`;
      }
      const verificationFailed = allGoals.filter(g => g.status === 'verification_failed').sort((a, b) => b.priority - a.priority);
      if (verificationFailed.length) {
        md += `## 🧪 Verification Failed\n${verificationFailed.map(g => fmtGoal(g)).join('\n')}\n\n`;
      }
      if (completed.length) {
        md += `## ✅ Completed\n${completed.map(g => fmtGoal(g, true)).join('\n')}\n\n`;
      }
      if (failed.length) {
        md += `## ❌ Rejected / Failed\n${failed.map(g => `- ~~${g.title}~~ *(${g.metadata?.rejectionReason || g.status})*`).join('\n')}\n\n`;
      }

      md += `---\n*${this.goals.size} goals tracked · ${active.length} active · Tension: ${Math.round((this.lastTension || 0) * 100)}%*\n`;

      // Ensure SOMA/ directory exists
      const dir = path.dirname(this.planPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      fs.writeFileSync(this.planPath, md, 'utf8');

      // Notify frontend
      messageBroker.sendMessage({
        from: this.name,
        to: 'broadcast',
        type: 'plan_updated',
        payload: { content: md, updatedAt: now.toISOString() }
      }).catch(() => {});

    } catch (err) {
      this.logger.error(`[${this.name}] Failed to write plan.md: ${err.message}`);
    }
  }

  async _loadFromDisk() {
    try {
      if (!fs.existsSync(this.persistPath)) {
        this.logger.info(`[${this.name}] No persisted goals found, starting fresh`);
        return;
      }

      const loaded = readJsonWithRecovery(this.persistPath);
      const snapshot = loaded.value;
      if (loaded.recovered) {
        this.logger.warn(`[${this.name}] Recovered goal ledger from backup: ${loaded.source}`);
        this._dirty = true;
      }

      // Restore goals map
      if (snapshot.goals) {
        this.goals = new Map(Object.entries(snapshot.goals));
      }

      // Backfill verifiable contracts for older goals created before the
      // LearningSpine existed. This prevents legacy vague goals from getting
      // permanently trapped at 95% with no evidence contract.
      let contractBackfills = 0;
      for (const [id, goal] of this.goals) {
        if (!goal?.metadata?.goalContract) {
          const patched = defaultLearningSpine.applyGoalContract(goal);
          this.goals.set(id, {
            ...goal,
            successCriteria: patched.successCriteria,
            verification: patched.verification,
            metadata: {
              ...(goal.metadata || {}),
              ...(patched.metadata || {})
            }
          });
          contractBackfills++;
        }
      }
      if (contractBackfills > 0) {
        this.logger.info(`[${this.name}] 🧠 Backfilled learning contracts for ${contractBackfills} legacy goal(s)`);
        this._dirty = true;
      }

      // June 2026 ledgers may contain `{}` because async verifyGoal() was
      // stored without await. Recover only that unmistakable corruption
      // signature; never infer completion or weaken the goal contract.
      let asyncVerificationRecoveries = 0;
      for (const goal of this.goals.values()) {
        const verification = goal?.metadata?.lastVerification;
        const isEmptyObject = verification && typeof verification === 'object' &&
          !Array.isArray(verification) && Object.keys(verification).length === 0;
        if (!isEmptyObject) continue;
        goal.metadata = { ...(goal.metadata || {}) };
        delete goal.metadata.lastVerification;
        goal.metadata.executionAttempts = 0;
        goal.metadata.verificationRecovery = {
          reason: 'async_verifier_promise_was_not_awaited',
          recoveredAt: Date.now()
        };
        goal.metrics = { ...(goal.metrics || {}), progress: Math.min(Number(goal.metrics?.progress || 0), 65) };
        if ([STATUS.VERIFICATION_FAILED, STATUS.BROKEN].includes(goal.status)) {
          transitionGoal(goal, STATUS.PENDING, {
            reason: 'recover_async_verification_serialization',
            actor: this.name,
            force: true
          });
        }
        asyncVerificationRecoveries++;
      }
      if (asyncVerificationRecoveries > 0) {
        this.logger.warn(`[${this.name}] Recovered ${asyncVerificationRecoveries} goal(s) from async verification serialization corruption`);
        this._dirty = true;
      }

      // A verification failure is terminal only when no resumable work exists.
      // Older executors persisted observations but marked the goal terminal,
      // causing every subsequent heartbeat to skip it forever.
      let continuationRecoveries = 0;
      for (const [id, goal] of this.goals) {
        if (goal?.status !== 'verification_failed') continue;
        const continuationFile = goal.metadata?.continuationFile || path.join(process.cwd(), 'data', 'goal-progress', `${id}.json`);
        if (!fs.existsSync(continuationFile)) continue;
        transitionGoal(goal, STATUS.PENDING, {
          reason: 'recovered_verified_continuation',
          actor: this.name,
          force: true
        });
        goal.metrics = { ...(goal.metrics || {}), progress: Math.min(goal.metrics?.progress || 0, 75) };
        goal.metadata = {
          ...(goal.metadata || {}),
          incompleteReason: 'recovered_verified_continuation',
          continuationFile,
          recoveredAt: Date.now()
        };
        continuationRecoveries++;
      }
      if (continuationRecoveries > 0) {
        this.logger.warn(`[${this.name}] Recovered ${continuationRecoveries} verification-failed goal(s) with continuation artifacts`);
        this._dirty = true;
      }

      let inheritedApprovals = 0;
      for (const goal of this.goals.values()) {
        if (goal.status !== STATUS.PROPOSED || !goal.metadata?.measurableDecomposition) continue;
        const parent = this.goals.get(goal.metadata.parentGoalId);
        if (!parent?.approved) continue;
        transitionGoal(goal, STATUS.PENDING, {
          reason: 'inherits_approved_parent_goal',
          actor: this.name,
          force: true
        });
        goal.approved = true;
        inheritedApprovals++;
      }
      if (inheritedApprovals > 0) {
        this.logger.info(`[${this.name}] Activated ${inheritedApprovals} measurable child goal(s) from approved parents`);
        this._dirty = true;
      }

      // Restore active goals set — but never resurrect terminal-status goals
      // into active slots. Stale failed/verification_failed corpses occupied
      // the cap for a month (May–June 2026) and blocked all new goal creation
      // ("Active goal limit reached (20)") because nothing evicted them.
      if (snapshot.activeGoals) {
        const restored = snapshot.activeGoals.filter(id => this.goals.has(id));
        const live = restored.filter(id => !GoalPlannerArbiter.TERMINAL_STATUSES.has(this.goals.get(id)?.status));
        if (live.length < restored.length) {
          this.logger.warn(`[${this.name}] 🧹 Evicted ${restored.length - live.length} terminal-status goal(s) from the active set on restore`);
          this._dirty = true;
        }
        this.activeGoals = new Set(live);
      }

      // ═══ ENFORCE maxActiveGoals ON RESTORE ═══
      // If disk had more active goals than our limit, trim to the highest-priority ones
      if (this.activeGoals.size > this.maxActiveGoals) {
        const sorted = Array.from(this.activeGoals)
          .map(id => this.goals.get(id))
          .filter(Boolean)
          .sort((a, b) => {
            if (isHumanGoal(a) !== isHumanGoal(b)) return isHumanGoal(a) ? -1 : 1;
            return b.priority - a.priority;
          });

        const keep = new Set(sorted.slice(0, this.maxActiveGoals).map(g => g.id));
        const excess = sorted.slice(this.maxActiveGoals);

        for (const goal of excess) {
          transitionGoal(goal, STATUS.DEFERRED, { reason: 'active_limit_restore_trim', actor: this.name, force: true });
          goal.metadata = goal.metadata || {};
          goal.metadata.deferredReason = 'Trimmed on restore — exceeded maxActiveGoals';
          this.activeGoals.delete(goal.id);
        }

        this.logger.warn(`[${this.name}] ⚠️ Trimmed ${excess.length} excess active goals on restore (limit: ${this.maxActiveGoals})`);
      }

      // ═══ DEDUP ACTIVE GOALS ON LOAD ═══
      // External tools (or direct file edits) can inject duplicate goals that bypass
      // createGoal()'s runtime dedup check. Run dedup on every restore so the file
      // never accumulates duplicates regardless of how they got there.
      {
        const seen = new Map(); // intentKey -> first goal id
        const dupIds = new Set();
        for (const id of Array.from(this.activeGoals)) {
          const g = this.goals.get(id);
          if (!g) continue;
          const sig = this._goalIntentSignature(g);
          const normalized = sig.key || (g.title || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
          if (seen.has(normalized)) {
            // Keep the one with higher priority; defer the other
            const existingId = seen.get(normalized);
            const existing = this.goals.get(existingId);
            if ((g.priority || 0) > (existing?.priority || 0)) {
              dupIds.add(existingId);
              seen.set(normalized, id);
            } else {
              dupIds.add(id);
            }
          } else {
            seen.set(normalized, id);
          }
        }
        if (dupIds.size > 0) {
          for (const id of dupIds) {
            const g = this.goals.get(id);
            if (g) {
              transitionGoal(g, STATUS.DEFERRED, { reason: 'duplicate_on_restore', actor: this.name, force: true });
              g.metadata = { ...(g.metadata || {}), deferredReason: 'Duplicate on restore' };
            }
            this.activeGoals.delete(id);
          }
          this.logger.warn(`[${this.name}] 🔍 Deduped ${dupIds.size} duplicate active goal(s) on restore`);
          this._dirty = true; // Persist dedup so file doesn't re-accumulate on every restart
        }
      }

      const deferredCompaction = this.compactDeferredGoals();
      if (deferredCompaction.archived > 0) {
        this.logger.info(`[${this.name}] Archived ${deferredCompaction.archived} deferred goal(s) to ${deferredCompaction.path}`);
      }

      // ═══ PRUNE OLD NON-ACTIVE GOALS FROM MAP ═══
      // Remove deferred/completed/failed goals older than 30 days to prevent unbounded Map growth
      const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      let pruned = 0;
      for (const [id, goal] of this.goals) {
        if (this.activeGoals.has(id)) continue; // never prune active goals
        const age = now - (goal.completedAt || goal.createdAt || 0);
        if (age > THIRTY_DAYS && (goal.status === 'deferred' || goal.status === 'completed' || goal.status === 'failed')) {
          this.goals.delete(id);
          pruned++;
        }
      }
      if (pruned > 0) {
        this.logger.info(`[${this.name}] 🧹 Pruned ${pruned} old non-active goals from Map`);
      }

      // Restore archives (cap sizes)
      if (snapshot.completedGoals) {
        this.completedGoals = snapshot.completedGoals.slice(0, this.maxCompletedHistory);
      }
      if (snapshot.failedGoals) {
        this.failedGoals = snapshot.failedGoals.slice(0, 50);
      }

      // Restore stats
      if (snapshot.stats) {
        this.stats = { ...this.stats, ...snapshot.stats };
      }

      if (this._dirty) this._saveToDisk();
      this.logger.info(`[${this.name}] 📂 Restored ${this.goals.size} goals (${this.activeGoals.size} active, ${this.completedGoals.length} completed)`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to load goals: ${err.message} — starting fresh`);
    }
  }

  async _handleQueryPlan(envelope) {
    // Generate the plan content (re-use _writePlanMd logic without writing to file)
    const now = new Date();
    const ts = now.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

    const allGoals = Array.from(this.goals.values());
    const proposed  = allGoals.filter(g => g.status === 'proposed').sort((a, b) => b.priority - a.priority);
    const active    = allGoals.filter(g => g.status === 'active').sort((a, b) => b.priority - a.priority);
    const pending   = allGoals.filter(g => g.status === 'pending').sort((a, b) => b.priority - a.priority);
    const completed = this.completedGoals.slice(0, 20);
    const failed    = this.failedGoals.slice(0, 10);

    const fmtGoal = (g, checked = false) => {
      const box = checked ? '[x]' : '[ ]';
      const state = ` · ${deriveGoalState(g)}`;
      const desc = g.description ? `\n  > ${g.description.substring(0, 120)}` : '';
      return `- ${box} **${g.title}** *(priority: ${g.priority}${state})*${desc}`;
    };

    let md = `# SOMA's Plan\n\n*Last updated: ${ts}*\n\n`;

    if (proposed.length) {
      md += `## ⏳ Awaiting Approval\n${proposed.map(g => fmtGoal(g)).join('\n')}\n\n`;
    }
    if (active.length) {
      md += `## 🔥 Active\n${active.map(g => fmtGoal(g)).join('\n')}\n\n`;
    }
    if (pending.length) {
      md += `## 🕐 Queued\n${pending.map(g => fmtGoal(g)).join('\n')}\n\n`;
    }
    if (completed.length) {
      md += `## ✅ Completed\n${completed.map(g => fmtGoal(g, true)).join('\n')}\n\n`;
    }
    if (failed.length) {
      md += `## ❌ Rejected / Failed\n${failed.map(g => `- ~~${g.title}~~ *(${g.metadata?.rejectionReason || g.status})*`).join('\n')}\n\n`;
    }

    md += `---\n*${this.goals.size} goals tracked · ${active.length} active · Tension: ${Math.round((this.lastTension || 0) * 100)}%*\n`;

    // Send the plan content back
    return { success: true, plan: md, updatedAt: now.toISOString() };
  }

  async approveGoal(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }

    if (goal.status !== 'proposed') {
      return { success: false, reason: 'Goal is not in a proposed state' };
    }

    // Approval makes the goal runnable; startGoal owns the active transition.
    goal.approved = true;
    const approvedTransition = this.transitionGoal(goalId, STATUS.PENDING, { reason: 'human_approved', actor: this.name });
    if (!approvedTransition.success) return approvedTransition;

    this._dirty = true;
    this._saveToDisk();

    await messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'goal_approved',
      payload: { goalId: goal.id, goal }
    });

    this.logger.info(`[${this.name}] ✅ Approved and activated goal: ${goal.title} (${goal.id.slice(0, 8)})`);

    // Now start the goal, which will handle assigned tasks etc.
    // Ensure startGoal is idempotent and doesn't re-assign if already active.
    return await this.startGoal(goal.id);
  }

  async rejectGoal(goalId, reason = 'Rejected by user') {
    const goal = this.goals.get(goalId);
    if (!goal) {
      return { success: false, error: 'Goal not found' };
    }

    if (goal.status !== 'proposed') {
      return { success: false, reason: 'Goal is not in a proposed state' };
    }

    const rejectedTransition = this.transitionGoal(goalId, STATUS.REJECTED, { reason, actor: this.name });
    if (!rejectedTransition.success) return rejectedTransition;
    goal.approved = false;
    goal.metadata.rejectionReason = reason;

    this.failedGoals.unshift(goal); // Treat as failed for archival

    this._dirty = true;
    this._saveToDisk();

    await messageBroker.sendMessage({
      from: this.name,
      to: 'broadcast',
      type: 'goal_rejected',
      payload: { goalId: goal.id, goal, reason }
    });

    this.logger.info(`[${this.name}] 🚫 Rejected goal: ${goal.title} (${goal.id.slice(0, 8)}) - ${reason}`);

    return { success: true, goalId: goal.id };
  }

  async proposeQuestion(questionPayload) {
    if (!questionPayload || !questionPayload.question) {
      this.logger.error(`[${this.name}] proposeQuestion called with invalid payload.`);
      return { success: false, error: 'Invalid question payload' };
    }

    const questionId = crypto.randomUUID();
    const questionEvent = {
      from: this.name,
      to: 'broadcast', // Frontend will listen to this
      type: 'proactive_question',
      payload: {
        questionId,
        timestamp: Date.now(),
        ...questionPayload
      }
    };

    await messageBroker.sendMessage(questionEvent);
    this.logger.info(`[${this.name}] ❓ Proposed question: ${questionPayload.question} (ID: ${questionId.slice(0, 8)})`);

    return { success: true, questionId };
  }

  async handleQuestionResponse(payload) {
    const { questionId, response } = payload;
    this.logger.info(`[${this.name}] Received response for question ${questionId.slice(0, 8)}: "${response}"`);

    // Here you would typically process the response.
    // For example, update a goal's metadata, trigger a new action,
    // or log it for later analysis.
    // Since this is a placeholder, we'll just log it.

    // If the question was related to a stalled goal, we might now
    // take action based on the 'response'.
    // e.g., if response is 'Cancel this goal', call this.cancelGoal(goalId, 'User requested cancel');

    return { success: true, message: 'Question response processed' };
  }




  // ═══════════════════════════════════════════════════════════
  // ░░ AUTOPILOT CONTROL ░░
  // ═══════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════
  // ░░ NEMESIS PHASE 2.2: GOAL REALITY CHECKS ░░
  // ═══════════════════════════════════════════════════════════

  /**
   * Run NEMESIS numeric reality check on an autonomous goal proposal.
   *
   * Fate mapping (from PrometheusNemesis.determineFate):
   *   KILL     (<0.30) → Reject.  Goal is pure noise.
   *   MUTATE   (0.30-0.50) → Reject. Goal lacks substance/grounding.
   *   QUARANTINE (0.50-0.70) → Warn. Marginal but possible; tag nemesisWarning.
   *   ALLOW    (0.70-0.85) → Pass.  Decent goal.
   *   PROMOTE  (>=0.85) → Pass cleanly.  Well-grounded goal.
   */
  _nemesisRealityCheck(goal) {
    if (!this.nemesis) return { approved: true, score: 1.0, fate: 'PROMOTE' };

    this.nemesisStats.checked++;

    const desc = `${goal.title} ${goal.description} ${goal.metadata?.rationale || ''}`;

    // FRICTION: Concrete grounding in reality
    let friction = 0.2;
    if (/\d+/.test(desc)) friction += 0.15;                            // Has numbers
    if (goal.metrics?.target) friction += 0.15;                        // Has measurable target
    if (goal.dueDate) friction += 0.10;                                // Has due date
    if (/because|since|due to|based on|currently|threshold|detected/.test(desc.toLowerCase())) friction += 0.15;
    if (goal.description && goal.description.length > 50) friction += 0.10; // Substantive description
    friction = Math.min(1.0, friction);

    // CHARGE: Ambition level (higher = needs more friction to pass)
    const typeCharge = { strategic: 0.8, tactical: 0.55, operational: 0.45 };
    let charge = typeCharge[goal.type] || 0.5;
    if (/innovate|create|discover|transform|expand/.test(goal.title.toLowerCase())) charge += 0.1;
    charge = Math.min(1.0, charge);

    // MASS: Information density (confidence × normalized priority)
    const mass = Math.min(0.9, Math.max(0.1,
      (goal.metadata?.confidence || 0.5) * 0.6 + (goal.priority || 50) / 200
    ));

    const triography = { charge, friction, mass };
    const signature = `${goal.category}:${goal.title.substring(0, 50)}`;

    const result = this.nemesis.evaluateEmergent({
      triography,
      signature,
      sourceIds: [goal.metadata?.source || 'autonomous']
    });

    const score = result.aggregateScore;

    // KILL or MUTATE → reject (score < 0.50, 2+ critical tests failing)
    if (score < 0.50) {
      this.nemesisStats.rejected++;
      this.logger.warn(`[${this.name}] 🔴 NEMESIS REJECTED goal "${goal.title}" (score: ${score.toFixed(2)}, fate: ${result.fate})`);
      this.logger.warn(`[${this.name}]    friction=${friction.toFixed(2)}, charge=${charge.toFixed(2)}, mass=${mass.toFixed(2)} — goal lacks substance/grounding`);
      return {
        approved: false,
        score,
        fate: result.fate,
        reason: `NEMESIS ${result.fate}: score ${score.toFixed(2)} — goal lacks concrete grounding or measurable targets`
      };
    }

    // QUARANTINE (0.50-0.70) → warn but allow
    if (score < 0.70) {
      this.nemesisStats.warned++;
      this.logger.warn(`[${this.name}] ⚠️  NEMESIS QUARANTINE goal "${goal.title}" (score: ${score.toFixed(2)}) — marginal quality, tagging for review`);
      goal.metadata = goal.metadata || {};
      goal.metadata.nemesisWarning = true;
      goal.metadata.nemesisFate = result.fate;
      goal.metadata.nemesisScore = score;
    } else {
      // ALLOW or PROMOTE → clean pass
      this.nemesisStats.passed++;
      this.logger.info(`[${this.name}] ✅ NEMESIS ${result.fate} goal "${goal.title}" (score: ${score.toFixed(2)})`);
    }

    return { approved: true, score, fate: result.fate };
  }

  getNemesisStats() {
    const total = this.nemesisStats.checked;
    return {
      ...this.nemesisStats,
      rejectionRate: total > 0 ? ((this.nemesisStats.rejected / total) * 100).toFixed(1) + '%' : '0%',
      warnRate: total > 0 ? ((this.nemesisStats.warned / total) * 100).toFixed(1) + '%' : '0%'
    };
  }

  pauseAutonomous() {
    if (this._autonomousPaused) return;
    this._autonomousPaused = true;

    if (this.planningInterval) { clearInterval(this.planningInterval); this.planningInterval = null; }
    if (this.monitoringInterval) { clearInterval(this.monitoringInterval); this.monitoringInterval = null; }

    this.logger.info(`[${this.name}] ⏸️  Autonomous planning PAUSED`);
  }

  resumeAutonomous() {
    if (!this._autonomousPaused) return;
    this._autonomousPaused = false;

    this.startPlanningLoop();
    this.startMonitoringLoop();

    this.logger.info(`[${this.name}] ▶️  Autonomous planning RESUMED`);
  }

  isAutonomousActive() {
    return !this._autonomousPaused;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ LIFECYCLE ░░
  // ═══════════════════════════════════════════════════════════

  async shutdown() {
    this.logger.info(`[${this.name}] Shutting down...`);

    // Save before shutdown
    if (this._dirty) this._saveToDisk();

    if (this.planningInterval) {
      clearInterval(this.planningInterval);
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
    }
    if (this.canaryInterval) {
      clearInterval(this.canaryInterval);
    }

    await super.shutdown();
  }
}

module.exports = GoalPlannerArbiter;
