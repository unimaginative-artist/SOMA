#!/usr/bin/env node
/**
 * scripts/test_small_model_vector_grounding.mjs
 *
 * Comprehensive test suite verifying:
 * 1. Dynamic Lobe Model Resolution against active Ollama registry.
 * 2. Domain-Partitioned Vector Memory Grounding for all 4 lobes (LOGOS, PROMETHEUS, AURORA, THALAMUS).
 * 3. Grounding-injected Small Model Specialist Inference.
 * 4. Auto-Trainer Preflight Check.
 */

import { SOMArbiterV2_QuadBrain } from '../arbiters/SOMArbiterV2_QuadBrain.js';
import { spawn } from 'child_process';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 SOMA Small-Model Cognitive & Vector Grounding Suite');
  console.log('======================================================\n');

  const quadBrain = new SOMArbiterV2_QuadBrain({ name: 'TestQuadBrain' });

  // ─────────────────────────────────────────────────────────────────
  // TEST SUITE 1: Dynamic Lobe Model Resolution
  // ─────────────────────────────────────────────────────────────────
  console.log('[Suite 1] Dynamic Model Resolution & Ollama Registration');
  
  const available = await quadBrain._getAvailableOllamaModels();
  assert(Array.isArray(available) && available.length > 0, `Ollama models available: ${available.length} detected`);

  const resolvedLogos = await quadBrain._resolveLobeModel('LOGOS');
  assert(resolvedLogos && resolvedLogos.startsWith('soma-logos'), `LOGOS resolved to specialist: ${resolvedLogos}`);

  const resolvedPrometheus = await quadBrain._resolveLobeModel('PROMETHEUS');
  assert(resolvedPrometheus === 'soma-prometheus:v3', `PROMETHEUS resolved to v3 GPU model: ${resolvedPrometheus}`);

  const resolvedThalamus = await quadBrain._resolveLobeModel('THALAMUS');
  assert(resolvedThalamus === 'soma-thalamus:v2', `THALAMUS resolved to v2 GPU model: ${resolvedThalamus}`);

  const resolvedAurora = await quadBrain._resolveLobeModel('AURORA');
  assert(resolvedAurora === 'qwen2.5:7b', `AURORA cleanly falls back to trusted model: ${resolvedAurora}`);

  // ─────────────────────────────────────────────────────────────────
  // TEST SUITE 2: 4-Lobe Domain Vector Memory Grounding
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Suite 2] Domain-Partitioned Vector Memory Grounding');

  // Test LOGOS (Engineering & Repo Grounding)
  const logosContext = await quadBrain._retrieveLobeContext('LOGOS', 'how does MnemonicArbiter handle memory caching?');
  assert(logosContext && logosContext.includes('Grounded in SOMA'), 'LOGOS retrieved engineering/codebase context');

  // Test PROMETHEUS (Finance & Strategy Grounding)
  const prometheusContext = await quadBrain._retrieveLobeContext('PROMETHEUS', 'what is the trading strategy for bitcoin trend following?');
  assert(prometheusContext && prometheusContext.includes('Market, Strategy & Financial Memory'), 'PROMETHEUS retrieved financial/strategy vector memory');

  // Test AURORA (Owner Dialogue & Identity Grounding)
  const auroraContext = await quadBrain._retrieveLobeContext('AURORA', 'what is the vision and relationship with Owner?');
  assert(auroraContext && auroraContext.includes('Owner Dialogue, Identity & Synthesis Memory'), 'AURORA retrieved Owner identity/dialogue vector memory');

  // Test THALAMUS (Safety & Constraints Grounding)
  const thalamusContext = await quadBrain._retrieveLobeContext('THALAMUS', 'what are the system constraints and failure loop rules?');
  assert(thalamusContext && thalamusContext.includes('Safety, Boundaries & Operational Constraints'), 'THALAMUS retrieved safety/boundary vector memory');

  // ─────────────────────────────────────────────────────────────────
  // TEST SUITE 3: Grounded Small-Model Specialist Inference
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Suite 3] Grounded Small-Model Specialist Inference');
  
  const testQuery = 'Explain the trading strategy for crypto breakout';
  const retrievedPrometheus = await quadBrain._retrieveLobeContext('PROMETHEUS', testQuery);
  const specialistResult = await quadBrain._queryLobeSpecialist('PROMETHEUS', testQuery, retrievedPrometheus);
  assert(typeof specialistResult === 'string' && specialistResult.length > 20, `PROMETHEUS local model returned grounded output (${specialistResult?.length} chars)`);

  // ─────────────────────────────────────────────────────────────────
  // TEST SUITE 4: Training Preflight & GPU Safety Gate
  // ─────────────────────────────────────────────────────────────────
  console.log('\n[Suite 4] Auto-Trainer Preflight & Hardware Gate');

  const pyTrainer = path.join(process.cwd(), '.soma_train_venv', 'Scripts', 'python.exe');
  const preflightScript = path.join(process.cwd(), 'scripts', 'training_preflight.py');

  const preflightResult = await new Promise((resolve) => {
    const proc = spawn(pyTrainer, [preflightScript, '--require-free-gb', '1'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d; });
    proc.stderr.on('data', d => { stderr += d; });
    proc.on('close', (code) => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      try {
        resolve({ ...JSON.parse(line), exitCode: code });
      } catch (e) {
        resolve({ ok: false, exitCode: code, error: stderr || stdout });
      }
    });
    proc.on('error', err => resolve({ ok: false, error: err.message }));
  });

  assert(preflightResult.ok === true, `Training preflight succeeded on ${preflightResult.gpu} (PyTorch ${preflightResult.packages?.torch})`);
  assert(preflightResult.freeDiskGb > 40, `Safe free disk space verified: ${preflightResult.freeDiskGb} GB free`);

  // ─────────────────────────────────────────────────────────────────
  // Summary
  // ─────────────────────────────────────────────────────────────────
  console.log('\n======================================================');
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
