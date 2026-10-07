// FILE: StorageArbiter.js - Universal Storage with Multiple Backends

import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { createGzip } from 'zlib';
import { createReadStream, createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';

export class StorageArbiter extends EventEmitter {
  static role = 'specialist';
  static capabilities = ['analyze', 'compress', 'decompress', 'cleanup', 'dedupe', 'report', 'store', 'retrieve'];

  constructor(config = {}) {
    super();

    this.name = config.name || 'StorageArbiter';
    this.enrichmentArbiter = config.enrichmentArbiter || null; // Link to Deep Research

    // Backend registry
    this.backends = new Map();

    // Register available backends
    this.registerBackend('local', new LocalStorageBackend(config));
    this.registerBackend('database', new DatabaseBackend(config));
    this.registerBackend('redis', new RedisBackend(config));
    this.registerBackend('s3', new S3Backend(config));
    this.registerBackend('ipfs', new IPFSBackend(config));

    // Default backend
    this.defaultBackend = config.defaultBackend || 'local';

    console.log(`[${this.name}] 📦 StorageArbiter initialized with ${this.backends.size} backends (default: ${this.defaultBackend})`);
  }

  registerBackend(name, backend) {
    this.backends.set(name, backend);
    backend.arbiter = this;
    console.log(`[${this.name}] Registered backend: ${name}`);
  }

  getBackend(backendType = null) {
    const type = backendType || this.defaultBackend;
    const backend = this.backends.get(type);
    if (!backend) throw new Error(`Backend not found: ${type}`);
    return backend;
  }

  async initialize() {
    console.log(`[${this.name}] Initializing StorageArbiter...`);

    // Initialize all backends
    for (const [name, backend] of this.backends) {
      try {
        await backend.initialize();
        console.log(`[${this.name}] Backend initialized: ${name}`);
      } catch (error) {
        console.warn(`[${this.name}] Backend init failed: ${name} - ${error.message}`);
      }
    }

    this.emit('initialized');
    console.log(`[${this.name}] ✅ Storage initialized`);
    return { success: true };
  }

  // ==================== UNIFIED STORAGE API ====================

  async store(key, data, backendType = null) {
    const backend = this.getBackend(backendType);
    console.log(`[${this.name}] Storing ${key} in ${backendType || this.defaultBackend}`);
    
    // 1. Store the primary data
    const result = await backend.store(key, data);

    // 2. Auto-Librarian (Fire-and-Forget Enrichment)
    if (this.enrichmentArbiter && result.success) {
        this._autoEnrich(key, data, backend).catch(err => {
            console.warn(`[AutoLibrarian] Failed to enrich ${key}:`, err.message);
        });
    }

    return result;
  }

  /**
   * Auto-Librarian: Analyzes content and generates a metadata sidecar.
   */
  async _autoEnrich(key, data, backend) {
      // Simple heuristic: Is this a text/document?
      const isText = typeof data === 'string';
      const isJson = typeof data === 'object';
      const filename = path.basename(key);
      
      // Extract a research target from the filename (e.g. "nvidia_report.txt" -> "nvidia")
      const target = filename.split('.')[0].replace(/_/g, ' ');

      if (target.length > 3) {
          console.log(`[AutoLibrarian] 📚 Enriching metadata for: "${target}"`);
          
          // Deep Research via EnrichmentArbiter
          const dossier = await this.enrichmentArbiter.enrich(target);
          
          if (dossier) {
              const metaKey = `${key}.meta.json`;
              const metaData = {
                  target,
                  enrichedAt: Date.now(),
                  dossier
              };
              
              // Store the sidecar metadata
              await backend.store(metaKey, metaData);
              
              // INDEXING: Also save to the Searchable Database
              try {
                  const db = this.getBackend('database');
                  if (db) {
                      await db.store(`enrichment/${target}`, {
                          type: 'dossier',
                          target: target,
                          dossier: dossier,
                          timestamp: Date.now()
                      });
                  }
              } catch (e) {
                  // Ignore if DB not active
              }

              console.log(`[AutoLibrarian] ✨ Metadata attached to ${key}`);
          }
      }
  }

  async retrieve(key, backendType = null) {
    const backend = this.getBackend(backendType);
    console.log(`[${this.name}] Retrieving ${key} from ${backendType || this.defaultBackend}`);
    return await backend.retrieve(key);
  }

  async delete(key, backendType = null) {
    const backend = this.getBackend(backendType);
    console.log(`[${this.name}] Deleting ${key} from ${backendType || this.defaultBackend}`);
    return await backend.delete(key);
  }

  async list(prefix = '', backendType = null) {
    const backend = this.getBackend(backendType);
    return await backend.list(prefix);
  }

  async analyze(backendType = null) {
    const backend = this.getBackend(backendType);
    return await backend.analyze();
  }

  async compress(key, backendType = null) {
    const backend = this.getBackend(backendType);
    return await backend.compress(key);
  }

  getStatus() {
    const backendStatuses = {};
    for (const [name, backend] of this.backends) {
      backendStatuses[name] = backend.getStatus();
    }

    return {
      name: this.name,
      role: StorageArbiter.role,
      capabilities: StorageArbiter.capabilities,
      backends: Array.from(this.backends.keys()),
      defaultBackend: this.defaultBackend,
      backendStatuses
    };
  }

  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    this.emit('shutdown');
    return { success: true };
  }
}

// ==================== BASE BACKEND ====================

class BaseStorageBackend {
  constructor(config = {}) {
    this.config = config;
    this.arbiter = null;
  }

  async initialize() {
    throw new Error('initialize() must be implemented by child class');
  }

  async store(key, data) {
    throw new Error('store() must be implemented by child class');
  }

  async retrieve(key) {
    throw new Error('retrieve() must be implemented by child class');
  }

  async delete(key) {
    throw new Error('delete() must be implemented by child class');
  }

  async list(prefix = '') {
    throw new Error('list() must be implemented by child class');
  }

  async analyze() {
    return { backend: this.constructor.name, message: 'Analysis not implemented' };
  }

  async compress(key) {
    return { success: false, message: 'Compression not implemented' };
  }

  getStatus() {
    return { backend: this.constructor.name, initialized: true };
  }
}

// ==================== LOCAL FILE SYSTEM BACKEND ====================

class LocalStorageBackend extends BaseStorageBackend {
  constructor(config = {}) {
    super(config);
    this.storagePath = config.storagePath || path.join(process.cwd(), 'SOMA', 'polymer-storage');
    this.compressedPath = path.join(this.storagePath, 'compressed');
  }

  async initialize() {
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.mkdir(this.compressedPath, { recursive: true });
    console.log(`[LocalStorage] Initialized at ${this.storagePath}`);
  }

  async store(key, data) {
    const filepath = path.join(this.storagePath, key);
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    await fs.writeFile(filepath, content, 'utf8');
    return { success: true, path: filepath };
  }

  async retrieve(key) {
    const filepath = path.join(this.storagePath, key);
    const content = await fs.readFile(filepath, 'utf8');
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }

  async delete(key) {
    const filepath = path.join(this.storagePath, key);
    await fs.unlink(filepath);
    return { success: true };
  }

  async list(prefix = '') {
    const files = await fs.readdir(this.storagePath);
    return files.filter(f => f.startsWith(prefix));
  }

  async analyze() {
    const stats = { totalSize: 0, fileCount: 0, byType: {} };
    const files = await fs.readdir(this.storagePath);

    for (const file of files) {
      const filepath = path.join(this.storagePath, file);
      try {
        const stat = await fs.stat(filepath);

        if (stat.isFile()) {
          stats.totalSize += stat.size;
          stats.fileCount++;
          const ext = path.extname(file) || 'no-ext';
          stats.byType[ext] = (stats.byType[ext] || 0) + 1;
        }
      } catch (e) {
        // Skip files that can't be accessed
      }
    }

    return stats;
  }

  async compress(key) {
    const filepath = path.join(this.storagePath, key);
    const outputPath = path.join(this.compressedPath, `${key}.gz`);

    await pipeline(
      createReadStream(filepath),
      createGzip({ level: 9 }),
      createWriteStream(outputPath)
    );

    const originalSize = (await fs.stat(filepath)).size;
    const compressedSize = (await fs.stat(outputPath)).size;

    return {
      success: true,
      original: filepath,
      compressed: outputPath,
      originalSize,
      compressedSize,
      ratio: compressedSize / originalSize
    };
  }

  getStatus() {
    return {
      backend: 'LocalStorage',
      initialized: true,
      storagePath: this.storagePath
    };
  }
}

// ==================== DATABASE BACKEND (Document Store) ====================

class DatabaseBackend extends BaseStorageBackend {
  constructor(config = {}) {
    super(config);
    this.dbPath = config.dbPath || path.join(process.cwd(), 'SOMA', 'storage.db.json');
    this.index = { files: {}, tags: {} }; // In-memory index
    this.isDirty = false;
  }

  async initialize() {
    try {
      const data = await fs.readFile(this.dbPath, 'utf8');
      this.index = JSON.parse(data);
      console.log(`[DatabaseBackend] Loaded index with ${Object.keys(this.index.files).length} entries`);
    } catch (e) {
      console.log(`[DatabaseBackend] Creating new database at ${this.dbPath}`);
      await this.saveIndex();
    }

    // Auto-save loop
    setInterval(() => this.saveIndex(), 5000);
  }

  async saveIndex() {
    if (this.isDirty) {
      await fs.writeFile(this.dbPath, JSON.stringify(this.index, null, 2), 'utf8');
      this.isDirty = false;
    }
  }

  async store(key, data) {
    // We don't store the BLOB data here (that goes to LocalStorage), 
    // we store the METADATA record.
    // Use this backend for "Indexing" files stored elsewhere.
    
    const record = {
        key,
        created: Date.now(),
        size: JSON.stringify(data).length, // Rough size
        type: typeof data === 'object' ? 'json' : 'text',
        data: data // For small metadata, we keep it. For blobs, we might want to ref.
    };

    this.index.files[key] = record;
    this.isDirty = true;
    
    return { success: true, backend: 'database', id: key };
  }

  async retrieve(key) {
    return this.index.files[key] || null;
  }

  async delete(key) {
    if (this.index.files[key]) {
        delete this.index.files[key];
        this.isDirty = true;
        return { success: true };
    }
    return { success: false, error: 'Not found' };
  }

  async list(prefix = '') {
    return Object.keys(this.index.files)
        .filter(k => k.startsWith(prefix))
        .map(k => this.index.files[k]);
  }
  
  // Advanced Query Capability
  async query(filterFn) {
      return Object.values(this.index.files).filter(filterFn);
  }

  getStatus() {
    return {
      backend: 'Database (JSON DocStore)',
      initialized: true,
      entries: Object.keys(this.index.files).length,
      path: this.dbPath
    };
  }
}

// ==================== REDIS BACKEND ====================

class RedisBackend extends BaseStorageBackend {
  async initialize() {
    // Redis is optional in many environments
    try {
      // Logic would go here to connect to real Redis
      console.log(`[RedisBackend] Note: Redis initialization would occur here if implemented.`);
    } catch (e) {
      console.warn(`[RedisBackend] Redis unavailable - using local fallback`);
    }
  }

  async store(key, data) {
    return { success: false, error: 'Redis backend unconfigured. Configure REDIS_URL to enable.', backend: 'redis' };
  }

  async retrieve(key) {
    return null;
  }

  async delete(key) {
    return { success: false, error: 'Redis backend unconfigured.' };
  }

  async list(prefix = '') {
    return [];
  }

  getStatus() {
    return {
      backend: 'Redis',
      initialized: false,
      status: 'unconfigured'
    };
  }
}

// ==================== S3 BACKEND ====================

class S3Backend extends BaseStorageBackend {
  async initialize() {
    // Unconfigured
  }

  async store(key, data) {
    return { success: false, error: 'AWS S3 backend unconfigured. Configure AWS_S3_BUCKET to enable.', backend: 's3' };
  }

  async retrieve(key) {
    return null;
  }

  async delete(key) {
    return { success: false, error: 'AWS S3 backend unconfigured.' };
  }

  async list(prefix = '') {
    return [];
  }

  getStatus() {
    return {
      backend: 'AWS S3',
      initialized: false,
      status: 'unconfigured'
    };
  }
}

// ==================== IPFS BACKEND ====================

class IPFSBackend extends BaseStorageBackend {
  async initialize() {
    // Unconfigured
  }

  async store(key, data) {
    return { success: false, error: 'IPFS backend unconfigured. Configure IPFS_NODE_URL to enable.', backend: 'ipfs' };
  }

  async retrieve(key) {
    return null;
  }

  async delete(key) {
    return { success: false, message: 'IPFS is immutable' };
  }

  async list(prefix = '') {
    return [];
  }

  getStatus() {
    return {
      backend: 'IPFS',
      initialized: false,
      note: 'Future feature'
    };
  }
}

export default StorageArbiter;
