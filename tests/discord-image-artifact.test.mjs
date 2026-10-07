import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { inspectGeneratedImage, verifyDiscordImageDelivery, persistImageReceipt } from '../server/discord/DiscordImageArtifact.js';

test('a decoded, non-empty image and confirmed Discord attachment produce a receipt', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-image-receipt-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const imagePath = path.join(root, 'warrior-squirrel.png');
    await fs.writeFile(imagePath, await sharp({ create: { width: 64, height: 64, channels: 4, background: '#79452a' } }).png().toBuffer());
    const artifact = await inspectGeneratedImage(imagePath);
    assert.equal(artifact.mimeType, 'image/png');
    assert.equal(artifact.width, 64);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
    const delivery = verifyDiscordImageDelivery({ id: 'discord-message', attachments: new Map([['a', {
        id: 'a', name: artifact.name, size: artifact.size, contentType: 'image/png', url: 'https://cdn.discordapp.com/image.png'
    }]]) }, artifact);
    const receiptPath = await persistImageReceipt({ requestId: 'request-1', status: 'delivered', artifact, delivery }, root);
    const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
    assert.equal(receipt.status, 'delivered');
    assert.equal(receipt.delivery.messageId, 'discord-message');
});

test('provider failure, empty output, invalid MIME, and undecodable bytes do not pass', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'soma-image-invalid-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    await assert.rejects(inspectGeneratedImage(null), /no file path/);
    const empty = path.join(root, 'empty.png');
    await fs.writeFile(empty, '');
    await assert.rejects(inspectGeneratedImage(empty), /missing or empty/);
    const fake = path.join(root, 'fake.png');
    await fs.writeFile(fake, 'not an image');
    await assert.rejects(inspectGeneratedImage(fake), /invalid or mismatched/);
    const truncated = path.join(root, 'truncated.png');
    await fs.writeFile(truncated, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await assert.rejects(inspectGeneratedImage(truncated), /could not be decoded/);
});

test('missing or invalid Discord upload confirmation is not a delivered image', () => {
    const artifact = { name: 'warrior-squirrel.png', mimeType: 'image/png', size: 100 };
    assert.throws(() => verifyDiscordImageDelivery(null, artifact), /message ID/);
    assert.throws(() => verifyDiscordImageDelivery({ id: 'm', attachments: new Map() }, artifact), /matching non-empty/);
    assert.throws(() => verifyDiscordImageDelivery({ id: 'm', attachments: [{ name: artifact.name, size: 0, url: 'https://cdn.discordapp.com/a' }] }, artifact), /matching non-empty/);
    assert.throws(() => verifyDiscordImageDelivery({ id: 'm', attachments: [{ name: artifact.name, size: 100, contentType: 'text/html', url: 'https://cdn.discordapp.com/a' }] }, artifact), /matching non-empty/);
});
