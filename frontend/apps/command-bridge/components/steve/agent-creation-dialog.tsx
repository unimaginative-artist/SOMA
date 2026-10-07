"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { NodeType, Agent } from "@/lib/types"
import { Loader2, Sparkles } from "lucide-react"

interface AgentCreationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAgentCreated: (agent: Agent) => void
}

export function AgentCreationDialog({ open, onOpenChange, onAgentCreated }: AgentCreationDialogProps) {
  const [prompt, setPrompt] = useState("")
  const [name, setName] = useState("")
  const [type, setType] = useState<NodeType>("custom")
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!prompt.trim()) {
      setError("Please describe what you want the agent to do")
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      const response = await fetch("/api/create-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, type, name: name || undefined }),
      })

      const data = await response.json()

      if (data.success && data.agent) {
        onAgentCreated(data.agent)
        setPrompt("")
        setName("")
        setType("custom")
        onOpenChange(false)
      } else {
        setError(data.error || "Failed to create agent")
      }
    } catch (err) {
      setError("Network error. Please try again.")
      console.error("[v0] Agent creation error:", err)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Create AI Agent
          </DialogTitle>
          <DialogDescription>
            Describe what you want your agent to do, and AI will generate the code for you.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="agent-name">Agent Name (Optional)</Label>
            <Input
              id="agent-name"
              placeholder="e.g., Email Parser, Data Transformer"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-type">Agent Type</Label>
            <Select value={type} onValueChange={(value) => setType(value as NodeType)} disabled={isCreating}>
              <SelectTrigger id="agent-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="parser">Parser</SelectItem>
                <SelectItem value="transformer">Transformer</SelectItem>
                <SelectItem value="api-call">API Call</SelectItem>
                <SelectItem value="ai-agent">AI Agent</SelectItem>
                <SelectItem value="action">Action</SelectItem>
                <SelectItem value="condition">Condition</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="agent-prompt">What should this agent do?</Label>
            <Textarea
              id="agent-prompt"
              placeholder="Example: I need an agent that parses email addresses and phone numbers from text and returns them in a structured format"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              disabled={isCreating}
              className="resize-none"
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={isCreating || !prompt.trim()}>
            {isCreating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Creating Agent...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Create Agent
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
