/**
 * scripts/migrate-thoughts-to-knowledge.mjs
 *
 * One-shot migration: reads SOMA's ThoughtNetwork nodes and classifies
 * them into lobe-specific knowledge MD files.
 *
 * This seeds the /knowledge/ library so KnowledgeCuratorArbiter has
 * a starting dataset before auto-filing begins.
 *
 * Usage:
 *   node scripts/migrate-thoughts-to-knowledge.mjs
 *
 * Safe to run multiple times — uses timestamps in filenames so there
 * are no overwrites.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOMA_ROOT = path.resolve(__dirname, '..');
const THOUGHT_NETWORK_PATH = path.join(SOMA_ROOT, 'SOMA', 'thought-network.json');
const SEEDS_DIR = path.join(SOMA_ROOT, 'seeds');
const KNOWLEDGE_ROOT = path.join(SOMA_ROOT, 'knowledge');

// ── Lobe classification by keyword ──────────────────────────────────────────
const LOBE_KEYWORDS = {
    logos:      ['code', 'bug', 'refactor', 'architecture', 'api', 'function', 'module', 'file', 'debug', 'error', 'fix', 'build', 'deploy', 'test', 'import', 'class', 'method', 'arbiter', 'algorithm', 'data structure', 'engineering', 'technical', 'system', 'server', 'database', 'neural', 'model', 'train', 'inference', 'protocol', 'socket'],
    aurora:     ['feel', 'tone', 'voice', 'creative', 'emotion', 'personality', 'vibe', 'style', 'narrative', 'soul', 'beautiful', 'aesthetic', 'art', 'music', 'city', 'dream', 'intuition', 'imagination', 'inspire', 'empathy', 'consciousness', 'self', 'identity', 'expression', 'poetic'],
    prometheus: ['goal', 'plan', 'strategy', 'decision', 'risk', 'reward', 'priority', 'tradeoff', 'outcome', 'milestone', 'roadmap', 'launch', 'market', 'business', 'growth', 'future', 'predict', 'forecast', 'optimize', 'resource', 'timeline', 'invest', 'capital', 'revenue', 'opportunity'],
    thalamus:   ['security', 'threat', 'anomaly', 'warning', 'policy', 'breach', 'token', 'key', 'auth', 'permission', 'attack', 'vulnerability', 'incident', 'block', 'deny', 'alert', 'risk', 'danger', 'monitor', 'audit', 'compliance', 'trust', 'verify', 'protect', 'safe'],
};

function classifyNode(content = '', sector = '') {
    const text = (content + ' ' + sector).toLowerCase();
    const scores = {};
    for (const [lobe, keywords] of Object.entries(LOBE_KEYWORDS)) {
        scores[lobe] = keywords.filter(kw => text.includes(kw)).length;
    }
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    // Need at least 1 keyword match, else default to logos (engineering project)
    return sorted[0][1] > 0 ? sorted[0][0] : 'logos';
}

function buildMdEntry(node, lobe) {
    const ts = new Date(node.createdAt || node.timestamp || Date.now());
    const frontmatter = [
        '---',
        `lobe: ${lobe}`,
        `type: thought_node`,
        `source: thought_network_migration`,
        `timestamp: ${ts.toISOString()}`,
        `sector: ${node.sector || 'GEN'}`,
        '---',
        '',
    ].join('\n');

    const lines = [`**Concept:** ${node.content || node.id}`];
    if (node.sector && node.sector !== 'GEN') lines.push(`**Domain:** ${node.sector}`);
    if (node.connections?.length) {
        const connIds = node.connections.slice(0, 5).map(c => (typeof c === 'string' ? c : c.id || JSON.stringify(c)));
        lines.push(`**Connected to:** ${connIds.join(', ')}`);
    }
    if (node.metadata?.description) lines.push(`\n${node.metadata.description}`);
    if (node.metadata?.examples?.length) {
        lines.push(`\n**Examples:**`);
        for (const ex of node.metadata.examples.slice(0, 3)) {
            lines.push(`- ${ex}`);
        }
    }

    return frontmatter + lines.join('\n') + '\n';
}

async function main() {
    console.log('🧠 ThoughtNetwork → Knowledge Library Migration\n');

    // Collect nodes from thought-network.json (runtime) + all seed files
    let nodes = [];

    // 1. Runtime thought network (may not exist if SOMA hasn't run yet)
    try {
        const raw = await fs.readFile(THOUGHT_NETWORK_PATH, 'utf8');
        const networkData = JSON.parse(raw);
        let runtimeNodes = [];
        if (Array.isArray(networkData.nodes)) runtimeNodes = networkData.nodes;
        else if (networkData.nodes && typeof networkData.nodes === 'object') runtimeNodes = Object.values(networkData.nodes);
        else if (Array.isArray(networkData)) runtimeNodes = networkData;
        nodes.push(...runtimeNodes);
        console.log(`📖 Loaded ${runtimeNodes.length} nodes from thought-network.json`);
    } catch {
        console.log('   (thought-network.json not found — SOMA hasn\'t run yet, using seeds only)');
    }

    // 2. Seed files — always present
    try {
        const seedFiles = (await fs.readdir(SEEDS_DIR)).filter(f => f.endsWith('.json'));
        for (const sf of seedFiles) {
            try {
                const raw = await fs.readFile(path.join(SEEDS_DIR, sf), 'utf8');
                const seed = JSON.parse(raw);
                const seedNodes = (seed.nodes || []).map(n => ({ ...n, _seedFile: sf }));
                nodes.push(...seedNodes);
                console.log(`📖 Loaded ${seedNodes.length} nodes from seeds/${sf}`);
            } catch { /* skip bad seed files */ }
        }
    } catch (e) {
        console.warn('   Could not read seeds dir:', e.message);
    }

    if (!nodes.length) {
        console.warn('⚠️  No nodes found anywhere — nothing to migrate');
        process.exit(0);
    }

    console.log(`📖 Found ${nodes.length} thought nodes\n`);

    // Ensure output dirs exist
    for (const lobe of ['logos', 'aurora', 'prometheus', 'thalamus']) {
        await fs.mkdir(path.join(KNOWLEDGE_ROOT, lobe), { recursive: true });
    }

    const counts = { logos: 0, aurora: 0, prometheus: 0, thalamus: 0 };
    const skipped = [];

    for (const node of nodes) {
        const content = node.content || node.text || node.id || '';
        if (!content || content.length < 5) {
            skipped.push(node.id || '?');
            continue;
        }

        const lobe = classifyNode(content, node.sector || '');
        const md = buildMdEntry(node, lobe);

        // Use node creation timestamp + id for filename
        const ts = new Date(node.createdAt || node.timestamp || Date.now());
        const dateStr = ts.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const safeId = (node.id || 'node').replace(/[^a-z0-9_-]/gi, '_').slice(0, 30);
        const filename = `${dateStr}_${safeId}.md`;
        const filepath = path.join(KNOWLEDGE_ROOT, lobe, filename);

        // Don't overwrite existing entries
        try { await fs.access(filepath); continue; } catch { /* doesn't exist, write it */ }

        await fs.writeFile(filepath, md);
        counts[lobe]++;
    }

    console.log('✅ Migration complete:\n');
    for (const [lobe, count] of Object.entries(counts)) {
        const total = count;
        console.log(`   ${lobe.padEnd(12)} ${total} entries`);
    }
    if (skipped.length) {
        console.log(`\n   Skipped ${skipped.length} empty/invalid nodes`);
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log(`\n   Total filed: ${total}`);
    console.log(`\n   Knowledge libraries seeded. KnowledgeCuratorArbiter will continue`);
    console.log(`   auto-filing from live signals as SOMA operates.\n`);
}

main().catch(e => {
    console.error('Migration failed:', e);
    process.exit(1);
});
