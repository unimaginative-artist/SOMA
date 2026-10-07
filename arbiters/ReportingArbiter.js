// ═══════════════════════════════════════════════════════════
// FILE: arbiters/ReportingArbiter.js
// Automated daily/weekly status reports for SOMA
// Pulls from GoalPlanner, OutcomeTracker, CuriosityEngine,
// TimekeeperArbiter, CodeObserver, ApprovalSystem
// ═══════════════════════════════════════════════════════════

import fs from 'fs/promises';
import path from 'path';

export class ReportingArbiter {
  constructor(config = {}) {
    this.name = config.name || 'ReportingArbiter';
    this.reportsDir = config.reportsDir || path.join(process.cwd(), 'data', 'reports');
    this.sources = {};
    this.reports = [];
    this.maxReports = config.maxReports || 100;

    console.log(`[${this.name}] Initializing...`);
  }

  async initialize(sources = {}) {
    this.sources = sources;
    await fs.mkdir(this.reportsDir, { recursive: true });

    // Load existing report index
    try {
      const indexPath = path.join(this.reportsDir, 'index.json');
      const data = await fs.readFile(indexPath, 'utf8');
      this.reports = JSON.parse(data);
    } catch {
      this.reports = [];
    }

    console.log(`[${this.name}] Initialized with ${this.reports.length} past reports`);
  }

  async generateReport(type = 'daily_digest') {
    const now = new Date();
    const id = `${type}-${now.toISOString().slice(0, 10)}-${now.getHours().toString().padStart(2, '0')}`;

    console.log(`[${this.name}] Generating ${type} report: ${id}`);

    const sections = {};

    // Goals
    const gp = this.sources.goalPlanner;
    if (gp) {
      const stats = gp.getStatistics?.() || {};
      const active = gp.getActiveGoals?.() || { goals: [] };
      sections.goals = {
        active: active.goals?.length || gp.activeGoals?.size || 0,
        completed: stats.goalsCompleted || 0,
        failed: stats.goalsFailed || 0,
        deferred: stats.goalsDeferred || 0,
        successRate: stats.successRate || 0,
        avgCompletionDays: stats.avgCompletionDays || 0,
        topGoals: (active.goals || []).slice(0, 5).map(g => ({ title: g.title, progress: g.metrics?.progress || 0, category: g.category }))
      };
    }

    // Timekeeper rhythms
    const tk = this.sources.timekeeper;
    if (tk) {
      const tkStats = tk.stats || {};
      sections.rhythms = {
        rhythmsExecuted: tkStats.rhythmsExecuted || 0,
        pulsesEmitted: tkStats.pulsesEmitted || 0,
        totalFailed: tkStats.totalFailed || 0,
        activeRhythms: tk.cronJobs?.size || 0
      };
    }

    // Curiosity
    const cur = this.sources.curiosityEngine;
    if (cur) {
      const cs = cur.getStats?.() || cur.stats || {};
      sections.curiosity = {
        explorationsStarted: cs.explorationsStarted || 0,
        explorationsCompleted: cs.explorationsCompleted || 0,
        knowledgeGaps: cur.knowledgeGaps?.size || 0,
        currentLevel: cur.motivation?.currentCuriosity || 0
      };
    }

    // Learning
    const nlo = this.sources.nighttimeLearning;
    if (nlo) {
      sections.learning = {
        totalSessions: nlo.metrics?.totalSessions || 0,
        activeSessions: nlo.activeSessions?.size || 0,
        initialized: nlo.initialized || false
      };
    }

    // Code health
    const codeObs = this.sources.codeObserver;
    if (codeObs) {
      sections.codeHealth = {
        totalFiles: codeObs.codebase?.metrics?.totalFiles || 0,
        issues: codeObs.health?.issues?.length || 0,
        opportunities: codeObs.health?.opportunities?.length || 0,
        lastScan: codeObs.codebase?.metrics?.lastScan || null
      };
    }

    // Approvals
    const appr = this.sources.approvalSystem;
    if (appr) {
      const apprStats = appr.getStats?.() || {};
      sections.approvals = {
        total: apprStats.totalApprovals || 0,
        approvalRate: apprStats.approvalRate || 0,
        autoApprovalRate: apprStats.autoApprovalRate || 0,
        trustPatterns: apprStats.trustPatterns || 0
      };
    }

    // System uptime
    sections.system = {
      uptime: process.uptime(),
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1048576),
      timestamp: now.toISOString()
    };

    // Generate summary text
    const summary = this._generateTextSummary(type, sections, now);

    const report = {
      id,
      type,
      generatedAt: now.toISOString(),
      timestamp: now.getTime(),
      sections,
      summary
    };

    // Save to disk
    const reportPath = path.join(this.reportsDir, `${id}.json`);
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    // Update index
    this.reports.unshift({ id, type, generatedAt: report.generatedAt });
    if (this.reports.length > this.maxReports) this.reports = this.reports.slice(0, this.maxReports);
    await fs.writeFile(path.join(this.reportsDir, 'index.json'), JSON.stringify(this.reports, null, 2));

    console.log(`[${this.name}] Report saved: ${reportPath}`);

    return report;
  }

  _generateTextSummary(type, sections, now) {
    const lines = [];
    const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    lines.push(`SOMA ${type === 'weekly_summary' ? 'Weekly' : 'Daily'} Report — ${dateStr}`);
    lines.push('');

    if (sections.goals) {
      const g = sections.goals;
      lines.push(`Goals: ${g.active} active, ${g.completed} completed, ${g.failed} failed (${(g.successRate * 100).toFixed(0)}% success rate)`);
      if (g.topGoals?.length > 0) {
        for (const tg of g.topGoals) lines.push(`  - ${tg.title} (${tg.progress}%, ${tg.category})`);
      }
    }

    if (sections.rhythms) {
      const r = sections.rhythms;
      lines.push(`Rhythms: ${r.rhythmsExecuted} executed, ${r.totalFailed} failed, ${r.pulsesEmitted} pulses emitted`);
    }

    if (sections.curiosity) {
      const c = sections.curiosity;
      lines.push(`Curiosity: ${c.explorationsStarted} explorations, ${c.knowledgeGaps} knowledge gaps`);
    }

    if (sections.learning) {
      lines.push(`Learning: ${sections.learning.totalSessions} sessions total, ${sections.learning.activeSessions} active`);
    }

    if (sections.codeHealth) {
      const ch = sections.codeHealth;
      lines.push(`Code Health: ${ch.totalFiles} files, ${ch.issues} issues, ${ch.opportunities} opportunities`);
    }

    if (sections.approvals) {
      const a = sections.approvals;
      lines.push(`Approvals: ${a.total} total, ${(a.approvalRate * 100).toFixed(0)}% approved, ${(a.autoApprovalRate * 100).toFixed(0)}% auto-approved`);
    }

    if (sections.system) {
      const uptimeH = (sections.system.uptime / 3600).toFixed(1);
      lines.push(`System: ${uptimeH}h uptime, ${sections.system.memoryMB}MB RSS, ${sections.system.heapUsedMB}MB heap`);
    }

    return lines.join('\n');
  }

  async getLatestReport() {
    if (this.reports.length === 0) return null;
    const latest = this.reports[0];
    try {
      const data = await fs.readFile(path.join(this.reportsDir, `${latest.id}.json`), 'utf8');
      return JSON.parse(data);
    } catch {
      return latest;
    }
  }

  async getReport(id) {
    try {
      const data = await fs.readFile(path.join(this.reportsDir, `${id}.json`), 'utf8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  listReports(limit = 20) {
    return this.reports.slice(0, limit);
  }
}
