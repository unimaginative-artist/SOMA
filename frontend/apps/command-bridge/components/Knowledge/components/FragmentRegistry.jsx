import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BRAINS } from '../constants.js';

export const FragmentRegistry = ({
    onFragmentClick,
    highlightBrain,
    fragments,
    links,
    rotation,
    onRotate,
    tracedFragmentId,
    showVisuals = true
}) => {
    const svgRef = useRef(null);
    const gRef = useRef(null);
    const containerRef = useRef(null);
    const simulationRef = useRef(null);
    const isDraggingNode = useRef(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const rotationRef = useRef(rotation);
    const zoomRef = useRef({ k: 1, x: 0, y: 0 });

    useEffect(() => { rotationRef.current = rotation; }, [rotation]);

    // Handle Resize
    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current) {
                setDimensions({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight,
                });
            }
        };
        window.addEventListener('resize', handleResize);
        handleResize();
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // INITIALIZE SVG & G
    useEffect(() => {
        if (!dimensions.width || !dimensions.height) return;
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove(); // Clear once on mount/resize

        const g = svg.append("g");
        gRef.current = g;

        // Setup Zoom & Pan
        const zoom = d3.zoom()
            .scaleExtent([0.1, 8])
            .filter(event => event.type === 'wheel' || event.button === 2)
            .on("zoom", (event) => {
                g.attr("transform", event.transform);
                zoomRef.current = { k: event.transform.k, x: event.transform.x, y: event.transform.y };
            });
        svg.call(zoom).on("dblclick.zoom", null);

        // Setup Orbit Rotation
        const rotationDrag = d3.drag()
            .filter(event => event.button === 0)
            .on("drag", (event) => {
                onRotate({
                    y: rotationRef.current.y + event.dx * 0.004,
                    x: Math.max(-1.5, Math.min(1.5, rotationRef.current.x - event.dy * 0.004))
                });
            });
        svg.call(rotationDrag);
        svg.on("contextmenu", (event) => event.preventDefault());

        // Create Defs for Glow
        const defs = svg.append("defs");
        Object.values(BRAINS).forEach(brain => {
            const filter = defs.append("filter").attr("id", `glow-${brain.id}`).attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%");
            filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
            const feMerge = filter.append("feMerge");
            feMerge.append("feMergeNode").attr("in", "blur");
            feMerge.append("feMergeNode").attr("in", "SourceGraphic");
        });

    }, [dimensions.width, dimensions.height]);

    // MANAGE SIMULATION
    useEffect(() => {
        if (!dimensions.width || !fragments.length) return;

        const clusterCenters = {
            'AURORA': { x: -200, y: -150 },
            'PROMETHEUS': { x: 200, y: -150 },
            'LOGOS': { x: 0, y: 150 },
            'THALAMUS': { x: 0, y: 0 }
        };

        // Cap to 300 nodes — beyond that the simulation crashes the browser tab
        const cappedFragments = fragments.slice(0, 300);

        // Normalize data
        const nodes = cappedFragments.map(f => {
            const existing = simulationRef.current?.nodes().find(n => n.id === f.id);
            return {
                ...f,
                x: existing?.x || (Math.random() - 0.5) * 200,
                y: existing?.y || (Math.random() - 0.5) * 200,
                z: existing?.z || (Math.random() - 0.5) * 100 // Narrower Z-slice
            };
        });

        const edges = links.map(l => {
            const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
            const targetId = typeof l.target === 'string' ? l.target : l.target.id;
            return {
                ...l,
                source: nodes.find(n => n.id === sourceId),
                target: nodes.find(n => n.id === targetId)
            };
        }).filter(e => e.source && e.target);

        // Update or Create Simulation
        if (!simulationRef.current) {
            simulationRef.current = d3.forceSimulation(nodes)
                .force("link", d3.forceLink(edges).id(d => d.id).distance(60).strength(0.3)) 
                .force("charge", d3.forceManyBody().strength(-60))
                .force("clusterX", d3.forceX(d => clusterCenters[d.domain]?.x || 0).strength(0.02)) 
                .force("clusterY", d3.forceY(d => clusterCenters[d.domain]?.y || 0).strength(0.02))
                .force("center", d3.forceCenter(0, 0).strength(0.01))
                .force("collide", d3.forceCollide().radius(d => d.importance * 4).iterations(2))
                .velocityDecay(0.4)  // Normal friction — nodes settle
                .alphaDecay(0.02)    // Slow cool-down so layout has time to form
                .alphaTarget(0);     // Simulation cools and stops — no infinite CPU drain
        } else {
            simulationRef.current.nodes(nodes);
            simulationRef.current.force("link").links(edges);
            simulationRef.current.alpha(0.5).restart();
        }

        const g = gRef.current;
        g.selectAll(".link-layer, .node-layer").remove();
        const linkGroup = g.append("g").attr("class", "link-layer");
        const nodeGroup = g.append("g").attr("class", "node-layer");

        const linkSelection = linkGroup.selectAll("line")
            .data(edges)
            .join("line")
            .attr("stroke", d => d.type === 'contradiction' ? '#ef4444' : '#94a3b8')
            .attr("stroke-width", 0.5);

        const nodeSelection = nodeGroup.selectAll("g")
            .data(nodes)
            .join("g")
            .call(d3.drag()
                .on("start", (event, d) => {
                    if (!event.active) simulationRef.current.alphaTarget(0.1).restart();
                    d.fx = d.x; d.fy = d.y;
                })
                .on("drag", (event, d) => {
                    d.fx = event.x; d.fy = event.y;
                    isDraggingNode.current = true;
                })
                .on("end", (event, d) => {
                    if (!event.active) simulationRef.current.alphaTarget(0);
                    d.fx = null; d.fy = null;
                    isDraggingNode.current = false;
                }))
            .on("click", (event, d) => {
                if (!isDraggingNode.current) onFragmentClick(d);
            });

        nodeSelection.append("circle").attr("class", "core-circle")
            .attr("fill", d => d.isContradiction ? '#ef4444' : BRAINS[d.domain].color)
            .attr("filter", d => `url(#glow-${d.domain})`);

        nodeSelection.append("text").attr("class", "fragment-label")
            .attr("text-anchor", "middle").attr("fill", "#fff")
            .style("pointer-events", "none").style("font-family", "monospace");

        // TICK LOOP
        const cx = dimensions.width / 2;
        const cy = dimensions.height / 2;

        const project = (x, y, z) => {
            const rot = rotationRef.current;
            const cosY = Math.cos(rot.y), sinY = Math.sin(rot.y);
            const x1 = x * cosY - z * sinY, z1 = z * cosY + x * sinY;
            const cosX = Math.cos(rot.x), sinX = Math.sin(rot.x);
            const y2 = y * cosX - z1 * sinX, z2 = z1 * cosX + y * sinX;
            const focal = 600;
            const scale = focal / (focal + z2);
            
            // Clamp scale to prevent massive text
            const clampedScale = Math.max(0.2, Math.min(1.2, scale));
            return { x: cx + x1 * clampedScale, y: cy + y2 * clampedScale, scale: clampedScale };
        };

        simulationRef.current.on("tick", () => {
            nodes.forEach(d => {

                const p = project(d.x, d.y, d.z || 0);
                d.px = p.x; d.py = p.y; d.pscale = p.scale;
            });

            linkSelection
                .attr("x1", d => d.source.px).attr("y1", d => d.source.py)
                .attr("x2", d => d.target.px).attr("y2", d => d.target.py)
                .attr("opacity", d => Math.min(0.2, d.source.pscale * d.target.pscale));

            nodeSelection.attr("transform", d => `translate(${d.px},${d.py})`);
            
            nodeSelection.select(".core-circle")
                .attr("r", d => (d.importance * 0.6 + 2) * d.pscale);
            
            nodeSelection.select("text")
                .text(d => d.label)
                .attr("font-size", d => `${Math.min(14, 10 * d.pscale)}px`)
                .attr("opacity", d => (tracedFragmentId === d.id) ? 1 : 0); // HIDE UNTIL CLICKED
        });

        // LOCK AFTER SETTLE
        const lockTimer = setTimeout(() => {
            if (simulationRef.current) simulationRef.current.stop();
        }, 3000);

        return () => {
            clearTimeout(lockTimer);
        };
    }, [fragments, links, dimensions]);

    return (
        <div ref={containerRef} className="absolute inset-0 w-full h-full bg-transparent overflow-hidden">
            <svg ref={svgRef} className="w-full h-full overflow-visible"></svg>
        </div>
    );
};