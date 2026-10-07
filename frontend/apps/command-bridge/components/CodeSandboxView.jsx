/**
 * CodeSandboxView.jsx — Code Sandbox full-screen simulation
 *
 * Watch SOMA's engineering swarm decide what to test, debate the approach,
 * and verify candidate patches before they are promoted.
 *
 * Three panels:
 *   INTENT  — what she's chosen to work on and why
 *   SWARM   — multi-agent debate + collaboration messages (Steve / MAX)
 *   EXEC    — the diff forming, then verification output
 *
 * Real swarm data injected from /api/soma/swarm/status when available.
 * Seeded lab candidates keep the learning window active when no live goal is queued.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Code2, Brain, Zap, CheckCircle, XCircle, Terminal,
  GitBranch, Cpu, Activity, Radio, AlertTriangle,
  Layers, RefreshCw, Eye, Shield, Bot, User, ArrowRight, ChevronRight, Package,
  Star, ExternalLink, FlaskConical
} from 'lucide-react';

// ── Work candidates (real SOMA files + reason SOMA would want to improve them) ──

const CANDIDATES = [
  {
    file: 'arbiters/AttentionArbiter.js',
    area: 'Focus matching',
    complexity: 'low',
    mode: 'solo',
    intent: 'setFocus() uses exact string equality for topic matching. Fuzzy prefix matching would let sub-topics inherit parent focus (e.g. "finance.crypto" inheriting "finance" focus). Currently misses 30-40% of relevant signals under focused sessions.',
    before: [
      'if (signal.topic === this.focusTopic) {',
      '  return true; // topic match',
      '}',
    ],
    after: [
      'const topic  = signal.topic || \'\';',
      'const focus  = this.focusTopic || \'general\';',
      'const match  = focus === \'general\'',
      '  || topic === focus',
      '  || topic.startsWith(focus + \'.\');',
      'if (match) return true;',
    ],
    verifyCmd: 'node --input-type=module --eval "import(\'./arbiters/AttentionArbiter.js\').then(() => console.log(\'OK\'))"',
  },
  {
    file: 'daemons/BaseDaemon.js',
    area: 'Watchdog restart backoff',
    complexity: 'low',
    mode: 'solo',
    intent: 'Daemon watchdog uses a fixed 10-second restart delay. If multiple daemons crash simultaneously (thundering herd), they all flood back at t+10s. Exponential jitter spreads restarts across a window and reduces cascade risk.',
    before: [
      'await new Promise(r => setTimeout(r, 10000));',
      'await this.start();',
    ],
    after: [
      'const crashes = this._crashCount || 0;',
      'const base    = Math.min(10000 * Math.pow(2, crashes), 60000);',
      'const jitter  = Math.floor(Math.random() * 3000);',
      'await new Promise(r => setTimeout(r, base + jitter));',
      'this._crashCount = (crashes + 1);',
      'await this.start();',
    ],
    verifyCmd: 'node --input-type=module --eval "import(\'./daemons/BaseDaemon.js\').then(() => console.log(\'OK\'))"',
  },
  {
    file: 'server/routes/somaRoutes.js',
    area: 'Chat pipeline latency',
    complexity: 'medium',
    mode: 'steve',
    intent: 'Memory recall fires on every chat message including one-word greetings. Recall adds 200-800ms of latency on short queries where the result is always empty anyway. A greeting guard on the /chat route would make "hi" responses feel instant.',
    before: [
      'const memories = await Promise.race([',
      '  system.mnemonicArbiter.recall(message, 3),',
      '  new Promise((_, rej) => setTimeout(() => rej(new Error(\'timeout\')), 3000))',
      ']).catch(() => []);',
    ],
    after: [
      'const isGreeting = /^(hi|hey|hello|yo|sup)[.!?]?$/i.test(message.trim());',
      'const memories = isGreeting ? [] : await Promise.race([',
      '  system.mnemonicArbiter.recall(message, 3),',
      '  new Promise((_, rej) => setTimeout(() => rej(new Error(\'timeout\')), 3000))',
      ']).catch(() => []);',
    ],
    verifyCmd: 'curl -s http://localhost:3001/health | node -e "process.stdin.pipe(process.stdout)"',
  },
  {
    file: 'core/MessageBroker.cjs',
    area: 'Signal routing bottleneck',
    complexity: 'high',
    mode: 'max',
    intent: 'MessageBroker routes signals by iterating over all subscribers for every topic. With 178+ arbiters, a hot signal path (e.g. health.metrics every 30s) scans all registrations. A pre-built topic→handler Map index would cut routing from O(N) to O(1). Architecture change — requesting MAX swarm assist.',
    before: [
      'const subs = this.subscribers.get(topic) || [];',
      'for (const handler of subs) {',
      '  try { await handler(signal); }',
      '  catch (e) { this.logger.warn(e.message); }',
      '}',
    ],
    after: [
      'const handlers = this._topicIndex.get(topic) || [];',
      'if (!handlers.length) return;',
      'const results = await Promise.allSettled(',
      '  handlers.map(h => h(signal))',
      ');',
      'results.filter(r => r.status === \'rejected\')',
      '  .forEach(r => this.logger.warn(r.reason?.message));',
    ],
    verifyCmd: 'node -e "const b = require(\'./core/MessageBroker.cjs\'); console.log(\'OK\')"',
  },
  {
    file: 'arbiters/SOMArbiterV3.js',
    area: 'Soul context caching',
    complexity: 'medium',
    mode: 'solo',
    intent: 'SOMArbiterV3 rebuilds the soul/narrative context string on every single chat request. The constitutional values, identity block, and dissonance layer are stable across requests — they only need rebuilding when a relevant signal fires. Caching would save ~15ms per response.',
    before: [
      'async _buildSoulContext(message) {',
      '  const values = this._loadConstitutionalValues();',
      '  const identity = this._buildIdentityBlock();',
      '  const dissonance = await this._checkDissonance(message);',
      '  return `${values}\\n${identity}\\n${dissonance}`;',
      '}',
    ],
    after: [
      'async _buildSoulContext(message) {',
      '  if (!this._soulCache || Date.now() > this._soulCacheExpiry) {',
      '    this._soulCache = this._loadConstitutionalValues()',
      '      + \'\\n\' + this._buildIdentityBlock();',
      '    this._soulCacheExpiry = Date.now() + 60000; // 1 min TTL',
      '  }',
      '  const dissonance = await this._checkDissonance(message);',
      '  return `${this._soulCache}\\n${dissonance}`;',
      '}',
    ],
    verifyCmd: 'node --input-type=module --eval "import(\'./arbiters/SOMArbiterV3.js\').then(() => console.log(\'OK\'))"',
  },
  {
    file: 'core/SelfEvolvingGoalEngine.js',
    area: 'Goal priority scoring',
    complexity: 'medium',
    mode: 'steve',
    intent: 'Goal priority scores are recalculated by iterating every goal every time any signal fires. Most signals are irrelevant to most goals. A topic-tagging system on goals would let the engine only recompute goals tagged with the incoming signal type — reducing CPU on goal-heavy sessions.',
    before: [
      'onSignal(signal) {',
      '  for (const goal of this.goals) {',
      '    goal.priority = this._computePriority(goal, signal);',
      '  }',
      '  this._sortGoals();',
      '}',
    ],
    after: [
      'onSignal(signal) {',
      '  const relevant = this.goals.filter(g =>',
      '    !g.tags?.length || g.tags.includes(signal.type)',
      '  );',
      '  for (const goal of relevant) {',
      '    goal.priority = this._computePriority(goal, signal);',
      '  }',
      '  if (relevant.length) this._sortGoals();',
      '}',
    ],
    verifyCmd: 'node --input-type=module --eval "import(\'./core/SelfEvolvingGoalEngine.js\').then(() => console.log(\'OK\'))"',
  },
  {
    file: 'daemons/MemoryPrunerDaemon.js',
    area: 'Substance grading tuning',
    complexity: 'low',
    mode: 'solo',
    intent: 'Calibration pass after first run shows the substance threshold of 0.40 may be slightly aggressive — some medium-length conversational memories score 0.38-0.42. Nudging the purgatory threshold down to 0.35 and adding a `conversational` keyword boost would reduce false purgatory rate.',
    before: [
      'const SUBSTANCE_THRESHOLD = 0.40;',
    ],
    after: [
      'const SUBSTANCE_THRESHOLD = 0.35; // tuned after calibration pass',
    ],
    verifyCmd: 'node --input-type=module --eval "import(\'./daemons/MemoryPrunerDaemon.js\').then(() => console.log(\'OK\'))"',
  },
];

// ── Agent definitions ──────────────────────────────────────────────────────

const AGENTS = {
  LOGOS:      { color: '#60a5fa', label: 'LOGOS',      role: 'Logic & Correctness' },
  THALAMUS:   { color: '#fbbf24', label: 'THALAMUS',   role: 'Risk & Blast Radius' },
  PROMETHEUS: { color: '#34d399', label: 'PROMETHEUS', role: 'Impact & Strategy' },
  AURORA:     { color: '#c084fc', label: 'AURORA',     role: 'Coherence & Identity' },
  SYSTEM:     { color: '#71717a', label: 'SYSTEM',     role: 'Evidence Gate' },
};

function asDisplayText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value.text === 'string') return value.text;
  if (typeof value.response === 'string') return value.response;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.output === 'string') return value.output;
  try { return JSON.stringify(value); } catch { return String(value); }
}

// ── Debate generator ───────────────────────────────────────────────────────

function generateDebate(candidate) {
  const { file, area, complexity, mode, intent } = candidate;
  const messages = [];

  const LOGOS_lines = {
    low:    `Pattern is correct and isolated to a single method. No side-effects on public API. Safe to apply with existing test coverage.`,
    medium: `Logic change touches ${file.split('/').pop()} public interface. Need to verify callers don't rely on current behavior. Two call sites confirmed safe.`,
    high:   `Architecture-level change. ${file} has 178 downstream subscribers in the CNS. A staged rollout is required — index must be built before switching routing path.`,
  };
  const THALAMUS_lines = {
    low:    `Blast radius: 1 file. No external callers. Rollback is a one-line revert. Risk score: 12/100. Recommend proceed.`,
    medium: `Blast radius: 3 files. Chat pipeline touches MnemonicArbiter and QuadBrain downstream. Risk score: 34/100. Verify integration path.`,
    high:   `Blast radius: SYSTEM-WIDE. MessageBroker is the CNS spine. A routing regression would silence all inter-arbiter signals. Risk score: 78/100. Requires dual-path validation before cutover.`,
  };
  const PROMETHEUS_lines = {
    low:    `High impact-to-effort ratio. ${area} affects every ${complexity}-frequency operation. Expected latency improvement is measurable. Recommend immediate apply.`,
    medium: `Medium impact. Improvement is real but incremental. Fits into the short-term roadmap — doesn't block anything critical. Value-to-risk is positive.`,
    high:   `This is the highest-leverage change I can identify. O(1) routing vs O(N) unlocks the entire signal-density scaling path. Worth the risk if THALAMUS approves a staged approach.`,
  };
  const AURORA_lines = {
    low:    `Change feels clean. Consistent with how I experience SOMA's existing patterns. No identity drift risk.`,
    medium: `The intent is coherent with her architecture values. The change to ${area} reinforces SOMA's principle of not wasting cycles on noise.`,
    high:   `This touches SOMA's spine. It should feel like surgery, not a refactor. MAX's involvement is the right call — this is too important for unilateral swarm action.`,
  };

  messages.push({ agent: 'LOGOS',      text: LOGOS_lines[complexity]     });
  messages.push({ agent: 'THALAMUS',   text: THALAMUS_lines[complexity]  });
  messages.push({ agent: 'PROMETHEUS', text: PROMETHEUS_lines[complexity] });
  messages.push({ agent: 'AURORA',     text: AURORA_lines[complexity]    });

  const confidence = { low: 0.88, medium: 0.73, high: 0.61 }[complexity];
  const proceed = complexity !== 'high' || mode === 'max';

  return { messages, confidence, proceed, mode };
}

// ── Collaboration message templates ────────────────────────────────────────

function buildCollabMessages(candidate, proceed) {
  return [];
}

// ── Diff line component ────────────────────────────────────────────────────

function DiffView({ before, after, filename, forming, formLine }) {
  const shownAfter = forming ? after.slice(0, formLine) : after;
  return (
    <div className="font-mono text-[10px] space-y-px">
      <div className="text-zinc-600 mb-2 flex items-center gap-1.5">
        <GitBranch className="w-3 h-3" />
        <span>{filename}</span>
      </div>
      {before.map((line, i) => (
        <div key={`b${i}`} className="flex gap-2 px-2 py-0.5 rounded bg-rose-500/8 border border-rose-500/10">
          <span className="text-rose-500 select-none w-3 shrink-0">-</span>
          <span className="text-rose-300">{line}</span>
        </div>
      ))}
      {shownAfter.map((line, i) => (
        <div key={`a${i}`} className={`flex gap-2 px-2 py-0.5 rounded bg-emerald-500/8 border border-emerald-500/10 ${forming && i === shownAfter.length - 1 ? 'animate-pulse' : ''}`}>
          <span className="text-emerald-500 select-none w-3 shrink-0">+</span>
          <span className="text-emerald-300">{line}</span>
        </div>
      ))}
    </div>
  );
}

// ── Collab message renderer ────────────────────────────────────────────────

function CollabMessage({ msg }) {
  const isMax   = msg.from === 'MAX'   || msg.to === 'MAX';
  const isSteve = msg.from === 'Steve' || msg.to === 'Steve';
  const color   = isMax ? 'text-orange-400' : isSteve ? 'text-cyan-400' : 'text-fuchsia-400';
  const bgFrom  = isMax ? 'bg-orange-500/10 border-orange-500/20' : isSteve ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-fuchsia-500/10 border-fuchsia-500/20';
  const bgTo    = 'bg-zinc-800/60 border-white/5';
  const isSoma  = msg.from === 'SOMA';

  return (
    <div className={`flex ${isSoma ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] px-2.5 py-1.5 rounded-xl border text-[10px] ${isSoma ? bgFrom : bgTo}`}>
        <div className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 ${isSoma ? color : 'text-zinc-500'}`}>
          {msg.from} → {msg.to}
        </div>
        <div className="text-zinc-300 leading-relaxed">{asDisplayText(msg.text)}</div>
      </div>
    </div>
  );
}

function CodebaseSignal({ overview }) {
  const modules = overview?.modules || [];
  const functions = overview?.functions || [];
  const topModules = modules
    .filter(m => m.stats?.files > 0)
    .sort((a, b) => (b.stats.files || 0) - (a.stats.files || 0))
    .slice(0, 6);
  const symbolSets = functions.filter(f => f.symbols?.length).slice(0, 4);

  return (
    <div className="border-b border-white/5 bg-black/20 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <Code2 className="w-3.5 h-3.5 text-emerald-400" />
        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Codebase Signal</span>
        <span className="ml-auto text-[9px] text-zinc-700 font-mono">
          {overview?.totals?.files || 0} source files · {overview?.experiments?.promotable || 0} promotable experiments
        </span>
      </div>
      <div className="grid grid-cols-6 gap-1.5 mb-2">
        {topModules.map(mod => (
          <div key={mod.key} className="rounded border border-white/8 bg-zinc-900/60 px-2 py-1 min-w-0">
            <div className="text-[8px] text-zinc-600 uppercase tracking-wider truncate">{mod.label}</div>
            <div className="text-[12px] font-mono text-zinc-300">{mod.stats.files}</div>
          </div>
        ))}
      </div>
      {symbolSets.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {symbolSets.map(file => (
            <div key={file.file} className="rounded border border-white/8 bg-zinc-900/40 px-2 py-1.5 min-w-0">
              <div className="font-mono text-[9px] text-zinc-500 truncate mb-1">{file.file.split('/').slice(-2).join('/')}</div>
              <div className="flex flex-wrap gap-1">
                {file.symbols.slice(0, 5).map(sym => (
                  <span key={sym} className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/15 font-mono">
                    {sym}()
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Phase timing (ms) ─────────────────────────────────────────────────────

const PHASE_MS = {
  selecting:   2500,
  researching: 4000,
  debating:    1800,  // per agent message
  deciding:    1200,
  executing:   600,   // per diff line
  verifying:   3500,
  complete:    6000,
};

// ── Main component ─────────────────────────────────────────────────────────

export default function CodeSandboxView() {
  const [phase,          setPhase]          = useState('idle');
  const [currentWork,    setCurrentWork]    = useState(null);
  const [queue,          setQueue]          = useState([]);
  const [debate,         setDebate]         = useState([]);
  const [decision,       setDecision]       = useState(null);
  const [diffState,      setDiffState]      = useState(null);  // { before, after, forming, formLine }
  const [execLog,        setExecLog]        = useState([]);
  const [collabMsgs,     setCollabMsgs]     = useState([]);
  const [shownCollab,    setShownCollab]    = useState([]);
  const [cycles,         setCycles]         = useState(0);
  const [realSwarm,      setRealSwarm]      = useState(null);
  const [codebaseOverview, setCodebaseOverview] = useState(null);
  // validation results keyed by file — { score, tier, promoted, syntaxPassed, nemesisVerdict, message }
  const [validations,    setValidations]    = useState({});
  const phaseRef         = useRef(phase);
  phaseRef.current       = phase;
  const cancelledRef     = useRef(false);
  const debateEndRef     = useRef(null);
  const collabEndRef     = useRef(null);
  // Refs so the simulation loop always reads latest values without restarting
  const realSwarmRef         = useRef(null);
  const realCandidatesRef    = useRef(null);

  // ── Scroll to bottom of debate / collab on update ──────────────────────
  useEffect(() => { debateEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [debate]);
  useEffect(() => { collabEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [shownCollab]);

  // ── Poll real swarm status + candidates ───────────────────────────────
  const [realCandidates, setRealCandidates] = useState(null);

  useEffect(() => {
    const pollStatus = async () => {
      try {
        const r = await fetch('/api/soma/swarm/status');
        if (r.ok) { const d = await r.json(); const v = d.active ? d : null; setRealSwarm(v); realSwarmRef.current = v; }
      } catch {}
    };
    const pollCandidates = async () => {
      try {
        const r = await fetch('/api/soma/swarm/candidates');
        if (r.ok) { const d = await r.json(); setRealCandidates(d); realCandidatesRef.current = d; }
      } catch {}
    };
    pollStatus(); pollCandidates();
    const t1 = setInterval(pollStatus, 15000);
    const t2 = setInterval(pollCandidates, 30000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, []);

  useEffect(() => {
    const pollOverview = async () => {
      try {
        const r = await fetch('/api/soma/swarm/codebase-overview');
        if (r.ok) setCodebaseOverview(await r.json());
      } catch {}
    };
    pollOverview();
    const t = setInterval(pollOverview, 45000);
    return () => clearInterval(t);
  }, []);

  // ── Autonomous simulation loop ─────────────────────────────────────────
  useEffect(() => {
    cancelledRef.current = false;
    const delay = ms => new Promise(res => {
      if (cancelledRef.current) return res();
      setTimeout(res, ms);
    });
    const go = () => !cancelledRef.current;

    // Build display queue from real candidates only.
    const buildQueue = (exclude, realQ) => {
      return (realQ || [])
        .filter(c => c.file && c.file !== exclude?.file)
        .slice(0, 3)
        .map(c => {
          const synth = CANDIDATES.find(s => s.file === c.file);
          return synth ? { ...synth, intent: c.intent || synth.intent, source: 'real' }
                       : { ...c, before: [], after: [], verifyCmd: `node --check ${c.file}`, source: 'real' };
        });
    };

    // Pick the best next candidate — always reads from refs (fresh data, no stale closure)
    const pickCandidate = (exclude) => {
      const rs = realSwarmRef.current;
      const rc = realCandidatesRef.current;
      // Active real swarm task takes priority
      if (rs?.file) {
        const synth = CANDIDATES.find(s => s.file === rs.file);
        return synth
          ? { ...synth, file: rs.file, intent: rs.intent || synth.intent, phase: rs.phase, source: 'real' }
          : { file: rs.file, area: rs.area || 'active task', complexity: 'medium', mode: 'solo',
              intent: rs.intent || 'Real engineering swarm task', before: [], after: [],
              verifyCmd: `node --check ${rs.file}`, source: 'real' };
      }
      // Next in real goal/optimizer queue
      const realQueue = (rc?.queue || []).filter(c => c.file && c.file !== exclude?.file);
      if (realQueue.length) {
        const item = realQueue[0];
        const synth = CANDIDATES.find(s => s.file === item.file);
        return synth
          ? { ...synth, intent: item.intent || synth.intent, source: 'real' }
          : { ...item, before: [], after: [], verifyCmd: `node --check ${item.file}`, source: 'real' };
      }
      return null;
    };

    // Fetch real file content for candidates without hardcoded before[]
    const fetchSnippet = async (file) => {
      try {
        const r = await fetch(`/api/soma/swarm/file-snippet?file=${encodeURIComponent(file)}&maxLines=6`);
        if (r.ok) {
          const d = await r.json();
          return d.lines?.map(l => l.text).filter(Boolean) || [];
        }
      } catch {}
      return [];
    };

    const run = async () => {
      while (!cancelledRef.current) {

        // Pick work — reads refs for freshest real data
        setPhase('selecting');
        let candidate = pickCandidate(currentWork);
        if (!candidate) {
          setCurrentWork(null);
          setQueue([]);
          setDebate([]);
          setDecision(null);
          setDiffState(null);
          setExecLog(['No live engineering queue item found. Watch is idle instead of replaying seeded theatre.']);
          setShownCollab([]);
          setCollabMsgs([]);
          setPhase('idle');
          await delay(5000);
          continue;
        }

        // Real candidate without hardcoded diff — fetch actual current file lines
        if (candidate.source === 'real' && !candidate.before?.length) {
          const snippet = await fetchSnippet(candidate.file);
          candidate = { ...candidate, before: snippet, after: [] };
        }

        setCurrentWork(candidate);
        setQueue(buildQueue(candidate, realCandidatesRef.current?.queue));
        setDebate([]);
        setDecision(null);
        setDiffState(null);
        setExecLog([]);
        setShownCollab([]);
        setCollabMsgs([]);

        await delay(PHASE_MS.selecting);
        if (!go()) break;

        // Research
        setPhase('researching');
        await delay(PHASE_MS.researching);
        if (!go()) break;

        // Debate — real lobe calls (Ollama local), synthetic fallback if offline
        setPhase('debating');
        let debateResult = null;
        try {
          const dr = await fetch('/api/soma/swarm/debate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              file:       candidate.file,
              area:       candidate.area,
              complexity: candidate.complexity,
              mode:       candidate.mode,
              intent:     candidate.intent,
              before:     candidate.before?.slice(0, 4),
              after:      candidate.after?.slice(0, 4),
            }),
          });
          if (dr.ok) debateResult = await dr.json();
        } catch {}

        // Do not fabricate debate if local lobes are unavailable.
        if (!debateResult || debateResult.fallback || !debateResult.messages) {
          debateResult = {
            messages: [{ agent: 'SYSTEM', text: 'No live lobe debate returned. Synthetic fallback is disabled for truthfulness.', live: false }],
            confidence: 0,
            proceed: false,
            mode: candidate.mode,
            fromLobes: false,
            riskScore: null,
            cached: false,
          };
        }

        const { confidence, proceed } = debateResult;
        const messages = (debateResult.messages || []).map(msg => ({ ...msg, text: asDisplayText(msg.text) }));
        const finalVerdict = asDisplayText(debateResult.finalVerdict);
        // Cached results drip faster — she's recalling, not thinking from scratch
        const msgDelay = debateResult.cached ? 350 : PHASE_MS.debating;
        for (const msg of messages) {
          if (!go()) break;
          await delay(msgDelay);
          setDebate(prev => [...prev, msg]);
        }
        if (!go()) break;

        // Decide
        setPhase('deciding');
        setDecision({ mode: candidate.mode, confidence, proceed, fromLobes: debateResult.fromLobes, riskScore: debateResult.riskScore, finalVerdict, cached: debateResult.cached });
        const collabLog = buildCollabMessages(candidate, proceed);
        setCollabMsgs(collabLog);
        await delay(PHASE_MS.deciding);
        if (!go()) break;

        if (!proceed) {
          setPhase('complete');
          await delay(PHASE_MS.complete);
          setCycles(c => c + 1);
          continue;
        }

        // Collaboration messages drip in
        if (collabLog.length > 0) {
          for (let i = 0; i < collabLog.length - 1; i++) {
            if (!go()) break;
            await delay(1400);
            setShownCollab(prev => [...prev, collabLog[i]]);
          }
          await delay(800);
          if (!go()) break;
        }

        // Execution is evidence-only here. No patch is applied from the Watch pane.
        setPhase('executing');
        setDiffState(null);
        setExecLog(prev => [...prev, 'No patch applied from Watch. Awaiting a real backend engineering result or Pulse staged patch.']);

        // Show last collab message (if any) after patch forms
        if (collabLog.length > 0 && go()) {
          setShownCollab(prev => [...prev, collabLog[collabLog.length - 1]]);
        }

        // Verify the target file with the real preflight route.
        setPhase('verifying');
        let verifyLines = [`$ POST /api/soma/swarm/preflight ${candidate.file}`];
        try {
          const pr = await fetch('/api/soma/swarm/preflight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: candidate.file, includeBuild: false }),
          });
          const pf = await pr.json();
          verifyLines = [
            ...verifyLines,
            ...(pf.checks || []).map(check => `${check.ok ? '✓' : '✗'} ${check.command} (${check.durationMs}ms)`),
            pf.success || pf.ok ? `✓ Preflight passed for ${candidate.file}` : `✗ Preflight failed for ${candidate.file}: ${pf.error || pf.message || 'check output unavailable'}`,
          ];
        } catch (err) {
          verifyLines = [...verifyLines, `✗ Preflight request failed: ${err.message}`];
        }
        for (const line of verifyLines) {
          if (!go()) break;
          await delay(420 + Math.random() * 350);
          setExecLog(prev => [...prev, line]);
        }
        if (!go()) break;

        // Complete. Validation is only meaningful when a real patch artifact exists.
        setPhase('complete');
        setCycles(c => c + 1);
        setExecLog(prev => [...prev, 'Validation skipped: no real patch artifact was produced by this Watch cycle.']);
        await delay(PHASE_MS.complete);
      }
    };

    run();
    return () => { cancelledRef.current = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── View state: watch | promoted | rd | experiments ───────────────────
  const [activeView,     setActiveView]     = useState('watch'); // 'watch' | 'promoted' | 'rd' | 'experiments'

  // ── R&D Discovery state ───────────────────────────────────────────────
  const [rdTopic,        setRdTopic]        = useState('agents');
  const [rdTopics,       setRdTopics]       = useState([]);
  const [rdCandidates,   setRdCandidates]   = useState([]);
  const [rdLoading,      setRdLoading]      = useState(false);
  const [rdError,        setRdError]        = useState(null);
  const [rdMeta,         setRdMeta]         = useState(null);
  const [rdExpanded,     setRdExpanded]     = useState(null);
  const [rdProposed,     setRdProposed]     = useState({}); // id → true
  const [codeExperiments, setCodeExperiments] = useState({ experiments: [], summary: {} });
  const [expandedCodeExperiment, setExpandedCodeExperiment] = useState(null);
  const [runningCodeExperiment, setRunningCodeExperiment] = useState({});
  const [runningPatchProposal, setRunningPatchProposal] = useState({});
  const [runningPatchDevelopment, setRunningPatchDevelopment] = useState({});

  useEffect(() => {
    fetch('/api/soma/swarm/rd-topics').then(r => r.ok && r.json()).then(d => d && setRdTopics(d.topics || [])).catch(() => {});
  }, []);

  const rdDiscover = useCallback(async (topic, force = false) => {
    setRdLoading(true);
    setRdError(null);
    setRdCandidates([]);
    try {
      const r = await fetch('/api/soma/swarm/rd-discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, forceRefresh: force }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) {
        setRdError(d.error || d.message || 'R&D discovery failed');
        setRdMeta(d || null);
        return;
      }
      setRdCandidates(d.candidates || []);
      setRdMeta({
        cached: d.cached === true,
        topic: d.topic,
        query: d.query,
        searchErrors: d.searchErrors || [],
        count: d.candidates?.length || 0,
      });
      if (!d.candidates?.length) {
        setRdError(`No repositories found for ${topic}. Try another topic or refresh.`);
      }
    } catch (err) {
      setRdError(err.message || 'R&D discovery failed');
    }
    finally { setRdLoading(false); }
  }, []);

  // Auto-load when switching to R&D tab
  useEffect(() => {
    if (activeView === 'rd' && rdCandidates.length === 0 && !rdLoading) rdDiscover(rdTopic);
  }, [activeView]); // eslint-disable-line

  const refreshCodeExperiments = useCallback(async () => {
    try {
      const r = await fetch('/api/soma/swarm/code-experiments?limit=40');
      if (r.ok) setCodeExperiments(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    refreshCodeExperiments();
    const t = setInterval(refreshCodeExperiments, 15000);
    return () => clearInterval(t);
  }, [refreshCodeExperiments]);

  const runCodeExperiment = useCallback(async (id) => {
    setRunningCodeExperiment(prev => ({ ...prev, [id]: true }));
    try {
      const r = await fetch(`/api/soma/swarm/code-experiments/${encodeURIComponent(id)}/run`, { method: 'POST' });
      if (r.ok) {
        const d = await r.json();
        setCodeExperiments(prev => ({
          ...prev,
          experiments: prev.experiments.map(item => item.id === id ? d.experiment : item),
          summary: d.summary || prev.summary,
        }));
      }
    } catch {}
    finally {
      setRunningCodeExperiment(prev => ({ ...prev, [id]: false }));
      refreshCodeExperiments();
    }
  }, [refreshCodeExperiments]);

  const proposeSomaPatch = useCallback(async (id) => {
    setRunningPatchProposal(prev => ({ ...prev, [id]: true }));
    try {
      const r = await fetch(`/api/soma/swarm/code-experiments/${encodeURIComponent(id)}/propose-patch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ iterations: 10000, queue: true }),
      });
      if (r.ok) {
        const d = await r.json();
        setCodeExperiments(prev => ({
          ...prev,
          experiments: prev.experiments.map(item => item.id === id ? d.experiment : item),
          summary: d.summary || prev.summary,
        }));
      }
    } catch {}
    finally {
      setRunningPatchProposal(prev => ({ ...prev, [id]: false }));
      refreshCodeExperiments();
    }
  }, [refreshCodeExperiments]);

  const developExperimentPatch = useCallback(async (id) => {
    setRunningPatchDevelopment(prev => ({ ...prev, [id]: true }));
    try {
      const r = await fetch(`/api/soma/swarm/code-experiments/${encodeURIComponent(id)}/develop-patch`, { method: 'POST' });
      if (r.ok) {
        const d = await r.json();
        setCodeExperiments(prev => ({
          ...prev,
          experiments: prev.experiments.map(item => item.id === id ? d.experiment : item),
          summary: d.summary || prev.summary,
        }));
      }
    } catch {}
    finally {
      setRunningPatchDevelopment(prev => ({ ...prev, [id]: false }));
      refreshCodeExperiments();
    }
  }, [refreshCodeExperiments]);

  // ── Promotion lab state ───────────────────────────────────────────────
  const [promoteStatus,   setPromoteStatus]   = useState({}); // file → { status, agent, msg }
  const [expandedPromote, setExpandedPromote] = useState(null);
  const [outcomes,       setOutcomes]       = useState({ outcomes: [], optimHistory: [], totalRuns: 0, successRate: null });

  // Poll learning outcomes feed
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch('/api/soma/swarm/outcomes?limit=12');
        if (r.ok) setOutcomes(await r.json());
      } catch {}
    };
    poll();
    const t = setInterval(poll, 20000);
    return () => clearInterval(t);
  }, []);

  // All promotion candidates — real queue items first (SOMA's own goals), seeded candidates as lab backlog
  const promoteList = useMemo(() => {
    const realItems = (realCandidates?.queue || [])
      .filter(c => c.file)
      .map(c => {
        const synth = CANDIDATES.find(s => s.file === c.file);
        return synth
          ? { ...synth, intent: c.intent || synth.intent, source: 'real', priority: c.priority }
          : { ...c, before: [], after: [], verifyCmd: `node --check ${c.file}`, source: 'real' };
      });
    // Add synthetic candidates not already covered by real queue
    const synthFill = CANDIDATES.filter(c => !realItems.find(r => r.file === c.file));
    return [...realItems, ...synthFill];
  }, [realCandidates]);

  const promotedExperiments = useMemo(() => {
    return (codeExperiments.experiments || [])
      .filter(exp => exp.status === 'promoted')
      .sort((a, b) => new Date(b.promotionPaperTrail?.promotedAt || b.updatedAt || b.createdAt || 0) - new Date(a.promotionPaperTrail?.promotedAt || a.updatedAt || a.createdAt || 0));
  }, [codeExperiments.experiments]);

  const doPromote = useCallback(async (candidate) => {
    const f = candidate.file;
    const agent = { solo:'SOMA', steve:'Steve', max:'MAX' }[candidate.mode] || 'SOMA';
    setPromoteStatus(prev => ({ ...prev, [f]: { status: 'preflight', agent, msg: 'Running syntax and production build checks...' } }));
    try {
      const pr = await fetch('/api/soma/swarm/preflight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: f, includeBuild: true }),
      });
      const preflight = await pr.json();
      if (!pr.ok || !preflight.success) {
        setPromoteStatus(prev => ({
          ...prev,
          [f]: {
            status: 'blocked',
            agent,
            msg: preflight.error || preflight.message || 'Preflight failed. Promotion blocked before code changes.',
            preflight,
          },
        }));
        return;
      }

      setPromoteStatus(prev => ({ ...prev, [f]: { status: 'promoting', agent, msg: 'Preflight passed. Running engineering lab swarm...' } }));
      const r = await fetch('/api/soma/swarm/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file:       f,
          area:       candidate.area,
          after:      candidate.after,
          mode:       candidate.mode,
          confidence: { low: 0.88, medium: 0.73, high: 0.61 }[candidate.complexity] || 0.75,
          intent:     candidate.intent,
          requirePreflight: true,
        }),
      });
      const d = await r.json();
      // Refresh outcomes after promotion so the learning feed updates
      fetch('/api/soma/swarm/outcomes?limit=12').then(r => r.ok && r.json()).then(d => d && setOutcomes(d)).catch(() => {});
      setPromoteStatus(prev => ({
        ...prev,
        [f]: d.success
          ? { status: 'promoted', agent: d.agent, msg: d.message, preflight: d.preflight, postflight: d.postflight }
          : {
              status: d.blocked ? 'blocked' : 'error',
              agent: d.agent,
              msg: d.error || d.message || 'Unknown error',
              preflight: d.preflight,
              postflight: d.postflight,
              rollbackCheck: d.rollbackCheck,
            },
      }));
    } catch (err) {
      setPromoteStatus(prev => ({ ...prev, [f]: { status: 'error', msg: err.message } }));
    }
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────

  const phaseColors = {
    idle:        'zinc',
    selecting:   'zinc',
    researching: 'blue',
    debating:    'fuchsia',
    deciding:    'amber',
    executing:   'orange',
    verifying:   'emerald',
    complete:    'emerald',
  };
  const phaseColor = phaseColors[phase] || 'zinc';

  const modeColors = { solo: 'zinc', steve: 'cyan', max: 'orange' };
  const modeLabels = { solo: 'Solo', steve: 'Steve assist', max: 'MAX swarm' };
  const modeIcons  = { solo: Bot, steve: User, max: Package };

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">

    {/* ── WATCH / PROMOTED / R&D / EXPERIMENTS toggle bar ── */}
    <div className="flex items-center gap-1 px-3 py-2 border-b border-white/5 shrink-0 bg-black/20">
      {[
        ['watch',   'WATCH',   null],
        ['promoted', 'PROMOTED', codeExperiments.summary?.promoted || promotedExperiments.length || null],
        ['rd',      'R&D',     null],
        ['experiments', 'EXPERIMENTS', codeExperiments.summary?.total || null],
      ].map(([id, label, badge]) => (
        <button
          key={id}
          onClick={() => setActiveView(id)}
          className={`px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${
            activeView === id
              ? id === 'promoted' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : id === 'rd'     ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
              : id === 'experiments' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              :                   'bg-white/10 text-zinc-200'
              : 'text-zinc-600 hover:text-zinc-400'
          }`}
        >
          {label}
          {badge != null && (
            <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full bg-fuchsia-500/20 text-fuchsia-400">
              {badge}
            </span>
          )}
        </button>
      ))}
      <div className="ml-auto flex items-center gap-3 text-[9px] text-zinc-700 font-mono">
        {Object.values(validations).filter(v => v.promoted).length > 0 && (
          <span className="text-emerald-600">
            {Object.values(validations).filter(v => v.promoted).length} promoted
          </span>
        )}
        {activeView === 'promoted'
          ? `${promotedExperiments.length} promoted with evidence`
          : activeView === 'rd'
          ? rdCandidates.length > 0 ? `${rdCandidates.length} candidates` : 'github scanner'
          : activeView === 'experiments'
          ? `${codeExperiments.summary?.promotable || 0} promotable · ${codeExperiments.summary?.proposalOnly || 0} proposal-only · ${codeExperiments.summary?.rejected || 0} rejected`
          : currentWork?.source === 'real' ? '⬤ real queue' : 'idle: no fake work'}
      </div>
    </div>

    {activeView === 'watch' && <CodebaseSignal overview={codebaseOverview} />}

    {/* ── PROMOTED PAPER TRAIL PANEL ── */}
    {activeView === 'promoted' && (
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0">
        {promotedExperiments.map((exp) => {
          const trail = exp.promotionPaperTrail || exp.pulsePromotion?.paperTrail || {};
          const gates = trail.gates || {};
          const simulation = trail.simulation || exp.somaPatchSimulation || {};
          const evidence = Array.isArray(trail.evidence) ? trail.evidence : [];
          const promotedAt = trail.promotedAt || exp.updatedAt || exp.createdAt;
          const passRate = Number.isFinite(simulation.passRate) ? `${(simulation.passRate * 100).toFixed(1)}%` : 'n/a';
          return (
            <div key={exp.id} className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 overflow-hidden">
              <div className="flex items-start gap-3 px-3 py-3 border-b border-white/5">
                <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[11px] text-zinc-200 truncate">{trail.sourceRepo || exp.repo}</span>
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 font-bold uppercase tracking-wider">promoted to pulse</span>
                  </div>
                  <div className="font-mono text-[10px] text-zinc-500 truncate mt-1">{trail.targetFile || exp.somaPatchProposal?.file || 'target file not recorded'}</div>
                  <div className="text-[10px] text-zinc-500 mt-1 leading-relaxed">{trail.reason || exp.lesson || 'Promotion reason was not recorded.'}</div>
                </div>
                <span className="text-[9px] text-zinc-600 shrink-0">{promotedAt ? new Date(promotedAt).toLocaleString() : 'undated'}</span>
              </div>

              <div className="px-3 py-3 space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {[
                    ['sandbox syntax', gates.sandboxSyntax],
                    ['sandbox risk', gates.sandboxRisk],
                    ['target preflight', gates.targetSyntax],
                    ['simulation', gates.simulationPassRate],
                    ['engineering queue', gates.queuedForEngineering],
                  ].map(([label, ok]) => (
                    <div key={label} className={`rounded border px-2 py-1.5 text-[9px] uppercase tracking-wider ${
                      ok === true ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-400' :
                      ok === false ? 'border-rose-500/20 bg-rose-500/8 text-rose-400' :
                      'border-white/8 bg-black/20 text-zinc-600'
                    }`}>
                      <span className="font-bold">{label}</span>
                      <span className="ml-1">{ok === true ? 'pass' : ok === false ? 'fail' : 'unknown'}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    ['iterations', simulation.iterations?.toLocaleString?.() || simulation.iterations || 'n/a'],
                    ['wins', simulation.wins?.toLocaleString?.() || simulation.wins || 'n/a'],
                    ['losses', simulation.losses?.toLocaleString?.() || simulation.losses || 'n/a'],
                    ['pass rate', passRate],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border border-white/8 bg-black/20 px-2 py-1.5">
                      <div className="text-[8px] text-zinc-700 uppercase tracking-wider">{label}</div>
                      <div className="text-[11px] font-mono text-zinc-300">{value}</div>
                    </div>
                  ))}
                </div>

                {evidence.length > 0 && (
                  <div className="rounded-lg border border-white/8 bg-black/20 p-2 space-y-1">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Promotion Evidence</div>
                    {evidence.map((item, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px] text-zinc-500">
                        <Shield className="w-3 h-3 text-emerald-500/70 shrink-0 mt-0.5" />
                        <span>{asDisplayText(item)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(exp.pulsePromotion?.manifestPath || exp.pulsePromotion?.proposalPath) && (
                  <div className="rounded-lg border border-white/8 bg-zinc-950/60 p-2 space-y-1">
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Pulse Staging Files</div>
                    {exp.pulsePromotion?.manifestPath && <div className="font-mono text-[9px] text-zinc-500 truncate">manifest: {exp.pulsePromotion.manifestPath}</div>}
                    {exp.pulsePromotion?.proposalPath && <div className="font-mono text-[9px] text-zinc-500 truncate">proposal: {exp.pulsePromotion.proposalPath}</div>}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {promotedExperiments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-700">
            <CheckCircle className="w-8 h-8 opacity-20" />
            <div className="text-[11px]">No promoted code simulation artifacts yet</div>
            <div className="text-[9px] text-zinc-800 max-w-md text-center">
              Passing code experiments will appear here only after sandbox gates, simulation, engineering queueing, and Pulse staging evidence are recorded.
            </div>
          </div>
        )}
      </div>
    )}

    {/* ── PROMOTION LAB PANEL ── */}
    {activeView === 'legacy_promote_disabled' && (
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 min-h-0">
        {promoteList.map((c) => {
          const ds        = promoteStatus[c.file];
          const isExp     = expandedPromote === c.file;
          const mc        = modeColors[c.mode] || 'zinc';
          const ModeIcon  = modeIcons[c.mode]  || Bot;
          const conf      = { low: 0.88, medium: 0.73, high: 0.61 }[c.complexity] || 0.75;
          const agentName = { solo: 'SOMA', steve: 'STEVE', max: 'MAX' }[c.mode] || 'SOMA';
          const isPromoting = ds?.status === 'promoting';
          const isPreflight  = ds?.status === 'preflight';
          const isBlocked    = ds?.status === 'blocked';
          const isPromoted   = ds?.status === 'promoted';
          const isError     = ds?.status === 'error';
          const vld         = validations[c.file]; // validation result for this file
          const hasOutcome  = outcomes.optimHistory?.some(o => o.file === c.file) || outcomes.outcomes?.some(o => o.file === c.file);

          return (
            <div key={c.file} className={`rounded-xl border overflow-hidden transition-all ${
              isPromoted ? 'border-emerald-500/30 bg-emerald-500/5'
              : isError ? 'border-rose-500/30 bg-rose-500/5'
              : c.source === 'real' ? `border-blue-500/20 bg-zinc-900/60 hover:bg-zinc-900/80`
              : `border-${mc}-500/20 bg-zinc-900/60 hover:bg-zinc-900/80`
            }`}>
              {/* Row */}
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer transition-all"
                onClick={() => setExpandedPromote(isExp ? null : c.file)}
              >
                <ModeIcon className={`w-3 h-3 text-${c.source === 'real' ? 'blue' : mc}-400 shrink-0`} />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-mono text-[11px] text-zinc-300 truncate">{c.file}</span>
                  <div className="flex items-center gap-1.5">
                    {c.source === 'real' && <span className="text-[8px] text-blue-500 uppercase tracking-wider">her goal</span>}
                    {vld?.promoted  && <span className="text-[8px] text-emerald-500 uppercase tracking-wider">✓ validated</span>}
                    {vld && !vld.promoted && vld.tier === 2 && <span className="text-[8px] text-amber-600 uppercase tracking-wider">borderline</span>}
                    {vld && !vld.promoted && vld.tier === 3 && <span className="text-[8px] text-zinc-600 uppercase tracking-wider">training signal</span>}
                  </div>
                </div>
                <span className="text-[9px] text-zinc-600 hidden sm:block shrink-0 max-w-[90px] truncate">{c.area}</span>
                <div className="flex items-center gap-2 ml-2 shrink-0">
                  {vld?.score != null
                    ? <span className={`text-[9px] font-mono font-bold ${vld.score >= 0.82 ? 'text-emerald-400' : vld.score >= 0.62 ? 'text-amber-400' : 'text-zinc-500'}`}>
                        {(vld.score * 100).toFixed(0)}%
                      </span>
                    : <span className={`text-[9px] font-mono font-bold ${conf >= 0.8 ? 'text-emerald-400' : conf >= 0.65 ? 'text-amber-400' : 'text-zinc-500'}`}>
                        {(conf * 100).toFixed(0)}%
                      </span>
                  }
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-${mc}-500/10 text-${mc}-400`}>
                    {c.complexity}
                  </span>
                  {hasOutcome && !isPromoted && !vld && <span className="text-[8px] text-zinc-700">learned</span>}
                  {isPromoted && <span className="text-[9px] text-emerald-400 font-bold">✓ PROMOTED</span>}
                  {isBlocked && <span className="text-[9px] text-amber-400 font-bold">BLOCKED</span>}
                  {isError   && <span className="text-[9px] text-rose-400 font-bold">✗ FAILED</span>}
                  <ChevronRight className={`w-3.5 h-3.5 text-zinc-700 transition-transform duration-200 ${isExp ? 'rotate-90' : ''}`} />
                </div>
              </div>

              {/* Expanded */}
              {isExp && (
                <div className="border-t border-white/5 px-3 py-3 space-y-3">

                  {/* Intent */}
                  <div className="text-[10px] text-zinc-500 leading-relaxed border-l-2 border-fuchsia-500/30 pl-2.5">
                    {c.intent}
                  </div>

                  {/* Full diff */}
                  {(c.before?.length > 0 || c.after?.length > 0) && (
                    <DiffView
                      before={c.before}
                      after={c.after}
                      filename={c.file}
                      forming={false}
                      formLine={c.after?.length || 0}
                    />
                  )}
                  {!c.before?.length && !c.after?.length && (
                    <div className="text-[10px] text-zinc-600 italic px-2">
                      The lab generates the real patch candidate from the live file during promotion. Switch to WATCH to see her reason through it first.
                    </div>
                  )}

                  {/* Validation result */}
                  {vld && (
                    <div className={`px-2.5 py-2 rounded-lg border text-[10px] space-y-1 ${
                      vld.promoted  ? 'bg-emerald-500/8 border-emerald-500/20 text-emerald-400'
                      : vld.tier === 2 ? 'bg-amber-500/8 border-amber-500/20 text-amber-400'
                      : 'bg-zinc-800/60 border-white/8 text-zinc-500'
                    }`}>
                      <div className="font-bold">{vld.message}</div>
                      <div className="flex items-center gap-3 text-[9px] opacity-80">
                        <span>Score {(vld.score * 100).toFixed(0)}%</span>
                        {vld.syntaxPassed === true  && <span className="text-emerald-500">syntax ✓</span>}
                        {vld.syntaxPassed === false && <span className="text-rose-500">syntax ✗</span>}
                        <span>Tier {vld.tier}</span>
                        <span className="text-zinc-700">training signal written</span>
                      </div>
                      {vld.nemesisVerdict && (
                        <div className="text-[9px] opacity-70 italic border-t border-white/8 pt-1">
                          NEMESIS: {vld.nemesisVerdict}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error message */}
                  {(isError || isBlocked) && (
                    <div className={`px-2 py-1.5 rounded border text-[10px] ${isBlocked ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-rose-500/10 border-rose-500/20 text-rose-400'}`}>
                      <span className="font-bold block mb-0.5">
                        {isBlocked ? 'Promotion blocked — live code was not changed' : 'Swarm failed — recorded as training signal'}
                      </span>
                      {ds.msg}
                      {ds.postflight && (
                        <div className="mt-2 rounded bg-black/25 p-2 text-[9px] text-zinc-400">
                          Postflight checks failed. Original file restore: {ds.rollbackCheck?.ok ? 'passed' : 'check logs'}.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Promoted outcome */}
                  {isPromoted && (
                    <div className="px-2 py-1.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] text-emerald-400">
                      <span className="font-bold block mb-0.5">Promoted by {ds.agent} — outcome written to memory</span>
                      {ds.msg}
                    </div>
                  )}

                  {/* Promotion button */}
                  {!isPromoted && (
                    <button
                      onClick={() => doPromote(c)}
                      disabled={isPromoting || isPreflight}
                      className={`w-full py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                        c.mode === 'max'   ? 'bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/30' :
                        c.mode === 'steve' ? 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30' :
                                             'bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 border border-fuchsia-500/30'
                      } ${isPromoting || isPreflight ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {isPreflight
                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running preflight...</>
                        : isPromoting
                          ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running lab swarm...</>
                          : isError || isBlocked
                          ? <><RefreshCw className="w-3.5 h-3.5" /> Retry → {agentName}</>
                          : <><Zap className="w-3.5 h-3.5" /> Legacy promotion disabled</>
                      }
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Learning Feed ── */}
        {(outcomes.outcomes?.length > 0 || outcomes.optimHistory?.length > 0) && (
          <div className="border-t border-white/5 px-3 py-3 space-y-1.5 shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Brain className="w-3 h-3 text-zinc-600" />
              <span className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">What She Learned</span>
              {outcomes.successRate != null && (
                <span className={`ml-auto text-[9px] font-mono font-bold ${outcomes.successRate >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {(outcomes.successRate * 100).toFixed(0)}% success · {outcomes.totalRuns} runs
                </span>
              )}
            </div>
            {[...outcomes.outcomes, ...outcomes.optimHistory]
              .sort((a, b) => (b.ts || 0) - (a.ts || 0))
              .slice(0, 8)
              .map((o, i) => {
                const success = o.success ?? o.content?.includes('SUCCESS');
                const file    = o.file || '';
                const area    = o.area || '';
                const ts      = o.ts ? new Date(o.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                return (
                  <div key={i} className={`flex items-start gap-2 px-2 py-1.5 rounded border text-[9px] ${
                    success ? 'bg-emerald-500/5 border-emerald-500/15 text-emerald-400' : 'bg-rose-500/5 border-rose-500/15 text-rose-400'
                  }`}>
                    <span className="shrink-0 mt-px font-bold">{success ? '✓' : '✗'}</span>
                    <div className="min-w-0">
                      <div className="font-mono truncate text-zinc-400">{file.split('/').pop() || file}</div>
                      {area && <div className="text-zinc-600 truncate">{area.slice(0, 60)}</div>}
                    </div>
                    {ts && <span className="ml-auto shrink-0 text-zinc-700">{ts}</span>}
                  </div>
                );
              })}
          </div>
        )}
      </div>
    )}

    {/* ── CODE R&D EXPERIMENTS PANEL ── */}
    {activeView === 'experiments' && (
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 min-h-0">
        {codeExperiments.experiments?.length > 0 && (
          <div className="grid grid-cols-4 gap-2 mb-3">
            {['queued', 'promotable', 'patch_ready', 'developed_patch'].map(status => (
              <div key={status} className="rounded-lg border border-white/8 bg-zinc-900/60 px-3 py-2">
                <div className="text-[9px] text-zinc-600 uppercase tracking-wider">{status}</div>
                <div className="text-lg font-mono text-zinc-300">{codeExperiments.summary?.byStatus?.[status] || 0}</div>
              </div>
            ))}
          </div>
        )}

        {(codeExperiments.experiments || []).map(exp => {
          const isExp = expandedCodeExperiment === exp.id;
          const running = runningCodeExperiment[exp.id] || exp.status === 'sandboxing';
          const statusClass =
            exp.status === 'promotable' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' :
            exp.status === 'rejected'   ? 'border-rose-500/30 bg-rose-500/5 text-rose-400' :
            exp.status === 'patch_rejected' ? 'border-rose-500/30 bg-rose-500/5 text-rose-400' :
            exp.status === 'promoted'   ? 'border-emerald-500/40 bg-emerald-500/8 text-emerald-300' :
            exp.status === 'developed_patch' ? 'border-cyan-500/35 bg-cyan-500/8 text-cyan-300' :
            exp.status === 'sandboxing' ? 'border-amber-500/30 bg-amber-500/5 text-amber-400' :
            exp.status === 'queued'     ? 'border-blue-500/30 bg-blue-500/5 text-blue-400' :
                                          'border-white/8 bg-zinc-900/60 text-zinc-500';
          const criteria = exp.promotionCriteria || {};
          const riskCount = exp.sandbox?.riskFindings?.length || 0;
          const syntaxChecks = exp.sandbox?.syntaxChecks || [];
          const proposing = runningPatchProposal[exp.id];
          const developing = runningPatchDevelopment[exp.id];
          const simulation = exp.somaPatchSimulation;
          const proposal = exp.somaPatchProposal;
          const paperTrail = exp.promotionPaperTrail || exp.pulsePromotion?.paperTrail;
          const developedPatch = exp.developmentPatch;

          return (
            <div key={exp.id} className={`rounded-xl border overflow-hidden transition-all ${statusClass}`}>
              <div
                className="flex items-center gap-2 px-3 py-2.5 cursor-pointer"
                onClick={() => setExpandedCodeExperiment(isExp ? null : exp.id)}
              >
                <FlaskConical className="w-3.5 h-3.5 shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-mono text-[11px] text-zinc-200 truncate">{exp.repo}</span>
                  <span className="text-[9px] text-zinc-600 truncate">{exp.lesson || exp.candidate?.description || 'awaiting sandbox decision'}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {exp.candidate?.logos?.score != null && (
                    <span className="text-[9px] font-mono font-bold text-zinc-400">{(exp.candidate.logos.score * 100).toFixed(0)}%</span>
                  )}
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-black/20">{exp.status}</span>
                  <ChevronRight className={`w-3.5 h-3.5 text-zinc-700 transition-transform duration-200 ${isExp ? 'rotate-90' : ''}`} />
                </div>
              </div>

              {isExp && (
                <div className="border-t border-white/5 px-3 py-3 space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    {[
                      ['syntax', criteria.syntaxPass],
                      ['build', criteria.buildPass],
                      ['risk', criteria.riskPass],
                      ['score', criteria.lobeScorePass],
                      ['rollback', criteria.rollbackSnapshot],
                    ].map(([label, ok]) => (
                      <div key={label} className={`rounded border px-2 py-1.5 text-[9px] uppercase tracking-wider ${
                        ok === true ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-400' :
                        ok === false ? 'border-rose-500/20 bg-rose-500/8 text-rose-400' :
                        'border-white/8 bg-black/20 text-zinc-600'
                      }`}>
                        <span className="font-bold">{label}</span>
                        <span className="ml-1">{ok === true ? 'pass' : ok === false ? 'fail' : 'pending'}</span>
                      </div>
                    ))}
                  </div>

                  {exp.inspection?.summary && (
                    <div className="rounded-lg bg-black/20 border border-white/8 p-2 text-[10px] text-zinc-500 space-y-1">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">Repo Inspection</div>
                      <div className="flex flex-wrap gap-2">
                        <span>README {exp.inspection.summary.hasReadme ? 'yes' : 'no'}</span>
                        <span>package {exp.inspection.summary.hasPackageJson ? 'yes' : 'no'}</span>
                        <span>python {exp.inspection.summary.hasPythonManifest ? 'yes' : 'no'}</span>
                        <span>source samples {exp.inspection.summary.sourceFiles || 0}</span>
                      </div>
                      {exp.inspection.readmePreview && <div className="text-zinc-600 line-clamp-2">{asDisplayText(exp.inspection.readmePreview)}</div>}
                    </div>
                  )}

                  {exp.sandbox && (
                    <div className="rounded-lg bg-black/20 border border-white/8 p-2 text-[10px] text-zinc-500 space-y-2">
                      <div className="flex items-center gap-3 text-[9px] uppercase tracking-wider">
                        <span className="font-bold text-zinc-400">Sandbox Results</span>
                        <span>{exp.sandbox.fileCount || 0} files</span>
                        <span>{syntaxChecks.filter(c => c.ok).length}/{syntaxChecks.length} syntax</span>
                        <span>{riskCount} risk flags</span>
                      </div>
                      {riskCount > 0 && (
                        <div className="space-y-1">
                          {exp.sandbox.riskFindings.slice(0, 5).map((risk, i) => (
                            <div key={i} className="font-mono text-[9px] text-amber-400 truncate">
                              {risk.severity}: {risk.label} · {risk.file || 'package.json'}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {proposal && (
                    <div className="rounded-lg bg-fuchsia-500/8 border border-fuchsia-500/20 p-2 text-[10px] text-fuchsia-200 space-y-1.5">
                      <div className="text-[9px] text-fuchsia-300 uppercase tracking-wider font-bold">SOMA Integration Proposal</div>
                      <div className="font-mono text-[10px] text-zinc-300">{proposal.file}</div>
                      <div className="text-zinc-500">{asDisplayText(proposal.intent)}</div>
                      {simulation && (
                        <div className="flex flex-wrap gap-2 text-[9px] text-zinc-500 pt-1 border-t border-white/8">
                          <span>{simulation.iterations?.toLocaleString()} simulations</span>
                          <span>{((simulation.passRate || 0) * 100).toFixed(1)}% pass</span>
                          <span>{simulation.approved ? 'approved' : 'held'}</span>
                          <span>{exp.queuedForEngineering ? 'queued for swarm' : 'not queued'}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {paperTrail && (
                    <div className="rounded-lg bg-emerald-500/8 border border-emerald-500/20 p-2 text-[10px] text-emerald-200 space-y-1.5">
                      <div className="text-[9px] text-emerald-300 uppercase tracking-wider font-bold">Promotion Paper Trail</div>
                      <div className="text-zinc-500">{paperTrail.reason || exp.lesson}</div>
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-1.5 pt-1">
                        {Object.entries(paperTrail.gates || {}).map(([gate, ok]) => (
                          <div key={gate} className={`rounded border px-2 py-1 text-[8px] uppercase tracking-wider ${
                            ok ? 'border-emerald-500/20 bg-emerald-500/8 text-emerald-400' : 'border-rose-500/20 bg-rose-500/8 text-rose-400'
                          }`}>
                            {gate}: {ok ? 'pass' : 'fail'}
                          </div>
                        ))}
                      </div>
                      {(paperTrail.evidence || []).slice(0, 5).map((item, i) => (
                        <div key={i} className="font-mono text-[9px] text-zinc-500 truncate">{item}</div>
                      ))}
                    </div>
                  )}

                  {developedPatch && (
                    <div className={`rounded-lg border p-2 text-[10px] space-y-1.5 ${
                      developedPatch.promotionEligible
                        ? 'bg-cyan-500/8 border-cyan-500/20 text-cyan-200'
                        : 'bg-rose-500/8 border-rose-500/20 text-rose-200'
                    }`}>
                      <div className="text-[9px] uppercase tracking-wider font-bold">
                        Development Patch Artifact
                      </div>
                      <div className="font-mono text-[9px] text-zinc-500 truncate">patch: {developedPatch.patchPath}</div>
                      <div className="flex flex-wrap gap-2 text-[9px] text-zinc-500">
                        <span>git apply: {developedPatch.applyCheck?.ok ? 'pass' : 'fail'}</span>
                        <span>target preflight: {developedPatch.syntaxCheck?.ok ? 'pass' : 'fail'}</span>
                        <span>{developedPatch.promotionEligible ? 'pushed to Pulse review' : 'not promotion eligible'}</span>
                      </div>
                      {exp.pulsePromotion?.manifestPath && (
                        <div className="font-mono text-[9px] text-zinc-500 truncate">pulse: {exp.pulsePromotion.manifestPath}</div>
                      )}
                      {developedPatch.diffPreview && (
                        <pre className="max-h-32 overflow-y-auto custom-scrollbar rounded bg-black/30 p-2 text-[9px] text-zinc-500 whitespace-pre-wrap">{developedPatch.diffPreview}</pre>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    {exp.url && (
                      <a
                        href={exp.url}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 text-[10px] text-blue-400/60 hover:text-blue-400 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <ExternalLink className="w-3 h-3" /> repository
                      </a>
                    )}
                    {['discovered', 'queued', 'rejected'].includes(exp.status) && (
                      <button
                        onClick={() => runCodeExperiment(exp.id)}
                        disabled={running}
                        className="ml-auto px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {running
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Sandboxing...</>
                          : <><Shield className="w-3 h-3" /> Run Sandbox</>}
                      </button>
                    )}
                    {exp.status === 'promotable' && (
                      <button
                        onClick={() => proposeSomaPatch(exp.id)}
                        disabled={proposing}
                        className="ml-auto px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 border border-fuchsia-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {proposing
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Simulating...</>
                          : <><Zap className="w-3 h-3" /> Simulate Integration Proposal</>}
                      </button>
                    )}
                    {['patch_ready', 'patch_rejected'].includes(exp.status) && (
                      <button
                        onClick={() => developExperimentPatch(exp.id)}
                        disabled={developing}
                        className="ml-auto px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {developing
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Developing...</>
                          : <><Code2 className="w-3 h-3" /> Develop Real Patch</>}
                      </button>
                    )}
                    {exp.status === 'developed_patch' && (
                      <button
                        onClick={() => proposeSomaPatch(exp.id)}
                        disabled={proposing}
                        className="ml-auto px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                      >
                        {proposing
                          ? <><RefreshCw className="w-3 h-3 animate-spin" /> Checking...</>
                          : <><Shield className="w-3 h-3" /> Run Promotion Gates</>}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {(!codeExperiments.experiments || codeExperiments.experiments.length === 0) && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-700">
            <FlaskConical className="w-8 h-8 opacity-20" />
            <div className="text-[11px]">No code experiments yet</div>
            <div className="text-[9px] text-zinc-800">Use R&D discovery to queue real GitHub patterns into the sandbox ledger</div>
          </div>
        )}
      </div>
    )}

    {/* ── R&D DISCOVERY PANEL ── */}
    {activeView === 'rd' && (
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0">

        {/* Topic pill selector + discover button */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {(rdTopics.length > 0 ? rdTopics : ['agents', 'knowledge', 'signals', 'memory', 'messaging', 'ml', 'agency', 'agentic']).map(t => {
            const tag   = t?.tag   ?? t;
            const label = t?.label ?? t;
            return (
              <button
                key={tag}
                onClick={() => { setRdTopic(tag); rdDiscover(tag); }}
                className={`px-2.5 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  rdTopic === tag
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                    : 'text-zinc-600 border-white/5 hover:text-zinc-400 hover:border-white/10'
                }`}
              >
                {label}
              </button>
            );
          })}
          <button
            onClick={() => rdDiscover(rdTopic, true)}
            disabled={rdLoading}
            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-300 border border-blue-500/30 hover:bg-blue-500/30 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {rdLoading
              ? <><RefreshCw className="w-3 h-3 animate-spin" /> Scanning...</>
              : <><Star className="w-3 h-3" /> Discover</>}
          </button>
        </div>

        {rdMeta && !rdLoading && (
          <div className="rounded-lg border border-white/8 bg-zinc-900/50 px-3 py-2 text-[10px] text-zinc-500 flex items-center gap-3 flex-wrap">
            <span className="font-bold uppercase tracking-wider text-zinc-400">R&D Evidence</span>
            <span>{rdMeta.cached ? 'cached GitHub scan' : 'fresh GitHub scan'}</span>
            {rdMeta.query && <span className="font-mono text-zinc-600 truncate max-w-[360px]">query: {rdMeta.query}</span>}
            <span>{rdMeta.count || 0} repos</span>
            {rdMeta.searchErrors?.length > 0 && <span className="text-amber-400">{rdMeta.searchErrors.length} search warning(s)</span>}
          </div>
        )}

        {/* Loading state */}
        {rdLoading && rdCandidates.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-700">
            <FlaskConical className="w-8 h-8 opacity-20 animate-pulse" />
            <div className="text-[11px]">Scanning GitHub for <span className="text-blue-500">{rdTopic}</span> innovations...</div>
            <div className="text-[9px] text-zinc-800">LOGOS · PROMETHEUS · THALAMUS evaluating</div>
          </div>
        )}

        {rdError && !rdLoading && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-[10px] text-amber-300">
            <span className="font-bold uppercase tracking-wider block mb-0.5">R&D scanner status</span>
            {rdError}
          </div>
        )}

        {/* Candidate cards */}
        {rdCandidates.map((c, i) => {
          const isExp   = rdExpanded === i;
          const isProp  = rdProposed[i];
          const risk    = c.thalamus?.risk || 'low';
          const riskClr = risk === 'high' ? 'rose' : risk === 'medium' ? 'amber' : 'emerald';
          const hasLiveAnalysis = Boolean(c.logos?.analysis || c.prometheus?.impact || c.thalamus?.assessment);

          return (
            <div key={i} className="rounded-xl border border-white/8 bg-zinc-900/60 hover:bg-zinc-900/80 overflow-hidden transition-all">

              {/* Summary row */}
              <div
                className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer"
                onClick={() => setRdExpanded(isExp ? null : i)}
              >
                <Star className="w-3.5 h-3.5 text-yellow-500/60 shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-mono text-[11px] text-zinc-200 truncate">{c.name}</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    {c.stars != null && <span className="text-[9px] text-zinc-600">★ {c.stars.toLocaleString()}</span>}
                    {c.language && <span className="text-[9px] text-blue-500/70">{c.language}</span>}
                    {c.updated  && <span className="text-[9px] text-zinc-700">{c.updated}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {risk && (
                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase bg-${riskClr}-500/10 text-${riskClr}-400 border border-${riskClr}-500/20`}>
                      {risk}
                    </span>
                  )}
                  {c.logos?.score != null && (
                    <span className={`text-[9px] font-mono font-bold ${c.logos.score >= 0.7 ? 'text-emerald-400' : c.logos.score >= 0.5 ? 'text-amber-400' : 'text-zinc-500'}`}>
                      {(c.logos.score * 100).toFixed(0)}%
                    </span>
                  )}
                  {!hasLiveAnalysis && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 border border-white/8 uppercase font-bold">
                      no lobe text
                    </span>
                  )}
                  <ChevronRight className={`w-3.5 h-3.5 text-zinc-700 transition-transform duration-200 ${isExp ? 'rotate-90' : ''}`} />
                </div>
              </div>

              {/* Description */}
              {c.description && (
                <div className="px-3 pb-2 text-[10px] text-zinc-600 line-clamp-2 border-b border-white/5">{c.description}</div>
              )}

              {/* Expanded detail */}
              {isExp && (
                <div className="border-t border-white/5 px-3 py-3 space-y-3">
                  {!hasLiveAnalysis && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 px-3 py-2 text-[10px] text-amber-300">
                      No lobe analysis text was returned for this candidate. The score is repository metadata only, not a cognitive review.
                    </div>
                  )}

                  {/* LOGOS */}
                  {c.logos?.analysis && (
                    <div className="space-y-0.5">
                      <div className="text-[9px] font-bold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Brain className="w-2.5 h-2.5" /> LOGOS — Technical
                      </div>
                      <div className="text-[10px] text-zinc-400 leading-relaxed pl-2.5 border-l border-blue-500/20">{asDisplayText(c.logos.analysis)}</div>
                    </div>
                  )}

                  {/* PROMETHEUS */}
                  {c.prometheus?.impact && (
                    <div className="space-y-0.5">
                      <div className="text-[9px] font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Zap className="w-2.5 h-2.5" /> PROMETHEUS — Impact
                      </div>
                      <div className="text-[10px] text-zinc-400 leading-relaxed pl-2.5 border-l border-emerald-500/20">{asDisplayText(c.prometheus.impact)}</div>
                    </div>
                  )}

                  {/* THALAMUS */}
                  {c.thalamus?.assessment && (
                    <div className="space-y-0.5">
                      <div className={`text-[9px] font-bold text-${riskClr}-400 uppercase tracking-wider flex items-center gap-1.5`}>
                        <Shield className="w-2.5 h-2.5" /> THALAMUS — Risk
                      </div>
                      <div className="text-[10px] text-zinc-400 leading-relaxed pl-2.5 border-l border-amber-500/20">{asDisplayText(c.thalamus.assessment)}</div>
                    </div>
                  )}

                  {/* Applicable areas */}
                  {c.applicableAreas?.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="text-[9px] text-zinc-600 uppercase tracking-wider">Where it applies in SOMA</div>
                      <div className="flex flex-wrap gap-1.5">
                        {c.applicableAreas.map((a, j) => (
                          <span key={j} className="text-[9px] px-2 py-0.5 rounded-full bg-white/5 text-zinc-500 border border-white/8">{a}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Repo link */}
                  {c.url && (
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1.5 text-[10px] text-blue-400/50 hover:text-blue-400 transition-colors"
                      onClick={e => e.stopPropagation()}
                    >
                      <ExternalLink className="w-3 h-3" />
                      {c.url}
                    </a>
                  )}

                  {/* Propose button */}
                  <button
                    onClick={async () => {
                      setRdProposed(prev => ({ ...prev, [i]: true }));
                      await fetch('/api/soma/swarm/rd-propose', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ candidate: c, topic: rdTopic }),
                      }).catch(() => {});
                      refreshCodeExperiments();
                    }}
                    disabled={isProp}
                    className={`w-full py-2.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
                      isProp
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 cursor-default'
                        : 'bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30'
                    }`}
                  >
                    {isProp
                      ? <><CheckCircle className="w-3.5 h-3.5" /> Queued as Lab Experiment</>
                      : <><ArrowRight className="w-3.5 h-3.5" /> Queue Lab Experiment</>}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Empty state */}
        {!rdLoading && rdCandidates.length === 0 && !rdError && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-zinc-700">
            <FlaskConical className="w-8 h-8 opacity-20" />
            <div className="text-[11px]">Select a topic and hit Discover</div>
            <div className="text-[9px] text-zinc-800">SOMA scans GitHub · lobes score patterns · safe ideas become lab experiments</div>
          </div>
        )}
      </div>
    )}

    {/* ── WATCH PANEL (3-col sim) ── */}
    {activeView === 'watch' && <div className="flex-1 grid grid-cols-3 overflow-hidden min-h-0">

      {/* ── LEFT: Intent Panel ── */}
      <div className="flex flex-col border-r border-white/5 overflow-hidden">

        {/* Header */}
        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
          <Brain className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">INTENT</span>
          <div className="ml-auto flex items-center gap-1.5">
            <span className={`flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-full bg-${phaseColor}-500/10 text-${phaseColor}-400 border border-${phaseColor}-500/20 font-mono uppercase`}>
              <span className={`w-1 h-1 rounded-full bg-${phaseColor}-400 ${['researching','debating','executing'].includes(phase) ? 'animate-pulse' : ''}`} />
              {phase}
            </span>
            {cycles > 0 && <span className="text-[9px] text-zinc-700 font-mono">{cycles} cycles</span>}
          </div>
        </div>

        {/* Real swarm / real data badge */}
        {(realSwarm || realCandidates?.queue?.length > 0) && (
          <div className={`mx-3 mt-2 px-2 py-1.5 rounded-lg flex items-center gap-1.5 shrink-0 ${
            realSwarm
              ? 'bg-emerald-500/10 border border-emerald-500/20'
              : 'bg-blue-500/10 border border-blue-500/20'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${realSwarm ? 'bg-emerald-400' : 'bg-blue-400'}`} />
            <span className={`text-[9px] font-bold uppercase tracking-wider ${realSwarm ? 'text-emerald-400' : 'text-blue-400'}`}>
              {realSwarm ? 'LIVE SWARM ACTIVE' : `REAL QUEUE — ${realCandidates.queue.length} TASKS`}
            </span>
          </div>
        )}

        {/* Current work */}
        {currentWork ? (
          <div className="px-3 py-3 border-b border-white/5 shrink-0">
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5">Working on</div>
            <div className="flex items-center gap-1.5 mb-1">
              <Code2 className="w-3 h-3 text-fuchsia-400 shrink-0" />
              <span className="font-mono text-[11px] text-fuchsia-300 font-bold">{currentWork.file}</span>
            </div>
            <div className="text-[10px] text-zinc-500 italic mb-2">{currentWork.area}</div>

            {/* Mode badge */}
            {(() => {
              const ModeIcon = modeIcons[currentWork.mode] || Bot;
              const mc = modeColors[currentWork.mode] || 'zinc';
              return (
                <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-${mc}-500/10 text-${mc}-400 border border-${mc}-500/20 text-[9px] font-bold uppercase tracking-wider`}>
                  <ModeIcon className="w-2.5 h-2.5" />
                  {modeLabels[currentWork.mode] || currentWork.mode}
                </div>
              );
            })()}

            {/* Intent block */}
            <div className="mt-2 text-[10px] text-zinc-500 leading-relaxed border-l-2 border-fuchsia-500/20 pl-2">
              {currentWork.intent}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center flex-1 text-zinc-700 text-[10px]">
            <Cpu className="w-5 h-5 opacity-20 mr-2" /> Selecting work...
          </div>
        )}

        {/* Queue */}
        {queue.length > 0 && (
          <div className="px-3 py-2 flex-1 overflow-y-auto custom-scrollbar min-h-0">
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-2">Next in queue</div>
            <div className="space-y-2">
              {queue.map((c, i) => {
                const mc = modeColors[c.mode] || 'zinc';
                const ModeIcon = modeIcons[c.mode] || Bot;
                return (
                  <div key={c.file} className="flex items-start gap-2 py-1.5 border-b border-white/5 last:border-0">
                    <span className="text-zinc-700 font-mono text-[9px] w-4 shrink-0 mt-0.5">{i+1}.</span>
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] text-zinc-400 truncate">{c.file.split('/').pop()}</div>
                      <div className="text-[9px] text-zinc-600">{c.area}</div>
                      <div className={`inline-flex items-center gap-1 mt-0.5 text-[8px] px-1 py-0.5 rounded bg-${mc}-500/10 text-${mc}-500 font-bold uppercase`}>
                        <ModeIcon className="w-2 h-2" />{c.mode}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── MIDDLE: Swarm + Collab Panel ── */}
      <div className="flex flex-col border-r border-white/5 overflow-hidden">

        {/* Header */}
        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
          <Activity className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">SWARM DEBATE</span>
          {phase === 'debating' && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-fuchsia-400">
              <span className="w-1.5 h-1.5 bg-fuchsia-400 rounded-full animate-pulse" />
              {debate.length === 0 ? 'consulting lobes...' : 'debating'}
            </span>
          )}
        </div>

        {/* Debate messages */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-3 min-h-0">
          {debate.length === 0 && phase !== 'debating' ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-700">
              <Brain className="w-6 h-6 opacity-20" />
              <div className="text-[10px]">{phase === 'researching' ? 'Reading codebase...' : 'Awaiting debate...'}</div>
            </div>
          ) : debate.length === 0 && phase === 'debating' ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-700">
              <Brain className="w-6 h-6 opacity-20 animate-pulse" />
              <div className="text-[10px]">Lobes thinking locally...</div>
              <div className="text-[9px] text-zinc-800">LOGOS · THALAMUS · PROMETHEUS · AURORA</div>
            </div>
          ) : (
            debate.map((msg, i) => {
              const agent = AGENTS[msg.agent] || AGENTS.SYSTEM;
              return (
                <div key={i} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: agent.color }}>{agent.label}</span>
                    <span className="text-[9px] text-zinc-700">{agent.role}</span>
                    {msg.live && <span className="text-[8px] text-zinc-700 ml-auto">live</span>}
                  </div>
                  <div className="text-[10px] text-zinc-400 leading-snug pl-2 border-l border-white/10">{asDisplayText(msg.text)}</div>
                </div>
              );
            })
          )}

          {/* Decision verdict */}
          {decision && (
            <div className={`mt-1 px-3 py-2 rounded-lg border space-y-1 ${
              !decision.proceed
                ? 'bg-zinc-800/60 border-white/10 text-zinc-400'
                : decision.mode === 'max'   ? 'bg-orange-500/10 border-orange-500/20 text-orange-300'
                : decision.mode === 'steve' ? 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'
                : 'bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-300'
            }`}>
              <div className="text-[10px] font-bold uppercase tracking-wider">
                {decision.proceed
                  ? `Verdict: PROCEED — ${modeLabels[decision.mode]}`
                  : 'Verdict: HOLD — risk too high without staged validation'}
              </div>
              <div className="flex items-center gap-3 text-[9px] opacity-70">
                <span>Confidence {(decision.confidence * 100).toFixed(0)}%</span>
                {decision.riskScore != null && <span>Risk {decision.riskScore}/100</span>}
                {decision.fromLobes && <span className="text-zinc-600">· local lobes</span>}
                {decision.cached    && <span className="text-zinc-700">· recalled</span>}
              </div>
              {decision.finalVerdict && (
                <div className="text-[9px] pt-1 border-t border-white/10 opacity-80 italic">
                  DeepSeek: {asDisplayText(decision.finalVerdict)}
                </div>
              )}
            </div>
          )}

          <div ref={debateEndRef} />
        </div>

        {/* Divider */}
        {shownCollab.length > 0 && (
          <div className="px-3 py-1 border-t border-white/5 shrink-0">
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider flex items-center gap-1.5">
              <Radio className="w-2.5 h-2.5" /> Collaboration Channel
            </div>
          </div>
        )}

        {/* Collab messages */}
        {shownCollab.length > 0 && (
          <div className="px-3 pb-3 space-y-1.5 overflow-y-auto custom-scrollbar max-h-48 shrink-0">
            {shownCollab.map((msg, i) => (
              <CollabMessage key={i} msg={msg} />
            ))}
            <div ref={collabEndRef} />
          </div>
        )}
      </div>

      {/* ── RIGHT: Execution Panel ── */}
      <div className="flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
          <Terminal className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">EXECUTION</span>
          {phase === 'executing' && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-orange-400">
              <Zap className="w-3 h-3" />evidence
            </span>
          )}
          {phase === 'verifying' && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400">
              <Eye className="w-3 h-3" />verifying
            </span>
          )}
          {phase === 'complete' && (
            <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-400">
              <CheckCircle className="w-3 h-3" />checked
            </span>
          )}
        </div>

        {/* Diff view */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 min-h-0">
          {!diffState ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-700">
              <GitBranch className="w-6 h-6 opacity-20" />
              <div className="text-[10px]">
                {['debating','deciding'].includes(phase) ? 'Awaiting evidence after debate...' : 'No patch artifact staged'}
              </div>
            </div>
          ) : (
            <DiffView
              before={diffState.before}
              after={diffState.after}
              filename={currentWork?.file || ''}
              forming={diffState.forming}
              formLine={diffState.formLine}
            />
          )}
        </div>

        {/* Verify log */}
        {execLog.length > 0 && (
          <div className="border-t border-white/5 px-3 py-2 shrink-0">
            <div className="text-[9px] text-zinc-600 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Shield className="w-2.5 h-2.5" /> Verification
            </div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto custom-scrollbar">
              {execLog.map((line, i) => {
                const isOk  = line.includes('✓') || line.includes('OK');
                const isErr = line.includes('✗') || line.includes('ERROR');
                const isCmd = line.startsWith('$');
                return (
                  <div key={i} className={`font-mono text-[9px] ${
                    isOk  ? 'text-emerald-400' :
                    isErr ? 'text-rose-400'    :
                    isCmd ? 'text-zinc-500'    : 'text-zinc-600'
                  }`}>{line}</div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats footer */}
        <div className="px-3 py-2 border-t border-white/5 flex items-center gap-4 shrink-0">
          <div>
            <div className="text-[9px] text-zinc-700 uppercase tracking-wider">Cycles</div>
            <div className="font-mono text-[11px] text-zinc-400">{cycles}</div>
          </div>
          <div>
            <div className="text-[9px] text-zinc-700 uppercase tracking-wider">Validated</div>
            <div className="font-mono text-[11px] text-emerald-400">
              {Object.values(validations).filter(v => v.promoted).length}
              <span className="text-zinc-700">/{Object.keys(validations).length}</span>
            </div>
          </div>
          <div>
            <div className="text-[9px] text-zinc-700 uppercase tracking-wider">Real Runs</div>
            <div className="font-mono text-[11px] text-fuchsia-400">{realCandidates?.cycleCount ?? '—'}</div>
          </div>
          {realCandidates?.successRate != null && (
            <div>
              <div className="text-[9px] text-zinc-700 uppercase tracking-wider">Win Rate</div>
              <div className={`font-mono text-[11px] ${realCandidates.successRate >= 0.7 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {(realCandidates.successRate * 100).toFixed(0)}%
              </div>
            </div>
          )}
          <div>
            <div className="text-[9px] text-zinc-700 uppercase tracking-wider">Mode</div>
            <div className={`font-mono text-[11px] text-${modeColors[currentWork?.mode || 'solo']}-400`}>
              {modeLabels[currentWork?.mode || 'solo']}
            </div>
          </div>
          <div className="ml-auto text-[9px] text-zinc-700 font-mono">
            {currentWork?.source === 'real' ? '⬤ real queue' : 'idle: no fake work'}
          </div>
        </div>
      </div>
    </div>}

  </div>
  );
}
