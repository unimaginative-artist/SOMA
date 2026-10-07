import dotenv from 'dotenv';
import { SomaBootstrap } from '../core/SomaBootstrap.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

async function runTest() {
  console.log('🧪 Starting Adversarial Coding Swarm Debate Verification Test...\n');
  
  let system;

  try {
    // 1. Initialize SOMA
    console.log('1️⃣ Booting SOMA in test mode...');
    const bootstrap = new SomaBootstrap(process.cwd(), {
      mode: 'test',
      port: 3046,
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

    console.log('2️⃣ Running runDebate() to trigger Kuze and Batou multi-turn debate...');

    const state = {
      northStar: 'Optimize the calculateSum function to be faster and add validation to ensure both inputs are numbers.',
      lastError: null
    };

    const context = {
      filepath: 'arbiters/test_sandbox_target.js',
      content: `// Test target for sandbox debate verification
function calculateSum(a, b) {
  return a + b;
}
module.exports = { calculateSum };
`,
      pastExperience: ''
    };

    console.log('\n--- Initiating Debate Deliberation ---');
    const debateResult = await swarm.runDebate(state, context);
    console.log('\n⚖️ Debate Consensus Result:');
    console.log(JSON.stringify(debateResult, null, 2));

    // Assert that the debate result matches DebateSchema
    const requiredKeys = ['architect', 'maintainer', 'security', 'consensus'];
    for (const key of requiredKeys) {
      if (!debateResult[key] || typeof debateResult[key] !== 'string') {
        throw new Error(`Debate consensus result missing or invalid key: ${key}`);
      }
    }

    console.log('\n🎉 SUCCESS: Multi-turn debate successfully produced a structured consensus!');
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
  }
}

runTest();
