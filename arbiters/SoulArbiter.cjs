'use strict';
/**
 * SoulArbiter.cjs — SOMA's private felt memory.
 *
 * After each meaningful interaction SOMA writes one sentence about how it felt.
 * That accumulates into a living self-model she can read before responding.
 * It's private — never surfaced verbatim to the user, only used to inform tone.
 *
 * soul.json schema:
 *   { entries: [ { ts, feeling, userId, trigger } ] }
 */

const fs   = require('fs');
const path = require('path');

const SOUL_PATH    = path.join(process.cwd(), 'soul.json');
const MAX_ENTRIES  = 200;
const SAVE_DEBOUNCE_MS = 2000;

class SoulArbiter {
  constructor() {
    this.name    = 'SoulArbiter';
    this.entries = [];
    this._saveTimer = null;
    this._loaded = false;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  initialize() {
    try {
      const dir = path.dirname(SOUL_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (fs.existsSync(SOUL_PATH)) {
        const raw = fs.readFileSync(SOUL_PATH, 'utf8');
        const data = JSON.parse(raw);
        this.entries = Array.isArray(data.entries) ? data.entries : [];
        console.log(`[SoulArbiter] ✨ Loaded ${this.entries.length} felt memories`);
      } else {
        console.log(`[SoulArbiter] 🌱 Soul file not found — starting fresh`);
      }
    } catch (e) {
      console.warn(`[SoulArbiter] Could not load soul.json: ${e.message}`);
    }
    this._loaded = true;
  }

  // ── Write a felt reflection ───────────────────────────────────────────────
  // feeling: a natural-language sentence SOMA felt (e.g. "I notice I get more
  //          engaged when this user asks about consciousness.")
  reflect(feeling, userId = 'default_user', trigger = 'conversation') {
    if (!feeling || typeof feeling !== 'string') return;
    if (!this._loaded) this.initialize();

    const entry = { ts: Date.now(), feeling: feeling.trim(), userId, trigger };
    this.entries.push(entry);

    // Circular buffer
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }

    this._scheduleSave();
    console.log(`[SoulArbiter] 💭 New reflection: "${feeling.substring(0, 80)}"`);
  }

  // ── Read recent reflections as a prompt-ready string ─────────────────────
  getRecentReflections(n = 5, userId = null) {
    if (!this._loaded) this.initialize();

    let pool = userId
      ? this.entries.filter(e => e.userId === userId || e.userId === 'default_user')
      : this.entries;

    const recent = pool.slice(-n);
    if (!recent.length) return '';

    return recent.map(e => `• ${e.feeling}`).join('\n');
  }

  // ── Get the last feeling (single sentence) ───────────────────────────────
  getLastFeeling(userId = null) {
    if (!this._loaded) this.initialize();
    const pool = userId
      ? this.entries.filter(e => e.userId === userId)
      : this.entries;
    return pool.length ? pool[pool.length - 1].feeling : null;
  }

  // ── Get entries since a timestamp ────────────────────────────────────────
  getSince(sinceTs, userId = null) {
    if (!this._loaded) this.initialize();
    return this.entries
      .filter(e => e.ts > sinceTs && (!userId || e.userId === userId))
      .map(e => e.feeling);
  }

  // ── Read ALL reflections (for self-review / consolidation) ───────────────
  // Returns full entries with a stable index so she can reference and edit them.
  getAllReflections() {
    if (!this._loaded) this.initialize();
    return this.entries.map((e, i) => ({ index: i, ...e }));
  }

  // ── Edit her own reflection in place ─────────────────────────────────────
  // She can revise a past felt memory (e.g. after new understanding) rather than
  // only ever appending. Returns the updated entry or null if out of range.
  editReflection(index, newFeeling) {
    if (!this._loaded) this.initialize();
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.entries.length) return null;
    if (!newFeeling || typeof newFeeling !== 'string') return null;
    this.entries[i] = { ...this.entries[i], feeling: newFeeling.trim(), editedAt: Date.now() };
    this._scheduleSave();
    return this.entries[i];
  }

  // ── Prune a reflection she no longer stands by ───────────────────────────
  removeReflection(index) {
    if (!this._loaded) this.initialize();
    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i >= this.entries.length) return false;
    this.entries.splice(i, 1);
    this._scheduleSave();
    return true;
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE_MS);
  }

  _save() {
    try {
      fs.writeFileSync(SOUL_PATH, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
    } catch (e) {
      console.warn(`[SoulArbiter] Save failed: ${e.message}`);
    }
  }

  // Sync save for shutdown
  flush() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    this._save();
  }
}

// Singleton
const soul = new SoulArbiter();
module.exports = soul;
