// MerovingianHybrid.mjs
// Hybrid Merovingian: Unified Event Bus + Hybrid Router + Reflection Module
// Single-file drop-in for your SLC / TriBrain stack.
// Author: for Owner
// VERSION: 2.0.0 (SOMA Integration)
//
// USAGE:
//   import { MerovingianHybrid } from './cognitive/MerovingianHybrid.mjs';
//   const m = new MerovingianHybrid({ ...opts });
//   await m.start(); // optional (starts docker pool)
//   const answer = await m.evaluate("Why does the dog run?", { mode: 'reflective', meta: {...} });

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import EventEmitter from 'events';

const iso = (t = Date.now()) => new Date(t).toISOString();
const mkid = (p = 'mrv') => `${p}_${crypto.randomBytes(6).toString('hex')}`;

/* =========================
   Default Adapter Stubs (REPLACE)
   Each adapter MUST be async and return:
     { text: string, confidence: number, meta?: {} }
   Replace these with your real Gema / DeepSeek / Gemini / Retriever adapters.
   ========================= */
export const DefaultAdapters = {
  async gema(q, opts = {}) { return { text: `[GEMA] ${q}`, confidence: 0.82, meta: { role: 'gema' } }; },
  async deepseek(q, opts = {}) { return { text: `[DEEPSEEK] deep response for ${q}`, confidence: 0.55, meta: { role: 'deepseek' } }; },
  async gemini(q, opts = {}) { return { text: `[GEMINI] refined: ${q}`, confidence: 0.72, meta: { role: 'gemini' } }; },
  async retriever(q, opts = {}) { return { sources: [], snippets: [] }; },
  async calibrator(samples = []) { return (c) => Math.max(0, Math.min(0.995, c)); }
};

/* =========================
   DockerWorkerPool: long-running docker processes that speak newline-delimited JSON
   - Provide `image` in options to enable pool.
   - Worker must accept JSON lines { id, adapterName, prompt, opts } and respond { id, text, confidence, meta }.
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
    // pick first worker with the smallest pending map
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
   - Emits events: 'trace', 'log', 'escalation', 'error'
   - Public API: start(), stop(), evaluate(query, opts)
   ========================= */
export class MerovingianHybrid extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.name = opts.name || 'MerovingianHybrid';
    this.adapters = { ...DefaultAdapters, ...(opts.adapters || {}) };
    this.memoryPath = opts.memoryPath || path.join(process.cwd(), 'SOMA', 'merovingian_provenance');
    this.maxReflection = opts.maxReflection ?? 3;
    this.finalizeConfidence = opts.finalizeConfidence ?? 0.92;
    this.escalateConfidence = opts.escalateConfidence ?? 0.78;
    this.calibrator = opts.calibrator || DefaultAdapters.calibrator;
    this.safetyCheck = opts.safetyCheck || (async (meta, fused) => ({ ok: true }));
    this.verbose = !!opts.verbose;
    this.highRiskDomains = new Set(opts.highRiskDomains || ['medical', 'legal', 'safety']);
    this.minEscalateLen = opts.minEscalateLen || 30;
    this.dockerPool = opts.dockerImage ? new DockerWorkerPool({ image: opts.dockerImage, size: opts.dockerPoolSize || 2, dockerCmd: opts.dockerCmd || 'docker', args: opts.dockerArgs || [] }) : null;

    // SOMA Integrations
    this.mnemonicArbiter = opts.mnemonicArbiter || null; // for memory persistence
    this.tribrain = opts.tribrain || null; // TriBrain integration

    this._ensureDir();
  }

  _log(...a) { if (this.verbose) console.log(`[MerovingianHybrid]`, ...a); this.emit('log', { ts: iso(), args: a }); }
  _traceId() { return mkid('mrv'); }
  async _ensureDir() { try { await fs.mkdir(this.memoryPath, { recursive: true }); } catch (e) {} }

  /* Lightweight fusion heuristic - weighted by role and confidence */
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
      text: `[[FUSED weights=${JSON.stringify(weights)}]]\n\n${best.c.text}`,
      confidence: fusedConfidence,
      provenance: cands.map(c => ({ source: c.source, snippet: (c.text || '').slice(0, 200), confidence: c.confidence }))
    };
  }

  async _persistTrace(trace) {
    try {
      const fn = path.join(this.memoryPath, `${Date.now()}_${trace.traceId}.json`);
      await fs.writeFile(fn, JSON.stringify(trace, null, 2), 'utf8');

      // Persist to MnemonicArbiter if available
      if (this.mnemonicArbiter && typeof this.mnemonicArbiter.remember === 'function') {
        try {
          await this.mnemonicArbiter.remember(
            JSON.stringify(trace),
            { type: 'merovingian_trace', traceId: trace.traceId, importance: 0.7 }
          );
        } catch (e) {
          this._log('mnemonic persist failed', e.message || e);
        }
      }

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

  /* Decide whether to escalate to docker isolation */
  _shouldEscalate(meta = {}, fused = {}) {
    if (meta.domain && this.highRiskDomains.has(meta.domain)) return { escalate: true, reason: 'high_risk_domain' };
    if ((fused.confidence ?? 0) < this.escalateConfidence) {
      if ((meta.queryLength || 0) >= this.minEscalateLen) return { escalate: true, reason: 'low_conf_long_query' };
      if ((meta.novelty ?? 0) > 0.6) return { escalate: true, reason: 'novelty_high' };
    }
    return { escalate: false, reason: 'none' };
  }

  /* Wrapper: try in-process adapter, fallback to docker pool adapter if available */
  async _callAdapter(name, adapterFn, prompt, opts = {}, timeoutMs = 120000) {
    // In-process attempt
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

  /* Main API: evaluate */
  async evaluate(query, opts = {}) {
    const traceId = this._traceId();
    const meta = { ...(opts.meta || {}) };
    meta.queryLength = meta.queryLength ?? (query ? query.split(/\s+/).length : 0);
    meta.novelty = meta.novelty ?? (meta.queryLength > 40 ? 0.7 : 0.3);
    this._log('evaluate start', { traceId, meta });

    // 1) Gema route
    const gema = await this._callAdapter('gema', this.adapters.gema, query, { meta }).catch(e => ({ text: '', confidence: 0.0, source: 'gema:error' }));
    gema.role = gema.meta?.role || 'gema';

    // 2) parallel deepseek & gemini
    const [deepRes, geminiRes] = await Promise.allSettled([
      this._callAdapter('deepseek', this.adapters.deepseek, query, { meta }),
      this._callAdapter('gemini', this.adapters.gemini, query, { meta })
    ]);

    const deep = (deepRes.status === 'fulfilled' ? deepRes.value : { text: '', confidence: 0.0, source: 'deepseek:error' });
    deep.role = deep.meta?.role || 'deepseek';
    const gemini = (geminiRes.status === 'fulfilled' ? geminiRes.value : { text: '', confidence: 0.0, source: 'gemini:error' });
    gemini.role = gemini.meta?.role || 'gemini';

    let candidates = [
      { source: 'Gema', text: gema.text, confidence: gema.confidence, role: gema.role },
      { source: 'DeepSeek', text: deep.text, confidence: deep.confidence, role: deep.role },
      { source: 'Gemini', text: gemini.text, confidence: gemini.confidence, role: gemini.role }
    ];

    // 3) initial fuse
    let fused = this._fuseCandidates(candidates, meta);
    this._log('initial fused', { fused });

    // 4) reflective loop
    let iter = 0;
    while ((fused.confidence ?? 0) < this.finalizeConfidence && iter < this.maxReflection) {
      iter += 1;
      this._log('reflection iter', { iter, fusedConfidence: fused.confidence });

      // ask gemini to critique and deepseek to expand alternatives
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

      // after first reflection, decide whether to escalate
      if (iter === 1) {
        const esc = this._shouldEscalate(meta, fused);
        if (esc.escalate && this.dockerPool) {
          this._log('escalation decision', esc);
          this.emit('escalation', { traceId, reason: esc.reason, meta });

          try {
            // run each adapter via docker isolation in parallel
            const adapterNames = ['gema', 'deepseek', 'gemini'];
            const calls = adapterNames.map(n => this.dockerPool.call(n, query, { meta }).catch(e => ({ id: mkid('err'), text: '', confidence: 0.0 })));
            const results = await Promise.all(calls);
            // merge docker results into candidates
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

    // 5) calibrate final confidence
    try {
      const calibratorFn = await this.calibrator([{ candidates, fused }]) || ((x) => x);
      fused.confidence = calibratorFn(fused.confidence);
    } catch (e) {
      this._log('calibrator error', e.message || e);
    }

    // 6) safety check
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

    // 7) persist trace & return
    const trace = { traceId, ts: iso(), query, meta, candidates, fused, iter, mode: 'hybrid' };
    const saved = await this._persistTrace(trace);
    return { final: fused.text, confidence: fused.confidence, traceId, provenancePath: saved };
  }
}

/* =========================
   END FILE
   ========================= */

export default MerovingianHybrid;
