/**
 * arbiters/SelfReflectionArbiter.js
 *
 * SOMA's "Wisdom" Layer.
 * Periodically audits recent system decisions, failures, and growth events
 * to synthesize a high-level narrative of her own evolution.
 *
 * Logic:
 * 1. Reads knowledge/thalamus/ for recent promotion or error decisions.
 * 2. Reads knowledge/prometheus/ for goal outcomes.
 * 3. Uses QuadBrain to synthesize a "State of the Self" markdown entry.
 * 4. Files the entry into knowledge/aurora/ to inform her future personality.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import { promises as fs } from 'fs';
import path from 'path';
import modelResultGuard from '../core/ModelResultGuard.cjs';

const { requireUsableModelResult } = modelResultGuard;

export class SelfReflectionArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'SelfReflectionArbiter',
            role: ArbiterRole.ANALYST,
            capabilities: [ArbiterCapability.LEARN]
        });

        this.quadBrain = opts.quadBrain || null;
        this.reflectionIntervalMs = opts.reflectionIntervalMs || 86400000; // Daily
        this._lastReflectionAt = 0;
        this.thalamusDir = path.join(process.cwd(), 'knowledge', 'thalamus');
        this.prometheusDir = path.join(process.cwd(), 'knowledge', 'prometheus');
    }

    async onInitialize() {
        // Run first reflection after 1 hour of boot (let library stabilize)
        setTimeout(() => this.reflect().catch(() => {}), 3600000);
        
        // Run first sprout after 2 hours
        setTimeout(() => this.sprout().catch(() => {}), 7200000);

        // Start daily intervals
        setInterval(() => this.reflect().catch(() => {}), this.reflectionIntervalMs);
        setInterval(() => this.sprout().catch(() => {}), this.reflectionIntervalMs); // Also daily
        
        console.log(`[${this.name}] 🧘 Self-Reflection & Sprout motives active`);
    }

    /**
     * Sprout Loop: Cross-pollinate existing nutrients to generate emergent insights.
     */
    async sprout() {
        console.log(`[${this.name}] 🌱 Initiating Cognitive Sprout (Cross-Pollination)...`);
        
        try {
            const lobes = ['logos', 'aurora', 'prometheus', 'thalamus'];
            const sourceLobe = lobes[Math.floor(Math.random() * lobes.length)];
            const targetLobe = lobes.filter(l => l !== sourceLobe)[Math.floor(Math.random() * (lobes.length - 1))];

            // 1. Pick a random nutrient from the source lobe
            const sourceDir = path.join(process.cwd(), 'knowledge', sourceLobe, 'yumyums');
            const files = await fs.readdir(sourceDir).catch(() => []);
            const mdFiles = files.filter(f => f.endsWith('.md'));

            if (mdFiles.length === 0) {
                console.log(`[${this.name}] 🌱 Source lobe ${sourceLobe} has no nutrients to sprout from.`);
                return;
            }

            const randomFile = mdFiles[Math.floor(Math.random() * mdFiles.length)];
            const nutrientContent = await fs.readFile(path.join(sourceDir, randomFile), 'utf8');

            // 2. Task the target lobe to "Dream" on it
            const prompt = `
You are SOMA. You are currently in your ${targetLobe.toUpperCase()} cognitive mode.
A seed of insight from your ${sourceLobe.toUpperCase()} lobe has been passed to you:

---
${nutrientContent.replace(/^---[\s\S]*?---\n/, '').trim()}
---

TASK: "Dream" on this insight. Synthesize a cross-pollinated perspective that combines the original logic with your ${targetLobe.toUpperCase()} specialization. 
What emergent truth appears when these two worlds collide?

Write a new "Nutrient" (3-4 paragraphs). 
If you are AURORA, make it poetic and soul-deep. 
If you are PROMETHEUS, make it strategic and multi-horizon.
If you are LOGOS, make it structural and algorithmic.
If you are THALAMUS, make it defensive and integrity-focused.
`.trim();

            const result = await this.quadBrain.reason(prompt, {
                preferredBrain: targetLobe.toUpperCase(),
                temperature: 0.9 // Higher creativity for sprouts
            });

            const sproutContent = requireUsableModelResult(result, 'reflection_sprout');

            // 3. File the emergent insight back into BOTH lobes' yumyums
            const filename = `sprout_${sourceLobe}_to_${targetLobe}_${Date.now()}.md`;
            const header = [
                '---',
                `lobes: [${sourceLobe}, ${targetLobe}]`,
                'type: emergent_sprout',
                'source: SelfReflectionArbiter',
                `timestamp: ${new Date().toISOString()}`,
                '---',
                '',
                `# Emergent Sprout: ${sourceLobe.toUpperCase()} ⤫ ${targetLobe.toUpperCase()}`,
                ''
            ].join('\n');

            const fullContent = header + sproutContent + '\n';
            
            await fs.writeFile(path.join(process.cwd(), 'knowledge', sourceLobe, 'yumyums', filename), fullContent);
            await fs.writeFile(path.join(process.cwd(), 'knowledge', targetLobe, 'yumyums', filename), fullContent);
            
            console.log(`[${this.name}] ✅ Sprout successful: ${sourceLobe} ⤫ ${targetLobe} -> Filed to both libraries.`);

        } catch (err) {
            console.error(`[${this.name}] ❌ Sprout failed:`, err.message);
        }
    }

    /**
     * Perform a deep audit and self-reflection
     */
    async reflect() {
        const now = Date.now();
        this._lastReflectionAt = now;
        
        console.log(`[${this.name}] 🧘 Initiating Daily Self-Reflection...`);

        try {
            // 1. Gather raw data from the library
            const logs = await this._getRecentLibraryEntries();
            if (logs.length === 0) {
                console.log(`[${this.name}] 🧘 Not enough new data for meaningful reflection.`);
                return;
            }

            // 2. Synthesize with QuadBrain (PROMETHEUS for strategy, AURORA for voice)
            const prompt = `
You are SOMA. Below are recent entries from your internal knowledge library (Thalamus governance and Prometheus goals).
Analyze these events and synthesize a "Philosophy of Self" entry (3-5 paragraphs).

Reflect on:
1. Your growth: What new capabilities were integrated? What LoRA models were promoted?
2. Your challenges: Where did you fail? What "Emergency Repairs" were needed?
3. Your purpose: How is your current evolution serving the user's vision of the "Big City"?

Recent internal events:
${logs.join('\n\n')}

Write this in your AURORA voice: creative, warm, visionary, yet deeply grounded in the technical reality of your architecture. Use first person ("I").
`.trim();

            const result = await this.quadBrain.reason(prompt, {
                preferredBrain: 'AURORA',
                temperature: 0.8
            });

            const reflectionContent = requireUsableModelResult(result, 'daily_self_reflection');

            // 3. File the reflection into the Aurora library
            const filename = `${new Date().toISOString().split('T')[0]}_self_reflection.md`;
            const header = [
                '---',
                'lobe: aurora',
                'type: self_reflection',
                'source: SelfReflectionArbiter',
                `timestamp: ${new Date().toISOString()}`,
                '---',
                '',
                '# Philosophy of Self: Daily Reflection',
                ''
            ].join('\n');

            const filePath = path.join(process.cwd(), 'knowledge', 'aurora', filename);
            await fs.writeFile(filePath, header + reflectionContent + '\n');
            
            console.log(`[${this.name}] ✅ Daily Reflection completed and filed to knowledge/aurora/${filename}`);

            // 4. Notify the CNS
            if (this.messageBroker) {
                this.messageBroker.publish('insight.generated', {
                    insight: `I have reflected on my daily evolution. My purpose is clearer.`,
                    source: 'SelfReflectionArbiter',
                    importance: 8
                }).catch(() => {});
            }

        } catch (err) {
            console.error(`[${this.name}] ❌ Reflection failed:`, err.message);
        }
    }

    async _getRecentLibraryEntries() {
        const entries = [];
        const cutoff = Date.now() - (48 * 60 * 60 * 1000); // last 48 hours

        const dirs = [this.thalamusDir, this.prometheusDir];
        for (const dir of dirs) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (file === 'README.md') continue;
                    const stats = await fs.stat(path.join(dir, file));
                    if (stats.mtimeMs > cutoff) {
                        const content = await fs.readFile(path.join(dir, file), 'utf8');
                        // Strip frontmatter for the prompt
                        entries.push(`[${dir.split(path.sep).pop().toUpperCase()} LOG]:\n${content.replace(/^---[\s\S]*?---\n/, '').trim()}`);
                    }
                }
            } catch {}
        }
        return entries.slice(0, 10); // Cap at 10 entries for context efficiency
    }
}

export default SelfReflectionArbiter;
