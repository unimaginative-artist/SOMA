/**
 * Safe recovery recipes for common SOMA runtime failures.
 *
 * RecoveryCortex deliberately avoids broad destructive actions. Dangerous
 * remediation, such as killing processes, is represented as a recommendation
 * unless the caller opts into a tightly scoped operation.
 */

export const FailureScenario = {
  PROVIDER_FAILURE: 'provider_failure',
  PROTOCOL_FAILURE: 'protocol_failure',
  HANDSHAKE_FAILURE: 'mcp_handshake_failure',
  STALE_BRANCH: 'stale_branch',
  HEAP_PRESSURE: 'high_heap_pressure'
};

export class RecoveryCortex {
  constructor({ messageBroker = null, maxAttempts = 1 } = {}) {
    this.messageBroker = messageBroker;
    this.maxAttempts = maxAttempts;
    this.attemptCount = new Map();
  }

  async handleFailure(scenario, context = {}) {
    const attempts = this.attemptCount.get(scenario) || 0;
    if (attempts >= this.maxAttempts) {
      return this._escalate(scenario, 'recipe already attempted', context);
    }

    this.attemptCount.set(scenario, attempts + 1);

    switch (scenario) {
      case FailureScenario.PROVIDER_FAILURE:
        return this._providerFallback(context);
      case FailureScenario.HEAP_PRESSURE:
        return this._heapRelief(context);
      case FailureScenario.PROTOCOL_FAILURE:
      case FailureScenario.HANDSHAKE_FAILURE:
        return this._protocolRecovery(context);
      case FailureScenario.STALE_BRANCH:
        return this._escalate(scenario, 'git state needs human review before recovery', context);
      default:
        return this._escalate(scenario, 'no recovery recipe exists', context);
    }
  }

  _providerFallback(context) {
    const previous = process.env.BRAIN_MODE;
    process.env.BRAIN_MODE = context.mode || 'local_only';
    this._publish('system.recovery.applied', {
      scenario: FailureScenario.PROVIDER_FAILURE,
      action: 'switch_local',
      previousMode: previous,
      mode: process.env.BRAIN_MODE
    });
    return { status: 'recovered', action: 'switch_local', previousMode: previous, mode: process.env.BRAIN_MODE };
  }

  _heapRelief(context) {
    if (global.gc) global.gc();
    this._publish('system.command', { type: 'trigger_memory_flush', source: 'RecoveryCortex' });
    this._publish('system.command', { type: 'trigger_dream', source: 'RecoveryCortex', safeMode: true });
    return {
      status: 'recovery_requested',
      action: 'memory_flush',
      heapUsed: process.memoryUsage().heapUsed,
      gcAvailable: !!global.gc,
      note: context.reason || null
    };
  }

  _protocolRecovery(context) {
    const ports = Array.isArray(context.ports) ? context.ports : [];
    const recommendation = ports.length
      ? `Inspect and clear only owning processes for ports: ${ports.join(', ')}`
      : 'Inspect protocol service health and restart the specific failed service';

    this._publish('system.recovery.recommended', {
      scenario: FailureScenario.PROTOCOL_FAILURE,
      recommendation,
      context
    });

    return {
      status: 'needs_human_or_supervisor',
      action: 'scoped_service_restart_recommended',
      recommendation
    };
  }

  _escalate(scenario, reason, context) {
    const result = { status: 'escalated', scenario, reason, context };
    this._publish('system.recovery.escalated', result);
    return result;
  }

  _publish(topic, payload) {
    try {
      this.messageBroker?.publish?.(topic, payload);
    } catch {
      // Recovery must never throw while reporting recovery status.
    }
  }
}

export default RecoveryCortex;
