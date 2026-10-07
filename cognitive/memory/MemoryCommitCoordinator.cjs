// ==========================================================
// FILE: cognitive/memory/MemoryCommitCoordinator.cjs
// ==========================================================

const fs = require("fs").promises;
const path = require("path");

// Write-Ahead Log path
const JOURNAL_PATH = path.join(
  process.cwd(),
  "SOMA", // Storing in SOMA/data instead of root/data
  "memory_commit_journal.log"
);

class MemoryCommitCoordinator {
    
  constructor() {
     this.ensureJournalDir();
  }

  async ensureJournalDir() {
      try {
        await fs.mkdir(path.dirname(JOURNAL_PATH), { recursive: true });
      } catch (e) {
        console.warn('[MemoryCommitCoordinator] Failed to create journal directory:', e.message);
      }
  }

  /**
   * Executes a MemoryCommitPlan.
   * Uses WAL (Write-Ahead Log) to ensure data integrity.
   * 
   * @param {MemoryCommitPlan} plan - The decision plan
   * @param {Object} payload - Data to be saved
   * @param {String} payload.content - The text content
   * @param {Object} payload.metadata - Extra metadata
   * @param {Object} services - References to actual arbiters
   * @param {MnemonicArbiter} services.mnemonic - For episodic memory
   * @param {KnowledgeGraphFusion} services.knowledgeGraph - For semantic memory
   */
  async commit(plan, payload, services) {
    const entry = {
      ts: Date.now(),
      plan,
      payload_preview: payload.content.substring(0, 50),
      status: "pending"
    };

    // --- Write-Ahead Log (Start) ---
    try {
        await fs.appendFile(JOURNAL_PATH, JSON.stringify(entry) + "\n");
    } catch (e) {
        console.warn('Memory WAL failed:', e.message);
    }

    try {
      // --- Episodic Memory Commit (MnemonicArbiter) ---
      if (plan.targets.includes("episodic") && services.mnemonic) {
        // We inject the computed importance/decay into metadata
        const metadata = {
            ...payload.metadata,
            importance: plan.salience,
            decayRate: plan.decay.episodic,
            commitType: 'episodic'
        };
        
        // Call the REAL MnemonicArbiter
        await services.mnemonic.remember(payload.content, metadata);
      }

      // --- Semantic Memory Commit (KnowledgeGraphFusion) ---
      if (plan.targets.includes("semantic") && services.knowledgeGraph) {
        // If the payload has specific concepts, use them
        // Otherwise, rely on the graph's internal extraction logic
        
        // Check if payload has structured knowledge
        if (payload.concepts && Array.isArray(payload.concepts)) {
             for (const concept of payload.concepts) {
                 await services.knowledgeGraph.addConcept(concept.name, {
                     confidence: plan.salience,
                     source: 'semantic_commit',
                     domain: concept.domain
                 });
             }
        } else {
            // If raw text, we treat the content as a potential concept or definition
            // This is a simplification; ideally we extract concepts first
            // But we don't want the Coordinator to do NLP.
            // We assume the caller (TrainingDataCollector) might have extracted tags.
            
            if (payload.tags && payload.tags.length > 0) {
                 for (const tag of payload.tags) {
                     await services.knowledgeGraph.addConcept(tag, {
                         confidence: plan.salience,
                         source: 'semantic_commit'
                     });
                 }
            }
        }
      }

      entry.status = "committed";

      // --- Write-Ahead Log (Success) ---
      try {
        await fs.appendFile(JOURNAL_PATH, JSON.stringify(entry) + "\n");
      } catch (e) {
        console.warn('[MemoryCommitCoordinator] Failed to write success entry to WAL:', e.message);
      }

    } catch (err) {
      entry.status = "failed";
      entry.error = err.message;

      // --- Write-Ahead Log (Failure) ---
      try {
        await fs.appendFile(JOURNAL_PATH, JSON.stringify(entry) + "\n");
      } catch (e) {
        console.error('[MemoryCommitCoordinator] CRITICAL: Failed to write failure entry to WAL:', e.message);
      }

      throw err;
    }
  }
}

module.exports = MemoryCommitCoordinator;
