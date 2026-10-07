/**
 * SelfDrivenCuriosityConnector.js
 *
 * **THE SELF-AWARENESS BRIDGE**
 *
 * Connects SOMA's self-analysis systems to her curiosity engine:
 *
 * CodeObservationArbiter → Analyzes her own code
 * ConversationCuriosityExtractor → Analyzes past conversations
 * ↓
 * CuriosityEngine → Generates learning goals
 * ↓
 * EdgeWorkers + Training → Autonomous learning
 *
 * This creates TRUE self-driven curiosity:
 * - SOMA sees gaps in her own code → wants to learn to fill them
 * - SOMA notices uncertain responses → wants to improve confidence
 * - SOMA sees user interests → wants to become expert in those areas
 *
 * No pre-configured topics - she decides what to learn based on self-reflection!
 */

import { EventEmitter } from 'events';
import { CodeObservationArbiter } from './CodeObservationArbiter.js';
import { ConversationCuriosityExtractor } from './ConversationCuriosityExtractor.js';
import { CuriosityEngine } from './CuriosityEngine.js';

export class SelfDrivenCuriosityConnector extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = 'SelfDrivenCuriosityConnector';

    // Components (can be injected or created)
    this.codeObserver = opts.codeObserver || null;
    this.conversationExtractor = opts.conversationExtractor || null;
    this.curiosityEngine = opts.curiosityEngine || null;

    // Other arbiters
    this.quadBrain = opts.quadBrain || null;
    this.selfModel = opts.selfModel || null;
    this.knowledgeGraph = opts.knowledgeGraph || null;
    this.messageBroker = opts.messageBroker || null;

    // Configuration
    this.config = {
      codeAnalysisInterval: opts.codeAnalysisInterval || 3600000, // 1 hour
      conversationAnalysisInterval: opts.conversationAnalysisInterval || 1800000, // 30 min
      enableCodeObservation: opts.enableCodeObservation !== false,
      enableConversationAnalysis: opts.enableConversationAnalysis !== false,
      enableAutoCuriosity: opts.enableAutoCuriosity !== false
    };

    // Stats
    this.stats = {
      codeAnalysisRuns: 0,
      conversationAnalysisRuns: 0,
      totalCuriosityGenerated: 0,
      codeGapsFound: 0,
      conversationGapsFound: 0,
      lastCodeAnalysis: null,
      lastConversationAnalysis: null
    };

    this.initialized = false;
    console.log(`[${this.name}] 🧠 Self-Driven Curiosity Connector initialized`);
  }

  /**
   * Initialize - wire everything together
   */
  async initialize() {
    console.log(`[${this.name}] 🌟 Connecting self-analysis to curiosity...`);

    // 1. Create or validate CuriosityEngine
    if (!this.curiosityEngine) {
      console.log(`[${this.name}]    Creating CuriosityEngine...`);
      this.curiosityEngine = new CuriosityEngine({
        selfModel: this.selfModel,
        knowledgeGraph: this.knowledgeGraph,
        messageBroker: this.messageBroker
      });
      await this.curiosityEngine.initialize();
    }

    // 2. Create or validate CodeObservationArbiter
    if (!this.codeObserver && this.config.enableCodeObservation) {
      console.log(`[${this.name}]    Creating CodeObservationArbiter...`);
      this.codeObserver = new CodeObservationArbiter({
        quadBrain: this.quadBrain
      });
      await this.codeObserver.initialize();
    }

    // 3. Create or validate ConversationCuriosityExtractor
    if (!this.conversationExtractor && this.config.enableConversationAnalysis) {
      console.log(`[${this.name}]    Creating ConversationCuriosityExtractor...`);
      this.conversationExtractor = new ConversationCuriosityExtractor({
        curiosityEngine: this.curiosityEngine,
        quadBrain: this.quadBrain
      });
    }

    // 4. Run initial analysis
    console.log(`[${this.name}] 🔍 Running initial self-analysis...`);
    await this.runSelfAnalysis();

    // 5. Schedule periodic analysis
    if (this.config.enableAutoCuriosity) {
      this.startPeriodicAnalysis();
    }

    this.initialized = true;

    console.log(`[${this.name}] ✅ Self-Driven Curiosity system ready!`);
    console.log(`[${this.name}]    SOMA will now learn based on self-reflection`);
    console.log(`[${this.name}]    Code gaps: ${this.stats.codeGapsFound}`);
    console.log(`[${this.name}]    Conversation gaps: ${this.stats.conversationGapsFound}`);
    console.log(`[${this.name}]    Curiosity questions: ${this.stats.totalCuriosityGenerated}`);

    this.emit('initialized');

    return {
      success: true,
      stats: this.stats
    };
  }

  /**
   * Run complete self-analysis
   */
  async runSelfAnalysis() {
    console.log(`[${this.name}] 🧠 SOMA is reflecting on herself...`);

    const results = {
      codeAnalysis: null,
      conversationAnalysis: null,
      curiosityQuestionsGenerated: 0
    };

    // 1. Analyze own code
    if (this.codeObserver && this.config.enableCodeObservation) {
      console.log(`[${this.name}]    🔍 Analyzing own code...`);

      try {
        await this.codeObserver.scanCodebase();
        results.codeAnalysis = this.codeObserver.getSummary();

        // Extract curiosity from code gaps
        const codeQuestions = await this._extractCodeCuriosity(results.codeAnalysis);
        results.curiosityQuestionsGenerated += codeQuestions.length;

        this.stats.codeAnalysisRuns++;
        this.stats.codeGapsFound += codeQuestions.length;
        this.stats.lastCodeAnalysis = Date.now();

        console.log(`[${this.name}]       → Found ${codeQuestions.length} code-driven questions`);
      } catch (error) {
        console.error(`[${this.name}]       ❌ Code analysis failed:`, error.message);
      }
    }

    // 2. Analyze conversations
    if (this.conversationExtractor && this.config.enableConversationAnalysis) {
      console.log(`[${this.name}]    💬 Analyzing conversations...`);

      try {
        results.conversationAnalysis = await this.conversationExtractor.analyzeConversations();
        results.curiosityQuestionsGenerated += results.conversationAnalysis.curiosityQuestions.length;

        this.stats.conversationAnalysisRuns++;
        this.stats.conversationGapsFound += results.conversationAnalysis.curiosityQuestions.length;
        this.stats.lastConversationAnalysis = Date.now();

        console.log(`[${this.name}]       → Found ${results.conversationAnalysis.curiosityQuestions.length} conversation-driven questions`);
      } catch (error) {
        console.error(`[${this.name}]       ❌ Conversation analysis failed:`, error.message);
      }
    }

    // 3. Update totals
    this.stats.totalCuriosityGenerated += results.curiosityQuestionsGenerated;

    console.log(`[${this.name}] ✅ Self-analysis complete`);
    console.log(`[${this.name}]    Total curiosity generated: ${results.curiosityQuestionsGenerated} questions`);

    this.emit('analysis_complete', results);

    return results;
  }

  /**
   * Extract curiosity questions from code analysis
   */
  async _extractCodeCuriosity(codeAnalysis) {
    if (!codeAnalysis || !this.curiosityEngine) return [];

    const questions = [];

    // 1. Questions from TODOs
    if (codeAnalysis.topTodos) {
      for (const todo of codeAnalysis.topTodos.slice(0, 5)) {
        if (todo.priority > 0.6) {
          questions.push({
            type: 'code_todo',
            question: `How can I implement: ${todo.text}?`,
            priority: todo.priority,
            source: 'code_observation',
            metadata: { file: todo.file, line: todo.line }
          });
        }
      }
    }

    // 2. Questions from conceptual gaps
    if (codeAnalysis.conceptualGaps) {
      for (const gap of codeAnalysis.conceptualGaps) {
        questions.push({
          type: 'code_conceptual_gap',
          question: gap.question || `What should I know about ${gap.concept}?`,
          priority: gap.priority || 0.7,
          source: 'code_observation',
          metadata: { concept: gap.concept, mentions: gap.mentions }
        });
      }
    }

    // 3. Questions from architectural gaps
    if (codeAnalysis.architecturalGaps) {
      for (const gap of codeAnalysis.architecturalGaps.slice(0, 5)) {
        if (gap.description || gap.component) {
          questions.push({
            type: 'code_architectural_gap',
            question: gap.description
              ? `How do I address: ${gap.description}?`
              : `Should I implement ${gap.component}?`,
            priority: gap.priority || 0.6,
            source: 'code_observation',
            metadata: gap
          });
        }
      }
    }

    // Add to CuriosityEngine
    for (const q of questions) {
      this.curiosityEngine.addToCuriosityQueue(q);
    }

    return questions;
  }

  /**
   * Start periodic self-analysis
   */
  startPeriodicAnalysis() {
    console.log(`[${this.name}] 🔄 Starting periodic self-analysis...`);

    // Code analysis interval
    if (this.codeObserver) {
      setInterval(async () => {
        console.log(`[${this.name}] ⏰ Scheduled code analysis starting...`);
        await this.runSelfAnalysis();
      }, this.config.codeAnalysisInterval);
    }

    // Conversation analysis interval (more frequent)
    if (this.conversationExtractor) {
      setInterval(async () => {
        console.log(`[${this.name}] ⏰ Scheduled conversation analysis starting...`);

        if (this.conversationExtractor) {
          await this.conversationExtractor.analyzeConversations();
        }
      }, this.config.conversationAnalysisInterval);
    }
  }

  /**
   * Get current curiosity state
   */
  getCuriosityState() {
    if (!this.curiosityEngine) {
      return { error: 'CuriosityEngine not initialized' };
    }

    return {
      ...this.curiosityEngine.getCuriosityState(),
      selfDrivenStats: this.stats,
      codeObservation: this.codeObserver ? this.codeObserver.getSummary() : null,
      conversationAnalysis: this.conversationExtractor ? this.conversationExtractor.getSummary() : null
    };
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      name: this.name,
      initialized: this.initialized,
      stats: this.stats,
      config: this.config,
      components: {
        codeObserver: !!this.codeObserver,
        conversationExtractor: !!this.conversationExtractor,
        curiosityEngine: !!this.curiosityEngine
      }
    };
  }

  /**
   * Shutdown
   */
  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    this.emit('shutdown');
    return { success: true };
  }
}

export default SelfDrivenCuriosityConnector;
