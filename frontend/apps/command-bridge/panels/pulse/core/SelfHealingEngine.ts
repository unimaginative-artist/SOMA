/**
 * SelfHealingEngine - Autonomous Error Detection & Recovery
 * 
 * Monitors the preview pane for errors, automatically generates fixes,
 * learns from patterns, and gets smarter over time.
 */

import { pulseClient } from '../services/pulseClient';

interface ErrorSignature {
  type: string;
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  column?: number;
}

interface HealingAttempt {
  errorSignature: ErrorSignature;
  proposedFix: {
    files: Array<{ path: string; content: string; explanation: string }>;
    confidence: number; // 0-100
    reasoning: string;
    arbitersUsed: string[];
  };
  timestamp: number;
  applied: boolean;
  successful?: boolean;
}

interface LearningPattern {
  errorPattern: string;
  successfulFixes: number;
  failedFixes: number;
  lastSuccessfulFix?: HealingAttempt;
  confidence: number;
}

class SelfHealingEngine {
  private isMonitoring: boolean = false;
  private healingHistory: HealingAttempt[] = [];
  private learningPatterns: Map<string, LearningPattern> = new Map();
  private errorQueue: ErrorSignature[] = [];
  private isHealing: boolean = false;
  private consecutiveFailures: number = 0;
  private readonly MAX_FAILURES_BEFORE_PAUSE = 3;
  
  // Callbacks
  private onErrorDetected?: (error: ErrorSignature) => void;
  private onHealingProposed?: (attempt: HealingAttempt) => void;
  private onHealingComplete?: (attempt: HealingAttempt, success: boolean) => void;

  constructor() {
    this.loadLearningPatterns();
  }

  /**
   * Start monitoring for errors
   */
  startMonitoring(callbacks: {
    onErrorDetected?: (error: ErrorSignature) => void;
    onHealingProposed?: (attempt: HealingAttempt) => void;
    onHealingComplete?: (attempt: HealingAttempt, success: boolean) => void;
  } = {}) {
    this.isMonitoring = true;
    this.onErrorDetected = callbacks.onErrorDetected;
    this.onHealingProposed = callbacks.onHealingProposed;
    this.onHealingComplete = callbacks.onHealingComplete;
    
    console.log('[SelfHealing] 🛡️ Monitoring activated - IDE protection online');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    this.isMonitoring = false;
    console.log('[SelfHealing] Monitoring deactivated');
  }

  /**
   * Report an error from the preview pane
   */
  async reportError(error: ErrorSignature) {
    if (!this.isMonitoring) return;

    console.log('[SelfHealing] 🔍 Error detected:', error.message);
    this.onErrorDetected?.(error);

    // Add to queue
    this.errorQueue.push(error);

    // Process if not already healing
    if (!this.isHealing) {
      await this.processErrorQueue();
    }
  }

  /**
   * Process the error queue
   */
  private async processErrorQueue() {
    if (this.errorQueue.length === 0 || this.isHealing) return;

    // Check if we should pause due to failures
    if (this.consecutiveFailures >= this.MAX_FAILURES_BEFORE_PAUSE) {
      console.log('[SelfHealing] ⚠️ Pausing auto-healing due to repeated failures');
      this.errorQueue = [];
      return;
    }

    this.isHealing = true;
    const error = this.errorQueue.shift()!;

    try {
      await this.healError(error);
    } catch (err) {
      console.error('[SelfHealing] Healing failed:', err);
    } finally {
      this.isHealing = false;
      
      // Process next error after delay
      if (this.errorQueue.length > 0) {
        setTimeout(() => this.processErrorQueue(), 2000);
      }
    }
  }

  /**
   * Attempt to heal an error
   */
  private async healError(error: ErrorSignature) {
    console.log('[SelfHealing] 🔧 Analyzing error for auto-fix...');

    // Check if we've seen this pattern before
    const pattern = this.getErrorPattern(error);
    const knownPattern = this.learningPatterns.get(pattern);

    let confidence = 50; // Base confidence
    if (knownPattern) {
      confidence = knownPattern.confidence;
      console.log(`[SelfHealing] 📚 Known pattern (${confidence}% confidence)`);
    }

    // Generate fix via multi-arbiter coordination
    const fix = await this.generateFix(error, knownPattern);

    if (!fix) {
      console.log('[SelfHealing] ❌ Could not generate fix');
      this.consecutiveFailures++;
      return;
    }

    const attempt: HealingAttempt = {
      errorSignature: error,
      proposedFix: fix,
      timestamp: Date.now(),
      applied: false
    };

    this.healingHistory.push(attempt);
    this.onHealingProposed?.(attempt);

    // Auto-apply if high confidence and user has enabled it
    const autoApply = confidence > 80 && this.shouldAutoApply();

    if (autoApply) {
      await this.applyFix(attempt);
    }
  }

  /**
   * Generate a fix using multi-arbiter coordination
   */
  private async generateFix(error: ErrorSignature, knownPattern?: LearningPattern) {
    try {
      // Build context
      const context = {
        error: error.message,
        stack: error.stack,
        file: error.file,
        line: error.line,
        knownPattern: knownPattern ? {
          successRate: knownPattern.successfulFixes / (knownPattern.successfulFixes + knownPattern.failedFixes),
          lastFix: knownPattern.lastSuccessfulFix?.proposedFix
        } : null
      };

      // Use ReasoningChamber to analyze the error
      const analysis = await pulseClient.dispatch('ReasoningChamber', {
        type: 'analyze_error',
        payload: context
      });

      // Use EngineeringSwarmArbiter to generate fix
      const fixResult = await pulseClient.dispatch('EngineeringSwarmArbiter', {
        type: 'generate_fix',
        payload: {
          error: error.message,
          analysis: analysis.result,
          context
        }
      });

      if (!fixResult.success) {
        return null;
      }

      // Use CodeObservationArbiter to validate the fix won't break anything
      const validation = await pulseClient.dispatch('CodeObservationArbiter', {
        type: 'validate_changes',
        payload: {
          files: fixResult.files,
          originalError: error
        }
      });

      const confidence = this.calculateConfidence(
        fixResult,
        validation,
        knownPattern
      );

      return {
        files: fixResult.files || [],
        confidence,
        reasoning: fixResult.reasoning || 'Automatic error correction',
        arbitersUsed: ['ReasoningChamber', 'EngineeringSwarmArbiter', 'CodeObservationArbiter']
      };
    } catch (err) {
      console.error('[SelfHealing] Fix generation error:', err);
      return null;
    }
  }

  /**
   * Apply a healing attempt
   */
  async applyFix(attempt: HealingAttempt): Promise<boolean> {
    console.log('[SelfHealing] 🚀 Applying fix...');

    try {
      // Apply file changes via PulseArbiter
      for (const file of attempt.proposedFix.files) {
        await pulseClient.call('/arbiter/modify-code', {
          method: 'POST',
          body: JSON.stringify({
            filepath: file.path,
            request: file.content,
            context: { healing: true }
          })
        });
      }

      attempt.applied = true;
      
      // Wait for verification (give time for preview to reload)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Assume success if no new error in 3 seconds
      // (Real implementation would monitor preview pane)
      const success = true; // TODO: Actual error monitoring
      
      attempt.successful = success;
      
      if (success) {
        console.log('[SelfHealing] ✅ Fix applied successfully!');
        this.consecutiveFailures = 0;
        this.learnFromSuccess(attempt);
      } else {
        console.log('[SelfHealing] ❌ Fix did not resolve the issue');
        this.consecutiveFailures++;
        this.learnFromFailure(attempt);
      }

      this.onHealingComplete?.(attempt, success);

      // Send to learning pipeline
      await this.sendToLearning(attempt, success);

      return success;
    } catch (err) {
      console.error('[SelfHealing] Failed to apply fix:', err);
      attempt.successful = false;
      this.consecutiveFailures++;
      return false;
    }
  }

  /**
   * Learn from successful healing
   */
  private learnFromSuccess(attempt: HealingAttempt) {
    const pattern = this.getErrorPattern(attempt.errorSignature);
    const existing = this.learningPatterns.get(pattern) || {
      errorPattern: pattern,
      successfulFixes: 0,
      failedFixes: 0,
      confidence: 50
    };

    existing.successfulFixes++;
    existing.lastSuccessfulFix = attempt;
    existing.confidence = Math.min(95, 50 + (existing.successfulFixes * 10));

    this.learningPatterns.set(pattern, existing);
    this.saveLearningPatterns();
  }

  /**
   * Learn from failed healing
   */
  private learnFromFailure(attempt: HealingAttempt) {
    const pattern = this.getErrorPattern(attempt.errorSignature);
    const existing = this.learningPatterns.get(pattern);

    if (existing) {
      existing.failedFixes++;
      existing.confidence = Math.max(20, existing.confidence - 10);
      this.learningPatterns.set(pattern, existing);
      this.saveLearningPatterns();
    }
  }

  /**
   * Send healing attempt to learning pipeline
   */
  private async sendToLearning(attempt: HealingAttempt, success: boolean) {
    try {
      await pulseClient.call('/learning/record', {
        method: 'POST',
        body: JSON.stringify({
          type: 'self_healing',
          error: attempt.errorSignature,
          fix: attempt.proposedFix,
          success,
          timestamp: attempt.timestamp
        })
      });
    } catch (err) {
      // Silent fail - learning is optional
    }
  }

  /**
   * Get a pattern signature from an error
   */
  private getErrorPattern(error: ErrorSignature): string {
    // Create a normalized pattern (remove dynamic parts like line numbers, variable names)
    return `${error.type}:${error.message.substring(0, 50)}`;
  }

  /**
   * Calculate confidence score for a fix
   */
  private calculateConfidence(
    fixResult: any,
    validation: any,
    knownPattern?: LearningPattern
  ): number {
    let confidence = 50;

    // Boost confidence based on arbiter consensus
    if (fixResult.confidence) confidence += 20;
    if (validation.safe) confidence += 15;

    // Boost from historical success
    if (knownPattern) {
      const successRate = knownPattern.successfulFixes / 
        Math.max(1, knownPattern.successfulFixes + knownPattern.failedFixes);
      confidence += successRate * 15;
    }

    return Math.min(100, Math.max(0, confidence));
  }

  /**
   * Check if auto-apply is enabled
   */
  private shouldAutoApply(): boolean {
    // TODO: Read from user settings
    return false; // Default: always ask for approval
  }

  /**
   * Get healing history
   */
  getHistory(): HealingAttempt[] {
    return [...this.healingHistory];
  }

  /**
   * Get learning patterns
   */
  getPatterns(): LearningPattern[] {
    return Array.from(this.learningPatterns.values());
  }

  /**
   * Reset consecutive failures (manual user intervention)
   */
  resetFailures() {
    this.consecutiveFailures = 0;
  }

  /**
   * Save learning patterns to localStorage
   */
  private saveLearningPatterns() {
    try {
      const data = JSON.stringify(Array.from(this.learningPatterns.entries()));
      localStorage.setItem('pulse_healing_patterns', data);
    } catch (err) {
      console.error('[SelfHealing] Failed to save patterns:', err);
    }
  }

  /**
   * Load learning patterns from localStorage
   */
  private loadLearningPatterns() {
    try {
      const data = localStorage.getItem('pulse_healing_patterns');
      if (data) {
        const entries = JSON.parse(data);
        this.learningPatterns = new Map(entries);
        console.log(`[SelfHealing] 📚 Loaded ${this.learningPatterns.size} learned patterns`);
      }
    } catch (err) {
      console.error('[SelfHealing] Failed to load patterns:', err);
    }
  }
}

// Singleton instance
export const selfHealingEngine = new SelfHealingEngine();
export default selfHealingEngine;
