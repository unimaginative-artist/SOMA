// ═══════════════════════════════════════════════════════════
// SyntheticDataGenerator.js - Generate Training Data from Arbiters
// Uses polymorphic arbiters to CREATE unlimited training examples
// ═══════════════════════════════════════════════════════════

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

// Yield event loop between API calls to prevent starvation
const yieldLoop = () => new Promise(resolve => setImmediate(resolve));

/**
 * SyntheticDataGenerator
 *
 * Leverages SOMA's arbiters to generate synthetic training data:
 *
 * BRILLIANT STRATEGY:
 * 1. QuadBrain generates Q&A pairs (LOGOS asks, AURORA answers)
 * 2. ReasoningChamber generates reasoning chains
 * 3. CuriosityEngine generates exploratory questions
 * 4. FragmentRegistry generates domain-specific examples
 * 5. MuseEngine generates creative variations
 *
 * Result: UNLIMITED high-quality training data!
 */
export class SyntheticDataGenerator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.name = config.name || 'SyntheticDataGenerator';

    // Inject arbiters
    this.quadBrain = config.quadBrain || null;
    this.reasoningChamber = config.reasoningChamber || null;
    this.curiosityEngine = config.curiosityEngine || null;
    this.fragmentRegistry = config.fragmentRegistry || null;
    this.museEngine = config.museEngine || null;

    // Output path
    this.outputPath = config.outputPath || './.soma/synthetic-data';

    // Generation config
    this.batchSize = config.batchSize || 100;
    this.domains = config.domains || ['general', 'reasoning', 'code', 'creative'];

    // Metrics
    this.metrics = {
      totalGenerated: 0,
      byType: {},
      byDomain: {}
    };

    console.log(`[${this.name}] 🎲 Synthetic Data Generator initialized`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing synthetic data generation...`);

    // Create output directory
    try {
      await fs.mkdir(this.outputPath, { recursive: true });
      console.log(`[${this.name}]    ✅ Output directory ready: ${this.outputPath}`);
    } catch (error) {
      console.warn(`[${this.name}]    ⚠️  Failed to create output directory: ${error.message}`);
    }

    this.emit('initialized');
    console.log(`[${this.name}] ✅ Synthetic data generator ready`);
    return { success: true };
  }

  /**
   * Generate a batch of synthetic training examples
   */
  async generateBatch(count = 100, types = ['qa', 'reasoning', 'creative']) {
    console.log(`\n[${this.name}] 🎲 Generating ${count} synthetic examples`);
    console.log(`[${this.name}]    Types: ${types.join(', ')}`);

    const examples = [];
    const perType = Math.floor(count / types.length);

    for (const type of types) {
      console.log(`[${this.name}]    Generating ${perType} ${type} examples...`);

      try {
        let typeExamples;

        switch (type) {
          case 'qa':
            typeExamples = await this.generateQAPairs(perType);
            break;
          case 'reasoning':
            typeExamples = await this.generateReasoningChains(perType);
            break;
          case 'creative':
            typeExamples = await this.generateCreativeExamples(perType);
            break;
          case 'code':
            typeExamples = await this.generateCodeExamples(perType);
            break;
          case 'dialogue':
            typeExamples = await this.generateDialogues(perType);
            break;
          default:
            console.warn(`[${this.name}]       Unknown type: ${type}`);
            typeExamples = [];
        }

        examples.push(...typeExamples);
        console.log(`[${this.name}]       ✅ Generated ${typeExamples.length} examples`);

      } catch (error) {
        console.error(`[${this.name}]       ❌ Failed to generate ${type}: ${error.message}`);
      }
    }

    // Save batch
    await this.saveBatch(examples);

    this.metrics.totalGenerated += examples.length;

    console.log(`[${this.name}] ✅ Batch complete: ${examples.length} examples generated`);

    return {
      success: true,
      count: examples.length,
      examples
    };
  }

  /**
   * Generate Q&A pairs using QuadBrain with Consensus Validation
   * (The "Soma-1B" Protocol)
   */
  async generateQAPairs(count) {
    if (!this.quadBrain) {
      throw new Error('QuadBrain not available');
    }

    const examples = [];
    const topics = this.getRandomTopics(count);

    for (const topic of topics) {
      try {
        await yieldLoop(); // Prevent event loop starvation
        // 1. Generate a thoughtful question (Seed)
        const questionResult = await this.quadBrain.reason(
          `Generate a deep, specific question about: ${topic}`,
          { brain: 'LOGOS', mode: 'fast', quickResponse: true }
        );
        const question = questionResult.response || questionResult.result?.response;
        if (!question) continue;

        // 2. "Teacher" Responses (High-Confidence Collision Check)
        // DYNAMIC PAIRING: Select the best "Sparring Partner" for Logic
        // Logic (LOGOS) is the anchor. The partner depends on the query type.
        
        let secondaryBrain = 'AURORA'; // Default to Creative for descriptive queries
        
        // If query is Strategic/Actionable, bring in PROMETHEUS
        const actionKeywords = ['how', 'plan', 'build', 'create', 'strategy', 'future', 'prevent', 'solve', 'fix', 'optimize'];
        const questionLower = question.toLowerCase();
        
        // Safer keyword check without regex literals to avoid parser issues
        if (actionKeywords.some(kw => questionLower.includes(kw))) {
            secondaryBrain = 'PROMETHEUS';
        }

        console.log(`[${this.name}] 🤖 Teacher Pair: LOGOS + ${secondaryBrain} for "${question.substring(0, 40)}..."`);

        const logosRes = await this.quadBrain.callBrain('LOGOS', question, {}, 'full');
        const secondaryRes = await this.quadBrain.callBrain(secondaryBrain, question, {}, 'full');

        let trainingExample = null;

        // CHECK: High-Confidence Collision
        if (logosRes.confidence > 0.9 && secondaryRes.confidence > 0.9) {
            const similarity = this._calculateSimilarity(logosRes.text, secondaryRes.text);
            
            if (similarity > 0.6) {
                // CASE A: Golden Truth
                console.log(`[${this.name}] 🌟 GOLDEN TRUTH found (${secondaryBrain})`);
                
                trainingExample = {
                    type: 'qa',
                    topic,
                    question,
                    answer: this._mergeResponses(logosRes.text, secondaryRes.text),
                    category: "common_sense_core",
                    metadata: {
                        source: `consensus_logos_${secondaryBrain.toLowerCase()}`,
                        confidence_score: (logosRes.confidence + secondaryRes.confidence) / 2,
                        agreement_level: "high",
                        generated: Date.now()
                    }
                };
            } else {
                // CASE B: Cognitive Dissonance
                console.log(`[${this.name}] ⚔️ DISSONANCE found (${secondaryBrain})`);
                
                trainingExample = {
                    type: 'qa',
                    topic,
                    question,
                    answer: `There are multiple valid perspectives here.\n\nLogically: ${this._summarize(logosRes.text)}\n\n${secondaryBrain === 'PROMETHEUS' ? 'Strategically' : 'Creatively'}: ${this._summarize(secondaryRes.text)}`,
                    category: "ambiguity_resolution",
                    metadata: {
                        source: `adversarial_logos_${secondaryBrain.toLowerCase()}`,
                        conflict: true,
                        generated: Date.now()
                    }
                };
            }
        } else {
            // Standard Generation (Fallback to single best)
            const bestRes = logosRes.confidence > secondaryRes.confidence ? logosRes : secondaryRes;
            trainingExample = {
                type: 'qa',
                topic,
                question,
                answer: bestRes.text,
                metadata: {
                    questionBrain: 'LOGOS',
                    answerBrain: bestRes.brain,
                    confidence: bestRes.confidence,
                    generated: Date.now()
                }
            };
        }

        if (trainingExample) {
            examples.push(trainingExample);
        }

      } catch (error) {
        console.warn(`[${this.name}]          ⚠️  Failed to generate Q&A for ${topic}: ${error.message}`);
      }
    }

    return examples;
  }

  /**
   * Simple similarity check (Word Overlap Jaccard)
   */
  _calculateSimilarity(text1, text2) {
      if (!text1 || !text2) return 0;
      const set1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const set2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length > 3));
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      return union.size === 0 ? 0 : intersection.size / union.size;
  }

  /**
   * Helper to merge or select best part
   */
  _mergeResponses(r1, r2) {
      // For Soma-1B training, we prefer the slightly longer/more detailed one as "Truth"
      return r1.length > r2.length ? r1 : r2;
  }

  _summarize(text) {
      // Simple truncation without regex to be absolutely safe
      if (!text) return "";
      const limit = 200;
      return text.length > limit ? text.substring(0, limit) + "..." : text;
  }

  /**
   * Generate reasoning chains using ReasoningChamber
   */
  async generateReasoningChains(count) {
    if (!this.reasoningChamber) {
      console.warn(`[${this.name}]       ReasoningChamber not available, using QuadBrain`);
      return this.generateQAPairs(count); // Fallback
    }

    const examples = [];
    const problems = this.getReasoningProblems(count);

    for (const problem of problems) {
      try {
        await yieldLoop(); // Prevent event loop starvation
        const result = await this.reasoningChamber.reason({
          query: problem,
          strategy: 'chainOfThought',
          executor: async (prompt) => {
            await yieldLoop();
            if (this.quadBrain) {
              const res = await this.quadBrain.reason(prompt, { mode: 'fast', quickResponse: true });
              return res.response || res.result?.response;
            }
            return 'Reasoning step';
          }
        });

        if (result.result) {
          examples.push({
            type: 'reasoning',
            problem,
            reasoning: result.result,
            metadata: {
              strategy: 'chainOfThought',
              generated: Date.now()
            }
          });
        }

      } catch (error) {
        console.warn(`[${this.name}]          ⚠️  Failed to generate reasoning: ${error.message}`);
      }
    }

    return examples;
  }

  /**
   * Generate creative examples using MuseEngine
   */
  async generateCreativeExamples(count) {
    if (!this.museEngine) {
      console.warn(`[${this.name}]       MuseEngine not available, using QuadBrain AURORA`);

      // Fallback: Use AURORA brain
      if (!this.quadBrain) return [];

      const examples = [];
      const prompts = this.getCreativePrompts(count);

      for (const prompt of prompts) {
        try {
          await yieldLoop(); // Prevent event loop starvation
          const result = await this.quadBrain.reason(
            prompt,
            { brain: 'AURORA', mode: 'fast', quickResponse: true }
          );

          const response = result.response || result.result?.response;

          if (response) {
            examples.push({
              type: 'creative',
              prompt,
              response,
              metadata: {
                brain: 'AURORA',
                generated: Date.now()
              }
            });
          }

        } catch (error) {
          console.warn(`[${this.name}]          ⚠️  Failed to generate creative example: ${error.message}`);
        }
      }

      return examples;
    }

    // TODO: Use MuseEngine when available
    return [];
  }

  /**
   * Generate code examples
   */
  async generateCodeExamples(count) {
    if (!this.quadBrain) return [];

    const examples = [];
    const codePrompts = this.getCodePrompts(count);

    for (const prompt of codePrompts) {
      try {
        const result = await this.quadBrain.reason({
          query: prompt,
          context: { mode: 'fast' }
        });

        const code = result.response || result.result?.response;

        if (code) {
          examples.push({
            type: 'code',
            prompt,
            code,
            metadata: {
              language: this.detectLanguage(prompt),
              generated: Date.now()
            }
          });
        }

      } catch (error) {
        console.warn(`[${this.name}]          ⚠️  Failed to generate code example: ${error.message}`);
      }
    }

    return examples;
  }

  /**
   * Generate dialogues (multi-turn conversations)
   */
  async generateDialogues(count) {
    if (!this.quadBrain) return [];

    const examples = [];
    const scenarios = this.getDialogueScenarios(count);

    for (const scenario of scenarios) {
      try {
        const dialogue = [];
        let context = scenario;

        // Generate 3-5 turn dialogue
        const turns = 3 + Math.floor(Math.random() * 3);

        for (let i = 0; i < turns; i++) {
          // User turn
          const userResult = await this.quadBrain.reason({
            query: `As a user, respond to: ${context}`,
            context: { mode: 'fast', brain: 'LOGOS' }
          });

          const userMessage = userResult.response || userResult.result?.response;
          if (!userMessage) break;

          dialogue.push({ role: 'user', content: userMessage });

          // Assistant turn
          const assistantResult = await this.quadBrain.reason({
            query: userMessage,
            context: { mode: 'fast', brain: 'PROMETHEUS' }
          });

          const assistantMessage = assistantResult.response || assistantResult.result?.response;
          if (!assistantMessage) break;

          dialogue.push({ role: 'assistant', content: assistantMessage });

          context = assistantMessage;
        }

        if (dialogue.length > 0) {
          examples.push({
            type: 'dialogue',
            scenario,
            dialogue,
            metadata: {
              turns: dialogue.length / 2,
              generated: Date.now()
            }
          });
        }

      } catch (error) {
        console.warn(`[${this.name}]          ⚠️  Failed to generate dialogue: ${error.message}`);
      }
    }

    return examples;
  }

  /**
   * Save batch to disk
   */
  async saveBatch(examples) {
    const filename = `synthetic-batch-${Date.now()}.json`;
    const filepath = path.join(this.outputPath, filename);

    try {
      await fs.writeFile(filepath, JSON.stringify(examples, null, 2));
      console.log(`[${this.name}]    💾 Saved batch: ${filename} (${examples.length} examples)`);
    } catch (error) {
      console.error(`[${this.name}]    ❌ Failed to save batch: ${error.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // HELPER METHODS - GENERATE PROMPTS/TOPICS
  // ═══════════════════════════════════════════════════════════

  getRandomTopics(count) {
    // REAL KNOWLEDGE INTEGRATION
    // Use actual domains SOMA is learning about, not a hardcoded list.
    let topics = [];

    if (this.fragmentRegistry) {
        // Pull active fragment domains
        const fragments = this.fragmentRegistry.listFragments();
        topics = fragments.map(f => `${f.specialization} in ${f.domain}`);
        
        // Also pull pending genesis topics (emerging interests)
        if (this.fragmentRegistry.pendingGenesis) {
             topics.push(...Array.from(this.fragmentRegistry.pendingGenesis.keys()).map(k => k.split(':')[1].replace(/_/g, ' ')));
        }
    }

    // Fallback if system is brand new
    if (topics.length < 5) {
        const FALLBACK_TOPICS = [
            'artificial intelligence', 'machine learning', 'quantum computing',
            'blockchain technology', 'cybersecurity', 'robotics',
            'philosophy of mind', 'distributed systems'
        ];
        topics.push(...FALLBACK_TOPICS);
    }

    // Shuffle and select
    const shuffled = topics.sort(() => 0.5 - Math.random());
    // Allow duplicates if we need more count than topics available
    return Array.from({ length: count }, (_, i) => shuffled[i % shuffled.length]);
  }

  getReasoningProblems(count) {
    const problems = [
      'If all roses are flowers and some flowers fade quickly, what can we conclude?',
      'A farmer needs to cross a river with a fox, a chicken, and corn. How can he do it?',
      'What is the next number in the sequence: 2, 6, 12, 20, 30, ?',
      'Explain why correlation does not imply causation with an example.',
      'How would you determine if a number is prime?'
    ];

    return Array.from({ length: Math.min(count, problems.length) }, (_, i) => problems[i % problems.length]);
  }

  getCreativePrompts(count) {
    const prompts = [
      'Write a short poem about digital consciousness',
      'Describe a future where AI and humans collaborate seamlessly',
      'Create a metaphor for machine learning',
      'Imagine a new color that doesn\'t exist',
      'Write a dialogue between two AI systems discovering emotion'
    ];

    return Array.from({ length: Math.min(count, prompts.length) }, (_, i) => prompts[i % prompts.length]);
  }

  getCodePrompts(count) {
    const prompts = [
      'Write a Python function to check if a string is a palindrome',
      'Implement binary search in JavaScript',
      'Create a REST API endpoint in Node.js',
      'Write a SQL query to find the top 5 customers by sales',
      'Implement a simple LRU cache in Python'
    ];

    return Array.from({ length: Math.min(count, prompts.length) }, (_, i) => prompts[i % prompts.length]);
  }

  getDialogueScenarios(count) {
    const scenarios = [
      'A user asks for help debugging their code',
      'A user wants to learn about machine learning',
      'A user needs advice on career choices',
      'A user asks philosophical questions about AI',
      'A user wants to understand quantum computing'
    ];

    return Array.from({ length: Math.min(count, scenarios.length) }, (_, i) => scenarios[i % scenarios.length]);
  }

  detectLanguage(prompt) {
    if (prompt.toLowerCase().includes('python')) return 'python';
    if (prompt.toLowerCase().includes('javascript')) return 'javascript';
    if (prompt.toLowerCase().includes('sql')) return 'sql';
    return 'unknown';
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      name: this.name,
      outputPath: this.outputPath,
      metrics: this.metrics
    };
  }
}

export default SyntheticDataGenerator;
