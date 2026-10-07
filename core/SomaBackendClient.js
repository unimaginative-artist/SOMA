// somaBackend.js
// Handles all communication with SOMA backend services
// Connects to dashboard-server (WebSocket) and soma-server (REST API)

class SOMABackend {
  constructor() {
    // Configuration
    this.config = {
      dashboardServer: {
        http: 'http://localhost:8080',
        ws: 'ws://localhost:8080/soma'
      },
      somaServer: {
        http: 'http://localhost:4000',
        ws: 'ws://localhost:4000' // WebSocket on same port as REST
      }
    };
    
    // Connection state
    this.wsConnection = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 2000;
    
    // Callbacks
    this.callbacks = {
      onConnect: null,
      onDisconnect: null,
      onMetrics: null,
      onAgents: null,
      onCluster: null,
      onFederated: null,
      onCache: null,
      onStorage: null,
      onError: null
    };
    
    // Data cache
    this.dataCache = {
      metrics: null,
      agents: null,
      cluster: null,
      federated: null,
      cache: null,
      storage: null,
      somaStats: null
    };
  }
  
  // ==================== WebSocket Connection ====================
  
  connect() {
    try {
      console.log('[SOMA Backend] Connecting to WebSocket...');
      
      // Try SOMA server WebSocket first (port 4000)
      this.wsConnection = new WebSocket(this.config.somaServer.ws);
      
      this.wsConnection.onopen = () => {
        console.log('[SOMA Backend] ✅ WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        
        if (this.callbacks.onConnect) {
          this.callbacks.onConnect();
        }
        
        // Fetch initial SOMA server data
        this.fetchSOMAStats();
      };
      
      this.wsConnection.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[SOMA Backend] Failed to parse message:', error);
        }
      };
      
      this.wsConnection.onclose = () => {
        console.log('[SOMA Backend] ❌ WebSocket disconnected');
        this.isConnected = false;
        
        if (this.callbacks.onDisconnect) {
          this.callbacks.onDisconnect();
        }
        
        // Attempt reconnection
        this.attemptReconnect();
      };
      
      this.wsConnection.onerror = (error) => {
        console.error('[SOMA Backend] WebSocket error:', error);
        
        if (this.callbacks.onError) {
          this.callbacks.onError(error);
        }
      };
      
    } catch (error) {
      console.error('[SOMA Backend] Failed to connect:', error);
      this.attemptReconnect();
    }
  }
  
  disconnect() {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    this.isConnected = false;
  }
  
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`[SOMA Backend] Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      console.error('[SOMA Backend] Max reconnection attempts reached');
    }
  }
  
  handleMessage(message) {
    const { type, payload } = message;
    
    // Cache the data
    if (this.dataCache.hasOwnProperty(type)) {
      this.dataCache[type] = payload;
    }
    
    // Trigger callbacks
    switch (type) {
      case 'metrics':
        if (this.callbacks.onMetrics) this.callbacks.onMetrics(payload);
        break;
      case 'agents':
        if (this.callbacks.onAgents) this.callbacks.onAgents(payload);
        break;
      case 'cluster':
        if (this.callbacks.onCluster) this.callbacks.onCluster(payload);
        break;
      case 'federated':
        if (this.callbacks.onFederated) this.callbacks.onFederated(payload);
        break;
      case 'cache':
        if (this.callbacks.onCache) this.callbacks.onCache(payload);
        break;
      case 'storage':
        if (this.callbacks.onStorage) this.callbacks.onStorage(payload);
        break;
      default:
        console.log('[SOMA Backend] Unknown message type:', type);
    }
  }
  
  // ==================== REST API Calls ====================
  
  async fetchSOMAStats() {
    try {
      const response = await fetch(`${this.config.somaServer.http}/stats`);
      if (response.ok) {
        const stats = await response.json();
        this.dataCache.somaStats = stats;
        console.log('[SOMA Backend] SOMA server stats:', stats);
        return stats;
      }
    } catch (error) {
      console.log('[SOMA Backend] SOMA server not available (using simulated data)');
      return null;
    }
  }
  
  async fetchSOMAHealth() {
    try {
      const response = await fetch(`${this.config.somaServer.http}/health`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.log('[SOMA Backend] SOMA health check failed');
      return null;
    }
  }
  
  async queryKnowledge(query, topK = 10) {
    try {
      const response = await fetch(`${this.config.somaServer.http}/knowledge/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, topK })
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('[SOMA Backend] Knowledge query failed:', error);
      return null;
    }
  }
  
  async checkCache(query) {
    try {
      const response = await fetch(`${this.config.somaServer.http}/cache/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('[SOMA Backend] Cache check failed:', error);
      return null;
    }
  }
  
  async learnKnowledge(content, metadata = {}) {
    try {
      const response = await fetch(`${this.config.somaServer.http}/knowledge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, metadata })
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('[SOMA Backend] Learn knowledge failed:', error);
      return null;
    }
  }
  
  async rememberConversation(text, metadata = {}) {
    try {
      const response = await fetch(`${this.config.somaServer.http}/conversation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, metadata })
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('[SOMA Backend] Remember conversation failed:', error);
      return null;
    }
  }
  
  // ==================== Dashboard Server API ====================
  
  async fetchAllData() {
    try {
      const response = await fetch(`${this.config.dashboardServer.http}/api/all`);
      if (response.ok) {
        const data = await response.json();
        Object.assign(this.dataCache, data);
        return data;
      }
    } catch (error) {
      console.error('[SOMA Backend] Failed to fetch all data:', error);
      return null;
    }
  }
  
  async fetchHealth() {
    try {
      const response = await fetch(`${this.config.dashboardServer.http}/api/health`);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      console.error('[SOMA Backend] Health check failed:', error);
      return null;
    }
  }
  
  // ==================== Callbacks Registration ====================
  
  on(event, callback) {
    if (this.callbacks.hasOwnProperty(`on${event.charAt(0).toUpperCase() + event.slice(1)}`)) {
      this.callbacks[`on${event.charAt(0).toUpperCase() + event.slice(1)}`] = callback;
    }
  }
  
  // ==================== Agent Control Operations ====================
  
  async controlAgent(agentId, action, params = {}) {
    console.log(`[SOMA Backend] Agent control: ${action} on ${agentId}`);
    try {
      const response = await fetch(`${this.config.somaServer.http}/api/agents/${encodeURIComponent(agentId)}/${encodeURIComponent(action)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, action, agentId };
      }
      const data = await response.json().catch(() => ({ success: true }));
      return { success: true, action, agentId, data };
    } catch (error) {
      console.warn(`[SOMA Backend] Agent control failed: ${error.message}`);
      return { success: false, error: error.message, action, agentId };
    }
  }
  
  async executeWorkflow(workflowId, params = {}) {
    console.log(`[SOMA Backend] Executing workflow: ${workflowId}`);
    try {
      const response = await fetch(`${this.config.somaServer.http}/api/workflows/${encodeURIComponent(workflowId)}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}: ${response.statusText}`, workflowId };
      }
      const data = await response.json().catch(() => ({ success: true }));
      return { success: true, workflowId, data };
    } catch (error) {
      console.warn(`[SOMA Backend] Workflow execution failed: ${error.message}`);
      return { success: false, error: error.message, workflowId };
    }
  }
  
  // ==================== Data Access ====================
  
  getCachedData(type) {
    return this.dataCache[type];
  }
  
  getAllCachedData() {
    return { ...this.dataCache };
  }
}

// Export singleton instance
const somaBackend = new SOMABackend();
export default somaBackend;
