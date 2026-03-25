#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════
// FILE: soma-chat-tui.mjs
// TUI split‑pane launcher for SOMA
// Top pane: Clean chat conversation
// Bottom pane: Tool calls, thinking, metadata
// Input at bottom of screen
// ═══════════════════════════════════════════════════════════

import blessed from 'blessed';
import { randomBytes } from 'crypto';
import http from 'http';
import figlet from 'figlet';

// ═══════════════════════════════════════════════════════════
// HTTP POST (same as soma-chat.mjs)
// ═══════════════════════════════════════════════════════════
function httpPost(url, body, timeoutMs = 65000) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: parsed.hostname,
            port: parsed.port,
            path: parsed.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data),
                'Connection': 'close'
            }
        }, (res) => {
            let buf = '';
            res.on('data', chunk => buf += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); }
                catch (e) { reject(new Error('JSON parse failed: ' + buf.slice(0, 200))); }
            });
        });
        req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('Request timed out after ' + timeoutMs + 'ms')); });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

// ═══════════════════════════════════════════════════════════
// TUI SETUP
// ═══════════════════════════════════════════════════════════
const screen = blessed.screen({
    smartCSR: true,
    title: 'SOMA TUI',
    fullUnicode: true,
});

// Top pane — chat conversation
const chatPane = blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    width: '100%',
    height: '70%',
    label: ' {bold}💬 SOMA Chat{/bold} ',
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { inverse: true } },
});

// Bottom pane — tool activity
const toolPane = blessed.box({
    parent: screen,
    top: '70%',
    left: 0,
    width: '100%',
    height: '30%',
    label: ' {bold}🛠️  Tool Activity{/bold} ',
    border: { type: 'line' },
    style: { border: { fg: 'yellow' } },
    scrollable: true,
    alwaysScroll: true,
    keys: true,
    vi: true,
    scrollbar: { ch: ' ', track: { bg: 'gray' }, style: { inverse: true } },
});

// Input bar
const input = blessed.textbox({
    parent: screen,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    inputOnFocus: true,
    border: { type: 'line' },
    style: { border: { fg: 'green' }, fg: 'white', bg: 'black' },
    keys: true,
    vi: true,
});

// ═══════════════════════════════════════════════════════════
// PANE HELPERS
// ═══════════════════════════════════════════════════════════
function addChatMessage(sender, message, color = 'white') {
    const time = new Date().toLocaleTimeString();
    const line = `{${color}-fg}{bold}${sender}:{/bold} ${message}{/}`;
    chatPane.pushLine(`[${time}] ${line}`);
    chatPane.setScrollPerc(100);
    screen.render();
}

function addToolOutput(output) {
    const time = new Date().toLocaleTimeString();
    toolPane.pushLine(`[${time}] ${output}`);
    toolPane.setScrollPerc(100);
    screen.render();
}

// ═══════════════════════════════════════════════════════════
// SESSION
// ═══════════════════════════════════════════════════════════
const API_URL = 'http://127.0.0.1:3001/api/soma/chat';
const session = {
    id: randomBytes(8).toString('hex'),
    startTime: Date.now(),
    messageCount: 0,
    deepThinking: false,
    history: [],
};

// ═══════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════
async function bootAnimation() {
    screen.clearRegion(0, screen.height, 0, screen.width);
    const banner = await new Promise((resolve) => {
        figlet('SOMA', { font: 'Standard', horizontalLayout: 'full' }, (err, data) => {
            if (err) resolve('SOMA');
            resolve(data);
        });
    });
    addChatMessage('SYSTEM', banner, 'magenta');
    addChatMessage('SYSTEM', 'Neural Link TUI v2.0', 'gray');
    addChatMessage('SYSTEM', '────────────────────', 'gray');
    addChatMessage('SYSTEM', 'Type /help for commands', 'gray');
    screen.render();
}

// ═══════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════
function showHelp() {
    addChatMessage('SYSTEM', 'Available commands:', 'cyan');
    addChatMessage('SYSTEM', '  /help    - Show this', 'gray');
    addChatMessage('SYSTEM', '  /status  - Check backend health', 'gray');
    addChatMessage('SYSTEM', '  /deep    - Toggle deep thinking', 'gray');
    addChatMessage('SYSTEM', '  /clear   - Clear panes', 'gray');
    addChatMessage('SYSTEM', '  /history - Show recent', 'gray');
    addChatMessage('SYSTEM', '  /stats   - Session stats', 'gray');
    addChatMessage('SYSTEM', '  /exit    - Exit', 'gray');
}

async function showStatus() {
    addToolOutput('Checking backend health...');
    try {
        const res = await fetch('http://127.0.0.1:3001/health');
        const data = await res.json();
        addToolOutput(`Backend: ${data.ok ? '✓ OK' : '✗ Unhealthy'}`);
        addToolOutput(`Uptime: ${data.uptime?.toFixed(1) || 0}s`);
    } catch (e) {
        addToolOutput(`✗ Health check failed: ${e.message}`);
    }
}

function toggleDeepThinking() {
    session.deepThinking = !session.deepThinking;
    addChatMessage('SYSTEM', `Deep Thinking: ${session.deepThinking ? 'ON' : 'OFF'}`, 'cyan');
}

function clearPanes() {
    chatPane.setContent('');
    toolPane.setContent('');
    screen.render();
}

// ═══════════════════════════════════════════════════════════
// MAIN CHAT LOOP
// ═══════════════════════════════════════════════════════════
async function handleInput(inputText) {
    inputText = inputText.trim();
    if (!inputText) return;

    // Add user message to chat pane
    addChatMessage('YOU', inputText, 'green');
    session.history.push({ role: 'user', text: inputText });
    session.messageCount++;

    // Handle commands
    if (inputText.startsWith('/')) {
        const cmd = inputText.toLowerCase();
        if (cmd === '/help') showHelp();
        else if (cmd === '/status') await showStatus();
        else if (cmd === '/deep') toggleDeepThinking();
        else if (cmd === '/clear') clearPanes();
        else if (cmd === '/history') {
            addChatMessage('SYSTEM', `History: ${session.history.length} messages`, 'cyan');
            session.history.slice(-5).forEach(entry => {
                const role = entry.role === 'user' ? 'YOU' : 'SOMA';
                addChatMessage(role, entry.text.substring(0, 80) + (entry.text.length > 80 ? '...' : ''), 'gray');
            });
        } else if (cmd === '/stats') {
            const uptime = ((Date.now() - session.startTime) / 1000).toFixed(0);
            addChatMessage('SYSTEM', `Messages: ${session.messageCount}, Uptime: ${uptime}s, ID: ${session.id.substring(0, 8)}`, 'cyan');
        } else if (cmd === '/exit') {
            addChatMessage('SYSTEM', 'Exiting...', 'magenta');
            screen.destroy();
            process.exit(0);
        } else {
            addChatMessage('SYSTEM', 'Unknown command. Type /help', 'red');
        }
        return;
    }

    // Send to SOMA API
    addToolOutput('Sending to SOMA...');
    try {
        const response = await httpPost(API_URL, {
            message: inputText,
            sessionId: session.id,
            deepThinking: session.deepThinking,
            history: session.history.slice(-10)
        });

        // Add SOMA's text response to chat pane
        if (response.text) {
            addChatMessage('SOMA', response.text, 'cyan');
            session.history.push({ role: 'assistant', text: response.text });
        }

        // Add any tool/thinking output to bottom pane
        if (response.tool_calls) {
            response.tool_calls.forEach(tc => {
                addToolOutput(`TOOL: ${tc.name} → ${JSON.stringify(tc.args).slice(0, 80)}`);
            });
        }
        if (response.thinking) {
            addToolOutput(`THINKING: ${response.thinking.slice(0, 100)}...`);
        }
        if (response.metadata) {
            addToolOutput(`METADATA: ${JSON.stringify(response.metadata)}`);
        }

    } catch (error) {
        addToolOutput(`✗ API Error: ${error.message}`);
        addChatMessage('SOMA', 'Failed to get response.', 'red');
    }
}

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════
async function start() {
    await bootAnimation();
    input.focus();

    input.on('submit', async (value) => {
        input.clearValue();
        screen.render();
        await handleInput(value);
    });

    screen.key(['C-c'], () => {
        screen.destroy();
        process.exit(0);
    });

    screen.render();
}

start().catch(err => {
    console.error('TUI failed:', err);
    process.exit(1);
});
