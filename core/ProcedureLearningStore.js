/**
 * core/ProcedureLearningStore.js
 * 
 * Records verified execution procedures (ordered tool sequences, verification steps,
 * arguments patterns) upon successful task completion, and enables retrieval before
 * planning from scratch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, readJsonWithRecovery } from './AtomicJsonStore.cjs';

export class ProcedureLearningStore {
    constructor({ root = process.cwd(), proceduresDir = null, logger = console } = {}) {
        this.root = path.resolve(root);
        this.proceduresDir = proceduresDir ? path.resolve(proceduresDir) : path.join(this.root, 'data', 'procedures');
        this.logger = logger;
        this._ensureDir();
    }

    _ensureDir() {
        try {
            if (!fs.existsSync(this.proceduresDir)) {
                fs.mkdirSync(this.proceduresDir, { recursive: true });
            }
        } catch (e) {
            this.logger.warn?.(`[ProcedureLearningStore] Failed to ensure directory: ${e.message}`);
        }
    }

    _procedurePath(taskType) {
        const safe = String(taskType || 'general').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        return path.join(this.proceduresDir, `${safe}.json`);
    }

    recordProcedure({
        taskType = 'general',
        taskDescription = '',
        orderedToolSequence = [],
        argumentsPattern = {},
        verificationSteps = [],
        result = '',
        whetherRollbackWasRequired = false,
        durationMs = 0,
        confidence = 0.95,
        sourceJobId = null
    } = {}) {
        if (!orderedToolSequence || orderedToolSequence.length === 0) return null;

        const safeType = String(taskType || 'general').toLowerCase();
        const filePath = this._procedurePath(safeType);

        let existing = [];
        try {
            const loaded = readJsonWithRecovery(filePath, null);
            if (Array.isArray(loaded?.value)) existing = loaded.value;
        } catch {}

        const procedureRecord = {
            id: `proc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            taskType: safeType,
            taskDescription: String(taskDescription || '').slice(0, 300),
            orderedToolSequence: [...orderedToolSequence],
            argumentsPattern: { ...argumentsPattern },
            verificationSteps: [...verificationSteps],
            result: String(result || '').slice(0, 500),
            whetherRollbackWasRequired,
            durationMs,
            confidence,
            sourceJobId,
            recordedAt: Date.now()
        };

        existing.unshift(procedureRecord);
        // Keep top 10 most recent verified procedures per task type
        const kept = existing.slice(0, 10);
        atomicWriteJson(filePath, kept, { backup: false });
        return procedureRecord;
    }

    getProvenProcedure(taskType) {
        const safeType = String(taskType || 'general').toLowerCase();
        const filePath = this._procedurePath(safeType);
        try {
            const loaded = readJsonWithRecovery(filePath, null);
            if (Array.isArray(loaded?.value) && loaded.value.length > 0) {
                // Return the highest confidence proven procedure
                return loaded.value.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
            }
            return null;
        } catch {
            return null;
        }
    }

    listProcedures() {
        try {
            if (!fs.existsSync(this.proceduresDir)) return [];
            const files = fs.readdirSync(this.proceduresDir).filter(f => f.endsWith('.json'));
            const list = [];
            for (const file of files) {
                const loaded = readJsonWithRecovery(path.join(this.proceduresDir, file), null);
                if (Array.isArray(loaded?.value)) {
                    list.push(...loaded.value);
                }
            }
            return list;
        } catch {
            return [];
        }
    }
}

export const globalProcedureStore = new ProcedureLearningStore();
export default ProcedureLearningStore;
