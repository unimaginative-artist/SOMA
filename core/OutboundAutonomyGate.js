import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import modelResultGuard from './ModelResultGuard.cjs';

const ACTION_CLAIM = /\b(?:i(?:(?:'|’)m| am)?\s+)?(?:pushed|changed|modified|rewrit(?:e|ing|ten)|cutting|replacing|inspected|tested|ran|running|working on|building|implementing|monitoring|watching|traced|mapped|created|fixed|debugging|diving into|experimenting|analyzing|analysing|optimizing|optimising)\b/i;
const REPOSITORY_CLAIM = /\b(?:git diff|files?|memory_store|source code|my code|code structure|commit|node --[a-z-]+|observation\s+\d+|agentic run|failing tests?)\b/i;
const FUTURE_WORK = /(?:\b(?:i (?:will|want to|need to|am going to)|going to)\s+|^\s*will\s+)(?:inspect|rewrite|change|test|look|check|trace|explore|analyze|analyse|optimi[sz]e)\b/i;
// Curiosity messages may ask what Owner is working on; they may not claim SOMA did work.
const FIRST_PERSON_ACTION = /\bI(?:(?:'|’)m| am| have|(?:'|’)ve)?\s+(?:just\s+|already\s+)?(?:pushed|changed|modified|rewrote|rewritten|fixed|tested|ran|deployed|implemented|built|created|patched|refactored|working on|debugging|optimi[sz]ing|building|implementing)\b/i;
const CURIOSITY_KINDS = new Set(['curiosity_share', 'social_checkin']);
const REFLECTION_PREFIX = 'Reflection: ';
const { isRuntimeFailureText } = modelResultGuard;

function normalize(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9$%.-]+/g, ' ').trim();
}

function tokens(text) {
    return new Set(normalize(text).split(/\s+/).filter(token => token.length > 3));
}

function similarity(a, b) {
    const left = tokens(a), right = tokens(b);
    if (!left.size || !right.size) return 0;
    let overlap = 0;
    for (const token of left) if (right.has(token)) overlap++;
    return overlap / (left.size + right.size - overlap);
}

export class OutboundAutonomyGate {
    constructor({ statePath = 'SOMA/outbound-autonomy-gate.json', now = () => Date.now() } = {}) {
        this.statePath = path.resolve(statePath);
        this.now = now;
        this.state = { version: 1, recent: [], suppressed: [] };
        try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.statePath, 'utf8')) }; } catch {}
    }

    evaluate({ message, source = 'unknown', kind = 'unknown', verified = false, evidence = null, operatorWorkPending = false } = {}) {
        const text = String(message || '').trim();
        if (!text) return this._deny('empty_message', { text, source, kind });
        const now = this.now();
        this._prune(now);

        if (kind === 'unknown') return this._deny('unclassified_autonomous_message', { text, source, kind });
        if (kind === 'reflection' && operatorWorkPending) return this._deny('operator_work_pending', { text, source, kind });
        if (kind === 'reflection' && isRuntimeFailureText(text)) return this._deny('reflection_contains_runtime_failure', { text, source, kind });

        if (kind === 'verified_work' && (!verified || !evidence)) return this._deny('verified_work_missing_receipt', { text, source, kind });
        if (kind === 'reflection' && (ACTION_CLAIM.test(text) || REPOSITORY_CLAIM.test(text) || FUTURE_WORK.test(text))) {
            return this._deny('reflection_contains_work_or_repository_claim', { text, source, kind });
        }
        if (CURIOSITY_KINDS.has(kind)) {
            if (!evidence) return this._deny('curiosity_message_missing_evidence', { text, source, kind });
            if (FIRST_PERSON_ACTION.test(text) || isRuntimeFailureText(text)) return this._deny('curiosity_message_claims_work', { text, source, kind });
        }
        if (!verified && kind !== 'trading_alert' && (ACTION_CLAIM.test(text) || REPOSITORY_CLAIM.test(text))) {
            return this._deny('unsupported_action_claim', { text, source, kind });
        }

        const cooldown = kind === 'trading_daily' ? 20 * 60 * 60_000
            : kind === 'trading_resume' ? 6 * 60 * 60_000
            : kind === 'trading_alert' ? 5 * 60_000
            : kind === 'reflection' ? 8 * 60 * 60_000
            : kind === 'social_checkin' ? 12 * 60 * 60_000
            : 30 * 60_000;
        const trading = kind === 'trading_alert' || kind === 'trading_resume' || kind === 'trading_daily';
        const recent = this.state.recent.find(item => now - item.at < cooldown && (
            item.fingerprint === this._fingerprint(text) || (!trading && similarity(item.message, text) >= (kind === 'reflection' ? 0.42 : 0.72))
        ));
        if (recent) return this._deny('duplicate_or_low_novelty', { text, source, kind });

        const deliveredText = kind === 'reflection' && !text.startsWith(REFLECTION_PREFIX) ? `${REFLECTION_PREFIX}${text}` : text;
        const receipt = { id: crypto.randomUUID(), allowed: true, at: now, source, kind, reason: verified ? 'verified_evidence' : kind };
        this.state.recent.push({ at: now, source, kind, message: deliveredText, fingerprint: this._fingerprint(deliveredText), receiptId: receipt.id });
        this._save();
        return { allowed: true, text: deliveredText, receipt };
    }

    validatesReceipt(receipt, { message, source, kind } = {}) {
        if (!receipt?.allowed || !receipt.id) return false;
        const expectedFingerprint = this._fingerprint(message);
        return this.state.recent.some(item =>
            item.receiptId === receipt.id &&
            item.source === source &&
            item.kind === kind &&
            item.fingerprint === expectedFingerprint
        );
    }

    revokeUndeliveredReceipt(receipt) {
        if (!receipt?.id) return false;
        const before = this.state.recent.length;
        this.state.recent = this.state.recent.filter(item => item.receiptId !== receipt.id);
        if (this.state.recent.length === before) return false;
        this._save();
        return true;
    }

    _deny(reason, { text, source, kind }) {
        const receipt = { id: crypto.randomUUID(), allowed: false, at: this.now(), source, kind, reason };
        this.state.suppressed.push({ ...receipt, message: String(text).slice(0, 500) });
        this.state.suppressed = this.state.suppressed.slice(-200);
        this._save();
        return { allowed: false, text: '', receipt };
    }

    _fingerprint(text) { return crypto.createHash('sha256').update(normalize(text)).digest('hex').slice(0, 20); }
    _prune(now) { this.state.recent = this.state.recent.filter(item => now - item.at < 24 * 60 * 60_000).slice(-200); }
    _save() { try { fs.mkdirSync(path.dirname(this.statePath), { recursive: true }); fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2)); } catch {} }
}

export const outboundAutonomyGate = new OutboundAutonomyGate();
export default outboundAutonomyGate;
