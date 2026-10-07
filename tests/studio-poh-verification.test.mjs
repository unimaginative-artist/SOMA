import test from 'node:test';
import assert from 'node:assert/strict';
import { ProofOfHumanEngine } from '../../../Studio/core/proof-of-human.js';

test('ProofOfHumanEngine: rejects underage users (< 18)', () => {
    // A 16 year old
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 16);
    const birthDate = dob.toISOString().split('T')[0];

    const result = ProofOfHumanEngine.determineCohort(birthDate);
    assert.equal(result.eligible, false);
    assert.equal(result.cohort, 'minor');
    assert.ok(result.error.includes('strictly an 18+'));
});

test('ProofOfHumanEngine: assigns young_adult cohort for 18-22 year olds', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 20);
    const birthDate = dob.toISOString().split('T')[0];

    const result = ProofOfHumanEngine.determineCohort(birthDate);
    assert.equal(result.eligible, true);
    assert.equal(result.cohort, 'young_adult');
    assert.equal(result.trustTier, 'HUMAN_VERIFIED_YOUNG');
});

test('ProofOfHumanEngine: assigns core_adult cohort for 23-35 year olds', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 28);
    const birthDate = dob.toISOString().split('T')[0];

    const result = ProofOfHumanEngine.determineCohort(birthDate);
    assert.equal(result.eligible, true);
    assert.equal(result.cohort, 'core_adult');
    assert.equal(result.trustTier, 'HUMAN_VERIFIED_CORE');
});

test('ProofOfHumanEngine: assigns mature_adult cohort for 36+ year olds', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 48);
    const birthDate = dob.toISOString().split('T')[0];

    const result = ProofOfHumanEngine.determineCohort(birthDate);
    assert.equal(result.eligible, true);
    assert.equal(result.cohort, 'mature_adult');
    assert.equal(result.trustTier, 'HUMAN_VERIFIED_MATURE');
});

test('ProofOfHumanEngine: produces cryptographic SHA-256 hashes without storing raw media', async () => {
    const hashes = await ProofOfHumanEngine.hashEvidence({
        documentText: 'STATE OF CALIFORNIA DL 12345678 DOB 1990-01-01',
        faceLandmarks: [{ x: 0.12, y: 0.34, z: 0.05 }, { x: 0.45, y: 0.67, z: -0.01 }],
        salt: 'test_salt_123'
    });

    assert.ok(hashes.documentEvidenceHash);
    assert.ok(hashes.faceVectorHash);
    assert.equal(hashes.documentEvidenceHash.length, 64); // 256 bits = 64 hex chars
    assert.equal(hashes.faceVectorHash.length, 64);
});
