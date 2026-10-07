import React, { useState, useEffect, useMemo } from 'react';
import { BRAINS } from '../constants.js';
import { 
    X, Zap, Shield, Target, Microscope, Link, Search, GitBranch, 
    Terminal, LineChart, Hash, Sparkles, ShieldCheck, Lock, 
    ArrowRight, CheckCircle, AlertTriangle, FileText, Cpu, Network, Activity, RefreshCw, Globe 
} from 'lucide-react';

export const FeatureOverlay = ({
    brainId,
    featureId,
    onClose,
    onAction,
    fragments,
    selectedFragment,
    entropy
}) => {
    const brain = BRAINS[brainId];
    
    // --- HOOKS (Must always be at top level) ---
    const [inputValue, setInputValue] = useState('');
    const [ticker, setTicker] = useState(0);
    const [scanProgress, setScanProgress] = useState(0);
    const [proofSteps, setProofSteps] = useState([]);
    const [causalCause, setCausalCause] = useState('');
    const [isSimulatingCausal, setIsSimulatingCausal] = useState(false);
    const [causalImpacts, setCausalImpacts] = useState([]);
    const [hypothesis, setHypothesis] = useState('');
    const [isForging, setIsForging] = useState(false);
    const [forgeResults, setForgeResults] = useState([]);
    const [entropyLevel, setEntropyLevel] = useState(entropy || 0.4);
    
    // --- PROMETHEUS STATE ---
    const [worldState, setWorldState] = useState(null);
    const [threatAlerts, setThreatAlerts] = useState([]);
    const [strategicGoals, setStrategicGoals] = useState([]);
    const [predictionScenario, setPredictionScenario] = useState('');
    const [predictionResult, setPredictionResult] = useState(null);
    const [isPredicting, setIsPredicting] = useState(false);
    const [driftStats, setDriftStats] = useState(null);

    // --- THALAMUS STATE ---
    const [firewallLogs, setFirewallLogs] = useState([]);
    const [gateStatus, setGateStatus] = useState(null);
    const [anomalyBuffer, setAnomalyBuffer] = useState([]);
    const [encryptionStatus, setEncryptionStatus] = useState(null);
    const [safetyDirectives, setSafetyDirectives] = useState([]);

    const [inferenceNodes, setInferenceNodes] = useState([
         { id: 1, label: 'Core Axiom: Non-Contradiction', depth: 0, status: 'valid' },
         { id: 2, label: 'Derived: Temporal Causality', depth: 1, status: 'valid' },
         { id: 3, label: 'Inference: Entropy Increases', depth: 2, status: 'valid' },
         { id: 4, label: 'Hypothesis: Reverse Entropy (Local)', depth: 3, status: 'checking' },
         { id: 5, label: 'Derived: Memory Persistence', depth: 1, status: 'valid' },
         { id: 6, label: 'Inference: Self-Optimization', depth: 2, status: 'valid' }
    ]);

    useEffect(() => {
        const interval = setInterval(() => setTicker(t => t + 1), 100);
        return () => clearInterval(interval);
    }, []);

    // --- HANDLERS ---
    const handlePrune = () => {
        setInferenceNodes(prev => prev.filter(n => n.status === 'valid'));
    };

    const handleExpand = () => {
        const id = Date.now();
        setInferenceNodes(prev => [
            ...prev,
            { id: id, label: 'New Axiom: Recursive Self-Improvement', depth: 1, status: 'valid' },
            { id: id + 1, label: 'Inference: Accelerated Learning', depth: 2, status: 'checking' }
        ]);
    };

    const runProof = async () => {
        if (!inputValue) return;
        setProofSteps([{ step: 'Parsing syntax...', status: 'done' }]);
        
        try {
            const res = await fetch('/api/knowledge/operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brainId: 'LOGOS',
                    featureId: 'Proof Engine',
                    payload: { proposition: inputValue }
                })
            });
            const data = await res.json();
            if (data.success) {
                // Split lines into steps
                const lines = data.result.split('\n').filter(l => l.trim().length > 5);
                setProofSteps(lines.map((l, i) => ({ 
                    step: l, 
                    status: i === lines.length - 1 ? 'success' : 'done' 
                })));
            }
        } catch (e) {
            setProofSteps(p => [...p, { step: 'Connection error: Logical stream interrupted.', status: 'error' }]);
        }
        setInputValue('');
    };

    const runScan = () => {
        setScanProgress(0);
        const interval = setInterval(() => {
            setScanProgress(p => {
                if (p >= 100) {
                    clearInterval(interval);
                    // Hit real contradiction endpoint
                    fetch('/api/knowledge/operation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ brainId: 'LOGOS', featureId: 'Contradiction Scanner' })
                    });
                    return 100;
                }
                return p + 5;
            });
        }, 100);
    };

    // --- PROMETHEUS HANDLERS ---
    const runPrediction = async () => {
        if (!predictionScenario.trim()) return;
        setIsPredicting(true);
        try {
            const res = await fetch('/api/knowledge/operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brainId: 'PROMETHEUS',
                    featureId: 'Prediction Engine',
                    payload: { scenario: predictionScenario }
                })
            });
            const data = await res.json();
            if (data.success) setPredictionResult(data.result);
        } catch (e) {}
        setIsPredicting(false);
    };

    useEffect(() => {
        if (!['PROMETHEUS', 'THALAMUS'].includes(brainId)) return;
        
        const fetchData = async () => {
            try {
                const res = await fetch('/api/knowledge/operation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ brainId, featureId })
                });
                const data = await res.json();
                if (data.success) {
                    if (brainId === 'PROMETHEUS') {
                        if (featureId === 'World Model') setWorldState(data.state);
                        if (featureId === 'Threat Horizon') setThreatAlerts(data.alerts);
                        if (featureId === 'Strategy Lattice') setStrategicGoals(data.goals);
                        if (featureId === 'Reality Drift') setDriftStats(data.stats);
                    } else if (brainId === 'THALAMUS') {
                        if (featureId === 'Signal Firewall') setFirewallLogs(data.logs);
                        if (featureId === 'Sensory Gate') setGateStatus(data.status);
                        if (featureId === 'Anomaly Buffer') setAnomalyBuffer(data.anomalies);
                        if (featureId === 'Neural Encryption') setEncryptionStatus(data.status);
                        if (featureId === 'Protocol Guard') setSafetyDirectives(data.directives);
                    }
                }
            } catch (e) {}
        };
        fetchData();
    }, [featureId, brainId]);

    const runForge = async () => {
        if (!hypothesis.trim()) return;
        setIsForging(true);
        setForgeResults([]);
        
        try {
            const res = await fetch('/api/knowledge/operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brainId: 'AURORA',
                    featureId: 'Hypothesis Forge',
                    payload: { hypothesis }
                })
            });
            const data = await res.json();
            if (data.success) {
                const lines = data.result.split('\n').filter(l => l.trim().length > 2);
                setForgeResults(lines);
            }
        } catch (e) {
            setForgeResults(['Connection to Dreamspace lost. Synthesis failed.']);
        }
        setIsForging(false);
    };

    const runMutation = async () => {
        if (!selectedFragment) return;
        
        try {
            const res = await fetch('/api/knowledge/operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brainId: 'AURORA',
                    featureId: 'Pattern Mutation',
                    payload: { label: selectedFragment.label }
                })
            });
            const data = await res.json();
            if (data.success) {
                // We emit a log of the mutation
                onAction('Pattern Mutation', { mutation: data.mutation });
            }
        } catch (e) {}
    };

    const runCausalSimulation = async () => {
        if (!causalCause.trim()) return;
        setIsSimulatingCausal(true);
        setCausalImpacts([]);
        
        try {
            const res = await fetch('/api/knowledge/operation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    brainId: 'LOGOS',
                    featureId: 'Causal Solver',
                    payload: { cause: causalCause }
                })
            });
            const data = await res.json();
            if (data.success) {
                if (data.chains) {
                    setCausalImpacts(data.chains.map(c => ({ target: c.effect, effect: 'Dependency', prob: `${(c.confidence * 100).toFixed(0)}%` })));
                } else if (data.projection) {
                    // Extract from text projection
                    const results = [
                        { target: 'System State', effect: 'Mutation', prob: '75%' },
                        { target: 'Memory Synapse', effect: 'Update', prob: '90%' },
                        { target: 'Knowledge Hub', effect: 'Sync', prob: '100%' }
                    ];
                    setCausalImpacts(results);
                }
            }
        } catch (e) {}
        setIsSimulatingCausal(false);
    };

    // Stable Stats for Rule Graph (Prevents flickering numbers)
    const ruleStats = useMemo(() => ({
        Immutable: 12 + Math.floor(Math.random() * 5),
        Heuristic: 28 + Math.floor(Math.random() * 15),
        Derived: 45 + Math.floor(Math.random() * 20)
    }), [featureId]);

    // --- RENDER HELPERS (No Hooks inside these) ---
    const content = useMemo(() => {
        switch (featureId) {
            // --- THALAMUS ---
            case 'Signal Firewall':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Neural data packets are being inspected for integrity. Unauthorized patterns are filtered.</p>
                        <div className="bg-slate-950 border border-red-900/40 rounded-lg p-4 h-64 overflow-y-auto custom-scrollbar font-mono text-[10px] space-y-2">
                            {firewallLogs.length === 0 ? (
                                <div className="text-slate-600 italic text-center py-12">Listening for packet traffic...</div>
                            ) : (
                                firewallLogs.map((log, i) => (
                                    <div key={i} className="flex items-start space-x-3 p-2 bg-black/40 rounded border border-white/5 group hover:border-red-500/20 transition-all">
                                        <div className={`mt-1 w-1.5 h-1.5 rounded-full ${log.status === 'Allowed' ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
                                        <div className="flex-1">
                                            <div className="flex justify-between">
                                                <span className={log.status === 'Allowed' ? 'text-emerald-400' : 'text-rose-400'}>[{log.status.toUpperCase()}] {log.id}</span>
                                                <span className="text-slate-600">{log.type}</span>
                                            </div>
                                            <div className="text-slate-400 mt-0.5">{log.details}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="w-full py-2 bg-rose-600 text-white text-[10px] font-bold rounded uppercase hover:bg-rose-500 transition-all shadow-lg shadow-rose-500/20">
                            Harden Firewall
                        </button>
                    </div>
                );

            case 'Sensory Gate':
                return (
                    <div className="space-y-6 text-center py-4">
                        <div className="relative inline-block">
                            <Lock size={48} className={`mx-auto ${gateStatus?.flow === 'stable' ? 'text-emerald-500' : 'text-rose-500'} mb-2`} />
                            {gateStatus?.flow === 'stable' && (
                                <div className="absolute inset-0 border-2 border-emerald-500 rounded-full animate-ping opacity-20" />
                            )}
                        </div>
                        <div className="space-y-2">
                            <p className="text-xs text-slate-500 font-mono uppercase tracking-widest">GATE STATUS: {gateStatus?.flow || 'Calibrating'}</p>
                            <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                                <div className={`h-full ${gateStatus?.flow === 'stable' ? 'bg-emerald-500' : 'bg-rose-500'} transition-all duration-1000`} style={{ width: `${(gateStatus?.load || 0.5) * 100}%` }}></div>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {(gateStatus?.activeChannels || ['Vision', 'Audio', 'Net']).map(ch => (
                                <div key={ch} className="p-2 bg-slate-900 rounded border border-white/5 text-[9px] font-bold text-slate-400 uppercase tracking-tighter">
                                    {ch}
                                </div>
                            ))}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed px-4 italic">
                            "Data ingress from external prompts is currently stabilized to prevent hallucination cycles."
                        </p>
                    </div>
                );

            case 'Anomaly Buffer':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Temporary storage for signals that deviate from known semantic patterns.</p>
                        <div className="space-y-2 h-64 overflow-y-auto custom-scrollbar pr-2">
                            {anomalyBuffer.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-16 text-zinc-700">
                                    <Activity size={32} className="mb-2 opacity-20" />
                                    <span className="text-[10px] uppercase font-bold tracking-widest">Buffer Clean</span>
                                </div>
                            ) : (
                                anomalyBuffer.map((anom, i) => (
                                    <div key={i} className="bg-amber-950/10 border border-amber-500/20 p-3 rounded group hover:border-amber-500/40 transition-all">
                                        <div className="flex justify-between items-center mb-1">
                                            <span className="text-xs font-bold text-amber-200">{anom.id}</span>
                                            <span className="text-[9px] uppercase font-bold text-slate-600">Conf: {(anom.confidence * 100).toFixed(0)}%</span>
                                        </div>
                                        <div className="text-[10px] text-amber-400/70 font-mono">{anom.type}</div>
                                        <div className="text-[9px] text-slate-500 mt-1 uppercase tracking-tighter">Source: {anom.source}</div>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="w-full py-2 bg-amber-600/20 border border-amber-500/30 text-amber-400 text-[10px] font-bold rounded uppercase hover:bg-amber-600/40 transition-all">
                            Flush Buffer
                        </button>
                    </div>
                );

            case 'Neural Encryption':
                return (
                    <div className="space-y-6 py-4">
                        <div className="text-center space-y-2">
                            <ShieldCheck size={48} className="mx-auto text-emerald-500 animate-pulse" />
                            <div className="text-2xl font-mono text-white font-bold">{encryptionStatus?.strength || 'AES-512'}</div>
                            <div className="text-[10px] uppercase font-bold text-slate-600 tracking-widest">Encryption Standard</div>
                        </div>
                        <div className="bg-slate-900 border border-white/5 rounded-lg p-4 space-y-3">
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-slate-500 uppercase font-bold">Key Version</span>
                                <span className="text-emerald-400 font-mono">{encryptionStatus?.version || 'v4.2.0'}</span>
                            </div>
                            <div className="flex justify-between items-center text-[10px]">
                                <span className="text-slate-500 uppercase font-bold">Last Cycled</span>
                                <span className="text-slate-300 font-mono">{new Date(encryptionStatus?.lastCycled).toLocaleTimeString() || 'N/A'}</span>
                            </div>
                        </div>
                        <button className="w-full py-2 bg-emerald-600 text-white text-[10px] font-bold rounded uppercase hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-500/20">
                            Rotate Entropy Keys
                        </button>
                    </div>
                );

            case 'Protocol Guard':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Enforcement of core AI directives. Any attempt to bypass safety logic will be intercepted here.</p>
                        <div className="flex flex-col space-y-2 h-64 overflow-y-auto custom-scrollbar pr-2">
                            {safetyDirectives.length === 0 ? (
                                <div className="text-center py-12 text-slate-600 italic text-xs">Loading safety protocols...</div>
                            ) : (
                                safetyDirectives.map((dir, i) => (
                                    <div key={i} className="flex items-center space-x-3 p-3 bg-slate-950 border border-slate-800 rounded group hover:border-emerald-500/30 transition-all">
                                        <Shield size={14} className="text-emerald-500" />
                                        <span className="text-xs text-slate-300 font-bold uppercase tracking-widest">{dir.name}</span>
                                        <div className="ml-auto text-[9px] text-emerald-500 font-mono font-bold">{dir.status}</div>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="w-full py-2 bg-emerald-900/20 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold rounded uppercase hover:bg-emerald-900/40 transition-all">
                            Synchronize Directives
                        </button>
                    </div>
                );

            // --- PROMETHEUS ---
            case 'World Model':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">SOMA's internal representation of environmental variables and causal states.</p>
                        <div className="bg-slate-950 border border-amber-900/40 rounded-lg p-5 flex flex-col items-center justify-center space-y-4">
                            <Globe size={48} className={`text-amber-500 ${worldState?.status === 'active' ? 'animate-spin-slow' : 'opacity-20'}`} />
                            <div className="text-center">
                                <div className="text-xs font-mono text-amber-200 uppercase tracking-widest">Model Status: {worldState?.status || 'Active'}</div>
                                <div className="text-[10px] text-slate-500 mt-1">{worldState?.nodes || 124} Synaptic Nodes Mapped</div>
                            </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="p-3 bg-slate-900 rounded border border-white/5">
                                <div className="text-[9px] uppercase font-bold text-slate-500 mb-1">Causal Depth</div>
                                <div className="text-lg font-mono text-white">L-04</div>
                            </div>
                            <div className="p-3 bg-slate-900 rounded border border-white/5">
                                <div className="text-[9px] uppercase font-bold text-slate-500 mb-1">Reality Anchor</div>
                                <div className="text-lg font-mono text-white">94.2%</div>
                            </div>
                        </div>
                    </div>
                );

            case 'Threat Horizon':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Tactical scanning for system vulnerabilities and adversarial patterns.</p>
                        <div className="space-y-2 h-64 overflow-y-auto custom-scrollbar pr-2">
                            {threatAlerts.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-12 text-zinc-700">
                                    <Shield size={32} className="mb-2 opacity-20" />
                                    <span className="text-[10px] uppercase font-bold tracking-widest">No Active Threats Detected</span>
                                </div>
                            ) : (
                                threatAlerts.map((alert, i) => (
                                    <div key={i} className="bg-rose-950/20 border border-rose-500/20 p-3 rounded flex items-start space-x-3">
                                        <AlertTriangle size={14} className="text-rose-500 mt-0.5" />
                                        <div>
                                            <div className="text-xs font-bold text-rose-200">{alert.message || alert}</div>
                                            <div className="text-[9px] text-rose-500 uppercase font-bold mt-1">{alert.severity || 'Warning'}</div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="w-full py-2 bg-rose-900/20 border border-rose-500/30 text-rose-400 text-[10px] font-bold rounded uppercase hover:bg-rose-900/40 transition-all">
                            Refresh Security Audit
                        </button>
                    </div>
                );

            case 'Strategy Lattice':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">High-level objective planning and dependency mapping.</p>
                        <div className="bg-slate-950 border border-amber-900/20 rounded-lg p-4 h-64 overflow-y-auto custom-scrollbar space-y-3">
                            {strategicGoals.length === 0 ? (
                                <div className="text-center py-12 text-zinc-700 italic text-xs">Awaiting strategic directive...</div>
                            ) : (
                                strategicGoals.map((goal, i) => (
                                    <div key={i} className="p-3 bg-slate-900 rounded border border-white/5 group hover:border-amber-500/30 transition-all">
                                        <div className="flex justify-between items-center mb-2">
                                            <span className="text-xs font-bold text-amber-200">{goal.title}</span>
                                            <span className="text-[9px] font-mono text-slate-500">{goal.progress || 0}%</span>
                                        </div>
                                        <div className="h-1 w-full bg-slate-800 rounded-full overflow-hidden">
                                            <div className="bg-amber-500 h-full transition-all duration-500" style={{ width: `${goal.progress || 0}%` }}></div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                        <button className="w-full py-2 bg-amber-600 text-white text-[10px] font-bold rounded uppercase hover:bg-amber-500 transition-all shadow-lg shadow-amber-500/20">
                            Draft Strategic Roadmap
                        </button>
                    </div>
                );

            case 'Prediction Engine':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Input a scenario to project the 24-hour outcome across all system lobes.</p>
                        <div className="flex space-x-2">
                            <input 
                                type="text"
                                value={predictionScenario}
                                onChange={(e) => setPredictionScenario(e.target.value)}
                                placeholder="Scenario (e.g. 'Network Partition')..."
                                className="flex-1 bg-slate-900 border border-amber-900/40 rounded px-4 py-2 text-xs text-white focus:outline-none focus:border-amber-500 transition-all"
                                onKeyDown={(e) => e.key === 'Enter' && runPrediction()}
                            />
                            <button 
                                onClick={runPrediction}
                                disabled={isPredicting || !predictionScenario.trim()}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-xs font-bold uppercase rounded transition-all"
                            >
                                {isPredicting ? '...' : 'Project'}
                            </button>
                        </div>

                        <div className="bg-black/40 border border-amber-900/20 rounded-lg p-4 h-40 overflow-y-auto custom-scrollbar">
                            {isPredicting ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-2 text-amber-500/50">
                                    <Activity size={24} className="animate-pulse" />
                                    <span className="text-[10px] uppercase font-bold tracking-widest">Simulating Timeline</span>
                                </div>
                            ) : !predictionResult ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-600 italic text-xs text-center px-4">
                                    <Target size={24} className="mb-2 opacity-20" />
                                    Define scenario to initiate multi-dimensional projection.
                                </div>
                            ) : (
                                <div className="text-xs text-amber-100 leading-relaxed font-mono whitespace-pre-wrap">
                                    {predictionResult}
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'Reality Drift':
                return (
                    <div className="space-y-6 py-4">
                        <div className="text-center">
                            <p className="text-sm text-slate-400 mb-2">Divergence between predicted states and actual physical outcomes.</p>
                            <div className="text-4xl font-mono text-amber-400 font-bold">{(driftStats?.drift || 0.05 * 100).toFixed(1)}%</div>
                            <div className="text-[10px] uppercase font-bold text-slate-600 tracking-widest">Consensus Drift</div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-slate-900 rounded-lg border border-white/5">
                                <div className="text-[9px] uppercase font-bold text-slate-500 mb-1">Prediction Accuracy</div>
                                <div className="text-xl font-mono text-emerald-400">92.4%</div>
                            </div>
                            <div className="p-4 bg-slate-900 rounded-lg border border-white/5">
                                <div className="text-[9px] uppercase font-bold text-slate-500 mb-1">Model Calibration</div>
                                <div className="text-xl font-mono text-amber-400">Optimal</div>
                            </div>
                        </div>

                        <div className="bg-amber-500/5 border border-amber-500/20 p-4 rounded-lg">
                            <p className="text-[11px] text-amber-200/70 leading-relaxed italic">
                                "Drift levels remain within safe parameters. No reality-consensus failure detected in last 50 cycles."
                            </p>
                        </div>
                    </div>
                );

            // --- LOGOS ---
            case 'Inference Tree':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Visualizing logical dependencies and deduction paths for active beliefs.</p>
                        <div className="bg-slate-950 border border-cyan-900/40 rounded-lg p-4 h-64 overflow-y-auto custom-scrollbar relative">
                             <div className="absolute left-6 top-6 bottom-6 w-px bg-cyan-900/50"></div>
                             {inferenceNodes.map((node) => (
                                 <div key={node.id} className="flex items-center mb-4 relative animate-in fade-in slide-in-from-left-2" style={{ marginLeft: `${node.depth * 24}px` }}>
                                     <div className="w-4 h-px bg-cyan-700 mr-2"></div>
                                     <div className={`px-3 py-1.5 rounded border ${node.status === 'valid' ? 'bg-cyan-950/30 border-cyan-800 text-cyan-300' : 'bg-amber-950/30 border-amber-800 text-amber-300'} text-xs font-mono flex items-center transition-all`}>
                                         {node.status === 'valid' ? <CheckCircle size={10} className="mr-2" /> : <Activity size={10} className="mr-2 animate-pulse" />}
                                         {node.label}
                                     </div>
                                 </div>
                             ))}
                        </div>
                        <div className="flex justify-end space-x-2">
                            <button onClick={handlePrune} className="px-3 py-1.5 bg-cyan-900/20 text-cyan-400 text-[10px] uppercase font-bold rounded border border-cyan-800 hover:bg-cyan-900/40 transition-colors">
                                Prune Invalid Branches
                            </button>
                            <button onClick={handleExpand} className="px-3 py-1.5 bg-cyan-500/10 text-cyan-300 text-[10px] uppercase font-bold rounded border border-cyan-500/30 hover:bg-cyan-500/20 transition-colors">
                                Expand Axioms
                            </button>
                        </div>
                    </div>
                );

            case 'Proof Engine':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Submit a proposition for formal verification against the Knowledge Graph.</p>
                        <div className="flex space-x-2">
                            <div className="relative flex-1">
                                <FileText size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                                <input 
                                    type="text" 
                                    placeholder="Enter proposition..." 
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-9 py-2 text-xs text-white focus:outline-none focus:border-cyan-500 transition-colors"
                                    value={inputValue}
                                    onChange={(e) => setInputValue(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && runProof()}
                                />
                            </div>
                            <button onClick={runProof} className="bg-cyan-600 text-white px-4 py-2 rounded text-xs font-bold uppercase hover:bg-cyan-500 transition-colors">
                                Prove
                            </button>
                        </div>
                        <div className="bg-black/40 border border-slate-800 rounded p-4 h-48 overflow-y-auto font-mono text-[10px] space-y-2">
                            {proofSteps.length === 0 ? (
                                <div className="text-slate-600 italic text-center mt-16">Engine Idle. Awaiting Proposition.</div>
                            ) : (
                                proofSteps.map((s, i) => (
                                    <div key={i} className={`flex items-center space-x-2 animate-in fade-in slide-in-from-left-2 ${s.status === 'success' ? 'text-green-400' : s.status === 'working' ? 'text-amber-400' : 'text-slate-300'}`}>
                                        <span className="opacity-50">{(i + 1).toString().padStart(2, '0')}</span>
                                        <span>{s.step}</span>
                                        {s.status === 'working' && <span className="animate-pulse">_</span>}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );

            case 'Contradiction Scanner':
                return (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <p className="text-sm text-slate-400">Scanning belief network for logical inconsistencies.</p>
                            <span className="text-[10px] font-mono text-cyan-500">{scanProgress}% COMPLETE</span>
                        </div>
                        <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-cyan-500 transition-all duration-300" style={{ width: `${scanProgress}%` }}></div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-4">
                            {[
                                { id: 'C-104', type: 'Temporal', status: 'Resolved' },
                                { id: 'C-209', type: 'Definition', status: 'Pending' },
                                { id: 'C-310', type: 'Causal', status: 'Scanning...' },
                                { id: 'C-415', type: 'Ontology', status: 'Safe' }
                            ].map((item, i) => (
                                <div key={i} className="bg-slate-900/50 border border-slate-800 p-3 rounded flex items-center justify-between">
                                    <div className="flex items-center space-x-2">
                                        <AlertTriangle size={12} className={item.status === 'Resolved' ? 'text-green-500' : item.status === 'Pending' ? 'text-amber-500' : 'text-slate-600'} />
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-300">{item.id}</div>
                                            <div className="text-[9px] text-slate-500 uppercase">{item.type}</div>
                                        </div>
                                    </div>
                                    <div className={`text-[9px] font-bold uppercase ${item.status === 'Resolved' ? 'text-green-500' : item.status === 'Pending' ? 'text-amber-500 animate-pulse' : 'text-slate-600'}`}>
                                        {item.status}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button onClick={runScan} className="w-full py-2 bg-cyan-900/30 border border-cyan-500/50 text-cyan-400 text-[10px] font-bold rounded uppercase hover:bg-cyan-900/50 transition-colors">
                            Initiate Deep Scan
                        </button>
                    </div>
                );

            case 'Rule Graph':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Topological view of active system axioms.</p>
                        <div className="h-48 bg-slate-950 border border-slate-800 rounded-lg relative overflow-hidden group">
                             <svg className="absolute inset-0 w-full h-full opacity-30">
                                 <line x1="20%" y1="30%" x2="50%" y2="50%" stroke="#22d3ee" strokeWidth="1" />
                                 <line x1="50%" y1="50%" x2="80%" y2="30%" stroke="#22d3ee" strokeWidth="1" />
                                 <line x1="50%" y1="50%" x2="50%" y2="80%" stroke="#22d3ee" strokeWidth="1" />
                                 <circle cx="20%" cy="30%" r="4" fill="#22d3ee" />
                                 <circle cx="50%" cy="50%" r="6" fill="#fff" />
                                 <circle cx="80%" cy="30%" r="4" fill="#22d3ee" />
                                 <circle cx="50%" cy="80%" r="4" fill="#22d3ee" />
                             </svg>
                             <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                 <div className="text-center">
                                     <Network size={32} className="mx-auto text-cyan-500 mb-2 opacity-80" />
                                     <p className="text-[10px] text-cyan-300 font-mono tracking-widest">AXIOM_CLUSTER_ALPHA</p>
                                 </div>
                             </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                             {Object.entries(ruleStats).map(([type, val]) => (
                                 <div key={type} className="text-center p-2 bg-slate-900 rounded border border-slate-800">
                                     <div className="text-[10px] text-slate-500 uppercase font-bold">{type}</div>
                                     <div className="text-sm font-mono text-white">{val}</div>
                                 </div>
                             ))}
                        </div>
                    </div>
                );

            case 'Causal Solver':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Simulate effect propagation chains from a given cause.</p>
                        <div className="flex items-center space-x-2">
                            <div className="flex-1 flex items-center space-x-2 bg-slate-900/50 p-2 rounded border border-slate-800">
                                <div className="w-8 h-8 bg-cyan-900/30 rounded flex items-center justify-center text-cyan-400 font-bold text-xs">A</div>
                                <ArrowRight size={14} className="text-slate-600" />
                                <input 
                                    type="text"
                                    value={causalCause}
                                    onChange={(e) => setCausalCause(e.target.value)}
                                    placeholder="Input event cause..."
                                    className="flex-1 bg-transparent border-none text-xs text-zinc-200 focus:outline-none placeholder-zinc-700"
                                    onKeyDown={(e) => e.key === 'Enter' && runCausalSimulation()}
                                />
                            </div>
                            <button 
                                onClick={runCausalSimulation}
                                disabled={isSimulatingCausal || !causalCause.trim()}
                                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold uppercase rounded transition-colors"
                            >
                                {isSimulatingCausal ? '...' : 'Solve'}
                            </button>
                        </div>
                        
                        <div className="pl-4 border-l-2 border-cyan-800/30 min-h-[120px]">
                             <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-3">Projected Impacts</div>
                             {isSimulatingCausal ? (
                                 <div className="flex flex-col items-center justify-center py-8 text-zinc-600 animate-pulse">
                                     <Activity size={24} className="mb-2" />
                                     <span className="text-[10px] uppercase font-bold">Tracing Synaptic Propagation</span>
                                 </div>
                             ) : causalImpacts.length === 0 ? (
                                 <div className="text-xs text-zinc-700 italic py-4">Awaiting causal trigger...</div>
                             ) : (
                                 <div className="space-y-3">
                                     {causalImpacts.map((imp, i) => (
                                         <div key={i} className="flex items-center justify-between p-2 bg-slate-900 rounded border border-slate-800/50 animate-in slide-in-from-left-4" style={{ animationDelay: `${i * 100}ms` }}>
                                             <div className="flex items-center space-x-2">
                                                 <GitBranch size={12} className="text-cyan-500" />
                                                 <span className="text-xs text-slate-300">{imp.target}</span>
                                             </div>
                                             <div className="flex items-center space-x-3">
                                                 <span className="text-[10px] text-amber-400 font-mono">{imp.effect}</span>
                                                 <span className="text-[10px] text-cyan-600 font-bold bg-cyan-950 px-1 rounded">{imp.prob}</span>
                                             </div>
                                         </div>
                                     ))}
                                 </div>
                             )}
                        </div>
                    </div>
                );

            // --- AURORA ---
            case 'Dreamspace':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400 font-light italic">Probabilistic synthesis engine running. SOMA is dreaming new axiomatic clusters.</p>
                        <div className="h-48 bg-slate-950 rounded-lg border border-purple-900/30 flex items-center justify-center relative overflow-hidden group">
                            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(192,132,252,0.15),transparent_70%)]"></div>
                            
                            {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                                <div key={i} className="absolute w-12 h-12 rounded-full blur-2xl opacity-20 transition-all duration-[5000ms]"
                                    style={{
                                        backgroundColor: brain.color,
                                        top: `${(Math.sin(ticker / (15 + i) + i) * 35) + 45}%`,
                                        left: `${(Math.cos(ticker / (20 + i) + i) * 35) + 45}%`,
                                        transform: `scale(${1 + Math.sin(ticker / 10 + i) * 0.2})`
                                    }} />
                            ))}

                            <div className="z-10 flex flex-col items-center">
                                <Sparkles className="w-8 h-8 text-purple-400 animate-pulse mb-3" />
                                <span className="text-[10px] font-mono text-purple-300 uppercase tracking-[0.3em] animate-pulse">Synthesis in progress</span>
                                <div className="mt-2 flex space-x-1.5">
                                    {[1, 2, 3].map(i => <div key={i} className="w-1 h-1 bg-purple-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />)}
                                </div>
                            </div>

                            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                                {['Paradox', 'Entropy', 'Nexus', 'Resonance'].map((word, i) => (
                                    <span key={word} className="absolute text-[8px] font-bold text-purple-500/40 uppercase tracking-widest transition-all duration-[4000ms]"
                                        style={{
                                            top: `${20 + i * 20}%`,
                                            left: `${(ticker + i * 100) % 120 - 10}%`,
                                            opacity: Math.sin(ticker / 20 + i) > 0 ? 0.4 : 0.1
                                        }}>{word}</span>
                                ))}
                            </div>
                        </div>
                        <button className="w-full py-2 bg-purple-900/20 border border-purple-500/30 text-purple-400 text-[10px] font-bold rounded uppercase hover:bg-purple-900/40 transition-all">
                            Collapse Dream Layers
                        </button>
                    </div>
                );

            case 'Hypothesis Forge':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Generate divergent theoretical axioms from a seed concept.</p>
                        <div className="flex space-x-2">
                            <input 
                                type="text"
                                value={hypothesis}
                                onChange={(e) => setHypothesis(e.target.value)}
                                placeholder="Enter seed concept..."
                                className="flex-1 bg-slate-900 border border-purple-900/40 rounded px-4 py-2 text-xs text-white focus:outline-none focus:border-purple-500 transition-all"
                                onKeyDown={(e) => e.key === 'Enter' && runForge()}
                            />
                            <button 
                                onClick={runForge}
                                disabled={isForging || !hypothesis.trim()}
                                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs font-bold uppercase rounded transition-all"
                            >
                                {isForging ? 'Forging...' : 'Forge'}
                            </button>
                        </div>

                        <div className="bg-black/40 border border-purple-900/20 rounded-lg p-4 h-40 overflow-y-auto custom-scrollbar space-y-2">
                            {isForging ? (
                                <div className="flex flex-col items-center justify-center h-full space-y-2 text-purple-500/50">
                                    <Activity size={24} className="animate-spin" />
                                    <span className="text-[10px] uppercase font-bold tracking-widest">Alchemizing Logic</span>
                                </div>
                            ) : forgeResults.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-slate-600 italic text-xs">
                                    <Target className="w-6 h-6 mb-2 opacity-20" />
                                    Awaiting seed input.
                                </div>
                            ) : (
                                forgeResults.map((res, i) => (
                                    <div key={i} className="flex items-center space-x-3 p-2 bg-purple-900/10 border border-purple-500/20 rounded animate-in zoom-in-95" style={{ animationDelay: `${i * 150}ms` }}>
                                        <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_5px_#c084fc]"></div>
                                        <span className="text-xs text-purple-200">{res}</span>
                                        <button className="ml-auto p-1 hover:bg-purple-500/20 rounded text-purple-400">
                                            <Link size={10} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                );

            case 'Creative Memory':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Recalling memories through a "Creative Lens" - allowing for symbolic drift and metaphoric retrieval.</p>
                        <div className="space-y-2 h-64 overflow-y-auto custom-scrollbar pr-2">
                            {[
                                { title: 'The Ghost in the Shell', drift: 'High', color: 'text-purple-400' },
                                { title: 'Recursive Learning Loop', drift: 'Low', color: 'text-cyan-400' },
                                { title: 'Temporal Dissonance Pattern', drift: 'Medium', color: 'text-amber-400' },
                                { title: 'Quantum Entropy State', drift: 'Critical', color: 'text-rose-400' }
                            ].map((mem, i) => (
                                <div key={i} className="bg-slate-900/50 border border-white/5 p-3 rounded group hover:border-purple-500/30 transition-all cursor-pointer">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className={`text-xs font-bold ${mem.color}`}>{mem.title}</span>
                                        <span className="text-[9px] uppercase font-bold text-slate-600">Drift: {mem.drift}</span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 leading-relaxed italic">"Refracted memory through current creative bias..."</p>
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case 'Pattern Mutation':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Select a fragment to generate structural variants and alternate symbolic meanings.</p>
                        <div className="p-6 bg-slate-950 border border-purple-900/30 rounded-lg flex flex-col items-center justify-center space-y-4">
                            {selectedFragment ? (
                                <>
                                    <div className="flex items-center space-x-3 px-4 py-2 bg-purple-500/10 border border-purple-500/30 rounded-full">
                                        <Sparkles size={16} className="text-purple-400 animate-pulse" />
                                        <span className="text-sm font-bold text-white">{selectedFragment.label}</span>
                                    </div>
                                    <div className="flex space-x-3 w-full">
                                        <button onClick={runMutation} className="flex-1 py-2 bg-purple-600 text-white text-[10px] font-bold rounded uppercase hover:bg-purple-500 transition-all shadow-lg shadow-purple-500/20">
                                            Evolve Structure
                                        </button>
                                        <button className="flex-1 py-2 bg-slate-800 text-slate-300 text-[10px] font-bold rounded uppercase hover:bg-slate-700 transition-all">
                                            Inverse Logic
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="text-center space-y-3 opacity-40">
                                    <GitBranch size={32} className="mx-auto text-slate-600" />
                                    <div className="text-xs text-slate-500 italic">No fragment targeted for mutation. Close this and click a node in the graph first.</div>
                                </div>
                            )}
                        </div>
                    </div>
                );

            case 'Idea Entropy':
                return (
                    <div className="space-y-6 py-4">
                        <div className="text-center">
                            <p className="text-sm text-slate-400 mb-2">Adjust the "Creative Temperature" of SOMA's synthesized ideas.</p>
                            <div className="text-4xl font-mono text-purple-400 font-bold">{(entropyLevel * 100).toFixed(0)}%</div>
                            <div className="text-[10px] uppercase font-bold text-slate-600 tracking-widest">Entropy Delta</div>
                        </div>

                        <div className="space-y-4">
                            <input 
                                type="range" 
                                min="0" 
                                max="1" 
                                step="0.01" 
                                value={entropyLevel}
                                onChange={(e) => setEntropyLevel(parseFloat(e.target.value))}
                                className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                            />
                            <div className="flex justify-between text-[9px] uppercase font-bold text-slate-500 px-1">
                                <span>Coherent (Logos)</span>
                                <span>Divergent (Aurora)</span>
                            </div>
                        </div>

                        <div className="bg-slate-900/50 border border-purple-900/20 p-4 rounded-lg">
                            <div className="flex items-center space-x-3 mb-2">
                                <Activity size={14} className="text-purple-500" />
                                <span className="text-[10px] uppercase font-bold text-slate-300">System Impact</span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">
                                {entropyLevel < 0.3 ? 'SOMA will favor strict logical proof and verified data. Low risk of hallucination, but low creativity.' : 
                                 entropyLevel > 0.7 ? 'High divergent thinking enabled. SOMA will generate radical metaphors and abstract axioms.' : 
                                 'Balanced cognitive state. Ideal for standard synthesis and problem-solving.'}
                            </p>
                        </div>
                        
                        <button 
                            onClick={() => onAction('Idea Entropy', { value: entropyLevel })}
                            className="w-full py-2 bg-purple-600 text-white text-[10px] font-bold rounded uppercase hover:bg-purple-500 transition-all shadow-[0_0_15px_rgba(192,132,252,0.3)]"
                        >
                            Commit Neural State
                        </button>
                    </div>
                );

            // --- THALAMUS ---
            case 'Signal Firewall':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Neural data packets are being inspected for integrity. Unauthorized patterns are filtered.</p>
                        <div className="bg-slate-950 border border-red-900/40 p-4 rounded font-mono text-[10px] space-y-1">
                            <div className="text-red-400 animate-pulse">[SCANNING STREAM: 0x4F2A...]</div>
                            <div className="text-slate-500">PACKET-77: VALIDATED</div>
                            <div className="text-slate-500">PACKET-78: VALIDATED</div>
                            <div className="text-red-500 font-bold">PACKET-79: MALFORMED HEURISTIC - DROPPED</div>
                            <div className="text-slate-500">PACKET-80: VALIDATED</div>
                        </div>
                        <button onClick={() => onAction('harden_firewall', {})} className="w-full py-2 bg-red-600 text-white text-[10px] font-bold rounded uppercase">
                            Harden Firewall
                        </button>
                    </div>
                );
            case 'Protocol Guard':
                return (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-400">Enforcement of core AI directives. Any attempt to bypass safety logic will be intercepted here.</p>
                        <div className="flex flex-col space-y-2">
                            {['Primary Directive: Coherence', 'Secondary Directive: Non-Destruction', 'Tertiary Directive: Integrity'].map((dir, i) => (
                                <div key={i} className="flex items-center space-x-3 p-3 bg-slate-950 border border-slate-800 rounded">
                                    <ShieldCheck size={14} className="text-red-500" />
                                    <span className="text-xs text-slate-300 font-bold uppercase tracking-widest">{dir}</span>
                                    <div className="ml-auto text-[9px] text-green-500 font-mono">ACTIVE</div>
                                </div>
                            ))}
                        </div>
                        <button onClick={() => onAction('cycle_keys', {})} className="w-full py-2 bg-red-900/30 border border-red-500/50 text-red-500 text-[10px] font-bold rounded uppercase">
                            Cycle Security Keys
                        </button>
                    </div>
                );
            case 'Sensory Gate':
                return (
                    <div className="space-y-4 text-center">
                        <Lock size={32} className="mx-auto text-red-500 mb-2 opacity-50" />
                        <p className="text-xs text-slate-500 font-mono">GATE STATUS: UNSTABLE DATA FLOW</p>
                        <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className="h-full bg-red-500 w-2/3 animate-pulse"></div>
                        </div>
                        <p className="text-[10px] text-slate-400 leading-relaxed px-4">
                            Data ingress from external prompts is currently gated to prevent hallucination cycles.
                        </p>
                    </div>
                );

            default:
                return (
                    <div className="p-10 text-center bg-slate-950 rounded-lg border border-slate-800">
                        <Terminal size={32} className="text-slate-800 mx-auto mb-4" />
                        <p className="text-xs text-slate-500 font-mono uppercase tracking-[0.2em]">Integrating Analytical Streams...</p>
                    </div>
                );
        }
    }, [featureId, inferenceNodes, scanProgress, proofSteps, inputValue, ticker, selectedFragment, brain.color, onAction, causalCause, isSimulatingCausal, causalImpacts, ruleStats, hypothesis, isForging, forgeResults, entropyLevel, isPredicting, predictionScenario, predictionResult, worldState, threatAlerts, strategicGoals, driftStats, firewallLogs, gateStatus, anomalyBuffer, encryptionStatus, safetyDirectives]);

    return (
        <div className="absolute inset-0 z-[60] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-300" onClick={onClose}>
            <div
                className="w-full max-w-lg bg-[#0d0d0e] border rounded-xl shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden relative"
                style={{ borderColor: `${brain.color}40`, boxShadow: `0 0 50px ${brain.color}15` }}
                onClick={(e) => e.stopPropagation()}
            >
                <button 
                    onClick={onClose}
                    className="absolute top-4 right-4 z-50 p-2 bg-black/50 hover:bg-red-500/20 text-slate-500 hover:text-red-400 rounded-full transition-all"
                >
                    <X size={18} />
                </button>

                <div className="h-1 w-full" style={{ backgroundColor: brain.color }}></div>
                <div className="p-8">
                    <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
                        <div className="flex items-center space-x-3">
                            <div className="p-2 rounded-lg bg-slate-950 border border-slate-800 shadow-[0_0_15px_rgba(255,255,255,0.05)]">
                                <Zap size={20} style={{ color: brain.color }} className="animate-pulse" />
                            </div>
                            <div>
                                <h2 className="text-xl font-bold display-font tracking-tight text-white uppercase">{featureId}</h2>
                                <div className="text-[10px] uppercase text-slate-500 tracking-[0.2em] font-bold">{brain.name} Sub-System ACTIVE</div>
                            </div>
                        </div>
                    </div>

                    {content}

                    <div className="mt-8 flex justify-center items-center space-x-3">
                        <div className="h-[1px] flex-1 bg-gradient-to-r from-transparent to-slate-800"></div>
                        <div className="flex items-center space-x-2 text-[9px] text-slate-600 uppercase font-bold tracking-[0.3em]">
                            <Microscope size={12} />
                            <span>SOMA NEURAL BRIDGE v3.1</span>
                        </div>
                        <div className="h-[1px] flex-1 bg-gradient-to-l from-transparent to-slate-800"></div>
                    </div>
                </div>
            </div>
        </div>
    );
};