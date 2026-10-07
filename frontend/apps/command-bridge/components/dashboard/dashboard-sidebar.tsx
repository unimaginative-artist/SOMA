"use client"

import { Button } from "@/components/ui/button"
import { LayoutGrid, GitBranch, Code, MessageSquare, Activity } from "lucide-react"

type ViewMode = "workflows" | "editor" | "agents" | "chat" | "monitoring"

interface DashboardSidebarProps {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
}

export function DashboardSidebar({ viewMode, onViewModeChange }: DashboardSidebarProps) {
  const navItems = [
    { mode: "workflows" as ViewMode, icon: LayoutGrid, label: "Workflows" },
    { mode: "editor" as ViewMode, icon: GitBranch, label: "Editor" },
    { mode: "agents" as ViewMode, icon: Code, label: "Agents" },
    { mode: "chat" as ViewMode, icon: MessageSquare, label: "AI Chat" },
    { mode: "monitoring" as ViewMode, icon: Activity, label: "Monitor" },
  ]

  return (
    <aside className="w-20 border-r border-border bg-card flex flex-col items-center py-4 gap-2">
      {navItems.map(({ mode, icon: Icon, label }) => (
        <Button
          key={mode}
          variant={viewMode === mode ? "default" : "ghost"}
          size="icon"
          className="w-14 h-14 flex flex-col gap-1"
          onClick={() => onViewModeChange(mode)}
          title={label}
        >
          <Icon className="w-5 h-5" />
          <span className="text-xs">{label}</span>
        </Button>
      ))}
    </aside>
  )
}
