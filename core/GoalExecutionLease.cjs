'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class GoalExecutionLease {
  constructor(options = {}) {
    this.root = options.root || path.join(process.cwd(), 'data', 'goal-leases');
    this.defaultTtlMs = Number(options.defaultTtlMs || 10 * 60 * 1000);
    fs.mkdirSync(this.root, { recursive: true });
  }

  _path(goalId) {
    const key = crypto.createHash('sha256').update(String(goalId)).digest('hex');
    return path.join(this.root, `${key}.lease.json`);
  }

  _read(filePath) {
    try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
  }

  _processAlive(pid) {
    const numericPid = Number(pid || 0);
    if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
    try {
      process.kill(numericPid, 0);
      return true;
    } catch (error) {
      if (error?.code === 'ESRCH') return false;
      // EPERM means the process exists but this account cannot signal it.
      if (error?.code === 'EPERM') return true;
      return null;
    }
  }

  acquire(goalId, owner, ttlMs = this.defaultTtlMs) {
    if (!goalId) throw new Error('goalId is required for execution lease');
    const filePath = this._path(goalId);
    const now = Date.now();
    const token = crypto.randomUUID();
    const lease = {
      version: 1,
      goalId: String(goalId),
      owner: String(owner || 'unknown'),
      token,
      acquiredAt: now,
      expiresAt: now + Math.max(30_000, Number(ttlMs || this.defaultTtlMs)),
      pid: process.pid
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = fs.openSync(filePath, 'wx');
        fs.writeFileSync(handle, JSON.stringify(lease, null, 2), 'utf8');
        fs.fsyncSync(handle);
        fs.closeSync(handle);
        return { acquired: true, lease, filePath };
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = this._read(filePath);
        const ownerAlive = this._processAlive(existing?.pid);
        if (existing && Number(existing.expiresAt || 0) > now && ownerAlive !== false) {
          return { acquired: false, reason: 'goal_already_leased', lease: existing, filePath };
        }
        try { fs.unlinkSync(filePath); } catch (unlinkError) {
          if (unlinkError.code !== 'ENOENT') return { acquired: false, reason: 'stale_lease_cleanup_failed', lease: existing, filePath };
        }
      }
    }
    return { acquired: false, reason: 'lease_contention', filePath };
  }

  release(handle) {
    if (!handle?.filePath || !handle?.lease?.token) return { released: false, reason: 'invalid_lease_handle' };
    const existing = this._read(handle.filePath);
    if (!existing) return { released: true, reason: 'already_absent' };
    if (existing.token !== handle.lease.token) return { released: false, reason: 'lease_token_mismatch' };
    try {
      fs.unlinkSync(handle.filePath);
      return { released: true };
    } catch (error) {
      return { released: false, reason: error.message };
    }
  }
}

module.exports = { GoalExecutionLease };
