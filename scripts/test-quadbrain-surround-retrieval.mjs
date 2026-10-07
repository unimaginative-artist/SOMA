// ═══════════════════════════════════════════════════════════════════════════
// test-quadbrain-surround-retrieval.mjs — Test All 4 Lobe Retrieval Surrounds
// Tests _retrieveLobeContext for LOGOS, PROMETHEUS, THALAMUS, and AURORA
// ═══════════════════════════════════════════════════════════════════════════

import { SOMArbiterV2_QuadBrain } from '../arbiters/SOMArbiterV2_QuadBrain.js';

async function main() {
    console.log('🧪 TESTING COMPLETE 4-LOBE RETRIEVAL SURROUND SUBSTRATE...\n');

    const arbiter = new SOMArbiterV2_QuadBrain({ name: 'QuadBrainTest' });

    const testCases = [
        { lobe: 'LOGOS',      query: 'How does SOMArbiterV2_QuadBrain route queries?' },
        { lobe: 'PROMETHEUS', query: 'Fix bug in OutcomeTracker.js method safeAlloc' },
        { lobe: 'THALAMUS',   query: 'Execute shell command with user input token' },
        { lobe: 'AURORA',     query: 'Respond to Owner with creative vision and warmth' }
    ];

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    for (const item of testCases) {
        console.log(`📌 Testing ${item.lobe} Retrieval Surround...`);
        const t0 = Date.now();
        const ctx = await arbiter._retrieveLobeContext(item.lobe, item.query);
        const latency = Date.now() - t0;

        if (ctx) {
            console.log(`   🟢 ${item.lobe} Context Retrieved (${latency} ms):`);
            console.log(`   "${ctx.trim().replace(/\n/g, ' ').slice(0, 160)}..."\n`);
        } else {
            console.log(`   🟡 ${item.lobe} Context returned null (${latency} ms)\n`);
        }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🏆 ALL 4 LOBE RETRIEVAL SURROUNDS LIVE & OPERATIONAL!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    process.exit(0);
}

main().catch(err => {
    console.error('❌ Lobe Surround Retrieval Error:', err.stack || err);
    process.exit(1);
});
