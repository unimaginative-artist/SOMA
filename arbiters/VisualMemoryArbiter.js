/**
 * arbiters/VisualMemoryArbiter.js
 *
 * Visual Memory — Organizes what SOMA sees into tagged, structured memories.
 *
 * Subscribes to vision.perceived signals and builds:
 *  - userPresenceModel: is the owner visible? confidence, last seen, typical location
 *  - environmentModel: what kind of space is this? desk, room type, recurring objects
 *
 * Saves tagged memories to MnemonicArbiter so SOMA can recall "I saw the owner at their
 * desk at 3pm working in their terminal" across sessions.
 *
 * Exposes:
 *  - getUserPresenceSummary()  → string SOMA can read for voice context
 *  - getEnvironmentSummary()   → string SOMA can read for voice context
 */

import SomaOwner from '../core/SomaOwner.cjs';

export class VisualMemoryArbiter {
    constructor(opts = {}) {
        this.name = 'VisualMemoryArbiter';
        this.messageBroker = opts.messageBroker || null;
        this.mnemonicArbiter = opts.mnemonicArbiter || null;
        this.visionArbiter = opts.visionArbiter || null;
        this.ownerName = opts.ownerName || SomaOwner.ownerName?.() || 'the owner';

        // User presence model
        this.userPresence = {
            detected: false,
            confidence: 0,
            lastSeenAt: null,
            consecutiveFrames: 0,
            typicalLocation: null  // 'desk', 'standing', etc.
        };

        // Environment model — running counts of what's seen
        this.environmentCounts = new Map(); // label → count
        this.environmentSamples = 0;
        this.detectedRoomType = null;

        // Rate limiting: only store memory snapshots, not every frame
        this._lastMemorySaveAt = 0;
        this._memorySaveIntervalMs = 5 * 60 * 1000; // every 5 min max

        // Visual diary — one-line log of each perception before frames are deleted.
        // Keeps a ring buffer of the last 50 entries, flushes oldest 10 to MnemonicArbiter
        // when full. No AI calls — just "3:14pm [desktop] saw: terminal, code editor".
        this._diaryBuffer = [];           // [{ text, timestamp }]
        this._diaryMaxEntries = 50;
        this._diaryFlushThreshold = 10;   // flush oldest N when buffer fills
        this._diaryPerceptionCount = 0;
        this._diaryLogEvery = 3;          // log every N perceptions (not every single frame)
        this._lastDiaryFlushAt = 0;

        // Proactive commentary gate
        this._lastProactiveAt = 0;
        this._proactiveIntervalMs = 60 * 1000; // max 1 per minute
        this._proactiveBrain = null; // set via setBrain()

        // Error detection for proactive commentary
        this._lastErrorSignalAt = 0;

        if (this.messageBroker) {
            this._subscribe();
        }

        console.log(`[VisualMemoryArbiter] 👁️🧠 Visual memory system initialized`);
    }

    setBrain(brain) {
        this._proactiveBrain = brain;
    }

    get mnemonic() {
        if (this._mnemonicInstance) return this._mnemonicInstance;
        if (this.mnemonicArbiter) {
            this._mnemonicInstance = this.mnemonicArbiter;
            return this._mnemonicInstance;
        }
        if (this.messageBroker) {
            const hippocampus = this.messageBroker.getArbiter('HippocampusArbiter')?.instance;
            if (hippocampus) {
                this._mnemonicInstance = hippocampus;
                return this._mnemonicInstance;
            }
            const mnemonic = this.messageBroker.getArbiter('Hippocampus-Mnemonic')?.instance ||
                             this.messageBroker.getArbiter('MnemonicArbiter')?.instance;
            if (mnemonic) {
                this._mnemonicInstance = mnemonic;
                return this._mnemonicInstance;
            }
        }
        return null;
    }

    _subscribe() {
        try {
            this.messageBroker.subscribe('vision.perceived', (envelope) => {
                const payload = envelope.payload || envelope;
                this._processPerception(payload).catch(e =>
                    console.warn('[VisualMemoryArbiter] processPerception error:', e.message)
                );
            });

            this.messageBroker.subscribe('vocal_synthesis_requested', (envelope) => {
                const payload = envelope.payload || envelope;
                this._processVocalSynthesis(payload).catch(e =>
                    console.warn('[VisualMemoryArbiter] processVocalSynthesis error:', e.message)
                );
            });
        } catch (e) {
            console.warn('[VisualMemoryArbiter] Failed to subscribe to required signals:', e.message);
        }
    }

    async _processVocalSynthesis(payload) {
        const { text, source, emotion } = payload;
        if (!text) return;

        const now = Date.now();
        const timeStr = new Date(now).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        
        // E.g. "SOMA voiced observation: "I noticed you're back at your desk. Hello!" (Source: vision-narrator) at 03:22 PM"
        const memoryContent = `SOMA voiced: "${text}" (Source: ${source || 'vocal-synthesis'}, Emotion: ${emotion || 'neutral'}) at ${timeStr}.`;

        if (this.mnemonic?.remember) {
            await this.mnemonic.remember(memoryContent, {
                type: 'vocal_synthesis',
                source: source || 'vocal-synthesis',
                emotion: emotion || 'neutral',
                timestamp: now
            });
            console.log(`[VisualMemoryArbiter] 🧠 Saved vocal synthesis output to memory: "${text}"`);
        }
    }

    async _processPerception(payload) {
        const { channel, analysis, imagePath, timestamp } = payload;
        if (!analysis?.objects?.length) return;

        const objects = analysis.objects;
        const labels = objects.map(o => o.label);
        const now = timestamp || Date.now();

        // ── 1. Update user presence model ──
        const personLabels = ['person', 'human', 'face', 'portrait'];
        const personDetected = labels.some(l => personLabels.includes(l));
        const personObj = objects.find(o => personLabels.includes(o.label));
        const personConfidence = personObj?.score || 0;

        if (personDetected && personConfidence > 0.6) {
            this.userPresence.detected = true;
            this.userPresence.confidence = personConfidence;
            this.userPresence.lastSeenAt = now;
            this.userPresence.consecutiveFrames++;
            if (labels.includes('desk') || labels.includes('computer') || labels.includes('keyboard')) {
                this.userPresence.typicalLocation = 'at their desk';
            }
        } else {
            // Decay — don't flip to "not detected" on one miss
            if (this.userPresence.consecutiveFrames > 0) {
                this.userPresence.consecutiveFrames = Math.max(0, this.userPresence.consecutiveFrames - 1);
            }
            if (this.userPresence.consecutiveFrames === 0) {
                this.userPresence.detected = false;
            }
        }

        // ── 2. Update environment model ──
        for (const obj of objects) {
            const count = this.environmentCounts.get(obj.label) || 0;
            this.environmentCounts.set(obj.label, count + 1);
        }
        this.environmentSamples++;

        // Infer room type from accumulated evidence
        const roomTypes = ['office', 'bedroom', 'living room'];
        let bestRoom = null;
        let bestCount = 0;
        for (const rt of roomTypes) {
            const c = this.environmentCounts.get(rt) || 0;
            if (c > bestCount) { bestCount = c; bestRoom = rt; }
        }
        if (bestRoom && bestCount > 3 && this.detectedRoomType !== bestRoom) {
            const oldRoom = this.detectedRoomType;
            this.detectedRoomType = bestRoom;
            
            // 📡 Emit Signal: location_changed
            if (this.messageBroker) {
                this.messageBroker.publish('location_changed', {
                    location: { name: bestRoom },
                    oldLocation: oldRoom,
                    type: oldRoom ? 'change' : 'discovery',
                    timestamp: now
                }).catch(() => {});
            }
        }

        // ── 3. Report presence without inventing identity ──
        if (personDetected && personConfidence > 0.8 && this.userPresence.consecutiveFrames === 1) {
             if (this.messageBroker) {
                this.messageBroker.publish('person_detected', {
                    label: 'person',
                    isOwner: false,
                    identityKnown: false,
                    confidence: personConfidence,
                    timestamp: now
                }).catch(() => {});
             }
        }

        // ── 4. Check for high-value context shift ──
        const highValueContexts = {
            'terminal': 'engineering_workspace',
            'code editor': 'development_context',
            'chart': 'financial_analysis',
            'graph': 'data_visualization'
        };

        const foundContext = labels.find(l => highValueContexts[l]);
        if (foundContext) {
            const contextType = highValueContexts[foundContext];
            // 📡 Emit Signal: context_primed
            if (this.messageBroker) {
                this.messageBroker.publish('context_primed', {
                    contextType,
                    triggerLabel: foundContext,
                    timestamp: now
                }).catch(() => {});
            }
        }

        // ── 5. Check for error dialogs — flag for proactive commentary ──
        const errorDetected = labels.some(l => ['error dialog', 'terminal'].includes(l));
        if (errorDetected) this._lastErrorSignalAt = now;

        // ── 4. Visual diary — log this frame as a one-liner before the image is gone ──
        this._diaryPerceptionCount++;
        if (this._diaryPerceptionCount % this._diaryLogEvery === 0) {
            const diaryEntry = this._buildDiaryLine(channel, objects, now);
            if (diaryEntry) {
                this._diaryBuffer.push({ text: diaryEntry, timestamp: now });
                // Flush oldest entries to persistent memory when buffer fills
                if (this._diaryBuffer.length >= this._diaryMaxEntries) {
                    this._flushDiary().catch(() => {});
                }
            }
        }

        // ── 5. Save tagged memory snapshot (rate-limited, richer summary) ──
        if (this.mnemonic?.remember && (now - this._lastMemorySaveAt > this._memorySaveIntervalMs)) {
            this._lastMemorySaveAt = now;
            const summary = this._buildMemoryText(channel, now);
            if (summary) {
                this.mnemonic.remember(summary, {
                    type: 'visual_observation',
                    channel,
                    userPresent: this.userPresence.detected,
                    roomType: this.detectedRoomType,
                    timestamp: now
                }).catch(() => {});
            }
        }
    }

    /**
     * Build a one-line diary entry for this frame.
     * "3:14pm [desktop] saw: terminal, code editor"
     * "3:22pm [webcam] saw owner at desk"
     */
    _buildDiaryLine(channel, objects, timestamp) {
        if (!objects?.length) return null;
        const timeStr = new Date(timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const labels = objects.map(o => o.label);

        if (channel === 'webcam') {
            const hasUser = labels.some(l => ['person', 'human', 'face', 'portrait'].includes(l));
            const roomType = labels.find(l => ['office', 'bedroom', 'living room'].includes(l));
            const loc = this.userPresence.typicalLocation ? ` ${this.userPresence.typicalLocation}` : '';
            if (hasUser) return `${timeStr} [webcam] saw a person${loc}${roomType ? ` in ${roomType}` : ''}`;
            return `${timeStr} [webcam] saw: ${labels.slice(0, 3).join(', ')}`;
        }

        // Desktop channel — what's on screen
        const desktopPriority = ['error dialog', 'terminal', 'code editor', 'browser', 'chat', 'graph'];
        const priority = labels.filter(l => desktopPriority.includes(l));
        const top = priority.length ? priority : labels.slice(0, 3);
        return `${timeStr} [desktop] saw: ${top.join(', ')}`;
    }

    /**
     * Flush oldest diary entries to MnemonicArbiter as a single consolidated memory.
     * Groups them into one block so they read like a journal page.
     */
    async _flushDiary() {
        if (!this.mnemonic?.remember || this._diaryBuffer.length === 0) return;

        const toFlush = this._diaryBuffer.splice(0, this._diaryFlushThreshold);
        if (!toFlush.length) return;

        const firstTs = toFlush[0].timestamp;
        const lastTs = toFlush[toFlush.length - 1].timestamp;
        const dateStr = new Date(firstTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        const journalPage = `[SOMA VISUAL DIARY — ${dateStr}]\n` +
            toFlush.map(e => e.text).join('\n');

        await this.mnemonic.remember(journalPage, {
            type: 'visual_diary',
            fromTs: firstTs,
            toTs: lastTs
        }).catch(() => {});
    }

    /**
     * Force-flush remaining diary entries — call on shutdown.
     */
    async flushRemainingDiary() {
        while (this._diaryBuffer.length > 0) {
            await this._flushDiary().catch(() => {});
        }
    }

    _buildMemoryText(channel, now) {
        const parts = [];
        const timeStr = new Date(now).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        if (channel === 'webcam') {
            if (this.userPresence.detected) {
                const loc = this.userPresence.typicalLocation ? ` ${this.userPresence.typicalLocation}` : '';
                parts.push(`SOMA saw a person via webcam${loc} at ${timeStr}; identity was not established visually`);
            }
            if (this.detectedRoomType) {
                parts.push(`the room is a ${this.detectedRoomType}`);
            }
        } else {
            // Desktop channel
            const topLabels = [...this.environmentCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 4)
                .map(([label]) => label);
            if (topLabels.length) {
                parts.push(`SOMA was observing the desktop at ${timeStr}: ${topLabels.join(', ')}`);
            }
        }

        return parts.length ? parts.join('. ') : null;
    }

    /**
     * Returns a string SOMA can speak when she wants to reference what she sees.
     */
    getUserPresenceSummary() {
        if (!this.userPresence.lastSeenAt) return null;
        const seenAgoMs = Date.now() - this.userPresence.lastSeenAt;
        if (seenAgoMs > 5 * 60 * 1000) return null; // stale — don't mention

        const loc = this.userPresence.typicalLocation ? ` ${this.userPresence.typicalLocation}` : '';
        return `A person is visible via webcam${loc}; identity is unknown unless explicitly confirmed`;
    }

    /**
     * Returns a string describing the inferred environment.
     */
    getEnvironmentSummary() {
        const parts = [];
        if (this.detectedRoomType) parts.push(`${this.ownerName}'s ${this.detectedRoomType}`);
        const topDesktop = [...this.environmentCounts.entries()]
            .filter(([l]) => ['terminal', 'code editor', 'browser'].includes(l))
            .sort((a, b) => b[1] - a[1])
            .slice(0, 2)
            .map(([l]) => l);
        if (topDesktop.length) parts.push(`working with ${topDesktop.join(' and ')}`);
        return parts.length ? parts.join(', ') : null;
    }

    /**
     * Full presence context string for voice injection.
     * Returns null if there's nothing meaningful to say.
     */
    getVisualContext() {
        const presence = this.getUserPresenceSummary();
        const env = this.getEnvironmentSummary();
        if (!presence && !env) return null;
        return [presence, env].filter(Boolean).join('; ');
    }

    getStatus() {
        return {
            name: this.name,
            userPresence: this.userPresence,
            environmentSamples: this.environmentSamples,
            detectedRoomType: this.detectedRoomType,
            topObjects: [...this.environmentCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 8)
                .map(([label, count]) => ({ label, count }))
        };
    }
}

export default VisualMemoryArbiter;
