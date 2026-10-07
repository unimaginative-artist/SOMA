// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/phase6-validation.test.cjs
// Phase 6: Validation - Comprehensive AGI Capability Test
// ═══════════════════════════════════════════════════════════

const TreeSearchEngine = require('../core/TreeSearchEngine.cjs');
const SolutionEvaluator = require('../evaluation/SolutionEvaluator.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');
const LLMAdapter = require('../core/LLMAdapter.cjs');
const ProblemTestSuite = require('./ProblemTestSuite.cjs');

// Load environment variables
require('dotenv').config();

console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
console.log('║                        SOMA PHASE 6: ASI VALIDATION                            ║');
console.log('║                  Baseline vs. Advanced Reasoning Layer                         ║');
console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
console.log('');

// Configuration
const PROVIDER = process.env.ASI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'ollama'); 
const MODEL = process.env.ASI_MODEL || (PROVIDER === 'ollama' ? 'soma:latest' : 'gemini-2.0-flash-exp');
const BASE_URL = PROVIDER === 'ollama' ? process.env.OLLAMA_ENDPOINT + '/api' : null;

(async () => {
  try {
    // 1. Initialize Components
    const llm = new LLMAdapter({
      provider: PROVIDER,
      model: MODEL,
      apiKey: PROVIDER === 'gemini' ? process.env.GEMINI_API_KEY : null,
      baseUrl: BASE_URL
    });

    const sandbox = new SandboxRunner({ timeout: 10000 });
    const evaluator = new SolutionEvaluator({ sandbox });
    
    // Wire Advanced Reasoning Layer
    const { ReasoningChamber } = await import('../../arbiters/ReasoningChamber.js');
    const { CausalityArbiter } = await import('../../arbiters/CausalityArbiter.js');
    const causality = new CausalityArbiter();
    const chamber = new ReasoningChamber({ causalityArbiter: causality });

    const engine = new TreeSearchEngine({
      maxDepth: 3,
      branchingFactor: 5,
      strategy: 'beam',
      evaluator,
      llm,
      reasoningChamber: chamber,
      causalityArbiter: causality,
      logger: { info: () => {}, debug: () => {}, warn: () => {}, error: console.error } // Mute logs for clean table
    });

    const problemSuite = new ProblemTestSuite();
    const problems = problemSuite.getAllProblems();
    
    console.log(`📡 Provider: ${PROVIDER} | Model: ${MODEL}`);
    console.log(`📚 Testing ${problems.length} problems across 3 difficulty levels...\n`);

    const results = [];

    for (const problem of problems) {
      console.log(`[Testing] ${problem.name} (${problem.difficulty})...`);
      
      // Baseline
      const baselinePrompt = `Write ONLY the JavaScript function code for: ${problem.description}\nFunction Signature: function solution(input)\nThe function MUST be named "solution".`;
      const baselineStart = Date.now();
      let baselineCode = await llm.generate(baselinePrompt);
      baselineCode = baselineCode.replace(/```javascript|```js|```/g, '').trim();
      const baselineTests = await sandbox.runTests(baselineCode, problem.tests);
      const baselineTime = Date.now() - baselineStart;

      // ASI
      const asiStart = Date.now();
      const asiResult = await engine.search(`${problem.name}: ${problem.description}\nSignature: function solution(input)`, {
        tests: problem.tests,
        timeout: 120000
      });
      const asiTime = Date.now() - asiStart;
      
      let asiScore = 0;
      if (asiResult.solution && asiResult.solution.solution) {
          const asiTests = await sandbox.runTests(asiResult.solution.solution.replace(/```javascript|```js|```/g, '').trim(), problem.tests);
          asiScore = asiTests.score;
      }

      results.push({
        name: problem.name,
        difficulty: problem.difficulty,
        baseline: baselineTests.score,
        asi: asiScore,
        baselineTime,
        asiTime,
        breakthrough: asiScore > baselineTests.score,
        tree: asiResult.tree ? asiResult.tree.toJSON() : null // Save full tree for Operation Mirror
      });
    }

    // 2. Output Results Table
    console.log('\n' + '═'.repeat(100));
    console.log(`| ${'Problem Name'.padEnd(30)} | ${'Diff'.padEnd(10)} | ${'Baseline'.padEnd(10)} | ${'ASI Layer'.padEnd(10)} | ${'Result'.padEnd(15)} |`);
    console.log('─'.repeat(100));

    results.forEach(r => {
      const resultIcon = r.breakthrough ? '🔥 BREAKTHROUGH' : (r.asi >= r.baseline ? '✅ EQUAL' : '⚠️ REGRESSION');
      console.log(`| ${r.name.padEnd(30)} | ${r.difficulty.padEnd(10)} | ${(r.baseline * 100).toFixed(1)}%`.padEnd(12) + ` | ${(r.asi * 100).toFixed(1)}%`.padEnd(12) + ` | ${resultIcon.padEnd(15)} |`);
    });
    console.log('═'.repeat(100));

    // 3. Final Summary
    const breakthroughs = results.filter(r => r.breakthrough).length;
    const parity = results.filter(r => r.asi >= r.baseline && !r.breakthrough).length;
    const totalScore = results.reduce((acc, r) => acc + r.asi, 0) / results.length;

    // Save results for Operation Mirror
    const fs = require('fs');
    const path = require('path');
    const resultsPath = path.join(__dirname, 'validation-results.json');
    fs.writeFileSync(resultsPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        provider: PROVIDER,
        model: MODEL,
        stats: { breakthroughs, parity, averageAccuracy: totalScore },
        results
    }, null, 2));
    console.log(`\n📁 Full results saved to: ${resultsPath}`);

    console.log(`\n📊 FINAL VALIDATION SUMMARY:`);
    console.log(`   • Total Problems: ${results.length}`);
    console.log(`   • Breakthroughs: ${breakthroughs}`);
    console.log(`   • Parity/Equal: ${parity}`);
    console.log(`   • ASI Average Accuracy: ${(totalScore * 100).toFixed(1)}%`);
    console.log(`\n🎯 PHASE 6 STATUS: ${breakthroughs > 0 ? 'SUCCESS - Breakthrough reasoning demonstrated!' : 'PARITY - Engine stable but needs harder problems.'}\n`);

    process.exit(0);

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
})();
