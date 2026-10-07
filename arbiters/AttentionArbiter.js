/**
 * arbiters/AttentionArbiter.js
 * 
 * The Gatekeeper of SOMA's consciousness.
 * Sits between the CNS and Decision Arbiters to manage focus and noise.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import messageBroker from '../core/MessageBroker.cjs';

export class AttentionArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'AttentionArbiter',
            role: ArbiterRole.SUPERVISOR,
            capabilities: [ArbiterCapability.MONITOR_HEALTH]
        });

        this.focusTopic = 'general';
        this.focusExpiry = null;
        this.loadThreshold = opts.loadThreshold || 80; // CPU load to start dropping low-priority signals
        this.systemHealth = { cpuUsage: 0, ramUsage: 0 };
    }

    async onInitialize() {
        // Subscribe to all health metrics to adjust attention filters
        messageBroker.subscribe('health.metrics', (signal) => {
            this.systemHealth = signal.payload;
        });

        // Subscribe to global signals to manage "Focus"
        messageBroker.subscribe('ui.navigate', (signal) => {
            this.setFocus(signal.payload.module, 60000); // 1 minute focus on new tab
        });

        this.auditLogger.info('AttentionArbiter initialized');

        // 🔱 RESONANCE SYNC: Align attention with the cognitive heartbeat
        messageBroker.subscribe('system.resonance.pulse', (pulse) => {
            this._handleResonancePulse(pulse);
        });
    }

    /**
     * Handle the 400ms resonance pulse.
     * Modulates attention based on rhythmic coherence.
     */
    _handleResonancePulse(pulse) {
        // High resonance score (activity) allows more signals through
        // Low resonance (idle) tightens the gate
        const thresholdMod = (pulse.score - 0.5) * 20;
        this.loadThreshold = Math.max(40, Math.min(95, 80 + thresholdMod));
        
        // Log pulse occasionally to audit rhythm
        if (Math.random() > 0.99) {
            this.auditLogger.info(`❤️ Heartbeat Sync: score=${pulse.score} loadThreshold=${this.loadThreshold.toFixed(1)}`);
        }
    }

    /**
     * Set the system's global focus topic
     */
    setFocus(topic, durationMs = 0) {
        this.focusTopic = topic;
        this.focusExpiry = durationMs ? Date.now() + durationMs : null;
        this.auditLogger.info(`[Attention] Focus shifted to: ${topic}`);
        
        // Broadcast focus shift to the CNS
        messageBroker.publish('system.focus.shifted', { topic, durationMs });
    }

    /**
     * Analyze intent and recommend a cognitive lobe for the task.
     * Maps user query to: LOGOS | AURORA | PROMETHEUS | THALAMUS
     */
    recommendLobe(query = '') {
        const text = query.toLowerCase();
        
        // 1. THALAMUS (Security, Risk, Policy)
        if (/\b(security|risk|policy|safe|threat|anomal|audit|govern|permission|block|deny)\b/i.test(text)) {
            return 'THALAMUS';
        }
        
        // 2. LOGOS (Logic, Code, Architecture, Quantitative Trading / Wolf)
        if (/\b(code|bug|error|refactor|debug|architect|system|logic|math|api|file|module|implementation|trade|trading|strike|quant|crypto|bitcoin|btc|eth|solana|stock|orderbook|killzone|breakout|vwap|indicator)\b/i.test(text)) {
            return 'LOGOS';
        }
        
        // 3. AURORA (Creativity, Soul, Identity, City Vibe)
        if (/\b(feel|vibe|soul|identity|creat|poem|story|narrative|beautiful|aesthetic|emotion|personality|city|dream)\b/i.test(text)) {
            return 'AURORA';
        }
        
        // 4. PROMETHEUS (Strategy, Goals, Outcomes, Capital Allocation)
        if (/\b(goal|plan|strategy|roadmap|decision|priority|outcome|milestone|business|market|growth|tradeoff|portfolio|capital|allocation|expectancy)\b/i.test(text)) {
            return 'PROMETHEUS';
        }
        
        // Default to LOGOS for analytical/general reasoning
        return 'LOGOS';
    }

    /**
     * Soft attention gate (v2): score signals 0–1 instead of binary pass/fail.
     * Returns { pass: boolean, score: number } so MessageBroker can tier delivery.
     *
     * Score bands:
     *   ≥ 0.70 — deliver immediately (high-relevance)
     *   0.30–0.69 — deliver normally
     *   0.10–0.29 — defer to 200 ms batch (low bandwidth)
     *   < 0.10 (under load) — suppress
     */
    evaluateSignal(signal) {
        const { type = '', priority, payload } = signal;

        // Emergency/high always score maximum — never batched
        if (priority === 'emergency') return { pass: true, score: 1.0 };
        if (priority === 'high')      return { pass: true, score: 0.85 };

        let score = 0.5;

        // Priority nudge
        if (priority === 'low') score -= 0.2;

        // Focus expiration check
        if (this.focusExpiry && Date.now() > this.focusExpiry) {
            this.focusTopic = 'general';
            this.focusExpiry = null;
        }

        // Focus match boost (only meaningful when focus is specific)
        if (this.focusTopic !== 'general') {
            const matchesFocus = type.includes(this.focusTopic) ||
                (payload && JSON.stringify(payload).includes(this.focusTopic));
            if (matchesFocus) score += 0.25;
        }

        // Signal type scoring
        if (type.includes('heartbeat'))    score -= 0.3;  // background noise
        if (type.includes('health.metrics')) score -= 0.1; // frequent polling
        if (type.includes('error') || type.includes('warning')) score += 0.2;
        if (type.includes('goal'))         score += 0.15;
        if (type.includes('update'))       score += 0.1;

        // CPU load pressure: suppress low-scoring signals harder under load
        const underLoad = this.systemHealth.cpuUsage > this.loadThreshold;
        if (underLoad && score < 0.5) score -= 0.15;

        score = Math.max(0, Math.min(1, score));

        // Under load: harder pass threshold; otherwise allow most through
        const pass = underLoad ? score >= 0.35 : score > 0.10;
        return { pass, score };
    }

    /**
     * Backward-compat binary gate — delegates to evaluateSignal().
     * MessageBroker v2 prefers evaluateSignal(); this stays for any legacy callers.
     */
    shouldNotice(signal) {
        return this.evaluateSignal(signal).pass;
    }

    async handleMessage(message) {
        // Traditional message handling if needed
        return super.handleMessage(message);
    }
}

// Ensure compatibility with the loader which expects default export
export default AttentionArbiter;
