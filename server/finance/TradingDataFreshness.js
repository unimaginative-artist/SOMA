export function timeframeDurationMs(timeframe = '1Min') {
    const normalized = String(timeframe).toLowerCase();
    const intervalMs = normalized === '1min' ? 60000
        : normalized === '5min' ? 300000
        : normalized === '15min' ? 900000
        : normalized === '1h' ? 3600000
        : normalized === '4h' ? 14400000
        : normalized === '1d' ? 86400000
        : 60000;
    return intervalMs;
}

export function maxDecisionAgeForTimeframe(timeframe = '1Min') {
    const intervalMs = timeframeDurationMs(timeframe);
    // A completed candle can naturally be nearly one interval old.
    return (intervalMs * 2) + 60000;
}

export function barTimestampMs(bar = {}) {
    const raw = bar.timestamp ?? bar.time ?? bar.t;
    const parsed = typeof raw === 'string' ? Date.parse(raw) : Number(raw || 0);
    return parsed > 0 && parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

export function decisionCandleKey(bar = {}, timeframe = '1Min') {
    const timestamp = barTimestampMs(bar);
    return timestamp > 0 ? `${String(timeframe).toUpperCase()}:${timestamp}` : null;
}

export function nextCompletedCandleDelay(bar = {}, {
    timeframe = '1Min', now = Date.now(), graceMs = 2500, minimumMs = 5000
} = {}) {
    const timestamp = barTimestampMs(bar);
    const durationMs = timeframeDurationMs(timeframe);
    if (!(timestamp > 0)) return Math.max(minimumMs, Math.min(durationMs, 60000));
    // `bar` is the latest completed candle. The next candle starts one period
    // later and becomes actionable after a second period has elapsed.
    const nextCompletion = timestamp + (durationMs * 2) + graceMs;
    return Math.max(minimumMs, nextCompletion - now);
}

/** Canonical, ordered OHLCV bars. Duplicate timestamps keep the last value. */
export function normalizeDecisionBars(bars = []) {
    const unique = new Map();
    for (const source of Array.isArray(bars) ? bars : []) {
        const timestamp = barTimestampMs(source);
        const open = Number(source?.open);
        const high = Number(source?.high);
        const low = Number(source?.low);
        const close = Number(source?.close);
        const volume = Number(source?.volume ?? 0);
        if (!Number.isFinite(timestamp) || timestamp <= 0
            || ![open, high, low, close, volume].every(Number.isFinite)
            || open <= 0 || close <= 0 || high < low) continue;
        unique.set(timestamp, { ...source, timestamp, open, high, low, close, volume });
    }
    return Array.from(unique.values()).sort((left, right) => left.timestamp - right.timestamp);
}

/**
 * Removes a provider's still-forming candle. Signals must be computed from a
 * closed bar and executed against a later quote/bar, never the same candle.
 */
export function completedDecisionBars(bars = [], { timeframe = '1Min', now = Date.now(), graceMs = 1500 } = {}) {
    const durationMs = timeframeDurationMs(timeframe);
    return normalizeDecisionBars(bars).filter(bar => bar.timestamp + durationMs + graceMs <= now);
}

export function assessDecisionDataFreshness(bars = [], {
    now = Date.now(),
    maxAgeMs = 120000
} = {}) {
    const latest = bars[bars.length - 1] || {};
    const timestampMs = barTimestampMs(latest);
    const ageMs = Number.isFinite(timestampMs) && timestampMs > 0
        ? Math.max(0, now - timestampMs)
        : Infinity;
    const cached = bars.some(bar => bar?.isCached === true);
    return {
        validForEntry: Number.isFinite(ageMs) && timestampMs <= now + 5000 && ageMs <= maxAgeMs,
        ageMs,
        cached,
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
        maxAgeMs
    };
}

export default assessDecisionDataFreshness;
