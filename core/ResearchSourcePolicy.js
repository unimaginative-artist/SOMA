import { recordTruth } from './TruthLedger.js';

export const SOURCE_TIERS = [
    'mcp',
    'local_cache',
    'dendrite',
    'portal_browser',
    'public_web',
    'limited_api',
    'paid_api'
];

export function rankResearchSources(sources = []) {
    return [...sources]
        .map(source => ({
            ...source,
            tier: source.tier || 'public_web',
            rank: SOURCE_TIERS.indexOf(source.tier || 'public_web') === -1
                ? SOURCE_TIERS.indexOf('public_web')
                : SOURCE_TIERS.indexOf(source.tier || 'public_web')
        }))
        .sort((a, b) => a.rank - b.rank || Number(b.freshness || 0) - Number(a.freshness || 0));
}

export function dedupeResearchItems(items = []) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
        const key = String(item.url || item.id || item.title || item.content || '').toLowerCase().slice(0, 240);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }
    return output;
}

export async function recordResearchAcquisition(topic, items = [], metadata = {}) {
    const deduped = dedupeResearchItems(items);
    await recordTruth(`Research acquired: ${topic}`, {
        status: deduped.length ? 'verified' : 'unverified',
        confidence: deduped.length ? 0.9 : 0.2,
        proof: {
            sourceCount: items.length,
            dedupedCount: deduped.length,
            tiers: [...new Set(deduped.map(item => item.tier || 'unknown'))]
        },
        source: 'research_source_policy',
        metadata
    });
    return deduped;
}
