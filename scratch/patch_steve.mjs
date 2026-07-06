import fs from 'fs';
let content = fs.readFileSync('arbiters/SteveArbiter.cjs', 'utf8');

const realityCheck = `      const result = await this.toolRegistry.executeTool(toolName, parameters, {
        ...context,
        executor: 'Steve'
      });

      // Reality-Checked Tool Execution
      try {
        const { recordReality } = await import('../core/RealityLedger.js');
        await recordReality(\`Executed tool \${toolName}\`, {
            status: result.success ? 'VERIFIED_RESULT' : 'REJECTED',
            proof: { 
                stdout: result.data || result.output, 
                stderr: result.error 
            },
            metadata: { toolName, parameters, duration: result.metadata?.duration }
        });
      } catch (e) {
        this.logger.warn(\`[STEVE] RealityLedger unavailable: \${e.message}\`);
      }`;

if (!content.includes('Reality-Checked Tool Execution')) {
    content = content.replace(
        /const result = await this\.toolRegistry\.executeTool\(toolName, parameters, \{\n\s*\.\.\.context,\n\s*executor: 'Steve'\n\s*\}\);/,
        realityCheck
    );
}

fs.writeFileSync('arbiters/SteveArbiter.cjs', content, 'utf8');
console.log('patched SteveArbiter.cjs');
