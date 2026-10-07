import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { consolidateReflections } from '../core/ReflectionConsolidator.js';
import { MemoryDistillerDaemon } from '../daemons/MemoryDistillerDaemon.js';

const require = createRequire(import.meta.url);
const AutonomousLoop = require('../cognitive/AutonomousLoop.cjs');
const { SoulArbiter } = require('../arbiters/SoulArbiter.cjs');
const { inspectModelResult } = require('../core/ModelResultGuard.cjs');

const overload = {
    text: 'My local brain is overloaded right now, so I stopped this turn instead of leaving you waiting. Retry in a moment.',
    degraded: true,
    retryable: true,
    errorCode: 'LOCAL_CHAT_TIMEOUT'
};

test('model result guard rejects degraded metadata and runtime prose', () => {
    assert.equal(inspectModelResult(overload).usable, false);
    assert.equal(inspectModelResult(overload.text).usable, false);
    assert.equal(inspectModelResult({ text: 'A specific and useful reflection.' }).usable, true);
});

test('autonomous reflection loop fails closed on provider overload', async () => {
    const loop = new AutonomousLoop({ brain: { reason: async () => overload } });
    await assert.rejects(() => loop.run('A real stimulus'), /reflection_analysis:degraded_model_result/);
});

test('manual consolidation does not write a paper from degraded output', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-reflection-paper-'));
    const result = await consolidateReflections({
        soul: { getAllReflections: () => [{ feeling: 'I learned to preserve uncertainty.' }] },
        brain: { reason: async () => overload },
        root: dir,
        outDir: path.join(dir, 'out')
    });
    assert.equal(result.success, false);
    await assert.rejects(() => fs.access(path.join(dir, 'out')));
    await fs.rm(dir, { recursive: true, force: true });
});

test('soul condensation archives raw reflections before replacing them', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-soul-'));
    const soul = new SoulArbiter({
        statePath: path.join(dir, 'soul.json'),
        archivePath: path.join(dir, 'archive.jsonl'),
        maxEntries: 10
    });
    soul.initialize();
    soul.reflect('First useful private reflection.');
    soul.reflect('Second useful private reflection.');
    soul.reflect('Keep this newest reflection.');
    const source = soul.getAllReflections().slice(0, 2);
    const digest = soul.condenseReflections({ entries: source, summary: 'I learned one durable lesson from the first two reflections.' });
    soul.flush();

    assert.equal(digest.sourceCount, 2);
    assert.equal(soul.getAllReflections().length, 2);
    assert.equal(soul.getCondensationStatus().condensed, 1);
    const archived = (await fs.readFile(path.join(dir, 'archive.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(archived.length, 2);
    assert.ok(archived.every(row => row.reason === 'reflection_condensation'));
    await fs.rm(dir, { recursive: true, force: true });
});

test('automatic soul condensation preserves entries on failure and commits valid synthesis', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-soul-distiller-'));
    const soul = new SoulArbiter({ statePath: path.join(dir, 'soul.json'), archivePath: path.join(dir, 'archive.jsonl') });
    soul.initialize();
    for (const text of ['One', 'Two', 'Three', 'Four']) soul.reflect(`${text} meaningful reflection about ongoing work.`);
    soul.entries.forEach((entry, index) => { entry.ts = Date.now() - 10_000 - index; });
    let response = overload;
    const distilled = [];
    const daemon = new MemoryDistillerDaemon({
        system: { soul, quadBrain: { _callProviderCascade: async () => response } },
        soulMinEntries: 4,
        soulKeepRecent: 1,
        soulMinAgeMs: 0,
        distillReflection: async packet => distilled.push(packet)
    });

    await assert.rejects(() => daemon._distillSoulReflections(), /reflection_condensation:degraded_model_result/);
    assert.equal(soul.getAllReflections().length, 4);

    response = { text: 'I keep returning to one grounded lesson, while preserving an unresolved next step.' };
    const result = await daemon._distillSoulReflections();
    soul.flush();
    assert.equal(result.ok, true);
    assert.equal(soul.getAllReflections().length, 2);
    assert.equal(distilled.length, 1);
    await fs.rm(dir, { recursive: true, force: true });
});
