"use client"

import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ExecutionLog } from "@/lib/types"
import { History, CheckCircle2, XCircle, Clock, Trash2 } from "lucide-react"

interface ExecutionHistoryProps {
  logs: ExecutionLog[]
  onClear: () => void
  onLogSelect?: (log: ExecutionLog) => void
}

export function ExecutionHistory({ logs, onClear, onLogSelect }: ExecutionHistoryProps) {
  // Group logs by workflow execution
  const groupedLogs = logs.reduce(
    (acc, log) => {
      const key = `${log.workflowId}_${log.startTime.toISOString()}`
      if (!acc[key]) {
        acc[key] = []
      }
      acc[key].push(log)
      return acc
    },
    {} as Record<string, ExecutionLog[]>,
  )

  const executions = Object.entries(groupedLogs).map(([key, logs]) => ({
    key,
    logs,
    startTime: logs[0].startTime,
    success: logs.every((log) => log.status === "success"),
    duration: logs.reduce((sum, log) => sum + (log.duration || 0), 0),
  }))

  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          <History className="w-5 h-5" />
          Execution History
        </h3>
        {logs.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {executions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <History className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No execution history</p>
            </div>
          ) : (
            executions.reverse().map((execution) => (
              <div
                key={execution.key}
                className="p-3 rounded-lg border border-border bg-card hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => onLogSelect?.(execution.logs[0])}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2">
                    {execution.success ? (
                      <CheckCircle2 className="w-4 h-4 text-green-400" />
                    ) : (
                      <XCircle className="w-4 h-4 text-destructive" />
                    )}
                    <span className="text-sm font-semibold">
                      {execution.success ? "Successful" : "Failed"} Execution
                    </span>
                  </div>
                  <Badge variant="outline">{execution.logs.length} steps</Badge>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    <span>{execution.duration}ms</span>
                  </div>
                  <span>{new Date(execution.startTime).toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
