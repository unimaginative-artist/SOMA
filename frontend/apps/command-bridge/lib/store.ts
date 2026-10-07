// Local state management and persistence layer
"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Workflow, Agent, ExecutionLog } from "./types"

interface AgentStore {
  workflows: Workflow[]
  agents: Agent[]
  executionLogs: ExecutionLog[]
  activeWorkflowId: string | null

  // Workflow actions
  addWorkflow: (workflow: Workflow) => void
  updateWorkflow: (id: string, updates: Partial<Workflow>) => void
  deleteWorkflow: (id: string) => void
  setActiveWorkflow: (id: string | null) => void

  // Agent actions
  addAgent: (agent: Agent) => void
  updateAgent: (id: string, updates: Partial<Agent>) => void
  deleteAgent: (id: string) => void

  // Execution log actions
  addExecutionLog: (log: ExecutionLog) => void
  clearExecutionLogs: (workflowId?: string) => void

  // Utility actions
  getWorkflow: (id: string) => Workflow | undefined
  getAgent: (id: string) => Agent | undefined
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      workflows: [],
      agents: [],
      executionLogs: [],
      activeWorkflowId: null,

      addWorkflow: (workflow) => set((state) => ({ workflows: [...state.workflows, workflow] })),

      updateWorkflow: (id, updates) =>
        set((state) => ({
          workflows: state.workflows.map((w) => (w.id === id ? { ...w, ...updates, updatedAt: new Date() } : w)),
        })),

      deleteWorkflow: (id) =>
        set((state) => ({
          workflows: state.workflows.filter((w) => w.id !== id),
          activeWorkflowId: state.activeWorkflowId === id ? null : state.activeWorkflowId,
        })),

      setActiveWorkflow: (id) => set({ activeWorkflowId: id }),

      addAgent: (agent) => set((state) => ({ agents: [...state.agents, agent] })),

      updateAgent: (id, updates) =>
        set((state) => ({
          agents: state.agents.map((a) => (a.id === id ? { ...a, ...updates, updatedAt: new Date() } : a)),
        })),

      deleteAgent: (id) =>
        set((state) => ({
          agents: state.agents.filter((a) => a.id !== id),
        })),

      addExecutionLog: (log) => set((state) => ({ executionLogs: [...state.executionLogs, log] })),

      clearExecutionLogs: (workflowId) =>
        set((state) => ({
          executionLogs: workflowId ? state.executionLogs.filter((log) => log.workflowId !== workflowId) : [],
        })),

      getWorkflow: (id) => get().workflows.find((w) => w.id === id),

      getAgent: (id) => get().agents.find((a) => a.id === id),
    }),
    {
      name: "agent-orchestration-storage",
    },
  ),
)
