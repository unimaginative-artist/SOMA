// Fix SQLite schema - Add missing 'tier' column to memories table
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../SOMA/soma-memory.db');

console.log('🔧 Fixing SQLite schema...');
console.log(`   Database: ${dbPath}`);

if (!fs.existsSync(dbPath)) {
    console.log('❌ Database file not found. Will be created with correct schema on first run.');
    process.exit(0);
}

try {
    const db = new Database(dbPath);

    // Check if 'tier' column exists
    const tableInfo = db.pragma('table_info(memories)');
    const hasTierColumn = tableInfo.some(col => col.name === 'tier');

    if (hasTierColumn) {
        console.log('✅ Schema is already correct - "tier" column exists');
        db.close();
        process.exit(0);
    }

    console.log('📝 Adding "tier" column to memories table...');

    // Add the missing column with default value
    db.exec(`
        ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'cold';
    `);

    console.log('✅ Schema updated successfully!');
    console.log('   - Added "tier" column with default value "cold"');

    // Verify the change
    const updatedInfo = db.pragma('table_info(memories)');
    const columns = updatedInfo.map(col => col.name).join(', ');
    console.log(`   - Columns: ${columns}`);

    db.close();
    console.log('\n✨ Database migration complete!');

} catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
}
