
export enum BrainType {
  AURORA = 'AURORA',
  PROMETHEUS = 'PROMETHEUS',
  LOGOS = 'LOGOS',
  THALAMUS = 'THALAMUS'
}

// Added missing BrainConfig interface
export interface BrainConfig {
  id: BrainType;
  name: string;
  role: string;
  color: string;
  bgGradient: string;
  glowClass: string;
  textGlowClass: string;
  buttons: string[];
  stats: {
    load: number;
    processes: number;
    confidence: number;
    focus: string;
  };
}

export interface BrainInfluence {
  [BrainType.AURORA]: number;
  [BrainType.PROMETHEUS]: number;
  [BrainType.LOGOS]: number;
  [BrainType.THALAMUS]: number;
}

export interface Fragment {
  id: string;
  label: string;
  type: 'belief' | 'memory' | 'rule' | 'goal' | 'pattern' | 'seed' | 'hypothesis' | 'strategy';
  domain: BrainType;
  importance: number; // 1-10
  usage: number; // 1-10
  confidence: number;
  decay: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  isLocked?: boolean;
  isContradiction?: boolean;
  isFading?: boolean;
  isNewSeed?: boolean;
  isPromoted?: boolean;
  timelineId?: string;
  simulated?: boolean;
  threatLevel?: number; // For Prometheus
  causalStrength?: number; // For Logos
  isHypothesis?: boolean;
  isVariant?: boolean;
}

export interface FragmentLink {
  source: string | Fragment;
  target: string | Fragment;
  type: 'dependency' | 'conflict' | 'reinforcement' | 'contradiction' | 'causal' | 'proof';
}

export interface TraceLog {
  id: string;
  timestamp: number;
  brain: BrainType;
  action: string;
  fragmentId?: string;
  confidenceShift?: number;
}
