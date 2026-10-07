"use client"

import { useState, ReactNode } from "react"
import { Card } from "@/components/ui/card"
import { ChevronRight, X } from "lucide-react"

interface FloatingPanelProps {
  title: ReactNode
  children: ReactNode
  defaultExpanded?: boolean
  className?: string
  onClose?: () => void
  icon?: React.ElementType
  iconColor?: string
}

export function FloatingPanel({ 
  title, 
  children, 
  defaultExpanded = true, 
  className = "", 
  onClose,
  icon: Icon,
  iconColor = "text-zinc-400"
}: FloatingPanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  return (
    <div className={`z-10 ${className}`}>
      <Card className="bg-[#151518]/95 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden shadow-2xl transition-all duration-200">
        <div className="p-3 border-b border-white/5 flex items-center justify-between bg-white/5 select-none">
          <div 
            className="flex items-center space-x-2 cursor-pointer flex-1" 
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {Icon && <Icon className={`w-4 h-4 ${iconColor}`} />}
            <h3 className="font-bold text-xs text-zinc-200 uppercase tracking-wide">{title}</h3>
          </div>
          
          <div className="flex items-center space-x-1">
            {onClose && (
              <button 
                onClick={(e) => { e.stopPropagation(); onClose(); }}
                className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-white/10 rounded text-zinc-500 hover:text-white transition-colors"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? "rotate-90" : ""}`} />
            </button>
          </div>
        </div>

        <div className={`transition-all duration-300 ease-in-out overflow-hidden ${isExpanded ? "max-h-[80vh] opacity-100" : "max-h-0 opacity-0"}`}>
          <div className="p-2 custom-scrollbar overflow-y-auto max-h-[calc(80vh-40px)]">
            {children}
          </div>
        </div>
      </Card>
    </div>
  )
}
