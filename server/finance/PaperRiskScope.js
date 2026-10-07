import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { RiskManager } from '../../arbiters/RiskManager.js';

const ACCOUNT_LOSS_HALTS = new Set(['Max drawdown exceeded', 'Daily loss limit exceeded', 'Max drawdown exceeded - all positions closed by Guardian']);
export function brokerHaltAppliesToPaper(manager) {
    const state = manager?.riskState;
    // Unknown/legacy safety stops remain global; only known account P&L stops
    // belong to that account. Never clear the broker's persisted halt.
    return !!state?.isHalted && (state.haltScope === 'all' || !ACCOUNT_LOSS_HALTS.has(state.haltReason));
}

export class PaperRiskScope {
    constructor({ rootPath = process.cwd(), identity }) {
        if (!identity) throw new Error('Paper risk needs a strategy account identity');
        this.identity = identity;
        this.manager = new RiskManager({ rootPath });
        this.manager.riskPath = path.join(rootPath, 'data', 'risk', 'paper', createHash('sha256').update(identity).digest('hex').slice(0, 24));
        this.statePath = path.join(this.manager.riskPath, 'risk_state.json');
        this.ready = null;
    }

    async initialize() {
        await fs.mkdir(this.manager.riskPath, { recursive: true });
        try {
            const saved = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            if (saved.identity !== this.identity || !Number.isFinite(saved.peakValue)) throw new Error('Paper risk identity/state mismatch');
            this.manager.portfolio.peakValue = saved.peakValue;
            this.manager.riskState = { ...this.manager.riskState, ...saved.riskState };
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        // Use one compact account-bound state format, including on a halt.
        this.manager.saveRiskState = async () => {
            const state = { identity: this.identity, peakValue: this.manager.portfolio.peakValue, riskState: this.manager.riskState, updatedAt: Date.now() };
            await fs.writeFile(`${this.statePath}.tmp`, JSON.stringify(state, null, 2));
            await fs.rename(`${this.statePath}.tmp`, this.statePath);
        };
    }

    async validate({ trade, portfolio, closedTrades = [], openTrades = [], config = {}, brokerRisk, now = Date.now() }) {
        if (brokerHaltAppliesToPaper(brokerRisk)) return { approved: false, violations: [{ action: 'REJECT', rule: 'GLOBAL_HALT', message: `Trading halted: ${brokerRisk.riskState.haltReason}` }] };
        if (!this.ready) this.ready = this.initialize();
        await this.ready;
        const risk = this.manager;
        risk.limits = { ...risk.limits, ...brokerRisk?.limits };
        risk.limits.maxDrawdown = Math.min(risk.limits.maxDrawdown, config.maxSessionDrawdownPct || .05);
        risk.limits.maxPositionSize = Math.min(risk.limits.maxPositionSize, config.maxPositionPct || .10);
        const initial = Number(portfolio?.initialBalance);
        let equity = Number(portfolio?.balance), unrealized = 0;
        const positions = new Map();
        for (const [symbol, pos] of Object.entries(portfolio?.positions || {})) {
            if (symbol !== trade.symbol) throw new Error('Paper risk needs a fresh mark for every position');
            const direction = pos.side === 'short' ? -1 : 1;
            const value = Number(pos.qty) * Number(trade.price);
            equity += direction * value;
            unrealized += direction * Number(pos.qty) * (Number(trade.price) - Number(pos.entryPrice));
            positions.set(symbol, { value, side: pos.side });
        }
        if (!(initial > 0) || !(equity > 0) || !Number.isFinite(equity) || !(trade.price > 0) || !(trade.size > 0)) {
            return { approved: false, violations: [{ action: 'REJECT', rule: 'INVALID_PAPER_EQUITY', message: 'Paper account equity or order data is invalid' }] };
        }
        const timestamp = value => { const raw = String(value || ''); return Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'); };
        const closed = [...closedTrades].sort((a,b) => timestamp(a.exit_time) - timestamp(b.exit_time));
        let realized = 0, curvePeak = initial, dayPnL = 0, losses = 0;
        const dayStart = Date.parse(new Date(now).toISOString().slice(0,10) + 'T00:00:00Z');
        for (const row of closed) {
            const pnl = Number(row.pnl);
            if (!Number.isFinite(pnl)) throw new Error('Paper ledger contains invalid P&L');
            realized += pnl; curvePeak = Math.max(curvePeak, initial + realized);
            if (timestamp(row.exit_time) >= dayStart) dayPnL += pnl;
            losses = pnl < 0 ? losses + 1 : 0;
        }
        risk.portfolio.peakValue = Math.max(risk.portfolio.peakValue, curvePeak);
        risk.updatePortfolio({ totalValue: equity, cash: portfolio.balance, positions, unrealizedPnL: unrealized, realizedPnL: realized, dailyPnL: dayPnL + unrealized });
        risk.riskState.dailyTrades = [...closed, ...openTrades].filter(row => timestamp(row.entry_time) >= dayStart).length;
        risk.riskState.consecutiveLosses = losses;
        const result = await risk.validateTrade({ ...trade, allowFractional: true });
        await risk.saveRiskState();
        return { ...result, scope: 'local_paper', identity: this.identity, equity, drawdown: risk.portfolio.currentDrawdown };
    }
}
