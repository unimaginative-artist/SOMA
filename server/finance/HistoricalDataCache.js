import fs from 'fs';
import path from 'path';
import marketDataService from './marketDataService.js';

const CACHE_DIR = path.join(process.cwd(), 'data', 'trading', 'historical-cache');
const INDEX_PATH = path.join(CACHE_DIR, 'index.json');

function safeKey(symbol, timeframe) {
    return `${String(symbol).replace(/[^A-Za-z0-9_-]/g, '_')}_${String(timeframe).replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

// Keep cache filenames on the canonical timeframe names marketDataService uses.
// '1Day' files written before Jun 2026 actually contained intraday bars (the
// '1Day'→1m fallback bug) — normalizing here also sidesteps those poisoned files.
const TF_ALIASES = { '1Day': '1D', '1day': '1D', '1Hour': '1H', '1hour': '1H' };

class HistoricalDataCache {
    constructor() {
        this.index = {};
        this.initialized = false;
    }

    initialize() {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        try {
            this.index = fs.existsSync(INDEX_PATH) ? JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8')) : {};
        } catch {
            this.index = {};
        }
        this.initialized = true;
        this._saveIndex();
        return this.getStatus();
    }

    _saveIndex() {
        try {
            fs.writeFileSync(INDEX_PATH, JSON.stringify(this.index, null, 2));
        } catch (error) {
            console.warn('[HistoricalDataCache] Index save failed:', error.message);
        }
    }

    _path(symbol, timeframe) {
        return path.join(CACHE_DIR, `${safeKey(symbol, timeframe)}.json`);
    }

    async getBars(symbol, timeframe = '5Min', limit = 500, { refresh = false } = {}) {
        timeframe = TF_ALIASES[timeframe] || timeframe;
        if (!this.initialized) this.initialize();
        const filePath = this._path(symbol, timeframe);
        if (!refresh && fs.existsSync(filePath)) {
            try {
                const cached = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (Array.isArray(cached?.bars) && cached.bars.length >= Math.min(50, limit)) {
                    return cached.bars.slice(-limit);
                }
            } catch {}
        }

        const bars = await marketDataService.getBars(symbol, timeframe, limit);
        if (Array.isArray(bars) && bars.length) {
            fs.writeFileSync(filePath, JSON.stringify({ symbol, timeframe, bars, updatedAt: new Date().toISOString() }, null, 2));
            this.index[`${symbol}:${timeframe}`] = {
                symbol,
                timeframe,
                bars: bars.length,
                updatedAt: new Date().toISOString(),
                file: filePath
            };
            this._saveIndex();
        }
        return bars;
    }

    getStatus() {
        const entries = Object.values(this.index);
        return {
            initialized: this.initialized,
            entries: entries.length,
            bars: entries.reduce((sum, entry) => sum + (entry.bars || 0), 0),
            cacheDir: CACHE_DIR,
            recent: entries.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 10)
        };
    }
}

const historicalDataCache = new HistoricalDataCache();
export default historicalDataCache;
