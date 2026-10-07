/**
 * Quick Training Script
 *
 * Loads pre-built training datasets and trains SOMA
 *
 * Usage:
 *   node quick-train.mjs                    # Train on all datasets
 *   node quick-train.mjs quantum-physics    # Train on specific dataset
 *   node quick-train.mjs --autonomous 300   # Autonomous learning for 5 minutes
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  initializeSOMA,
  conversationalTraining,
  autonomousGrowth
} from './train-soma.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║                                                        ║');
console.log('║           ⚡ QUICK TRAIN SOMA ⚡                      ║');
console.log('║                                                        ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

/**
 * Load training dataset from file
 */
function loadDataset(name) {
  const dataPath = join(__dirname, 'training-data', `${name}.json`);
  try {
    const data = JSON.parse(readFileSync(dataPath, 'utf-8'));
    console.log(`✅ Loaded dataset: ${name} (${data.length} items)\n`);
    return data;
  } catch (error) {
    console.log(`❌ Could not load dataset: ${name}`);
    console.log(`   Make sure ${dataPath} exists\n`);
    return null;
  }
}

/**
 * Main training function
 */
async function main() {
  const args = process.argv.slice(2);

  // Initialize SOMA
  const system = await initializeSOMA();

  console.log('═══════════════════════════════════════════════════════\n');

  // Check for autonomous mode
  if (args.includes('--autonomous')) {
    const durationIndex = args.indexOf('--autonomous');
    const duration = parseInt(args[durationIndex + 1]) || 60;

    console.log(`🤖 AUTONOMOUS LEARNING MODE\n`);
    console.log(`Duration: ${duration} seconds\n`);
    console.log('═══════════════════════════════════════════════════════\n');

    await autonomousGrowth(system, duration);
    process.exit(0);
  }

  // Available datasets
  const availableDatasets = [
    'quantum-physics',
    'machine-learning',
    'medical-knowledge'
  ];

  // Determine which datasets to train on
  let datasetsToTrain = [];

  if (args.length === 0) {
    // No args - train on all datasets
    datasetsToTrain = availableDatasets;
    console.log('🎓 TRAINING ON ALL DATASETS\n');
  } else {
    // Specific dataset requested
    const requested = args[0];
    if (availableDatasets.includes(requested)) {
      datasetsToTrain = [requested];
      console.log(`🎓 TRAINING ON: ${requested}\n`);
    } else {
      console.log(`❌ Unknown dataset: ${requested}\n`);
      console.log(`Available datasets:`);
      availableDatasets.forEach(ds => console.log(`  - ${ds}`));
      console.log(`\nUsage:`);
      console.log(`  node quick-train.mjs                 # All datasets`);
      console.log(`  node quick-train.mjs quantum-physics # Specific dataset`);
      console.log(`  node quick-train.mjs --autonomous 300 # Autonomous mode\n`);
      process.exit(1);
    }
  }

  console.log('═══════════════════════════════════════════════════════\n');

  // Train on each dataset
  for (const datasetName of datasetsToTrain) {
    const data = loadDataset(datasetName);

    if (data) {
      console.log(`🏋️  Training on ${datasetName}...\n`);
      await conversationalTraining(system, data);
      console.log(`✅ ${datasetName} training complete!\n`);
      console.log('─────────────────────────────────────────────────────\n');
    }
  }

  // Show final statistics
  console.log('═══════════════════════════════════════════════════════\n');
  console.log('📊 FINAL STATISTICS\n');
  console.log('═══════════════════════════════════════════════════════\n');

  const fragments = system.fragmentRegistry.listFragments();
  console.log(`📦 Fragments: ${fragments.length}\n`);

  if (fragments.length > 0) {
    console.log('Fragment Details:');
    fragments
      .sort((a, b) => b.expertiseLevel - a.expertiseLevel)
      .forEach(f => {
        const expertise = (f.expertiseLevel * 100).toFixed(0);
        const success = (f.stats?.successRate ? (f.stats.successRate * 100).toFixed(0) : '0');
        const queries = f.stats?.queriesHandled || 0;
        const stage = getExpertiseStage(f.expertiseLevel);

        console.log(`  ${stage} ${f.domain.padEnd(25)} Expertise: ${expertise}%  Success: ${success}%  Queries: ${queries}`);
      });
    console.log('');
  }

  const learningStats = system.learningPipeline.getStats();
  console.log(`📚 Learning Pipeline:`);
  console.log(`  • Experiences: ${learningStats.totalExperiences}`);
  console.log(`  • Outcomes: ${learningStats.totalOutcomes}`);
  console.log(`  • Memories: ${learningStats.totalMemories}\n`);

  const metaParams = system.metaLearning.getMetaParameters();
  console.log(`🎓 Meta-Learning:`);
  console.log(`  • Learning Rate: ${metaParams.defaultLearningRate.toFixed(3)}`);
  console.log(`  • Exploration: ${(metaParams.explorationRate * 100).toFixed(0)}%\n`);

  const curiosityStats = system.curiosity.getStats();
  console.log(`🔍 Curiosity Engine:`);
  console.log(`  • Questions Generated: ${curiosityStats.questionsGenerated}`);
  console.log(`  • Knowledge Gaps: ${curiosityStats.knowledgeGaps}`);
  console.log(`  • Autonomous Learnings: ${curiosityStats.autonomousLearnings}\n`);

  console.log('═══════════════════════════════════════════════════════\n');
  console.log('✅ TRAINING COMPLETE!\n');
  console.log('SOMA is now smarter and ready to use.\n');
  console.log('Next steps:');
  console.log('  • Run more training: node quick-train.mjs');
  console.log('  • Autonomous growth: node quick-train.mjs --autonomous 3600');
  console.log('  • Test the system: node test-asi-foundation.mjs\n');
  console.log('═══════════════════════════════════════════════════════\n');

  process.exit(0);
}

/**
 * Get expertise stage emoji
 */
function getExpertiseStage(level) {
  if (level >= 0.8) return '⭐';
  if (level >= 0.6) return '🌲';
  if (level >= 0.4) return '🌳';
  if (level >= 0.2) return '🌿';
  return '🌱';
}

main().catch(error => {
  console.error('❌ Training failed:', error);
  process.exit(1);
});
