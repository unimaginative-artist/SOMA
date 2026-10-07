// ═══════════════════════════════════════════════════════════
// FILE: arbiters/SkillAcquisitionArbiter.cjs
// Skill detection, proficiency tracking, and certification system
// Enables autonomous skill development and mastery tracking
// ═══════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const crypto = require('crypto');

class SkillAcquisitionArbiter extends BaseArbiter {
  static role = 'skill-acquisition';
  static capabilities = ['detect-skills', 'track-proficiency', 'schedule-practice', 'certify-mastery'];

  constructor(config = {}) {
    super(config);

    // Skill storage
    this.skills = new Map(); // skillId -> Skill object
    this.activeSkills = new Set(); // Skills currently being practiced
    this.certifiedSkills = new Set(); // Skills that achieved certification
    this.skillsByDomain = new Map(); // domain -> Set<skillId>
    this.skillsByCategory = new Map(); // category -> Set<skillId>

    // Practice scheduling
    this.practiceQueue = []; // Queue of skills needing practice
    this.activePracticeSessions = new Map(); // sessionId -> session data

    // Configuration
    this.maxActiveSkills = config.maxActiveSkills || 50;
    this.maxCertifiedHistory = config.maxCertifiedHistory || 200;
    this.certificationThreshold = config.certificationThreshold || 0.85; // 85% proficiency
    this.practiceInterval = config.practiceInterval || 3600000; // 1 hour
    this.proficiencyDecayRate = config.proficiencyDecayRate || 0.01; // 1% per week

    // Proficiency levels
    this.proficiencyLevels = {
      NOVICE: { min: 0.0, max: 0.3, label: 'Novice' },
      BEGINNER: { min: 0.3, max: 0.5, label: 'Beginner' },
      INTERMEDIATE: { min: 0.5, max: 0.7, label: 'Intermediate' },
      ADVANCED: { min: 0.7, max: 0.9, label: 'Advanced' },
      EXPERT: { min: 0.9, max: 1.0, label: 'Expert' }
    };

    // Spaced repetition algorithm parameters
    this.spacedRepetition = {
      easeFactor: 2.5,
      minEaseFactor: 1.3,
      easeBonus: 0.15,
      easePenalty: 0.2,
      intervals: [1, 6, 24, 72, 168] // hours: 1h, 6h, 1d, 3d, 7d
    };

    // Statistics
    this.stats = {
      skillsDetected: 0,
      skillsCertified: 0,
      totalPracticeSessions: 0,
      avgProficiency: 0.0,
      skillsPerDomain: {},
      certificationsPerWeek: 0,
      practiceTimeTotal: 0
    };

    // Monitoring intervals
    this.practiceScheduler = null;
    this.proficiencyDecayMonitor = null;

    this.logger.info(`[${this.name}] 🎓 SkillAcquisitionArbiter initializing...`);
    this.logger.info(`[${this.name}] Certification threshold: ${(this.certificationThreshold * 100).toFixed(0)}%`);
    this.logger.info(`[${this.name}] Max active skills: ${this.maxActiveSkills}`);
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ INITIALIZATION ░░
  // ═══════════════════════════════════════════════════════════

  async initialize() {
    await super.initialize();

    this.registerWithBroker();
    this._subscribeBrokerMessages();

    // Start practice scheduling loop
    this.startPracticeScheduler();

    // Start proficiency decay monitoring
    this.startProficiencyDecay();

    this.logger.info(`[${this.name}] ✅ Skill acquisition system active`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, {
        type: SkillAcquisitionArbiter.role,
        capabilities: SkillAcquisitionArbiter.capabilities
      });
      this.logger.info(`[${this.name}] Registered with MessageBroker`);
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to register: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    // Skill detection
    messageBroker.subscribe(this.name, 'learning_event');
    messageBroker.subscribe(this.name, 'knowledge_acquired');
    messageBroker.subscribe(this.name, 'pattern_detected');

    // Skill management
    messageBroker.subscribe(this.name, 'skill_detected');
    messageBroker.subscribe(this.name, 'practice_complete');
    messageBroker.subscribe(this.name, 'skill_query');
    messageBroker.subscribe(this.name, 'proficiency_update');
    messageBroker.subscribe(this.name, 'certification_request');

    // System events
    messageBroker.subscribe(this.name, 'time_pulse');
    messageBroker.subscribe(this.name, 'practice_trigger');

    this.logger.info(`[${this.name}] Subscribed to message types`);
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload, from } = message;

      switch (type) {
        case 'learning_event':
          return await this.handleLearningEvent(payload);

        case 'knowledge_acquired':
          return await this.detectSkillFromKnowledge(payload);

        case 'pattern_detected':
          return await this.detectSkillFromPattern(payload);

        case 'skill_detected':
          return await this.registerSkill(payload);

        case 'practice_complete':
          return await this.recordPracticeSession(payload);

        case 'skill_query':
          return this.querySkills(payload);

        case 'proficiency_update':
          return await this.updateProficiency(payload.skillId, payload.proficiency, payload.reason);

        case 'certification_request':
          return await this.attemptCertification(payload.skillId);

        case 'time_pulse':
          return await this.handleTimePulse(payload);

        case 'practice_trigger':
          return await this.schedulePracticeSession(payload);

        default:
          return { success: true, message: 'Event acknowledged' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ SKILL DETECTION ░░
  // ═══════════════════════════════════════════════════════════

  async handleLearningEvent(payload) {
    const { eventType, content, metadata } = payload;

    // Detect skills from learning events
    const detectedSkills = await this.extractSkills(content, metadata);

    for (const skillData of detectedSkills) {
      await this.registerSkill(skillData);
    }

    return {
      success: true,
      skillsDetected: detectedSkills.length
    };
  }

  async extractSkills(content, metadata = {}) {
    const skills = [];

    // Pattern 1: Code patterns (e.g., "async/await", "promises", "map/reduce")
    const codePatterns = [
      { pattern: /async.*await/gi, skill: 'JavaScript Async/Await', domain: 'programming', category: 'language-feature' },
      { pattern: /promise.*then.*catch/gi, skill: 'JavaScript Promises', domain: 'programming', category: 'language-feature' },
      { pattern: /\.map\(|\.filter\(|\.reduce\(/gi, skill: 'Array Methods', domain: 'programming', category: 'language-feature' },
      { pattern: /import.*from|export.*{/gi, skill: 'ES6 Modules', domain: 'programming', category: 'language-feature' },
      { pattern: /class.*extends|constructor\(/gi, skill: 'Object-Oriented Programming', domain: 'programming', category: 'paradigm' }
    ];

    // Pattern 2: Framework/library patterns
    const frameworkPatterns = [
      { pattern: /express\(|app\.get\(|app\.post\(/gi, skill: 'Express.js', domain: 'web-development', category: 'framework' },
      { pattern: /React\.|useState\(|useEffect\(/gi, skill: 'React Hooks', domain: 'web-development', category: 'framework' },
      { pattern: /SELECT.*FROM|INSERT INTO|UPDATE.*SET/gi, skill: 'SQL Queries', domain: 'database', category: 'query-language' }
    ];

    // Pattern 3: Architectural patterns
    const architecturalPatterns = [
      { pattern: /middleware|next\(\)/gi, skill: 'Middleware Pattern', domain: 'architecture', category: 'design-pattern' },
      { pattern: /singleton|factory|observer/gi, skill: 'Design Patterns', domain: 'architecture', category: 'design-pattern' },
      { pattern: /websocket|socket\.io/gi, skill: 'Real-time Communication', domain: 'networking', category: 'protocol' }
    ];

    const allPatterns = [...codePatterns, ...frameworkPatterns, ...architecturalPatterns];

    for (const { pattern, skill, domain, category } of allPatterns) {
      if (pattern.test(content)) {
        skills.push({
          name: skill,
          domain,
          category,
          detectedFrom: 'pattern_matching',
          initialProficiency: 0.1, // Novice level
          metadata: { ...metadata, detectionPattern: pattern.source }
        });
      }
    }

    return skills;
  }

  async detectSkillFromKnowledge(payload) {
    const { knowledge, domain, confidence } = payload;

    // Higher confidence knowledge indicates skill acquisition
    if (confidence && confidence > 0.7) {
      const skillData = {
        name: knowledge.title || knowledge.concept || 'Unnamed Skill',
        domain: domain || 'general',
        category: knowledge.category || 'knowledge',
        detectedFrom: 'knowledge_acquisition',
        initialProficiency: confidence * 0.3, // Scale to novice-beginner range
        metadata: { confidence, source: 'knowledge_system' }
      };

      return await this.registerSkill(skillData);
    }

    return { success: true, skillDetected: false };
  }

  async detectSkillFromPattern(payload) {
    const { pattern, domain, occurrences } = payload;

    // Repeated patterns indicate developing skill
    if (occurrences && occurrences > 3) {
      const skillData = {
        name: pattern.name || 'Pattern-based Skill',
        domain: domain || 'general',
        category: 'pattern',
        detectedFrom: 'pattern_detection',
        initialProficiency: Math.min(0.3, occurrences * 0.05), // More occurrences = higher initial proficiency
        metadata: { pattern, occurrences }
      };

      return await this.registerSkill(skillData);
    }

    return { success: true, skillDetected: false };
  }

  async registerSkill(skillData) {
    const { name, domain, category, initialProficiency, metadata } = skillData;

    // Check if skill already exists
    const existing = this._findSkillByName(name);
    if (existing) {
      // Update proficiency if detection suggests higher level
      if (initialProficiency && initialProficiency > existing.proficiency) {
        await this.updateProficiency(existing.id, initialProficiency, 'skill_redetected');
      }
      return { success: true, skillId: existing.id, existing: true };
    }

    // Create new skill
    const skillId = `skill_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`;
    const skill = {
      id: skillId,
      name,
      domain: domain || 'general',
      category: category || 'uncategorized',
      proficiency: initialProficiency || 0.1,
      proficiencyLevel: this._getProficiencyLevel(initialProficiency || 0.1),
      detectedAt: Date.now(),
      lastPracticed: null,
      lastReviewed: Date.now(),
      practiceCount: 0,
      certified: false,
      certificationDate: null,
      certificationLevel: null,
      easeFactor: this.spacedRepetition.easeFactor,
      nextPractice: Date.now() + this.spacedRepetition.intervals[0] * 3600000, // 1 hour
      relatedSkills: [],
      metadata: metadata || {}
    };

    this.skills.set(skillId, skill);
    this.activeSkills.add(skillId);

    // Index by domain
    if (!this.skillsByDomain.has(domain)) {
      this.skillsByDomain.set(domain, new Set());
    }
    this.skillsByDomain.get(domain).add(skillId);

    // Index by category
    if (!this.skillsByCategory.has(category)) {
      this.skillsByCategory.set(category, new Set());
    }
    this.skillsByCategory.get(category).add(skillId);

    // Update stats
    this.stats.skillsDetected++;
    this.stats.skillsPerDomain[domain] = (this.stats.skillsPerDomain[domain] || 0) + 1;

    this.logger.info(`[${this.name}] 🎓 New skill detected: "${name}" (${domain}/${category})`);
    this.logger.info(`[${this.name}]    Proficiency: ${(skill.proficiency * 100).toFixed(1)}% (${skill.proficiencyLevel})`);

    // Publish skill detection event
    messageBroker.publish({
      type: 'skill_registered',
      payload: { skill },
      from: this.name
    });

    return { success: true, skillId, skill, existing: false };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PROFICIENCY TRACKING ░░
  // ═══════════════════════════════════════════════════════════

  async updateProficiency(skillId, newProficiency, reason = 'manual_update') {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }

    const oldProficiency = skill.proficiency;
    const oldLevel = skill.proficiencyLevel;

    // Clamp proficiency to [0, 1]
    skill.proficiency = Math.max(0, Math.min(1, newProficiency));
    skill.proficiencyLevel = this._getProficiencyLevel(skill.proficiency);
    skill.lastReviewed = Date.now();

    // Check for level up
    const levelChanged = oldLevel !== skill.proficiencyLevel;
    if (levelChanged) {
      this.logger.info(`[${this.name}] 📈 "${skill.name}" leveled up: ${oldLevel} → ${skill.proficiencyLevel}`);

      // Publish level up event
      messageBroker.publish({
        type: 'skill_level_up',
        payload: {
          skillId,
          skillName: skill.name,
          oldLevel,
          newLevel: skill.proficiencyLevel,
          proficiency: skill.proficiency
        },
        from: this.name
      });
    }

    // Check for certification eligibility
    if (skill.proficiency >= this.certificationThreshold && !skill.certified) {
      this.logger.info(`[${this.name}] 🏆 "${skill.name}" is now eligible for certification!`);
      await this.attemptCertification(skillId);
    }

    // Update average proficiency stat
    this._updateAverageProficiency();

    return {
      success: true,
      skillId,
      oldProficiency,
      newProficiency: skill.proficiency,
      levelChanged,
      proficiencyLevel: skill.proficiencyLevel
    };
  }

  async recordPracticeSession(payload) {
    const { skillId, duration, performance, feedback } = payload;

    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }

    skill.practiceCount++;
    skill.lastPracticed = Date.now();
    this.stats.totalPracticeSessions++;
    this.stats.practiceTimeTotal += duration || 0;

    // Calculate proficiency gain based on performance
    const performanceScore = performance || 0.5; // 0-1 scale
    const proficiencyGain = this._calculateProficiencyGain(skill, performanceScore);

    const newProficiency = Math.min(1.0, skill.proficiency + proficiencyGain);
    await this.updateProficiency(skillId, newProficiency, 'practice_session');

    // Update spaced repetition parameters
    this._updateSpacedRepetition(skill, performanceScore);

    // Schedule next practice
    skill.nextPractice = Date.now() + this._calculateNextInterval(skill) * 3600000;

    this.logger.info(`[${this.name}] ✅ Practice session complete: "${skill.name}"`);
    this.logger.info(`[${this.name}]    Performance: ${(performanceScore * 100).toFixed(0)}%, Gain: +${(proficiencyGain * 100).toFixed(1)}%`);
    this.logger.info(`[${this.name}]    Next practice: ${new Date(skill.nextPractice).toLocaleString()}`);

    return {
      success: true,
      skillId,
      proficiencyGain,
      newProficiency: skill.proficiency,
      nextPractice: skill.nextPractice
    };
  }

  _calculateProficiencyGain(skill, performanceScore) {
    // Higher performance = more gain
    // Lower proficiency = easier to gain (diminishing returns)
    const baseGain = 0.05; // 5% base gain
    const performanceMultiplier = performanceScore * 1.5; // 0-150%
    const difficultyMultiplier = 1 - (skill.proficiency * 0.5); // Harder to improve at higher levels

    return baseGain * performanceMultiplier * difficultyMultiplier;
  }

  _updateSpacedRepetition(skill, performanceScore) {
    // Update ease factor based on performance
    if (performanceScore >= 0.7) {
      // Good performance - increase ease (space out more)
      skill.easeFactor = Math.min(3.0, skill.easeFactor + this.spacedRepetition.easeBonus);
    } else if (performanceScore < 0.5) {
      // Poor performance - decrease ease (practice more frequently)
      skill.easeFactor = Math.max(
        this.spacedRepetition.minEaseFactor,
        skill.easeFactor - this.spacedRepetition.easePenalty
      );
    }
  }

  _calculateNextInterval(skill) {
    // Spaced repetition: intervals grow with ease factor
    const baseInterval = this.spacedRepetition.intervals[
      Math.min(skill.practiceCount, this.spacedRepetition.intervals.length - 1)
    ];

    return baseInterval * skill.easeFactor;
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ CERTIFICATION ░░
  // ═══════════════════════════════════════════════════════════

  async attemptCertification(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }

    if (skill.certified) {
      return { success: false, error: 'Already certified' };
    }

    // Check certification requirements
    const eligible = skill.proficiency >= this.certificationThreshold;
    const minPractice = skill.practiceCount >= 5;

    if (!eligible) {
      return {
        success: false,
        error: 'Proficiency below certification threshold',
        required: this.certificationThreshold,
        current: skill.proficiency
      };
    }

    if (!minPractice) {
      return {
        success: false,
        error: 'Minimum practice sessions not met',
        required: 5,
        current: skill.practiceCount
      };
    }

    // Award certification
    skill.certified = true;
    skill.certificationDate = Date.now();
    skill.certificationLevel = skill.proficiencyLevel;

    this.certifiedSkills.add(skillId);
    this.activeSkills.delete(skillId);

    this.stats.skillsCertified++;

    this.logger.info(`[${this.name}] 🏆 CERTIFICATION AWARDED: "${skill.name}"`);
    this.logger.info(`[${this.name}]    Level: ${skill.certificationLevel}`);
    this.logger.info(`[${this.name}]    Proficiency: ${(skill.proficiency * 100).toFixed(1)}%`);
    this.logger.info(`[${this.name}]    Practice sessions: ${skill.practiceCount}`);

    // Publish certification event
    messageBroker.publish({
      type: 'skill_certified',
      payload: {
        skillId,
        skillName: skill.name,
        domain: skill.domain,
        category: skill.category,
        proficiency: skill.proficiency,
        certificationLevel: skill.certificationLevel,
        practiceCount: skill.practiceCount,
        certificationDate: skill.certificationDate
      },
      from: this.name
    });

    return {
      success: true,
      skillId,
      certified: true,
      certificationLevel: skill.certificationLevel
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PRACTICE SCHEDULING ░░
  // ═══════════════════════════════════════════════════════════

  startPracticeScheduler() {
    this.practiceScheduler = setInterval(() => {
      this.schedulePracticeSessions();
    }, this.practiceInterval);

    this.logger.info(`[${this.name}] Practice scheduler started (${this.practiceInterval / 1000}s interval)`);
  }

  async schedulePracticeSessions() {
    const now = Date.now();
    const skillsNeedingPractice = [];

    // Find skills due for practice
    for (const [skillId, skill] of this.skills) {
      if (!skill.certified && now >= skill.nextPractice) {
        skillsNeedingPractice.push({ skillId, skill });
      }
    }

    if (skillsNeedingPractice.length === 0) {
      return;
    }

    // Sort by proficiency (weakest skills first) and next practice time
    skillsNeedingPractice.sort((a, b) => {
      if (a.skill.proficiency !== b.skill.proficiency) {
        return a.skill.proficiency - b.skill.proficiency; // Lower proficiency first
      }
      return a.skill.nextPractice - b.skill.nextPractice; // Earlier practice time first
    });

    // Schedule practice for top skills
    const toSchedule = skillsNeedingPractice.slice(0, 5); // Max 5 at a time

    for (const { skillId, skill } of toSchedule) {
      this.logger.info(`[${this.name}] 📚 Scheduling practice: "${skill.name}" (proficiency: ${(skill.proficiency * 100).toFixed(1)}%)`);

      // Publish practice reminder
      messageBroker.publish({
        type: 'practice_reminder',
        payload: {
          skillId,
          skillName: skill.name,
          proficiency: skill.proficiency,
          proficiencyLevel: skill.proficiencyLevel,
          lastPracticed: skill.lastPracticed,
          practiceCount: skill.practiceCount
        },
        from: this.name
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ PROFICIENCY DECAY ░░
  // ═══════════════════════════════════════════════════════════

  startProficiencyDecay() {
    // Check for proficiency decay weekly
    this.proficiencyDecayMonitor = setInterval(() => {
      this.applyProficiencyDecay();
    }, 604800000); // 7 days

    this.logger.info(`[${this.name}] Proficiency decay monitor started (weekly checks)`);
  }

  async applyProficiencyDecay() {
    const now = Date.now();
    const weekInMs = 604800000; // 7 days
    let decayedCount = 0;
    const degradedSkills = []; // Track significant degradations

    for (const [skillId, skill] of this.skills) {
      if (skill.certified) continue; // Certified skills don't decay

      const timeSinceLastPractice = now - (skill.lastPracticed || skill.detectedAt);
      const weeksSincePractice = timeSinceLastPractice / weekInMs;

      if (weeksSincePractice >= 1) {
        const decay = this.proficiencyDecayRate * weeksSincePractice;
        const oldProficiency = skill.proficiency;
        const newProficiency = Math.max(0.1, skill.proficiency - decay);

        if (newProficiency < skill.proficiency) {
          await this.updateProficiency(skillId, newProficiency, 'proficiency_decay');
          decayedCount++;

          // Track significant degradations (>20% drop or crossed threshold)
          const degradation = oldProficiency - newProficiency;
          const crossedThreshold = oldProficiency >= 0.5 && newProficiency < 0.5; // Dropped below intermediate

          if (degradation > 0.2 || crossedThreshold) {
            degradedSkills.push({
              skillId,
              skill,
              oldProficiency,
              newProficiency,
              degradation
            });
          }
        }
      }
    }

    if (decayedCount > 0) {
      this.logger.info(`[${this.name}] ⏱️  Applied proficiency decay to ${decayedCount} skills`);
    }

    // Notify GoalPlanner about significant skill degradations
    if (degradedSkills.length > 0) {
      this.logger.warn(`[${this.name}] ⚠️  ${degradedSkills.length} skills significantly degraded!`);

      for (const { skillId, skill, oldProficiency, newProficiency, degradation } of degradedSkills) {
        messageBroker.publish({
          type: 'skill_degraded',
          payload: {
            skillId,
            skillName: skill.name,
            domain: skill.domain,
            category: skill.category,
            oldProficiency,
            newProficiency,
            degradation,
            proficiencyLevel: skill.proficiencyLevel,
            weeksSinceLastPractice: (Date.now() - (skill.lastPracticed || skill.detectedAt)) / 604800000
          },
          from: this.name
        });

        this.logger.warn(`[${this.name}]    📉 "${skill.name}": ${(oldProficiency * 100).toFixed(0)}% → ${(newProficiency * 100).toFixed(0)}%`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ QUERIES & REPORTING ░░
  // ═══════════════════════════════════════════════════════════

  querySkills(filters = {}) {
    const { domain, category, minProficiency, maxProficiency, certified, search } = filters;

    let results = Array.from(this.skills.values());

    // Apply filters
    if (domain) {
      results = results.filter(s => s.domain === domain);
    }
    if (category) {
      results = results.filter(s => s.category === category);
    }
    if (minProficiency !== undefined) {
      results = results.filter(s => s.proficiency >= minProficiency);
    }
    if (maxProficiency !== undefined) {
      results = results.filter(s => s.proficiency <= maxProficiency);
    }
    if (certified !== undefined) {
      results = results.filter(s => s.certified === certified);
    }
    if (search) {
      const searchLower = search.toLowerCase();
      results = results.filter(s => s.name.toLowerCase().includes(searchLower));
    }

    return {
      success: true,
      skills: results,
      count: results.length
    };
  }

  getSkillById(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }
    return { success: true, skill };
  }

  getStats() {
    return {
      ...this.stats,
      totalSkills: this.skills.size,
      activeSkills: this.activeSkills.size,
      certifiedSkills: this.certifiedSkills.size,
      domains: this.skillsByDomain.size,
      categories: this.skillsByCategory.size
    };
  }

  // ═══════════════════════════════════════════════════════════
  // ░░ HELPER METHODS ░░
  // ═══════════════════════════════════════════════════════════

  _findSkillByName(name) {
    for (const skill of this.skills.values()) {
      if (skill.name.toLowerCase() === name.toLowerCase()) {
        return skill;
      }
    }
    return null;
  }

  _getProficiencyLevel(proficiency) {
    for (const [level, range] of Object.entries(this.proficiencyLevels)) {
      if (proficiency >= range.min && proficiency < range.max) {
        return range.label;
      }
    }
    return this.proficiencyLevels.EXPERT.label; // 1.0 exactly
  }

  _updateAverageProficiency() {
    if (this.skills.size === 0) {
      this.stats.avgProficiency = 0;
      return;
    }

    const total = Array.from(this.skills.values())
      .reduce((sum, skill) => sum + skill.proficiency, 0);
    this.stats.avgProficiency = total / this.skills.size;
  }

  async handleTimePulse(payload) {
    // Periodic maintenance tasks
    this._updateAverageProficiency();
    return { success: true };
  }

  async shutdown() {
    if (this.practiceScheduler) {
      clearInterval(this.practiceScheduler);
    }
    if (this.proficiencyDecayMonitor) {
      clearInterval(this.proficiencyDecayMonitor);
    }

    this.logger.info(`[${this.name}] Shutting down...`);
    await super.shutdown();
  }
}

module.exports = SkillAcquisitionArbiter;
