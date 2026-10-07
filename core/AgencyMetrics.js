import fs from 'node:fs/promises';
import path from 'node:path';

/** Evidence-grounded metrics derived from cognitive transaction receipts. */
export class AgencyMetrics {
    constructor({ ledgerPath = 'SOMA/agency-metrics.jsonl' } = {}) {
        this.ledgerPath = path.resolve(ledgerPath);
        this.events = [];
    }

    async initialize() {
        try {
            const rows = (await fs.readFile(this.ledgerPath, 'utf8'))
                .split(/\r?\n/)
                .filter(Boolean)
                .slice(-1000)
                // Preserve valid history when an interrupted append leaves one
                // malformed legacy row behind.
                .map(line => {
                    try { return JSON.parse(line); } catch { return null; }
                })
                .filter(event => event && Number.isFinite(Number(event.timestamp)));
            this.events = rows;
        } catch { /* first boot or an invalid legacy ledger */ }
        return this;
    }

    async record(transaction) {
        const observed = transaction.observed || {};
        const event = {
            timestamp: transaction.finishedAt || Date.now(),
            transactionId: transaction.id,
            lane: transaction.classification?.lane || 'unknown',
            domain: transaction.classification?.domain || 'general',
            success: observed.success === true,
            verified: observed.verified === true,
            toolBacked: (observed.toolsUsed?.length || 0) > 0,
            evidenceBacked: Boolean(observed.evidence) || observed.observationCount > 0,
            failed: Boolean(transaction.error) || observed.success === false,
            durationMs: transaction.durationMs || 0
        };
        this.events.push(event);
        if (this.events.length > 1000) this.events.shift();
        await fs.mkdir(path.dirname(this.ledgerPath), { recursive: true });
        await fs.appendFile(this.ledgerPath, `${JSON.stringify(event)}\n`, 'utf8');
        return event;
    }

    summarize(limit = 100) {
        const events = this.events.slice(-Math.max(1, limit));
        const count = events.length;
        const ratio = predicate => count ? events.filter(predicate).length / count : 0;
        const byDomain = {};
        for (const event of events) {
            const bucket = byDomain[event.domain] ||= { total: 0, successful: 0, verified: 0, toolBacked: 0 };
            bucket.total++;
            if (event.success) bucket.successful++;
            if (event.verified) bucket.verified++;
            if (event.toolBacked) bucket.toolBacked++;
        }
        return {
            transactions: count,
            agenticRate: ratio(e => e.lane === 'agentic'),
            specialistRate: ratio(e => e.lane === 'specialist'),
            successRate: ratio(e => e.success),
            verifiedRate: ratio(e => e.verified),
            toolBackedRate: ratio(e => e.toolBacked),
            evidenceBackedRate: ratio(e => e.evidenceBacked),
            failureRate: ratio(e => e.failed),
            byDomain
        };
    }

    compareWindows(size = 25) {
        const recent = this.events.slice(-size);
        const prior = this.events.slice(-(size * 2), -size);
        const summarize = events => {
            const original = this.events;
            this.events = events;
            const result = this.summarize(events.length || 1);
            this.events = original;
            return result;
        };
        const before = summarize(prior);
        const after = summarize(recent);
        return {
            before,
            after,
            delta: {
                successRate: after.successRate - before.successRate,
                verifiedRate: after.verifiedRate - before.verifiedRate,
                toolBackedRate: after.toolBackedRate - before.toolBackedRate,
                evidenceBackedRate: after.evidenceBackedRate - before.evidenceBackedRate
            },
            valid: prior.length === size && recent.length === size
        };
    }
}

export default AgencyMetrics;
