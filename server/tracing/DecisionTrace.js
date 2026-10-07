/**
 * server/tracing/DecisionTrace.js
 *
 * Decision explainability layer. Every autonomous decision SOMA makes
 * can be traced back to: which signals fired, which arbiters voted,
 * what memories were recalled, what the confidence was at each step.
 *
 * Traces are sealed into the AuditLedger so they're tamper-evident.
 * Can answer "why did you decide X?" for any decision with a traceId.
 */

import fs from 'fs';
import path from 'path';

const TRACES_PATH = path.join(process.cwd(), 'data', 'decision-traces.jsonl');

class DecisionTrace {
    constructor({ traceId = null, actor = 'SOMA', context = '' } = {}) {
        this.id        = traceId || `dt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.actor     = actor;
        this.context   = context;
        this.startedAt = new Date().toISOString();
        this.steps     = [];
        this.signals   = [];
        this.memories  = [];
        this.outcome   = null;
        this.confidence = null;
        this.sealed    = false;
    }

    /** Record a reasoning step (arbiter vote, analysis pass, etc.) */
    addStep(label, detail = '', confidence = null) {
        this.steps.push({
            label, detail,
            confidence: confidence !== null ? parseFloat(confidence.toFixed(3)) : null,
            ts: new Date().toISOString()
        });
        return this;
    }

    /** Record which signals triggered this decision */
    addSignal(type, payload = {}) {
        this.signals.push({ type, payload, ts: new Date().toISOString() });
        return this;
    }

    /** Record memory hits that influenced the decision */
    addMemory(content, similarity = null) {
        this.memories.push({ content: String(content || '').slice(0, 300), similarity });
        return this;
    }

    /** Seal the trace with final outcome and confidence */
    seal({ outcome = 'unknown', confidence = 0, auditLedger = null } = {}) {
        if (this.sealed) return this;
        this.outcome    = outcome;
        this.confidence = parseFloat(confidence.toFixed(3));
        this.sealedAt   = new Date().toISOString();
        this.sealed     = true;

        // Persist to append-only JSONL file
        try {
            const line = JSON.stringify(this.toJSON()) + '\n';
            fs.appendFileSync(TRACES_PATH, line, 'utf8');
        } catch {}

        // Also seal into the AuditLedger chain if available
        if (auditLedger) {
            try {
                auditLedger.append({
                    actor:    this.actor,
                    action:   'decision_sealed',
                    metadata: {
                        traceId:    this.id,
                        context:    this.context.slice(0, 200),
                        outcome,
                        confidence: this.confidence,
                        stepCount:  this.steps.length,
                        signalCount: this.signals.length,
                        memoryCount: this.memories.length
                    }
                });
            } catch {}
        }

        return this;
    }

    toJSON() {
        return {
            id:         this.id,
            actor:      this.actor,
            context:    this.context,
            startedAt:  this.startedAt,
            sealedAt:   this.sealedAt,
            outcome:    this.outcome,
            confidence: this.confidence,
            steps:      this.steps,
            signals:    this.signals,
            memories:   this.memories
        };
    }

    /** Explain this decision in human-readable form */
    explain() {
        const lines = [
            `Decision: ${this.context || this.id}`,
            `Actor: ${this.actor} | Outcome: ${this.outcome} | Confidence: ${this.confidence}`,
            `Started: ${this.startedAt}`,
        ];
        if (this.signals.length) {
            lines.push(`\nTriggers (${this.signals.length}):`);
            this.signals.forEach(s => lines.push(`  • ${s.type}: ${JSON.stringify(s.payload).slice(0, 100)}`));
        }
        if (this.memories.length) {
            lines.push(`\nMemory context (${this.memories.length}):`);
            this.memories.forEach(m => lines.push(`  • [${m.similarity?.toFixed(2) || '?'}] ${m.content}`));
        }
        if (this.steps.length) {
            lines.push(`\nReasoning steps (${this.steps.length}):`);
            this.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${s.label}${s.confidence !== null ? ` [${s.confidence}]` : ''}: ${s.detail}`));
        }
        return lines.join('\n');
    }
}

// ── Static query helpers ────────────────────────────────────────────────────

/** Read the last N traces from the JSONL log */
function getRecentTraces(limit = 50) {
    try {
        if (!fs.existsSync(TRACES_PATH)) return [];
        const lines = fs.readFileSync(TRACES_PATH, 'utf8').trim().split('\n').filter(Boolean);
        return lines.slice(-limit).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {
        return [];
    }
}

/** Find a specific trace by ID */
function getTrace(id) {
    try {
        const traces = getRecentTraces(1000);
        return traces.find(t => t.id === id) || null;
    } catch {
        return null;
    }
}

export { DecisionTrace, getRecentTraces, getTrace };
export default DecisionTrace;
