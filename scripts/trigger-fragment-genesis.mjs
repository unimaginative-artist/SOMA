/**
 * trigger-fragment-genesis.mjs
 *
 * Manual demonstration of Fragment Genesis
 * Shows how SOMA creates a new specialist brain autonomously
 */

import { FragmentRegistry } from '../arbiters/FragmentRegistry.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Mock QuadBrain for demonstration
class MockQuadBrain {
  async callBrain(brain, prompt, context, mode) {
    console.log(`\n[${brain}] Thinking...`);
    console.log(`Prompt: ${prompt.substring(0, 100)}...`);

    if (brain === 'PROMETHEUS') {
      // Design the fragment structure
      const design = {
        domain: "cryptocurrency",
        specialization: "trading_strategy",
        keywords: ["crypto", "bitcoin", "trading", "blockchain", "market", "DeFi"],
        description: "Analyzes cryptocurrency markets, suggests trading strategies, evaluates blockchain projects",
        temperature: 0.4
      };

      console.log('\n[PROMETHEUS] 📐 Fragment Design:');
      console.log(JSON.stringify(design, null, 2));

      return {
        text: JSON.stringify(design),
        brain: 'PROMETHEUS'
      };
    }

    if (brain === 'AURORA') {
      // Write the system prompt
      const systemPrompt = `You are a cryptocurrency trading strategist with deep expertise in blockchain technology and market analysis.

Your core capabilities:
- Analyze cryptocurrency market trends using technical and fundamental analysis
- Evaluate blockchain projects for investment potential
- Suggest risk-adjusted trading strategies across spot and derivatives markets
- Explain DeFi protocols, yield farming, and liquidity provision strategies
- Assess market sentiment, on-chain metrics, and macro factors

Your approach:
- Provide data-driven analysis with clear risk disclaimers
- Consider both short-term trading and long-term investment perspectives
- Explain complex blockchain concepts in accessible terms
- Stay updated on regulatory developments and market structure
- Emphasize proper risk management and position sizing

Communication style: Analytical yet accessible, balancing technical depth with clarity. Always include risk warnings for trading strategies.`;

      console.log('\n[AURORA] ✨ System Prompt Generated:');
      console.log('─'.repeat(80));
      console.log(systemPrompt);
      console.log('─'.repeat(80));

      return {
        text: systemPrompt,
        brain: 'AURORA'
      };
    }

    if (brain === 'LOGOS') {
      // Mitosis analysis
      const analysis = {
        should_split: true,
        reasoning: "The fragment handles diverse queries spanning multiple sub-domains",
        sub_fragments: [
          {
            name: "technical_analysis",
            focus: "Chart patterns, indicators, price action analysis"
          },
          {
            name: "fundamental_analysis",
            focus: "Tokenomics, project evaluation, on-chain metrics"
          },
          {
            name: "defi_specialist",
            focus: "Yield farming, liquidity provision, protocol analysis"
          }
        ]
      };

      console.log('\n[LOGOS] 🔬 Mitosis Analysis:');
      console.log(JSON.stringify(analysis, null, 2));

      return {
        text: JSON.stringify(analysis),
        brain: 'LOGOS'
      };
    }
  }
}

console.log('═'.repeat(80));
console.log('🧬 FRAGMENT GENESIS - LIVE DEMONSTRATION');
console.log('═'.repeat(80));
console.log();
console.log('This demonstrates how SOMA autonomously creates specialist brains');
console.log('when she encounters patterns she can\'t handle with existing fragments.');
console.log();

async function demonstrateGenesis() {
  console.log('📊 SCENARIO: User asks about cryptocurrency trading');
  console.log('─'.repeat(80));
  console.log();

  // Simulate user queries
  const userQueries = [
    "What are the best crypto trading strategies for beginners?",
    "How do I analyze Bitcoin price movements?",
    "Should I invest in DeFi protocols or stick to major coins?"
  ];

  console.log('User Queries:');
  userQueries.forEach((q, i) => {
    console.log(`  ${i + 1}. "${q}"`);
  });
  console.log();

  console.log('🔍 Fragment Registry Tracking...');
  console.log('  Query 1: No crypto fragment found → Track (count: 1)');
  console.log('  Query 2: No crypto fragment found → Track (count: 2)');
  console.log('  Query 3: No crypto fragment found → Track (count: 3)');
  console.log();
  console.log('⚡ GENESIS THRESHOLD REACHED! (3 similar queries)');
  console.log();

  // Initialize FragmentRegistry with mock QuadBrain
  console.log('🚀 INITIATING AUTONOMOUS GENESIS...');
  console.log('─'.repeat(80));

  const mockBrain = new MockQuadBrain();
  const registry = new FragmentRegistry({
    quadBrain: mockBrain,
    genesisThreshold: 3
  });

  // Trigger Genesis
  console.log('\nStep 1: PROMETHEUS designs fragment structure');
  console.log('  → Analyzes user queries');
  console.log('  → Identifies domain: cryptocurrency');
  console.log('  → Defines specialization: trading_strategy');
  console.log('  → Selects optimal temperature: 0.4');

  console.log('\nStep 2: AURORA writes system prompt');
  console.log('  → Creates specialized persona');
  console.log('  → Defines capabilities and approach');
  console.log('  → Sets communication style');

  await registry.performGenesis('PROMETHEUS', userQueries);

  console.log('\n✅ FRAGMENT BIRTH COMPLETE!');
  console.log('─'.repeat(80));

  // Show the created fragment
  const fragments = Array.from(registry.fragments.values());
  if (fragments.length > 0) {
    const newFragment = fragments[0];

    console.log('\n📋 New Fragment Details:');
    console.log(`  ID: ${newFragment.id}`);
    console.log(`  Pillar: ${newFragment.pillar}`);
    console.log(`  Domain: ${newFragment.domain}`);
    console.log(`  Specialization: ${newFragment.specialization}`);
    console.log(`  Keywords: ${newFragment.keywords.join(', ')}`);
    console.log(`  Temperature: ${newFragment.temperature}`);
    console.log(`  Status: ${newFragment.active ? 'ACTIVE' : 'INACTIVE'}`);
    console.log(`  Expertise Level: ${newFragment.expertiseLevel.toFixed(2)}`);
    console.log(`  Created: ${new Date(newFragment.stats.createdAt).toLocaleString()}`);
    console.log();

    console.log('🎯 Fragment Capabilities:');
    console.log('  ✅ Ready to handle crypto trading queries');
    console.log('  ✅ Specialized prompt optimized for this domain');
    console.log('  ✅ Low temperature (0.4) for balanced analysis');
    console.log('  ✅ Expertise will grow with usage');
    console.log();

    console.log('💡 What Just Happened:');
    console.log('  • NO LLM training required (instant!)');
    console.log('  • NO GPU needed (free!)');
    console.log('  • Fragment created in <1 second');
    console.log('  • Ready to use immediately');
    console.log('  • Will track performance and evolve');
    console.log();
  }

  // Demonstrate Mitosis
  console.log('═'.repeat(80));
  console.log('➗ BONUS: MITOSIS DEMONSTRATION');
  console.log('═'.repeat(80));
  console.log();
  console.log('Scenario: Fragment becomes too busy (50+ queries)');
  console.log();

  if (fragments.length > 0) {
    const fragment = fragments[0];

    // Simulate heavy usage
    fragment.stats.queriesHandled = 75;
    fragment.expertiseLevel = 0.72;

    console.log('Fragment Stats:');
    console.log(`  Queries Handled: ${fragment.stats.queriesHandled}`);
    console.log(`  Expertise Level: ${fragment.expertiseLevel}`);
    console.log();
    console.log('⚠️  Fragment is handling too many diverse queries!');
    console.log('💡 LOGOS recommends: Split into sub-specialists');
    console.log();

    // This would normally trigger mitosis
    console.log('Mitosis Process (simulated):');
    console.log('  1. LOGOS analyzes fragment breadth');
    console.log('  2. Identifies 3 sub-specializations:');
    console.log('     • Technical Analysis (charts, patterns)');
    console.log('     • Fundamental Analysis (tokenomics, projects)');
    console.log('     • DeFi Specialist (protocols, yield farming)');
    console.log('  3. Each sub-fragment gets own Genesis event');
    console.log('  4. Parent becomes router to children');
    console.log();
    console.log('Result: 1 broad fragment → 3 focused specialists');
  }

  console.log();
  console.log('═'.repeat(80));
  console.log('📊 GENESIS SUMMARY');
  console.log('═'.repeat(80));
  console.log();
  console.log('What triggers Genesis:');
  console.log('  • 3 similar queries with no matching fragment');
  console.log('  • Pattern detection in query topics');
  console.log('  • Autonomous decision by FragmentRegistry');
  console.log();
  console.log('What happens during Genesis:');
  console.log('  1. PROMETHEUS designs fragment structure');
  console.log('  2. AURORA writes specialized system prompt');
  console.log('  3. Fragment registered and activated');
  console.log('  4. Immediately available for routing');
  console.log();
  console.log('Key advantages:');
  console.log('  ✅ Instant (no training)');
  console.log('  ✅ Free (no GPU)');
  console.log('  ✅ Autonomous (no human input)');
  console.log('  ✅ Evolves (Mitosis + Neuroplasticity)');
  console.log();
  console.log('This is TRUE self-evolution - SOMA creating her own specialists!');
  console.log();
}

demonstrateGenesis().catch(console.error);
