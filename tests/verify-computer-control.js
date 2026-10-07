import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// tests/verify-computer-control.js
const { ComputerControlArbiter } = require('../arbiters/ComputerControlArbiter.js');
const fs = require('fs');
const path = require('path');

async function test() {
    console.log('🧪 Starting ComputerControlArbiter Verification...');

    // 1. Instantiate
    const arbiter = new ComputerControlArbiter({
        name: 'Test-ComputerControl',
        safetyEnabled: true,
        dryRun: true // IMPORTANT: Dry run to prevent actual mouse movement during test
    });

    // 2. Initialize
    console.log('...Initializing...');
    await arbiter.initialize();
    console.log('✅ Initialization complete.');

    // 3. Test Screen Capture
    console.log('...Testing Screen Capture...');
    try {
        const result = await arbiter.captureScreen();
        if (result.success && fs.existsSync(result.imagePath)) {
            console.log(`✅ Screen capture successful: ${result.imagePath}`);
            // Clean up
            // fs.unlinkSync(result.imagePath); 
        } else {
            console.error('❌ Screen capture failed:', result.error);
        }
    } catch (err) {
        console.error('❌ Screen capture exception:', err);
    }

    // 4. Test Mouse Action (Dry Run)
    console.log('...Testing Mouse Move (Dry Run)...');
    const moveResult = await arbiter.executeAction({ type: 'mouse_move', x: 100, y: 100 });
    if (moveResult.success) {
        console.log('✅ Mouse move accepted (Dry Run)');
    } else {
        console.error('❌ Mouse move failed:', moveResult.error);
    }

    // 5. Test Browser Launch
    console.log('...Testing Browser Launch...');
    const browserResult = await arbiter.handleBrowserAction({ action: 'launch', headless: true });
    if (browserResult.success) {
        console.log('✅ Browser launch successful');
        await arbiter.handleBrowserAction({ action: 'close' });
    } else {
        console.error('❌ Browser launch failed:', browserResult.error);
    }

    console.log('🎉 Verification Complete');
    process.exit(0);
}

test();
