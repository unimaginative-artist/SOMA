import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

function atomicWrite(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
    fs.renameSync(temporary, filePath);
}

/** Evaluation ledger; changes routing trust, never model weights or permissions. */
export class CouncilOutcomeLedger {
    constructor({ statePath = path.resolve('data/large-council-outcomes.json'), limit = 500 } = {}) {
        this.statePath = statePath;
        this.limit = Math.max(50, Number(limit) || 500);
    }

    _read() {
        try { return JSON.parse(fs.readFileSync(this.statePath, 'utf8')); }
        catch { return { version: 1, runs: [], outcomes: [] }; }
    }

    _save(state) {
        state.runs = (state.runs || []).slice(-this.limit);
        state.outcomes = (state.outcomes || []).slice(-this.limit);
        atomicWrite(this.statePath, state);
    }

    recordRun(run = {}) {
        const state = this._read();
        state.runs.push({ at: new Date().toISOString(), ...run });
        this._save(state);
        return state.runs.at(-1);
    }

    recordOutcome(runId, { success, qualityScore = null, operatorCorrection = null, notes = null } = {}) {
        const state = this._read();
        const outcome = {
            at: new Date().toISOString(), runId: String(runId), success: success === true,
            qualityScore: Number.isFinite(Number(qualityScore)) ? Number(qualityScore) : null,
            operatorCorrection: operatorCorrection ? String(operatorCorrection).slice(0, 4000) : null,
            notes: notes ? String(notes).slice(0, 4000) : null
        };
        state.outcomes.push(outcome);
        this._save(state);
        return outcome;
    }

    summary() {
        const state = this._read();
        const paired = state.outcomes.filter(item => item.success !== undefined);
        const latencies = state.runs.map(run => Number(run.durationMs)).filter(Number.isFinite).sort((a, b) => a - b);
        const summary = {
            runs: state.runs.length,
            measuredOutcomes: paired.length,
            successRate: paired.length ? paired.filter(item => item.success).length / paired.length : null,
            averageQuality: paired.filter(item => item.qualityScore !== null).length
                ? paired.filter(item => item.qualityScore !== null).reduce((sum, item) => sum + item.qualityScore, 0) / paired.filter(item => item.qualityScore !== null).length
                : null,
            p95LatencyMs: latencies.length ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] : null,
            corrections: paired.filter(item => item.operatorCorrection).length
        };
        return { ...summary, routingRecommendation: this.routingRecommendation(summary) };
    }

    routingRecommendation(summary = null, {
        minimumOutcomes = 10,
        minimumSuccessRate = 0.8,
        minimumQuality = 0.75,
        maximumCorrectionRate = 0.2,
        maximumP95LatencyMs = 6 * 60_000
    } = {}) {
        const metrics = summary || this.summary();
        const correctionRate = metrics.measuredOutcomes
            ? metrics.corrections / metrics.measuredOutcomes
            : null;
        if (metrics.measuredOutcomes < minimumOutcomes) {
            return {
                mode: 'shadow_only',
                eligibleForAutomaticRouting: false,
                reason: `needs_${minimumOutcomes - metrics.measuredOutcomes}_more_measured_outcomes`,
                correctionRate
            };
        }
        const eligible = metrics.successRate >= minimumSuccessRate
            && metrics.averageQuality >= minimumQuality
            && correctionRate <= maximumCorrectionRate
            && metrics.p95LatencyMs <= maximumP95LatencyMs;
        return {
            mode: eligible ? 'eligible_for_complex_auto_route' : 'explicit_only',
            eligibleForAutomaticRouting: eligible,
            reason: eligible ? 'measured_quality_gate_passed' : 'measured_quality_gate_failed',
            correctionRate
        };
    }
}

export default CouncilOutcomeLedger;
