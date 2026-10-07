/**
 * Parallel Workflow Orchestrator - Manages multiple workflows running concurrently
 * Coordinates execution, handles barriers, fan-out/fan-in patterns
 *
 * Features:
 * - Run multiple workflows in parallel
 * - Synchronization barriers
 * - Result aggregation
 * - Fan-out/fan-in patterns
 * - Partial failure handling
 * - Progress tracking across all workflows
 */

import { EventEmitter } from 'events';

export class ParallelOrchestrator extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'ParallelOrchestrator';
    this.fsmExecutor = opts.fsmExecutor;
    this.activeExecutions = new Map(); // executionId -> execution data
    this.orchestrations = new Map(); // orchestrationId -> orchestration data
  }

  /**
   * Execute multiple workflows in parallel
   */
  async executeParallel(workflows, input = {}, options = {}) {
    const orchestrationId = `orchestration_${Date.now()}`;

    const orchestration = {
      id: orchestrationId,
      workflows: workflows.map((wf) => ({
        id: wf.id || wf.workflowId,
        name: wf.name,
        input: wf.input || input,
        context: wf.context || {},
      })),
      startTime: Date.now(),
      status: 'running',
      results: new Map(),
      errors: new Map(),
      strategy: options.strategy || 'all', // all, race, any
      timeout: options.timeout || 300000, // 5 minutes
      maxConcurrent: options.maxConcurrent || workflows.length,
    };

    this.orchestrations.set(orchestrationId, orchestration);
    this.emit('orchestration_started', { orchestrationId, workflowCount: workflows.length });

    try {
      let result;

      switch (orchestration.strategy) {
        case 'all':
          // Wait for all workflows to complete
          result = await this._executeAll(orchestration);
          break;

        case 'race':
          // Return first completed workflow
          result = await this._executeRace(orchestration);
          break;

        case 'any':
          // Return first successful workflow
          result = await this._executeAny(orchestration);
          break;

        case 'batch':
          // Execute in batches with concurrency limit
          result = await this._executeBatched(orchestration);
          break;

        default:
          throw new Error(`Unknown strategy: ${orchestration.strategy}`);
      }

      orchestration.status = 'completed';
      orchestration.endTime = Date.now();
      orchestration.duration = orchestration.endTime - orchestration.startTime;

      this.emit('orchestration_completed', {
        orchestrationId,
        duration: orchestration.duration,
        results: result,
      });

      return {
        success: true,
        orchestrationId,
        strategy: orchestration.strategy,
        results: result,
        duration: orchestration.duration,
      };
    } catch (error) {
      orchestration.status = 'failed';
      orchestration.error = error.message;
      orchestration.endTime = Date.now();

      this.emit('orchestration_failed', { orchestrationId, error: error.message });

      return {
        success: false,
        orchestrationId,
        error: error.message,
        partialResults: Array.from(orchestration.results.values()),
      };
    }
  }

  /**
   * Execute all workflows in parallel (Promise.all pattern)
   */
  async _executeAll(orchestration) {
    const promises = orchestration.workflows.map((wf, index) =>
      this._executeWorkflow(orchestration.id, wf, index).catch((error) => ({
        workflowId: wf.id,
        success: false,
        error: error.message,
      }))
    );

    const results = await Promise.all(promises);

    // Check for failures
    const failures = results.filter((r) => !r.success);
    if (failures.length > 0) {
      throw new Error(
        `${failures.length} workflow(s) failed: ${failures.map((f) => f.workflowId).join(', ')}`
      );
    }

    return results;
  }

  /**
   * Execute workflows and return first to complete (Promise.race pattern)
   */
  async _executeRace(orchestration) {
    const promises = orchestration.workflows.map((wf, index) =>
      this._executeWorkflow(orchestration.id, wf, index)
    );

    return await Promise.race(promises);
  }

  /**
   * Execute workflows and return first successful result
   */
  async _executeAny(orchestration) {
    const promises = orchestration.workflows.map((wf, index) =>
      this._executeWorkflow(orchestration.id, wf, index).catch((error) => null)
    );

    const results = await Promise.all(promises);
    const successful = results.find((r) => r && r.success);

    if (!successful) {
      throw new Error('All workflows failed');
    }

    return successful;
  }

  /**
   * Execute workflows in batches with concurrency limit
   */
  async _executeBatched(orchestration) {
    const results = [];
    const batches = [];

    // Split into batches
    for (let i = 0; i < orchestration.workflows.length; i += orchestration.maxConcurrent) {
      batches.push(orchestration.workflows.slice(i, i + orchestration.maxConcurrent));
    }

    // Execute batches sequentially
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      this.emit('batch_started', {
        orchestrationId: orchestration.id,
        batchIndex,
        batchSize: batch.length,
      });

      const batchPromises = batch.map((wf, index) =>
        this._executeWorkflow(orchestration.id, wf, batchIndex * orchestration.maxConcurrent + index)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      this.emit('batch_completed', {
        orchestrationId: orchestration.id,
        batchIndex,
        batchSize: batch.length,
      });
    }

    return results;
  }

  /**
   * Execute a single workflow
   */
  async _executeWorkflow(orchestrationId, workflow, index) {
    const executionId = `exec_${orchestrationId}_${index}`;

    this.emit('workflow_started', {
      orchestrationId,
      workflowId: workflow.id,
      executionId,
      index,
    });

    try {
      const startTime = Date.now();

      const result = await this.fsmExecutor.executeWorkflow(
        workflow.id,
        workflow.input,
        workflow.context
      );

      const duration = Date.now() - startTime;

      const executionResult = {
        workflowId: workflow.id,
        workflowName: workflow.name,
        executionId,
        success: result.success,
        output: result.output,
        duration,
        finalState: result.finalState,
      };

      // Store result
      const orchestration = this.orchestrations.get(orchestrationId);
      if (orchestration) {
        orchestration.results.set(workflow.id, executionResult);
      }

      this.emit('workflow_completed', {
        orchestrationId,
        workflowId: workflow.id,
        executionId,
        duration,
      });

      return executionResult;
    } catch (error) {
      const orchestration = this.orchestrations.get(orchestrationId);
      if (orchestration) {
        orchestration.errors.set(workflow.id, error.message);
      }

      this.emit('workflow_failed', {
        orchestrationId,
        workflowId: workflow.id,
        executionId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Create a fan-out/fan-in pattern
   * Split input into multiple tasks, process in parallel, then aggregate results
   */
  async fanOut(workflowId, inputs, options = {}) {
    const orchestrationId = `fanout_${Date.now()}`;

    const workflows = inputs.map((input, index) => ({
      id: workflowId,
      name: `${workflowId}_${index}`,
      input,
      context: { fanOutIndex: index },
    }));

    const result = await this.executeParallel(workflows, {}, {
      ...options,
      strategy: options.strategy || 'all',
    });

    // Aggregate results
    if (options.aggregator) {
      const aggregated = options.aggregator(result.results);
      result.aggregatedOutput = aggregated;
    }

    return result;
  }

  /**
   * Create a map-reduce pattern
   */
  async mapReduce(workflowId, inputs, reduceFn, options = {}) {
    // Map phase - fan out
    const mapResult = await this.fanOut(workflowId, inputs, options);

    if (!mapResult.success) {
      throw new Error('Map phase failed');
    }

    // Reduce phase - aggregate results
    const outputs = mapResult.results.map((r) => r.output);
    const reduced = reduceFn(outputs);

    return {
      success: true,
      orchestrationId: mapResult.orchestrationId,
      mapResults: mapResult.results,
      reducedOutput: reduced,
      duration: mapResult.duration,
    };
  }

  /**
   * Create a barrier - wait for all workflows to reach a specific state
   */
  async barrier(workflowIds, barrierState, options = {}) {
    const barrierId = `barrier_${Date.now()}`;
    const timeout = options.timeout || 60000;

    this.emit('barrier_created', { barrierId, workflowIds, barrierState });

    const startTime = Date.now();
    const arrivals = new Set();

    return new Promise((resolve, reject) => {
      const checkTimeout = setTimeout(() => {
        reject(
          new Error(`Barrier timeout: ${arrivals.size}/${workflowIds.length} workflows arrived`)
        );
      }, timeout);

      const stateListener = (event) => {
        if (workflowIds.includes(event.workflowId) && event.currentState === barrierState) {
          arrivals.add(event.workflowId);

          this.emit('barrier_arrival', {
            barrierId,
            workflowId: event.workflowId,
            arrivals: arrivals.size,
            total: workflowIds.length,
          });

          if (arrivals.size === workflowIds.length) {
            clearTimeout(checkTimeout);
            this.fsmExecutor.off('state_changed', stateListener);

            const duration = Date.now() - startTime;

            this.emit('barrier_released', { barrierId, duration });

            resolve({
              success: true,
              barrierId,
              arrivals: Array.from(arrivals),
              duration,
            });
          }
        }
      };

      this.fsmExecutor.on('state_changed', stateListener);
    });
  }

  /**
   * Pipeline pattern - execute workflows in sequence, passing output to next
   */
  async pipeline(workflowIds, input = {}, options = {}) {
    const pipelineId = `pipeline_${Date.now()}`;

    this.emit('pipeline_started', { pipelineId, stages: workflowIds.length });

    let currentInput = input;
    const results = [];

    for (let i = 0; i < workflowIds.length; i++) {
      const workflowId = workflowIds[i];

      this.emit('pipeline_stage_started', { pipelineId, stage: i, workflowId });

      const result = await this.fsmExecutor.executeWorkflow(workflowId, currentInput, {
        pipelineStage: i,
        pipelineId,
      });

      if (!result.success) {
        throw new Error(`Pipeline stage ${i} (${workflowId}) failed: ${result.error}`);
      }

      results.push(result);
      currentInput = result.output; // Pass output to next stage

      this.emit('pipeline_stage_completed', { pipelineId, stage: i, workflowId });
    }

    this.emit('pipeline_completed', { pipelineId, stages: workflowIds.length });

    return {
      success: true,
      pipelineId,
      stages: results,
      finalOutput: currentInput,
    };
  }

  /**
   * Get orchestration status
   */
  getOrchestrationStatus(orchestrationId) {
    const orchestration = this.orchestrations.get(orchestrationId);

    if (!orchestration) {
      return null;
    }

    return {
      id: orchestration.id,
      status: orchestration.status,
      startTime: orchestration.startTime,
      endTime: orchestration.endTime,
      duration: orchestration.duration,
      workflowCount: orchestration.workflows.length,
      completedCount: orchestration.results.size,
      errorCount: orchestration.errors.size,
      strategy: orchestration.strategy,
    };
  }

  /**
   * Cancel an orchestration
   */
  async cancelOrchestration(orchestrationId) {
    const orchestration = this.orchestrations.get(orchestrationId);

    if (!orchestration) {
      throw new Error(`Orchestration not found: ${orchestrationId}`);
    }

    orchestration.status = 'cancelled';
    orchestration.endTime = Date.now();

    this.emit('orchestration_cancelled', { orchestrationId });

    // TODO: Cancel individual workflow executions

    return { success: true, orchestrationId };
  }

  /**
   * Get all active orchestrations
   */
  getActiveOrchestrations() {
    return Array.from(this.orchestrations.values()).filter(
      (o) => o.status === 'running'
    );
  }

  /**
   * Clean up old orchestrations
   */
  cleanup(maxAge = 3600000) {
    const now = Date.now();
    let cleaned = 0;

    for (const [id, orchestration] of this.orchestrations.entries()) {
      if (orchestration.status !== 'running' && now - orchestration.startTime > maxAge) {
        this.orchestrations.delete(id);
        cleaned++;
      }
    }

    console.log(`[${this.name}] Cleaned up ${cleaned} old orchestrations`);
    return cleaned;
  }
}

/**
 * Helper functions for creating parallel workflows
 */

/**
 * Create a data processing pipeline
 */
export function createDataPipeline(stages, options = {}) {
  return {
    type: 'pipeline',
    name: options.name || 'data_pipeline',
    stages: stages.map((stage) => ({
      workflowId: stage.workflowId,
      name: stage.name,
      transform: stage.transform, // Optional data transformation
    })),
    ...options,
  };
}

/**
 * Create a scatter-gather pattern
 */
export function createScatterGather(workflowId, inputs, aggregator, options = {}) {
  return {
    type: 'scatter-gather',
    name: options.name || 'scatter_gather',
    workflowId,
    inputs,
    aggregator,
    strategy: 'all',
    ...options,
  };
}

/**
 * Create a competitive execution (first wins)
 */
export function createCompetition(workflowIds, input, options = {}) {
  return {
    type: 'competition',
    name: options.name || 'competition',
    workflows: workflowIds.map((id) => ({ id, input })),
    strategy: 'race',
    ...options,
  };
}

export default ParallelOrchestrator;
