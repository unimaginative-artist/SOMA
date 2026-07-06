import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArchitectureReorganizationService } from '../core/ArchitectureReorganizationService.js';

async function fixture({ referenced = false } = {}) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-reorg-'));
    await fs.mkdir(path.join(root, 'core'), { recursive: true });
    await fs.mkdir(path.join(root, 'data', 'architecture-census'), { recursive: true });
    await fs.writeFile(path.join(root, 'core', 'UnusedModule.js'), 'export const unused = true;\n', 'utf8');
    if (referenced) {
        await fs.writeFile(path.join(root, 'core', 'Consumer.js'), "import './UnusedModule.js';\n", 'utf8');
    }
    await fs.writeFile(path.join(root, 'data', 'architecture-census', 'latest.json'), JSON.stringify({
        modules: [{
            path: 'core/UnusedModule.js',
            classification: 'candidate-unused',
            evidence: ['No runtime registration found', 'No known entrypoint dependency']
        }]
    }), 'utf8');
    return root;
}

test('census-confirmed unreferenced source can be quarantined with a Poseidon receipt', async () => {
    const root = await fixture();
    const service = new ArchitectureReorganizationService({ root });
    try {
        const staged = await service.plan({ source: 'core/UnusedModule.js' });
        assert.equal(staged.success, true);
        assert.equal(await fs.stat(path.join(root, 'core', 'UnusedModule.js')).then(() => true), true);

        const result = await service.apply({
            planPath: staged.planPath,
            confirmationToken: staged.plan.confirmationToken
        });
        assert.equal(result.success, true, JSON.stringify(result));
        await assert.rejects(fs.access(path.join(root, 'core', 'UnusedModule.js')));
        await fs.access(path.join(root, '.soma-quarantine', 'architecture-unused', 'core', 'UnusedModule.js'));
        const receipt = JSON.parse(await fs.readFile(path.join(root, result.receiptPath), 'utf8'));
        assert.equal(receipt.outcome.poseidon.state, 'TRUE');
        assert.equal(receipt.plan.deleteAllowed, false);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('reference scan blocks quarantine even when census says candidate-unused', async () => {
    const root = await fixture({ referenced: true });
    const service = new ArchitectureReorganizationService({ root });
    try {
        await assert.rejects(
            service.plan({ source: 'core/UnusedModule.js' }),
            /still has code references/i
        );
        await fs.access(path.join(root, 'core', 'UnusedModule.js'));
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});

test('protected runtime files cannot enter a reorganization plan', async () => {
    const root = await fixture();
    await fs.writeFile(path.join(root, 'core', 'ASIKernel.js'), 'export const kernel = true;\n', 'utf8');
    const service = new ArchitectureReorganizationService({ root });
    try {
        await assert.rejects(service.plan({ source: 'core/ASIKernel.js' }), /Protected runtime file/);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
});
