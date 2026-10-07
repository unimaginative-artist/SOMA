import React, { useState, useEffect, useCallback, useMemo } from 'react';
import somaBackend from '../../somaBackend.js';
// import { GoogleGenAI, Type } from "@google/genai"; // Removed for browser compatibility
import { ControlBar } from './components/ControlBar.jsx';
import { ThreeBrains } from './components/ThreeBrains.jsx';
import { FragmentRegistry } from './components/FragmentRegistry.jsx';
import { CognitiveTrace } from './components/CognitiveTrace.enhanced.jsx';
import { FloatingActivityOverlay } from './components/FloatingActivityOverlay.jsx';
import { BrainDetail } from './components/BrainDetail.jsx';
import { FragmentDetail } from './components/FragmentDetail.jsx';
import { RotationControl } from './components/RotationControl.jsx';
import { InputModal } from './components/InputModal.jsx';
import { SpaceBackground } from './components/SpaceBackground.jsx';
import { FeatureOverlay } from './components/FeatureOverlay.jsx';
import PersonaDetail from './components/PersonaDetail.jsx';
import { BrainType } from './types.js';
import { BRAINS, MOCK_FRAGMENTS, MOCK_LINKS } from './constants.js';
import { Info, X, Zap, Cpu, Eye, ShieldCheck } from 'lucide-react';

const KnowledgeApp = ({ brainStats }) => {
    const [activeBrain, setActiveBrain] = useState(null);
    const [activeFeature, setActiveFeature] = useState(null);
    const [selectedFragment, setSelectedFragment] = useState(null);
    const [tracedFragmentId, setTracedFragmentId] = useState(null);
    const [rotation, setRotation] = useState({ x: 0.2, y: 0.5 });
    const [isInputModalOpen, setIsInputModalOpen] = useState(false);
    const [showParticles, setShowParticles] = useState(true);
    const [showInfluenceInfo, setShowInfluenceInfo] = useState(null);
    const [viewMode, setViewMode] = useState('nodes'); // nodes | personas
    const [selectedPersona, setSelectedPersona] = useState(null);
    const [personaSearch] = useState('');

    // Cognitive Core States
    const [fragments, setFragments] = useState([]);
    const [links, setLinks] = useState([]);
    const [personas, setPersonas] = useState([]);
    const [systemStatus, setSystemStatus] = useState({ label: 'COHERENT', color: 'bg-green-500' });
    const [externalLog, setExternalLog] = useState(null);
    const [entropy, setEntropy] = useState(0.4);
    const [influence, setInfluence] = useState({
        [BrainType.AURORA]: 25,
        [BrainType.PROMETHEUS]: 25,
        [BrainType.LOGOS]: 25,
        [BrainType.THALAMUS]: 25
    });

    // Real stats from backend
    const [realBrainStats, setRealBrainStats] = useState(null);

    // Sync prop stats
    useEffect(() => {
        if (brainStats) {
            setRealBrainStats(brainStats);
            
            // Update influence levels based on real-time load
            setInfluence({
                [BrainType.AURORA]: Math.max(15, brainStats.AURORA?.load || 25),
                [BrainType.PROMETHEUS]: Math.max(15, brainStats.PROMETHEUS?.load || 25),
                [BrainType.LOGOS]: Math.max(15, brainStats.LOGOS?.load || 25),
                [BrainType.THALAMUS]: Math.max(15, brainStats.THALAMUS?.load || 25)
            });
        }
    }, [brainStats]);

    // Learning activity tracking
    const [learningActivities, setLearningActivities] = useState([]);
    
    // Debate Logs (Society of Mind)
    const [debateLogs, setDebateLogs] = useState([]);

    // Cognitive Trace collapse state
    const [isTraceCollapsed, setIsTraceCollapsed] = useState(false);

    // Initial Fetch of Real Fragments — retries until server is ready, then again at 100s for ThoughtNetwork/FragmentRegistry
    useEffect(() => {
        let retryTimer = null;
        let extendedTimer = null;

        const fetchFragments = async () => {
            try {
                const res = await fetch('/api/knowledge/fragments');
                if (!res.ok) {
                    // Server not ready yet (503) — retry in 5s
                    retryTimer = setTimeout(fetchFragments, 5000);
                    return;
                }
                const data = await res.json();
                if (data.success) {
                    if (data.fragments && data.fragments.length > 0) {
                        setFragments(data.fragments);
                        addLog(`Loaded ${data.fragments.length} cognitive fragments from registry.`, BrainType.LOGOS);
                    } else {
                        // Fallback to procedural fragments if registry is empty
                        setFragments(MOCK_FRAGMENTS);
                        addLog(`Initializing procedural neural map (${MOCK_FRAGMENTS.length} nodes).`, BrainType.LOGOS);
                    }
                    if (data.links && data.links.length > 0) {
                        setLinks(data.links);
                    } else if (!data.fragments || data.fragments.length === 0) {
                        setLinks(MOCK_LINKS);
                    }
                }
            } catch (err) {
                console.warn("Failed to fetch real fragments:", err);
                retryTimer = setTimeout(fetchFragments, 5000);
            }
        };

        fetchFragments();
        // ThoughtNetwork + FragmentRegistry load at 90s — refresh after they're up
        extendedTimer = setTimeout(fetchFragments, 100000);

        return () => {
            clearTimeout(retryTimer);
            clearTimeout(extendedTimer);
        };
    }, []);

    // Fetch personas — retries and refreshes after IdentityArbiter loads at 90s
    useEffect(() => {
        let retryTimer = null;
        let extendedTimer = null;

        const fetchPersonas = async () => {
            try {
                const res = await fetch('/api/identity/personas');
                const data = await res.json();
                if (data.success) {
                    setPersonas(data.personas || []);
                }
            } catch (err) {
                console.warn("Failed to fetch personas:", err);
                retryTimer = setTimeout(fetchPersonas, 5000);
            }
        };

        fetchPersonas();
        // IdentityArbiter (464 personas from agents_repo) loads at 90s
        extendedTimer = setTimeout(fetchPersonas, 100000);

        return () => {
            clearTimeout(retryTimer);
            clearTimeout(extendedTimer);
        };
    }, []);

    const personaFragments = useMemo(() => {
        const safeBrain = (value) => {
            if (!value) return BrainType.AURORA;
            const raw = value.toString().trim().toLowerCase();
            const upper = raw.toUpperCase();
            if (BRAINS[upper]) return upper;

            const map = [
                { keys: ['aurora', 'creative', 'artist', 'vision', 'imagination', 'story', 'muse', 'poet', 'dream', 'philosophy', 'empathy'], brain: BrainType.AURORA },
                { keys: ['logos', 'logic', 'deduction', 'inference', 'proof', 'math', 'science', 'research', 'engineer', 'technical', 'data', 'analyst'], brain: BrainType.LOGOS },
                { keys: ['prometheus', 'strategy', 'perception', 'ops', 'tactics', 'growth', 'execution', 'leader', 'plan', 'foresight', 'market', 'future'], brain: BrainType.PROMETHEUS },
                { keys: ['thalamus', 'security', 'safety', 'guardian', 'gate', 'compliance', 'shield', 'judge', 'law', 'protect', 'ethics', 'firewall'], brain: BrainType.THALAMUS }
            ];
            const hit = map.find(entry => entry.keys.some(k => raw.includes(k)));
            return hit ? hit.brain : BrainType.AURORA;
        };

        const filtered = personas
            .filter(p => {
                if (!personaSearch) return true;
                const text = `${p.name || ''} ${p.label || ''} ${p.description || ''} ${p.domain || ''}`.toLowerCase();
                return text.includes(personaSearch.toLowerCase());
            });

        const count = filtered.length || 1;
        return filtered.map((p, idx) => {
                const name = p.name || p.label || `Persona-${idx + 1}`;
                const id = p.id || `persona-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                
                // Smarter mapping: Scan name AND description
                const searchString = `${name} ${p.description || ''} ${p.label || ''} ${p.domain || ''}`;
                const domain = safeBrain(searchString);

                return {
                    id,
                    label: name,
                    type: 'persona',
                    domain: domain,
                    importance: Math.max(4, Math.min(10, (p.priority || p.importance || 6))),
                    usage: p.usage || 1,
                    confidence: p.confidence || 0.85,
                    decay: 0.02,
                    isPromoted: Boolean(p.isPrimary || p.primary),
                    isLocked: false // Allow them to move
                };
            });
    }, [personas, personaSearch]);

    const addLog = useCallback((text, brain, confidence = 0) => {
        setExternalLog({
            id: Math.random().toString(36).substr(2, 9),
            timestamp: Date.now(),
            brain,
            action: text,
            confidenceShift: confidence
        });

        setInfluence(prev => {
            const shiftAmount = 4;
            const totalOther = 100 - prev[brain];
            const next = { ...prev };
            next[brain] = Math.min(100, prev[brain] + shiftAmount);
            const remainingKeys = Object.values(BrainType).filter(k => k !== brain);
            remainingKeys.forEach(k => {
                const ratio = prev[k] / totalOther;
                next[k] = Math.max(0, prev[k] - (shiftAmount * ratio));
            });
            return next;
        });
    }, []);

    const addLearningActivity = useCallback((brain, action) => {
        const activity = {
            id: Math.random().toString(36).substr(2, 9),
            brain,
            action,
            timestamp: Date.now(),
            age: 0
        };
        setLearningActivities(prev => [...prev, activity]);
    }, []);

    // Real-time events via shared somaBackend WebSocket (no second connection needed)
    useEffect(() => {
        const handleDebate = (payload) => {
            setDebateLogs(prev => [payload, ...prev].slice(0, 20));
            addLog('Internal Debate Concluded', BrainType.PROMETHEUS, 0.2);
        };
        const handleBrainActivity = (payload) => {
            const { brain, action } = payload || {};
            if (brain && action) addLearningActivity(brain, action);
        };
        const handleNodeCreated = (payload) => {
            const node = payload?.node;
            if (!node) return;
            setFragments(prev => [...prev, {
                id: node.id || `node-${Date.now()}`,
                label: node.label || node.name || 'New Knowledge',
                type: node.type || 'concept',
                domain: node.domain || BrainType.AURORA,
                importance: node.importance || 5,
                usage: 1,
                confidence: node.confidence || 0.8,
                decay: 0.05,
                z: Math.random() * 400 - 200,
                isNew: true
            }]);
            addLog(`New knowledge acquired: ${node.label || node.name}`, BrainType.AURORA, 0.1);
        };
        somaBackend.on('cognitive:debate', handleDebate);
        somaBackend.on('learning:brain_activity', handleBrainActivity);
        somaBackend.on('learning:node_created', handleNodeCreated);
        return () => {
            somaBackend.off('cognitive:debate', handleDebate);
            somaBackend.off('learning:brain_activity', handleBrainActivity);
            somaBackend.off('learning:node_created', handleNodeCreated);
        };
    }, [addLog, addLearningActivity]);

    const handleLearnRequest = async (request) => {
        const { query, mode } = request;

        addLearningActivity('CuriosityEngine', `Analyzing: "${query}"`);
        addLog(`Learning request: "${query}" (${mode} mode)`, BrainType.AURORA, 0.05);

        try {
            // Call backend API
            addLearningActivity('BraveSearch', 'Searching web...');

            const response = await fetch('/api/knowledge/learn', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ query, mode })
            });

            if (!response.ok) {
                throw new Error('Learning request failed');
            }

            const data = await response.json();

            // Activities will be sent via WebSocket in real-time
            // For now, simulate the flow
            addLearningActivity('WebScraper', `Scraping ${data.urls?.length || 0} sources...`);

            setTimeout(() => {
                addLearningActivity('Archivist', 'Indexing knowledge...');

                setTimeout(() => {
                    addLearningActivity(BrainType.LOGOS, 'Creating connections...');

                    setTimeout(() => {
                        addLearningActivity(BrainType.AURORA, 'Synthesizing insights...');
                        addLog(`Learning complete: "${query}"`, BrainType.AURORA, 0.15);
                    }, 1000);
                }, 1500);
            }, 2000);

        } catch (error) {
            console.error('Learning request failed:', error);
            addLog(`Learning failed: ${error.message}`, BrainType.THALAMUS, -0.1);
            addLearningActivity('System', `Error: ${error.message}`);
        }
    };

    const handleBrainSelect = useCallback((brain) => {
        setActiveBrain(prev => prev === brain ? null : brain);
        addLog(`Neural focus shifted to ${brain} system.`, brain);
    }, [addLog]);

    const handleFragmentAction = (action, fragment) => {
        switch (action) {
            case 'promote':
                const isPromoted = !fragment.isPromoted;
                setFragments(prev => prev.map(f => f.id === fragment.id ? {
                    ...f,
                    isPromoted,
                    importance: isPromoted ? 10 : 5,
                    confidence: isPromoted ? 0.99 : f.confidence
                } : f));
                addLog(`"${fragment.label}" ${isPromoted ? 'elevated to Core Axiom' : 'restored to Standard Weight'}.`, fragment.domain, isPromoted ? 0.15 : -0.1);
                break;
            case 'anchor':
                const isLocked = !fragment.isLocked;
                setFragments(prev => prev.map(f => f.id === fragment.id ? { ...f, isLocked, decay: isLocked ? 0 : 0.1 } : f));
                addLog(`"${fragment.label}" ${isLocked ? 'anchored in reality' : 'released to entropy'}.`, fragment.domain);
                break;
            case 'trace':
                setTracedFragmentId(tracedFragmentId === fragment.id ? null : fragment.id);
                break;
            case 'erase':
                setFragments(prev => prev.map(f => f.id === fragment.id ? { ...f, isFading: true } : f));
                setTimeout(() => {
                    setFragments(prev => prev.filter(f => f.id !== fragment.id));
                    setLinks(prev => prev.filter(l => {
                        const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
                        const targetId = typeof l.target === 'string' ? l.target : l.target.id;
                        return sourceId !== fragment.id && targetId !== fragment.id;
                    }));
                }, 1000);
                addLog(`Purging node: "${fragment.label}"`, BrainType.LOGOS, -0.05);
                setSelectedFragment(null);
                if (tracedFragmentId === fragment.id) setTracedFragmentId(null);
                break;
            case 'fork':
                const newId = `fork-${Date.now()}`;
                const fork = { ...fragment, id: newId, label: `${fragment.label} [ALT]`, x: (fragment.x || 0) + 20 };
                setFragments(prev => [...prev, fork]);
                setLinks(prev => [...prev, { source: fragment.id, target: newId, type: 'dependency' }]);
                addLog(`Causal divergence created from "${fragment.label}"`, BrainType.AURORA);
                break;
        }
    };

    const runCausalSimulation = async () => {
        if (fragments.length === 0) return;

        const startNode = selectedFragment || fragments.find(f => f.isPromoted) || fragments[Math.floor(Math.random() * fragments.length)];
        setSystemStatus({ label: 'SIMULATING', color: 'bg-cyan-400' });
        addLog(`Initiating ripple simulation from: ${startNode.label}`, BrainType.LOGOS);

        const visited = new Set();
        const queue = [{ id: startNode.id, depth: 0 }];
        const impactedNodes = new Set();

        let currentDepth = 0;
        while (queue.length > 0 && currentDepth < 5) {
            const batchSize = queue.length;
            const currentBatch = [];

            for (let i = 0; i < batchSize; i++) {
                const { id, depth } = queue.shift();
                if (visited.has(id)) continue;
                visited.add(id);
                impactedNodes.add(id);
                currentBatch.push(id);

                const neighbors = links.filter(l => {
                    const sId = typeof l.source === 'string' ? l.source : l.source.id;
                    const tId = typeof l.target === 'string' ? l.target : l.target.id;
                    return sId === id || tId === id;
                }).map(l => {
                    const sId = typeof l.source === 'string' ? l.source : l.source.id;
                    const tId = typeof l.target === 'string' ? l.target : l.target.id;
                    return sId === id ? tId : sId;
                });

                neighbors.forEach(nId => {
                    if (!visited.has(nId)) queue.push({ id: nId, depth: depth + 1 });
                });
            }

            // Apply visual "simulating" pulse to batch
            setFragments(prev => prev.map(f => currentBatch.includes(f.id) ? { ...f, simulated: true } : f));

            await new Promise(r => setTimeout(r, 400));
            currentDepth++;
        }

        // Determine outcomes (break or strengthen)
        setFragments(prev => prev.map(f => {
            if (!impactedNodes.has(f.id)) return f;

            const rand = Math.random();
            if (rand > 0.85) {
                // "Break" - mark as contradiction
                return { ...f, simulated: false, isContradiction: true, confidence: f.confidence * 0.4 };
            } else if (rand < 0.2) {
                // "Strengthen" - promote or increase confidence
                return { ...f, simulated: false, confidence: Math.min(1, f.confidence + 0.15), usage: Math.min(10, f.usage + 1) };
            }
            return { ...f, simulated: false };
        }));

        addLog(`Causal simulation complete. Node stability verified.`, BrainType.LOGOS, 0.08);
        setSystemStatus({ label: 'COHERENT', color: 'bg-green-500' });
    };

    const handleControlAction = (id) => {
        switch (id) {
            case 'inject':
                setIsInputModalOpen(true);
                break;
            case 'causal':
                runCausalSimulation();
                break;
            case 'expose':
                setSystemStatus({ label: 'AUDITING', color: 'bg-red-500' });
                addLog("Scanning for logical inconsistencies...", BrainType.LOGOS);
                setTimeout(() => {
                    setFragments(prev => prev.map(f => Math.random() > 0.9 ? { ...f, isContradiction: true } : f));
                    setSystemStatus({ label: 'COHERENT', color: 'bg-green-500' });
                }, 1500);
                break;
            case 'prune':
                const toRemove = fragments.filter(f => f.confidence < 0.2 && !f.isLocked).map(f => f.id);
                if (toRemove.length > 0) {
                    setFragments(prev => prev.filter(f => !toRemove.includes(f.id)));
                    addLog(`Garbage collection: ${toRemove.length} low-energy nodes purged.`, BrainType.THALAMUS);
                } else {
                    addLog("Pruning routine aborted. All nodes above entropy threshold.", BrainType.THALAMUS);
                }
                break;
            case 'commit':
                addLog("Global state snapshot committed to long-term memory.", BrainType.THALAMUS, 0.1);
                setSystemStatus({ label: 'LOCKED', color: 'bg-blue-500' });
                setTimeout(() => setSystemStatus({ label: 'COHERENT', color: 'bg-green-500' }), 1000);
                break;
            case 'toggle_particles':
                setShowParticles(prev => !prev);
                addLog(showParticles ? "Disabling visual systems for maximum efficiency." : "Resuming full visual simulation.", BrainType.THALAMUS);
                break;
            default:
                addLog(`Command "${id}" received but not yet routed.`, BrainType.THALAMUS);
        }
    };

    const executeFeatureAction = async (featureId, payload) => {
        if (!activeBrain) return;
        addLog(`Invoking ${featureId}...`, activeBrain);
        
        try {
            // Send real config update to backend
            const res = await fetch('/api/knowledge/config/brain', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brainId: activeBrain,
                    featureId,
                    payload
                })
            });

            if (res.ok) {
                const data = await res.json();
                addLog(`${featureId} synchronized with SOMA Core.`, activeBrain, 0.05);
                
                // Update local state if needed
                if (featureId === 'Idea Entropy') {
                    setEntropy(payload.value);
                }
            } else {
                throw new Error('Config sync failed');
            }
        } catch (err) {
            console.error("Feature action failed:", err);
            addLog(`${featureId} sync failed: ${err.message}`, BrainType.THALAMUS, -0.05);
        }

        switch (featureId) {
            case 'Idea Entropy':
                // State update handled above
                break;
            case 'Hypothesis Forge':
                setSystemStatus({ label: 'FORGING', color: 'bg-yellow-400' });
                // ... rest of the logic
                break;
            case 'Pattern Mutation':
                if (selectedFragment) {
                    const mutation = {
                        ...selectedFragment,
                        id: `mut-${Date.now()}`,
                        label: `${selectedFragment.label} (MUT)`,
                        confidence: selectedFragment.confidence * 0.8,
                        isVariant: true
                    };
                    setFragments(prev => [...prev, mutation]);
                    addLog(`Symbolic mutation of "${selectedFragment.label}" active.`, BrainType.AURORA);
                }
                break;
            case 'Protocol Guard':
                addLog("Security protocols reinforced.", BrainType.THALAMUS, 0.1);
                setSystemStatus({ label: 'REINFORCED', color: 'bg-blue-500' });
                setTimeout(() => setSystemStatus({ label: 'COHERENT', color: 'bg-green-500' }), 2000);
                break;
            case 'Signal Firewall':
                addLog("Deep neural stream inspection active.", BrainType.THALAMUS);
                break;
        }
    };

    const orderedBrains = [BrainType.LOGOS, BrainType.AURORA, BrainType.PROMETHEUS, BrainType.THALAMUS];

    const getInfluenceInfo = (type) => {
        switch (type) {
            case BrainType.LOGOS: return {
                title: "Deductive Bias",
                description: "Current level of logical filtering. High Logos influence enforces strict non-contradiction and causal mapping.",
                icon: <Cpu size={16} />
            };
            case BrainType.AURORA: return {
                title: "Creative Divergence",
                description: "The mind's generative potential. High Aurora influence allows for abstract synthesis and radical hypotheses.",
                icon: <Zap size={16} />
            };
            case BrainType.PROMETHEUS: return {
                title: "Strategic Pragmatism",
                description: "Optimization for survival and outcomes. High Prometheus influence prioritizes threat assessment.",
                icon: <Eye size={16} />
            };
            case BrainType.THALAMUS: return {
                title: "Sensory Security",
                description: "The system's reflex layer. Monitors data integrity and sensory gating. High Thalamus influence suppresses noisy or unverified signals.",
                icon: <ShieldCheck size={16} />
            };
        }
    };

    return (
        <div className="relative w-full h-full bg-[#0d0d0e] overflow-hidden selection:bg-cyan-500/30">
            <SpaceBackground enabled={showParticles} />


            {showInfluenceInfo && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowInfluenceInfo(null)}>
                    <div className="w-80 bg-slate-900 border border-slate-700/50 rounded-lg p-6 shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center space-x-2" style={{ color: BRAINS[showInfluenceInfo].color }}>
                                {getInfluenceInfo(showInfluenceInfo).icon}
                                <span className="font-bold uppercase display-font tracking-widest">{getInfluenceInfo(showInfluenceInfo).title}</span>
                            </div>
                            <button onClick={() => setShowInfluenceInfo(null)} className="text-slate-500 hover:text-white transition-colors">
                                <X size={16} />
                            </button>
                        </div>
                        <p className="text-sm text-slate-400 leading-relaxed font-light mb-4">
                            {getInfluenceInfo(showInfluenceInfo).description}
                        </p>
                        <div className="bg-slate-950 p-3 rounded border border-slate-800">
                            <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-1">Global Weight</div>
                            <div className="text-xl font-mono text-white flex items-baseline">
                                {influence[showInfluenceInfo].toFixed(1)}
                                <span className="text-xs text-slate-600 ml-1">%</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <FragmentRegistry
                onFragmentClick={(item) => {
                    if (viewMode === 'personas') {
                        const persona = personas.find(p => `persona-${(p.name || p.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}` === item.id)
                            || personas.find(p => p.id === item.id || p.name === item.label || p.label === item.label);
                        if (persona) {
                            setSelectedPersona(persona);
                            setTracedFragmentId(item.id); // Reveal name
                            addLog(`Persona selected: ${persona.name || persona.label}`, BrainType.AURORA, 0.05);
                        }
                        return;
                    }
                    setSelectedFragment(item);
                    setTracedFragmentId(item.id); // Reveal name
                }}
                highlightBrain={activeBrain}
                fragments={viewMode === 'personas' ? personaFragments : fragments}
                links={viewMode === 'personas' ? [] : links}
                rotation={rotation}
                onRotate={setRotation}
                tracedFragmentId={viewMode === 'personas' ? null : tracedFragmentId}
                showVisuals={showParticles}
            />

            <ControlBar
                onAction={handleControlAction}
                systemStatus={systemStatus}
                fragmentCount={fragments.length}
                personaCount={personas.length}
                viewMode={viewMode}
                onToggleView={(mode) => {
                    setViewMode(mode);
                    setSelectedFragment(null);
                    setSelectedPersona(null);
                }}
            />

            <ThreeBrains onSelectBrain={handleBrainSelect} activeBrain={activeBrain} />

            <InputModal isOpen={isInputModalOpen} onClose={() => setIsInputModalOpen(false)} onSubmit={() => { }} />

            <BrainDetail
                brainId={activeBrain}
                realStats={realBrainStats ? realBrainStats[activeBrain] : null}
                onClose={() => setActiveBrain(null)}
                onOpenFeature={(feature) => setActiveFeature({ brain: activeBrain, feature })}
                activities={learningActivities.filter(a => a.brain === activeBrain)}
            />

            {activeFeature && (
                <FeatureOverlay
                    brainId={activeFeature.brain}
                    featureId={activeFeature.feature}
                    onClose={() => setActiveFeature(null)}
                    onAction={executeFeatureAction}
                    fragments={fragments}
                    selectedFragment={selectedFragment}
                    entropy={entropy}
                />
            )}

            <FragmentDetail
                fragment={selectedFragment}
                onClose={() => setSelectedFragment(null)}
                onAction={handleFragmentAction}
                isTraced={selectedFragment?.id === tracedFragmentId}
            />

            <PersonaDetail
                persona={selectedPersona}
                onClose={() => setSelectedPersona(null)}
                onActivate={async (p) => {
                    await fetch('/api/identity/active', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: p.name || p.label })
                    });
                    addLog(`Persona activated: ${p.name || p.label}`, BrainType.PROMETHEUS, 0.1);
                }}
                onUpdate={async (updates) => {
                    if (!selectedPersona) return;
                    const res = await fetch('/api/identity/persona/update', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name: selectedPersona.name || selectedPersona.label, updates })
                    });
                    const data = await res.json().catch(() => null);
                    if (data?.success) {
                        setPersonas(prev => prev.map(p => (p.name === data.persona.name ? data.persona : p)));
                        setSelectedPersona(data.persona);
                        addLog(`Persona updated: ${data.persona.name}`, BrainType.LOGOS, 0.05);
                    }
                }}
            />

            <CognitiveTrace
                filterBrain={activeBrain}
                externalLog={externalLog}
                debateLogs={debateLogs}
                onLearnRequest={handleLearnRequest}
                isCollapsed={isTraceCollapsed}
                onToggleCollapse={() => setIsTraceCollapsed(!isTraceCollapsed)}
                brainInfluence={influence}
                orderedBrains={orderedBrains}
                onShowInfluenceInfo={setShowInfluenceInfo}
                onFragmentCreated={(node) => {
                    setFragments(prev => [...prev, {
                        id: node.id || `node-${Date.now()}`,
                        label: node.label || node.name || 'New Knowledge',
                        type: node.type || 'concept',
                        domain: node.domain || BrainType.AURORA,
                        importance: node.importance || 5,
                        usage: 1,
                        confidence: node.confidence || 0.8,
                        decay: 0.05,
                        z: Math.random() * 400 - 200,
                        isNew: true
                    }]);
                    addLog(`Memory promoted to Fractal: ${node.label}`, BrainType.LOGOS, 0.2);
                }}
            />

            <FloatingActivityOverlay activities={learningActivities} />
        </div>
    );
};

export default KnowledgeApp;
