// Batch 5 — rendezvous/PEX: peerbook validation, dedup, persistence, dial decisions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GMNPeerBook } from '../server/services/GMNPeerBook.js';

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `gmn5-${label}-`));
const find = (pb, addr) => pb.list().find(p => p.address === addr);

test('peerbook validates, dedups, and persists addresses', () => {
    const file = path.join(tmp('pb'), 'pb.json');
    const pb = new GMNPeerBook({ file });

    assert.ok(pb.remember('1.2.3.4:7777', { source: 'bootstrap' }), 'valid host:port stored');
    assert.equal(pb.remember('not-an-address'), null, 'invalid address rejected');
    assert.equal(pb.remember('host-only'), null, 'missing port rejected');
    assert.equal(pb.size(), 1);

    // Dedup: re-remember attaches a nodeId but preserves the original source.
    pb.remember('1.2.3.4:7777', { nodeId: 'gmn_a', source: 'pex' });
    assert.equal(pb.size(), 1);
    assert.equal(find(pb, '1.2.3.4:7777').nodeId, 'gmn_a');
    assert.equal(find(pb, '1.2.3.4:7777').source, 'bootstrap', 'original source preserved');

    pb.forget('1.2.3.4:7777');
    assert.equal(pb.size(), 0);

    // Persists across instances.
    pb.remember('5.6.7.8:7777');
    assert.equal(new GMNPeerBook({ file }).size(), 1);
});

test('dialTargets excludes self/connected and respects the cap', () => {
    const pb = new GMNPeerBook({ file: path.join(tmp('pb2'), 'pb.json'), maxPeers: 2 });
    pb.remember('a.example:7777', { nodeId: 'gmn_a' });
    pb.remember('b.example:7777', { nodeId: 'gmn_b' });
    pb.remember('self.example:7777');
    pb.remember('c.example:7777', { nodeId: 'gmn_c' });

    const targets = pb.dialTargets({
        connectedNodeIds: new Set(['gmn_a']),                 // 1 of 2 slots used
        connectedAddresses: new Set(['a.example:7777']),
        selfAddresses: new Set(['self.example:7777']),
    });
    assert.ok(!targets.includes('a.example:7777'), 'connected address excluded');
    assert.ok(!targets.includes('self.example:7777'), 'self excluded');
    assert.equal(targets.length, 1, 'cap respected: maxPeers(2) - connected(1) = 1 slot');
    assert.ok(['b.example:7777', 'c.example:7777'].includes(targets[0]));

    // Already at the cap → no dial targets.
    assert.deepEqual(pb.dialTargets({ connectedNodeIds: new Set(['x', 'y']) }), []);
});
