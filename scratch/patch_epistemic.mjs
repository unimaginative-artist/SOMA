import fs from 'fs';
let content = fs.readFileSync('core/EpistemicLayer.js', 'utf8');

if (!content.includes("CITATION: 'CITATION'")) {
    content = content.replace(
        /RESULT: 'RESULT',/g,
        `RESULT: 'RESULT',
  CITATION: 'CITATION',`
    );
}

if (!content.includes("export const epistemicLayer = new EpistemicLayer();")) {
    content = content.replace(
        /export default EpistemicLayer;/,
        `export const epistemicLayer = new EpistemicLayer();
export default EpistemicLayer;`
    );
    // If export default is not there, append it
    if (!content.includes("export const epistemicLayer")) {
        content += `\nexport const epistemicLayer = new EpistemicLayer();\n`;
    }
}

const citationLogic = `
    if (type === CLAIM_TYPE.CITATION) {
        const quote = text.trim().toLowerCase().replace(/\\s+/g, ' ').replace(/["']/g, '');
        const sourceText = evidence.join(' ').toLowerCase().replace(/\\s+/g, ' ').replace(/["']/g, '');
        
        if (quote.length > 5 && (sourceText.includes(quote) || sourceText.includes(quote.substring(0, Math.floor(quote.length / 2))))) {
            claim.status = CLAIM_STATUS.VERIFIED;
            claim.memorySafe = true;
        } else {
            claim.status = CLAIM_STATUS.REJECTED;
            claim.metadata.rejectionReason = 'Quote not found in source text';
        }
        return claim;
    }

    const verdict = await this.poseidon.verify(text, {`;

if (!content.includes('if (type === CLAIM_TYPE.CITATION)')) {
    content = content.replace(
        /const verdict = await this\.poseidon\.verify\(text, \{/g,
        citationLogic
    );
}

fs.writeFileSync('core/EpistemicLayer.js', content, 'utf8');
console.log('patched EpistemicLayer.js');
