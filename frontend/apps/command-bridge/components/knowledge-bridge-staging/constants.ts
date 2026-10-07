
import { BrainConfig, BrainType, Fragment, FragmentLink } from './types';

export const BRAINS: Record<BrainType, BrainConfig> = {
  [BrainType.AURORA]: {
    id: BrainType.AURORA,
    name: 'AURORA',
    role: 'Imagination & Synthesis',
    color: '#c084fc', // purple-400
    bgGradient: 'from-purple-900/40 to-fuchsia-900/40',
    glowClass: 'glow-aurora',
    textGlowClass: 'text-glow-aurora',
    buttons: ['Dreamspace', 'Hypothesis Forge', 'Creative Memory', 'Pattern Mutation', 'Idea Entropy'],
    stats: { load: 84, processes: 1240, confidence: 0.65, focus: 'Abstract Metaphor' }
  },
  [BrainType.PROMETHEUS]: {
    id: BrainType.PROMETHEUS,
    name: 'PROMETHEUS',
    role: 'Strategy & Perception',
    color: '#fbbf24', // amber-400
    bgGradient: 'from-amber-900/40 to-orange-900/40',
    glowClass: 'glow-prometheus',
    textGlowClass: 'text-glow-prometheus',
    buttons: ['World Model', 'Threat Horizon', 'Strategy Lattice', 'Prediction Engine', 'Reality Drift'],
    stats: { load: 92, processes: 842, confidence: 0.88, focus: 'Tactical Forecast' }
  },
  [BrainType.LOGOS]: {
    id: BrainType.LOGOS,
    name: 'LOGOS',
    role: 'Logic & Deduction',
    color: '#22d3ee', // cyan-400
    bgGradient: 'from-cyan-900/40 to-slate-900/40',
    glowClass: 'glow-logos',
    textGlowClass: 'text-glow-logos',
    buttons: ['Inference Tree', 'Proof Engine', 'Contradiction Scanner', 'Rule Graph', 'Causal Solver'],
    stats: { load: 45, processes: 310, confidence: 0.99, focus: 'Constraint Solving' }
  },
  [BrainType.THALAMUS]: {
    id: BrainType.THALAMUS,
    name: 'THALAMUS',
    role: 'Security & Sensory Gate',
    color: '#f87171', // red-400
    bgGradient: 'from-red-900/40 to-rose-900/40',
    glowClass: 'glow-thalamus',
    textGlowClass: 'text-glow-thalamus',
    buttons: ['Signal Firewall', 'Sensory Gate', 'Anomaly Buffer', 'Neural Encryption', 'Protocol Guard'],
    stats: { load: 20, processes: 4500, confidence: 0.95, focus: 'Boundary Protection' }
  }
};

// PROCEDURAL GENERATION CONFIG
const NODE_COUNT = 160;
const FRAGMENT_TYPES = ['belief', 'memory', 'rule', 'goal', 'pattern'] as const;
const BRAIN_TYPES = [BrainType.AURORA, BrainType.PROMETHEUS, BrainType.LOGOS, BrainType.THALAMUS];

// Vocabulary for procedural labels
const ADJECTIVES = ['Silent', 'Recursive', 'Dormant', 'Volatile', 'Absolute', 'Kinetic', 'Luminous', 'Dark', 'Prime', 'Hyper', 'Quantum', 'Neural', 'Cognitive', 'Static', 'Fluid', 'Fractal', 'Ephemeral', 'Eternal', 'Broken', 'Shattered', 'Unified', 'Complex', 'Simple', 'Abstract', 'Concrete', 'Spectral', 'Holographic', 'Void', 'Solar', 'Lunar'];
const NOUNS = ['Protocol', 'Heuristic', 'Axiom', 'Synapse', 'Vector', 'Paradox', 'Entropy', 'Cipher', 'Nexus', 'Echo', 'Horizon', 'Vortex', 'Matrix', 'Cluster', 'Shard', 'Resonance', 'Gradient', 'Flux', 'Anchor', 'Beacon', 'Variable', 'Constant', 'Dream', 'Nightmare', 'Vision', 'Strategy', 'Tactic', 'Logic', 'Proof', 'Theorem', 'Signal', 'Noise', 'Core', 'Shell'];
const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Omega', 'Sigma', 'Theta', 'Omicron', 'Psi', 'Chi'];

const generateLabel = () => {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.random() > 0.85 ? ` ${GREEK[Math.floor(Math.random() * GREEK.length)]}` : (Math.random() > 0.75 ? `-${Math.floor(Math.random() * 99)}` : '');
  return `${adj} ${noun}${suffix}`;
};

const generateFragments = (count: number): Fragment[] => {
  return Array.from({ length: count }, (_, i) => {
    const domain = BRAIN_TYPES[Math.floor(Math.random() * BRAIN_TYPES.length)];
    const rand = Math.random();
    let importance = 2;
    if (rand > 0.96) importance = 10;
    else if (rand > 0.90) importance = 8;
    else if (rand > 0.75) importance = 5;
    else importance = Math.floor(Math.random() * 3) + 1;

    return {
      id: `node-${i}`,
      label: generateLabel(),
      type: FRAGMENT_TYPES[Math.floor(Math.random() * FRAGMENT_TYPES.length)],
      domain: domain,
      importance: importance,
      usage: Math.floor(Math.random() * 10) + 1,
      confidence: parseFloat(Math.random().toFixed(2)),
      decay: parseFloat((Math.random() * 0.5).toFixed(2)),
      z: Math.random() * 600 - 300, 
    };
  });
};

const generateLinks = (fragments: Fragment[]): FragmentLink[] => {
  const links: FragmentLink[] = [];
  const linkTypes = ['dependency', 'conflict', 'reinforcement'] as const;

  fragments.forEach((frag, i) => {
    const baseConnections = 1;
    const bonusConnections = Math.floor(frag.importance / 3);
    const numLinks = Math.floor(Math.random() * 2) + baseConnections + bonusConnections;
    
    for(let k=0; k < numLinks; k++) {
        let targetIndex = Math.floor(Math.random() * fragments.length);
        if (targetIndex !== i) {
            links.push({
                source: frag.id,
                target: fragments[targetIndex].id,
                type: linkTypes[Math.floor(Math.random() * linkTypes.length)]
            });
        }
    }
  });

  return links;
};

const GENERATED_FRAGMENTS = generateFragments(NODE_COUNT);
const GENERATED_LINKS = generateLinks(GENERATED_FRAGMENTS);

export const MOCK_FRAGMENTS = GENERATED_FRAGMENTS;
export const MOCK_LINKS = GENERATED_LINKS;
