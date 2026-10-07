import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Bot, Eye, NotebookPen, Layers, Compass, Search, Play, Pause, X, Send, Activity, Crown, TerminalSquare } from 'lucide-react';
import somaBackend from '../../somaBackend';
import { PilotRuntime, requestPilotAction, hasPilotHandler, newId } from './kernel/PilotRuntime';

// The cursor is a visual affordance. App APIs perform work; receipts prove results.
export default function GhostCursor({
  enabled = true, autonomyLevel = 2, permissions = {}, locked = false, desktopMode,
  onUpdateAutonomy, openWindows = [], onTriggerAction, onTileWindows, onToggleGalaxy,
}) {
  const [pos, setPos] = useState({ x: 340, y: 200 });
  const [intent, setIntent] = useState('SOMA: Aperture pilot ready. Escape stops the current run.');
  const [isOperating, setIsOperating] = useState(false);
  const clicking = isOperating;
  const humanNear = false;
  const [autonomousActive, setAutonomousActive] = useState(true);
  const [showPalette, setShowPalette] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [receipts, setReceipts] = useState([]);
  const propsRef = useRef();
  propsRef.current = { enabled, autonomyLevel, permissions, locked, desktopMode, openWindows, onTriggerAction, onTileWindows, onToggleGalaxy };
  const stateRef = useRef();
  stateRef.current = { autonomousActive, showPalette };
  const runtimeRef = useRef();
  const lastHumanActivity = useRef(Date.now());
  const recentActionsRef = useRef([]);
  const planningRef = useRef(false);
  const mountedRef = useRef(true);

  const observe = useCallback(() => {
    const p = propsRef.current;
    const windows = p.openWindows.map(w => ({ id: w.id, appId: w.appId, minimized: !!w.minimized,
      maximized: !!w.maximized, x: w.x, y: w.y, width: w.width, height: w.height }));
    return { id: newId(), observedAt: Date.now(), surface: 'aperture', windows,
      signature: JSON.stringify({ windows, desktopMode: p.desktopMode, locked: p.locked }) };
  }, []);
  const waitFor = useCallback(async (check, signal, timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (signal.aborted || !mountedRef.current || !propsRef.current.enabled || propsRef.current.locked) throw new Error('Pilot stopped');
      const result = check();
      if (result) return result;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Expected app state was not observed before timeout');
  }, []);
  const indicate = useCallback(el => {
    if (!el?.isConnected) return;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) setPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }, []);
  const ensureApp = useCallback(async (appId, signal) => {
    if (signal.aborted) throw new Error('Pilot stopped');
    const existing = propsRef.current.openWindows.find(w => w.appId === appId && !w.minimized);
    if (!existing) propsRef.current.onTriggerAction?.(appId);
    const win = await waitFor(() => propsRef.current.openWindows.find(w => w.appId === appId && !w.minimized), signal);
    const el = await waitFor(() => document.querySelector('[data-window-id="' + CSS.escape(win.id) + '"]'), signal);
    indicate(el.querySelector('.ap-window-title') || el);
    return win;
  }, [waitFor, indicate]);

  const perform = useCallback(async (decision, { id, signal }) => {
    const { action, params } = decision;
    const complete = (summary, evidence) => ({ status: 'completed', verified: true, summary, evidence });
    if (action === 'launch_app' || action === 'soma_status') {
      const appId = action === 'soma_status' ? 'status' : params.appId;
      const win = await ensureApp(appId, signal);
      return complete(appId + ' window is visible. This does not certify system health.', { windowId: win.id, appId, visible: true });
    }
    if (['terminal_exec', 'note_create', 'file_browse', 'portal_navigate'].includes(action)) {
      const appId = { terminal_exec: 'terminal', note_create: 'notes', file_browse: 'files', portal_navigate: 'portal' }[action];
      const win = await ensureApp(appId, signal);
      await waitFor(() => hasPilotHandler(win.id, action), signal);
      return requestPilotAction(window, { id, windowId: win.id, action, params }, { signal, timeoutMs: action === 'portal_navigate' ? 30000 : 15000 });
    }
    if (action === 'tile_windows') {
      const wins = propsRef.current.openWindows.filter(w => !w.minimized);
      if (wins.length < 2) throw new Error('Open at least two windows before tiling');
      const before = JSON.stringify(wins.map(w => [w.id, w.x, w.y, w.width, w.height, w.maximized]));
      propsRef.current.onTileWindows?.();
      await waitFor(() => JSON.stringify(propsRef.current.openWindows.filter(w => !w.minimized).map(w => [w.id, w.x, w.y, w.width, w.height, w.maximized])) !== before, signal);
      return complete('Window layout changed.', { windowIds: wins.map(w => w.id), observedLayout: observe().windows });
    }
    if (action === 'toggle_galaxy') {
      const before = propsRef.current.desktopMode;
      propsRef.current.onToggleGalaxy?.();
      await waitFor(() => propsRef.current.desktopMode !== before, signal);
      return complete('Desktop view changed.', { desktopMode: propsRef.current.desktopMode });
    }
    if (action === 'open_spotlight') {
      const target = document.querySelector('[data-action="spotlight"]');
      if (!target?.isConnected || target.disabled) throw new Error('Search button is unavailable');
      indicate(target);
      target.click(); // Exactly one activation of a known, mounted control.
      await waitFor(() => document.querySelector('.ap-spotlight'), signal);
      return complete('Search is open.', { selector: '.ap-spotlight', visible: true });
    }
    throw new Error('Unsupported action');
  }, [ensureApp, waitFor, observe, indicate]);

  if (!runtimeRef.current) runtimeRef.current = new PilotRuntime({
    observe,
    settings: () => propsRef.current,
    perform: (...args) => perform(...args),
    onReceipt: receipt => {
      recentActionsRef.current = [...recentActionsRef.current.slice(-7), { action: receipt.action, status: receipt.status, verified: receipt.verified }];
      if (mountedRef.current) setReceipts(previous => [...previous.slice(-9), receipt]);
    },
  });
  // Callbacks read latest props through refs; runtime remains a single flight gate.
  const stop = useCallback((pause = true) => {
    runtimeRef.current.stop();
    if (pause) setAutonomousActive(false);
    setIntent('SOMA: stopped. Submitted work may still finish; no further actions will be sent.');
  }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; runtimeRef.current.stop(); };
  }, []);
  useEffect(() => {
    runtimeRef.current.stop(); // Invalidates pending plans on permission/mode changes, too.
  }, [enabled, locked, autonomyLevel, permissions.fileRead, permissions.networkAccess, permissions.memoryWrite, permissions.somaReasoning]);
  useEffect(() => {
    const humanInput = event => {
      if (!event.isTrusted) return;
      lastHumanActivity.current = Date.now();
      runtimeRef.current.stop();
      if (event.key === 'Escape') stop(true);
    };
    window.addEventListener('pointerdown', humanInput, true);
    window.addEventListener('mousemove', humanInput, { passive: true });
    window.addEventListener('keydown', humanInput, true);
    return () => {
      window.removeEventListener('pointerdown', humanInput, true);
      window.removeEventListener('mousemove', humanInput);
      window.removeEventListener('keydown', humanInput, true);
    };
  }, [stop]);

  const executeCognitiveAction = useCallback(async (decision, options = {}) => {
    if (runtimeRef.current.running) return;
    runtimeRef.current.stop(); // A new accepted directive invalidates older pending plans.
    setShowPalette(false);
    setIsOperating(true);
    setIntent(decision.intent || 'SOMA: executing a bounded app action...');
    try {
      const result = await runtimeRef.current.execute(decision, options);
      if (mountedRef.current) setIntent('SOMA: ' + (result.summary || result.error || result.status));
      return result;
    } finally { if (mountedRef.current) setIsOperating(false); }
  }, []);
  const quickAction = useCallback((action, params, userDirective) =>
    executeCognitiveAction({ action, params, id: newId() }, { userDirective }), [executeCognitiveAction]);
  const missionTerminalAudit = cmd => quickAction('terminal_exec', { cmd }, 'run ' + cmd);
  const missionNotesReflection = () => {
    // A draft containing only real receipts, never invented observations.
    const content = '# Aperture action receipts\n\n' + (receipts.length
      ? receipts.map(r => '- ' + r.action + ': ' + r.status + ' — ' + (r.summary || r.error || 'No result detail')).join('\n')
      : 'No completed pilot actions have been recorded in this session.');
    return quickAction('note_create', { title: 'Aperture action receipts', content }, 'write a note from current action receipts');
  };
  const missionTileWorkspace = () => quickAction('tile_windows', {}, 'tile windows');
  const missionToggleGalaxy = () => quickAction('toggle_galaxy', {}, 'toggle galaxy');
  const missionSpotlight = () => quickAction('open_spotlight', {}, 'open spotlight');

  const plan = useCallback(async (userDirective = '') => {
    if (planningRef.current || runtimeRef.current.running || !propsRef.current.enabled || propsRef.current.locked) return;
    planningRef.current = true;
    if (userDirective) setIntent('SOMA: planning your directive against the current workspace...');
    const epoch = runtimeRef.current.epoch;
    const observation = observe();
    try {
      const p = propsRef.current;
      const response = await somaBackend.fetch('/api/aperture/pilot_decide', { method: 'POST', body: JSON.stringify({
        observation, userDirective, recentActions: recentActionsRef.current, enabled: p.enabled, locked: p.locked, autonomyLevel: p.autonomyLevel,
      }) });
      if (epoch !== runtimeRef.current.epoch || !mountedRef.current) return;
      if (response?.decision) await executeCognitiveAction(response.decision, { userDirective, observation });
    } catch (error) { if (mountedRef.current) setIntent('SOMA: planning failed — ' + error.message); }
    finally { planningRef.current = false; }
  }, [observe, executeCognitiveAction]);
  const handleDispatchDirective = event => {
    event?.preventDefault();
    const directive = customInput.trim();
    if (!directive) return;
    setCustomInput('');
    setShowPalette(false);
    void plan(directive);
  };
  useEffect(() => {
    const timer = setInterval(() => {
      const p = propsRef.current;
      if (!p.enabled || p.locked || p.autonomyLevel === 1 || !stateRef.current.autonomousActive || stateRef.current.showPalette) return;
      // Human priority is retained at every autonomy level.
      if (Date.now() - lastHumanActivity.current < 12000) return;
      void plan();
    }, 15000);
    return () => clearInterval(timer);
  }, [plan]);
  useEffect(() => {
    const onCommand = data => {
      if (!propsRef.current.enabled || propsRef.current.locked || !stateRef.current.autonomousActive || propsRef.current.autonomyLevel === 1) return;
      if (Date.now() - lastHumanActivity.current < 12000) {
        setIntent('SOMA: remote command deferred while you are using the desktop.');
        return;
      }
      const verb = data?.verb || data?.action;
      const p = data?.arg ?? data?.payload ?? {};
      const params = typeof p === 'string' ? { appId: p, query: p } : p;
      const action = { open_app: 'launch_app', terminal_exec: 'terminal_exec', portal_navigate: 'portal_navigate' }[verb];
      if (!action) return; // Remote messages cannot bypass the pilot with arbitrary UI actions.
      void executeCognitiveAction({ action, params: { ...params, appId: params.appId || params.id },
        id: data.id || (data.at ? 'remote-' + data.at + '-' + verb : newId()) });
    };
    somaBackend.on('aperture_command', onCommand);
    somaBackend.on('aperture_action', onCommand);
    return () => { somaBackend.off('aperture_command', onCommand); somaBackend.off('aperture_action', onCommand); };
  }, [executeCognitiveAction]);

  if (!enabled) return null;

  return (
    <>
      {/* Dynamic Ghost Cursor Co-Embodiment */}
      <div
        className={`ap-ghost-cursor-wrap ${autonomyLevel === 3 ? 'sovereign' : ''} ${humanNear ? 'yielding' : ''} ${clicking ? 'clicking' : ''} ${isOperating ? 'operating' : ''}`}
        style={{
          transform: `translate3d(${pos.x}px, ${pos.y}px, 0)`,
          pointerEvents: 'none',
        }}
      >
        {/* Dynamic Cursor Orb */}
        <div
          className="ap-ghost-cursor-orb"
          style={{ pointerEvents: 'auto', cursor: 'pointer' }}
          onClick={(e) => { e.stopPropagation(); setShowPalette(v => !v); }}
          title={autonomyLevel === 3 ? 'SOMA Sovereign Pilot (Click for Directives & Modes)' : 'SOMA Co-Pilot (Click for Directives & Modes)'}
        >
          <div className="ap-ghost-core" />
          <div className="ap-ghost-aura" />
          {clicking && <div className="ap-ghost-ripple" />}
        </div>

        {/* Interactive Intent Badge */}
        <div
          className="ap-ghost-intent-badge"
          onClick={(e) => { e.stopPropagation(); setShowPalette(v => !v); }}
          title="Click to direct SOMA or switch autonomy mode"
        >
          {autonomyLevel === 3 ? <Crown size={12} className="ap-ghost-crown" /> : <Sparkles size={11} className="ap-ghost-sparkle" />}
          <span>{intent}</span>
          {isOperating && <span className="ap-ghost-operating-indicator" />}
        </div>
      </div>

      {/* Operator Directive Palette Popover */}
      {showPalette && (
        <div
          className="ap-directive-backdrop"
          onClick={() => setShowPalette(false)}
        >
          <div
            className="ap-directive-palette"
            onClick={(e) => e.stopPropagation()}
            style={{
              left: Math.max(20, Math.min(window.innerWidth - 380, pos.x - 40)),
              top: Math.max(48, Math.min(window.innerHeight - 440, pos.y + 24)),
            }}
          >
            {/* Header */}
            <div className="ap-directive-header">
              <div className="ap-directive-title">
                {autonomyLevel === 3 ? <Crown size={16} style={{ color: '#fbbf24' }} /> : <Bot size={16} className="ap-directive-icon" />}
                <div>
                  <strong>SOMA Operator Directives</strong>
                  <div className="ap-directive-status">
                    <span className="ap-status-live-dot" />
                    <span>Aperture app pilot • verified action receipts</span>
                  </div>
                </div>
              </div>
              <button
                className="ap-directive-close"
                onClick={() => setShowPalette(false)}
                title="Close Directive Palette"
              >
                <X size={15} />
              </button>
            </div>

            {/* Freedom & Autonomy Mode Switcher */}
            <div className="ap-directive-modes">
              <button
                className={`ap-dir-mode-btn ${autonomyLevel === 3 ? 'active sovereign' : ''}`}
                onClick={() => onUpdateAutonomy && onUpdateAutonomy(3)}
                title="Autonomous app actions within settings; human input and Escape always take priority"
              >
                <Crown size={12} />
                <span>Autonomous</span>
              </button>
              <button
                className={`ap-dir-mode-btn ${autonomyLevel === 2 ? 'active copilot' : ''}`}
                onClick={() => onUpdateAutonomy && onUpdateAutonomy(2)}
                title="Co-Pilot: Courteous companion, yields to mouse, executes when idle"
              >
                <Bot size={12} />
                <span>Co-Pilot</span>
              </button>
              <button
                className={`ap-dir-mode-btn ${autonomyLevel === 1 ? 'active observe' : ''}`}
                onClick={() => onUpdateAutonomy && onUpdateAutonomy(1)}
                title="On-Demand: Only executes when explicitly requested via directive"
              >
                <Eye size={12} />
                <span>On-Demand</span>
              </button>
            </div>
            <div className="ap-directive-mode-desc">
              {autonomyLevel === 3 && <span>👑 <strong>Autonomous:</strong> SOMA selects bounded app actions for desktop goals. Human input interrupts; Escape stops. No goal means standing by.</span>}
              {autonomyLevel === 2 && <span>🤝 <strong>Co-Pilot:</strong> SOMA operates courteously, yielding to your mouse and running tasks when you are idle.</span>}
              {autonomyLevel === 1 && <span>🎯 <strong>On-Demand:</strong> SOMA only moves and clicks when you dispatch an explicit directive.</span>}
            </div>

            {/* Quick Action Chips */}
            <div className="ap-directive-chips">
              <button
                className="ap-directive-chip chip-cyan"
                onClick={() => missionTerminalAudit('uptime')}
              >
                <TerminalSquare size={13} />
                <span>Audit Kernel (`uptime`)</span>
              </button>

              <button
                className="ap-directive-chip chip-amber"
                onClick={() => missionNotesReflection()}
              >
                <NotebookPen size={13} />
                <span>Save Action Receipts</span>
              </button>

              <button
                className="ap-directive-chip chip-purple"
                onClick={() => missionTileWorkspace()}
              >
                <Layers size={13} />
                <span>Tile Windows (50/50)</span>
              </button>

              <button
                className="ap-directive-chip chip-blue"
                onClick={() => missionToggleGalaxy()}
              >
                <Compass size={13} />
                <span>Toggle Spatial Galaxy</span>
              </button>

              <button
                className="ap-directive-chip chip-green"
                onClick={() => missionSpotlight()}
              >
                <Search size={13} />
                <span>Universal Spotlight</span>
              </button>

              <button
                className="ap-directive-chip chip-teal"
                onClick={() => missionTerminalAudit('mem')}
              >
                <Activity size={13} />
                <span>Check VFS & Memory</span>
              </button>

              <button
                className="ap-directive-chip chip-slate"
                onClick={() => { if (autonomousActive) stop(true); else { runtimeRef.current.stop(); setAutonomousActive(true); setIntent('SOMA: autonomy resumed; waiting for a clear desktop objective.'); } }}
              >
                {autonomousActive ? <Pause size={13} /> : <Play size={13} />}
                <span>{autonomousActive ? 'Pause Autonomy' : 'Resume Autonomy'}</span>
              </button>
            </div>

            {/* Custom Directive Input */}
            <form className="ap-directive-form" onSubmit={handleDispatchDirective}>
              <input
                autoFocus
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Direct SOMA: 'run ps', 'open files', 'search <topic>'"
              />
              <button type="submit" disabled={!customInput.trim()}>
                <Send size={13} />
              </button>
            </form>

            <div className="ap-directive-footer">
              <small>{receipts.length ? `Last action: ${receipts.at(-1).action} — ${receipts.at(-1).status}` : 'No action receipts yet.'} This pilot controls Aperture apps, not the native Windows desktop. Escape stops.</small>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
