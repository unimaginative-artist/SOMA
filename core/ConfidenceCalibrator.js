/**
 * core/ConfidenceCalibrator.js
 *
 * Calibrates SOMA's confidence scores against ground truth from user corrections.
 *
 * When SOMA claims confidence=0.85 but Owner corrects her 40% of the time at that level,
 * the calibrator learns the offset and corrects future claims downward.
 *
 * Algorithm: Platt-style isotonic bucketing.
 * - Buckets: 0.0-0.1, 0.1-0.2, ..., 0.9-1.0
 * - For each bucket: track claimed count vs actual accuracy (not corrected)
 * - Calibrated confidence = bucket's empirical accuracy
 * - Falls back to raw confidence until 30+ samples per bucket
 *
 * Persists to .soma/calibration.json
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE     = path.join(__dirname, '..', 'server', '.soma', 'calibration.json');
const MIN_SAMPLES_TO_CALIBRATE = 20; // per bucket before we trust the empirical rate

function emptyBuckets() {
    const buckets = {};
    for (let i = 0; i < 10; i++) {
        buckets[i] = { count: 0, correct: 0 }; // i = bucket index (0.0-0.1 → 0, etc.)
    }
    return buckets;
}

function loadStore() {
    try {
        if (fs.existsSync(STORE)) return JSON.parse(fs.readFileSync(STORE, 'utf8'));
    } catch {}
    return { buckets: emptyBuckets(), totalSamples: 0, lastUpdated: 0 };
}

function saveStore(data) {
    try {
        const dir = path.dirname(STORE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STORE, JSON.stringify(data, null, 2));
    } catch {}
}

export class ConfidenceCalibrator {
    constructor() {
        this._data  = null;
        this._dirty = false;
    }

    _load() {
        if (!this._data) this._data = loadStore();
        // Ensure buckets exist (handles old format)
        if (!this._data.buckets) this._data.buckets = emptyBuckets();
    }

    /**
     * Record a sample: what SOMA claimed vs whether she was actually right.
     * @param {number} claimedConfidence - 0 to 1
     * @param {boolean} wasCorrected - true = SOMA was wrong (Owner corrected her)
     */
    record(claimedConfidence, wasCorrected) {
        this._load();
        const bucketIdx = Math.min(9, Math.floor(claimedConfidence * 10));
        const bucket = this._data.buckets[bucketIdx];
        bucket.count++;
        if (!wasCorrected) bucket.correct++;
        this._data.totalSamples++;
        this._data.lastUpdated = Date.now();
        this._dirty = true;

        if (this._saveTimer) clearTimeout(this._saveTimer);
        this._saveTimer = setTimeout(() => {
            if (this._dirty) { saveStore(this._data); this._dirty = false; }
        }, 3000);
    }

    /**
     * Calibrate a raw confidence score.
     * Returns adjusted confidence based on historical accuracy at that level.
     * @param {number} raw - 0 to 1
     * @returns {number} calibrated - 0 to 1
     */
    calibrate(raw) {
        this._load();
        const bucketIdx = Math.min(9, Math.floor(raw * 10));
        const bucket = this._data.buckets[bucketIdx];

        if (bucket.count < MIN_SAMPLES_TO_CALIBRATE) {
            return raw; // not enough data yet, trust raw
        }

        const empiricalAccuracy = bucket.correct / bucket.count;

        // Blend: 70% empirical, 30% raw (avoids overfit on small sample counts)
        const blended = 0.7 * empiricalAccuracy + 0.3 * raw;
        return Math.max(0.05, Math.min(0.99, blended));
    }

    /**
     * Returns a brief stats string for logging.
     */
    getStats() {
        this._load();
        const d = this._data;
        if (d.totalSamples < 10) return `calibration: ${d.totalSamples} samples (building...)`;

        const wellCalibrated = Object.values(d.buckets)
            .filter(b => b.count >= MIN_SAMPLES_TO_CALIBRATE)
            .length;
        return `calibration: ${d.totalSamples} samples, ${wellCalibrated}/10 buckets calibrated`;
    }
}

// Singleton
export const calibrator = new ConfidenceCalibrator();
