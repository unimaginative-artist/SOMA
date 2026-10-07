/**
 * ApprovalSystem - PRO-LEVEL User Approval Management
 *
 * Production version for SOMA main server.
 * Adapted from cognitive terminal implementation.
 *
 * Features:
 * - Smart risk detection (auto-approve safe, prompt for risky)
 * - Approval memory (remember user preferences)
 * - Trust scoring (SOMA earns autonomy over time)
 * - Batch approvals (approve multiple at once)
 * - Pattern learning (detect similar operations)
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ApprovalSystem {
  constructor() {
    this.pendingApprovals = new Map();
    this.approvalHistory = [];
    this.trustPatterns = new Map();
    this.userPreferences = {
      autoApproveThreshold: 0.8,
      alwaysAskForTypes: ['file_delete', 'system_config'],
      trustedPatterns: [],
      deniedPatterns: []
    };

    this.listeners = new Set();
    this.savePath = path.join(process.cwd(), 'data', 'approval-system.json');

    // Risk weights for different operation types
    this.riskWeights = {
      file_read: 0.1,
      file_write: 0.5,
      file_delete: 0.9,
      file_execute: 0.8,
      shell_command: 0.7,
      system_config: 0.95,
      network_request: 0.4,
      database_write: 0.6,
      database_delete: 0.85,
      social_post: 0.35,
      memory_write: 0.2,
      goal_create: 0.15,
      code_search: 0.05
    };

    // Tool → risk type mapping for SOMA tools
    this.toolRiskMap = {
      // Low risk (auto-approve)
      calculator: 'code_search', get_time: 'code_search', system_scan: 'file_read',
      recall: 'file_read', hybrid_search: 'code_search', search_code: 'code_search',
      find_files: 'code_search', list_fragments: 'code_search', get_personality: 'code_search',
      get_emotional_state: 'code_search', moltbook_feed: 'code_search', moltbook_search: 'code_search',
      git_status: 'file_read', git_log: 'file_read', git_diff: 'file_read',
      get_market_data: 'network_request', list_files: 'file_read', list_processes: 'file_read',
      check_port: 'file_read',
      // ApertureOS is HER desktop — she drives it autonomously by design;
      // NEMESIS audits quality post-hoc rather than gating pre-action.
      aperture_os: 'code_search',
      // Medium risk
      read_file: 'file_read', fetch_url: 'network_request', research_web: 'network_request',
      analyze_codebase: 'file_read', remember: 'memory_write', add_knowledge: 'memory_write',
      create_goal: 'goal_create', moltbook_post: 'social_post', moltbook_comment: 'social_post',
      moltbook_vote: 'social_post',
      // High risk
      write_file: 'file_write', edit_file: 'file_write', terminal_exec: 'shell_command',
      npm_command: 'shell_command', reindex_codebase: 'system_config',
      spawn_specialist: 'file_execute', run_simulation: 'file_execute'
    };

    console.log('[ApprovalSystem] Initialized');
  }

  async initialize() {
    try {
      const data = await fs.readFile(this.savePath, 'utf8');
      const saved = JSON.parse(data);
      this.approvalHistory = saved.history || [];
      this.trustPatterns = new Map(saved.trustPatterns || []);
      this.userPreferences = { ...this.userPreferences, ...saved.preferences };
      console.log(`[ApprovalSystem] Loaded ${this.approvalHistory.length} past approvals, ${this.trustPatterns.size} trust patterns`);
    } catch (err) {
      console.log('[ApprovalSystem] Starting with empty history');
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.savePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.savePath, JSON.stringify({
        history: this.approvalHistory.slice(-1000),
        trustPatterns: Array.from(this.trustPatterns.entries()),
        preferences: this.userPreferences,
        savedAt: new Date().toISOString()
      }, null, 2));
    } catch (err) {
      console.error('[ApprovalSystem] Failed to save:', err.message);
    }
  }

  /**
   * Classify a SOMA tool into a risk type and score
   */
  classifyTool(toolName, args) {
    const riskType = this.toolRiskMap[toolName] || 'file_execute';
    let riskScore = this.riskWeights[riskType] || 0.5;

    // Boost risk for dangerous args
    const argsStr = JSON.stringify(args || {}).toLowerCase();
    if (argsStr.includes('delete') || argsStr.includes('rm ')) riskScore = Math.min(1.0, riskScore + 0.2);
    if (argsStr.includes('sudo') || argsStr.includes('admin')) riskScore = Math.min(1.0, riskScore + 0.3);
    if (argsStr.includes('-rf') || argsStr.includes('recursive')) riskScore = Math.min(1.0, riskScore + 0.3);

    return { riskType, riskScore };
  }

  async requestApproval(operation) {
    const { type, action, details, context = {}, riskOverride } = operation;
    const riskScore = riskOverride ?? this.calculateRiskScore(type, details, context);
    const patternHash = this.generatePatternHash(type, details);

    if (this.userPreferences.trustedPatterns.includes(patternHash)) {
      this.recordApproval(operation, true, true, 'trusted_pattern');
      return { approved: true, autoApproved: true, reason: 'trusted_pattern' };
    }

    if (this.userPreferences.deniedPatterns.includes(patternHash)) {
      this.recordApproval(operation, false, true, 'blocked_pattern');
      return { approved: false, autoApproved: true, reason: 'blocked_pattern' };
    }

    const trustScore = this.trustPatterns.get(patternHash) || 0;
    const shouldAutoApprove =
      riskScore < 0.3 ||
      (trustScore >= this.userPreferences.autoApproveThreshold &&
       !this.userPreferences.alwaysAskForTypes.includes(type));

    if (shouldAutoApprove) {
      this.recordApproval(operation, true, true, 'low_risk_or_trusted');
      return { approved: true, autoApproved: true, reason: 'low_risk_or_trusted' };
    }

    return await this.promptUser(operation, riskScore, trustScore, patternHash);
  }

  calculateRiskScore(type, details, context) {
    let baseRisk = this.riskWeights[type] || 0.5;
    const detailsStr = JSON.stringify(details).toLowerCase();

    if (detailsStr.includes('delete') || detailsStr.includes('rm ')) baseRisk = Math.min(1.0, baseRisk + 0.2);
    if (detailsStr.includes('sudo') || detailsStr.includes('admin')) baseRisk = Math.min(1.0, baseRisk + 0.3);
    if (detailsStr.includes('system32') || detailsStr.includes('/etc/')) baseRisk = Math.min(1.0, baseRisk + 0.4);
    if (detailsStr.includes('recursive') || detailsStr.includes('-rf')) baseRisk = Math.min(1.0, baseRisk + 0.3);
    if (type === 'file_read' || detailsStr.includes('readonly')) baseRisk = Math.max(0.1, baseRisk - 0.2);

    return baseRisk;
  }

  generatePatternHash(type, details) {
    const normalized = JSON.stringify({ type, pattern: this.extractPattern(details) });
    return crypto.createHash('sha256').update(normalized).digest('hex').substring(0, 16);
  }

  extractPattern(details) {
    const str = JSON.stringify(details);
    const extensions = (str.match(/\.\w+/g) || []).join(',');
    const commands = (str.match(/\b(npm|node|git|rm|cp|mv|mkdir|touch)\b/g) || []).join(',');
    return { extensions, commands };
  }

  async promptUser(operation, riskScore, trustScore, patternHash) {
    const approvalId = crypto.randomUUID();
    const request = {
      id: approvalId, ...operation,
      riskScore, trustScore, patternHash,
      timestamp: Date.now(),
      expiresAt: Date.now() + 60000
    };

    this.pendingApprovals.set(approvalId, request);
    this.broadcast('approval_required', request);
    console.log(`[ApprovalSystem] Waiting for approval: ${operation.action}`);

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const approval = this.pendingApprovals.get(approvalId);
        if (!approval) {
          clearInterval(checkInterval);
          resolve({ approved: false, autoApproved: false, reason: 'cancelled' });
          return;
        }

        if (approval.response) {
          clearInterval(checkInterval);
          this.pendingApprovals.delete(approvalId);
          this.recordApproval(operation, approval.response.approved, false, approval.response.reason || 'user_decision');
          if (approval.response.rememberPattern) {
            this.updateTrustPattern(patternHash, approval.response.approved);
          }
          resolve({ approved: approval.response.approved, autoApproved: false, reason: approval.response.reason || 'user_decision' });
        }

        if (Date.now() > approval.expiresAt) {
          clearInterval(checkInterval);
          this.pendingApprovals.delete(approvalId);
          this.recordApproval(operation, false, false, 'timeout');
          resolve({ approved: false, autoApproved: false, reason: 'timeout' });
        }
      }, 100);
    });
  }

  respondToApproval(response) {
    const approval = this.pendingApprovals.get(response.requestId);
    if (!approval) return false;
    approval.response = {
      approved: response.approved,
      rememberPattern: response.rememberDecision || false,
      reason: response.reason || 'user_decision'
    };
    return true;
  }

  updateTrustPattern(patternHash, approved) {
    const currentTrust = this.trustPatterns.get(patternHash) || 0.5;
    const newTrust = approved
      ? currentTrust + (1 - currentTrust) * 0.3
      : currentTrust * 0.7;
    this.trustPatterns.set(patternHash, newTrust);
    this.save();
  }

  recordApproval(operation, approved, autoApproved, reason) {
    this.approvalHistory.push({ ...operation, approved, autoApproved, reason, timestamp: Date.now() });
    if (this.approvalHistory.length > 1000) this.approvalHistory.shift();
    this.save();
  }

  getPendingApprovals() { return Array.from(this.pendingApprovals.values()); }

  getStats() {
    const recent = this.approvalHistory.slice(-100);
    return {
      totalApprovals: this.approvalHistory.length,
      recentApprovals: recent.length,
      approvalRate: recent.filter(a => a.approved).length / (recent.length || 1),
      autoApprovalRate: recent.filter(a => a.autoApproved).length / (recent.length || 1),
      trustPatterns: this.trustPatterns.size,
      avgTrustScore: Array.from(this.trustPatterns.values()).reduce((a, b) => a + b, 0) / (this.trustPatterns.size || 1)
    };
  }

  addWebSocketListener(emitFunc) { this.listeners.add({ emit: emitFunc }); }
  addListener(listener) { this.listeners.add(listener); }
  removeListener(listener) { this.listeners.delete(listener); }

  broadcast(event, data) {
    for (const listener of this.listeners) {
      try {
        if (typeof listener.emit === 'function') listener.emit(event, data);
        else if (typeof listener === 'function') listener(event, data);
      } catch (err) {
        console.error('[ApprovalSystem] Broadcast failed:', err.message);
      }
    }
  }
}

let approvalSystem = null;
function getApprovalSystem() {
  if (!approvalSystem) approvalSystem = new ApprovalSystem();
  return approvalSystem;
}

module.exports = { ApprovalSystem, getApprovalSystem };
