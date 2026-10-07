import React, { useMemo } from 'react';

const formatFolder = (pathStr) => {
    if (!pathStr) return 'root';
    const parts = pathStr.split(/[\\/]/).filter(Boolean);
    if (parts.length <= 1) return 'root';
    return parts.slice(0, -1).join('/');
};

const formatFileName = (pathStr) => {
    if (!pathStr) return 'document';
    const parts = pathStr.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || 'document';
};

const getSnippet = (result) => {
    if (result?.snippet) return result.snippet;
    const content = result?.content || '';
    if (!content) return 'No snippet available';
    return content.length > 240 ? `${content.slice(0, 240)}…` : content;
};

const EvidenceCascade = ({ investigation, onOpenFile }) => {
    const groups = useMemo(() => {
        const map = new Map();
        const results = investigation?.results || [];
        for (const res of results) {
            const p = res?.metadata?.path || res?.metadata?.absolutePath || res?.path || res?.id;
            const folder = formatFolder(p);
            if (!map.has(folder)) map.set(folder, []);
            map.get(folder).push({ ...res, _path: p });
        }
        return Array.from(map.entries())
            .map(([folder, items]) => ({
                folder,
                items: items.sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
            }))
            .sort((a, b) => b.items.length - a.items.length);
    }, [investigation]);

    if (!investigation || !investigation.results || investigation.results.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-[10px] text-text-muted uppercase tracking-[0.3em]">
                No Evidence Yet
            </div>
        );
    }

    return (
        <div className="h-full overflow-y-auto px-6 py-5 space-y-6">
            <div className="text-[9px] text-text-muted uppercase tracking-[0.35em]">
                Evidence Cascade
            </div>

            {groups.map(group => (
                <div key={group.folder} className="border border-white/5 rounded-2xl bg-white/[0.02] p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="text-[10px] font-bold text-text-secondary uppercase tracking-widest truncate">
                            {group.folder}
                        </div>
                        <div className="text-[9px] text-purple-400 font-bold">{group.items.length} files</div>
                    </div>

                    <div className="space-y-3">
                        {group.items.slice(0, 5).map((item, idx) => {
                            const scorePct = Math.round((item.finalScore || 0) * 100);
                            const filePath = item._path;
                            return (
                                <button
                                    key={`${group.folder}-${idx}`}
                                    onClick={() => onOpenFile?.(item)}
                                    className="w-full text-left p-3 rounded-xl border border-white/5 hover:border-accent/30 hover:bg-accent/5 transition-all group"
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="text-[11px] text-text-primary font-mono truncate max-w-[70%]">
                                            {formatFileName(filePath)}
                                        </div>
                                        <div className="text-[9px] text-accent font-bold">{scorePct}%</div>
                                    </div>
                                    <div className="text-[10px] text-text-muted line-clamp-2">
                                        {getSnippet(item)}
                                    </div>
                                    <div className="mt-2 text-[9px] text-text-muted/60 font-mono">
                                        vector {((item.vectorScore || 0) * 100).toFixed(0)}% · bm25 {((item.bm25Score || 0) * 100).toFixed(0)}%
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default EvidenceCascade;
