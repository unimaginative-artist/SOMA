
import messageBroker from '../core/MessageBroker.js';

console.log('🚀 MANUALLY TRIGGERING SOMA SOUL CYCLE...');

async function test() {
    try {
        await messageBroker.sendMessage({
            from: 'CLI_TEST',
            to: 'InternalInstinctCore',
            type: 'process_soul_cycle',
            payload: { force: true }
        });
        console.log('✅ Message Sent. Check server logs for distillation results.');
    } catch (e) {
        console.error('❌ Failed to trigger:', e.message);
    }
    process.exit(0);
}

test();
