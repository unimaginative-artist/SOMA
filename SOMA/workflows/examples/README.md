# SOMA Workflow Examples

This directory contains example workflows demonstrating the capabilities of SOMA's Phase 2 Visual Workflow System.

## Overview

SOMA's workflow system provides three ways to create and execute workflows:

1. **Visual Designer** - Drag-and-drop interface in Pulse (Workflows tab)
2. **Sequential Chains** - Fluent API for programmatic workflow creation
3. **FSM Workflows** - Complete finite state machine definitions (JSON)

## Example Workflows

### 1. Simple Greeting Workflow
**File:** `01-simple-greeting.json`
**Difficulty:** Beginner
**Type:** Sequential
**Duration:** ~40 seconds

A basic workflow demonstrating:
- Action states
- Error handling
- Terminal states

**Usage:**
```javascript
// Load and execute via API
const workflow = require('./01-simple-greeting.json');

fetch('http://localhost:3001/api/workflows/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workflow })
});

// Then execute
fetch('http://localhost:3001/api/workflows/execute', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workflowId: 'example_greeting',
    input: {}
  })
});
```

### 2. Data Processing Pipeline
**File:** `02-data-pipeline.json`
**Difficulty:** Intermediate
**Type:** Pipeline (ETL)
**Duration:** ~2.5 minutes

Demonstrates the Extract-Transform-Load pattern:
- Data extraction with retries
- Conditional validation
- Multi-step transformation
- Data loading and verification

**Key Features:**
- Retry logic on failures
- Decision branching based on data
- Error recovery strategies
- Multiple terminal states for different outcomes

### 3. Parallel Multi-Brain Analysis
**File:** `03-parallel-processing.json`
**Difficulty:** Advanced
**Type:** Parallel
**Duration:** ~2 minutes

Showcases parallel execution:
- Multiple analysis tasks running concurrently
- Partial failure handling
- Result aggregation
- Join states

**Use Case:** When you need to analyze something from multiple perspectives simultaneously (LOGOS, AURORA, PROMETHEUS brains working together).

### 4. Conditional Decision Flow
**File:** `04-conditional-flow.json`
**Difficulty:** Intermediate
**Type:** Conditional
**Duration:** ~1 minute

Demonstrates complex branching:
- 4-way decision branching (critical/high/medium/low urgency)
- Priority-based routing
- Escalation paths
- Wait/retry patterns

**Use Case:** Request routing, triage systems, priority queues.

## API Endpoints

### Workflow Management

```bash
# Register a workflow
POST /api/workflows/register
{
  "workflow": { ...workflow JSON... }
}

# Execute a workflow
POST /api/workflows/execute
{
  "workflowId": "example_greeting",
  "input": { "data": "value" },
  "context": {}
}

# List all workflows
GET /api/workflows/list

# Get workflow by ID
GET /api/workflows/:id

# Get execution history
GET /api/workflows/:id/executions

# Get workflow statistics
GET /api/workflows/:id/stats
```

### Sequential Chains

```bash
# Execute a chain from template
POST /api/chains/template
{
  "template": "data-pipeline",
  "options": {
    "name": "My Pipeline",
    "extractParams": { "source": "api" },
    "transformParams": { "operations": ["normalize"] }
  },
  "register": true
}

# Execute custom chain
POST /api/chains/execute
{
  "name": "My Custom Chain",
  "tasks": [
    {
      "type": "action",
      "name": "Step 1",
      "action": "quadbrain:analyze",
      "parameters": { "query": "test" }
    },
    {
      "type": "wait",
      "name": "Delay",
      "duration": 1000
    }
  ],
  "errorStrategy": "stop",
  "input": {},
  "context": {}
}
```

### Parallel Orchestration

```bash
# Execute workflows in parallel
POST /api/parallel/execute
{
  "workflows": [
    { "id": "workflow1", "input": {...} },
    { "id": "workflow2", "input": {...} }
  ],
  "options": {
    "strategy": "all",  // all, race, any, batch
    "timeout": 300000
  }
}

# Fan-out pattern (process multiple inputs)
POST /api/parallel/fanout
{
  "workflowId": "process_item",
  "inputs": [
    { "item": 1 },
    { "item": 2 },
    { "item": 3 }
  ]
}

# Map-reduce pattern
POST /api/parallel/mapreduce
{
  "workflowId": "analyze_data",
  "inputs": [...data...],
  "reduceFn": "outputs => outputs.reduce((sum, o) => sum + o.value, 0)"
}

# Pipeline pattern (sequential stages)
POST /api/parallel/pipeline
{
  "workflowIds": ["extract", "transform", "load"],
  "input": { "source": "data.csv" }
}
```

## Sequential Chain Templates

Built-in templates available via `/api/chains/template`:

1. **data-pipeline** - Extract → Transform → Load pattern
2. **api-request** - HTTP request with retry and validation
3. **ml-inference** - Load model → Preprocess → Inference → Postprocess
4. **approval-workflow** - Submit → Wait → Approve/Reject
5. **file-processing** - Read → Process → Write → Cleanup

## Visual Workflow Designer

Access the visual designer in Pulse:

1. Open Command Bridge (`C:\Users\YOUR_USER\Desktop\SOMA\frontend\dist\index.html`)
2. Click "Workflows" tab in sidebar
3. Drag and drop nodes to create workflows
4. Configure properties in the right panel
5. Save and execute workflows

### Node Types

- **Action** ⚡ - Execute an operation
- **Decision** 🔀 - Branch based on conditions
- **Parallel** ⚡⚡ - Execute multiple tasks concurrently
- **Wait** ⏳ - Delay execution
- **Terminal** 🏁 - End state (success/failure)

## Action Routing

Actions are routed to different handlers based on prefix:

- `quadbrain:*` - Routes to QuadBrain cognitive engine
- `fragment:*` - Routes to Fragment Registry
- `data:*` - Custom data operations
- `http:*` - HTTP/API operations
- `ml:*` - Machine learning operations

## Best Practices

1. **Error Handling** - Always define error paths and terminal states
2. **Timeouts** - Set appropriate timeouts for each action
3. **Retries** - Use retry logic for network operations
4. **Validation** - Validate data at pipeline boundaries
5. **Logging** - Include logging actions for debugging
6. **Testing** - Test workflows with mock data first

## Testing Workflows

```bash
# Quick test with curl
curl -X POST http://localhost:3001/api/workflows/execute \
  -H "Content-Type: application/json" \
  -d '{
    "workflowId": "example_greeting",
    "input": {}
  }'

# Check execution status
curl http://localhost:3001/api/workflows/execution/:executionId

# View execution history
curl http://localhost:3001/api/workflows/example_greeting/executions
```

## Troubleshooting

**Workflow not found:**
- Ensure workflow is registered via `/api/workflows/register`

**Action timeout:**
- Increase timeout value in state definition
- Check if backend services are running

**Execution stuck:**
- Check FSM Executor logs in server console
- Verify all state transitions are defined

**Parallel workflows not completing:**
- Check individual workflow status
- Ensure all branches have valid targets
- Verify join states are reachable

## Additional Resources

- **Documentation:** See AUTOGEN_INTEGRATION_PLAN.md for architecture details
- **Server Logs:** Check server console for execution traces
- **API Documentation:** Full REST API reference in soma-server.js
- **Frontend Guide:** Visual designer usage in VisualWorkflowDesigner.jsx

## Support

For issues or questions:
- Check server logs: `npm run server`
- Review FSM Executor events in console
- Test with simple workflows first
- Verify backend is running on port 3001
