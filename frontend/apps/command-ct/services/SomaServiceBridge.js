import { getSharedSessionId } from '../../command-bridge/utils/sharedSession.js';
import { fetchWithTimeout, parseSseJsonStream, SomaChatTransport } from './SomaChatTransport.js';
import { ctAuthHeaders } from './CtAuth.js';

const BACKEND_URL = '/api';
const REQUEST_TIMEOUT = 120000; // 120 second timeout for AI requests

export class SomaServiceBridge {
  constructor(pathUpdateCallback) {
    this.pathUpdateCallback = pathUpdateCallback;
    this.isConnected = false;
    this.currentCwd = '';
    this.commandHistory = []; // Terminal commands only
    this.conversationHistory = []; // Full conversation with SOMA (Q&A)
    this.fileCache = new Map(); // Cache file contents
    this.baseSessionId = getSharedSessionId();
    this.conversationId = localStorage.getItem('soma_active_conversation') || 'default';
    this.userId = this.buildSessionId(this.conversationId);
    this.chatTransport = new SomaChatTransport({ baseUrl: BACKEND_URL, sessionId: this.userId });
  }

  async initialize() {
    console.log('[SomaServiceBridge] Initializing...');
    this.isConnected = true;

    // Load context if active conversation
    const activeId = localStorage.getItem('soma_active_conversation');
    if (activeId) {
      this.loadContext(activeId);
    }
  }

  buildSessionId(conversationId) {
    return `ct:${this.baseSessionId}:${conversationId || 'default'}`;
  }

  setConversationId(conversationId) {
    this.conversationId = conversationId || 'default';
    this.userId = this.buildSessionId(this.conversationId);
    this.conversationHistory = [];
    this.chatTransport.setSessionId(this.userId);
  }

  cancelActiveRequest() {
    this.chatTransport.cancel('Stopped by operator');
  }

  saveContext(id, data) {
    if (!id) return;
    const key = `soma_context_${id}`;
    localStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      data
    }));
    console.log(`[SomaServiceBridge] Saved context for ${id}`);
  }

  loadContext(id) {
    if (!id) return null;
    const key = `soma_context_${id}`;
    const stored = localStorage.getItem(key);
    if (stored) {
      try {
        const { data } = JSON.parse(stored);
        console.log(`[SomaServiceBridge] Loaded context for ${id}`);
        return data;
      } catch (e) {
        console.error('Failed to parse context', e);
      }
    }
    return null;
  }

  clearContext(id) {
    if (!id) return;
    localStorage.removeItem(`soma_context_${id}`);
  }

  isAgentConnected() {
    return this.isConnected;
  }

  async loadBackendHistory(limit = 30) {
    try {
      const raw = await this.chatTransport.fetchHistory(limit);
      const messages = raw
        .filter(item => item?.content || item?.text)
        .map(item => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: item.content || item.text || '',
          timestamp: item.timestamp || Date.now()
        }));
      this.conversationHistory = messages.map(item => ({ role: item.role, content: item.content }));
      return messages.map(item => ({
        id: item.timestamp || Date.now() + Math.random(),
        type: item.role === 'assistant' ? 'response' : 'command',
        content: item.content,
        timestamp: item.timestamp
      }));
    } catch (error) {
      console.warn('[SomaServiceBridge] Backend history unavailable:', error.message);
      return [];
    }
  }

  autocomplete(text) {
    // Basic command autocompletion
    const commands = ['search', 'find', 'help', 'clear', 'status'];
    const parts = text.trimStart().split(' ');
    const command = parts[0].toLowerCase();

    if (parts.length <= 1) {
      const completions = commands.filter(c => c.startsWith(command));
      return { completions, textToReplace: parts[0] };
    }

    return { completions: [], textToReplace: '' };
  }

  async *processCommand(commandOrPayload) {    // Handle object payloads (e.g. Vision)
    if (typeof commandOrPayload === 'object' && commandOrPayload.type === 'vision') {
      yield* this.handleVisionTask(commandOrPayload.query, commandOrPayload.file);
      return;
    }
    if (typeof commandOrPayload === 'object' && commandOrPayload.type === 'document') {
      yield* this.handleDocumentTask(commandOrPayload.query, commandOrPayload.file, commandOrPayload.deepThinking);
      return;
    }

    const input = typeof commandOrPayload === 'string' ? commandOrPayload : (commandOrPayload.query || '');
    const deepThinking = typeof commandOrPayload === 'object' ? commandOrPayload.deepThinking : false;

    if (!input.trim()) return;
    const trimmedInput = input.trim();

    // Local commands
    if (trimmedInput.toLowerCase() === 'clear') return;

    // The backend owns conversational history. This local list is a display cache only.
    this.commandHistory.push(trimmedInput);

    // 1. Parse context injections (@filename)
    const { query, contextFiles } = await this.parseContextInjections(trimmedInput);

    // 2. Detect command type
    const commandType = this.detectCommandType(query);

    // 3. Route to appropriate handler
    if (commandType === 'shell') {
      yield* this.handleShellExec(query.substring(1).trim());
    } else if (commandType === 'code') {
      yield* this.handleCodeTask(query, contextFiles);
    } else if (commandType === 'search') {
      yield* this.handleFileSearch(query);
    } else if (commandType === 'file_op') {
      yield* this.handleFileOperation(query);
    } else if (commandType === 'active_vision') {
      // Yield a directive for the UI to capture a frame and send it back
      yield {
        historyItems: [{ id: Date.now(), type: 'think', content: '👁️ Accessing visual sensors...' }],
        suggestion: '',
        // Special directive that Terminal.jsx will intercept
        directive: { type: 'request_camera_capture', query }
      };
    } else if (commandType === 'open_pulse') {
      // Don't auto-open - suggest user click Pulse button
      yield {
        historyItems: [{
          id: Date.now(),
          type: 'response',
          content: 'I can help you build that! Click the **Pulse** button in the header (cyan button with heartbeat) to open the Pulse Synthesis Engine, where we can design and create together.'
        }]
      };

    } else {
      yield* this.handleReasoning(query, contextFiles, deepThinking);
    }
  }

  /**
   * Handle vision/multimodal tasks with REAL file data
   */
  async *handleVisionTask(query, fileData) {
    yield { historyItems: [{ id: Date.now(), type: 'think', content: `👁️ Analyzing image: ${fileData.name}...` }] };

    try {
      // Send Base64 data to backend - updated to match new API endpoint format
      const response = await fetchWithTimeout(`${BACKEND_URL}/soma/vision/analyze`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          query: query || 'Analyze this image',
          file: {
            name: fileData.name,
            type: fileData.type,
            data: fileData.data // Base64 string
          }
        })
      }, 90000); // 90 second timeout for vision tasks

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Vision API Error: ${response.status} - ${errText}`);
      }

      const data = await response.json();

      // Yield structured response
      yield {
        historyItems: [{
          id: Date.now(),
          type: 'response',
          content: `### 👁️ Visual Analysis\n**Image:** ${fileData.name}\n\n${data.analysis || 'Analysis complete.'}`
        }]
      };

    } catch (e) {
      yield { historyItems: [{ id: Date.now(), type: 'error', content: `Vision Error: ${e.message}` }] };
    }
  }

  async *handleDocumentTask(query, fileData, deepThinking = false) {
    const extractionId = Date.now();
    yield { historyItems: [{ id: extractionId, type: 'think', content: `Reading ${fileData.name}...` }] };
    try {
      const response = await fetchWithTimeout(`${BACKEND_URL}/soma/document/extract`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ file: fileData })
      }, 90_000);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `Document extraction failed (${response.status})`);
      yield { replaceId: extractionId, historyItems: [] };
      yield* this.handleReasoning(query || `Analyze ${fileData.name}`, [{ name: data.name || fileData.name, content: data.text }], deepThinking);
    } catch (error) {
      yield { replaceId: extractionId, historyItems: [{ id: Date.now(), type: 'error', content: `Attachment error: ${error.message}`, retryable: true }] };
    }
  }

  async *handleShellExec(command) {
    yield { historyItems: [{ id: Date.now(), type: 'info', content: `Executing: ${command}` }] };
    try {
      const res = await fetch(`${BACKEND_URL}/soma/shell/exec`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ command })
      });
      const data = await res.json();
      if (data.cwd) {
        this.currentCwd = data.cwd;
        this.pathUpdateCallback(this.currentCwd);
      }
      yield { historyItems: [{ id: Date.now(), type: 'run', content: data.output }] };
    } catch (e) {
      yield { historyItems: [{ id: Date.now(), type: 'error', content: e.message }] };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Enhanced Features - Context Injection, Smart Routing, Multi-Arbiter Reasoning
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Parse context injections from query (@filename, @clipboard, etc.)
   * @param {string} input - Raw user input
   * @returns {Object} { query, contextFiles }
   */
  async parseContextInjections(input) {
    const contextFiles = [];
    let query = input;

    // Find all @filename references
    const filePattern = /@([\w\/\.\-]+)/g;
    const matches = [...input.matchAll(filePattern)];

    for (const match of matches) {
      const filename = match[1];

      // Load file content
      const fileContent = await this.loadFileContent(filename);
      if (fileContent) {
        contextFiles.push({
          name: filename,
          content: fileContent
        });
      }

      // Remove @filename from query
      query = query.replace(match[0], '').trim();
    }

    return { query, contextFiles };
  }

  /**
   * Detect command type from query
   * @param {string} query - User query
   * @returns {string} Command type: 'shell', 'code', 'reasoning', 'chat'
   */
  detectCommandType(query) {
    const lowerQuery = query.toLowerCase().trim();

    // Shell commands
    if (query.startsWith('$')) return 'shell';

    // Only slash-prefixed commands bypass the authoritative cognitive runtime.
    if (/^\/search\s+/i.test(query)) return 'search';

    // File Operations
    if (/^\/(?:move|copy)\s+/i.test(query)) return 'file_op';

    // Active Vision (User asking "What do you see?" without providing a file)
    if (/^\/(?:vision|camera)\b/i.test(query)) return 'active_vision';

    // Pulse / App Building Intent
    if (/^\/pulse\b/i.test(query)) return 'open_pulse';

    // Explicit command prefixes
    if (query.startsWith('/code') || query.startsWith('/implement')) return 'code';
    // Everything else — greetings, searches, coding requests, and tasks — goes through
    // the same backend cognitive runtime so SOMA can reason, remember, and execute.
    return 'reasoning';
  }

  /**
   * Load file content from filesystem
   * @param {string} filename - File path
   * @returns {string|null} File content or null
   */
  async loadFileContent(filename) {
    // Check cache first
    if (this.fileCache.has(filename)) {
      return this.fileCache.get(filename);
    }

    try {
      const res = await fetch(`${BACKEND_URL}/soma/fs/read`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ path: filename })
      });

      if (!res.ok) return null;

      const data = await res.json();
      if (data.success) {
        this.fileCache.set(filename, data.content);
        return data.content;
      }
    } catch (error) {
      console.error(`Failed to load file ${filename}:`, error);
    }

    return null;
  }

  /**
   * Handle reasoning tasks with multi-arbiter orchestration
   * @param {string} query - User query
   * @param {Array} contextFiles - Injected file contents
   */
  async *handleReasoning(query, contextFiles = [], deepThinking = false) {
    // Create thinking box with ID for updates
    const thinkingId = Date.now();

    // Only show full ThinkingBox for deep thinking mode (Brain button)
    // Otherwise just show simple "thinking..." text
    if (deepThinking) {
      yield {
        historyItems: [{
          id: thinkingId,
          type: 'thinking',
          isThinking: true,
          streamedText: 'Engaging deep reasoning...',
        }]
      };
    } else {
      // Standard queries - minimal thinking indicator
      yield { historyItems: [{ id: thinkingId, type: 'think', content: 'thinking...' }] };
    }

    let requestController = null;
    try {
      const request = await this.chatTransport.request({ message: query, deepThinking, contextFiles });
      const { response, controller } = request;
      requestController = controller;

      const contentType = response.headers.get('content-type') || '';

      // SSE streaming path — token-by-token for regular queries
      if (!deepThinking && contentType.includes('text/event-stream')) {
        const streamMsgId = thinkingId + 1;
        const progressId = thinkingId + 2;
        let fullText = '';
        let completed = false;
        let progressVisible = false;

        // Replace thinking indicator with an empty streaming message
        yield { replaceId: thinkingId, historyItems: [{ id: streamMsgId, type: 'response', content: '', streaming: true }] };

        for await (const evt of parseSseJsonStream(response.body)) {
            if (evt.progress) {
              const progressItem = {
                id: progressId,
                type: 'working',
                content: evt.message || `Hey, I’m still searching for “${query.slice(0, 90)}”…`,
                startTime: Date.now(),
                phase: evt.phase || 'searching'
              };
              if (progressVisible) {
                yield { updateId: progressId, historyItems: [progressItem] };
              } else {
                progressVisible = true;
                yield { historyItems: [progressItem] };
              }
            } else if (evt.token) {
              fullText += evt.token;
              yield { updateId: streamMsgId, historyItems: [{ id: streamMsgId, type: 'response', content: fullText, streaming: true }] };
            } else if (evt.timeout || evt.error) {
              completed = true;
              const errText = evt.response || evt.error || 'Taking too long. Try again.';
              if (progressVisible) yield { replaceId: progressId, historyItems: [] };
              yield { updateId: streamMsgId, historyItems: [{ id: streamMsgId, type: 'error', content: errText, streaming: false, retryable: true, errorCode: evt.errorCode }] };
            } else if (evt.done) {
              completed = true;
              if (progressVisible) yield { replaceId: progressId, historyItems: [] };
              const finalText = (evt.response || fullText).trim();
              yield { updateId: streamMsgId, historyItems: [{ id: streamMsgId, type: 'response', content: finalText, streaming: false, metadata: evt.metadata }] };
            }
          }
        if (progressVisible) yield { replaceId: progressId, historyItems: [] };
        if (!completed && fullText) {
          yield { updateId: streamMsgId, historyItems: [{ id: streamMsgId, type: 'response', content: fullText, streaming: false }] };
        }
        return;
      }

      // Non-streaming path (deep thinking or SSE not supported)
      const data = await response.json();

      if (data.success) {
        // Enhanced response with metadata from new endpoint
        const responseText = data.message || data.response;

        // Check for directive (e.g., open_pulse)
        if (data.metadata?.directive === 'open_pulse') {
          yield {
            historyItems: [{
              id: Date.now(),
              type: 'response',
              content: responseText
            }],
            directive: { type: 'request_pulse_confirmation' }
          };
          return;
        }

        // Parse for task markers: [WORKING:task description] and [COMPLETE:task description]
        const historyItems = [];
        let cleanResponse = responseText;

        // Check for working markers
        const workingRegex = /\[WORKING:([^\]]+)\]/g;
        const workingMatches = [...responseText.matchAll(workingRegex)];
        for (const match of workingMatches) {
          historyItems.push({
            id: Date.now() + Math.random(),
            type: 'working',
            content: match[1],
            startTime: Date.now()
          });
          cleanResponse = cleanResponse.replace(match[0], '');
        }

        // Check for completion markers
        const completeRegex = /\[COMPLETE:([^\]]+)\]/g;
        const completeMatches = [...responseText.matchAll(completeRegex)];
        for (const match of completeMatches) {
          historyItems.push({
            id: Date.now() + Math.random(),
            type: 'complete',
            content: `✓ ${match[1]}`
          });
          cleanResponse = cleanResponse.replace(match[0], '');
        }

        // For deep thinking mode, show full ThinkingBox with reasoning details
        // For regular queries, just show clean response
        const finalText = cleanResponse.trim();
        if (deepThinking) {
          yield {
            updateId: thinkingId,
            replaceId: thinkingId,
            historyItems: [{
              id: thinkingId,
              type: 'thinking',
              isThinking: false,
              streamedText: finalText,
              confidence: data.metadata?.confidence,
              uncertainty: data.metadata?.uncertainty,
              toolsUsed: data.metadata?.toolsUsed || [],
              debate: data.metadata?.debate,
              ideas: data.metadata?.ideas,
            }]
          };
        } else {
          // Standard response - replace "thinking..." with clean response
          yield {
            replaceId: thinkingId,
            historyItems: [{
              id: Date.now(),
              type: 'response',
              content: finalText
            }]
          };
        }
      } else {
        yield { historyItems: [{ id: Date.now(), type: 'error', content: data.error || 'Reasoning failed' }] };
      }
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Request stopped.' : `Error: ${error.message}`;
      yield { replaceId: thinkingId, historyItems: [{ id: Date.now(), type: error.name === 'AbortError' ? 'info' : 'error', content: message }] };
    } finally {
      this.chatTransport.completeRequest(requestController);
    }
  }

  /**
   * Handle simple chat/greetings - stays minimal, no ThinkingBox
   * @param {string} query - Chat query
   */
  async *handleSimpleChat(query) {
    yield* this.handleReasoning(query, [], false);
  }

  /**
   * Handle file search with extension parsing
   * @param {string} query - Search query
   */
  async *handleFileSearch(query) {
    // Extract actual search term and potential filters
    const searchPattern = /^(?:find|search|locate|explore)\s+(?:for\s+)?(.+)$/i;
    const match = query.match(searchPattern);
    const rawSearch = match ? match[1] : query;

    // Parse filters
    let searchTerm = rawSearch;
    const extensions = [];

    // Common mappings
    const typeMap = {
      'pdf': ['pdf'],
      'pdfs': ['pdf'],
      'image': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
      'images': ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'],
      'video': ['mp4', 'mkv', 'webm', 'mov'],
      'videos': ['mp4', 'mkv', 'webm', 'mov'],
      'doc': ['doc', 'docx', 'txt', 'md'],
      'docs': ['doc', 'docx', 'txt', 'md'],
      'code': ['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'html', 'css'],
      'script': ['js', 'ts', 'py', 'sh', 'bat']
    };

    // Check for type keywords
    for (const [key, exts] of Object.entries(typeMap)) {
      if (new RegExp(`\\b${key}\\b`, 'i').test(searchTerm)) {
        extensions.push(...exts);
        // Remove the type word from search term to clean it up? 
        // Optional: keeping it might still be useful for filename matching if they named it "my_image.png"
      }
    }

    yield { historyItems: [{ id: Date.now(), type: 'think', content: `🔍 Searching for "${searchTerm}"${extensions.length ? ` [${extensions.join(', ')}]` : ''}...` }] };

    try {
      const response = await fetch(`${BACKEND_URL}/soma/fs/search`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ query: searchTerm, extensions })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        yield {
          historyItems: [{
            id: Date.now(),
            type: 'search_results',
            content: JSON.stringify({ query: searchTerm, results: data.results })
          }]
        };
      } else {
        yield { historyItems: [{ id: Date.now(), type: 'error', content: data.error || 'Search failed' }] };
      }

    } catch (error) {
      yield { historyItems: [{ id: Date.now(), type: 'error', content: `Error: ${error.message}` }] };
    }
  }

  /**
   * Handle file operations (move/copy)
   */
  async *handleFileOperation(query) {
    // Regex to extract intent
    // Supports: "move X to Y", "copy X to Y"
    const opMatch = query.match(/^(move|copy|cp|mv)\s+(.+?)\s+to\s+(.+)$/i);

    if (!opMatch) {
      yield { historyItems: [{ id: Date.now(), type: 'error', content: 'Could not parse source and destination. Try: "move <source> to <destination>"' }] };
      return;
    }

    let operation = opMatch[1].toLowerCase();
    if (operation === 'cp') operation = 'copy';
    if (operation === 'mv') operation = 'move';

    const source = opMatch[2].trim();
    const destination = opMatch[3].trim();

    yield { historyItems: [{ id: Date.now(), type: 'think', content: `📦 ${operation === 'move' ? 'Moving' : 'Copying'} "${source}" to "${destination}"...` }] };

    try {
      const response = await fetch(`${BACKEND_URL}/soma/fs/operate`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ operation, sourcePath: source, destPath: destination })
      });

      const data = await response.json();

      if (data.success) {
        yield { historyItems: [{ id: Date.now(), type: 'info', content: `✅ Successfully ${operation === 'move' ? 'moved' : 'copied'} items.` }] };
      } else {
        yield { historyItems: [{ id: Date.now(), type: 'error', content: `Operation failed: ${data.error}` }] };
      }
    } catch (e) {
      yield { historyItems: [{ id: Date.now(), type: 'error', content: `System Error: ${e.message}` }] };
    }
  }

  /**
   * Handle coding tasks
   * @param {string} task - Coding task description
   * @param {Array} contextFiles - Injected file contents
   */
  async *handleCodeTask(task, contextFiles = []) {
    // Remove /code or /implement prefix
    const cleanTask = task.replace(/^\/(?:code|implement|analyze|test|refactor)\s*/i, '');

    yield { historyItems: [{ id: Date.now(), type: 'think', content: '🧠 SOMA: Analyzing code...' }] };

    try {
      const response = await fetch(`${BACKEND_URL}/soma/code/task`, {
        method: 'POST',
        headers: ctAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          task: cleanTask,
          files: contextFiles.map(f => ({ name: f.name, content: f.content })),
          language: 'detect'
        })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.status}`);
      }

      const data = await response.json();

      if (data.success) {
        // Yield code result with tree
        yield {
          historyItems: [{
            id: Date.now(),
            type: 'code',
            content: data.code,
            explanation: data.explanation,
            tests: data.tests,
            tree: data.tree,
            arbiters: data.arbitersUsed
          }]
        };
      } else {
        yield { historyItems: [{ id: Date.now(), type: 'error', content: data.error || 'Code generation failed' }] };
      }

    } catch (error) {
      yield { historyItems: [{ id: Date.now(), type: 'error', content: `Error: ${error.message}` }] };
    }
  }
}
