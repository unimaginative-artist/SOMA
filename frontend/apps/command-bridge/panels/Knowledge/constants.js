import { BrainType } from './types.js';

export const BRAINS = {
    [BrainType.AURORA]: {
        id: BrainType.AURORA,
        name: 'AURORA',
        role: 'Imagination & Synthesis',
        color: '#c084fc', // purple-400
        bgGradient: 'from-purple-900/40 to-fuchsia-900/40',
        glowClass: 'glow-aurora',
        textGlowClass: 'text-glow-aurora',
        buttons: ['Dreamspace', 'Hypothesis Forge', 'Creative Memory', 'Pattern Mutation', 'Idea Entropy'],
        stats: { load: 0, processes: 0, confidence: 1.0, focus: 'Idle' }
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
        stats: { load: 0, processes: 0, confidence: 1.0, focus: 'Idle' }
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
        stats: { load: 0, processes: 0, confidence: 1.0, focus: 'Idle' }
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
        stats: { load: 0, processes: 0, confidence: 1.0, focus: 'Idle' }
    }
};

/**
 * DE-MOCKED: Fragments and Links are now empty by default.
 * SOMA will populate these via real-time knowledge graph queries to the backend.
 */
export const MOCK_FRAGMENTS = [];
export const MOCK_LINKS = [];