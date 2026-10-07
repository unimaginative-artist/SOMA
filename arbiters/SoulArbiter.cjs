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
const crypto = require('crypto');
const { isRuntimeFailureText } = require('../core/ModelResultGuard.cjs');

const SAVE_DEBOUNCE_MS = 2000;

class SoulArbiter {
  constructor(opts = {}) {
    this.name    = 'SoulArbiter';
    this.entries = [];
    this.statePath = opts.statePath || path.join(process.cwd(), 'soul.json');
    this.archivePath = opts.archivePath || path.join(process.cwd(), 'SOMA', 'soul-reflections-archive.jsonl');
    this.maxEntries = opts.maxEntries || 200;
    this._saveTimer = null;
    this._loaded = false;
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  initialize() {
    try {
      const dir = path.dirname(this.statePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (fs.existsSync(this.statePath)) {
        const raw = fs.readFileSync(this.statePath, 'utf8');
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
    if (isRuntimeFailureText(feeling)) return;
    if (!this._loaded) this.initialize();

    const entry = { id: crypto.randomUUID(), ts: Date.now(), feeling: feeling.trim(), userId, trigger };
    this.entries.push(entry);

    // Bound hot context, but archive overflow instead of silently discarding it.
    if (this.entries.length > this.maxEntries) {
      const overflow = this.entries.slice(0, this.entries.length - this.maxEntries);
      this._archive(overflow, 'hot_context_overflow');
      this.entries = this.entries.slice(-this.maxEntries);
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

  // Replace a set of archived raw reflections with one usable working digest.
  // The originals are appended to JSONL before removal, so this is recoverable.
  condenseReflections({ entries = [], summary, source = 'MemoryDistillerDaemon', now = Date.now() } = {}) {
    if (!this._loaded) this.initialize();
    if (!summary || typeof summary !== 'string' || isRuntimeFailureText(summary)) return null;

    const ids = new Set(entries.map(e => e?.id).filter(Boolean));
    const keys = new Set(entries.map(e => `${e?.ts || ''}:${e?.feeling || ''}`));
    const selected = this.entries.filter(e => ids.has(e.id) || keys.has(`${e.ts || ''}:${e.feeling || ''}`));
    if (!selected.length) return null;

    this._archive(selected, 'reflection_condensation');
    const selectedSet = new Set(selected);
    this.entries = this.entries.filter(e => !selectedSet.has(e));
    const digest = {
      id: crypto.randomUUID(),
      ts: now,
      feeling: summary.trim(),
      userId: 'system',
      trigger: 'reflection_condensation',
      source,
      consolidated: true,
      sourceCount: selected.length,
      sourceRange: { from: Math.min(...selected.map(e => e.ts || now)), to: Math.max(...selected.map(e => e.ts || now)) }
    };
    this.entries.push(digest);
    this._scheduleSave();
    return digest;
  }

  getCondensationStatus() {
    if (!this._loaded) this.initialize();
    return {
      total: this.entries.length,
      raw: this.entries.filter(e => !e.consolidated).length,
      condensed: this.entries.filter(e => e.consolidated).length,
      archivePath: this.archivePath,
      archiveExists: fs.existsSync(this.archivePath)
    };
  }

  _archive(entries, reason) {
    if (!entries?.length) return;
    const dir = path.dirname(this.archivePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const archivedAt = Date.now();
    const lines = entries.map(entry => JSON.stringify({ archivedAt, reason, entry })).join('\n') + '\n';
    fs.appendFileSync(this.archivePath, lines, 'utf8');
  }

  // ── Persist ───────────────────────────────────────────────────────────────
  _scheduleSave() {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._save(), SAVE_DEBOUNCE_MS);
  }

  _save() {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify({ entries: this.entries }, null, 2), 'utf8');
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
module.exports.SoulArbiter = SoulArbiter;
