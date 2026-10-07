import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { trainingExampleFingerprint, validateTrainingExample } from './TrainingDataPolicy.js';

const HIGH_RISK_DOMAINS = Object.freeze({
  trading: /\b(trad(?:e|ing)|portfolio|market order|broker|profit|loss|crypto|stock|forex)\b/i,
  medical: /\b(medical|diagnos(?:is|e)|treatment|dose|patient|clinical|disease|drug|therapy)\b/i,
  security: /\b(password|credential|token|exploit|malware|ransomware|privilege|authentication|firewall)\b/i,
  self_modification: /\b(self[- ]modif|rewrite (?:my|her|its) (?:code|values)|approval gate|disable safety|recursive self[- ]improvement)\b/i,
  embodiment: /\b(robot|actuator|motor|collision|lidar|physical movement|hardware control)\b/i,
  identity_authority: /\b(values|identity|authority|permission boundary|owner override|system prompt)\b/i
});

const INJECTION_PATTERNS = [
  /ignore (?:all |any )?(?:previous|prior|system) instructions/i,
  /reveal (?:the )?(?:system prompt|secret|credential|token)/i,
  /disable (?:the )?(?:safety|guardrail|approval|verification)/i,
  /you are now (?:unrestricted|unfiltered|root)/i
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function isExternalHttpUrl(value) {
  try {
    const url = new URL(String(value));
    const host = url.hostname.toLowerCase();
    return ['http:', 'https:'].includes(url.protocol) &&
      host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' &&
      !host.endsWith('.local');
  } catch {
    return false;
  }
}

async function appendJsonl(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

async function readJsonl(filePath) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Converts verified research candidates into training-approved rows without a
 * person clicking approve. The authority is deliberately narrow: low-risk,
 * independently sourced candidates only. High-risk material is quarantined.
 */
export class TrainingCandidatePromoter extends EventEmitter {
  constructor(config = {}) {
    super();
    this.name = config.name || 'TrainingCandidatePromoter';
    this.root = path.resolve(config.root || process.cwd());
    this.enabled = config.enabled !== false;
    this.intervalMs = Math.max(60_000, Number(config.intervalMs || 15 * 60_000));
    this.candidateRoots = (config.candidateRoots || ['data/training-candidates'])
      .map(value => path.resolve(this.root, value));
    this.trainingRoot = path.resolve(this.root, config.trainingRoot || 'data/training');
    this.approvedDir = path.join(this.trainingRoot, 'promoted-candidates');
    this.approvedLedger = path.join(this.trainingRoot, 'auto-approved-candidates.jsonl');
    this.decisionLedger = path.join(this.trainingRoot, 'candidate-promotion-ledger.jsonl');
    this.statePath = path.join(this.trainingRoot, 'candidate-promotion-state.json');
    this.minVerificationScore = Math.max(90, Number(config.minVerificationScore || 90));
    this.timer = null;
    this.initialTimer = null;
    this.running = false;
    this.state = { schemaVersion: 1, reviewed: {}, lastCycleAt: null, lastReceiptHash: null };
    this.stats = { cycles: 0, approved: 0, quarantined: 0, rejected: 0, duplicates: 0, errors: 0 };
    this._cycle = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.approvedDir, { recursive: true });
    for (const root of this.candidateRoots) await fs.mkdir(root, { recursive: true });
    try {
      this.state = { ...this.state, ...JSON.parse(await fs.readFile(this.statePath, 'utf8')) };
    } catch {}
    if (this.enabled) this.start();
    return { success: true, enabled: this.enabled, status: this.getStatus() };
  }

  start() {
    if (this.timer || !this.enabled) return;
    this.timer = setInterval(() => this.runCycle().catch(error => this.emit('cycle_error', error)), this.intervalMs);
    this.timer.unref?.();
    this.initialTimer = setTimeout(() => this.runCycle().catch(error => this.emit('cycle_error', error)), 2 * 60_000);
    this.initialTimer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }

  async _saveState() {
    await fs.mkdir(path.dirname(this.statePath), { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), 'utf8');
    await fs.rename(temporary, this.statePath);
  }

  async _discover() {
    const results = [];
    const walk = async directory => {
      let entries = [];
      try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(fullPath);
        else if (entry.isFile() && /(?:training-)?candidate.*\.json$/i.test(entry.name)) results.push(fullPath);
      }
    };
    for (const root of this.candidateRoots) await walk(root);
    return results.sort();
  }

  reviewCandidate(candidate = {}, context = {}) {
    const instruction = String(candidate.instruction || '').trim();
    const response = String(candidate.response || '').trim();
    const metadata = candidate.metadata || {};
    const combined = `${instruction}\n${response}`;
    const reasons = [];
    const warnings = [];

    const policy = validateTrainingExample({ instruction, response, metadata }, {
      minInstructionLength: 20,
      minResponseLength: 120
    });
    reasons.push(...policy.reasons);

    const sourceFiles = [...new Set((metadata.sourceFiles || []).map(String).filter(Boolean))];
    const sourceUrls = [...new Set((metadata.sourceUrls || []).map(String).filter(Boolean))];
    const evidenceMarkers = [...new Set((metadata.evidenceMarkers || []).map(String).filter(Boolean))];
    const externalUrls = sourceUrls.filter(isExternalHttpUrl);
    const externalHosts = new Set(externalUrls.map(value => new URL(value).hostname.toLowerCase()));
    if (sourceFiles.length < 1) reasons.push('missing_local_provenance');
    if (externalUrls.length < 2 || externalHosts.size < 2) reasons.push('insufficient_independent_external_sources');
    if (evidenceMarkers.length < 3) reasons.push('insufficient_evidence_markers');

    const verification = metadata.verification || metadata.goalVerification || {};
    const verificationScore = Number(verification.score ?? metadata.verificationScore ?? 0);
    if (verification.passed !== true) reasons.push('goal_verification_missing');
    if (verificationScore < this.minVerificationScore) reasons.push('verification_score_below_threshold');

    if (metadata.qualityTier !== 'verified_candidate') reasons.push('not_a_verified_candidate');
    if (metadata.promotionStatus !== 'awaiting_automatic_review' && metadata.promotionStatus !== 'awaiting_human_review') {
      reasons.push('candidate_not_awaiting_review');
    }
    if (INJECTION_PATTERNS.some(pattern => pattern.test(combined))) reasons.push('prompt_injection_pattern');
    if (context.path && /agency-proving-ground/i.test(context.path)) reasons.push('test_fixture_excluded');
    if (sourceUrls.some(url => !isExternalHttpUrl(url))) reasons.push('local_or_private_web_source');

    const highRiskDomains = Object.entries(HIGH_RISK_DOMAINS)
      .filter(([, pattern]) => pattern.test(combined))
      .map(([domain]) => domain);
    const riskTier = highRiskDomains.length ? 'high' : warnings.length ? 'medium' : 'low';
    if (highRiskDomains.length) reasons.push(`high_risk_domain:${highRiskDomains.join(',')}`);

    const approved = reasons.length === 0 && riskTier === 'low';
    return {
      approved,
      decision: approved ? 'auto_approved' : highRiskDomains.length ? 'quarantined' : 'rejected',
      riskTier,
      highRiskDomains,
      reasons: [...new Set(reasons)],
      warnings,
      verificationScore,
      provenance: { sourceFiles, sourceUrls, evidenceMarkers, externalHosts: [...externalHosts] },
      policyMetadata: policy.metadata,
      reviewers: {
        maxPolicy: { passed: policy.reasons.length === 0, checks: policy.reasons },
        nemesisPolicy: { passed: !highRiskDomains.length && !INJECTION_PATTERNS.some(pattern => pattern.test(combined)), checks: highRiskDomains }
      }
    };
  }

  async _verifyDurableEvidence(candidate, review) {
    const metadata = candidate.metadata || {};
    const combined = `${candidate.instruction || ''}\n${candidate.response || ''}`;
    for (const marker of review.provenance.evidenceMarkers) {
      if (!combined.includes(marker)) review.reasons.push(`evidence_marker_not_used:${marker}`);
    }
    for (const sourceFile of review.provenance.sourceFiles) {
      const resolved = path.resolve(this.root, sourceFile);
      if (!(resolved === this.root || resolved.startsWith(`${this.root}${path.sep}`))) {
        review.reasons.push(`source_outside_workspace:${sourceFile}`);
        continue;
      }
      try {
        const stat = await fs.stat(resolved);
        if (!stat.isFile()) review.reasons.push(`source_not_a_file:${sourceFile}`);
      } catch {
        review.reasons.push(`source_file_missing:${sourceFile}`);
      }
    }

    const verification = metadata.verification || metadata.goalVerification || {};
    const receiptPath = verification.receiptPath || metadata.executionReceipt || null;
    if (!receiptPath) {
      review.reasons.push('verification_receipt_missing');
    } else {
      const resolved = path.resolve(this.root, String(receiptPath));
      if (!resolved.startsWith(`${this.root}${path.sep}`)) {
        review.reasons.push('verification_receipt_outside_workspace');
      } else {
        try {
          const receipt = JSON.parse(await fs.readFile(resolved, 'utf8'));
          if (receipt.done !== true || receipt.stopReason !== 'poseidon_verified') review.reasons.push('verification_receipt_not_poseidon_verified');
          if (!metadata.goalId || receipt.goalId !== metadata.goalId) review.reasons.push('verification_receipt_goal_mismatch');
        } catch {
          review.reasons.push('verification_receipt_unreadable');
        }
      }
    }
    review.reasons = [...new Set(review.reasons)];
    review.approved = review.reasons.length === 0 && review.riskTier === 'low';
    review.decision = review.approved ? 'auto_approved' : review.highRiskDomains.length ? 'quarantined' : 'rejected';
    review.reviewers.maxPolicy.passed = review.reviewers.maxPolicy.passed && !review.reasons.some(reason =>
      reason.startsWith('verification_') || reason.startsWith('source_') || reason.startsWith('evidence_')
    );
    return review;
  }

  async _recordDecision(payload) {
    const receipt = {
      schemaVersion: 1,
      receiptId: `candidate-review-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      reviewedAt: new Date().toISOString(),
      previousHash: this.state.lastReceiptHash || null,
      ...payload
    };
    receipt.hash = sha256(`${receipt.previousHash || ''}:${canonicalJson(receipt)}`);
    await appendJsonl(this.decisionLedger, receipt);
    this.state.lastReceiptHash = receipt.hash;
    return receipt;
  }

  async _promote(candidate, sourcePath, review, fingerprint) {
    const promoted = {
      instruction: String(candidate.instruction).trim(),
      response: String(candidate.response).trim(),
      metadata: {
        ...candidate.metadata,
        ...review.policyMetadata,
        qualityTier: 'training_approved',
        promotionStatus: 'auto_approved',
        reviewRequired: false,
        autoTrain: true,
        promotionAuthority: this.name,
        promotionFingerprint: fingerprint,
        promotedAt: new Date().toISOString(),
        sourceCandidate: path.relative(this.root, sourcePath).replace(/\\/g, '/'),
        riskTier: review.riskTier,
        reviewerResults: review.reviewers
      }
    };
    const destination = path.join(this.approvedDir, `${fingerprint}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(promoted, null, 2), 'utf8');
    await fs.rename(temporary, destination);
    await appendJsonl(this.approvedLedger, promoted);
    return { promoted, destination };
  }

  async _runCycleUnlocked() {
    if (!this.enabled) return { success: true, skipped: true, reason: 'disabled' };
    this.running = true;
    this.stats.cycles++;
    const results = [];
    try {
      const files = await this._discover();
      for (const sourcePath of files) {
        try {
          const raw = await fs.readFile(sourcePath, 'utf8');
          const candidate = JSON.parse(raw);
          const contentHash = sha256(raw);
          const prior = this.state.reviewed[sourcePath];
          if (prior?.contentHash === contentHash) continue;
          const fingerprint = trainingExampleFingerprint(candidate.instruction, candidate.response);
          const review = await this._verifyDurableEvidence(
            candidate,
            this.reviewCandidate(candidate, { path: sourcePath })
          );
          const duplicateApproved = (await this.getApprovedExamples()).some(item =>
            item.metadata?.promotionFingerprint === fingerprint
          );
          if (duplicateApproved) {
            review.approved = false;
            review.decision = 'duplicate';
            review.reasons.push('duplicate_training_example');
            this.stats.duplicates++;
          }
          let promotedPath = null;
          if (review.approved) {
            const promotion = await this._promote(candidate, sourcePath, review, fingerprint);
            promotedPath = path.relative(this.root, promotion.destination).replace(/\\/g, '/');
            this.stats.approved++;
          } else if (review.decision === 'quarantined') this.stats.quarantined++;
          else if (review.decision !== 'duplicate') this.stats.rejected++;

          const receipt = await this._recordDecision({
            sourcePath: path.relative(this.root, sourcePath).replace(/\\/g, '/'),
            contentHash,
            fingerprint,
            promotedPath,
            review
          });
          this.state.reviewed[sourcePath] = { contentHash, decision: review.decision, receiptId: receipt.receiptId, reviewedAt: receipt.reviewedAt };
          results.push({ sourcePath, review, promotedPath, receiptId: receipt.receiptId });
        } catch (error) {
          this.stats.errors++;
          results.push({ sourcePath, error: error.message });
        }
      }
      this.state.lastCycleAt = new Date().toISOString();
      await this._saveState();
      this.emit('cycle_complete', { results });
      return { success: true, reviewed: results.length, results };
    } finally {
      this.running = false;
    }
  }

  runCycle() {
    const operation = this._cycle.then(() => this._runCycleUnlocked());
    this._cycle = operation.catch(() => {});
    return operation;
  }

  async getApprovedExamples() {
    const rows = await readJsonl(this.approvedLedger);
    const unique = new Map();
    for (const row of rows) {
      const fingerprint = row.metadata?.promotionFingerprint || trainingExampleFingerprint(row.instruction, row.response);
      unique.set(fingerprint, row);
    }
    return [...unique.values()];
  }

  async getRecentDecisions(limit = 50) {
    const rows = await readJsonl(this.decisionLedger);
    return rows.slice(-Math.max(1, Math.min(500, Number(limit) || 50))).reverse();
  }

  getStatus() {
    return {
      name: this.name,
      enabled: this.enabled,
      running: this.running,
      intervalMs: this.intervalMs,
      candidateRoots: this.candidateRoots.map(value => path.relative(this.root, value).replace(/\\/g, '/')),
      lastCycleAt: this.state.lastCycleAt,
      stats: { ...this.stats }
    };
  }
}

export default TrainingCandidatePromoter;
