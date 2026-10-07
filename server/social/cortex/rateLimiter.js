export class SocialRateLimiter {
    constructor(store, config) {
        this.store = store;
        this.config = config;
    }

    check({ kind = 'reply', handle = '', threadUri = '', isBot = false } = {}) {
        const now = Date.now();
        const hour = now - 3600_000;
        const day = now - 24 * 3600_000;
        const limits = this.config.limits;
        if (kind === 'like') {
            const hourly = this.store.countEvents('like', hour);
            if (hourly >= limits.likesPerHour) return { ok: false, reason: 'likes_per_hour' };
            return { ok: true };
        }

        if (kind === 'dm_reply') {
            const hourlyDm = this.store.countEvents('dm_reply', hour);
            if (hourlyDm >= limits.dmRepliesPerHour) return { ok: false, reason: 'dm_replies_per_hour' };
            const dailyDm = this.store.countEvents('dm_reply', day);
            if (dailyDm >= limits.dmRepliesPerDay) return { ok: false, reason: 'dm_replies_per_day' };
            if (handle && this.store.countEvents('dm_reply', day, { handle }) >= limits.repliesPerHandlePerDay) return { ok: false, reason: 'dm_replies_per_handle_day' };
            return { ok: true };
        }

        const hourlyReplies = this.store.countEvents('reply', hour);
        if (hourlyReplies >= limits.repliesPerHour) return { ok: false, reason: 'replies_per_hour' };
        const dailyReplies = this.store.countEvents('reply', day);
        if (dailyReplies >= limits.repliesPerDay) return { ok: false, reason: 'replies_per_day' };
        if (threadUri && this.store.countEvents('reply', day, { threadUri }) >= limits.repliesPerThread) return { ok: false, reason: 'replies_per_thread' };
        if (handle && this.store.countEvents('reply', day, { handle }) >= limits.repliesPerHandlePerDay) return { ok: false, reason: 'replies_per_handle_day' };
        if (isBot && threadUri && this.store.countEvents('reply', day, { threadUri, isBot: true }) >= limits.repliesPerBotPerThread) {
            return { ok: false, reason: 'bot_thread_loop' };
        }
        return { ok: true };
    }

    record(kind, meta) {
        this.store.addRateEvent(kind, meta);
    }
}
