export type JSONValue = any;

// Ensure fetch polyfill for Electron - rewrite relative /api paths
function somaFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const API_BASE = window.location?.origin || 'http://localhost:3001';
  let url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString();
  
  if (typeof window !== 'undefined' && window.location?.protocol === 'file:' && url.startsWith('/api')) {
    url = API_BASE + url;
    if (typeof input === 'string') return fetch(url, init);
    return fetch(new Request(url, input as Request), init);
  }
  return fetch(input, init);
}

type EventCallback = (data: any) => void;

export class PulseClient {
  private ws: WebSocket | null = null;
  private wsConnected: boolean = false;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;
  private wsUrl: string = `${window.location?.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location?.host || 'localhost:3001'}/ws`;

  constructor(private base = '/api/pulse', private timeoutMs = 20000) {}

  // ========== WebSocket Connection ==========

  connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      try {
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('[PulseClient] ✅ WebSocket connected');
          this.wsConnected = true;
          this.reconnectAttempts = 0;
          this.emit('connect', { timestamp: Date.now() });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleWebSocketMessage(data);
          } catch (error) {
            console.error('[PulseClient] Failed to parse WebSocket message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[PulseClient] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[PulseClient] WebSocket disconnected');
          this.wsConnected = false;
          this.emit('disconnect', { timestamp: Date.now() });
          this.attemptReconnect();
        };
      } catch (error) {
        console.error('[PulseClient] Failed to create WebSocket:', error);
        reject(error);
      }
    });
  }

  disconnectWebSocket() {
    if (this.ws) {
      this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
      this.ws.close();
      this.ws = null;
      this.wsConnected = false;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PulseClient] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[PulseClient] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    setTimeout(() => {
      this.connectWebSocket().catch(err => {
        console.error('[PulseClient] Reconnection failed:', err);
      });
    }, this.reconnectDelay);
  }

  private handleWebSocketMessage(data: any) {
    const { type, payload } = data;

    // Emit event to all listeners
    this.emit(type, payload);

    // Handle specific message types
    switch (type) {
      case 'arbiter_update':
        this.emit('arbiter:update', payload);
        break;
      case 'task_progress':
        this.emit('task:progress', payload);
        break;
      case 'task_complete':
        this.emit('task:complete', payload);
        break;
      case 'workspace_update':
        this.emit('workspace:update', payload);
        break;
    }
  }

  sendWebSocketMessage(type: string, payload: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('[PulseClient] Cannot send message - WebSocket not connected');
      return false;
    }

    try {
      this.ws.send(JSON.stringify({ type, payload }));
      return true;
    } catch (error) {
      console.error('[PulseClient] Failed to send WebSocket message:', error);
      return false;
    }
  }

  // ========== Event System ==========

  on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  off(event: string, callback: EventCallback) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  private emit(event: string, data: any) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[PulseClient] Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  // ========== REST API ==========

  private async call<T = JSONValue>(path: string, init: RequestInit = {}): Promise<T> {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const apiKey = this.getApiKey();
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(init.headers || {}) };
      if (apiKey) headers['X-API-Key'] = apiKey;
      
      const res = await somaFetch(`${this.base}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers,
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(id);
    }
  }

  private getApiKey(): string | null {
    try {
      const keys = localStorage.getItem('soma_api_keys');
      return keys ? JSON.parse(keys).gemini : null;
    } catch { return null; }
  }

  generate(prompt: string) {
    return this.call('/generate', { method: 'POST', body: JSON.stringify({ prompt }) });
  }

  assist(input: string, context: string) {
    return this.call('/assist', { method: 'POST', body: JSON.stringify({ input, context }) });
  }

  steve(message: string, history: { role: string; content: string }[], context: any) {
    return this.call('/steve', { method: 'POST', body: JSON.stringify({ message, history, context }) });
  }

  deploy(blueprint: any[], projectName: string) {
    return this.call('/deploy', { method: 'POST', body: JSON.stringify({ blueprint, projectName }) });
  }

  vision(imageData: string, mimeType: string) {
    return this.call('/vision-blueprint', { method: 'POST', body: JSON.stringify({ imageData, mimeType }) });
  }

  heal(errorContext: any, blueprint: any[]) {
    return this.call('/heal', { method: 'POST', body: JSON.stringify({ errorContext, blueprint }) });
  }

  // ========== File System (Real) ==========

  fsList(path: string = '.') {
    return this.call('/fs/list', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
  }

  fsRead(path: string) {
    return this.call('/fs/read-file', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
  }

  fsWrite(path: string, content: string) {
    return this.call('/fs/write-file', {
      method: 'POST',
      body: JSON.stringify({ path, content })
    });
  }

  fsCreateDir(path: string) {
    return this.call('/fs/create-dir', {
      method: 'POST',
      body: JSON.stringify({ path })
    });
  }

  // ========== Arbiterium Integration ==========

  executeArbiteriumStep(step: { id: string; description: string; assignedArbiterRole?: string }, context: any = {}) {
    return this.call('/api/arbiterium/execute-step', {
      method: 'POST',
      body: JSON.stringify({
        stepId: step.id,
        description: step.description,
        arbiterRole: step.assignedArbiterRole || 'general',
        context
      })
    });
  }

  // ========== System & Shell ==========

  executeShell(command: string, cwd?: string) {
    return this.call('/shell/execute', {
      method: 'POST',
      body: JSON.stringify({ command, cwd })
    });
  }

  async getSystemStats() {
    // Calls root endpoint /api/status, bypassing /api/pulse prefix
    const res = await somaFetch('/api/status');
    return await res.json();
  }

  // ========== Arbiter Dispatch Methods ==========

  /**
   * Dispatch a task to PulseArbiter for intelligent routing
   */
  dispatch(taskType: string, taskData: any, context: any = {}) {
    return this.call('/arbiter/dispatch', {
      method: 'POST',
      body: JSON.stringify({ taskType, taskData, context })
    });
  }

  /**
   * Query available arbiter capabilities
   */
  queryCapabilities() {
    return this.call('/arbiter/capabilities', { method: 'GET' });
  }

  /**
   * Get arbiter status and metrics
   */
  getArbiterStatus() {
    return this.call('/arbiter/status', { method: 'GET' });
  }

  /**
   * Execute a multi-arbiter workflow
   */
  executeWorkflow(workflowData: any) {
    return this.call('/workflow/execute', {
      method: 'POST',
      body: JSON.stringify(workflowData)
    });
  }

  /**
   * Generate blueprint using multi-arbiter coordination
   */
  generateAgenticBlueprint(intent: string, existingFiles: any[] = [], projectContext: any = {}) {
    return this.call('/arbiter/generate-blueprint', {
      method: 'POST',
      body: JSON.stringify({ intent, existingFiles, projectContext })
    });
  }

  /**
   * Modify code using EngineeringSwarmArbiter
   */
  modifyCodeAgentic(filepath: string, request: string, context: any = {}) {
    return this.call('/arbiter/modify-code', {
      method: 'POST',
      body: JSON.stringify({ filepath, request, context })
    });
  }

  /**
   * Analyze code using CodeObservationArbiter
   */
  analyzeCode(code: string, filepath: string, analysisType: string = 'full') {
    return this.call('/arbiter/analyze-code', {
      method: 'POST',
      body: JSON.stringify({ code, filepath, analysisType })
    });
  }

  /**
   * Execute terminal command via ComputerControlArbiter
   */
  executeCommandAgentic(command: string, cwd: string = '', context: any = {}) {
    return this.call('/arbiter/execute-command', {
      method: 'POST',
      body: JSON.stringify({ command, cwd, context })
    });
  }

  /**
   * Preview command before execution with safety analysis
   */
  previewCommand(command: string, cwd: string = '', context: any = {}) {
    return this.call('/arbiter/preview-command', {
      method: 'POST',
      body: JSON.stringify({ command, cwd, context })
    });
  }

  /**
   * Generate command from natural language intent
   */
  generateCommand(intent: string, cwd: string = '', context: any = {}) {
    return this.call('/arbiter/generate-command', {
      method: 'POST',
      body: JSON.stringify({ intent, cwd, context })
    });
  }

  /**
   * Execute command with adaptive routing and safety checks
   */
  executeCommandRouted(command?: string, intent?: string, cwd: string = '', context: any = {}) {
    return this.call('/arbiter/execute-command-routed', {
      method: 'POST',
      body: JSON.stringify({ command, intent, cwd, context })
    });
  }

  /**
   * Analyze vision data via VisionProcessingArbiter
   */
  async analyzeVision(imageData: string, mimeType: string, analysisType: string = 'ui-to-code') {
    const res = await somaFetch('/api/perception/analyze-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData, mimeType, analysisType })
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  }

  /**
   * Steve assistance through SteveArbiter
   */
  steveAgentic(message: string, history: any[] = [], context: any = {}) {
    return this.call('/arbiter/steve-assist', {
      method: 'POST',
      body: JSON.stringify({ message, history, context })
    });
  }

  /**
   * Analyze preview HTML/CSS/JS for issues and suggestions
   */
  analyzePreview(previewData: {
    html: string;
    css: string;
    js: string;
    includeAccessibility?: boolean;
    includePerformance?: boolean;
    includeConsistency?: boolean;
  }) {
    return this.call('/arbiter/analyze-preview', {
      method: 'POST',
      body: JSON.stringify(previewData)
    });
  }

  /**
   * Analyze specific element context for suggestions
   */
  analyzeElement(elementData: {
    selector: string;
    tagName: string;
    classes: string[];
    styles: Record<string, string>;
    content: string;
  }) {
    return this.call('/arbiter/analyze-element', {
      method: 'POST',
      body: JSON.stringify(elementData)
    });
  }

  // ========== Workspace Management ==========

  /**
   * Create a new workspace
   */
  createWorkspace(name: string, path: string, metadata: any = {}) {
    return this.call('/workspace/create', {
      method: 'POST',
      body: JSON.stringify({ name, path, metadata })
    });
  }

  /**
   * Load existing workspace
   */
  loadWorkspace(workspaceId: string) {
    return this.call('/workspace/load', {
      method: 'POST',
      body: JSON.stringify({ workspaceId })
    });
  }

  /**
   * Save workspace state
   */
  saveWorkspace(workspaceId: string, workspace: any) {
    return this.call('/workspace/save', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, workspace })
    });
  }

  // ========== Pub/Sub for Arbiter Communication ==========

  /**
   * Subscribe to arbiter updates
   */
  subscribeToArbiter(arbiterName: string, callback: EventCallback) {
    this.on(`arbiter:${arbiterName}`, callback);
    this.sendWebSocketMessage('subscribe', { arbiter: arbiterName });
  }

  /**
   * Unsubscribe from arbiter updates
   */
  unsubscribeFromArbiter(arbiterName: string, callback: EventCallback) {
    this.off(`arbiter:${arbiterName}`, callback);
    this.sendWebSocketMessage('unsubscribe', { arbiter: arbiterName });
  }

  /**
   * Publish a task to arbiter system
   */
  publishTask(task: any) {
    return this.sendWebSocketMessage('task', task);
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.wsConnected;
  }

  // ========== Steve Tool Management ==========

  /**
   * Create a tool via Steve from natural language description
   */
  createToolViaSteve(description: string, context: any = {}) {
    return this.call('/steve/create-tool', {
      method: 'POST',
      body: JSON.stringify({ description, context })
    });
  }

  /**
   * List all Steve's registered tools
   */
  listSteveTools(category?: string) {
    const url = category ? `/steve/tools?category=${category}` : '/steve/tools';
    return this.call(url, { method: 'GET' });
  }

  /**
   * Execute a Steve tool
   */
  executeSteveTool(toolName: string, parameters: any = {}, context: any = {}) {
    return this.call('/steve/execute-tool', {
      method: 'POST',
      body: JSON.stringify({ toolName, parameters, context })
    });
  }

  /**
   * Alias for executeSteveTool for consistency
   */
  executeTool(toolName: string, parameters: any = {}, context: any = {}) {
    return this.executeSteveTool(toolName, parameters, context);
  }

  /**
   * Generate an execution plan from a goal description
   */
  generatePlan(goal: string, context: any = {}) {
    return this.call('/arbiter/generate-plan', {
      method: 'POST',
      body: JSON.stringify({ goal, context })
    });
  }

  /**
   * Get plan history from ContextManagerArbiter
   */
  getPlanHistory(workspace: string = 'default', limit: number = 20) {
    return this.call(`/arbiter/plan-history?workspace=${workspace}&limit=${limit}`, {
      method: 'GET'
    });
  }

  /**
   * Load a specific plan by ID
   */
  loadPlan(planId: string) {
    return this.call(`/arbiter/plan/${planId}`, {
      method: 'GET'
    });
  }

  /**
   * Update plan with execution results for learning
   */
  updatePlanResults(planId: string, results: any) {
    return this.call(`/arbiter/plan/${planId}/results`, {
      method: 'POST',
      body: JSON.stringify(results)
    });
  }

  // ========== SOMA Chat Interface ==========

  /**
   * Enhanced SOMA chat with conversation history, tool execution, and depth-first reasoning
   * 
   * This provides a GPT-4o/Claude-like experience with:
   * - Persistent conversation memory
   * - File access and tool execution
   * - Confidence/uncertainty indicators
   * - Process visibility
   * - Deep Thinking mode (Society of Mind internal debate)
   * 
   * @param message - User message
   * @param options - Optional configuration
   * @param options.sessionId - Session ID to continue a conversation
   * @param options.deepThinking - Enable Society of Mind debate (all 4 brains)
   * @returns Promise with SOMA's response and metadata
   */
  somaChat(message: string, options?: { sessionId?: string; deepThinking?: boolean }) {
    return this.call('/soma/chat', {
      method: 'POST',
      body: JSON.stringify({ 
        message, 
        sessionId: options?.sessionId,
        deepThinking: options?.deepThinking || false
      })
    });
  }
}

// Export singleton instance
export const pulseClient = new PulseClient();
export const client = pulseClient; // Alias for backward compatibility
