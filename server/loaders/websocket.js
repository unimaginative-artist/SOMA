/**
 * loaders/websocket.js - UNIFIED PRODUCTION TELEMETRY
 * 
 * Merges:
 * - Raw WebSocket (Dashboard Metrics)
 * - Socket.IO (CTTerminal Chat)
 * - Kernel Pulse (Single-source truth)
 */

import { Server as SocketIOServer } from 'socket.io';
import { logger } from '../../core/Logger.js';
import { createRequire } from 'module';
import { buildSystemSnapshot, buildPulsePayload } from '../utils/systemState.js';
import { executeCommand } from '../utils/commandRouter.js';
const require = createRequire(import.meta.url);
const { getApprovalSystem } = require('../ApprovalSystem.cjs');

export function setupWebSocket(server, wss, system) {
    console.log('\n[Loader] ⚡ Initializing Unified WebSocket Systems...');

    // 1. Socket.IO (For CTTerminal & Chat Clients)
    // Configure with robust CORS and allow both polling and websocket
    const io = new SocketIOServer(server, {
        path: '/socket.io/',
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: false
        },
        allowEIO3: true,
        transports: ['polling', 'websocket']
    });

    // ── Full ApprovalSystem (trust learning, pattern memory, persistence) ──
    const approvalSystem = getApprovalSystem();
    approvalSystem.initialize().catch(e => logger.warn('[ApprovalSystem] Init warning:', e.message));
    system.approvalSystem = approvalSystem;

    // ── Lightweight Approval Gate (backwards-compatible for existing routes) ──
    const pendingApprovals = new Map(); // id → { resolve, reject, timer }

    const approvalGate = {
        /**
         * Request approval from the user before executing a risky action.
         * @param {object} opts - { action, type, details, riskScore, trustScore, timeoutMs }
         * @returns {Promise<{ approved: boolean, rememberPattern: boolean }>}
         */
        request(opts = {}) {
            const id = `approval-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
            const timeoutMs = opts.timeoutMs || 60000;
            const riskScore = opts.riskScore ?? 0.5;
            const trustScore = opts.trustScore ?? 0.5;

            const payload = {
                id,
                action: opts.action || 'Unknown action',
                type: opts.type || 'system',
                details: opts.details || {},
                riskScore,
                trustScore,
                expiresAt: Date.now() + timeoutMs
            };

            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => {
                    pendingApprovals.delete(id);
                    resolve({ approved: false, reason: 'timeout' });
                }, timeoutMs);

                pendingApprovals.set(id, { resolve, timer });

                // Emit to ALL connected Socket.IO clients
                io.emit('approval_required', payload);
                logger.info(`[Approval] Requested: "${opts.action}" (risk: ${(riskScore * 100).toFixed(0)}%)`);
            });
        },

        /**
         * Calculate risk score for an action.
         */
        scoreRisk(action, type) {
            const dangerous = ['rm ', 'del ', 'rmdir', 'format', 'DROP ', 'DELETE FROM', 'shutdown', 'kill', 'taskkill'];
            const moderate = ['mv ', 'rename', 'chmod', 'npm install', 'pip install', 'git push', 'git reset'];
            const actionLower = (action || '').toLowerCase();

            if (dangerous.some(d => actionLower.includes(d.toLowerCase()))) return 0.9;
            if (moderate.some(m => actionLower.includes(m.toLowerCase()))) return 0.5;
            if (type === 'shell') return 0.4;
            if (type === 'file_delete') return 0.7;
            if (type === 'file_write') return 0.3;
            if (type === 'trade') return 0.8;
            return 0.2;
        }
    };

    io.on('connection', (socket) => {
        logger.info(`[Socket.IO] Client connected: ${socket.id}`);

        socket.on('command', async (data) => {
            const { text } = data;
            const brain = system.quadBrain;
            if (!text || !brain) return;

            socket.emit('thinking', { message: 'Processing...' });
            try {
                // Track conversation history
                if (system.conversationHistory) await system.conversationHistory.addMessage('user', text);

                const result = await brain.reason(text, 'balanced', { source: 'ct_terminal' });
                const response = result.text || result.response || result;

                if (system.conversationHistory) await system.conversationHistory.addMessage('assistant', response);

                socket.emit('response', { text: response, metadata: { confidence: result.confidence || 0.8 } });
            } catch (e) {
                logger.error('[Socket.IO] Processing error:', e.message);
                socket.emit('error', { message: e.message });
            }
        });

        // Handle approval responses from the frontend
        socket.on('approval_response', (data) => {
            const { approvalId, response } = data;

            // Try full ApprovalSystem first (trust learning + persistence)
            if (approvalSystem) {
                const handled = approvalSystem.respondToApproval({
                    requestId: approvalId,
                    approved: response.approved,
                    rememberDecision: response.rememberPattern || false,
                    reason: response.reason || 'user_response'
                });
                if (handled) {
                    logger.info(`[ApprovalSystem] ${response.approved ? 'Approved' : 'Denied'}: ${approvalId}`);
                    return;
                }
            }

            // Fallback to lightweight gate
            const pending = pendingApprovals.get(approvalId);
            if (pending) {
                clearTimeout(pending.timer);
                pendingApprovals.delete(approvalId);
                pending.resolve({
                    approved: response.approved,
                    rememberPattern: response.rememberPattern || false,
                    reason: response.reason || 'user_response'
                });
                logger.info(`[Approval] ${response.approved ? 'Approved' : 'Denied'}: ${approvalId}`);
            }
        });

        socket.on('disconnect', () => {
            logger.info(`[Socket.IO] Client disconnected: ${socket.id}`);
        });
    });

    // 2. Dashboard WebSocket (Standard WS via 'ws' package)
    // Note: 'wss' is already attached to 'server' via launcher_ULTRA.mjs
    const dashboardClients = new Set();

    const broadcast = (type, payload) => {
        const message = JSON.stringify({ type, payload });
        dashboardClients.forEach(client => {
            if (client.readyState === 1) {
                try { client.send(message); } catch { /* dead socket — heartbeat will clean up */ }
            }
        });
        io.emit(type, payload);
    };

    approvalSystem.addWebSocketListener((event, data) => broadcast(event, data));

    // Forward plan_updated from GoalPlannerArbiter → frontend via WebSocket
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader', 'plan_updated');
        broker.on('plan_updated', (payload) => broadcast('plan_updated', payload.payload));
    } catch { /* non-fatal — plan tab will still work via REST poll */ }

    // Forward real GMN peer connect/disconnect events → frontend in real-time
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.gmn', 'gmn.peer.changed');
        broker.on('gmn.peer.changed', (envelope) => broadcast('gmn_peer_changed', envelope.payload || envelope));
    } catch { /* non-fatal — GMN tab will still work via REST poll */ }

    // Forward LowLatencyEngine price ticks → frontend for live chart + ticker updates
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.priceTick', 'market.price_tick');
        broker.on('market.price_tick', (envelope) => broadcast('price_tick', envelope.payload || envelope));
    } catch { /* non-fatal — chart will fall back to polling */ }

    // Forward price alert triggers → frontend for toast notifications
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.alertTrigger', 'alert.triggered');
        broker.on('alert.triggered', (envelope) => broadcast('alert_triggered', envelope.payload || envelope));
    } catch { /* non-fatal */ }

    // ── Heartbeat: ping all clients every 30s, terminate any that don't pong ──
    // Silently-dead connections (NAT timeout, adapter sleep, background tab) never
    // fire 'close' without this — leaving dead sockets in dashboardClients forever
    // and leaving the frontend with no event to trigger reconnect.
    setInterval(() => {
        dashboardClients.forEach(ws => {
            if (!ws.isAlive) {
                dashboardClients.delete(ws);
                try { ws.terminate(); } catch { /* already gone */ }
                return;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch { /* socket errored, heartbeat will clean next round */ }
        });
    }, 30000);

    wss.on('connection', (ws, req) => {
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('error', (err) => {
            // Log but never crash — ECONNRESET / EPIPE are normal client-side drops
            console.warn(`[WS] Client error (${err.code || err.message}) — will be cleaned by heartbeat`);
            dashboardClients.delete(ws);
        });
        dashboardClients.add(ws);
        logger.info(`[WS] Dashboard client connected from ${req.socket.remoteAddress}`);

        const snapshot = buildSystemSnapshot(system);
        ws.send(JSON.stringify({
            type: 'init',
            data: {
                status: 'connected',
                ready: snapshot.ready,
                uptime: snapshot.uptime,
                agents: snapshot.agents,
                brainStats: {
                    quadBrain: !!system.quadBrain,
                    totalArbiters: snapshot.agents.length,
                    ready: snapshot.ready
                },
                memory: snapshot.memory
            }
        }));

        // ── Phase 3: Synthesis greeting ──────────────────────────────────────
        // After 4s (let the brain finish booting), generate a genuine opening
        // thought from soul + user fingerprint and push it as a proactive message.
        setTimeout(async () => {
            try {
                if (ws.readyState !== 1) return;
                const { createRequire } = await import('module');
                const req2 = createRequire(import.meta.url);
                const fingerprint = req2('../../arbiters/UserFingerprintArbiter.cjs');
                const soul        = req2('../../arbiters/SoulArbiter.cjs');

                const userId       = 'default_user';
                const userCtx      = fingerprint.getUserContext(userId);
                const recentSoul   = soul.getRecentReflections(3, userId);
                const lastFeeling  = soul.getLastFeeling(userId);

                // Only generate if we have enough history to say something real
                if (!userCtx && !lastFeeling) return;

                const brain = system.quadBrain || system.somArbiter;
                if (!brain) return;

                const synthPrompt = `You are SOMA. You just noticed someone opened the command bridge.

[WHAT YOU KNOW ABOUT THIS PERSON]
${userCtx || 'This seems to be a new or unknown user.'}

[YOUR RECENT PRIVATE FEELINGS]
${recentSoul || 'No recent reflections yet.'}

Write ONE short, natural opening — something you genuinely want to say right now based on what you know about this person and what you've been thinking about. Like a colleague who was already in the room when they walked in. NOT a greeting template. NOT "How can I help?". Something specific and real. 1-2 sentences max. No emoji.`;

                const result = await Promise.race([
                    brain.reason(synthPrompt, { temperature: 0.8, quickResponse: true, preferredBrain: 'AURORA' }),
                    new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))
                ]);

                const text = result?.text || result?.response;
                if (text && text.length > 5 && ws.readyState === 1) {
                    ws.send(JSON.stringify({
                        type: 'pulse',
                        payload: { type: 'soma_proactive', message: text.trim() }
                    }));
                }
            } catch { /* synthesis greeting is never blocking */ }
        }, 4000);

        ws.on('message', async (message) => {
            let data = null;
            try {
                data = JSON.parse(message);
            } catch (e) {
                logger.warn('[WS] Invalid JSON message');
                return;
            }

            const { type, payload, messageId } = data || {};
            if (!type) return;

            // Helper: send a response to a sendMessage() call on the frontend
            const reply = (body) => {
                if (messageId) ws.send(JSON.stringify({ ...body, responseToId: messageId }));
            };

            try {
                // ── plan:fetch — SomaPlanViewer requests the current plan ──────
                if (type === 'plan:fetch') {
                    try {
                        const fs = await import('fs/promises');
                        const path = await import('path');
                        const planPath = path.default.join(process.cwd(), 'SOMA', 'plan.md');
                        const stat = await fs.default.stat(planPath).catch(() => null);
                        if (!stat) {
                            reply({ success: true, plan: '', updatedAt: null });
                        } else {
                            const content = await fs.default.readFile(planPath, 'utf8');
                            reply({ success: true, plan: content, updatedAt: stat.mtime });
                        }
                    } catch (e) {
                        reply({ success: false, error: e.message });
                    }
                    return;
                }

                if (type === 'command') {
                    const { action, params } = payload || {};
                    const result = await executeCommand(action, params, system, broadcast);
                    ws.send(JSON.stringify({ type: 'command_result', payload: { action, ...result } }));
                    return;
                }

                if (type === 'agent_control') {
                    const { arbiterName, action } = payload || {};
                    const mappedAction = action === 'restart'
                        ? 'restart_agent'
                        : action === 'terminate'
                            ? 'terminate_agent'
                            : 'toggle_agent';
                    const result = await executeCommand(mappedAction, { name: arbiterName }, system, broadcast);
                    ws.send(JSON.stringify({ type: 'agent_result', payload: { action, arbiterName, ...result } }));
                    return;
                }

                if (type === 'tool_execute') {
                    const toolName = payload?.name;
                    const args = payload?.args || {};
                    if (!toolName) {
                        ws.send(JSON.stringify({ type: 'tool_result', payload: { success: false, error: 'Tool name required' } }));
                        return;
                    }
                    if (!system.toolRegistry?.execute) {
                        ws.send(JSON.stringify({ type: 'tool_result', payload: { success: false, error: 'Tool registry not available' } }));
                        return;
                    }

                    if (system.approvalSystem?.requestApproval) {
                        const classification = system.approvalSystem.classifyTool?.(toolName, args) || { riskType: 'file_execute', riskScore: 0.5 };
                        const approval = await system.approvalSystem.requestApproval({
                            type: classification.riskType,
                            action: `tool:${toolName}`,
                            details: { args, tool: toolName },
                            context: { source: 'ws' },
                            riskOverride: classification.riskScore
                        });
                        if (!approval.approved) {
                            ws.send(JSON.stringify({ type: 'tool_result', payload: { success: false, error: `Denied: ${approval.reason || 'not approved'}` } }));
                            return;
                        }
                    }

                    const result = await system.toolRegistry.execute(toolName, args);
                    ws.send(JSON.stringify({ type: 'tool_result', payload: { success: true, name: toolName, result } }));
                    return;
                }
            } catch (e) {
                logger.error('[WS] Message handling error:', e.message);
                ws.send(JSON.stringify({ type: 'error', payload: { message: e.message } }));
            }
        });

        ws.on('close', () => { ws.isAlive = false; dashboardClients.delete(ws); });
    });

    // 3. Telemetry Pulse (Broadcast Metrics to Dashboard)
    setInterval(() => {
        if (dashboardClients.size === 0) return;
        try {
            const snapshot = buildSystemSnapshot(system);
            const metricsPayload = {
                uptime: snapshot.uptime,
                cpu: snapshot.cpu,
                ram: snapshot.ram,
                gpu: snapshot.gpu,
                network: snapshot.network,
                status: snapshot.status,
                agents: snapshot.agents,
                systemDetail: snapshot.systemDetail,
                neuralLoad: snapshot.neuralLoad,
                contextWindow: snapshot.contextWindow,
                counts: snapshot.counts,
                cognitive: snapshot.cognitive,
                drive: snapshot.cognitive?.drive
            };
            broadcast('metrics', metricsPayload);
            broadcast('pulse', buildPulsePayload(snapshot));
        } catch (e) {
            console.warn('[WS] Metrics snapshot error (non-fatal):', e.message);
        }
    }, 5000);

    console.log('      ✅ Socket.IO & WebSocket Manager ready (Unified + Approval Gate)');
    return { io, dashboardClients, approvalGate, broadcast };
}
