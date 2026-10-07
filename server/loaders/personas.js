/**
 * loaders/personas.js - PHASE 7: IDENTITY & PERSONA LOADING
 * 
 * Scans the agents_repo and populates SOMA's persona library.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { IdentityArbiter } from '../../arbiters/IdentityArbiter.js';

// Compute project root from this file's location (server/loaders/personas.js → project root)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

export async function loadPersonas(systemContext) {
    console.log('\n[Loader] 🎭 Phase 7: Initializing Identity & Persona Library...');

    const { mnemonicArbiter, microAgentPool, messageBroker } = systemContext;
    const repoPath = path.join(PROJECT_ROOT, 'agents_repo', 'plugins');

    const identityArbiter = new IdentityArbiter({
        mnemonic: mnemonicArbiter,
        microAgentPool,
        messageBroker,
        repoPath
    });

    await identityArbiter.initialize();

    // Recursive Scanner
    async function scanPersonas(dir) {
        let files = [];
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    files.push(...(await scanPersonas(fullPath)));
                } else if (entry.name.endsWith('.md')) {
                    files.push(fullPath);
                }
            }
        } catch (e) {
            console.warn(`      ⚠️  Scan warning in ${dir}: ${e.message}`);
        }
        return files;
    }

    console.log('      🔍 Scanning agents_repo for identities...');
    const personaFiles = await scanPersonas(repoPath);
    console.log(`      🎯 Found ${personaFiles.length} .md files. Indexing all valid personas...`);

    // Parser & Indexer — Phase 1: Register personas in-memory (fast, no I/O bottleneck)
    let loadedCount = 0;
    let skippedNoFrontmatter = 0;
    let skippedNoName = 0;
    let skippedError = 0;
    const mnemonicQueue = []; // Deferred: index in memory after all personas are registered

    for (const filePath of personaFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf8');

            // Simple YAML parser for frontmatter (Robust for Windows newlines)
            const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if (!match) { skippedNoFrontmatter++; continue; }

            const frontmatterRaw = match[1];
            const personaContent = match[2].trim();
            const metadata = {};

            frontmatterRaw.split('\n').forEach(line => {
                const [key, ...val] = line.split(':');
                if (key && val) metadata[key.trim()] = val.join(':').trim();
            });

            if (!metadata.name) { skippedNoName++; continue; }

            // --- NEURAL CATEGORIZATION (QuadBrain Lobe Mapping) ---
            const domainStr = metadata.domain ? metadata.domain.toUpperCase() : '';
            const dirName = path.basename(path.dirname(path.dirname(filePath))).toUpperCase();
            const combinedText = `${domainStr} ${dirName} ${metadata.name || ''}`.toUpperCase();

            if (/(SECURITY|RISK|POLICY|COMPLIANCE|THREAT|AUDIT|GOVERN|ACCESS|VULNERABILITY)/.test(combinedText)) {
                metadata.lobe = 'THALAMUS';
            } else if (/(STRATEGY|PLANNER|ROADMAP|OPS|OPTIMIZATION|FORECAST|BUSINESS|FINANCE|TRADING|MARKET|CRYPTO|SEO|SALES|STARTUP|MANAGEMENT)/.test(combinedText)) {
                metadata.lobe = 'PROMETHEUS';
            } else if (/(ARTIST|CREATIVE|DESIGN|MUSIC|WRITER|POET|STORY|VISUAL|EMOTION|PERSONALITY|PHILOSOPHY|CONTENT|UI|UX)/.test(combinedText)) {
                metadata.lobe = 'AURORA';
            } else if (/(ENGINEER|DEVELOPER|CODE|SOFTWARE|LOGIC|MATH|DEBUG|SYSTEM|TERMINAL|FILE|SCRIPT|TESTING|API|FRONTEND|BACKEND|DATA|BLOCKCHAIN)/.test(combinedText)) {
                metadata.lobe = 'LOGOS';
            } else {
                // Default to LOGOS for analytical/general reasoning tasks if ambiguous
                metadata.lobe = 'LOGOS';
            }

            const personaDomain = metadata.domain || path.basename(path.dirname(path.dirname(filePath))) || 'general';

            // 1. Register in active map (instant, in-memory)
            identityArbiter.registerPersona(metadata.name, {
                ...metadata,
                domain: personaDomain,
                content: personaContent,
                path: filePath
            });

            // 2. Queue for deferred mnemonic indexing (don't block boot)
            if (mnemonicArbiter) {
                mnemonicQueue.push({
                    content: personaContent,
                    meta: {
                        type: 'identity',
                        name: metadata.name,
                        description: metadata.description || '',
                        domain: metadata.domain || path.basename(path.dirname(path.dirname(filePath))),
                        preferredBrain: metadata.preferredBrain || metadata.brain || '',
                        source: 'agents_repo'
                    }
                });
            }

            loadedCount++;
            // Yield every 100 personas to keep event loop breathing
            if (loadedCount % 100 === 0) {
                console.log(`      📥 Registered ${loadedCount} personas...`);
                await new Promise(r => setTimeout(r, 10));
            }

        } catch (error) {
            skippedError++;
            if (skippedError <= 5) {
                console.warn(`      ⚠️  Persona load failed for ${path.relative(PROJECT_ROOT, filePath)}: ${error.message}`);
            }
        }
    }

    console.log(`      ✅ IdentityArbiter online - ${loadedCount} personas registered`);
    if (skippedNoFrontmatter || skippedNoName || skippedError) {
        console.log(`      ℹ️  Skipped: ${skippedNoFrontmatter} commands (no frontmatter), ${skippedNoName} malformed (no name), ${skippedError} errors`);
    }

    // Phase 2: Deferred mnemonic indexing — runs in background, never blocks boot
    // Only attempt if mnemonic appears healthy (skip if Redis is down to avoid 464 timeout calls)
    if (mnemonicQueue.length > 0 && mnemonicArbiter) {
        console.log(`      🧠 Queuing ${mnemonicQueue.length} personas for background mnemonic indexing...`);
        setTimeout(async () => {
            // Quick health probe: try one remember call with a short timeout
            let healthy = false;
            try {
                const probe = Promise.race([
                    mnemonicArbiter.remember('identity-probe', { type: 'probe', name: 'health-check', source: 'personas_loader' }),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('mnemonic timeout')), 3000))
                ]);
                await probe;
                healthy = true;
            } catch (e) {
                console.warn(`      ⚠️ Mnemonic unhealthy (${e.message}) — skipping persona indexing. Personas still available in active map.`);
            }

            if (!healthy) return;

            let indexed = 0;
            let errors = 0;
            for (const item of mnemonicQueue) {
                try {
                    await mnemonicArbiter.remember(item.content, item.meta);
                    indexed++;
                } catch (e) {
                    errors++;
                    // Bail if too many errors (Redis probably down)
                    if (errors >= 5) {
                        console.warn(`      ⚠️ Mnemonic indexing aborted after ${errors} errors. ${indexed}/${mnemonicQueue.length} indexed.`);
                        return;
                    }
                }
                // Yield every 10 to keep event loop responsive
                if (indexed % 10 === 0) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }
            console.log(`      🧠 Mnemonic indexing complete: ${indexed}/${mnemonicQueue.length} personas indexed`);
        }, 30000); // Delay 30s to let Tier 2 finish loading first
    }

    return { identityArbiter };
}
