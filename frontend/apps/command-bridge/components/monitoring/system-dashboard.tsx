"use client"

import { useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { Workflow, Agent, ExecutionLog } from "@/lib/types"
import { Activity, Zap, Code, CheckCircle2, XCircle, Clock, TrendingUp } from "lucide-react"

interface SystemDashboardProps {
  workflows: Workflow[]
  agents: Agent[]
  executionLogs: ExecutionLog[]
}

export function SystemDashboard({ workflows, agents, executionLogs }: SystemDashboardProps) {
  const stats = useMemo(() => {
    const totalExecutions = executionLogs.length
    const successfulExecutions = executionLogs.filter((log) => log.status === "success").length
    const failedExecutions = executionLogs.filter((log) => log.status === "failed").length
    const successRate = totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0
    const avgDuration =
      totalExecutions > 0 ? executionLogs.reduce((sum, log) => sum + (log.duration || 0), 0) / totalExecutions : 0

    const activeWorkflows = workflows.filter((w) => w.status === "running").length
    const totalNodes = workflows.reduce((sum, w) => sum + w.nodes.length, 0)

    return {
      totalWorkflows: workflows.length,
      activeWorkflows,
      totalAgents: agents.length,
      totalNodes,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate,
      avgDuration,
    }
  }, [workflows, agents, executionLogs])

  const statCards = [
    {
      label: "Total Workflows",
      value: stats.totalWorkflows,
      subValue: `${stats.activeWorkflows} active`,
      icon: Zap,
      color: "text-blue-400",
    },
    {
      label: "Total Agents",
      value: stats.totalAgents,
      subValue: `${stats.totalNodes} nodes`,
      icon: Code,
      color: "text-purple-400",
    },
    {
      label: "Executions",
      value: stats.totalExecutions,
      subValue: `${stats.successRate.toFixed(1)}% success`,
      icon: Activity,
      color: "text-green-400",
    },
    {
      label: "Avg Duration",
      value: `${stats.avgDuration.toFixed(0)}ms`,
      subValue: "per execution",
      icon: Clock,
      color: "text-orange-400",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">System Overview</h2>
        <p className="text-muted-foreground">Monitor your AI agent orchestration platform</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className={`w-10 h-10 rounded-lg bg-muted flex items-center justify-center ${stat.color}`}>
                <stat.icon className="w-5 h-5" />
              </div>
              <TrendingUp className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-2xl font-bold mb-1">{stat.value}</div>
              <div className="text-sm text-muted-foreground">{stat.label}</div>
              <div className="text-xs text-muted-foreground mt-1">{stat.subValue}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Execution Status
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm">Successful</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{stats.successfulExecutions}</Badge>
                <span className="text-xs text-muted-foreground">
                  {stats.totalExecutions > 0
                    ? ((stats.successfulExecutions / stats.totalExecutions) * 100).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-destructive" />
                <span className="text-sm">Failed</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{stats.failedExecutions}</Badge>
                <span className="text-xs text-muted-foreground">
                  {stats.totalExecutions > 0 ? ((stats.failedExecutions / stats.totalExecutions) * 100).toFixed(1) : 0}%
                </span>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Recent Activity
          </h3>
          <div className="space-y-2">
            {executionLogs
              .slice(-5)
              .reverse()
              .map((log) => (
                <div key={log.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                  <div className="flex items-center gap-2">
                    {log.status === "success" ? (
                      <CheckCircle2 className="w-3 h-3 text-green-400" />
                    ) : (
                      <XCircle className="w-3 h-3 text-destructive" />
                    )}
                    <span className="text-xs font-mono">{log.nodeId.slice(0, 12)}...</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{log.duration}ms</span>
                </div>
              ))}
            {executionLogs.length === 0 && (
              <div className="text-center py-4 text-sm text-muted-foreground">No recent activity</div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
