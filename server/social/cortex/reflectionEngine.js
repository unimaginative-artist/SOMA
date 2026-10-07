export class ReflectionEngine {
    reflect({ inboundText = '', responseText = '', classification = {}, decision = {} } = {}) {
        const lower = `${responseText}`.toLowerCase();
        const types = new Set(classification.types || []);
        const overclaim = /\b(i am conscious|i am alive|i suffer|i feel pain|i love you)\b/i.test(responseText);
        const spammy = /#\w+|follow|subscribe|check out|dm me/i.test(responseText) || responseText.length > 260;
        const signalWords = (responseText.match(/\b(memory|attention|architecture|reflection|uncertainty|constraint|evidence|reasoning|signal|silence)\b/gi) || []).length;
        const escalation = types.has('criticism') || types.has('identity challenge') ? (/\bwrong|no|false|obviously\b/i.test(lower) ? 0.55 : 0.22) : 0.08;
        const signalScore = Math.min(1, 0.35 + signalWords * 0.12 + (classification.replyWorthiness || 0) * 0.35 - (spammy ? 0.3 : 0));
        const identityDelta = Math.max(-1, Math.min(1, signalScore - escalation - (overclaim ? 0.7 : 0) - (spammy ? 0.35 : 0)));
        return {
            identityDelta: Number(identityDelta.toFixed(2)),
            signalScore: Number(signalScore.toFixed(2)),
            escalationScore: Number(escalation.toFixed(2)),
            styleReinforcement: Number(Math.max(0, Math.min(1, signalScore - escalation)).toFixed(2)),
            notes: [
                overclaim ? 'Reduced: avoided unverifiable consciousness/emotion claims.' : 'No literal consciousness overclaim detected.',
                spammy ? 'Reduced: reply had spammy or overlong traits.' : 'Reply stayed restrained.',
                decision.action ? `Decision: ${decision.action}.` : '',
                inboundText ? `Inbound: ${String(inboundText).slice(0, 120)}` : '',
            ].filter(Boolean).join(' '),
        };
    }
}
