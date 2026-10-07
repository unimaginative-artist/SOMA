import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const MIME_BY_EXTENSION = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function detectedMime(bytes) {
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

export async function inspectGeneratedImage(filePath, { maxBytes = 8_000_000 } = {}) {
    if (!filePath || typeof filePath !== 'string') throw new Error('Image provider returned no file path.');
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat?.isFile() || stat.size === 0) throw new Error('Generated image file is missing or empty.');
    if (stat.size > maxBytes) throw new Error(`Generated image exceeds the ${maxBytes}-byte upload limit.`);
    const bytes = await fs.readFile(filePath);
    const mimeType = detectedMime(bytes);
    const extensionMime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
    if (!mimeType || mimeType !== extensionMime) throw new Error('Generated image has invalid or mismatched image bytes/MIME type.');
    let metadata;
    try { metadata = await sharp(bytes).metadata(); }
    catch { throw new Error('Generated image could not be decoded.'); }
    if (!metadata.width || !metadata.height || metadata.width < 16 || metadata.height < 16) {
        throw new Error('Generated image has invalid or effectively blank dimensions.');
    }
    return {
        path: path.resolve(filePath), name: path.basename(filePath), size: bytes.length,
        mimeType, width: metadata.width, height: metadata.height,
        sha256: crypto.createHash('sha256').update(bytes).digest('hex')
    };
}

export function verifyDiscordImageDelivery(sent, artifact) {
    if (!sent?.id) throw new Error('Discord did not return a message ID for the image upload.');
    const attachments = sent.attachments?.values ? [...sent.attachments.values()] : Array.isArray(sent.attachments) ? sent.attachments : [];
    const uploaded = attachments.find(item => item?.name === artifact.name && Number(item?.size) > 0 && /^https:\/\//i.test(item?.url || ''));
    if (!uploaded || (uploaded.contentType && uploaded.contentType !== artifact.mimeType)) {
        throw new Error('Discord did not confirm a matching non-empty image attachment.');
    }
    return { messageId: sent.id, attachmentId: uploaded.id || null, url: uploaded.url, size: uploaded.size, mimeType: uploaded.contentType || artifact.mimeType };
}

export async function persistImageReceipt(receipt, root = process.cwd()) {
    const id = String(receipt.requestId || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '-');
    const directory = path.join(root, 'data', 'discord', 'image-receipts');
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, `${id}.json`);
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ ...receipt, recordedAt: new Date().toISOString() }, null, 2));
    await fs.rename(temporary, target);
    return target;
}
