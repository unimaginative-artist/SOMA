
// Helper for Gaussian distribution (Box-Muller transform)
const randomNormal = (mean, stdev) => {
    const u = 1 - Math.random();
    const v = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    return z * stdev + mean;
};

const prepareSlate = (games) => {
    const slate = [];

    games.forEach(game => {
        const allPlayers = [...game.homePlayerStats, ...game.awayPlayerStats];
        allPlayers.forEach(p => {
            const prop = game.props.find(pr => pr.playerId === p.id && pr.type === 'PTS');
            const baseAvg = prop ? prop.line : (p.rating * 3);

            slate.push({
                id: p.id,
                name: p.name,
                avg: baseAvg,
                stdev: baseAvg * 0.22, // Tighter baseline
                minutes: 36,
                usage: 1.0 + ((p.rating - 7) / 10),
                marketLine: prop ? prop.line : baseAvg - 1.5
            });
        });
    });

    return slate;
};

const simulatePlayerPerformance = (player, constraints) => {
    if (Math.random() < constraints.injuryRisk) return 0;

    let minutesMod = constraints.fatigueLevel;
    if (Math.random() < constraints.blowoutRisk) {
        minutesMod *= 0.70;
    }

    const effectiveMinutes = player.minutes * minutesMod;

    // Script Modifiers: Pace and Defense Intensity combine to create a performance multiplier
    const scriptFactor = constraints.paceModifier * constraints.defenseIntensity;
    const adjustedAvg = player.avg * constraints.weatherImpact * scriptFactor;

    const rawPerformance = randomNormal(adjustedAvg, player.stdev);
    const minutesFactor = effectiveMinutes / 36;
    const result = rawPerformance * minutesFactor * player.usage;

    return Math.max(0, result);
};

export const runOracleSimulation = (
    games,
    constraints,
    objective
) => {
    return new Promise((resolve) => {
        setTimeout(() => {
            const slate = prepareSlate(games);
            const iterations = 5000; // Increased sample size for smoother distributions
            const results = [];

            slate.forEach(player => {
                const samples = [];
                let overCount = 0;

                for (let i = 0; i < iterations; i++) {
                    const val = simulatePlayerPerformance(player, constraints);
                    samples.push(val);
                    if (val > player.marketLine) overCount++;
                }

                const sum = samples.reduce((a, b) => a + b, 0);
                const mean = sum / iterations;
                const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / iterations;
                const stdDev = Math.sqrt(variance);
                const edge = mean - player.marketLine;
                const overProb = (overCount / iterations) * 100;

                // Generate distribution bins (Histogram)
                const minVal = Math.max(0, mean - (3 * stdDev));
                const maxVal = mean + (3 * stdDev);
                const binCount = 20;
                const binWidth = (maxVal - minVal) / binCount;
                const distribution = [];

                for (let i = 0; i < binCount; i++) {
                    const binStart = minVal + (i * binWidth);
                    const binEnd = binStart + binWidth;
                    const count = samples.filter(s => s >= binStart && s < binEnd).length;
                    distribution.push({
                        range: `${Math.round(binStart)}-${Math.round(binEnd)}`,
                        value: binStart,
                        count: count
                    });
                }

                let score = 0;
                let recommendation = "PASS";

                switch (objective) {
                    case 'MAX_POINTS': score = mean; break;
                    case 'MIN_VARIANCE': score = mean / (stdDev + 1); break;
                    case 'BEST_SLEEPER': score = edge; break;
                    case 'HIGH_UPSIDE': score = mean + (1.65 * stdDev); break; // 95th percentile
                    case 'SAFE_FLOOR': score = mean - (1.65 * stdDev); break; // 5th percentile
                }

                if (objective === 'MIN_VARIANCE' || objective === 'SAFE_FLOOR') {
                    recommendation = overProb > 65 ? "ANCHOR" : "PASS";
                } else {
                    recommendation = edge > 3 ? "SMASH" : edge > 0 ? "PLAY" : "FADE";
                }

                results.push({
                    playerId: player.id,
                    playerName: player.name,
                    marketLine: player.marketLine,
                    oracleMean: mean,
                    overProbability: overProb,
                    edge: edge,
                    volatility: stdDev,
                    score: score,
                    recommendation,
                    distribution
                });
            });

            results.sort((a, b) => b.score - a.score);
            resolve(results);
        }, 1200);
    });
};
