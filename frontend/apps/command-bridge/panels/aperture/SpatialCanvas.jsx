import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { Sparkles, Brain, FileText, CheckCircle2, Archive, Search, Compass, Layers, RefreshCw, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import somaBackend from '../../somaBackend';

const CLUSTERS = {
  cognition: { label: 'Cognition & Reflections', color: '#c084fc', x: 280, y: 220, icon: Brain },
  code:      { label: 'Code & Architecture',     color: '#38bdf8', x: 740, y: 200, icon: FileText },
  tasks:     { label: 'Execution & Tasks',       color: '#34d399', x: 320, y: 520, icon: CheckCircle2 },
  vault:     { label: 'Vault & Archives',        color: '#fbbf24', x: 720, y: 500, icon: Archive },
};

const DEFAULT_NODES = [
  // Cognition
  { id: 'cog-1', title: 'Reflections Index', cluster: 'cognition', appId: 'notes', excerpt: 'Knowledge graph connections & self-inquiry' },
  { id: 'cog-2', title: 'Epistemic Scratchpad', cluster: 'cognition', appId: 'notes', excerpt: 'Active reasoning debate & truth verification' },
  { id: 'cog-3', title: 'Autonomous Mission Charter', cluster: 'cognition', appId: 'ainotes', excerpt: 'Directive goals & autonomy boundaries' },
  // Code
  { id: 'code-1', title: 'Aperture Microkernel', cluster: 'code', appId: 'files', path: './frontend/apps/command-bridge/panels/aperture/kernel/ApertureKernel.js', excerpt: 'PID management, VFS /proc mounts & IPC bus' },
  { id: 'code-2', title: 'Aperture Shell UI', cluster: 'code', appId: 'files', path: './frontend/apps/command-bridge/panels/aperture/ApertureOS.jsx', excerpt: 'Spatial window manager and agency bridge' },
  { id: 'code-3', title: 'Aperture Backend Routes', cluster: 'code', appId: 'files', path: './server/routes/apertureRoutes.js', excerpt: 'REST API & WebSocket dispatch pipeline' },
  // Tasks
  { id: 'task-1', title: 'Full Aperture OS Audit', cluster: 'tasks', appId: 'tasks', excerpt: 'Polish context menu, fixes across apps' },
  { id: 'task-2', title: 'Self-Evolution Cycle', cluster: 'tasks', appId: 'tasks', excerpt: 'Meta-learning review and code verification' },
  { id: 'task-3', title: 'Swarm Telemetry Telekinesis', cluster: 'tasks', appId: 'swarm', excerpt: 'Neural DAG links and 231 arbiter telemetry' },
  // Vault
  { id: 'vlt-1', title: 'goals-archive.jsonl', cluster: 'vault', appId: 'archive', excerpt: 'Compacted historical task outcomes' },
  { id: 'vlt-2', title: 'truth-ledger.jsonl', cluster: 'vault', appId: 'archive', excerpt: 'Outcome truth ledger and feedback loop verifications' },
  { id: 'vlt-3', title: 'cost-ledger.json', cluster: 'vault', appId: 'archive', excerpt: 'Token consumption and arbiter cost tracking' },
];

export default function SpatialCanvas({ onLaunchApp }) {
  const [nodes, setNodes] = useState(DEFAULT_NODES);
  const [nodePositions, setNodePositions] = useState({});
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const draggedNode = useRef(null);
  const canvasRef = useRef(null);

  // Initialize node positions clustered around their domain attractor
  useEffect(() => {
    const initialPositions = {};
    nodes.forEach((node, i) => {
      const cluster = CLUSTERS[node.cluster] || CLUSTERS.cognition;
      const angle = (i * 1.8) + (Math.PI / 4);
      const radius = 65 + (i % 3) * 35;
      initialPositions[node.id] = {
        x: cluster.x + Math.cos(angle) * radius,
        y: cluster.y + Math.sin(angle) * radius,
      };
    });
    setNodePositions(initialPositions);
  }, [nodes]);

  // Optionally load real reflections and tasks to enrich canvas
  useEffect(() => {
    const fetchLiveItems = async () => {
      try {
        const [reflections, archiveRes] = await Promise.all([
          somaBackend.fetch('/api/reflections/list').catch(() => null),
          somaBackend.fetch('/api/aperture/archive/list').catch(() => null),
        ]);

        const extraNodes = [];
        if (reflections?.notes) {
          reflections.notes.slice(0, 4).forEach((n, idx) => {
            extraNodes.push({
              id: `ref-${idx}`,
              title: n.title || n.name,
              cluster: 'cognition',
              appId: 'notes',
              excerpt: `Reflection note: ${n.name}`,
            });
          });
        }
        if (archiveRes?.files) {
          archiveRes.files.slice(0, 3).forEach((f, idx) => {
            extraNodes.push({
              id: `arc-${idx}`,
              title: f,
              cluster: 'vault',
              appId: 'archive',
              excerpt: `Archived vault artifact`,
            });
          });
        }

        if (extraNodes.length > 0) {
          setNodes(prev => {
            const existingIds = new Set(prev.map(p => p.title));
            const newOnes = extraNodes.filter(en => !existingIds.has(en.title));
            return [...prev, ...newOnes];
          });
        }
      } catch {}
    };

    fetchLiveItems();
  }, []);

  // Mouse pan handlers for canvas
  const handleMouseDown = (e) => {
    if (e.target.closest('.ap-spatial-node') || e.target.closest('.ap-spatial-control')) return;
    isPanning.current = true;
    panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };

  const handleMouseMove = (e) => {
    if (draggedNode.current) {
      const { id, startX, startY, origX, origY } = draggedNode.current;
      const dx = (e.clientX - startX) / zoom;
      const dy = (e.clientY - startY) / zoom;
      setNodePositions(prev => ({
        ...prev,
        [id]: { x: origX + dx, y: origY + dy }
      }));
      return;
    }

    if (isPanning.current) {
      setPan({
        x: e.clientX - panStart.current.x,
        y: e.clientY - panStart.current.y,
      });
    }
  };

  const handleMouseUp = () => {
    isPanning.current = false;
    draggedNode.current = null;
  };

  // Node drag start
  const handleNodeMouseDown = (e, node) => {
    e.stopPropagation();
    const current = nodePositions[node.id] || { x: 0, y: 0 };
    draggedNode.current = {
      id: node.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: current.x,
      origY: current.y
    };
  };

  const handleNodeClick = (node) => {
    setSelectedNode(node);
    if (onLaunchApp && node.appId) {
      onLaunchApp(node.appId);
    }
  };

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return nodes;
    const q = searchQuery.toLowerCase();
    return nodes.filter(n => n.title.toLowerCase().includes(q) || n.cluster.toLowerCase().includes(q) || n.excerpt.toLowerCase().includes(q));
  }, [nodes, searchQuery]);

  return (
    <div
      ref={canvasRef}
      className="ap-spatial-canvas-viewport"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Top Floating Controls */}
      <div className="ap-spatial-controls ap-spatial-control">
        <div className="ap-spatial-search">
          <Search size={13} className="text-cyan-400" />
          <input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search spatial knowledge galaxy..."
          />
        </div>
        <div className="ap-spatial-zoom-btns">
          <button onClick={() => setZoom(z => Math.min(1.6, z + 0.15))} title="Zoom In"><ZoomIn size={13} /></button>
          <button onClick={() => setZoom(z => Math.max(0.6, z - 0.15))} title="Zoom Out"><ZoomOut size={13} /></button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }} title="Reset View"><Maximize size={13} /></button>
        </div>
      </div>

      {/* Galaxy Canvas Layer */}
      <div
        className="ap-spatial-galaxy-plane"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Render Cluster Centers and Gravitational Rings */}
        {Object.entries(CLUSTERS).map(([key, cluster]) => (
          <div
            key={key}
            className="ap-spatial-cluster-center"
            style={{ left: cluster.x, top: cluster.y }}
          >
            <div className="ap-spatial-cluster-core" style={{ background: cluster.color, boxShadow: `0 0 45px ${cluster.color}55` }}>
              <cluster.icon size={16} />
            </div>
            <span className="ap-spatial-cluster-label" style={{ color: cluster.color }}>{cluster.label}</span>
            <div className="ap-spatial-gravity-ring" style={{ borderColor: `${cluster.color}25` }} />
            <div className="ap-spatial-gravity-ring ring-outer" style={{ borderColor: `${cluster.color}15` }} />
          </div>
        ))}

        {/* Gravitational Link Lines */}
        <svg className="ap-spatial-links-svg" width="2000" height="1500">
          {nodes.map(node => {
            const pos = nodePositions[node.id];
            const cluster = CLUSTERS[node.cluster];
            if (!pos || !cluster) return null;
            const isMatch = filteredNodes.some(fn => fn.id === node.id);
            return (
              <line
                key={`link-${node.id}`}
                x1={cluster.x}
                y1={cluster.y}
                x2={pos.x}
                y2={pos.y}
                stroke={cluster.color}
                strokeOpacity={isMatch ? 0.28 : 0.08}
                strokeWidth={isMatch ? 1.5 : 1}
                strokeDasharray={isMatch ? '3 3' : 'none'}
              />
            );
          })}
        </svg>

        {/* Render Knowledge Nodes */}
        {nodes.map(node => {
          const pos = nodePositions[node.id] || { x: 400, y: 300 };
          const cluster = CLUSTERS[node.cluster] || CLUSTERS.cognition;
          const isMatch = filteredNodes.some(fn => fn.id === node.id);
          const isHovered = hoveredNode?.id === node.id;

          return (
            <div
              key={node.id}
              className={`ap-spatial-node ${isMatch ? 'matched' : 'dimmed'} ${isHovered ? 'hovered' : ''}`}
              style={{
                left: pos.x,
                top: pos.y,
                borderColor: `${cluster.color}55`,
              }}
              onMouseDown={e => handleNodeMouseDown(e, node)}
              onMouseEnter={() => setHoveredNode(node)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => handleNodeClick(node)}
            >
              <div className="ap-spatial-node-icon" style={{ color: cluster.color, background: `${cluster.color}18` }}>
                <cluster.icon size={13} />
              </div>
              <div className="ap-spatial-node-title">{node.title}</div>

              {/* Hover Excerpt Tooltip */}
              {isHovered && (
                <div className="ap-spatial-node-tooltip" style={{ borderLeftColor: cluster.color }}>
                  <div className="ap-spatial-tooltip-header">
                    <span style={{ color: cluster.color }}>{cluster.label}</span>
                    <small>Click to open in {node.appId}</small>
                  </div>
                  <p>{node.excerpt}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
