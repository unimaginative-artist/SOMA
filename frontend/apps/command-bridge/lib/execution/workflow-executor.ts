import type { Workflow, WorkflowNode, ExecutionLog } from "@/lib/types"
import { generateId } from "@/lib/utils/id-generator"

export class WorkflowExecutor {
  private workflow: Workflow
  private executionLogs: ExecutionLog[] = []
  private nodeOutputs: Map<string, any> = new Map()

  constructor(workflow: Workflow) {
    this.workflow = workflow
  }

  async execute(initialInput?: any): Promise<{ success: boolean; logs: ExecutionLog[]; error?: string }> {
    console.log("[v0] Starting workflow execution:", this.workflow.name)

    try {
      // Find trigger nodes to start execution
      const triggerNodes = this.workflow.nodes.filter((node) => node.type === "trigger")

      if (triggerNodes.length === 0) {
        throw new Error("No trigger node found in workflow")
      }

      // Execute from each trigger node
      for (const triggerNode of triggerNodes) {
        await this.executeNode(triggerNode, initialInput)
      }

      // Execute remaining nodes in topological order
      const executedNodes = new Set(triggerNodes.map((n) => n.id))
      let hasProgress = true

      while (hasProgress && executedNodes.size < this.workflow.nodes.length) {
        hasProgress = false

        for (const node of this.workflow.nodes) {
          if (executedNodes.has(node.id)) continue

          // Check if all dependencies are satisfied
          const dependencies = this.workflow.connections
            .filter((conn) => conn.target === node.id)
            .map((conn) => conn.source)

          const allDependenciesMet = dependencies.every((depId) => executedNodes.has(depId))

          if (allDependenciesMet) {
            // Gather inputs from connected nodes
            const inputs = dependencies.map((depId) => this.nodeOutputs.get(depId))
            const nodeInput = inputs.length === 1 ? inputs[0] : inputs

            await this.executeNode(node, nodeInput)
            executedNodes.add(node.id)
            hasProgress = true
          }
        }
      }

      console.log("[v0] Workflow execution completed successfully")
      return { success: true, logs: this.executionLogs }
    } catch (error) {
      console.error("[v0] Workflow execution failed:", error)
      return {
        success: false,
        logs: this.executionLogs,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  private async executeNode(node: WorkflowNode, input: any): Promise<void> {
    const startTime = new Date()
    const logId = generateId("log")

    console.log(`[v0] Executing node: ${node.data.label} (${node.type})`)

    try {
      let output: any

      switch (node.type) {
        case "trigger":
          output = input || { triggered: true, timestamp: new Date().toISOString() }
          break

        case "condition":
          output = await this.executeCondition(node, input)
          break

        case "custom":
        case "ai-agent":
        case "parser":
        case "transformer":
        case "api-call":
        case "action":
          output = await this.executeCustomCode(node, input)
          break

        default:
          throw new Error(`Unknown node type: ${node.type}`)
      }

      this.nodeOutputs.set(node.id, output)

      const endTime = new Date()
      const log: ExecutionLog = {
        id: logId,
        workflowId: this.workflow.id,
        nodeId: node.id,
        status: "success",
        input,
        output,
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
      }

      this.executionLogs.push(log)
      console.log(`[v0] Node executed successfully:`, node.data.label)
    } catch (error) {
      const endTime = new Date()
      const log: ExecutionLog = {
        id: logId,
        workflowId: this.workflow.id,
        nodeId: node.id,
        status: "failed",
        input,
        output: null,
        error: error instanceof Error ? error.message : "Unknown error",
        startTime,
        endTime,
        duration: endTime.getTime() - startTime.getTime(),
      }

      this.executionLogs.push(log)
      console.error(`[v0] Node execution failed:`, node.data.label, error)
      throw error
    }
  }

  private async executeCondition(node: WorkflowNode, input: any): Promise<any> {
    const { condition } = node.data.config

    if (!condition) {
      throw new Error("No condition specified")
    }

    try {
      // Create a safe evaluation context
      const evalFunction = new Function("input", `return ${condition}`)
      const result = evalFunction(input)

      return {
        condition,
        result: Boolean(result),
        input,
      }
    } catch (error) {
      throw new Error(`Condition evaluation failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  private async executeCustomCode(node: WorkflowNode, input: any): Promise<any> {
    const code = node.data.code

    if (!code) {
      throw new Error("No code specified for node")
    }

    try {
      // Create an async function from the code
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
      const executeFunction = new AsyncFunction("input", "config", code + "\n\nreturn await execute(input, config);")

      const result = await executeFunction(input, node.data.config)
      return result
    } catch (error) {
      throw new Error(`Code execution failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  getExecutionLogs(): ExecutionLog[] {
    return this.executionLogs
  }

  getNodeOutput(nodeId: string): any {
    return this.nodeOutputs.get(nodeId)
  }
}
