import fs from 'node:fs';
import path from 'node:path';
import { buildTradingStrategyIdentity } from './TradingStrategyIdentity.js';

const STATE_PATH = path.join(process.cwd(), 'data', 'trading', 'pruner-quarantine.json');
const REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60_000;

function readState() {
    try {
        const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        return { version: 2, quarantines: parsed?.quarantines || {} };
    } catch {
        return { version: 2, quarantines: {} };
    }
}

function writeState(state) {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    const temporary = `${STATE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ ...state, version: 2 }, null, 2));
    fs.renameSync(temporary, STATE_PATH);
}

function normalizeIdentity(value = {}) {
    if (typeof value === 'string') return { symbol: value.trim().toUpperCase(), strategyId: null, strategyVersion: null, key: null };
    if (value.key) return value;
    return buildTradingStrategyIdentity(value);
}

export function recordPrunerQuarantine({ identity, symbol, strategyId, strategyVersion, reason, stats, evidenceFingerprint, now = Date.now(), reviewIntervalMs } = {}) {
    const normalized = normalizeIdentity(identity || { symbol, strategyId, config: { strategyVersion } });
    if (!normalized.symbol || !normalized.strategyId || !normalized.strategyVersion) {
        throw new TypeError('A complete symbol/strategy/version identity is required for pruner quarantine');
    }
    const state = readState();
    state.quarantines[normalized.key] = {
        ...normalized,
        reason: String(reason || 'portfolio_pruner'),
        stats: stats || null,
        evidenceFingerprint: evidenceFingerprint || stats?.evidenceFingerprint || null,
        quarantinedAt: new Date(now).toISOString(),
        reviewAfterAt: new Date(now + Math.max(60_000, Number(reviewIntervalMs || process.env.SOMA_PRUNER_REVIEW_INTERVAL_MS || REVIEW_INTERVAL_MS))).toISOString(),
        releasePolicy: 'new_strategy_version_or_new_verified_evidence_or_operator'
    };
    writeState(state);
    return state.quarantines[normalized.key];
}

export function bindLegacyPrunerQuarantine(identity) {
    const normalized = normalizeIdentity(identity);
    const state = readState();
    const legacy = state.quarantines[normalized.symbol];
    if (!legacy) return null;
    delete state.quarantines[normalized.symbol];
    state.quarantines[normalized.key] = {
        ...legacy,
        ...normalized,
        evidenceFingerprint: legacy.evidenceFingerprint || legacy.stats?.evidenceFingerprint || null,
        reviewAfterAt: legacy.reviewAfterAt || legacy.expiresAt || new Date(Date.now() + REVIEW_INTERVAL_MS).toISOString(),
        releasePolicy: 'new_strategy_version_or_new_verified_evidence_or_operator',
        migratedFrom: 'symbol_only_v1'
    };
    delete state.quarantines[normalized.key].expiresAt;
    writeState(state);
    return state.quarantines[normalized.key];
}

export function getPrunerQuarantines() {
    return readState().quarantines;
}

export function getPrunerQuarantine(identity, { evidenceFingerprint = null, releaseOnNewEvidence = false } = {}) {
    const normalized = normalizeIdentity(identity);
    const state = readState();
    const quarantine = state.quarantines[normalized.key]
        || state.quarantines[normalized.symbol]
        || (!normalized.key ? Object.values(state.quarantines).find(item => item.symbol === normalized.symbol) : null)
        || null;
    if (!quarantine) return null;
    if (releaseOnNewEvidence && evidenceFingerprint && quarantine.evidenceFingerprint && evidenceFingerprint !== quarantine.evidenceFingerprint) {
        delete state.quarantines[quarantine.key || normalized.key || normalized.symbol];
        delete state.quarantines[normalized.symbol];
        writeState(state);
        return null;
    }
    return quarantine;
}

export function releasePrunerQuarantine(identity, { reason = 'operator_or_verified_evidence', evidence = null } = {}) {
    const normalized = normalizeIdentity(identity);
    const state = readState();
    const key = state.quarantines[normalized.key] ? normalized.key : normalized.symbol;
    const quarantine = state.quarantines[key];
    if (!quarantine) return { released: false, reason: 'not_found' };
    delete state.quarantines[key];
    writeState(state);
    return { released: true, reason, evidence, quarantine, releasedAt: new Date().toISOString() };
}

// Compatibility view for status consumers. Unlike v1, reviewAfterAt is not an
// automatic expiry: unchanged losing evidence must not silently re-enter.
export function getActivePrunerQuarantines() {
    return getPrunerQuarantines();
}

export function isPrunerQuarantined(identity) {
    return Boolean(getPrunerQuarantine(identity));
}

export { STATE_PATH as PRUNER_QUARANTINE_PATH };
