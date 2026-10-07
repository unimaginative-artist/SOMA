import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

/**
 * PersonaWatcherArbiter — SOMA's Real-time Identity Monitor
 * 
 * Watches the agents_repo/plugins directory for changes to persona MD files.
 * When a file is modified, it re-parses the persona and updates the IdentityArbiter
 * without requiring a system restart.
 */
export class PersonaWatcherArbiter extends EventEmitter {
    constructor(identityArbiter, repoPath) {
        super();
        this.identityArbiter = identityArbiter;
        this.repoPath = repoPath;
        this.watchers = new Map();
    }

    async initialize() {
        console.log(`[PersonaWatcher] 👁️  Monitoring identities in: ${this.repoPath}`);
        this.startWatching(this.repoPath);
    }

    startWatching(dir) {
        try {
            // Watch the directory for file changes
            const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
                if (filename && filename.endsWith('.md')) {
                    const fullPath = path.join(dir, filename);
                    this.handleFileChange(fullPath);
                }
            });
            this.watchers.set(dir, watcher);
        } catch (e) {
            console.error(`[PersonaWatcher] ❌ Failed to watch ${dir}:`, e.message);
        }
    }

    async handleFileChange(filePath) {
        if (!fs.existsSync(filePath)) return; // File deleted

        console.log(`[PersonaWatcher] 🔄 Change detected: ${path.basename(filePath)}`);
        
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            
            if (!match) return;

            const frontmatterRaw = match[1];
            const personaContent = match[2].trim();
            const metadata = {};

            frontmatterRaw.split('\n').forEach(line => {
                const [key, ...val] = line.split(':');
                if (key && val) metadata[key.trim()] = val.join(':').trim();
            });

            if (metadata.name) {
                this.identityArbiter.registerPersona(metadata.name, {
                    ...metadata,
                    content: personaContent,
                    filePath
                });
                console.log(`[PersonaWatcher] ✅ Hot-swapped persona: ${metadata.name}`);
                this.emit('persona_updated', { name: metadata.name, metadata });
            }
        } catch (err) {
            console.error(`[PersonaWatcher] ❌ Error reloading ${path.basename(filePath)}:`, err.message);
        }
    }

    stop() {
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}

export default PersonaWatcherArbiter;
