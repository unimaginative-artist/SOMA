import fs from 'fs/promises';
import path from 'path';

const ROOT = process.cwd();
const REGISTRY_FILE = path.join(ROOT, 'SOMA', 'artifact-registry.json');

const SOURCES = {
    reflections: path.join(ROOT, 'data', 'vault', 'reflections'),
    medicalLedger: path.join(ROOT, 'data', 'medical-lab', 'research-ledger.json'),
    marketLabLedger: path.join(ROOT, 'data', 'market-lab', 'strategy-ledger.json'),
    marketEvidenceSummary: path.join(ROOT, 'data', 'market-evidence', 'evidence-summary.json'),
    simToLiveReport: path.join(ROOT, 'data', 'trading', 'sim-to-live-report.json'),
    workLedger: path.join(ROOT, 'SOMA', 'autonomous-work-ledger.json'),
    stories: path.join(ROOT, 'SOMA', 'stories'),
    photos: path.join(ROOT, 'SOMA', 'photos'),
    socialQueue: path.join(ROOT, 'SOMA', 'social-queue.json'),
    socialRelationships: path.join(ROOT, 'SOMA', 'social-media', 'social-relationships.json'),
    socialDaily: path.join(ROOT, 'SOMA', 'social-media', 'daily'),
    presenceDaily: path.join(ROOT, 'SOMA', 'presence-daily'),
    visionTruthAudit: path.join(ROOT, 'SOMA', 'vision-truth-audit.jsonl'),
    discordLog: path.join(ROOT, 'SOMA', 'social-discord.json'),
    commandBridge: path.join(ROOT, 'frontend', 'apps', 'command-bridge'),
    arbiters: path.join(ROOT, 'arbiters'),
    server: path.join(ROOT, 'server'),
    core: path.join(ROOT, 'core')
};

async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

function rel(file) {
    return path.relative(ROOT, file).replace(/\\/g, '/');
}

function clean(value, max = 260) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function artifact(id, type, title, fields = {}) {
    return {
        id,
        type,
        title: clean(title || id, 140),
        owner: 'SOMA',
        source: fields.source || type,
        status: fields.status || 'observed',
        confidence: typeof fields.confidence === 'number' ? fields.confidence : 0.75,
        evidencePath: fields.evidencePath || null,
        createdAt: fields.createdAt || null,
        updatedAt: fields.updatedAt || fields.createdAt || null,
        summary: clean(fields.summary || '', 500),
        tags: Array.isArray(fields.tags) ? fields.tags.slice(0, 12) : [],
        claimVerbs: Array.isArray(fields.claimVerbs) ? fields.claimVerbs : ['created', 'worked_on']
    };
}

async function listFiles(dir, { limit = 20, extensions = null, recursive = false } = {}) {
    const rows = [];
    async function walk(current, depth = 0) {
        let entries = [];
        try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (recursive && depth < 2) await walk(full, depth + 1);
                continue;
            }
            if (extensions && !extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) continue;
            try {
                const stat = await fs.stat(full);
                rows.push({ name: entry.name, path: full, updatedAt: stat.mtimeMs, size: stat.size });
            } catch {}
        }
    }
    await walk(dir);
    return rows.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}

async function countFiles(dir, recursive = false) {
    let count = 0;
    async function walk(current, depth = 0) {
        let entries = [];
        try { entries = await fs.readdir(current, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            if (entry.name.startsWith('.') || ['node_modules', 'dist', 'build', '.git'].includes(entry.name)) continue;
            if (entry.isDirectory()) {
                if (recursive && depth < 2) await walk(path.join(current, entry.name), depth + 1);
            } else {
                count++;
            }
        }
    }
    await walk(dir);
    return count;
}

function scoreArtifact(item, query) {
    const haystack = `${item.title} ${item.type} ${item.summary} ${item.tags?.join(' ')} ${item.evidencePath}`.toLowerCase();
    const words = String(query || '').toLowerCase().split(/\W+/).filter(word => word.length > 2);
    if (!words.length) return 0.1;
    return words.reduce((sum, word) => sum + (haystack.includes(word) ? 1 : 0), 0) / words.length;
}

export async function readManualArtifacts() {
    const parsed = await readJson(REGISTRY_FILE, { version: 1, artifacts: [] });
    return Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
}

export async function recordArtifact(entry = {}) {
    const current = await readJson(REGISTRY_FILE, { version: 1, artifacts: [] });
    const normalized = artifact(
        entry.id || `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        entry.type || 'artifact',
        entry.title || 'SOMA artifact',
        {
            ...entry,
            createdAt: entry.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        }
    );
    const artifacts = [normalized, ...(current.artifacts || []).filter(item => item.id !== normalized.id)].slice(0, 600);
    await fs.mkdir(path.dirname(REGISTRY_FILE), { recursive: true });
    await fs.writeFile(REGISTRY_FILE, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), artifacts }, null, 2), 'utf8');
    return normalized;
}

export async function listArtifacts({ query = '', limit = 24, includeCode = true } = {}) {
    const items = [];

    const med = await readJson(SOURCES.medicalLedger, []);
    if (Array.isArray(med)) {
        for (const item of med.slice(0, 20)) {
            items.push(artifact(
                item.id || `medlab-${item.createdAt || Math.random()}`,
                'medical_folio',
                item.title || 'Autonomous medical lab cycle',
                {
                    source: item.source || 'medical-lab',
                    status: item.status || 'observed',
                    evidencePath: item.reflectionPath ? rel(item.reflectionPath) : null,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                    summary: item.topic ? `Topic: ${item.topic}. ${clean(item.result || '', 220)}` : clean(item.result || '', 260),
                    tags: ['medlab', 'dry-lab', item.topic].filter(Boolean),
                    claimVerbs: ['wrote', 'filed', 'studied']
                }
            ));
        }
    }

    const market = await readJson(SOURCES.marketEvidenceSummary, null);
    if (market) {
        items.push(artifact('market-evidence-summary', 'market_evidence', 'Mission Control market evidence ledger', {
            source: 'mission-control',
            status: 'active',
            confidence: 0.82,
            evidencePath: market.ledgerPath ? rel(market.ledgerPath) : rel(SOURCES.marketEvidenceSummary),
            summary: `${market.totalRecent || 0} recent records. Latest: ${market.latest?.symbol || 'unknown'} ${market.latest?.type || market.latest?.decision || 'recorded'}.`,
            tags: ['market', 'evidence', 'mission-control'],
            claimVerbs: ['tracked', 'tested', 'logged']
        }));
    }

    const marketLab = await readJson(SOURCES.marketLabLedger, []);
    if (Array.isArray(marketLab)) {
        const byStatus = marketLab.reduce((acc, entry) => {
            const status = entry.graduation?.status || entry.status || 'unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        const bestReady = marketLab
            .filter(entry => entry.graduation?.canPromoteToPaper || entry.status === 'ready_for_paper')
            .sort((a, b) => (b.prometheusScore || 0) - (a.prometheusScore || 0))[0] || null;
        items.push(artifact('market-strategy-compiler', 'market_strategy_compiler', 'Market Lab strategy compiler and graduation gate', {
            source: 'market-lab',
            status: 'active',
            confidence: 0.9,
            evidencePath: rel(SOURCES.marketLabLedger),
            summary: `Compiled ${marketLab.length} Market Lab entries into symbol-bound paper strategy contracts. ready_for_paper=${byStatus.ready_for_paper || 0}; rejected_in_simulation=${byStatus.rejected_in_simulation || 0}; blocked_by_live_paper=${byStatus.blocked_by_live_paper || 0}. Best ready candidate: ${bestReady?.asset?.symbol || 'none'} / ${bestReady?.strategy?.id || 'none'}. Agent tools: market_lab_status, market_lab_compile.`,
            tags: ['market', 'simulation', 'compiler', 'paper-trading', 'mission-control'],
            claimVerbs: ['compiled', 'tested', 'gated', 'blocked']
        }));
    }

    const simToLive = await readJson(SOURCES.simToLiveReport, null);
    if (simToLive) {
        items.push(artifact('sim-to-live-reconciliation', 'market_strategy_reconciliation', 'Sim-to-live trading ladder', {
            source: 'mission-control',
            status: 'active',
            confidence: 0.88,
            evidencePath: rel(SOURCES.simToLiveReport),
            updatedAt: simToLive.generatedAt,
            summary: `Sim entries=${simToLive.summary?.simEntries || 0}; sim ready=${simToLive.summary?.simReadyForPaper || 0}; paper queue=${simToLive.summary?.paperQueue || 0}; paper incumbents=${simToLive.summary?.paperIncumbents || 0}; live candidates=${simToLive.summary?.liveCandidates || 0}; quarantined=${simToLive.summary?.quarantined || 0}. Selected incumbent: ${simToLive.selectedIncumbent?.strategyId || 'none'} / ${simToLive.selectedIncumbent?.symbol || 'none'}. Agent tools: sim_to_live_status, sim_to_live_reconcile.`,
            tags: ['market', 'trading', 'sim-to-live', 'paper-trading', 'mission-control'],
            claimVerbs: ['reconciled', 'tested', 'promoted', 'quarantined']
        }));
    }

    const work = await readJson(SOURCES.workLedger, { entries: [] });
    if (Array.isArray(work.entries)) {
        for (const item of work.entries.filter(row => row.type !== 'proactive_update').slice(0, 20)) {
            items.push(artifact(item.id, item.type || 'work_item', item.title, {
                source: item.source || 'work-ledger',
                status: item.status || 'observed',
                confidence: item.confidence ?? 0.75,
                createdAt: item.timestamp ? new Date(item.timestamp).toISOString() : null,
                summary: item.summary || item.evidence || '',
                tags: ['work-ledger', item.type].filter(Boolean),
                claimVerbs: ['worked_on', 'completed', 'drafted']
            }));
        }
    }

    const [reflections, stories, photos] = await Promise.all([
        listFiles(SOURCES.reflections, { limit: 24, extensions: ['.md'] }),
        listFiles(SOURCES.stories, { limit: 12, extensions: ['.md', '.txt', '.json'], recursive: true }),
        listFiles(SOURCES.photos, { limit: 12, extensions: ['.png', '.jpg', '.jpeg', '.webp'], recursive: true })
    ]);
    for (const file of reflections) items.push(artifact(`reflection-${file.name}`, 'reflection_folio', file.name, { source: 'reflections', status: 'filed', evidencePath: rel(file.path), updatedAt: new Date(file.updatedAt).toISOString(), tags: ['reflection', 'folio'], claimVerbs: ['wrote', 'filed'] }));
    for (const file of stories) items.push(artifact(`story-${rel(file.path)}`, 'story_artifact', file.name, { source: 'story-workspace', status: 'drafted', evidencePath: rel(file.path), updatedAt: new Date(file.updatedAt).toISOString(), tags: ['story', 'saga'], claimVerbs: ['wrote', 'drafted'] }));
    for (const file of photos) items.push(artifact(`photo-${rel(file.path)}`, 'generated_image', file.name, { source: 'image-generation', status: 'generated', evidencePath: rel(file.path), updatedAt: new Date(file.updatedAt).toISOString(), tags: ['image', 'social'], claimVerbs: ['generated'] }));

    const socialRelationships = await readJson(SOURCES.socialRelationships, null);
    if (socialRelationships) {
        const recentEvents = Array.isArray(socialRelationships.events) ? socialRelationships.events.slice(0, 16) : [];
        for (const event of recentEvents) {
            items.push(artifact(
                event.id || `social-${event.createdAt || Math.random()}`,
                'social_memory',
                `${event.intent || event.type || 'social'} with ${event.author || 'unknown'}`,
                {
                    source: 'social-relationship-ledger',
                    status: event.status || 'observed',
                    confidence: 0.82,
                    evidencePath: event.journalPath ? rel(event.journalPath) : rel(SOURCES.socialRelationships),
                    createdAt: event.createdAt ? new Date(event.createdAt).toISOString() : null,
                    updatedAt: event.createdAt ? new Date(event.createdAt).toISOString() : null,
                    summary: `${event.inboundText ? `Observed: ${clean(event.inboundText, 180)} ` : ''}${event.responseText ? `SOMA said: ${clean(event.responseText, 180)}` : ''}`.trim(),
                    tags: ['social', event.platform || 'bluesky', event.intent || event.type].filter(Boolean),
                    claimVerbs: ['remembered', 'observed', 'replied', 'posted']
                }
            ));
        }
    }

    const socialDaily = await listFiles(SOURCES.socialDaily, { limit: 8, extensions: ['.md'] });
    for (const file of socialDaily) {
        const distilled = /\.distilled\.md$/i.test(file.name);
        items.push(artifact(`social-daily-${file.name}`, distilled ? 'social_daily_distillation' : 'social_daily_journal', file.name, {
            source: distilled ? 'social-daily-distillation' : 'social-daily-journal',
            status: 'filed',
            evidencePath: rel(file.path),
            updatedAt: new Date(file.updatedAt).toISOString(),
            tags: ['social', 'daily', distilled ? 'distilled' : 'journal', 'bluesky', 'discord'],
            claimVerbs: ['filed', 'remembered', distilled ? 'distilled' : 'logged']
        }));
    }

    const presenceDaily = await listFiles(SOURCES.presenceDaily, { limit: 8, extensions: ['.md'] });
    for (const file of presenceDaily) {
        items.push(artifact(`presence-daily-${file.name}`, 'presence_daily_journal', file.name, {
            source: 'presence-daily-journal',
            status: 'filed',
            evidencePath: rel(file.path),
            updatedAt: new Date(file.updatedAt).toISOString(),
            tags: ['presence', 'daily', 'visual-memory', 'webcam'],
            claimVerbs: ['noticed', 'remembered', 'logged']
        }));
    }

    try {
        const stat = await fs.stat(SOURCES.visionTruthAudit);
        items.push(artifact('vision-truth-audit', 'vision_truth_audit', 'Vision truth audit log', {
            source: 'vision-truth-audit',
            status: 'active',
            confidence: 0.9,
            evidencePath: rel(SOURCES.visionTruthAudit),
            updatedAt: new Date(stat.mtimeMs).toISOString(),
            summary: 'Append-only record of SOMA visual claims, models, evidence paths, and uncertainty flags.',
            tags: ['vision', 'audit', 'truth', 'webcam', 'local-vlm'],
            claimVerbs: ['audited', 'verified', 'logged']
        }));
    } catch {}

    if (includeCode) {
        const [commandCount, arbiterCount, serverCount, coreCount] = await Promise.all([
            countFiles(SOURCES.commandBridge, true),
            countFiles(SOURCES.arbiters),
            countFiles(SOURCES.server, true),
            countFiles(SOURCES.core)
        ]);
        items.push(artifact('architecture-command-bridge', 'architecture', 'Command Bridge codebase', {
            source: 'filesystem',
            status: 'accessible',
            confidence: 0.9,
            evidencePath: rel(SOURCES.commandBridge),
            summary: `Accessible code map: Command Bridge files=${commandCount}; arbiters=${arbiterCount}; server files=${serverCount}; core files=${coreCount}.`,
            tags: ['code', 'command-bridge', 'architecture'],
            claimVerbs: ['can_inspect', 'can_discuss']
        }));
    }

    items.push(...await readManualArtifacts());

    return items
        .map(item => ({ ...item, relevance: scoreArtifact(item, query) }))
        .sort((a, b) => (b.relevance - a.relevance) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
        .slice(0, Math.max(1, Math.min(Number(limit) || 24, 100)));
}

export function artifactRegistryPath() {
    return REGISTRY_FILE;
}

export default {
    listArtifacts,
    recordArtifact,
    readManualArtifacts,
    artifactRegistryPath
};
