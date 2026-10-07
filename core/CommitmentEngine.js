import fs from 'fs';
import path from 'path';
import beingKernel from './BeingKernel.js';

const COMMITMENTS_PATH = path.join(process.cwd(), 'data', 'commitments_ledger.json');

export class CommitmentEngine {
    constructor() {
        this.commitments = new Map();
        this.loadLedger();
    }

    loadLedger() {
        try {
            if (fs.existsSync(COMMITMENTS_PATH)) {
                const raw = fs.readFileSync(COMMITMENTS_PATH, 'utf8');
                const data = JSON.parse(raw);
                if (Array.isArray(data.commitments)) {
                    data.commitments.forEach(c => this.commitments.set(c.id, c));
                }
                console.log(`[CommitmentEngine] ⚙️ Loaded ${this.commitments.size} durable commitments from ledger.`);
            }
        } catch (e) {
            console.warn('[CommitmentEngine] Ledger load note:', e.message);
        }
    }

    saveLedger() {
        try {
            fs.mkdirSync(path.dirname(COMMITMENTS_PATH), { recursive: true });
            const list = Array.from(this.commitments.values());
            fs.writeFileSync(COMMITMENTS_PATH, JSON.stringify({ commitments: list, updatedAt: Date.now() }, null, 2), 'utf8');
        } catch (e) {
            console.error('[CommitmentEngine] Save failed:', e.message);
        }
    }

    /**
     * Classify Intent: Conversation vs Question vs Task Command vs Cancellation
     */
    classifyIntent(text = '') {
        const lower = String(text || '').toLowerCase().trim();
        if (/^(cancel|stop|abort|halt|nevermind|forget it)/i.test(lower)) return 'cancellation';
        if (/^(what|why|how|who|where|when|can you explain|tell me about|is it|are you)/i.test(lower) && !/\b(build|fix|create|run|deploy|make)\b/i.test(lower)) return 'question';
        if (/\b(build|fix|create|implement|deploy|patch|write|add|optimize|repair|test|generate)\b/i.test(lower)) return 'command';
        return 'conversation';
    }

    /**
     * Create a Durable Commitment with guaranteed Terminal Report
     */
    createCommitment(taskDescription, source = 'operator', metadata = {}) {
        const id = `commit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        const commitment = {
            id,
            description: taskDescription,
            source,
            status: 'active', // 'active' | 'completed' | 'failed' | 'blocked'
            progress: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            terminalReport: null,
            evidence: [],
            metadata
        };

        this.commitments.set(id, commitment);
        this.saveLedger();
        beingKernel.recordThought(`Created commitment: ${taskDescription}`, 'agency');
        console.log(`[CommitmentEngine] 📌 Created Durable Commitment [${id}]: "${taskDescription.slice(0, 50)}..."`);
        return commitment;
    }

    /**
     * Fulfill a Commitment with Terminal Report & Verified Evidence
     */
    fulfillCommitment(id, status = 'completed', report = '', evidence = []) {
        const c = this.commitments.get(id);
        if (!c) return null;

        c.status = status;
        c.progress = status === 'completed' ? 100 : c.progress;
        c.updatedAt = Date.now();
        c.terminalReport = {
            status,
            summary: report,
            completedAt: Date.now(),
            evidence
        };

        this.saveLedger();
        console.log(`[CommitmentEngine] ✅ Commitment [${id}] FULFILLED with status: ${status.toUpperCase()}`);
        return c;
    }

    getActiveCommitments() {
        return Array.from(this.commitments.values()).filter(c => c.status === 'active');
    }
}

export default new CommitmentEngine();
