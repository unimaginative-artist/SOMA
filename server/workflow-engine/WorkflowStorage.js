/**
 * Workflow Storage - Persistence layer for workflows and executions
 * AUTOGEN Integration: Store workflow templates, executions, and history
 *
 * Features:
 * - Save/load workflow definitions
 * - Store execution history
 * - Search workflows by tags/category
 * - Version control for workflows
 * - Export/import workflows
 */

import { promises as fs } from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

export class WorkflowStorage extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'WorkflowStorage';
    this.storageDir = opts.storageDir || path.join(process.cwd(), 'SOMA', 'workflows');
    this.executionHistoryDir = path.join(this.storageDir, 'executions');
    this.maxHistoryAge = opts.maxHistoryAge || 30 * 24 * 60 * 60 * 1000; // 30 days

    this.workflows = new Map(); // In-memory cache
    this.tags = new Map(); // tag -> Set of workflow IDs
  }

  /**
   * Initialize storage
   */
  async initialize() {
    try {
      console.log(`[${this.name}] Initializing workflow storage...`);

      // Create directories
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.mkdir(this.executionHistoryDir, { recursive: true });

      // Load workflows into cache
      await this.loadAll();

      console.log(`[${this.name}] ✅ Initialized with ${this.workflows.size} workflows`);
      this.emit('initialized');
    } catch (error) {
      console.error(`[${this.name}] ❌ Initialization failed:`, error.message);
      throw error;
    }
  }

  /**
   * Save a workflow
   */
  async saveWorkflow(workflow) {
    try {
      // Add/update metadata
      const workflowWithMeta = {
        ...workflow,
        savedAt: Date.now(),
        version: workflow.version || '1.0.0'
      };

      // Save to disk
      const filePath = this.getWorkflowPath(workflow.id);
      await fs.writeFile(filePath, JSON.stringify(workflowWithMeta, null, 2));

      // Update cache
      this.workflows.set(workflow.id, workflowWithMeta);

      // Index tags
      if (workflow.tags) {
        workflow.tags.forEach(tag => {
          if (!this.tags.has(tag)) {
            this.tags.set(tag, new Set());
          }
          this.tags.get(tag).add(workflow.id);
        });
      }

      console.log(`[${this.name}] ✅ Saved workflow: ${workflow.name} (${workflow.id})`);
      this.emit('workflow_saved', { workflowId: workflow.id, name: workflow.name });

      return workflowWithMeta;
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to save workflow:`, error.message);
      throw error;
    }
  }

  /**
   * Load a workflow by ID
   */
  async loadWorkflow(workflowId) {
    try {
      // Check cache first
      if (this.workflows.has(workflowId)) {
        return this.workflows.get(workflowId);
      }

      // Load from disk
      const filePath = this.getWorkflowPath(workflowId);
      const content = await fs.readFile(filePath, 'utf8');
      const workflow = JSON.parse(content);

      // Update cache
      this.workflows.set(workflowId, workflow);

      return workflow;
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Workflow not found: ${workflowId}`);
      }
      throw error;
    }
  }

  /**
   * Load all workflows
   */
  async loadAll() {
    try {
      const files = await fs.readdir(this.storageDir);
      const workflowFiles = files.filter(f => f.startsWith('workflow_') && f.endsWith('.json'));

      for (const file of workflowFiles) {
        try {
          const filePath = path.join(this.storageDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const workflow = JSON.parse(content);

          this.workflows.set(workflow.id, workflow);

          // Index tags
          if (workflow.tags) {
            workflow.tags.forEach(tag => {
              if (!this.tags.has(tag)) {
                this.tags.set(tag, new Set());
              }
              this.tags.get(tag).add(workflow.id);
            });
          }
        } catch (error) {
          console.warn(`[${this.name}] Failed to load workflow ${file}:`, error.message);
        }
      }

      console.log(`[${this.name}] Loaded ${this.workflows.size} workflows`);
    } catch (error) {
      // Directory doesn't exist yet
    }
  }

  /**
   * Delete a workflow
   */
  async deleteWorkflow(workflowId) {
    try {
      const filePath = this.getWorkflowPath(workflowId);
      await fs.unlink(filePath);

      // Remove from cache
      const workflow = this.workflows.get(workflowId);
      this.workflows.delete(workflowId);

      // Remove from tag index
      if (workflow && workflow.tags) {
        workflow.tags.forEach(tag => {
          if (this.tags.has(tag)) {
            this.tags.get(tag).delete(workflowId);
            if (this.tags.get(tag).size === 0) {
              this.tags.delete(tag);
            }
          }
        });
      }

      console.log(`[${this.name}] ✅ Deleted workflow: ${workflowId}`);
      this.emit('workflow_deleted', { workflowId });
    } catch (error) {
      console.error(`[${this.name}] ❌ Failed to delete workflow:`, error.message);
      throw error;
    }
  }

  /**
   * Search workflows
   */
  searchWorkflows(query) {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const workflow of this.workflows.values()) {
      // Search in name, description, tags
      const matchesName = workflow.name?.toLowerCase().includes(queryLower);
      const matchesDescription = workflow.description?.toLowerCase().includes(queryLower);
      const matchesTags = workflow.tags?.some(tag => tag.toLowerCase().includes(queryLower));

      if (matchesName || matchesDescription || matchesTags) {
        results.push(workflow);
      }
    }

    return results;
  }

  /**
   * Get workflows by tag
   */
  getWorkflowsByTag(tag) {
    const workflowIds = this.tags.get(tag) || new Set();
    return Array.from(workflowIds)
      .map(id => this.workflows.get(id))
      .filter(Boolean);
  }

  /**
   * Get all workflows
   */
  getAllWorkflows() {
    return Array.from(this.workflows.values());
  }

  /**
   * Save execution history
   */
  async saveExecution(execution) {
    try {
      const fileName = `execution_${execution.id}.json`;
      const filePath = path.join(this.executionHistoryDir, fileName);

      await fs.writeFile(filePath, JSON.stringify(execution, null, 2));

      this.emit('execution_saved', { executionId: execution.id, workflowId: execution.workflowId });
    } catch (error) {
      console.error(`[${this.name}] Failed to save execution:`, error.message);
    }
  }

  /**
   * Load execution by ID
   */
  async loadExecution(executionId) {
    try {
      const fileName = `execution_${executionId}.json`;
      const filePath = path.join(this.executionHistoryDir, fileName);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get executions for a workflow
   */
  async getExecutionsForWorkflow(workflowId, limit = 50) {
    try {
      const files = await fs.readdir(this.executionHistoryDir);
      const executionFiles = files.filter(f => f.startsWith('execution_') && f.endsWith('.json'));

      const executions = [];

      for (const file of executionFiles) {
        try {
          const filePath = path.join(this.executionHistoryDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const execution = JSON.parse(content);

          if (execution.workflowId === workflowId) {
            executions.push(execution);
          }

          if (executions.length >= limit) {
            break;
          }
        } catch (error) {
          // Skip corrupted files
        }
      }

      // Sort by most recent first
      executions.sort((a, b) => b.startTime - a.startTime);

      return executions;
    } catch (error) {
      return [];
    }
  }

  /**
   * Cleanup old execution history
   */
  async cleanupOldExecutions() {
    try {
      const files = await fs.readdir(this.executionHistoryDir);
      const executionFiles = files.filter(f => f.startsWith('execution_') && f.endsWith('.json'));

      const now = Date.now();
      let deletedCount = 0;

      for (const file of executionFiles) {
        try {
          const filePath = path.join(this.executionHistoryDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const execution = JSON.parse(content);

          // Delete if older than maxHistoryAge
          if (now - execution.startTime > this.maxHistoryAge) {
            await fs.unlink(filePath);
            deletedCount++;
          }
        } catch (error) {
          // Skip errors
        }
      }

      if (deletedCount > 0) {
        console.log(`[${this.name}] Cleaned up ${deletedCount} old executions`);
      }
    } catch (error) {
      console.error(`[${this.name}] Cleanup failed:`, error.message);
    }
  }

  /**
   * Export workflow as JSON
   */
  async exportWorkflow(workflowId) {
    const workflow = await this.loadWorkflow(workflowId);
    return JSON.stringify(workflow, null, 2);
  }

  /**
   * Import workflow from JSON
   */
  async importWorkflow(workflowJson) {
    const workflow = typeof workflowJson === 'string' ? JSON.parse(workflowJson) : workflowJson;

    // Generate new ID to avoid conflicts
    const originalId = workflow.id;
    workflow.id = this.generateId();

    console.log(`[${this.name}] Importing workflow: ${workflow.name} (${originalId} → ${workflow.id})`);

    return await this.saveWorkflow(workflow);
  }

  /**
   * Duplicate a workflow
   */
  async duplicateWorkflow(workflowId, newName) {
    const original = await this.loadWorkflow(workflowId);
    const duplicate = {
      ...original,
      id: this.generateId(),
      name: newName || `${original.name} (Copy)`,
      createdAt: Date.now(),
      version: '1.0.0'
    };

    return await this.saveWorkflow(duplicate);
  }

  /**
   * Get workflow statistics
   */
  async getWorkflowStats(workflowId) {
    const executions = await this.getExecutionsForWorkflow(workflowId);

    if (executions.length === 0) {
      return {
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        avgDuration: 0
      };
    }

    const successful = executions.filter(e => e.status === 'completed');
    const failed = executions.filter(e => e.status === 'failed');

    const avgDuration = executions.reduce((sum, e) => sum + (e.duration || 0), 0) / executions.length;

    return {
      totalExecutions: executions.length,
      successfulExecutions: successful.length,
      failedExecutions: failed.length,
      avgDuration: Math.round(avgDuration),
      lastExecution: executions[0]?.startTime,
      successRate: (successful.length / executions.length * 100).toFixed(1) + '%'
    };
  }

  /**
   * Get all tags
   */
  getAllTags() {
    return Array.from(this.tags.keys());
  }

  /**
   * Helper: Get workflow file path
   */
  getWorkflowPath(workflowId) {
    return path.join(this.storageDir, `workflow_${workflowId}.json`);
  }

  /**
   * Helper: Generate unique ID
   */
  generateId() {
    return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

export default WorkflowStorage;
