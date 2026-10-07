
import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { BRAINS } from '../constants';
import { Fragment, FragmentLink } from '../types';

interface FragmentRegistryProps {
  onFragmentClick: (fragment: Fragment) => void;
  highlightBrain: string | null;
  fragments: Fragment[];
  links: FragmentLink[];
  rotation: { x: number; y: number }; 
  onRotate: (rot: { x: number; y: number }) => void;
  tracedFragmentId: string | null;
}

export const FragmentRegistry: React.FC<FragmentRegistryProps> = ({ 
    onFragmentClick, 
    highlightBrain, 
    fragments, 
    links, 
    rotation,
    onRotate,
    tracedFragmentId 
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingNode = useRef(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [zoomK, setZoomK] = useState(1); 

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

  useEffect(() => {
    if (!dimensions.width || !dimensions.height) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove(); 

    const width = dimensions.width;
    const height = dimensions.height;
    const cx = width / 2;
    const cy = height / 2;

    const g = svg.append("g");

    // NAVIGATION SYSTEM
    const zoom = d3.zoom()
        .scaleExtent([0.05, 12])
        .filter((event) => {
           return event.type === 'wheel' || event.button === 2 || event.button === 1 || (event.type === 'mousedown' && event.shiftKey);
        })
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            setZoomK(event.transform.k);
        });
    svg.call(zoom as any).on("dblclick.zoom", null);

    // ROTATION SYSTEM
    const rotationDrag = d3.drag()
        .filter((event) => event.button === 0 && !event.shiftKey) 
        .on("drag", (event) => {
            onRotate({
                y: rotation.y + event.dx * 0.004,
                x: Math.max(-1.5, Math.min(1.5, rotation.x - event.dy * 0.004))
            });
        });
    svg.call(rotationDrag as any);

    svg.on("contextmenu", (event) => event.preventDefault());

    // SIMULATION
    const nodes: any[] = fragments.map(f => ({ 
      ...f,
      vz: (f.isLocked || f.isPromoted) ? 0 : (Math.random() - 0.5) * 0.6,
      z: f.z || (Math.random() * 600 - 300)
    })); 
    
    const edges: any[] = links.map(l => {
      const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
      const targetId = typeof l.target === 'string' ? l.target : l.target.id;
      return { 
        ...l, 
        source: nodes.find(n => n.id === sourceId), 
        target: nodes.find(n => n.id === targetId) 
      };
    }).filter(e => e.source && e.target);

    const tracedSet = new Set<string>();
    if (tracedFragmentId) {
        tracedSet.add(tracedFragmentId);
        edges.forEach((e: any) => {
            if (e.source.id === tracedFragmentId) tracedSet.add(e.target.id);
            if (e.target.id === tracedFragmentId) tracedSet.add(e.source.id);
        });
    }

    const simulation = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(edges).id((d: any) => d.id).distance(60))
      .force("charge", d3.forceManyBody().strength(-50)) 
      .force("center", d3.forceCenter(0, 0))
      .force("collide", d3.forceCollide().radius((d: any) => d.importance * 3.5).iterations(2))
      .alphaTarget(0.01) 
      .velocityDecay(0.12);

    const defs = svg.append("defs");
    Object.values(BRAINS).forEach(brain => {
        const filter = defs.append("filter").attr("id", `glow-${brain.id}`).attr("x", "-100%").attr("y", "-100%").attr("width", "300%").attr("height", "300%");
        filter.append("feGaussianBlur").attr("stdDeviation", "3").attr("result", "blur");
        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "blur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");
    });

    const linkGroup = g.append("g");
    const nodeGroup = g.append("g");

    const linkSelection = linkGroup.selectAll("line")
      .data(edges)
      .join("line")
      .attr("stroke", (d: any) => d.type === 'contradiction' ? '#ef4444' : '#94a3b8') 
      .attr("stroke-width", 0.4);

    const nodeSelection = nodeGroup.selectAll("g")
      .data(nodes)
      .join("g")
      .call(d3.drag()
        .on("start", (event, d: any) => {
             event.sourceEvent.stopPropagation();
             if (!event.active) simulation.alphaTarget(0.2).restart();
             d.fx = d.x; d.fy = d.y;
             isDraggingNode.current = false;
        })
        .on("drag", (event, d: any) => {
             d.fx = event.x; d.fy = event.y;
             isDraggingNode.current = true;
        })
        .on("end", (event, d: any) => {
             if (!event.active) simulation.alphaTarget(0.01);
             d.fx = null; d.fy = null;
             isDraggingNode.current = false;
        }) as any
      )
      .on("click", (event, d: any) => {
        if (isDraggingNode.current) return;
        event.stopPropagation();
        onFragmentClick(d);
      });

    nodeSelection.append("circle")
      .attr("class", "pulse-circle")
      .attr("fill", (d: any) => BRAINS[d.domain].color)
      .attr("opacity", 0.08);

    nodeSelection.append("circle")
      .attr("class", "core-circle")
      .attr("fill", (d: any) => d.isContradiction ? '#ef4444' : BRAINS[d.domain].color)
      .attr("filter", (d: any) => `url(#glow-${d.domain})`)
      .attr("stroke", (d: any) => d.isPromoted ? '#ffffff' : (d.isNewSeed ? '#facc15' : 'rgba(255,255,255,0.2)'))
      .attr("stroke-width", (d: any) => d.isPromoted ? 2.5 : 0.5);

    nodeSelection.append("text")
      .attr("class", "fragment-label")
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("fill", "#e2e8f0")
      .style("pointer-events", "none")
      .style("font-family", "'Rajdhani', sans-serif")
      .style("font-weight", "600")
      .style("text-shadow", "0 0 8px rgba(0,0,0,1)");

    const project = (x: number, y: number, z: number) => {
        const cosY = Math.cos(rotation.y);
        const sinY = Math.sin(rotation.y);
        const x1 = x * cosY - z * sinY;
        const z1 = z * cosY + x * sinY;
        const cosX = Math.cos(rotation.x);
        const sinX = Math.sin(rotation.x);
        const y2 = y * cosX - z1 * sinX;
        const z2 = z1 * cosX + y * sinX;
        const focalLength = 1000;
        const scale = focalLength / (focalLength + z2);
        return { x: cx + x1 * scale, y: cy + y2 * scale, scale, z: z2 };
    };

    simulation.on("tick", () => {
        nodes.forEach(d => {
            if (d.vz && !d.isLocked && !d.isPromoted) {
                d.z += d.vz;
                if (d.z > 500 || d.z < -500) d.vz *= -1;
            }
            const proj = project(d.x, d.y, d.z || 0);
            d.px = proj.x; d.py = proj.y; d.pz = proj.z; d.pscale = proj.scale;
        });

        nodeSelection.sort((a: any, b: any) => b.pz - a.pz);

        linkSelection
            .attr("x1", (d: any) => d.source.px)
            .attr("y1", (d: any) => d.source.py)
            .attr("x2", (d: any) => d.target.px)
            .attr("y2", (d: any) => d.target.py)
            .attr("stroke-dasharray", (d: any) => (d.source.simulated || d.target.simulated) ? "2,2" : null)
            .attr("stroke", (d: any) => (d.source.simulated || d.target.simulated) ? "#22d3ee" : (d.type === 'contradiction' ? '#ef4444' : '#94a3b8'))
            .attr("opacity", (d: any) => tracedFragmentId ? (d.source.id === tracedFragmentId || d.target.id === tracedFragmentId ? 0.8 : 0.05) : 0.2 * Math.min(1, d.source.pscale * d.target.pscale));

        nodeSelection.attr("transform", (d: any) => `translate(${d.px},${d.py})`);
        
        nodeSelection.select(".pulse-circle")
            .attr("r", (d: any) => (d.isPromoted ? d.importance * 3.5 : d.importance * 2) * d.pscale)
            .attr("opacity", (d: any) => (tracedFragmentId && !tracedSet.has(d.id)) ? 0.02 : (d.simulated ? 0.4 : (d.isPromoted ? 0.2 : 0.08)))
            .attr("fill", (d: any) => d.simulated ? "#22d3ee" : BRAINS[d.domain].color)
            .attr("class", (d: any) => d.simulated ? "pulse-circle animate-pulse" : "pulse-circle");
            
        nodeSelection.select(".core-circle")
            .attr("r", (d: any) => (d.importance * 0.7 + 2) * d.pscale)
            .attr("stroke-width", (d: any) => d.isPromoted ? 3 * d.pscale : 1 * d.pscale)
            .attr("fill", (d: any) => d.simulated ? "#fff" : (d.isContradiction ? '#ef4444' : BRAINS[d.domain].color))
            .attr("opacity", (d: any) => (tracedFragmentId && !tracedSet.has(d.id)) ? 0.1 : 1);

        nodeSelection.select("text")
            .text((d: any) => `[#${d.id.split('-')[1] || d.id}] ${d.label}`)
            .attr("font-size", (d: any) => `${(12 / zoomK) * d.pscale + 2}px`)
            .attr("opacity", (d: any) => {
                if (d.simulated) return 1;
                if (tracedFragmentId) return tracedSet.has(d.id) ? 1 : 0;
                const actualSize = d.pscale * zoomK;
                const threshold = (d.isPromoted || d.importance > 8) ? 1.5 : 2.5;
                if (actualSize < threshold) return 0;
                return Math.min(1, (actualSize - threshold) * 2);
            }); 
    });

    if (highlightBrain) {
        nodeSelection.transition().duration(500).attr("opacity", (d: any) => d.domain === highlightBrain ? 1 : 0.1);
    }

    return () => simulation.stop();
  }, [dimensions, highlightBrain, onFragmentClick, fragments, links, rotation, tracedFragmentId, zoomK]);

  return (
    <div ref={containerRef} className="absolute inset-0 w-full h-full z-10">
      <div className="absolute top-24 left-1/2 -translate-x-1/2 pointer-events-none text-slate-600 text-[9px] uppercase tracking-[0.3em] font-bold opacity-30">
        Left Drag: Orbit • Right Drag: Pan • Scroll: Depth
      </div>
      <svg ref={svgRef} className="w-full h-full overflow-visible bg-transparent"></svg>
    </div>
  );
};
