
import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';
import { parseStructured } from '../asi/core/StructuredOutput.cjs';

/**
 * IdentityArbiter - The Librarian of 469 Souls
 * 
 * Manages SOMA's persona library and specialist spawning.
 * Allows SOMA to "grow limbs" by assuming specialized identities.
 */
export class IdentityArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'IdentityArbiter',
            role: ArbiterRole.SPECIALIST,
            lobe: 'COGNITIVE',
            classification: 'IDENTITY',
            capabilities: [
                ArbiterCapability.MEMORY_ACCESS,
                ArbiterCapability.MICRO_SPAWN,
                ArbiterCapability.SEMANTIC_GROWTH
            ],
            ...config
        });

        this.repoPath = config.repoPath || path.join(process.cwd(), 'agents_repo', 'plugins');
        this.personas = new Map(); // name -> metadata
        this.lobeIndex = new Map(); // lobe -> Set(names)
        this.messageBroker = config.messageBroker;
        this.mnemonic = config.mnemonic;
        this.microAgentPool = config.microAgentPool;
        this.activePersona = null;

        // High-level context staged for the next interaction
        this._stagedContexts = new Map(); // domain -> { summary, timestamp }
        this._contextTTL = 5 * 60 * 1000; // 5 min
    }

    /**
     * Stage high-level context (e.g., from visual perception)
     */
    stageContext(domain, summary) {
        if (!domain || !summary) return;
        this._stagedContexts.set(domain, { summary, timestamp: Date.now() });
        console.log(`[IdentityArbiter] 🧠 Context staged for domain: ${domain}`);
    }

    /**
     * Get a consolidated summary of all valid staged contexts
     */
    getStagedContextSummary() {
        const now = Date.now();
        const parts = [];

        for (const [domain, entry] of this._stagedContexts.entries()) {
            if (now - entry.timestamp > this._contextTTL) {
                this._stagedContexts.delete(domain);
                continue;
            }
            parts.push(`[CONTEXT: ${domain.toUpperCase()}]\n${entry.summary}`);
        }

        return parts.length > 0 ? parts.join('\n\n') : null;
    }

    /**
     * Clear all staged contexts
     */
    clearStagedContext() {
        this._stagedContexts.clear();
    }

    async initialize() {
        console.log(`[IdentityArbiter] 📚 Initializing persona library...`);
        // We will scan the repo in the loader, but arbiter provides the interface
        return true;
    }

    /**
     * Register a persona metadata into the active map and lobe index
     */
    registerPersona(name, metadata) {
        this.personas.set(name, metadata);
        
        // Index by Lobe (Expertise)
        const lobe = metadata.lobe || metadata.domain || 'GENERAL';
        if (!this.lobeIndex.has(lobe)) this.lobeIndex.set(lobe, new Set());
        this.lobeIndex.get(lobe).add(name);
    }

    getPersonasByLobe(lobe) {
        const names = this.lobeIndex.get(lobe) || new Set();
        return Array.from(names).map(name => this.personas.get(name));
    }

    updatePersona(name, updates = {}) {
        if (!this.personas.has(name)) throw new Error(`Persona not found: ${name}`);
        const current = this.personas.get(name);
        const next = { ...current, ...updates };
        this.personas.set(name, next);
        return next;
    }

    setActivePersona(name) {
        if (!name) {
            this.activePersona = null;
            return null;
        }
        const persona = this.personas.get(name);
        if (!persona) throw new Error(`Persona not found: ${name}`);
        this.activePersona = { name, ...persona };
        return this.activePersona;
    }

    getActivePersona() {
        return this.activePersona;
    }

    /**
     * Find the best specialist for a task using semantic search
     */
    async findSpecialist(taskDescription) {
        if (!this.mnemonic) return null;

        console.log(`[IdentityArbiter] 🔍 Searching for specialist for: "${taskDescription.substring(0, 50)}..."`);
        
        // Use semantic search in the identity tier
        const search = await this.mnemonic.recall(taskDescription, 3, { 
            filters: { type: 'identity' } 
        });

        if (!search.results || search.results.length === 0) {
            console.log(`[IdentityArbiter] ⚠️ No specific specialist found, falling back to general.`);
            return null;
        }

        // Return the top match
        const best = search.results[0];
        console.log(`[IdentityArbiter] 🎯 Found specialist match: ${best.metadata?.name || 'unknown'}`);
        return {
            name: best.metadata?.name,
            description: best.metadata?.description,
            content: best.content
        };
    }

    /**
     * Spawn a "limb" (MicroAgent) using a specific persona
     */
    async spawnLimb(personaName, task) {
        const persona = this.personas.get(personaName);
        if (!persona && !task) throw new Error(`Persona ${personaName} not found`);

        let personaData = persona;
        if (!personaData && task) {
            personaData = await this.findSpecialist(task);
        }

        if (!personaData) throw new Error(`Could not resolve persona for task: ${task}`);

        console.log(`[IdentityArbiter] 🧬 Spawning limb: ${personaData.name}`);

        if (this.microAgentPool) {
            return await this.microAgentPool.spawn({
                type: 'specialist',
                persona: personaData.content,
                metadata: { name: personaData.name, source: 'IdentityArbiter' }
            });
        }

        return null;
    }

    getStats() {
        return {
            totalPersonas: this.personas.size,
            loadedFrom: this.repoPath
        };
    }
}

export default IdentityArbiter;
