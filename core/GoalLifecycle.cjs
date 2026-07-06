'use strict';

const STATUS = Object.freeze({
  PROPOSED: 'proposed',
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  VERIFICATION_FAILED: 'verification_failed',
  FAILED: 'failed',
  DEFERRED: 'deferred',
  DELEGATED: 'delegated',
  BROKEN: 'broken',
  REJECTED: 'rejected',
  ABANDONED: 'abandoned',
  ARCHIVED: 'archived'
});

const LEGACY_STATUS = Object.freeze({
  incomplete_step_budget: STATUS.PENDING,
  incomplete_verification: STATUS.PENDING,
  repairing: STATUS.PENDING
});

const TERMINAL_STATUSES = new Set([
  STATUS.COMPLETED,
  STATUS.VERIFICATION_FAILED,
  STATUS.FAILED,
  STATUS.REJECTED,
  STATUS.ABANDONED,
  STATUS.ARCHIVED
]);

const HUMAN_SOURCES = new Set(['user', 'user_requested', 'human', 'discord', 'discord_admin', 'priorities_md']);

function isHumanGoal(goal = {}) {
  const source = String(goal.source || goal.metadata?.source || '').toLowerCase();
  return HUMAN_SOURCES.has(source) || String(goal.title || '').startsWith('Discord admin engineering request:');
}

function inferEvidenceProfile(goal = {}) {
  const text = `${goal.type || ''} ${goal.category || ''} ${goal.title || ''}`.toLowerCase();
  if (/\b(code|coding|repair|refactor|implementation|software|dependency|daemon|arbiter|frontend|backend|module|function|route)\b/.test(text)) return 'code';
  if (/\b(research|knowledge|paper|study|investigat|audit|analysis|blueprint)\b/.test(text)) return 'research';
  if (/\b(memory|mnemonic|recall|consolidat|compaction)\b/.test(text)) return 'memory';
  return 'operational';
}

function compileEvidencePreflight(goal = {}) {
  const contract = goal.metadata?.goalContract || {};
  const verification = goal.verification || goal.metadata?.verification || contract.verification || {};
  const profile = verification.profile || contract.evidenceProfile || inferEvidenceProfile(goal);
  const defaults = {
    code: { evidenceRequired: ['summary', 'artifact'], proof: ['changed file', 'syntax or build', 'tests'] },
    research: { evidenceRequired: ['summary', 'artifact'], proof: ['non-empty report', 'source trail'] },
    memory: { evidenceRequired: ['summary', 'receipt'], proof: ['successful memory write', 'retrieval readback'] },
    operational: { evidenceRequired: ['summary'], proof: ['measured state, command result, or durable receipt'] },
  }[profile];
  const evidenceRequired = [...new Set(verification.evidenceRequired || contract.evidenceRequired || defaults.evidenceRequired)];
  return {
    profile,
    evidenceRequired,
    proof: defaults.proof,
    filesExist: Array.isArray(verification.filesExist) ? verification.filesExist : [],
    commands: Array.isArray(verification.commands) ? verification.commands : [],
    requiresExecutableProof: profile === 'code' || verification.requiresExecutableProof === true,
  };
}

function deriveGoalState(goal = {}) {
  const status = normalizeStatus(goal.status);
  if (status === STATUS.COMPLETED) return 'completed';
  if ([STATUS.FAILED, STATUS.BROKEN, STATUS.VERIFICATION_FAILED].includes(status)) return 'blocked';
  if (status === STATUS.DEFERRED) return 'deferred';
  if (status === STATUS.DELEGATED) return 'delegated';
  const verification = goal.metadata?.lastVerification;
  if (verification?.passed === false) return 'awaiting_evidence';
  if (status === STATUS.PENDING) return 'queued';
  if (status === STATUS.ACTIVE) return Number(goal.metadata?.executionAttempts || 0) > 0 ? 'executing' : 'ready';
  return status || 'unknown';
}

const ALLOWED = Object.freeze({
  [STATUS.PROPOSED]: new Set([STATUS.PENDING, STATUS.ACTIVE, STATUS.DEFERRED, STATUS.DELEGATED, STATUS.REJECTED, STATUS.FAILED]),
  [STATUS.PENDING]: new Set([STATUS.ACTIVE, STATUS.COMPLETED, STATUS.DEFERRED, STATUS.DELEGATED, STATUS.FAILED, STATUS.VERIFICATION_FAILED, STATUS.BROKEN]),
  [STATUS.ACTIVE]: new Set([STATUS.PENDING, STATUS.COMPLETED, STATUS.DEFERRED, STATUS.DELEGATED, STATUS.FAILED, STATUS.VERIFICATION_FAILED, STATUS.BROKEN]),
  [STATUS.BROKEN]: new Set([STATUS.PENDING, STATUS.FAILED, STATUS.DEFERRED, STATUS.DELEGATED, STATUS.ARCHIVED]),
  [STATUS.DEFERRED]: new Set([STATUS.PENDING, STATUS.COMPLETED, STATUS.DELEGATED, STATUS.ARCHIVED]),
  [STATUS.DELEGATED]: new Set([STATUS.PENDING, STATUS.COMPLETED, STATUS.FAILED, STATUS.ARCHIVED]),
  [STATUS.VERIFICATION_FAILED]: new Set([STATUS.PENDING, STATUS.FAILED, STATUS.ARCHIVED]),
  [STATUS.FAILED]: new Set([STATUS.PENDING, STATUS.ARCHIVED]),
  [STATUS.REJECTED]: new Set([STATUS.ARCHIVED]),
  [STATUS.COMPLETED]: new Set([STATUS.ARCHIVED]),
  [STATUS.ABANDONED]: new Set([STATUS.ARCHIVED]),
  [STATUS.ARCHIVED]: new Set()
});

function normalizeStatus(status) {
  return LEGACY_STATUS[status] || status || STATUS.PROPOSED;
}

function isTerminal(status) {
  return TERMINAL_STATUSES.has(normalizeStatus(status));
}

function transitionGoal(goal, nextStatus, options = {}) {
  if (!goal || typeof goal !== 'object') throw new TypeError('goal is required');
  const from = normalizeStatus(goal.status);
  const to = normalizeStatus(nextStatus);
  const now = Number(options.now || Date.now());

  if (from === to) return { changed: false, from, to, goal };
  if (!options.force && !ALLOWED[from]?.has(to)) {
    throw new Error(`Invalid goal transition: ${from} -> ${to}`);
  }

  goal.metadata = goal.metadata || {};
  const history = Array.isArray(goal.metadata.lifecycleHistory)
    ? goal.metadata.lifecycleHistory
    : [];
  history.push({
    from,
    to,
    at: now,
    reason: String(options.reason || 'unspecified').slice(0, 300),
    actor: String(options.actor || 'system').slice(0, 100)
  });
  goal.metadata.lifecycleHistory = history.slice(-100);
  goal.metadata.lastTransition = history.at(-1);
  goal.status = to;

  if (to === STATUS.ACTIVE) goal.startedAt = goal.startedAt || now;
  if ([STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED, STATUS.ABANDONED, STATUS.ARCHIVED].includes(to)) {
    goal.completedAt = goal.completedAt || now;
  } else if (options.clearCompletedAt !== false) {
    goal.completedAt = null;
  }

  return { changed: true, from, to, goal };
}

module.exports = {
  STATUS,
  TERMINAL_STATUSES,
  normalizeStatus,
  isTerminal,
  transitionGoal,
  isHumanGoal,
  inferEvidenceProfile,
  compileEvidencePreflight,
  deriveGoalState
};
