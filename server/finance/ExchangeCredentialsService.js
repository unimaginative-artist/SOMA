/**
 * ExchangeCredentialsService - Centralized API Key Storage for All Exchanges
 *
 * Handles encrypted storage and retrieval of API credentials for:
 * - Alpaca (stocks)
 * - Binance (crypto)
 * - Coinbase (crypto)
 * - Kraken (crypto)
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to store exchange credentials
const CONFIG_DIR = path.join(__dirname, '..', '..', 'config');
const CREDENTIALS_FILE = path.join(CONFIG_DIR, 'exchange-credentials.json');

// Simple encryption key derived from machine-specific data
const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.COMPUTERNAME || 'soma-default').digest();

class ExchangeCredentialsService {
    constructor() {
        this.ensureConfigDir();
        this._credCache    = null;  // in-memory cache of credentials file
        this._credCacheTs  = 0;     // timestamp of last file read
        this._credCacheTTL = 5000;  // 5s TTL — credentials rarely change
    }

    /**
     * Ensure config directory exists
     */
    ensureConfigDir() {
        if (!fs.existsSync(CONFIG_DIR)) {
            fs.mkdirSync(CONFIG_DIR, { recursive: true });
        }
    }

    /**
     * Encrypt sensitive data
     */
    encrypt(text) {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');
            return iv.toString('hex') + ':' + encrypted;
        } catch (e) {
            console.error('[Credentials] Encryption failed:', e.message);
            return null;
        }
    }

    /**
     * Decrypt sensitive data
     */
    decrypt(encryptedText) {
        try {
            if (!encryptedText || !encryptedText.includes(':')) return null;
            const parts = encryptedText.split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts[1];
            const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (e) {
            console.error('[Credentials] Decryption failed:', e.message);
            return null;
        }
    }

    /**
     * Load all credentials from file.
     * Cached with a 5s TTL — readFileSync on every status call was the primary
     * cause of 5-6s event-loop stalls (called 4+ times per request).
     */
    loadAllCredentials() {
        const now = Date.now();
        if (this._credCache && (now - this._credCacheTs) < this._credCacheTTL) {
            return this._credCache;
        }
        try {
            if (!fs.existsSync(CREDENTIALS_FILE)) {
                this._credCache   = {};
                this._credCacheTs = now;
                return {};
            }
            const data = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
            this._credCache   = data;
            this._credCacheTs = now;
            return data;
        } catch (e) {
            console.error('[Credentials] Failed to load:', e.message);
            return this._credCache || {};
        }
    }

    /** Invalidate cache immediately (call after any write) */
    _invalidateCache() {
        this._credCache   = null;
        this._credCacheTs = 0;
    }

    /**
     * Save all credentials to file
     */
    saveAllCredentials(credentials) {
        try {
            this.ensureConfigDir();
            fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
            // Update cache to the just-written data so next read is instant
            this._credCache   = credentials;
            this._credCacheTs = Date.now();
            return true;
        } catch (e) {
            console.error('[Credentials] Failed to save:', e.message);
            this._invalidateCache();
            return false;
        }
    }

    /**
     * Save credentials for a specific exchange
     * @param {string} exchange - Exchange name (alpaca_paper, alpaca_live, binance, coinbase, kraken)
     * @param {object} creds - Credentials object with apiKey, secretKey, and optional flags
     */
    saveCredentials(exchange, creds) {
        try {
            const allCreds = this.loadAllCredentials();

            // Encrypt sensitive fields
            const encryptedCreds = {
                apiKey: this.encrypt(creds.apiKey),
                secretKey: this.encrypt(creds.secretKey),
                savedAt: new Date().toISOString()
            };

            // Add exchange-specific flags
            if (exchange === 'alpaca_paper') {
                encryptedCreds.paperTrading = true;
            } else if (exchange === 'alpaca_live') {
                encryptedCreds.paperTrading = false;
            } else if (exchange === 'alpaca') {
                // Legacy support - convert to new format
                encryptedCreds.paperTrading = creds.paperTrading ?? creds.paper ?? true;
            } else if (exchange === 'binance') {
                encryptedCreds.testnet = creds.testnet ?? true;
            } else if (exchange === 'coinbase') {
                encryptedCreds.sandbox = creds.sandbox ?? true;
            }

            allCreds[exchange] = encryptedCreds;
            this.saveAllCredentials(allCreds);

            console.log(`[Credentials] ${exchange} credentials saved (encrypted)`);
            return true;
        } catch (e) {
            console.error(`[Credentials] Failed to save ${exchange}:`, e.message);
            return false;
        }
    }

    /**
     * Load credentials for a specific exchange
     * @param {string} exchange - Exchange name
     * @returns {object|null} Decrypted credentials or null
     */
    loadCredentials(exchange) {
        try {
            const allCreds = this.loadAllCredentials();
            if (!allCreds[exchange]) {
                return null;
            }

            const creds = allCreds[exchange];
            const apiKey = this.decrypt(creds.apiKey);
            const secretKey = this.decrypt(creds.secretKey);

            if (!apiKey || !secretKey) {
                console.error(`[Credentials] Failed to decrypt ${exchange} credentials`);
                return null;
            }

            const result = { apiKey, secretKey };

            // Add exchange-specific flags
            if (exchange === 'alpaca_paper') {
                result.paperTrading = true;
            } else if (exchange === 'alpaca_live') {
                result.paperTrading = false;
            } else if (exchange === 'alpaca') {
                // Legacy support
                result.paperTrading = creds.paperTrading ?? true;
            } else if (exchange === 'binance') {
                result.testnet = creds.testnet ?? true;
            } else if (exchange === 'coinbase') {
                result.sandbox = creds.sandbox ?? true;
            }

            return result;
        } catch (e) {
            console.error(`[Credentials] Failed to load ${exchange}:`, e.message);
            return null;
        }
    }

    /**
     * Clear credentials for a specific exchange
     * @param {string} exchange - Exchange name
     */
    clearCredentials(exchange) {
        try {
            const allCreds = this.loadAllCredentials();
            delete allCreds[exchange];
            this.saveAllCredentials(allCreds); // also updates cache
            console.log(`[Credentials] ${exchange} credentials cleared`);
            return true;
        } catch (e) {
            console.error(`[Credentials] Failed to clear ${exchange}:`, e.message);
            this._invalidateCache();
            return false;
        }
    }

    /**
     * Check if credentials exist for a specific exchange
     * @param {string} exchange - Exchange name
     */
    hasCredentials(exchange) {
        try {
            const allCreds = this.loadAllCredentials();
            return !!(allCreds[exchange] && allCreds[exchange].apiKey);
        } catch (e) {
            return false;
        }
    }

    /**
     * Get status of all exchanges (which have saved credentials)
     */
    getAllStatus() {
        const exchanges = ['alpaca_paper', 'alpaca_live', 'binance', 'coinbase', 'kraken'];
        const status = {};
        for (const exchange of exchanges) {
            status[exchange] = this.hasCredentials(exchange);
        }
        return status;
    }
}

// Singleton instance
const exchangeCredentialsService = new ExchangeCredentialsService();
export default exchangeCredentialsService;
