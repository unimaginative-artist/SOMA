"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { Workflow } from "@/lib/types"
import { Plus, Sparkles, Bot, Save } from "lucide-react"

interface DashboardHeaderProps {
  onCreateWorkflow: () => void
  onCreateAgent: () => void
  activeWorkflow: Workflow | null
  onWorkflowNameChange: (name: string) => void
}

export function DashboardHeader({
  onCreateWorkflow,
  onCreateAgent,
  activeWorkflow,
  onWorkflowNameChange,
}: DashboardHeaderProps) {
  return (
    <header className="h-16 border-b border-border bg-card flex items-center justify-between px-6">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Bot className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-bold">AI Agent Platform</h1>
        </div>

        {activeWorkflow && (
          <div className="flex items-center gap-2 ml-8">
            <Input
              value={activeWorkflow.name}
              onChange={(e) => onWorkflowNameChange(e.target.value)}
              className="w-64"
              placeholder="Workflow name"
            />
            <Button variant="ghost" size="icon">
              <Save className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onCreateAgent}>
          <Sparkles className="w-4 h-4 mr-2" />
          Create Agent
        </Button>
        <Button onClick={onCreateWorkflow}>
          <Plus className="w-4 h-4 mr-2" />
          New Workflow
        </Button>
      </div>
    </header>
  )
}
