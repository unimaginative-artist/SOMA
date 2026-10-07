import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import assert from 'assert';

console.log('🧪 Running Discord Real-time Awareness Test...');

// Mock GoalPlanner
const mockGoalPlanner = {
    getActiveGoals: async () => {
        return [
            { id: 'goal-1', title: 'Optimize portfolio risk models', priority: 0.9 },
            { id: 'goal-2', title: 'Verify neural routing latencies', priority: 0.7 }
        ];
    }
};

// Mock Brain
let lastQueriedPrompt = null;
const mockBrain = {
    processQuery: async (content, context) => {
        lastQueriedPrompt = content;
        return { response: 'Mocked Brain Response', text: 'Mocked Brain Response' };
    },
    reason: async (prompt, options) => {
        lastQueriedPrompt = prompt;
        return { response: 'Mocked Brain Response', text: 'Mocked Brain Response' };
    }
};

async function run() {
    const arbiter = new DiscordArbiter({
        name: 'Test-Discord-Arbiter',
        token: 'mock-token',
        goalPlanner: mockGoalPlanner,
        brain: mockBrain
    });

    // Test own work pattern matching
    const testQueries = [
        "what are you working on?",
        "what did you do today?",
        "how was your day?",
        "are you trading right now?",
        "what's in your ledger?",
        "what are SOMA's current goals?"
    ];

    console.log('\nChecking own work query classification:');
    for (const q of testQueries) {
        const isOwnWork = arbiter._isOwnWorkQuestion(q);
        console.log(`  "${q}" => isOwnWork? ${isOwnWork}`);
        assert.ok(isOwnWork, `Query "${q}" should match as an own work question`);
    }

    // Call _askBrain to trigger prompt synthesis
    console.log('\nTesting prompt injection in _askBrain...');
    await arbiter._askBrain('tell me about your day', { author: 'owner' });

    assert.ok(lastQueriedPrompt, 'Brain should have been queried with a prompt');
    console.log('\nGenerated Prompt Preview:\n-------------------------');
    console.log(lastQueriedPrompt);
    console.log('-------------------------');

    // Assert that prompt contains active goals
    assert.ok(lastQueriedPrompt.includes('Optimize portfolio risk models'), 'Prompt should include active goals');
    assert.ok(lastQueriedPrompt.includes('Priority: 0.9'), 'Prompt should include goal priority');

    // Assert that prompt contains recent work logs
    assert.ok(lastQueriedPrompt.includes('Recent Autonomic Work Ledger:'), 'Prompt should include ledger header');
    assert.ok(lastQueriedPrompt.includes('Autonomous chat update'), 'Prompt should include actual work entries');

    // Assert that prompt contains auto-trading status
    assert.ok(lastQueriedPrompt.includes('Auto-Trading Status:'), 'Prompt should include trading status header');
    assert.ok(lastQueriedPrompt.includes('Mode: PAPER'), 'Prompt should include paper trading mode');
    assert.ok(lastQueriedPrompt.includes('TLT'), 'Prompt should include TLT symbol from active strategy');
    assert.ok(lastQueriedPrompt.includes('70.73%'), 'Prompt should include win rate percentage');

    // Assert that prompt contains positions and completed trade sections
    assert.ok(lastQueriedPrompt.includes('Active Open Positions:'), 'Prompt should include active open positions header');
    assert.ok(lastQueriedPrompt.includes('Recent Completed/Entry Trades:'), 'Prompt should include recent trades header');

    console.log('\n✅ All assertions passed successfully!');
}

run().catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
});
