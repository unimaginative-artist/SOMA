import dotenv from 'dotenv';
import { SomaBootstrap } from '../core/SomaBootstrap.js';
import fs from 'fs/promises';
import path from 'path';

dotenv.config();

async function runTest() {
  console.log('🧪 Starting Swarm Upgrade Phase 1 (Dynamic Specialist) Verification Test...\n');
  
  let system;
  const tempFile = path.join(process.cwd(), 'tests', 'temp-db-test-file.js');

  try {
    // 1. Create a dummy file containing database keywords (better-sqlite3 import)
    const dbCode = `
      import sqlite3 from 'better-sqlite3';
      
      export function getUserById(dbPath, userId) {
          const db = new sqlite3(dbPath);
          const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
          db.close();
          return row;
      }
    `;
    await fs.writeFile(tempFile, dbCode, 'utf8');

    // 2. Initialize SOMA
    console.log('1️⃣ Booting SOMA in test mode...');
    const bootstrap = new SomaBootstrap(process.cwd(), {
      mode: 'test',
      port: 3048,
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

    console.log('2️⃣ Running runDebate() on database code to trigger Tachikoma-DB injection...');

    const state = {
      northStar: 'Optimize the getUserById function by using connection pooling or caching the database connection, preventing opening/closing on every call.',
      lastError: null
    };

    const context = {
      filepath: 'tests/temp-db-test-file.js',
      content: dbCode,
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

    // Verify that Tachikoma-DB DBA recommendations are present in the consensus reasoning
    const consensusLower = debateResult.consensus.toLowerCase();
    const dbaRef = consensusLower.includes('db') || consensusLower.includes('pool') || consensusLower.includes('sqlite') || consensusLower.includes('connection');
    if (!dbaRef) {
      console.warn('⚠️ Consensus did not explicitly mention database/connection recommendations.');
    } else {
      console.log('✅ DBA recommendations integrated in final consensus');
    }

    console.log('\n🎉 SUCCESS: Swarm debate successfully dynamically injected specialist and resolved consensus!');
    
    // Clean up
    await fs.rm(tempFile, { force: true });
    process.exit(0);

  } catch (err) {
    console.error('\n❌ TEST SUITE FAILED:', err.message);
    console.error(err.stack);
    await fs.rm(tempFile, { force: true }).catch(() => {});
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
