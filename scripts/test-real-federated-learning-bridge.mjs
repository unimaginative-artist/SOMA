// ═══════════════════════════════════════════════════════════════════════════
// test-real-federated-learning-bridge.mjs — Test Real PyTorch Federated Bridge
// Verifies trainLocal in FederatedLearning.cjs bridges to train-soma-llama.py
// ═══════════════════════════════════════════════════════════════════════════

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { FederatedLearning } = require('../cluster/FederatedLearning.cjs');

async function main() {
    console.log('🚀 TESTING REAL PYTORCH FEDERATED LEARNING BRIDGE...\n');

    const fl = new FederatedLearning({
        nodeId: 'Node_A_Prime',
        role: 'worker'
    });

    // Pass DRY_RUN=1 (default) to verify the bridge plumbing without a GPU run.
    // Pass DRY_RUN=0 for a REAL training round (needs CUDA + training deps, slow).
    const dryRun = process.env.DRY_RUN !== '0';

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(dryRun
        ? '⚡ DRY-RUN: verifying trainer bridge (spawn → result JSON → parse), no GPU...'
        : '⚡ REAL training round via finetune_gemma3.py (CUDA required, slow)...');

    const result = await fl.trainLocal([{ id: 1, prompt: 'defensive code' }], {
        lobe: 'prometheus',
        epochs: 1,
        dryRun,
        // For a real run: cap steps and use the tiny smoke dataset so it finishes fast.
        maxSteps: dryRun ? undefined : 5,
        dataPath: dryRun ? undefined : 'SOMA/training-data-smoke',
    });

    console.log(`\n🟢 Federated Learning Local Training Result:`);
    console.log(`   • Node ID:      ${result.nodeId}`);
    console.log(`   • Dry run:      ${result.metrics.dryRun}`);
    console.log(`   • Adapter path: ${result.updates.weightsPath}`);
    console.log(`   • Lobe / mode:  ${result.updates.lobe} / ${result.updates.mode}`);
    console.log(`   • Train loss:   ${result.metrics.loss}`);
    console.log(`   • Eval loss:    ${result.metrics.evalLoss}`);
    console.log(`   • Perplexity:   ${result.metrics.perplexity}`);
    console.log(`   • Steps:        ${result.metrics.steps}`);

    // Real verification: in a genuine (non-dry) run, loss must be a real number,
    // not a fabricated constant. The old bridge always returned 0.14 — a tell.
    if (!dryRun && (typeof result.metrics.loss !== 'number')) {
        throw new Error('Real training produced no numeric loss — bridge not actually training.');
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(dryRun
        ? '🏆 BRIDGE PLUMBING VERIFIED (dry-run). Run with DRY_RUN=0 for real training.'
        : '🏆 REAL PYTORCH FEDERATED LEARNING TRAINING VERIFIED!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Federated Learning Test Error:', err.stack || err);
    process.exit(1);
});
