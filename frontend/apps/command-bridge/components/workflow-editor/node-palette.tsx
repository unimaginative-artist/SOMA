"use client"

import { FloatingPanel } from "../ui/floating-panel"
import type { NodeType } from "@/lib/types"
import { Zap, Play, GitBranch, Bot, FileText, Shuffle, Globe, Code, Plus, Layers } from "lucide-react"

interface NodePaletteProps {
  onAddNode: (type: NodeType) => void
}

const nodeTypes: { type: NodeType; label: string; icon: any; description: string }[] = [
  { type: "trigger", label: "Trigger", icon: Zap, description: "Start workflow" },
  { type: "action", label: "Action", icon: Play, description: "Execute action" },
  { type: "condition", label: "Condition", icon: GitBranch, description: "Branch logic" },
  { type: "ai-agent", label: "AI Agent", icon: Bot, description: "AI processing" },
  { type: "parser", label: "Parser", icon: FileText, description: "Parse data" },
  { type: "transformer", label: "Transform", icon: Shuffle, description: "Transform data" },
  { type: "api-call", label: "API Call", icon: Globe, description: "HTTP request" },
  { type: "custom", label: "Custom", icon: Code, description: "Custom code" },
]

export function NodePalette({ onAddNode }: NodePaletteProps) {
  return (
    <FloatingPanel 
      title="Node Palette" 
      className="absolute left-4 top-4 w-52"
      icon={Layers}
      iconColor="text-purple-400"
    >
      <div className="space-y-1">
        {nodeTypes.map(({ type, label, icon: Icon, description }) => (
          <button
            key={type}
            onClick={() => onAddNode(type)}
            className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-all text-left group border border-transparent hover:border-white/5"
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-zinc-800/80 group-hover:bg-purple-500/20 transition-colors border border-white/5 group-hover:border-purple-500/30">
              <Icon className="w-3.5 h-3.5 text-zinc-400 group-hover:text-purple-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-xs text-zinc-200 group-hover:text-white transition-colors">{label}</div>
              <div className="text-[9px] text-zinc-500 truncate">{description}</div>
            </div>
            <Plus className="w-3 h-3 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </FloatingPanel>
  )
}
