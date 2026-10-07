import { normalizeTradingStrategyId } from './TradeAttribution.js';

function weightedAverage(rewards, decay) {
    let weighted = 0;
    let totalWeight = 0;
    for (let index = 0; index < rewards.length; index++) {
        const weight = Math.pow(decay, rewards.length - 1 - index);
        weighted += rewards[index] * weight;
        totalWeight += weight;
    }
    return totalWeight > 0 ? weighted / totalWeight : 0;
}

function normalizedPnlFraction(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 0;
    return Math.abs(number) > 1 ? number / 100 : number;
}

export function buildLiveStrategyEvidence(trades = []) {
    const evidence = {};
    for (const trade of trades) {
        if (trade?.status && trade.status !== 'closed') continue;
        const strategyId = normalizeTradingStrategyId(trade?.strategy);
        if (!evidence[strategyId]) evidence[strategyId] = { trials: 0, wins: 0, rewards: [], avgReward: 0, byRegime: {} };
        const row = evidence[strategyId];
        const pnlPct = normalizedPnlFraction(trade?.pnl_pct);
        const reward = Math.tanh(pnlPct * 20);
        row.trials++;
        if (Number(trade?.pnl) > 0) row.wins++;
        row.rewards.push(reward);
        if (row.rewards.length > 100) row.rewards.shift();

        const regime = String(trade?.regime || '').trim().toUpperCase();
        if (regime) {
            if (!row.byRegime[regime]) row.byRegime[regime] = { trials: 0, wins: 0, rewards: [], avgReward: 0 };
            const regimeRow = row.byRegime[regime];
            regimeRow.trials++;
            if (Number(trade?.pnl) > 0) regimeRow.wins++;
            regimeRow.rewards.push(reward);
            if (regimeRow.rewards.length > 50) regimeRow.rewards.shift();
        }
    }
    for (const row of Object.values(evidence)) {
        row.avgReward = weightedAverage(row.rewards, 0.97);
        for (const regimeRow of Object.values(row.byRegime)) {
            regimeRow.avgReward = weightedAverage(regimeRow.rewards, 0.97);
        }
    }
    return evidence;
}
