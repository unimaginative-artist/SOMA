/**
 * CheckpointManager.js
 * 
 * Manages state snapshots for Odyssey voyages.
 * Ensures multi-session tasks can be resumed or restored after failure.
 */

import fs from 'fs';
import path from 'path';

export class CheckpointManager {
    /**
     * @param {string} rootDir - Root directory for voyage data
     */
    constructor(rootDir) {
        this.rootDir = path.resolve(rootDir);
    }

    /**
     * Save checkpoint after milestone arrives
     */
    saveCheckpoint(voyageId, milestoneId, snapshot) {
        const cpDir = path.join(this.rootDir, voyageId, 'checkpoints');
        if (!fs.existsSync(cpDir)) fs.mkdirSync(cpDir, { recursive: true });

        const checkpointId = `cp_${milestoneId}_${Date.now()}`;
        const filePath = path.join(cpDir, `${checkpointId}.json`);
        
        const data = {
            voyageId,
            checkpointId,
            timestamp: new Date().toISOString(),
            afterMilestone: milestoneId,
            milestones: snapshot.milestones,
            context: snapshot.context || {}
        };

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
        return checkpointId;
    }

    /**
     * Restore to last known good state
     */
    restoreCheckpoint(voyageId) {
        const cpDir = path.join(this.rootDir, voyageId, 'checkpoints');
        if (!fs.existsSync(cpDir)) return null;

        const files = fs.readdirSync(cpDir)
            .filter(f => f.endsWith('.json'))
            .sort((a, b) => {
                return fs.statSync(path.join(cpDir, b)).mtime.getTime() - 
                       fs.statSync(path.join(cpDir, a)).mtime.getTime();
            });

        if (files.length === 0) return null;

        const latest = files[0];
        const content = fs.readFile(path.join(cpDir, latest), 'utf8');
        return JSON.parse(content);
    }

    /**
     * List all checkpoints for a voyage
     */
    listCheckpoints(voyageId) {
        const cpDir = path.join(this.rootDir, voyageId, 'checkpoints');
        if (!fs.existsSync(cpDir)) return [];

        return fs.readdirSync(cpDir)
            .filter(f => f.endsWith('.json'))
            .map(f => {
                const content = fs.readFileSync(path.join(cpDir, f), 'utf8');
                return JSON.parse(content);
            })
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    }
}
