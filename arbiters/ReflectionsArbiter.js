import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
import fs from 'fs/promises';
import path from 'path';
import { ContentExtractor } from '../server/utils/ContentExtractor.js';

/**
 * ReflectionsArbiter â€” PROJECT REFLECTIONS
 * v0.5 â€” SOMA's Mirror with Graphify Semantic Indexing
 */
export class ReflectionsArbiter extends BaseArbiter {
  static role = 'knowledge-vault';
  static capabilities = [
    'transmute-file',
    'append-stream',
    'query-vault',
    'distill-session',
    'auto-index',
    'semantic-linking'
  ];

  constructor(id, config = {}) {
    super({ name: id || 'ReflectionsArbiter', role: 'knowledge-vault', ...config });
    this.vaultPath = config.vaultPath || path.join(process.cwd(), 'data', 'vault', 'reflections');
    this.extractor = new ContentExtractor();
    this.graphify = config.graphify; // Link to GraphifyArbiter
  }

  
  async _logWriteAccess(filePath, action, metadata = {}) {
    try {
      const stack = new Error().stack.split('\n');
      const callerLine = stack.length > 3 ? stack[3].trim() : 'unknown caller';
      const source = metadata.source || metadata.context?.source || 'unknown';
      const logLine = `[${new Date().toISOString()}] [WRITE: ${action}] -> ${filePath} | SOURCE: ${source} | CALLER: ${callerLine}\n`;
      
      const fsPromises = require('fs').promises;
      const logFile = require('path').join(this.vaultPath, '_write_audit.log');
      await fsPromises.appendFile(logFile, logLine);
      console.log(`[Reflections Audit] ${logLine.trim()}`);
    } catch(e) {
      console.error('[Reflections Audit] Failed to log write access', e.message);
    }
  }

  async onInitialize() {
    console.log('[Reflections] ðŸ›ï¸ Initializing SOMA Reflections Pool...');
    await fs.mkdir(this.vaultPath, { recursive: true });

    messageBroker.subscribe('vault_ingestion_requested', async (msg) => {
      try {
        await this.handleIngestion(msg.payload);
      } catch (err) {
        console.error('[Reflections] Ingestion error:', err.message);
      }
    });

    console.log('[Reflections] âœ… Mirror online and reflecting.');
  }

  /**
   * Distill a brainstorming session into a structured technical concept
   */
  async distillSession(chatLog, sessionTitle = 'New Concept') {
    console.log('[Reflections] ðŸ”® Crystallizing brainstorm session...');
    try {
      const prompt = `[CRYSTALLIZATION PROTOCOL] 
Analyze this brainstorming transcript and extract the RAW IDEAS, FUTURE CONCEPTS, and TECHNICAL PREREQUISITES.
Format as high-quality SOMA reflection Markdown with [[Links]] to related concepts.

TRANSCRIPT:
${chatLog}`;

      const brain = this.broker ? await this.broker.sendMessage({
        to: 'SomaBrain',
        type: 'reason',
        payload: { query: prompt, context: { mode: 'slow', brain: 'PROMETHEUS' } }
      }) : { text: 'Brain offline' };

      const distillation = brain.text || brain;
      const safeTitle = sessionTitle.toLowerCase().replace(/\s+/g, '_').substring(0, 30);
      const filename = `concept_${safeTitle}_${Date.now()}.md`;
      
      const mdContent = `---
category: concept
type: distillation
created: ${new Date().toISOString()}
source: brainstorm
---

# ðŸ’¡ ${sessionTitle}

${distillation}

---
## ðŸ“œ Raw Spark (Transcript Extract)
${chatLog.slice(-2000)}

---
*Crystallized via Project Muse*
`;

      const filePath = path.join(this.vaultPath, filename);
    await this._logWriteAccess(filePath, 'distillSession/saveMuseSessionArtifact');
    await fs.writeFile(filePath, mdContent);

      // 🕸️ Trigger Graphify Update
      if (this.graphify) {
          console.log('[Reflections] 🕸️ Triggering Graphify update for new concept...');
          this.graphify.triggerUpdate().catch(e => console.warn('[Reflections] Graphify update failed:', e.message));
      }

      return { success: true, path: filePath, title: sessionTitle };
    } catch (err) {
      console.error('[Reflections] Crystallization failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async saveMuseSessionArtifact({ title, chatLog, museResponse = '', structured = null, metadata = {} }) {
    const date = new Date().toISOString();
    const safeTitle = String(title || 'Muse Concept')
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .substring(0, 48) || 'muse_concept';
    const filename = `muse_${safeTitle}_${Date.now()}.md`;
    const spark = structured?.spark || '';
    const variant = structured?.variant || '';
    const critique = structured?.critique || '';
    const crystallize = structured?.crystallize || museResponse || '';
    const tags = Array.from(new Set([
      'muse',
      'creative',
      'concept',
      ...(metadata.tags || [])
    ])).filter(Boolean);

    const mdContent = `---
title: ${JSON.stringify(title || 'Muse Concept')}
category: concept
type: muse-session
created: ${date}
source: Project Muse
persona: Muse
brain: AURORA
status: crystallized
tags: [${tags.join(', ')}]
---

# ${title || 'Muse Concept'}

## Premise

${crystallize}

${spark ? `## Spark\n\n${spark}\n\n` : ''}${variant ? `## Variant\n\n${variant}\n\n` : ''}${critique ? `## Critique\n\n${critique}\n\n` : ''}## Next Action

- [ ] Turn this concept into the smallest testable artifact.

## Links To Explore

- [[Muse Persona]]
- [[Creative Systems]]
- [[Prototype]]

## Raw Session

${chatLog}

---
*Crystallized via Project Muse*
`;

    const filePath = path.join(this.vaultPath, filename);
    await this._logWriteAccess(filePath, 'distillSession/saveMuseSessionArtifact');
    await fs.writeFile(filePath, mdContent);

    if (this.graphify) {
      this.graphify.triggerUpdate().catch(e => console.warn('[Reflections] Graphify update failed:', e.message));
    }

    await messageBroker.publish('vault_entry_added', {
      type: 'muse_session',
      title,
      filename,
      timestamp: Date.now()
    });

    return { success: true, path: filePath, filename, title };
  }

  async handleIngestion(payload) {
    const { filePath, originalName, metadata = {} } = payload;
    console.log(`[Reflections] ðŸ§ª Transmuting: ${originalName}...`);

    try {
      const content = await this.extractor.extract(filePath);
      const date = new Date().toISOString();
      const noteTitle = originalName.split('.')[0].replace(/\s+/g, '_');
      const mdContent = `---
title: ${originalName}
source: ${metadata.source || 'upload'}
ingested: ${date}
tags: [${metadata.tags?.join(', ') || 'unfiltered'}]
---

# ${originalName}

${content}

---
*Verified via Project Reflections*
`;

      const vaultFile = path.join(this.vaultPath, `${noteTitle}_${Date.now()}.md`);
      await this._logWriteAccess(vaultFile, 'handleIngestion', metadata);
      await fs.writeFile(vaultFile, mdContent);
      
      // 🕸️ Trigger Graphify Update
      if (this.graphify) {
          this.graphify.triggerUpdate().catch(e => console.warn('[Reflections] Graphify update failed:', e.message));
      }

      return { success: true, path: vaultFile };
    } catch (err) {
      console.error('[Reflections] Ingestion failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  async appendQuickNote(text, metadata = {}) {
    const date = new Date().toISOString();
    const yamlScalar = (value) => JSON.stringify(String(value ?? ''));
    const contextValue = metadata.context
      ? Buffer.from(JSON.stringify(metadata.context)).toString('base64')
      : '';

    // Use provided title or auto-slug from first 6 words
    const titleSlug = metadata.title
      ? metadata.title.replace(/[^a-zA-Z0-9\s\-]/g, '').trim().replace(/\s+/g, '-').toLowerCase().slice(0, 40)
      : text.trim().split(/\s+/).slice(0, 6).join('-').replace(/[^a-zA-Z0-9\-]/g, '').toLowerCase().slice(0, 40) || 'note';

    const words = text.toLowerCase().match(/\b[a-z]{5,}\b/g) || [];
    const freq = {};
    words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
    const tags = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);

    const filename = `note_${titleSlug}_${Date.now()}.md`;
    const titleLine = metadata.title ? `title: ${yamlScalar(metadata.title)}\n` : '';
    const contextLine = contextValue ? `context_b64: ${contextValue}\n` : '';
    const sourceLine = metadata.context?.source ? `source: ${yamlScalar(metadata.context.source)}\n` : '';
    const brainLanes = Array.isArray(metadata.brainLanes) ? metadata.brainLanes : [];
    const brainLine = brainLanes.length ? `brain_lanes: [${brainLanes.map(yamlScalar).join(', ')}]\n` : '';
    const mdContent = `---\ncreated: ${date}\n${titleLine}${sourceLine}${contextLine}${brainLine}type: quick-note\ntags: [${tags.map(yamlScalar).join(', ')}]\n---\n\n${text}\n`;
    const fullPath = path.join(this.vaultPath, filename);
    await this._logWriteAccess(fullPath, 'appendQuickNote', metadata);
    await fs.writeFile(fullPath, mdContent);

    // 🕸️ Trigger Graphify Update
    if (this.graphify) {
        this.graphify.triggerUpdate().catch(e => console.warn('[Reflections] Graphify update failed:', e.message));
    }

    await messageBroker.publish('vault_entry_added', { type: 'quick_note', content: text, timestamp: Date.now() });
    return { success: true, filename };
  }
}

export default ReflectionsArbiter;

