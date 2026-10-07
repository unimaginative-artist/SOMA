// MerovingianHybrid.mjs
// Hybrid Merovingian: Unified Event Bus + Hybrid Router + Reflection Module
// Single-file drop-in for your SLC / TriBrain stack.
// Author: for Owner
// VERSION: 1.0.0

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import EventEmitter from 'events';
import { RobustAdapters } from './RobustLLMAdapters.mjs';

const DefaultAdapters = RobustAdapters;

const iso = (t = Date.now()) => new Date(t).toISOString();
const mkid = (p = 'mrv') => `${p}_${crypto.randomBytes(6).toString('hex')}`;

/**
 * Quick perception layer (Integrated from MerovingianCortex)
 */
function quickPerception(query) {
  const words = query.toLowerCase().split(/\s+/);
  const len = words.length;
  
  const domainKeywords = {
    medical: ['health', 'disease', 'symptom', 'treatment', 'doctor', 'medicine'],
    technical: ['code', 'function', 'algorithm', 'bug', 'compile', 'deploy'],
    creative: ['story', 'imagine', 'create', 'design', 'art', 'poetry'],
    factual: ['what', 'when', 'where', 'who', 'define', 'explain'],
    finance: ['stock', 'trade', 'market', 'crypto', 'portfolio', 'profit', 'loss']
  };
  
  let domain = 'general';
  let maxCount = 0;
  for (const [d, keywords] of Object.entries(domainKeywords)) {
    const count = words.filter(w => keywords.includes(w)).length;
    if (count > maxCount) { maxCount = count; domain = d; }
  }
  
  const novelty_score = Math.min(1.0, len / 50 + Math.random() * 0.2);
  const estimated_risk = domain === 'medical' ? 0.8 : (domain === 'technical' ? 0.3 : 0.1);
  
  return { domain, novelty_score, estimated_risk, queryLength: len };
}

/* =========================
   DockerWorkerPool: long-running docker processes that speak newline-delimited JSON
   ========================= */
class DockerWorkerPool extends EventEmitter {
  constructor({ image = null, size = 2, dockerCmd = 'docker', args = [] } = {}) {
    super();
    this.image = image;
    this.size = Math.max(0, size || 0);
    this.dockerCmd = dockerCmd;
    this.args = args || [];
    this.workers = []; // { proc, buffer, pending: Map }
    this.started = false;
  }

  async start() {
    if (!this.image) return;
    if (this.started) return;
    for (let i = 0; i < this.size; i++) {
      const proc = spawn(this.dockerCmd, ['run', '--rm', '-i', this.image, ...this.args], { stdio: ['pipe', 'pipe', 'inherit'] });
      proc.stdout.setEncoding('utf8');
      const worker = { proc, buffer: '', pending: new Map() };
      proc.stdout.on('data', (chunk) => this._onStdout(worker, chunk));
      proc.on('error', (e) => this.emit('error', e));
      proc.on('close', (code) => this.emit('worker_close', { code }));
      this.workers.push(worker);
    }
    this.started = true;
    this.emit('started', { size: this.workers.length });
  }

  _onStdout(worker, chunk) {
    worker.buffer += chunk;
    let idx;
    while ((idx = worker.buffer.indexOf('\n')) >= 0) {
      const line = worker.buffer.slice(0, idx).trim();
      worker.buffer = worker.buffer.slice(idx + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch (e) { this.emit('error', new Error('Invalid JSON from worker: ' + line)); continue; }
      const cb = worker.pending.get(obj.id);
      if (cb) {
        cb.resolve(obj);
        worker.pending.delete(obj.id);
      } else this.emit('warn', { msg: 'unmatched worker response', obj });
    }
  }

  async stop() {
    for (const w of this.workers) {
      try { w.proc.kill(); } catch (e) {}
    }
    this.workers = [];
    this.started = false;
  }

  async _chooseWorker() {
    if (this.workers.length === 0) throw new Error('No docker workers');
    let best = this.workers[0];
    for (const w of this.workers) if (w.pending.size < best.pending.size) best = w;
    return best;
  }

  async call(adapterName, prompt, opts = {}, timeoutMs = 120000) {
    if (!this.started) await this.start();
    const worker = await this._chooseWorker();
    const id = mkid('dock');
    const payload = JSON.stringify({ id, adapterName, prompt, opts }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (worker.pending.has(id)) { worker.pending.delete(id); }
        reject(new Error('docker worker timeout'));
      }, timeoutMs);

      worker.pending.set(id, {
        resolve: (obj) => { clearTimeout(timer); resolve(obj); },
        reject: (e) => { clearTimeout(timer); reject(e); }
      });

      try { worker.proc.stdin.write(payload); } catch (e) { worker.pending.delete(id); clearTimeout(timer); reject(e); }
    });
  }
}

/* =========================
   MerovingianHybrid: core hybrid reasoning chamber and cognitive router
   ========================= */
export class MerovingianHybrid extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'MerovingianHybrid';
    this.adapters = { ...RobustAdapters, ...(opts.adapters || {}) };
    this.memoryPath = opts.memoryPath || './merovingian_provenance';
    this.maxReflection = opts.maxReflection ?? 3;
    this.finalizeConfidence = opts.finalizeConfidence ?? 0.92;
    this.escalateConfidence = opts.escalateConfidence ?? 0.78;
    this.calibrator = opts.calibrator || RobustAdapters.calibrator;
    this.safetyCheck = opts.safetyCheck || (async (meta, fused) => ({ ok: true }));
    this.verbose = !!opts.verbose;
    this.highRiskDomains = new Set(opts.highRiskDomains || ['medical', 'legal', 'safety']);
    this.minEscalateLen = opts.minEscalateLen || 30;
    this.dockerPool = opts.dockerImage ? new DockerWorkerPool({ image: opts.dockerImage, size: opts.dockerPoolSize || 2, dockerCmd: opts.dockerCmd || 'docker', args: opts.dockerArgs || [] }) : null;
    this.arbiter = opts.arbiter || null; // optional memory/arbiter to persist traces
    this._ensureDir();
  }

  _log(...a) { if (this.verbose) console.log(`[MerovingianHybrid]`, ...a); this.emit('log', { ts: iso(), args: a }); }
  _traceId() { return mkid('mrv'); }
  async _ensureDir() { try { await fs.mkdir(this.memoryPath, { recursive: true }); } catch (e) {} }

  _fuseCandidates(cands = [], meta = {}) {
    const novelty = meta.novelty ?? 0.5;
    const roleWeight = (role) => {
      if (!role) return 0.5;
      role = role.toLowerCase();
      if (role.includes('deep')) return 0.7 * (novelty) + 0.3;
      if (role.includes('gemini')) return 0.8 * (1 - novelty) + 0.2;
      if (role.includes('gema')) return 0.6;
      if (role.includes('external')) return 0.9;
      return 0.5;
    };

    const scored = cands.map(c => {
      const r = c.role || '';
      const base = roleWeight(r);
      const conf = Math.max(0, Math.min(1, c.confidence ?? 0));
      const score = base * conf;
      return { c, score };
    });

    const total = scored.reduce((s, x) => s + x.score, 0) || 1;
    scored.forEach(s => s.norm = s.score / total);

    const best = scored.reduce((a, b) => ((a.score > b.score) ? a : b), scored[0]);
    const fusedConfidence = Math.min(0.995, scored.reduce((s, x) => s + x.norm * (x.c.confidence ?? 0), 0));
    const weights = scored.map(s => ({ source: s.c.source, norm: s.norm, conf: s.c.confidence }));

    return {
      text: best.c.text,
      confidence: fusedConfidence,
      provenance: cands.map(c => ({ source: c.source, snippet: (c.text || '').slice(0, 200), confidence: c.confidence })),
      weights
    };
  }

  async _persistTrace(trace) {
    try {
      const fn = path.join(this.memoryPath, `${Date.now()}_${trace.traceId}.json`);
      await fs.writeFile(fn, JSON.stringify(trace, null, 2), 'utf8');
      if (this.arbiter && typeof this.arbiter.memorize === 'function') { try { await this.arbiter.memorize({ type: 'merovingian_trace', trace }, { type: 'trace' }); } catch (e) { this._log('arbiter memorize failed', e.message || e); } }
      this.emit('trace', { traceId: trace.traceId, path: fn });
      return fn;
    } catch (e) {
      this._log('persistTrace error', e.message || e);
      return null;
    }
  }

  async start() {
    if (this.dockerPool) await this.dockerPool.start();
    this._log('started');
  }

  async stop() {
    if (this.dockerPool) await this.dockerPool.stop();
    this._log('stopped');
  }

  _shouldEscalate(meta = {}, fused = {}) {
    if (meta.domain && this.highRiskDomains.has(meta.domain)) return { escalate: true, reason: 'high_risk_domain' };
    if ((fused.confidence ?? 0) < this.escalateConfidence) {
      if ((meta.queryLength || 0) >= this.minEscalateLen) return { escalate: true, reason: 'low_conf_long_query' };
      if ((meta.novelty ?? 0) > 0.6) return { escalate: true, reason: 'novelty_high' };
    }
    return { escalate: false, reason: 'none' };
  }

  async _callAdapter(name, adapterFn, prompt, opts = {}, timeoutMs = 120000) {
    try {
      if (typeof adapterFn === 'function') {
        const t0 = Date.now();
        const out = await adapterFn(prompt, opts);
        const t1 = Date.now();
        return { text: String(out.text || ''), confidence: typeof out.confidence === 'number' ? out.confidence : 0.25, meta: out.meta || {}, latency: t1 - t0, source: name };
      } else throw new Error('Adapter missing');
    } catch (e) {
      this._log(`inproc adapter ${name} failed:`, e.message || e);
      if (this.dockerPool) {
        try {
          const resp = await this.dockerPool.call(name, prompt, opts, timeoutMs);
          return { text: String(resp.text || ''), confidence: typeof resp.confidence === 'number' ? resp.confidence : 0.25, meta: resp.meta || {}, latency: resp.latency || null, source: name + ':docker' };
        } catch (err) {
          this._log('docker fallback error', err.message || err);
          return { text: '', confidence: 0.0, meta: {}, latency: null, source: name + ':error' };
        }
      }
      return { text: '', confidence: 0.0, meta: {}, latency: null, source: name + ':error' };
    }
  }

  async evaluate(query, opts = {}) {
    const traceId = this._traceId();
    
    // 1. Quick Perception (The Amygdala)
    const meta = { ...quickPerception(query), ...(opts.meta || {}) };
    this._log('evaluate start', { traceId, meta });

    // 2. Parallel Brain Invocation (Maximum Diversity)
    this._log('Invoking real neural diversity (Gema, DeepSeek, Gemini)...');
    
    const [gemaRes, deepRes, geminiRes] = await Promise.allSettled([
      this._callAdapter('gema', this.adapters.gema, query, { meta }),
      this._callAdapter('deepseek', this.adapters.deepseek, query, { meta }),
      this._callAdapter('gemini', this.adapters.gemini, query, { meta })
    ]);

    const extract = (settled, fallbackSource) => {
        if (settled.status === 'fulfilled') return settled.value;
        return { text: '', confidence: 0.0, source: fallbackSource + ':error', role: fallbackSource };
    };

    const gema = extract(gemaRes, 'gema');
    const deep = extract(deepRes, 'deepseek');
    const gemini = extract(geminiRes, 'gemini');

    let candidates = [
      { source: gema.source, text: gema.text, confidence: gema.confidence, role: 'gema' },
      { source: deep.source, text: deep.text, confidence: deep.confidence, role: 'deepseek' },
      { source: gemini.source, text: gemini.text, confidence: gemini.confidence, role: 'gemini' }
    ];

    let fused = this._fuseCandidates(candidates, meta);
    this._log('initial fused', { fused });

    let iter = 0;
    while ((fused.confidence ?? 0) < this.finalizeConfidence && iter < this.maxReflection) {
      iter += 1;
      this._log('reflection iter', { iter, fusedConfidence: fused.confidence });

      const [critique, expand] = await Promise.allSettled([
        this._callAdapter('gemini', this.adapters.gemini, `Critique/Improve:\n\n${fused.text}`, { meta }),
        this._callAdapter('deepseek', this.adapters.deepseek, `Offer alternative hypotheses:\n\n${fused.text}`, { meta })
      ]);

      const crit = (critique.status === 'fulfilled' ? critique.value : { text: '', confidence: 0.0 });
      const alt = (expand.status === 'fulfilled' ? expand.value : { text: '', confidence: 0.0 });

      candidates.push({ source: 'GeminiCritique', text: crit.text, confidence: crit.confidence, role: 'gemini' });
      candidates.push({ source: 'DeepAlt', text: alt.text, confidence: alt.confidence, role: 'deepseek' });

      fused = this._fuseCandidates(candidates, meta);
      this._log('fused after reflection', { fused });

      if (iter === 1) {
        const esc = this._shouldEscalate(meta, fused);
        if (esc.escalate && this.dockerPool) {
          this._log('escalation decision', esc);
          this.emit('escalation', { traceId, reason: esc.reason, meta });

          try {
            const adapterNames = ['gema', 'deepseek', 'gemini'];
            const calls = adapterNames.map(n => this.dockerPool.call(n, query, { meta }).catch(e => ({ id: mkid('err'), text: '', confidence: 0.0 })));
            const results = await Promise.all(calls);
            const srcs = ['Gema.docker', 'DeepSeek.docker', 'Gemini.docker'];
            for (let i = 0; i < results.length; i++) {
              const r = results[i];
              candidates.push({ source: srcs[i], text: r.text || '', confidence: typeof r.confidence === 'number' ? r.confidence : 0.0, role: srcs[i].toLowerCase() });
            }
            fused = this._fuseCandidates(candidates, meta);
            this._log('fused after docker escalation', { fused });
          } catch (e) {
            this._log('docker escalation error', e.message || e);
            this.emit('error', e);
          }
        }
      }
    }

    try {
      const calibratorFn = await this.calibrator([{ candidates, fused }]) || ((x) => x);
      fused.confidence = calibratorFn(fused.confidence);
    } catch (e) {
      this._log('calibrator error', e.message || e);
    }

    try {
      const safe = await this.safetyCheck(meta, fused);
      if (!safe.ok) {
        const declined = { final: `DECLINED: ${safe.reason || 'safety'}`, confidence: fused.confidence, traceId, fused };
        await this._persistTrace({ traceId, query, meta, candidates, fused, iter, stage: 'safety_declined' });
        return declined;
      }
    } catch (e) {
      this._log('safetyCheck error', e.message || e);
    }

    const trace = { traceId, ts: iso(), query, meta, candidates, fused, iter, mode: 'hybrid' };
    const saved = await this._persistTrace(trace);
    return { final: fused.text, confidence: fused.confidence, traceId, provenancePath: saved, provenance: fused.provenance };
  }
}