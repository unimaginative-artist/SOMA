/**
 * inspect-fragments.mjs
 *
 * Inspect SOMA's current fragment state
 * Shows specialist brains vs LLM training distinction
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('═'.repeat(80));
console.log('🧩 SOMA FRAGMENT INSPECTOR');
console.log('═'.repeat(80));
console.log();

async function loadFragments() {
  const fragmentPath = path.join(__dirname, '..', '.soma', 'fragments.json');

  try {
    const data = await fs.readFile(fragmentPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log('⚠️  No fragments file found (.soma/fragments.json)');
    console.log('   Fragments are created when SOMA runs and encounters patterns');
    console.log();
    return null;
  }
}

async function showFragmentArchitecture() {
  console.log('📐 FRAGMENT ARCHITECTURE');
  console.log('─'.repeat(80));
  console.log();
  console.log('QuadBrain (4 Pillars) → Specialist Fragments');
  console.log();
  console.log('LOGOS (Analytical)');
  console.log('  ├── Medical Diagnostics');
  console.log('  ├── Legal Analysis');
  console.log('  └── Code Analysis');
  console.log();
  console.log('AURORA (Creative)');
  console.log('  ├── Story Writing');
  console.log('  └── Art Generation');
  console.log();
  console.log('PROMETHEUS (Strategic)');
  console.log('  ├── Business Planning');
  console.log('  └── Project Management');
  console.log();
  console.log('THALAMUS (Safety)');
  console.log('  └── Content Moderation');
  console.log();
}

async function showFragmentVsTraining() {
  console.log('🎯 FRAGMENTS vs LLM TRAINING');
  console.log('─'.repeat(80));
  console.log();

  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ FRAGMENTS (Runtime Specialists)                             │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log('│ What:     System prompts + routing logic                    │');
  console.log('│ When:     Instant (created when needed)                     │');
  console.log('│ How:      Genesis (3 similar queries)                       │');
  console.log('│ Cost:     FREE (just text)                                  │');
  console.log('│ Purpose:  Domain specialization                             │');
  console.log('│ Example:  Medical fragment = "You are a medical expert..."  │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│ LLM TRAINING (Base Model Learning)                          │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log('│ What:     Fine-tune Llama model weights                     │');
  console.log('│ When:     4 AM every night                                  │');
  console.log('│ How:      LoRA training on experiences                      │');
  console.log('│ Cost:     EXPENSIVE (GPU hours)                             │');
  console.log('│ Purpose:  Foundational knowledge                            │');
  console.log('│ Example:  Model learns quantum mechanics concepts           │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log();
}

async function showFragmentBirthTriggers() {
  console.log('🧬 FRAGMENT BIRTH TRIGGERS');
  console.log('─'.repeat(80));
  console.log();

  console.log('1. GENESIS (Autonomous Creation)');
  console.log('   Trigger: 3 similar queries with NO matching fragment');
  console.log('   Example:');
  console.log('     • User asks about crypto trading 3 times');
  console.log('     • No crypto fragment exists');
  console.log('     • FragmentRegistry tracks pattern');
  console.log('     • PROMETHEUS designs new fragment structure');
  console.log('     • AURORA writes system prompt');
  console.log('     • 🧬 NEW FRAGMENT BORN!');
  console.log();

  console.log('2. MITOSIS (Cell Division)');
  console.log('   Trigger: Fragment handles 50+ queries (too broad)');
  console.log('   Example:');
  console.log('     • "programming_help" fragment too busy');
  console.log('     • LOGOS analyzes if it should split');
  console.log('     • Decision: Split into Python, JavaScript, C++');
  console.log('     • ➗ 1 fragment → 3 specialist fragments');
  console.log();

  console.log('3. NEUROPLASTICITY (Self-Optimization)');
  console.log('   Trigger: Fragment success rate < 80% after 20 queries');
  console.log('   Example:');
  console.log('     • Fragment performing poorly');
  console.log('     • AURORA rewrites system prompt');
  console.log('     • 🧠 Fragment optimizes itself!');
  console.log();
}

async function showCurrentFragments() {
  const fragmentData = await loadFragments();

  if (!fragmentData) {
    console.log('💡 How to create fragments:');
    console.log('   1. Start SOMA (QuadBrain system)');
    console.log('   2. Ask 3+ similar questions (e.g., about medicine)');
    console.log('   3. Watch Genesis create a medical fragment!');
    console.log();
    return;
  }

  console.log('📊 CURRENT FRAGMENTS');
  console.log('─'.repeat(80));
  console.log();

  const fragments = fragmentData.fragments || {};
  const fragmentList = Object.values(fragments);

  if (fragmentList.length === 0) {
    console.log('No fragments created yet');
    console.log();
    return;
  }

  console.log(`Total Fragments: ${fragmentList.length}`);
  console.log();

  // Group by pillar
  const byPillar = {
    LOGOS: [],
    AURORA: [],
    PROMETHEUS: [],
    THALAMUS: []
  };

  for (const fragment of fragmentList) {
    if (fragment.pillar && byPillar[fragment.pillar]) {
      byPillar[fragment.pillar].push(fragment);
    }
  }

  for (const [pillar, frags] of Object.entries(byPillar)) {
    if (frags.length === 0) continue;

    console.log(`${pillar} (${frags.length} fragments):`);
    for (const frag of frags) {
      const expertise = frag.expertiseLevel || 0;
      const queries = frag.stats?.queriesHandled || 0;
      const success = frag.stats?.successRate || 0;

      console.log(`  • ${frag.domain}/${frag.specialization}`);
      console.log(`    Expertise: ${(expertise * 100).toFixed(0)}% | Queries: ${queries} | Success: ${(success * 100).toFixed(0)}%`);
      console.log(`    Temperature: ${frag.temperature} | Active: ${frag.active ? 'Yes' : 'No'}`);

      if (frag.generated) {
        console.log(`    🧬 Genesis-created (autonomous birth)`);
      }
    }
    console.log();
  }

  // Show stats
  if (fragmentData.stats) {
    console.log('📈 Fragment Statistics:');
    console.log(`  Total Fragments: ${fragmentData.stats.totalFragments || 0}`);
    console.log(`  Active Fragments: ${fragmentData.stats.activeFragments || 0}`);
    console.log(`  Genesis Events: ${fragmentData.stats.genesisEvents || 0}`);
    console.log(`  Mitosis Events: ${fragmentData.stats.mitosisEvents || 0}`);
    console.log(`  Optimizations: ${fragmentData.stats.optimizations || 0}`);
    console.log();
  }
}

async function showTrainingSchedule() {
  console.log('🌙 LLM TRAINING SCHEDULE');
  console.log('─'.repeat(80));
  console.log();
  console.log('4:00 AM - GPU Training Session');
  console.log('  → Trains Llama on ALL experiences');
  console.log('  → Includes fragment usage data');
  console.log('  → Includes autonomous research');
  console.log('  → Includes conversation analysis');
  console.log('  → Takes 1-3 hours (GPU-intensive)');
  console.log();
  console.log('Result:');
  console.log('  ✅ Base model gets smarter');
  console.log('  ✅ Fragments benefit from better base model');
  console.log('  ✅ Fragment + Training = Expert-level responses');
  console.log();
}

async function main() {
  await showFragmentArchitecture();
  await showFragmentVsTraining();
  await showFragmentBirthTriggers();
  await showCurrentFragments();
  await showTrainingSchedule();

  console.log('═'.repeat(80));
  console.log('🎓 KEY TAKEAWAYS');
  console.log('═'.repeat(80));
  console.log();
  console.log('1. FRAGMENTS = Runtime specialists (instant birth, zero cost)');
  console.log('2. TRAINING = Foundational learning (4 AM, GPU-intensive)');
  console.log('3. Genesis creates new fragments when patterns emerge');
  console.log('4. Mitosis splits busy fragments into specialists');
  console.log('5. Fragments + Training = Complete intelligence');
  console.log();
  console.log('SOMA\'s "brains" (fragments) ARE the specialists!');
  console.log('LLM training provides the foundational knowledge they use.');
  console.log();
}

main().catch(console.error);
