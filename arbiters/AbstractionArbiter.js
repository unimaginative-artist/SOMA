/**
 * AbstractionArbiter.js
 *
 * Extracts abstract patterns that transfer across domains.
 * This is what makes SOMA truly "general" - knowledge from coding transfers to music,
 * insights from games transfer to problem-solving, etc.
 *
 * Key Capabilities:
 * - Cross-domain pattern recognition
 * - Analogical reasoning
 * - Zero-shot learning in new domains
 * - Meta-pattern extraction (patterns of patterns)
 * - Concept mapping between disparate fields
 *
 * Example: "Recursion" in programming = "Self-reference" in art = "Fractal" in nature
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

export class AbstractionArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'AbstractionArbiter';
    this.messageBroker = config.messageBroker || null;

    this.config = {
      minSimilarity: 0.65,          // Min similarity to consider patterns related
      abstractionLevels: 5,         // Max levels of abstraction
      minExamplesPerPattern: 3,     // Min examples before generalizing
      transferThreshold: 0.7,       // Confidence needed to transfer knowledge
      maxAbstractions: 5000,        // Max abstract patterns to store
      ...config
    };

    // Abstract patterns: Map of pattern ID → { structure, domains, examples, level }
    this.abstractPatterns = new Map();

    // Domain knowledge: Map of domain → patterns seen
    this.domainKnowledge = new Map();

    // Analogies: Map of (domainA, domainB) → analogical mappings
    this.analogies = new Map();

    // Meta-patterns: Higher-order patterns (patterns of patterns)
    this.metaPatterns = new Map();

    // Statistics
    this.stats = {
      patternsExtracted: 0,
      domainsExplored: 0,
      analogiesDiscovered: 0,
      successfulTransfers: 0,
      zeroShotSuccesses: 0
    };

    console.log('🧩 [AbstractionArbiter] Initialized');
  }

  /**
   * Initialize the arbiter
   */
  async initialize({ causalityArbiter, worldModel, metaLearning } = {}) {
    this.causalityArbiter = causalityArbiter;
    this.worldModel = worldModel;
    this.metaLearning = metaLearning;

    // Load existing abstractions
    await this.loadAbstractions();

    console.log('✅ [AbstractionArbiter] Ready');
    console.log(`   🧩 Abstract patterns: ${this.abstractPatterns.size}`);
    console.log(`   🌐 Domains: ${this.domainKnowledge.size}`);
    console.log(`   🔗 Analogies: ${this.analogies.size}`);

    return true;
  }

  /**
   * Extract abstract pattern from domain-specific examples
   * @param {Array} examples - Examples from a specific domain
   * @param {string} domain - Domain name
   * @returns {Object} - Abstract pattern
   */
  extractAbstractPattern(examples, domain) {
    if (examples.length < this.config.minExamplesPerPattern) {
      return null;
    }

    this.stats.patternsExtracted++;

    // Find common structure across examples
    const structure = this.findCommonStructure(examples);

    // Determine abstraction level
    const level = this.calculateAbstractionLevel(structure);

    // Create pattern
    const pattern = {
      id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      structure,
      domain,
      examples: examples.slice(0, 10), // Store up to 10 examples
      level,
      createdAt: Date.now(),
      usageCount: 0
    };

    this.abstractPatterns.set(pattern.id, pattern);

    // Track domain knowledge
    if (!this.domainKnowledge.has(domain)) {
      this.domainKnowledge.set(domain, new Set());
      this.stats.domainsExplored++;
    }
    this.domainKnowledge.get(domain).add(pattern.id);

    // Check for cross-domain analogies
    this.discoverAnalogies(pattern);

    console.log(`🧩 [Abstraction] Extracted pattern in "${domain}": ${structure.name || 'unnamed'} (level ${level})`);

    return pattern;
  }

  /**
   * Find common structure across examples
   */
  findCommonStructure(examples) {
    // Simplified structural analysis
    // In a real implementation, this would use more sophisticated pattern matching

    const structures = examples.map(ex => this.analyzeStructure(ex));

    // Find most common structural elements
    const elementFrequency = new Map();

    for (const struct of structures) {
      for (const element of struct.elements || []) {
        const key = JSON.stringify(element);
        elementFrequency.set(key, (elementFrequency.get(key) || 0) + 1);
      }
    }

    // Extract elements that appear in majority of examples
    const threshold = examples.length * 0.6;
    const commonElements = [];

    for (const [key, freq] of elementFrequency.entries()) {
      if (freq >= threshold) {
        commonElements.push(JSON.parse(key));
      }
    }

    // Detect pattern type
    const patternType = this.detectPatternType(commonElements);

    return {
      name: patternType.name,
      type: patternType.type,
      elements: commonElements,
      properties: patternType.properties
    };
  }

  /**
   * Analyze structure of a single example
   */
  analyzeStructure(example) {
    const elements = [];
    const properties = {};

    // Extract structural features
    if (typeof example === 'object') {
      // Count nesting depth
      properties.depth = this.getDepth(example);

      // Identify recursive structures
      properties.recursive = this.hasRecursion(example);

      // Count elements
      properties.size = JSON.stringify(example).length;

      // Extract key relationships
      elements.push(...this.extractRelationships(example));
    }

    return { elements, properties };
  }

  /**
   * Detect pattern type (e.g., recursion, iteration, branching)
   */
  detectPatternType(elements) {
    // Check for recursion pattern
    if (elements.some(e => e.type === 'self-reference' || e.type === 'recursive-call')) {
      return {
        name: 'Recursion',
        type: 'recursive',
        properties: { selfReferential: true }
      };
    }

    // Check for iteration pattern
    if (elements.some(e => e.type === 'loop' || e.type === 'repeat')) {
      return {
        name: 'Iteration',
        type: 'iterative',
        properties: { repetitive: true }
      };
    }

    // Check for branching pattern
    if (elements.some(e => e.type === 'conditional' || e.type === 'branch')) {
      return {
        name: 'Branching',
        type: 'conditional',
        properties: { decisionBased: true }
      };
    }

    // Check for composition pattern
    if (elements.some(e => e.type === 'composite' || e.type === 'nested')) {
      return {
        name: 'Composition',
        type: 'hierarchical',
        properties: { layered: true }
      };
    }

    return {
      name: 'Unknown',
      type: 'generic',
      properties: {}
    };
  }

  /**
   * Calculate abstraction level (0 = concrete, 5 = most abstract)
   */
  calculateAbstractionLevel(structure) {
    let level = 0;

    // More general types are higher level
    if (structure.type === 'generic') level = 0;
    if (structure.type === 'conditional') level = 1;
    if (structure.type === 'iterative') level = 2;
    if (structure.type === 'recursive') level = 3;
    if (structure.type === 'hierarchical') level = 3;

    // Meta-patterns are highest level
    if (structure.name.includes('Meta') || structure.name.includes('Pattern of')) {
      level = 4;
    }

    return Math.min(level, this.config.abstractionLevels - 1);
  }

  /**
   * Discover analogies between domains
   */
  discoverAnalogies(newPattern) {
    // Compare new pattern to patterns in other domains
    for (const [patternId, existingPattern] of this.abstractPatterns.entries()) {
      if (existingPattern.domain === newPattern.domain) continue;
      if (existingPattern.id === newPattern.id) continue;

      // Check structural similarity
      const similarity = this.calculateSimilarity(
        newPattern.structure,
        existingPattern.structure
      );

      if (similarity >= this.config.minSimilarity) {
        // Found an analogy!
        this.stats.analogiesDiscovered++;

        const analogyKey = this.getAnalogyKey(newPattern.domain, existingPattern.domain);

        if (!this.analogies.has(analogyKey)) {
          this.analogies.set(analogyKey, []);
        }

        this.analogies.get(analogyKey).push({
          pattern1: newPattern.id,
          pattern2: existingPattern.id,
          similarity,
          mapping: this.createMapping(newPattern, existingPattern),
          discoveredAt: Date.now()
        });

        console.log(`🔗 [Analogy] "${newPattern.domain}" ↔ "${existingPattern.domain}": ${newPattern.structure.name} ≈ ${existingPattern.structure.name} (${(similarity * 100).toFixed(1)}%)`);

        this.emit('analogyDiscovered', {
          domain1: newPattern.domain,
          domain2: existingPattern.domain,
          pattern1: newPattern.structure.name,
          pattern2: existingPattern.structure.name,
          similarity
        });
      }
    }
  }

  /**
   * Calculate structural similarity between two patterns
   */
  calculateSimilarity(struct1, struct2) {
    let score = 0;
    let maxScore = 0;

    // Same type gets high score
    maxScore += 1;
    if (struct1.type === struct2.type) {
      score += 1;
    }

    // Similar properties
    const props1 = Object.keys(struct1.properties || {});
    const props2 = Object.keys(struct2.properties || {});
    const commonProps = props1.filter(p => props2.includes(p));

    maxScore += Math.max(props1.length, props2.length);
    score += commonProps.length;

    // Element overlap
    const elements1 = new Set((struct1.elements || []).map(e => e.type));
    const elements2 = new Set((struct2.elements || []).map(e => e.type));
    const commonElements = [...elements1].filter(e => elements2.has(e));

    maxScore += Math.max(elements1.size, elements2.size);
    score += commonElements.length;

    return maxScore > 0 ? score / maxScore : 0;
  }

  /**
   * Create mapping between analogous patterns
   */
  createMapping(pattern1, pattern2) {
    // Map elements from domain1 to domain2
    const mapping = {
      conceptMap: {},
      relationMap: {}
    };

    // Map by type
    const elements1 = pattern1.structure.elements || [];
    const elements2 = pattern2.structure.elements || [];

    for (const e1 of elements1) {
      for (const e2 of elements2) {
        if (e1.type === e2.type) {
          mapping.conceptMap[e1.name || e1.type] = e2.name || e2.type;
        }
      }
    }

    return mapping;
  }

  /**
   * Transfer knowledge from one domain to another using analogies
   * @param {string} sourceDomain
   * @param {string} targetDomain
   * @param {Object} knowledge - Knowledge to transfer
   * @returns {Object} - Transferred knowledge (or null if no analogy exists)
   */
  transferKnowledge(sourceDomain, targetDomain, knowledge) {
    const analogyKey = this.getAnalogyKey(sourceDomain, targetDomain);

    if (!this.analogies.has(analogyKey)) {
      console.log(`⚠️  [Transfer] No analogy between "${sourceDomain}" and "${targetDomain}"`);
      return null;
    }

    const analogies = this.analogies.get(analogyKey);

    // Use strongest analogy
    const bestAnalogy = analogies.reduce((best, current) =>
      current.similarity > best.similarity ? current : best
    );

    if (bestAnalogy.similarity < this.config.transferThreshold) {
      console.log(`⚠️  [Transfer] Analogy too weak (${(bestAnalogy.similarity * 100).toFixed(1)}%)`);
      return null;
    }

    // Apply mapping to transform knowledge
    const transferred = this.applyMapping(knowledge, bestAnalogy.mapping);

    this.stats.successfulTransfers++;

    console.log(`✨ [Transfer] Knowledge transferred from "${sourceDomain}" to "${targetDomain}"`);
    console.log(`   Confidence: ${(bestAnalogy.similarity * 100).toFixed(1)}%`);

    return transferred;
  }

  /**
   * Apply analogical mapping to transform knowledge
   */
  applyMapping(knowledge, mapping) {
    // Transform concepts using mapping
    const transferred = { ...knowledge };

    for (const [sourceConcept, targetConcept] of Object.entries(mapping.conceptMap)) {
      const sourceStr = JSON.stringify(knowledge);
      const targetStr = sourceStr.replace(
        new RegExp(sourceConcept, 'g'),
        targetConcept
      );
      try {
        return JSON.parse(targetStr);
      } catch (e) {
        // If parsing fails, return modified object
        if (transferred.concept === sourceConcept) {
          transferred.concept = targetConcept;
        }
      }
    }

    return transferred;
  }

  /**
   * Zero-shot learning: Apply abstract pattern to completely new domain
   * @param {string} newDomain
   * @param {Object} problem - Problem in new domain
   * @returns {Object} - Solution based on transferred pattern
   */
  zeroShotSolve(newDomain, problem) {
    // Find most relevant abstract pattern based on problem structure
    const problemStructure = this.analyzeStructure(problem);

    let bestPattern = null;
    let bestScore = 0;

    for (const [patternId, pattern] of this.abstractPatterns.entries()) {
      const score = this.calculateSimilarity(problemStructure, pattern.structure);

      if (score > bestScore) {
        bestScore = score;
        bestPattern = pattern;
      }
    }

    if (!bestPattern || bestScore < 0.5) {
      console.log(`⚠️  [ZeroShot] No applicable pattern for "${newDomain}"`);
      return null;
    }

    this.stats.zeroShotSuccesses++;

    console.log(`🎯 [ZeroShot] Applying "${bestPattern.structure.name}" from "${bestPattern.domain}" to "${newDomain}"`);
    console.log(`   Match: ${(bestScore * 100).toFixed(1)}%`);

    // Generate solution by applying abstract pattern
    const solution = {
      pattern: bestPattern.structure.name,
      approach: this.instantiatePattern(bestPattern, problem),
      confidence: bestScore,
      reasoning: `Applied ${bestPattern.structure.name} pattern from ${bestPattern.domain}`
    };

    return solution;
  }

  /**
   * Instantiate abstract pattern in concrete problem
   */
  instantiatePattern(pattern, problem) {
    // This would be domain-specific in a real implementation
    return {
      strategy: pattern.structure.name,
      steps: pattern.examples[0] ? this.extractSteps(pattern.examples[0]) : [],
      adapted: true
    };
  }

  /**
   * Extract meta-patterns (patterns of patterns)
   */
  extractMetaPatterns() {
    const metaCandidates = [];

    // Group patterns by type
    const byType = new Map();

    for (const [patternId, pattern] of this.abstractPatterns.entries()) {
      const type = pattern.structure.type;
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type).push(pattern);
    }

    // Find common structures across pattern groups
    for (const [type, patterns] of byType.entries()) {
      if (patterns.length < 3) continue;

      const metaStructure = this.findCommonStructure(
        patterns.map(p => p.structure)
      );

      const metaPattern = {
        id: `meta_${type}_${Date.now()}`,
        structure: metaStructure,
        subPatterns: patterns.map(p => p.id),
        level: this.config.abstractionLevels - 1, // Highest level
        createdAt: Date.now()
      };

      this.metaPatterns.set(metaPattern.id, metaPattern);

      console.log(`🎓 [MetaPattern] Discovered meta-pattern for "${type}" (${patterns.length} instances)`);
    }
  }

  /**
   * Helper methods
   */
  getDepth(obj, current = 0) {
    if (typeof obj !== 'object' || obj === null) return current;
    return 1 + Math.max(0, ...Object.values(obj).map(v => this.getDepth(v, 0)));
  }

  hasRecursion(obj, seen = new Set()) {
    if (typeof obj !== 'object' || obj === null) return false;
    if (seen.has(obj)) return true;
    seen.add(obj);
    return Object.values(obj).some(v => this.hasRecursion(v, seen));
  }

  extractRelationships(obj) {
    const relationships = [];
    // Simplified relationship extraction
    if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        relationships.push({ type: 'property', name: key, value: typeof value });
      }
    }
    return relationships;
  }

  extractSteps(example) {
    // Simplified step extraction
    return ['Step 1: Analyze', 'Step 2: Apply pattern', 'Step 3: Verify'];
  }

  getAnalogyKey(domain1, domain2) {
    return [domain1, domain2].sort().join('↔');
  }

  /**
   * Load abstractions from disk
   */
  async loadAbstractions() {
    try {
      const dataPath = path.join('SOMA', 'abstractions');
      await fs.mkdir(dataPath, { recursive: true });

      const abstractionsPath = path.join(dataPath, 'patterns.json');
      const data = await fs.readFile(abstractionsPath, 'utf8');
      const saved = JSON.parse(data);

      this.abstractPatterns = new Map(saved.patterns);
      this.domainKnowledge = new Map(
        saved.domains.map(([k, v]) => [k, new Set(v)])
      );
      this.analogies = new Map(saved.analogies);
      this.metaPatterns = new Map(saved.metaPatterns || []);
      this.stats = saved.stats || this.stats;

      console.log('📂 [AbstractionArbiter] Loaded existing abstractions');
    } catch (error) {
      console.log('📂 [AbstractionArbiter] Starting with empty abstractions');
    }
  }

  /**
   * Save abstractions to disk
   */
  async saveAbstractions() {
    try {
      const dataPath = path.join('SOMA', 'abstractions');
      await fs.mkdir(dataPath, { recursive: true });

      const abstractionsPath = path.join(dataPath, 'patterns.json');

      const data = {
        patterns: Array.from(this.abstractPatterns.entries()),
        domains: Array.from(this.domainKnowledge.entries()).map(([k, v]) => [k, Array.from(v)]),
        analogies: Array.from(this.analogies.entries()),
        metaPatterns: Array.from(this.metaPatterns.entries()),
        stats: this.stats,
        savedAt: new Date().toISOString()
      };

      await fs.writeFile(abstractionsPath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('❌ [AbstractionArbiter] Failed to save abstractions:', error);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalPatterns: this.abstractPatterns.size,
      domains: this.domainKnowledge.size,
      analogies: this.analogies.size,
      metaPatterns: this.metaPatterns.size
    };
  }
}

export default AbstractionArbiter;
