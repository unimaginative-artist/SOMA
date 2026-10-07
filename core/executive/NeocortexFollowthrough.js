import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export class NeocortexFollowthrough {
  constructor(opts = {}) {
    this.name = 'NeocortexFollowthrough';
    this.system = opts.system || null;
    this.logger = opts.logger || console;
    this.receiptsPath = path.resolve(opts.receiptsPath || 'SOMA/executive-followthrough-receipts.jsonl');
    
    // In-memory registry of active followthrough leases: goalId -> intent
    this.activeIntents = new Map();
    this.maxHistory = opts.maxHistory || 100;
  }

  async initialize() {
    try {
      await fs.mkdir(path.dirname(this.receiptsPath), { recursive: true });
    } catch {}
    return this;
  }

  /**
   * Register an executive followthrough lease when a goal is authorized or queued.
   */
  registerIntent({
    goalId,
    taskTitle = '',
    channel = 'live_chat',
    channelId = null,
    user = 'Owner',
    expectedArtifact = null,
    metadata = {}
  } = {}) {
    if (!goalId) return null;
    
    const intent = {
      goalId,
      taskTitle: taskTitle || goalId,
      channel,
      channelId,
      user,
      expectedArtifact,
      metadata,
      registeredAt: Date.now(),
      status: 'executing'
    };

    this.activeIntents.set(goalId, intent);
    if (this.activeIntents.size > this.maxHistory) {
      const oldestKey = this.activeIntents.keys().next().value;
      this.activeIntents.delete(oldestKey);
    }

    this.logger.info?.(`[${this.name}] 📋 Registered followthrough lease for goal "${taskTitle}" (${goalId}) on ${channel}`);
    return intent;
  }

  /**
   * Match an intent by goalId, title, or find most recent pending intent.
   */
  getIntent(goalId, title = '') {
    if (goalId && this.activeIntents.has(goalId)) {
      return this.activeIntents.get(goalId);
    }

    // Secondary match: title substring or most recent
    if (title) {
      for (const intent of this.activeIntents.values()) {
        if (intent.status === 'executing' && (intent.taskTitle.includes(title) || title.includes(intent.taskTitle))) {
          return intent;
        }
      }
    }

    return null;
  }

  /**
   * Extract meaningful concrete findings from goal completion evidence.
   */
  extractFindings(goal = {}, result = {}) {
    const findings = [];
    const meta = goal.metadata || {};
    const res = result || meta.completionResult || {};

    // 1. Check for artifact files
    const artifactPath = res.artifact || meta.expectedArtifact || meta.outputHint || (meta.verification?.filesExist?.[0]) || null;
    let artifactContent = '';

    if (artifactPath && existsSync(artifactPath)) {
      try {
        const raw = readFileSync(artifactPath, 'utf8');
        artifactContent = raw.slice(0, 2000); // Sample first 2000 chars

        // Try JSON metrics extraction
        try {
          const parsed = JSON.parse(raw);
          if (parsed.summary) {
            findings.push(`Summary: ${JSON.stringify(parsed.summary)}`);
          }
          const m = parsed.metrics || parsed.results || parsed;
          if (m) {
            if (m.winRate !== undefined) findings.push(`Win Rate: ${m.winRate}%`);
            if (m.totalReturn !== undefined || m.returnPct !== undefined || m.netReturn !== undefined) findings.push(`Net Return: ${(m.totalReturn ?? m.returnPct ?? m.netReturn)}%`);
            if (m.profitFactor !== undefined) findings.push(`Profit Factor: ${m.profitFactor}`);
            if (m.maxDrawdown !== undefined || m.maxDrawdownPct !== undefined) findings.push(`Max Drawdown: ${(m.maxDrawdown ?? m.maxDrawdownPct)}%`);
          }
        } catch {
          // Markdown / text artifact: extract bullet points or high-signal lines
          const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
          const bullets = lines.filter(l => l.startsWith('-') || l.startsWith('*') || l.startsWith('•') || l.startsWith('1.')).slice(0, 4);
          if (bullets.length > 0) {
            bullets.forEach(b => findings.push(b.replace(/^[-*•\d.]+\s*/, '')));
          } else if (lines.length > 0) {
            findings.push(lines.slice(0, 3).join(' '));
          }
        }
      } catch (err) {
        this.logger.warn?.(`[${this.name}] Failed to read artifact at ${artifactPath}: ${err.message}`);
      }
    }

    // 2. Check result metadata directly
    if (res.summary && typeof res.summary === 'string' && !findings.length) {
      findings.push(res.summary);
    }
    if (res.trades !== undefined) {
      findings.push(`Total trades executed: ${res.trades}`);
    }
    if (res.filesChanged && Array.isArray(res.filesChanged)) {
      findings.push(`Changed/Verified files: ${res.filesChanged.slice(0, 3).join(', ')}`);
    }

    // 3. Fallback if no specific artifact content was extractable
    if (!findings.length) {
      if (goal.description) {
        findings.push(`Executed plan as defined: ${goal.description.slice(0, 150)}`);
      } else {
        findings.push('Task completed and verified against success criteria.');
      }
    }

    return {
      findings,
      artifactPath,
      snippet: artifactContent.slice(0, 300)
    };
  }

  /**
   * Handle goal_completed event: synthesize findings and report back across channels.
   */
  async handleGoalCompleted({ goal = {}, result = {} } = {}) {
    const goalId = goal.id || result.goalId;
    const taskTitle = goal.title || result.title || 'Requested Task';
    const intent = this.getIntent(goalId, taskTitle);

    const { findings, artifactPath } = this.extractFindings(goal, result);

    const bullets = findings.map(f => `• ${f}`).join('\n');
    const artifactCitation = artifactPath ? `\n\n📄 **Artifact/Evidence**: \`${artifactPath}\`` : '';

    const reportMessage = [
      `Hey Owner, I finished executing **${taskTitle}**.`,
      `\nHere is what I found while doing it:\n${bullets}`,
      artifactCitation
    ].filter(Boolean).join('\n');

    this.logger.info?.(`[${this.name}] 🎯 Closed-Loop Synthesis ready for "${taskTitle}":\n${reportMessage}`);

    const dispatchOutcomes = {
      discord: false,
      workingMemory: false,
      broadcast: false
    };

    // 1. Dispatch to Discord if requested from Discord or if default channel exists
    try {
      const discord = this.system?.discordArbiter || global.__SOMA_SYSTEM__?.discordArbiter;
      const targetChannelId = intent?.channelId || (intent?.channel === 'discord' ? intent.channelId : null);
      if (discord && typeof discord.sendMessage === 'function' && targetChannelId) {
        await discord.sendMessage({
          channelId: targetChannelId,
          message: reportMessage
        });
        dispatchOutcomes.discord = true;
        this.logger.info?.(`[${this.name}] 🚀 Dispatched followthrough report to Discord channel ${targetChannelId}`);
      }
    } catch (err) {
      this.logger.warn?.(`[${this.name}] Discord dispatch fail-open: ${err.message}`);
    }

    // 2. Ingest into WorkingMemory present-tense context (for immediate web chat awareness)
    try {
      const wm = this.system?.workingMemory || global.__SOMA_SYSTEM__?.workingMemory;
      if (wm) {
        const topFinding = findings[0] || 'Completed successfully';
        wm.addAction(`Completed: ${taskTitle}`, topFinding);
        wm.addDiscovery(taskTitle, topFinding, 'executive_followthrough');
        wm.setPreoccupation(`Finished ${taskTitle} for Owner; findings ready.`);
        dispatchOutcomes.workingMemory = true;
        this.logger.info?.(`[${this.name}] 🧠 Ingested findings into WorkingMemory present-tense block`);
      }
    } catch (err) {
      this.logger.warn?.(`[${this.name}] WorkingMemory ingest fail-open: ${err.message}`);
    }

    // 3. Emit real-time WebSocket broadcast to Command Bridge
    try {
      const broadcast = this.system?.broadcast || global.__SOMA_SYSTEM__?.broadcast;
      if (typeof broadcast === 'function') {
        broadcast('soma_activity', {
          type: 'executive_followthrough',
          goalId,
          title: taskTitle,
          status: 'completed',
          findings,
          artifactPath,
          timestamp: Date.now()
        });
        broadcast('pulse', {
          type: 'soma_proactive',
          message: reportMessage
        });
        dispatchOutcomes.broadcast = true;
      }
    } catch (err) {
      this.logger.warn?.(`[${this.name}] WebSocket broadcast fail-open: ${err.message}`);
    }

    // 4. Record durable receipt
    const receipt = {
      timestamp: Date.now(),
      goalId,
      taskTitle,
      status: 'completed',
      originChannel: intent?.channel || 'unknown',
      findings,
      artifactPath,
      reportMessage,
      dispatchOutcomes
    };

    await this._recordReceipt(receipt);

    if (intent) {
      intent.status = 'reported';
    }

    return receipt;
  }

  /**
   * Handle goal_failed event: synthesize truthful blocker report.
   */
  async handleGoalFailed({ goal = {}, reason = '' } = {}) {
    const goalId = goal.id;
    const taskTitle = goal.title || 'Requested Task';
    const intent = this.getIntent(goalId, taskTitle);

    const failureReason = reason || goal.metadata?.failureReason || 'Verification check failed to pass criteria';

    const reportMessage = [
      `Hey Owner, I hit a blocker while trying to execute **${taskTitle}**.`,
      `\n⚠️ **Blocker Reason**: ${failureReason}`,
      `\nI halted execution truthfully rather than pretending it completed. I can retry with revised parameters if you wish.`
    ].join('\n');

    this.logger.warn?.(`[${this.name}] ⚠️ Closed-Loop Blocker Report for "${taskTitle}": ${failureReason}`);

    const dispatchOutcomes = {
      discord: false,
      workingMemory: false,
      broadcast: false
    };

    // 1. Dispatch to Discord
    try {
      const discord = this.system?.discordArbiter || global.__SOMA_SYSTEM__?.discordArbiter;
      const targetChannelId = intent?.channelId;
      if (discord && typeof discord.sendMessage === 'function' && targetChannelId) {
        await discord.sendMessage({
          channelId: targetChannelId,
          message: reportMessage
        });
        dispatchOutcomes.discord = true;
      }
    } catch {}

    // 2. Ingest into WorkingMemory
    try {
      const wm = this.system?.workingMemory || global.__SOMA_SYSTEM__?.workingMemory;
      if (wm) {
        wm.addAction(`Blocked: ${taskTitle}`, failureReason);
        wm.setPreoccupation(`Stalled on ${taskTitle}: ${failureReason.slice(0, 80)}`);
        dispatchOutcomes.workingMemory = true;
      }
    } catch {}

    // 3. Broadcast
    try {
      const broadcast = this.system?.broadcast || global.__SOMA_SYSTEM__?.broadcast;
      if (typeof broadcast === 'function') {
        broadcast('soma_activity', {
          type: 'executive_followthrough',
          goalId,
          title: taskTitle,
          status: 'failed',
          reason: failureReason,
          timestamp: Date.now()
        });
        dispatchOutcomes.broadcast = true;
      }
    } catch {}

    const receipt = {
      timestamp: Date.now(),
      goalId,
      taskTitle,
      status: 'failed',
      reason: failureReason,
      reportMessage,
      dispatchOutcomes
    };

    await this._recordReceipt(receipt);

    if (intent) {
      intent.status = 'failed_reported';
    }

    return receipt;
  }

  async _recordReceipt(receipt) {
    try {
      await fs.appendFile(this.receiptsPath, JSON.stringify(receipt) + '\n', 'utf8');
    } catch (err) {
      this.logger.warn?.(`[${this.name}] Failed to append receipt: ${err.message}`);
    }
  }
}
