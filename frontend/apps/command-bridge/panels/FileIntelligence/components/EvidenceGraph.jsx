import React, { useMemo, useState } from 'react';

const buildGraph = (investigation, maxResults = 120) => {
    const results = (investigation?.results || []).slice(0, maxResults);
    const folders = new Map();
    const files = [];
    const snippets = [];
    const edges = [];

    const folderX = 40;
    const fileX = 360;
    const snippetX = 700;
    let y = 40;
    const rowGap = 90;

    const getFolderKey = (pathStr) => {
        if (!pathStr) return 'root';
        const parts = pathStr.split(/[\\/]/).filter(Boolean);
        if (parts.length <= 1) return 'root';
        return parts.slice(0, -1).join('/');
    };

    const getFileName = (pathStr) => {
        if (!pathStr) return 'document';
        const parts = pathStr.split(/[\\/]/).filter(Boolean);
        return parts[parts.length - 1] || 'document';
    };

    const getSnippet = (res) => {
        if (res?.snippet) return res.snippet;
        const content = res?.content || '';
        if (!content) return 'No snippet available';
        return content.length > 180 ? `${content.slice(0, 180)}…` : content;
    };

    for (const res of results) {
        const path = res?.metadata?.path || res?.metadata?.absolutePath || res?.path || res?.id;
        const folder = getFolderKey(path);
        if (!folders.has(folder)) {
            folders.set(folder, {
                id: `folder:${folder}`,
                label: folder,
                x: folderX,
                y,
                type: 'folder'
            });
            y += rowGap;
        }

        const folderNode = folders.get(folder);
        const fileNode = {
            id: `file:${res.id}`,
            label: getFileName(path),
            x: fileX,
            y: folderNode.y,
            type: 'file',
            data: res
        };
        const snippetNode = {
            id: `snippet:${res.id}`,
            label: getSnippet(res),
            x: snippetX,
            y: folderNode.y,
            type: 'snippet',
            data: res
        };

        files.push(fileNode);
        snippets.push(snippetNode);
        edges.push({ from: folderNode.id, to: fileNode.id });
        edges.push({ from: fileNode.id, to: snippetNode.id });
        folderNode.y += 12; // slight stagger for multiple files
    }

    const nodes = [
        ...Array.from(folders.values()),
        ...files,
        ...snippets
    ];

    const height = Math.max(420, y + 80);
    return { nodes, edges, height };
};

const EvidenceGraph = ({ investigation, onOpenFile }) => {
    const graph = useMemo(() => buildGraph(investigation), [investigation]);
    const [hoveredId, setHoveredId] = useState(null);

    const adjacency = useMemo(() => {
        const map = new Map();
        graph.edges.forEach(edge => {
            if (!map.has(edge.from)) map.set(edge.from, new Set());
            if (!map.has(edge.to)) map.set(edge.to, new Set());
            map.get(edge.from).add(edge.to);
            map.get(edge.to).add(edge.from);
        });
        return map;
    }, [graph]);

    const nodeMap = useMemo(() => {
        const map = new Map();
        graph.nodes.forEach(n => map.set(n.id, n));
        return map;
    }, [graph]);

    if (!investigation || !investigation.results || investigation.results.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-[10px] text-text-muted uppercase tracking-[0.3em]">
                No Evidence Graph
            </div>
        );
    }

    if (graph.nodes.length > 200) {
        return (
            <div className="h-full flex items-center justify-center text-[10px] text-text-muted uppercase tracking-[0.3em]">
                Graph disabled for large result sets. Use Evidence list.
            </div>
        );
    }

    return (
        <div className="relative h-full overflow-auto bg-black/10">
            <svg className="absolute inset-0" width="100%" height={graph.height}>
                {graph.edges.map((edge, idx) => {
                    const from = nodeMap.get(edge.from);
                    const to = nodeMap.get(edge.to);
                    if (!from || !to) return null;
                    const isHot = hoveredId === from.id || hoveredId === to.id;
                    return (
                        <line
                            key={idx}
                            x1={from.x + 120}
                            y1={from.y + 12}
                            x2={to.x - 10}
                            y2={to.y + 12}
                            stroke={isHot ? 'rgba(250,204,21,0.7)' : 'rgba(250,204,21,0.15)'}
                            strokeWidth={isHot ? '2' : '1'}
                        />
                    );
                })}
            </svg>

            <div className="relative" style={{ height: graph.height }}>
                {graph.nodes.map(node => {
                    const connected = hoveredId && adjacency.get(hoveredId)?.has(node.id);
                    const isFocus = hoveredId === node.id || connected;
                    return (
                    <div
                        key={node.id}
                        onClick={() => node.type !== 'folder' && onOpenFile?.(node.data)}
                        onMouseEnter={() => setHoveredId(node.id)}
                        onMouseLeave={() => { setHoveredId(null); }}
                        className={`group absolute px-3 py-2 rounded-xl border text-[10px] font-mono transition-all cursor-pointer
                            ${node.type === 'folder'
                                ? 'bg-purple-500/10 border-purple-500/30 text-purple-200'
                                : node.type === 'file'
                                    ? 'bg-white/5 border-white/10 text-text-primary hover:border-accent/40 hover:bg-accent/5'
                                    : 'bg-white/5 border-white/10 text-text-secondary hover:border-accent/40 hover:bg-accent/5'
                            }`}
                        style={{
                            left: node.x,
                            top: node.y,
                            width: node.type === 'snippet' ? 320 : 260,
                            boxShadow: isFocus ? '0 0 20px rgba(250,204,21,0.15)' : 'none',
                            transform: isFocus ? 'scale(1.01)' : 'scale(1)'
                        }}
                        title={node.label}
                    >
                        <div className="truncate">{node.label}</div>
                    </div>
                )})}
            </div>
        </div>
    );
};

export default EvidenceGraph;
