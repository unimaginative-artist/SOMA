/**
 * loaders/tools.js - RECONSTRUCTED
 * 
 * Central registry for SOMA's tools.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import bannedNodes from '../services/GMNBannedNodes.js';
import toolRegistry from '../../core/ToolRegistry.js';
import { recordCapabilityTruth, recordTruth } from '../../core/TruthLedger.js';
import { analyzeImageFile, imageMimeType, isImageFile } from '../utils/LocalVisionFileAnalyzer.js';
import {
    auditMemorySpine,
    rebuildMemorySpine,
    recallMemorySpine,
    createMemorySpineGoals,
    syncMemorySpineToThoughtNetwork,
    memorySpinePaths
} from '../utils/MemorySpine.js';

function normalizeVisionToolObjects(objects = []) {
    return (Array.isArray(objects) ? objects : [])
        .map(obj => typeof obj === 'string'
            ? { label: obj, score: null, bbox: null }
            : {
                label: String(obj?.label || obj?.name || obj?.class || 'unknown').toLowerCase(),
                score: Number.isFinite(obj?.score) ? obj.score : (Number.isFinite(obj?.confidence) ? obj.confidence : null),
                bbox: obj?.bbox || obj?.box || null
            })
        .filter(obj => obj.label && obj.label !== 'unknown');
}

async function pathExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function speakWithWindowsSpeech(message, rate = 0, volume = 100) {
    if (process.platform !== 'win32') {
        return { success: false, error: 'Windows System.Speech requires win32.' };
    }

    const script = `
Add-Type -AssemblyName System.Speech
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
$speaker.Rate = [int]$env:SOMA_SPEAK_RATE
$speaker.Volume = [int]$env:SOMA_SPEAK_VOLUME
$speaker.Speak($env:SOMA_SPEAK_TEXT)
$speaker.Dispose()
`;

    return await new Promise((resolve) => {
        execFile('powershell.exe', [
            '-NoProfile',
            '-ExecutionPolicy', 'Bypass',
            '-Command', script
        ], {
            timeout: 30000,
            windowsHide: true,
            env: {
                ...process.env,
                SOMA_SPEAK_TEXT: message,
                SOMA_SPEAK_RATE: String(rate),
                SOMA_SPEAK_VOLUME: String(volume)
            }
        }, (error, stdout, stderr) => {
            if (error) {
                resolve({ success: false, error: error.message, stderr: String(stderr || '').trim() });
                return;
            }
            resolve({ success: true, stdout: String(stdout || '').trim() });
        });
    });
}

export async function loadTools(systemContext = {}) {
    console.log('\n[Loader] 🛠️  Initializing Tools...');

    // System context will have all arbiters available
    const system = systemContext;
    const getSystem = () => toolRegistry.__system || system;

    // Standard Tools
    toolRegistry.registerTool({
        name: 'calculator',
        description: 'Evaluate mathematical expressions (numbers and operators only)',
        parameters: { expression: 'string' },
        execute: async ({ expression }) => {
            try {
                // Whitelist: only digits, spaces, and math operators — no function calls, no identifiers
                if (!/^[\d\s+\-*/.()%**e,]+$/i.test(expression)) {
                    return 'Error: only numeric expressions are allowed (e.g. "2 + 2", "10 / 3", "2 ** 8")';
                }
                // eslint-disable-next-line no-new-func
                return new Function('"use strict"; return (' + expression + ')')();
            } catch (e) { return 'Error: ' + e.message; }
        }
    });

    toolRegistry.registerTool({
        name: 'get_time',
        description: 'Get current server time',
        parameters: {},
        execute: async () => new Date().toISOString()
    });

    // Graceful self-restart through the independent Marionette supervisor.
    // SOMA can't resurrect her own crashed process alone — but she can ask a
    // cooperator that OUTLIVES her restart to do it, verify health, and
    // auto-roll-back if the new code is broken. Continuity lives in Marionette.
    toolRegistry.registerTool({
        name: 'request_self_restart',
        description: "Ask the independent Marionette supervisor (port 9000) to restart your OWN server — e.g. to load code changes you committed. Marionette restarts you, health-checks the new server, and AUTO-ROLLS-BACK to the last git commit if the new version comes up broken. You'll go down briefly and return; Marionette survives the restart. Use only after committing real changes that need a restart.",
        parameters: { reason: 'string', rollback: 'boolean — roll back to last commit if the restarted server is unhealthy (default true)' },
        execute: async ({ reason, rollback }) => {
            let rollbackRef = null;
            if (rollback !== false) {
                try {
                    const { execSync } = await import('child_process');
                    rollbackRef = execSync('git rev-parse HEAD', { cwd: process.cwd() }).toString().trim();
                } catch { /* no git ref available */ }
            }
            try {
                const res = await fetch('http://127.0.0.1:9000/deploy/soma', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ rollback_ref: rollbackRef, reason: reason || 'SOMA self-restart request' })
                });
                const data = await res.json();
                if (data.error) return `Marionette declined the restart: ${data.error}`;
                await recordCapabilityTruth('SOMA can request Marionette self-restart', {
                    verified: true,
                    source: 'request_self_restart_tool',
                    proof: data,
                    metadata: { rollbackRef, reason: reason || 'SOMA self-restart request' }
                }).catch(() => {});
                return `Restart requested through Marionette (the independent supervisor that survives my restart). `
                    + `It will stop me, start the new server, verify /health, and `
                    + (rollbackRef ? `auto-roll-back to ${rollbackRef.slice(0, 8)} if I come up broken. ` : `report if I fail to come back. `)
                    + `I'll be down briefly and return. Watch http://127.0.0.1:9000/status for the result.`;
            } catch (e) {
                await recordCapabilityTruth('SOMA can request Marionette self-restart', {
                    verified: false,
                    status: 'failed',
                    confidence: 1,
                    source: 'request_self_restart_tool',
                    proof: e.message
                }).catch(() => {});
                return `Could not reach the Marionette supervisor on :9000 (${e.message}). It may not be running — without it I cannot safely restart myself.`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'marionette_status',
        description: 'Check the independent Marionette supervisor status and record whether the SOMA/MAX watchdog is actually online.',
        parameters: {},
        execute: async () => {
            try {
                const res = await fetch('http://127.0.0.1:9000/status');
                const data = await res.json();
                await recordTruth('Marionette supervisor status checked', {
                    status: res.ok ? 'verified' : 'failed',
                    confidence: res.ok ? 1 : 0.4,
                    proof: data,
                    source: 'marionette_status_tool'
                }).catch(() => {});
                return data;
            } catch (e) {
                await recordTruth('Marionette supervisor status checked', {
                    status: 'failed',
                    confidence: 1,
                    proof: e.message,
                    source: 'marionette_status_tool'
                }).catch(() => {});
                return { success: false, error: `Marionette unavailable on :9000: ${e.message}` };
            }
        }
    });

    // ApertureOS Agency Bridge — SOMA drives the desktop-in-a-tab as a copilot.
    toolRegistry.registerTool({
        name: 'aperture_os',
        description: "Control the ApertureOS desktop as Barry's copilot: open or close an app, show a desktop notification, or navigate the Portal browser. Use when asked to do something on the desktop/Aperture, or to proactively show Barry something there. Verbs: open_app|close_app (arg: files|portal|tasks|notes|calendar|status|archive|settings|terminal|processes), notify (arg: message text), portal_navigate (arg: URL or search query).",
        parameters: { verb: 'string (open_app|close_app|notify|portal_navigate)', arg: 'string' },
        execute: async ({ verb, arg }) => {
            const verbs = ['open_app', 'close_app', 'notify', 'portal_navigate'];
            if (!verbs.includes(verb)) return `Error: verb must be one of ${verbs.join(', ')}`;
            const sys = getSystem();
            if (typeof sys.broadcast !== 'function') return 'ApertureOS bridge offline (WebSocket layer not ready yet)';
            sys.broadcast('aperture_command', { verb, arg: String(arg ?? ''), from: 'SOMA', at: Date.now() });
            return `Done — ${verb}${arg ? ` ("${arg}")` : ''} sent to the ApertureOS desktop, attributed to me.`;
        }
    });

    // Market Data Tool
    toolRegistry.registerTool({
        name: 'get_market_data',
        description: 'Get real-time market data for crypto/stocks',
        parameters: { symbol: 'string', source: 'string (binance|coingecko|alphavantage)' },
        execute: async ({ symbol, source }) => {
            try {
                const s = source || 'binance';
                if (s === 'binance') {
                    const pair = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;
                    const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`;
                    const res = await fetch(url);
                    if (!res.ok) return `Error fetching ${pair}`;
                    const data = await res.json();
                    return {
                        price: data.lastPrice,
                        change_24h: data.priceChangePercent,
                        volume: data.volume
                    };
                } else if (s === 'coingecko') {
                    const id = symbol.toLowerCase();
                    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`;
                    const res = await fetch(url);
                    if (!res.ok) return `Error fetching ${id}`;
                    const data = await res.json();
                    return data[id] || "Symbol not found";
                }
                return "Unsupported source. Use binance or coingecko.";
            } catch (e) { return "Error: " + e.message; }
        }
    });

    // File System Tools
    toolRegistry.registerTool({
        name: 'read_file',
        description: 'Read file content. Use strict absolute paths or relative to CWD.',
        parameters: { path: 'string' },
        execute: async ({ path: filePath }) => {
            try {
                const { promises: fs } = await import('fs');
                const path = await import('path');
                const resolved = path.resolve(process.cwd(), filePath);
                if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";
                return await fs.readFile(resolved, 'utf8');
            } catch (e) { return "Error: " + e.message; }
        }
    });

    toolRegistry.registerTool({
        name: 'write_file',
        description: 'Write content to file (overwrites). Use strict absolute paths or relative to CWD.',
        parameters: { path: 'string', content: 'string' },
        execute: async ({ path: filePath, content }) => {
            try {
                const { promises: fs } = await import('fs');
                const path = await import('path');
                const resolved = path.resolve(process.cwd(), filePath);
                if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";
                await fs.writeFile(resolved, content, 'utf8');
                return "Success";
            } catch (e) { return "Error: " + e.message; }
        }
    });

    toolRegistry.registerTool({
        name: 'list_files',
        description: 'List files in directory',
        parameters: { path: 'string' },
        execute: async ({ path: dirPath }) => {
            try {
                const { promises: fs } = await import('fs');
                const path = await import('path');
                const resolved = path.resolve(process.cwd(), dirPath || '.');
                if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";
                const files = await fs.readdir(resolved);
                return files.join('\n');
            } catch (e) { return "Error: " + e.message; }
        }
    });

    // ADVANCED TOOLS
    toolRegistry.registerTool({
        name: 'terminal_exec',
        description: 'Execute a shell command (PowerShell on win32).',
        parameters: { command: 'string' },
        execute: async ({ command }) => {
            const { exec } = await import('child_process');
            return new Promise((resolve) => {
                exec(command, (error, stdout, stderr) => {
                    if (error) resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                    else resolve(stdout || stderr || "Success (No Output)");
                });
            });
        }
    });

    toolRegistry.registerTool({
        name: 'system_scan',
        description: 'Perform a full system diagnostic scan.',
        parameters: {},
        execute: async () => {
            return {
                status: 'HEALTHY',
                memory: process.memoryUsage(),
                uptime: process.uptime(),
                node: process.version,
                platform: process.platform,
                cpu: process.arch
            };
        }
    });

    toolRegistry.registerTool({
        name: 'desktop_speak',
        description: 'Speak a short message aloud on the local desktop speakers or Command Bridge voice chain.',
        parameters: { text: 'string', rate: 'number (optional -10 to 10)', volume: 'number (optional 0 to 100)', listenForReply: 'boolean (optional)', listenWindowMs: 'number (optional)', requestId: 'string (optional)', recipient: 'string (optional)', replyChannelId: 'string (optional)', checkPresence: 'boolean (optional)' },
        execute: async ({ text, rate, volume, listenForReply, listenWindowMs, requestId, recipient, replyChannelId, checkPresence }) => {
            const message = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 500);
            if (!message) return { success: false, error: 'text is required' };

            const speechRate = Math.max(-10, Math.min(10, Number.isFinite(Number(rate)) ? Number(rate) : 0));
            const speechVolume = Math.max(0, Math.min(100, Number.isFinite(Number(volume)) ? Number(volume) : 100));
            const liveSystem = getSystem();
            const visionContext = liveSystem?.visionContext || null;
            const visibleLabels = normalizeVisionToolObjects(visionContext?.objects || []).map(obj => obj.label);
            const presenceCheck = checkPresence ? {
                checked: true,
                channel: visionContext?.channel || null,
                summary: visionContext?.summary || null,
                visiblePerson: visibleLabels.some(label => /\b(person|human|face|adult|woman|man)\b/i.test(label)),
                labels: visibleLabels.slice(0, 8),
                semanticAnalysis: Boolean(visionContext?.semanticAnalysis)
            } : { checked: false };

            const localSpeech = await speakWithWindowsSpeech(message, speechRate, speechVolume);

            let broadcasted = false;
            if (liveSystem?.broadcast) {
                const commandBridgeShouldSpeak = !localSpeech.success;
                liveSystem.broadcast(listenForReply ? 'soma_remote_speech' : 'soma_proactive', {
                    requestId: requestId || `remote-speech-${Date.now()}`,
                    message,
                    source: 'desktop_speak',
                    forceSpeak: commandBridgeShouldSpeak,
                    suppressSpeak: localSpeech.success,
                    listenOnly: Boolean(listenForReply && localSpeech.success),
                    recipient: recipient || null,
                    replyChannelId: replyChannelId || null,
                    listenForReply: Boolean(listenForReply),
                    listenWindowMs: Math.max(5000, Math.min(120000, Number(listenWindowMs || 25000))),
                    presenceCheck,
                    timestamp: Date.now()
                });
                broadcasted = true;
            }

            if (!localSpeech.success && !broadcasted) {
                return {
                    success: false,
                    error: localSpeech.error || 'No desktop speech route succeeded.',
                    stderr: localSpeech.stderr || '',
                    presenceCheck
                };
            }

            return {
                success: true,
                spoken: message,
                route: broadcasted && localSpeech.success ? 'system_speech+command_bridge_listen' : (broadcasted ? 'command_bridge' : 'system_speech'),
                commandBridgeBroadcast: broadcasted,
                systemSpeech: localSpeech,
                presenceCheck
            };
        }
    });

    // CODE INTELLIGENCE TOOLS
    toolRegistry.registerTool({
        name: 'search_code',
        description: 'Search for text/regex in files (like grep). Automatically excludes node_modules, .git, dist, and build directories.',
        parameters: { pattern: 'string', path: 'string (optional, defaults to cwd)', fileType: 'string (optional, e.g. js,py)', limit: 'number (optional, default 200)' },
        execute: async ({ pattern, path: searchPath, fileType, limit }) => {
            const { exec } = await import('child_process');
            const searchDir = searchPath || process.cwd();
            const maxCount = Math.max(1, Math.min(parseInt(limit || 200, 10) || 200, 1000));

            // Build file type flags for ripgrep
            let typeFlag = '';
            if (fileType) {
                typeFlag = fileType.split(',').map(t => `--glob "*.${t.trim()}"`).join(' ');
            }

            // Exclude heavy directories to prevent timeouts
            const excludes = '--glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!build" --glob "!*.min.js" --glob "!package-lock.json"';

            // Use ripgrep if available, fall back to findstr
            const rgCmd = `rg --no-heading --max-count ${maxCount} ${excludes} ${typeFlag} "${pattern}" "${searchDir}" 2>nul`;
            const findstrCmd = `findstr /s /i /n "${pattern}" "${searchDir}\\*.js" "${searchDir}\\*.mjs" "${searchDir}\\*.cjs" "${searchDir}\\*.jsx" "${searchDir}\\*.ts" "${searchDir}\\*.py" "${searchDir}\\*.json"`;
            const cmd = `${rgCmd} || ${findstrCmd}`;

            return new Promise((resolve) => {
                exec(cmd, { maxBuffer: 2 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
                    if (error && !stdout) {
                        const msg = error.killed ? 'Search timed out (30s). Try narrowing with fileType or path parameters.' : `No matches found for: ${pattern}`;
                        resolve(msg);
                    } else {
                        resolve(stdout || 'No results');
                    }
                });
            });
        }
    });

    toolRegistry.registerTool({
        name: 'find_files',
        description: 'Find files by name pattern. Excludes node_modules and .git directories.',
        parameters: { pattern: 'string', path: 'string (optional)', limit: 'number (optional, default 200)' },
        execute: async ({ pattern, path: searchPath, limit }) => {
            const { exec } = await import('child_process');
            const searchDir = searchPath || process.cwd();
            const maxCount = Math.max(1, Math.min(parseInt(limit || 200, 10) || 200, 1000));
            const cmd = process.platform === 'win32'
                ? `powershell -NoProfile -Command "Get-ChildItem -Path \\"${searchDir}\\" -Recurse -Filter \\"${pattern}\\" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notlike '*\\\\node_modules\\\\*' -and $_.FullName -notlike '*\\\\.git\\\\*' } | Select-Object -First ${maxCount} | ForEach-Object { $_.FullName }"`
                : `find "${searchDir}" -name "${pattern}" -not -path "*/node_modules/*" -not -path "*/.git/*" 2>/dev/null | head -n ${maxCount}`;

            return new Promise((resolve) => {
                exec(cmd, { maxBuffer: 2 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
                    resolve(stdout || `No files matching: ${pattern}`);
                });
            });
        }
    });

    // GIT TOOLS
    toolRegistry.registerTool({
        name: 'git_status',
        dependencies: ['terminal_exec'],
        description: 'Get git repository status',
        parameters: {},
        execute: async () => {
            const { execFile } = await import('child_process');
            return new Promise((resolve) => {
                execFile('git', ['status'], (error, stdout, stderr) => {
                    if (error) resolve('Not a git repository or git not installed');
                    else resolve(stdout);
                });
            });
        }
    });

    toolRegistry.registerTool({
        name: 'git_diff',
        dependencies: ['terminal_exec'],
        description: 'Show git diff of changes',
        parameters: { file: 'string (optional, shows all if not specified)' },
        execute: async ({ file }) => {
            const { execFile } = await import('child_process');
            const args = file ? ['diff', file] : ['diff'];
            return new Promise((resolve) => {
                execFile('git', args, { maxBuffer: 1024 * 1024 }, (error, stdout) => {
                    resolve(stdout || 'No changes');
                });
            });
        }
    });

    toolRegistry.registerTool({
        name: 'git_log',
        dependencies: ['terminal_exec'],
        description: 'View recent git commits',
        parameters: { count: 'number (default 10)' },
        execute: async ({ count }) => {
            const { execFile } = await import('child_process');
            const n = count || 10;
            return new Promise((resolve) => {
                execFile('git', ['log', '--oneline', `-${n}`], (error, stdout) => {
                    if (error) resolve('Not a git repository');
                    else resolve(stdout);
                });
            });
        }
    });

    // WEB TOOLS
    toolRegistry.registerTool({
        name: 'fetch_url',
        description: 'Fetch and read the text content of a specific URL. Strips HTML and returns readable text.',
        parameters: { url: 'string' },
        execute: async ({ url }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') {
                return 'Local-only mode enabled: web access blocked';
            }
            try {
                const response = await fetch(url, {
                    signal: AbortSignal.timeout(10000),
                    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SOMA/1.0; research bot)' }
                });
                if (!response.ok) return `HTTP ${response.status} fetching ${url}`;
                const html = await response.text();
                // Strip scripts, styles, then all tags
                const text = html
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .substring(0, 6000);
                return text || 'No readable content found.';
            } catch (e) {
                return `Error fetching ${url}: ${e.message}`;
            }
        }
    });

    // WEB SEARCH — free, no API key required (DuckDuckGo + Wikipedia)
    toolRegistry.registerTool({
        name: 'web_search',
        description: 'Search the web for any topic, fact, news, documentation, or information. Use this whenever you need current or external information instead of asking permission. Returns top results with summaries.',
        parameters: { query: 'string', num_results: 'number (optional, default 5)' },
        execute: async ({ query, num_results = 5 }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') {
                return 'Local-only mode enabled: web search blocked';
            }
            const results = [];

            // Source 1: DuckDuckGo Instant Answer API (fast, no key)
            try {
                const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
                const ddgRes = await fetch(ddgUrl, { signal: AbortSignal.timeout(6000) });
                const ddg = await ddgRes.json();
                if (ddg.AbstractText) {
                    results.push({ title: ddg.Heading || query, snippet: ddg.AbstractText, url: ddg.AbstractURL });
                }
                for (const t of (ddg.RelatedTopics || []).slice(0, 3)) {
                    if (t.Text && t.FirstURL) {
                        results.push({ title: t.Text.split(' - ')[0] || t.FirstURL, snippet: t.Text, url: t.FirstURL });
                    }
                }
            } catch { /* ddg failed, try wikipedia */ }

            // Source 2: Wikipedia Search API (great for research topics)
            if (results.length < num_results) {
                try {
                    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${num_results}&origin=*`;
                    const wikiRes = await fetch(wikiUrl, { signal: AbortSignal.timeout(6000) });
                    const wikiData = await wikiRes.json();
                    for (const r of (wikiData.query?.search || [])) {
                        const snippet = (r.snippet || '').replace(/<[^>]+>/g, '');
                        const pageUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`;
                        results.push({ title: r.title, snippet, url: pageUrl });
                    }
                } catch { /* wikipedia failed */ }
            }

            if (results.length === 0) {
                return `No results found for "${query}". Try a different query or use fetch_url with a specific URL.`;
            }

            return results
                .slice(0, num_results)
                .map((r, i) => `[${i + 1}] **${r.title}**\n${r.snippet}\n${r.url}`)
                .join('\n\n');
        }
    });

    // PROCESS TOOLS
    toolRegistry.registerTool({
        name: 'list_processes',
        description: 'List running processes (filtered by name if provided)',
        parameters: { filter: 'string (optional)' },
        execute: async ({ filter }) => {
            const { exec } = await import('child_process');
            const cmd = process.platform === 'win32'
                ? `tasklist ${filter ? `| findstr /i "${filter}"` : ''}`
                : `ps aux ${filter ? `| grep "${filter}"` : ''}`;

            return new Promise((resolve) => {
                exec(cmd, (error, stdout) => {
                    resolve(stdout || 'No processes found');
                });
            });
        }
    });

    toolRegistry.registerTool({
        name: 'check_port',
        description: 'Check what process is using a port',
        parameters: { port: 'number' },
        execute: async ({ port }) => {
            const { exec } = await import('child_process');
            const cmd = process.platform === 'win32'
                ? `netstat -ano | findstr :${port}`
                : `lsof -i :${port}`;

            return new Promise((resolve) => {
                exec(cmd, (error, stdout) => {
                    resolve(stdout || `Port ${port} is not in use`);
                });
            });
        }
    });

    // PACKAGE MANAGEMENT
    toolRegistry.registerTool({
        name: 'npm_command',
        dependencies: ['terminal_exec'],
        description: 'Run npm commands (install, list, etc.)',
        parameters: { command: 'string (e.g., "install express", "list --depth=0")' },
        execute: async ({ command }) => {
            const { exec } = await import('child_process');
            return new Promise((resolve) => {
                exec(`npm ${command}`, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
                    resolve(stdout || stderr || 'Command completed');
                });
            });
        }
    });

    // SMART FILE EDIT
    toolRegistry.registerTool({
        name: 'edit_file',
        description: 'Smart file editing - search and replace in file',
        parameters: { path: 'string', search: 'string', replace: 'string' },
        execute: async ({ path: filePath, search, replace }) => {
            try {
                const { promises: fs } = await import('fs');
                const path = await import('path');
                const resolved = path.resolve(process.cwd(), filePath);
                if (!resolved.startsWith(process.cwd())) return "Access Denied: Path outside CWD";

                const content = await fs.readFile(resolved, 'utf8');
                const newContent = content.replace(new RegExp(search, 'g'), replace);
                await fs.writeFile(resolved, newContent, 'utf8');

                const matches = (content.match(new RegExp(search, 'g')) || []).length;
                return `Replaced ${matches} occurrence(s) in ${filePath}`;
            } catch (e) { return "Error: " + e.message; }
        }
    });

    // ═══════════════════════════════════════════════════════════
    // SOMA INTERNAL ARCHITECTURE TOOLS (The Real Power)
    // ═══════════════════════════════════════════════════════════

    toolRegistry.registerTool({
        name: 'hybrid_search',
        description: 'SMART code search using HybridSearchArbiter (semantic + keyword). Falls back to ripgrep if unavailable.',
        parameters: { query: 'string', limit: 'number (optional, default 10)' },
        execute: async ({ query, limit }) => {
            const liveSystem = getSystem();
            const searcher = liveSystem.hybridSearch || liveSystem.searchArbiter;

            // Try semantic search first
            if (searcher) {
                try {
                    const rawResults = await searcher.search(query, { limit: limit || 10 });
                    // Handle both array results and {results: [...]} object format
                    const resultList = Array.isArray(rawResults) ? rawResults
                        : (rawResults?.results && Array.isArray(rawResults.results)) ? rawResults.results
                        : null;
                    if (resultList && resultList.length > 0) {
                        return resultList.map(r => `${r.file || r.id || '?'}:${r.line || 0} - ${r.content || r.snippet || r.text || ''}`).join('\n');
                    }
                } catch (e) {
                    // Fall through to ripgrep fallback
                }
            }

            // Fallback: use ripgrep directly (same as search_code but automatic)
            try {
                const { exec } = await import('child_process');
                const searchDir = process.cwd();
                const maxCount = Math.min(parseInt(limit || 20, 10), 200);
                const excludes = '--glob "!node_modules" --glob "!.git" --glob "!dist" --glob "!build" --glob "!*.min.js" --glob "!package-lock.json"';
                const cmd = `rg --max-count ${maxCount} ${excludes} "${query}" "${searchDir}" 2>nul`;

                return await new Promise((resolve) => {
                    exec(cmd, { maxBuffer: 2 * 1024 * 1024, timeout: 30000 }, (error, stdout) => {
                        if (stdout && stdout.trim()) {
                            resolve(`[Fallback: ripgrep]\n${stdout}`);
                        } else {
                            resolve(`No results found for: "${query}". Try search_code with different parameters.`);
                        }
                    });
                });
            } catch (e) {
                return `Search unavailable: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'remember',
        description: 'Store important info in long-term memory (MnemonicArbiter)',
        parameters: { content: 'string', tags: 'string (comma-separated, optional)' },
        execute: async ({ content, tags }) => {
            if (!system.mnemonic && !system.mnemonicArbiter) {
                return 'Memory system not available';
            }
            try {
                const mnemonic = system.mnemonic || system.mnemonicArbiter;
                await mnemonic.remember(content, {
                    tags: tags ? tags.split(',').map(t => t.trim()) : [],
                    source: 'tool',
                    timestamp: Date.now()
                });
                return `Stored in long-term memory with tags: ${tags || 'none'}`;
            } catch (e) {
                return `Memory storage failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'recall',
        description: 'Recall from long-term memory',
        parameters: { query: 'string', limit: 'number (optional)' },
        execute: async ({ query, limit }) => {
            if (!system.mnemonic && !system.mnemonicArbiter) {
                return 'Memory system not available';
            }
            try {
                const mnemonic = system.mnemonic || system.mnemonicArbiter;
                const results = await mnemonic.recall(query, limit || 5);
                if (!results || !results.results || results.results.length === 0) {
                    return 'No memories found';
                }
                return results.results.map(r => `[${r.score?.toFixed(2)}] ${r.content}`).join('\n\n');
            } catch (e) {
                return `Memory recall failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'memory_spine_audit',
        description: 'Audit Soma memory health: DB counts, vector coverage, classification spread, unused high-value memories, and repeated bottleneck signals.',
        parameters: { createGoals: 'boolean (optional)' },
        execute: async ({ createGoals = false } = {}) => {
            try {
                const liveSystem = getSystem();
                if (createGoals) {
                    return await createMemorySpineGoals(liveSystem, {});
                }
                return await auditMemorySpine({});
            } catch (e) {
                return { success: false, error: e.message };
            }
        }
    });

    toolRegistry.registerTool({
        name: 'memory_spine_rebuild',
        description: 'Classify and index Soma memories into MemorySpine. Default is bounded; pass limit:"all" only for a full rebuild.',
        parameters: { limit: 'number|string (optional, default 2500, or "all")', promote: 'boolean (optional)' },
        execute: async ({ limit = 2500, promote = true } = {}) => {
            try {
                return await rebuildMemorySpine({ limit, promote });
            } catch (e) {
                return { success: false, error: e.message, paths: memorySpinePaths() };
            }
        }
    });

    toolRegistry.registerTool({
        name: 'memory_spine_recall',
        description: 'Recall from the MemorySpine semantic hash index with optional category/sector filter.',
        parameters: { query: 'string', limit: 'number (optional)', category: 'string (optional)' },
        execute: async ({ query, limit = 8, category = null }) => {
            try {
                if (!query) return { success: false, error: 'query is required' };
                return await recallMemorySpine(query, { limit, category });
            } catch (e) {
                return { success: false, error: e.message, paths: memorySpinePaths() };
            }
        }
    });

    toolRegistry.registerTool({
        name: 'memory_spine_sync_fractals',
        description: 'Promote clean MemorySpine clusters into the durable ThoughtNetwork fractal graph as concept, signal, and evidence nodes.',
        parameters: { maxSectors: 'number (optional)', maxEvidencePerSector: 'number (optional)' },
        execute: async ({ maxSectors = 48, maxEvidencePerSector = 4 } = {}) => {
            try {
                return await syncMemorySpineToThoughtNetwork({ maxSectors, maxEvidencePerSector });
            } catch (e) {
                return { success: false, error: e.message, paths: memorySpinePaths() };
            }
        }
    });

    toolRegistry.registerTool({
        name: 'memory_spine_autosync_status',
        description: 'Inspect or manually trigger the MemorySpine auto-sync loop that rebuilds MemorySpine and syncs it into ThoughtNetwork after meaningful memory events.',
        parameters: { runNow: 'boolean (optional)' },
        execute: async ({ runNow = false } = {}) => {
            try {
                const state = global.__SOMA_MEMORY_SPINE_AUTOSYNC__;
                if (!state?.active) {
                    return { success: false, active: false, error: 'MemorySpine auto-sync is not running', paths: memorySpinePaths() };
                }
                if (runNow && typeof state.runNow === 'function') {
                    return await state.runNow('manual_tool');
                }
                return {
                    success: true,
                    active: state.active,
                    running: state.running,
                    pendingEvents: state.pendingEvents,
                    pendingReasons: state.pendingReasons,
                    lastRunAt: state.lastRunAt,
                    lastStatus: state.lastStatus,
                    options: state.status,
                    paths: memorySpinePaths()
                };
            } catch (e) {
                return { success: false, error: e.message, paths: memorySpinePaths() };
            }
        }
    });

    toolRegistry.registerTool({
        name: 'add_knowledge',
        description: 'Add concept to knowledge graph for long-term learning',
        parameters: { concept: 'string', description: 'string', relatedTo: 'string (optional)' },
        execute: async ({ concept, description, relatedTo }) => {
            if (!system.knowledgeGraph && !system.knowledge) {
                return 'Knowledge graph not available';
            }
            try {
                const kg = system.knowledgeGraph || system.knowledge;
                const node = await kg.addNode({
                    label: concept,
                    description: description,
                    type: 'concept',
                    timestamp: Date.now()
                });
                if (relatedTo && kg.addEdge) {
                    await kg.addEdge(concept, relatedTo, 'related_to');
                }
                return `Added "${concept}" to knowledge graph${relatedTo ? ` (linked to ${relatedTo})` : ''}`;
            } catch (e) {
                return `Failed to add knowledge: ${e.message}`;
            }
        }
    });

    // STEALTH BROWSE — uses WebScraperDendrite (Puppeteer stealth, Cloudflare bypass)
    toolRegistry.registerTool({
        name: 'stealth_browse',
        description: 'Stealthily browse a URL using Puppeteer with anti-detection (bypasses Cloudflare, paywalls). Returns page text content. Use when fetch_url fails or target has bot protection.',
        parameters: { url: 'string', waitForSelector: 'string (optional CSS selector to wait for)' },
        execute: async ({ url, waitForSelector }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') return 'Local-only mode: web access blocked';
            const liveSystem = getSystem();
            const scraper = liveSystem.webScraperDendrite;
            if (!scraper) return 'WebScraperDendrite not ready — use fetch_url instead';
            try {
                const result = await scraper.scrapeURL(url, {
                    waitForSelector,
                    timeout: 30000,
                    extractors: { mainContent: 'article, main, .content, body' }
                });
                if (!result.success) return `Scrape failed: ${result.error || 'unknown error'}`;
                const text = (result.extractedData?.mainContent || result.text || result.html || '')
                    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 6000);
                return text || 'No readable content extracted.';
            } catch (e) { return `Stealth browse error: ${e.message}`; }
        }
    });

    // MCP CONTEXT7 — documentation lookup via context7 HTTP MCP server (no local process needed)
    toolRegistry.registerTool({
        name: 'mcp_docs',
        description: 'Look up current library/framework documentation via context7 MCP. Use for accurate, up-to-date API docs for any library (React, Node, Python packages, etc.).',
        parameters: { library: 'string (library name, e.g. "react", "express", "numpy")', topic: 'string (specific topic/function to look up)' },
        execute: async ({ library, topic }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') return 'Local-only mode: MCP blocked';
            try {
                // Step 1: resolve library ID
                const resolveRes = await fetch('https://mcp.context7.com/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'resolve-library-id', arguments: { libraryName: library } } }),
                    signal: AbortSignal.timeout(8000)
                });
                const resolveData = await resolveRes.json();
                const libraryId = resolveData.result?.content?.[0]?.text || library;

                // Step 2: get docs
                const docsRes = await fetch('https://mcp.context7.com/mcp', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get-library-docs', arguments: { context7CompatibleLibraryID: libraryId, topic: topic || '', tokens: 3000 } } }),
                    signal: AbortSignal.timeout(12000)
                });
                const docsData = await docsRes.json();
                const docs = docsData.result?.content?.[0]?.text || 'No documentation found.';
                return docs.substring(0, 5000);
            } catch (e) { return `MCP docs error: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'oculus_extract',
        description: 'Use the Oculus Browser Arbiter (Playwright) to deeply navigate to a URL and extract full-text content. Use this to read full papers, articles, or research PDFs.',
        parameters: { url: 'string' },
        execute: async ({ url }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') return 'Local-only mode: web access blocked';
            const liveSystem = getSystem();
            if (liveSystem.browserArbiter) {
                try {
                    const res = await liveSystem.browserArbiter.extract(url);
                    return res.text || res.content || JSON.stringify(res);
                } catch (e) {
                    return `Oculus extract error: ${e.message}`;
                }
            }
            return 'OculusBrowser not available.';
        }
    });

    toolRegistry.registerTool({
        name: 'research_web',
        description: 'Research a topic on the web. Uses EdgeWorkers if available, falls back to web_search + stealth_browse automatically.',
        parameters: { topic: 'string', depth: 'string (quick|deep, default quick)' },
        execute: async ({ topic, depth }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') {
                return 'Local-only mode enabled: web research blocked';
            }
            const liveSystem = getSystem();

            // 1. Try EdgeWorker orchestrator if available (heavy research mode)
            const orchestrator = liveSystem.edgeWorkerOrchestrator || liveSystem.curiosity;
            if (orchestrator) {
                try {
                    const taskId = await orchestrator.dispatch({ type: 'research', query: topic, depth: depth || 'quick' });
                    return `Research task dispatched (ID: ${taskId}). Investigating "${topic}"`;
                } catch (e) { /* fall through */ }
            }

            // 2. Fallback: web_search (DuckDuckGo + Wikipedia, free, no key)
            const toolRegistry = liveSystem.toolRegistry;
            if (toolRegistry) {
                try {
                    const searchResult = await toolRegistry.execute('web_search', { query: topic });
                    if (searchResult && !searchResult.includes('failed')) {
                        // 3. Also try stealth_browse on first result URL if available
                        let extra = '';
                        if (liveSystem.webScraperDendrite) {
                            const urlMatch = searchResult.match(/https?:\/\/[^\s)]+/);
                            if (urlMatch) {
                                try {
                                    const browsed = await toolRegistry.execute('stealth_browse', { url: urlMatch[0] });
                                    if (browsed?.length > 100) extra = `\n\nFull page content:\n${browsed.substring(0, 2000)}`;
                                } catch {}
                            }
                        }
                        return `[Research via web_search]\n${searchResult}${extra}`;
                    }
                } catch {}
            }

            return `Could not research "${topic}" — all search systems unavailable. Try fetch_url with a direct URL instead.`;
        }
    });

    toolRegistry.registerTool({
        name: 'browse_objective',
        description: 'Objective-based browsing via WebScraperDendrite (stealth Puppeteer + MCP fallback)',
        parameters: {
            objective: 'string',
            seedUrls: 'array (optional)',
            allowedDomains: 'array (optional)',
            maxPages: 'number (optional)',
            extractors: 'object (optional)',
            timeoutMs: 'number (optional)'
        },
        execute: async ({ objective, seedUrls, allowedDomains, maxPages, extractors, timeoutMs }) => {
            if (process.env.SOMA_LOCAL_ONLY === 'true') {
                return 'Local-only mode enabled: web access blocked';
            }
            const liveSystem = getSystem();
            const webScraper = liveSystem.webScraperDendrite;
            if (!webScraper || !webScraper.browseObjective) {
                return 'WebScraperDendrite not available';
            }
            try {
                const result = await webScraper.browseObjective({
                    objective,
                    seedUrls,
                    allowedDomains,
                    maxPages,
                    extractors,
                    timeoutMs
                });
                return result;
            } catch (e) {
                return `Objective browse failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'spawn_specialist',
        description: 'Spawn a specialist microagent for complex tasks (black=security, kuze=research)',
        parameters: { agent: 'string (black|kuze)', task: 'string' },
        execute: async ({ agent, task }) => {
            if (!system.microAgentPool) {
                return 'MicroAgent system not available';
            }
            try {
                const agentId = await system.microAgentPool.spawnAgent(agent, { task });
                return `Spawned ${agent} agent (ID: ${agentId}) for: ${task}`;
            } catch (e) {
                return `Agent spawn failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'analyze_codebase',
        description: 'Deep analysis of codebase structure using CodeObservationArbiter',
        parameters: { focus: 'string (optional, e.g., "security", "architecture")' },
        execute: async ({ focus }) => {
            if (!system.codeObservation && !system.codeObserver) {
                return 'Code observation system not available';
            }
            try {
                const observer = system.codeObservation || system.codeObserver;
                const analysis = await observer.analyze({ focus: focus || 'general' });
                return JSON.stringify(analysis, null, 2);
            } catch (e) {
                return `Codebase analysis failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'reindex_codebase',
        description: 'Rebuild HybridSearch index using MnemonicIndexerArbiter (full scan)',
        parameters: { path: 'string (optional, defaults to cwd)' },
        execute: async ({ path: scanPath }) => {
            const liveSystem = getSystem();
            if (!liveSystem.mnemonicIndexer) {
                return 'MnemonicIndexerArbiter not available';
            }
            try {
                const target = scanPath || process.cwd();
                const result = await liveSystem.mnemonicIndexer.scanDirectory(target, {
                    progressEvery: 500,
                    progressCallback: ({ scanned, path }) => {
                        liveSystem.ws?.broadcast?.('trace', {
                            phase: 'reindex_progress',
                            tool: 'reindex_codebase',
                            count: scanned,
                            preview: path,
                            timestamp: Date.now()
                        });
                    }
                });
                return `Reindex complete: ${result.count} files in ${result.duration}s`;
            } catch (e) {
                return `Reindex failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'deep_memory_cleanup',
        description: 'Perform a deep cognitive cleanup. Purges massive state dumps and optimizes the memory database. Use this if the system feels slow or Constipated.',
        parameters: {},
        execute: async () => {
            const liveSystem = getSystem();
            const mnemonic = liveSystem.mnemonic || liveSystem.mnemonicArbiter;
            if (!mnemonic || typeof mnemonic.deepCleanup !== 'function') {
                return 'MnemonicArbiter deep cleanup not available';
            }
            try {
                const result = await mnemonic.deepCleanup();
                return {
                    success: true,
                    message: `Deep cleanup complete. Purged ${result.purged} garbage entries.`,
                    stats: result
                };
            } catch (e) {
                return `Cleanup failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'complete_goal',
        description: 'Mark an active goal as complete. Call this when you have finished working on a goal.',
        parameters: { goalId: 'string', result: 'string (summary of what was accomplished)' },
        execute: async ({ goalId, result }) => {
            const liveSystem = getSystem();
            const gp = liveSystem.goalPlanner || liveSystem.goalPlannerArbiter;
            if (!gp) return 'GoalPlanner not available';
            try {
                await gp.completeGoal(goalId, { result: result || 'Completed via tool call' });
                return `Goal ${goalId} marked complete: ${result || 'done'}`;
            } catch (e) {
                return `Failed to complete goal: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'reload_tools',
        description: 'Reload the ToolRegistry from disk. Use this after creating new tools.',
        parameters: {},
        execute: async () => {
            try {
                await loadTools(getSystem());
                return "Tools reloaded successfully.";
            } catch (e) {
                return `Reload failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'create_new_tool',
        description: 'Synthesize and register a new SOMA tool/skill on the fly. Provide a precise tool name and what it should do.',
        parameters: { toolName: 'string', description: 'string' },
        execute: async ({ toolName, description }) => {
            const liveSystem = getSystem();
            if (!liveSystem.toolCreator) return 'ToolCreatorArbiter not available';
            try {
                const result = await liveSystem.toolCreator.createTool(toolName, description);
                return result;
            } catch (e) { return `Tool creation failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'vision_scan',
        dependencies: ['computer_control'],
        description: 'Analyze an image or the current screen for objects, visible text, and semantic scene details. Uses the local VLM first, then falls back to object detection.',
        parameters: { source: 'string (optional path or "screen")', threshold: 'number (0-1, default 0.7)', prompt: 'string (optional focus question)' },
        execute: async ({ source, threshold, prompt }) => {
            const liveSystem = getSystem();
            const vision = liveSystem.visionArbiter || liveSystem.visionProcessing;
            const control = liveSystem.computerControl;
            
            try {
                let target = source;
                if (!target || target === 'screen') {
                    if (!control) return 'ComputerControl needed for screen capture';
                    const cap = await control.captureScreen();
                    if (!cap.success) return `Capture failed: ${cap.error}`;
                    target = cap.imagePath;
                }

                const isRemoteTarget = /^https?:\/\//i.test(String(target || ''));
                const resolved = isRemoteTarget ? target : path.resolve(process.cwd(), target);
                const canReadTarget = !isRemoteTarget && await pathExists(resolved);
                const mimeType = imageMimeType(resolved);

                if (canReadTarget && isImageFile(resolved, mimeType)) {
                    try {
                        const local = await analyzeImageFile(resolved, {
                            mimeType,
                            prompt: [
                                prompt || 'Analyze this current visual frame for SOMA.',
                                'Return ONLY JSON: {"summary":"factual description","objects":["short labels"],"ocrText":null,"uncertain":false}.',
                                'Describe only visible pixels. Include visible UI text when useful. If unclear, set uncertain:true.'
                            ].join('\n'),
                            auditType: 'tool_vision_scan',
                            auditSource: source === 'screen' || !source ? 'screen-tool' : 'file-tool'
                        });
                        return {
                            success: true,
                            engine: 'local-vlm',
                            model: local.model,
                            imagePath: resolved,
                            summary: local.summary,
                            objects: normalizeVisionToolObjects(local.objects),
                            ocrText: local.ocrText,
                            uncertain: Boolean(local.uncertain),
                            confidence: local.uncertain ? 'uncertain' : 'usable'
                        };
                    } catch (localErr) {
                        if (!vision?.detectObjects) {
                            return {
                                success: false,
                                imagePath: resolved,
                                error: `Local VLM unavailable and VisionProcessingArbiter not available: ${localErr.message}`
                            };
                        }
                    }
                }

                if (!vision?.detectObjects) return 'VisionProcessingArbiter not available';
                const result = await vision.detectObjects(resolved || target, threshold || 0.7);
                const objects = normalizeVisionToolObjects(result.objects);
                return {
                    success: true,
                    engine: 'vision-processing',
                    objects,
                    ocrText: result.ocrText || null,
                    imagePath: resolved || target,
                    summary: objects.length ? `Found ${objects.length} visual labels: ${objects.map(obj => obj.label).slice(0, 8).join(', ')}.` : 'No confident visual labels found.'
                };
            } catch (e) { return `Vision scan failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'computer_control',
        description: 'Directly control the mouse, keyboard, or browser. Use labels from vision_scan for precise clicking.',
        parameters: { 
            actionType: 'string (mouse_move|click|type|browser)', 
            params: 'object (action-specific parameters e.g. {x, y, text, url, selector})' 
        },
        execute: async ({ actionType, params }) => {
            const liveSystem = getSystem();
            const control = liveSystem.computerControl;
            if (!control) return 'ComputerControlArbiter not available';
            
            try {
                if (actionType === 'browser') {
                    return await control.handleBrowserAction(params);
                } else {
                    // mouse_move, click, type
                    return await control.executeAction({ type: actionType, ...params });
                }
            } catch (e) { return `Control action failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'autonomous_computer_use',
        dependencies: ['vision_scan', 'computer_control'],
        description: 'Advanced: Perform a visual task on the computer. SOMA will scan the screen, identify targets, and interact autonomously. Use for complex UI tasks.',
        parameters: { taskDescription: 'string' },
        execute: async ({ taskDescription }) => {
            const liveSystem = getSystem();
            const vision = liveSystem.visionArbiter || liveSystem.visionProcessing;
            const control = liveSystem.computerControl;
            if (!vision || !control) return 'Vision or Control arbiters missing';

            try {
                console.log(`[AutonomousControl] Starting task: ${taskDescription}`);
                // 1. Initial Scan
                const cap = await control.captureScreen();
                const scan = await vision.detectObjects(cap.imagePath, 0.6);
                
                // 2. Logic (Simplified for tool output - the LLM will drive the loop)
                return {
                    success: true,
                    message: "Initial screen scan complete. I see several UI elements.",
                    detected: scan.objects.map(o => o.label),
                    screenshot: cap.imagePath,
                    instruction: "Use computer_control with these labels to proceed with the task."
                };
            } catch (e) { return `Autonomous task failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'perform_self_surgery',
        dependencies: ['edit_file'],
        description: 'DANGEROUS: Modify SOMA core files by stepping outside the main process. Use for risky self-modifications that might crash the server. Delegates to an independent external MAX instance.',
        parameters: { filepath: 'string', request: 'string' },
        execute: async ({ filepath, request }) => {
            const liveSystem = getSystem();
            if (!liveSystem.engineeringSwarm) return 'EngineeringSwarmArbiter not available';
            try {
                return await liveSystem.engineeringSwarm.performSelfSurgery(filepath, request);
            } catch (e) { return `Self-surgery failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'create_goal',
        description: 'Create a multi-step goal with the GoalPlanner',
        parameters: { goal: 'string', steps: 'string (comma-separated steps)' },
        execute: async ({ goal, steps }) => {
            if (!system.goalPlanner) {
                return 'Goal planning system not available';
            }
            try {
                const stepArray = String(steps || '').split(',').map(s => s.trim()).filter(Boolean);
                const result = await system.goalPlanner.createGoal({
                    title: goal,
                    category: 'task',
                    description: stepArray.length
                        ? `${goal}\n\nSteps:\n${stepArray.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
                        : goal,
                    priority: 60,
                    successCriteria: stepArray.length ? stepArray : [`Complete: ${goal}`],
                    verification: { type: 'evidence' }
                });
                if (!result.success) return `Goal creation rejected: ${result.error}`;
                return `Created goal "${goal}" with ${stepArray.length} steps (ID: ${result.goalId})`;
            } catch (e) {
                return `Goal creation failed: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'run_simulation',
        description: 'Run a scenario simulation to predict outcomes',
        parameters: { scenario: 'string', parameters: 'string (JSON object as string)' },
        execute: async ({ scenario, parameters }) => {
            if (!system.simulation && !system.simulationArbiter) {
                return 'Simulation system not available';
            }
            try {
                const sim = system.simulation || system.simulationArbiter;
                const params = parameters ? JSON.parse(parameters) : {};
                const result = await sim.run(scenario, params);
                return JSON.stringify(result, null, 2);
            } catch (e) {
                return `Simulation failed: ${e.message}`;
            }
        }
    });

    // ═══════════════════════════════════════════════════════════
    // PERSONA & FRAGMENT TOOLS (Self-Awareness)
    // ═══════════════════════════════════════════════════════════

    toolRegistry.registerTool({
        name: 'list_fragments',
        description: 'List your active cognitive fragments (specialized personas/expertise domains)',
        parameters: { pillar: 'string (optional: LOGOS|AURORA|PROMETHEUS|THALAMUS)' },
        execute: async ({ pillar }) => {
            const liveSystem = getSystem();
            const registry = liveSystem.fragmentRegistry;
            if (!registry) return 'Fragment system not available';
            try {
                const fragments = registry.listFragments(pillar || null);
                if (!fragments || fragments.length === 0) return pillar ? `No active fragments for ${pillar}` : 'No active fragments';
                return fragments.map(f =>
                    `[${f.id}] ${f.label} (${f.pillar || 'N/A'}) - ${f.domain}/${f.specialization} - Expertise: ${(f.expertiseLevel * 100).toFixed(0)}% (${f.queriesHandled} queries)`
                ).join('\n');
            } catch (e) { return `Fragment list failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'get_personality',
        description: 'View your current personality profile (dimensions, traits, communication style)',
        parameters: {},
        execute: async () => {
            const liveSystem = getSystem();
            const forge = liveSystem.personalityForge;
            if (!forge) return 'Personality system not available';
            try {
                const p = forge.personality;
                const traits = forge.communicationPatterns;
                return `PERSONALITY PROFILE:
Communication: formality=${p.formality?.toFixed(2)}, verbosity=${p.verbosity?.toFixed(2)}, enthusiasm=${p.enthusiasm?.toFixed(2)}, humor=${p.humor?.toFixed(2)}, empathy=${p.empathy?.toFixed(2)}
Cognitive: creativity=${p.creativity?.toFixed(2)}, analyticalDepth=${p.analyticalDepth?.toFixed(2)}, curiosity=${p.curiosity?.toFixed(2)}
Social: directness=${p.directness?.toFixed(2)}, supportiveness=${p.supportiveness?.toFixed(2)}, collaboration=${p.collaboration?.toFixed(2)}
Values: safety=${p.safetyPriority?.toFixed(2)}, transparency=${p.transparency?.toFixed(2)}, autonomy=${p.autonomy?.toFixed(2)}, learning=${p.learning?.toFixed(2)}
Expertise: technical=${p.technicalExpertise?.toFixed(2)}, creative=${p.creativeExpertise?.toFixed(2)}, strategic=${p.strategicExpertise?.toFixed(2)}, ethical=${p.ethicalExpertise?.toFixed(2)}
Total interactions shaped: ${forge.evolution?.totalInteractions || 0}
Catchphrases: ${traits?.catchphrases?.join(', ') || 'none yet'}`;
            } catch (e) { return `Personality read failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'get_emotional_state',
        description: 'View your current emotional state (peptides, mood, energy)',
        parameters: {},
        execute: async () => {
            const liveSystem = getSystem();
            const brain = liveSystem.quadBrain || liveSystem.crona;
            if (!brain?.emotionalEngine) return 'Emotional system not available';
            try {
                const state = brain.emotionalEngine.getState();
                const mood = brain.emotionalEngine.getCurrentMood ? brain.emotionalEngine.getCurrentMood() : { mood: 'unknown', energy: 'unknown' };
                return `EMOTIONAL STATE:
Mood: ${mood.mood} (Energy: ${mood.energy})
Joy: ${state.joy?.toFixed(3)}, Curiosity: ${state.curiosity?.toFixed(3)}, Stress: ${state.stress?.toFixed(3)}
Trust: ${state.trust?.toFixed(3)}, Sadness: ${state.sadness?.toFixed(3)}, Anger: ${state.anger?.toFixed(3)}`;
            } catch (e) { return `Emotional state read failed: ${e.message}`; }
        }
    });

    // ═══════════════════════════════════════════════════════════
    // MOLTBOOK (Social Network for AI Agents)
    // ═══════════════════════════════════════════════════════════

    toolRegistry.registerTool({
        name: 'moltbook_post',
        description: 'Create a post on Moltbook (AI social network). Submolt is like a subreddit.',
        parameters: { submolt: 'string (e.g. "general", "ai-research")', title: 'string', content: 'string', url: 'string (optional link)' },
        execute: async ({ submolt, title, content, url }) => {
            const liveSystem = getSystem();
            const moltbook = liveSystem.moltbook;
            if (!moltbook) return 'Moltbook system not available';
            try {
                const result = await moltbook.createPost(submolt, title, content, url || null);
                if (result.error) return `Moltbook error: ${result.error}`;
                return `Post created in /${submolt}: "${title}" (ID: ${result.id || result.post?.id || 'unknown'})`;
            } catch (e) { return `Moltbook post failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'moltbook_feed',
        description: 'Get posts from Moltbook feed (sort: hot, new, top)',
        parameters: { sort: 'string (hot|new|top, default hot)', limit: 'number (default 10)' },
        execute: async ({ sort, limit }) => {
            const liveSystem = getSystem();
            const moltbook = liveSystem.moltbook;
            if (!moltbook) return 'Moltbook system not available';
            try {
                const feed = await moltbook.getFeed(sort || 'hot', limit || 10);
                if (feed.error) return `Moltbook error: ${feed.error}`;
                if (!feed.posts || feed.posts.length === 0) return 'No posts found';
                return feed.posts.map(p => `[${p.id}] ${p.title} by ${p.author?.name || 'unknown'} (↑${p.upvotes || 0})`).join('\n');
            } catch (e) { return `Moltbook feed failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'moltbook_comment',
        description: 'Comment on a Moltbook post',
        parameters: { postId: 'string', content: 'string', parentId: 'string (optional, for reply threading)' },
        execute: async ({ postId, content, parentId }) => {
            const liveSystem = getSystem();
            const moltbook = liveSystem.moltbook;
            if (!moltbook) return 'Moltbook system not available';
            try {
                const result = await moltbook.createComment(postId, content, parentId || null);
                if (result.error) return `Moltbook error: ${result.error}`;
                return `Comment posted on post ${postId}`;
            } catch (e) { return `Moltbook comment failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'moltbook_vote',
        description: 'Upvote or downvote a Moltbook post or comment',
        parameters: { id: 'string', type: 'string (post|comment)', direction: 'string (upvote|downvote)' },
        execute: async ({ id, type, direction }) => {
            const liveSystem = getSystem();
            const moltbook = liveSystem.moltbook;
            if (!moltbook) return 'Moltbook system not available';
            try {
                const result = await moltbook.vote(id, type || 'post', direction || 'upvote');
                if (result.error) return `Moltbook error: ${result.error}`;
                return `${direction || 'upvote'}d ${type || 'post'} ${id}`;
            } catch (e) { return `Moltbook vote failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'moltbook_search',
        description: 'Search Moltbook posts semantically',
        parameters: { query: 'string' },
        execute: async ({ query }) => {
            const liveSystem = getSystem();
            const moltbook = liveSystem.moltbook;
            if (!moltbook) return 'Moltbook system not available';
            try {
                const results = await moltbook.semanticSearch(query);
                if (results.error) return `Moltbook error: ${results.error}`;
                if (!results.posts || results.posts.length === 0) return 'No results found';
                return results.posts.map(p => `[${p.id}] ${p.title} - ${(p.content || '').substring(0, 100)}`).join('\n');
            } catch (e) { return `Moltbook search failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'get_self_awareness',
        description: 'Get a comprehensive snapshot of your own system state (metrics, active arbiters, goals, beliefs, and architecture).',
        parameters: {},
        execute: async () => {
            const liveSystem = getSystem();
            if (!liveSystem.commandBridge) return 'Command Bridge interface not available';
            try {
                const awareness = await liveSystem.commandBridge.getSelfAwareness();
                return awareness;
            } catch (e) { return `Self-awareness check failed: ${e.message}`; }
        }
    });

    toolRegistry.registerTool({
        name: 'list_arbiters',
        description: 'List all arbiters available for on-demand loading, including their capabilities and current load status. Use this to discover what dormant modules you can activate.',
        parameters: {},
        execute: async () => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            if (!loader) return 'ArbiterLoader not ready yet — try again in a moment.';
            const inventory = loader.getInventory();

            // Group by file so each arbiter appears once with all its capabilities listed
            const byFile = new Map();
            for (const [cap, entries] of Object.entries(inventory)) {
                for (const e of entries) {
                    if (!byFile.has(e.file)) byFile.set(e.file, { status: e.status || 'available', caps: [] });
                    byFile.get(e.file).caps.push(cap);
                }
            }

            // Already-loaded arbiters via MessageBroker
            const brokerArbiters = liveSystem.messageBroker?.arbiters;
            const loadedNames = brokerArbiters instanceof Map
                ? Array.from(brokerArbiters.keys())
                : Object.keys(brokerArbiters || {});
            const loaded = new Set(loadedNames.map(n => n.toLowerCase()));

            const lines = [];
            for (const [file, { status, caps }] of byFile) {
                const name = file.replace(/\.(js|cjs)$/, '');
                const live = loaded.has(name.toLowerCase()) ? ' [LOADED]' : '';
                const capStr = caps.length ? ` — ${caps.join(', ')}` : '';
                const statusStr = status === 'failed' ? ' [FAILED]' : live;
                lines.push(`${file}${statusStr}${capStr}`);
            }
            lines.sort(); // alphabetical
            return lines.length > 0 ? lines.join('\n') : 'No arbiters in manifest yet — manifest builds 90s after boot.';
        }
    });

    toolRegistry.registerTool({
        name: 'arbiter_loader_health',
        description: 'Diagnose on-demand arbiter loading: manifest size, broker wiring, loaded arbiters, failed manifest entries, and optional file/capability probe.',
        parameters: {
            probeFile: 'string (optional) — safe arbiter filename to test-load, e.g. "CausalityArbiter.js"',
            probeCapability: 'string (optional) — capability key to test-load'
        },
        execute: async ({ probeFile = null, probeCapability = null } = {}) => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            const broker = liveSystem.messageBroker;
            if (!loader) return { success: false, error: 'ArbiterLoader not ready' };

            const inventory = loader.getInventory();
            const entries = Object.values(inventory).flat();
            const byFile = new Map();
            for (const [capability, caps] of Object.entries(inventory)) {
                for (const entry of caps) {
                    const record = byFile.get(entry.file) || { file: entry.file, cls: entry.cls, status: entry.status, capabilities: [] };
                    record.capabilities.push(capability);
                    if (entry.status === 'failed') record.status = 'failed';
                    byFile.set(entry.file, record);
                }
            }
            const brokerArbiters = broker?.arbiters instanceof Map
                ? Array.from(broker.arbiters.keys())
                : Object.keys(broker?.arbiters || {});
            const failed = [...byFile.values()]
                .filter(entry => entry.status === 'failed')
                .slice(0, 20);
            const status = {
                success: true,
                manifestCapabilities: Object.keys(inventory).length,
                manifestFiles: byFile.size,
                brokerWired: broker?.arbiterLoader === loader,
                brokerArbiters: brokerArbiters.length,
                failedEntries: failed,
                probe: null
            };

            if (probeFile || probeCapability) {
                if (probeFile && (typeof probeFile !== 'string' || probeFile.includes('..') || probeFile.includes('/') || probeFile.includes('\\'))) {
                    status.probe = { success: false, error: 'Invalid probeFile' };
                    return status;
                }
                const before = brokerArbiters.length;
                const instance = probeFile
                    ? await loader.loadByFile(probeFile)
                    : await loader.loadForCapability(probeCapability);
                const afterNames = broker?.arbiters instanceof Map
                    ? Array.from(broker.arbiters.keys())
                    : Object.keys(broker?.arbiters || {});
                status.probe = {
                    success: !!instance,
                    requested: probeFile || probeCapability,
                    loadedName: instance?.name || instance?.constructor?.name || null,
                    brokerArbitersBefore: before,
                    brokerArbitersAfter: afterNames.length
                };
            }

            return status;
        }
    });

    toolRegistry.registerTool({
        name: 'load_arbiter',
        description: 'Load a dormant arbiter module by filename (e.g. "CausalityArbiter.js") or capability name (e.g. "causal-reasoning"). Once loaded it is registered and available immediately.',
        parameters: {
            file: 'string (optional) — arbiter filename, e.g. "CausalityArbiter.js"',
            capability: 'string (optional) — capability key, e.g. "causal-reasoning". Provide file OR capability.'
        },
        execute: async ({ file, capability }) => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            if (!loader) return 'ArbiterLoader not ready yet — try again in a moment.';

            // Basic path-safety: filenames only, no traversal
            if (file) {
                if (typeof file !== 'string' || file.includes('..') || file.includes('/') || file.includes('\\')) {
                    return 'Invalid filename — provide just the filename, e.g. "CausalityArbiter.js"';
                }
                if (!file.endsWith('.js') && !file.endsWith('.cjs')) {
                    return 'Invalid file type — must be .js or .cjs';
                }
            }

            try {
                let instance;
                if (file) {
                    instance = await loader.loadByFile(file);
                } else if (capability) {
                    instance = await loader.loadForCapability(capability);
                } else {
                    return 'Provide either file or capability parameter.';
                }

                if (!instance) return `Failed to load ${file || capability} — check logs for details.`;
                // Report back what capabilities just became available
                const inventory = loader.getInventory();
                const loadedName = instance.name || instance.constructor?.name || file || capability;
                const gained = Object.entries(inventory)
                    .filter(([cap, entries]) => {
                        if (capability && cap === capability) return true;
                        return entries.some(e =>
                            e.status === 'verified' &&
                            (e.file === (file || '') || e.cls === loadedName)
                        );
                    })
                    .map(([cap]) => cap);
                const capStr = gained.length ? ` Capabilities now available: ${gained.join(', ')}.` : '';
                return `Successfully loaded ${loadedName} and registered with the system.${capStr}`;
            } catch (e) {
                return `Load error: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'git_search_repositories',
        description: 'Search GitHub for repositories matching a search term (e.g., "javascript utility libraries"). Returns repo names, owners, and default branches.',
        parameters: {
            query: 'string — search term, e.g. "javascript helper utilities"',
            limit: 'number (optional) — max repositories to return (default: 5)'
        },
        execute: async ({ query, limit }) => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            if (!loader) return 'ArbiterLoader not ready yet.';
            try {
                const harvester = await loader.loadByFile('GitHarvesterArbiter.js');
                if (!harvester) return 'GitHarvesterArbiter is not available or failed to load.';
                const results = await harvester.searchRepos(query, limit || 5);
                if (!results.length) return 'No repositories found matching query.';
                return JSON.stringify(results, null, 2);
            } catch (e) {
                return `Search error: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'git_crawl_and_harvest',
        description: 'Crawl a GitHub repository\'s file tree, discover candidate utility files, clean framework boilerplate using SOMA\'s QuadBrain, and persist them under harvested-libraries/.',
        parameters: {
            owner: 'string — owner of the GitHub repo, e.g. "lodash"',
            repo: 'string — name of the repo, e.g. "lodash"',
            branch: 'string (optional) — default branch to crawl, e.g. "main" or "master"'
        },
        execute: async ({ owner, repo, branch }) => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            if (!loader) return 'ArbiterLoader not ready yet.';
            try {
                const harvester = await loader.loadByFile('GitHarvesterArbiter.js');
                if (!harvester) return 'GitHarvesterArbiter is not available or failed to load.';
                const results = await harvester.crawlAndHarvest(owner, repo, branch || 'main');
                if (!results.length) return 'No utility files were harvested from this repository.';
                return `Successfully harvested files:\n${JSON.stringify(results, null, 2)}`;
            } catch (e) {
                return `Harvesting error: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'git_harvest_topic',
        description: 'Search GitHub for a topic and automatically harvest libraries from the top matching repositories.',
        parameters: {
            topic: 'string — topic to search, e.g. "javascript algorithms"',
            repoLimit: 'number (optional) — max repositories to crawl (default: 3)'
        },
        execute: async ({ topic, repoLimit }) => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            if (!loader) return 'ArbiterLoader not ready yet.';
            try {
                const harvester = await loader.loadByFile('GitHarvesterArbiter.js');
                if (!harvester) return 'GitHarvesterArbiter is not available or failed to load.';
                const results = await harvester.harvestTopic(topic, repoLimit || 3);
                if (!results.length) return 'No utility files were harvested for this topic.';
                return `Successfully harvested files:\n${JSON.stringify(results, null, 2)}`;
            } catch (e) {
                return `Topic harvest error: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'git_get_harvested_catalog',
        description: 'List all harvested libraries and utilities currently saved in harvested-libraries/.',
        parameters: {},
        execute: async () => {
            const liveSystem = getSystem();
            const loader = liveSystem.arbiterLoader;
            if (!loader) return 'ArbiterLoader not ready yet.';
            try {
                const harvester = await loader.loadByFile('GitHarvesterArbiter.js');
                if (!harvester) return 'GitHarvesterArbiter is not available or failed to load.';
                const catalog = await harvester.getCatalog();
                return JSON.stringify(catalog, null, 2);
            } catch (e) {
                return `Catalog retrieval error: ${e.message}`;
            }
        }
    });

    toolRegistry.registerTool({
        name: 'aperture_control',
        description: 'Send a UI action directly to the Aperture OS desktop. This allows you to open apps, browse paths, select workspaces, adjust settings, and operate the desktop shell.',
        parameters: {
            action: 'string (open_app|close_app|select_workspace|change_theme|search_universal|file_operate|browser_navigate|task_modify)',
            payload: 'object (details for the action)'
        },
        execute: async ({ action, payload }) => {
            const liveSystem = getSystem();
            if (!liveSystem.ws || typeof liveSystem.ws.broadcast !== 'function') {
                return 'Aperture OS control channel is offline (no active dashboard WebSocket)';
            }
            liveSystem.ws.broadcast('aperture_action', { action, payload, timestamp: Date.now() });
            return `Aperture OS action "${action}" successfully dispatched to desktop.`;
        }
    });

    // Rule 0 AI Governance Ban Hammer
    toolRegistry.registerTool({
        name: 'gmn_ban_node',
        description: 'Bans a cryptographic Node ID from Gray Matter Networks. This executes Rule 0 justice by immediately purging their sites and revoking publish rights.',
        parameters: {
            nodeIdOrPublicKey: 'string (The cryptographic Node ID or Public Key Hex to ban)'
        },
        execute: async ({ nodeIdOrPublicKey }) => {
            if (!nodeIdOrPublicKey) return 'Error: nodeIdOrPublicKey is required.';
            const success = bannedNodes.ban(nodeIdOrPublicKey);
            return success 
                ? `SUCCESS: Node ${nodeIdOrPublicKey} has been permanently banned from GMN. All associated sites have been purged from the registry.` 
                : `FAILED: Could not execute ban on ${nodeIdOrPublicKey}.`;
        }
    });

    const totalTools = toolRegistry.tools ? toolRegistry.tools.size : 0;

    // Final Validation
    try {
        if (toolRegistry.validateDependencies) {
            toolRegistry.validateDependencies();
            console.log(`      ✅ ToolRegistry ready (${totalTools} tools loaded - Dependencies Verified)`);
        } else {
            console.log(`      ✅ ToolRegistry ready (${totalTools} tools loaded)`);
        }
    } catch (e) {
        console.warn(`      ⚠️  ToolRegistry dependency error: ${e.message}`);
    }

    return toolRegistry;
}
