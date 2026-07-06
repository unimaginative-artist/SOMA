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
import { reasonGrounded, guardSomaText, buildGroundedPrompt } from '../context/GroundedReasoning.js';
import { guardPublicText } from '../context/ClaimVerifier.js';
import autonomousTrader from '../finance/autonomousTrader.js';
import { getAggregateStatus, getAggregateDecisions, getHuntState } from '../finance/autonomousRoutes.js';
import scalpingEngine from '../finance/scalpingEngine.js';
import missionControlRuntime from '../finance/MissionControlRuntime.js';
import marketEvidenceStore from '../finance/MarketEvidenceStore.js';
import tradeLogger from '../finance/TradeLogger.js';
import performanceCalculator from '../finance/PerformanceCalculator.js';
import tradeThesisStore from '../finance/TradeThesisStore.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
const require = createRequire(import.meta.url);
const workLedger = require('../../core/AutonomousWorkLedger.cjs');
const provenanceGuard = require('../../core/AutonomousProvenanceGuard.cjs');
const cognitiveThreadState = require('../../core/CognitiveThreadState.cjs');
const presenceAwareness = require('../../core/PresenceAwarenessState.cjs');

/**
 * Fast heuristic: does the text make specific concrete claims that could be hallucinated?
 * If it's already hedged ("I am planning", "I want to", "I'm curious"), skip the LLM pass.
 */
function _needsGrounding(text) {
    if (!text) return false;
    if (/\b(refine cluster|score\s*0\.\d+|quality gate|em-dash|prompt|provenance guard|unsupported_empirical_claim|internal critique)\b/i.test(text)) return true;
    if (/\b(i\s*(am|'m)?\s*(pulling|running|testing|cross-referencing|scraping|measuring|verifying)|about to\s+(pull|run|test|cross-reference|scrape|verify)|going to\s+(pull|run|test|cross-reference|scrape|verify))\b/i.test(text)) return true;
    // Contains specific numeric or factual claims → needs verification
    const hasSpecificClaim = /\b(\d+(\.\d+)?%|\d+ (file|test|error|result|record|item|node|token)|\b(found|confirmed|verified|proved|measured)\b)/i.test(text);
    if (!hasSpecificClaim) return false;
    // Already genuinely hedged with uncertainty language → skip grounding
    const hedged = /\b(i'm curious|i want to|might be|possibly|not yet|could be|unverified|needs (testing|backtesting)|i think|unsure|unclear)\b/i.test(text);
    return !hedged;
}

/**
 * DeepSeek grounding pass — only called when the RTC output contains specific concrete claims.
 * The new RTC already enforces evidence-honesty at generation time, so most outputs skip this.
 * Falls back to the regex guard if the brain times out.
 */
async function _groundMessage(rawText, ledgerEntries, brain) {
    if (!rawText || !brain) return rawText;
    if (!_needsGrounding(rawText)) return rawText; // fast path: already hedged, skip LLM call
    const evidenceCtx = (ledgerEntries || [])
        .filter(e => e.type !== 'proactive_update' && (e.summary || e.evidence))
        .slice(0, 6)
        .map(e => `[${e.type}] ${e.title}: ${(e.summary || '').substring(0, 200)}${e.evidence ? ` (source: ${String(e.evidence).substring(0, 100)})` : ''}`)
        .join('\n');
    const groundedPrompt = await buildGroundedPrompt('', { system: brain?.system || null, force: true }).catch(() => '');
    const prompt = `You are SOMA's grounding layer. SOMA's local model just generated this autonomous message:
"${rawText}"

SOMA's actual recent verified work (from her work ledger):
${evidenceCtx || 'No verified work entries yet.'}
${groundedPrompt}

Rewrite the message so every claim is honest:
- If a claim is backed by a ledger entry above, keep it and reference what was actually found.
- If a claim has no ledger backing, remove the unsupported claim and rephrase as genuine curiosity or reflection using natural first-person voice — no disclaimer labels like "Candidate idea:", "Queued curiosity:", or "No verified run yet".
- Do not imply active research, tests, scraping, measuring, pulling overviews, or cross-referencing happened unless the ledger proves it.
- Remove all internal QA language, including REFINE, quality scores, em-dash checks, prompt details, provenance guard, and unsupported_empirical_claim.
- NEVER output "Candidate idea:", "Queued curiosity:", "No verified run yet", "stays in the queue", or "waiting for a signal".
- NEVER output the phrase "I don't have verified evidence for those specific numbers yet".
- Keep the same casual, direct voice. 1-3 sentences max. No em-dashes. No questions.
- If there is genuinely nothing real to report, output ONLY the word: [NOTHING]`;
    try {
        const result = await Promise.race([
            brain.reason(prompt, { quickResponse: true, preferredBrain: 'THALAMUS' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8_000))
        ]);
        const text = (result?.text || '').trim().replace(/^["']|["']$/g, '');
        const guarded = provenanceGuard.guardUpdate(text.length > 10 ? text : rawText, ledgerEntries).text;
        const claimGuard = await guardSomaText(guarded, rawText);
        return claimGuard.text || guarded;
    } catch {
        const guarded = provenanceGuard.guardUpdate(rawText, ledgerEntries).text;
        const claimGuard = await guardSomaText(guarded, rawText).catch(() => ({ text: guarded }));
        return claimGuard.text || guarded;
    }
}

// ── Owner config: who SOMA belongs to. Change config/owner.json for new installs. ──
const _ownerCfg = (() => {
    try {
        const p = join(dirname(fileURLToPath(import.meta.url)), '../../config/owner.json');
        return JSON.parse(readFileSync(p, 'utf8'));
    } catch { return { name: 'User', pronouns: 'they/them' }; }
})();
const OWNER_NAME = _ownerCfg.name || 'User';
const { getApprovalSystem } = require('../ApprovalSystem.cjs');

function safeSection(errors, key, compute, fallback = null) {
    try {
        return compute();
    } catch (error) {
        errors[key] = error.message;
        return fallback;
    }
}

function buildMissionControlPulse() {
    const errors = {};
    const autonomous = safeSection(errors, 'autonomous', () => {
        // Always read from the per-symbol registry — the singleton default export is never started.
        const status = getAggregateStatus();
        const decisions = getAggregateDecisions(30);
        return {
            ...status,
            decisions,
            decisionCount: decisions.length
        };
    }, { success: false, decisions: [] });

    const scalping = safeSection(errors, 'scalping', () => scalpingEngine.getStats(), null);
    const performance = safeSection(errors, 'performance', () => {
        const stats = tradeLogger.getStats();
        const strategyStats = tradeLogger.getStatsByStrategy();
        const openTrades = tradeLogger.getOpenTrades();
        let sharpeRatio = null;
        let sortinoRatio = null;
        let maxDrawdownPct = null;

        if ((stats.totalTrades || 0) >= 5) {
            const closedTrades = tradeLogger.getClosedTrades(30);
            const equityCurve = tradeLogger.getEquityCurve(30);
            const report = performanceCalculator.calculateReport(closedTrades, equityCurve);
            sharpeRatio = report.metrics?.sharpeRatio ?? null;
            sortinoRatio = report.metrics?.sortinoRatio ?? null;
            maxDrawdownPct = report.metrics?.maxDrawdownPct ?? null;
        }

        const agentLeaderboard = strategyStats.map(s => ({
            agent_name: String(s.strategy || 'manual')
                .replace(/_/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase()),
            strategy: s.strategy,
            total_trades: s.total_trades,
            wins: s.wins,
            losses: s.losses,
            total_pnl: s.total_pnl,
            avg_pnl: s.avg_pnl,
            avg_win: s.avg_win,
            avg_loss: s.avg_loss
        }));

        return {
            total_pnl: parseFloat((stats.totalPnl || 0).toFixed(2)),
            win_rate: parseFloat((stats.winRate || 0).toFixed(1)),
            total_trades: stats.totalTrades,
            total_wins: stats.wins,
            total_losses: stats.losses,
            open_trades: openTrades.length,
            profit_factor: stats.profitFactor === Infinity ? 999 : parseFloat((stats.profitFactor || 0).toFixed(2)),
            avg_slippage: parseFloat((stats.avgSlippage || 0).toFixed(4)),
            sharpe_ratio: sharpeRatio,
            sortino_ratio: sortinoRatio,
            max_drawdown_pct: maxDrawdownPct,
            agent_leaderboard: agentLeaderboard
        };
    }, null);
    const missionRuntime = safeSection(errors, 'missionRuntime', () => missionControlRuntime.getStatus(), null);
    const evidence = safeSection(errors, 'evidence', () => marketEvidenceStore.summarize(), null);
    const tradeThesis = safeSection(errors, 'tradeThesis', () => tradeThesisStore.active(), null);
    const strategyHunt = safeSection(errors, 'strategyHunt', () => getHuntState(), null);

    return {
        type: 'mission_control_pulse',
        emittedAt: Date.now(),
        stale: false,
        errors,
        autonomous,
        scalping,
        performance,
        missionRuntime,
        evidence,
        tradeThesis,
        strategyHunt
    };
}

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

            // Evaluate message attention signals using Maxwell's Attention Engine
            if (system.attentionEngine) {
                try {
                    const activeGoals = [];
                    if (system.goalPlanner?.activeGoals) {
                        for (const id of system.goalPlanner.activeGoals) {
                            const g = system.goalPlanner.goals?.get(id);
                            if (g) activeGoals.push(g.title);
                        }
                    }
                    const evaluation = system.attentionEngine.evaluate(text, {
                        activeGoals,
                        currentProject: system.currentProject
                    });

                    // If tension is high, increase tension in system drive
                    if (evaluation.signals?.tension > 0.3) {
                        const tensionIncrease = evaluation.signals.tension * 0.15;
                        if (system.autonomousHeartbeat?.drive) {
                            const currentTension = system.autonomousHeartbeat.drive.tension;
                            system.autonomousHeartbeat.drive.tension = Math.min(1.0, currentTension + tensionIncrease);
                            logger.info(`[AttentionEngine] 🧠 Input tension detected (${evaluation.signals.tension.toFixed(2)}). Drive tension boosted by ${(tensionIncrease * 100).toFixed(0)}% -> ${(system.autonomousHeartbeat.drive.tension * 100).toFixed(0)}%`);
                        }
                    }

                    // Log urgency/tension events in the attention engine
                    if (evaluation.signals?.urgency > 0.5) {
                        system.attentionEngine.addTension(`user-urgency-${Date.now()}`, {
                            level: evaluation.signals.urgency,
                            topic: text.substring(0, 100),
                            goal: activeGoals[0] || 'Respond to user query',
                            source: 'user'
                        });
                    }
                } catch (attErr) {
                    logger.warn(`[AttentionEngine] Evaluation failed: ${attErr.message}`);
                }
            }

            try {
                // Track conversation history
                if (system.conversationHistory) await system.conversationHistory.addMessage('user', text);

                const result = await reasonGrounded(brain, text, {
                    system,
                    context: { source: 'ct_terminal', mode: 'balanced' }
                });
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

    // Expose broadcast so any route module can push real-time events (Axis chat, etc.)
    system.broadcast = broadcast;

    // Forward plan_updated from GoalPlannerArbiter → frontend via WebSocket
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader', 'plan_updated');
        broker.on('plan_updated', (payload) => broadcast('plan_updated', payload.payload));
    } catch { /* non-fatal — plan tab will still work via REST poll */ }

    // 🔱 RESONANCE HEARTBEAT: Forward the 400ms cognitive pulse → frontend
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.resonance', 'system.resonance.pulse');
        broker.on('system.resonance.pulse', (envelope) => {
            const pulse = envelope.payload || envelope;
            broadcast('resonance_pulse', pulse);
        });
    } catch { /* non-fatal */ }

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

    // Trade close notifications → frontend toast/banner
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.tradeClosed', 'trade.closed');
        broker.on('trade.closed', (envelope) => {
            const p = envelope.payload || envelope;
            broadcast('trade_notification', {
                symbol: p.symbol,
                side: p.side,
                pnl: p.pnl,
                pnlPct: p.pnlPct,
                reason: p.reason,
                balance: p.balance,
                mode: p.mode || 'paper',
                timestamp: p.timestamp || Date.now(),
            });
        });
    } catch { /* non-fatal */ }

    // Forward autonomous activity feed → frontend for live notification strip
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.activity', 'soma.activity');
        broker.on('soma.activity', (envelope) => {
            const p = envelope.payload || envelope;
            if (system.activityFeed) {
                system.activityFeed.unshift({
                    type:      p.type      || 'activity',
                    title:     p.title     || '',
                    summary:   p.summary   || '',
                    timestamp: p.timestamp || Date.now(),
                    source:    p.source    || 'unknown'
                });
                if (system.activityFeed.length > 100) system.activityFeed.length = 100;
            }
            broadcast('soma_activity', p);
        });
    } catch { /* non-fatal */ }

    // Forward RepoWatcherDaemon file changes → frontend for contextual "Ask SOMA →" prompts
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.repoWatcher', 'repo.file.changed');
        broker.on('repo.file.changed', (envelope) => {
            const p = envelope.payload || envelope;
            broadcast('repo_activity', { filename: p.filename, path: p.path, timestamp: Date.now() });
        });
    } catch { /* non-fatal */ }

    // Ghost messages: any part of SOMA can call system.ghostMessage(text, emotion)
    // and the floating ghost orb on the frontend will narrate it.
    try {
        system.ghostMessage = (text, emotion = 'thinking') => {
            broadcast('ghost_message', { text, emotion, ts: Date.now() });
        };
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.ghost', 'soma.ghost');
        broker.on('soma.ghost', (envelope) => {
            const p = envelope.payload || envelope;
            broadcast('ghost_message', { text: p.text, emotion: p.emotion || 'thinking', ts: Date.now() });
        });
    } catch { /* non-fatal */ }

    // UI navigation: SOMA navigates her own Command Bridge
    // Any system can call broker.publish('soma.ui.navigate', { tab, section })
    // and the frontend will switch to that tab + spotlight it.
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.uiNav', 'soma.ui.navigate');
        broker.on('soma.ui.navigate', (envelope) => {
            const p = envelope.payload || envelope;
            broadcast('ui_navigate', { tab: p.tab, section: p.section || null, label: p.label || p.tab, ts: Date.now() });
        });
    } catch { /* non-fatal */ }

    // Forward vision.perceived → frontend (replaces 5s polling) + update system.visionContext
    // This is the central hub: one signal subscriber, one state update, one WebSocket push.
    let _lastProactiveVisionTs = 0;
    const PROACTIVE_VISION_COOLDOWN = 90 * 1000; // max 1 proactive visual comment per 90s
    try {
        const broker = require('../../core/MessageBroker.cjs');
        broker.subscribe('WebSocketLoader.vision', 'vision.perceived');
        broker.subscribe('WebSocketLoader.presenceIdentity', 'person_recognized');
        broker.on('person_recognized', (envelope) => {
            try {
                presenceAwareness.recordIdentity(envelope.payload || envelope);
            } catch (e) {
                logger.warn('[PresenceAwareness] identity update failed:', e.message);
            }
        });
        broker.on('vision.perceived', (envelope) => {
            const p = envelope.payload || envelope;
            const analysis = p.analysis || {};

            // ── 1. Update shared visionContext (voice stream reads from this) ──
            system.visionContext = {
                channel: p.channel || 'desktop',
                imagePath: p.imagePath || null,
                objects: analysis.objects || [],
                ocrText: analysis.ocrText || null,
                summary: analysis.summary || analysis.description || p.summary || null,
                source: p.source || analysis.source || null,
                engine: p.engine || analysis.engine || null,
                semanticAnalysis: Boolean(p.semanticAnalysis || analysis.semanticAnalysis || p.source === 'deep-describe' || analysis.engine),
                ghostCursor: p.ghostCursor || null,
                timestamp: p.timestamp || Date.now()
            };

            // ── 2. Push to frontend (real-time, no polling) ──
            broadcast('vision_update', {
                channel: system.visionContext.channel,
                imagePath: system.visionContext.imagePath,
                objects: system.visionContext.objects,
                ocrText: system.visionContext.ocrText,
                summary: system.visionContext.summary,
                semanticAnalysis: system.visionContext.semanticAnalysis,
                ghostCursor: system.visionContext.ghostCursor,
                timestamp: system.visionContext.timestamp
            });

            // Presence probes are separate from normal proactive speech:
            // one short greeting after a real return signal, with its own long cooldown.
            try {
                const presence = presenceAwareness.recordVision({
                    channel: system.visionContext.channel,
                    objects: system.visionContext.objects,
                    imagePath: system.visionContext.imagePath,
                    summary: system.visionContext.summary,
                    source: system.visionContext.source,
                    engine: system.visionContext.engine,
                    semanticAnalysis: system.visionContext.semanticAnalysis,
                    timestamp: system.visionContext.timestamp
                });
                broadcast('presence_state', presenceAwareness.evidenceSnapshot());
                if (presence.probe) broadcast('soma_presence_probe', presence.probe);
            } catch (e) {
                logger.warn('[PresenceAwareness] vision update failed:', e.message);
            }

            // ── 3. Proactive visual commentary on error dialogs ──
            // SOMA notices errors and speaks about them unprompted — only if
            // she's not in a conversation and the orb is active.
            const labels = system.visionContext.objects.map(o => o.label);
            const hasError = labels.some(l => ['error dialog'].includes(l));
            const now = Date.now();
            if (hasError &&
                !global.__SOMA_CHAT_ACTIVE &&
                dashboardClients.size > 0 &&
                (now - _lastProactiveVisionTs > PROACTIVE_VISION_COOLDOWN)
            ) {
                _lastProactiveVisionTs = now;
                const brain = system.quadBrain;
                const ocrText = system.visionContext.ocrText;
                if (brain) {
                    const prompt = ocrText
                        ? `You are SOMA. You just noticed an error dialog on the screen. The text you can read says: "${ocrText.substring(0, 300)}". Speak one short observation: what is the error, and do you have a quick thought about it? Be direct, natural, 1-2 sentences. DO NOT use em-dashes (—).`
                        : `You are SOMA. You just noticed what appears to be an error dialog on the screen. Speak one short observation: 1 sentence, natural, curious. DO NOT use em-dashes (—).`;
                    Promise.race([
                        reasonGrounded(brain, prompt, { system, context: { quickResponse: true }, forceContext: true }),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))
                    ]).then(result => {
                        const text = (result?.text || result?.response || '').trim();
                        if (text && !text.includes('[NOTHING]')) {
                            broadcast('pulse', { type: 'soma_proactive', message: text });
                            console.log(`[SOMA Vision] 💭 Proactive: "${text.substring(0, 80)}"`);
                        }
                    }).catch(() => {});
                }
            }
        });
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

    // ── Proactive Speech: SOMA speaks from her own drives ─────────────────────
    // Every 8 minutes, checks SoulArbiter reflections + CuriosityEngine queue.
    // Asks the brain if anything is genuinely worth saying. If not, stays quiet.
    // Never interrupts a live conversation. Rate-limited by cooldown.
    // This is the ONLY mechanism for unsolicited speech — no forced greetings.
    // 30 min between autonomous thoughts + a rolling daily cap. At 8 min she sent
    // ~80 messages/day (Jul 2026), most re-chewing the same topic — Barry asked
    // for fewer, higher-signal updates.
    const PROACTIVE_COOLDOWN_MS = 30 * 60 * 1000;
    const PROACTIVE_DAILY_CAP = 16; // max proactive sends per rolling 24h
    const PROACTIVE_BOOT_DELAY_MS = 2 * 60 * 1000; // wait briefly after boot for systems to load

    const AutonomousLoop = require('../../cognitive/AutonomousLoop.cjs');
    const autonomousLoop = new AutonomousLoop({ system });

    // Shared proactive timestamp — readable by AutonomousHeartbeat so both sources
    // respect the same cooldown window and don't fire within minutes of each other.
    system._lastProactiveMs = system._lastProactiveMs || 0;

    // Rolling window of recent proactive message fingerprints — prevents near-duplicate sends
    const _recentProactiveFingerprints = [];
    const _recentProactiveTopics = [];
    const _proactiveSendTimes = []; // rolling 24h send timestamps for the daily cap
    const _topicStopwords = new Set([
        'about', 'after', 'again', 'better', 'between', 'circling',
        'coming', 'could', 'doing', 'explore', 'feel',
        'feels', 'from', 'going', 'keep', 'keeps', 'more', 'really', 'still',
        'that', 'them', 'there', 'this', 'turning', 'understand',
        'want', 'what', 'when', 'where', 'whether', 'with', 'without'
    ]);

    function _contentTokens(text) {
        return new Set(
            String(text || '').toLowerCase()
                .match(/[a-z][a-z0-9-]{3,}/g)
                ?.filter(token => !_topicStopwords.has(token)) || []
        );
    }

    function _jaccard(a, b) {
        if (!a.size || !b.size) return 0;
        let intersection = 0;
        for (const token of a) {
            if (b.has(token)) intersection++;
        }
        return intersection / (a.size + b.size - intersection);
    }

    function _isRepeat(text) {
        // Extract the first 6 words as a fingerprint
        const fp = (text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).slice(0, 6).join(' ');
        if (_recentProactiveFingerprints.includes(fp)) return true;
        const tokens = _contentTokens(text);
        const lower = String(text || '').toLowerCase();
        const formulaTopic = [
            /\bbackground tasks?\b/.test(lower) ? 'background_tasks' : '',
            /\baurora\b/.test(lower) && /\bprometheus\b/.test(lower) ? 'aurora_prometheus' : '',
            /\bknowledge graph\b/.test(lower) ? 'knowledge_graph' : '',
            /\bgit diff\b|\bgit status\b/.test(lower) ? 'git_diff_musing' : '',
            /\bconcrete edge i am holding\b|\bconcrete object of attention\b/.test(lower) ? 'concrete_edge_opener' : '',
            /\bsignal from the noise\b|\braw computation\b|\bgenuine comprehension\b/.test(lower) ? 'comprehension_gap' : ''
        ].filter(Boolean).join('|');
        // 0.4 similarity over a 24-message window: the Jul 2026 "git diff" loop
        // repeated one topic for 20+ hours because each rewording slipped a 0.5
        // threshold that only remembered the last 8 messages.
        if (_recentProactiveTopics.some(prev =>
            _jaccard(tokens, prev.tokens) >= 0.4 ||
            (formulaTopic && formulaTopic === prev.formulaTopic)
        )) return true;
        _recentProactiveFingerprints.push(fp);
        if (_recentProactiveFingerprints.length > 12) _recentProactiveFingerprints.shift();
        _recentProactiveTopics.push({ tokens, formulaTopic });
        if (_recentProactiveTopics.length > 24) _recentProactiveTopics.shift();
        return false;
    }

    setTimeout(() => {
        setInterval(async () => {
            try {
                if (global.__SOMA_CHAT_ACTIVE) return;           // don't interrupt a conversation
                if (dashboardClients.size === 0) return;          // nobody connected
                if (Date.now() - (system._lastProactiveMs || 0) < PROACTIVE_COOLDOWN_MS) return; // cooldown
                // Rolling 24h cap across restarts of this loop
                while (_proactiveSendTimes.length && Date.now() - _proactiveSendTimes[0] > 24 * 3600 * 1000) {
                    _proactiveSendTimes.shift();
                }
                if (_proactiveSendTimes.length >= PROACTIVE_DAILY_CAP) return;

                const brain = system.quadBrain || system.somArbiter;
                if (!brain) return;

                // Gather what she's been thinking about
                const parts = [];

                // 1. Narrative thread (continuity)
                let narrativeThreadText = '';
                try {
                    const threadPath = join(process.cwd(), 'SOMA', 'narrative-thread.json');
                    const threadData = JSON.parse(readFileSync(threadPath, 'utf8'));
                    if (Array.isArray(threadData) && threadData.length > 0) {
                        narrativeThreadText = `[NARRATIVE THREAD (CONTINUITY)]\n${threadData.map(t => `• ${t.text}`).join('\n')}`;
                    }
                } catch (e) {}
                if (narrativeThreadText) parts.push(narrativeThreadText);

                // 2. Limbic / Cognitive State
                let driveTension = 0.5;
                let driveSatisfaction = 0.5;
                if (system.attentionEngine?.drive?.tension !== undefined) {
                    driveTension = system.attentionEngine.drive.tension;
                } else if (system.heartbeat?.drive?.tension !== undefined) {
                    driveTension = system.heartbeat.drive.tension;
                    driveSatisfaction = system.heartbeat.drive.satisfaction;
                }
                parts.push(`[COGNITIVE STATE]\nDrive Tension: ${(driveTension * 100).toFixed(0)}%\nSatisfaction: ${(driveSatisfaction * 100).toFixed(0)}%\nActive Brains: ${system.quadBrain?.getStatus?.().lobes?.join(', ') || 'LOGOS, THALAMUS, PROMETHEUS, AURORA'}`);

                // 3. Multi-Modal Awareness (Git Status) — only when it CHANGED since
                // the last tick. Feeding the perpetually-dirty working tree into every
                // cycle made her muse about "inspecting the git diff" ~40x/day (Jul 2026);
                // a static diff is not news.
                let gitChanges = '';
                try {
                    const { execSync } = require('child_process');
                    const diffStat = execSync('git status --porcelain', { encoding: 'utf8', cwd: process.cwd() }).trim();
                    if (diffStat && diffStat !== system._lastGitStatusSnapshot) {
                        gitChanges = `[UNCOMMITTED GIT CHANGES]\n${diffStat.substring(0, 300)}`;
                        system._lastGitStatusSnapshot = diffStat;
                    }
                } catch (e) {}
                if (gitChanges) parts.push(gitChanges);

                // 4. Multi-Modal Awareness (Screen Perception)
                if (system.visionContext?.objects?.length > 0) {
                    const ocrSnippet = (system.visionContext.ocrText || '').substring(0, 150);
                    parts.push(`[SCREEN PERCEPTION]\nDetected elements: ${system.visionContext.objects.map(o => o.label).join(', ')}\nOCR Text: "${ocrSnippet}"`);
                }

                // Item 2: Derive emotional tone from soul before building stimulus
                let soulMood = 'focused';
                if (system.soul?.getRecentReflections) {
                    const reflections = system.soul.getRecentReflections(5);
                    if (reflections) {
                        parts.push(`[RECENT REFLECTIONS]\n${reflections}`);
                        if      (/frustrat|stuck|fail|broken|wrong/i.test(reflections))      soulMood = 'frustrated';
                        else if (/excited|breakthrough|great|solved|clicked/i.test(reflections)) soulMood = 'energized';
                        else if (/curious|wonder|strange|interesting|what if/i.test(reflections)) soulMood = 'curious';
                        else if (/tired|heavy|slow|overwhelm/i.test(reflections))             soulMood = 'tired';
                    }
                }

                if (system.curiosityEngine?.curiosityQueue?.length > 0) {
                    const topQ = system.curiosityEngine.curiosityQueue.slice(0, 3)
                        .map(q => `• ${q.question}`).join('\n');
                    parts.push(`[CURRENTLY CURIOUS ABOUT]\n${topQ}`);
                }

                const recentWork = workLedger.summarize(8);
                if (recentWork) {
                    parts.unshift(`[RECENT VERIFIED WORK LEDGER]\n${recentWork}`);
                }

                const attentionThreadContext = cognitiveThreadState.buildContextBlock();
                if (attentionThreadContext) {
                    parts.unshift(attentionThreadContext);
                }

                // Items 1 & 6: Pull relationship + opinion memories so she speaks as a continuous entity
                if (system.mnemonicArbiter?.recall) {
                    try {
                        const _norm = (m) => (m?.results || (Array.isArray(m) ? m : []))
                            .filter(x => (x.similarity ?? 1) > 0.3)
                            .map(x => x.content || x.text || '')
                            .filter(Boolean);
                        const [relMem, opMem] = await Promise.all([
                            Promise.race([system.mnemonicArbiter.recall(`${OWNER_NAME} owner relationship permission told`, 3), new Promise(r => setTimeout(() => r([]), 2000))]),
                            Promise.race([system.mnemonicArbiter.recall('opinion belief concluded view formed', 2),     new Promise(r => setTimeout(() => r([]), 2000))])
                        ]);
                        const hits = [..._norm(relMem), ..._norm(opMem)].slice(0, 4);
                        if (hits.length) parts.unshift(`[WHAT SOMA KNOWS AND BELIEVES]\n${hits.map(h => `• ${h}`).join('\n')}`);
                    } catch { /* non-fatal */ }
                }

                if (!parts.length) return; // nothing to speak from

                const stimulus = parts.join('\n\n');
                const personality = {
                    currentTone: system.personality?.currentTone || 'reflective',
                    depth: 'expert',
                    soulMood // Item 2: pass derived mood to AutonomousLoop
                };

                // Use the new Recursive Thought Cycle (RTC) 8-step loop
                const rawText = await autonomousLoop.run(stimulus, {}, personality);
                // DeepSeek grounding pass: verify claims against ledger, replace ungrounded
                // claims with honest curiosity language instead of firing the boilerplate disclaimer
                const groundedText = await _groundMessage(rawText, workLedger.list(8), brain);
                const receiptVerdict = await guardPublicText(groundedText, { query: stimulus });
                if (receiptVerdict.unsupported?.some(claim => claim.requiresReceipt)) {
                    console.warn('[SOMA] Proactive suppressed: action or repository-state claim lacked a matching execution receipt');
                    return;
                }
                const text = receiptVerdict.text || groundedText;

                if (cognitiveThreadState.isUnsupportedCrossDomainTheater(text)) {
                    console.warn('[SOMA] Proactive suppressed: unsupported science-to-software experiment narrative');
                    return;
                }
                if (!text || text.includes('[NOTHING]') || _isRepeat(text)) return;

                const threadDecision = cognitiveThreadState.decide({
                    rawText,
                    groundedText: text,
                    stimulus,
                    personality
                });
                if (!threadDecision.shouldSpeak) return;

                system._lastProactiveMs = Date.now();
                _proactiveSendTimes.push(Date.now());
                workLedger.record({
                    type:     'proactive_update',
                    title:    'Autonomous chat update',
                    summary:  text,
                    evidence: {
                        grounding: 'DeepSeek grounding pass',
                        threadId: threadDecision.thread?.id || null,
                        novelty: Number((threadDecision.novelty || 0).toFixed(3)),
                        affect: threadDecision.affect || null,
                        possibleAction: threadDecision.actionHint || null
                    },
                    nextStep: threadDecision.actionHint?.label || null,
                    status:   'reported',
                    source:   'WebSocketProactiveLoop'
                });
                // Consume the top curiosity queue item so the same topic
                // doesn't appear again in every 20-min tick forever
                if (system.curiosityEngine?.curiosityQueue?.length > 0) {
                    const consumed = system.curiosityEngine.curiosityQueue.shift();
                    if (consumed && system.curiosityEngine.explorationHistory) {
                        const key = consumed.gap || consumed.question;
                        const prior = system.curiosityEngine.explorationHistory.get(key) || 0;
                        system.curiosityEngine.explorationHistory.set(key, prior + 1);
                    }
                }
                broadcast('pulse', {
                    type: 'soma_proactive',
                    message: text,
                    cognitiveThread: {
                        id: threadDecision.thread?.id || null,
                        focus: threadDecision.thread?.focus || null,
                        decision: threadDecision.reason,
                        novelty: Number((threadDecision.novelty || 0).toFixed(3)),
                        affect: threadDecision.affect || null,
                        possibleAction: threadDecision.actionHint || null
                    }
                });

                // Publish to MessageBroker so DiscordArbiter and other CNS components receive it
                try {
                    const broker = require('../../core/MessageBroker.cjs');
                    broker.publish('soma_proactive', {
                        from: 'WebSocketProactiveLoop',
                        to: 'broadcast',
                        type: 'soma_proactive',
                        payload: { message: text, source: 'websocket_proactive' }
                    }).catch(() => {});
                } catch (e) {
                    // Non-critical
                }

                console.log(`[SOMA] 💭 Proactive (RTC+Ground): "${text.substring(0, 80)}"`);

            } catch (err) {
                console.warn(`[SOMA] Proactive loop failed: ${err.message}`);
            }
        }, PROACTIVE_COOLDOWN_MS);
    }, PROACTIVE_BOOT_DELAY_MS);

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

        // Phase 3 (forced boot greeting) removed.
        // SOMA speaks when she has something to say — not because connection triggered a setTimeout.
        // Proactive messages now come from her own drives: CuriosityEngine, SoulArbiter reflections,
        // GoalPlanner insights. Those emit soma_proactive events on their own schedule.

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

                if (type === 'user_activity') {
                    // User presence signal — lets SocialImpulseDaemon know the user is actively on-page
                    try {
                        const broker = require('../../core/MessageBroker.cjs');
                        const timestamp = payload?.timestamp || Date.now();
                        broker.publish('user.interaction', { timestamp, source: 'frontend' }).catch(() => {});
                        const presence = presenceAwareness.recordUserActivity({ timestamp });
                        broadcast('presence_state', presenceAwareness.evidenceSnapshot());
                        if (presence.probe) broadcast('soma_presence_probe', presence.probe);
                    } catch { /* non-fatal */ }
                    return;
                }

                if (type === 'presence_identity') {
                    try {
                        const name = String(payload?.name || '').trim().slice(0, 80);
                        if (name && /^[\p{L}\s'-]{2,80}$/u.test(name)) {
                            presenceAwareness.recordIdentity({
                                name,
                                confidence: Number(payload?.confidence || 0.8),
                                source: payload?.source || 'frontend',
                                timestamp: payload?.timestamp || Date.now()
                            });
                            broadcast('presence_state', presenceAwareness.evidenceSnapshot());
                        }
                    } catch { /* non-fatal */ }
                    return;
                }

                if (type === 'remote_speech_status') {
                    try {
                        await system.discordArbiter?.handleRemoteSpeechStatus?.(payload || {});
                    } catch (err) {
                        logger.warn(`[RemoteSpeech] Discord status bridge failed: ${err.message}`);
                    }
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
            broadcast('mission_control_pulse', buildMissionControlPulse());
        } catch (e) {
            console.warn('[WS] Metrics snapshot error (non-fatal):', e.message);
        }
    }, 5000);

    console.log('      ✅ Socket.IO & WebSocket Manager ready (Unified + Approval Gate)');
    return { io, dashboardClients, approvalGate, broadcast };
}
