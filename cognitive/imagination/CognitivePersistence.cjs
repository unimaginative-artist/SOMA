// cognitive/imagination/CognitivePersistence.cjs
// Persistence layer for SOMA's Imagination Engine
// Tiers:
// 1. Emergents (High volume logs)
// 2. Fractals (Durable knowledge)
// 3. Meta (Graveyard stats)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/* ============================================================================ 
   Config
============================================================================ */
const DATA_DIR = path.join(process.cwd(), "SOMA", "imagination_memory");
const BATCH_SIZE = 50; // Write every 50 items
const TIER_FILES = {
  tier1: "emergents_log", // Base name for sharded logs
  tier2: "promoted_fractals.json",
  tier3: "graveyard_meta.json"
};

/* ============================================================================ 
   Helpers
============================================================================ */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/* ============================================================================ 
   Persistence Class
============================================================================ */
class CognitivePersistence {
  constructor() {
    ensureDir(DATA_DIR);
    this.buffers = { tier1: [] };
    this.currentShard = this._findLatestShard();
  }

  /* ----------------- Tier 1: Emergent Logs (Write-Only) ----------------- */
  // We log every emergent's final state (promoted or killed) for analysis
  logEmergentSummary(emergent) {
    this.buffers.tier1.push({
      id: emergent.id,
      content_signature: emergent.signature,
      content_preview: emergent.content.substring(0, 50),
      triography: emergent.triography.toJSON(),
      final_weight: emergent.currentWeight,
      survival_cycles: emergent.survivalCycles,
      outcome: emergent.promoted ? "promoted" : "killed",
      reason: emergent.deathReason || "promotion",
      timestamp: Date.now()
    });

    if (this.buffers.tier1.length >= BATCH_SIZE) this.flushTier1();
  }

  _findLatestShard() {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith(TIER_FILES.tier1));
    if (files.length === 0) return 0;
    
    // Parse indices from filenames like emergents_log_0.jsonl
    const indices = files.map(f => {
        const match = f.match(/_(\d+)\.jsonl$/);
        return match ? parseInt(match[1]) : 0;
    });
    return Math.max(...indices);
  }

  flushTier1() {
    if (this.buffers.tier1.length === 0) return;
    
    // Check file size, rotate shard if > 5MB
    const currentFile = path.join(DATA_DIR, `${TIER_FILES.tier1}_${this.currentShard}.jsonl`);
    if (fs.existsSync(currentFile)) {
        const stats = fs.statSync(currentFile);
        if (stats.size > 5 * 1024 * 1024) {
            this.currentShard++;
        }
    }

    const targetFile = path.join(DATA_DIR, `${TIER_FILES.tier1}_${this.currentShard}.jsonl`);
    const data = this.buffers.tier1.map(o => JSON.stringify(o)).join("\n") + "\n";
    
    try {
        fs.appendFileSync(targetFile, data);
        this.buffers.tier1 = [];
    } catch (e) {
        console.error(`[CognitivePersistence] Failed to flush Tier 1: ${e.message}`);
    }
  }

  /* ----------------- Tier 2: Promoted Fractals (Snapshot) ----------------- */
  saveFractals(fractals) {
    const file = path.join(DATA_DIR, TIER_FILES.tier2);
    const data = fractals.map(f => f.toJSON());
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  loadFractals() {
    const file = path.join(DATA_DIR, TIER_FILES.tier2);
    if (!fs.existsSync(file)) return [];
    try {
        return JSON.parse(fs.readFileSync(file, "utf-8"));
    } catch (e) {
        console.error(`[CognitivePersistence] Failed to load fractals: ${e.message}`);
        return [];
    }
  }

  /* ----------------- Tier 3: Meta/Graveyard (Snapshot) ----------------- */
  saveMeta(graveyardStats) {
    const file = path.join(DATA_DIR, TIER_FILES.tier3);
    // Convert Map to array of objects for JSON serialization
    const data = Array.from(graveyardStats.entries()).map(([sig, stats]) => ({
        signature: sig,
        ...stats
    }));
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }

  loadMeta() {
    const file = path.join(DATA_DIR, TIER_FILES.tier3);
    if (!fs.existsSync(file)) return new Map();
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf-8"));
        // Convert back to Map
        const map = new Map();
        data.forEach(item => {
            const { signature, ...stats } = item;
            map.set(signature, stats);
        });
        return map;
    } catch (e) {
        console.error(`[CognitivePersistence] Failed to load meta: ${e.message}`);
        return new Map();
    }
  }
}

module.exports = { CognitivePersistence };
