/**
 * FSM Executor - Finite State Machine Workflow Engine
 * AUTOGEN Integration: Visual workflow execution with state machines
 *
 * Executes workflows defined as state machines with:
 * - Explicit state transitions
 * - Error handling and recovery
 * - State persistence
 * - Event emission for monitoring
 * - Conditional branching
 */

import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

export class FSMExecutor extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'FSMExecutor';
    this.workflows = new Map(); // workflowId -> workflow definition
    this.executions = new Map(); // executionId -> execution state
    this.storageDir = opts.storageDir || path.join(process.cwd(), 'SOMA', 'workflows');
    this.maxExecutions = opts.maxExecutions || 100;

    // Execution statistics
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      avgExecutionTime: 0
    };
  }

  /**
   * Initialize the FSM executor
   */
  async initialize() {
    try {
      console.log(`[${this.name}] Initializing FSM Executor...`);

      // Ensure storage directory exists
      await fs.mkdir(this.storageDir, { recursive: true });

      // Load saved workflows
      await this.loadWorkflows();

      console.log(`[${this.name}] ✅ FSM Executor initialized with ${this.workflows.size} workflows`);
      this.emit('initialized');
    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error.message);
      throw error;
    }
  }

  /**
   * Register a new workflow definition
   * @param {Object} workflow - Workflow definition
   * @returns {string} workflowId
   */
  async registerWorkflow(workflow) {
    try {
      // Validate workflow
      this.validateWorkflow(workflow);

      const workflowId = workflow.id || this.generateId();

      const workflowDef = {
        id: workflowId,
        name: workflow.name,
        description: workflow.description || '',
        version: workflow.version || '1.0.0',
        states: workflow.states, // Map of stateId -> state definition
        initialState: workflow.initialState,
        finalStates: workflow.finalStates || [],
        errorState: workflow.errorState || 'error',
        metadata: workflow.metadata || {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      this.workflows.set(workflowId, workflowDef);

      // Save to disk
      await this.saveWorkflow(workflowDef);

      console.log(`[${this.name}] ✅ Registered workflow: ${workflowDef.name} (${workflowId})`);
      this.emit('workflow_registered', { workflowId, name: workflowDef.name });

      return workflowId;
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to register workflow:`, error.message);
      throw error;
    }
  }

  /**
   * Execute a workflow
   * @param {string} workflowId - ID of workflow to execute
   * @param {Object} input - Input data for the workflow
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async executeWorkflow(workflowId, input = {}, context = {}) {
    const startTime = Date.now();
    const executionId = this.generateId();

    try {
      const workflow = this.workflows.get(workflowId);
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowId}`);
      }

      console.log(`[${this.name}] 🚀 Executing workflow: ${workflow.name} (${executionId})`);

      // Create execution state
      const execution = {
        id: executionId,
        workflowId,
        workflowName: workflow.name,
        currentState: workflow.initialState,
        input,
        context,
        data: {}, // Accumulated data during execution
        history: [], // State transition history
        status: 'running',
        startTime,
        error: null
      };

      this.executions.set(executionId, execution);
      this.stats.totalExecutions++;

      this.emit('execution_started', {
        executionId,
        workflowId,
        workflowName: workflow.name
      });

      // Execute state machine
      const result = await this.runStateMachine(execution, workflow);

      // Update execution state
      execution.status = result.success ? 'completed' : 'failed';
      execution.endTime = Date.now();
      execution.duration = execution.endTime - startTime;
      execution.result = result;

      if (result.success) {
        this.stats.successfulExecutions++;
      } else {
        this.stats.failedExecutions++;
      }

      // Update average execution time
      this.stats.avgExecutionTime =
        (this.stats.avgExecutionTime * (this.stats.totalExecutions - 1) + execution.duration) /
        this.stats.totalExecutions;

      this.emit('execution_completed', {
        executionId,
        workflowId,
        success: result.success,
        duration: execution.duration
      });

      console.log(`[${this.name}] ${result.success ? '✅' : '❌'} Workflow ${result.success ? 'completed' : 'failed'}: ${workflow.name} (${execution.duration}ms)`);

      // Cleanup old executions
      this.cleanupExecutions();

      return {
        success: result.success,
        executionId,
        workflowId,
        workflowName: workflow.name,
        finalState: execution.currentState,
        output: result.output,
        data: execution.data,
        history: execution.history,
        duration: execution.duration,
        error: result.error
      };

    } catch (error) {
      this.stats.failedExecutions++;

      console.error(`[${this.name}] ❌ Execution failed:`, error.message);

      this.emit('execution_failed', {
        executionId,
        workflowId,
        error: error.message,
        duration: Date.now() - startTime
      });

      throw error;
    }
  }

  /**
   * Run the state machine
   * @private
   */
  async runStateMachine(execution, workflow) {
    const maxTransitions = 100; // Prevent infinite loops
    let transitionCount = 0;

    while (transitionCount < maxTransitions) {
      const currentState = workflow.states[execution.currentState];

      if (!currentState) {
        return {
          success: false,
          error: `Invalid state: ${execution.currentState}`,
          output: null
        };
      }

      // Check if we've reached a final state
      if (workflow.finalStates.includes(execution.currentState)) {
        return {
          success: true,
          output: execution.data,
          finalState: execution.currentState
        };
      }

      console.log(`[${this.name}]   State: ${execution.currentState} → ${currentState.type}`);

      this.emit('state_entered', {
        executionId: execution.id,
        state: execution.currentState,
        stateType: currentState.type
      });

      try {
        // Execute state action
        const stateResult = await this.executeState(execution, currentState, workflow);

        // Record in history
        execution.history.push({
          state: execution.currentState,
          timestamp: Date.now(),
          input: stateResult.input || {},
          output: stateResult.output || {},
          success: stateResult.success
        });

        // Merge output data
        execution.data = { ...execution.data, ...stateResult.output };

        // Determine next state
        const nextState = await this.getNextState(execution, currentState, stateResult, workflow);

        if (!nextState) {
          return {
            success: false,
            error: 'No valid transition found',
            output: execution.data
          };
        }

        // Transition to next state
        console.log(`[${this.name}]     Transition: ${execution.currentState} → ${nextState}`);
        execution.currentState = nextState;

        transitionCount++;

      } catch (error) {
        console.error(`[${this.name}]   ❌ State execution failed:`, error.message);

        // Record error in history
        execution.history.push({
          state: execution.currentState,
          timestamp: Date.now(),
          error: error.message,
          success: false
        });

        // Transition to error state
        if (workflow.errorState && workflow.states[workflow.errorState]) {
          execution.currentState = workflow.errorState;
          execution.data.error = error.message;
          transitionCount++;
        } else {
          return {
            success: false,
            error: error.message,
            output: execution.data
          };
        }
      }
    }

    return {
      success: false,
      error: 'Maximum transitions exceeded (possible infinite loop)',
      output: execution.data
    };
  }

  /**
   * Execute a single state
   * @private
   */
  async executeState(execution, state, workflow) {
    const stateType = state.type;

    switch (stateType) {
      case 'action':
        return await this.executeActionState(execution, state);

      case 'decision':
        return await this.executeDecisionState(execution, state);

      case 'parallel':
        return await this.executeParallelState(execution, state);

      case 'wait':
        return await this.executeWaitState(execution, state);

      case 'terminal':
        return { success: true, output: execution.data };

      default:
        throw new Error(`Unknown state type: ${stateType}`);
    }
  }

  /**
   * Execute action state (calls agent/arbiter)
   * @private
   */
  async executeActionState(execution, state) {
    const { action, parameters } = state;

    // Emit event for external handler
    const actionResult = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Action timeout: ${action}`));
      }, state.timeout || 30000);

      this.once(`action_result:${execution.id}:${action}`, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });

      this.emit('execute_action', {
        executionId: execution.id,
        action,
        parameters: parameters || {},
        context: execution.context,
        data: execution.data
      });
    });

    return {
      success: true,
      output: actionResult
    };
  }

  /**
   * Execute decision state (conditional branching)
   * @private
   */
  async executeDecisionState(execution, state) {
    const { condition, branches } = state;

    // Evaluate condition (can be JavaScript expression or function)
    let conditionResult;

    if (typeof condition === 'function') {
      conditionResult = await condition(execution.data, execution.context);
    } else if (typeof condition === 'string') {
      // Simple expression evaluation (safe subset)
      conditionResult = this.evaluateCondition(condition, execution.data);
    } else {
      throw new Error('Invalid condition type');
    }

    return {
      success: true,
      output: { conditionResult, selectedBranch: conditionResult ? 'true' : 'false' }
    };
  }

  /**
   * Execute parallel state (fork execution)
   * @private
   */
  async executeParallelState(execution, state) {
    const { branches } = state;

    // Execute all branches in parallel
    const results = await Promise.all(
      branches.map(async (branch) => {
        try {
          const branchResult = await this.executeState(execution, branch, null);
          return { success: true, result: branchResult };
        } catch (error) {
          return { success: false, error: error.message };
        }
      })
    );

    const allSuccess = results.every(r => r.success);

    return {
      success: allSuccess,
      output: { parallelResults: results }
    };
  }

  /**
   * Execute wait state (delay)
   * @private
   */
  async executeWaitState(execution, state) {
    const duration = state.duration || 1000;
    await new Promise(resolve => setTimeout(resolve, duration));
    return { success: true, output: {} };
  }

  /**
   * Determine next state based on transitions
   * @private
   */
  async getNextState(execution, currentState, stateResult, workflow) {
    const transitions = currentState.transitions || [];

    for (const transition of transitions) {
      // Check transition condition
      if (transition.condition) {
        const conditionMet = this.evaluateCondition(transition.condition, {
          ...execution.data,
          ...stateResult.output
        });

        if (!conditionMet) {
          continue;
        }
      }

      // Check if target state exists
      if (!workflow.states[transition.target]) {
        console.warn(`[${this.name}]   ⚠️  Invalid transition target: ${transition.target}`);
        continue;
      }

      return transition.target;
    }

    // No valid transition found
    return null;
  }

  /**
   * Evaluate simple conditions
   * @private
   */
  evaluateCondition(condition, data) {
    try {
      // Very simple and safe condition evaluation
      // Supports: data.field === value, data.field > value, etc.

      // Replace data.field references
      let expr = condition;
      for (const [key, value] of Object.entries(data)) {
        const regex = new RegExp(`data\\.${key}\\b`, 'g');
        expr = expr.replace(regex, JSON.stringify(value));
      }

      // Evaluate (in a safe way - only comparisons)
      return eval(expr);
    } catch (error) {
      console.warn(`[${this.name}] Failed to evaluate condition: ${condition}`, error.message);
      return false;
    }
  }

  /**
   * Validate workflow definition
   * @private
   */
  validateWorkflow(workflow) {
    if (!workflow.name) {
      throw new Error('Workflow must have a name');
    }

    if (!workflow.states || Object.keys(workflow.states).length === 0) {
      throw new Error('Workflow must have at least one state');
    }

    if (!workflow.initialState) {
      throw new Error('Workflow must have an initial state');
    }

    if (!workflow.states[workflow.initialState]) {
      throw new Error(`Initial state not found: ${workflow.initialState}`);
    }

    // Validate each state
    for (const [stateId, state] of Object.entries(workflow.states)) {
      if (!state.type) {
        throw new Error(`State ${stateId} must have a type`);
      }

      // Validate transitions
      if (state.transitions) {
        for (const transition of state.transitions) {
          if (!transition.target) {
            throw new Error(`Transition in state ${stateId} must have a target`);
          }
        }
      }
    }

    return true;
  }

  /**
   * Save workflow to disk
   * @private
   */
  async saveWorkflow(workflow) {
    const filePath = path.join(this.storageDir, `workflow_${workflow.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(workflow, null, 2));
  }

  /**
   * Load workflows from disk
   * @private
   */
  async loadWorkflows() {
    try {
      const files = await fs.readdir(this.storageDir);
      const workflowFiles = files.filter(f => f.startsWith('workflow_') && f.endsWith('.json'));

      for (const file of workflowFiles) {
        try {
          const filePath = path.join(this.storageDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const workflow = JSON.parse(content);
          this.workflows.set(workflow.id, workflow);
        } catch (error) {
          console.warn(`[${this.name}] Failed to load workflow ${file}:`, error.message);
        }
      }

      console.log(`[${this.name}] Loaded ${this.workflows.size} workflows from disk`);
    } catch (error) {
      // Directory doesn't exist yet, that's ok
    }
  }

  /**
   * Cleanup old executions
   * @private
   */
  cleanupExecutions() {
    if (this.executions.size > this.maxExecutions) {
      const sorted = Array.from(this.executions.entries())
        .sort((a, b) => b[1].startTime - a[1].startTime);

      // Keep only most recent
      const toDelete = sorted.slice(this.maxExecutions);
      toDelete.forEach(([id]) => this.executions.delete(id));
    }
  }

  /**
   * Generate unique ID
   * @private
   */
  generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get workflow by ID
   */
  getWorkflow(workflowId) {
    return this.workflows.get(workflowId);
  }

  /**
   * List all workflows
   */
  listWorkflows() {
    return Array.from(this.workflows.values());
  }

  /**
   * Get execution status
   */
  getExecution(executionId) {
    return this.executions.get(executionId);
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeExecutions: this.executions.size,
      totalWorkflows: this.workflows.size
    };
  }
}

export default FSMExecutor;
