import crypto from 'crypto';

export const TRAINING_LOBES = Object.freeze(['LOGOS', 'AURORA', 'PROMETHEUS', 'THALAMUS']);

const LOBE_TERMS = Object.freeze({
  LOGOS: /\b(code|debug|test|software|architecture|function|class|api|database|algorithm|latency|dependency|server)\b/i,
  AURORA: /\b(story|creative|voice|emotion|art|image|social|prose|narrative|design|empathy)\b/i,
  PROMETHEUS: /\b(strategy|plan|market|trading|goal|roadmap|priority|forecast|business|outcome|decision)\b/i,
  THALAMUS: /\b(safety|security|risk|threat|verify|audit|fraud|scam|privacy|permission|harm)\b/i
});

const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|pk|api)[-_][a-z0-9]{20,}\b/i,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{12,}/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/
];

const UNSUPPORTED_PATTERNS = [
  /\b(?:guaranteed|risk[- ]free) (?:profit|returns?)\b/i,
  /\b(?:cured|proven cure|guaranteed cure)\b/i,
  /\b(?:I|we) (?:ran|performed|completed) (?:the )?(?:wet[- ]lab|physical lab|clinical) experiment\b/i,
  /\bI created a real engineering goal\b/i,
  /\b(?:patch|commit|deployment) incoming\b/i
];

export function normalizeLobe(value) {
  const lobe = String(value || '').trim().toUpperCase();
  return TRAINING_LOBES.includes(lobe) ? lobe : null;
}

export function inferTrainingLobe(text, metadata = {}) {
  const explicit = normalizeLobe(metadata.lobe || metadata.brain || metadata.activeLobe);
  if (explicit) return explicit;
  const source = String(text || '');
  let best = 'LOGOS';
  let score = 0;
  for (const [lobe, pattern] of Object.entries(LOBE_TERMS)) {
    const matches = source.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`));
    if ((matches?.length || 0) > score) {
      best = lobe;
      score = matches.length;
    }
  }
  return best;
}

export function normalizeTrainingProvenance(metadata = {}, defaults = {}) {
  const source = String(metadata.source || metadata.sourceType || defaults.source || 'unknown');
  const provider = String(metadata.actualProvider || metadata.provider || defaults.provider || 'unknown').toLowerCase();
  const model = String(metadata.actualModel || metadata.model || defaults.model || 'unknown');
  const qualityTier = String(metadata.qualityTier || defaults.qualityTier || 'unverified').toLowerCase();
  const lobe = inferTrainingLobe(`${defaults.instruction || ''}\n${defaults.response || ''}`, metadata);
  return {
    ...metadata,
    source,
    provider,
    model,
    lobe,
    qualityTier,
    evidenceId: metadata.evidenceId || metadata.artifactId || metadata.goalId || null,
    generatedAt: metadata.generatedAt || new Date().toISOString()
  };
}

export function validateTrainingExample(example, options = {}) {
  const instruction = String(example?.instruction || '');
  const response = String(example?.response || '');
  const metadata = normalizeTrainingProvenance(example?.metadata, { instruction, response });
  const combined = `${instruction}\n${response}`;
  const reasons = [];

  if (instruction.trim().length < (options.minInstructionLength ?? 8)) reasons.push('instruction_too_short');
  if (response.trim().length < (options.minResponseLength ?? 24)) reasons.push('response_too_short');
  if (SECRET_PATTERNS.some(pattern => pattern.test(combined))) reasons.push('secret_detected');
  if (UNSUPPORTED_PATTERNS.some(pattern => pattern.test(response))) reasons.push('unsupported_claim_pattern');

  const source = metadata.source.toLowerCase();
  const syntheticTeacher = source.includes('synthetic') || source.includes('teacher');
  if (syntheticTeacher && metadata.provider !== 'deepseek') reasons.push('teacher_provenance_mismatch');

  const memoryLike = source.includes('memory') || source.includes('experience');
  if (memoryLike && !['verified', 'training_approved', 'nemesis_corrected'].includes(metadata.qualityTier)) {
    reasons.push('unverified_memory_or_experience');
  }

  return { accepted: reasons.length === 0, reasons, metadata };
}

export function trainingExampleFingerprint(instruction, response) {
  const normalize = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(`${normalize(instruction)}\n${normalize(response)}`).digest('hex');
}

