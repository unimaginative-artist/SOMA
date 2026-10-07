#!/usr/bin/env node
/**
 * Check what SOMA learned last night
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const dbPath = './soma-memory.db';

if (!existsSync(dbPath)) {
  console.log('❌ Database not found at:', dbPath);
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });

console.log('\n🧠 SOMA Learning Report\n' + '='.repeat(70));

// Get table schema first
try {
  const schema = db.prepare("PRAGMA table_info(memories)").all();
  const columns = schema.map(col => col.name);
  console.log(`\n📋 Database Columns: ${columns.join(', ')}`);
} catch (e) {
  console.log('\n⚠️  Could not read schema:', e.message);
}

// Get total memories
const totalQuery = db.prepare('SELECT COUNT(*) as count FROM memories').get();
console.log(`\n📊 Total Memories: ${totalQuery.count}`);

// Get recent memories (last 24 hours) - without metadata column
const recentQuery = db.prepare(`
  SELECT *
  FROM memories
  WHERE datetime(created_at) > datetime('now', '-24 hours')
  ORDER BY created_at DESC
  LIMIT 20
`);

const recentMemories = recentQuery.all();

if (recentMemories.length === 0) {
  console.log('\n❌ No memories created in the last 24 hours');

  // Show all memories instead
  console.log('\n📚 Showing ALL memories instead:\n');
  const allMems = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT 10').all();

  allMems.forEach((mem, idx) => {
    console.log(`\n[${idx + 1}] Memory ID: ${mem.id}`);
    console.log(`   Time: ${mem.created_at}`);
    console.log(`   Content: ${mem.content?.substring(0, 300) || JSON.stringify(mem).substring(0, 300)}`);
    console.log('   ─'.repeat(35));
  });

} else {
  console.log(`\n🌙 Last 24 Hours: ${recentMemories.length} new memories\n`);
  console.log('─'.repeat(70));

  recentMemories.forEach((mem, idx) => {
    console.log(`\n[${idx + 1}] Memory ID: ${mem.id}`);
    console.log(`   Time: ${mem.created_at}`);
    console.log(`   Content: ${mem.content?.substring(0, 300) || JSON.stringify(mem).substring(0, 300)}`);
    console.log('   ─'.repeat(35));
  });
}

// Get memories by date
const byDateQuery = db.prepare(`
  SELECT DATE(created_at) as date, COUNT(*) as count
  FROM memories
  WHERE datetime(created_at) > datetime('now', '-7 days')
  GROUP BY DATE(created_at)
  ORDER BY date DESC
`);

const byDate = byDateQuery.all();

if (byDate.length > 0) {
  console.log('\n\n📅 Memory Creation by Date (Last 7 Days):');
  console.log('─'.repeat(70));
  byDate.forEach(row => {
    console.log(`   ${row.date}: ${row.count} memories`);
  });
} else {
  // Show when memories were actually created
  const allDatesQuery = db.prepare(`
    SELECT DATE(created_at) as date, COUNT(*) as count
    FROM memories
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 10
  `);
  const allDates = allDatesQuery.all();

  if (allDates.length > 0) {
    console.log('\n\n📅 Memory Creation by Date (All Time):');
    console.log('─'.repeat(70));
    allDates.forEach(row => {
      console.log(`   ${row.date}: ${row.count} memories`);
    });
  }
}

db.close();
console.log('\n' + '='.repeat(70) + '\n');
