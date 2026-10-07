/**
 * KevinPairingService - Sender Verification via Pairing Codes
 *
 * Inspired by clawdbot's pairing-store.ts
 *
 * Features:
 * - Generate 8-char human-friendly pairing codes (no 0/O/1/I confusion)
 * - TTL-based code expiration (default: 60 minutes)
 * - Per-sender allowlist persistence with atomic writes
 * - Max pending requests per sender (prevents spam)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Human-friendly charset (excludes 0, O, 1, I, l to avoid confusion)
const PAIRING_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_PENDING_PER_SENDER = 3;

class KevinPairingService {
    constructor(options = {}) {
        this.dataDir = options.dataDir || path.join(process.cwd(), 'data', 'kevin');
        this.allowlistPath = path.join(this.dataDir, 'sender_allowlist.json');
        this.pairingPath = path.join(this.dataDir, 'pending_pairings.json');
        this.ttlMs = options.ttlMs || DEFAULT_TTL_MS;

        // In-memory cache
        this.allowlist = new Set();
        this.pendingPairings = new Map(); // code -> { sender, createdAt, expiresAt, metadata }
        this.senderToPairings = new Map(); // sender -> Set of codes

        this._ensureDataDir();
        this._loadState();
    }

    _ensureDataDir() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    _loadState() {
        // Load allowlist
        try {
            if (fs.existsSync(this.allowlistPath)) {
                const data = JSON.parse(fs.readFileSync(this.allowlistPath, 'utf8'));
                this.allowlist = new Set(data.senders || []);
                console.log(`[KevinPairing] Loaded ${this.allowlist.size} approved senders`);
            }
        } catch (e) {
            console.warn('[KevinPairing] Failed to load allowlist:', e.message);
        }

        // Load pending pairings (and prune expired)
        try {
            if (fs.existsSync(this.pairingPath)) {
                const data = JSON.parse(fs.readFileSync(this.pairingPath, 'utf8'));
                const now = Date.now();

                for (const [code, pairing] of Object.entries(data.pairings || {})) {
                    if (pairing.expiresAt > now) {
                        this.pendingPairings.set(code, pairing);

                        if (!this.senderToPairings.has(pairing.sender)) {
                            this.senderToPairings.set(pairing.sender, new Set());
                        }
                        this.senderToPairings.get(pairing.sender).add(code);
                    }
                }
                console.log(`[KevinPairing] Loaded ${this.pendingPairings.size} pending pairings`);
            }
        } catch (e) {
            console.warn('[KevinPairing] Failed to load pairings:', e.message);
        }
    }

    _saveAllowlist() {
        try {
            const data = {
                senders: Array.from(this.allowlist),
                updatedAt: new Date().toISOString()
            };
            // Atomic write: write to temp file, then rename
            const tempPath = this.allowlistPath + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
            fs.renameSync(tempPath, this.allowlistPath);
        } catch (e) {
            console.error('[KevinPairing] Failed to save allowlist:', e.message);
        }
    }

    _savePairings() {
        try {
            const pairings = {};
            for (const [code, pairing] of this.pendingPairings) {
                pairings[code] = pairing;
            }
            const data = {
                pairings,
                updatedAt: new Date().toISOString()
            };
            const tempPath = this.pairingPath + '.tmp';
            fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
            fs.renameSync(tempPath, this.pairingPath);
        } catch (e) {
            console.error('[KevinPairing] Failed to save pairings:', e.message);
        }
    }

    /**
     * Generate a human-friendly pairing code
     */
    _generateCode() {
        let code = '';
        const bytes = crypto.randomBytes(CODE_LENGTH);
        for (let i = 0; i < CODE_LENGTH; i++) {
            code += PAIRING_CHARSET[bytes[i] % PAIRING_CHARSET.length];
        }
        return code;
    }

    /**
     * Normalize sender email/ID for consistent matching
     */
    _normalizeSender(sender) {
        // Extract email from "Name <redacted@example.com>" format
        const match = sender.match(/<([^>]+)>/);
        const email = match ? match[1] : sender;
        return email.toLowerCase().trim();
    }

    /**
     * Check if a sender is already approved
     */
    isApproved(sender) {
        const normalized = this._normalizeSender(sender);
        return this.allowlist.has(normalized);
    }

    /**
     * Create a pairing request for an unknown sender
     * Returns the code they need to verify
     */
    createPairingRequest(sender, metadata = {}) {
        const normalized = this._normalizeSender(sender);

        // Check if already approved
        if (this.allowlist.has(normalized)) {
            return {
                success: false,
                reason: 'already_approved',
                message: 'Sender is already in the approved list'
            };
        }

        // Check pending limit
        const existingCodes = this.senderToPairings.get(normalized) || new Set();
        if (existingCodes.size >= MAX_PENDING_PER_SENDER) {
            // Prune oldest expired codes first
            this._pruneExpiredForSender(normalized);

            const remaining = this.senderToPairings.get(normalized) || new Set();
            if (remaining.size >= MAX_PENDING_PER_SENDER) {
                return {
                    success: false,
                    reason: 'too_many_pending',
                    message: `Maximum ${MAX_PENDING_PER_SENDER} pending requests per sender`
                };
            }
        }

        // Generate unique code
        let code;
        do {
            code = this._generateCode();
        } while (this.pendingPairings.has(code));

        const now = Date.now();
        const pairing = {
            sender: normalized,
            originalSender: sender,
            code,
            createdAt: now,
            expiresAt: now + this.ttlMs,
            metadata: {
                ...metadata,
                requestedAt: new Date().toISOString()
            }
        };

        // Store
        this.pendingPairings.set(code, pairing);
        if (!this.senderToPairings.has(normalized)) {
            this.senderToPairings.set(normalized, new Set());
        }
        this.senderToPairings.get(normalized).add(code);

        this._savePairings();

        return {
            success: true,
            code,
            expiresAt: new Date(pairing.expiresAt).toISOString(),
            expiresInMinutes: Math.round(this.ttlMs / 60000),
            message: `Pairing code generated. Sender must reply with code: ${code}`
        };
    }

    /**
     * Verify a pairing code and approve the sender
     */
    verifyCode(code, fromSender = null) {
        const upperCode = code.toUpperCase().trim();
        const pairing = this.pendingPairings.get(upperCode);

        if (!pairing) {
            return {
                success: false,
                reason: 'invalid_code',
                message: 'Invalid or expired pairing code'
            };
        }

        // Check expiration
        if (Date.now() > pairing.expiresAt) {
            this._removePairing(upperCode);
            return {
                success: false,
                reason: 'expired',
                message: 'Pairing code has expired'
            };
        }

        // Optional: verify the code came from the expected sender
        if (fromSender) {
            const normalizedFrom = this._normalizeSender(fromSender);
            if (normalizedFrom !== pairing.sender) {
                return {
                    success: false,
                    reason: 'sender_mismatch',
                    message: 'Code does not match sender'
                };
            }
        }

        // Approve the sender
        this.allowlist.add(pairing.sender);
        this._removePairing(upperCode);
        this._saveAllowlist();

        return {
            success: true,
            sender: pairing.sender,
            originalSender: pairing.originalSender,
            message: `Sender ${pairing.sender} has been approved`
        };
    }

    /**
     * Manually approve a sender (bypass pairing)
     */
    approveSender(sender) {
        const normalized = this._normalizeSender(sender);

        if (this.allowlist.has(normalized)) {
            return {
                success: true,
                alreadyApproved: true,
                message: 'Sender was already approved'
            };
        }

        this.allowlist.add(normalized);
        this._saveAllowlist();

        // Clear any pending pairings for this sender
        const codes = this.senderToPairings.get(normalized);
        if (codes) {
            for (const code of codes) {
                this.pendingPairings.delete(code);
            }
            this.senderToPairings.delete(normalized);
            this._savePairings();
        }

        return {
            success: true,
            sender: normalized,
            message: `Sender ${normalized} approved`
        };
    }

    /**
     * Revoke a sender's approval
     */
    revokeSender(sender) {
        const normalized = this._normalizeSender(sender);

        if (!this.allowlist.has(normalized)) {
            return {
                success: false,
                reason: 'not_found',
                message: 'Sender was not in the approved list'
            };
        }

        this.allowlist.delete(normalized);
        this._saveAllowlist();

        return {
            success: true,
            sender: normalized,
            message: `Sender ${normalized} has been revoked`
        };
    }

    /**
     * Get all approved senders
     */
    getApprovedSenders() {
        return Array.from(this.allowlist);
    }

    /**
     * Get all pending pairing requests
     */
    getPendingPairings() {
        this._pruneExpired();

        const pending = [];
        for (const [code, pairing] of this.pendingPairings) {
            pending.push({
                code,
                sender: pairing.sender,
                originalSender: pairing.originalSender,
                createdAt: new Date(pairing.createdAt).toISOString(),
                expiresAt: new Date(pairing.expiresAt).toISOString(),
                expiresInMinutes: Math.round((pairing.expiresAt - Date.now()) / 60000)
            });
        }

        return pending;
    }

    /**
     * Get status summary
     */
    getStatus() {
        this._pruneExpired();

        return {
            approvedCount: this.allowlist.size,
            pendingCount: this.pendingPairings.size,
            ttlMinutes: Math.round(this.ttlMs / 60000),
            maxPendingPerSender: MAX_PENDING_PER_SENDER
        };
    }

    _removePairing(code) {
        const pairing = this.pendingPairings.get(code);
        if (pairing) {
            this.pendingPairings.delete(code);
            const senderCodes = this.senderToPairings.get(pairing.sender);
            if (senderCodes) {
                senderCodes.delete(code);
                if (senderCodes.size === 0) {
                    this.senderToPairings.delete(pairing.sender);
                }
            }
            this._savePairings();
        }
    }

    _pruneExpired() {
        const now = Date.now();
        const toRemove = [];

        for (const [code, pairing] of this.pendingPairings) {
            if (now > pairing.expiresAt) {
                toRemove.push(code);
            }
        }

        if (toRemove.length > 0) {
            for (const code of toRemove) {
                this._removePairing(code);
            }
        }
    }

    _pruneExpiredForSender(sender) {
        const codes = this.senderToPairings.get(sender);
        if (!codes) return;

        const now = Date.now();
        const toRemove = [];

        for (const code of codes) {
            const pairing = this.pendingPairings.get(code);
            if (!pairing || now > pairing.expiresAt) {
                toRemove.push(code);
            }
        }

        for (const code of toRemove) {
            this._removePairing(code);
        }
    }
}

module.exports = { KevinPairingService };
