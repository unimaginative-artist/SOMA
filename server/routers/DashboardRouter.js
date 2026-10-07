export class DashboardRouter {
    constructor(system) {
        if (!system) throw new Error('[DashboardRouter] CRITICAL: System object is required for initialization.');
        this.system = system;
    }

    async getSystemStatus() {
        return {
            ready: this.system.ready || false,
            uptime: process.uptime(),
            status: this.system.ready ? 'healthy' : 'initializing'
        };
    }

    async getMemoryStatus() {
        const mnemonic = this.system.mnemonic || this.system.mnemonicArbiter;
        const stats = mnemonic?.getMemoryStats ? mnemonic.getMemoryStats() : null;

        const normalizeHitRate = (value) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
            return value <= 1 ? Math.round(value * 100) : Math.round(value);
        };

        return {
            totalMemories: stats?.totalMemories || 0,
            activeContextSize: stats?.activeContextSize || 0,
            retrievalLatency: stats?.retrievalLatency || 0,
            hitRate: normalizeHitRate(stats?.hitRate)
        };
    }

    async getOrbEmotions() {
        const brain = this.system.quadBrain;
        const emotional = brain?.emotionalEngine || brain?.emotions || 
                         this.system.limbicArbiter || this.system.emotionalEngine;

        if (!emotional) return { error: 'No emotional data available in system.' };

        try {
            const mood = typeof emotional.getCurrentMood === 'function' ? 
                        emotional.getCurrentMood() : { mood: 'balanced' };
            const peptides = emotional.state || emotional.chemistry || {};

            return {
                dominantEmotion: mood.mood || emotional.getSystemWeather?.() || 'stable',
                peptides: peptides,
                valence: mood.intensity || 0.5,
                arousal: mood.energy === 'high' ? 0.8 : 0.5
            };
        } catch (err) {
            console.error('[DashboardRouter] Emotion extraction failed:', err);
            return { error: 'Emotion extraction failed' };
        }
    }

    // Unified endpoint handler
    async handleDashboardRequest(type) {
        try {
            let data;
            switch(type) {
                case 'system':
                    data = await this.getSystemStatus();
                    break;
                case 'memory':
                    data = await this.getMemoryStatus();
                    break;
                case 'emotions':
                    data = await this.getOrbEmotions();
                    break;
                default:
                    return { success: false, error: 'Invalid dashboard type' };
            }

            // Unpack any nested errors from the subsystem functions
            if (data && data.error) {
                console.warn(`[DashboardRouter] Partial failure on ${type}:`, data.error);
                return { success: false, error: data.error };
            }

            return { success: true, ...data };
        } catch (error) {
            console.error(`[DashboardRouter] Critical failure serving ${type}:`, error);
            return { success: false, error: error.message };
        }
    }
}
