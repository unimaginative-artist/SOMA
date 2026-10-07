/**
 * PredictiveAssistant - Context-Aware Intelligence
 * 
 * Analyzes user behavior patterns, predicts next actions,
 * pre-loads suggestions, and adapts to your coding style.
 * 
 * This is like having an AI pair programmer that knows you.
 */

import { pulseClient } from '../services/pulseClient';

interface UserAction {
  type: 'file_open' | 'file_edit' | 'command_run' | 'blueprint_generate' | 'steve_query';
  context: {
    file?: string;
    content?: string;
    command?: string;
    query?: string;
    timestamp: number;
    dayOfWeek: number;
    hourOfDay: number;
  };
}

interface ActionPattern {
  sequence: string[]; // e.g., ['file_open:App.tsx', 'file_edit:App.tsx', 'command_run:npm test']
  frequency: number;
  lastSeen: number;
  avgTimeBetweenSteps: number[];
}

interface Prediction {
  action: string;
  confidence: number; // 0-100
  reasoning: string;
  preloadedData?: any;
}

interface UserProfile {
  preferredFileTypes: Map<string, number>; // extension -> frequency
  commonCommands: Map<string, number>;
  codingStyle: {
    indentSize: number;
    usesTypeScript: boolean;
    preferredFrameworks: string[];
    namingConvention: 'camelCase' | 'snake_case' | 'PascalCase';
  };
  workingHours: Map<number, number>; // hour -> activity count
  productivityPatterns: {
    peakHours: number[];
    avgSessionLength: number;
    breakFrequency: number;
  };
}

class PredictiveAssistant {
  private actionHistory: UserAction[] = [];
  private patterns: Map<string, ActionPattern> = new Map();
  private userProfile: UserProfile;
  private isLearning: boolean = true;
  private predictions: Prediction[] = [];
  private analysisInterval: ReturnType<typeof setInterval> | null = null;
  private readonly MAX_HISTORY = 1000;
  private readonly PATTERN_MIN_FREQUENCY = 3;

  constructor() {
    this.userProfile = this.loadUserProfile();
    this.loadActionHistory();
    this.startBackgroundAnalysis();
  }

  /**
   * Record a user action
   */
  recordAction(action: UserAction) {
    if (!this.isLearning) return;

    // Add temporal context
    const now = new Date();
    action.context.timestamp = now.getTime();
    action.context.dayOfWeek = now.getDay();
    action.context.hourOfDay = now.getHours();

    this.actionHistory.push(action);

    // Maintain history size
    if (this.actionHistory.length > this.MAX_HISTORY) {
      this.actionHistory.shift();
    }

    // Update user profile
    this.updateProfile(action);

    // Detect patterns in real-time
    this.detectPatterns();

    // Generate new predictions
    this.generatePredictions();

    // Persist
    this.saveActionHistory();
    this.saveUserProfile();
  }

  /**
   * Get current predictions
   */
  getPredictions(): Prediction[] {
    return [...this.predictions];
  }

  /**
   * Get top prediction
   */
  getTopPrediction(): Prediction | null {
    return this.predictions.length > 0 ? this.predictions[0] : null;
  }

  /**
   * Update user profile based on action
   */
  private updateProfile(action: UserAction) {
    // Track file types
    if (action.context.file) {
      const ext = action.context.file.split('.').pop() || '';
      this.userProfile.preferredFileTypes.set(
        ext,
        (this.userProfile.preferredFileTypes.get(ext) || 0) + 1
      );
    }

    // Track commands
    if (action.context.command) {
      this.userProfile.commonCommands.set(
        action.context.command,
        (this.userProfile.commonCommands.get(action.context.command) || 0) + 1
      );
    }

    // Track working hours
    const hour = action.context.hourOfDay;
    this.userProfile.workingHours.set(
      hour,
      (this.userProfile.workingHours.get(hour) || 0) + 1
    );

    // Analyze coding style from edits
    if (action.type === 'file_edit' && action.context.content) {
      this.analyzeCodingStyle(action.context.content);
    }
  }

  /**
   * Analyze coding style from content
   */
  private analyzeCodingStyle(content: string) {
    // Detect indent size
    const lines = content.split('\n');
    const indentedLines = lines.filter(l => l.startsWith(' ') || l.startsWith('\t'));
    if (indentedLines.length > 0) {
      const spaces = indentedLines[0].match(/^[ \t]*/)?.[0].length || 2;
      this.userProfile.codingStyle.indentSize = spaces;
    }

    // Detect TypeScript
    if (content.includes(': ') || content.includes('interface ') || content.includes('type ')) {
      this.userProfile.codingStyle.usesTypeScript = true;
    }

    // Detect naming convention
    const identifiers = content.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
    let camelCaseCount = 0;
    let snakeCaseCount = 0;
    let pascalCaseCount = 0;

    identifiers.forEach(id => {
      if (/^[a-z][a-zA-Z0-9]*$/.test(id)) camelCaseCount++;
      if (/^[a-z][a-z0-9_]*$/.test(id) && id.includes('_')) snakeCaseCount++;
      if (/^[A-Z][a-zA-Z0-9]*$/.test(id)) pascalCaseCount++;
    });

    if (camelCaseCount > snakeCaseCount && camelCaseCount > pascalCaseCount) {
      this.userProfile.codingStyle.namingConvention = 'camelCase';
    } else if (snakeCaseCount > camelCaseCount && snakeCaseCount > pascalCaseCount) {
      this.userProfile.codingStyle.namingConvention = 'snake_case';
    } else if (pascalCaseCount > 0) {
      this.userProfile.codingStyle.namingConvention = 'PascalCase';
    }
  }

  /**
   * Detect patterns in action history
   */
  private detectPatterns() {
    const recentActions = this.actionHistory.slice(-10);
    if (recentActions.length < 3) return;

    // Look for sequences of 3+ actions
    for (let seqLength = 3; seqLength <= Math.min(5, recentActions.length); seqLength++) {
      const sequence = recentActions.slice(-seqLength).map(a => 
        `${a.type}:${a.context.file || a.context.command || a.context.query || 'unknown'}`
      );

      const patternKey = sequence.join('→');
      const existing = this.patterns.get(patternKey);

      if (existing) {
        existing.frequency++;
        existing.lastSeen = Date.now();
      } else {
        this.patterns.set(patternKey, {
          sequence,
          frequency: 1,
          lastSeen: Date.now(),
          avgTimeBetweenSteps: []
        });
      }
    }

    // Prune old patterns
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const [key, pattern] of this.patterns.entries()) {
      if (pattern.lastSeen < oneWeekAgo && pattern.frequency < this.PATTERN_MIN_FREQUENCY) {
        this.patterns.delete(key);
      }
    }
  }

  /**
   * Generate predictions based on current context
   */
  private async generatePredictions() {
    this.predictions = [];

    // Get recent context (last 3 actions)
    const recentActions = this.actionHistory.slice(-3);
    if (recentActions.length === 0) return;

    // Match against known patterns
    const contextSequence = recentActions.map(a =>
      `${a.type}:${a.context.file || a.context.command || a.context.query || 'unknown'}`
    );

    // Find matching patterns
    const matches: Array<{ pattern: ActionPattern; key: string }> = [];
    for (const [key, pattern] of this.patterns.entries()) {
      if (pattern.frequency >= this.PATTERN_MIN_FREQUENCY) {
        // Check if pattern starts with our context
        const patternStart = pattern.sequence.slice(0, contextSequence.length);
        if (JSON.stringify(patternStart) === JSON.stringify(contextSequence)) {
          matches.push({ pattern, key });
        }
      }
    }

    // Sort by frequency
    matches.sort((a, b) => b.pattern.frequency - a.pattern.frequency);

    // Generate predictions from top matches
    for (const match of matches.slice(0, 3)) {
      const nextAction = match.pattern.sequence[contextSequence.length];
      if (nextAction) {
        const confidence = Math.min(95, 40 + (match.pattern.frequency * 10));

        this.predictions.push({
          action: nextAction,
          confidence,
          reasoning: `You've done this ${match.pattern.frequency} times before in this sequence`,
          preloadedData: await this.preloadData(nextAction)
        });
      }
    }

    // Add context-aware predictions
    await this.addContextPredictions();

    // Sort by confidence
    this.predictions.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Add context-aware predictions (beyond pattern matching)
   */
  private async addContextPredictions() {
    const lastAction = this.actionHistory[this.actionHistory.length - 1];
    if (!lastAction) return;

    // If just edited a file, predict test file next
    if (lastAction.type === 'file_edit' && lastAction.context.file) {
      const file = lastAction.context.file;
      if (!file.includes('.test.') && !file.includes('.spec.')) {
        const testFile = file.replace(/\.(ts|js|tsx|jsx)$/, '.test.$1');
        this.predictions.push({
          action: `file_open:${testFile}`,
          confidence: 65,
          reasoning: 'You often open test files after editing source',
          preloadedData: null
        });
      }
    }

    // Time-based predictions (e.g., break time)
    const hour = new Date().getHours();
    const activityThisHour = this.userProfile.workingHours.get(hour) || 0;
    const avgActivity = Array.from(this.userProfile.workingHours.values())
      .reduce((sum, val) => sum + val, 0) / this.userProfile.workingHours.size;

    if (activityThisHour < avgActivity * 0.5) {
      this.predictions.push({
        action: 'suggest_break',
        confidence: 50,
        reasoning: "You're usually less active at this hour - maybe take a break?",
        preloadedData: null
      });
    }
  }

  /**
   * Preload data for predicted action
   */
  private async preloadData(action: string): Promise<any> {
    try {
      const [actionType, target] = action.split(':');

      if (actionType === 'file_open' && target) {
        // Preload file content
        return await pulseClient.call(`/files/${encodeURIComponent(target)}`, {
          method: 'GET'
        });
      }

      return null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Get smart autocomplete suggestions based on context
   */
  async getSmartAutocompletions(prefix: string, context: any): Promise<string[]> {
    const suggestions: string[] = [];

    // Use user's common commands
    if (context.type === 'command') {
      const commands = Array.from(this.userProfile.commonCommands.entries())
        .filter(([cmd]) => cmd.startsWith(prefix))
        .sort((a, b) => b[1] - a[1])
        .map(([cmd]) => cmd);

      suggestions.push(...commands);
    }

    // Use AdaptiveLearningRouter for intelligent suggestions
    try {
      const result = await pulseClient.dispatch('AdaptiveLearningRouter', {
        type: 'suggest',
        payload: {
          prefix,
          context,
          userProfile: this.getUserProfileSummary()
        }
      });

      if (result.success && result.suggestions) {
        suggestions.push(...result.suggestions);
      }
    } catch (err) {
      // Silent fail
    }

    return [...new Set(suggestions)].slice(0, 10);
  }

  /**
   * Get user profile summary
   */
  getUserProfileSummary() {
    return {
      topFileTypes: Array.from(this.userProfile.preferredFileTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ext]) => ext),
      topCommands: Array.from(this.userProfile.commonCommands.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cmd]) => cmd),
      codingStyle: this.userProfile.codingStyle,
      peakHours: Array.from(this.userProfile.workingHours.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([hour]) => hour)
    };
  }

  /**
   * Start background analysis
   */
  private startBackgroundAnalysis() {
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    this.analysisInterval = setInterval(() => {
      if (this.actionHistory.length > 10) {
        this.detectPatterns();
        this.generatePredictions();
      }
    }, 60000); // Every minute
  }

  destroy() {
    if (this.analysisInterval) { clearInterval(this.analysisInterval); this.analysisInterval = null; }
  }

  /**
   * Toggle learning
   */
  setLearning(enabled: boolean) {
    this.isLearning = enabled;
    console.log(`[Predictive] Learning ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clear all data (privacy)
   */
  clearAllData() {
    this.actionHistory = [];
    this.patterns.clear();
    this.userProfile = this.getDefaultProfile();
    this.predictions = [];

    localStorage.removeItem('pulse_action_history');
    localStorage.removeItem('pulse_user_profile');

    console.log('[Predictive] All data cleared');
  }

  /**
   * Get default profile
   */
  private getDefaultProfile(): UserProfile {
    return {
      preferredFileTypes: new Map(),
      commonCommands: new Map(),
      codingStyle: {
        indentSize: 2,
        usesTypeScript: false,
        preferredFrameworks: [],
        namingConvention: 'camelCase'
      },
      workingHours: new Map(),
      productivityPatterns: {
        peakHours: [],
        avgSessionLength: 0,
        breakFrequency: 0
      }
    };
  }

  /**
   * Save action history
   */
  private saveActionHistory() {
    try {
      const data = JSON.stringify(this.actionHistory.slice(-100)); // Keep last 100
      localStorage.setItem('pulse_action_history', data);
    } catch (err) {
      console.error('[Predictive] Failed to save history:', err);
    }
  }

  /**
   * Load action history
   */
  private loadActionHistory() {
    try {
      const data = localStorage.getItem('pulse_action_history');
      if (data) {
        this.actionHistory = JSON.parse(data);
        console.log(`[Predictive] 📚 Loaded ${this.actionHistory.length} past actions`);
      }
    } catch (err) {
      console.error('[Predictive] Failed to load history:', err);
    }
  }

  /**
   * Save user profile
   */
  private saveUserProfile() {
    try {
      const data = JSON.stringify({
        preferredFileTypes: Array.from(this.userProfile.preferredFileTypes.entries()),
        commonCommands: Array.from(this.userProfile.commonCommands.entries()),
        codingStyle: this.userProfile.codingStyle,
        workingHours: Array.from(this.userProfile.workingHours.entries()),
        productivityPatterns: this.userProfile.productivityPatterns
      });
      localStorage.setItem('pulse_user_profile', data);
    } catch (err) {
      console.error('[Predictive] Failed to save profile:', err);
    }
  }

  /**
   * Load user profile
   */
  private loadUserProfile(): UserProfile {
    try {
      const data = localStorage.getItem('pulse_user_profile');
      if (data) {
        const parsed = JSON.parse(data);
        return {
          preferredFileTypes: new Map(parsed.preferredFileTypes || []),
          commonCommands: new Map(parsed.commonCommands || []),
          codingStyle: parsed.codingStyle || this.getDefaultProfile().codingStyle,
          workingHours: new Map(parsed.workingHours || []),
          productivityPatterns: parsed.productivityPatterns || this.getDefaultProfile().productivityPatterns
        };
      }
    } catch (err) {
      console.error('[Predictive] Failed to load profile:', err);
    }
    return this.getDefaultProfile();
  }
}

// Singleton instance
export const predictiveAssistant = new PredictiveAssistant();
export default predictiveAssistant;
