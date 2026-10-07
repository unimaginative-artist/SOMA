import express from 'express';
import messageBroker from '../../core/MessageBroker.js';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { requireEnterpriseAuth } from '../loaders/authMiddleware.js';

const router = express.Router();

function memoryMetadata(memory = {}) {
    if (memory.metadata && typeof memory.metadata === 'object') return memory.metadata;
    if (typeof memory.metadata === 'string') {
        try { return JSON.parse(memory.metadata); } catch { return {}; }
    }
    return {};
}

function memoryDomain(memory = {}) {
    const meta = memoryMetadata(memory);
    const lanes = Array.isArray(meta.brainLanes) ? meta.brainLanes : [];
    const routed = meta.primaryBrain || lanes.find(item => item !== 'MNEMOSYNE') || lanes[0];
    if (routed) return routed;

    let domain = 'AURORA';
    const text = (memory.content || '').toLowerCase();
    if (text.match(/code|error|bug|fix|function|const|let|var|class/)) domain = 'LOGOS';
    if (text.match(/market|price|trading|finance|btc|eth|stock|future/)) domain = 'PROMETHEUS';
    if (text.match(/security|auth|key|threat|vuln|protect/)) domain = 'THALAMUS';
    return domain;
}

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

const asText = (result) => result?.text || result?.response?.text || result?.response || (typeof result === 'string' ? result : '');

function buildQuality({ confidence = 0.7, importance = 5, usage = 1, metadata = {}, sourceType = 'unknown', promoted = false, contradictionCount = 0, lastVerified = null } = {}) {
    const evidenceCount = Number(metadata.evidenceCount || metadata.sourceCount || metadata.sources?.length || metadata.citations?.length || 0);
    const sourceCount = Math.max(
        evidenceCount,
        [metadata.source, metadata.title, metadata.noteRef, metadata.reflectionFile, metadata.experimentId].filter(Boolean).length
    );
    const confidenceScore = clamp(confidence);
    const evidenceScore = clamp(sourceCount / 3);
    const usageScore = clamp((Number(usage) || 0) / 10);
    const importanceScore = clamp((Number(importance) || 0) / 10);
    const contradictionPenalty = clamp(contradictionCount / 3) * 0.22;
    const promotionBoost = promoted ? 0.08 : 0;
    const score = clamp(
        confidenceScore * 0.44 +
        evidenceScore * 0.24 +
        usageScore * 0.12 +
        importanceScore * 0.12 +
        promotionBoost -
        contradictionPenalty
    );
    return {
        score,
        evidenceCount: sourceCount,
        sourceType,
        contradictionCount,
        lastVerified: lastVerified || metadata.lastVerified || metadata.timestamp || metadata.createdAt || null,
        status: score >= 0.82 ? 'strong' : score >= 0.62 ? 'usable' : score >= 0.42 ? 'weak' : 'unverified'
    };
}

export default function(system) {
    const getMnemonic = () => system.mnemonicArbiter || system.mnemonic;

    const getRecentMemories = async (limit = 80) => {
        const mnemonic = getMnemonic();
        if (!mnemonic?.getRecentColdMemories) return [];
        const memories = await mnemonic.getRecentColdMemories(limit);
        return (memories || []).map(memory => ({ ...memory, metadata: memoryMetadata(memory) }));
    };

    const buildContradictions = async ({ fragment = null } = {}) => {
        const beliefSystem = system.beliefSystem || system.beliefs;
        if (beliefSystem?.detectAllContradictions) {
            const result = await beliefSystem.detectAllContradictions();
            return result?.contradictions || Array.from(beliefSystem.contradictions?.values?.() || []).slice(0, 20);
        }
        if (beliefSystem?.contradictions) {
            return Array.from(beliefSystem.contradictions.values ? beliefSystem.contradictions.values() : beliefSystem.contradictions).slice(0, 20);
        }

        const memories = await getRecentMemories(120);
        const target = (fragment?.label || fragment?.content || '').toLowerCase();
        const candidates = memories.filter(memory => {
            const text = String(memory.content || '').toLowerCase();
            if (target && !text.includes(target.slice(0, 24))) return false;
            return /\b(no longer|not true|false|contradict|conflict|however|but|failed|null model|not significant)\b/i.test(text);
        }).slice(0, 12);
        return candidates.map((memory, index) => ({
            id: `mem-tension-${memory.id || index}`,
            type: memory.metadata?.type || 'memory_tension',
            status: 'Review',
            confidence: memory.importance || 0.55,
            source: memory.metadata?.source || 'mnemonic',
            summary: String(memory.content || '').slice(0, 220)
        }));
    };

    // GET /api/knowledge/fragments
    // Returns real fragments from the registry + persistent thought network + mnemonic memory
    router.get('/fragments', async (req, res) => {
        try {
            const allFragments = [];
            const allLinks = [];
            const sourceCounts = {
                fragmentRegistry: 0,
                mnemonic: 0,
                thoughtNetwork: 0,
                knowledgeGraph: 0,
                seedPack: 0
            };

            // 1. Load Transient Fragments (Registry)
            if (system.fragmentRegistry) {
                const fragments = system.fragmentRegistry.listFragments();
                fragments.forEach(f => {
                    const importance = 5 + ((f.expertiseLevel || 0) * 5);
                    const confidence = f.expertiseLevel || 0.8;
                    allFragments.push({
                        id: f.id,
                        label: f.label || `${f.specialization} (${f.domain})`,
                        type: 'fragment',
                        domain: f.pillar || 'LOGOS',
                        importance,
                        usage: f.queriesHandled || 1,
                        confidence,
                        brainLanes: [f.pillar || 'LOGOS'],
                        quality: buildQuality({ confidence, importance, usage: f.queriesHandled || 1, sourceType: 'fragment-registry', promoted: f.isPromoted }),
                        decay: 0.1,
                        z: Math.random() * 400 - 200
                    });
                    sourceCounts.fragmentRegistry++;
                });
            }

            // 2. Load Real Memories (Mnemonic Cold Tier)
            const mnemonic = getMnemonic();
            if (mnemonic && typeof mnemonic.getRecentColdMemories === 'function') {
                const memories = await getRecentMemories(150); // Cap at 150 to avoid crashing the browser graph
                memories.forEach(m => {
                    const domain = memoryDomain(m);
                    const meta = memoryMetadata(m);
                    const importance = 4 + (m.importance || 0);
                    const confidence = meta.confidence || 0.9;

                    allFragments.push({
                        id: `mem-${m.id}`,
                        label: m.content.substring(0, 40) + (m.content.length > 40 ? '...' : ''),
                        type: 'memory',
                        domain: domain,
                        importance,
                        usage: m.access_count || 1,
                        confidence,
                        brainLanes: meta.brainLanes || [domain],
                        primaryBrain: meta.primaryBrain || domain,
                        source: meta.source || 'mnemonic',
                        noteRef: meta.noteRef || meta.title || meta.reflectionFile || null,
                        quality: buildQuality({
                            confidence,
                            importance,
                            usage: m.access_count || 1,
                            metadata: meta,
                            sourceType: meta.source || 'mnemonic',
                            promoted: meta.promotedToFractal
                        }),
                        decay: 0.05,
                        z: Math.random() * 400 - 200
                    });
                    sourceCounts.mnemonic++;
                });
            }

            // 3. Load Persistent Fractals (Thought Network)
            if (system.thoughtNetwork && system.thoughtNetwork.nodes) {
                for (const node of system.thoughtNetwork.nodes.values()) {
                    // ... (mapping logic remains same)
                    let domain = 'AURORA';
                    if (node.strength > 0.8 || node.confidence > 0.9) domain = 'LOGOS';
                    if (node.type === 'goal' || node.type === 'strategy' || node.type === 'plan') domain = 'PROMETHEUS';
                    if (node.type === 'rule' || node.type === 'safety' || node.type === 'guard') domain = 'THALAMUS';
                    
                    const content = (node.content || "").toLowerCase();
                    if (content.match(/target|future|project|risk|forecast|mission|objective|plan/)) domain = 'PROMETHEUS';

                    const importance = 6 + (node.strength || 0) * 4;
                    const confidence = node.confidence || 0.7;
                    allFragments.push({
                        id: node.id,
                        label: node.content,
                        type: node.type || 'concept',
                        domain: domain,
                        importance,
                        usage: node.accessCount || 1,
                        confidence,
                        brainLanes: [domain],
                        quality: buildQuality({
                            confidence,
                            importance,
                            usage: node.accessCount || 1,
                            metadata: node.metadata || {},
                            sourceType: 'thought-network',
                            promoted: node.isPromoted || node.core
                        }),
                        decay: 0.05,
                        z: Math.random() * 400 - 200
                    });
                    sourceCounts.thoughtNetwork++;

                    if (node.connections) {
                        for (const conn of node.connections) {
                            allLinks.push({ source: node.id, target: conn.id, type: conn.type || 'dependency' });
                        }
                    }
                }
            }

            // 4. Load Fused Knowledge (Knowledge Graph)
            if (system.knowledgeGraph && system.knowledgeGraph.nodes) {
                const nodes = Array.from(system.knowledgeGraph.nodes.values());
                const edges = Array.from(system.knowledgeGraph.edges.values());

                nodes.forEach(node => {
                    if (!allFragments.find(f => f.id === node.id)) {
                        const importance = 7;
                        const confidence = node.confidence || 0.8;
                        allFragments.push({
                            id: node.id,
                            label: node.name,
                            type: node.type || 'concept',
                            domain: node.domain || 'LOGOS',
                            importance,
                            usage: node.usageCount || 1,
                            confidence,
                            brainLanes: [node.domain || 'LOGOS'],
                            quality: buildQuality({
                                confidence,
                                importance,
                                usage: node.usageCount || 1,
                                metadata: node.metadata || {},
                                sourceType: 'knowledge-graph',
                                promoted: node.isPromoted
                            }),
                            decay: 0.1,
                            z: Math.random() * 400 - 200
                        });
                        sourceCounts.knowledgeGraph++;
                    }
                });
                
                edges.forEach(edge => {
                    allLinks.push({
                        source: edge.from,
                        target: edge.to,
                        type: edge.relationship || 'synthesis'
                    });
                });
            }

            // 5. Seed fallback — read directly from seeds/*.json when no in-memory knowledge is ready yet
            if (allFragments.length === 0) {
                try {
                    const seedsDir = join(process.cwd(), 'seeds');
                    const files = await readdir(seedsDir).catch(() => []);
                    for (const file of files.filter(f => f.endsWith('.json'))) {
                        const raw = await readFile(join(seedsDir, file), 'utf8').catch(() => null);
                        if (!raw) continue;
                        const pack = JSON.parse(raw);
                        for (const node of (pack.nodes || [])) {
                            let domain = 'AURORA';
                            const text = (node.content || '').toLowerCase();
                            const tags = node.tags || [];
                            if (text.match(/logic|proof|code|deduct|infer|math|data|system|algorithm|engineer/) || tags.includes('code') || tags.includes('engineering')) domain = 'LOGOS';
                            if (text.match(/strategy|goal|objective|plan|mission|target|future|risk|forecast/) || tags.includes('strategy')) domain = 'PROMETHEUS';
                            if (text.match(/security|safety|guard|protect|threat|privacy|rule|ethical|trust/) || tags.includes('security')) domain = 'THALAMUS';
                            const importance = 6 + (node.strength || 0.5) * 4;
                            const confidence = node.confidence || 0.8;
                            allFragments.push({
                                id: node.id,
                                label: node.content,
                                type: node.type || 'concept',
                                domain,
                                importance,
                                usage: node.accessCount || 1,
                                confidence,
                                brainLanes: [domain],
                                quality: buildQuality({
                                    confidence,
                                    importance,
                                    usage: node.accessCount || 1,
                                    metadata: { source: file, tags },
                                    sourceType: 'seed-pack'
                                }),
                                decay: 0.05,
                                z: Math.random() * 400 - 200
                            });
                            sourceCounts.seedPack++;
                            for (const conn of (node.connections || [])) {
                                allLinks.push({ source: node.id, target: conn.id, type: conn.type || 'related' });
                            }
                        }
                    }
                } catch (_) { /* non-fatal */ }
            }

            // 6. Structural Clustering (If links are sparse)
            if (allLinks.length === 0 && allFragments.length > 0) {
                const byDomain = {};
                allFragments.forEach(f => {
                    if (!byDomain[f.domain]) byDomain[f.domain] = [];
                    byDomain[f.domain].push(f);
                });

                Object.keys(byDomain).forEach(domain => {
                    const group = byDomain[domain];
                    if (group.length > 1) {
                        for (let i = 0; i < Math.min(group.length, 50); i++) {
                            const next = (i + 1) % group.length;
                            allLinks.push({
                                source: group[i].id,
                                target: group[next].id,
                                type: 'dependency'
                            });
                        }
                    }
                });
            }

            res.json({
                success: true,
                fragments: allFragments,
                links: allLinks,
                meta: {
                    counts: sourceCounts,
                    totalFragments: allFragments.length,
                    totalLinks: allLinks.length
                }
            });
        } catch (error) {
            console.error('[Knowledge] Error fetching fragments:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/knowledge/learn
    router.post('/learn', async (req, res) => {
        try {
            const { query, mode } = req.body;
            
            if (!query) {
                return res.status(400).json({ success: false, error: 'Query is required' });
            }

            console.log(`[Knowledge] Learning request received: "${query}" (${mode})`);

            // Respond immediately to UI
            res.json({ success: true, message: "Learning process initiated" });

            // Run real cognitive process in background
            (async () => {
                try {
                    // 1. Ask the Brain (Aurora/Logos) to generate concepts
                    const prompt = `You are the SOMA Knowledge Engine. The user wants to learn about: "${query}".
                    Generate 3-5 distinct, deep, and specific concepts or axioms related to this topic.
                    Return ONLY a JSON array of objects with this format:
                    [
                        { "label": "Concept Name", "domain": "LOGOS|AURORA|PROMETHEUS|THALAMUS", "description": "Brief definition" }
                    ]`;

                    // We use the brain from the system object (instantiated in soma-server.js)
                    const brain = system.brain || system.superintelligence;
                    if (brain) {
                        const result = await brain.reason(prompt);
                        let concepts = [];
                        try {
                            // Extract JSON from potential markdown blocks
                            const jsonMatch = result.text.match(/\[.*\]/s);
                            if (jsonMatch) {
                                concepts = JSON.parse(jsonMatch[0]);
                            } else {
                                concepts = JSON.parse(result.text);
                            }
                        } catch (e) {
                            console.error("Failed to parse brain response for learning:", e);
                            // Fallback if parsing fails
                            concepts = [{ label: `${query} (Unstructured)`, domain: 'AURORA', description: result.text.substring(0, 50) }];
                        }

                        // 2. Emit Real Nodes
                        for (const c of concepts) {
                            await new Promise(r => setTimeout(r, 800)); // Pacing for UX
                            
                            const node = {
                                id: `learned-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                                label: c.label,
                                type: 'concept',
                                domain: c.domain,
                                importance: 7,
                                confidence: 0.85,
                                description: c.description
                            };

                            messageBroker.emit('learning:node_created', { node });
                            
                            messageBroker.emit('learning:brain_activity', {
                                brain: c.domain,
                                action: `Synthesized: ${c.label}`,
                                timestamp: Date.now()
                            });
                        }
                    }
                } catch (err) {
                    console.error("Background learning error:", err);
                }
            })();

        } catch (error) {
            console.error('[Knowledge] Learning error:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/knowledge/config/brain
    router.post('/config/brain', requireEnterpriseAuth, async (req, res) => {
        try {
            const { brainId, featureId, payload = {} } = req.body || {};
            system.__knowledgeConfig = system.__knowledgeConfig || {};
            if (brainId && featureId) {
                system.__knowledgeConfig[`${brainId}:${featureId}`] = {
                    payload,
                    updatedAt: new Date().toISOString()
                };
            }
            res.json({ success: true, brainId, featureId, payload });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/knowledge/operation
    // Performs real cognitive operations (Proof, Causal Simulation, etc.)
    router.post('/operation', async (req, res) => {
        try {
            const { brainId, featureId, payload } = req.body;
            const brain = system.quadBrain || system.brain || system.superintelligence;
            
            if (featureId === 'Proof Engine') {
                if (!brain?.reason) return res.status(503).json({ success: false, error: 'Brain unavailable' });
                const result = await brain.reason(`FORMAL LOGIC PROOF REQUEST: 
                Statement: "${payload.proposition}"
                Analyze this statement for logical validity. Provide a 3-step proof chain.`, { forceComplexity: true });
                
                return res.json({ success: true, result: asText(result) });
            }

            if (featureId === 'Verify Fragment') {
                const fragment = payload?.fragment || {};
                const contradictions = await buildContradictions({ fragment });
                const exactTensions = contradictions.filter(item => {
                    const haystack = `${item.summary || item.statement || item.reason || ''}`.toLowerCase();
                    return fragment.label && haystack.includes(String(fragment.label).toLowerCase().slice(0, 24));
                });
                return res.json({
                    success: true,
                    verification: {
                        fragmentId: fragment.id,
                        score: buildQuality({
                            confidence: fragment.confidence,
                            importance: fragment.importance,
                            usage: fragment.usage,
                            metadata: fragment,
                            sourceType: fragment.source || fragment.type,
                            contradictionCount: exactTensions.length,
                            lastVerified: Date.now()
                        }),
                        tensions: exactTensions.slice(0, 5)
                    }
                });
            }

            if (featureId === 'Inference Tree') {
                const memories = await getRecentMemories(24);
                const nodes = memories.slice(0, 8).map((memory, index) => ({
                    id: memory.id || index,
                    label: String(memory.content || '').slice(0, 86),
                    depth: Math.min(3, index % 4),
                    status: memory.metadata?.promotedToFractal ? 'valid' : (memory.importance || 0) > 0.75 ? 'valid' : 'checking'
                }));
                return res.json({ success: true, nodes });
            }

            if (featureId === 'Hypothesis Forge') {
                if (!brain?.reason) return res.status(503).json({ success: false, error: 'Brain unavailable' });
                const result = await brain.reason(`HYPOTHESIS FORGE REQUEST:
                Seed Concept: "${payload.hypothesis}"
                Generate 3 divergent but testable hypotheses based on this seed.
                For each, include: hypothesis, possible evidence, and a falsification test.
                Format as a compact bulleted list.`, { brain: 'AURORA' });
                
                return res.json({ success: true, result: asText(result) });
            }

            if (featureId === 'Pattern Mutation') {
                if (!brain?.reason) return res.status(503).json({ success: false, error: 'Brain unavailable' });
                const result = await brain.reason(`PATTERN MUTATION REQUEST:
                Target Fragment: "${payload.label}"
                Mode: "${payload.mode || 'evolve'}"
                Generate a structural variant, inverse interpretation, and one testable implication.`, { brain: 'AURORA' });
                
                return res.json({ success: true, mutation: asText(result) });
            }

            if (featureId === 'Creative Memory') {
                const memories = await getRecentMemories(80);
                const creative = memories
                    .filter(memory => {
                        const meta = memoryMetadata(memory);
                        const text = `${memory.content || ''} ${JSON.stringify(meta)}`.toLowerCase();
                        return meta.primaryBrain === 'AURORA' || (meta.brainLanes || []).includes('AURORA') || /story|muse|reflection|plato|socrates|metaphysics|voice|identity|dream|creative/i.test(text);
                    })
                    .slice(0, 8)
                    .map(memory => ({
                        id: memory.id,
                        title: memory.metadata?.title || memory.metadata?.noteRef || String(memory.content || '').slice(0, 52),
                        drift: memory.metadata?.type === 'reflection_distillation' ? 'Distilled' : memory.metadata?.source || 'Mnemonic',
                        content: String(memory.content || '').slice(0, 220),
                        lanes: memory.metadata?.brainLanes || ['AURORA']
                    }));
                return res.json({ success: true, memories: creative });
            }

            if (featureId === 'Dreamspace') {
                const memories = await getRecentMemories(40);
                const clusters = ['identity', 'story', 'strategy', 'logic', 'safety', 'research'].map(topic => ({
                    topic,
                    count: memories.filter(memory => String(memory.content || '').toLowerCase().includes(topic)).length
                })).filter(cluster => cluster.count > 0);
                return res.json({
                    success: true,
                    dreamspace: {
                        clusters: clusters.slice(0, 6),
                        seedCount: memories.length,
                        summary: clusters.length
                            ? `SOMA is recombining ${clusters.length} active memory clusters from ${memories.length} recent memories.`
                            : `SOMA has ${memories.length} recent memories available, but no dominant creative cluster is emerging yet.`
                    }
                });
            }

            if (featureId === 'Causal Solver') {
                const chains = await system.causality?.queryCausalChains(payload.cause, { maxDepth: 2 }) || [];
                // If no real chains, use LLM to project potential causality
                if (chains.length === 0) {
                    if (!brain?.reason) return res.json({ success: true, impacts: [] });
                    const projection = await brain.reason(`CAUSAL PROJECTION REQUEST:
                    Cause: "${payload.cause}"
                    Project 3 potential system-wide effects with percentage probabilities.`, { quickResponse: true });
                    return res.json({ success: true, projection: asText(projection) });
                }
                return res.json({ success: true, chains });
            }

            if (featureId === 'Contradiction Scanner') {
                const contradictions = await buildContradictions({ fragment: payload?.fragment });
                return res.json({ success: true, contradictions });
            }

            if (featureId === 'Rule Graph') {
                const beliefSystem = system.beliefSystem || system.beliefs;
                const beliefs = beliefSystem?.queryBeliefs?.()?.beliefs
                    || beliefSystem?.getAllBeliefs?.()?.beliefs
                    || beliefSystem?.getBeliefs?.()?.beliefs
                    || Array.from(beliefSystem?.beliefs?.values?.() || []);
                const rules = beliefs.slice(0, 12).map((belief, index) => ({
                    id: belief.id || `rule-${index}`,
                    label: belief.statement || belief.name || belief.content || `Rule ${index + 1}`,
                    type: belief.category || belief.metadata?.domain || 'belief',
                    confidence: belief.confidence ?? 0.8,
                    core: !!belief.metadata?.isCore
                }));
                const stats = {
                    Immutable: rules.filter(rule => rule.core).length,
                    Heuristic: rules.filter(rule => !rule.core && rule.confidence < 0.9).length,
                    Derived: Math.max(0, rules.length - rules.filter(rule => rule.core).length)
                };
                return res.json({ success: true, rules, stats });
            }

            // --- PROMETHEUS OPERATIONS ---
            if (featureId === 'World Model') {
                const worldState = system.worldModel?.getStatus?.() || system.worldModel?.getStats?.() || { status: 'offline', nodes: 0 };
                return res.json({ success: true, state: worldState });
            }

            if (featureId === 'Threat Horizon') {
                // Get real alerts from Security Council or Immune System
                const alerts = system.securityCouncil?.getRecentAlerts?.() || system.immuneSystem?.alerts || [];
                return res.json({ success: true, alerts });
            }

            if (featureId === 'Strategy Lattice') {
                const goals = await system.goalPlanner?.getActiveGoals?.() || await system.goalPlanner?.getGoals?.() || [];
                return res.json({ success: true, goals });
            }

            if (featureId === 'Prediction Engine') {
                if (!brain?.reason) return res.status(503).json({ success: false, error: 'Brain unavailable' });
                const result = await brain.reason(`STRATEGIC PROJECTION REQUEST:
                Scenario: "${payload.scenario}"
                Predict the 24-hour outcome and identify 3 critical dependencies.`, { brain: 'PROMETHEUS' });
                return res.json({ success: true, result: asText(result) });
            }

            if (featureId === 'Reality Drift') {
                const worldStats = system.worldModel?.getStats?.() || {};
                const stats = system.performanceOracle?.getDriftStats?.() || {
                    drift: worldStats.avgPredictionError ?? 0.05,
                    accuracy: worldStats.accuracy ?? 0,
                    statesModeled: worldStats.statesModeled || 0,
                    simulationsRun: worldStats.simulationsRun || 0
                };
                return res.json({ success: true, stats });
            }

            // --- THALAMUS OPERATIONS ---
            if (featureId === 'Signal Firewall') {
                const alerts = system.securityCouncil?.getRecentAlerts?.() || [];
                const logs = alerts.length
                    ? alerts.map((alert, index) => ({
                        id: alert.id || `SEC-${index + 1}`,
                        type: alert.type || alert.severity || 'Security',
                        status: /block|critical|high/i.test(`${alert.action || alert.severity || alert.message || ''}`) ? 'Blocked' : 'Allowed',
                        details: alert.message || alert.reason || JSON.stringify(alert).slice(0, 120)
                    }))
                    : [{ id: 'FW-READY', type: 'Runtime', status: 'Allowed', details: 'No recent security alerts in buffer.' }];
                return res.json({ success: true, logs });
            }

            if (featureId === 'Sensory Gate') {
                const status = {
                    flow: system.quadBrain ? 'stable' : 'degraded',
                    load: Math.min(1, ((system.fragmentRegistry?.listFragments?.()?.length || 0) + (system.thoughtNetwork?.nodes?.size || 0)) / 500),
                    activeChannels: ['Memory', 'Knowledge', system.quadBrain ? 'QuadBrain' : null, system.worldModel ? 'WorldModel' : null].filter(Boolean)
                };
                return res.json({ success: true, status });
            }

            if (featureId === 'Anomaly Buffer') {
                const contradictions = await buildContradictions();
                const anomalies = contradictions.slice(0, 8).map((item, index) => ({
                    id: item.id || `ANOM-${index + 1}`,
                    type: item.type || item.category || 'Cognitive tension',
                    confidence: item.confidence || item.severity || 0.35,
                    source: item.source || 'Knowledge'
                }));
                return res.json({ success: true, anomalies });
            }

            if (featureId === 'Neural Encryption') {
                const keyStatus = {
                    version: 'local-memory-routed-context',
                    lastCycled: system.__knowledgeConfig?.['THALAMUS:Neural Encryption']?.updatedAt || new Date().toISOString(),
                    strength: process.env.SOMA_AUTH_TOKEN || process.env.ENTERPRISE_AUTH_TOKEN ? 'Authenticated' : 'Local'
                };
                return res.json({ success: true, status: keyStatus });
            }

            if (featureId === 'Protocol Guard') {
                const directives = [
                    { name: 'Coherence: route memories through brain lanes before promotion', status: 'Enforced' },
                    { name: 'Evidence: mark weak or unsourced fragments before using them as truth', status: 'Enforced' },
                    { name: 'Safety: keep credential and security memories in Thalamus lane', status: 'Enforced' }
                ];
                return res.json({ success: true, directives });
            }

            res.json({ success: true, message: "Operation processed" });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // GET /api/knowledge/load - Load knowledge graph for Command Bridge
    router.get('/load', (req, res) => {
        try {
            if (system.knowledgeGraph) {
                res.json({
                    success: true,
                    knowledge: {
                        nodes: Array.from(system.knowledgeGraph.nodes?.values() || []),
                        edges: Array.from(system.knowledgeGraph.edges?.values() || [])
                    }
                });
            } else {
                res.json({ success: true, knowledge: { nodes: [], edges: [] } });
            }
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}
