const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'trading', 'trades.db');
const db = new Database(dbPath);

const trades = db.prepare(`SELECT * FROM trades WHERE status = 'closed' AND strategy = 'BTC_NATIVE'`).all();

console.log(`Total Trades: ${trades.length}`);

let totalPnL = 0;
let wins = 0;
let losses = 0;

const lossesByRegime = {};
const winsByRegime = {};
let noScoresCount = 0;

for (const t of trades) {
    totalPnL += t.pnl;
    if (t.pnl > 0) {
        wins++;
        winsByRegime[t.regime] = (winsByRegime[t.regime] || 0) + 1;
    } else {
        losses++;
        lossesByRegime[t.regime] = (lossesByRegime[t.regime] || 0) + 1;
    }
}

console.log(`Win Rate: ${((wins / trades.length) * 100).toFixed(2)}%`);
console.log(`Total PnL: $${totalPnL.toFixed(2)}`);
console.log('--- Losses by Regime ---');
console.table(lossesByRegime);
console.log('--- Wins by Regime ---');
console.table(winsByRegime);

// Let's check average scores
let avgWinScore = 0;
let avgLossScore = 0;
let winWithScoreCount = 0;
let lossWithScoreCount = 0;

for (const t of trades) {
    if (t.signal_scores_json) {
        try {
            const scores = JSON.parse(t.signal_scores_json);
            // find highest score
            const conf = Math.max(...Object.values(scores).filter(v => typeof v === 'number'));
            if (t.pnl > 0) {
                avgWinScore += conf;
                winWithScoreCount++;
            } else {
                avgLossScore += conf;
                lossWithScoreCount++;
            }
        } catch(e) {}
    }
}

console.log(`Avg Signal Confidence on Wins: ${(avgWinScore / winWithScoreCount).toFixed(3)}`);
console.log(`Avg Signal Confidence on Losses: ${(avgLossScore / lossWithScoreCount).toFixed(3)}`);

console.log(`\nCONCLUSION: If the avg loss confidence is low (e.g. < 0.70), tightening the entry filter (minConfidence) in autonomousTrader.js from 0.60 to 0.75 will cut out the bleed.`);
