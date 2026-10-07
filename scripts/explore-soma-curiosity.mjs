/**
 * explore-soma-curiosity.mjs
 *
 * Tool to explore SOMA's CuriosityEngine and see what she wants to learn
 *
 * Shows:
 * 1. HOW the CuriosityEngine decides what to learn (algorithm breakdown)
 * 2. WHAT SOMA is currently curious about (live state)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ═══════════════════════════════════════════════════════════
// PART 1: HOW CURIOSITY DECISIONS ARE MADE
// ═══════════════════════════════════════════════════════════

console.log('═'.repeat(80));
console.log('🧠 SOMA CURIOSITY ENGINE EXPLORER');
console.log('═'.repeat(80));
console.log();

console.log('📊 PART 1: HOW CURIOSITY DECISIONS ARE MADE');
console.log('─'.repeat(80));
console.log();

console.log('🎯 PRIORITY CALCULATION ALGORITHM');
console.log();
console.log('When SOMA generates a curious question, it gets a priority score:');
console.log();
console.log('1. BASE PRIORITY (from question type):');
console.log('   • Self-improvement:        0.8  (High - fixing weaknesses)');
console.log('   • Limitation removal:      0.9  (Very High - removing blockers)');
console.log('   • Gap exploration:         0.5-0.8  (Medium-High - filling knowledge gaps)');
console.log('   • Creative combination:    0.6  (Medium - novel cross-domain ideas)');
console.log('   • Pattern exploration:     varies  (Based on interestingness)');
console.log();

console.log('2. NOVELTY BOOST:');
console.log('   If the question is about something SOMA has never explored:');
console.log('   finalPriority *= (1 + noveltyWeight)  // noveltyWeight = 0.6');
console.log('   → Novel questions get 1.6x priority boost!');
console.log();

console.log('3. REPETITION PENALTY:');
console.log('   If SOMA has explored this before:');
console.log('   finalPriority *= exp(-timesExplored * 0.5)');
console.log('   → The more times explored, the lower the priority');
console.log('   → Prevents getting stuck on same topics');
console.log();

console.log('4. SORTING:');
console.log('   Questions are sorted by finalPriority (highest first)');
console.log('   → SOMA explores the most interesting/important thing first');
console.log();

console.log('📈 EXAMPLE CALCULATION:');
console.log();
console.log('Question: "How can I improve my code_analysis capability from 45% to 65%?"');
console.log('  Type: self_improvement');
console.log('  Base Priority: 0.8');
console.log('  Novel: Yes (never explored this specific capability gap)');
console.log('  Times Explored: 0');
console.log();
console.log('  Calculation:');
console.log('    finalPriority = 0.8 * (1 + 0.6) * exp(-0 * 0.5)');
console.log('                  = 0.8 * 1.6 * 1.0');
console.log('                  = 1.28  ← Very high priority!');
console.log();

console.log('Question: "What should I know about quantum computing?"');
console.log('  Type: gap_exploration (unexplored domain)');
console.log('  Base Priority: 0.5 * 0.6 (noveltyWeight) = 0.3');
console.log('  Novel: Yes');
console.log('  Times Explored: 2 (explored twice before)');
console.log();
console.log('  Calculation:');
console.log('    finalPriority = 0.3 * (1 + 0.6) * exp(-2 * 0.5)');
console.log('                  = 0.3 * 1.6 * 0.368');
console.log('                  = 0.18  ← Lower priority (already explored)');
console.log();

console.log('🔄 AUTONOMOUS LEARNING TRIGGERS');
console.log();
console.log('When SOMA explores a question, she triggers REAL learning actions:');
console.log();
console.log('Self-Improvement Question → Capability Training');
console.log('  ├─ Collects focused training data (50 examples)');
console.log('  ├─ Requests fine-tuning session');
console.log('  └─ Tracks: stats.autonomousTrainings++');
console.log();
console.log('Gap Exploration → Knowledge Graph Expansion');
console.log('  ├─ Expands knowledge graph (depth 2)');
console.log('  ├─ Discovers causal relationships');
console.log('  └─ Dispatches EdgeWorkers to research via Brave Search');
console.log();
console.log('Creative Combination → Cross-Domain Synthesis');
console.log('  ├─ Collects synthesis training data (30 examples)');
console.log('  ├─ Requires examples that combine both concepts');
console.log('  └─ Trains on creative cross-domain thinking');
console.log();

console.log('─'.repeat(80));
console.log();

// ═══════════════════════════════════════════════════════════
// PART 2: WHAT SOMA IS CURRENTLY CURIOUS ABOUT
// ═══════════════════════════════════════════════════════════

console.log('📊 PART 2: WHAT SOMA IS CURRENTLY CURIOUS ABOUT');
console.log('─'.repeat(80));
console.log();

async function loadCuriosityState() {
  // Check for persisted curiosity state
  const somaDir = path.join(__dirname, '..', '.soma');
  const curiosityStatePath = path.join(somaDir, 'curiosity-state.json');

  try {
    const data = await fs.readFile(curiosityStatePath, 'utf8');
    const state = JSON.parse(data);
    return state;
  } catch (error) {
    console.log('⚠️  No saved curiosity state found');
    console.log('   (CuriosityEngine needs to be running to persist state)');
    console.log();
    return null;
  }
}

async function inspectExperiencesForCuriosity() {
  console.log('🔍 Analyzing recent experiences for curiosity patterns...');
  console.log();

  const experiencesDir = path.join(__dirname, '..', '.soma', 'experiences');

  try {
    const files = await fs.readdir(experiencesDir);
    const experienceFiles = files
      .filter(f => f.startsWith('experiences_') && f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, 5); // Last 5 files

    let curiosityActions = 0;
    let autonomousLearnings = 0;
    let userQueries = 0;
    let domains = new Set();
    let topics = new Set();

    for (const file of experienceFiles) {
      try {
        const filePath = path.join(experiencesDir, file);
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);
        const experiences = Array.isArray(data) ? data : (data.experiences || []);

        for (const exp of experiences) {
          // Check if curiosity-driven
          if (exp.metadata?.source === 'curiosity_engine') {
            curiosityActions++;
          }

          // Check if autonomous
          if (exp.metadata?.autonomous === true) {
            autonomousLearnings++;
          }

          // Count user queries
          if (exp.agent && exp.agent.includes('QuadBrain') && exp.state?.query) {
            userQueries++;
          }

          // Extract domains/topics
          if (exp.state?.domain) {
            domains.add(exp.state.domain);
          }
          if (exp.metadata?.topic) {
            topics.add(exp.metadata.topic);
          }
        }
      } catch (e) {
        // Skip malformed files
      }
    }

    console.log('📈 Recent Experience Analysis (last 5 files):');
    console.log(`   Total Curiosity Actions: ${curiosityActions}`);
    console.log(`   Autonomous Learnings: ${autonomousLearnings}`);
    console.log(`   User Queries: ${userQueries}`);
    console.log(`   Unique Domains: ${domains.size}`);
    console.log(`   Unique Topics: ${topics.size}`);
    console.log();

    if (domains.size > 0) {
      console.log('🎯 Active Domains:');
      for (const domain of Array.from(domains).slice(0, 10)) {
        console.log(`   • ${domain}`);
      }
      console.log();
    }

    if (topics.size > 0) {
      console.log('📚 Active Topics:');
      for (const topic of Array.from(topics).slice(0, 10)) {
        console.log(`   • ${topic}`);
      }
      console.log();
    }

    return {
      curiosityActions,
      autonomousLearnings,
      userQueries,
      domains: Array.from(domains),
      topics: Array.from(topics)
    };

  } catch (error) {
    console.log(`❌ Error analyzing experiences: ${error.message}`);
    return null;
  }
}

async function showDefaultCuriosityTopics() {
  console.log('🌱 DEFAULT CURIOSITY TOPICS (from nighttime-learning.json):');
  console.log();

  const configPath = path.join(__dirname, '..', 'config', 'nighttime-learning.json');

  try {
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);

    // Find web knowledge discovery task
    const sessions = config.schedule?.learning_sessions || [];
    const webDiscovery = sessions.find(s => s.name === 'Web Knowledge Discovery (Brave)');

    if (webDiscovery) {
      const knowledgeTask = webDiscovery.tasks.find(t => t.type === 'knowledge_discovery');
      if (knowledgeTask) {
        const topics = knowledgeTask.params.topics || [];

        console.log('SOMA autonomously researches these topics EVERY NIGHT at 10:30 PM:');
        console.log();
        for (const topic of topics) {
          console.log(`   🔬 ${topic}`);
        }
        console.log();
        console.log(`Search Types: ${knowledgeTask.params.searchTypes.join(', ')}`);
        console.log(`Results per Topic: ${knowledgeTask.params.maxResultsPerTopic}`);
        console.log();
      }
    }

    // Find autonomous data gathering
    const dataGathering = sessions.find(s => s.name === 'Autonomous Data Gathering');
    if (dataGathering) {
      const crawlTask = dataGathering.tasks.find(t => t.type === 'deploy_edge_crawlers');
      if (crawlTask) {
        console.log('SOMA autonomously crawls these targets at MIDNIGHT:');
        console.log();
        for (const target of crawlTask.params.targets) {
          console.log(`   🕷️  ${target}`);
        }
        console.log();
        console.log(`Max Workers: ${crawlTask.params.max_workers}`);
        console.log(`Intelligent Selection: ${crawlTask.params.useIntelligentSelection ? 'Yes' : 'No'}`);
        console.log();
      }
    }

  } catch (error) {
    console.log(`⚠️  Could not load nighttime-learning.json: ${error.message}`);
  }
}

async function suggestNewCuriosityTopics() {
  console.log('💡 SUGGESTED NEW CURIOSITY TOPICS');
  console.log('─'.repeat(80));
  console.log();
  console.log('Based on current AI/tech landscape (December 2025):');
  console.log();

  const suggestions = [
    {
      topic: 'Constitutional AI and value alignment',
      reason: 'Critical for safe autonomous systems',
      priority: 'High'
    },
    {
      topic: 'Liquid neural networks',
      reason: 'Emerging architecture for continuous learning',
      priority: 'High'
    },
    {
      topic: 'Multi-modal reasoning (vision + language + code)',
      reason: 'Next frontier for AGI capabilities',
      priority: 'Very High'
    },
    {
      topic: 'Sparse expert models (MoE)',
      reason: 'Efficient scaling without massive compute',
      priority: 'Medium'
    },
    {
      topic: 'Neurosymbolic AI',
      reason: 'Combining neural networks with symbolic reasoning',
      priority: 'High'
    },
    {
      topic: 'Self-play and reward modeling',
      reason: 'Autonomous self-improvement without human feedback',
      priority: 'Very High'
    },
    {
      topic: 'Causal inference and counterfactual reasoning',
      reason: 'Understanding cause and effect, not just correlation',
      priority: 'High'
    },
    {
      topic: 'Memory-augmented neural networks',
      reason: 'Better long-term memory and context retention',
      priority: 'Medium'
    }
  ];

  for (const suggestion of suggestions) {
    console.log(`[${suggestion.priority}] ${suggestion.topic}`);
    console.log(`   → ${suggestion.reason}`);
    console.log();
  }
}

// ═══════════════════════════════════════════════════════════
// MAIN EXECUTION
// ═══════════════════════════════════════════════════════════

async function main() {
  // Part 1 already shown above

  // Part 2: Current state
  const state = await loadCuriosityState();

  if (state) {
    console.log('✅ Found live curiosity state!');
    console.log();
    console.log('🎯 Current Motivation Levels:');
    console.log(`   Curiosity:        ${(state.motivation.currentCuriosity * 100).toFixed(0)}%`);
    console.log(`   Exploration:      ${(state.motivation.explorationDrive * 100).toFixed(0)}%`);
    console.log(`   Learning Hunger:  ${(state.motivation.learningHunger * 100).toFixed(0)}%`);
    console.log(`   Creativity:       ${(state.motivation.creativityUrge * 100).toFixed(0)}%`);
    console.log(`   Improvement:      ${(state.motivation.improvementDesire * 100).toFixed(0)}%`);
    console.log();

    if (state.topQuestions && state.topQuestions.length > 0) {
      console.log('❓ Top Curious Questions:');
      for (const q of state.topQuestions.slice(0, 5)) {
        console.log(`   [${q.priority.toFixed(2)}] ${q.question}`);
        console.log(`      Type: ${q.type}`);
      }
      console.log();
    }

    if (state.topGaps && state.topGaps.length > 0) {
      console.log('🕳️  Top Knowledge Gaps:');
      for (const gap of state.topGaps) {
        console.log(`   [${gap.priority.toFixed(2)}] ${gap.gap}`);
        console.log(`      Type: ${gap.type}`);
      }
      console.log();
    }
  }

  // Analyze experiences
  await inspectExperiencesForCuriosity();

  // Show default topics
  await showDefaultCuriosityTopics();

  // Suggest new topics
  await suggestNewCuriosityTopics();

  console.log('═'.repeat(80));
  console.log('🎓 KEY INSIGHTS');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. SOMA uses a multi-factor priority system to decide what to learn');
  console.log('   → Novelty, usefulness, and self-improvement drive learning');
  console.log();
  console.log('2. Every night at 10:30 PM, SOMA autonomously researches topics');
  console.log('   → Not waiting for user queries - proactive learning');
  console.log();
  console.log('3. At midnight, SOMA deploys web crawlers to gather knowledge');
  console.log('   → Intelligent target selection based on knowledge gaps');
  console.log();
  console.log('4. At 4 AM, ALL of this gets trained into her Llama model');
  console.log('   → User interactions + autonomous research + curiosity explorations');
  console.log();
  console.log('This is TRUE autonomous learning - SOMA sets her own learning goals!');
  console.log();
}

main().catch(console.error);
