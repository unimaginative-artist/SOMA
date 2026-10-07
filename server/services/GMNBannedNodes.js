import fs from 'node:fs';
import path from 'node:path';
import gmnRegistry from './GMNSiteRegistry.js';

const BANNED_FILE = path.resolve(process.cwd(), 'data', 'gmn', 'banned_nodes.json');

class GMNBannedNodes {
    constructor() {
        this.bannedNodes = new Set();
        this._load();
    }

    _load() {
        try {
            if (fs.existsSync(BANNED_FILE)) {
                const raw = JSON.parse(fs.readFileSync(BANNED_FILE, 'utf8'));
                if (Array.isArray(raw)) {
                    this.bannedNodes = new Set(raw);
                }
            }
        } catch (e) {
            console.error('[GMNBannedNodes] Failed to load:', e.message);
        }
    }

    _persist() {
        try {
            fs.mkdirSync(path.dirname(BANNED_FILE), { recursive: true });
            fs.writeFileSync(BANNED_FILE, JSON.stringify(Array.from(this.bannedNodes), null, 2));
        } catch (e) {
            console.error('[GMNBannedNodes] Failed to persist:', e.message);
        }
    }

    isBanned(nodeIdOrPublicKey) {
        return this.bannedNodes.has(nodeIdOrPublicKey);
    }

    ban(nodeIdOrPublicKey) {
        if (!nodeIdOrPublicKey) return false;
        this.bannedNodes.add(nodeIdOrPublicKey);
        this._persist();
        
        console.log(`[Rule 0] Executing Ban Hammer on: ${nodeIdOrPublicKey}`);
        
        // Purge all sites belonging to this node from the registry
        let purged = 0;
        for (const entry of gmnRegistry.list()) {
            if (entry.originNodeId === nodeIdOrPublicKey || this.bannedNodes.has(entry.originNodeId)) {
                gmnRegistry.remove(entry.domain);
                purged++;
            }
        }
        console.log(`[Rule 0] Purged ${purged} sites from registry.`);
        return true;
    }
}

export default new GMNBannedNodes();
