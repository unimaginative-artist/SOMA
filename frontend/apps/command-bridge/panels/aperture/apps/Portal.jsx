import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  ArrowLeft, ArrowRight, Bookmark, BookOpen, Brain, CheckCircle2, Compass,
  ExternalLink, FileText, Globe2, History, Library,
  Plus, RefreshCw, Search, Send, ShieldCheck, Sparkles, X,
  ChevronDown, ChevronRight, Folder, LayoutGrid, User, Music, Users, Settings, Home, File,
  Lock, Star, Moon, ChevronUp, Code2, DatabaseZap, Copy, Download, Upload, Trash2, RotateCcw,
  EyeOff, Unlock, Key
} from 'lucide-react';
import somaBackend from '../../../somaBackend';
import './Portal.css';

const SPEED_DIAL_SITES = [
  { name: 'Google', url: 'https://www.google.com', color: '#4285F4', desc: 'Search engine' },
  { name: 'GitHub', url: 'https://github.com', color: '#24292e', desc: 'Code repository' },
  { name: 'Wikipedia', url: 'https://wikipedia.org', color: '#636466', desc: 'Encyclopedia' },
  { name: 'arXiv', url: 'https://arxiv.org', color: '#B31B1B', desc: 'Research papers' },
  { name: 'YouTube', url: 'https://youtube.com', color: '#FF0000', desc: 'Video library' },
  { name: 'Spotify', url: 'https://spotify.com', color: '#1DB954', desc: 'Audio streaming' },
  { name: 'Stack Overflow', url: 'https://stackoverflow.com', color: '#F48024', desc: 'Dev Q&A' },
  { name: 'Hacker News', url: 'https://news.ycombinator.com', color: '#FF6600', desc: 'Tech news' }
];

const GMN_TEMPLATES = {
  blank: {
    label: 'Blank',
    description: '',
    html: ''
  },
  blog: {
    label: 'Simple Blog',
    description: 'A clean local writing space.',
    html: site => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${site}.gmn</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; background: #10141b; color: #eef2ff; }
    main { max-width: 760px; margin: 0 auto; padding: 64px 24px; }
    h1 { font-size: 38px; margin: 0 0 10px; }
    article { margin-top: 34px; padding-top: 24px; border-top: 1px solid rgba(255,255,255,.12); }
    p { color: #cbd5e1; line-height: 1.75; }
  </style>
</head>
<body>
  <main>
    <h1>${site}.gmn</h1>
    <p>A local GMN journal for durable thoughts, notes, and public-facing drafts.</p>
    <article>
      <h2>First Entry</h2>
      <p>Write the first signal here.</p>
    </article>
  </main>
</body>
</html>`
  },
  docs: {
    label: 'Docs',
    description: 'A structured local documentation site.',
    html: site => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${site}.gmn docs</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; background: #0d1117; color: #eef2ff; }
    nav { padding: 28px 18px; border-right: 1px solid rgba(255,255,255,.1); background: rgba(255,255,255,.03); }
    main { padding: 46px; max-width: 880px; }
    a, code { color: #c4b5fd; }
    p, li { color: #cbd5e1; line-height: 1.7; }
  </style>
</head>
<body>
  <nav><strong>${site}.gmn</strong><p>Overview<br>Notes<br>Decisions</p></nav>
  <main>
    <h1>Project Docs</h1>
    <p>Use this construct for plans, specs, links, and versioned decisions.</p>
    <h2>Decisions</h2>
    <ul><li>Record the why, not just the what.</li></ul>
  </main>
</body>
</html>`
  },
  dashboard: {
    label: 'Dashboard',
    description: 'A compact status page.',
    html: site => `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${site}.gmn dashboard</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top, rgba(124,58,237,.32), transparent 34%), #0a0f16; color: #eef2ff; }
    main { padding: 42px; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
    section { padding: 18px; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: rgba(255,255,255,.06); }
    p { color: #cbd5e1; line-height: 1.6; }
  </style>
</head>
<body>
  <main>
    <h1>${site}.gmn</h1>
    <div class="grid">
      <section><strong>Status</strong><p>Online</p></section>
      <section><strong>Focus</strong><p>Define the mission.</p></section>
      <section><strong>Next</strong><p>Ship the smallest proof.</p></section>
    </div>
  </main>
</body>
</html>`
  }
};

const getFaviconUrl = (tab) => {
  const url = tab.page?.address;
  if (!url || !url.startsWith('http')) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return null;
  }
};


const homePage = () => ({
  kind: 'home',
  title: 'Portal',
  address: 'portal://home',
  query: '',
  content: '',
  synthesis: '',
  sources: [],
  memoryHits: [],
  createdAt: Date.now()
});

const newTab = (isPrivate = false) => {
  const page = homePage();
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: isPrivate ? 'Private Tab' : 'Portal',
    isPrivate,
    page,
    stack: [page],
    cursor: 0,
    trail: [{ at: Date.now(), text: 'Opened Portal home' }]
  };
};


function parseWebSearch(raw) {
  if (!raw) return [];
  const indexed = raw.split(/\n(?=\[\d+\])/).map(block => {
    const link = block.match(/https?:\/\/[^\s)>\]]+/)?.[0] || '';
    const title = block.match(/\[\d+\]\s*\*\*(.*?)\*\*/)?.[1]
      || block.match(/\[\d+\]\s*(.*)/)?.[1]
      || 'Source';
    const snippet = block
      .replace(/\[\d+\]\s*\*\*?.*?\*\*?\s*/s, '')
      .replace(link, '')
      .replace(/\s+/g, ' ')
      .trim();
    return link ? { title: title.trim(), url: link, snippet: snippet.slice(0, 210) } : null;
  }).filter(Boolean);
  if (indexed.length) return indexed;
  return [...raw.matchAll(/https?:\/\/[^\s)>\]]+/g)].slice(0, 8).map(match => ({
    title: new URL(match[0]).hostname,
    url: match[0],
    snippet: ''
  }));
}

function parseMemory(raw) {
  if (!raw || /no results|unavailable|fallback/i.test(raw)) return [];
  return raw.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8).map((line, index) => ({
    id: index,
    text: line.length > 230 ? `${line.slice(0, 227)}...` : line
  }));
}

function responseText(result, fallback) {
  return result?.response || result?.message || fallback;
}

function pageText(page) {
  if (!page || page.kind === 'home') return '';
  if (page.kind === 'research') {
    const sources = page.sources.map((source, index) => `[${index + 1}] ${source.title} - ${source.url}`).join('\n');
    return `Query: ${page.query}\n\n${page.synthesis}\n\nSources:\n${sources}`;
  }
  return `URL: ${page.address}\n\n${page.content}`;
}

function isGmnAddress(value = '') {
  const trimmed = String(value || '').trim().toLowerCase().replace(/^gmn:\/\//, '');
  return /^(?:portal\.)?[a-z0-9][a-z0-9-]{1,62}\.gmn(?:\/.*)?$/.test(trimmed);
}

function normalizeGmnAddress(value = '') {
  return String(value || '').trim().toLowerCase().replace(/^gmn:\/\//, '').replace(/^https?:\/\//, '');
}

function parseGmnAddress(value = '') {
  const normalized = normalizeGmnAddress(value);
  const [domain, ...rest] = normalized.split('/');
  return { domain, path: rest.length ? `/${rest.join('/')}` : '' };
}

function sortGmnSites(sites = []) {
  return [...sites].sort((a, b) => {
    const left = Date.parse(a?.manifest?.updatedAt || '') || 0;
    const right = Date.parse(b?.manifest?.updatedAt || '') || 0;
    return right - left || String(a?.canonical || '').localeCompare(String(b?.canonical || ''));
  });
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function PortalBrowser({ workspace, policy = {}, onSettingsUpdate }) {
  const [tabs, setTabs] = useState(() => [newTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [somaCursor, setSomaCursor] = useState(null);
  const [mode, setMode] = useState('browse');
  const [input, setInput] = useState('');
  const [sideTab, setSideTab] = useState('assistant');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState('');
  const [question, setQuestion] = useState('');
  const [conversation, setConversation] = useState([]);
  const [steveInput, setSteveInput] = useState('');
  const [steveMessages, setSteveMessages] = useState(() => {
    try {
      const saved = localStorage.getItem('portal_steve_messages');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [{
      role: 'steve',
      text: 'I can audit the open page, turn research into next steps, or help shape GMN sites from what Portal finds.',
      ts: Date.now()
    }];
  });
  const [steveThinking, setSteveThinking] = useState(false);
  const [steveStatus, setSteveStatus] = useState({ online: false, status: 'offline', mood: 'dormant' });
  const [bookmarks, setBookmarks] = useState([]);
  const [library, setLibrary] = useState([]);
  const [workspacesList, setWorkspacesList] = useState([]);
  const [workspacesExpanded, setWorkspacesExpanded] = useState(true);
  const [bookmarksExpanded, setBookmarksExpanded] = useState(true);
  const [tabsExpanded, setTabsExpanded] = useState(true);
  const [showAssistPanel, setShowAssistPanel] = useState(false);
  const [gmnSites, setGmnSites] = useState([]);
  const [gmnEditor, setGmnEditor] = useState(null);      // {site, html, title, description} | null
  const [gmnEditorSaving, setGmnEditorSaving] = useState(false);
  const [gmnEditorPreview, setGmnEditorPreview] = useState(false);
  const [gmnSecInspector, setGmnSecInspector] = useState(null);  // manifest | null
  const [gmnSecurityChanges, setGmnSecurityChanges] = useState(null);
  const [gmnCreateName, setGmnCreateName] = useState('');
  const [gmnCreating, setGmnCreating] = useState(false);
  const [gmnCreateBusy, setGmnCreateBusy] = useState(false);
  const [gmnTemplate, setGmnTemplate] = useState('blank');
  const [dendriteStats, setDendriteStats] = useState({ indexedPages: 0 });

  // Premium Browser States
  const [showPermissionsPopover, setShowPermissionsPopover] = useState(false);
  const [sitePermissions, setSitePermissions] = useState(null);
  const [showDownloadsTray, setShowDownloadsTray] = useState(false);
  const [downloads, setDownloads] = useState([]);
  const [activeDownloadsCount, setActiveDownloadsCount] = useState(0);
  const [showCredentialsPopover, setShowCredentialsPopover] = useState(false);
  const [activeCredentials, setActiveCredentials] = useState([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showAddCredential, setShowAddCredential] = useState(false);

  const [webviewStates, setWebviewStates] = useState({});

  const updateWebviewState = useCallback((tabId, patch) => {
    setWebviewStates(prev => ({
      ...prev,
      [tabId]: {
        ...(prev[tabId] || {
          loading: false,
          canGoBack: false,
          canGoForward: false,
          loadProgress: 0,
          forceDark: false,
          showFindBar: false,
          findText: '',
          findResults: null
        }),
        ...patch
      }
    }));
  }, []);

  // WebSocket subscription for SOMA cursor coordinates overlay
  useEffect(() => {
    if (!somaBackend || typeof somaBackend.on !== 'function') return;
    const handleVisionUpdate = (payload) => {
      if (payload?.ghostCursor) {
        setSomaCursor(payload.ghostCursor);
      } else {
        setSomaCursor(null);
      }
    };
    somaBackend.on('vision_update', handleVisionUpdate);
    return () => {
      somaBackend.off?.('vision_update', handleVisionUpdate);
    };
  }, []);

  // Load initial state from backend on mount
  useEffect(() => {
    let active = true;
    const loadBackendState = async () => {
      try {
        const [tabsRes, bookmarksRes, historyRes, workspacesRes] = await Promise.all([
          somaBackend.fetch('/api/aperture/portal/tabs'),
          somaBackend.fetch('/api/aperture/portal/bookmarks'),
          somaBackend.fetch('/api/aperture/portal/history'),
          somaBackend.fetch('/api/axis/workspaces').catch(() => ({ success: false }))
        ]);
        if (!active) return;
        
        if (tabsRes.success && tabsRes.tabs && tabsRes.tabs.length > 0) {
          setTabs(tabsRes.tabs);
          const activeTabObj = tabsRes.tabs.find(t => t.is_active);
          setActiveTabId(activeTabObj ? activeTabObj.id : tabsRes.tabs[0].id);
        }
        
        if (bookmarksRes.success) {
          setBookmarks(bookmarksRes.bookmarks || []);
        }
        
        if (historyRes.success) {
          setLibrary(historyRes.history || []);
        }

        if (workspacesRes.success || workspacesRes.workspaces) {
          setWorkspacesList(workspacesRes.workspaces || []);
        }
      } catch (err) {
        console.error('[Portal] Failed to load initial state:', err);
      }
    };
    loadBackendState();
    somaBackend.fetch('/api/gmn/sites').then(r => { if (r.success) setGmnSites(sortGmnSites(r.sites || [])); }).catch(() => {});
    somaBackend.fetch('/api/aperture/portal/stats').then(r => { if (r.success) setDendriteStats(r); }).catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Debounced tab state sync to backend
  useEffect(() => {
    if (tabs.length === 0) return undefined;
    const timer = setTimeout(async () => {
      try {
        const tabsToSync = tabs.map((tab, idx) => ({
          id: tab.id,
          title: tab.title,
          is_active: tab.id === activeTabId,
          sort_order: idx,
          page: tab.page,
          stack: tab.stack,
          cursor: tab.cursor,
          trail: tab.trail
        }));
        await somaBackend.fetch('/api/aperture/portal/tabs/sync', {
          method: 'POST',
          body: JSON.stringify({ tabs: tabsToSync })
        });
      } catch (err) {
        console.error('[Portal] Failed to sync tabs:', err);
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [tabs, activeTabId]);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [tasks, setTasks] = useState([]);
  const webviewRef = useRef(null);
  const gmnNavRef = useRef(null);
  const steveScrollRef = useRef(null);
  const isElectron = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);

  const activeTabState = webviewStates[activeTabId] || {
    loading: false,
    canGoBack: false,
    canGoForward: false,
    loadProgress: 0,
    forceDark: false,
    showFindBar: false,
    findText: '',
    findResults: null
  };

  const loadProgress = activeTabState.loadProgress || 0;
  const showProgressBar = loadProgress > 0 && loadProgress < 100;

  // Simulated loading progress animation for active tab
  useEffect(() => {
    const activeState = webviewStates[activeTabId];
    if (!activeState) return;

    let interval;
    if (activeState.loading) {
      updateWebviewState(activeTabId, { loadProgress: 15 });
      interval = setInterval(() => {
        setWebviewStates(prev => {
          const s = prev[activeTabId] || {};
          if (!s.loading) {
            clearInterval(interval);
            return prev;
          }
          const nextProgress = Math.min(90, (s.loadProgress || 15) + Math.random() * 8);
          return {
            ...prev,
            [activeTabId]: { ...s, loadProgress: nextProgress }
          };
        });
      }, 200);
    } else if (activeState.loadProgress > 0 && activeState.loadProgress < 100) {
      updateWebviewState(activeTabId, { loadProgress: 100 });
      const timer = setTimeout(() => {
        updateWebviewState(activeTabId, { loadProgress: 0 });
      }, 350);
      return () => clearTimeout(timer);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTabId, webviewStates[activeTabId]?.loading]);

  const activeTab = tabs.find(tab => tab.id === activeTabId) || tabs[0];
  const page = activeTab.page;
  const hasEvidence = page.kind !== 'home' && (page.kind !== 'browser' || page.captured);

  // Resolve active origin
  const activeOrigin = useMemo(() => {
    if (activeTab?.page?.kind === 'browser' && activeTab?.page?.address?.startsWith('http')) {
      try {
        return new URL(activeTab.page.address).origin;
      } catch {
        return null;
      }
    }
    return null;
  }, [activeTabId, activeTab?.page?.address, activeTab?.page?.kind]);

  // Fetch permissions for active origin
  useEffect(() => {
    if (!activeOrigin) {
      setSitePermissions(null);
      return;
    }
    let active = true;
    somaBackend.fetch(`/api/aperture/portal/permissions/origin?origin=${encodeURIComponent(activeOrigin)}`)
      .then(res => {
        if (active && res.success) {
          setSitePermissions(res.permissions);
        }
      })
      .catch(err => console.error('[Portal] Failed to fetch permissions:', err));
    return () => { active = false; };
  }, [activeOrigin]);

  // Auto-redirect browser pages to reader mode when running outside of Electron
  useEffect(() => {
    if (!isElectron && page?.kind === 'browser' && page?.address) {
      readUrl(page.address);
    }
  }, [page?.kind, page?.address, isElectron]);

  // Update site permission
  const handleUpdatePermission = async (permission, value) => {
    if (!activeOrigin) return;
    try {
      const res = await somaBackend.fetch('/api/aperture/portal/permissions', {
        method: 'POST',
        body: JSON.stringify({ origin: activeOrigin, permission, value })
      });
      if (res.success) {
        setSitePermissions(res.permissions);
        setNotice(`Updated ${permission} permission to ${value} for ${activeOrigin}`);
      }
    } catch (err) {
      setError('Failed to update permission');
    }
  };

  // Fetch credentials for active origin
  useEffect(() => {
    if (!activeOrigin) {
      setActiveCredentials([]);
      return;
    }
    let active = true;
    somaBackend.fetch(`/api/aperture/portal/credentials?origin=${encodeURIComponent(activeOrigin)}`)
      .then(res => {
        if (active && res.success) {
          setActiveCredentials(res.credentials || []);
        }
      })
      .catch(err => console.error('[Portal] Error fetching credentials:', err));
    return () => { active = false; };
  }, [activeOrigin]);

  // Save new credential
  const handleSaveCredential = async () => {
    if (!activeOrigin || !newUsername.trim() || !newPassword.trim()) return;
    try {
      const res = await somaBackend.fetch('/api/aperture/portal/credentials', {
        method: 'POST',
        body: JSON.stringify({ origin: activeOrigin, username: newUsername, password: newPassword })
      });
      if (res.success) {
        setNewUsername('');
        setNewPassword('');
        setShowAddCredential(false);
        setNotice('Credential saved successfully.');
        const updated = await somaBackend.fetch(`/api/aperture/portal/credentials?origin=${encodeURIComponent(activeOrigin)}`);
        if (updated.success) setActiveCredentials(updated.credentials || []);
      }
    } catch (err) {
      setError('Failed to save credential');
    }
  };

  // Delete credential
  const handleDeleteCredential = async (id) => {
    try {
      const res = await somaBackend.fetch(`/api/aperture/portal/credentials/${id}`, {
        method: 'DELETE'
      });
      if (res.success) {
        setActiveCredentials(prev => prev.filter(c => c.id !== id));
        setNotice('Credential deleted.');
      }
    } catch (err) {
      setError('Failed to delete credential');
    }
  };

  // Inject credential autofill
  const handleAutofillCredential = (username, password) => {
    if (!webviewRef.current || activeTab?.page?.kind !== 'browser') return;
    const script = `
      (function() {
        const passwordField = document.querySelector('input[type="password"]');
        if (passwordField) {
          passwordField.value = ${JSON.stringify(password)};
          passwordField.dispatchEvent(new Event('input', { bubbles: true }));
          passwordField.dispatchEvent(new Event('change', { bubbles: true }));
          
          let usernameField = null;
          const inputs = Array.from(document.querySelectorAll('input'));
          const idx = inputs.indexOf(passwordField);
          for (let i = idx - 1; i >= 0; i--) {
            if (inputs[i].type === 'text' || inputs[i].type === 'email') {
              usernameField = inputs[i];
              break;
            }
          }
          if (usernameField) {
            usernameField.value = ${JSON.stringify(username)};
            usernameField.dispatchEvent(new Event('input', { bubbles: true }));
            usernameField.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      })()
    `;
    webviewRef.current.executeJavaScript(script)
      .then(() => {
        setNotice('Credentials autofilled.');
        setShowCredentialsPopover(false);
      })
      .catch(err => {
        console.error('[Portal] Autofill error:', err);
        setError('Autofill injection failed.');
      });
  };

  // Fetch downloads list
  const fetchDownloads = useCallback(async () => {
    try {
      const res = await somaBackend.fetch('/api/aperture/portal/downloads');
      if (res.success) {
        setDownloads(res.downloads || []);
        const activeCount = (res.downloads || []).filter(d => d.state === 'progress').length;
        setActiveDownloadsCount(activeCount);
      }
    } catch (err) {
      console.error('[Portal] Failed to fetch downloads:', err);
    }
  }, []);

  // Poll downloads if tray is open or downloads are in progress
  useEffect(() => {
    fetchDownloads();
    const timer = setInterval(() => {
      const hasProgress = downloads.some(d => d.state === 'progress');
      if (hasProgress || showDownloadsTray) {
        fetchDownloads();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [downloads, showDownloadsTray, fetchDownloads]);

  // Delete download entry
  const handleDeleteDownload = async (id) => {
    try {
      const res = await somaBackend.fetch(`/api/aperture/portal/downloads/${id}`, {
        method: 'DELETE'
      });
      if (res.success) {
        setDownloads(prev => prev.filter(d => d.id !== id));
        setNotice('Download record removed.');
      }
    } catch (err) {
      setError('Failed to remove download record');
    }
  };

  // Explain selected text helper
  const explainSelection = async () => {
    if (!webviewRef.current || activeTab?.page?.kind !== 'browser') return;
    try {
      const selection = await webviewRef.current.executeJavaScript(`window.getSelection().toString()`);
      if (!selection || !selection.trim()) {
        setNotice('Please select/highlight some text on the web page first!');
        return;
      }
      setShowAssistPanel(true);
      setSideTab('assistant');
      setSteveThinking(true);
      setSteveMessages(prev => [...prev, { role: 'user', text: `Explain this highlighted text: "${selection}"`, ts: Date.now() }]);
      
      const result = await somaBackend.fetch('/api/soma/steve/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: `Explain this highlighted text selected by the user on the current page:\n\n"${selection}"\n\nActive Page URL: ${activeTab.page.address}`,
          history: steveMessages.slice(-8).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.text
          })),
          context: portalSteveContext()
        })
      });
      
      if (result.error || result.success === false) throw new Error(result.error || 'Steve failed to explain selection.');
      
      setSteveMessages(prev => [...prev, {
        role: 'steve',
        text: responseText(result, 'Steve returned no explanation.'),
        ts: Date.now()
      }]);
    } catch (err) {
      setError(`Failed to explain: ${err.message}`);
    } finally {
      setSteveThinking(false);
    }
  };

  // Toggle private mode for current active tab
  const togglePrivateMode = () => {
    setTabs(previous => previous.map(tab => {
      if (tab.id !== activeTabId) return tab;
      const nextPrivate = !tab.isPrivate;
      return {
        ...tab,
        isPrivate: nextPrivate,
        title: nextPrivate ? 'Private Tab' : 'Portal',
        page: {
          ...tab.page,
          title: nextPrivate ? 'Private Tab' : 'Portal'
        }
      };
    }));
    setNotice(activeTab.isPrivate ? 'Switched tab to Standard mode.' : 'Switched tab to Private mode. Cookies, cache, and history will not be logged.');
  };
  const isSaved = bookmarks.some(item => item.address === page.address);
  const canBack = page.kind === 'browser' ? activeTabState.canGoBack : activeTab.cursor > 0;
  const canForward = page.kind === 'browser' ? activeTabState.canGoForward : activeTab.cursor < activeTab.stack.length - 1;

  const portalStats = useMemo(() => ({
    sources: page.sources?.length || 0,
    memories: page.memoryHits?.length || 0,
    saved: library.length
  }), [library.length, page.memoryHits, page.sources]);

  useEffect(() => {
    if (!workspace?.id) {
      setProjects([]);
      setProjectId('');
      return;
    }
    somaBackend.fetch(`/api/axis/projects?workspaceId=${encodeURIComponent(workspace.id)}`)
      .then(response => {
        const items = response.projects || [];
        setProjects(items);
        setProjectId(previous => items.some(item => item.id === previous) ? previous : (items[0]?.id || ''));
      })
      .catch(() => setProjects([]));
  }, [workspace?.id]);

  useEffect(() => {
    localStorage.setItem('portal_steve_messages', JSON.stringify(steveMessages.slice(-80)));
    if (steveScrollRef.current) steveScrollRef.current.scrollTop = steveScrollRef.current.scrollHeight;
  }, [steveMessages]);

  useEffect(() => {
    let cancelled = false;
    const loadStatus = async () => {
      try {
        const status = await somaBackend.fetch('/api/soma/steve/status');
        if (!cancelled) setSteveStatus(status || { online: false, status: 'offline', mood: 'dormant' });
      } catch {
        if (!cancelled) setSteveStatus({ online: false, status: 'offline', mood: 'dormant' });
      }
    };
    loadStatus();
    const timer = setInterval(loadStatus, 12000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setInput(page.kind === 'home' ? '' : (page.query || page.address));
    setSummary('');
    setConversation([]);
    setTasks([]);
  }, [activeTabId, page.address]);

  useEffect(() => {
    const handleAction = event => {
      const { action, payload = {} } = event.detail || {};
      if (action === 'browser_navigate' && payload.url) browseUrl(payload.url);
      if (action === 'browser_search' && payload.query) runPortalSearch(payload.query);
    };
    window.addEventListener('aperture-app-action', handleAction);
    return () => window.removeEventListener('aperture-app-action', handleAction);
  }, [activeTabId]);

  const handleWebviewNavigate = useCallback((tabId, address, title) => {
    setTabs(previous => previous.map(tab => tab.id === tabId
      ? { ...tab, title, page: { ...tab.page, title, address } }
      : tab));
    if (tabId === activeTabId) {
      setInput(address);
    }
  }, [activeTabId]);

  const clearSignals = () => {
    setNotice('');
    setError('');
  };

  const executeTool = async (tool, args) => {
    if (['web_search', 'fetch_url'].includes(tool) && policy.networkAccess === false) {
      throw new Error('Network access is disabled in Aperture Settings.');
    }
    if (tool === 'remember' && policy.memoryWrite === false) {
      throw new Error('Memory capture is disabled in Aperture Settings.');
    }
    const result = await somaBackend.fetch('/api/soma/execute-tool', {
      method: 'POST',
      body: JSON.stringify({ tool, args })
    });
    if (!result.success) throw new Error(result.error || `${tool} is unavailable.`);
    return result.output || '';
  };

  const addTrail = text => {
    setTabs(previous => previous.map(tab => tab.id === activeTabId
      ? { ...tab, trail: [...tab.trail, { at: Date.now(), text }].slice(-30) }
      : tab));
  };

  const openPage = (nextPage, action) => {
    setTabs(previous => previous.map(tab => {
      if (tab.id !== activeTabId) return tab;
      const stack = [...tab.stack.slice(0, tab.cursor + 1), nextPage];
      return {
        ...tab,
        title: nextPage.title,
        page: nextPage,
        stack,
        cursor: stack.length - 1,
        trail: [...tab.trail, { at: Date.now(), text: action }].slice(-30)
      };
    }));
  };

  const addLibraryItem = async nextPage => {
    try {
      const res = await somaBackend.fetch('/api/aperture/portal/history', {
        method: 'POST',
        body: JSON.stringify({
          title: nextPage.title,
          address: nextPage.address,
          kind: nextPage.kind,
          query: nextPage.query || '',
          isPrivate: activeTab?.isPrivate || false
        })
      });
      if (res.success && !activeTab?.isPrivate) {
        setLibrary(prev => [res.entry, ...prev.filter(entry => entry.address !== nextPage.address)].slice(0, 100));
      }
    } catch (err) {
      console.error('[Portal] Failed to save history:', err);
    }
  };

  const deleteHistoryItem = async (event, id) => {
    event.stopPropagation();
    try {
      const res = await somaBackend.fetch(`/api/aperture/portal/history/${id}`, {
        method: 'DELETE'
      });
      if (res.success) {
        setLibrary(previous => previous.filter(item => item.id !== id));
      }
    } catch (err) {
      console.error('[Portal] Failed to delete history item:', err);
    }
  };

  const clearHistory = async () => {
    try {
      const res = await somaBackend.fetch('/api/aperture/portal/history', {
        method: 'DELETE'
      });
      if (res.success) {
        setLibrary([]);
      }
    } catch (err) {
      console.error('[Portal] Failed to clear history:', err);
    }
  };

  async function runPortalSearch(value) {
    const query = (value || input).trim();
    if (!query) return;
    clearSignals();
    setMode('index');
    setBusy('Searching Dendrite Search...');
    try {
      const indexed = await somaBackend.fetch(`/api/aperture/portal/search?q=${encodeURIComponent(query)}`);
      if (indexed.error || indexed.success === false) throw new Error(indexed.error || 'Dendrite Search failed.');
      const sources = (indexed.results || []).map(result => ({
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        score: result.score,
        source: result.source,
        indexedAt: result.indexedAt
      }));
      let synthesis = sources.length
        ? `${sources.length} locally indexed documents match this query. Open a source or ask SOMA for a bounded synthesis.`
        : `No Dendrite Search pages match "${query}". Use Acquire to crawl source pages, or enter a URL to index it directly.`;
      if (sources.length && policy.somaReasoning !== false) {
        setBusy('Synthesizing indexed evidence...');
        const evidence = sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.snippet}\n${source.url}`).join('\n\n');
        const answer = await somaBackend.sendChat(
          `Act as Dendrite Search. Answer only from locally indexed extracts below. Cite claims with bracketed source numbers. If indexed evidence is insufficient, say so clearly.\n\nQuery: ${query}\n\nIndexed evidence:\n${evidence}`,
          { source: 'aperture_portal_index', workspaceId: workspace?.id }
        );
        synthesis = responseText(answer, synthesis);
      }
      const nextPage = {
        kind: 'research',
        acquisition: 'index',
        title: query,
        address: `portal://index/${encodeURIComponent(query)}`,
        query,
        content: '',
        synthesis,
        sources,
        memoryHits: [],
        indexCount: indexed.indexedPages || 0,
        createdAt: Date.now()
      };
      openPage(nextPage, `Searched Dendrite Search: "${query}"`);
      addLibraryItem(nextPage);
      setSideTab('sources');
    } catch (reason) {
      setError(reason.message || 'Dendrite Search failed.');
    } finally {
      setBusy('');
    }
  }

  async function runPortalCrawl(value) {
    const query = (value || input).trim();
    if (!query) return;
    if (policy.networkAccess === false) {
      setError('Network access is disabled in Aperture Settings.');
      return;
    }
    clearSignals();
    setMode('index');
    setBusy('Acquiring pages with Portal crawler...');
    try {
      const crawled = await somaBackend.fetch('/api/aperture/portal/crawl', {
        method: 'POST',
        body: JSON.stringify({ query, maxPages: 5 })
      });
      if (crawled.error || crawled.success === false) throw new Error(crawled.error || 'Portal crawler failed.');
      setNotice(`Portal crawler indexed ${crawled.indexed || 0} page(s).`);
      await runPortalSearch(query);
    } catch (reason) {
      setError(reason.message || 'Portal crawler failed.');
    } finally {
      setBusy('');
    }
  }

  async function runDiscovery(value) {
    const query = (value || input).trim();
    if (!query) return;
    clearSignals();
    setMode('discover');
    setBusy('Discovering external sources...');
    try {
      const [webRaw, memoryRaw] = await Promise.all([
        executeTool('web_search', { query, num_results: 7 }).catch(reason => `Web search unavailable: ${reason.message}`),
        executeTool('hybrid_search', { query, limit: 5 }).catch(reason => `Local recall unavailable: ${reason.message}`)
      ]);
      const sources = parseWebSearch(webRaw);
      const memoryHits = parseMemory(memoryRaw);
      let synthesis = 'SOMA reasoning is disabled. Source results remain available below.';
      if (policy.somaReasoning !== false) {
        setBusy('Building a sourced synthesis...');
        const answer = await somaBackend.sendChat(
          `Act as Portal Research. Answer the query using only the evidence below. Cite claims with bracketed source numbers when web sources support them. Mark uncertainty clearly and do not invent evidence.\n\nQuery: ${query}\n\nWeb evidence:\n${webRaw}\n\nSOMA memory context:\n${memoryRaw}`,
          { source: 'aperture_portal', workspaceId: workspace?.id }
        );
        synthesis = responseText(answer, 'No synthesis returned.');
      }
      const nextPage = {
        kind: 'research',
        acquisition: 'external',
        title: query,
        address: `portal://discover/${encodeURIComponent(query)}`,
        query,
        content: webRaw,
        synthesis,
        sources,
        memoryHits,
        createdAt: Date.now()
      };
      openPage(nextPage, `Discovered sources for "${query}"`);
      addLibraryItem(nextPage);
      setSideTab('sources');
    } catch (reason) {
      setError(reason.message || 'Research failed.');
    } finally {
      setBusy('');
    }
  }

  async function readUrl(value) {
    let address = (value || input).trim();
    if (!address) return;
    clearSignals();
    if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
    setMode('reader');
    setBusy('Extracting readable source content...');
    try {
      const content = await executeTool('fetch_url', { url: address });
      const nextPage = {
        kind: 'reader',
        title: new URL(address).hostname,
        address,
        query: '',
        content: content || 'No readable content was returned.',
        synthesis: '',
        sources: [{ title: new URL(address).hostname, url: address, snippet: '' }],
        memoryHits: [],
        createdAt: Date.now()
      };
      const indexed = await somaBackend.fetch('/api/aperture/portal/index', {
        method: 'POST',
        body: JSON.stringify({ url: address, title: nextPage.title, content: nextPage.content, source: 'portal-reader' })
      });
      if (indexed.error || indexed.success === false) throw new Error(indexed.error || 'Page extraction succeeded, but Dendrite Search indexing failed.');
      openPage(nextPage, `Read ${nextPage.title}`);
      addLibraryItem(nextPage);
      setNotice(`Indexed ${nextPage.title} in Dendrite Search.`);
    } catch (reason) {
      setError(reason.message || 'Unable to read this URL.');
    } finally {
      setBusy('');
    }
  }

  async function openGmnSite(value) {
    const address = normalizeGmnAddress(value || input);
    if (!address) return;
    const { domain, path } = parseGmnAddress(address);
    clearSignals();
    setMode('browse');
    setBusy('Resolving Gray Matter site...');
    try {
      const rendered = await somaBackend.fetch(`/api/gmn/render/${domain}${path}`);
      if (rendered.error || rendered.success === false) throw new Error(rendered.error || 'GMN site could not be resolved.');
      const nextPage = {
        kind: 'gmn',
        title: rendered.manifest?.title || rendered.canonical,
        address: rendered.domain,
        query: '',
        content: rendered.text || '',
        html: rendered.html || '',
        synthesis: '',
        sources: [{ title: rendered.manifest?.title || rendered.canonical, url: `gmn://${rendered.canonical}`, snippet: rendered.manifest?.description || '' }],
        memoryHits: [],
        manifest: rendered.manifest,
        canonical: rendered.canonical,
        source: rendered.source,
        hash: rendered.hash,
        captured: true,
        createdAt: Date.now()
      };
      openPage(nextPage, `Opened GMN site ${rendered.canonical}`);
      addLibraryItem({ ...nextPage, kind: 'gmn', address: `gmn://${rendered.canonical}` });
      setNotice(`${rendered.canonical} opened from Gray Matter Network.`);
    } catch (reason) {
      setError(reason.message || 'Unable to open GMN site.');
    } finally {
      setBusy('');
    }
  }

  const loadGmnSites = async () => {
    const r = await somaBackend.fetch('/api/gmn/sites').catch(() => ({}));
    if (r.success) setGmnSites(sortGmnSites(r.sites || []));
  };

  const openGmnEditor = async (site) => {
    const siteName = typeof site === 'string' ? site : site.manifest?.site;
    const r = await somaBackend.fetch(`/api/gmn/sites/${siteName}/source`).catch(() => ({}));
    if (!r.success) return;
    setGmnEditor({
      site: siteName,
      activePath: '/index.html',
      content: r.html || '',
      html: r.html || '',
      title: r.manifest?.title || siteName,
      description: r.manifest?.description || '',
      manifest: r.manifest || null,
      files: r.files || [],
      stats: r.stats || { bytes: 0, maxPackageBytes: 5242880 },
      versions: r.versions || []
    });
    setGmnEditorPreview(false);
  };

  const loadGmnEditorFile = async (filePath) => {
    if (!gmnEditor?.site || !filePath) return;
    const r = await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/file?path=${encodeURIComponent(filePath)}`).catch(() => ({}));
    if (!r.success) {
      setError(r.error || 'Unable to open GMN file.');
      return;
    }
    setGmnEditor(editor => ({
      ...editor,
      activePath: r.file.path,
      content: r.file.content,
      html: r.file.path === '/index.html' ? r.file.content : editor.html
    }));
    setGmnEditorPreview(false);
  };

  const saveGmnSite = async () => {
    if (!gmnEditor) return;
    setGmnEditorSaving(true);
    try {
      await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/metadata`, {
        method: 'PATCH',
        body: JSON.stringify({ title: gmnEditor.title, description: gmnEditor.description })
      });
      const r = await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/file`, {
        method: 'PUT',
        body: JSON.stringify({ path: gmnEditor.activePath || '/index.html', content: gmnEditor.content || '' })
      });
      if (r.success) {
        setGmnEditor(editor => ({
          ...editor,
          manifest: r.manifest || editor.manifest,
          files: r.files || editor.files,
          stats: r.stats || editor.stats,
          versions: r.versions || editor.versions,
          html: (editor.activePath || '/index.html') === '/index.html' ? editor.content : editor.html
        }));
        await loadGmnSites();
        setNotice(`${gmnEditor.site}.gmn saved.`);
      } else setError(r.error || 'Save failed');
    } finally { setGmnEditorSaving(false); }
  };

  const createGmnEditorFile = async () => {
    if (!gmnEditor?.site) return;
    const filePath = window.prompt('New file path', '/style.css');
    if (!filePath) return;
    const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const r = await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/file`, {
      method: 'PUT',
      body: JSON.stringify({ path: normalized, content: '' })
    }).catch(() => ({}));
    if (r.success) {
      setGmnEditor(editor => ({ ...editor, files: r.files || editor.files, stats: r.stats || editor.stats, versions: r.versions || editor.versions }));
      await loadGmnEditorFile(normalized);
    } else setError(r.error || 'File create failed');
  };

  const deleteGmnEditorFile = async () => {
    if (!gmnEditor?.site || !gmnEditor.activePath || gmnEditor.activePath === '/index.html') return;
    if (!window.confirm(`Delete ${gmnEditor.activePath}?`)) return;
    const r = await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/file?path=${encodeURIComponent(gmnEditor.activePath)}`, {
      method: 'DELETE'
    }).catch(() => ({}));
    if (r.success) {
      setGmnEditor(editor => ({
        ...editor,
        files: r.files || editor.files,
        stats: r.stats || editor.stats,
        versions: r.versions || editor.versions,
        activePath: '/index.html',
        content: editor.html || ''
      }));
      await loadGmnEditorFile('/index.html');
    } else setError(r.error || 'File delete failed');
  };

  const snapshotGmnSite = async () => {
    if (!gmnEditor?.site) return;
    const r = await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/versions`, {
      method: 'POST',
      body: JSON.stringify({ label: 'manual' })
    }).catch(() => ({}));
    if (r.success) {
      setGmnEditor(editor => ({ ...editor, versions: r.versions || editor.versions }));
      setNotice('GMN snapshot created.');
    } else setError(r.error || 'Snapshot failed');
  };

  const restoreGmnVersion = async (versionId) => {
    if (!gmnEditor?.site || !versionId) return;
    if (!window.confirm(`Restore ${versionId}? Current files will be snapshotted first.`)) return;
    const r = await somaBackend.fetch(`/api/gmn/sites/${gmnEditor.site}/versions/${versionId}/restore`, { method: 'POST' }).catch(() => ({}));
    if (r.success) {
      await openGmnEditor(gmnEditor.site);
      await loadGmnSites();
      setNotice('GMN version restored.');
    } else setError(r.error || 'Restore failed');
  };

  const exportGmnSite = (siteName) => {
    if (!siteName) return;
    window.location.href = `/api/gmn/sites/${siteName}/export`;
  };

  const importGmnSite = async (file, siteName = '') => {
    if (!file) return;
    const zipBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const r = await somaBackend.fetch('/api/gmn/sites/import', {
      method: 'POST',
      body: JSON.stringify({ site: siteName, zipBase64 })
    }).catch(() => ({}));
    if (r.success) {
      await loadGmnSites();
      setNotice(`${r.canonical} imported.`);
    } else setError(r.error || 'Import failed');
  };

  const reindexGmnSite = async (siteName) => {
    const r = await somaBackend.fetch(`/api/gmn/sites/${siteName}/reindex`, { method: 'POST' }).catch(() => ({}));
    if (r.success) {
      const stats = await somaBackend.fetch('/api/aperture/portal/stats').catch(() => ({}));
      if (stats.success) setDendriteStats(stats);
      setNotice(`${r.indexed} reindexed in Dendrite Search.`);
    } else setError(r.error || 'Reindex failed');
  };

  const legacyPublishGmnSite = async () => {
    if (!gmnEditor) return;
    setGmnEditorSaving(true);
    try {
      const r = await somaBackend.fetch('/api/gmn/sites/publish', {
        method: 'POST',
        body: JSON.stringify({ site: gmnEditor.site, html: gmnEditor.content || gmnEditor.html, title: gmnEditor.title, description: gmnEditor.description })
      });
      if (r.success) { loadGmnSites(); setGmnEditor(null); setNotice(`${gmnEditor.site}.gmn published.`); }
      else setError(r.error || 'Publish failed');
    } finally { setGmnEditorSaving(false); }
  };

  const createGmnSite = async () => {
    const name = gmnCreateName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!name) return;
    const template = GMN_TEMPLATES[gmnTemplate] || GMN_TEMPLATES.blank;
    const html = typeof template.html === 'function' ? template.html(name) : template.html;
    setGmnCreateBusy(true);
    try {
      const r = await somaBackend.fetch('/api/gmn/sites/publish', {
        method: 'POST',
        body: JSON.stringify({ site: name, html, title: name, description: template.description || '' })
      });
      if (r.success) { await loadGmnSites(); setGmnCreating(false); setGmnCreateName(''); setNotice(`${name}.gmn created.`); }
      else setError(r.error || 'Create failed');
    } finally { setGmnCreateBusy(false); }
  };

  const deleteGmnSite = async (siteName) => {
    if (!window.confirm(`Delete ${siteName}.gmn? This cannot be undone.`)) return;
    const r = await somaBackend.fetch(`/api/gmn/sites/${siteName}`, { method: 'DELETE' }).catch(() => ({}));
    if (r.success) { setGmnSites(prev => prev.filter(s => s.manifest?.site !== siteName)); setNotice(`${siteName}.gmn deleted.`); }
    else setError(r.error || 'Delete failed');
  };

  const repairGmnSecurity = async () => {
    const siteName = gmnSecInspector?.site;
    if (!siteName) return;
    const r = await somaBackend.fetch(`/api/gmn/sites/${siteName}/repair-security`, { method: 'POST' }).catch(() => ({}));
    if (r.success) {
      setGmnSecInspector(r.manifest);
      setGmnSecurityChanges(r.repaired || null);
      await loadGmnSites();
      setNotice(`${siteName}.gmn security policy repaired.`);
    } else {
      setError(r.error || 'Security repair failed');
    }
  };

  const openGmnRegistry = () => {
    loadGmnSites();
    const registryPage = {
      kind: 'gmn-registry', title: 'Gray Matter Network', address: 'portal://gmn',
      query: '', content: '', synthesis: '', sources: [], memoryHits: [], createdAt: Date.now()
    };
    openPage(registryPage, 'Opened GMN Registry');
    setInput('portal://gmn');
  };

  const checkIsUrl = (str) => {
    const trimmed = str.trim();
    if (trimmed.includes(' ')) return false;
    if (isGmnAddress(trimmed)) return true;
    if (/^(https?|file|portal):\/\//i.test(trimmed)) return true;
    if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(trimmed) || /^localhost(:[0-9]+)?(\/.*)?$/i.test(trimmed)) return true;
    return false;
  };

  function browseUrl(value) {
    let address = (value || input).trim();
    if (!address) return;
    clearSignals();

    if (address === 'portal://gmn') { openGmnRegistry(); return; }
    if (address === 'portal://home') { goHome(); return; }
    if (isGmnAddress(address)) {
      openGmnSite(address);
      return;
    }
    
    let isSearch = false;
    let searchQuery = '';
    if (checkIsUrl(address)) {
      if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
    } else {
      isSearch = true;
      searchQuery = address;
      address = `https://duckduckgo.com/?q=${encodeURIComponent(address)}`;
    }

    if (policy.networkAccess === false) {
      setError('Network access is disabled in Aperture Settings.');
      return;
    }

    // Auto-switch to reader capture mode when running outside of Electron
    if (!isElectron) {
      readUrl(address);
      return;
    }

    const hostname = new URL(address).hostname;
    const nextPage = {
      kind: 'browser',
      title: isSearch ? `Search: "${searchQuery}"` : hostname,
      address,
      query: searchQuery,
      content: '',
      synthesis: '',
      sources: [{ title: hostname, url: address, snippet: '' }],
      memoryHits: [],
      captured: false,
      createdAt: Date.now()
    };
    setMode('browse');
    openPage(nextPage, isSearch ? `Searched DuckDuckGo for "${searchQuery}"` : `Browsed ${nextPage.title}`);
    addLibraryItem(nextPage);
  }

  async function captureLivePage() {
    if (page.kind !== 'browser') return;
    const view = webviewRef.current;
    if (!view || !isElectron) return setError('Real page capture requires the Electron Aperture application.');
    clearSignals();
    setBusy('Capturing rendered page into Dendrite Search...');
    try {
      const captured = await view.executeJavaScript(`({
        title: document.title || location.hostname,
        url: location.href,
        content: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim().slice(0, 120000)
      })`, true);
      if (!captured.content) throw new Error('The rendered page did not expose readable content.');
      const indexed = await somaBackend.fetch('/api/aperture/portal/index', {
        method: 'POST',
        body: JSON.stringify({ url: captured.url, title: captured.title, content: captured.content, source: 'chromium-browser', isPrivate: activeTab?.isPrivate || false })
      });
      if (indexed.error || indexed.success === false) throw new Error(indexed.error || 'Dendrite Search indexing failed.');
      setTabs(previous => previous.map(tab => tab.id === activeTabId
        ? { ...tab, title: captured.title, page: { ...tab.page, title: captured.title, address: captured.url, content: captured.content, captured: true } }
        : tab));
      addTrail('Captured rendered page into Dendrite Search');
      setNotice('Rendered page captured in Dendrite Search.');
    } catch (reason) {
      setError(reason.message || 'Unable to capture this rendered page.');
    } finally {
      setBusy('');
    }
  }

  const submit = event => {
    event?.preventDefault();
    const query = input.trim();
    if (!query) return;

    if (query === 'portal://gmn') {
      openGmnRegistry();
    } else if (isGmnAddress(query)) {
      openGmnSite(query);
    } else if (checkIsUrl(query)) {
      browseUrl(query);
    } else {
      if (mode === 'browse') runPortalSearch(input);
      else if (mode === 'reader') readUrl(input);
      else if (mode === 'discover') runDiscovery(input);
      else runPortalSearch(input);
    }
  };

  // ─── SOMA Agency Bridge: remote navigation ────────────────────────────────
  // ApertureOS shell dispatches aperture:portal-navigate when SOMA wants to
  // browse. Ref keeps the handler bound to the latest closures; her requests
  // respect the same network-access policy as user-initiated browsing.
  const remoteNavRef = useRef(null);
  remoteNavRef.current = (query) => {
    if (!query) return;
    if (policy.networkAccess === false) { setError('SOMA requested navigation, but network access is disabled in Settings.'); return; }
    if (checkIsUrl(query)) browseUrl(query);
    else runPortalSearch(query);
  };
  useEffect(() => {
    const listener = (e) => remoteNavRef.current?.(e.detail?.query);
    window.addEventListener('aperture:portal-navigate', listener);
    return () => window.removeEventListener('aperture:portal-navigate', listener);
  }, []);

  const navigateHistory = offset => {
    if (page.kind === 'browser' && webviewRef.current) {
      if (offset < 0 && webviewRef.current.canGoBack()) webviewRef.current.goBack();
      if (offset > 0 && webviewRef.current.canGoForward()) webviewRef.current.goForward();
      return;
    }
    setTabs(previous => previous.map(tab => {
      if (tab.id !== activeTabId) return tab;
      const cursor = tab.cursor + offset;
      if (cursor < 0 || cursor >= tab.stack.length) return tab;
      return { ...tab, cursor, page: tab.stack[cursor], title: tab.stack[cursor].title };
    }));
  };

  const reload = () => page.kind === 'research'
    ? (page.acquisition === 'external' ? runDiscovery(page.query) : runPortalSearch(page.query))
    : page.kind === 'browser' && webviewRef.current ? webviewRef.current.reload()
      : page.kind === 'reader' ? readUrl(page.address) : null;

  const addTab = (isPrivate = false) => {
    const tab = newTab(isPrivate);
    setTabs(previous => [...previous, tab]);
    setActiveTabId(tab.id);
  };

  const goHome = () => {
    openPage(homePage(), 'Opened Portal home');
    setMode('index');
  };

  const closeTab = (event, id) => {
    event.stopPropagation();
    if (tabs.length === 1) return;
    const remaining = tabs.filter(tab => tab.id !== id);
    setTabs(remaining);
    if (id === activeTabId) setActiveTabId(remaining[0].id);
  };

  const toggleBookmark = async () => {
    if (page.kind === 'home') return;
    clearSignals();
    try {
      if (isSaved) {
        const existing = bookmarks.find(item => item.address === page.address);
        if (existing) {
          const res = await somaBackend.fetch(`/api/aperture/portal/bookmarks/${existing.id}`, {
            method: 'DELETE'
          });
          if (res.success) {
            setBookmarks(previous => previous.filter(item => item.address !== page.address));
            setNotice('Bookmark removed.');
          }
        }
      } else {
        const res = await somaBackend.fetch('/api/aperture/portal/bookmarks', {
          method: 'POST',
          body: JSON.stringify({
            title: page.title,
            address: page.address,
            kind: page.kind,
            query: page.query || ''
          })
        });
        if (res.success) {
          setBookmarks(previous => [res.bookmark, ...previous]);
          setNotice('Bookmark saved.');
        }
      }
    } catch (reason) {
      setError(reason.message || 'Failed to update bookmark.');
    }
  };

  const saveToMemory = async () => {
    if (!hasEvidence) return setError('Capture the live page into Dendrite Search before cataloging it.');
    clearSignals();
    setBusy('Cataloging in SOMA memory...');
    try {
      await executeTool('remember', { content: pageText(page), tags: 'portal,research,source-grounded' });
      addTrail('Cataloged page in SOMA memory');
      setNotice('Research cataloged in SOMA memory.');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const saveToReflections = async () => {
    if (!hasEvidence) return setError('Capture the live page into Dendrite Search before saving evidence.');
    clearSignals();
    const sources = page.sources.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join('\n');
    const text = `# Portal Research: ${page.title}\n\nCreated: ${new Date().toLocaleString()}\nWorkspace: ${workspace?.name || 'Aperture'}\nSource: ${page.address}\n\n## Findings\n\n${page.kind === 'research' ? page.synthesis : page.content}\n\n## Sources\n\n${sources || 'No external sources recorded.'}\n`;
    setBusy('Saving research artifact to Reflections...');
    try {
      const result = await somaBackend.fetch('/api/reflections/quick-note', {
        method: 'POST',
        body: JSON.stringify({
          title: `Portal - ${page.title}`.slice(0, 90),
          text,
          context: { source: 'aperture.portal', url: page.address, workspace: workspace?.name }
        })
      });
      if (result.error || result.success === false) throw new Error(result.error || 'Reflections save failed.');
      addTrail('Saved artifact to Reflections');
      setNotice('Saved to Reflections and routed into memory.');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const summarize = async () => {
    if (!hasEvidence) return setError('Capture the live page into Dendrite Search before summarizing it.');
    if (policy.somaReasoning === false) return setError('SOMA reasoning is disabled in Aperture Settings.');
    clearSignals();
    setBusy('Summarizing evidence...');
    try {
      const result = await somaBackend.sendChat(
        `Summarize this Portal artifact concisely. Separate supported findings from open questions. Do not add new facts.\n\n${pageText(page).slice(0, 10000)}`,
        { source: 'aperture_portal_summary', workspaceId: workspace?.id }
      );
      setSummary(responseText(result, 'No summary returned.'));
      addTrail('Generated source summary');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const askPage = async event => {
    event.preventDefault();
    const value = question.trim();
    if (!value || !hasEvidence) return;
    if (policy.somaReasoning === false) return setError('SOMA reasoning is disabled in Aperture Settings.');
    setQuestion('');
    setConversation(previous => [...previous, { role: 'user', text: value }]);
    setBusy('Reading page context...');
    try {
      const result = await somaBackend.sendChat(
        `Answer the question only from the Portal artifact below. Say when the artifact does not contain the answer.\n\nQuestion: ${value}\n\nArtifact:\n${pageText(page).slice(0, 12000)}`,
        { source: 'aperture_portal_qa', workspaceId: workspace?.id }
      );
      setConversation(previous => [...previous, { role: 'soma', text: responseText(result, 'No answer returned.') }]);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const portalSteveContext = () => ({
    source: 'aperture.portal.steve',
    workspaceId: workspace?.id,
    workspaceName: workspace?.name,
    activePage: {
      kind: page.kind,
      title: page.title,
      address: page.address,
      query: page.query || '',
      hasEvidence,
      sourceCount: page.sources?.length || 0,
      memoryHitCount: page.memoryHits?.length || 0
    },
    portalMode: mode,
    dendriteStats,
    gmnSites: gmnSites.slice(0, 8).map(site => site.canonical)
  });

  const sendToSteve = async (event, override) => {
    event?.preventDefault?.();
    const value = (override || steveInput).trim();
    if (!value || steveThinking) return;
    if (policy.somaReasoning === false) return setError('SOMA reasoning is disabled in Aperture Settings.');
    setSteveInput('');
    setSteveMessages(previous => [...previous, { role: 'user', text: value, ts: Date.now() }]);
    setSteveThinking(true);
    try {
      let evidence = hasEvidence ? pageText(page).slice(0, 10000) : 'No captured evidence is available yet.';
      if (page.kind === 'browser' && webviewRef.current) {
        try {
          const scraped = await webviewRef.current.executeJavaScript(`
            (document.body ? document.body.innerText : '').slice(0, 15000)
          `);
          if (scraped && scraped.trim()) {
            evidence = `Live Scraped Content of current page:\n${scraped}`;
          }
        } catch (err) {
          console.warn('[Portal] Failed to scrape webview live contents:', err);
        }
      }
      const result = await somaBackend.fetch('/api/soma/steve/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: [
            value,
            '',
            'Portal context:',
            JSON.stringify(portalSteveContext(), null, 2),
            '',
            'Open artifact:',
            evidence
          ].join('\n'),
          history: steveMessages.slice(-8).map(message => ({
            role: message.role === 'user' ? 'user' : 'assistant',
            content: message.text
          })),
          context: portalSteveContext()
        })
      });
      if (result.error || result.success === false) throw new Error(result.error || 'Steve failed to answer.');
      setSteveMessages(previous => [...previous, {
        role: 'steve',
        text: responseText(result, 'Steve returned no response.'),
        ts: Date.now(),
        actions: result.actions || [],
        updatedFiles: result.updatedFiles || []
      }]);
      addTrail('Asked Steve for Portal guidance');
    } catch (reason) {
      setSteveMessages(previous => [...previous, {
        role: 'steve',
        text: `Steve link failed: ${reason.message}`,
        ts: Date.now(),
        failed: true
      }]);
    } finally {
      setSteveThinking(false);
    }
  };

  const queueStevePortalTask = async description => {
    if (!description || steveThinking) return;
    clearSignals();
    setSteveThinking(true);
    try {
      const result = await somaBackend.fetch('/api/soma/steve/task', {
        method: 'POST',
        body: JSON.stringify({
          task: `${description}\n\nPortal context:\n${JSON.stringify(portalSteveContext(), null, 2)}`,
          source: 'aperture.portal'
        })
      });
      if (result.error || result.success === false) throw new Error(result.error || 'Steve rejected the task.');
      setNotice('Steve accepted the Portal task.');
      setSteveMessages(previous => [...previous, {
        role: 'steve',
        text: `Queued: ${description}`,
        ts: Date.now()
      }]);
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSteveThinking(false);
    }
  };

  const extractTasks = async () => {
    if (!hasEvidence) return setError('Capture the live page into Dendrite Search before extracting tasks.');
    if (policy.somaReasoning === false) return setError('SOMA reasoning is disabled in Aperture Settings.');
    clearSignals();
    setBusy('Extracting practical actions...');
    try {
      const result = await somaBackend.sendChat(
        `Extract only concrete actionable tasks supported by this research. Return one task per line prefixed "- ". If there are no actions, return "No actionable tasks."\n\n${pageText(page).slice(0, 10000)}`,
        { source: 'aperture_portal_tasks', workspaceId: workspace?.id }
      );
      const parsed = responseText(result, '').split('\n')
        .filter(line => /^\s*[-*]\s+/.test(line))
        .map(line => line.replace(/^\s*[-*]\s+/, '').trim());
      setTasks(parsed);
      setNotice(parsed.length ? `${parsed.length} task candidates extracted.` : 'No concrete tasks found.');
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy('');
    }
  };

  const createTask = async task => {
    if (!projectId) return setError('Select an Axis project first.');
    clearSignals();
    try {
      const result = await somaBackend.fetch(`/api/axis/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: task,
          description: `Created from Portal research: ${page.title}\n${page.address}`,
          priority: 'medium',
          tags: ['portal', 'research'],
          workspaceId: workspace?.id
        })
      });
      if (result.error || result.ok === false) throw new Error(result.error || 'Unable to create Axis task.');
      setNotice('Task sent to Axis.');
    } catch (reason) {
      setError(reason.message);
    }
  };

  const revisit = entry => {
    if (entry.kind === 'gmn' || isGmnAddress(entry.address)) return openGmnSite(entry.address);
    if (entry.kind === 'research') {
      return entry.address.includes('/discover/') ? runDiscovery(entry.query) : runPortalSearch(entry.query);
    }
    return entry.kind === 'browser' ? browseUrl(entry.address) : readUrl(entry.address);
  };

  const getTabIcon = (tab) => {
    if (tab.isPrivate) return EyeOff;
    const title = (tab.title || '').toLowerCase();
    const url = (tab.page?.address || '').toLowerCase();
    if (title.includes('spotify') || url.includes('spotify.com')) return Music;
    if (title.includes('figma') || url.includes('figma.com')) return LayoutGrid;
    if (title.includes('community') || url.includes('community')) return Users;
    if (tab.page?.kind === 'research') return Sparkles;
    if (tab.page?.kind === 'reader') return FileText;
    if (tab.page?.kind === 'browser') return Globe2;
    return File;
  };

  const closeFindBar = useCallback(() => {
    updateWebviewState(activeTabId, { showFindBar: false });
    if (webviewRef.current) {
      webviewRef.current.stopFindInPage('clearSelection');
    }
  }, [activeTabId, updateWebviewState]);

  const toggleDarkMode = useCallback(() => {
    if (!webviewRef.current) return;
    const isDark = !activeTabState.forceDark;
    updateWebviewState(activeTabId, { forceDark: isDark });
    if (isDark) {
      webviewRef.current.executeJavaScript(`
        if (!document.getElementById('soma-dark-reader')) {
          const style = document.createElement('style');
          style.id = 'soma-dark-reader';
          style.innerHTML = 'html { filter: invert(1) hue-rotate(180deg) !important; } img, video, iframe, canvas { filter: invert(1) hue-rotate(180deg) !important; }';
          document.head.appendChild(style);
        }
      `).catch(() => {});
    } else {
      webviewRef.current.executeJavaScript(`
        const style = document.getElementById('soma-dark-reader');
        if (style) style.remove();
      `).catch(() => {});
    }
  }, [activeTabId, activeTabState.forceDark, updateWebviewState]);

  // Keyboard Shortcuts Hook
  useEffect(() => {
    const handleShortcuts = (e) => {
      // Ctrl + F: Toggle Find Bar
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        if (page.kind === 'browser') {
          const shown = !activeTabState.showFindBar;
          updateWebviewState(activeTabId, { showFindBar: shown });
          if (!shown && webviewRef.current) {
            webviewRef.current.stopFindInPage('clearSelection');
          }
          if (shown) {
            setTimeout(() => {
              document.getElementById(`find-input-${activeTabId}`)?.focus();
            }, 100);
          }
        }
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        if (e.key === 'Escape') {
          e.target.blur();
          if (activeTabState.showFindBar) {
            closeFindBar();
          }
        }
        return;
      }

      // Escape key to close Find Bar
      if (e.key === 'Escape' && activeTabState.showFindBar) {
        e.preventDefault();
        closeFindBar();
      }

      // Ctrl + T: New Tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 't') {
        e.preventDefault();
        addTab();
      }

      // Ctrl + W: Close Active Tab
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        if (tabs.length > 1) {
          closeTab(e, activeTabId);
        }
      }

      // Ctrl + R / F5: Reload Page
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault();
        reload();
      }

      // Alt + LeftArrow: Go Back
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        if (canBack) navigateHistory(-1);
      }

      // Alt + RightArrow: Go Forward
      if (e.altKey && e.key === 'ArrowRight') {
        e.preventDefault();
        if (canForward) navigateHistory(1);
      }

      // Ctrl + = / Ctrl + +: Zoom In
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        if (webviewRef.current && typeof webviewRef.current.getZoomLevel === 'function') {
          webviewRef.current.getZoomLevel(level => {
            webviewRef.current.setZoomLevel(Math.min(9, level + 0.5));
          });
        }
      }

      // Ctrl + -: Zoom Out
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault();
        if (webviewRef.current && typeof webviewRef.current.getZoomLevel === 'function') {
          webviewRef.current.getZoomLevel(level => {
            webviewRef.current.setZoomLevel(Math.max(-9, level - 0.5));
          });
        }
      }

      // Ctrl + 0: Reset Zoom
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        if (webviewRef.current && typeof webviewRef.current.setZoomLevel === 'function') {
          webviewRef.current.setZoomLevel(0);
        }
      }
    };

    window.addEventListener('keydown', handleShortcuts);
    return () => {
      window.removeEventListener('keydown', handleShortcuts);
    };
  }, [tabs.length, activeTabId, canBack, canForward, page.kind, activeTabState.showFindBar, activeTabState.findText, closeFindBar, updateWebviewState]);

  // Keep gmnNavRef current so the stable message handler always has fresh closures
  useEffect(() => { gmnNavRef.current = { openGmnSite, browseUrl }; });

  // GMN postMessage bridge — receives click events and RPCs from inside sandboxed GMN iframes
  useEffect(() => {
    const handler = async (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === 'gmn-navigate') gmnNavRef.current?.openGmnSite(e.data.href);
      else if (e.data.type === 'portal-navigate') gmnNavRef.current?.browseUrl(e.data.href);
      else if (e.data.type === 'gmn-rpc') {
        const { id, route, method, body } = e.data;
        // Strictly allow-list only studio endpoints for now
        if (route && route.startsWith('/api/studio/')) {
          try {
            const url = `http://127.0.0.1:3001${route}`;
            const res = await fetch(url, {
              method: method || 'GET',
              headers: body ? { 'Content-Type': 'application/json' } : undefined,
              body: body ? JSON.stringify(body) : undefined
            });
            const result = await res.json().catch(() => null);
            e.source.postMessage({ type: 'gmn-rpc-response', id, result, status: res.status }, '*');
          } catch (err) {
            e.source.postMessage({ type: 'gmn-rpc-response', id, error: err.message, status: 500 }, '*');
          }
        } else {
          e.source.postMessage({ type: 'gmn-rpc-response', id, error: 'Forbidden RPC Route', status: 403 }, '*');
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className={`portal ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${activeTab?.isPrivate ? 'incognito' : ''}`}>
      {/* Sleek top header bar spanning across the window */}
      <header className="portal-header-bar">
        <div className="portal-header-left">
          <div className="portal-header-logo">
            <div className="portal-logo-dot" />
            <span className="portal-logo-text">Portal</span>
          </div>
          <div className="portal-header-nav">
            <button type="button" disabled={!canBack} onClick={() => navigateHistory(-1)} title="Back">
              <ArrowLeft size={14} />
            </button>
            <button type="button" disabled={!canForward} onClick={() => navigateHistory(1)} title="Forward">
              <ArrowRight size={14} />
            </button>
            {activeTabState.loading ? (
              <button type="button" onClick={() => webviewRef.current?.stop()} title="Stop Loading">
                <X size={13} />
              </button>
            ) : (
              <button type="button" disabled={page.kind === 'home'} onClick={reload} title="Refresh">
                <RefreshCw size={13} />
              </button>
            )}
            <button type="button" onClick={goHome} title="Home">
              <Home size={14} />
            </button>
          </div>
        </div>

        <div className="portal-header-center">
          <form className="portal-header-address-form" onSubmit={submit}>
            <button type="button" className="portal-header-mode-btn" onClick={() => {
              const modes = ['index', 'browse', 'discover', 'reader'];
              const next = modes[(modes.indexOf(mode) + 1) % modes.length];
              setMode(next);
            }}>
              {mode === 'index' && <Library size={12} title="Index Search" />}
              {mode === 'browse' && <Globe2 size={12} title="Live Browser" />}
              {mode === 'discover' && <Sparkles size={12} title="Discover Research" />}
              {mode === 'reader' && <FileText size={12} title="Reader View" />}
            </button>
            {mode === 'browse' && (
              <>
                {(input.startsWith('https://') || page.address.startsWith('https://')) && (
                  <div className="portal-header-security-badge secure" title="Secure HTTPS Connection" onClick={() => setShowPermissionsPopover(!showPermissionsPopover)}>
                    <Lock size={10} className="portal-security-lock-icon" />
                    <span>Secure</span>
                  </div>
                )}
                {(input.startsWith('http://') || page.address.startsWith('http://')) && (
                  <div className="portal-header-security-badge insecure" title="Insecure Connection" onClick={() => setShowPermissionsPopover(!showPermissionsPopover)}>
                    <Unlock size={10} className="portal-security-lock-icon" />
                    <span>Not Secure</span>
                  </div>
                )}
                {(input.startsWith('gmn://') || page.address.startsWith('gmn://')) && (
                  <div className="portal-header-security-badge gmn" title="GMN Sandbox Network" onClick={() => setShowPermissionsPopover(!showPermissionsPopover)}>
                    <DatabaseZap size={10} className="portal-security-lock-icon" />
                    <span>GMN Sandbox</span>
                  </div>
                )}
                {!input.startsWith('https://') && !page.address.startsWith('https://') &&
                 !input.startsWith('http://') && !page.address.startsWith('http://') &&
                 !input.startsWith('gmn://') && !page.address.startsWith('gmn://') && (
                  <div className="portal-header-security-badge portal" title="Local Portal System" onClick={() => setShowPermissionsPopover(!showPermissionsPopover)}>
                    <ShieldCheck size={10} className="portal-security-lock-icon" />
                    <span>Local Portal</span>
                  </div>
                )}
              </>
            )}
            <input
              value={input}
              onChange={event => setInput(event.target.value)}
              placeholder={
                mode === 'browse' ? 'Search or enter address...' :
                mode === 'reader' ? 'Enter URL for reader capture...' :
                mode === 'discover' ? 'Discover external sources...' :
                'Search Dendrite Search...'
              }
            />
            {mode === 'browse' && page.kind === 'browser' && (
              <>
                <button
                  type="button"
                  className={`portal-header-private-toggle-btn ${activeTab.isPrivate ? 'active' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    togglePrivateMode();
                  }}
                  title={activeTab.isPrivate ? "Disable Private Browsing" : "Enable Private Browsing"}
                >
                  <EyeOff size={13} className={activeTab.isPrivate ? 'portal-private-icon active' : 'portal-private-icon'} />
                </button>
                <button
                  type="button"
                  className={`portal-header-key-btn ${activeCredentials.length > 0 ? 'saved' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowCredentialsPopover(!showCredentialsPopover);
                  }}
                  title="Saved logins for this site"
                >
                  <Key size={13} fill={activeCredentials.length > 0 ? "#c084fc" : "none"} />
                </button>
                <button
                  type="button"
                  className="portal-header-reader-toggle-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    readUrl(page.address);
                  }}
                  title="Open in Reader Mode"
                >
                  <BookOpen size={13} />
                </button>
              </>
            )}
            {page.kind !== 'home' && (
              <button
                type="button"
                className={`portal-header-bookmark-btn ${isSaved ? 'saved' : ''}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleBookmark();
                }}
                title={isSaved ? "Remove Bookmark" : "Bookmark this page"}
              >
                <Star size={13} fill={isSaved ? "#c084fc" : "none"} />
              </button>
            )}
          </form>
        </div>

        <div className="portal-header-right">
          {page.kind === 'browser' && (
            <button
              type="button"
              className={`portal-header-dark-btn ${activeTabState.forceDark ? 'active' : ''}`}
              onClick={toggleDarkMode}
              title={activeTabState.forceDark ? "Disable Dark Mode" : "Enable Dark Mode"}
            >
              <Moon size={14} />
            </button>
          )}
          {page.kind === 'browser' && (
            <button
              type="button"
              className="portal-header-devtools-btn"
              onClick={() => webviewRef.current?.openDevTools()}
              title="Open Developer Tools"
            >
              <Code2 size={14} />
            </button>
          )}
          <button
            type="button"
            className={`portal-header-downloads-btn ${showDownloadsTray ? 'active' : ''}`}
            onClick={() => setShowDownloadsTray(!showDownloadsTray)}
            title="Downloads"
          >
            <Download size={14} />
            {activeDownloadsCount > 0 && <span className="portal-downloads-badge">{activeDownloadsCount}</span>}
          </button>
          <button type="button" className={`portal-header-assist-toggle ${showAssistPanel ? 'active' : ''}`} onClick={() => setShowAssistPanel(!showAssistPanel)} title="Toggle SOMA Assist">
            <Brain size={14} />
          </button>
          <button type="button" className="portal-header-settings-btn" title="Settings">
            <Settings size={14} />
          </button>
          <div className="portal-header-profile">
            <User size={13} />
          </div>
        </div>
      </header>

      {/* Premium Browser Popovers */}
      {showPermissionsPopover && sitePermissions && activeOrigin && (
        <div className="portal-permissions-popover">
          <div className="popover-header">
            <strong>Site Permissions</strong>
            <small>{activeOrigin.replace(/^https?:\/\//, '')}</small>
          </div>
          <div className="popover-body">
            {['camera', 'microphone', 'location', 'notifications', 'clipboard'].map(perm => (
              <div key={perm} className="permission-row">
                <span>{perm.charAt(0).toUpperCase() + perm.slice(1)}</span>
                <select
                  value={sitePermissions[perm] || 'ask'}
                  onChange={(e) => handleUpdatePermission(perm, e.target.value)}
                >
                  <option value="allow">Allow</option>
                  <option value="deny">Deny</option>
                  <option value="ask">Ask</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {showCredentialsPopover && activeOrigin && (
        <div className="portal-credentials-popover">
          <div className="popover-header">
            <strong>Saved Logins</strong>
            <button className="add-login-toggle-btn" onClick={() => setShowAddCredential(!showAddCredential)}>
              {showAddCredential ? 'View Saved' : 'Add New'}
            </button>
          </div>
          <div className="popover-body">
            {showAddCredential ? (
              <div className="add-credential-form">
                <input
                  type="text"
                  placeholder="Username / Email"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
                <button type="button" onClick={handleSaveCredential} className="save-credential-btn">
                  Save Login
                </button>
              </div>
            ) : (
              <div className="credentials-list">
                {activeCredentials.map(cred => (
                  <div key={cred.id} className="credential-item">
                    <div className="cred-details">
                      <strong>{cred.username}</strong>
                      <span>••••••••</span>
                    </div>
                    <div className="cred-actions">
                      <button type="button" className="autofill-btn" onClick={() => handleAutofillCredential(cred.username, cred.password)}>
                        Autofill
                      </button>
                      <button type="button" className="delete-cred-btn" onClick={() => handleDeleteCredential(cred.id)}>
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                ))}
                {activeCredentials.length === 0 && (
                  <p className="no-credentials-msg">No credentials saved for this site.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showDownloadsTray && (
        <div className="portal-downloads-tray">
          <div className="tray-header">
            <strong>Downloads</strong>
            <button className="close-tray-btn" onClick={() => setShowDownloadsTray(false)}>
              <X size={12} />
            </button>
          </div>
          <div className="tray-body">
            {downloads.map(d => {
              const pct = d.total_bytes ? Math.round((d.received_bytes / d.total_bytes) * 100) : 0;
              return (
                <div key={d.id} className="download-item">
                  <div className="download-info">
                    <span className="file-name" title={d.filename}>{d.filename}</span>
                    <span className="download-url" title={d.url}>{d.url}</span>
                  </div>
                  {d.state === 'progress' && (
                    <div className="download-progress-container">
                      <div className="download-progress-bar">
                        <div className="progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="progress-details">
                        <span>{pct}% ({Math.round(d.received_bytes / 1024)} KB / {Math.round(d.total_bytes / 1024)} KB)</span>
                      </div>
                    </div>
                  )}
                  {d.state === 'completed' && (
                    <div className="download-status completed">
                      <span className="status-badge">Completed</span>
                      <span className="save-path" title={d.save_path}>{d.save_path}</span>
                      <button className="copy-path-btn" onClick={() => { navigator.clipboard.writeText(d.save_path); setNotice('Save path copied.'); }}>
                        Copy Path
                      </button>
                    </div>
                  )}
                  {d.state === 'failed' && (
                    <div className="download-status failed">
                      <span className="status-badge">Failed</span>
                      <span className="error-msg" title={d.error_message}>{d.error_message}</span>
                    </div>
                  )}
                  <button className="delete-download-btn" onClick={() => handleDeleteDownload(d.id)} title="Delete history entry">
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
            {downloads.length === 0 && (
              <p className="no-downloads-msg">No downloads in history.</p>
            )}
          </div>
        </div>
      )}
      {showProgressBar && (
        <div className="portal-progress-bar-container">
          <div className="portal-progress-bar-fill" style={{ width: `${loadProgress}%` }} />
        </div>
      )}

      <div className="portal-container">
        {/* Left sectioned sidebar */}
        <aside className="portal-tabs-sidebar">
          <div className="portal-sidebar-scroll">
            {/* Workspaces Section */}
            <div className="portal-sidebar-section">
              <button type="button" className="portal-sidebar-section-header" onClick={() => setWorkspacesExpanded(!workspacesExpanded)}>
                {workspacesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>Workspaces</span>
              </button>
              {workspacesExpanded && (
                <div className="portal-sidebar-section-content">
                  {workspacesList.map(w => {
                    let WIcon = Folder;
                    if (w.name.toLowerCase().includes('design')) WIcon = LayoutGrid;
                    if (w.name.toLowerCase().includes('personal')) WIcon = User;
                    return (
                      <button
                        key={w.id}
                        type="button"
                        className={`portal-sidebar-item ${workspace?.id === w.id ? 'selected' : ''}`}
                        onClick={() => onSettingsUpdate?.({ activeWorkspaceId: w.id })}
                      >
                        <WIcon size={13} />
                        <span>{w.name}</span>
                      </button>
                    );
                  })}
                  {!workspacesList.length && (
                    <button type="button" className="portal-sidebar-item" onClick={() => {}}>
                      <User size={13} />
                      <span>Personal</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Bookmarks Section */}
            <div className="portal-sidebar-section">
              <button type="button" className="portal-sidebar-section-header" onClick={() => setBookmarksExpanded(!bookmarksExpanded)}>
                {bookmarksExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>Bookmarks</span>
              </button>
              {bookmarksExpanded && (
                <div className="portal-sidebar-section-content">
                  {bookmarks.map(b => (
                    <button
                      key={b.address}
                      type="button"
                      className={`portal-sidebar-item ${page.address === b.address ? 'selected' : ''}`}
                      onClick={() => browseUrl(b.address)}
                    >
                      <Bookmark size={13} />
                      <span>{b.title}</span>
                    </button>
                  ))}
                  {!bookmarks.length && <span className="portal-sidebar-empty">No bookmarks saved</span>}
                </div>
              )}
            </div>

            {/* Open Tabs Section */}
            <div className="portal-sidebar-section">
              <button type="button" className="portal-sidebar-section-header" onClick={() => setTabsExpanded(!tabsExpanded)}>
                {tabsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <span>Open Tabs</span>
              </button>
              {tabsExpanded && (
                <div className="portal-sidebar-section-content">
                  {tabs.map(tab => {
                    const TabIcon = getTabIcon(tab);
                    const tabFavicon = getFaviconUrl(tab);
                    const isTabLoading = webviewStates[tab.id]?.loading;
                    return (
                      <div key={tab.id} className="portal-sidebar-tab-row">
                        <button
                          type="button"
                          className={`portal-sidebar-item ${tab.id === activeTabId ? 'selected' : ''}`}
                          onClick={() => setActiveTabId(tab.id)}
                        >
                          {isTabLoading ? (
                            <div className="portal-sidebar-tab-loading-spinner" title="Loading..." />
                          ) : tabFavicon ? (
                            <img
                              src={tabFavicon}
                              className="portal-sidebar-favicon"
                              alt=""
                              onError={(e) => {
                                // Fallback if image fails to load
                                e.target.style.display = 'none';
                              }}
                            />
                          ) : (
                            <TabIcon size={13} />
                          )}
                          <span>{tab.title}</span>
                        </button>
                        {tabs.length > 1 && (
                          <button
                            type="button"
                            className="portal-sidebar-tab-close"
                            onClick={event => {
                              event.stopPropagation();
                              closeTab(event, tab.id);
                            }}
                          >
                            <X size={10} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  <button type="button" className="portal-sidebar-add-tab-btn" onClick={addTab}>
                    <Plus size={13} />
                    <span>New Tab</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="portal-sidebar-footer">
            <div className="portal-trust-badge">
              <ShieldCheck size={12} />
              <span>Source-grounded</span>
            </div>
          </div>
        </aside>

        {/* Main portal container */}
        <div className="portal-main">
          {(busy || notice || error) && (
            <div className={`portal-banner ${error ? 'error' : notice ? 'notice' : ''}`}>
              {busy && <RefreshCw size={13} className="spinning" />}
              {error || notice || busy}
              {(error || notice) && <button type="button" onClick={clearSignals}><X size={13} /></button>}
            </div>
          )}

          <div className="portal-body">
            <main className="portal-document">
              {page.kind === 'home' && (
                <section className="portal-home">
                  <Compass size={37} />
                  <h1>Portal</h1>
                  <p>A local-first research browser powered by Dendrite Search. Acquire pages deliberately, search your own evidence, then save findings into Reflections or Axis.</p>
                  <form onSubmit={submit} className="portal-home-search">
                    <Search size={17} />
                    <input autoFocus value={input} onChange={event => setInput(event.target.value)} placeholder="Search Dendrite Search..." />
                    <button type="submit">Search</button>
                    <button type="button" onClick={() => runPortalCrawl(input)} title="Acquire new pages into Dendrite Search">
                      <DatabaseZap size={14} /> Acquire
                    </button>
                  </form>

                  {/* Curated Speed Dial Quick Access */}
                  <div className="portal-speed-dial">
                    <h3>Quick Access</h3>
                    <div className="portal-speed-dial-grid">
                      {SPEED_DIAL_SITES.map(site => {
                        const domain = new URL(site.url).hostname;
                        const siteFavicon = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                        return (
                          <button
                            key={site.url}
                            type="button"
                            className="portal-speed-dial-card"
                            onClick={() => browseUrl(site.url)}
                          >
                            <div className="portal-speed-dial-icon-wrap" style={{ borderLeft: `3px solid ${site.color}` }}>
                              <img
                                src={siteFavicon}
                                alt=""
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                }}
                              />
                              <span className="portal-speed-dial-fallback-char">{site.name[0]}</span>
                            </div>
                            <div className="portal-speed-dial-info">
                              <strong>{site.name}</strong>
                              <span>{site.desc}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="portal-home-grid">
                    <section>
                      <h3><Bookmark size={13} /> Bookmarks</h3>
                      {!bookmarks.length && <p className="portal-empty">Bookmark researched sources here.</p>}
                      {bookmarks.slice(0, 5).map(item => <button key={item.address} onClick={() => browseUrl(item.address)}>{item.title}<small>{item.address}</small></button>)}
                    </section>
                    <section>
                      <h3><History size={13} /> Research Library</h3>
                      {!library.length && <p className="portal-empty">Completed searches appear here.</p>}
                      {library.slice(0, 5).map(item => <button key={item.id} onClick={() => revisit(item)}>{item.title}<small>{new Date(item.createdAt).toLocaleDateString()}</small></button>)}
                    </section>
                  </div>

                  {/* GMN Home Section */}
                  <div className="portal-home-gmn">
                    <div className="phg-header" onClick={openGmnRegistry} style={{cursor:'pointer'}}>
                      <DatabaseZap size={14} />
                      <h3>Gray Matter Network</h3>
                      <span className="phg-stat">{dendriteStats.indexedPages || 0} pages indexed</span>
                      <label className="phg-new-btn" onClick={e => e.stopPropagation()}>
                        <Upload size={12} /> Import
                        <input type="file" accept=".zip,application/zip" hidden onChange={e => importGmnSite(e.target.files?.[0])} />
                      </label>
                      <button type="button" className="phg-new-btn" onClick={e => { e.stopPropagation(); setSideTab('gmn'); setShowAssistPanel(true); setGmnCreating(true); loadGmnSites(); }}>
                        <Plus size={12} /> New Site
                      </button>
                    </div>
                    {!gmnSites.length && (
                      <p className="portal-empty" style={{ paddingLeft: 0 }}>No local GMN sites yet. Create your first sandboxed intranet page.</p>
                    )}
                    <div className="phg-grid">
                      {gmnSites.slice(0, 6).map(site => (
                        <button key={site.canonical} type="button" className="phg-card" onClick={() => openGmnSite(site.canonical)}>
                          <div className="phg-card-icon"><DatabaseZap size={16} /></div>
                          <div className="phg-card-body">
                            <strong>{site.canonical}</strong>
                            <span>{site.manifest?.description || 'Local GMN site'}</span>
                          </div>
                          <div className="phg-card-actions" onClick={e => e.stopPropagation()}>
                            <button type="button" title="Edit" onClick={() => openGmnEditor(site.manifest?.site)}><Code2 size={11} /></button>
                            <button type="button" title="Security" onClick={() => setGmnSecInspector(site.manifest)}><Lock size={11} /></button>
                          </div>
                        </button>
                      ))}
                    </div>
                    {gmnSites.length > 6 && (
                      <button type="button" className="phg-see-all" onClick={() => { setSideTab('gmn'); setShowAssistPanel(true); loadGmnSites(); }}>
                        See all {gmnSites.length} GMN sites
                      </button>
                    )}
                  </div>
                </section>
              )}

              {page.kind === 'research' && (
                <article className="portal-report">
                  <header>
                    <span><Brain size={13} /> {page.acquisition === 'external' ? 'External discovery synthesis' : 'Dendrite Search synthesis'}</span>
                    <h1>{page.query}</h1>
                    <div className="portal-metrics">
                      <b>{portalStats.sources} {page.acquisition === 'external' ? 'discovered' : 'indexed'} sources</b>
                      <b>{portalStats.memories} memory references</b>
                    </div>
                  </header>
                  <section className="portal-prose">{page.synthesis}</section>
                  <h2>{page.acquisition === 'external' ? 'Discovered Sources - Open To Index' : 'Dendrite Search Sources'}</h2>
                  <div className="portal-source-grid">
                    {page.sources.length === 0 && <p className="portal-empty">No source results returned.</p>}
                    {page.sources.map((source, index) => {
                      const isGmn = source.url?.startsWith('gmn://') || source.source === 'gmn:site';
                      const host = isGmn
                        ? source.url.replace('gmn://', '')
                        : (() => { try { return new URL(source.url).hostname; } catch { return source.url; } })();
                      return (
                        <button key={source.url} onClick={() => isGmn ? openGmnSite(source.url) : browseUrl(source.url)}>
                          <small>{isGmn && <span className="portal-dendrite-gmn-badge">GMN</span>}[{index + 1}] {host}</small>
                          <strong>{source.title}</strong>
                          <p>{source.snippet || 'Open reader extraction for content.'}</p>
                          <ExternalLink size={12} />
                        </button>
                      );
                    })}
                  </div>
                </article>
              )}

              {page.kind === 'reader' && (
                <article className="portal-report">
                  <header>
                    <span><Globe2 size={13} /> Reader extraction</span>
                    <h1>{page.title}</h1>
                    <a href={page.address} target="_blank" rel="noreferrer">{page.address}<ExternalLink size={12} /></a>
                  </header>
                  <section className="portal-prose reader">{page.content}</section>
                </article>
              )}

              {page.kind === 'gmn-registry' && (
                <section className="portal-gmn-registry">
                  <div className="pgmr-header">
                    <DatabaseZap size={26} />
                    <div>
                      <h1>Gray Matter Network</h1>
                      <p>Local intranet — sandboxed, Dendrite-indexed, resolved outside public DNS.</p>
                    </div>
                    <button type="button" className="pgm-new-btn" onClick={() => { setSideTab('gmn'); setShowAssistPanel(true); setGmnCreating(true); loadGmnSites(); }}>
                      <Plus size={12} /> New Site
                    </button>
                    <label className="pgm-new-btn">
                      <Upload size={12} /> Import
                      <input type="file" accept=".zip,application/zip" hidden onChange={e => importGmnSite(e.target.files?.[0])} />
                    </label>
                  </div>
                  <div className="pgmr-stats">
                    <span><strong>{sortGmnSites(gmnSites).length}</strong> local sites</span>
                    <span><strong>{dendriteStats.indexedPages || 0}</strong> dendrite pages</span>
                    <span><strong>{dendriteStats.bySource?.length || 0}</strong> source classes</span>
                  </div>
                  {!gmnSites.length && <p className="portal-empty" style={{paddingLeft:0, marginTop: 16}}>No local GMN sites. Create your first sandboxed page.</p>}
                  <div className="pgmr-grid">
                    {sortGmnSites(gmnSites).map(site => (
                      <div key={site.canonical} className="pgmr-card">
                        <div className="pgmr-card-top" onClick={() => openGmnSite(site.canonical)}>
                          <div className="pgmr-icon"><DatabaseZap size={16} /></div>
                          <div className="pgmr-info">
                            <strong>{site.canonical}</strong>
                            <span>{site.manifest?.description || 'Local GMN site'}</span>
                          </div>
                          <span className="pgmr-indexed-badge">Indexed</span>
                        </div>
                        <div className="pgmr-meta">
                          <span>Updated {site.manifest?.updatedAt ? new Date(site.manifest.updatedAt).toLocaleDateString() : '—'}</span>
                          <div className="pgmr-actions">
                            <button type="button" onClick={() => openGmnSite(site.canonical)}><Globe2 size={11} /> Open</button>
                            <button type="button" onClick={() => openGmnEditor(site.manifest?.site)}><Code2 size={11} /> Edit</button>
                            <button type="button" onClick={() => setGmnSecInspector(site.manifest)}><Lock size={11} /> Security</button>
                            <button type="button" onClick={() => reindexGmnSite(site.manifest?.site)}><DatabaseZap size={11} /> Index</button>
                            <button type="button" onClick={() => exportGmnSite(site.manifest?.site)}><Download size={11} /> Export</button>
                            <button type="button" onClick={() => { navigator.clipboard?.writeText(`gmn://${site.canonical}`); setNotice('Address copied.'); }}><Copy size={11} /> Copy</button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {page.kind === 'gmn' && (
                <section className="portal-gmn-site">
                  <div className="portal-gmn-status">
                    <span><DatabaseZap size={13} /> GMN Site</span>
                    <strong>{page.canonical || page.address}</strong>
                    <small>{page.source || 'local'} · {page.manifest?.constructType || 'portal:construct:gmn-site'}</small>
                  </div>
                  <div className="portal-gmn-actions">
                    <button type="button" onClick={() => openGmnSite(page.address)}><RefreshCw size={11} /> Reload</button>
                    <button type="button" onClick={() => openGmnEditor(page.manifest?.site)}><Code2 size={11} /> Edit</button>
                    <button type="button" onClick={() => setGmnSecInspector(page.manifest)}><Lock size={11} /> Security</button>
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(`gmn://${page.canonical}`); setNotice('Address copied.'); }}><Copy size={11} /> Copy Address</button>
                    <button type="button" onClick={openGmnRegistry}><DatabaseZap size={11} /> Registry</button>
                  </div>
                  <iframe
                    title={page.title}
                    sandbox="allow-scripts"
                    srcDoc={page.html}
                  />
                </section>
              )}

              {isElectron && (
                <section
                  className="portal-browser"
                  style={{ display: page.kind === 'browser' ? 'flex' : 'none', height: '100%', minHeight: '360px', flexDirection: 'column', margin: '-25px', background: '#111417' }}
                >
                  <div className="portal-browser-status">
                    <span>{activeTabState.loading ? 'Loading rendered page...' : page.captured ? 'Captured in Dendrite Search' : 'Live page - not indexed yet'}</span>
                    <button type="button" onClick={captureLivePage}><Library size={13} /> Capture To Index</button>
                  </div>
                  <div className="portal-webview-wrapper" style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    {tabs.map(tab => {
                      if (tab.page?.kind !== 'browser') return null;
                      return (
                        <PortalWebview
                          key={tab.id}
                          tab={tab}
                          isActive={tab.id === activeTabId}
                          onNavigate={handleWebviewNavigate}
                          onStateChange={updateWebviewState}
                          registerRef={(el) => {
                            webviewRef.current = el;
                          }}
                          webviewStates={webviewStates}
                        />
                      );
                    })}

                    {activeTabState.showFindBar && (
                      <div className="portal-find-bar">
                        <input
                          id={`find-input-${activeTabId}`}
                          value={activeTabState.findText || ''}
                          onChange={(e) => {
                            const text = e.target.value;
                            updateWebviewState(activeTabId, { findText: text });
                            if (webviewRef.current) {
                              if (text) {
                                webviewRef.current.findInPage(text);
                              } else {
                                webviewRef.current.stopFindInPage('clearSelection');
                                updateWebviewState(activeTabId, { findResults: null });
                              }
                            }
                          }}
                          placeholder="Find in page..."
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (webviewRef.current && activeTabState.findText) {
                                webviewRef.current.findInPage(activeTabState.findText, { forward: !e.shiftKey, findNext: true });
                              }
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              closeFindBar();
                            }
                          }}
                        />
                        {activeTabState.findResults && (
                          <span className="portal-find-matches">
                            {activeTabState.findResults.matches > 0
                              ? `${activeTabState.findResults.activeMatchOrdinal} / ${activeTabState.findResults.matches}`
                              : '0 / 0'}
                          </span>
                        )}
                        <div className="portal-find-controls">
                          <button
                            type="button"
                            onClick={() => {
                              if (webviewRef.current && activeTabState.findText) {
                                webviewRef.current.findInPage(activeTabState.findText, { forward: false, findNext: true });
                              }
                            }}
                            title="Previous match"
                          >
                            <ChevronUp size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (webviewRef.current && activeTabState.findText) {
                                webviewRef.current.findInPage(activeTabState.findText, { forward: true, findNext: true });
                              }
                            }}
                            title="Next match"
                          >
                            <ChevronDown size={14} />
                          </button>
                          <button type="button" onClick={closeFindBar} title="Close search">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    )}

                    {somaCursor && page.kind === 'browser' && (
                      <div
                        className="portal-soma-cursor-overlay"
                        style={{
                          left: `${somaCursor.x}%`,
                          top: `${somaCursor.y}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                      >
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 2.5px 5px rgba(0,0,0,0.55))' }}>
                          <path d="M4 3V19L9.42 13.58L16 20.16L18.84 17.32L12.26 10.74L19 10.74V3H4Z" fill="#8b5cf6" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="miter"/>
                        </svg>
                        <div className="portal-soma-cursor-pointer-badge">
                          <span className="portal-soma-cursor-label">SOMA</span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {!isElectron && page.kind === 'browser' && (
                <section className="portal-browser">
                  <div className="portal-browser-unavailable">
                    <Globe2 size={26} />
                    <strong>Real browsing is available in the Aperture desktop application.</strong>
                    <span>The web development preview cannot embed Electron Chromium views.</span>
                    <button type="button" onClick={() => readUrl(page.address)}>Open Reader Capture</button>
                  </div>
                </section>
              )}
            </main>

            {/* Conditionally rendered SOMA Assist Panel */}
            {showAssistPanel && (
              <aside className="portal-sidebar">
                <nav>
                  {[
                    ['assistant', Sparkles, 'Assist'],
                    ['sources', Globe2, 'Sources'],
                    ['tasks', CheckCircle2, 'Tasks'],
                    ['library', Library, 'Library'],
                    ['gmn', DatabaseZap, 'GMN']
                  ].map(([id, Icon, label]) => (
                    <button key={id} type="button" className={sideTab === id ? 'selected' : ''} onClick={() => { setSideTab(id); if (id === 'gmn') loadGmnSites(); }}><Icon size={13} />{label}</button>
                  ))}
                </nav>

                {sideTab === 'assistant' && (
                  <div className="portal-side-content assistant">
                    <div className="portal-steve-head">
                      <img src="/steve_profile.gif" alt="Steve" onError={event => { event.currentTarget.style.display = 'none'; }} />
                      <div>
                        <strong>Steve Refinement</strong>
                        <span>{steveStatus.online ? `${steveStatus.status || 'online'} · ${steveStatus.mood || 'idle'}` : 'offline fallback'}</span>
                      </div>
                    </div>
                    <div className="portal-side-actions">
                      <button type="button" disabled={!hasEvidence || steveThinking} onClick={event => sendToSteve(event, 'Audit this Portal artifact for clarity, weak claims, missing citations, broken flow, and next improvements. Keep it concise and actionable.')}><Sparkles size={13} /> Steve Audit</button>
                      <button type="button" disabled={page.kind !== 'browser' || steveThinking} onClick={explainSelection}><FileText size={13} /> Explain Selection</button>
                      <button type="button" disabled={!hasEvidence} onClick={saveToMemory}><Brain size={13} /> Catalog</button>
                      <button type="button" disabled={!hasEvidence} onClick={saveToReflections}><BookOpen size={13} /> Save Note</button>
                    </div>
                    {summary && <div className="portal-summary">{summary}</div>}
                    <div ref={steveScrollRef} className="portal-conversation portal-steve-conversation">
                      {steveMessages.map((message, index) => (
                        <p key={index} className={message.role === 'user' ? 'user' : `soma ${message.failed ? 'failed' : ''}`}>
                          {message.text}
                          {Array.isArray(message.actions) && message.actions.length > 0 && (
                            <small>{message.actions.length} action result{message.actions.length === 1 ? '' : 's'} returned.</small>
                          )}
                        </p>
                      ))}
                      {conversation.map((message, index) => <p key={`legacy-${index}`} className={message.role}>{message.text}</p>)}
                      {steveThinking && <p className="soma thinking">Steve is inspecting the current surface...</p>}
                    </div>
                    <form className="portal-chat" onSubmit={sendToSteve}>
                      <input disabled={steveThinking} value={steveInput} onChange={event => setSteveInput(event.target.value)} placeholder={hasEvidence ? 'Ask Steve to refine this...' : 'Ask Steve about Portal...'} />
                      <button type="submit" disabled={steveThinking || !steveInput.trim()}><Send size={14} /></button>
                    </form>
                  </div>
                )}

                {sideTab === 'sources' && (
                  <div className="portal-side-content">
                    <h3>External Sources</h3>
                    {!page.sources.length && <p className="portal-empty">Run research to view cited sources.</p>}
                    {page.sources.map(source => <button className="portal-side-source" key={source.url} onClick={() => readUrl(source.url)}>{source.title}<small>{source.url}</small></button>)}
                    <h3>Memory Recall</h3>
                    {!page.memoryHits.length && <p className="portal-empty">No local memory matches loaded.</p>}
                    {page.memoryHits.map(hit => <p className="portal-memory" key={hit.id}>{hit.text}</p>)}
                  </div>
                )}

                {sideTab === 'tasks' && (
                  <div className="portal-side-content">
                    <button type="button" className="portal-extract" disabled={!hasEvidence} onClick={extractTasks}><FileText size={14} /> Extract Actions</button>
                    <label className="portal-destination">
                      Axis destination
                      <select value={projectId} onChange={event => setProjectId(event.target.value)}>
                        {!projects.length && <option value="">No project available</option>}
                        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
                      </select>
                    </label>
                    {!tasks.length && <p className="portal-empty">Actions remain candidates until you send them into Axis.</p>}
                    {tasks.map(task => (
                      <div className="portal-task" key={task}>
                        <p>{task}</p>
                        <button type="button" disabled={!projectId} onClick={() => createTask(task)}>Add to Axis</button>
                      </div>
                    ))}
                  </div>
                )}

                {sideTab === 'library' && (
                  <div className="portal-side-content">
                    <div className="portal-library-header">
                      <h3>Recent Research</h3>
                      {library.length > 0 && (
                        <button type="button" className="portal-clear-history" onClick={clearHistory}>
                          Clear All
                        </button>
                      )}
                    </div>
                    {!library.length && <p className="portal-empty">No investigations recorded yet.</p>}
                    {library.map(item => (
                      <div key={item.id} className="portal-library-item-row">
                        <button type="button" className="portal-library-item" onClick={() => revisit(item)}>
                          <strong>{item.title}</strong>
                          <small>{item.kind} - {formatTime(item.createdAt)}</small>
                        </button>
                        <button type="button" className="portal-history-delete" title="Delete entry" onClick={event => deleteHistoryItem(event, item.id)}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {sideTab === 'gmn' && (
                  <div className="portal-side-content portal-gmn-manager">
                    <div className="pgm-header">
                      <DatabaseZap size={13} />
                      <span>Gray Matter Network</span>
                      <button type="button" className="pgm-new-btn" title="New GMN site" onClick={() => setGmnCreating(c => !c)}><Plus size={12} /></button>
                    </div>

                    {gmnCreating && (
                      <div className="pgm-create-row">
                        <input
                          className="pgm-create-input"
                          placeholder="site-name"
                          value={gmnCreateName}
                          onChange={e => setGmnCreateName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                          onKeyDown={e => e.key === 'Enter' && createGmnSite()}
                          autoFocus
                        />
                        <span className="pgm-create-suffix">.gmn</span>
                        <select className="pgm-template-select" value={gmnTemplate} onChange={e => setGmnTemplate(e.target.value)}>
                          {Object.entries(GMN_TEMPLATES).map(([id, template]) => (
                            <option key={id} value={id}>{template.label}</option>
                          ))}
                        </select>
                        <button type="button" className="pgm-create-btn" disabled={!gmnCreateName.trim() || gmnCreateBusy} onClick={createGmnSite}>
                          {gmnCreateBusy ? '…' : 'Create'}
                        </button>
                      </div>
                    )}

                    {!gmnSites.length && !gmnCreating && (
                      <p className="portal-empty">No local GMN sites. Create one above.</p>
                    )}

                    {gmnSites.map(site => (
                      <div key={site.canonical} className="pgm-site-row">
                        <div className="pgm-site-info" onClick={() => openGmnSite(site.canonical)}>
                          <span className="pgm-site-name">{site.canonical}</span>
                          {site.manifest?.description && <span className="pgm-site-desc">{site.manifest.description}</span>}
                        </div>
                        <div className="pgm-site-actions">
                          <button type="button" title="Edit HTML" onClick={() => openGmnEditor(site.manifest?.site)}><Code2 size={11} /></button>
                          <button type="button" title="Security" onClick={() => setGmnSecInspector(site.manifest)}><Lock size={11} /></button>
                          <button type="button" title="Export" onClick={() => exportGmnSite(site.manifest?.site)}><Download size={11} /></button>
                          <button type="button" title="Delete" className="pgm-delete-btn" onClick={() => deleteGmnSite(site.manifest?.site)}><X size={11} /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            )}
          </div>
        </div>
      </div>

      {/* GMN Site Editor Modal */}
      {gmnEditor && (
        <div className="pgm-modal-overlay" onClick={() => setGmnEditor(null)}>
          <div className="pgm-modal pgm-editor-modal" onClick={e => e.stopPropagation()}>
            <div className="pgm-modal-header">
              <DatabaseZap size={14} />
              <span>{gmnEditor.site}.gmn · {gmnEditor.activePath || '/index.html'}</span>
              <div className="pgm-modal-header-actions">
                <button type="button" className="pgm-preview-toggle" onClick={snapshotGmnSite} title="Create version snapshot">
                  <RotateCcw size={13} /> Snapshot
                </button>
                <button type="button" className="pgm-preview-toggle" onClick={() => reindexGmnSite(gmnEditor.site)} title="Refresh Dendrite index">
                  <DatabaseZap size={13} /> Index
                </button>
                <button type="button" className="pgm-preview-toggle" onClick={() => exportGmnSite(gmnEditor.site)} title="Export zip">
                  <Download size={13} /> Export
                </button>
                <button type="button" className={`pgm-preview-toggle ${gmnEditorPreview ? 'active' : ''}`} onClick={() => setGmnEditorPreview(v => !v)} title="Toggle preview">
                  {gmnEditorPreview ? <Code2 size={13} /> : <Globe2 size={13} />}
                  {gmnEditorPreview ? 'Code' : 'Preview'}
                </button>
                <button type="button" className="pgm-save-btn" disabled={gmnEditorSaving} onClick={saveGmnSite}>
                  {gmnEditorSaving ? '…' : 'Save'}
                </button>
                <button type="button" className="pgm-close-btn" onClick={() => setGmnEditor(null)}><X size={14} /></button>
              </div>
            </div>
            <div className="pgm-modal-meta">
              <input className="pgm-meta-input" placeholder="Title" value={gmnEditor.title} onChange={e => setGmnEditor(g => ({ ...g, title: e.target.value }))} />
              <input className="pgm-meta-input" placeholder="Description" value={gmnEditor.description} onChange={e => setGmnEditor(g => ({ ...g, description: e.target.value }))} />
              <div className="pgm-budget" title="GMN package budget">
                {(((gmnEditor.stats?.bytes || 0) / 1024) || 0).toFixed(1)} KB / {(((gmnEditor.stats?.maxPackageBytes || 5242880) / 1024 / 1024) || 5).toFixed(0)} MB
              </div>
            </div>
            <div className="pgm-editor-shell">
              <aside className="pgm-file-panel">
                <div className="pgm-file-panel-header">
                  <span>Files</span>
                  <button type="button" onClick={createGmnEditorFile} title="Add file"><Plus size={12} /></button>
                  <button type="button" onClick={deleteGmnEditorFile} disabled={gmnEditor.activePath === '/index.html'} title="Delete active file"><Trash2 size={12} /></button>
                </div>
                <div className="pgm-file-list">
                  {(gmnEditor.files || []).map(file => (
                    <button
                      key={file.path}
                      type="button"
                      className={file.path === gmnEditor.activePath ? 'active' : ''}
                      disabled={!file.editable || file.protected}
                      onClick={() => loadGmnEditorFile(file.path)}
                      title={file.protected ? `${file.path} is protected` : file.editable ? file.path : `${file.path} is not text-editable`}
                    >
                      <File size={12} />
                      <span>{file.path}</span>
                      <small>{file.size ? `${(file.size / 1024).toFixed(1)} KB` : '0 KB'}</small>
                    </button>
                  ))}
                </div>
                <div className="pgm-versions">
                  <div className="pgm-file-panel-header"><span>Versions</span></div>
                  {!(gmnEditor.versions || []).length && <p>No snapshots yet.</p>}
                  {(gmnEditor.versions || []).slice(0, 8).map(version => (
                    <button key={version.id} type="button" onClick={() => restoreGmnVersion(version.id)}>
                      <RotateCcw size={11} />
                      <span>{version.id}</span>
                    </button>
                  ))}
                </div>
              </aside>
              {gmnEditorPreview ? (
                <div className="pgm-preview-stage">
                  <iframe
                    className="pgm-preview-frame"
                    title="GMN Preview"
                    sandbox="allow-scripts"
                    srcDoc={(gmnEditor.activePath || '/index.html') === '/index.html' ? gmnEditor.content : gmnEditor.html}
                  />
                  <div className="pgm-steve-refiner">
                    <button
                      type="button"
                      className="pgm-steve-avatar"
                      title="Ask Steve to refine this preview"
                      onClick={() => {
                        setShowAssistPanel(true);
                        setSideTab('assistant');
                        sendToSteve(null, `Refine the GMN preview for ${gmnEditor.site}.gmn. Check layout, copy, accessibility, missing implementation notes, security assumptions, and whether the page feels ready to host. Active file: ${gmnEditor.activePath || '/index.html'}`);
                      }}
                    >
                      <img src="/steve_profile.gif" alt="Steve" onError={event => { event.currentTarget.style.display = 'none'; }} />
                      <Sparkles size={13} />
                    </button>
                    <div>
                      <strong>Steve Preview Watch</strong>
                      <span>{steveThinking ? 'Inspecting preview...' : 'Click to refine this surface'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <textarea
                  className="pgm-editor-textarea"
                  value={gmnEditor.content}
                  onChange={e => setGmnEditor(g => ({ ...g, content: e.target.value }))}
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* GMN Security Inspector Modal */}
      {gmnSecInspector && (
        <div className="pgm-modal-overlay" onClick={() => setGmnSecInspector(null)}>
          <div className="pgm-modal pgm-sec-modal" onClick={e => e.stopPropagation()}>
            <div className="pgm-modal-header">
              <Lock size={14} />
              <span>Security Policy — {gmnSecInspector.site}.gmn</span>
              <div className="pgm-modal-header-actions">
                <button type="button" className="pgm-save-btn" onClick={repairGmnSecurity}>Fix All</button>
                <button type="button" className="pgm-close-btn" onClick={() => setGmnSecInspector(null)}><X size={14} /></button>
              </div>
            </div>
            <div className="pgm-sec-body">
              {gmnSecurityChanges && (
                <div className="pgm-sec-change-list">
                  <strong>Last repair</strong>
                  {Object.entries(gmnSecurityChanges).map(([key, change]) => (
                    <span key={key}>{key}: {String(change.before)} {'->'} {String(change.after)}</span>
                  ))}
                </div>
              )}
              {[
                ['externalScripts', 'External Scripts', 'Remote JavaScript execution'],
                ['inlineEval', 'Inline eval()', 'Dynamic code evaluation'],
                ['sandboxIframe', 'Sandbox iFrame', 'Page wrapped in sandboxed iframe'],
                ['sameSiteAssetsOnly', 'Same-Site Assets Only', 'Images and CSS restricted to local assets'],
                ['allowForms', 'Forms Allowed', 'HTML form submission permitted'],
                ['allowCookies', 'Cookies Allowed', 'Cookie read/write permitted'],
                ['allowLocalStorage', 'LocalStorage Allowed', 'Browser storage permitted'],
              ].map(([key, label, desc]) => {
                const value = gmnSecInspector.security?.[key];
                const safeKeys = ['sandboxIframe', 'sameSiteAssetsOnly'];
                const dangerKeys = ['externalScripts', 'inlineEval', 'allowForms', 'allowCookies', 'allowLocalStorage'];
                const isOk = safeKeys.includes(key) ? value === true : dangerKeys.includes(key) ? value === false : null;
                return (
                  <div key={key} className="pgm-sec-row">
                    <div className={`pgm-sec-badge ${isOk === true ? 'ok' : isOk === false ? 'warn' : 'neutral'}`}>
                      {isOk === true ? '✓' : isOk === false ? '⚠' : '–'}
                    </div>
                    <div className="pgm-sec-info">
                      <strong>{label}</strong>
                      <span>{desc}</span>
                    </div>
                    <div className={`pgm-sec-value ${value ? 'enabled' : 'disabled'}`}>{value ? 'ON' : 'OFF'}</div>
                  </div>
                );
              })}
              <div className="pgm-sec-row pgm-sec-bytes">
                <div className="pgm-sec-badge ok">✓</div>
                <div className="pgm-sec-info">
                  <strong>Max Package Size</strong>
                  <span>Total asset bundle limit</span>
                </div>
                <div className="pgm-sec-value">{((gmnSecInspector.security?.maxPackageBytes || 5242880) / 1024 / 1024).toFixed(0)} MB</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PortalWebview({ tab, isActive, onNavigate, onStateChange, registerRef, webviewStates }) {
  const ref = useRef(null);
  const tabState = webviewStates[tab.id] || { loading: false, canGoBack: false, canGoForward: false, forceDark: false };
  const tabStateRef = useRef(tabState);

  useEffect(() => {
    tabStateRef.current = tabState;
  }, [tabState]);

  useEffect(() => {
    if (isActive && ref.current) {
      registerRef(ref.current);
    }
  }, [isActive, registerRef]);

  useEffect(() => {
    const view = ref.current;
    if (!view) return;

    const updateNavState = () => {
      onStateChange(tab.id, {
        loading: view.isLoading?.() || false,
        canGoBack: view.canGoBack?.() || false,
        canGoForward: view.canGoForward?.() || false
      });
    };

    const didNavigate = (event) => {
      const address = event.url || view.getURL();
      const title = view.getTitle() || new URL(address).hostname;
      onNavigate(tab.id, address, title);
      updateNavState();
    };

    const didStart = () => {
      onStateChange(tab.id, { loading: true });
    };

    const didStop = () => {
      updateNavState();
      // Re-inject dark mode if enabled
      if (tabStateRef.current?.forceDark) {
        view.executeJavaScript(`
          if (!document.getElementById('soma-dark-reader')) {
            const style = document.createElement('style');
            style.id = 'soma-dark-reader';
            style.innerHTML = 'html { filter: invert(1) hue-rotate(180deg) !important; } img, video, iframe, canvas { filter: invert(1) hue-rotate(180deg) !important; }';
            document.head.appendChild(style);
          }
        `).catch(() => {});
      }
    };

    const foundInPage = (e) => {
      onStateChange(tab.id, {
        findResults: {
          activeMatchOrdinal: e.result.activeMatchOrdinal,
          matches: e.result.matches
        }
      });
    };

    view.addEventListener('did-navigate', didNavigate);
    view.addEventListener('did-navigate-in-page', didNavigate);
    view.addEventListener('did-start-loading', didStart);
    view.addEventListener('did-stop-loading', didStop);
    view.addEventListener('dom-ready', didStop);
    view.addEventListener('found-in-page', foundInPage);

    // Initial check
    setTimeout(updateNavState, 500);

    return () => {
      view.removeEventListener('did-navigate', didNavigate);
      view.removeEventListener('did-navigate-in-page', didNavigate);
      view.removeEventListener('did-start-loading', didStart);
      view.removeEventListener('did-stop-loading', didStop);
      view.removeEventListener('dom-ready', didStop);
      view.removeEventListener('found-in-page', foundInPage);
    };
  }, [tab.id, onNavigate, onStateChange]);

  return (
    <div
      className="portal-webview-container"
      style={{ display: isActive ? 'flex' : 'none', width: '100%', height: '100%', position: 'relative' }}
    >
      <webview
        ref={ref}
        className="portal-webview"
        src={tab.page.address}
        partition={tab.isPrivate ? "portal_private" : "persist:portal"}
        webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
      />
    </div>
  );
}
