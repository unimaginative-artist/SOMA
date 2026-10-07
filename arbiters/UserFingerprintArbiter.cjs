'use strict';
/**
 * UserFingerprintArbiter.cjs — Passive behavioral fingerprinting.
 *
 * Watches every chat message and silently builds a behavioral model of each user:
 *   - When they show up (hour histogram)
 *   - How they write (length, question ratio, vocabulary richness)
 *   - What they care about (topic clusters)
 *   - How that's changed (session diff)
 *
 * On session open, compares the current opener against the stored fingerprint
 * and produces a natural-language context string SOMA can use to greet the user
 * authentically — or notice when something's different.
 *
 * Files: SOMA/user-profiles/fp-{userId}.json
 */

const fs   = require('fs');
const path = require('path');

const FP_DIR          = path.join(process.cwd(), 'SOMA', 'user-profiles');
const SAVE_DEBOUNCE   = 3000;
const SESSION_GAP_MS  = 30 * 60 * 1000; // 30 min gap = new session

// Owner name from config — used in getUserContext() so it never hardcodes "Owner"
const _ownerName = (() => {
    try {
        const p = path.join(process.cwd(), 'config', 'owner.json');
        return JSON.parse(fs.readFileSync(p, 'utf8')).name || 'the user';
    } catch { return 'the user'; }
})();

// Topic keyword clusters
const TOPIC_PATTERNS = [
  { label: 'consciousness',   re: /conscious|aware|sentient|soul|being|exist/i },
  { label: 'architecture',    re: /architect|system|design|arbiter|module|pipeline/i },
  { label: 'memory',          re: /memory|remember|recall|forget|hippocampus/i },
  { label: 'code',            re: /code|bug|function|class|build|error|debug|compile/i },
  { label: 'AI',              re: /\bai\b|model|llm|gemini|ollama|gpt|neural|embed/i },
  { label: 'goals',           re: /goal|plan|objective|achieve|task|progress/i },
  { label: 'emotion',         re: /feel|emotion|mood|sad|happy|stress|calm|anxiety/i },
  { label: 'finance',         re: /trade|stock|market|price|invest|portfolio|finance/i },
  { label: 'identity',        re: /who am i|identity|persona|character|self/i },
  { label: 'creative',        re: /create|art|music|write|story|imagine|design/i },
];

function extractTopics(text) {
  return TOPIC_PATTERNS.filter(t => t.re.test(text)).map(t => t.label);
}

function vocabularyRichness(words) {
  if (!words.length) return 0;
  const unique = new Set(words.map(w => w.toLowerCase()));
  return Math.min(1, unique.size / words.length);
}

function avgWordLength(words) {
  if (!words.length) return 0;
  return words.reduce((s, w) => s + w.length, 0) / words.length;
}

class UserFingerprintArbiter {
  constructor() {
    this.name       = 'UserFingerprintArbiter';
    this.prints     = new Map();   // userId → fingerprint object
    this.sessions   = new Map();   // userId → { startTs, messageCount, topics[] }
    this._timers    = new Map();
    this._loaded    = false;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  initialize() {
    try {
      if (!fs.existsSync(FP_DIR)) fs.mkdirSync(FP_DIR, { recursive: true });

      const files = fs.readdirSync(FP_DIR).filter(f => f.startsWith('fp-') && f.endsWith('.json'));
      for (const file of files) {
        try {
          const userId = file.slice(3, -5);
          const data   = JSON.parse(fs.readFileSync(path.join(FP_DIR, file), 'utf8'));
          this.prints.set(userId, data);
        } catch {}
      }
      console.log(`[UserFingerprintArbiter] 👁 Loaded ${this.prints.size} fingerprints`);
    } catch (e) {
      console.warn(`[UserFingerprintArbiter] Init error: ${e.message}`);
    }
    this._loaded = true;
  }

  // ── Observe one message ───────────────────────────────────────────────────
  observe(userId = 'default_user', message = '', meta = {}) {
    if (!this._loaded) this.initialize();

    const now   = Date.now();
    const words = message.trim().split(/\s+/).filter(Boolean);
    const hour  = new Date(now).getHours();
    const isQ   = message.trim().endsWith('?');
    const topics = extractTopics(message);

    // ── Get or create fingerprint ──
    let fp = this.prints.get(userId);
    if (!fp) {
      fp = this._createPrint(userId);
      this.prints.set(userId, fp);
    }

    // ── Session tracking ──
    let sess = this.sessions.get(userId);
    if (!sess || (now - sess.lastTs) > SESSION_GAP_MS) {
      sess = { startTs: now, lastTs: now, messageCount: 0, topics: [] };
      fp.sessions  = (fp.sessions || 0) + 1;
      fp.lastSeen  = now;
    }
    sess.lastTs = now;
    sess.messageCount++;
    sess.topics.push(...topics);
    this.sessions.set(userId, sess);

    // ── Update rolling stats ──
    const n = fp.totalMessages;
    fp.avgMsgLength     = Math.round((fp.avgMsgLength * n + words.length) / (n + 1));
    fp.questionRatio    = parseFloat(((fp.questionRatio * n + (isQ ? 1 : 0)) / (n + 1)).toFixed(3));
    fp.vocabRichness    = parseFloat(((fp.vocabRichness * n + vocabularyRichness(words)) / (n + 1)).toFixed(3));
    fp.avgWordLength    = parseFloat(((fp.avgWordLength * n + avgWordLength(words)) / (n + 1)).toFixed(2));
    fp.totalMessages    = n + 1;

    // Hour histogram
    fp.hourHistogram[hour] = (fp.hourHistogram[hour] || 0) + 1;

    // Topic frequency map
    for (const t of topics) {
      fp.topicFreq[t] = (fp.topicFreq[t] || 0) + 1;
    }

    // Recent topics (last 20 unique)
    fp.recentTopics = [...new Set([...topics, ...fp.recentTopics])].slice(0, 20);

    // Dominant style
    fp.typicalStyle = this._inferStyle(fp);

    fp.lastUpdated = now;
    this._scheduleSave(userId);
  }

  // ── Session diff ─────────────────────────────────────────────────────────
  // Returns a natural-language string about what's the same / different right now.
  getSessionDiff(userId = 'default_user') {
    if (!this._loaded) this.initialize();
    const fp   = this.prints.get(userId);
    const sess = this.sessions.get(userId);
    if (!fp || fp.totalMessages < 5) return null; // not enough history yet

    const notes = [];
    const now   = Date.now();
    const hour  = new Date(now).getHours();

    // Time of day
    const peakHour = this._peakHour(fp.hourHistogram);
    const hourDiff = Math.abs(hour - peakHour);
    if (hourDiff >= 6) {
      const tod = hour < 6 ? 'very early' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
      const typical = peakHour < 6 ? 'late night' : peakHour < 12 ? 'morning' : peakHour < 18 ? 'afternoon' : 'evening';
      notes.push(`showing up ${tod} (usually comes around ${typical})`);
    }

    // Time since last seen
    const gapMs = now - (fp.lastSeen || now);
    const gapH  = gapMs / 3600000;
    if (gapH > 48) {
      const days = Math.round(gapH / 24);
      notes.push(`been away ${days} day${days !== 1 ? 's' : ''}`);
    } else if (gapH > 8) {
      notes.push(`been away ${Math.round(gapH)} hours`);
    }

    // Session topic vs typical
    const sessTopics   = [...new Set(sess?.topics || [])];
    const topTopics    = this._topTopics(fp.topicFreq, 5);
    const newTopics    = sessTopics.filter(t => !topTopics.includes(t));
    const usualTopics  = sessTopics.filter(t => topTopics.includes(t));

    if (newTopics.length) notes.push(`asking about ${newTopics.join(', ')} — uncommon territory`);
    if (usualTopics.length) notes.push(`back to ${usualTopics.join(', ')} as usual`);

    return notes.length ? notes.join('; ') : null;
  }

  // ── Context string for prompt injection ──────────────────────────────────
  getUserContext(userId = 'default_user') {
    if (!this._loaded) this.initialize();
    const fp = this.prints.get(userId);
    if (!fp || fp.totalMessages < 3) return '';

    const topTopics = this._topTopics(fp.topicFreq, 4);
    const peakHour  = this._peakHour(fp.hourHistogram);
    const peakLabel = peakHour < 6 ? 'late at night' : peakHour < 12 ? 'in the morning' : peakHour < 18 ? 'in the afternoon' : 'in the evening';

    const lines = [
      topTopics.length ? `${_ownerName} tends to talk about: ${topTopics.join(', ')}.` : '',
      `Their communication style is ${fp.typicalStyle}.`,
    ].filter(Boolean);

    return lines.join(' ');
  }

  // ── Possible different user detection ────────────────────────────────────
  // Returns a confidence 0–1 that this is the same user as the profile.
  // Simple heuristic — can be made smarter later.
  getSameUserConfidence(userId, currentMessages = []) {
    const fp = this.prints.get(userId);
    if (!fp || fp.totalMessages < 10 || !currentMessages.length) return 1;

    const combined = currentMessages.join(' ');
    const words    = combined.split(/\s+/).filter(Boolean);
    const curLen   = words.length / currentMessages.length;
    const curIsQ   = currentMessages.filter(m => m.trim().endsWith('?')).length / currentMessages.length;

    const lenDiff  = Math.abs(curLen  - fp.avgMsgLength)  / Math.max(fp.avgMsgLength, 1);
    const qDiff    = Math.abs(curIsQ  - fp.questionRatio);

    // If both deviate significantly, flag it
    const score = 1 - (lenDiff * 0.5 + qDiff * 0.5);
    return Math.max(0, Math.min(1, score));
  }

  // ── Internal helpers ──────────────────────────────────────────────────────
  _createPrint(userId) {
    return {
      userId,
      sessions:       0,
      totalMessages:  0,
      avgMsgLength:   0,
      questionRatio:  0,
      vocabRichness:  0,
      avgWordLength:  0,
      typicalStyle:   'unknown',
      hourHistogram:  {},
      topicFreq:      {},
      recentTopics:   [],
      lastSeen:       Date.now(),
      lastUpdated:    Date.now(),
      createdAt:      Date.now(),
    };
  }

  _inferStyle(fp) {
    const qr = fp.questionRatio;
    const ml = fp.avgMsgLength;
    const vr = fp.vocabRichness;
    if (qr > 0.6 && ml > 15) return 'inquisitive-verbose';
    if (qr > 0.6 && ml <= 15) return 'inquisitive-terse';
    if (qr <= 0.3 && vr > 0.6) return 'declarative-articulate';
    if (qr <= 0.3 && ml > 20)  return 'directive-detailed';
    if (ml < 8)                 return 'terse';
    return 'conversational';
  }

  _peakHour(hist) {
    let best = 22, bestCount = 0;
    for (const [h, c] of Object.entries(hist)) {
      if (c > bestCount) { bestCount = c; best = parseInt(h); }
    }
    return best;
  }

  _topTopics(freq, n) {
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([t]) => t);
  }

  _scheduleSave(userId) {
    if (this._timers.has(userId)) clearTimeout(this._timers.get(userId));
    this._timers.set(userId, setTimeout(() => this._save(userId), SAVE_DEBOUNCE));
  }

  _save(userId) {
    const fp = this.prints.get(userId);
    if (!fp) return;
    try {
      const p = path.join(FP_DIR, `fp-${userId}.json`);
      fs.writeFileSync(p, JSON.stringify(fp, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[UserFingerprintArbiter] Save failed for ${userId}: ${e.message}`);
    }
  }
}

// Singleton
const fingerprint = new UserFingerprintArbiter();
module.exports = fingerprint;
