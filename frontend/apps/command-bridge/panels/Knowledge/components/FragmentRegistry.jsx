import React, { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls, Sphere, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { BRAINS } from '../constants.js';

const DOMAIN_CENTERS = {
    AURORA: [-7.6, 2.2, -2.4],
    PROMETHEUS: [6.7, 1.1, 2.1],
    LOGOS: [-4.4, -4.9, 2.8],
    THALAMUS: [5.1, -4.25, -2.6],
};

const FALLBACK_DOMAIN = 'AURORA';
const CENTRAL_RELAY = [0.05, -0.35, 0.2];
const DOMAIN_ORDER = ['AURORA', 'PROMETHEUS', 'LOGOS', 'THALAMUS'];
const TYPE_LAYERS = {
    persona: 0,
    fragment: 1,
    memory: 2,
    concept: 3,
    goal: 3,
    strategy: 3,
};

const hashString = (value = '') => {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
        hash ^= value.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return Math.abs(hash >>> 0);
};

const seeded = (seed, salt = 0) => {
    const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
    return x - Math.floor(x);
};

const domainOf = (fragment = {}) => BRAINS[fragment.domain] ? fragment.domain : (BRAINS[fragment.primaryBrain] ? fragment.primaryBrain : FALLBACK_DOMAIN);

const nodeRadius = (node = {}) => {
    const quality = typeof node.quality?.score === 'number' ? node.quality.score : node.confidence || 0.6;
    const importance = Math.max(1, Math.min(10, node.importance || 4));
    return (0.08 + importance * 0.025 + quality * 0.06) * 0.5;
};

const makeRoute = (source, target, index = 0) => {
    const sourcePos = new THREE.Vector3(...source.position);
    const targetPos = new THREE.Vector3(...target.position);
    const sourceCenter = new THREE.Vector3(...(DOMAIN_CENTERS[source.domain] || DOMAIN_CENTERS[FALLBACK_DOMAIN]));
    const targetCenter = new THREE.Vector3(...(DOMAIN_CENTERS[target.domain] || DOMAIN_CENTERS[FALLBACK_DOMAIN]));
    const relay = new THREE.Vector3(...CENTRAL_RELAY);
    const sameDomain = source.domain === target.domain;

    const sourceHub = sourceCenter.clone().lerp(relay, sameDomain ? 0.32 : 0.58);
    const targetHub = targetCenter.clone().lerp(relay, sameDomain ? 0.32 : 0.58);
    const lift = sameDomain ? 0.35 : 0.72;
    const side = index % 2 === 0 ? 1 : -1;
    const phase = ((index % 11) - 5) * 0.12;
    const normal = new THREE.Vector3(
        side * (0.18 + Math.abs(phase) * 0.45),
        lift,
        sameDomain ? 0.28 + phase : 0.62 + phase
    );

    const points = sameDomain
        ? [
            sourcePos,
            sourcePos.clone().lerp(sourceHub, 0.65).add(normal),
            sourceHub.clone().add(normal.multiplyScalar(0.65)),
            targetPos.clone().lerp(sourceHub, 0.65).add(new THREE.Vector3(-side * 0.28, lift * 0.7, 0.55)),
            targetPos,
        ]
        : [
            sourcePos,
            sourceHub.add(normal.clone().multiplyScalar(0.55)),
            relay.clone().add(new THREE.Vector3(phase * 1.1, lift, 0.34)),
            targetHub.add(normal.clone().multiplyScalar(0.45)),
            targetPos,
        ];

    return new THREE.CatmullRomCurve3(points).getPoints(32).map(point => point.toArray());
};

const buildMeshData = (fragments = [], links = []) => {
    const capped = fragments.slice(0, 420);
    const domainCounts = capped.reduce((acc, fragment) => {
        const domain = domainOf(fragment);
        acc[domain] = (acc[domain] || 0) + 1;
        return acc;
    }, {});
    const domainSeen = {};

    const nodes = capped.map((fragment, index) => {
        const domain = domainOf(fragment);
        const center = DOMAIN_CENTERS[domain] || DOMAIN_CENTERS[FALLBACK_DOMAIN];
        const seed = hashString(fragment.id || fragment.label || `${domain}-${index}`);
        const domainIndex = domainSeen[domain] || 0;
        domainSeen[domain] = domainIndex + 1;

        const total = Math.max(1, domainCounts[domain] || 1);
        const layer = TYPE_LAYERS[fragment.type] ?? (fragment.isPromoted ? 0 : 2);
        const laneCount = Math.max(10, Math.ceil(Math.sqrt(total) * 2.6));
        const lane = domainIndex % laneCount;
        const ring = Math.floor(domainIndex / laneCount);
        const theta = ((lane / laneCount) * Math.PI * 2) + seeded(seed, 2) * 0.18;
        const shell = 1.35 + layer * 0.72 + ring * 0.42;
        const golden = index * 2.399963229728653;
        const normalized = capped.length > 1 ? (index / (capped.length - 1)) : 0.5;
        const cloudY = (normalized - 0.5) * 8.2;
        const cloudRadius = 6.6 * Math.sqrt(Math.max(0.04, 1 - Math.pow((normalized - 0.5) * 1.7, 2)));
        const globalCloud = [
            Math.cos(golden) * cloudRadius,
            cloudY + Math.sin(golden * 0.7) * 1.1,
            Math.sin(golden) * cloudRadius * 0.78 + Math.cos(golden * 0.43) * 1.4,
        ];
        const localStrand = [
            Math.cos(theta) * shell * 1.45,
            Math.sin(theta * 1.7 + layer) * 0.95 + (layer - 1.5) * 0.32,
            Math.sin(theta) * shell * 1.1 + Math.cos(theta * 1.35 + ring * 0.45) * 0.72,
        ];
        const domainPull = 0.42;
        const cloudPull = 0.78;
        const localPull = 0.46;
        const position = [
            center[0] * domainPull + globalCloud[0] * cloudPull + localStrand[0] * localPull + seeded(seed, 5) * 0.35 - 0.175,
            center[1] * domainPull + globalCloud[1] * cloudPull + localStrand[1] * localPull + seeded(seed, 6) * 0.28 - 0.14,
            center[2] * domainPull + globalCloud[2] * cloudPull + localStrand[2] * localPull + seeded(seed, 7) * 0.35 - 0.175,
        ];
        const quality = typeof fragment.quality?.score === 'number' ? fragment.quality.score : fragment.confidence || 0.65;
        return {
            ...fragment,
            domain,
            lane,
            layer,
            ring,
            position,
            radius: nodeRadius(fragment),
            quality,
            pulseOffset: seeded(seed, 4) * Math.PI * 2,
        };
    });

    const byId = new Map(nodes.map(node => [node.id, node]));
    const edges = links
        .map((link, index) => {
            const sourceId = typeof link.source === 'string' ? link.source : link.source?.id;
            const targetId = typeof link.target === 'string' ? link.target : link.target?.id;
            const source = byId.get(sourceId);
            const target = byId.get(targetId);
            if (!source || !target) return null;
            return {
                ...link,
                source,
                target,
                route: makeRoute(source, target, index),
                routeId: `${source.id}-${target.id}-${index}`,
            };
        })
        .filter(Boolean)
        .slice(0, 900);

    return { nodes, edges };
};

const DomainHalo = ({ domain, active }) => {
    const center = DOMAIN_CENTERS[domain] || DOMAIN_CENTERS[FALLBACK_DOMAIN];
    const brain = BRAINS[domain] || BRAINS[FALLBACK_DOMAIN];
    const color = new THREE.Color(brain.color);
    return (
        <group position={center}>
            <mesh>
                <sphereGeometry args={[0.16, 24, 24]} />
                <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 0.95 : 0.24} roughness={0.26} transparent opacity={0.8} />
            </mesh>
            <mesh>
                <sphereGeometry args={[0.72, 24, 16]} />
                <meshBasicMaterial color={color} transparent opacity={active ? 0.035 : 0.012} />
            </mesh>
            <Html center distanceFactor={13} position={[0, -0.9, 0]}>
                <div className="pointer-events-none rounded-full border border-white/10 bg-black/25 px-2.5 py-1 text-[8px] font-bold uppercase tracking-[0.24em] text-zinc-500 backdrop-blur">
                    {domain}
                </div>
            </Html>
        </group>
    );
};

const NeuralCloudEnvelope = ({ showVisuals }) => {
    const cloudRef = useRef(null);

    useFrame(({ clock }) => {
        if (!cloudRef.current) return;
        cloudRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.035) * 0.08;
        cloudRef.current.rotation.z = Math.sin(clock.elapsedTime * 0.027) * 0.025;
    });

    if (!showVisuals) return null;

    return (
        <group ref={cloudRef}>
            <mesh scale={[9.2, 5.15, 5.3]} position={[0, -0.25, 0]}>
                <sphereGeometry args={[1, 48, 24]} />
                <meshBasicMaterial color="#7dd3fc" transparent opacity={0.018} wireframe />
            </mesh>
            <mesh scale={[7.1, 3.7, 4.2]} position={[-0.35, 0.25, 0.2]}>
                <sphereGeometry args={[1, 40, 20]} />
                <meshBasicMaterial color="#c084fc" transparent opacity={0.012} wireframe />
            </mesh>
        </group>
    );
};

const SignalPulse = ({ edge, color, active }) => {
    const pulseRef = useRef(null);
    const points = edge.route || [edge.source.position, edge.target.position];
    const offset = (hashString(edge.routeId || `${edge.source.id}-${edge.target.id}`) % 1000) / 1000;

    useFrame(({ clock }) => {
        if (!pulseRef.current || points.length < 2) return;
        const speed = active ? 0.34 : 0.18;
        const progress = (clock.elapsedTime * speed + offset) % 1;
        const scaled = progress * (points.length - 1);
        const index = Math.min(points.length - 2, Math.floor(scaled));
        const t = scaled - index;
        const a = new THREE.Vector3(...points[index]);
        const b = new THREE.Vector3(...points[index + 1]);
        pulseRef.current.position.copy(a.lerp(b, t));
        const pulse = active ? 1.25 : 0.85 + Math.sin(clock.elapsedTime * 3 + offset) * 0.12;
        pulseRef.current.scale.setScalar(pulse);
    });

    return (
        <mesh ref={pulseRef}>
            <sphereGeometry args={[active ? 0.055 : 0.034, 12, 12]} />
            <meshBasicMaterial color={color} transparent opacity={active ? 0.92 : 0.44} depthWrite={false} />
        </mesh>
    );
};

const NeuralNode = ({ node, isActive, isMuted, onFragmentClick }) => {
    const meshRef = useRef(null);
    const brain = BRAINS[node.domain] || BRAINS[FALLBACK_DOMAIN];
    const color = new THREE.Color(node.isContradiction ? '#ef4444' : brain.color);

    useFrame(({ clock }) => {
        if (!meshRef.current) return;
        const t = clock.elapsedTime + node.pulseOffset;
        const pulse = isActive ? 1.22 : 1 + Math.sin(t * 1.7) * 0.035;
        meshRef.current.scale.setScalar(pulse);
    });

    return (
        <group position={node.position}>
            <Sphere
                ref={meshRef}
                args={[node.radius, 20, 20]}
                onClick={(event) => {
                    event.stopPropagation();
                    onFragmentClick?.(node);
                }}
            >
                <meshStandardMaterial
                    color={color}
                    emissive={color}
                    emissiveIntensity={isActive ? 1.65 : node.quality > 0.8 ? 0.78 : 0.38}
                    roughness={0.22}
                    metalness={0.15}
                    transparent
                    opacity={isMuted ? 0.22 : 0.92}
                />
            </Sphere>
            {(isActive || node.isPromoted || node.isContradiction) && (
                <Sphere args={[node.radius * 2.4, 20, 20]}>
                    <meshBasicMaterial color={color} transparent opacity={isActive ? 0.16 : 0.07} />
                </Sphere>
            )}
            {isActive && (
                <Html center distanceFactor={8} position={[0, node.radius + 0.42, 0]}>
                    <div className="pointer-events-none max-w-[260px] rounded-lg border border-white/15 bg-zinc-950/85 px-3 py-2 text-center shadow-2xl backdrop-blur">
                        <div className="truncate text-[11px] font-bold uppercase tracking-widest text-white">{node.label}</div>
                        <div className="mt-1 flex justify-center gap-1.5">
                            {(node.brainLanes || [node.domain]).slice(0, 3).map(lane => (
                                <span key={lane} className="rounded-full border border-white/10 px-1.5 py-0.5 text-[8px] font-bold text-zinc-400">
                                    {lane}
                                </span>
                            ))}
                        </div>
                    </div>
                </Html>
            )}
        </group>
    );
};

const MeshLinks = ({ edges, highlightBrain, tracedFragmentId }) => {
    const pulseEdges = edges.filter((edge, index) => {
        if (edge.source.id === tracedFragmentId || edge.target.id === tracedFragmentId) return true;
        if (highlightBrain && (edge.source.domain === highlightBrain || edge.target.domain === highlightBrain)) return index % 3 === 0;
        return index % 8 === 0;
    }).slice(0, 120);

    return (
        <group>
            {edges.map((edge, index) => {
                const sourceActive = edge.source.id === tracedFragmentId;
                const targetActive = edge.target.id === tracedFragmentId;
                const active = sourceActive || targetActive;
                const muted = highlightBrain && edge.source.domain !== highlightBrain && edge.target.domain !== highlightBrain && !active;
                const color = edge.type === 'contradiction'
                    ? '#ef4444'
                    : active
                        ? (BRAINS[edge.source.domain]?.color || '#ffffff')
                        : edge.source.domain === edge.target.domain
                            ? (BRAINS[edge.source.domain]?.color || '#6b7280')
                            : '#8b9bb4';
                return (
                    <Line
                        key={`${edge.source.id}-${edge.target.id}-${index}`}
                        points={edge.route || [edge.source.position, edge.target.position]}
                        color={color}
                        lineWidth={active ? 2.4 : edge.source.domain === edge.target.domain ? 0.7 : 0.55}
                        transparent
                        opacity={muted ? 0.028 : active ? 0.78 : edge.source.domain === edge.target.domain ? 0.18 : 0.11}
                        depthWrite={false}
                    />
                );
            })}
            {pulseEdges.map((edge, index) => {
                const active = edge.source.id === tracedFragmentId || edge.target.id === tracedFragmentId;
                const color = edge.type === 'contradiction' ? '#ef4444' : (BRAINS[edge.source.domain]?.color || '#ffffff');
                return <SignalPulse key={`pulse-${edge.routeId || index}`} edge={edge} color={color} active={active} />;
            })}
        </group>
    );
};

const DomainScaffold = ({ highlightBrain }) => {
    const pairs = [
        ['AURORA', 'PROMETHEUS'],
        ['AURORA', 'LOGOS'],
        ['AURORA', 'THALAMUS'],
        ['PROMETHEUS', 'LOGOS'],
        ['PROMETHEUS', 'THALAMUS'],
        ['LOGOS', 'THALAMUS'],
    ];

    return (
        <group>
            {pairs.map(([a, b]) => {
                const active = !highlightBrain || highlightBrain === a || highlightBrain === b;
                const route = new THREE.CatmullRomCurve3([
                    new THREE.Vector3(...DOMAIN_CENTERS[a]),
                    new THREE.Vector3(...DOMAIN_CENTERS[a]).lerp(new THREE.Vector3(...CENTRAL_RELAY), 0.55).add(new THREE.Vector3(0, 0.35, 0.25)),
                    new THREE.Vector3(...CENTRAL_RELAY),
                    new THREE.Vector3(...DOMAIN_CENTERS[b]).lerp(new THREE.Vector3(...CENTRAL_RELAY), 0.55).add(new THREE.Vector3(0, 0.35, 0.25)),
                    new THREE.Vector3(...DOMAIN_CENTERS[b]),
                ]).getPoints(36).map(point => point.toArray());
                return (
                    <Line
                        key={`${a}-${b}`}
                        points={route}
                        color={active ? '#94a3b8' : '#334155'}
                        lineWidth={active ? 0.65 : 0.24}
                        transparent
                        opacity={active ? 0.1 : 0.026}
                        depthWrite={false}
                    />
                );
            })}
            <mesh position={CENTRAL_RELAY}>
                <sphereGeometry args={[0.18, 28, 28]} />
                <meshStandardMaterial color="#e5e7eb" emissive="#67e8f9" emissiveIntensity={0.8} roughness={0.2} />
            </mesh>
            <mesh position={CENTRAL_RELAY}>
                <sphereGeometry args={[0.58, 28, 28]} />
                <meshBasicMaterial color="#67e8f9" transparent opacity={0.05} />
            </mesh>
            <Line
                points={DOMAIN_ORDER.map(domain => DOMAIN_CENTERS[domain])}
                color="#64748b"
                lineWidth={0.24}
                transparent
                opacity={0.035}
                depthWrite={false}
            />
        </group>
    );
};

const NeuralMeshScene = ({ nodes, edges, highlightBrain, tracedFragmentId, onFragmentClick, showVisuals }) => {
    const rootRef = useRef(null);
    const activeDomains = new Set(nodes.map(node => node.domain));

    useFrame(({ clock }) => {
        if (!rootRef.current) return;
        rootRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.06) * 0.055;
        rootRef.current.rotation.x = Math.sin(clock.elapsedTime * 0.04) * 0.025;
    });

    return (
        <>
            <color attach="background" args={['#050507']} />
            <fog attach="fog" args={['#050507', 15, 34]} />
            <ambientLight intensity={0.38} />
            <pointLight position={[0, 6, 12]} intensity={1.3} color="#e0f2fe" />
            <pointLight position={[-8, -3, 5]} intensity={0.72} color="#c084fc" />
            <pointLight position={[8, -2, 4]} intensity={0.58} color="#fbbf24" />
            {showVisuals && <Stars radius={42} depth={18} count={900} factor={2.3} saturation={0} fade speed={0.25} />}

            <group ref={rootRef}>
                {nodes.map(node => {
                    const isActive = tracedFragmentId === node.id;
                    const isMuted = Boolean((highlightBrain && node.domain !== highlightBrain) && !isActive);
                    return (
                        <NeuralNode
                            key={node.id}
                            node={node}
                            isActive={isActive}
                            isMuted={isMuted}
                            onFragmentClick={onFragmentClick}
                        />
                    );
                })}
            </group>
            <OrbitControls
                enablePan
                enableZoom
                enableDamping
                dampingFactor={0.08}
                rotateSpeed={0.45}
                zoomSpeed={0.6}
                minDistance={8}
                maxDistance={28}
            />
        </>
    );
};

export const FragmentRegistry = ({
    onFragmentClick,
    highlightBrain,
    fragments = [],
    links = [],
    tracedFragmentId,
    showVisuals = true,
    emptyTitle = 'Neural Mesh',
    emptyDescription = 'Awaiting fragments from Knowledge.'
}) => {
    const { nodes, edges } = useMemo(() => buildMeshData(fragments, links), [fragments, links]);

    return (
        <div className="absolute inset-0 h-full w-full overflow-hidden bg-transparent">
            <Canvas
                camera={{ position: [0, 1.1, 24], fov: 50, near: 0.1, far: 100 }}
                dpr={[1, 1.75]}
                gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
            >
                <Suspense fallback={null}>
                    <NeuralMeshScene
                        nodes={nodes}
                        edges={edges}
                        highlightBrain={highlightBrain}
                        tracedFragmentId={tracedFragmentId}
                        onFragmentClick={onFragmentClick}
                        showVisuals={showVisuals}
                    />
                </Suspense>
            </Canvas>
            {!nodes.length && (
                <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-black/35 px-5 py-4 text-center backdrop-blur">
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-500">{emptyTitle}</div>
                    <div className="mt-2 text-xs text-zinc-600">{emptyDescription}</div>
                </div>
            )}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0d0d0e] via-[#0d0d0e]/35 to-transparent" />
        </div>
    );
};
