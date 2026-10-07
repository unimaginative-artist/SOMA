/**
 * RegistryLoader.js
 * 
 * High-speed lookup for Nautical Notation tokens.
 */

import fs from 'fs';
import path from 'path';

export class RegistryLoader {
    constructor(registryDir) {
        this.registryDir = path.resolve(registryDir);
        this.tokens = new Map();
    }

    /**
     * Load registry from disk (tries JSON first, then CSV)
     */
    load() {
        const jsonPath = path.join(this.registryDir, 'registry.json');
        const csvPath = path.join(this.registryDir, 'registry.csv');

        if (fs.existsSync(jsonPath)) {
            const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            data.forEach(entry => this.tokens.set(entry.token, entry));
            return true;
        } else if (fs.existsSync(csvPath)) {
            const content = fs.readFileSync(csvPath, 'utf8');
            const lines = content.split('\n').slice(1);
            lines.forEach(line => {
                if (!line.trim()) return;
                const [id, token, domain, operation, target, modifier, alias, status, version] = line.split(',');
                this.tokens.set(token, { id, token, domain, operation, target, modifier, alias, status, version });
            });
            return true;
        }
        return false;
    }

    /**
     * Lookup a token
     */
    lookup(token) {
        return this.tokens.get(token) || null;
    }

    /**
     * Validate a token
     */
    validate(token) {
        return this.tokens.has(token);
    }
}
