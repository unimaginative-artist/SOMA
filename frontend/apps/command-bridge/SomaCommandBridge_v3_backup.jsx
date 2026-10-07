import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Activity, Brain, Zap, HardDrive, Wifi, CheckCircle,
  Archive, Workflow, Database, Play, Pause, RotateCw, Trash2,
  Plus, Network, Home, MessageSquare, Settings, Palette,
  Shield, User, Lightbulb, ThermometerSun, ChevronLeft,
  ChevronRight, Sparkles, Terminal, Circle, BarChart3, Search, X, Clock,
  Download, TrendingUp, TrendingDown, Target, Server, Gauge, Mail,
  Box, Share2, DollarSign
} from 'lucide-react';
import {
  LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import somaBackend from '../../somaBackend';
import SomaCT from '../command-ct/SomaCT';
import Orb from './Orb';
import KevinInterface from './KevinInterface';
// import KnowledgeGraph3D from '../../command-bridge/KnowledgeGraph3D';

// Hooks & Components
import { useSomaAudio } from './hooks/useSomaAudio';
import { useRealtimeEvents } from './hooks/useRealtimeEvents';
import FloatingChat from './components/FloatingChat';
import MemoryTierMonitor from './components/MemoryTierMonitor';
import LearningVelocityDashboard from './components/LearningVelocityDashboard';
import AutonomousActivityFeed from './components/AutonomousActivityFeed';
import SkillProficiencyRadar from './components/SkillProficiencyRadar';
import BeliefNetworkViewer from './components/BeliefNetworkViewer';
import DreamInsights from './components/DreamInsights';
import TheoryOfMindPanel from './components/TheoryOfMindPanel';
// import EnhancedKnowledgeSystem from './components/EnhancedKnowledgeSystem';

// STEVE & Workflow Integration
import { useAgentStore } from './lib/store';
import { WorkflowCanvas } from './components/workflow-editor/workflow-canvas';
import { NodeConfigPanel } from './components/workflow-editor/node-config-panel';
import { ExecutionPanel } from './components/execution/execution-panel';
import SteveInterface from './components/SteveInterface';
import WorkflowSteve from './components/WorkflowSteve';
import Marketplace from './Marketplace';
import FileBrowser from './components/FileBrowser';
import PulseInterface from './components/PulseInterface';
// import FinanceModule from './components/FinanceModule';
import ForecasterApp from './components/Forecaster/ForecasterApp';
import MissionControlApp from './components/MissionControl/MissionControlApp';
import { generateId } from './lib/utils/id-generator';
import { FloatingPanel } from './components/ui/floating-panel';
import { SteveContextManager } from './lib/SteveContextManager';

import '../command-ct/styles/terminal.css';
import './styles/soma-ui-control.css';

// ==========================================
// Process Monitor Modal (Task Manager)
// ==========================================
const ProcessMonitor = ({ agents, onClose }) => (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
    <div className="bg-[#151518] border border-white/10 rounded-2xl w-full max-w-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
      <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
        <h3 className="text-xl font-bold text-white flex items-center">
          <Activity className="w-5 h-5 mr-2 text-blue-400" /> System Processes
        </h3>
        <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500 font-medium border-b border-white/5 uppercase tracking-wider">
            <tr>
              <th className="pb-3 pl-2">Process Name</th>
              <th className="pb-3">Type</th>
              <th className="pb-3">Status</th>
              <th className="pb-3 text-right pr-2">Load</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {Array.isArray(agents) && agents.length > 0 ? agents.map(agent => (
              <tr key={agent.id} className="hover:bg-white/5 transition-colors">
                <td className="py-3 pl-2 text-zinc-200 font-medium">{agent.name}</td>
                <td className="py-3 text-zinc-400 font-mono text-xs">{agent.type || 'System'}</td>
                <td className="py-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${agent.status === 'active'
                    ? 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20'
                    : 'bg-zinc-800 text-zinc-500 border-white/5'
                    }`}>
                    {agent.status}
                  </span>
                </td>
                <td className="py-3 text-right pr-2 font-mono text-zinc-300">{agent.load}%</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="py-12 text-center text-zinc-600 italic">
                  No active arbiters detected. Swarm is initializing...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  </div>
);

// ==========================================
// Main Command Bridge Component
// ==========================================
const SomaCommandBridge = () => {
  console.log('[SOMA] Rendering Command Bridge...');
  // Navigation State
  const [activeModule, setActiveModule] = useState('core');

  // STEVE & Workflow State
  const {
    workflows,
    addWorkflow,
    updateWorkflow,
    activeWorkflowId,
    setActiveWorkflow,
    executionLogs,
    addExecutionLog
  } = useAgentStore();

  const activeWorkflow = workflows.find(w => w.id === activeWorkflowId);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [showSteve, setShowSteve] = useState(false);
  const [showExecution, setShowExecution] = useState(true);
  const [showPulse, setShowPulse] = useState(false); // Pulse State

  const handleCreateWorkflow = () => {
    const newWorkflow = {
      id: generateId("workflow"),
      name: "New Workflow",
      description: "A new workflow",
      nodes: [],
      connections: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      status: "idle",
    };
    addWorkflow(newWorkflow);
    setActiveWorkflow(newWorkflow.id);
  };

  const [isConnected, setIsConnected] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // UI State
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [isSomaBusy, setIsSomaBusy] = useState(false);
  const backendInitialized = useRef(false);

  // REAL DATA STATE
  const [systemMetrics, setSystemMetrics] = useState({
    cpu: 0,
    gpu: 0,
    ram: 0,
    network: 0,
    uptime: 0,
    neuralLoad: { load1: 0, load5: 0, load15: 0 },
    contextWindow: { maxTokens: 1048576, used: 0, percentage: 0 }
  });

  // Categorized Agent Swarm
  const [agents, setAgents] = useState([]);
  const [arbiters, setArbiters] = useState([]);
  const [fragments, setFragments] = useState([]);
  const [microAgents, setMicroAgents] = useState([]);

  const [cacheTiers, setCacheTiers] = useState(null);
  const [clusterNodes, setClusterNodes] = useState([]);

  const [knowledgeNodes, setKnowledgeNodes] = useState([]);
  const [graphData, setGraphData] = useState({ nodes: [], edges: [] });

  const [learningMetrics, setLearningMetrics] = useState([]);
  const [performanceMetrics, setPerformanceMetrics] = useState([
    { metric: 'Autonomy', value: 30 },
    { metric: 'Velocity', value: 0 },
    { metric: 'Coherence', value: 0 },
    { metric: 'Reliability', value: 95 },
    { metric: 'Efficiency', value: 0 }
  ]);

  // Analytics state
  const [analyticsTimeRange, setAnalyticsTimeRange] = useState('1h');
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [memoryUsageData, setMemoryUsageData] = useState([]);
  const [arbiterActivityData, setArbiterActivityData] = useState([]);
  const [previousSummary, setPreviousSummary] = useState(null);

  const [activityStream, setActivityStream] = useState([
    { id: 1, type: 'info', message: 'Neural Link established. Monitoring SOMA Core...', timestamp: Date.now() }
  ]);
  const [diagnosticLogs, setDiagnosticLogs] = useState([]);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const [personality, setPersonality] = useState({
    analytical: 70,
    empathetic: 60,
    creative: 50,
    assertive: 65
  });

  // Missing state declarations - fix for .map() errors
  const [storageBackends, setStorageBackends] = useState([]);
  const [workflowSteps, setWorkflowSteps] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [emergencyStop, setEmergencyStop] = useState(false);

  // ------------------------------------------
  // RESTORED STATES (Cognitive & SLC)
  // ------------------------------------------
  // SLC Tri-Brain stats
  const [slcStats, setSlcStats] = useState({
    brainA: { name: 'Prometheus', status: 'offline', confidence: 0 },
    brainB: { name: 'Aurora', status: 'offline', confidence: 0 },
    brainC: { name: 'Logos', status: 'offline', confidence: 0 },
    lastQuery: null,
    totalQueries: 0
  });

  // Cognitive Trace state
  const [cognitiveQuery, setCognitiveQuery] = useState('');
  const [currentThought, setCurrentThought] = useState(null);
  const [thoughtHistory, setThoughtHistory] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState('mnemonic-1');
  const [cognitiveWsConnected, setCognitiveWsConnected] = useState(false);
  const [liveEvents, setLiveEvents] = useState([]);
  const cognitiveWsRef = useRef(null);
  const traceEndRef = useRef(null);

  // ------------------------------------------
  // Hooks Integration
  // ------------------------------------------

  // 1. Audio Interaction
  const {
    isConnected: isOrbConnected,
    connect: connectOrb,
    disconnect: disconnectOrb,
    volume,
    isTalking,
    isListening,
    isThinking,
    systemStatus: orbSystemStatus,
    sendTextQuery
  } = useSomaAudio();

  // Expose text query globally for manual input
  useEffect(() => {
    if (sendTextQuery) {
      window.somaTextQuery = sendTextQuery;
    }
    return () => {
      delete window.somaTextQuery;
    };
  }, [sendTextQuery]);

  // 2. Real-time Event Toasts (THE POPUPS!)
  useRealtimeEvents(somaBackend, isConnected);

  // 3. Busy State Tracker
  useEffect(() => {
    setIsSomaBusy(isThinking);
  }, [isThinking]);

  // ------------------------------------------
  // Backend Event Handlers (AUTHENTIC DATA)
  // ------------------------------------------
  useEffect(() => {
    if (backendInitialized.current) return;
    backendInitialized.current = true;

    // Connection Handlers
    somaBackend.on('connect', () => {
      setIsConnected(true);
      toast.success('SOMA Neural Link Established', { theme: 'dark' });
    });

    somaBackend.on('disconnect', () => {
      setIsConnected(false);
      toast.warning('Neural Link Severed - Reconnecting...', { theme: 'dark' });
    });

    somaBackend.on('diagnostic_log', (msg) => {
      const log = msg.payload || msg;
      setDiagnosticLogs(prev => [...prev, log.message]);
      setShowDiagnostics(true);
    });

    somaBackend.on('log', (msg) => {
      const log = msg.payload || msg;
      setActivityStream(prev => [{
        id: Date.now(),
        type: log.type || 'info',
        message: log.message,
        timestamp: log.timestamp || Date.now()
      }, ...prev].slice(0, 100));
    });

    // Metrics Broadcaster
    somaBackend.on('metrics', (message) => {
      const data = message.payload || message;

      // Map System Health
      setSystemMetrics(prev => ({
        ...prev,
        cpu: data.cpu !== undefined ? data.cpu : prev.cpu,
        ram: data.ram !== undefined ? Math.min(100, (data.ram / 16384) * 100) : prev.ram,
        gpu: data.gpu !== undefined ? data.gpu : prev.gpu,
        network: data.network !== undefined ? data.network : prev.network,
        uptime: data.uptime !== undefined ? data.uptime : prev.uptime,
        neuralLoad: data.neuralLoad || prev.neuralLoad,
        contextWindow: data.contextWindow || prev.contextWindow
      }));

      // Map Swarm Data with Categorization
      if (data.agents) {
        const rawAgents = data.agents;
        setAgents(rawAgents);

        // Categorize agents more strictly
        const actualArbiters = rawAgents.filter(a =>
          (a.type?.toLowerCase().includes('arbiter') ||
            a.type?.toLowerCase().includes('manager') ||
            a.type?.toLowerCase().includes('worker') ||
            a.name?.includes('Arbiter')) &&
          !a.type?.includes('micro-brain') &&
          !a.name?.toLowerCase().includes('fragment')
        );

        const actualFragments = rawAgents.filter(a =>
          a.type?.includes('micro-brain') ||
          a.name?.toLowerCase().includes('fragment')
        );

        setArbiters(actualArbiters);
        setFragments(actualFragments);
        setMicroAgents(rawAgents.filter(a => !actualArbiters.includes(a) && !actualFragments.includes(a)));
      }

      // Map Memory System (HMS)
      if (data.cache) setCacheTiers(data.cache);

      // Map Cluster Nodes
      if (data.nodes) setClusterNodes(data.nodes);
    });

    // UI Control - SOMA can navigate and highlight
    somaBackend.on('ui.navigate', (msg) => {
      const { module } = msg.payload || msg;
      if (module) {
        setActiveModule(module);
        toast.info(`SOMA navigated to ${module}`, { theme: 'dark', autoClose: 2000 });
      }
    });

    somaBackend.on('ui.highlight', (msg) => {
      const { component } = msg.payload || msg;
      if (component) {
        // Add highlight class to component
        const element = document.querySelector(`[data-component="${component}"]`);
        if (element) {
          element.classList.add('soma-highlight');
          setTimeout(() => element.classList.remove('soma-highlight'), 3000);
        }
        toast.info(`SOMA is highlighting: ${component}`, { theme: 'dark', autoClose: 2000 });
      }
    });

    somaBackend.on('ui.scroll', (msg) => {
      const { target } = msg.payload || msg;
      if (target) {
        const element = document.getElementById(target);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });

    somaBackend.on('ui.modal', (msg) => {
      console.log('[SomaCommandBridge] Received ui.modal event:', msg);
      const { modal, action } = msg.payload || msg;
      if (modal === 'ProcessMonitor' && action === 'open') {
        setShowProcessModal(true);
      }
      if (modal === 'Pulse' && action === 'open') {
        console.log('[SomaCommandBridge] Opening Pulse Interface');
        setShowPulse(true);
      }
    });

    somaBackend.on('ui.notify', (msg) => {
      const { message, type } = msg.payload || msg;
      if (message) {
        toast[type || 'info'](message, { theme: 'dark' });
      }
    });

    somaBackend.connect();

    return () => {
      somaBackend.disconnect();
    };
  }, []);

  // ------------------------------------------
  // RESTORED EFFECTS (Cognitive & SLC)
  // ------------------------------------------

  // Poll SLC tri-brain for real stats
  useEffect(() => {
    if (!isConnected) return;

    const pollSLC = async () => {
      try {
        const response = await fetch('http://localhost:4200/api/slc/status');
        if (response.ok) {
          const data = await response.json();
          setSlcStats({
            brainA: data.brainA || { name: 'Prometheus', status: 'offline' },
            brainB: data.brainB || { name: 'Aurora', status: 'offline' },
            brainC: data.brainC || { name: 'Logos', status: 'offline' },
            lastQuery: data.lastQuery,
            totalQueries: data.totalQueries || 0
          });
        }
      } catch (error) {
        // SLC not available
      }
    };

    pollSLC();
    const interval = setInterval(pollSLC, 3000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Connect to Cognitive Engine WebSocket
  useEffect(() => {
    if (activeModule !== 'cognitive') return;

    const connectCognitiveWs = () => {
      try {
        const ws = new WebSocket('ws://localhost:5000/ws/cognitive');
        cognitiveWsRef.current = ws;

        ws.onopen = () => {
          console.log('[CognitiveWS] Connected to cognitive engine');
          setCognitiveWsConnected(true);
          toast.success('⚡ Real-time cognitive streaming enabled', { theme: 'dark' });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            // Handle different event types
            if (data.event === 'perception.result') {
              const thought = data.data.thought;
              if (thought && thought.final) {
                setThoughtHistory(prev => [
                  {
                    thought_id: thought.id,
                    actor: data.data.actor,
                    input_text: thought.final.text || '',
                    confidence: data.data.confidence,
                    rounds: thought.rounds || [],
                    final_output: thought.final,
                    created: new Date().toISOString()
                  },
                  ...prev.slice(0, 19)
                ]);

                toast.info(`💭 Thought complete: ${(data.data.confidence * 100).toFixed(1)}% confidence`, { theme: 'dark', autoClose: 2000 });
              }
            } else if (data.event === 'perception.low_confidence') {
              toast.warn(`⚠️ Low confidence from ${data.data.actor}`, { theme: 'dark' });
            }
          } catch (error) {
            console.error('[CognitiveWS] Failed to parse message:', error);
          }
        };

        ws.onerror = () => setCognitiveWsConnected(false);
        ws.onclose = () => {
          setCognitiveWsConnected(false);
          setTimeout(() => {
            if (activeModule === 'cognitive' && cognitiveWsRef.current?.readyState === WebSocket.CLOSED) {
              connectCognitiveWs();
            }
          }, 5000);
        };
      } catch (error) {
        console.error('[CognitiveWS] Failed to connect:', error);
        setCognitiveWsConnected(false);
      }
    };

    connectCognitiveWs();

    return () => {
      if (cognitiveWsRef.current) {
        cognitiveWsRef.current.close();
        cognitiveWsRef.current = null;
      }
    };
  }, [activeModule]);

  // ------------------------------------------
  // Analytics Sync
  // ------------------------------------------
  useEffect(() => {
    if (!isConnected) return;

    const fetchAnalytics = async () => {
      try {
        const velRes = await fetch('/api/velocity/status');
        if (velRes.ok) {
          const data = await velRes.json();
          setPerformanceMetrics(prev => prev.map(m => {
            if (m.metric === 'Velocity') return { ...m, value: Math.min(100, (data.velocity || 0) * 50) };
            return m;
          }));
        }

        const goalRes = await fetch('/api/goals/stats');
        if (goalRes.ok) {
          const data = await goalRes.json();
          if (data.success && data.stats) {
            setPerformanceMetrics(prev => prev.map(m => {
              if (m.metric === 'Efficiency') return { ...m, value: data.stats.averageProgress || 0 };
              return m;
            }));
          }
        }

        const metricsRes = await fetch('/api/velocity/metrics');
        if (metricsRes.ok) {
          const data = await metricsRes.json();
          if (data.success && data.metrics) {
            const chartData = data.metrics.slice(-20).map(m => ({
              time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              loss: m.loss || 0,
              velocity: m.velocity || 0,
              acceleration: m.acceleration || 0
            }));
            setLearningMetrics(chartData);
          }
        }
      } catch (err) {
        console.warn('[Analytics] Sync failed:', err.message);
      }
    };

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 15000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // ------------------------------------------
  // Knowledge Sync
  // ------------------------------------------
  useEffect(() => {
    if (!isConnected) return;

    const fetchKnowledge = async () => {
      try {
        const res = await fetch('/api/knowledge/load');
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.knowledge) {
            const mesh = data.knowledge;

            setGraphData(prevData => {
              const nodes = (mesh.nodes || []).map((n, i) => {
                const existingNode = prevData.nodes.find(en => en.id === n.id);
                return {
                  id: n.id || `node-${i}`,
                  label: n.label || n.title || n.id,
                  position: existingNode ? existingNode.position : [Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3],
                  color: n.color || (n.type === 'system' ? '#3b82f6' : '#10b981')
                };
              });

              const edges = (mesh.edges || []).map(e => {
                const from = e.from || e.source;
                const to = e.to || e.target;
                const sourceNode = nodes.find(n => n.id === from);
                const targetNode = nodes.find(n => n.id === to);
                if (sourceNode && targetNode) {
                  return { source: sourceNode.position, target: targetNode.position, color: e.color || '#444' };
                }
                return null;
              }).filter(Boolean);

              return { nodes, edges };
            });

            setKnowledgeNodes((mesh.nodes || []).map(n => ({
              id: n.id,
              name: n.label || n.title || n.id,
              connections: (mesh.edges || []).filter(e => (e.from || e.source) === n.id || (e.to || e.target) === n.id).length,
              type: n.type || 'node'
            })));
          }
        }
      } catch (err) {
        console.error('[Knowledge] Sync failed:', err.message);
      }
    };

    fetchKnowledge();
    const interval = setInterval(fetchKnowledge, 30000);
    return () => clearInterval(interval);
  }, [isConnected]);

  // Analytics data fetching
  useEffect(() => {
    if (!isConnected) return;

    const fetchAnalytics = async () => {
      try {
        // Fetch learning metrics
        const metricsRes = await somaBackend.fetch(`/api/analytics/learning-metrics?range=${analyticsTimeRange}`);
        if (metricsRes) {
          const data = metricsRes;
          if (data.success && Array.isArray(data.data)) {
            setLearningMetrics(data.data);
          }
        }

        // Fetch performance metrics
        const perfRes = await somaBackend.fetch('/api/analytics/performance');
        if (perfRes) {
          const data = perfRes;
          if (data.success && Array.isArray(data.metrics)) {
            setPerformanceMetrics(data.metrics);
          }
        }

        // Fetch summary
        const summaryRes = await somaBackend.fetch('/api/analytics/summary');
        if (summaryRes) {
          const data = summaryRes;
          if (data.success && data.summary) {
            setPreviousSummary(analyticsSummary);
            setAnalyticsSummary(data.summary);
          }
        }

        // Fetch memory usage
        const memRes = await somaBackend.fetch(`/api/analytics/memory-usage?range=${analyticsTimeRange}`);
        if (memRes) {
          const data = memRes;
          if (data.success && Array.isArray(data.data)) {
            setMemoryUsageData(data.data);
          }
        }

        // Fetch arbiter activity
        const arbiterRes = await somaBackend.fetch(`/api/analytics/arbiter-activity?range=${analyticsTimeRange}`);
        if (arbiterRes) {
          const data = arbiterRes;
          if (data.success && Array.isArray(data.data)) {
            setArbiterActivityData(data.data);
          }
        }
      } catch (err) {
        console.error('[Analytics] Failed to fetch:', err.message);
      }
    };

    fetchAnalytics();
    const interval = setInterval(fetchAnalytics, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [isConnected, analyticsTimeRange, analyticsSummary]);

  // ------------------------------------------
  // Command Handlers
  // ------------------------------------------
  const formatUptime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return `${h}h ${m}m ${s}s`;
  };

  const addActivityLog = (type, message) => {
    setActivityStream(prev => [{
      id: Date.now() + Math.random(),
      type: type,
      message: message,
      timestamp: Date.now()
    }, ...prev].slice(0, 100));
  };

  // Analytics helpers
  const exportAnalyticsData = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      timeRange: analyticsTimeRange,
      summary: analyticsSummary,
      learningMetrics,
      performanceMetrics,
      memoryUsage: memoryUsageData,
      arbiterActivity: arbiterActivityData
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `soma-analytics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Analytics data exported successfully');
  };

  const getTrendIndicator = (current, previous) => {
    if (!previous || !current) return null;
    const diff = current - previous;
    const percentChange = ((diff / previous) * 100).toFixed(1);
    return {
      isPositive: diff > 0,
      change: Math.abs(percentChange),
      icon: diff > 0 ? TrendingUp : TrendingDown
    };
  };

  const toggleAgentStatus = (agentId) => {
    somaBackend.send('command', { action: 'toggle_agent', params: { id: agentId } });
  };

  const restartAgent = (agentId) => {
    somaBackend.send('command', { action: 'restart_agent', params: { id: agentId } });
  };

  const handleFloatingChatMessage = async (message) => {
    try {
      const response = await somaBackend.fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: message,
          context: {
            source: 'floating-chat'
          }
        })
      });
      const data = await response.json();
      if (data.response) {
        return data.response;
      }
    } catch (error) {
      toast.error('Neural Link communication failure');
    }
    return null;
  };

  // ------------------------------------------
  // RESTORED HANDLERS (Cognitive)
  // ------------------------------------------
  const submitCognitiveQuery = async () => {
    if (!cognitiveQuery.trim() || isSomaBusy) return;

    setIsSomaBusy(true);
    setCurrentThought(null);

    try {
      const response = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: cognitiveQuery,
          context: { source: 'cognitive-trace', actor: selectedAgent }
        })
      });

      if (!response.ok) throw new Error(`Cognitive API error: ${response.status}`);
      const data = await response.json();

      const thought = {
        thought_id: Date.now().toString(),
        actor: data.brain || selectedAgent,
        input_text: cognitiveQuery,
        confidence: data.confidence || 0.8,
        rounds: [
          {
            round: 1,
            decision: 'Analysis complete',
            evidence: [],
            hypotheses: [],
            consistency: { consistency_score: 1.0, support: [], conflicts: [] }
          }
        ],
        final_output: {
          text: data.response || data.text,
          reason: 'Processed by QuadBrain'
        },
        created: new Date().toISOString()
      };

      setCurrentThought(thought);
      setThoughtHistory(prev => [thought, ...prev.slice(0, 9)]);
      toast.success('Thinking complete');
    } catch (error) {
      toast.error(`Thinking failed: ${error.message}`);
    } finally {
      setIsSomaBusy(false);
    }
  };

  const handleCognitiveKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitCognitiveQuery();
    }
  };

  // ------------------------------------------
  // Main Render
  // ------------------------------------------
  return (
    <div className="flex h-screen ct-background text-zinc-200 font-sans selection:bg-white/20">
      {showProcessModal && <ProcessMonitor agents={agents} onClose={() => setShowProcessModal(false)} />}
      {showPulse && <PulseInterface onClose={() => setShowPulse(false)} />}
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        theme="dark"
        toastClassName="!bg-[#1c1c1e] !text-zinc-200 !border !border-white/5 !shadow-2xl"
      />

      {/* Sidebar */}
      <div className={`${sidebarCollapsed ? 'w-16' : 'w-64'} bg-[#09090b]/80 backdrop-blur-xl border-r border-white/5 flex flex-col transition-all duration-300 overflow-hidden z-50`}>
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-2">
            {!sidebarCollapsed && <h1 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 tracking-tight">SOMA</h1>}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="text-zinc-500 hover:text-white transition-colors"
            >
              {sidebarCollapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
            </button>
          </div>
          {!sidebarCollapsed && (
            <>
              <div className="flex items-center space-x-2 mb-2">
                <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-amber-500 shadow-[0_0_8px_#f59e0b]'} ${isConnected ? '' : 'animate-pulse'}`} />
                <span className="text-[10px] text-zinc-500 font-bold tracking-widest uppercase">{isConnected ? 'Neural Link Active' : 'Neural Link Severed'}</span>
              </div>
              <p className="text-zinc-600 text-[9px] font-mono uppercase tracking-[0.2em]">Bridge Terminal v7.4</p>
            </>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-0.5">
          {[
            { id: 'core', label: 'Core System', icon: Cpu, color: 'blue' },
            { id: 'command', label: 'Command Center', icon: Activity, color: 'fuchsia' },
            { id: 'terminal', label: 'Terminal', icon: Terminal, color: 'amber' },
            { id: 'orb', label: 'SOMA Orb', icon: Circle, color: 'purple' },
            { id: 'kevin', label: 'KEVIN', icon: Mail, color: 'red' },
            { id: 'cognitive', label: 'Cognitive Trace', icon: Brain, color: 'purple' },
            { id: 'simulation', label: 'Simulation', icon: Box, color: 'orange' },
            { id: 'arbiters', label: 'Arbiters', icon: Workflow, color: 'cyan' },
            { id: 'analytics', label: 'Analytics', icon: BarChart3, color: 'indigo' },
            { id: 'forecaster', label: 'Forecaster', icon: TrendingUp, color: 'indigo' },
            { id: 'mission_control', label: 'Mission Control', icon: RotateCw, color: 'fuchsia' },
            { id: 'marketplace', label: 'Marketplace', icon: DollarSign, color: 'emerald' },
            { id: 'workflow', label: 'Workflow', icon: Workflow, color: 'lime' },
            { id: 'security', label: 'Security', icon: Shield, color: 'red' },
            { id: 'persona', label: 'Persona', icon: User, color: 'sky' },
          ].map(module => (
            <button
              key={module.id}
              onClick={() => setActiveModule(module.id)}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg mb-1 transition-all duration-200 group ${activeModule === module.id ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                }`}
            >
              <module.icon className={`w-5 h-5 ${activeModule === module.id ? `text-${module.color}-400` : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              {!sidebarCollapsed && <span className="font-medium text-sm">{module.label}</span>}
            </button>
          ))}
        </nav>
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col ${['terminal', 'orb', 'mission_control'].includes(activeModule) ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>

        {/* CORE SYSTEM MODULE */}
        {activeModule === 'core' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">System Core</h2>

            {/* Metric Grid */}
            <div className="grid grid-cols-4 gap-4">
              {[
                { id: 'cpu', label: 'CPU Usage', val: systemMetrics.cpu, icon: Cpu, color: 'blue' },
                { id: 'gpu', label: 'GPU Load', val: systemMetrics.gpu, icon: Zap, color: 'yellow' },
                { id: 'ram', label: 'Memory', val: systemMetrics.ram, icon: HardDrive, color: 'purple' },
                { id: 'net', label: 'Network', val: systemMetrics.network, icon: Wifi, color: 'fuchsia' },
              ].map(m => (
                <div key={m.id} onClick={() => setShowProcessModal(true)} className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg transition-all hover:border-white/10 group cursor-pointer hover:bg-white/5">
                  <div className="flex items-center justify-between">
                    <div className={`p-2 rounded-lg bg-${m.color}-500/10 group-hover:bg-${m.color}-500/20 transition-colors`}>
                      <m.icon className={`w-6 h-6 text-${m.color}-400`} />
                    </div>
                    <div className="text-2xl font-bold text-zinc-100 font-mono truncate">{(Number(m.val) || 0).toFixed(1)}%</div>
                  </div>
                  <div className="text-zinc-500 text-[10px] font-bold mt-3 uppercase tracking-widest truncate">{m.label}</div>
                  <div className="w-full bg-zinc-800/50 rounded-full h-1 mt-3 overflow-hidden">
                    <div className={`bg-${m.color}-500 h-1 rounded-full transition-all duration-700`} style={{ width: `${Math.min(100, Number(m.val || 0))}%` }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* System Info */}
              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg flex flex-col justify-between">
                <div>
                  <h3 className="text-zinc-100 font-semibold text-sm flex items-center mb-4 uppercase tracking-wider">
                    <Activity className="w-4 h-4 mr-2 text-fuchsia-400" /> Operational Status
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between text-xs pb-2 border-b border-white/5">
                      <span className="text-zinc-500">System Uptime</span>
                      <span className="text-zinc-200 font-mono">{formatUptime(systemMetrics.uptime || 0)}</span>
                    </div>
                    <div className="flex justify-between text-xs pb-2 border-b border-white/5">
                      <span className="text-zinc-500">Neural Load Avg</span>
                      <span className="text-zinc-200 font-mono">
                        {systemMetrics.neuralLoad?.load1 || '0.00'}, {systemMetrics.neuralLoad?.load5 || '0.00'}, {systemMetrics.neuralLoad?.load15 || '0.00'}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs pb-2 border-b border-white/5">
                      <span className="text-zinc-500">Primary Node</span>
                      <span className="text-fuchsia-400 font-bold uppercase tracking-tighter">ONLINE (LOCAL)</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Context Window</span>
                      <span className="text-zinc-200 font-mono">
                        {((systemMetrics.contextWindow?.used || 0) / 1000).toFixed(0)}K / {((systemMetrics.contextWindow?.maxTokens || 1048576) / 1000).toFixed(0)}K
                        <span className="text-zinc-500 ml-1">({(systemMetrics.contextWindow?.percentage || 0).toFixed(1)}%)</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 mt-4">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_#10b981]" />
                  <span className="text-emerald-500 text-[10px] font-bold uppercase tracking-widest text-shadow-sm">SYSTEM ONLINE</span>
                </div>
              </div>

              {/* Memory Monitor */}
              <MemoryTierMonitor isConnected={isConnected} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              {/* Dashboard Panels */}
              <LearningVelocityDashboard isConnected={isConnected} />
              <AutonomousActivityFeed isConnected={isConnected} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <BeliefNetworkViewer isConnected={isConnected} />
              <DreamInsights isConnected={isConnected} />
            </div>

            <div className="grid grid-cols-3 gap-6">
              <TheoryOfMindPanel isConnected={isConnected} />
              <div className="col-span-2">
                <SkillProficiencyRadar isConnected={isConnected} />
              </div>
            </div>
          </div>
        )}

        {/* TERMINAL MODULE */}
        {activeModule === 'terminal' && <div className="flex-1 h-full"><SomaCT /></div>}

        {/* ORB MODULE */}
        {activeModule === 'orb' && (
          <div className="flex flex-col items-center justify-center h-full w-full bg-black relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/20 via-black to-black pointer-events-none" />
            <h2 className="absolute top-8 text-xl font-light text-white/50 tracking-widest z-10 uppercase">SOMA Voice Interface</h2>
            <div className="absolute top-8 right-8 z-20 flex flex-col items-end space-y-2">
              {[
                { label: 'Backend', status: orbSystemStatus.somaBackend, required: true },
                { label: 'Whisper', status: orbSystemStatus.whisperServer, required: true },
                { label: 'Voice', status: orbSystemStatus.elevenLabs, required: false },
              ].map(s => (
                <div key={s.label} className="flex items-center space-x-2 group relative">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">{s.label}</span>
                  <div className={`w-1.5 h-1.5 rounded-full ${s.status === 'connected' || s.status === 'ready' || s.status === 'enabled' ? 'bg-fuchsia-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                    s.status === 'fallback' ? 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.5)]' :
                      s.status === 'initializing' ? 'bg-blue-500 animate-pulse' :
                        'bg-rose-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]'
                    }`} />
                  {/* Status tooltip */}
                  {(s.status === 'error' || s.status === 'fallback' || s.status === 'initializing') && (
                    <div className="absolute right-full mr-2 px-2 py-1 bg-black/90 border border-white/10 rounded text-[9px] text-zinc-300 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      {s.status === 'error' && s.label === 'Whisper' && 'Run: python whisper_flask_server.py'}
                      {s.status === 'error' && s.label === 'Backend' && 'Start SOMA backend on port 3001'}
                      {s.status === 'fallback' && 'Using browser speech (lower quality)'}
                      {s.status === 'initializing' && 'Starting up...'}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="relative z-10 h-[500px] w-full flex items-center justify-center">
              <Orb volume={volume} isActive={isOrbConnected} isTalking={isTalking} isListening={isListening} isThinking={isThinking} />
            </div>
            <div className="relative z-10 mt-8 flex flex-col items-center gap-3">
              {/* Neural Link Button */}
              <div className="flex gap-4 bg-black/50 p-4 rounded-full border border-white/10 backdrop-blur-md">
                <button
                  className={`px-8 py-3 rounded-full font-bold uppercase tracking-widest text-xs transition-all ${isOrbConnected ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50' : 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/20'
                    }`}
                  onClick={() => isOrbConnected ? disconnectOrb() : connectOrb()}
                >
                  {isOrbConnected ? '● Disengage Link' : '○ Establish Neural Link'}
                </button>
              </div>

              {/* Collapsible Text Input */}
              {isOrbConnected && (
                <div className="group relative">
                  {/* Collapsed hint */}
                  <div className="text-[9px] uppercase tracking-widest text-zinc-600 group-hover:text-zinc-400 transition-colors cursor-pointer text-center mb-1">
                    Manual Input
                  </div>

                  {/* Expandable Input Panel */}
                  <div className="max-h-0 group-hover:max-h-24 overflow-hidden transition-all duration-300 ease-in-out">
                    <div className="bg-black/70 backdrop-blur-xl border border-white/10 rounded-2xl p-3 min-w-[400px]">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Type your message to SOMA..."
                          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 focus:bg-white/10 transition-all"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.target.value.trim()) {
                              const query = e.target.value.trim();
                              e.target.value = '';
                              // Send to SOMA via voice interface
                              if (window.somaTextQuery) {
                                window.somaTextQuery(query);
                              }
                            }
                          }}
                        />
                        <button
                          onClick={(e) => {
                            const input = e.target.closest('.flex').querySelector('input');
                            const query = input.value.trim();
                            if (query) {
                              input.value = '';
                              if (window.somaTextQuery) {
                                window.somaTextQuery(query);
                              }
                            }
                          }}
                          className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-xl text-purple-300 text-xs font-bold uppercase tracking-wider transition-all"
                        >
                          Send
                        </button>
                      </div>
                      <div className="text-[8px] text-zinc-600 mt-2 text-center">
                        SOMA will respond via voice • Press Enter to send
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* KEVIN MODULE */}
        {activeModule === 'kevin' && <KevinInterface />}



        {/* COGNITIVE MODULE */}
        {activeModule === 'cognitive' && (
          <div className="flex flex-col h-full space-y-4">
            <div className="flex justify-between items-center">
              <div>
                <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
                  <Brain className="w-6 h-6 mr-3 text-purple-400" /> Cognitive Trace Viewer
                </h2>
                <p className="text-zinc-500 text-xs mt-1">Real-time introspection of the thinking process</p>
              </div>
              <div className={`flex items-center gap-3 px-4 py-2 rounded-xl border ${cognitiveWsConnected ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-zinc-800/50 border-white/5'}`}>
                <div className={`w-2 h-2 rounded-full ${cognitiveWsConnected ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]' : 'bg-zinc-600'}`} />
                <span className={`text-[10px] font-bold uppercase tracking-widest ${cognitiveWsConnected ? 'text-emerald-400' : 'text-zinc-500'}`}>
                  {cognitiveWsConnected ? 'Live Stream Active' : 'Stream Offline'}
                </span>
              </div>
            </div>

            {/* Agent Selector */}
            <div className="bg-[#151518]/60 border border-white/5 rounded-xl p-3">
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full bg-black/40 text-zinc-300 text-xs px-3 py-2 rounded-lg border border-white/5 focus:outline-none focus:border-purple-500/50 transition-all"
              >
                {arbiters.length === 0 ? (
                  <option>No arbiters available</option>
                ) : (
                  arbiters.map(arb => (
                    <option key={arb.id} value={arb.id}>
                      {arb.name} ({arb.type || 'System'})
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Thought History */}
            <div className="flex-1 bg-black/40 border border-white/5 rounded-xl p-4 overflow-y-auto custom-scrollbar">
              {!currentThought && thoughtHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600 italic">
                  <Brain className="w-12 h-12 mb-4 opacity-10" />
                  <p>Awaiting cognitive event stream...</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {(currentThought || thoughtHistory[0]) && (
                    <div className="border border-purple-500/30 rounded-xl p-5 bg-purple-500/5 relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                        <Zap className="w-24 h-24 text-purple-400" />
                      </div>
                      <div className="flex items-center justify-between mb-4 relative z-10">
                        <div className="flex items-center space-x-2">
                          <Activity className="w-4 h-4 text-purple-400" />
                          <span className="text-xs font-bold text-zinc-100 uppercase tracking-widest">Active Thought Pattern</span>
                        </div>
                        <div className="bg-black/50 px-2 py-1 rounded border border-white/10">
                          <span className="text-[10px] font-mono text-purple-400 font-bold">
                            {((currentThought || thoughtHistory[0]).confidence * 100).toFixed(1)}% CONFIDENCE
                          </span>
                        </div>
                      </div>

                      <div className="bg-black/40 rounded-lg p-3 border border-white/5 mb-4">
                        <p className="text-xs text-zinc-400 mb-1 uppercase font-bold tracking-tighter opacity-50">Query Input</p>
                        <p className="text-sm text-zinc-200">{(currentThought || thoughtHistory[0]).input_text}</p>
                      </div>

                      <div className="space-y-3">
                        {(currentThought || thoughtHistory[0]).rounds.map((round, idx) => (
                          <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/5">
                            <div className="flex justify-between mb-2">
                              <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">Stage {round.round}</span>
                              <span className="text-[10px] text-zinc-500 font-mono italic">{round.decision}</span>
                            </div>
                            {round.consistency && (
                              <div className="w-full bg-zinc-800 rounded-full h-1 mt-2 overflow-hidden">
                                <div className="bg-purple-500 h-full" style={{ width: `${round.consistency.consistency_score * 100}%` }} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Final Result */}
                      {(currentThought || thoughtHistory[0]).final_output && (
                        <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Final Cognitive Result</p>
                          <p className="text-sm text-zinc-200 italic">"{(currentThought || thoughtHistory[0]).final_output.text}"</p>
                        </div>
                      )}
                    </div>
                  )}

                  {thoughtHistory.length > 1 && (
                    <div className="space-y-2">
                      <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Thought History</h4>
                      {thoughtHistory.slice(1).map((t, i) => (
                        <div key={i} className="p-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg cursor-pointer transition-colors" onClick={() => setCurrentThought(t)}>
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-zinc-300 truncate max-w-[70%]">{t.input_text}</span>
                            <span className="text-[10px] font-mono text-zinc-500">{(t.confidence * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="bg-[#151518]/60 border border-white/5 rounded-xl p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={cognitiveQuery}
                  onChange={(e) => setCognitiveQuery(e.target.value)}
                  onKeyDown={handleCognitiveKeyPress}
                  placeholder="Direct probe query..."
                  className="flex-1 bg-black/40 border border-white/10 rounded-lg px-4 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500/50 transition-all"
                />
                <button
                  onClick={submitCognitiveQuery}
                  className="px-6 py-2 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/30 rounded-lg text-purple-300 text-xs font-bold uppercase tracking-widest transition-all flex items-center"
                >
                  <Brain className="w-4 h-4 mr-2" /> Probe
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SIMULATION MODULE */}
        {activeModule === 'simulation' && (
          <div className="h-full flex flex-col bg-[#09090b] text-zinc-200 font-sans p-6 rounded-xl border border-white/5 relative overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
                <Box className="w-6 h-6 mr-3 text-orange-400" /> Physics Simulation
              </h2>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">LIVE FEED</span>
                <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(249,115,22,0.5)]" />
              </div>
            </div>
            <div className="flex-1 bg-black rounded-xl overflow-hidden border border-white/10 shadow-inner relative">
              <iframe
                src="/simulation_viewer.html"
                className="w-full h-full border-0"
                title="SOMA Physics Simulation"
              />
              {/* Overlay for instructions */}
              <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md p-3 rounded-lg border border-white/10 text-xs text-zinc-400 pointer-events-none">
                <p className="font-bold text-orange-400 mb-1">EMBODIED LEARNING</p>
                <p>Observe SOMA learning physical manipulation.</p>
              </div>
            </div>
          </div>
        )}

        {/* ARBITERS Swarm View */}
        {activeModule === 'arbiters' && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-white tracking-tight">Arbiters</h2>
              <div className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                <span className="text-zinc-300 font-mono">{arbiters.filter(a => a.status === 'active').length}</span> Online /
                <span className="text-zinc-300 font-mono">{arbiters.length}</span> Total
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {arbiters.map(agent => (
                <div key={agent.id} className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg transition-all hover:border-white/10 group relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                    <Workflow className="w-12 h-12 text-white" />
                  </div>
                  <div className="flex items-center justify-between mb-4 relative z-10">
                    <div className="flex items-center space-x-3">
                      <div className={`p-2 rounded-lg ${agent.status === 'active' ? 'bg-emerald-500/10' :
                        agent.status === 'idle' ? 'bg-amber-500/10' :
                          agent.status === 'stopped' ? 'bg-rose-500/10' :
                            'bg-zinc-800'
                        }`}>
                        {agent.type?.includes('defensive') ? <Shield className="w-5 h-5 text-fuchsia-400" /> :
                          agent.type?.includes('analytical') ? <Brain className="w-5 h-5 text-blue-400" /> :
                            <Workflow className="w-5 h-5 text-purple-400" />}
                      </div>
                      <div>
                        <span className="text-zinc-100 font-bold block text-sm">{agent.name}</span>
                        <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">{agent.type || 'System Arbiter'}</span>
                      </div>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold uppercase tracking-wide ${agent.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      agent.status === 'idle' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                        agent.status === 'stopped' ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
                          'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                      }`}>{agent.status}</span>
                  </div>
                  <div className="space-y-3 relative z-10">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest mb-1.5 text-zinc-500">
                      <span>Cognitive Load</span>
                      <span className="text-zinc-200 font-mono">{agent.load}%</span>
                    </div>
                    <div className="w-full bg-zinc-800/50 rounded-full h-1 overflow-hidden">
                      <div className={`h-full transition-all duration-700 ${agent.load > 80 ? 'bg-rose-500' : agent.load > 50 ? 'bg-amber-500' : 'bg-blue-500'}`} style={{ width: `${agent.load}%` }} />
                    </div>
                  </div>
                  <div className="flex space-x-2 mt-5 relative z-10">
                    <button onClick={() => toggleAgentStatus(agent.id)} className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border border-white/5 hover:border-white/10">Standby</button>
                    <button onClick={() => restartAgent(agent.id)} className="px-3 py-2 bg-white/5 hover:bg-white/10 text-zinc-300 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all border border-white/5 hover:border-white/10">Restart</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}



        {/* ANALYTICS MODULE */}
        {activeModule === 'analytics' && (
          <div className="space-y-6">
            {/* Header with Time Range Controls and Export */}
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-white tracking-tight flex items-center">
                <BarChart3 className="w-6 h-6 mr-3 text-indigo-400" /> Cognitive Analytics
              </h2>
              <div className="flex items-center space-x-3">
                {/* Time Range Selector */}
                <div className="flex items-center space-x-2 bg-[#151518]/60 border border-white/5 rounded-lg p-1">
                  {['1h', '6h', '24h', '7d'].map(range => (
                    <button
                      key={range}
                      onClick={() => setAnalyticsTimeRange(range)}
                      className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${analyticsTimeRange === range
                        ? 'bg-indigo-500 text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                        }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
                {/* Export Button */}
                <button
                  onClick={exportAnalyticsData}
                  className="flex items-center space-x-2 px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 rounded-lg transition-all"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-xs font-medium">Export</span>
                </button>
              </div>
            </div>

            {/* Summary KPI Cards */}
            {analyticsSummary && (
              <div className="grid grid-cols-4 gap-4">
                {[
                  {
                    label: 'Total Queries',
                    value: analyticsSummary.totalQueries || 0,
                    icon: Target,
                    color: 'blue',
                    prev: previousSummary?.totalQueries
                  },
                  {
                    label: 'Success Rate',
                    value: analyticsSummary.successRate + '%',
                    icon: CheckCircle,
                    color: 'fuchsia',
                    prev: previousSummary?.successRate
                  },
                  {
                    label: 'Active Arbiters',
                    value: analyticsSummary.activeArbiters + '/' + analyticsSummary.totalArbiters,
                    icon: Server,
                    color: 'purple',
                    prev: previousSummary?.activeArbiters
                  },
                  {
                    label: 'Cache Hit Rate',
                    value: (analyticsSummary.cacheHitRate || 0).toFixed(1) + '%',
                    icon: Gauge,
                    color: 'amber',
                    prev: previousSummary?.cacheHitRate
                  },
                  {
                    label: 'Memory Usage',
                    value: analyticsSummary.memoryUsage + ' MB',
                    icon: HardDrive,
                    color: 'rose',
                    prev: previousSummary?.memoryUsage
                  },
                  {
                    label: 'Avg Response',
                    value: (analyticsSummary.avgResponseTime || 0) + ' ms',
                    icon: Clock,
                    color: 'cyan',
                    prev: previousSummary?.avgResponseTime
                  },
                  {
                    label: 'System Uptime',
                    value: formatUptime(analyticsSummary.uptime || 0),
                    icon: Activity,
                    color: 'fuchsia',
                    showTrend: false
                  },
                  {
                    label: 'Token Usage',
                    value: (analyticsSummary.tokenUsage || 0).toLocaleString(),
                    icon: Zap,
                    color: 'violet',
                    prev: previousSummary?.tokenUsage
                  },
                ].map((item, i) => {
                  const trend = item.showTrend !== false && item.prev ? getTrendIndicator(parseFloat(item.value), item.prev) : null;
                  return (
                    <div key={i} className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg hover:border-white/10 transition-all">
                      <div className="flex items-center justify-between mb-2">
                        <item.icon className={`w-4 h-4 text-${item.color}-400`} />
                        <div className="flex items-center space-x-2">
                          <span className="text-xl font-bold text-white font-mono">{item.value}</span>
                          {trend && (
                            <span className={`flex items-center text-xs font-medium ${trend.isPositive ? 'text-fuchsia-400' : 'text-red-400'}`}>
                              <trend.icon className="w-3 h-3 mr-0.5" />
                              {trend.change}%
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-zinc-500 text-[10px] uppercase tracking-widest font-bold">{item.label}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Charts Grid */}
            <div className="grid grid-cols-2 gap-6">
              {/* Learning Velocity & Loss */}
              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-100 font-semibold text-sm uppercase tracking-wider">Learning Velocity & Loss</h3>
                  <div className="w-1.5 h-1.5 bg-fuchsia-500 rounded-full animate-pulse" title="Live data" />
                </div>
                <div className="h-[300px] w-full">
                  {learningMetrics.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600">
                      <Activity className="w-8 h-8 mb-2 opacity-20 animate-pulse" />
                      <p className="text-sm">Awaiting neural telemetry...</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={learningMetrics}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="time" stroke="#71717a" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis stroke="#71717a" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} labelStyle={{ color: '#e4e4e7' }} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Line name="Velocity" type="monotone" dataKey="velocity" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                        <Line name="Loss" type="monotone" dataKey="loss" stroke="#ef4444" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                        <Line name="Acceleration" type="monotone" dataKey="acceleration" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Metacognitive Performance Radar */}
              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-100 font-semibold text-sm uppercase tracking-wider">Metacognitive Performance</h3>
                  <div className="w-1.5 h-1.5 bg-fuchsia-500 rounded-full animate-pulse" title="Live data" />
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadarChart data={performanceMetrics}>
                      <PolarGrid stroke="#333" />
                      <PolarAngleAxis dataKey="metric" tick={{ fill: '#a1a1aa', fontSize: 12 }} />
                      <PolarRadiusAxis stroke="#333" tick={false} axisLine={false} domain={[0, 100]} />
                      <Radar name="System" dataKey="value" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.2} />
                      <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} labelStyle={{ color: '#e4e4e7' }} />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Memory Usage Over Time */}
              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-100 font-semibold text-sm uppercase tracking-wider">Memory Usage Over Time</h3>
                  <div className="w-1.5 h-1.5 bg-fuchsia-500 rounded-full animate-pulse" title="Live data" />
                </div>
                <div className="h-[300px] w-full">
                  {memoryUsageData.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600">
                      <HardDrive className="w-8 h-8 mb-2 opacity-20 animate-pulse" />
                      <p className="text-sm">Collecting memory metrics...</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={memoryUsageData}>
                        <defs>
                          <linearGradient id="heapUsedGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="time" stroke="#71717a" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis stroke="#71717a" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} label={{ value: 'MB', angle: -90, position: 'insideLeft', fill: '#71717a', fontSize: 10 }} />
                        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} labelStyle={{ color: '#e4e4e7' }} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Area name="Heap Used" type="monotone" dataKey="heapUsed" stroke="#8b5cf6" fill="url(#heapUsedGradient)" strokeWidth={2} />
                        <Area name="RSS" type="monotone" dataKey="rss" stroke="#06b6d4" fill="none" strokeWidth={1} strokeDasharray="5 5" />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Arbiter Activity */}
              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-zinc-100 font-semibold text-sm uppercase tracking-wider">Arbiter Activity</h3>
                  <div className="w-1.5 h-1.5 bg-fuchsia-500 rounded-full animate-pulse" title="Live data" />
                </div>
                <div className="h-[300px] w-full">
                  {arbiterActivityData.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600">
                      <Workflow className="w-8 h-8 mb-2 opacity-20 animate-pulse" />
                      <p className="text-sm">Monitoring arbiter swarm...</p>
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={arbiterActivityData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#333" vertical={false} />
                        <XAxis dataKey="time" stroke="#71717a" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <YAxis stroke="#71717a" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} labelStyle={{ color: '#e4e4e7' }} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                        <Line name="Active Arbiters" type="monotone" dataKey="active" stroke="#10b981" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MARKETPLACE MODULE */}
        {activeModule === 'marketplace' && <Marketplace />}

        {/* FORECASTER MODULE */}
        {activeModule === 'forecaster' && <ForecasterApp />}

        {/* MISSION CONTROL MODULE */}
        {activeModule === 'mission_control' && <MissionControlApp />}





        {activeModule === 'workflow' && (
          <div className="h-full flex flex-col bg-[#09090b] text-zinc-200">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-[#151518]/50 backdrop-blur-sm">
              <div className="flex items-center space-x-4">
                <h2 className="text-xl font-bold text-white tracking-tight flex items-center">
                  <Workflow className="w-5 h-5 mr-2 text-lime-400" /> Workflow Studio
                </h2>
                {activeWorkflow && (
                  <div className="flex items-center px-3 py-1 bg-white/5 rounded-full border border-white/5">
                    <span className="text-xs text-zinc-400 mr-2">Editing:</span>
                    <input
                      type="text"
                      value={activeWorkflow.name}
                      onChange={(e) => updateWorkflow(activeWorkflow.id, { name: e.target.value })}
                      className="bg-transparent border-none outline-none text-sm font-medium text-white w-40 focus:ring-0"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setShowSteve(!showSteve)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center ${showSteve
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500/70 hover:text-emerald-400 border border-emerald-500/10'
                    }`}
                >
                  <MessageSquare className="w-3 h-3 mr-1" /> STEVE
                </button>
                <button
                  onClick={handleCreateWorkflow}
                  className="px-3 py-1.5 bg-lime-500/10 hover:bg-lime-500/20 text-lime-400 border border-lime-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center"
                >
                  <Plus className="w-3 h-3 mr-1" /> New
                </button>
                {activeWorkflow && (
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => {
                        // Placeholder for marketplace share logic
                        // In a real implementation this would trigger a modal form
                        somaBackend.send('command', {
                          action: 'share_to_marketplace',
                          payload: activeWorkflow
                        });
                        toast.info('Submitting to Neural Bazaar for review...');
                      }}
                      className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center"
                      title="Share to Neural Bazaar"
                    >
                      <Share2 className="w-3 h-3 mr-1" /> Share
                    </button>
                    <button
                      onClick={() => {
                        toast.success('Workflow saved locally');
                      }}
                      className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center"
                    >
                      <Database className="w-3 h-3 mr-1" /> Save & Deploy
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Editor Area */}
            <div className="flex-1 flex overflow-hidden relative">
              {showSteve ? (
                <div className="flex-1 h-full relative z-20">
                  <SteveInterface onClose={() => setShowSteve(false)} />
                </div>
              ) : activeWorkflow ? (
                <>
                  <div className="flex-1 relative h-full">
                    <WorkflowCanvas
                      nodes={activeWorkflow.nodes}
                      connections={activeWorkflow.connections}
                      onNodesChange={(nodes) => updateWorkflow(activeWorkflow.id, { nodes })}
                      onConnectionsChange={(connections) => updateWorkflow(activeWorkflow.id, { connections })}
                      onNodeSelect={setSelectedNodeId}
                      selectedNodeId={selectedNodeId}
                    />
                    {selectedNodeId && (
                      <NodeConfigPanel
                        node={activeWorkflow.nodes.find(n => n.id === selectedNodeId)}
                        onClose={() => setSelectedNodeId(null)}
                        onUpdate={(nodeId, updates) => {
                          const updatedNodes = activeWorkflow.nodes.map(n => n.id === nodeId ? { ...n, ...updates } : n);
                          updateWorkflow(activeWorkflow.id, { nodes: updatedNodes });
                        }}
                      />
                    )}

                    {/* Floating Execution Panel */}
                    <FloatingPanel
                      title="Execution"
                      className="absolute right-4 top-4 w-80"
                      icon={Activity}
                      iconColor="text-fuchsia-400"
                    >
                      <ExecutionPanel
                        workflow={activeWorkflow}
                        onExecutionComplete={(logs) => logs.forEach(addExecutionLog)}
                      />
                    </FloatingPanel>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 bg-grid-white/[0.02]">
                  <Workflow className="w-16 h-16 mb-4 opacity-20" />
                  <h3 className="text-lg font-medium text-zinc-400">No Workflow Selected</h3>
                  <p className="text-sm mb-6">Select a workflow from the list or create a new one.</p>
                  <div className="grid grid-cols-2 gap-4 max-w-lg w-full px-8">
                    {workflows.map(w => (
                      <button
                        key={w.id}
                        onClick={() => setActiveWorkflow(w.id)}
                        className="p-4 bg-[#151518]/60 border border-white/5 hover:border-lime-500/30 rounded-xl text-left transition-all hover:bg-white/5 group"
                      >
                        <div className="font-medium text-zinc-200 group-hover:text-lime-400 transition-colors">{w.name}</div>
                        <div className="text-xs text-zinc-500 mt-1">{w.nodes.length} nodes</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Floating Steve for Workflow Tab Only */}
            {!showPulse && !showSteve && <WorkflowSteve onNavigate={setActiveModule} />}
          </div>
        )}

        {activeModule === 'command' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Command Center</h2>
            <p className="text-zinc-500 mb-6 text-sm">Central control hub for system-wide operations</p>

            <div className="grid grid-cols-3 gap-4 mb-6">
              <button
                onClick={() => {
                  somaBackend.send('command', { action: 'start_all' });
                  addActivityLog('info', 'Command sent: Start All Agents');
                }}
                className="bg-fuchsia-500/10 hover:bg-fuchsia-500/20 border border-fuchsia-500/20 text-fuchsia-400 p-5 rounded-xl flex flex-col items-center justify-center space-y-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="p-3 bg-fuchsia-500/20 rounded-full">
                  <Play className="w-6 h-6" />
                </div>
                <span className="font-semibold text-sm">Start All Agents</span>
              </button>

              <button
                onClick={() => {
                  somaBackend.send('command', { action: 'stop_all' });
                  addActivityLog('info', 'Command sent: Pause All Agents');
                }}
                className="bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 p-5 rounded-xl flex flex-col items-center justify-center space-y-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="p-3 bg-amber-500/20 rounded-full">
                  <Pause className="w-6 h-6" />
                </div>
                <span className="font-semibold text-sm">Pause All Agents</span>
              </button>

              <button
                onClick={() => {
                  somaBackend.send('command', { action: 'reset_system' }); // Assuming backend handles this or we add it later
                  addActivityLog('warning', 'Command sent: Reset System');
                }}
                className="bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 p-5 rounded-xl flex flex-col items-center justify-center space-y-3 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <div className="p-3 bg-blue-500/20 rounded-full">
                  <RotateCw className="w-6 h-6" />
                </div>
                <span className="font-semibold text-sm">Reset System</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-6 mb-6">
              <div className="col-span-2">
                <h3 className="text-zinc-100 font-semibold mb-4 text-sm uppercase tracking-wider">Quick Actions</h3>
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <button
                    onClick={() => {
                      somaBackend.send('command', { action: 'run_diagnostics' });
                      setShowDiagnostics(true);
                      setDiagnosticLogs([]); // Clear previous logs
                    }}
                    className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg transition-all hover:border-white/10 hover:shadow-xl group hover:scale-[1.02] active:scale-[0.98] text-left"
                  >
                    <div className="p-2.5 rounded-lg bg-blue-500/10 w-fit mb-3 group-hover:bg-blue-500/20 transition-colors">
                      <Search className="w-5 h-5 text-blue-400" />
                    </div>
                    <div className="text-zinc-200 font-semibold text-sm">System Diagnostics</div>
                    <div className="text-zinc-500 text-xs mt-1">Run full health check</div>
                  </button>

                  <button
                    onClick={() => somaBackend.send('command', { action: 'clear_cache' })}
                    className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg transition-all hover:border-white/10 hover:shadow-xl group hover:scale-[1.02] active:scale-[0.98] text-left"
                  >
                    <div className="p-2.5 rounded-lg bg-amber-500/10 w-fit mb-3 group-hover:bg-amber-500/20 transition-colors">
                      <Trash2 className="w-5 h-5 text-amber-400" />
                    </div>
                    <div className="text-zinc-200 font-semibold text-sm">Clear Cache</div>
                    <div className="text-zinc-500 text-xs mt-1">Free up memory resources</div>
                  </button>

                  <button
                    onClick={() => somaBackend.send('command', { action: 'create_backup' })}
                    className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg transition-all hover:border-white/10 hover:shadow-xl group hover:scale-[1.02] active:scale-[0.98] text-left"
                  >
                    <div className="p-2.5 rounded-lg bg-fuchsia-500/10 w-fit mb-3 group-hover:bg-fuchsia-500/20 transition-colors">
                      <Database className="w-5 h-5 text-fuchsia-400" />
                    </div>
                    <div className="text-zinc-200 font-semibold text-sm">Create Backup</div>
                    <div className="text-zinc-500 text-xs mt-1">Snapshot current state</div>
                  </button>

                  <button
                    onClick={() => somaBackend.send('command', { action: 'optimize_system' })}
                    className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-4 shadow-lg transition-all hover:border-white/10 hover:shadow-xl group hover:scale-[1.02] active:scale-[0.98] text-left"
                  >
                    <div className="p-2.5 rounded-lg bg-purple-500/10 w-fit mb-3 group-hover:bg-purple-500/20 transition-colors">
                      <Zap className="w-5 h-5 text-purple-400" />
                    </div>
                    <div className="text-zinc-200 font-semibold text-sm">Optimize System</div>
                    <div className="text-zinc-500 text-xs mt-1">Tune performance metrics</div>
                  </button>
                </div>

                {/* Diagnostic Terminal Output */}
                {showDiagnostics && (
                  <div className="bg-black/80 rounded-xl border border-white/10 p-4 font-mono text-xs mb-6 max-h-60 overflow-y-auto custom-scrollbar shadow-inner relative">
                    <div className="absolute top-2 right-2 cursor-pointer text-zinc-500 hover:text-white" onClick={() => setShowDiagnostics(false)}>
                      <X className="w-4 h-4" />
                    </div>
                    <div className="text-fuchsia-500 font-bold mb-2">root@soma:~/diagnostics$ ./health_check.sh</div>
                    {diagnosticLogs.length > 0 ? (
                      diagnosticLogs.map((log, i) => (
                        <div key={i} className="text-zinc-300 mb-1 border-l-2 border-transparent hover:border-white/20 pl-2">
                          {log}
                        </div>
                      ))
                    ) : (
                      <div className="text-zinc-500 animate-pulse">Initializing diagnostic sequence...</div>
                    )}
                    <div className="h-4" /> {/* Spacer */}
                  </div>
                )}
              </div>

              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg col-span-2">
                <h3 className="text-zinc-100 font-semibold mb-4 text-sm uppercase tracking-wider">System Status</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="text-zinc-400 text-sm">Arbiters</span>
                    <span className="text-zinc-100 font-mono font-bold">
                      {arbiters.filter(a => a.status === 'active' || a.health?.status === 'healthy').length}/{arbiters.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="text-zinc-400 text-sm">Micro-Agents</span>
                    <span className="text-zinc-100 font-mono font-bold">
                      {microAgents.filter(a => a.status === 'active' || a.health?.status === 'healthy').length}/{microAgents.length}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="text-zinc-400 text-sm">Knowledge Fragments</span>
                    <span className="text-zinc-100 font-mono font-bold">{fragments.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400 text-sm">System Uptime</span>
                    <span className="text-zinc-100 font-mono font-bold">{formatUptime(systemMetrics.uptime)}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg">
              <h3 className="text-zinc-100 font-semibold mb-4 text-sm uppercase tracking-wider">Activity Stream</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                {activityStream.map(log => (
                  <div key={log.id} className={`p-3 rounded-lg text-sm border flex items-start space-x-3 ${log.type === 'success' ? 'bg-fuchsia-500/5 border-fuchsia-500/10 text-fuchsia-400' :
                    log.type === 'error' ? 'bg-rose-500/5 border-rose-500/10 text-rose-400' :
                      log.type === 'warning' ? 'bg-amber-500/5 border-amber-500/10 text-amber-400' :
                        'bg-blue-500/5 border-blue-500/10 text-blue-400'
                    }`}>
                    <div className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.type === 'success' ? 'bg-fuchsia-500' :
                      log.type === 'error' ? 'bg-rose-500' :
                        log.type === 'warning' ? 'bg-amber-500' :
                          'bg-blue-500'
                      }`} />
                    <div className="flex-1 flex justify-between items-start">
                      <span>{log.message}</span>
                      <span className="text-[10px] opacity-60 font-mono whitespace-nowrap ml-4">{new Date(log.timestamp).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeModule === 'security' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6 tracking-tight">Security Control</h2>
            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg mb-6">
              <button
                onClick={() => {
                  const newState = !emergencyStop;
                  setEmergencyStop(newState);
                  if (newState) {
                    // Emergency stop - pause all systems
                    somaBackend.send('command', { action: 'stop_all' });
                    addActivityLog('error', 'EMERGENCY STOP ACTIVATED - All systems halted');
                  } else {
                    // Resume operations
                    somaBackend.send('command', { action: 'start_all' });
                    addActivityLog('success', 'System operations resumed');
                  }
                }}
                className={`w-full py-4 rounded-xl font-bold text-white transition-all shadow-xl ${emergencyStop
                  ? 'bg-fuchsia-600 hover:bg-fuchsia-500 shadow-fuchsia-900/30'
                  : 'bg-rose-600 hover:bg-rose-500 shadow-rose-900/30 animate-pulse'
                  }`}
              >
                {emergencyStop ? 'RESUME SYSTEM OPERATIONS' : '⚠️ EMERGENCY STOP ALL SYSTEMS'}
              </button>
              <p className="text-center text-zinc-500 text-xs mt-3">
                {emergencyStop ? 'System paused. Click to resume normal operations.' : 'Pressing this will immediately halt all agent activities and network connections.'}
              </p>
            </div>

            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
              <h3 className="text-zinc-100 font-semibold mb-4 text-sm uppercase tracking-wider">Security Audit Log</h3>
              <div className="space-y-2 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                {auditLogs && auditLogs.length > 0 ? auditLogs.map(log => (
                  <div key={log.id} className="text-sm p-3 bg-[#09090b]/40 rounded-lg border border-white/5 flex justify-between items-center hover:bg-[#09090b]/60 transition-colors">
                    <div>
                      <span className="text-zinc-200 font-medium">{log.action}</span>
                      <div className="text-zinc-500 text-xs mt-0.5">User: <span className="text-zinc-400">{log.user}</span></div>
                    </div>
                    <span className="text-zinc-600 text-[10px] font-mono bg-zinc-900/50 px-2 py-1 rounded">{new Date(log.timestamp).toLocaleTimeString()}</span>
                  </div>
                )) : (
                  <div className="text-center text-zinc-500 py-8">
                    No audit logs available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeModule === 'persona' && (
          <div>
            <h2 className="text-2xl font-bold text-white mb-6 tracking-tight">Persona Configuration</h2>
            <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-6 shadow-lg">
              <h3 className="text-zinc-100 font-semibold mb-6 text-sm uppercase tracking-wider">Personality Traits</h3>
              <div className="space-y-6">
                {personality && Object.entries(personality).map(([trait, value]) => (
                  <div key={trait}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-zinc-300 capitalize font-medium">{trait}</span>
                      <span className="text-zinc-100 font-mono font-bold bg-zinc-800 px-2 py-0.5 rounded text-xs">{value}%</span>
                    </div>
                    <div className="relative w-full h-2 bg-zinc-800 rounded-full">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={value}
                        onChange={(e) => setPersonality({ ...personality, [trait]: parseInt(e.target.value) })}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      />
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-100"
                        style={{ width: `${value}%` }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg border-2 border-zinc-900 pointer-events-none transition-all duration-100"
                        style={{ left: `calc(${value}% - 8px)` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* DEFAULT FALLBACK */}
        {!['terminal', 'orb', 'kevin', 'simulation', 'core', 'arbiters', 'knowledge', 'analytics', 'storage', 'workflow', 'command', 'security', 'persona', 'mission_control', 'forecaster', 'marketplace'].includes(activeModule) && (
          <div className="flex items-center justify-center h-full text-zinc-600 italic">
            Integration for Module "{activeModule}" is ongoing...
          </div>
        )}
      </div>

      {/* Global SOMA Chat - Available on all tabs */}
      <FloatingChat isServerRunning={isConnected} isBusy={isSomaBusy} onSendMessage={handleFloatingChatMessage} />
    </div>
  );
};

export default SomaCommandBridge;
