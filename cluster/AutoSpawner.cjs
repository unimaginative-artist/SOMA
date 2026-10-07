// AutoSpawner.cjs
// Automatically spawns UnifiedMemory agents on cluster workers when they join

const fetch = require('node-fetch');

class AutoSpawner {
  constructor(config = {}) {
    this.config = {
      memoryHubHost: config.memoryHubHost || '192.168.1.251',
      memoryHubPort: config.memoryHubPort || 3001,
      somaApiPort: config.somaApiPort || 4000,
      spawnOnConnect: config.spawnOnConnect !== false, // Default true
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000,
      ...config
    };
    
    this.logger = config.logger || console;
    this.spawnedNodes = new Set(); // Track which nodes have agents spawned
  }
  
  /**
   * Attempt to spawn UnifiedMemory agent on a worker node
   */
  async spawnUnifiedMemoryAgent(nodeHost, nodePort) {
    const nodeKey = `${nodeHost}:${nodePort}`;
    
    // Skip if already spawned
    if (this.spawnedNodes.has(nodeKey)) {
      this.logger.debug(`[AutoSpawner] Node ${nodeKey} already has memory agent`);
      return { success: true, reason: 'already_spawned' };
    }
    
    const somaApiUrl = `http://${nodeHost}:${this.config.somaApiPort}/api/arbiter/spawn`;
    
    const payload = {
      type: 'UnifiedMemoryArbiter',
      config: {
        coordinatorHost: this.config.memoryHubHost,
        coordinatorPort: this.config.memoryHubPort
      }
    };
    
    this.logger.info(`[AutoSpawner] 🧬 Spawning UnifiedMemory agent on ${nodeKey}...`);
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        const response = await fetch(somaApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          timeout: 10000
        });
        
        if (response.ok) {
          const result = await response.json();
          
          if (result.success) {
            this.spawnedNodes.add(nodeKey);
            this.logger.info(`[AutoSpawner] ✅ Spawned UnifiedMemory agent on ${nodeKey}: ${result.arbiterId}`);
            return { success: true, arbiterId: result.arbiterId };
          } else {
            this.logger.warn(`[AutoSpawner] ⚠️  Spawn failed on ${nodeKey}: ${result.error}`);
            return { success: false, error: result.error };
          }
        } else {
          this.logger.warn(`[AutoSpawner] Spawn attempt ${attempt}/${this.config.retryAttempts} failed: HTTP ${response.status}`);
          
          if (attempt < this.config.retryAttempts) {
            await this._sleep(this.config.retryDelay);
          }
        }
      } catch (err) {
        this.logger.warn(`[AutoSpawner] Spawn attempt ${attempt}/${this.config.retryAttempts} failed: ${err.message}`);
        
        if (attempt < this.config.retryAttempts) {
          await this._sleep(this.config.retryDelay);
        }
      }
    }
    
    return { success: false, error: 'max_retries_exceeded' };
  }
  
  /**
   * Handle new node discovery event
   */
  async onNodeDiscovered(nodeInfo) {
    if (!this.config.spawnOnConnect) {
      return;
    }
    
    // Only spawn on worker nodes, not coordinator
    if (nodeInfo.role === 'coordinator') {
      return;
    }
    
    this.logger.info(`[AutoSpawner] 🔍 New worker discovered: ${nodeInfo.nodeName} @ ${nodeInfo.host}:${nodeInfo.port}`);
    
    // Spawn UnifiedMemory agent on this worker
    await this.spawnUnifiedMemoryAgent(nodeInfo.host, nodeInfo.port);
  }
  
  /**
   * Verify memory hub connectivity
   */
  async checkMemoryHub() {
    const url = `http://${this.config.memoryHubHost}:${this.config.memoryHubPort}/status`;
    
    try {
      const response = await fetch(url, { timeout: 3000 });
      
      if (response.ok) {
        const status = await response.json();
        this.logger.info(`[AutoSpawner] 💾 Memory hub: ${status.agents} agents, ${status.chunks} chunks`);
        return status;
      }
    } catch (err) {
      this.logger.warn(`[AutoSpawner] ⚠️  Memory hub unreachable: ${err.message}`);
      return null;
    }
  }
  
  /**
   * Manually spawn on specific node (for testing/recovery)
   */
  async manualSpawn(nodeHost, nodePort) {
    const nodeKey = `${nodeHost}:${nodePort}`;
    this.spawnedNodes.delete(nodeKey); // Clear cache to force re-spawn
    return this.spawnUnifiedMemoryAgent(nodeHost, nodePort);
  }
  
  /**
   * Get spawning status
   */
  getStatus() {
    return {
      spawnedNodes: Array.from(this.spawnedNodes),
      spawnOnConnect: this.config.spawnOnConnect,
      memoryHub: `${this.config.memoryHubHost}:${this.config.memoryHubPort}`
    };
  }
  
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = AutoSpawner;
