export const AGENT_CAPABILITY_CONTRACTS = {
    max: {
        name: 'max',
        roles: ['coder', 'researcher'],
        tools: ['readFile', 'replaceInFile', 'grepFiles', 'runShell', 'chat', 'injectGoal'],
        canMutateCode: true,
        requiresHealthCheck: true,
        healthCapability: 'max.http.health',
        evidenceRequired: ['artifact.type', 'artifact.passed', 'targetSummaries']
    },
    soma: {
        name: 'soma',
        roles: ['coder', 'researcher', 'tester', 'reviewer', 'ops'],
        tools: ['read_file', 'search_code', 'verify_syntax', 'run_tests', 'pulse_stage_code', 'market_lab_status', 'market_lab_compile', 'sim_to_live_status', 'sim_to_live_reconcile', 'sim_to_live_backtest'],
        canMutateCode: true,
        requiresHealthCheck: false,
        evidenceRequired: ['artifact.type', 'artifact.passed']
    },
    steve: {
        name: 'steve',
        roles: ['reviewer'],
        tools: ['processChat', 'executeTool'],
        canMutateCode: false,
        requiresHealthCheck: false,
        evidenceRequired: ['verdict', 'concerns']
    },
    kuze: {
        name: 'kuze',
        roles: ['researcher', 'reviewer'],
        tools: ['pattern-detect', 'risk-model', 'find-contradictions', 'correlate'],
        canMutateCode: false,
        requiresHealthCheck: false,
        evidenceRequired: ['findings']
    },
    black: {
        name: 'black',
        roles: ['ops'],
        tools: ['health-check', 'get-metrics', 'predict-failure'],
        canMutateCode: false,
        requiresHealthCheck: false,
        evidenceRequired: ['metrics']
    }
};

export function getAgentsForRole(role) {
    return Object.values(AGENT_CAPABILITY_CONTRACTS)
        .filter(contract => contract.roles.includes(role))
        .map(contract => contract.name);
}

export function getContract(agentName) {
    return AGENT_CAPABILITY_CONTRACTS[String(agentName || '').toLowerCase()] || null;
}

export function describeContracts() {
    return Object.values(AGENT_CAPABILITY_CONTRACTS).map(({ name, roles, tools, canMutateCode, requiresHealthCheck }) => ({
        name,
        roles,
        tools,
        canMutateCode,
        requiresHealthCheck
    }));
}
