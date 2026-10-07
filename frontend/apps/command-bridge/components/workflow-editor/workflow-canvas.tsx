"use client"

import type React from "react"

import { useCallback, useRef, useState, useEffect } from "react"
import type { WorkflowNode as Node, WorkflowConnection, Position } from "@/lib/types"
import { WorkflowNode } from "./workflow-node"
import { ConnectionLine } from "./connection-line"
import { NodePalette } from "./node-palette"
// Correct relative path: 4 levels up
import somaBackend from "../../../../somaBackend.js"

interface WorkflowCanvasProps {
  nodes: Node[]
  connections: WorkflowConnection[]
  onNodesChange: (nodes: Node[]) => void
  onConnectionsChange: (connections: WorkflowConnection[]) => void
  onNodeSelect: (nodeId: string | null) => void
  selectedNodeId: string | null
}

export function WorkflowCanvas({
  nodes,
  connections,
  onNodesChange,
  onConnectionsChange,
  onNodeSelect,
  selectedNodeId,
}: WorkflowCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<Position>({ x: 0, y: 0 })
  const [offset, setOffset] = useState<Position>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [draggedNode, setDraggedNode] = useState<string | null>(null)
  const [connectionStart, setConnectionStart] = useState<string | null>(null)
  const [tempConnection, setTempConnection] = useState<Position | null>(null)

  // Handle canvas panning
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === canvasRef.current || (e.target as HTMLElement).classList.contains("canvas-background")) {
        setIsPanning(true)
        setPanStart({ x: e.clientX - offset.x, y: e.clientY - offset.y })
        onNodeSelect(null)
      }
    },
    [offset, onNodeSelect],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning) {
        setOffset({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        })
      }

      if (draggedNode) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          const x = (e.clientX - rect.left - offset.x) / zoom
          const y = (e.clientY - rect.top - offset.y) / zoom

          onNodesChange(nodes.map((node) => (node.id === draggedNode ? { ...node, position: { x, y } } : node)))
        }
      }

      if (connectionStart) {
        const rect = canvasRef.current?.getBoundingClientRect()
        if (rect) {
          setTempConnection({
            x: (e.clientX - rect.left - offset.x) / zoom,
            y: (e.clientY - rect.top - offset.y) / zoom,
          })
        }
      }
    },
    [isPanning, panStart, draggedNode, connectionStart, nodes, onNodesChange, offset, zoom],
  )

  const handleMouseUp = useCallback(() => {
    setIsPanning(false)
    setDraggedNode(null)
    setConnectionStart(null)
    setTempConnection(null)
  }, [])

  // Handle zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY * -0.001
      const newZoom = Math.min(Math.max(0.5, zoom + delta), 2)
      setZoom(newZoom)
    },
    [zoom],
  )

  // Node drag handlers
  const handleNodeDragStart = useCallback(
    (nodeId: string) => {
      setDraggedNode(nodeId)
      onNodeSelect(nodeId)
    },
    [onNodeSelect],
  )

  // Connection handlers
  const handleConnectionStart = useCallback((nodeId: string) => {
    setConnectionStart(nodeId)
  }, [])

  const handleConnectionEnd = useCallback(
    (targetNodeId: string) => {
      if (connectionStart && connectionStart !== targetNodeId) {
        const newConnection: WorkflowConnection = {
          id: `conn_${Date.now()}`,
          source: connectionStart,
          target: targetNodeId,
        }
        onConnectionsChange([...connections, newConnection])
        
        // 🔥 SIGNAL STEVE: "User connected two nodes"
        somaBackend.send('steve.observe', {
            action: 'connection_created',
            source: connectionStart,
            target: targetNodeId,
            context: { nodes, connections }
        });
      }
      setConnectionStart(null)
      setTempConnection(null)
    },
    [connectionStart, connections, onConnectionsChange, nodes],
  )

  // Delete connection
  const handleConnectionDelete = useCallback(
    (connectionId: string) => {
      onConnectionsChange(connections.filter((c) => c.id !== connectionId))
    },
    [connections, onConnectionsChange],
  )

  return (
    <div className="relative w-full h-full overflow-hidden bg-background">
      <NodePalette
        onAddNode={(type) => {
          const newNode: Node = {
            id: `node_${Date.now()}`,
            type,
            position: { x: 100, y: 100 },
            data: {
              label: `${type} Node`,
              type,
              config: {},
            },
          }
          onNodesChange([...nodes, newNode])
          
          // 🔥 SIGNAL STEVE: "User added a node"
          somaBackend.send('steve.observe', {
              action: 'node_added',
              nodeType: type,
              context: { nodes }
          });
        }}
      />

      <div
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
      >
        <div
          className="canvas-background absolute inset-0"
          style={{
            backgroundImage: `
              radial-gradient(circle, oklch(0.25 0.01 264) 1px, transparent 1px)
            `,
            backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
            backgroundPosition: `${offset.x}px ${offset.y}px`,
          }}
        />

        <svg
          className="absolute inset-0 pointer-events-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {connections.map((connection) => {
            const sourceNode = nodes.find((n) => n.id === connection.source)
            const targetNode = nodes.find((n) => n.id === connection.target)

            if (!sourceNode || !targetNode) return null

            return (
              <ConnectionLine
                key={connection.id}
                id={connection.id}
                start={{
                  x: sourceNode.position.x + 150,
                  y: sourceNode.position.y + 40,
                }}
                end={{
                  x: targetNode.position.x,
                  y: targetNode.position.y + 40,
                }}
                onDelete={handleConnectionDelete}
              />
            )
          })}

          {connectionStart && tempConnection && (
            <ConnectionLine
              id="temp"
              start={{
                x: (nodes.find((n) => n.id === connectionStart)?.position.x || 0) + 150,
                y: (nodes.find((n) => n.id === connectionStart)?.position.y || 0) + 40,
              }}
              end={tempConnection}
              isTemporary
            />
          )}
        </svg>

        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {nodes.map((node) => (
            <WorkflowNode
              key={node.id}
              node={node}
              isSelected={selectedNodeId === node.id}
              onDragStart={handleNodeDragStart}
              onConnectionStart={handleConnectionStart}
              onConnectionEnd={handleConnectionEnd}
              onDelete={() => {
                onNodesChange(nodes.filter((n) => n.id !== node.id))
                onConnectionsChange(connections.filter((c) => c.source !== node.id && c.target !== node.id))
              }}
            />
          ))}
        </div>
      </div>

      <div className="absolute bottom-4 right-4 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
        <button onClick={() => setZoom(Math.max(0.5, zoom - 0.1))} className="text-sm font-medium hover:text-primary">
          -
        </button>
        <span className="text-sm font-mono">{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom(Math.min(2, zoom + 0.1))} className="text-sm font-medium hover:text-primary">
          +
        </button>
      </div>
    </div>
  )
}
