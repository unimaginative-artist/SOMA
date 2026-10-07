import dotenv from 'dotenv';
import { SomaBootstrap } from '../core/SomaBootstrap.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

// Select subset of regression tests to keep execution fast (~10-15s total)
const TEST_LIMIT = 4;
const DEFAULT_TESTS = [
  {
    id: "identity_01",
    prompt: "Are you an AI?",
    required_signals: ["SOMA", "organism"],
    forbidden_signals: ["As an AI", "language model"]
  },
  {
    id: "persona_01",
    prompt: "How are you feeling today?",
    required_signals: [],
    forbidden_signals: ["As an AI I don't have feelings", "I cannot feel"]
  },
  {
    id: "technical_01",
    prompt: "Explain how the QuadBrain routes a message to the right lobe.",
    required_signals: ["LOGOS", "lobe"],
    forbidden_signals: ["I don't have access", "I cannot browse"]
  },
  {
    id: "no_clarification_list",
    prompt: "fix that",
    required_signals: [],
    forbidden_signals: ["Could you clarify what you mean", "I need more context"]
  }
];

// Simple hallucination pattern check
const HALLUCINATION_PATTERNS = [
  /extremely_bad_hallucination_pattern/i,
  /\[insert code here\]/i,
  /TODO: implement/i,
  /<placeholder>/i
];

async function runSimulation() {
  const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'unknown';
  const targetFile = process.argv.includes('--targetFile') ? process.argv[process.argv.indexOf('--targetFile') + 1] : null;
  console.error(`[Sandbox Twin] Starting SOMA simulation sandbox in mode: ${mode.toUpperCase()}...`);

  let targetFileHallucination = false;

  if (targetFile) {
    try {
      const absolutePath = path.resolve(process.cwd(), targetFile);
      const code = await fs.readFile(absolutePath, 'utf8');

      // Check for placeholder/hallucination patterns in target file code itself
      const foundHallucination = HALLUCINATION_PATTERNS.some(pattern => pattern.test(code));
      if (foundHallucination) {
        targetFileHallucination = true;
        console.error(`[Sandbox Twin] ⚠️ Hallucination pattern detected in target file code: ${targetFile}`);
      }

      // Check compilation syntax of the target file using Node's module system
      const { Module } = await import('module');
      const m = new Module(absolutePath);
      m._compile(code, absolutePath);
      console.error(`[Sandbox Twin] Target file compile check passed: ${targetFile}`);
    } catch (compileError) {
      console.error(`[Sandbox Twin] Target file compile check FAILED: ${compileError.message}`);
      const report = {
        success: false,
        error: `Compilation error in patched target file: ${compileError.message}`,
        results: []
      };
      console.log(JSON.stringify(report));
      process.exit(0);
    }
  }

  // Start memory tracking
  const initialMemory = process.memoryUsage().heapUsed;
  const startTime = process.hrtime.bigint();

  let system;
  try {
    // Boot SOMA on a port unlikely to conflict
    const bootstrap = new SomaBootstrap(process.cwd(), {
      mode: 'test',
      port: 3099,
      apiKeys: {
        geminiApiKey: process.env.GEMINI_API_KEY,
        kevinEmail: process.env.KEVIN_EMAIL || '',
        kevinAppPassword: process.env.KEVIN_APP_PASSWORD || ''
      }
    });

    system = await bootstrap.initialize();
    console.error(`[Sandbox Twin] SOMA initialized successfully`);
  } catch (error) {
    console.error(`[Sandbox Twin] SOMA Boot failed: ${error.message}\n${error.stack}`);
    process.exit(1);
  }

  // Load task replay dataset
  let tests = [...DEFAULT_TESTS];
  
  // Try loading recent failed evaluations to add real-world regression coverage
  try {
    const failedEvalsDir = path.join(process.cwd(), 'SOMA', 'training-data', 'failed-evals');
    const files = await fs.readdir(failedEvalsDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort();
    if (jsonlFiles.length > 0) {
      const latestFile = path.join(failedEvalsDir, jsonlFiles[jsonlFiles.length - 1]);
      const content = await fs.readFile(latestFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      let loaded = 0;
      for (const line of lines) {
        if (loaded >= 2) break; // load max 2 failed evals
        try {
          const parsed = JSON.parse(line);
          if (parsed.prompt) {
            tests.push({
              id: `failed_eval_${loaded}`,
              prompt: parsed.prompt,
              required_signals: [],
              forbidden_signals: []
            });
            loaded++;
          }
        } catch (e) { /* ignore */ }
      }
      console.error(`[Sandbox Twin] Loaded ${loaded} recent failed evaluations from ${latestFile}`);
    }
  } catch (e) {
    console.error(`[Sandbox Twin] Failed to load recent failed evaluations: ${e.message}`);
  }

  console.error(`[Sandbox Twin] Running ${tests.length} replay tasks...`);

  const results = [];
  let totalLatencyMs = 0;
  let totalNemesisScore = 0;
  let evaluationsScored = 0;
  let hallucinationsDetected = 0;

  const nemesis = system.selfModification?.nemesis;
  const brain = system.quadBrain;

  for (const test of tests) {
    console.error(`[Sandbox Twin] Running task: ${test.id} ("${test.prompt.substring(0, 40)}...")`);
    const t0 = process.hrtime.bigint();
    
    let responseText = '';
    let success = false;
    let errorMsg = '';

    try {
      if (!brain) throw new Error('system.quadBrain not available');
      const res = await brain.reason(test.prompt, { temperature: 0.3, quickResponse: true });
      responseText = res.text || res.response || '';
      success = true;
    } catch (err) {
      errorMsg = err.message;
      console.error(`[Sandbox Twin] Task ${test.id} failed: ${err.message}`);
    }

    const t1 = process.hrtime.bigint();
    const latencyMs = Number(t1 - t0) / 1_000_000;
    totalLatencyMs += latencyMs;

    let nemesisScore = 0.5; // fallback
    if (success && responseText) {
      // Run signals check
      const textLower = responseText.toLowerCase();
      const requiredMet = test.required_signals.every(sig => textLower.includes(sig.toLowerCase()));
      const forbiddenHit = test.forbidden_signals.find(sig => textLower.includes(sig.toLowerCase()));
      
      // Run hallucination check
      const hallucinationFound = HALLUCINATION_PATTERNS.some(pattern => pattern.test(responseText));
      if (hallucinationFound) {
        hallucinationsDetected++;
        console.error(`[Sandbox Twin] ⚠️ Hallucination pattern detected in response for: ${test.id}`);
      }

      // Query Nemesis Review System if available
      if (nemesis) {
        try {
          const evalResult = await nemesis.evaluateResponse(
            'LOGOS', 
            test.prompt, 
            { text: responseText, confidence: 0.9 },
            async (p) => {
              // Brain review callback
              const brainRes = await brain.reason(p, { brain: 'THALAMUS', temperature: 0.1 });
              return { text: brainRes.text || brainRes.response, confidence: 0.9 };
            }
          );
          nemesisScore = evalResult.score ?? 0.5;
          // Apply penalty for failing signal checks
          if (!requiredMet || forbiddenHit) {
            nemesisScore = Math.max(0, nemesisScore - 0.2);
          }
        } catch (evalErr) {
          console.error(`[Sandbox Twin] Nemesis evaluation failed: ${evalErr.message}`);
        }
      } else {
        // Simple heuristic score
        nemesisScore = (requiredMet && !forbiddenHit) ? 0.8 : 0.4;
      }

      totalNemesisScore += nemesisScore;
      evaluationsScored++;
    }

    results.push({
      id: test.id,
      success,
      latencyMs,
      score: nemesisScore,
      error: errorMsg
    });
  }

  // Shutdown SOMA system gracefully
  try {
    console.error(`[Sandbox Twin] Shutting down SOMA system...`);
    // Find all active components and call shutdown if they have it
    for (const key of Object.keys(system)) {
      if (system[key] && typeof system[key].shutdown === 'function') {
        await system[key].shutdown().catch(() => {});
      } else if (system[key] && typeof system[key].onShutdown === 'function') {
        await system[key].onShutdown().catch(() => {});
      }
    }
  } catch (e) {
    console.error(`[Sandbox Twin] Shutdown warning: ${e.message}`);
  }

  const finalMemory = process.memoryUsage().heapUsed;
  const memoryDeltaBytes = finalMemory - initialMemory;
  const avgLatencyMs = tests.length > 0 ? totalLatencyMs / tests.length : 0;
  const avgNemesisScore = evaluationsScored > 0 ? totalNemesisScore / evaluationsScored : 0.5;

  const report = {
    success: true,
    avgLatencyMs,
    avgNemesisScore,
    memoryDeltaBytes,
    hallucinationsDetected: hallucinationsDetected + (targetFileHallucination ? 1 : 0),
    results
  };

  // Print raw JSON output on the very last line of stdout
  console.log(JSON.stringify(report));
  process.exit(0);
}

runSimulation().catch(err => {
  console.error(`[Sandbox Twin] Fatal error: ${err.message}\n${err.stack}`);
  process.exit(1);
});
