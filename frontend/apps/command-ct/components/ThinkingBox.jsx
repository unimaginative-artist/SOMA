import React, { useState, useEffect } from 'react';
import { Brain, ChevronDown, ChevronUp, Zap, FileText, Terminal, Network, Lightbulb } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BlinkingDots } from './BlinkingDots';
import { ResponseDisplay } from './ResponseDisplay';
import CrystalLoader from './CrystalLoader';

/**
 * ThinkingBox - Universal container for SOMA's cognitive processes
 * 
 * Houses:
 * - Streaming thought process (real-time tokens)
 * - Confidence/uncertainty visualization
 * - Tool execution tracking
 * - Society of Mind debate perspectives
 * - Idea capture and action items
 * - Workspace context awareness
 */

const ThinkingBox = ({ 
    isThinking = false,
    streamedText = '',
    confidence = null,
    uncertainty = null,
    toolsUsed = [],
    debate = null,
    ideas = [],
    onComplete = null
}) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isComplete, setIsComplete] = useState(false);

    useEffect(() => {
        if (!isThinking && streamedText) {
            setIsComplete(true);
            // Auto-collapse after 3 seconds
            setTimeout(() => setIsExpanded(false), 3000);
        }
    }, [isThinking, streamedText]);

    return (
        <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`my-2 rounded-lg border transition-all duration-500 overflow-hidden ${
                isComplete 
                    ? 'bg-white/5 border-white/5' 
                    : 'bg-gradient-to-br from-fuchsia-500/10 to-purple-500/10 border-fuchsia-500/20 shadow-[0_0_20px_rgba(217,70,239,0.2)]'
            }`}
        >
            {/* Header */}
            <div 
                className="flex items-center justify-between px-3 py-2 cursor-pointer select-none group"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div className="flex items-center space-x-3">
                    {/* Brain Icon with Pulse */}
                    <div className="relative">
                        {isThinking && !isComplete && (
                            <motion.div
                                className="absolute inset-0 rounded-full bg-gradient-to-r from-fuchsia-500 to-purple-500 opacity-50 blur-md"
                                animate={{ scale: [1, 1.3, 1] }}
                                transition={{ duration: 2, repeat: Infinity }}
                            />
                        )}
                        <Brain className={`w-4 h-4 relative z-10 ${
                            isThinking ? 'text-fuchsia-400' : 'text-zinc-500'
                        }`} />
                    </div>

                    {/* Status Text */}
                    <div className="flex flex-col">
                        <div className="flex items-center space-x-2">
                            <span className={`text-[11px] font-bold tracking-wide uppercase ${
                                isThinking ? 'text-zinc-200' : 'text-zinc-400'
                            }`}>
                                {isComplete ? 'Thought Process' : 'Processing'}
                            </span>
                            {isThinking && !isComplete && (
                                <div className="-mt-1 -ml-10">
                                    <CrystalLoader size="xs" />
                                </div>
                            )}
                        </div>
                        <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold">
                            {toolsUsed.length > 0 ? `${toolsUsed.length} tools used` : ''}{toolsUsed.length > 0 && debate ? ' • ' : ''}{debate ? 'deep reasoning' : ''}
                        </span>
                    </div>
                </div>

                {/* Confidence Bar + Expand Toggle */}
                <div className="flex items-center space-x-3">
                    {/* Confidence Indicator */}
                    {confidence !== null && isComplete && (
                        <div className="flex items-center space-x-2">
                            <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                <motion.div
                                    className={`h-full bg-gradient-to-r ${
                                        confidence > 0.8 ? 'from-emerald-500 to-green-400' :
                                        confidence > 0.6 ? 'from-yellow-500 to-amber-400' :
                                        'from-red-500 to-orange-400'
                                    }`}
                                    initial={{ width: 0 }}
                                    animate={{ width: `${confidence * 100}%` }}
                                    transition={{ duration: 1 }}
                                />
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500">
                                {Math.round(confidence * 100)}%
                            </span>
                        </div>
                    )}

                    {/* Expand/Collapse */}
                    {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
                    ) : (
                        <ChevronDown className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
                    )}
                </div>
            </div>

            {/* Expandable Content */}
            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                    >
                        <div className="px-3 pb-2 space-y-2.5">
                            {/* Streaming Thought Text */}
                            {streamedText && (
                                <div className="text-xs text-zinc-300 leading-relaxed">
                                    <ResponseDisplay responseText={streamedText} />
                                    {isThinking && (
                                        <span className="inline-flex ml-2">
                                            <BlinkingDots />
                                        </span>
                                    )}
                                </div>
                            )}

                            {/* Tool Execution */}
                            {toolsUsed.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center space-x-1.5 text-[9px] text-cyan-400 font-bold uppercase tracking-widest">
                                        <Zap className="w-3 h-3" />
                                        <span>Tools Executed</span>
                                    </div>
                                    {toolsUsed.map((tool, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ delay: i * 0.1 }}
                                            className="flex items-center space-x-2 text-[10px] bg-white/5 border border-white/5 rounded px-2 py-1"
                                        >
                                            {tool.tool === 'read_file' && <FileText className="w-3 h-3 text-emerald-400" />}
                                            {tool.tool === 'execute_command' && <Terminal className="w-3 h-3 text-blue-400" />}
                                            {tool.tool === 'http_request' && <Network className="w-3 h-3 text-purple-400" />}
                                            <span className="text-zinc-300 font-mono font-medium">{tool.tool}</span>
                                            <span className="text-zinc-600">›</span>
                                            <span className="text-zinc-500 truncate font-mono">{JSON.stringify(tool.args).slice(0, 40)}...</span>
                                        </motion.div>
                                    ))}
                                </div>
                            )}

                            {/* Society of Mind Debate */}
                            {debate && debate.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center space-x-1.5 text-[9px] text-amber-400 font-bold uppercase tracking-widest">
                                        <Brain className="w-3 h-3" />
                                        <span>Multi-Perspective Reasoning</span>
                                    </div>
                                    {debate.map((perspective, i) => (
                                        <motion.div
                                            key={i}
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: i * 0.15 }}
                                            className="bg-white/5 border border-white/10 rounded p-2 space-y-1"
                                        >
                                            <div className="text-[9px] font-bold text-amber-300 uppercase tracking-widest">{perspective.speaker}</div>
                                            <div className="text-[10px] text-zinc-400 leading-relaxed">{perspective.perspective}</div>
                                        </motion.div>
                                    ))}
                                </div>
                            )}

                            {/* Captured Ideas */}
                            {ideas && ideas.length > 0 && (
                                <div className="space-y-1.5">
                                    <div className="flex items-center space-x-1.5 text-[9px] text-yellow-400 font-bold uppercase tracking-widest">
                                        <Lightbulb className="w-3 h-3" />
                                        <span>Ideas Captured</span>
                                    </div>
                                    {ideas.map((idea, i) => (
                                        <div key={i} className="flex items-start space-x-2 text-[10px] bg-white/5 border border-white/5 rounded px-2 py-1">
                                            <span className="text-yellow-400">›</span>
                                            <span className="text-zinc-300">{idea}</span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Uncertainty Breakdown - Only show if we have valid numeric values */}
                            {uncertainty && 
                             typeof uncertainty.epistemic === 'number' && 
                             typeof uncertainty.aleatoric === 'number' && 
                             !isNaN(uncertainty.epistemic) && 
                             !isNaN(uncertainty.aleatoric) && (
                                <div className="bg-black/20 rounded p-2 space-y-1.5">
                                    <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-widest">Uncertainty Analysis</div>
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between text-[10px]">
                                            <span className="text-zinc-500">Epistemic (Model)</span>
                                            <span className="font-mono text-blue-400">{(uncertainty.epistemic * 100).toFixed(1)}%</span>
                                        </div>
                                        <div className="flex items-center justify-between text-[10px]">
                                            <span className="text-zinc-500">Aleatoric (Data)</span>
                                            <span className="font-mono text-purple-400">{(uncertainty.aleatoric * 100).toFixed(1)}%</span>
                                        </div>
                                        {typeof uncertainty.totalUncertainty === 'number' && !isNaN(uncertainty.totalUncertainty) && (
                                            <div className="flex items-center justify-between text-[10px] pt-1 border-t border-white/5">
                                                <span className="text-zinc-400 font-bold">Total Uncertainty</span>
                                                <span className="font-mono text-amber-400">{(uncertainty.totalUncertainty * 100).toFixed(1)}%</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ThinkingBox;
