
import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { AppState } from '../types.js';

const ChatInterface = ({
    history,
    appState,
    onCitationClick,
}) => {
    const scrollRef = useRef(null);

    // Auto-scroll to latest message
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history]);

    // Deterministic color picker logic to stay consistent with the rest of the app
    const getCiteTheme = (fileId) => {
        const hash = fileId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        const isYellow = hash % 2 === 0;

        return {
            accentClass: isYellow ? 'text-accent' : 'text-purple-400',
            borderHoverClass: isYellow ? 'hover:border-accent/40' : 'hover:border-purple-500/40',
            bgHoverClass: isYellow ? 'hover:bg-accent/10' : 'hover:bg-purple-500/10',
            dotClass: isYellow ? 'bg-accent' : 'bg-purple-500',
            glowClass: isYellow ? 'shadow-[0_0_12px_rgba(250,204,21,0.4)]' : 'shadow-[0_0_12px_rgba(168,85,247,0.4)]',
            borderColor: isYellow ? 'border-accent/20' : 'border-purple-500/20',
            glassBg: isYellow ? 'bg-accent/5' : 'bg-purple-500/5'
        };
    };

    return (
        <div className="flex flex-col h-full bg-background relative overflow-hidden font-mono">
            {/* Background Ambient Glow */}
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-accent/10 to-transparent blur-sm"></div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto px-4 md:px-24 py-12 space-y-12 z-10 custom-scrollbar scroll-smooth" ref={scrollRef}>
                {history.length === 0 && (
                    <div className="flex flex-col items-center justify-center h-full text-white select-none opacity-40">
                        <div className="w-12 h-12 rounded-xl border border-white/10 flex items-center justify-center mb-6">
                            <span className="font-medium text-xl">S</span>
                        </div>
                        <h2 className="text-[10px] font-medium tracking-[0.4em] uppercase">SOMA SYSTEM READY</h2>
                    </div>
                )}

                {history.map((msg, idx) => (
                    <div key={idx} className={`flex flex-col animate-slide-up ${msg.type === 'user' ? 'items-end' : 'items-start'}`}>

                        {/* Header / Identity */}
                        <div className={`flex items-center gap-3 mb-4 text-[9px] uppercase tracking-[0.2em] font-medium text-white/30 ${msg.type === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                            {msg.type === 'user' ? (
                                <span className="tracking-[0.4em]">Operator</span>
                            ) : (
                                <div className="flex items-center gap-2">
                                    <div className="w-1 h-1 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.8)]"></div>
                                    <span className="text-white/60 tracking-[0.4em]">SOMA</span>
                                </div>
                            )}
                        </div>

                        {/* Message Content Area */}
                        <div className={`w-full max-w-[850px] ${msg.type === 'user' ? 'text-right' : 'text-left'}`}>

                            {/* Status Indicator during Search */}
                            {msg.type === 'agent' && msg.retrievalStatus && msg.retrievalStatus.state !== 'complete' && (
                                <div className="mb-6 p-4 bg-white/[0.02] border border-white/5 rounded-2xl text-[10px] space-y-2 text-white/40 backdrop-blur-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-1 h-1 bg-white/30 rounded-full animate-ping"></div>
                                        <span className="uppercase tracking-[0.2em]">
                                            {msg.retrievalStatus.state === 'searching' ? 'Mapping Memory Mesh' :
                                                msg.retrievalStatus.state === 'reading' ? 'Extracting Semantics' : 'Synthesizing'}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* Minimalist Text Body */}
                            <div className="text-white font-normal">
                                {msg.content ? (
                                    <div className={`prose prose-invert prose-sm max-w-none 
                        prose-p:text-white prose-p:font-normal
                        ${msg.type === 'user'
                                            ? 'prose-p:text-[10px] prose-p:leading-relaxed prose-p:opacity-70 font-sans prose-strong:font-normal prose-headings:font-normal'
                                            : 'prose-p:text-[13px] prose-p:leading-relaxed font-mono'
                                        }
                        prose-headings:text-white prose-headings:uppercase prose-headings:tracking-widest prose-headings:mt-10 prose-headings:text-[11px]
                        ${msg.type === 'agent' ? 'prose-headings:font-medium' : ''}
                        prose-strong:text-white ${msg.type === 'agent' ? 'prose-strong:font-semibold' : ''}
                        prose-code:text-white prose-code:bg-white/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-code:text-[12px]
                        prose-pre:bg-white/[0.03] prose-pre:border prose-pre:border-white/10 prose-pre:rounded-xl
                        prose-li:text-white/80 prose-li:marker:text-white/20 prose-li:text-[13px]
                        prose-a:text-purple-400 prose-a:no-underline hover:prose-a:underline`}>
                                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                                    </div>
                                ) : (
                                    msg.isStreaming && !msg.retrievalStatus && <span className="animate-pulse opacity-40">_</span>
                                )}
                            </div>

                            {/* Streaming Cursor */}
                            {msg.isStreaming && msg.content && (
                                <span className="inline-block w-1 h-3.5 bg-white/30 ml-2 align-middle animate-pulse"></span>
                            )}

                            {/* Citations - Ultra Glassmorphic Context Chips */}
                            {msg.citations && msg.citations.length > 0 && (
                                <div className="mt-12 pt-8 border-t border-white/5 relative">
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="h-px w-8 bg-white/10"></div>
                                        <div className="text-[9px] font-bold text-white/30 uppercase tracking-[0.4em]">Verification Context</div>
                                    </div>

                                    <div className="flex flex-wrap gap-4">
                                        {msg.citations.map((cite, cIdx) => {
                                            const theme = getCiteTheme(cite.fileId);
                                            return (
                                                <button
                                                    key={cIdx}
                                                    onClick={() => onCitationClick(cite)}
                                                    className={`
                            group relative flex items-center gap-4 px-4 py-2.5 rounded-2xl
                            transition-all duration-300 text-left overflow-hidden
                            backdrop-blur-xl border border-white/[0.08]
                            ${theme.glassBg}
                            ${theme.borderHoverClass} ${theme.bgHoverClass}
                            hover:scale-[1.02] hover:shadow-[0_8px_24px_rgba(0,0,0,0.4)]
                          `}
                                                >
                                                    {/* Subtle Inner Shine */}
                                                    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none"></div>

                                                    <div className="relative flex items-center justify-center shrink-0">
                                                        <div className={`
                                w-8 h-8 rounded-xl bg-white/[0.03] border border-white/10 flex items-center justify-center
                                group-hover:bg-white/[0.08] group-hover:border-white/20 transition-all duration-300
                             `}>
                                                            <svg className={`w-4 h-4 text-white/20 group-hover:${theme.accentClass} transition-colors duration-200`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>
                                                        </div>
                                                        <div className={`absolute -top-1 -right-1 w-1.5 h-1.5 rounded-full opacity-0 group-hover:opacity-100 ${theme.dotClass} ${theme.glowClass} transition-opacity`}></div>
                                                    </div>
                                                    <div className="flex flex-col min-w-0">
                                                        <span className="text-[10px] text-white/50 group-hover:text-white font-medium truncate max-w-[200px] transition-colors tracking-tight">
                                                            {cite.filePath.split('/').pop()}
                                                        </span>
                                                        <span className={`text-[8px] uppercase tracking-[0.2em] opacity-30 group-hover:opacity-100 transition-opacity ${theme.accentClass} font-bold mt-1`}>
                                                            Neural Link
                                                        </span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {/* Bottom padding for UI ergonomics */}
                <div className="h-32"></div>
            </div>
        </div>
    );
};

export default ChatInterface;
