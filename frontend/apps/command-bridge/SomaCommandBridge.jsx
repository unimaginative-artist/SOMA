import React, { lazy, Suspense, useState, useEffect, useRef, useCallback } from 'react';
import {
  Cpu, Activity, Brain, Zap, HardDrive, Wifi, CheckCircle,
  Archive, Workflow, Database, Play, Pause, RotateCw, Trash2,
  Plus, Network, Home, MessageSquare, Settings, Palette,
  Shield, User, Users, Lightbulb, ThermometerSun, ChevronLeft,
  ChevronRight, Sparkles, Terminal, Circle, BarChart3, Search, X, Clock,
  Download, TrendingUp, TrendingDown, Target, Server, Gauge, Mail, Mic,
  Box, Share2, DollarSign, CircleDollarSign, Pencil, Eye, Code2, Send, Radio, LayoutGrid, Tv
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
import { getSharedSessionId } from './utils/sharedSession';
import Orb from './panels/Orb';
import SynthWave from './components/SynthWave';
import { RobotFace } from './components/RobotFace';
import KevinInterface from './KevinInterface';
// import KnowledgeGraph3D from '../../command-bridge/KnowledgeGraph3D';

// Hooks & Components
import { useSomaAudio } from './hooks/useSomaAudio';
import { useRealtimeEvents } from './hooks/useRealtimeEvents';
import { useVision } from './hooks/useVision';
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
import PulseIDE from './panels/pulse/App';
import SocialModule from './components/SocialModule';
import StudioModule from './panels/Studio/App';
import AxisApp from './panels/Axis/AxisApp';
import ForecasterApp from './panels/Forecaster/ForecasterApp';
import MissionControlApp from './panels/MissionControl/MissionControlApp';
import KnowledgeApp from './panels/Knowledge/KnowledgeApp';
import FileIntelligenceApp from './panels/FileIntelligence/FileIntelligenceApp';
import ArbiteriumApp from './panels/arbiterium/ArbiteriumApp';
import ThirdPlace from './panels/ThirdPlace/ThirdPlace';
import GrayMatterPanel from './panels/GrayMatter/GrayMatterPanel';
import ClusterOperations from './panels/Cluster/ClusterOperations';
const ApertureOS = lazy(() => import('./panels/aperture/ApertureOS'));
const SomaCT = lazy(() => import('../command-ct/SomaCT'));
import ArgusEye from './components/ArgusEye';
import ReflectionsTab from './components/ReflectionsTab';
// import FinanceModule from './components/FinanceModule';
import { generateId } from './lib/utils/id-generator';
import { FloatingPanel } from './components/ui/floating-panel';
import { SteveContextManager } from './lib/SteveContextManager';

import '../command-ct/styles/terminal.css';
import './styles/soma-ui-control.css';
import './styles/emotes.css';
import SettingsModule from './components/SettingsModule';
import CommandPalette from './components/CommandPalette';
import PerceptionPanel from './components/PerceptionPanel';
import SelfModFeed from './components/SelfModFeed';
import BootHealthWidget from './components/BootHealthWidget';
import GoalsPanel from './components/GoalsPanel';
import CharacterCard from './components/CharacterCard';
import CharacterGacha from './components/CharacterGacha';
import SimulationSuite from './components/SimulationSuite';
import SomaSpinePanel from './components/SomaSpinePanel';

// ==========================================
// Command Center Panel (Steve + Perception + Status)
// ==========================================
const STEVE_WITTY = [
  "Rerouting synaptic pathways...", "Judging your request...",
  "Allocating brilliance...", "Consulting the architecture gods...",
  "Optimizing sarcasm module...", "Processing inefficiency report..."
];

const CommandCenterPanel = ({
  executeCommand, setShowDiagnostics, setDiagnosticLogs,
  activeArbiters, totalArbiters, activeMicroAgents, totalMicroAgents,
  totalFragments, systemMetrics, analyticsSummary, activityStream,
  isConnected, formatUptime
}) => {
  const [showSpine, setShowSpine] = React.useState(false);
  const [steveMessages, setSteveMessages] = React.useState(() => {
    try {
      const saved = localStorage.getItem('soma_steve_messages');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [{ role: 'steve', content: "System online. I assume you've broken something already?", ts: Date.now() }];
  });
  const [steveInput, setSteveInput] = React.useState('');
  const [steveThinking, setSteveThinking] = React.useState(false);
  const [steveStatus, setSteveStatus] = React.useState({ online: false, status: 'idle', mood: 'idle', toolCount: 0 });
  const [daemons, setDaemons] = React.useState([]);
  const [perceptionData, setPerceptionData] = React.useState({ attention: null, recentSignals: [] });
  const [wittyPhrase, setWittyPhrase] = React.useState('');
  const steveScrollRef = React.useRef(null);

  // Persist Steve chat history across tab switches
  React.useEffect(() => {
    try {
      // Keep last 100 messages to avoid unbounded localStorage growth
      const toSave = steveMessages.slice(-100);
      localStorage.setItem('soma_steve_messages', JSON.stringify(toSave));
    } catch {}
  }, [steveMessages]);

  // Poll Steve status + daemon health every 10s
  // inFlight ref prevents parallel requests if a fetch takes longer than the interval
  React.useEffect(() => {
    const inFlight = { current: false };
    const fetchStatus = async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
        const [sRes, dRes, phRes] = await Promise.all([
          fetch('/api/soma/steve/status'),
          fetch('/api/daemon/status'),
          fetch('/api/perception/health')
          ]);

        if (sRes.ok) setSteveStatus(await sRes.json());
        if (dRes.ok) {
          const d = await dRes.json();
          setDaemons(d.daemon?.daemons || []);
        }
        if (phRes.ok) {
          const ph = await phRes.json();
          const att = ph.attention;
          setPerceptionData({
            attention: att ? { focus: att.focus, expires: att.focusExpiry, active: att.focusActive } : null,
            recentSignals: ph.recentSignals || []
          });
        }
      } catch {}
      finally { inFlight.current = false; }
    };
    fetchStatus();
    const t = setInterval(fetchStatus, 10000);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll Steve chat
  React.useEffect(() => {
    if (steveScrollRef.current) steveScrollRef.current.scrollTop = steveScrollRef.current.scrollHeight;
  }, [steveMessages]);

  // Cycle witty phrases while thinking
  React.useEffect(() => {
    if (!steveThinking) return;
    setWittyPhrase(STEVE_WITTY[Math.floor(Math.random() * STEVE_WITTY.length)]);
    const t = setInterval(() => setWittyPhrase(STEVE_WITTY[Math.floor(Math.random() * STEVE_WITTY.length)]), 2500);
    return () => clearInterval(t);
  }, [steveThinking]);

  const sendToSteve = async (e) => {
    e?.preventDefault();
    const msg = steveInput.trim();
    if (!msg || steveThinking) return;
    setSteveInput('');
    setSteveMessages(prev => [...prev, { role: 'user', content: msg, ts: Date.now() }]);
    setSteveThinking(true);
    try {
      const history = steveMessages.slice(-8).map(m => ({ role: m.role === 'steve' ? 'assistant' : 'user', content: m.content }));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      let data;
      try {
        const res = await fetch('/api/soma/steve/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: msg, history }),
          signal: ctrl.signal
        });
        data = await res.json();
      } finally {
        clearTimeout(timer);
      }
      const reply = data.response || data.error || "My cognitive link is severed.";
      setSteveMessages(prev => [...prev, { role: 'steve', content: reply, ts: Date.now(), actions: data.actions }]);
    } catch {
      setSteveMessages(prev => [...prev, { role: 'steve', content: "Architectural link interrupted.", ts: Date.now() }]);
    } finally {
      setSteveThinking(false);
    }
  };

  const moodColor = { idle: 'emerald', architecting: 'amber', thinking: 'blue' }[steveStatus.mood] || 'emerald';
  const moodDot = { idle: 'bg-emerald-400', architecting: 'bg-amber-400 animate-pulse', thinking: 'bg-blue-400 animate-pulse' }[steveStatus.mood] || 'bg-emerald-400';

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* ── Quick Actions Toolbar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => executeCommand('start_all', 'Start All Agents')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-fuchsia-500/10 hover:bg-fuchsia-500/20 border border-fuchsia-500/20 text-fuchsia-400 text-xs font-semibold transition-all">
          <Play className="w-3.5 h-3.5" /> Start All
        </button>
        <button onClick={() => executeCommand('stop_all', 'Pause All Agents')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-400 text-xs font-semibold transition-all">
          <Pause className="w-3.5 h-3.5" /> Pause All
        </button>
        <button onClick={() => executeCommand('reset_system', 'Reset System', 'warning')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs font-semibold transition-all">
          <RotateCw className="w-3.5 h-3.5" /> Reset
        </button>
        <button onClick={() => { executeCommand('run_diagnostics', 'Diagnostics'); setShowDiagnostics(true); setDiagnosticLogs([]); }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-500/10 hover:bg-zinc-500/20 border border-zinc-500/20 text-zinc-400 text-xs font-semibold transition-all">
          <Search className="w-3.5 h-3.5" /> Diagnostics
        </button>
        <button onClick={() => executeCommand('clear_cache', 'Clear Cache')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-500/10 hover:bg-zinc-500/20 border border-zinc-500/20 text-zinc-400 text-xs font-semibold transition-all">
          <Trash2 className="w-3.5 h-3.5" /> Clear Cache
        </button>
        <button onClick={() => executeCommand('create_backup', 'Backup')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-500/10 hover:bg-zinc-500/20 border border-zinc-500/20 text-zinc-400 text-xs font-semibold transition-all">
          <Database className="w-3.5 h-3.5" /> Backup
        </button>
        <button onClick={() => executeCommand('optimize_system', 'Optimize')}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 text-xs font-semibold transition-all">
          <Zap className="w-3.5 h-3.5" /> Optimize
        </button>
        <div className="flex-1" />
        <button onClick={() => setShowSpine(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 text-xs font-semibold transition-all">
          <Network className="w-3.5 h-3.5" /> Runtime Map
        </button>
      </div>

      {/* ── Main 2-column layout ── */}
      <div className="grid grid-cols-5 gap-4 flex-1 min-h-0 overflow-hidden">

        {/* LEFT: Steve Worker Panel (2/5) */}
        <div className="col-span-2 flex flex-col min-h-0 bg-[#0e0e11] border border-emerald-500/15 rounded-xl overflow-hidden shadow-lg">
          {/* Steve header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-emerald-500/10 bg-emerald-500/5">
            <div className="relative w-8 h-8 rounded-full overflow-hidden border border-emerald-500/30 bg-emerald-500/10 flex-shrink-0">
              <img src="/steve_profile.gif" alt="Steve" className="w-full h-full object-cover"
                onError={e => { e.target.style.display = 'none'; }} />
              <div className="absolute inset-0 flex items-center justify-center text-emerald-400 text-xs font-bold">S</div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-emerald-300 font-semibold text-sm leading-none">STEVE</div>
              <div className="text-zinc-500 text-[10px] mt-0.5 truncate">
                {steveStatus.currentTask ? `Working: ${steveStatus.currentTask}` : 'Senior Architect · Autonomous'}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${moodDot}`} />
              <span className={`text-${moodColor}-400 text-xs font-mono`}>{steveStatus.status || 'offline'}</span>
            </div>
          </div>

          {/* Steve pills */}
          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-white/5">
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${steveStatus.heartbeatActive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {steveStatus.heartbeatActive ? '💓 Active' : '💤 Dormant'}
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
              {steveStatus.queueLength || 0} queued
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
              {steveStatus.stats?.tasksCompleted || 0} done
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${steveStatus.searchLinked ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {steveStatus.searchLinked ? '✓ RAG' : '○ RAG'}
            </span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${steveStatus.learningLinked ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {steveStatus.learningLinked ? '✓ Learning' : '○ Learning'}
            </span>
          </div>

          {/* Chat messages */}
          <div ref={steveScrollRef} className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 min-h-0">
            {steveMessages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-fuchsia-500/15 text-fuchsia-100 border border-fuchsia-500/20'
                    : 'bg-zinc-800/80 text-zinc-200 border border-emerald-500/10'
                }`}>
                  {m.content}
                  {m.actions?.length > 0 && (
                    <div className="mt-1.5 pt-1.5 border-t border-white/10">
                      {m.actions.map((a, j) => (
                        <div key={j} className={`text-[10px] font-mono mt-0.5 ${a.success ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {a.success ? '✓' : '✗'} {a.cmd?.substring(0, 50)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {steveThinking && (
              <div className="flex justify-start">
                <div className="bg-zinc-800/80 border border-emerald-500/10 rounded-xl px-3 py-2 text-xs text-emerald-400 animate-pulse">
                  {wittyPhrase}
                </div>
              </div>
            )}
          </div>

          {/* Pending queue preview */}
          {steveStatus.queue?.length > 0 && (
            <div className="px-3 pb-2 border-t border-white/5 pt-2">
              <div className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Queued Tasks</div>
              <div className="space-y-1">
                {steveStatus.queue.slice(0, 3).map((t, i) => (
                  <div key={t.id || i} className="flex items-center gap-1.5 text-[10px] text-zinc-500 bg-zinc-900/60 rounded px-2 py-1">
                    <span className="text-amber-500 font-mono">{t.priority}</span>
                    <span className="truncate">{t.description?.substring(0, 55)}</span>
                    <span className="text-zinc-700 ml-auto whitespace-nowrap">{t.source}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Steve input */}
          <form onSubmit={sendToSteve} className="flex items-center gap-2 p-3 border-t border-white/5">
            <input
              value={steveInput}
              onChange={e => setSteveInput(e.target.value)}
              placeholder="Give Steve a task or question..."
              className="flex-1 bg-zinc-800/60 border border-zinc-700/50 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-emerald-500/40"
            />
            <button type="submit" disabled={steveThinking || !steveInput.trim()}
              className="p-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/20 text-emerald-400 disabled:opacity-40 transition-all">
              <Zap className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* RIGHT: Status + Perception + Plan + Stream (3/5) */}
        <div className="col-span-3 flex flex-col gap-3 min-h-0 overflow-y-auto custom-scrollbar pr-1">

          {/* System Health Grid */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Arbiters', value: `${activeArbiters}/${totalArbiters}`, color: 'blue', icon: Cpu },
              { label: 'Micro-Agents', value: `${activeMicroAgents}/${totalMicroAgents}`, color: 'purple', icon: Network },
              { label: 'Fragments', value: totalFragments, color: 'fuchsia', icon: Database },
              { label: 'Uptime', value: formatUptime(systemMetrics.uptime), color: 'emerald', icon: Clock },
              { label: 'Avg Response', value: `${analyticsSummary?.avgResponseTime || 0}ms`, color: 'amber', icon: Activity },
              { label: 'Tokens', value: (analyticsSummary?.tokenUsage || 0).toLocaleString(), color: 'zinc', icon: Zap },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className={`bg-${color}-500/5 border border-${color}-500/15 rounded-lg px-3 py-2.5 flex items-center gap-2.5`}>
                <Icon className={`w-3.5 h-3.5 text-${color}-400 flex-shrink-0`} />
                <div className="min-w-0">
                  <div className="text-zinc-500 text-[10px]">{label}</div>
                  <div className="text-zinc-100 font-mono text-xs font-semibold truncate">{value}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Perception: Daemon Health + Attention + Signals */}
          {(daemons.length > 0 || perceptionData.attention || perceptionData.recentSignals.length > 0) && (
            <div className="bg-[#151518]/60 border border-white/5 rounded-xl p-3 space-y-2">
              <div className="text-zinc-400 text-[10px] uppercase tracking-wider font-semibold">Perception Layer</div>

              {/* Daemons */}
              {daemons.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5">
                  {daemons.map(d => (
                    <div key={d.name} className="flex items-center gap-2 bg-zinc-900/50 rounded-lg px-2.5 py-1.5">
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${d.active ? 'bg-emerald-400' : 'bg-rose-500'}`} />
                      <span className="text-zinc-300 text-[11px] truncate flex-1">{d.name?.replace('Daemon', '')}</span>
                      {d.restartCount > 0 && (
                        <span className="text-amber-400 text-[10px] font-mono">{d.restartCount}↺</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Attention Focus */}
              {perceptionData.attention && (
                <div className="flex items-center gap-2 border-t border-white/5 pt-2">
                  <span className="text-zinc-500 text-[10px] uppercase tracking-wider flex-shrink-0">Focus</span>
                  <span className="text-fuchsia-300 text-[11px] font-mono truncate">{perceptionData.attention.focus}</span>
                  {perceptionData.attention.expires && (
                    <span className="text-zinc-600 text-[10px] ml-auto font-mono">
                      {Math.max(0, Math.round((perceptionData.attention.expires - Date.now()) / 1000))}s
                    </span>
                  )}
                </div>
              )}

              {/* Recent Signals */}
              {perceptionData.recentSignals.length > 0 && (
                <div className="border-t border-white/5 pt-2 space-y-1">
                  <div className="text-zinc-600 text-[10px] uppercase tracking-wider">CNS — Recent Signals</div>
                  {perceptionData.recentSignals.slice(0, 5).map((s, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-blue-400/70 text-[10px] font-mono flex-shrink-0 truncate max-w-[100px]">{s.topic}</span>
                      <span className="text-zinc-600 text-[10px] truncate flex-1">{s.preview}</span>
                      <span className="text-zinc-700 text-[9px] font-mono flex-shrink-0">{new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SOMA Plan */}
          <div className="bg-[#151518]/60 border border-white/5 rounded-xl overflow-hidden" style={{ height: '200px' }}>
            <SomaPlanViewer isConnected={isConnected} />
          </div>

          {/* Activity Stream */}
          <div className="bg-[#151518]/60 border border-white/5 rounded-xl p-3 flex flex-col" style={{ minHeight: '240px' }}>
            <div className="text-zinc-400 text-[10px] uppercase tracking-wider mb-2 font-semibold">Activity Stream</div>
            <div className="overflow-y-auto custom-scrollbar space-y-1 pr-1" style={{ maxHeight: '320px' }}>
              {activityStream.map(log => (
                <div key={log.id} className={`px-2.5 py-1.5 rounded-lg text-xs border flex items-start gap-2 ${
                  log.type === 'success' ? 'bg-fuchsia-500/5 border-fuchsia-500/10 text-fuchsia-400' :
                  log.type === 'error' ? 'bg-rose-500/5 border-rose-500/10 text-rose-400' :
                  log.type === 'warning' ? 'bg-amber-500/5 border-amber-500/10 text-amber-400' :
                  'bg-blue-500/5 border-blue-500/10 text-blue-400'}`}>
                  <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                    log.type === 'success' ? 'bg-fuchsia-500' : log.type === 'error' ? 'bg-rose-500' :
                    log.type === 'warning' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                  <span className="flex-1 leading-relaxed">{log.message}</span>
                  <span className="text-[10px] opacity-50 font-mono whitespace-nowrap">{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>

      {/* Runtime Map (Spine) slide-over modal */}
      {showSpine && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          onClick={(e) => e.target === e.currentTarget && setShowSpine(false)}
        >
          <div className="relative flex flex-col w-full max-w-6xl h-[90vh] rounded-2xl border border-white/10 bg-[#09090b] overflow-hidden shadow-2xl">
            <div className="flex items-center justify-between px-6 py-3 border-b border-white/5 flex-shrink-0 bg-[#0d0d10]">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-300">
                <Network className="w-4 h-4" /> Runtime &amp; Expertise Map
              </div>
              <button
                onClick={() => setShowSpine(false)}
                className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <SomaSpinePanel isConnected={isConnected} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

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
  const [activeModule, setActiveModule] = useState('studio');

  useEffect(() => {
    const handleCommandBridgeNavigate = (event) => {
      const module = event?.detail?.module;
      if (module) setActiveModule(module);
    };
    window.addEventListener('commandbridge:navigate', handleCommandBridgeNavigate);
    window.addEventListener('soma:navigate', handleCommandBridgeNavigate);
    window.addEventListener('soma:nav', handleCommandBridgeNavigate);
    return () => {
      window.removeEventListener('commandbridge:navigate', handleCommandBridgeNavigate);
      window.removeEventListener('soma:navigate', handleCommandBridgeNavigate);
      window.removeEventListener('soma:nav', handleCommandBridgeNavigate);
    };
  }, []);

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
  const [pulseVisited, setPulseVisited] = useState(false); // keep Maxwell IDE alive once opened

  // --- ARBITERIUM BACKEND INTEGRATION ---
  const [arbiteriumLastMessage, setArbiteriumLastMessage] = useState(null);
  
  // Command Palette State
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isCharacterLabOpen, setIsCharacterLabOpen] = useState(false);
  const [showQuickNote, setShowQuickNote] = useState(false);

  // Mount Maxwell IDE on first visit so the iframe loads once and stays alive
  useEffect(() => {
    if (activeModule === 'pulse' && !pulseVisited) setPulseVisited(true);
  }, [activeModule]);

  // Axis unread badge
  const [axisUnread, setAxisUnread] = useState(0);
  useEffect(() => {
    const h = (e) => setAxisUnread(e.detail?.count || 0);
    window.addEventListener('axis:unread', h);
    return () => window.removeEventListener('axis:unread', h);
  }, []);

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
  const firstConnect = useRef(true);       // suppress repeated "established" toasts
  const lastConnectToast = useRef(0);      // debounce: min 60s between toasts
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
  const [orbVisionCollapsed, setOrbVisionCollapsed] = useState(false);
  const [showOrbFace, setShowOrbFace] = useState(false);
  const [orbPresence, setOrbPresence] = useState(null);
  const [communicationHub, setCommunicationHub] = useState(null);
  const [communicationView, setCommunicationView] = useState('timeline');

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
      timestamp: response.timestamp || Date.now(),
      route: response.route,
      trust: response.trust,
      receiptId: response.receiptId
    }]);
    
    if (response.reasoningTree) {
      setActiveReasoningTree(response.reasoningTree);
    }
  }, []);

  const {
    active: isVisionActive,
    channel: visionChannel,
    lastPerception,
    lastFrameUrl,
    lastFrameAt,
    ghostCursor: visionGhostCursor,
    health: perceptionHealth,
    events: perceptionEvents,
    sceneMemory,
    whatChanged,
    setChannel: setVisionChannel,
    askWhatChanged,
    captureDesktop,
    proposeActions,
    executeAction
  } = useVision(somaBackend, isConnected);

  const [proposals, setProposals] = useState([]);
  const [isProposing, setIsProposing] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [editingProposalId, setEditingProposalId] = useState(null);
  const [hoveredProposalId, setHoveredProposalId] = useState(null);

  const activeGhostCursor = React.useMemo(() => {
    if (visionGhostCursor) {
      return visionGhostCursor;
    }
    if (hoveredProposalId) {
      const prop = proposals.find(p => p.id === hoveredProposalId);
      if (prop && prop.params && prop.params.x !== undefined && prop.params.y !== undefined) {
        return {
          x: Math.round((prop.params.x / 1920) * 100),
          y: Math.round((prop.params.y / 1080) * 100),
          action: prop.type,
          isProposed: true
        };
      }
    }
    if (editingProposalId) {
      const prop = proposals.find(p => p.id === editingProposalId);
      if (prop && prop.params && prop.params.x !== undefined && prop.params.y !== undefined) {
        return {
          x: Math.round((prop.params.x / 1920) * 100),
          y: Math.round((prop.params.y / 1080) * 100),
          action: prop.type,
          isEditing: true
        };
      }
    }
    return null;
  }, [visionGhostCursor, hoveredProposalId, editingProposalId, proposals]);

  const handleImageClick = useCallback((e) => {
    if (!editingProposalId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const pctX = clickX / rect.width;
    const pctY = clickY / rect.height;
    const scaledX = Math.round(pctX * 1920);
    const scaledY = Math.round(pctY * 1080);
    
    setProposals(prev => prev.map(p => {
      if (p.id === editingProposalId) {
        return {
          ...p,
          params: { ...p.params, x: scaledX, y: scaledY }
        };
      }
      return p;
    }));
  }, [editingProposalId]);

  // Keep a ref of current vision state so the voice hook can inject it into queries
  const visionContextRef = useRef(null);
  useEffect(() => {
    visionContextRef.current = { lastPerception, lastFrameUrl, channel: visionChannel };
  }, [lastPerception, lastFrameUrl, visionChannel]);

  const formatTimeAgo = useCallback((timestamp) => {
    if (!timestamp) return 'never';
    const seconds = Math.max(0, Math.round((Date.now() - Number(timestamp)) / 1000));
    if (seconds < 2) return 'now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.round(minutes / 60)}h ago`;
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
    lastTranscript,
    systemStatus: orbSystemStatus,
    sendTextQuery,
    somaHealthy,
    inputVolume,
    speakText,
    wakeWordActive,
    startWakeWordListening,
    stopWakeWordListening
  } = useSomaAudio(handleOrbResponse, visionContextRef, {
    onReceipt: (payload) => {
      setCommunicationHub(prev => {
        if (!prev) return prev;
        const next = { ...prev };
        if (payload.receipt) {
          const receipts = [payload.receipt, ...(next.receipts || []).filter(r => r.id !== payload.receipt.id)];
          next.receipts = receipts.slice(0, 50);
        }
        if (payload.approval) {
          const approvals = [payload.approval, ...(next.approvals || []).filter(a => a.id !== payload.approval.id)];
          next.approvals = approvals.slice(0, 50);
          next.stats = { ...(next.stats || {}), pendingApprovals: approvals.filter(a => a.status === 'pending').length };
        }
        return next;
      });
    }
  });

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

  // 4. Orb conversation history — load from shared session when neural link is established
  useEffect(() => {
    if (!isOrbConnected || orbConversation.length > 0) return;
    fetch(`/api/soma/history?limit=30`)
      .then(r => r.json())
      .then(data => {
        if (data.messages?.length) setOrbConversation(data.messages);
      })
      .catch(() => {});
  }, [isOrbConnected]);

  // 5. Proactive voice — speak when orb is connected and SOMA sends autonomous messages
  const speakTextRef = useRef(null);
  useEffect(() => { speakTextRef.current = speakText; });
  const isOrbConnectedRef = useRef(false);
  useEffect(() => { isOrbConnectedRef.current = isOrbConnected; }, [isOrbConnected]);
  const isTalkingRef = useRef(false);
  useEffect(() => { isTalkingRef.current = isTalking; }, [isTalking]);
  const isListeningRef = useRef(false);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  const lastTranscriptRef = useRef('');
  useEffect(() => { lastTranscriptRef.current = lastTranscript; }, [lastTranscript]);
  const pendingGreetingRef = useRef(null); // queues greeting if orb not ready yet
  const remoteSpeechSessionRef = useRef(null);

  useEffect(() => {
    const onProactiveSpeak = (payload) => {
      const text = payload.message || payload.text;
      if (!text) return;
      if (!isOrbConnectedRef.current || isTalkingRef.current || isListeningRef.current) {
        // Orb not ready — hold the greeting until Neural Link connects
        pendingGreetingRef.current = text;
        return;
      }
      if (speakTextRef.current) speakTextRef.current(text);
    };
    somaBackend.on('soma_proactive', onProactiveSpeak);
    return () => somaBackend.off('soma_proactive', onProactiveSpeak);
  }, []);

  // Remote speech is an intentional Discord/admin handoff into the local room.
  // It can speak through the normal Orb voice chain and optionally leave the mic open briefly for a reply.
  useEffect(() => {
    let remoteCooldownUntil = 0;
    const onRemoteSpeech = async (payload = {}) => {
      const text = payload.message || payload.text;
      if (!text) return;

      const now = Date.now();
      if (now < remoteCooldownUntil) return;
      remoteCooldownUntil = now + 2500;

      const previousModule = activeModule;
      if (previousModule !== 'orb') {
        setActiveModule('orb');
        await new Promise(resolve => setTimeout(resolve, 250));
      }

      if (isTalkingRef.current) return;
      const listenForReply = Boolean(payload.listenForReply);
      const wasConnected = isOrbConnectedRef.current;
      const beforeTranscript = lastTranscriptRef.current;
      if (listenForReply) {
        remoteSpeechSessionRef.current = {
          requestId: payload.requestId,
          recipient: payload.recipient || 'someone at home',
          beforeTranscript,
          heardReply: false,
          answered: false,
          startedAt: Date.now()
        };
        window.somaRemotePersonContext = {
          requestId: payload.requestId,
          recipient: payload.recipient || 'someone at home',
          startedAt: Date.now()
        };
        if (payload.recipient) {
          somaBackend.send('presence_identity', {
            name: payload.recipient,
            source: 'remote_speech_recipient',
            confidence: 0.72,
            timestamp: Date.now()
          });
        }
      }

      if (listenForReply && !wasConnected) {
        try { await connectOrb(); } catch { /* speak anyway if mic cannot open */ }
      }

      if (!payload.suppressSpeak && speakTextRef.current) await speakTextRef.current(text);

      if (listenForReply && !wasConnected) {
        setTimeout(() => {
          const session = remoteSpeechSessionRef.current;
          if (session?.requestId === payload.requestId && !session.heardReply) {
            somaBackend.send('remote_speech_status', {
              requestId: payload.requestId,
              phase: 'no_reply',
              recipient: payload.recipient || null,
              timestamp: Date.now()
            });
            remoteSpeechSessionRef.current = null;
            delete window.somaRemotePersonContext;
          }
          if (lastTranscriptRef.current === beforeTranscript && !isTalkingRef.current && !isListeningRef.current) {
            disconnectOrb();
          }
        }, Number(payload.listenWindowMs || 25000));
      }
    };

    somaBackend.on('soma_remote_speech', onRemoteSpeech);
    return () => somaBackend.off('soma_remote_speech', onRemoteSpeech);
  }, [activeModule, connectOrb, disconnectOrb]);

  useEffect(() => {
    const session = remoteSpeechSessionRef.current;
    if (!session || session.heardReply || !lastTranscript || lastTranscript === session.beforeTranscript) return;
    session.heardReply = true;
    somaBackend.send('remote_speech_status', {
      requestId: session.requestId,
      phase: 'heard_reply',
      speaker: session.recipient,
      transcriptPreview: lastTranscript.slice(0, 180),
      timestamp: Date.now()
    });
  }, [lastTranscript]);

  useEffect(() => {
    const session = remoteSpeechSessionRef.current;
    if (!session || !session.heardReply || session.answered || !orbConversation.length) return;
    const latest = orbConversation[orbConversation.length - 1];
    if (latest?.role !== 'soma' || !latest.text) return;
    session.answered = true;
    somaBackend.send('remote_speech_status', {
      requestId: session.requestId,
      phase: 'soma_answered',
      speaker: session.recipient,
      summary: latest.text.slice(0, 240),
      timestamp: Date.now()
    });
    remoteSpeechSessionRef.current = null;
    delete window.somaRemotePersonContext;
  }, [orbConversation]);

  // Presence probe — only when wake/presence mode is armed, and only for backend-gated return events.
  useEffect(() => {
    let localCooldownUntil = 0;
    const onPresenceProbe = async (payload = {}) => {
      const presenceArmed =
        localStorage.getItem('soma_wakeword_enabled') === 'true' ||
        localStorage.getItem('soma_presence_probe_enabled') === 'true';
      if (!presenceArmed || activeModule !== 'orb') return;

      const now = Date.now();
      if (now < localCooldownUntil) return;
      localCooldownUntil = now + Math.max(10 * 60 * 1000, Number(payload.listenWindowMs || 25000));

      if (isTalkingRef.current || isListeningRef.current) return;

      const wasConnected = isOrbConnectedRef.current;
      if (!wasConnected) {
        try { await connectOrb(); } catch { return; }
      }

      const beforeTranscript = lastTranscriptRef.current;
      const text = payload.message || 'Hello? I thought someone was there. How are you?';
      if (speakTextRef.current) await speakTextRef.current(text);

      // If this probe opened the mic by itself and nobody answers, close it again.
      if (!wasConnected) {
        setTimeout(() => {
          if (lastTranscriptRef.current === beforeTranscript && !isTalkingRef.current && !isListeningRef.current) {
            disconnectOrb();
          }
        }, Number(payload.listenWindowMs || 25000));
      }
    };
    somaBackend.on('soma_presence_probe', onPresenceProbe);
    return () => somaBackend.off('soma_presence_probe', onPresenceProbe);
  }, [activeModule, connectOrb, disconnectOrb]);

  // --- AUTO-ENGAGEMENT REMOVED (User Directive) ---
  // Disconnect audio pipeline when navigating away from orb tab — mic should not run in background
  useEffect(() => {
    if (activeModule !== 'orb' && isOrbConnected) {
      disconnectOrb();
    }
  }, [activeModule]);

  // Speak queued greeting the moment Neural Link comes up
  useEffect(() => {
    if (!isOrbConnected || !pendingGreetingRef.current) return;
    const text = pendingGreetingRef.current;
    pendingGreetingRef.current = null;
    // Short delay so AudioContext finishes initializing
    setTimeout(() => {
      if (speakTextRef.current && !isTalkingRef.current) speakTextRef.current(text);
    }, 800);
  }, [isOrbConnected]);

  // 6. Wake word — persistent preference + auto-start on mount
  const handleWakeWordToggle = useCallback(() => {
    if (wakeWordActive) {
      stopWakeWordListening();
      localStorage.removeItem('soma_wakeword_enabled');
    } else {
      startWakeWordListening();
      localStorage.setItem('soma_wakeword_enabled', 'true');
    }
  }, [wakeWordActive, startWakeWordListening, stopWakeWordListening]);

  useEffect(() => {
    if (localStorage.getItem('soma_wakeword_enabled') === 'true') {
      startWakeWordListening();
    }
  }, []); // once on mount — restore preference from last session

  useEffect(() => {
    if (activeModule !== 'orb') return;
    let cancelled = false;
    const loadPresence = async () => {
      try {
        const [spineRes, activityRes] = await Promise.all([
          fetch('/api/soma/knowledge/spine/status').catch(() => null),
          fetch('/api/soma/activity?limit=6').catch(() => null)
        ]);
        const spine = spineRes?.ok ? await spineRes.json() : null;
        const activity = activityRes?.ok ? await activityRes.json() : null;
        if (!cancelled) setOrbPresence({ spine: spine?.spine || null, activity: activity?.activity || activity?.feed || activity?.items || [] });
      } catch {
        if (!cancelled) setOrbPresence(prev => prev || { spine: null, activity: [] });
      }
    };
    loadPresence();
    const timer = setInterval(loadPresence, 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeModule]);

  useEffect(() => {
    if (activeModule !== 'orb') return;
    let cancelled = false;
    const loadHub = async () => {
      try {
        const res = await fetch('/api/soma/communication/state?limit=40');
        const data = await res.json();
        if (!cancelled && data?.hub) setCommunicationHub(data.hub);
      } catch {
        if (!cancelled) setCommunicationHub(prev => prev || null);
      }
    };
    loadHub();
    const timer = setInterval(loadHub, 8000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeModule]);

  // 7. User presence signal — throttled activity ping so SOMA knows the user is on-page
  useEffect(() => {
    let lastSent = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastSent < 15000) return;
      lastSent = now;
      somaBackend.send('user_activity', { timestamp: now });
    };
    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keypress', onActivity, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keypress', onActivity);
    };
  }, []);

  // Global Ctrl+Shift+N → toggle quick-note panel
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'N') {
        e.preventDefault();
        setShowQuickNote(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

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
      const now = Date.now();
      // Only toast on true first connect or if it's been >60s since last one (genuine reconnect)
      if (firstConnect.current || now - lastConnectToast.current > 60000) {
        toast.success('SOMA Neural Link Established', { theme: 'dark' });
        lastConnectToast.current = now;
      }
      firstConnect.current = false;
    });

    somaBackend.on('disconnect', () => {
      setIsConnected(false);
      // Only warn if we were connected for a meaningful time (not a startup cycle)
      if (!firstConnect.current) {
        toast.warning('Neural Link Severed - Reconnecting...', { theme: 'dark', autoClose: 3000 });
      }
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
        setActiveModule('pulse');
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

    // Trade close P&L notifications
    somaBackend.on('trade_notification', (payload) => {
      const { symbol, side, pnl, pnlPct, reason, balance, mode } = payload || {};
      if (!symbol) return;
      const isWin = pnl >= 0;
      const icon = isWin ? '📈' : '📉';
      const sign = isWin ? '+' : '';
      const modeTag = mode === 'paper' ? '[PAPER] ' : '';
      const msg = `${icon} ${modeTag}${symbol} ${(side || '').toUpperCase()} closed: ${sign}$${Math.abs(pnl || 0).toFixed(2)} (${sign}${(pnlPct || 0).toFixed(2)}%) | ${reason}`;
      if (isWin) {
        toast.success(msg, { theme: 'dark', autoClose: 8000 });
      } else {
        toast.error(msg, { theme: 'dark', autoClose: 8000 });
      }
    });

    // Repo file change — show contextual "Ask SOMA" prompt
    somaBackend.on('repo_activity', (payload) => {
      const { filename } = payload || {};
      if (!filename) return;
      toast.info(
        `📁 ${filename} changed — Ask SOMA →`,
        {
          theme: 'dark', autoClose: 6000,
          onClick: () => setActiveModule('orb'),
        }
      );
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

  const handleFloatingChatSubmit = async (message, { history = [], activeModule: page, attachment = null, signal = null } = {}) => {
    try {
      const data = await somaBackend.fetch('/api/soma/chat', {
        method: 'POST',
        body: JSON.stringify({
          message,
          sessionId: getSharedSessionId(),
          history: history.map(m => ({ role: m.role || (m.sender === 'user' ? 'user' : 'assistant'), content: m.content || m.text })),
          attachment,
          context: { source: 'floating-chat', page: page || activeModule },
        }),
        ...(signal ? { signal } : {}),
      });
      if (data && (data.response || data.message)) {
        return {
          text: data.response || data.message,
          characterSuggestion: data.characterSuggestion || null,
          activeCharacter: data.activeCharacter || null,
          retryable: data.metadata?.retryable === true || ['REASONING_TIMEOUT', 'CHAT_WALL_TIMEOUT', 'LOCAL_CHAT_TIMEOUT'].includes(data.metadata?.errorCode),
          errorCode: data.metadata?.errorCode || null,
        };
      }
    } catch (error) {
      toast.error('Neural Link communication failure');
      throw error;
    }
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
    <div className="flex h-screen ct-background text-zinc-200 font-sans selection:bg-white/50">
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
      <div className={`${sidebarCollapsed ? 'w-16' : 'w-[199px]'} bg-[#09090b]/80 backdrop-blur-xl border-r border-white/5 flex flex-col transition-all duration-300 overflow-hidden z-50`}>
        <div className="h-14 flex items-center border-b border-white/5">
          {sidebarCollapsed ? (
            /* Collapsed: logo centered both axes */
            <button onClick={() => setSidebarCollapsed(false)} className="w-full h-full flex items-center justify-center opacity-50 hover:opacity-80 transition-opacity">
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="32" height="32" rx="8" fill="#1a1a1f"/>
                <g transform="translate(4,4)">
                  <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" fill="#a1a1aa"/>
                </g>
              </svg>
            </button>
          ) : (
            /* Expanded: SOMA text vertically centered, chevron on right */
            <div className="w-full flex items-center justify-between px-4">
              <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-b from-white to-white/50 tracking-tight">SOMA</h1>
              <button onClick={() => setSidebarCollapsed(true)} className="text-zinc-500 hover:text-white transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto p-2 custom-scrollbar space-y-0.5">
          {[
            { id: 'studio', label: 'Studio', icon: User, color: 'cyan' },
            { id: 'axis', label: 'Axis', icon: MessageSquare, color: 'violet' },
            { id: 'aperture', label: 'Aperture OS', icon: LayoutGrid, color: 'teal' },
            { id: 'core', label: 'Core System', icon: Cpu, color: 'blue' },
            { id: 'command', label: 'Command Center', icon: Activity, color: 'fuchsia' },
            { id: 'terminal', label: 'SOMA CT', icon: Terminal, color: 'amber' },
            { id: 'pulse', label: 'Pulse', icon: Code2, color: 'violet' },
            { id: 'orb', label: 'Presence', icon: Circle, color: 'purple' },
            { id: 'kevin', label: 'K.E.V.I.N.', icon: Mail, color: 'red' },

            { id: 'simulation', label: 'Simulation', icon: Box, color: 'orange' },

            { id: 'forecaster', label: 'Forecaster', icon: TrendingUp, color: 'indigo' },
            { id: 'mission_control', label: 'Mission Control', icon: CircleDollarSign, color: 'rose' },
            { id: 'cluster', label: 'MAX Cluster', icon: Network, color: 'emerald' },
            { id: 'storage', label: 'Storage', icon: HardDrive, color: 'blue' },
            { id: 'knowledge', label: 'Knowledge', icon: Brain, color: 'cyan' },
            { id: 'reflections', label: 'Reflections', icon: Sparkles, color: 'purple' },
            { id: 'settings', label: 'Settings', icon: Settings, color: 'stone' },
            { id: 'arbiterium', label: 'Arbiterium', icon: Zap, color: 'fuchsia' },
            { id: 'thirdplace', label: 'Third Place', icon: Users, color: 'violet' },
            { id: 'graymatter', label: 'Gray Matter', icon: Radio, color: 'cyan' },
          ].map(module => (
            <button
              key={module.id}
              onClick={() => setActiveModule(module.id)}
              className={`w-full flex items-center ${sidebarCollapsed ? 'justify-center' : 'space-x-3'} px-3 py-2.5 rounded-lg mb-1 transition-all duration-200 group ${activeModule === module.id ? 'bg-white/10 text-white shadow-lg border border-white/5' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100'
                }`}
            >
              <module.icon className={`w-5 h-5 ${activeModule === module.id ? `text-${module.color}-400` : 'text-zinc-500 group-hover:text-zinc-300'}`} />
              {!sidebarCollapsed && <span className="font-medium text-sm">{module.label}</span>}
              {module.id === 'axis' && axisUnread > 0 && activeModule !== 'axis' && (
                <span className="ml-auto text-[10px] font-bold bg-violet-500/25 text-violet-300 rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                  {axisUnread > 99 ? '99+' : axisUnread}
                </span>
              )}
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
      <div className={`flex-1 flex flex-col ${['terminal', 'orb', 'mission_control', 'cluster', 'knowledge', 'reflections', 'pulse', 'studio', 'axis', 'aperture'].includes(activeModule) ? 'overflow-hidden' : activeModule === 'command' ? 'overflow-hidden p-6' : 'overflow-y-auto p-6'}`}>

        {activeModule === 'cluster' && <ClusterOperations />}

        {/* CORE SYSTEM MODULE */}
        {activeModule === 'core' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-white tracking-tight">Core System</h2>
            </div>

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

            <div className="grid grid-cols-2 gap-6">
              <PerceptionPanel isConnected={isConnected} />
              <SelfModFeed isConnected={isConnected} />
            </div>

            <div className="grid grid-cols-2 gap-6">
              <BootHealthWidget isConnected={isConnected} />
              <GoalsPanel isConnected={isConnected} />
            </div>
          </div>
        )}

        {/* TERMINAL MODULE */}
        {activeModule === 'terminal' && (
          <div className="flex-1 h-full">
            <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-zinc-500">Loading SOMA CT…</div>}>
              <SomaCT />
            </Suspense>
          </div>
        )}

        {/* MAXWELL IDE — keep-alive after first visit so iframe doesn't reload on tab switch */}
        {pulseVisited && (
          <div style={{ display: activeModule === 'pulse' ? 'flex' : 'none' }} className="flex-1 h-full">
            <PulseIDE />
          </div>
        )}

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
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-[0.2em]">Neural Session</h3>
                    <button
                      onClick={() => setOrbSidebarCollapsed(true)}
                      className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-all"
                      title="Collapse Neural Session"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                  </div>
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
                          {(msg.route || msg.trust?.score) && (
                            <div className="mt-2 flex flex-wrap gap-1.5 border-t border-white/10 pt-2">
                              {msg.route && <span className="rounded-full bg-white/5 px-2 py-0.5 text-[8px] uppercase tracking-widest text-zinc-400">{msg.route}</span>}
                              {msg.trust?.score && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[8px] uppercase tracking-widest text-emerald-300">{Math.round(msg.trust.score * 100)}% trust</span>}
                            </div>
                          )}
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

            {/* Re-expand Button — only visible when sidebar is collapsed */}
            <AnimatePresence>
              {orbSidebarCollapsed && (
                <motion.div
                  className="absolute top-8 left-4 z-30"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: "spring", damping: 15, stiffness: 250 }}
                >
                  <motion.button
                    onClick={() => setOrbSidebarCollapsed(false)}
                    className="p-3 rounded-full border bg-purple-500/10 border-purple-500/30 text-purple-400 group relative overflow-visible"
                    whileHover={{ scale: 1.15 }}
                    whileTap={{ scale: 0.88 }}
                    title="Expand Neural Session"
                  >
                    {/* Ring 1 — slow expanding pulse */}
                    <motion.div
                      className="absolute inset-0 rounded-full border border-purple-400/50"
                      animate={{ scale: [1, 2, 1], opacity: [0.7, 0, 0.7] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
                    />
                    {/* Ring 2 — offset pulse */}
                    <motion.div
                      className="absolute inset-0 rounded-full border border-fuchsia-500/30"
                      animate={{ scale: [1, 2.6, 1], opacity: [0.5, 0, 0.5] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut", delay: 0.8 }}
                    />
                    {/* Soft glow core */}
                    <div className="absolute inset-0 rounded-full bg-purple-500/25 blur-sm" />
                    {/* Brain icon — gentle breathe */}
                    <motion.svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-5 h-5 relative z-10"
                      animate={{ scale: [1, 1.12, 1] }}
                      transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
                    </motion.svg>
                    {/* Hover label */}
                    <span className="absolute left-full ml-3 px-2 py-1 bg-black/80 border border-white/10 rounded text-[9px] text-purple-300 uppercase tracking-widest whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      Session Logs
                    </span>
                  </motion.button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Center: The Orb / Face */}
            <div className="flex-1 flex flex-col items-center justify-center relative z-10">
              <div className="h-[550px] w-full flex items-center justify-center pointer-events-none">
                {showOrbFace ? (
                  <RobotFace
                    volume={volume}
                    isConnected={isOrbConnected}
                    isTalking={isTalking}
                    isListening={isListening}
                    isThinking={isThinking}
                  />
                ) : (
                  <Orb volume={volume} isActive={isOrbConnected} isTalking={isTalking} isListening={isListening} isThinking={isThinking} isConnected={isConnected} />
                )}
              </div>

              {/* Synth Wave — reacts to SOMA's voice in black/purple — HIDE WHEN FACE IS ACTIVE */}
              {!showOrbFace && (
                <div className="flex items-center justify-center mb-4 pointer-events-none">
                  <SynthWave volume={volume} isTalking={isTalking} isListening={isListening} isThinking={isThinking} isActive={isOrbConnected} />
                </div>
              )}

              <div className="mt-4 flex flex-col items-center gap-4 w-full max-w-xl px-10 relative z-[100]">
                {/* Neural Link Button */}
                <div className="flex items-center gap-3">
                  <button
                    className={`px-10 py-3 rounded-full font-bold uppercase tracking-[0.2em] text-xs transition-all shadow-lg pointer-events-auto ${isOrbConnected
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/50 hover:bg-rose-500/30'
                      : 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30 hover:bg-fuchsia-500/30'
                    }`}
                    onClick={() => isOrbConnected ? disconnectOrb() : connectOrb()}
                  >
                    {isOrbConnected ? '● Disengage Neural Link' : '○ Establish Neural Link'}
                  </button>
                </div>

                {/* Whisper offline banner */}
                {isOrbConnected && (orbSystemStatus.whisperServer === 'fallback' || orbSystemStatus.whisperServer === 'error') && (
                  <div className="mt-3 w-full max-w-sm bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-2.5 text-center">
                    <p className="text-[10px] text-amber-400 font-bold uppercase tracking-widest mb-1">
                      {orbSystemStatus.whisperServer === 'fallback' ? '⚠ Browser STT Active' : '✗ No STT Available'}
                    </p>
                    <p className="text-[9px] text-amber-300/70 leading-relaxed">
                      {orbSystemStatus.whisperServer === 'fallback'
                        ? 'Whisper server offline — using Chrome/Edge speech recognition. Firefox unsupported. For accuracy, run a Whisper server on :5002.'
                        : 'No speech recognition available. Use the text input below or open Chrome/Edge.'}
                    </p>
                  </div>
                )}

                {/* Manual Input Area */}
                {isOrbConnected && (
                  <div className="mt-4 w-full max-w-sm">
                    <div className="bg-black/40 border border-white/10 rounded-2xl p-2.5 backdrop-blur-md shadow-2xl">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Transmit command..."
                          className="flex-1 bg-white/5 border border-white/5 rounded-xl px-4 py-2 text-xs text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-fuchsia-500/40 transition-all"
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
                            const input = e.currentTarget.parentElement.querySelector('input');
                            if (input && input.value.trim()) {
                              const query = input.value.trim();
                              input.value = '';
                              if (window.somaTextQuery) window.somaTextQuery(query);
                            }
                          }}
                          className="p-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-400 border border-fuchsia-500/30 rounded-xl transition-all"
                        >
                          <Send className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right: SOMA Presence Panel */}
            <motion.div
              initial={false}
              animate={{ width: orbVisionCollapsed ? 0 : 300, opacity: orbVisionCollapsed ? 0 : 1 }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              className="border-l border-white/5 flex flex-col bg-zinc-900/20 backdrop-blur-sm relative z-20 overflow-hidden"
            >
              <div className="w-[300px] flex flex-col h-full">
                {/* Panel Header */}
                <div className="p-4 border-b border-white/5 flex items-center justify-between flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">SOMA Presence</span>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isOrbConnected ? 'bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)]' : 'bg-zinc-700'}`} />
                  </div>
                  <button
                    onClick={() => setOrbVisionCollapsed(true)}
                    className="p-1.5 rounded-lg text-zinc-600 hover:text-zinc-300 hover:bg-white/5 transition-all"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Status + Controls */}
                <div className="px-4 py-3 border-b border-white/5 space-y-3 flex-shrink-0">
                  {/* Service status dots */}
                  <div className="flex items-center justify-between">
                    {[
                      { label: 'Backend', status: orbSystemStatus.somaBackend },
                      { label: 'Whisper', status: orbSystemStatus.whisperServer },
                      { label: 'Voice', status: orbSystemStatus.elevenLabs },
                    ].map(s => (
                      <div key={s.label} className="flex items-center gap-1.5">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          s.status === 'connected' || s.status === 'ready' || s.status === 'enabled' ? 'bg-fuchsia-500 shadow-[0_0_6px_rgba(217,70,239,0.6)]' :
                          s.status === 'fallback' ? 'bg-yellow-500' :
                          s.status === 'initializing' ? 'bg-blue-500 animate-pulse' :
                          'bg-rose-500'
                        }`} />
                        <span className="text-[9px] text-zinc-500 uppercase font-mono tracking-wider">{s.label}</span>
                      </div>
                    ))}
                  </div>

                  {/* Orb / Face toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] text-zinc-600 uppercase font-mono tracking-wider">Visualiser</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[9px] font-mono ${!showOrbFace ? 'text-zinc-300' : 'text-zinc-600'}`}>Orb</span>
                      <button
                        onClick={() => setShowOrbFace(v => !v)}
                        className="relative w-9 h-5 rounded-full transition-colors duration-300 focus:outline-none"
                        style={{ backgroundColor: showOrbFace ? '#d946ef' : '#27272a', boxShadow: showOrbFace ? '0 0 8px #d946ef50' : 'none' }}
                      >
                        <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-300"
                          style={{ left: showOrbFace ? '1.125rem' : '0.125rem' }} />
                      </button>
                      <span className={`text-[9px] font-mono ${showOrbFace ? 'text-zinc-300' : 'text-zinc-600'}`}>Face</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-xl border border-cyan-500/10 bg-cyan-500/[0.03] p-2">
                    <div className="min-w-0">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">Camera Link</div>
                      <div className="mt-0.5 text-[9px] leading-snug text-zinc-600">Manual approval now. Autonomous control later.</div>
                    </div>
                    <ArgusEye isConnected={isConnected} />
                  </div>

                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: 'API', ok: isConnected, warn: false },
                      { label: 'Vision', ok: !!perceptionHealth?.vision?.active || isVisionActive, warn: !perceptionHealth },
                      { label: 'Frame', ok: !!lastFrameUrl, warn: isVisionActive && !lastFrameUrl },
                      { label: 'Audio', ok: isOrbConnected || orbSystemStatus.whisperServer === 'ready' || orbSystemStatus.whisperServer === 'fallback', warn: orbSystemStatus.whisperServer === 'fallback' },
                      { label: 'Brain', ok: somaHealthy || orbSystemStatus.somaBackend === 'connected', warn: false }
                    ].map(item => (
                      <div key={item.label} className="rounded-lg border border-white/5 bg-black/25 px-1.5 py-1.5 text-center">
                        <div className={`mx-auto mb-1 h-1.5 w-1.5 rounded-full ${
                          item.ok ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]' :
                          item.warn ? 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.55)]' :
                          'bg-zinc-700'
                        }`} />
                        <div className="text-[7px] font-bold uppercase tracking-wider text-zinc-500">{item.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* User mic bar */}
                  <div className="flex items-center gap-2">
                    <Mic className={`w-3 h-3 flex-shrink-0 ${inputVolume > 0.2 ? 'text-fuchsia-400' : 'text-zinc-600'}`} />
                    <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden border border-white/5">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-fuchsia-500 transition-all duration-75"
                        style={{ width: `${Math.max(2, inputVolume * 100)}%`, opacity: isOrbConnected ? 1 : 0.2 }}
                      />
                    </div>
                    <span className="text-[9px] text-zinc-600 font-mono w-6 text-right">{Math.round(inputVolume * 100)}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Link', value: isOrbConnected ? 'live' : 'idle', active: isOrbConnected },
                      { label: 'Wake', value: wakeWordActive ? 'armed' : 'off', active: wakeWordActive },
                      { label: 'Vision', value: isVisionActive ? visionChannel : 'off', active: isVisionActive },
                      { label: 'Last', value: formatTimeAgo(lastFrameAt), active: !!lastFrameAt },
                      { label: 'Memory', value: orbPresence?.spine ? `${orbPresence.spine.unitCount || 0}` : 'sync', active: !!orbPresence?.spine },
                      { label: 'Gate', value: communicationHub?.stats ? `${communicationHub.stats.pendingApprovals || 0}` : '0', active: (communicationHub?.stats?.pendingApprovals || 0) > 0 }
                    ].map(item => (
                      <div key={item.label} className="rounded-lg border border-white/5 bg-black/25 px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[8px] uppercase tracking-widest text-zinc-600">{item.label}</span>
                          <span className={`h-1.5 w-1.5 rounded-full ${item.active ? 'bg-fuchsia-400 shadow-[0_0_6px_rgba(217,70,239,0.7)]' : 'bg-zinc-700'}`} />
                        </div>
                        <div className="mt-1 truncate text-[10px] font-mono text-zinc-300">{item.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Presence + Vision Feed */}
                <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-3">
                  <div className="rounded-xl border border-fuchsia-500/10 bg-fuchsia-500/[0.04] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-fuchsia-300">Current State</span>
                      <Activity className={`h-3 w-3 ${isThinking || isTalking || isListening ? 'text-fuchsia-300 animate-pulse' : 'text-zinc-600'}`} />
                    </div>
                    <div className="text-[11px] font-mono text-zinc-300">
                      {isTalking ? 'Speaking through voice chain'
                        : isThinking ? 'Reasoning on the last transmission'
                        : isListening ? 'Listening for you'
                        : isOrbConnected ? 'Linked and waiting'
                        : 'Presence idle'}
                    </div>
                    {lastTranscript && (
                      <div className="mt-2 rounded border border-white/5 bg-black/25 px-2 py-1 text-[9px] leading-snug text-zinc-500 line-clamp-2">
                        Last heard: {lastTranscript}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Communication Hub</span>
                      <MessageSquare className="h-3 w-3 text-zinc-500" />
                    </div>
                    <div className="mb-2 grid grid-cols-4 gap-1">
                      {[
                        ['timeline', 'Time'],
                        ['receipts', 'Runs'],
                        ['agents', 'Agents'],
                        ['approvals', 'Gate']
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          onClick={() => setCommunicationView(id)}
                          className={`rounded-md border px-1.5 py-1 text-[8px] font-bold uppercase tracking-wider transition-all ${
                            communicationView === id
                              ? 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200'
                              : 'border-white/5 bg-white/[0.03] text-zinc-600 hover:text-zinc-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    {communicationView === 'timeline' && (
                      <div className="space-y-1.5">
                        {(communicationHub?.timeline || []).slice(0, 5).map(item => (
                          <div key={item.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[10px] text-zinc-300">{item.title || item.type}</span>
                              <span className={`h-1.5 w-1.5 rounded-full ${item.priority === 'important' ? 'bg-amber-400' : item.priority === 'ambient' ? 'bg-zinc-600' : 'bg-fuchsia-400'}`} />
                            </div>
                            <div className="mt-0.5 truncate text-[8px] uppercase tracking-wider text-zinc-600">{item.agent || item.route || 'SOMA'} / {new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                          </div>
                        ))}
                        {!(communicationHub?.timeline || []).length && <div className="text-[10px] text-zinc-600">No communication events yet.</div>}
                      </div>
                    )}

                    {communicationView === 'receipts' && (
                      <div className="space-y-1.5">
                        {(communicationHub?.receipts || []).slice(0, 4).map(item => (
                          <div key={item.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[10px] text-zinc-300">{item.title}</span>
                              <span className={`text-[8px] uppercase ${item.status === 'completed' ? 'text-emerald-300' : item.status === 'failed' ? 'text-rose-300' : 'text-amber-300'}`}>{item.status}</span>
                            </div>
                            <div className="mt-1 grid grid-cols-6 gap-1">
                              {(item.steps || []).map(step => (
                                <div key={step.label} title={step.label} className={`h-1 rounded-full ${step.status === 'done' ? 'bg-emerald-400' : step.status === 'active' ? 'bg-fuchsia-400 animate-pulse' : 'bg-zinc-800'}`} />
                              ))}
                            </div>
                          </div>
                        ))}
                        {!(communicationHub?.receipts || []).length && <div className="text-[10px] text-zinc-600">Receipts appear when SOMA handles a message.</div>}
                      </div>
                    )}

                    {communicationView === 'agents' && (
                      <div className="space-y-1.5">
                        {(communicationHub?.agents || []).map(agent => (
                          <div key={agent.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
                            <div className="min-w-0">
                              <div className="truncate text-[10px] text-zinc-300">{agent.name}</div>
                              <div className="truncate text-[8px] uppercase tracking-wider text-zinc-600">{agent.role}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-[9px] text-fuchsia-300">{Math.round((agent.confidence || 0) * 100)}%</div>
                              <div className="text-[8px] uppercase text-zinc-600">{agent.status}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {communicationView === 'approvals' && (
                      <div className="space-y-1.5">
                        {(communicationHub?.approvals || []).slice(0, 4).map(item => (
                          <div key={item.id} className="rounded-lg border border-amber-500/15 bg-amber-500/[0.04] px-2 py-1.5">
                            <div className="truncate text-[10px] text-amber-100">{item.title}</div>
                            <div className="mt-0.5 truncate text-[8px] uppercase tracking-wider text-amber-300/60">{item.status} / {item.agent}</div>
                            {item.status === 'pending' && (
                              <div className="mt-2 grid grid-cols-2 gap-1">
                                {['approved', 'rejected'].map(status => (
                                  <button
                                    key={status}
                                    onClick={async () => {
                                      try {
                                        await fetch(`/api/soma/communication/approval/${item.id}`, {
                                          method: 'PATCH',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ status })
                                        });
                                        const res = await fetch('/api/soma/communication/state?limit=40');
                                        const data = await res.json();
                                        if (data?.hub) setCommunicationHub(data.hub);
                                      } catch {}
                                    }}
                                    className={`rounded border px-2 py-1 text-[8px] uppercase tracking-wider ${status === 'approved' ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10' : 'border-rose-500/30 text-rose-300 hover:bg-rose-500/10'}`}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {!(communicationHub?.approvals || []).length && <div className="text-[10px] text-zinc-600">Risky external actions will wait here.</div>}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Knowledge Spine</span>
                      <Database className="h-3 w-3 text-zinc-500" />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-center font-mono">
                      <div className="rounded border border-white/5 bg-white/[0.03] px-2 py-1">
                        <div className="text-[12px] text-white">{orbPresence?.spine?.entryCount ?? '—'}</div>
                        <div className="text-[8px] uppercase text-zinc-600">entries</div>
                      </div>
                      <div className="rounded border border-white/5 bg-white/[0.03] px-2 py-1">
                        <div className="text-[12px] text-fuchsia-300">{orbPresence?.spine?.unitCount ?? '—'}</div>
                        <div className="text-[8px] uppercase text-zinc-600">units</div>
                      </div>
                    </div>
                    <div className="mt-2 text-[9px] leading-snug text-zinc-500 line-clamp-2">
                      {orbPresence?.spine?.recentEntries?.[0]?.title || 'Waiting for the shared knowledge spine.'}
                    </div>
                  </div>

                  {!isVisionActive ? (
                    <div className="flex flex-col items-center justify-center h-32 text-center border border-dashed border-white/5 rounded-xl">
                      <span className="text-zinc-600 text-[10px] uppercase tracking-widest">Vision Daemon Offline</span>
                      <span className="text-zinc-700 text-[9px] mt-1">COS system required</span>
                    </div>
                  ) : !lastFrameUrl ? (
                    <div className="flex flex-col items-center justify-center h-32 text-center border border-white/5 rounded-xl bg-white/5">
                      <span className="text-zinc-500 text-[10px] uppercase tracking-widest animate-pulse">Initialising perception...</span>
                    </div>
                  ) : (
                    <div 
                      className={`relative rounded-xl overflow-hidden border border-white/10 ${editingProposalId ? 'cursor-crosshair' : ''}`}
                      onClick={handleImageClick}
                    >
                      {/* Frame */}
                      <img
                        src={lastFrameUrl}
                        alt="SOMA Vision"
                        className="w-full object-cover select-none pointer-events-none"
                        style={{ maxHeight: '180px' }}
                      />
                      {/* Scanlines */}
                      <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.2)_50%)] bg-[length:100%_3px] pointer-events-none opacity-40" />
                      {/* Ghost cursor */}
                      {activeGhostCursor && (
                        <div
                          className="absolute pointer-events-none transition-all duration-300"
                          style={{ left: `${activeGhostCursor.x}%`, top: `${activeGhostCursor.y}%`, transform: 'translate(-50%,-50%)' }}
                        >
                          <div 
                            className={`w-3.5 h-3.5 rounded-full border-2 bg-white/90 transition-transform ${
                              activeGhostCursor.isProposed 
                                ? 'border-purple-500/70 border-dashed animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.6)]' 
                                : activeGhostCursor.isEditing 
                                ? 'border-cyan-400 border-dashed animate-ping shadow-[0_0_8px_rgba(34,211,238,0.8)]' 
                                : 'border-fuchsia-500 shadow-[0_0_12px_rgba(217,70,239,0.9)] scale-125'
                            }`} 
                          />
                          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/85 border border-white/10 rounded px-1 py-0.5 text-[6px] font-mono text-zinc-300 whitespace-nowrap">
                            {activeGhostCursor.isProposed ? 'proposed' : activeGhostCursor.isEditing ? 'targeting' : 'aiming'}: {Math.round(activeGhostCursor.x * 19.2)},{Math.round(activeGhostCursor.y * 10.8)}
                          </div>
                        </div>
                      )}
                      {/* Corner markers */}
                      <div className="absolute top-2 left-2 w-3 h-3 border-t border-l border-white/20" />
                      <div className="absolute top-2 right-2 w-3 h-3 border-t border-r border-white/20" />
                      <div className="absolute bottom-2 left-2 w-3 h-3 border-b border-l border-white/20" />
                      <div className="absolute bottom-2 right-2 w-3 h-3 border-b border-r border-white/20" />
                      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/60 rounded-full text-[8px] font-mono text-zinc-500 uppercase tracking-wider">
                        {visionChannel} / {formatTimeAgo(lastFrameAt)}
                      </div>
                    </div>
                  )}

                  {/* Desktop Control Panel */}
                  {isVisionActive && (
                    <div className="rounded-xl border border-purple-500/10 bg-purple-500/[0.035] p-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-purple-300 font-mono">Desktop Control</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={async () => {
                              try {
                                setIsCapturing(true);
                                await captureDesktop();
                              } catch (e) {
                                toast.error(`Snapshot failed: ${e.message}`);
                              } finally {
                                setIsCapturing(false);
                              }
                            }}
                            disabled={isCapturing}
                            className="px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-[8px] font-mono uppercase tracking-wider text-purple-200 hover:bg-purple-500/20 disabled:opacity-50 transition-all"
                          >
                            {isCapturing ? 'Capturing...' : 'Snapshot'}
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                setIsProposing(true);
                                const resProposals = await proposeActions();
                                setProposals(resProposals);
                              } catch (e) {
                                toast.error(`Proposals failed: ${e.message}`);
                              } finally {
                                setIsProposing(false);
                              }
                            }}
                            disabled={isProposing || !lastFrameUrl}
                            className="px-2 py-0.5 rounded bg-fuchsia-500/10 border border-fuchsia-500/20 text-[8px] font-mono uppercase tracking-wider text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50 transition-all"
                          >
                            {isProposing ? 'Analyzing...' : 'Propose'}
                          </button>
                        </div>
                      </div>

                      {/* Proposals List Queue */}
                      {proposals.length > 0 && (
                        <div className="space-y-2 border-t border-purple-500/10 pt-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-[8px] uppercase tracking-widest text-zinc-500 font-mono">Action Queue</span>
                            <button
                              onClick={() => {
                                setProposals([]);
                                setEditingProposalId(null);
                              }}
                              className="text-[8px] font-mono text-zinc-500 hover:text-zinc-300"
                            >
                              Clear
                            </button>
                          </div>
                          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                            {proposals.map((prop) => {
                              const isEditing = editingProposalId === prop.id;
                              return (
                                <div
                                  key={prop.id}
                                  onMouseEnter={() => setHoveredProposalId(prop.id)}
                                  onMouseLeave={() => setHoveredProposalId(null)}
                                  className={`rounded-lg border p-2 space-y-2 transition-all ${
                                    isEditing 
                                      ? 'border-cyan-500/30 bg-cyan-950/[0.15]' 
                                      : 'border-white/5 bg-black/20 hover:border-purple-500/20'
                                  }`}
                                >
                                  {isEditing ? (
                                    <div className="space-y-1.5 text-[9px]">
                                      <div className="flex gap-1.5">
                                        <div className="flex-1">
                                          <label className="text-[7px] text-zinc-500 uppercase font-mono block">Action Type</label>
                                          <select
                                            value={prop.type}
                                            onChange={(e) => {
                                              const newType = e.target.value;
                                              setProposals(prev => prev.map(p => p.id === prop.id ? { ...p, type: newType } : p));
                                            }}
                                            className="w-full bg-zinc-900 border border-white/10 rounded px-1 py-0.5 text-[9px] text-white"
                                          >
                                            <option value="click">click</option>
                                            <option value="type">type</option>
                                            <option value="navigate">navigate</option>
                                          </select>
                                        </div>
                                        <div className="flex-1">
                                          <label className="text-[7px] text-zinc-500 uppercase font-mono block">Label</label>
                                          <input
                                            type="text"
                                            value={prop.label}
                                            onChange={(e) => {
                                              const newLabel = e.target.value;
                                              setProposals(prev => prev.map(p => p.id === prop.id ? { ...p, label: newLabel } : p));
                                            }}
                                            className="w-full bg-zinc-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white"
                                          />
                                        </div>
                                      </div>

                                      {/* Coordinate Inputs (if click or hover) */}
                                      {prop.type === 'click' && (
                                        <div className="space-y-1 bg-black/35 p-1.5 rounded border border-white/5">
                                          <span className="text-[7px] text-cyan-400 block font-mono">Tip: Click on screenshot above to aim</span>
                                          <div className="flex gap-2">
                                            <div className="flex-1">
                                              <label className="text-[7px] text-zinc-500 font-mono block">X Coordinate</label>
                                              <input
                                                type="number"
                                                value={prop.params?.x || 0}
                                                onChange={(e) => {
                                                  const newX = parseInt(e.target.value) || 0;
                                                  setProposals(prev => prev.map(p => p.id === prop.id ? { ...p, params: { ...p.params, x: newX } } : p));
                                                }}
                                                className="w-full bg-zinc-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white font-mono"
                                              />
                                            </div>
                                            <div className="flex-1">
                                              <label className="text-[7px] text-zinc-500 font-mono block">Y Coordinate</label>
                                              <input
                                                type="number"
                                                value={prop.params?.y || 0}
                                                onChange={(e) => {
                                                  const newY = parseInt(e.target.value) || 0;
                                                  setProposals(prev => prev.map(p => p.id === prop.id ? { ...p, params: { ...p.params, y: newY } } : p));
                                                }}
                                                className="w-full bg-zinc-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white font-mono"
                                              />
                                            </div>
                                          </div>
                                        </div>
                                      )}

                                      {/* Text Inputs (if type) */}
                                      {prop.type === 'type' && (
                                        <div>
                                          <label className="text-[7px] text-zinc-500 font-mono block">Text to Type</label>
                                          <input
                                            type="text"
                                            value={prop.params?.text || ''}
                                            onChange={(e) => {
                                              const newText = e.target.value;
                                              setProposals(prev => prev.map(p => p.id === prop.id ? { ...p, params: { ...p.params, text: newText } } : p));
                                            }}
                                            className="w-full bg-zinc-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white"
                                          />
                                        </div>
                                      )}

                                      {/* URL Inputs (if navigate) */}
                                      {prop.type === 'navigate' && (
                                        <div>
                                          <label className="text-[7px] text-zinc-500 font-mono block">URL</label>
                                          <input
                                            type="text"
                                            value={prop.params?.url || ''}
                                            onChange={(e) => {
                                              const newUrl = e.target.value;
                                              setProposals(prev => prev.map(p => p.id === prop.id ? { ...p, params: { ...p.params, url: newUrl } } : p));
                                            }}
                                            className="w-full bg-zinc-900 border border-white/10 rounded px-1.5 py-0.5 text-[9px] text-white"
                                          />
                                        </div>
                                      )}

                                      <div className="flex justify-end gap-1.5 pt-1">
                                        <button
                                          onClick={() => setEditingProposalId(null)}
                                          className="px-2 py-0.5 rounded bg-zinc-800 text-[8px] font-mono text-zinc-400"
                                        >
                                          Cancel
                                        </button>
                                        <button
                                          onClick={() => setEditingProposalId(null)}
                                          className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-500/30 text-[8px] font-mono text-cyan-200"
                                        >
                                          Save
                                        </button>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="space-y-1.5">
                                      <div className="flex items-start justify-between gap-1.5">
                                        <div>
                                          <div className="text-[10px] text-zinc-100 font-medium leading-snug">{prop.label}</div>
                                          <div className="text-[8px] font-mono text-zinc-500 uppercase tracking-wider mt-0.5">
                                            {prop.type} {prop.params?.x !== undefined ? `(${prop.params.x}, ${prop.params.y})` : prop.params?.text || prop.params?.url}
                                          </div>
                                        </div>
                                        <span className="text-[7px] font-mono bg-purple-500/10 text-purple-300 border border-purple-500/25 px-1 py-0.5 rounded">
                                          {prop.id}
                                        </span>
                                      </div>
                                      
                                      <div className="flex justify-end gap-1.5 border-t border-white/5 pt-1.5">
                                        <button
                                          onClick={() => {
                                            setProposals(prev => prev.filter(p => p.id !== prop.id));
                                          }}
                                          className="px-1.5 py-0.5 rounded border border-rose-500/20 text-rose-300 hover:bg-rose-500/10 text-[8px] font-mono"
                                        >
                                          Reject
                                        </button>
                                        <button
                                          onClick={() => setEditingProposalId(prop.id)}
                                          className="px-1.5 py-0.5 rounded border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/10 text-[8px] font-mono"
                                        >
                                          Edit
                                        </button>
                                        <button
                                          onClick={async () => {
                                            try {
                                              setIsExecuting(true);
                                              toast.info(`Executing SOMA proposal: ${prop.label}`);
                                              const res = await executeAction(prop.type, prop.params);
                                              if (res.success) {
                                                toast.success('Action executed successfully!');
                                                setProposals(prev => prev.filter(p => p.id !== prop.id));
                                                setTimeout(async () => {
                                                  try {
                                                    const diffData = await askWhatChanged();
                                                    if (diffData?.summary) {
                                                      toast.info(`Verification: ${diffData.summary}`, { autoClose: 6000 });
                                                    }
                                                  } catch (err) {
                                                    console.warn('Failed to fetch screen diff:', err);
                                                  }
                                                }, 1000);
                                              } else {
                                                toast.error(`Execution failed: ${res.error}`);
                                              }
                                            } catch (e) {
                                              toast.error(`Execution failed: ${e.message}`);
                                            } finally {
                                              setIsExecuting(false);
                                            }
                                          }}
                                          disabled={isExecuting}
                                          className="px-2 py-0.5 rounded bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 hover:bg-emerald-500/30 text-[8px] font-mono"
                                        >
                                          {isExecuting ? 'Executing...' : 'Approve'}
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Perception Timeline</span>
                      <span className="text-[8px] font-mono text-zinc-600">{(perceptionEvents || []).length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {(perceptionEvents || []).slice(0, 5).map(item => (
                        <div key={item.id} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-[10px] text-zinc-300">{item.title}</span>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              item.status === 'ok' ? 'bg-emerald-400' :
                              item.status === 'warn' ? 'bg-amber-400' :
                              'bg-fuchsia-400'
                            }`} />
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-2 text-[8px] uppercase tracking-wider text-zinc-600">
                            <span className="truncate">{item.detail || item.type}</span>
                            <span>{formatTimeAgo(item.ts)}</span>
                          </div>
                        </div>
                      ))}
                      {!(perceptionEvents || []).length && (
                        <div className="text-[10px] text-zinc-600">Camera, frame, and channel events will appear here.</div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-cyan-500/10 bg-cyan-500/[0.035] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-300">Scene Memory</span>
                      <span className="text-[8px] font-mono text-zinc-600">{sceneMemory?.count || 0}/50</span>
                    </div>
                    <div className="rounded-lg border border-white/5 bg-black/25 px-2 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[8px] uppercase tracking-widest text-zinc-600">Current</span>
                        <span className="text-[8px] font-mono uppercase text-zinc-500">{sceneMemory?.latest?.channel || visionChannel}</span>
                      </div>
                      <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-zinc-300">
                        {sceneMemory?.latest?.summary || lastPerception?.scene?.summary || 'Waiting for a scene snapshot.'}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      <div className="rounded border border-white/5 bg-black/20 px-1.5 py-1.5 text-center">
                        <div className="text-[10px] font-mono text-cyan-200">{Math.round(((sceneMemory?.latest?.changeScore ?? 0) * 100))}%</div>
                        <div className="text-[7px] uppercase tracking-wider text-zinc-600">change</div>
                      </div>
                      <div className="rounded border border-white/5 bg-black/20 px-1.5 py-1.5 text-center">
                        <div className="text-[10px] font-mono text-zinc-300">{formatTimeAgo((sceneMemory?.latest?.timestamp || Date.now()) - (sceneMemory?.stableForMs || 0))}</div>
                        <div className="text-[7px] uppercase tracking-wider text-zinc-600">stable</div>
                      </div>
                      <div className="rounded border border-white/5 bg-black/20 px-1.5 py-1.5 text-center">
                        <div className="text-[10px] font-mono text-fuchsia-200">{Math.round(((whatChanged?.confidence ?? 0.55) * 100))}%</div>
                        <div className="text-[7px] uppercase tracking-wider text-zinc-600">conf</div>
                      </div>
                    </div>
                    <div className="mt-2 rounded-lg border border-white/5 bg-black/25 px-2 py-1.5">
                      <div className="text-[8px] uppercase tracking-widest text-zinc-600">Last Change</div>
                      <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-zinc-400">
                        {whatChanged?.summary || sceneMemory?.lastChange?.summary || 'No meaningful change detected yet.'}
                      </div>
                    </div>
                    <button
                      onClick={() => askWhatChanged?.().catch(() => {})}
                      className="mt-2 w-full rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1.5 text-[9px] font-bold uppercase tracking-widest text-cyan-200 transition-all hover:bg-cyan-500/15"
                    >
                      Ask What Changed
                    </button>
                  </div>

                  {/* Detected objects */}
                  {lastPerception?.objects?.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-mono">Detected</p>
                      {lastPerception.objects.slice(0, 6).map((obj, i) => (
                        <div key={i} className="flex items-center justify-between px-2 py-1 rounded bg-fuchsia-500/5 border border-fuchsia-500/10">
                          <span className="text-[10px] text-fuchsia-300 font-mono">{obj.label}</span>
                          <span className="text-[9px] text-zinc-500 font-mono">{(obj.score * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {orbPresence?.activity?.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-mono">Recent Activity</p>
                      {orbPresence.activity.slice(0, 4).map((item, i) => (
                        <div key={item.id || i} className="rounded-lg border border-white/5 bg-white/[0.03] px-2 py-1.5">
                          <div className="truncate text-[10px] text-zinc-300">{item.action || item.message || item.title || item.type || 'Activity'}</div>
                          {(item.detail || item.agent) && (
                            <div className="mt-0.5 truncate text-[8px] uppercase tracking-wider text-zinc-600">{item.agent || item.detail}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Channel selector */}
                  {isVisionActive && (
                    <div className="space-y-1.5">
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest font-mono">Channel</p>
                      <div className="flex gap-2">
                        {['desktop', 'webcam'].map(ch => (
                          <button
                            key={ch}
                            onClick={() => setVisionChannel(ch)}
                            className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                              visionChannel === ch
                                ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-300'
                                : 'bg-white/5 border-white/5 text-zinc-600 hover:text-zinc-400'
                            }`}
                          >
                            {ch}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>

            {/* SOMA Presence re-expand button — visible when panel is collapsed */}
            <AnimatePresence>
              {orbVisionCollapsed && (
                <motion.div
                  className="absolute top-8 right-4 z-30"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 250 }}
                >
                  <button
                    onClick={() => setOrbVisionCollapsed(false)}
                    className="p-2.5 rounded-full border bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400 hover:bg-fuchsia-500/20 transition-all"
                    title="Expand SOMA Presence"
                  >
                    <Sparkles className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

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

        {/* SIMULATION & SOCIAL MODULES */}
        {activeModule === 'simulation' && <SimulationSuite />}
        {(activeModule === 'social' || activeModule === 'twitch') && <SocialModule isConnected={isConnected} />}
        {activeModule === 'studio' && <div className="min-h-0 flex-1 overflow-hidden"><StudioModule /></div>}





        {/* ANALYTICS MODULE - removed, real metrics moved to Command Center */}
        {false && (
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

        {/* THIRD PLACE MODULE */}
        {activeModule === 'thirdplace' && <ThirdPlace />}

        {/* GRAY MATTER NETWORK */}
        {activeModule === 'graymatter' && <GrayMatterPanel />}

        {/* AXIS CHAT MODULE */}
        {activeModule === 'axis' && <AxisApp />}

        {/* STORAGE / FILE INTELLIGENCE MODULE */}
        {activeModule === 'storage' && <FileIntelligenceApp />}

        {/* KNOWLEDGE MODULE */}
        {activeModule === 'knowledge' && <KnowledgeApp brainStats={brainStats} />}
        {activeModule === 'reflections' && <ReflectionsTab />}

        {/* Spine is accessible via the Runtime Map button in Command Center */}


        {/* WORKFLOW MODULE - removed, non-functional */}
        {false && (
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
            {activeModule !== 'pulse' && !showSteve && <WorkflowSteve onNavigate={setActiveModule} />}
          </div>
        )}

        {activeModule === 'command' && (
          <CommandCenterPanel
            executeCommand={executeCommand}
            setShowDiagnostics={setShowDiagnostics}
            setDiagnosticLogs={setDiagnosticLogs}
            activeArbiters={activeArbiters}
            totalArbiters={totalArbiters}
            activeMicroAgents={activeMicroAgents}
            totalMicroAgents={totalMicroAgents}
            totalFragments={totalFragments}
            systemMetrics={systemMetrics}
            analyticsSummary={analyticsSummary}
            activityStream={activityStream}
            isConnected={isConnected}
            formatUptime={formatUptime}
          />
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
            wakeWordActive={wakeWordActive}
            onWakeWordToggle={handleWakeWordToggle}
          />
        )}

        {/* FORECASTER MODULE */}
        {activeModule === 'forecaster' && (
          <div className="flex-1 h-full overflow-hidden">
            <ForecasterApp />
          </div>
        )}

        {activeModule === 'aperture' && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-zinc-400">Opening Aperture...</div>}>
            <ApertureOS />
          </Suspense>
        )}

        {/* DEFAULT FALLBACK */}
        {!['terminal', 'orb', 'kevin', 'simulation', 'studio', 'core', 'arbiters', 'knowledge', 'reflections', 'storage', 'command', 'spine', 'settings', 'mission_control', 'forecaster', 'marketplace', 'finance', 'arbiterium', 'pulse', 'axis', 'thirdplace', 'graymatter', 'aperture'].includes(activeModule) && (
          <div className="flex items-center justify-center h-full text-zinc-600 italic">
            Integration for Module "{activeModule}" is ongoing...
          </div>
        )}
      </div>

      {/* Global SOMA Chat - Available on all tabs except terminal and pulse */}
      {activeModule !== 'terminal' && activeModule !== 'pulse' && (
        <FloatingChat
          isServerRunning={isConnected}
          isBusy={isSomaBusy}
          onSendMessage={handleFloatingChatSubmit}
          activeModule={activeModule}
          activeQuestion={activeQuestion}
          onSendQuestionResponse={handleSendQuestionResponse}
          tensionLevel={tensionLevel}
        />
      )}


      {/* Floating Quick-Note button */}
      {activeModule !== 'reflections' && activeModule !== 'terminal' && (
        <button
          onClick={() => setShowQuickNote(v => !v)}
          title="Quick Note (Ctrl+Shift+N)"
          className="fixed right-5 top-1/2 -translate-y-1/2 z-[90] w-11 h-11 rounded-2xl bg-zinc-900/90 backdrop-blur-sm border border-zinc-700/40 hover:border-fuchsia-500/50 shadow-lg hover:shadow-fuchsia-500/10 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-90 group"
        >
          <Pencil className="w-4 h-4 text-zinc-500 group-hover:text-fuchsia-400 transition-colors duration-200" />
        </button>
      )}

      {/* Quick-Note overlay panel */}
      {showQuickNote && (
        <div className="fixed right-0 top-0 bottom-0 w-[480px] z-[95] shadow-2xl border-l border-white/10">
          <ReflectionsTab
            mode="quick-note-only"
            onClose={() => setShowQuickNote(false)}
            context={activeModule}
            onSendToSoma={(text) => handleFloatingChatSubmit(text, { history: [], activeModule })}
          />
        </div>
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
