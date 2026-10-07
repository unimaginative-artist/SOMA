// somaBackend.js - SOMA Backend Connection Manager
// Manages WebSocket connection to SOMA backend server

class SomaBackend {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = Infinity; // keep trying forever — server will come back
    this.reconnectDelay = 1000;
    this.isConnecting = false;
    this.connectionState = 'disconnected'; // disconnected, health_check, connecting, connected, error
    this.pendingRequests = {}; // To store promises for sendMessage responses
    const httpProtocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const httpHost = import.meta.env?.VITE_HTTP_HOST || window.location.hostname || 'localhost';
    const httpPort = import.meta.env?.VITE_HTTP_PORT || '3001';
    const defaultHttpBase = `${httpProtocol}//${httpHost}:${httpPort}`;
    
    // Talk to SOMA directly. Vite's development proxy retains stale pooled
    // sockets when the backend performs a long restart, which made healthy API
    // calls intermittently hang or return 500 until Vite was also restarted.
    // The backend already permits Command Bridge CORS requests.
    this.baseUrl = import.meta.env?.VITE_SOMA_HTTP || defaultHttpBase;

    // WebSocket URL - relative to current host if possible
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.wsUrl = import.meta.env?.VITE_SOMA_WS || import.meta.env?.VITE_WS_URL || `${wsProtocol}//${httpHost}:${httpPort}/ws`;

    console.log('[SomaBackend] Initialized with WebSocket URL:', this.wsUrl);
  }

  // Connection state tracking
  _setConnectionState(state, details = null) {
    const oldState = this.connectionState;
    this.connectionState = state;
    console.log(`[SomaBackend] Connection state: ${oldState} -> ${state}`, details || '');
    this.emit('connectionStateChange', { state, oldState, details, timestamp: Date.now() });
  }

  // Event emitter methods
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => callback(data));
  }

  // Connect to SOMA backend
  async connect() {
    // Allow reconnection if WebSocket is closed
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
      console.log('[SomaBackend] Already connecting...');
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[SomaBackend] Already connected');
      return;
    }

    if (this.isConnecting) {
      console.log('[SomaBackend] Connection in progress...');
      return;
    }

    this.isConnecting = true;
    this._setConnectionState('health_check');
    console.log('[SomaBackend] 🚀 Connecting to SOMA server...');
    console.log('[SomaBackend] Base URL:', this.baseUrl);
    console.log('[SomaBackend] WebSocket URL:', this.wsUrl);

    try {
      // Try REST API first — 8s timeout (increased from 3s) so a slow/starting server doesn't hang the retry loop
      const healthCtrl = new AbortController();
      const healthTimer = setTimeout(() => healthCtrl.abort(), 8000);
      let response;
      try {
        response = await fetch(`${this.baseUrl}/health`, { signal: healthCtrl.signal });
      } finally {
        clearTimeout(healthTimer);
      }

      if (!response.ok) {
        this._setConnectionState('error', `Health check failed: ${response.status}`);
        throw new Error(`Backend not available (status ${response.status})`);
      }

      const healthData = await response.json();
      if (healthData && healthData.status && healthData.status !== 'healthy') {
        console.warn('[SomaBackend] ⏳ Backend or local chat model is still initializing');
        throw new Error('SOMA is still initializing');
      }
      console.log('[SomaBackend] ✅ Health check passed:', healthData);

      // Connect WebSocket
      this._setConnectionState('connecting');
      console.log('[SomaBackend] 🔌 Creating WebSocket connection...');
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        console.log('[SomaBackend] ✅ Connected to SOMA backend');
        this._setConnectionState('connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.stopPolling(); // kill any fallback polling now that WS is live
        this.emit('connect', { timestamp: Date.now() });
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[SomaBackend] Failed to parse message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[SomaBackend] WebSocket error:', error);
        this._setConnectionState('error', 'WebSocket error');
        this.emit('error', { message: 'WebSocket error', error });
      };

      this.ws.onclose = (event) => {
        console.log('[SomaBackend] Disconnected from SOMA backend, code:', event.code);
        this._setConnectionState('disconnected', `Code: ${event.code}`);
        this.isConnecting = false;
        this.stopPolling();
        // Only emit + reconnect if this wasn't a deliberate disconnect() call
        if (!this._intentionalDisconnect) {
          this.emit('disconnect', { timestamp: Date.now() });
          this.startPolling(); // fallback while reconnecting
          this.attemptReconnect();
        }
        this._intentionalDisconnect = false;
      };

    } catch (error) {
      console.error('[SomaBackend] Failed to connect:', error);
      this._setConnectionState('error', error.message);
      this.isConnecting = false;
      this.emit('error', { message: 'Connection failed', error: error.message });
      this.attemptReconnect();
    }
  }

  // Handle incoming WebSocket messages
  handleMessage(data) {
    const { type, payload, messageId, responseToId } = data;

    // If this is a response to a pending request
    if (responseToId && this.pendingRequests[responseToId]) {
      const { resolve, reject } = this.pendingRequests[responseToId];
      delete this.pendingRequests[responseToId]; // Clean up
      
      if (data.success === false) {
        reject(new Error(data.error || 'Backend request failed'));
      } else {
        resolve(data);
      }
      return; // Handled as a response, do not process as a broadcast event
    }

    // Otherwise, process as a general broadcast message
    switch (type) {
      case 'init':
        // Initial connection message with agents, brainStats, memory
        console.log('[SomaBackend] Processing init message:', data.data);
        this.emit('init', data.data || {});

        // Emit agents if present
        if (data.data?.agents && data.data.agents.length > 0) {
          console.log('[SomaBackend] Init contains agents:', data.data.agents.length);
          this.emit('agents', { arbiters: data.data.agents });
        }

        // Emit brainStats via metrics if present
        if (data.data?.brainStats) {
          console.log('[SomaBackend] Init contains brainStats');
          this.emit('metrics', { brainStats: data.data.brainStats });
        }

        // Emit memory if present
        if (data.data?.memory) {
          this.emit('memory', data.data.memory);
        }
        break;
      case 'metrics':
        this.emit('metrics', payload);
        break;
      case 'pulse':
        this.emit('pulse', payload);
        // Synthesis greeting arrives as { type:'pulse', payload: { type:'soma_proactive', message:... } }
        // Unwrap so soma_proactive listeners fire correctly
        if (payload?.type) this.emit(payload.type, payload);
        break;
      case 'agents':
        this.emit('agents', payload);
        break;
      case 'agent_spawned':
        // New agent spawned - refresh agents list
        this.fetchAgents();
        break;
      case 'agent_terminated':
        // Agent terminated - refresh agents list
        this.fetchAgents();
        break;
      case 'cache':
        this.emit('cache', payload);
        break;
      case 'status':
        this.emit('status', payload);
        break;
      case 'update':
        this.emit('update', payload);
        break;
      case 'chat_response':
        this.emit('chat_response', data.data);
        break;
      case 'log':
        this.emit('log', payload);
        break;
      case 'diagnostic_log':
        this.emit('diagnostic_log', payload);
        break;
      case 'diagnostic_result':
        this.emit('diagnostic_result', payload);
        break;
      case 'command_result':
        this.emit('command_result', payload);
        break;
      case 'agent_result':
        this.emit('agent_result', payload);
        break;
      case 'tool_result':
        this.emit('tool_result', payload);
        break;
      case 'trace':
        this.emit('trace', payload);
        break;
      case 'plan_updated': // backend broadcasts with underscore
      case 'plan:updated': // legacy colon variant — keep both
        this.emit('plan_updated', payload);
        break;
      case 'gmn_peer_changed':
        this.emit('gmn_peer_changed', payload);
        break;
      // KnowledgeApp real-time events — forwarded from server via MessageBroker
      case 'cognitive:debate':
        this.emit('cognitive:debate', payload);
        break;
      case 'learning:brain_activity':
        this.emit('learning:brain_activity', payload);
        break;
      case 'learning:node_created':
        this.emit('learning:node_created', payload);
        break;
      case 'price_tick':
        this.emit('price_tick', payload);
        break;
      case 'alert_triggered':
        this.emit('alert_triggered', payload);
        break;
      case 'repo_activity':
        this.emit('repo_activity', payload);
        break;
      case 'soma_proactive':
        this.emit('soma_proactive', payload);
        break;
      case 'soma_presence_probe':
        this.emit('soma_presence_probe', payload);
        break;
      case 'soma_remote_speech':
        this.emit('soma_remote_speech', payload);
        break;
      case 'soma_activity':
        this.emit('soma_activity', payload);
        break;
      case 'soma_lifecycle':
        this.emit('soma_lifecycle', payload);
        break;
      case 'vision_update':
        this.emit('vision_update', payload);
        break;
      case 'ghost_message':
        this.emit('ghost_message', payload);
        break;
      case 'ui_navigate':
        this.emit('ui_navigate', payload);
        break;
      case 'aperture_action':
        this.emit('aperture_action', payload);
        break;
      // ── AXIS real-time chat events ─────────────────────────────────────────
      case 'axis.message':
      case 'axis.message_edited':
      case 'axis.message_deleted':
      case 'axis.reaction':
      case 'axis.channel_created':
      case 'axis.channel_deleted':
      case 'axis.workspace_created':
      case 'axis.workspace_deleted':
      case 'axis.member_joined':
      case 'axis.member_removed':
        this.emit(type, payload);
        break;
      // ── Third Place real-time events ───────────────────────────────────────
      case 'thirdplace.position':
        this.emit('thirdplace.position', data);
        break;
      // ── ApertureOS agency bridge: SOMA-issued desktop commands ─────────────
      case 'aperture_command':
        this.emit('aperture_command', payload);
        break;
      default:
        // suppress noisy unknown-type logs in production
        break;
    }
  }

  // Send message to backend and wait for a specific response
  async sendMessage(message, timeout = 10000) { // Default timeout of 10 seconds
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected.');
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const fullMessage = { ...message, messageId };

    return new Promise((resolve, reject) => {
      // Store the resolve/reject functions for this messageId
      this.pendingRequests[messageId] = { resolve, reject };

      // Set a timeout for the request
      const timer = setTimeout(() => {
        delete this.pendingRequests[messageId];
        reject(new Error(`Message with ID ${messageId} timed out after ${timeout}ms`));
      }, timeout);

      // Override the reject function to clear the timer
      this.pendingRequests[messageId].reject = (reason) => {
        clearTimeout(timer);
        reject(reason);
      };
      this.pendingRequests[messageId].resolve = (value) => {
        clearTimeout(timer);
        resolve(value);
      };

      try {
        this.ws.send(JSON.stringify(fullMessage));
      } catch (error) {
        clearTimeout(timer);
        delete this.pendingRequests[messageId];
        reject(new Error(`Failed to send message: ${error.message}`));
      }
    });
  }

  async fetchAgents() {
    try {
      const data = await this.getArbiters();
      if (data && data.population) {
        this.emit('agents', { arbiters: data.population });
      }
    } catch (error) {
      console.error('[SomaBackend] Failed to fetch agents:', error);
    }
  }

  // Attempt to reconnect
  attemptReconnect() {
    this.reconnectAttempts++;
    // Exponential backoff: 3s → 6s → 12s → ... capped at 30s
    const delay = Math.min(this.reconnectDelay * Math.pow(1.5, Math.min(this.reconnectAttempts - 1, 6)), 30000);
    console.log(`[SomaBackend] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  // Start polling REST API for updates (Fallback only — called from onclose, not onopen)
  startPolling() {
    if (this.pollingInterval) return;
    // Don't start polling if WS is already open
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    this.pollingInterval = setInterval(async () => {
      // Stop as soon as WS reconnects
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.stopPolling();
        return;
      }
      try {
        const statusRes = await fetch(`${this.baseUrl}/api/status`);
        if (statusRes.ok) {
          const status = await statusRes.json();
          this.emit('metrics', { uptime: status.uptime || 0, arbiters: status.arbiters || [] });
        }
      } catch { /* silently fail */ }
    }, 5000);
  }

  // Stop polling
  stopPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log('[SomaBackend] Polling stopped');
    }
  }

  // Disconnect from backend
  disconnect() {
    console.log('[SomaBackend] Disconnecting...');
    this.stopPolling();
    this.lastDisconnectTime = Date.now();
    this.isConnecting = false;

    if (this.ws) {
      this._intentionalDisconnect = true; // prevent onclose from re-emitting + reconnecting
      this.ws.close();
      this.ws = null;
    }

    this.emit('disconnect', { timestamp: Date.now() });
  }

  // Send message to backend
  send(type, payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[SomaBackend] Cannot send message - not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (error) {
      console.error('[SomaBackend] Failed to send message:', error);
      return false;
    }
  }

  // REST API methods
  async fetch(endpoint, options = {}) {
    // Circuit breaker: only block when we know we're fully offline AND not mid-reconnect
    // This avoids freezing the dashboard during brief WS reconnect windows
    const wsOffline = !this.ws || this.ws.readyState === WebSocket.CLOSED;
    const notReconnecting = !this.isConnecting && this.reconnectAttempts > 2;
    if (wsOffline && notReconnecting) {
      if (!endpoint.includes('/health') && !endpoint.includes('/status') && !endpoint.includes('/api/soma')) {
        throw new Error('Circuit Breaker: Backend is offline');
      }
    }

    try {
      const identityHeaders = {};
      try {
        const token = localStorage.getItem('studio_session_token') || localStorage.getItem('studio_session_v1');
        let deviceId = localStorage.getItem('studio_device_id');
        if (!deviceId) {
          deviceId = `dev-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
          localStorage.setItem('studio_device_id', deviceId);
        }
        if (token) identityHeaders.Authorization = `Bearer ${token}`;
        identityHeaders['x-studio-device-id'] = deviceId;
        identityHeaders['x-studio-device-name'] = 'Command Bridge';
        identityHeaders['x-studio-device-type'] = 'command-bridge';
      } catch {}
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...identityHeaders,
          ...options.headers
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`[SomaBackend] Fetch error for ${endpoint}:`, error);
      throw error;
    }
  }

  // Convenience methods
  async getStatus() {
    return this.fetch('/api/status');
  }

  async getMemoryStatus() {
    return this.fetch('/api/memory/status');
  }

  async getArbiters() {
    return this.fetch('/api/population');
  }

  async spawnArbiter(config) {
    return this.fetch('/api/arbiter/spawn', {
      method: 'POST',
      body: JSON.stringify(config)
    });
  }

  async terminateArbiter(arbiterId) {
    return this.fetch('/api/arbiter/terminate', {
      method: 'POST',
      body: JSON.stringify({ arbiterId })
    });
  }

  async sendChat(message, context = {}) {
    return this.fetch('/api/soma/chat', {
      method: 'POST',
      body: JSON.stringify({ message, ...context })
    });
  }

  async createBusinessPlan(profile, context = {}) {
    return this.fetch('/api/soma/business-plans', {
      method: 'POST',
      body: JSON.stringify({ profile, ...context })
    });
  }

  async getBusinessPlanJob(jobId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}`);
  }

  async cancelBusinessPlanJob(jobId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  }

  async createBusinessPlanRevision(jobId, message, mode = 'auto') {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/revisions`, {
      method: 'POST', body: JSON.stringify({ message, mode })
    });
  }

  async getBusinessPlanRevision(jobId, revisionId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/revisions/${encodeURIComponent(revisionId)}`);
  }

  async applyBusinessPlanRevision(jobId, revisionId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/revisions/${encodeURIComponent(revisionId)}/apply`, { method:'POST' });
  }

  async discardBusinessPlanRevision(jobId, revisionId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/revisions/${encodeURIComponent(revisionId)}/discard`, { method:'POST' });
  }

  async getBusinessPlanVersions(jobId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/versions`);
  }

  async getBusinessPlanVersionDiff(jobId, version) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/versions/${encodeURIComponent(version)}/diff`);
  }

  async restoreBusinessPlanVersion(jobId, version) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/versions/${encodeURIComponent(version)}/restore`, { method:'POST' });
  }

  async createBusinessPlanScenario(jobId, scenario) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/scenarios`, { method:'POST', body:JSON.stringify(scenario) });
  }

  async updateBusinessPlanOperations(jobId, action) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/operations`, { method:'PATCH', body:JSON.stringify(action) });
  }

  async deleteBusinessPlan(jobId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}`, { method:'DELETE' });
  }

  async updateBusinessPlanModel(jobId, model) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/model`, { method:'PUT', body:JSON.stringify(model) });
  }

  async previewBusinessPlanModel(jobId, model) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/model/preview`, { method:'POST', body:JSON.stringify(model) });
  }

  async recalibrateBusinessPlanModel(jobId, request = '') {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/model/recalibrate`, { method:'POST', body:JSON.stringify({ request }) });
  }

  async applyBusinessPlanModelProposal(jobId, proposalId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/model/proposals/${encodeURIComponent(proposalId)}/apply`, { method:'POST' });
  }

  async discardBusinessPlanModelProposal(jobId, proposalId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/model/proposals/${encodeURIComponent(proposalId)}/discard`, { method:'POST' });
  }

  async prepareBusinessPlanArbiteriumHandoff(jobId) {
    return this.fetch(`/api/soma/business-plans/${encodeURIComponent(jobId)}/arbiterium-handoff`, { method:'POST' });
  }

  async downloadBusinessPlanExport(jobId, format) {
    const headers = {};
    try {
      const token = localStorage.getItem('studio_session_token') || localStorage.getItem('studio_session_v1');
      if (token) headers.Authorization = `Bearer ${token}`;
      const deviceId = localStorage.getItem('studio_device_id');
      if (deviceId) headers['x-studio-device-id'] = deviceId;
    } catch {}
    const response = await fetch(`${this.baseUrl}/api/soma/business-plans/${encodeURIComponent(jobId)}/exports/${encodeURIComponent(format)}`, { headers });
    if (!response.ok) throw new Error(`Export failed: HTTP ${response.status}`);
    const blob = await response.blob();
    const disposition = response.headers.get('content-disposition') || '';
    const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `business-plan.${format}`;
    return { blob, filename };
  }
}

// Create singleton instance
const somaBackend = new SomaBackend();

export default somaBackend;
