const DIMENSIONS = new Set([
    'reasoning_accuracy',
    'task_completion_rate',
    'memory_precision',
    'tool_efficiency',
    'knowledge_coverage',
    'response_latency_score',
]);

const TEST_PATH = /^tests\/[a-zA-Z0-9._/-]+\.(?:js|cjs|mjs)$/;

function boundedNumber(value, fallback, minimum, maximum) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
}

export function normalizeCapabilityContract(input = {}, context = {}) {
    const raw = input && typeof input === 'object' ? input : {};
    const targetDimension = DIMENSIONS.has(raw.targetDimension) ? raw.targetDimension : null;
    const testFiles = [...new Set((Array.isArray(raw.testFiles) ? raw.testFiles : [])
        .map(value => String(value || '').replace(/\\/g, '/').replace(/^\.\//, ''))
        .filter(value => TEST_PATH.test(value) && !value.includes('..')))].slice(0, 8);
    const risk = ['low', 'medium', 'high'].includes(raw.risk) ? raw.risk : 'medium';
    return {
        schemaVersion: 1,
        objective: String(raw.objective || context.motivation || context.proposedChange || 'bounded non-regression').slice(0, 500),
        targetDimension,
        minimumTargetDelta: targetDimension ? boundedNumber(raw.minimumTargetDelta, 0.01, 0, 0.5) : 0,
        maximumCompositeRegression: boundedNumber(raw.maximumCompositeRegression, 0.01, 0, 0.2),
        maximumRegressedDimensions: Math.floor(boundedNumber(raw.maximumRegressedDimensions, 0, 0, 6)),
        nonRegressionDimensions: [...new Set((Array.isArray(raw.nonRegressionDimensions) ? raw.nonRegressionDimensions : [])
            .filter(value => DIMENSIONS.has(value)))],
        minimumObservations: Math.floor(boundedNumber(raw.minimumObservations, 2, 1, 10)),
        testFiles,
        risk,
        requiresContainer: raw.requiresContainer === true || risk === 'high',
    };
}

export function evaluateCapabilityContract(contract, before, after, comparison, observations = []) {
    const failures = [];
    if (!before || !after || comparison?.valid !== true) failures.push('compatible benchmark evidence unavailable');
    if (observations.length < contract.minimumObservations) {
        failures.push(`only ${observations.length}/${contract.minimumObservations} probation observations collected`);
    }
    if (comparison?.delta < -contract.maximumCompositeRegression) {
        failures.push(`composite regression ${comparison.delta.toFixed(3)} exceeds ${contract.maximumCompositeRegression}`);
    }
    if ((comparison?.regressed?.length || 0) > contract.maximumRegressedDimensions) {
        failures.push(`${comparison.regressed.length} regressed dimensions exceeds ${contract.maximumRegressedDimensions}`);
    }
    if (contract.targetDimension) {
        const delta = Number(after?.scores?.[contract.targetDimension] ?? 0) - Number(before?.scores?.[contract.targetDimension] ?? 0);
        if (delta < contract.minimumTargetDelta) failures.push(`${contract.targetDimension} delta ${delta.toFixed(3)} is below ${contract.minimumTargetDelta}`);
    }
    for (const dimension of contract.nonRegressionDimensions) {
        const delta = Number(after?.scores?.[dimension] ?? 0) - Number(before?.scores?.[dimension] ?? 0);
        if (delta < -0.02) failures.push(`${dimension} regressed by ${delta.toFixed(3)}`);
    }
    return { passed: failures.length === 0, failures };
}

export default normalizeCapabilityContract;
