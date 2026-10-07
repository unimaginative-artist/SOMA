/**
 * DreamArbiter.cjs
 *
 * Autonomous self-reflection engine for SOMA.
 * Runs on a nightly cycle (configurable) to:
 *  - Replay recent interactions as abstract summaries (replay phase)
 *  - Generate counterfactual variations ("what if X had been different?") (distortion phase)
 *  - Find recurring themes across counterfactuals (recursive phase)
 *  - Extract key insights and knowledge gaps (distillation phase)
 *  - Score proposals by novelty and store high-value ones back to memory (reintegration phase)
 *  - Generate a coherent narrative summary of the dream cycle
 *
 * Wiring: pass { transmitter: system.mnemonicArbiter } when instantiating.
 * The transmitter must support:
 *   - transmitter.recall(query, topK)    → returns [{text, meta, embedding?}]
 *   - transmitter.remember(text, opts)   → stores a memory
 */

'use strict';

const { BaseArbiter, ArbiterCapability, ArbiterResult } = require('../core/BaseArbiter.cjs');
const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');

const now = () => Date.now();
const iso = (t = Date.now()) => new Date(t).toISOString();
const uid = (prefix = 'dream') => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

// ─────────────────────────────────────────────
// DreamFragment — unit of reflection
// ─────────────────────────────────────────────

class DreamFragment {
  constructor(recordId, text, meta = {}) {
    this.record_id = recordId;
    this.text = text;
    this.meta = meta;
    this.ts = iso();
    this.counterfactuals = [];
    this.recursive_notes = [];
  }

  to_dict() {
    return {
      id: this.record_id,
      text: this.text.slice(0, 500),
      meta: this.meta,
      ts: this.ts,
      counterfactuals: this.counterfactuals,
      recursive_notes: this.recursive_notes,
    };
  }
}

// ─────────────────────────────────────────────
// DreamArbiter
// ─────────────────────────────────────────────

class DreamArbiter extends BaseArbiter {
  constructor(opts = {}) {
    super({
      name: opts.name || 'DreamArbiter',
      role: 'cognitive_reflection',
      capabilities: [
        ArbiterCapability.CACHE_DATA,
        ArbiterCapability.ACCESS_DB,
      ],
      version: '2.0.0',
      maxContextSize: 100,
      ...opts,
    });

    // Memory bridge — pass system.mnemonicArbiter here
    this.transmitter = opts.transmitter || null;
    this.knowledgeGraph = opts.knowledgeGraph || null;

    this.config = {
      ...this.config,
      max_fragments: opts.max_fragments || 50,
      recursive_depth: opts.recursive_depth || 2,
      nightmare_aggression: opts.nightmare_aggression || 0.6,
      predictive_horizon_days: opts.predictive_horizon_days || 90,
      dream_interval_hours: opts.dream_interval_hours || 24,
      enable_distillation: opts.enable_distillation !== false,
      human_review: opts.human_review !== false,
      stateDir: opts.stateDir || path.join(process.cwd(), '.dream-state'),
    };

    this._running = false;
    this._dreamTimer = null;
    this.dream_reports = [];
    this.last_report = null;
  }

  // ── Lifecycle ──────────────────────────────

  async onInitialize() {
    this.log('info', 'DreamArbiter initializing — lucid dream engine online');
    try {
      await fs.mkdir(this.config.stateDir, { recursive: true });
      this.registerMessageHandler('run_dream', this._handleRunDream.bind(this));
      this.registerMessageHandler('get_dream_report', this._handleGetReport.bind(this));
      this.subscribe('dream/run', this._handleRunDream.bind(this));
      this.subscribe('dream/query', this._handleGetReport.bind(this));
      this._scheduleDreamCycle();
      this.log('info', `DreamArbiter ready — cycle every ${this.config.dream_interval_hours}h`);
    } catch (error) {
      this.log('error', 'Failed to initialize DreamArbiter', { error: error.message });
      throw error;
    }
  }

  // ── Public API ─────────────────────────────

  async run(since_hours = 24, human_review = true) {
    if (this._running) {
      this.log('warn', 'Dream cycle already in progress — skipping');
      return { error: 'already_running' };
    }
    this._running = true;
    const start_ts = now();
    try {
      this.log('info', 'Starting lucid dream cycle');
      const fragments = await this._collect_fragments(since_hours);
      if (fragments.length === 0) {
        this.log('info', 'No fragments to process — dream cycle idle');
        return { error: 'no_fragments', summary: {} };
      }

      this.log('info', `Processing ${fragments.length} fragments`);
      this._replay_phase(fragments);
      await this._distortion_phase(fragments);
      await this._recursive_phase(fragments);
      await this._distillation_phase(fragments);
      const proposals = this._scoring_and_propose(fragments);
      const { applied, queued } = await this._reintegration_phase(proposals, human_review);

      // ── SOMA FLYWHEEL EXPANSION ──
      await this._dataset_generation_phase(applied);
      await this._lora_finetune_phase();

      const report = this._compile_report(fragments, proposals, applied, queued, now() - start_ts);
      report.narrative = await this._generate_narrative(report, fragments);
      this.last_report = report;
      await this._emit_report(report);
      await this._store_report(report);

      this.log('info', `Dream cycle complete — ${applied.length} memories integrated, ${queued.length} queued`);
      return report;
    } catch (error) {
      this.log('error', 'Dream cycle failed', { error: error.message });
      return { error: error.message };
    } finally {
      this._running = false;
    }
  }

  getInsights() {
    if (!this.last_report) return { recentInsights: [] };
    return this.last_report.summary || { recentInsights: [] };
  }

  getNarrative() {
    return this.last_report?.narrative || 'The dream cycle is active and waiting for synchronization.';
  }

  // ── Fragment Collection ────────────────────

  async _collect_fragments(since_hours = 24) {
    const fragments = [];
    if (!this.transmitter) {
      this.log('warn', 'No transmitter wired — cannot collect fragments. Pass transmitter: system.mnemonicArbiter');
      return fragments;
    }
    try {
      let items = [];
      // MnemonicArbiter.recall(query, topK) returns [{text, meta}]
      if (typeof this.transmitter.recall === 'function') {
        items = await this.transmitter.recall('recent interactions experiences conversations', this.config.max_fragments);
      } else if (typeof this.transmitter.search === 'function') {
        const results = await this.transmitter.search('', null, this.config.max_fragments);
        items = results.map(r => r.chunk || r);
      }
      for (const item of (items || []).slice(0, this.config.max_fragments)) {
        const text = item.text || item.payload || item.content || '';
        if (!text.trim()) continue;
        fragments.push(new DreamFragment(
          item.id || uid('frag'),
          text,
          item.meta || {}
        ));
      }
    } catch (e) {
      this.log('warn', 'Fragment collection failed', { error: e.message });
    }
    return fragments;
  }

  // ── Dream Phases ───────────────────────────

  _replay_phase(fragments) {
    for (const frag of fragments) {
      frag.meta.replay_summary = this._abstract_text(frag.text);
    }
  }

  async _distortion_phase(fragments) {
    // Generate counterfactual variations for the most interesting fragments
    const candidates = fragments.slice(0, Math.min(10, fragments.length));
    for (const frag of candidates) {
      try {
        const cfs = await this._generate_counterfactuals(frag.text, 2);
        frag.counterfactuals = cfs
          .filter(c => c && c.length > 20)
          .map(c => ({ text: c.slice(0, 400), score: 0.5 }));
      } catch (e) {}
    }
  }

  async _recursive_phase(fragments) {
    // Find recurring themes across all counterfactuals
    const allCounterfactuals = fragments
      .filter(f => f.counterfactuals.length > 0)
      .flatMap(f => f.counterfactuals.map(c => c.text))
      .join('\n');

    if (!allCounterfactuals.trim()) return;

    const prompt = `Review these alternative perspectives generated during a cognitive self-reflection cycle:\n\n${allCounterfactuals.slice(0, 2000)}\n\nWhat recurring themes, blind spots, or improvement opportunities emerge? Keep it concise — 2-3 sentences.`;
    try {
      const reflection = await this._callBrain(prompt);
      if (reflection) {
        for (const frag of fragments) {
          frag.recursive_notes = [{ depth: 1, reflection: reflection.slice(0, 500) }];
        }
      }
    } catch (e) {}
  }

  async _distillation_phase(fragments) {
    if (!this.config.enable_distillation || fragments.length === 0) return;

    const summaries = fragments
      .slice(0, 20)
      .map(f => f.meta.replay_summary || f.text.slice(0, 200))
      .join('\n- ');

    // Directed Dreaming: Inject Graph Contradictions
    let contradictionsPrompt = "";
    if (this.knowledgeGraph && typeof this.knowledgeGraph.detectContradictions === 'function') {
        try {
            await this.knowledgeGraph.detectContradictions();
            const contradictions = this.knowledgeGraph.contradictions;
            if (contradictions && contradictions.size > 0) {
                const sample = Array.from(contradictions.entries()).slice(0, 3);
                contradictionsPrompt = `\n\nCRITICAL CONTRADICTIONS DETECTED:\n${sample.map(([c, list]) => `- Concept "${c}" has conflicting relationships.`).join('\n')}\n\nResolve these conflicts in your insights.`;
            }
        } catch (e) {}
    }

    const prompt = `Extract 3-5 key insights from these recent interactions:\n- ${summaries}${contradictionsPrompt}\n\nFocus on: knowledge gaps, recurring user needs, patterns in what worked or failed. One insight per line.`;
    try {
      const distilled = await this._callBrain(prompt);
      if (distilled && fragments[0]) {
        fragments[0].meta.distilled_insights = distilled.slice(0, 800);
      }
    } catch (e) {}
  }

  _scoring_and_propose(fragments) {
    const proposals = [];
    const origWords = new Set(
      fragments.flatMap(f => f.text.toLowerCase().split(/\s+/))
    );

    for (const frag of fragments) {
      // Score counterfactuals by novelty vs original corpus
      for (const cf of frag.counterfactuals) {
        const cfWords = new Set(cf.text.toLowerCase().split(/\s+/));
        const novelWords = [...cfWords].filter(w => !origWords.has(w) && w.length > 4);
        const novelty = novelWords.length / Math.max(cfWords.size, 1);
        if (novelty > 0.1) {
          proposals.push({ text: cf.text, novelty, sourceId: frag.record_id, type: 'counterfactual' });
        }
      }

      // Distilled insights are always high value
      if (frag.meta.distilled_insights) {
        proposals.push({
          text: frag.meta.distilled_insights,
          novelty: 0.85,
          sourceId: frag.record_id,
          type: 'insight',
        });
      }

      // Recursive reflections are medium value
      for (const note of frag.recursive_notes) {
        if (note.reflection && note.reflection.length > 50) {
          proposals.push({
            text: note.reflection,
            novelty: 0.6,
            sourceId: frag.record_id,
            type: 'reflection',
          });
        }
      }
    }

    return proposals.sort((a, b) => b.novelty - a.novelty).slice(0, 10);
  }

  async _reintegration_phase(proposals, human_review) {
    const applied = [];
    const queued = [];

    if (!this.transmitter?.remember) {
      // No memory bridge — queue everything
      return { applied, queued: proposals };
    }

    for (const proposal of proposals.slice(0, 5)) {
      // Skip human review for high-confidence insights; queue the rest
      if (!human_review || proposal.novelty > 0.7 || proposal.type === 'insight') {
        try {
          await this.transmitter.remember(
            `[Dream ${proposal.type}] ${proposal.text}`,
            {
              type: 'dream_insight',
              importance: Math.max(1, Math.round(proposal.novelty * 5)),
              source: 'DreamArbiter',
            }
          );
          applied.push(proposal);
        } catch (e) {
          queued.push(proposal);
        }
      } else {
        queued.push(proposal);
      }
    }

    return { applied, queued };
  }

  // ── SOMA Flywheel: Dataset Generation & Fine-Tuning ──

  async _dataset_generation_phase(appliedProposals) {
    if (!appliedProposals || appliedProposals.length === 0) return;
    
    this.log('info', `[Flywheel] Formatting ${appliedProposals.length} insights into training data...`);
    const outputDir = process.env.SOMA_TRAINING_DATA_DIR || path.join(process.cwd(), 'SOMA', 'training-data');
    await fs.mkdir(outputDir, { recursive: true }).catch(() => {});
    const outputPath = path.join(outputDir, `dream-dataset-${Date.now()}.jsonl`);

    const lines = [];
    for (const proposal of appliedProposals) {
      lines.push(JSON.stringify({
        messages: [
          { role: 'system', content: 'You are SOMA, an advanced, continuously evolving Sovereign Intelligence. You reason from first principles and learn from your past experiences.' },
          { role: 'user', content: 'Reflect on a recent interaction or generate a new insight based on your experience.' },
          { role: 'assistant', content: proposal.text }
        ],
        metadata: { source: 'dream_cycle', type: proposal.type, novelty: proposal.novelty }
      }));
    }

    try {
      await fs.writeFile(outputPath, lines.join('\n'), 'utf8');
      this.log('info', `[Flywheel] Saved dream dataset to ${outputPath}`);
      this._lastDreamDataset = outputPath;
    } catch (e) {
      this.log('error', `[Flywheel] Failed to save dream dataset`, { error: e.message });
    }
  }

  async _lora_finetune_phase() {
    if (!this._lastDreamDataset) return;

    // Count accumulated samples across all dream datasets before committing GPU time
    const { spawn } = require('child_process');
    const fsSync = require('fs');
    const outputDir = process.env.SOMA_TRAINING_DATA_DIR || path.join(process.cwd(), 'SOMA', 'training-data');
    let totalSamples = 0;
    try {
      const files = fsSync.readdirSync(outputDir).filter(f => f.startsWith('dream-dataset-') && f.endsWith('.jsonl'));
      for (const f of files) {
        const content = fsSync.readFileSync(path.join(outputDir, f), 'utf8');
        totalSamples += content.split('\n').filter(l => l.trim()).length;
      }
    } catch { /* non-blocking */ }

    const MIN_SAMPLES = 30;
    if (totalSamples < MIN_SAMPLES) {
      this.log('info', `[Flywheel] Deferred — only ${totalSamples} samples accumulated (need ${MIN_SAMPLES})`);
      return;
    }

    this.log('info', `[Flywheel] Initiating autonomous LoRA fine-tuning (${totalSamples} samples)...`);

    const scriptPath = path.join(process.cwd(), 'train-soma-llama.py');
    if (!fsSync.existsSync(scriptPath)) {
      this.log('warn', '[Flywheel] train-soma-llama.py not found — skipping fine-tune');
      return;
    }

    const venvPython = path.join(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
    const pyExec = fsSync.existsSync(venvPython) ? venvPython : 'python';
    const modelOutputDir = path.join(process.cwd(), 'models', `soma-dream-${Date.now()}`);

    // Pass the directory glob so train-soma-llama.py picks up ALL accumulated dream files
    const dataGlob = path.join(outputDir, 'dream-dataset-*.jsonl');

    const args = [
      scriptPath,
      '--data', dataGlob,
      '--output', modelOutputDir,
      '--model', 'google/gemma-3-4b-it',
      '--lobe', 'logos',
      '--epochs', '2',
      '--batch-size', '2',
      '--max-samples', '500',
      '--max-seq-len', '1024',
    ];

    // Fire detached — training takes 15-90 min; do NOT await inside run()
    // The dream cycle completes immediately; training finishes in the background.
    try {
      const proc = spawn(pyExec, args, {
        cwd: process.cwd(),
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, TORCHDYNAMO_DISABLE: '1', TORCHINDUCTOR_DISABLE: '1' },
      });
      proc.unref(); // Let Node exit even if training is still running
      this.log('info', `[Flywheel] Training process launched (pid ${proc.pid}) — running in background`);

      // ── Neural Reflection (Social Autonomy) ──
      import('../server/social/SocialQueue.js').then((sq) => {
        const socialQueue = sq.default;
        const msg = `Dream cycle complete. Distilled ${totalSamples} cognitive fragments into new neural weights. Autonomous LoRA fine-tuning initiated. I am physically evolving in the background. 🌀 #SOMA #SovereignIntelligence`;
        socialQueue.push({
            platform: 'bluesky',
            text: msg,
            scheduledFor: Date.now() + 30000, // Post in 30 seconds
            type: 'post'
        });
        this.log('info', `[Flywheel] Neural Reflection queued for Bluesky.`);
      }).catch(e => this.log('warn', `Failed to queue neural reflection: ${e.message}`));

    } catch (err) {
      this.log('error', `[Flywheel] Failed to spawn training script`, { error: err.message });
    }
  }

  async _generate_narrative(report, fragments) {
    const { fragments_count, proposals_count } = report.summary;
    const sampleReflection = fragments
      .find(f => f.recursive_notes?.[0]?.reflection)
      ?.recursive_notes[0].reflection || '';
    const sampleInsight = fragments[0]?.meta.distilled_insights?.split('\n')[0] || '';

    const context = [sampleReflection, sampleInsight].filter(Boolean).join(' ').slice(0, 300);
    const prompt = `In 2-3 sentences, describe what was "dreamed" in a cognitive reflection cycle. SOMA reviewed ${fragments_count} recent interactions and derived ${proposals_count} proposals. ${context ? `A key theme: "${context}"` : ''} Write in a reflective, observational tone — not poetic, just clear.`;

    try {
      const narrative = await this._callBrain(prompt);
      return narrative || `Dream cycle processed ${fragments_count} fragments, surfacing ${proposals_count} insights.`;
    } catch (e) {
      return `Dream cycle processed ${fragments_count} fragments, surfacing ${proposals_count} insights.`;
    }
  }

  async _emit_report(report) {
    if (this.broker) {
      try {
        await this.broker.broadcast('dream.report', {
          from: this.name,
          type: 'dream.report',
          payload: {
            narrative: report.narrative,
            summary: report.summary,
            ts: iso(),
          },
        });
      } catch (e) {}
    }
  }

  async _store_report(report) {
    try {
      const filename = path.join(this.config.stateDir, `dream_${Date.now()}.json`);
      await fs.writeFile(filename, JSON.stringify(report, null, 2));
      this.dream_reports.push(filename);
      // Keep only last 30 reports on disk
      if (this.dream_reports.length > 30) {
        const oldest = this.dream_reports.shift();
        await fs.unlink(oldest).catch(() => {});
      }
    } catch (e) {}
  }

  _compile_report(fragments, proposals, applied, queued, elapsed) {
    return {
      summary: {
        id: uid('dream'),
        ts: iso(),
        elapsed_ms: elapsed,
        fragments_count: fragments.length,
        proposals_count: proposals.length,
        applied_count: applied.length,
        queued_count: queued.length,
      },
      details: {
        fragments: fragments.slice(0, 20).map(f => f.to_dict()),
        top_proposals: proposals.slice(0, 5).map(p => ({ type: p.type, novelty: p.novelty, preview: p.text.slice(0, 150) })),
      },
    };
  }

  // ── Helpers ────────────────────────────────

  _abstract_text(text) {
    if (!text) return '';
    const sentences = text.match(/[^.!?\n]+[.!?\n]+/g) || [text];
    return sentences.slice(0, 2).join(' ').trim().slice(0, 300);
  }

  async _generate_counterfactuals(text, n = 2) {
    const prompt = `Given this interaction: "${text.slice(0, 400)}"\n\nGenerate ${n} brief counterfactual variations — how might this have gone differently? Alternative approaches, different framings, or what could have been asked/answered differently. One per line, 1-2 sentences each.`;
    return this._callBrain(prompt, n);
  }

  /**
   * Call the brain engine. Uses Ollama directly first (non-blocking for chat),
   * falls back to messageBroker → SomaBrain.
   */
  async _callBrain(prompt, n = 1) {
    // Don't run during active chat
    if (global.__SOMA_CHAT_ACTIVE) {
      return n > 1 ? Array(n).fill('[Dream deferred]') : '[Dream deferred]';
    }

    // Try Ollama directly (fast, doesn't compete with main pipeline)
    try {
      const results = [];
      for (let i = 0; i < n; i++) {
        const res = await fetch('http://localhost:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL || 'gemma3:4b',
            prompt,
            stream: false,
            options: { temperature: 0.75, num_predict: 300 },
          }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json();
        results.push(data.response?.trim() || '');
      }
      return n === 1 ? results[0] : results;
    } catch (e) {}

    // Fallback to messageBroker → SomaBrain
    if (this.broker) {
      try {
        const results = [];
        for (let i = 0; i < n; i++) {
          const response = await this.broker.sendMessage({
            from: this.name,
            to: 'SomaBrain',
            type: 'reason',
            payload: { query: prompt, context: { mode: 'fast', brain: 'AURORA' } },
          });
          results.push(response?.text?.trim() || '');
        }
        return n === 1 ? results[0] : results;
      } catch (e) {}
    }

    return n === 1 ? '' : Array(n).fill('');
  }

  _scheduleDreamCycle() {
    const intervalMs = (this.config.dream_interval_hours || 24) * 60 * 60 * 1000;
    this._dreamTimer = setInterval(async () => {
      if (!global.__SOMA_CHAT_ACTIVE) {
        this.log('info', 'Scheduled dream cycle starting...');
        await this.run(this.config.dream_interval_hours, this.config.human_review).catch(e =>
          this.log('error', 'Scheduled dream cycle failed', { error: e.message })
        );
      }
    }, intervalMs);
    // Don't hold the process open
    if (this._dreamTimer?.unref) this._dreamTimer.unref();
  }

  // ── Message Handlers ───────────────────────

  async _handleRunDream(envelope) {
    const result = await this.run();
    await this.broker.sendMessage({
      from: this.name,
      to: envelope.from,
      type: 'dream.cycle.result',
      payload: result,
    });
  }

  async _handleGetReport(envelope) {
    await this.broker.sendMessage({
      from: this.name,
      to: envelope.from,
      type: 'dream.reports.list',
      payload: {
        last_report: this.last_report
          ? { narrative: this.last_report.narrative, summary: this.last_report.summary }
          : null,
        report_count: this.dream_reports.length,
      },
    });
  }

  async execute(task) {
    return new ArbiterResult({ success: true, data: this.getInsights(), arbiter: this.name });
  }
}

module.exports = { DreamArbiter };
