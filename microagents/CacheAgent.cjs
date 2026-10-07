// CacheAgent.cjs
// Specialized MicroAgent for caching with TTL and eviction strategies

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

class CacheAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'cache' });
    
    this.cache = new Map();
    this.accessCounts = new Map();
    this.accessTimes = new Map();
    this.maxSize = config.maxSize || 1000;
    this.defaultTTL = config.defaultTTL || 300000; // 5 minutes
    this.evictionStrategy = config.evictionStrategy || 'lru'; // lru, lfu, fifo
  }
  
  /**
   * Execute cache operation
   * Task format:
   * {
   *   operation: 'get' | 'set' | 'delete' | 'clear' | 'has' | 'stats',
   *   key: 'cache-key',
   *   value: any (for set),
   *   ttl: 60000 (optional, ms)
   * }
   */
  async execute(task) {
    const { operation, key, value, ttl } = task;
    
    if (!operation) {
      throw new Error('Task must include operation');
    }
    
    this.logger.info(`[CacheAgent:${this.id}] ${operation} operation${key ? ` on ${key}` : ''}`);
    
    switch (operation) {
      case 'get':
        return this._get(key);
      
      case 'set':
        return this._set(key, value, ttl);
      
      case 'delete':
        return this._delete(key);
      
      case 'clear':
        return this._clear();
      
      case 'has':
        return this._has(key);
      
      case 'stats':
        return this._stats();
      
      case 'keys':
        return this._keys();
      
      case 'purge':
        return this._purgeExpired();
      
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  }
  
  _get(key) {
    if (!key) {
      throw new Error('Get operation requires key');
    }
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      return { key, hit: false, value: null };
    }
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessCounts.delete(key);
      this.accessTimes.delete(key);
      return { key, hit: false, value: null, expired: true };
    }
    
    // Update access stats
    this.accessCounts.set(key, (this.accessCounts.get(key) || 0) + 1);
    this.accessTimes.set(key, Date.now());
    
    return {
      key,
      hit: true,
      value: entry.value,
      age: Date.now() - entry.createdAt,
      ttl: entry.expiresAt ? entry.expiresAt - Date.now() : null,
      accessCount: this.accessCounts.get(key)
    };
  }
  
  _set(key, value, ttl) {
    if (!key) {
      throw new Error('Set operation requires key');
    }
    
    if (value === undefined) {
      throw new Error('Set operation requires value');
    }
    
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this._evict();
    }
    
    const effectiveTTL = ttl || this.defaultTTL;
    const now = Date.now();
    
    const entry = {
      value,
      createdAt: now,
      expiresAt: effectiveTTL ? now + effectiveTTL : null
    };
    
    this.cache.set(key, entry);
    this.accessCounts.set(key, 0);
    this.accessTimes.set(key, now);
    
    return {
      key,
      cached: true,
      ttl: effectiveTTL,
      expiresAt: entry.expiresAt
    };
  }
  
  _delete(key) {
    if (!key) {
      throw new Error('Delete operation requires key');
    }
    
    const existed = this.cache.has(key);
    
    this.cache.delete(key);
    this.accessCounts.delete(key);
    this.accessTimes.delete(key);
    
    return {
      key,
      deleted: existed
    };
  }
  
  _clear() {
    const count = this.cache.size;
    
    this.cache.clear();
    this.accessCounts.clear();
    this.accessTimes.clear();
    
    return {
      cleared: true,
      count
    };
  }
  
  _has(key) {
    if (!key) {
      throw new Error('Has operation requires key');
    }
    
    const entry = this.cache.get(key);
    
    if (!entry) {
      return { key, exists: false };
    }
    
    // Check expiration
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return { key, exists: false, expired: true };
    }
    
    return { key, exists: true };
  }
  
  _stats() {
    const now = Date.now();
    let totalAge = 0;
    let expired = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        expired++;
      } else {
        totalAge += now - entry.createdAt;
      }
    }
    
    const active = this.cache.size - expired;
    
    return {
      size: this.cache.size,
      active,
      expired,
      maxSize: this.maxSize,
      utilization: ((this.cache.size / this.maxSize) * 100).toFixed(1) + '%',
      avgAge: active > 0 ? Math.round(totalAge / active) : 0,
      evictionStrategy: this.evictionStrategy,
      defaultTTL: this.defaultTTL
    };
  }
  
  _keys() {
    const keys = [];
    const now = Date.now();
    
    for (const [key, entry] of this.cache.entries()) {
      // Skip expired
      if (entry.expiresAt && now > entry.expiresAt) {
        continue;
      }
      
      keys.push({
        key,
        age: now - entry.createdAt,
        ttl: entry.expiresAt ? entry.expiresAt - now : null,
        accessCount: this.accessCounts.get(key) || 0
      });
    }
    
    return {
      count: keys.length,
      keys
    };
  }
  
  _purgeExpired() {
    const now = Date.now();
    const expired = [];
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.cache.delete(key);
        this.accessCounts.delete(key);
        this.accessTimes.delete(key);
        expired.push(key);
      }
    }
    
    return {
      purged: expired.length,
      keys: expired
    };
  }
  
  _evict() {
    let keyToEvict = null;
    
    switch (this.evictionStrategy) {
      case 'lru': // Least Recently Used
        keyToEvict = this._findLRU();
        break;
      
      case 'lfu': // Least Frequently Used
        keyToEvict = this._findLFU();
        break;
      
      case 'fifo': // First In First Out
        keyToEvict = this._findFIFO();
        break;
      
      default:
        keyToEvict = this._findLRU();
    }
    
    if (keyToEvict) {
      this.cache.delete(keyToEvict);
      this.accessCounts.delete(keyToEvict);
      this.accessTimes.delete(keyToEvict);
      
      this.logger.info(`[CacheAgent:${this.id}] Evicted key: ${keyToEvict} (${this.evictionStrategy})`);
    }
  }
  
  _findLRU() {
    let oldest = null;
    let oldestTime = Infinity;
    
    for (const [key, time] of this.accessTimes.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldest = key;
      }
    }
    
    return oldest;
  }
  
  _findLFU() {
    let least = null;
    let leastCount = Infinity;
    
    for (const [key, count] of this.accessCounts.entries()) {
      if (count < leastCount) {
        leastCount = count;
        least = key;
      }
    }
    
    return least;
  }
  
  _findFIFO() {
    let oldest = null;
    let oldestCreated = Infinity;
    
    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestCreated) {
        oldestCreated = entry.createdAt;
        oldest = key;
      }
    }
    
    return oldest;
  }
}

module.exports = { CacheAgent };
