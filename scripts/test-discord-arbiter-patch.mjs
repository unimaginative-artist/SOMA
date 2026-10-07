import DiscordArbiter from '../arbiters/DiscordArbiter.js';
import assert from 'assert';

console.log('=== Running DiscordArbiter Patch Verification ===\n');

const arbiter = new DiscordArbiter({
    log: () => {},
    on: () => {},
    emit: () => {}
});

// Test 1: File listing regex
console.log('1. Testing _isFileListingRequest...');
const shouldNotList = [
    'No i dont but you should have full access to your file system you should be able to see your soma-promethus v3 lobe',
    'Are you able to execute any of these plans within this file?',
    'What is inside this file?',
    'Can you see this file?',
    'Tell me what this file does',
    'Can you fix this file?',
    'I dont have any files for you'
];

for (const phrase of shouldNotList) {
    const res = arbiter._isFileListingRequest(phrase);
    assert.strictEqual(res, false, `Expected false for "${phrase}", got ${res}`);
    console.log(`  ✅ Ignored non-listing conversational query: "${phrase.slice(0, 45)}..."`);
}

const shouldList = [
    'list your files',
    'show all files',
    'please list the files',
    'what files do you have',
    'what markdown files exist',
    'what other files do you have besides soul.md',
    'list markdown files',
    'show directory'
];

for (const phrase of shouldList) {
    const res = arbiter._isFileListingRequest(phrase);
    assert.strictEqual(res, true, `Expected true for "${phrase}", got ${res}`);
    console.log(`  ✅ Correctly triggered file listing: "${phrase}"`);
}

// Test 2: _resolveExistingPath
console.log('\n2. Testing _resolveExistingPath...');
async function testPaths() {
    const hallucinated1 = await arbiter._resolveExistingPath('trading-strategy.js');
    assert.strictEqual(hallucinated1, null, 'Expected trading-strategy.js to be null');
    console.log('  ✅ Hallucinated trading-strategy.js correctly resolved to null');

    const hallucinated2 = await arbiter._resolveExistingPath('./aurora-lobes/trading-strategy.js');
    assert.strictEqual(hallucinated2, null, 'Expected ./aurora-lobes/trading-strategy.js to be null');
    console.log('  ✅ Hallucinated aurora-lobes path correctly resolved to null');

    const real1 = await arbiter._resolveExistingPath('DiscordArbiter.js');
    assert.ok(real1 && real1.includes('DiscordArbiter.js'), `Expected real DiscordArbiter.js, got ${real1}`);
    console.log(`  ✅ Real bare file DiscordArbiter.js resolved to: ${real1}`);

    const real2 = await arbiter._resolveExistingPath('AutonomousTrader.js');
    assert.ok(real2 && real2.toLowerCase().includes('autonomoustrader.js'), `Expected real AutonomousTrader.js, got ${real2}`);
    console.log(`  ✅ Real bare file AutonomousTrader.js resolved to: ${real2}`);

    const real3 = await arbiter._resolveExistingPath('arbiters/AttentionArbiter.js');
    assert.ok(real3 && real3.includes('AttentionArbiter.js'), `Expected AttentionArbiter.js, got ${real3}`);
    console.log(`  ✅ Real relative path AttentionArbiter.js resolved to: ${real3}`);
}

await testPaths();

console.log('\n🎉 ALL TESTS PASSED! DiscordArbiter patch verified successfully.');
process.exit(0);
