import React, { useState, useEffect } from 'react';
import { GitCommit, AlertTriangle, Check } from 'lucide-react';

const BeliefNetworkViewer = ({ isConnected }) => {
  const [contradictions, setContradictions] = useState([]);
  const [beliefs, setBeliefs] = useState([]);

  useEffect(() => {
    if (!isConnected) return;

    const fetchData = async () => {
      try {
        const [conRes, beliefsRes] = await Promise.all([
          fetch('/api/beliefs/contradictions'),
          fetch('/api/beliefs')
        ]);

        if (conRes.ok) {
            const conData = await conRes.json();
            if (conData.success) setContradictions(conData.contradictions || []);
        }

        if (beliefsRes.ok) {
            const beliefsData = await beliefsRes.json();
            if (beliefsData.success) setBeliefs(beliefsData.beliefs || []);
        }
      } catch (err) {
        console.warn('Belief fetch failed:', err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [isConnected]);

  return (
    <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg h-[250px] flex flex-col">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-zinc-100 font-semibold text-sm flex items-center">
          <GitCommit className="w-4 h-4 mr-2 text-cyan-400" /> Belief Alignment
        </h3>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${
          contradictions.length > 0 
            ? 'bg-rose-500/10 text-rose-400 border-rose-500/20 animate-pulse'
            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        }`}>
          {contradictions.length > 0 ? 'Conflict Detected' : 'Coherent'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
        {contradictions.map(c => (
          <div key={c.id} className="bg-rose-500/10 border border-rose-500/20 p-2 rounded text-xs text-rose-300">
            <div className="font-bold flex items-center mb-1">
              <AlertTriangle className="w-3 h-3 mr-1" /> Contradiction
            </div>
            <p className="opacity-80">{c.description}</p>
          </div>
        ))}
        {beliefs.map(b => (
          <div key={b.id} className="bg-[#09090b]/40 border border-white/5 p-2 rounded text-xs text-zinc-400 flex justify-between group hover:border-cyan-500/20 transition-colors">
            <span className="truncate max-w-[200px]">{b.statement}</span>
            <span className="text-cyan-500 font-mono">{Number.isFinite(b.confidence) ? `${(b.confidence * 100).toFixed(0)}%` : '--'}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BeliefNetworkViewer;
