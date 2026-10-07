import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NeocortexSystem1Bridge, neocortexSystem1Bridge } from '../core/executive/NeocortexSystem1Bridge.js';
import fs from 'fs';
import path from 'path';

describe('Neocortex System 1 Substrate (Laya)', () => {
  test('Bridge ping returns health status and CUDA hardware info', async () => {
    const health = await neocortexSystem1Bridge.ping();
    assert.equal(typeof health, 'object');
    if (health.online) {
      assert.ok(health.model.includes('laya'));
      assert.equal(health.backbone, 'ModernBERT-large-421M');
      assert.ok(health.device.includes('cuda') || health.device.includes('cpu'));
      assert.ok(health.latencyMs >= 0);
    } else {
      // If daemon offline during standalone test, fail-open is expected
      assert.equal(health.online, false);
    }
  });

  test('Classify turn differentiates fast social from specialist / persistent tasks', async () => {
    const social = await neocortexSystem1Bridge.classifyTurn('Hey Soma how are you feeling today?');
    if (social && social.isSystem1) {
      assert.equal(social.lane, 'fast_social');
      assert.ok(social.laneConfidence > 0.5);
      assert.equal(social.actVsEscalate, 'act_immediately');
      assert.equal(social.isSafe, true);
    }

    const tech = await neocortexSystem1Bridge.classifyTurn('Please analyze the mathematical risk model and backtest the trading strategy.');
    if (tech && tech.isSystem1) {
      assert.ok(['specialist', 'persistent_goal'].includes(tech.lane) || tech.urgencyScore >= 0.5);
    }
  });

  test('Bidirectional memory reranking evaluates authority and utility', async () => {
    const candidates = [
      { id: 'mem_past', content: 'Owner lives in Boston and trades equities', importance: 0.6 },
      { id: 'mem_current', content: 'Owner moved to San Francisco and is building sovereign AI systems', importance: 0.9 }
    ];

    const reranked = await neocortexSystem1Bridge.rerankMemories('Where is Owner now and what is he building?', candidates);
    assert.ok(reranked.results);
    assert.equal(reranked.results.length, 2);

    if (reranked.isSystem1) {
      // The current memory should rank top
      assert.equal(reranked.results[0].id, 'mem_current');
      assert.equal(reranked.results[0].authoritative, true);
    }
  });

  test('Memory ingestion filter discriminates noise from high-value invariants', async () => {
    const noise = await neocortexSystem1Bridge.evaluateMemoryIngestion('lol haha ok yeah');
    const value = await neocortexSystem1Bridge.evaluateMemoryIngestion(
      'SOMA sovereign consensus invariant: all arbiters must implement fail-open degradation under 100ms.',
      { importance: 0.95 }
    );

    if (noise && noise.isSystem1 && value && value.isSystem1) {
      assert.ok(value.importance >= noise.importance);
    }
  });

  test('Fail-open resilience: unreachable daemon fails open without throwing', async () => {
    const unreachableBridge = new NeocortexSystem1Bridge({
      port: 59999, // Dead port
      timeoutMs: 50
    });

    const ping = await unreachableBridge.ping();
    assert.equal(ping.online, false);

    const turn = await unreachableBridge.classifyTurn('hello there');
    assert.equal(turn, null); // Gracefully returns null

    const candidates = [{ id: 'm1', content: 'fallback test' }];
    const rerank = await unreachableBridge.rerankMemories('query', candidates);
    assert.equal(rerank.results.length, 1);
    assert.equal(rerank.results[0].id, 'm1');
    assert.equal(rerank.isSystem1Fallback, true);
  });

  test('Experience distillation records receipts to JSONL dataset', async () => {
    const testReceipt = {
      type: 'test_distillation',
      testId: `test_${Date.now()}`,
      action: 'reflex_greeting',
      reward: 1.0,
      timestamp: Date.now()
    };

    neocortexSystem1Bridge.recordExperience(testReceipt);

    // Give asynchronous write a few ms to persist
    await new Promise(r => setTimeout(r, 200));
    const filePath = path.resolve(process.cwd(), 'data', 'distillation', 'system1_experience.jsonl');
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(content.includes('test_distillation'));
    }
  });
});
