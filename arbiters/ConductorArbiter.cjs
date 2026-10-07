// FILE: ConductorArbiter.js
// Enhanced Conductor for Self-Managing Arbiter Ecosystem

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const { MessageBroker } = require('../core/MessageBroker.cjs');
const fs = require('fs').promises;
const path = require('path');

class ConductorArbiter extends BaseArbiter {
  static role = 'conductor';
  static capabilities = [
    'generate-arbiter',
    'self-optimize',
    'version-control',
    'self-document',
    'collaborative-generate'
  ];

  constructor(config = {}) {
    super(config);
    this.arbiterRepoPath = './arbiter-repo';
    this.versionIndex = {};
    // Use inherited broker from BaseArbiter
    this.messageBroker = this.broker;
    this.selfLearningData = {};
  }

  async initialize() {
    await super.initialize();
    await this.ensureRepo();
    this.logger.info(`[${this.name}] Conductor initialized with enhanced capabilities`);
  }

  async ensureRepo() {
    try {
      await fs.mkdir(this.arbiterRepoPath, { recursive: true });
    } catch (err) {
      this.logger.error(`[${this.name}] Failed to create arbiter repo:`, err);
    }
  }

  async processTask(task) {
    this.taskCount++;
    this.updateLoad();

    try {
      const { type, payload } = task;

      switch (type) {
        case 'generate-arbiter':
          return await this.generateArbiter(payload.description);

        case 'self-optimize':
          return await this.selfOptimize();

        case 'version-control':
          return await this.versionControl(payload.arbiterName);

        case 'self-document':
          return await this.generateDocumentation(payload.arbiterName);

        default:
          throw new Error(`Unknown task type: ${type}`);
      }
    } finally {
      this.taskCount--;
      this.updateLoad();
    }
  }

  async generateArbiter(description) {
    this.logger.info(`[${this.name}] Generating arbiter: ${description}`);

    const prompt = this.buildConductorPrompt(description);
    const response = await this.callClaudeAPI(prompt);
    const generated = this.parseGeneratedCode(response);

    const validation = await this.validateCode(generated.code);
    if (!validation.safe) {
      throw new Error(`[${this.name}] Arbiter generation failed: ${validation.reason}`);
    }

    await this.storeArbiterVersion(generated.arbiterName, generated.code);

    this.messageBroker.broadcast('arbiter-generated', {
      arbiterName: generated.arbiterName,
      role: generated.role
    });

    return {
      success: true,
      name: generated.arbiterName,
      role: generated.role,
      code: generated.code,
      metadata: generated.metadata
    };
  }

  buildConductorPrompt(description) {
    return `You are the Conductor — generate a new Arbiter with description: "${description}".
Include role, capabilities, full safe code, and metadata in JSON format.`;
  }

  parseGeneratedCode(response) {
    try {
      let cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (error) {
      this.logger.error(`[${this.name}] Failed to parse generated code:`, error);
      throw new Error('Invalid generated JSON');
    }
  }

  async validateCode(code) {
    const dangerousPatterns = [/eval\(/, /Function\(/, /require\(/, /process\./, /child_process/, /\.\.\/\.\./];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        return { safe: false, reason: `Dangerous pattern detected: ${pattern}` };
      }
    }
    return { safe: true };
  }

  async storeArbiterVersion(name, code) {
    const version = (this.versionIndex[name] || 0) + 1;
    this.versionIndex[name] = version;

    const arbiterPath = path.join(this.arbiterRepoPath, `${name}_v${version}.js`);
    await fs.writeFile(arbiterPath, code, 'utf8');

    this.logger.info(`[${this.name}] Stored arbiter ${name} version ${version}`);
  }

  async versionControl(arbiterName) {
    const versions = [];
    const files = await fs.readdir(this.arbiterRepoPath);
    for (const file of files) {
      if (file.startsWith(arbiterName)) versions.push(file);
    }
    return { success: true, versions };
  }

  async selfOptimize() {
    this.logger.info(`[${this.name}] Performing self-optimization...`);
    const improvement = "Refining arbiter generation prompts based on historical data.";
    return { success: true, message: improvement };
  }

  async generateDocumentation(arbiterName) {
    this.logger.info(`[${this.name}] Generating documentation for ${arbiterName}`);
    return {
      success: true,
      documentation: `Documentation for ${arbiterName}: This arbiter handles specific tasks as defined by its role and capabilities.`
    };
  }

  async executeWorkflow(workflow) {
    this.logger.info(`[${this.name}] Executing workflow: ${workflow.name} with ${workflow.nodes.length} nodes`);
    const logs = [];
    
    // Sort nodes based on connections (simple topological sort)
    // 1. Build adjacency list
    const adj = {};
    const inDegree = {};
    workflow.nodes.forEach(n => {
        adj[n.id] = [];
        inDegree[n.id] = 0;
    });
    
    workflow.connections.forEach(c => {
        if (adj[c.source] && inDegree[c.target] !== undefined) {
            adj[c.source].push(c.target);
            inDegree[c.target]++;
        }
    });
    
    // 2. Queue of nodes with no incoming edges
    const queue = workflow.nodes.filter(n => inDegree[n.id] === 0);
    const sortedNodes = [];
    
    while (queue.length > 0) {
        const node = queue.shift();
        sortedNodes.push(node);
        
        if (adj[node.id]) {
            adj[node.id].forEach(neighborId => {
                inDegree[neighborId]--;
                if (inDegree[neighborId] === 0) {
                    const neighbor = workflow.nodes.find(n => n.id === neighborId);
                    if (neighbor) queue.push(neighbor);
                }
            });
        }
    }
    
    // Fallback if cycle detected or disconnected parts: just append remaining
    workflow.nodes.forEach(n => {
        if (!sortedNodes.find(sn => sn.id === n.id)) sortedNodes.push(n);
    });

    // 3. Execute
    for (const node of sortedNodes) {
      const startTime = Date.now();
      let status = 'success';
      let output = '';
      
      try {
        this.logger.info(`[${this.name}] Processing node: ${node.data.label}`);
        
        // Notify start
        if (this.messageBroker) {
            this.messageBroker.broadcast('workflow_update', {
                type: 'node_start',
                nodeId: node.id,
                workflowId: workflow.id
            });
        }

        if (node.data.code) {
           // If specific code is provided, analyze/execute it via LLM simulation for safety
           // In a real sandbox, we'd eval() it. Here we ask the AI to "run" it mentally.
           const taskResult = await this.executeTask({
               query: `Execute this workflow step: ${node.data.label}. \nContext: ${node.data.description || ''}\nCode/Logic: ${node.data.code}`,
               mode: 'fast',
               requiresTree: false
           });
           output = taskResult.response;
        } else {
           // Generic processing
           output = `Node ${node.data.label} executed successfully.`;
        }
      } catch (e) {
        status = 'error';
        output = e.message;
        this.logger.error(`[${this.name}] Node execution failed:`, e);
      }
      
      const log = {
          id: `log-${Date.now()}-${node.id}`,
          workflowId: workflow.id,
          nodeId: node.id,
          status,
          output,
          startTime: new Date(startTime),
          endTime: new Date(),
          duration: Date.now() - startTime
      };
      
      logs.push(log);
      
      // Notify completion
      if (this.messageBroker) {
          this.messageBroker.broadcast('workflow_update', {
              type: 'node_complete',
              log,
              workflowId: workflow.id
          });
      }
      
      // Stop on error?
      if (status === 'error') break;
    }
    
    return logs;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Enhanced Terminal Integration - Reasoning & Collaboration
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a task with multi-arbiter orchestration and reasoning tree tracking
   * @param {Object} options - Task configuration
   * @param {string} options.query - User query
   * @param {Object} options.context - Additional context
   * @param {string} options.mode - Execution mode: 'fast', 'balanced', 'deep'
   * @param {boolean} options.requiresTree - Whether to build reasoning tree
   * @returns {Object} Result with response, tree, arbiters used, confidence
   */
  async executeTask(options) {
    const { query, context = {}, mode = 'balanced', requiresTree = true } = options;
    const startTime = Date.now();
    const tree = this.createRootNode(query);
    const arbitersUsed = [];

    this.logger.info(`[${this.name}] Executing task in ${mode} mode: ${query.substring(0, 50)}...`);

    try {
      // 1. Analyze and decompose task
      const decomposition = await this.decomposeTask(query, context, mode);
      tree.children.push(this.createNode('decomposition', 'ConductorArbiter', 'Task Analysis', decomposition.subtasks.join(', '), 0.9));

      // 2. Select appropriate arbiters for each subtask
      const selectedArbiters = this.selectArbiters(decomposition.taskType);
      arbitersUsed.push(...selectedArbiters.map(a => a.constructor.name));

      // 3. Execute subtasks with selected arbiters
      const results = [];
      for (let i = 0; i < decomposition.subtasks.length; i++) {
        const subtask = decomposition.subtasks[i];
        const arbiter = selectedArbiters[i % selectedArbiters.length];
        
        const result = await this.executeSubtask(arbiter, subtask, context);
        results.push(result);
        
        if (requiresTree) {
          tree.children.push(this.createNode(
            `subtask-${i}`,
            arbiter.constructor.name,
            subtask,
            result.response,
            result.confidence || 0.8
          ));
        }
      }

      // 4. Aggregate results
      const finalResult = this.aggregateResults(results, query);
      tree.finalResult = finalResult.response;
      tree.aggregateConfidence = finalResult.confidence;

      const duration = Date.now() - startTime;
      this.logger.info(`[${this.name}] Task completed in ${duration}ms with confidence ${finalResult.confidence.toFixed(2)}`);

      return {
        response: finalResult.response,
        tree: requiresTree ? tree : null,
        arbitersUsed: [...new Set(arbitersUsed)],
        confidence: finalResult.confidence,
        metadata: {
          duration,
          mode,
          subtaskCount: decomposition.subtasks.length
        }
      };
    } catch (error) {
      this.logger.error(`[${this.name}] Task execution failed:`, error);
      return {
        response: `Error: ${error.message}`,
        tree: requiresTree ? tree : null,
        arbitersUsed,
        confidence: 0,
        metadata: { error: error.message }
      };
    }
  }

  /**
   * Execute a coding task with specialized coding arbiters
   * @param {Object} options - Coding task configuration
   * @returns {Object} Result with code, tests, explanation, tree
   */
  async executeCodeTask(options) {
    const { task, files = [], language = 'detect', testRequirements = null } = options;
    const startTime = Date.now();
    const tree = this.createRootNode(`Code: ${task}`);
    const arbitersUsed = [];

    this.logger.info(`[${this.name}] Executing coding task: ${task.substring(0, 50)}...`);

    try {
      // 1. Analyze requirements
      const analysis = await this.analyzeCodeTask(task, files, language);
      tree.children.push(this.createNode('analysis', 'ConductorArbiter', 'Requirement Analysis', analysis.summary, 0.85));
      arbitersUsed.push('ConductorArbiter');

      // 2. Generate code
      const codeResult = await this.generateCode(task, analysis, files, language);
      tree.children.push(this.createNode('implementation', 'ConductorArbiter', 'Code Generation', 'Code generated', 0.80));

      // 3. Generate tests (if required)
      let tests = null;
      if (testRequirements !== false) {
        tests = await this.generateTests(codeResult.code, task, testRequirements);
        tree.children.push(this.createNode('testing', 'ConductorArbiter', 'Test Generation', `${tests.length} tests generated`, 0.85));
      }

      // 4. Review and refine
      const review = await this.reviewCode(codeResult.code, tests);
      tree.children.push(this.createNode('review', 'ConductorArbiter', 'Code Review', review.summary, review.confidence));

      tree.finalResult = 'Code generation complete';
      tree.aggregateConfidence = 0.85;

      const duration = Date.now() - startTime;

      return {
        code: codeResult.code,
        explanation: codeResult.explanation,
        tests: tests || [],
        tree,
        arbitersUsed: [...new Set(arbitersUsed)],
        metadata: {
          duration,
          language: codeResult.detectedLanguage || language,
          linesOfCode: codeResult.code.split('\n').length
        }
      };
    } catch (error) {
      this.logger.error(`[${this.name}] Coding task failed:`, error);
      return {
        code: '',
        explanation: `Error: ${error.message}`,
        tests: [],
        tree,
        arbitersUsed,
        metadata: { error: error.message }
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Helper Methods for Task Execution
  // ═══════════════════════════════════════════════════════════════════════════

  createRootNode(query) {
    return {
      id: 'root',
      query,
      type: 'root',
      children: [],
      finalResult: null,
      aggregateConfidence: 0
    };
  }

  createNode(id, arbiter, action, result, confidence) {
    return {
      id,
      arbiter,
      action,
      result: typeof result === 'string' ? result.substring(0, 200) : JSON.stringify(result).substring(0, 200),
      confidence,
      children: []
    };
  }

  async decomposeTask(query, context, mode) {
    // Simple decomposition logic - can be enhanced with LLM
    const taskType = this.detectTaskType(query);
    let subtasks = [];

    if (mode === 'fast') {
      subtasks = [query]; // Single subtask for fast mode
    } else if (mode === 'balanced') {
      // Break into 2-3 subtasks
      if (taskType === 'analysis') {
        subtasks = [`Analyze: ${query}`, `Synthesize findings`];
      } else if (taskType === 'creation') {
        subtasks = [`Plan: ${query}`, `Create content`, `Review and refine`];
      } else {
        subtasks = [`Process: ${query}`, `Validate result`];
      }
    } else { // deep mode
      // Break into 4-5 subtasks with thorough analysis
      subtasks = [
        `Deep analysis: ${query}`,
        `Research relevant context`,
        `Generate comprehensive solution`,
        `Critical review`,
        `Final refinement`
      ];
    }

    return { taskType, subtasks, mode };
  }

  detectTaskType(query) {
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('analyze') || lowerQuery.includes('explain') || lowerQuery.includes('what')) {
      return 'analysis';
    } else if (lowerQuery.includes('create') || lowerQuery.includes('write') || lowerQuery.includes('generate')) {
      return 'creation';
    } else if (lowerQuery.includes('code') || lowerQuery.includes('implement') || lowerQuery.includes('function')) {
      return 'coding';
    } else {
      return 'general';
    }
  }

  selectArbiters(taskType) {
    // Try to get arbiters from the broker/orchestrator
    const selectedArbiters = [];
    
    if (this.broker && this.broker.arbiters) {
      const arbiters = this.broker.arbiters;
      
      // Select arbiters based on task type
      if (taskType === 'coding') {
        // Look for coding-related arbiters
        for (const [name, arbiterData] of arbiters.entries()) {
          if (name && (
            name.includes('Analyst') ||
            name.includes('Implementer') ||
            name.includes('Coder') ||
            name.includes('Tester') ||
            name.includes('Reviewer')
          )) {
            selectedArbiters.push(arbiterData.instance || arbiterData);
          }
        }
      } else if (taskType === 'analysis') {
        // Look for analysis arbiters
        for (const [name, arbiterData] of arbiters.entries()) {
          if (name && name.includes('Analyst')) {
            selectedArbiters.push(arbiterData.instance || arbiterData);
          }
        }
      }
    }
    
    // Fallback to self if no arbiters found
    if (selectedArbiters.length === 0) {
      return [this];
    }
    
    return selectedArbiters;
  }

  async executeSubtask(arbiter, subtask, context) {
    try {
      // Try to call the arbiter's execute or processTask method if it exists
      if (typeof arbiter.execute === 'function') {
        const task = {
          query: subtask,
          context: context,
          priority: 'normal',
          maxRetries: 1,
          timeoutMs: 30000
        };
        
        const result = await arbiter.execute(task);
        
        return {
          response: result.data?.summary || result.data || subtask,
          confidence: result.confidence || 0.8,
          arbiter: arbiter.constructor?.name || arbiter.name || 'Unknown'
        };
      } else if (typeof arbiter.processTask === 'function') {
        const result = await arbiter.processTask({ query: subtask, context });
        return {
          response: result.response || result.message || subtask,
          confidence: result.confidence || 0.8,
          arbiter: arbiter.constructor?.name || arbiter.name || 'Unknown'
        };
      }
      
      // Fallback: simple response
      return {
        response: `Processed by ${arbiter.constructor?.name || 'Arbiter'}: ${subtask}`,
        confidence: 0.7,
        arbiter: arbiter.constructor?.name || arbiter.name || 'Unknown'
      };
    } catch (error) {
      this.logger.error(`Subtask execution error:`, error);
      return {
        response: `Error in subtask: ${error.message}`,
        confidence: 0,
        arbiter: arbiter.constructor?.name || arbiter.name || 'Unknown'
      };
    }
  }

  async aggregateResults(results, originalQuery) {
    const responses = results.map(r => r.response).filter(Boolean);
    const avgConfidence = results.reduce((sum, r) => sum + (r.confidence || 0), 0) / results.length;

    // For simple cases or single result, no need to synthesize
    if (results.length === 1) {
      return {
        response: responses[0],
        confidence: avgConfidence
      };
    }

    try {
      // Use LLM to synthesize coherent response from multiple arbiter outputs
      const prompt = `Synthesize a coherent response from multiple AI arbiter outputs for this query:

Original Query: ${originalQuery}

Arbiter Responses:
${responses.map((r, i) => `${i + 1}. ${r}`).join('\n\n')}

Provide a clear, unified response that:
1. Combines the key insights from all arbiters
2. Resolves any contradictions
3. Maintains factual accuracy
4. Stays focused on the original query

Response:`;

      const synthesized = await this.callClaudeAPI(prompt);
      
      return {
        response: synthesized.trim(),
        confidence: avgConfidence
      };
    } catch (error) {
      this.logger.error(`Result synthesis failed, using concatenation:`, error);
      return {
        response: responses.join('\n\n'),
        confidence: avgConfidence * 0.9 // Slight penalty for failed synthesis
      };
    }
  }

  async analyzeCodeTask(task, files, language) {
    return {
      summary: `Analyzed coding task: ${task}`,
      estimatedComplexity: 'medium',
      requiredSkills: ['programming', language],
      fileContext: files.length
    };
  }

  async generateCode(task, analysis, files, language) {
    try {
      // Build context from files
      const fileContext = files.map(f => `File: ${f.file}\n${f.content}`).join('\n\n');
      
      const prompt = `Generate ${language !== 'detect' ? language : ''} code for the following task:

Task: ${task}

${fileContext ? `Context Files:\n${fileContext}\n\n` : ''}Analysis: ${JSON.stringify(analysis)}

Provide:
1. Clean, production-ready code
2. Brief explanation of the solution
3. Any important considerations

Format your response as JSON:
{
  "code": "<code here>",
  "explanation": "<explanation>",
  "language": "<detected/specified language>",
  "considerations": ["<consideration1>", "<consideration2>"]
}`;

      const response = await this.callClaudeAPI(prompt);
      
      // Parse JSON response
      try {
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned);
        return {
          code: parsed.code,
          explanation: parsed.explanation,
          detectedLanguage: parsed.language || language,
          considerations: parsed.considerations || []
        };
      } catch (parseError) {
        // Fallback: extract code blocks from response
        const codeMatch = response.match(/```[\w]*\n([\s\S]*?)```/);
        return {
          code: codeMatch ? codeMatch[1] : response,
          explanation: `Generated code for: ${task}`,
          detectedLanguage: language,
          considerations: []
        };
      }
    } catch (error) {
      this.logger.error(`Code generation failed:`, error);
      return {
        code: `// Error generating code: ${error.message}`,
        explanation: `Failed to generate code: ${error.message}`,
        detectedLanguage: language,
        considerations: []
      };
    }
  }

  async generateTests(code, task, requirements) {
    try {
      const prompt = `Generate comprehensive tests for the following code:

Task: ${task}
Code:
${code}

${requirements ? `Requirements: ${JSON.stringify(requirements)}` : ''}

Provide unit tests that cover:
1. Basic functionality
2. Edge cases
3. Error handling
4. Boundary conditions

Format as JSON array:
[
  {"name": "test_name", "code": "test code", "description": "what it tests"},
  ...
]`;

      const response = await this.callClaudeAPI(prompt);
      
      try {
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
      } catch (parseError) {
        // Fallback: create basic test structure
        return [{
          name: 'test_generated_code',
          code: `// Tests for: ${task}\n${response}`,
          description: 'Generated test suite'
        }];
      }
    } catch (error) {
      this.logger.error(`Test generation failed:`, error);
      return [{
        name: 'test_error',
        code: `// Error generating tests: ${error.message}`,
        description: 'Test generation failed'
      }];
    }
  }

  /**
   * Unified LLM API call with Gemini primary and SOMA 1T (Ollama) graceful fallback
   * @param {string} prompt - The prompt to send
   * @param {Object} options - Optional configuration
   * @returns {Promise<string>} - The LLM response
   */
  async callClaudeAPI(prompt, options = {}) {
    const { temperature = 0.7, maxTokens = 2048 } = options;

    // Try Gemini first (primary)
    try {
      this.logger.info(`[ConductorArbiter] Calling Gemini (${process.env.GEMINI_MODEL || 'gemini-2.0-flash'})...`);
      const result = await this._callGeminiAPI(prompt, { temperature, maxTokens });
      this.logger.info(`[ConductorArbiter] Gemini response received (${result.length} chars)`);
      return result;
    } catch (geminiError) {
      this.logger.warn(`[ConductorArbiter] Gemini failed: ${geminiError.message}`);
      this.logger.info(`[ConductorArbiter] Falling back to SOMA 1T (local Ollama)...`);

      // Fallback to SOMA 1T via Ollama
      try {
        const result = await this._callSoma1T(prompt, { temperature, maxTokens });
        return result;
      } catch (somaError) {
        this.logger.error(`[ConductorArbiter] All LLM APIs failed!`);
        this.logger.error(`  - Gemini: ${geminiError.message}`);
        this.logger.error(`  - SOMA 1T: ${somaError.message}`);
        throw new Error(`LLM unavailable: Gemini (${geminiError.message}), SOMA 1T (${somaError.message})`);
      }
    }
  }
  
  /**
   * Call Gemini API (primary LLM)
   * @private
   */
  async _callGeminiAPI(prompt, options) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');

    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const geminiModel = genAI.getGenerativeModel({
        model,
        generationConfig: {
          temperature: options.temperature || 0.7,
          maxOutputTokens: options.maxTokens || 2048
        }
      });

      const result = await geminiModel.generateContent(prompt);
      const response = await result.response;
      const text = response.text();

      if (!text) {
        throw new Error('Gemini returned empty response');
      }

      return text;
    } catch (error) {
      // Check for rate limit errors
      const errorMsg = error.message || '';
      if (errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('rate')) {
        this.logger.warn(`[ConductorArbiter] Gemini rate limited - triggering fallback`);
        throw new Error(`RATE_LIMITED: ${errorMsg}`);
      }
      throw error;
    }
  }
  
  /**
   * Call SOMA 1T via local Ollama (graceful fallback)
   * @private
   */
  async _callSoma1T(prompt, options) {
    const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
    const ollamaModel = process.env.OLLAMA_MODEL || 'soma-1t-v1';

    this.logger.info(`[ConductorArbiter] Calling Ollama fallback: ${ollamaModel}`);

    const response = await fetch(`${ollamaEndpoint}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: ollamaModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false,
        options: {
          temperature: options.temperature || 0.7,
          num_predict: options.maxTokens || 2048
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    if (!data.message?.content) {
      throw new Error('Ollama returned empty response');
    }

    this.logger.info(`[ConductorArbiter] Ollama response received (${data.message.content.length} chars)`);
    return data.message.content;
  }

  async reviewCode(code, tests) {
    try {
      const testSummary = tests ? `\nTests: ${tests.length} test cases generated` : '';
      const prompt = `Review the following code for quality, best practices, and potential issues:

Code:
${code}
${testSummary}

Provide:
1. Overall quality assessment
2. Specific issues or concerns
3. Suggestions for improvement
4. Confidence score (0-1)

Format as JSON:
{
  "summary": "<brief summary>",
  "confidence": <0-1>,
  "issues": ["<issue1>", "<issue2>"],
  "suggestions": ["<suggestion1>", "<suggestion2>"],
  "strengths": ["<strength1>", "<strength2>"]
}`;

      const response = await this.callClaudeAPI(prompt);
      
      try {
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned);
      } catch (parseError) {
        return {
          summary: response.substring(0, 200),
          confidence: 0.75,
          issues: [],
          suggestions: [],
          strengths: []
        };
      }
    } catch (error) {
      this.logger.error(`Code review failed:`, error);
      return {
        summary: `Review failed: ${error.message}`,
        confidence: 0,
        issues: [error.message],
        suggestions: [],
        strengths: []
      };
    }
  }
}

module.exports = ConductorArbiter;







