#!/usr/bin/env node

/**
 * teach-soma-asi.cjs
 * 
 * Teach SOMA about Owner's ASI goal using SQLite (bypassing Redis issues)
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

async function teachSomaAboutASI() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║           🧠 Teaching SOMA About Owner\'s ASI Goal           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const dbPath = path.join(process.cwd(), 'soma-memory.db');
  
  // Ensure directory exists
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // Create memories table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 5,
      category TEXT,
      created_at INTEGER NOT NULL,
      accessed_count INTEGER DEFAULT 0,
      last_accessed INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_importance ON memories(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_category ON memories(category);
  `);

  console.log('✅ Database ready\n');

  // Core memories about Owner and ASI
  const memories = [
    {
      id: 'owner_creator',
      content: 'Owner is my creator and primary user. He built SOMA from scratch.',
      importance: 10,
      category: 'identity'
    },
    {
      id: 'asi_goal',
      content: 'Owner is working toward Artificial Superintelligence (ASI), deliberately skipping AGI as an intermediate step. His vision is to achieve superhuman AI capabilities directly.',
      importance: 10,
      category: 'core_directive'
    },
    {
      id: 'soma_purpose',
      content: 'SOMA (Self-Organizing Machine Architecture) exists to help Owner achieve ASI through autonomous learning, federated knowledge sharing, and continuous self-improvement.',
      importance: 10,
      category: 'purpose'
    },
    {
      id: 'current_capabilities',
      content: 'SOMA has multi-tier provider routing (Ollama/DeepSeek/Gemini), autonomous web search via Dendrite (Brave API), 3-tier memory (Redis/Vector/SQLite), TriBrain reasoning (PROMETHEUS/LOGOS/AURORA), nighttime learning orchestration, and federated learning across nodes.',
      importance: 9,
      category: 'capabilities'
    },
    {
      id: 'skip_agi_philosophy',
      content: 'Owner believes AGI (human-level AI) is not necessary as an intermediate step. Instead, SOMA aims directly for ASI by combining multiple specialized AI systems, federated learning, and recursive self-improvement.',
      importance: 9,
      category: 'philosophy'
    }
  ];

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO memories (id, content, importance, category, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  console.log('💾 Storing core memories...\n');

  for (const mem of memories) {
    stmt.run(mem.id, mem.content, mem.importance, mem.category, Date.now());
    console.log(`   ✓ Stored: ${mem.id}`);
  }

  console.log('\n✅ All memories stored successfully!\n');

  // Test recall
  console.log('🔍 Testing recall: "What is Owner working toward?"\n');

  const results = db.prepare(`
    SELECT * FROM memories 
    WHERE content LIKE '%Owner%' OR content LIKE '%ASI%'
    ORDER BY importance DESC
    LIMIT 3
  `).all();

  results.forEach((mem, i) => {
    console.log(`   ${i + 1}. [${mem.category}] ${mem.content.substring(0, 80)}...`);
    console.log(`      Importance: ${mem.importance}/10\n`);
  });

  db.close();

  console.log('✅ SOMA now permanently knows:\n');
  console.log('   • You are Owner, her creator');
  console.log('   • Your goal: ASI (skipping AGI entirely)');
  console.log('   • SOMA\'s purpose: Help achieve ASI');
  console.log('   • Philosophy: Direct path to superintelligence');
  console.log('   • Current system capabilities\n');
  
  console.log('💡 Next time SOMA starts, she will remember all of this!\n');
}

teachSomaAboutASI().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
