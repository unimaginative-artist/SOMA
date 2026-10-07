/**
 * CalendarGuard — Earnings & Macro Event Risk Filter
 *
 * Blocks new position entries within a configurable window (default 24h) of:
 *   1. FOMC interest rate decisions (hardcoded Fed schedule)
 *   2. Earnings announcements (Alpha Vantage free tier, cached 24h)
 *
 * If Alpha Vantage key is not set, earnings check gracefully passes (non-blocking).
 *
 * FOMC 2026 schedule (verify at federalreserve.gov):
 *   Jan 28-29, Mar 17-18, Apr 28-29, Jun 9-10,
 *   Jul 28-29, Sep 15-16, Oct 27-28, Dec 8-9
 */

import fs from 'fs';
import path from 'path';

const CACHE_DIR   = path.join(process.cwd(), 'data', 'trading', 'calendar-cache');
const CACHE_TTL   = 24 * 60 * 60 * 1000; // 24h

// FOMC decision days (second day of each meeting = announcement date)
const FOMC_DATES_2026 = [
    '2026-01-29', '2026-03-18', '2026-04-29', '2026-06-10',
    '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'
];

// Major macro events (add NFP, CPI, PPI release dates here as desired)
const MACRO_EVENTS = [
    // Format: { date: 'YYYY-MM-DD', name: string, blockHours: number }
    ...FOMC_DATES_2026.map(d => ({ date: d, name: 'FOMC Rate Decision', blockHours: 24 }))
];

class CalendarGuard {
    constructor() {
        this._earningsCache = new Map(); // symbol → { events: [], cachedAt }
    }

    /**
     * Check if a symbol has an upcoming high-risk event.
     * @param {string} symbol
     * @param {number} windowHours - hours to look ahead (default 24)
     * @returns {{ blocked: boolean, reason: string, event: object|null, hoursUntil: number|null }}
     */
    async isEventRisk(symbol, windowHours = 24) {
        const now = Date.now();
        const windowMs = windowHours * 60 * 60 * 1000;

        // ── 1. Macro / FOMC check ─────────────────────────────────────────────
        for (const event of MACRO_EVENTS) {
            const eventTime = new Date(event.date + 'T14:00:00Z').getTime(); // ~2pm UTC
            const hoursUntil = (eventTime - now) / (60 * 60 * 1000);
            if (hoursUntil >= 0 && hoursUntil <= (event.blockHours || windowHours)) {
                return {
                    blocked: true,
                    reason: `${event.name} in ${hoursUntil.toFixed(1)}h — holding cash`,
                    event,
                    hoursUntil: parseFloat(hoursUntil.toFixed(2))
                };
            }
        }

        // ── 2. Earnings check ────────────────────────────────────────────────
        const earnings = await this._getEarningsEvents(symbol);
        for (const e of earnings) {
            const hoursUntil = (e.reportTime - now) / (60 * 60 * 1000);
            if (hoursUntil >= 0 && hoursUntil <= windowHours) {
                return {
                    blocked: true,
                    reason: `${symbol} earnings in ${hoursUntil.toFixed(1)}h — holding cash`,
                    event: e,
                    hoursUntil: parseFloat(hoursUntil.toFixed(2))
                };
            }
        }

        return { blocked: false, reason: 'no event risk', event: null, hoursUntil: null };
    }

    /**
     * Returns upcoming earnings events for a symbol from cache or Alpha Vantage.
     * Returns empty array on failure (non-blocking).
     */
    async _getEarningsEvents(symbol) {
        const cached = this._earningsCache.get(symbol);
        if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
            return cached.events;
        }

        const apiKey = process.env.ALPHA_VANTAGE_KEY;
        if (!apiKey) return [];

        try {
            const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&symbol=${encodeURIComponent(symbol)}&horizon=3month&apikey=${apiKey}`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) return [];

            const text = await res.text();
            // Alpha Vantage returns CSV for this endpoint
            const lines = text.split('\n').slice(1).filter(Boolean);
            const events = [];
            for (const line of lines) {
                const [sym, , reportDate, fiscalDateEnding, estimate, currency] = line.split(',');
                if (!sym || sym.trim() !== symbol) continue;
                if (!reportDate) continue;
                // Parse date — AV returns YYYY-MM-DD
                const reportTime = new Date(reportDate.trim()).getTime();
                if (isNaN(reportTime)) continue;
                events.push({ symbol: sym.trim(), reportDate: reportDate.trim(), reportTime, fiscalDateEnding, estimate, currency });
            }

            this._earningsCache.set(symbol, { events, cachedAt: Date.now() });
            return events;
        } catch {
            return []; // graceful degradation
        }
    }

    /** Returns a human-readable calendar summary for the dashboard */
    getUpcoming(days = 7) {
        const now = Date.now();
        const windowMs = days * 24 * 60 * 60 * 1000;
        const upcoming = MACRO_EVENTS
            .map(e => ({ ...e, timestamp: new Date(e.date + 'T14:00:00Z').getTime() }))
            .filter(e => e.timestamp > now && e.timestamp - now < windowMs)
            .sort((a, b) => a.timestamp - b.timestamp);
        return upcoming.map(e => ({
            ...e,
            hoursAway: parseFloat(((e.timestamp - now) / 3_600_000).toFixed(1))
        }));
    }
}

const calendarGuard = new CalendarGuard();
export default calendarGuard;
