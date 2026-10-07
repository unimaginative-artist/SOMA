import React from 'react';
import { BRAINS } from '../constants.js';
import { X, Activity, Zap, BookOpen, ChevronRight } from 'lucide-react';

export const BrainDetail = ({ brainId, onClose, onOpenFeature, realStats, activities = [] }) => {
    if (!brainId) return null;
    const brain = BRAINS[brainId];
    
    // Use real stats if available, otherwise fallback to static constants
    const stats = realStats || brain.stats;

    return (
        <div className="absolute top-20 right-0 bottom-0 w-96 z-50 overflow-hidden pointer-events-none">
            <div className="h-full w-full bg-[#0d0d0e]/95 backdrop-blur-xl border-l border-white/10 shadow-2xl p-6 transform transition-transform duration-500 translate-x-0 pointer-events-auto overflow-y-auto custom-scrollbar">

                <div className="flex justify-between items-start mb-8">
                    <div>
                        <h2 className={`text-4xl font-bold display-font ${brain.textGlowClass}`} style={{ color: brain.color }}>
                            {brain.name}
                        </h2>
                        <p className="text-slate-400 text-sm mt-1 uppercase tracking-widest">{brain.role}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-white">
                        <X size={24} />
                    </button>
                </div>

                <div className="mb-8">
                    <div className="flex justify-between text-sm text-slate-400 mb-2">
                        <span>Neural Integrity</span>
                        <span>{stats.load}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className="h-full rounded-full transition-all duration-1000"
                            style={{ width: `${stats.load}%`, backgroundColor: brain.color }}
                        ></div>
                    </div>
                    <div className="flex justify-between mt-2">
                        <span className="text-[10px] text-slate-500 font-mono">Confidence: {(stats.confidence * 100).toFixed(0)}%</span>
                        <span className="text-[10px] text-slate-500 font-mono">Uptime: 100%</span>
                    </div>
                </div>

                <div className="space-y-2 mb-8">
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2">Cognitive Core Operations</div>
                    {(stats.roles || brain.buttons).map((btn, i) => (
                        <button
                            key={i}
                            onClick={() => onOpenFeature(btn)}
                            className="w-full text-left px-4 py-3 rounded bg-slate-800/30 hover:bg-slate-700/50 border border-slate-700/50 hover:border-white/20 transition-all group flex items-center justify-between"
                        >
                            <div className="flex items-center space-x-3">
                                <div className="p-1 rounded bg-slate-950">
                                    <Zap size={12} style={{ color: brain.color }} />
                                </div>
                                <span className="text-slate-200 font-medium group-hover:text-white text-sm capitalize">{btn.replace(/_/g, ' ')}</span>
                            </div>
                            <ChevronRight size={14} className="text-slate-600 group-hover:text-white group-hover:translate-x-1 transition-all" />
                        </button>
                    ))}
                </div>

                {/* Live Activity Section */}
                <div className="mb-8">
                    <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-3 flex items-center justify-between">
                        <span>Live Activity Stream</span>
                        <div className="flex space-x-1">
                            <div className="w-1 h-1 bg-green-500 rounded-full animate-ping"></div>
                        </div>
                    </div>
                    <div className="space-y-2">
                        {activities.length > 0 ? activities.slice(-5).reverse().map((activity) => (
                            <div key={activity.id} className="p-2 rounded bg-black/40 border border-white/5 flex items-start space-x-3 animate-in fade-in slide-in-from-right-2 duration-300">
                                <div className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: brain.color }}></div>
                                <div className="flex-1">
                                    <div className="text-[11px] text-slate-300 leading-tight">{activity.action}</div>
                                    <div className="text-[8px] text-slate-600 font-mono mt-1">{new Date(activity.timestamp).toLocaleTimeString()}</div>
                                </div>
                            </div>
                        )) : (
                            <div className="text-[10px] text-slate-600 italic py-4 border border-white/5 border-dashed rounded text-center">
                                No active neural events detected in current window.
                            </div>
                        )}
                    </div>
                </div>

                <div className="space-y-4">
                    <div className="bg-black/40 rounded-lg p-4 border border-slate-800/50">
                        <h4 className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center">
                            <Activity size={10} className="mr-2" /> Total Processed
                        </h4>
                        <div className="text-xl font-mono text-white tracking-tighter">{stats.processes?.toLocaleString() || '0'}</div>
                    </div>

                    <div className="bg-black/40 rounded-lg p-4 border border-slate-800/50">
                        <h4 className="text-[10px] text-slate-500 uppercase font-bold mb-2 flex items-center">
                            <BookOpen size={10} className="mr-2" /> Current Mandate
                        </h4>
                        <div className="text-sm font-mono text-slate-300 italic">"{stats.focus || 'Awaiting task allocation...'}"</div>
                    </div>
                </div>
            </div>
        </div>
    );
};