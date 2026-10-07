import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { StudioMediaPipeline } from '../server/studio/StudioMediaPipeline.js';

const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');

test('Studio media pipeline preserves originals, produces thumbnails/HLS, enforces quota, and resumes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-media-'));
    const upload = path.join(root, 'upload.mp4');
    const generated = spawnSync(ffmpeg, [
        '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1',
        '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
        '-shortest', '-c:v', 'libx264', '-c:a', 'aac', upload,
    ], { windowsHide: true });
    assert.equal(generated.status, 0, generated.stderr?.toString());

    const pipeline = new StudioMediaPipeline({ root: path.join(root, 'pipeline'), quotaBytes: 20 * 1024 * 1024, ffmpegPath: ffmpeg });
    try {
        const stat = fs.statSync(upload);
        const queued = pipeline.ingest({
            path: upload,
            size: stat.size,
            originalname: 'contract video.mp4',
            mimetype: 'video/mp4',
        }, { userId: 'owner', kind: 'signal' });
        assert.equal(fs.existsSync(pipeline.resolveAsset('source', path.basename(queued.sourceUrl))), true);

        let job = queued;
        for (let attempt = 0; attempt < 100 && !['ready', 'failed'].includes(job.status); attempt += 1) {
            await new Promise(resolve => setTimeout(resolve, 100));
            job = pipeline.get(queued.id);
        }
        assert.equal(job.status, 'ready', job.error);
        const thumbnailPath = pipeline.resolveAsset('thumbnail', path.basename(job.thumbnailUrl));
        assert.equal(fs.existsSync(thumbnailPath), true, `${job.thumbnailUrl} -> ${thumbnailPath}; files=${fs.readdirSync(pipeline.thumbnailDir).join(',')}`);
        assert.equal(fs.existsSync(pipeline.resolveAsset('hls', job.id, 'master.m3u8')), true);
        assert.match(fs.readFileSync(pipeline.resolveAsset('hls', job.id, 'master.m3u8'), 'utf8'), /480p\.m3u8[\s\S]*720p\.m3u8/);

        const sourceBytes = fs.readFileSync(pipeline.resolveAsset('source', path.basename(job.sourceUrl)));
        const resumable = pipeline.beginUpload({
            userId: 'owner',
            kind: 'brainrot',
            originalName: 'resumable-contract.mp4',
            mimeType: 'video/mp4',
            bytes: sourceBytes.length,
        });
        const split = Math.floor(sourceBytes.length / 2);
        const partial = pipeline.appendUpload(resumable.id, 'owner', 0, sourceBytes.subarray(0, split));
        assert.equal(partial.offset, split);
        assert.throws(
            () => pipeline.appendUpload(resumable.id, 'owner', 0, sourceBytes.subarray(split)),
            error => error.code === 'UPLOAD_OFFSET_MISMATCH' && error.offset === split,
        );
        const uploaded = pipeline.appendUpload(resumable.id, 'owner', split, sourceBytes.subarray(split));
        assert.equal(uploaded.status, 'uploaded');
        const completed = pipeline.completeUpload(resumable.id, 'owner');
        assert.equal(completed.upload.status, 'completed');
        assert.equal(completed.job.kind, 'brainrot');

        const oversized = path.join(root, 'oversized.mp4');
        fs.writeFileSync(oversized, 'small fixture');
        assert.throws(() => pipeline.ingest({
            path: oversized,
            size: pipeline.quotaBytes + 1,
            originalname: 'oversized.mp4',
            mimetype: 'video/mp4',
        }, { userId: 'owner', kind: 'brainrot' }), error => error.code === 'MEDIA_QUOTA_EXCEEDED');
    } finally {
        pipeline.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
