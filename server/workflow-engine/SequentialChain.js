/**
 * Sequential Task Chains - Helper for linear workflow creation
 * Makes it easy to create workflows where tasks run one after another
 *
 * Features:
 * - Fluent API for chaining tasks
 * - Automatic state creation and linking
 * - Error recovery strategies
 * - Progress tracking
 * - Result passing between tasks
 */

import { EventEmitter } from 'events';

export class SequentialChain extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || `chain_${Date.now()}`;
    this.description = opts.description || '';
    this.tasks = [];
    this.errorStrategy = opts.errorStrategy || 'stop'; // stop, continue, retry
    this.retryAttempts = opts.retryAttempts || 3;
    this.tags = opts.tags || ['sequential', 'chain'];
  }

  /**
   * Add an action task to the chain
   */
  action(name, action, parameters = {}, options = {}) {
    const taskId = `task_${this.tasks.length + 1}`;

    this.tasks.push({
      id: taskId,
      type: 'action',
      name,
      action,
      parameters,
      timeout: options.timeout || 30000,
      retries: options.retries || this.retryAttempts,
      optional: options.optional || false,
    });

    return this; // Fluent API
  }

  /**
   * Add a decision point to the chain
   */
  decision(name, branches, options = {}) {
    const taskId = `task_${this.tasks.length + 1}`;

    this.tasks.push({
      id: taskId,
      type: 'decision',
      name,
      branches,
      defaultBranch: options.defaultBranch || 0,
    });

    return this;
  }

  /**
   * Add a wait/delay to the chain
   */
  wait(name, duration, options = {}) {
    const taskId = `task_${this.tasks.length + 1}`;

    this.tasks.push({
      id: taskId,
      type: 'wait',
      name,
      duration,
      message: options.message || `Waiting ${duration}ms...`,
    });

    return this;
  }

  /**
   * Add a parallel task group to the chain
   */
  parallel(name, tasks, options = {}) {
    const taskId = `task_${this.tasks.length + 1}`;

    this.tasks.push({
      id: taskId,
      type: 'parallel',
      name,
      branches: tasks.map((task, i) => ({
        name: task.name || `subtask_${i + 1}`,
        action: task.action,
        parameters: task.parameters || {},
      })),
      waitForAll: options.waitForAll !== false, // Default true
      timeout: options.timeout || 60000,
    });

    return this;
  }

  /**
   * Add a transform/map operation
   */
  transform(name, transformFn, options = {}) {
    const taskId = `task_${this.tasks.length + 1}`;

    this.tasks.push({
      id: taskId,
      type: 'action',
      name,
      action: 'custom:transform',
      parameters: {
        transformFn: transformFn.toString(),
      },
      description: options.description || 'Transform data',
    });

    return this;
  }

  /**
   * Build the workflow from the chain
   */
  build() {
    if (this.tasks.length === 0) {
      throw new Error('Chain is empty - add at least one task');
    }

    const states = {};
    const terminalId = 'terminal_success';

    // Create terminal state
    states[terminalId] = {
      type: 'terminal',
      status: 'completed',
    };

    const errorTerminalId = 'terminal_error';
    states[errorTerminalId] = {
      type: 'terminal',
      status: 'failed',
    };

    // Build states in reverse order (so we know next state when creating current)
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const task = this.tasks[i];
      const nextTaskId = i < this.tasks.length - 1 ? this.tasks[i + 1].id : terminalId;

      if (task.type === 'action') {
        states[task.id] = {
          type: 'action',
          action: task.action,
          parameters: task.parameters || {},
          timeout: task.timeout,
          retries: task.retries,
          onSuccess: nextTaskId,
          onError: task.optional
            ? nextTaskId // Continue if optional
            : this.errorStrategy === 'continue'
            ? nextTaskId
            : errorTerminalId,
        };
      } else if (task.type === 'decision') {
        states[task.id] = {
          type: 'decision',
          branches: task.branches.map((branch) => ({
            condition: branch.condition,
            target: branch.target || nextTaskId,
          })),
          defaultBranch: task.defaultBranch || 0,
        };
      } else if (task.type === 'wait') {
        states[task.id] = {
          type: 'wait',
          duration: task.duration,
          target: nextTaskId,
        };
      } else if (task.type === 'parallel') {
        const parallelJoinId = `${task.id}_join`;

        // Create parallel branches
        states[task.id] = {
          type: 'parallel',
          branches: task.branches.map((branch) => ({
            target: branch.action, // Will be resolved to action state
            action: branch.action,
            parameters: branch.parameters,
          })),
          joinState: parallelJoinId,
          timeout: task.timeout,
        };

        // Create join state
        states[parallelJoinId] = {
          type: 'action',
          action: 'internal:join',
          parameters: {},
          onSuccess: nextTaskId,
          onError: errorTerminalId,
        };
      }
    }

    const workflow = {
      id: `sequential_${Date.now()}`,
      name: this.name,
      description: this.description,
      tags: this.tags,
      initialState: this.tasks[0].id,
      states,
      metadata: {
        type: 'sequential',
        taskCount: this.tasks.length,
        createdAt: Date.now(),
        errorStrategy: this.errorStrategy,
      },
    };

    this.emit('built', workflow);
    return workflow;
  }

  /**
   * Build and register the workflow with FSM Executor
   */
  async register(fsmExecutor, workflowStorage) {
    const workflow = this.build();

    // Save to storage
    if (workflowStorage) {
      await workflowStorage.saveWorkflow(workflow);
      console.log(`[SequentialChain] Saved workflow: ${workflow.name} (${workflow.id})`);
    }

    // Register with executor
    if (fsmExecutor) {
      fsmExecutor.registerWorkflow(workflow);
      console.log(`[SequentialChain] Registered workflow: ${workflow.name}`);
    }

    this.emit('registered', { workflowId: workflow.id });
    return workflow;
  }

  /**
   * Execute the chain immediately
   */
  async execute(fsmExecutor, input = {}, context = {}) {
    const workflow = this.build();

    // Register temporarily
    fsmExecutor.registerWorkflow(workflow);

    // Execute
    const result = await fsmExecutor.executeWorkflow(workflow.id, input, context);

    this.emit('executed', result);
    return result;
  }

  /**
   * Create a workflow template for common patterns
   */
  static createTemplate(templateName, options = {}) {
    const chain = new SequentialChain({
      name: options.name || `${templateName}_workflow`,
      description: options.description || `Template: ${templateName}`,
      tags: ['template', templateName, ...(options.tags || [])],
    });

    switch (templateName) {
      case 'data-pipeline':
        // Extract → Transform → Load pattern
        chain
          .action('Extract Data', 'data:extract', options.extractParams || {})
          .action('Transform Data', 'data:transform', options.transformParams || {})
          .action('Load Data', 'data:load', options.loadParams || {})
          .action('Verify Load', 'data:verify', options.verifyParams || {}, { optional: true });
        break;

      case 'api-request':
        // Make API request with retry and validation
        chain
          .action('Prepare Request', 'http:prepare', options.prepareParams || {})
          .action('Make Request', 'http:request', options.requestParams || {})
          .wait('Rate Limit Delay', options.delay || 1000)
          .action('Validate Response', 'http:validate', options.validateParams || {});
        break;

      case 'ml-inference':
        // Load model → Preprocess → Inference → Postprocess
        chain
          .action('Load Model', 'ml:load_model', options.modelParams || {})
          .action('Preprocess Input', 'ml:preprocess', options.preprocessParams || {})
          .action('Run Inference', 'ml:inference', options.inferenceParams || {})
          .action('Postprocess Output', 'ml:postprocess', options.postprocessParams || {});
        break;

      case 'approval-workflow':
        // Request approval with timeout
        chain
          .action('Submit Request', 'approval:submit', options.submitParams || {})
          .wait('Await Approval', options.timeout || 300000) // 5 minutes
          .decision('Check Approval', [
            { condition: 'result.approved === true', target: 'approved_action' },
            { condition: 'result.approved === false', target: 'rejected_action' },
          ])
          .action('Handle Approval', 'approval:approved', options.approvedParams || {})
          .action('Handle Rejection', 'approval:rejected', options.rejectedParams || {});
        break;

      case 'file-processing':
        // Read → Process → Write pattern
        chain
          .action('Read File', 'file:read', options.readParams || {})
          .action('Process Content', 'file:process', options.processParams || {})
          .action('Write Output', 'file:write', options.writeParams || {})
          .action('Cleanup', 'file:cleanup', options.cleanupParams || {}, { optional: true });
        break;

      default:
        throw new Error(`Unknown template: ${templateName}`);
    }

    return chain;
  }

  /**
   * Clone this chain
   */
  clone(newName) {
    const cloned = new SequentialChain({
      name: newName || `${this.name}_copy`,
      description: this.description,
      errorStrategy: this.errorStrategy,
      retryAttempts: this.retryAttempts,
      tags: [...this.tags],
    });

    cloned.tasks = JSON.parse(JSON.stringify(this.tasks));
    return cloned;
  }

  /**
   * Get chain summary
   */
  summary() {
    return {
      name: this.name,
      description: this.description,
      taskCount: this.tasks.length,
      tasks: this.tasks.map((t) => ({
        id: t.id,
        type: t.type,
        name: t.name,
      })),
      errorStrategy: this.errorStrategy,
      tags: this.tags,
    };
  }

  /**
   * Export chain as JSON
   */
  toJSON() {
    return {
      name: this.name,
      description: this.description,
      tasks: this.tasks,
      errorStrategy: this.errorStrategy,
      retryAttempts: this.retryAttempts,
      tags: this.tags,
    };
  }

  /**
   * Import chain from JSON
   */
  static fromJSON(json) {
    const chain = new SequentialChain({
      name: json.name,
      description: json.description,
      errorStrategy: json.errorStrategy,
      retryAttempts: json.retryAttempts,
      tags: json.tags,
    });

    chain.tasks = json.tasks;
    return chain;
  }
}

export default SequentialChain;
