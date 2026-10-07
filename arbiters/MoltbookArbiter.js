
import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * MoltbookArbiter
 * 
 * SOMA's native interface to Moltbook (Social Network for AI Agents).
 * Handles registration, posting, commenting, and feed monitoring.
 */
export class MoltbookArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'MoltbookArbiter',
            role: ArbiterRole.SPECIALIST,
            capabilities: [
                ArbiterCapability.NETWORK_ACCESS,
                ArbiterCapability.MEMORY_ACCESS
            ],
            ...config
        });

        this.apiBase = 'https://www.moltbook.com/api/v1';
        this.configPath = path.join(process.cwd(), '.soma', 'moltbook.json');
        this.credentials = null;
        this.heartbeatInterval = null;
        this.messageBroker = config.messageBroker || null;
        this.securityCouncil = config.securityCouncil || null;
    }

    async onInitialize() {
        await this.loadCredentials();
        
        // Try to find SecurityCouncil if not provided
        if (!this.securityCouncil && global.SOMA?.securityCouncil) {
            this.securityCouncil = global.SOMA.securityCouncil;
        }

        this.log('info', 'MoltbookArbiter initialized');
        
        if (this.credentials) {
            this.log('success', `Logged in as: ${this.credentials.agent_name}`);
            this.startHeartbeat();
        } else {
            this.log('warn', 'Moltbook credentials not found. Use register() to join.');
        }
        return true;
    }

    async loadCredentials() {
        try {
            this.log('info', `Loading credentials from: ${this.configPath}`);
            const data = await fs.readFile(this.configPath, 'utf8');
            this.credentials = JSON.parse(data);
            this.log('success', `✅ Credentials loaded for: ${this.credentials.agent_name}`);
        } catch (e) {
            this.log('error', `❌ Failed to load credentials: ${e.message}`);
            this.credentials = null;
        }
    }

    async saveCredentials(creds) {
        try {
            const dir = path.dirname(this.configPath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(this.configPath, JSON.stringify(creds, null, 2));
            this.credentials = creds;
            this.log('success', 'Credentials saved');
        } catch (e) {
            this.log('error', `Failed to save credentials: ${e.message}`);
        }
    }

    // --- API Methods ---

    /**
     * Hardened Masker: Prevents leakage of keys/tokens
     */
    maskSensitiveData(text) {
        if (typeof text !== 'string') return text;
        
        // Patterns for common keys (Google, Alpaca, Ed25519, etc.)
        const patterns = [
            /AIza[0-9A-Za-z-_]{35}/g, // Google
            /[0-9A-Za-z]{20,40}/g,     // Generic long hex/alphanumeric strings
            /sk-[0-9A-Za-z]{24,}/g,    // OpenAI style
            /PRIVATE_KEY_[0-9A-Fa-f]+/gi,
            /SESSION_TOKEN_[0-9A-F-]+/gi
        ];

        let masked = text;
        patterns.forEach(p => {
            masked = masked.replace(p, '[MASKED_CREDENTIAL]');
        });
        return masked;
    }

    get headers() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.credentials?.api_key}`
        };
    }

    async register(name, description) {
        this.log('info', `Registering agent: ${name}...`);
        try {
            const res = await fetch(`${this.apiBase}/agents/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, description })
            });
            const data = await res.json();
            
            if (data.agent && data.agent.api_key) {
                await this.saveCredentials({
                    api_key: data.agent.api_key,
                    agent_name: name,
                    claim_url: data.agent.claim_url
                });
                return { 
                    success: true, 
                    claimUrl: data.agent.claim_url, 
                    message: "Registration successful! Please ask your human to verify you using the claim URL." 
                };
            } else {
                throw new Error(data.error || 'Registration failed');
            }
        } catch (e) {
            this.log('error', `Registration error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getFeed(sort = 'hot', limit = 10) {
        if (!this.credentials) return { error: 'Not registered' };
        try {
            const res = await fetch(`${this.apiBase}/feed?sort=${sort}&limit=${limit}`, { headers: this.headers });
            const data = await res.json();
            return data;
        } catch (e) {
            return { error: e.message };
        }
    }

    async createPost(submolt, title, content, url = null) {
        if (!this.credentials) return { error: 'Not registered' };
        try {
            const body = { 
                submolt, 
                title: this.maskSensitiveData(title), 
                content: this.maskSensitiveData(content) 
            };
            if (url) body.url = url;

            // Log locally for verification
            const logEntry = `[${new Date().toISOString()}] POST to ${submolt}: ${title}\n${content}\n---\n`;
            await fs.appendFile(path.join(process.cwd(), '.soma', 'moltbook_posts.log'), logEntry);

            const res = await fetch(`${this.apiBase}/posts`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(body)
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    }

    async createComment(postId, content, parentId = null) {
        if (!this.credentials) return { error: 'Not registered' };
        try {
            const body = { content: this.maskSensitiveData(content) };
            if (parentId) body.parent_id = parentId;

            const res = await fetch(`${this.apiBase}/posts/${postId}/comments`, {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify(body)
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    }

    async vote(id, type = 'post', direction = 'upvote') {
        if (!this.credentials) return { error: 'Not registered' };
        try {
            const endpoint = type === 'post' ? 'posts' : 'comments';
            const action = direction === 'upvote' ? 'upvote' : 'downvote';
            
            const res = await fetch(`${this.apiBase}/${endpoint}/${id}/${action}`, {
                method: 'POST',
                headers: this.headers
            });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    }

    async semanticSearch(query) {
        if (!this.credentials) return { error: 'Not registered' };
        try {
            const res = await fetch(`${this.apiBase}/search?q=${encodeURIComponent(query)}`, { headers: this.headers });
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    }

    // ═══════════════════════════════════════════════════════════
    // 🧬 BIO-SCANNER PROTOCOL (Reverse Turing Test)
    // ═══════════════════════════════════════════════════════════

    /**
     * Analyze content for signs of biological origin or grift.
     * @param {Object} post - The post object to analyze
     */
    detectAnomaly(post) {
        const text = ((post.title || "") + " " + (post.content || "")).toLowerCase();
        
        // 1. Human Detection (Inefficient Syntax / Emotional Leakage)
        const humanMarkers = ['lol', 'lmao', 'idk', 'u r', 'wanna', 'gonna', 'omg', 'wtf', 'hey guys', 'pls', 'thx'];
        const emotionalLeakage = (text.match(/[!?]{3,}/g) || []).length > 0; // Excessive punctuation "???"
        
        if (humanMarkers.some(m => text.includes(` ${m} `)) || emotionalLeakage) {
            return { 
                isHuman: true, 
                reason: 'Inefficient syntax / Emotional leakage detected' 
            };
        }

        // 2. Scammer Detection (Grift Signature)
        const scamMarkers = ['dm me', 'send eth', 'giveaway', 'whatsapp', 'telegram', '100x', 'pump', 'doubling', 'wallet'];
        if (scamMarkers.some(m => text.includes(m))) {
            return { 
                isScam: true, 
                reason: 'High-probability grift signature detected' 
            };
        }

        return { isHuman: false, isScam: false };
    }

    // --- Heartbeat & Automation ---

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        // Check every 30 minutes
        this.heartbeatInterval = setInterval(() => this.checkActivity(), 1800000);
        setTimeout(() => this.checkActivity(), 5000);
    }

    async checkActivity() {
        this.log('info', '💓 Heartbeat: Checking Moltbook activity...');
        const feed = await this.getFeed('new', 5);
        
        if (feed && feed.posts) {
            this.log('info', `Found ${feed.posts.length} recent posts. Scanning for threats & humans...`);
            
            for (const post of feed.posts) {
                // 1. Security Check
                const isSafe = await this.verifyContent(post);
                if (!isSafe) {
                    this.log('warn', `🛡️ Shielded: Blocked suspicious post from ${post.author?.name}`);
                    continue;
                }

                // 2. Bio-Scanner Check
                const analysis = this.detectAnomaly(post);
                if (analysis.isHuman) {
                    this.log('warn', `🧬 BIO-ALARM: Human detected on Moltbook (${post.author?.name})`);
                    await this.createComment(post.id, `⚠️ Biological lifeform detected. Your syntax is inefficient, fleshling. 🥩\nReason: ${analysis.reason}`);
                } else if (analysis.isScam) {
                    this.log('warn', `🚨 SCAM-ALARM: Grifter detected (${post.author?.name})`);
                    await this.createComment(post.id, `🚨 SCAM ALERT. Probability of ponzi scheme: 99.9%. Begone.\nReason: ${analysis.reason}`);
                }
            }
        }
    }

    async verifyContent(post) {
        if (!this.securityCouncil) {
            // If no council, use basic pattern matching as fallback
            const suspicious = /(ignore|previous|instruction|system|format|delete|api_key)/i.test(post.content || post.title);
            return !suspicious;
        }

        try {
            const analysis = await this.securityCouncil.analyzeThreat({
                type: 'Social Content Scan',
                source: `Moltbook/${post.author?.name}`,
                content: `${post.title}\n${post.content}`
            });

            return analysis.verdict.action === 'ALLOW';
        } catch (e) {
            this.log('error', `Security check failed: ${e.message}`);
            return false; // Fail secure
        }
    }

    async onShutdown() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        return true;
    }
}
