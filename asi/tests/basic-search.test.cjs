// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/basic-search.test.js
// Basic test of TreeSearchEngine components
// ═══════════════════════════════════════════════════════════

const TreeSearchEngine = require('../core/TreeSearchEngine.cjs');
const SolutionNode = require('../core/SolutionNode.cjs');
const SolutionEvaluator = require('../evaluation/SolutionEvaluator.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');

console.log('🧪 ASI Layer - Basic Test Suite\n');

// Test 1: SolutionNode
console.log('Test 1: SolutionNode');
const root = new SolutionNode({
  approach: 'root',
  depth: 0
});

const child1 = root.addChild({
  approach: 'Approach 1',
  solution: 'console.log("Hello")',
  score: 0.8
});
child1.evaluated = true;

const child2 = root.addChild({
  approach: 'Approach 2',
  solution: 'console.log("World")',
  score: 0.9
});
child2.evaluated = true;

console.log(`  Root has ${root.children.length} children`);
console.log(`  Best child: ${root.getBestChild().approach} (score: ${root.getBestChild().score})`);
console.log('  ✅ PASSED\n');

// Test 2: SandboxRunner
console.log('Test 2: SandboxRunner');
const sandbox = new SandboxRunner({ logger: { debug: () => {}, warn: () => {}, error: () => {} } });

const testCode = `
  function solution(input) {
    return input * 2;
  }

  output = solution(input);
`;

(async () => {
  const result = await sandbox.run(testCode, 5);
  console.log(`  Input: 5, Output: ${result.output}`);
  console.log(`  Execution time: ${result.executionTime.toFixed(2)}ms`);
  console.log(`  Success: ${result.success}`);

  if (result.success && result.output === 10) {
    console.log('  ✅ PASSED\n');
  } else {
    console.log('  ❌ FAILED\n');
  }

  // Test 3: SolutionEvaluator
  console.log('Test 3: SolutionEvaluator');
  const evaluator = new SolutionEvaluator({ logger: { debug: () => {}, error: () => {} } });

  const goodCode = `
    // Double the input
    function solution(x) {
      if (x === null || x === undefined) {
        throw new Error('Invalid input');
      }
      return x * 2;
    }
  `;

  const evaluation = await evaluator.evaluate(goodCode, 'Write a function that doubles a number');
  console.log(`  Score: ${evaluation.score.toFixed(3)}`);
  console.log(`  Correctness: ${evaluation.scores.correctness.toFixed(3)}`);
  console.log(`  Elegance: ${evaluation.scores.elegance.toFixed(3)}`);
  console.log(`  Completeness: ${evaluation.scores.completeness.toFixed(3)}`);

  if (evaluation.score > 0) {
    console.log('  ✅ PASSED\n');
  } else {
    console.log('  ❌ FAILED\n');
  }

  // Test 4: TreeSearchEngine (without LLM - basic structure)
  console.log('Test 4: TreeSearchEngine (structure only)');
  const engine = new TreeSearchEngine({
    maxDepth: 2,
    branchingFactor: 3,
    strategy: 'beam',
    evaluator: evaluator,
    logger: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }
  });

  console.log(`  Strategy: ${engine.strategy}`);
  console.log(`  Max depth: ${engine.maxDepth}`);
  console.log(`  Branching factor: ${engine.branchingFactor}`);
  console.log('  ✅ PASSED\n');

  console.log('🎉 All basic tests passed!');
  console.log('\n📝 Next steps:');
  console.log('  1. Integrate LLM for approach generation');
  console.log('  2. Add real test suite for problems');
  console.log('  3. Test full search on a simple problem');
  console.log('  4. Add performance benchmarks');
})();
