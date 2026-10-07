import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.cjs';
import fs from 'fs/promises';
import path from 'path';

/**
 * PulseArbiter - Cognitive Orchestrator for Pulse IDE
 * 
 * Acts as the intelligent coordinator between Pulse IDE and SOMA's arbiter ecosystem.
 * Routes tasks to specialized arbiters based on context and capability matching.
 * 
 * Key Responsibilities:
 * - Route code generation to CodingArbiter/EngineeringSwarmArbiter
 * - Coordinate multi-arbiter workflows
 * - Manage Steve's arbiter interactions
 * - Handle file operations via FileSystemArbiter
 * - Persist workspace state via ContextManagerArbiter
 * - Execute terminal commands via ComputerControlArbiter
 * - Provide vision analysis via VisionProcessingArbiter
 */
export class PulseArbiter extends BaseArbiterV4 {
  constructor(opts = {}) {
    super({
      ...opts,
      name: opts.name || 'PulseArbiter',
      role: ArbiterRole.ORCHESTRATOR,
      capabilities: [
        ArbiterCapability.COORDINATE_ASI,
        ArbiterCapability.READ_FILES,
        ArbiterCapability.WRITE_FILES,
        ArbiterCapability.EXECUTE_CODE,
        ArbiterCapability.MEMORY_ACCESS
      ]
    });

    // Store references to key arbiters
    this.arbiters = {
      quadBrain: opts.quadBrain || null,
      steve: opts.steveArbiter || null,
      coding: opts.codingArbiter || null,
      engineeringSwarm: opts.engineeringSwarmArbiter || null,
      fileSystem: opts.fileSystemArbiter || null,
      contextManager: opts.contextManagerArbiter || null,
      computerControl: opts.computerControlArbiter || null,
      vision: opts.visionArbiter || null,
      codeObserver: opts.codeObservationArbiter || null,
      reasoningChamber: opts.reasoningChamber || null,
      adaptiveRouter: opts.adaptiveLearningRouter || null
    };
    this.goalPlanner = opts.goalPlanner || null;

    // Active workspace sessions
    this.workspaces = new Map();

    // Task routing metrics
    this.metrics = {
      tasksRouted: 0,
      steveInteractions: 0,
      blueprintsGenerated: 0,
      filesModified: 0,
      commandsExecuted: 0,
      multiArbiterWorkflows: 0
    };

    // Capability mapping for intelligent routing
    this.capabilityMap = {
      code_generation: ['coding', 'engineeringSwarm', 'steve'],
      code_modification: ['engineeringSwarm', 'codeObserver', 'coding'],
      code_analysis: ['codeObserver', 'reasoningChamber'],
      architectural_design: ['reasoningChamber', 'engineeringSwarm'],
      file_operations: ['fileSystem'],
      terminal_execution: ['computerControl'],
      vision_analysis: ['vision'],
      conversation: ['steve', 'quadBrain'],
      reasoning: ['reasoningChamber', 'quadBrain']
    };
  }

  async onInitialize() {
    this.auditLogger.info('🎨 Pulse Arbiter initialized - Ready to orchestrate IDE intelligence');

    // Register this arbiter
    messageBroker.registerArbiter(this.name, {
      role: this.role,
      capabilities: this.capabilities,
      instance: this,
      lobe: 'COGNITIVE',
      classification: 'ORCHESTRATOR',
      tags: ['ide', 'workflow', 'coordination']
    });
    
    return true;
  }

  async onTerminate() {
    // Save all workspace states before terminating
    for (const [wsId, workspace] of this.workspaces) {
      await this.saveWorkspaceState(wsId, workspace);
    }
    this.auditLogger.info('Pulse Arbiter terminated - All workspaces saved');
  }

  async handleMessage(message = {}) {
    try {
      const { type, payload } = message;

      switch (type) {
        case 'dispatch_task':
          return await this.dispatchTask(payload);

        case 'steve_assist':
          return await this.handleSteveAssist(payload);

        case 'generate_blueprint':
          return await this.generateBlueprint(payload);

        case 'modify_code':
          return await this.modifyCode(payload);

        case 'analyze_code':
          return await this.analyzeCode(payload);

        case 'file_operation':
          return await this.handleFileOperation(payload);

        case 'execute_command':
          return await this.executeCommand(payload);

        case 'execute_command_routed':
          return await this.executeCommandWithRouting(payload);

        case 'preview_command':
          return await this.previewCommand(payload);

        case 'generate_command':
          return await this.generateCommandFromIntent(payload);

        case 'vision_analyze':
          return await this.analyzeVision(payload);

        case 'analyze_preview':
          return await this.analyzePreview(payload);

        case 'analyze_element':
          return await this.analyzeElement(payload);

        case 'generate_plan':
          return await this.generatePlan(payload);

        case 'workspace_create':
          return await this.createWorkspace(payload);

        case 'workspace_load':
          return await this.loadWorkspace(payload);

        case 'workspace_save':
          return await this.saveWorkspace(payload);

        case 'search_files':
          return await this.searchFiles(payload);

        case 'suggest_files':
          return await this.suggestFiles(payload);

        case 'refactor_files':
          return await this.refactorMultipleFiles(payload);

        case 'query_capabilities':
          return this.getAvailableCapabilities();

        case 'list_skills':
          return await this.listSkills();

        case 'create_skill':
          return await this.createSkill(payload?.prompt);

        case 'status_check':
          return { success: true, status: this.getStatus() };

        default:
          return { success: false, error: `Unsupported Pulse message type: ${type || 'missing'}` };
      }
    } catch (err) {
      this.auditLogger.error(`handleMessage error: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Intelligent task dispatcher - routes to best arbiter(s) based on task type
   */
  async dispatchTask(payload) {
    const { taskType, taskData, context = {} } = payload;
    this.metrics.tasksRouted++;

    this.auditLogger.info(`📋 Dispatching task: ${taskType}`, { context });

    // Get candidate arbiters for this task type
    const candidates = this.capabilityMap[taskType] || [];

    if (candidates.length === 0) {
      return {
        success: false,
        error: `No arbiter available for task type: ${taskType}`
      };
    }

    // Use AdaptiveLearningRouter if available for intelligent routing
    if (this.arbiters.adaptiveRouter && taskData.query) {
      try {
        const routingDecision = await this.arbiters.adaptiveRouter.route({
          query: taskData.query,
          context,
          availableArbiters: candidates
        });

        if (routingDecision.arbiter) {
          return await this.executeOnArbiter(routingDecision.arbiter, taskData, context);
        }
      } catch (err) {
        this.auditLogger.warn(`Adaptive routing failed, using fallback: ${err.message}`);
      }
    }

    // Fallback: Use first available arbiter
    const arbiterName = candidates[0];
    return await this.executeOnArbiter(arbiterName, taskData, context);
  }

  /**
   * Execute task on specific arbiter
   */
  async executeOnArbiter(arbiterName, taskData, context = {}) {
    const arbiter = this.arbiters[arbiterName];

    if (!arbiter) {
      return {
        success: false,
        error: `Arbiter not available: ${arbiterName}`,
        arbiterName
      };
    }

    try {
      // Send message via MessageBroker for proper routing
      const result = await messageBroker.sendMessage({
        from: this.name,
        to: arbiter.name || arbiterName,
        type: 'task_request',
        payload: { taskData, context }
      });

      return {
        success: true,
        result,
        arbiterUsed: arbiterName,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      this.auditLogger.error(`Failed to execute on ${arbiterName}: ${err.message}`);
      return {
        success: false,
        error: err.message,
        arbiterName
      };
    }
  }

  /**
   * Handle Steve assistance requests - route through SteveArbiter with FULL capabilities
   * Uses Steve's RAG, personality engine, tool creation, and multi-arbiter coordination
   */
  async handleSteveAssist(payload) {
    this.metrics.steveInteractions++;
    const { message, history = [], context = {} } = payload;

    this.auditLogger.info(`🤖 Steve assist request: ${message.substring(0, 50)}...`);

    // Route to SteveArbiter if available - USE FULL STEVE POWER!
    if (this.arbiters.steve) {
      try {
        // Build enhanced context with Pulse-specific info
        const steveContext = {
          ...context,
          source: 'pulse_ide',
          conversationHistory: history,
          timestamp: new Date().toISOString()
        };

        // Call Steve's processChat directly for full feature access
        // This uses: RAG search, personality engine, tool creation, learning pipeline
        const steveResult = await this.arbiters.steve.processChat(message, steveContext);

        // SteveArbiter.processChat returns { response, actions, updatedFiles }
        const responseText = steveResult.response || steveResult;

        // Check if Steve used any tools or created new ones
        const toolsUsed = steveResult.toolsUsed || [];
        const arbitersConsulted = ['SteveArbiter'];

        // Parse Steve's response for tool creation/usage markers
        if (typeof responseText === 'string' && (responseText.includes('[TOOL_CREATED]') || responseText.includes('[TOOL_EXECUTED]'))) {
          toolsUsed.push('Dynamic Tool System');
          arbitersConsulted.push('ToolCreatorArbiter');
        }

        // Check if Steve consulted other arbiters (RAG indicates memory search)
        if (this.arbiters.steve.orchestrator) {
          // Steve has access to the full swarm via orchestrator
          arbitersConsulted.push('MnemonicArbiter (RAG)');
        }

        // Use updatedFiles from Steve if provided, otherwise try to extract from response
        const updatedFiles = steveResult.updatedFiles || this.extractCodeFromResponse(responseText, context);

        // Use actions from Steve if provided, otherwise try to extract from response
        const actions = steveResult.actions || this.extractActionsFromResponse(responseText);

        return {
          success: true,
          response: responseText,
          actions,
          updatedFiles,
          toolsUsed,
          arbitersConsulted,
          personality: 'Steve (Cranky Senior Architect)',
          features: {
            rag: true,
            toolCreation: true,
            personalityEngine: true,
            learningPipeline: true
          },
          timestamp: new Date().toISOString()
        };
      } catch (err) {
        this.auditLogger.warn(`SteveArbiter error, trying QuadBrain: ${err.message}`);
        // Don't fail completely, fall through to QuadBrain
      }
    }

    // Fallback to QuadBrain (less capable but still functional)
    if (this.arbiters.quadBrain) {
      try {
        this.auditLogger.info('Using QuadBrain fallback for Steve request');
        const response = await this.arbiters.quadBrain.processQuery({
          query: message,
          context: { ...context, source: 'pulse_steve', history },
          options: { stream: false }
        });

        return {
          success: true,
          response: response.text || response.response,
          arbitersConsulted: ['QuadBrain (Fallback)'],
          features: {
            rag: false,
            toolCreation: false,
            personalityEngine: false,
            learningPipeline: false
          },
          timestamp: new Date().toISOString()
        };
      } catch (err) {
        return {
          success: false,
          error: `Failed to process Steve request: ${err.message}`
        };
      }
    }

    return {
      success: false,
      error: 'Neither SteveArbiter nor QuadBrain available'
    };
  }

  /**
   * Extract code blocks from Steve's response for file updates
   */
  extractCodeFromResponse(response, context) {
    const files = [];

    // Match code blocks with optional filename hints
    // Matches: ```language filename\ncode``` or ```language\ncode```
    const codeBlockRegex = /```(\w+)(?:\s+([\w./\-]+))?\n([\s\S]*?)```/g;
    let match;

    while ((match = codeBlockRegex.exec(response)) !== null) {
      const language = match[1];
      const filename = match[2] || `steve_suggestion_${Date.now()}.${this.getExtensionForLanguage(language)}`;
      const content = match[3];

      files.push({
        path: filename,
        content: content.trim(),
        language
      });
    }

    return files;
  }

  /**
   * Extract action commands from Steve's response
   */
  extractActionsFromResponse(response) {
    const actions = [];

    // Look for command suggestions in Steve's response
    const commandRegex = /(?:run|execute|try):\s*`([^`]+)`/gi;
    let match;

    while ((match = commandRegex.exec(response)) !== null) {
      actions.push(match[1]);
    }

    return actions;
  }

  /**
   * Get file extension for language
   */
  getExtensionForLanguage(language) {
    const extensions = {
      javascript: 'js',
      typescript: 'ts',
      python: 'py',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      go: 'go',
      rust: 'rs',
      html: 'html',
      css: 'css',
      json: 'json',
      yaml: 'yaml',
      markdown: 'md'
    };
    return extensions[language.toLowerCase()] || 'txt';
  }

  /**
   * Create a tool via Steve (exposes Steve's dynamic tool creation)
   */
  async createToolViaSteve(description, context = {}) {
    if (!this.arbiters.steve) {
      return {
        success: false,
        error: 'SteveArbiter not available'
      };
    }

    try {
      this.auditLogger.info(`🔧 Steve creating tool: ${description}`);
      const result = await this.arbiters.steve.createToolFromDescription(description, context);

      return {
        success: result.success,
        toolName: result.toolName,
        message: result.message,
        error: result.error,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      this.auditLogger.error(`Tool creation failed: ${err.message}`);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * List Steve's registered tools
   */
  listSteveTools(category = null) {
    if (!this.arbiters.steve) {
      return { success: false, error: 'SteveArbiter not available' };
    }

    try {
      const tools = this.arbiters.steve.listTools(category);
      const stats = this.arbiters.steve.getToolStats();

      return {
        success: true,
        tools,
        stats,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Execute a Steve tool
   */
  async executeSteveTool(toolName, parameters, context = {}) {
    if (!this.arbiters.steve) {
      return {
        success: false,
        error: 'SteveArbiter not available'
      };
    }

    try {
      this.auditLogger.info(`⚡ Executing Steve tool: ${toolName}`);
      const result = await this.arbiters.steve.executeTool(toolName, parameters, context);

      return {
        success: result.success,
        result: result.result,
        metadata: result.metadata,
        error: result.error,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      this.auditLogger.error(`Tool execution failed: ${err.message}`);
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Generate blueprint using multi-arbiter coordination
   */
  async generateBlueprint(payload) {
    this.metrics.blueprintsGenerated++;
    this.metrics.multiArbiterWorkflows++;

    const { intent, existingFiles = [], projectContext = {} } = payload;

    this.auditLogger.info(`🎨 Blueprint generation: ${intent}`);

    const workflow = {
      intent,
      startTime: Date.now(),
      steps: []
    };

    try {
      // Step 1: Use ReasoningChamber for architectural planning
      if (this.arbiters.reasoningChamber) {
        workflow.steps.push({ arbiter: 'ReasoningChamber', action: 'architectural_planning' });
        const architecture = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.reasoningChamber.name,
          type: 'analyze',
          payload: { query: `Design architecture for: ${intent}`, context: projectContext }
        });
        workflow.architecture = architecture;
      }

      // Step 2: Use CodeObservationArbiter to analyze existing code (if any)
      if (existingFiles.length > 0 && this.arbiters.codeObserver) {
        workflow.steps.push({ arbiter: 'CodeObservationArbiter', action: 'analyze_existing' });
        const codeAnalysis = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.codeObserver.name,
          type: 'analyze_files',
          payload: { files: existingFiles }
        });
        workflow.codeAnalysis = codeAnalysis;
      }

      // Step 3: Use EngineeringSwarmArbiter or CodingArbiter for code generation
      const codeArbiter = this.arbiters.engineeringSwarm || this.arbiters.coding;
      if (codeArbiter) {
        workflow.steps.push({
          arbiter: codeArbiter.name || 'CodingArbiter',
          action: 'generate_code'
        });

        const generatedCode = await messageBroker.sendMessage({
          from: this.name,
          to: codeArbiter.name,
          type: 'generate',
          payload: {
            intent,
            architecture: workflow.architecture,
            existingCode: workflow.codeAnalysis,
            context: projectContext
          }
        });

        workflow.generatedCode = generatedCode;
      }

      // Step 4: Use SteveArbiter for tool/utility generation if needed
      if (this.arbiters.steve) {
        workflow.steps.push({ arbiter: 'SteveArbiter', action: 'generate_utilities' });
        const utilities = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.steve.name,
          type: 'generate_tools',
          payload: { intent, blueprint: workflow.generatedCode }
        });
        workflow.utilities = utilities;
      }

      workflow.endTime = Date.now();
      workflow.duration = workflow.endTime - workflow.startTime;

      return {
        success: true,
        blueprint: workflow.generatedCode?.files || workflow.generatedCode || [],
        explanation: workflow.architecture?.explanation || 'Blueprint generated successfully',
        workflow,
        arbitersUsed: workflow.steps.map(s => s.arbiter),
        timestamp: new Date().toISOString()
      };

    } catch (err) {
      this.auditLogger.error(`Blueprint generation failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
        workflow
      };
    }
  }

  /**
   * Modify code using EngineeringSwarmArbiter
   */
  async modifyCode(payload) {
    this.metrics.filesModified++;
    const { filepath, request, context = {} } = payload;

    if (!this.arbiters.engineeringSwarm) {
      return {
        success: false,
        error: 'EngineeringSwarmArbiter not available'
      };
    }

    try {
      const result = await this.arbiters.engineeringSwarm.modifyCode(filepath, request);

      return {
        success: true,
        result,
        arbiterUsed: 'EngineeringSwarmArbiter',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Analyze code using CodeObservationArbiter
   */
  async analyzeCode(payload) {
    const { code, filepath, analysisType = 'full' } = payload;

    if (!this.arbiters.codeObserver) {
      return {
        success: false,
        error: 'CodeObservationArbiter not available'
      };
    }

    try {
      const result = await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.codeObserver.name,
        type: 'analyze',
        payload: { code, filepath, analysisType }
      });

      return {
        success: true,
        analysis: result,
        arbiterUsed: 'CodeObservationArbiter',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Generate execution plan using ReasoningChamber
   */
  async generatePlan(payload) {
    const { goal, context = {} } = payload;

    this.auditLogger.info(`📋 Generating execution plan for: ${goal}`);

    const workflow = {
      goal,
      startTime: Date.now(),
      steps: [],
      planId: `plan-${Date.now()}`
    };

    try {
      // Step 1: Use ReasoningChamber for task breakdown
      if (this.arbiters.reasoningChamber) {
        workflow.steps.push({ arbiter: 'ReasoningChamber', action: 'task_decomposition', timestamp: Date.now() });

        const reasoning = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.reasoningChamber.name,
          type: 'decompose_task',
          payload: {
            goal,
            context,
            requestBreakdown: true,
            includeEstimates: true,
            includeDependencies: true
          }
        });

        workflow.reasoning = reasoning;
      }

      // Step 2: Use AdaptiveLearningRouter for intelligent step prioritization
      if (this.arbiters.adaptiveRouter && workflow.reasoning?.steps) {
        workflow.steps.push({ arbiter: 'AdaptiveLearningRouter', action: 'prioritize_steps', timestamp: Date.now() });

        const prioritized = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.adaptiveRouter.name,
          type: 'prioritize',
          payload: {
            steps: workflow.reasoning.steps,
            context
          }
        });

        workflow.prioritized = prioritized;
      }

      // Step 3: Use CodeObservationArbiter to analyze current state if relevant
      if (this.arbiters.codeObserver && context.cwd) {
        workflow.steps.push({ arbiter: 'CodeObservationArbiter', action: 'analyze_context', timestamp: Date.now() });

        const contextAnalysis = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.codeObserver.name,
          type: 'analyze_workspace',
          payload: { cwd: context.cwd }
        });

        workflow.contextAnalysis = contextAnalysis;
      }

      workflow.endTime = Date.now();
      workflow.duration = workflow.endTime - workflow.startTime;

      // Compile final plan
      const planSteps = (workflow.prioritized?.steps || workflow.reasoning?.steps || []).map((step, idx) => ({
        id: `step-${idx + 1}`,
        title: step.title || step.name || `Step ${idx + 1}`,
        description: step.description || step.details || '',
        estimate: step.estimate || step.duration || 'Unknown',
        complexity: step.complexity || 'medium',
        dependencies: step.dependencies || [],
        arbiterSuggestion: step.suggestedArbiter || this.suggestArbiterForStep(step),
        completed: false
      }));

      const plan = {
        planId: workflow.planId,
        success: true,
        goal,
        summary: workflow.reasoning?.summary || `Execution plan for: ${goal}`,
        steps: planSteps,
        totalEstimate: this.calculateTotalEstimate(planSteps),
        reasoning: workflow.reasoning?.reasoning || workflow.reasoning?.explanation,
        arbitersUsed: workflow.steps.map(s => s.arbiter),
        workflow,
        context,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'active'
      };

      // Save plan to ContextManagerArbiter for persistence
      await this.savePlanToContext(plan);

      // Send to learning pipeline for future improvement
      await this.sendPlanToLearning(plan);

      return plan;

    } catch (err) {
      this.auditLogger.error(`Plan generation failed: ${err.message}`);
      return {
        success: false,
        error: err.message,
        workflow
      };
    }
  }

  /**
   * List available skills in the Pulse Worker ecosystem
   */
  async listSkills() {
    try {
      const directivesDir = path.join(process.cwd(), 'server', 'pulse-workers', 'directives');

      // Ensure directory exists
      try {
        await fs.access(directivesDir);
      } catch {
        return { success: true, skills: [] };
      }

      const files = await fs.readdir(directivesDir);
      const skills = [];

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const content = await fs.readFile(path.join(directivesDir, file), 'utf8');
        const nameMatch = content.match(/#\s*(.+)/); // First header
        const descMatch = content.match(/Description:\s*(.+)/i) || content.match(/\n(.+)/); // Description tag or second line

        // check for matching script
        const scriptName = file.replace('.md', '.py');
        const scriptPath = path.join(process.cwd(), 'server', 'pulse-workers', 'execution', scriptName);
        let hasScript = false;
        try {
          await fs.access(scriptPath);
          hasScript = true;
        } catch {
          // try checking for folder-based scripts if common pattern
        }

        skills.push({
          id: file.replace('.md', ''),
          name: nameMatch ? nameMatch[1].trim() : file.replace('.md', ''),
          description: descMatch ? descMatch[1].trim() : 'No description available',
          hasDirective: true,
          hasScript: hasScript
        });
      }

      return {
        success: true,
        skills
      };
    } catch (err) {
      this.auditLogger.error(`Failed to list skills: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Create a new skill using the skill-creator worker
   */
  async createSkill(prompt) {
    try {
      const requestedSkill = String(prompt || '').trim();
      if (!requestedSkill) return { success: false, error: 'A non-empty skill description is required' };
      if (!this.goalPlanner?.createGoal) {
        return { success: false, error: 'GoalPlanner is unavailable; no skill was created or queued' };
      }

      this.auditLogger.info(`🛠️ Queueing evidence-backed skill creation: ${requestedSkill}`);
      const admitted = await this.goalPlanner.createGoal({
        title: `Create SOMA skill: ${requestedSkill}`.slice(0, 160),
        description: `Implement and verify a reusable SOMA Pulse worker skill for: ${requestedSkill}`,
        category: 'engineering',
        type: 'skill_creation',
        priority: 90,
        successCriteria: [
          'Create a directive under server/pulse-workers/directives',
          'Create a matching executable implementation under server/pulse-workers/execution',
          'Run syntax and behavior tests for the new skill',
          'Produce an evidence receipt naming the created files and test results'
        ],
        metadata: {
          source: 'pulse_skill_creator',
          userDirected: true,
          requestedSkill,
          allowedTools: ['read_file', 'list_files', 'search_code', 'write_file', 'run_tests', 'verify_syntax', 'save_progress'],
          allowedMutationPaths: ['server/pulse-workers/directives', 'server/pulse-workers/execution', 'tests']
        }
      }, 'user');
      const goalId = admitted?.goalId || admitted?.existingGoalId || admitted?.goal?.id || null;
      if (!goalId) {
        return { success: false, status: 'rejected', error: admitted?.error || 'Skill goal admission failed' };
      }
      return {
        success: true,
        status: 'queued',
        goalId,
        duplicate: Boolean(admitted?.existingGoalId),
        message: `Skill creation queued as goal ${goalId}; completion requires files plus passing verification evidence.`
      };

    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Suggest best arbiter for a plan step
   */
  suggestArbiterForStep(step) {
    const stepText = (step.title + ' ' + step.description).toLowerCase();

    if (stepText.includes('code') || stepText.includes('implement')) return 'EngineeringSwarmArbiter';
    if (stepText.includes('file') || stepText.includes('create')) return 'FileSystemArbiter';
    if (stepText.includes('analyze') || stepText.includes('review')) return 'CodeObservationArbiter';
    if (stepText.includes('test') || stepText.includes('debug')) return 'CodingArbiter';
    if (stepText.includes('design') || stepText.includes('architect')) return 'ReasoningChamber';
    if (stepText.includes('command') || stepText.includes('execute')) return 'ComputerControlArbiter';

    return 'PulseArbiter';
  }

  /**
   * Save plan to ContextManagerArbiter for persistence
   */
  async savePlanToContext(plan) {
    if (!this.arbiters.contextManager) return;

    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.contextManager.name,
        type: 'save_plan',
        payload: {
          planId: plan.planId,
          plan,
          workspace: plan.context.cwd || 'default'
        }
      });
      this.auditLogger.info(`💾 Plan ${plan.planId} saved to ContextManager`);
    } catch (err) {
      this.auditLogger.warn(`Failed to save plan: ${err.message}`);
    }
  }

  /**
   * Send plan to learning pipeline for analysis and improvement
   */
  async sendPlanToLearning(plan) {
    try {
      await messageBroker.publish('learning/plan_created', {
        planId: plan.planId,
        goal: plan.goal,
        steps: plan.steps,
        arbitersUsed: plan.arbitersUsed,
        complexity: this.calculatePlanComplexity(plan),
        context: plan.context,
        timestamp: plan.createdAt
      });
      this.auditLogger.info(`🧠 Plan sent to UniversalLearningPipeline`);
    } catch (err) {
      this.auditLogger.warn(`Failed to send plan to learning: ${err.message}`);
    }
  }

  /**
   * Update plan with actual execution results for learning
   */
  async updatePlanWithResults(planId, results) {
    try {
      const plan = await this.loadPlanFromContext(planId);
      if (!plan) return;

      plan.results = results;
      plan.actualDuration = results.duration;
      plan.completedAt = new Date().toISOString();
      plan.status = results.success ? 'completed' : 'failed';
      plan.updatedAt = new Date().toISOString();

      // Save updated plan
      await this.savePlanToContext(plan);

      // Send completion data to learning pipeline
      await messageBroker.publish('learning/plan_completed', {
        planId,
        goal: plan.goal,
        estimatedDuration: plan.totalEstimate,
        actualDuration: results.duration,
        accuracyScore: this.calculateAccuracyScore(plan, results),
        stepsCompleted: results.stepsCompleted || 0,
        totalSteps: plan.steps.length,
        arbitersUsed: plan.arbitersUsed,
        context: plan.context,
        success: results.success
      });

      this.auditLogger.info(`📊 Plan ${planId} completion sent to learning pipeline`);
    } catch (err) {
      this.auditLogger.error(`Failed to update plan results: ${err.message}`);
    }
  }

  /**
   * Load plan from ContextManagerArbiter
   */
  async loadPlanFromContext(planId) {
    if (!this.arbiters.contextManager) return null;

    try {
      const response = await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.contextManager.name,
        type: 'load_plan',
        payload: { planId }
      });
      return response?.plan || null;
    } catch (err) {
      this.auditLogger.warn(`Failed to load plan ${planId}: ${err.message}`);
      return null;
    }
  }

  /**
   * Get plan history from ContextManagerArbiter
   */
  async getPlanHistory(workspace = 'default', limit = 20) {
    if (!this.arbiters.contextManager) {
      return { success: false, error: 'ContextManagerArbiter not available' };
    }

    try {
      const response = await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.contextManager.name,
        type: 'get_plan_history',
        payload: { workspace, limit }
      });

      return {
        success: true,
        plans: response?.plans || [],
        workspace
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Calculate plan complexity for learning
   */
  calculatePlanComplexity(plan) {
    const complexityScores = { low: 1, medium: 2, high: 3 };
    const avgComplexity = plan.steps.reduce((sum, step) =>
      sum + (complexityScores[step.complexity] || 2), 0
    ) / plan.steps.length;

    return {
      average: avgComplexity,
      totalSteps: plan.steps.length,
      arbitersInvolved: plan.arbitersUsed.length,
      hasDependencies: plan.steps.some(s => s.dependencies?.length > 0)
    };
  }

  /**
   * Calculate accuracy score comparing estimated vs actual
   */
  calculateAccuracyScore(plan, results) {
    if (!results.duration || !plan.totalEstimate) return null;

    // Convert estimates to minutes for comparison
    const estimatedMinutes = this.estimateToMinutes(plan.totalEstimate);
    const actualMinutes = results.duration / 60000; // ms to minutes

    if (estimatedMinutes === 0) return null;

    const ratio = actualMinutes / estimatedMinutes;
    // Score 100 for perfect, decreasing as ratio diverges from 1.0
    return Math.max(0, 100 - Math.abs(ratio - 1.0) * 50);
  }

  /**
   * Convert estimate string to minutes
   */
  estimateToMinutes(estimate) {
    const match = estimate.match(/(\d+)\s*(min|hour|day)/i);
    if (!match) return 0;

    const value = parseInt(match[1]);
    const unit = match[2].toLowerCase();

    if (unit.startsWith('min')) return value;
    if (unit.startsWith('hour')) return value * 60;
    if (unit.startsWith('day')) return value * 60 * 8;
    return 0;
  }

  /**
   * Calculate total time estimate from steps
   */
  calculateTotalEstimate(steps) {
    let totalMinutes = 0;

    for (const step of steps) {
      const estimate = step.estimate || '';
      const match = estimate.match(/(\d+)\s*(min|hour|day)/i);

      if (match) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        if (unit.startsWith('min')) totalMinutes += value;
        else if (unit.startsWith('hour')) totalMinutes += value * 60;
        else if (unit.startsWith('day')) totalMinutes += value * 60 * 8; // 8-hour workday
      }
    }

    if (totalMinutes === 0) return 'Unknown';
    if (totalMinutes < 60) return `${totalMinutes} minutes`;
    if (totalMinutes < 480) return `${Math.round(totalMinutes / 60)} hours`;
    return `${Math.round(totalMinutes / 480)} days`;
  }

  /**
   * Handle file operations via FileSystemArbiter
   */
  async handleFileOperation(payload) {
    const { operation, filepath, content, context = {} } = payload;

    if (!this.arbiters.fileSystem) {
      return {
        success: false,
        error: 'FileSystemArbiter not available'
      };
    }

    try {
      const result = await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.fileSystem.name,
        type: operation,
        payload: { filepath, content, context }
      });

      return {
        success: true,
        result,
        arbiterUsed: 'FileSystemArbiter',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Execute terminal command via ComputerControlArbiter
   */
  async executeCommand(payload) {
    this.metrics.commandsExecuted++;
    const { command, cwd, context = {} } = payload;

    if (!this.arbiters.computerControl) {
      return {
        success: false,
        error: 'ComputerControlArbiter not available'
      };
    }

    try {
      const result = await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.computerControl.name,
        type: 'execute',
        payload: { command, cwd, context }
      });

      return {
        success: true,
        result,
        arbiterUsed: 'ComputerControlArbiter',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Preview command before execution with explanation and safety analysis
   */
  async previewCommand(payload) {
    const { command, cwd, context = {} } = payload;

    try {
      let preview = {
        command,
        explanation: '',
        safetyLevel: 'safe',
        risks: [],
        requiresConfirmation: false,
        suggestedAlternatives: []
      };

      // Use AdaptiveLearningRouter for command analysis
      if (this.arbiters.adaptiveRouter) {
        const analysis = await this.arbiters.adaptiveRouter.route({
          query: `Analyze this command for safety and explain what it does: ${command}`,
          context: { cwd, command },
          availableArbiters: ['computerControl', 'reasoningChamber']
        });

        if (analysis.explanation) {
          preview.explanation = analysis.explanation;
        }
      }

      // Use ComputerControlArbiter for safety check
      if (this.arbiters.computerControl) {
        const safetyCheck = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.computerControl.name,
          type: 'check_safety',
          payload: { command, cwd }
        });

        if (safetyCheck) {
          preview.safetyLevel = safetyCheck.level || 'safe';
          preview.risks = safetyCheck.risks || [];
          preview.requiresConfirmation = safetyCheck.level === 'dangerous' || safetyCheck.level === 'destructive';
          preview.suggestedAlternatives = safetyCheck.alternatives || [];
        }
      }

      return {
        success: true,
        preview,
        arbiterUsed: ['AdaptiveLearningRouter', 'ComputerControlArbiter'],
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Generate command from natural language intent
   */
  async generateCommandFromIntent(payload) {
    const { intent, cwd, context = {} } = payload;

    try {
      // Use QueryComplexityClassifier to determine approach
      let complexity = 'simple';

      if (this.arbiters.queryComplexity) {
        const classification = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.queryComplexity.name,
          type: 'classify',
          payload: { query: intent, context: { cwd } }
        });

        complexity = classification?.complexity || 'simple';
      }

      let generatedCommand = null;

      // Simple intent: Use AdaptiveLearningRouter for direct command generation
      if (complexity === 'simple' && this.arbiters.adaptiveRouter) {
        const result = await this.arbiters.adaptiveRouter.route({
          query: `Generate a terminal command for: ${intent}`,
          context: { cwd, platform: process.platform },
          availableArbiters: ['computerControl']
        });

        generatedCommand = result.command || result.suggestion;
      }

      // Complex intent: Use ReasoningChamber + EngineeringSwarmArbiter
      if (complexity === 'complex' || !generatedCommand) {
        if (this.arbiters.reasoningChamber) {
          const reasoning = await messageBroker.sendMessage({
            from: this.name,
            to: this.arbiters.reasoningChamber.name,
            type: 'reason_about_command',
            payload: { intent, cwd, context }
          });

          generatedCommand = reasoning?.command || reasoning?.recommendation;
        }
      }

      // Fallback: Use ComputerControlArbiter directly
      if (!generatedCommand && this.arbiters.computerControl) {
        const result = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.computerControl.name,
          type: 'intent_to_command',
          payload: { intent, cwd }
        });

        generatedCommand = result?.command;
      }

      if (!generatedCommand) {
        return {
          success: false,
          error: 'Could not generate command from intent'
        };
      }

      // Get preview of generated command
      const preview = await this.previewCommand({
        command: generatedCommand,
        cwd,
        context: { ...context, generatedFrom: intent }
      });

      return {
        success: true,
        command: generatedCommand,
        intent,
        complexity,
        preview: preview.preview,
        arbiterUsed: ['QueryComplexityClassifier', 'AdaptiveLearningRouter', 'ReasoningChamber', 'ComputerControlArbiter'],
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Execute command with adaptive routing based on complexity
   */
  async executeCommandWithRouting(payload) {
    const { command, intent, cwd, context = {} } = payload;

    try {
      // If intent provided, generate command first
      if (intent && !command) {
        const generated = await this.generateCommandFromIntent({ intent, cwd, context });

        if (!generated.success) {
          return generated;
        }

        // Execute the generated command
        return await this.executeCommand({
          command: generated.command,
          cwd,
          context: { ...context, generatedFrom: intent, preview: generated.preview }
        });
      }

      // If command provided, preview it first if risky
      if (command) {
        const preview = await this.previewCommand({ command, cwd, context });

        if (preview.success && preview.preview.requiresConfirmation) {
          // Return preview for user confirmation
          return {
            success: true,
            requiresConfirmation: true,
            preview: preview.preview,
            pendingCommand: { command, cwd, context }
          };
        }

        // Safe to execute
        return await this.executeCommand({ command, cwd, context });
      }

      return {
        success: false,
        error: 'Either command or intent must be provided'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Semantic file search using MnemonicArbiter + FileSystemArbiter
   */
  async searchFiles(payload) {
    const { query, workspaceId, filters = {} } = payload;

    try {
      // Use MnemonicArbiter for semantic search
      let results = [];

      if (this.arbiters.mnemonic) {
        const searchResult = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.mnemonic.name,
          type: 'search',
          payload: {
            query,
            filters: { ...filters, workspace: workspaceId },
            topK: 20
          }
        });

        if (searchResult && searchResult.results) {
          results = searchResult.results;
        }
      }

      // Enhance with FileSystemArbiter metadata if available
      if (this.arbiters.fileSystem && results.length > 0) {
        for (const result of results) {
          try {
            const fileInfo = await messageBroker.sendMessage({
              from: this.name,
              to: this.arbiters.fileSystem.name,
              type: 'get_file_info',
              payload: { filePath: result.path }
            });

            if (fileInfo) {
              result.metadata = { ...result.metadata, ...fileInfo };
            }
          } catch (err) {
            // Continue even if file metadata fails
            this.auditLogger.warn(`Failed to get file info: ${err.message}`);
          }
        }
      }

      return {
        success: true,
        results,
        query,
        arbiterUsed: ['MnemonicArbiter', 'FileSystemArbiter'],
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Intelligent file suggestions based on context using AdaptiveLearningRouter
   */
  async suggestFiles(payload) {
    const { context, currentFile, taskType = 'code_modification', workspaceId } = payload;

    try {
      // Use AdaptiveLearningRouter to analyze context and suggest relevant files
      let suggestions = [];

      if (this.arbiters.adaptiveRouter) {
        const routingResult = await this.arbiters.adaptiveRouter.route({
          query: `Suggest files related to: ${context}`,
          context: { currentFile, taskType, workspaceId },
          availableArbiters: ['mnemonic', 'fileSystem', 'codeObserver']
        });

        suggestions = routingResult.suggestions || [];
      }

      // Fallback: Use MnemonicArbiter for similar files
      if (suggestions.length === 0 && this.arbiters.mnemonic && currentFile) {
        const searchResult = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.mnemonic.name,
          type: 'find_similar',
          payload: {
            reference: currentFile,
            filters: { workspace: workspaceId },
            topK: 10
          }
        });

        if (searchResult && searchResult.results) {
          suggestions = searchResult.results.map(r => ({
            filePath: r.path,
            relevance: r.score,
            reason: r.reason || 'Semantically similar'
          }));
        }
      }

      return {
        success: true,
        suggestions,
        context: { currentFile, taskType },
        arbiterUsed: ['AdaptiveLearningRouter', 'MnemonicArbiter'],
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Multi-file refactoring coordination using EngineeringSwarmArbiter + CodeObservationArbiter
   */
  async refactorMultipleFiles(payload) {
    const { files, refactoringType, instructions, workspaceId } = payload;

    try {
      // First, analyze dependencies with CodeObservationArbiter
      let dependencies = [];

      if (this.arbiters.codeObserver) {
        const analysisResult = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.codeObserver.name,
          type: 'analyze_dependencies',
          payload: { files }
        });

        if (analysisResult) {
          dependencies = analysisResult.dependencies || [];
        }
      }

      // Execute refactoring with EngineeringSwarmArbiter
      let refactoredFiles = [];

      if (this.arbiters.engineeringSwarm) {
        const refactorResult = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.engineeringSwarm.name,
          type: 'refactor',
          payload: {
            files,
            refactoringType,
            instructions,
            dependencies,
            workspaceId
          }
        });

        if (refactorResult && refactorResult.files) {
          refactoredFiles = refactorResult.files;
        }
      }

      // Update files via FileSystemArbiter if available
      if (this.arbiters.fileSystem && refactoredFiles.length > 0) {
        for (const file of refactoredFiles) {
          try {
            await messageBroker.sendMessage({
              from: this.name,
              to: this.arbiters.fileSystem.name,
              type: 'write_file',
              payload: {
                filePath: file.path,
                content: file.content
              }
            });
          } catch (err) {
            this.auditLogger.error(`Failed to write file ${file.path}: ${err.message}`);
          }
        }
      }

      this.metrics.filesModified += refactoredFiles.length;

      return {
        success: true,
        refactoredFiles,
        dependencies,
        filesModified: refactoredFiles.length,
        arbiterUsed: ['CodeObservationArbiter', 'EngineeringSwarmArbiter', 'FileSystemArbiter'],
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Analyze preview HTML/CSS/JS for issues, suggestions, and improvements
   * Uses multi-arbiter coordination for comprehensive analysis
   */
  async analyzePreview(payload) {
    const {
      html = '',
      css = '',
      js = '',
      includeAccessibility = true,
      includePerformance = true,
      includeConsistency = true
    } = payload;

    try {
      const results = {
        score: 100,
        issues: {
          accessibility: 0,
          performance: 0,
          consistency: 0,
          bestPractices: 0
        },
        accessibility: [],
        performance: [],
        consistency: [],
        suggestions: []
      };

      // Accessibility Analysis via CodeObservationArbiter
      if (includeAccessibility && this.arbiters.codeObserver && html) {
        try {
          const a11yResult = await messageBroker.sendMessage({
            from: this.name,
            to: this.arbiters.codeObserver.name,
            type: 'analyze',
            payload: {
              code: html,
              filepath: 'preview.html',
              analysisType: 'accessibility'
            }
          });

          if (a11yResult && a11yResult.issues) {
            // Parse accessibility issues
            const issues = this.parseAccessibilityIssues(a11yResult.issues, html);
            results.accessibility = issues;
            results.issues.accessibility = issues.length;
            results.score -= issues.length * 2; // Deduct 2 points per issue
          }
        } catch (err) {
          this.auditLogger.warn(`Accessibility analysis failed: ${err.message}`);
        }
      }

      // Consistency Analysis via ReasoningChamber
      if (includeConsistency && this.arbiters.reasoningChamber && (html || css)) {
        try {
          const consistencyResult = await messageBroker.sendMessage({
            from: this.name,
            to: this.arbiters.reasoningChamber.name,
            type: 'analyze_consistency',
            payload: {
              html,
              css,
              context: 'preview_analysis'
            }
          });

          if (consistencyResult && consistencyResult.inconsistencies) {
            const issues = this.parseConsistencyIssues(consistencyResult.inconsistencies);
            results.consistency = issues;
            results.issues.consistency = issues.length;
            results.score -= issues.length * 1.5;
          }
        } catch (err) {
          this.auditLogger.warn(`Consistency analysis failed: ${err.message}`);
        }
      }

      // Performance Analysis via AdaptiveLearningRouter
      if (includePerformance && this.arbiters.adaptiveRouter && (html || css || js)) {
        try {
          const perfResult = await messageBroker.sendMessage({
            from: this.name,
            to: this.arbiters.adaptiveRouter.name,
            type: 'analyze_performance',
            payload: {
              html,
              css,
              js
            }
          });

          if (perfResult && perfResult.issues) {
            const issues = this.parsePerformanceIssues(perfResult.issues);
            results.performance = issues;
            results.issues.performance = issues.length;
            results.score -= issues.length * 3; // Performance issues are more critical
          }
        } catch (err) {
          this.auditLogger.warn(`Performance analysis failed: ${err.message}`);
        }
      }

      // Best Practice Suggestions via SteveArbiter
      if (this.arbiters.steve && html) {
        try {
          const suggestions = this.generateBestPracticeSuggestions(html, css, js);
          results.suggestions = suggestions;
          results.issues.bestPractices = suggestions.length;
        } catch (err) {
          this.auditLogger.warn(`Best practice analysis failed: ${err.message}`);
        }
      }

      // Ensure score doesn't go below 0
      results.score = Math.max(0, Math.min(100, results.score));

      return {
        success: true,
        ...results,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Analyze specific element context for targeted suggestions
   */
  async analyzeElement(payload) {
    const { selector, tagName, classes = [], styles = {}, content = '' } = payload;

    try {
      const elementContext = {
        selector,
        tagName,
        classes,
        styles,
        content: content.slice(0, 200) // Truncate long content
      };

      const suggestions = [];
      const relatedElements = [];
      const possibleIssues = [];

      // Button analysis
      if (tagName === 'button' || classes.some(c => c.includes('btn') || c.includes('button'))) {
        if (!content && !styles.backgroundImage) {
          possibleIssues.push('Button has no visible text or icon');
        }
        suggestions.push('Consider adding aria-label for accessibility');
        suggestions.push('Ensure button has focus states for keyboard navigation');
        relatedElements.push('button', '[role="button"]');
      }

      // Link analysis
      if (tagName === 'a') {
        suggestions.push('Ensure link has descriptive text (avoid "click here")');
        suggestions.push('Consider adding rel="noopener" for external links');
        relatedElements.push('a', '[role="link"]');
      }

      // Input analysis
      if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
        suggestions.push('Ensure form element has associated label');
        suggestions.push('Add placeholder text for better UX');
        suggestions.push('Consider adding validation feedback');
        relatedElements.push('label', 'form');
      }

      // Image analysis
      if (tagName === 'img') {
        possibleIssues.push('Ensure image has alt text for accessibility');
        suggestions.push('Consider lazy loading for performance');
        suggestions.push('Use responsive image sizes (srcset)');
      }

      // Heading analysis
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        suggestions.push('Maintain proper heading hierarchy');
        suggestions.push('Keep headings concise and descriptive');
        relatedElements.push('h1', 'h2', 'h3', 'h4', 'h5', 'h6');
      }

      // Color contrast check
      if (styles.color && styles.backgroundColor) {
        const contrast = this.estimateContrast(styles.color, styles.backgroundColor);
        if (contrast < 4.5) {
          possibleIssues.push(`Low color contrast (${contrast.toFixed(1)}:1), aim for 4.5:1`);
        }
      }

      // Font size check
      if (styles.fontSize) {
        const size = parseFloat(styles.fontSize);
        if (size < 14) {
          possibleIssues.push('Font size may be too small for readability');
        }
      }

      return {
        success: true,
        suggestions,
        relatedElements,
        possibleIssues,
        elementContext,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  // Helper methods for parsing analysis results

  parseAccessibilityIssues(issues, html) {
    const parsed = [];

    // Check for missing alt text
    const imgMatches = html.match(/<img[^>]*>/g) || [];
    imgMatches.forEach((img, idx) => {
      if (!img.includes('alt=')) {
        parsed.push({
          severity: 'critical',
          message: 'Image missing alt attribute for screen readers',
          selector: `img:nth-of-type(${idx + 1})`,
          confidence: 95
        });
      }
    });

    // Check for form inputs without labels
    const inputMatches = html.match(/<input[^>]*>/g) || [];
    inputMatches.forEach((input, idx) => {
      if (!input.includes('aria-label') && !html.includes(`<label`)) {
        parsed.push({
          severity: 'warning',
          message: 'Form input should have associated label',
          selector: `input:nth-of-type(${idx + 1})`,
          confidence: 85
        });
      }
    });

    // Check for missing lang attribute
    if (!html.includes('lang=')) {
      parsed.push({
        severity: 'warning',
        message: 'HTML should have lang attribute for accessibility',
        selector: 'html',
        confidence: 90
      });
    }

    return parsed;
  }

  parseConsistencyIssues(inconsistencies) {
    return inconsistencies.map(issue => ({
      message: issue.description || 'Style inconsistency detected',
      selector: issue.selector || 'body',
      confidence: issue.confidence || 75,
      fix: issue.suggestedFix
    }));
  }

  parsePerformanceIssues(issues) {
    return issues.map(issue => ({
      severity: issue.impact === 'high' ? 'high' : 'medium',
      message: issue.description || 'Performance optimization opportunity',
      selector: issue.selector || 'body',
      confidence: issue.confidence || 80,
      fix: issue.optimization
    }));
  }

  generateBestPracticeSuggestions(html, css, js) {
    const suggestions = [];

    // Check for inline styles
    if (html.includes('style=')) {
      suggestions.push({
        message: 'Consider moving inline styles to CSS for better maintainability',
        selector: '[style]',
        confidence: 70
      });
    }

    // Check for missing viewport meta tag
    if (!html.includes('viewport')) {
      suggestions.push({
        message: 'Add viewport meta tag for mobile responsiveness',
        selector: 'head',
        confidence: 90
      });
    }

    // Check for semantic HTML
    if (!html.includes('<main') && !html.includes('<article') && !html.includes('<section')) {
      suggestions.push({
        message: 'Use semantic HTML elements (main, article, section) for better structure',
        selector: 'body',
        confidence: 75
      });
    }

    return suggestions;
  }

  estimateContrast(color1, color2) {
    const named = {
      black: [0, 0, 0, 1], white: [255, 255, 255, 1], red: [255, 0, 0, 1],
      green: [0, 128, 0, 1], blue: [0, 0, 255, 1], yellow: [255, 255, 0, 1],
      gray: [128, 128, 128, 1], grey: [128, 128, 128, 1],
      navy: [0, 0, 128, 1], teal: [0, 128, 128, 1], purple: [128, 0, 128, 1],
      orange: [255, 165, 0, 1]
    };
    const parse = input => {
      const value = String(input || '').trim().toLowerCase();
      if (named[value]) return named[value];
      const hex = value.match(/^#([0-9a-f]{3,8})$/i)?.[1];
      if (hex) {
        const full = hex.length <= 4 ? [...hex].map(char => char + char).join('') : hex;
        if (![6, 8].includes(full.length)) return null;
        return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1];
      }
      const rgb = value.match(/^rgba?\(\s*([^,\s]+)[,\s]+([^,\s]+)[,\s]+([^,\s/]+)(?:\s*[,/]\s*([^\s)]+))?\s*\)$/i);
      if (!rgb) return null;
      const channel = token => token.endsWith('%') ? Math.round(parseFloat(token) * 2.55) : parseFloat(token);
      const alpha = rgb[4] == null ? 1 : rgb[4].endsWith('%') ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
      const result = [channel(rgb[1]), channel(rgb[2]), channel(rgb[3]), alpha];
      return result.every(Number.isFinite) && result.slice(0, 3).every(item => item >= 0 && item <= 255) && alpha >= 0 && alpha <= 1 ? result : null;
    };
    const foreground = parse(color1);
    const background = parse(color2);
    if (!foreground || !background || background[3] < 1) return Number.NaN;
    const composite = foreground[3] < 1
      ? foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]))
      : foreground.slice(0, 3);
    const luminance = channels => channels
      .map(channel => channel / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const backgroundLuminance = luminance(background.slice(0, 3));
    const light = Math.max(luminance(composite), backgroundLuminance);
    const dark = Math.min(luminance(composite), backgroundLuminance);
    return (light + 0.05) / (dark + 0.05);
  }

  /**
   * Analyze vision data via VisionProcessingArbiter
   */
  async analyzeVision(payload) {
    const { imageData, mimeType, analysisType = 'ui_mockup' } = payload;

    if (!this.arbiters.vision) {
      return {
        success: false,
        error: 'VisionProcessingArbiter not available'
      };
    }

    try {
      const result = await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.vision.name,
        type: 'analyze',
        payload: { imageData, mimeType, analysisType }
      });

      return {
        success: true,
        analysis: result,
        arbiterUsed: 'VisionProcessingArbiter',
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Workspace management
   */
  async createWorkspace(payload) {
    const { name, path, metadata = {} } = payload;
    const workspaceId = `ws_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    const workspace = {
      id: workspaceId,
      name,
      path,
      metadata,
      openFiles: [],
      activeFile: null,
      blueprint: [],
      createdAt: new Date().toISOString(),
      lastModified: new Date().toISOString()
    };

    this.workspaces.set(workspaceId, workspace);

    // Persist via ContextManagerArbiter if available
    if (this.arbiters.contextManager) {
      await this.saveWorkspaceState(workspaceId, workspace);
    }

    return {
      success: true,
      workspace,
      workspaceId
    };
  }

  async loadWorkspace(payload) {
    const { workspaceId } = payload;

    // Try from memory first
    if (this.workspaces.has(workspaceId)) {
      return {
        success: true,
        workspace: this.workspaces.get(workspaceId)
      };
    }

    // Load from ContextManagerArbiter if available
    if (this.arbiters.contextManager) {
      try {
        const result = await messageBroker.sendMessage({
          from: this.name,
          to: this.arbiters.contextManager.name,
          type: 'load_context',
          payload: { contextId: `pulse_workspace_${workspaceId}` }
        });

        if (result && result.context) {
          this.workspaces.set(workspaceId, result.context);
          return {
            success: true,
            workspace: result.context
          };
        }
      } catch (err) {
        this.auditLogger.warn(`Failed to load workspace: ${err.message}`);
      }
    }

    return {
      success: false,
      error: 'Workspace not found'
    };
  }

  async saveWorkspace(payload) {
    const { workspaceId, workspace } = payload;

    workspace.lastModified = new Date().toISOString();
    this.workspaces.set(workspaceId, workspace);

    await this.saveWorkspaceState(workspaceId, workspace);

    return {
      success: true,
      workspaceId,
      savedAt: workspace.lastModified
    };
  }

  async saveWorkspaceState(workspaceId, workspace) {
    if (!this.arbiters.contextManager) return;

    try {
      await messageBroker.sendMessage({
        from: this.name,
        to: this.arbiters.contextManager.name,
        type: 'save_context',
        payload: {
          contextId: `pulse_workspace_${workspaceId}`,
          context: workspace,
          metadata: { source: 'pulse', type: 'workspace' }
        }
      });
    } catch (err) {
      this.auditLogger.error(`Failed to save workspace state: ${err.message}`);
    }
  }

  /**
   * Get available capabilities and arbiter status
   */
  getAvailableCapabilities() {
    const capabilities = {};

    for (const [capability, arbiters] of Object.entries(this.capabilityMap)) {
      capabilities[capability] = {
        available: arbiters.some(name => this.arbiters[name] !== null),
        arbiters: arbiters.filter(name => this.arbiters[name] !== null)
      };
    }

    return {
      success: true,
      capabilities,
      activeWorkspaces: this.workspaces.size,
      metrics: this.metrics
    };
  }

  getStatus() {
    return {
      name: this.name,
      role: this.role,
      capabilities: this.capabilities,
      activeWorkspaces: this.workspaces.size,
      metrics: this.metrics,
      connectedArbiters: Object.entries(this.arbiters)
        .filter(([_, arbiter]) => arbiter !== null)
        .map(([name]) => name)
    };
  }
}

export default PulseArbiter;
