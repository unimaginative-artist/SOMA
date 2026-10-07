import React from 'react';
import { BRAINS } from '../constants.js';
import { X, Network, Trash2, Anchor, Star, GitBranch, CheckCircle, AlertTriangle } from 'lucide-react';

export const FragmentDetail = ({ fragment, onClose, onAction, isTraced }) => {
    if (!fragment) return null;

    const brain = BRAINS[fragment.domain] || BRAINS[fragment.primaryBrain] || BRAINS.AURORA;
    const quality = fragment.quality || {};
    const qualityScore = typeof quality.score === 'number' ? quality.score : fragment.confidence || 0;
    const qualityColor = qualityScore >= 0.82 ? 'text-emerald-400' : qualityScore >= 0.62 ? 'text-cyan-400' : qualityScore >= 0.42 ? 'text-amber-400' : 'text-rose-400';
    const lanes = fragment.brainLanes || [fragment.primaryBrain || fragment.domain].filter(Boolean);

    const CommandButton = ({
        icon: Icon,
        label,
        action,
        colorClass,
        description,
        isActive = false
    }) => (
        <div className="group relative flex flex-col items-center">
            <button
                onClick={() => onAction(action, fragment)}
                className={`
                p-3 rounded-md border border-slate-700/50 transition-all duration-200
                ${isActive ? 'bg-slate-700 text-white shadow-[0_0_15px_rgba(255,255,255,0.2)]' : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white'}
                ${colorClass}
            `}
            >
                <Icon size={20} />
            </button>
            <span className="text-[10px] mt-1 text-slate-500 font-medium tracking-wide uppercase">{label}</span>

            <div className="absolute bottom-full mb-3 hidden group-hover:block w-48 p-2 bg-slate-950 border border-slate-700 rounded shadow-xl z-50 pointer-events-none">
                <div className="text-xs text-white font-bold mb-1">{label}</div>
                <div className="text-[10px] text-slate-400 leading-tight">{description}</div>
                <div className="absolute bottom-[-5px] left-1/2 -translate-x-1/2 w-2 h-2 bg-slate-950 border-r border-b border-slate-700 rotate-45"></div>
            </div>
        </div>
    );

    return (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] z-50 animate-in zoom-in-95 duration-200">
            <div
                className="bg-[#0d0d0e]/95 backdrop-blur-md border rounded-lg shadow-2xl overflow-visible"
                style={{ borderColor: `${brain.color}40`, boxShadow: `0 0 60px ${brain.color}15` }}
            >
                <div className="h-1 w-full" style={{ backgroundColor: brain.color }}></div>

                <div className="p-6">
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <div className="flex items-center space-x-2 mb-1">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: brain.color }}></span>
                                <span className="text-xs uppercase tracking-wider font-bold" style={{ color: brain.color }}>{fragment.type}</span>
                                {fragment.isLocked && <span className="text-xs text-blue-400 border border-blue-900/50 px-1 rounded flex items-center"><Anchor size={8} className="mr-1" /> FIXED</span>}
                                {fragment.isPromoted && <span className="text-xs text-yellow-400 border border-yellow-900/50 px-1 rounded flex items-center"><Star size={8} className="mr-1" /> CORE</span>}
                                {fragment.isContradiction && <span className="text-xs text-red-400 border border-red-900/50 px-1 rounded">CONFLICT</span>}
                            </div>
                            <h3 className="text-2xl font-bold text-white display-font leading-none">{fragment.label}</h3>
                        </div>
                        <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24} /></button>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-6">
                        <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Confidence Integrity</div>
                            <div className="text-xl font-mono text-white">{(fragment.confidence * 100).toFixed(0)}<span className="text-sm text-slate-500">%</span></div>
                        </div>
                        <div className="bg-slate-950/50 p-3 rounded border border-slate-800">
                            <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Entropy Decay</div>
                            <div className="text-xl font-mono text-slate-300">{(fragment.decay * 100).toFixed(1)}<span className="text-sm text-slate-500">/h</span></div>
                        </div>
                    </div>

                    <div className="mb-6 rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                        <div className="mb-3 flex items-center justify-between">
                            <div>
                                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Knowledge Quality</div>
                                <div className="text-[10px] text-slate-600 uppercase">{quality.status || 'unverified'}</div>
                            </div>
                            <div className={`text-2xl font-mono font-bold ${qualityColor}`}>
                                {(qualityScore * 100).toFixed(0)}
                                <span className="text-xs text-slate-600">%</span>
                            </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="rounded border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] uppercase text-slate-600">Evidence</div>
                                <div className="text-sm font-mono text-slate-200">{quality.evidenceCount ?? 0}</div>
                            </div>
                            <div className="rounded border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] uppercase text-slate-600">Tensions</div>
                                <div className="text-sm font-mono text-slate-200">{quality.contradictionCount ?? 0}</div>
                            </div>
                            <div className="rounded border border-white/5 bg-black/30 p-2">
                                <div className="text-[9px] uppercase text-slate-600">Source</div>
                                <div className="truncate text-[10px] font-mono text-slate-300">{quality.sourceType || fragment.source || fragment.type}</div>
                            </div>
                        </div>
                        {lanes.length > 0 && (
                            <div className="mt-3 flex flex-wrap gap-1">
                                {lanes.map(lane => (
                                    <span key={lane} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[8px] font-bold uppercase tracking-widest text-slate-400">
                                        {lane}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="border-t border-slate-800 pt-5 mt-2">
                        <div className="text-[10px] text-slate-600 uppercase tracking-widest font-bold mb-3 text-center">Fragment Command</div>
                        <div className="flex flex-wrap justify-center gap-3 px-2">
                            <CommandButton
                                icon={Anchor}
                                label="Anchor"
                                action="anchor"
                                colorClass={fragment.isLocked ? "text-blue-400 border-blue-500/50" : "hover:text-blue-400"}
                                isActive={!!fragment.isLocked}
                                description="Lock this fragment. Decay becomes 0. Immune to pruning. Becomes a fixed axiom."
                            />
                            <CommandButton
                                icon={Network}
                                label="Trace"
                                action="trace"
                                colorClass={isTraced ? "text-cyan-400 border-cyan-500/50" : "hover:text-cyan-400"}
                                isActive={isTraced}
                                description="Highlight dependencies. See what created this and what depends on it."
                            />
                            <CommandButton
                                icon={GitBranch}
                                label="Fork"
                                action="fork"
                                colorClass="hover:text-purple-400"
                                description="Duplicate this idea. Let a twin version evolve independently to test alternate theories."
                            />
                            <CommandButton
                                icon={CheckCircle}
                                label="Verify"
                                action="verify"
                                colorClass="hover:text-emerald-400"
                                description="Ask Logos to re-score this fragment against available evidence and tensions."
                            />
                            <CommandButton
                                icon={AlertTriangle}
                                label="Tensions"
                                action="tensions"
                                colorClass="hover:text-amber-400"
                                description="Search for contradictions or weak assumptions connected to this fragment."
                            />
                            <CommandButton
                                icon={Star}
                                label="Promote"
                                action="promote"
                                colorClass={fragment.isPromoted ? "text-yellow-400 border-yellow-500/50" : "hover:text-yellow-400"}
                                isActive={!!fragment.isPromoted}
                                description="Promote to Core. Permanently increase broadcast radius and influence on global predictions."
                            />
                            <CommandButton
                                icon={Trash2}
                                label="Erase"
                                action="erase"
                                colorClass="hover:text-red-500 hover:border-red-900"
                                description="Schedule Erasure. Mark for rapid entropy decay. Watch it fade from memory."
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
