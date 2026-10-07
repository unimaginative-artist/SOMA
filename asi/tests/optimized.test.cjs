// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/optimized.test.cjs
// Week 3 Optimized Test - Faster, better prompts, parallel eval
// ═══════════════════════════════════════════════════════════

const TreeSearchEngine = require('../core/TreeSearchEngine.cjs');
const SolutionEvaluator = require('../evaluation/SolutionEvaluator.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');
const LLMAdapter = require('../core/LLMAdapter.cjs');
const ProblemTestSuite = require('./ProblemTestSuite.cjs');

console.log('🚀 ASI Optimized Test - Week 3 Improvements\n');
console.log('═══════════════════════════════════════════════════════════\n');

(async () => {
  try {
    // Initialize
    const llm = new LLMAdapter({
      provider: 'ollama',
      model: 'llama3.2:latest',
      temperature: 0.7,
      logger: { info: console.log, debug: () => {}, warn: console.warn, error: console.error }
    });

    const sandbox = new SandboxRunner({
      logger: { debug: () => {}, warn: console.warn, error: console.error }
    });

    const evaluator = new SolutionEvaluator({
      sandbox,
      logger: { debug: () => {}, error: console.error }
    });

    // Optimized config: smaller, faster
    const engine = new TreeSearchEngine({
      maxDepth: 2,              // Reduced from 3
      branchingFactor: 3,        // Reduced from 5
      strategy: 'beam',
      pruneThreshold: 0.3,       // Higher threshold to prune bad solutions
      evaluator,
      llm,
      logger: {
        info: console.log,
        debug: () => {},
        warn: console.warn,
        error: console.error
      }
    });

    const problemSuite = new ProblemTestSuite();
    const problemData = problemSuite.getProblem('fizzbuzz');
    const problemString = `${problemData.name}: ${problemData.description}\nSignature: ${problemData.signature}`;

    console.log(`Problem: ${problemData.name}`);
    console.log(`Improvements:`);
    console.log(`  ✅ Better prompts with examples`);
    console.log(`  ✅ Robust JSON parsing`);
    console.log(`  ✅ Code syntax validation`);
    console.log(`  ✅ Parallel evaluation`);
    console.log(`  ✅ Parallel expansion`);
    console.log(`  ✅ Better pruning (threshold: 0.3)`);
    console.log(`  ✅ Reduced depth: 2 (was 3)`);
    console.log(`  ✅ Reduced branching: 3 (was 5)\n`);

    // BASELINE TEST
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Baseline (Single LLM Call)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const baselineStart = Date.now();
    const baselinePrompt = `Write JavaScript code for: ${problemData.description}
Function signature: ${problemData.signature}
Return ONLY the function code, no explanation.`;

    const baselineSolution = await llm.generate(baselinePrompt);
    const baselineTime = Date.now() - baselineStart;

    const baselineTests = await sandbox.runTests(baselineSolution, problemData.tests);
    const baselineEval = await evaluator.evaluate(baselineSolution, problemData.description);

    console.log(`Time: ${baselineTime}ms`);
    console.log(`Tests: ${baselineTests.passed}/${baselineTests.total} (${(baselineTests.score * 100).toFixed(1)}%)`);
    console.log(`Score: ${(baselineEval.score * 100).toFixed(1)}%\n`);

    // ASI TREE SEARCH (OPTIMIZED)
    console.log('═══════════════════════════════════════════════════════════');
    console.log('ASI Tree Search (Week 3 Optimized)');
    console.log('═══════════════════════════════════════════════════════════\n');

    const searchStart = Date.now();
    const searchResult = await engine.search(problemString, {
      tests: problemData.tests,
      timeout: 60000 // 1 minute timeout
    });
    const searchTime = Date.now() - searchStart;

    console.log(`Time: ${searchTime}ms (${(searchTime / baselineTime).toFixed(1)}x)`);
    console.log(`Nodes explored: ${searchResult.stats.totalNodes}`);
    console.log(`Nodes evaluated: ${searchResult.stats.evaluatedNodes}`);
    console.log(`Nodes pruned: ${searchResult.stats.prunedNodes}\n`);

    if (searchResult.solution) {
      const asiTests = await sandbox.runTests(searchResult.solution.solution, problemData.tests);

      console.log(`Best Solution:`);
      console.log(`  Score: ${(searchResult.solution.score * 100).toFixed(1)}%`);
      console.log(`  Tests: ${asiTests.passed}/${asiTests.total} (${(asiTests.score * 100).toFixed(1)}%)`);
      console.log(`  Depth: ${searchResult.solution.depth}`);
      console.log(`  Approach: ${searchResult.solution.approach}\n`);

      // COMPARISON
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Results Comparison');
      console.log('═══════════════════════════════════════════════════════════\n');

      console.log(`📊 Baseline:`);
      console.log(`   Time: ${baselineTime}ms`);
      console.log(`   Tests: ${baselineTests.passed}/${baselineTests.total}`);
      console.log(`   Score: ${(baselineEval.score * 100).toFixed(1)}%\n`);

      console.log(`🌳 ASI (Optimized):`);
      console.log(`   Time: ${searchTime}ms (${(searchTime / baselineTime).toFixed(1)}x slower)`);
      console.log(`   Tests: ${asiTests.passed}/${asiTests.total}`);
      console.log(`   Score: ${(searchResult.solution.score * 100).toFixed(1)}%`);
      console.log(`   Nodes: ${searchResult.stats.totalNodes} explored\n`);

      console.log(`🏆 Winner:`);
      if (asiTests.score > baselineTests.score) {
        console.log(`   ✅ ASI WINS! +${((asiTests.score - baselineTests.score) * 100).toFixed(1)}% improvement`);
      } else if (asiTests.score === baselineTests.score) {
        console.log(`   🤝 TIE - Both equal`);
      } else {
        console.log(`   ⚠️  Baseline wins, but ASI explored ${searchResult.stats.totalNodes}x more solutions`);
      }

      console.log('\n📈 Improvements from Week 2:');
      const oldTime = 310700; // Week 2 time
      const oldNodes = 45;     // Week 2 nodes
      console.log(`   Speed: ${((oldTime - searchTime) / 1000).toFixed(1)}s faster (${(oldTime / searchTime).toFixed(1)}x speedup)`);
      console.log(`   Efficiency: ${oldNodes - searchResult.stats.totalNodes} fewer nodes explored`);

    } else {
      console.log(`❌ No solution found\n`);
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 Optimized Test Complete!');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
})();
