/**
 * SkillWatcherArbiter.js
 * 
 * "THE PLUGIN LOADER"
 * 
 * Watches the ./SOMA/skills/ directory for new .js files.
 * When a file is dropped, it hot-loads it as a Tool and registers it
 * with the appropriate agent (Steve or Kevin).
 * 
 * Borrowed from ClawdBot's "Skills as Files" architecture.
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';
import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs/promises';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export class SkillWatcherArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'SkillWatcher',
            role: ArbiterRole.ENGINEER,
            capabilities: [ArbiterCapability.CODE_AWARENESS, ArbiterCapability.INTEGRATE_SYSTEMS],
            ...config
        });

        this.skillsDir = path.join(process.cwd(), 'SOMA', 'skills');
        this.toolRegistry = config.toolRegistry; // Reference to SOMA's central tool registry
        this.system = config.system; // Reference to all SOMA arbiters
        this.watchers = new Map(); // path -> watcher
        this.loadedSkills = new Map(); // name -> skillDef
    }

    async onInitialize() {
        this.log('info', '📂 Initializing Skill Watcher...');

        // Ensure directories exist
        await fs.mkdir(path.join(this.skillsDir, 'steve'), { recursive: true });
        await fs.mkdir(path.join(this.skillsDir, 'kevin'), { recursive: true });
        await fs.mkdir(path.join(this.skillsDir, 'shared'), { recursive: true });

        // Start watching
        this.watchers.set('root', chokidar.watch(this.skillsDir, {
            persistent: true,
            ignoreInitial: false,
            depth: 2
        }));

        const watcher = this.watchers.get('root');

        watcher
            .on('add', (path) => this.loadSkill(path))
            .on('change', (path) => this.reloadSkill(path))
            .on('unlink', (path) => this.unloadSkill(path));

        this.log('info', `✅ Watching for skills in ${this.skillsDir}`);
    }

    async loadSkill(filePath) {
        if (!filePath.endsWith('.js') && !filePath.endsWith('.cjs')) return;

        try {
            this.log('debug', `Loading skill from ${filePath}...`);
            
            // Invalidate cache for hot-reload
            delete require.cache[require.resolve(filePath)];
            const skillModule = require(filePath);
            const skill = skillModule.default || skillModule;

            // Validate Skill Structure
            if (!skill.name || !skill.description || !skill.execute) {
                this.log('warn', `❌ Invalid skill format in ${path.basename(filePath)}. Needs name, description, execute.`);
                return;
            }

            // Determine owner based on folder
            const owner = filePath.includes('steve') ? 'steve' : 
                          filePath.includes('kevin') ? 'kevin' : 'shared';

            // Wrap execute to inject SOMA Context
            const originalExecute = skill.execute;
            const injectedExecute = async (params) => {
                return await originalExecute(params, {
                    system: this.system,
                    logger: this.auditLogger,
                    skillWatcher: this
                });
            };

            // Register with ToolRegistry
            if (this.toolRegistry) {
                this.toolRegistry.registerTool({
                    ...skill,
                    execute: injectedExecute,
                    category: 'plugin',
                    metadata: { owner, source: filePath }
                });
            }

            this.loadedSkills.set(skill.name, { ...skill, execute: injectedExecute, path: filePath, owner });
            this.log('info', `✨ Skill Loaded: ${skill.name} (${owner})`);

            // Announce to the system
            if (this.messageBroker) {
                this.messageBroker.publish('skill.acquired', { 
                    skill: skill.name, 
                    owner, 
                    description: skill.description 
                });
            }

        } catch (error) {
            this.log('error', `Failed to load skill ${filePath}: ${error.message}`);
        }
    }

    async reloadSkill(filePath) {
        this.log('info', `🔄 Reloading skill: ${path.basename(filePath)}`);
        await this.loadSkill(filePath);
    }

    async unloadSkill(filePath) {
        // Find skill by path
        for (const [name, skill] of this.loadedSkills.entries()) {
            if (skill.path === filePath) {
                this.loadedSkills.delete(name);
                // Note: ToolRegistry unregister not implemented, but we can override
                this.log('info', `🗑️ Skill Unloaded: ${name}`);
                return;
            }
        }
    }

    getSkills(owner) {
        const skills = [];
        for (const skill of this.loadedSkills.values()) {
            if (!owner || skill.owner === owner || skill.owner === 'shared') {
                skills.push(skill);
            }
        }
        return skills;
    }
}
