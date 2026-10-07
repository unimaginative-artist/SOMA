
export enum ArbiterStatus {
  IDLE = 'IDLE',
  BUSY = 'BUSY',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR'
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  WAITING_ON_TOOL = 'WAITING_ON_TOOL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  NEEDS_REVIEW = 'NEEDS_REVIEW'
}

export interface Arbiter {
  id: string;
  name: string;
  role: string;
  description: string;
  status: ArbiterStatus;
  capabilities: string[];
  healthScore: number; // 0-100
  activeTaskId?: string;
  avatarUrl?: string;
  load?: number; // 0-100 from SOMA system
}

export interface WorkflowStep {
  id: string;
  description: string;
  assignedArbiterRole: string; // The role name to match an arbiter
  assignedArbiterId?: string; // Filled during execution
  status: TaskStatus;
  dependencies: string[]; // IDs of previous steps
  tools?: string[]; // Tool hints from the orchestrator

  // Production fields
  startTime?: number;
  endTime?: number;
  logs: string[]; // Stream of "thought" or tool usage logs
  output?: string; // The final result of the step
  rationale?: string;
  toolsUsed?: Array<{ name: string; args?: any; success: boolean; brainPicked?: boolean }>;
}

export interface RecalledMemory {
  content: string;
  score: number;
  tier: string;
}

export interface WorkflowPlan {
  goal: string;
  steps: WorkflowStep[];
  summary?: string;
  createdAt: number;
  memoriesRecalled?: RecalledMemory[];
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'orchestrator';
  text: string;
  timestamp: number;
  relatedPlanId?: string; // If this message generated a plan
}

export interface Session {
  id: string;
  title: string;
  messages: ChatMessage[];
  plan: WorkflowPlan | null;
  arbiters: Arbiter[];
  lastActive: number;
}
