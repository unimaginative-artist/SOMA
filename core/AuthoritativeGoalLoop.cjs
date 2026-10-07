'use strict';

const { STATUS, isTerminal } = require('./GoalLifecycle.cjs');

function lifecycleFor(goal, execResult, verification, completion) {
  if (goal?.status === STATUS.COMPLETED || completion?.success) return 'completed';
  if (isTerminal(goal?.status)) return goal.status;
  if (execResult?.done && verification?.verified !== true) return 'awaiting_evidence';
  if (execResult?.needsContinuation) return 'continuing';
  return 'executing';
}

/**
 * The single settlement authority for agentic goals.
 *
 * Selection and tool execution remain owned by AutonomousHeartbeat and
 * SomaAgenticExecutor. Everything after execution flows through this class:
 * measure -> observe action -> verify -> persist receipts -> learn -> finish.
 */
class AuthoritativeGoalLoop {
  constructor(system, { logger = console, now = () => Date.now() } = {}) {
    this.system = system;
    this.logger = logger;
    this.now = now;
    this._active = new Set();
  }

  measure(goal = {}) {
    return {
      measuredAt: this.now(),
      status: goal.status || null,
      progress: Number(goal.metrics?.progress || 0),
      executionAttempts: Number(goal.metadata?.executionAttempts || 0),
      reliability: this.system?.autonomyReliability?.dashboard?.().metrics || null
    };
  }

  async run(goal, hooks = {}) {
    if (!goal?.id) throw new TypeError('AuthoritativeGoalLoop requires a goal with an id');
    if (this._active.has(goal.id)) {
      return {
        handled: true,
        ok: false,
        state: 'execution_already_active',
        progress: Number(goal.metrics?.progress || 0),
        complete: false,
        execResult: { done: false, needsContinuation: true, iterations: 0, toolsUsed: [], observations: [], result: 'Goal execution is already active.' }
      };
    }

    this._active.add(goal.id);
    const measurement = this.measure(goal);
    let execResult;
    let executionReceipt = null;
    let completionVerification = null;
    let completion = null;
    let progress = measurement.progress;
    let autopsy = null;

    try {
      try {
        execResult = await hooks.execute();
      } catch (error) {
        execResult = {
          done: false,
          state: 'execution_error',
          stopReason: error.message,
          result: `Execution failed: ${error.message}`,
          iterations: 0,
          toolsUsed: [],
          observations: [],
          needsContinuation: true,
          error: error.message
        };
        autopsy = await hooks.writeAutopsy?.(goal, {
          phase: 'execution_error', reason: error.message, execResult
        }).catch(() => null);
        const budget = this.system?.goalPlanner?.getExecutionAttemptBudget?.(goal);
        const target = budget?.exhausted ? STATUS.BLOCKED : STATUS.PENDING;
        this.system?.goalPlanner?.transitionGoal?.(goal.id, target, {
          reason: budget?.exhausted ? 'execution_error_budget_exhausted' : 'execution_error_retry',
          actor: 'AuthoritativeGoalLoop', persist: true
        });
      }

      executionReceipt = await hooks.writeReceipt(goal, execResult, {
        lifecycleState: execResult.done ? 'awaiting_verification' : lifecycleFor(goal, execResult)
      });
      goal.metadata = { ...(goal.metadata || {}), latestExecutionReceipt: executionReceipt.path };

      if (execResult.done) {
        completionVerification = await hooks.verify(goal, execResult);
        if (!completionVerification.verified) {
          const failed = (completionVerification.checks || [])
            .filter(check => !check.passed)
            .map(check => check.check)
            .join(', ') || 'completion evidence';
          progress = Math.min(75, Math.max(measurement.progress, Number(execResult.evidenceProgress?.progress || 0)));
          autopsy ||= await hooks.writeAutopsy?.(goal, {
            phase: 'verification_failed', reason: failed, verification: completionVerification, execResult
          }).catch(() => null);
          if (autopsy) {
            goal.metadata = {
              ...(goal.metadata || {}), latestAutopsy: autopsy.path,
              autopsyNextStrategy: autopsy.nextStrategy,
              autopsyCount: Number(goal.metadata?.autopsyCount || 0) + 1
            };
          }
        } else {
          progress = 100;
        }
      } else {
        progress = Math.max(measurement.progress, Number(execResult.evidenceProgress?.progress || 0));
      }

      await this.system?.goalPlanner?.updateGoalProgress?.(goal.id, progress === 100 ? 99 : progress, {
        note: `Authoritative loop: ${execResult.result || 'Partial progress'}`,
        evidence: (execResult.toolsUsed || []).join(', ') || 'reasoning',
        lastVerification: completionVerification || undefined,
        latestAutopsy: goal.metadata?.latestAutopsy || undefined,
        autopsyNextStrategy: goal.metadata?.autopsyNextStrategy || undefined,
        latestExecutionReceipt: executionReceipt.path,
        progressSource: 'verified_evidence',
        evidenceProgress: execResult.evidenceProgress || { progress }
      }).catch(() => {});

      if (progress === 100) {
        // Persist pre-commit evidence before GoalPlanner broadcasts completion;
        // terminal observers therefore never see an evidence-less success.
        executionReceipt = await hooks.writeReceipt(goal, execResult, {
          lifecycleState: 'awaiting_goalplanner_verification',
          verification: completionVerification
        });
        goal.metadata = { ...(goal.metadata || {}), latestExecutionReceipt: executionReceipt.path };
        completion = await this.system?.goalPlanner?.completeGoal?.(goal.id, {
          result: execResult.result || 'Goal verified and completed.',
          verification: completionVerification?.goalVerification || undefined,
          evidence: completionVerification?.evidence || undefined,
          summary: execResult.result || 'Goal verified and completed.'
        }).catch(error => ({ success: false, error: error.message }));
        if (!completion?.success) progress = Math.min(75, Number(goal.metrics?.progress || 75));
        else await hooks.onVerifiedComplete?.(goal, execResult, completion);
      }

      const finalLifecycle = lifecycleFor(goal, execResult, completionVerification, completion);
      executionReceipt = await hooks.writeReceipt(goal, execResult, {
        lifecycleState: finalLifecycle,
        verification: completionVerification,
        completion,
        measurement,
        durationMs: this.now() - measurement.measuredAt
      });
      goal.metadata = {
        ...(goal.metadata || {}),
        latestExecutionReceipt: executionReceipt.path,
        authoritativeLoop: {
          measuredAt: measurement.measuredAt,
          settledAt: this.now(),
          lifecycle: finalLifecycle,
          verified: goal.status === STATUS.COMPLETED
        }
      };
      this.system?.goalPlanner?._saveToDisk?.();

      await this.system?.realityLoop?.observeGoalAttempt?.({
        goal, execResult, receipt: executionReceipt.receipt,
        verification: completionVerification, completion, measurement,
        durationMs: this.now() - measurement.measuredAt
      }).catch(error => this.logger.warn?.(`[AuthoritativeGoalLoop] Learning observation failed: ${error.message}`));

      await hooks.reportTerminal?.(goal, { execResult, executionReceipt, completionVerification });

      return {
        handled: true,
        ok: !execResult.error,
        state: finalLifecycle,
        progress,
        complete: goal.status === STATUS.COMPLETED,
        execResult,
        executionReceipt,
        completionVerification,
        completion,
        measurement,
        autopsy
      };
    } finally {
      this._active.delete(goal.id);
    }
  }
}

module.exports = { AuthoritativeGoalLoop, lifecycleFor };
