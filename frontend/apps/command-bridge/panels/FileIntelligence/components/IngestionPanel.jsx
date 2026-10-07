
import React, { useEffect, useRef, useState } from 'react';
import { AppState } from '../types.js';

const IngestionPanel = ({
    logs,
    appState,
    progress,
    scanningStatus,
    onPauseIndex,
    onResumeIndex,
    indexPaused,
    onStartServerIndex,
    allowedRoots,
    savedSearches,
    onRunSearch,
    onSaveSearch,
    onRemoveSearch,
    indexSettings,
    onUpdateIndexSettings
}) => {
    const scrollRef = useRef(null);
    const isActive = appState === AppState.SCANNING || appState === AppState.INDEXING;
    const isScanning = appState === AppState.SCANNING;
    const [selectedRoot, setSelectedRoot] = useState('');
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    return (
        <div className="flex flex-col h-full bg-surface border-r border-border w-72 shrink-0 text-xs font-mono shadow-xl z-20">
            {/* Animated Progress Bar Styles */}
            <style>{`
                @keyframes progressGlow {
                    0%, 100% {
                        background-position: 0% 50%;
                        box-shadow: 0 0 20px rgba(250, 204, 21, 0.5), 0 0 40px rgba(168, 85, 247, 0.3);
                    }
                    50% {
                        background-position: 100% 50%;
                        box-shadow: 0 0 20px rgba(168, 85, 247, 0.5), 0 0 40px rgba(250, 204, 21, 0.3);
                    }
                }
                @keyframes shimmer {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .progress-bar-animated {
                    background: linear-gradient(90deg, #facc15, #a855f7, #facc15, #a855f7);
                    background-size: 300% 100%;
                    animation: progressGlow 2s ease-in-out infinite;
                }
                .progress-shimmer {
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
                    animation: shimmer 1.5s ease-in-out infinite;
                }
            `}</style>

            <div className="p-4 border-b border-border bg-background/50 backdrop-blur-sm">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="font-semibold text-text-secondary tracking-wider uppercase text-[10px]">Mesh Stream</h2>
                    <div className={`w-1.5 h-1.5 rounded-full shadow-[0_0_10px_currentColor] transition-colors duration-500 ${appState === AppState.READY ? 'text-emerald-500' :
                            appState === AppState.IDLE ? 'text-text-muted' : 'text-purple-400 animate-pulse'
                        } bg-current`}></div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-text-muted mb-3 font-medium">
                    <span>ACTIVITY</span>
                    <span className={`uppercase font-bold ${appState === AppState.READY ? 'text-emerald-400' : isActive ? 'text-purple-400' : 'text-text-primary'}`}>{appState}</span>
                </div>

                {/* Enhanced Progress Bar */}
                <div className="w-full bg-surfaceHighlight h-2 rounded-full overflow-hidden relative">
                    {isActive ? (
                        <div
                            className="h-full rounded-full progress-bar-animated relative overflow-hidden transition-all duration-300 ease-out"
                            style={{ width: `${Math.max(5, Math.round(progress))}%` }}
                        >
                            <div className="progress-shimmer"></div>
                        </div>
                    ) : appState === AppState.READY ? (
                        <div
                            className="h-full bg-gradient-to-r from-yellow-400 to-purple-500 rounded-full shadow-[0_0_15px_rgba(168,85,247,0.4)]"
                            style={{ width: '100%' }}
                        ></div>
                    ) : (
                        <div className="h-full bg-transparent"></div>
                    )}
                </div>

                {isActive && (
                    <div className="mt-2 text-[9px] text-purple-400 font-bold uppercase tracking-widest text-center">
                        {Math.round(progress)}% Complete
                    </div>
                )}

                <div className="mt-3 flex items-center gap-2">
                    <button
                        onClick={() => (indexPaused ? onResumeIndex?.() : onPauseIndex?.())}
                        className="px-2 py-1 text-[9px] uppercase tracking-widest border border-white/10 rounded-md text-text-muted hover:text-text-primary hover:border-accent/40 transition-all"
                    >
                        {indexPaused ? 'Resume' : 'Pause'}
                    </button>
                    <button
                        onClick={() => {
                            const target = selectedRoot || allowedRoots?.[0];
                            if (target) onStartServerIndex?.(target);
                        }}
                        className="px-2 py-1 text-[9px] uppercase tracking-widest border border-white/10 rounded-md text-text-muted hover:text-text-primary hover:border-accent/40 transition-all"
                    >
                        Index Root
                    </button>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className="px-2 py-1 text-[9px] uppercase tracking-widest border border-white/10 rounded-md text-text-muted hover:text-accent hover:border-accent/40 transition-all"
                    >
                        Settings
                    </button>
                </div>

                {allowedRoots && allowedRoots.length > 0 && (
                    <select
                        className="mt-2 w-full text-[10px] bg-black/40 border border-white/5 rounded-md text-text-primary px-2 py-1 font-mono"
                        value={selectedRoot}
                        onChange={(e) => setSelectedRoot(e.target.value)}
                    >
                        <option value="">Default Root</option>
                        {allowedRoots.map(r => (
                            <option key={r} value={r}>{r}</option>
                        ))}
                    </select>
                )}

                {/* Scanning Status */}
                {isScanning && scanningStatus && (
                    <div className="mt-3 p-2 bg-black/30 rounded-lg border border-purple-500/20">
                        <div className="flex items-center gap-2 mb-1">
                            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.6)]"></div>
                            <span className="text-[10px] text-purple-300 font-bold uppercase tracking-wider">Scanning</span>
                        </div>
                        <div className="text-[11px] text-accent font-mono">
                            {scanningStatus.filesFound} files found
                        </div>
                        {scanningStatus.currentDir && (
                            <div className="text-[9px] text-text-muted truncate mt-1" title={scanningStatus.currentDir}>
                                /{scanningStatus.currentDir}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {showSettings && (
                <div className="px-4 py-4 border-b border-border bg-gradient-to-b from-black/40 to-black/20">
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-[9px] uppercase tracking-[0.35em] text-text-muted">Index Settings</div>
                        <button
                            onClick={() => setShowSettings(false)}
                            className="text-[9px] uppercase tracking-widest text-text-muted hover:text-rose-400"
                        >
                            Close
                        </button>
                    </div>

                    <div className="space-y-3 text-[10px] font-mono text-text-secondary">
                        <div className="flex items-center justify-between">
                            <span>Workers</span>
                            <input
                                type="number"
                                min="1"
                                max="16"
                                value={indexSettings.workers}
                                onChange={(e) => onUpdateIndexSettings({ workers: parseInt(e.target.value || '1', 10) })}
                                className="w-16 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-text-primary"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Throttle (ms)</span>
                            <input
                                type="number"
                                min="0"
                                max="2000"
                                value={indexSettings.throttleMs}
                                onChange={(e) => onUpdateIndexSettings({ throttleMs: parseInt(e.target.value || '0', 10) })}
                                className="w-20 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-text-primary"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Max Depth</span>
                            <input
                                type="number"
                                min="1"
                                max="50"
                                value={indexSettings.maxDepth}
                                onChange={(e) => onUpdateIndexSettings({ maxDepth: parseInt(e.target.value || '1', 10) })}
                                className="w-16 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-text-primary"
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <span>Max Files</span>
                            <input
                                type="number"
                                min="1000"
                                max="2000000"
                                value={indexSettings.maxFiles}
                                onChange={(e) => onUpdateIndexSettings({ maxFiles: parseInt(e.target.value || '1000', 10) })}
                                className="w-28 bg-black/40 border border-white/10 rounded-md px-2 py-1 text-text-primary"
                            />
                        </div>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={indexSettings.dedupe}
                                onChange={(e) => onUpdateIndexSettings({ dedupe: e.target.checked })}
                            />
                            <span>Deduplicate content</span>
                        </label>
                        <label className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                checked={indexSettings.useHash}
                                onChange={(e) => onUpdateIndexSettings({ useHash: e.target.checked })}
                            />
                            <span>Hash unchanged files</span>
                        </label>
                    </div>
                </div>
            )}

            <div className="px-4 py-3 border-b border-border bg-background/40">
                <div className="flex items-center justify-between mb-2">
                    <div className="text-[9px] uppercase tracking-[0.3em] text-text-muted">Saved Searches</div>
                    <button
                        onClick={() => onSaveSearch?.()}
                        className="text-[9px] uppercase tracking-widest text-text-muted hover:text-accent"
                        title="Save last investigation"
                    >
                        Save
                    </button>
                </div>
                {savedSearches && savedSearches.length > 0 ? (
                    <div className="space-y-2">
                        {savedSearches.map((q, i) => (
                            <div key={`${q}-${i}`} className="flex items-center gap-2">
                                <button
                                    onClick={() => onRunSearch?.(q)}
                                    className="flex-1 text-left text-[10px] font-mono text-text-secondary hover:text-text-primary truncate"
                                    title={q}
                                >
                                    {q}
                                </button>
                                <button
                                    onClick={() => onRemoveSearch?.(q)}
                                    className="text-[10px] text-text-muted hover:text-rose-400"
                                    title="Remove"
                                >
                                    ×
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-[10px] text-text-muted/60">No saved searches yet.</div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar bg-background/30" ref={scrollRef}>
                {logs.length === 0 && (
                    <div className="text-text-muted opacity-30 text-center mt-10 text-[10px]">
                // SYSTEM_IDLE
                    </div>
                )}
                {logs.map((log, i) => (
                    <div key={i} className="flex gap-2 break-all leading-relaxed transition-opacity group">
                        <span className="text-text-muted select-none opacity-40 w-10 text-[9px] text-right shrink-0 mt-0.5 group-hover:opacity-100 transition-opacity">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <span className={`flex-1 ${log.type === 'error' ? 'text-rose-400' :
                                log.type === 'success' ? 'text-teal-400' :
                                    log.type === 'warning' ? 'text-amber-400' : 'text-text-secondary'
                            } opacity-90 group-hover:opacity-100`}>
                            {i === logs.length - 1 && appState !== AppState.IDLE && <span className="mr-1 animate-pulse">›</span>}
                            {log.message}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default IngestionPanel;
