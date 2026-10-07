import { DiscordArbiter } from '../arbiters/DiscordArbiter.js';
import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const messageBroker = require('../core/MessageBroker.cjs');

console.log('🧪 Running Discord Proactive Notification Test...');

async function run() {
    const arbiter = new DiscordArbiter({
        name: 'Test-Discord-Proactivity',
        token: 'mock-token',
        masterId: 'mock-master-id'
    });

    // Mock SOMA Brain for initialization
    const mockBrain = {
        processQuery: async () => ({ text: 'Mock response' }),
        reason: async () => ({ text: 'Mock response' })
    };
    arbiter.brain = mockBrain;

    // Run initialization (this will subscribe to messageBroker's soma_proactive topic)
    // We mock FS directory creation or skip errors
    await arbiter.onInitialize().catch(err => {
        console.log('ℹ️ Initialization connect failed as expected with mock token, continuing test setup...');
    });

    // Setup mock client and connection state
    const sentMessages = [];
    const mockUser = {
        send: async (msg) => {
            sentMessages.push(msg);
            return true;
        }
    };
    const mockClient = {
        users: {
            fetch: async (id) => {
                if (id === 'mock-master-id') return mockUser;
                throw new Error('User not found');
            }
        }
    };

    arbiter.client = mockClient;
    arbiter.connected = true; // Pretend we are connected

    console.log('\nTesting direct master message sending...');
    const directResult = await arbiter.sendMasterMessage('Test message direct send');
    assert.ok(directResult, 'sendMasterMessage should return true on success');
    assert.strictEqual(sentMessages.length, 1, 'One message should be sent');
    assert.strictEqual(sentMessages[0], 'Test message direct send', 'Message content should match');
    console.log('✅ Direct send passed');

    console.log('\nTesting MessageBroker publish subscription routing...');
    
    // Publish mock event to MessageBroker
    await messageBroker.publish('soma_proactive', {
        from: 'AutonomousHeartbeat',
        to: 'broadcast',
        type: 'soma_proactive',
        payload: { message: '[Working] Just finished background trading scan: Win rate stable.' }
    });

    // Allow some time for callback microtask execution (though publish is async and we awaited it)
    assert.strictEqual(sentMessages.length, 2, 'A second message should have been delivered from the broker');
    assert.strictEqual(sentMessages[1], '[Working] Just finished background trading scan: Win rate stable.', 'Broker routed message content should match');
    console.log('✅ MessageBroker subscription routing passed');

    console.log('\n✅ All proactive notification assertions passed successfully!');
    process.exit(0);
}

run().catch(err => {
    console.error('\n❌ Test failed:', err);
    process.exit(1);
});
