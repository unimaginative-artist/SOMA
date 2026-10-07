/**
 * Visual Workflow Designer - ReactFlow-based FSM workflow editor
 * Drag-and-drop interface for creating state machine workflows
 *
 * Features:
 * - Custom nodes for all state types (action, decision, parallel, wait, terminal)
 * - Visual connections (transitions) between states
 * - Condition editor for branching logic
 * - Live workflow validation
 * - Save/load/execute workflows
 * - Execution history viewer
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  addEdge,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
} from 'reactflow';
import 'reactflow/dist/style.css';

// Custom Node Types
const ActionNode = ({ data, selected }) => {
  return (
    <div className={`workflow-node action-node ${selected ? 'selected' : ''}`}>
      <div className="node-header" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <span className="node-icon">⚡</span>
        <span className="node-type">Action</span>
      </div>
      <div className="node-body">
        <div className="node-title">{data.label || 'Untitled Action'}</div>
        {data.action && <div className="node-detail">{data.action}</div>}
      </div>
      <div className="node-handles">
        <div className="handle-in">→</div>
        <div className="handle-out">→</div>
      </div>
    </div>
  );
};

const DecisionNode = ({ data, selected }) => {
  return (
    <div className={`workflow-node decision-node ${selected ? 'selected' : ''}`}>
      <div className="node-header" style={{ background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
        <span className="node-icon">🔀</span>
        <span className="node-type">Decision</span>
      </div>
      <div className="node-body">
        <div className="node-title">{data.label || 'Untitled Decision'}</div>
        {data.branches && (
          <div className="node-detail">{data.branches.length} branches</div>
        )}
      </div>
      <div className="node-handles">
        <div className="handle-in">→</div>
        <div className="handle-out-multi">
          {(data.branches || []).map((_, i) => (
            <div key={i} className="handle-out-branch">→</div>
          ))}
        </div>
      </div>
    </div>
  );
};

const ParallelNode = ({ data, selected }) => {
  return (
    <div className={`workflow-node parallel-node ${selected ? 'selected' : ''}`}>
      <div className="node-header" style={{ background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)' }}>
        <span className="node-icon">⚡⚡</span>
        <span className="node-type">Parallel</span>
      </div>
      <div className="node-body">
        <div className="node-title">{data.label || 'Untitled Parallel'}</div>
        {data.branches && (
          <div className="node-detail">{data.branches.length} parallel tasks</div>
        )}
      </div>
    </div>
  );
};

const WaitNode = ({ data, selected }) => {
  return (
    <div className={`workflow-node wait-node ${selected ? 'selected' : ''}`}>
      <div className="node-header" style={{ background: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' }}>
        <span className="node-icon">⏳</span>
        <span className="node-type">Wait</span>
      </div>
      <div className="node-body">
        <div className="node-title">{data.label || 'Untitled Wait'}</div>
        {data.duration && <div className="node-detail">{data.duration}ms</div>}
      </div>
    </div>
  );
};

const TerminalNode = ({ data, selected }) => {
  return (
    <div className={`workflow-node terminal-node ${selected ? 'selected' : ''}`}>
      <div className="node-header" style={{ background: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)' }}>
        <span className="node-icon">🏁</span>
        <span className="node-type">Terminal</span>
      </div>
      <div className="node-body">
        <div className="node-title">{data.label || 'End'}</div>
        {data.status && <div className="node-detail">Status: {data.status}</div>}
      </div>
      <div className="node-handles">
        <div className="handle-in">→</div>
      </div>
    </div>
  );
};

const nodeTypes = {
  action: ActionNode,
  decision: DecisionNode,
  parallel: ParallelNode,
  wait: WaitNode,
  terminal: TerminalNode,
};

export const VisualWorkflowDesigner = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [selectedNode, setSelectedNode] = useState(null);
  const [workflows, setWorkflows] = useState([]);
  const [currentWorkflow, setCurrentWorkflow] = useState(null);
  const [showNodePalette, setShowNodePalette] = useState(true);
  const [showProperties, setShowProperties] = useState(true);
  const [executions, setExecutions] = useState([]);
  const [isExecuting, setIsExecuting] = useState(false);

  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);

  // Fetch workflows on mount
  useEffect(() => {
    fetchWorkflows();
  }, []);

  const fetchWorkflows = async () => {
    try {
      const response = await fetch('/api/workflows/list');
      const data = await response.json();
      if (data.success) {
        setWorkflows(data.workflows);
      }
    } catch (error) {
      console.error('Failed to fetch workflows:', error);
    }
  };

  const onConnect = useCallback(
    (params) => {
      const edge = {
        ...params,
        type: 'smoothstep',
        animated: true,
        markerEnd: {
          type: MarkerType.ArrowClosed,
        },
      };
      setEdges((eds) => addEdge(edge, eds));
    },
    [setEdges]
  );

  const onNodeClick = useCallback((event, node) => {
    setSelectedNode(node);
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  // Add new node from palette
  const addNode = useCallback(
    (type) => {
      const newNode = {
        id: `${type}_${Date.now()}`,
        type,
        position: { x: 250, y: 100 + nodes.length * 150 },
        data: {
          label: `New ${type.charAt(0).toUpperCase() + type.slice(1)}`,
        },
      };

      if (type === 'action') {
        newNode.data.action = '';
        newNode.data.parameters = {};
      } else if (type === 'decision') {
        newNode.data.branches = [
          { condition: '', target: '' },
          { condition: '', target: '' },
        ];
      } else if (type === 'parallel') {
        newNode.data.branches = [
          { target: '' },
          { target: '' },
        ];
      } else if (type === 'wait') {
        newNode.data.duration = 1000;
        newNode.data.target = '';
      } else if (type === 'terminal') {
        newNode.data.status = 'completed';
      }

      setNodes((nds) => [...nds, newNode]);
    },
    [nodes, setNodes]
  );

  // Update node properties
  const updateNodeData = useCallback(
    (nodeId, newData) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            return {
              ...node,
              data: {
                ...node.data,
                ...newData,
              },
            };
          }
          return node;
        })
      );
    },
    [setNodes]
  );

  // Save workflow
  const saveWorkflow = async () => {
    if (!currentWorkflow?.name) {
      const name = prompt('Enter workflow name:');
      if (!name) return;

      const workflow = {
        id: `workflow_${Date.now()}`,
        name,
        description: '',
        tags: ['visual'],
        states: convertNodesToStates(),
        initialState: nodes[0]?.id || null,
      };

      try {
        const response = await fetch('/api/workflows/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow }),
        });

        const data = await response.json();
        if (data.success) {
          setCurrentWorkflow(workflow);
          fetchWorkflows();
          alert('Workflow saved successfully!');
        }
      } catch (error) {
        console.error('Failed to save workflow:', error);
        alert('Failed to save workflow');
      }
    } else {
      // Update existing workflow
      const workflow = {
        ...currentWorkflow,
        states: convertNodesToStates(),
      };

      try {
        const response = await fetch('/api/workflows/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow }),
        });

        const data = await response.json();
        if (data.success) {
          fetchWorkflows();
          alert('Workflow updated successfully!');
        }
      } catch (error) {
        console.error('Failed to update workflow:', error);
      }
    }
  };

  // Convert ReactFlow nodes/edges to FSM states
  const convertNodesToStates = () => {
    const states = {};

    nodes.forEach((node) => {
      const state = {
        type: node.type,
        ...node.data,
      };

      // Find transitions from this node
      const nodeEdges = edges.filter((edge) => edge.source === node.id);

      if (node.type === 'action') {
        state.onSuccess = nodeEdges[0]?.target || null;
        state.onError = nodeEdges[1]?.target || null;
      } else if (node.type === 'decision') {
        state.branches = (state.branches || []).map((branch, i) => ({
          ...branch,
          target: nodeEdges[i]?.target || '',
        }));
      } else if (node.type === 'parallel') {
        state.branches = (state.branches || []).map((branch, i) => ({
          target: nodeEdges[i]?.target || '',
        }));
        state.joinState = nodeEdges[state.branches.length]?.target || null;
      } else if (node.type === 'wait') {
        state.target = nodeEdges[0]?.target || null;
      }

      states[node.id] = state;
    });

    return states;
  };

  // Load workflow
  const loadWorkflow = async (workflowId) => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}`);
      const data = await response.json();

      if (data.success) {
        setCurrentWorkflow(data.workflow);
        convertStatesToNodes(data.workflow);
      }
    } catch (error) {
      console.error('Failed to load workflow:', error);
    }
  };

  // Convert FSM states to ReactFlow nodes/edges
  const convertStatesToNodes = (workflow) => {
    const newNodes = [];
    const newEdges = [];
    let yPos = 100;

    Object.entries(workflow.states).forEach(([stateId, state], index) => {
      const node = {
        id: stateId,
        type: state.type,
        position: { x: 250, y: yPos },
        data: { ...state },
      };

      newNodes.push(node);
      yPos += 150;

      // Create edges based on state type
      if (state.type === 'action') {
        if (state.onSuccess) {
          newEdges.push({
            id: `${stateId}-success`,
            source: stateId,
            target: state.onSuccess,
            type: 'smoothstep',
            animated: true,
            label: 'success',
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        if (state.onError) {
          newEdges.push({
            id: `${stateId}-error`,
            source: stateId,
            target: state.onError,
            type: 'smoothstep',
            animated: true,
            label: 'error',
            style: { stroke: '#ff0000' },
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
      } else if (state.type === 'decision') {
        state.branches?.forEach((branch, i) => {
          if (branch.target) {
            newEdges.push({
              id: `${stateId}-branch-${i}`,
              source: stateId,
              target: branch.target,
              type: 'smoothstep',
              animated: true,
              label: branch.condition || `branch ${i}`,
              markerEnd: { type: MarkerType.ArrowClosed },
            });
          }
        });
      } else if (state.type === 'parallel') {
        state.branches?.forEach((branch, i) => {
          if (branch.target) {
            newEdges.push({
              id: `${stateId}-parallel-${i}`,
              source: stateId,
              target: branch.target,
              type: 'smoothstep',
              animated: true,
              label: `task ${i + 1}`,
              markerEnd: { type: MarkerType.ArrowClosed },
            });
          }
        });
        if (state.joinState) {
          newEdges.push({
            id: `${stateId}-join`,
            source: stateId,
            target: state.joinState,
            type: 'smoothstep',
            label: 'join',
            style: { stroke: '#00ff00' },
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
      } else if (state.type === 'wait') {
        if (state.target) {
          newEdges.push({
            id: `${stateId}-wait`,
            source: stateId,
            target: state.target,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
      }
    });

    setNodes(newNodes);
    setEdges(newEdges);
  };

  // Execute workflow
  const executeWorkflow = async () => {
    if (!currentWorkflow) {
      alert('Please save the workflow first');
      return;
    }

    const input = prompt('Enter input data (JSON):');
    let inputData = {};

    if (input) {
      try {
        inputData = JSON.parse(input);
      } catch (e) {
        alert('Invalid JSON input');
        return;
      }
    }

    setIsExecuting(true);

    try {
      const response = await fetch('/api/workflows/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: currentWorkflow.id,
          input: inputData,
        }),
      });

      const data = await response.json();

      if (data.success) {
        alert(`Workflow executed successfully!\nFinal state: ${data.finalState}\nDuration: ${data.duration}ms`);
        fetchExecutions();
      } else {
        alert(`Workflow execution failed: ${data.error}`);
      }
    } catch (error) {
      console.error('Failed to execute workflow:', error);
      alert('Failed to execute workflow');
    } finally {
      setIsExecuting(false);
    }
  };

  // Fetch execution history
  const fetchExecutions = async () => {
    if (!currentWorkflow) return;

    try {
      const response = await fetch(
        `/api/workflows/${currentWorkflow.id}/executions`
      );
      const data = await response.json();

      if (data.success) {
        setExecutions(data.executions);
      }
    } catch (error) {
      console.error('Failed to fetch executions:', error);
    }
  };

  // Clear canvas
  const clearCanvas = () => {
    if (confirm('Clear the canvas? Unsaved changes will be lost.')) {
      setNodes([]);
      setEdges([]);
      setCurrentWorkflow(null);
      setSelectedNode(null);
    }
  };

  return (
    <div className="visual-workflow-designer">
      {/* Toolbar */}
      <div className="workflow-toolbar">
        <h2>🎨 Visual Workflow Designer</h2>
        <div className="toolbar-actions">
          <button onClick={() => addNode('action')} className="btn-icon">
            ⚡ Action
          </button>
          <button onClick={() => addNode('decision')} className="btn-icon">
            🔀 Decision
          </button>
          <button onClick={() => addNode('parallel')} className="btn-icon">
            ⚡⚡ Parallel
          </button>
          <button onClick={() => addNode('wait')} className="btn-icon">
            ⏳ Wait
          </button>
          <button onClick={() => addNode('terminal')} className="btn-icon">
            🏁 End
          </button>
          <div className="toolbar-separator" />
          <button onClick={saveWorkflow} className="btn-primary">
            💾 Save
          </button>
          <button onClick={executeWorkflow} className="btn-success" disabled={isExecuting}>
            {isExecuting ? '⏳ Executing...' : '▶️ Execute'}
          </button>
          <button onClick={clearCanvas} className="btn-danger">
            🗑️ Clear
          </button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="workflow-layout">
        {/* Node Palette */}
        {showNodePalette && (
          <div className="workflow-palette">
            <h3>📦 Node Palette</h3>
            <div className="palette-section">
              <h4>Workflows</h4>
              <div className="workflow-list">
                {workflows.map((wf) => (
                  <div
                    key={wf.id}
                    className="workflow-item"
                    onClick={() => loadWorkflow(wf.id)}
                  >
                    <span>{wf.name}</span>
                    <small>{Object.keys(wf.states || {}).length} states</small>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="workflow-canvas" ref={reactFlowWrapper}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onInit={setReactFlowInstance}
            nodeTypes={nodeTypes}
            fitView
            className="workflow-flow"
          >
            <Background color="#333" gap={16} />
            <Controls />
            <MiniMap
              nodeColor={(node) => {
                const colors = {
                  action: '#667eea',
                  decision: '#f093fb',
                  parallel: '#4facfe',
                  wait: '#fa709a',
                  terminal: '#30cfd0',
                };
                return colors[node.type] || '#999';
              }}
            />
            <Panel position="top-right">
              <div className="workflow-info">
                {currentWorkflow && (
                  <div>
                    <strong>{currentWorkflow.name}</strong>
                    <br />
                    <small>{nodes.length} states</small>
                  </div>
                )}
              </div>
            </Panel>
          </ReactFlow>
        </div>

        {/* Properties Panel */}
        {showProperties && (
          <div className="workflow-properties">
            <h3>⚙️ Properties</h3>
            {selectedNode ? (
              <div className="properties-form">
                <div className="form-group">
                  <label>Node ID</label>
                  <input
                    type="text"
                    value={selectedNode.id}
                    disabled
                    className="form-control"
                  />
                </div>

                <div className="form-group">
                  <label>Label</label>
                  <input
                    type="text"
                    value={selectedNode.data.label || ''}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, { label: e.target.value })
                    }
                    className="form-control"
                  />
                </div>

                {selectedNode.type === 'action' && (
                  <>
                    <div className="form-group">
                      <label>Action</label>
                      <input
                        type="text"
                        value={selectedNode.data.action || ''}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, { action: e.target.value })
                        }
                        className="form-control"
                        placeholder="e.g., quadbrain:reason"
                      />
                    </div>
                    <div className="form-group">
                      <label>Parameters (JSON)</label>
                      <textarea
                        value={JSON.stringify(selectedNode.data.parameters || {}, null, 2)}
                        onChange={(e) => {
                          try {
                            const params = JSON.parse(e.target.value);
                            updateNodeData(selectedNode.id, { parameters: params });
                          } catch (err) {
                            // Invalid JSON
                          }
                        }}
                        className="form-control"
                        rows={4}
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === 'decision' && (
                  <div className="form-group">
                    <label>Branches</label>
                    {(selectedNode.data.branches || []).map((branch, i) => (
                      <div key={i} className="branch-editor">
                        <input
                          type="text"
                          value={branch.condition || ''}
                          onChange={(e) => {
                            const newBranches = [...(selectedNode.data.branches || [])];
                            newBranches[i] = { ...branch, condition: e.target.value };
                            updateNodeData(selectedNode.id, { branches: newBranches });
                          }}
                          placeholder="Condition (e.g., result.score > 0.8)"
                          className="form-control"
                        />
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        const newBranches = [
                          ...(selectedNode.data.branches || []),
                          { condition: '', target: '' },
                        ];
                        updateNodeData(selectedNode.id, { branches: newBranches });
                      }}
                      className="btn-secondary btn-sm"
                    >
                      + Add Branch
                    </button>
                  </div>
                )}

                {selectedNode.type === 'wait' && (
                  <div className="form-group">
                    <label>Duration (ms)</label>
                    <input
                      type="number"
                      value={selectedNode.data.duration || 1000}
                      onChange={(e) =>
                        updateNodeData(selectedNode.id, {
                          duration: parseInt(e.target.value),
                        })
                      }
                      className="form-control"
                    />
                  </div>
                )}

                {selectedNode.type === 'terminal' && (
                  <div className="form-group">
                    <label>Status</label>
                    <select
                      value={selectedNode.data.status || 'completed'}
                      onChange={(e) =>
                        updateNodeData(selectedNode.id, { status: e.target.value })
                      }
                      className="form-control"
                    >
                      <option value="completed">Completed</option>
                      <option value="failed">Failed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                )}
              </div>
            ) : (
              <div className="no-selection">
                <p>Select a node to edit properties</p>
              </div>
            )}

            {/* Execution History */}
            {executions.length > 0 && (
              <div className="execution-history">
                <h4>📊 Recent Executions</h4>
                {executions.slice(0, 5).map((exec) => (
                  <div key={exec.id} className="execution-item">
                    <div
                      className={`execution-status status-${exec.status}`}
                    >
                      {exec.status}
                    </div>
                    <div className="execution-time">
                      {new Date(exec.startTime).toLocaleTimeString()}
                    </div>
                    <div className="execution-duration">{exec.duration}ms</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <style jsx>{`
        .visual-workflow-designer {
          width: 100%;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: #0a0a0a;
          color: #fff;
        }

        .workflow-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1rem;
          background: rgba(255, 255, 255, 0.05);
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .workflow-toolbar h2 {
          margin: 0;
          font-size: 1.5rem;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .toolbar-actions {
          display: flex;
          gap: 0.5rem;
        }

        .toolbar-separator {
          width: 1px;
          background: rgba(255, 255, 255, 0.2);
          margin: 0 0.5rem;
        }

        .btn-icon,
        .btn-primary,
        .btn-success,
        .btn-danger,
        .btn-secondary {
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 0.9rem;
          transition: all 0.2s;
        }

        .btn-icon {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .btn-icon:hover {
          background: rgba(255, 255, 255, 0.2);
        }

        .btn-primary {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: #fff;
        }

        .btn-success {
          background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
          color: #fff;
        }

        .btn-danger {
          background: linear-gradient(135deg, #ee0979 0%, #ff6a00 100%);
          color: #fff;
        }

        .btn-secondary {
          background: rgba(255, 255, 255, 0.1);
          color: #fff;
        }

        .btn-sm {
          padding: 0.25rem 0.5rem;
          font-size: 0.8rem;
        }

        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .workflow-layout {
          display: flex;
          flex: 1;
          overflow: hidden;
        }

        .workflow-palette {
          width: 250px;
          background: rgba(255, 255, 255, 0.05);
          border-right: 1px solid rgba(255, 255, 255, 0.1);
          padding: 1rem;
          overflow-y: auto;
        }

        .workflow-palette h3,
        .workflow-palette h4 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
        }

        .palette-section {
          margin-bottom: 2rem;
        }

        .workflow-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .workflow-item {
          padding: 0.75rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .workflow-item:hover {
          background: rgba(255, 255, 255, 0.1);
          transform: translateX(4px);
        }

        .workflow-item span {
          display: block;
          font-weight: 500;
        }

        .workflow-item small {
          color: rgba(255, 255, 255, 0.6);
          font-size: 0.8rem;
        }

        .workflow-canvas {
          flex: 1;
          height: 100%;
        }

        .workflow-flow {
          background: #0a0a0a;
        }

        .workflow-properties {
          width: 300px;
          background: rgba(255, 255, 255, 0.05);
          border-left: 1px solid rgba(255, 255, 255, 0.1);
          padding: 1rem;
          overflow-y: auto;
        }

        .workflow-properties h3 {
          margin: 0 0 1rem 0;
          font-size: 1rem;
        }

        .properties-form {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .form-group label {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.7);
          font-weight: 500;
        }

        .form-control {
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 6px;
          color: #fff;
          font-family: 'Courier New', monospace;
          font-size: 0.9rem;
        }

        .form-control:focus {
          outline: none;
          border-color: #667eea;
        }

        textarea.form-control {
          resize: vertical;
        }

        .branch-editor {
          margin-bottom: 0.5rem;
        }

        .no-selection {
          padding: 2rem;
          text-align: center;
          color: rgba(255, 255, 255, 0.5);
        }

        .execution-history {
          margin-top: 2rem;
          padding-top: 1rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .execution-history h4 {
          margin: 0 0 1rem 0;
          font-size: 0.9rem;
        }

        .execution-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.5rem;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 6px;
          margin-bottom: 0.5rem;
          font-size: 0.8rem;
        }

        .execution-status {
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-weight: 500;
        }

        .status-completed {
          background: rgba(56, 239, 125, 0.2);
          color: #38ef7d;
        }

        .status-failed {
          background: rgba(238, 9, 121, 0.2);
          color: #ee0979;
        }

        .execution-time {
          color: rgba(255, 255, 255, 0.6);
        }

        .execution-duration {
          color: rgba(255, 255, 255, 0.6);
        }

        .workflow-info {
          background: rgba(0, 0, 0, 0.8);
          padding: 1rem;
          border-radius: 8px;
          backdrop-filter: blur(10px);
        }

        /* Custom Node Styles */
        .workflow-node {
          background: rgba(255, 255, 255, 0.05);
          border: 2px solid rgba(255, 255, 255, 0.2);
          border-radius: 12px;
          min-width: 200px;
          backdrop-filter: blur(10px);
          transition: all 0.2s;
        }

        .workflow-node.selected {
          border-color: #667eea;
          box-shadow: 0 0 20px rgba(102, 126, 234, 0.5);
        }

        .node-header {
          padding: 0.75rem;
          border-radius: 10px 10px 0 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #fff;
          font-weight: 600;
        }

        .node-icon {
          font-size: 1.2rem;
        }

        .node-type {
          font-size: 0.85rem;
        }

        .node-body {
          padding: 1rem;
        }

        .node-title {
          font-weight: 600;
          margin-bottom: 0.5rem;
          color: #fff;
        }

        .node-detail {
          font-size: 0.85rem;
          color: rgba(255, 255, 255, 0.6);
          font-family: 'Courier New', monospace;
        }

        .node-handles {
          display: flex;
          justify-content: space-between;
          padding: 0.5rem;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .handle-in,
        .handle-out,
        .handle-out-branch {
          font-size: 0.8rem;
          color: rgba(255, 255, 255, 0.5);
        }

        .handle-out-multi {
          display: flex;
          gap: 0.5rem;
        }
      `}</style>
    </div>
  );
};

export default VisualWorkflowDesigner;
