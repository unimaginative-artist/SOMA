/**
 * NeocortexSystem1Bridge.js
 * 
 * High-performance, fail-open Node.js client for the SOMA System 1 Substrate
 * (Laya / ModernBERT-large 421M non-autoregressive decision model).
 * 
 * Provides sub-35ms typed decisions for:
 *   - Turn routing & Act-vs-Escalate gating
 *   - Bidirectional memory arbitration & contradiction resolution
 *   - Memory ingestion filtering
 *   - Closed-loop experience distillation
 */

import http from 'http';
import { spawn } from 'child_process';
import path from 'path';

export class NeocortexSystem1Bridge {
  constructor(opts = {}) {
    this.name = 'NeocortexSystem1Bridge';
    this.host = opts.host || process.env.SOMA_SYSTEM1_HOST || '127.0.0.1';
    this.port = Number(opts.port || process.env.SOMA_SYSTEM1_PORT || 5055);
    this.baseUrl = opts.baseUrl || `http://${this.host}:${this.port}`;
    this.timeoutMs = Number(opts.timeoutMs || process.env.SOMA_SYSTEM1_TIMEOUT_MS || 1500);
    this.logger = opts.logger || console;

    // Circuit breaker state
    this.isCircuitOpen = false;
    this.consecutiveFailures = 0;
    this.maxFailures = 3;
    this.cooldownUntil = 0;
    this.cooldownDurationMs = 10000; // 10s cooldown when daemon is down
    this._childProcess = null;
    this._lastHealth = null;

    // Keep-alive agent for ultra-low latency connection reuse
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 10,
      timeout: this.timeoutMs
    });
  }

  /**
   * Check if circuit breaker allows requests.
   */
  _isAvailable() {
    if (!this.isCircuitOpen) return true;
    if (Date.now() > this.cooldownUntil) {
      // Cooldown expired, allow a probe attempt (half-open)
      return true;
    }
    return false;
  }

  _recordSuccess() {
    this.consecutiveFailures = 0;
    this.isCircuitOpen = false;
  }

  _recordFailure(err) {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxFailures) {
      this.isCircuitOpen = true;
      this.cooldownUntil = Date.now() + this.cooldownDurationMs;
      this.logger.warn?.(`[${this.name}] Circuit opened after ${this.consecutiveFailures} consecutive failures: ${err.message}. System 1 failing open for ${this.cooldownDurationMs / 1000}s.`);
    }
  }

  /**
   * Internal low-latency JSON HTTP POST request with strict timeout.
   */
  async _post(endpoint, payload) {
    if (!this._isAvailable()) {
      return null;
    }

    const t0 = Date.now();
    return new Promise((resolve) => {
      const data = JSON.stringify(payload);
      const req = http.request(
        `${this.baseUrl}${endpoint}`,
        {
          method: 'POST',
          agent: this.agent,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data)
          },
          timeout: this.timeoutMs
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              this._recordSuccess();
              try {
                const parsed = JSON.parse(body);
                parsed._clientLatencyMs = Date.now() - t0;
                resolve(parsed);
              } catch (e) {
                this._recordFailure(e);
                resolve(null);
              }
            } else {
              this._recordFailure(new Error(`HTTP ${res.statusCode}: ${body}`));
              resolve(null);
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Timeout after ${this.timeoutMs}ms`));
      });

      req.on('error', (err) => {
        this._recordFailure(err);
        resolve(null);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Health check / probe.
   */
  async ping() {
    const t0 = Date.now();
    return new Promise((resolve) => {
      const req = http.get(
        `${this.baseUrl}/health`,
        { agent: this.agent, timeout: Math.max(this.timeoutMs, 200) },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              this._recordSuccess();
              try {
                const parsed = JSON.parse(body);
                this._lastHealth = parsed;
                resolve({ online: true, latencyMs: Date.now() - t0, ...parsed });
              } catch {
                resolve({ online: false, error: 'JSON parse error' });
              }
            } else {
              resolve({ online: false, statusCode: res.statusCode });
            }
          });
        }
      );
      req.on('error', (err) => {
        resolve({ online: false, error: err.message });
      });
      req.end();
    });
  }

  /**
   * Sensory & Turn Routing Gate:
   * Non-autoregressive classification of lane, act-vs-escalate, safety, and urgency.
   */
  async classifyTurn(text, context = {}) {
    if (!text || typeof text !== 'string') return null;

    const payload = {
      text,
      context: {
        channel: context.channel || 'discord',
        user: context.user || 'user',
        recent_turns: (context.runningHistory || []).slice(-3).map(m => ({
          speaker: m.bot ? 'soma' : 'user',
          text: m.content || m.text || ''
        }))
      }
    };

    const res = await this._post('/predict/turn_routing', payload);
    if (!res) return null;

    return {
      lane: res.lane || 'fast_social',
      laneConfidence: Number(res.lane_confidence || 0),
      laneProbabilities: res.lane_probabilities || {},
      actVsEscalate: res.act_vs_escalate || 'escalate_system2',
      actConfidence: Number(res.act_confidence || 0),
      actProbabilities: res.act_probabilities || {},
      isSafe: res.is_safe !== false,
      safetyConfidence: Number(res.safety_confidence || 1.0),
      urgencyScore: Number(res.urgency_score || 0.5),
      latencyMs: res.latency_ms || res._clientLatencyMs || 0,
      isSystem1: true
    };
  }

  /**
   * Bidirectional Memory Arbiter:
   * Evaluates and reranks candidate memories using bidirectional cross-attention.
   * Detects and marks contradictions / supersessions.
   */
  async rerankMemories(query, candidates = [], state = {}) {
    if (!candidates?.length) return { results: [], conflictsResolved: 0 };

    const payload = {
      query: String(query || ''),
      candidates: candidates.map((c, idx) => ({
        id: c.id || `cand_${idx}`,
        content: String(c.content || '').slice(0, 300),
        importance: Number(c.importance || 0.5),
        tier: c.tier || 'warm'
      })),
      state
    };

    const res = await this._post('/predict/memory_rerank', payload);
    if (!res?.results) {
      // Fail-open: return original candidates unchanged
      return { results: candidates, conflictsResolved: 0, isSystem1Fallback: true };
    }

    // Merge system1 metadata back into original candidate objects
    const resultMap = new Map(res.results.map(r => [r.id, r]));
    const merged = candidates.map(orig => {
      const s1 = resultMap.get(orig.id);
      if (!s1) return orig;
      return {
        ...orig,
        system1Relevance: s1.system1_relevance,
        system1Confidence: s1.system1_confidence,
        authoritative: s1.authoritative !== false,
        superseded: s1.superseded === true,
        score: s1.system1_relevance !== undefined ? s1.system1_relevance : orig.score
      };
    });

    // Sort authoritative memories first, then by score descending
    merged.sort((a, b) => {
      if (a.authoritative !== b.authoritative) {
        return a.authoritative ? -1 : 1;
      }
      return (b.score || 0) - (a.score || 0);
    });

    return {
      results: merged,
      conflictsResolved: res.conflicts_resolved || 0,
      latencyMs: res.latency_ms || res._clientLatencyMs || 0,
      isSystem1: true
    };
  }

  /**
   * Memory Ingestion Filter:
   * Evaluates new observation before database insertion.
   */
  async evaluateMemoryIngestion(content, metadata = {}) {
    if (!content || typeof content !== 'string') return null;

    const payload = {
      content,
      metadata
    };

    const res = await this._post('/predict/memory_ingest', payload);
    if (!res) {
      // Fail-open default: allow ingestion to warm tier
      return {
        shouldIngest: true,
        isNovel: true,
        isContradiction: false,
        suggestedTier: 'warm',
        importance: metadata.importance || 0.5,
        isSystem1Fallback: true
      };
    }

    return {
      shouldIngest: res.should_ingest !== false,
      isNovel: res.is_novel !== false,
      noveltyConfidence: Number(res.novelty_confidence || 0.5),
      isContradiction: res.is_contradiction === true,
      contradictionConfidence: Number(res.contradiction_confidence || 0.5),
      suggestedTier: res.suggested_tier || 'warm',
      importance: Number(res.importance || 0.5),
      latencyMs: res.latency_ms || res._clientLatencyMs || 0,
      isSystem1: true
    };
  }

  /**
   * Closed-Loop Experience Distillation:
   * Asynchronously push execution receipts to the training dataset.
   */
  recordExperience(receipt = {}) {
    if (!this._isAvailable()) return;
    // Fire and forget
    this._post('/distill/record', receipt).catch(() => {});
  }

  /**
   * Spawn local Python daemon process if not already running.
   */
  startDaemon({ pythonPath = null } = {}) {
    if (this._childProcess) return this._childProcess;

    const venvPython = pythonPath || path.resolve(process.cwd(), '.soma_venv', 'Scripts', 'python.exe');
    const daemonScript = path.resolve(process.cwd(), 'daemons', 'system1_substrate_daemon.py');

    this.logger.info?.(`[${this.name}] Spawning System 1 Substrate daemon: ${venvPython} ${daemonScript}`);
    const child = spawn(venvPython, [daemonScript], {
      cwd: process.cwd(),
      env: { ...process.env, SOMA_SYSTEM1_PORT: String(this.port), SOMA_SYSTEM1_HOST: this.host },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    child.stdout.on('data', (d) => {
      const line = d.toString().trim();
      if (line) this.logger.info?.(`[System1Daemon] ${line}`);
    });

    child.stderr.on('data', (d) => {
      const line = d.toString().trim();
      if (line) this.logger.warn?.(`[System1Daemon] ${line}`);
    });

    child.on('exit', (code) => {
      this.logger.warn?.(`[${this.name}] System 1 daemon exited with code ${code}`);
      this._childProcess = null;
    });

    this._childProcess = child;
    return child;
  }

  stopDaemon() {
    if (this._childProcess) {
      try {
        this._childProcess.kill('SIGTERM');
      } catch {}
      this._childProcess = null;
    }
  }
}

// Export singleton instance for system-wide reuse
export const neocortexSystem1Bridge = new NeocortexSystem1Bridge();
