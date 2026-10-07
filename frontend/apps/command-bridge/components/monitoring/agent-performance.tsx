"use client"

import { useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Agent, ExecutionLog, Workflow } from "@/lib/types"
import { TrendingUp, Clock, CheckCircle2, BarChart3 } from "lucide-react"

interface AgentPerformanceProps {
  agents: Agent[]
  workflows: Workflow[]
  executionLogs: ExecutionLog[]
}

export function AgentPerformance({ agents, workflows, executionLogs }: AgentPerformanceProps) {
  const agentStats = useMemo(() => {
    return agents.map((agent) => {
      // Find all nodes using this agent
      const agentNodes = workflows.flatMap((w) => w.nodes.filter((n) => n.data.code === agent.code))

      const agentNodeIds = agentNodes.map((n) => n.id)
      const agentLogs = executionLogs.filter((log) => agentNodeIds.includes(log.nodeId))

      const totalExecutions = agentLogs.length
      const successfulExecutions = agentLogs.filter((log) => log.status === "success").length
      const failedExecutions = agentLogs.filter((log) => log.status === "failed").length
      const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0
      const avgDuration =
        totalExecutions > 0 ? agentLogs.reduce((sum, log) => sum + (log.duration || 0), 0) / totalExecutions : 0

      return {
        agent,
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        successRate,
        avgDuration,
        usageCount: agentNodes.length,
      }
    })
  }, [agents, workflows, executionLogs])

  const sortedStats = [...agentStats].sort((a, b) => b.totalExecutions - a.totalExecutions)

  return (
    <Card className="h-full flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <BarChart3 className="w-5 h-5" />
          Agent Performance
        </h3>
        <p className="text-sm text-muted-foreground mt-1">Track execution metrics for each agent</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {sortedStats.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BarChart3 className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No performance data yet</p>
            </div>
          ) : (
            sortedStats.map(({ agent, totalExecutions, successRate, avgDuration, usageCount }) => (
              <Card key={agent.id} className="p-4 bg-card/50">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-sm">{agent.name}</h4>
                    <Badge variant="outline" className="mt-1 text-xs">
                      {agent.type}
                    </Badge>
                  </div>
                  <Badge variant="secondary">{usageCount} uses</Badge>
                </div>

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="w-3 h-3" />
                      <span>Executions</span>
                    </div>
                    <div className="font-semibold">{totalExecutions}</div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Success</span>
                    </div>
                    <div className="font-semibold">{successRate.toFixed(1)}%</div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>Avg Time</span>
                    </div>
                    <div className="font-semibold">{avgDuration.toFixed(0)}ms</div>
                  </div>
                </div>

                <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 transition-all" style={{ width: `${successRate}%` }} />
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
