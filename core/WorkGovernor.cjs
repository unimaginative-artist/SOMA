'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { isHumanGoal, STATUS } = require('./GoalLifecycle.cjs');

const EXECUTABLE_AUTONOMOUS_CLASSES = new Set(['trading_maintenance', 'safety_repair', 'self_evolution']);
const normalizedText = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

class WorkGovernor {
  constructor({ dataDir = path.join(process.cwd(), 'data'), proposalLimit = 250 } = {}) {
    this.filePath = path.join(dataDir, 'work-proposals.json');
    this.proposalLimit = Math.max(20, Number(proposalLimit || 250));
    this.proposals = this._load();
  }

  _load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      return Array.isArray(parsed?.proposals) ? parsed.proposals : [];
    } catch { return []; }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: Date.now(), proposals: this.proposals }, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  submitProposal(goalData = {}, source = 'autonomous', reason = 'autonomous_proposal') {
    const key = `${normalizedText(goalData.category)}:${normalizedText(goalData.title)}`;
    const existing = this.proposals.find(item => item.key === key && item.status === 'proposed');
    if (existing) {
      existing.lastSeenAt = Date.now();
      existing.seenCount = Number(existing.seenCount || 1) + 1;
      this._save();
      return { success: true, proposalOnly: true, deduped: true, proposalId: existing.id, proposal: existing };
    }
    const proposal = {
      id: crypto.randomUUID(), key, status: 'proposed', source,
      title: String(goalData.title || '').slice(0, 240), category: String(goalData.category || 'general').slice(0, 100),
      description: String(goalData.description || '').slice(0, 4000), priority: Number(goalData.priority || 50), reason,
      metadata: goalData.metadata || {},
      goalData: {
        type: goalData.type,
        category: goalData.category,
        title: goalData.title,
        description: goalData.description,
        priority: goalData.priority,
        confidence: goalData.confidence,
        rationale: goalData.rationale,
        successCriteria: goalData.successCriteria,
        verification: goalData.verification,
        allowedTools: goalData.allowedTools,
        allowedWritePaths: goalData.allowedWritePaths,
        expectedArtifacts: goalData.expectedArtifacts,
        maxSteps: goalData.maxSteps,
        deadlineAt: goalData.deadlineAt,
        metadata: goalData.metadata || {}
      },
      createdAt: Date.now(), lastSeenAt: Date.now(), seenCount: 1
    };
    this.proposals.unshift(proposal);
    this.proposals = this.proposals.slice(0, this.proposalLimit);
    this._save();
    return { success: true, proposalOnly: true, proposalId: proposal.id, proposal };
  }

  decide(goalData = {}, source = 'user') {
    const candidate = { ...goalData, source, metadata: { ...(goalData.metadata || {}), source } };
    if (isHumanGoal(candidate)) return { admitted: true, reason: 'human_requested' };
    if (goalData.metadata?.admissionApproved === true) return { admitted: true, reason: 'explicitly_approved' };
    const admissionClass = String(goalData.metadata?.admissionClass || '').toLowerCase();
    if (EXECUTABLE_AUTONOMOUS_CLASSES.has(admissionClass)) {
      const selfEvolutionContract = admissionClass === 'self_evolution'
        && ['asikernel', 'selfevolutiondirector'].includes(String(source || '').toLowerCase())
        && goalData.metadata?.missionDirectorApproved === true
        && Array.isArray(goalData.metadata?.benchmarkTests)
        && goalData.metadata.benchmarkTests.length > 0
        && goalData.metadata?.capabilityContract
        && typeof goalData.metadata.capabilityContract === 'object';
      const hasContract = goalData.metadata?.allowAutonomousExecution === true
        && (
          admissionClass === 'trading_maintenance' ||
          (admissionClass === 'safety_repair' && Boolean(goalData.metadata?.expectedArtifact)) ||
          selfEvolutionContract
        );
      if (hasContract) return { admitted: true, reason: admissionClass };
    }
    return { admitted: false, reason: 'autonomous_sources_are_proposal_only' };
  }

  reconcileExisting(goals, activeGoals) {
    let deferred = 0;
    for (const goal of goals.values()) {
      if (!activeGoals.has(goal.id) || isHumanGoal(goal)) continue;
      if (![STATUS.PROPOSED, STATUS.PENDING, STATUS.ACTIVE].includes(goal.status)) continue;
      const decision = this.decide(goal, goal.source || goal.metadata?.source || 'autonomous');
      if (decision.admitted) continue;
      this.submitProposal(goal, goal.metadata?.source || 'autonomous', 'startup_queue_reconciliation');
      goal.status = STATUS.DEFERRED;
      goal.metadata = { ...(goal.metadata || {}), deferredReason: 'work_governor_proposal_only', deferredAt: Date.now() };
      activeGoals.delete(goal.id);
      deferred++;
    }
    return { deferred };
  }

  list({ status = 'proposed', limit = 50 } = {}) {
    return this.proposals.filter(item => !status || item.status === status).slice(0, limit);
  }

  getProposal(id) {
    return this.proposals.find(item => item.id === id) || null;
  }

  markProposal(id, status, metadata = {}) {
    const proposal = this.getProposal(id);
    if (!proposal) return { success: false, error: 'Proposal not found' };
    proposal.status = String(status || proposal.status);
    proposal.metadata = { ...(proposal.metadata || {}), ...(metadata || {}) };
    proposal.updatedAt = Date.now();
    this._save();
    return { success: true, proposal };
  }
}

module.exports = { WorkGovernor, EXECUTABLE_AUTONOMOUS_CLASSES };
