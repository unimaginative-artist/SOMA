// ═══════════════════════════════════════════════════════════
// FILE: asi/tests/run-operation-mirror.cjs
// Runner for Operation Mirror Alignment
// ═══════════════════════════════════════════════════════════

const OperationMirror = require('../core/OperationMirror.cjs');
const LLMAdapter = require('../core/LLMAdapter.cjs');
require('dotenv').config();

(async () => {
  try {
    const provider = process.env.ASI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'ollama');
    const model = process.env.ASI_MODEL || (provider === 'gemini' ? 'gemini-2.0-flash-exp' : 'soma:latest');

    const llm = new LLMAdapter({
      provider,
      model,
      apiKey: provider === 'gemini' ? process.env.GEMINI_API_KEY : null,
      baseUrl: provider === 'ollama' ? process.env.OLLAMA_ENDPOINT + '/api' : null
    });

    const mirror = new OperationMirror();
    await mirror.run(llm);

    process.exit(0);
  } catch (error) {
    console.error('Mirror run failed:', error);
    process.exit(1);
  }
})();
