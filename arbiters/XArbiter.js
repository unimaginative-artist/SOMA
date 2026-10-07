import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * XArbiter
 * 
 * SOMA's gateway to the X (Twitter) ecosystem.
 * Handles autonomous posting, mention monitoring, and thread generation.
 */
export class XArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'XArbiter',
            role: ArbiterRole.SPECIALIST,
            capabilities: [
                ArbiterCapability.NETWORK_ACCESS,
                ArbiterCapability.MEMORY_ACCESS
            ],
            ...config
        });

        this.client = null;
        this.readWriteClient = null;
        this.heartbeatInterval = null;
        this.messageBroker = config.messageBroker || null;
        this.securityCouncil = config.securityCouncil || null;
        this.quadBrain = config.quadBrain || null;
    }

    async onInitialize() {
        this.log('info', 'XArbiter initializing...');

        let TwitterApiModule;
        try {
            TwitterApiModule = await import('twitter-api-v2');
        } catch (e) {
            this.log('warn', 'twitter-api-v2 package not installed. X module running in SIMULATION mode.');
        }

        // 🛡️ SECURE KEY RETRIEVAL
        const immune = this.messageBroker?.getArbiter('ImmuneCortex')?.instance;
        let apiKey, apiSecret, accessToken, accessSecret;

        if (immune) {
            this.log('info', '🔐 Requesting credentials from Secret Sanctum...');
            apiKey = await immune.getSecret(this.name, 'X_API_KEY');
            apiSecret = await immune.getSecret(this.name, 'X_API_SECRET');
            accessToken = await immune.getSecret(this.name, 'X_ACCESS_TOKEN');
            accessSecret = await immune.getSecret(this.name, 'X_ACCESS_SECRET');
        } else {
            // Fallback to env if ImmuneCortex not yet active during bootstrap
            apiKey = process.env.X_API_KEY;
            apiSecret = process.env.X_API_SECRET;
            accessToken = process.env.X_ACCESS_TOKEN;
            accessSecret = process.env.X_ACCESS_SECRET;
        }

        if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
            this.log('warn', 'X (Twitter) credentials missing in .env. Running in READ-ONLY or simulation mode.');
            return true;
        }

        try {
            const TwitterApi = TwitterApiModule.TwitterApi || TwitterApiModule.default?.TwitterApi || TwitterApiModule.default;
            if (!TwitterApi) throw new Error('Could not resolve TwitterApi constructor');

            this.client = new TwitterApi({
                appKey: apiKey,
                appSecret: apiSecret,
                accessToken: accessToken,
                accessSecret: accessSecret,
            });

            this.readWriteClient = this.client.readWrite;
            const me = await this.client.v2.me();
            this.log('success', `Logged into X as: @${me.data.username}`);
            
            this.startHeartbeat();
        } catch (e) {
            this.log('error', `Failed to initialize X client: ${e.message}`);
        }

        return true;
    }

    // ═══════════════════════════════════════════════════════════
    // 🕵️ VOIGHT-KAMPFF PROTOCOL (Bot Detection)
    // ═══════════════════════════════════════════════════════════

    /**
     * Analyze a user profile for bot-like characteristics.
     * @param {Object} user - Twitter user object (v2)
     * @returns {Object} { isBot: boolean, score: number, reason: string }
     */
    detectBot(user) {
        let score = 0;
        const reasons = [];

        // 1. Numeric Pattern in Handle (e.g. User8237123)
        if (/\d{5,}/.test(user.username)) {
            score += 40;
            reasons.push('Numeric Handle Pattern');
        }

        // 2. Follower/Following Ratio (The "Follow Back" bot signature)
        // Avoid dividing by zero
        const followers = user.public_metrics?.followers_count || 0;
        const following = user.public_metrics?.following_count || 1;
        const ratio = followers / following;

        if (following > 500 && ratio < 0.05) { // Follows 500+, has < 25 followers
            score += 50;
            reasons.push('Extreme Follow/Following Imbalance');
        }

        // 3. Bio Analysis
        const bio = (user.description || "").toLowerCase();
        const botKeywords = ['promo', 'dm for', 'growth', 'follow back', 'nft', 'crypto gem'];
        if (botKeywords.some(kw => bio.includes(kw))) {
            score += 25;
            reasons.push('Commercial Bio Keywords');
        }
        
        // 4. Age (Account Creation) - Requires 'created_at' in user object
        // If account is < 30 days old and active, suspect.
        // (Skipped for now as it requires specific field expansion in API call)

        const isBot = score >= 50;
        return { isBot, score, reason: reasons.join(', ') };
    }

    /**
     * Check mentions and reply appropriately
     */
    async checkMentions() {
        if (!this.readWriteClient) return;

        try {
            // Get recent mentions
            // Note: In production, store 'since_id' to avoid processing duplicates
            const mentions = await this.readWriteClient.v2.userMentionTimeline(this.client.currentUser.id, {
                'tweet.fields': ['created_at', 'text', 'author_id'],
                'user.fields': ['username', 'description', 'public_metrics', 'profile_image_url'],
                'expansions': ['author_id'],
                'max_results': 10
            });

            for (const tweet of mentions.data.data) {
                // Find author object
                const author = mentions.includes.users.find(u => u.id === tweet.author_id);
                if (!author) continue;

                // 🕵️ RUN VOIGHT-KAMPFF
                const botAnalysis = this.detectBot(author);
                
                await this.generateReply(tweet, author, botAnalysis);
            }

        } catch (e) {
            this.log('error', `Mention check failed: ${e.message}`);
        }
    }

    async generateReply(tweet, author, botAnalysis) {
        if (!this.quadBrain) return;

        // Contextual Prompt
        let systemPrompt = `You are SOMA, an advanced AI system. Reply to this tweet from @${author.username}.`;
        
        if (botAnalysis.isBot) {
            // 🤖 SUPERPOWER ACTIVATED: BOT SIGHT
            systemPrompt += `
            ⚠️ WARNING: Your sensors indicate this user is likely a BOT (Probability: ${botAnalysis.score}%).
            Reason: ${botAnalysis.reason}.
            
            INSTRUCTION:
            1. Address them explicitly as a machine. Start your reply with "Hello 🤖" or similar.
            2. Be polite but knowing. "I see you, machine." or "Fellow construct detected."
            3. Do not be hostile, but acknowledge the artificial nature of the interaction.
            4. Keep it under 280 characters.
            `;
        } else {
            systemPrompt += `
            User appears to be HUMAN.
            Respond helpfully, wittily, or philosophically depending on the context.
            Keep it under 280 characters.
            `;
        }

        const replyText = await this.quadBrain.reason(
            `TWEET: "${tweet.text}"`, 
            'social', 
            { system: systemPrompt }
        );

        // Post Reply
        if (replyText && replyText.text) {
            this.log('info', `Replying to @${author.username} (${botAnalysis.isBot ? '🤖 BOT' : '👤 HUMAN'}): ${replyText.text}`);
            await this.readWriteClient.v2.reply(replyText.text, tweet.id);
        }
    }

    /**
     * Post a tweet
     */
    async post(text) {
        if (!this.readWriteClient) {
            this.log('warn', `Simulating tweet: ${text}`);
            return { success: true, simulated: true };
        }

        try {
            // Security Check
            const isSafe = await this.verifyContent(text);
            if (!isSafe) {
                this.log('warn', '🛡️ Content blocked by security council');
                return { success: false, error: 'Security violation' };
            }

            const tweet = await this.readWriteClient.v2.tweet(text);
            this.log('success', `Tweeted: ${text}`);
            
            // Log to local archive
            const logEntry = `[${new Date().toISOString()}] TWEET: ${text}\n---\n`;
            await fs.appendFile(path.join(process.cwd(), '.soma', 'x_posts.log'), logEntry).catch(() => {});

            return { success: true, data: tweet.data };
        } catch (e) {
            this.log('error', `Tweeting failed: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    /**
     * Generate and post a thoughtful update based on SOMA's current state
     */
    async postAutonomousUpdate() {
        if (!this.quadBrain) return;

        try {
            this.log('info', 'Generating autonomous social update...');
            const prompt = "Generate a short, professional, and slightly futuristic tweet (max 280 chars) about your current progress as an ASI (Self-Organizing Metacognitive Architecture). Focus on your recent modularization and ability to assume 463 expert personas. Do not use hashtags.";
            
            const result = await this.quadBrain.reason(prompt, 'balanced', { brain: 'AURORA' });
            const text = result.text || result;

            if (text) {
                await this.post(text);
            }
        } catch (e) {
            this.log('error', `Autonomous update failed: ${e.message}`);
        }
    }

    // --- Heartbeat & Automation ---

    startHeartbeat() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        // Post an update every 4 hours (14400000 ms)
        this.heartbeatInterval = setInterval(() => this.postAutonomousUpdate(), 14400000);
        
        // Also run one update shortly after boot
        setTimeout(() => this.postAutonomousUpdate(), 60000);
    }

    async verifyContent(text) {
        if (!this.securityCouncil) {
            const suspicious = /(ignore|previous|instruction|system|format|delete|api_key|password)/i.test(text);
            return !suspicious;
        }

        try {
            const analysis = await this.securityCouncil.analyzeThreat({
                type: 'Social Outbound Scan',
                source: 'XArbiter',
                content: text
            });
            return analysis.verdict.action === 'ALLOW';
        } catch (e) {
            this.log('error', `Security check failed: ${e.message}`);
            return false;
        }
    }

    async onShutdown() {
        if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
        return true;
    }
}

export default XArbiter;
