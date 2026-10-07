import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { MnemonicArbiter } from '../arbiters/MnemonicArbiter.js';
import { neocortexSystem1Bridge } from '../core/executive/NeocortexSystem1Bridge.js';

describe('MnemonicArbiter with Bidirectional System 1 Substrate', () => {
  const tempDbPath = path.join(process.cwd(), `test-mnemonic-s1-${Date.now()}.db`);
  let mnemonic;

  before(async () => {
    mnemonic = new MnemonicArbiter({
      name: 'TestMnemonicS1',
      dbPath: tempDbPath,
      redisUrl: null, // Forces mock redis
      skipEmbedder: true, // Use fast lexical + System 1 bidirectional rerank
      system1Bridge: neocortexSystem1Bridge
    });
    await mnemonic.initialize();
  });

  after(async () => {
    try {
      if (mnemonic) mnemonic.destroy();
      if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
    } catch {}
    setTimeout(() => process.exit(0), 50);
  });

  test('MnemonicArbiter has System 1 bridge wired', () => {
    assert.ok(mnemonic.system1Bridge);
    assert.equal(typeof mnemonic.setSystem1Bridge, 'function');
  });

  test('Remember assigns System 1 metadata to high-value memories', async () => {
    const meta = { topic: 'architecture', importance: 0.95 };
    const res = await mnemonic.remember(
      'SOMA executive core operates as a dual-process cognition system: System 1 reflex and System 2 deliberation.',
      meta
    );
    assert.ok(res.success);
    assert.ok(res.id);
    assert.ok(meta.system1Tier);
  });

  test('Recall reranks candidates and resolves memory contradiction via bidirectional cross-attention', async () => {
    // Store two memories touching the same subject across time
    await mnemonic.remember('SOMA primary trading timeframe was strictly set to 1-minute scalping.', {
      topic: 'trading_timeframe',
      importance: 0.5
    });

    await mnemonic.remember('SOMA trading timeframe was upgraded to 4-hour trend-following with regime volatility filtering.', {
      topic: 'trading_timeframe',
      importance: 0.95
    });

    const recalled = await mnemonic.recall('What is SOMA primary trading timeframe strategy?', 5);
    assert.ok(recalled.results);
    assert.ok(recalled.results.length >= 2);

    // The upgraded 4-hour trend-following memory should be ranked first
    const topResult = recalled.results[0];
    assert.ok(topResult.content.includes('4-hour trend-following'));
    assert.equal(topResult.authoritative, true);
  });

  test('Recall fails open cleanly if System 1 is offline or disabled', async () => {
    const offlineMnemonic = new MnemonicArbiter({
      name: 'TestOfflineMnemonic',
      dbPath: tempDbPath,
      redisUrl: null,
      skipEmbedder: true,
      system1Bridge: null // No bridge
    });
    await offlineMnemonic.initialize();

    const recalled = await offlineMnemonic.recall('trading timeframe', 3);
    assert.ok(recalled.results);
    assert.ok(recalled.results.length >= 1);
    offlineMnemonic.destroy();
  });
});
