/**
 * VoyagePersistence.js
 * 
 * SOMA Persistence Layer (inspired by claw-code).
 * Handles flat JSON storage and NDJSON event logs for Odyssey voyages.
 */

import fs from 'fs';
import path from 'path';

export class VoyagePersistence {
    /**
     * @param {string} rootDir - Root directory for voyage data
     */
    constructor(rootDir) {
        this.rootDir = path.resolve(rootDir);
    }

    /**
     * Ensure directory structure exists for a voyage
     */
    ensureDirs(voyageId) {
        const vDir = path.join(this.rootDir, voyageId);
        const cpDir = path.join(vDir, 'checkpoints');
        fs.mkdirSync(cpDir, { recursive: true });
        return { vDir, cpDir };
    }

    /**
     * Save full voyage state to disk
     */
    save(voyage) {
        const { vDir } = this.ensureDirs(voyage.voyageId);
        const filePath = path.join(vDir, 'voyage.json');
        fs.writeFileSync(filePath, JSON.stringify(voyage, null, 2), 'utf8');
    }

    /**
     * Load voyage from disk
     */
    load(voyageId) {
        const filePath = path.join(this.rootDir, voyageId, 'voyage.json');
        if (!fs.existsSync(filePath)) return null;
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content);
    }

    /**
     * Append state transition to log.ndjson
     */
    appendLog(voyageId, entry) {
        const { vDir } = this.ensureDirs(voyageId);
        const logPath = path.join(vDir, 'log.ndjson');
        const logEntry = JSON.stringify({
            ts: new Date().toISOString(),
            voyageId,
            ...entry
        }) + '\n';
        fs.appendFileSync(logPath, logEntry, 'utf8');
    }

    /**
     * List all voyage IDs on disk
     */
    listVoyages() {
        if (!fs.existsSync(this.rootDir)) return [];
        return fs.readdirSync(this.rootDir).filter(f => {
            return fs.statSync(path.join(this.rootDir, f)).isDirectory();
        });
    }
}
