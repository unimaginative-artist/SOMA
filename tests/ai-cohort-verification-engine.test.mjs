import test from 'node:test';
import assert from 'node:assert/strict';
import { AiCohortVerificationEngine } from '../core/AiCohortVerificationEngine.js';

test('AiCohortVerificationEngine: strictly blocks under-18 users from Studio', async () => {
    const engine = new AiCohortVerificationEngine();
    
    // 16 years old
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 16);
    const birthDate = dob.toISOString().split('T')[0];

    const result = await engine.verifyHumanCohort({
        userId: 'usr-minor-test',
        birthDate,
        faceLivenessScore: 0.95
    });

    assert.equal(result.success, false);
    assert.equal(result.eligible, false);
    assert.equal(result.blocked, true);
    assert.equal(result.trustTier, 'BLOCKED_MINOR');
    assert.equal(result.cohort, 'minor');
    assert.ok(result.error.includes('Under 18 is strictly blocked'));
});

test('AiCohortVerificationEngine: verifies Young Adult (18-22) as HUMAN_VERIFIED_YOUNG', async () => {
    const engine = new AiCohortVerificationEngine();
    
    // 19 years old
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 19);
    const birthDate = dob.toISOString().split('T')[0];

    const result = await engine.verifyHumanCohort({
        userId: 'usr-young-test',
        birthDate,
        faceLivenessScore: 0.92
    });

    assert.equal(result.success, true);
    assert.equal(result.eligible, true);
    assert.equal(result.trustTier, 'HUMAN_VERIFIED_YOUNG');
    assert.equal(result.cohort, 'young_adult');
    assert.equal(result.cohortLabel, 'Young Adult (18-22)');
    assert.ok(result.attestation.attestationDigest);
    assert.equal(result.attestation.verifiedBy, 'SOMA_COGNITIVE_AI_VERIFIER');
});

test('AiCohortVerificationEngine: verifies Core Adult (23-35) as HUMAN_VERIFIED_CORE', async () => {
    const engine = new AiCohortVerificationEngine();
    
    // 27 years old
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 27);
    const birthDate = dob.toISOString().split('T')[0];

    const result = await engine.verifyHumanCohort({
        userId: 'usr-core-test',
        birthDate,
        faceLivenessScore: 0.90
    });

    assert.equal(result.success, true);
    assert.equal(result.eligible, true);
    assert.equal(result.trustTier, 'HUMAN_VERIFIED_CORE');
    assert.equal(result.cohort, 'core_adult');
    assert.equal(result.cohortLabel, 'Core Adult (23-35)');
});

test('AiCohortVerificationEngine: verifies Mature Adult (36+) as HUMAN_VERIFIED_MATURE', async () => {
    const engine = new AiCohortVerificationEngine();
    
    // 44 years old
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 44);
    const birthDate = dob.toISOString().split('T')[0];

    const result = await engine.verifyHumanCohort({
        userId: 'usr-mature-test',
        birthDate,
        faceLivenessScore: 0.96
    });

    assert.equal(result.success, true);
    assert.equal(result.eligible, true);
    assert.equal(result.trustTier, 'HUMAN_VERIFIED_MATURE');
    assert.equal(result.cohort, 'mature_adult');
    assert.equal(result.cohortLabel, 'Mature Adult (36+)');
});

test('AiCohortVerificationEngine: rejects low face liveness score (< 80%)', async () => {
    const engine = new AiCohortVerificationEngine({ minConfidence: 0.80 });
    
    // 25 years old
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 25);
    const birthDate = dob.toISOString().split('T')[0];

    const result = await engine.verifyHumanCohort({
        userId: 'usr-spoof-test',
        birthDate,
        faceLivenessScore: 0.65 // low confidence / spoof
    });

    assert.equal(result.success, false);
    assert.equal(result.eligible, false);
    assert.ok(result.error.includes('Live face selfie verification failed'));
});
