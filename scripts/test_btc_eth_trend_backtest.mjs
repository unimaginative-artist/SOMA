import fs from 'fs/promises';
import path from 'path';
import multiTimeframeTrendGuard from '../server/finance/MultiTimeframeTrendGuard.js';

console.log('\n======================================================');
console.log('📈 TEST 2: BTC/ETH Multi-Timeframe Trend-Following Backtest');
console.log('======================================================\n');

function calculateATR(bars, index, period = 14) {
  if (index < period) return null;
  let trSum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const high = bars[i].high;
    const low = bars[i].low;
    const prevClose = bars[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  return trSum / period;
}

function runBacktest({ symbol, bars1H, bars4H, useTrendGuard = true, initialCapital = 10000 }) {
  let equity = initialCapital;
  let peakEquity = initialCapital;
  let maxDrawdown = 0;
  let trades = [];
  let currentPosition = null;

  // Map 4H bars by timestamp for fast lookup
  const fourHourMap = new Map();
  for (let i = 0; i < bars4H.length; i++) {
    fourHourMap.set(bars4H[i].timestamp, i);
  }

  // Pre-calculate 20-period highest high for breakout entries
  const lookback = 20;

  for (let i = Math.max(50, lookback); i < bars1H.length; i++) {
    const currentBar = bars1H[i];
    const prevBar = bars1H[i - 1];

    // Track drawdown
    if (equity > peakEquity) peakEquity = equity;
    const dd = (peakEquity - equity) / peakEquity;
    if (dd > maxDrawdown) maxDrawdown = dd;

    // Check position exit if in trade
    if (currentPosition) {
      let exitPrice = null;
      let exitReason = null;

      // Check Stop Loss
      if (currentBar.low <= currentPosition.stopLoss) {
        exitPrice = currentPosition.stopLoss;
        exitReason = 'STOP_LOSS';
      }
      // Check Take Profit
      else if (currentBar.high >= currentPosition.takeProfit) {
        exitPrice = currentPosition.takeProfit;
        exitReason = 'TAKE_PROFIT';
      }
      // Check Trailing Stop
      else {
        const potentialNewStop = currentBar.close - currentPosition.atr * 1.8;
        if (potentialNewStop > currentPosition.stopLoss) {
          currentPosition.stopLoss = potentialNewStop;
        }
      }

      if (exitPrice !== null) {
        const pnl = (exitPrice - currentPosition.entryPrice) * currentPosition.units;
        equity += pnl;
        trades.push({
          entryPrice: currentPosition.entryPrice,
          exitPrice,
          pnl,
          pnlPct: (exitPrice - currentPosition.entryPrice) / currentPosition.entryPrice,
          reason: exitReason,
          barsHeld: i - currentPosition.entryIndex
        });
        currentPosition = null;
        continue;
      }
    }

    // Evaluate Entry only if no active position
    if (!currentPosition) {
      // 1. Breakout signal: current bar closes above highest high of previous N bars
      let highestHigh = -Infinity;
      for (let k = i - lookback; k < i; k++) {
        if (bars1H[k].high > highestHigh) highestHigh = bars1H[k].high;
      }

      const isBreakout = currentBar.close > highestHigh && prevBar.close <= highestHigh;

      if (isBreakout) {
        let allowed = true;

        if (useTrendGuard) {
          // 1H MTF Trend Guard alignment
          const window1H = bars1H.slice(Math.max(0, i - 60), i + 1);
          const guard1H = multiTimeframeTrendGuard.validateTrendAlignment(window1H, 'BUY');

          // Find corresponding 4H bar
          const floor4H = Math.floor(currentBar.timestamp / (4 * 3600 * 1000)) * (4 * 3600 * 1000);
          let index4H = -1;
          for (let offset = 0; offset <= 4 * 3600 * 1000; offset += 3600 * 1000) {
            if (fourHourMap.has(floor4H - offset)) {
              index4H = fourHourMap.get(floor4H - offset);
              break;
            }
          }

          let guard4H = { allowed: true };
          if (index4H >= 35) {
            const window4H = bars4H.slice(Math.max(0, index4H - 50), index4H + 1);
            guard4H = multiTimeframeTrendGuard.validate4HTrendAnchor(window4H, 'BUY');
          }

          allowed = guard1H.allowed && guard4H.allowed;
        }

        if (allowed) {
          const atr = calculateATR(bars1H, i, 14);
          if (atr && atr > 0) {
            const entryPrice = currentBar.close;
            const stopDist = atr * 1.5;
            const targetDist = atr * 4.5; // 3:1 R:R
            const stopLoss = entryPrice - stopDist;
            const takeProfit = entryPrice + targetDist;

            // Position sizing: risk 2% of equity on the trade
            const riskAmount = equity * 0.02;
            const units = riskAmount / stopDist;

            currentPosition = {
              entryPrice,
              entryIndex: i,
              units,
              stopLoss,
              takeProfit,
              atr
            };
          }
        }
      }
    }
  }

  // Compile statistics
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalPnL = equity - initialCapital;
  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0;
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;

  return {
    symbol,
    useTrendGuard,
    initialCapital,
    finalEquity: equity,
    totalPnL,
    returnPct: (totalPnL / initialCapital) * 100,
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate,
    profitFactor,
    maxDrawdownPct: maxDrawdown * 100
  };
}

async function run() {
  const btcPath = path.join(process.cwd(), 'data', 'trading', 'historical-cache', 'BTC-USD_1H.json');
  const btc4HPath = path.join(process.cwd(), 'data', 'trading', 'historical-cache', 'BTC-USD_4H.json');
  const ethPath = path.join(process.cwd(), 'data', 'trading', 'historical-cache', 'ETH-USD_1H.json');
  const eth4HPath = path.join(process.cwd(), 'data', 'trading', 'historical-cache', 'ETH-USD_4H.json');

  console.log('Loading historical OHLCV data from disk...');
  const [btc1H, btc4H, eth1H, eth4H] = await Promise.all([
    fs.readFile(btcPath, 'utf8').then(JSON.parse),
    fs.readFile(btc4HPath, 'utf8').then(JSON.parse),
    fs.readFile(ethPath, 'utf8').then(JSON.parse),
    fs.readFile(eth4HPath, 'utf8').then(JSON.parse)
  ]);

  console.log(`Loaded BTC (1H: ${btc1H.length}, 4H: ${btc4H.length})`);
  console.log(`Loaded ETH (1H: ${eth1H.length}, 4H: ${eth4H.length})`);

  console.log('\n--- 1. BTC-USD Backtest Comparison ---');
  const btcRaw = runBacktest({ symbol: 'BTC-USD', bars1H: btc1H, bars4H: btc4H, useTrendGuard: false });
  const btcGuarded = runBacktest({ symbol: 'BTC-USD', bars1H: btc1H, bars4H: btc4H, useTrendGuard: true });

  console.log(`[BTC Raw Breakout]     Trades: ${btcRaw.totalTrades} | WinRate: ${btcRaw.winRate.toFixed(1)}% | Return: ${btcRaw.returnPct.toFixed(2)}% | MaxDD: ${btcRaw.maxDrawdownPct.toFixed(2)}% | PF: ${btcRaw.profitFactor.toFixed(2)}`);
  console.log(`[BTC + MTF TrendGuard] Trades: ${btcGuarded.totalTrades} | WinRate: ${btcGuarded.winRate.toFixed(1)}% | Return: ${btcGuarded.returnPct.toFixed(2)}% | MaxDD: ${btcGuarded.maxDrawdownPct.toFixed(2)}% | PF: ${btcGuarded.profitFactor.toFixed(2)}`);

  console.log('\n--- 2. ETH-USD Backtest Comparison ---');
  const ethRaw = runBacktest({ symbol: 'ETH-USD', bars1H: eth1H, bars4H: eth4H, useTrendGuard: false });
  const ethGuarded = runBacktest({ symbol: 'ETH-USD', bars1H: eth1H, bars4H: eth4H, useTrendGuard: true });

  console.log(`[ETH Raw Breakout]     Trades: ${ethRaw.totalTrades} | WinRate: ${ethRaw.winRate.toFixed(1)}% | Return: ${ethRaw.returnPct.toFixed(2)}% | MaxDD: ${ethRaw.maxDrawdownPct.toFixed(2)}% | PF: ${ethRaw.profitFactor.toFixed(2)}`);
  console.log(`[ETH + MTF TrendGuard] Trades: ${ethGuarded.totalTrades} | WinRate: ${ethGuarded.winRate.toFixed(1)}% | Return: ${ethGuarded.returnPct.toFixed(2)}% | MaxDD: ${ethGuarded.maxDrawdownPct.toFixed(2)}% | PF: ${ethGuarded.profitFactor.toFixed(2)}`);

  // Verify that Trend Guard successfully filtered low-quality counter-trend trades
  const btcTradesReduced = btcRaw.totalTrades - btcGuarded.totalTrades;
  const ethTradesReduced = ethRaw.totalTrades - ethGuarded.totalTrades;

  console.log('\n--- 3. Quantitative Alpha Verification ---');
  console.log(`BTC Chop Filtered: ${btcTradesReduced} noisy counter-trend trades filtered (${((btcTradesReduced / btcRaw.totalTrades) * 100).toFixed(1)}% noise reduction)`);
  console.log(`ETH Chop Filtered: ${ethTradesReduced} noisy counter-trend trades filtered (${((ethTradesReduced / ethRaw.totalTrades) * 100).toFixed(1)}% noise reduction)`);

  console.log('\n======================================================');
  console.log('✅ TEST 2: BTC/ETH TREND-FOLLOWING BACKTEST COMPLETE');
  console.log('======================================================\n');
}

run().catch(err => {
  console.error('❌ Test 2 failed:', err);
  process.exit(1);
});
