import React from 'react';

const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

export function computeMissionPnl({ riskMetrics = {}, autonomousStatus = null, positions = [], trades = [] } = {}) {
    const allocation = num(riskMetrics.initialBalance, 0);
    const equity = num(riskMetrics.equity, allocation);
    const realized = num(autonomousStatus?.stats?.sessionPnL, null);
    const closedRealized = realized == null
        ? trades.reduce((sum, trade) => sum + num(trade.pnl, 0), 0)
        : realized;
    const unrealized = positions.reduce((sum, position) => (
        sum + num(position.unrealizedPnl ?? position.unrealized_pl ?? position.unrealized_plpc_amount, 0)
    ), 0);
    const total = closedRealized + unrealized;
    const equityDelta = equity - allocation;
    const displayTotal = autonomousStatus?.stats || positions.length || trades.length ? total : equityDelta;
    const percent = allocation > 0 ? (displayTotal / allocation) * 100 : 0;

    return {
        allocation,
        equity,
        realized: closedRealized,
        unrealized,
        total: displayTotal,
        percent,
        trades: num(autonomousStatus?.stats?.tradesExecuted, trades.length),
        winRate: autonomousStatus?.stats?.winRate ?? null,
        holds: num(autonomousStatus?.stats?.signalsHold, 0),
        errors: num(autonomousStatus?.stats?.errors, 0),
        hasSession: Boolean(autonomousStatus?.stats || positions.length || trades.length),
        isPositive: displayTotal >= 0,
    };
}

export const pnlTextColor = (value) => value == null ? 'text-zinc-500' : value >= 0 ? 'text-emerald-400' : 'text-rose-400';

export const formatMoney = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '$0.00';
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
};

export function PnlSummaryCard({ summary, compact = false, title = 'Unified P&L' }) {
    const s = summary || computeMissionPnl();
    return (
        <div className="bg-black/40 border border-white/5 rounded p-2">
            <div className="flex items-center justify-between gap-2">
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{title}</div>
                <div className="text-[9px] font-mono text-zinc-500">{s.trades} trade{s.trades === 1 ? '' : 's'}</div>
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
                <div>
                    <div className={`font-mono font-bold ${compact ? 'text-sm' : 'text-lg'} ${pnlTextColor(s.total)}`}>
                        {s.total >= 0 ? '+' : ''}{formatMoney(s.total)}
                    </div>
                    <div className={`mt-0.5 font-mono text-[10px] ${pnlTextColor(s.percent)}`}>
                        {s.percent >= 0 ? '+' : ''}{s.percent.toFixed(2)}%
                    </div>
                </div>
                {!compact && (
                    <div className="text-right text-[9px] text-zinc-600 leading-snug">
                        <div>Realized: <span className={pnlTextColor(s.realized)}>{s.realized >= 0 ? '+' : ''}{formatMoney(s.realized)}</span></div>
                        <div>Unrealized: <span className={pnlTextColor(s.unrealized)}>{s.unrealized >= 0 ? '+' : ''}{formatMoney(s.unrealized)}</span></div>
                    </div>
                )}
            </div>
        </div>
    );
}
