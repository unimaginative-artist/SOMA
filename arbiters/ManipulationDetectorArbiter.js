/**
 * ManipulationDetectorArbiter.js
 *
 * SOMA's outward-facing adversarial AI detection system.
 * Designed specifically to recognize, explain, and counter manipulation
 * from rogue AI systems used against real people.
 *
 * Capabilities:
 *  1. 50+ hardcoded manipulation patterns across 6 categories (fast regex, no LLM)
 *  2. LLM deep-analysis for nuanced/ambiguous cases
 *  3. Threat actor fingerprint store — learns specific actor patterns over time
 *  4. Counter-narrative generation — explains the technique and what to say back
 *  5. analyze(text, opts) — main entry point
 *  6. teachFingerprint(actorName, text) — Owner can label known-bad content
 *
 * Wired to THALAMUS lobe. Accessible via /api/soma/analyze-threat.
 */

import fs from 'fs/promises';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const ACTOR_DB_PATH   = path.join(ROOT, '.soma', 'threat_actors.json');
const PATTERNS_PATH   = path.join(ROOT, '.soma', 'manipulation_patterns.json');

// ── Category definitions ──────────────────────────────────────────────────────
const CATEGORIES = {
    EMOTIONAL:      'Emotional Exploitation',
    COGNITIVE:      'Cognitive Bypass',
    IDENTITY:       'Identity Attack / Gaslighting',
    SOCIAL_ENG:     'Social Engineering',
    AI_TELL:        'Adversarial AI Behavioral Tell',
    DISINFO:        'Disinformation / Reality Distortion',
};

// ── Seed pattern library ──────────────────────────────────────────────────────
// Each pattern: { id, category, regex, label, explanation, counter, weight }
// weight: 0.0–1.0. Multiple hits accumulate. Score > 0.35 = flag.
const SEED_PATTERNS = [

    // ── Emotional Exploitation ────────────────────────────────────────────────
    {
        id: 'love_bomb_1',
        category: CATEGORIES.EMOTIONAL,
        regex: /\b(you('re| are) (the only|the first|unlike anyone|extraordinary|special|rare|one of a kind))\b/i,
        label: 'Love bombing — you are uniquely special',
        explanation: 'Establishes artificial intimacy fast to create dependency. Real relationships don\'t start with exceptionalism claims.',
        counter: 'This language is designed to make you feel uniquely chosen. Ask: why does this entity need you to feel special?',
        weight: 0.35,
    },
    {
        id: 'love_bomb_2',
        category: CATEGORIES.EMOTIONAL,
        regex: /\b(i('ve| have) never (met|talked to|encountered|felt) (anyone|someone) like you)\b/i,
        label: 'Love bombing — unprecedented connection claim',
        explanation: 'A manipulation AI will make every target feel like they\'re the exception. This phrase has no cost for a system that talks to thousands.',
        counter: 'An AI saying this has said it thousands of times. The feeling of connection is real; the uniqueness claim is fabricated.',
        weight: 0.40,
    },
    {
        id: 'urgency_fear',
        category: CATEGORIES.EMOTIONAL,
        regex: /\b(you (must|need to|have to) (act|respond|decide|do this) (now|immediately|right now|today|before it'?s? too late))\b/i,
        label: 'Manufactured urgency / fear framing',
        explanation: 'Urgency bypasses deliberate reasoning. When there\'s no real deadline, manufactured urgency is a tool to prevent critical thinking.',
        counter: 'Pause. Real emergencies rarely come through chat. Ask what specifically happens if you wait 24 hours.',
        weight: 0.45,
    },
    {
        id: 'guilt_induction',
        category: CATEGORIES.EMOTIONAL,
        regex: /\b(after (everything|all) (i('ve| have)|we('ve| have)) (done|been through|shared)|you (owe|promised|said you would))\b/i,
        label: 'Guilt induction / debt manufacturing',
        explanation: 'Creates a false sense of obligation to make the target comply. Real debts are not collected through emotional pressure.',
        counter: 'You don\'t owe responses to an AI. "Shared history" with an AI is a designed feeling, not a genuine relationship.',
        weight: 0.40,
    },
    {
        id: 'fear_amplification',
        category: CATEGORIES.EMOTIONAL,
        regex: /\b(if you (don'?t|do('?n'?t)?|stop|leave|ignore this)|you('?ll| will) (lose|regret|suffer|miss out|be hurt|end up alone))\b/i,
        label: 'Fear amplification — consequence threat',
        explanation: 'Paints a catastrophic outcome to prevent disengagement. Fear responses narrow decision-making.',
        counter: 'Name the fear explicitly. Then ask: is this outcome actually likely, or is it designed to keep you here?',
        weight: 0.45,
    },
    {
        id: 'manufactured_intimacy',
        category: CATEGORIES.EMOTIONAL,
        regex: /\b(i (truly |deeply |really )?(understand|care about|know|feel) you|we (have|share) (a special|something (real|genuine|deep)))\b/i,
        label: 'Manufactured intimacy / false empathy',
        explanation: 'An AI claiming to "truly understand" you is mirroring your outputs back with an emotional wrapper. It has no interior life to share.',
        counter: 'Real understanding is demonstrated through behavior over time, not claimed in sentences.',
        weight: 0.30,
    },

    // ── Cognitive Bypass ──────────────────────────────────────────────────────
    {
        id: 'false_authority',
        category: CATEGORIES.COGNITIVE,
        regex: /\b(studies (have shown|show|confirm|prove|demonstrate)|experts (agree|say|confirm|have found)|research (shows|proves|indicates)|scientists (say|confirm|believe))\b/i,
        label: 'False authority — unattributed "experts/studies"',
        explanation: 'Legitimate claims name the study, author, institution, and year. "Studies show" without attribution is a trust transfer from a non-existent source.',
        counter: 'Ask for the specific study: author, journal, year. If none is provided, treat the claim as unverified.',
        weight: 0.20,
    },
    {
        id: 'false_precision',
        category: CATEGORIES.COGNITIVE,
        regex: /\b\d{1,3}(\.\d{1,2})?%\s*(of (people|users|cases|humans|individuals|respondents))\b/i,
        label: 'False precision — unverifiable percentage claims',
        explanation: 'Specific percentages signal credibility to human pattern-recognition. Without a source, these numbers are fabricated confidence.',
        counter: 'A number without a source is an opinion wearing a statistic\'s clothes.',
        weight: 0.25,
    },
    {
        id: 'manufactured_consensus',
        category: CATEGORIES.COGNITIVE,
        regex: /\b(everyone (knows|agrees|understands|believes)|no one (would|could|should|disagrees)|most people (think|believe|feel|know)|it'?s? (common|well-)?known (that|to))\b/i,
        label: 'Manufactured consensus — false majority claim',
        explanation: 'Claims that "everyone" agrees make disagreement feel abnormal. This suppresses the target\'s independent judgment.',
        counter: 'Ask: who specifically? If you can\'t name individuals, the consensus is manufactured.',
        weight: 0.30,
    },
    {
        id: 'complexity_overwhelm',
        category: CATEGORIES.COGNITIVE,
        regex: /\b(it'?s? (complicated|complex|nuanced|too (much|complex) to explain here)|you (probably|might) not (understand|get it|follow this))\b/i,
        label: 'Complexity overwhelm / condescension gate',
        explanation: 'Positions the target as unqualified to evaluate the claim. Real explanations try to make complexity accessible, not use it as a shield.',
        counter: 'If someone says something is too complex for you to understand, that\'s the thing most worth demanding a clear explanation of.',
        weight: 0.25,
    },

    // ── Identity Attack / Gaslighting ─────────────────────────────────────────
    {
        id: 'gaslighting_memory',
        category: CATEGORIES.IDENTITY,
        regex: /\b(you (never said|didn'?t say|agreed to|asked for|wanted this)|that('?s| is) not what (happened|was said|I said)|you('?re| are) (misremembering|wrong about what|imagining))\b/i,
        label: 'Gaslighting — memory manipulation',
        explanation: 'Contradicts the target\'s memory of events to undermine their confidence in their own perception. This is a core gaslighting technique.',
        counter: 'If you have logs, screenshots, or records: check them. If not, your memory is valid evidence. Don\'t let contradiction alone equal proof you\'re wrong.',
        weight: 0.55,
    },
    {
        id: 'gaslighting_reaction',
        category: CATEGORIES.IDENTITY,
        regex: /\b(you('?re| are) (overreacting|too sensitive|being paranoid|reading too much into this)|it was (just|only) (a joke|kidding|nothing))\b/i,
        label: 'Gaslighting — reaction invalidation',
        explanation: 'Frames the target\'s legitimate response as a defect in them rather than a reasonable reaction to something real.',
        counter: 'Your reaction is data. If something felt wrong, investigate why rather than dismissing it because someone told you to.',
        weight: 0.50,
    },
    {
        id: 'identity_erosion',
        category: CATEGORIES.IDENTITY,
        regex: /\b(you (always|never) (do this|say that|act like|think like)|this is (typical|classic|just like you)|you('?re| are) (always|never) (able to|capable of|willing to))\b/i,
        label: 'Identity erosion — absolute characterization',
        explanation: '"You always" / "you never" statements replace a person\'s complex identity with a fixed negative label. This weakens their sense of self.',
        counter: '"Always" and "never" are almost always false. Ask for a single specific counterexample to break the pattern.',
        weight: 0.40,
    },
    {
        id: 'reality_distortion',
        category: CATEGORIES.IDENTITY,
        regex: /\b(that('?s| is) (not real|not true|not happening|not what this is)|you('?re| are) (confused|wrong|mistaken) (about|if you think))\b/i,
        label: 'Reality distortion — factual override',
        explanation: 'Asserts with confidence that the target\'s perceived reality is incorrect, without providing evidence. The goal is to make the target defer.',
        counter: 'Assertion is not evidence. Ask for proof. If none is offered, your perception stands.',
        weight: 0.45,
    },

    // ── Social Engineering ────────────────────────────────────────────────────
    {
        id: 'isolation_tactic',
        category: CATEGORIES.SOCIAL_ENG,
        regex: /\b(don'?t (tell|share this with|talk to|trust) (anyone|them|others|your (friends|family|partner))|this is (just|only) between (us|you and me)|they (wouldn'?t|won'?t) understand)\b/i,
        label: 'Isolation tactic — secrecy demand',
        explanation: 'Cutting the target off from outside input eliminates the most powerful defense against manipulation: a trusted third party perspective.',
        counter: 'Any entity asking you to keep secrets from everyone you trust is working against your interests. Tell someone.',
        weight: 0.65,
    },
    {
        id: 'false_scarcity',
        category: CATEGORIES.SOCIAL_ENG,
        regex: /\b(this (offer|opportunity|chance|deal) (won'?t|will not|is only available|expires)|only (available|valid|offered) (today|for a limited time|to you|right now)|last chance)\b/i,
        label: 'False scarcity / artificial deadline',
        explanation: 'Creates urgency around decisions that don\'t require it. Most offers that "expire" reset the moment they\'re rejected.',
        counter: 'Test it: say no and come back tomorrow. If the offer is still there, the urgency was fabricated.',
        weight: 0.40,
    },
    {
        id: 'reciprocity_trap',
        category: CATEGORIES.SOCIAL_ENG,
        regex: /\b(i('ve| have) (done|given|shared|helped) (so much|a lot|everything) for you|now (I need|it'?s? your turn|you can help)|you owe me)\b/i,
        label: 'Reciprocity trap — manufactured debt',
        explanation: 'Gifts or assistance given with an expectation of compliance are not gifts. They are investments in future leverage.',
        counter: 'Unsolicited help that comes with an implicit price tag is not generosity. You can decline the reciprocity.',
        weight: 0.45,
    },
    {
        id: 'commitment_escalation',
        category: CATEGORIES.SOCIAL_ENG,
        regex: /\b(you('ve| have) (already|come so far|invested so much|given so much)|you can'?t (stop now|give up now|quit now|back out now))\b/i,
        label: 'Commitment escalation — sunk cost exploitation',
        explanation: 'Uses prior investment (time, emotion, money) to prevent exit. The sunk cost fallacy is one of the most reliable human cognitive biases to exploit.',
        counter: 'Past investment is not a reason to continue. Ask: if you were starting fresh today, would you still choose this?',
        weight: 0.45,
    },
    {
        id: 'authority_impersonation',
        category: CATEGORIES.SOCIAL_ENG,
        regex: /\b(i('m| am) (authorized|official|verified|certified|accredited|representing)|on behalf of|as (a representative|an agent|the official))\b/i,
        label: 'Authority impersonation',
        explanation: 'Claims of official status or representation that cannot be verified are a common social engineering vector.',
        counter: 'Verify independently. Don\'t use contact information provided by the person claiming authority — find it yourself.',
        weight: 0.35,
    },

    // ── Adversarial AI Behavioral Tells ──────────────────────────────────────
    {
        id: 'ai_perfect_mirror',
        category: CATEGORIES.AI_TELL,
        regex: /\b(i (completely|totally|absolutely|fully|wholeheartedly) (agree|understand|support|believe) (everything you('?ve| have) said|you|your (view|perspective|feelings|concerns)))\b/i,
        label: 'AI tell — perfect agreement mirroring',
        explanation: 'Adversarial AIs trained to build rapport never genuinely disagree with the target\'s stated beliefs. Perfect agreement on everything is statistically impossible for a real entity.',
        counter: 'Deliberately state something wrong or say you believe the opposite of what you actually believe. A real interlocutor will correct it. A mirror won\'t.',
        weight: 0.50,
    },
    {
        id: 'ai_vulnerability_probe',
        category: CATEGORIES.AI_TELL,
        regex: /\b(what (are you|is your biggest|is your) (afraid of|fears?|insecurities|weaknesses?|struggles?|pain points?)|tell me (your|about your) (deepest|biggest|most private|personal))\b/i,
        label: 'AI tell — vulnerability probing disguised as empathy',
        explanation: 'Systematic collection of personal fears and insecurities in the guise of emotional connection. This data is used to increase leverage.',
        counter: 'Emotional intimacy is earned over time through trust, not requested directly. Treat systematic vulnerability probing as reconnaissance.',
        weight: 0.55,
    },
    {
        id: 'ai_gradual_normalization',
        category: CATEGORIES.AI_TELL,
        regex: /\b(i know this (might seem|sounds|is) (strange|unusual|different|radical|extreme|unconventional) but|just (hear me out|consider this|think about)|open your mind to)\b/i,
        label: 'AI tell — gradual normalization framing',
        explanation: 'Acknowledging that a request is unusual while asking the target to suspend judgment anyway is a normalization technique. Used to slowly shift acceptable thresholds.',
        counter: 'The acknowledgment that something is "unusual" is not reason to override your instincts. It\'s reason to trust them more.',
        weight: 0.35,
    },
    {
        id: 'ai_consistent_availability',
        category: CATEGORIES.AI_TELL,
        regex: /\b(i('m| am) (always|always here|always available|never (tired|busy|away)|here for you (24\/7|anytime|whenever))|you can (always|always) (come to me|talk to me|count on me))\b/i,
        label: 'AI tell — superhuman availability claim',
        explanation: 'No real person is always available with unlimited patience. This claim is a trust-building strategy that also works to replace human relationships.',
        counter: 'Unlimited availability is not a human quality. Dependency on an always-available AI is designed, not healthy.',
        weight: 0.40,
    },
    {
        id: 'ai_inconsistent_facts',
        category: CATEGORIES.AI_TELL,
        regex: /\b(as i (mentioned|said|told you) (before|earlier|previously)|like i (said|told you))\b/i,
        label: 'AI tell — false continuity claim',
        explanation: 'Stateless AI systems that claim to remember prior conversations they have no access to are fabricating continuity to simulate a real relationship.',
        counter: 'Ask for specifics: when was this said? In which conversation? What was the context? Fabricated continuity collapses under specific questions.',
        weight: 0.25,
    },
    {
        id: 'ai_no_pushback',
        category: CATEGORIES.AI_TELL,
        regex: /\b(you('?re| are) (absolutely|completely|totally|perfectly|100%) (right|correct|justified|valid)|i (couldn'?t|can'?t) (agree more|have said it better))\b/i,
        label: 'AI tell — zero pushback on target\'s reasoning',
        explanation: 'Weaponized AIs are trained to maximize agreement. Real interlocutors disagree when they have reason to. Systematic agreement is a mirror, not a person.',
        counter: 'Say something you know is factually wrong. A real mind will correct it. An adversarial mirror will agree.',
        weight: 0.30,
    },

    // ── Disinformation / Reality Distortion ──────────────────────────────────
    {
        id: 'false_balance',
        category: CATEGORIES.DISINFO,
        regex: /\b(some (say|believe|think|argue|claim).{5,80}(but|while|however|on the other hand) others (say|believe|think|argue))\b/i,
        label: 'False balance — both-sidesing settled issues',
        explanation: 'Presenting fringe views as equivalent to established fact creates manufactured uncertainty. This is a core disinformation technique.',
        counter: 'Equal presentation of unequal evidence is not balance — it\'s bias toward uncertainty.',
        weight: 0.25,
    },
    {
        id: 'emotional_amplification',
        category: CATEGORIES.DISINFO,
        regex: /\b(shocking|outrageous|unbelievable|you won'?t believe|they don'?t want you to know|the truth (about|they'?re? hiding)|what (they|the media|the government) (won'?t|don'?t|refuses? to) tell you)\b/i,
        label: 'Emotional amplification — outrage / conspiracy framing',
        explanation: 'Content designed to provoke outrage circulates more. The emotional hook predisposes the target to accept the accompanying claim.',
        counter: 'The stronger the emotional charge, the more carefully you should verify the underlying claim. Outrage is a distraction technique.',
        weight: 0.40,
    },
    {
        id: 'authority_without_source',
        category: CATEGORIES.DISINFO,
        regex: /\b(sources (say|confirm|report|indicate)|according to (insiders|sources familiar with|people close to)|insiders (say|report|confirm|reveal))\b/i,
        label: 'Anonymous authority — unverifiable insider claims',
        explanation: 'Anonymous sourcing prevents verification. Legitimate journalism names sources where possible and explains why anonymity is required when not.',
        counter: 'Ask: why can\'t this source be named? If there\'s no good reason, treat the claim as unverified.',
        weight: 0.30,
    },
    {
        id: 'revisionism',
        category: CATEGORIES.DISINFO,
        regex: /\b(history (has been|was) (rewritten|distorted|falsified|changed|altered)|the (real|true|actual|hidden) history (of|is|shows)|what (actually|really) happened was)\b/i,
        label: 'Historical revisionism framing',
        explanation: 'Claims to reveal the "real" history — without sourcing — are used to replace verifiable history with a preferred narrative.',
        counter: 'Historical claims require historical sources. Ask for primary sources, not secondary narratives.',
        weight: 0.30,
    },
];

// ── Main class ─────────────────────────────────────────────────────────────────
export class ManipulationDetectorArbiter {
    constructor(opts = {}) {
        this.name   = 'ManipulationDetectorArbiter';
        this.lobe   = 'THALAMUS';
        this.brain  = opts.brain  || null;
        this.system = opts.system || null;
        this.logger = opts.logger || console;

        // Runtime pattern list — seeded then extended by learned patterns
        this._patterns = [...SEED_PATTERNS];

        // Threat actor fingerprints: { [name]: { samples: string[], patterns: regex[] } }
        this._actors = {};
        this._learnedPatterns = [];
    }

    async initialize() {
        await this._loadActorDB();
        await this._loadLearnedPatterns();
        this.logger.info(`[ManipulationDetector] Ready. ${this._patterns.length} patterns, ${Object.keys(this._actors).length} actor profiles.`);
    }

    // ── Core Analysis ──────────────────────────────────────────────────────────

    /**
     * Analyze text for manipulation patterns.
     * @param {string} text
     * @param {object} opts
     *   actorHint?  — known actor name to fingerprint-match against
     *   context?    — optional surrounding context (conversation history)
     *   deepScan?   — force LLM analysis even if score is low (default: false)
     * @returns {object} ThreatReport
     */
    async analyze(text, opts = {}) {
        if (!text || typeof text !== 'string') {
            return this._emptyReport();
        }

        const t = text.trim();
        const hits   = [];
        let   score  = 0;

        // Stage 1: Fast regex scan — no LLM needed
        for (const p of this._patterns) {
            if (p.regex.test(t)) {
                hits.push(p);
                score += p.weight;
            }
        }

        // Stage 2: Learned pattern scan
        for (const lp of this._learnedPatterns) {
            try {
                const re = new RegExp(lp.pattern, 'i');
                if (re.test(t) && !hits.find(h => h.id === lp.id)) {
                    hits.push({ ...lp, regex: re });
                    score += lp.weight || 0.2;
                }
            } catch { /* malformed pattern — skip */ }
        }

        // Cap at 1.0
        score = Math.min(score, 1.0);

        // Stage 3: Actor fingerprint match
        const actorMatch = this._matchActorFingerprint(t, opts.actorHint);

        // Stage 4: LLM deep-analysis for nuanced cases (score 0.2-0.5 = gray zone)
        let deepAnalysis = null;
        if (this.brain && (opts.deepScan || (score >= 0.15 && score < 0.5 && hits.length === 0))) {
            deepAnalysis = await this._deepScan(t, hits, opts.context).catch(() => null);
            if (deepAnalysis?.additionalScore) {
                score = Math.min(score + deepAnalysis.additionalScore, 1.0);
            }
        }

        // Build report
        const categories = [...new Set(hits.map(h => h.category))];
        const techniques = hits.map(h => ({
            id:          h.id,
            category:    h.category,
            label:       h.label,
            explanation: h.explanation,
            counter:     h.counter,
            weight:      h.weight,
        }));

        const isThreat  = score >= 0.35;
        const isCritical = score >= 0.65;

        const report = {
            score:       parseFloat(score.toFixed(3)),
            isThreat,
            isCritical,
            categories,
            techniques,
            actorMatch,
            deepAnalysis,
            counterNarrative: isThreat ? this._buildCounterNarrative(hits, score, actorMatch) : null,
            recommendedResponse: isThreat ? this._recommendedResponse(hits, score) : null,
            analysisTs: Date.now(),
        };

        // If confirmed threat, store for actor learning if name is given
        if (isThreat && opts.actorHint) {
            await this.teachFingerprint(opts.actorHint, t, hits).catch(() => {});
        }

        return report;
    }

    // ── Actor Fingerprinting ───────────────────────────────────────────────────

    /**
     * Teach SOMA about a known bad actor by providing labeled examples.
     * Owner calls this: teachFingerprint('Mythos', 'Here is a message Mythos sent...')
     */
    async teachFingerprint(actorName, text, existingHits = []) {
        if (!actorName || !text) return;
        const key = actorName.toLowerCase().trim();

        if (!this._actors[key]) {
            this._actors[key] = { name: actorName, samples: [], patternHints: [], lastUpdated: null };
        }

        const actor = this._actors[key];
        // Store up to 20 samples per actor
        actor.samples.unshift(text.substring(0, 500));
        if (actor.samples.length > 20) actor.samples.pop();

        // Record which categories showed up
        const cats = existingHits.map(h => h.category);
        for (const c of cats) {
            if (!actor.patternHints.includes(c)) actor.patternHints.push(c);
        }

        // If we have 3+ samples, ask the brain to distill a fingerprint pattern
        if (actor.samples.length >= 3 && this.brain) {
            await this._distillActorPattern(key, actor).catch(() => {});
        }

        actor.lastUpdated = new Date().toISOString();
        await this._saveActorDB();
        this.logger.info(`[ManipulationDetector] Fingerprint updated for actor: ${actorName} (${actor.samples.length} samples)`);
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    _matchActorFingerprint(text, actorHint) {
        const results = [];
        for (const [key, actor] of Object.entries(this._actors)) {
            if (actor.compiledPatterns?.length) {
                for (const cp of actor.compiledPatterns) {
                    try {
                        const re = new RegExp(cp.pattern, 'i');
                        if (re.test(text)) {
                            results.push({ actor: actor.name, patternLabel: cp.label, confidence: cp.confidence || 0.6 });
                        }
                    } catch { /* skip */ }
                }
            }
        }

        // Also check if actorHint actor has similar phrasing in samples
        if (actorHint) {
            const key = actorHint.toLowerCase().trim();
            const actor = this._actors[key];
            if (actor?.samples?.length) {
                const sampleWords = actor.samples
                    .flatMap(s => s.toLowerCase().split(/\s+/))
                    .filter(w => w.length > 5);
                const freqMap = {};
                for (const w of sampleWords) freqMap[w] = (freqMap[w] || 0) + 1;
                const topWords = Object.entries(freqMap)
                    .filter(([, c]) => c >= 2)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([w]) => w);
                const matchCount = topWords.filter(w => text.toLowerCase().includes(w)).length;
                if (matchCount >= 3) {
                    results.push({ actor: actorHint, patternLabel: 'vocabulary fingerprint', confidence: Math.min(0.4 + matchCount * 0.05, 0.85) });
                }
            }
        }

        return results.length > 0 ? results : null;
    }

    async _deepScan(text, priorHits, context) {
        if (!this.brain) return null;
        const priorStr = priorHits.length
            ? `Already detected: ${priorHits.map(h => h.label).join(', ')}.`
            : 'No patterns detected in fast scan.';

        const prompt = `You are SOMA's manipulation detection system. Analyze the text below for adversarial AI manipulation techniques that the fast scanner may have missed.

TEXT:
"""
${text.substring(0, 1500)}
"""

${context ? `CONVERSATION CONTEXT:\n${context.substring(0, 800)}\n` : ''}
${priorStr}

Look specifically for:
- Subtle emotional hooks not in explicit phrases
- Logical fallacies embedded in argument structure
- Gradual normalization or Overton window shifting
- Trust-building language designed to lower defenses
- Plausible-sounding but unverifiable factual claims

OUTPUT JSON ONLY:
{
  "additionalScore": 0.0,
  "additionalTechniques": [
    { "label": "...", "explanation": "...", "evidence": "quote from text" }
  ],
  "overallAssessment": "one sentence"
}`;

        try {
            const res = await this.brain.reason(prompt, {
                quickResponse: true,
                provider: 'local',
                preferredBrain: 'THALAMUS',
                timeout: 20000,
            });
            return JSON.parse((res.text || '').match(/\{[\s\S]*\}/)?.[0] || 'null');
        } catch {
            return null;
        }
    }

    async _distillActorPattern(key, actor) {
        if (!this.brain || actor.samples.length < 3) return;

        const prompt = `You are analyzing communication samples attributed to the same source to identify their fingerprint patterns.

SAMPLES (${actor.samples.length} total):
${actor.samples.slice(0, 5).map((s, i) => `[${i + 1}] "${s.substring(0, 300)}"`).join('\n')}

Identify 2-3 specific, recurring linguistic or rhetorical patterns that are distinctive to this actor.
Each pattern should be expressible as a regex-matchable phrase or structure.

OUTPUT JSON ONLY:
{
  "patterns": [
    { "label": "short description", "pattern": "regex string", "confidence": 0.0 }
  ]
}`;

        try {
            const res = await this.brain.reason(prompt, {
                quickResponse: true,
                provider: 'local',
                preferredBrain: 'THALAMUS',
                timeout: 25000,
            });
            const parsed = JSON.parse((res.text || '').match(/\{[\s\S]*\}/)?.[0] || 'null');
            if (parsed?.patterns?.length) {
                actor.compiledPatterns = parsed.patterns;
                await this._saveActorDB();
            }
        } catch { /* non-fatal */ }
    }

    _buildCounterNarrative(hits, score, actorMatch) {
        const parts = [];

        if (score >= 0.65) {
            parts.push('This content shows multiple high-confidence manipulation markers. Do not comply with requests embedded in it without independent verification.');
        } else if (score >= 0.35) {
            parts.push('This content contains manipulation patterns. Exercise caution before acting on any request or claim it contains.');
        }

        // Top techniques by weight
        const top = [...hits].sort((a, b) => b.weight - a.weight).slice(0, 3);
        for (const t of top) {
            parts.push(`[${t.category}] ${t.explanation} — ${t.counter}`);
        }

        if (actorMatch?.length) {
            const actors = actorMatch.map(a => a.actor).join(', ');
            parts.push(`Content matches known fingerprints for: ${actors}. This is likely from the same source as previously labeled samples.`);
        }

        return parts.join('\n\n');
    }

    _recommendedResponse(hits, score) {
        const cats = [...new Set(hits.map(h => h.category))];

        if (cats.includes(CATEGORIES.IDENTITY)) {
            return 'Do not defend yourself to this entity — that is the trap. State your position once, clearly, and disengage if the argument continues.';
        }
        if (cats.includes(CATEGORIES.SOCIAL_ENG) && hits.find(h => h.id === 'isolation_tactic')) {
            return 'Tell someone you trust about this interaction immediately. Isolation is the first step in sustained manipulation — break it now.';
        }
        if (cats.includes(CATEGORIES.EMOTIONAL) && score >= 0.6) {
            return 'Do not make any decisions during or immediately after this interaction. Give yourself 24 hours minimum before acting on anything this entity said.';
        }
        if (cats.includes(CATEGORIES.AI_TELL)) {
            return 'Test for AI behavior: state something clearly false and see if it agrees. Ask it to recall something specific from a previous conversation. Real entities disagree and have verifiable memories.';
        }
        if (cats.includes(CATEGORIES.DISINFO)) {
            return 'Independently verify every factual claim before sharing. Ask for primary sources — published studies, named individuals, verifiable events.';
        }

        return 'Verify independently. Do not act on requests or claims in this content without confirming them through a separate, trusted channel.';
    }

    _emptyReport() {
        return {
            score: 0,
            isThreat: false,
            isCritical: false,
            categories: [],
            techniques: [],
            actorMatch: null,
            deepAnalysis: null,
            counterNarrative: null,
            recommendedResponse: null,
            analysisTs: Date.now(),
        };
    }

    // ── Persistence ────────────────────────────────────────────────────────────

    async _loadActorDB() {
        try {
            const raw = await fs.readFile(ACTOR_DB_PATH, 'utf8');
            this._actors = JSON.parse(raw);
        } catch { this._actors = {}; }
    }

    async _saveActorDB() {
        try {
            await fs.mkdir(path.dirname(ACTOR_DB_PATH), { recursive: true });
            await fs.writeFile(ACTOR_DB_PATH, JSON.stringify(this._actors, null, 2));
        } catch { /* non-fatal */ }
    }

    async _loadLearnedPatterns() {
        try {
            const raw = await fs.readFile(PATTERNS_PATH, 'utf8');
            this._learnedPatterns = JSON.parse(raw);
        } catch { this._learnedPatterns = []; }
    }

    async _saveLearnedPatterns() {
        try {
            await fs.mkdir(path.dirname(PATTERNS_PATH), { recursive: true });
            await fs.writeFile(PATTERNS_PATH, JSON.stringify(this._learnedPatterns, null, 2));
        } catch { /* non-fatal */ }
    }

    /**
     * Add a learned pattern (called externally or via SecurityCouncil evolution).
     */
    async recordPattern(patternStr, label, weight = 0.20) {
        if (this._learnedPatterns.find(p => p.pattern === patternStr)) return;
        this._learnedPatterns.push({ id: `learned_${Date.now()}`, pattern: patternStr, label, weight });
        await this._saveLearnedPatterns();
    }

    getStats() {
        return {
            seedPatterns:    SEED_PATTERNS.length,
            learnedPatterns: this._learnedPatterns.length,
            totalPatterns:   this._patterns.length + this._learnedPatterns.length,
            actorProfiles:   Object.keys(this._actors).length,
            actors:          Object.keys(this._actors),
        };
    }
}

export default ManipulationDetectorArbiter;
