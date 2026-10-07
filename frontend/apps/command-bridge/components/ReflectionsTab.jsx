import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles, Search, Plus, Send, Trash2,
  Edit3, X, Eye, Lightbulb, Zap, Home, Upload, Brain, Save, Pencil,
  CheckCircle, HelpCircle, Target, Calendar, GitBranch, Shield,
  Link, FileText, Cpu, Star, AlertTriangle, ArrowUpRight, RefreshCw,
  Tag, ChevronDown, Network, Layers, Highlighter
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import './ReflectionsTab.css';
import SomaMuseMode from './SomaMuseMode';

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUSES = [
  { value: 'inbox',    label: 'Inbox',    color: 'text-blue-400',    bg: 'bg-blue-500/10',    border: 'border-blue-500/20' },
  { value: 'raw',      label: 'Raw',      color: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20' },
  { value: 'refined',  label: 'Refined',  color: 'text-green-400',   bg: 'bg-green-500/10',   border: 'border-green-500/20' },
  { value: 'linked',   label: 'Linked',   color: 'text-purple-400',  bg: 'bg-purple-500/10',  border: 'border-purple-500/20' },
  { value: 'archived', label: 'Archived', color: 'text-zinc-500',    bg: 'bg-zinc-500/10',    border: 'border-zinc-500/20' },
  { value: 'promoted', label: 'Promoted', color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/20' },
];
const statusMeta = Object.fromEntries(STATUSES.map(s => [s.value, s]));

const SOMA_ACTIONS = [
  { id: 'summarize',      label: 'Summarize',        Icon: FileText,      color: 'text-cyan-400',    desc: 'Distill to 2-3 sentences' },
  { id: 'contradictions', label: 'Contradictions',   Icon: AlertTriangle, color: 'text-red-400',     desc: 'Find logic gaps' },
  { id: 'tasks',          label: 'Extract Tasks',    Icon: CheckCircle,   color: 'text-green-400',   desc: 'Pull action items' },
  { id: 'suggest-links',  label: 'Suggest Links',    Icon: Link,          color: 'text-purple-400',  desc: 'Find related concepts' },
  { id: 'distill',        label: 'Distill',          Icon: Sparkles,      color: 'text-orange-400',  desc: 'Route the core signal into SOMA memory' },
  { id: 'promote',        label: 'Promote Memory',   Icon: Star,          color: 'text-amber-400',   desc: 'Send to SOMA memory' },
  { id: 'expertise-seed', label: 'Expertise Seed',   Icon: Cpu,           color: 'text-fuchsia-400', desc: 'Structured knowledge export' },
];

const TEMPLATES = [
  { label: 'Idea',     Icon: Lightbulb,  color: 'text-amber-400',   title: 'Idea: ',     body: '## The Idea\n\n\n## Why it matters\n\n' },
  { label: 'Task',     Icon: Target,     color: 'text-violet-400',  title: 'Task: ',     body: '## What needs doing\n\n\n## Done when\n\n' },
  { label: 'Question', Icon: HelpCircle, color: 'text-blue-400',    title: 'Question: ', body: '## The Question\n\n\n## Why I\'m asking\n\n' },
  { label: 'Insight',  Icon: Zap,        color: 'text-fuchsia-400', title: 'Insight: ',  body: '## The Insight\n\n\n## What changes because of this\n\n' },
];

const canvasPosition = (name, index, total) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  const ring = 0.18 + ((Math.abs(hash) % 100) / 100) * 0.32;
  const angle = ((index / Math.max(1, total)) * Math.PI * 2) + ((Math.abs(hash) % 37) / 37);
  return {
    x: 50 + Math.cos(angle) * ring * 100,
    y: 50 + Math.sin(angle) * ring * 72,
  };
};

const shortTitle = (name = '') =>
  name.replace(/\.md$/i, '').replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalizeNoteKey = (value = '') =>
  String(value || '')
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/^\w+\./, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const parseAnnotations = (content = '') => {
  const sectionMatch = String(content).match(/^## Annotations\s*\n([\s\S]*)$/mi);
  if (!sectionMatch) return [];
  const annotations = [];
  const entryRe = />\s*==([\s\S]*?)==\s*\n+([\s\S]*?)(?=\n>\s*==|\n##\s|$)/g;
  let match;
  while ((match = entryRe.exec(sectionMatch[1])) !== null) {
    const quote = match[1].trim();
    const body = match[2].trim();
    const timestamp = body.match(/^- Annotated:\s*(.+)$/mi)?.[1]?.trim() || '';
    const note = body.replace(/\n?- Annotated:\s*.+$/mi, '').trim();
    annotations.push({ quote, note, timestamp });
  }
  return annotations;
};

const renderInline = (text, onWikiLink, onHighlightClick) => {
  const parts = text.split(/(==[^=]+==|\*\*[^*]+\*\*|\*[^*]+\*|\[\[[^\]]+\]\]|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('==') && part.endsWith('==')) {
      const quote = part.slice(2, -2);
      return (
        <button
          key={i}
          type="button"
          onClick={(event) => { event.stopPropagation(); onHighlightClick?.(quote); }}
          onMouseUp={(event) => event.stopPropagation()}
          className="inline rounded bg-amber-300/20 px-0.5 text-amber-100 ring-1 ring-amber-300/10 transition-all hover:bg-amber-300/30 hover:text-amber-50 hover:ring-amber-300/30"
        >
          {quote}
        </button>
      );
    }
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i} className="text-white font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith('*') && part.endsWith('*'))
      return <em key={i} className="text-zinc-200 italic">{part.slice(1, -1)}</em>;
    if (part.startsWith('`') && part.endsWith('`'))
      return <code key={i} className="px-1.5 py-0.5 bg-white/10 rounded text-fuchsia-300 text-xs font-mono">{part.slice(1, -1)}</code>;
    if (part.startsWith('[[') && part.endsWith(']]')) {
      const label = part.slice(2, -2);
      return (
        <button
          key={i}
          type="button"
          onClick={() => onWikiLink?.(label)}
          className="inline rounded-none border-b border-purple-400/30 text-purple-400 transition-colors hover:border-purple-300 hover:text-purple-200"
        >
          {label}
        </button>
      );
    }
    return part;
  });
};

const MarkdownView = ({ content, onWikiLink, onHighlightClick }) => {
  if (!content) return <p className="text-zinc-600 italic text-sm">(Empty note)</p>;
  const stripped = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
  return (
    <div className="space-y-0.5">
      {stripped.split('\n').map((line, i) => {
        if (line.startsWith('# '))   return <h1 key={i} className="text-2xl font-bold text-white mt-8 mb-3 tracking-tight">{renderInline(line.slice(2), onWikiLink, onHighlightClick)}</h1>;
        if (line.startsWith('## '))  return <h2 key={i} className="text-xl font-semibold text-white mt-6 mb-2">{renderInline(line.slice(3), onWikiLink, onHighlightClick)}</h2>;
        if (line.startsWith('### ')) return <h3 key={i} className="text-base font-semibold text-zinc-200 mt-5 mb-1">{renderInline(line.slice(4), onWikiLink, onHighlightClick)}</h3>;
        if (line.startsWith('- ') || line.startsWith('* '))
          return (
            <div key={i} className="flex items-start gap-2 ml-2 my-0.5">
              <span className="text-purple-400 mt-1.5 text-xs flex-shrink-0">▸</span>
              <span className="text-zinc-300 text-sm leading-relaxed">{renderInline(line.slice(2), onWikiLink, onHighlightClick)}</span>
            </div>
          );
        if (line.startsWith('> '))   return <blockquote key={i} className="border-l-2 border-purple-500/40 pl-4 my-2 text-zinc-400 italic text-sm">{renderInline(line.slice(2), onWikiLink, onHighlightClick)}</blockquote>;
        if (line === '---' || line === '***') return <hr key={i} className="border-white/10 my-4" />;
        if (line === '') return <div key={i} className="h-2" />;
        return <p key={i} className="text-zinc-300 text-sm leading-relaxed">{renderInline(line, onWikiLink, onHighlightClick)}</p>;
      })}
    </div>
  );
};

const StatusBadge = ({ status }) => {
  const m = statusMeta[status] || statusMeta.inbox;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest ${m.color} ${m.bg} border ${m.border}`}>
      {m.label}
    </span>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────
const ReflectionsTab = ({ mode = 'full', onClose, context, onSendToSoma }) => {
  const [notes, setNotes] = useState([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedNote, setSelectedNote] = useState(null);
  const [activeSection, setActiveSection] = useState(null);
  const [collapsedWorkbooks, setCollapsedWorkbooks] = useState({});
  const [noteContent, setNoteContent] = useState('');
  const [noteLoading, setNoteLoading] = useState(false);
  const [noteIntel, setNoteIntel] = useState(null);
  const [noteIntelLoading, setNoteIntelLoading] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState('home');
  const [canvasGraph, setCanvasGraph] = useState(null);
  const [canvasLayout, setCanvasLayout] = useState({ positions: {} });
  const [canvasLoading, setCanvasLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isQuickNoteOpen, setIsQuickNoteOpen] = useState(mode === 'quick-note-only');
  const [quickNoteText, setQuickNoteText] = useState(() => localStorage.getItem('soma_draft_text') || '');
  const [quickNoteName, setQuickNoteName] = useState(() => localStorage.getItem('soma_draft_name') || '');
  const [quickNoteError, setQuickNoteError] = useState('');
  const [quickNoteSaving, setQuickNoteSaving] = useState(false);
  const [createModal, setCreateModal] = useState(null);
  const [createForm, setCreateForm] = useState({ title: '', workbook: '', segment: '', section: '', description: '' });
  const [createContext, setCreateContext] = useState({});
  const [createSaving, setCreateSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadSubstrateMsg, setUploadSubstrateMsg] = useState('');
  const [storyStatus, setStoryStatus] = useState(null);
  const [storyActionStatus, setStoryActionStatus] = useState(null);
  const fileInputRef = useRef(null);
  const canvasSurfaceRef = useRef(null);
  const canvasDragRef = useRef(null);
  const canvasDragMovedRef = useRef(false);
  const noteBodyRef = useRef(null);

  useEffect(() => { localStorage.setItem('soma_draft_text', quickNoteText); }, [quickNoteText]);
  useEffect(() => { localStorage.setItem('soma_draft_name', quickNoteName); }, [quickNoteName]);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [selectedTextForAnnotation, setSelectedTextForAnnotation] = useState('');
  const [annotationModalOpen, setAnnotationModalOpen] = useState(false);
  const [annotationText, setAnnotationText] = useState('');
  const [annotationSaving, setAnnotationSaving] = useState(false);
  const [activeAnnotation, setActiveAnnotation] = useState(null);

  // Status editing
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Content search
  const [searchResults, setSearchResults] = useState(null);
  const searchTimerRef = useRef(null);

  // SOMA actions panel
  const [actionResult, setActionResult] = useState(null); // { action, result, loading }
  const [actionLoading, setActionLoading] = useState(false);

  // Muse flow
  const [isBrainstorming, setIsBrainstorming] = useState(false);
  const [sessionLog, setSessionLog] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [museResidue, setMuseResidue] = useState(null);
  const museEndRef = useRef(null);
  const [crystallizeModalOpen, setCrystallizeModalOpen] = useState(false);
  const [crystallizeName, setCrystallizeName] = useState('');
  const [crystallizing, setCrystallizing] = useState(false);

  // Archivist
  const [archivistLog, setArchivistLog] = useState([]);
  const [archivistInput, setArchivistInput] = useState('');
  const [archivistThinking, setArchivistThinking] = useState(false);
  const archivistEndRef = useRef(null);

  // Vault scan
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [reflectionIntel, setReflectionIntel] = useState(null);
  const [reflectionIntelLoading, setReflectionIntelLoading] = useState(false);

  // Graph surface
  const [graphStats, setGraphStats] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);

  // Hygiene
  const [hygieneView, setHygieneView] = useState(false);
  const [hygieneData, setHygieneData] = useState(null);
  const [hygieneLoading, setHygieneLoading] = useState(false);
  const [museRoomMode, setMuseRoomMode] = useState(false);

  useEffect(() => {
    if (museEndRef.current) museEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [sessionLog]);
  useEffect(() => {
    if (archivistEndRef.current) archivistEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [archivistLog]);

  const refreshNotes = useCallback(async () => {
    try {
      const res = await fetch('/api/reflections/list');
      const data = await res.json();
      if (data.success) setNotes(data.notes);
    } catch (e) { console.error('Failed to fetch reflections', e); }
  }, []);

  const loadCanvasGraph = useCallback(async () => {
    setCanvasLoading(true);
    try {
      const [graphRes, layoutRes] = await Promise.all([
        fetch('/api/reflections/graph'),
        fetch('/api/reflections/canvas-layout').catch(() => null),
      ]);
      const data = await graphRes.json();
      if (data.success) setCanvasGraph(data);
      if (layoutRes) {
        const layout = await layoutRes.json().catch(() => null);
        if (layout?.success) setCanvasLayout(layout.layout || { positions: {} });
      }
    } catch (e) { console.error('Canvas graph failed', e); }
    finally { setCanvasLoading(false); }
  }, []);

  const saveCanvasLayout = useCallback(async (positions) => {
    try {
      await fetch('/api/reflections/canvas-layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      });
    } catch (e) { console.error('Canvas layout save failed', e); }
  }, []);

  const loadStoryStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/social/stories/status');
      const data = await res.json();
      if (res.ok && data.ok !== false) setStoryStatus(data);
    } catch (e) { console.error('Story workspace status failed', e); }
  }, []);

  const handleCanvasPointerMove = useCallback((event) => {
    const drag = canvasDragRef.current;
    const surface = canvasSurfaceRef.current;
    if (!drag || !surface) return;
    const rect = surface.getBoundingClientRect();
    const x = Math.max(3, Math.min(97, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(5, Math.min(95, ((event.clientY - rect.top) / rect.height) * 100));
    canvasDragMovedRef.current = true;
    setCanvasLayout(prev => ({
      ...prev,
      positions: {
        ...(prev.positions || {}),
        [drag.id]: { x, y },
      },
    }));
  }, []);

  const handleCanvasPointerUp = useCallback(() => {
    if (!canvasDragRef.current) return;
    canvasDragRef.current = null;
    setCanvasLayout(prev => {
      saveCanvasLayout(prev.positions || {});
      return prev;
    });
    setTimeout(() => { canvasDragMovedRef.current = false; }, 0);
  }, [saveCanvasLayout]);

  useEffect(() => { refreshNotes(); }, [refreshNotes]);
  useEffect(() => { loadStoryStatus(); }, [loadStoryStatus]);
  useEffect(() => {
    if (workspaceMode === 'canvas') loadCanvasGraph();
  }, [workspaceMode, loadCanvasGraph, notes.length]);

  useEffect(() => {
    if (!selectedNote) { setNoteContent(''); setNoteIntel(null); setActionResult(null); return; }
    setIsEditing(false);
    setEditContent('');
    setActionResult(null);
    setSelectedTextForAnnotation('');
    setAnnotationModalOpen(false);
    setActiveAnnotation(null);
    setNoteLoading(true);
    setNoteIntelLoading(true);
    fetch(`/api/reflections/note/${encodeURIComponent(selectedNote.name)}`)
      .then(r => r.json())
      .then(data => { if (data.success) setNoteContent(data.content || ''); })
      .catch(() => setNoteContent('(Could not load note content)'))
      .finally(() => setNoteLoading(false));

    Promise.all([
      fetch(`/api/reflections/links/${encodeURIComponent(selectedNote.name)}`).then(r => r.json()).catch(() => null),
      fetch(`/api/reflections/related/${encodeURIComponent(selectedNote.name)}`).then(r => r.json()).catch(() => null),
    ]).then(([links, related]) => {
      setNoteIntel({
        links: links?.success ? links : null,
        related: related?.success ? related.results || [] : [],
      });
    }).finally(() => setNoteIntelLoading(false));
  }, [selectedNote]);

  const goHome = () => {
    setSelectedNote(null);
    setNoteContent('');
    setIsBrainstorming(false);
    setSessionLog([]);
    setMuseResidue(null);
    setHygieneView(false);
    setWorkspaceMode('home');
    setActionResult(null);
  };

  // ── Daily note ─────────────────────────────────────────────────────────────
  const handleDailyNote = async () => {
    try {
      const res = await fetch('/api/reflections/daily', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        await refreshNotes();
        setSelectedNote({ name: data.filename, status: 'inbox' });
      }
    } catch (e) { console.error('Daily note failed', e); }
  };

  // ── Status update ──────────────────────────────────────────────────────────
  const handleStatusChange = async (newStatus) => {
    if (!selectedNote) return;
    setUpdatingStatus(true);
    setStatusDropdownOpen(false);
    try {
      const res = await fetch(`/api/reflections/note/${encodeURIComponent(selectedNote.name)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.success) {
        setSelectedNote(prev => ({ ...prev, status: newStatus }));
        setNotes(prev => prev.map(n => n.name === selectedNote.name ? { ...n, status: newStatus } : n));
      }
    } catch (e) { console.error('Status update failed', e); }
    finally { setUpdatingStatus(false); }
  };

  // ── SOMA actions ───────────────────────────────────────────────────────────
  const handleSomaAction = async (action) => {
    if (!noteContent || actionLoading) return;
    setActionLoading(true);
    setActionResult({ action, result: null, loading: true });
    try {
      const res = await fetch('/api/reflections/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedNote?.name, action, content: noteContent }),
      });
      const data = await res.json();
      if (data.success) {
        setActionResult({ action, result: data.result, brainLanes: data.brainLanes || [], loading: false });
        if (action === 'promote' || action === 'distill') {
          setSelectedNote(prev => ({ ...prev, status: 'promoted' }));
          setNotes(prev => prev.map(n => n.name === selectedNote?.name ? { ...n, status: 'promoted' } : n));
        }
      } else {
        setActionResult({ action, result: `Error: ${data.error}`, loading: false });
      }
    } catch (e) {
      setActionResult({ action, result: 'Action failed — backend unreachable', loading: false });
    } finally {
      setActionLoading(false);
    }
  };

  // ── Graph surface ──────────────────────────────────────────────────────────
  const loadGraphStats = async () => {
    setGraphLoading(true);
    try {
      const res = await fetch('/api/reflections/graph');
      const data = await res.json();
      if (data.success) {
        const connected = new Set([...data.edges.map(e => e.source), ...data.edges.map(e => e.target)]);
        setGraphStats({
          nodes: data.nodes.length,
          edges: data.edges.length,
          isolated: data.nodes.filter(n => !connected.has(n.id)).length,
        });
      }
    } catch (e) { console.error('Graph load failed', e); }
    finally { setGraphLoading(false); }
  };

  useEffect(() => {
    if (notes.length > 0 && !graphStats) loadGraphStats();
  }, [notes.length]);

  // ── Reflection intelligence ───────────────────────────────────────────────
  const loadReflectionIntel = async () => {
    if (notes.length === 0) return;
    setReflectionIntelLoading(true);
    try {
      const res = await fetch('/api/reflections/intelligence');
      const data = await res.json();
      if (data.success) setReflectionIntel(data);
    } catch (e) { console.error('Reflection intelligence failed', e); }
    finally { setReflectionIntelLoading(false); }
  };

  useEffect(() => {
    if (notes.length > 0 && !reflectionIntel && !reflectionIntelLoading) loadReflectionIntel();
  }, [notes.length]);

  // ── Hygiene ────────────────────────────────────────────────────────────────
  const loadHygiene = async () => {
    setHygieneLoading(true);
    try {
      const res = await fetch('/api/reflections/hygiene');
      const data = await res.json();
      if (data.success) setHygieneData(data);
    } catch (e) { console.error('Hygiene check failed', e); }
    finally { setHygieneLoading(false); }
  };

  const handleOpenHygiene = () => {
    setHygieneView(true);
    setSelectedNote(null);
    setIsBrainstorming(false);
    setWorkspaceMode('home');
    if (!hygieneData) loadHygiene();
  };

  const toggleWorkbookCollapse = (workbookTitle) => {
    setCollapsedWorkbooks(prev => ({
      ...prev,
      [workbookTitle]: !prev[workbookTitle],
    }));
  };

  const noteDisplayTitle = (note) => note?.title || note?.name?.replace(/\.md$/i, '') || '';

  const findFirstSectionInWorkbook = (workbookTitle) => {
    const segmentsInWorkbook = notes.filter(n => n.type === 'segment' && n.workbook === workbookTitle);
    const segmentTitles = segmentsInWorkbook.map(noteDisplayTitle);
    const section = notes.find(n =>
      n.type === 'section' &&
      n.workbook === workbookTitle &&
      (segmentTitles.length === 0 || segmentTitles.includes(n.segment))
    ) || notes.find(n => n.type === 'section' && n.workbook === workbookTitle);
    if (!section) return null;
    const sectionTitle = noteDisplayTitle(section);
    return {
      workbook: workbookTitle,
      segment: section.segment || segmentsInWorkbook[0]?.title || segmentsInWorkbook[0]?.name?.replace(/\.md$/i, '') || workbookTitle,
      section: sectionTitle,
      title: sectionTitle,
    };
  };

  const findFirstSectionInSegment = (workbookTitle, segmentTitle) => {
    const section = notes.find(n => n.type === 'section' && n.workbook === workbookTitle && n.segment === segmentTitle);
    if (!section) return null;
    const sectionTitle = noteDisplayTitle(section);
    return { workbook: workbookTitle, segment: segmentTitle, section: sectionTitle, title: sectionTitle };
  };

  const selectWorkbook = (workbook) => {
    const workbookTitle = noteDisplayTitle(workbook);
    setSelectedNote(workbook);
    setActiveSection({ mode: 'workbook', workbook: workbookTitle, title: workbookTitle });
  };

  const selectSegment = (segment, workbookTitle) => {
    const segmentTitle = noteDisplayTitle(segment);
    setSelectedNote(segment);
    setActiveSection({ mode: 'segment', workbook: workbookTitle, segment: segmentTitle, title: segmentTitle });
  };

  const selectSection = (section, workbookTitle, segmentTitle) => {
    const sectionTitle = noteDisplayTitle(section);
    setSelectedNote(section);
    setActiveSection({ mode: 'section', workbook: workbookTitle, segment: segmentTitle, section: sectionTitle, title: sectionTitle });
  };

  const openCreateModal = (type, context = {}) => {
    const firstWorkbook = notes.find(n => n.type === 'workbook')?.title || notes.find(n => n.type === 'workbook')?.name?.replace(/\.md$/i, '') || '';
    const firstSegment = notes.find(n => n.type === 'segment' && (!firstWorkbook || n.workbook === firstWorkbook))?.title || '';
    const firstSection = notes.find(n => n.type === 'section' && (!firstWorkbook || n.workbook === firstWorkbook) && (!firstSegment || n.segment === firstSegment))?.title || '';
    setCreateModal(type);
    setCreateContext(context);
    setCreateForm({
      title: '',
      workbook: context.workbook || (type === 'workbook' ? '' : firstWorkbook),
      segment: context.segment || ((type === 'section' || type === 'folio') ? firstSegment : ''),
      section: context.section || (type === 'folio' ? firstSection : ''),
      description: '',
    });
  };

  const openWikiLink = (label) => {
    const cleanLabel = String(label || '').split('|')[0].trim();
    const labelKey = normalizeNoteKey(cleanLabel);
    const match = notes.find(note => {
      const title = note.title || note.name;
      return normalizeNoteKey(title) === labelKey || normalizeNoteKey(note.name) === labelKey;
    });
    if (match) {
      setSelectedNote(match);
      return;
    }
    setCreateModal('note');
    setCreateContext({ source: 'wiki-link', linkLabel: cleanLabel });
    setCreateForm({
      title: cleanLabel,
      workbook: '',
      segment: '',
      section: '',
      description: `# ${cleanLabel}\n\nLinked from ${selectedNote ? `[[${selectedNote.title || selectedNote.name.replace(/\.md$/i, '')}]]` : 'Reflections'}.\n\n`,
    });
  };

  const copyWikiLink = async () => {
    if (!selectedNote) return;
    const title = selectedNote.title || selectedNote.name.replace(/\.md$/i, '');
    try {
      await navigator.clipboard?.writeText(`[[${title}]]`);
    } catch {}
  };

  const handleCreateArtifact = async () => {
    if (!createModal || !createForm.title.trim() || createSaving) return;
    setCreateSaving(true);
    try {
      const endpoint = createModal === 'note'
        ? '/api/reflections/quick-note'
        : `/api/reflections/${createModal}`;
      const payload = createModal === 'note'
        ? { title: createForm.title.trim(), text: createForm.description.trim() || '# ' + createForm.title.trim() + '\n\n' }
        : {
          title: createForm.title.trim(),
          workbook: createForm.workbook,
          segment: createForm.segment,
          section: createForm.section,
          description: createForm.description,
          content: createForm.description,
        };
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || `Create failed (${res.status})`);
      setCreateModal(null);
      setCreateContext({});
      await refreshNotes();
      if (data.filename) setSelectedNote({ name: data.filename });
    } catch (error) {
      setQuickNoteError(error.message || 'Create failed');
    } finally {
      setCreateSaving(false);
    }
  };

  const openCanvas = () => {
    setSelectedNote(null);
    setNoteContent('');
    setIsBrainstorming(false);
    setHygieneView(false);
    setWorkspaceMode('canvas');
  };

  const handleStoryExport = async (kind) => {
    setStoryActionStatus(kind === 'wattpad' ? 'Exporting Wattpad draft...' : kind === 'full-chapter' ? 'Writing full chapter draft...' : 'Adding story to Reflections...');
    try {
      const endpoint = kind === 'wattpad'
        ? '/api/social/stories/wattpad/export'
        : kind === 'full-chapter'
          ? '/api/social/stories/chapter/full'
          : '/api/social/stories/reflections/export';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'full-chapter' ? { targetWords: 1600 } : { includeChapters: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) throw new Error(data.error || 'Story export failed');
      setStoryActionStatus(kind === 'wattpad' ? 'Wattpad draft ready.' : kind === 'full-chapter' ? `Full chapter ready: ${data.wordCount || 'draft'} words.` : 'Story notes created.');
      await loadStoryStatus();
      if (kind === 'reflections' || kind === 'full-chapter') await refreshNotes();
    } catch (error) {
      setStoryActionStatus(error.message || 'Story export failed');
    } finally {
      setTimeout(() => setStoryActionStatus(null), 5000);
    }
  };

  // ── Existing handlers ──────────────────────────────────────────────────────
  const handleSaveQuickNote = async () => {
    if (!quickNoteText.trim()) return;
    setQuickNoteError('');
    setQuickNoteSaving(true);
    try {
      const res = await fetch('/api/reflections/quick-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: quickNoteText, title: quickNoteName.trim() || undefined, context }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        setQuickNoteText('');
        setQuickNoteName('');
        localStorage.removeItem('soma_draft_text');
        localStorage.removeItem('soma_draft_name');
        if (mode === 'quick-note-only') { onClose(); }
        else { setIsQuickNoteOpen(false); refreshNotes(); }
      } else {
        setQuickNoteError(data.error || `Server error ${res.status}`);
      }
    } catch { setQuickNoteError('Could not reach server'); }
    finally { setQuickNoteSaving(false); }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadStatus('uploading');
    setUploadError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/reflections/upload', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.isBook && data.substrate?.mnemonicPassages) {
          setUploadStatus('absorbed');
          setUploadSubstrateMsg(`🧬 Absorbed into substrate: ${data.substrate.mnemonicPassages} passages vectorized`);
          setTimeout(() => { setUploadStatus(''); setUploadSubstrateMsg(''); }, 6000);
        } else {
          setUploadStatus('done');
          setTimeout(() => setUploadStatus(''), 3000);
        }
        refreshNotes();
      } else {
        setUploadStatus('error');
        setUploadError(data.error || `Upload failed (${res.status})`);
        setTimeout(() => setUploadStatus(''), 4000);
      }
    } catch (error) {
      setUploadStatus('error');
      setUploadError(error.message || 'Could not reach backend');
      setTimeout(() => setUploadStatus(''), 4000);
    }
  };

  const startEdit = () => { setEditContent(noteContent); setIsEditing(true); };
  const cancelEdit = () => { setIsEditing(false); setEditContent(''); };

  const handleSaveEdit = async () => {
    if (!selectedNote) return;
    setSaving(true);
    try {
      const res = await fetch('/api/reflections/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedNote.name, content: editContent }),
      });
      const data = await res.json();
      if (data.success) { setNoteContent(editContent); setIsEditing(false); setEditContent(''); }
    } catch (e) { console.error('Save failed', e); }
    finally { setSaving(false); }
  };

  const captureTextSelection = () => {
    if (isEditing || !selectedNote || !noteBodyRef.current) return;
    const selection = window.getSelection?.();
    const text = selection?.toString?.().trim();
    if (!text || text.length < 3) return;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if (!noteBodyRef.current.contains(anchor) || !noteBodyRef.current.contains(focus)) return;
    setSelectedTextForAnnotation(text.slice(0, 1000));
    setActiveAnnotation(null);
    setAnnotationText('');
  };

  const escapeRegExp = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const insertAnnotationIntoContent = (content, quote, note) => {
    const safeQuote = quote.trim();
    const safeNote = note.trim();
    const now = new Date().toISOString();
    const highlighted = content.includes(`==${safeQuote}==`)
      ? content
      : content.replace(new RegExp(escapeRegExp(safeQuote)), `==${safeQuote}==`);
    const entry = [
      '',
      `> ==${safeQuote}==`,
      '',
      safeNote,
      '',
      `- Annotated: ${now}`,
    ].join('\n');

    if (/^## Annotations\s*$/mi.test(highlighted)) {
      return highlighted.replace(/^## Annotations\s*$/mi, match => `${match}\n${entry}`);
    }
    return `${highlighted.trimEnd()}\n\n## Annotations\n${entry}\n`;
  };

  const updateAnnotationInContent = (content, quote, note) => {
    const safeQuote = quote.trim();
    const safeNote = note.trim();
    const now = new Date().toISOString();
    const entryRe = new RegExp(`>\\s*==${escapeRegExp(safeQuote)}==\\s*\\n+([\\s\\S]*?)(?=\\n>\\s*==|\\n##\\s|$)`);
    if (!entryRe.test(content)) return insertAnnotationIntoContent(content, safeQuote, safeNote);
    return content.replace(entryRe, [
      `> ==${safeQuote}==`,
      '',
      safeNote,
      '',
      `- Annotated: ${now}`,
    ].join('\n'));
  };

  const openHighlightAnnotation = (quote) => {
    const annotation = parseAnnotations(noteContent).find(item => item.quote.trim() === String(quote || '').trim());
    setSelectedTextForAnnotation(String(quote || '').trim());
    setAnnotationText(annotation?.note || '');
    setActiveAnnotation(annotation || { quote: String(quote || '').trim(), note: '' });
    setAnnotationModalOpen(true);
  };

  const saveAnnotation = async () => {
    if (!selectedNote || !selectedTextForAnnotation.trim() || !annotationText.trim() || annotationSaving) return;
    setAnnotationSaving(true);
    try {
      const nextContent = activeAnnotation
        ? updateAnnotationInContent(noteContent, activeAnnotation.quote || selectedTextForAnnotation, annotationText)
        : insertAnnotationIntoContent(noteContent, selectedTextForAnnotation, annotationText);
      const res = await fetch('/api/reflections/note', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: selectedNote.name, content: nextContent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) throw new Error(data.error || 'Annotation save failed');
      setNoteContent(nextContent);
      setAnnotationText('');
      setAnnotationModalOpen(false);
      setSelectedTextForAnnotation('');
      setActiveAnnotation(null);
      await refreshNotes();
    } catch (error) {
      setQuickNoteError(error.message || 'Annotation save failed');
    } finally {
      setAnnotationSaving(false);
    }
  };

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (val.trim().length < 3) { setSearchResults(null); return; }
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/reflections/search?q=${encodeURIComponent(val.trim())}`);
        const data = await res.json();
        if (data.success) setSearchResults(data.results);
      } catch { setSearchResults(null); }
    }, 350);
  };

  const startBrainstorm = () => {
    setIsBrainstorming(true);
    setWorkspaceMode('home');
    setMuseResidue(null);
    setHygieneView(false);
    setSessionLog([{ role: 'soma', text: "The Muse is awake. What are we breaking open today?", timestamp: Date.now() }]);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;
    const userMsg = { role: 'user', text: inputMessage, timestamp: Date.now() };
    setSessionLog(prev => [...prev, userMsg]);
    setInputMessage('');
    try {
      const res = await fetch('/api/muse/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: inputMessage, mode: 'full', history: sessionLog.slice(-8), domain: 'reflections-brainstorm' }),
      });
      const data = await res.json();
      if (data.ok || data.success) {
        setSessionLog(prev => [...prev, { role: 'soma', text: data.response || data.text || data.message || '', timestamp: Date.now() }]);
        setMuseResidue({
          spark: data.structured?.spark || '',
          variant: data.structured?.variant || '',
          critique: data.structured?.critique || '',
          crystallize: data.structured?.crystallize || '',
        });
      }
    } catch (e) { console.error('Brainstorm message failed', e); }
  };

  const finalizeBrainstorm = () => { setCrystallizeName(''); setCrystallizeModalOpen(true); };

  const doFinalizeBrainstorm = async () => {
    if (!crystallizeName.trim()) return;
    setCrystallizing(true);
    const chatLog = sessionLog.map(m => `${m.role.toUpperCase()}: ${m.text}`).join('\n\n');
    try {
      const res = await fetch('/api/reflections/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatLog, title: crystallizeName, mode: 'muse', history: sessionLog, metadata: { tags: ['muse-session', 'aurora'] } }),
      });
      const data = await res.json();
      if (data.success || data.ok) {
        setCrystallizeModalOpen(false);
        setCrystallizeName('');
        setIsBrainstorming(false);
        setSessionLog([]);
        setMuseResidue(null);
        await refreshNotes();
        if (data.filename) setSelectedNote({ name: data.filename });
      }
    } catch (e) { console.error('Crystallization failed', e); }
    finally { setCrystallizing(false); }
  };

  const handleDeleteNote = async (e, noteName) => {
    e.stopPropagation();
    if (!window.confirm(`Delete note "${noteName.replace('.md', '')}"?`)) return;
    try {
      const res = await fetch(`/api/reflections/note/${encodeURIComponent(noteName)}`, { method: 'DELETE' });
      if (res.ok) {
        if (selectedNote?.name === noteName) goHome();
        refreshNotes();
      }
    } catch (err) { console.error('Delete failed', err); }
  };

  const handleAnalyzeVault = async () => {
    if (notes.length === 0) return;
    setInsightsLoading(true);
    setInsights(null);
    try {
      const res = await fetch('/api/reflections/analyze');
      const data = await res.json();
      if (data.success) setInsights(data.insights);
    } catch (e) { console.error('Vault analysis failed', e); }
    finally { setInsightsLoading(false); }
  };

  const openIntelNote = (item) => {
    const name = item?.name || item?.source || item?.note?.name || item?.notes?.[0]?.name;
    if (!name) return;
    setSelectedNote({ name });
    setWorkspaceMode('home');
    setIsBrainstorming(false);
  };

  const handleArchivistMessage = async () => {
    if (!archivistInput.trim() || archivistThinking) return;
    const question = archivistInput;
    setArchivistLog(prev => [...prev, { role: 'user', text: question }]);
    setArchivistInput('');
    setArchivistThinking(true);

    const noteList = notes.map(n => n.name.replace('.md', '')).join(', ');
    let noteCtx = '';
    let citations = [];

    if (selectedNote && noteContent) {
      noteCtx = `\n\nCurrently viewing: "${selectedNote.name.replace('.md', '')}":\n${noteContent.replace(/^---[\s\S]*?---\n?/, '').trim().slice(0, 2500)}`;
      citations.push(selectedNote.name);
    } else {
      const semantic = await fetch(`/api/reflections/search?q=${encodeURIComponent(question)}`).then(r => r.json()).catch(() => null);
      const semanticMatches = semantic?.success ? semantic.results || [] : [];
      const qWords = new Set((question.toLowerCase().match(/\b\w{4,}\b/g) || []));
      const filenameMatches = notes.filter(n => [...qWords].some(w => n.name.toLowerCase().includes(w))).map(n => ({ name: n.name }));
      const seen = new Set();
      const matches = [...semanticMatches, ...filenameMatches].filter(item => item?.name && !seen.has(item.name) && seen.add(item.name)).slice(0, 4);
      if (matches.length > 0) {
        const fetched = await Promise.all(matches.map(n =>
          fetch(`/api/reflections/note/${encodeURIComponent(n.name)}`).then(r => r.json())
            .then(d => d.success ? `[${n.name.replace('.md', '')}]\n${(d.content || '').replace(/^---[\s\S]*?---\n?/, '').trim().slice(0, 800)}` : null)
            .catch(() => null)
        ));
        const valid = fetched.filter(Boolean);
        if (valid.length) noteCtx = `\n\nRelevant notes found:\n${valid.join('\n\n')}`;
        citations = matches.map(m => m.name);
      }
    }

    const query = `[REFLECTIONS ARCHIVIST]\nThe user has ${notes.length} notes in their reflection vault: ${noteList}.${noteCtx}\n\nAnswer from the supplied notes when possible. Cite note filenames used under a short "Sources:" line.\n\nQuestion: ${question}`;
    try {
      const res = await fetch('/api/soma/reason', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, context: { mode: 'fast', brain: 'LOGOS' } }) });
      const data = await res.json();
      let reply = data.response?.text || data.text || 'No response from Archivist.';
      if (citations.length && !/sources:/i.test(reply)) reply += `\n\nSources: ${citations.slice(0, 4).join(', ')}`;
      setArchivistLog(prev => [...prev, { role: 'soma', text: reply }]);
    } catch {
      setArchivistLog(prev => [...prev, { role: 'soma', text: 'Archivist unreachable. Check backend connection.' }]);
    } finally { setArchivistThinking(false); }
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const currentStatus = selectedNote
    ? (notes.find(n => n.name === selectedNote.name)?.status || selectedNote.status || 'inbox')
    : null;

  const visibleNotes = notes.filter(n => {
    const matchesStatus = statusFilter === 'all' || n.status === statusFilter;
    const matchesSearch = !searchQuery || n.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });
  const workbooks = notes.filter(n => n.type === 'workbook');
  const segments = notes.filter(n => n.type === 'segment' && (!createForm.workbook || n.workbook === createForm.workbook));
  const sections = notes.filter(n =>
    n.type === 'section' &&
    (!createForm.workbook || n.workbook === createForm.workbook) &&
    (!createForm.segment || n.segment === createForm.segment)
  );
  const activeWorkbookSegments = activeSection
    ? notes.filter(n => n.type === 'segment' && n.workbook === activeSection.workbook)
    : [];
  const activeSegmentSections = activeSection
    ? notes.filter(n =>
        n.type === 'section' &&
        n.workbook === activeSection.workbook &&
        n.segment === activeSection.segment
      )
    : [];
  const activeSegmentLooseFolios = activeSection
    ? notes.filter(n =>
        n.type === 'folio' &&
        n.workbook === activeSection.workbook &&
        n.segment === activeSection.segment &&
        !n.section
      )
    : [];
  const activeSectionFolios = activeSection
    ? notes.filter(n =>
        n.type === 'folio' &&
        n.workbook === activeSection.workbook &&
        n.segment === activeSection.segment &&
        n.section === activeSection.section
      )
    : [];

  const intelligenceCards = reflectionIntel ? [
    {
      id: 'trails',
      title: 'Thought Trails',
      Icon: GitBranch,
      tone: 'cyan',
      items: reflectionIntel.thoughtTrails || [],
      empty: 'No connected trails yet.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">{item.title}</span>
          <span className="block text-zinc-500">{item.strength} links · {item.stage}</span>
        </>
      )
    },
    {
      id: 'recall',
      title: 'Living Recall',
      Icon: Calendar,
      tone: 'amber',
      items: reflectionIntel.livingRecall || [],
      empty: 'Nothing needs resurfacing.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">{item.title}</span>
          <span className="block text-zinc-500">{item.reason}</span>
        </>
      )
    },
    {
      id: 'annotations',
      title: 'Annotation Graph',
      Icon: Highlighter,
      tone: 'yellow',
      items: reflectionIntel.annotationGraph || [],
      empty: 'No highlight notes yet.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100 line-clamp-1">{item.quote}</span>
          <span className="block text-zinc-500">{item.title}</span>
        </>
      )
    },
    {
      id: 'distiller',
      title: 'Distiller Inbox',
      Icon: Sparkles,
      tone: 'fuchsia',
      items: reflectionIntel.distillerInbox || [],
      empty: 'No distillation queue.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">{item.title}</span>
          <span className="block text-zinc-500">{item.type} · {item.reason}</span>
        </>
      )
    },
    {
      id: 'contradictions',
      title: 'Contradiction Radar',
      Icon: AlertTriangle,
      tone: 'red',
      items: reflectionIntel.contradictions || [],
      empty: 'No tension detected.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">{item.title}</span>
          <span className="block text-zinc-500 line-clamp-1">{item.snippet}</span>
        </>
      )
    },
    {
      id: 'maturity',
      title: 'Idea Maturity',
      Icon: Target,
      tone: 'green',
      items: reflectionIntel.maturity || [],
      empty: 'No mature ideas yet.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">{item.title}</span>
          <span className="block text-zinc-500">{item.score}/100 · {item.stage}</span>
        </>
      )
    },
    {
      id: 'transform',
      title: 'Transformations',
      Icon: ArrowUpRight,
      tone: 'purple',
      items: reflectionIntel.transformations || [],
      empty: 'No transform candidates.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">{item.mode}</span>
          <span className="block text-zinc-500">{item.title}</span>
        </>
      )
    },
    {
      id: 'heat',
      title: 'Memory Heatmap',
      Icon: Network,
      tone: 'blue',
      items: reflectionIntel.heatmap?.topics || [],
      empty: 'No activity heat yet.',
      render: item => (
        <>
          <span className="font-semibold text-zinc-100">#{item.term}</span>
          <span className="block text-zinc-500">{item.count} reflection{item.count === 1 ? '' : 's'}</span>
        </>
      )
    }
  ] : [];

  // ── QUICK NOTE MODE ────────────────────────────────────────────────────────
  if (mode === 'quick-note-only') {
    return (
      <div className="h-full w-full bg-[#0d0d0f]/95 backdrop-blur-3xl border-l border-white/10 shadow-2xl flex flex-col">
        <div className="px-6 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Edit3 className="w-4 h-4 text-purple-400 flex-shrink-0" />
            <input value={quickNoteName} onChange={e => setQuickNoteName(e.target.value)} placeholder="Note title..."
              className="flex-1 bg-transparent text-white font-semibold text-sm outline-none placeholder-zinc-600 min-w-0" />
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-white transition-all flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 p-5 flex flex-col gap-3 min-h-0">
          <div className="flex gap-2">
            {TEMPLATES.map(t => (
              <button key={t.label} onClick={() => { setQuickNoteName(t.title); setQuickNoteText(t.body); }}
                className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-zinc-500 hover:text-zinc-300 text-[10px] font-medium transition-all flex flex-col items-center gap-1">
                <t.Icon className={`w-3.5 h-3.5 ${t.color}`} />
                {t.label}
              </button>
            ))}
          </div>
          <textarea autoFocus value={quickNoteText}
            onChange={(e) => { setQuickNoteText(e.target.value); setQuickNoteError(''); }}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveQuickNote(); }}
            placeholder="Capture a thought..."
            className="flex-1 bg-white/5 border border-white/5 rounded-xl p-4 text-sm text-zinc-200 outline-none focus:border-purple-500/30 transition-all resize-none leading-relaxed" />
          {quickNoteError && <p className="text-xs text-red-400 font-mono text-center">{quickNoteError}</p>}
          {context && <p className="text-[10px] text-zinc-700 font-mono text-center">context: {context}</p>}
          <div className="flex gap-2">
            <button onClick={handleSaveQuickNote} disabled={quickNoteSaving || !quickNoteText.trim()}
              className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 rounded-xl font-semibold text-sm transition-all border border-white/5 hover:border-purple-500/30 active:scale-[0.98] flex items-center justify-center gap-2">
              {quickNoteSaving ? <><span className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-purple-400 rounded-full animate-spin" /> Saving...</> : <><Save className="w-3.5 h-3.5" /> Save</>}
            </button>
            {onSendToSoma && (
              <button onClick={() => { if (quickNoteText.trim()) { onSendToSoma(quickNoteText); handleSaveQuickNote(); } }}
                disabled={quickNoteSaving || !quickNoteText.trim()}
                className="px-4 py-3 bg-fuchsia-600/20 hover:bg-fuchsia-600/30 disabled:opacity-40 text-fuchsia-400 rounded-xl font-semibold text-sm transition-all border border-fuchsia-500/20 hover:border-fuchsia-500/40 active:scale-[0.98] flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" /> SOMA
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── FULL MODE ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full w-full bg-[#0a0a0c] text-zinc-300 font-sans overflow-hidden rounded-xl border border-white/5 relative">

      {/* ── Muse Room overlay ── */}
      {museRoomMode && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 50 }}>
          <SomaMuseMode
            onExit={() => setMuseRoomMode(false)}
            onCrystallize={async ({ filename }) => {
              setMuseRoomMode(false);
              await refreshNotes();
              if (filename) setSelectedNote({ name: filename });
            }}
          />
        </div>
      )}

      {/* ── Sidebar ── */}
      <div className="w-72 border-r border-white/5 bg-[#0d0d0f] flex flex-col flex-shrink-0">
        <div className="p-4 border-b border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-400" /> Reflections
            </h2>
            <div className="flex gap-1">
              <button onClick={handleDailyNote} title="Today's note"
                className="p-1.5 hover:bg-white/8 rounded-lg text-zinc-500 hover:text-amber-400 transition-all">
                <Calendar className="w-3.5 h-3.5" />
              </button>
              <button onClick={handleOpenHygiene} title="Vault hygiene"
                className={`p-1.5 hover:bg-white/8 rounded-lg transition-all ${hygieneView ? 'text-orange-400 bg-orange-500/10' : 'text-zinc-500 hover:text-orange-400'}`}>
                <Shield className="w-3.5 h-3.5" />
              </button>
              <button onClick={openCanvas} title="Cognitive canvas"
                className={`p-1.5 hover:bg-white/8 rounded-lg transition-all ${workspaceMode === 'canvas' ? 'text-cyan-300 bg-cyan-500/10' : 'text-zinc-500 hover:text-cyan-300'}`}>
                <Network className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Action row */}
          <div className="reflections-action-row">
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className={`reflections-glow-action reflections-glow-action-upload ${
                uploadStatus === 'uploading' ? 'reflections-glow-action-cyan' :
                uploadStatus === 'absorbed' ? 'reflections-glow-action-fuchsia' :
                uploadStatus === 'done' ? 'reflections-glow-action-green' :
                uploadStatus === 'error' ? 'reflections-glow-action-red' : ''
              }`} title="Upload Document or Book to Thinking Substrate">
              <span className="reflections-glow-action-gradient-container"><span className="reflections-glow-action-gradient" /></span>
              <span className="reflections-glow-action-label">
                <Upload className="h-4 w-4" />
                <span>{uploadStatus === 'uploading' ? 'Ingesting...' : uploadStatus === 'absorbed' ? 'Absorbed' : uploadStatus === 'done' ? 'Done' : uploadStatus === 'error' ? 'Error' : 'Upload'}</span>
              </span>
            </button>

            <button type="button" onClick={goHome} className="reflections-glow-action reflections-glow-action-home" title="Home">
              <span className="reflections-glow-action-gradient-container"><span className="reflections-glow-action-gradient" /></span>
              <span className="reflections-glow-action-label"><Home className="h-4 w-4" /><span>Home</span></span>
            </button>

            <button type="button" onClick={() => setMuseRoomMode(true)} className="reflections-glow-action reflections-glow-action-muse" title="Muse Room">
              <span className="reflections-glow-action-gradient-container"><span className="reflections-glow-action-gradient" /></span>
              <span className="reflections-glow-action-label"><Lightbulb className="h-4 w-4" /><span>Muse</span></span>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => openCreateModal('note')}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-2 py-2 text-[11px] font-semibold text-zinc-300 transition-all hover:border-purple-500/20 hover:bg-purple-500/10 hover:text-purple-100">
              <FileText className="h-3.5 w-3.5" />
              Note+
            </button>
            <button type="button" onClick={() => openCreateModal('workbook')}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.035] px-2 py-2 text-[11px] font-semibold text-zinc-300 transition-all hover:border-purple-500/20 hover:bg-purple-500/10 hover:text-purple-100">
              <Layers className="h-3.5 w-3.5" />
              Workbook+
            </button>
          </div>

          <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.json,.csv,.js,.ts,.py" onChange={handleFileUpload} className="hidden" />
          {uploadSubstrateMsg && (
            <p className="rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-2 text-[11px] font-medium leading-relaxed text-fuchsia-300 animate-pulse">{uploadSubstrateMsg}</p>
          )}
          {uploadError && uploadStatus === 'error' && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] leading-relaxed text-red-300">{uploadError}</p>
          )}

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500" />
            <input type="text" placeholder="Search notes..." value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full bg-white/5 border border-white/5 rounded-xl py-2 pl-9 pr-4 text-xs focus:ring-1 focus:ring-purple-500/50 outline-none transition-all" />
          </div>

          {/* Status filter chips */}
          <div className="flex flex-wrap gap-1">
            <button onClick={() => setStatusFilter('all')}
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${statusFilter === 'all' ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}>
              All
            </button>
            {STATUSES.map(s => (
              <button key={s.value} onClick={() => setStatusFilter(s.value)}
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all ${statusFilter === s.value ? `${s.bg} ${s.color} border ${s.border}` : 'text-zinc-600 hover:text-zinc-400'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Note list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {searchResults !== null ? (
            <>
              <p className="text-[10px] text-zinc-600 font-mono px-2 pb-2">{searchResults.length} content match{searchResults.length !== 1 ? 'es' : ''}</p>
              {searchResults.map(result => (
                <div key={result.name} onClick={() => { setSelectedNote({ name: result.name }); setSearchResults(null); setSearchQuery(''); }}
                  className={`p-2.5 rounded-xl border cursor-pointer transition-all ${selectedNote?.name === result.name ? 'bg-purple-500/10 border-purple-500/30 text-white' : 'border-transparent hover:bg-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                  <div className="flex items-start gap-2">
                    <Eye className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate">{result.name.replace('.md', '')}</p>
                      {result.snippet && <p className="text-[10px] text-zinc-600 mt-0.5 line-clamp-2 leading-relaxed">{result.snippet}</p>}
                    </div>
                  </div>
                </div>
              ))}
              {searchResults.length === 0 && <p className="text-xs text-zinc-600 text-center py-4 font-mono">No matches found</p>}
            </>
          ) : (
            <>
              {workbooks.length > 0 && statusFilter === 'all' && !searchQuery && (
                <div className="mb-3 space-y-2">
                  {workbooks.map(workbook => {
                    const workbookTitle = workbook.title || workbook.name.replace(/\.md$/i, '');
                    const childSegments = notes.filter(n => n.type === 'segment' && n.workbook === workbookTitle);
                    const containsActiveSection = activeSection?.workbook === workbookTitle;
                    const isCollapsed = collapsedWorkbooks[workbookTitle] && !containsActiveSection;
                    return (
                      <div key={workbook.name} className="rounded-xl border border-white/10 bg-white/[0.025] p-2">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => toggleWorkbookCollapse(workbookTitle)}
                            className="rounded-md p-1 text-zinc-600 transition-all hover:bg-white/5 hover:text-zinc-300"
                            title={isCollapsed ? 'Expand workbook' : 'Collapse workbook'}
                          >
                            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isCollapsed ? '-rotate-90' : 'rotate-0'}`} />
                          </button>
                          <button onClick={() => selectWorkbook(workbook)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-zinc-200 hover:bg-white/5">
                            <Layers className="h-3.5 w-3.5 text-purple-300" />
                            <span className="min-w-0 flex-1 truncate">{workbookTitle}</span>
                          </button>
                          <button type="button" onClick={() => openCreateModal('segment', { workbook: workbookTitle })}
                            className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold text-zinc-500 transition-all hover:border-emerald-400/25 hover:bg-emerald-400/10 hover:text-emerald-200"
                            title="Add segment">
                            Segment+
                          </button>
                        </div>
                        {!isCollapsed && <div className="mt-1 space-y-1 pl-4">
                          {childSegments.map(segment => {
                            const segmentTitle = segment.title || segment.name.replace(/\.md$/i, '');
                            const childSections = notes.filter(n => n.type === 'section' && n.workbook === workbookTitle && n.segment === segmentTitle);
                            const unsortedFolios = notes.filter(n => n.type === 'folio' && n.workbook === workbookTitle && n.segment === segmentTitle && !n.section);
                            return (
                              <div key={segment.name}>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => selectSegment(segment, workbookTitle)}
                                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-zinc-300 hover:bg-white/5">
                                    <GitBranch className="h-3 w-3 text-cyan-300/70" />
                                    <span className="min-w-0 flex-1 truncate">{segmentTitle}</span>
                                  </button>
                                  <button type="button" onClick={() => openCreateModal('section', { workbook: workbookTitle, segment: segmentTitle })}
                                    className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold text-zinc-500 transition-all hover:border-emerald-400/25 hover:bg-emerald-400/10 hover:text-emerald-200"
                                    title="Add section">
                                    Section+
                                  </button>
                                </div>
                                <div className="space-y-0.5 pl-4">
                                  {childSections.map(section => {
                                    const sectionTitle = section.title || section.name.replace(/\.md$/i, '');
                                    const folios = notes.filter(n => n.type === 'folio' && n.workbook === workbookTitle && n.segment === segmentTitle && n.section === sectionTitle);
                                    return (
                                      <div key={section.name}>
                                        <div className="flex items-center gap-1">
                                          <button onClick={() => selectSection(section, workbookTitle, segmentTitle)}
                                            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] font-medium text-emerald-200/80 hover:bg-white/5">
                                            <Layers className="h-3 w-3 text-emerald-300/70" />
                                            <span className="min-w-0 flex-1 truncate">{sectionTitle}</span>
                                          </button>
                                        </div>
                                        <div className="space-y-0.5 pl-4">
                                          {folios.map(folio => (
                                            <button key={folio.name} onClick={() => setSelectedNote(folio)}
                                              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                                              <FileText className="h-3 w-3 text-zinc-500" />
                                              <span className="min-w-0 flex-1 truncate">{folio.title || folio.name.replace(/\.md$/i, '')}</span>
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    );
                                  })}
                                  {unsortedFolios.length > 0 && (
                                    <div>
                                      <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Unsorted</div>
                                      <div className="space-y-0.5 pl-4">
                                        {unsortedFolios.map(folio => (
                                          <button key={folio.name} onClick={() => setSelectedNote(folio)}
                                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-white/5 hover:text-zinc-200">
                                            <FileText className="h-3 w-3 text-zinc-500" />
                                            <span className="min-w-0 flex-1 truncate">{folio.title || folio.name.replace(/\.md$/i, '')}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {childSegments.length === 0 && (
                            <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-center">
                              <p className="text-[11px] text-zinc-600">No segments yet.</p>
                              <button
                                type="button"
                                onClick={() => openCreateModal('segment', { workbook: workbookTitle })}
                                className="mt-2 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-[10px] font-bold text-cyan-200 hover:bg-cyan-400/20"
                              >
                                Add Segment
                              </button>
                            </div>
                          )}
                        </div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {visibleNotes.filter(note => statusFilter !== 'all' || searchQuery || !['workbook', 'segment', 'section', 'folio'].includes(note.type)).map(note => {
                const sm = statusMeta[note.status] || statusMeta.inbox;
                return (
                  <div key={note.name} onClick={() => setSelectedNote(note)}
                    className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between group ${selectedNote?.name === note.name ? 'bg-purple-500/10 border-purple-500/30 text-white' : 'border-transparent hover:bg-white/5 text-zinc-500 hover:text-zinc-300'}`}>
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${sm.color.replace('text-', 'bg-')}`} />
                      <span className="text-xs font-medium truncate">{note.name.replace('.md', '')}</span>
                    </div>
                    <button onClick={(e) => handleDeleteNote(e, note.name)}
                      className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 text-zinc-500 hover:text-red-400 rounded-lg transition-all flex-shrink-0">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {notes.length === 0 && (
                <p className="text-xs text-zinc-600 text-center pt-8 font-mono">No reflections yet.<br />Press + to add one.</p>
              )}
              {notes.length > 0 && visibleNotes.length === 0 && (
                <p className="text-xs text-zinc-600 text-center pt-6 font-mono">No {statusFilter} notes.</p>
              )}
            </>
          )}
        </div>
      </div>

      {activeSection && (
        <div className="w-64 flex-shrink-0 border-r border-white/5 bg-[#101014] flex flex-col">
          <div className="border-b border-white/5 p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">
              {activeSection.mode === 'workbook' ? 'Segments' : activeSection.mode === 'segment' ? 'Sections' : 'Folios'}
            </p>
            <h3 className="mt-1 truncate text-sm font-bold text-white">{activeSection.title}</h3>
            <p className="mt-1 truncate text-[10px] text-zinc-600">
              {activeSection.mode === 'workbook'
                ? 'Workbook structure'
                : activeSection.mode === 'segment'
                  ? activeSection.workbook
                  : `${activeSection.workbook} / ${activeSection.segment}`}
            </p>
            <button
              type="button"
              onClick={() => {
                if (activeSection.mode === 'workbook') openCreateModal('segment', { workbook: activeSection.workbook });
                else if (activeSection.mode === 'segment') openCreateModal('section', { workbook: activeSection.workbook, segment: activeSection.segment });
                else openCreateModal('folio', activeSection);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-purple-400/25 bg-purple-400/10 px-3 py-2 text-xs font-bold text-purple-100 transition-all hover:bg-purple-400/20"
            >
              <Plus className="h-3.5 w-3.5" />
              {activeSection.mode === 'workbook' ? 'Add Segment' : activeSection.mode === 'segment' ? 'Add Section' : 'Add Folio'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {activeSection.mode === 'workbook' && (
              <>
                {activeWorkbookSegments.map(segment => {
                  const segmentTitle = noteDisplayTitle(segment);
                  const sectionCount = notes.filter(n => n.type === 'section' && n.workbook === activeSection.workbook && n.segment === segmentTitle).length;
                  const folioCount = notes.filter(n => n.type === 'folio' && n.workbook === activeSection.workbook && n.segment === segmentTitle).length;
                  return (
                    <button
                      key={segment.name}
                      onClick={() => selectSegment(segment, activeSection.workbook)}
                      className={`mb-1.5 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                        selectedNote?.name === segment.name
                          ? 'border-cyan-500/30 bg-cyan-500/10 text-white'
                          : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <GitBranch className="h-3.5 w-3.5 flex-shrink-0 text-cyan-300/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{segmentTitle}</span>
                        <span className="block text-[10px] text-zinc-600">{sectionCount} section{sectionCount !== 1 ? 's' : ''} · {folioCount} folio{folioCount !== 1 ? 's' : ''}</span>
                      </span>
                    </button>
                  );
                })}
                {activeWorkbookSegments.length === 0 && (
                  <p className="px-2 py-8 text-center text-xs text-zinc-600">No segments in this workbook yet.</p>
                )}
              </>
            )}

            {activeSection.mode === 'segment' && (
              <>
                {activeSegmentSections.map(section => {
                  const sectionTitle = noteDisplayTitle(section);
                  const folioCount = notes.filter(n => n.type === 'folio' && n.workbook === activeSection.workbook && n.segment === activeSection.segment && n.section === sectionTitle).length;
                  return (
                    <button
                      key={section.name}
                      onClick={() => selectSection(section, activeSection.workbook, activeSection.segment)}
                      className={`mb-1.5 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                        selectedNote?.name === section.name
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-white'
                          : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                      }`}
                    >
                      <Layers className="h-3.5 w-3.5 flex-shrink-0 text-emerald-300/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{sectionTitle}</span>
                        <span className="block text-[10px] text-zinc-600">{folioCount} folio{folioCount !== 1 ? 's' : ''}</span>
                      </span>
                    </button>
                  );
                })}
                {activeSegmentLooseFolios.length > 0 && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Loose Folios</p>
                    {activeSegmentLooseFolios.map(folio => (
                      <button key={folio.name} onClick={() => setSelectedNote(folio)}
                        className="mb-1.5 flex w-full items-center gap-2 rounded-lg border border-transparent px-3 py-2 text-left text-xs text-zinc-400 transition-all hover:bg-white/5 hover:text-zinc-200">
                        <FileText className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                        <span className="min-w-0 flex-1 truncate">{noteDisplayTitle(folio)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {activeSegmentSections.length === 0 && activeSegmentLooseFolios.length === 0 && (
                  <p className="px-2 py-8 text-center text-xs text-zinc-600">No sections in this segment yet.</p>
                )}
              </>
            )}

            {activeSection.mode === 'section' && (
              <>
                {activeSectionFolios.map(folio => (
                  <button
                    key={folio.name}
                    onClick={() => setSelectedNote(folio)}
                    className={`mb-1.5 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all ${
                      selectedNote?.name === folio.name
                        ? 'border-purple-500/30 bg-purple-500/10 text-white'
                        : 'border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-zinc-500" />
                    <span className="min-w-0 flex-1 truncate">{noteDisplayTitle(folio)}</span>
                  </button>
                ))}
                {activeSectionFolios.length === 0 && (
                  <p className="px-2 py-8 text-center text-xs text-zinc-600">No folios in this section yet.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col relative overflow-hidden min-w-0">
        <AnimatePresence mode="wait">

          {/* MUSE FLOW */}
          {isBrainstorming && (
            <motion.div key="brainstorm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col bg-[#050506] overflow-hidden">
              <div className="p-5 border-b border-white/5 flex items-center justify-between bg-orange-500/5">
                <div className="flex items-center gap-4">
                  <div className="p-2.5 rounded-xl bg-orange-500/20 text-orange-400"><Zap className="w-4 h-4 animate-pulse" /></div>
                  <div>
                    <h2 className="text-base font-black text-white tracking-tighter uppercase italic">MUSE FLOW</h2>
                    <p className="text-[10px] text-orange-400/60 font-bold tracking-[0.2em]">Creative Synthesis — Muse Persona Active</p>
                  </div>
                </div>
                <button onClick={finalizeBrainstorm}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-400 text-black font-black text-xs rounded-xl transition-all shadow-lg shadow-orange-500/20">
                  CRYSTALLIZE
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {museResidue && (
                  <div className="rounded-2xl border border-orange-500/20 bg-orange-500/[0.06] p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-orange-400/70">Session Residue</p>
                        <h3 className="text-sm font-bold text-white">What Muse will preserve when crystallized</h3>
                      </div>
                      <button onClick={finalizeBrainstorm}
                        className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-orange-300 hover:bg-orange-500/20">
                        Save Artifact
                      </button>
                    </div>
                    <div className="grid gap-3 lg:grid-cols-2">
                      {[['Spark', museResidue.spark], ['Variant', museResidue.variant], ['Critique', museResidue.critique], ['Crystallize', museResidue.crystallize]]
                        .filter(([, value]) => value).map(([label, value]) => (
                          <div key={label} className="rounded-xl border border-white/5 bg-black/25 p-3">
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-orange-300">{label}</p>
                            <p className="line-clamp-4 text-xs leading-relaxed text-zinc-300">{value}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
                {sessionLog.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-2xl p-4 rounded-2xl border ${m.role === 'user' ? 'bg-white/5 border-white/10 text-zinc-200' : 'bg-orange-500/10 border-orange-500/20 text-orange-100'}`}>
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.text}</p>
                    </div>
                  </div>
                ))}
                <div ref={museEndRef} />
              </div>
              <div className="p-5 bg-black/40 border-t border-white/5">
                <div className="flex gap-3">
                  <input value={inputMessage} onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    type="text" placeholder="Feed the muse..."
                    className="flex-1 bg-white/5 border border-white/10 rounded-2xl py-3 px-5 text-sm text-white outline-none focus:border-orange-500/50 transition-all" />
                  <button onClick={handleSendMessage}
                    className="p-3 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-2xl border border-orange-500/20 transition-all">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* HYGIENE VIEW */}
          {hygieneView && !isBrainstorming && (
            <motion.div key="hygiene" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono tracking-widest uppercase text-orange-400">Vault Hygiene</p>
                  <p className="text-xs text-zinc-600 mt-0.5">Orphans, broken links, stale notes</p>
                </div>
                <button onClick={loadHygiene} disabled={hygieneLoading}
                  className="flex items-center gap-2 px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 disabled:opacity-40 text-orange-400 rounded-lg border border-orange-500/20 text-xs font-bold transition-all">
                  <RefreshCw className={`w-3 h-3 ${hygieneLoading ? 'animate-spin' : ''}`} />
                  {hygieneLoading ? 'Scanning...' : 'Rescan'}
                </button>
              </div>

              {hygieneLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-6 h-6 border-2 border-orange-500/50 border-t-orange-500 rounded-full animate-spin" />
                  <p className="text-xs text-zinc-500 font-mono">Analyzing vault structure...</p>
                </div>
              )}

              {hygieneData && !hygieneLoading && (
                <>
                  {/* Orphan notes */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-1.5 bg-zinc-500 rounded-full" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">
                        Orphan Notes <span className="text-zinc-600">({hygieneData.orphans.length})</span>
                      </h3>
                    </div>
                    {hygieneData.orphans.length === 0
                      ? <p className="text-xs text-zinc-600 font-mono pl-3">None — every note is connected.</p>
                      : hygieneData.orphans.map(n => (
                        <div key={n.name} onClick={() => { setSelectedNote({ name: n.name }); setHygieneView(false); }}
                          className="flex items-center justify-between p-3 mb-1 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 cursor-pointer transition-all">
                          <div>
                            <p className="text-xs font-semibold text-zinc-300">{n.title}</p>
                            <p className="text-[10px] text-zinc-600">{n.wordCount} words · no links in or out</p>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />
                        </div>
                      ))
                    }
                  </div>

                  {/* Broken links */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-1.5 bg-red-400 rounded-full" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-red-400">
                        Broken Links <span className="text-red-600">({hygieneData.brokenLinks.length})</span>
                      </h3>
                    </div>
                    {hygieneData.brokenLinks.length === 0
                      ? <p className="text-xs text-zinc-600 font-mono pl-3">None — all links resolve.</p>
                      : hygieneData.brokenLinks.map((b, i) => (
                        <div key={i} onClick={() => { setSelectedNote({ name: b.note }); setHygieneView(false); }}
                          className="flex items-center justify-between p-3 mb-1 rounded-xl bg-red-500/[0.04] border border-red-500/15 hover:border-red-500/25 cursor-pointer transition-all">
                          <div>
                            <p className="text-xs font-semibold text-zinc-300">{b.note.replace('.md', '')}</p>
                            <p className="text-[10px] text-red-400/70">[[{b.link}]] → not found</p>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-red-600 flex-shrink-0" />
                        </div>
                      ))
                    }
                  </div>

                  {/* Stale raw notes */}
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                      <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400">
                        Stale Raw Notes <span className="text-amber-600">({hygieneData.staleRaw.length})</span>
                      </h3>
                      <span className="text-[10px] text-zinc-600">(raw/inbox, older than 7 days)</span>
                    </div>
                    {hygieneData.staleRaw.length === 0
                      ? <p className="text-xs text-zinc-600 font-mono pl-3">None — inbox is clear.</p>
                      : hygieneData.staleRaw.map(n => (
                        <div key={n.name} onClick={() => { setSelectedNote({ name: n.name }); setHygieneView(false); }}
                          className="flex items-center justify-between p-3 mb-1 rounded-xl bg-amber-500/[0.04] border border-amber-500/15 hover:border-amber-500/25 cursor-pointer transition-all group">
                          <div>
                            <p className="text-xs font-semibold text-zinc-300">{n.title}</p>
                            <p className="text-[10px] text-amber-400/70">
                              {n.status} · created {n.created ? new Date(n.created).toLocaleDateString() : 'unknown'}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={e => { e.stopPropagation(); handleStatusChange('refined'); }}
                              className="px-2 py-1 bg-green-500/10 text-green-400 rounded-md text-[10px] font-bold border border-green-500/20 hover:bg-green-500/20">
                              Refined
                            </button>
                            <button onClick={e => { e.stopPropagation(); handleStatusChange('archived'); }}
                              className="px-2 py-1 bg-zinc-500/10 text-zinc-400 rounded-md text-[10px] font-bold border border-zinc-500/20 hover:bg-zinc-500/20">
                              Archive
                            </button>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </>
              )}
            </motion.div>
          )}

          {/* HOME + NOTE VIEW */}
          {!isBrainstorming && !hygieneView && (
            <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex-1 flex flex-col overflow-hidden">

              <div className="flex-1 overflow-y-auto">
                {selectedNote ? (
                  // ── NOTE VIEW ──
                  <div className="p-6">
                    {/* Header row */}
                    <div className="flex items-start justify-between mb-1 gap-4">
                      <h1 className="text-xl font-bold text-white tracking-tight leading-tight">{selectedNote.name.replace('.md', '')}</h1>
                      <div className="flex gap-2 flex-shrink-0 mt-0.5 items-center">
                        {/* Status editor */}
                        <div className="relative">
                          <button onClick={() => setStatusDropdownOpen(v => !v)} disabled={updatingStatus}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-widest transition-all hover:opacity-80 disabled:opacity-40"
                            style={{ background: 'transparent' }}>
                            {updatingStatus
                              ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                              : <><Tag className="w-3 h-3" />{statusMeta[currentStatus]?.label || 'inbox'}<ChevronDown className="w-3 h-3" /></>
                            }
                          </button>
                          <AnimatePresence>
                            {statusDropdownOpen && (
                              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                                className="absolute right-0 top-full mt-1 w-36 bg-[#151518] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
                                {STATUSES.map(s => (
                                  <button key={s.value} onClick={() => handleStatusChange(s.value)}
                                    className={`w-full text-left px-3 py-2 text-[11px] font-bold flex items-center gap-2 hover:bg-white/5 transition-all ${currentStatus === s.value ? s.color : 'text-zinc-400'}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full ${s.color.replace('text-', 'bg-')}`} />
                                    {s.label}
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>

                        {/* Edit controls */}
                        {isEditing ? (
                          <>
                            <button onClick={cancelEdit}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 text-zinc-400 rounded-lg text-xs font-bold transition-all">
                              <X className="w-3.5 h-3.5" /> Cancel
                            </button>
                            <button onClick={handleSaveEdit} disabled={saving}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all">
                              <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={copyWikiLink} disabled={noteLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-cyan-500/15 text-zinc-400 hover:text-cyan-300 rounded-lg text-xs font-bold transition-all border border-transparent hover:border-cyan-500/20">
                              <Link className="w-3.5 h-3.5" /> Copy Link
                            </button>
                            <button onClick={startEdit} disabled={noteLoading}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-purple-500/15 text-zinc-400 hover:text-purple-300 rounded-lg text-xs font-bold transition-all border border-transparent hover:border-purple-500/20">
                              <Pencil className="w-3.5 h-3.5" /> Edit
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-zinc-600 text-[10px] font-mono mb-4">{selectedNote.name}</p>

                    {/* SOMA action buttons */}
                    {!isEditing && !noteLoading && (
                      <div className="mb-5 space-y-2">
                        {selectedTextForAnnotation && (
                          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3 py-2">
                            <div className="min-w-0">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Selection captured</p>
                              <p className="truncate text-xs text-zinc-300">{selectedTextForAnnotation}</p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button onClick={() => setAnnotationModalOpen(true)}
                                className="flex items-center gap-1.5 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-amber-200 hover:bg-amber-400/20">
                                <Highlighter className="h-3.5 w-3.5" /> Add Note
                              </button>
                              <button onClick={() => setSelectedTextForAnnotation('')} className="rounded-lg p-1.5 text-zinc-600 hover:bg-white/5 hover:text-zinc-300">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                        {SOMA_ACTIONS.map(a => (
                          <button key={a.id} onClick={() => handleSomaAction(a.id)}
                            disabled={actionLoading}
                            title={a.desc}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold uppercase tracking-wide transition-all disabled:opacity-40 hover:bg-white/5 ${
                              actionResult?.action === a.id ? `${a.color} bg-white/5 border-white/15` : 'text-zinc-600 border-white/5 hover:text-zinc-400'
                            }`}>
                            {actionLoading && actionResult?.action === a.id
                              ? <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                              : <a.Icon className={`w-3 h-3 ${actionResult?.action === a.id ? a.color : ''}`} />
                            }
                            {a.label}
                          </button>
                        ))}
                        </div>
                      </div>
                    )}

                    {/* Action result panel */}
                    <AnimatePresence>
                      {actionResult && !actionResult.loading && actionResult.result && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                          className="mb-5 rounded-xl border border-purple-500/20 bg-purple-500/5 overflow-hidden">
                          <div className="px-4 py-2.5 border-b border-purple-500/10 flex items-center justify-between">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">
                              {SOMA_ACTIONS.find(a => a.id === actionResult.action)?.label}
                            </p>
                            <button onClick={() => setActionResult(null)} className="text-zinc-600 hover:text-zinc-400">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="px-4 py-3">
                            {actionResult.brainLanes?.length > 0 && (
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {actionResult.brainLanes.map(lane => (
                                  <span key={lane} className="rounded-full border border-purple-500/20 bg-purple-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-purple-300">
                                    {lane}
                                  </span>
                                ))}
                              </div>
                            )}
                            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">{actionResult.result}</p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {noteLoading ? (
                      <div className="flex items-center gap-3 text-zinc-600 text-sm">
                        <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                        Loading...
                      </div>
                    ) : isEditing ? (
                      <textarea value={editContent} onChange={(e) => setEditContent(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); handleSaveEdit(); } }}
                        className="w-full h-[55vh] bg-white/3 border border-white/10 rounded-xl p-5 text-sm text-zinc-200 font-mono leading-relaxed outline-none focus:border-purple-500/40 resize-none transition-all"
                        spellCheck={false} />
                    ) : (
                      <>
                        {/* Structured import view for raw uploads */}
                        {(() => {
                          const fm = noteContent.match(/^---\s*\n([\s\S]*?)\n---/);
                          const meta = {};
                          if (fm) for (const line of fm[1].split('\n')) {
                            const idx = line.indexOf(':');
                            if (idx !== -1) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                          }
                          if (meta.source === 'upload' && meta.extractionStatus) {
                            return (
                              <div className="mb-5 rounded-xl border border-amber-500/15 bg-amber-500/[0.04] p-4">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-2">Ingestion Receipt</p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                                  {['source', 'mimeType', 'extractor', 'extractedChars', 'status', 'ingested'].map(k => meta[k] && (
                                    <div key={k} className="flex justify-between gap-2">
                                      <span className="text-zinc-600">{k}</span>
                                      <span className="text-zinc-400 truncate">{meta[k]}</span>
                                    </div>
                                  ))}
                                </div>
                                {(meta.status === 'raw' || !meta.status) && (
                                  <button onClick={() => handleSomaAction('summarize')} disabled={actionLoading}
                                    className="mt-3 flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 rounded-lg border border-amber-500/20 text-[10px] font-bold uppercase tracking-wide transition-all disabled:opacity-40">
                                    <Brain className="w-3 h-3" /> Process this document
                                  </button>
                                )}
                              </div>
                            );
                          }
                          return null;
                        })()}

                        <div ref={noteBodyRef} onMouseUp={captureTextSelection} onKeyUp={captureTextSelection}>
                          <MarkdownView content={noteContent} onWikiLink={openWikiLink} onHighlightClick={openHighlightAnnotation} />
                        </div>

                        {/* Graph / Links / Related panel */}
                        <div className="mt-6 grid gap-4 xl:grid-cols-3">
                          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-purple-400">Reflection Links</p>
                            {noteIntelLoading ? <p className="text-xs text-zinc-600">Reading note graph...</p> : (
                              <div className="space-y-3">
                                <div>
                                  <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-600">Outgoing</p>
                                  {(noteIntel?.links?.outgoing || []).length
                                    ? noteIntel.links.outgoing.map(link => (
                                      <button key={`${link.label}-${link.name}`} onClick={() => link.name && setSelectedNote({ name: link.name })}
                                        className={`mb-1 mr-1 rounded-md border px-2 py-1 text-[11px] ${link.resolved ? 'border-purple-500/20 bg-purple-500/10 text-purple-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                                        {link.title}
                                      </button>
                                    ))
                                    : <p className="text-xs text-zinc-600">No outgoing links.</p>}
                                </div>
                                <div>
                                  <p className="mb-1 text-[10px] uppercase tracking-widest text-zinc-600">Backlinks</p>
                                  {(noteIntel?.links?.backlinks || []).length
                                    ? noteIntel.links.backlinks.map(link => (
                                      <button key={link.name} onClick={() => setSelectedNote({ name: link.name })}
                                        className="mb-1 mr-1 rounded-md border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-300">
                                        {link.title}
                                      </button>
                                    ))
                                    : <p className="text-xs text-zinc-600">No backlinks yet.</p>}
                                </div>
                              </div>
                            )}
                          </div>

                          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-cyan-400">Related</p>
                            {(noteIntel?.related || []).length
                              ? noteIntel.related.map(item => (
                                <button key={item.name} onClick={() => setSelectedNote({ name: item.name })}
                                  className="mb-2 block w-full rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-left hover:bg-white/[0.06]">
                                  <span className="block truncate text-xs font-semibold text-zinc-300">{item.name.replace('.md', '')}</span>
                                  {item.snippet && <span className="mt-1 line-clamp-2 block text-[10px] leading-relaxed text-zinc-600">{item.snippet}</span>}
                                </button>
                              ))
                              : <p className="text-xs text-zinc-600">No related notes found yet.</p>}
                          </div>

                          <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-amber-400">Unlinked Mentions</p>
                            {(noteIntel?.links?.mentions || []).length
                              ? noteIntel.links.mentions.map(item => (
                                <button key={item.name} onClick={() => setSelectedNote({ name: item.name })}
                                  className="mb-1 mr-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
                                  {item.title}
                                </button>
                              ))
                              : <p className="text-xs text-zinc-600">No obvious missed links.</p>}
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                ) : workspaceMode === 'canvas' ? (
                  // ── COGNITIVE CANVAS ──
                  <div className="h-full min-h-[680px] overflow-hidden p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-xs font-mono tracking-widest uppercase text-cyan-400">Cognitive Canvas</p>
                        <p className="mt-0.5 text-xs text-zinc-600">Spatial memory surface for notes, backlinks, and emerging clusters</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={loadCanvasGraph} disabled={canvasLoading}
                          className="flex items-center gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-500/20 disabled:opacity-40">
                          <RefreshCw className={`h-3.5 w-3.5 ${canvasLoading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                        <button onClick={startBrainstorm}
                          className="flex items-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-xs font-bold text-orange-300 transition-all hover:bg-orange-500/20">
                          <Lightbulb className="h-3.5 w-3.5" />
                          Muse
                        </button>
                      </div>
                    </div>

                    <div
                      ref={canvasSurfaceRef}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerLeave={handleCanvasPointerUp}
                      className="relative h-[calc(100%-4rem)] min-h-[590px] overflow-hidden rounded-3xl border border-white/10 bg-[radial-gradient(circle_at_50%_40%,rgba(34,211,238,0.12),transparent_35%),linear-gradient(135deg,rgba(24,24,27,0.84),rgba(3,7,18,0.92))] shadow-2xl shadow-black/30"
                    >
                      <div className="absolute inset-0 opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)', backgroundSize: '42px 42px' }} />

                      {(() => {
                        const graphNodes = canvasGraph?.nodes?.length ? canvasGraph.nodes : notes.map(n => ({ id: n.name.replace(/\.md$/i, '') }));
                        const noteById = new Map(notes.map(n => [n.name.replace(/\.md$/i, ''), n]));
                        const positioned = graphNodes.map((node, index) => {
                          const fallback = canvasPosition(node.id, index, graphNodes.length);
                          const saved = canvasLayout.positions?.[node.id];
                          return {
                            ...node,
                            note: noteById.get(node.id),
                            x: saved?.x ?? fallback.x,
                            y: saved?.y ?? fallback.y,
                          };
                        });
                        const byId = new Map(positioned.map(node => [node.id, node]));
                        const edges = (canvasGraph?.edges || []).filter(edge => byId.has(edge.source) && byId.has(edge.target));
                        const clusters = [
                          { label: 'Stories', test: n => /story|chapter|aurora|fiction/i.test(n.id), color: 'border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-200' },
                          { label: 'Raw Inputs', test: n => n.note?.status === 'raw', color: 'border-amber-400/25 bg-amber-400/10 text-amber-200' },
                          { label: 'Linked Memory', test: n => edges.some(e => e.source === n.id || e.target === n.id), color: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200' },
                        ].map(cluster => ({ ...cluster, count: positioned.filter(cluster.test).length })).filter(cluster => cluster.count);

                        return (
                          <>
                            <svg className="pointer-events-none absolute inset-0 h-full w-full">
                              <defs>
                                <linearGradient id="reflection-edge" x1="0%" y1="0%" x2="100%" y2="0%">
                                  <stop offset="0%" stopColor="rgba(34,211,238,0.08)" />
                                  <stop offset="100%" stopColor="rgba(168,85,247,0.34)" />
                                </linearGradient>
                              </defs>
                              {edges.map((edge, index) => {
                                const source = byId.get(edge.source);
                                const target = byId.get(edge.target);
                                return (
                                  <line
                                    key={`${edge.source}-${edge.target}-${index}`}
                                    x1={`${source.x}%`}
                                    y1={`${source.y}%`}
                                    x2={`${target.x}%`}
                                    y2={`${target.y}%`}
                                    stroke="url(#reflection-edge)"
                                    strokeWidth="1.5"
                                  />
                                );
                              })}
                            </svg>

                            <div className="absolute left-5 top-5 max-w-xs rounded-2xl border border-white/10 bg-black/35 p-4 backdrop-blur-xl">
                              <div className="mb-3 flex items-center gap-2">
                                <Layers className="h-4 w-4 text-cyan-300" />
                                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-300">Living Structure</p>
                              </div>
                              <div className="grid grid-cols-3 gap-2 text-center">
                                <div>
                                  <p className="text-lg font-black text-white">{positioned.length}</p>
                                  <p className="text-[9px] uppercase tracking-widest text-zinc-600">nodes</p>
                                </div>
                                <div>
                                  <p className="text-lg font-black text-cyan-300">{edges.length}</p>
                                  <p className="text-[9px] uppercase tracking-widest text-zinc-600">links</p>
                                </div>
                                <div>
                                  <p className="text-lg font-black text-fuchsia-300">{clusters.length}</p>
                                  <p className="text-[9px] uppercase tracking-widest text-zinc-600">clusters</p>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {clusters.map(cluster => (
                                  <span key={cluster.label} className={`rounded-full border px-2 py-1 text-[10px] ${cluster.color}`}>
                                    {cluster.label} · {cluster.count}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {positioned.map((node) => {
                              const linked = edges.filter(edge => edge.source === node.id || edge.target === node.id).length;
                              const isStory = /story|chapter|aurora|fiction/i.test(node.id);
                              const status = node.note?.status || 'inbox';
                              const sm = statusMeta[status] || statusMeta.inbox;
                              return (
                                <button
                                  key={node.id}
                                  onPointerDown={(event) => {
                                    event.currentTarget.setPointerCapture?.(event.pointerId);
                                    canvasDragRef.current = { id: node.id };
                                    canvasDragMovedRef.current = false;
                                  }}
                                  onClick={() => {
                                    if (!canvasDragMovedRef.current) setSelectedNote(node.note || { name: `${node.id}.md` });
                                  }}
                                  className={`absolute max-w-[220px] -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-2xl border px-4 py-3 text-left shadow-xl backdrop-blur-xl transition-all hover:z-20 hover:scale-[1.04] active:cursor-grabbing ${
                                    isStory
                                      ? 'border-fuchsia-400/25 bg-fuchsia-400/10 shadow-fuchsia-950/30'
                                      : linked
                                        ? 'border-cyan-400/20 bg-cyan-400/10 shadow-cyan-950/20'
                                        : 'border-white/10 bg-black/35 shadow-black/30'
                                  }`}
                                  style={{ left: `${node.x}%`, top: `${node.y}%` }}
                                >
                                  <div className="mb-2 flex items-center justify-between gap-3">
                                    <span className={`h-2 w-2 rounded-full ${sm.color.replace('text-', 'bg-')}`} />
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">{linked} link{linked === 1 ? '' : 's'}</span>
                                  </div>
                                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-zinc-100">{shortTitle(node.id)}</p>
                                  <p className="mt-2 text-[10px] uppercase tracking-widest text-zinc-600">{status}</p>
                                </button>
                              );
                            })}

                            {positioned.length === 0 && (
                              <div className="absolute inset-0 flex items-center justify-center">
                                <p className="text-xs font-mono text-zinc-600">No notes yet. Capture a thought to seed the canvas.</p>
                              </div>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : (
                  // ── HOME / INSIGHTS ──
                  <div className="p-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-mono tracking-widest uppercase text-zinc-500">SOMA Reflection Pool</p>
                        <p className="text-xs text-zinc-600 mt-0.5">{notes.length} note{notes.length !== 1 ? 's' : ''} in vault</p>
                      </div>
                      <button onClick={handleAnalyzeVault} disabled={insightsLoading || notes.length === 0}
                        className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/10 hover:bg-purple-600/20 disabled:opacity-40 text-purple-400 rounded-xl border border-purple-500/20 text-xs font-bold transition-all">
                        <Brain className={`w-3.5 h-3.5 ${insightsLoading ? 'animate-pulse' : ''}`} />
                        {insightsLoading ? 'Scanning...' : 'Scan Vault'}
                      </button>
                    </div>

                    {notes.length > 0 && (
                      <div className="rounded-2xl border border-white/5 bg-black/25 p-4 shadow-2xl shadow-black/20">
                        <div className="mb-4 flex items-center justify-between gap-3">
                          <div>
                            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
                              <Network className="h-3.5 w-3.5" />
                              Reflection Intelligence
                            </p>
                            <p className="mt-1 text-xs text-zinc-600">
                              Trails, recall, annotations, maturity, heat, and transformation candidates from the live vault.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={loadReflectionIntel}
                            disabled={reflectionIntelLoading}
                            className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-bold text-cyan-200 transition-all hover:bg-cyan-400/15 disabled:opacity-40">
                            <RefreshCw className={`h-3.5 w-3.5 ${reflectionIntelLoading ? 'animate-spin' : ''}`} />
                            Refresh
                          </button>
                        </div>

                        {reflectionIntelLoading && !reflectionIntel ? (
                          <div className="flex items-center justify-center gap-3 py-8 text-xs font-mono text-zinc-500">
                            <div className="h-5 w-5 rounded-full border-2 border-cyan-400/20 border-t-cyan-300 animate-spin" />
                            Building the cognitive map...
                          </div>
                        ) : reflectionIntel ? (
                          <>
                            <div className="mb-4 grid grid-cols-4 gap-2">
                              {[
                                { label: 'Links', value: reflectionIntel.stats?.links || 0 },
                                { label: 'Annotations', value: reflectionIntel.stats?.annotations || 0 },
                                { label: 'Raw', value: reflectionIntel.stats?.raw || 0 },
                                { label: 'Promoted', value: reflectionIntel.stats?.promoted || 0 },
                              ].map(stat => (
                                <div key={stat.label} className="rounded-xl border border-white/5 bg-white/[0.025] px-3 py-2 text-center">
                                  <p className="text-base font-black text-white">{stat.value}</p>
                                  <p className="text-[9px] uppercase tracking-widest text-zinc-600">{stat.label}</p>
                                </div>
                              ))}
                            </div>

                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              {intelligenceCards.map(card => {
                                const toneClass = {
                                  cyan: 'text-cyan-300 border-cyan-400/15 bg-cyan-400/[0.04]',
                                  amber: 'text-amber-300 border-amber-400/15 bg-amber-400/[0.04]',
                                  yellow: 'text-yellow-300 border-yellow-400/15 bg-yellow-400/[0.04]',
                                  fuchsia: 'text-fuchsia-300 border-fuchsia-400/15 bg-fuchsia-400/[0.04]',
                                  red: 'text-red-300 border-red-400/15 bg-red-400/[0.04]',
                                  green: 'text-green-300 border-green-400/15 bg-green-400/[0.04]',
                                  purple: 'text-purple-300 border-purple-400/15 bg-purple-400/[0.04]',
                                  blue: 'text-blue-300 border-blue-400/15 bg-blue-400/[0.04]',
                                }[card.tone] || 'text-zinc-300 border-white/10 bg-white/[0.03]';
                                return (
                                  <div key={card.id} className={`min-h-[148px] rounded-xl border p-3 ${toneClass}`}>
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
                                        <card.Icon className="h-3.5 w-3.5" />
                                        {card.title}
                                      </p>
                                      <span className="rounded-full bg-black/25 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">{card.items.length}</span>
                                    </div>
                                    <div className="space-y-1.5">
                                      {card.items.slice(0, 3).map((item, i) => (
                                        <button
                                          key={`${card.id}-${i}`}
                                          type="button"
                                          onClick={() => openIntelNote(item)}
                                          className="w-full rounded-lg border border-white/5 bg-black/20 px-2 py-1.5 text-left text-[11px] leading-snug transition-all hover:border-white/15 hover:bg-white/[0.04]">
                                          {card.render(item)}
                                        </button>
                                      ))}
                                      {card.items.length === 0 && (
                                        <p className="rounded-lg border border-dashed border-white/5 px-2 py-3 text-center text-[11px] text-zinc-600">{card.empty}</p>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>

                            {reflectionIntel.heatmap?.days?.length > 0 && (
                              <div className="mt-4 flex items-end gap-1 rounded-xl border border-white/5 bg-white/[0.015] p-3">
                                {reflectionIntel.heatmap.days.map(day => {
                                  const max = Math.max(1, ...reflectionIntel.heatmap.days.map(d => d.count));
                                  return (
                                    <div key={day.day} className="flex flex-1 flex-col items-center gap-1">
                                      <div
                                        title={`${day.day}: ${day.count} reflection${day.count === 1 ? '' : 's'}`}
                                        className="w-full rounded-sm bg-cyan-300/25"
                                        style={{ height: `${8 + (day.count / max) * 34}px`, opacity: day.count ? 0.95 : 0.22 }}
                                      />
                                      <span className="text-[8px] text-zinc-700">{day.day.slice(5)}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        ) : (
                          <p className="py-6 text-center text-xs text-zinc-600">Reflection intelligence has not been generated yet.</p>
                        )}
                      </div>
                    )}

                    {storyStatus?.currentStory && (
                      <div className="rounded-xl border border-fuchsia-500/15 bg-fuchsia-500/[0.045] p-4">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">Story Workspace</p>
                            <h3 className="mt-1 truncate text-base font-bold text-white">{storyStatus.currentStory.title || 'SOMA Story'}</h3>
                            <p className="mt-1 text-xs text-zinc-500">
                              {storyStatus.currentStory.genre || 'fiction'} · {storyStatus.currentStory.chapters || 0} chapters · {storyStatus.currentStory.fullChapters || 0} full drafts
                            </p>
                            {storyActionStatus && <p className="mt-2 text-xs text-fuchsia-200">{storyActionStatus}</p>}
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto">
                            <button
                              type="button"
                              onClick={() => handleStoryExport('full-chapter')}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-100 transition-all hover:bg-amber-400/20">
                              <Sparkles className="h-3.5 w-3.5" />
                              Full Chapter
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStoryExport('reflections')}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-fuchsia-400/25 bg-fuchsia-400/10 px-3 py-2 text-xs font-bold text-fuchsia-100 transition-all hover:bg-fuchsia-400/20">
                              <FileText className="h-3.5 w-3.5" />
                              Add to Reflections
                            </button>
                            <button
                              type="button"
                              onClick={() => handleStoryExport('wattpad')}
                              className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-bold text-cyan-100 transition-all hover:bg-cyan-400/20">
                              <Send className="h-3.5 w-3.5" />
                              Wattpad Draft
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Graph surface */}
                    {notes.length > 0 && (
                      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400 flex items-center gap-1.5">
                            <GitBranch className="w-3.5 h-3.5" /> Vault Graph
                          </p>
                          <button onClick={loadGraphStats} disabled={graphLoading}
                            className="p-1 hover:bg-white/5 rounded text-zinc-600 hover:text-zinc-400 transition-all">
                            <RefreshCw className={`w-3 h-3 ${graphLoading ? 'animate-spin' : ''}`} />
                          </button>
                        </div>
                        {graphStats ? (
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: 'Notes', value: graphStats.nodes, color: 'text-white' },
                              { label: 'Links', value: graphStats.edges, color: 'text-cyan-400' },
                              { label: 'Isolated', value: graphStats.isolated, color: graphStats.isolated > 0 ? 'text-amber-400' : 'text-zinc-600' },
                            ].map(stat => (
                              <div key={stat.label} className="text-center">
                                <p className={`text-lg font-black ${stat.color}`}>{stat.value}</p>
                                <p className="text-[10px] text-zinc-600 uppercase tracking-widest">{stat.label}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-zinc-600 text-center py-2">Loading graph...</p>
                        )}
                      </div>
                    )}

                    {insightsLoading && (
                      <div className="flex flex-col items-center justify-center py-10 gap-3">
                        <div className="w-7 h-7 border-2 border-purple-500/50 border-t-purple-500 rounded-full animate-spin" />
                        <p className="text-xs text-zinc-500 font-mono">SOMA is reading your vault...</p>
                      </div>
                    )}

                    {insights && !insightsLoading && (
                      <div className="space-y-5">
                        {insights.patterns?.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 bg-purple-400 rounded-full" />
                              <h3 className="text-xs font-bold uppercase tracking-widest text-purple-400">Recurring Patterns</h3>
                            </div>
                            <div className="space-y-2">
                              {insights.patterns.map((p, i) => (
                                <div key={i} className="p-3 rounded-xl bg-purple-500/5 border border-purple-500/15 hover:border-purple-500/25 transition-colors">
                                  <p className="text-sm font-semibold text-white mb-1">{p.title}</p>
                                  <p className="text-xs text-zinc-400 leading-relaxed">{p.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {insights.gaps?.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
                              <h3 className="text-xs font-bold uppercase tracking-widest text-amber-400">Gaps & Blind Spots</h3>
                            </div>
                            <div className="space-y-2">
                              {insights.gaps.map((g, i) => (
                                <div key={i} className="p-3 rounded-xl bg-amber-500/5 border border-amber-500/15 hover:border-amber-500/25 transition-colors">
                                  <p className="text-sm font-semibold text-white mb-1">{g.title}</p>
                                  <p className="text-xs text-zinc-400 leading-relaxed">{g.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {insights.clusters?.length > 0 && (
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 bg-cyan-400 rounded-full" />
                              <h3 className="text-xs font-bold uppercase tracking-widest text-cyan-400">Concept Clusters</h3>
                            </div>
                            <div className="space-y-2">
                              {insights.clusters.map((c, i) => (
                                <div key={i} className="p-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 hover:border-cyan-500/25 transition-colors">
                                  <p className="text-sm font-semibold text-white mb-1">{c.title}</p>
                                  <p className="text-xs text-zinc-400 leading-relaxed">{c.description}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {!insights.patterns?.length && !insights.gaps?.length && !insights.clusters?.length && (
                          <p className="text-xs text-zinc-600 text-center py-6 font-mono">Not enough notes to find patterns yet.</p>
                        )}
                      </div>
                    )}

                    {!insights && !insightsLoading && notes.length > 0 && (
                      <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-600">
                        <motion.div animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 4, repeat: Infinity }}>
                          <Sparkles className="w-8 h-8" />
                        </motion.div>
                        <p className="text-xs font-mono text-center">Press <span className="text-purple-400">Scan Vault</span> to let SOMA<br />find patterns in your thinking</p>
                      </div>
                    )}

                    {notes.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-14 gap-3 text-zinc-600 opacity-30">
                        <Sparkles className="w-8 h-8" />
                        <p className="text-xs font-mono text-center">Your vault is empty.<br />Press + to add your first reflection.</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Archivist — always at bottom */}
              <div className="border-t border-white/5 bg-black/60 backdrop-blur-3xl flex flex-col" style={{ maxHeight: '300px', minHeight: '180px' }}>
                <div className="px-5 pt-3 pb-2 flex items-center gap-2 flex-shrink-0">
                  <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-pulse" />
                  <p className="text-[10px] text-purple-400 font-bold uppercase tracking-[0.25em]">Archivist</p>
                  {selectedNote && <span className="text-[10px] text-zinc-600 font-mono ml-auto">context: {selectedNote.name.replace('.md', '')}</span>}
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-2 space-y-2.5 min-h-0">
                  {archivistLog.length === 0 && (
                    <p className="text-xs text-zinc-600 leading-relaxed">
                      Ask anything about your vault.{' '}
                      {selectedNote ? 'Currently using this note as context.' : 'Select a note for deep context, or ask broadly.'}
                    </p>
                  )}
                  {archivistLog.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-lg px-4 py-2.5 rounded-xl text-sm leading-relaxed ${m.role === 'user' ? 'bg-white/8 text-zinc-200 border border-white/10' : 'bg-purple-500/10 text-purple-100 border border-purple-500/20'}`}>
                        {m.text}
                      </div>
                    </div>
                  ))}
                  {archivistThinking && (
                    <div className="flex justify-start">
                      <div className="px-4 py-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center gap-2">
                        <div className="w-3 h-3 border border-purple-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs text-purple-400">Searching the vault...</span>
                      </div>
                    </div>
                  )}
                  <div ref={archivistEndRef} />
                </div>
                <div className="px-5 pb-4 pt-2 flex-shrink-0">
                  <div className="relative group">
                    <div className="absolute -inset-px bg-gradient-to-r from-purple-600 to-indigo-600 rounded-xl blur opacity-0 group-focus-within:opacity-30 transition duration-500" />
                    <div className="relative bg-[#151518] border border-white/10 rounded-xl flex items-center pr-1.5">
                      <input type="text" value={archivistInput}
                        onChange={(e) => setArchivistInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleArchivistMessage()}
                        placeholder="Ask the Archivist..."
                        className="w-full bg-transparent py-3 px-4 text-sm text-white outline-none placeholder:text-zinc-600" />
                      <button onClick={handleArchivistMessage} disabled={archivistThinking || !archivistInput.trim()}
                        className="p-2.5 bg-purple-600/10 hover:bg-purple-600/20 disabled:opacity-40 text-purple-400 rounded-lg transition-all">
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        {/* CRYSTALLIZE modal */}
        <AnimatePresence>
          {crystallizeModalOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-8">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
                className="w-full max-w-md bg-[#0d0d0f] rounded-2xl border border-orange-500/20 p-8 shadow-2xl shadow-orange-500/10">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-xl bg-orange-500/20"><Zap className="w-5 h-5 text-orange-400" /></div>
                  <div>
                    <h3 className="text-base font-black text-white tracking-tight">Name this Concept</h3>
                    <p className="text-xs text-orange-400/60 mt-0.5">Crystallize your brainstorm into a permanent note</p>
                  </div>
                </div>
                <input autoFocus value={crystallizeName} onChange={(e) => setCrystallizeName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doFinalizeBrainstorm()}
                  placeholder="e.g. Distributed Memory Architecture"
                  className="w-full bg-white/5 border border-white/10 rounded-xl py-3 px-4 text-sm text-white outline-none focus:border-orange-500/50 transition-all mb-4" />
                <div className="flex gap-3">
                  <button onClick={() => setCrystallizeModalOpen(false)}
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-zinc-400 rounded-xl text-sm font-bold transition-all">
                    Cancel
                  </button>
                  <button onClick={doFinalizeBrainstorm} disabled={!crystallizeName.trim() || crystallizing}
                    className="flex-1 py-3 bg-orange-500 hover:bg-orange-400 disabled:opacity-50 text-black rounded-xl text-sm font-black transition-all">
                    {crystallizing ? 'Crystallizing...' : 'Crystallize'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Workbook / Segment / Folio creator */}
      <AnimatePresence>
        {createModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-[180] flex items-center justify-center bg-black/75 p-8 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
              className="w-full max-w-lg rounded-2xl border border-purple-500/20 bg-[#0d0d0f] p-7 shadow-2xl shadow-purple-950/20">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-purple-300">
                    {createModal === 'note' ? 'Note+' : createModal === 'workbook' ? 'Workbook+' : createModal === 'segment' ? 'Segment+' : createModal === 'section' ? 'Section+' : 'Folio+'}
                  </p>
                  <h3 className="mt-1 text-lg font-bold text-white">
                    {createModal === 'note' && 'Create a standalone note'}
                    {createModal === 'workbook' && 'Create a workbook'}
                    {createModal === 'segment' && 'Create a workbook segment'}
                    {createModal === 'section' && 'Create a segment section'}
                    {createModal === 'folio' && 'Create a folio page'}
                  </h3>
                </div>
                <button onClick={() => setCreateModal(null)} className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <input autoFocus value={createForm.title} onChange={e => setCreateForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="Title..."
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-purple-500/40" />

                {(createModal === 'segment' || createModal === 'section' || createModal === 'folio') && !createContext.workbook && (
                  <select value={createForm.workbook} onChange={e => setCreateForm(prev => ({ ...prev, workbook: e.target.value, segment: '', section: '' }))}
                    className="w-full rounded-xl border border-white/10 bg-[#151518] px-4 py-3 text-sm text-white outline-none focus:border-purple-500/40">
                    <option value="">Choose workbook...</option>
                    {workbooks.map(workbook => (
                      <option key={workbook.name} value={workbook.title || workbook.name.replace(/\.md$/i, '')}>
                        {workbook.title || workbook.name.replace(/\.md$/i, '')}
                      </option>
                    ))}
                  </select>
                )}

                {(createModal === 'segment' || createModal === 'section' || createModal === 'folio') && createContext.workbook && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Workbook</p>
                    <p className="mt-1 truncate text-sm text-zinc-200">{createContext.workbook}</p>
                  </div>
                )}

                {(createModal === 'section' || createModal === 'folio') && !createContext.segment && (
                  <select value={createForm.segment} onChange={e => setCreateForm(prev => ({ ...prev, segment: e.target.value, section: '' }))}
                    className="w-full rounded-xl border border-white/10 bg-[#151518] px-4 py-3 text-sm text-white outline-none focus:border-purple-500/40">
                    <option value="">Choose segment...</option>
                    {segments.map(segment => (
                      <option key={segment.name} value={segment.title || segment.name.replace(/\.md$/i, '')}>
                        {segment.title || segment.name.replace(/\.md$/i, '')}
                      </option>
                    ))}
                  </select>
                )}

                {(createModal === 'section' || createModal === 'folio') && createContext.segment && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Segment</p>
                    <p className="mt-1 truncate text-sm text-zinc-200">{createContext.segment}</p>
                  </div>
                )}

                {createModal === 'folio' && !createContext.section && (
                  <select value={createForm.section} onChange={e => setCreateForm(prev => ({ ...prev, section: e.target.value }))}
                    className="w-full rounded-xl border border-white/10 bg-[#151518] px-4 py-3 text-sm text-white outline-none focus:border-purple-500/40">
                    <option value="">Choose section or leave unsorted...</option>
                    {sections.map(section => (
                      <option key={section.name} value={section.title || section.name.replace(/\.md$/i, '')}>
                        {section.title || section.name.replace(/\.md$/i, '')}
                      </option>
                    ))}
                  </select>
                )}

                {createModal === 'folio' && createContext.section && (
                  <div className="rounded-xl border border-white/10 bg-white/[0.035] px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Section</p>
                    <p className="mt-1 truncate text-sm text-zinc-200">{createContext.section}</p>
                  </div>
                )}

                <textarea value={createForm.description} onChange={e => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={5}
                  placeholder={createModal === 'folio' || createModal === 'note' ? 'Start writing...' : 'Optional description...'}
                  className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-purple-500/40" />
              </div>

              <div className="mt-5 flex gap-3">
                <button onClick={() => setCreateModal(null)}
                  className="flex-1 rounded-xl bg-white/5 py-3 text-sm font-bold text-zinc-400 transition-all hover:bg-white/10">
                  Cancel
                </button>
                <button onClick={handleCreateArtifact}
                  disabled={createSaving || !createForm.title.trim() || ((createModal === 'segment' || createModal === 'section' || createModal === 'folio') && !createForm.workbook) || ((createModal === 'section' || createModal === 'folio') && !createForm.segment)}
                  className="flex-1 rounded-xl bg-purple-600 py-3 text-sm font-black text-white transition-all hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40">
                  {createSaving ? 'Creating...' : 'Create'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Annotation modal */}
      <AnimatePresence>
        {annotationModalOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-[185] flex items-center justify-center bg-black/75 p-8 backdrop-blur-sm">
            <motion.div initial={{ scale: 0.94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.94, opacity: 0 }}
              className="w-full max-w-lg rounded-2xl border border-amber-400/20 bg-[#0d0d0f] p-7 shadow-2xl shadow-amber-950/20">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-amber-300">Annotation</p>
                  <h3 className="mt-1 text-lg font-bold text-white">{activeAnnotation ? 'Edit highlight note' : 'Add a note to this highlight'}</h3>
                </div>
                <button onClick={() => { setAnnotationModalOpen(false); setActiveAnnotation(null); }} className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mb-3 rounded-xl border border-amber-400/15 bg-amber-400/[0.05] px-4 py-3">
                <p className="line-clamp-4 text-sm leading-relaxed text-amber-100">{selectedTextForAnnotation}</p>
              </div>
              <textarea
                autoFocus
                value={annotationText}
                onChange={e => setAnnotationText(e.target.value)}
                rows={6}
                placeholder={activeAnnotation ? 'Edit the connected thought...' : 'Write the connected thought...'}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm leading-relaxed text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-amber-400/40"
              />
              <div className="mt-5 flex gap-3">
                <button onClick={() => { setAnnotationModalOpen(false); setActiveAnnotation(null); }}
                  className="flex-1 rounded-xl bg-white/5 py-3 text-sm font-bold text-zinc-400 transition-all hover:bg-white/10">
                  Cancel
                </button>
                <button onClick={saveAnnotation} disabled={annotationSaving || !annotationText.trim()}
                  className="flex-1 rounded-xl bg-amber-500 py-3 text-sm font-black text-black transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40">
                  {annotationSaving ? 'Saving...' : activeAnnotation ? 'Update Annotation' : 'Save Annotation'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Quick Note slide-in */}
      <AnimatePresence>
        {isQuickNoteOpen && !isBrainstorming && (
          <motion.div initial={{ opacity: 0, x: 100 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 100 }}
            className="absolute top-0 right-0 h-full w-96 bg-[#0d0d0f]/95 backdrop-blur-3xl border-l border-white/10 shadow-2xl z-[100] flex flex-col">
            <div className="px-6 py-4 flex items-center justify-between border-b border-white/5">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Edit3 className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <input value={quickNoteName} onChange={e => setQuickNoteName(e.target.value)} placeholder="Note title..."
                  className="flex-1 bg-transparent text-white font-semibold text-sm outline-none placeholder-zinc-600 min-w-0" />
              </div>
              <button onClick={() => setIsQuickNoteOpen(false)}
                className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-500 hover:text-white transition-all flex-shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 p-5 flex flex-col gap-3 min-h-0">
              <div className="flex gap-2">
                {TEMPLATES.map(t => (
                  <button key={t.label} onClick={() => { setQuickNoteName(t.title); setQuickNoteText(t.body); }}
                    className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/10 text-zinc-500 hover:text-zinc-300 text-[10px] font-medium transition-all flex flex-col items-center gap-1">
                    <t.Icon className={`w-3.5 h-3.5 ${t.color}`} />
                    {t.label}
                  </button>
                ))}
              </div>
              <textarea autoFocus value={quickNoteText}
                onChange={(e) => { setQuickNoteText(e.target.value); setQuickNoteError(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSaveQuickNote(); }}
                placeholder="Capture a thought..."
                className="flex-1 bg-white/5 border border-white/5 rounded-xl p-4 text-sm text-zinc-200 outline-none focus:border-purple-500/30 transition-all resize-none leading-relaxed" />
              {quickNoteError && <p className="text-xs text-red-400 font-mono text-center">{quickNoteError}</p>}
              <div className="flex gap-2">
                <button onClick={handleSaveQuickNote} disabled={quickNoteSaving || !quickNoteText.trim()}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-200 rounded-xl font-semibold text-sm transition-all border border-white/5 hover:border-purple-500/30 active:scale-[0.98] flex items-center justify-center gap-2">
                  {quickNoteSaving ? <><span className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-purple-400 rounded-full animate-spin" /> Saving...</> : <><Save className="w-3.5 h-3.5" /> Save</>}
                </button>
                {onSendToSoma && (
                  <button onClick={() => { if (quickNoteText.trim()) { onSendToSoma(quickNoteText); handleSaveQuickNote(); } }}
                    disabled={quickNoteSaving || !quickNoteText.trim()}
                    className="px-4 py-3 bg-fuchsia-600/20 hover:bg-fuchsia-600/30 disabled:opacity-40 text-fuchsia-400 rounded-xl text-sm transition-all border border-fuchsia-500/20 hover:border-fuchsia-500/40 active:scale-[0.98] flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5" /> SOMA
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
};

export default ReflectionsTab;
