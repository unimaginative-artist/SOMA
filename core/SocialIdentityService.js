const INTRODUCTION = /\b(?:hello|hi|hey)?[,.! ]*(?:my name is|i am|i'm|this is)\s+([\p{L}][\p{L}' -]{0,49}?)(?=[,.!?]|$)/iu;

/** Consent-based bridge between a spoken introduction and a current person track. */
export class SocialIdentityService {
    constructor({ objectMemory, stateGateway = null, mnemonic = null, maxVisualAgeMs = 5_000 } = {}) {
        this.objectMemory = objectMemory;
        this.stateGateway = stateGateway;
        this.mnemonic = mnemonic;
        this.maxVisualAgeMs = maxVisualAgeMs;
    }

    parseIntroduction(transcript) {
        const match = String(transcript || '').trim().match(INTRODUCTION);
        return match ? { displayName: match[1].trim(), evidenceText: match[0].trim() } : null;
    }

    async processIntroduction(transcript, { timestamp = Date.now(), source = 'microphone' } = {}) {
        const introduction = this.parseIntroduction(transcript);
        if (!introduction) return { handled: false, reason: 'no_explicit_introduction' };
        const people = this.objectMemory.getActive().filter(track => track.category === 'person' && timestamp - track.lastSeen <= this.maxVisualAgeMs);
        if (people.length !== 1) {
            return { handled: true, enrolled: false, reason: people.length ? 'ambiguous_multiple_people' : 'no_recent_person', clarificationRequired: true };
        }
        const profile = this.objectMemory.enrollIdentity(people[0].trackId, introduction.displayName, {
            timestamp,
            consentSource: 'spoken_self_introduction',
            evidence: { transcript: introduction.evidenceText, source, observedAt: timestamp }
        });
        await this.mnemonic?.remember?.(`${profile.displayName} explicitly introduced themselves while visible to SOMA.`, {
            type: 'consented_social_identity', importance: 7, profileId: profile.profileId, source
        }).catch(() => {});
        await this.stateGateway?.publish?.('social', 'current_person', {
            profileId: profile.profileId, displayName: profile.displayName, trackId: profile.trackId
        }, { owner: 'SocialIdentityService', source, status: 'verified', confidence: 1, evidence: { consent: 'spoken_self_introduction', transcript: introduction.evidenceText } });
        return { handled: true, enrolled: true, profile, response: `Hello ${profile.displayName}. I’ll remember that you introduced yourself.` };
    }
}

export default SocialIdentityService;
