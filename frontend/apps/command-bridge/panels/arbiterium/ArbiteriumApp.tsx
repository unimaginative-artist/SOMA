import React, { useState, useEffect, useRef } from 'react';
import somaBackend from '../../somaBackend';
import {
  Arbiter, ArbiterStatus, WorkflowPlan, TaskStatus, ChatMessage, Session, WorkflowStep
} from './types';
import { orchestrateGoal, executeWorkflow, fetchAvailableTools, saveSession, loadSessions, loadSession, deleteSession as deleteSessionApi, notifyWorkflowComplete } from './services/arbiteriumService';
import ArbiterGrid from './components/ArbiterGrid';
import WorkflowVisualizer from './components/WorkflowVisualizer';
import TaskMonitor from './components/TaskMonitor';
import TaskDetailPanel from './components/TaskDetailPanel';
import PlanOverview from './components/PlanOverview';
import {
  Terminal, Users, Home, Layers, Activity,
  Plus, ArrowUp, Zap, Skull, MessageSquare, Clock,
  FileText, X, Brain, Wrench, Database
} from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 9);

const createInitialSession = (): Session => ({
  id: generateId(),
  title: 'New Operation',
  messages: [],
  plan: null,
  arbiters: [], // Populated by real system arbiters via WebSocket
  lastActive: Date.now()
});

const CyberGrid = ({ isActive }: { isActive: boolean }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;
    let animationFrame: number;
    let offset = 0;

    const render = () => {
      // Clear
      ctx.clearRect(0, 0, width, height);

      // Grid Animation Speed
      // When active, the grid flows faster
      const speed = isActive ? 0.35 : 0.1;
      offset = (offset + speed) % 40; // Modulo grid size

      // Grid Styles
      const gridSize = 40;
      // Cleaner, more subtle lines
      ctx.lineWidth = 1;

      // Draw Grid
      ctx.beginPath();

      // Vertical Lines (Pan right-down)
      for (let x = offset - gridSize; x < width; x += gridSize) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }

      // Horizontal Lines
      for (let y = offset - gridSize; y < height; y += gridSize) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }

      ctx.strokeStyle = isActive ? 'rgba(168, 85, 247, 0.1)' : 'rgba(255, 255, 255, 0.03)';
      ctx.stroke();

      // --- Stylization ---

      // 1. Vignette Mask (Softens edges to blend with UI)
      const vignette = ctx.createRadialGradient(width / 2, height / 2, width * 0.3, width / 2, height / 2, width * 0.85);
      vignette.addColorStop(0, 'rgba(9, 4, 16, 0)');
      vignette.addColorStop(1, 'rgba(9, 4, 16, 1)'); // Matches bg-cyber-base (#090410) roughly

      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, width, height);

      // 2. Active Scanline (If active)
      if (isActive) {
        const time = Date.now() * 0.0005;
        const scanPos = (time * height) % (height * 1.5) - (height * 0.25); // Moves down

        const scanGradient = ctx.createLinearGradient(0, scanPos, 0, scanPos + 150);
        scanGradient.addColorStop(0, 'rgba(168, 85, 247, 0)');
        scanGradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.08)'); // Very subtle purple scan
        scanGradient.addColorStop(1, 'rgba(168, 85, 247, 0)');

        ctx.fillStyle = scanGradient;
        ctx.fillRect(0, scanPos, width, 150);
      }

      animationFrame = requestAnimationFrame(render);
    };
    render();

    const handleResize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener('resize', handleResize);
    };
  }, [isActive]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none z-0" />;
};

// ── Engineering Swarm UI ─────────────────────────────────────────────────────

const PHASES = ['research', 'plan', 'debate', 'synthesis', 'transaction', 'verification', 'optimization'];

const SwarmView: React.FC = () => {
  const [filepath, setFilepath] = React.useState('');
  const [request, setRequest] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [phases, setPhases] = React.useState<Array<{ phase: string; message: string; progress: number; status: 'pending' | 'active' | 'done' | 'error' }>>([]);
  const [done, setDone] = React.useState<{ success: boolean; message: string } | null>(null);
  const logRef = React.useRef<HTMLDivElement>(null);

  const start = async () => {
    if (!filepath.trim() || !request.trim() || running) return;
    setRunning(true);
    setDone(null);
    setPhases(PHASES.map(p => ({ phase: p, message: '', progress: 0, status: 'pending' })));

    try {
      const resp = await fetch('/api/soma/engineering/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: filepath.trim(), request: request.trim() })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        setDone({ success: false, message: err.error || 'Request failed' });
        setRunning(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.phase === 'start') continue;
            if (ev.phase === 'complete' || ev.phase === 'error') {
              setDone({ success: ev.success ?? ev.phase !== 'error', message: ev.message });
              setPhases(prev => prev.map(p => p.status === 'active' ? { ...p, status: 'done' } : p));
            } else {
              setPhases(prev => prev.map(p => {
                if (p.phase === ev.phase) return { ...p, message: ev.message, progress: ev.progress, status: 'active' };
                if (p.status === 'active') return { ...p, status: 'done' };
                return p;
              }));
            }
          } catch { /* skip malformed */ }
        }
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
      }
    } catch (err: any) {
      setDone({ success: false, message: err.message });
    } finally {
      setRunning(false);
    }
  };

  const phaseColor = (status: string) => {
    if (status === 'done') return 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10';
    if (status === 'active') return 'text-cyber-primary border-cyber-primary/50 bg-cyber-primary/10 animate-pulse';
    if (status === 'error') return 'text-rose-400 border-rose-500/40 bg-rose-500/10';
    return 'text-cyber-muted border-white/10 bg-white/5';
  };

  return (
    <div className="h-full glass-panel rounded-xl p-5 flex flex-col gap-4 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <Wrench className="w-4 h-4 text-amber-400" />
        <h2 className="text-lg font-bold text-cyber-white tracking-tight">Engineering Swarm</h2>
        <span className="text-[10px] font-mono text-cyber-muted ml-auto">7-PHASE AUTONOMOUS CYCLE</span>
      </div>

      {/* Input */}
      <div className="flex flex-col gap-2 shrink-0">
        <input
          type="text"
          placeholder="File path (e.g. arbiters/SomeArbiter.js)"
          value={filepath}
          onChange={e => setFilepath(e.target.value)}
          disabled={running}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-cyber-white placeholder-cyber-muted/50 font-mono focus:outline-none focus:border-cyber-primary/50 disabled:opacity-50"
        />
        <textarea
          placeholder="Describe the modification request..."
          value={request}
          onChange={e => setRequest(e.target.value)}
          disabled={running}
          rows={2}
          className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-cyber-white placeholder-cyber-muted/50 focus:outline-none focus:border-cyber-primary/50 resize-none disabled:opacity-50"
        />
        <button
          onClick={start}
          disabled={running || !filepath.trim() || !request.trim()}
          className="self-start px-5 py-2 rounded-lg bg-cyber-primary/20 border border-cyber-primary/40 text-cyber-primary text-[11px] font-black tracking-widest uppercase hover:bg-cyber-primary/30 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {running ? 'RUNNING...' : 'ENGAGE SWARM'}
        </button>
      </div>

      {/* Phase tracker */}
      {phases.length > 0 && (
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0" ref={logRef}>
          {phases.map((p) => (
            <div key={p.phase} className={`flex items-start gap-3 px-3 py-2 rounded-lg border text-[11px] font-mono transition-all ${phaseColor(p.status)}`}>
              <span className="uppercase font-black tracking-wider shrink-0 w-24">{p.phase}</span>
              <div className="flex-1 min-w-0">
                {p.message && <span className="opacity-80 break-words">{p.message}</span>}
                {p.status === 'active' && p.progress > 0 && (
                  <div className="mt-1 h-0.5 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full bg-cyber-primary rounded-full transition-all duration-500" style={{ width: `${p.progress}%` }} />
                  </div>
                )}
              </div>
              <span className="shrink-0 text-[9px] opacity-60">{p.status === 'done' ? '✓' : p.status === 'active' ? '▶' : '○'}</span>
            </div>
          ))}
          {done && (
            <div className={`px-3 py-2 rounded-lg border text-[11px] font-mono ${done.success ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10' : 'text-rose-400 border-rose-500/40 bg-rose-500/10'}`}>
              <span className="font-black">{done.success ? '✓ COMPLETE' : '✗ FAILED'}</span>
              <span className="ml-2 opacity-80">{done.message}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── CNS: Central Nervous System live signal feed ─────────────────────────────

interface CNSEvent {
  id: string;
  topic: string;
  payload: any;
  ts: number;
}

const TOPIC_COLOR: Record<string, string> = {
  health:    'text-emerald-400',
  swarm:     'text-purple-400',
  goal:      'text-fuchsia-400',
  user:      'text-cyan-400',
  repo:      'text-amber-400',
  market:    'text-blue-400',
  attention: 'text-rose-400',
  signal:    'text-indigo-400',
};

const topicColor = (topic: string) => {
  const prefix = Object.keys(TOPIC_COLOR).find(k => topic.startsWith(k));
  return prefix ? TOPIC_COLOR[prefix] : 'text-cyber-muted';
};

const CNSView: React.FC = () => {
  const [events, setEvents] = React.useState<CNSEvent[]>([]);
  const [filter, setFilter] = React.useState('');
  const [paused, setPaused] = React.useState(false);
  const pausedRef = React.useRef(false);

  React.useEffect(() => { pausedRef.current = paused; }, [paused]);

  React.useEffect(() => {
    const onSignal = (payload: any) => {
      if (pausedRef.current) return;
      setEvents(prev => [{
        id: Math.random().toString(36).slice(2),
        topic: payload.topic || 'unknown',
        payload: payload.payload ?? payload,
        ts: payload.ts || Date.now()
      }, ...prev].slice(0, 500));
    };

    // Also capture all other WS frame types as fallback so the feed is never empty
    const onAny = (payload: any) => {
      if (pausedRef.current) return;
      setEvents(prev => [{
        id: Math.random().toString(36).slice(2),
        topic: payload?._wsType || 'ws.frame',
        payload,
        ts: Date.now()
      }, ...prev].slice(0, 500));
    };

    // Patch somaBackend emit to capture all events
    const origEmit = (somaBackend as any).emit.bind(somaBackend);
    (somaBackend as any).emit = (event: string, data: any) => {
      origEmit(event, data);
      if (event === 'cns_signal') return; // handled by dedicated listener
      if (['connect', 'disconnect', 'connectionStateChange', 'reconnecting'].includes(event)) return;
      if (!pausedRef.current) {
        setEvents(prev => [{
          id: Math.random().toString(36).slice(2),
          topic: event,
          payload: data,
          ts: Date.now()
        }, ...prev].slice(0, 500));
      }
    };

    somaBackend.on('cns_signal', onSignal);

    return () => {
      somaBackend.off('cns_signal', onSignal);
      (somaBackend as any).emit = origEmit; // restore
    };
  }, []);

  const filtered = filter
    ? events.filter(e => e.topic.toLowerCase().includes(filter.toLowerCase()))
    : events;

  return (
    <div className="h-full glass-panel rounded-xl p-4 flex flex-col gap-3 overflow-hidden">
      <div className="flex items-center gap-2 shrink-0">
        <Activity className="w-4 h-4 text-emerald-400" />
        <h2 className="text-lg font-bold text-cyber-white tracking-tight">CNS Signal Feed</h2>
        <span className="text-[10px] font-mono text-cyber-muted ml-auto">{events.length} EVENTS</span>
        <button
          onClick={() => setPaused(p => !p)}
          className={`px-3 py-1 rounded text-[10px] font-black uppercase tracking-wider border transition-all ${paused ? 'text-amber-400 border-amber-500/40 bg-amber-500/10' : 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10'}`}
        >
          {paused ? 'PAUSED' : 'LIVE'}
        </button>
        <button
          onClick={() => setEvents([])}
          className="px-3 py-1 rounded text-[10px] font-black uppercase tracking-wider border border-white/10 text-cyber-muted hover:text-rose-400 hover:border-rose-500/40 transition-all"
        >
          CLEAR
        </button>
      </div>

      <input
        type="text"
        placeholder="Filter by topic..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
        className="shrink-0 w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-[11px] text-cyber-white placeholder-cyber-muted/50 font-mono focus:outline-none focus:border-cyber-primary/50"
      />

      <div className="flex-1 overflow-y-auto min-h-0 space-y-px font-mono text-[10px]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-cyber-muted opacity-40">
            <Activity className="w-8 h-8 mb-2" />
            <p className="uppercase tracking-widest font-black text-[9px]">Awaiting signals...</p>
            <p className="mt-1 opacity-60 text-center">MessageBroker signals and WS events appear here in real-time</p>
          </div>
        ) : (
          filtered.map(ev => (
            <div key={ev.id} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-white/5 transition-colors group cursor-default">
              <span className="text-white/20 shrink-0 tabular-nums">
                {new Date(ev.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className={`shrink-0 font-black w-36 truncate ${topicColor(ev.topic)}`}>{ev.topic}</span>
              <span className="text-white/40 truncate flex-1 group-hover:whitespace-normal group-hover:break-all">
                {typeof ev.payload === 'object' ? JSON.stringify(ev.payload) : String(ev.payload ?? '')}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface ArbiteriumAppProps {
  systemArbiters?: any[];
  onToggleArbiter?: (id: string) => void;
  onRestartArbiter?: (id: string) => void;
  onSendMessage?: (message: string | { text: string; deepThinking: boolean }) => void;
  lastSystemResponse?: any;
}

const ArbiteriumApp: React.FC<ArbiteriumAppProps> = ({ systemArbiters, onToggleArbiter, onRestartArbiter, onSendMessage, lastSystemResponse }) => {
  // State: List of sessions and the ID of the currently viewed one
  const [sessions, setSessions] = useState<Session[]>([createInitialSession()]);
  const [activeSessionId, setActiveSessionId] = useState<string>(sessions[0].id);
  const [isConnected, setIsConnected] = useState(false); // Connection status

  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDeepThinking, setIsDeepThinking] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | undefined>(undefined);
  const [isPaused, setIsPaused] = useState(false);


  // Store user customizations (Name, Description, Avatar) to persist across system updates
  const [arbiterOverrides, setArbiterOverrides] = useState<Record<string, Partial<Arbiter>>>(() => {
    try {
      const saved = localStorage.getItem('soma_arbiter_overrides');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.warn('Failed to load arbiter overrides:', e);
      return {};
    }
  });

  // Registry: all arbiter files discovered on disk (loaded + unloaded)
  const [registryArbiters, setRegistryArbiters] = useState<Arbiter[]>([]);
  const [registryStats, setRegistryStats] = useState({ total: 0, loaded: 0, available: 0 });

  // Available tools from backend ToolRegistry
  const [availableTools, setAvailableTools] = useState<Array<{ name: string; description: string; category?: string }>>([]);

  // Session persistence state
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch arbiter registry from filesystem scan
  useEffect(() => {
    fetch('/api/arbiterium/registry')
      .then(r => r.json())
      .then(data => {
        if (data.success && data.arbiters) {
          setRegistryStats({ total: data.total, loaded: data.loaded, available: data.available });
          const mapped: Arbiter[] = data.arbiters.map((ra: any) => ({
            id: `registry-${ra.file}`,
            name: ra.name,
            role: ra.role || 'specialist',
            description: ra.description || `Arbiter from ${ra.file}`,
            status: ra.loaded ? ArbiterStatus.IDLE : ArbiterStatus.OFFLINE,
            capabilities: [ra.role || 'specialist'],
            healthScore: ra.loaded ? 100 : 0,
            load: 0
          }));
          setRegistryArbiters(mapped);
        }
      })
      .catch(err => console.warn('[Arbiterium] Registry fetch failed:', err));
  }, []);

  // Fetch available tools from backend
  useEffect(() => {
    fetchAvailableTools().then(tools => setAvailableTools(tools));
  }, []);

  // Restore saved sessions from backend on mount
  useEffect(() => {
    if (sessionsLoaded) return;
    loadSessions().then(async (summaries) => {
      if (summaries.length === 0) {
        setSessionsLoaded(true);
        return;
      }
      // Load the most recent session fully, keep others as summaries
      const loaded = await loadSession(summaries[0].id);
      if (loaded) {
        const restoredSession: Session = {
          id: loaded.id,
          title: loaded.title || 'Restored',
          messages: loaded.messages || [],
          plan: loaded.plan || null,
          arbiters: [], // Will be populated by WebSocket sync
          lastActive: loaded.lastActive || Date.now()
        };
        setSessions(prev => {
          // Only add if not already present
          const exists = prev.some(s => s.id === restoredSession.id);
          if (exists) return prev;
          return [restoredSession, ...prev];
        });
      }
      setSessionsLoaded(true);
    }).catch(() => setSessionsLoaded(true));
  }, []);

  // Persist overrides to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem('soma_arbiter_overrides', JSON.stringify(arbiterOverrides));
    } catch (e) {
      console.warn('Failed to save arbiter overrides:', e);
    }
  }, [arbiterOverrides]);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Derived state for the current view
  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const isSystemActive = activeSession.plan?.steps.some(s => s.status === TaskStatus.IN_PROGRESS) ?? false;

  // Scroll chat to bottom when active session messages change
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTo({
        top: chatContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [activeSession.messages, activeSessionId]);

  // Monitor connection status based on system arbiters
  useEffect(() => {
    setIsConnected(systemArbiters && systemArbiters.length > 0);
  }, [systemArbiters]);

  // Sync System Arbiters
  useEffect(() => {
    if (systemArbiters && systemArbiters.length > 0) {
      setSessions(prev => prev.map(session => {
        // Map system arbiters to Arbiter type
        const mappedArbiters: Arbiter[] = systemArbiters.map(sa => {
          const override = arbiterOverrides[sa.id] || {};
          return {
            id: sa.id,
            name: override.name || sa.name,
            role: sa.type || 'System Agent',
            description: override.description || sa.description || getArbiterDescription(sa.name, sa.type),
            status: sa.status === 'active' ? ArbiterStatus.BUSY : sa.status === 'stopped' ? ArbiterStatus.OFFLINE : ArbiterStatus.IDLE,
            capabilities: sa.capabilities || [],
            healthScore: sa.load !== undefined ? Math.round(100 - (sa.load / 2)) : 100, // Heuristic: Health vs Load
            load: sa.load,
            avatarUrl: override.avatarUrl // Use override if exists, otherwise undefined (let Grid handle default)
          };
        });

        // Merge with existing session arbiters if needed
        return {
          ...session,
          arbiters: mappedArbiters
        };
      }));
    }
  }, [systemArbiters, arbiterOverrides]); // Re-run when overrides change

  const handleUpdateArbiter = (id: string, updates: Partial<Arbiter>) => {
    // 1. Update Overrides
    setArbiterOverrides(prev => ({
      ...prev,
      [id]: { ...prev[id], ...updates }
    }));

    // 2. Immediate Local Update (for responsiveness)
    setSessions(prev => prev.map(s => s.id === activeSessionId ? {
      ...s,
      arbiters: s.arbiters.map(a => a.id === id ? { ...a, ...updates } : a)
    } : s));
  };

  // Handle incoming system responses
  useEffect(() => {
    if (lastSystemResponse) {
      console.log('Arbiterium received response:', lastSystemResponse);

      updateActiveSession(s => {
        // Avoid duplicate messages if possible, though basic check is by ID or timestamp
        // For now, simple append
        const newMsg: ChatMessage = {
          id: Date.now().toString() + '_sys',
          sender: 'orchestrator',
          text: lastSystemResponse?.text || (typeof lastSystemResponse === 'string' ? lastSystemResponse : JSON.stringify(lastSystemResponse)),
          timestamp: Date.now()
        };

        // Remove "thinking" message if exists
        const msgs = s.messages.filter(m => m.id !== 'thinking');
        return { ...s, messages: [...msgs, newMsg] };
      });
      setIsProcessing(false);
    }
  }, [lastSystemResponse]);

  function getArbiterDescription(name: string, role: string): string {
    const n = name.toLowerCase();
    const r = (role || '').toLowerCase();

    if (n.includes('engineer') || n.includes('coding')) return 'Adversarial coding swarm. Self-modifies code safely.';
    if (n.includes('security') || n.includes('council')) return 'Threat analysis & system protection unit.';
    if (n.includes('finance') || n.includes('market')) return 'Real-time market analysis and portfolio management.';
    if (n.includes('research') || r.includes('research')) return 'Deep web synthesis and fact verification.';
    if (n.includes('manager') || n.includes('context')) return 'Maintains workspace state and project blueprints.';

    if (r.includes('defensive')) return 'System defense and integrity monitoring.';
    if (r.includes('analytical')) return 'Data processing and insight generation.';
    if (r.includes('orchestrator')) return 'High-level task delegation and planning.';

    return 'Specialized SOMA micro-agent unit.';
  }

  // --- SIMULATION LOOP REMOVED ---
  // The backend now drives state updates via systemArbiters and messages.
  // We keep this placeholder comment to indicate where the loop was.

  const updateActiveSession = (updater: (s: Session) => Session) => {
    setSessions(prev => prev.map(s => s.id === activeSessionId ? updater(s) : s));
  };

  // Debounced auto-save: saves active session to backend after changes settle
  const triggerAutoSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const session = sessions.find(s => s.id === activeSessionId);
      if (session && session.messages.length > 0) {
        // Strip arbiters from save (they're transient from WebSocket)
        const { arbiters, ...toSave } = session;
        saveSession(toSave).catch(() => {});
      }
    }, 2000); // 2 second debounce
  };



  const handleSendMessage = async () => {
    if (!input.trim() || isProcessing) return;

    const userText = input;
    const userMsg: ChatMessage = { id: Date.now().toString(), sender: 'user', text: userText, timestamp: Date.now() };

    // 1. Optimistically update UI
    updateActiveSession(s => ({ 
      ...s, 
      messages: [...s.messages, userMsg],
      lastActive: Date.now()
    }));
    setInput('');
    setIsProcessing(true);

    try {
      // 2. Add thinking indicator
      updateActiveSession(s => ({
        ...s,
        messages: [...s.messages, { id: 'thinking', sender: 'orchestrator', text: 'Orchestrating workflow...', timestamp: Date.now() }]
      }));

      // 3. Call REAL orchestration backend
      const plan = await orchestrateGoal(userText, isDeepThinking);
      
      // 4. Update session with the plan
      const memoryMsg = plan.memoriesRecalled && plan.memoriesRecalled.length > 0
        ? ` (${plan.memoriesRecalled.length} past memories recalled)`
        : '';
      const warningMsg = (plan as any).warnings?.length > 0
        ? `\n⚠️ ${(plan as any).warnings.join(' | ')}`
        : '';
      updateActiveSession(s => ({
        ...s,
        title: plan.goal.substring(0, 30) + (plan.goal.length > 30 ? '...' : ''),
        plan: plan,
        messages: s.messages.filter(m => m.id !== 'thinking').concat({
          id: Date.now().toString() + '_resp',
          sender: 'orchestrator',
          text: `Plan formulated: ${plan.summary}${memoryMsg}${warningMsg}`,
          timestamp: Date.now(),
          relatedPlanId: 'current'
        })
      }));

      // 5. Auto-execute the workflow
      await executeWorkflow(
        plan,
        (step) => {
          // Step Start
          updateActiveSession(s => {
            if (!s.plan) return s;
            return {
              ...s,
              plan: {
                ...s.plan,
                steps: s.plan.steps.map(st => st.id === step.id ? { ...st, status: TaskStatus.IN_PROGRESS, logs: [`Executing via ${st.assignedArbiterRole}...`] } : st)
              }
            };
          });
        },
        (step, output, toolsUsed) => {
          // Step Complete
          updateActiveSession(s => {
            if (!s.plan) return s;
            const toolLog = toolsUsed && toolsUsed.length > 0
              ? `Tools used: ${toolsUsed.map(t => t.name).join(', ')}`
              : 'Result verified.';
            return {
              ...s,
              plan: {
                ...s.plan,
                steps: s.plan.steps.map(st => st.id === step.id ? { ...st, status: TaskStatus.COMPLETED, output, toolsUsed: toolsUsed || [], logs: [...st.logs, toolLog] } : st),
              },
              messages: [...s.messages, {
                  id: Date.now().toString() + '_' + step.id,
                  sender: 'orchestrator',
                  text: `Step "${step.description}" completed by ${step.assignedArbiterRole}.${toolsUsed && toolsUsed.length > 0 ? ` [${toolsUsed.length} tool${toolsUsed.length > 1 ? 's' : ''} used]` : ''}`,
                  timestamp: Date.now()
              }]
            };
          });
          triggerAutoSave(); // Auto-save after each step
        },
        (step, error) => {
          // Step Failed
          updateActiveSession(s => {
            if (!s.plan) return s;
            return {
              ...s,
              plan: {
                ...s.plan,
                steps: s.plan.steps.map(st => st.id === step.id ? { ...st, status: TaskStatus.FAILED, logs: [...st.logs, `Error: ${error}`] } : st)
              }
            };
          });
        }
      );

      // 6. Workflow complete — notify backend to form long-term memory
      notifyWorkflowComplete(plan).catch(() => {});
      triggerAutoSave();

    } catch (err) {
      console.error('[Arbiterium] Orchestration/Execution failed:', err);
      updateActiveSession(s => ({
        ...s,
        messages: s.messages.filter(m => m.id !== 'thinking').concat({
          id: Date.now().toString() + '_err',
          sender: 'orchestrator',
          text: `System Failure: ${err instanceof Error ? err.message : 'Unknown error during orchestration.'}`,
          timestamp: Date.now()
        })
      }));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleNewTask = () => {
    const newSession = createInitialSession();
    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setSelectedStepId(undefined);
    setActiveTab('dashboard');
  };

  const handleDeleteSession = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSessionApi(id).catch(() => {}); // Also delete from backend
    if (sessions.length === 1) {
      // If last session, just reset it
      const reset = createInitialSession();
      setSessions([reset]);
      setActiveSessionId(reset.id);
    } else {
      const newSessions = sessions.filter(s => s.id !== id);
      setSessions(newSessions);
      if (activeSessionId === id) {
        setActiveSessionId(newSessions[0].id);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'agents': {
        // Merge: system-loaded arbiters take priority, then unloaded registry arbiters fill in
        const loadedNames = new Set(activeSession.arbiters.map(a => a.name.toLowerCase()));
        const unloadedRegistry = registryArbiters.filter(ra => !loadedNames.has(ra.name.toLowerCase()));
        const allArbiters = [...activeSession.arbiters, ...unloadedRegistry];
        return (
          <div className="h-full glass-panel rounded-xl p-5 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="text-lg font-bold text-cyber-white tracking-tight flex items-center gap-2"><Users className="w-4 h-4 text-cyber-primary" /> Arbiter Registry</h2>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">{registryStats.loaded || activeSession.arbiters.length} LOADED</span>
                <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-cyber-muted">{registryStats.available || unloadedRegistry.length} AVAILABLE</span>
                <span className="px-2 py-0.5 rounded bg-white/5 border border-white/10 text-cyber-muted">{registryStats.total || allArbiters.length} TOTAL</span>
              </div>
            </div>
            <div className="flex-1 min-w-0 min-h-0"><ArbiterGrid arbiters={allArbiters} layout="grid" variant="detailed" onUpdateArbiter={handleUpdateArbiter} /></div>
          </div>
        );
      }
      case 'micro-agents': {
        // Show agents that aren't core "Arbiters" — workers, helpers, micro-agents
        const loadedAgents = activeSession.arbiters.filter(a => !(a.name.includes('Arbiter') && !a.name.includes('Agent')));
        const loadedAgentNames = new Set(loadedAgents.map(a => a.name.toLowerCase()));
        const unloadedAgents = registryArbiters.filter(ra =>
          !(ra.name.includes('Arbiter') && !ra.name.includes('Agent')) &&
          !loadedAgentNames.has(ra.name.toLowerCase())
        );
        const allAgents = [...loadedAgents, ...unloadedAgents];
        return (
          <div className="h-full glass-panel rounded-xl p-5 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-3 shrink-0">
              <h2 className="text-lg font-bold text-cyber-white tracking-tight flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Specialized Agents</h2>
            </div>
            {allAgents.length > 0 ? (
              <div className="flex-1 min-w-0 min-h-0"><ArbiterGrid arbiters={allAgents} layout="grid" variant="detailed" onUpdateArbiter={handleUpdateArbiter} /></div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-cyber-muted opacity-50">
                <Zap className="w-12 h-12 mb-2" />
                <p className="text-sm font-bold tracking-widest uppercase">No Agents Deployed</p>
              </div>
            )}
          </div>
        );
      }
      case 'plan': return (
        <div className="h-full glass-panel rounded-xl overflow-hidden relative">
          <PlanOverview plan={activeSession.plan} />
        </div>
      );
      case 'tasks': return (
        <div className="h-full glass-panel rounded-xl flex overflow-hidden">
          <div className="w-1/2 border-r border-white/5 p-3 flex flex-col">
            <h3 className="text-sm font-bold text-cyber-white mb-3 flex items-center gap-2"><Layers className="w-4 h-4 text-cyber-primary" /> Execution Trace</h3>
            <div className="flex-1 overflow-hidden"><TaskMonitor steps={activeSession.plan?.steps || []} onSelectStep={setSelectedStepId} selectedStepId={selectedStepId} /></div>
          </div>
          <div className="w-1/2 p-3"><TaskDetailPanel step={activeSession.plan?.steps.find(s => s.id === selectedStepId)} onClose={() => setSelectedStepId(undefined)} /></div>
        </div>
      );
      case 'swarm': return <SwarmView />;
      case 'cns': return <CNSView />;
      case 'dashboard':
      default: return (
        <div className="grid grid-cols-12 gap-2 h-full">
          <div className="col-span-12 lg:col-span-8 flex flex-col gap-2 h-full min-h-0">
            {/* Visualization Widget */}
            <div className="flex-[2] glass-panel rounded-xl overflow-hidden flex flex-col shadow-glow group relative min-h-0 border border-white/5 hover:border-white/10 transition-colors">
              <div className="absolute top-2.5 left-3.5 z-10 flex items-center gap-2">
              <div className="flex items-center gap-2 px-2.5 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/5">
                  <div className={`w-1.5 h-1.5 rounded-full ${activeSession.plan ? 'bg-cyber-primary animate-pulse' : 'bg-cyber-muted'}`}></div>
                  <span className="text-[9px] font-black text-cyber-white/60 tracking-widest uppercase">TOPOLOGY</span>
                </div>
                {availableTools.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 backdrop-blur-md rounded-full border border-white/5">
                    <Wrench className="w-3 h-3 text-amber-400" />
                    <span className="text-[9px] font-mono text-amber-400/80">{availableTools.length} TOOLS</span>
                  </div>
                )}
                {activeSession.plan?.memoriesRecalled && activeSession.plan.memoriesRecalled.length > 0 && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-black/40 backdrop-blur-md rounded-full border border-purple-500/20">
                    <Database className="w-3 h-3 text-purple-400" />
                    <span className="text-[9px] font-mono text-purple-400/80">{activeSession.plan.memoriesRecalled.length} MEMORIES</span>
                  </div>
                )}
              </div>
              <div className="flex-1 relative overflow-hidden">
                {/* Active Background Animation */}
                <CyberGrid isActive={isSystemActive} />

                {/* Idle Background Overlay (subtle vignette when active) */}
                <div className={`absolute inset-0 bg-gradient-to-br from-cyber-panel/20 to-transparent transition-opacity duration-1000 pointer-events-none ${isSystemActive ? 'opacity-20' : 'opacity-100'}`}></div>

                {activeSession.plan ? <WorkflowVisualizer steps={activeSession.plan.steps} arbiters={activeSession.arbiters} onNodeClick={(id) => setSelectedStepId(id)} /> : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-cyber-muted/30">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 border border-white/5 mb-3">
                      <Activity className="w-5 h-5 text-cyber-primary opacity-20" />
                    </div>
                    <p className="text-[10px] font-black tracking-[0.3em] uppercase">SYSTEM_IDLE</p>
                  </div>
                )}
              </div>
            </div>
            {/* Command Interface (Chat) */}
            <div className="flex-[1.2] glass-panel rounded-xl flex flex-col shadow-glow overflow-hidden relative border border-white/5 min-h-0 hover:border-white/10 transition-colors">
              <div className="px-4 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0 bg-white/5">
                <h3 className="text-[10px] font-black text-cyber-white/50 uppercase tracking-widest flex items-center gap-2"><Terminal className="w-3 h-3 text-cyber-primary" /> COMMAND</h3>
                <button
                  className={`group relative text-[8px] font-mono px-2.5 py-1 rounded-md border transition-all duration-300 uppercase tracking-wider ${isConnected
                    ? 'text-emerald-400 border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-500/60 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                    : 'text-rose-400 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 hover:border-rose-500/60 shadow-[0_0_8px_rgba(244,63,94,0.2)]'
                    }`}
                  title={isConnected ? 'Neural link established' : 'Connection lost'}
                >
                  <div className="flex items-center gap-1.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                      }`} />
                    <span>{isConnected ? 'LINK_STABLE' : 'DISCONNECTED'}</span>
                  </div>
                </button>
              </div>
              <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar scroll-smooth">
                {activeSession.messages.map(msg => (
                  <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[75%] rounded-lg px-3.5 py-2 text-[11px] backdrop-blur-md transition-all ${msg.sender === 'user' ? 'bg-cyber-accent text-white rounded-br-none shadow-glow' : 'bg-cyber-panel/40 text-cyber-white/80 rounded-bl-none border border-white/5'}`}>{msg.text}</div>
                  </div>
                ))}
              </div>
              <div className="p-2.5 shrink-0">
                <div className="glass-input rounded-lg px-2 py-1.5 flex items-center gap-2 transition-all focus-within:border-cyber-primary/30">
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isProcessing}
                    placeholder="Transmit system order..."
                    className="flex-1 bg-transparent border-none text-[11px] text-white focus:outline-none placeholder:text-cyber-muted/30 font-bold"
                  />
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setIsDeepThinking(!isDeepThinking)}
                      className={`p-1.5 rounded transition-all ${isDeepThinking ? 'text-amber-400 bg-amber-400/10' : 'text-cyber-muted hover:text-cyber-primary hover:bg-white/5'}`}
                      title="Toggle Deep Thinking Mode"
                    >
                      <Brain className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={handleSendMessage}
                      disabled={!input.trim() || isProcessing}
                      className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${input.trim() && !isProcessing ? 'bg-cyber-primary text-cyber-base hover:bg-white' : 'bg-white/5 text-white/10'}`}
                    >
                      {isProcessing ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="col-span-12 lg:col-span-4 flex flex-col gap-2 h-full min-h-0">
            <div className="flex-[2] glass-panel rounded-xl overflow-hidden flex flex-col shadow-glow min-h-0 border border-white/5">
              <div className="px-4 py-2.5 border-b border-cyber-white/5 flex items-center justify-between shrink-0 bg-white/5">
                <h3 className="text-[10px] font-black text-cyber-white/50 flex items-center gap-2 uppercase tracking-widest"><Users className="w-3 h-3 text-cyber-primary" /> REGISTRY</h3>
              </div>
              <div className="flex-1 overflow-hidden p-1.5"><ArbiterGrid
                arbiters={activeSession.arbiters}
                layout="grid"
                variant="dashboard"
                onToggle={onToggleArbiter}
                onRestart={onRestartArbiter}
                showDetailedLoad={false} // Verified user request: only show image, %, and state
              /></div>
            </div>
            <div className="flex-1 glass-panel rounded-xl overflow-hidden flex flex-col shadow-glow min-h-0 relative border border-white/5">
              <div className="px-4 py-2.5 border-b border-cyber-white/5 flex items-center justify-between shrink-0 bg-white/5">
                <h3 className="text-[10px] font-black text-cyber-white/50 flex items-center gap-2 uppercase tracking-widest"><Layers className="w-3 h-3 text-cyber-primary" /> WORKFLOW</h3>
              </div>
              <div className="flex-1 overflow-hidden p-2 relative">
                {selectedStepId ? <TaskDetailPanel step={activeSession.plan?.steps.find(s => s.id === selectedStepId)} onClose={() => setSelectedStepId(undefined)} /> : <TaskMonitor steps={activeSession.plan?.steps || []} onSelectStep={setSelectedStepId} selectedStepId={selectedStepId} />}
              </div>
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div className="flex h-screen bg-main-gradient text-cyber-white font-sans selection:bg-cyber-accent/40 overflow-hidden">
      {/* Sidebar - Enhanced Branding integrated toggle */}
      <aside
        className={`flex flex-col hidden md:flex shrink-0 h-full relative z-50 border-r border-white/5 bg-gradient-to-b from-[#151518] to-[#0A0A0C] backdrop-blur-3xl transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-visible ${isSidebarCollapsed ? 'w-[64px]' : 'w-[188px]'}`}
      >
        {/* Breathing Logo & Integrated Collapse Toggle */}
        <div
          onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          className={`pt-7 pb-6 flex items-center cursor-pointer group select-none transition-all duration-500 ${isSidebarCollapsed ? 'px-3 justify-center' : 'px-6'}`}
        >
          <div className="relative shrink-0">
            {/* VIBRANT Breathing Glow Overlay */}
            {/* VIBRANT Breathing Glow Overlay */}
            <div className={`absolute -inset-1 bg-cyber-primary/80 rounded-full blur-xl transition-all duration-700 animate-breathing-glow ${isSidebarCollapsed ? 'opacity-40' : 'opacity-80 group-hover:opacity-100'}`}></div>

            {/* Logo Container with High Reactivity */}
            <div className={`relative w-10 h-10 rounded-xl bg-cyber-deep/80 flex items-center justify-center text-cyber-accent border border-white/10 shadow-neon-strong group-hover:scale-110 transition-all duration-500 group-hover:border-cyber-accent/60 group-hover:shadow-[0_0_25px_rgba(168,85,247,0.5)] overflow-hidden`}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-cyber-primary relative z-10">
                <path d="M12 2C10.5 2 9 2.5 8 3.5C7 2.5 5.5 2 4 2C2.5 2 1 3 1 5C1 6.5 1.5 8 2.5 9C1.5 10 1 11.5 1 13C1 14.5 2 16 3.5 16.5C3 17.5 3 18.5 3.5 19.5C4 20.5 5 21 6 21.5C7 22 8.5 22 10 22H14C15.5 22 17 22 18 21.5C19 21 20 20.5 20.5 19.5C21 18.5 21 17.5 20.5 16.5C22 16 23 14.5 23 13C23 11.5 22.5 10 21.5 9C22.5 8 23 6.5 23 5C23 3 21.5 2 20 2C18.5 2 17 2.5 16 3.5C15 2.5 13.5 2 12 2Z" />
              </svg>
              {/* Internal Scanline Effect */}
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-cyber-primary/10 to-transparent h-1/2 w-full animate-pulse pointer-events-none"></div>
            </div>
          </div>

          {!isSidebarCollapsed && (
            <div className="flex flex-col ml-4 animate-in fade-in slide-in-from-left-4 duration-500 group-hover:translate-x-1.5 transition-transform">
              <span className="font-mono font-black text-xl tracking-tighter text-white leading-none drop-shadow-[0_0_12px_rgba(216,180,254,0.6)]">ARBITERIUM</span>
              <span className="text-[8px] text-white/50 tracking-[0.4em] uppercase font-black mt-1.5 group-hover:opacity-100 group-hover:text-cyber-primary transition-all">Soma Core</span>
            </div>
          )}
        </div>

        {/* Task List / Session Navigation */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* New Task Button - Fixed at top of list */}
          <div className={`px-2.5 pb-3 shrink-0`}>
            <button
              onClick={handleNewTask}
              className={`group flex items-center h-10 rounded-lg border border-cyber-accent/40 text-cyber-accent bg-transparent transition-all duration-300 hover:bg-cyber-accent hover:text-cyber-base hover:shadow-neon w-full ${isSidebarCollapsed ? 'justify-center w-10 px-0 mx-auto' : 'px-3'}`}
            >
              <Plus className="w-5 h-5 group-hover:rotate-90 transition-transform duration-500 shrink-0" />
              {!isSidebarCollapsed && <span className="ml-3 text-[11px] font-black tracking-[0.2em] uppercase">New Operation</span>}
            </button>
          </div>

          {!isSidebarCollapsed && (
            <div className="px-6 py-2 border-t border-white/5 bg-gradient-to-r from-[#151518] via-[#1E1E20] to-[#18181B] backdrop-blur-sm shrink-0 flex items-center justify-between">
              <span className="text-[9px] font-black text-amber-400 uppercase tracking-[0.2em] opacity-80">OPERATIONS</span>
              <span className="text-[9px] font-mono text-cyber-primary opacity-70">{sessions.length}</span>
            </div>
          )}

          {/* Scrollable Session List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-2.5 space-y-1 py-2">
            {sessions.map(session => {
              const isActive = activeSessionId === session.id;
              const hasActivePlan = session.plan && session.plan.steps.some(s => s.status === TaskStatus.IN_PROGRESS);

              if (isSidebarCollapsed) {
                return (
                  <button
                    key={session.id}
                    onClick={() => setActiveSessionId(session.id)}
                    className={`w-10 h-10 mx-auto rounded-lg flex items-center justify-center transition-all relative ${isActive ? 'bg-cyber-primary/20 text-cyber-primary border border-cyber-primary/40 shadow-glow' : 'hover:bg-white/5 text-cyber-muted'}`}
                  >
                    {hasActivePlan ? <Activity className="w-4 h-4 animate-pulse" /> : <MessageSquare className="w-4 h-4" />}
                    {isActive && <div className="absolute -right-1 top-1 w-2 h-2 rounded-full bg-cyber-primary"></div>}
                  </button>
                )
              }

              return (
                <div
                  key={session.id}
                  onClick={() => setActiveSessionId(session.id)}
                  className={`
                            group flex items-start p-2.5 rounded-lg cursor-pointer transition-all border border-transparent relative overflow-hidden
                            ${isActive
                      ? 'bg-gradient-to-r from-white/10 to-transparent border-l-cyber-accent border-l-2'
                      : 'hover:bg-white/5 opacity-70 hover:opacity-100'}
                          `}
                >
                  <div className="mt-0.5 shrink-0">
                    {hasActivePlan ? (
                      <Activity className={`w-3.5 h-3.5 ${isActive ? 'text-cyber-primary animate-pulse' : 'text-cyber-muted'}`} />
                    ) : (
                      <MessageSquare className={`w-3.5 h-3.5 ${isActive ? 'text-cyber-primary' : 'text-cyber-muted'}`} />
                    )}
                  </div>
                  <div className="ml-3 min-w-0 flex-1">
                    <h4 className={`text-[11px] font-bold leading-none truncate ${isActive ? 'text-white' : 'text-cyber-muted group-hover:text-white'}`}>
                      {session.title}
                    </h4>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[9px] font-mono text-gray-500">{new Date(session.lastActive).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-cyber-primary shadow-[0_0_5px_#A855F7]"></div>}
                    </div>
                  </div>

                  {/* Delete Button */}
                  <button
                    onClick={(e) => handleDeleteSession(e, session.id)}
                    className={`absolute top-2 right-2 p-1.5 rounded-md hover:bg-rose-500/20 text-cyber-muted hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all ${sessions.length === 1 ? 'hidden' : ''}`}
                    title="Delete Operation"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Global Navigation (Bottom) */}
        <div className="shrink-0 border-t border-white/5 bg-transparent pt-2 pb-2 px-2.5 space-y-1">
          {[
            { id: 'dashboard', icon: Home, label: 'Dashboard' },
            { id: 'agents', icon: Users, label: 'Arbiters' },
            { id: 'micro-agents', icon: Zap, label: 'Agents' },
            { id: 'swarm', icon: Wrench, label: 'Swarm' },
            { id: 'cns', icon: Activity, label: 'CNS' },
            { id: 'plan', icon: FileText, label: 'Plan & Outputs' },
            { id: 'tasks', icon: Layers, label: 'Trace' },
          ].map(item => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`group relative flex items-center h-9 rounded-lg transition-all duration-300 overflow-hidden ${isActive
                  ? 'bg-cyber-primary/10 text-cyber-primary'
                  : 'text-cyber-muted hover:text-white hover:bg-white/5'
                  } ${isSidebarCollapsed ? 'justify-center w-10 px-0 mx-auto' : 'w-full px-3'}`}
              >
                <item.icon className={`w-4 h-4 shrink-0 transition-transform duration-300 group-hover:scale-110 ${isActive ? 'text-cyber-primary' : 'opacity-40 group-hover:opacity-100'}`} />
                {!isSidebarCollapsed && (
                  <span className={`ml-3 text-[10px] font-bold tracking-wide transition-all ${isActive ? 'translate-x-1' : ''}`}>{item.label}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Footer Demo Button - REMOVED per user request */}
        {/* <div className="mt-auto p-3 border-t border-white/5 bg-black/20">...</div> */}
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 relative p-1.5 transition-all duration-500">
        <div className="flex-1 flex flex-col bg-cyber-base/40 rounded-xl border border-white/10 overflow-hidden backdrop-blur-3xl relative shadow-2xl">
          <main className="flex-1 overflow-hidden p-2">
            <div className="h-full">{renderContent()}</div>
          </main>
        </div>
      </div>

      <style>{`
        .shadow-neon-strong {
          box-shadow: 0 0 15px rgba(168, 85, 247, 0.4), 0 0 5px rgba(192, 38, 211, 0.2);
        }
        .shadow-glow-strong {
          box-shadow: 0 0 25px rgba(192, 38, 211, 0.4), 0 0 10px rgba(168, 85, 247, 0.2);
        }
        @keyframes breathing-glow {
          0%, 100% { opacity: 0.1; transform: scale(0.9); filter: blur(15px); }
          50% { opacity: 0.6; transform: scale(1.15); filter: blur(25px); }
        }
        .animate-breathing-glow {
          animation: breathing-glow 4s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
};

export default ArbiteriumApp;