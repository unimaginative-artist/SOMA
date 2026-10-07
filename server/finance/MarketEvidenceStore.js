import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DATA_DIR = path.join(process.cwd(), 'data', 'market-evidence');
const JSONL_PATH = path.join(DATA_DIR, 'evidence-ledger.jsonl');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'evidence-summary.json');

const TYPE_LIMITS = {
    market_data: 200,
    deep_scan: 250,
    simulation: 250,
    strategy_registry: 200,
    autonomous_decision: 500,
    paper_trade: 300,
    manual_broker_order: 200,
    performance: 200,
    promotion: 200,
    live_execution: 200,
    system: 100
};

class MarketEvidenceStore {
    constructor() {
        this.initialized = false;
        this.recent = [];
        this.maxRecent = 1000;
    }

    initialize() {
        if (this.initialized) return this.getStatus();
        fs.mkdirSync(DATA_DIR, { recursive: true });
        if (!fs.existsSync(JSONL_PATH)) fs.writeFileSync(JSONL_PATH, '', 'utf8');
        this._hydrateRecent();
        this.initialized = true;
        this._writeSummary();
        return this.getStatus();
    }

    _hydrateRecent() {
        try {
            // Never synchronously load the entire append-only ledger. The file
            // can be hundreds of MB and used to freeze every API route when the
            // first post-boot trading event initialized this store.
            const stat = fs.statSync(JSONL_PATH);
            let bytes = Math.min(stat.size, 4 * 1024 * 1024);
            let raw = '';
            while (bytes <= Math.min(stat.size, 32 * 1024 * 1024)) {
                const fd = fs.openSync(JSONL_PATH, 'r');
                try {
                    const buffer = Buffer.allocUnsafe(bytes);
                    fs.readSync(fd, buffer, 0, bytes, stat.size - bytes);
                    raw = buffer.toString('utf8');
                } finally {
                    fs.closeSync(fd);
                }
                const lineCount = (raw.match(/\n/g) || []).length;
                if (lineCount >= this.maxRecent || bytes === stat.size) break;
                bytes = Math.min(stat.size, bytes * 2);
            }
            // A tail read may begin in the middle of a UTF-8/JSONL record.
            if (bytes < stat.size) raw = raw.slice(raw.indexOf('\n') + 1);
            raw = raw.trim();
            if (!raw) {
                this.recent = [];
                return;
            }
            this.recent = raw
                .split(/\r?\n/)
                .slice(-this.maxRecent)
                .map(line => {
                    try { return JSON.parse(line); } catch { return null; }
                })
                .filter(Boolean);
        } catch {
            this.recent = [];
        }
    }

    append(type, payload = {}, options = {}) {
        this.initialize();
        const eventType = type || 'system';
        const timestamp = options.timestamp || new Date().toISOString();
        const source = options.source || payload.source || 'SOMA';
        const symbol = options.symbol || payload.symbol || payload.marketSnapshot?.symbol || null;
        const strategyId = options.strategyId || payload.strategyId || payload.strategy?.id || payload.strategy || null;
        const parentEvidenceIds = Array.isArray(options.parentEvidenceIds)
            ? options.parentEvidenceIds
            : Array.isArray(payload.parentEvidenceIds) ? payload.parentEvidenceIds : [];
        const hashInput = JSON.stringify({ eventType, timestamp, source, symbol, strategyId, payload, parentEvidenceIds });
        const evidenceId = options.evidenceId || `ev_${Date.now()}_${crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 10)}`;
        const record = {
            evidenceId,
            type: eventType,
            timestamp,
            source,
            symbol,
            strategyId,
            parentEvidenceIds,
            payload
        };

        fs.appendFileSync(JSONL_PATH, `${JSON.stringify(record)}\n`, 'utf8');
        this.recent.push(record);
        if (this.recent.length > this.maxRecent) this.recent = this.recent.slice(-this.maxRecent);
        this._writeSummary();
        return record;
    }

    isAllowedType(type) {
        return Object.prototype.hasOwnProperty.call(TYPE_LIMITS, type);
    }

    query({ symbol = null, type = null, limit = 100 } = {}) {
        this.initialize();
        let rows = [...this.recent].reverse();
        if (symbol) {
            const normalized = String(symbol).toUpperCase();
            rows = rows.filter(row => String(row.symbol || '').toUpperCase() === normalized);
        }
        if (type) rows = rows.filter(row => row.type === type);
        return rows.slice(0, Math.max(1, Math.min(Number(limit) || 100, 1000)));
    }

    summarize() {
        this.initialize();
        return this._buildSummary();
    }

    _buildSummary() {
        const byType = {};
        const bySymbol = {};
        for (const row of this.recent) {
            byType[row.type] = (byType[row.type] || 0) + 1;
            if (row.symbol) bySymbol[row.symbol] = (bySymbol[row.symbol] || 0) + 1;
        }
        return {
            totalRecent: this.recent.length,
            byType,
            bySymbol,
            latest: this.recent.at(-1) || null,
            ledgerPath: JSONL_PATH,
            snapshotPath: SNAPSHOT_PATH,
            policy: {
                appendOnly: true,
                promotionRequiresEvidence: true,
                liveExecutionMustReferenceEvidence: true,
                typeRetentionTargets: TYPE_LIMITS
            }
        };
    }

    _writeSummary() {
        try {
            fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(this._buildSummary(), null, 2), 'utf8');
        } catch {
            // Summary is a convenience; the jsonl ledger is authoritative.
        }
    }

    getStatus() {
        return {
            initialized: this.initialized,
            ledgerPath: JSONL_PATH,
            recentCount: this.recent.length
        };
    }
}

const marketEvidenceStore = new MarketEvidenceStore();
export default marketEvidenceStore;
