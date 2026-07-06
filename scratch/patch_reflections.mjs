import fs from 'fs';
import path from 'path';

let content = fs.readFileSync('arbiters/ReflectionsArbiter.js', 'utf8');

const logFn = `
  async _logWriteAccess(filePath, action, metadata = {}) {
    try {
      const stack = new Error().stack.split('\\n');
      const callerLine = stack.length > 3 ? stack[3].trim() : 'unknown caller';
      const source = metadata.source || metadata.context?.source || 'unknown';
      const logLine = \`[\${new Date().toISOString()}] [WRITE: \${action}] -> \${filePath} | SOURCE: \${source} | CALLER: \${callerLine}\\n\`;
      
      const fsPromises = require('fs').promises;
      const logFile = require('path').join(this.vaultPath, '_write_audit.log');
      await fsPromises.appendFile(logFile, logLine);
      console.log(\`[Reflections Audit] \${logLine.trim()}\`);
    } catch(e) {
      console.error('[Reflections Audit] Failed to log write access', e.message);
    }
  }

  async onInitialize() {`;

if (!content.includes('_logWriteAccess')) {
    content = content.replace(/async onInitialize\(\) \{/, logFn);
}

// 1. distillSession
content = content.replace(
    /const filePath = path\.join\(this\.vaultPath, filename\);\s*await fs\.writeFile\(filePath, mdContent\);/g,
    `const filePath = path.join(this.vaultPath, filename);
    await this._logWriteAccess(filePath, 'distillSession/saveMuseSessionArtifact');
    await fs.writeFile(filePath, mdContent);`
);

// 2. handleIngestion
content = content.replace(
    /const vaultFile = path\.join\(this\.vaultPath, \`\$\{noteTitle\}_\$\{Date\.now\(\)\}\.md\`\);\s*await fs\.writeFile\(vaultFile, mdContent\);/g,
    `const vaultFile = path.join(this.vaultPath, \`\${noteTitle}_\${Date.now()}.md\`);
      await this._logWriteAccess(vaultFile, 'handleIngestion', metadata);
      await fs.writeFile(vaultFile, mdContent);`
);

// 3. appendQuickNote
content = content.replace(
    /const fullPath = path\.join\(this\.vaultPath, filename\);\s*await fs\.writeFile\(fullPath, mdContent\);/g,
    `const fullPath = path.join(this.vaultPath, filename);
    await this._logWriteAccess(fullPath, 'appendQuickNote', metadata);
    await fs.writeFile(fullPath, mdContent);`
);

fs.writeFileSync('arbiters/ReflectionsArbiter.js', content, 'utf8');
console.log('patched');
