"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { Workflow } from "@/lib/types"
import { GitBranch, Plus, Trash2, Calendar, Layers } from "lucide-react"

interface WorkflowListProps {
  workflows: Workflow[]
  onWorkflowSelect: (workflow: Workflow) => void
  onWorkflowDelete: (id: string) => void
  onCreateWorkflow: () => void
}

export function WorkflowList({ workflows, onWorkflowSelect, onWorkflowDelete, onCreateWorkflow }: WorkflowListProps) {
  return (
    <div className="h-full overflow-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold">Workflows</h2>
            <p className="text-muted-foreground mt-1">Manage and organize your AI agent workflows</p>
          </div>
          <Button onClick={onCreateWorkflow}>
            <Plus className="w-4 h-4 mr-2" />
            New Workflow
          </Button>
        </div>

        {workflows.length === 0 ? (
          <Card className="p-12 text-center">
            <GitBranch className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
            <p className="text-muted-foreground mb-6">Create your first workflow to start orchestrating AI agents</p>
            <Button onClick={onCreateWorkflow}>
              <Plus className="w-4 h-4 mr-2" />
              Create Workflow
            </Button>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map((workflow) => (
              <Card
                key={workflow.id}
                className="p-4 hover:border-primary/50 transition-all cursor-pointer group"
                onClick={() => onWorkflowSelect(workflow)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <GitBranch className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm">{workflow.name}</h3>
                      <Badge variant="outline" className="mt-1 text-xs">
                        {workflow.status}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => {
                      e.stopPropagation()
                      onWorkflowDelete(workflow.id)
                    }}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>

                <p className="text-sm text-muted-foreground mb-4 line-clamp-2">{workflow.description}</p>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Layers className="w-3 h-3" />
                    <span>{workflow.nodes.length} nodes</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    <span>{new Date(workflow.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
