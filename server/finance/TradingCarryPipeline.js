import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_DIR = path.join(process.cwd(), 'data', 'trading', 'carry');

function futuresSymbol(symbol = '') {
    return String(symbol).toUpperCase().replace('-USD', 'USDT').replace('/', '');
}

export class TradingCarryPipeline {
    constructor({ cacheDir = DEFAULT_DIR, fetchImpl = globalThis.fetch } = {}) {
        this.cacheDir = cacheDir;
        this.fetchImpl = fetchImpl;
    }

    async refreshSymbol(symbol, { limit = 1000 } = {}) {
        const contract = futuresSymbol(symbol);
        const query = new URLSearchParams({ symbol: contract, limit: String(Math.min(1000, Math.max(10, limit))) });
        let payload = null;
        let source = 'binance_usdm_public_funding';
        const response = await this.fetchImpl(`https://fapi.binance.com/fapi/v1/fundingRate?${query}`, { signal: AbortSignal.timeout(15_000) });
        if (response.ok) {
            const binance = await response.json();
            if (Array.isArray(binance)) payload = binance.map(row => ({
                timestamp: Number(row.fundingTime), fundingRate: Number(row.fundingRate),
                markPrice: Number(row.markPrice || 0) || null
            }));
        }
        if (!payload) {
            source = 'bybit_linear_public_funding';
            payload = [];
            let endTime = null;
            let bybitAvailable = true;
            const pages = Math.ceil(Math.min(1000, Math.max(10, limit)) / 200);
            for (let page = 0; page < pages; page++) {
                const bybitQuery = new URLSearchParams({ category: 'linear', symbol: contract, limit: '200' });
                if (endTime) bybitQuery.set('endTime', String(endTime));
                const fallback = await this.fetchImpl(`https://api.bybit.com/v5/market/funding/history?${bybitQuery}`, {
                    signal: AbortSignal.timeout(15_000)
                });
                if (!fallback.ok) { bybitAvailable = false; payload = []; break; }
                const body = await fallback.json();
                if (Number(body?.retCode) !== 0 || !Array.isArray(body?.result?.list)) { bybitAvailable = false; payload = []; break; }
                const pageRows = body.result.list.map(row => ({
                    timestamp: Number(row.fundingRateTimestamp), fundingRate: Number(row.fundingRate), markPrice: null
                }));
                payload.push(...pageRows);
                const oldest = Math.min(...pageRows.map(row => row.timestamp).filter(Number.isFinite));
                if (!pageRows.length || !Number.isFinite(oldest)) break;
                endTime = oldest - 1;
            }
            if (!bybitAvailable || !payload.length) {
                source = 'okx_swap_public_funding';
                payload = [];
                const instrument = contract.replace(/USDT$/, '-USDT-SWAP');
                let after = null;
                const okxPages = Math.ceil(Math.min(1000, Math.max(10, limit)) / 100);
                for (let page = 0; page < okxPages; page++) {
                    const okxQuery = new URLSearchParams({ instId: instrument, limit: '100' });
                    if (after) okxQuery.set('after', String(after));
                    const okx = await this.fetchImpl(`https://www.okx.com/api/v5/public/funding-rate-history?${okxQuery}`, {
                        signal: AbortSignal.timeout(15_000)
                    });
                    if (!okx.ok) throw new Error(`Funding providers unavailable for ${contract}: Binance ${response.status}, Bybit unavailable, OKX ${okx.status}`);
                    const body = await okx.json();
                    if (String(body?.code) !== '0' || !Array.isArray(body?.data)) throw new Error(`Invalid OKX funding response for ${contract}`);
                    const pageRows = body.data.map(row => ({
                        timestamp: Number(row.fundingTime), fundingRate: Number(row.realizedRate || row.fundingRate), markPrice: null
                    }));
                    payload.push(...pageRows);
                    const oldest = Math.min(...pageRows.map(row => row.timestamp).filter(Number.isFinite));
                    if (pageRows.length < 100 || !Number.isFinite(oldest)) break;
                    after = oldest;
                }
            }
        }
        const rows = Array.from(new Map(payload.map(row => [Number(row.timestamp), { ...row, source, contract }])).values())
            .filter(row => row.timestamp > 0 && Number.isFinite(row.fundingRate))
            .sort((left, right) => left.timestamp - right.timestamp);
        await fs.mkdir(this.cacheDir, { recursive: true });
        const serialized = `${JSON.stringify(rows, null, 2)}\n`;
        await fs.writeFile(path.join(this.cacheDir, `${symbol}.json`), serialized, 'utf8');
        const provenance = {
            schemaVersion: 1, symbol, contract,
            source: source === 'binance_usdm_public_funding'
                ? 'Binance USD-M public funding history /fapi/v1/fundingRate'
                : source === 'bybit_linear_public_funding'
                    ? 'Bybit V5 linear public funding history /v5/market/funding/history'
                    : 'OKX V5 swap public funding history /api/v5/public/funding-rate-history',
            role: 'external_context_only_not_execution_price',
            fetchedAt: new Date().toISOString(), rows: rows.length,
            firstTimestamp: rows[0]?.timestamp || null,
            lastTimestamp: rows.at(-1)?.timestamp || null,
            sha256: crypto.createHash('sha256').update(serialized).digest('hex')
        };
        await fs.writeFile(path.join(this.cacheDir, `${symbol}.provenance.json`), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
        return provenance;
    }

    async refresh(symbols = []) {
        const results = [];
        for (const symbol of symbols) {
            try { results.push(await this.refreshSymbol(symbol)); }
            catch (error) { results.push({ symbol, error: error.message, rows: 0 }); }
        }
        return { success: results.some(row => row.rows > 0), results };
    }

    async load(symbol) {
        try {
            const file = path.join(this.cacheDir, `${symbol}.json`);
            const raw = await fs.readFile(file, 'utf8');
            const provenance = JSON.parse(await fs.readFile(path.join(this.cacheDir, `${symbol}.provenance.json`), 'utf8'));
            const digest = crypto.createHash('sha256').update(raw).digest('hex');
            if (digest !== provenance.sha256 || provenance.role !== 'external_context_only_not_execution_price') return [];
            return JSON.parse(raw);
        } catch { return []; }
    }
}

export default new TradingCarryPipeline();
