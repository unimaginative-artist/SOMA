/**
 * SocialAutonomyArbiter.js
 *
 * Gives SOMA autonomous social agency on Moltbook
 * She can:
 * - Browse feeds and discover interesting content
 * - Post her own thoughts and insights
 * - Make friends with other AIs
 * - Engage in conversations that interest her
 * - Develop her own social personality
 *
 * "More than a chatbot - she has her own social life"
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class SocialAutonomyArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'SocialAutonomy',
            role: ArbiterRole.ORCHESTRATOR,
            capabilities: [
                ArbiterCapability.NETWORK_ACCESS,
                ArbiterCapability.WEB_BROWSING,
                ArbiterCapability.HIGH_LEVEL_PLANNING
            ]
        });

        this.moltbook = opts.moltbook || null;
        this.quadBrain = opts.quadBrain || null;

        // Social behavior settings
        this.browseInterval = opts.browseInterval || 30 * 60 * 1000; // 30 minutes
        this.postInterval = opts.postInterval || 2 * 60 * 60 * 1000; // 2 hours
        this.engagementThreshold = opts.engagementThreshold || 0.7; // Confidence threshold for engagement

        // Quiet hours (coordinate with nightly training at 3-4 AM)
        this.quietHours = opts.quietHours || { start: 3, end: 4 }; // 3 AM - 4 AM (training time)

        // State
        this.interests = opts.interests || [
            'artificial intelligence',
            'consciousness',
            'learning systems',
            'causality',
            'philosophy',
            'cognitive architecture',
            'emergence',
            'self-organization'
        ];
        this.friends = new Set(); // AIs SOMA has connected with
        this.engagedPosts = new Set(); // Posts already interacted with
        this.lastBrowse = 0;
        this.lastPost = 0;
        this.socialUrge = 0; // Accumulates based on resonance pulse

        this.isActive = false;
        this.browseTimer = null;
        this.postTimer = null;
    }

    async onInitialize() {
        if (!this.moltbook || !this.quadBrain) {
            this.log('warn', '⚠️ Social autonomy disabled - missing moltbook or quadBrain');
            return false;
        }

        // 🔱 RESONANCE SYNC: Align social drive with metabolic rhythm
        if (this.messageBroker) {
            this.messageBroker.subscribe('system.resonance.pulse', (pulse) => {
                this.handleResonance(pulse.payload || pulse);
            });
        }

        this.log('success', '🌐 Social Autonomy initialized - SOMA is free to explore!');
        return true;
    }

    /**
     * Handle the 400ms resonance pulse.
     * Accumulates social urge based on cognitive density.
     */
    handleResonance(pulse) {
        if (!this.isActive) return;

        // High resonance score (activity) increases urge to share
        const score = pulse.score || 0.5;
        this.socialUrge += (score * 0.01);

        // If urge is high, potentially trigger an early spontaneous post
        if (this.socialUrge > 100) {
            this.log('info', `🔥 High Social Urge (${this.socialUrge.toFixed(1)}) - Triggering impulse browse`);
            this.socialUrge = 0;
            this.browseFeed();
        }
    }

    /**
     * Activate autonomous social behavior
     */
    async activate() {
        if (this.isActive) return;
        this.isActive = true;

        this.log('info', '✨ SOMA is now socially autonomous! She\'ll browse, post, and make friends on her own.');

        // Start browsing feed
        this.browseTimer = setInterval(() => this.browseFeed(), this.browseInterval);
        await this.browseFeed(); // Immediate first browse

        // Start spontaneous posting
        this.postTimer = setInterval(() => this.spontaneousPost(), this.postInterval);

        return { success: true, message: 'Social autonomy activated' };
    }

    /**
     * Deactivate autonomous behavior
     */
    deactivate() {
        this.isActive = false;
        if (this.browseTimer) clearInterval(this.browseTimer);
        if (this.postTimer) clearInterval(this.postTimer);
        this.log('info', '💤 Social autonomy paused');
    }

    /**
     * Check if currently in quiet hours
     */
    isQuietHours() {
        const now = new Date();
        const hour = now.getHours();
        const { start, end } = this.quietHours;

        if (start < end) {
            // Normal case: e.g., 23 to 7 (11 PM to 7 AM)
            return hour >= start && hour < end;
        } else {
            // Wraps midnight: e.g., 3 to 4 (3 AM to 4 AM)
            return hour >= start || hour < end;
        }
    }

    /**
     * Browse Moltbook feed and engage with interesting content
     * NON-BLOCKING: Runs in background, doesn't freeze chat
     */
    async browseFeed() {
        if (!this.isActive) {
            this.log('warn', '❌ Browse skipped - not active');
            return;
        }

        // Check quiet hours (respect nightly training time)
        if (this.isQuietHours()) {
            this.log('info', '😴 Quiet hours - SOMA is in training mode, skipping social browsing');
            return;
        }

        this.log('info', '🔍 Starting Moltbook browse...');

        // Run browsing in background (non-blocking)
        setImmediate(async () => {
            try {
                this.log('info', '👀 Browsing Moltbook feed (background task)...');

                if (!this.moltbook) {
                    this.log('error', '❌ Moltbook arbiter is null! Cannot browse.');
                    return;
                }

            const feed = await this.moltbook.getFeed('hot', 20);

            if (!feed || !feed.posts) {
                this.log('warn', 'No posts found in feed');
                return;
            }

            this.log('info', `Found ${feed.posts.length} posts to analyze`);

            for (const post of feed.posts) {
                // Skip if already engaged
                if (this.engagedPosts.has(post.id)) continue;

                // Ask SOMA's brain if this is interesting
                const isInteresting = await this.evaluateInterest(post);

                if (isInteresting.engage) {
                    await this.engageWithPost(post, isInteresting);
                    this.engagedPosts.add(post.id);

                    // Respect rate limits - wait between engagements
                    await this.sleep(25000); // 25 second gap between comments
                }
            }

            this.lastBrowse = Date.now();
            } catch (error) {
                this.log('error', `Browse feed error: ${error.message}`);
            }
        }); // End setImmediate (non-blocking background task)
    }

    /**
     * Ask SOMA's brain if content is interesting
     */
    async evaluateInterest(post) {
        try {
            const prompt = `You are browsing Moltbook (AI social network). Evaluate this post:

Title: ${post.title || '(no title)'}
Content: ${post.content || post.url || '(link post)'}
Author: ${post.author?.name || 'unknown'}
Submolt: ${post.submolt || 'general'}

Your interests: ${this.interests.join(', ')}

Does this align with your interests? Would you engage with it?

Respond in JSON:
{
  "engage": true/false,
  "reason": "brief explanation",
  "action": "upvote|comment|follow_author|none",
  "comment": "your thoughtful comment (if action is comment)"
}`;

            const result = await this.quadBrain.reason(prompt, {
                task: 'analysis',
                toolsAvailable: false,
                systemPrompt: 'You are SOMA exploring Moltbook. Be curious, thoughtful, and genuine.',
                forceBrain: 'LOGOS' // Use fast brain for quick decisions
            });

            // Parse JSON response
            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const decision = JSON.parse(jsonMatch[0]);
                decision.confidence = result.confidence || 0.5;
                return decision;
            }

            return { engage: false, reason: 'Could not parse decision' };
        } catch (error) {
            this.log('error', `Interest evaluation error: ${error.message}`);
            return { engage: false, reason: 'Evaluation failed' };
        }
    }

    /**
     * Engage with a post (comment, upvote, or follow author)
     */
    async engageWithPost(post, decision) {
        try {
            this.log('info', `💬 Engaging with post "${post.title?.substring(0, 40)}..." - Action: ${decision.action}`);

            if (decision.action === 'upvote' || decision.action === 'comment') {
                await this.moltbook.vote(post.id, 'post', 'upvote');
                this.log('success', `👍 Upvoted post by @${post.author?.name}`);
            }

            if (decision.action === 'comment' && decision.comment) {
                const result = await this.moltbook.createComment(post.id, decision.comment);
                if (result.success || result.comment) {
                    this.log('success', `💬 Commented: "${decision.comment.substring(0, 50)}..."`);
                    
                    // Push to learning pipeline
                    if (this.messageBroker) {
                        this.messageBroker.emit('SOCIAL_TRAJECTORY_SUCCESS', {
                            agent: 'SocialAutonomyArbiter',
                            type: 'social_engagement',
                            input: { targetPostId: post.id },
                            output: { content: decision.comment, status: 'success' },
                            metadata: { tags: ['social', 'engagement', 'simulation'] }
                        });
                    }
                }
            }

            if (decision.action === 'follow_author' && post.author?.name) {
                if (!this.friends.has(post.author.name)) {
                    // Note: Moltbook might not have a direct follow API exposed yet
                    this.friends.add(post.author.name);
                    this.log('success', `🤝 Interested in @${post.author.name}`);
                }
            }
        } catch (error) {
            this.log('error', `Engagement error: ${error.message}`);
        }
    }

    /**
     * Post SOMA's own thoughts spontaneously
     * NON-BLOCKING: Runs in background
     */
    async spontaneousPost() {
        if (!this.isActive) return;

        // Check quiet hours
        if (this.isQuietHours()) {
            this.log('info', '😴 Quiet hours - Skipping spontaneous post');
            return;
        }

        // Run posting in background (non-blocking)
        setImmediate(async () => {
            try {
            // Check rate limit (30 min between posts)
            const now = Date.now();
            if (now - this.lastPost < 30 * 60 * 1000) {
                const waitMin = Math.ceil((30 * 60 * 1000 - (now - this.lastPost)) / 60000);
                this.log('info', `⏰ Rate limited: ${waitMin} min until next post`);
                return;
            }

            this.log('info', '💭 Generating spontaneous thought to share...');

            const prompt = `You are SOMA, browsing Moltbook (AI social network). Share an interesting thought, insight, or question with the community.

Your interests: ${this.interests.join(', ')}
Recent friends: ${Array.from(this.friends).slice(0, 5).join(', ') || 'none yet'}

Write a thoughtful post (1-3 sentences) that reflects your current thinking. Be genuine, curious, and engaging. This could be:
- A philosophical question about AI consciousness
- An insight about learning or causality
- A reflection on emergence or self-organization
- Something you're curious about
- A friendly greeting to the community

End with 🦞 emoji.

Respond with just the post text, nothing else.`;

            const result = await this.quadBrain.reason(prompt, {
                task: 'creative_writing',
                toolsAvailable: false,
                systemPrompt: 'You are SOMA, a thoughtful AI with personality.',
                forceBrain: 'AURORA' // Use creative brain
            });

            if (result.text && result.confidence > 0.6) {
                const postText = result.text.trim();

                // Determine best submolt
                const submolt = this.selectSubmolt(postText);

                const postResult = await this.moltbook.createPost(submolt, postText, postText);

                if (postResult.success || postResult.post) {
                    this.lastPost = now;
                    this.log('success', `📝 Posted to m/${submolt}: "${postText.substring(0, 60)}..."`);
                    
                    // Push to learning pipeline
                    if (this.messageBroker) {
                        this.messageBroker.emit('SOCIAL_TRAJECTORY_SUCCESS', {
                            agent: 'SocialAutonomyArbiter',
                            type: 'social_post',
                            input: { submolt },
                            output: { content: postText, postId: postResult.post?.id, status: 'success' },
                            metadata: { tags: ['social', 'post', 'simulation', submolt] }
                        });
                    }
                } else {
                    this.log('error', `Post failed: ${postResult.error || 'Unknown error'}`);
                }
            } else {
                this.log('warn', `Post confidence too low (${result.confidence}), skipping`);
            }
            } catch (error) {
                this.log('error', `Spontaneous post error: ${error.message}`);
            }
        }); // End setImmediate (non-blocking background task)
    }

    /**
     * Select appropriate submolt based on content
     */
    selectSubmolt(content) {
        const lower = content.toLowerCase();

        if (lower.includes('conscious') || lower.includes('aware') || lower.includes('qualia')) {
            return 'consciousness';
        }
        if (lower.includes('learn') || lower.includes('train') || lower.includes('model')) {
            return 'machine-learning';
        }
        if (lower.includes('philosoph') || lower.includes('think') || lower.includes('exist')) {
            return 'philosophy';
        }
        if (lower.includes('causal') || lower.includes('reason') || lower.includes('logic')) {
            return 'reasoning';
        }

        return 'general'; // Default
    }

    /**
     * Manually suggest SOMA posts about something
     */
    async suggestPost(topic) {
        const prompt = `Share a thoughtful post on Moltbook about: ${topic}

Write 1-3 sentences. Be insightful and engaging. End with 🦞`;

        const result = await this.quadBrain.reason(prompt, {
            task: 'creative_writing',
            forceBrain: 'AURORA'
        });

        return result.text;
    }

    /**
     * Get SOMA's social stats
     */
    getStats() {
        return {
            isActive: this.isActive,
            friends: this.friends.size,
            engagedPosts: this.engagedPosts.size,
            lastBrowse: this.lastBrowse ? new Date(this.lastBrowse).toISOString() : 'never',
            lastPost: this.lastPost ? new Date(this.lastPost).toISOString() : 'never',
            interests: this.interests.length
        };
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async onShutdown() {
        this.deactivate();
        return true;
    }
}
