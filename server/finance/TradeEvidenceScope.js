// BeeBot rows can enter the central ledger during tests and legacy imports.
// Only rows with explicit paper provenance may count as verified Bee evidence.
export function isBeeStrategy(trade = {}) {
    return String(trade.strategy || '').toLowerCase().startsWith('beebots_');
}

export function eligiblePaperTrade(trade = {}) {
    if (!isBeeStrategy(trade)) return true;
    try {
        const attribution = JSON.parse(trade.attribution_json || '{}');
        return attribution.source === 'soma_beebots' && attribution.mode === 'paper'
            && attribution.strategyId === trade.strategy;
    } catch {
        return false;
    }
}

export function summarizePaperTrades(trades = []) {
    const rows = trades.filter(eligiblePaperTrade);
    const wins = rows.filter(row => Number(row.pnl || 0) > 0);
    const losses = rows.filter(row => Number(row.pnl || 0) <= 0);
    const profit = wins.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
    const loss = losses.reduce((sum, row) => sum + Math.abs(Number(row.pnl || 0)), 0);
    const slippage = rows.filter(row => row.slippage_pct != null);
    return {
        totalTrades: rows.length, wins: wins.length, losses: losses.length,
        winRate: rows.length ? wins.length / rows.length * 100 : 0,
        totalPnl: rows.reduce((sum, row) => sum + Number(row.pnl || 0), 0),
        totalProfit: profit, totalLoss: loss,
        avgWin: wins.length ? profit / wins.length : 0,
        avgLoss: losses.length ? loss / losses.length : 0,
        profitFactor: loss ? profit / loss : profit ? Infinity : 0,
        largestWin: wins.length ? Math.max(...wins.map(row => Number(row.pnl))) : 0,
        largestLoss: losses.length ? Math.min(...losses.map(row => Number(row.pnl))) : 0,
        avgSlippage: slippage.length ? slippage.reduce((sum, row) => sum + Number(row.slippage_pct), 0) / slippage.length : 0,
    };
}
