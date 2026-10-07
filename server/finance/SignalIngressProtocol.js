import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNAL_SECRET_ENV = 'SOMA_SIGNAL_INGRESS_SECRET';
export const SIGNAL_IDEMPOTENCY_HEADER = 'x-soma-idempotency-key';
export const SIGNAL_SIGNATURE_HEADER = 'x-soma-signature';
export const JOURNAL_TIMESTAMP_HEADER = 'x-soma-journal-timestamp';
export const JOURNAL_SIGNATURE_HEADER = 'x-soma-journal-signature';

export function signalMessage(key, payload) {
    return `${key}\n${JSON.stringify(payload)}`;
}

export function signalDigest(key, payload) {
    return createHash('sha256').update(signalMessage(key, payload)).digest('hex');
}

export function signSignal(secret, key, payload) {
    return createHmac('sha256', secret).update(signalMessage(key, payload)).digest('hex');
}

export function signJournalRead(secret, timestamp) {
    return createHmac('sha256', secret).update(`GET\n/api/finance/signal/journal\n${timestamp}`).digest('hex');
}

export function configuredSignalSecret(secret = process.env[SIGNAL_SECRET_ENV]) {
    return typeof secret === 'string' && Buffer.byteLength(secret, 'utf8') >= 32 ? secret : null;
}

export function verifySignalSignature(secret, key, payload, signature) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    const expected = Buffer.from(signSignal(secret, key, payload), 'hex');
    return timingSafeEqual(actual, expected);
}

export function verifyJournalRead(secret, timestamp, signature) {
    if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const actual = Buffer.from(signature, 'hex');
    const expected = Buffer.from(signJournalRead(secret, timestamp), 'hex');
    return timingSafeEqual(actual, expected);
}
