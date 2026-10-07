import dotenv from 'dotenv';
import { SomaBootstrap } from '../core/SomaBootstrap.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

async function runTest() {
  console.log('🧪 Starting Codebase Simulation Sandbox Gate Verification Test...\n');
  
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

    // Configure SelfMod to not require MAX/Steve reviews for this test if possible,
    // but we can just invoke runCodebaseSimulationSandbox directly to test the gate logic!
    console.log('3️⃣ Running Codebase Simulation Sandbox tests...');

    // Proposal A: A valid modification
    console.log('\n--- PROPOSAL A: Valid Optimization (Should Pass) ---');
    const validProposal = {
      file: 'arbiters/test_sandbox_target.js',
      functionName: 'calculateSum',
      rationale: 'Optimize addition by using standard operators',
      newCode: `// Optimized addition
function calculateSum(a, b) {
  // Use bitwise shift if positive integers, else regular addition
  return (a | 0) + (b | 0);
}
module.exports = { calculateSum };
`
    };

    console.log('Running simulation sandbox for Proposal A...');
    const resultA = await selfMod.runCodebaseSimulationSandbox(validProposal);
    console.log('Result A:', JSON.stringify(resultA, null, 2));
    
    if (!resultA.passed) {
      console.error('❌ Proposal A failed when it should have passed!');
    } else {
      console.log('✅ Proposal A successfully passed the sandbox!');
    }

    // Verify file content is restored
    const contentA = await fs.readFile(testFilePath, 'utf8');
    if (contentA === targetCode) {
      console.log('✅ File restoration verified for Proposal A (reverted to original)');
    } else {
      console.error('❌ File was NOT restored after simulation!');
    }

    // Proposal B: Syntactically broken code (Should Fail)
    console.log('\n--- PROPOSAL B: Syntactically Broken Code (Should Fail) ---');
    const brokenProposal = {
      file: 'arbiters/test_sandbox_target.js',
      functionName: 'calculateSum',
      rationale: 'Optimize but introduce syntax error',
      newCode: `// Broken code
function calculateSum(a, b) {
  return a + ; // Syntax error!
}
module.exports = { calculateSum };
`
    };

    console.log('Running simulation sandbox for Proposal B...');
    const resultB = await selfMod.runCodebaseSimulationSandbox(brokenProposal);
    console.log('Result B:', JSON.stringify(resultB, null, 2));

    if (resultB.passed) {
      console.error('❌ Proposal B passed when it should have failed due to compile error!');
    } else {
      console.log('✅ Proposal B successfully blocked due to syntax/runtime crash!');
    }

    // Verify file content is restored
    const contentB = await fs.readFile(testFilePath, 'utf8');
    if (contentB === targetCode) {
      console.log('✅ File restoration verified for Proposal B (reverted to original)');
    } else {
      console.error('❌ File was NOT restored after simulation!');
    }

    // Proposal C: Code with placeholder/hallucination pattern (Should Fail)
    console.log('\n--- PROPOSAL C: Hallucinatory Placeholder (Should Fail) ---');
    const placeholderProposal = {
      file: 'arbiters/test_sandbox_target.js',
      functionName: 'calculateSum',
      rationale: 'Optimize but include TODO placeholder',
      newCode: `// Optimized addition with TODO
function calculateSum(a, b) {
  // TODO: implement actual bitwise addition here
  return a + b;
}
module.exports = { calculateSum };
`
    };

    console.log('Running simulation sandbox for Proposal C...');
    const resultC = await selfMod.runCodebaseSimulationSandbox(placeholderProposal);
    console.log('Result C:', JSON.stringify(resultC, null, 2));

    if (resultC.passed) {
      console.error('❌ Proposal C passed when it should have failed due to hallucination audit!');
    } else {
      console.log('✅ Proposal C successfully blocked due to placeholder patterns!');
    }

    // Verify file content is restored
    const contentC = await fs.readFile(testFilePath, 'utf8');
    if (contentC === targetCode) {
      console.log('✅ File restoration verified for Proposal C (reverted to original)');
    } else {
      console.error('❌ File was NOT restored after simulation!');
    }

    console.log('\n🎉 ALL SANDBOX GATE TESTS COMPLETED!');

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err.message);
    console.error(err.stack);
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
    process.exit(0);
  }
}

runTest();
