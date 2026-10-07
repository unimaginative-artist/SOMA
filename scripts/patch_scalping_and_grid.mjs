import fs from 'fs';
import path from 'path';

// ─── 1. PATCH SCALPING ENGINE ──────────────────────────────────────────
const scalpPath = path.resolve('server/finance/scalpingEngine.js');
let scalpCode = fs.readFileSync(scalpPath, 'utf8');

// Update config with realistic fee-clearing targets and tighter risk
scalpCode = scalpCode.replace(
    /minProfitTarget:\s*0\.05,\s*\n\s*maxProfitTarget:\s*0\.20,\s*\n\s*stopLossATRMultiplier:\s*1\.5,/,
    `minProfitTarget: 0.15,       // Raised from 0.05 to comfortably clear exchange fees\n            maxProfitTarget: 0.50,\n            stopLossATRMultiplier: 1.2,  // Tighter stop (1.2x ATR)`
);

// Update enterPosition to store initialStopLoss and highWater
scalpCode = scalpCode.replace(
    /this\.positions\.set\(symbol, \{\s*symbol,\s*entryPrice,\s*qty,\s*entryTime:\s*Date\.now\(\),\s*stopLoss,\s*takeProfit\s*\}\);/,
    `this.positions.set(symbol, {\n                symbol,\n                entryPrice,\n                qty,\n                entryTime: Date.now(),\n                initialStopLoss: stopLoss,\n                stopLoss,\n                takeProfit,\n                highWater: 0\n            });`
);

// Redesign checkExit with true positive profit locking and trailing stop
const oldCheckExit = `    checkExit(symbol, price, position, history) {
        const pnl = price - position.entryPrice;
        const holdTime = Date.now() - position.entryTime;

        // Dynamic stop-loss (ATR-based, set at entry)
        if (pnl <= -position.stopLoss) {
            this.exitPosition(symbol, price, 'STOP');
            return;
        }

        // Dynamic take-profit (middle Bollinger Band target)
        if (pnl >= position.takeProfit) {
            this.exitPosition(symbol, price, 'TARGET');
            return;
        }

        // Trailing stop: if we're profitable, tighten stop to breakeven
        if (pnl > position.stopLoss && position.stopLoss > 0) {
            position.stopLoss = Math.max(0, pnl * 0.5); // Lock in 50% of unrealized profit
        }

        // Time-based exit: close after 5 minutes if no clear direction
        if (holdTime > 300000 && Math.abs(pnl) < position.stopLoss * 0.3) {
            this.exitPosition(symbol, price, 'TIMEOUT');
        }
    }`;

const newCheckExit = `    checkExit(symbol, price, position, history) {
        const pnl = price - position.entryPrice;
        const holdTime = Date.now() - position.entryTime;

        // Track high water mark for unrealized profit
        if (pnl > (position.highWater || 0)) {
            position.highWater = pnl;
        }
        const highWater = position.highWater || 0;

        // 1. Dynamic hard stop-loss (ATR-based initial risk)
        const initialStop = position.initialStopLoss || position.stopLoss;
        if (pnl <= -initialStop) {
            this.exitPosition(symbol, price, 'STOP');
            return;
        }

        // 2. Breakeven / Profit Lock:
        // Once position reaches 45% of target profit, lock in positive exit
        const breakevenThreshold = position.takeProfit * 0.45;
        if (highWater >= breakevenThreshold) {
            const minProfitLock = Math.max(0.02, highWater * 0.35); // Lock in at least 35% of peak gains
            if (pnl <= minProfitLock) {
                this.exitPosition(symbol, price, 'BREAKEVEN_LOCK');
                return;
            }
        }

        // 3. Dynamic Trailing Stop:
        // If price surges near target (>= 75% of TP) and pulls back, bank it!
        if (highWater >= position.takeProfit * 0.75 && pnl <= highWater * 0.70) {
            this.exitPosition(symbol, price, 'TRAILING_STOP');
            return;
        }

        // 4. Dynamic take-profit (middle Bollinger Band target or higher)
        if (pnl >= position.takeProfit) {
            this.exitPosition(symbol, price, 'TARGET');
            return;
        }

        // 5. Time-based stagnation exit:
        // Close after 3 minutes if price is flat and chop is decaying momentum
        if (holdTime > 180000 && Math.abs(pnl) < initialStop * 0.25) {
            this.exitPosition(symbol, price, 'TIMEOUT');
            return;
        }
    }`;

scalpCode = scalpCode.replace(oldCheckExit, newCheckExit);

// Update exitPosition to deduct realistic exchange fees (0.1% round-trip)
scalpCode = scalpCode.replace(
    /const pos = this\.positions\.get\(symbol\);\s*if \(!pos\) return;\s*const pnl = \(exitPrice - pos\.entryPrice\) \* pos\.qty;/,
    `const pos = this.positions.get(symbol);
        if (!pos) return;
        const notional = pos.entryPrice * pos.qty;
        const feeRate = 0.001; // 0.1% round-trip fee
        const fees = notional * feeRate * 2;
        const grossPnl = (exitPrice - pos.entryPrice) * pos.qty;
        const pnl = grossPnl - fees; // Realized net PnL after exchange fees`
);

fs.writeFileSync(scalpPath, scalpCode, 'utf8');
console.log('✅ scalpingEngine.js patched successfully');

// ─── 2. PATCH HIGH FREQUENCY GRID ENGINE ───────────────────────────────
const gridPath = path.resolve('server/finance/HighFrequencyGridEngine.js');
let gridCode = fs.readFileSync(gridPath, 'utf8');

// Update grid spacing to comfortably beat the fee barrier (0.65% vs 0.30% fees)
gridCode = gridCode.replace(
    /this\.gridSpacingPct = config\.gridSpacingPct \|\| 0\.0025; \/\/ 0\.25% price spacing per grid tier/,
    `this.gridSpacingPct = config.gridSpacingPct || 0.0065; // 0.65% price spacing per grid tier (clears 0.30% round-trip fees with positive net)`
);

// Add maxInventoryDrawdownPct guard
gridCode = gridCode.replace(
    /this\.maxInventoryLevels = config\.maxInventoryLevels \|\| 8; \/\/ Max 8 open buy levels/,
    `this.maxInventoryLevels = config.maxInventoryLevels || 6; // Max 6 open buy levels\n        this.maxDrawdownPct = config.maxDrawdownPct || 0.025;   // 2.5% max drawdown circuit breaker`
);

// Deduct both entry and exit fees in netProfit
gridCode = gridCode.replace(
    /const grossProfit = tradeNotional - costNotional;\s*const exitFee = tradeNotional \* feeRate;\s*const netProfit = grossProfit - exitFee;/,
    `const grossProfit = tradeNotional - costNotional;\n                const entryFee = costNotional * feeRate;\n                const exitFee = tradeNotional * feeRate;\n                const totalTradeFees = entryFee + exitFee;\n                const netProfit = grossProfit - totalTradeFees;`
);

fs.writeFileSync(gridPath, gridCode, 'utf8');
console.log('✅ HighFrequencyGridEngine.js patched successfully');
