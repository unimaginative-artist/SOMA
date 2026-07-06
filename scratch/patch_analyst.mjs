import fs from 'fs';
let content = fs.readFileSync('arbiters/AnalystArbiter.cjs', 'utf8');

const epistemicCheck = `    // Epistemic verification layer check
    try {
      const { epistemicLayer, CLAIM_TYPE } = await import('../core/EpistemicLayer.js');
      // If the analysis output contains quotes, verify them against context
      const quotes = [];
      const quoteRegex = />\\s*["']([^"']+)["']/g;
      let match;
      while ((match = quoteRegex.exec(analysis.summary)) !== null) {
         quotes.push(match[1]);
      }
      
      if (quotes.length > 0) {
         let allVerified = true;
         for (const quote of quotes) {
             const claim = await epistemicLayer.processClaim(quote, {
                 type: CLAIM_TYPE.CITATION,
                 evidence: [JSON.stringify(context)] 
             });
             if (claim.status === 'REJECTED') {
                 allVerified = false;
                 analysis.confidence = 0;
                 analysis.findings.push({
                     type: 'epistemic_failure',
                     detail: \`Hallucination detected. Failed to verify quote: "\${quote}"\`,
                     importance: 'critical'
                 });
             }
         }
         if (allVerified) {
             analysis.metadata.quotesVerified = true;
         }
      } else if (query.includes('analyze document') || query.includes('critique')) {
         // Require quotes for document analysis
         analysis.confidence = 0;
         analysis.findings.push({
             type: 'epistemic_failure',
             detail: 'Missing required verbatim citations from source text',
             importance: 'critical'
         });
      }
    } catch (e) {
       // Graceful fail if epistemic layer is offline
    }

    return analysis;`;

if (!content.includes('epistemic_failure')) {
    content = content.replace(
        /return analysis;/g,
        epistemicCheck
    );
}

fs.writeFileSync('arbiters/AnalystArbiter.cjs', content, 'utf8');
console.log('patched AnalystArbiter.cjs');
