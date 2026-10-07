const CHEMISTRY_BASELINE = Object.freeze({
  dopamine: 0.5,
  cortisol: 0.1,
  oxytocin: 0.5,
  serotonin: 0.5
});

const FEELING_BASELINE = Object.freeze({
  curiosity: 0.45,
  uncertainty: 0.2,
  alarm: 0.1,
  attachment: 0.5,
  fatigue: 0.2,
  frustration: 0.15,
  satisfaction: 0.45,
  loneliness: 0.35
});

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const rounded = value => Number(clamp01(value).toFixed(4));

export function sanitizeChemistry(input = {}, fallback = CHEMISTRY_BASELINE) {
  const output = {};
  for (const key of Object.keys(CHEMISTRY_BASELINE)) {
    output[key] = Object.hasOwn(input || {}, key) ? rounded(input[key]) : rounded(fallback[key]);
  }
  return output;
}

export function deriveFeelingsFromChemistry(chemistry = CHEMISTRY_BASELINE, explicit = {}) {
  const c = sanitizeChemistry(chemistry);
  const derived = {
    curiosity: 0.17 + c.dopamine * 0.45 + c.serotonin * 0.15 - c.cortisol * 0.2,
    uncertainty: 0.045 + c.cortisol * 0.55 + (1 - c.serotonin) * 0.2,
    alarm: c.cortisol,
    attachment: c.oxytocin,
    fatigue: 0.2 + Math.max(0, 0.5 - c.serotonin) + Math.max(0, 0.5 - c.dopamine) * 0.7,
    frustration: 0.115 + c.cortisol * 0.35 + Math.max(0, 0.5 - c.dopamine) * 1.1,
    satisfaction: c.serotonin * 0.55 + c.dopamine * 0.45 - 0.05,
    loneliness: 0.35 + Math.max(0, 0.5 - c.oxytocin) * 1.2 + Math.max(0, 0.5 - c.serotonin) * 0.2
  };
  for (const key of Object.keys(FEELING_BASELINE)) {
    if (Object.hasOwn(explicit || {}, key)) derived[key] = explicit[key];
    derived[key] = rounded(derived[key]);
  }
  return derived;
}

function decayToward(value, baseline, elapsedMs, halfLifeMs) {
  if (elapsedMs <= 0) return value;
  const retention = Math.pow(0.5, elapsedMs / halfLifeMs);
  return baseline + (value - baseline) * retention;
}

function taskKind(context = {}, prompt = '') {
  if (context.taskKind) return String(context.taskKind).toLowerCase();
  const text = `${context.role || ''} ${context.source || ''} ${prompt}`.toLowerCase();
  if (/robot|embodiment|motion|actuat|safety|security|risk|trading|finance|medical|legal/.test(text)) return 'safety_critical';
  if (/code|debug|engineer|research|evidence|fact|calculate|analysis/.test(text)) return 'factual';
  if (/creative|story|poem|brainstorm|imagine|art|fiction/.test(text)) return 'creative';
  return 'conversation';
}

export class LimbicCognitivePolicy {
  constructor({ now = () => Date.now(), halfLifeMs = 2 * 60 * 60 * 1000, maxSignalAgeMs = 30 * 60 * 1000 } = {}) {
    this.now = now;
    this.halfLifeMs = halfLifeMs;
    this.maxSignalAgeMs = maxSignalAgeMs;
    this.chemistry = { ...CHEMISTRY_BASELINE };
    this.explicitFeelings = {};
    this.observedAt = this.now();
    this.provenance = { source: 'baseline', confidence: 1, observedAt: this.observedAt, reason: 'initial_homeostasis' };
  }

  ingest({ chemistry = null, feelings = null, source = 'unknown', confidence = 0.5, observedAt = this.now(), reason = '' } = {}) {
    const timestamp = Number(observedAt);
    const ageMs = this.now() - timestamp;
    if (!Number.isFinite(timestamp) || ageMs < -60_000 || ageMs > this.maxSignalAgeMs) {
      return { accepted: false, reason: 'stale_or_invalid_affective_signal', ageMs };
    }
    if (chemistry) this.chemistry = sanitizeChemistry(chemistry, this.chemistry);
    if (feelings) {
      for (const key of Object.keys(FEELING_BASELINE)) {
        if (Object.hasOwn(feelings, key)) this.explicitFeelings[key] = rounded(feelings[key]);
      }
    }
    this.observedAt = timestamp;
    this.provenance = {
      source: String(source || 'unknown').slice(0, 120),
      confidence: rounded(confidence),
      observedAt: timestamp,
      reason: String(reason || '').slice(0, 240)
    };
    return { accepted: true, snapshot: this.snapshot() };
  }

  snapshot(at = this.now()) {
    const elapsedMs = Math.max(0, at - this.observedAt);
    const chemistry = {};
    for (const key of Object.keys(CHEMISTRY_BASELINE)) {
      chemistry[key] = rounded(decayToward(this.chemistry[key], CHEMISTRY_BASELINE[key], elapsedMs, this.halfLifeMs));
    }
    const rawFeelings = deriveFeelingsFromChemistry(chemistry, this.explicitFeelings);
    const feelings = {};
    for (const key of Object.keys(FEELING_BASELINE)) {
      feelings[key] = rounded(decayToward(rawFeelings[key], FEELING_BASELINE[key], elapsedMs, this.halfLifeMs));
    }
    return {
      chemistry,
      feelings,
      provenance: {
        ...this.provenance,
        ageMs: elapsedMs,
        effectiveConfidence: rounded(decayToward(this.provenance.confidence, 0, elapsedMs, this.halfLifeMs))
      }
    };
  }

  cognitivePolicy(context = {}, prompt = '') {
    const snapshot = this.snapshot();
    const f = snapshot.feelings;
    const kind = taskKind(context, prompt);
    const bounds = kind === 'creative' ? [0.35, 0.95]
      : kind === 'conversation' ? [0.25, 0.8]
        : kind === 'factual' ? [0.1, 0.5]
          : [0.05, 0.4];
    const base = Number.isFinite(Number(context.temperature)) ? Number(context.temperature)
      : kind === 'creative' ? 0.72
        : kind === 'conversation' ? 0.62
          : kind === 'factual' ? 0.35
            : 0.25;
    const temperature = Math.max(bounds[0], Math.min(bounds[1], base + f.curiosity * 0.12 - f.alarm * 0.18 - f.uncertainty * 0.12));
    return {
      kind,
      temperature: Number(temperature.toFixed(2)),
      temperatureBounds: bounds,
      lobeOffsets: {
        THALAMUS: rounded(f.alarm * 0.25 + f.uncertainty * 0.12),
        LOGOS: rounded(f.uncertainty * 0.12 + f.frustration * 0.08),
        AURORA: rounded(f.curiosity * 0.18),
        PROMETHEUS: rounded(f.satisfaction * 0.12)
      },
      needsObservation: f.uncertainty >= 0.7,
      strategyChangeRequired: f.frustration >= 0.7,
      urgencyScale: Number(Math.max(0.45, 1 - f.satisfaction * 0.35 - f.fatigue * 0.2).toFixed(3)),
      authorityImpact: 'advisory_governed',
      riskFactor: this.getRiskAdjustmentFactor().riskFactor,
      snapshot
    };
  }

  getRiskAdjustmentFactor() {
    const snapshot = this.snapshot();
    const f = snapshot.feelings;
    const c = snapshot.chemistry;
    // Scale risk factor between 0.2 and 1.0 based on alarm, cortisol, and uncertainty
    const riskFactor = Math.max(0.2, Number((1 - (f.alarm * 0.4 + c.cortisol * 0.3 + f.uncertainty * 0.2)).toFixed(3)));
    const cycleDelayMultiplier = f.fatigue >= 0.7 ? 2.0 : f.fatigue >= 0.5 ? 1.4 : 1.0;
    const explorationMultiplier = Number((1 + f.curiosity * 0.5).toFixed(3));

    return {
      riskFactor,
      cycleDelayMultiplier,
      explorationMultiplier,
      authorityImpact: 'advisory_governed',
      alarm: f.alarm,
      cortisol: c.cortisol,
      curiosity: f.curiosity,
      fatigue: f.fatigue
    };
  }

  async persistToFile(targetPath = 'limbic-state.json') {
    try {
      const fs = await import('node:fs/promises');
      const snapshot = this.snapshot();
      const payload = {
        systemWeather: snapshot.feelings.alarm >= 0.7 ? 'STORMY' : snapshot.feelings.alarm >= 0.4 ? 'OVERCAST' : 'CLEAR',
        limbicState: snapshot.chemistry,
        feelings: snapshot.feelings,
        authorityImpact: 'advisory_governed',
        riskAdjustment: this.getRiskAdjustmentFactor(),
        savedAt: new Date().toISOString()
      };
      await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  embodimentPolicy() {
    const snapshot = this.snapshot();
    const f = snapshot.feelings;
    return {
      holdMotion: f.alarm >= 0.85,
      requiresConfirmationObservation: f.uncertainty >= 0.7,
      motionScale: Number(Math.max(0.15, 1
        - Math.max(0, f.fatigue - FEELING_BASELINE.fatigue) * 0.65
        - Math.max(0, f.uncertainty - FEELING_BASELINE.uncertainty) * 0.35
        - Math.max(0, f.alarm - FEELING_BASELINE.alarm) * 0.45).toFixed(3)),
      chargingRecommended: f.fatigue >= 0.75,
      sensorAttentionBoost: Number((1 + f.curiosity * 0.75).toFixed(3)),
      familiarAttentionBoost: Number((1 + f.attachment * 0.35).toFixed(3)),
      strategyChangeRequired: f.frustration >= 0.7,
      socialEngagementSuggested: f.loneliness >= 0.75,
      socialCooldownRequired: true,
      authorityImpact: 'advisory_governed',
      snapshot
    };
  }
}

export const LIMBIC_BASELINES = Object.freeze({ chemistry: CHEMISTRY_BASELINE, feelings: FEELING_BASELINE });

export default LimbicCognitivePolicy;
