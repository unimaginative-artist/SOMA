// FILE: StorageArbiter.js - Universal Storage with Multiple Backends

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
const fs = require('fs').promises;
const path = require('path');
const { createGzip } = require('zlib');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');

class StorageArbiter extends BaseArbiter {
  static role = 'storage';
  static capabilities = ['analyze', 'compress', 'decompress', 'cleanup', 'dedupe', 'report', 'store', 'retrieve'];

  constructor(config = {}) {
    super(config);
    
    this.backends = new Map();
    this.registerBackend('local', new LocalStorageBackend(config));
    this.registerBackend('database', new DatabaseBackend(config));
    this.registerBackend('redis', new RedisBackend(config));
    this.registerBackend('s3', new S3Backend(config));
    this.registerBackend('ipfs', new IPFSBackend(config));
    
    this.defaultBackend = config.defaultBackend || 'local';
    
    this.logger.info(`[${this.name}] 📦 StorageArbiter initialized with ${this.backends.size} backends (default: ${this.defaultBackend})`);
  }

  registerBackend(name, backend) {
    this.backends.set(name, backend);
    backend.arbiter = this;
    this.logger.info(`[${this.name}] Registered backend: ${name}`);
  }

  getBackend(backendType = null) {
    const type = backendType || this.defaultBackend;
    const backend = this.backends.get(type);
    if (!backend) throw new Error(`Backend not found: ${type}`);
    return backend;
  }

  async initialize() {
    await super.initialize();
    
    for (const [name, backend] of this.backends) {
      try {
        // Set timeout to prevent any backend from blocking
        await Promise.race([
          backend.initialize(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
        ]);
        this.logger.info(`[${this.name}] Backend initialized: ${name}`);
      } catch (error) {
        this.logger.warn(`[${this.name}] Backend init failed: ${name} - ${error.message}`);
        // Continue with other backends
      }
    }
    
    this.registerWithBroker();
    this._subscribeBrokerMessages();
    
    this.logger.info(`[${this.name}] Storage initialized`);
  }

  registerWithBroker() {
    try {
      messageBroker.registerArbiter(this.name, this, { 
        type: StorageArbiter.role, 
        capabilities: StorageArbiter.capabilities 
      });
      this.logger.info(`[${this.name}] Registered with broker`);
    } catch (err) {
      this.logger.error(`[${this.name}] registerWithBroker error: ${err.message}`);
      throw err;
    }
  }

  _subscribeBrokerMessages() {
    messageBroker.subscribe(this.name, 'store');
    messageBroker.subscribe(this.name, 'retrieve');
    messageBroker.subscribe(this.name, 'delete');
    messageBroker.subscribe(this.name, 'list');
    messageBroker.subscribe(this.name, 'analyze-storage');
    messageBroker.subscribe(this.name, 'compress-file');
    messageBroker.subscribe(this.name, 'status_check');
  }

  async handleMessage(message) {
    try {
      const { type, payload } = message;
      
      switch (type) {
        case 'store':
          return await this.store(payload.key, payload.data, payload.backend);
        case 'retrieve':
          return await this.retrieve(payload.key, payload.backend);
        case 'delete':
          return await this.delete(payload.key, payload.backend);
        case 'list':
          return await this.list(payload.prefix, payload.backend);
        case 'analyze-storage':
          return await this.analyze(payload.backend);
        case 'compress-file':
          return await this.compress(payload.key, payload.backend);
        case 'status_check':
          return this.getStatus();
        default:
          return { success: false, error: 'unknown_message_type' };
      }
    } catch (err) {
      this.logger.error(`[${this.name}] handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async store(key, data, backendType = null) {
    const backend = this.getBackend(backendType);
    this.logger.info(`[${this.name}] Storing ${key} in ${backendType || this.defaultBackend}`);
    return await backend.store(key, data);
  }

  async retrieve(key, backendType = null) {
    const backend = this.getBackend(backendType);
    this.logger.info(`[${this.name}] Retrieving ${key} from ${backendType || this.defaultBackend}`);
    return await backend.retrieve(key);
  }

  async delete(key, backendType = null) {
    const backend = this.getBackend(backendType);
    this.logger.info(`[${this.name}] Deleting ${key} from ${backendType || this.defaultBackend}`);
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
}

class BaseStorageBackend {
  constructor(config = {}) {
    this.config = config;
    this.arbiter = null;
    this.logger = config.logger || console;
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

class LocalStorageBackend extends BaseStorageBackend {
  constructor(config = {}) {
    super(config);
    this.storagePath = config.storagePath || './polymer-storage';
    this.compressedPath = path.join(this.storagePath, 'compressed');
  }

  async initialize() {
    await fs.mkdir(this.storagePath, { recursive: true });
    await fs.mkdir(this.compressedPath, { recursive: true });
    this.logger.info(`[LocalStorage] Initialized at ${this.storagePath}`);
  }

  async store(key, data) {
    const filepath = path.join(this.storagePath, key);
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
      const stat = await fs.stat(filepath);
      
      if (stat.isFile()) {
        stats.totalSize += stat.size;
        stats.fileCount++;
        const ext = path.extname(file) || 'no-ext';
        stats.byType[ext] = (stats.byType[ext] || 0) + 1;
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

class DatabaseBackend extends BaseStorageBackend {
  constructor(config = {}) {
    super(config);
    this.db = null;
    this.dbPath = config.dbPath || './polymer-storage.db';
    this.initialized = false;
  }

  async initialize() {
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(this.dbPath);
      
      // Create schema
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS storage (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_created ON storage(created_at);
        CREATE INDEX IF NOT EXISTS idx_updated ON storage(updated_at);
      `);
      
      this.initialized = true;
      this.logger.info(`[DatabaseBackend] Initialized SQLite at ${this.dbPath}`);
    } catch (error) {
      this.logger.error(`[DatabaseBackend] Initialization failed: ${error.message}`);
      throw error;
    }
  }

  async store(key, data) {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const value = typeof data === 'string' ? data : JSON.stringify(data);
      const now = Date.now();
      
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO storage (key, value, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `);
      
      stmt.run(key, value, now, now);
      return { success: true, backend: 'database', key, size: value.length };
    } catch (error) {
      this.logger.error(`[DatabaseBackend] Store failed: ${error.message}`);
      throw error;
    }
  }

  async retrieve(key) {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare('SELECT value FROM storage WHERE key = ?');
      const row = stmt.get(key);
      
      if (!row) return null;
      
      try {
        return JSON.parse(row.value);
      } catch {
        return row.value;
      }
    } catch (error) {
      this.logger.error(`[DatabaseBackend] Retrieve failed: ${error.message}`);
      throw error;
    }
  }

  async delete(key) {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare('DELETE FROM storage WHERE key = ?');
      const result = stmt.run(key);
      return { success: true, deleted: result.changes > 0 };
    } catch (error) {
      this.logger.error(`[DatabaseBackend] Delete failed: ${error.message}`);
      throw error;
    }
  }

  async list(prefix = '') {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare('SELECT key FROM storage WHERE key LIKE ? ORDER BY key');
      const rows = stmt.all(`${prefix}%`);
      return rows.map(r => r.key);
    } catch (error) {
      this.logger.error(`[DatabaseBackend] List failed: ${error.message}`);
      throw error;
    }
  }

  async analyze() {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count, SUM(LENGTH(value)) as totalSize FROM storage');
      const row = stmt.get();
      return {
        backend: 'Database (SQLite)',
        itemCount: row.count || 0,
        totalSize: row.totalSize || 0,
        dbPath: this.dbPath
      };
    } catch (error) {
      this.logger.error(`[DatabaseBackend] Analyze failed: ${error.message}`);
      throw error;
    }
  }

  getStatus() {
    return {
      backend: 'Database (SQLite)',
      initialized: this.initialized,
      dbPath: this.dbPath,
      connected: !!this.db
    };
  }
}

class RedisBackend extends BaseStorageBackend {
  constructor(config = {}) {
    super(config);
    this.redis = null;
    this.redisUrl = config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.ttl = config.ttl || 3600; // 1 hour default
    this.initialized = false;
  }

  async initialize() {
    try {
      const { createClient } = require('redis');
      this.redis = createClient({ 
        url: this.redisUrl,
        socket: {
          connectTimeout: 2000,  // Fail fast
          reconnectStrategy: false  // Don't retry
        }
      });
      
      this.redis.on('error', (err) => {
        // Silently ignore - Redis is optional
      });
      
      await this.redis.connect();
      const ping = await this.redis.ping();
      
      if (ping === 'PONG') {
        this.initialized = true;
        this.logger.info(`[RedisBackend] Connected to Redis at ${this.redisUrl}`);
      } else {
        throw new Error('Redis ping failed');
      }
    } catch (error) {
      this.logger.warn(`[RedisBackend] Redis unavailable - using local fallback`);
      this.redis = null;
      this.initialized = false;
      // Do not throw - allow StorageArbiter to continue
    }
  }

  async store(key, data) {
    if (!this.redis) throw new Error('Redis not initialized');
    
    try {
      const value = typeof data === 'string' ? data : JSON.stringify(data);
      await this.redis.setEx(key, this.ttl, value);
      return { success: true, backend: 'redis', key, size: value.length, ttl: this.ttl };
    } catch (error) {
      this.logger.error(`[RedisBackend] Store failed: ${error.message}`);
      throw error;
    }
  }

  async retrieve(key) {
    if (!this.redis) throw new Error('Redis not initialized');
    
    try {
      const value = await this.redis.get(key);
      if (!value) return null;
      
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      this.logger.error(`[RedisBackend] Retrieve failed: ${error.message}`);
      throw error;
    }
  }

  async delete(key) {
    if (!this.redis) throw new Error('Redis not initialized');
    
    try {
      const result = await this.redis.del(key);
      return { success: true, deleted: result > 0 };
    } catch (error) {
      this.logger.error(`[RedisBackend] Delete failed: ${error.message}`);
      throw error;
    }
  }

  async list(prefix = '') {
    if (!this.redis) throw new Error('Redis not initialized');
    
    try {
      const keys = await this.redis.keys(`${prefix}*`);
      return keys || [];
    } catch (error) {
      this.logger.error(`[RedisBackend] List failed: ${error.message}`);
      throw error;
    }
  }

  getStatus() {
    return {
      backend: 'Redis',
      initialized: this.initialized,
      url: this.redisUrl,
      ttl: this.ttl,
      connected: !!this.redis
    };
  }
}

class S3Backend extends BaseStorageBackend {
  // FUTURE: S3 backend is planned but not currently implemented
  async initialize() {
    // Placeholder - no-op
  }

  async store(key, data) {
    throw new Error('S3 backend not yet implemented');
  }

  async retrieve(key) {
    throw new Error('S3 backend not yet implemented');
  }

  async delete(key) {
    throw new Error('S3 backend not yet implemented');
  }

  async list(prefix = '') {
    throw new Error('S3 backend not yet implemented');
  }

  getStatus() {
    return {
      backend: 'AWS S3',
      initialized: false,
      status: 'NOT_IMPLEMENTED',
      note: 'Future feature'
    };
  }
}

class IPFSBackend extends BaseStorageBackend {
  // FUTURE: IPFS backend is planned but not currently implemented
  async initialize() {
    // Placeholder - no-op
  }

  async store(key, data) {
    throw new Error('IPFS backend not yet implemented');
  }

  async retrieve(key) {
    throw new Error('IPFS backend not yet implemented');
  }

  async delete(key) {
    throw new Error('Cannot delete from IPFS');
  }

  async list(prefix = '') {
    throw new Error('IPFS backend not yet implemented');
  }

  getStatus() {
    return {
      backend: 'IPFS',
      initialized: false,
      status: 'NOT_IMPLEMENTED',
      note: 'Future feature'
    };
  }
}

module.exports = StorageArbiter;







