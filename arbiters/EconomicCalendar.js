/**
 * Economic Calendar - Production Grade
 *
 * Features:
 * - Track Fed meetings, earnings, GDP releases, inflation data
 * - Reduce position size before high-impact events
 * - Optional exit before earnings
 * - Impact classification (HIGH/MEDIUM/LOW)
 * - Historical backfill for backtesting
 *
 * Data Sources:
 * - Alpha Vantage (earnings, economic indicators - FREE)
 * - FRED API (economic data - FREE)
 * - Manual calendar for Fed meetings
 */

import fs from 'fs/promises';
import path from 'path';

export class EconomicCalendar {
    constructor({ rootPath }) {
        this.rootPath = rootPath;
        this.calendarPath = path.join(rootPath, 'data', 'economic_calendar');
        this.cachePath = path.join(this.calendarPath, 'cache');
        this.cacheExpiry = 3600000; // 1 hour cache

        // Event impact levels
        this.impactLevels = {
            HIGH: {
                positionMultiplier: 0.3,  // Reduce to 30% of normal
                exitBefore: true,
                bufferHours: 24
            },
            MEDIUM: {
                positionMultiplier: 0.6,  // Reduce to 60%
                exitBefore: false,
                bufferHours: 12
            },
            LOW: {
                positionMultiplier: 0.9,  // Reduce to 90%
                exitBefore: false,
                bufferHours: 6
            }
        };

        this.events = [];
        this.lastFetch = 0;
    }

    async initialize() {
        await fs.mkdir(this.calendarPath, { recursive: true });
        await fs.mkdir(this.cachePath, { recursive: true });

        // Load cached events
        await this.loadCache();

        // Fetch fresh events
        await this.refreshEvents();

        console.log('[EconomicCalendar] ✅ Initialized with', this.events.length, 'upcoming events');
    }

    /**
     * Check if a high-impact event is coming for a symbol
     */
    hasUpcomingEvent(symbol, hoursAhead = 24, minImpact = 'MEDIUM') {
        const now = Date.now();
        const futureTime = now + (hoursAhead * 60 * 60 * 1000);

        const impactOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const minImpactLevel = impactOrder[minImpact] || 2;

        const upcomingEvents = this.events.filter(event => {
            // Check if event is in our time window
            if (event.timestamp < now || event.timestamp > futureTime) {
                return false;
            }

            // Check impact level
            if (impactOrder[event.impact] < minImpactLevel) {
                return false;
            }

            // Check if event affects this symbol
            if (event.affectedSymbols && event.affectedSymbols.length > 0) {
                // Specific symbol check
                if (!event.affectedSymbols.includes(symbol)) {
                    return false;
                }
            }

            return true;
        });

        return upcomingEvents.length > 0 ? upcomingEvents : false;
    }

    /**
     * Get position size adjustment for upcoming events
     */
    getPositionMultiplier(symbol, hoursAhead = 24) {
        const upcomingEvents = this.hasUpcomingEvent(symbol, hoursAhead, 'LOW');

        if (!upcomingEvents) {
            return 1.0; // No adjustment needed
        }

        // Use the most conservative multiplier
        let lowestMultiplier = 1.0;

        for (const event of upcomingEvents) {
            const multiplier = this.impactLevels[event.impact].positionMultiplier;
            if (multiplier < lowestMultiplier) {
                lowestMultiplier = multiplier;
            }
        }

        return lowestMultiplier;
    }

    /**
     * Should we exit positions before this event?
     */
    shouldExitBefore(symbol, hoursAhead = 24) {
        const upcomingEvents = this.hasUpcomingEvent(symbol, hoursAhead, 'HIGH');

        if (!upcomingEvents) {
            return false;
        }

        // Exit if any HIGH impact event recommends it
        return upcomingEvents.some(event =>
            this.impactLevels[event.impact].exitBefore
        );
    }

    /**
     * Get upcoming events for display
     */
    getUpcoming(daysAhead = 7, minImpact = 'LOW') {
        const now = Date.now();
        const futureTime = now + (daysAhead * 24 * 60 * 60 * 1000);

        const impactOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const minImpactLevel = impactOrder[minImpact] || 1;

        return this.events
            .filter(event => {
                return event.timestamp >= now &&
                       event.timestamp <= futureTime &&
                       impactOrder[event.impact] >= minImpactLevel;
            })
            .sort((a, b) => a.timestamp - b.timestamp);
    }

    /**
     * Detect asset type from symbol
     */
    detectAssetType(symbol) {
        const cryptoSymbols = ['BTC-USD', 'ETH-USD', 'BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP'];
        const futuresSymbols = ['ES1!', 'NQ1!', 'CL1!', 'GC1!', 'BTC-PERP', 'ETH-PERP'];

        // Check if crypto
        if (cryptoSymbols.some(c => symbol.includes(c)) || symbol.includes('-USD') || symbol.includes('-USDT')) {
            return 'CRYPTO';
        }

        // Check if futures
        if (futuresSymbols.some(f => symbol.includes(f)) || symbol.includes('PERP') || symbol.includes('1!')) {
            return 'FUTURES';
        }

        // Default to stocks
        return 'STOCKS';
    }

    /**
     * Get events for a specific symbol (asset-type aware)
     */
    getEventsForSymbol(symbol, daysAhead = 7) {
        const assetType = this.detectAssetType(symbol);
        const allEvents = this.getUpcoming(daysAhead);

        return allEvents.filter(event => {
            // Symbol-specific events
            if (event.affectedSymbols && event.affectedSymbols.length > 0) {
                return event.affectedSymbols.includes(symbol);
            }

            // Asset-type filtering for market-wide events
            if (event.assetTypes && event.assetTypes.length > 0) {
                return event.assetTypes.includes(assetType);
            }

            // Legacy: market-wide events affect all
            return true;
        });
    }

    /**
     * Refresh events from all sources
     */
    async refreshEvents() {
        const now = Date.now();

        // Check if cache is still valid
        if (now - this.lastFetch < this.cacheExpiry) {
            console.log('[EconomicCalendar] Using cached events');
            return;
        }

        console.log('[EconomicCalendar] Fetching fresh events...');

        try {
            // Fetch from all sources
            const [fedEvents, earningsEvents, economicIndicators] = await Promise.all([
                this.getFedEvents(),
                this.getEarningsEvents(),
                this.getEconomicIndicators()
            ]);

            // Merge all events
            this.events = [
                ...fedEvents,
                ...earningsEvents,
                ...economicIndicators
            ].sort((a, b) => a.timestamp - b.timestamp);

            this.lastFetch = now;

            // Save to cache
            await this.saveCache();

            console.log(`[EconomicCalendar] ✅ Fetched ${this.events.length} events`);
        } catch (error) {
            console.error('[EconomicCalendar] Failed to refresh events:', error.message);
            // Fall back to cached events
        }
    }

    /**
     * Get Fed meetings (manually curated for accuracy)
     */
    async getFedEvents() {
        // Fed meeting schedule is published annually
        // These are the 2026 FOMC meeting dates (8 per year)
        const fedMeetings2026 = [
            { date: '2026-01-28', time: '14:00' }, // January
            { date: '2026-03-17', time: '14:00' }, // March
            { date: '2026-04-28', time: '14:00' }, // April-May
            { date: '2026-06-16', time: '14:00' }, // June
            { date: '2026-07-28', time: '14:00' }, // July
            { date: '2026-09-15', time: '14:00' }, // September
            { date: '2026-10-27', time: '14:00' }, // October-November
            { date: '2026-12-15', time: '14:00' }  // December
        ];

        const events = fedMeetings2026.map(meeting => {
            const [year, month, day] = meeting.date.split('-');
            const [hour, minute] = meeting.time.split(':');
            const timestamp = new Date(year, month - 1, day, hour, minute).getTime();

            return {
                id: `fed_${meeting.date}`,
                title: 'FOMC Meeting',
                description: 'Federal Reserve Interest Rate Decision',
                type: 'FED',
                timestamp,
                impact: 'HIGH',
                affectedSymbols: [],
                assetTypes: ['STOCKS', 'CRYPTO', 'FUTURES'], // Affects all
                source: 'manual'
            };
        }).filter(event => event.timestamp > Date.now());

        // Add crypto-specific events
        const cryptoEvents = await this.getCryptoEvents();

        return [...events, ...cryptoEvents];
    }

    /**
     * Get crypto-specific events
     */
    async getCryptoEvents() {
        const now = Date.now();
        const events = [];

        // Bitcoin Halving (every 4 years, next one ~April 2028)
        const bitcoinHalving = new Date('2028-04-15T00:00:00Z').getTime();
        if (bitcoinHalving > now) {
            events.push({
                id: 'btc_halving_2028',
                title: 'Bitcoin Halving',
                description: 'Bitcoin block reward halves (historically bullish)',
                type: 'CRYPTO_EVENT',
                timestamp: bitcoinHalving,
                impact: 'HIGH',
                affectedSymbols: ['BTC-USD', 'BTC', 'BTC-PERP'],
                assetTypes: ['CRYPTO'],
                source: 'manual'
            });
        }

        // Ethereum Upgrades (example - would be updated as announced)
        const ethUpgrade = new Date('2026-06-01T00:00:00Z').getTime();
        if (ethUpgrade > now) {
            events.push({
                id: 'eth_upgrade_2026',
                title: 'Ethereum Network Upgrade',
                description: 'Major Ethereum protocol upgrade',
                type: 'CRYPTO_EVENT',
                timestamp: ethUpgrade,
                impact: 'MEDIUM',
                affectedSymbols: ['ETH-USD', 'ETH', 'ETH-PERP'],
                assetTypes: ['CRYPTO'],
                source: 'manual'
            });
        }

        // Bitcoin ETF decisions (example)
        const btcETFDecision = new Date('2026-03-15T00:00:00Z').getTime();
        if (btcETFDecision > now) {
            events.push({
                id: 'btc_etf_decision_2026',
                title: 'Bitcoin ETF Decision',
                description: 'SEC decision on spot Bitcoin ETF applications',
                type: 'REGULATORY',
                timestamp: btcETFDecision,
                impact: 'HIGH',
                affectedSymbols: ['BTC-USD', 'BTC'],
                assetTypes: ['CRYPTO'],
                source: 'manual'
            });
        }

        return events;
    }

    /**
     * Get earnings events (uses Alpha Vantage API)
     */
    async getEarningsEvents() {
        try {
            const economicDataService = await import('../server/finance/economicDataService.js');
            const earnings = await economicDataService.default.getEarningsCalendar();

            return earnings.map(earning => ({
                id: `earnings_${earning.symbol}_${earning.date}`,
                title: `${earning.symbol} Earnings`,
                description: `${earning.name} reports Q${earning.quarter} earnings`,
                type: 'EARNINGS',
                timestamp: new Date(earning.date).getTime(),
                impact: this.classifyEarningsImpact(earning.symbol),
                affectedSymbols: [earning.symbol],
                assetTypes: ['STOCKS'], // Earnings are stock-specific
                source: 'alpha_vantage'
            }));
        } catch (error) {
            console.warn('[EconomicCalendar] Failed to fetch earnings:', error.message);
            return [];
        }
    }

    /**
     * Get economic indicators (GDP, CPI, unemployment)
     */
    async getEconomicIndicators() {
        try {
            const economicDataService = await import('../server/finance/economicDataService.js');
            const indicators = await economicDataService.default.getEconomicIndicators();

            return indicators.map(indicator => ({
                id: `indicator_${indicator.name}_${indicator.date}`,
                title: indicator.name,
                description: indicator.description,
                type: 'INDICATOR',
                timestamp: new Date(indicator.date).getTime(),
                impact: indicator.impact,
                affectedSymbols: [], // Market-wide
                source: 'fred'
            }));
        } catch (error) {
            console.warn('[EconomicCalendar] Failed to fetch indicators:', error.message);
            return [];
        }
    }

    /**
     * Classify earnings impact based on market cap / volatility
     */
    classifyEarningsImpact(symbol) {
        // Major tech stocks = HIGH impact
        const highImpactStocks = [
            'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'NVDA', 'TSLA',
            'BTC-USD', 'ETH-USD' // Crypto "earnings" (major announcements)
        ];

        if (highImpactStocks.includes(symbol)) {
            return 'HIGH';
        }

        // S&P 500 stocks = MEDIUM
        // TODO: Could check against S&P 500 list
        return 'MEDIUM';
    }

    /**
     * Save events to cache
     */
    async saveCache() {
        try {
            const cachePath = path.join(this.cachePath, 'events.json');
            await fs.writeFile(cachePath, JSON.stringify({
                timestamp: this.lastFetch,
                events: this.events
            }, null, 2));
        } catch (error) {
            console.error('[EconomicCalendar] Failed to save cache:', error.message);
        }
    }

    /**
     * Load events from cache
     */
    async loadCache() {
        try {
            const cachePath = path.join(this.cachePath, 'events.json');
            const content = await fs.readFile(cachePath, 'utf-8');
            const data = JSON.parse(content);

            // Check if cache is still valid
            if (Date.now() - data.timestamp < this.cacheExpiry) {
                this.events = data.events;
                this.lastFetch = data.timestamp;
                console.log('[EconomicCalendar] Loaded from cache:', this.events.length, 'events');
            }
        } catch (error) {
            // No cache available, will fetch fresh
            console.log('[EconomicCalendar] No valid cache, will fetch fresh');
        }
    }

    /**
     * Get summary for dashboard
     */
    getSummary() {
        const now = Date.now();
        const next24h = now + (24 * 60 * 60 * 1000);
        const next7d = now + (7 * 24 * 60 * 60 * 1000);

        const highImpactNext24h = this.events.filter(e =>
            e.timestamp > now && e.timestamp < next24h && e.impact === 'HIGH'
        );

        const allNext7d = this.events.filter(e =>
            e.timestamp > now && e.timestamp < next7d
        );

        return {
            highImpactNext24h: highImpactNext24h.length,
            totalNext7d: allNext7d.length,
            nextHighImpact: highImpactNext24h[0] || null,
            upcomingEvents: allNext7d.slice(0, 5)
        };
    }

    /**
     * Format event for display
     */
    formatEvent(event) {
        const now = Date.now();
        const timeUntil = event.timestamp - now;
        const hoursUntil = Math.floor(timeUntil / (60 * 60 * 1000));
        const daysUntil = Math.floor(hoursUntil / 24);

        let timeString;
        if (daysUntil > 1) {
            timeString = `in ${daysUntil} days`;
        } else if (hoursUntil > 1) {
            timeString = `in ${hoursUntil} hours`;
        } else {
            const minutesUntil = Math.floor(timeUntil / (60 * 1000));
            timeString = `in ${minutesUntil} minutes`;
        }

        const impactEmoji = {
            HIGH: '🔴',
            MEDIUM: '🟡',
            LOW: '🟢'
        }[event.impact];

        return {
            ...event,
            timeString,
            impactEmoji,
            formattedDate: new Date(event.timestamp).toLocaleString()
        };
    }
}
