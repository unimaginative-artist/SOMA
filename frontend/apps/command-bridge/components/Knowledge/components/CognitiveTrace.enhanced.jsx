import React, { useEffect, useRef, useState } from 'react';
import { BRAINS } from '../constants.js';
import { BrainType } from '../types.js';
import { Activity, Search, Zap, Globe, ChevronDown, ChevronUp, Database } from 'lucide-react';
import { MemoryExcavator } from './MemoryExcavator.jsx';

export const CognitiveTrace = ({
    filterBrain,
    externalLog,
    debateLogs = [],
    onLearnRequest,
    isCollapsed,
    onToggleCollapse,
    brainInfluence = {},
    orderedBrains = [],
    onShowInfluenceInfo,
    onFragmentCreated
}) => {
    const [logs, setLogs] = useState([]);
    const [isPaused, setIsPaused] = useState(false);
    const [activeTab, setActiveTab] = useState('stream'); // 'stream', 'debate', or 'excavate'
    const bottomRef = useRef(null);

    // Resize Logic
    const [height, setHeight] = useState(256); // Default 256px
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef(null);

    const handleMouseDown = (e) => {
        e.preventDefault();
        setIsDragging(true);
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    };

    const handleMouseMove = (e) => {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight > 60 && newHeight < window.innerHeight * 0.8) {
            setHeight(newHeight);
            if (newHeight > 100 && isCollapsed) onToggleCollapse();
            if (newHeight < 80 && !isCollapsed) onToggleCollapse();
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
    };

    // Search/Learning state
    const [searchQuery, setSearchQuery] = useState('');
    const [learningMode, setLearningMode] = useState('deep');
    const [learningStatus, setLearningStatus] = useState('idle');

    // Handle external logs
    useEffect(() => {
        if (externalLog) {
            setLogs(prev => [...prev.slice(-40), externalLog]);
        }
    }, [externalLog]);

    // Auto scroll
    useEffect(() => {
        if (bottomRef.current) {
            bottomRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs]);

    const handleLearnClick = () => {
        if (!searchQuery.trim()) return;

        onLearnRequest?.({
            query: searchQuery,
            mode: learningMode
        });

        setLearningStatus('searching');
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter') {
            handleLearnClick();
        }
    };

    const getStatusColor = () => {
        switch (learningStatus) {
            case 'idle': return 'text-zinc-500';
            case 'searching': return 'text-blue-400 animate-pulse';
            case 'scraping': return 'text-purple-400 animate-pulse';
            case 'indexing': return 'text-cyan-400 animate-pulse';
            case 'complete': return 'text-green-400';
            default: return 'text-zinc-500';
        }
    };

    return (
        <div
            ref={containerRef}
            style={{ height: isCollapsed ? '56px' : `${height}px` }}
            className={`absolute bottom-0 left-0 right-0 bg-[#09090b]/95 border-t border-white/10 z-30 flex flex-col backdrop-blur-xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] transition-all duration-75 ease-out`}
        >
            {/* Drag Handle */}
            <div 
                onMouseDown={handleMouseDown}
                className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-50 hover:bg-white/10 transition-colors group flex items-center justify-center"
            >
                <div className="w-16 h-0.5 bg-zinc-700 rounded-full group-hover:bg-zinc-500 transition-colors"></div>
            </div>

            {/* COLLAPSED: Just search bar */}
            {isCollapsed ? (
                <div className="h-14 flex items-center px-6 space-x-3 pt-1">
                    <div className="flex-1 relative group">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-3 h-3 text-zinc-500 group-focus-within:text-purple-400 transition-colors" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="What should SOMA learn?"
                            className="w-full bg-zinc-900/50 border border-zinc-800 rounded px-8 py-1.5 text-xs text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/30 transition-all"
                        />
                    </div>

                    <div className="flex items-center space-x-1">
                        {orderedBrains.map((brain) => (
                            <div
                                key={brain}
                                className="group cursor-help relative"
                                onClick={() => onShowInfluenceInfo?.(brain)}
                                title={BRAINS[brain]?.name}
                            >
                                <div className="w-12 h-1 bg-zinc-800 rounded-full overflow-hidden">
                                    <div
                                        className="h-full transition-all duration-1000"
                                        style={{
                                            width: `${brainInfluence[brain] || 0}%`,
                                            backgroundColor: BRAINS[brain]?.color
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={onToggleCollapse}
                        className="p-1.5 hover:text-white text-zinc-500 transition-colors"
                        title="Expand"
                    >
                        <ChevronUp size={14} />
                    </button>
                </div>
            ) : (
                /* EXPANDED: Full header with everything */
                <div className="flex-none p-4 border-b border-white/5 bg-[#09090b]/50 space-y-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2 text-zinc-400 text-xs uppercase tracking-widest font-bold">
                                <Activity size={12} className="text-purple-500" />
                                <span>Cognitive Stream</span>
                            </div>

                            <div className="flex items-center space-x-4 pl-4 border-l border-white/10">
                                {orderedBrains.map((brain) => (
                                    <div
                                        key={brain}
                                        className="flex flex-col items-center group cursor-help w-16"
                                        onClick={() => onShowInfluenceInfo?.(brain)}
                                    >
                                        <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden mb-1">
                                            <div
                                                className="h-full transition-all duration-700 ease-out shadow-[0_0_10px_currentColor]"
                                                style={{
                                                    width: `${brainInfluence[brain] || 5}%`,
                                                    backgroundColor: BRAINS[brain]?.color,
                                                    color: BRAINS[brain]?.color
                                                }}
                                            />
                                        </div>
                                        <div className="text-[9px] text-zinc-600 uppercase font-bold group-hover:text-zinc-300 transition-colors">
                                            {BRAINS[brain]?.name.substring(0, 3)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center space-x-3">
                            <div className="flex items-center bg-zinc-900 rounded p-0.5 border border-white/5">
                                <button
                                    onClick={() => setActiveTab('stream')}
                                    className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all ${
                                        activeTab === 'stream' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    Stream
                                </button>
                                <button
                                    onClick={() => setActiveTab('debate')}
                                    className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all ${
                                        activeTab === 'debate' ? 'bg-purple-900/30 text-purple-300 shadow-sm border border-purple-500/20' : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    Debate
                                </button>
                                <button
                                    onClick={() => setActiveTab('excavate')}
                                    className={`px-3 py-1 text-[10px] uppercase font-bold tracking-wider rounded transition-all flex items-center space-x-1 ${
                                        activeTab === 'excavate' ? 'bg-amber-900/30 text-amber-400 shadow-sm border border-amber-500/20' : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <Database size={10} />
                                    <span>Excavate</span>
                                </button>
                            </div>

                            <button
                                onClick={onToggleCollapse}
                                className="p-1 hover:text-white text-zinc-500 transition-colors"
                                title="Collapse"
                            >
                                <ChevronDown size={14} />
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center space-x-2">
                        <div className="relative flex-1 group">
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Input new knowledge query..."
                                className="w-full bg-zinc-900 border border-zinc-800 rounded-md pl-3 pr-20 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/40 focus:bg-black transition-all font-mono"
                            />
                            {/* Mode Toggles embedded in input */}
                            <div className="absolute right-1 top-1 bottom-1 flex items-center bg-zinc-800 rounded overflow-hidden">
                                {['quick', 'deep'].map(mode => (
                                    <button
                                        key={mode}
                                        onClick={() => setLearningMode(mode)}
                                        className={`px-2 py-1 text-[9px] uppercase font-bold transition-colors ${
                                            learningMode === mode ? 'bg-purple-600 text-white' : 'text-zinc-500 hover:text-zinc-300'
                                        }`}
                                        title={`${mode} learning mode`}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={handleLearnClick}
                            className={`group relative px-4 py-2 text-xs font-bold uppercase tracking-wider rounded overflow-hidden transition-all transform active:scale-95 ${
                                !searchQuery.trim() ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-white text-black hover:scale-105 shadow-[0_0_15px_rgba(168,85,247,0.5)]'
                            }`}
                        >
                            <span className="relative z-10 flex items-center space-x-1">
                                <Zap size={12} className={learningStatus === 'searching' ? 'animate-spin' : ''} />
                                <span>{learningStatus === 'searching' ? 'Thinking...' : 'Learn'}</span>
                            </span>
                            <div className={`absolute inset-0 bg-gradient-to-r from-purple-500 to-cyan-500 opacity-0 transition-opacity duration-300 mix-blend-screen ${searchQuery.trim() ? 'group-hover:opacity-100' : ''}`}></div>
                        </button>
                    </div>
                </div>
            )}

            {!isCollapsed && (
                <div className="flex-1 overflow-y-auto p-4 space-y-1 font-mono text-xs relative custom-scrollbar bg-black/20">
                    {activeTab === 'stream' && (
                        <>
                            {logs.filter(l => !filterBrain || l.brain === filterBrain).map((log) => {
                                const brainConfig = BRAINS[log.brain];
                                return (
                                    <div key={log.id} className="flex items-center space-x-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
                                        <span className="text-zinc-600 w-16">{new Date(log.timestamp).toLocaleTimeString().split(' ')[0]}</span>
                                        <span className="font-bold uppercase w-20" style={{ color: brainConfig.color }}>
                                            {brainConfig.name}
                                        </span>
                                        <span className="text-zinc-300 flex-1">{log.action}</span>
                                        <span className={`w-8 text-right ${log.confidenceShift && log.confidenceShift > 0 ? 'text-green-500' : 'text-red-500'}`}>
                                            {log.confidenceShift && log.confidenceShift > 0 ? '+' : ''}
                                            {(log.confidenceShift * 100).toFixed(0)}%
                                        </span>
                                    </div>
                                )
                            })}
                            <div ref={bottomRef} />
                        </>
                    )}

                    {activeTab === 'debate' && (
                        <div className="space-y-6 pb-8">
                            {debateLogs.length === 0 ? (
                                <div className="text-center text-zinc-500 py-8 italic">No internal debates recorded yet.</div>
                            ) : (
                                debateLogs.map((debate, i) => (
                                    <div key={i} className="bg-black/40 border border-purple-500/20 rounded-lg p-4 animate-in fade-in slide-in-from-right-4 duration-500">
                                        <div className="flex justify-between items-center mb-3 border-b border-white/5 pb-2">
                                            <div className="flex items-center space-x-2">
                                                <Brain className="w-4 h-4 text-purple-400" />
                                                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                                                    Query: "{debate.query}"
                                                </span>
                                            </div>
                                            <span className="text-[10px] text-zinc-500">
                                                {(debate.confidence * 100).toFixed(0)}% Consensus
                                            </span>
                                        </div>
                                        
                                        <div className="space-y-3 pl-2 border-l-2 border-zinc-800">
                                            {debate.transcript && debate.transcript.map((turn, tIdx) => {
                                                let color = '#94a3b8';
                                                if (turn.speaker.includes('THALAMUS')) color = BRAINS[BrainType.THALAMUS]?.color;
                                                if (turn.speaker.includes('LOGOS')) color = BRAINS[BrainType.LOGOS]?.color;
                                                if (turn.speaker.includes('AURORA')) color = BRAINS[BrainType.AURORA]?.color;
                                                if (turn.speaker.includes('PROMETHEUS')) color = BRAINS[BrainType.PROMETHEUS]?.color;

                                                return (
                                                    <div key={tIdx} className="text-xs">
                                                        <div className="font-bold uppercase mb-0.5" style={{ color }}>
                                                            {turn.speaker}
                                                        </div>
                                                        <div className="text-zinc-400 leading-relaxed pl-2">
                                                            {turn.perspective}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}

                    {activeTab === 'excavate' && (
                        <div className="h-full">
                            <MemoryExcavator onPromote={onFragmentCreated} />
                        </div>
                    )}
                </div>
            )}

            {!isCollapsed && (
                <div className="absolute top-[8rem] left-0 right-0 h-4 bg-gradient-to-b from-black/50 to-transparent pointer-events-none"></div>
            )}
        </div>
    );
};