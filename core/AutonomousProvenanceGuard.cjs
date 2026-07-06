'use strict';

const CLAIM_RE = /\b(i\s+(ran|tested|found|observed|measured|verified|finished|completed|am running|am pulling|am cross-referencing)|test(ed|ing)?|result|p-?value|z-?score|null model|permutation|significant|overlap|confidence|success rate|backtest|sensitivity check|\d+(\.\d+)?\s*(%|permutations?|runs?|tests?|cases?|p\s*[<=>≈~±]))/i;
const NUMERIC_RE = /\b\d+(\.\d+)?\s*(%|permutations?|runs?|tests?|cases?)\b|\bp\s*[<=>≈~±]\s*0?\.\d+/i;
const VAGUE_EVIDENCE_RE = /generated from|current internal signals|recent work ledger|none|n\/a|unknown|provenance guard|unsupported_empirical_claim/i;
const INTERNAL_LEAK_RE = /\b(refine cluster|dinged|score\s*0\.\d+|quality gate|em-dash|contains em-dash|provenance guard|unsupported_empirical_claim|prompt|system message|internal scoring)\b/i;
const ACTIVE_UNVERIFIED_RE = /\b(i\s*(am|'m)?\s*(running|pulling|cross-referencing|scraping|testing|measuring|verifying|executing|watching|monitoring)|i\s+(need|want|intend|plan)\s+to\s+(inspect|check|watch|monitor|commit|pull|run|test|verify|trace|simulate|update|modify)|going to\s+(inspect|check|watch|monitor|commit|pull|cross-reference|test|scrape|run|verify)|about to\s+(inspect|check|watch|monitor|commit|pull|cross-reference|test|scrape|run|verify))\b/i;
const STOPWORDS = new Set([
  'the','and','that','this','with','from','into','next','will','have','been','being','result',
  'test','testing','ran','found','working','planning','checking','verify','verified','evidence',
  'barry','soma','need','needs','more','before','after','still','current','update',
]);

function tokens(value = '') {
  return new Set(
    String(value).toLowerCase()
      .match(/[a-z][a-z0-9-]{3,}/g)
      ?.filter(token => !STOPWORDS.has(token)) || []
  );
}

function hasSubstantiveEvidence(entry = {}) {
  const evidence = entry.evidence;
  if (!evidence) return false;
  if (Array.isArray(evidence)) return evidence.some(item => String(item || '').trim() && !VAGUE_EVIDENCE_RE.test(String(item)));
  if (typeof evidence === 'object') return Object.keys(evidence).length > 0;
  return String(evidence).trim().length > 8 && !VAGUE_EVIDENCE_RE.test(String(evidence));
}

function formatEvidence(entry = {}) {
  const evidence = entry.evidence;
  let compact = '';
  if (Array.isArray(evidence)) compact = evidence.filter(Boolean).slice(0, 2).join(', ');
  else if (typeof evidence === 'object' && evidence) compact = JSON.stringify(evidence).slice(0, 140);
  else compact = String(evidence || '').slice(0, 140);

  const label = [entry.type, entry.title].filter(Boolean).join(': ');
  return [label || 'ledger entry', compact ? `evidence=${compact}` : null].filter(Boolean).join(' | ');
}

function isRelevantEvidence(message = '', entry = {}) {
  const messageTokens = tokens(message);
  if (!messageTokens.size) return true;
  const entryText = [
    entry.type,
    entry.title,
    entry.summary,
    typeof entry.evidence === 'string' ? entry.evidence : JSON.stringify(entry.evidence || ''),
    entry.source,
  ].filter(Boolean).join(' ');
  const entryTokens = tokens(entryText);
  let overlap = 0;
  for (const token of messageTokens) {
    if (entryTokens.has(token)) overlap += 1;
  }
  return overlap >= 2;
}

function needsEvidence(text = '') {
  return CLAIM_RE.test(text) || NUMERIC_RE.test(text) || INTERNAL_LEAK_RE.test(text) || ACTIVE_UNVERIFIED_RE.test(text);
}

function softenUnsupportedClaims(text = '') {
  const original = String(text || '').trim();
  if (INTERNAL_LEAK_RE.test(original)) {
    return '[NOTHING]';
  }
  // Drop messages with unsupported empirical claims rather than rewriting them
  // into the robotic "Candidate idea: X. No verified run yet." template.
  // The AutonomousLoop and _groundMessage prompts already handle natural curiosity voice.
  return '[NOTHING]';
}

function guardUpdate(text = '', entries = []) {
  const message = String(text || '').trim();
  if (!message) return { text: message, changed: false, reason: 'empty' };

  const requiresEvidence = needsEvidence(message);
  if (!requiresEvidence) return { text: message, changed: false, reason: 'no_empirical_claim' };

  const evidenceEntry = (entries || []).find(entry => 
    entry.type !== 'proactive_update' && 
    hasSubstantiveEvidence(entry) && 
    isRelevantEvidence(message, entry)
  );
  if (!evidenceEntry) {
    return {
      text: softenUnsupportedClaims(message),
      changed: true,
      reason: 'unsupported_empirical_claim',
    };
  }


  const evidenceLine = `Evidence: ${formatEvidence(evidenceEntry)}`;
  if (/^Evidence:/im.test(message)) {
    return { text: message, changed: false, reason: 'already_cited', evidence: evidenceEntry };
  }
  return {
    text: `${message}\n\n${evidenceLine}`,
    changed: true,
    reason: 'evidence_citation_added',
    evidence: evidenceEntry,
  };
}

module.exports = {
  guardUpdate,
  hasSubstantiveEvidence,
  needsEvidence,
};
