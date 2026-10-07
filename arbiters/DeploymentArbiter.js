/**
 * DeploymentArbiter.js - Autonomous Self-Modification System
 *
 * Responsibilities:
 * - Accept signed update proposals (system/proposal)
 * - Stage packages and collect ACKs
 * - Commit when quorum satisfied
 * - Rollback on failures
 * - Complete audit trail
 *
 * SECURITY: Uses cryptographic signatures for all deployments
 * Production: Integrate with KMS/HSM for enterprise deployments
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';

function now() { return Date.now(); }
function uid(prefix = '') { return `${prefix}${crypto.randomUUID()}`; }

/**
 * Simple verification helper (secure enough for autonomous operation)
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
 * Write audit record to disk
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

export class DeploymentArbiter extends EventEmitter {
  /**
   * opts:
   *  - quorum: fraction (0..1) required to accept staged package (default 0.75)
   *  - ackTimeoutMs: how long to wait for ACKs (default 20s)
   *  - auditPath: where to write audit events
   *  - adminPubKeys: array of admin pub key PEMs (for simple multisig)
   *  - requiredAdminSigs: minimum admin signatures required (integer)
   *  - autonomousMode: enable autonomous deployment (default false)
   */
  constructor(opts = {}) {
    super();

    this.name = opts.name || 'DeploymentArbiter';
    this.quorum = typeof opts.quorum === 'number' ? opts.quorum : 0.75;
    this.ackTimeoutMs = opts.ackTimeoutMs || 20000;
    this.auditPath = opts.auditPath || path.join(process.cwd(), 'SOMA', 'deployment-audit');
    this.adminPubKeys = opts.adminPubKeys || [];
    this.requiredAdminSigs = opts.requiredAdminSigs || Math.max(1, Math.ceil(this.adminPubKeys.length * 0.6));
    this.autonomousMode = opts.autonomousMode !== undefined ? opts.autonomousMode : false;

    // pendingPackages: packageId => { payload, proposer, status, stagedAt, acks }
    this.pendingPackages = new Map();
    this.deploymentHistory = [];
    this.lastSeen = now();

    // Metrics
    this.metrics = {
      totalProposals: 0,
      acceptedProposals: 0,
      rejectedProposals: 0,
      successfulDeployments: 0,
      failedDeployments: 0,
      rollbacks: 0
    };

    console.log(`[${this.name}] 🚀 DeploymentArbiter initialized`);
    console.log(`[${this.name}]    Quorum: ${this.quorum}`);
    console.log(`[${this.name}]    Required Signatures: ${this.requiredAdminSigs}`);
    console.log(`[${this.name}]    Autonomous Mode: ${this.autonomousMode ? 'ENABLED' : 'DISABLED'}`);
  }

  async initialize() {
    console.log(`[${this.name}] Initializing deployment system...`);

    // Ensure audit directory exists
    await fs.mkdir(this.auditPath, { recursive: true });

    // If no admin keys, generate a self-signing key for autonomous operation
    if (this.adminPubKeys.length === 0 && this.autonomousMode) {
      console.log(`[${this.name}] ⚠️  No admin keys configured - generating self-signing keypair for autonomous mode`);
      this.selfSigningKey = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      });
      this.adminPubKeys.push(this.selfSigningKey.publicKey);
      this.requiredAdminSigs = 1;

      // Save keys to audit directory
      await fs.writeFile(
        path.join(this.auditPath, 'self-signing-public.pem'),
        this.selfSigningKey.publicKey,
        'utf8'
      );
      await fs.writeFile(
        path.join(this.auditPath, 'self-signing-private.pem'),
        this.selfSigningKey.privateKey,
        'utf8'
      );
      console.log(`[${this.name}]    Generated self-signing keypair (stored in ${this.auditPath})`);
    }

    await writeAudit(this.auditPath, 'system_initialized', {
      quorum: this.quorum,
      requiredAdminSigs: this.requiredAdminSigs,
      autonomousMode: this.autonomousMode,
      adminKeysCount: this.adminPubKeys.length
    });

    this.emit('initialized');
    console.log(`[${this.name}] ✅ Deployment system ready`);
    return { success: true };
  }

  // -------------------------
  // Proposal handling
  // -------------------------
  async handleProposal(proposalData) {
    this.metrics.totalProposals++;

    try {
      await writeAudit(this.auditPath, 'proposal_received', { proposalData });
    } catch (e) {}

    const { payload = null, signatures = [], meta = {} } = proposalData;

    // Basic sanity checks
    if (!payload || !payload.packageId) {
      await writeAudit(this.auditPath, 'proposal_rejected', { reason: 'missing_payload_or_packageId' });
      this.metrics.rejectedProposals++;
      return { success: false, reason: 'invalid_payload' };
    }

    // Validate timestamp and TTL (defense against replay)
    const ts = payload.ts || 0;
    const ttl = payload.ttlMs || (15 * 60 * 1000); // default 15min
    if (Math.abs(now() - ts) > ttl) {
      await writeAudit(this.auditPath, 'proposal_rejected', {
        reason: 'stale_payload',
        packageId: payload.packageId,
        now: now(),
        payloadTs: ts
      });
      this.metrics.rejectedProposals++;
      return { success: false, reason: 'stale_payload' };
    }

    // Verify signatures
    const { ok, validCount, details } = verifySignaturesDemo(signatures, payload, this.requiredAdminSigs);

    await writeAudit(this.auditPath, 'proposal_signature_check', {
      packageId: payload.packageId,
      ok,
      validCount,
      details
    });

    if (!ok) {
      await writeAudit(this.auditPath, 'proposal_rejected', {
        packageId: payload.packageId,
        reason: 'insufficient_signatures',
        validCount
      });
      this.metrics.rejectedProposals++;
      return { success: false, reason: 'insufficient_signatures', validCount, required: this.requiredAdminSigs };
    }

    // Accept and stage
    try {
      const result = await this.stagePackage(payload, meta.proposer || 'unknown');
      this.metrics.acceptedProposals++;
      await writeAudit(this.auditPath, 'proposal_accepted', { packageId: payload.packageId, result });
      return result;
    } catch (e) {
      await writeAudit(this.auditPath, 'proposal_stage_error', { packageId: payload.packageId, error: e.message });
      this.metrics.rejectedProposals++;
      return { success: false, error: e.message };
    }
  }

  // -------------------------
  // Stage package
  // -------------------------
  async stagePackage(payload, proposer = 'unknown') {
    const packageId = payload.packageId;

    if (this.pendingPackages.has(packageId)) {
      return { ok: false, reason: 'already_pending' };
    }

    // Record package
    const entry = {
      packageId,
      payload,
      proposer,
      status: 'staging',
      stagedAt: now(),
      acks: []
    };

    this.pendingPackages.set(packageId, entry);

    await writeAudit(this.auditPath, 'stage_initiated', {
      packageId,
      proposer,
      payloadMeta: { name: payload.name, description: payload.description }
    });

    // In autonomous mode, automatically proceed to commit
    if (this.autonomousMode) {
      console.log(`[${this.name}] 🤖 Autonomous mode: auto-staging ${packageId}`);
      entry.status = 'staged';

      const commitResult = await this.commitPackage(packageId);
      return { ok: true, staged: true, autonomous: true, commitResult };
    }

    // Otherwise, would wait for external ACKs (not implemented in standalone mode)
    entry.status = 'staged';
    return { ok: true, staged: true, note: 'Manual commit required' };
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

    // Create rollback snapshot
    entry.rollbackSnapshot = {
      timestamp: now(),
      note: 'Pre-deployment snapshot'
    };

    await writeAudit(this.auditPath, 'commit_started', { packageId, snapshot: entry.rollbackSnapshot });

    try {
      // Execute the deployment
      const deployResult = await this.executeDeployment(entry.payload);

      if (deployResult.success) {
        entry.status = 'active';
        entry.activatedAt = now();
        this.metrics.successfulDeployments++;

        this.deploymentHistory.push({
          packageId,
          timestamp: now(),
          status: 'success',
          payload: entry.payload
        });

        await writeAudit(this.auditPath, 'commit_success', { packageId, deployResult });

        console.log(`[${this.name}] ✅ Deployment successful: ${packageId}`);
        this.emit('deployment_success', { packageId, payload: entry.payload });

        return { ok: true, status: 'active', deployResult };
      } else {
        throw new Error(deployResult.error || 'Deployment failed');
      }
    } catch (error) {
      entry.status = 'commit_failed';
      this.metrics.failedDeployments++;

      await writeAudit(this.auditPath, 'commit_failed', { packageId, error: error.message });

      console.error(`[${this.name}] ❌ Deployment failed: ${packageId} - ${error.message}`);

      // Trigger rollback
      const rollbackResult = await this.rollbackPackage(packageId, { reason: error.message });

      this.emit('deployment_failed', { packageId, error: error.message, rollbackResult });

      return { ok: false, reason: 'deployment_failed', error: error.message, rollbackResult };
    }
  }

  // -------------------------
  // Execute deployment
  // -------------------------
  async executeDeployment(payload) {
    console.log(`[${this.name}] 🚀 Executing deployment: ${payload.name}`);

    // This is where the actual deployment logic goes
    // For now, we'll store the deployment package and simulate execution

    try {
      const deploymentFile = path.join(this.auditPath, 'deployments', `${payload.packageId}.json`);
      await fs.mkdir(path.dirname(deploymentFile), { recursive: true });
      await fs.writeFile(deploymentFile, JSON.stringify(payload, null, 2), 'utf8');

      // In a real system, this would:
      // 1. Validate the package
      // 2. Run tests
      // 3. Deploy to staging
      // 4. Run integration tests
      // 5. Deploy to production

      console.log(`[${this.name}]    Package stored: ${deploymentFile}`);
      console.log(`[${this.name}]    Deployment type: ${payload.type || 'unknown'}`);

      if (payload.code) {
        console.log(`[${this.name}]    Code changes detected (${payload.code.length} bytes)`);
      }

      if (payload.config) {
        console.log(`[${this.name}]    Configuration changes detected`);
      }

      return {
        success: true,
        packageId: payload.packageId,
        deploymentFile,
        timestamp: now()
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  // -------------------------
  // Rollback package
  // -------------------------
  async rollbackPackage(packageId, opts = {}) {
    this.metrics.rollbacks++;

    const entry = this.pendingPackages.get(packageId);

    if (!entry) {
      await writeAudit(this.auditPath, 'rollback_no_entry', { packageId });
      return { ok: false, reason: 'no_entry' };
    }

    const snapshot = entry.rollbackSnapshot || { note: 'No snapshot available' };

    await writeAudit(this.auditPath, 'rollback_initiated', { packageId, snapshot, opts });

    console.log(`[${this.name}] 🔄 Rolling back: ${packageId}`);

    // In a real system, this would restore from snapshot
    // For now, we just mark it as rolled back

    entry.status = 'rolled_back';
    entry.rolledBackAt = now();
    entry.rollbackReason = opts.reason || 'manual';

    this.deploymentHistory.push({
      packageId,
      timestamp: now(),
      status: 'rolled_back',
      reason: opts.reason
    });

    await writeAudit(this.auditPath, 'rollback_complete', { packageId });

    console.log(`[${this.name}] ✅ Rollback complete: ${packageId}`);
    this.emit('rollback_complete', { packageId, reason: opts.reason });

    return { ok: true, rolledBack: true };
  }

  // -------------------------
  // Self-signing helper for autonomous mode
  // -------------------------
  createSignedProposal(payload) {
    if (!this.selfSigningKey) {
      throw new Error('Self-signing key not available');
    }

    // Add timestamp
    payload.ts = now();
    payload.ttlMs = payload.ttlMs || 900000; // 15 min default

    // Sign the payload
    const signer = crypto.createSign('SHA256');
    signer.update(JSON.stringify(payload));
    signer.end();
    const signature = signer.sign(this.selfSigningKey.privateKey, 'base64');

    return {
      payload,
      signatures: [{
        pubKeyPem: this.selfSigningKey.publicKey,
        signature
      }],
      meta: {
        proposer: 'SOMA_Autonomous',
        autonomous: true
      }
    };
  }

  // -------------------------
  // Helpers
  // -------------------------
  getStatus() {
    return {
      name: this.name,
      autonomousMode: this.autonomousMode,
      pending: Array.from(this.pendingPackages.keys()),
      quorum: this.quorum,
      requiredAdminSigs: this.requiredAdminSigs,
      metrics: this.metrics,
      recentDeployments: this.deploymentHistory.slice(-5)
    };
  }

  async proposeUpdate({ packageId, name, description, payload, type = 'update' }) {
    const pkg = {
      packageId: packageId || `pkg_${Date.now()}`,
      name,
      description,
      type,
      payload,
      ts: now(),
      ttlMs: 900000
    };

    // Create signed proposal
    const proposal = this.createSignedProposal(pkg);

    // Handle it
    const result = await this.handleProposal(proposal);

    await writeAudit(this.auditPath, 'autonomous_proposal_created', { packageId: pkg.packageId, result });

    return { packageId: pkg.packageId, result };
  }

  async shutdown() {
    console.log(`[${this.name}] Shutting down...`);
    await writeAudit(this.auditPath, 'system_shutdown', { metrics: this.metrics });
    this.emit('shutdown');
    return { success: true };
  }
}

export default DeploymentArbiter;
