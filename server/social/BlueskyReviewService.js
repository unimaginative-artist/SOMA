import blueskeyClient from './BlueskeyClient.js';
import interactionStore from './cortex/interactionStore.js';
import { guardSomaText } from '../context/GroundedReasoning.js';
import { assertPublicPost } from './SocialContentSafety.js';
import socialContextProvider from './SocialContextProvider.js';

export class BlueskyReviewService {
    constructor({ store = interactionStore, client = blueskeyClient, guardText = guardSomaText, assertPost = assertPublicPost } = {}) {
        this.store = store;
        this.client = client;
        this.guardText = guardText;
        this.assertPost = assertPost;
    }

    getStatus() {
        return this.store.getStatus();
    }

    getReview(id) {
        return this.store.getReview(id) || null;
    }

    _pendingReview(id) {
        const row = this.getReview(id);
        if (!row || (row.status && row.status !== 'pending')) {
            const error = new Error('Pending review not found');
            error.code = 'REVIEW_NOT_FOUND';
            throw error;
        }
        return row;
    }

    _audit(id, action, context = {}, detail = {}) {
        try {
            this.store.recordReviewAudit?.({
                reviewId: Number(id),
                action,
                actorId: String(context.actorId || ''),
                actorLabel: String(context.actorLabel || ''),
                source: String(context.source || 'unknown'),
                detail,
            });
        } catch (error) {
            console.warn(`[BlueskyReview] Audit write failed for ${id}: ${error.message}`);
        }
    }

    async edit(id, candidateText, context = {}) {
        this._pendingReview(id);
        const guarded = await this.guardText(String(candidateText || ''), 'edited Bluesky reply draft');
        const text = String(guarded.text || candidateText || '').trim();
        this.assertPost(text, { platform: 'bluesky', type: 'edited_reply_draft' });
        if (!this.store.updateReviewText(id, text)) throw new Error('Review was already resolved');
        this._audit(id, 'edited', context, { length: text.length });
        return { id: Number(id), text };
    }

    reject(id, context = {}) {
        this._pendingReview(id);
        if (!this.store.resolveReview(id, { status: 'rejected' })) throw new Error('Review was already resolved');
        this._audit(id, 'rejected', context, { reason: String(context.reason || '').slice(0, 300) });
        return { id: Number(id), status: 'rejected' };
    }

    async approve(id, context = {}) {
        const pending = this._pendingReview(id);
        if (!/assisted draft/i.test(pending.reason || '')) {
            const error = new Error('Only generated assisted drafts can be approved');
            error.code = 'REVIEW_NOT_APPROVABLE';
            throw error;
        }

        const row = this.store.claimReviewForApproval(id);
        if (!row) throw new Error('Review was already claimed or resolved');
        let posted = null;
        try {
            const guarded = await this.guardText(row.text, 'operator-approved Bluesky reply');
            const approvedText = String(guarded.text || row.text || '').trim();
            this.assertPost(approvedText, { platform: 'bluesky', type: 'approved_reply' });
            posted = await this.client.reply(
                approvedText,
                { uri: row.parent_uri, cid: row.parent_cid },
                { uri: row.root_uri, cid: row.root_cid },
            );
            if (!this.store.completeReviewApproval(id, posted?.uri || '')) {
                throw new Error('Posted reply could not be finalized in the review ledger');
            }
            socialContextProvider.recordOutboundPost({
                platform: 'bluesky',
                text: approvedText,
                type: 'reply',
                recipient: row.handle ? (row.handle.startsWith('@') ? row.handle : `@${row.handle}`) : 'public',
                inboundText: row.text || null,
                uri: posted?.uri || '',
                threadUri: row.thread_uri || null,
                timestamp: Date.now()
            }).catch(() => {});
            this._audit(id, 'approved', context, { responseUri: posted?.uri || '' });
            return { id: Number(id), status: 'approved', responseUri: posted?.uri || '' };
        } catch (error) {
            this.store.failReviewApproval(id, { posted: Boolean(posted), responseUri: posted?.uri || '' });
            this._audit(id, posted ? 'approval_uncertain' : 'approval_failed', context, { error: error.message });
            throw error;
        }
    }
}

export default new BlueskyReviewService();
