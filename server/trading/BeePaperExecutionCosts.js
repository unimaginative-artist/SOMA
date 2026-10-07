// Conservative paper assumptions, not exchange fills or account-specific fees.
// OKX publishes a 0.05% level-1 perpetual taker example per side.
export const PAPER_TAKER_FEE_RATE = 0.0005;
export const PAPER_SLIPPAGE_RATE = 0.0002; // modeled adverse 2 bps per side
export const PAPER_FUNDING_RESERVE_RATE = 0.0001; // modeled 1 bp per 8h interval

export function paperEntryCosts(price, size) {
    const notional = price * size;
    return {
        fee: notional * PAPER_TAKER_FEE_RATE,
        slippageReserve: notional * PAPER_SLIPPAGE_RATE
    };
}

export function paperExitCosts(price, size, heldMs = 0) {
    const notional = price * size;
    const intervals = Math.ceil(Math.max(0, heldMs) / (8 * 60 * 60 * 1000));
    return {
        fee: notional * PAPER_TAKER_FEE_RATE,
        slippageReserve: notional * PAPER_SLIPPAGE_RATE,
        fundingReserve: notional * PAPER_FUNDING_RESERVE_RATE * intervals
    };
}

export function paperNetPnl({ side, entryPrice, exitPrice, size, heldMs = 0, entryCosts }) {
    const entry = entryCosts || paperEntryCosts(entryPrice, size);
    const exit = paperExitCosts(exitPrice, size, heldMs);
    const grossPnl = (side === 'LONG' ? exitPrice - entryPrice : entryPrice - exitPrice) * size;
    const totalCosts = entry.fee + entry.slippageReserve + exit.fee
        + exit.slippageReserve + exit.fundingReserve;
    return { grossPnl, netPnl: grossPnl - totalCosts, totalCosts, entry, exit };
}
