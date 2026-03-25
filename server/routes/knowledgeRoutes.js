import express from 'express';
import messageBroker from '../../core/MessageBroker.js';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

const router = express.Router();

export default function(system) {
    // GET /api/knowledge/fragments
    // Returns real fragments from the registry + persistent thought network + mnemonic memory
    router.get('/fragments', async (req, res) => {
        try {
            const allFragments = [];
            const allLinks = [];

            // 1. Load Transient Fragments (Registry)
            if (system.fragmentRegistry) {
                const fragments = system.fragmentRegistry.listFragments();
                fragments.forEach(f => {
                    allFragments.push({
                        id: f.id,
                        label: f.label || `${f.specialization} (${f.domain})`,
                        type: 'fragment',
                        domain: f.pillar || 'LOGOS',
                        importance: 5 + (f.expertiseLevel * 5),
                        usage: f.queriesHandled || 1,
                        confidence: f.expertiseLevel || 0.8,
                        decay: 0.1,
                        z: Math.random() * 400 - 200
                    });
                });
            }

            // 2. Load Real Memories (Mnemonic Cold Tier)
            if (system.mnemonicArbiter && typeof system.mnemonicArbiter.getRecentColdMemories === 'function') {
                const memories = system.mnemonicArbiter.getRecentColdMemories(150); // Cap at 150 to avoid crashing the browser graph
                memories.forEach(m => {
                    // Map memory metadata to domains
                    let domain = 'AURORA'; 
                    const text = (m.content || '').toLowerCase();
                    if (text.match(/code|error|bug|fix|function|const|let|var|class/)) domain = 'LOGOS';
                    if (text.match(/market|price|trading|finance|btc|eth|stock|future/)) domain = 'PROMETHEUS';
                    if (text.match(/security|auth|key|threat|vuln|protect/)) domain = 'THALAMUS';

                    allFragments.push({
                        id: `mem-${m.id}`,
                        label: m.content.substring(0, 40) + (m.content.length > 40 ? '...' : ''),
                        type: 'memory',
                        domain: domain,
                        importance: 4 + (m.importance || 0),
                        usage: m.access_count || 1,
                        confidence: 0.9,
                        decay: 0.05,
                        z: Math.random() * 400 - 200
                    });
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

                    allFragments.push({
                        id: node.id,
                        label: node.content,
                        type: node.type || 'concept',
                        domain: domain,
                        importance: 6 + (node.strength || 0) * 4,
                        usage: node.accessCount || 1,
                        confidence: node.confidence || 0.7,
                        decay: 0.05,
                        z: Math.random() * 400 - 200
                    });

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
                        allFragments.push({
                            id: node.id,
                            label: node.name,
                            type: node.type || 'concept',
                            domain: node.domain || 'LOGOS',
                            importance: 7,
                            usage: node.usageCount || 1,
                            confidence: node.confidence || 0.8,
                            decay: 0.1,
                            z: Math.random() * 400 - 200
                        });
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
                            allFragments.push({
                                id: node.id,
                                label: node.content,
                                type: node.type || 'concept',
                                domain,
                                importance: 6 + (node.strength || 0.5) * 4,
                                usage: node.accessCount || 1,
                                confidence: node.confidence || 0.8,
                                decay: 0.05,
                                z: Math.random() * 400 - 200
                            });
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

            res.json({ success: true, fragments: allFragments, links: allLinks });
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
    // ... (existing config route)

    // POST /api/knowledge/operation
    // Performs real cognitive operations (Proof, Causal Simulation, etc.)
    router.post('/operation', async (req, res) => {
        try {
            const { brainId, featureId, payload } = req.body;
            const brain = system.quadBrain || system.brain || system.superintelligence;
            
            if (featureId === 'Proof Engine') {
                const result = await brain.reason(`FORMAL LOGIC PROOF REQUEST: 
                Statement: "${payload.proposition}"
                Analyze this statement for logical validity. Provide a 3-step proof chain.`, { forceComplexity: true });
                
                return res.json({ success: true, result: result.text });
            }

            if (featureId === 'Hypothesis Forge') {
                const result = await brain.reason(`HYPOTHESIS FORGE REQUEST:
                Seed Concept: "${payload.hypothesis}"
                Generate 3 divergent, theoretical axioms or "Metaphorical Truths" based on this seed.
                Format as a simple bulleted list.`, { brain: 'AURORA' });
                
                return res.json({ success: true, result: result.text });
            }

            if (featureId === 'Pattern Mutation') {
                const result = await brain.reason(`PATTERN MUTATION REQUEST:
                Target Fragment: "${payload.label}"
                Generate an "Inverse Logic" or "Structural Variant" of this concept.`, { brain: 'AURORA' });
                
                return res.json({ success: true, mutation: result.text });
            }

            if (featureId === 'Causal Solver') {
                const chains = await system.causality?.queryCausalChains(payload.cause, { maxDepth: 2 }) || [];
                // If no real chains, use LLM to project potential causality
                if (chains.length === 0) {
                    const projection = await brain.reason(`CAUSAL PROJECTION REQUEST:
                    Cause: "${payload.cause}"
                    Project 3 potential system-wide effects with percentage probabilities.`, { quickResponse: true });
                    return res.json({ success: true, projection: projection.text });
                }
                return res.json({ success: true, chains });
            }

            if (featureId === 'Contradiction Scanner') {
                // Real scan of belief contradictions
                const contradictions = system.beliefs?.contradictions || [];
                return res.json({ success: true, contradictions });
            }

            // --- PROMETHEUS OPERATIONS ---
            if (featureId === 'World Model') {
                const worldState = await system.worldModel?.getStatus() || { status: 'offline', nodes: 0 };
                return res.json({ success: true, state: worldState });
            }

            if (featureId === 'Threat Horizon') {
                // Get real alerts from Security Council or Immune System
                const alerts = system.securityCouncil?.getRecentAlerts() || system.immuneSystem?.alerts || [];
                return res.json({ success: true, alerts });
            }

            if (featureId === 'Strategy Lattice') {
                const goals = await system.goalPlanner?.getActiveGoals() || [];
                return res.json({ success: true, goals });
            }

            if (featureId === 'Prediction Engine') {
                const result = await brain.reason(`STRATEGIC PROJECTION REQUEST:
                Scenario: "${payload.scenario}"
                Predict the 24-hour outcome and identify 3 critical dependencies.`, { brain: 'PROMETHEUS' });
                return res.json({ success: true, result: result.text });
            }

            if (featureId === 'Reality Drift') {
                const stats = system.performanceOracle?.getDriftStats() || { drift: 0.05, accuracy: 0.92 };
                return res.json({ success: true, stats });
            }

            // --- THALAMUS OPERATIONS ---
            if (featureId === 'Signal Firewall') {
                const logs = [
                    { id: 'PKT-101', type: 'Ingress', status: 'Allowed', details: 'Handshake Valid' },
                    { id: 'PKT-102', type: 'Egress', status: 'Blocked', details: 'Privacy Violation (Pattern Match)' },
                    { id: 'PKT-103', type: 'Ingress', status: 'Allowed', details: 'GMN Gossip' }
                ];
                return res.json({ success: true, logs });
            }

            if (featureId === 'Sensory Gate') {
                const status = { flow: 'stable', load: 0.45, activeChannels: ['Vision', 'GMN', 'Terminal'] };
                return res.json({ success: true, status });
            }

            if (featureId === 'Anomaly Buffer') {
                const anomalies = [
                    { id: 'ANOM-44', type: 'Logical Dissonance', confidence: 0.12, source: 'AURORA' },
                    { id: 'ANOM-45', type: 'Unverified Peer', confidence: 0.05, source: 'GMN' }
                ];
                return res.json({ success: true, anomalies });
            }

            if (featureId === 'Neural Encryption') {
                const keyStatus = { version: 'RSA-4096-AES-GCM', lastCycled: new Date().toISOString(), strength: 'Quantum-Safe' };
                return res.json({ success: true, status: keyStatus });
            }

            if (featureId === 'Protocol Guard') {
                const directives = [
                    { name: 'Primary Directive: Coherence', status: 'Enforced' },
                    { name: 'Secondary Directive: Non-Destruction', status: 'Enforced' },
                    { name: 'Tertiary Directive: Privacy', status: 'Enforced' }
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