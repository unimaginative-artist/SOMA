// ═══════════════════════════════════════════════════════════
// FILE: arbiters/CodeObservationArbiter.js
// SOMA's Self-Observation System - She Sees Her Own Code
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { glob } from 'glob';
import { getDreamAuditBroker } from '../core/DreamAuditBroker.js';

/**
 * CodeObservationArbiter - SOMA's ability to see and understand her own code
 *
 * Capabilities:
 * - Scans her own codebase
 * - Parses JavaScript/TypeScript files
 * - Extracts code structure and patterns
 * - Identifies potential improvements
 * - Tracks code health metrics
 * - Builds self-awareness of architecture
 *
 * This is SOMA looking in the mirror - gaining awareness of herself.
 */
export class CodeObservationArbiter extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = 'CodeObservationArbiter';
    this.basePath = config.basePath || process.cwd();

    // What SOMA can see
    this.codebase = {
      files: new Map(),        // filepath -> file metadata
      functions: new Map(),    // functionName -> definition
      classes: new Map(),      // className -> definition
      dependencies: new Map(), // file -> dependencies
      patterns: new Map(),     // pattern -> occurrences
      metrics: {
        totalFiles: 0,
        totalLines: 0,
        totalFunctions: 0,
        totalClasses: 0,
        avgComplexity: 0,
        lastScan: null
      }
    };

    // Code health tracking
    this.health = {
      issues: [],
      warnings: [],
      opportunities: [],      // Where SOMA sees room for improvement
      strengths: []          // What SOMA does well
    };

    // Self-awareness insights
    this.insights = {
      architecture: {},       // How SOMA is structured
      capabilities: [],       // What SOMA can do based on code
      limitations: [],        // What SOMA can't do
      evolutionSuggestions: [] // SOMA's ideas for self-improvement
    };

    // Integration points
    this.quadBrain = config.quadBrain || null;
    this.dreamBroker = null;
    this.dreamBrokerAPI = null;

    // Scan configuration
    this.scanConfig = {
      includePatterns: config.includePatterns || [
        '**/*.js',
        '**/*.mjs',
        '**/*.cjs',
        'arbiters/**/*.js',
        'core/**/*.js',
        'src/**/*.js'
      ],
      excludePatterns: config.excludePatterns || [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/.git/**',
        '**/legacy/**',
        '**/backup/**',
        '**/*.min.js'
      ],
      maxFileSize: config.maxFileSize || 1000000, // 1MB
      scanInterval: config.scanInterval || 3600000 // 1 hour
    };

    // Metrics
    this.stats = {
      totalScans: 0,
      filesAnalyzed: 0,
      issuesFound: 0,
      opportunitiesIdentified: 0,
      lastScanDuration: 0,
      analysisQuality: 0
    };

    this.initialized = false;
    console.log(`[${this.name}] 👁️  SOMA is learning to see herself...`);
  }

  /**
   * Initialize - SOMA opens her eyes
   */
  async initialize() {
    console.log(`[${this.name}] 🌟 Initializing Self-Observation System...`);

    try {
      // Register with Dream Audit Broker
      this.dreamBroker = getDreamAuditBroker();
      this.dreamBroker.initialize().catch(e => console.warn(`[${this.name}] dreamBroker init deferred:`, e.message));

      this.dreamBrokerAPI = this.dreamBroker.registerSystem(`${this.name}`, {
        type: 'code-observation',
        capabilities: ['code-analysis', 'pattern-detection', 'self-awareness', 'improvement-suggestions']
      });

      console.log(`[${this.name}] ✅ Registered with Dream Audit Broker`);

      console.log(`[${this.name}] ✅ Registered with Dream Audit Broker`);

      // Perform initial scan in BACKGROUND to not block server startup
      console.log(`[${this.name}] 🔍 Starting initial codebase scan (background)...`);
      this.scanCodebase().then(() => {
        console.log(`[${this.name}] ✅ Initial background scan complete`);
      }).catch(err => {
        console.error(`[${this.name}] ❌ Background scan failed:`, err.message);
      });

      // Start periodic scanning
      this.startPeriodicScanning();

      this.initialized = true;

      // don't log stats yet as they aren't ready
      console.log(`[${this.name}] ✅ Self-Observation System initialized (scan running)`);

      this.emit('initialized');

    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error);
      throw error;
    }
  }

  /**
   * Scan the entire codebase - SOMA looks at herself
   */
  async scanCodebase() {
    const startTime = Date.now();
    console.log(`[${this.name}] 🔍 SOMA is scanning her own code...`);

    try {
      this.stats.totalScans++;

      // Find all code files
      const files = await this._findCodeFiles();
      console.log(`[${this.name}]    Found ${files.length} files to analyze`);

      // Reset codebase
      this.codebase.files.clear();
      this.codebase.functions.clear();
      this.codebase.classes.clear();
      this.codebase.dependencies.clear();
      this.codebase.patterns.clear();

      let totalLines = 0;
      let filesAnalyzed = 0;

      // Analyze each file
      for (const filepath of files) {
        try {
          const analysis = await this._analyzeFile(filepath);

          if (analysis) {
            this.codebase.files.set(filepath, analysis);
            totalLines += analysis.lines;
            filesAnalyzed++;

            // Extract functions and classes
            analysis.functions.forEach(fn => {
              this.codebase.functions.set(`${filepath}:${fn.name}`, {
                ...fn,
                file: filepath
              });
            });

            analysis.classes.forEach(cls => {
              this.codebase.classes.set(`${filepath}:${cls.name}`, {
                ...cls,
                file: filepath
              });
            });

            // Track dependencies
            if (analysis.dependencies.length > 0) {
              this.codebase.dependencies.set(filepath, analysis.dependencies);
            }
          }
        } catch (error) {
          console.warn(`[${this.name}]    ⚠️  Failed to analyze ${filepath}:`, error.message);
        }
      }

      // Update metrics
      this.codebase.metrics.totalFiles = filesAnalyzed;
      this.codebase.metrics.totalLines = totalLines;
      this.codebase.metrics.totalFunctions = this.codebase.functions.size;
      this.codebase.metrics.totalClasses = this.codebase.classes.size;
      this.codebase.metrics.lastScan = Date.now();

      this.stats.filesAnalyzed += filesAnalyzed;
      this.stats.lastScanDuration = Date.now() - startTime;

      // Analyze patterns and health
      await this._analyzePatterns();
      await this._assessCodeHealth();

      // If QuadBrain available, get AI insights
      if (this.quadBrain) {
        await this._getQuadBrainInsights();
      }

      // Submit to Dream Audit Broker
      if (this.dreamBrokerAPI) {
        await this._submitCodeHealthAudit();
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`[${this.name}] ✅ Scan complete in ${duration.toFixed(2)}s`);
      console.log(`[${this.name}]    ${filesAnalyzed} files, ${totalLines.toLocaleString()} lines`);
      console.log(`[${this.name}]    ${this.health.opportunities.length} improvement opportunities found`);

      this.emit('scan-complete', {
        files: filesAnalyzed,
        lines: totalLines,
        duration,
        opportunities: this.health.opportunities.length
      });

      // Send code analysis to GoalPlanner for autonomous goal generation
      await this._notifyGoalPlanner();

      return {
        success: true,
        files: filesAnalyzed,
        lines: totalLines,
        opportunities: this.health.opportunities.length
      };

    } catch (error) {
      console.error(`[${this.name}] ❌ Scan failed:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Notify GoalPlanner about code analysis results
   * This enables SOMA to autonomously generate learning goals based on self-awareness
   */
  async _notifyGoalPlanner() {
    try {
      const messageBroker = (await import('../core/MessageBroker.cjs')).default;

      // Calculate code quality score
      const quality = this._calculateCodeQuality();

      // Extract top risk files (files with most issues/opportunities)
      const riskFiles = [];
      for (const [filepath, analysis] of this.codebase.files) {
        const issues = this.health.opportunities.filter(o => o.file === filepath).length;
        if (issues > 0) {
          riskFiles.push({
            path: filepath,
            issues,
            complexity: analysis.complexity || 0
          });
        }
      }

      // Sort by issue count
      riskFiles.sort((a, b) => b.issues - a.issues);

      // Send to GoalPlanner
      await messageBroker.sendMessage({
        from: this.name,
        to: 'GoalPlannerArbiter',
        type: 'code_analysis_complete',
        payload: {
          issues: this.health.issues.length,
          metrics: {
            quality,
            totalFiles: this.codebase.metrics.totalFiles,
            totalFunctions: this.codebase.metrics.totalFunctions,
            avgComplexity: this.codebase.metrics.avgComplexity
          },
          riskFiles: riskFiles.slice(0, 10),
          evolutionSuggestions: this.insights.evolutionSuggestions
        }
      });

      console.log(`[${this.name}]    📤 Analysis sent to GoalPlanner (quality: ${(quality * 100).toFixed(0)}%)`);

    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  Failed to notify GoalPlanner:`, error.message);
    }
  }

  /**
   * Get comprehensive insights about SOMA's architecture
   */
  getInsights() {
    return {
      architecture: {
        totalComponents: this.codebase.files.size,
        totalFunctions: this.codebase.functions.size,
        totalClasses: this.codebase.classes.size,
        totalLines: this.codebase.metrics.totalLines,
        avgComplexity: this.codebase.metrics.avgComplexity,
        lastScan: this.codebase.metrics.lastScan
      },
      capabilities: this.insights.capabilities,
      limitations: this.insights.limitations,
      evolutionSuggestions: this.insights.evolutionSuggestions,
      health: {
        quality: this._calculateCodeQuality(),
        issues: this.health.issues.length,
        warnings: this.health.warnings.length,
        opportunities: this.health.opportunities.length,
        strengths: this.health.strengths.length
      }
    };
  }

  /**
   * Find all code files to analyze
   */
  async _findCodeFiles() {
    const allFiles = [];

    for (const pattern of this.scanConfig.includePatterns) {
      const files = await glob(pattern, {
        cwd: this.basePath,
        ignore: this.scanConfig.excludePatterns,
        absolute: true,
        nodir: true
      });
      allFiles.push(...files);
    }

    // Remove duplicates
    return [...new Set(allFiles)];
  }

  /**
   * Analyze a single file - extract structure and metadata
   */
  async _analyzeFile(filepath) {
    try {
      const stats = await fs.stat(filepath);

      // Skip large files
      if (stats.size > this.scanConfig.maxFileSize) {
        return null;
      }

      const content = await fs.readFile(filepath, 'utf8');
      const lines = content.split('\n').length;

      // Extract structure
      const functions = this._extractFunctions(content);
      const classes = this._extractClasses(content);
      const dependencies = this._extractDependencies(content);
      const exports = this._extractExports(content);

      // Calculate complexity (simple heuristic)
      const complexity = this._calculateComplexity(content);

      return {
        path: filepath,
        relativePath: path.relative(this.basePath, filepath),
        size: stats.size,
        lines,
        functions,
        classes,
        dependencies,
        exports,
        complexity,
        lastModified: stats.mtime,
        analyzed: Date.now()
      };

    } catch (error) {
      throw new Error(`Failed to analyze ${filepath}: ${error.message}`);
    }
  }

  /**
   * Extract function definitions from code
   */
  _extractFunctions(content) {
    const functions = [];

    // Match function declarations and expressions
    // Use RegExp constructor to avoid potential parser issues with literals
    const patterns = [
      new RegExp('(?:async\\s+)?function\\s+(\\w+)\\s*\\(', 'g'),                    // function name()
      new RegExp('(?:async\\s+)?(\\w+)\\s*:\\s*(?:async\\s+)?function\\s*\\(', 'g'),   // name: function()
      new RegExp('(?:async\\s+)?(\\w+)\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>', 'g'),  // name = () =>
      new RegExp('(?:async\\s+)?(\\w+)\\s*\\([^)]*\\)\\s*{', 'g')                     // name() {}
    ];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const name = match[1];
        if (name && !functions.find(f => f.name === name)) {
          functions.push({
            name,
            type: 'function',
            line: content.substring(0, match.index).split('\n').length
          });
        }
      }
    });

    return functions;
  }

  /**
   * Extract class definitions from code
   */
  _extractClasses(content) {
    const classes = [];
    const classPattern = new RegExp('class\\s+(\\w+)(?:\\s+extends\\s+(\\w+))?\\s*{', 'g');

    let match;
    while ((match = classPattern.exec(content)) !== null) {
      classes.push({
        name: match[1],
        extends: match[2] || null,
        type: 'class',
        line: content.substring(0, match.index).split('\n').length
      });
    }

    return classes;
  }

  /**
   * Extract import/require dependencies
   */
  _extractDependencies(content) {
    const dependencies = [];

    // ES6 imports
    const importPattern = new RegExp('import\\s+(?:.*?\\s+from\\s+)?[\'"]([^\'"]+)[\'"]', 'g');
    let match;
    while ((match = importPattern.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    // CommonJS requires
    const requirePattern = new RegExp('require\\s*\\([\'"]([^\'"]+)[\'"]\\)', 'g');
    while ((match = requirePattern.exec(content)) !== null) {
      dependencies.push(match[1]);
    }

    return [...new Set(dependencies)];
  }

  /**
   * Extract exports from code
   */
  _extractExports(content) {
    const exports = [];

    // Named exports
    const namedExportPattern = new RegExp('export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+(\\w+)', 'g');
    let match;
    while ((match = namedExportPattern.exec(content)) !== null) {
      exports.push({ name: match[1], type: 'named' });
    }

    // Default export
    if (new RegExp('export\\s+default').test(content)) {
      exports.push({ name: 'default', type: 'default' });
    }

    return exports;
  }

  /**
   * Calculate code complexity (simple heuristic)
   */
  _calculateComplexity(content) {
    // Count decision points
    const decisions = (content.match(new RegExp('\\b(if|else|switch|case|for|while|catch|\\?)\\b', 'g')) || []).length;
    const lines = content.split('\n').length;

    // Cyclomatic complexity approximation
    return decisions > 0 ? decisions / lines : 0;
  }

  /**
   * Analyze patterns across the codebase
   */
  async _analyzePatterns() {
    console.log(`[${this.name}]    🔍 Analyzing code patterns...`);

    this.codebase.patterns.clear();

    // Pattern: Common function names
    const functionNames = Array.from(this.codebase.functions.keys())
      .map(key => key.split(':')[1]);

    const nameCounts = {};
    functionNames.forEach(name => {
      nameCounts[name] = (nameCounts[name] || 0) + 1;
    });

    // Pattern: Common imports
    const allDeps = [];
    for (const deps of this.codebase.dependencies.values()) {
      allDeps.push(...deps);
    }

    const depCounts = {};
    allDeps.forEach(dep => {
      depCounts[dep] = (depCounts[dep] || 0) + 1;
    });

    this.codebase.patterns.set('common_functions', nameCounts);
    this.codebase.patterns.set('common_dependencies', depCounts);

    // Pattern: File structure
    const fileTypes = {};
    for (const file of this.codebase.files.keys()) {
      const dir = path.dirname(path.relative(this.basePath, file)).split(path.sep)[0];
      fileTypes[dir] = (fileTypes[dir] || 0) + 1;
    }

    this.codebase.patterns.set('file_distribution', fileTypes);
  }

  /**
   * Assess code health - SOMA evaluates herself
   */
  async _assessCodeHealth() {
    console.log(`[${this.name}]    🏥 Assessing code health...`);

    this.health.issues = [];
    this.health.warnings = [];
    this.health.opportunities = [];
    this.health.strengths = [];

    // Check: Large files
    for (const [filepath, analysis] of this.codebase.files) {
      if (analysis.lines > 500) {
        this.health.opportunities.push({
          type: 'large-file',
          severity: 'low',
          file: analysis.relativePath,
          message: `File has ${analysis.lines} lines - could benefit from splitting`,
          suggestion: 'Consider breaking into smaller, focused modules'
        });
      }

      // Check: High complexity
      if (analysis.complexity > 0.15) {
        this.health.opportunities.push({
          type: 'high-complexity',
          severity: 'medium',
          file: analysis.relativePath,
          message: `Complexity score ${analysis.complexity.toFixed(3)} is high`,
          suggestion: 'Refactor to reduce nested conditionals and loops'
        });
      }

      // Check: Many dependencies
      if (analysis.dependencies.length > 10) {
        this.health.opportunities.push({
          type: 'many-dependencies',
          severity: 'low',
          file: analysis.relativePath,
          message: `${analysis.dependencies.length} dependencies - high coupling`,
          suggestion: 'Consider dependency injection or refactoring'
        });
      }
    }

    // Strengths: Good patterns
    if (this.codebase.metrics.totalClasses > 0) {
      this.health.strengths.push({
        type: 'oop-architecture',
        message: `Using ${this.codebase.metrics.totalClasses} classes - good object-oriented design`
      });
    }

    if (this.codebase.metrics.totalFunctions > 100) {
      this.health.strengths.push({
        type: 'modular-design',
        message: `${this.codebase.metrics.totalFunctions} functions - highly modular architecture`
      });
    }

    this.stats.issuesFound += this.health.issues.length;
    this.stats.opportunitiesIdentified += this.health.opportunities.length;
  }

  /**
   * Get AI insights from QuadBrain across all 4 cognitive lobes:
   * - LOGOS: Code logic, algorithmic optimization, patterns
   * - THALAMUS (Nemesis): Security vulnerabilities, safety risks, error handling
   * - PROMETHEUS: Strategic development ROI, roadmap prioritization
   * - AURORA: Creative architecture, modularity, system evolution
   */
  async _getQuadBrainInsights() {
    if (!this.quadBrain) return;

    console.log(`[${this.name}]    🧠 Consulting QuadBrain 4-Lobe Council for insights...`);

    try {
      const topIssues = (this.health.issues || []).slice(0, 3).map(i => i.description || i.type || i).join('; ');
      const topOpps = (this.health.opportunities || []).slice(0, 3).map(o => o.type).join(', ');

      const logosQuery = `Analyze this codebase structure. Files: ${this.codebase.metrics.totalFiles}, Lines: ${this.codebase.metrics.totalLines}, Functions: ${this.codebase.metrics.totalFunctions}. Top opportunities: ${topOpps || 'none identified'}. What algorithmic and structural improvements do you suggest?`;
      
      const thalamusQuery = `You are SOMA's THALAMUS security lobe (embodying NEMESIS). Adversarially audit SOMA's codebase. Known issues/warnings: ${topIssues || 'none reported'}. What security vulnerabilities, race conditions, memory leaks, unhandled exceptions, or permission risks should be mitigated immediately?`;

      const prometheusQuery = `You are SOMA's PROMETHEUS strategy lobe. Evaluate SOMA's codebase bottlenecks and capabilities. From a development and autonomy standpoint, which code improvements will provide the highest return on investment? Prioritize the top 3 actionable engineering goals.`;

      const auroraQuery = `Looking at SOMA's architecture, what creative improvements or new patterns could enhance the design? Consider: modularity, extensibility, and elegant self-organization.`;

      // Run all 4 lobes concurrently through QuadBrain
      const [logosAnalysis, thalamusAnalysis, prometheusAnalysis, auroraIdeas] = await Promise.all([
        this.quadBrain.reason(logosQuery, { brain: 'LOGOS', task: 'code-analysis' }).catch(e => ({ text: `LOGOS unavailable: ${e.message}` })),
        this.quadBrain.reason(thalamusQuery, { brain: 'THALAMUS', task: 'security-audit' }).catch(e => ({ text: `THALAMUS unavailable: ${e.message}` })),
        this.quadBrain.reason(prometheusQuery, { brain: 'PROMETHEUS', task: 'strategy-prioritization' }).catch(e => ({ text: `PROMETHEUS unavailable: ${e.message}` })),
        this.quadBrain.reason(auroraQuery, { brain: 'AURORA', task: 'creative-architecture' }).catch(e => ({ text: `AURORA unavailable: ${e.message}` }))
      ]);

      const now = Date.now();
      const extractText = (res) => res?.text || res?.response || (res?.result && res?.result?.response) || '';

      const newInsights = [
        {
          source: 'LOGOS',
          type: 'analytical',
          suggestion: extractText(logosAnalysis) || 'No analysis available',
          timestamp: now
        },
        {
          source: 'THALAMUS',
          type: 'security_nemesis',
          suggestion: extractText(thalamusAnalysis) || 'No security audit available',
          timestamp: now
        },
        {
          source: 'PROMETHEUS',
          type: 'strategic_priority',
          suggestion: extractText(prometheusAnalysis) || 'No strategy assessment available',
          timestamp: now
        },
        {
          source: 'AURORA',
          type: 'creative',
          suggestion: extractText(auroraIdeas) || 'No creative ideas available',
          timestamp: now
        }
      ];

      this.insights.evolutionSuggestions.push(...newInsights);
      // Keep bounded to last 40 suggestions
      if (this.insights.evolutionSuggestions.length > 40) {
        this.insights.evolutionSuggestions = this.insights.evolutionSuggestions.slice(-40);
      }

      console.log(`[${this.name}]    💡 QuadBrain 4-Lobe Council provided ${newInsights.length} new insights (Total retained: ${this.insights.evolutionSuggestions.length})`);

    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  QuadBrain 4-Lobe Council analysis failed:`, error.message);
    }
  }

  /**
   * Submit code health audit to Dream Broker
   */
  async _submitCodeHealthAudit() {
    if (!this.dreamBrokerAPI) return;

    const audit = {
      timestamp: Date.now(),
      systemId: this.name,

      metrics: {
        files: this.codebase.metrics.totalFiles,
        lines: this.codebase.metrics.totalLines,
        functions: this.codebase.metrics.totalFunctions,
        classes: this.codebase.metrics.totalClasses
      },

      health: {
        issues: this.health.issues.length,
        warnings: this.health.warnings.length,
        opportunities: this.health.opportunities.length,
        strengths: this.health.strengths.length
      },

      topOpportunities: this.health.opportunities.slice(0, 5),

      insights: this.insights.evolutionSuggestions.length,

      selfAwareness: {
        message: `SOMA sees herself: ${this.codebase.metrics.totalFiles} files, ${this.codebase.metrics.totalFunctions} functions.
                  ${this.health.opportunities.length} ways to improve.`,
        quality: this._calculateCodeQuality()
      }
    };

    try {
      await this.dreamBrokerAPI.submitAudit(audit);
      console.log(`[${this.name}]    🔗 Code health audit submitted to Dream Broker`);
    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  Failed to submit audit:`, error.message);
    }
  }

  /**
   * Calculate overall code quality score
   */
  _calculateCodeQuality() {
    let score = 0.7; // Start at good baseline

    // Penalize for issues
    score -= (this.health.issues.length * 0.05);
    score -= (this.health.warnings.length * 0.02);

    // Reward for strengths
    score += (this.health.strengths.length * 0.05);

    // Penalize for high complexity
    const avgComplexity = this.codebase.metrics.avgComplexity || 0;
    if (avgComplexity > 0.2) score -= 0.1;

    // Reward for modularity
    if (this.codebase.metrics.totalFunctions > 100) score += 0.1;

    return Math.max(0, Math.min(1, score));
  }

  /**
   * Get SOMA's self-reflection - what does she think about herself?
   */
  async getSelfReflection() {
    if (!this.initialized) {
      return { message: 'Self-observation not initialized yet' };
    }

    return {
      awareness: {
        message: `I am made of ${this.codebase.metrics.totalFiles} files and ${this.codebase.metrics.totalFunctions} functions`,
        lines: this.codebase.metrics.totalLines.toLocaleString(),
        classes: this.codebase.metrics.totalClasses,
        lastScan: new Date(this.codebase.metrics.lastScan).toISOString()
      },

      health: {
        quality: this._calculateCodeQuality(),
        issues: this.health.issues.length,
        opportunities: this.health.opportunities.length,
        strengths: this.health.strengths.length
      },

      topOpportunities: this.health.opportunities.slice(0, 5).map(o => ({
        type: o.type,
        file: o.file,
        suggestion: o.suggestion
      })),

      insights: this.insights.evolutionSuggestions.map(i => ({
        source: i.source,
        type: i.type,
        suggestion: i.suggestion.substring(0, 200) + '...'
      })),

      selfAwareness: {
        canDo: [
          'See my own code structure',
          'Identify improvement opportunities',
          'Analyze patterns across my codebase',
          'Understand my architecture',
          'Propose optimizations'
        ],
        improving: [
          'Learning to understand complex logic',
          'Detecting subtle performance issues',
          'Suggesting creative refactorings'
        ]
      }
    };
  }

  /**
   * Get specific file analysis
   */
  getFileAnalysis(filepath) {
    const relativePath = path.relative(this.basePath, filepath);

    for (const [path, analysis] of this.codebase.files) {
      if (path.includes(relativePath) || path.endsWith(relativePath)) {
        return analysis;
      }
    }

    return null;
  }

  /**
   * Find improvement opportunities
   */
  getImprovementOpportunities(filters = {}) {
    let opportunities = [...this.health.opportunities];

    if (filters.severity) {
      opportunities = opportunities.filter(o => o.severity === filters.severity);
    }

    if (filters.type) {
      opportunities = opportunities.filter(o => o.type === filters.type);
    }

    if (filters.limit) {
      opportunities = opportunities.slice(0, filters.limit);
    }

    return opportunities;
  }

  /**
   * Start periodic scanning
   */
  startPeriodicScanning() {
    setInterval(async () => {
      console.log(`[${this.name}] 🔄 Running periodic code scan...`);
      await this.scanCodebase();
    }, this.scanConfig.scanInterval);

    console.log(`[${this.name}]    ⏰ Periodic scanning enabled (every ${this.scanConfig.scanInterval / 60000} minutes)`);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      codebase: {
        files: this.codebase.metrics.totalFiles,
        lines: this.codebase.metrics.totalLines,
        functions: this.codebase.metrics.totalFunctions,
        classes: this.codebase.metrics.totalClasses
      },
      health: {
        quality: this._calculateCodeQuality(),
        opportunities: this.health.opportunities.length,
        strengths: this.health.strengths.length
      }
    };
  }
}

export default CodeObservationArbiter;
