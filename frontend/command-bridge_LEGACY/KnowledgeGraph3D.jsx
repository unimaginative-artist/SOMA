import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Sphere, Line, Stars, Trail } from '@react-three/drei';
import * as THREE from 'three';
import { Sparkles, Zap, RotateCw, ChevronDown, ChevronUp } from 'lucide-react';

// Particle system for ambient fractal effect
const FractalParticles = ({ shouldRotate = false }) => {
  const particlesRef = useRef();
  const particleCount = 1000;
  
  const particles = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    
    for (let i = 0; i < particleCount; i++) {
      // Fractal distribution (sphere + noise)
      const radius = 15 + Math.random() * 10;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      
      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = radius * Math.cos(phi);
      
      // Color gradient (blue to purple to pink)
      const t = Math.random();
      colors[i * 3] = 0.5 + t * 0.5; // R
      colors[i * 3 + 1] = 0.2 + t * 0.3; // G
      colors[i * 3 + 2] = 0.8 + t * 0.2; // B
    }
    
    return { positions, colors };
  }, []);
  
  useFrame(() => {
    if (particlesRef.current && shouldRotate) {
      // Smooth Y-axis rotation only (no flipping)
      particlesRef.current.rotation.y += 0.001;
    }
  });
  
  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={particleCount}
          array={particles.positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={particleCount}
          array={particles.colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        vertexColors
        transparent
        opacity={0.6}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

// Enhanced node with glow and pulse effect
const GraphNode = ({ position, label, color, onClick, isSelected, connections }) => {
  const meshRef = useRef();
  const glowRef = useRef();
  
  // Color based on connection count
  const nodeColor = useMemo(() => {
    if (connections > 10) return '#ec4899'; // Pink - highly connected
    if (connections > 5) return '#8b5cf6';  // Purple - well connected
    if (connections > 2) return '#6366f1';  // Blue - connected
    return '#10b981';                        // Green - few connections
  }, [connections]);
  
  // Pulse animation based on connections
  useFrame((state) => {
    if (meshRef.current) {
      if (isSelected) {
        meshRef.current.rotation.y += 0.03;
        meshRef.current.rotation.x += 0.01;
      }
      
      // Pulse based on connection strength
      const pulse = Math.sin(state.clock.elapsedTime * 2 + connections * 0.5) * 0.1 + 1;
      meshRef.current.scale.setScalar(isSelected ? pulse * 1.2 : pulse * 0.8);
    }
    
    // Glow effect
    if (glowRef.current) {
      glowRef.current.scale.setScalar(1.5 + Math.sin(state.clock.elapsedTime * 3) * 0.2);
    }
  });
  
  // Size based on connections (more connections = bigger node)
  const nodeSize = 0.2 + Math.min(connections * 0.05, 0.5);
  
  return (
    <group position={position}>
      {/* Outer glow */}
      <Sphere ref={glowRef} args={[nodeSize * 1.8, 16, 16]}>
        <meshBasicMaterial
          color={nodeColor}
          transparent
          opacity={0.1}
          blending={THREE.AdditiveBlending}
        />
      </Sphere>
      
      {/* Main node */}
      <Sphere 
        ref={meshRef}
        args={[nodeSize, 32, 32]} 
        onClick={onClick}
      >
        <meshStandardMaterial 
          color={nodeColor} 
          emissive={nodeColor}
          emissiveIntensity={isSelected ? 0.8 : 0.4}
          metalness={0.6}
          roughness={0.2}
        />
      </Sphere>
      
      {/* Label */}
      {(isSelected || connections > 5) && (
        <Text
          position={[0, nodeSize + 0.4, 0]}
          fontSize={0.15}
          color="white"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#000000"
        >
          {label}
        </Text>
      )}
    </group>
  );
};

// Enhanced edge with flow animation
const GraphEdge = ({ start, end, strength = 0.5, color = "#666666" }) => {
  const lineRef = useRef();
  const points = useMemo(() => [
    new THREE.Vector3(...start), 
    new THREE.Vector3(...end)
  ], [start, end]);
  
  useFrame((state) => {
    if (lineRef.current) {
      // Pulse effect based on strength
      const opacity = 0.2 + strength * 0.5 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      lineRef.current.material.opacity = opacity;
    }
  });
  
  return (
    <line ref={lineRef}>
      <bufferGeometry attach="geometry">
        <bufferAttribute
          attach="attributes-position"
          count={points.length}
          array={new Float32Array(points.flatMap(p => [p.x, p.y, p.z]))}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial
        attach="material"
        color={color}
        linewidth={strength * 3}
        transparent
        opacity={0.3 + strength * 0.4}
        blending={THREE.AdditiveBlending}
      />
    </line>
  );
};

// Connection pulse particles
const ConnectionPulse = ({ start, end, speed = 0.5 }) => {
  const ref = useRef();
  
  useFrame((state) => {
    if (ref.current) {
      const t = (Math.sin(state.clock.elapsedTime * speed) + 1) / 2;
      ref.current.position.lerpVectors(
        new THREE.Vector3(...start),
        new THREE.Vector3(...end),
        t
      );
    }
  });
  
  return (
    <Sphere ref={ref} args={[0.08, 8, 8]}>
      <meshBasicMaterial
        color="#00ffff"
        transparent
        opacity={0.6}
        blending={THREE.AdditiveBlending}
      />
    </Sphere>
  );
};

const KnowledgeGraph3D = ({ nodes, edges, onNodeClick }) => {
  const [selectedNode, setSelectedNode] = useState(null);
  const [showParticles, setShowParticles] = useState(true);
  const [showPulses, setShowPulses] = useState(true);
  const [autoRotate, setAutoRotate] = useState(true);
  const [statsCollapsed, setStatsCollapsed] = useState(false);

  const handleNodeClick = (nodeId) => {
    setSelectedNode(nodeId);
    if (onNodeClick) onNodeClick(nodeId);
  };
  
  // Calculate node connection counts
  const nodeConnections = useMemo(() => {
    const counts = {};
    edges.forEach(edge => {
      const sourceId = edge.sourceId || edge.source?.id || edge.source;
      const targetId = edge.targetId || edge.target?.id || edge.target;
      counts[sourceId] = (counts[sourceId] || 0) + 1;
      counts[targetId] = (counts[targetId] || 0) + 1;
    });
    return counts;
  }, [edges]);
  
  // Filter strong connections for pulses
  const strongEdges = useMemo(() => 
    edges.filter((_, idx) => idx % 3 === 0).slice(0, 20),
    [edges]
  );

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Controls */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        zIndex: 10,
        display: 'flex',
        gap: '8px',
        flexDirection: 'column'
      }}>
        <button
          onClick={() => {
            console.log('Particles clicked! New state:', !showParticles);
            setShowParticles(!showParticles);
          }}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200 ${
            showParticles 
              ? 'bg-white/10 text-white shadow-lg border border-white/5' 
              : 'text-zinc-400 bg-white/5 hover:text-zinc-100 border border-transparent hover:border-white/5'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${showParticles ? 'text-purple-400' : 'text-zinc-500'}`} />
          <span className="font-medium text-xs">Particles {showParticles ? 'ON' : 'OFF'}</span>
        </button>
        <button
          onClick={() => {
            console.log('Pulses clicked! New state:', !showPulses);
            setShowPulses(!showPulses);
          }}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200 ${
            showPulses 
              ? 'bg-white/10 text-white shadow-lg border border-white/5' 
              : 'text-zinc-400 bg-white/5 hover:text-zinc-100 border border-transparent hover:border-white/5'
          }`}
        >
          <Zap className={`w-4 h-4 ${showPulses ? 'text-cyan-400' : 'text-zinc-500'}`} />
          <span className="font-medium text-xs">Pulses {showPulses ? 'ON' : 'OFF'}</span>
        </button>
        <button
          onClick={() => {
            console.log('Rotate clicked! New state:', !autoRotate);
            setAutoRotate(!autoRotate);
          }}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg transition-all duration-200 ${
            autoRotate 
              ? 'bg-white/10 text-white shadow-lg border border-white/5' 
              : 'text-zinc-400 bg-white/5 hover:text-zinc-100 border border-transparent hover:border-white/5'
          }`}
        >
          <RotateCw className={`w-4 h-4 ${autoRotate ? 'text-emerald-400' : 'text-zinc-500'}`} />
          <span className="font-medium text-xs">Rotate {autoRotate ? 'ON' : 'OFF'}</span>
        </button>
      </div>
      
      <Canvas 
        camera={{ position: [0, 0, 15], fov: 60 }}
        style={{ background: 'radial-gradient(circle at center, #1a1a2e 0%, #0a0a0f 100%)' }}
      >
        {/* Enhanced lighting */}
        <ambientLight intensity={0.3} />
        <pointLight position={[10, 10, 10]} intensity={0.8} color="#6366f1" />
        <pointLight position={[-10, -10, -10]} intensity={0.5} color="#8b5cf6" />
        <pointLight position={[0, 15, 0]} intensity={0.3} color="#ec4899" />
        
        {/* Background stars */}
        <Stars radius={100} depth={50} count={3000} factor={4} saturation={0} fade speed={1} />
        
        {/* Fractal particle system */}
        {showParticles && <FractalParticles shouldRotate={false} />}
        
        {/* Edges */}
        {edges.map((edge, idx) => (
          <GraphEdge
            key={`edge-${idx}`}
            start={edge.source}
            end={edge.target}
            strength={edge.strength || 0.5}
            color={edge.color || '#666666'}
          />
        ))}
        
        {/* Connection pulses (only on strong connections) */}
        {showPulses && strongEdges.map((edge, idx) => (
          <ConnectionPulse
            key={`pulse-${idx}`}
            start={edge.source}
            end={edge.target}
            speed={0.5 + Math.random() * 0.5}
          />
        ))}
        
        {/* Nodes */}
        {nodes.map((node) => (
          <GraphNode
            key={node.id}
            position={node.position}
            label={node.label}
            color={node.color}
            connections={nodeConnections[node.id] || 0}
            onClick={() => handleNodeClick(node.id)}
            isSelected={selectedNode === node.id}
          />
        ))}
        
        {/* Interactive controls */}
        <OrbitControls 
          enableZoom={true}
          enablePan={true}
          enableRotate={true}
          autoRotate={autoRotate}
          autoRotateSpeed={0.3}
          maxDistance={30}
          minDistance={5}
        />
      </Canvas>
      
      {/* Info overlay */}
      {selectedNode && (
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '10px',
          background: 'rgba(17, 24, 39, 0.9)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '8px',
          padding: '12px 16px',
          color: 'white',
          fontSize: '12px',
          maxWidth: '250px'
        }}>
          <div style={{ fontWeight: '600', marginBottom: '4px' }}>Selected: {selectedNode}</div>
          <div style={{ color: '#9ca3af' }}>
            Connections: {nodeConnections[selectedNode] || 0}
          </div>
        </div>
      )}
      
      {/* Stats & Legend */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        background: 'rgba(17, 24, 39, 0.8)',
        backdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        color: 'white',
        fontSize: '11px',
        fontFamily: 'monospace',
        minWidth: '160px'
      }}>
        <button
          onClick={() => setStatsCollapsed(!statsCollapsed)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            background: 'transparent',
            border: 'none',
            color: 'white',
            cursor: 'pointer',
            fontWeight: '700',
            fontSize: '12px'
          }}
        >
          <span>Graph Stats</span>
          {statsCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </button>
        
        {!statsCollapsed && (
          <div style={{ padding: '0 14px 10px 14px' }}>
            <div style={{ marginBottom: '2px' }}>Nodes: {nodes.length}</div>
            <div style={{ marginBottom: '12px' }}>Edges: {edges.length}</div>
            
            <div style={{ fontWeight: '700', marginBottom: '6px', fontSize: '10px', color: '#9ca3af' }}>NODE COLORS</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ec4899', boxShadow: '0 0 8px rgba(236, 72, 153, 0.5)' }} />
              <span style={{ fontSize: '10px' }}>10+ connections</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#8b5cf6', boxShadow: '0 0 8px rgba(139, 92, 246, 0.5)' }} />
              <span style={{ fontSize: '10px' }}>6-10 connections</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#6366f1', boxShadow: '0 0 8px rgba(99, 102, 241, 0.5)' }} />
              <span style={{ fontSize: '10px' }}>3-5 connections</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px rgba(16, 185, 129, 0.5)' }} />
              <span style={{ fontSize: '10px' }}>0-2 connections</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default KnowledgeGraph3D;
