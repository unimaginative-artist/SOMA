const INSPECTION_TOOLS = new Set([
    'read_file', 'search_code', 'list_files', 'system_search', 'web_fetch',
    'github_search', 'memory_recall', 'computer_read', 'computer_search', 'computer_list'
]);

const ARTIFACT_TOOLS = new Set([
    'write_file', 'workspace_mkdir', 'workspace_write', 'workspace_move', 'workspace_trash',
    'workspace_exec', 'workspace_rollback', 'run_tests', 'verify_syntax', 'pulse_stage_code',
    'modify_code', 'architecture_reorg_apply', 'spawn_agents', 'memory_store', 'goal_cancel',
    'goal_complete', 'update_user_profile'
]);

const EXECUTABLE_PROOF_TOOLS = new Set([
    'workspace_exec', 'run_tests', 'verify_syntax', 'pulse_stage_code'
]);

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

export function inspectionSignature(tool, args = {}) {
    if (!INSPECTION_TOOLS.has(tool)) return null;
    const normalized = { ...(args || {}) };
    if (tool === 'read_file') {
        const start = Math.max(1, Number(normalized.startLine || 1));
        const end = Math.max(start, Number(normalized.endLine || (start + Number(normalized.maxLines || 500) - 1)));
        normalized.path = String(normalized.path || '').replace(/\\/g, '/').toLowerCase();
        // Range buckets catch repeated/overlapping reads without blocking a
        // legitimate move to a different part of a large file.
        normalized.rangeBucket = `${Math.floor((start - 1) / 100)}:${Math.floor((end - 1) / 100)}`;
        delete normalized.startLine;
        delete normalized.endLine;
        delete normalized.maxLines;
    }
    return `${tool}:${JSON.stringify(stable(normalized))}`;
}

export function repeatedInspectionCount(observations = [], tool, args = {}) {
    const signature = inspectionSignature(tool, args);
    if (!signature) return 0;
    let lastSuccessfulMutation = -1;
    for (let index = observations.length - 1; index >= 0; index -= 1) {
        const observation = observations[index];
        if (ARTIFACT_TOOLS.has(observation?.tool) && successfulToolObservation(observation)) {
            lastSuccessfulMutation = index;
            break;
        }
    }
    return observations.slice(lastSuccessfulMutation + 1).reduce((count, observation) => (
        inspectionSignature(observation?.tool, observation?.effectiveArgs || observation?.args || {}) === signature
            ? count + 1
            : count
    ), 0);
}

export function successfulToolObservation(observation = {}) {
    return Boolean(observation?.tool && !observation?.result?.error && observation?.outcome?.ok !== false);
}

export function evidenceProgress(observations = [], { completionEvidence = null } = {}) {
    const successful = observations.filter(successfulToolObservation);
    const uniqueInspections = new Set(successful
        .map(observation => inspectionSignature(observation.tool, observation.effectiveArgs || observation.args || {}))
        .filter(Boolean));
    const artifactObservations = successful.filter(observation => ARTIFACT_TOOLS.has(observation.tool));
    const proofObservations = successful.filter(observation => EXECUTABLE_PROOF_TOOLS.has(observation.tool));
    const artifactPaths = new Set(artifactObservations.map(observation => (
        observation.result?.path || observation.result?.filepath || observation.result?.filePath ||
        observation.result?.artifactPath || observation.result?.manifestPath || observation.args?.path ||
        observation.args?.filepath || observation.args?.filePath || observation.tool
    )).filter(Boolean));

    let progress = Math.min(20, uniqueInspections.size * 5);
    if (artifactObservations.length) progress = Math.max(progress, 35 + Math.min(25, artifactPaths.size * 10));
    if (proofObservations.length) progress = Math.max(progress, 70 + Math.min(20, proofObservations.length * 8));
    if (completionEvidence?.passed === true) progress = 99;

    return {
        progress: Math.min(99, progress),
        uniqueInspections: uniqueInspections.size,
        artifactActions: artifactObservations.length,
        executableProofs: proofObservations.length,
        hasArtifactAction: artifactObservations.length > 0,
        hasExecutableProof: proofObservations.length > 0,
        evidenceTools: [...new Set(artifactObservations.map(observation => observation.tool))]
    };
}

export function actionDeadlineState(observations = [], { maxInspectionActions = 6 } = {}) {
    let lastSuccessfulArtifact = -1;
    for (let index = observations.length - 1; index >= 0; index -= 1) {
        if (ARTIFACT_TOOLS.has(observations[index]?.tool) && successfulToolObservation(observations[index])) {
            lastSuccessfulArtifact = index;
            break;
        }
    }
    // The artifact deadline spans heartbeat/checkpoint sessions. A restart or
    // continuation must not reset Soma's permission to inspect indefinitely.
    // A real state-changing action does reset the counter so verification can
    // inspect the new result.
    const successful = observations.slice(lastSuccessfulArtifact + 1).filter(successfulToolObservation);
    const artifactActions = successful.filter(observation => ARTIFACT_TOOLS.has(observation.tool)).length;
    const inspectionActions = successful.filter(observation => INSPECTION_TOOLS.has(observation.tool)).length;
    return {
        reached: artifactActions === 0 && inspectionActions >= maxInspectionActions,
        inspectionActions,
        artifactActions,
        maxInspectionActions
    };
}

export { ARTIFACT_TOOLS, EXECUTABLE_PROOF_TOOLS, INSPECTION_TOOLS };
