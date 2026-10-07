/**
 * SkillRegistryArbiter.js
 * 
 * Inspired by 'everything-claude-code' capability layer.
 * Manages dynamic loading of tools/skills to minimize context bloat.
 */

import BaseArbiterV4, { ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import fs from 'fs/promises';
import path from 'path';

export class SkillRegistryArbiter extends BaseArbiterV4 {
    constructor(opts = {}) {
        super({
            ...opts,
            name: opts.name || 'SkillRegistryArbiter',
            role: ArbiterRole.LIBRARIAN,
            capabilities: [
                ArbiterCapability.ORCHESTRATOR
            ]
        });

        this.toolRegistry = opts.toolRegistry || null;
        this.activeSkills = new Set();
        this.skillManifest = new Map(); // domain -> list of tool names
    }

    async onInitialize() {
        await this._mapSkills();
        this.auditLogger.info(`[SkillRegistry] 📚 Mapped ${this.skillManifest.size} skill domains.`);
    }

    async _mapSkills() {
        // Logic to group existing tools into domains (e.g., 'finance', 'git', 'filesystem')
        if (this.toolRegistry) {
            const tools = await this.toolRegistry.listTools();
            for (const tool of tools) {
                const domain = this._inferDomain(tool.name);
                if (!this.skillManifest.has(domain)) this.skillManifest.set(domain, []);
                this.skillManifest.get(domain).push(tool.name);
            }
        }
    }

    _inferDomain(toolName) {
        if (toolName.includes('binance') || toolName.includes('crypto')) return 'finance';
        if (toolName.includes('git') || toolName.includes('repo')) return 'vcs';
        if (toolName.includes('fs') || toolName.includes('file') || toolName.includes('read_') || toolName.includes('write_')) return 'filesystem';
        if (toolName.includes('vision') || toolName.includes('argus')) return 'sensory';
        if (toolName.includes('code') || toolName.includes('verify')) return 'engineering';
        return 'general';
    }

    /**
     * Dynamically select which tools should be in the prompt based on user intent
     */
    async getActiveToolDefinitions(intent) {
        const domainsToLoad = new Set(['general']); // Always load general tools
        
        // Match intent to domains
        for (const [domain, keywords] of Object.entries(this.intentMap)) {
            if (keywords.some(kw => intent.toLowerCase().includes(kw))) {
                domainsToLoad.add(domain);
            }
        }

        const toolsToInject = [];
        for (const domain of domainsToLoad) {
            const toolNames = this.skillManifest.get(domain) || [];
            for (const name of toolNames) {
                const def = await this.toolRegistry.getToolDefinition(name);
                if (def) toolsToInject.push(def);
            }
        }

        return toolsToInject;
    }

    get intentMap() {
        return {
            finance: ['price', 'stock', 'trade', 'portfolio', 'crypto', 'binance', 'market'],
            vcs: ['git', 'commit', 'branch', 'github', 'push', 'pull', 'history', 'revert'],
            filesystem: ['file', 'directory', 'folder', 'read', 'write', 'delete', 'list'],
            sensory: ['see', 'look', 'watch', 'camera', 'argus', 'identity', 'person', 'location'],
            engineering: ['code', 'implement', 'build', 'fix', 'refactor', 'test', 'verify', 'debug']
        };
    }
}

export default SkillRegistryArbiter;
