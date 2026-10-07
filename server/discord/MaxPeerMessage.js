import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redactBacktestText } from './DiscordBeeBacktestJob.js';

function publicResponse(value) {
    const raw = typeof value === 'string' ? value : String(value?.response || value?.text || value?.message || value?.result || '');
    return redactBacktestText(raw)
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<thinking>[\s\S]*$|<think>[\s\S]*$/gi, '')
        .replace(/<ending>|<\/ending>/gi, '')
        .trim()
        .slice(0, 1200);
}

export async function sendMaxPeerMessage({ bridge, message, root = process.cwd(), sourceJobId = null } = {}) {
    if (!bridge?.chat) throw new Error('MAX chat bridge unavailable');
    const content = redactBacktestText(String(message || '').trim());
    if (!content) throw new Error('Message is required');
    const messageId = crypto.randomUUID();
    const directory = path.join(root, 'data', 'inter-agent-messages');
    await fs.mkdir(directory, { recursive: true });
    const receiptPath = path.join(directory, `${messageId}.json`);
    const receipt = {
        messageId, from: 'SOMA', to: 'MAX', transport: 'cluster_http',
        sentAt: Date.now(), deliveredAt: null, deliveryStatus: 'queued',
        responseId: null, content: content.slice(0, 2000), sourceJobId,
        responsePreview: null, error: null
    };
    await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    try {
        if (bridge.isAvailable && !(await bridge.isAvailable())) throw new Error('MAX health endpoint is unavailable');
        const response = await bridge.chat(content, { persona: 'engineering', temperature: 0.1, maxTokens: 600 });
        receipt.deliveredAt = Date.now();
        receipt.deliveryStatus = 'delivered';
        receipt.responseId = crypto.createHash('sha256').update(JSON.stringify(response)).digest('hex');
        receipt.responsePreview = publicResponse(response);
        await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        return { ...receipt, receiptPath };
    } catch (error) {
        receipt.deliveryStatus = 'failed';
        receipt.error = redactBacktestText(error.message).slice(0, 300);
        await fs.writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
        return { ...receipt, receiptPath };
    }
}
