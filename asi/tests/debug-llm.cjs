// Debug: See what LLM actually returns

const LLMAdapter = require('../core/LLMAdapter.cjs');
const { parseStructured, ApproachesSchema } = require('../core/StructuredOutput.cjs');

(async () => {
  const llm = new LLMAdapter({
    provider: 'ollama',
    model: 'llama3.2:latest',
    logger: { info: console.log, debug: console.log, warn: console.warn, error: console.error }
  });

  const prompt = `Generate 3 different coding approaches for this problem.

Problem: FizzBuzz: Write a function that returns "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for multiples of both, and the number otherwise.
Signature: function fizzbuzz(n)

Return ONLY valid JSON, no other text. Format:
[
  {
    "name": "Approach name",
    "strategy": "Brief strategy description",
    "steps": ["step1", "step2"],
    "strengths": "What's good about this",
    "weaknesses": "What's not ideal"
  }
]

Example for "reverse a string":
[
  {
    "name": "Built-in reverse",
    "strategy": "Use array reverse method",
    "steps": ["Split to array", "Reverse array", "Join back"],
    "strengths": "Simple and readable",
    "weaknesses": "Creates intermediate arrays"
  },
  {
    "name": "Two-pointer swap",
    "strategy": "Swap characters from both ends",
    "steps": ["Convert to array", "Swap i and n-i", "Return string"],
    "strengths": "In-place, efficient",
    "weaknesses": "More complex code"
  }
]

Now generate 3 approaches for: FizzBuzz: Write a function that returns "Fizz" for multiples of 3, "Buzz" for multiples of 5, "FizzBuzz" for multiples of both, and the number otherwise.
Signature: function fizzbuzz(n)

Return ONLY the JSON array, nothing else:`;

  console.log('🔍 Testing LLM Response...\n');
  console.log('Prompt length:', prompt.length);
  console.log('\nGenerating...\n');

  const response = await llm.generate(prompt, { maxTokens: 1000 });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('RAW LLM RESPONSE:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(response);
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Testing structured parser...\n');

  const result = parseStructured(response, ApproachesSchema, {
    repair: true,
    fallback: []
  });

  console.log('Parse Result:');
  console.log('  Success:', result.success);
  console.log('  Repaired:', result.repaired);
  console.log('  Fallback:', result.fallback);
  console.log('  Data length:', result.data?.length || 0);

  if (result.errors) {
    console.log('  Errors:', result.errors);
  }

  if (result.data && result.data.length > 0) {
    console.log('\n✅ Parsed approaches:');
    result.data.forEach((approach, i) => {
      console.log(`\n${i + 1}. ${approach.name}`);
      console.log(`   Strategy: ${approach.strategy}`);
      console.log(`   Steps: ${approach.steps?.join(' → ')}`);
    });
  } else {
    console.log('\n❌ No approaches parsed');
  }
})();
