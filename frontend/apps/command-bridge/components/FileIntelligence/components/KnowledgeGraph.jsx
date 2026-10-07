
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';

const getMockHash = (id) => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = ((hash << 5) - hash) + id.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
};

const getNodeColor = (node, viewMode, isRelevant) => {
    if (isRelevant) {
        // Deterministic "random" choice between Yellow and Purple based on ID
        const hash = node.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return hash % 2 === 0 ? "#facc15" : "#a855f7";
    }

    if (node.isVirtual) return "#a855f7";

    switch (viewMode) {
        case 'heatmap':
            const heat = (node.name.length * 7) % 100;
            if (heat > 80) return "#ef4444";
            if (heat > 50) return "#f97316";
            if (heat > 20) return "#facc15";
            return "#3f3f46";

        case 'temporal':
            const age = node.id.charCodeAt(0) % 3;
            if (age === 0) return "#3b82f6";
            if (age === 1) return "#a855f7";
            return "#71717a";

        case 'integrity':
            const secure = node.id.length % 10 !== 0;
            return secure ? "#facc15" : "#ef4444";

        case 'lifecycle':
            return node.lifecycleStatus === 'dead' ? "#3f3f46" : "#facc15";

        case 'standard':
        default:
            return node.kind === 'directory' ? "#3b82f6" : "#facc15";
    }
}

const KnowledgeGraph = ({
    nodes,
    relevantNodeIds,
    onNodeClick,
    viewMode,
    onContextMenu,
    timeSliderValue = 100
}) => {
    const containerRef = useRef(null);
    const svgRef = useRef(null);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [hoveredNode, setHoveredNode] = useState(null);
    const [hoveredNeighbors, setHoveredNeighbors] = useState(new Set());

    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    setDimensions({ width, height });
                }
            }
        });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        if (!nodes.length || !svgRef.current || dimensions.width === 0) return;

        const { width, height } = dimensions;
        const svg = d3.select(svgRef.current);
        svg.selectAll(".graph-content").remove();

        const g = svg.append("g").attr("class", "graph-content");

        const zoom = d3.zoom()
            .scaleExtent([0.1, 8])
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
            });

        svg.call(zoom)
            .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(0.6));

        let displayNodesData = nodes;

        if (timeSliderValue < 100) {
            const cutoff = Date.now() - ((100 - timeSliderValue) * 100000000);
            displayNodesData = nodes.filter(n => (n.creationTime || 0) < cutoff);
        }

        if (displayNodesData.length > 800) {
            displayNodesData = displayNodesData.filter(n => n.kind === 'directory' || relevantNodeIds.includes(n.id) || !n.parentId);
        }

        const displayNodes = displayNodesData.map(d => ({ ...d }));
        const links = [];
        const nodeMap = new Map(displayNodes.map(n => [n.id, n]));

        displayNodes.forEach(node => {
            if (node.parentId && nodeMap.has(node.parentId)) {
                links.push({ source: node.parentId, target: node.id });
            }
        });

        const simulation = d3.forceSimulation(displayNodes)
            .force("link", d3.forceLink(links).id((d) => d.id).distance(d => (d.target.kind === 'directory' ? 80 : 40)))
            .force("charge", d3.forceManyBody().strength(-300))
            .force("collide", d3.forceCollide().radius((d) => d.kind === 'directory' ? 30 : 15).iterations(2))
            .force("center", d3.forceCenter(0, 0))
            .force("x", d3.forceX().strength(0.06))
            .force("y", d3.forceY().strength(0.06));

        const link = g.append("g")
            .attr("stroke", "#3f3f46")
            .attr("stroke-opacity", 0.3)
            .selectAll("line")
            .data(links)
            .join("line")
            .attr("stroke-width", 1)
            .attr("class", "link")
            .attr("stroke-dasharray", (d) => (d.source.isVirtual || d.target.isVirtual) ? "4 4" : "none");

        const node = g.append("g")
            .selectAll("g")
            .data(displayNodes)
            .join("g")
            .attr("class", "node")
            .attr("cursor", "pointer")
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));

        node.append("circle")
            .attr("r", (d) => d.kind === 'directory' ? 12 : 6)
            .attr("fill", (d) => getNodeColor(d, viewMode, relevantNodeIds.includes(d.id)))
            .attr("filter", (d) => d.isVirtual || d.lifecycleStatus === 'dead' ? "none" : "url(#glow)")
            .attr("stroke", (d) => d.isVirtual ? "#a855f7" : "white")
            .attr("stroke-width", (d) => relevantNodeIds.includes(d.id) ? 2 : (d.isVirtual ? 1 : 0))
            .attr("stroke-dasharray", (d) => d.isVirtual ? "2 2" : "none")
            .attr("opacity", (d) => d.lifecycleStatus === 'dead' && viewMode === 'lifecycle' ? 0.3 : 0.8)
            .transition().duration(500)
            .attr("fill", (d) => getNodeColor(d, viewMode, relevantNodeIds.includes(d.id)));

        node.append("circle")
            .attr("r", (d) => d.kind === 'directory' ? 4 : 2)
            .attr("fill", (d) => d.isVirtual ? "#000" : "#fff")
            .attr("opacity", 0.6);

        node
            .on("mouseover", (event, d) => {
                const neighbors = new Set();
                links.forEach((l) => {
                    if (l.source.id === d.id) neighbors.add(l.target.id);
                    if (l.target.id === d.id) neighbors.add(l.source.id);
                });
                neighbors.add(d.id);

                setHoveredNode(nodes.find(n => n.id === d.id) || null);
                setHoveredNeighbors(neighbors);

                node.transition().duration(200).attr("opacity", (n) => neighbors.has(n.id) ? 1 : 0.1);
                link.transition().duration(200).attr("stroke-opacity", (l) => (l.source.id === d.id || l.target.id === d.id) ? 0.8 : 0.05)
                    .attr("stroke", (l) => (l.source.id === d.id || l.target.id === d.id) ? "#fff" : "#3f3f46");
            })
            .on("mouseout", () => {
                setHoveredNode(null);
                setHoveredNeighbors(new Set());

                node.transition().duration(200).attr("opacity", (d) => d.lifecycleStatus === 'dead' && viewMode === 'lifecycle' ? 0.3 : 1);
                link.transition().duration(200).attr("stroke-opacity", 0.3).attr("stroke", "#3f3f46");
            })
            .on("click", (event, d) => {
                const original = nodes.find(n => n.id === d.id);
                if (original && onNodeClick) onNodeClick(original);
            })
            .on("contextmenu", (event, d) => {
                const original = nodes.find(n => n.id === d.id);
                if (original && onContextMenu) onContextMenu(event, original);
            });

        node.append("text")
            .text((d) => d.name)
            .attr("x", (d) => d.kind === 'directory' ? 15 : 10)
            .attr("y", 4)
            .attr("font-size", (d) => d.kind === 'directory' ? "10px" : "8px")
            .attr("font-family", "monospace")
            .attr("fill", (d) => d.isVirtual ? "#a855f7" : (d.lifecycleStatus === 'dead' && viewMode === 'lifecycle' ? '#52525b' : '#e4e4e7'))
            .attr("font-weight", "bold")
            .style("pointer-events", "none")
            .style("text-shadow", "0 2px 4px rgba(0,0,0,0.9)");

        simulation.on("tick", () => {
            link
                .attr("x1", (d) => d.source.x)
                .attr("y1", (d) => d.source.y)
                .attr("x2", (d) => d.target.x)
                .attr("y2", (d) => d.target.y);

            node
                .attr("transform", (d) => `translate(${d.x},${d.y})`);
        });

        function dragstarted(event) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        }

        function dragged(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        }

        function dragended(event) {
            if (!event.active) simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }

    }, [nodes, relevantNodeIds, dimensions, onNodeClick, viewMode, timeSliderValue]);

    return (
        <div ref={containerRef} className="w-full h-full bg-[#050505] overflow-hidden relative">
            <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="block w-full h-full touch-none cursor-move">
                <defs>
                    <filter id="glow" height="300%" width="300%" x="-75%" y="-75%">
                        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                        <feMerge>
                            <feMergeNode in="coloredBlur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                </defs>
            </svg>

            {hoveredNode && (
                <div className="absolute top-4 left-4 z-10 pointer-events-none animate-fade-in">
                    <div className="bg-black/80 backdrop-blur-xl border border-accent/30 rounded-lg p-4 shadow-[0_0_30px_rgba(250,204,21,0.15)] max-w-sm">
                        <div className="flex items-center justify-between mb-3 border-b border-white/10 pb-2">
                            <span className={`text-xs font-bold uppercase tracking-widest ${hoveredNode.isVirtual ? 'text-purple-400' : (hoveredNode.kind === 'directory' ? 'text-blue-400' : 'text-accent')}`}>
                                {hoveredNode.isVirtual ? 'Remote / Virtual Node' : (hoveredNode.kind === 'directory' ? 'Directory Node' : 'File Asset')}
                            </span>
                            <div className="flex gap-2">
                                <span className="text-[9px] bg-white/10 px-1.5 rounded text-white/60">v{hoveredNode.id.charCodeAt(0) % 5}.0</span>
                                <div className={`w-2 h-2 rounded-full ${hoveredNode.isVirtual ? 'bg-purple-500' : 'bg-accent'} animate-pulse`}></div>
                            </div>
                        </div>

                        <div className="space-y-3 font-mono text-[10px]">
                            <div>
                                <div className="text-text-muted mb-0.5 uppercase tracking-tighter">Resource Path</div>
                                <div className="text-text-primary break-all leading-tight">{hoveredNode.path}</div>
                            </div>

                            <div>
                                <div className="text-text-muted mb-0.5 uppercase tracking-tighter">Ledger Hash</div>
                                <div className="text-accent/80 break-all leading-tight text-[9px] opacity-80 font-mono">
                                    {getMockHash(hoveredNode.id)}
                                </div>
                            </div>

                            {viewMode === 'lifecycle' && (
                                <div className={`bg-${hoveredNode.lifecycleStatus === 'dead' ? 'gray' : 'yellow'}-900/20 p-2 rounded border border-${hoveredNode.lifecycleStatus === 'dead' ? 'gray' : 'accent'}-500/30 mt-2`}>
                                    <div className={`${hoveredNode.lifecycleStatus === 'dead' ? 'text-gray-400' : 'text-accent'} mb-1 text-[9px] uppercase tracking-wider flex items-center gap-2 font-bold`}>
                                        Lifecycle Status
                                    </div>
                                    <div className="text-white/70">
                                        {hoveredNode.lifecycleStatus === 'dead' ? 'Node marked as zombie. No recent activity.' : 'Active and semantically healthy.'}
                                    </div>
                                </div>
                            )}

                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                                <div>
                                    <div className="text-text-muted mb-0.5">SIZE</div>
                                    <div className="text-text-primary">{hoveredNode.metadata?.size || 0} bytes</div>
                                </div>
                                <div>
                                    <div className="text-text-muted mb-0.5">ACCESS</div>
                                    <div className="text-text-primary">{(hoveredNode.name.length * 12) % 1000} hits</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="absolute bottom-4 right-4 pointer-events-none">
                <div className="bg-black/60 backdrop-blur px-3 py-1.5 rounded-full border border-white/10 text-[9px] text-text-muted font-mono uppercase tracking-widest flex items-center gap-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${viewMode === 'heatmap' ? 'bg-orange-500' :
                            viewMode === 'integrity' ? 'bg-red-500' :
                                viewMode === 'temporal' ? 'bg-blue-500' :
                                    viewMode === 'lifecycle' ? 'bg-gray-500' : 'bg-accent'
                        }`}></span>
                    Mode: {viewMode}
                </div>
            </div>
        </div>
    );
};

export default KnowledgeGraph;
