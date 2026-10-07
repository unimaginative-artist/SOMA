/**
 * RedisMockArbiter.js
 * 
 * A high-performance in-memory implementation of the Redis interface.
 * Serves as the "Hot Tier" for SOMA when a real Redis server is unavailable.
 * 
 * Capabilities:
 * - Key-Value Storage (get, set, del)
 * - Expiration (expire, ttl)
 * - Lists (lpush, rpop, lrange)
 * - Pub/Sub (subscribe, publish) - Crucial for MessageBroker!
 */

import BaseArbiterV4 from './BaseArbiter.js';
const BaseArbiter = BaseArbiterV4; // Alias for compatibility
import { EventEmitter } from 'events';

import { ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class RedisMockArbiter extends BaseArbiter {
    static role = ArbiterRole.SPECIALIST;
    static capabilities = [ArbiterCapability.MEMORY_ACCESS, ArbiterCapability.NETWORK_ACCESS];

    constructor(config = {}) {
        super({
            name: 'RedisMockArbiter',
            role: RedisMockArbiter.role,
            capabilities: RedisMockArbiter.capabilities,
            ...config
        });

        this.store = new Map(); // Main key-value store
        this.expirations = new Map(); // Key -> Timestamp
        this.channels = new Map(); // Channel -> Set<Callback>
        this.cleanupInterval = null;
        this.isOpen = true;
        this.isReady = true;
    }

    async initialize() {
        await super.initialize();
        this.startCleanup();
        console.log(`[${this.name}] ⚡ In-Memory Cache (Redis Mock) Active`);
    }

    // --- Key-Value Operations ---

    async get(key) {
        if (this._isExpired(key)) {
            this.del(key);
            return null;
        }
        return this.store.get(key) || null;
    }

    async set(key, value, mode, duration) {
        this.store.set(key, value);
        if (mode === 'EX' && duration) {
            this.expirations.set(key, Date.now() + (duration * 1000));
        }
        return 'OK';
    }

    async setEx(key, seconds, value) {
        return await this.set(key, value, 'EX', seconds);
    }

    async expire(key, seconds) {
        if (!this.store.has(key)) return 0;
        this.expirations.set(key, Date.now() + (Number(seconds) * 1000));
        return 1;
    }

    async ttl(key) {
        if (!this.store.has(key)) return -2;
        const expiresAt = this.expirations.get(key);
        if (!expiresAt) return -1;
        const ttl = Math.ceil((expiresAt - Date.now()) / 1000);
        return ttl > 0 ? ttl : -2;
    }

    async del(key) {
        this.expirations.delete(key);
        return this.store.delete(key) ? 1 : 0;
    }

    async exists(key) {
        if (this._isExpired(key)) {
            this.del(key);
            return 0;
        }
        return this.store.has(key) ? 1 : 0;
    }

    // --- List Operations ---

    async lpush(key, ...values) {
        if (!this.store.has(key)) this.store.set(key, []);
        const list = this.store.get(key);
        if (!Array.isArray(list)) throw new Error('WRONGTYPE Operation against a key holding the wrong kind of value');
        list.unshift(...values);
        return list.length;
    }

    async rpop(key) {
        const list = this.store.get(key);
        if (!list || !Array.isArray(list)) return null;
        return list.pop();
    }

    async lrange(key, start, stop) {
        const list = this.store.get(key);
        if (!list) return [];
        // Handle Redis-style negative indices
        const len = list.length;
        if (stop < 0) stop = len + stop;
        return list.slice(start, stop + 1);
    }

    // --- Pub/Sub Operations (Critical for MessageBroker) ---

    subscribe(channel, callback) {
        if (!this.channels.has(channel)) {
            this.channels.set(channel, new Set());
        }
        this.channels.get(channel).add(callback);
        // console.debug(`[MockRedis] Subscribed to ${channel}`);
    }

    async publish(channel, message) {
        if (!this.channels.has(channel)) return 0;
        const subscribers = this.channels.get(channel);
        for (const cb of subscribers) {
            try {
                cb(message);
            } catch (e) {
                console.error(`[MockRedis] Subscriber error on ${channel}:`, e);
            }
        }
        return subscribers.size;
    }

    // --- Internal Helpers ---

    _isExpired(key) {
        if (!this.expirations.has(key)) return false;
        return Date.now() > this.expirations.get(key);
    }

    startCleanup() {
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const [key, expiry] of this.expirations) {
                if (now > expiry) {
                    this.store.delete(key);
                    this.expirations.delete(key);
                }
            }
        }, 60000); // Cleanup every minute
    }

    async shutdown() {
        if (this.cleanupInterval) clearInterval(this.cleanupInterval);
        this.store.clear();
        this.expirations.clear();
        this.isOpen = false;
        this.isReady = false;
        console.log(`[${this.name}] Cache cleared and shut down`);
        await super.shutdown();
    }

    async quit() {
        await this.shutdown();
        return 'OK';
    }

    async disconnect() {
        await this.shutdown();
    }
}
