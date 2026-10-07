import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { sendMaxPeerMessage } from '../discord/MaxPeerMessage.js';

const PREFIX = 'soma-live-review';
const VALIDITY_MS = 24 * 60 * 60 * 1000;

export function candidateFingerprint(candidate) {
    return crypto.createHash('sha256').update(JSON.stringify({
        id: candidate.id, key: candidate.key, strategyId: candidate.strategyId,
        symbol: candidate.symbol, compiledStrategyId: candidate.compiledStrategy?.id,
        simulation: candidate.simulation, paper: candidate.paper
    })).digest('hex');
}

function policyFingerprint(policy) {
    return crypto.createHash('sha256').update(JSON.stringify(policy || {})).digest('hex');
}

export function approvalButtons(fingerprint) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${PREFIX}:approve:${fingerprint}`)
            .setLabel('Approve candidate').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${PREFIX}:reject:${fingerprint}`)
            .setLabel('Reject candidate').setStyle(ButtonStyle.Danger)
    )];
}

async function readJson(file) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export class DiscordLiveCandidateApproval {
    constructor({ root = process.cwd(), reportPath, maxBridge, client, masterId,
        maxReview = sendMaxPeerMessage, now = () => Date.now() } = {}) {
        this.root = root;
        this.reportPath = reportPath || path.join(root, 'data', 'trading', 'sim-to-live-report.json');
        this.directory = path.join(root, 'data', 'trading', 'live-candidate-approvals');
        this.maxBridge = maxBridge;
        this.client = client;
        this.masterId = String(masterId || '');
        this.maxReview = maxReview;
        this.now = now;
        this.inFlight = new Set();
    }

    _receiptPath(fingerprint) { return path.join(this.directory, `${fingerprint}.json`); }
    _decisionPath(fingerprint) { return path.join(this.directory, `${fingerprint}.decision.json`); }

    async notifyFromReport(report) {
        if (!this.masterId || !this.client?.users?.fetch || report?.success !== true) return [];
        const sent = [];
        for (const candidate of report.liveCandidates || []) {
            if (candidate.live?.candidate !== true || candidate.live?.requiresHumanApproval !== true
                || candidate.action !== 'eligible_for_human_live_review') continue;
            const fingerprint = candidateFingerprint(candidate);
            if (this.inFlight.has(fingerprint)) continue;
            this.inFlight.add(fingerprint);
            try {
                if (await readJson(this._receiptPath(fingerprint)) || await readJson(this._decisionPath(fingerprint))) continue;
                if (!this.maxBridge) throw new Error('MAX review bridge unavailable');
                const maxReceipt = await this.maxReview({ bridge: this.maxBridge, root: this.root,
                    sourceJobId: `live-review-${fingerprint}`,
                    message: `Advisory review only. Examine this hash-pinned paper candidate. `
                        + `Recommend APPROVE, REJECT, or MORE_EVIDENCE with concise reasons. `
                        + `Do not execute, deploy, change trading state, or claim to be the human approver. `
                        + JSON.stringify({ fingerprint, id: candidate.id, key: candidate.key,
                            simulation: candidate.simulation, paper: candidate.paper }) });
                if (maxReceipt.deliveryStatus !== 'delivered' || !maxReceipt.responsePreview) {
                    throw new Error('MAX advisory review was not delivered');
                }
                const currentReport = await readJson(this.reportPath);
                if (!currentReport?.liveCandidates?.some(item => candidateFingerprint(item) === fingerprint
                    && item.live?.requiresHumanApproval === true)) continue;
                const user = await this.client.users.fetch(this.masterId);
                const paper = candidate.paper || {};
                const content = [
                    '**SOMA live candidate review — decision required**',
                    `Candidate: \`${candidate.strategyId}\` / \`${candidate.symbol}\``,
                    `Evidence hash: \`${fingerprint}\``,
                    `Paper: ${paper.trades || 0} trades; win rate ${paper.winRate || 0}%; `
                        + `profit factor ${paper.profitFactor || 0}; drawdown ${paper.maxDrawdownPct || 0}%; `
                        + `net P&L $${paper.totalPnl || 0}.`,
                    `MAX advisory: ${maxReceipt.responsePreview.slice(0, 600)}`,
                    '**Approving records your decision for this exact evidence. It does not start live trading or change trading intent.**',
                    'Buttons expire after 24 hours or when reconciliation changes the candidate.'
                ].join('\n');
                const message = await user.send({ content, components: approvalButtons(fingerprint) });
                const receipt = { fingerprint, candidateId: candidate.id, key: candidate.key,
                    policyFingerprint: policyFingerprint(currentReport.policy),
                    status: 'pending', masterId: this.masterId, messageId: String(message.id),
                    channelId: String(message.channelId), maxReviewReceiptPath: maxReceipt.receiptPath,
                    maxReviewResponseId: maxReceipt.responseId,
                    createdAt: new Date(this.now()).toISOString(), expiresAt: new Date(this.now() + VALIDITY_MS).toISOString(),
                    liveOrdersAuthorized: false };
                await fs.mkdir(this.directory, { recursive: true });
                await fs.writeFile(this._receiptPath(fingerprint), JSON.stringify(receipt, null, 2), { flag: 'wx' });
                sent.push(receipt);
            } finally { this.inFlight.delete(fingerprint); }
        }
        return sent;
    }

    async decide({ customId, userId, messageId, channelId }) {
        const match = /^soma-live-review:(approve|reject):([a-f0-9]{64})$/.exec(customId || '');
        if (!match) return { handled: false };
        const [, action, fingerprint] = match;
        if (!this.masterId || String(userId) !== this.masterId) {
            return { handled: true, accepted: false, reason: 'Only the configured owner can decide.' };
        }
        const receipt = await readJson(this._receiptPath(fingerprint));
        if (!receipt || receipt.status !== 'pending' || receipt.masterId !== this.masterId
            || receipt.messageId !== String(messageId) || receipt.channelId !== String(channelId)) {
            return { handled: true, accepted: false, reason: 'This approval message is unknown or mismatched.' };
        }
        if (this.now() >= Date.parse(receipt.expiresAt)) {
            return { handled: true, accepted: false, reason: 'This approval has expired.' };
        }
        const report = await readJson(this.reportPath);
        if (policyFingerprint(report?.policy) !== receipt.policyFingerprint) {
            return { handled: true, accepted: false, reason: 'The promotion policy changed; request a fresh review.' };
        }
        const candidate = report?.success === true && (report.liveCandidates || []).find(item =>
            candidateFingerprint(item) === fingerprint && item.id === receipt.candidateId
            && item.key === receipt.key && item.live?.requiresHumanApproval === true
            && item.action === 'eligible_for_human_live_review');
        if (!candidate) return { handled: true, accepted: false, reason: 'Candidate evidence changed or is no longer eligible.' };
        const decision = { fingerprint, candidateId: candidate.id, key: candidate.key,
            decision: action === 'approve' ? 'approved' : 'rejected',
            decidedBy: this.masterId, decidedAt: new Date(this.now()).toISOString(),
            messageId: receipt.messageId, maxReviewResponseId: receipt.maxReviewResponseId,
            liveOrdersAuthorized: false };
        try {
            await fs.writeFile(this._decisionPath(fingerprint), JSON.stringify(decision, null, 2), { flag: 'wx' });
        } catch (error) {
            if (error.code === 'EEXIST') return { handled: true, accepted: false, reason: 'This candidate was already decided.' };
            throw error;
        }
        return { handled: true, accepted: true, decision };
    }
}
