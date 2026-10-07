'use strict';

const fs = require('fs');
const path = require('path');
const { isTerminal, STATUS } = require('./GoalLifecycle.cjs');
const ACTIVE_MISSION_STATES = new Set([STATUS.PROPOSED, STATUS.PENDING, STATUS.ACTIVE, STATUS.DELEGATED]);

class AutonomyScoreboard {
  constructor({ planner, governor, dataDir = path.join(process.cwd(), 'data') } = {}) {
    this.planner = planner;
    this.governor = governor;
    this.filePath = path.join(dataDir, 'autonomy-scoreboard.json');
  }

  snapshot({ idleReason = null, resource = null, historical = null } = {}) {
    const goals = [...(this.planner?.goals?.values?.() || [])]
      .filter(goal => goal?.metadata?.autonomousMission === true);
    const proposals = this.governor?.proposals || [];
    const completed = goals.filter(goal => goal.status === STATUS.COMPLETED);
    const failed = goals.filter(goal => isTerminal(goal.status) && goal.status !== STATUS.COMPLETED);
    const useful = completed.filter(goal => goal.metadata?.completionClassification !== 'artifact_only');
    const completedProposals = proposals.filter(item => item.status === 'completed' && item.metadata?.outcome !== 'artifact_only');
    const failedProposals = proposals.filter(item => item.status === 'failed');
    const verifiedCompletionCount = Math.max(completed.length, completedProposals.length, Number(historical?.verifiedCompletions || 0));
    const usefulCompletionCount = Math.max(useful.length, completedProposals.length, Number(historical?.verifiedCompletions || 0));
    const failedMissionCount = Math.max(failed.length, failedProposals.length, Number(historical?.failedMissions || 0));
    const byCategory = {};
    for (const goal of goals) {
      const key = String(goal.category || 'general');
      byCategory[key] ||= { total: 0, completed: 0, failed: 0 };
      byCategory[key].total++;
      if (goal.status === STATUS.COMPLETED) byCategory[key].completed++;
      else if (isTerminal(goal.status)) byCategory[key].failed++;
    }
    for (const row of Object.values(byCategory)) {
      row.completionRate = row.total ? Math.round((row.completed / row.total) * 1000) / 10 : 0;
    }
    const weakestArea = Object.entries(byCategory)
      .filter(([, row]) => row.total > 0)
      .sort((a, b) => a[1].completionRate - b[1].completionRate || b[1].total - a[1].total)[0]?.[0] || 'goal_completion';
    const failureCauses = {};
    for (const goal of failed) {
      const reason = String(goal.metadata?.lastTransition?.reason || goal.status || 'unknown');
      failureCauses[reason] = (failureCauses[reason] || 0) + 1;
    }
    const result = {
      version: 1,
      generatedAt: Date.now(),
      usefulCompletions: usefulCompletionCount,
      verifiedCompletions: verifiedCompletionCount,
      failedMissions: failedMissionCount,
      artifactOnlyCompletions: completed.length - useful.length,
      activeMissions: goals.filter(goal => ACTIVE_MISSION_STATES.has(goal.status)).length,
      proposals: {
        proposed: proposals.filter(item => item.status === 'proposed').length,
        rejected: proposals.filter(item => item.status === 'rejected').length,
        deduplicatedSignals: proposals.reduce((sum, item) => sum + Math.max(0, Number(item.seenCount || 1) - 1), 0)
      },
      completionRate: (verifiedCompletionCount + failedMissionCount)
        ? Math.round((verifiedCompletionCount / (verifiedCompletionCount + failedMissionCount)) * 1000) / 10
        : 0,
      weakestArea,
      byCategory,
      failureCauses,
      idleReason,
      resource
    };
    this._write(result);
    return result;
  }

  _write(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temp, this.filePath);
  }
}

module.exports = { AutonomyScoreboard };
