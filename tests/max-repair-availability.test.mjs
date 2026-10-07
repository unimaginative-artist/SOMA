import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { KnowledgeBase } from '../../MAX/memory/KnowledgeBase.js';
import { SemanticIndex } from '../../MAX/core/SemanticIndex.js';

test('a failed chat-sidecar warmup can retry and restore readiness', async () => {
    const originalFetch = globalThis.fetch;
    let warmups = 0;
    globalThis.fetch = async url => {
        if (url.endsWith('/api/version')) return { ok: true };
        warmups++;
        if (warmups === 1) throw new Error('warmup timeout');
        return { ok: true };
    };
    try {
        const { ensureLocalChatOllamaSidecar } = await import('../core/LocalChatOllamaSidecar.js');
        await assert.rejects(ensureLocalChatOllamaSidecar(), /timeout/);
        assert.equal(globalThis.__SOMA_CHAT_SIDECAR_READY, false);
        await ensureLocalChatOllamaSidecar();
        assert.equal(globalThis.__SOMA_CHAT_SIDECAR_READY, true);
    } finally { globalThis.fetch = originalFetch; }
});

test('semantic index honors disabled boot discovery and keeps cached search ready', () => {
    const old = process.env.MAX_BOOT_DISCOVERY;
    process.env.MAX_BOOT_DISCOVERY = 'false';
    try {
        const index = new SemanticIndex({ kb: { _ready: true }, config: { mode: 'chat' } });
        index.initialize();
        assert.equal(index._ready, true);
        assert.equal(index._bootTimer, undefined);
    } finally {
        if (old === undefined) delete process.env.MAX_BOOT_DISCOVERY;
        else process.env.MAX_BOOT_DISCOVERY = old;
    }
});

test('coalesced vector persistence yields to HTTP work and retains all vectors', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'max-vector-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const kb = Object.create(KnowledgeBase.prototype);
    kb.dbPath = path.join(root, 'knowledge.db');
    kb._vectors = new Map(Array.from({ length: 1200 }, (_, i) => [String(i), [i, 1, 2]]));
    let yielded = false;
    setImmediate(() => { yielded = true; });
    const first = kb._saveVectors();
    kb._vectors.set('new', [7, 8]);
    assert.equal(kb._saveVectors(), first);
    await first;
    assert.equal(yielded, true);
    const saved = JSON.parse(await fs.readFile(path.join(root, 'knowledge_vectors.json'), 'utf8'));
    assert.equal(Object.keys(saved).length, 1201);
    assert.deepEqual(saved.new, [7, 8]);
    assert.equal(kb._vectorSaveError, null);
});

test('source replacement removes only matching FTS chunks and preserves other knowledge', async () => {
    const kb = Object.create(KnowledgeBase.prototype);
    kb._db = new Database(':memory:');
    kb._vectors = new Map([['a1', [1]], ['a2', [2]], ['b1', [3]]]);
    kb._saveVectors = () => {};
    try {
        kb._createSchema();
        kb._db.exec("INSERT INTO kb_sources (id,name,ingested_at) VALUES ('a','A',1),('b','B',1); INSERT INTO kb_chunks (id,source_id,content,chunk_index,ingested_at) VALUES ('a1','a','alpha',0,1),('a2','a','beta',1,1),('b1','b','retained',0,1); INSERT INTO kb_fts(id,content) VALUES ('a1','alpha'),('a2','beta'),('b1','retained');");
        await kb.remove('a');
        assert.deepEqual(kb._db.prepare('SELECT id FROM kb_fts').all(), [{ id: 'b1' }]);
        assert.equal(kb._db.prepare('SELECT COUNT(*) AS n FROM kb_chunks').get().n, 1);
        assert.equal(kb._vectors.has('b1'), true);
    } finally { kb._db.close(); }
});
