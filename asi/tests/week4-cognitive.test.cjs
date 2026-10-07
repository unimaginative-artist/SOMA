// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/week4-cognitive.test.cjs
// Week 4: Cognitive Diversity + Critique + Recombination Test
// ═══════════════════════════════════════════════════════════

const TreeSearchEngine = require('../core/TreeSearchEngine.cjs');
const LLMAdapter = require('../core/LLMAdapter.cjs');
const SolutionEvaluator = require('../evaluation/SolutionEvaluator.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');
const ProblemTestSuite = require('./ProblemTestSuite.cjs');

console.log('🚀 ASI Week 4 Test - Cognitive Diversity\n');
console.log('═══════════════════════════════════════════════════════════\n');

(async () => {
  // Setup
  const logger = {
    info: (...args) => console.log(...args),
    debug: () => {}, // Suppress debug for clarity
    warn: (...args) => console.warn('⚠️ ', ...args),
    error: (...args) => console.error('❌', ...args)
  };

  const llm = new LLMAdapter({
    provider: 'ollama',
    model: 'llama3.2:latest',
    logger
  });

  const sandbox = new SandboxRunner({ logger });
  const evaluator = new SolutionEvaluator({
    sandbox,
    logger
  });

  const problemSuite = new ProblemTestSuite();
  const problem = problemSuite.problems.get('fizzbuzz');

  console.log('[LLMAdapter] Configured for ollama');
  console.log(`  Model: llama3.2:latest\n`);

  console.log(`Problem: ${problem.name}`);
  console.log(`Tests: ${problem.tests.length}\n`);

  console.log('Week 4 Features:');
  console.log('  ✅ DivergentGenerator - Forces paradigm diversity');
  console.log('  ✅ CriticBrain - Hybrid evaluation (sandbox + LLM critique)');
  console.log('  ✅ RecombinationEngine - Merges best solutions');
  console.log('  ✅ Cognitive diversity: ENABLED\n');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('Baseline (Single LLM Call - for comparison)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const baselineStart = Date.now();
  const baselinePrompt = `Write a complete JavaScript function for this problem:

${problem.description}

Signature: ${problem.signature}

Return ONLY the code, no explanation:`;

  const baselineResponse = await llm.generate(baselinePrompt);
  const baselineCode = baselineResponse.replace(/```javascript/g, '').replace(/```/g, '').trim();

  const baselineSolution = {
    code: baselineCode,
    reasoning: 'Single LLM call baseline'
  };

  const baselineEval = await evaluator.evaluate(baselineSolution, problem);
  const baselineTime = Date.now() - baselineStart;

  const baselineTests = problem.tests.filter((test, i) => {
    return baselineEval.scores?.testResults?.[i]?.passed;
  });

  console.log(`Time: ${baselineTime}ms`);
  console.log(`Tests: ${baselineTests.length}/${problem.tests.length} (${(baselineTests.length / problem.tests.length * 100).toFixed(1)}%)`);
  console.log(`Score: ${(baselineEval.score * 100).toFixed(1)}%\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('ASI Tree Search (Week 4 - Cognitive Diversity)');
  console.log('═══════════════════════════════════════════════════════════\n');

  const engine = new TreeSearchEngine({
    maxDepth: 2,
    branchingFactor: 6,
    strategy: 'beam',
    pruneThreshold: 0.3,
    evaluator,
    llm,
    logger,
    useCognitiveDiversity: true // Week 4: ENABLE cognitive diversity!
  });

  const asiStart = Date.now();
  const result = await engine.search(problem, {});
  const asiTime = Date.now() - asiStart;

  const asiTests = problem.tests.filter((test, i) => {
    return result.solution?.evaluation?.testResults?.[i]?.passed;
  });

  console.log(`\nTime: ${asiTime}ms (${(asiTime / baselineTime).toFixed(1)}x)`);
  console.log(`Nodes explored: ${result.stats.totalNodes}`);
  console.log(`Nodes evaluated: ${result.stats.evaluatedNodes}`);
  console.log(`Nodes pruned: ${result.stats.prunedNodes}`);
  console.log('');
  console.log(`Best Solution:`);
  console.log(`  Score: ${(result.solution?.score * 100).toFixed(1)}%`);
  console.log(`  Tests: ${asiTests.length}/${problem.tests.length} (${(asiTests.length / problem.tests.length * 100).toFixed(1)}%)`);
  console.log(`  Depth: ${result.solution?.depth || 0}`);
  console.log(`  Approach: ${result.solution?.approach || 'Unknown'}`);

  if (result.solution?.critique) {
    console.log(`\nCritic Feedback:`);
    console.log(`  ${result.solution.critique.substring(0, 150)}...`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Results Comparison');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Baseline:');
  console.log(`   Time: ${baselineTime}ms`);
  console.log(`   Tests: ${baselineTests.length}/${problem.tests.length}`);
  console.log(`   Score: ${(baselineEval.score * 100).toFixed(1)}%\n`);

  console.log('🌳 ASI (Cognitive Diversity):');
  console.log(`   Time: ${asiTime}ms (${(asiTime / baselineTime).toFixed(1)}x slower)`);
  console.log(`   Tests: ${asiTests.length}/${problem.tests.length}`);
  console.log(`   Score: ${(result.solution?.score * 100 || 0).toFixed(1)}%`);
  console.log(`   Nodes: ${result.stats.totalNodes} explored\n`);

  // Determine winner
  const asiWins = asiTests.length > baselineTests.length ||
                  (asiTests.length === baselineTests.length && result.solution?.score > baselineEval.score);

  console.log('🏆 Winner:');
  if (asiTests.length > baselineTests.length) {
    console.log(`   🌳 ASI WINS! (+${asiTests.length - baselineTests.length} more tests passing)`);
  } else if (asiTests.length === baselineTests.length) {
    if (result.solution?.score > baselineEval.score) {
      console.log(`   🌳 ASI WINS! (higher score: ${((result.solution.score - baselineEval.score) * 100).toFixed(1)}% better)`);
    } else if (result.solution?.score === baselineEval.score) {
      console.log(`   🤝 TIE - Both equal`);
    } else {
      console.log(`   📊 BASELINE wins (higher score)`);
    }
  } else {
    console.log(`   📊 BASELINE wins (+${baselineTests.length - asiTests.length} more tests passing)`);
  }

  // Show paradigm diversity
  console.log('\n📈 Paradigm Diversity:');
  const paradigms = new Set();
  function collectParadigms(node) {
    if (node.approach?.paradigm) {
      paradigms.add(node.approach.paradigm);
    }
    if (node.children) {
      for (const child of node.children) {
        collectParadigms(child);
      }
    }
  }
  collectParadigms(result.tree);
  console.log(`   Explored paradigms: ${Array.from(paradigms).join(', ')}`);
  console.log(`   Total unique: ${paradigms.size}`);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('🎉 Week 4 Cognitive Diversity Test Complete!');
  console.log('═══════════════════════════════════════════════════════════\n');

})().catch(error => {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
});
