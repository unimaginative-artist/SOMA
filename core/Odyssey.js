/**
 * Odyssey.js
 * 
 * SOMA Strategic Navigation & Execution Engine.
 * Manages the transition from abstract goals to technical completion via a DAG.
 */

import { Poseidon } from './Poseidon.js';
import { VoyagePersistence } from './VoyagePersistence.js';
import { CheckpointManager } from './CheckpointManager.js';
import path from 'path';

export const STATUS = Object.freeze({
    DOCKED:  'docked',   // ⚓ exists, prereqs not met or not started
    SAILING: 'sailing',  // ⛵ actively executing
    ARRIVED: 'arrived',  // ✓  completed + verification passed
    FAILED:  'failed',   // ⛔ execution error OR verification failed
});

const EMOJI = { docked: '⚓', sailing: '⛵', arrived: '✓', failed: '⛔' };

export class Odyssey {
    constructor(opts = {}) {
        this.voyages = new Map();
        this.rootDir = opts.voyagesDir || path.resolve(process.cwd(), '.soma/voyages');
        
        this.persistence = new VoyagePersistence(this.rootDir);
        this.checkpoints = new CheckpointManager(this.rootDir);
        this.poseidon = new Poseidon(opts.poseidon || {});
        this.parser = opts.parser || null; // Injected NauticalParser
    }

    /**
     * Single-line session recovery from a contextDump string
     */
    reload(dumpString) {
        const parts = dumpString.split(' ');
        const voyageId = parts[0].split(':')[1];
        if (!voyageId) return null;

        const voyage = this.persistence.load(voyageId);
        if (!voyage) return null;

        // Sync statuses from the dump string
        parts.slice(1).forEach(p => {
            const id = p.slice(0, -1);
            const icon = p.slice(-1);
            const m = voyage.milestones.find(m => m.id === id);
            if (m) {
                // Find matching status for emoji
                const status = Object.entries(EMOJI).find(([, e]) => e === icon)?.[0];
                if (status) m.status = status;
            }
        });

        this.voyages.set(voyageId, voyage);
        return voyage;
    }

    /**
     * Define a voyage directly
     */
    define(voyageId, title, milestones = []) {
        const voyage = {
            voyageId,
            title,
            createdAt: new Date().toISOString(),
            milestones: milestones.map(m => ({
                id: m.id,
                title: m.title || m.label || m.id,
                deps: m.deps || [],
                status: STATUS.DOCKED,
                output: null,
                falsificationTest: m.falsificationTest || null,
                evidence: m.evidence || null
            })),
            context: {}
        };
        
        this.voyages.set(voyageId, voyage);
        this.persistence.save(voyage);
        this.persistence.appendLog(voyageId, { event: 'voyage.defined', title });
        return voyage;
    }

    /**
     * Get unblocked milestones (all dependencies arrived)
     */
    getUnblocked(voyageId) {
        const voyage = this._get(voyageId);
        const arrivedIds = new Set(
            voyage.milestones.filter(m => m.status === STATUS.ARRIVED).map(m => m.id)
        );
        return voyage.milestones.filter(m =>
            m.status === STATUS.DOCKED &&
            m.deps.every(dep => arrivedIds.has(dep))
        );
    }

    /**
     * Advance a milestone through its lifecycle
     */
    async advance(voyageId, milestoneId, result = {}) {
        const voyage = this._get(voyageId);
        const milestone = voyage.milestones.find(m => m.id === milestoneId);
        if (!milestone) throw new Error(`Milestone not found: ${milestoneId}`);

        // docked -> sailing
        if (milestone.status === STATUS.DOCKED) {
            milestone.status = STATUS.SAILING;
            this.persistence.appendLog(voyageId, { milestoneId, from: STATUS.DOCKED, to: STATUS.SAILING });
            this.persistence.save(voyage);
            return { success: true, status: STATUS.SAILING };
        }

        // sailing -> arrived or failed
        if (milestone.status === STATUS.SAILING) {
            if (result.success === false) {
                milestone.status = STATUS.FAILED;
                this.persistence.appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.FAILED, error: result.error });
                this.persistence.save(voyage);
                return { success: false, status: STATUS.FAILED };
            }

            // Poseidon Verification Gate
            const verification = await this.poseidon.verify(
                `Milestone ${milestoneId} completed`,
                {
                    falsificationTest: milestone.falsificationTest,
                    testResult: result.verificationPassed
                }
            );

            if (verification.state === 'FALSE') {
                milestone.status = STATUS.FAILED;
                this.persistence.appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.FAILED, reason: verification.reason });
                this.persistence.save(voyage);
                return { success: false, status: STATUS.FAILED, reason: verification.reason };
            }

            milestone.status = STATUS.ARRIVED;
            milestone.output = result.output || null;
            this.persistence.appendLog(voyageId, { milestoneId, from: STATUS.SAILING, to: STATUS.ARRIVED });
            this.persistence.save(voyage);

            // Save Checkpoint
            this.checkpoints.saveCheckpoint(voyageId, milestoneId, {
                milestones: voyage.milestones,
                context: voyage.context
            });

            return { success: true, status: STATUS.ARRIVED };
        }

        return { success: false, error: `Invalid transition from ${milestone.status}` };
    }

    async load(voyageId) {
        const voyage = this.persistence.load(voyageId);
        if (voyage) this.voyages.set(voyageId, voyage);
        return voyage;
    }

    summary(voyageId) {
        const voyage = this._get(voyageId);
        const arrived = voyage.milestones.filter(m => m.status === STATUS.ARRIVED);
        return {
            title: voyage.title,
            progress: `${arrived.length}/${voyage.milestones.length}`,
            active: voyage.milestones.filter(m => m.status === STATUS.SAILING).map(m => m.id),
            blocked: voyage.milestones.filter(m => m.status === STATUS.DOCKED).map(m => m.id),
            failed: voyage.milestones.filter(m => m.status === STATUS.FAILED).map(m => m.id)
        };
    }

    /**
     * Compact context reload (under 120 chars)
     */
    contextDump(voyageId) {
        const voyage = this._get(voyageId);
        const parts = [`VOYAGE:${voyageId}`];
        for (const m of voyage.milestones) {
            parts.push(`${m.id}${EMOJI[m.status] || '?'}`);
        }
        return parts.join(' ');
    }

    _get(voyageId) {
        const v = this.voyages.get(voyageId);
        if (!v) throw new Error(`Voyage not found: ${voyageId}`);
        return v;
    }
}
