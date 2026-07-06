import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'trading', 'trades.db');
const db = new Database(dbPath);

const trades = db.prepare('SELECT * FROM trades ORDER BY exit_time DESC LIMIT 50').all();

let wins = 0;
let losses = 0;
let totalPnl = 0;
let reasons = {};

for (const trade of trades) {
    if (trade.pnl > 0) wins++;
    else if (trade.pnl < 0) losses++;
    totalPnl += trade.pnl;
    
    const reason = trade.exit_reason || 'Unknown';
    reasons[reason] = (reasons[reason] || 0) + 1;
}

console.log('--- Last 50 Trades Analysis ---');
console.log('Total Trades Analyzed:', trades.length);
console.log('Wins:', wins);
console.log('Losses:', losses);
console.log('Win Rate:', (wins / trades.length * 100).toFixed(2) + '%');
console.log('Total PnL:', totalPnl.toFixed(2));
console.log('Exit Reasons:', reasons);

// Let's look at the first 3 losing trades to see what went wrong
const losingTrades = trades.filter(t => t.pnl < 0).slice(0, 3);
console.log('\n--- Sample Losing Trades ---');
console.log(JSON.stringify(losingTrades, null, 2));

