import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class VisionFeedbackLedger {
    constructor({ ledgerPath = 'data/vision/feedback.jsonl', trainingPath = 'training-data/vision-approved.jsonl' } = {}) {
        this.ledgerPath = path.resolve(ledgerPath);
        this.trainingPath = path.resolve(trainingPath);
    }

    record(entry = {}) {
        const rating = ['correct', 'incorrect', 'partial'].includes(entry.rating) ? entry.rating : null;
        if (!rating) throw new Error('rating must be correct, incorrect, or partial');
        const record = {
            id: `vision-feedback-${crypto.randomUUID()}`,
            perceptionId: String(entry.perceptionId || ''),
            rating,
            correction: String(entry.correction || '').trim().slice(0, 4000) || null,
            userId: String(entry.userId || 'local-operator').slice(0, 120),
            userOwnsMedia: entry.userOwnsMedia === true,
            trainingConsent: entry.trainingConsent === true,
            imagePath: entry.imagePath ? path.resolve(entry.imagePath) : null,
            original: entry.original || null,
            createdAt: Date.now(),
        };
        fs.mkdirSync(path.dirname(this.ledgerPath), { recursive: true });
        fs.appendFileSync(this.ledgerPath, `${JSON.stringify(record)}\n`);
        if (record.trainingConsent && record.userOwnsMedia && record.imagePath && (rating === 'incorrect' || rating === 'partial') && record.correction) {
            fs.mkdirSync(path.dirname(this.trainingPath), { recursive: true });
            fs.appendFileSync(this.trainingPath, `${JSON.stringify({
                image: record.imagePath,
                prompt: 'Describe only what is visibly present in this image.',
                response: record.correction,
                source: 'operator-correction',
                consentRecord: record.id,
            })}\n`);
        }
        return record;
    }
}

export default VisionFeedbackLedger;
