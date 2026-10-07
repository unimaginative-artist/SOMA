// Core type definitions for the AI Agent Orchestration Platform

export type NodeType =
  | "trigger"
  | "action"
  | "condition"
  | "ai-agent"
  | "parser"
  | "transformer"
  | "api-call"
  | "custom"

export type AgentStatus = "idle" | "running" | "paused" | "error" | "completed"

export type ExecutionStatus = "pending" | "running" | "success" | "failed" | "cancelled"

export interface Position {
  x: number
  y: number
}

export interface NodeData {
  label: string
  type: NodeType
  config: Record<string, any>
  code?: string
  description?: string
}

export interface WorkflowNode {
  id: string
  type: NodeType
  position: Position
  data: NodeData
}

export interface WorkflowConnection {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
}

export interface Workflow {
  id: string
  name: string
  description: string
  nodes: WorkflowNode[]
  connections: WorkflowConnection[]
  createdAt: Date
  updatedAt: Date
  status: AgentStatus
}

export interface Agent {
  id: string
  name: string
  type: NodeType
  description: string
  code: string
  config: Record<string, any>
  createdAt: Date
  updatedAt: Date
  version: number
}

export interface ExecutionLog {
  id: string
  workflowId: string
  nodeId: string
  status: ExecutionStatus
  input: any
  output: any
  error?: string
  startTime: Date
  endTime?: Date
  duration?: number
}

export interface AgentCreationRequest {
  prompt: string
  type?: NodeType
  name?: string
}

export interface AgentCreationResponse {
  agent: Agent
  success: boolean
  error?: string
}
