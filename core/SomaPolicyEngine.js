/**
 * Declarative policy engine for SOMA runtime guardrails.
 *
 * Policies return recommended actions only. Execution stays with explicit
 * callers so this module cannot mutate files, kill processes, or start work
 * by itself.
 */

export const PolicyAction = {
  PAUSE_AUTONOMOUS: 'pause_autonomous',
  TRIGGER_MEMORY_FLUSH: 'trigger_memory_flush',
  SWITCH_LOCAL: 'switch_to_local',
  NOTIFY_USER: 'notify_user',
  REQUIRE_HUMAN_REVIEW: 'require_human_review'
};

export class SomaPolicyEngine {
  constructor(rules = []) {
    this.rules = [
      {
        name: 'ResourceThrottling',
        condition: (state) => Number(state.heapUsage || 0) > 0.90 || Number(state.rssPercent || 0) > 90,
        actions: [PolicyAction.PAUSE_AUTONOMOUS, PolicyAction.TRIGGER_MEMORY_FLUSH],
        priority: 10
      },
      {
        name: 'RepeatedFailurePivot',
        condition: (state) => Number(state.recentFailureCount || 0) >= 3,
        actions: [PolicyAction.SWITCH_LOCAL, PolicyAction.REQUIRE_HUMAN_REVIEW],
        priority: 20
      },
      ...rules
    ];
  }

  addRule(rule) {
    if (!rule?.name || typeof rule.condition !== 'function') {
      throw new Error('Policy rule requires name and condition function');
    }
    this.rules.push({
      actions: [],
      priority: 100,
      ...rule
    });
  }

  evaluate(systemState = {}) {
    const triggered = [];
    const sorted = [...this.rules].sort((a, b) => a.priority - b.priority);

    for (const rule of sorted) {
      let matches = false;
      try {
        matches = !!rule.condition(systemState);
      } catch (err) {
        triggered.push({
          rule: rule.name,
          action: PolicyAction.NOTIFY_USER,
          priority: rule.priority,
          reason: `policy condition failed: ${err.message}`
        });
        continue;
      }

      if (!matches) continue;
      const actions = Array.isArray(rule.actions) ? rule.actions : [rule.action].filter(Boolean);
      for (const action of actions) {
        triggered.push({
          rule: rule.name,
          action,
          priority: rule.priority,
          reason: rule.reason || null
        });
      }
    }

    return triggered;
  }
}

export default SomaPolicyEngine;
