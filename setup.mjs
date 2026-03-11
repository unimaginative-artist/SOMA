#!/usr/bin/env node
/**
 * setup.mjs — SOMA First-Run Setup Wizard
 * Run once after cloning: node setup.mjs
 */

import readline from 'readline/promises';
import { stdin as input, stdout as output } from 'process';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const rl = readline.createInterface({ input, output });

// ── Helpers ────────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m',
    magenta: '\x1b[35m', red: '\x1b[31m', blue: '\x1b[34m',
};
const print  = msg  => process.stdout.write((msg ?? '') + '\n');
const dim    = msg  => print(`${C.dim}${msg}${C.reset}`);
const ok     = msg  => print(`${C.green}  ✅  ${msg}${C.reset}`);
const warn   = msg  => print(`${C.yellow}  ⚠️   ${msg}${C.reset}`);
const section = msg => print(`\n${C.cyan}${C.bold}${msg}${C.reset}`);

async function ask(prompt, defaultVal = '') {
    const hint = defaultVal ? ` ${C.dim}(${defaultVal})${C.reset}` : '';
    const answer = await rl.question(`  ${C.bold}${prompt}${C.reset}${hint}: `);
    return answer.trim() || defaultVal;
}
async function askYN(prompt, def = 'y') {
    const answer = await ask(`${prompt} [y/n]`, def);
    return answer.toLowerCase().startsWith('y');
}

// ── Banner ─────────────────────────────────────────────────────────────────
print(`
${C.magenta}${C.bold}  ╔══════════════════════════════════════════════════════╗
  ║          SOMA — Cognitive OS — Setup Wizard          ║
  ╚══════════════════════════════════════════════════════╝${C.reset}
  ${C.dim}She needs a few things configured before she wakes up.${C.reset}
`);

// ── 1. Node version ────────────────────────────────────────────────────────
section('Step 1 — Environment');
const [major] = process.versions.node.split('.').map(Number);
if (major < 18) {
    print(`${C.red}  ✗ Node.js 18+ required. You have ${process.versions.node}.${C.reset}`);
    print('  Download: https://nodejs.org');
    process.exit(1);
}
ok(`Node.js ${process.versions.node}`);

// ── 2. npm install ─────────────────────────────────────────────────────────
section('Step 2 — Dependencies');
try {
    await fs.access(path.join(ROOT, 'node_modules'));
    ok('node_modules present — skipping install');
} catch {
    print('  Installing dependencies (this takes a minute the first time)...');
    try {
        await execAsync('npm install', { cwd: ROOT });
        ok('Dependencies installed');
    } catch (e) {
        warn('npm install failed — you may need to run it manually');
        dim(`    ${e.message.split('\n')[0]}`);
    }
}

// ── 3. API Keys ────────────────────────────────────────────────────────────
section('Step 3 — API Keys');
print(`  ${C.dim}SOMA needs at least one LLM to think with.
  Ollama (local, free) works out of the box if you have it running.
  Add cloud keys for better reasoning and web search.${C.reset}\n`);

const keysPath    = path.join(ROOT, 'config', 'api-keys.env');
const examplePath = path.join(ROOT, 'config', 'api-keys.env.example');

let existingKeys = {};
try {
    const content = await fs.readFile(keysPath, 'utf8');
    for (const line of content.split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0 && !line.startsWith('#')) {
            existingKeys[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
    }
    dim('  Found existing config/api-keys.env — only empty entries will be prompted.');
} catch {
    const example = await fs.readFile(examplePath, 'utf8');
    await fs.writeFile(keysPath, example);
    dim('  Created config/api-keys.env from template.');
}

const KEY_DEFS = [
    { key: 'GEMINI_API_KEY',    label: 'Gemini API key',    note: 'Main brain — free tier at aistudio.google.com', required: true  },
    { key: 'OPENAI_API_KEY',    label: 'OpenAI API key',    note: 'Optional fallback — platform.openai.com',        required: false },
    { key: 'ANTHROPIC_API_KEY', label: 'Anthropic API key', note: 'Optional fallback — console.anthropic.com',     required: false },
    { key: 'BRAVE_API_KEY',     label: 'Brave Search key',  note: 'Live web search — api.search.brave.com',        required: false },
    { key: 'GROQ_API_KEY',      label: 'Groq API key',      note: 'Fast inference fallback — console.groq.com',    required: false },
];

const collectedKeys = { ...existingKeys };
for (const { key, label, note, required } of KEY_DEFS) {
    const cur = existingKeys[key] || '';
    const isSet = cur && !cur.includes('your-') && cur.length > 10;
    if (isSet) { ok(`${label} — already set`); continue; }
    dim(`    ${note}`);
    const val = await ask(`  ${label}${required ? '' : ' (Enter to skip)'}`, '');
    if (val) collectedKeys[key] = val;
}

// Patch the keys file
let keysContent = await fs.readFile(keysPath, 'utf8');
for (const [k, v] of Object.entries(collectedKeys)) {
    if (!v) continue;
    if (keysContent.includes(`${k}=`)) {
        keysContent = keysContent.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
    } else {
        keysContent += `\n${k}=${v}`;
    }
}
await fs.writeFile(keysPath, keysContent);
ok('config/api-keys.env saved');

// ── 4. Personas ────────────────────────────────────────────────────────────
section('Step 4 — Personas');

const PLUGIN_CATEGORIES = {
    'Engineering':  ['backend-development','frontend-mobile-development','full-stack-orchestration','javascript-typescript','python-development','systems-programming','jvm-languages','julia-development','dotnet-contribution'],
    'Code Quality': ['code-review-ai','code-refactoring','codebase-cleanup','debugging-toolkit','error-debugging','error-diagnostics','tdd-workflows','unit-testing','code-documentation','documentation-generation'],
    'Architecture': ['api-scaffolding','api-testing-observability','c4-architecture','database-design','database-migrations','database-cloud-optimization','dependency-management','framework-migration','functional-programming'],
    'DevOps/Cloud': ['cicd-automation','cloud-infrastructure','deployment-strategies','deployment-validation','kubernetes-operations','observability-monitoring','incident-response','performance-testing-review','application-performance'],
    'Security':     ['backend-api-security','frontend-mobile-security','security-compliance','security-scanning','reverse-engineering'],
    'Finance/Data': ['quantitative-trading','business-analytics','data-engineering','data-validation-suite','machine-learning-ops','llm-application-dev'],
    'Web/SEO':      ['seo-analysis-monitoring','seo-content-creation','seo-technical-optimization','web-scripting','content-marketing'],
    'Operations':   ['agent-orchestration','conductor','context-management','team-collaboration','hr-legal-compliance','customer-sales-automation','payment-processing','startup-business-analyst'],
    'Specialized':  ['arm-cortex-microcontrollers','blockchain-web3','game-development','git-pr-workflows','multi-platform-apps','shell-scripting','distributed-debugging','comprehensive-review','accessibility-compliance'],
};

const repoPluginsPath = path.join(ROOT, 'agents_repo', 'plugins');
let hasRepo = false;
try { await fs.access(repoPluginsPath); hasRepo = true; } catch {}

if (!hasRepo) {
    warn('agents_repo/plugins not found — personas unavailable');
    dim('    The repo includes agents_repo — try: git pull');
} else {
    const allPlugins = await fs.readdir(repoPluginsPath);
    print(`  ${C.bold}${allPlugins.length} persona plugins available${C.reset} across ${Object.keys(PLUGIN_CATEGORIES).length} categories:\n`);

    Object.entries(PLUGIN_CATEGORIES).forEach(([cat, plugins], i) => {
        const available = plugins.filter(p => allPlugins.includes(p));
        print(`  ${C.cyan}${C.bold}[${i+1}] ${cat.padEnd(14)}${C.reset}${C.dim}${available.length} plugins — ${available.slice(0,3).join(', ')}${available.length > 3 ? '...' : ''}${C.reset}`);
    });

    print('');
    const catPick = await ask('  Pick categories to activate (e.g. 1,3,6 or all)', 'all');
    let activeCats;
    if (catPick.trim().toLowerCase() === 'all') {
        activeCats = Object.values(PLUGIN_CATEGORIES).flat();
    } else {
        const indices = catPick.split(',').map(s => parseInt(s.trim()) - 1);
        const catNames = Object.keys(PLUGIN_CATEGORIES);
        activeCats = indices
            .filter(i => i >= 0 && i < catNames.length)
            .flatMap(i => PLUGIN_CATEGORIES[catNames[i]]);
    }

    // Write persona selection config
    const personaConfig = {
        activePlugins: activeCats,
        updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(
        path.join(ROOT, 'config', 'personas.json'),
        JSON.stringify(personaConfig, null, 2)
    );
    ok(`${activeCats.length} persona plugins activated`);
    print(`  ${C.dim}SOMA will channel these specialists during conversations.${C.reset}`);
}

// ── 5. Knowledge Packs ─────────────────────────────────────────────────────
section('Step 5 — Knowledge Packs');
print(`  ${C.dim}Each pack seeds SOMA's thought network with ~15 domain concepts.
  She'll build far beyond these from real conversations — these just give
  her a foundation so she's not starting from zero.${C.reset}\n`);

const PACKS = [
    { id: 'coder',    label: 'Software Engineering', desc: 'Architecture, debugging, code review, algorithms, clean code'  },
    { id: 'finance',  label: 'Finance & Trading',    desc: 'Quant strategies, risk management, portfolio theory, markets'  },
    { id: 'research', label: 'Research & Analysis',  desc: 'Literature review, data synthesis, scientific method, sources' },
    { id: 'devops',   label: 'DevOps & Cloud',       desc: 'Containers, CI/CD, infrastructure as code, observability'       },
    { id: 'security', label: 'Security',             desc: 'Threat modeling, secure coding, incident response, red team'   },
    { id: 'creative', label: 'Creative & Content',   desc: 'Narrative structure, ideation, writing craft, content strategy'},
];

print('  Available packs:');
PACKS.forEach((p, i) => {
    print(`  ${C.bold}[${i+1}]${C.reset} ${C.cyan}${p.label.padEnd(22)}${C.reset} ${C.dim}${p.desc}${C.reset}`);
});
print('');

const packPick = await ask('  Pick packs to install (e.g. 1,2 or all)', 'all');
let selectedPacks;
if (packPick.trim().toLowerCase() === 'all') {
    selectedPacks = PACKS.map(p => p.id);
} else {
    const indices = packPick.split(',').map(s => parseInt(s.trim()) - 1).filter(i => i >= 0 && i < PACKS.length);
    selectedPacks = indices.map(i => PACKS[i].id);
}
if (selectedPacks.length === 0) selectedPacks = ['coder'];

print('');
print(`  Selected: ${selectedPacks.map(id => PACKS.find(p => p.id === id).label).join(', ')}`);

// ── 6. Seed thought network ────────────────────────────────────────────────
section('Step 6 — Seeding Thought Network');

await fs.mkdir(path.join(ROOT, 'SOMA'), { recursive: true });

const allNodes = [];
const packsToLoad = ['core', ...selectedPacks];

for (const packId of packsToLoad) {
    try {
        const raw = await fs.readFile(path.join(ROOT, 'seeds', `${packId}.json`), 'utf8');
        const pack = JSON.parse(raw);
        const ts = Date.now();
        const stamped = pack.nodes.map(n => ({ ...n, created: ts, lastAccessed: ts }));
        allNodes.push(...stamped);
        ok(`${pack.name} — ${pack.nodes.length} nodes`);
    } catch (e) {
        warn(`seeds/${packId}.json not found — skipping`);
    }
}

const tnPath = path.join(ROOT, 'SOMA', 'thought-network.json');
let existing = null;
try { existing = JSON.parse(await fs.readFile(tnPath, 'utf8')); } catch {}

if (existing?.nodes?.length > 0) {
    const doMerge = await askYN(
        `\n  Existing thought network found (${existing.nodes.length} nodes). Merge seeds in?`, 'y'
    );
    if (doMerge) {
        const existingIds = new Set(existing.nodes.map(n => n.id));
        const newNodes = allNodes.filter(n => !existingIds.has(n.id));
        existing.nodes.push(...newNodes);
        existing.stats.totalNodes = existing.nodes.length;
        existing.stats.totalConnections = existing.nodes.reduce((s, n) => s + (n.connections?.length || 0), 0);
        existing.stats.lastGrowth = Date.now();
        await fs.writeFile(tnPath, JSON.stringify(existing, null, 2));
        ok(`Merged ${newNodes.length} seed nodes → ${existing.nodes.length} total`);
    } else {
        ok('Kept existing thought network unchanged');
    }
} else {
    const network = {
        name: 'SOMA-ThoughtNetwork',
        stats: {
            totalNodes: allNodes.length,
            totalConnections: allNodes.reduce((s, n) => s + (n.connections?.length || 0), 0),
            averageDepth: 0,
            lastGrowth: Date.now(),
            growthRate: 0,
        },
        nodes: allNodes,
    };
    await fs.writeFile(tnPath, JSON.stringify(network, null, 2));
    ok(`Thought network created — ${allNodes.length} seed nodes`);
}

// ── 7. Build frontend ──────────────────────────────────────────────────────
section('Step 7 — Frontend');

const distExists = await fs.access(path.join(ROOT, 'dist')).then(() => true).catch(() => false);
if (distExists) {
    ok('dist/ already exists — skipping build');
    dim('    Run "npm run build" manually to rebuild after code changes.');
} else {
    const doBuild = await askYN('  Build the frontend dashboard now? (~2 minutes)', 'y');
    if (doBuild) {
        print('  Building...');
        try {
            await execAsync('npm run build', { cwd: ROOT });
            ok('Frontend built — dist/ ready');
        } catch (e) {
            warn('Build had errors — run "npm run build" to see them');
            dim(`    ${e.message.split('\n')[0]}`);
        }
    } else {
        dim('  Skipped — run "npm run build" before first launch.');
    }
}

// ── 7b. Build Electron main process ───────────────────────────────────────
// dist-electron/ is gitignored — we copy electron/main.js there so "npx electron ." works
const electronSrc  = path.join(ROOT, 'electron', 'main.js');
const electronDest = path.join(ROOT, 'dist-electron', 'main.js');
const electronSrcExists = await fs.access(electronSrc).then(() => true).catch(() => false);
if (electronSrcExists) {
    await fs.mkdir(path.join(ROOT, 'dist-electron'), { recursive: true });
    await fs.copyFile(electronSrc, electronDest);
    ok('Electron main process ready (dist-electron/main.js)');
}

// ── 8. Done ────────────────────────────────────────────────────────────────
rl.close();

print(`
${C.green}${C.bold}  ╔══════════════════════════════════════════════════════╗
  ║               ✅  SOMA is ready.                     ║
  ╚══════════════════════════════════════════════════════╝${C.reset}

  ${C.bold}To start SOMA:${C.reset}
  ${C.cyan}  Windows  →${C.reset}  start_production.bat
  ${C.cyan}  Linux    →${C.reset}  ./start.sh
  ${C.cyan}  Manual   →${C.reset}  SOMA_LOAD_HEAVY=true node --max-old-space-size=4096 launcher_ULTRA.mjs

  ${C.bold}Dashboard:${C.reset}  http://localhost:3001
  ${C.bold}Chat API: ${C.reset}  POST http://localhost:3001/api/chat

  ${C.dim}Run this wizard again any time to add more persona packs or knowledge seeds.${C.reset}
  ${C.dim}Questions → https://github.com/unimaginative-artist/SOMA${C.reset}
`);
