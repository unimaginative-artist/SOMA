/**
 * PatchLoader.js
 * 
 * SOMA Emergency Bootstrapping System.
 * Bypasses the recursive ArbiterLoader cycle to force-load critical
 * evolution components. Used to break 'Mirror Loops'.
 */

import fs from 'fs/promises';
import path from 'path';

export class PatchLoader {
    constructor(system) {
        this.system = system;
        this.rootPath = process.cwd();
    }

    /**
     * Physically force-load an arbiter without using the registry
     */
    async forceLoad(name, filePath) {
        console.log(`[PatchLoader] ⚡ Hot-wiring critical arbiter: ${name}`);
        
        try {
            const absolutePath = path.resolve(this.rootPath, filePath);
            
            // Dynamic import bypassing standard loading queues
            const module = await import(`file://${absolutePath}?patch=${Date.now()}`);
            const ArbiterClass = module.default || module[Object.keys(module)[0]];

            if (!ArbiterClass) throw new Error('No class found in patched module');

            const instance = new ArbiterClass({
                quadBrain: this.system.quadBrain,
                messageBroker: this.system.messageBroker,
                logger: this.system.logger || console
            });

            // Direct initialization
            if (typeof instance.initialize === 'function') await instance.initialize();
            else if (typeof instance.onInitialize === 'function') await instance.onInitialize();

            // Direct registration into the CNS
            this.system[name.toLowerCase()] = instance;
            if (this.system.messageBroker) {
                this.system.messageBroker.registerArbiter(name, {
                    instance,
                    status: 'active',
                    patched: true
                });
            }

            console.log(`[PatchLoader] ✓ ${name} is now ONLINE via Sovereign Bypass.`);
            return instance;
        } catch (e) {
            console.error(`[PatchLoader] ❌ Failed to hot-wire ${name}:`, e.message);
            return null;
        }
    }
}

export default PatchLoader;
