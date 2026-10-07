"use client"

import type { WorkflowNode } from "@/lib/types"
import { FloatingPanel } from "../ui/floating-panel"
import { Label } from "@/components/ui/label"
import { Settings } from "lucide-react"

interface NodeConfigPanelProps {
  node: WorkflowNode | null
  onClose: () => void
  onUpdate: (nodeId: string, updates: Partial<WorkflowNode>) => void
}

export function NodeConfigPanel({ node, onClose, onUpdate }: NodeConfigPanelProps) {
  if (!node) return null

  return (
    <FloatingPanel
      title="Configuration"
      className="absolute right-80 mr-4 top-4 w-72"
      onClose={onClose}
      icon={Settings}
      iconColor="text-cyan-400"
    >
      <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="node-label" className="text-xs font-bold text-zinc-500 uppercase">Label</Label>
                    <input
                      id="node-label"
                      value={node.data?.label || ""}
                      onChange={(e) =>
                        onUpdate(node.id, {
                          data: { ...node.data, label: e.target.value },
                        })
                      }
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                  </div>
        
                  <div className="space-y-2">
                    <Label htmlFor="node-description" className="text-xs font-bold text-zinc-500 uppercase">Description</Label>
                    <textarea
                      id="node-description"
                      value={node.data?.description || ""}
                      onChange={(e) =>
                        onUpdate(node.id, {
                          data: { ...node.data, description: e.target.value },
                        })
                      }
                      rows={3}
                      className="w-full bg-zinc-900 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-cyan-500/50 resize-none transition-colors"
                    />
                  </div>
        
                  {node.data?.code !== undefined && (
                    <div className="space-y-2">
                      <Label htmlFor="node-code" className="text-xs font-bold text-zinc-500 uppercase">Code Logic</Label>
                      <textarea
                        id="node-code"
                        value={node.data.code || ""}
                        onChange={(e) =>
                          onUpdate(node.id, {
                            data: { ...node.data, code: e.target.value },
                          })
                        }
                        rows={12}
                        className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500/50 resize-none custom-scrollbar"
                      />
                    </div>
                  )}
        
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-zinc-500 uppercase">Parameters (JSON)</Label>
                    <textarea
                      value={JSON.stringify(node.data?.config || {}, null, 2)}
                      onChange={(e) => {
                        try {
                          const config = JSON.parse(e.target.value)
                          onUpdate(node.id, {
                            data: { ...node.data, config },
                          })
                        } catch (error) {
                          // Invalid JSON, ignore
                        }
                      }}            rows={8}
            className="w-full bg-[#09090b] border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-amber-400 focus:outline-none focus:border-amber-500/50 resize-none custom-scrollbar"
          />
        </div>
      </div>
    </FloatingPanel>
  )
}
