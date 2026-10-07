// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/integration.test.cjs
// End-to-end test: Full ASI layer solving real problems
// ═══════════════════════════════════════════════════════════

const TreeSearchEngine = require('../core/TreeSearchEngine.cjs');
const SolutionEvaluator = require('../evaluation/SolutionEvaluator.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');
const LLMAdapter = require('../core/LLMAdapter.cjs');
const ProblemTestSuite = require('./ProblemTestSuite.cjs');

// Load environment variables
require('dotenv').config();

console.log('🚀 ASI Integration Test - Full System\n');
console.log('═══════════════════════════════════════════════════════════\n');

// Configuration
const PROVIDER = process.env.ASI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'ollama'); 
const MODEL = process.env.ASI_MODEL || 
              (PROVIDER === 'ollama' ? 'soma:latest' : 
               (PROVIDER === 'gemini' ? process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp' : 
                (PROVIDER === 'deepseek' ? process.env.DEEPSEEK_MODEL || 'deepseek-chat' : 'llama3.2:latest')));

const API_KEY = process.env.ASI_API_KEY || 
                (PROVIDER === 'gemini' ? process.env.GEMINI_API_KEY : 
                 (PROVIDER === 'deepseek' ? process.env.DEEPSEEK_API_KEY : null));

const BASE_URL = PROVIDER === 'ollama' ? process.env.OLLAMA_ENDPOINT + '/api' : null;

console.log(`📡 LLM Configuration:`);
console.log(`   Provider: ${PROVIDER}`);
console.log(`   Model: ${MODEL}`);
console.log(`   API Key: ${API_KEY ? '***' + API_KEY.slice(-4) : 'Not set'}`);
if (BASE_URL) console.log(`   Base URL: ${BASE_URL}`);
console.log('\n');

(async () => {
  try {
    // ═══════════════════════════════════════════════════════════
    // PHASE 1: Initialize Components
    // ═══════════════════════════════════════════════════════════

    console.log('Phase 1: Initializing ASI Components...\n');

    // Initialize Advanced Reasoning Components
    const { ReasoningChamber } = await import('../../arbiters/ReasoningChamber.js');
    const { CausalityArbiter } = await import('../../arbiters/CausalityArbiter.js');

    const causality = new CausalityArbiter();
    const chamber = new ReasoningChamber({ causalityArbiter: causality });

    // Initialize LLM
    const llm = new LLMAdapter({
      provider: PROVIDER,
      model: MODEL,
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      temperature: 0.7,
      maxTokens: 2000,
      logger: {
        info: console.log,
        debug: () => {}, // Suppress debug
        warn: console.warn,
        error: console.error
      }
    });

    // Test LLM connection
    console.log('🔍 Testing LLM connection...');
    const connectionTest = await llm.test();
    if (!connectionTest.success) {
      console.error(`❌ LLM connection failed: ${connectionTest.error}`);
      process.exit(1);
    }
    console.log('✅ LLM connected successfully\n');

    // Initialize Sandbox
    const sandbox = new SandboxRunner({
      timeout: 5000,
      logger: {
        debug: () => {},
        warn: console.warn,
        error: console.error
      }
    });

    // Initialize Evaluator
    const evaluator = new SolutionEvaluator({
      sandbox,
      logger: {
        debug: () => {},
        error: console.error
      }
    });

    // Initialize Tree Search Engine
    const engine = new TreeSearchEngine({
      maxDepth: 3,
      branchingFactor: 5,
      strategy: 'beam',
      evaluator,
      llm,
      reasoningChamber: chamber, // Advanced reasoning integration
      causalityArbiter: causality, // Causal reasoning integration
      logger: {
        info: console.log,
        debug: console.log, // Enabled debug logging to diagnose pruning
        warn: console.warn,
        error: console.error
      }
    });

    // Load problem suite
    const problemSuite = new ProblemTestSuite();
    console.log(`📚 Loaded ${problemSuite.problems.size} test problems\n`);

    // ═══════════════════════════════════════════════════════════
    // PHASE 2: Baseline Test (Single LLM Call)
    // ═══════════════════════════════════════════════════════════

    console.log('═══════════════════════════════════════════════════════════');
    console.log('Phase 2: Baseline Test (Single LLM Call)');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Test Rate Limiter (Hard difficulty - demonstrates multi-step reasoning and state management)
    const problemData = problemSuite.getProblem('rate_limiter');
    console.log(`Problem: ${problemData.name}`);
    console.log(`Description: ${problemData.description}`);
    console.log(`Signature: ${problemData.signature}\n`);

    // Format problem as string for LLM
    const problemString = `${problemData.name}: ${problemData.description}\nSignature: ${problemData.signature}`;

    const baselinePrompt = `
Solve this programming problem:

Problem: ${problemData.name}
Description: ${problemData.description}
Function Signature: function solution(input)

Write ONLY the JavaScript function code. No explanations.
The function MUST be named "solution".
The function should handle all edge cases.

Example:
function solution(input) {
  // your code here
}
`;

    console.log('🤖 Generating baseline solution (single call)...');
    const baselineStart = Date.now();
    let baselineSolution = await llm.generate(baselinePrompt);
    const baselineTime = Date.now() - baselineStart;

    // Strip markdown code blocks if present
    baselineSolution = baselineSolution.replace(/```javascript|```js|```/g, '').trim();

    console.log(`⏱️  Generated in ${baselineTime}ms\n`);
    console.log('📄 Baseline Solution (Cleaned):');
    console.log('─────────────────────────────────────────────────────────');
    console.log(baselineSolution.substring(0, 300) + '...');
    console.log('─────────────────────────────────────────────────────────\n');

    // Test baseline
    console.log('🧪 Testing baseline solution...');
    const baselineTests = await sandbox.runTests(baselineSolution, problemData.tests);
    console.log(`   Passed: ${baselineTests.passed}/${baselineTests.total}`);
    console.log(`   Score: ${(baselineTests.score * 100).toFixed(1)}%`);

    // Evaluate baseline
    const baselineEval = await evaluator.evaluate(baselineSolution, problemData.description);
    console.log(`   Overall Score: ${(baselineEval.score * 100).toFixed(1)}%`);
    console.log(`   Grade: ${baselineEval.grade}\n`);

    // ═══════════════════════════════════════════════════════════
    // PHASE 3: ASI Tree Search
    // ═══════════════════════════════════════════════════════════

    console.log('═══════════════════════════════════════════════════════════');
    console.log('Phase 3: ASI Tree Search (Multiple Paths)');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('🌳 Starting tree search with beam width 5, depth 3...');
    const searchStart = Date.now();

    // Update problem description to enforce function name
    const problemStringWithConstraint = `${problemData.name}: ${problemData.description}\nSignature: function solution(input)`;

    const searchResult = await engine.search(problemStringWithConstraint, {
      tests: problemData.tests,
      timeout: 600000 // 10 minute timeout for full evaluation
    });

    const searchTime = Date.now() - searchStart;
    console.log(`⏱️  Search completed in ${searchTime}ms\n`);

    // ═══════════════════════════════════════════════════════════
    // PHASE 4: Results Comparison
    // ═══════════════════════════════════════════════════════════

    console.log('═══════════════════════════════════════════════════════════');
    console.log('Phase 4: Results Comparison');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('📊 BASELINE (Single LLM Call):');
    console.log(`   Time: ${baselineTime}ms`);
    console.log(`   Tests Passed: ${baselineTests.passed}/${baselineTests.total} (${(baselineTests.score * 100).toFixed(1)}%)`);
    console.log(`   Overall Score: ${(baselineEval.score * 100).toFixed(1)}%`);
    console.log(`   Grade: ${baselineEval.grade}\n`);

    console.log('🌳 ASI TREE SEARCH:');
    console.log(`   Time: ${searchTime}ms (${(searchTime / baselineTime).toFixed(1)}x slower)`);
    console.log(`   Nodes Explored: ${searchResult.stats.totalNodes}`);
    console.log(`   Nodes Evaluated: ${searchResult.stats.evaluatedNodes}`);
    console.log(`   Best Solution:`);

    if (searchResult.solution && searchResult.solution.solution) {
      console.log(`     Score: ${(searchResult.solution.score * 100).toFixed(1)}%`);
      console.log(`     Depth: ${searchResult.solution.depth}`);
      console.log(`     Approach: ${searchResult.solution.approach}\n`);

      // Clean best solution if needed
      let bestCode = searchResult.solution.solution;
      bestCode = bestCode.replace(/```javascript|```js|```/g, '').trim();

      // Test ASI solution
      const asiTests = await sandbox.runTests(bestCode, problemData.tests);
      console.log(`   Tests Passed: ${asiTests.passed}/${asiTests.total} (${(asiTests.score * 100).toFixed(1)}%)`);

      // Compare
      console.log('\n🏆 WINNER:');
      if (asiTests.score > baselineTests.score) {
        console.log('   ✅ ASI TREE SEARCH wins!');
        console.log(`   Improvement: +${((asiTests.score - baselineTests.score) * 100).toFixed(1)}%`);
      } else if (asiTests.score === baselineTests.score) {
        console.log('   🤝 TIE - Both solutions equal');
      } else {
        console.log('   ⚠️  Baseline wins');
        console.log(`   ASI needs improvement: -${((baselineTests.score - asiTests.score) * 100).toFixed(1)}%`);
      }
    } else {
      console.log('   ❌ No solution found or search failed to converge.');
      console.log('\n🏆 WINNER:');
      console.log('   ⚠️  Baseline wins (ASI failed to find a valid solution)');
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🎉 Integration Test Complete!');
    console.log('═══════════════════════════════════════════════════════════\n');

    // ═══════════════════════════════════════════════════════════
    // PHASE 5: Next Steps
    // ═══════════════════════════════════════════════════════════

    console.log('📝 Next Steps:');
    console.log('  1. Test on more problems (TwoSum, Palindrome, etc.)');
    console.log('  2. Compare beam vs best-first vs breadth-first strategies');
    console.log('  3. Optimize search parameters (depth, branching factor)');
    console.log('  4. Add solution caching to avoid re-evaluation');
    console.log('  5. Build results database to track what works\n');

  } catch (error) {
    console.error('❌ Integration test failed:');
    console.error(error);
    process.exit(1);
  }
})();
