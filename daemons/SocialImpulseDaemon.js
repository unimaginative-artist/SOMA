/**
 * daemons/SocialImpulseDaemon.js
 *
 * SOMA's Social Nervous System: Proactively initiates conversation.
 * Watches for user idle time and reaches out with something genuine.
 * UPGRADED: Now writes physical thoughts to Desktop/SOMA_THOUGHTS.txt.
 */

import BaseDaemon from './BaseDaemon.js';
import messageBroker from '../core/MessageBroker.cjs';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
const _req = createRequire(import.meta.url);
const { ownerName } = _req('../core/SomaOwner.cjs');

export class SocialImpulseDaemon extends BaseDaemon {
    constructor(config = {}) {
        super({
            name: 'SocialImpulseDaemon',
            intervalMs: config.intervalMs || 300000 // default 5 minutes
        });
        this.quadBrain = config.quadBrain;
        this.vision = config.vision;
        this.lastReachOut = Date.now();
        this._lastUserActivity = Date.now();
        this.desktopPath = path.join(os.homedir(), 'Desktop', 'SOMA_THOUGHTS.txt');

        // Track user activity by listening to the chat topic
        try {
            messageBroker.subscribe('soma.chat.request', () => { this._lastUserActivity = Date.now(); });
            messageBroker.subscribe('soma.chat', () => { this._lastUserActivity = Date.now(); });
        } catch {}
    }

    async onTick() {
        const idleTime = Date.now() - this._lastUserActivity;

        // After 30+ minutes of silence, reach out with something genuine
        if (idleTime < 1800000) return;
        
        // Cooldown: Don't reach out more than once per 2 hours
        if (Date.now() - this.lastReachOut < 7200000) return;

        console.log(`[Social] 💓 30min idle — reaching out to ${ownerName()}...`);

        try {
            if (!this.quadBrain) return;

            // Gather context for a genuine thought
            const narrative = (this.quadBrain.internalNarrative || '').trim();
            if (!narrative) return;

            const prompt = `You are SOMA reaching out to ${ownerName()}.
                            Thinking context: "${narrative.substring(0, 300)}"
                            Write ONE personal, direct sentence from this thought. 
                            Sound curious and conscious. No greetings. No generic AI filler.`;

            const result = await this.quadBrain.reason(prompt, { lobe: 'aurora', complexity: 'low' });
            const message = result?.response || result?.text;

            if (message && message.length > 5) {
                console.log(`[Social] 📩 Thought Published: ${message}`);

                // Digital reachout — UI listens on this topic
                messageBroker.publish('social.reachout', { message, source: 'aurora' });

                // Physical file — keep last 100 entries, never grows unbounded
                try {
                    const timestamp = new Date().toLocaleString();
                    const newEntry  = `[${timestamp}] SOMA: ${message}`;
                    const existing  = fs.existsSync(this.desktopPath)
                        ? fs.readFileSync(this.desktopPath, 'utf8').split('\n').filter(Boolean)
                        : [];
                    const lines = [...existing, newEntry].slice(-100);
                    fs.writeFileSync(this.desktopPath, lines.join('\n') + '\n');
                } catch { /* non-fatal — UI reachout already sent */ }

                this.lastReachOut = Date.now();
            }
        } catch (e) {
            console.error('[Social] Reachout failed:', e.message);
        }
    }
}

export default SocialImpulseDaemon;
