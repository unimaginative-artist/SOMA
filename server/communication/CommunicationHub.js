import fs from 'fs';
import path from 'path';

const DEFAULT_STATE = {
  messages: [],
  receipts: [],
  approvals: [],
  timeline: [],
  agents: [
    { id: 'soma', name: 'SOMA', role: 'Primary interface', status: 'ready', confidence: 0.92 },
    { id: 'steve', name: 'Steve', role: 'Refinement agent', status: 'standby', confidence: 0.9 },
    { id: 'kevin', name: 'Kevin', role: 'Security auditor', status: 'standby', confidence: 0.88 },
    { id: 'aurora', name: 'Aurora', role: 'Creative synthesizer', status: 'standby', confidence: 0.91 },
    { id: 'prometheus', name: 'Prometheus', role: 'Strategic planner', status: 'standby', confidence: 0.86 }
  ]
};

const RISK_WORDS = /\b(post|publish|send|delete|remove|trade|buy|sell|order|deploy|email|message|sms|tweet|bluesky|wattpad|execute|run command|terminal)\b/i;
const ROUTES = [
  { id: 'mission_control', agent: 'SOMA', label: 'Mission Control', rx: /\b(trade|market|p&l|profit|loss|scan|ticker|btc|eth|stock|strategy|backtest)\b/i, risk: 'high' },
  { id: 'medlab', agent: 'SOMA', label: 'MedLab', rx: /\b(medical|drug|disease|paper|pubmed|clinical|protein|therapy|cancer|patient)\b/i, risk: 'high' },
  { id: 'pulse', agent: 'Steve', label: 'Pulse', rx: /\b(code|bug|syntax|refactor|build|frontend|backend|component|script|app)\b/i, risk: 'medium' },
  { id: 'security', agent: 'Kevin', label: 'Security', rx: /\b(security|phishing|permission|key|token|secret|risk|audit|malware|scam)\b/i, risk: 'high' },
  { id: 'reflections', agent: 'Aurora', label: 'Reflections', rx: /\b(story|chapter|note|reflection|muse|creative|book|write|journal)\b/i, risk: 'low' },
  { id: 'strategy', agent: 'Prometheus', label: 'Strategy', rx: /\b(plan|roadmap|priority|architecture|mission|goal|next)\b/i, risk: 'medium' }
];

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampList(list, max) {
  return Array.isArray(list) ? list.slice(-max) : [];
}

export default class CommunicationHub {
  constructor({ rootDir = process.cwd() } = {}) {
    this.dir = path.join(rootDir, 'data', 'communication-hub');
    this.file = path.join(this.dir, 'state.json');
    this.state = this.load();
    // Enterprise notification channels — set via env vars
    this._slackWebhook = process.env.SOMA_SLACK_WEBHOOK_URL || null;
    this._teamsWebhook = process.env.SOMA_TEAMS_WEBHOOK_URL || null;
    this._notifyEmail  = process.env.SOMA_NOTIFY_EMAIL      || null;
  }

  /**
   * Send a Slack notification via incoming webhook.
   * Requires SOMA_SLACK_WEBHOOK_URL env var.
   * @param {string} text — main message text
   * @param {object} opts — { emoji, title, fields: [{title, value}], urgent }
   */
  async notifySlack(text, { emoji = ':robot_face:', title = null, fields = [], urgent = false } = {}) {
    if (!this._slackWebhook) return { sent: false, reason: 'SOMA_SLACK_WEBHOOK_URL not configured' };
    try {
      const blocks = [];
      if (title) {
        blocks.push({ type: 'header', text: { type: 'plain_text', text: `${emoji} ${title}`, emoji: true } });
      }
      blocks.push({ type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 3000) } });
      if (fields.length) {
        blocks.push({
          type: 'section',
          fields: fields.slice(0, 10).map(f => ({ type: 'mrkdwn', text: `*${f.title}*\n${f.value}` }))
        });
      }
      blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `SOMA · ${new Date().toLocaleString()}${urgent ? ' · *URGENT*' : ''}` }] });

      const body = JSON.stringify({ blocks, text: text.slice(0, 300) });
      const res = await fetch(this._slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000)
      });
      const ok = res.ok;
      this.addTimeline({ type: 'outbox', title: 'Slack notification sent', detail: text.slice(0, 120), route: 'slack', agent: 'SOMA', priority: urgent ? 'important' : 'normal' });
      this.save();
      return { sent: ok, status: res.status };
    } catch (e) {
      return { sent: false, error: e.message };
    }
  }

  /**
   * Send a Microsoft Teams notification via incoming webhook.
   * Requires SOMA_TEAMS_WEBHOOK_URL env var.
   */
  async notifyTeams(text, { title = 'SOMA Update', urgent = false } = {}) {
    if (!this._teamsWebhook) return { sent: false, reason: 'SOMA_TEAMS_WEBHOOK_URL not configured' };
    try {
      const body = JSON.stringify({
        '@type': 'MessageCard',
        '@context': 'http://schema.org/extensions',
        summary: title,
        themeColor: urgent ? 'FF0000' : '0078D4',
        title,
        text: text.slice(0, 4000)
      });
      const res = await fetch(this._teamsWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(8000)
      });
      return { sent: res.ok, status: res.status };
    } catch (e) {
      return { sent: false, error: e.message };
    }
  }

  /** Broadcast to all configured enterprise channels */
  async notifyAll(text, opts = {}) {
    const results = {};
    if (this._slackWebhook)  results.slack  = await this.notifySlack(text, opts);
    if (this._teamsWebhook)  results.teams  = await this.notifyTeams(text, opts);
    return results;
  }

  load() {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      if (!fs.existsSync(this.file)) {
        fs.writeFileSync(this.file, JSON.stringify(DEFAULT_STATE, null, 2));
        return structuredClone(DEFAULT_STATE);
      }
      return { ...structuredClone(DEFAULT_STATE), ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch {
      return structuredClone(DEFAULT_STATE);
    }
  }

  save() {
    try {
      if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
      const compact = {
        ...this.state,
        messages: clampList(this.state.messages, 400),
        receipts: clampList(this.state.receipts, 200),
        approvals: clampList(this.state.approvals, 120),
        timeline: clampList(this.state.timeline, 500)
      };
      this.state = compact;
      fs.writeFileSync(this.file, JSON.stringify(compact, null, 2));
    } catch {
      /* communication hub never blocks chat */
    }
  }

  classify(text = '', context = {}) {
    const route = ROUTES.find(r => r.rx.test(text)) || { id: 'orb', agent: 'SOMA', label: 'Presence', risk: 'low' };
    const needsApproval = RISK_WORDS.test(text) && route.risk !== 'low';
    const trust = this.trustFor({ text, route, context, needsApproval });
    return {
      route: route.id,
      routeLabel: route.label,
      agent: route.agent,
      risk: route.risk,
      needsApproval,
      priority: route.risk === 'high' ? 'important' : route.risk === 'medium' ? 'normal' : 'ambient',
      trust
    };
  }

  trustFor({ route, context = {}, needsApproval = false }) {
    let score = 0.72;
    const factors = ['persistent receipt', 'communication memory'];
    if (context.backendConnected !== false) {
      score += 0.08;
      factors.push('backend connected');
    }
    if (context.liveData) {
      score += 0.08;
      factors.push('live data declared');
    }
    if (route.risk === 'high') {
      score -= 0.12;
      factors.push('high risk domain');
    }
    if (needsApproval) {
      score -= 0.08;
      factors.push('approval required');
    }
    return {
      score: Math.max(0.15, Math.min(0.98, Number(score.toFixed(2)))),
      factors,
      source: context.source || 'orb'
    };
  }

  addTimeline(event) {
    const item = { id: makeId('evt'), ts: nowIso(), ...event };
    this.state.timeline.push(item);
    return item;
  }

  recordMessage({ role, text, channel = 'orb', route, agent, trust, metadata = {} }) {
    const classified = route ? { route, agent: agent || 'SOMA', trust } : this.classify(text, metadata);
    const msg = {
      id: makeId('msg'),
      ts: nowIso(),
      role,
      text: String(text || '').slice(0, 6000),
      channel,
      route: classified.route,
      agent: classified.agent,
      trust: classified.trust || trust || null,
      metadata
    };
    this.state.messages.push(msg);
    this.addTimeline({
      type: role === 'user' ? 'inbox' : 'outbox',
      title: role === 'user' ? 'Incoming message' : 'Outgoing response',
      detail: msg.text.slice(0, 160),
      route: msg.route,
      agent: msg.agent,
      priority: classified.priority || 'normal'
    });
    this.save();
    return msg;
  }

  createReceipt({ title = 'Communication task', text = '', channel = 'orb', context = {} }) {
    const classified = this.classify(text, context);
    const receipt = {
      id: makeId('rcpt'),
      ts: nowIso(),
      updatedAt: nowIso(),
      title,
      text: String(text || '').slice(0, 2000),
      channel,
      status: 'queued',
      steps: [
        { label: 'Queued', status: 'done', ts: nowIso() },
        { label: 'Routed', status: 'done', ts: nowIso(), detail: classified.routeLabel },
        { label: 'Running', status: 'active' },
        { label: 'Evidence', status: 'pending' },
        { label: 'Result', status: 'pending' },
        { label: 'Saved', status: 'pending' }
      ],
      ...classified
    };
    this.state.receipts.push(receipt);
    this.recordMessage({ role: 'user', text, channel, route: classified.route, agent: classified.agent, trust: classified.trust, metadata: context });
    this.addTimeline({ type: 'receipt', title: 'Action receipt opened', detail: title, route: classified.route, agent: classified.agent, priority: classified.priority });
    let approval = null;
    if (classified.needsApproval) {
      approval = this.createApproval({
        title: `Approve ${classified.routeLabel} action`,
        text,
        route: classified.route,
        agent: classified.agent,
        receiptId: receipt.id
      });
    }
    this.save();
    return { receipt, approval };
  }

  updateReceipt(id, patch = {}) {
    const receipt = this.state.receipts.find(r => r.id === id);
    if (!receipt) return null;
    Object.assign(receipt, patch, { updatedAt: nowIso() });
    if (patch.status === 'running') {
      receipt.steps = receipt.steps.map(s => s.label === 'Running' ? { ...s, status: 'active', ts: nowIso() } : s);
    }
    if (patch.status === 'completed') {
      receipt.steps = receipt.steps.map(s => ['Running', 'Evidence', 'Result', 'Saved'].includes(s.label) ? { ...s, status: 'done', ts: nowIso() } : s);
      this.addTimeline({ type: 'receipt', title: 'Action receipt completed', detail: receipt.title, route: receipt.route, agent: receipt.agent, priority: receipt.priority });
    }
    if (patch.response) {
      this.recordMessage({ role: 'soma', text: patch.response, channel: receipt.channel, route: receipt.route, agent: receipt.agent, trust: receipt.trust, metadata: { receiptId: receipt.id } });
    }
    this.save();
    return receipt;
  }

  createApproval({ title, text, route, agent, receiptId }) {
    const approval = {
      id: makeId('appr'),
      ts: nowIso(),
      title,
      text: String(text || '').slice(0, 2000),
      route,
      agent,
      receiptId,
      status: 'pending'
    };
    this.state.approvals.push(approval);
    this.addTimeline({ type: 'approval', title: 'Approval required', detail: title, route, agent, priority: 'important' });
    return approval;
  }

  resolveApproval(id, status = 'approved') {
    const approval = this.state.approvals.find(a => a.id === id);
    if (!approval) return null;
    approval.status = status;
    approval.resolvedAt = nowIso();
    this.addTimeline({ type: 'approval', title: `Approval ${status}`, detail: approval.title, route: approval.route, agent: approval.agent, priority: 'normal' });
    this.save();
    return approval;
  }

  getState(limit = 50) {
    const recent = (list) => clampList(list, limit).reverse();
    return {
      agents: this.state.agents,
      inbox: recent(this.state.messages.filter(m => m.role === 'user')),
      outbox: recent(this.state.messages.filter(m => m.role !== 'user')),
      receipts: recent(this.state.receipts),
      approvals: recent(this.state.approvals),
      timeline: recent(this.state.timeline),
      stats: {
        messages: this.state.messages.length,
        pendingApprovals: this.state.approvals.filter(a => a.status === 'pending').length,
        openReceipts: this.state.receipts.filter(r => !['completed', 'failed'].includes(r.status)).length
      }
    };
  }
}
