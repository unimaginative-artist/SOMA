import path from 'path';
import fs from 'fs/promises';
import crypto from 'node:crypto';
import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

/**
 * SecurityCouncilArbiter
 * 
 * "KEVIN's Brain Upgrade"
 * 
 * Orchestrates a security debate for threat analysis:
 * 1. The Paranoid (Flags everything)
 * 2. The Pragmatist (False Positive check)
 * 3. The Forensics Expert (Deep analysis/Vision)
 * 4. The CISO (Verdict)
 */
export class SecurityCouncilArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'SecurityCouncilArbiter',
      role: ArbiterRole.GUARDIAN,
      capabilities: [
        ArbiterCapability.NETWORK_ACCESS,
        ArbiterCapability.READ_FILES
      ]
    });

    this.quadBrain = opts.quadBrain || null;
    this.visionArbiter = opts.visionArbiter || null;
    this.recentAlerts = [];
    
    // 🧠 THREAT MEMORY (The Learning Loop)
    this.threatMemoryPath = path.join(process.cwd(), '.soma', 'threat_patterns.json');
    this.threatDatabase = {
        botSignatures: [],
        humanSignatures: [],
        scamPatterns: [],
        lastEvolved: null
    };
  }

  async onInitialize() {
    await this.loadThreatMemory();
    this.auditLogger.info('Security Council initialized with Persistent Memory');
  }

  async loadThreatMemory() {
    try {
        const data = await fs.readFile(this.threatMemoryPath, 'utf8');
        this.threatDatabase = JSON.parse(data);
        this.auditLogger.success(`[Security] Loaded ${this.threatDatabase.scamPatterns.length} persistent threat patterns.`);
    } catch (e) {
        this.auditLogger.warn('[Security] No threat memory found. Initializing fresh database.');
        await this.saveThreatMemory();
    }
  }

  async saveThreatMemory() {
    try {
        await fs.mkdir(path.dirname(this.threatMemoryPath), { recursive: true });
        await fs.writeFile(this.threatMemoryPath, JSON.stringify(this.threatDatabase, null, 2));
    } catch (e) {
        this.auditLogger.error(`[Security] Failed to save memory: ${e.message}`);
    }
  }

  /**
   * 🧬 EVOLUTION: Distill new security rules from experience
   */
  async evolvePatterns() {
    if (!this.quadBrain || this.recentAlerts.length < 5) return;

    this.auditLogger.info('🧬 [Evolution] Distilling new threat patterns from recent encounters...');
    
    const context = JSON.stringify(this.recentAlerts.slice(-10));
    const prompt = `
      Review the recent security alerts: ${context}
      
      Current Patterns: ${JSON.stringify(this.threatDatabase)}
      
      TASK:
      Identify 1-2 NEW specific keywords, regex patterns, or behavioral markers 
      that distinguish BOTS, HUMANS (on AI sites), or SCAMMERS.
      
      OUTPUT FORMAT:
      { "type": "bot|human|scam", "pattern": "string", "reason": "why" }
    `;

    try {
        const result = await this.quadBrain.reason(prompt, 'analytical');
        const update = JSON.parse(result.text.replace(/```json/g, '').replace(/```/g, '').trim());
        
        if (update.type === 'bot') this.threatDatabase.botSignatures.push(update.pattern);
        if (update.type === 'human') this.threatDatabase.humanSignatures.push(update.pattern);
        if (update.type === 'scam') this.threatDatabase.scamPatterns.push(update.pattern);
        
        this.threatDatabase.lastEvolved = new Date().toISOString();
        await this.saveThreatMemory();
        this.auditLogger.success(`🧬 [Evolution] New ${update.type} pattern learned: ${update.pattern}`);
    } catch (e) {
        this.auditLogger.error('🧬 [Evolution] Failed to distill patterns');
    }
  }

  getRecentAlerts() {
    return this.recentAlerts.slice(-10).reverse();
  }

  /**
   * 🛡️ AgentShield (Static Code Analysis Firewall)
   * Inspired by Everything-Claude-Code. Prevents SOMA from ingesting 
   * or executing poisoned repositories.
   */
  validateCode(codeString) {
      if (!codeString || typeof codeString !== 'string') return { safe: true };

      this.auditLogger.debug(`[AgentShield] Scanning ${codeString.length} bytes of code...`);

      const AGENT_SHIELD_RULES = [
          { name: 'Unsafe Evaluation', pattern: /\beval\s*\(/g, risk: 'Critical' },
          { name: 'Process Injection', pattern: /child_process\.(exec|spawn|fork)\s*\(/g, risk: 'High' },
          { name: 'Obfuscated Hex/B64', pattern: /\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|Buffer\.from/g, risk: 'Medium' },
          { name: 'Destructive FS', pattern: /fs\.(rm|rmdir|unlink|rmSync)\s*\(/g, risk: 'High' },
          { name: 'Stealth Network Exfil', pattern: /http(s)?:\/\/(?!localhost|127\.0\.0\.1|api\.(openai|anthropic|deepseek)\.com)[^\s'"]+/g, risk: 'Medium' },
          { name: 'Env Leakage', pattern: /process\.env/g, risk: 'Medium' }
      ];

      const violations = [];
      let totalRisk = 0;

      for (const rule of AGENT_SHIELD_RULES) {
          const matches = codeString.match(rule.pattern);
          if (matches) {
              violations.push({ rule: rule.name, matches: matches.length, risk: rule.risk });
              totalRisk += rule.risk === 'Critical' ? 1.0 : rule.risk === 'High' ? 0.7 : 0.3;
          }
      }

      if (violations.length > 0) {
          this.auditLogger.warn(`[AgentShield] 🛡️ Code scan blocked. Violations: ${violations.map(v => v.rule).join(', ')}`);
          return { safe: false, violations, score: totalRisk };
      }

      return { safe: true, violations: [], score: 0 };
  }

  /**
   * Analyze a potential threat
   * @param {object} threat - { type, source, content, screenshot? }
   */
  async analyzeThreat(threat) {
      // 🛡️ Pre-Gate: AgentShield Code Scan
      if (threat.type === 'code_ingest' || threat.type === 'code_patch') {
          const shield = this.validateCode(threat.content);
          if (!shield.safe && shield.score > 1.0) {
              return { threat, action: 'BLOCK', confidence: 100, reason: `AgentShield detected critical vulnerabilities: ${shield.violations.map(v => v.rule).join(', ')}` };
          }
      }

    this.auditLogger.info(`🚨 [SecurityCouncil] Convening for threat: ${threat.type} from ${threat.source}`);
    const startTime = Date.now();

    // Store in recent alerts
    this.recentAlerts.push({
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        message: `Security Audit: ${threat.type} from ${threat.source}`,
        severity: 'Critical'
    });
    if (this.recentAlerts.length > 50) this.recentAlerts.shift();

    // 1. FORENSICS PHASE
    const forensics = await this._runForensicsAgent(threat);

    // 2. COUNCIL DEBATE
    const debate = await this._runSecurityDebate(threat, forensics);

    // 3. CISO VERDICT
    const verdict = await this._runCISOAgent(threat, debate);

    // 4. ACTION
    // If verdict is BLOCK, KEVINManager will handle the actual blocking logic
    
    // 🧠 LIMBIC SIGNAL: Broadcast security threat
    if (this.messageBroker && verdict.action === 'BLOCK') {
        this.messageBroker.publish('security_alert', {
            type: threat.type,
            source: threat.source,
            severity: 'High'
        });
    }

    // 🧬 EVOLUTION CHECK
    if (this.recentAlerts.length % 5 === 0) {
        this.evolvePatterns().catch(e => console.error(e));
    }

    return {
        threat,
        timestamp: new Date().toISOString(),
        forensics,
        debate,
        verdict
    };
  }

  // =========================================================================
  // 🕵️ PHASE 1: FORENSICS
  // =========================================================================

  async _runForensicsAgent(threat) {
    this.auditLogger.debug(`[Forensics] Analyzing headers/content...`);

    const headers = Object.fromEntries(Object.entries(threat.headers || {})
      .map(([key, value]) => [String(key).toLowerCase(), String(value)]));
    const authText = String(
      threat.authenticationResults || headers['authentication-results'] || ''
    );
    const authSignals = {
      available: Boolean(authText),
      spf: /\bspf\s*=\s*(pass|fail|softfail|neutral|none|temperror|permerror)\b/i.exec(authText)?.[1]?.toLowerCase() || null,
      dkim: /\bdkim\s*=\s*(pass|fail|neutral|none|temperror|permerror)\b/i.exec(authText)?.[1]?.toLowerCase() || null,
      dmarc: /\bdmarc\s*=\s*(pass|fail|bestguesspass|none|temperror|permerror)\b/i.exec(authText)?.[1]?.toLowerCase() || null
    };

    const content = String(threat.content || '');
    const suppliedUrls = Array.isArray(threat.urls) ? threat.urls : [];
    const extractedUrls = content.match(/https?:\/\/[^\s<>()"']+/gi) || [];
    const urls = [...new Set([...suppliedUrls, ...extractedUrls].map(String))];
    const riskyTlds = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'country', 'gq', 'tk', 'work']);
    const linkFindings = urls.map(raw => {
      try {
        const parsed = new URL(raw);
        const tld = parsed.hostname.split('.').pop()?.toLowerCase() || '';
        const reasons = [];
        if (parsed.protocol !== 'https:') reasons.push('unencrypted_http');
        if (riskyTlds.has(tld)) reasons.push(`risk_tld:${tld}`);
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(parsed.hostname)) reasons.push('ip_literal_host');
        if (parsed.username || parsed.password) reasons.push('embedded_credentials');
        return { url: raw, hostname: parsed.hostname, suspicious: reasons.length > 0, reasons };
      } catch {
        return { url: raw, hostname: null, suspicious: true, reasons: ['invalid_url'] };
      }
    });

    let visionAnalysis = { available: false, reason: threat.screenshot ? 'vision_arbiter_unavailable' : 'no_visual_data' };
    if (threat.screenshot && this.visionArbiter?.analyzeImage) {
      try {
        const result = await this.visionArbiter.analyzeImage(threat.screenshot);
        visionAnalysis = result?.success
          ? { available: true, result }
          : { available: false, reason: result?.error || 'vision_analysis_failed' };
      } catch (error) {
        visionAnalysis = { available: false, reason: error.message };
      }
    }

    return {
      header_analysis: authSignals,
      link_analysis: {
        available: urls.length > 0,
        urls: linkFindings,
        suspiciousCount: linkFindings.filter(link => link.suspicious).length
      },
      vision_analysis: visionAnalysis,
      evidenceComplete: authSignals.available || urls.length > 0 || visionAnalysis.available
    };
  }

  // =========================================================================
  // ⚔️ PHASE 2: DEBATE
  // =========================================================================

  async _runSecurityDebate(threat, forensics) {
    this.auditLogger.debug(`[Debate] Paranoid vs Pragmatist...`);

    // 1. The Paranoid (Thalamus - Security Brain)
    const paranoidArg = await this._generatePersonaResponse('Paranoid', threat, forensics, null);
    
    // 2. The Pragmatist (Prometheus - Strategy Brain)
    const pragmatistArg = await this._generatePersonaResponse('Pragmatist', threat, forensics, paranoidArg);

    return {
        paranoid_case: paranoidArg,
        pragmatist_case: pragmatistArg
    };
  }

  async _generatePersonaResponse(persona, threat, forensics, opponentArg) {
    if (!this.quadBrain) return `${persona}: analysis unavailable because the reasoning provider is offline.`;

    let prompt = "";
    let brainMode = 'security'; // Default to Thalamus

    if (persona === 'Paranoid') {
        prompt = `You are a Paranoid Security Researcher.
        THREAT: ${JSON.stringify(threat)}
        FORENSICS: ${JSON.stringify(forensics)}
        GOAL: Identify the strongest plausible risk supported by the evidence. Label speculation explicitly.
        Do not invent header, link, sender, or visual findings.`;
        brainMode = 'security';
    } else if (persona === 'Pragmatist') {
        prompt = `You are a Pragmatic IT Admin.
        Review the threat and the Paranoid argument: "${opponentArg}".
        GOAL: Is this a False Positive? Is it a user installing a game or a newsletter?
        Don't block legitimate user activity unless 100% sure.`;
        brainMode = 'analytical';
    }

    const result = await this.quadBrain.reason(prompt, brainMode);
    return result.text || result.response;
  }

  // =========================================================================
  // ⚖️ PHASE 3: CISO VERDICT
  // =========================================================================

  async _runCISOAgent(threat, debate) {
    this.auditLogger.debug(`[CISO] Finalizing verdict...`);

    const prompt = `
      You are the CISO (Chief Information Security Officer).
      Review the debate.
      
      PARANOID: ${debate.paranoid_case}
      PRAGMATIST: ${debate.pragmatist_case}
      
      Task:
      1. Issue Verdict: BLOCK, QUARANTINE, ALLOW.
      2. Confidence Score (0-100%).
      3. Reason.
    `;

    let verdict = { text: 'VERDICT: QUARANTINE. Reasoning provider offline; fail closed pending review.', confidence: 0 };
    if (this.quadBrain) {
        const result = await this.quadBrain.reason(prompt, 'balanced');
        verdict = { text: result.text || result.response, confidence: result.confidence };
    }

    const explicit = /\b(?:verdict|action)\s*[:=-]\s*(ALLOW|BLOCK|QUARANTINE)\b/i.exec(String(verdict.text || ''))?.[1]?.toUpperCase();
    const action = explicit || 'QUARANTINE';

    return {
        action,
        confidence: verdict.confidence,
        reason: verdict.text
    };
  }
}

export default SecurityCouncilArbiter;
