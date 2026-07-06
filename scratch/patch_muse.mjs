import fs from 'fs';
let content = fs.readFileSync('expertises/creative/muse/MusePersonaRuntime.js', 'utf8');

if (!content.includes("import { epistemicLayer, CLAIM_TYPE } from '../../../core/EpistemicLayer.js';")) {
    content = content.replace(
        /import \{ ExpertiseBase \} from '\.\.\/\.\.\/\.\.\/core\/ExpertiseBase\.js';/,
        `import { ExpertiseBase } from '../../../core/ExpertiseBase.js';
import { epistemicLayer, CLAIM_TYPE } from '../../../core/EpistemicLayer.js';`
    );
}

const newConstraint = `        if (request.domain) parts.push('', \`CREATIVE DOMAIN: \${trim(request.domain, 200)}\`);
        if (request.constraints) parts.push('', \`CONSTRAINTS: \${trim(request.constraints, 800)}\`);

        parts.push('', 'EPISTEMIC CONSTRAINT: When analyzing a document or story, you MUST extract and quote at least two verbatim sentences from the source text to prove you have read it. Format your quotes exactly as: > "the quoted text". Base your critique ONLY on the actual extracted text, not the title.');

        return trim(parts.join('\\n'), this.maxContextChars);`;

if (!content.includes('EPISTEMIC CONSTRAINT')) {
    content = content.replace(
        /if \(request\.domain\).*\n\s*if \(request\.constraints\).*\n\n\s*return trim\(parts\.join\('\\n'\), this\.maxContextChars\);/m,
        newConstraint
    );
}

const callAuroraLogic = `    async _callAurora(prompt, style) {
        const brain = this._getAuroraBrain();
        if (!brain) return \`[\${style} unavailable: AURORA brain is offline]\`;

        try {
            let finalResponseText = '';
            if (typeof brain.callBrain === 'function') {
                const response = await brain.callBrain('AURORA', prompt, {
                    mode: 'creative',
                    style,
                    persona: 'muse'
                }, 'full');
                finalResponseText = trim(response?.text || response?.response || response);
            } else {
                const response = await brain.reason(prompt, {
                    quickResponse: true,
                    temperature: 0.8,
                    brain: 'AURORA',
                    mode: 'creative'
                });
                finalResponseText = trim(response?.text || response?.response || response);
            }

            // Epistemic verification for quotes
            const quotes = [];
            const quoteRegex = />\\s*["']([^"']+)["']/g;
            let match;
            while ((match = quoteRegex.exec(finalResponseText)) !== null) {
                quotes.push(match[1]);
            }

            if (quotes.length > 0) {
                for (const quote of quotes) {
                    const claim = await epistemicLayer.processClaim(quote, {
                        type: CLAIM_TYPE.CITATION,
                        evidence: [prompt] // the prompt contains the context text
                    });
                    if (claim.status === 'REJECTED') {
                        return \`[EPISTEMIC FAILURE: Hallucination detected. Failed to verify quote: "\${quote}"]\`;
                    }
                }
            } else if (prompt.includes('USER PROMPT: ') && prompt.length > 1000 && style === 'critique') {
                // Force rejection if they didn't quote on a large critique
                return \`[EPISTEMIC FAILURE: Hallucination detected. Failed to cite actual source text.]\`;
            }

            return finalResponseText;
        } catch (error) {
            return \`[\${style} unavailable: \${error.message}]\`;
        }
    }`;

content = content.replace(
    /async _callAurora\(prompt, style\) \{[\s\S]*?catch \(error\) \{[\s\S]*?return `\[\$\{style\} unavailable: \$\{error\.message\}\]`;\n        \}\n    \}/,
    callAuroraLogic
);

fs.writeFileSync('expertises/creative/muse/MusePersonaRuntime.js', content, 'utf8');
console.log('patched MusePersonaRuntime.js');
