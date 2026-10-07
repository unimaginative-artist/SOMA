import React, { useState, useEffect } from 'react';
import { Database, Search, Sparkles, ChevronRight, Activity, Clock, Shield, ArrowUpCircle } from 'lucide-react';

export const MemoryExcavator = ({ onPromote }) => {
    const [memories, setMemories] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState(null);
    const [promoteLabel, setPromoteLabel] = useState('');

    useEffect(() => {
        fetchMemories();
    }, []);

    const fetchMemories = async () => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/soma/memory/excavate?limit=30');
            const data = await res.json();
            if (data.success) {
                setMemories(data.memories);
            }
        } catch (e) {
            console.error("Excavation failed", e);
        }
        setIsLoading(false);
    };

    const handlePromote = async (memory) => {
        if (!promoteLabel.trim()) return;

        try {
            const res = await fetch('/api/soma/memory/promote', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memoryId: memory.id,
                    label: promoteLabel,
                    importance: 8
                })
            });
            const data = await res.json();
            if (data.success) {
                onPromote?.(data.node);
                setSelectedId(null);
                setPromoteLabel('');
                fetchMemories(); // Refresh list
            }
        } catch (e) {
            console.error("Promotion failed", e);
        }
    };

    return (
        <div className="flex flex-col h-full space-y-4">
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2 text-amber-400">
                    <Database size={16} />
                    <span className="text-xs font-bold uppercase tracking-widest">Cold Memory Tier (SQLite)</span>
                </div>
                <button 
                    onClick={fetchMemories}
                    className="p-1 hover:bg-white/5 rounded transition-colors text-zinc-500 hover:text-white"
                    title="Refresh Excavation"
                >
                    <Activity size={14} className={isLoading ? 'animate-spin' : ''} />
                </button>
            </div>

            {isLoading ? (
                <div className="flex-1 flex flex-col items-center justify-center space-y-3 opacity-50">
                    <Clock size={32} className="animate-pulse text-zinc-600" />
                    <span className="text-xs font-mono uppercase tracking-tighter">Sifting through temporal fragments...</span>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-2">
                    {memories.length === 0 ? (
                        <div className="text-center text-zinc-600 py-12 italic text-sm">
                            No cold memories found in this epoch.
                        </div>
                    ) : (
                        memories.map(memory => (
                            <div 
                                key={memory.id}
                                className={`group border rounded-lg p-3 transition-all duration-300 ${
                                    selectedId === memory.id 
                                        ? 'bg-amber-500/10 border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.1)]' 
                                        : 'bg-black/20 border-white/5 hover:border-white/10 hover:bg-white/5'
                                }`}
                                onClick={() => {
                                    setSelectedId(selectedId === memory.id ? null : memory.id);
                                    setPromoteLabel(memory.content.substring(0, 30));
                                }}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center space-x-2">
                                        <div className={`w-1.5 h-1.5 rounded-full ${memory.metadata?.promotedToFractal ? 'bg-emerald-500' : 'bg-zinc-700'}`}></div>
                                        <span className="text-[10px] font-mono text-zinc-500">
                                            {new Date(memory.created_at).toLocaleString()}
                                        </span>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <span className="text-[9px] text-zinc-600 uppercase font-bold tracking-tighter">Importance: {(memory.importance * 100).toFixed(0)}%</span>
                                        {memory.metadata?.promotedToFractal && (
                                            <Shield size={10} className="text-emerald-500" title="Promoted to Fractal" />
                                        )}
                                    </div>
                                </div>

                                <p className="text-sm text-zinc-300 line-clamp-2 leading-relaxed font-serif italic mb-3">
                                    "{memory.content}"
                                </p>

                                {selectedId === memory.id && (
                                    <div className="mt-4 pt-4 border-t border-white/10 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <div className="flex flex-col space-y-3">
                                            <div className="flex flex-col space-y-1">
                                                <label className="text-[9px] uppercase font-bold text-zinc-500 ml-1">Fractal Identity (Label)</label>
                                                <input 
                                                    type="text" 
                                                    value={promoteLabel}
                                                    onChange={(e) => setPromoteLabel(e.target.value)}
                                                    placeholder="Define the concept..."
                                                    className="bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500/50"
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </div>
                                            <button 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handlePromote(memory);
                                                }}
                                                className="flex items-center justify-center space-x-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 rounded py-2 transition-all group/btn"
                                            >
                                                <ArrowUpCircle size={14} className="group-hover/btn:-translate-y-0.5 transition-transform" />
                                                <span className="text-[10px] font-bold uppercase tracking-widest">Promote to Fractal Knowledge</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};
