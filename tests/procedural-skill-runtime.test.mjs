import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProceduralMemory } from '../core/ProceduralMemory.js';
import { SkillCompiler } from '../core/SkillCompiler.js';

test('verified action repetition becomes reusable procedural memory and a governed skill candidate', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-procedure-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const memory = await new ProceduralMemory({ statePath: path.join(root, 'memory.json') }).initialize();
    for (let index = 0; index < 3; index++) {
        await memory.recordCase({
            source: 'test', sourceId: `run-${index}`, domain: 'research',
            task: 'Research battery chemistry and write a sourced report',
            tools: ['computer_search', 'read_file', 'web_fetch', 'write_file'],
            success: true, verified: true, evidence: { passed: true }
        });
    }
    const recalled = memory.retrieve({ task: 'research battery chemistry then write the report', domain: 'research' });
    assert.equal(recalled[0].verifiedSuccesses, 3);
    assert.deepEqual(recalled[0].recommendedTools, ['computer_search', 'read_file', 'web_fetch', 'write_file']);

    const compiler = await new SkillCompiler({
        proceduralMemory: memory,
        registryPath: path.join(root, 'registry.json'),
        skillDir: path.join(root, 'skills')
    }).initialize();
    const compiled = await compiler.compileEligible();
    assert.equal(compiled.length, 1);
    assert.equal(compiled[0].status, 'candidate');
    assert.equal(compiled[0].execution.arbitraryCodeAllowed, false);
    assert.equal(compiled[0].execution.completionEvidenceRequired, true);
    assert.equal((await fs.readdir(path.join(root, 'skills'))).length, 1);
});

test('unsafe tool sequences are never compiled into reusable skills', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-procedure-unsafe-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const memory = await new ProceduralMemory({ statePath: path.join(root, 'memory.json') }).initialize();
    for (let index = 0; index < 3; index++) {
        await memory.recordCase({ domain: 'social', task: 'publish a post', tools: ['publish_social'], success: true, verified: true });
    }
    const compiler = await new SkillCompiler({ proceduralMemory: memory, registryPath: path.join(root, 'registry.json'), skillDir: path.join(root, 'skills') }).initialize();
    assert.deepEqual(await compiler.compileEligible(), []);
    assert.equal(compiler.getStatus().candidates, 0);
});
