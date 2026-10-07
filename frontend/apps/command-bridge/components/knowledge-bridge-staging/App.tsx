
import React, { useState, useEffect, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { ControlBar } from './components/ControlBar';
import { ThreeBrains } from './components/ThreeBrains';
import { FragmentRegistry } from './components/FragmentRegistry';
import { CognitiveTrace } from './components/CognitiveTrace';
import { BrainDetail } from './components/BrainDetail';
import { FragmentDetail } from './components/FragmentDetail';
import { RotationControl } from './components/RotationControl';
import { InputModal } from './components/InputModal';
import { FeatureOverlay } from './components/FeatureOverlay';
import { BrainType, Fragment, FragmentLink, TraceLog, BrainInfluence } from './types';
import { MOCK_FRAGMENTS, MOCK_LINKS, BRAINS } from './constants';
import { Info, X, Zap, Cpu, Eye, ShieldCheck } from 'lucide-react';

const App: React.FC = () => {
  const [activeBrain, setActiveBrain] = useState<BrainType | null>(null);
  const [activeFeature, setActiveFeature] = useState<{brain: BrainType, feature: string} | null>(null);
  const [selectedFragment, setSelectedFragment] = useState<Fragment | null>(null);
  const [tracedFragmentId, setTracedFragmentId] = useState<string | null>(null);
  const [rotation, setRotation] = useState({ x: 0.2, y: 0.5 });
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [showInfluenceInfo, setShowInfluenceInfo] = useState<BrainType | null>(null);
  
  // Cognitive Core States
  const [fragments, setFragments] = useState<Fragment[]>(MOCK_FRAGMENTS);
  const [links, setLinks] = useState<FragmentLink[]>(MOCK_LINKS);
  const [systemStatus, setSystemStatus] = useState({ label: 'COHERENT', color: 'bg-green-500' });
  const [externalLog, setExternalLog] = useState<TraceLog | null>(null);
  const [entropy, setEntropy] = useState(0.4); 
  const [influence, setInfluence] = useState<BrainInfluence>({
    [BrainType.AURORA]: 25,
    [BrainType.PROMETHEUS]: 25,
    [BrainType.LOGOS]: 25,
    [BrainType.THALAMUS]: 25
  });

  const addLog = useCallback((text: string, brain: BrainType, confidence = 0) => {
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

  const handleBrainSelect = useCallback((brain: BrainType) => {
    setActiveBrain(prev => prev === brain ? null : brain);
    addLog(`Neural focus shifted to ${brain} system.`, brain);
  }, [addLog]);

  const handleFragmentAction = (action: string, fragment: Fragment) => {
    switch(action) {
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
            const fork: Fragment = { ...fragment, id: newId, label: `${fragment.label} [ALT]`, x: (fragment.x || 0) + 20 };
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

    const visited = new Set<string>();
    const queue = [{ id: startNode.id, depth: 0 }];
    const impactedNodes = new Set<string>();

    let currentDepth = 0;
    while (queue.length > 0 && currentDepth < 5) {
        const batchSize = queue.length;
        const currentBatch = [];

        for (let i = 0; i < batchSize; i++) {
            const { id, depth } = queue.shift()!;
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

  const handleControlAction = (id: string) => {
    switch(id) {
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
        default:
            addLog(`Command "${id}" received but not yet routed.`, BrainType.THALAMUS);
    }
  };

  const executeFeatureAction = async (featureId: string, payload: any) => {
    if (!activeBrain) return;
    addLog(`Invoking ${featureId}...`, activeBrain);
    switch(featureId) {
        case 'Idea Entropy':
            setEntropy(payload.value);
            break;
        case 'Hypothesis Forge':
            setSystemStatus({ label: 'FORGING', color: 'bg-yellow-400' });
            try {
                const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
                const response = await ai.models.generateContent({
                  model: 'gemini-3-flash-preview',
                  contents: `SOMA AI Cognitive Task: Generate 3 theoretical fragments about: "${payload.query}". Format as JSON objects with label, type, confidence.`
                });
                addLog(`Divergent models integrated for query: ${payload.query.substring(0, 20)}...`, BrainType.AURORA, 0.05);
            } catch (e) { addLog("Forge protocol failed.", BrainType.AURORA, -0.1); }
            setSystemStatus({ label: 'COHERENT', color: 'bg-green-500' });
            break;
        case 'Pattern Mutation':
            if (selectedFragment) {
                const mutation: Fragment = { 
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

  const getInfluenceInfo = (type: BrainType) => {
      switch(type) {
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
    <div className="relative w-screen h-screen bg-slate-950 overflow-hidden selection:bg-cyan-500/30">
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-900 via-slate-950 to-black"></div>
      
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex space-x-12 z-50 pointer-events-none">
          {orderedBrains.map((brain) => (
              <div 
                key={brain} 
                className="flex flex-col items-center w-32 group pointer-events-auto cursor-help"
                onClick={() => setShowInfluenceInfo(brain)}
              >
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest mb-1 font-bold group-hover:text-slate-300 transition-colors flex items-center space-x-1">
                      <span>{brain}</span>
                      <Info size={8} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="w-full h-[3px] bg-slate-800 rounded-full overflow-hidden shadow-inner">
                      <div 
                        className="h-full transition-all duration-1000 shadow-[0_0_8px_rgba(255,255,255,0.2)]" 
                        style={{ 
                            width: `${influence[brain]}%`, 
                            backgroundColor: BRAINS[brain].color
                        }}
                      />
                  </div>
              </div>
          ))}
      </div>

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
        onFragmentClick={setSelectedFragment} 
        highlightBrain={activeBrain}
        fragments={fragments}
        links={links}
        rotation={rotation}
        onRotate={setRotation}
        tracedFragmentId={tracedFragmentId}
      />

      <ControlBar onAction={handleControlAction} systemStatus={systemStatus} />
      
      <ThreeBrains onSelectBrain={handleBrainSelect} activeBrain={activeBrain} />

      <InputModal isOpen={isInputModalOpen} onClose={() => setIsInputModalOpen(false)} onSubmit={() => {}} />
      
      <BrainDetail 
        brainId={activeBrain} 
        onClose={() => setActiveBrain(null)} 
        onOpenFeature={(feature) => setActiveFeature({brain: activeBrain!, feature})}
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

      <CognitiveTrace filterBrain={activeBrain} externalLog={externalLog} />
    </div>
  );
};

export default App;
