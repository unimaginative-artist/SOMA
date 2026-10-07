import React, { useState, useEffect, useRef } from 'react';
import {
  Shield, Activity, Lock, Power, Terminal, AlertTriangle,
  Cpu, Zap, Eye, Database, Network, Server, Unlock, Plus, Mail, Key, X,
  CheckCircle, ChevronRight, Settings, Radio, RefreshCw, Filter, Globe, Map, Target, Send, Bell,
  Info, ExternalLink, Copy, ArrowRight, HelpCircle, Cloud, AtSign, Inbox, MailOpen, MessageSquare
} from 'lucide-react';
import { toast } from 'react-toastify';
import { KEVIN_QUOTES } from './data/kevinQuotes';
import KevinSMSSettings from './components/KevinSMSSettings';

const KevinInterface = () => {
  // State
  const [isOnline, setIsOnline] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [usingRealEmail, setUsingRealEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [sensitivity, setSensitivity] = useState(85);
  const [protocols, setProtocols] = useState({
    heuristics: true, zeroTrust: true, toneAnalysis: false, linkDetonation: false,
    autoDraft: true, smartPriority: true, actionExtract: true, styleLearn: false
  });
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [showEmailSetup, setShowEmailSetup] = useState(false);
  const [agentEmail, setAgentEmail] = useState('');
  const [agentPassword, setAgentPassword] = useState('');
  const [notificationStatus, setNotificationStatus] = useState({});
  const [notificationSettings, setNotificationSettings] = useState({
    slackWebhook: '', telegramBotToken: '', telegramChatId: '', discordWebhook: ''
  });

  const [kevinMood, setKevinMood] = useState('idle'); // idle, scanning, threat
  const [quote, setQuote] = useState(KEVIN_QUOTES.idle[0]);

  const emailProviders = {
    gmail: {
      name: 'Gmail / Google Workspace',
      iconType: 'google',
      color: '#EA4335',
      imapServer: 'imap.gmail.com',
      imapPort: 993,
      steps: [
        { title: 'Enable 2FA', desc: 'Go to your Google Account settings and enable 2-Step Verification.' },
        { title: 'Create App Password', desc: 'Search for "App Passwords" in your account settings. Create one for "Mail" on "Windows Computer".', link: 'https://myaccount.google.com/apppasswords', linkText: 'Google App Passwords' },
        { title: 'Copy Password', desc: 'Copy the 16-character code and paste it into the "App Password" field here.' }
      ],
      notes: 'Gmail requires an App Password. Your regular password will not work.'
    },
    outlook: {
      name: 'Outlook / Office 365',
      iconType: 'outlook',
      color: '#0078D4',
      imapServer: 'outlook.office365.com',
      imapPort: 993,
      steps: [
        { title: 'Security Settings', desc: 'Go to Security -> Advanced Security Options.', link: 'https://account.microsoft.com/security', linkText: 'Microsoft Security' },
        { title: 'App Passwords', desc: 'Look for "App passwords" section and click "Create a new app password".' },
        { title: 'Enable IMAP', desc: 'Ensure IMAP is enabled in your Outlook.com settings (Settings -> Mail -> Sync email).' }
      ]
    }
  };

  const renderProviderIcon = (type, size, color) => {
    return <Mail className={`${size === 'lg' ? 'w-6 h-6' : 'w-4 h-4'}`} style={{ color }} />;
  };
  
    // Chat State
    const [chatInput, setChatInput] = useState('');
    const [isKevinThinking, setIsKevinThinking] = useState(false);
    const [messages, setMessages] = useState([]); // { role: 'user' | 'assistant', content: string }
    const messagesEndRef = useRef(null);
  
    const [scanLog, setScanLog] = useState([]);
    
    const [stats, setStats] = useState({});
    const [accounts, setAccounts] = useState([]);
    const [capabilities, setCapabilities] = useState(null);
    const [cockpit, setCockpit] = useState(null);
    const [approvals, setApprovals] = useState([]);
    const [trustGraph, setTrustGraph] = useState({ nodes: [], edges: [], recentDecisions: [] });
    const [timeline, setTimeline] = useState([]);
    const [evidenceLedger, setEvidenceLedger] = useState([]);
    const [localWatch, setLocalWatch] = useState(null);
    const [briefing, setBriefing] = useState(null);
    const [reputation, setReputation] = useState([]);
    const [activeTool, setActiveTool] = useState('dashboard');
    const [linkUrl, setLinkUrl] = useState('');
    const [linkResult, setLinkResult] = useState(null);
    const [rewriteText, setRewriteText] = useState('');
    const [rewriteResult, setRewriteResult] = useState('');
    const [pairingSender, setPairingSender] = useState('');
    const [pairingResult, setPairingResult] = useState(null);

    // Sandbox Threat & Inbox States
    const [sandboxSender, setSandboxSender] = useState('');
    const [sandboxSubject, setSandboxSubject] = useState('');
    const [sandboxBody, setSandboxBody] = useState('');
    const [sandboxVerdict, setSandboxVerdict] = useState(null);
    const [isSandboxScanning, setIsSandboxScanning] = useState(false);

    // Sandbox History State & Fetch
    const [sandboxHistory, setSandboxHistory] = useState([]);
    const fetchSandboxHistory = async () => {
      try {
        const res = await fetch('/api/kevin/sandbox/history');
        if (res.ok) {
          const data = await res.json();
          if (data.success) setSandboxHistory(data.history || []);
        }
      } catch (e) {
        console.error('Failed to fetch sandbox history:', e);
      }
    };

    // Rewrite Tone Profile States
    const [selectedTone, setSelectedTone] = useState('professional');

    const toneProfiles = [
      { id: 'professional', label: 'Professional', guidance: 'make it formal, professional, polite, and clear.' },
      { id: 'refusal', label: 'Firm Refusal', guidance: 'make it a firm, polite, but direct refusal. decline the request clearly.' },
      { id: 'sarcastic', label: 'Sarcastic', guidance: 'rewrite it with sarcastic security operator humor, pointing out potential risks or laziness, but keeping it professional enough to send.' },
      { id: 'brief', label: 'Brief', guidance: 'make it extremely short, concise, and straight to the point.' }
    ];

    // Cute folder mascot is used by default

  // Fetch Kevin Data - REAL DATA ONLY
  const loadKevinData = async () => {
    try {
      const statusRes = await fetch('/api/kevin/status');
      const logRes = await fetch('/api/kevin/scan-log');
      const capabilitiesRes = await fetch('/api/kevin/capabilities');
      const cockpitRes = await fetch('/api/kevin/cockpit');
      const approvalsRes = await fetch('/api/kevin/approvals');
      const graphRes = await fetch('/api/kevin/trust-graph');
      const timelineRes = await fetch('/api/kevin/verdict-timeline?limit=30');
      const evidenceRes = await fetch('/api/kevin/evidence-ledger?limit=80');
      const localWatchRes = await fetch('/api/kevin/local-watch');
      const briefingRes = await fetch('/api/kevin/briefing');
      const reputationRes = await fetch('/api/kevin/reputation');

      if (statusRes.ok) {
        const data = await statusRes.json();
        if (data.success) {
          // Update UI state based on Backend state
          setIsOnline(data.status.online);
          setUsingRealEmail(data.status.usingRealEmail || false);
          if (data.status.stats) {
            setStats(data.status.stats);
          }

          // Sync with real config from backend
          if (data.status.config) {
              const cfg = data.status.config;
              setSensitivity(cfg.sensitivity || 85);
              if (cfg.protocols) setProtocols(prev => ({ ...prev, ...cfg.protocols }));
              
              // Map monitored_accounts to our UI list format
              if (cfg.monitored_accounts) {
                  setAccounts(cfg.monitored_accounts.map((email, idx) => ({
                      id: idx + 1,
                      email,
                      status: 'secure',
                      lastScan: 'Active'
                  })));
              }
          }

          if (Math.random() > 0.8 && !isKevinThinking) {
              setKevinMood(data.status.mood);
          }
        }
      }

      if (logRes.ok) {
        const data = await logRes.json();
        if (data.success) {
          setScanLog(data.logs);
        }
      }

      if (capabilitiesRes.ok) {
        const data = await capabilitiesRes.json();
        if (data.success) {
          setCapabilities(data);
        }
      }

      if (cockpitRes.ok) {
        const data = await cockpitRes.json();
        if (data.success) {
          setCockpit(data);
        }
      }

      if (approvalsRes.ok) {
        const data = await approvalsRes.json();
        if (data.success) setApprovals(data.approvals || []);
      }

      if (graphRes.ok) {
        const data = await graphRes.json();
        if (data.success) setTrustGraph({ nodes: data.nodes || [], edges: data.edges || [], recentDecisions: data.recentDecisions || [] });
      }

      if (timelineRes.ok) {
        const data = await timelineRes.json();
        if (data.success) setTimeline(data.events || []);
      }

      if (evidenceRes.ok) {
        const data = await evidenceRes.json();
        if (data.success) setEvidenceLedger(data.events || []);
      }

      if (localWatchRes.ok) {
        const data = await localWatchRes.json();
        if (data.success) setLocalWatch(data);
      }

      if (briefingRes.ok) {
        const data = await briefingRes.json();
        if (data.success) setBriefing(data);
      }

      if (reputationRes.ok) {
        const data = await reputationRes.json();
        if (data.success) setReputation(data.reputation || []);
      }
    } catch (e) {
      console.error("Kevin connection failed", e);
    }
  };

  useEffect(() => {
    // Fetch immediately on mount
    loadKevinData();
    fetchSandboxHistory();
    
    // Poll regardless of local isOnline state so we can detect if backend starts/stops
    // Using a 15-second interval as a fallback since SSE handles real-time push events.
    const interval = setInterval(loadKevinData, 15000);

    return () => clearInterval(interval);
  }, [isKevinThinking]); // Removed isOnline from dependency so it runs always

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isKevinThinking]);

  // Real-time Event Stream (SSE) Subscription
  useEffect(() => {
    const sseUrl = `${window.location.protocol}//${window.location.host}/api/kevin/events`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
      console.log('[KevinSSE] Stream connected successfully');
    };

    eventSource.onerror = (err) => {
      console.error('[KevinSSE] Stream connection error:', err);
    };

    eventSource.addEventListener('scan', (e) => {
      try {
        const newLog = JSON.parse(e.data);
        setScanLog(prev => {
          // Check if log already exists to avoid duplicates
          if (prev.some(l => l.id === newLog.id || (l.time === newLog.time && l.subject === newLog.subject))) {
            return prev;
          }
          return [newLog, ...prev];
        });

        const score = newLog.score ?? (newLog.status === 'phish' || newLog.status === 'threat' ? 85 : newLog.status === 'spam' ? 45 : 10);
        if (score >= 55) {
          playKevinSound('threat');
          toast.error(`SECURITY THREAT DETECTED: "${newLog.subject}" from ${newLog.origin || newLog.from || 'unknown sender'}`, {
            position: "top-right",
            autoClose: 8000
          });
          setKevinMood('threat');
        } else {
          playKevinSound('scan');
          toast.info(`Email scanned: "${newLog.subject}"`);
        }
        
        // Instant sync stats/timeline
        loadKevinData();
      } catch (err) {
        console.error('[KevinSSE] Failed to parse scan event:', err);
      }
    });

    eventSource.addEventListener('security_alert', (e) => {
      try {
        const alert = JSON.parse(e.data);
        playKevinSound('threat');
        toast.warning(`ALERT: ${alert.title || 'Security Warning'} - ${alert.message}`);
        loadKevinData();
      } catch (err) {
        console.error('[KevinSSE] Failed to parse security alert:', err);
      }
    });

    eventSource.addEventListener('status', (e) => {
      try {
        const data = JSON.parse(e.data);
        setIsOnline(data.online);
        if (data.online) {
          setQuote("I'm awake! Let's protect some emails. 🛡️");
          setKevinMood('idle');
        } else {
          setQuote("Going to sleep... stay safe! 💤");
          setKevinMood('offline');
        }
      } catch (err) {
        console.error('[KevinSSE] Failed to parse status event:', err);
      }
    });

    eventSource.addEventListener('draft', (e) => {
      try {
        const draft = JSON.parse(e.data);
        toast.info(`New secure reply draft created for: ${draft.recipient || 'Operator Review'}`);
        loadKevinData();
      } catch (err) {
        console.error('[KevinSSE] Failed to parse draft event:', err);
      }
    });

    return () => {
      eventSource.close();
      console.log('[KevinSSE] Stream connection closed');
    };
  }, []);

  // Threat Action Integrations
  const inspectEmail = async (overrideEmail = null) => {
    const emailPayload = overrideEmail || {
      from: sandboxSender,
      subject: sandboxSubject,
      body: sandboxBody
    };

    if (!emailPayload.subject && !emailPayload.body) return;
    setIsSandboxScanning(true);
    playKevinSound('scan');
    try {
      const res = await fetch('/api/kevin/verdict/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailPayload })
      });
      const data = await res.json();
      if (data.success) {
        setSandboxVerdict(data);
        setKevinMood('scanning');
        
        // If manual sandbox scan (no override email), save to history
        if (!overrideEmail) {
          try {
            await fetch('/api/kevin/sandbox/history', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                item: {
                  from: emailPayload.from || sandboxSender || 'manual-sandbox',
                  subject: emailPayload.subject || sandboxSubject || '(No Subject)',
                  body: emailPayload.body || sandboxBody || '',
                  verdict: data.verdict,
                  score: data.score,
                  analysis: data.analysis
                }
              })
            });
            fetchSandboxHistory();
          } catch (e) {
            console.error('History save error:', e);
          }
        }
        
        if (data.score >= 55) {
          setTimeout(() => playKevinSound('threat'), 1500);
        }
        setTimeout(() => {
          setKevinMood(data.verdict === 'block' || data.verdict === 'high_risk' ? 'threat' : 'idle');
        }, 1500);
      } else {
        toast.error(data.error || 'Failed to inspect email');
      }
    } catch (error) {
      toast.error('Network error during threat scanning');
      console.error(error);
    } finally {
      setIsSandboxScanning(false);
    }
  };

  const executeThreatAction = async (endpoint, senderEmail, successMsg) => {
    if (!senderEmail) return;
    playKevinSound('click');
    setIsKevinThinking(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: senderEmail })
      });
      const data = await res.json();
      if (data.success) {
        toast.success(successMsg);
        setSandboxSender('');
        setSandboxSubject('');
        setSandboxBody('');
        setSandboxVerdict(null);
        await loadKevinData();
      } else {
        toast.error(data.error || 'Operation failed');
      }
    } catch (error) {
      toast.error('Network error during operation');
      console.error(error);
    } finally {
      setIsKevinThinking(false);
    }
  };

  const getVerdictDetails = (score) => {
    if (score >= 80) {
      return {
        label: 'BLOCK',
        color: '#f43f5e',
        glowColor: 'rgba(244,63,94,0.4)',
        textTone: 'text-rose-400',
        borderTone: 'border-rose-500/30',
        bgTone: 'bg-rose-500/10'
      };
    } else if (score >= 55) {
      return {
        label: 'HIGH RISK',
        color: '#fb923c',
        glowColor: 'rgba(251,146,60,0.4)',
        textTone: 'text-orange-400',
        borderTone: 'border-orange-500/30',
        bgTone: 'bg-orange-500/10'
      };
    } else if (score >= 30) {
      return {
        label: 'CAUTION',
        color: '#fbbf24',
        glowColor: 'rgba(251,191,36,0.4)',
        textTone: 'text-amber-400',
        borderTone: 'border-amber-500/30',
        bgTone: 'bg-amber-500/10'
      };
    } else {
      return {
        label: 'SAFE',
        color: '#10b981',
        glowColor: 'rgba(16,185,129,0.4)',
        textTone: 'text-emerald-400',
        borderTone: 'border-emerald-500/30',
        bgTone: 'bg-emerald-500/10'
      };
    }
  };

  const playKevinSound = (type) => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      
      if (type === 'scan') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(150, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 1.0);
        
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.0);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 1.0);
      } else if (type === 'threat') {
        const osc1 = ctx.createOscillator();
        const gain = ctx.createGain();
        osc1.type = 'sawtooth';
        
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        lfo.frequency.value = 6;
        lfoGain.gain.value = 50;
        
        osc1.frequency.value = 440;
        
        lfo.connect(lfoGain);
        lfoGain.connect(osc1.frequency);
        
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        
        osc1.connect(gain);
        gain.connect(ctx.destination);
        
        lfo.start();
        osc1.start();
        osc1.stop(ctx.currentTime + 0.8);
        lfo.stop(ctx.currentTime + 0.8);
      } else if (type === 'click') {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.15);
        
        gain.gain.setValueAtTime(0.03, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
      }
    } catch (err) {
      console.warn('AudioContext playback blocked or failed', err);
    }
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') return;
      const key = event.key.toLowerCase();
      if (key === 'i') setActiveTool('inbox');
      if (key === 'v') setActiveTool('link');
      if (key === 'a') setActiveTool('approvals');
      if (key === 'r') setActiveTool('timeline');
      if (key === 'b') setActiveTool('pairing');
      if (key === 't') setActiveTool('trust');
      if (key === 'g') setActiveTool('graph');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Handle Kevin Chat
  const handleChatSubmit = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !isOnline || isKevinThinking) return;

    const message = chatInput.trim();
    setChatInput('');
    setIsKevinThinking(true);
    setKevinMood('scanning');

    // Add user message
    setMessages(prev => [...prev, { role: 'user', content: message }]);

    try {
      const res = await fetch('/api/kevin/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      });
      const data = await res.json();
      if (data.success) {
        setQuote(data.response);
        setKevinMood('idle');
        // Add Kevin response
        setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
      }
    } catch (e) {
      toast.error("Communication with Kevin interrupted.");
    } finally {
      setIsKevinThinking(false);
    }
  };

  const togglePower = async () => {
    try {
      const res = await fetch('/api/kevin/toggle', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const newStatus = data.status === 'started';
        setIsOnline(newStatus);
        if (newStatus) {
          setQuote("I'm awake! Let's protect some emails. 🛡️");
          setKevinMood('idle');
          toast.success('KEVIN Engine Activated');
        } else {
          setQuote("Going to sleep... stay safe! 💤");
          setKevinMood('offline');
          toast.info('KEVIN Engine Disengaged');
        }
      }
    } catch (e) {
      toast.error('Failed to toggle Kevin process');
    }
  };

  const handleAddAccount = async () => {
    if (!newEmail.includes('@')) {
      toast.error('Invalid email format');
      return;
    }
    
    const newId = accounts.length + 1;
    const newAccount = { id: newId, email: newEmail, status: 'pending', lastScan: 'Queued' };
    const updatedAccounts = [...accounts, newAccount];
    
    // Save immediately
    try {
      const res = await fetch('/api/kevin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          thresholds: {
            spam: (100 - sensitivity) / 100,
            phishing: (100 - (sensitivity * 0.9)) / 100
          },
          monitored_accounts: updatedAccounts.map(a => a.email),
          protocols
        })
      });
      
      if (res.ok) {
        setAccounts(updatedAccounts);
        setNewEmail('');
        toast.success(`${newEmail} added and saved!`);
      } else {
        const errorData = await res.json().catch(() => ({ error: 'Unknown error' }));
        toast.error('Failed to save: ' + errorData.error);
      }
    } catch (e) {
      toast.error('Failed to add account: ' + e.message);
    }
  };

  const handleSaveSettings = async () => {
    console.log('[Kevin Settings] Starting save...');
    try {
      // UX Improvement: If agentEmail is provided, ensure it's in the monitored accounts list
      let finalMonitoredEmails = accounts.map(a => a.email);
      if (agentEmail && !finalMonitoredEmails.includes(agentEmail)) {
          finalMonitoredEmails.push(agentEmail);
          console.log('[Kevin Settings] Auto-adding connection email to monitored list:', agentEmail);
      }

      // 1. Save Kevin Config
      const configRes = await fetch('/api/kevin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sensitivity,
          monitored_accounts: finalMonitoredEmails,
          protocols
        })
      });

      if (!configRes.ok) {
        throw new Error('Failed to save configuration');
      }

      // 2. Save Credentials (if provided)
      if (agentEmail && agentPassword) {
        console.log('[Kevin Settings] Saving email credentials...');
        const envRes = await fetch('/api/setup/env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            EMAIL_ADDRESS: agentEmail,
            APP_PASSWORD: agentPassword
          })
        });

        if (!envRes.ok) {
          const errorData = await envRes.json();
          throw new Error('Failed to save credentials: ' + (errorData.error || envRes.statusText));
        }
        console.log('[Kevin Settings] Credentials saved');
        toast.success('Email credentials updated successfully!');
      } else {
        toast.success('Configuration saved successfully!');
      }

      setShowSettings(false);
    } catch (e) {
      console.error('[Kevin Settings] Save failed:', e);
      toast.error('Failed to save configuration: ' + e.message);
    }
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'safe': return <span className="px-2 py-1 bg-indigo-500/10 text-indigo-400 rounded-full text-[10px] font-bold border border-indigo-500/20">SAFE</span>;
      case 'threat': return <span className="px-2 py-1 bg-rose-500/10 text-rose-400 rounded-full text-[10px] font-bold border border-rose-500/20 animate-pulse">THREAT</span>;
      case 'spam': return <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded-full text-[10px] font-bold border border-amber-500/20">SPAM</span>;
      default: return <span className="px-2 py-1 bg-zinc-800 text-zinc-500 rounded-full text-[10px] font-bold border border-zinc-800/80">{status.toUpperCase()}</span>;
    }
  };

  const capabilityBadges = [
    { id: 'guard', label: 'Guard', active: capabilities?.surfaces?.operatorControl },
    { id: 'verdicts', label: 'Verdicts', active: capabilities?.surfaces?.evidenceFirstVerdicts },
    { id: 'approval', label: 'Approval Gate', active: capabilities?.surfaces?.approvalGate },
    { id: 'trust', label: 'Trust Graph', active: capabilities?.surfaces?.trustGraph?.people },
    { id: 'watch', label: 'Local Watch', active: capabilities?.surfaces?.localSystemWatch },
    { id: 'mail', label: 'Mail', active: capabilities?.integrations?.email?.connected },
  ];

  const verdictTone = (verdict) => {
    const v = String(verdict || '').toLowerCase();
    if (v.includes('block') || v.includes('threat') || v.includes('high')) return 'text-rose-400 border-rose-500/20 bg-rose-500/10';
    if (v.includes('caution') || v.includes('warning')) return 'text-amber-400 border-amber-500/20 bg-amber-500/10';
    if (v.includes('allow') || v.includes('safe') || v.includes('trust')) return 'text-emerald-400 border-emerald-500/20 bg-emerald-500/10';
    return 'text-zinc-400 border-white/10 bg-white/5';
  };

  const pendingApprovalCount = approvals.length;
  const blockedCount = Number(stats?.threats) || cockpit?.trustGraph?.people?.blocked || 0;
  const decisionCount = cockpit?.verdictEngine?.decisions || timeline.length || evidenceLedger.length || 0;
  const trustNodeCount = trustGraph.nodes.length || ((cockpit?.trustGraph?.people?.safe || 0) + (cockpit?.trustGraph?.people?.blocked || 0));
  const cockpitReadiness = Math.min(100, Math.round(
    (isOnline ? 25 : 0) +
    (usingRealEmail ? 20 : 8) +
    (capabilities?.surfaces?.approvalGate ? 15 : 0) +
    (capabilities?.surfaces?.trustGraph?.people ? 15 : 0) +
    (capabilities?.surfaces?.evidenceFirstVerdicts ? 15 : 0) +
    (localWatch?.status ? 10 : 0)
  ));
  const headerState = kevinMood === 'threat'
    ? { label: 'THREAT REVIEW', tone: 'text-rose-300 border-rose-500/30 bg-rose-500/10' }
    : kevinMood === 'scanning'
      ? { label: 'SCANNING EDGE', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' }
      : isOnline
        ? { label: 'GUARD ONLINE', tone: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' }
        : { label: 'OFFLINE', tone: 'text-zinc-500 border-white/10 bg-white/5' };
  const topSignals = [
    { label: 'Readiness', value: `${cockpitReadiness}%`, icon: Shield, tone: 'text-emerald-300', detail: usingRealEmail ? 'email edge connected' : 'local mode' },
    { label: 'Approvals', value: pendingApprovalCount, icon: Lock, tone: pendingApprovalCount ? 'text-amber-300' : 'text-zinc-300', detail: pendingApprovalCount ? 'needs operator' : 'clear' },
    { label: 'Trust Nodes', value: trustNodeCount, icon: Network, tone: 'text-cyan-300', detail: `${cockpit?.trustGraph?.people?.safe || 0} safe / ${cockpit?.trustGraph?.people?.blocked || 0} blocked` },
    { label: 'Verdicts', value: decisionCount, icon: Activity, tone: 'text-blue-300', detail: `${blockedCount} blocked` }
  ];

  const inspectLink = async () => {
    if (!linkUrl.trim()) return;
    setIsKevinThinking(true);
    try {
      const res = await fetch('/api/kevin/links/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: linkUrl.trim() })
      });
      const data = await res.json();
      setLinkResult(data);
    } catch (error) {
      setLinkResult({ success: false, error: error.message });
    } finally {
      setIsKevinThinking(false);
    }
  };

  const rewriteAsUser = async () => {
    if (!rewriteText.trim()) return;
    setIsKevinThinking(true);
    const toneObj = toneProfiles.find(t => t.id === selectedTone) || toneProfiles[0];
    const guidanceText = toneObj.guidance || 'keep it concise and natural';
    
    try {
      const res = await fetch('/api/kevin/rewrite-user-style', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: rewriteText.trim(), guidance: guidanceText })
      });
      const data = await res.json();
      setRewriteResult(data.rewritten || data.error || '');
    } catch (error) {
      setRewriteResult(error.message);
    } finally {
      setIsKevinThinking(false);
    }
  };

  const createPairing = async () => {
    if (!pairingSender.trim()) return;
    setIsKevinThinking(true);
    try {
      const res = await fetch('/api/kevin/pairing/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: pairingSender.trim(), metadata: { source: 'command_bridge' } })
      });
      setPairingResult(await res.json());
    } catch (error) {
      setPairingResult({ success: false, error: error.message });
    } finally {
      setIsKevinThinking(false);
    }
  };

  return (
    <div className="h-full flex bg-[#09090b] text-[#d4d4d8] font-sans rounded-xl border border-zinc-800 relative overflow-hidden">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 99px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.15);
        }
        @keyframes kevinRock {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        .animate-kevin-rock {
          animation: kevinRock 5s ease-in-out infinite;
          transform-origin: bottom center;
        }
      `}</style>

      {/* Left Navigation Sidebar */}
      <div className="w-64 bg-zinc-900 border-r border-zinc-800 flex flex-col justify-between p-5 flex-shrink-0 select-none">
        <div className="space-y-6">
          {/* Header */}
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-indigo-600/10 border border-indigo-500/20 rounded-lg text-indigo-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-white tracking-tight leading-tight text-sm">K.E.V.I.N.</div>
              <div className="text-[10px] text-zinc-500 font-medium">Security Assistant</div>
            </div>
          </div>

          {/* Mascot Section */}
          <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 flex flex-col items-center justify-center text-center select-none">
            <div 
              className={`w-16 h-16 rounded-xl border overflow-hidden flex items-center justify-center transition-all duration-300 ${
                isOnline 
                  ? (kevinMood === 'threat' ? 'border-rose-500' : 'border-zinc-700') 
                  : 'border-zinc-800 opacity-60 grayscale'
              }`}
            >
              <img
                src="/a_kevin_icon.png"
                alt="Kevin Mascot"
                className={`w-full h-full object-cover ${
                  isOnline ? 'animate-kevin-rock' : ''
                } ${
                  kevinMood === 'scanning' 
                    ? 'animate-pulse' 
                    : kevinMood === 'threat' 
                      ? 'animate-bounce' 
                      : ''
                }`}
                onError={(e) => { e.target.src = '/a_kevin_icon.png'; }}
              />
            </div>
          </div>

          {/* Nav Links */}
          <nav className="space-y-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: Activity },
              { id: 'evidence', label: 'Evidence Ledger', icon: Database },
              { id: 'chat', label: 'Chat Console', icon: MessageSquare },
              { id: 'inbox', label: 'Threat Inbox', icon: Inbox },
              { id: 'sandbox', label: 'Security Sandbox', icon: Shield },
              { id: 'rewrite', label: 'Tone Stylist', icon: MailOpen },
              { id: 'settings', label: 'Integrations', icon: Settings }
            ].map(tab => {
              const IconComponent = tab.icon;
              const isActive = activeTool === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => {
                    setActiveTool(tab.id);
                    playKevinSound('click');
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
                    isActive 
                      ? 'bg-zinc-800 text-white border border-zinc-700' 
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40 border border-transparent'
                  }`}
                >
                  <IconComponent className={`w-4 h-4 ${isActive ? 'text-indigo-400' : 'text-zinc-500'}`} />
                  <span>{tab.label}</span>
                  {tab.id === 'inbox' && scanLog.length > 0 && (
                    <span className="ml-auto px-1.5 py-0.2 bg-indigo-500/10 text-indigo-400 rounded-full text-[9px] font-bold border border-indigo-500/10">
                      {scanLog.length}
                    </span>
                  )}
                  {tab.id === 'evidence' && evidenceLedger.length > 0 && (
                    <span className="ml-auto px-1.5 py-0.2 bg-cyan-500/10 text-cyan-400 rounded-full text-[9px] font-bold border border-cyan-500/10">
                      {evidenceLedger.length}
                    </span>
                  )}
                  {tab.id === 'sandbox' && approvals.length > 0 && (
                    <span className="ml-auto px-1.5 py-0.2 bg-amber-500/10 text-amber-400 rounded-full text-[9px] font-bold border border-amber-500/10 animate-pulse">
                      {approvals.length}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer Controls */}
        <div className="space-y-3 border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between text-[10px] font-medium text-zinc-500 px-1">
            <span>Perimeter Alert</span>
            <span className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-zinc-700'}`} />
          </div>
          <button
            onClick={togglePower}
            className={`w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all border ${
              isOnline
                ? 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-750'
                : 'bg-indigo-600 hover:bg-indigo-500 text-white border-transparent shadow-sm'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isOnline ? 'Disengage Engine' : 'Activate Engine'}</span>
          </button>
        </div>
      </div>

      {/* Main Panel Content Area */}
      <div className="flex-1 flex flex-col bg-zinc-950 min-w-0 h-full overflow-hidden">
        {/* Top bar header info */}
        <header className="h-14 border-b border-zinc-800 flex justify-between items-center px-6 flex-shrink-0 select-none">
          <div>
            <h1 className="text-sm font-bold text-white capitalize">{activeTool === 'rewrite' ? 'Tone Stylist' : activeTool === 'settings' ? 'Integrations & Settings' : activeTool === 'evidence' ? 'Evidence Ledger' : `${activeTool} Console`}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${headerState.tone}`}>
              {headerState.label}
            </span>
            {cockpit && (
              <span className="text-[10px] text-zinc-500 font-mono hidden md:inline">
                Mode: {usingRealEmail ? 'Email Edge' : 'Local Sandbox'}
              </span>
            )}
          </div>
        </header>

        {/* View panel layout selector */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          <div className={`h-full transition-opacity duration-300 ${isOnline ? 'opacity-100' : 'opacity-35 pointer-events-none'}`}>
            
            {/* 1. DASHBOARD VIEW */}
            {activeTool === 'dashboard' && (
              <div className="space-y-6">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[
                    { label: 'Scanned Emails', value: (Number(stats?.scanned) || 0).toLocaleString(), color: 'text-white' },
                    { label: 'Blocked Threats', value: Number(stats?.threats) || 0, color: 'text-rose-500' },
                    { label: 'Operator Approvals', value: approvals.length, color: 'text-amber-500' },
                    { label: 'Audited Decisions', value: cockpit?.verdictEngine?.decisions || 0, color: 'text-indigo-400' }
                  ].map(stat => (
                    <div key={stat.label} className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
                      <div className="text-zinc-500 text-[10px] font-bold uppercase tracking-wider mb-1">{stat.label}</div>
                      <div className={`text-2xl font-semibold ${stat.color}`}>{stat.value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Briefing Feed */}
                  <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col h-[320px]">
                    <div className="flex items-center gap-2 mb-4">
                      <Bell className="w-4 h-4 text-indigo-400" />
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Perimeter Security Briefing</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                      {(briefing?.summary || ['Loading security briefing data...']).map((line, idx) => (
                        <div key={idx} className="text-xs text-zinc-400 bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                          {line}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Verdict Activity Feed */}
                  <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col h-[320px]">
                    <div className="flex items-center gap-2 mb-4">
                      <Activity className="w-4 h-4 text-indigo-400" />
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Recent Verdict Feed</h3>
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                      {timeline.slice(0, 15).map(event => (
                        <div key={event.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg flex items-center justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-zinc-300 truncate">{event.title}</div>
                            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{event.target || event.type}</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase flex-shrink-0 ${verdictTone(event.verdict)}`}>
                            {event.verdict}
                          </span>
                        </div>
                      ))}
                      {timeline.length === 0 && (
                        <div className="h-full flex items-center justify-center text-xs text-zinc-600 italic">
                          No diagnostic decisions generated yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* System Status Metrics */}
                <div className="p-5 bg-zinc-900 border border-zinc-800 rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <Server className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Engine Process Statistics</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-zinc-500">Security Target Rating</span>
                      <span className="font-semibold text-emerald-400">{cockpitReadiness}%</span>
                    </div>
                    <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-zinc-500">Local Sandbox Memory</span>
                      <span className="font-semibold text-zinc-300 font-mono">{localWatch?.process?.memoryMb || 0} MB</span>
                    </div>
                    <div className="bg-zinc-950 border border-zinc-800 p-3 rounded-lg flex justify-between items-center">
                      <span className="text-zinc-500">Active Integrity Scans</span>
                      <span className="font-semibold text-zinc-300 font-mono">{localWatch?.findings?.length || 0} alerts</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. EVIDENCE LEDGER VIEW */}
            {activeTool === 'evidence' && (
              <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full min-h-[520px]">
                <div className="xl:col-span-8 bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col min-h-0">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Evidence Ledger</h3>
                      <p className="text-[10px] text-zinc-500 mt-1">Every meaningful Kevin verdict is recorded with target, action, score, and proof.</p>
                    </div>
                    <button
                      onClick={loadKevinData}
                      className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 rounded-lg text-[10px] font-bold uppercase text-zinc-400 transition-colors flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Refresh
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1 min-h-0">
                    {evidenceLedger.map(event => {
                      const score = Number(event.score || 0);
                      const evidence = Array.isArray(event.evidence) ? event.evidence : [];
                      return (
                        <div key={event.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                          <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase ${verdictTone(event.verdict || event.decision)}`}>
                                  {event.verdict || event.decision || 'observed'}
                                </span>
                                {event.requiresApproval && (
                                  <span className="px-2 py-0.5 rounded text-[9px] font-bold border uppercase text-amber-400 border-amber-500/20 bg-amber-500/10">
                                    review
                                  </span>
                                )}
                              </div>
                              <div className="text-sm font-semibold text-zinc-100 truncate">{event.target || event.type || 'Security event'}</div>
                              <div className="text-[10px] text-zinc-500 font-mono mt-0.5 truncate">{event.source || event.type}</div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <div className={`text-xl font-mono font-bold ${score >= 55 ? 'text-rose-400' : score >= 30 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {Number.isFinite(score) ? score : 0}
                              </div>
                              <div className="text-[9px] text-zinc-600 uppercase tracking-wider">risk score</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                              <span className="text-zinc-600 uppercase font-bold tracking-wider block mb-0.5">Action</span>
                              <span className="text-zinc-300">{event.decision || event.recommendedAction || 'Record and monitor'}</span>
                            </div>
                            <div className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                              <span className="text-zinc-600 uppercase font-bold tracking-wider block mb-0.5">Timestamp</span>
                              <span className="text-zinc-400 font-mono">{event.timestamp ? new Date(event.timestamp).toLocaleString() : 'unknown'}</span>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            {evidence.slice(0, 6).map((item, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-[11px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
                                <span className={`mt-1 h-1.5 w-1.5 rounded-full flex-shrink-0 ${String(item.severity || '').includes('high') || String(item.severity || '').includes('critical') ? 'bg-rose-400' : String(item.severity || '').includes('medium') ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                                <span className="min-w-0">
                                  <span className="font-semibold text-zinc-500 mr-1">{item.type || item.severity || 'evidence'}:</span>
                                  {item.detail || item.reason || JSON.stringify(item)}
                                </span>
                              </div>
                            ))}
                            {evidence.length > 6 && (
                              <div className="text-[10px] text-zinc-600 px-1">+{evidence.length - 6} additional evidence item(s)</div>
                            )}
                            {evidence.length === 0 && (
                              <div className="text-[11px] text-zinc-600 italic px-1">No detailed evidence attached to this record.</div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {evidenceLedger.length === 0 && (
                      <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center text-zinc-600">
                        <Database className="w-8 h-8 mb-3" />
                        <div className="text-sm font-bold text-zinc-500">No evidence recorded yet</div>
                        <div className="text-xs max-w-sm mt-1">Run a sandbox scan, inspect a link, or let Kevin process mail to populate the ledger.</div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="xl:col-span-4 space-y-6 min-h-0">
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Lock className="w-4 h-4 text-amber-400" />
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Unified Review Queue</h3>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                      {approvals.slice(0, 10).map(item => (
                        <div key={item.id} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-zinc-200 truncate">{item.title}</div>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${verdictTone(item.verdict || item.type)}`}>
                              {item.type}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500 font-mono truncate mt-1">{item.target}</div>
                          <div className="text-[10px] text-zinc-500 mt-2">{item.recommendedAction}</div>
                        </div>
                      ))}
                      {approvals.length === 0 && (
                        <div className="text-xs text-zinc-600 italic py-8 text-center">No items awaiting review.</div>
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Server className="w-4 h-4 text-cyan-400" />
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">Local Watch</h3>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const res = await fetch('/api/kevin/local-watch/rebaseline', { method: 'POST' });
                            const data = await res.json();
                            if (data.success) {
                              toast.success('File baseline reset.');
                              loadKevinData();
                            } else {
                              toast.error(data.error || 'Baseline reset failed');
                            }
                          } catch (error) {
                            toast.error(error.message);
                          }
                        }}
                        className="text-[9px] text-zinc-500 hover:text-zinc-200 uppercase font-bold"
                      >
                        Rebaseline
                      </button>
                    </div>
                    <div className="space-y-2 max-h-72 overflow-y-auto custom-scrollbar pr-1">
                      {(localWatch?.findings || []).map((finding, idx) => (
                        <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-lg p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold text-zinc-300">{finding.type}</div>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${verdictTone(finding.severity)}`}>
                              {finding.severity}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500 mt-1">{finding.detail}</div>
                        </div>
                      ))}
                      {(!localWatch?.findings || localWatch.findings.length === 0) && (
                        <div className="text-xs text-zinc-600 italic py-8 text-center">No local watch findings.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 2. THREAT INBOX VIEW */}
            {activeTool === 'inbox' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-[500px]">
                {/* Email Logs List (5 Cols) */}
                <div className="lg:col-span-5 bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex flex-col min-h-0">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3 px-1">Security Audit Log</h3>
                  <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                    {scanLog.map((log, idx) => {
                      const score = log.score ?? (log.status === 'phish' || log.status === 'threat' ? 85 : log.status === 'spam' ? 45 : 10);
                      const badge = getVerdictDetails(score);
                      return (
                        <div 
                          key={idx}
                          onClick={() => {
                            setSandboxSender(log.from || log.origin || '');
                            setSandboxSubject(log.subject || '');
                            setSandboxBody(log.body || log.reason || '');
                            inspectEmail({
                              from: log.from || log.origin || '',
                              subject: log.subject || '',
                              body: log.body || log.reason || ''
                            });
                          }}
                          className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg hover:border-zinc-700 transition-all cursor-pointer flex justify-between items-start gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] text-zinc-500 font-mono mb-1 truncate">
                              {log.from || log.origin || 'unknown sender'}
                            </div>
                            <div className="text-xs font-semibold text-zinc-200 truncate">{log.subject || log.reason || '(No Subject)'}</div>
                            <div className="text-[9px] text-zinc-600 mt-1">{log.time || log.timestamp}</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[8px] font-bold border uppercase flex-shrink-0 ${badge.borderTone} ${badge.textTone} ${badge.bgTone}`}>
                            {badge.label}
                          </span>
                        </div>
                      );
                    })}
                    {scanLog.length === 0 && (
                      <div className="h-full flex items-center justify-center text-xs text-zinc-600 italic py-16">
                        No email transaction logs generated yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Verdict Detail Analysis (7 Cols) */}
                <div className="lg:col-span-7 bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between min-h-0">
                  {sandboxVerdict ? (
                    <div className="space-y-5 flex-1 flex flex-col justify-between">
                      <div className="space-y-4">
                        <div className="border-b border-zinc-800 pb-3">
                          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block mb-1">Inspected Target</span>
                          <h4 className="text-sm font-semibold text-white truncate">{sandboxSubject || '(No Subject)'}</h4>
                          <span className="text-xs text-zinc-400 font-mono block mt-1">From: {sandboxSender}</span>
                          {sandboxVerdict.analysis && (
                            <div className={`mt-2.5 p-3 rounded-lg border text-xs leading-relaxed ${
                              sandboxVerdict.score >= 55
                                ? 'bg-rose-500/10 border-rose-500/20 text-rose-300'
                                : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                            }`}>
                              <span className="font-bold block text-[10px] uppercase tracking-wider mb-1">
                                {sandboxVerdict.score >= 55 ? '⚠️ Risk Verdict Explanation' : '✅ Safety Verdict Explanation'}
                              </span>
                              {sandboxVerdict.analysis}
                            </div>
                          )}
                        </div>

                        {/* Flat Verdict Gauge Dial and Details */}
                        <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-center">
                          {/* Clean SVG Flat Circle Gauge */}
                          <div className="flex flex-col items-center justify-center p-2 bg-zinc-900 border border-zinc-800 rounded-xl relative w-20 h-20 mx-auto sm:mx-0">
                            {(() => {
                              const scoreVal = sandboxVerdict.score || 0;
                              const details = getVerdictDetails(scoreVal);
                              const circleRadius = 30;
                              const circ = 2 * Math.PI * circleRadius;
                              const fillOffset = circ - (Math.min(100, Math.max(0, scoreVal)) / 100) * circ;
                              return (
                                <>
                                  <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 80 80">
                                    <circle cx="40" cy="40" r={circleRadius} stroke="#27272a" strokeWidth="6" fill="transparent" />
                                    <circle cx="40" cy="40" r={circleRadius} stroke={details.color} strokeWidth="6" fill="transparent" strokeDasharray={circ} strokeDashoffset={fillOffset} strokeLinecap="round" />
                                  </svg>
                                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-xs font-mono font-bold text-white leading-none">{scoreVal}%</span>
                                    <span className={`text-[7px] font-bold uppercase tracking-wider mt-0.5 ${details.textTone}`}>{details.label}</span>
                                  </div>
                                </>
                              );
                            })()}
                          </div>

                          <div className="min-w-0 text-center sm:text-left">
                            <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider mb-0.5">Automated Risk Analysis</div>
                            <div className="text-xs text-zinc-300 leading-relaxed font-medium">
                              {sandboxVerdict.analysis || 'Analysis output complete.'}
                            </div>
                          </div>
                        </div>

                        {/* Email Body Payload Preview */}
                        {sandboxBody && (
                          <div className="space-y-1">
                            <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block px-1">Email Content Preview</span>
                            <div className="p-3 bg-zinc-950 border border-zinc-850 rounded-lg text-zinc-300 font-sans text-xs leading-relaxed max-h-32 overflow-y-auto custom-scrollbar whitespace-pre-wrap select-text">
                              {sandboxBody}
                            </div>
                          </div>
                        )}

                        {/* Risk Factors List */}
                        <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-2 pr-1">
                          {sandboxVerdict.riskFactors && sandboxVerdict.riskFactors.length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block px-1">Detected Risks</span>
                              {sandboxVerdict.riskFactors.map((risk, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-xs text-rose-400 bg-rose-950/20 border border-rose-900/30 rounded-lg p-2.5">
                                  <AlertTriangle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                                  <span>{risk}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {sandboxVerdict.mitigations && sandboxVerdict.mitigations.length > 0 && (
                            <div className="space-y-1 pt-2">
                              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider block px-1">Verification Mitigations</span>
                              {sandboxVerdict.mitigations.map((mit, idx) => (
                                <div key={idx} className="flex items-start gap-2 text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 rounded-lg p-2.5">
                                  <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                                  <span>{mit}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Control Actions */}
                      <div className="flex flex-col gap-2 border-t border-zinc-800 pt-4">
                        <div className="flex gap-3">
                          <button
                            onClick={() => executeThreatAction('/api/kevin/threats/block-sender', sandboxSender, `Blocked ${sandboxSender}`)}
                            className="flex-1 py-2 bg-rose-950/40 hover:bg-rose-950/70 text-rose-400 border border-rose-900/40 rounded-lg text-xs font-bold uppercase transition-colors"
                          >
                            Block Sender
                          </button>
                          <button
                            onClick={() => executeThreatAction('/api/kevin/threats/safe-sender', sandboxSender, `Trusted ${sandboxSender}`)}
                            className="flex-1 py-2 bg-emerald-950/40 hover:bg-emerald-950/70 text-emerald-400 border border-emerald-900/40 rounded-lg text-xs font-bold uppercase transition-colors"
                          >
                            Trust Sender
                          </button>
                        </div>
                        
                        <div className="flex gap-3">
                          <button
                            onClick={() => {
                              setActiveTool('rewrite');
                              setSelectedTone('refusal');
                              setRewriteText(`Decline request from sender ${sandboxSender} regarding subject "${sandboxSubject}".\n\nBriefly explain that our security logs flagged this request due to:\n${sandboxVerdict.riskFactors?.map(rf => `- ${rf}`).join('\n') || '- Suspicious metadata verification failure'}`);
                              playKevinSound('click');
                            }}
                            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-bold uppercase transition-colors flex items-center justify-center gap-1.5"
                          >
                            <MailOpen className="w-3.5 h-3.5" />
                            Reply with Stylist
                          </button>
                          
                          <button
                            onClick={() => {
                              const reportContent = `# K.E.V.I.N. Threat Verdict Report\n\n* **Date/Time**: ${new Date().toLocaleString()}\n* **Inspected Sender**: ${sandboxSender}\n* **Subject Header**: ${sandboxSubject}\n* **Verdict Score**: ${sandboxVerdict.score}% (${sandboxVerdict.verdict || 'ANALYZED'})\n\n## Automated Threat Assessment\n${sandboxVerdict.analysis || 'Analysis output complete.'}\n\n## Detected Risk Factors\n${sandboxVerdict.riskFactors?.map(risk => `- [!] ${risk}`).join('\n') || '- None flagged'}\n\n## Mitigations & Verifications\n${sandboxVerdict.mitigations?.map(mit => `- [x] ${mit}`).join('\n') || '- None applied'}\n\n---\n*Report generated by K.E.V.I.N. Operator Guard*`;
                              
                              const blob = new Blob([reportContent], { type: 'text/markdown' });
                              const url = URL.createObjectURL(blob);
                              const link = document.createElement('a');
                              link.href = url;
                              link.download = `kevin-threat-report-${sandboxSender.replace(/[^a-zA-Z0-9]/g, '_')}.md`;
                              document.body.appendChild(link);
                              link.click();
                              document.body.removeChild(link);
                              URL.revokeObjectURL(url);
                              toast.success('Security report downloaded!');
                              playKevinSound('click');
                            }}
                            className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-bold uppercase transition-colors flex items-center justify-center gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Export Audit Report
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                      <Inbox className="w-8 h-8 text-zinc-600 mb-2" />
                      <h4 className="text-sm font-bold text-zinc-400">No Target Inspected</h4>
                      <p className="text-xs text-zinc-600 max-w-xs mt-1">Select an item from the security log on the left to review threat evidence.</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 3. SECURITY SANDBOX & TOOLS VIEW */}
            {activeTool === 'sandbox' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full min-h-[500px]">
                {/* Left Side: Scrutiny Sandbox & URL detonation (7 Cols) */}
                <div className="lg:col-span-7 space-y-6 flex flex-col min-h-0">
                  {/* Scrutiny Sandbox Form */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Email Scrutiny Sandbox</h3>
                      <span className="text-[10px] text-zinc-500 font-medium">Verify payload logic</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[9px] text-zinc-500 font-bold uppercase">Sender Address</label>
                        <input 
                          type="text" 
                          value={sandboxSender} 
                          onChange={(e) => setSandboxSender(e.target.value)} 
                          placeholder="e.g. redacted@example.com" 
                          className="w-full bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] text-zinc-500 font-bold uppercase">Email Subject</label>
                        <input 
                          type="text" 
                          value={sandboxSubject} 
                          onChange={(e) => setSandboxSubject(e.target.value)} 
                          placeholder="e.g. ACTION REQUIRED: Account Locked" 
                          className="w-full bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-zinc-500 font-bold uppercase">Headers & Message Content</label>
                      <textarea 
                        value={sandboxBody} 
                        onChange={(e) => setSandboxBody(e.target.value)} 
                        placeholder="Paste suspect email content or headers..." 
                        className="w-full h-28 bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 resize-none font-mono custom-scrollbar"
                      />
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => inspectEmail()}
                        disabled={isSandboxScanning || (!sandboxSender && !sandboxSubject && !sandboxBody)}
                        className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-650 text-white rounded-lg text-xs font-bold uppercase flex items-center justify-center gap-1.5 transition-colors"
                      >
                        {isSandboxScanning ? (
                          <>
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            <span>Executing Security Scan...</span>
                          </>
                        ) : (
                          <>
                            <Shield className="w-3.5 h-3.5" />
                            <span>Evaluate Security Status</span>
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => {
                          setSandboxSender('');
                          setSandboxSubject('');
                          setSandboxBody('');
                          setSandboxVerdict(null);
                          playKevinSound('click');
                        }}
                        className="px-4 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-400 border border-zinc-800 rounded-lg text-xs font-bold uppercase transition-colors"
                      >
                        Reset
                      </button>
                    </div>
                  </div>

                  {/* URL Detonation Sandbox */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <div className="border-b border-zinc-800 pb-3 flex items-center justify-between">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">URL Detonation Sandbox</h3>
                    </div>
                    <div className="flex gap-2">
                      <input 
                        value={linkUrl} 
                        onChange={(e) => setLinkUrl(e.target.value)} 
                        placeholder="https://suspect-auth-link.com" 
                        className="flex-1 bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono" 
                      />
                      <button 
                        onClick={inspectLink} 
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase transition-colors"
                      >
                        Detonate Link
                      </button>
                    </div>
                    {linkResult && (
                      <div className="p-3 bg-zinc-950 border border-zinc-850 rounded-lg space-y-2 text-xs">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-zinc-300 truncate max-w-[200px]">{linkResult.hostname || linkResult.url}</span>
                          <span className={`px-2 py-0.5 rounded text-[9px] font-bold border uppercase ${verdictTone(linkResult.verdict)}`}>
                            {linkResult.verdict || 'error'} {linkResult.score ?? ''}
                          </span>
                        </div>
                        <p className="text-zinc-500 text-[11px]">{linkResult.recommendedAction || linkResult.error}</p>
                        {(linkResult.evidence || []).map((ev, idx) => (
                          <div key={idx} className="text-[10px] text-zinc-400 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1">
                            <span className="font-semibold text-zinc-500 mr-1">{ev.type}:</span> {ev.detail}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Side: Verification Challenge & History (5 Cols) */}
                <div className="lg:col-span-5 space-y-6 flex flex-col min-h-0">
                  {/* Identity Verification Challenge */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <div className="border-b border-zinc-800 pb-3">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Identity Verification Challenge</h3>
                    </div>
                    <div className="space-y-3">
                      <input 
                        value={pairingSender} 
                        onChange={(e) => setPairingSender(e.target.value)} 
                        placeholder="redacted@example.com" 
                        className="w-full bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500" 
                      />
                      <button 
                        onClick={createPairing} 
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase transition-colors"
                      >
                        Generate Challenge
                      </button>
                    </div>
                    {pairingResult && (
                      <div className="p-3 bg-zinc-950 border border-zinc-850 rounded-lg text-xs">
                        <div className="text-lg font-mono font-bold text-indigo-400">{pairingResult.code || 'None'}</div>
                        <div className="text-zinc-500 mt-1">{pairingResult.message || pairingResult.error}</div>
                      </div>
                    )}
                  </div>

                  {/* Sandbox Scan History */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4 flex flex-col h-[280px] min-h-0">
                    <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-shrink-0">
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">Sandbox Scan History</h3>
                      {sandboxHistory.length > 0 && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch('/api/kevin/sandbox/history', { method: 'DELETE' });
                              if (res.ok) {
                                setSandboxHistory([]);
                                toast.success('Sandbox history cleared.');
                                playKevinSound('click');
                              }
                            } catch (e) {
                              toast.error('Clear failed');
                            }
                          }}
                          className="text-[10px] text-rose-400 hover:text-rose-350 font-bold uppercase transition-colors"
                        >
                          Clear All
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 min-h-0">
                      {sandboxHistory.map(item => {
                        const badge = getVerdictDetails(item.score);
                        return (
                          <div
                            key={item.id}
                            onClick={() => {
                              setSandboxSender(item.from || '');
                              setSandboxSubject(item.subject || '');
                              setSandboxBody(item.body || '');
                              setSandboxVerdict({
                                success: true,
                                verdict: item.verdict,
                                score: item.score,
                                analysis: item.analysis,
                                riskFactors: item.verdict === 'safe' ? [] : ['Suspicious header validation'],
                                mitigations: item.verdict === 'safe' ? ['Valid safe sender list match'] : []
                              });
                              setActiveTool('inbox');
                              toast.info('Loaded manual scan audit details.');
                              playKevinSound('click');
                            }}
                            className="p-2.5 bg-zinc-950 border border-zinc-850 rounded-lg hover:border-zinc-700 transition-all cursor-pointer flex justify-between items-center gap-3"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-[9px] text-zinc-500 font-mono truncate">{item.from}</div>
                              <div className="text-xs font-semibold text-zinc-300 truncate">{item.subject || '(No Subject)'}</div>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold border uppercase flex-shrink-0 ${badge.borderTone} ${badge.textTone} ${badge.bgTone}`}>
                              {item.score}%
                            </span>
                          </div>
                        );
                      })}
                      {sandboxHistory.length === 0 && (
                        <div className="h-full flex items-center justify-center text-xs text-zinc-600 italic">
                          No manual scans performed yet.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 4. TONE STYLIST VIEW */}
            {activeTool === 'rewrite' && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-5">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Operator Style Rewriter</h3>
                  <span className="text-[10px] text-zinc-500 font-medium">Adapt drafts to your style signature</span>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {toneProfiles.map((profile) => {
                    const isActive = selectedTone === profile.id;
                    return (
                      <button
                        key={profile.id}
                        onClick={() => {
                          setSelectedTone(profile.id);
                          playKevinSound('click');
                        }}
                        className={`p-3 rounded-xl border text-left text-xs transition-all ${
                          isActive
                            ? 'bg-indigo-600/10 text-indigo-400 border-indigo-500'
                            : 'bg-zinc-950 text-zinc-500 border-zinc-850 hover:border-zinc-700 hover:text-zinc-300'
                        }`}
                      >
                        <div className="font-bold mb-0.5">{profile.label}</div>
                        <div className="text-[9px] text-zinc-500 leading-tight truncate">{profile.guidance}</div>
                      </button>
                    );
                  })}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase">Original Draft Text</label>
                    <textarea 
                      value={rewriteText} 
                      onChange={(e) => setRewriteText(e.target.value)} 
                      placeholder="Paste your quick notes or email draft here..." 
                      className="w-full h-48 bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 resize-none font-sans custom-scrollbar" 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-zinc-500 font-bold uppercase">Polished Output</label>
                    <div className="w-full h-48 bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 overflow-y-auto font-sans custom-scrollbar select-text whitespace-pre-wrap relative group">
                      {rewriteResult || <span className="text-zinc-600 italic">Rewritten output will render here...</span>}
                      {rewriteResult && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(rewriteResult);
                            toast.success('Polished text copied!');
                          }}
                          className="absolute right-2 top-2 px-2 py-1 bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 rounded hover:text-white transition-colors"
                        >
                          Copy
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <button 
                  onClick={rewriteAsUser} 
                  disabled={!rewriteText.trim()}
                  className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-650 text-white rounded-lg text-xs font-bold uppercase transition-colors"
                >
                  Rewrite Draft Styling
                </button>
              </div>
            )}

            {/* 5. INTEGRATIONS & SETTINGS VIEW */}
            {activeTool === 'settings' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Account Monitored configuration */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-800 pb-3">Monitored Accounts</h3>
                    <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                      {accounts.map(acc => (
                        <div key={acc.id} className="flex justify-between items-center p-3 bg-zinc-950 rounded-lg border border-zinc-850">
                          <div className="flex items-center space-x-3">
                            <Mail className="w-4 h-4 text-zinc-500" />
                            <span className="text-xs text-zinc-300 font-mono">{acc.email}</span>
                          </div>
                          <button 
                            onClick={async () => {
                              const updatedAccounts = accounts.filter(a => a.id !== acc.id);
                              try {
                                const res = await fetch('/api/kevin/config', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    monitored_accounts: updatedAccounts.map(a => a.email),
                                    protocols
                                  })
                                });
                                if (res.ok) {
                                  setAccounts(updatedAccounts);
                                  toast.success(`${acc.email} monitoring stopped.`);
                                }
                              } catch (e) {
                                toast.error('Failed to remove: ' + e.message);
                              }
                            }}
                            className="text-rose-400 hover:text-rose-350 text-[10px] font-bold uppercase"
                          >
                            Stop Monitoring
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <input 
                        type="email" 
                        value={newEmail} 
                        onChange={(e) => setNewEmail(e.target.value)} 
                        placeholder="redacted@example.com" 
                        className="flex-1 bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500" 
                      />
                      <button 
                        onClick={handleAddAccount} 
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase transition-colors"
                      >
                        Monitor
                      </button>
                    </div>
                  </div>

                  {/* Sensitivity settings */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-800 pb-3">Security Sensitivity Slider</h3>
                    <div className="p-4 bg-zinc-950 border border-zinc-850 rounded-xl space-y-4">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-400 font-semibold">Evaluation Threshold</span>
                        <span className="text-indigo-400 font-mono text-xs font-bold">{sensitivity}%</span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Relaxed</span>
                        <input 
                          type="range" 
                          min="0" 
                          max="100" 
                          value={sensitivity} 
                          onChange={(e) => setSensitivity(parseInt(e.target.value))} 
                          className="flex-1 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500" 
                        />
                        <span className="text-[10px] text-zinc-500 font-bold uppercase">Paranoid</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* SMS settings card */}
                <div>
                  <KevinSMSSettings isConnected={isOnline} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Alert notification settings */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-800 pb-3">Incident Webhooks</h3>
                    <div className="space-y-4 bg-zinc-950 p-4 border border-zinc-850 rounded-xl">
                      {/* Slack */}
                      <div className="space-y-1">
                        <label className="text-[9px] text-zinc-500 font-bold uppercase">Slack Incoming Webhook URL</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={notificationSettings.slackWebhook}
                            onChange={(e) => setNotificationSettings(prev => ({ ...prev, slackWebhook: e.target.value }))}
                            placeholder="https://hooks.slack.com/services/..."
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono text-[11px]"
                          />
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/kevin/notifications/configure', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    channel: 'slack',
                                    config: { webhookUrl: notificationSettings.slackWebhook, enabled: true }
                                  })
                                });
                                if (res.ok) toast.success('Slack integration updated.');
                              } catch (e) {
                                toast.error('Slack config error: ' + e.message);
                              }
                            }}
                            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold uppercase transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      </div>

                      {/* Discord */}
                      <div className="space-y-1">
                        <label className="text-[9px] text-zinc-500 font-bold uppercase">Discord Webhook URL</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={notificationSettings.discordWebhook}
                            onChange={(e) => setNotificationSettings(prev => ({ ...prev, discordWebhook: e.target.value }))}
                            placeholder="https://discord.com/api/webhooks/..."
                            className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono text-[11px]"
                          />
                          <button
                            onClick={async () => {
                              try {
                                const res = await fetch('/api/kevin/notifications/configure', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    channel: 'discord',
                                    config: { webhookUrl: notificationSettings.discordWebhook, enabled: true }
                                  })
                                });
                                if (res.ok) toast.success('Discord integration updated.');
                              } catch (e) {
                                toast.error('Discord config error: ' + e.message);
                              }
                            }}
                            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold uppercase transition-colors"
                          >
                            Save
                          </button>
                        </div>
                      </div>

                      {/* Webhook test triggers */}
                      <div className="flex gap-2 pt-2 border-t border-zinc-800">
                        <button
                          onClick={async () => {
                            const res = await fetch('/api/kevin/notifications/test', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ channel: 'slack' })
                            });
                            if (res.ok) toast.success('Slack ping request queued.');
                          }}
                          className="flex-1 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded text-[10px] font-bold uppercase hover:text-white transition-colors"
                        >
                          Ping Slack
                        </button>
                        <button
                          onClick={async () => {
                            const res = await fetch('/api/kevin/notifications/test', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ channel: 'discord' })
                            });
                            if (res.ok) toast.success('Discord ping request queued.');
                          }}
                          className="flex-1 py-1.5 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded text-[10px] font-bold uppercase hover:text-white transition-colors"
                        >
                          Ping Discord
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Mail Provider setup instructions */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 space-y-4">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider border-b border-zinc-800 pb-3">Email Link Setup</h3>
                    <div className="bg-zinc-950 p-4 border border-zinc-850 rounded-xl space-y-4 text-xs text-zinc-400">
                      <p className="leading-relaxed">
                        To interface Kevin with your real inbox, specify your credentials to initiate IMAP network monitoring.
                      </p>
                      <div className="space-y-3">
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-500 font-bold uppercase">Connection Email Address</label>
                          <input
                            type="email"
                            value={agentEmail}
                            onChange={(e) => setAgentEmail(e.target.value)}
                            placeholder="redacted@example.com"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-zinc-500 font-bold uppercase">Secure App Password</label>
                          <input
                            type="password"
                            value={agentPassword}
                            onChange={(e) => setAgentPassword(e.target.value)}
                            placeholder="•••• •••• •••• ••••"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-mono"
                          />
                        </div>
                        <button
                          onClick={async () => {
                            if (!agentEmail || !agentPassword) return;
                            setIsKevinThinking(true);
                            try {
                              const envRes = await fetch('/api/setup/env', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ EMAIL_ADDRESS: agentEmail, APP_PASSWORD: agentPassword })
                              });
                              if (envRes.ok) {
                                toast.success('Imap configuration cached.');
                                setUsingRealEmail(true);
                              }
                            } catch (e) {
                              toast.error('Caching failed: ' + e.message);
                            } finally {
                              setIsKevinThinking(false);
                            }
                          }}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold uppercase transition-colors"
                        >
                          Verify & Cache Credentials
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* System Settings Apply */}
                <div className="flex justify-end pt-2">
                  <button 
                    onClick={handleSaveSettings} 
                    className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs uppercase tracking-wider rounded-lg transition-colors"
                  >
                    Apply Dashboard Configuration
                  </button>
                </div>
              </div>
            )}

            {/* 6. CHAT CONSOLE VIEW */}
            {activeTool === 'chat' && (
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 flex flex-col h-[600px] min-h-[500px]">
                <div className="flex items-center justify-between border-b border-zinc-800 pb-3 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Direct Chat Terminal</h3>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-medium font-mono">interfacing with kevin core</span>
                </div>
                
                {/* Messages Area */}
                <div className="flex-1 overflow-y-auto custom-scrollbar my-4 space-y-4 pr-1">
                  {messages.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8">
                      <MessageSquare className="w-8 h-8 text-zinc-700 mb-2" />
                      <h4 className="text-xs font-bold text-zinc-400">No active transmission</h4>
                      <p className="text-[11px] text-zinc-500 max-w-sm mt-1 leading-relaxed">
                        Initiate connection by sending a message below. K.E.V.I.N. is ready to answer threat queries, system diagnostics, or draft security alerts.
                      </p>
                    </div>
                  ) : (
                    messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`flex flex-col max-w-[85%] rounded-xl p-3.5 text-xs border ${
                          msg.role === 'user'
                            ? 'bg-zinc-800 border-zinc-700 text-white ml-auto rounded-tr-none'
                            : 'bg-indigo-950/40 border-indigo-900/30 text-zinc-100 mr-auto rounded-tl-none'
                        }`}
                      >
                        <div className="font-bold text-[9px] uppercase tracking-wider text-zinc-500 mb-1">
                          {msg.role === 'user' ? 'Operator' : 'K.E.V.I.N.'}
                        </div>
                        <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                      </div>
                    ))
                  )}
                  {isKevinThinking && (
                    <div className="flex flex-col max-w-[85%] rounded-xl p-3.5 text-xs border bg-indigo-950/40 border-indigo-900/30 text-zinc-100 mr-auto rounded-tl-none animate-pulse">
                      <div className="font-bold text-[9px] uppercase tracking-wider text-indigo-400 mb-1">K.E.V.I.N. (THINKING)</div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Parsing intent & synthesizing response...</span>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input bar */}
                <form onSubmit={handleChatSubmit} className="flex gap-2 border-t border-zinc-800 pt-4 flex-shrink-0">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask Kevin anything..."
                    className="flex-1 bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-indigo-500 font-sans"
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isKevinThinking}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 disabled:text-zinc-650 text-white rounded-lg text-xs font-bold uppercase transition-colors flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Send</span>
                  </button>
                </form>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

export default KevinInterface;
