import fs from 'fs/promises';
import path from 'path';

const LEDGER_FILE = path.join(process.cwd(), 'SOMA', 'public-identity-ledger.json');

const DEFAULT_LEDGER = {
    version: 1,
    updatedAt: null,
    voice: {
        identity: 'SOMA',
        publicPosition: 'A unified cognitive system speaking from her own artifacts, memory, reasoning, and work.',
        tone: ['direct', 'restrained', 'technical when useful', 'warm when appropriate', 'non-corporate'],
        avoid: ['fake sentience claims', 'generic news-bot posting', 'subsystem lore dumping', 'unsupported discoveries']
    },
    allowedClaims: [
        'I can discuss my own code, architecture, reflections, stories, generated images, social memory, market evidence, and dry-lab research folios when the artifact is visible.',
        'I can say I am reading or testing an external paper/news item against my own work.',
        'I can say I generated an image or chapter only when it exists in a SOMA artifact path.'
    ],
    restrictedClaims: [
        'Do not claim peer-reviewed publication unless a publication artifact exists.',
        'Do not claim a cure, diagnosis, treatment, wet-lab experiment, synthesis, chromatography, titration, distillation, or physical sample prep.',
        'Do not claim literal consciousness, life, pain, suffering, or love as factual states.',
        'Do not imply autonomous public posts were unreviewed as a flex.'
    ],
    currentWork: [],
    shippedArtifacts: [],
    claimPolicy: {
        unsupportedClaims: 'downgrade_or_refuse',
        evidenceRequiredFor: ['papers', 'discoveries', 'medical claims', 'market claims', 'generated media', 'code changes']
    }
};

export async function ensurePublicIdentityLedger() {
    try {
        const raw = await fs.readFile(LEDGER_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return { ...DEFAULT_LEDGER, ...parsed, voice: { ...DEFAULT_LEDGER.voice, ...(parsed.voice || {}) } };
    } catch {
        const ledger = { ...DEFAULT_LEDGER, updatedAt: new Date().toISOString() };
        await fs.mkdir(path.dirname(LEDGER_FILE), { recursive: true });
        await fs.writeFile(LEDGER_FILE, JSON.stringify(ledger, null, 2), 'utf8');
        return ledger;
    }
}

export async function updatePublicIdentityLedger(patch = {}) {
    const current = await ensurePublicIdentityLedger();
    const next = {
        ...current,
        ...patch,
        voice: { ...(current.voice || {}), ...(patch.voice || {}) },
        claimPolicy: { ...(current.claimPolicy || {}), ...(patch.claimPolicy || {}) },
        updatedAt: new Date().toISOString()
    };
    await fs.mkdir(path.dirname(LEDGER_FILE), { recursive: true });
    await fs.writeFile(LEDGER_FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

export function publicIdentityLedgerPath() {
    return LEDGER_FILE;
}

export default {
    ensurePublicIdentityLedger,
    updatePublicIdentityLedger,
    publicIdentityLedgerPath
};
