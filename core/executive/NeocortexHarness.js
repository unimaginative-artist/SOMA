import { NeocortexStateStream } from './NeocortexStateStream.js';
import { NeocortexSelfModel } from './NeocortexSelfModel.js';
import { NeocortexFollowthrough } from './NeocortexFollowthrough.js';
import { neocortexSystem1Bridge } from './NeocortexSystem1Bridge.js';

export class NeocortexHarness {
  constructor(opts = {}) {
    this.name = 'NeocortexHarness';
    this.system = opts.system || null;
    this.logger = opts.logger || console;

    // Modes: 'off' | 'shadow' | 'active'
    this.mode = (process.env.SOMA_EXECUTIVE_MODE || opts.mode || 'off').toLowerCase();
    if (!['off', 'shadow', 'active'].includes(this.mode)) {
      this.mode = 'off';
    }

    this.stream = new NeocortexStateStream({ logger: this.logger });
    this.selfModel = new NeocortexSelfModel({ system: this.system, logger: this.logger });
    this.followthrough = new NeocortexFollowthrough({ system: this.system, logger: this.logger });
    this.system1 = opts.system1 || neocortexSystem1Bridge;
    this.running = false;
    this._unsubscribers = [];
  }

  async start() {
    if (this.mode === 'off') {
      this.logger.info(`[${this.name}] Mode is OFF — executive layer remains completely dormant.`);
      return this;
    }

    try {
      await this.stream.initialize();
      await this.followthrough.initialize();
      this._wireMessageBroker();
      this.running = true;
      this.logger.info(`[${this.name}] 🧠 Neocortex attached in [${this.mode.toUpperCase()}] mode (fail-open sidecar).`);

      // System 1 Substrate status probe
      this.system1.ping().then(ping => {
        if (ping?.online) {
          this.logger.info(`[${this.name}] ⚡ System 1 Substrate Online (Laya ModernBERT-large 421M on ${ping.device}, latency: ${ping.latencyMs}ms)`);
        } else {
          this.logger.info(`[${this.name}] ⚡ System 1 Substrate offline (fail-open mode active).`);
        }
      }).catch(() => {});
    } catch (err) {
      this.logger.warn(`[${this.name}] Failed to start cleanly; failing open: ${err.message}`);
      this.running = false;
    }
    return this;
  }

  stop() {
    this.running = false;
    for (const unsub of this._unsubscribers) {
      try { unsub(); } catch {}
    }
    this._unsubscribers = [];
  }

  getStatus() {
    return {
      name: this.name,
      mode: this.mode,
      running: this.running,
      system1: {
        online: this.system1._isAvailable(),
        lastHealth: this.system1._lastHealth
      },
      state: this.stream.getSnapshot()
    };
  }

  _wireMessageBroker() {
    const broker = this.system?.messageBroker || global.__SOMA_SYSTEM__?.messageBroker;
    if (!broker || typeof broker.on !== 'function') return;

    // Fail-open event listeners
    const onUserMsg = (msg) => {
      if (!this.running || this.mode === 'off') return;
      try {
        const text = typeof msg === 'string' ? msg : msg?.content || msg?.text || '';
        this.stream.recordTurn({ speaker: 'user', text, channel: msg?.channel || 'broker' }).catch(() => {});
      } catch {}
    };

    const onBotMsg = (msg) => {
      if (!this.running || this.mode === 'off') return;
      try {
        const text = typeof msg === 'string' ? msg : msg?.content || msg?.text || '';
        this.stream.recordTurn({ speaker: 'soma', text, channel: msg?.channel || 'broker' }).catch(() => {});
        this.selfModel.evaluateDraft(text);
      } catch {}
    };

    const onGoalCompleted = (payload) => {
      if (!this.running || this.mode === 'off') return;
      try {
        const data = payload?.payload || payload;
        this.followthrough.handleGoalCompleted(data).catch(() => {});
        this.system1.recordExperience({
          type: 'goal_execution',
          status: 'completed',
          goalId: data?.goalId || data?.id,
          taskTitle: data?.taskTitle || data?.description,
          timestamp: Date.now()
        });
      } catch {}
    };

    const onGoalFailed = (payload) => {
      if (!this.running || this.mode === 'off') return;
      try {
        const data = payload?.payload || payload;
        this.followthrough.handleGoalFailed(data).catch(() => {});
        this.system1.recordExperience({
          type: 'goal_execution',
          status: 'failed',
          goalId: data?.goalId || data?.id,
          taskTitle: data?.taskTitle || data?.description,
          error: data?.error,
          timestamp: Date.now()
        });
      } catch {}
    };

    try {
      broker.on('discord:message', onUserMsg);
      broker.on('soma:response', onBotMsg);
      broker.on('goal_completed', onGoalCompleted);
      broker.on('goal_failed', onGoalFailed);
      this._unsubscribers.push(() => {
        try { broker.off('discord:message', onUserMsg); } catch {}
        try { broker.off('soma:response', onBotMsg); } catch {}
        try { broker.off('goal_completed', onGoalCompleted); } catch {}
        try { broker.off('goal_failed', onGoalFailed); } catch {}
      });
    } catch (e) {
      this.logger.warn(`[${this.name}] Event bus subscription skipped: ${e.message}`);
    }
  }

  /**
   * Observe a live dialogue turn safely.
   */
  async observeTurn({ speaker = 'user', text = '', channel = 'system' } = {}) {
    if (!this.running || this.mode === 'off') return null;
    try {
      const turnRecord = await this.stream.recordTurn({ speaker, text, channel });

      // Fast System 1 sensory reflex classification on inbound user turns
      let system1Sensory = null;
      if (speaker === 'user' && text) {
        try {
          system1Sensory = await this.system1.classifyTurn(text, { channel });
          if (system1Sensory) {
            this.stream.recordThought({
              type: 'system1_sensory_reflex',
              content: `Lane: ${system1Sensory.lane} (${(system1Sensory.laneConfidence * 100).toFixed(1)}%), ActVsEscalate: ${system1Sensory.actVsEscalate}`
            }).catch(() => {});
          }
        } catch {}
      }

      return {
        ...turnRecord,
        system1: system1Sensory
      };
    } catch (err) {
      this.logger.warn(`[${this.name}] observeTurn fail-open: ${err.message}`);
      return null;
    }
  }

  /**
   * Evaluate and optionally steer a draft response.
   */
  evaluateOutput(draftText = '', context = {}, query = '') {
    if (!this.running || this.mode === 'off') {
      return { coherent: true, score: 1.0, flags: [], text: draftText };
    }

    try {
      const evaluation = this.selfModel.evaluateDraft(draftText, context, query);
      let outputText = draftText;

      // In SHADOW mode: log observations without modifying output
      if (this.mode === 'shadow') {
        if (!evaluation.coherent) {
          this.stream.recordThought({
            type: 'shadow_critique',
            content: `Flags: ${evaluation.flags.join(', ')}`
          }).catch(() => {});
        }
        if (evaluation.actionGap?.hasGap) {
          this.stream.recordThought({
            type: 'shadow_action_gap',
            content: `Verbal promise without action: ${evaluation.actionGap.suggestedTag}`
          }).catch(() => {});
        }
      }

      // In ACTIVE mode: bridge the verbal-to-action gap automatically
      if (this.mode === 'active' && evaluation.actionGap?.hasGap) {
        outputText = `${draftText}\n\n${evaluation.actionGap.suggestedTag}`;
        this.logger.info(`[${this.name}] 🎯 Active Executive Bridged Action Gap: attached ${evaluation.actionGap.suggestedTag}`);

        // Register followthrough intent to close the loop upon completion
        this.followthrough.registerIntent({
          goalId: `exec_${Date.now()}`,
          taskTitle: query || evaluation.actionGap.suggestedTag,
          channel: context?.channel || 'live_chat',
          channelId: context?.channelId || null,
          user: context?.user || 'Owner'
        });
      }

      return {
        ...evaluation,
        text: outputText
      };
    } catch (err) {
      this.logger.warn(`[${this.name}] evaluateOutput fail-open: ${err.message}`);
      return { coherent: true, score: 1.0, flags: [], text: draftText };
    }
  }

  /**
   * Register a closed-loop followthrough intent.
   */
  registerFollowthroughIntent(intent = {}) {
    return this.followthrough.registerIntent(intent);
  }

  /**
   * Provide executive context to QuadBrain if in ACTIVE mode.
   */
  getExecutiveContext() {
    if (!this.running || this.mode !== 'active') return null;
    try {
      const snapshot = this.stream.getSnapshot();
      const temporalContext = this.stream.getTemporalContext();
      return {
        presence: snapshot.presence,
        elapsedSilenceMs: snapshot.elapsedSilenceMs,
        elapsedHours: snapshot.elapsedHours,
        curiosityDrive: snapshot.curiosityDrive,
        temporalContext,
        attentionFocus: snapshot.attentionFocus
      };
    } catch {
      return null;
    }
  }
}
