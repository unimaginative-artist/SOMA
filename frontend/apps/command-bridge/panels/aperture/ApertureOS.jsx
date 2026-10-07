import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, Bell, CalendarDays, ClipboardCheck, Globe2, Library,
  MonitorCog, NotebookPen, Folder, Search, Shield, SlidersHorizontal,
  Sparkles, TerminalSquare, Wifi, X, CheckCircle, AlertTriangle, Info,
  Zap, Moon, Sun, Layers, ChevronRight, Lock, RefreshCw, FileText,
  Plus, Trash2, Edit3, Bot, Skull, Maximize2, Minimize2, Square, Grid, Palette,
  Compass, MousePointer, Crown
} from 'lucide-react';
import somaBackend from '../../somaBackend';
import kernel from './kernel/ApertureKernel';
import LockScreen, { loadSavedPin, PIN_KEY } from './LockScreen';
import GhostCursor from './GhostCursor';
import SpatialCanvas from './SpatialCanvas';
import WindowErrorBoundary from './WindowErrorBoundary';
import cognitiveBus from './kernel/CognitiveBus';
import './ApertureOS.css';

function safeLazy(importFn) {
  return lazy(async () => {
    try {
      return await importFn();
    } catch (err) {
      console.warn('[ApertureOS] Dynamic chunk preload error, retrying in 600ms...', err);
      await new Promise(r => setTimeout(r, 600));
      return await importFn();
    }
  });
}

const FileManager   = safeLazy(() => import('./apps/Files'));
const PortalBrowser = safeLazy(() => import('./apps/Portal'));
const SettingsApp   = safeLazy(() => import('./apps/Settings'));
const SystemStatus  = safeLazy(() => import('./apps/SystemStatus'));
const TaskManager   = safeLazy(() => import('./apps/Tasks'));
const CalendarApp   = safeLazy(() => import('./apps/Calendar'));
const NotesApp      = safeLazy(() => import('./apps/Notes'));
const ArchiveApp    = safeLazy(() => import('./apps/Archive'));
const TerminalApp   = safeLazy(() => import('./apps/Terminal'));
const ProcessViewer = safeLazy(() => import('./apps/ProcessViewer'));
const AINotesApp     = safeLazy(() => import('./apps/AINotes'));
const SwarmMonitorApp = safeLazy(() => import('./apps/SwarmMonitor'));
const DungeonMasterApp = safeLazy(() => import('./apps/DungeonMasterApp'));
const RoboticsControlApp = safeLazy(() => import('./apps/RoboticsControlApp'));

const APPS = {
  robotics:  { name: 'Robotics Unit', icon: Bot,           accent: 'cyan',   component: RoboticsControlApp },
  campaigns: { name: 'Campaign Master', icon: Skull,         accent: 'purple', component: DungeonMasterApp },
  swarm:     { name: 'Swarm Monitor', icon: Activity,         accent: 'cyan',   component: SwarmMonitorApp },
  ainotes:   { name: 'AI Notes',    icon: Sparkles,         accent: 'amber',  component: AINotesApp },
  files:     { name: 'Files',       icon: Folder,           accent: 'blue',   component: FileManager },
  portal:    { name: 'Portal',      icon: Globe2,           accent: 'cyan',   component: PortalBrowser },
  tasks:     { name: 'Tasks',       icon: ClipboardCheck,   accent: 'green',  component: TaskManager },
  notes:     { name: 'Notes',       icon: NotebookPen,      accent: 'amber',  component: NotesApp },
  calendar:  { name: 'Calendar',    icon: CalendarDays,     accent: 'rose',   component: CalendarApp },
  status:    { name: 'System Info', icon: MonitorCog,       accent: 'violet', component: SystemStatus },
  archive:   { name: 'Archive',     icon: Library,          accent: 'indigo', component: ArchiveApp },
  settings:  { name: 'Settings',    icon: SlidersHorizontal,accent: 'slate',  component: SettingsApp },
  terminal:  { name: 'Terminal',    icon: TerminalSquare,   accent: 'green',  component: TerminalApp },
  processes: { name: 'Processes',   icon: Activity,         accent: 'violet', component: ProcessViewer },
};

const APP_ICONS = {
  files: '/assets/aperture/icons/files.png',
  portal: '/assets/aperture/icons/portal.png',
  tasks: '/assets/aperture/icons/tasks.png',
  notes: '/assets/aperture/icons/notes.png',
  calendar: '/assets/aperture/icons/calendar.png',
  status: '/assets/aperture/icons/status.png',
  archive: '/assets/aperture/icons/archive.png',
  settings: '/assets/aperture/icons/settings.png',
  terminal: '/assets/aperture/icons/terminal.png',
  processes: '/assets/aperture/icons/processes.png',
};

const defaultSettings = {
  theme: 'graphite', wallpaper: 'alpine', wallpaperUrl: '',
  activeWorkspaceId: null, autonomyLevel: 3, // Level 3 = Full Sovereign Freedom
  permissions: { fileRead: true, networkAccess: true, memoryWrite: true, somaReasoning: true },
  notificationsEnabled: true,
};

const SESSION_KEY  = 'aperture.session.windows.v2';
const ICONS_KEY    = 'aperture.desktop.icons.v2';
const WIDGETS_KEY  = 'aperture.widgets.v1';
const IDLE_MS      = 5 * 60 * 1000;

const DEFAULT_WIDGETS = [
  { id: 'w-clock',  type: 'clock',  x: 16, y: 16,  visible: true  },
  { id: 'w-system', type: 'system', x: 16, y: 160, visible: true  },
  { id: 'w-soma',   type: 'soma',   x: 16, y: 312, visible: false },
];
function loadWidgets() { try { return JSON.parse(localStorage.getItem(WIDGETS_KEY) || 'null') || DEFAULT_WIDGETS; } catch { return DEFAULT_WIDGETS; } }
function saveWidgets(w) { try { localStorage.setItem(WIDGETS_KEY, JSON.stringify(w)); } catch {} }

// ─── Snap logic ─────────────────────────────────────────────────────────────

const SNAP_EDGE = 24;
function getSnapZone(cx, cy, desktop) {
  if (!desktop) return null;
  const r = desktop.getBoundingClientRect();
  const nearL = cx - r.left   < SNAP_EDGE;
  const nearR = r.right - cx  < SNAP_EDGE;
  const nearT = cy - r.top    < SNAP_EDGE;
  if (nearT && nearL) return 'tl';
  if (nearT && nearR) return 'tr';
  if (nearT)          return 'max';
  if (nearL)          return 'left';
  if (nearR)          return 'right';
  return null;
}
function snapDimensions(zone, desktop) {
  if (!desktop) return null;
  const r = desktop.getBoundingClientRect();
  const W = r.width, H = r.height, hw = Math.floor(W / 2), hh = Math.floor(H / 2);
  return ({ left: { x:0,y:0,width:hw,height:H }, right: { x:hw,y:0,width:W-hw,height:H }, max: { x:0,y:0,width:W,height:H,maximized:true }, tl: { x:0,y:0,width:hw,height:hh }, tr: { x:hw,y:0,width:W-hw,height:hh } })[zone] || null;
}

// ─── localStorage helpers ────────────────────────────────────────────────────

function loadIcons() {
  try { return JSON.parse(localStorage.getItem(ICONS_KEY) || '[]'); } catch { return []; }
}
function saveIcons(icons) {
  localStorage.setItem(ICONS_KEY, JSON.stringify(icons));
}

// ─── Context Menu ────────────────────────────────────────────────────────────

function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({
      x: Math.min(x, window.innerWidth  - r.width  - 6),
      y: Math.min(y, window.innerHeight - r.height - 6),
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    const close = () => onClose();
    document.addEventListener('mousedown', close, true);
    document.addEventListener('contextmenu', close, true);
    return () => {
      document.removeEventListener('mousedown', close, true);
      document.removeEventListener('contextmenu', close, true);
    };
  }, [onClose]);

  return (
    <div className="ap-ctx-menu" ref={ref} style={{ left: pos.x, top: pos.y }}>
      {items.map((item, i) =>
        item.separator ? <div key={i} className="ap-ctx-sep" /> :
        item.header    ? <div key={i} className="ap-ctx-header">{item.label}</div> :
        <button
          key={i}
          className={`ap-ctx-item ${item.danger ? 'danger' : ''}`}
          disabled={item.disabled}
          onMouseDown={e => { e.stopPropagation(); item.action(); onClose(); }}
        >
          {item.icon && <item.icon size={14} />}
          <span>{item.label}</span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
        </button>
      )}
    </div>
  );
}

// ─── Desktop Icon ─────────────────────────────────────────────────────────────

function DesktopIcon({ icon, onOpen, onMove, onContextMenu }) {
  const drag = useRef(null);
  const AppIcon = APPS[icon.appId]?.icon || FileText;
  const accent  = APPS[icon.appId]?.accent || 'blue';

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { startX: e.clientX, startY: e.clientY, x: icon.x, y: icon.y, moved: false };
  };

  useEffect(() => {
    const move = (e) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.startX;
      const dy = e.clientY - drag.current.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.current.moved = true;
      if (drag.current.moved) onMove(icon.id, Math.max(0, drag.current.x + dx), Math.max(0, drag.current.y + dy));
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [icon.id, icon.x, icon.y, onMove]);

  return (
    <div
      className={`ap-desktop-icon ap-di-${accent}`}
      style={{ left: icon.x, top: icon.y }}
      onMouseDown={handleMouseDown}
      onDoubleClick={() => onOpen(icon)}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, icon); }}
      title={icon.label}
    >
      {APP_ICONS[icon.appId] ? (
        <div className="ap-di-icon-wrap-custom">
          <img src={APP_ICONS[icon.appId]} alt="" style={{ width: 56, height: 56, objectFit: 'contain' }} />
        </div>
      ) : (
        <div className="ap-di-icon-wrap">
          <AppIcon size={24} />
        </div>
      )}
      <span className="ap-di-label">{icon.label}</span>
    </div>
  );
}

// ─── Notification Toast ───────────────────────────────────────────────────────

const NOTIF_ICON = { success: CheckCircle, warning: AlertTriangle, error: AlertTriangle, ai: Sparkles, info: Info };

function Toast({ notif, onDismiss }) {
  useEffect(() => { const t = setTimeout(onDismiss, 4500); return () => clearTimeout(t); }, [onDismiss]);
  const Icon = NOTIF_ICON[notif.type] || Info;
  return (
    <div className={`ap-toast ap-toast-${notif.type}`} onClick={onDismiss}>
      <Icon size={14} className="ap-toast-icon" />
      <div className="ap-toast-body">
        <strong>{notif.title}</strong>
        {notif.body && <span>{notif.body}</span>}
      </div>
      <button className="ap-toast-close" onClick={e => { e.stopPropagation(); onDismiss(); }}><X size={12} /></button>
      <div className="ap-toast-bar" />
    </div>
  );
}

// ─── Notification Panel ───────────────────────────────────────────────────────

function NotificationPanel({ notifications, onClose, onClear, onMarkRead }) {
  const Icon = (t) => { const I = NOTIF_ICON[t] || Info; return <I size={13} />; };
  return (
    <div className="ap-notif-panel">
      <header>
        <strong>Notifications</strong>
        <div className="ap-notif-header-actions">
          {notifications.length > 0 && <button onClick={onClear}>Clear all</button>}
          <button onClick={onClose}><X size={14} /></button>
        </div>
      </header>
      <div className="ap-notif-list">
        {!notifications.length && <div className="ap-notif-empty"><Bell size={20} /><span>No notifications</span></div>}
        {notifications.map(n => (
          <div key={n.id} className={`ap-notif-item ap-notif-${n.type} ${n.read ? 'read' : ''}`} onClick={() => onMarkRead(n.id)}>
            <span className="ap-notif-dot" />
            <div className="ap-notif-content">
              <strong>{n.title}</strong>
              {n.body && <p>{n.body}</p>}
              <time>{new Date(n.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
            </div>
            <span className="ap-notif-type-icon">{Icon(n.type)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Quick Settings Panel ─────────────────────────────────────────────────────

function QuickSettings({ settings, snapshot, pin, onUpdate, onClose, onLaunchApp, onLock }) {
  const perms = settings.permissions || {};
  const THEMES     = [['graphite','Graphite'], ['daylight','Daylight'], ['slate','Slate']];
  const WALLPAPERS = [['alpine','Alpine'], ['mist','Mist'], ['graphite','Dark']];
  const LABELS     = ['Observe', 'Assisted', 'Autonomous'];
  return (
    <div className="ap-quickset">
      <div className="ap-quickset-header"><strong>Quick Settings</strong><button onClick={onClose}><X size={14} /></button></div>
      <div className="ap-qs-soma-status">
        <Sparkles size={14} className={snapshot?.ready ? 'online' : ''} />
        <span>SOMA Brain</span>
        <strong className={snapshot?.ready ? 'ap-qs-online' : 'ap-qs-offline'}>{snapshot?.ready ? 'Online' : 'Offline'}</strong>
        {snapshot?.ready && <span className="ap-qs-model">DeepSeek</span>}
      </div>
      <div className="ap-qs-section">
        <label>Theme</label>
        <div className="ap-qs-pills">
          {THEMES.map(([id, name]) => (
            <button key={id} className={settings.theme === id ? 'active' : ''} onClick={() => onUpdate({ theme: id })}>
              {id === 'daylight' ? <Sun size={11} /> : <Moon size={11} />} {name}
            </button>
          ))}
        </div>
      </div>
      <div className="ap-qs-section">
        <label>Wallpaper</label>
        <div className="ap-qs-pills">
          {WALLPAPERS.map(([id, name]) => (
            <button key={id} className={settings.wallpaper === id ? 'active' : ''} onClick={() => onUpdate({ wallpaper: id, wallpaperUrl: '' })}>{name}</button>
          ))}
        </div>
      </div>
      <div className="ap-qs-section">
        <label>AI Autonomy — <strong>{LABELS[settings.autonomyLevel - 1]}</strong></label>
        <input type="range" min="1" max="3" value={settings.autonomyLevel} onChange={e => onUpdate({ autonomyLevel: Number(e.target.value) })} className="ap-qs-slider" />
        <div className="ap-qs-autonomy-labels"><span>Observe</span><span>Assisted</span><span>Autonomous</span></div>
      </div>
      <div className="ap-qs-section">
        <label>Permissions</label>
        <div className="ap-qs-toggles">
          {[['networkAccess',Wifi,'Network'],['somaReasoning',Sparkles,'Reasoning'],['memoryWrite',Layers,'Memory'],['fileRead',Folder,'Files']].map(([key, Icon, label]) => (
            <button key={key} className={`ap-qs-toggle ${perms[key] ? 'on' : 'off'}`} onClick={() => onUpdate({ permissions: { [key]: !perms[key] } })}>
              <Icon size={12} /><span>{label}</span>
            </button>
          ))}
        </div>
      </div>
      {snapshot && (
        <div className="ap-qs-stats">
          <div><span>CPU</span><strong>{snapshot.cpu ?? '--'}%</strong></div>
          <div><span>RAM</span><strong>{snapshot.ram ?? '--'}%</strong></div>
          <div><span>Uptime</span><strong>{snapshot.uptime ? `${Math.floor(snapshot.uptime/60)}m` : '--'}</strong></div>
        </div>
      )}
      <div className="ap-qs-shortcuts">
        <button onClick={() => { onLock(); onClose(); }}>
          <Lock size={12} /> {pin ? 'Lock Screen' : 'Set up PIN Lock'} <ChevronRight size={11} />
        </button>
        <button onClick={() => { onLaunchApp('settings'); onClose(); }}>
          <SlidersHorizontal size={12} /> All Settings <ChevronRight size={11} />
        </button>
        <button onClick={() => { onLaunchApp('terminal'); onClose(); }}>
          <TerminalSquare size={12} /> Open Terminal <ChevronRight size={11} />
        </button>
        <button onClick={() => { onLaunchApp('processes'); onClose(); }}>
          <Activity size={12} /> Process Viewer <ChevronRight size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── Snap Preview ─────────────────────────────────────────────────────────────

function SnapPreview({ zone, desktop }) {
  if (!zone || !desktop) return null;
  const d = snapDimensions(zone, desktop);
  if (!d) return null;
  return <div className="ap-snap-preview" style={{ left: d.x, top: d.y, width: d.maximized ? '100%' : d.width, height: d.maximized ? '100%' : d.height }} />;
}

// ─── Boot Screen ──────────────────────────────────────────────────────────────

function BootScreen({ lines }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [lines]);
  return (
    <div className="ap-boot-screen">
      <div className="ap-boot-header"><Sparkles size={18} className="ap-boot-logo" /><span>ApertureOS</span></div>
      <div className="ap-boot-log">
        {lines.map((line, i) => (
          <div key={i} className={`ap-boot-line${!line.trim() ? ' blank' : line.startsWith('  [OK]') ? ' ok' : line.startsWith('  [WARN]') ? ' warn' : ''}`}>{line || ' '}</div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="ap-boot-status"><span className="ap-boot-blink">▋</span><span>Initializing kernel...</span></div>
    </div>
  );
}

// ─── Desktop Widgets ──────────────────────────────────────────────────────────

function DesktopWidget({ widget, snapshot, clock, onClose, onDragStart }) {
  const { type, x, y } = widget;
  return (
    <div
      className={`ap-widget ap-widget-${type}`}
      style={{ left: x, top: y }}
      onMouseDown={e => onDragStart(e, widget.id)}
    >
      <button className="ap-widget-close" onClick={e => { e.stopPropagation(); onClose(widget.id); }}><X size={9} /></button>
      {type === 'clock' && (
        <>
          <div className="ap-widget-time">{clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
          <div className="ap-widget-date">{clock.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</div>
        </>
      )}
      {type === 'system' && (
        <>
          <div className="ap-widget-title">System</div>
          <div className="ap-widget-bar-row"><span>CPU</span><div className="ap-widget-bar"><div style={{ width: `${snapshot?.cpu || 0}%`, background: '#2898b4' }} /></div><em>{snapshot?.cpu ?? '--'}%</em></div>
          <div className="ap-widget-bar-row"><span>RAM</span><div className="ap-widget-bar"><div style={{ width: `${snapshot?.ram || 0}%`, background: '#5c71dd' }} /></div><em>{snapshot?.ram ?? '--'}%</em></div>
          {snapshot?.uptime != null && <div className="ap-widget-sub">Up {Math.floor(snapshot.uptime / 60)}m</div>}
        </>
      )}
      {type === 'soma' && (
        <>
          <div className="ap-widget-title"><Sparkles size={11} style={{ marginRight: 5 }} />SOMA</div>
          <div className={`ap-widget-soma-row ${snapshot?.ready ? 'online' : 'offline'}`}>
            <span className="ap-widget-dot" />{snapshot?.ready ? 'Brain Online' : 'Brain Offline'}
          </div>
          {snapshot?.ready && <div className="ap-widget-sub">DeepSeek · {snapshot.cpu ?? '--'}% cpu</div>}
        </>
      )}
    </div>
  );
}

function AppFallback() { return <div className="ap-loading">Opening application...</div>; }

// ─── Main OS ──────────────────────────────────────────────────────────────────

export default function ApertureOS() {
  const [settings, setSettings]               = useState(defaultSettings);
  const [workspaces, setWorkspaces]           = useState([]);
  const [snapshot, setSnapshot]               = useState(null);
  const [openWindows, setOpenWindows]         = useState([]);
  const [activeWindowId, setActiveWindowId]   = useState(null);
  const [launcher, setLauncher]               = useState(false);
  const [spotlight, setSpotlight]             = useState(false);
  const [query, setQuery]                     = useState('');
  const [results, setResults]                 = useState([]);
  const [clock, setClock]                     = useState(new Date());
  const [booting, setBooting]                 = useState(kernel.state !== 'running');
  const [bootLines, setBootLines]             = useState(() => kernel.bootLog.map(e => e.message));

  // Mode toggles: Spatial Canvas vs Grid & Ghost Cursor Co-Pilot
  const [desktopMode, setDesktopMode]         = useState('grid');
  const [copilotEnabled, setCopilotEnabled]   = useState(true);

  // Notifications
  const [toasts, setToasts]                   = useState([]);
  const [notifications, setNotifications]     = useState(() => [...kernel.notifications]);
  const [showNotifPanel, setShowNotifPanel]   = useState(false);
  const [showQuickSettings, setShowQuickSettings] = useState(false);

  // Lock screen
  const [locked, setLocked]   = useState(() => !!loadSavedPin());
  const [pin, setPin]         = useState(() => loadSavedPin());
  const lastActivity          = useRef(Date.now());

  // Context menu
  const [contextMenu, setContextMenu] = useState(null); // { x, y, items }

  // Desktop icons
  const [desktopIcons, setDesktopIcons] = useState(() => loadIcons());

  // Widgets
  const [widgets, setWidgets]   = useState(loadWidgets);
  const widgetDrag              = useRef(null);

  // Snap
  const [snapZone, setSnapZone] = useState(null);
  const desktopRef              = useRef(null);
  const nextZ                   = useRef(20);
  const drag                    = useRef(null);

  const activeWorkspace = workspaces.find(w => w.id === settings.activeWorkspaceId) || workspaces[0] || null;
  const unreadCount     = notifications.filter(n => !n.read).length;

  const closeAllOverlays = () => {
    setShowNotifPanel(false);
    setShowQuickSettings(false);
    setLauncher(false);
    setContextMenu(null);
  };

  // ─── Window / process management ─────────────────────────────────────────

  const focusWindow = useCallback(id => {
    nextZ.current += 1;
    setActiveWindowId(id);
    setOpenWindows(p => p.map(w => w.id === id ? { ...w, zIndex: nextZ.current } : w));
  }, []);

  const mutateWindow = useCallback((id, patch) => setOpenWindows(p => p.map(w => {
    if (w.id !== id) return w;
    if (patch.minimized === true  && w.pid) kernel.suspend(w.pid);
    if (patch.minimized === false && w.pid) kernel.resume(w.pid);
    return { ...w, ...patch };
  })), []);

  const closeWindow = useCallback(id => setOpenWindows(p => {
    const win = p.find(w => w.id === id);
    if (win?.pid) kernel.kill(win.pid, 'SIGTERM');
    return p.filter(w => w.id !== id);
  }), []);

  const launchApp = useCallback((appId) => {
    if (!APPS[appId]) return;
    setOpenWindows(prev => {
      const existing = prev.find(w => w.appId === appId);
      if (existing) {
        nextZ.current += 1;
        setActiveWindowId(existing.id);
        if (existing.pid) kernel.resume(existing.pid);
        return prev.map(w => w.id === existing.id ? { ...w, minimized: false, zIndex: nextZ.current } : w);
      }
      const seq  = prev.length % 4;
      const id   = `${appId}-${Date.now()}`;
      const pid  = kernel.state === 'running' ? kernel.spawn(appId, APPS[appId].name, { ppid: 1, windowId: id }) : null;
      if (pid) kernel.attachWindow(pid, id);
      const avail = Math.max(760, window.innerWidth - 56);
      const preset = { files: { x:34,y:64,width:Math.min(600,avail-30),height:520 }, status: { x:Math.min(620,Math.max(310,avail-730)),y:72,width:Math.min(720,avail-26),height:570 }, terminal: { x:60,y:70,width:720,height:480 }, processes: { x:90,y:80,width:760,height:540 } }[appId];
      nextZ.current += 1;
      setActiveWindowId(id);
      return [...prev, { id, appId, pid, x: preset?.x ?? 115+seq*32, y: preset?.y ?? 62+seq*27, width: preset?.width ?? (appId==='settings'?860:900), height: preset?.height ?? 575, maximized: false, minimized: false, zIndex: nextZ.current }];
    });
    setLauncher(false);
  }, []);

  // ─── Kernel boot ──────────────────────────────────────────────────────────

  useEffect(() => {
    somaBackend.connect();
    if (kernel.state === 'running') { setBooting(false); return; }
    const u1 = kernel.on('boot-log', ({ message }) => setBootLines(p => [...p, message]));
    const u2 = kernel.on('boot-complete', () => {
      setTimeout(() => setBooting(false), 500);
      setTimeout(() => kernel.notify('SOMA Co-Pilot', 'Aperture is ready. The pilot reports app action receipts; Escape stops a run.', { appId: 'system', type: 'ai' }), 1200);
    });
    const u3 = kernel.on('exec-request', ({ appId }) => { if (APPS[appId]) launchApp(appId); });
    kernel.boot();
    return () => { u1(); u2(); u3(); };
  }, []); // eslint-disable-line

  useEffect(() => {
    if (booting) return;
    const u1 = kernel.on('exec-request', ({ appId }) => { if (APPS[appId]) launchApp(appId); });
    const u2 = kernel.on('process-kill', ({ windowId }) => {
      if (windowId) setOpenWindows(p => p.filter(w => w.id !== windowId));
    });
    const handleCloseEvent = (e) => {
      const { windowId, appId } = e.detail || {};
      if (windowId) closeWindow(windowId);
      else if (appId) {
        setOpenWindows(p => {
          const win = p.find(w => w.appId === appId);
          if (win) {
            if (win.pid) kernel.kill(win.pid, 'SIGTERM');
            return p.filter(w => w.id !== win.id);
          }
          return p;
        });
      }
    };
    window.addEventListener('aperture:close-window', handleCloseEvent);
    return () => {
      u1();
      u2();
      window.removeEventListener('aperture:close-window', handleCloseEvent);
    };
  }, [booting, closeWindow]); // eslint-disable-line

  // ─── Idle lock ────────────────────────────────────────────────────────────

  useEffect(() => {
    const resetIdle = () => { lastActivity.current = Date.now(); };
    document.addEventListener('mousemove', resetIdle, { passive: true });
    document.addEventListener('keydown', resetIdle, { passive: true });
    document.addEventListener('mousedown', resetIdle, { passive: true });
    const check = setInterval(() => {
      if (pin && !locked && Date.now() - lastActivity.current > IDLE_MS) setLocked(true);
    }, 30000);
    return () => {
      document.removeEventListener('mousemove', resetIdle);
      document.removeEventListener('keydown', resetIdle);
      document.removeEventListener('mousedown', resetIdle);
      clearInterval(check);
    };
  }, [pin, locked]);

  // ─── Notifications ────────────────────────────────────────────────────────

  useEffect(() => {
    const u1 = kernel.on('notification', n => {
      setNotifications(p => [n, ...p].slice(0, 100));
      setToasts(p => [...p, n]);
    });
    const u2 = kernel.on('notifications-cleared', () => setNotifications([]));
    return () => { u1(); u2(); };
  }, []);

  const dismissToast  = useCallback((id) => { setToasts(p => p.filter(t => t.id !== id)); kernel.markRead(id); }, []);
  const handleMarkRead = useCallback((id) => { kernel.markRead(id); setNotifications([...kernel.notifications]); }, []);
  const handleClearAll = useCallback(() => { kernel.clearNotifications(); }, []);

  // ─── Settings ─────────────────────────────────────────────────────────────

  const updateSettings = useCallback(async (patch) => {
    setSettings(p => ({ ...p, ...patch, permissions: { ...p.permissions, ...(patch.permissions || {}) } }));
    try {
      const r = await somaBackend.fetch('/api/aperture/settings', { method: 'PUT', body: JSON.stringify(patch) });
      if (r.success) setSettings(r.settings);
    } catch {}
  }, []);

  // ─── Desktop icons ────────────────────────────────────────────────────────

  const addDesktopIcon = useCallback((appId) => {
    setDesktopIcons(prev => {
      if (prev.some(ic => ic.appId === appId && ic.type === 'app')) return prev;
      const row = Math.floor(prev.length / 2);
      const col = prev.length % 2;
      const next = [...prev, { id: `di-${appId}-${Date.now()}`, type: 'app', appId, label: APPS[appId]?.name || appId, x: 18 + col * 84, y: 18 + row * 84 }];
      saveIcons(next);
      return next;
    });
  }, []);

  const moveIcon = useCallback((id, x, y) => {
    setDesktopIcons(prev => {
      const next = prev.map(ic => ic.id === id ? { ...ic, x, y } : ic);
      saveIcons(next);
      return next;
    });
  }, []);

  const removeIcon = useCallback((id) => {
    setDesktopIcons(prev => { const next = prev.filter(ic => ic.id !== id); saveIcons(next); return next; });
  }, []);

  const renameIcon = useCallback((id, label) => {
    const lbl = window.prompt('Rename shortcut:', label);
    if (lbl && lbl.trim()) {
      setDesktopIcons(prev => { const next = prev.map(ic => ic.id === id ? { ...ic, label: lbl.trim() } : ic); saveIcons(next); return next; });
    }
  }, []);

  const autoArrangeIcons = useCallback(() => {
    setDesktopIcons(prev => {
      const perCol = Math.max(3, Math.floor((window.innerHeight - 100) / 88));
      const next = prev.map((ic, idx) => {
        const col = Math.floor(idx / perCol);
        const row = idx % perCol;
        return { ...ic, x: 20 + col * 88, y: 36 + row * 88 };
      });
      saveIcons(next);
      return next;
    });
  }, []);

  // ─── Widget management ────────────────────────────────────────────────────

  const moveWidget = useCallback((id, x, y) => {
    setWidgets(prev => { const next = prev.map(w => w.id === id ? { ...w, x: Math.max(0, x), y: Math.max(0, y) } : w); saveWidgets(next); return next; });
  }, []);
  const hideWidget = useCallback((id) => {
    setWidgets(prev => { const next = prev.map(w => w.id === id ? { ...w, visible: false } : w); saveWidgets(next); return next; });
  }, []);
  const showWidget = useCallback((id) => {
    setWidgets(prev => { const next = prev.map(w => w.id === id ? { ...w, visible: true } : w); saveWidgets(next); return next; });
  }, []);
  const beginWidgetDrag = useCallback((e, id) => {
    const w = widgets.find(wg => wg.id === id);
    if (!w) return;
    widgetDrag.current = { id, startX: e.clientX, startY: e.clientY, x: w.x, y: w.y };
    e.preventDefault();
    e.stopPropagation();
  }, [widgets]);

  useEffect(() => {
    const move = e => {
      if (!widgetDrag.current) return;
      const dx = e.clientX - widgetDrag.current.startX;
      const dy = e.clientY - widgetDrag.current.startY;
      moveWidget(widgetDrag.current.id, widgetDrag.current.x + dx, widgetDrag.current.y + dy);
    };
    const up = () => { widgetDrag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [moveWidget]);

  // ─── SOMA Agency Bridge ───────────────────────────────────────────────────
  // SOMA (backend) drives the OS through aperture_command WS broadcasts.
  // Every action she takes is attributed via a kernel notification so the
  // desktop never changes "mysteriously". Verbs are a small allow-list.
  useEffect(() => {
    somaBackend.connect();

    const handler = (cmd) => {
      // Notifications only. PilotRuntime exclusively owns app execution and receipts.
      if (cmd?.verb === 'notify') kernel.notify('SOMA', String(cmd.arg || ''), { appId: 'system', type: 'info' });
    };

    const handleProactive = (data) => {
      const msg = data?.message || (typeof data === 'string' ? data : null);
      if (msg) {
        kernel.notify('SOMA Co-Pilot', msg, { appId: 'system', type: 'ai' });
      }
    };

    somaBackend.on('aperture_command', handler);
    somaBackend.on('soma_proactive', handleProactive);
    return () => {
      somaBackend.off('aperture_command', handler);
      somaBackend.off('soma_proactive', handleProactive);
    };
  }, [launchApp]);

  // ─── Session persistence ──────────────────────────────────────────────────

  // Save on change (debounced)
  useEffect(() => {
    if (booting) return;
    const t = setTimeout(() => {
      const session = openWindows.map(w => ({ appId:w.appId, x:w.x, y:w.y, width:w.width, height:w.height, maximized:w.maximized, minimized:w.minimized }));
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }, 800);
    return () => clearTimeout(t);
  }, [openWindows, booting]);

  // Restore on boot
  useEffect(() => {
    if (booting) return;
    let restored = false;
    try {
      const saved = localStorage.getItem(SESSION_KEY);
      if (saved) {
        const session = JSON.parse(saved);
        if (Array.isArray(session) && session.length > 0) {
          const seen = new Set();
          const windows = session
            .filter(w => APPS[w.appId] && !seen.has(w.appId) && seen.add(w.appId))
            .map(w => {
              const id  = `${w.appId}-${Date.now()}-${Math.floor(Math.random()*9999)}`;
              const pid = kernel.state === 'running' ? kernel.spawn(w.appId, APPS[w.appId].name, { ppid: 1, windowId: id }) : null;
              if (pid) kernel.attachWindow(pid, id);
              nextZ.current += 1;
              return { id, pid, appId:w.appId, x:w.x??100, y:w.y??60, width:w.width??900, height:w.height??575, maximized:w.maximized??false, minimized:w.minimized??false, zIndex: nextZ.current };
            });
          if (windows.length > 0) {
            setOpenWindows(windows);
            setActiveWindowId(windows[windows.length - 1].id);
            restored = true;
          }
        }
      }
    } catch {}
    if (!restored) { launchApp('files'); launchApp('status'); }
  }, [booting]); // eslint-disable-line

  // ─── Init shell data ──────────────────────────────────────────────────────

  useEffect(() => {
    if (booting) return;
    let alive = true;
    (async () => {
      try {
        const [saved, axis] = await Promise.all([
          somaBackend.fetch('/api/aperture/settings'),
          somaBackend.fetch('/api/axis/workspaces'),
        ]);
        if (!alive) return;
        if (saved.success) setSettings(p => ({ ...defaultSettings, ...saved.settings, autonomyLevel: saved.settings?.autonomyLevel ?? 3 }));
        const list = axis.workspaces || [];
        setWorkspaces(list);
        if (!saved.settings?.activeWorkspaceId && list[0]?.id) updateSettings({ activeWorkspaceId: list[0].id });
      } catch {}
    })();
    return () => { alive = false; };
  }, [booting]); // eslint-disable-line

  useEffect(() => {
    let alive = true;
    const refresh = async () => { try { const s = await somaBackend.fetch('/api/system/state'); if (alive && s.success) setSnapshot(s.snapshot); } catch { if (alive) setSnapshot(null); } };
    refresh();
    const st = setInterval(refresh, 5000);
    const ct = setInterval(() => setClock(new Date()), 1000);
    return () => { alive = false; clearInterval(st); clearInterval(ct); };
  }, []);

  // ─── Spotlight ────────────────────────────────────────────────────────────

  useEffect(() => {
    const t = setTimeout(async () => {
      if (query.trim().length < 2) return setResults([]);
      try {
        const ws = activeWorkspace?.id ? `&workspaceId=${encodeURIComponent(activeWorkspace.id)}` : '';
        const r  = await somaBackend.fetch(`/api/aperture/search?q=${encodeURIComponent(query.trim())}${ws}`);
        setResults(r.results || []);
      } catch { setResults([]); }
    }, 180);
    return () => clearTimeout(t);
  }, [activeWorkspace?.id, query]);

  // ─── Global keyboard + SOMA actions ──────────────────────────────────────

  useEffect(() => {
    const onKey = e => {
      if (locked) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSpotlight(v => !v); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') { e.preventDefault(); setLocked(true); }
      if (e.key === 'Escape') { setSpotlight(false); setLauncher(false); setShowNotifPanel(false); setShowQuickSettings(false); setContextMenu(null); }
    };
    const onAction = data => {
      const { action, payload = {} } = data || {};
      // Executable app commands have one owner: PilotRuntime in GhostCursor.
      if (['open_app', 'terminal_exec', 'portal_navigate'].includes(action)) return;
      if (!copilotEnabled || locked) return;
      if (settings.autonomyLevel === 1 && ['open_app','select_workspace','change_theme','change_wallpaper'].includes(action)) return;
      if (settings.autonomyLevel === 2 && ['select_workspace','change_theme','change_wallpaper'].includes(action)) return;
      if (action === 'search_universal') { setSpotlight(true); setQuery(payload.query || ''); }
      if (action === 'select_workspace') { const sel = workspaces.find(w => w.id === payload.workspace || w.name === payload.workspace); if (sel) updateSettings({ activeWorkspaceId: sel.id }); }
      if (action === 'change_theme')    updateSettings({ theme: payload.theme });
      if (action === 'change_wallpaper') updateSettings({ wallpaper: payload.wallpaper, wallpaperUrl: payload.wallpaperUrl || '' });
      if (action === 'notify')          kernel.notify(payload.title, payload.body, payload);
    };
    const onLocal = e => updateSettings(e.detail?.payload || {});
    window.addEventListener('keydown', onKey);
    window.addEventListener('aperture-system-message', onLocal);
    somaBackend.on('aperture_action', onAction);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('aperture-system-message', onLocal); somaBackend.off('aperture_action', onAction); };
  }, [launchApp, locked, copilotEnabled, settings.autonomyLevel, updateSettings, workspaces]);

  // ─── Context menu builders ────────────────────────────────────────────────

  const showDesktopCtx = useCallback((e) => {
    e.preventDefault();
    const widgetItems = DEFAULT_WIDGETS.map(def => {
      const w = widgets.find(wg => wg.id === def.id);
      const label = `${def.type.charAt(0).toUpperCase() + def.type.slice(1)} Widget`;
      return { label: w?.visible ? `Hide ${label}` : `Show ${label}`, icon: Layers, action: () => w?.visible ? hideWidget(def.id) : showWidget(def.id) };
    });
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { header: true, label: 'Aperture OS' },
        { separator: true },
        {
          label: desktopMode === 'spatial' ? 'Switch to Grid Desktop' : 'Switch to Spatial Galaxy',
          icon: Compass,
          action: () => setDesktopMode(m => m === 'grid' ? 'spatial' : 'grid')
        },
        {
          label: `SOMA Co-Pilot: ${copilotEnabled ? 'Active' : 'Disabled'}`,
          icon: Sparkles,
          action: () => setCopilotEnabled(c => !c)
        },
        { separator: true },
        { label: 'New Note', icon: NotebookPen, action: () => launchApp('notes') },
        { label: 'Files', icon: Folder, action: () => launchApp('files') },
        { label: 'Terminal', icon: TerminalSquare, action: () => launchApp('terminal') },
        { label: 'AI Notes', icon: Sparkles, action: () => launchApp('ainotes') },
        { label: 'Swarm Monitor', icon: Activity, action: () => launchApp('swarm') },
        { separator: true },
        { label: 'Search Spotlight', icon: Search, shortcut: 'Ctrl+K', action: () => setSpotlight(true) },
        { label: 'Auto-arrange Icons', icon: Grid, action: autoArrangeIcons },
        {
          label: `Theme: ${settings.theme.charAt(0).toUpperCase() + settings.theme.slice(1)}`,
          icon: Palette,
          action: () => {
            const themes = ['graphite', 'daylight', 'slate'];
            const next = themes[(themes.indexOf(settings.theme) + 1) % themes.length];
            updateSettings({ theme: next });
          }
        },
        { separator: true },
        { header: true, label: 'Widgets' },
        ...widgetItems,
        { separator: true },
        { label: 'Lock Screen', icon: Lock, shortcut: 'Ctrl+L', action: () => setLocked(true) },
        { label: 'Settings', icon: SlidersHorizontal, action: () => launchApp('settings') },
        { label: 'Refresh SOMA State', icon: RefreshCw, action: () => somaBackend.fetch('/api/system/state') },
      ],
    });
  }, [launchApp, widgets, hideWidget, showWidget, autoArrangeIcons, settings.theme, updateSettings, desktopMode, copilotEnabled]);

  const showDockCtx = useCallback((e, appId) => {
    e.preventDefault();
    e.stopPropagation();
    const win = openWindows.find(w => w.appId === appId);
    const isOpen = !!win && !win.minimized;
    const isMinimized = !!win && win.minimized;
    setContextMenu({
      x: e.clientX, y: Math.min(e.clientY, window.innerHeight - 200),
      items: [
        { header: true, label: APPS[appId]?.name || appId },
        { separator: true },
        {
          label: isMinimized ? 'Restore' : (isOpen ? 'Focus' : 'Open'),
          icon: APPS[appId]?.icon,
          action: () => launchApp(appId)
        },
        ...(isOpen ? [
          {
            label: 'Minimize',
            icon: Minimize2,
            action: () => mutateWindow(win.id, { minimized: true })
          }
        ] : []),
        {
          label: 'Add to Desktop',
          icon: Plus,
          action: () => addDesktopIcon(appId)
        },
        ...(win ? [
          { separator: true },
          {
            label: 'Close App',
            icon: X,
            danger: true,
            action: () => closeWindow(win.id)
          },
        ] : []),
      ],
    });
  }, [addDesktopIcon, closeWindow, launchApp, mutateWindow, openWindows]);

  const showIconCtx = useCallback((e, icon) => {
    e.preventDefault();
    e.stopPropagation();
    const appDef = APPS[icon.appId];
    setContextMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: icon.label || appDef?.name || 'Shortcut', header: true },
        { separator: true },
        { label: 'Open', icon: appDef?.icon || FileText, action: () => launchApp(icon.appId) },
        { label: 'Rename', icon: Edit3, action: () => renameIcon(icon.id, icon.label) },
        { separator: true },
        { label: 'Remove Shortcut', icon: Trash2, danger: true, action: () => removeIcon(icon.id) },
      ],
    });
  }, [launchApp, removeIcon, renameIcon]);

  const showWindowCtx = useCallback((e, win) => {
    e.preventDefault();
    e.stopPropagation();
    focusWindow(win.id);
    const appDef = APPS[win.appId];
    const topBar = 32;
    const dockH = 56;
    const fullW = window.innerWidth;
    const fullH = window.innerHeight - topBar - dockH;

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { header: true, label: appDef?.name || 'Window' },
        { separator: true },
        {
          label: win.maximized ? 'Restore Window' : 'Maximize',
          icon: win.maximized ? Minimize2 : Maximize2,
          shortcut: 'Alt+F10',
          action: () => mutateWindow(win.id, { maximized: !win.maximized }),
        },
        {
          label: 'Minimize',
          icon: Minimize2,
          action: () => mutateWindow(win.id, { minimized: true }),
        },
        { separator: true },
        {
          label: 'Snap Left',
          icon: Layers,
          shortcut: 'Win+←',
          action: () => mutateWindow(win.id, {
            maximized: false,
            x: 0,
            y: topBar,
            width: Math.floor(fullW / 2),
            height: fullH
          }),
        },
        {
          label: 'Snap Right',
          icon: Layers,
          shortcut: 'Win+→',
          action: () => mutateWindow(win.id, {
            maximized: false,
            x: Math.floor(fullW / 2),
            y: topBar,
            width: Math.floor(fullW / 2),
            height: fullH
          }),
        },
        {
          label: 'Center Window',
          icon: Square,
          action: () => mutateWindow(win.id, {
            maximized: false,
            x: Math.max(20, Math.floor((fullW - win.width) / 2)),
            y: Math.max(topBar + 10, Math.floor((window.innerHeight - win.height) / 2))
          }),
        },
        { separator: true },
        {
          label: 'Close Window',
          icon: X,
          danger: true,
          shortcut: 'Alt+F4',
          action: () => closeWindow(win.id),
        },
      ],
    });
  }, [focusWindow, mutateWindow, closeWindow]);

  // ─── Drag / resize / snap ────────────────────────────────────────────────

  const beginDrag = (e, win, resize = false) => {
    if (e.target.closest('button') || win.maximized) return;
    focusWindow(win.id);
    drag.current = { id: win.id, resize, startX: e.clientX, startY: e.clientY, x: win.x, y: win.y, width: win.width, height: win.height };
    e.preventDefault();
  };

  useEffect(() => {
    const move = e => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.startX, dy = e.clientY - drag.current.startY;
      if (drag.current.resize) { mutateWindow(drag.current.id, { width: Math.max(480, drag.current.width+dx), height: Math.max(320, drag.current.height+dy) }); setSnapZone(null); }
      else { mutateWindow(drag.current.id, { x: Math.max(0, drag.current.x+dx), y: Math.max(0, drag.current.y+dy) }); setSnapZone(getSnapZone(e.clientX, e.clientY, desktopRef.current)); }
    };
    const up = () => {
      if (drag.current && snapZone) {
        const d = snapDimensions(snapZone, desktopRef.current);
        if (d) { if (d.maximized) mutateWindow(drag.current.id, { maximized: true }); else mutateWindow(drag.current.id, { x:d.x, y:d.y, width:d.width, height:d.height, maximized:false }); }
      }
      drag.current = null; setSnapZone(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [snapZone]);

  // Global programmatic Aperture actions (can be triggered by SOMA or external agents)
  useEffect(() => {
    const handleTile = () => {
      const topBar = 36;
      const fullW = window.innerWidth;
      const fullH = window.innerHeight - topBar - 68;
      const visible = openWindows.filter(w => !w.minimized);
      if (!visible.length) return;
      if (visible.length === 1) {
        mutateWindow(visible[0].id, {
          maximized: false,
          x: 24,
          y: topBar + 12,
          width: fullW - 48,
          height: fullH - 24,
        });
      } else {
        const halfW = Math.floor(fullW / 2);
        mutateWindow(visible[0].id, {
          maximized: false,
          x: 0,
          y: topBar,
          width: halfW,
          height: fullH,
        });
        mutateWindow(visible[1].id, {
          maximized: false,
          x: halfW,
          y: topBar,
          width: halfW,
          height: fullH,
        });
      }
    };

    const handleToggleGalaxy = () => {
      setDesktopMode(m => m === 'spatial' ? 'grid' : 'spatial');
    };

    const handleSpotlight = () => {
      setSpotlight(true);
    };

    const handleLaunchApp = (e) => {
      if (e.detail?.appId) {
        launchApp(e.detail.appId);
      }
    };

    window.addEventListener('aperture:tile-windows', handleTile);
    window.addEventListener('aperture:toggle-galaxy', handleToggleGalaxy);
    window.addEventListener('aperture:open-spotlight', handleSpotlight);
    window.addEventListener('aperture:launch-app', handleLaunchApp);

    return () => {
      window.removeEventListener('aperture:tile-windows', handleTile);
      window.removeEventListener('aperture:toggle-galaxy', handleToggleGalaxy);
      window.removeEventListener('aperture:open-spotlight', handleSpotlight);
      window.removeEventListener('aperture:launch-app', handleLaunchApp);
    };
  }, [openWindows, mutateWindow, launchApp]);

  const handleTileWindows = useCallback(() => {
    window.dispatchEvent(new CustomEvent('aperture:tile-windows'));
  }, []);

  const handleToggleGalaxy = useCallback(() => {
    setDesktopMode(m => m === 'spatial' ? 'grid' : 'spatial');
  }, []);

  const handleUpdateAutonomy = useCallback((lvl) => {
    updateSettings({ autonomyLevel: lvl });
  }, [updateSettings]);

  // ─── Render ───────────────────────────────────────────────────────────────

  const wallStyle = settings.wallpaper === 'custom' && settings.wallpaperUrl ? { backgroundImage: `url("${settings.wallpaperUrl}")` } : undefined;
  const appProps  = { workspace: activeWorkspace, policy: settings.permissions, settings, onSettingsUpdate: updateSettings, onLaunchApp: launchApp, kernel };
  const localApps = Object.entries(APPS).filter(([, m]) => m.name.toLowerCase().includes(query.toLowerCase()));

  if (booting) return (
    <div className={`aperture-os ap-theme-${settings.theme} ap-wallpaper-${settings.wallpaper}`}>
      <BootScreen lines={bootLines} />
    </div>
  );

  if (locked) return (
    <div className={`aperture-os ap-theme-${settings.theme} ap-wallpaper-${settings.wallpaper}`} style={wallStyle}>
      <LockScreen
        wallpaper={settings.wallpaper}
        wallpaperUrl={settings.wallpaperUrl}
        onUnlock={() => { setLocked(false); lastActivity.current = Date.now(); }}
        onSetPin={(p) => setPin(p)}
      />
    </div>
  );

  return (
    <div
      className={`aperture-os ap-theme-${settings.theme} ap-wallpaper-${settings.wallpaper}`}
      style={wallStyle}
      onClick={closeAllOverlays}
      onContextMenu={showDesktopCtx}
    >
      {/* System bar */}
      <header className="ap-systembar">
        <button className="ap-brand" data-action="launcher" onClick={e => { e.stopPropagation(); setLauncher(v => !v); }}>
          <Sparkles size={15} /> Aperture
        </button>
        <div className="ap-soma-badge" data-action="soma-status">
          <span className={`ap-soma-dot ${snapshot?.ready ? 'online' : 'offline'}`} />
          <span>SOMA {snapshot?.ready ? 'Online' : 'Offline'}</span>
          {snapshot?.cpu != null && <span className="ap-soma-cpu">{snapshot.cpu}% cpu</span>}
        </div>
        <div className="ap-mode-toggles" style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 10 }}>
          <button
            className={`ap-mode-btn ${desktopMode === 'spatial' ? 'active' : ''}`}
            data-action="toggle-galaxy"
            onClick={(e) => { e.stopPropagation(); setDesktopMode(m => m === 'grid' ? 'spatial' : 'grid'); }}
            title="Toggle Spatial Vector Galaxy"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6,
              background: desktopMode === 'spatial' ? 'rgba(92,113,221,0.25)' : 'rgba(255,255,255,0.05)',
              border: desktopMode === 'spatial' ? '1px solid rgba(92,113,221,0.5)' : '1px solid rgba(255,255,255,0.08)',
              color: desktopMode === 'spatial' ? '#99b2ff' : '#94a3b8',
              cursor: 'pointer'
            }}
          >
            <Compass size={12} />
            <span>{desktopMode === 'spatial' ? 'Galaxy View' : 'Grid View'}</span>
          </button>
          <button
            className={`ap-mode-btn ${copilotEnabled ? 'active' : ''}`}
            data-action="toggle-copilot"
            onClick={(e) => { e.stopPropagation(); setCopilotEnabled(c => !c); }}
            title="Toggle SOMA Co-Pilot Ghost Cursor"
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 500, padding: '3px 8px', borderRadius: 6,
              background: copilotEnabled ? 'rgba(40,152,180,0.25)' : 'rgba(255,255,255,0.05)',
              border: copilotEnabled ? '1px solid rgba(40,152,180,0.5)' : '1px solid rgba(255,255,255,0.08)',
              color: copilotEnabled ? '#5eead4' : '#64748b',
              cursor: 'pointer'
            }}
          >
            <Sparkles size={11} />
            <span>Co-Pilot {copilotEnabled ? 'ON' : 'OFF'}</span>
          </button>
          <button
            className={`ap-mode-btn ap-freedom-btn ${settings.autonomyLevel === 3 ? 'sovereign' : ''}`}
            data-action="toggle-autonomy"
            onClick={(e) => {
              e.stopPropagation();
              const next = settings.autonomyLevel === 3 ? 2 : (settings.autonomyLevel === 2 ? 1 : 3);
              updateSettings({ autonomyLevel: next });
            }}
            title={`SOMA Autonomy: ${settings.autonomyLevel === 3 ? 'Sovereign Freedom (Full Agency — Native Desktop Pilot)' : (settings.autonomyLevel === 2 ? 'Co-Pilot (Companion — Acts when idle)' : 'Observe (Manual Only)')}`}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 6,
              background: settings.autonomyLevel === 3 ? 'rgba(245, 158, 11, 0.22)' : 'rgba(255,255,255,0.05)',
              border: settings.autonomyLevel === 3 ? '1px solid rgba(245, 158, 11, 0.55)' : '1px solid rgba(255,255,255,0.08)',
              color: settings.autonomyLevel === 3 ? '#fbbf24' : '#94a3b8',
              cursor: 'pointer',
              boxShadow: settings.autonomyLevel === 3 ? '0 0 12px rgba(245, 158, 11, 0.25)' : 'none',
              transition: 'all 0.2s ease',
            }}
          >
            {settings.autonomyLevel === 3 ? <Crown size={12} style={{ color: '#f59e0b' }} /> : <Bot size={12} />}
            <span>{settings.autonomyLevel === 3 ? '👑 Sovereign Freedom' : (settings.autonomyLevel === 2 ? '🤝 Co-Pilot' : '👁️ Observe')}</span>
          </button>
        </div>
        <div className="ap-bar-actions">
          <button title="Search (Ctrl+K)" data-action="spotlight" onClick={e => { e.stopPropagation(); setSpotlight(true); }}><Search size={15} /></button>
          <button title="Notifications" className={`ap-notif-bell ${unreadCount > 0 ? 'has-unread' : ''}`} onClick={e => { e.stopPropagation(); setShowNotifPanel(v => !v); setShowQuickSettings(false); }}>
            <Bell size={14} />
            {unreadCount > 0 && <span className="ap-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
          </button>
          <button className="ap-qs-trigger" data-action="quicksettings" title="Quick Settings" onClick={e => { e.stopPropagation(); setShowQuickSettings(v => !v); setShowNotifPanel(false); }}>
            <Wifi size={14} className={snapshot?.ready ? 'online' : ''} />
            <Shield size={12} />
            <span className="ap-time">{clock.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'})}&nbsp;&nbsp;{clock.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</span>
          </button>
        </div>
      </header>

      {/* Notification panel */}
      {showNotifPanel && (
        <div className="ap-notif-panel-wrap" onClick={e => e.stopPropagation()}>
          <NotificationPanel notifications={notifications} onClose={() => setShowNotifPanel(false)} onClear={handleClearAll} onMarkRead={handleMarkRead} />
        </div>
      )}

      {/* Quick settings */}
      {showQuickSettings && (
        <div className="ap-quickset-wrap" onClick={e => e.stopPropagation()}>
          <QuickSettings settings={settings} snapshot={snapshot} pin={pin} onUpdate={updateSettings} onClose={() => setShowQuickSettings(false)} onLaunchApp={launchApp} onLock={() => setLocked(true)} />
        </div>
      )}

      {/* Desktop */}
      <main className="ap-desktop" ref={desktopRef}>
        <SnapPreview zone={snapZone} desktop={desktopRef.current} />

        {/* Spatial Galaxy vs Traditional Icon Grid */}
        {desktopMode === 'spatial' ? (
          <SpatialCanvas onLaunchApp={launchApp} />
        ) : (
          <>
            {/* Widgets layer (behind icons and windows) */}
            {widgets.filter(w => w.visible).map(widget => (
              <DesktopWidget
                key={widget.id}
                widget={widget}
                snapshot={snapshot}
                clock={clock}
                onClose={hideWidget}
                onDragStart={beginWidgetDrag}
              />
            ))}

            {/* Desktop icons (below windows) */}
            {desktopIcons.map(icon => (
              <DesktopIcon
                key={icon.id}
                icon={icon}
                onOpen={ic => launchApp(ic.appId)}
                onMove={moveIcon}
                onContextMenu={showIconCtx}
              />
            ))}
          </>
        )}

        {/* Windows */}
        {openWindows.map(win => {
          if (win.minimized) return null;
          const meta = APPS[win.appId];
          const Component = meta.component;
          return (
            <section
              key={win.id}
              data-window-id={win.id}
              data-app-id={win.appId}
              className={`ap-window ${activeWindowId === win.id ? 'active' : ''} ${win.maximized ? 'maximized' : ''}`}
              style={win.maximized ? { zIndex: win.zIndex } : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex }}
              onMouseDown={() => focusWindow(win.id)}
            >
              <div
                className="ap-windowbar"
                onMouseDown={e => beginDrag(e, win)}
                onContextMenu={e => showWindowCtx(e, win)}
                onDoubleClick={() => mutateWindow(win.id, { maximized: !win.maximized })}
              >
                <div className="ap-window-controls ap-window-controls-left">
                  <button onClick={() => mutateWindow(win.id, { maximized: !win.maximized })} className="maximize" data-control="maximize" title={win.maximized ? 'Restore' : 'Maximize'}><span className="square" /></button>
                </div>
                <div className="ap-window-title">
                  {APP_ICONS[win.appId] ? (
                    <img src={APP_ICONS[win.appId]} alt="" style={{ width: 16, height: 16, objectFit: 'contain', marginRight: 6 }} />
                  ) : (
                    <meta.icon size={13} />
                  )}
                  {meta.name}
                  {win.pid && <span className="ap-win-pid">pid:{win.pid}</span>}
                </div>
                <div className="ap-window-controls ap-window-controls-right">
                  <button onClick={() => mutateWindow(win.id, { minimized: true })} className="minimize" data-control="minimize" title="Minimize"><span className="vee">V</span></button>
                  <button onClick={() => closeWindow(win.id)} className="close" data-control="close" title="Close"><span className="circle">O</span></button>
                </div>
              </div>
              <div className="ap-window-content">
                <WindowErrorBoundary
                  appId={win.appId}
                  winId={win.id}
                  onClose={() => closeWindow(win.id)}
                  onRestart={() => {
                    const newPid = kernel.state === 'running' ? kernel.spawn(win.appId, APPS[win.appId]?.name, { ppid: 1, windowId: win.id }) : null;
                    if (newPid) kernel.attachWindow(newPid, win.id);
                    mutateWindow(win.id, { pid: newPid });
                  }}
                >
                  <Suspense fallback={<AppFallback />}><Component {...appProps} windowId={win.id} /></Suspense>
                </WindowErrorBoundary>
              </div>
              {!win.maximized && <div className="ap-resize" onMouseDown={e => beginDrag(e, win, true)} />}
            </section>
          );
        })}
      </main>

      {/* Toast tray */}
      <div className="ap-toast-tray">
        {toasts.slice(-4).map(t => <Toast key={t.id} notif={t} onDismiss={() => dismissToast(t.id)} />)}
      </div>

      {/* Dock */}
      <div className="ap-dock">
        {Object.entries(APPS).map(([id, meta]) => (
          <button
            key={id}
            data-app-id={id}
            data-dock-app={id}
            title={meta.name}
            className={`ap-dock-app ${meta.accent} ${openWindows.some(w => w.appId === id && !w.minimized) ? 'open' : ''}`}
            onClick={() => launchApp(id)}
            onContextMenu={e => showDockCtx(e, id)}
          >
            {APP_ICONS[id] ? (
              <img src={APP_ICONS[id]} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
            ) : (
              <meta.icon size={21} />
            )}
          </button>
        ))}
      </div>

      {/* App launcher */}
      {launcher && (
        <div className="ap-launcher" onClick={e => e.stopPropagation()}>
          <h3>Applications</h3>
          {Object.entries(APPS).map(([id, meta]) => (
            <button key={id} onClick={() => launchApp(id)}>
              {APP_ICONS[id] ? (
                <img src={APP_ICONS[id]} alt="" style={{ width: 24, height: 24, objectFit: 'contain', marginRight: 8 }} />
              ) : (
                <meta.icon size={17} style={{ marginRight: 8 }} />
              )}
              {meta.name}
            </button>
          ))}
        </div>
      )}

      {/* Spotlight */}
      {spotlight && (
        <div className="ap-spotlight-backdrop" onClick={() => setSpotlight(false)}>
          <div className="ap-spotlight" onClick={e => e.stopPropagation()}>
            <label>
              <Search size={18} />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search tasks, notes, projects, apps, kernel..." />
              <button onClick={() => setSpotlight(false)}><X size={16} /></button>
            </label>
            <div className="ap-search-results">
              {localApps.map(([id, meta]) => (
                <button key={id} onClick={() => { launchApp(id); setSpotlight(false); }}>
                  {APP_ICONS[id] ? (
                    <img src={APP_ICONS[id]} alt="" style={{ width: 20, height: 20, objectFit: 'contain', marginRight: 8 }} />
                  ) : (
                    <meta.icon size={15} style={{ marginRight: 8 }} />
                  )}
                  <div><strong>{meta.name}</strong><small>Application</small></div>
                </button>
              ))}
              {results.map(r => (
                <button key={`${r.type}-${r.id}`} onClick={() => { launchApp(r.appId); setSpotlight(false); }}>
                  {APP_ICONS[r.appId] ? (
                    <img src={APP_ICONS[r.appId]} alt="" style={{ width: 20, height: 20, objectFit: 'contain', marginRight: 8 }} />
                  ) : (
                    <Search size={15} style={{ marginRight: 8 }} />
                  )}
                  <div><strong>{r.title}</strong><small>{r.type} — {r.detail}</small></div>
                </button>
              ))}
              {query.length > 1 && !localApps.length && !results.length && <p>No matches in this workspace.</p>}
            </div>
          </div>
        </div>
      )}

      {/* Ghost Cursor Co-Embodiment */}
      <GhostCursor
        enabled={copilotEnabled}
        autonomyLevel={settings.autonomyLevel}
        permissions={settings.permissions}
        locked={locked || booting}
        desktopMode={desktopMode}
        onUpdateAutonomy={handleUpdateAutonomy}
        openWindows={openWindows}
        onTriggerAction={launchApp}
        onTileWindows={handleTileWindows}
        onToggleGalaxy={handleToggleGalaxy}
      />

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
