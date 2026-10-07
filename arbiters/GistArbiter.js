/**
 * GistArbiter.js
 * 
 * The Hierarchical Summarization & Wisdom Layer.
 * Prevents "Context Bloat" by distilling raw history into semantic principles.
 * 
 * Capabilities:
 * - monitor-context: Watch history size and token usage.
 * - distill-wisdom: Convert raw conversation turns into high-level "Gists".
 * - memory-compaction: Purge raw data after distillation to keep context clean.
 * - principle-extraction: Identify user preferences, system failures, and core concepts.
 */

import BaseArbiterV4, { ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';
const BaseArbiter = BaseArbiterV4; // Alias for compatibility

export class GistArbiter extends BaseArbiter {
    static role = ArbiterRole.ANALYST;
    static capabilities = [
        ArbiterCapability.MEMORY_ACCESS,
        ArbiterCapability.CONSOLIDATE_KNOWLEDGE,
        ArbiterCapability.PERSISTENT_MEMORY
    ];

    constructor(config = {}) {
        super({
            name: 'GistArbiter',
            role: GistArbiter.role,
            capabilities: GistArbiter.capabilities,
            ...config
        });

        this.threshold = config.threshold || 20; // Trigger after 20 messages
        this.brain = null; // Will be injected
        this.mnemonic = null;
        this.history = null;

        // Blueprinting state
        this.blueprintDir = path.join(process.cwd(), '.soma', 'blueprints');
        this.blueprintPath = path.join(this.blueprintDir, 'current_blueprint.json');
        this.currentBlueprint = {
            mission: "Awaiting primary directive...",
            architecture: {},
            technicalConstraints: [],
            progress: "0%",
            nextMilestone: "Initialization",
            lastUpdated: Date.now()
        };
    }

    async onInitialize() {
        await super.onInitialize();
        await fs.mkdir(this.blueprintDir, { recursive: true });
        await this.loadBlueprint();
        console.log(`[${this.name}] Strategic Compactor online. Blueprinting active.`);
    }

    /**
     * Load existing blueprint from disk
     */
    async loadBlueprint() {
        try {
            const data = await fs.readFile(this.blueprintPath, 'utf8');
            this.currentBlueprint = JSON.parse(data);
            this.auditLogger.info('[Gist] Loaded persistent architectural blueprint.');
        } catch (e) {
            // No blueprint yet, use default
        }
    }

    /**
     * Save current blueprint to disk
     */
    async saveBlueprint() {
        try {
            await fs.writeFile(this.blueprintPath, JSON.stringify(this.currentBlueprint, null, 2), 'utf8');
        } catch (err) {
            this.auditLogger.error(`[Gist] Blueprint save failed: ${err.message}`);
        }
    }

    /**
     * Set central brain for distillation
     */
    setBrain(brain) {
        this.brain = brain;
    }

    /**
     * Analyze current context and decide if distillation is needed
     */
    async checkCompactionNeeded(messages) {
        if (messages.length >= this.threshold) {
            console.log(`[${this.name}] 🧠 Context threshold reached (${messages.length}). Initiating strategic compaction...`);
            return await this.distill(messages);
        }
        return null;
    }

    /**
     * Distill raw messages into Principles/Wisdom and Update Blueprint
     */
    async distill(messages) {
        if (!this.brain) {
            console.warn(`[${this.name}] No brain connected. Distillation skipped.`);
            return null;
        }

        const chunkToDistill = messages.slice(0, 15); // Take first 15 turns
        const rawText = chunkToDistill.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');

        // Step 1: Wisdom Extraction
        const wisdomPrompt = `You are the GIST ARBITER. Extract high-level technical "WISDOM" and user preferences.
        
        RAW HISTORY:
        ${rawText}
        
        Respond ONLY with a JSON object:
        {
            "topics": ["list of technical topics"],
            "preferences": ["user preferred patterns"],
            "wisdom": ["key technical lessons"],
            "summary": "dense 1-paragraph technical summary"
        }`;

        try {
            const wisdomResult = await this.brain.callBrain('LOGOS', wisdomPrompt, { temperature: 0.1 });
            const gist = this._parseJSON(wisdomResult.text || wisdomResult);

            // Step 2: Blueprint Update (ECC Strategic Compaction)
            await this.updateBlueprint(rawText);

            console.log(`[${this.name}] ✅ Strategic compaction complete.`);

            if (this.mnemonic) {
                await this.mnemonic.remember(
                    `BLUEPRINT UPDATE: ${gist.summary}`, 
                    { 
                        type: 'blueprint_gist', 
                        topics: gist.topics, 
                        importance: 0.95,
                        sector: 'SYSTEM_CORE' // Anchor to the core archipelago
                    }
                );
            }

            return {
                success: true,
                compactedCount: chunkToDistill.length,
                gist,
                blueprint: this.currentBlueprint
            };

        } catch (err) {
            console.error(`Strategic compaction failed: ${err.message}`);
            return { success: false, error: err.message };
        }
    }

    /**
     * Extract technical state to keep SOMA focused on complex tasks
     */
    async updateBlueprint(rawText) {
        const prompt = `You are the BLUEPRINT ARCHITECT. Update SOMA's current technical save-state.
        
        CURRENT BLUEPRINT:
        ${JSON.stringify(this.currentBlueprint, null, 2)}
        
        RECENT ACTIVITY:
        ${rawText}
        
        TASK:
        1. Refine the MISSION (The ultimate high-level goal).
        2. Update the ARCHITECTURE (File paths, patterns, and state).
        3. Identify TECHNICAL CONSTRAINTS (e.g., port usage, no Tailwind, etc.).
        4. Adjust PROGRESS % and define the NEXT MILESTONE.
        
        Respond ONLY with the updated JSON blueprint object.`;

        try {
            const result = await this.brain.callBrain('LOGOS', prompt, { temperature: 0.1 });
            const updated = this._parseJSON(result.text || result);
            
            this.currentBlueprint = {
                ...updated,
                lastUpdated: Date.now()
            };
            
            await this.saveBlueprint();
            this.auditLogger.success('[Gist] Persistent blueprint updated.');
        } catch (err) {
            this.auditLogger.warn(`[Gist] Blueprint update skipped: ${err.message}`);
        }
    }

    _parseJSON(text) {
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            return JSON.parse(jsonMatch ? jsonMatch[0] : text);
        } catch (e) {
            return { topics: [], preferences: [], wisdom: [], summary: text };
        }
    }

    getBlueprint() {
        return this.currentBlueprint;
    }
}
