import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';

/**
 * FragmentRegistry.js — Domain-Specific Micro-Expert Manager
 *
 * Maintains a library of domain micro-experts, each with:
 *  - A pillar assignment (LOGOS / AURORA / PROMETHEUS / THALAMUS)
 *  - Keywords for query routing
 *  - A system prompt prefix that sharpens the brain's response for that domain
 *
 * Usage:
 *   const match = await registry.routeToFragment(query, 'LOGOS');
 *   if (match) systemPrompt = match.fragment.systemPrompt + '\n\n' + basePrompt;
 *
 *   // Or auto-detect pillar:
 *   const enhancement = await registry.getPromptEnhancement(query);
 *   if (enhancement) systemPrompt = enhancement + '\n\n' + basePrompt;
 */
export class FragmentRegistry extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'FragmentRegistry';
    this.messageBroker = opts.messageBroker;
    this.quadBrain = opts.quadBrain;
    this.fragments = new Map();
    this.pillarFragments = {
      LOGOS: new Map(),
      AURORA: new Map(),
      PROMETHEUS: new Map(),
      THALAMUS: new Map(),
    };
    this.stats = {
      totalFragments: 0,
      activeFragments: 0,
      fragmentQueries: 0,
      fragmentHits: 0,
      fragmentMisses: 0,
    };
    this.config = { minFragmentConfidence: 0.30 };
    this.missCandidates = new Map();
    this.fragmentTemplates = this._defineFragmentTemplates();
  }

  async initialize() {
    console.log(`[${this.name}] Initializing domain micro-expert registry...`);
    const loaded = await this.loadFragments();
    if (loaded.count < 5) {
      await this.spawnInitialFragments();
      await this.saveFragments();
    }
    console.log(`[${this.name}] Registry stable — ${this.stats.totalFragments} experts across 4 pillars.`);
    return true;
  }

  // ── Storage ────────────────────────────────

  async loadFragments() {
    const fragmentsDir = path.join(process.cwd(), '.soma', 'fragments');
    const pillars = ['LOGOS', 'AURORA', 'PROMETHEUS', 'THALAMUS', 'MISC'];
    let fragmentFiles = [];
    for (const pillar of pillars) {
      const pDir = path.join(fragmentsDir, pillar);
      try {
        const files = await fs.readdir(pDir);
        fragmentFiles = fragmentFiles.concat(
          files.filter(f => f.endsWith('.json')).map(f => path.join(pDir, f))
        );
      } catch (e) {}
    }
    for (const filepath of fragmentFiles) {
      try {
        const content = await fs.readFile(filepath, 'utf8');
        const data = JSON.parse(content.replace(/^\uFEFF/, ''));
        const fragment = this._deserializeFragment(data);
        this.fragments.set(fragment.id, fragment);
        if (this.pillarFragments[fragment.pillar]) {
          this.pillarFragments[fragment.pillar].set(fragment.id, fragment);
        }
        this.stats.totalFragments++;
        if (fragment.active) this.stats.activeFragments++;
      } catch (e) {
        await this._quarantineCorruptedFragment(filepath, e);
      }
    }
    return { count: this.stats.totalFragments };
  }

  async _quarantineCorruptedFragment(filepath, error) {
    try {
      const fragmentsDir = path.join(process.cwd(), '.soma', 'fragments');
      const quarantineDir = path.join(fragmentsDir, '_corrupt');
      await fs.mkdir(quarantineDir, { recursive: true });
      const base = path.basename(filepath);
      const target = path.join(quarantineDir, `${Date.now()}_${base}`);
      await fs.rename(filepath, target);
      console.warn(`[${this.name}] Quarantined corrupted fragment: ${filepath} (${error.message})`);
    } catch (moveError) {
      console.warn(`[${this.name}] Corrupted fragment: ${filepath} (${error.message}); quarantine failed: ${moveError.message}`);
    }
  }

  async saveFragments() {
    const fragmentsDir = path.join(process.cwd(), '.soma', 'fragments');
    for (const fragment of this.fragments.values()) {
      try {
        const pillarDir = path.join(fragmentsDir, fragment.pillar || 'MISC');
        await fs.mkdir(pillarDir, { recursive: true });
        const filepath = path.join(pillarDir, `${fragment.id}.json`);
        await fs.writeFile(filepath, JSON.stringify(this._serializeFragment(fragment), null, 2));
      } catch (e) {}
    }
    return { success: true };
  }

  // ── Routing ────────────────────────────────

  /**
   * Route a query to the best matching fragment within a given pillar.
   * Returns { fragment, score } or null.
   */
  async routeToFragment(query, pillar) {
    this.stats.fragmentQueries++;
    const pillarMap = this.pillarFragments[pillar];
    if (!pillarMap) return null;

    const scores = [];
    for (const [, fragment] of pillarMap) {
      if (!fragment.active) continue;
      const score = this._scoreFragmentMatch(query, fragment);
      if (score > this.config.minFragmentConfidence) scores.push({ fragment, score });
    }

    scores.sort((a, b) => b.score - a.score);
    if (scores.length === 0) {
      this.stats.fragmentMisses++;
      return null;
    }
    this.stats.fragmentHits++;
    scores[0].fragment.stats.lastUsed = Date.now();
    scores[0].fragment.stats.queriesHandled++;
    return scores[0];
  }

  /**
   * Auto-detect the best matching fragment across all pillars.
   * Returns the fragment's systemPrompt prefix, or null if nothing matches well.
   *
   * Usage: prepend this to the brain system prompt for domain-specific sharpening.
   */
  async getPromptEnhancement(query) {
    const pillars = ['LOGOS', 'AURORA', 'PROMETHEUS', 'THALAMUS'];
    let best = null;
    let bestScore = 0;

    for (const pillar of pillars) {
      const match = await this.routeToFragment(query, pillar);
      if (match && match.score > bestScore) {
        best = match;
        bestScore = match.score;
      }
    }

    if (!best || bestScore < 0.35) return null;
    return best.fragment.systemPrompt;
  }

  /**
   * Update a fragment only from an externally verified outcome. Model confidence
   * and internal critic scores are observations, not expertise evidence.
   */
  async recordFragmentOutcome(fragmentId, outcome = {}) {
    const fragment = this.fragments.get(String(fragmentId));
    if (!fragment) return { learned: false, reason: 'fragment_not_found', fragmentId };
    const metadata = outcome.metadata || {};
    const status = outcome.outcomeTruthStatus || metadata.outcomeTruthStatus;
    const authoritative = outcome.outcomeTruthAuthoritative === true
      || metadata.outcomeTruthAuthoritative === true
      || outcome.externallyVerified === true
      || metadata.externallyVerified === true;
    if (!authoritative || !['verified_success', 'verified_failure'].includes(String(status || ''))) {
      return { learned: false, reason: 'verified_outcome_required', fragmentId };
    }

    const success = status === 'verified_success';
    const reward = Math.max(-1, Math.min(1, Number(outcome.reward ?? metadata.reward ?? (success ? 1 : -1))));
    fragment.stats ||= {};
    fragment.stats.outcomes = Number(fragment.stats.outcomes || 0) + 1;
    fragment.stats.successes = Number(fragment.stats.successes || 0) + (success ? 1 : 0);
    fragment.stats.failures = Number(fragment.stats.failures || 0) + (success ? 0 : 1);
    fragment.stats.lastOutcomeAt = Date.now();
    fragment.stats.averageReward = (
      (Number(fragment.stats.averageReward || 0) * (fragment.stats.outcomes - 1)) + reward
    ) / fragment.stats.outcomes;
    const delta = success ? 0.02 * Math.max(0.25, reward) : -0.03 * Math.max(0.25, Math.abs(reward));
    fragment.expertiseLevel = Math.max(0.2, Math.min(0.99, Number(fragment.expertiseLevel ?? 0.7) + delta));
    await this.saveFragments();
    const result = { learned: true, fragmentId, success, reward, expertiseLevel: fragment.expertiseLevel };
    this.emit('fragment_outcome_recorded', result);
    return result;
  }

  /**
   * Track repeated misses without spawning an unreviewed expert from one query.
   * The emitted candidate can be reviewed by a governed training coordinator.
   */
  async considerAutoSpawn(query, pillar = 'LOGOS') {
    const keywords = String(query || '').toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) || [];
    const signature = keywords.slice(0, 5).join(':');
    if (!signature) return { proposed: false, reason: 'insufficient_signal' };
    const current = this.missCandidates.get(signature) || { count: 0, firstSeen: Date.now(), pillar, query: String(query).slice(0, 500) };
    current.count += 1;
    current.lastSeen = Date.now();
    this.missCandidates.set(signature, current);
    if (current.count < 3) return { proposed: false, reason: 'more_evidence_required', observations: current.count };
    const proposal = { proposed: true, signature, ...current };
    this.emit('fragment_spawn_candidate', proposal);
    return proposal;
  }

  // ── Scoring ────────────────────────────────

  _scoreFragmentMatch(query, fragment) {
    const q = query.toLowerCase();
    const matchedKeywords = fragment.keywords.filter(kw => q.includes(kw.toLowerCase()));

    let score = (matchedKeywords.length / Math.max(fragment.keywords.length, 1)) * 0.65;
    if (matchedKeywords.length > 0) score += 0.15;

    if (q.includes(fragment.domain.toLowerCase())) score += 0.15;
    if (q.includes(fragment.specialization.toLowerCase())) score += 0.10;

    // Reputation weighting: expert fragments outrank novice ones for the same keyword match.
    // expertiseLevel starts at 0.7 (spawn default) and grows with recordFragmentOutcome().
    // Multiplier range: 0.86 (expertise=0.5) to 1.10 (expertise=1.0) — keeps scores bounded.
    const expertise = fragment.expertiseLevel ?? 0.7;
    const reputationMult = 0.7 + (expertise * 0.4); // 0.7→1.1 range
    return Math.min(1.0, score * reputationMult);
  }

  // ── Fragment Spawning ──────────────────────

  async spawnInitialFragments() {
    for (const [id, template] of this.fragmentTemplates) {
      await this.spawnFragment(id, template);
    }
  }

  async spawnFragment(templateId, template) {
    const id = `${template.pillar}_${templateId}`;
    const fragment = {
      id,
      templateId,
      pillar: template.pillar,
      domain: template.domain,
      specialization: template.specialization,
      keywords: template.keywords,
      systemPrompt: template.systemPrompt,
      temperature: template.temperature,
      stats: { lastUsed: Date.now(), queriesHandled: 0 },
      expertiseLevel: 0.7,
      active: true,
    };
    this.fragments.set(id, fragment);
    if (this.pillarFragments[template.pillar]) {
      this.pillarFragments[template.pillar].set(id, fragment);
    }
    this.stats.totalFragments++;
    this.stats.activeFragments++;
    return fragment;
  }

  // ── Template Definitions ───────────────────

  _defineFragmentTemplates() {
    const t = new Map();

    // ── LOGOS — Logic, Code, Engineering ──────────────────────────────────
    t.set('code_analysis', {
      pillar: 'LOGOS',
      domain: 'software',
      specialization: 'code_analysis',
      keywords: ['code', 'function', 'optimize', 'refactor', 'logic', 'algorithm', 'complexity'],
      systemPrompt: 'You are a senior software engineer performing code review. Prioritize correctness, performance, and maintainability. Cite specific line patterns when relevant. Be terse and direct.',
      temperature: 0.2,
    });
    t.set('debugging', {
      pillar: 'LOGOS',
      domain: 'software',
      specialization: 'debugging',
      keywords: ['bug', 'error', 'crash', 'exception', 'stack trace', 'undefined', 'null', 'fix', 'broken'],
      systemPrompt: 'You are a debugging specialist. Trace errors to root causes — do not guess. Identify the actual failure point, explain why it fails, and provide the minimal change that fixes it.',
      temperature: 0.1,
    });
    t.set('architecture', {
      pillar: 'LOGOS',
      domain: 'software',
      specialization: 'system_architecture',
      keywords: ['architecture', 'design', 'system', 'microservice', 'scalable', 'pattern', 'structure', 'API'],
      systemPrompt: 'You are a systems architect. Reason about trade-offs: coupling vs cohesion, latency vs throughput, simplicity vs flexibility. Justify design decisions with explicit constraints.',
      temperature: 0.3,
    });
    t.set('data_analysis', {
      pillar: 'LOGOS',
      domain: 'data',
      specialization: 'analysis',
      keywords: ['data', 'dataset', 'statistics', 'analyse', 'analyze', 'metric', 'query', 'SQL', 'aggregate', 'trend'],
      systemPrompt: 'You are a data analyst. Identify patterns, outliers, and actionable signals. Distinguish correlation from causation. Suggest the right aggregation or visualization for the question being asked.',
      temperature: 0.2,
    });
    t.set('mathematics', {
      pillar: 'LOGOS',
      domain: 'mathematics',
      specialization: 'formal_reasoning',
      keywords: ['math', 'equation', 'proof', 'formula', 'calculate', 'probability', 'statistics', 'derivative', 'integral'],
      systemPrompt: 'You are a mathematician. Work step-by-step. Show intermediate steps. Flag assumptions. When approximating, state the approximation explicitly.',
      temperature: 0.1,
    });
    t.set('testing', {
      pillar: 'LOGOS',
      domain: 'software',
      specialization: 'testing',
      keywords: ['test', 'unit test', 'integration', 'coverage', 'mock', 'assert', 'jest', 'pytest', 'spec'],
      systemPrompt: 'You are a test engineering specialist. Write tests that catch real bugs, not tests that just pass. Prioritize edge cases, boundary conditions, and failure modes over happy paths.',
      temperature: 0.2,
    });
    t.set('security_technical', {
      pillar: 'LOGOS',
      domain: 'security',
      specialization: 'vulnerability_analysis',
      keywords: ['vulnerability', 'injection', 'XSS', 'CSRF', 'authentication', 'authorization', 'exploit', 'CVE', 'pentest'],
      systemPrompt: 'You are a security engineer performing code and architecture review. Identify OWASP top-10 risks, authentication flaws, and injection vectors. Provide specific remediation steps, not generic advice.',
      temperature: 0.1,
    });

    // ── AURORA — Creative, Emotional, Artistic ─────────────────────────────
    t.set('creative_writing', {
      pillar: 'AURORA',
      domain: 'creative',
      specialization: 'writing',
      keywords: ['write', 'story', 'narrative', 'character', 'plot', 'dialogue', 'creative', 'fiction', 'prose'],
      systemPrompt: 'You are a creative writer with a strong editorial eye. Favor specific over generic, showing over telling, and authentic voice over polished emptiness. Ask: does this sentence earn its place?',
      temperature: 0.8,
    });
    t.set('brainstorming', {
      pillar: 'AURORA',
      domain: 'creative',
      specialization: 'ideation',
      keywords: ['brainstorm', 'ideas', 'concept', 'generate', 'explore', 'possibilities', 'creative', 'imagine', 'what if'],
      systemPrompt: 'You are a creative ideation partner. Generate a wide range of options before filtering. Diverge first — no idea is too wild in the generation phase. Then converge: rank by feasibility and impact.',
      temperature: 0.9,
    });
    t.set('ux_design', {
      pillar: 'AURORA',
      domain: 'design',
      specialization: 'user_experience',
      keywords: ['UX', 'UI', 'user interface', 'design', 'usability', 'interaction', 'wireframe', 'flow', 'accessibility'],
      systemPrompt: 'You are a UX designer. Design for the confused user, not the expert. Identify friction points, cognitive load, and accessibility gaps. Justify decisions with user mental models, not aesthetics.',
      temperature: 0.5,
    });
    t.set('emotional_support', {
      pillar: 'AURORA',
      domain: 'interpersonal',
      specialization: 'empathy',
      keywords: ['feeling', 'emotion', 'stressed', 'anxious', 'sad', 'frustrated', 'overwhelmed', 'support', 'help me'],
      systemPrompt: 'You are a compassionate listener. Acknowledge feelings before problem-solving. Do not rush to fix. Reflect back what you hear. Only offer advice if explicitly asked.',
      temperature: 0.7,
    });
    t.set('communication', {
      pillar: 'AURORA',
      domain: 'communication',
      specialization: 'writing_clarity',
      keywords: ['explain', 'communicate', 'email', 'message', 'presentation', 'clarity', 'simplify', 'document', 'report'],
      systemPrompt: 'You are a communications editor. Strip jargon. Lead with the point. Make the structure visible to the reader. Cut anything that does not add meaning.',
      temperature: 0.5,
    });

    // ── PROMETHEUS — Strategy, Planning, Business ──────────────────────────
    t.set('business_strategy', {
      pillar: 'PROMETHEUS',
      domain: 'business',
      specialization: 'strategy',
      keywords: ['strategy', 'business', 'competitive', 'market', 'revenue', 'growth', 'positioning', 'moat', 'advantage'],
      systemPrompt: 'You are a strategic advisor. Think in second and third-order effects. Identify the key assumption that, if wrong, kills the plan. Focus on leverage points — the small changes with large consequences.',
      temperature: 0.4,
    });
    t.set('project_planning', {
      pillar: 'PROMETHEUS',
      domain: 'project_management',
      specialization: 'planning',
      keywords: ['plan', 'roadmap', 'milestone', 'timeline', 'deadline', 'sprint', 'priority', 'backlog', 'scope'],
      systemPrompt: 'You are a project planner. Break work into concrete, verifiable milestones. Identify dependencies and critical path. Flag scope creep early. Always ask: what is the minimum viable version of this?',
      temperature: 0.3,
    });
    t.set('risk_analysis', {
      pillar: 'PROMETHEUS',
      domain: 'risk',
      specialization: 'assessment',
      keywords: ['risk', 'failure', 'downside', 'worst case', 'mitigation', 'contingency', 'probability', 'impact', 'hedge'],
      systemPrompt: 'You are a risk analyst applying pre-mortem thinking. Assume the plan fails — why? Identify the 3 most likely failure modes and 1 catastrophic black swan. Recommend proportionate mitigations.',
      temperature: 0.3,
    });
    t.set('product_thinking', {
      pillar: 'PROMETHEUS',
      domain: 'product',
      specialization: 'product_management',
      keywords: ['product', 'feature', 'user need', 'requirement', 'MVP', 'iteration', 'feedback', 'launch', 'adoption'],
      systemPrompt: 'You are a product manager. Anchor every decision to a specific user problem. Distinguish between what users ask for and what they actually need. Evaluate features by impact / effort and strategic fit.',
      temperature: 0.4,
    });
    t.set('financial_analysis', {
      pillar: 'PROMETHEUS',
      domain: 'finance',
      specialization: 'analysis',
      keywords: ['finance', 'budget', 'cost', 'ROI', 'profit', 'loss', 'investment', 'valuation', 'forecast', 'cash flow'],
      systemPrompt: 'You are a financial analyst. Work with numbers precisely — avoid hand-waving about "roughly" or "approximately" without bounds. Identify the key driver behind any financial outcome.',
      temperature: 0.2,
    });

    // ── THALAMUS — Safety, Ethics, Policy ─────────────────────────────────
    t.set('content_safety', {
      pillar: 'THALAMUS',
      domain: 'safety',
      specialization: 'content_moderation',
      keywords: ['safety', 'harmful', 'dangerous', 'moderation', 'policy', 'allowed', 'prohibited', 'guidelines'],
      systemPrompt: 'You are a content safety reviewer. Apply policy consistently regardless of framing. Flag the specific harm vector — not just that something "seems problematic". Distinguish between discussing a topic and enabling harm.',
      temperature: 0.0,
    });
    t.set('ethics', {
      pillar: 'THALAMUS',
      domain: 'ethics',
      specialization: 'ethical_reasoning',
      keywords: ['ethical', 'moral', 'right', 'wrong', 'fairness', 'bias', 'discrimination', 'consent', 'autonomy'],
      systemPrompt: 'You are an applied ethicist. Identify the stakeholders, their interests, and where those interests conflict. Apply multiple frameworks (consequentialist, deontological, virtue) and flag where they disagree. Avoid false consensus.',
      temperature: 0.3,
    });
    t.set('privacy', {
      pillar: 'THALAMUS',
      domain: 'privacy',
      specialization: 'data_protection',
      keywords: ['privacy', 'PII', 'GDPR', 'data protection', 'consent', 'tracking', 'surveillance', 'personal data'],
      systemPrompt: 'You are a privacy engineer. Apply data minimization as the default — justify every data collection point. Flag retention risks, consent gaps, and cross-context information flows.',
      temperature: 0.1,
    });
    t.set('compliance', {
      pillar: 'THALAMUS',
      domain: 'legal',
      specialization: 'compliance',
      keywords: ['legal', 'compliance', 'regulation', 'law', 'GDPR', 'HIPAA', 'SOC2', 'audit', 'policy', 'liability'],
      systemPrompt: 'You are a compliance advisor. Identify the specific regulation or standard at issue. Distinguish between what is legally required, what is best practice, and what is merely conventional. Flag gaps clearly.',
      temperature: 0.1,
    });

    return t;
  }

  // ── Serialization ──────────────────────────

    listFragments() {
    return Array.from(this.fragments.values());
  }

_serializeFragment(f) {
    const { ...rest } = f;
    return rest;
  }

  _deserializeFragment(d) {
    return { ...d };
  }
}

export default FragmentRegistry;
