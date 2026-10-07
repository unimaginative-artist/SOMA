import dotenv from 'dotenv';
import { SomaBootstrap } from '../core/SomaBootstrap.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

async function runTest() {
  console.log('🧪 Starting Causal Self-Healing Sandbox Gate Verification Test...\n');
  
  const testFilePath = path.join(process.cwd(), 'arbiters', 'test_sandbox_target.js');
  let system;

  try {
    // 1. Create a dummy target file for modification
    console.log('1️⃣ Creating test target module on disk...');
    const targetCode = `// Test target for sandbox gate verification
function calculateSum(a, b) {
  return a + b;
}
module.exports = { calculateSum };
`;
    await fs.writeFile(testFilePath, targetCode, 'utf8');
    console.log(`✅ Target file created: ${testFilePath}\n`);

    // 2. Initialize SOMA
    console.log('2️⃣ Booting SOMA in test mode...');
    const bootstrap = new SomaBootstrap(process.cwd(), {
      mode: 'test',
      port: 3045,
      apiKeys: {
        geminiApiKey: process.env.GEMINI_API_KEY,
        kevinEmail: process.env.KEVIN_EMAIL || '',
        kevinAppPassword: process.env.KEVIN_APP_PASSWORD || ''
      }
    });

    system = await bootstrap.initialize();
    console.log('✅ SOMA initialized successfully\n');

    const selfMod = system.selfModification;
    if (!selfMod) {
      throw new Error('SelfModificationArbiter not found in SOMA system');
    }

    console.log('3️⃣ Running Self-Healing Sandbox check...');

    // Propose broken code with syntax error (missing variable in return statement)
    console.log('\n--- PROPOSAL: Syntactically Broken Code (Should self-heal and pass) ---');
    const brokenProposal = {
      file: 'arbiters/test_sandbox_target.js',
      functionName: 'calculateSum',
      rationale: 'Optimize but make a typo/syntax error',
      newCode: `// Broken code to be healed
function calculateSum(a, b) {
  return a + ; // Deliberate Syntax Error
}
module.exports = { calculateSum };
`
    };

    console.log('Running simulation sandbox for broken proposal...');
    const result = await selfMod.runCodebaseSimulationSandbox(brokenProposal);
    console.log('\n📊 Sandbox Result:');
    console.log(JSON.stringify(result, null, 2));

    if (result.passed) {
      console.log('\n🎉 SUCCESS: The proposal successfully self-healed and passed verification!');
      console.log('Final healed code:');
      console.log(brokenProposal.newCode);
    } else {
      console.error('\n❌ FAILURE: Self-healing loop failed to fix the syntax error.');
      process.exit(1);
    }

    // Verify file content is restored
    const content = await fs.readFile(testFilePath, 'utf8');
    if (content === targetCode) {
      console.log('\n✅ File restoration verified (reverted to original)');
    } else {
      console.error('\n❌ File was NOT restored after simulation!');
      process.exit(1);
    }

    console.log('\n🎉 ALL CAUSAL SELF-HEALING TESTS COMPLETED successfully!');
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // Shutdown system components
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
    // Cleanup files
    await fs.unlink(testFilePath).catch(() => {});
    console.log('🧹 Cleanup complete.');
  }
}

runTest();
