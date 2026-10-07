import fs from 'fs/promises';
import path from 'path';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const ROOT = process.cwd();
const SOMA_DIR = path.join(ROOT, 'SOMA');
const DEFAULT_DB = path.join(SOMA_DIR, 'soma-memory.db');
const DEFAULT_VECTOR_FILE = path.join(ROOT, 'soma-vectors.json');
const DEFAULT_SELF_MODEL = path.join(SOMA_DIR, 'working-self-model.json');
const DEFAULT_THOUGHT_NETWORK = path.join(SOMA_DIR, 'thought-network.json');
const DEFAULT_AUTOSYNC_STATUS = path.join(SOMA_DIR, 'memory-spine-autosync.json');

const DOMAIN_RULES = [
    ['index_noise', /\bcontentIndexed\b|\bfingerprint\b|\\\\data\\\\|\\\\Desktop\\\\SOMA\\\\|^\s*\{["']?[A-Z]:\\\\/i],
    ['code_artifact', /^\s*(import|export|const|let|var|function|class|struct|interface|type)\s+|=>\s*\{|\bconsole\.(log|warn|error)\b/i],
    ['self_model', /\b(self-inspection|self-evolution|self-directed|own architecture|dormant capabilities|unloaded arbiters|capability expansion|AutonomousCapabilityExpansion|self-improvement)\b/i],
    ['memory_system', /\b(memory|mnemonic|recall|remember|embedding|vector|retrieval|purgatory|cold tier|warm tier|hot tier)\b/i],
    ['tooling', /\b(tool|ToolRegistry|arbiter loading|loader|module loading|execute|filesystem|terminal|browser|web navigation|autonomous web)\b/i],
    ['loop_failure', /\b(deadlock|stalled|blocked|bottleneck|failed|failure|partial|repeated|fixation|hallucination|unsupported claim|Poseidon)\b/i],
    ['finance', /\b(trading|trade|profit|pnl|win rate|sharpe|market|ticker|BTC|ETH|TLT|stock|crypto|paper account)\b/i],
    ['social', /\b(discord|bluesky|post|reply|social|public|channel|conversation)\b/i],
    ['presence_home', /\b(Erin|home|wife|webcam|presence|Command Bridge|desktop|speaker|microphone|voice)\b/i],
    ['vision', /\b(vision|visual|image|webcam|screen|frame|object|perception|camera)\b/i],
    ['research', /\b(research|paper|folio|hypothesis|evidence|experiment|p-value|null model|literature|medical|TP53|PCSK9)\b/i],
    ['user_owner', /\b(Owner|user asked|Owner|partner|owner)\b/i]
];

const STRONG_SIGNAL_RULES = [
    ['loader_bottleneck', /\b(AutonomousCapabilityExpansion|arbiter loading|unloaded arbiters|dormant capabilities|loading failure)\b/i],
    ['memory_retrieval_gap', /\b(memory|mnemonic|recall|remember|embedding|vector|retrieval)\b/i],
    ['web_autonomy_gap', /\b(autonomous web|web navigation|browsering|external knowledge|web access)\b/i],
    ['loop_deadlock', /\b(deadlock|stalled|blocked|bottleneck|repeated attempts|fixing this unlocks)\b/i],
    ['claim_discipline', /\b(hallucination|unsupported claim|Poseidon|evidence|falsification)\b/i]
];

function openDb(dbPath = DEFAULT_DB) {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    ensureSchema(db);
    return db;
}

function ensureSchema(db) {
    const cols = db.prepare('PRAGMA table_info(memories)').all().map(row => row.name);
    if (!cols.includes('category')) {
        db.prepare('ALTER TABLE memories ADD COLUMN category TEXT DEFAULT "general"').run();
    }
    if (!cols.includes('sector')) {
        db.prepare('ALTER TABLE memories ADD COLUMN sector TEXT').run();
    }
    db.prepare('CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_memories_tier_importance ON memories(tier, importance DESC)').run();
    db.prepare('CREATE INDEX IF NOT EXISTS idx_memories_embedding_id ON memories(embedding_id)').run();
}

function tokenize(text = '') {
    return String(text || '').toLowerCase()
        .match(/[a-z][a-z0-9_-]{2,}/g)
        ?.filter(token => !STOPWORDS.has(token)) || [];
}

const STOPWORDS = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'has', 'was', 'were',
    'are', 'but', 'not', 'you', 'your', 'she', 'her', 'his', 'they', 'them', 'into',
    'about', 'what', 'when', 'where', 'which', 'will', 'would', 'could', 'should',
    'there', 'their', 'then', 'than', 'just', 'like', 'because', 'through', 'using',
    'executed', 'step', 'steps', 'partial', 'result'
]);

function classifyMemory(content = '', metadata = {}) {
    const text = `${content}\n${JSON.stringify(metadata || {})}`;
    if (isIndexNoise(text)) return 'index_noise';
    if (isCodeArtifact(text)) return 'code_artifact';
    const scores = new Map();
    for (const [domain, re] of DOMAIN_RULES) {
        if (re.test(text)) scores.set(domain, (scores.get(domain) || 0) + 1);
    }
    if (!scores.size) return 'general';
    return [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function isIndexNoise(text = '') {
    const value = String(text || '');
    if (/\bcontentIndexed\b|\bfingerprint\b/.test(value) && /\\\\|":\{/.test(value)) return true;
    if (/^\s*\{["']?[A-Z]:\\\\/.test(value)) return true;
    if ((value.match(/\\\\/g) || []).length > 25 && value.length > 1000) return true;
    return false;
}

function isCodeArtifact(text = '') {
    const value = String(text || '').trim();
    if (/^(import|export|const|let|var|function|class|struct|interface|type)\s+/i.test(value)) return true;
    const codeMarkers = [
        /=>\s*\{/,
        /\bconsole\.(log|warn|error)\b/,
        /\breturn\s+[\w({]/,
        /\basync\s+function\b/,
        /\bfrom\s+['"][^'"]+['"]/,
        /;\s*$/m
    ].filter(re => re.test(value)).length;
    return value.length > 500 && codeMarkers >= 2;
}

function signalTags(content = '') {
    return STRONG_SIGNAL_RULES
        .filter(([, re]) => re.test(content))
        .map(([name]) => name);
}

function parseMetadata(value = '') {
    try { return JSON.parse(value || '{}') || {}; }
    catch { return {}; }
}

function memoryVector(text = '', dimensions = 384) {
    const vector = new Array(dimensions).fill(0);
    for (const token of tokenize(text)) {
        const hash = crypto.createHash('sha256').update(token).digest();
        const index = hash.readUInt32BE(0) % dimensions;
        const sign = (hash[4] & 1) ? 1 : -1;
        vector[index] += sign;
    }
    let norm = Math.sqrt(vector.reduce((sum, n) => sum + n * n, 0));
    if (!norm) norm = 1;
    return vector.map(n => Number((n / norm).toFixed(6)));
}

function cosine(a = [], b = []) {
    if (!a.length || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

function rowToMemory(row) {
    return {
        id: row.id,
        content: row.content,
        metadata: parseMetadata(row.metadata),
        embeddingId: row.embedding_id,
        createdAt: row.created_at,
        accessedAt: row.accessed_at,
        accessCount: row.access_count || 0,
        importance: row.importance || 0,
        tier: row.tier || 'cold',
        category: row.category || 'general',
        sector: row.sector || null
    };
}

async function readVectors(vectorPath = DEFAULT_VECTOR_FILE) {
    try {
        const parsed = JSON.parse(await fs.readFile(vectorPath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

async function writeVectors(vectors, vectorPath = DEFAULT_VECTOR_FILE) {
    await fs.mkdir(path.dirname(vectorPath), { recursive: true });
    await fs.writeFile(vectorPath, JSON.stringify(vectors, null, 2), 'utf8');
}

export async function auditMemorySpine(options = {}) {
    const dbPath = options.dbPath || DEFAULT_DB;
    const vectorPath = options.vectorPath || DEFAULT_VECTOR_FILE;
    const db = openDb(dbPath);
    try {
        const counts = {
            memories: db.prepare('SELECT COUNT(*) n FROM memories').get().n,
            purgatory: tableExists(db, 'purgatory') ? db.prepare('SELECT COUNT(*) n FROM purgatory').get().n : 0,
            vectorIndexRows: tableExists(db, 'vector_index') ? db.prepare('SELECT COUNT(*) n FROM vector_index').get().n : 0,
            episodicBuffer: tableExists(db, 'episodic_buffer') ? db.prepare('SELECT COUNT(*) n FROM episodic_buffer').get().n : 0
        };
        const vectors = await readVectors(vectorPath);
        const vectorEntries = Object.entries(vectors);
        const memorySpineVectorRows = vectorEntries.filter(([id, vector]) => isMemorySpineVector(id, vector)).length;
        counts.vectorJsonRows = vectorEntries.length;
        counts.memorySpineVectorRows = memorySpineVectorRows;
        counts.legacyVectorRows = counts.vectorJsonRows - memorySpineVectorRows;
        const categories = db.prepare(`
            SELECT COALESCE(category, 'NULL') category, COUNT(*) n, ROUND(AVG(importance), 3) avgImportance
            FROM memories GROUP BY category ORDER BY n DESC
        `).all();
        const tiers = db.prepare(`
            SELECT COALESCE(tier, 'NULL') tier, COUNT(*) n, ROUND(AVG(importance), 3) avgImportance
            FROM memories GROUP BY tier ORDER BY n DESC
        `).all();
        const signalCounts = {};
        const rows = db.prepare('SELECT content FROM memories').all();
        for (const row of rows) {
            for (const tag of signalTags(row.content || '')) signalCounts[tag] = (signalCounts[tag] || 0) + 1;
        }
        const topSignals = Object.entries(signalCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([signal, count]) => ({ signal, count }));
        const highImportanceUnused = db.prepare(`
            SELECT id, content, importance, access_count, category, tier, created_at
            FROM memories
            WHERE importance >= 4 AND COALESCE(access_count, 0) = 0
              AND COALESCE(category, 'general') NOT IN ('index_noise', 'code_artifact')
            ORDER BY importance DESC, created_at DESC
            LIMIT 20
        `).all();
        const hasWorkingSelfModel = await fileExists(options.selfModelPath || DEFAULT_SELF_MODEL);
        const recommendations = [];
        if (counts.memorySpineVectorRows === 0 && counts.memories > 1000) {
            recommendations.push('Rebuild soma-vectors.json so recall can use warm semantic retrieval instead of cold LIKE search.');
        }
        if (categories.length === 1 && categories[0]?.category === 'general') {
            recommendations.push('Classify memories into domains so self-model, tools, finance, social, and loop failures can be retrieved independently.');
        }
        if (!hasWorkingSelfModel && highImportanceUnused.length > 10) {
            recommendations.push('Promote high-importance unused self-inspection memories into a working self-model.');
        }
        if ((signalCounts.loader_bottleneck || 0) > 50) {
            recommendations.push('Create one bounded repair goal for arbiter/capability loading instead of repeatedly rediscovering the bottleneck.');
        }
        return {
            dbPath,
            vectorPath,
            counts,
            categories,
            tiers,
            topSignals,
            highImportanceUnused: highImportanceUnused.map(row => ({ ...row, content: String(row.content || '').slice(0, 320) })),
            recommendations
        };
    } finally {
        db.close();
    }
}

function tableExists(db, name) {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

export async function rebuildMemorySpine(options = {}) {
    const dbPath = options.dbPath || DEFAULT_DB;
    const vectorPath = options.vectorPath || DEFAULT_VECTOR_FILE;
    const limit = options.limit === 'all' ? Infinity : Math.max(1, Number(options.limit || 2500));
    const promote = options.promote !== false;
    const db = openDb(dbPath);
    const start = Date.now();
    try {
        const rows = db.prepare(`
            SELECT id, content, metadata, importance, access_count, embedding_id, tier, category, created_at, accessed_at
            FROM memories
            ORDER BY importance DESC, access_count DESC, created_at DESC
        `).all();
        const selected = rows.slice(0, Number.isFinite(limit) ? limit : rows.length);
        const update = db.prepare('UPDATE memories SET category=?, sector=?, embedding_id=?, tier=? WHERE id=?');
        const vectors = await readVectors(vectorPath);
        let removedStaleVectors = 0;
        for (const [id, vector] of Object.entries(vectors)) {
            if (isMemorySpineVector(id, vector)) {
                delete vectors[id];
                removedStaleVectors++;
            }
        }
        const domainCounts = {};
        let indexed = 0;
        let classified = 0;
        let promoted = 0;
        const tx = db.transaction((batch) => {
            for (const row of batch) {
                const metadata = parseMetadata(row.metadata);
                const category = classifyMemory(row.content, metadata);
                const tags = signalTags(row.content);
                const sector = tags[0] || category;
                const embeddingId = (category === 'index_noise' || category === 'code_artifact') ? null : (row.embedding_id || `memspine_${row.id}`);
                const desiredTier = (category === 'index_noise' || category === 'code_artifact')
                    ? 'cold'
                    : (promote && ((row.importance || 0) >= 4 || tags.length) ? 'warm' : (row.tier || 'cold'));
                update.run(category, sector, embeddingId, desiredTier, row.id);
                classified++;
                if (desiredTier === 'warm' && row.tier !== 'warm') promoted++;
                domainCounts[category] = (domainCounts[category] || 0) + 1;
                if (embeddingId) {
                    vectors[embeddingId] = {
                        id: embeddingId,
                        memoryId: row.id,
                        vector: memoryVector(`${category} ${sector} ${row.content}`),
                        content: String(row.content || '').slice(0, 400),
                        category,
                        sector,
                        importance: row.importance || 0,
                        accessCount: row.access_count || 0,
                        createdAt: row.created_at || Date.now(),
                        tier: desiredTier,
                        source: 'MemorySpine'
                    };
                    indexed++;
                }
            }
        });
        tx(selected);
        await writeVectors(vectors, vectorPath);
        const selfModel = await buildWorkingSelfModel({ db, vectorPath });
        const selfModelVersion = options.artifactRegistry?.promote
            ? await options.artifactRegistry.promote({
                kind: 'memory', id: 'working-self-model', sourcePath: path.relative(ROOT, selfModel.path),
                metadata: { producer: 'MemorySpine', scanned: rows.length, indexed }
              })
            : null;
        return {
            success: true,
            dbPath,
            vectorPath,
            scanned: rows.length,
            classified,
            indexed,
            skipped: classified - indexed,
            promoted,
            removedStaleVectors,
            totalVectors: Object.keys(vectors).length,
            domainCounts,
            selfModelPath: selfModel.path,
            selfModelSignals: selfModel.signals.length,
            selfModelVersion,
            elapsedMs: Date.now() - start
        };
    } finally {
        db.close();
    }
}

async function buildWorkingSelfModel({ db, vectorPath = DEFAULT_VECTOR_FILE, outPath = DEFAULT_SELF_MODEL } = {}) {
    const signalRows = db.prepare(`
        SELECT id, content, importance, category, sector, created_at, access_count
        FROM memories
        WHERE (importance >= 4 OR sector IN ('loader_bottleneck', 'memory_retrieval_gap', 'web_autonomy_gap', 'loop_deadlock', 'claim_discipline'))
          AND COALESCE(category, 'general') NOT IN ('index_noise', 'code_artifact')
        ORDER BY importance DESC, created_at DESC
        LIMIT 80
    `).all();
    const grouped = {};
    for (const row of signalRows) {
        const key = row.sector || row.category || 'general';
        grouped[key] = grouped[key] || [];
        grouped[key].push({
            id: row.id,
            content: String(row.content || '').slice(0, 320),
            importance: row.importance || 0,
            category: row.category,
            createdAt: row.created_at,
            accessCount: row.access_count || 0
        });
    }
    const model = {
        updatedAt: Date.now(),
        source: 'MemorySpine',
        vectorPath,
        principles: [
            'Treat repeated self-inspection memories as evidence for one bounded repair goal, not as permission to loop.',
            'Prefer retrieved evidence over fresh speculation when talking about Soma capabilities.',
            'Classify style feedback as preference unless an actual byte-level corruption artifact exists.'
        ],
        signals: Object.entries(grouped).map(([signal, examples]) => ({
            signal,
            count: examples.length,
            topExamples: examples.slice(0, 5)
        })),
        nextActions: deriveNextActions(grouped)
    };
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(model, null, 2), 'utf8');
    return { path: outPath, ...model };
}

function deriveNextActions(grouped = {}) {
    const actions = [];
    if (grouped.loader_bottleneck?.length) {
        actions.push({
            key: 'repair_capability_loading',
            title: 'Repair arbiter/capability loading bottleneck',
            reason: 'High-importance memories repeatedly identify dormant capabilities and loader failures as a self-improvement blocker.'
        });
    }
    if (grouped.memory_retrieval_gap?.length || grouped.memory_system?.length) {
        actions.push({
            key: 'keep_memory_spine_indexed',
            title: 'Keep MemorySpine vector/index/category state current',
            reason: 'A large memory corpus is only useful if recall can retrieve by semantic domain and repeated evidence.'
        });
    }
    if (grouped.web_autonomy_gap?.length) {
        actions.push({
            key: 'bounded_web_autonomy',
            title: 'Convert web-autonomy desire into one testable browser task',
            reason: 'Repeated memories identify autonomous web acquisition as important, but prior attempts ended partial.'
        });
    }
    return actions;
}

export async function recallMemorySpine(query = '', options = {}) {
    const dbPath = options.dbPath || DEFAULT_DB;
    const vectorPath = options.vectorPath || DEFAULT_VECTOR_FILE;
    const limit = Math.max(1, Math.min(50, Number(options.limit || 8)));
    const category = options.category || null;
    const includeArtifacts = options.includeArtifacts === true;
    const vectors = await readVectors(vectorPath);
    const queryVector = memoryVector(query);
    const scored = Object.values(vectors)
        .filter(v => includeArtifacts || !isQuarantinedCategory(v.category) && !isQuarantinedCategory(v.sector))
        .filter(v => !category || v.category === category || v.sector === category)
        .map(v => ({ ...v, score: cosine(queryVector, v.vector || []) }))
        .filter(v => v.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit * 3);

    const db = openDb(dbPath);
    try {
        const byId = db.prepare('SELECT id, content, metadata, importance, access_count, category, sector, tier, created_at FROM memories WHERE id=?');
        const results = [];
        for (const hit of scored) {
            const row = byId.get(hit.memoryId);
            if (!row) continue;
            results.push({
                ...rowToMemory(row),
                score: Number(hit.score.toFixed(4)),
                vectorCategory: hit.category,
                vectorSector: hit.sector
            });
            if (results.length >= limit) break;
        }
        if (!results.length) {
            const terms = tokenize(query).slice(0, 4);
            if (!terms.length) return { query, results: [], tier: 'none' };
            const where = terms.map(() => 'content LIKE ?').join(' OR ');
            const params = [...terms.map(term => `%${term}%`), limit];
            const categoryFilter = includeArtifacts ? '' : "AND COALESCE(category, 'general') NOT IN ('index_noise', 'code_artifact')";
            const rows = db.prepare(`
                SELECT id, content, metadata, importance, access_count, category, sector, tier, created_at
                FROM memories
                WHERE (${where}) ${categoryFilter}
                ORDER BY importance DESC, access_count DESC, created_at DESC
                LIMIT ?
            `).all(...params);
            return { query, results: rows.map(rowToMemory), tier: 'cold_keyword' };
        }
        return { query, results, tier: 'memory_spine_vector' };
    } finally {
        db.close();
    }
}

function isMemorySpineVector(id, vector) {
    return vector?.source === 'MemorySpine' || String(id || '').startsWith('memspine_');
}

function isQuarantinedCategory(value) {
    return value === 'index_noise' || value === 'code_artifact';
}

export async function createMemorySpineGoals(system = {}, options = {}) {
    const audit = await auditMemorySpine(options);
    const planner = system.goalPlanner;
    const created = [];
    if (!planner?.createGoal) return { created, audit, skipped: 'goalPlanner unavailable' };
    const selfModelPath = options.selfModelPath || DEFAULT_SELF_MODEL;

    for (const rec of audit.recommendations.slice(0, 3)) {
        const title = rec.includes('arbiter')
            ? 'Repair dormant capability loading bottleneck'
            : rec.includes('Classify memories')
                ? 'Classify and index Soma memory corpus'
                : rec.includes('working self-model')
                    ? 'Promote high-value memories into working self-model'
                    : 'Repair MemorySpine retrieval substrate';
        const goal = await planner.createGoal({
            title,
            description: [
                rec,
                `Evidence: ${audit.counts.memories} memories, ${audit.counts.vectorJsonRows} vector rows, categories=${audit.categories.map(c => `${c.category}:${c.n}`).join(', ')}`,
                `Working self-model path: ${selfModelPath}`,
                'Success requires a concrete audit delta, not another autonomous chat reflection.'
            ].join('\n'),
            category: 'memory_spine',
            priority: 0.86,
            source: 'MemorySpine',
            evidence: audit
        });
        created.push(goal);
    }
    return { created, audit };
}

export async function syncMemorySpineToThoughtNetwork(options = {}) {
    const dbPath = options.dbPath || DEFAULT_DB;
    const outPath = options.thoughtNetworkPath || DEFAULT_THOUGHT_NETWORK;
    const maxEvidencePerSector = Math.max(1, Math.min(8, Number(options.maxEvidencePerSector || 4)));
    const db = openDb(dbPath);
    const start = Date.now();
    try {
        const graph = await readThoughtNetwork(outPath);
        const nodeMap = new Map((graph.nodes || []).map(node => [node.id, normalizeThoughtNode(node)]));
        const root = ensureThoughtNode(nodeMap, 'memspine_root', 'Memory Spine', {
            type: 'system',
            sector: 'MEM',
            source: 'memory_spine',
            confidence: 0.95,
            strength: 0.98,
            tags: ['memory_spine', 'memory', 'fractal_seed']
        });
        const baseline = ensureBaselineThoughtNodes(nodeMap);
        connectThoughtNodes(baseline.soma, root, 'uses', 0.82);

        const categoryRows = db.prepare(`
            SELECT category, COUNT(*) n, ROUND(AVG(importance), 3) avgImportance, MAX(access_count) maxAccess
            FROM memories
            WHERE tier = 'warm'
              AND COALESCE(category, 'general') NOT IN ('index_noise', 'code_artifact')
            GROUP BY category
            ORDER BY n DESC, avgImportance DESC
        `).all();

        const sectorRows = db.prepare(`
            SELECT category, sector, COUNT(*) n, ROUND(AVG(importance), 3) avgImportance, MAX(access_count) maxAccess
            FROM memories
            WHERE tier = 'warm'
              AND COALESCE(category, 'general') NOT IN ('index_noise', 'code_artifact')
              AND COALESCE(sector, '') != ''
            GROUP BY category, sector
            ORDER BY n DESC, avgImportance DESC
            LIMIT ?
        `).all(Math.max(10, Number(options.maxSectors || 48)));

        const evidenceStmt = db.prepare(`
            SELECT id, content, importance, access_count, category, sector, created_at
            FROM memories
            WHERE tier = 'warm'
              AND COALESCE(category, 'general') = ?
              AND COALESCE(sector, '') = ?
              AND COALESCE(category, 'general') NOT IN ('index_noise', 'code_artifact')
            ORDER BY importance DESC, access_count DESC, created_at DESC
            LIMIT ?
        `);

        let created = 0;
        let updated = 0;
        let connected = 0;
        const seenBefore = new Set(nodeMap.keys());

        for (const row of categoryRows) {
            const categoryNode = ensureThoughtNode(nodeMap, thoughtId('memspine_cat', row.category), titleFor(row.category), {
                type: 'memory_cluster',
                sector: sectorCode(row.category),
                source: 'memory_spine',
                confidence: confidenceFrom(row.avgImportance, row.n),
                strength: strengthFrom(row.avgImportance, row.n, row.maxAccess),
                tags: ['memory_spine', 'category', row.category],
                evidence: { category: row.category, count: row.n, avgImportance: row.avgImportance, maxAccess: row.maxAccess }
            });
            connected += connectThoughtNodes(root, categoryNode, 'contains_category', 0.9);
        }

        for (const row of sectorRows) {
            const categoryNode = ensureThoughtNode(nodeMap, thoughtId('memspine_cat', row.category), titleFor(row.category), {
                type: 'memory_cluster',
                sector: sectorCode(row.category),
                source: 'memory_spine',
                tags: ['memory_spine', 'category', row.category]
            });
            const sectorNode = ensureThoughtNode(nodeMap, thoughtId('memspine_sector', `${row.category}:${row.sector}`), `${titleFor(row.category)} / ${titleFor(row.sector)}`, {
                type: 'memory_signal',
                sector: sectorCode(row.category),
                source: 'memory_spine',
                confidence: confidenceFrom(row.avgImportance, row.n),
                strength: strengthFrom(row.avgImportance, row.n, row.maxAccess),
                tags: ['memory_spine', 'sector', row.category, row.sector],
                evidence: { category: row.category, sector: row.sector, count: row.n, avgImportance: row.avgImportance, maxAccess: row.maxAccess }
            });
            connected += connectThoughtNodes(categoryNode, sectorNode, 'has_signal', 0.88);

            const evidenceRows = evidenceStmt.all(row.category, row.sector, maxEvidencePerSector);
            for (const memory of evidenceRows) {
                const evidenceNode = ensureThoughtNode(nodeMap, thoughtId('memspine_memory', memory.id), summarizeMemoryAsConcept(memory), {
                    type: 'memory_evidence',
                    sector: sectorCode(row.category),
                    source: 'memory_spine',
                    confidence: Math.max(0.5, Math.min(0.98, Number(memory.importance || 0) / 8)),
                    strength: Math.max(0.35, Math.min(1, 0.4 + Number(memory.importance || 0) / 10 + Math.min(Number(memory.access_count || 0), 25) / 100)),
                    tags: ['memory_spine', 'evidence', row.category, row.sector, memory.id],
                    evidence: {
                        memoryId: memory.id,
                        category: memory.category,
                        sector: memory.sector,
                        importance: memory.importance,
                        accessCount: memory.access_count,
                        createdAt: memory.created_at,
                        excerpt: String(memory.content || '').slice(0, 320)
                    }
                });
                connected += connectThoughtNodes(sectorNode, evidenceNode, 'supported_by', 0.72);
            }
        }

        connectKeyMemorySpineConcepts(nodeMap);
        for (const id of nodeMap.keys()) {
            if (seenBefore.has(id)) updated++;
            else created++;
        }

        const nodes = [...nodeMap.values()];
        const roots = nodes
            .filter(node => !node.parent)
            .map(node => node.id);
        const saved = {
            name: graph.name || 'ThoughtNetwork',
            stats: calculateThoughtStats(nodes, graph.stats),
            nodes,
            roots,
            savedAt: Date.now(),
            lastMemorySpineSync: {
                created,
                updated,
                connected,
                categories: categoryRows.length,
                sectors: sectorRows.length,
                maxEvidencePerSector,
                elapsedMs: Date.now() - start
            }
        };
        await fs.mkdir(path.dirname(outPath), { recursive: true });
        await fs.writeFile(outPath, JSON.stringify(saved, null, 2), 'utf8');
        return {
            success: true,
            dbPath,
            thoughtNetworkPath: outPath,
            nodes: nodes.length,
            roots: roots.length,
            created,
            updated,
            connected,
            categories: categoryRows.length,
            sectors: sectorRows.length,
            elapsedMs: Date.now() - start
        };
    } finally {
        db.close();
    }
}

export function startMemorySpineAutoSync(system = {}, options = {}) {
    const broker = system.messageBroker;
    if (!broker?.subscribe) {
        return { success: false, error: 'messageBroker unavailable' };
    }

    if (global.__SOMA_MEMORY_SPINE_AUTOSYNC__?.active) {
        return { success: true, reused: true, status: global.__SOMA_MEMORY_SPINE_AUTOSYNC__.status };
    }

    const state = {
        active: true,
        running: false,
        timer: null,
        periodicTimer: null,
        pendingReasons: [],
        pendingEvents: 0,
        lastRunAt: 0,
        lastStatus: null,
        subscriptions: [],
        options: {
            debounceMs: Number(options.debounceMs ?? process.env.SOMA_MEMORY_SPINE_DEBOUNCE_MS ?? 120000),
            minIntervalMs: Number(options.minIntervalMs ?? process.env.SOMA_MEMORY_SPINE_MIN_INTERVAL_MS ?? 300000),
            periodicMs: Number(options.periodicMs ?? process.env.SOMA_MEMORY_SPINE_PERIODIC_MS ?? 30 * 60 * 1000),
            rebuildLimit: options.rebuildLimit ?? process.env.SOMA_MEMORY_SPINE_REBUILD_LIMIT ?? 'all',
            maxSectors: Number(options.maxSectors ?? process.env.SOMA_MEMORY_SPINE_MAX_SECTORS ?? 48),
            maxEvidencePerSector: Number(options.maxEvidencePerSector ?? process.env.SOMA_MEMORY_SPINE_EVIDENCE_PER_SECTOR ?? 4),
            minImportance: Number(options.minImportance ?? process.env.SOMA_MEMORY_SPINE_MIN_IMPORTANCE ?? 0.6),
            lowSignalBatch: Number(options.lowSignalBatch ?? process.env.SOMA_MEMORY_SPINE_LOW_SIGNAL_BATCH ?? 12),
            statusPath: options.statusPath || DEFAULT_AUTOSYNC_STATUS
        }
    };

    const schedule = (reason, payload = {}) => {
        if (!state.active) return;
        if (!shouldScheduleMemorySpineSync(reason, payload, state)) return;
        state.pendingEvents++;
        state.pendingReasons.push({
            reason,
            memoryId: payload.memoryId || null,
            source: payload.source || null,
            importance: payload.importance ?? null,
            timestamp: Date.now()
        });
        state.pendingReasons = state.pendingReasons.slice(-20);

        const sinceLastRun = Date.now() - (state.lastRunAt || 0);
        const wait = sinceLastRun < state.options.minIntervalMs
            ? Math.max(state.options.debounceMs, state.options.minIntervalMs - sinceLastRun)
            : state.options.debounceMs;
        if (state.timer) clearTimeout(state.timer);
        state.timer = setTimeout(() => run('debounced'), wait);
        state.timer.unref?.();
    };

    const run = async (trigger = 'manual') => {
        if (state.running) return state.lastStatus || { success: false, skipped: 'already_running' };
        state.running = true;
        const reasons = state.pendingReasons.splice(0);
        const pendingEvents = state.pendingEvents;
        state.pendingEvents = 0;
        const startedAt = Date.now();
        try {
            const rebuild = await rebuildMemorySpine({
                limit: state.options.rebuildLimit,
                promote: true
            });
            const sync = await syncMemorySpineToThoughtNetwork({
                maxSectors: state.options.maxSectors,
                maxEvidencePerSector: state.options.maxEvidencePerSector
            });
            const status = {
                success: true,
                trigger,
                startedAt,
                completedAt: Date.now(),
                elapsedMs: Date.now() - startedAt,
                pendingEvents,
                reasons,
                rebuild: {
                    classified: rebuild.classified,
                    indexed: rebuild.indexed,
                    skipped: rebuild.skipped,
                    promoted: rebuild.promoted,
                    totalVectors: rebuild.totalVectors
                },
                sync: {
                    nodes: sync.nodes,
                    roots: sync.roots,
                    categories: sync.categories,
                    sectors: sync.sectors,
                    connected: sync.connected
                }
            };
            state.lastRunAt = Date.now();
            state.lastStatus = status;
            await writeAutoSyncStatus(status, state.options.statusPath);
            broker.emitSignal?.('memory.spine.synced', {
                status: 'success',
                nodes: sync.nodes,
                indexed: rebuild.indexed,
                trigger,
                elapsedMs: status.elapsedMs
            }, 'low', 'MemorySpineAutoSync');
            return status;
        } catch (error) {
            const status = {
                success: false,
                trigger,
                startedAt,
                completedAt: Date.now(),
                elapsedMs: Date.now() - startedAt,
                pendingEvents,
                reasons,
                error: error.message
            };
            state.lastStatus = status;
            await writeAutoSyncStatus(status, state.options.statusPath);
            return status;
        } finally {
            state.running = false;
        }
    };

    state.subscriptions.push(broker.subscribe('memory.stored', signal => schedule('memory.stored', signal?.payload || signal || {})));
    state.subscriptions.push(broker.subscribe('insight.generated', signal => schedule('insight.generated', signal?.payload || signal || {})));
    state.subscriptions.push(broker.subscribe('dream.distilled', signal => schedule('dream.distilled', signal?.payload || signal || {})));
    state.subscriptions.push(broker.subscribe('knowledge.ingested', signal => schedule('knowledge.ingested', signal?.payload || signal || {})));
    state.periodicTimer = setInterval(() => schedule('periodic', { importance: 1, source: 'periodic' }), state.options.periodicMs);
    state.periodicTimer.unref?.();
    state.runNow = run;
    state.stop = () => {
        state.active = false;
        if (state.timer) clearTimeout(state.timer);
        if (state.periodicTimer) clearInterval(state.periodicTimer);
        for (const unsub of state.subscriptions) {
            try { unsub?.(); } catch {}
        }
    };
    state.status = {
        active: true,
        debounceMs: state.options.debounceMs,
        minIntervalMs: state.options.minIntervalMs,
        periodicMs: state.options.periodicMs,
        rebuildLimit: state.options.rebuildLimit,
        statusPath: state.options.statusPath
    };
    global.__SOMA_MEMORY_SPINE_AUTOSYNC__ = state;
    return { success: true, status: state.status };
}

export function memorySpinePaths() {
    return {
        dbPath: DEFAULT_DB,
        vectorPath: DEFAULT_VECTOR_FILE,
        selfModelPath: DEFAULT_SELF_MODEL,
        thoughtNetworkPath: DEFAULT_THOUGHT_NETWORK,
        autoSyncStatusPath: DEFAULT_AUTOSYNC_STATUS
    };
}

async function readThoughtNetwork(filePath) {
    try {
        const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return { name: 'ThoughtNetwork', stats: {}, nodes: [], roots: [] };
    }
}

function normalizeThoughtNode(node = {}) {
    return {
        id: node.id,
        type: node.type || 'concept',
        content: node.content || '',
        sector: node.sector || 'GEN',
        embedding: node.embedding || null,
        parent: node.parent || null,
        children: Array.isArray(node.children) ? [...new Set(node.children)] : [],
        connections: Array.isArray(node.connections) ? dedupeConnections(node.connections) : [],
        created: node.created || Date.now(),
        lastAccessed: node.lastAccessed || Date.now(),
        accessCount: node.accessCount || 0,
        strength: Number(node.strength || 1),
        source: node.source || 'unknown',
        confidence: Number(node.confidence || 0.5),
        tags: Array.isArray(node.tags) ? [...new Set(node.tags)] : [],
        ...(node.evidence ? { evidence: node.evidence } : {})
    };
}

function ensureThoughtNode(nodeMap, id, content, config = {}) {
    const now = Date.now();
    const existing = nodeMap.get(id);
    if (existing) {
        existing.content = content || existing.content;
        existing.type = config.type || existing.type;
        existing.sector = config.sector || existing.sector;
        existing.source = config.source || existing.source;
        existing.confidence = Math.max(existing.confidence || 0, config.confidence || 0);
        existing.strength = Math.max(existing.strength || 0, config.strength || 0);
        existing.tags = [...new Set([...(existing.tags || []), ...(config.tags || [])])];
        existing.lastAccessed = now;
        existing.accessCount = (existing.accessCount || 0) + 1;
        if (config.evidence) existing.evidence = config.evidence;
        return existing;
    }
    const node = normalizeThoughtNode({
        id,
        content,
        type: config.type || 'concept',
        sector: config.sector || 'GEN',
        parent: config.parent || null,
        children: [],
        connections: [],
        created: now,
        lastAccessed: now,
        accessCount: 1,
        strength: config.strength || 0.65,
        source: config.source || 'memory_spine',
        confidence: config.confidence || 0.65,
        tags: config.tags || [],
        evidence: config.evidence
    });
    nodeMap.set(id, node);
    return node;
}

function connectThoughtNodes(a, b, type = 'related_to', weight = 0.5) {
    if (!a || !b || a.id === b.id) return 0;
    const changedA = upsertConnection(a, b.id, type, weight);
    const changedB = upsertConnection(b, a.id, inverseRelation(type), weight);
    if (!b.parent && type !== 'related_to') {
        b.parent = a.id;
        a.children = [...new Set([...(a.children || []), b.id])];
    }
    return changedA || changedB ? 1 : 0;
}

function upsertConnection(node, id, type, weight) {
    node.connections = Array.isArray(node.connections) ? node.connections : [];
    const existing = node.connections.find(conn => conn.id === id && conn.type === type);
    if (existing) {
        existing.weight = Math.max(Number(existing.weight || 0), weight);
        return false;
    }
    node.connections.push({ id, weight, type });
    return true;
}

function inverseRelation(type) {
    return {
        contains_category: 'category_of',
        has_signal: 'signal_of',
        supported_by: 'supports',
        enables: 'enabled_by',
        constrains: 'constrained_by'
    }[type] || type;
}

function dedupeConnections(connections = []) {
    const seen = new Set();
    const out = [];
    for (const conn of connections) {
        const key = `${conn.id}:${conn.type}`;
        if (!conn.id || seen.has(key)) continue;
        seen.add(key);
        out.push({ id: conn.id, weight: Number(conn.weight || 0.5), type: conn.type || 'related_to' });
    }
    return out;
}

function thoughtId(prefix, value) {
    return `${prefix}_${crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12)}`;
}

function titleFor(value = '') {
    return String(value || 'general')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function sectorCode(category = '') {
    const map = {
        memory_system: 'MEM',
        loop_failure: 'LOOP',
        self_model: 'SELF',
        finance: 'FIN',
        social: 'SOC',
        research: 'RES',
        tooling: 'TOOL',
        presence_home: 'HOME',
        vision: 'VIS',
        user_owner: 'OWNER',
        general: 'GEN'
    };
    return map[category] || 'GEN';
}

function confidenceFrom(avgImportance = 0, count = 1) {
    return Number(Math.max(0.45, Math.min(0.98, 0.48 + Number(avgImportance || 0) / 10 + Math.log10(Number(count || 1) + 1) / 8)).toFixed(3));
}

function strengthFrom(avgImportance = 0, count = 1, maxAccess = 0) {
    return Number(Math.max(0.4, Math.min(1, 0.4 + Number(avgImportance || 0) / 12 + Math.log10(Number(count || 1) + 1) / 6 + Math.min(Number(maxAccess || 0), 50) / 200)).toFixed(3));
}

function summarizeMemoryAsConcept(memory = {}) {
    const text = String(memory.content || '').replace(/\s+/g, ' ').trim();
    if (!text) return `Memory Evidence ${memory.id}`;
    const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
    return firstSentence.length > 180 ? `${firstSentence.slice(0, 177)}...` : firstSentence;
}

function connectKeyMemorySpineConcepts(nodeMap) {
    const root = nodeMap.get('memspine_root');
    const memory = nodeMap.get(thoughtId('memspine_cat', 'memory_system'));
    const loops = nodeMap.get(thoughtId('memspine_cat', 'loop_failure'));
    const self = nodeMap.get(thoughtId('memspine_cat', 'self_model'));
    const tools = nodeMap.get(thoughtId('memspine_cat', 'tooling'));
    const research = nodeMap.get(thoughtId('memspine_cat', 'research'));
    if (root && memory && self) connectThoughtNodes(memory, self, 'enables', 0.82);
    if (root && loops && tools) connectThoughtNodes(loops, tools, 'constrains', 0.78);
    if (self && loops) connectThoughtNodes(self, loops, 'observes', 0.76);
    if (memory && research) connectThoughtNodes(memory, research, 'supports', 0.7);
}

function ensureBaselineThoughtNodes(nodeMap) {
    const ai = ensureThoughtNode(nodeMap, 'baseline_ai', 'Artificial Intelligence', {
        type: 'concept',
        sector: 'TECH',
        source: 'bootstrap',
        confidence: 0.9,
        strength: 0.86,
        tags: ['technology', 'computing', 'baseline']
    });
    const learning = ensureThoughtNode(nodeMap, 'baseline_machine_learning', 'Machine Learning', {
        type: 'concept',
        sector: 'TECH',
        source: 'bootstrap',
        confidence: 0.88,
        strength: 0.84,
        tags: ['ai', 'learning', 'baseline']
    });
    const reasoning = ensureThoughtNode(nodeMap, 'baseline_reasoning_systems', 'Reasoning Systems', {
        type: 'concept',
        sector: 'COG',
        source: 'bootstrap',
        confidence: 0.9,
        strength: 0.86,
        tags: ['ai', 'logic', 'baseline']
    });
    const memory = ensureThoughtNode(nodeMap, 'baseline_memory_systems', 'Memory Systems', {
        type: 'concept',
        sector: 'MEM',
        source: 'bootstrap',
        confidence: 0.92,
        strength: 0.9,
        tags: ['cognition', 'storage', 'baseline']
    });
    const consciousness = ensureThoughtNode(nodeMap, 'baseline_consciousness', 'Consciousness', {
        type: 'concept',
        sector: 'COG',
        source: 'bootstrap',
        confidence: 0.72,
        strength: 0.72,
        tags: ['philosophy', 'cognition', 'baseline']
    });
    const soma = ensureThoughtNode(nodeMap, 'baseline_soma_architecture', 'SOMA Architecture', {
        type: 'system',
        sector: 'SELF',
        source: 'bootstrap',
        confidence: 0.94,
        strength: 0.94,
        tags: ['soma', 'self', 'baseline']
    });
    const arbiters = ensureThoughtNode(nodeMap, 'baseline_arbiter_system', 'Arbiter System', {
        type: 'system',
        sector: 'SELF',
        source: 'bootstrap',
        confidence: 0.9,
        strength: 0.88,
        tags: ['soma', 'architecture', 'baseline']
    });
    const fractals = ensureThoughtNode(nodeMap, 'baseline_fractal_knowledge_network', 'Fractal Knowledge Network', {
        type: 'pattern',
        sector: 'MEM',
        source: 'bootstrap',
        confidence: 0.88,
        strength: 0.88,
        tags: ['knowledge', 'graph', 'baseline']
    });

    connectThoughtNodes(ai, learning, 'enables', 0.9);
    connectThoughtNodes(ai, reasoning, 'requires', 0.85);
    connectThoughtNodes(ai, memory, 'uses', 0.8);
    connectThoughtNodes(learning, memory, 'requires', 0.75);
    connectThoughtNodes(reasoning, consciousness, 'related_to', 0.6);
    connectThoughtNodes(soma, arbiters, 'composed_of', 0.95);
    connectThoughtNodes(soma, ai, 'implements', 0.9);
    connectThoughtNodes(fractals, memory, 'implements', 0.85);
    connectThoughtNodes(arbiters, fractals, 'uses', 0.8);

    return { ai, learning, reasoning, memory, consciousness, soma, arbiters, fractals };
}

function calculateThoughtStats(nodes, previous = {}) {
    const nodeById = new Map(nodes.map(node => [node.id, node]));
    let totalConnections = 0;
    let totalDepth = 0;
    for (const node of nodes) {
        totalConnections += Array.isArray(node.connections) ? node.connections.length : 0;
        totalDepth += depthFor(node, nodeById);
    }
    return {
        ...previous,
        totalNodes: nodes.length,
        totalConnections: Math.floor(totalConnections / 2),
        averageDepth: nodes.length ? Number((totalDepth / nodes.length).toFixed(3)) : 0,
        lastGrowth: Date.now(),
        growthRate: previous?.totalNodes ? Number(((nodes.length - previous.totalNodes) / Math.max(1, previous.totalNodes)).toFixed(3)) : nodes.length
    };
}

function depthFor(node, nodeById) {
    let depth = 0;
    let current = node;
    const seen = new Set();
    while (current?.parent && nodeById.has(current.parent) && !seen.has(current.parent)) {
        seen.add(current.parent);
        current = nodeById.get(current.parent);
        depth++;
    }
    return depth;
}

function shouldScheduleMemorySpineSync(reason, payload = {}, state) {
    if (reason === 'periodic' || reason === 'insight.generated' || reason === 'dream.distilled' || reason === 'knowledge.ingested') {
        return true;
    }
    const normalized = normalizeImportance(payload.importance);
    if (normalized >= state.options.minImportance) return true;
    if (payload.category || payload.sector) return true;
    state.pendingEvents++;
    if (state.pendingEvents >= state.options.lowSignalBatch) return true;
    return false;
}

function normalizeImportance(value = 0) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return 0;
    return n > 1 ? Math.min(1, n / 10) : Math.max(0, n);
}

async function writeAutoSyncStatus(status, statusPath = DEFAULT_AUTOSYNC_STATUS) {
    await fs.mkdir(path.dirname(statusPath), { recursive: true });
    await fs.writeFile(statusPath, JSON.stringify(status, null, 2), 'utf8');
}

export default {
    auditMemorySpine,
    rebuildMemorySpine,
    recallMemorySpine,
    createMemorySpineGoals,
    syncMemorySpineToThoughtNetwork,
    startMemorySpineAutoSync,
    memorySpinePaths
};
