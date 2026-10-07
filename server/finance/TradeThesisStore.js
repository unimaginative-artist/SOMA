import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data', 'mission-control');
const THESIS_PATH = path.join(DATA_DIR, 'trade-theses.json');
const AUDIT_PATH = path.join(DATA_DIR, 'trade-thesis-audit.jsonl');

const REQUIRED_EXECUTION_GATES = [
    'freshData',
    'hasEntry',
    'hasStop',
    'hasTarget',
    'hasEvidence',
    'riskDefined'
];

const LIFECYCLE = [
    'draft',
    'enriched',
    'simulated',
    'paper_ready',
    'paper_active',
    'closed',
    'reviewed',
    'promoted',
    'rejected'
];

const STATUS_ALIASES = {
    approved: 'paper_ready',
    active: 'paper_active'
};

const NEXT_ACTION = {
    draft: 'Run Deep Scan',
    enriched: 'Run Backtest',
    simulated: 'Pass gates for paper readiness',
    paper_ready: 'Start paper session',
    paper_active: 'Close and review paper session',
    closed: 'Review outcome',
    reviewed: 'Promote or reject',
    promoted: 'Monitor promoted strategy',
    rejected: 'Create a new thesis'
};

const normalizeArray = value => Array.isArray(value) ? value.filter(Boolean) : [];

const parseNumber = value => {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = status => {
    const raw = String(status || 'draft').toLowerCase();
    const normalized = STATUS_ALIASES[raw] || raw;
    return LIFECYCLE.includes(normalized) ? normalized : 'draft';
};

class TradeThesisStore {
    constructor() {
        this.initialized = false;
        this.theses = [];
    }

    initialize() {
        if (this.initialized) return;
        fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(THESIS_PATH)) fs.writeFileSync(THESIS_PATH, '[]', 'utf8');
        if (!fs.existsSync(AUDIT_PATH)) fs.writeFileSync(AUDIT_PATH, '', 'utf8');
        this._load();
        this.initialized = true;
    }

    _load() {
        try {
            const raw = fs.readFileSync(THESIS_PATH, 'utf8');
            this.theses = JSON.parse(raw || '[]');
            if (!Array.isArray(this.theses)) this.theses = [];
        } catch {
            this.theses = [];
        }
    }

    _persist() {
        fs.writeFileSync(THESIS_PATH, JSON.stringify(this.theses, null, 2), 'utf8');
    }

    _audit(action, thesis, details = {}) {
        const record = {
            id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            action,
            thesisId: thesis?.id || null,
            symbol: thesis?.symbol || null,
            status: thesis?.status || null,
            timestamp: new Date().toISOString(),
            details
        };
        fs.appendFileSync(AUDIT_PATH, `${JSON.stringify(record)}\n`, 'utf8');
        return record;
    }

    validate(thesis = {}) {
        const entryPlan = thesis.entryPlan || {};
        const status = normalizeStatus(thesis.status);
        const gates = {
            lifecycleReady: ['paper_ready', 'paper_active'].includes(status),
            canDeepScan: status === 'draft',
            canBacktest: ['enriched', 'simulated', 'paper_ready'].includes(status),
            canPaperTrade: ['paper_ready', 'paper_active'].includes(status),
            freshData: thesis.dataSource === 'REAL' || thesis.dataAgeSec == null || Number(thesis.dataAgeSec) < 120,
            hasEntry: parseNumber(entryPlan.entry) != null,
            hasStop: parseNumber(entryPlan.stopLoss) != null,
            hasTarget: parseNumber(entryPlan.takeProfit) != null,
            hasEvidence: normalizeArray(thesis.evidenceRefs).length > 0,
            riskDefined: parseNumber(entryPlan.maxLossUsd) != null || parseNumber(entryPlan.stopLoss) != null || normalizeArray(thesis.risks).length > 0,
            directional: ['BUY', 'SELL'].includes(String(entryPlan.direction || '').toUpperCase())
        };
        const blockers = [];
        if (!gates.lifecycleReady) blockers.push('lifecycleReady');
        for (const gate of REQUIRED_EXECUTION_GATES) {
            if (!gates[gate]) blockers.push(gate);
        }
        if (!gates.directional) blockers.push('directional');
        return {
            lifecycle: {
                stages: LIFECYCLE,
                status,
                nextAction: NEXT_ACTION[status] || 'Continue'
            },
            gates,
            blockers,
            executionReady: blockers.length === 0
        };
    }

    _deriveStatus(input, validation) {
        const status = normalizeStatus(input.status);
        if (status === 'simulated' && validation.blockers.length === 1 && validation.blockers[0] === 'lifecycleReady') {
            return 'paper_ready';
        }
        return status;
    }

    upsert(input = {}) {
        this.initialize();
        const now = new Date().toISOString();
        const existingIndex = input.id ? this.theses.findIndex(t => t.id === input.id) : -1;
        const previous = existingIndex >= 0 ? this.theses[existingIndex] : null;
        const id = input.id || `thesis_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        let merged = {
            ...(previous || {}),
            ...input,
            id,
            status: normalizeStatus(input.status ?? previous?.status),
            facts: normalizeArray(input.facts ?? previous?.facts),
            signals: normalizeArray(input.signals ?? previous?.signals),
            assumptions: normalizeArray(input.assumptions ?? previous?.assumptions),
            risks: normalizeArray(input.risks ?? previous?.risks),
            evidenceRefs: normalizeArray(input.evidenceRefs ?? previous?.evidenceRefs),
            createdAt: previous?.createdAt || input.createdAt || now,
            updatedAt: now
        };
        let validation = this.validate(merged);
        const derivedStatus = this._deriveStatus(merged, validation);
        if (derivedStatus !== merged.status) {
            merged = { ...merged, status: derivedStatus };
            validation = this.validate(merged);
        }
        merged.qualityGates = validation.gates;
        merged.lifecycle = validation.lifecycle;
        merged.executionReady = validation.executionReady;
        merged.executionBlockers = validation.blockers;

        if (existingIndex >= 0) this.theses[existingIndex] = merged;
        else this.theses.push(merged);

        this.theses = this.theses
            .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))
            .slice(-500);
        this._persist();
        this._audit(previous ? 'updated' : 'created', merged, { blockers: validation.blockers });
        return merged;
    }

    list({ symbol = null, limit = 50 } = {}) {
        this.initialize();
        let rows = [...this.theses].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
        if (symbol) {
            const normalized = String(symbol).toUpperCase();
            rows = rows.filter(row => String(row.symbol || '').toUpperCase() === normalized);
        }
        return rows.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200)));
    }

    get(id) {
        this.initialize();
        return this.theses.find(t => t.id === id) || null;
    }

    active(symbol = null) {
        const activeStatuses = new Set(['draft', 'enriched', 'simulated', 'paper_ready', 'paper_active']);
        return this.list({ symbol, limit: 200 })
            .find(thesis => activeStatuses.has(normalizeStatus(thesis.status))) || null;
    }

    updateStatus(id, status, details = {}) {
        const thesis = this.get(id);
        if (!thesis) return null;
        return this.upsert({
            ...thesis,
            status,
            statusDetails: details,
            statusUpdatedAt: new Date().toISOString()
        });
    }

    getStatus() {
        this.initialize();
        return {
            count: this.theses.length,
            thesisPath: THESIS_PATH,
            auditPath: AUDIT_PATH,
            latest: this.active()
        };
    }
}

const tradeThesisStore = new TradeThesisStore();
export default tradeThesisStore;
