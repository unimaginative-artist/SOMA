/**
 * IctKillzoneEngine.js
 * 
 * Implements the ICT Killzone strategy for SOMA.
 * Targets Asia/London liquidity sweeps and 1-minute FVG reversals at NY open.
 */

export default async function ictKillzoneStrategy({ symbol, bars, currentBar, position, capital }) {
    if (bars.length < 240) return null; // Need history for HTF alignment

    // Timezone helper (New York is UTC-4 in EDT, UTC-5 in EST)
    const getNYTime = (timestamp) => {
        const d = new Date(timestamp);
        const utcHour = d.getUTCHours();
        let nyHour = utcHour - 4; // EDT offset
        if (nyHour < 0) nyHour += 24;
        return { hour: nyHour, min: d.getUTCMinutes(), day: d.getUTCDay() };
    };

    const nyTime = getNYTime(currentBar.timestamp);
    
    // Weekend Blackout: Don't trade if NY time is Saturday (6) or Sunday (0)
    if (nyTime.day === 0 || nyTime.day === 6) {
        return null; // Skip weekends
    }

    // Close positions at end of day
    if (position && nyTime.hour >= 15 && nyTime.min >= 55) {
        return { action: 'SELL', reason: 'EOD_CLOSE' };
    }

    // Take-Profit Scaling Logic (If in a position)
    if (position) {
        // If we haven't taken partials yet
        if (!position.context?.partialTaken) {
            const risk = position.context.risk;
            const target1 = position.entryPrice + risk; // 1:1 R/R

            if (currentBar.high >= target1) {
                // Return signal to close 50% and move stop loss to entry
                return {
                    action: 'UPDATE',
                    closePct: 0.5, // Tell the engine to partial close
                    stopLoss: position.entryPrice, // Move stop loss to break-even
                    context: { partialTaken: true }
                };
            }
        }
        return null; // Hold position
    }

    // Only look for new entries in the Killzone (09:30 - 11:30)
    const inKillzone = (nyTime.hour === 9 && nyTime.min >= 30) || (nyTime.hour === 10) || (nyTime.hour === 11 && nyTime.min <= 30);
    if (!inKillzone) return null;

    // HTF Alignment: Calculate 240-period SMA on 1Min chart (4 Hours)
    let sum240 = 0;
    for (let i = 1; i <= 240; i++) {
        sum240 += bars[bars.length - i].close;
    }
    const sma240 = sum240 / 240;
    const htfTrend = currentBar.close > sma240 ? 'bullish' : 'bearish';

    // Calculate the Asia/London High and Low
    let asiaLondonHigh = -Infinity;
    let asiaLondonLow = Infinity;
    
    for (let i = bars.length - 1; i >= 0; i--) {
        const b = bars[i];
        const t = getNYTime(b.timestamp);
        const isSetup = (t.hour >= 20) || (t.hour < 8) || (t.hour === 8 && t.min <= 30);
        
        if (t.hour > 12 && t.hour < 20 && i < bars.length - 120) {
            break;
        }

        if (isSetup) {
            if (b.high > asiaLondonHigh) asiaLondonHigh = b.high;
            if (b.low < asiaLondonLow) asiaLondonLow = b.low;
        }
    }

    if (asiaLondonHigh === -Infinity || asiaLondonLow === Infinity) return null;

    // Check if a sweep occurred in the recent bars (within Killzone)
    let sweepOccurred = false;
    let sweepDirection = null;
    let sweepWickPrice = null;
    let sweepIndex = -1;

    for (let i = 1; i <= Math.min(15, bars.length - 1); i++) {
        const b = bars[bars.length - i];
        const t = getNYTime(b.timestamp);
        const inKZ = (t.hour === 9 && t.min >= 30) || (t.hour === 10) || (t.hour === 11 && t.min <= 30);
        if (!inKZ) continue;

        if (b.low < asiaLondonLow) {
            sweepOccurred = true;
            sweepDirection = 'bullish';
            sweepWickPrice = Math.min(sweepWickPrice || Infinity, b.low);
            sweepIndex = bars.length - i;
        } else if (b.high > asiaLondonHigh) {
            sweepOccurred = true;
            sweepDirection = 'bearish';
            sweepWickPrice = Math.max(sweepWickPrice || -Infinity, b.high);
            sweepIndex = bars.length - i;
        }
    }

    if (!sweepOccurred) return null;

    // HTF Alignment Filter: Only trade in the direction of the 4H trend
    if (sweepDirection !== htfTrend) return null;

    // Look for FVG
    if (bars.length - sweepIndex < 3) return null;

    let fvgFound = false;
    let fvgTop = null;
    let fvgBottom = null;

    for (let i = sweepIndex; i < bars.length - 2; i++) {
        const c1 = bars[i];
        const c2 = bars[i + 1];
        const c3 = bars[i + 2];

        if (sweepDirection === 'bullish') {
            if (c3.low > c1.high && c2.close > c2.open) {
                fvgFound = true;
                fvgTop = c3.low;
                fvgBottom = c1.high;
                break;
            }
        } else if (sweepDirection === 'bearish') {
            if (c3.high < c1.low && c2.close < c2.open) {
                fvgFound = true;
                fvgTop = c1.low;
                fvgBottom = c3.high;
                break;
            }
        }
    }

    if (!fvgFound) return null;

    // Track trades taken today to prevent overtrading
    const currentDayStr = new Date(currentBar.timestamp).toISOString().split('T')[0];
    if (!global.ictTradesTaken) global.ictTradesTaken = new Set();
    
    // Entry condition
    if (sweepDirection === 'bullish') {
        if (currentBar.low <= fvgTop) {
            const tradeId = `${currentDayStr}-bullish`;
            if (global.ictTradesTaken.has(tradeId)) return null;

            const risk = fvgTop - sweepWickPrice; 
            if (risk <= 0) return null;

            const takeProfit = fvgTop + (risk * 2); 
            const riskAmount = capital * 0.01;
            const positionSize = (riskAmount / risk) * fvgTop;

            global.ictTradesTaken.add(tradeId);

            return {
                action: 'BUY',
                positionSize: Math.min(positionSize, capital * 0.5),
                stopLoss: sweepWickPrice,
                takeProfit: takeProfit,
                context: { setup: 'ICT_Bullish_Sweep_FVG', fvg: [fvgBottom, fvgTop], risk }
            };
        }
    }

    return null;
}
