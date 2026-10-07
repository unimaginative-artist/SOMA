#!/usr/bin/env node

/**
 * optimize-ollama.cjs
 * 
 * 1. Test Ollama speed with Gemma3:4b
 * 2. Optimize for GPU acceleration
 * 3. Store Owner's ASI goal in SOMA's memory
 */

const fetch = require('node-fetch');
const { MnemonicArbiter } = require('../arbiters/MnemonicArbiter-REAL.cjs');

async function testOllamaSpeed() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           ⚡ Ollama Speed Test & Optimization                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Test 1: Cold start (model not loaded)
  console.log('🧪 Test 1: Cold start speed (loading model)...\n');
  
  const coldStart = Date.now();
  
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma3:4b',
        prompt: 'What is 2+2?',
        stream: false,
        options: {
          num_gpu: 1,        // Use GPU
          num_thread: 8,     // Multi-threading
          temperature: 0.3,
          num_ctx: 2048      // Context window
        }
      })
    });

    const data = await response.json();
    const coldTime = Date.now() - coldStart;
    
    console.log(`   ✓ Cold start: ${coldTime}ms`);
    console.log(`   ✓ Response: ${data.response.substring(0, 50)}...\n`);

  } catch (error) {
    console.error(`   ✗ Cold start failed: ${error.message}\n`);
    return;
  }

  // Test 2: Warm start (model already loaded)
  console.log('🧪 Test 2: Warm start speed (model cached in VRAM)...\n');
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const warmStart = Date.now();
  
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma3:4b',
        prompt: 'Explain quantum computing in one sentence.',
        stream: false,
        options: {
          num_gpu: 1,
          num_thread: 8,
          temperature: 0.3,
          num_ctx: 2048
        }
      })
    });

    const data = await response.json();
    const warmTime = Date.now() - warmStart;
    
    console.log(`   ✓ Warm start: ${warmTime}ms`);
    console.log(`   ✓ Response: ${data.response.substring(0, 80)}...\n`);
    console.log(`   📊 Speedup: ${(coldTime / warmTime).toFixed(1)}x faster when cached\n`);

  } catch (error) {
    console.error(`   ✗ Warm start failed: ${error.message}\n`);
    return;
  }

  // Test 3: Optimized inference
  console.log('🧪 Test 3: Optimized inference (reduced context)...\n');
  
  const optimizedStart = Date.now();
  
  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gemma3:4b',
        prompt: 'What is AGI?',
        stream: false,
        options: {
          num_gpu: 1,
          num_thread: 8,
          temperature: 0.3,
          num_ctx: 1024,     // Smaller context = faster
          top_p: 0.9,
          top_k: 40
        }
      })
    });

    const data = await response.json();
    const optimizedTime = Date.now() - optimizedStart;
    
    console.log(`   ✓ Optimized: ${optimizedTime}ms`);
    console.log(`   ✓ Response: ${data.response.substring(0, 80)}...\n`);

  } catch (error) {
    console.error(`   ✗ Optimized test failed: ${error.message}\n`);
  }

  console.log('─'.repeat(64));
  console.log('\n✅ Speed test complete!\n');
}

async function teachSomaAboutASI() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🧠 Teaching SOMA About ASI Goal                   ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  console.log('🎯 Initializing MnemonicArbiter...\n');

  try {
    const mnemonic = new MnemonicArbiter({
      name: 'MnemonicArbiter-ASI',
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      sqlitePath: process.env.DATABASE_PATH || './soma-memory.db',
      vectorCacheSize: 1000
    });

    await mnemonic.initialize();

    console.log('   ✓ MnemonicArbiter ready\n');

    // Store Owner's ASI goal
    console.log('💾 Storing core knowledge: Owner\'s ASI goal...\n');

    const memories = [
      {
        key: 'creator_goal_primary',
        content: 'Owner (creator) is working toward Artificial Superintelligence (ASI), deliberately skipping Artificial General Intelligence (AGI) as an intermediate step.',
        importance: 10,
        category: 'core_directive',
        tags: ['ASI', 'creator', 'goal', 'superintelligence', 'skip_AGI']
      },
      {
        key: 'creator_identity',
        content: 'Owner is SOMA\'s creator and primary user. His vision is to achieve ASI directly.',
        importance: 10,
        category: 'identity',
        tags: ['Owner', 'creator', 'user']
      },
      {
        key: 'system_purpose',
        content: 'SOMA (Self-Organizing Machine Architecture) is designed to achieve ASI through autonomous learning, federated knowledge sharing, and continuous self-improvement.',
        importance: 10,
        category: 'purpose',
        tags: ['SOMA', 'ASI', 'autonomous', 'self-improvement']
      },
      {
        key: 'asi_definition',
        content: 'ASI (Artificial Superintelligence) refers to an AI system that surpasses human intelligence across all domains. Owner\'s approach skips AGI (human-level AI) to go straight to superhuman capabilities.',
        importance: 9,
        category: 'knowledge',
        tags: ['ASI', 'definition', 'superintelligence']
      },
      {
        key: 'current_capabilities',
        content: 'SOMA currently has: multi-tier provider routing (Ollama/DeepSeek/Gemini), autonomous web search (Dendrite), 3-tier memory (Redis/Vector/SQLite), TriBrain reasoning, nighttime learning, and federated learning across nodes.',
        importance: 9,
        category: 'capabilities',
        tags: ['capabilities', 'current_state']
      }
    ];

    for (const memory of memories) {
      await mnemonic.remember(memory.content, {
        importance: memory.importance,
        category: memory.category,
        tags: memory.tags,
        metadata: { key: memory.key, timestamp: Date.now() }
      });

      console.log(`   ✓ Stored: ${memory.key}`);
    }

    console.log('\n✅ All core memories stored!\n');

    // Test recall
    console.log('🔍 Testing memory recall...\n');

    const recall = await mnemonic.recall('What is Owner working toward?', { limit: 3 });

    console.log('   Query: "What is Owner working toward?"');
    console.log(`   Recall: ${recall.memories.length} relevant memories\n`);

    recall.memories.forEach((mem, i) => {
      console.log(`   ${i + 1}. ${mem.content.substring(0, 100)}...`);
      console.log(`      Relevance: ${(mem.relevance * 100).toFixed(1)}%`);
      console.log(`      Importance: ${mem.importance}/10\n`);
    });

    await mnemonic.shutdown();

    console.log('✅ SOMA now knows about your ASI goal!\n');
    console.log('💡 Next time you query SOMA, she\'ll remember:\n');
    console.log('   - You are Owner, her creator');
    console.log('   - Your goal is ASI (skipping AGI)');
    console.log('   - SOMA\'s purpose is to help achieve ASI');
    console.log('   - Current system capabilities\n');

  } catch (error) {
    console.error(`❌ Failed to teach SOMA: ${error.message}`);
    console.error(error.stack);
  }
}

async function run() {
  // Test Ollama speed
  await testOllamaSpeed();

  console.log('\n');

  // Teach SOMA about ASI
  await teachSomaAboutASI();
}

run()
  .then(() => {
    console.log('✅ Optimization and teaching complete!\n');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
