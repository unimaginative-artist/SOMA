'use strict';

const fs = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(process.cwd(), 'SOMA', 'autonomous-work-ledger.json');
const MAX_ENTRIES = 300;

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function readLedger() {
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
      if (Array.isArray(parsed.entries)) return parsed;
    }
  } catch {}
  return { version: 1, entries: [] };
}

function writeLedger(data) {
  ensureDir(LEDGER_FILE);
  fs.writeFileSync(LEDGER_FILE, JSON.stringify({
    version: 1,
    entries: (data.entries || []).slice(0, MAX_ENTRIES),
  }, null, 2));
}

function normalizeEntry(entry = {}) {
  const now = Date.now();
  return {
    id: entry.id || `work-${now}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: entry.timestamp || now,
    type: entry.type || 'activity',
    title: String(entry.title || 'Autonomous work').slice(0, 160),
    summary: String(entry.summary || '').slice(0, 900),
    evidence: entry.evidence || null,
    nextStep: entry.nextStep || null,
    status: entry.status || 'observed',
    source: entry.source || 'SOMA',
    confidence: typeof entry.confidence === 'number' ? entry.confidence : null,
    links: Array.isArray(entry.links) ? entry.links.slice(0, 8) : [],
  };
}

function record(entry = {}) {
  const ledger = readLedger();
  const normalized = normalizeEntry(entry);
  ledger.entries.unshift(normalized);
  writeLedger(ledger);
  return normalized;
}

function list(limit = 20, filter = {}) {
  const entries = readLedger().entries || [];
  return entries
    .filter(entry => !filter.type || entry.type === filter.type)
    .slice(0, limit);
}

function listVerified(limit = 20) {
  return list(100)
    .filter(entry => entry.type !== 'proactive_update')
    .filter(entry => ['verified', 'completed'].includes(String(entry.status || '').toLowerCase()))
    .filter(entry => Boolean(entry.evidence))
    .slice(0, limit);
}

function summarize(limit = 8) {
  // This summary is injected under "VERIFIED WORK". Observed progress, model
  // prose, and proactive messages are not completion evidence and must never
  // recursively become grounding for later claims.
  const entries = listVerified(limit);
  if (!entries.length) return '';
  return entries.map(entry => {
    const parts = [
      `- ${entry.type}: ${entry.title}`,
      entry.summary ? `finding=${entry.summary}` : null,
      entry.evidence ? `evidence=${typeof entry.evidence === 'string' ? entry.evidence : JSON.stringify(entry.evidence).slice(0, 220)}` : null,
      entry.nextStep ? `next=${entry.nextStep}` : null,
      `status=${entry.status}`,
      `source=${entry.source}`,
    ].filter(Boolean);
    return parts.join(' | ');
  }).join('\n');
}

module.exports = {
  LEDGER_FILE,
  record,
  list,
  listVerified,
  summarize,
  readLedger,
};
