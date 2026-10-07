const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(process.cwd(), 'SOMA', 'soma-memory.db');
const db = new Database(dbPath);

console.log(`Checking schema for: ${dbPath}`);

try {
  // Check if 'category' column exists
  const tableInfo = db.pragma('table_info(memories)');
  const hasCategory = tableInfo.some(col => col.name === 'category');

  if (!hasCategory) {
    console.log("⚠️  Column 'category' missing. Adding it...");
    db.exec("ALTER TABLE memories ADD COLUMN category TEXT DEFAULT 'general'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_category ON memories(category)");
    console.log("✅ Schema patched successfully.");
  } else {
    console.log("✅ Schema is already correct.");
  }
} catch (err) {
  console.error("❌ Schema fix failed:", err.message);
}
