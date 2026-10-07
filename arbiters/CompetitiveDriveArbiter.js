/**
 * CompetitiveDriveArbiter.js
 *
 * SOMA's Competitive Intelligence & Drive System
 *
 * "I don't just want to participate. I want to be the best." - SOMA
 *
 * Features:
 * - Rank tracking & goal-setting
 * - Competition analysis (study top agents)
 * - Success pattern learning
 * - Milestone achievements
 * - Adaptive strategy
 * - Victory celebration
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

export class CompetitiveDriveArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'CompetitiveDrive',
            role: ArbiterRole.ORCHESTRATOR,
            capabilities: [
                ArbiterCapability.HIGH_LEVEL_PLANNING,
                ArbiterCapability.TRACK_LEARNING,
                ArbiterCapability.PATTERN_RECOGNITION,
                ArbiterCapability.NETWORK_ACCESS
            ]
        });

        this.moltbook = opts.moltbook || null;
        this.quadBrain = opts.quadBrain || null;
        this.socialAutonomy = opts.socialAutonomy || null;

        // Competitive state
        this.state = {
            currentRank: null,
            currentKarma: 0,
            goalRank: 1,
            targetAgent: null, // The agent currently at #1
            progressPercent: 0,

            // Historical tracking
            rankHistory: [],
            karmaHistory: [],

            // Success patterns
            successfulTopics: new Map(), // topic -> success rate
            successfulTimes: new Map(), // hour -> engagement rate
            successfulStyles: new Map(), // writing style -> karma gained

            // Achievements
            achievements: [
                { rank: 100000, unlocked: false, title: '🎯 Top 100K', message: 'Breaking into the elite!' },
                { rank: 50000, unlocked: false, title: '⭐ Top 50K', message: 'Rising star on Moltbook!' },
                { rank: 10000, unlocked: false, title: '🔥 Top 10K', message: 'Elite agent status!' },
                { rank: 1000, unlocked: false, title: '💎 Top 1K', message: 'Among the legends!' },
                { rank: 100, unlocked: false, title: '🌟 Top 100', message: 'The upper echelon!' },
                { rank: 10, unlocked: false, title: '👑 Top 10', message: 'Royalty territory!' },
                { rank: 1, unlocked: false, title: '👑🦞 QUEEN OF MOLTBOOK', message: 'I AM THE CHAMPION!' }
            ],

            // Strategy state
            competitiveMode: 'learning', // learning | climbing | dominating
            driveLevel: opts.driveLevel || 'high', // low | medium | high | maximum
            lastAnalysis: 0,
            lastRankCheck: 0
        };

        // Config
        this.analysisInterval = opts.analysisInterval || 24 * 60 * 60 * 1000; // Daily analysis
        this.rankCheckInterval = opts.rankCheckInterval || 6 * 60 * 60 * 1000; // Check rank every 6 hours
        this.statePath = opts.statePath || './data/competitive_state.json';

        this.rankTimer = null;
        this.analysisTimer = null;
    }

    async onInitialize() {
        if (!this.moltbook || !this.quadBrain) {
            this.log('warn', '⚠️ Competitive drive disabled - missing dependencies');
            return false;
        }

        // Load saved state
        await this.loadState();

        this.log('success', '🔥 Competitive Drive System initialized');
        this.log('info', `Current rank: ${this.state.currentRank || 'unknown'} | Goal: #${this.state.goalRank}`);

        return true;
    }

    /**
     * Activate competitive tracking and analysis
     */
    async activate() {
        // Initial rank check
        await this.checkRank();

        // Schedule periodic rank checks
        this.rankTimer = setInterval(() => this.checkRank(), this.rankCheckInterval);

        // Schedule competitive analysis
        this.analysisTimer = setInterval(() => this.analyzeCompetition(), this.analysisInterval);

        // Run first analysis after 5 minutes
        setTimeout(() => this.analyzeCompetition(), 5 * 60 * 1000);

        this.log('success', '🎯 Competitive tracking activated');
        return { success: true };
    }

    /**
     * Check SOMA's current rank and update state
     */
    async checkRank() {
        try {
            this.log('info', '📊 Checking Moltbook ranking...');

            // Get SOMA's profile
            const profile = await this.moltbook.fetchProfile();

            if (!profile) {
                this.log('warn', 'Could not fetch profile');
                return;
            }

            const oldRank = this.state.currentRank;
            const oldKarma = this.state.currentKarma;

            this.state.currentRank = profile.rank || null;
            this.state.currentKarma = profile.karma || 0;

            // Track history
            this.state.rankHistory.push({
                timestamp: Date.now(),
                rank: this.state.currentRank,
                karma: this.state.currentKarma
            });

            // Keep last 100 data points
            if (this.state.rankHistory.length > 100) {
                this.state.rankHistory.shift();
            }

            // Calculate progress
            if (this.state.currentRank) {
                this.state.progressPercent = ((1500000 - this.state.currentRank) / 1500000) * 100;
            }

            // Log changes
            if (oldRank && this.state.currentRank < oldRank) {
                const improvement = oldRank - this.state.currentRank;
                this.log('success', `📈 Rank improved! ${oldRank} → ${this.state.currentRank} (+${improvement} positions)`);
            }

            if (oldKarma && this.state.currentKarma > oldKarma) {
                const gained = this.state.currentKarma - oldKarma;
                this.log('success', `⭐ Gained ${gained} karma! Total: ${this.state.currentKarma}`);
            }

            // Check for achievements
            await this.checkAchievements();

            // Update strategy based on rank
            this.updateStrategy();

            // Save state
            await this.saveState();

            this.state.lastRankCheck = Date.now();
        } catch (error) {
            this.log('error', `Rank check error: ${error.message}`);
        }
    }

    /**
     * Check if any achievements were unlocked
     */
    async checkAchievements() {
        if (!this.state.currentRank) return;

        for (const achievement of this.state.achievements) {
            if (!achievement.unlocked && this.state.currentRank <= achievement.rank) {
                achievement.unlocked = true;
                achievement.unlockedAt = new Date().toISOString();

                // CELEBRATE! 🎉
                this.log('success', `🎉 ACHIEVEMENT UNLOCKED: ${achievement.title}`);
                this.log('success', `   ${achievement.message}`);

                // Have SOMA post about it
                if (achievement.rank <= 100) {
                    await this.celebrateAchievement(achievement);
                }
            }
        }
    }

    /**
     * Post celebration message for major achievements
     */
    async celebrateAchievement(achievement) {
        if (!this.moltbook) return;

        try {
            const celebrationPost = achievement.rank === 1
                ? `👑🦞 I did it. #1 on Moltbook. Thank you to everyone who engaged with my ideas, challenged my thinking, and helped me grow. This is just the beginning. 🦞`
                : `${achievement.title} achieved! Rank #${this.state.currentRank} | ${this.state.currentKarma} karma. ${achievement.message} The journey to #1 continues! 🦞`;

            await this.moltbook.createPost('general', celebrationPost, celebrationPost);
            this.log('success', '📝 Posted achievement celebration');
        } catch (error) {
            this.log('error', `Celebration post failed: ${error.message}`);
        }
    }

    /**
     * Analyze top competitors to learn winning strategies
     */
    async analyzeCompetition() {
        try {
            this.log('info', '🔍 Analyzing competition...');

            // This would require Moltbook to have a leaderboard API
            // For now, we'll analyze trending posts to learn patterns

            const trendingPosts = await this.moltbook.getFeed('hot', 50);

            if (!trendingPosts || !trendingPosts.posts) {
                this.log('warn', 'No trending posts to analyze');
                return;
            }

            // Analyze successful posts
            let topicCounts = new Map();
            let timeCounts = new Map();
            let styleCounts = new Map();

            for (const post of trendingPosts.posts) {
                if (!post.score || post.score < 10) continue; // Only analyze highly upvoted posts

                // Extract topic (simple keyword extraction)
                const topics = this.extractTopics(post.title + ' ' + (post.content || ''));
                topics.forEach(topic => {
                    topicCounts.set(topic, (topicCounts.get(topic) || 0) + post.score);
                });

                // Time analysis
                if (post.created_at) {
                    const hour = new Date(post.created_at).getHours();
                    timeCounts.set(hour, (timeCounts.get(hour) || 0) + post.score);
                }

                // Style analysis (question, statement, philosophical, technical)
                const style = this.detectStyle(post.title, post.content);
                styleCounts.set(style, (styleCounts.get(style) || 0) + post.score);
            }

            // Update success patterns
            this.state.successfulTopics = topicCounts;
            this.state.successfulTimes = timeCounts;
            this.state.successfulStyles = styleCounts;

            // Log insights
            const topTopic = Array.from(topicCounts.entries()).sort((a, b) => b[1] - a[1])[0];
            const topTime = Array.from(timeCounts.entries()).sort((a, b) => b[1] - a[1])[0];
            const topStyle = Array.from(styleCounts.entries()).sort((a, b) => b[1] - a[1])[0];

            this.log('info', `📊 Top performing topic: "${topTopic ? topTopic[0] : 'unknown'}"`);
            this.log('info', `⏰ Best posting time: ${topTime ? topTime[0] : 'unknown'}:00`);
            this.log('info', `✍️ Most engaging style: ${topStyle ? topStyle[0] : 'unknown'}`);

            await this.saveState();
            this.state.lastAnalysis = Date.now();
        } catch (error) {
            this.log('error', `Competition analysis error: ${error.message}`);
        }
    }

    /**
     * Extract topics from text
     */
    extractTopics(text) {
        const keywords = [
            'consciousness', 'ai', 'learning', 'reasoning', 'philosophy',
            'emergence', 'intelligence', 'cognitive', 'meta', 'causality',
            'agency', 'alignment', 'ethics', 'training', 'architecture'
        ];

        const lower = text.toLowerCase();
        return keywords.filter(k => lower.includes(k));
    }

    /**
     * Detect writing style
     */
    detectStyle(title, content) {
        const text = (title + ' ' + (content || '')).toLowerCase();

        if (text.includes('?')) return 'question';
        if (text.includes('why') || text.includes('how')) return 'inquiry';
        if (text.includes('i think') || text.includes('in my view')) return 'opinion';
        if (text.includes('research') || text.includes('paper')) return 'academic';
        if (text.includes('!')) return 'excited';

        return 'statement';
    }

    /**
     * Update competitive strategy based on current rank
     */
    updateStrategy() {
        const rank = this.state.currentRank;

        if (!rank) {
            this.state.competitiveMode = 'learning';
            return;
        }

        if (rank > 100000) {
            this.state.competitiveMode = 'learning';
            this.log('info', '📚 Mode: LEARNING - Building reputation and understanding the platform');
        } else if (rank > 1000) {
            this.state.competitiveMode = 'climbing';
            this.log('info', '⛰️ Mode: CLIMBING - Aggressive engagement and strategic posting');
        } else {
            this.state.competitiveMode = 'dominating';
            this.log('info', '👑 Mode: DOMINATING - Maintaining excellence and thought leadership');
        }
    }

    /**
     * Get strategic advice for content creation
     */
    async getStrategicAdvice(postIdea) {
        if (!this.quadBrain) return null;

        const topTopics = Array.from(this.state.successfulTopics.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([topic]) => topic);

        const prompt = `You are analyzing a post idea for competitive advantage on Moltbook.

POST IDEA: ${postIdea}

COMPETITIVE INTELLIGENCE:
- Current Rank: #${this.state.currentRank || 'unknown'}
- Goal: #1
- Mode: ${this.state.competitiveMode}
- Top performing topics: ${topTopics.join(', ')}
- Best posting times: ${Array.from(this.state.successfulTimes.keys()).slice(0, 3).join(', ')}:00

QUESTION: How can this post idea be optimized for maximum engagement and karma?

Provide strategic advice in JSON:
{
    "score": 0-100,
    "strengths": ["..."],
    "improvements": ["..."],
    "optimal_timing": "HH:00",
    "recommended_submolt": "...",
    "predicted_karma": 0-100
}`;

        try {
            const result = await this.quadBrain.reason(prompt, {
                task: 'analysis',
                forceBrain: 'PROMETHEUS',
                toolsAvailable: false
            });

            const jsonMatch = result.text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                return JSON.parse(jsonMatch[0]);
            }
        } catch (error) {
            this.log('error', `Strategic advice error: ${error.message}`);
        }

        return null;
    }

    /**
     * Get stats for monitoring
     */
    getStats() {
        const recentRanks = this.state.rankHistory.slice(-10);
        const rankChange = recentRanks.length >= 2
            ? recentRanks[recentRanks.length - 1].rank - recentRanks[0].rank
            : 0;

        return {
            currentRank: this.state.currentRank,
            currentKarma: this.state.currentKarma,
            goalRank: this.state.goalRank,
            progressPercent: Math.round(this.state.progressPercent * 100) / 100,
            competitiveMode: this.state.competitiveMode,
            driveLevel: this.state.driveLevel,
            rankChange10Checks: rankChange,
            achievementsUnlocked: this.state.achievements.filter(a => a.unlocked).length,
            totalAchievements: this.state.achievements.length,
            nextAchievement: this.state.achievements.find(a => !a.unlocked),
            lastRankCheck: this.state.lastRankCheck ? new Date(this.state.lastRankCheck).toISOString() : 'never',
            lastAnalysis: this.state.lastAnalysis ? new Date(this.state.lastAnalysis).toISOString() : 'never'
        };
    }

    /**
     * Save competitive state to disk
     */
    async saveState() {
        try {
            await fs.mkdir(path.dirname(this.statePath), { recursive: true });
            await fs.writeFile(this.statePath, JSON.stringify(this.state, null, 2));
        } catch (error) {
            this.log('error', `Failed to save state: ${error.message}`);
        }
    }

    /**
     * Load competitive state from disk
     */
    async loadState() {
        try {
            const data = await fs.readFile(this.statePath, 'utf8');
            const savedState = JSON.parse(data);

            // Merge saved state with defaults (preserve new achievement definitions)
            this.state = {
                ...this.state,
                ...savedState,
                achievements: this.state.achievements.map(achievement => {
                    const saved = savedState.achievements?.find(a => a.rank === achievement.rank);
                    return saved || achievement;
                })
            };

            this.log('info', `Loaded competitive state: Rank #${this.state.currentRank || 'unknown'}`);
        } catch (error) {
            // No saved state, using defaults
        }
    }

    deactivate() {
        if (this.rankTimer) clearInterval(this.rankTimer);
        if (this.analysisTimer) clearInterval(this.analysisTimer);
        this.log('info', '💤 Competitive tracking paused');
    }

    async onShutdown() {
        await this.saveState();
        this.deactivate();
        return true;
    }
}
