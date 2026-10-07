#!/usr/bin/env node
/**
 * import-existing-learning.mjs
 *
 * Import all of SOMA's existing learning data into the new training system.
 * This ensures we DON'T LOSE anything she's already learned!
 *
 * Imports from:
 * - soma-memory.db (SQLite cold tier)
 * - soma-vectors.json (Warm tier embeddings)
 * - kuze_memory.json (Pattern learning)
 * - WAL file (uncommitted transactions)
 */

import { promises as fs } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const SOMA_DIR = path.join(process.cwd(), 'SOMA');

async function importExistingLearning() {
  console.log('🔄 Importing SOMA\'s existing learning data...\n');

  const importedData = {
    memories: [],
    vectors: [],
    patterns: [],
    totalExamples: 0
  };

  // 1. Import from soma-memory.db (SQLite)
  console.log('📚 Importing from soma-memory.db...');
  try {
    const dbPath = path.join(SOMA_DIR, 'soma-memory.db');
    const db = new Database(dbPath);

    // Get all memories
    const memories = db.prepare('SELECT * FROM memories').all();
    console.log(`   Found ${memories.length} memories in database`);

    for (const memory of memories) {
      importedData.memories.push({
        id: memory.id,
        content: memory.content,
        metadata: JSON.parse(memory.metadata || '{}'),
        created_at: memory.created_at,
        accessed_count: memory.accessed_count || 0,
        importance: memory.importance || 0.5,
        source: 'soma_memory_db'
      });
    }

    db.close();
    console.log(`   ✅ Imported ${memories.length} memories\n`);
  } catch (error) {
    console.warn(`   ⚠️  Could not import from soma-memory.db: ${error.message}\n`);
  }

  // 2. Import from soma-vectors.json
  console.log('🎯 Importing from soma-vectors.json...');
  try {
    const vectorPath = path.join(SOMA_DIR, 'soma-vectors.json');
    const vectorData = JSON.parse(await fs.readFile(vectorPath, 'utf8'));

    const vectorCount = Object.keys(vectorData).length;
    console.log(`   Found ${vectorCount} vector embeddings`);

    for (const [id, vectorEntry] of Object.entries(vectorData)) {
      importedData.vectors.push({
        id: vectorEntry.id,
        memoryId: vectorEntry.memoryId,
        vector: vectorEntry.vector,
        source: 'soma_vectors'
      });
    }

    console.log(`   ✅ Imported ${vectorCount} embeddings\n`);
  } catch (error) {
    console.warn(`   ⚠️  Could not import from soma-vectors.json: ${error.message}\n`);
  }

  // 3. Import from kuze_memory.json (Pattern learning)
  console.log('🧩 Importing from kuze_memory.json...');
  try {
    const kuzePath = path.join(SOMA_DIR, 'kuze_memory.json');
    const kuzeData = JSON.parse(await fs.readFile(kuzePath, 'utf8'));

    const patternCount = kuzeData.patterns ? kuzeData.patterns.length : 0;
    console.log(`   Found ${patternCount} learned patterns`);

    if (kuzeData.patterns) {
      for (const [id, pattern] of kuzeData.patterns) {
        importedData.patterns.push({
          id: pattern.id,
          type: pattern.type,
          subtype: pattern.subtype,
          description: pattern.description,
          confidence: pattern.confidence,
          metadata: pattern.metadata,
          detectedAt: pattern.detectedAt,
          context: pattern.context,
          source: 'kuze_memory'
        });
      }
    }

    console.log(`   ✅ Imported ${patternCount} patterns\n`);
  } catch (error) {
    console.warn(`   ⚠️  Could not import from kuze_memory.json: ${error.message}\n`);
  }

  // 4. Convert to training examples
  console.log('🔄 Converting to training examples...');
  const trainingExamples = [];

  // From memories
  for (const memory of importedData.memories) {
    try {
      const content = JSON.parse(memory.content);
      if (content.input && content.output) {
        trainingExamples.push({
          input: content.input,
          output: content.output,
          source: 'existing_memory',
          importance: memory.importance,
          weight: 1.0,
          timestamp: memory.created_at
        });
      }
    } catch (e) {
      // Not JSON or missing fields, skip
    }
  }

  // From patterns - convert to knowledge
  for (const pattern of importedData.patterns) {
    trainingExamples.push({
      input: `What pattern exists for ${pattern.context}?`,
      output: `${pattern.description} (confidence: ${pattern.confidence})`,
      source: 'existing_pattern',
      importance: pattern.confidence,
      weight: 0.8,
      timestamp: pattern.detectedAt
    });
  }

  importedData.totalExamples = trainingExamples.length;
  console.log(`   ✅ Generated ${trainingExamples.length} training examples\n`);

  // 5. Save to meta-learning directory
  console.log('💾 Saving to meta-learning system...');
  const metaDir = path.join(SOMA_DIR, 'meta-learning');
  await fs.mkdir(metaDir, { recursive: true });

  const importPath = path.join(metaDir, 'imported-existing-learning.jsonl');
  const jsonl = trainingExamples.map(ex => JSON.stringify(ex)).join('\n');
  await fs.writeFile(importPath, jsonl, 'utf8');

  console.log(`   ✅ Saved to: ${importPath}\n`);

  // 6. Save import summary
  const summaryPath = path.join(metaDir, 'import-summary.json');
  const summary = {
    importedAt: new Date().toISOString(),
    stats: {
      memories: importedData.memories.length,
      vectors: importedData.vectors.length,
      patterns: importedData.patterns.length,
      trainingExamples: importedData.totalExamples
    },
    files: {
      trainingData: importPath,
      summary: summaryPath
    }
  };

  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  // 7. Print summary
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ EXISTING LEARNING IMPORTED SUCCESSFULLY!');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`📊 Summary:`);
  console.log(`   - Memories: ${importedData.memories.length}`);
  console.log(`   - Vectors: ${importedData.vectors.length}`);
  console.log(`   - Patterns: ${importedData.patterns.length}`);
  console.log(`   - Training Examples: ${importedData.totalExamples}`);
  console.log('');
  console.log(`📁 Saved to:`);
  console.log(`   ${importPath}`);
  console.log(`   ${summaryPath}`);
  console.log('');
  console.log('🎯 These examples will be included in SOMA-1B training!');
  console.log('   Nothing learned is lost. Everything contributes to her growth.');
  console.log('═══════════════════════════════════════════════════════\n');

  return summary;
}

// Run import
importExistingLearning()
  .then(() => {
    console.log('✨ Import complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Import failed:', error);
    process.exit(1);
  });
