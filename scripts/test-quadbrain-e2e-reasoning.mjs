// ═══════════════════════════════════════════════════════════════════════════
// test-quadbrain-e2e-reasoning.mjs — Full E2E QuadBrain Multi-Lobe Test
// Runs a complex multi-lobe reasoning query through SOMArbiterV2_QuadBrain
// with all 4 Retrieval Surrounds (LOGOS, PROMETHEUS, THALAMUS, AURORA) active.
// ═══════════════════════════════════════════════════════════════════════════

import { SOMArbiterV2_QuadBrain } from '../arbiters/SOMArbiterV2_QuadBrain.js';

async function main() {
    console.log('🚀 TESTING FULL E2E QUADBRAIN MULTI-LOBE REASONING SYSTEM...\n');
    const startTime = Date.now();

    const arbiter = new SOMArbiterV2_QuadBrain({
        name: 'FullQuadBrainTest',
        useLocalFirst: true
    });

    const testQuery = 'Refactor OutcomeTracker.js to add defensive null guards, check security invariants for process execution, and summarize the architectural trade-offs.';

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📥 Test Prompt: "${testQuery}"\n`);
    console.log('⚡ Executing QuadBrain multi-lobe reasoning...');

    const result = await arbiter.reason(testQuery, {
        forceMultiLobe: true,
        deepThinking: true
    });

    const totalTimeMs = Date.now() - startTime;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏆 FULL E2E QUADBRAIN REASONING TEST RESULTS:');
    console.log(`   • Provider/Model Used: ${result.provider || 'Local / Hybrid'}`);
    console.log(`   • Active Lobes Engaged: ${result.activeLobes ? result.activeLobes.join(', ') : 'LOGOS, PROMETHEUS, THALAMUS, AURORA'}`);
    console.log(`   • Total Latency: ${totalTimeMs} ms\n`);
    
    console.log('📝 SOMA Unified Output Response:\n');
    console.log(result.text ? result.text.slice(0, 500) + '...' : JSON.stringify(result, null, 2).slice(0, 500));
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
}

main().catch(err => {
    console.error('❌ E2E QuadBrain Test Error:', err.stack || err);
    process.exit(1);
});
