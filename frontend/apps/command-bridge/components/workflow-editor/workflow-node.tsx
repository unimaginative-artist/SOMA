"use client"

import type { WorkflowNode as Node } from "@/lib/types"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Zap, Play, GitBranch, Bot, FileText, Shuffle, Globe, Code, X, Circle } from "lucide-react"

interface WorkflowNodeProps {
  node: Node
  isSelected: boolean
  onDragStart: (nodeId: string) => void
  onConnectionStart: (nodeId: string) => void
  onConnectionEnd: (nodeId: string) => void
  onDelete: () => void
}

const nodeIcons = {
  trigger: Zap,
  action: Play,
  condition: GitBranch,
  "ai-agent": Bot,
  parser: FileText,
  transformer: Shuffle,
  "api-call": Globe,
  custom: Code,
}

const nodeColors = {
  trigger: "text-green-400 border-green-400/30 bg-green-400/10",
  action: "text-blue-400 border-blue-400/30 bg-blue-400/10",
  condition: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  "ai-agent": "text-purple-400 border-purple-400/30 bg-purple-400/10",
  parser: "text-cyan-400 border-cyan-400/30 bg-cyan-400/10",
  transformer: "text-orange-400 border-orange-400/30 bg-orange-400/10",
  "api-call": "text-pink-400 border-pink-400/30 bg-pink-400/10",
  custom: "text-gray-400 border-gray-400/30 bg-gray-400/10",
}

export function WorkflowNode({
  node,
  isSelected,
  onDragStart,
  onConnectionStart,
  onConnectionEnd,
  onDelete,
}: WorkflowNodeProps) {
  const Icon = nodeIcons[node.type]

  return (
    <div
      className="absolute cursor-move"
      style={{
        left: node.position.x,
        top: node.position.y,
      }}
      onMouseDown={(e) => {
        e.stopPropagation()
        onDragStart(node.id)
      }}
    >
      <Card
        className={`
          w-[300px] p-4 transition-all
          ${isSelected ? "ring-2 ring-primary shadow-lg" : "hover:shadow-md"}
          ${nodeColors[node.type]}
        `}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 flex-1">
            <Icon className="w-5 h-5" />
            <div className="flex-1">
              <h3 className="font-semibold text-sm text-foreground">{node.data.label}</h3>
              <Badge variant="outline" className="mt-1 text-xs">
                {node.type}
              </Badge>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 -mt-1 -mr-1"
            onMouseDown={(e) => e.stopPropagation()} // Prevent drag start / selection
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {node.data.description && <p className="text-xs text-muted-foreground mb-3">{node.data.description}</p>}

        <div className="flex items-center justify-between">
          <button
            className="group flex items-center gap-1 text-xs hover:text-primary"
            onMouseDown={(e) => {
              e.stopPropagation()
            }}
            onMouseUp={(e) => {
              e.stopPropagation()
              onConnectionEnd(node.id)
            }}
          >
            <Circle className="w-3 h-3 fill-current" />
            <span>Input</span>
          </button>

          <button
            className="group flex items-center gap-1 text-xs hover:text-primary"
            onMouseDown={(e) => {
              e.stopPropagation()
              onConnectionStart(node.id)
            }}
          >
            <span>Output</span>
            <Circle className="w-3 h-3 fill-current" />
          </button>
        </div>
      </Card>
    </div>
  )
}
