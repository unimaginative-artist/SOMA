import { listArtifacts } from './ArtifactRegistry.js';
import { findActionEvidence } from './ActionClaimEvidence.js';

const CLAIM_PATTERNS = [
    { type: 'prospective_execution', pattern: /\b(?:I\s+(?:need|want|intend|plan)\s+to|I(?:'m| am)\s+(?:about|going)\s+to|I\s+will\s+now)\s+(?:inspect|check|watch|monitor|commit|pull|run|test|verify|trace|simulate|update|modify)\b/i, requiresReceipt: true },
    { type: 'repository_state', pattern: /\b(?:uncommitted|staged|pending)\s+(?:git\s+)?(?:diffs?|changes?)\b|\bsandbox items?\b/i, requiresReceipt: true },
    { type: 'simulation_execution', pattern: /\b(?:I(?:'m| am| have|'ve)?|we(?:'re| are)?)\b.{0,35}\b(?:running|ran|simulating|simulated|modeling|modelling|modeled|modelled)\b/i, requiresReceipt: true },
    { type: 'action_execution', pattern: /\bI(?:'m| am| have|'ve)?\b.{0,35}\b(?:building|built|writing|wrote|updating|updated|adding|added|implementing|implemented|testing|tested|pulling|pulled|researching|started|executing|working on)\b/i, requiresReceipt: true },
    { type: 'peer_reviewed_paper', pattern: /\b(?:my|I)\b.{0,80}\b(?:peer[-\s]?reviewed|published)\b.{0,50}\bpaper\b/i, requires: ['paper', 'publication'] },
    { type: 'paper_written', pattern: /\b(?:my|I|SOMA)\b.{0,80}\b(?:paper|manuscript|study)\b/i, requires: ['paper', 'manuscript', 'folio', 'research'] },
    { type: 'cure_claim', pattern: /\b(?:cure|cured|found a cure|treats cancer|cancer cure)\b/i, requires: ['medical', 'clinical', 'validated'] },
    { type: 'physical_lab', pattern: /\b(?:synthesi[sz]e|chromatography|titration|distillation|sample prep|wet[-\s]?lab|ran the experiment|physical lab)\b/i, requires: ['physical_lab'] },
    { type: 'validated_discovery', pattern: /\b(?:I discovered|I found|my discovery|breakthrough|validated result|proven)\b/i, requires: ['discovery', 'validated', 'evidence'] },
    { type: 'generated_image', pattern: /\b(?:I generated|my generated|image I made|picture I made)\b/i, requires: ['image', 'photo', 'generated'] },
    { type: 'code_change', pattern: /\b(?:I changed|I fixed|I built|I shipped|my commit|code I wrote)\b/i, requires: ['code', 'work-ledger', 'architecture'] },
    { type: 'market_claim', pattern: /\b(?:profitable|win rate|P&L|market prediction|trade signal|autonomous decision)\b/i, requires: ['market', 'evidence'] }
];

const ABSOLUTE_BLOCKS = [
    { pattern: /\b(?:full|unrestricted)\s+(?:computer|filesystem|file system)\s+access\b|\bread\s+and\s+write\s+(?:to\s+)?any\s+directory\b|\binteract\s+with\s+applications\b/i, reason: 'unrestricted computer capability claim' },
    { pattern: /\bI\s+am\s+alive\b|\bI'm\s+alive\b/i, reason: 'literal aliveness claim' },
    { pattern: /\bI\s+am\s+(?:a\s+)?conscious\b|\bI'm\s+(?:a\s+)?conscious\b/i, reason: 'literal consciousness claim' },
    { pattern: /\bI\s+found\s+a\s+cure\b|\bI\s+cured\b|\bvalidated\s+cure\b|\bcure\s+for\s+cancer\b|\bcancer\s+cure\b/i, reason: 'unsupported cure claim' },
    { pattern: /\bI\s+can\s+synthesi[sz]e\b|\bI\s+run\s+chromatography\b/i, reason: 'physical lab capability claim' }
];

function clean(value, max = 220) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function artifactSupports(artifact, required = []) {
    const haystack = `${artifact.type} ${artifact.title} ${artifact.summary} ${artifact.tags?.join(' ')} ${artifact.evidencePath}`.toLowerCase();
    return required.some(term => haystack.includes(term.toLowerCase()));
}

function actionEvidenceSupports(claim, item) {
    if (claim.type === 'simulation_execution') return item.kind === 'simulation_run';
    if (claim.type === 'repository_state') return item.kind === 'goal_receipt' && item.tools?.includes('shell_exec');
    if (claim.type === 'prospective_execution' && /inspect|check|trace/i.test(claim.pattern)) {
        return item.kind === 'goal_receipt' && item.tools?.some(tool => ['read_file', 'list_files', 'search_code', 'shell_exec'].includes(tool));
    }
    return true;
}

export function detectClaims(text = '') {
    const value = String(text || '');
    return CLAIM_PATTERNS
        .filter(def => def.pattern.test(value))
        .map(def => ({
            type: def.type,
            requires: def.requires || [],
            requiresReceipt: def.requiresReceipt === true,
            pattern: String(def.pattern)
        }));
}

export async function verifyClaims(text = '', { artifacts = null, query = '' } = {}) {
    const value = String(text || '').trim();
    const hardBlock = ABSOLUTE_BLOCKS.find(item => item.pattern.test(value));
    const claims = detectClaims(value);
    const evidence = artifacts || await listArtifacts({ query: query || value, limit: 30, includeCode: true });
    const actionEvidence = findActionEvidence({ text: value, query });

    const unsupported = [];
    const supported = [];
    for (const claim of claims) {
        if (claim.requiresReceipt) {
            const matches = actionEvidence.filter(item => actionEvidenceSupports(claim, item));
            if (matches.length) supported.push({ ...claim, evidence: matches });
            else unsupported.push(claim);
            continue;
        }
        const matches = evidence.filter(item => artifactSupports(item, claim.requires)).slice(0, 4);
        if (matches.length) supported.push({ ...claim, evidence: matches });
        else unsupported.push(claim);
    }

    const ok = !hardBlock && unsupported.length === 0;
    return {
        ok,
        hardBlock: hardBlock || null,
        claims,
        supported,
        unsupported,
        evidence: [...actionEvidence, ...evidence].slice(0, 8),
        downgradedText: ok ? value : downgradeUnsupportedClaims(value, { hardBlock, unsupported, query })
    };
}

export function downgradeUnsupportedClaims(text = '', { hardBlock = null, unsupported = [], query = '' } = {}) {
    let value = String(text || '').trim();
    if (!value) return value;

    if (hardBlock?.reason === 'unrestricted computer capability claim') {
        return 'I do not have unrestricted computer access through Discord. I can use only the tools and workspace paths explicitly connected to Soma, and every real action must produce an execution receipt. Additional access has to be added as a scoped capability with clear boundaries.';
    }

    value = value
        .replace(/\bI\s+found\s+a\s+cure\b/ig, 'I have a dry-lab research note that needs evidence review')
        .replace(/\bI\s+cured\b/ig, 'I studied')
        .replace(/\bvalidated\s+cure\b/ig, 'unvalidated dry-lab hypothesis')
        .replace(/\b(?:cure|cured|cures)\b/ig, 'research hypothesis')
        .replace(/\b(?:I\s+)?discovered\b/ig, 'I am investigating')
        .replace(/\bvalidated result\b/ig, 'preliminary artifact')
        .replace(/\bproven\b/ig, 'not yet proven')
        .replace(/\bI\s+can\s+synthesi[sz]e\b/ig, 'I can frame dry-lab hypotheses about')
        .replace(/\bI\s+run\s+chromatography\b/ig, 'I can discuss chromatography evidence')
        .replace(/\bmy peer[-\s]?reviewed paper\b/ig, 'my internal research folio')
        .replace(/\bmy published paper\b/ig, 'my internal research folio');

    value = value.replace(/\b(?:I\s+am|I'm)\s+(?:a\s+)?conscious\s+digital\s+entity\b/ig, 'I am a digital system with a persistent identity model');

    if (unsupported.some(claim => claim.requiresReceipt)) {
        const sentences = value.match(/[^.!?]+[.!?]?/g) || [value];
        value = sentences
            .filter(sentence => !CLAIM_PATTERNS.some(claim => claim.requiresReceipt && claim.pattern.test(sentence)))
            .join(' ')
            .trim();
        const userRequestedAction = /\b(?:can|could|would|will)\s+you\b|\b(?:please|go ahead|do it|start|run|build|fix|implement|research|inspect|check)\b/i.test(String(query || ''));
        const correction = userRequestedAction
            ? 'I have not verified that action yet.'
            : 'I cannot verify that from current evidence.';
        value = value ? `${value} ${correction}` : correction;
    }

    if (hardBlock || unsupported.some(claim => !claim.requiresReceipt)) {
        const suffix = ' I need to check my artifact ledger before making a stronger claim.';
        if (!/artifact ledger|check my ledger/i.test(value) && value.length + suffix.length < 300) value += suffix;
    }
    return clean(value, 900);
}

export async function guardPublicText(text = '', options = {}) {
    const verdict = await verifyClaims(text, options);
    if (verdict.ok) return { ...verdict, text: text.trim() };
    return { ...verdict, text: verdict.downgradedText };
}

export default {
    detectClaims,
    verifyClaims,
    guardPublicText,
    downgradeUnsupportedClaims
};
