"use client"

import type { Position } from "@/lib/types"

interface ConnectionLineProps {
  id: string
  start: Position
  end: Position
  isTemporary?: boolean
  onDelete?: (id: string) => void
}

export function ConnectionLine({ id, start, end, isTemporary = false, onDelete }: ConnectionLineProps) {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const controlPointOffset = Math.abs(dx) * 0.5

  const path = `
    M ${start.x} ${start.y}
    C ${start.x + controlPointOffset} ${start.y},
      ${end.x - controlPointOffset} ${end.y},
      ${end.x} ${end.y}
  `

  return (
    <g className={isTemporary ? "pointer-events-none" : "group cursor-pointer"}>
      <path
        d={path}
        fill="none"
        stroke={isTemporary ? "oklch(0.5 0.1 264 / 0.5)" : "oklch(0.488 0.243 264.376)"}
        strokeWidth="2"
        strokeDasharray={isTemporary ? "5,5" : undefined}
        className="transition-all group-hover:stroke-[3]"
      />

      {!isTemporary && onDelete && (
        <g
          onClick={(e) => {
            e.stopPropagation()
            onDelete(id)
          }}
        >
          <circle
            cx={(start.x + end.x) / 2}
            cy={(start.y + end.y) / 2}
            r="12"
            fill="oklch(0.396 0.141 25.723)"
            className="opacity-0 group-hover:opacity-100 transition-opacity"
          />
          <text
            x={(start.x + end.x) / 2}
            y={(start.y + end.y) / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="white"
            fontSize="16"
            fontWeight="bold"
            className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          >
            ×
          </text>
        </g>
      )}
    </g>
  )
}
