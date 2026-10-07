import { BaseArbiter } from '../core/BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * SpatialMemoryArbiter — THE PHYSICAL RAG
 * v0.1 — Remembers where the laptop is and what's in the room.
 * Stores 'Environmental Fingerprints' (CLIP Embeddings) and associated metadata.
 */
export class SpatialMemoryArbiter extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: 'SpatialMemoryArbiter',
      role: 'archivist',
      capabilities: ['spatial-memory', 'location-recognition'],
      ...config
    });

    this.storagePath = path.join(process.cwd(), '.soma', 'spatial_memory.json');
    this.locations = []; // Array of { id, name, embedding, firstSeen, lastSeen, tags[] }
    this.currentLocation = null;
    this.similarityThreshold = 0.85; // How close embeddings must be to match
  }

  async onInitialize() {
    console.log('[SpatialMemory] 🌱 Loading physical world model...');
    await this.loadMemory();
    
    if (this.broker) {
        await this.broker.subscribe('environment_scanned', this.handleEnvironmentScan.bind(this));
    }
  }

  async loadMemory() {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const data = await fs.readFile(this.storagePath, 'utf8');
      this.locations = JSON.parse(data);
      console.log(`[SpatialMemory] ✅ Loaded ${this.locations.length} known locations.`);
    } catch (e) {
      this.locations = [];
    }
  }

  async saveMemory() {
    try {
      await fs.writeFile(this.storagePath, JSON.stringify(this.locations, null, 2));
    } catch (err) {
      console.error('[SpatialMemory] Save failed:', err.message);
    }
  }

  /**
   * Compare a new scan against known locations
   */
  async handleEnvironmentScan(message) {
    const { embedding, timestamp } = message.payload || message;
    if (!embedding) return;

    let matchedLocation = null;
    let maxSimilarity = -1;

    // Semantic comparison (Cosine Similarity)
    for (const loc of this.locations) {
        const sim = this._cosineSimilarity(embedding, loc.embedding);
        if (sim > maxSimilarity) {
            maxSimilarity = sim;
            matchedLocation = loc;
        }
    }

    if (matchedLocation && maxSimilarity > this.similarityThreshold) {
        // We are in a known location
        const oldLoc = this.currentLocation?.id;
        this.currentLocation = matchedLocation;
        matchedLocation.lastSeen = timestamp;
        
        if (oldLoc !== matchedLocation.id) {
            console.log(`[SpatialMemory] 📍 Arrived at: ${matchedLocation.name}`);
            await this.broker.publish('location_changed', {
                location: matchedLocation,
                type: 'return',
                confidence: maxSimilarity
            });
        }
    } else {
        // New location detected!
        const newId = `loc-${Date.now()}`;
        const newLoc = {
            id: newId,
            name: `Area ${this.locations.length + 1}`,
            embedding,
            firstSeen: timestamp,
            lastSeen: timestamp,
            tags: []
        };
        
        this.locations.push(newLoc);
        this.currentLocation = newLoc;
        console.log(`[SpatialMemory] 🆕 Discovery: New spatial environment detected.`);
        
        await this.broker.publish('location_changed', {
            location: newLoc,
            type: 'discovery',
            confidence: maxSimilarity
        });
        
        await this.saveMemory();
    }
  }

  _cosineSimilarity(a, b) {
    let dot = 0, mA = 0, mB = 0;
    for(let i=0; i<a.length; i++){
        dot += a[i] * b[i];
        mA += a[i] * a[i];
        mB += b[i] * b[i];
    }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
  }
}

export default SpatialMemoryArbiter;
