import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Read-only audit: no runtime imports, broker connection, orders, or learning writes.
const args = process.argv.slice(2);
const value = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const dbPath = path.resolve(value('--db') || 'data/trading/trades.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const sum = (rows, fn) => rows.reduce((total, row) => total + fn(row), 0);
const rounded = n => Number.isFinite(n) ? Number(n.toFixed(6)) : null;
function summarize(rows) {
    const wins = rows.filter(row => row.pnl > 0);
    const losses = rows.filter(row => row.pnl < 0);
    const grossProfit = sum(wins, row => row.pnl);
    const grossLoss = -sum(losses, row => row.pnl);
    const net = grossProfit - grossLoss;
    return {
        closedTrades: rows.length, wins: wins.length, losses: losses.length,
        winRatePct: rounded(rows.length ? wins.length / rows.length * 100 : 0),
        netPnl: rounded(net), expectancyPerTrade: rounded(rows.length ? net / rows.length : 0),
        profitFactor: rounded(grossLoss > 0 ? grossProfit / grossLoss : null),
        averageWin: rounded(wins.length ? grossProfit / wins.length : 0),
        averageLoss: rounded(losses.length ? grossLoss / losses.length : 0),
        recordedFees: rounded(sum(rows, row => Number(row.entry_fee || 0) + Number(row.exit_fee || 0))),
        zeroFeeTrades: rows.filter(row => !(row.entry_fee > 0 || row.exit_fee > 0)).length,
        firstEntry: rows.map(row => row.entry_time).filter(Boolean).sort()[0] || null,
        lastExit: rows.map(row => row.exit_time).filter(Boolean).sort().at(-1) || null
    };
}
function group(rows, key) {
    const groups = new Map();
    for (const row of rows) {
        const label = key(row);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(row);
    }
    return [...groups].map(([label, records]) => ({ label, ...summarize(records) }));
}
try {
    const closed = db.prepare("SELECT * FROM trades WHERE status = 'closed' ORDER BY exit_time, id").all();
    const lastSignals = db.prepare("SELECT symbol, stage, status, payload, created_at FROM trade_lifecycle_events ORDER BY id DESC LIMIT 3000").all();
    const signals = lastSignals.filter(row => row.stage === 'signal').map(row => {
        try { return { ...row, data: JSON.parse(row.payload) }; } catch { return { ...row, data: {} }; }
    });
    const overall = summarize(closed);
    const report = {
        generatedAt: new Date().toISOString(), database: dbPath, mode: 'read_only',
        evidence: 'Authoritative closed ledger; historical fees may be incomplete. No claim of future profitability.',
        overall,
        daysSinceLastClose: overall.lastExit ? rounded((Date.now() - Date.parse(overall.lastExit)) / 86400000) : null,
        byStrategyVersion: group(closed, row => `${row.symbol}|${row.strategy}|${row.strategy_version || 'legacy-unversioned'}`),
        byExitReason: group(closed, row => row.exit_reason || 'unknown'),
        bySide: group(closed, row => row.side),
        recentSignalWindow: {
            signals: signals.length,
            actions: signals.reduce((counts, row) => { const action = row.data.action || 'UNKNOWN'; counts[action] = (counts[action] || 0) + 1; return counts; }, {}),
            firstEvent: lastSignals.at(-1)?.created_at || null,
            lastEvent: lastSignals[0]?.created_at || null,
            lastSignals: signals.slice(0, 5).map(row => ({ symbol: row.symbol, action: row.data.action, confidence: row.data.confidence, time: row.created_at }))
        },
        openTrades: db.prepare("SELECT id, symbol, strategy, strategy_version, side, qty, entry_price, entry_time FROM trades WHERE status = 'open'").all()
    };
    const out = value('--out');
    if (out) { fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 2)); }
    console.log(JSON.stringify(out ? { report: path.resolve(out), overall: report.overall, daysSinceLastClose: report.daysSinceLastClose, recentSignalWindow: report.recentSignalWindow } : report, null, 2));
} finally { db.close(); }
