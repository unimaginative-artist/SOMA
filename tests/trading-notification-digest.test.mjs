import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TradingNotificationDigest } from '../server/services/TradingNotificationDigest.js';
import { NotificationService } from '../server/services/NotificationService.js';
import { OutboundAutonomyGate } from '../core/OutboundAutonomyGate.js';

test('routine trading events aggregate durably by structured key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-trading-digest-'));
    let now = 1000;
    try {
        const statePath = path.join(dir, 'digest.json');
        const digest = new TradingNotificationDigest({ statePath, now: () => now });
        digest.queue({ eventType: 'engine_resume', dedupeKey: 'resume:SOL:v1', title: 'Resume', description: 'SOL resumed' });
        digest.queue({ eventType: 'engine_resume', dedupeKey: 'resume:SOL:v1', title: 'Resume', description: 'SOL resumed' });
        assert.equal(new TradingNotificationDigest({ statePath, now: () => now }).peek()[0].count, 2);
        digest.consume(['resume:SOL:v1']);
        assert.equal(digest.peek().length, 0);
        assert.equal(digest.isDuplicate({ dedupeKey: 'resume:SOL:v1' }, 5000), true);
        now += 5001;
        assert.equal(digest.isDuplicate({ dedupeKey: 'resume:SOL:v1' }, 5000), false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('NotificationService queues routine events without publishing immediately', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-notification-service-'));
    try {
        const digest = new TradingNotificationDigest({ statePath: path.join(dir, 'digest.json') });
        const service = new NotificationService({ digest });
        let published = 0;
        service._publishToBot = () => { published += 1; };
        const result = await service.sendAlert('Engine Auto-Resumed', 'SOL resumed', {
            delivery: 'digest', eventType: 'engine_resume', dedupeKey: 'resume:SOL:v1'
        });
        assert.equal(result.queued, true);
        assert.equal(published, 0);
        assert.equal(digest.summary().pendingOccurrences, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('NotificationService requires a Discord message receipt before marking delivery', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'soma-notification-ack-'));
    try {
        let acknowledged = false;
        const digest = new TradingNotificationDigest({ statePath: path.join(dir, 'digest.json') });
        const gate = new OutboundAutonomyGate({ statePath: path.join(dir, 'gate.json') });
        const service = new NotificationService({ digest, gate, broker: { publish: async (_topic, envelope) => {
            if (acknowledged) envelope.payload.deliveryReceipt = { messageId: 'discord-message-42' };
            return 1;
        } } });
        const options = { dedupeKey: 'daily:test', eventType: 'trading_daily' };
        const failed = await service.sendAlert('Daily Trading and RSI Review', 'Evidence', options);
        assert.equal(failed.sent, false);
        assert.equal(failed.reason, 'discord_delivery_unverified');
        acknowledged = true;
        const delivered = await service.sendAlert('Daily Trading and RSI Review', 'Evidence', options);
        assert.equal(delivered.sent, true);
        assert.equal(delivered.messageId, 'discord-message-42');
        assert.equal((await service.sendAlert('Daily Trading and RSI Review', 'Evidence', options)).suppressed, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
