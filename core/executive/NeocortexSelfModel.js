import Database from 'better-sqlite3';
import path from 'path';

export class NeocortexSelfModel {
  constructor(opts = {}) {
    this.system = opts.system || null;
    this.logger = opts.logger || console;
    this._db = null;

    this.forbiddenPatterns = [
      /\bas an ai\b/i,
      /\bas a language model\b/i,
      /\bi do not have persistent memory\b/i,
      /\bi don't have persistent memory\b/i,
      /\bi start fresh each session\b/i,
      /\bi cannot remember past conversations\b/i
    ];

    this.actionRequestPattern = /\b(backtest|simulate|run\s+(?:the\s+)?(?:backtest|simulation)|test\s+(?:the\s+)?strategy|optimize|build|implement|fix|repair|deploy|execute)\b/i;
    this.promissoryPattern = /\b(i will|i'll|i am going to|i'm going to|setting up|running the|starting the|on it|stay tuned)\b/i;
  }

  _getDb() {
    if (!this._db) {
      try {
        const dbPath = path.join(process.cwd(), 'SOMA', 'memory-semantic.sqlite');
        this._db = new Database(dbPath, { readonly: true });
      } catch (e) {
        this.logger.warn?.(`[NeocortexSelfModel] Database open failed: ${e.message}`);
      }
    }
    return this._db;
  }

  getCanonicalFacts() {
    const db = this._getDb();
    if (!db) return [];
    try {
      return db.prepare("SELECT fact_key, statement FROM canonical_memory_facts WHERE status = 'active'").all();
    } catch {
      return [];
    }
  }

  /**
   * Detects if the model verbally promised an engineering/backtesting action
   * without actually dispatching a tool call or queue tag.
   */
  detectActionGap(query = '', draftText = '', context = {}) {
    const isActionAsk = this.actionRequestPattern.test(String(query || ''));
    if (!isActionAsk) return { hasGap: false };

    const isPromising = this.promissoryPattern.test(String(draftText || ''));
    const hasQueueTag = /\[QUEUE_GOAL:\s*[^\]]+\]/i.test(String(draftText || ''));
    const hasToolCall = context.toolExecuted === true || (context.toolCalls && context.toolCalls.length > 0);

    if (isPromising && !hasQueueTag && !hasToolCall) {
      // Determine appropriate goal description
      const goalDesc = /trend\s*following/i.test(query)
        ? 'Run Bitcoin & Ethereum trend-following backtest with multi-timeframe breakout'
        : `Execute requested strategy simulation: ${query.slice(0, 80)}`;

      return {
        hasGap: true,
        actionType: 'unfulfilled_verbal_promise',
        suggestedTag: `[QUEUE_GOAL: ${goalDesc}]`
      };
    }

    return { hasGap: false };
  }

  evaluateDraft(draftText = '', context = {}, query = '') {
    const text = String(draftText || '');
    const flags = [];

    // 1. Robotic Identity Violations
    for (const pattern of this.forbiddenPatterns) {
      if (pattern.test(text)) {
        flags.push(`identity_violation:${pattern.source}`);
      }
    }

    // 2. Memory Capability Check
    if (/\bephemeral\b/i.test(text) && /\bmemory\b/i.test(text)) {
      flags.push('memory_continuity_denial');
    }

    // 3. Canonical Fact Defense
    const canonical = this.getCanonicalFacts();
    for (const fact of canonical) {
      if (fact.fact_key.includes('relationship') && /\b(customer|client|stranger)\b/i.test(text)) {
        flags.push(`canonical_conflict:${fact.fact_key}`);
      }
    }

    // 4. Action Gap Check
    const actionGap = this.detectActionGap(query, text, context);
    if (actionGap.hasGap) {
      flags.push('verbal_action_gap_detected');
    }

    const coherent = flags.length === 0;
    const score = coherent ? 1.0 : Math.max(0, 1.0 - flags.length * 0.25);

    return {
      coherent,
      score,
      flags,
      actionGap,
      guidance: coherent
        ? null
        : `[EXECUTIVE COHERENCE GUIDANCE: Remember your persistent identity and real memory. Avoid assistant disclaimer tropes.]`
    };
  }
}
