import fs from 'fs/promises';
import path from 'path';

/**
 * MacroCatalystRadar.js
 * SOMA Macro & Catalyst Sentiment Engine
 * Ingests macro economic prints, central bank interest rates, ETF flow sentiment,
 * and upcoming catalyst timers to output dynamic risk scaling factors for trading strategies.
 */
export class MacroCatalystRadar {
    constructor(options = {}) {
        this.cachePath = options.cachePath || path.join(process.cwd(), 'data', 'macro_catalyst_radar.json');
        this.lastUpdate = 0;
        this.cacheTTLMs = 30 * 60 * 1000; // 30 minutes
        this.state = {
            cpiYoY: 3.4,
            fedRateCorridor: '3.50%-3.75%',
            ethEtfFlows: 'NEUTRAL_TO_INFLOW',
            stakingBurnModel: 'PROPOSED_DEFICIT',
            nextMajorCatalyst: {
                name: 'Jackson Hole Economic Symposium',
                date: '2026-08-27',
                riskImpact: 'HIGH_VOLATILITY_WARNING'
            },
            macroScore: 0.58, // 0.0 (Bearish Panic) - 1.0 (Macro Bullish Surge)
            regime: 'CONSOLIDATION_CAUTIOUS',
            positionSizeMultiplier: 0.85,
            stopLossMultiplier: 0.90 // Slightly tighter stops during pre-catalyst consolidation
        };
    }

    async analyze(marketContext = {}) {
        const now = Date.now();
        if (!marketContext.skipLoadState) {
            await this._loadState();
        }
        if (marketContext.cpiYoY !== undefined) this.state.cpiYoY = marketContext.cpiYoY;
        if (marketContext.ethEtfFlows !== undefined) this.state.ethEtfFlows = marketContext.ethEtfFlows;
        if (marketContext.stakingBurnModel !== undefined) this.state.stakingBurnModel = marketContext.stakingBurnModel;

        // 1. Calculate macro sentiment score
        let score = 0.50;

        // CPI assessment
        if (this.state.cpiYoY <= 3.5) score += 0.08;
        else if (this.state.cpiYoY >= 4.0) score -= 0.20;

        // ETF sentiment
        if (this.state.ethEtfFlows === 'STRONG_INFLOW') score += 0.15;
        else if (this.state.ethEtfFlows === 'NEUTRAL_TO_INFLOW') score += 0.05;
        else if (this.state.ethEtfFlows === 'OUTFLOW') score -= 0.15;

        // Staking dynamics (supply reduction proposal)
        if (this.state.stakingBurnModel === 'PROPOSED_DEFICIT') score += 0.07;

        // Upcoming event volatility adjustment
        const daysToJacksonHole = (new Date(this.state.nextMajorCatalyst.date).getTime() - now) / (1000 * 60 * 60 * 24);
        if (daysToJacksonHole > 0 && daysToJacksonHole <= 14) {
            // Tightening regime pre-event
            score = Math.max(0.35, score - 0.05);
        }

        const finalScore = Number(Math.min(1.0, Math.max(0.0, score)).toFixed(2));
        
        let regime = 'CONSOLIDATION_CAUTIOUS';
        let positionSizeMultiplier = 0.85;
        let stopLossMultiplier = 0.90;

        if (finalScore >= 0.70) {
            regime = 'BULLISH_CATALYST';
            positionSizeMultiplier = 1.15;
            stopLossMultiplier = 1.05;
        } else if (finalScore <= 0.40) {
            regime = 'BEARISH_MACRO';
            positionSizeMultiplier = 0.60;
            stopLossMultiplier = 0.80;
        }

        this.state = {
            ...this.state,
            macroScore: finalScore,
            regime,
            positionSizeMultiplier,
            stopLossMultiplier,
            lastCheckedAt: now
        };

        await this._saveState();
        return this.state;
    }

    async _loadState() {
        try {
            const raw = await fs.readFile(this.cachePath, 'utf8');
            const data = JSON.parse(raw);
            this.state = { ...this.state, ...data };
        } catch {
            // Use defaults if cache does not exist
        }
    }

    async _saveState() {
        try {
            await fs.mkdir(path.dirname(this.cachePath), { recursive: true });
            await fs.writeFile(this.cachePath, JSON.stringify(this.state, null, 2), 'utf8');
        } catch {}
    }
}

export default MacroCatalystRadar;
