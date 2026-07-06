import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOMA_DIR = path.resolve(__dirname, '..');
const MAX_DIR = path.resolve(__dirname, '../../MAX');
const DUMMY_FILE = path.join(SOMA_DIR, 'scratch', 'dummy_edit_test.js');

async function checkHealth(url, name) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${url}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return res.ok;
    } catch {
        return false;
    }
}

async function run() {
    console.log('🧪 Testing Tandem SOMA-MAX self-modification pipeline...');
    
    // 1. Create a dummy file for SOMA to edit
    await fs.writeFile(DUMMY_FILE, '// Original file\nexport const TEST_VAL = 1;\n', 'utf8');
    console.log(`✅ Created dummy file for test: ${DUMMY_FILE}`);

    // 2. We can load SomaController from MAX to verify MAX can start SOMA
    console.log(`\n--- Testing MAX controlling SOMA ---`);
    const SomaControllerPath = path.join(MAX_DIR, 'core', 'SomaController.js');
    const somaControllerExists = await fs.access(SomaControllerPath).then(() => true).catch(() => false);
    if (!somaControllerExists) {
        console.error('❌ MAX SomaController.js not found at ' + SomaControllerPath);
        process.exit(1);
    }
    
    // Load MAX's controller dynamically
    const SomaController = await import(pathToFileURL(SomaControllerPath).href);
    console.log('✅ Loaded MAX SomaController');
    
    // Test MAX stopping SOMA
    console.log('🛑 Telling MAX to stop SOMA...');
    await SomaController.stopSoma();
    console.log('✅ SOMA stopped via MAX');
    
    // Test MAX starting SOMA
    console.log('🚀 Telling MAX to start SOMA...');
    const startResult = await SomaController.startSoma();
    console.log('✅ startSoma result:', startResult);
    
    console.log('⏳ Waiting 10s for SOMA to boot...');
    await new Promise(r => setTimeout(r, 10000));
    
    const somaHealthy = await checkHealth(startResult.url, 'SOMA');
    console.log(`✅ SOMA health check (${startResult.url}): ${somaHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    
    // 3. Test SOMA controlling MAX
    console.log(`\n--- Testing SOMA controlling MAX ---`);
    console.log('🛑 Stopping MAX (if running)...');
    try { await fetch('http://127.0.0.1:3100/api/shutdown', { method: 'POST' }).catch(()=>{}); } catch {}
    await new Promise(r => setTimeout(r, 2000));
    
    const { default: SelfModificationArbiter } = await import(pathToFileURL(path.join(SOMA_DIR, 'arbiters', 'SelfModificationArbiter.cjs')).href);
    const arbiter = new SelfModificationArbiter({ 
        name: 'TestSelfMod',
        maxUrl: 'http://127.0.0.1:3100', // Need this for ensureMaxActive
        system: { 
            maxApprovalShim: { requestApproval: async () => ({ approved: true, reason: 'Test approval' }) }
        }
    });
    // Set properties that might be missed by config
    arbiter.maxUrl = 'http://127.0.0.1:3100';
    
    console.log('🚀 Telling SOMA to start MAX...');
    await arbiter.ensureMaxActive();
    
    console.log('⏳ Waiting 5s for MAX to boot...');
    await new Promise(r => setTimeout(r, 5000));
    
    const maxHealthy = await checkHealth('http://127.0.0.1:3100', 'MAX');
    console.log(`✅ MAX health check: ${maxHealthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    
    // 4. Test the actual edit pipeline
    console.log(`\n--- Testing SOMA Self-Modification Pipeline ---`);
    const { default: EngineeringSwarmArbiter } = await import(pathToFileURL(path.join(SOMA_DIR, 'arbiters', 'EngineeringSwarmArbiter.js')).href);
    const eng = new EngineeringSwarmArbiter({ 
        name: 'TestEngSwarm', 
        system: { } 
    });
    const { MaxApprovalShim } = await import(pathToFileURL(path.join(SOMA_DIR, 'arbiters', 'MaxApprovalShim.js')).href);
    const shim = new MaxApprovalShim({ name: 'MaxApprovalShim', logger: console });
    const { default: maxBridgeSingleton } = await import(pathToFileURL(path.join(SOMA_DIR, 'core', 'MaxAgentBridge.js')).href);
    await shim.initialize({ maxAgentBridge: maxBridgeSingleton });
    eng.system = { maxApprovalShim: shim };
    
    console.log('📩 Requesting MAX approval via MaxApprovalShim...');
    const oldCode = '// Original file\nexport const TEST_VAL = 1;\n';
    const newCode = '// Original file\nexport const TEST_VAL = 2; // EDITED BY SOMA\n';
    
    const proposeRes = await shim.requestApproval({ 
        filepath: DUMMY_FILE,
        request: 'Change TEST_VAL to 2',
        oldCode,
        newCode
    });
    
    console.log(`✅ Shim response:`, proposeRes);

    console.log('\n✅ Tandem test complete.');
    process.exit(0);
}

run().catch(e => {
    console.error('❌ Test failed:', e);
    process.exit(1);
});
