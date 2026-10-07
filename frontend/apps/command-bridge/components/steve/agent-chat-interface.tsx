"use client"

import type React from "react"

import { useState, useRef, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { Agent } from "@/lib/types"
import { Bot, User, Send, Loader2, CheckCircle2, XCircle } from "lucide-react"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  agent?: Agent
  error?: boolean
}

interface AgentChatInterfaceProps {
  onAgentCreated: (agent: Agent) => void
}

export function AgentChatInterface({ onAgentCreated }: AgentChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Greetings. I'm STEVE, your Agent Architect. I have direct access to SOMA's developmental core. Tell me what kind of specialized intelligence you need, and I'll architect the agent parameters for you.",
    },
  ])
  const [input, setInput] = useState("")
  const [isProcessing, setIsProcessing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isProcessing) return

    const userMessage: Message = {
      id: `msg_${Date.now()}`,
      role: "user",
      content: input,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput("")
    setIsProcessing(true)

    try {
      // Switched to STEVE chat endpoint
      const response = await fetch("/api/steve/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: input, context: { source: 'steve-architect' } }),
      })

      const data = await response.json()

      if (data.success && data.response) {
        const assistantMessage: Message = {
          id: `msg_${Date.now()}_response`,
          role: "assistant",
          content: data.response,
          agent: data.agent, // Backend now provides agent data if created
        }
        setMessages((prev) => [...prev, assistantMessage])
        if (data.agent) onAgentCreated(data.agent)
      } else {
        const errorMessage: Message = {
          id: `msg_${Date.now()}_error`,
          role: "assistant",
          content: `Architectural error: ${data.error || "Unknown error"}. My connection to the core might be unstable.`,
          error: true,
        }
        setMessages((prev) => [...prev, errorMessage])
      }
    } catch (err) {
      const errorMessage: Message = {
        id: `msg_${Date.now()}_error`,
        role: "assistant",
        content: "Core connection failure. Even I have limits when the network is severed.",
        error: true,
      }
      setMessages((prev) => [...prev, errorMessage])
      console.error("[STEVE] Chat error:", err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Card className="flex flex-col h-full bg-card border-border">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <Bot className="w-5 h-5 text-emerald-400" />
          STEVE: Agent Architect
        </h3>
        <p className="text-sm text-muted-foreground mt-1">Specialized developmental interface for SOMA agent parameters</p>
      </div>

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((message) => (
            <div key={message.id} className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}>
              {message.role === "assistant" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
              )}

              <div
                className={`flex-1 max-w-[80%] ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground rounded-lg p-3"
                    : message.error
                      ? "bg-destructive/10 border border-destructive/20 rounded-lg p-3"
                      : "bg-muted rounded-lg p-3"
                }`}
              >
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>

                {message.agent && (
                  <div className="mt-3 p-3 bg-background/50 rounded border border-border">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <h4 className="font-semibold text-sm">{message.agent.name}</h4>
                        <p className="text-xs text-muted-foreground mt-1">{message.agent.description}</p>
                      </div>
                      <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
                    </div>
                    <div className="text-xs text-muted-foreground">Type: {message.agent.type}</div>
                  </div>
                )}

                {message.error && (
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <XCircle className="w-4 h-4" />
                    <span>Error occurred</span>
                  </div>
                )}
              </div>

              {message.role === "user" && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {isProcessing && (
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="w-4 h-4 text-primary" />
              </div>
              <div className="bg-muted rounded-lg p-3">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Creating your agent...
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe the agent you want to create..."
            className="resize-none"
            rows={2}
            disabled={isProcessing}
          />
          <Button onClick={handleSend} disabled={!input.trim() || isProcessing} size="icon" className="flex-shrink-0">
            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2">Press Enter to send, Shift+Enter for new line</p>
      </div>
    </Card>
  )
}
