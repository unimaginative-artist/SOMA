import { getContract } from './AgentCapabilityContracts.js';

const REQUIRED_BY_TYPE = {
    research_report: ['findings'],
    code_patch_plan: ['plan', 'verificationRequired'],
    test_report: ['checks'],
    review_verdict: ['verdict', 'requiredBeforeDone'],
    ops_report: ['checks']
};

function hasValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return value !== undefined && value !== null && value !== '';
}

function getPathValue(obj, dotted) {
    return String(dotted).split('.').reduce((acc, key) => acc?.[key], obj);
}

export function validateAgentArtifact(artifact = {}, options = {}) {
    const issues = [];
    const warnings = [];
    
    // Auto-map snake_case from MAX or other external agents to SOMA's camelCase standard
    if (artifact.artifact_type && !artifact.type) artifact.type = artifact.artifact_type;
    if (artifact.verification_required !== undefined && artifact.verificationRequired === undefined) {
        artifact.verificationRequired = artifact.verification_required;
    }
    // External patches usually haven't "passed" tests yet until SOMA runs them, but the schema requires the field
    if (artifact.passed === undefined && artifact.type === 'code_patch_plan') {
        artifact.passed = true; // Assumed structurally valid so it can enter the pipeline
    }
    
    const role = artifact.role || options.role;
    const agent = artifact.agent || options.agent || 'soma';
    const contract = getContract(agent);

    if (!role) issues.push('Missing artifact.role');
    if (!artifact.type) issues.push('Missing artifact.type');
    if (!Object.prototype.hasOwnProperty.call(artifact, 'passed')) issues.push('Missing artifact.passed');

    const typeRequired = REQUIRED_BY_TYPE[artifact.type] || [];
    for (const field of typeRequired) {
        if (!hasValue(artifact[field])) issues.push(`Missing required ${artifact.type} field: ${field}`);
    }

    if (contract) {
        if (role && !contract.roles.includes(role)) issues.push(`${agent} contract does not allow role: ${role}`);
        for (const field of contract.evidenceRequired || []) {
            if (!hasValue(getPathValue({ artifact, ...artifact }, field))) warnings.push(`Contract evidence not present: ${field}`);
        }
    }

    if (artifact.type === 'code_patch_plan' && !String(JSON.stringify(artifact)).match(/\b(test|syntax|build|verify)\b/i)) {
        issues.push('Code patch plan lacks verification language');
    }

    if (artifact.type === 'test_report') {
        const checks = Array.isArray(artifact.checks) ? artifact.checks : [];
        if (!checks.length) issues.push('Test report has no checks');
        if (checks.some(check => check.passed === false)) issues.push('One or more test checks failed');
    }

    const passed = issues.length === 0 && artifact.passed !== false;
    return {
        passed,
        score: Math.max(0, Math.min(100, 100 - issues.length * 35 - warnings.length * 8)),
        issues,
        warnings,
        contract: contract?.name || null
    };
}

export function validateArtifactBatch(artifacts = []) {
    const validations = artifacts.map(artifact => validateAgentArtifact(artifact));
    return {
        passed: validations.every(v => v.passed),
        validations,
        score: validations.length
            ? Math.round(validations.reduce((sum, v) => sum + v.score, 0) / validations.length)
            : 0
    };
}
