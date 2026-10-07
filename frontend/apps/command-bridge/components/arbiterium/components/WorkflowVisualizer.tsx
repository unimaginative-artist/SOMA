import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { WorkflowStep, TaskStatus, Arbiter } from '../types';
import { ChevronRight, Activity, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';

interface WorkflowVisualizerProps {
  steps: WorkflowStep[];
  arbiters: Arbiter[];
  onNodeClick?: (stepId: string, description: string, status: TaskStatus) => void;
}

interface Node extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  fullDescription: string;
  role: string;
  status: TaskStatus;
  avatarUrl?: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface Link extends d3.SimulationLinkDatum<Node> {
  source: string | Node;
  target: string | Node;
}

const WorkflowVisualizer: React.FC<WorkflowVisualizerProps> = ({ steps, arbiters, onNodeClick }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  
  // Persist simulation and nodes data to prevent layout jumps on re-renders
  const simulationRef = useRef<d3.Simulation<Node, undefined> | null>(null);
  const nodesRef = useRef<Node[]>([]);

  useEffect(() => {
    if (!svgRef.current || !wrapperRef.current || steps.length === 0) return;

    const width = wrapperRef.current.clientWidth;
    const height = wrapperRef.current.clientHeight;
    // PADDING adjusted for larger nodes: (Glow radius 32) + safety
    const PADDING = 45; 
    
    // Select SVG
    const svg = d3.select(svgRef.current)
      .attr("viewBox", [0, 0, width, height])
      .style("font-family", "Inter, sans-serif");

    // 1. Setup Definitions (Markers, Filters) - Only once
    svg.select("defs").remove();

    if (svg.select("defs").empty()) {
        const defs = svg.append("defs");
        
        // Arrow - Adjusted RefX for larger nodes (radius 24 + padding)
        defs.append("marker")
          .attr("id", "arrow")
          .attr("viewBox", "0 -5 10 10")
          .attr("refX", 36) 
          .attr("refY", 0)
          .attr("markerWidth", 5)
          .attr("markerHeight", 5)
          .attr("orient", "auto")
          .append("path")
          .attr("fill", "#A855F7") 
          .attr("opacity", 0.6)
          .attr("d", "M0,-5L10,0L0,5");

        // Glow Filter
        const filter = defs.append("filter")
          .attr("id", "glow")
          .attr("x", "-50%")
          .attr("y", "-50%")
          .attr("width", "200%")
          .attr("height", "200%");
        filter.append("feGaussianBlur")
          .attr("stdDeviation", "1.5")
          .attr("result", "coloredBlur");
        const feMerge = filter.append("feMerge");
        feMerge.append("feMergeNode").attr("in", "coloredBlur");
        feMerge.append("feMergeNode").attr("in", "SourceGraphic");

        // Clip Path - Increased for larger nodes (r=24)
        defs.append("clipPath")
          .attr("id", "circle-clip")
          .append("circle")
          .attr("r", 24)
          .attr("cx", 0)
          .attr("cy", 0);
    }

    // 2. Process Data - Merge with existing to preserve positions
    const existingNodesMap = new Map<string, Node>(nodesRef.current.map(n => [n.id, n]));
    
    const nodes: Node[] = steps.map(s => {
      const existing = existingNodesMap.get(s.id);
      const assignedArbiter = arbiters.find(a => a.role === s.assignedArbiterRole);
      
      return {
        id: s.id,
        label: s.description.length > 20 ? s.description.substring(0, 18) + '...' : s.description,
        fullDescription: s.description,
        role: s.assignedArbiterRole,
        status: s.status,
        avatarUrl: assignedArbiter?.avatarUrl,
        // Critical: Reuse x/y/vx/vy if available to prevent jump
        x: existing?.x ?? width / 2 + (Math.random() - 0.5) * 50, 
        y: existing?.y ?? height / 2 + (Math.random() - 0.5) * 50,
        vx: existing?.vx || 0,
        vy: existing?.vy || 0,
        fx: existing?.fx || null,
        fy: existing?.fy || null
      };
    });
    
    nodesRef.current = nodes; // Update ref

    const links: Link[] = [];
    steps.forEach(step => {
      step.dependencies.forEach(depId => {
        if (steps.find(s => s.id === depId)) {
          links.push({ source: depId, target: step.id });
        }
      });
    });

    // 3. Draw/Update Elements using Join Pattern
    
    // -- Links --
    const linkGroup = svg.select<SVGGElement>(".links-group");
    const linkG = linkGroup.empty() ? svg.append("g").attr("class", "links-group") : linkGroup;

    const link = linkG
      .selectAll("line")
      .data(links, (d: any) => `${d.source.id || d.source}-${d.target.id || d.target}`)
      .join("line")
      .attr("stroke", "#C026D3")
      .attr("stroke-opacity", 0.3)
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrow)");

    // -- Nodes --
    const nodeGroup = svg.select<SVGGElement>(".nodes-group");
    const nodeG = nodeGroup.empty() ? svg.append("g").attr("class", "nodes-group") : nodeGroup;

    const node = nodeG
      .selectAll("g.node")
      .data(nodes, (d: any) => d.id)
      .join(
        enter => {
            const g = enter.append("g")
                .attr("class", "node")
                .attr("cursor", "pointer")
                .call(d3.drag<SVGGElement, Node>()
                    .on("start", dragstarted)
                    .on("drag", dragged)
                    .on("end", dragended)
                );
            
            // Outer Glow Circle - Scaled up (26 -> 32)
            g.append("circle")
                .attr("class", "outer-glow")
                .attr("r", 32)
                .attr("fill", "none")
                .attr("stroke-width", 1)
                .attr("stroke-dasharray", "3 3")
                .attr("opacity", 0.5);

            // Main Circle - Scaled up (20 -> 24)
            g.append("circle")
                .attr("class", "main-circle")
                .attr("r", 24)
                .attr("stroke-width", 1);
                
            // Avatar Image - Scaled up (40x40 -> 48x48)
            g.append("image")
                .attr("class", "avatar")
                .attr("x", -24)
                .attr("y", -24)
                .attr("width", 48)
                .attr("height", 48)
                .attr("clip-path", "url(#circle-clip)")
                .attr("preserveAspectRatio", "xMidYMid slice");
                
            // Role Initials - Font size slightly increased
            g.append("text")
                .attr("class", "initials")
                .attr("text-anchor", "middle")
                .attr("dy", "0.35em")
                .attr("font-size", "12px")
                .attr("font-weight", "800")
                .style("pointer-events", "none");
                
            // Status Dot - Position adjusted for r=24 circle (approx 17px offset)
            g.append("circle")
                 .attr("class", "status-dot")
                 .attr("r", 4)
                 .attr("cx", 17)
                 .attr("cy", -17)
                 .attr("stroke", "#090410")
                 .attr("stroke-width", 1);
                 
            return g;
        }
      );

    // Update Attributes for all nodes (enter + update)
    node.each(function(d) {
        const g = d3.select(this);
        
        g.on("click", (event) => {
             event.stopPropagation();
             if (onNodeClick) {
                 onNodeClick(d.id, d.fullDescription, d.status);
             }
        });
        
        g.on("mouseenter", (event) => {
             const tooltip = svg.select<SVGGElement>(".svg-tooltip");
             tooltip.style("opacity", 1);
             tooltip.select("text.role").text(d.role);
             tooltip.select("text.desc").text(d.fullDescription.length > 25 ? d.fullDescription.substring(0, 22) + "..." : d.fullDescription);
             (d as any)._hovered = true;
        }).on("mouseleave", () => {
             svg.select(".svg-tooltip").style("opacity", 0);
             (d as any)._hovered = false;
        });

        g.select(".outer-glow")
            .attr("stroke", () => {
                 if (d.status === TaskStatus.IN_PROGRESS) return "#D8B4FE";
                 if (d.status === TaskStatus.COMPLETED) return "#34D399";
                 return "transparent";
            })
            .classed("animate-spin-slow", d.status === TaskStatus.IN_PROGRESS);

        g.select(".main-circle")
            .attr("fill", () => {
                if (d.status === TaskStatus.COMPLETED) return "#064E3B";
                if (d.status === TaskStatus.IN_PROGRESS) return "#4C1D95";
                if (d.status === TaskStatus.FAILED) return "#7F1D1D";
                return "#150A26";
            })
            .attr("stroke", () => {
                if (d.status === TaskStatus.COMPLETED) return "#34D399";
                if (d.status === TaskStatus.IN_PROGRESS) return "#D8B4FE";
                if (d.status === TaskStatus.FAILED) return "#EF4444";
                return "#A855F7";
            })
            .style("filter", d.status === TaskStatus.IN_PROGRESS || d.status === TaskStatus.COMPLETED ? "url(#glow)" : "none");
            
        const showAvatar = !!(d.avatarUrl && (d.status === TaskStatus.IN_PROGRESS || d.status === TaskStatus.COMPLETED));
        
        g.select(".avatar")
            .attr("href", d.avatarUrl || "")
            .attr("opacity", d.status === TaskStatus.COMPLETED ? 0.8 : 1)
            .style("display", showAvatar ? "block" : "none");
            
        g.select(".initials")
            .text(d.role.substring(0, 2).toUpperCase())
            .attr("fill", d.status === TaskStatus.PENDING ? "#A78BFA" : "#FAF5FF")
            .style("display", showAvatar ? "none" : "block");
            
        g.select(".status-dot")
            .attr("fill", () => {
                if (d.status === TaskStatus.COMPLETED) return "#34D399";
                if (d.status === TaskStatus.IN_PROGRESS) return "#F0ABFC";
                if (d.status === TaskStatus.FAILED) return "#EF4444";
                return "#4B5563";
            });
    });

    // -- SVG Tooltip --
    let tooltip = svg.select<SVGGElement>(".svg-tooltip");
    if (tooltip.empty()) {
        tooltip = svg.append("g")
           .attr("class", "svg-tooltip")
           .attr("opacity", 0)
           .style("pointer-events", "none");
           
        tooltip.append("rect")
           .attr("width", 140)
           .attr("height", 45)
           .attr("x", -70)
           .attr("y", -60) // Adjusted y offset for larger node
           .attr("rx", 6)
           .attr("fill", "rgba(15, 5, 24, 0.95)")
           .attr("stroke", "rgba(168, 85, 247, 0.4)")
           .attr("stroke-width", 1);
           
        tooltip.append("text")
           .attr("class", "role")
           .attr("x", 0)
           .attr("y", -45) // Adjusted y offset
           .attr("text-anchor", "middle")
           .attr("fill", "#D8B4FE")
           .attr("font-size", "9px")
           .attr("font-weight", "bold")
           .attr("text-transform", "uppercase");
           
        tooltip.append("text")
           .attr("class", "desc")
           .attr("x", 0)
           .attr("y", -33) // Adjusted y offset
           .attr("text-anchor", "middle")
           .attr("fill", "#FAF5FF")
           .attr("font-size", "9px");
    }
    
    tooltip.raise();

    // 4. Update Simulation
    if (!simulationRef.current) {
        simulationRef.current = d3.forceSimulation<Node, Link>(nodes)
          .force("link", d3.forceLink<Node, Link>(links).id(d => d.id).distance(100)) // Reduced distance
          .force("charge", d3.forceManyBody().strength(-400)) // Reduced repulsion
          .force("center", d3.forceCenter(width / 2, height / 2))
          .force("collide", d3.forceCollide().radius(45)); // Increased collision radius for larger nodes
          
        simulationRef.current.on("tick", ticked);
    } else {
        simulationRef.current.nodes(nodes);
        const linkForce = simulationRef.current.force("link") as d3.ForceLink<Node, Link>;
        linkForce.links(links).distance(100); 
        const collideForce = simulationRef.current.force("collide") as d3.ForceCollide<Node>;
        collideForce.radius(45);
        
        simulationRef.current.alpha(0.1).restart();
    }

    function ticked() {
      nodes.forEach(d => {
        if (d.x! < PADDING) {
          d.x = PADDING;
          d.vx! *= -0.5;
        } else if (d.x! > width - PADDING) {
          d.x = width - PADDING;
          d.vx! *= -0.5;
        }
        if (d.y! < PADDING) {
          d.y = PADDING;
          d.vy! *= -0.5;
        } else if (d.y! > height - PADDING) {
          d.y = height - PADDING;
          d.vy! *= -0.5;
        }
      });

      link
        .attr("x1", d => (d.source as Node).x!)
        .attr("y1", d => (d.source as Node).y!)
        .attr("x2", d => (d.target as Node).x!)
        .attr("y2", d => (d.target as Node).y!);

      node.attr("transform", d => {
          if ((d as any)._hovered) {
             tooltip.attr("transform", `translate(${d.x},${d.y})`);
          }
          return `translate(${d.x},${d.y})`;
      });
    }
    
    function dragstarted(event: any, d: Node) {
      if (!event.active) simulationRef.current?.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }

    function dragged(event: any, d: Node) {
      d.fx = Math.max(PADDING, Math.min(width - PADDING, event.x));
      d.fy = Math.max(PADDING, Math.min(height - PADDING, event.y));
    }

    function dragended(event: any, d: Node) {
      if (!event.active) simulationRef.current?.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
    
  }, [steps, arbiters, onNodeClick]); 
  
  useEffect(() => {
    return () => {
        simulationRef.current?.stop();
    };
  }, []);

  return (
    <div ref={wrapperRef} className="w-full h-full relative overflow-hidden bg-transparent">
      <svg ref={svgRef} className="w-full h-full"></svg>
      <style>{`
        .animate-spin-slow {
            animation: spin 3s linear infinite;
            transform-origin: center;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default WorkflowVisualizer;