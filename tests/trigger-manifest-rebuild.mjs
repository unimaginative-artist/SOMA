import ArbiterLoader from '../core/ArbiterLoader.js';

async function rebuild() {
    console.log('🔄 Triggering Arbiter manifest rebuild...');
    try {
        const loader = new ArbiterLoader();
        await loader.initialize();
        console.log('⏳ Running manifest rebuild scan...');
        await loader._buildManifest();
        console.log('🎉 Manifest rebuild complete! SOMA now registers all new arbiters and their capabilities.');
        process.exit(0);
    } catch (e) {
        console.error('❌ Failed to rebuild manifest:', e.message);
        process.exit(1);
    }
}

rebuild();
