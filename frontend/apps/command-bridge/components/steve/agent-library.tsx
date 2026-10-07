"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Agent } from "@/lib/types"
import { Bot, Code, Trash2, Copy, Calendar } from "lucide-react"

interface AgentLibraryProps {
  agents: Agent[]
  onAgentSelect: (agent: Agent) => void
  onAgentDelete: (agentId: string) => void
  onAgentDuplicate: (agent: Agent) => void
  selectedAgentId?: string
}

export function AgentLibrary({
  agents,
  onAgentSelect,
  onAgentDelete,
  onAgentDuplicate,
  selectedAgentId,
}: AgentLibraryProps) {
  return (
    <Card className="h-full bg-card border-border flex flex-col">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <Code className="w-5 h-5" />
          Agent Library
        </h3>
        <p className="text-sm text-muted-foreground mt-1">{agents.length} agents available</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {agents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No agents yet</p>
              <p className="text-xs mt-1">Create your first agent to get started</p>
            </div>
          ) : (
            agents.map((agent) => (
              <div
                key={agent.id}
                className={`p-3 rounded-lg border transition-all cursor-pointer hover:border-primary/50 ${
                  selectedAgentId === agent.id ? "border-primary bg-primary/5" : "border-border bg-card"
                }`}
                onClick={() => onAgentSelect(agent)}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate">{agent.name}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{agent.description}</p>
                  </div>
                  <Badge variant="outline" className="text-xs flex-shrink-0">
                    {agent.type}
                  </Badge>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="w-3 h-3" />
                    <span>v{agent.version}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAgentDuplicate(agent)
                      }}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAgentDelete(agent.id)
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </Card>
  )
}
