import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NemesisArbiter } from '../arbiters/NemesisArbiter.js';

test('isolated NEMESIS review names only available tools and renders an evidence-based verdict', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-nemesis-candidate-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await fs.mkdir(path.join(root, 'core'));
    await fs.writeFile(path.join(root, 'core/candidate.js'), 'export const candidate = true;\n');
    const reviewer = new NemesisArbiter();
    let calls = 0;
    reviewer._callBrain = async prompt => {
        calls++;
        assert.match(prompt, /render_verdict/);
        assert.doesNotMatch(prompt, /run_sandboxed_benchmark|list_files/);
        if (calls === 1) return 'THINK: Inspect the actual candidate.\nTOOL: read_file\nARGS: {"filepath":"core/candidate.js"}';
        if (calls === 2) return 'THINK: Confirm syntax independently.\nTOOL: check_syntax\nARGS: {"filepath":"core/candidate.js"}';
        return 'THINK: The inspected candidate parses and retains its export.\nTOOL: render_verdict\nARGS: {"score":0.8,"feedback":"The candidate parses and retains its export.","falsificationTest":"node --check core/candidate.js succeeds","suggestedFix":null}';
    };
    const result = await reviewer.evaluateCandidate(root, 'core/candidate.js', 'Retain the export', 'Bounded repair');
    assert.equal(result.score, 0.8);
    assert.equal(calls, 3);
    assert.equal(result.steps, 3);
});
