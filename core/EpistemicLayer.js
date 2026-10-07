import crypto from 'crypto';
import { Poseidon } from './Poseidon.js';
import { recordReality } from './RealityLedger.js';
import { atomicWriteJson } from './AtomicJsonStore.cjs';
import path from 'path';

export const CLAIM_TYPE = {
  OBSERVATION: 'OBSERVATION',
  INFERENCE: 'INFERENCE',
  PLAN: 'PLAN',
  INTENTION: 'INTENTION',
  ATTEMPT: 'ATTEMPT',
  ACTION: 'ACTION',
  RESULT: 'RESULT',
  CITATION: 'CITATION',
};

export const CLAIM_STATUS = {
  PROPOSED: 'PROPOSED',
  PENDING_EVIDENCE: 'PENDING_EVIDENCE',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
};

const MEMORY_SAFE_TYPES = new Set([
  CLAIM_TYPE.OBSERVATION,
  CLAIM_TYPE.ACTION,
  CLAIM_TYPE.RESULT,
]);

function canEnterMemory(claim) {
  return (
    claim.status === CLAIM_STATUS.VERIFIED &&
    MEMORY_SAFE_TYPES.has(claim.type)
  );
}

class EpistemicLayer {
  constructor() {
    this.poseidon = new Poseidon({ threshold: 0.8 });
  }

  async processClaim(text, {
    type,
    evidence = [],
    falsificationTest = null,
    testResult = null,
    expiresAt = null,
    metadata = {}
  } = {}) {
    const claim = {
      id: crypto.randomUUID(),
      text,
      type,
      evidence,
      status: CLAIM_STATUS.PROPOSED,
      memorySafe: false,
      createdAt: new Date().toISOString(),
      expiresAt,
      metadata
    };

    if (type === CLAIM_TYPE.INTENTION || type === CLAIM_TYPE.PLAN || type === CLAIM_TYPE.ATTEMPT) {
      claim.status = CLAIM_STATUS.PENDING_EVIDENCE;
      await this.saveToScratchpad(claim);
      return claim;
    }

    if (type === CLAIM_TYPE.ACTION && (!evidence || evidence.length === 0)) {
        claim.status = CLAIM_STATUS.PENDING_EVIDENCE;
        await this.saveToScratchpad(claim);
        return claim;
    }

    
    if (type === CLAIM_TYPE.CITATION) {
        const quote = text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/["']/g, '');
        const sourceText = evidence.join(' ').toLowerCase().replace(/\s+/g, ' ').replace(/["']/g, '');
        
        if (quote.length > 5 && (sourceText.includes(quote) || sourceText.includes(quote.substring(0, Math.floor(quote.length / 2))))) {
            claim.status = CLAIM_STATUS.VERIFIED;
            claim.memorySafe = true;
        } else {
            claim.status = CLAIM_STATUS.REJECTED;
            claim.metadata.rejectionReason = 'Quote not found in source text';
        }
        return claim;
    }

    const verdict = await this.poseidon.verify(text, {
      falsificationTest,
      testResult,
    });

    if (verdict.state === 'TRUE') {
      claim.status = CLAIM_STATUS.VERIFIED;
      claim.memorySafe = canEnterMemory(claim);
      if (claim.memorySafe) {
          await recordReality(text, { proof: verdict, metadata });
      }
    } else if (verdict.state === 'FALSE') {
      claim.status = CLAIM_STATUS.REJECTED;
    } else {
      claim.status = CLAIM_STATUS.PENDING_EVIDENCE;
    }

    return claim;
  }

  async saveToScratchpad(claim) {
      const spPath = path.join(process.cwd(), 'data', 'epistemic-scratchpad.jsonl');
      await atomicWriteJson(spPath, claim); // Simple overwrite or append logic for scratchpad
  }
}

export const epistemicLayer = new EpistemicLayer();
