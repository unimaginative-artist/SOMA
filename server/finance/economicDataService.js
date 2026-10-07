/**
 * Economic Data Service - API Integration
 *
 * Fetches economic events from multiple sources:
 * - Alpha Vantage (earnings calendar)
 * - FRED API (economic indicators)
 * - Manual curated events (Fed meetings)
 */

import fetch from 'node-fetch';

class EconomicDataService {
    constructor() {
        // API Keys (get from environment variables)
        this.alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY || 'demo';
        this.fredKey = process.env.FRED_API_KEY || null;

        // Rate limiting
        this.lastAlphaVantageCall = 0;
        this.alphaVantageDelay = 12000; // 5 calls per minute (free tier)

        // Cache
        this.cache = {
            earnings: { data: null, expiry: 0 },
            indicators: { data: null, expiry: 0 }
        };
        this.cacheExpiry = 3600000; // 1 hour
    }

    /**
     * Get earnings calendar from Alpha Vantage
     * Returns upcoming earnings in next 30 days
     */
    async getEarningsCalendar() {
        // Check cache
        if (this.cache.earnings.data && Date.now() < this.cache.earnings.expiry) {
            console.log('[EconomicData] Using cached earnings');
            return this.cache.earnings.data;
        }

        try {
            // Rate limit check
            await this.waitForRateLimit('alphavantage');

            // Alpha Vantage Earnings Calendar endpoint
            const url = `https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey=${this.alphaVantageKey}`;

            const response = await fetch(url);
            const csvText = await response.text();

            // Parse CSV
            const earnings = this.parseEarningsCSV(csvText);

            // Filter to next 30 days only
            const now = Date.now();
            const thirtyDaysFromNow = now + (30 * 24 * 60 * 60 * 1000);

            const upcomingEarnings = earnings.filter(e => {
                const earningDate = new Date(e.date).getTime();
                return earningDate >= now && earningDate <= thirtyDaysFromNow;
            });

            // Cache result
            this.cache.earnings = {
                data: upcomingEarnings,
                expiry: Date.now() + this.cacheExpiry
            };

            console.log(`[EconomicData] ✅ Fetched ${upcomingEarnings.length} upcoming earnings`);

            return upcomingEarnings;
        } catch (error) {
            console.error('[EconomicData] Failed to fetch earnings:', error.message);

            // Return cached data if available (even if expired)
            if (this.cache.earnings.data) {
                console.warn('[EconomicData] Using stale cache');
                return this.cache.earnings.data;
            }

            return [];
        }
    }

    /**
     * Parse Alpha Vantage earnings CSV format
     */
    parseEarningsCSV(csvText) {
        const lines = csvText.trim().split('\n');

        if (lines.length < 2) {
            return [];
        }

        // First line is header
        const headers = lines[0].split(',');

        // Parse data lines
        const earnings = [];
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');

            if (values.length < 3) continue;

            earnings.push({
                symbol: values[0],
                name: values[1],
                date: values[2],
                quarter: values[3] || 'Q?',
                estimate: values[4] || null,
                currency: values[5] || 'USD'
            });
        }

        return earnings;
    }

    /**
     * Get economic indicators (GDP, CPI, Unemployment)
     * Uses FRED API (Federal Reserve Economic Data)
     */
    async getEconomicIndicators() {
        // Check cache
        if (this.cache.indicators.data && Date.now() < this.cache.indicators.expiry) {
            console.log('[EconomicData] Using cached indicators');
            return this.cache.indicators.data;
        }

        // If no FRED key, return manually curated events
        if (!this.fredKey) {
            console.warn('[EconomicData] No FRED API key, using manual indicators');
            return this.getManualIndicators();
        }

        try {
            // Fetch major indicators
            const indicators = await Promise.all([
                this.getFREDIndicator('GDP', 'Gross Domestic Product', 'HIGH'),
                this.getFREDIndicator('CPIAUCSL', 'Consumer Price Index (Inflation)', 'HIGH'),
                this.getFREDIndicator('UNRATE', 'Unemployment Rate', 'MEDIUM'),
                this.getFREDIndicator('PCE', 'Personal Consumption Expenditures', 'MEDIUM')
            ]);

            const flatIndicators = indicators.flat();

            // Cache result
            this.cache.indicators = {
                data: flatIndicators,
                expiry: Date.now() + this.cacheExpiry
            };

            console.log(`[EconomicData] ✅ Fetched ${flatIndicators.length} economic indicators`);

            return flatIndicators;
        } catch (error) {
            console.error('[EconomicData] Failed to fetch FRED indicators:', error.message);

            // Fall back to manual
            return this.getManualIndicators();
        }
    }

    /**
     * Fetch a specific indicator from FRED
     */
    async getFREDIndicator(seriesId, name, impact) {
        const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${this.fredKey}&file_type=json&sort_order=desc&limit=1`;

        const response = await fetch(url);
        const data = await response.json();

        if (!data.observations || data.observations.length === 0) {
            return [];
        }

        // FRED only has historical data, not future releases
        // So we estimate next release based on typical schedule
        const lastObservation = data.observations[0];
        const lastDate = new Date(lastObservation.date);

        // Most indicators are monthly or quarterly
        // Estimate next release (typically ~1 month after data period)
        const nextReleaseDate = new Date(lastDate);
        nextReleaseDate.setMonth(nextReleaseDate.getMonth() + 2); // Estimate

        return [{
            name,
            description: `${name} release`,
            date: nextReleaseDate.toISOString().split('T')[0],
            impact,
            value: lastObservation.value
        }];
    }

    /**
     * Manual indicators (when FRED API not available)
     */
    getManualIndicators() {
        // Manually curated 2026 economic release dates
        // These are estimates based on typical schedules
        const now = new Date();
        const year = now.getFullYear();

        const indicators = [
            // GDP releases (quarterly)
            { name: 'GDP Q1', date: `${year}-04-30`, impact: 'HIGH', description: 'Q1 GDP Advance Estimate' },
            { name: 'GDP Q2', date: `${year}-07-30`, impact: 'HIGH', description: 'Q2 GDP Advance Estimate' },
            { name: 'GDP Q3', date: `${year}-10-30`, impact: 'HIGH', description: 'Q3 GDP Advance Estimate' },

            // CPI releases (monthly - first week of each month)
            { name: 'CPI Feb', date: `${year}-03-12`, impact: 'HIGH', description: 'February Inflation Data' },
            { name: 'CPI Mar', date: `${year}-04-10`, impact: 'HIGH', description: 'March Inflation Data' },
            { name: 'CPI Apr', date: `${year}-05-13`, impact: 'HIGH', description: 'April Inflation Data' },
            { name: 'CPI May', date: `${year}-06-11`, impact: 'HIGH', description: 'May Inflation Data' },
            { name: 'CPI Jun', date: `${year}-07-11`, impact: 'HIGH', description: 'June Inflation Data' },
            { name: 'CPI Jul', date: `${year}-08-13`, impact: 'HIGH', description: 'July Inflation Data' },
            { name: 'CPI Aug', date: `${year}-09-11`, impact: 'HIGH', description: 'August Inflation Data' },
            { name: 'CPI Sep', date: `${year}-10-10`, impact: 'HIGH', description: 'September Inflation Data' },
            { name: 'CPI Oct', date: `${year}-11-13`, impact: 'HIGH', description: 'October Inflation Data' },
            { name: 'CPI Nov', date: `${year}-12-11`, impact: 'HIGH', description: 'November Inflation Data' },

            // Non-Farm Payrolls (monthly - first Friday)
            { name: 'Jobs Report Feb', date: `${year}-03-07`, impact: 'HIGH', description: 'February Employment Data' },
            { name: 'Jobs Report Mar', date: `${year}-04-04`, impact: 'HIGH', description: 'March Employment Data' },
            { name: 'Jobs Report Apr', date: `${year}-05-02`, impact: 'HIGH', description: 'April Employment Data' },
            { name: 'Jobs Report May', date: `${year}-06-06`, impact: 'HIGH', description: 'May Employment Data' }
        ];

        // Filter to future dates only
        const nowTimestamp = now.getTime();
        return indicators.filter(ind => {
            return new Date(ind.date).getTime() > nowTimestamp;
        });
    }

    /**
     * Rate limiting helper
     */
    async waitForRateLimit(service) {
        if (service === 'alphavantage') {
            const timeSinceLastCall = Date.now() - this.lastAlphaVantageCall;
            if (timeSinceLastCall < this.alphaVantageDelay) {
                const waitTime = this.alphaVantageDelay - timeSinceLastCall;
                console.log(`[EconomicData] Rate limiting: waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
            this.lastAlphaVantageCall = Date.now();
        }
    }

    /**
     * Get API key setup instructions
     */
    getSetupInstructions() {
        return {
            alphaVantage: {
                needed: !this.alphaVantageKey || this.alphaVantageKey === 'demo',
                url: 'https://www.alphavantage.co/support/#api-key',
                instructions: 'Get free API key from Alpha Vantage. Set ALPHA_VANTAGE_API_KEY environment variable.',
                cost: 'FREE (5 calls per minute)'
            },
            fred: {
                needed: !this.fredKey,
                url: 'https://fred.stlouisfed.org/docs/api/api_key.html',
                instructions: 'Get free API key from FRED. Set FRED_API_KEY environment variable.',
                cost: 'FREE (unlimited)'
            }
        };
    }

    /**
     * Test API connectivity
     */
    async testAPIs() {
        console.log('\n[EconomicData] Testing API connectivity...\n');

        const results = {
            alphaVantage: { connected: false, error: null },
            fred: { connected: false, error: null }
        };

        // Test Alpha Vantage
        try {
            const earnings = await this.getEarningsCalendar();
            results.alphaVantage.connected = earnings.length > 0;
            if (!results.alphaVantage.connected) {
                results.alphaVantage.error = 'No earnings data returned (might be demo key)';
            }
        } catch (error) {
            results.alphaVantage.error = error.message;
        }

        // Test FRED
        if (this.fredKey) {
            try {
                const indicators = await this.getEconomicIndicators();
                results.fred.connected = indicators.length > 0;
            } catch (error) {
                results.fred.error = error.message;
            }
        } else {
            results.fred.error = 'No API key configured (using manual indicators)';
        }

        console.log('Alpha Vantage:', results.alphaVantage.connected ? '✅ Connected' : '❌ Failed');
        if (results.alphaVantage.error) console.log('  Error:', results.alphaVantage.error);

        console.log('FRED:', results.fred.connected ? '✅ Connected' : '⚠️  Using manual data');
        if (results.fred.error) console.log('  Note:', results.fred.error);

        console.log('\n');

        return results;
    }
}

// Export singleton
export default new EconomicDataService();
