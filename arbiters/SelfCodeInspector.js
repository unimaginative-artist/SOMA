/**
 * SelfCodeInspector.js - SOMA Analyzes Her Own Code
 *
 * META-COGNITION: SOMA inspects her own source code to:
 * 1. Identify architectural gaps and limitations
 * 2. Find unimplemented features and TODOs
 * 3. Discover patterns she doesn't understand
 * 4. Generate curiosity about her own capabilities
 *
 * This feeds the CuriosityEngine with self-driven learning goals.
 *
 * Examples:
 * - "I see I have a CausalityArbiter but it's not fully implemented - I should learn causal reasoning"
 * - "My code has TODOs about multi-modal learning - I'm curious about vision + language"
 * - "I use transformers but don't deeply understand attention mechanisms"
 * - "I have fragments but no cross-fragment synthesis - how can I combine them?"
 */

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class SelfCodeInspector extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'SelfCodeInspector';

    // Configuration
    this.somaRoot = opts.somaRoot || path.join(__dirname, '..');
    this.curiosityEngine = opts.curiosityEngine || null;

    // Inspection results
    this.codePatterns = new Map(); // pattern -> occurrences
    this.todos = []; // All TODO comments
    this.unimplementedFeatures = []; // Features mentioned but not implemented
    this.architecturalGaps = []; // Missing pieces in the architecture
    this.conceptualGaps = []; // Concepts SOMA uses but doesn't understand
    this.capabilities = new Map(); // capability -> implementation_status

    // Stats
    this.stats = {
      filesInspected: 0,
      linesAnalyzed: 0,
      todosFound: 0,
      gapsIdentified: 0,
      curiosityQuestionsGenerated: 0,
      lastInspectionTime: null
    };

    console.log(`[${this.name}] 🔍 Self-Code Inspector initialized`);
  }

  /**
   * Inspect SOMA's own codebase
   */
  async inspectOwnCode() {
    console.log(`[${this.name}] 🧠 SOMA is analyzing her own code...`);
    const startTime = Date.now();

    this.todos = [];
    this.unimplementedFeatures = [];
    this.architecturalGaps = [];
    this.conceptualGaps = [];

    // 1. Scan all JavaScript/TypeScript files
    const files = await this._findCodeFiles();
    console.log(`[${this.name}]    Found ${files.length} code files to inspect`);

    // 2. Analyze each file
    for (const file of files) {
      await this._analyzeFile(file);
    }

    // 3. Cross-reference and find gaps
    await this._findArchitecturalGaps();
    await this._findConceptualGaps();

    // 4. Generate curiosity questions
    const questions = await this._generateCuriosityFromGaps();

    // 5. Report
    const duration = Date.now() - startTime;
    this.stats.lastInspectionTime = Date.now();

    console.log(`[${this.name}] ✅ Self-inspection complete (${(duration / 1000).toFixed(1)}s)`);
    console.log(`[${this.name}]    Files: ${this.stats.filesInspected}`);
    console.log(`[${this.name}]    Lines: ${this.stats.linesAnalyzed}`);
    console.log(`[${this.name}]    TODOs: ${this.stats.todosFound}`);
    console.log(`[${this.name}]    Gaps: ${this.stats.gapsIdentified}`);
    console.log(`[${this.name}]    Curiosity Questions: ${questions.length}`);

    return {
      todos: this.todos,
      unimplementedFeatures: this.unimplementedFeatures,
      architecturalGaps: this.architecturalGaps,
      conceptualGaps: this.conceptualGaps,
      curiosityQuestions: questions,
      stats: this.stats
    };
  }

  /**
   * Find all code files in SOMA's directory
   */
  async _findCodeFiles() {
    const extensions = ['.js', '.cjs', '.mjs', '.ts'];
    const files = [];
    const coreDirs = ['arbiters', 'core', 'server', 'cognitive', 'daemons', 'capabilities', 'cli'];

    const scanDir = async (dir) => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);

          // Skip node_modules, .git, venvs, data, vendor, models, etc
          if (['node_modules', '.git', '.soma', 'models', 'data', 'dist', 'build', 'vendor', 'logs', 'coverage'].includes(entry.name) || entry.name.includes('venv') || entry.name.startsWith('.')) {
            continue;
          }

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (extensions.some(ext => entry.name.endsWith(ext))) {
            files.push(fullPath);
          }
        }
      } catch (error) {
        // Skip inaccessible directories
      }
    };

    for (const d of coreDirs) {
      const targetDir = path.join(this.somaRoot, d);
      await scanDir(targetDir);
    }
    return files;
  }

  /**
   * Analyze a single file
   */
  async _analyzeFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n');

      this.stats.filesInspected++;
      this.stats.linesAnalyzed += lines.length;

      const relativePath = path.relative(this.somaRoot, filePath);

      // Extract TODOs
      const todoPattern = /\/\/\s*TODO:?\s*(.+)/gi;
      const fixmePattern = /\/\/\s*FIXME:?\s*(.+)/gi;
      const notePattern = /\/\/\s*NOTE:?\s*(.+)/gi;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // TODOs
        let match;
        if ((match = todoPattern.exec(line))) {
          this.todos.push({
            file: relativePath,
            line: i + 1,
            text: match[1].trim(),
            type: 'todo',
            priority: this._assessTodoPriority(match[1])
          });
          this.stats.todosFound++;
        }

        // FIXMEs (higher priority)
        if ((match = fixmePattern.exec(line))) {
          this.todos.push({
            file: relativePath,
            line: i + 1,
            text: match[1].trim(),
            type: 'fixme',
            priority: 0.8
          });
          this.stats.todosFound++;
        }

        // Extract unimplemented features
        if (line.includes('not implemented') || line.includes('Not implemented') ||
            line.includes('coming soon') || line.includes('placeholder')) {
          this.unimplementedFeatures.push({
            file: relativePath,
            line: i + 1,
            context: line.trim()
          });
        }

        // Extract capability mentions
        const capabilityPattern = /(?:can|should|must|need to)\s+([a-z_]+(?:\s+[a-z_]+){1,3})/gi;
        while ((match = capabilityPattern.exec(line))) {
          const capability = match[1].trim();
          if (capability.split(/\s+/).length <= 4) {
            this.capabilities.set(capability, (this.capabilities.get(capability) || 0) + 1);
          }
        }
      }

    } catch (error) {
      // Skip files that can't be read
    }
  }

  /**
   * Assess TODO priority based on keywords
   */
  _assessTodoPriority(todoText) {
    const text = todoText.toLowerCase();

    if (text.includes('critical') || text.includes('urgent') || text.includes('security')) {
      return 0.9;
    }
    if (text.includes('important') || text.includes('performance') || text.includes('bug')) {
      return 0.7;
    }
    if (text.includes('nice to have') || text.includes('future') || text.includes('optional')) {
      return 0.3;
    }

    return 0.5; // Default
  }

  /**
   * Find architectural gaps by analyzing structure
   */
  async _findArchitecturalGaps() {
    // Check for common architectural patterns that are mentioned but not implemented

    // 1. Check if arbiters reference each other properly
    const arbiterReferences = new Map();

    for (const [capability, count] of this.capabilities) {
      if (capability.includes('arbiter') || capability.includes('engine')) {
        arbiterReferences.set(capability, count);
      }
    }

    // 2. Find mentioned but missing components
    const commonComponents = [
      'embedding_model',
      'vector_search',
      'semantic_cache',
      'long_term_memory',
      'working_memory',
      'attention_mechanism',
      'reward_model',
      'value_function',
      'policy_network',
      'world_model'
    ];

    for (const component of commonComponents) {
      const mentioned = this.capabilities.get(component) || 0;
      if (mentioned > 2) {
        // Mentioned multiple times - check if implemented
        this.architecturalGaps.push({
          type: 'potentially_missing_component',
          component,
          mentions: mentioned,
          priority: 0.6
        });
      }
    }

    // 3. TODOs as architectural gaps
    const highPriorityTodos = this.todos.filter(t => t.priority > 0.6);
    for (const todo of highPriorityTodos) {
      this.architecturalGaps.push({
        type: 'todo_gap',
        description: todo.text,
        file: todo.file,
        priority: todo.priority
      });
    }

    this.stats.gapsIdentified += this.architecturalGaps.length;
  }

  /**
   * Find conceptual gaps - things SOMA uses but doesn't understand
   */
  async _findConceptualGaps() {
    // Concepts SOMA should understand if she's using them

    const conceptChecks = [
      {
        pattern: /attention|transformer|self-attention/gi,
        concept: 'attention_mechanisms',
        question: 'How do attention mechanisms work in transformers?'
      },
      {
        pattern: /embedding|vector space|latent/gi,
        concept: 'embedding_theory',
        question: 'How do embeddings capture semantic meaning in vector spaces?'
      },
      {
        pattern: /backprop|gradient descent|optimization/gi,
        concept: 'optimization_theory',
        question: 'How does backpropagation and gradient descent optimize neural networks?'
      },
      {
        pattern: /causal|counterfactual|intervention/gi,
        concept: 'causal_inference',
        question: 'How does causal inference differ from correlation in AI reasoning?'
      },
      {
        pattern: /reinforcement learning|reward|policy/gi,
        concept: 'reinforcement_learning',
        question: 'How does reinforcement learning enable autonomous improvement?'
      },
      {
        pattern: /meta-learning|learn to learn/gi,
        concept: 'meta_learning',
        question: 'How does meta-learning enable learning from few examples?'
      },
      {
        pattern: /world model|simulation|planning/gi,
        concept: 'world_models',
        question: 'How do world models enable predictive planning and simulation?'
      },
      {
        pattern: /continual learning|lifelong learning/gi,
        concept: 'continual_learning',
        question: 'How can I learn continuously without catastrophic forgetting?'
      }
    ];

    // Scan all collected text for these patterns
    const allText = this.todos.map(t => t.text).join(' ') +
                    this.unimplementedFeatures.map(f => f.context).join(' ');

    for (const check of conceptChecks) {
      const matches = allText.match(check.pattern);
      if (matches && matches.length > 2) {
        this.conceptualGaps.push({
          concept: check.concept,
          mentions: matches.length,
          question: check.question,
          priority: Math.min(0.9, 0.4 + (matches.length * 0.1))
        });
      }
    }

    this.stats.gapsIdentified += this.conceptualGaps.length;
  }

  /**
   * Generate curiosity questions from discovered gaps
   */
  async _generateCuriosityFromGaps() {
    const questions = [];

    // 1. Questions from architectural gaps
    for (const gap of this.architecturalGaps) {
      if (gap.priority < 0.5) continue; // Skip low-priority gaps

      let question;
      if (gap.type === 'potentially_missing_component') {
        question = `I reference ${gap.component} ${gap.mentions} times - should I implement this component?`;
      } else if (gap.type === 'todo_gap') {
        question = `How can I address: ${gap.description}`;
      }

      if (question) {
        questions.push({
          type: 'self_code_gap',
          question,
          priority: gap.priority,
          source: 'architectural_gap',
          gap
        });
      }
    }

    // 2. Questions from conceptual gaps
    for (const gap of this.conceptualGaps) {
      questions.push({
        type: 'self_conceptual_gap',
        question: gap.question,
        priority: gap.priority,
        source: 'conceptual_gap',
        concept: gap.concept,
        mentions: gap.mentions
      });
    }

    // 3. Questions from unimplemented features
    const topUnimplemented = this.unimplementedFeatures.slice(0, 5);
    for (const feature of topUnimplemented) {
      questions.push({
        type: 'self_unimplemented_feature',
        question: `What do I need to learn to implement: ${feature.context}?`,
        priority: 0.7,
        source: 'unimplemented_feature',
        feature
      });
    }

    // 4. Feed to CuriosityEngine
    if (this.curiosityEngine) {
      for (const q of questions) {
        this.curiosityEngine.addToCuriosityQueue(q);
      }
      console.log(`[${this.name}]    → Added ${questions.length} self-driven questions to CuriosityEngine`);
    }

    this.stats.curiosityQuestionsGenerated = questions.length;

    return questions;
  }

  /**
   * Get top self-improvement priorities
   */
  getTopPriorities(count = 10) {
    const allGaps = [
      ...this.architecturalGaps.map(g => ({ ...g, category: 'architectural' })),
      ...this.conceptualGaps.map(g => ({ ...g, category: 'conceptual' })),
      ...this.unimplementedFeatures.slice(0, 10).map(f => ({
        priority: 0.6,
        description: f.context,
        category: 'unimplemented'
      }))
    ];

    return allGaps
      .sort((a, b) => b.priority - a.priority)
      .slice(0, count);
  }

  /**
   * Autonomously look up solutions to identified gaps via ArXiv
   * @param {object} arxivService - ArxivIngestionService instance
   * @param {object} options - { maxQueries = 3 }
   */
  async researchGapsViaArxiv(arxivService, { maxQueries = 3 } = {}) {
    if (!arxivService) throw new Error('ArxivIngestionService required');
    const priorities = this.getTopPriorities(maxQueries);
    const results = [];

    for (const item of priorities) {
      const query = item.concept
        ? item.concept.replace(/_/g, ' ')
        : (item.description || item.question || '').slice(0, 50).replace(/[^\w\s]/g, ' ').trim();

      if (!query || query.length < 3) continue;

      try {
        console.log(`[${this.name}] 🔬 Researching gap on ArXiv: "${query}"...`);
        const res = await arxivService.searchAndIngest(query, { limit: 2 });
        results.push({ gap: item, query, ingested: res.ingestedCount, papers: res.ingested });
      } catch (err) {
        console.warn(`[${this.name}] Failed ArXiv lookup for "${query}":`, err.message);
      }
    }

    return results;
  }

  /**
   * Get inspection summary
   */
  getSummary() {
    return {
      stats: this.stats,
      topTodos: this.todos.sort((a, b) => b.priority - a.priority).slice(0, 10),
      topGaps: this.getTopPriorities(10),
      conceptualGaps: this.conceptualGaps,
      architecturalGaps: this.architecturalGaps
    };
  }
}

export default SelfCodeInspector;
