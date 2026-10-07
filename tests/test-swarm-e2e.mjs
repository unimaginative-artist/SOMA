import dotenv from 'dotenv';
import { SomaBootstrap } from '../core/SomaBootstrap.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

async function runTest() {
  console.log('🧪 Starting Live Swarm E2E Integration Test...\n');
  
  let system;
  const targetFile = 'arbiters/test_sandbox_target.js';
  const fullTargetPath = path.join(process.cwd(), targetFile);

  try {
    // 1. Prepare target file with simple original code
    console.log('📝 Preparing target file: arbiters/test_sandbox_target.js');
    const originalCode = `// Test target for sandbox debate verification
export function calculateSum(a, b) {
  return a + b;
}
`;
    await fs.writeFile(fullTargetPath, originalCode, 'utf8');

    // 2. Initialize SOMA
    console.log('1️⃣ Booting SOMA in test mode...');
    const bootstrap = new SomaBootstrap(process.cwd(), {
      mode: 'test',
      port: 3049,
      apiKeys: {
        geminiApiKey: process.env.GEMINI_API_KEY,
        kevinEmail: process.env.KEVIN_EMAIL || '',
        kevinAppPassword: process.env.KEVIN_APP_PASSWORD || ''
      }
    });

    system = await bootstrap.initialize();
    console.log('✅ SOMA initialized successfully\n');

    const swarm = system.engineeringSwarm;
    if (!swarm) {
      throw new Error('EngineeringSwarmArbiter not found in SOMA system');
    }

    console.log('2️⃣ Invoking modifyCode() live to refactor the target file...');
    console.log('🚀 Request: "Refactor calculateSum to add validation checking that both a and b are numbers, throwing a TypeError if not. Add a comment explaining this."');
    
    // Hook up real progress updates
    const onProgress = (phase, message) => {
      console.log(`[Swarm Progress] [${phase.toUpperCase()}] ${message}`);
    };

    const result = await swarm.modifyCode(
      targetFile,
      'Refactor calculateSum to add validation checking that both a and b are numbers, throwing a TypeError if not. Add a comment explaining this.',
      onProgress
    );

    console.log('\n🏁 Swarm modifyCode Execution Finished:');
    console.log(JSON.stringify(result, null, 2));

    if (!result.success) {
      throw new Error(`modifyCode failed: ${result.error}`);
    }

    console.log('\n3️⃣ Verifying the target file modifications on disk...');
    const patchedCode = await fs.readFile(fullTargetPath, 'utf8');
    console.log('\n📄 Patched Code Content:');
    console.log('----------------------------------------');
    console.log(patchedCode);
    console.log('----------------------------------------');

    if (!patchedCode.includes('TypeError')) {
      throw new Error('Verification failed: Patched code does not contain TypeError validation!');
    }
    console.log('✅ Live E2E Swarm Modification successfully verified on disk!');

    console.log('\n🎉 ALL LIVE E2E SWARM TESTS PASSED YAY!');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ E2E TEST SUITE FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    if (system) {
      console.log('Shutting down SOMA test instance...');
      for (const key of Object.keys(system)) {
        if (system[key] && typeof system[key].shutdown === 'function') {
          await system[key].shutdown().catch(() => {});
        } else if (system[key] && typeof system[key].onShutdown === 'function') {
          await system[key].onShutdown().catch(() => {});
        }
      }
    }
  }
}

runTest();
