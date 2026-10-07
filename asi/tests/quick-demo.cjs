// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/quick-demo.cjs
// Quick demonstration of ASI layer capabilities
// ═══════════════════════════════════════════════════════════

const LLMAdapter = require('../core/LLMAdapter.cjs');
const SandboxRunner = require('../execution/SandboxRunner.cjs');
const SolutionEvaluator = require('../evaluation/SolutionEvaluator.cjs');

console.log('🚀 ASI Quick Demo\n');
console.log('═══════════════════════════════════════════════════════════\n');

(async () => {
  // Initialize components
  const llm = new LLMAdapter({
    provider: 'ollama',
    model: 'llama3.2:latest',
    logger: { info: console.log, debug: () => {}, warn: console.warn, error: console.error }
  });

  const sandbox = new SandboxRunner({
    logger: { debug: () => {}, warn: console.warn, error: console.error }
  });

  const evaluator = new SolutionEvaluator({
    sandbox,
    logger: { debug: () => {}, error: console.error }
  });

  // Test 1: LLM Connection
  console.log('Test 1: LLM Connection');
  const testResult = await llm.test();
  console.log(`  Status: ${testResult.success ? '✅ Connected' : '❌ Failed'}\n`);

  // Test 2: Generate Code
  console.log('Test 2: Generate Simple Function');
  const prompt = 'Write a JavaScript function called double that takes a number and returns it multiplied by 2. Just the function code, no explanation.';
  const code = await llm.generate(prompt, { maxTokens: 200 });
  console.log('  Generated:');
  console.log('  ' + code.split('\n').slice(0, 5).join('\n  '));
  console.log('\n');

  // Test 3: Execute in Sandbox
  console.log('Test 3: Sandbox Execution');
  const testCode = `
    function double(n) {
      return n * 2;
    }
    output = double(input);
  `;
  const execResult = await sandbox.run(testCode, 5);
  console.log(`  Input: 5`);
  console.log(`  Output: ${execResult.output}`);
  console.log(`  Success: ${execResult.success ? '✅' : '❌'}`);
  console.log(`  Time: ${execResult.executionTime.toFixed(2)}ms\n`);

  // Test 4: Evaluate Solution
  console.log('Test 4: Solution Evaluation');
  const sampleCode = `
    function fizzbuzz(n) {
      if (n % 15 === 0) return "FizzBuzz";
      if (n % 3 === 0) return "Fizz";
      if (n % 5 === 0) return "Buzz";
      return n;
    }
  `;
  const evaluation = await evaluator.evaluate(sampleCode, 'Write a FizzBuzz function');
  console.log(`  Score: ${(evaluation.score * 100).toFixed(1)}%`);
  console.log(`  Correctness: ${(evaluation.scores.correctness * 100).toFixed(1)}%`);
  console.log(`  Efficiency: ${(evaluation.scores.efficiency * 100).toFixed(1)}%`);
  console.log(`  Elegance: ${(evaluation.scores.elegance * 100).toFixed(1)}%`);
  console.log(`  Grade: ${evaluation.grade}\n`);

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ All components working!\n');

  console.log('Next: Run full integration test with tree search:');
  console.log('  node asi/tests/integration.test.cjs\n');
})();
