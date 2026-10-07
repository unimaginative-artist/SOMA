import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * SecretSanctum - "The Vault of SOMA"
 * 
 * Securely stores and manages API keys and credentials.
 * Keys are encrypted at rest using a hardware-derived master key.
 */
export class SecretSanctum {
    constructor() {
        this.vaultPath = path.join(process.cwd(), '.soma', 'secrets.vault');
        this.masterKey = this._deriveMasterKey();
        this.isLocked = false;
        this.cache = new Map();
    }

    /**
     * Derive a key unique to this machine (Hardware ID + Username)
     */
    _deriveMasterKey() {
        const secret = os.hostname() + os.userInfo().username + (process.env.SOMA_SALT || 'lobster_soul');
        return crypto.createHash('sha256').update(secret).digest();
    }

    /**
     * Store a new secret in the vault
     */
    async storeSecret(key, value) {
        if (this.isLocked) throw new Error('Vault is LOCKED');

        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', this.masterKey, iv);
        
        let encrypted = cipher.update(value, 'utf8', 'hex');
        encrypted += cipher.final('hex');

        this.cache.set(key, value);
        await this._saveToDisk(key, { encrypted, iv: iv.toString('hex') });
    }

    /**
     * Retrieve a secret (Only if not locked)
     */
    async getSecret(key) {
        if (this.isLocked) {
            console.error(`🚨 ACCESS DENIED: Vault is LOCKED. Key ${key} requested.`);
            return null;
        }

        // Return from cache if possible
        if (this.cache.has(key)) return this.cache.get(key);

        // Otherwise load and decrypt from disk
        const data = await this._loadFromDisk(key);
        if (!data) return null;

        const { encrypted, iv } = data;
        const decipher = crypto.createDecipheriv('aes-256-cbc', this.masterKey, Buffer.from(iv, 'hex'));
        
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        this.cache.set(key, decrypted);
        return decrypted;
    }

    /**
     * Instant lockdown: Wipe cache and block access
     */
    lock() {
        this.isLocked = true;
        this.cache.clear();
        console.warn('🔒 SECRET SANCTUM HAS BEEN LOCKED. Credentials purged from memory.');
    }

    unlock() {
        this.isLocked = false;
        console.info('🔓 Secret Sanctum unlocked.');
    }

    async _saveToDisk(key, data) {
        try {
            let vault = {};
            try {
                const existing = await fs.readFile(this.vaultPath, 'utf8');
                vault = JSON.parse(existing);
            } catch (e) {}

            vault[key] = data;
            await fs.mkdir(path.dirname(this.vaultPath), { recursive: true });
            await fs.writeFile(this.vaultPath, JSON.stringify(vault, null, 2));
        } catch (e) {}
    }

    async _loadFromDisk(key) {
        try {
            const data = await fs.readFile(this.vaultPath, 'utf8');
            const vault = JSON.parse(data);
            return vault[key];
        } catch (e) {
            return null;
        }
    }
}

export default new SecretSanctum();
