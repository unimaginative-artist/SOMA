// arbiteriumService.ts
// Handles communication with SOMA backend for Arbiterium orchestration

import { WorkflowStep, WorkflowPlan, TaskStatus } from '../types';

const API_BASE = '';

/**
 * Send a natural language goal to SOMA and get back an orchestrated workflow plan
 */
export async function orchestrateGoal(goal: string, deepThinking = false): Promise<WorkflowPlan> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/orchestrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal, deepThinking })
    });

    if (!response.ok) {
      const errorData = await response.json();
      
      // If there's a fallback plan, use it
      if (errorData.fallbackPlan) {
        console.warn('Using fallback plan due to orchestration error');
        return errorData.fallbackPlan;
      }
      
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const data = await response.json();
    
    // Check if capability expansion is needed
    if (!data.success && data.requiresApproval && data.proposal) {
      throw new Error(`CAPABILITY_MISSING:${JSON.stringify(data.proposal)}`);
    }
    
    if (!data.success || !data.plan) {
      throw new Error('Invalid response from orchestration service');
    }

    // Surface backend warnings so they appear in the UI summary
    if (data.warnings && data.warnings.length > 0) {
      data.plan.warnings = data.warnings;
    }

    return data.plan;
  } catch (error) {
    console.error('[Arbiterium Service] Orchestration failed:', error);
    
    // Return a minimal fallback plan
    return {
      goal,
      summary: 'Error occurred during planning. Using basic execution plan.',
      createdAt: Date.now(),
      steps: [
        {
          id: 'step-1',
          description: `Process request: "${goal}"`,
          assignedArbiterRole: 'general',
          dependencies: [],
          status: TaskStatus.PENDING,
          logs: [`Error: ${error instanceof Error ? error.message : 'Unknown error'}`]
        }
      ]
    };
  }
}

/**
 * Execute a specific step in the workflow
 */
export async function executeStep(
  stepId: string,
  description: string,
  arbiterRole: string,
  context: Record<string, any> = {},
  tools: string[] = []
): Promise<{ success: boolean; output: string; status: string; toolsUsed?: any[] }> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/execute-step`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId, description, arbiterRole, context, tools })
    });

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error(`[Arbiterium Service] Expected JSON but got ${contentType}:`, text.substring(0, 200));
      return {
        success: false,
        output: `API endpoint not available (returned ${response.status}). Please check if the Arbiterium backend is running.`,
        status: 'failed'
      };
    }

    const data = await response.json();
    
    if (!data.success) {
      return {
        success: false,
        output: `Error: ${data.error || 'Unknown error'}`,
        status: 'failed'
      };
    }

    return {
      success: true,
      output: data.output,
      status: data.status,
      toolsUsed: data.metadata?.toolsUsed || []
    };
  } catch (error) {
    console.error(`[Arbiterium Service] Step ${stepId} execution failed:`, error);
    return {
      success: false,
      output: `Execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      status: 'failed'
    };
  }
}

// ═══════════════════════════════════════════
// SESSION PERSISTENCE
// ═══════════════════════════════════════════

export interface SavedSessionSummary {
  id: string;
  title: string;
  lastActive: number;
  messageCount: number;
  hasPlan: boolean;
  stepCount: number;
}

/**
 * List all saved sessions (summaries only)
 */
export async function loadSessions(): Promise<SavedSessionSummary[]> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/sessions`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.sessions || [];
  } catch (error) {
    console.warn('[Arbiterium Service] Failed to load sessions:', error);
    return [];
  }
}

/**
 * Load a specific session by ID (full data)
 */
export async function loadSession(id: string): Promise<any | null> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/sessions/${id}`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.session || null;
  } catch (error) {
    console.warn('[Arbiterium Service] Failed to load session:', error);
    return null;
  }
}

/**
 * Save a session to the backend
 */
export async function saveSession(session: any): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/sessions/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session })
    });
    return response.ok;
  } catch (error) {
    console.warn('[Arbiterium Service] Failed to save session:', error);
    return false;
  }
}

/**
 * Delete a saved session
 */
export async function deleteSession(id: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/sessions/${id}`, {
      method: 'DELETE'
    });
    return response.ok;
  } catch (error) {
    console.warn('[Arbiterium Service] Failed to delete session:', error);
    return false;
  }
}

/**
 * Notify backend that a workflow completed (triggers memory formation)
 */
export async function notifyWorkflowComplete(plan: WorkflowPlan): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/arbiterium/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
  } catch (error) {
    console.warn('[Arbiterium Service] Workflow memory notification failed:', error);
  }
}

/**
 * Fetch available tools from the backend tool registry
 */
export async function fetchAvailableTools(): Promise<Array<{ name: string; description: string; category?: string }>> {
  try {
    const response = await fetch(`${API_BASE}/api/arbiterium/tools`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.tools || [];
  } catch (error) {
    console.warn('[Arbiterium Service] Failed to fetch tools:', error);
    return [];
  }
}

/**
 * Execute a workflow plan step-by-step, respecting dependencies
 */
export async function executeWorkflow(
  plan: WorkflowPlan,
  onStepStart?: (step: WorkflowStep) => void,
  onStepComplete?: (step: WorkflowStep, output: string, toolsUsed?: any[]) => void,
  onStepFailed?: (step: WorkflowStep, error: string) => void
): Promise<{ success: boolean; results: Map<string, string> }> {
  const results = new Map<string, string>();
  const completedSteps = new Set<string>();

  // Helper to check if all dependencies are completed
  const canExecuteStep = (step: WorkflowStep): boolean => {
    return step.dependencies.every(dep => {
      // Support both string IDs and numeric indices
      const depId = typeof dep === 'number' ? `step-${dep + 1}` : dep;
      return completedSteps.has(depId);
    });
  };

  const STEP_DEPENDENCY_TIMEOUT_MS = 30_000; // 30s max wait for any dependency

  // Execute steps in order, respecting dependencies
  for (const step of plan.steps) {
    // Wait for dependencies — with timeout to prevent infinite deadlock
    const depWaitStart = Date.now();
    while (!canExecuteStep(step)) {
      if (Date.now() - depWaitStart > STEP_DEPENDENCY_TIMEOUT_MS) {
        const unmet = step.dependencies.filter(dep => {
          const depId = typeof dep === 'number' ? `step-${dep + 1}` : dep;
          return !completedSteps.has(depId);
        });
        if (onStepFailed) onStepFailed(step, `Dependency timeout: steps [${unmet.join(', ')}] never completed`);
        results.set(step.id, `FAILED: dependency timeout`);
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (results.has(step.id)) continue; // was timed out above

    // Notify step start
    if (onStepStart) {
      onStepStart(step);
    }

    // Execute step
    const context = {
      previousResults: Object.fromEntries(results),
      goal: plan.goal
    };

    const result = await executeStep(
      step.id,
      step.description,
      step.assignedArbiterRole,
      context,
      step.tools || []
    );

    if (result.success) {
      results.set(step.id, result.output);
      completedSteps.add(step.id);
      
      if (onStepComplete) {
        onStepComplete(step, result.output, result.toolsUsed);
      }
    } else {
      if (onStepFailed) {
        onStepFailed(step, result.output);
      }
      
      // Decide whether to continue or abort
      // For now, we'll continue with other steps
      results.set(step.id, `FAILED: ${result.output}`);
    }
  }

  return {
    success: completedSteps.size === plan.steps.length,
    results
  };
}
