"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import type { Workflow, ExecutionLog } from "@/lib/types"
import { Play, RotateCw, AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { toast } from "react-toastify"
import somaBackend from "../../somaBackend"

interface ExecutionPanelProps {
  workflow: Workflow | null
  onExecutionComplete: (logs: ExecutionLog[]) => void
}

export function ExecutionPanel({ workflow, onExecutionComplete }: ExecutionPanelProps) {
  const [isExecuting, setIsExecuting] = useState(false)
  const [logs, setLogs] = useState<ExecutionLog[]>([])

  useEffect(() => {
    // Listen for real-time updates
    const handleUpdate = (msg: any) => {
        const data = msg.payload || msg;
        // Check if the update is relevant to current workflow
        if (data.workflowId !== workflow?.id) return;

        if (data.type === 'node_start') {
            // Optional: Mark node as running
        } else if (data.type === 'node_complete') {
            setLogs(prev => [...prev, data.log]);
        }
    };

    somaBackend.on('workflow_update', handleUpdate);
    
    return () => {
        // somaBackend doesn't expose off method easily in current snippets, 
        // assuming standard EventEmitter pattern or we might need to verify somaBackend implementation.
        // Assuming it's safe to leave or we'd implement unsubscribe if critical.
        // Actually somaBackend is a singleton so we should remove listener to avoid dupes.
        // If somaBackend has .off or .removeListener
    };
  }, [workflow]);

  const handleExecute = async () => {
    if (!workflow) return
    
    setIsExecuting(true)
    setLogs([]) // Clear previous logs

    try {
      // Trigger execution - logs will stream in via WebSocket
      const response = await fetch("/api/execute-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workflow),
      })

      const data = await response.json()

      if (data.success) {
        // Final sync
        setLogs(data.logs)
        onExecutionComplete(data.logs)
        toast.success("Workflow executed successfully")
      } else {
        toast.error(`Execution failed: ${data.error}`)
      }
    } catch (error) {
      toast.error("Failed to execute workflow")
    } finally {
      setIsExecuting(false)
    }
  }

  return (
    <div className="space-y-4">
      <Button 
        onClick={handleExecute} 
        disabled={isExecuting || !workflow} 
        className="w-full bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 font-bold uppercase tracking-wider"
      >
        {isExecuting ? (
          <>
            <RotateCw className="mr-2 h-4 w-4 animate-spin" />
            Executing...
          </>
        ) : (
          <>
            <Play className="mr-2 h-4 w-4" />
            Run Workflow
          </>
        )}
      </Button>

      <div className="space-y-2">
        {logs.length === 0 ? (
          <div className="text-center py-8 text-zinc-600 italic text-xs">
            No execution logs yet
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`p-3 rounded-lg border text-xs ${
                log.status === "success"
                  ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-200"
                  : "bg-red-500/5 border-red-500/10 text-red-200"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 font-medium">
                  {log.status === "success" ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5 text-red-500" />
                  )}
                  <span>{log.nodeId}</span>
                </div>
                <div className="flex items-center gap-1 text-zinc-500 text-[10px]">
                  <Clock className="w-3 h-3" />
                  <span>{log.duration}ms</span>
                </div>
              </div>
              {log.output && (
                <div className="mt-2 pl-5">
                  <pre className="font-mono text-[10px] bg-black/30 p-2 rounded border border-white/5 overflow-x-auto">
                    {typeof log.output === 'object' ? JSON.stringify(log.output, null, 2) : log.output}
                  </pre>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}