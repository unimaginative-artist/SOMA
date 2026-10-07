"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Workflow, ExecutionLog } from "@/lib/types"
import { GitBranch, Play, Pause, CheckCircle2, XCircle, Clock, Layers } from "lucide-react"

interface WorkflowStatusProps {
  workflows: Workflow[]
  executionLogs: ExecutionLog[]
  onWorkflowSelect: (workflow: Workflow) => void
}

export function WorkflowStatus({ workflows, executionLogs, onWorkflowSelect }: WorkflowStatusProps) {
  const getWorkflowStats = (workflow: Workflow) => {
    const workflowLogs = executionLogs.filter((log) => log.workflowId === workflow.id)
    const lastExecution = workflowLogs[workflowLogs.length - 1]
    const successCount = workflowLogs.filter((log) => log.status === "success").length
    const totalCount = workflowLogs.length

    return {
      lastExecution,
      successRate: totalCount > 0 ? (successCount / totalCount) * 100 : 0,
      totalExecutions: totalCount,
    }
  }

  return (
    <Card className="h-full flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <GitBranch className="w-5 h-5" />
          Workflow Status
        </h3>
        <p className="text-sm text-muted-foreground mt-1">Monitor active and recent workflows</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {workflows.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <GitBranch className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No workflows yet</p>
            </div>
          ) : (
            workflows.map((workflow) => {
              const stats = getWorkflowStats(workflow)

              return (
                <Card
                  key={workflow.id}
                  className="p-4 bg-card/50 hover:border-primary/50 transition-all cursor-pointer"
                  onClick={() => onWorkflowSelect(workflow)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-sm mb-1">{workflow.name}</h4>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            workflow.status === "running"
                              ? "default"
                              : workflow.status === "error"
                                ? "destructive"
                                : "outline"
                          }
                          className="text-xs"
                        >
                          {workflow.status}
                        </Badge>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Layers className="w-3 h-3" />
                          <span>{workflow.nodes.length} nodes</span>
                        </div>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      {workflow.status === "running" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </Button>
                  </div>

                  {stats.totalExecutions > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">Success Rate</span>
                        <span className="font-semibold">{stats.successRate.toFixed(1)}%</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-400 transition-all"
                          style={{ width: `${stats.successRate}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{stats.totalExecutions} executions</span>
                        {stats.lastExecution && (
                          <div className="flex items-center gap-1">
                            {stats.lastExecution.status === "success" ? (
                              <CheckCircle2 className="w-3 h-3 text-green-400" />
                            ) : (
                              <XCircle className="w-3 h-3 text-destructive" />
                            )}
                            <Clock className="w-3 h-3" />
                            <span>{stats.lastExecution.duration}ms</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              )
            })
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
