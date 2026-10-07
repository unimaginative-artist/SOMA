// WorkflowAgent.cjs
// Chains multiple MicroAgents into autonomous workflows

const { BaseMicroAgent } = require('./BaseMicroAgent.cjs');

class WorkflowAgent extends BaseMicroAgent {
  constructor(config = {}) {
    super({ ...config, type: 'workflow' });
    
    this.pool = config.pool || null; // Reference to MicroAgentPool
  }
  
  /**
   * Execute workflow
   * Task format:
   * {
   *   workflow: [
   *     { agent: 'fetch', task: {...} },
   *     { agent: 'transform', task: {...}, input: 'previous' },
   *     { agent: 'analyze', task: {...}, input: 'step[0]' }
   *   ],
   *   onError: 'stop' | 'continue' | 'retry'
   * }
   */
  async execute(task) {
    const { workflow, onError = 'stop' } = task;
    
    if (!workflow || !Array.isArray(workflow)) {
      throw new Error('Workflow requires workflow array');
    }
    
    if (!this.pool) {
      throw new Error('WorkflowAgent requires pool reference');
    }
    
    this.logger.info(`[WorkflowAgent:${this.id}] Executing ${workflow.length}-step workflow`);
    
    const results = [];
    const startTime = Date.now();
    
    for (let i = 0; i < workflow.length; i++) {
      const step = workflow[i];
      const { agent, task: stepTask, input, condition } = step;
      
      this.logger.info(`[WorkflowAgent:${this.id}] Step ${i + 1}/${workflow.length}: ${agent}`);
      
      try {
        // Check condition
        if (condition && !this._evaluateCondition(condition, results)) {
          this.logger.info(`[WorkflowAgent:${this.id}] Step ${i + 1} skipped (condition not met)`);
          results.push({ 
            step: i, 
            skipped: true, 
            reason: 'condition_not_met' 
          });
          continue;
        }
        
        // Prepare task with input from previous steps
        const preparedTask = this._prepareTask(stepTask, input, results);
        
        // Execute step
        const stepResult = await this.pool.executeTask(
          agent, 
          preparedTask,
          { autoTerminate: true }
        );
        
        results.push({
          step: i,
          agent,
          success: stepResult.success,
          result: stepResult.result,
          executionTime: stepResult.executionTime || 0
        });
        
      } catch (err) {
        this.logger.error(`[WorkflowAgent:${this.id}] Step ${i + 1} failed: ${err.message}`);
        
        results.push({
          step: i,
          agent,
          success: false,
          error: err.message
        });
        
        // Handle error
        if (onError === 'stop') {
          throw new Error(`Workflow failed at step ${i + 1}: ${err.message}`);
        } else if (onError === 'retry' && step.retries) {
          const retries = step.retries || 1;
          for (let r = 0; r < retries; r++) {
            this.logger.info(`[WorkflowAgent:${this.id}] Retry ${r + 1}/${retries}`);
            try {
              const preparedTask = this._prepareTask(stepTask, input, results);
              const retryResult = await this.pool.executeTask(agent, preparedTask, { autoTerminate: true });
              
              results[results.length - 1] = {
                step: i,
                agent,
                success: true,
                result: retryResult.result,
                retries: r + 1
              };
              break;
            } catch (retryErr) {
              if (r === retries - 1) {
                throw retryErr;
              }
            }
          }
        }
        // onError === 'continue' just keeps going
      }
    }
    
    const totalTime = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    
    return {
      workflow: 'completed',
      steps: workflow.length,
      successCount,
      failedCount: workflow.length - successCount,
      totalTime,
      results
    };
  }
  
  _prepareTask(stepTask, input, results) {
    if (!input) {
      return stepTask;
    }
    
    let inputData;
    
    if (input === 'previous' && results.length > 0) {
      // Use output from previous step
      const prev = results[results.length - 1];
      inputData = prev.success ? prev.result : null;
    } else if (typeof input === 'string' && input.startsWith('step[')) {
      // Use output from specific step (e.g., 'step[0]')
      const match = input.match(/step\[(\d+)\]/);
      if (match) {
        const stepIndex = parseInt(match[1]);
        if (stepIndex < results.length) {
          const step = results[stepIndex];
          inputData = step.success ? step.result : null;
        }
      }
    }
    
    // Merge input data into task
    if (inputData) {
      return {
        ...stepTask,
        data: inputData.result || inputData.data || inputData
      };
    }
    
    return stepTask;
  }
  
  _evaluateCondition(condition, results) {
    const { type, step, operator, value } = condition;
    
    if (type === 'step_success') {
      if (step >= results.length) return false;
      return results[step].success;
    }
    
    if (type === 'step_result') {
      if (step >= results.length) return false;
      const stepResult = results[step];
      if (!stepResult.success) return false;
      
      const actual = stepResult.result;
      
      switch (operator) {
        case '===': return actual === value;
        case '!==': return actual !== value;
        case '>': return actual > value;
        case '<': return actual < value;
        case '>=': return actual >= value;
        case '<=': return actual <= value;
        case 'includes': return JSON.stringify(actual).includes(value);
        default: return false;
      }
    }
    
    return true;
  }
}

module.exports = { WorkflowAgent };
