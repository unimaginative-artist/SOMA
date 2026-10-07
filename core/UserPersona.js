import fs from 'fs/promises';
import path from 'path';

const DEFAULT_PROFILE = {
    name: 'User Persona',
    version: 1,
    traits: {
        cadence: 'direct, conversational, low ceremony',
        tone: 'warm but pragmatic',
        sentenceLength: 'short to medium',
        formality: 'casual-professional',
        punctuation: 'plain punctuation; avoid excessive exclamation points',
        openings: ['Hey', 'Hi'],
        closings: ['Thanks', 'Appreciate it'],
        preferences: [
            'sound like the operator, not KEVIN',
            'keep security notes out of the email body unless the operator asks',
            'avoid corporate filler',
            'preserve the user guidance over generic politeness'
        ],
        avoid: [
            'security-themed sign-offs',
            'KEVIN catchphrases',
            'overly polished marketing language',
            'long disclaimers'
        ]
    },
    examples: [],
    updatedAt: 0
};

function cloneDefaultProfile() {
    return JSON.parse(JSON.stringify(DEFAULT_PROFILE));
}

function averageSentenceWords(samples) {
    const sentences = samples
        .flatMap(sample => String(sample).split(/[.!?]+/))
        .map(sentence => sentence.trim())
        .filter(Boolean);

    if (!sentences.length) return null;
    const words = sentences.reduce((sum, sentence) => sum + sentence.split(/\s+/).filter(Boolean).length, 0);
    return Math.round(words / sentences.length);
}

export class UserPersona {
    constructor(options = {}) {
        this.profilePath = options.profilePath || path.join(process.cwd(), '.soma', 'user-persona.json');
        this.profile = null;
    }

    async load() {
        if (this.profile) return this.profile;

        try {
            const data = await fs.readFile(this.profilePath, 'utf8');
            this.profile = { ...cloneDefaultProfile(), ...JSON.parse(data) };
        } catch {
            this.profile = cloneDefaultProfile();
        }

        return this.profile;
    }

    async save() {
        await fs.mkdir(path.dirname(this.profilePath), { recursive: true });
        await fs.writeFile(this.profilePath, JSON.stringify(this.profile || cloneDefaultProfile(), null, 2));
    }

    async getProfile() {
        return this.load();
    }

    async updateProfile(patch = {}) {
        const current = await this.load();
        this.profile = {
            ...current,
            ...patch,
            traits: {
                ...current.traits,
                ...(patch.traits || {})
            },
            updatedAt: Date.now()
        };
        await this.save();
        return this.profile;
    }

    async learnFromSamples(samples = []) {
        const cleanSamples = samples
            .map(sample => String(sample || '').trim())
            .filter(Boolean)
            .slice(0, 12);

        if (!cleanSamples.length) return this.load();

        const current = await this.load();
        const avgWords = averageSentenceWords(cleanSamples);
        const hasLowercaseStart = cleanSamples.some(sample => /^[a-z]/.test(sample));
        const usesExclamation = cleanSamples.filter(sample => sample.includes('!')).length / cleanSamples.length;
        const commonClosings = cleanSamples
            .map(sample => sample.split('\n').map(line => line.trim()).filter(Boolean).at(-1))
            .filter(line => line && line.length <= 40)
            .slice(-5);

        this.profile = {
            ...current,
            traits: {
                ...current.traits,
                sentenceLength: avgWords && avgWords <= 12
                    ? 'short'
                    : avgWords && avgWords >= 24
                        ? 'longer, more explanatory'
                        : current.traits.sentenceLength,
                punctuation: usesExclamation > 0.35
                    ? 'comfortable with occasional exclamation points'
                    : current.traits.punctuation,
                cadence: hasLowercaseStart
                    ? 'casual, quick, text-message cadence'
                    : current.traits.cadence,
                closings: commonClosings.length ? [...new Set(commonClosings)] : current.traits.closings
            },
            examples: [...(current.examples || []), ...cleanSamples].slice(-20),
            updatedAt: Date.now()
        };

        await this.save();
        return this.profile;
    }

    async getDraftingInstructions({ threatLevel = null, userGuidance = '' } = {}) {
        const profile = await this.load();
        const traits = profile.traits || {};
        const threat = threatLevel
            ? `Security assessment for KEVIN only: ${threatLevel.level} risk, score ${threatLevel.score}/100. Indicators: ${(threatLevel.indicators || []).join(', ') || 'none'}.`
            : 'No security assessment provided.';

        return `
You are writing as the operator using the User Persona, not as KEVIN.

USER PERSONA:
- Cadence: ${traits.cadence}
- Tone: ${traits.tone}
- Sentence length: ${traits.sentenceLength}
- Formality: ${traits.formality}
- Punctuation: ${traits.punctuation}
- Typical openings: ${(traits.openings || []).join(', ')}
- Typical closings: ${(traits.closings || []).join(', ')}
- Preferences: ${(traits.preferences || []).join('; ')}
- Avoid: ${(traits.avoid || []).join('; ')}

${threat}
${userGuidance ? `Operator guidance: ${userGuidance}` : ''}

Draft the email body in the operator's voice. Keep KEVIN's paranoia out of the prose unless the operator explicitly asks for it.
`;
    }
}

export default UserPersona;
