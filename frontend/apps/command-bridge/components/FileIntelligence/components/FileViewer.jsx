
import React, { useEffect, useRef } from 'react';

const FileViewer = ({ node, highlightedChunk, onClose }) => {
    const contentRef = useRef(null);

    useEffect(() => {
        if (highlightedChunk && contentRef.current && node.content) {
            const textBefore = node.content.substring(0, highlightedChunk.startOffset);
            const linesBefore = textBefore.split('\n').length;
            const lineHeight = 24;
            const scrollPos = Math.max(0, (linesBefore - 5) * lineHeight);
            contentRef.current.scrollTo({ top: scrollPos, behavior: 'smooth' });
        }
    }, [highlightedChunk, node.content]);

    // Common Close Button Component for consistency
    const CloseButton = () => (
        <button
            onClick={onClose}
            className="group flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/5 hover:bg-red-500/10 border border-white/5 hover:border-red-500/50 transition-all duration-200"
            title="Close File Viewer"
        >
            <span className="text-[10px] font-bold text-text-muted group-hover:text-red-400 uppercase tracking-widest hidden sm:inline">Close</span>
            <svg className="w-4 h-4 text-text-muted group-hover:text-red-400 transition-transform group-hover:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
    );

    if (!node.content) {
        return (
            <div className="absolute inset-0 bg-background/95 backdrop-blur z-50 flex flex-col border-l border-border animate-fade-in">
                <div className="h-14 border-b border-border flex justify-between items-center px-6 bg-surface shrink-0">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-1.5 bg-surfaceHighlight rounded-md border border-border">
                            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        </div>
                        <h3 className="font-mono text-sm text-text-primary truncate">{node.name}</h3>
                    </div>
                    <CloseButton />
                </div>
                <div className="flex-1 flex flex-col items-center justify-center text-text-muted font-mono space-y-4">
                    <div className="w-16 h-16 rounded-full bg-surfaceHighlight flex items-center justify-center border border-border">
                        <svg className="w-8 h-8 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <p className="text-sm">Binary file or content not indexed.</p>
                </div>
            </div>
        )
    }

    const allLines = node.content.split('\n');
    const MAX_RENDER_LINES = 1000;
    const isTruncated = allLines.length > MAX_RENDER_LINES;
    const lines = isTruncated ? allLines.slice(0, MAX_RENDER_LINES) : allLines;

    let startLine = -1;
    let endLine = -1;

    if (highlightedChunk) {
        const textBefore = node.content.substring(0, highlightedChunk.startOffset);
        startLine = textBefore.split('\n').length - 1;
        const textIncluded = node.content.substring(0, highlightedChunk.endOffset);
        endLine = textIncluded.split('\n').length - 1;
    }

    return (
        <div className="absolute inset-0 bg-background z-40 flex flex-col border-t border-border shadow-[0_-10px_40px_rgba(0,0,0,0.5)] animate-slide-up">
            {/* Editor Header */}
            <div className="h-14 border-b border-border flex justify-between items-center px-4 bg-surface shrink-0 select-none">
                <div className="flex items-center gap-4 overflow-hidden">
                    <div className="flex items-center gap-2 text-sm text-text-secondary bg-surfaceHighlight px-3 py-1.5 rounded-md border border-border/50">
                        <svg className="w-3.5 h-3.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        <span className="font-mono text-xs truncate max-w-[400px] text-text-primary">{node.path}</span>
                    </div>
                </div>
                <div className="flex items-center gap-4">
                    {isTruncated && (
                        <span className="text-[10px] text-amber-400 font-bold animate-pulse">⚠️ PREVIEW TRUNCATED (First ${MAX_RENDER_LINES} lines)</span>
                    )}
                    <span className="text-[10px] uppercase tracking-wider text-text-muted font-mono hidden sm:inline">{allLines.length} LINES</span>
                    <div className="h-4 w-px bg-border hidden sm:block"></div>
                    <CloseButton />
                </div>
            </div>

            {/* Editor Body */}
            <div className="flex-1 overflow-auto custom-scrollbar font-mono text-sm leading-6 relative bg-[#09090b] animate-fade-in" ref={contentRef}>
                <div className="flex min-h-full">
                    {/* Line Numbers */}
                    <div className="min-w-[3.5rem] shrink-0 bg-surface/50 border-r border-border flex flex-col items-end pr-4 py-4 text-text-muted select-none opacity-60">
                        {lines.map((_, i) => (
                            <div key={i} className={`h-6 leading-6 text-[10px] ${i >= startLine && i <= endLine ? 'text-accent font-bold' : ''}`}>{i + 1}</div>
                        ))}
                    </div>

                    {/* Code Content */}
                    <div className="flex-1 py-4 px-6 overflow-x-auto">
                        {lines.map((line, i) => {
                            const isHighlighted = i >= startLine && i <= endLine;
                            return (
                                <div key={i} className={`h-6 whitespace-pre relative ${isHighlighted ? 'bg-accent/10 -mx-6 px-6' : ''}`}>
                                    {isHighlighted && <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-accent"></div>}
                                    <span className={isHighlighted ? 'text-white' : 'text-text-secondary'}>{line || ' '}</span>
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FileViewer;
