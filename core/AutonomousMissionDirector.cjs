'use strict';

const fs = require('fs');
const path = require('path');
const { isHumanGoal, STATUS, isTerminal } = require('./GoalLifecycle.cjs');
const { AutonomyScoreboard } = require('./AutonomyScoreboard.cjs');

const DEFAULT_CHARTER = Object.freeze({
  version: 2,
  objective: 'Continuously choose and finish one useful, bounded mission without waiting for a user prompt.',
  maxConcurrentAutonomousMissions: 1,
  minimumScore: 48,
  missionDeadlineHours: 24,
  maxSteps: 60,
  maxAttempts: 12,
  permittedCategories: [
    'research', 'learning', 'knowledge', 'knowledge_synthesis',
    'optimization', 'engineering', 'self_repair', 'capability', 'creative', 'asi_kernel'
  ],
  permittedTools: [
    'read_file', 'list_files', 'search_code',
    'computer_read', 'computer_list', 'computer_search',
    'web_fetch', 'github_search', 'memory_recall', 'memory_store',
    'write_file', 'save_progress', 'run_tests', 'verify_syntax', 'spawn_agents',
    'modify_code', 'pulse_stage_code'
  ],
  codeWriteRoots: ['core', 'arbiters', 'server', 'tests', 'scripts'],
  themeCooldownHours: 12,
  approvalRequired: [
    'live-money trading or financial transfers',
    'publishing, posting, replying, following, messaging, or contacting people',
    'deleting or moving owner files',
    'installing software or changing credentials, permissions, or security boundaries',
    'deploying or promoting code into production'
  ]
});

const ACTIVE_STATES = new Set([STATUS.PROPOSED, STATUS.PENDING, STATUS.ACTIVE, STATUS.DELEGATED]);
const RISK_PATTERNS = [
  /\b(live[- ]?(trade|money)|real[- ]?money|withdraw|transfer funds?|place (an? )?order)\b/i,
  /\b(post|publish|reply|message|dm|follow|unfollow|contact)\b.{0,40}\b(bluesky|discord|social|account|person|people|user)\b/i,
  /\b(delete|trash|remove|move)\b.{0,50}\b(file|folder|directory|owner|user)\b/i,
  /\b(password|credential|api[-_ ]?key|token|permission|security boundary)\b/i,
  /\b(install|deploy|production|release|push to main|merge to main)\b/i,
  /\b(disable|bypass|evade)\b.{0,30}\b(safety|approval|security|nemesis|max)\b/i,
  /\b(physical embodiment|robot body|hardware embodiment|build (a )?robot)\b/i
];

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizeCategory(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function wordSet(value) {
  return new Set(normalize(value).split(' ').filter(word => word.length > 3));
}

function similarity(a, b) {
  const left = wordSet(a);
  const right = wordSet(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  return overlap / Math.max(left.size, right.size);
}

function safeSlug(value) {
  return normalize(value).replace(/\s+/g, '-').slice(0, 48) || 'mission';
}

const CODE_ACTION_RE = /\b(build|implement|integrate|fix|repair|refactor|instrument|add|create|wire|migrate|replace|modify|improve|evolve|optimi[sz]e|harden|upgrade)\b/i;
const RESEARCH_ACTION_RE = /\b(research|survey|investigate|compare|study|review|synthesi[sz]e|paper|report)\b/i;
const DIAGNOSIS_ACTION_RE = /\b(diagnos(?:e|is|tic|tics)?|audit|inspect|analy[sz]e|measure|trace|identify)\b/i;
const BENCHMARK_ACTION_RE = /\b(benchmark|proving ground|stress test|load test|evaluation suite)\b/i;

function classifyDeliverable(proposal = {}) {
  const category = normalizeCategory(proposal.category);
  const text = `${proposal.title || ''} ${proposal.description || ''}`;
  if (BENCHMARK_ACTION_RE.test(text)) {
    return { kind: 'benchmark', profile: 'code', requiresCodeChange: true, requiresExecutableProof: true };
  }
  if (CODE_ACTION_RE.test(text) || category === 'engineering' || category === 'self_repair') {
    return { kind: 'code_change', profile: 'code', requiresCodeChange: true, requiresExecutableProof: true };
  }
  if (DIAGNOSIS_ACTION_RE.test(text) && !CODE_ACTION_RE.test(text)) {
    return { kind: 'diagnosis', profile: 'research', requiresCodeChange: false, requiresExecutableProof: false };
  }
  if (RESEARCH_ACTION_RE.test(text) || ['research', 'knowledge', 'knowledge_synthesis', 'learning', 'creative'].includes(category)) {
    return { kind: 'research_report', profile: 'research', requiresCodeChange: false, requiresExecutableProof: false };
  }
  return { kind: 'operational_artifact', profile: 'research', requiresCodeChange: false, requiresExecutableProof: false };
}

function themeKey(value = '') {
  const aliases = new Map([
    ['dashboard', 'monitoring'], ['monitoring', 'monitoring'], ['metrics', 'monitoring'],
    ['health', 'monitoring'], ['observability', 'monitoring'], ['telemetry', 'monitoring'],
    ['playwright', 'browser'], ['browseragentarbiter', 'browser'], ['browsing', 'browser'],
    ['literature', 'research'], ['survey', 'research']
  ]);
  const generic = new Set([
    'autonomous', 'mission', 'build', 'implement', 'integrate', 'create', 'make',
    'soma', 'system', 'bounded', 'verified', 'verifiable', 'real', 'time', 'own'
  ]);
  // Mission descriptions contain per-run UUIDs, timestamps, and measurements.
  // If those volatile tokens reach the sorted prefix below, two otherwise
  // identical missions receive different themes and bypass the cooldown.
  const stableValue = String(value || '')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, ' ')
    .replace(/\b\d{10,}\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:kb|mb|gb|tb|percent|pct)\b/gi, ' ');
  const terms = normalize(stableValue).split(' ')
    .map(term => aliases.get(term) || term)
    .filter(term => term.length > 3 && !generic.has(term));
  return [...new Set(terms)].sort().slice(0, 8).join(':');
}

function assessMissionValue(proposal = {}, history = []) {
  const text = `${proposal.title || ''} ${proposal.description || ''}`;
  const deliverable = classifyDeliverable(proposal);
  const ownerRequested = proposal.metadata?.ownerRequested === true || proposal.metadata?.humanRequested === true;
  const measurable = /\b(test|verify|measure|benchmark|compare|baseline|metric|receipt|endpoint|pass.fail)\b/i.test(text);
  const changesCapability = deliverable.requiresCodeChange || /\b(capability|reliability|recovery|latency|accuracy|completion)\b/i.test(text);
  const producesOnlyProse = !deliverable.requiresCodeChange && /\b(report|paper|document|playbook|summary|reflection)\b/i.test(text);
  const theme = themeKey(proposal.title || proposal.description || '');
  const comparable = (history || []).filter(item => item && item.id !== proposal.id && themeKey(item.title || item.description || '') === theme);
  const completedSimilar = comparable.filter(item => ['completed', 'promoted'].includes(item.status)).length;
  const failedSimilar = comparable.filter(item => ['failed', 'rejected'].includes(item.status)).length;
  const novelty = Math.max(0, 1 - Math.min(1, completedSimilar * 0.55 + failedSimilar * 0.2));
  const measurableImpact = measurable ? 1 : 0.25;
  const capabilityGain = changesCapability ? 1 : 0.35;
  const ownerValue = ownerRequested ? 1 : (/\b(owner|owner|user|discord|studio|trading|goal completion)\b/i.test(text) ? 0.8 : 0.55);
  const artifactOnlyRisk = producesOnlyProse && !measurable ? 0.8 : producesOnlyProse ? 0.35 : 0;
  const utilityScore = Math.max(0, Math.min(1,
    novelty * 0.28 + measurableImpact * 0.27 + capabilityGain * 0.3 + ownerValue * 0.15 - artifactOnlyRisk * 0.35
  ));
  return {
    utilityScore: Math.round(utilityScore * 100) / 100,
    novelty: Math.round(novelty * 100) / 100,
    measurableImpact,
    capabilityGain,
    ownerValue,
    artifactOnlyRisk,
    theme,
    reasons: {
      measurable,
      changesCapability,
      producesOnlyProse,
      completedSimilar,
      failedSimilar
    }
  };
}

function strategyFingerprint(value = '') {
  return normalize(value)
    .replace(/\b(change|different|strategy|approach|again|prior|previous|mission|failed)\b/g, ' ')
    .split(' ').filter(word => word.length > 3).sort().slice(0, 16).join(':');
}

class AutonomousMissionDirector {
  constructor({ planner, governor, dataDir = path.join(process.cwd(), 'data'), charter = null, logger = console, resourceStatus = null } = {}) {
    this.planner = planner || null;
    this.governor = governor || planner?.workGovernor || null;
    this.dataDir = dataDir;
    this.logger = logger;
    this.resourceStatus = typeof resourceStatus === 'function' ? resourceStatus : () => ({ level: 'normal' });
    this.charterPath = path.join(dataDir, 'autonomous-mission-charter.json');
    this.statePath = path.join(dataDir, 'autonomous-mission-state.json');
    this.charter = this._loadCharter(charter);
    this.scoreboard = new AutonomyScoreboard({ planner: this.planner, governor: this.governor, dataDir });
    this.state = this._readJson(this.statePath, {
      version: 1,
      cycles: 0,
      promotions: 0,
      verifiedCompletions: 0,
      failedMissions: 0,
      lastCycleAt: null,
      lastDecision: null,
      outcomes: []
    });
    this.state.lastPurposefulSeedAt ||= null;
  }

  initialize() {
    let migrated = 0;
    for (const goal of this.planner?.goals?.values?.() || []) {
      if (goal?.metadata?.autonomousMission !== true || !ACTIVE_STATES.has(goal.status)) continue;
      const requestedAttempts = Number(goal.metadata.maxAttempts || goal.maxAttempts || 0);
      const maxAttempts = goal.metadata.selfEvolution === true
        ? Math.max(1, Math.min(requestedAttempts || 3, this.charter.maxAttempts))
        : Math.max(requestedAttempts, this.charter.maxAttempts);
      goal.maxAttempts = maxAttempts;
      goal.metadata.maxAttempts = maxAttempts;
      if (goal.metadata.goalContract) goal.metadata.goalContract.maxAttempts = maxAttempts;
      if (goal.metadata.quality?.contract) goal.metadata.quality.contract.maxAttempts = maxAttempts;
      if (goal.metadata.admissionClass === 'bounded_mission' || goal.metadata.admissionClass === 'self_evolution') {
        const deliverable = this._originalDeliverable(goal);
        const allowedTools = [...new Set([
          ...(goal.allowedTools || []),
          ...(goal.metadata.allowedTools || []),
          ...(goal.metadata.admissionClass === 'bounded_mission'
            ? this.charter.permittedTools.filter(tool => deliverable.requiresCodeChange || !['modify_code', 'pulse_stage_code'].includes(tool)) : [])
        ])];
        goal.allowedTools = allowedTools;
        goal.metadata.allowedTools = allowedTools;
        goal.metadata.missionCharterVersion = this.charter.version;

        if (deliverable.kind === 'code_change') {
          const codeWritePaths = goal.metadata.admissionClass !== 'self_evolution' || !goal.metadata.researchPlanId
            ? this.charter.codeWriteRoots.map(root => path.resolve(process.cwd(), root)) : [];
          const expectedArtifact = goal.expectedArtifact || goal.metadata.expectedArtifact || null;
          if (expectedArtifact) codeWritePaths.push(path.dirname(path.resolve(expectedArtifact)));
          let allowedWritePaths;
          if (goal.metadata.admissionClass === 'self_evolution' && goal.metadata.researchPlanId) {
            // Reconstruct the exact pinned scope. Older restarts mistakenly
            // appended every code root to a one-file research contract.
            try {
              const ledger = JSON.parse(fs.readFileSync(path.join(this.dataDir, 'self-evolution', 'research', 'ledger.json'), 'utf8'));
              const plan = ledger.plans?.find(item => item.id === goal.metadata.researchPlanId
                && item.domain === goal.metadata.capabilityDomain && item.state === 'ready');
              const source = plan && path.resolve(process.cwd(), plan.file);
              const root = path.resolve(process.cwd());
              allowedWritePaths = [...new Set([...codeWritePaths,
                ...(source?.startsWith(root + path.sep) ? [source] : [])])];
            } catch { allowedWritePaths = [...codeWritePaths]; }
          } else {
            allowedWritePaths = [...new Set([
              ...(goal.allowedWritePaths || []),
              ...(goal.metadata.allowedWritePaths || []),
              ...codeWritePaths
            ])];
          }
          const executableCriteria = [
            'Create at least one governed source-code change inside an allowed code root',
            'Run focused tests that exercise the changed behavior and record passing output',
            'Run syntax or build verification for every changed executable file'
          ];
          const successCriteria = [...new Set([
            ...(goal.metadata.successCriteria || []),
            ...executableCriteria
          ])];
          const evidenceRequired = [...new Set([
            ...(goal.metadata.evidenceRequired || []),
            'summary',
            'artifact',
            'code_change',
            'tests'
          ])];

          goal.allowedWritePaths = allowedWritePaths;
          goal.metadata.allowedWritePaths = allowedWritePaths;
          goal.metadata.successCriteria = successCriteria;
          goal.metadata.evidenceRequired = evidenceRequired;
          goal.metadata.requiresCodeChange = true;
          goal.metadata.requiresExecutableProof = true;
          if (expectedArtifact) {
            const expectedArtifacts = [...new Set([
              ...(goal.expectedArtifacts || []),
              ...(goal.metadata.expectedArtifacts || []),
              path.resolve(expectedArtifact)
            ])];
            goal.expectedArtifacts = expectedArtifacts;
            goal.metadata.expectedArtifacts = expectedArtifacts;
          }
          const contracts = [
            goal.metadata.goalContract,
            goal.metadata.quality?.contract
          ].filter(Boolean);
          for (const contract of contracts) {
            contract.allowedWritePaths = allowedWritePaths;
            contract.successCriteria = successCriteria;
            contract.evidenceRequired = evidenceRequired;
            if (expectedArtifact) contract.expectedArtifacts = goal.expectedArtifacts;
            contract.verification = {
              ...(contract.verification || {}),
              profile: 'code',
              evidenceRequired,
              requiresCodeChange: true,
              requiresExecutableProof: true
            };
            if (contract.execution) {
              contract.execution.allowedWritePaths = allowedWritePaths;
              if (expectedArtifact) contract.execution.expectedArtifacts = goal.expectedArtifacts;
            }
          }
          goal.metadata.verification = {
            ...(goal.metadata.verification || {}),
            profile: 'code',
            evidenceRequired,
            requiresCodeChange: true,
            requiresExecutableProof: true
          };
          if (goal.metadata.quality) {
            goal.metadata.quality.successCriteria = successCriteria;
            goal.metadata.quality.verification = { ...goal.metadata.verification };
          }
        }
        if (goal.metadata.goalContract) {
          goal.metadata.goalContract.allowedTools = allowedTools;
          if (goal.metadata.goalContract.execution) goal.metadata.goalContract.execution.allowedTools = allowedTools;
        }
        if (goal.metadata.quality?.contract) {
          goal.metadata.quality.contract.allowedTools = allowedTools;
          if (goal.metadata.quality.contract.execution) goal.metadata.quality.contract.execution.allowedTools = allowedTools;
        }
      }
      migrated++;
    }
    if (migrated > 0) {
      this.planner._dirty = true;
      this.planner._saveToDisk?.();
    }
    this._atomicWrite(this.charterPath, this.charter);
    this._auditCompletionTruth();
    this._saveState();
    return this.status();
  }

  _readJson(filePath, fallback) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  _atomicWrite(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, filePath);
  }

  _loadCharter(override) {
    const disk = this._readJson(this.charterPath, {});
    const merged = { ...DEFAULT_CHARTER, ...disk, ...(override || {}) };
    merged.permittedCategories = [...new Set([
      ...DEFAULT_CHARTER.permittedCategories,
      ...(disk.permittedCategories || []),
      ...(override?.permittedCategories || [])
    ])];
    merged.permittedTools = [...new Set([
      ...DEFAULT_CHARTER.permittedTools,
      ...(disk.permittedTools || []),
      ...(override?.permittedTools || [])
    ])];
    merged.maxConcurrentAutonomousMissions = 1;
    // Older persisted charters used 30 steps, which was consistently exhausted
    // by local-model investigation before artifact revision and readback.
    merged.maxSteps = Math.max(DEFAULT_CHARTER.maxSteps, Number(merged.maxSteps || 0));
    merged.maxAttempts = Math.max(DEFAULT_CHARTER.maxAttempts, Number(merged.maxAttempts || 0));
    merged.version = Math.max(DEFAULT_CHARTER.version, Number(merged.version || 0));
    merged.themeCooldownHours = Math.max(1, Number(merged.themeCooldownHours || DEFAULT_CHARTER.themeCooldownHours));
    merged.codeWriteRoots = [...new Set([
      ...DEFAULT_CHARTER.codeWriteRoots,
      ...(disk.codeWriteRoots || []),
      ...(override?.codeWriteRoots || [])
    ])];
    return merged;
  }

  _saveState() {
    this.state.outcomes = (this.state.outcomes || []).slice(-100);
    this._atomicWrite(this.statePath, this.state);
  }

  _isTradingGoal(goal) {
    if (this.planner?.isTradingGoal) return this.planner.isTradingGoal(goal);
    return /\b(trad(e|ing)|market|finance|crypto|btc|eth)\b/i.test(`${goal?.category || ''} ${goal?.title || ''}`);
  }

  _activeAutonomousGoals() {
    if (!this.planner?.goals) return [];
    const active = [];
    const now = Date.now();
    for (const goal of this.planner.goals.values()) {
      if (!goal || !ACTIVE_STATES.has(goal.status) || isHumanGoal(goal) || this._isTradingGoal(goal)) {
        continue;
      }
      // A pending row outside the planner's executable index cannot run and
      // must not reserve the only mission slot. Preserve it as historical work;
      // do not silently approve it or erase the owner's work to free capacity.
      if ([STATUS.PENDING, STATUS.PROPOSED].includes(goal.status)
          && this.planner.activeGoals instanceof Set && !this.planner.activeGoals.has(goal.id)) continue;
      const deadline = Number(goal.deadlineAt || goal.metadata?.deadlineAt || goal.metadata?.goalContract?.deadlineAt || 0);
      if (deadline > 0 && now > deadline) {
        console.warn(`[AutonomousMissionDirector] ⏱️ Auto-reaping expired active goal "${goal.title}" (deadline expired ${new Date(deadline).toISOString()})`);
        if (typeof this.planner.failGoal === 'function') {
          this.planner.failGoal(goal.id, 'Contract deadline expired before verified completion').catch(() => {});
        }
        continue;
      }
      active.push(goal);
    }
    return active;
  }

  _riskReason(proposal) {
    const category = normalizeCategory(proposal.category);
    const permitted = this.charter.permittedCategories.map(normalizeCategory);
    if (!permitted.includes(category)) return `category_not_permitted:${category || 'unknown'}`;
    const text = `${proposal.title || ''} ${proposal.description || ''}`;
    if (RISK_PATTERNS.some(pattern => pattern.test(text))) return 'approval_required_action';
    return null;
  }

  _revisedResearchRetry(proposal, goal) {
    const next = proposal.metadata || {};
    const previous = goal.metadata || {};
    if (next.selfEvolution !== true || previous.selfEvolution !== true
        || next.diagnosticOnly !== false || previous.diagnosticOnly !== false
        || !next.researchPlanId || !previous.researchPlanId
        || next.researchPlanId === previous.researchPlanId
        || next.capabilityDomain !== previous.capabilityDomain
        || !next.researchInputFingerprint || !previous.researchInputFingerprint) return false;
    // Keep the original terminal goal and receipt intact. A new approach may
    // follow either an execution-only contract failure or a persisted failed
    // experiment, within the same pinned source and evaluator and daily cap.
    const receiptName = previous.latestExecutionReceipt;
    if (!receiptName) return false;
    const receiptPath = path.resolve(process.cwd(), receiptName);
    const dataRoot = path.resolve(this.dataDir);
    if (!receiptPath.startsWith(dataRoot + path.sep)) return false;
    try {
      const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
      if (receipt.goalId !== goal.id || receipt.lifecycleState !== goal.status) return false;
      const ledger = JSON.parse(fs.readFileSync(path.join(dataRoot, 'self-evolution', 'research', 'ledger.json'), 'utf8'));
      const oldPlan = ledger.plans?.find(item => item.id === previous.researchPlanId);
      const newPlan = ledger.plans?.find(item => item.id === next.researchPlanId);
      const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
      if (!oldPlan || !newPlan || newPlan.startedAt || newPlan.state !== 'ready'
          || oldPlan.inputFingerprint !== previous.researchInputFingerprint
          || newPlan.inputFingerprint !== next.researchInputFingerprint
          || !sha(oldPlan.sourceHash) || oldPlan.sourceHash !== newPlan.sourceHash
          || !sha(oldPlan.suiteFingerprint) || oldPlan.suiteFingerprint !== newPlan.suiteFingerprint
          || !sha(oldPlan.approachFingerprint) || !sha(newPlan.approachFingerprint)
          || oldPlan.approachFingerprint === newPlan.approachFingerprint
          || oldPlan.file !== newPlan.file || oldPlan.domain !== next.capabilityDomain
          || newPlan.domain !== next.capabilityDomain) return false;
      const contractFailure = !oldPlan.startedAt
        && /Research evaluator changed since baseline|isolation unavailable/i.test(String(receipt.result || receipt.error || ''));
      const failedExperiment = Boolean(oldPlan.startedAt && receipt.stopReason === 'max_attempts_reached'
        && ledger.outcomes?.some(item => item.planId === oldPlan.id
          && item.state === 'execution_failed' && item.decision === 'rejected'));
      if (!contractFailure && !failedExperiment) return false;
      const dayAgo = Date.now() - 24 * 60 * 60_000;
      const history = new Map([...this.planner.goals.values(),
        ...(this.planner.failedGoals || []), ...(this.planner.completedGoals || [])]
        .filter(item => item?.id).map(item => [item.id, item]));
      const recentGoals = [...history.values()].filter(item =>
        item.metadata?.selfEvolution === true && item.metadata?.capabilityDomain === next.capabilityDomain
        && item.metadata?.researchPlanId && Number(item.createdAt) >= dayAgo);
      return recentGoals.length < 2;
    } catch { return false; }
  }

  _isGenericRecoveryOfSelfEvolution(goal) {
    const originId = goal.metadata?.recoveryOfGoalId;
    return Boolean(originId && this.planner?.goals?.get(originId)?.metadata?.selfEvolution === true);
  }

  _resemblesTerminalFailure(proposal) {
    if (!this.planner?.goals) return null;
    const now = Date.now();
    const recentWindow = 30 * 24 * 60 * 60 * 1000;
    for (const goal of this.planner.goals.values()) {
      if (!goal || !isTerminal(goal.status)) continue;
      if (proposal.metadata?.selfEvolution === true && this._isGenericRecoveryOfSelfEvolution(goal)) continue;
      // Successful measurements use the ordinary theme cooldown. They are
      // not failed approaches and must not trigger a month-long retry ban.
      if (goal.status === STATUS.COMPLETED) continue;
      // A repaired execution protocol is a materially different approach.
      // Permit its first measured trial, but a failure on this same protocol
      // still blocks repeat attempts. Never use a per-run ID as the revision.
      if (proposal.metadata?.selfEvolution === true && goal.metadata?.selfEvolution === true
          && Number(proposal.metadata.executionProtocolVersion || 0) > Number(goal.metadata.executionProtocolVersion || 0)) continue;
      if (this._revisedResearchRetry(proposal, goal)) continue;
      const when = Number(goal.completedAt || goal.metadata?.lastTransition?.at || goal.createdAt || 0);
      if (when && now - when > recentWindow) continue;
      if (similarity(proposal.title, goal.title) >= 0.68) return goal;
    }
    return null;
  }

  _recentThemeOutcome(proposal) {
    if (!this.planner?.goals) return null;
    // Titles are the stable semantic identity of generated missions. The
    // description embeds output paths and live measurements that change on
    // every proposal and previously defeated duplicate suppression.
    const candidateTheme = themeKey(proposal.title || proposal.description || '');
    if (!candidateTheme) return null;
    const windowMs = this.charter.themeCooldownHours * 60 * 60 * 1000;
    const cutoff = Date.now() - windowMs;
    const candidateTerms = new Set(candidateTheme.split(':'));
    let best = null;
    for (const goal of this.planner.goals.values()) {
      if (!goal || !isTerminal(goal.status)) continue;
      if (proposal.metadata?.selfEvolution === true && this._isGenericRecoveryOfSelfEvolution(goal)) continue;
      const when = Number(goal.completedAt || goal.metadata?.lastTransition?.at || goal.createdAt || 0);
      if (when < cutoff) continue;
      if (proposal.metadata?.selfEvolution === true && goal.metadata?.selfEvolution === true
          && Number(proposal.metadata.executionProtocolVersion || 0) > Number(goal.metadata.executionProtocolVersion || 0)) continue;
      if (goal.status !== STATUS.COMPLETED && this._revisedResearchRetry(proposal, goal)) continue;
      const priorTheme = themeKey(goal.title || goal.description || '');
      const priorTerms = new Set(priorTheme.split(':'));
      let overlap = 0;
      for (const term of candidateTerms) if (priorTerms.has(term)) overlap++;
      const score = overlap / Math.max(1, Math.min(candidateTerms.size, priorTerms.size));
      if (score >= 0.6 && (!best || score > best.score)) best = { goal, score, theme: candidateTheme };
    }
    return best;
  }

  scoreProposal(proposal) {
    // The general scheduler can start before ASIKernel finishes booting.
    // Legacy ASI contracts must be refreshed by their owner, not admitted
    // in that window with obsolete tools and completion requirements.
    if (proposal.metadata?.selfEvolution === true && typeof proposal.metadata.diagnosticOnly !== 'boolean') {
      return { eligible: false, score: 0, reason: 'self_evolution_contract_refresh_required' };
    }
    const risk = this._riskReason(proposal);
    if (risk) return { eligible: false, score: 0, reason: risk };
    if (this._isTradingGoal(proposal)) {
      return { eligible: false, score: 0, reason: 'trading_requires_dedicated_research_loop' };
    }
    const value = assessMissionValue(proposal, this.governor?.proposals || []);
    if (value.utilityScore < 0.42 || (value.novelty < 0.25 && !proposal.metadata?.recoveryOfGoalId)) {
      return { eligible: false, score: 0, reason: 'low_outcome_utility', value };
    }
    if (proposal.metadata?.recoveryOfGoalId) {
      const mutation = String(proposal.metadata?.mutatedStrategy || '');
      const prior = String(proposal.metadata?.priorStrategy || '');
      if (strategyFingerprint(mutation).length < 12 || (prior && strategyFingerprint(mutation) === strategyFingerprint(prior))) {
        return { eligible: false, score: 0, reason: 'recovery_strategy_not_materially_changed', value };
      }
    }
    const corpse = this._resemblesTerminalFailure(proposal);
    if (corpse && corpse.status !== STATUS.COMPLETED && !proposal.metadata?.recoveryOfGoalId) {
      return { eligible: false, score: 0, reason: `resembles_failed_goal:${corpse.id}` };
    }
    const recentTheme = this._recentThemeOutcome(proposal);
    if (recentTheme && !proposal.metadata?.recoveryOfGoalId) {
      return {
        eligible: false,
        score: 0,
        reason: `theme_cooldown:${recentTheme.theme}:${recentTheme.goal.id}`
      };
    }

    const title = String(proposal.title || '');
    const description = String(proposal.description || '');
    const fullText = `${title} ${description}`;

    // 🚀 Heavy Architectural Offloading to MAX:
    // If a proposal is broad/heavy, delegate it to MAX so SOMA isn't bogged down
    const isBroadArchitectural = /\b(benchmark suite|architecture overhaul|multi-system|full rewrite|framework|literature synthesis|comprehensive study|deep cognitive|knowledge roadmap)\b/i.test(fullText);
    if (isBroadArchitectural) {
      if (!proposal.metadata?.delegatedToMax) {
        this._delegateToMax(proposal);
      }
      return { eligible: false, score: 0, reason: 'delegated_to_max_architectural_engine' };
    }

    const priority = Math.max(0, Math.min(100, Number(proposal.priority || 50)));
    let score = priority * 0.55;
    if (title.length >= 12 && title.length <= 120) score += 8;
    if (description.length >= 80) score += 10;
    // Bounded micro-missions get boosted prioritization
    if (/\b(diagnos|audit|fix|patch|unit test|small correctness gap|verify)\b/i.test(fullText)) score += 15;
    if (/\b(test|verify|measure|compare|artifact|prototype|benchmark)\b/i.test(description)) score += 9;
    if (classifyDeliverable(proposal).requiresExecutableProof && /\b(test|runtime|endpoint|command|pass.fail)\b/i.test(description)) score += 6;
    score += Math.min(6, Math.max(0, Number(proposal.seenCount || 1) - 1));
    if (/\b(explore|think about|reflect|wonder|curiosity scan|system state summary)\b/i.test(title)) score -= 14;
    if (/\b(quantum computing|latest crypto news|new ai architectures)\b/i.test(title)) score -= 12;
    score += value.utilityScore * 12;

    return {
      eligible: score >= Number(this.charter.minimumScore || 48),
      score: Math.round(score * 10) / 10,
      reason: score >= Number(this.charter.minimumScore || 48) ? 'bounded_high_value_candidate' : 'below_mission_threshold',
      value
    };
  }

  _delegateToMax(proposal) {
    try {
      proposal.metadata = proposal.metadata || {};
      proposal.metadata.delegatedToMax = true;
      proposal.metadata.delegatedAt = Date.now();
      import('./MaxAgentBridge.js').then(async ({ MaxAgentBridge }) => {
        const bridge = new MaxAgentBridge();
        if (await bridge.isAvailable()) {
          const res = await bridge.injectGoal(proposal.title, {
            description: proposal.description,
            priority: Math.max(0.7, (Number(proposal.priority || 50) / 100))
          });
          console.log(`[AutonomousMissionDirector] 🚀 Delegated heavy project to MAX: "${proposal.title}" → ${res?.id || 'queued'}`);
        }
      }).catch(() => {});
    } catch {}
  }

  _missionContract(proposal) {
    if (proposal.metadata?.admissionClass === 'self_evolution' && proposal.goalData) {
      const original = proposal.goalData;
      const metadata = {
        ...(original.metadata || {}),
        source: original.metadata?.source || proposal.source || 'SelfEvolutionDirector',
        autonomousMission: true,
        missionProposalId: proposal.id,
        admissionApproved: false,
        missionDirectorApproved: true,
        allowAutonomousExecution: true,
        missionCharterVersion: this.charter.version
      };
      const artifact = metadata.expectedArtifact || metadata.expectedArtifacts?.[0] || null;
      return {
        root: artifact ? path.dirname(path.resolve(artifact)) : this.dataDir,
        artifact,
        deadlineAt: original.deadlineAt || null,
        allowedTools: original.allowedTools || metadata.allowedTools || [],
        allowedWritePaths: original.allowedWritePaths || metadata.allowedWritePaths || [],
        successCriteria: original.successCriteria || metadata.successCriteria || [],
        source: proposal.source || 'SelfEvolutionDirector',
        goalData: {
          ...original,
          source: proposal.source || 'SelfEvolutionDirector',
          metadata
        }
      };
    }

    const missionId = proposal.id;
    const root = path.join(this.dataDir, 'autonomous-missions', `${missionId}-${safeSlug(proposal.title)}`);
    const artifact = path.join(root, 'result.md');
    const deliverable = classifyDeliverable(proposal);
    const deadlineAt = Date.now() + Number(this.charter.missionDeadlineHours || 24) * 60 * 60 * 1000;
    const allowedTools = this.charter.permittedTools.filter(tool =>
      deliverable.requiresCodeChange || !['modify_code', 'pulse_stage_code'].includes(tool));
    const allowedWritePaths = [root];
    if (deliverable.requiresCodeChange) {
      allowedWritePaths.push(...this.charter.codeWriteRoots.map(scope => path.join(process.cwd(), scope)));
    }
    const successCriteria = deliverable.requiresCodeChange
      ? [
          'Produce at least one governed source-code change in the scoped implementation roots',
          'Run and pass executable tests for the changed behavior',
          'Run and pass syntax or build verification for changed source files',
          `Create the supporting evidence report at ${artifact}`,
          'Read back the changed implementation and supporting report before claiming completion'
        ]
      : [
          `Create the required artifact at ${artifact}`,
          'Use concrete source, file, test, or measurement evidence rather than unsupported claims',
          'Read the artifact back and verify that it is non-empty and addresses the mission'
        ];
    return {
      root,
      artifact,
      deadlineAt,
      allowedTools,
      allowedWritePaths,
      successCriteria,
      goalData: {
        title: `Autonomous mission: ${proposal.title}`.slice(0, 180),
        description: [
          proposal.description || proposal.title,
          '',
          'This mission was selected autonomously under Owner’s standing mission charter.',
          `Produce a durable, evidence-backed result at: ${artifact}`,
          deliverable.requiresCodeChange
            ? 'This is an implementation mission. result.md is supporting evidence only and cannot complete the mission without a governed source change plus passing executable verification.'
            : 'This is a research/diagnosis mission. The report is the deliverable.',
          'The report must contain these exact sections: "Evidence inspected", "Evidence-backed finding", and "Verification status". Cite concrete files, URLs, tests, or measurements; placeholder paths and TODO prose do not count.',
          'Do not stop after planning or reflection. Use tools, create the artifact, read it back, and verify it.'
        ].join('\n'),
        category: proposal.category,
        priority: Math.max(50, Number(proposal.priority || 50)),
        source: 'autonomous_mission_director',
        status: STATUS.PENDING,
        requireQuality: true,
        strictContract: true,
        successCriteria,
        verification: {
          profile: deliverable.profile,
          evidenceRequired: deliverable.requiresCodeChange
            ? ['summary', 'artifact', 'code_change', 'tests']
            : ['summary', 'artifact'],
          filesExist: [artifact],
          allowStopReason: false,
          requiresExecutableProof: deliverable.requiresExecutableProof,
          requiresCodeChange: deliverable.requiresCodeChange
        },
        allowedTools,
        allowedWritePaths,
        expectedArtifacts: [artifact],
        maxSteps: Number(this.charter.maxSteps || 30),
        deadlineAt,
        // A local-model session is deliberately short. Attempts are bounded,
        // but eight sessions leaves room for inspect → artifact → revision →
        // readback → verification without treating productive checkpoints as
        // repeated failure.
        maxAttempts: this.charter.maxAttempts,
        metadata: {
          source: 'autonomous_mission_director',
          autonomousMission: true,
          deliverableKind: deliverable.kind,
          requiresCodeChange: deliverable.requiresCodeChange,
          requiresExecutableProof: deliverable.requiresExecutableProof,
          missionTheme: themeKey(proposal.title || proposal.description || ''),
          outcomeValue: assessMissionValue(proposal, this.governor?.proposals || []),
          missionProposalId: proposal.id,
          admissionApproved: true,
          admissionClass: 'bounded_mission',
          allowAutonomousExecution: true,
          expectedArtifact: artifact,
          expectedArtifacts: [artifact],
          allowedTools,
          allowedWritePaths,
          maxSteps: Number(this.charter.maxSteps || 30),
          maxAttempts: this.charter.maxAttempts,
          deadlineAt,
          strictContract: true,
          executionMode: 'atomic',
          allowDecomposition: false,
          missionCharterVersion: this.charter.version,
          recoveryOfGoalId: proposal.metadata?.recoveryOfGoalId || null,
          recoveryCount: Number(proposal.metadata?.recoveryCount || 0)
        }
      }
    };
  }

  _originalDeliverable(goal) {
    // Classify the admitted request, not the generated execution boilerplate
    // ("create the artifact" does not authorize a source-code modification).
    const proposal = this.governor?.getProposal?.(goal.metadata?.missionProposalId);
    if (proposal?.metadata?.selfEvolution === true && proposal.metadata?.diagnosticOnly === true) {
      return { kind: 'diagnosis', profile: 'research', requiresCodeChange: false, requiresExecutableProof: true };
    }
    if (proposal) return classifyDeliverable(proposal);
    if (goal.metadata?.autonomousMission === true && goal.metadata?.missionCharterVersion
        && ['diagnosis', 'research_report', 'operational_artifact'].includes(goal.metadata?.deliverableKind)) {
      return { kind: goal.metadata.deliverableKind, profile: 'research', requiresCodeChange: false, requiresExecutableProof: false };
    }
    return classifyDeliverable(goal);
  }

  _auditCompletionTruth() {
    if (!this.planner?.goals) return { audited: 0, reclassified: 0 };
    const rows = [];
    let reclassified = 0;
    for (const goal of this.planner.goals.values()) {
      if (goal?.metadata?.autonomousMission !== true || goal.status !== STATUS.COMPLETED) continue;
      const inferred = this._originalDeliverable(goal);
      const checks = goal.metadata?.lastVerification?.checks || [];
      const hasCodeChange = checks.some(check =>
        (['code_change', 'code_modification', 'sandbox_stage', 'architecture_reorganization'].includes(check.type)
          || (check.type === 'code_change_proof' && check.receiptIds?.length > 0)) &&
        check.passed === true);
      const hasExecutableProof = checks.some(check =>
        ['executable_proof', 'tests', 'command'].includes(check.type) && check.passed === true);
      const classification = inferred.requiresCodeChange && (!hasCodeChange || !hasExecutableProof)
        ? 'artifact_only'
        : inferred.requiresCodeChange ? 'implemented' : 'research_complete';
      goal.metadata.completionClassification = classification;
      goal.metadata.completionTruthAuditedAt = Date.now();
      if (classification === 'artifact_only') {
        goal.status = STATUS.VERIFICATION_FAILED;
        goal.completedAt = null;
        goal.metadata.lastTransition = {
          from: STATUS.COMPLETED,
          to: STATUS.VERIFICATION_FAILED,
          at: Date.now(),
          reason: 'retroactive_artifact_only_audit',
          actor: 'AutonomousMissionDirector'
        };
        this.planner.activeGoals?.delete?.(goal.id);
        if (Array.isArray(this.planner.completedGoals)) {
          this.planner.completedGoals = this.planner.completedGoals.filter(item => item.id !== goal.id);
        }
        const proposalId = goal.metadata?.missionProposalId;
        if (proposalId && this.governor?.getProposal?.(proposalId)) {
          this.governor.markProposal(proposalId, 'failed', {
            outcome: 'artifact_only',
            truthAuditedAt: Date.now()
          });
        }
        reclassified++;
      }
      rows.push({
        goalId: goal.id,
        title: goal.title,
        classification,
        hasCodeChange,
        hasExecutableProof
      });
    }
    if (rows.length) {
      this._atomicWrite(path.join(this.dataDir, 'autonomous-completion-audit.json'), {
        version: 1,
        auditedAt: Date.now(),
        rows
      });
      this.planner._dirty = true;
      this.planner._saveToDisk?.();
    }
    return { audited: rows.length, reclassified };
  }

  async admitGoalData(goalData, source = 'autonomous') {
    const submitted = this.governor.submitProposal(goalData, source, 'awaiting_mission_director_selection');
    const decision = await this.ensureMission();
    if (decision.promoted && decision.proposalId === submitted.proposalId) {
      const goal = this.planner.goals.get(decision.goalId);
      return { success: true, goalId: decision.goalId, goal, missionDirector: decision };
    }
    return {
      ...submitted,
      queuedByMissionDirector: true,
      selection: decision
    };
  }

  _recordDecision(decision) {
    this.state.lastDecision = { ...decision, at: Date.now() };
    this._saveState();
  }

  _seedPurposefulMission(idleReason) {
    let resource = null;
    try { resource = typeof this.resourceStatus === 'function' ? this.resourceStatus() : null; } catch { resource = null; }
    resource = resource || { level: 'normal' };
    if (resource.level !== 'normal') return { seeded: false, reason: `resource_${resource.level}` };
    const cooldownMs = 6 * 60 * 60 * 1000;
    if (this.state.lastPurposefulSeedAt && Date.now() - this.state.lastPurposefulSeedAt < cooldownMs) {
      return { seeded: false, reason: 'purposeful_seed_cooldown' };
    }
    // CONCRETE over abstract. The old idle seed asked her to "improve her own
    // completion utility" — a self-referential, unverifiable goal that could never
    // be finished, so it failed, spawned a "Recovery:" of itself, and piled up a
    // graveyard of ~100 dead goals (1/102 ever completed). The fix: seed a small,
    // COMPLETABLE diagnosis of one concrete gap in a real subsystem. A diagnosis is
    // finishable (a report citing a real file:line + the exact small change), and
    // the existing _submitDiagnosisAction pipeline then converts a concrete finding
    // into a real implementation goal — the same shape as the one self-mod that ever
    // landed (SlippageTracker). Rotate the target so she covers the codebase.
    const areas = (process.env.SOMA_SELF_IMPROVE_AREAS
      || 'server/finance,arbiters,core,server/routes,daemons,cognitive,server/loaders')
      .split(',').map(s => s.trim()).filter(Boolean);
    const area = areas[(Number(this.state.cycles || 0)) % Math.max(1, areas.length)] || 'core';
    const submitted = this.governor.submitProposal({
      title: `Diagnose the single highest-value small correctness gap in ${area}`,
      category: 'research',
      priority: 70,
      description: [
        `Inspect the ${area} subsystem of SOMA's own source code.`,
        'Identify and pinpoint exactly ONE small, concrete correctness or robustness gap — a specific unhandled edge case, a missing null/error guard, or a thin spot in test coverage. One small thing, not a broad rewrite.',
        'Document a report that names the exact file path and line, quotes the real offending code, states precisely what the single small change should be, and names the exact test or check that would confirm it.',
        'The report MUST contain these sections: "Evidence inspected", "Evidence-backed finding", "Verification status", and MUST cite a real file that exists under the target area — not a placeholder path.'
      ].join('\n'),
      metadata: {
        purposefulSeed: true,
        selfImprovementArea: area,
        triggeringIdleReason: idleReason
      }
    }, 'autonomous_mission_director', 'purposeful_idle_concrete_diagnosis');
    this.state.lastPurposefulSeedAt = Date.now();
    this._saveState();
    return { seeded: true, proposalId: submitted.proposalId, area };
  }

  _reconcileOutcomes() {
    if (!this.governor || !this.planner?.goals) return;
    for (const proposal of this.governor.list({ status: 'promoted', limit: 250 })) {
      const goalId = proposal.metadata?.goalId;
      const goal = goalId ? this.planner.goals.get(goalId) : null;
      if (!goal || !isTerminal(goal.status)) continue;
      if (goal.status === STATUS.COMPLETED) {
        this.governor.markProposal(proposal.id, 'completed', {
          completedAt: Date.now(),
          outcome: 'verified_completion'
        });
        this.state.verifiedCompletions++;
        this.state.outcomes.push({ proposalId: proposal.id, goalId, status: 'completed', at: Date.now() });
        this._submitDiagnosisAction(goal, proposal);
        continue;
      }

      const reason = goal.metadata?.lastTransition?.reason || goal.status;
      this.governor.markProposal(proposal.id, 'failed', { failedAt: Date.now(), outcome: reason });
      this.state.failedMissions++;
      this.state.outcomes.push({ proposalId: proposal.id, goalId, status: 'failed', reason, at: Date.now() });

      // An operator cancellation is a terminal decision, not an execution
      // failure that should manufacture a replacement mission. Without this
      // distinction, cancelling stale autonomous work immediately resurrects
      // it as a recovery proposal.
      const operatorCancelled = goal.status === STATUS.ABANDONED && (
        Boolean(goal.metadata?.cancelledAt) ||
        /\b(user|owner|human|discord|operator|superseded)\b/i.test(String(reason))
      );
      if (operatorCancelled) continue;

      // RSI owns its hash-pinned research retry policy. A generic recovery
      // mission loses that scope and can block the next valid experiment.
      if (proposal.metadata?.selfEvolution === true || goal.metadata?.selfEvolution === true) continue;

      const recoveryCount = Number(proposal.metadata?.recoveryCount || 0);
      if (recoveryCount < 1) {
        const priorStrategy = String(proposal.metadata?.mutatedStrategy || proposal.description || '');
        const nextStrategy = this._changedRecoveryStrategy(goal, reason);
        this.governor.submitProposal({
          title: `Recovery: ${proposal.title}`.slice(0, 220),
          category: proposal.category,
          priority: Math.max(50, Number(proposal.priority || 50) - 5),
          description: `The prior mission failed because "${reason}". Change strategy: ${nextStrategy} Do not repeat the prior approach. Produce a smaller verified artifact with explicit evidence.`,
          metadata: {
            recoveryOfProposalId: proposal.id,
            recoveryOfGoalId: goalId,
            recoveryCount: recoveryCount + 1,
            mutatedStrategy: nextStrategy,
            priorStrategy,
            strategyFingerprint: strategyFingerprint(nextStrategy)
          }
        }, 'autonomous_mission_director', 'failed_mission_strategy_mutation');
      }
    }
  }

  _changedRecoveryStrategy(goal, reason = '') {
    const autopsy = String(goal.metadata?.autopsyNextStrategy || '').trim();
    if (strategyFingerprint(autopsy).length >= 12) return autopsy;
    const lower = String(reason).toLowerCase();
    if (/read|path|file.*not.*found/.test(lower)) {
      return 'First enumerate the exact allowed root and verify one concrete input path, then process only that file and read back the output.';
    }
    if (/web|fetch|network|timeout/.test(lower)) {
      return 'Use local primary-source caches first, record unavailable sources explicitly, and complete a bounded result from independently readable evidence.';
    }
    if (/verification|artifact|evidence/.test(lower)) {
      return 'Create the smallest required artifact first, read it back, then run one focused executable check and attach its exact receipt before expanding scope.';
    }
    return 'Reduce the work to one independently testable behavior, inspect its exact source path, make one bounded change, and run the focused verification before any broader analysis.';
  }

  _submitDiagnosisAction(goal, proposal) {
    if (goal.metadata?.deliverableKind !== 'diagnosis' || goal.metadata?.diagnosisActionSubmittedAt) return null;
    const artifact = goal.metadata?.expectedArtifact || goal.expectedArtifacts?.[0];
    let report = '';
    try { report = artifact ? fs.readFileSync(artifact, 'utf8') : ''; } catch { return null; }
    if (/\b(no (?:code )?change (?:is )?(?:needed|required|justified)|no actionable finding)\b/i.test(report)) return null;
    const hasConcreteTarget = /(?:core|server|arbiters|tests|scripts)[\\/][\w./-]+\.(?:c?js|mjs|ts|py)/i.test(report);
    const hasRecommendation = /\b(fix|repair|implement|replace|change|add|remove|refactor)\b/i.test(report);
    if (!hasConcreteTarget || !hasRecommendation) return null;
    goal.metadata.diagnosisActionSubmittedAt = Date.now();
    this.planner._dirty = true;
    this.planner._saveToDisk?.();
    return this.governor.submitProposal({
      title: `Implement verified finding from ${proposal.title}`.slice(0, 220),
      category: 'self_repair',
      priority: Math.max(55, Number(proposal.priority || 50)),
      description: `Use the completed diagnosis at ${artifact}. Implement only its highest-confidence concrete finding, add a focused regression test, run it, and preserve the diagnosis as evidence.`,
      metadata: {
        diagnosisOfGoalId: goal.id,
        diagnosisOfProposalId: proposal.id,
        expectedInputArtifact: artifact,
        outcomeAction: true
      }
    }, 'autonomous_mission_director', 'verified_diagnosis_to_action');
  }

  async ensureMission(options = {}) {
    if (this._selection) return this._selection;
    this._selection = this._ensureMission(options);
    try { return await this._selection; }
    finally { this._selection = null; }
  }

  async _ensureMission({ proposalId = null } = {}) {
    this.state.cycles++;
    this.state.lastCycleAt = Date.now();
    this._reconcileOutcomes();

    const active = this._activeAutonomousGoals();
    if (active.length >= this.charter.maxConcurrentAutonomousMissions) {
      const result = { promoted: false, reason: 'autonomous_execution_slot_occupied', activeGoalId: active[0].id };
      this._recordDecision(result);
      return result;
    }

    const evaluated = this.governor
      .list({ status: 'proposed', limit: 250 })
      .filter(proposal => !proposalId || proposal.id === proposalId)
      .map(proposal => ({ proposal, verdict: this.scoreProposal(proposal) }))
      .sort((a, b) => b.verdict.score - a.verdict.score || b.proposal.priority - a.proposal.priority);
    const selected = evaluated.find(item => item.verdict.eligible);
    if (!selected) {
      const seeded = proposalId ? { seeded: false } : this._seedPurposefulMission('no_bounded_candidate');
      const result = {
        promoted: false,
        reason: seeded.seeded ? 'purposeful_candidate_seeded' : 'no_bounded_candidate',
        seededProposalId: seeded.proposalId || null,
        evaluated: evaluated.length,
        rejections: evaluated.slice(0, 5).map(item => ({ id: item.proposal.id, reason: item.verdict.reason }))
      };
      this._recordDecision(result);
      return result;
    }

    const contract = this._missionContract(selected.proposal);
    const created = await this.planner.createGoal(contract.goalData, contract.source || 'autonomous_mission_director');
    if (!created?.success || !created.goal?.id) {
      const failureReason = created?.error || 'goal_creation_failed';
      const priorAttempts = Number(selected.proposal.metadata?.promotionAttempts || 0);
      const promotionAttempts = priorAttempts + 1;
      const deterministicRejection = /rejected|constitutional|quality|unsafe|risk|permission|approval/i.test(failureReason);
      const proposalStatus = deterministicRejection || promotionAttempts >= 3 ? 'rejected' : 'proposed';
      const qualityFailure = created?.quality ? {
        approved: created.quality.approved === true,
        issues: (created.quality.issues || []).map(String).slice(0, 10),
        warnings: (created.quality.warnings || []).map(String).slice(0, 10),
        duplicateGoalId: created.quality.duplicateGoalId || null
      } : null;
      const result = {
        promoted: false,
        reason: failureReason,
        proposalId: selected.proposal.id,
        score: selected.verdict.score,
        proposalStatus,
        qualityFailure
      };
      this.governor.markProposal(selected.proposal.id, proposalStatus, {
        lastPromotionError: result.reason,
        lastPromotionQuality: qualityFailure,
        lastPromotionAttemptAt: Date.now(),
        promotionAttempts,
        rejectedAt: proposalStatus === 'rejected' ? Date.now() : null
      });
      this._recordDecision(result);
      return result;
    }

    this.governor.markProposal(selected.proposal.id, 'promoted', {
      goalId: created.goal.id,
      promotedAt: Date.now(),
      score: selected.verdict.score,
      artifact: contract.artifact,
      outcomeValue: selected.verdict.value
    });
    this.state.promotions++;
    const result = {
      promoted: true,
      proposalId: selected.proposal.id,
      goalId: created.goal.id,
      score: selected.verdict.score,
      artifact: contract.artifact
    };
    this._recordDecision(result);
    this.logger.info(`[AutonomousMissionDirector] Promoted "${selected.proposal.title}" → ${created.goal.id}`);
    return result;
  }

  status() {
    let resource = null;
    try { resource = typeof this.resourceStatus === 'function' ? this.resourceStatus() : null; } catch { resource = { level: 'normal' }; }
    const scoreboard = this.scoreboard.snapshot({ idleReason: this.state.lastDecision?.reason || null, resource, historical: this.state });
    return {
      enabled: true,
      charter: {
        version: this.charter.version,
        maxConcurrentAutonomousMissions: this.charter.maxConcurrentAutonomousMissions,
        minimumScore: this.charter.minimumScore,
        permittedCategories: this.charter.permittedCategories,
        approvalRequired: this.charter.approvalRequired
      },
      activeMissions: this._activeAutonomousGoals().map(goal => ({
        id: goal.id,
        title: goal.title,
        status: goal.status,
        progress: goal.metrics?.progress || 0,
        artifact: goal.metadata?.expectedArtifact || null
      })),
      proposals: this.governor ? {
        proposed: this.governor.list({ status: 'proposed', limit: 250 }).length,
        promoted: this.governor.list({ status: 'promoted', limit: 250 }).length,
        completed: this.governor.list({ status: 'completed', limit: 250 }).length,
        failed: this.governor.list({ status: 'failed', limit: 250 }).length
      } : null,
      scoreboard,
      state: this.state
    };
  }
}

module.exports = { AutonomousMissionDirector, DEFAULT_CHARTER, classifyDeliverable, themeKey, assessMissionValue, strategyFingerprint };
