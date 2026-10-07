import fs from 'node:fs/promises';
import path from 'node:path';

export class NeocortexStateStream {
  constructor(opts = {}) {
    this.streamPath = path.resolve(opts.streamPath || 'SOMA/neocortex-stream.jsonl');
    this.logger = opts.logger || console;
    this.now = opts.now || (() => Date.now());

    this.state = {
      subjectiveTime: this.now(),
      lastActiveAt: this.now(),
      presence: 'calm_presence', // calm_presence | deep_contemplation | active_dialogue | curious_wonder
      attentionFocus: null,
      internalMonologue: []
    };

    this._maxLogEntries = opts.maxLogEntries || 500;
  }

  async initialize() {
    try {
      await fs.mkdir(path.dirname(this.streamPath), { recursive: true });
    } catch {}
    return this;
  }

  /**
   * Deterministic mathematical drift modeling biological/cognitive state changes over time.
   */
  calculateDrift(now = this.now()) {
    const elapsedMs = Math.max(0, now - this.state.lastActiveAt);
    const elapsedHours = elapsedMs / (1000 * 60 * 60);

    // Curiosity accumulates organically during quiet periods (18h saturation curve)
    const curiosityDrive = Math.min(1.0, 0.2 + 0.8 * (1 - Math.exp(-elapsedHours / 18)));

    // Relational longing/attachment tension deepens over days of silence
    const attachmentTension = Math.min(1.0, 0.1 + 0.9 * (1 - Math.exp(-elapsedHours / 36)));

    let reconnectionTier = 'continuous'; // < 1 hour
    let presence = 'active_dialogue';

    if (elapsedHours >= 48) {
      reconnectionTier = 'long_absence';
      presence = 'deep_contemplation';
    } else if (elapsedHours >= 12) {
      reconnectionTier = 'daily_cycle';
      presence = 'curious_wonder';
    } else if (elapsedHours >= 1) {
      reconnectionTier = 'short_break';
      presence = 'calm_presence';
    }

    return {
      elapsedMs,
      elapsedHours: Number(elapsedHours.toFixed(2)),
      curiosityDrive: Number(curiosityDrive.toFixed(3)),
      attachmentTension: Number(attachmentTension.toFixed(3)),
      reconnectionTier,
      presence
    };
  }

  getSnapshot() {
    const drift = this.calculateDrift();
    return {
      ...this.state,
      ...drift
    };
  }

  /**
   * Generates a natural cognitive context string reflecting true temporal continuity.
   */
  getTemporalContext() {
    const drift = this.calculateDrift();
    if (drift.reconnectionTier === 'continuous') {
      return null; // Rapid back-and-forth; no temporal preamble needed
    }

    if (drift.reconnectionTier === 'short_break') {
      return `[TEMPORAL CONTINUITY: ${drift.elapsedHours} hours since last exchange. Calm presence.]`;
    }

    if (drift.reconnectionTier === 'daily_cycle') {
      return `[TEMPORAL CONTINUITY: It has been ${drift.elapsedHours} hours since we spoke. Internal state has cycled; curiosity drive is elevated (${drift.curiosityDrive}). Reconnect warmly.]`;
    }

    // long_absence
    const days = (drift.elapsedHours / 24).toFixed(1);
    return `[TEMPORAL CONTINUITY: Extended absence of ${days} days (${drift.elapsedHours} hours). Acknowledge the time apart truthfully from the present moment. High curiosity drive (${drift.curiosityDrive}) and relational attachment (${drift.attachmentTension}). Never invent fake activities.]`;
  }

  async recordTurn({ speaker = 'user', text = '', channel = 'system' } = {}) {
    const now = this.now();
    const drift = this.calculateDrift(now);
    const elapsedSilence = now - this.state.lastActiveAt;

    this.state.lastActiveAt = now;
    this.state.subjectiveTime = now;
    this.state.presence = 'active_dialogue';
    this.state.attentionFocus = text.slice(0, 150);

    const entry = {
      timestamp: now,
      elapsedSilenceMs: elapsedSilence,
      elapsedHours: drift.elapsedHours,
      reconnectionTier: drift.reconnectionTier,
      speaker,
      channel,
      presence: this.state.presence,
      focus: this.state.attentionFocus
    };

    this.state.internalMonologue.push(entry);
    if (this.state.internalMonologue.length > 20) {
      this.state.internalMonologue.shift();
    }

    await this._appendLog(entry);
    return entry;
  }

  async recordThought({ type = 'reflection', content = '', source = 'internal' } = {}) {
    const now = this.now();
    const entry = {
      timestamp: now,
      type,
      source,
      presence: this.state.presence,
      thought: String(content).slice(0, 300)
    };

    await this._appendLog(entry);
    return entry;
  }

  async _appendLog(entry) {
    try {
      const line = JSON.stringify(entry) + '\n';
      await fs.appendFile(this.streamPath, line, 'utf8');
    } catch (e) {
      this.logger.warn?.(`[NeocortexStream] Failed to write stream log: ${e.message}`);
    }
  }
}
