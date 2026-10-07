/**
 * MedicalBreakthroughLedger.js
 * 
 * Persistent ledger for verified cross-domain medical discoveries.
 * Tracks Swanson ABC bridges (Entity A -> Mechanism X <- Entity B)
 * with PubMed citations, discovery scores, and proposed falsification experiments.
 */

import fs from 'fs';
import path from 'path';

export class MedicalBreakthroughLedger {
  constructor(config = {}) {
    this.root = config.root || process.cwd();
    this.storagePath = config.storagePath || path.join(this.root, 'data', 'research', 'medical-breakthroughs.json');
    this._ensureStorage();
  }

  _ensureStorage() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(this.storagePath)) {
        fs.writeFileSync(this.storagePath, JSON.stringify({
          version: 1,
          totalBreakthroughs: 0,
          updatedAt: new Date().toISOString(),
          breakthroughs: []
        }, null, 2), 'utf8');
      }
    } catch (err) {
      console.error('[MedicalBreakthroughLedger] Storage init error:', err.message);
    }
  }

  getAll() {
    try {
      if (!fs.existsSync(this.storagePath)) return [];
      const data = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      return Array.isArray(data.breakthroughs) ? data.breakthroughs : [];
    } catch (err) {
      console.error('[MedicalBreakthroughLedger] Read error:', err.message);
      return [];
    }
  }

  recordBreakthrough(discovery) {
    try {
      this._ensureStorage();
      const raw = fs.readFileSync(this.storagePath, 'utf8');
      const data = JSON.parse(raw);

      const entry = {
        id: discovery.id || `bt_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        timestamp: discovery.timestamp || Date.now(),
        isoDate: new Date().toISOString(),
        entityA: discovery.entityA,
        entityB: discovery.entityB,
        bridgeMechanism: discovery.bridgeMechanism,
        relationA: discovery.relationA || 'INTERACTS_WITH',
        relationB: discovery.relationB || 'INTERACTS_WITH',
        domainA: discovery.domainA || 'Oncology',
        domainB: discovery.domainB || 'Metabolism',
        discoveryScore: Number((discovery.discoveryScore || 0.75).toFixed(3)),
        noveltyScore: Number((discovery.noveltyScore || 0.85).toFixed(3)),
        priorCooccurrences: discovery.priorCooccurrences ?? 0,
        citations: Array.isArray(discovery.citations) ? discovery.citations : [],
        hypothesis: discovery.hypothesis || '',
        proposedExperiment: discovery.proposedExperiment || {
          modelSystem: 'In vitro cell culture',
          assay: 'Western blot / viability assay',
          falsificationCriteria: 'No statistically significant alteration in target phosphorylation'
        },
        graphNodeIds: discovery.graphNodeIds || []
      };

      if (!Array.isArray(data.breakthroughs)) data.breakthroughs = [];
      
      const exists = data.breakthroughs.some(b => 
        (b.entityA === entry.entityA && b.entityB === entry.entityB && b.bridgeMechanism === entry.bridgeMechanism) ||
        (b.entityA === entry.entityB && b.entityB === entry.entityA && b.bridgeMechanism === entry.bridgeMechanism)
      );

      if (!exists) {
        data.breakthroughs.unshift(entry);
        data.totalBreakthroughs = data.breakthroughs.length;
        data.updatedAt = new Date().toISOString();
        fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`[MedicalBreakthroughLedger] 🧬 Recorded new breakthrough: [${entry.entityA}] ⟷ [${entry.bridgeMechanism}] ⟷ [${entry.entityB}]`);
      }

      return entry;
    } catch (err) {
      console.error('[MedicalBreakthroughLedger] Save error:', err.message);
      return null;
    }
  }

  summary() {
    const all = this.getAll();
    return {
      total: all.length,
      highNoveltyCount: all.filter(b => b.priorCooccurrences === 0).length,
      domainsCovered: [...new Set(all.flatMap(b => [b.domainA, b.domainB]))],
      latest: all[0] || null
    };
  }
}

export default new MedicalBreakthroughLedger();
