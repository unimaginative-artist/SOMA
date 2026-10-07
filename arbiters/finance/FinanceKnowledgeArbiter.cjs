const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

/**
 * FinanceKnowledgeArbiter
 * 
 * "The Cartographer of Capital"
 * 
 * Responsibilities:
 * 1. Ingests the massive 'FinanceDatabase' (300k+ symbols).
 * 2. Indexes it into SOMA's MnemonicArbiter (or a dedicated SQLite/Vector Store).
 * 3. Provides 'search_financial_universe' tool to finding any asset by sector/country/currency.
 * 4. Maintains the "Sector Map" for macro analysis.
 */
class FinanceKnowledgeArbiter {
    constructor(opts = {}) {
        this.rootPath = opts.rootPath || process.cwd();
        this.dbPath = path.join(this.rootPath, 'backend', 'finance-database-repo', 'database');
        this.mnemonicArbiter = opts.mnemonicArbiter;
        this.cache = {
            equities: [],
            etfs: [],
            indices: [],
            cryptos: []
        };
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        console.log('[FinanceKnowledge] 🗺️  Mapping the Financial Universe...');
        
        try {
            // Load key datasets into memory (or index them if using Mnemonic)
            // For performance, we'll keep a lightweight in-memory index for now, 
            // but ideally this goes into SQLite.
            
            await this._loadDataset('equities', 'equities.csv');
            await this._loadDataset('etfs', 'etfs.csv');
            await this._loadDataset('cryptos', 'cryptos.csv');
            // Funds/Indices are huge, maybe load on demand or stream?
            
            this.isInitialized = true;
            console.log(`[FinanceKnowledge] ✅ Universe Mapped: ${this._getTotalCount()} assets indexed.`);
        } catch (error) {
            console.error('[FinanceKnowledge] ❌ Initialization Failed:', error.message);
        }
    }

    _getTotalCount() {
        return Object.values(this.cache).reduce((acc, arr) => acc + arr.length, 0);
    }

    async _loadDataset(category, filename) {
        const filePath = path.join(this.dbPath, filename);
        if (!fs.existsSync(filePath)) {
            console.warn(`[FinanceKnowledge] ⚠️ Dataset not found: ${filename}`);
            return;
        }

        console.log(`[FinanceKnowledge] Loading ${category}...`);
        const results = [];
        
        return new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => {
                    // Optimization: Only keep essential fields for the search index
                    // symbol, name, sector, industry, country, exchange
                    results.push({
                        symbol: data.symbol,
                        name: data.name,
                        sector: data.sector,
                        industry: data.industry,
                        country: data.country,
                        currency: data.currency,
                        exchange: data.exchange
                    });
                })
                .on('end', () => {
                    this.cache[category] = results;
                    resolve();
                })
                .on('error', (err) => reject(err));
        });
    }

    /**
     * Tool: Search Financial Universe
     * Query e.g., "German auto stocks" or "Renewable energy ETFs"
     */
    async searchUniverse(query) {
        if (!this.isInitialized) await this.initialize();

        const q = query.toLowerCase();
        const results = [];

        // Naive search implementation (O(N) - acceptable for 300k in Node for now, but Vector DB is better later)
        // 1. Equities
        this.cache.equities.forEach(asset => {
            if (this._matches(asset, q)) results.push({ ...asset, type: 'Equity' });
        });

        // 2. ETFs
        this.cache.etfs.forEach(asset => {
            if (this._matches(asset, q)) results.push({ ...asset, type: 'ETF' });
        });

        // 3. Cryptos
        this.cache.cryptos.forEach(asset => {
            if (this._matches(asset, q)) results.push({ ...asset, type: 'Crypto' });
        });

        // Limit results
        return results.slice(0, 50);
    }

    _matches(asset, query) {
        // Multi-field match
        return (asset.name && asset.name.toLowerCase().includes(query)) ||
               (asset.symbol && asset.symbol.toLowerCase().includes(query)) ||
               (asset.sector && asset.sector.toLowerCase().includes(query)) ||
               (asset.industry && asset.industry.toLowerCase().includes(query)) ||
               (asset.country && asset.country.toLowerCase().includes(query));
    }

    /**
     * Tool: Get Sector Map
     * Returns hierarchy of sectors -> industries for a country
     */
    getSectorMap(country = 'United States') {
        const map = {};
        
        this.cache.equities.forEach(asset => {
            if (asset.country === country && asset.sector) {
                if (!map[asset.sector]) map[asset.sector] = new Set();
                if (asset.industry) map[asset.sector].add(asset.industry);
            }
        });

        // Convert Sets to Arrays
        Object.keys(map).forEach(k => {
            map[k] = Array.from(map[k]).sort();
        });

        return map;
    }
}

module.exports = FinanceKnowledgeArbiter;
