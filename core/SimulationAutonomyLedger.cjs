const fs = require('fs');
const path = require('path');

const LEDGER_PATH = path.join(process.cwd(), 'data', 'simulation', 'autonomy-ledger.json');

function readLedger() {
  try {
    if (!fs.existsSync(LEDGER_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLedger(entries) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(entries.slice(0, 1000), null, 2), 'utf8');
}

function gradeEvidence({ fallbackUsed = false, externalFailure = false, metrics = {}, evidence = [] } = {}) {
  if (externalFailure && !fallbackUsed) return 'failed_external_dependency';
  if (!evidence.length && !Object.keys(metrics || {}).length) return 'low_signal';
  if (fallbackUsed) return 'fallback_used';
  if (metrics.score !== undefined && Number(metrics.score) < 0.35) return 'low_signal';
  return 'useful';
}

function appendEvidence(event = {}) {
  const now = new Date().toISOString();
  const quality = event.quality || gradeEvidence(event);
  const entry = {
    id: event.id || `sim-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: event.createdAt || now,
    updatedAt: now,
    module: event.module || 'simulation',
    kind: event.kind || 'autonomous_run',
    status: event.status || 'observed',
    quality,
    primaryBrain: event.primaryBrain || 'PROMETHEUS',
    brainLanes: event.brainLanes || ['PROMETHEUS', 'LOGOS', 'MNEMOSYNE'],
    learningTargets: event.learningTargets || [],
    fallbackUsed: Boolean(event.fallbackUsed),
    externalFailure: Boolean(event.externalFailure),
    summary: event.summary || '',
    evidence: Array.isArray(event.evidence) ? event.evidence.filter(Boolean) : [],
    metrics: event.metrics || {},
    marketSignals: event.marketSignals || null,
    riskSignals: event.riskSignals || null,
    rawRef: event.rawRef || null
  };
  const next = [entry, ...readLedger().filter(item => item.id !== entry.id)];
  writeLedger(next);
  return entry;
}

function strategicFeed(limit = 50) {
  return readLedger()
    .filter(item => ['useful', 'fallback_used'].includes(item.quality))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
}

module.exports = {
  LEDGER_PATH,
  appendEvidence,
  gradeEvidence,
  readLedger,
  strategicFeed
};
