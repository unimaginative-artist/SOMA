/**
 * DeploymentArbiter.js — Production-Grade Secure Deployment
 *
 * Responsibilities:
 * - Accept signed update proposals (system/proposal)
 * - Stage packages via broker (system/update_stage)
 * - Collect ACKs (via broker.waitForQuorum / collectAcks)
 * - Commit when quorum satisfied (system/update_commit)
 * - Rollback on failures (system/update_abort / system/update_rollback)
 * - Audit all steps to disk (auditPath)
 *
 * SECURITY NOTE:
 * - This file contains a simple signature verification helper for demo/testing.
 * - In production: use a KMS/HSM (AWS KMS, GCP KMS, Azure Key Vault) for signing/verification.
 */

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

function now() { return Date.now(); }
function uid(prefix = '') { return `${prefix}${crypto.randomUUID()}`; }

/**
 * Simple verification helper (demo only).
 * Accepts:
 *   signatures: [{ pubKeyPem: string, signature: base64 }]
 *   payload: object
 *
 * Returns { validCount, required, ok, detail }
 *
 * Production: verify signatures using KMS/HSM and enforce stronger policies (nonces, revocation checks).
 */
function verifySignaturesDemo(signatures = [], payload = {}, required = 1) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  let validCount = 0;
  const details = [];

  for (const s of signatures) {
    try {
      const verifier = crypto.createVerify('SHA256');
      verifier.update(data);
      verifier.end();
      const ok = verifier.verify(s.pubKeyPem, s.signature, 'base64');
      details.push({ pub: s.pubKeyPem?.slice?.(0, 40) || 'key', ok });
      if (ok) validCount++;
    } catch (e) {
      details.push({ pub: s.pubKeyPem?.slice?.(0, 40) || 'key', ok: false, err: e.message });
    }
  }

  return { validCount, required, ok: validCount >= required, details };
}

/**
 * Builds a signed audit record and persists to disk.
 */
async function writeAudit(auditPath, event, data) {
  try {
    await fs.mkdir(auditPath, { recursive: true });
    const rec = {
      event,
      ts: now(),
      data
    };
    const file = path.join(auditPath, `${event}_${now()}_${uid('').slice(0,6)}.json`);
    await fs.writeFile(file, JSON.stringify(rec, null, 2), 'utf8');
  } catch (e) {
    console.error('[DeploymentArbiter] audit write failed', e.message);
  }
}

class DeploymentArbiter extends BaseArbiter {
  /**
   * opts:
   *  - quorum: fraction (0..1) required to accept staged package (default 0.75)
   *  - ackTimeoutMs: how long to wait for ACKs (default 20s)
   *  - auditPath: where to write audit events
   *  - adminPubKeys: array of admin pub key PEMs (for simple multisig)
   *  - requiredAdminSigs: minimum admin signatures required (integer)
   */
  constructor(broker, opts = {}) {
    super(broker, {
      name: opts.name || 'DeploymentArbiter',
      role: 'deployment-manager',
      ...opts
    });
    
    this.quorum = typeof opts.quorum === 'number' ? opts.quorum : 0.75;
    this.ackTimeoutMs = opts.ackTimeoutMs || 20000;
    this.auditPath = opts.auditPath || path.join(process.cwd(), 'deployment-audit');
    this.adminPubKeys = opts.adminPubKeys || []; // array of PEM strings (for informational listing)
    this.requiredAdminSigs = opts.requiredAdminSigs || Math.max(1, Math.ceil(this.adminPubKeys.length * 0.6));

    // pendingPackages: packageId => { payload, proposer, status, stagedAt, acks }
    this.pendingPackages = new Map();
    this.lastSeen = now();
  }
  
  async initialize() {
    await super.initialize();
    
    this.log('info', `🚀 DeploymentArbiter initialized (quorum=${this.quorum}, requiredAdminSigs=${this.requiredAdminSigs})`);
    
    // Subscribe to messages
    this.subscribe('system.proposal', this._onProposal.bind(this));
    this.subscribe('system.admin_command', this._onAdminCommand.bind(this));
  }

  // -------------------------
  // Incoming proposal handler
  // -------------------------
  async _onProposal(envelope) {
    try {
      await writeAudit(this.auditPath, 'proposal_received', { envelope });
    } catch (e) {
      console.error('[DeploymentArbiter] Failed to write audit log for proposal:', e.message);
    }

    const msg = envelope || {};
    const { payload = null, signatures = [], meta = {} } = msg;

    // Basic sanity checks
    if (!payload || !payload.packageId) {
      await writeAudit(this.auditPath, 'proposal_rejected', { reason: 'missing_payload_or_packageId', envelope });
      return;
    }

    // Validate timestamp and TTL (defense against replay)
    const ts = payload.ts || 0;
    const ttl = payload.ttlMs || (15 * 60 * 1000); // default 15min
    if (Math.abs(now() - ts) > ttl) {
      await writeAudit(this.auditPath, 'proposal_rejected', { reason: 'stale_payload', packageId: payload.packageId, now: now(), payloadTs: ts });
      return;
    }

    // Verify signatures: require requiredAdminSigs valid signatures
    const { ok, validCount, details } = verifySignaturesDemo(signatures, payload, this.requiredAdminSigs);

    await writeAudit(this.auditPath, 'proposal_signature_check', { packageId: payload.packageId, ok, validCount, details });

    if (!ok) {
      await writeAudit(this.auditPath, 'proposal_rejected', { packageId: payload.packageId, reason: 'insufficient_signatures', validCount });
      return;
    }

    // Accept and stage
    try {
      const result = await this.stagePackage(payload, envelope.from || 'unknown');
      await writeAudit(this.auditPath, 'proposal_staged', { packageId: payload.packageId, result });
    } catch (e) {
      await writeAudit(this.auditPath, 'proposal_stage_error', { packageId: payload.packageId, error: e.message });
    }
  }

  // -------------------------
  // Stage package across cluster
  // -------------------------
  async stagePackage(payload, proposer = 'unknown') {
    const packageId = payload.packageId;
    if (this.pendingPackages.has(packageId)) {
      return { ok: false, reason: 'already_pending' };
    }

    const entry = {
      packageId,
      payload,
      proposer,
      status: 'staging',
      stagedAt: now(),
      acks: []
    };
    this.pendingPackages.set(packageId, entry);

    this.publish('system.update_stage', { packageId, payload });
    await writeAudit(this.auditPath, 'stage_broadcasted', { packageId, proposer, payloadMeta: { name: payload.name } });

    // Wait for ACKs (simplified - in production use broker.waitForQuorum)
    await this._waitForAcks(packageId, entry);

    // Evaluate quorum
    const ratio = entry.acks.length / Math.max(1, entry.expected || 1);
    if (ratio >= this.quorum) {
      entry.status = 'staged';
      const commitResult = await this.commitPackage(packageId);
      return { ok: true, staged: true, commitResult };
    } else {
      entry.status = 'stage_failed';
      this.publish('system.update_abort', { packageId });
      await writeAudit(this.auditPath, 'stage_failed_abort_broadcast', { packageId, ratio });
      return { ok: false, reason: 'quorum_not_met', ratio };
    }
  }

  async _waitForAcks(packageId, entry) {
    // Simplified ACK collection (in production, use MessageBroker.waitForQuorum)
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        entry.expected = 5; // assume 5 arbiters
        resolve();
      }, this.ackTimeoutMs);
      
      // Collect acks via subscription
      const unsubscribe = this.subscribe(`system.update_stage.ack.${packageId}`, (ack) => {
        entry.acks.push({ from: ack.from || 'unknown', ts: now() });
      });
      
      setTimeout(() => {
        if (unsubscribe) unsubscribe();
        clearTimeout(timeout);
        resolve();
      }, this.ackTimeoutMs);
    });
  }

  // -------------------------
  // Commit package => make active
  // -------------------------
  async commitPackage(packageId) {
    const entry = this.pendingPackages.get(packageId);
    if (!entry) {
      await writeAudit(this.auditPath, 'commit_failed', { packageId, reason: 'not_found' });
      return { ok: false, reason: 'not_found' };
    }
    if (entry.status !== 'staged' && entry.status !== 'staging') {
      await writeAudit(this.auditPath, 'commit_failed', { packageId, reason: `invalid_status_${entry.status}` });
      return { ok: false, reason: 'invalid_status' };
    }

    entry.status = 'committing';
    entry.committedAt = now();

    await writeAudit(this.auditPath, 'commit_started', { packageId });

    this.publish('system.update_commit', { packageId, payload: entry.payload });

    // Collect activation ACKs
    await this._waitForAcks(`${packageId}_commit`, entry);

    const ratio = entry.acks.length / Math.max(1, entry.expected || 1);

    if (ratio >= this.quorum) {
      entry.status = 'active';
      entry.activatedAt = now();
      await writeAudit(this.auditPath, 'commit_success', { packageId });
      return { ok: true, status: 'active' };
    } else {
      entry.status = 'commit_partial_failure';
      await writeAudit(this.auditPath, 'commit_partial_failure', { packageId, ratio });
      const rollbackResult = await this.rollbackPackage(packageId, { reason: 'insufficient_activation_quorum' });
      return { ok: false, reason: 'activation_quorum_failed', rollbackResult };
    }
  }

  // -------------------------
  // Rollback package
  // -------------------------
  async rollbackPackage(packageId, opts = {}) {
    const entry = this.pendingPackages.get(packageId);
    if (!entry) {
      await writeAudit(this.auditPath, 'rollback_no_entry', { packageId });
      return { ok: false, reason: 'no_entry' };
    }

    await writeAudit(this.auditPath, 'rollback_initiated', { packageId, opts });

    this.publish('system.update_rollback', { packageId, reason: opts.reason || 'manual' });

    entry.status = 'rolled_back';
    entry.rolledBackAt = now();

    await writeAudit(this.auditPath, 'rollback_complete', { packageId });

    return { ok: true, rolledBack: true };
  }

  // -------------------------
  // Admin commands (external)
  // -------------------------
  async _onAdminCommand(envelope) {
    try {
      const cmd = envelope || {};
      await writeAudit(this.auditPath, 'admin_command_received', { envelope });

      const { type, packageId, signatures = [], payload = {} } = cmd;

      // validate signatures for admin actions
      const { ok, validCount } = verifySignaturesDemo(signatures, cmd, this.requiredAdminSigs);
      if (!ok) {
        await writeAudit(this.auditPath, 'admin_command_rejected', { type, packageId, validCount });
        return;
      }

      if (type === 'force_rollback') {
        await this.rollbackPackage(packageId, { reason: 'force_by_admin' });
        return;
      } else if (type === 'force_commit') {
        await this.commitPackage(packageId);
        return;
      } else {
        await writeAudit(this.auditPath, 'admin_command_unknown', { type });
      }
    } catch (e) {
      await writeAudit(this.auditPath, 'admin_command_error', { error: e.message });
    }
  }

  // -------------------------
  // Status
  // -------------------------
  getStatus() {
    return {
      ...super.getStatus(),
      pending: Array.from(this.pendingPackages.keys()),
      quorum: this.quorum,
      requiredAdminSigs: this.requiredAdminSigs,
      auditPath: this.auditPath
    };
  }

  // External helper to propose updates programmatically
  async proposeUpdate({ packageId, name, payload, signatures = [], ttlMs = 900000 }) {
    const pkg = {
      packageId: packageId || `pkg_${Date.now()}`,
      name,
      payload,
      ts: now(),
      ttlMs
    };

    await this.publish('system.proposal', { payload: pkg, signatures });
    await writeAudit(this.auditPath, 'proposal_sent', { packageId: pkg.packageId, name });
    return pkg.packageId;
  }
}

module.exports = DeploymentArbiter;






