/**
 * SOMA Training System
 *
 * This script provides 5 methods to train SOMA and grow fragments:
 *
 * 1. Conversational Training - Feed Q&A pairs
 * 2. Document Ingestion - Feed PDFs/text/websites
 * 3. Task-Based Learning - Give problems to solve
 * 4. Domain Specialization - Train specific fragments
 * 5. Autonomous Growth - Let CuriosityEngine drive learning
 *
 * Usage:
 *   node train-soma.mjs --method conversational --topic "quantum physics"
 *   node train-soma.mjs --method documents --path ./docs
 *   node train-soma.mjs --method autonomous --duration 3600
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, readdirSync, statSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║                                                        ║');
console.log('║           🎓 SOMA TRAINING SYSTEM 🎓                  ║');
console.log('║                                                        ║');
console.log('║  Train SOMA and grow fractal intelligence            ║');
console.log('║                                                        ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

/**
 * Initialize SOMA system for training
 */
async function initializeSOMA() {
  console.log('📋 Initializing SOMA for training...\n');

  // Import core components
  const { UniversalLearningPipeline } = await import('./arbiters/UniversalLearningPipeline.js');
  const { FragmentRegistry } = await import('./arbiters/FragmentRegistry.js');
  const { MetaLearningEngine } = await import('./arbiters/MetaLearningEngine.js');
  const { CuriosityEngine } = await import('./arbiters/CuriosityEngine.js');
  const { RecursiveSelfModel } = await import('./arbiters/RecursiveSelfModel.js');
  const { SOMArbiterV3 } = await import('../arbiters/SOMArbiterV3.js');
  const { AdaptiveLearningRouter } = await import('./arbiters/AdaptiveLearningRouter.js');
  const MessageBrokerModule = await import('./core/MessageBroker.js');
  const MnemonicArbiterModule = await import('./arbiters/MnemonicArbiter.js');

  const messageBroker = MessageBrokerModule.default || MessageBrokerModule;
  const MnemonicArbiter = MnemonicArbiterModule.default || MnemonicArbiterModule.MnemonicArbiter;

  const system = {};

  system.messageBroker = messageBroker;

  // Initialize MnemonicArbiter
  system.mnemonic = new MnemonicArbiter({
    name: 'MnemonicArbiter',
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379'
  });
  await new Promise(resolve => system.mnemonic.once('initialized', resolve));
  console.log('✅ MnemonicArbiter ready\n');

  // Initialize Learning Pipeline
  system.learningPipeline = new UniversalLearningPipeline({
    name: 'UniversalLearningPipeline',
    maxExperiences: 100000,
    storageDir: join(__dirname, '.soma'),
    experienceThreshold: 100,
    timeThreshold: 3600000
  });
  await system.learningPipeline.initialize({
    mnemonic: system.mnemonic,
    planner: null,
    tribrain: null
  });
  console.log('✅ Learning Pipeline ready\n');

  // Initialize Meta-Learning
  system.metaLearning = new MetaLearningEngine({
    name: 'MetaLearningEngine',
    learningPipeline: system.learningPipeline,
    messageBroker: system.messageBroker
  });
  await system.metaLearning.initialize({
    experienceBuffer: system.learningPipeline.experienceBuffer,
    outcomeTracker: system.learningPipeline.outcomeTracker
  });
  console.log('✅ Meta-Learning Engine ready\n');

  // Initialize Router
  system.router = new AdaptiveLearningRouter({
    name: 'AdaptiveLearningRouter',
    mnemonic: system.mnemonic,
    contextWindow: 5
  });
  console.log('✅ Router ready\n');

  // Initialize FragmentRegistry
  system.fragmentRegistry = new FragmentRegistry({
    name: 'FragmentRegistry',
    learningPipeline: system.learningPipeline,
    metaLearning: system.metaLearning,
    mnemonic: system.mnemonic,
    maxFragmentsPerPillar: 50 // Increased for training
  });
  await system.fragmentRegistry.initialize();
  console.log('✅ FragmentRegistry ready\n');

  // Initialize QuadBrain (V3 Unified)
  system.quadBrain = new SOMArbiterV3({
    name: 'QuadBrain',
    router: system.router,
    mnemonic: system.mnemonic,
    messageBroker: system.messageBroker,
    learningPipeline: system.learningPipeline,
    fragmentRegistry: system.fragmentRegistry
  });
  console.log('✅ QuadBrain ready (SOMArbiterV3)\n');

  // Initialize Self-Model
  system.selfModel = new RecursiveSelfModel({
    name: 'RecursiveSelfModel',
    messageBroker: system.messageBroker,
    learningPipeline: system.learningPipeline
  });
  await system.selfModel.initialize(system);
  console.log('✅ Self-Model ready\n');

  // Initialize Curiosity Engine
  system.curiosity = new CuriosityEngine({
    name: 'CuriosityEngine',
    selfModel: system.selfModel,
    knowledgeGraph: null, // Not needed for basic training
    fragmentRegistry: system.fragmentRegistry,
    learningPipeline: system.learningPipeline,
    messageBroker: system.messageBroker
  });
  await system.curiosity.initialize();
  console.log('✅ Curiosity Engine ready\n');

  console.log('═══════════════════════════════════════════════════════\n');
  console.log('🎉 SOMA TRAINING SYSTEM READY!\n');

  return system;
}

/**
 * METHOD 1: Conversational Training
 * Feed SOMA question-answer pairs to train specific domains
 */
async function conversationalTraining(system, trainingData) {
  console.log('\n🗣️  METHOD 1: CONVERSATIONAL TRAINING\n');
  console.log(`Training on ${trainingData.length} conversations...\n`);

  for (const item of trainingData) {
    const { question, answer, domain, difficulty, importance } = item;

    console.log(`Q: ${question}`);

    // Route to appropriate pillar/fragment
    const pillar = determinePillar(question);
    const fragmentRoute = await system.fragmentRegistry.routeToFragment(question, pillar);

    // Record interaction
    const interaction = {
      agent: fragmentRoute?.fragment?.id || pillar,
      type: 'training_conversation',
      input: question,
      output: answer,
      context: { domain, difficulty },
      metadata: {
        success: true,
        userSatisfaction: importance || 0.8,
        taskCompleted: true,
        efficient: true,
        domain,
        trainingMode: true
      },
      timestamp: Date.now()
    };

    // Learn from interaction
    await system.learningPipeline.logInteraction(interaction);

    // Update fragment stats if routed to fragment
    if (fragmentRoute?.fragment) {
      await system.fragmentRegistry.recordFragmentOutcome(fragmentRoute.fragment.id, {
        success: true,
        confidence: fragmentRoute.confidence,
        reward: importance || 0.8
      });

      console.log(`   ✓ Fragment trained: ${fragmentRoute.fragment.domain} (expertise: ${(fragmentRoute.fragment.expertiseLevel * 100).toFixed(0)}%)\n`);
    } else {
      console.log(`   ✓ Pillar trained: ${pillar}\n`);
    }
  }

  console.log(`✅ Conversational training complete - ${trainingData.length} interactions recorded\n`);
}

/**
 * METHOD 2: Document Ingestion
 * Feed SOMA documents to learn from
 */
async function documentIngestion(system, documents) {
  console.log('\n📚 METHOD 2: DOCUMENT INGESTION\n');
  console.log(`Processing ${documents.length} documents...\n`);

  for (const doc of documents) {
    const { title, content, domain, category } = doc;

    console.log(`📄 Processing: ${title}`);

    // Chunk document into learnable segments
    const chunks = chunkText(content, 500); // 500 char chunks

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];

      // Determine pillar from content
      const pillar = determinePillar(chunk);

      // Record as learning interaction
      const interaction = {
        agent: `${pillar}_document_learner`,
        type: 'document_ingestion',
        input: `Learn from: ${title} (part ${i + 1}/${chunks.length})`,
        output: chunk,
        context: { domain, category, documentTitle: title },
        metadata: {
          success: true,
          userSatisfaction: 0.7,
          taskCompleted: true,
          domain,
          documentIngestion: true
        },
        timestamp: Date.now()
      };

      await system.learningPipeline.logInteraction(interaction);
    }

    console.log(`   ✓ Learned ${chunks.length} chunks from "${title}"\n`);
  }

  console.log(`✅ Document ingestion complete - processed ${documents.length} documents\n`);
}

/**
 * METHOD 3: Task-Based Learning
 * Give SOMA problems to solve and learn from results
 */
async function taskBasedLearning(system, tasks) {
  console.log('\n🎯 METHOD 3: TASK-BASED LEARNING\n');
  console.log(`Running ${tasks.length} learning tasks...\n`);

  for (const task of tasks) {
    const { description, solution, domain, difficulty, taskType } = task;

    console.log(`🔧 Task: ${description}`);

    // Route to fragment
    const pillar = determinePillar(description);
    const fragmentRoute = await system.fragmentRegistry.routeToFragment(description, pillar);

    // Simulate task execution (in real system, would actually execute)
    const success = Math.random() > (difficulty || 0.3); // Success rate based on difficulty

    // Record outcome
    const interaction = {
      agent: fragmentRoute?.fragment?.id || pillar,
      type: 'task_execution',
      input: description,
      output: solution,
      context: { domain, taskType, difficulty },
      metadata: {
        success,
        userSatisfaction: success ? 0.9 : 0.3,
        taskCompleted: success,
        efficient: success,
        domain,
        taskType
      },
      timestamp: Date.now()
    };

    await system.learningPipeline.logInteraction(interaction);

    if (fragmentRoute?.fragment) {
      await system.fragmentRegistry.recordFragmentOutcome(fragmentRoute.fragment.id, {
        success,
        confidence: fragmentRoute.confidence,
        reward: success ? 1.0 : 0.2
      });

      console.log(`   ${success ? '✓' : '✗'} Fragment performance: ${fragmentRoute.fragment.domain} (success rate: ${(fragmentRoute.fragment.stats.successRate * 100).toFixed(0)}%)\n`);
    }
  }

  console.log(`✅ Task-based learning complete - ${tasks.length} tasks executed\n`);
}

/**
 * METHOD 4: Domain Specialization
 * Train specific fragments to become experts
 */
async function domainSpecialization(system, domain, trainingSet) {
  console.log('\n🎓 METHOD 4: DOMAIN SPECIALIZATION\n');
  console.log(`Specializing in: ${domain}\n`);

  // Check if fragment exists for domain
  const fragments = system.fragmentRegistry.listFragments();
  let targetFragment = fragments.find(f => f.domain === domain);

  if (!targetFragment) {
    console.log(`Creating new fragment for domain: ${domain}...\n`);
    // Fragment will be created automatically on first use
  }

  // Train intensively on domain-specific data
  for (const item of trainingSet) {
    const pillar = determinePillar(item.content);
    const fragmentRoute = await system.fragmentRegistry.routeToFragment(item.content, pillar);

    const interaction = {
      agent: fragmentRoute?.fragment?.id || `${domain}_specialist`,
      type: 'domain_specialization',
      input: item.query || item.content,
      output: item.response || item.content,
      context: { domain, specialization: true },
      metadata: {
        success: true,
        userSatisfaction: 0.9,
        taskCompleted: true,
        efficient: true,
        domain,
        specialization: true
      },
      timestamp: Date.now()
    };

    await system.learningPipeline.logInteraction(interaction);

    if (fragmentRoute?.fragment) {
      await system.fragmentRegistry.recordFragmentOutcome(fragmentRoute.fragment.id, {
        success: true,
        confidence: 0.9,
        reward: 1.0
      });
    }
  }

  // Check final expertise
  const updatedFragments = system.fragmentRegistry.listFragments();
  targetFragment = updatedFragments.find(f => f.domain === domain);

  if (targetFragment) {
    console.log(`\n✅ Domain specialization complete!`);
    console.log(`   Domain: ${targetFragment.domain}`);
    console.log(`   Expertise: ${(targetFragment.expertiseLevel * 100).toFixed(0)}%`);
    console.log(`   Success Rate: ${(targetFragment.stats.successRate * 100).toFixed(0)}%`);
    console.log(`   Queries Handled: ${targetFragment.stats.queriesHandled}\n`);
  }
}

/**
 * METHOD 5: Autonomous Growth
 * Let CuriosityEngine drive learning
 */
async function autonomousGrowth(system, durationSeconds) {
  console.log('\n🤖 METHOD 5: AUTONOMOUS GROWTH\n');
  console.log(`Running autonomous learning for ${durationSeconds} seconds...\n`);
  console.log('CuriosityEngine will:');
  console.log('  • Detect knowledge gaps');
  console.log('  • Generate curious questions');
  console.log('  • Explore autonomously');
  console.log('  • Spawn fragments as needed\n');

  const startTime = Date.now();
  const endTime = startTime + (durationSeconds * 1000);

  let explorationCount = 0;

  while (Date.now() < endTime) {
    // Let curiosity engine explore
    const exploration = await system.curiosity.explore();

    if (exploration) {
      explorationCount++;
      console.log(`[${new Date().toLocaleTimeString()}] Explored: "${exploration.question}"`);
      console.log(`   Type: ${exploration.type}\n`);
    }

    // Wait before next exploration
    await new Promise(resolve => setTimeout(resolve, 5000)); // Every 5 seconds
  }

  const stats = system.curiosity.getStats();
  console.log(`\n✅ Autonomous growth complete!`);
  console.log(`   Explorations: ${explorationCount}`);
  console.log(`   Questions generated: ${stats.questionsGenerated}`);
  console.log(`   Knowledge gaps identified: ${stats.knowledgeGaps}`);
  console.log(`   Autonomous learnings: ${stats.autonomousLearnings}\n`);
}

/**
 * Helper: Determine pillar from content
 */
function determinePillar(content) {
  const contentLower = content.toLowerCase();

  // LOGOS - Logic, reasoning, analysis
  if (contentLower.match(/logic|reason|analy|deduc|proof|argument|rational/)) {
    return 'LOGOS';
  }

  // AURORA - Creativity, innovation, exploration
  if (contentLower.match(/creat|innovat|design|art|imagin|novel|explor/)) {
    return 'AURORA';
  }

  // THALAMUS - Integration, synthesis, decision
  if (contentLower.match(/integrat|synthes|decid|combin|balanc|weigh|evaluat/)) {
    return 'THALAMUS';
  }

  // PROMETHEUS - Action, execution, implementation
  if (contentLower.match(/action|execut|implement|build|code|do|perform|produc/)) {
    return 'PROMETHEUS';
  }

  // Default to LOGOS
  return 'LOGOS';
}

/**
 * Helper: Chunk text into smaller pieces
 */
function chunkText(text, maxChunkSize) {
  const chunks = [];
  const sentences = text.split(/[.!?]+/);

  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence;
    } else {
      currentChunk += sentence + '. ';
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

/**
 * EXAMPLE TRAINING DATASETS
 */

const EXAMPLE_CONVERSATIONS = [
  {
    question: "What is quantum entanglement?",
    answer: "Quantum entanglement is a physical phenomenon where pairs of particles become correlated such that the quantum state of one particle cannot be described independently of the others.",
    domain: "physics",
    difficulty: 0.7,
    importance: 0.9
  },
  {
    question: "How does a neural network learn?",
    answer: "Neural networks learn through backpropagation, where errors are propagated backward through the network to adjust weights using gradient descent.",
    domain: "machine_learning",
    difficulty: 0.6,
    importance: 0.85
  },
  {
    question: "What causes climate change?",
    answer: "Climate change is primarily caused by greenhouse gas emissions from human activities, particularly the burning of fossil fuels, deforestation, and industrial processes.",
    domain: "environmental_science",
    difficulty: 0.5,
    importance: 0.95
  }
];

const EXAMPLE_DOCUMENTS = [
  {
    title: "Introduction to Reinforcement Learning",
    content: "Reinforcement learning is a type of machine learning where an agent learns to make decisions by interacting with an environment. The agent receives rewards or penalties based on its actions and learns to maximize cumulative reward over time. Key concepts include states, actions, rewards, policies, and value functions.",
    domain: "machine_learning",
    category: "AI"
  }
];

const EXAMPLE_TASKS = [
  {
    description: "Calculate the factorial of 10",
    solution: "3628800",
    domain: "mathematics",
    difficulty: 0.2,
    taskType: "computation"
  },
  {
    description: "Analyze sentiment of: 'This product is amazing!'",
    solution: "Positive sentiment (score: 0.95)",
    domain: "NLP",
    difficulty: 0.4,
    taskType: "classification"
  }
];

/**
 * Main training function
 */
async function main() {
  const args = process.argv.slice(2);
  const method = args.find(a => a.startsWith('--method='))?.split('=')[1] || 'all';

  try {
    const system = await initializeSOMA();

    console.log('═══════════════════════════════════════════════════════\n');
    console.log('🏋️  STARTING TRAINING SESSION\n');
    console.log('═══════════════════════════════════════════════════════\n');

    if (method === 'all' || method === 'conversational') {
      await conversationalTraining(system, EXAMPLE_CONVERSATIONS);
    }

    if (method === 'all' || method === 'documents') {
      await documentIngestion(system, EXAMPLE_DOCUMENTS);
    }

    if (method === 'all' || method === 'tasks') {
      await taskBasedLearning(system, EXAMPLE_TASKS);
    }

    if (method === 'all' || method === 'specialization') {
      await domainSpecialization(system, 'quantum_physics', [
        { content: "Quantum mechanics governs the behavior of particles at atomic scales.", query: "What is quantum mechanics?" },
        { content: "The Heisenberg uncertainty principle states you cannot know both position and momentum precisely.", query: "Explain uncertainty principle" }
      ]);
    }

    if (method === 'autonomous') {
      const duration = parseInt(args.find(a => a.startsWith('--duration='))?.split('=')[1]) || 60;
      await autonomousGrowth(system, duration);
    }

    // Final stats
    console.log('\n═══════════════════════════════════════════════════════\n');
    console.log('📊 FINAL TRAINING STATISTICS\n');
    console.log('═══════════════════════════════════════════════════════\n');

    const fragments = system.fragmentRegistry.listFragments();
    console.log(`Total Fragments: ${fragments.length}`);
    console.log(`\nFragment Details:`);
    fragments.forEach(f => {
      console.log(`  • ${f.domain}: ${(f.expertiseLevel * 100).toFixed(0)}% expertise, ${f.stats.queriesHandled} queries, ${(f.stats.successRate * 100).toFixed(0)}% success`);
    });

    const learningStats = system.learningPipeline.getStats();
    console.log(`\nLearning Pipeline:`);
    console.log(`  • Total experiences: ${learningStats.totalExperiences}`);
    console.log(`  • Total outcomes: ${learningStats.totalOutcomes}`);
    console.log(`  • Total memories: ${learningStats.totalMemories}`);

    const curiosityStats = system.curiosity.getStats();
    console.log(`\nCuriosity Engine:`);
    console.log(`  • Questions generated: ${curiosityStats.questionsGenerated}`);
    console.log(`  • Knowledge gaps: ${curiosityStats.knowledgeGaps}`);
    console.log(`  • Autonomous learnings: ${curiosityStats.autonomousLearnings}`);

    console.log('\n═══════════════════════════════════════════════════════\n');
    console.log('✅ TRAINING SESSION COMPLETE!\n');
    console.log('SOMA has learned and grown. Fragments are more expert.\n');
    console.log('═══════════════════════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Training failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export {
  initializeSOMA,
  conversationalTraining,
  documentIngestion,
  taskBasedLearning,
  domainSpecialization,
  autonomousGrowth
};
