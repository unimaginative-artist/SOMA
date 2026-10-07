
try {
    console.log('Checking internal modules...');
    const BaseArbiter = require('../core/BaseArbiter.cjs');
    console.log('✅ BaseArbiter loaded');
    const MessageBroker = require('../core/MessageBroker.cjs');
    console.log('✅ MessageBroker loaded');

    console.log('Checking external dependencies...');
    try { require('puppeteer'); console.log('✅ puppeteer loaded'); } catch (e) { console.error('❌ puppeteer missing'); }
    try { require('screenshot-desktop'); console.log('✅ screenshot-desktop loaded'); } catch (e) { console.error('❌ screenshot-desktop missing'); }
    try { require('@nut-tree/nut-js'); console.log('✅ @nut-tree/nut-js loaded'); } catch (e) { console.error('❌ @nut-tree/nut-js missing', e.message); }

} catch (err) {
    console.error('CRITICAL ERROR:', err);
}
