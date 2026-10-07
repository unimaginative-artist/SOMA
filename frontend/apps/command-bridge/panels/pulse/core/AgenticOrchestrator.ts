/**
 * AgenticOrchestrator - The Brain of Pulse IDE
 * 
 * Coordinates all advanced agentic features:
 * - Self-healing
 * - Predictive assistance
 * - Learning & adaptation
 * - Autonomous workflows
 * 
 * This is what makes Pulse ALIVE.
 */

import selfHealingEngine from './SelfHealingEngine';
import predictiveAssistant from './PredictiveAssistant';
import { pulseClient } from '../services/pulseClient';

interface OrchestrationConfig {
  enableSelfHealing: boolean;
  enablePredictions: boolean;
  enableLearning: boolean;
  enableAutonomousWorkflows: boolean;
  autoApplyHighConfidenceFixes: boolean;
}

class AgenticOrchestrator {
  private config: OrchestrationConfig;
  private isActive: boolean = false;
  private backgroundInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * Activate all agentic features
   */
  activate() {
    if (this.isActive) return;
    this.isActive = true;

    console.log('[Agentic] 🚀 Orchestrator activated - Pulse is now ALIVE');

    // Start self-healing
    if (this.config.enableSelfHealing) {
      selfHealingEngine.startMonitoring({
        onErrorDetected: (error) => {
          console.log('[Agentic] 🔍 Error detected, analyzing...');
        },
        onHealingProposed: (attempt) => {
          console.log(`[Agentic] 🔧 Fix proposed (${attempt.proposedFix.confidence}% confident)`);
          // Show notification to user
          this.notifyUser({
            type: 'healing_proposed',
            data: attempt
          });
        },
        onHealingComplete: (attempt, success) => {
          if (success) {
            console.log('[Agentic] ✅ Error auto-fixed!');
            this.sendToLearning('healing_success', attempt);
          }
        }
      });
    }

    // Enable predictions
    if (this.config.enablePredictions) {
      predictiveAssistant.setLearning(true);
      console.log('[Agentic] 🧠 Predictive assistant learning enabled');
    }

    // Start background intelligence
    this.startBackgroundIntelligence();
  }

  /**
   * Deactivate all agentic features
   */
  deactivate() {
    this.isActive = false;
    selfHealingEngine.stopMonitoring();
    predictiveAssistant.setLearning(false);
    console.log('[Agentic] Orchestrator deactivated');
  }

  /**
   * Record user action for learning
   */
  recordAction(action: any) {
    if (!this.isActive) return;

    predictiveAssistant.recordAction(action);

    // Send to Universal Learning Pipeline
    if (this.config.enableLearning) {
      this.sendToLearning('user_action', action);
    }
  }

  /**
   * Report an error from preview pane
   */
  reportError(error: any) {
    if (!this.isActive || !this.config.enableSelfHealing) return;
    selfHealingEngine.reportError(error);
  }

  /**
   * Get current predictions
   */
  getPredictions() {
    return predictiveAssistant.getPredictions();
  }

  /**
   * Get smart suggestions based on context
   */
  async getSmartSuggestions(prefix: string, context: any) {
    return await predictiveAssistant.getSmartAutocompletions(prefix, context);
  }

  /**
   * Start background intelligence tasks
   */
  private startBackgroundIntelligence() {
    if (this.backgroundInterval) clearInterval(this.backgroundInterval);
    this.backgroundInterval = setInterval(() => {
      this.analyzeAndOptimize();
    }, 5 * 60 * 1000);
  }

  destroy() {
    if (this.backgroundInterval) { clearInterval(this.backgroundInterval); this.backgroundInterval = null; }
    this.isActive = false;
  }

  /**
   * Analyze workspace and suggest optimizations
   */
  private async analyzeAndOptimize() {
    console.log('[Agentic] 🔍 Running background analysis...');

    try {
      // Get workspace health
      const health = await this.checkWorkspaceHealth();

      // If issues detected, proactively suggest fixes
      if (health.issues.length > 0) {
        console.log(`[Agentic] ⚠️ Detected ${health.issues.length} potential issues`);
        
        for (const issue of health.issues) {
          if (issue.severity === 'high' && issue.autoFixable) {
            // Auto-fix high severity issues if enabled
            if (this.config.autoApplyHighConfidenceFixes) {
              await this.applyAutoFix(issue);
            } else {
              this.notifyUser({
                type: 'optimization_suggested',
                data: issue
              });
            }
          }
        }
      }

      // Learn from workspace patterns
      await this.learnFromWorkspace();

    } catch (err) {
      console.error('[Agentic] Background analysis error:', err);
    }
  }

  /**
   * Check workspace health
   */
  private async checkWorkspaceHealth() {
    const issues: any[] = [];

    try {
      // Use CodeObservationArbiter for analysis
      const result = await pulseClient.dispatch('CodeObservationArbiter', {
        type: 'analyze_workspace_health',
        payload: {}
      });

      if (result.success && result.issues) {
        issues.push(...result.issues);
      }
    } catch (err) {
      // Silent fail
    }

    return { issues };
  }

  /**
   * Apply automatic fix
   */
  private async applyAutoFix(issue: any) {
    console.log(`[Agentic] 🔧 Auto-fixing: ${issue.title}`);

    try {
      await pulseClient.dispatch('EngineeringSwarmArbiter', {
        type: 'auto_fix',
        payload: { issue }
      });

      this.sendToLearning('auto_fix_applied', issue);
    } catch (err) {
      console.error('[Agentic] Auto-fix failed:', err);
    }
  }

  /**
   * Learn from workspace patterns
   */
  private async learnFromWorkspace() {
    const profile = predictiveAssistant.getUserProfileSummary();

    // Send profile to learning pipeline for adaptation
    await this.sendToLearning('workspace_profile', profile);
  }

  /**
   * Send data to Universal Learning Pipeline
   */
  private async sendToLearning(type: string, data: any) {
    try {
      await pulseClient.call('/learning/record', {
        method: 'POST',
        body: JSON.stringify({
          type,
          data,
          timestamp: Date.now(),
          source: 'agentic_orchestrator'
        })
      });
    } catch (err) {
      // Silent fail - learning is optional
    }
  }

  /**
   * Notify user (emit event or show toast)
   */
  private notifyUser(notification: any) {
    // Emit custom event that UI can listen to
    window.dispatchEvent(new CustomEvent('pulse-notification', {
      detail: notification
    }));
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<OrchestrationConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.saveConfig();

    // Re-activate with new config
    if (this.isActive) {
      this.deactivate();
      this.activate();
    }
  }

  /**
   * Get configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Load configuration from localStorage
   */
  private loadConfig(): OrchestrationConfig {
    try {
      const data = localStorage.getItem('pulse_agentic_config');
      if (data) {
        return JSON.parse(data);
      }
    } catch (err) {
      console.error('[Agentic] Failed to load config:', err);
    }

    return {
      enableSelfHealing: true,
      enablePredictions: true,
      enableLearning: true,
      enableAutonomousWorkflows: false,
      autoApplyHighConfidenceFixes: false
    };
  }

  /**
   * Save configuration to localStorage
   */
  private saveConfig() {
    try {
      localStorage.setItem('pulse_agentic_config', JSON.stringify(this.config));
    } catch (err) {
      console.error('[Agentic] Failed to save config:', err);
    }
  }

  /**
   * Get system status
   */
  getStatus() {
    return {
      active: this.isActive,
      selfHealing: {
        enabled: this.config.enableSelfHealing,
        patterns: selfHealingEngine.getPatterns().length,
        history: selfHealingEngine.getHistory().length
      },
      predictions: {
        enabled: this.config.enablePredictions,
        current: predictiveAssistant.getPredictions().length,
        profile: predictiveAssistant.getUserProfileSummary()
      },
      learning: {
        enabled: this.config.enableLearning
      }
    };
  }
}

// Singleton instance
export const agenticOrchestrator = new AgenticOrchestrator();
export default agenticOrchestrator;
