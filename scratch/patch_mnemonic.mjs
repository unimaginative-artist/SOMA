import fs from 'fs';
let content = fs.readFileSync('arbiters/MnemonicArbiter.cjs', 'utf8');

const epistemicCheck = `    // Epistemic verification layer check
    try {
      const { epistemicLayer, CLAIM_TYPE } = await import('../core/EpistemicLayer.js');
      // If it's a generated summary or inference, run it through the Epistemic Layer
      if (metadata.source !== 'raw_extraction' && !metadata.skipEpistemic) {
          const claim = await epistemicLayer.processClaim(content, {
              type: metadata.claimType || CLAIM_TYPE.OBSERVATION,
              metadata: metadata
          });
          
          if (claim.status === 'REJECTED') {
              this.log('warn', \`?? Skipping memory storage: Epistemic failure (hallucination detected).\`, { reason: claim.metadata?.rejectionReason });
              return { success: false, error: 'Epistemic rejection: hallucinatory or invalid memory' };
          }
      }
    } catch (e) {
      // Graceful fail if epistemic layer is offline
      this.log('warn', \`?? Epistemic check failed: \${e.message}\`);
    }

    const id = this._generateId(content);`;

if (!content.includes('Epistemic verification layer check')) {
    content = content.replace(
        /const id = this\._generateId\(content\);/g,
        epistemicCheck
    );
}

fs.writeFileSync('arbiters/MnemonicArbiter.cjs', content, 'utf8');
console.log('patched MnemonicArbiter.cjs');
