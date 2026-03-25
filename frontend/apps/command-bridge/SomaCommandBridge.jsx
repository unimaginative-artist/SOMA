import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Activity, Brain, Zap, HardDrive, Wifi, CheckCircle,
  Archive, Workflow, Database, Play, Pause, RotateCw, Trash2,
  Plus, Network, Home, MessageSquare, Settings, Palette,
  Shield, User, Users, Lightbulb, ThermometerSun, ChevronLeft,
  ChevronRight, Sparkles, Terminal, Circle, BarChart3, Search, X, Clock,
  Download, TrendingUp, TrendingDown, Target, Server, Gauge, Mail, Mic,
  Box, Share2, DollarSign, CircleDollarSign
} from 'lucide-react';
import {
  LineChart, Line, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import somaBackend from './somaBackend';
import SomaCT from '../command-ct/SomaCT';
import Orb from './Orb';
import KevinInterface from './KevinInterface';
// import KnowledgeGraph3D from '../../command-bridge/KnowledgeGraph3D';

// Hooks & Components
import { useSomaAudio } from './hooks/useSomaAudio';
import { useRealtimeEvents } from './hooks/useRealtimeEvents';
import FloatingChat from './components/FloatingChat';
import MemoryTierMonitor from './components/MemoryTierMonitor';
import NeuralDissonanceMonitor from './components/NeuralDissonanceMonitor';
import EconomicSovereigntyMonitor from './components/EconomicSovereigntyMonitor';
import AutonomousActivityFeed from './components/AutonomousActivityFeed';
import SkillProficiencyRadar from './components/SkillProficiencyRadar';
import MindsEye from './components/MindsEye';
import BeliefNetworkViewer from './components/BeliefNetworkViewer';
import DreamInsights from './components/DreamInsights';
import TheoryOfMindPanel from './components/TheoryOfMindPanel';
import SystemDiagnosticsApp from './components/SystemDiagnosticsApp';
import SomaStatusStrip from './components/SomaStatusStrip';
import ProposedGoalModal from './components/ProposedGoalModal';
import SomaPlanViewer from './components/SomaPlanViewer';
import OnboardingWizard from './components/OnboardingWizard';
import ReasoningTree from './components/ReasoningTree';
import EmotionIndicator from './components/EmotionIndicator';
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
// import PulseInterface from './components/PulseInterface';
import PulseIDE from './components/pulse/App';
import FinanceModule from './components/FinanceModule';
import SocialModule from './components/SocialModule';
import ForecasterApp from './components/Forecaster/ForecasterApp';
import MissionControlApp from './components/MissionControl/MissionControlApp';
import KnowledgeApp from './components/Knowledge/KnowledgeApp';
import FileIntelligenceApp from './components/FileIntelligence/FileIntelligenceApp';
import ArbiteriumApp from './components/arbiterium/ArbiteriumApp';
// import FinanceModule from './components/FinanceModule';
import { generateId } from './lib/utils/id-generator';
import { FloatingPanel } from './components/ui/floating-panel';
import { SteveContextManager } from './lib/SteveContextManager';

import '../command-ct/styles/terminal.css';
import './styles/soma-ui-control.css';
import './styles/emotes.css';
import SettingsModule from './components/SettingsModule';
import CommandPalette from './components/CommandPalette';
import CharacterCard from './components/CharacterCard';
import CharacterGacha from './components/CharacterGacha';

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
                  <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold border ${(agent.status === 'active' || agent.status?.state === 'active')
                      ? 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20'
                      : 'bg-zinc-800 text-zinc-500 border-white/5'
                    }`}>
                    {typeof agent.status === 'object' ? (agent.status?.state || 'UNKNOWN') : agent.status}
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
  </div >
);

// ==========================================
// System Detail Modal (Real Metrics per Category)
// ==========================================
const SystemDetailModal = ({ metricId, systemMetrics, onClose }) => {
  const detail = systemMetrics.systemDetail || {};
  const titles = { cpu: 'CPU Details', gpu: 'GPU Details', ram: 'Memory Details', net: 'Network Details' };
  const icons = { cpu: Cpu, gpu: Zap, ram: HardDrive, net: Wifi };
  const colors = { cpu: 'blue', gpu: 'yellow', ram: 'purple', net: 'fuchsia' };
  const Icon = icons[metricId] || Activity;
  const color = colors[metricId] || 'blue';
  const [processes, setProcesses] = useState([]);
  const [gpuInfo, setGpuInfo] = useState([]);
  const [netAdapters, setNetAdapters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchProcesses = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await somaBackend.fetch('/api/system/processes');
      if (!data.success) throw new Error(data.error || 'Failed to load processes');
      setProcesses(data.processes || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchGpu = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await somaBackend.fetch('/api/system/gpu');
      if (!data.success) throw new Error(data.error || 'GPU telemetry unavailable');
      setGpuInfo(data.gpus || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchNetwork = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await somaBackend.fetch('/api/system/network');
      if (!data.success) throw new Error(data.error || 'Network telemetry unavailable');
      setNetAdapters(data.adapters || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4" onClick={onClose}>
      <div className="bg-[#151518] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl p-6" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6 border-b border-white/5 pb-4">
          <h3 className="text-xl font-bold text-white flex items-center">
            <Icon className={`w-5 h-5 mr-2 text-${color}-400`} /> {titles[metricId]}
          </h3>
          <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
          {metricId === 'cpu' && (
            <>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">Model</span>
                <span className="text-zinc-200 font-mono text-xs">{detail.cpu?.model || 'Unknown'}</span>
              </div>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">Cores</span>
                <span className="text-zinc-200 font-mono">{detail.cpu?.cores || 0}</span>
              </div>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">Overall Usage</span>
                <span className="text-zinc-200 font-mono font-bold">{detail.cpu?.usage || systemMetrics.cpu || 0}%</span>
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Per-Core Usage</div>
                <div className="grid grid-cols-4 gap-2">
                  {(detail.cpu?.perCore || []).map(c => (
                    <div key={c.core} className="bg-black/40 rounded-lg p-2 border border-white/5 text-center">
                      <div className="text-[9px] text-zinc-500 mb-1">Core {c.core}</div>
                      <div className="text-sm font-mono font-bold text-zinc-200">{c.usage}%</div>
                      <div className="w-full bg-zinc-800 rounded-full h-1 mt-1">
                        <div className="bg-blue-500 h-1 rounded-full transition-all" style={{ width: `${Math.min(100, c.usage)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mt-5">
                <button
                  onClick={fetchProcesses}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest rounded border border-blue-500/30 text-blue-300 hover:bg-blue-500/10 transition-colors"
                >
                  Load Top Processes
                </button>
                {loading && <div className="text-[10px] text-zinc-500 mt-2">Loadingâ€¦</div>}
                {error && <div className="text-[10px] text-rose-400 mt-2">{error}</div>}
                {processes.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {processes.map((p) => (
                      <div key={`${p.pid}-${p.name}`} className="bg-black/40 rounded-lg p-2 border border-white/5 flex justify-between items-center">
                        <div className="text-zinc-200 text-xs font-mono">{p.name} <span className="text-zinc-500">({p.pid})</span></div>
                        <div className="text-[10px] text-zinc-400 font-mono">CPU {p.cpu?.toFixed?.(1) || 0} | WS {p.workingSetMB} MB</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {metricId === 'gpu' && (
            <div className="space-y-3">
              <button
                onClick={fetchGpu}
                className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest rounded border border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 transition-colors"
              >
                Fetch GPU Telemetry
              </button>
              {loading && <div className="text-[10px] text-zinc-500">Loadingâ€¦</div>}
              {error && <div className="text-[10px] text-rose-400">{error}</div>}
              {gpuInfo.length === 0 && !loading && !error && (
                <div className="text-center py-6 text-zinc-500">
                  <Zap className="w-10 h-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">GPU monitoring requires NVIDIA drivers (nvidia-smi)</p>
                  <p className="text-xs text-zinc-600 mt-1">No GPU telemetry available at this time</p>
                </div>
              )}
              {gpuInfo.map((gpu, i) => (
                <div key={`${gpu.name}-${i}`} className="bg-black/40 rounded-lg p-3 border border-white/5">
                  <div className="text-zinc-200 text-xs font-mono mb-1">{gpu.name}</div>
                  <div className="text-[10px] text-zinc-400 font-mono">Utilization: {gpu.utilization}%</div>
                  <div className="text-[10px] text-zinc-400 font-mono">Memory: {gpu.memoryUsedMB} / {gpu.memoryTotalMB} MB</div>
                </div>
              ))}
            </div>
          )}

          {metricId === 'ram' && (
            <>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">Total System RAM</span>
                <span className="text-zinc-200 font-mono">{detail.memory?.totalGB || '?'} GB</span>
              </div>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">Used</span>
                <span className="text-zinc-200 font-mono">{detail.memory?.usedGB || '?'} GB</span>
              </div>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">Free</span>
                <span className="text-emerald-400 font-mono">{detail.memory?.freeGB || '?'} GB</span>
              </div>
              <div className="flex justify-between text-sm pb-2 border-b border-white/5">
                <span className="text-zinc-400">System Usage</span>
                <span className="text-zinc-200 font-mono font-bold">{detail.memory?.percentage || systemMetrics.ram || 0}%</span>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-2 mt-2 mb-4">
                <div className="bg-purple-500 h-2 rounded-full transition-all" style={{ width: `${Math.min(100, detail.memory?.percentage || systemMetrics.ram || 0)}%` }} />
              </div>
              <div className="mt-4">
                <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Node.js Process</div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-black/40 rounded-lg p-3 border border-white/5 text-center">
                    <div className="text-[9px] text-zinc-500 mb-1">RSS</div>
                    <div className="text-sm font-mono font-bold text-zinc-200">{detail.memory?.nodeRSS || 0} MB</div>
                  </div>
                  <div className="bg-black/40 rounded-lg p-3 border border-white/5 text-center">
                    <div className="text-[9px] text-zinc-500 mb-1">Heap Used</div>
                    <div className="text-sm font-mono font-bold text-zinc-200">{detail.memory?.nodeHeapUsed || 0} MB</div>
                  </div>
                  <div className="bg-black/40 rounded-lg p-3 border border-white/5 text-center">
                    <div className="text-[9px] text-zinc-500 mb-1">Heap Total</div>
                    <div className="text-sm font-mono font-bold text-zinc-200">{detail.memory?.nodeHeapTotal || 0} MB</div>
                  </div>
                </div>
              </div>
            </>
          )}

          {metricId === 'net' && (
            <>
              <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-3">Network Interfaces</div>
              {(detail.network?.interfaces || []).length > 0 ? (
                <div className="space-y-2">
                  {detail.network.interfaces.map((iface, i) => (
                    <div key={i} className="bg-black/40 rounded-lg p-3 border border-white/5 flex justify-between items-center">
                      <span className="text-zinc-300 text-sm font-medium">{iface.name}</span>
                      <span className="text-zinc-400 font-mono text-xs">{iface.addresses.join(', ')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-4 text-zinc-600 text-sm">No network interfaces detected</div>
              )}
              <div className="mt-4">
                <button
                  onClick={fetchNetwork}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-widest rounded border border-fuchsia-500/30 text-fuchsia-300 hover:bg-fuchsia-500/10 transition-colors"
                >
                  Fetch Adapter Stats
                </button>
                {loading && <div className="text-[10px] text-zinc-500 mt-2">Loadingâ€¦</div>}
                {error && <div className="text-[10px] text-rose-400 mt-2">{error}</div>}
                {netAdapters.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {netAdapters.map((adapter) => (
                      <div key={adapter.name} className="bg-black/40 rounded-lg p-3 border border-white/5 flex justify-between items-center">
                        <div className="text-zinc-300 text-xs font-medium">{adapter.name}</div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          RX {Math.round(adapter.receivedBytes / 1048576)} MB | TX {Math.round(adapter.sentBytes / 1048576)} MB
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ==========================================
// Main Command Bridge Component
// ==========================================
const SomaCommandBridge = () => {
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

  // --- ARBITERIUM BACKEND INTEGRATION ---
  const [arbiteriumLastMessage, setArbiteriumLastMessage] = useState(null);
  
  // Command Palette State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCharacterLabOpen, setIsCharacterLabOpen] = useState(false);

  // Command Palette Shortcut
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleChatResponse = (payload) => {
      // payload usually: { text: "...", source: "..." } or similar
      // If we don't have source filtering yet, just check if we are in Arbiterium module
      if (activeModule === 'arbiterium') {
        setArbiteriumLastMessage(payload); // payload might be the full object or just text
      }
    };

    somaBackend.on('chat_response', handleChatResponse);
    return () => {
      somaBackend.off('chat_response', handleChatResponse);
    };
  }, [activeModule]);

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
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('soma_onboarded'));

  // SOMA Status Strip State
  const [activeGoal, setActiveGoal] = useState('Monitor System Health');
  const [goalProgress, setGoalProgress] = useState(50); // Example: 0-100%
  const [tensionLevel, setTensionLevel] = useState(30); // Example: 0-100%
  const [lastToolUsed, setLastToolUsed] = useState('system_monitor');
  const [lastToolTimestamp, setLastToolTimestamp] = useState(Date.now());
  const [proposedGoals, setProposedGoals] = useState([]); // New state for proposed goals
  const [activeQuestion, setActiveQuestion] = useState(null); // New state for proactive questions

  // UI State
  const [showProcessModal, setShowProcessModal] = useState(false);
  const [showSystemDetail, setShowSystemDetail] = useState(null); // 'cpu' | 'gpu' | 'ram' | 'net' | null
  const [isSomaBusy, setIsSomaBusy] = useState(false);
  const backendInitialized = useRef(false);
  const networkSampleRef = useRef({ timestamp: 0, totalBytes: 0 });

  // REAL DATA STATE
  const [systemMetrics, setSystemMetrics] = useState({
    cpu: 0,
    gpu: null,
    ram: 0,
    network: null,
    uptime: 0,
    neuralLoad: { load1: 0, load5: 0, load15: 0 },
    contextWindow: { maxTokens: 1048576, used: 0, percentage: 0 }
  });
  const [systemCounts, setSystemCounts] = useState({ arbiters: 0, microAgents: 0, fragments: 0 });
  const [brainStats, setBrainStats] = useState(null);
  const [driveTension, setDriveTension] = useState(null);

  // Categorized Agent Swarm
  const [agents, setAgents] = useState([]);
  const [arbiters, setArbiters] = useState([]);
  const [fragments, setFragments] = useState([]);
  const [microAgents, setMicroAgents] = useState([]);

  const [cacheTiers, setCacheTiers] = useState(null);

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

  const [auditLogs, setAuditLogs] = useState([]);
  const [emergencyStop, setEmergencyStop] = useState(false);

  // Orb Module State
  const [orbConversation, setOrbConversation] = useState([]);
  const [activeReasoningTree, setActiveReasoningTree] = useState(null);
  const [orbSidebarCollapsed, setOrbSidebarCollapsed] = useState(false);

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

  const formatPercent = (value) => {
    return Number.isFinite(value) ? value.toFixed(1) : 'â€”';
  };

  const categorizeAgents = useCallback((rawAgents = []) => {
    const isArbiter = (agent) => {
      const type = String(agent?.type || '').toLowerCase();
      const name = String(agent?.name || '');
      return (
        type === 'arbiter' ||
        type.includes('arbiter') ||
        type.includes('manager') ||
        type.includes('worker') ||
        type.includes('engine') ||
        type.includes('coordinator') ||
        type.includes('evaluator') ||
        type.includes('runner') ||
        type.includes('learner') ||
        type.includes('predictor') ||
        type.includes('monitor') ||
        type.includes('spawner') ||
        type.includes('swarm') ||
        type.includes('cortex') ||
        type.includes('consolidation') ||
        type.includes('commit') ||
        type.includes('precision') ||
        type.includes('gradient') ||
        type.includes('pipeline') ||
        type.includes('bootstrap') ||
        type.includes('acquisition') ||
        name.includes('Arbiter') ||
        name.includes('Engine') ||
        name.includes('Pool')
      );
    };

    const isFragment = (agent) => {
      const type = String(agent?.type || '').toLowerCase();
      const name = String(agent?.name || '').toLowerCase();
      return type.includes('micro-brain') || name.includes('fragment');
    };

    const arbitersList = rawAgents.filter((a) => isArbiter(a) && !isFragment(a));
    const fragmentsList = rawAgents.filter((a) => isFragment(a));
    const microAgentsList = rawAgents.filter((a) => !arbitersList.includes(a) && !fragmentsList.includes(a));

    return { arbitersList, fragmentsList, microAgentsList };
  }, []);

  const isAgentActive = useCallback((agent) => {
    const status = String(agent?.status || agent?.health?.status || '').toLowerCase();
    return ['active', 'healthy', 'running', 'online', 'ready'].includes(status);
  }, []);

  const safePercent = (value) => {
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  };

  // ------------------------------------------
  // Hooks Integration
  // ------------------------------------------

  const handleOrbResponse = useCallback((response) => {
    setOrbConversation(prev => [...prev, {
      role: response.role,
      text: response.text,
      timestamp: response.timestamp || Date.now()
    }]);
    
    if (response.reasoningTree) {
      setActiveReasoningTree(response.reasoningTree);
    }
  }, []);

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
    sendTextQuery,
    somaHealthy,
    inputVolume
  } = useSomaAudio(handleOrbResponse);

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

  // 4. Chat history restoration removed - no active chat UI in Command Bridge
  // (Chat interface lives in individual modules like Arbiterium)

  // Fetch personality traits when backend connects
  useEffect(() => {
    if (!isConnected) return;
    fetch('/api/personality')
      .then(r => r.json())
      .then(data => { if (data.success && data.traits) setPersonality(data.traits); })
      .catch(() => {}); // Keep defaults on failure
  }, [isConnected]);

  useEffect(() => {
    // Only poll GPU/network when connected AND the dashboard is actually visible.
    // These queries wake hardware (nvidia-smi / WMI adapter stats), so running
    // them while the user is in a different module is pointless churn.
    if (!isConnected || activeModule !== 'core') return;

    let isMounted = true;
    const pollSystemTelemetry = async () => {
      try {
        const [gpuRes, netRes] = await Promise.allSettled([
          somaBackend.fetch('/api/system/gpu'),
          somaBackend.fetch('/api/system/network')
        ]);

        if (!isMounted) return;

        if (gpuRes.status === 'fulfilled' && gpuRes.value?.success && Array.isArray(gpuRes.value.gpus) && gpuRes.value.gpus.length > 0) {
          const avgUtil = gpuRes.value.gpus.reduce((sum, g) => sum + (Number(g.utilization) || 0), 0) / gpuRes.value.gpus.length;
          setSystemMetrics(prev => ({ ...prev, gpu: avgUtil }));
        }

        if (netRes.status === 'fulfilled' && netRes.value?.success && Array.isArray(netRes.value.adapters) && netRes.value.adapters.length > 0) {
          const now = Date.now();
          const totalBytes = netRes.value.adapters.reduce((sum, a) => sum + (Number(a.receivedBytes) || 0) + (Number(a.sentBytes) || 0), 0);
          const prevSample = networkSampleRef.current;

          if (prevSample.timestamp > 0 && now > prevSample.timestamp) {
            const deltaBytes = totalBytes - prevSample.totalBytes;
            const deltaSec = (now - prevSample.timestamp) / 1000;
            const bytesPerSec = deltaSec > 0 ? deltaBytes / deltaSec : 0;
            const networkLoad = Math.min(100, (bytesPerSec / (100 * 1024 * 1024)) * 100);
            setSystemMetrics(prev => ({ ...prev, network: networkLoad }));
          }

          networkSampleRef.current = { timestamp: now, totalBytes };
        }
      } catch {
        // Keep last known values
      }
    };

    pollSystemTelemetry();
    const interval = setInterval(pollSystemTelemetry, 30000); // 30s â€” hardware queries don't need sub-second freshness
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isConnected, activeModule]);

  // Persist personality changes to backend (debounced)
  const personalityTimerRef = useRef(null);
  const handleSetPersonality = (newTraits) => {
    setPersonality(newTraits);
    clearTimeout(personalityTimerRef.current);
    personalityTimerRef.current = setTimeout(() => {
      if (!isConnected) return;
      fetch('/api/personality', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ traits: newTraits })
      }).catch(() => {});
    }, 500);
  };

  // Fetch audit logs when backend connects
  useEffect(() => {
    if (!isConnected) return;
    fetch('/api/audit/logs?limit=50')
      .then(r => r.json())
      .then(data => { if (data.success && data.logs) setAuditLogs(data.logs); })
      .catch(() => {});
  }, [isConnected]);

  useEffect(() => {
    if (!isConnected) return;
    let active = true;

    const normalizeActivity = (item) => ({
      id: item.id || `${item.type}-${item.timestamp || Date.now()}`,
      type: item.status === 'failed' || item.status === 'denied' ? 'error'
        : item.status === 'completed' || item.status === 'approved' ? 'success'
          : 'info',
      message: `${item.agent || 'System'}: ${item.action || item.type || 'event'}${item.detail ? ` â€” ${item.detail}` : ''}`,
      timestamp: item.timestamp || Date.now()
    });

    const fetchActivity = async () => {
      try {
        const res = await somaBackend.fetch('/api/activity/recent?limit=80');
        if (!active || !res?.success || !Array.isArray(res.feed)) return;
        const incoming = res.feed.map(normalizeActivity);
        setActivityStream(prev => {
          const seen = new Set(prev.map(p => p.id));
          const merged = [...incoming.filter(i => !seen.has(i.id)), ...prev];
          return merged.slice(0, 120);
        });
      } catch {
        // Keep last known
      }
    };

    fetchActivity();
    const interval = setInterval(fetchActivity, 10000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [isConnected]);

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
        id: generateId('activity'),
        type: log.type || 'info',
        message: log.message,
        timestamp: log.timestamp || Date.now()
      }, ...prev].slice(0, 100));
    });

    somaBackend.on('goal_created', (payload) => {
      const { goal } = payload;
      if (goal && goal.status === 'proposed') {
        setProposedGoals(prev => {
          // Prevent duplicates if the event fires multiple times
          if (!prev.some(pg => pg.id === goal.id)) {
            toast.info(`ðŸ“ New Proposed Goal: ${goal.title}`, { theme: 'dark', autoClose: 8000 });
            return [...prev, goal];
          }
          return prev;
        });
      }
    });

    somaBackend.on('proactive_question', (payload) => {
      // payload will contain: questionId, question, options (optional), goalId (optional), type, context
      setActiveQuestion(payload);
      toast.info(`â“ SOMA has a question for you!`, { theme: 'dark', autoClose: 8000 });
      // Optionally, highlight the chat badge or open the chat
    });

    // --- NERVOUS SYSTEM: Unified Pulse Listener ---
    somaBackend.on('pulse', (payload) => {
      const { system, agents, brains, knowledge, events, neuralLoad, contextWindow, systemDetail, counts, currentGoal, goalProgress, tension } = payload;

      // Update SOMA Status Strip data
      if (currentGoal) setActiveGoal(currentGoal);
      if (goalProgress !== undefined) setGoalProgress(goalProgress);
      if (tension !== undefined) setTensionLevel(tension);

      // 1. Host Metrics
      if (system) {
        setSystemMetrics(prev => ({
          ...prev,
          cpu: system.cpu,
          ram: system.ram,
          uptime: system.uptime,
          neuralLoad: neuralLoad || prev.neuralLoad,
          contextWindow: contextWindow || prev.contextWindow,
          systemDetail: systemDetail || prev.systemDetail
        }));
      }

      // 2. Swarm Status
      if (agents) {
        setAgents(agents);
        const { arbitersList, fragmentsList, microAgentsList } = categorizeAgents(agents);
        setArbiters(arbitersList);
        setFragments(fragmentsList);
        setMicroAgents(microAgentsList);
      }

      // 3. Brain Activity
      if (brains) {
        setBrainStats(brains);
      }

      if (counts) {
        setSystemCounts(prev => ({ ...prev, ...counts }));
      }

      // 4. Knowledge Depth
      if (knowledge) {
        setKnowledgeNodes(prev => {
          // If the count has changed significantly, we could trigger a refresh
          // but for now we just use it for the counters
          return prev;
        });
      }

      // 5. System Events (Activity Feed)
      if (events && events.length > 0) {
        // Forward new events to activity log
        // (Avoiding duplicates based on ID)
      }
    });

          // Metrics Broadcaster (Legacy support)
        somaBackend.on('metrics', (message) => {
          const data = message.payload || message;
          
          if (data.brainStats) setBrainStats(data.brainStats);
    
          // Map System Health
        setSystemMetrics(prev => ({
          ...prev,
          cpu: data.cpu !== undefined ? data.cpu : prev.cpu,
          ram: data.ram !== undefined ? data.ram : prev.ram,
          gpu: data.gpu !== undefined ? data.gpu : prev.gpu,
          network: data.network !== undefined ? data.network : prev.network,
          uptime: data.uptime !== undefined ? data.uptime : prev.uptime,
          neuralLoad: data.neuralLoad || prev.neuralLoad,
          contextWindow: data.contextWindow || prev.contextWindow,
          systemDetail: data.systemDetail || prev.systemDetail
        }));

        if (data.counts) {
          setSystemCounts(prev => ({ ...prev, ...data.counts }));
        }

      // Map Swarm Data with Categorization
      if (data.agents) {
        const rawAgents = data.agents;
        setAgents(rawAgents);
        const { arbitersList, fragmentsList, microAgentsList } = categorizeAgents(rawAgents);
        setArbiters(arbitersList);
        setFragments(fragmentsList);
        setMicroAgents(microAgentsList);
      }

      // Drive tension (intrinsic motivation)
      if (data.drive?.tension != null) setDriveTension(data.drive.tension);

      // Map Memory System (HMS)
      if (data.cache) setCacheTiers(data.cache);

      // Cluster nodes available in data.nodes if needed
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
      if ((modal === 'Pulse' || modal === 'Form') && action === 'open') {
        console.log('[SomaCommandBridge] Opening Form Interface');
        setShowPulse(true);
      }
    });

    somaBackend.on('ui.notify', (msg) => {
      const { message, type } = msg.payload || msg;
      if (message) {
        toast[type || 'info'](message, { theme: 'dark' });
      }
    });

    somaBackend.on('soma_proactive', (payload) => {
      const text = payload.message || payload.text || String(payload);
      if (!text) return;
      toast.info(`ðŸ’œ SOMA: ${text.substring(0, 100)}${text.length > 100 ? 'â€¦' : ''}`, { theme: 'dark', autoClose: 8000 });
      setActivityStream(prev => [
        { id: Date.now(), type: 'info', message: `[Autonomous] ${text}`, timestamp: Date.now() },
        ...prev.slice(0, 49)
      ]);
    });

    somaBackend.on('soma_activity', (payload) => {
      const { source, description, output, status } = payload;
      if (status !== 'ok') return;

      // Update SOMA Status Strip for last tool used
      if (source) {
        setLastToolUsed(source);
        setLastToolTimestamp(Date.now());
      }

      const summary = output
        ? `[${source}] ${description} â†’ ${output.substring(0, 120)}`
        : `[${source}] ${description}`;
      setActivityStream(prev => [
        { id: Date.now(), type: 'success', message: summary, timestamp: Date.now() },
        ...prev.slice(0, 49)
      ]);
    });

    somaBackend.connect();

    return () => {
      somaBackend.disconnect();
    };
  }, []);

  // ------------------------------------------
  // RESTORED EFFECTS (Cognitive & SLC)
  // ------------------------------------------

  // ------------------------------------------
  // UNIFIED TELEMETRY (Merged Polling)
  // ------------------------------------------
  useEffect(() => {
    if (!isConnected) return;

    const pollSystemData = async () => {
      try {
        // 1. Poll SLC
        const slcRes = await fetch('/api/slc/status');
        if (slcRes.ok) {
          const data = await slcRes.json();
          setSlcStats({
            brainA: data.brainA || { name: 'Prometheus', status: 'offline' },
            brainB: data.brainB || { name: 'Aurora', status: 'offline' },
            brainC: data.brainC || { name: 'Logos', status: 'offline' },
            lastQuery: data.lastQuery,
            totalQueries: data.totalQueries || 0
          });
        }

        // 2. Analytics Summary (Only if needed)
        const summaryRes = await somaBackend.fetch('/api/analytics/summary');
        if (summaryRes?.success) {
          setAnalyticsSummary(prev => {
            setPreviousSummary(prev);
            return summaryRes.summary;
          });
        }

        // 3. Velocity Status
        const velRes = await fetch('/api/velocity/status');
        if (velRes.ok) {
          const data = await velRes.json();
          setPerformanceMetrics(prev => {
            if (!Array.isArray(prev)) return prev;
            return prev.map(m => {
              if (m.metric === 'Velocity') return { ...m, value: Math.min(100, (data.velocity || 0) * 50) };
              return m;
            });
          });
        }
      } catch (e) {
        console.warn('[Telemetry] Unified poll failed:', e.message);
      }
    };

    const pollKnowledgeData = async () => {
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
                if (sourceNode && targetNode) return { source: sourceNode.position, target: targetNode.position, color: e.color || '#444' };
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
      } catch (e) {
        console.warn('[Telemetry] Knowledge sync failed');
      }
    };

    pollSystemData();
    pollKnowledgeData();

    const systemInterval = setInterval(pollSystemData, 30000); // Slower 30s heartbeat (Pulse handles real-time)
    const knowledgeInterval = setInterval(pollKnowledgeData, 120000); // Slower 2m knowledge refresh

    return () => {
      clearInterval(systemInterval);
      clearInterval(knowledgeInterval);
    };
  }, [isConnected]);

  // Connect to Cognitive Engine WebSocket
  useEffect(() => {
    if (activeModule !== 'cognitive') return;

    const connectCognitiveWs = () => {
      try {
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsHost = window.location.host;
        const ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/cognitive`);
        cognitiveWsRef.current = ws;

        ws.onopen = () => {
          setCognitiveWsConnected(true);
          toast.success('âš¡ Real-time cognitive streaming enabled', { theme: 'dark' });
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
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
                toast.info(`ðŸ’­ Thought complete: ${(data.data.confidence * 100).toFixed(1)}% confidence`, { theme: 'dark', autoClose: 2000 });
              }
            } else if (data.event === 'perception.low_confidence') {
              toast.warn(`âš ï¸ Low confidence from ${data.data.actor}`, { theme: 'dark' });
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

  // Analytics data fetching (Periodic but slower)
  useEffect(() => {
    if (!isConnected) return;

    const fetchSlowAnalytics = async () => {
      try {
        const metricsRes = await somaBackend.fetch(`/api/analytics/learning-metrics?range=${analyticsTimeRange}`);
        const learningData = metricsRes?.data || metricsRes?.metrics;
        if (metricsRes?.success && Array.isArray(learningData)) setLearningMetrics(learningData);

        const perfRes = await somaBackend.fetch('/api/analytics/performance');
        const perfData = perfRes?.metrics || perfRes?.performance;
        if (perfRes?.success && Array.isArray(perfData)) setPerformanceMetrics(perfData);

        const memRes = await somaBackend.fetch(`/api/analytics/memory-usage?range=${analyticsTimeRange}`);
        if (memRes?.success && Array.isArray(memRes.data)) setMemoryUsageData(memRes.data);

        const arbiterRes = await somaBackend.fetch(`/api/analytics/arbiter-activity?range=${analyticsTimeRange}`);
        if (arbiterRes?.success && Array.isArray(arbiterRes.data)) setArbiterActivityData(arbiterRes.data);
      } catch (err) {}
    };

    fetchSlowAnalytics();
    const interval = setInterval(fetchSlowAnalytics, 20000);
    return () => clearInterval(interval);
  }, [isConnected, analyticsTimeRange]);

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
      id: generateId('activity'),
      type: type,
      message: message,
      timestamp: Date.now()
    }, ...prev].slice(0, 100));
  };

  const executeCommand = async (action, label, type = 'info') => {
    addActivityLog(type, `Command sent: ${label}`);
    try {
      const res = await somaBackend.fetch('/api/command', {
        method: 'POST',
        body: JSON.stringify({ action })
      });
      if (res?.success) {
        addActivityLog('success', `${label}: ${res.message || 'OK'}`);
      } else {
        addActivityLog('error', `${label}: ${res?.error || res?.message || 'Failed'}`);
      }
    } catch (e) {
      addActivityLog('error', `${label}: ${e.message}`);
    }
  };

  useEffect(() => {
    const handleTrace = (payload) => {
      if (!payload) return;
      const phase = payload.phase || 'trace';
      const tool = payload.tool ? ` ${payload.tool}` : '';
      const count = payload.count != null ? ` (${payload.count})` : '';
      const msg = payload.preview ? ` â€” ${payload.preview}` : '';
      addActivityLog('info', `[${phase}]${tool}${count}${msg}`);
    };
    somaBackend.on('trace', handleTrace);
    return () => somaBackend.off('trace', handleTrace);
  }, []);

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

  const handleFloatingChatMessage = async (message, { history = [], activeModule: page } = {}) => {
    try {
      const data = await somaBackend.fetch('/api/query', {
        method: 'POST',
        body: JSON.stringify({
          query: message,
          context: {
            source: 'floating-chat',
            page: page || activeModule,           // what tab the user is on
            history,                              // last 6 exchanges for continuity
          }
        })
      });
      if (data && data.response) {
        return {
          text: data.response,
          characterSuggestion: data.characterSuggestion || null,
          activeCharacter: data.activeCharacter || null,
        };
      }
    } catch (error) {
      toast.error('Neural Link communication failure');
    }
    return null;
  };

  const handleApproveGoal = useCallback(async (goalId) => {
    try {
      await somaBackend.sendMessage({
        from: 'SomaCommandBridge',
        to: 'GoalPlannerArbiter',
        type: 'approve_goal',
        payload: { goalId }
      });
      toast.success('Goal Approved!', { theme: 'dark' });
      setProposedGoals(prev => prev.filter(goal => goal.id !== goalId));
    } catch (error) {
      console.error('Failed to approve goal:', error);
      toast.error('Failed to approve goal', { theme: 'dark' });
    }
  }, []);

  const handleRejectGoal = useCallback(async (goalId, reason = 'User rejected') => {
    try {
      await somaBackend.sendMessage({
        from: 'SomaCommandBridge',
        to: 'GoalPlannerArbiter',
        type: 'reject_goal',
        payload: { goalId, reason }
      });
      toast.info('Goal Rejected', { theme: 'dark' });
      setProposedGoals(prev => prev.filter(goal => goal.id !== goalId));
    } catch (error) {
      console.error('Failed to reject goal:', error);
      toast.error('Failed to reject goal', { theme: 'dark' });
    }
  }, []);

  const handleSendQuestionResponse = useCallback(async (questionId, response) => {
    try {
      await somaBackend.sendMessage({
        from: 'SomaCommandBridge',
        to: 'GoalPlannerArbiter', // Assuming GoalPlannerArbiter processes the question
        type: 'question_response',
        payload: { questionId, response }
      });
      toast.success('Response sent to SOMA!', { theme: 'dark' });
      setActiveQuestion(null); // Clear the active question after response
    } catch (error) {
      console.error('Failed to send question response:', error);
      toast.error('Failed to send response', { theme: 'dark' });
    }
  }, []);

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

  const handleArbiteriumSend = (message) => {
    let text = message;
    let deepThinking = false;

    if (typeof message === 'object' && message !== null) {
      text = message.text;
      deepThinking = message.deepThinking || false;
    }

    if (!text || !text.trim()) return;

    // Send to backend with source context and deepThinking flag
    somaBackend.sendChat(text, {
      source: 'arbiterium',
      deepThinking
    });

    // Optimistically log to system
    addActivityLog('info', `Arbiterium Command: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''} ${deepThinking ? '(Deep Thinking)' : ''}`);
  };

  const activeArbiters = arbiters.filter(isAgentActive).length;
  const activeMicroAgents = microAgents.filter(isAgentActive).length;
  const totalArbiters = Number.isFinite(systemCounts?.arbiters) && systemCounts.arbiters > 0 ? systemCounts.arbiters : arbiters.length;
  const totalMicroAgents = Number.isFinite(systemCounts?.microAgents) && systemCounts.microAgents > 0 ? systemCounts.microAgents : microAgents.length;
  const totalFragments = Number.isFinite(systemCounts?.fragments) && systemCounts.fragments > 0 ? systemCounts.fragments : fragments.length;

  // ------------------------------------------
  // Main Render
  // ------------------------------------------
  return (
    <div className="flex h-screen ct-background text-zinc-200 font-sans selection:bg-white/20">
      {showOnboarding && <OnboardingWizard onComplete={() => setShowOnboarding(false)} />}
      {showProcessModal && <ProcessMonitor agents={agents} onClose={() => setShowProcessModal(false)} />}
      {showSystemDetail && <SystemDetailModal metricId={showSystemDetail} systemMetrics={systemMetrics} onClose={() => setShowSystemDetail(null)} />}
      <SystemDiagnosticsApp
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        somaBackend={somaBackend}
        diagnosticLogs={diagnosticLogs}
        isConnected={isConnected}
      />
      {showPulse && (
        <div className="fixed inset-0 z-[200]">
          <PulseIDE onClose={() => setShowPulse(false)} />
        </div>
      )}
      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(module) => {
          setActiveModule(module);
          setIsCommandPaletteOpen(false);
        }}
        onExecute={(action) => {
          somaBackend.send('command', { action });
          setIsCommandPaletteOpen(false);
        }}
      />
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
            <p className="text-zinc-600 text-[9px] font-mono uppercase tracking-[0.2em]">Bridge Terminal v7.4</p>
            </>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-0.5">
          {[
            { id: 'core', label: 'Core System', icon: Cpu, color: 'blue' },
            { id: 'command', label: 'Command Center', icon: Activity, color: 'fuchsia' },
            { id: 'terminal', label: 'SOMA CT', icon: Terminal, color: 'amber' },
            { id: 'orb', label: 'SOMA Orb', icon: Circle, color: 'purple' },
            { id: 'kevin', label: 'K.E.V.I.N.', icon: Mail, color: 'red' },

            { id: 'simulation', label: 'Simulation', icon: Box, color: 'orange' },

            { id: 'plan', label: "SOMA's Plan", icon: Target, color: 'violet' },
            { id: 'analytics', label: 'Analytics', icon: BarChart3, color: 'indigo' },
            { id: 'forecaster', label: 'Forecaster', icon: TrendingUp, color: 'indigo' },
            { id: 'mission_control', label: 'Mission Control', icon: CircleDollarSign, color: 'rose' },
            { id: 'storage', label: 'Storage', icon: HardDrive, color: 'blue' },
            { id: 'knowledge', label: 'Knowledge', icon: Brain, color: 'cyan' },
            { id: 'workflow', label: 'Workflow', icon: Workflow, color: 'lime' },
            { id: 'settings', label: 'Settings', icon: Settings, color: 'stone' },
            { id: 'arbiterium', label: 'Arbiterium', icon: Zap, color: 'fuchsia' },
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
        {/* SOMA Status Strip */}
        <SomaStatusStrip
          activeGoal={activeGoal}
          goalProgress={goalProgress}
          tensionLevel={tensionLevel}
          lastToolUsed={lastToolUsed}
          lastToolTimestamp={lastToolTimestamp}
          isSomaBusy={isSomaBusy}
          isConnected={isConnected}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col ${['terminal', 'orb', 'mission_control', 'knowledge'].includes(activeModule) ? 'overflow-hidden' : 'overflow-y-auto p-6'}`}>

        {/* CORE SYSTEM MODULE */}
        {activeModule === 'core' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-white mb-4 tracking-tight">Core System</h2>

            {/* Metric Grid */}
            <div className="grid grid-cols-4 gap-4">
                {[
                  { id: 'cpu', label: 'CPU Usage', val: systemMetrics.cpu, icon: Cpu, color: 'blue' },
                  { id: 'gpu', label: 'GPU Load', val: systemMetrics.gpu, icon: Zap, color: 'yellow' },
                  { id: 'ram', label: 'Memory', val: systemMetrics.ram, icon: HardDrive, color: 'purple' },
                  { id: 'net', label: 'Network', val: systemMetrics.network, icon: Wifi, color: 'fuchsia' },
                ].map(m => (
                  <div key={m.id} className="card-wrapper p-[1px]">
                    <div onClick={() => setShowSystemDetail(m.id)} className="card-inner p-5 flex flex-col justify-between cursor-pointer">
                      <div className="flex items-center justify-between">
                        <div className={`p-2 rounded-lg bg-${m.color}-500/10 group-hover:bg-${m.color}-500/20 transition-colors`}>
                          <m.icon className={`w-6 h-6 text-${m.color}-400`} />
                        </div>
                        <div className="text-2xl font-bold text-zinc-100 font-mono truncate">
                          {formatPercent(m.val)}{Number.isFinite(m.val) ? '%' : ''}
                        </div>
                      </div>
                      <div className="text-zinc-500 text-[10px] font-bold mt-3 uppercase tracking-widest truncate">{m.label}</div>
                      <div className="w-full bg-zinc-800/50 rounded-full h-1 mt-3 overflow-hidden">
                        <div className={`bg-${m.color}-500 h-1 rounded-full transition-all duration-700`} style={{ width: `${safePercent(m.val)}%` }} />
                      </div>
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
                        {Number.isFinite(systemMetrics.neuralLoad?.load1) ? systemMetrics.neuralLoad.load1.toFixed(2) : '--'},
                        {Number.isFinite(systemMetrics.neuralLoad?.load5) ? systemMetrics.neuralLoad.load5.toFixed(2) : '--'},
                        {Number.isFinite(systemMetrics.neuralLoad?.load15) ? systemMetrics.neuralLoad.load15.toFixed(2) : '--'}
                      </span>
                    </div>
                    {driveTension !== null && (
                      <div className="flex justify-between text-xs pb-2 border-b border-white/5">
                        <span className="text-zinc-500">Drive Tension</span>
                        <span className={`font-mono font-bold ${driveTension >= 0.7 ? 'text-red-400' : driveTension >= 0.4 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {(driveTension * 100).toFixed(0)}%{driveTension >= 0.7 ? ' ðŸ”´' : driveTension >= 0.4 ? ' ðŸŸ¡' : ' ðŸŸ¢'}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs pb-2 border-b border-white/5">
                      <span className="text-zinc-500">Primary Node</span>
                      <span className="text-fuchsia-400 font-bold uppercase tracking-tighter">ONLINE (LOCAL)</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Context Window</span>
                      <span className="text-zinc-200 font-mono">
                        {((systemMetrics.contextWindow?.used || 0) / 1000).toFixed(0)}K / {((systemMetrics.contextWindow?.maxTokens || 1048576) / 1000).toFixed(0)}K
                        <span className="text-zinc-500 ml-1">({Number.isFinite(systemMetrics.contextWindow?.percentage) ? systemMetrics.contextWindow.percentage.toFixed(1) : '0.0'}%)</span>
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
              <NeuralDissonanceMonitor isConnected={isConnected} />
              <EconomicSovereigntyMonitor isConnected={isConnected} />
              <AutonomousActivityFeed isConnected={isConnected} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <BeliefNetworkViewer isConnected={isConnected} />
              <DreamInsights isConnected={isConnected} />
            </div>

            <div className="grid grid-cols-3 gap-6">
              <TheoryOfMindPanel isConnected={isConnected} />
              <div className="col-span-2">
                <MindsEye isConnected={isConnected} />
              </div>
            </div>
          </div>
        )}

        {/* TERMINAL MODULE */}
        {activeModule === 'terminal' && <div className="flex-1 h-full"><SomaCT /></div>}

        {/* ORB MODULE */}
        {activeModule === 'orb' && (
          <div className="flex h-full w-full bg-black relative overflow-hidden">
            {/* Background Effect */}
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-900/10 via-black to-black pointer-events-none" />
            
            {/* Left Sidebar: Conversation & Emotions */}
            <motion.div 
              initial={false}
              animate={{ width: orbSidebarCollapsed ? 0 : 320, opacity: orbSidebarCollapsed ? 0 : 1 }}
              transition={{ duration: 0.4, ease: "easeInOut" }}
              className="border-r border-white/5 flex flex-col bg-zinc-900/20 backdrop-blur-sm relative z-20 overflow-hidden"
            >
              <div className="w-80 flex flex-col h-full">
                <div className="p-6 border-b border-white/5">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em] mb-4">Neural Session</h3>
                  <EmotionIndicator 
                    isTalking={isTalking} 
                    isThinking={isThinking} 
                    isConnected={isOrbConnected} 
                  />
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-4">
                  {orbConversation.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-zinc-600 opacity-50 px-4 text-center">
                      <MessageSquare className="w-8 h-8 mb-3" />
                      <p className="text-xs">No active transmission logs. Establish link to begin.</p>
                    </div>
                  ) : (
                    orbConversation.map((msg, idx) => (
                      <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                        <div className={`max-w-[90%] p-3 rounded-2xl text-sm ${
                          msg.role === 'user' 
                            ? 'bg-blue-500/10 border border-blue-500/20 text-blue-100 rounded-tr-none' 
                            : 'bg-purple-500/10 border border-purple-500/20 text-purple-100 rounded-tl-none'
                        }`}>
                          {msg.text}
                        </div>
                        <span className="text-[8px] text-zinc-600 mt-1 uppercase font-mono tracking-tighter">
                          {msg.role === 'user' ? 'Human' : 'SOMA'} â€¢ {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </div>
                    ))
                  )}
                </div>

                {orbConversation.length > 0 && (
                  <div className="p-4 border-t border-white/5">
                    <button 
                      onClick={() => setOrbConversation([])}
                      className="w-full py-2 text-[10px] text-zinc-500 hover:text-zinc-300 uppercase tracking-widest transition-colors"
                    >
                      Clear Session Logs
                    </button>
                  </div>
                )}
              </div>
            </motion.div>

            {/* Collapse Toggle Button (Cute SOMA Logo Style) */}
            <div className="absolute top-8 left-8 z-30">
              <button 
                onClick={() => setOrbSidebarCollapsed(!orbSidebarCollapsed)}
                className={`p-2.5 rounded-full border transition-all duration-500 group relative ${
                  orbSidebarCollapsed 
                    ? 'bg-purple-500/10 border-purple-500/30 text-purple-400 hover:bg-purple-500/20' 
                    : 'bg-white/5 border-white/10 text-zinc-500 hover:text-white'
                }`}
                title={orbSidebarCollapsed ? "Expand Neural Session" : "Collapse Neural Session"}
              >
                <div className={`absolute inset-0 rounded-full bg-purple-500/20 blur-md transition-opacity duration-500 ${orbSidebarCollapsed ? 'opacity-100 animate-pulse' : 'opacity-0'}`} />
                <Brain className={`w-5 h-5 relative z-10 transition-transform duration-500 ${orbSidebarCollapsed ? 'scale-110 rotate-[360deg]' : 'group-hover:rotate-12'}`} />
                {orbSidebarCollapsed && (
                  <span className="absolute left-full ml-3 px-2 py-1 bg-black/80 border border-white/10 rounded text-[9px] text-purple-300 uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    Session Logs
                  </span>
                )}
              </button>
            </div>

            {/* Center: The Orb */}
            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
              <div className="h-[400px] w-full flex items-center justify-center">
                <Orb volume={volume} isActive={isOrbConnected} isTalking={isTalking} isListening={isListening} isThinking={isThinking} />
              </div>

              <div className="mt-8 flex flex-col items-center gap-4 w-full max-w-xl px-10">
                {/* Neural Link Button */}
                <button
                  className={`px-10 py-3 rounded-full font-bold uppercase tracking-[0.2em] text-xs transition-all shadow-lg ${isOrbConnected 
                    ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/30' 
                    : 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30 hover:bg-fuchsia-500/30'
                  }`}
                  onClick={() => isOrbConnected ? disconnectOrb() : connectOrb()}
                >
                  {isOrbConnected ? 'â— Disengage Neural Link' : 'â—‹ Establish Neural Link'}
                </button>

                {/* Manual Input Field */}
                {isOrbConnected && (
                  <div className="w-full bg-white/5 border border-white/10 rounded-2xl p-2 flex items-center gap-2 focus-within:border-purple-500/50 transition-all">
                    <input
                      type="text"
                      placeholder="Transmit manual command..."
                      className="flex-1 bg-transparent border-none outline-none px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          const query = e.target.value.trim();
                          e.target.value = '';
                          if (window.somaTextQuery) window.somaTextQuery(query);
                        }
                      }}
                    />
                    <button
                      onClick={(e) => {
                        const input = e.target.closest('div').querySelector('input');
                        const query = input.value.trim();
                        if (query) {
                          input.value = '';
                          if (window.somaTextQuery) window.somaTextQuery(query);
                        }
                      }}
                      className="p-2 bg-purple-500/20 hover:bg-purple-500/40 text-purple-400 rounded-xl transition-all"
                    >
                      <Zap className="w-4 h-4" />
                    </button>
                  </div>
                )}
                
                <p className="text-[9px] text-zinc-600 uppercase tracking-widest">
                  {isListening ? 'SOMA is listening...' : isThinking ? 'Processing neural patterns...' : isTalking ? 'SOMA is responding...' : 'Neural interface standby'}
                </p>
              </div>
            </div>

            {/* Far Right: Status Indicators */}
            <div className="absolute top-8 right-8 z-50 flex flex-col items-end space-y-3 pointer-events-none">
              <div className="flex items-center space-x-3 mb-2 pointer-events-auto">
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">User Mic</span>
                  <div className="h-1 w-24 bg-white/5 rounded-full mt-1 overflow-hidden border border-white/5">
                    <div 
                      className="h-full bg-gradient-to-r from-blue-500 to-fuchsia-500 transition-all duration-75"
                      style={{ width: `${Math.max(2, inputVolume * 100)}%`, opacity: isOrbConnected ? 1 : 0.2 }}
                    />
                  </div>
                </div>
                <div className={`p-2 rounded-full border ${inputVolume > 0.2 ? 'border-fuchsia-500/50 bg-fuchsia-500/10' : 'border-white/5 bg-white/5'} transition-all`}>
                  <Mic className={`w-4 h-4 ${inputVolume > 0.2 ? 'text-fuchsia-400' : 'text-zinc-600'}`} />
                </div>
              </div>

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
                </div>
              ))}
            </div>

            {/* Right Sidebar: Reasoning Tree (Absolute overlay) */}
            <AnimatePresence>
              {activeReasoningTree && (
                <motion.div 
                  initial={{ x: '100%', opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: '100%', opacity: 0 }}
                  transition={{ duration: 0.5, ease: "anticipate" }}
                  className="absolute top-0 right-0 bottom-0 w-[400px] border-l border-white/5 flex flex-col bg-zinc-950/90 backdrop-blur-xl z-40 shadow-2xl"
                >
                  <div className="p-6 flex-1 overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em]">Metacognitive Path</h3>
                      <button onClick={() => setActiveReasoningTree(null)} className="text-zinc-600 hover:text-white p-1 hover:bg-white/5 rounded-full transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                      <ReasoningTree tree={activeReasoningTree} />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
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
                  {(currentThought || thoughtHistory[0]) && (() => {
                    const thought = currentThought || thoughtHistory[0];
                    if (!thought || !thought.rounds) return null;
                    return (
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
                            {((thought.confidence || 0) * 100).toFixed(1)}% CONFIDENCE
                          </span>
                        </div>
                      </div>

                      <div className="bg-black/40 rounded-lg p-3 border border-white/5 mb-4">
                        <p className="text-xs text-zinc-400 mb-1 uppercase font-bold tracking-tighter opacity-50">Query Input</p>
                        <p className="text-sm text-zinc-200">{thought.input_text}</p>
                      </div>

                      <div className="space-y-3">
                        {thought.rounds.map((round, idx) => (
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
                      {thought.final_output && (
                        <div className="mt-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                          <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Final Cognitive Result</p>
                          <p className="text-sm text-zinc-200 italic">"{thought.final_output.text}"</p>
                        </div>
                      )}
                    </div>
                    );
                  })()}

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





        {/* PLAN MODULE */}
        {activeModule === 'plan' && (
          <div className="h-full">
            <SomaPlanViewer isConnected={isConnected} />
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
                        <Area name="RSS" type="monotone" dataKey="rss" stroke="#06b6d4" fill="none" strokeWidth={1} strokeDashDasharray="5 5" />
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

        {/* FORECASTER MODULE */}
        {activeModule === 'forecaster' && <ForecasterApp />}

        {/* MISSION CONTROL MODULE */}
        {activeModule === 'mission_control' && <MissionControlApp somaBackend={somaBackend} isConnected={isConnected} />}

        {/* ARBITERIUM MODULE */}
        {activeModule === 'arbiterium' && <ArbiteriumApp
          systemArbiters={Array.from(new Map([...arbiters, ...microAgents].map(a => [a.name, a])).values())}
          onToggleArbiter={toggleAgentStatus}
          onRestartArbiter={restartAgent}
          onSendMessage={handleArbiteriumSend}
          lastSystemResponse={arbiteriumLastMessage}
        />}

        {/* FINANCE MODULE - DEPRECATED/MERGED INTO MISSION CONTROL */}
        {/* {activeModule === 'finance' && <FinanceModule />} */}

        {/* STORAGE / FILE INTELLIGENCE MODULE */}
        {activeModule === 'storage' && <FileIntelligenceApp />}

        {/* KNOWLEDGE MODULE */}
        {activeModule === 'knowledge' && <KnowledgeApp brainStats={brainStats} />}


        {/* WORKFLOW MODULE */}
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
                  <MessageSquare className="w-3 h-3 mr-1" /> S.T.E.V.E.
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
                        onClick={() => setActiveWorkflowId(w.id)}
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
                  executeCommand('start_all', 'Start All Agents');
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
                  executeCommand('stop_all', 'Pause All Agents');
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
                  executeCommand('reset_system', 'Reset System', 'warning');
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
                  <div className="card-wrapper p-[1px]">
                    <button
                      onClick={() => {
                        executeCommand('run_diagnostics', 'System Diagnostics');
                        setShowDiagnostics(true);
                        setDiagnosticLogs([]); // Clear previous logs
                      }}
                      className="card-inner p-4 shadow-lg flex flex-col h-full text-left group"
                    >
                      <div className="p-2.5 rounded-lg bg-blue-500/10 w-fit mb-3 group-hover:bg-blue-500/20 transition-colors">
                        <Search className="w-5 h-5 text-blue-400" />
                      </div>
                      <div className="text-zinc-200 font-semibold text-sm">System Diagnostics</div>
                      <div className="text-zinc-500 text-xs mt-1">Run full health check</div>
                    </button>
                  </div>

                  <div className="card-wrapper p-[1px]">
                    <button
                      onClick={() => executeCommand('clear_cache', 'Clear Cache')}
                      className="card-inner p-4 shadow-lg flex flex-col h-full text-left group"
                    >
                      <div className="p-2.5 rounded-lg bg-amber-500/10 w-fit mb-3 group-hover:bg-amber-500/20 transition-colors">
                        <Trash2 className="w-5 h-5 text-amber-400" />
                      </div>
                      <div className="text-zinc-200 font-semibold text-sm">Clear Cache</div>
                      <div className="text-zinc-500 text-xs mt-1">Free up memory resources</div>
                    </button>
                  </div>

                  <div className="card-wrapper p-[1px]">
                    <button
                      onClick={() => executeCommand('create_backup', 'Create Backup')}
                      className="card-inner p-4 shadow-lg flex flex-col h-full text-left group"
                    >
                      <div className="p-2.5 rounded-lg bg-fuchsia-500/10 w-fit mb-3 group-hover:bg-fuchsia-500/20 transition-colors">
                        <Database className="w-5 h-5 text-fuchsia-400" />
                      </div>
                      <div className="text-zinc-200 font-semibold text-sm">Create Backup</div>
                      <div className="text-zinc-500 text-xs mt-1">Snapshot current state</div>
                    </button>
                  </div>

                  <div className="card-wrapper p-[1px]">
                    <button
                      onClick={() => executeCommand('optimize_system', 'Optimize System')}
                      className="card-inner p-4 shadow-lg flex flex-col h-full text-left group"
                    >
                      <div className="p-2.5 rounded-lg bg-purple-500/10 w-fit mb-3 group-hover:bg-purple-500/20 transition-colors">
                        <Zap className="w-5 h-5 text-purple-400" />
                      </div>
                      <div className="text-zinc-200 font-semibold text-sm">Optimize System</div>
                      <div className="text-zinc-500 text-xs mt-1">Tune performance metrics</div>
                    </button>
                  </div>
                </div>

              </div>

              <div className="bg-[#151518]/60 backdrop-blur-md border border-white/5 rounded-xl p-5 shadow-lg col-span-2">
                <h3 className="text-zinc-100 font-semibold mb-4 text-sm uppercase tracking-wider">System Status</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="text-zinc-400 text-sm">Arbiters</span>
                    <span className="text-zinc-100 font-mono font-bold">
                      {activeArbiters}/{totalArbiters}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="text-zinc-400 text-sm">Micro-Agents</span>
                    <span className="text-zinc-100 font-mono font-bold">
                      {activeMicroAgents}/{totalMicroAgents}
                    </span>
                  </div>
                  <div className="flex items-center justify-between pb-3 border-b border-white/5">
                    <span className="text-zinc-400 text-sm">Knowledge Fragments</span>
                    <span className="text-zinc-100 font-mono font-bold">{totalFragments}</span>
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

        {activeModule === 'settings' && (
          <SettingsModule
            somaBackend={somaBackend}
            personality={personality}
            setPersonality={handleSetPersonality}
            emergencyStop={emergencyStop}
            setEmergencyStop={setEmergencyStop}
            auditLogs={auditLogs}
            arbiters={arbiters}
            isConnected={isConnected}
          />
        )}

        {/* FORECASTER MODULE */}
        {activeModule === 'forecaster' && (
          <div className="flex-1 h-full overflow-hidden">
            <ForecasterApp />
          </div>
        )}

        {/* DEFAULT FALLBACK */}
        {!['terminal', 'orb', 'kevin', 'simulation', 'core', 'arbiters', 'knowledge', 'analytics', 'storage', 'workflow', 'command', 'settings', 'mission_control', 'forecaster', 'marketplace', 'finance', 'arbiterium', 'plan'].includes(activeModule) && (
          <div className="flex items-center justify-center h-full text-zinc-600 italic">
            Integration for Module "{activeModule}" is ongoing...
          </div>
        )}
      </div>

      {/* Global SOMA Chat - Available on all tabs except terminal */}
      {activeModule !== 'terminal' && (
        <FloatingChat
          isServerRunning={isConnected}
          isBusy={isSomaBusy}
          onSendMessage={handleFloatingChatMessage}
          activeModule={activeModule}
          activeQuestion={activeQuestion}
          onSendQuestionResponse={handleSendQuestionResponse}
          tensionLevel={tensionLevel}
        />
      )}

      {proposedGoals.length > 0 && (
        <ProposedGoalModal
          proposedGoals={proposedGoals}
          onApprove={handleApproveGoal}
          onReject={handleRejectGoal}
          onClose={() => setProposedGoals([])} // Allows user to dismiss the modal without action
        />
      )}

      {/* Character Lab Modal â€” hidden from nav, preserved for Dementia OS */}
      <CharacterGacha isOpen={isCharacterLabOpen || activeModule === 'characters'} onClose={() => { setIsCharacterLabOpen(false); if (activeModule === 'characters') setActiveModule('core'); }} />
    </div>
  );
};

export default SomaCommandBridge;
