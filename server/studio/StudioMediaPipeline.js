import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const bundledFfmpeg = require('ffmpeg-static');

const ROOT = path.join(process.cwd(), 'SOMA', 'studio-media');
const DB_FILE = path.join(ROOT, 'media-jobs.db');
const SOURCE_DIR = path.join(ROOT, 'source');
const THUMB_DIR = path.join(ROOT, 'thumbnails');
const HLS_DIR = path.join(ROOT, 'hls');
const DEFAULT_QUOTA = 5 * 1024 * 1024 * 1024;

function cleanName(value = '', fallback = 'media') {
    return String(value || fallback)
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) || fallback;
}

function run(command, args) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12_000); });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-2000)}`)));
    });
}

function publicJob(row) {
    if (!row) return null;
    return {
        id: row.id,
        userId: row.user_id,
        kind: row.kind,
        status: row.status,
        originalName: row.original_name,
        mimeType: row.mime_type,
        bytes: Number(row.bytes || 0),
        sourceUrl: `/api/studio/media/source/${encodeURIComponent(row.source_name)}`,
        thumbnailUrl: row.thumbnail_name ? `/api/studio/media/thumbnail/${encodeURIComponent(row.thumbnail_name)}` : '',
        hlsUrl: row.hls_master ? `/api/studio/media/hls/${encodeURIComponent(row.id)}/${encodeURIComponent(row.hls_master)}` : '',
        attempts: Number(row.attempts || 0),
        error: row.error || '',
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        completedAt: row.completed_at ? Number(row.completed_at) : null,
    };
}

class StudioMediaPipeline {
    constructor({
        root = ROOT,
        quotaBytes = Number(process.env.STUDIO_MEDIA_QUOTA_BYTES) || DEFAULT_QUOTA,
        ffmpegPath = process.env.FFMPEG_PATH || bundledFfmpeg,
    } = {}) {
        this.root = root;
        this.sourceDir = root === ROOT ? SOURCE_DIR : path.join(root, 'source');
        this.thumbnailDir = root === ROOT ? THUMB_DIR : path.join(root, 'thumbnails');
        this.hlsDir = root === ROOT ? HLS_DIR : path.join(root, 'hls');
        this.quotaBytes = Math.max(Number(quotaBytes) || DEFAULT_QUOTA, 10 * 1024 * 1024);
        this.ffmpegPath = ffmpegPath;
        this.active = new Set();
        for (const dir of [root, this.sourceDir, this.thumbnailDir, this.hlsDir]) fs.mkdirSync(dir, { recursive: true });
        this.db = new Database(root === ROOT ? DB_FILE : path.join(root, 'media-jobs.db'));
        this.db.pragma('journal_mode = WAL');
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS media_jobs (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                bytes INTEGER NOT NULL,
                source_name TEXT NOT NULL,
                thumbnail_name TEXT NOT NULL DEFAULT '',
                hls_master TEXT NOT NULL DEFAULT '',
                attempts INTEGER NOT NULL DEFAULT 0,
                error TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS media_jobs_user_created ON media_jobs(user_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS media_jobs_status_updated ON media_jobs(status, updated_at);
            CREATE TABLE IF NOT EXISTS media_uploads (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                original_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                expected_bytes INTEGER NOT NULL,
                received_bytes INTEGER NOT NULL DEFAULT 0,
                temp_name TEXT NOT NULL,
                job_id TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS media_uploads_user_updated ON media_uploads(user_id, updated_at DESC);
        `);
        this.db.prepare("UPDATE media_jobs SET status = 'queued', error = 'Recovered after interrupted processing' WHERE status = 'processing'").run();
        this.db.prepare("UPDATE media_uploads SET status = 'receiving' WHERE status = 'writing'").run();
        this._purgeExpiredUploads();
        setImmediate(() => this.resume().catch(() => {}));
    }

    usage(userId) {
        const used = Number(this.db.prepare(`
            SELECT COALESCE(SUM(bytes), 0) AS used
            FROM media_jobs
            WHERE user_id = ? AND status <> 'deleted'
        `).get(String(userId || ''))?.used || 0);
        return { userId, usedBytes: used, quotaBytes: this.quotaBytes, remainingBytes: Math.max(0, this.quotaBytes - used) };
    }

    ingest(file, { userId, kind = 'signal' } = {}) {
        if (!file?.path || !fs.existsSync(file.path)) throw new Error('Uploaded media file is unavailable');
        const bytes = Number(file.size || fs.statSync(file.path).size || 0);
        const quota = this.usage(userId);
        if (bytes <= 0) throw new Error('Uploaded media is empty');
        if (quota.usedBytes + bytes > quota.quotaBytes) {
            const error = new Error('Studio media storage quota exceeded');
            error.code = 'MEDIA_QUOTA_EXCEEDED';
            error.status = 413;
            throw error;
        }
        const id = `media-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
        const ext = path.extname(file.originalname || file.filename || '').toLowerCase() || '.mp4';
        const sourceName = `${id}-${cleanName(path.basename(file.originalname || 'upload', ext))}${ext}`;
        const destination = path.join(this.sourceDir, sourceName);
        try { fs.renameSync(file.path, destination); }
        catch {
            fs.copyFileSync(file.path, destination);
            fs.rmSync(file.path, { force: true });
        }
        const now = Date.now();
        this.db.prepare(`
            INSERT INTO media_jobs (
                id, user_id, kind, status, original_name, mime_type, bytes,
                source_name, created_at, updated_at
            ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            String(userId || 'unknown'),
            ['signal', 'brainrot', 'live-recording'].includes(kind) ? kind : 'signal',
            cleanName(file.originalname || sourceName),
            String(file.mimetype || 'video/mp4').slice(0, 120),
            bytes,
            sourceName,
            now,
            now,
        );
        setImmediate(() => this.process(id).catch(() => {}));
        return this.get(id);
    }

    beginUpload({ userId, kind = 'brainrot', originalName = 'upload.mp4', mimeType = 'video/mp4', bytes = 0 } = {}) {
        const expectedBytes = Number(bytes || 0);
        if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) throw new Error('Upload size must be a positive integer');
        const quota = this.usage(userId);
        const pendingBytes = Number(this.db.prepare(`
            SELECT COALESCE(SUM(expected_bytes), 0) AS value
            FROM media_uploads
            WHERE user_id = ? AND status IN ('receiving', 'writing', 'uploaded')
        `).get(String(userId || ''))?.value || 0);
        if (quota.usedBytes + pendingBytes + expectedBytes > quota.quotaBytes) {
            const error = new Error('Studio media storage quota exceeded');
            error.code = 'MEDIA_QUOTA_EXCEEDED';
            error.status = 413;
            throw error;
        }
        const id = `upload-${Date.now()}-${crypto.randomBytes(5).toString('hex')}`;
        const tempName = `${id}.part`;
        const now = Date.now();
        fs.writeFileSync(path.join(this.sourceDir, tempName), Buffer.alloc(0), { flag: 'wx' });
        this.db.prepare(`
            INSERT INTO media_uploads (
                id, user_id, kind, status, original_name, mime_type,
                expected_bytes, received_bytes, temp_name, created_at, updated_at, expires_at
            ) VALUES (?, ?, ?, 'receiving', ?, ?, ?, 0, ?, ?, ?, ?)
        `).run(
            id,
            String(userId || 'unknown'),
            ['signal', 'brainrot', 'live-recording'].includes(kind) ? kind : 'brainrot',
            cleanName(originalName),
            String(mimeType || 'video/mp4').slice(0, 120),
            expectedBytes,
            tempName,
            now,
            now,
            now + 24 * 60 * 60 * 1000,
        );
        return this.uploadStatus(id, userId);
    }

    uploadStatus(id, userId) {
        const row = this.db.prepare('SELECT * FROM media_uploads WHERE id = ? AND user_id = ?').get(String(id || ''), String(userId || ''));
        return row ? {
            id: row.id,
            status: row.status,
            kind: row.kind,
            originalName: row.original_name,
            mimeType: row.mime_type,
            expectedBytes: Number(row.expected_bytes),
            receivedBytes: Number(row.received_bytes),
            offset: Number(row.received_bytes),
            jobId: row.job_id || '',
            expiresAt: Number(row.expires_at),
        } : null;
    }

    appendUpload(id, userId, offset, chunk) {
        const row = this.db.prepare('SELECT * FROM media_uploads WHERE id = ? AND user_id = ?').get(String(id || ''), String(userId || ''));
        if (!row) return null;
        if (!['receiving', 'writing'].includes(row.status)) throw new Error(`Upload is ${row.status}`);
        const expectedOffset = Number(row.received_bytes);
        if (Number(offset) !== expectedOffset) {
            const error = new Error(`Upload offset mismatch; resume at ${expectedOffset}`);
            error.code = 'UPLOAD_OFFSET_MISMATCH';
            error.status = 409;
            error.offset = expectedOffset;
            throw error;
        }
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
        if (!data.length) throw new Error('Upload chunk is empty');
        if (expectedOffset + data.length > Number(row.expected_bytes)) throw new Error('Upload chunk exceeds declared size');
        const file = path.join(this.sourceDir, row.temp_name);
        this.db.prepare("UPDATE media_uploads SET status = 'writing', updated_at = ? WHERE id = ?").run(Date.now(), row.id);
        fs.appendFileSync(file, data);
        const received = expectedOffset + data.length;
        const status = received === Number(row.expected_bytes) ? 'uploaded' : 'receiving';
        this.db.prepare('UPDATE media_uploads SET status = ?, received_bytes = ?, updated_at = ? WHERE id = ?')
            .run(status, received, Date.now(), row.id);
        return this.uploadStatus(row.id, userId);
    }

    completeUpload(id, userId) {
        const row = this.db.prepare('SELECT * FROM media_uploads WHERE id = ? AND user_id = ?').get(String(id || ''), String(userId || ''));
        if (!row) return null;
        if (row.status === 'completed' && row.job_id) return { upload: this.uploadStatus(id, userId), job: this.get(row.job_id) };
        if (Number(row.received_bytes) !== Number(row.expected_bytes) || row.status !== 'uploaded') {
            const error = new Error(`Upload is incomplete; resume at ${row.received_bytes}`);
            error.code = 'UPLOAD_INCOMPLETE';
            error.status = 409;
            error.offset = Number(row.received_bytes);
            throw error;
        }
        const tempPath = path.join(this.sourceDir, row.temp_name);
        const job = this.ingest({
            path: tempPath,
            size: Number(row.expected_bytes),
            originalname: row.original_name,
            mimetype: row.mime_type,
        }, { userId: row.user_id, kind: row.kind });
        this.db.prepare("UPDATE media_uploads SET status = 'completed', job_id = ?, updated_at = ? WHERE id = ?")
            .run(job.id, Date.now(), row.id);
        return { upload: this.uploadStatus(id, userId), job };
    }

    get(id) {
        return publicJob(this.db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(String(id || '')));
    }

    list(userId, { limit = 50 } = {}) {
        return this.db.prepare('SELECT * FROM media_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
            .all(String(userId || ''), Math.min(Math.max(Number(limit) || 50, 1), 200))
            .map(publicJob);
    }

    async retry(id, userId) {
        const row = this.db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(id);
        if (!row || row.user_id !== userId) return null;
        if (Number(row.attempts || 0) >= 3) throw new Error('Media job exhausted its retry budget');
        this.db.prepare("UPDATE media_jobs SET status = 'queued', error = '', updated_at = ? WHERE id = ?").run(Date.now(), id);
        await this.process(id);
        return this.get(id);
    }

    async resume() {
        const jobs = this.db.prepare("SELECT id FROM media_jobs WHERE status IN ('queued', 'awaiting_processor') AND attempts < 3 ORDER BY created_at LIMIT 20").all();
        for (const job of jobs) await this.process(job.id);
    }

    async process(id) {
        if (this.active.has(id)) return this.get(id);
        const row = this.db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(id);
        if (!row || !['queued', 'awaiting_processor'].includes(row.status) || Number(row.attempts || 0) >= 3) return publicJob(row);
        if (!this.ffmpegPath || !fs.existsSync(this.ffmpegPath)) {
            this.db.prepare("UPDATE media_jobs SET status = 'awaiting_processor', error = 'ffmpeg is unavailable', updated_at = ? WHERE id = ?").run(Date.now(), id);
            return this.get(id);
        }
        this.active.add(id);
        const attempts = Number(row.attempts || 0) + 1;
        this.db.prepare("UPDATE media_jobs SET status = 'processing', attempts = ?, error = '', updated_at = ? WHERE id = ?")
            .run(attempts, Date.now(), id);
        const source = path.join(this.sourceDir, row.source_name);
        const thumbnailName = `${id}.jpg`;
        const thumbnail = path.join(this.thumbnailDir, thumbnailName);
        const outputDir = path.join(this.hlsDir, id);
        fs.mkdirSync(outputDir, { recursive: true });
        try {
            await run(this.ffmpegPath, ['-y', '-ss', '0.1', '-i', source, '-frames:v', '1', '-vf', 'scale=640:-2', thumbnail]);
            const variants = [
                { name: '480p', height: 480, bitrate: '1000k', bandwidth: 1200000 },
                { name: '720p', height: 720, bitrate: '2500k', bandwidth: 2800000 },
            ];
            for (const variant of variants) {
                await run(this.ffmpegPath, [
                    '-y', '-i', source,
                    '-vf', `scale=-2:${variant.height}`,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-b:v', variant.bitrate,
                    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
                    '-hls_time', '4', '-hls_playlist_type', 'vod',
                    '-hls_segment_filename', path.join(outputDir, `${variant.name}-%05d.ts`),
                    path.join(outputDir, `${variant.name}.m3u8`),
                ]);
            }
            const master = [
                '#EXTM3U',
                '#EXT-X-VERSION:3',
                ...variants.flatMap(variant => [
                    `#EXT-X-STREAM-INF:BANDWIDTH=${variant.bandwidth},RESOLUTION=${Math.round(variant.height * 16 / 9)}x${variant.height}`,
                    `${variant.name}.m3u8`,
                ]),
                '',
            ].join('\n');
            fs.writeFileSync(path.join(outputDir, 'master.m3u8'), master);
            this.db.prepare(`
                UPDATE media_jobs
                SET status = 'ready', thumbnail_name = ?, hls_master = 'master.m3u8',
                    error = '', updated_at = ?, completed_at = ?
                WHERE id = ?
            `).run(thumbnailName, Date.now(), Date.now(), id);
        } catch (error) {
            const status = attempts >= 3 ? 'failed' : 'queued';
            this.db.prepare('UPDATE media_jobs SET status = ?, error = ?, updated_at = ? WHERE id = ?')
                .run(status, String(error.message || error).slice(0, 4000), Date.now(), id);
        } finally {
            this.active.delete(id);
        }
        return this.get(id);
    }

    resolveAsset(scope, jobId, name = '') {
        const safe = path.basename(String(name || ''));
        if (scope === 'source') return path.join(this.sourceDir, path.basename(String(jobId || '')));
        if (scope === 'thumbnail') return path.join(this.thumbnailDir, path.basename(String(jobId || '')));
        if (scope === 'hls') return path.join(this.hlsDir, path.basename(String(jobId || '')), safe);
        return '';
    }

    close() {
        this.db.close();
    }

    _purgeExpiredUploads(now = Date.now()) {
        const expired = this.db.prepare("SELECT temp_name FROM media_uploads WHERE expires_at <= ? AND status <> 'completed'").all(now);
        for (const row of expired) fs.rmSync(path.join(this.sourceDir, row.temp_name), { force: true });
        this.db.prepare("DELETE FROM media_uploads WHERE expires_at <= ? AND status <> 'completed'").run(now);
    }
}

export { StudioMediaPipeline };
export default new StudioMediaPipeline();
