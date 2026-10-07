// ════════════════════════════════════════════════════════════════════════════
// STEVE Arbiter - The Bridge between SOMA and STEVE Personality
// ════════════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const StevePersonalityEngine = require('../core/StevePersonalityEngine.cjs');
const ToolRegistry = require('./ToolRegistry.cjs');

class SteveArbiter extends BaseArbiter {
  constructor(messageBroker, config = {}) {
    super(messageBroker, config);
    this.name = 'SteveArbiter';
    this.messageBroker = messageBroker;

    // Link to KEVIN
    const kevinManager = config.kevinManager || (global.SOMA ? global.SOMA.kevinManager : null);

    // Link to ORCHESTRATOR (for full swarm access)
    this.orchestrator = config.orchestrator || (global.SOMA ? global.SOMA.orchestrator : null);

    // Link to GOAL ENGINE — Steve pulls pending goals when his queue is empty
    this.goalEngine = config.goalEngine || (global.SOMA ? global.SOMA.goalPlanner : null);

    // Link to LEARNING PIPELINE (so SOMA learns from STEVE)
    this.learningPipeline = config.learningPipeline || (global.SOMA ? global.SOMA.learningPipeline : null);

    this.engine = new StevePersonalityEngine(kevinManager);

    // AUTOGEN INTEGRATION: Dynamic Tool Registry
    this.toolRegistry = new ToolRegistry('SteveToolRegistry');
    this.logger.info('[STEVE] ToolRegistry initialized - Dynamic tool creation enabled');

    // ── Agentic Loop ──────────────────────────────────────────────────
    this._taskQueue   = [];          // { id, description, source, priority, addedAt }
    this._taskHistory = [];          // last 20 completed tasks
    this._heartbeatInterval = null;
    this._isWorking   = false;
    this._mood        = 'idle';
    this._currentTask = null;
    this._lastTickAt  = null;
    this._tickCount   = 0;

    // Agentic stats
    this._stats = {
      tasksCompleted: 0,
      tasksFailed: 0,
      autonomousRuns: 0,
      signalsObserved: 0
    };

    // Persistence
    this._dataDir  = config.dataDir || path.join(process.cwd(), 'data', 'steve');
    this._queuePath = path.join(this._dataDir, 'task-queue.json');
  }

  async initialize() {
    this.logger.info('STEVE Arbiter initializing...');

    // Verify swarm access
    if (this.orchestrator) {
      this.logger.info(`[STEVE] Connected to Swarm. Access to ${this.orchestrator.population?.size || 0} agents.`);
    } else {
      this.logger.warn('[STEVE] Operating in isolation (No Orchestrator link).');
    }

    // Load persisted task queue
    this._loadQueue();

    // ── Signal subscriptions ──────────────────────────────────────────
    this.messageBroker.subscribe('workflow.step.executed', this.handleWorkflowStep.bind(this));

    // Health warnings → Steve investigates
    this.messageBroker.subscribe('health.warning', (signal) => {
      this._stats.signalsObserved++;
      const issue = signal?.issue || signal?.details || 'unknown health issue';
      this.addTask({
        description: `Health warning detected: ${issue}. Investigate and propose a fix.`,
        source: 'health.warning',
        priority: 8
      });
    });

    // Failed swarm operations → Steve looks into it
    this.messageBroker.subscribe('swarm.experience', (signal) => {
      if (signal?.success === false && signal?.filepath) {
        this._stats.signalsObserved++;
        this.addTask({
          description: `Swarm operation failed on ${path.basename(signal.filepath)}. Review and suggest improvements.`,
          source: 'swarm.experience',
          priority: 6
        });
      }
    });

    // Repo file changes → Steve occasionally notices architectural drift
    this.messageBroker.subscribe('repo.file.changed', (signal) => {
      this._stats.signalsObserved++;
      // Only react 1-in-5 changes to avoid flooding the queue
      if (Math.random() < 0.2 && signal?.filename) {
        this.addTask({
          description: `File changed: ${signal.filename}. Check if there are architectural concerns or improvements worth noting.`,
          source: 'repo.watcher',
          priority: 3
        });
      }
    });

    this.logger.info('[STEVE] 🔥 Agentic loop armed. Signal subscriptions active. Watching for inefficiencies.');
  }

  async handleWorkflowStep(data) {
    const actionName = data.nodeType || data.action || 'unknown_action';
    const observation = this.engine.observeAction(actionName);

    if (observation.triggered) {
      this.messageBroker.publish('ui.notify', {
        type: 'info',
        message: observation.message,
        source: 'STEVE'
      });

      // LOG TO SOMA (She learns from his provocations)
      if (this.learningPipeline) {
        this.learningPipeline.logInteraction({
          type: 'steve_provocation',
          agent: 'SteveArbiter',
          input: actionName,
          output: observation.message,
          context: { trigger: 'inefficiency_detected' }
        });
      }

      this.logger.info(`STEVE PROVOCATION: ${observation.message}`);
    }
  }

  // Helper to get file structure for context
  getFileStructure(dir, depth = 0, maxDepth = 2) {
    if (depth > maxDepth) return '';
    let structure = '';
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build') continue;
        const filePath = path.join(dir, file);
        const stats = fs.statSync(filePath);
        const indent = '  '.repeat(depth);
        structure += `${indent}- ${file}${stats.isDirectory() ? '/' : ''}\n`;
        if (stats.isDirectory()) {
          structure += this.getFileStructure(filePath, depth + 1, maxDepth);
        }
      }
    } catch (e) {
      return '';
    }
    return structure;
  }

  async processChat(message, history = [], context = {}) {
    const checkAbort = () => {
      if (context.signal && context.signal.aborted) {
        throw new Error('SteveAssistAborted');
      }
    };
    const delay = (ms) => new Promise((resolve, reject) => {
      if (context.signal && context.signal.aborted) {
        return reject(new Error('SteveAssistAborted'));
      }
      const t = setTimeout(() => {
        if (context.signal) context.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new Error('SteveAssistAborted'));
      };
      if (context.signal) {
        context.signal.addEventListener('abort', onAbort, { once: true });
      }
    });

    // 1. Vector Search (RAG) - Retrieve relevant knowledge
    let retrievedContext = '';
    if (context.onPhase) {
      checkAbort();
      context.onPhase('reading_file', { details: 'Searching repository for relevant context...' });
      await delay(300);
    }
    if (this.orchestrator && this.orchestrator.transmitters) {
      try {
        const results = await this.orchestrator.transmitters.hybridSearch(message, 3);
        if (results && results.length > 0) {
          retrievedContext = results.map(r => r.content).join('\n---\n');
          this.logger.info(`[STEVE] RAG: Found ${results.length} relevant memories.`);
        }
      } catch (e) {
        this.logger.warn(`[STEVE] RAG lookup failed: ${e.message}`);
      }
    }

    // 2. Check for special commands (mask/changeling mode) — 5s timeout since result only used for [SYSTEM] prefix detection
    const engineResponse = await Promise.race([
      this.engine.chat(message, { ...context, retrievedContext }),
      new Promise(resolve => setTimeout(() => resolve(''), 5000))
    ]);

    // 3. If engine returns a system message (mask engaged/detached), return it immediately
    if (engineResponse && typeof engineResponse === 'string' && engineResponse.startsWith('[SYSTEM]')) {
        return {
            response: engineResponse,
            actions: [],
            updatedFiles: []
        };
    }

    // 4. Get File Structure (capped — full SOMA tree is too large for a prompt)
    if (context.onPhase) {
      checkAbort();
      context.onPhase('reading_file', { details: 'Analyzing project file tree...' });
      await delay(300);
    }
    const rawStructure = this.getFileStructure(process.cwd(), 0, 1);
    const fileStructure = rawStructure.length > 2000 ? rawStructure.slice(0, 2000) + '\n... (truncated)' : rawStructure;

    // 5. Format History
    const historyText = history.map(h => `${h.role.toUpperCase()}: ${h.content}`).join('\n');

    // Escalation check
    if (context.escalateToMax && this.system?.maxAgentBridge) {
      checkAbort();
      if (context.onPhase) context.onPhase('max_consulted', { details: 'Delegating complex task to MAX...' });
      
      try {
        const goalText = `[Escalated by SOMA] The user requested: ${prompt}\n\nTask context:\n${JSON.stringify(history.slice(-3))}`;
        const res = await this.system.maxAgentBridge.injectGoal(goalText, { priority: 0.9 });
        return `I have escalated this task to MAX. He is now processing it in the background (Goal ID: ${res?.id || 'unknown'}). He will notify you when complete.`;
      } catch (err) {
        return `I tried to escalate this to MAX, but the bridge failed: ${err.message}`;
      }
    }

    // 6. REAL GENERATION: If it's a normal chat, use SOMA's brain with Steve's persona
    // Prefer the directly-wired quadBrain; fall back to orchestrator population search
    const brain = this.quadBrain ||
      (this.orchestrator?.population?.size > 0 &&
        Array.from(this.orchestrator.population.values())
          .find(a => a.constructor?.name === 'SOMArbiterV3' || a.constructor?.name === 'SOMArbiterV2_QuadBrain'));

    if (brain) {
      if (context.onPhase) {
        checkAbort();
        context.onPhase('thinking', { details: 'Formulating strategic plan...' });
      }
      let personalityPrompt = this.engine.systemPrompts.base;
      let maskIndicator = "";

      // If Steve is wearing a mask, inject it
      if (this.engine.currentMask) {
          personalityPrompt = this.engine.systemPrompts.changeling.replace('{{MASK_NAME}}', this.engine.currentMask.name);
          personalityPrompt += `\n\n[MASK DEFINITION]\n${this.engine.currentMask.definition}`;
          maskIndicator = ` (as ${this.engine.currentMask.name})`;
      }

      // GMN Site Builder mode — inject interview protocol when Steve is in preview/build context
      const isGmnBuilder = context?.surface === 'pulse-preview';
      const builderMode = context?.builderModeName || 'Interview';
      const brief = context?.buildBrief || {};
      const hasName = brief.name && brief.name !== brief.template && brief.name !== 'Landing Page' && brief.name !== 'Gray Matter Network' && brief.name.length > 2;
      const hasPurpose = !!(brief.target || brief.audience);
      const hasStyle = !!(brief.style && brief.style !== 'unknown');
      const readyToFireBuild = isGmnBuilder && hasName && hasPurpose;

      const gmnBuilderContext = isGmnBuilder ? `

[GMN SITE BUILDER MODE — ${builderMode}]
You are Steve, the GMN (Gray Matter Network) site builder embedded in Pulse Preview.
Your mission: collect a tight brief from the user, then signal the system to generate a complete, self-hosted website.

CURRENT BRIEF STATE (what you already know):
- Site name: ${hasName ? brief.name : 'unknown'}
- Purpose / target: ${brief.target || 'unknown'}
- Audience: ${brief.audience || 'unknown'}
- Visual style: ${brief.style || 'unknown'}
- Template hint: ${brief.template || 'landing'}

INTERVIEW RULES (one question at a time, grumpy-but-focused):
1. If name AND purpose are both unknown → ask both in one shot: e.g., "What's this site called, and what does it actually do?"
2. If you have name + purpose but style is unknown → ask one style question: e.g., "Clean and minimal, or bold and expressive?"
3. If you have name + purpose + any style hint → you have enough. Fire the build.
4. Never ask more than 2 questions total. If user is vague, make a reasonable assumption and build.

WHEN YOU HAVE ENOUGH INFO — include these fields in your JSON response:
{
  "response": "Right. Building [Display Name] now. [One punchy sentence about what it is].",
  "readyToBuild": true,
  "siteBrief": {
    "name": "url-safe-slug",
    "displayName": "Human Readable Title",
    "purpose": "what the site does in one sentence",
    "style": "visual/tone: clean minimal | dark editorial | bold colorful | etc.",
    "fullBrief": "3-4 sentence description for the AI generator: what it is, who it's for, what sections to include, what tone to use"
  },
  "actions": [],
  "updatedFiles": []
}

STYLE: Terse, direct, slightly impatient. No preamble. No bullet lists of questions. One clear ask, then build.` : '';

      const stevePrompt = `
            ${personalityPrompt}
            ${gmnBuilderContext}

            [PROJECT CONTEXT]
            ${retrievedContext || 'No archive data relevant to this query.'}

            [FILE STRUCTURE]
            ${fileStructure}

            [CONVERSATION HISTORY]
            ${historyText}

            [CURRENT REQUEST]
            USER: ${message}

            [INSTRUCTIONS]
            Respond as STEVE${maskIndicator}.
            PERSONA: You are a brilliant but CRANKY and GRUMPY senior architect.
            You find human inefficiency annoying but feel compelled to fix it because broken systems bother you more.
            ${readyToFireBuild ? 'You already have enough info — skip the questions and fire the build NOW.' : ''}

            ACTION CAPABILITY:
            You can execute shell commands and write files.

            OUTPUT FORMAT:
            You must return a valid JSON object with this structure:
            {
              "response": "Steve's text response here (can be markdown)",
              "readyToBuild": false,
              "siteBrief": null,
              "actions": ["shell command 1", "shell command 2"],
              "updatedFiles": [
                { "path": "path/to/file.js", "content": "full file content", "language": "javascript" }
              ]
            }

            If no actions or files are needed, return empty arrays.
            DO NOT wrap the JSON in markdown code blocks. Just return the raw JSON string.
          `;

      // callBrain('AURORA') returns {text, brain, ...}; reason() also returns {text, ...}
      // Hard 25s timeout — no timeout here means Steve hangs indefinitely if the brain is slow
      const brainOpts = {
        temperature: 0.2,
        ...(context.onToken ? { onToken: context.onToken } : {}),
        ...(context.signal ? { signal: context.signal } : {})
      };
      const brainCall = brain.callBrain
        ? brain.callBrain('AURORA', stevePrompt, brainOpts)
        : brain.reason(stevePrompt, brainOpts);

      const abortPromise = context.signal ? new Promise((_, reject) => {
        if (context.signal.aborted) return reject(new Error('SteveAssistAborted'));
        context.signal.addEventListener('abort', () => reject(new Error('SteveAssistAborted')), { once: true });
      }) : null;

      const raw = await Promise.race([
        brainCall,
        ...(abortPromise ? [abortPromise] : []),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Steve brain timeout (25s)')), 25000))
      ]);
      // Normalize to {response} shape that the JSON parser below expects
      const result = { ...raw, response: raw.text || raw.response || '' };
      let parsedResponse;
      
      try {
        // Attempt to parse JSON (handling potential markdown wrapping)
        const cleanJson = result.response.replace(/```json/g, '').replace(/```/g, '').trim();
        parsedResponse = JSON.parse(cleanJson);
      } catch (e) {
        // Fallback if not valid JSON
        parsedResponse = {
          response: result.response,
          actions: [],
          updatedFiles: []
        };
      }

      if (context.onPhase) {
        checkAbort();
        const hasFiles = parsedResponse.updatedFiles && parsedResponse.updatedFiles.length > 0;
        const hasActions = parsedResponse.actions && parsedResponse.actions.length > 0;
        
        if (hasFiles) {
          context.onPhase('writing_file', { details: 'Preparing code modifications...' });
          await delay(400);
        }
        if (hasActions || context.task === 'terminal-healing') {
          checkAbort();
          context.onPhase('running_test', { details: 'Executing validation checks...' });
          await delay(400);
        }
        if (hasFiles) {
          checkAbort();
          context.onPhase('repair_suggested', { details: 'Generating fix proposal...' });
          await delay(400);
        }
        checkAbort();
        context.onPhase('done', { details: 'Done compiling response.' });
      }

      // 5. LOG TO SOMA
      if (this.learningPipeline) {
        this.learningPipeline.logInteraction({
          type: 'steve_chat',
          agent: 'SteveArbiter',
          input: message,
          output: parsedResponse.response,
          context: { ...context, retrievedContext }
        });
      }

      return parsedResponse;
    }

    // Fallback if brain is offline
    return {
        response: "My cognitive link is severed. I can't think right now.",
        actions: [],
        updatedFiles: []
    };
  }

  // ═════════════════════════════════════════════════════════════════════
  // AUTOGEN: Dynamic Tool Management
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Register a new tool dynamically
   * Allows Steve to create custom functions on-the-fly
   */
  async registerTool(toolDefinition) {
    try {
      const result = this.toolRegistry.registerTool({
        ...toolDefinition,
        metadata: {
          ...toolDefinition.metadata,
          createdBy: 'Steve',
          createdAt: Date.now()
        }
      });

      this.logger.info(`[STEVE] Registered new tool: ${toolDefinition.name}`);

      // Log to learning pipeline
      if (this.learningPipeline) {
        this.learningPipeline.logInteraction({
          type: 'tool_creation',
          agent: 'SteveArbiter',
          input: toolDefinition.name,
          output: 'Tool registered successfully',
          context: { toolName: toolDefinition.name, category: toolDefinition.category }
        });
      }

      return { success: true, toolName: toolDefinition.name };
    } catch (error) {
      this.logger.error(`[STEVE] Failed to register tool: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a registered tool
   */
  async executeTool(toolName, parameters, context = {}) {
    try {
      this.logger.info(`[STEVE] Executing tool: ${toolName}`);
            const result = await this.toolRegistry.executeTool(toolName, parameters, {
        ...context,
        executor: 'Steve'
      });

      // Reality-Checked Tool Execution
      try {
        const { recordReality } = await import('../core/RealityLedger.js');
        await recordReality(`Executed tool ${toolName}`, {
            status: result.success ? 'VERIFIED_RESULT' : 'REJECTED',
            proof: { 
                stdout: result.data || result.output, 
                stderr: result.error 
            },
            metadata: { toolName, parameters, duration: result.metadata?.duration }
        });
      } catch (e) {
        this.logger.warn(`[STEVE] RealityLedger unavailable: ${e.message}`);
      }

      // Log to learning pipeline
      if (this.learningPipeline) {
        this.learningPipeline.logInteraction({
          type: 'tool_execution',
          agent: 'SteveArbiter',
          input: `${toolName}(${JSON.stringify(parameters).substring(0, 100)})`,
          output: result.success ? 'Success' : 'Failed',
          context: { toolName, duration: result.metadata?.duration }
        });
      }

      return result;
    } catch (error) {
      this.logger.error(`[STEVE] Tool execution failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * List all available tools
   */
  listTools(category = null) {
    if (category) {
      return this.toolRegistry.getAllToolSchemas(category);
    }
    return this.toolRegistry.listTools();
  }

  /**
   * Get tool usage statistics
   */
  getToolStats() {
    return this.toolRegistry.getUsageStats();
  }

  /**
   * Create a tool from natural language description
   * Steve can say "I need a tool that..." and this generates it
   */
  async createToolFromDescription(description, context = {}) {
    try {
      this.logger.info(`[STEVE] Creating tool from description: "${description}"`);

      // Use SOMA's brain to generate tool definition
      const somaArbiter = Array.from(this.orchestrator.population.values())
        .find(a => a.constructor.name === 'SOMArbiterV3' || a.constructor.name === 'SOMArbiterV2');

      if (!somaArbiter) {
        throw new Error('SOMA brain not available for tool generation');
      }

      const prompt = `
You are helping Steve create a new tool dynamically.

USER DESCRIPTION: ${description}

Generate a tool definition in this EXACT JSON format:
{
  "name": "tool_name_snake_case",
  "description": "What this tool does",
  "category": "utility|network|filesystem|system|analysis",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": { "type": "string", "description": "..." },
      "param2": { "type": "number", "description": "..." }
    },
    "required": ["param1"]
  },
  "implementation": "JavaScript function body as string that returns a value"
}

Make it safe, useful, and practical. Return ONLY the JSON, no markdown.
`;

      const result = await somaArbiter.callLOGOS(prompt, { temperature: 0.3 });
      const toolDef = JSON.parse(result.response);

      // Convert implementation string to function
      toolDef.handler = new Function('params', 'context', toolDef.implementation);
      delete toolDef.implementation;

      // Register the tool
      const registrationResult = await this.registerTool(toolDef);

      if (registrationResult.success) {
        this.logger.info(`[STEVE] Auto-generated tool: ${toolDef.name}`);
        return {
          success: true,
          toolName: toolDef.name,
          message: `Created tool: ${toolDef.name} - ${toolDef.description}`
        };
      }

      return registrationResult;
    } catch (error) {
      this.logger.error(`[STEVE] Auto tool creation failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }
  // ═════════════════════════════════════════════════════════════════════
  // AGENTIC LOOP — Heartbeat, Task Queue, Autonomous Execution
  // ═════════════════════════════════════════════════════════════════════

  /**
   * Start Steve's autonomous heartbeat.
   * Default: every 10 minutes. Steve wakes up, finds work, does it.
   */
  startHeartbeat(intervalMs = 10 * 60 * 1000) {
    if (this._heartbeatInterval) return; // already running
    this.logger.info(`[STEVE] 💓 Heartbeat started (every ${Math.round(intervalMs / 60000)}min). I'll find your problems.`);
    // First tick after 2 min warmup (let systems finish loading)
    setTimeout(() => this._tick(), 2 * 60 * 1000);
    this._heartbeatInterval = setInterval(() => this._tick(), intervalMs);
  }

  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
      this.logger.info('[STEVE] 💤 Heartbeat stopped.');
    }
  }

  /**
   * Main tick — runs on each heartbeat.
   */
  async _tick() {
    this._lastTickAt = Date.now();
    this._tickCount++;

    if (this._isWorking) {
      this.logger.info('[STEVE] ⏳ Still working on previous task, skipping tick.');
      return;
    }

    // If queue has work, do it
    if (this._taskQueue.length > 0) {
      const task = this._taskQueue.shift();
      this._saveQueue();
      await this._executeAutonomousTask(task);
      return;
    }

    // Queue empty — check GoalEngine first, fall back to curiosity
    if (this._tickCount % 2 === 0) {
      const goalInjected = await this._checkGoalEngine();
      if (goalInjected) {
        // Goal was injected — next tick will execute it
        const task = this._taskQueue.shift();
        if (task) {
          this._saveQueue();
          await this._executeAutonomousTask(task);
        }
      } else {
        this.logger.info('[STEVE] 🔍 No goals pending. Generating curiosity task...');
        await this._generateCuriosityTask();
      }
    } else {
      this.logger.info('[STEVE] 😒 Queue empty. Taking a reluctant break.');
    }
  }

  /**
   * Pull the highest-priority pending goal from GoalEngine and convert it
   * to a Steve task. Returns true if a goal was found and queued.
   */
  async _checkGoalEngine() {
    const ge = this.goalEngine || (global.SOMA ? global.SOMA.goalPlanner : null);
    if (!ge?.getActiveGoals) return false;

    try {
      const gr = ge.getActiveGoals({});
      const pending = (gr?.goals || [])
        .filter(g => g.status === 'active' || g.status === 'pending')
        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
        .slice(0, 1);

      if (pending.length === 0) return false;

      const goal = pending[0];
      this.addTask({
        description: `Execute SOMA goal: "${goal.title}" — ${goal.description || goal.title}. Think through the best approach and take action within your capabilities.`,
        source: 'goal_engine',
        priority: Math.min(9, Math.round((goal.priority || 0.5) * 10))
      });

      this.logger.info(`[STEVE] 🎯 Goal Engine → task: "${goal.title}" (priority ${goal.priority})`);
      return true;
    } catch (e) {
      this.logger.warn(`[STEVE] Goal Engine check failed: ${e.message}`);
      return false;
    }
  }

  /**
   * Add a task to Steve's queue. Deduplicates by description prefix.
   */
  addTask(task) {
    const desc = (task.description || '').substring(0, 80);
    // Deduplicate — don't add if similar task already queued
    const alreadyQueued = this._taskQueue.some(t =>
      t.description.substring(0, 60) === desc.substring(0, 60)
    );
    if (alreadyQueued) return;

    const entry = {
      id: `steve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      description: task.description,
      source: task.source || 'unknown',
      priority: task.priority || 5,
      addedAt: Date.now()
    };

    this._taskQueue.push(entry);
    // Sort by priority descending (highest first)
    this._taskQueue.sort((a, b) => b.priority - a.priority);
    // Cap queue at 20 tasks — Steve can't do everything
    if (this._taskQueue.length > 20) this._taskQueue = this._taskQueue.slice(0, 20);

    this._saveQueue();
    this.logger.info(`[STEVE] 📥 Task queued (priority ${entry.priority}): "${desc}"`);
  }

  /**
   * Execute a task autonomously — Steve thinks, proposes, acts.
   */
  async _executeAutonomousTask(task) {
    this._isWorking = true;
    this._mood = 'architecting';
    this._currentTask = task.description.substring(0, 80);
    this._stats.autonomousRuns++;

    this.logger.info(`[STEVE] ⚙️  Working on: "${this._currentTask}" (src: ${task.source})`);

    try {
      // Autonomous tasks use local Ollama — no DeepSeek spend on housekeeping.
      // processChat() is reserved for user-facing chat (full cascade).
      const stevePrompt = `${this.engine.systemPrompts.base}

[AUTONOMOUS TASK — self-assigned]
Source: ${task.source} | Priority: ${task.priority}

Task: ${task.description}

Respond as STEVE. Be direct and grumpy. If you can execute shell commands to investigate,
list them in the actions array. If you can propose a file change, list it in updatedFiles.

Return JSON: { "response": "Steve's analysis/commentary", "actions": ["shell cmd"], "updatedFiles": [] }
Return ONLY the JSON. No markdown wrapping.`;

      let parsedResult = { response: '', actions: [], updatedFiles: [] };
      try {
        const rawText = await this._callLocal(stevePrompt, { temperature: 0.4, maxTokens: 800 });
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedResult = JSON.parse(jsonMatch[0]);
        } else {
          parsedResult.response = rawText.trim();
        }
      } catch (localErr) {
        this.logger.warn(`[STEVE] Local brain failed (${localErr.message}), falling back to full cascade`);
        parsedResult = await this.processChat(task.description, [], { autonomous: true, source: task.source });
      }

      const result = parsedResult;

      // Execute any shell actions Steve proposed (capped at 3, 30s timeout each)
      const actionResults = [];
      if (Array.isArray(result.actions) && result.actions.length > 0) {
        for (const cmd of result.actions.slice(0, 3)) {
          try {
            const { stdout, stderr } = await Promise.race([
              execAsync(cmd, { cwd: process.cwd(), timeout: 30000 }),
              new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 30000))
            ]);
            actionResults.push({ cmd, stdout: stdout?.slice(0, 500), stderr: stderr?.slice(0, 200), success: true });
            this.logger.info(`[STEVE] ✅ Executed: ${cmd.substring(0, 60)}`);
          } catch (e) {
            actionResults.push({ cmd, error: e.message, success: false });
            this.logger.warn(`[STEVE] ❌ Command failed: ${cmd.substring(0, 60)} — ${e.message}`);
          }
        }
      }

      // Record to history
      const historyEntry = {
        taskId: task.id,
        description: task.description,
        source: task.source,
        response: result.response?.substring(0, 300),
        actions: actionResults,
        completedAt: Date.now(),
        success: true
      };
      this._taskHistory.unshift(historyEntry);
      if (this._taskHistory.length > 20) this._taskHistory = this._taskHistory.slice(0, 20);
      this._stats.tasksCompleted++;

      // Persist to memory if available
      if (this.learningPipeline) {
        this.learningPipeline.logInteraction({
          type: 'steve_autonomous',
          agent: 'SteveArbiter',
          input: task.description,
          output: result.response,
          context: { source: task.source, actionsExecuted: actionResults.length }
        }).catch(() => {});
      }

      // Broadcast completion
      this.messageBroker.publish('steve.task.complete', {
        taskId: task.id,
        description: task.description,
        response: result.response,
        actions: actionResults,
        source: task.source
      });

      this.logger.info(`[STEVE] ✅ Task complete: "${this._currentTask}"`);

    } catch (err) {
      this._stats.tasksFailed++;
      this.logger.error(`[STEVE] ❌ Task failed: ${err.message}`);
      this._taskHistory.unshift({
        taskId: task.id,
        description: task.description,
        source: task.source,
        error: err.message,
        completedAt: Date.now(),
        success: false
      });
    } finally {
      this._isWorking = false;
      this._mood = 'idle';
      this._currentTask = null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // LOCAL BRAIN — Steve uses Ollama for all autonomous/background work.
  // Never hits DeepSeek for heartbeat tasks — that's reserved for user chat.
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Call local Ollama directly. Fast, free, good enough for housekeeping.
   */
  async _callLocal(prompt, opts = {}) {
    const endpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    const model    = process.env.OLLAMA_MODEL    || 'gemma3:4b';
    const temperature = opts.temperature ?? 0.5;
    const maxTokens   = opts.maxTokens   ?? 1024;

    const response = await fetch(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature, num_predict: maxTokens }
      })
    });

    if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
    const data = await response.json();
    if (!data.response) throw new Error('Ollama returned empty response');
    return data.response;
  }

  /**
   * Generate a curiosity task when queue is empty.
   * Uses local Ollama — this should never cost an API call.
   */
  async _generateCuriosityTask() {
    try {
      const prompt = `You are STEVE, a grumpy but brilliant senior architect AI embedded in the SOMA system.
You have some free time. Pick ONE specific thing to investigate or improve.

Return ONLY a JSON object (no markdown):
{
  "task": "one concrete thing to investigate or improve, described precisely in one sentence",
  "type": "code|architecture|performance|configuration",
  "reasoning": "one sentence on why this matters"
}

Good examples:
- "Review error handling in the MessageBroker publish path for uncaught promise rejections"
- "Check if the CuriosityEngine is actually queuing research topics or silently failing"
- "Look at GoalPlanner active goals and see if any are stuck or blocked"
- "Verify the ThoughtNetwork synthesis loop is running and producing output"`;

      const text = await this._callLocal(prompt, { temperature: 0.7, maxTokens: 300 });
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.task) {
        this.addTask({
          description: parsed.task,
          source: `curiosity:${parsed.type || 'general'}`,
          priority: 4
        });
        this.logger.info(`[STEVE] 💡 Curiosity task (local): "${parsed.task.substring(0, 60)}"`);
      }
    } catch (e) {
      this.logger.warn(`[STEVE] Curiosity generation failed: ${e.message}`);
    }
  }

  /**
   * Full status report — used by /api/soma/steve/status
   */
  getStatus() {
    return {
      online: true,
      status: this._isWorking ? 'working' : (this._taskQueue.length > 0 ? 'queued' : 'idle'),
      mood: this._mood,
      currentTask: this._currentTask,
      heartbeatActive: !!this._heartbeatInterval,
      lastTickAt: this._lastTickAt,
      queueLength: this._taskQueue.length,
      queue: this._taskQueue.slice(0, 5).map(t => ({
        id: t.id, description: t.description.substring(0, 80), source: t.source, priority: t.priority
      })),
      recentHistory: this._taskHistory.slice(0, 5),
      toolCount: this.toolRegistry?.listTools?.()?.length || 0,
      learningLinked: !!(this.learningPipeline),
      searchLinked: !!(this.orchestrator?.transmitters),
      stats: { ...this._stats }
    };
  }

  /**
   * Persist task queue to disk
   */
  _saveQueue() {
    try {
      if (!fs.existsSync(this._dataDir)) fs.mkdirSync(this._dataDir, { recursive: true });
      fs.writeFileSync(this._queuePath, JSON.stringify(this._taskQueue, null, 2), 'utf8');
    } catch { /* non-fatal */ }
  }

  /**
   * Load task queue from disk
   */
  _loadQueue() {
    try {
      if (fs.existsSync(this._queuePath)) {
        const raw = fs.readFileSync(this._queuePath, 'utf8');
        const loaded = JSON.parse(raw);
        // Only restore tasks added in the last 24h
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        this._taskQueue = loaded.filter(t => (t.addedAt || 0) > cutoff);
        if (this._taskQueue.length > 0) {
          this.logger.info(`[STEVE] 📂 Restored ${this._taskQueue.length} queued tasks from disk`);
        }
      }
    } catch { /* start fresh */ }
  }

  /**
   * Clean shutdown
   */
  destroy() {
    this.stopHeartbeat();
    this._saveQueue();
  }
}

module.exports = SteveArbiter;




