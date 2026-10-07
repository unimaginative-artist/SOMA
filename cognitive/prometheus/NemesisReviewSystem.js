/**
 * NemesisReviewSystem.js - Hybrid Adversarial Review
 * 
 * Two-stage evaluation:
 * 1. FAST: Numeric evaluation (PrometheusNemesis) - 0ms
 * 2. DEEP: Linguistic review (Gemini) - only when uncertain
 * 
 * Flow:
 * Response → Numeric Eval → Score > 0.7? → Pass
 *                        → Score < 0.3? → Force Revision
 *                        → 0.3-0.7? → Deep Linguistic Review
 */

import { createRequire } from 'module';
import path from 'path';
const require = createRequire(import.meta.url);
const { PrometheusNemesis } = require('./PrometheusNemesis.cjs');

export class NemesisReviewSystem {
  constructor(config = {}) {
    this.name = 'NemesisReviewSystem';
    
    // Stage 1: Numeric evaluator (existing PrometheusNemesis)
    this.numericNemesis = new PrometheusNemesis({
      minFriction: config.minFriction || 0.25,
      maxChargeWithoutFriction: config.maxChargeWithoutFriction || 0.75,
      minValueDensity: config.minValueDensity || 0.15,
      promotionScore: config.promotionScore || 0.85
    });
    
    // Thresholds for triggering deep review
    this.uncertaintyThreshold = {
      low: 0.3,   // Below this: immediate revision
      high: 0.7   // Above this: pass without review
    };
    
    // Stats
    this.stats = {
      totalEvaluations: 0,
      numericPass: 0,
      numericFail: 0,
      deepReviewTriggered: 0,
      revisionsForced: 0
    };

    // CNS pub/sub — broadcast evaluation outcomes for downstream adaptation
    this.messageBroker = config.messageBroker || null;

    // SQLite persistence — scores survive restarts, enable long-term trend analysis
    this.db = null;
    this._initDb();

    console.log(`[${this.name}] 🔴 Hybrid NEMESIS system initialized`);
    console.log(`[${this.name}]    Stage 1: Numeric evaluation (fast)`);
    console.log(`[${this.name}]    Stage 2: Linguistic review (uncertain cases only)`);
  }
  
  /**
   * Main entry point: Evaluate a brain response
   */
  async evaluateResponse(brainName, query, response, geminiCallback) {
    this.stats.totalEvaluations++;
    
    const startTime = Date.now();
    
    // ========================================
    // STAGE 1: NUMERIC EVALUATION
    // ========================================
    const triography = this._calculateTriography(response, brainName);
    
    const numericEval = this.numericNemesis.evaluateEmergent({
      triography,
      signature: this._generateSignature(query, response),
      sourceIds: [brainName]
    });
    
    const score = numericEval.aggregateScore;
    
    console.log(`[${this.name}] 📊 Numeric evaluation: ${score.toFixed(2)} (${numericEval.fate})`);
    
    // Fast path: High confidence response
    if (score >= this.uncertaintyThreshold.high) {
      this.stats.numericPass++;
      const result = {
        needsRevision: false,
        stage: 'numeric',
        score,
        fate: numericEval.fate,
        elapsedMs: Date.now() - startTime,
        breakdown: numericEval.breakdown
      };
      this.persistScore(brainName, query, result);
      this.messageBroker?.publish('nemesis:evaluation_complete', { brainName, score, needsRevision: false, fate: numericEval.fate }).catch(() => {});
      return result;
    }

    // Fast path: Obviously bad response
    if (score < this.uncertaintyThreshold.low) {
      this.stats.numericFail++;
      this.stats.revisionsForced++;
      const result = {
        needsRevision: true,
        stage: 'numeric',
        score,
        fate: numericEval.fate,
        reason: 'Failed numeric evaluation',
        elapsedMs: Date.now() - startTime,
        breakdown: numericEval.breakdown
      };
      this.persistScore(brainName, query, result);
      this.messageBroker?.publish('nemesis:evaluation_complete', { brainName, score, needsRevision: true, fate: numericEval.fate }).catch(() => {});
      return result;
    }

    // ========================================
    // STAGE 2: DEEP LINGUISTIC REVIEW
    // ========================================
    console.log(`[${this.name}] 🔍 Uncertainty detected (${score.toFixed(2)}) - invoking deep review...`);

    this.stats.deepReviewTriggered++;

    const linguisticReview = await this._deepLinguisticReview(
      brainName,
      query,
      response,
      numericEval,
      geminiCallback
    );

    const result = {
      needsRevision: linguisticReview.issuesFound > 0,
      stage: 'both',
      score,
      numeric: {
        score,
        fate: numericEval.fate,
        breakdown: numericEval.breakdown
      },
      linguistic: linguisticReview,
      elapsedMs: Date.now() - startTime
    };
    this.persistScore(brainName, query, result);
    this.messageBroker?.publish('nemesis:evaluation_complete', { brainName, score, needsRevision: result.needsRevision, fate: numericEval.fate }).catch(() => {});
    return result;
  }

  /**
   * Calculate triography metrics for a response
   */
  _calculateTriography(response, brainName) {
    const text = response.text || '';
    
    // CHARGE: Novelty/creativity (based on text features)
    const charge = this._calculateCharge(text, brainName);
    
    // FRICTION: Grounding/constraints (based on concrete details)
    const friction = this._calculateFriction(text);
    
    // MASS: Information density (useful content per token)
    const mass = this._calculateMass(text, response.confidence);
    
    return { charge, friction, mass };
  }
  
  _calculateCharge(text, brainName) {
    // Higher charge for creative brains, lower for analytical
    const baseCharge = brainName === 'AURORA' ? 0.7 : 0.3;
    
    // Adjust based on text features
    const hasMetaphors = /like|as if|metaphor|imagine/.test(text.toLowerCase());
    const hasQuestions = (text.match(/\?/g) || []).length;
    const hasExclamations = (text.match(/!/g) || []).length;
    
    let charge = baseCharge;
    if (hasMetaphors) charge += 0.1;
    if (hasQuestions > 2) charge += 0.1;
    if (hasExclamations > 1) charge += 0.05;
    
    return Math.min(1.0, charge);
  }
  
  _calculateFriction(text) {
    // Friction = grounding in reality (numbers, constraints, specifics)
    const hasNumbers = /\d+/.test(text);
    const hasConstraints = /must|should|cannot|limited|constraint|requirement/.test(text.toLowerCase());
    const hasSpecifics = /specifically|exactly|precisely|particular/.test(text.toLowerCase());
    const hasEvidence = /because|since|due to|based on/.test(text.toLowerCase());
    const hasCaveats = /however|but|although|unless|except/.test(text.toLowerCase());
    
    let friction = 0.2; // Base friction
    if (hasNumbers) friction += 0.15;
    if (hasConstraints) friction += 0.2;
    if (hasSpecifics) friction += 0.15;
    if (hasEvidence) friction += 0.15;
    if (hasCaveats) friction += 0.15;
    
    return Math.min(1.0, friction);
  }
  
  _calculateMass(text, confidence) {
    // Mass = information density
    const words = text.split(/\s+/).length;
    const sentences = (text.match(/[.!?]+/g) || []).length || 1;
    
    // Penalize very short or very long responses
    let mass = confidence || 0.5;
    
    if (words < 20) mass *= 0.5; // Too short, low information
    if (words > 500) mass *= 0.8; // Too long, diluted information
    
    // Reward structured responses
    const hasLists = /^[-*\d+.]\s/m.test(text);
    const hasCode = /```/.test(text);
    if (hasLists) mass += 0.1;
    if (hasCode) mass += 0.1;
    
    return Math.min(1.0, mass);
  }
  
  _generateSignature(query, response) {
    // Simple hash for detecting repeated failures
    // Handle query being either string or object
    const queryStr = typeof query === 'string' ? query : (query?.text || JSON.stringify(query) || '');
    const responseStr = response.text || '';
    
    const combined = `${queryStr.substring(0, 100)}:${responseStr.substring(0, 100)}`;
    return combined.replace(/\s+/g, '_').substring(0, 50);
  }
  
  /**
   * Stage 2: Deep linguistic review using Gemini
   */
  async _deepLinguisticReview(brainName, query, response, numericEval, geminiCallback) {
    // Handle query being either string or object
    const queryStr = typeof query === 'string' ? query : (query?.text || JSON.stringify(query) || '');
    
    const nemesisPrompt = `You are NEMESIS - the adversarial review system within SOMA.

Your purpose: Find flaws, weaknesses, and blind spots in responses.

NUMERIC EVALUATION (Stage 1):
- Score: ${numericEval.aggregateScore.toFixed(2)}
- Fate: ${numericEval.fate}
- Reality Test: ${numericEval.breakdown.reality}
- Loop Test: ${numericEval.breakdown.loop}
- Domain Leak: ${numericEval.breakdown.domain}
- Value Density: ${numericEval.breakdown.value}
- Curiosity Integrity: ${numericEval.breakdown.curiosity}

The numeric evaluation is UNCERTAIN. Perform deep linguistic analysis.

BRAIN BEING REVIEWED: ${brainName}

ORIGINAL QUERY:
"${queryStr}"

RESPONSE TO REVIEW:
"${response.text}"

TASK: Find logical flaws, hidden assumptions, edge cases, overconfidence, or blind spots.

Respond with JSON:
{
  "issuesFound": <number>,
  "severity": "low|medium|high|critical",
  "critiques": [
    {
      "issue": "Brief description",
      "location": "Where in response",
      "impact": "Why this matters",
      "suggestion": "How to fix"
    }
  ],
  "summary": "One-sentence summary",
  "shouldRevise": true/false
}`;

    try {
      const result = await geminiCallback(nemesisPrompt);
      
      // Parse JSON response
      const parsed = this._parseJSON(result.text);
      
      return {
        issuesFound: parsed.issuesFound || 0,
        severity: parsed.severity || 'low',
        critiques: parsed.critiques || [],
        summary: parsed.summary || 'No issues found',
        shouldRevise: parsed.shouldRevise || false,
        raw: parsed
      };
      
    } catch (err) {
      console.error(`[${this.name}] Deep review failed:`, err.message);
      
      // Fallback: If linguistic review fails, trust numeric evaluation
      return {
        issuesFound: 0,
        severity: 'low',
        critiques: [],
        summary: 'Linguistic review failed - trusting numeric evaluation',
        shouldRevise: false
      };
    }
  }
  
  _parseJSON(text) {
    try {
      // Remove markdown code blocks if present
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch (err) {
      console.warn(`[${this.name}] JSON parse failed, attempting repair...`);
      
      // Try to extract JSON from text
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e) {
          return {};
        }
      }
      
      return {};
    }
  }
  
  // ════════════════════════════════════════════════════════
  // PERSISTENCE — SQLite score history
  // ════════════════════════════════════════════════════════

  _initDb() {
    try {
      const Database = require('better-sqlite3');
      const dbPath = path.join(process.cwd(), 'data', 'nemesis-scores.db');
      this.db = new Database(dbPath);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS evaluations (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp     INTEGER NOT NULL,
          brain         TEXT,
          query_preview TEXT,
          score         REAL,
          fate          TEXT,
          stage         TEXT,
          needs_revision INTEGER,
          breakdown_json TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_eval_ts    ON evaluations(timestamp);
        CREATE INDEX IF NOT EXISTS idx_eval_brain ON evaluations(brain);

        CREATE TABLE IF NOT EXISTS revision_pairs (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp     INTEGER NOT NULL,
          query         TEXT,
          bad_response  TEXT,
          critique      TEXT,
          good_response TEXT,
          score_before  REAL
        );
      `);
      this._persistStmt = this.db.prepare(
        `INSERT INTO evaluations (timestamp, brain, query_preview, score, fate, stage, needs_revision, breakdown_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      this._revisionStmt = this.db.prepare(
        `INSERT INTO revision_pairs (timestamp, query, bad_response, critique, good_response, score_before)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      console.log(`[${this.name}] 💾 Score persistence online → data/nemesis-scores.db`);
    } catch (e) {
      console.warn(`[${this.name}] ⚠️ SQLite unavailable — scores in-memory only: ${e.message}`);
      this.db = null;
    }
  }

  /** Called after every evaluation — fire and forget. */
  persistScore(brainName, query, result) {
    if (!this._persistStmt) return;
    try {
      const queryStr = typeof query === 'string' ? query : (query?.text || '');
      this._persistStmt.run(
        Date.now(),
        brainName || 'unknown',
        queryStr.substring(0, 300),
        result.score ?? -1,
        result.fate || result.numeric?.fate || 'unknown',
        result.stage || 'numeric',
        result.needsRevision ? 1 : 0,
        JSON.stringify(result.breakdown || result.numeric?.breakdown || {})
      );
    } catch { /* non-fatal */ }
  }

  /**
   * Store a revision pair when NEMESIS forces a rewrite.
   * This becomes premium training data — we know exactly what went wrong.
   */
  persistRevisionPair(query, badResponse, critique, goodResponse, scoreBefore) {
    if (!this._revisionStmt) return;
    try {
      this._revisionStmt.run(
        Date.now(),
        String(query).substring(0, 600),
        String(badResponse).substring(0, 1200),
        String(critique).substring(0, 600),
        String(goodResponse).substring(0, 1200),
        scoreBefore ?? 0
      );
    } catch { /* non-fatal */ }
  }

  /**
   * Returns brains/domains ranked by average score (worst first).
   * Used by SelfEvolvingGoalEngine to target self-improvement goals.
   */
  getWeakAreas(sinceDays = 7) {
    if (!this.db) return [];
    try {
      const since = Date.now() - sinceDays * 86_400_000;
      return this.db.prepare(`
        SELECT brain,
               ROUND(AVG(score), 3)        AS avg_score,
               COUNT(*)                    AS eval_count,
               SUM(needs_revision)         AS revisions,
               ROUND(MIN(score), 3)        AS min_score,
               ROUND(MAX(score), 3)        AS max_score
        FROM evaluations
        WHERE timestamp > ?
        GROUP BY brain
        HAVING eval_count >= 3
        ORDER BY avg_score ASC
      `).all(since);
    } catch { return []; }
  }

  /** Recent scores with timestamps — useful for trend charts. */
  getScoreHistory(limit = 100) {
    if (!this.db) return [];
    try {
      return this.db.prepare(`
        SELECT timestamp, brain, score, fate, needs_revision
        FROM evaluations
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit);
    } catch { return []; }
  }

  /** Revision pairs — premium training data (bad → good with explanation). */
  getRevisionPairs(limit = 50) {
    if (!this.db) return [];
    try {
      return this.db.prepare(`
        SELECT query, bad_response, critique, good_response, score_before
        FROM revision_pairs
        ORDER BY timestamp DESC
        LIMIT ?
      `).all(limit);
    } catch { return []; }
  }

  /**
   * Get statistics
   */
  getStats() {
    const total = this.stats.totalEvaluations;
    
    return {
      ...this.stats,
      numericPassRate: total > 0 ? (this.stats.numericPass / total * 100).toFixed(1) + '%' : '0%',
      deepReviewRate: total > 0 ? (this.stats.deepReviewTriggered / total * 100).toFixed(1) + '%' : '0%',
      revisionRate: total > 0 ? (this.stats.revisionsForced / total * 100).toFixed(1) + '%' : '0%'
    };
  }
}
